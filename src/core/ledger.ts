import { Store } from "../data/store.js";
import type { Fill, Portfolio } from "./types.js";
import { config } from "./config.js";

export interface Baseline {
  startedAt: string;
  wallet: string;
  wallets?: { address: string; dot: number; eth: number; usdc: number }[];
  dot: number;
  eth: number;
  usdc: number;
  priceUsd: number;
  ethUsd: number;
  note: string;
}

export interface LedgerState {
  /** Paper portfolio (mirrors chain when live). */
  portfolio: Portfolio;
  /** DOT locked as the core sleeve; the swarm never sells below this. */
  coreDot: number;
  /** Realised DOT gained from completed round trips, by agent. */
  dotEarnedByAgent: Record<string, number>;
  /** Open inventory the grid / mean-rev agents are holding in ETH, waiting to buy back DOT. */
  openLots: OpenLot[];
  daily: { day: string; dotStart: number; fills: number };
  /** DOT already transferred to the vault. Counts toward the stack forever. */
  sweptDot: number;
  /** Earned DOT not yet swept. */
  unsweptEarned: number;
}

export interface Sweep { ts: number; dot: number; to: string; txHash?: string; paper: boolean }

/** A lot the bot could no longer honour because its ETH was spent outside the bot (e.g. a manual swap). */
export interface Reconciliation { ts: number; lotId: string; ethRemoved: number; dotReleased: number; reason: string; dropped: boolean }

/**
 * Swap gas and price impact mean a wallet always holds a little less ETH than its open lots' gross
 * proceeds. That is normal, not ETH spent elsewhere, so a shortfall must clear this margin before
 * anything is unwound.
 */
const RECONCILE_TOLERANCE_PCT = 0.03;

export interface OpenLot {
  id: string;
  agent: string;
  tag?: string;
  ts: number;
  dotSold: number;
  ethReceived: number;
  sellPriceEth: number;
  /** Price (ETH per DOT) at/below which buying back is a win. */
  targetBuyPriceEth: number;
}

const today = () => new Date().toISOString().slice(0, 10);
/** Minimum price drop (fraction) between a sell and its buy-back for the round trip to net DOT. */
export const REQUIRED_EDGE = config.GRID_EDGE_PCT / 100;

/**
 * The ledger is the swarm's single source of truth for "are we earning DOT?".
 * Everything is measured in DOT first, USD second.
 */
export class Ledger {
  state: LedgerState;
  baseline: Baseline | null;
  constructor(readonly store = new Store()) {
    this.baseline = store.readJson<Baseline | null>("baseline.json", null);
    this.state = store.readJson<LedgerState | null>("state.json", null) ?? this.fresh();
  }

  /** The baseline entry for THIS process's trading wallet (falls back to the tracked total for single-wallet setups). */
  walletBaseline(): { dot: number; eth: number; usdc: number } {
    const b = this.baseline;
    if (!b) return { dot: 0, eth: 0, usdc: 0 };
    const mine = b.wallets?.find((w) => w.address.toLowerCase() === config.WALLET_ADDRESS.toLowerCase());
    return mine ?? { dot: b.dot, eth: b.eth, usdc: b.usdc };
  }

  private fresh(): LedgerState {
    const wb = this.walletBaseline();
    const dot = wb.dot;
    return {
      portfolio: { dot, eth: wb.eth, usdc: wb.usdc },
      coreDot: dot * (1 - config.TRADING_SLEEVE),
      dotEarnedByAgent: {},
      openLots: [],
      daily: { day: today(), dotStart: dot, fills: 0 },
      sweptDot: 0,
      unsweptEarned: 0,
    };
  }

  /** Called with the real on-chain portfolio when live; keeps paper in sync with reality. */
  syncPortfolio(p: Portfolio) {
    this.state.portfolio = { ...p };
    this.save();
  }

  rollDay() {
    const d = today();
    if (this.state.daily.day !== d) {
      this.state.daily = { day: d, dotStart: this.state.portfolio.dot, fills: 0 };
      this.save();
    }
  }

