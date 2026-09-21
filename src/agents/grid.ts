import { Agent, type Ctx } from "./base.js";
import type { Signal } from "../core/types.js";
import { config } from "../core/config.js";

interface GridState {
  anchorEth: number | null; // ETH per DOT when the grid was (re)anchored
  filled: Record<string, number>; // level index -> ts of sell
  /** Ratchet: the grid will not sell below this price. Set to the price of the last buy-back. */
  lastBuyBackEth: number;
}

/**
 * Grid agent. Sells thin slices of the trading sleeve as DOT/ETH rises through
 * grid levels (GRID_SPACING_PCT apart) and buys each slice back GRID_EDGE_PCT
 * lower, ending each cycle with more DOT. The buy-back gap is floored above the
 * round-trip fee cost so every closed trip nets DOT.
 *
 * RATCHET: without a floor, a falling market makes the grid re-anchor lower, sell into the
 * bounce, re-anchor lower again, and so on — each round trip nets DOT while the wallet's DOT
 * is sold ever cheaper in ETH terms. So the grid refuses to sell below either the price of its
 * last buy-back or the cheapest slice it currently has open. Buy-backs are never blocked.
 */
export class GridAgent extends Agent<GridState> {
  readonly name = "grid";
  readonly levels = config.GRID_LEVELS;
  /** grid spacing as a fraction (GRID_SPACING_PCT, default 3.5%) */
  readonly spacing = config.GRID_SPACING_PCT / 100;
  constructor() { super({ anchorEth: null, filled: {}, lastBuyBackEth: 0 }); }

