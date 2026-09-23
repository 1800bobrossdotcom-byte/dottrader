/**
 * The swing engine's public journal, written to site/data/swing.json.
 *
 * dottrader.app reported only the DOT ledger, which was written by bots that are now deliberately
 * stopped. So the page showed a frozen record of a strategy that had ended, while the only thing
 * actually trading was invisible. This is the other half of the story.
 *
 * It is deliberately separate from `stats.json`: that file is the DOT journey, measured in DOT, and
 * merging a second strategy into it would blur the one number the project is judged on.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config } from "./core/config.js";
import { MARKETS, baseToken, type Market } from "./core/markets.js";
import { feeFloorPct, type SwingBook, type SwingLeg } from "./agents/swing.js";

export interface SwingMarketView {
  key: string;
  base: string;
  pool: string;
  /** Live fee per swap, in percent; these pools price dynamically. */
  feePct: number;
  /** ETH per unit of the base token. */
  price: number | null;
  /** The local extreme the next trigger is measured from. */
  pivot: number | null;
  holding: "quote" | "base";
  /** How far the price still has to move, in percent, before this market fires. Null if unknown. */
  toTriggerPct: number | null;
}

export interface SwingRoundTrip {
  ts: number;
  market: string;
  base: string;
  entryPrice: number;
  exitPrice: number;
  /** ETH gained or lost on the round trip, after pool fees and both legs' gas. */
  netEth: number;
  gasEth: number;
  holdHours: number;
  buyHash?: string;
  sellHash?: string;
}

export interface SwingReport {
  generatedAt: string;
  /** When the engine last wrote its book. The site uses this to say whether it is still running. */
  bookAt: string | null;
  thresholdPct: number;
  startedAt: string | null;
  startEth: number;
  markets: SwingMarketView[];
  position: {
    market: string;
    base: string;
    amount: number;
    entryPrice: number;
    sellTriggerPrice: number;
    price: number | null;
    unrealisedEth: number | null;
  } | null;
  roundTrips: SwingRoundTrip[];
  fills: SwingLeg[];
  totals: {
    fills: number;
    roundTrips: number;
    realisedEth: number;
    gasEth: number;
    equityEth: number | null;
    pnlPct: number | null;
  };
}

/**
 * Pair each SELL with the BUY that opened it, per market.
 *
 * `roundTrip` on the sell already nets the pool fees, but not gas — and at this size gas is not a
 * rounding error: a 1.2% swing on 0.004 ETH grosses 0.000048 ETH against roughly 0.000004 ETH of
 * gas for the two legs, so ignoring it would overstate every round trip by about 8%.
 */
export function pairRoundTrips(trades: SwingLeg[]): SwingRoundTrip[] {
  const open = new Map<string, SwingLeg>();
  const out: SwingRoundTrip[] = [];
  for (const t of [...trades].sort((a, b) => a.ts - b.ts)) {
    if (t.side === "BUY_BASE") { open.set(t.market, t); continue; }
    const buy = open.get(t.market);
    if (!buy) continue; // a sell with no matching buy in this book's history
    open.delete(t.market);
    const gasEth = buy.gasEth + t.gasEth;
    out.push({
      ts: t.ts,
      market: t.market,
      base: MARKETS[t.market] ? baseToken(MARKETS[t.market]).symbol : t.market,
      entryPrice: buy.price,
      exitPrice: t.price,
      netEth: (t.roundTrip ?? 0) - gasEth,
      gasEth,
      holdHours: (t.ts - buy.ts) / 3.6e6,
      buyHash: buy.hash,
      sellHash: t.hash,
    });
  }
  return out.sort((a, b) => b.ts - a.ts);
}

/** How far this market still has to move before it trades, as a positive percentage. */
export function toTriggerPct(pivot: number | null, price: number | null, holding: "quote" | "base", thresholdPct: number): number | null {
  if (pivot === null || price === null || !(pivot > 0) || !(price > 0)) return null;
  const target = holding === "quote" ? pivot * (1 - thresholdPct / 100) : pivot * (1 + thresholdPct / 100);
  // While holding quote the price must FALL to the target; while holding base it must RISE.
  const gap = holding === "quote" ? price / target - 1 : target / price - 1;
  return Math.max(0, gap * 100);
}

export function summariseSwing(
  bk: SwingBook | null,
  prices: Record<string, number | null>,
  fees: Record<string, number>,
  bookAt: string | null,
): SwingReport {
  const thresholdPct = bk?.thresholdPct ?? 0;
  const keys = bk?.markets ?? [];
  const markets: SwingMarketView[] = keys.flatMap((key) => {
    const m: Market | undefined = MARKETS[key];
    if (!m) return [];
    const s = bk?.swings[key];
    const price = prices[key] ?? null;
    return [{
      key,
      base: baseToken(m).symbol,
      pool: m.pool,
      feePct: fees[key] ?? m.feePct,
      price,
      pivot: s?.pivot ?? null,
      holding: s?.holding ?? "quote",
      toTriggerPct: toTriggerPct(s?.pivot ?? null, price, s?.holding ?? "quote", thresholdPct),
    }];
  });

  const roundTrips = pairRoundTrips(bk?.trades ?? []);
  const realisedEth = roundTrips.reduce((a, r) => a + r.netEth, 0);

  let position: SwingReport["position"] = null;
  let equityEth: number | null = null;
  if (bk?.active && MARKETS[bk.active]) {
    const m = MARKETS[bk.active];
    const s = bk.swings[bk.active];
    const price = prices[bk.active] ?? null;
    const fee = fees[bk.active] ?? m.feePct;
    // The last unmatched BUY is what this position was opened at.
    const buy = [...bk.trades].reverse().find((t) => t.market === bk.active && t.side === "BUY_BASE");
    const entryPrice = buy?.price ?? s?.entryPrice ?? 0;
    // Marked at what a sale would actually return: the fee comes off on the way out too.
    const value = price !== null ? (s?.base ?? 0) * price * (1 - fee / 100) : null;
    equityEth = value;
    position = {
      market: bk.active,
      base: baseToken(m).symbol,
      amount: s?.base ?? 0,
      entryPrice,
      sellTriggerPrice: (s?.pivot ?? entryPrice) * (1 + thresholdPct / 100),
      price,
      unrealisedEth: value !== null && buy ? value + buy.quoteDelta : null,
    };
  } else if (bk) {
    equityEth = bk.swings[bk.markets[0]]?.quote ?? null;
  }

  return {
    generatedAt: new Date().toISOString(),
    bookAt,
    thresholdPct,
    startedAt: bk?.startedAt ?? null,
    startEth: bk?.startEth ?? 0,
    markets,
    position,
    roundTrips: roundTrips.slice(0, 50),
    fills: [...(bk?.trades ?? [])].sort((a, b) => b.ts - a.ts).slice(0, 50),
    totals: {
      fills: bk?.trades.length ?? 0,
      roundTrips: roundTrips.length,
      realisedEth,
      gasEth: bk?.gasSpentEth ?? 0,
      equityEth,
      pnlPct: equityEth !== null && bk && bk.startEth > 0 ? (equityEth / bk.startEth - 1) * 100 : null,
    },
  };
}

/** The smallest threshold each live market could be traded at, for the site to show alongside. */
export function floorFor(feePct: number) { return feeFloorPct(feePct); }

export function writeSwingReport(r: SwingReport) {
  mkdirSync(config.SITE_DATA_DIR, { recursive: true });
  writeFileSync(path.join(config.SITE_DATA_DIR, "swing.json"), JSON.stringify(r, null, 2));
}