  get tradeableDot() {
    return Math.max(0, this.state.portfolio.dot - this.state.coreDot);
  }

  /** Total DOT in wallet + DOT-equivalent of ETH held in open lots at the current price. */
  dotEquivalent(priceEth: number) {
    const lotsEth = this.state.openLots.reduce((a, l) => a + l.ethReceived, 0);
    return this.state.portfolio.dot + (this.state.sweptDot ?? 0) + (priceEth > 0 ? lotsEth / priceEth : 0);
  }

  recordFill(f: Fill) {
    this.store.append("fills.ndjson", f);
    this.state.daily.fills++;
    if (!config.LIVE) {
      if (f.side === "SELL_DOT") { this.state.portfolio.dot -= f.dot; this.state.portfolio.eth += f.eth; }
      else { this.state.portfolio.dot += f.dot; this.state.portfolio.eth -= f.eth; }
    }
    if (f.side === "SELL_DOT") {
      const priceEth = f.eth / f.dot;
      this.state.openLots.push({
        id: f.tag ?? `${f.agent}-${f.ts}`,
        agent: f.agent,
        tag: f.tag,
        ts: f.ts,
        dotSold: f.dot,
        ethReceived: f.eth,
        sellPriceEth: priceEth,
        // Must buy back cheaper than 2 swap fees + a margin to net more DOT.
        targetBuyPriceEth: priceEth * (1 - REQUIRED_EDGE),
      });
    } else {
      // A buy tagged with a lot id closes that lot: DOT earned = DOT bought back - DOT originally sold.
      const idx = f.tag ? this.state.openLots.findIndex((l) => l.id === f.tag) : -1;
      let earned: number;
      if (idx >= 0) {
        const lot = this.state.openLots[idx];
        earned = f.dot - lot.dotSold;
        this.state.openLots.splice(idx, 1);
        this.store.append("journal.ndjson", {
          ts: f.ts, agent: f.agent, lotId: lot.id, dotSold: lot.dotSold, dotBought: f.dot,
          dotEarned: earned, sellPriceUsd: lot.sellPriceEth * (f.priceUsd / (f.eth / f.dot)),
          buyPriceUsd: f.priceUsd, holdHours: (f.ts - lot.ts) / 3.6e6, paper: f.paper, txHash: f.txHash,
        });
      } else {
        // Fresh capital (accumulator): every DOT bought is DOT earned.
        earned = f.dot;
        this.store.append("journal.ndjson", {
          ts: f.ts, agent: f.agent, lotId: null, dotSold: 0, dotBought: f.dot, dotEarned: earned,
          sellPriceUsd: null, buyPriceUsd: f.priceUsd, holdHours: 0, paper: f.paper, txHash: f.txHash,
        });
      }
      this.state.dotEarnedByAgent[f.agent] = (this.state.dotEarnedByAgent[f.agent] ?? 0) + earned;
      // Only round-trip profit is swept. Fresh-capital buys are the trading wallet's working inventory.
      if (idx >= 0) this.state.unsweptEarned = (this.state.unsweptEarned ?? 0) + earned;
    }
    this.save();
  }

  /** How much DOT is ready to go to the vault right now. */
  sweepable() {
    const dot = this.state.portfolio.dot;
    const profit = Math.min(this.state.unsweptEarned ?? 0, Math.max(0, dot - config.SWEEP_KEEP_DOT));
    // Optional cap on working inventory: anything above it is "extra" and goes to the vault too.
    const extra = Number.isFinite(config.SWEEP_INVENTORY_ABOVE_DOT) ? Math.max(0, dot - profit - config.SWEEP_INVENTORY_ABOVE_DOT) : 0;
    const amt = profit + extra;
    return amt >= config.SWEEP_MIN_DOT ? amt : 0;
  }