  async propose(ctx: Ctx): Promise<Signal[]> {
    const p = ctx.snap.priceEth;
    if (!(p > 0)) return [];
    const st = this.state;
    const lots = ctx.ledger.state.openLots.filter((l) => l.agent === this.name);

    // (Re)anchor: first run, or price fell well below the grid with nothing open.
    if (st.anchorEth === null || (lots.length === 0 && p < st.anchorEth * (1 - 2 * this.spacing))) {
      st.anchorEth = p; st.filled = {}; this.save();
    }
    // Ratchet: if price ran through every level and we hold no lots, re-anchor higher.
    if (lots.length === 0 && p > st.anchorEth * (1 + this.spacing) ** (this.levels + 1)) {
      st.anchorEth = p; st.filled = {}; this.save();
    }

    const out: Signal[] = [];
    // 1) Buy-backs first: any open short lot whose target is met.
    for (const lot of lots.filter((l) => (l.side ?? "short") === "short")) {
      if (p <= lot.targetBuyPriceEth) {
        out.push({
          agent: this.name, side: "BUY_DOT", conviction: 0.9,
          size: { usd: lot.ethReceived * ctx.snap.ethUsd },
          tag: lot.id,
          reason: `grid buy-back: price ${fmt(p)} <= target ${fmt(lot.targetBuyPriceEth)} (sold at ${fmt(lot.sellPriceEth)})`,
        });
      }
    }
    // 1b) Long lots: DOT bought on a dip, sold back once it has cleared the fee floor.
    for (const lot of lots.filter((l) => (l.side ?? "short") === "long")) {
      if (lot.targetSellPriceEth && p >= lot.targetSellPriceEth && (lot.dotHeld ?? 0) > 0) {
        out.push({
          agent: this.name, side: "SELL_DOT", conviction: 0.9,
          size: { dot: lot.dotHeld! },
          tag: lot.id,
          reason: `grid long close: price ${fmt(p)} >= target ${fmt(lot.targetSellPriceEth)} (bought at ${fmt((lot.ethSpent ?? 0) / Math.max(lot.dotHeld ?? 1, 1e-12))})`,
        });
      }
    }

    // 1c) Buy rungs: idle ETH works the downside instead of waiting on a far-away buy-back.
    // Without this the grid only ever profits from a rise followed by a fall, so half of every swing
    // passes it by and parked ETH sits dead through the dip it was meant to buy.
    if (config.GRID_TWO_SIDED) {
      const idleEth = ctx.ledger.unreservedEth;
      const openLongs = lots.filter((l) => (l.side ?? "short") === "long").length;
      const ethSlice = idleEth / this.levels;
      for (let k = 1; k <= this.levels; k++) {
        const level = st.anchorEth * (1 - this.spacing) ** k;
        const key = `L${k}`;
        if (p <= level && !st.filled[key] && ethSlice > 0 && openLongs < this.levels) {
          out.push({
            agent: this.name, side: "BUY_DOT", conviction: 0.6,
            size: { usd: ethSlice * ctx.snap.ethUsd },
            tag: `gridlong:${k}:${Math.floor(Date.now() / 1000)}`,
            reason: `grid buy rung ${k}: ${fmt(p)} <= ${fmt(level)} (-${(this.spacing * 100 * k).toFixed(0)}% from anchor)`,
          });
          break;
        }
      }
    }

    // 2) Sells: first unfilled level at/below current price.
    // Skipped entirely when new shorts are switched off, so the grid manages what it already holds
    // without adding more short exposure in a trend it cannot detect.
    if (!config.GRID_ALLOW_NEW_SHORTS) return out;
    // Ratchet floor: the last buy-back price, and the cheapest open lot (never ladder down under it).
    const openSellPrices = lots.map((l) => l.sellPriceEth).filter((x) => x > 0);
    const floorEth = Math.max(st.lastBuyBackEth, openSellPrices.length ? Math.min(...openSellPrices) : 0);

    const slice = ctx.ledger.tradeableDot / this.levels;
    for (let k = 1; k <= this.levels; k++) {
      const level = st.anchorEth * (1 + this.spacing) ** k;
      const key = String(k);
      if (p >= level && !st.filled[key] && slice > 0) {
        if (p < floorEth) {
          // Ratchet holds: selling here would be cheaper than our last buy-back or an open slice.
          break;
        }
        const uptrend = ctx.snap.priceChange.h1 > 3 && (ctx.intel?.buyPressure ?? 0.5) > 0.7;
        out.push({
          agent: this.name, side: "SELL_DOT",
          conviction: uptrend ? 0.35 : 0.7, // hold slices longer when flow is strongly bid
          size: { dot: slice },
          tag: `grid:${k}:${Math.floor(Date.now() / 1000)}`,
          reason: `grid level ${k} hit: ${fmt(p)} >= ${fmt(level)} (+${(this.spacing * 100 * k).toFixed(0)}% from anchor)`,
        });
        break;
      }
    }
    return out;
  }

  /** Executor calls this so the level is marked filled only after a real fill. */
  onFill(tag: string | undefined) {
    if (tag?.startsWith("gridlong:")) { this.state.filled[`L${tag.split(":")[1]}`] = Date.now(); this.save(); return; }
    if (!tag?.startsWith("grid:")) return;
    this.state.filled[tag.split(":")[1]] = Date.now(); this.save();
  }
  onLotClosed(tag: string | undefined, buyBackPriceEth?: number) {
    if (buyBackPriceEth && buyBackPriceEth > 0) {
      // Raise the ratchet to the buy-back price: we will not sell cheaper than we just repurchased.
      this.state.lastBuyBackEth = Math.max(this.state.lastBuyBackEth, buyBackPriceEth);
    }
    if (tag?.startsWith("gridlong:")) delete this.state.filled[`L${tag.split(":")[1]}`];
    else if (tag?.startsWith("grid:")) delete this.state.filled[tag.split(":")[1]];
    this.save();
  }

  /** Reconciliation dropped a lot (its ETH was spent outside the bot); free the level again. */
  onLotDropped(tag: string | undefined) {
    if (!tag?.startsWith("grid:")) return;
    delete this.state.filled[tag.split(":")[1]]; this.save();
  }
}

const fmt = (x: number) => x.toExponential(4);