  recordSweep(s: Sweep) {
    this.store.append("sweeps.ndjson", s);
    this.state.sweptDot = (this.state.sweptDot ?? 0) + s.dot;
    this.state.unsweptEarned = Math.max(0, (this.state.unsweptEarned ?? 0) - s.dot);
    if (!config.LIVE) this.state.portfolio.dot -= s.dot;
    // The core sleeve was sized from the original stack; keep it consistent after the swept DOT left the wallet.
    this.state.coreDot = Math.min(this.state.coreDot, Math.max(0, this.state.portfolio.dot * (1 - config.TRADING_SLEEVE)));
    this.save();
  }

  sweeps(): Sweep[] { return this.store.readLines<Sweep>("sweeps.ndjson"); }

  fills(): Fill[] { return this.store.readLines<Fill>("fills.ndjson"); }

  reconciliations(): Reconciliation[] { return this.store.readLines<Reconciliation>("reconciled.ndjson"); }

  /** Net DOT the bot itself moved: everything it bought minus everything it sold. */
  botDotDelta() {
    return this.fills().reduce((a, f) => a + (f.side === "BUY_DOT" ? f.dot : -f.dot), 0);
  }

  /**
   * DOT that arrived or left outside the bot — manual swaps, transfers in, sweeps out.
   * Actual balance minus (what we started with + what the bot itself did + what we swept away).
   */
  manualDotDelta(actualDot: number) {
    const start = this.walletBaseline().dot;
    return actualDot - (start + this.botDotDelta() - (this.state.sweptDot ?? 0));
  }

  /**
   * The chain is the truth. If the open lots claim more ETH than the wallet can actually spend —
   * because a manual swap used it — shrink or drop them, newest first, so the grid is not left
   * waiting forever to spend ETH that is gone. The released DOT is NOT counted as bot profit:
   * it is logged as a reconciliation so `dotEarned` keeps meaning "round trips the bot completed".
   */
  reconcileWithChain(actualEth: number): Reconciliation[] {
    const claimed = this.state.openLots.reduce((a, l) => a + l.ethReceived, 0);
    if (claimed <= 0) return [];
    const spendable = Math.max(0, actualEth - config.GAS_RESERVE_ETH);
    // The tolerance decides whether the gap is real; once it is, close the whole gap. Subtracting the
    // tolerance from the deficit instead would leave a gap that shrinks with `claimed`, so every tick
    // would nibble another slice and never settle.
    if (claimed - spendable <= claimed * RECONCILE_TOLERANCE_PCT) return [];
    let deficit = claimed - spendable;

    const out: Reconciliation[] = [];
    // Oldest lots first. The missing ETH cannot belong to a slice whose proceeds just arrived, so
    // charging the shortfall to the newest lot would shrink it every tick, free its grid level and
    // let the grid re-sell the same slice forever while the genuinely stranded old lots sat intact.
    for (const lot of [...this.state.openLots].sort((a, b) => a.ts - b.ts)) {
      if (deficit <= 1e-12) break;
      const take = Math.min(lot.ethReceived, deficit);
      const share = lot.ethReceived > 0 ? take / lot.ethReceived : 1;
      const dotReleased = lot.dotSold * share;
      const rec: Reconciliation = {
        ts: Date.now(), lotId: lot.id, ethRemoved: take, dotReleased,
        reason: "lot ETH spent outside the bot; lot released so the grid is not stranded",
        // Only a fully unwound lot frees its grid level. A lot that merely shrank is still open and
        // still intends to buy back, so its level must stay closed to new sells.
        dropped: lot.ethReceived - take <= 1e-9,
      };
      out.push(rec);
      this.store.append("reconciled.ndjson", rec);
      lot.ethReceived -= take;
      lot.dotSold -= dotReleased;
      deficit -= take;
    }
    this.state.openLots = this.state.openLots.filter((l) => l.ethReceived > 1e-9);
    this.save();
    return out;
  }

  totalDotEarned() {
    return Object.values(this.state.dotEarnedByAgent).reduce((a, b) => a + b, 0);
  }

  save() { this.store.writeJson("state.json", this.state); }
}
