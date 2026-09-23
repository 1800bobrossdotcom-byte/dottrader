/**
 * Re-arming swing trader.
 *
 * Holds the quote token, buys after the price dips `thresholdPct` from its local high, sells after
 * it rallies `thresholdPct` from its local low, and re-arms immediately. Unlike the grid there are
 * no fixed levels to exhaust: the pivot follows the price, so it keeps working a range instead of
 * firing once per rung and going quiet — which is what left the grid idle through 20 qualifying
 * swings a day while it sat on filled levels.
 *
 * It needs the threshold to clear the round-trip fee with room to spare. Below that every trade is
 * a loss no matter how well timed, and trading more often only loses faster.
 */
export interface SwingState {
  /** Local extreme since the last trade: the high while holding quote, the low while holding base. */
  pivot: number | null;
  holding: "quote" | "base";
  quote: number;
  base: number;
  /** Price of the last fill, for reporting the round trip. */
  entryPrice: number | null;
  trades: number;
  /** Quote earned by completed round trips, net of fees. */
  realised: number;
}

export interface SwingTrade {
  side: "BUY_BASE" | "SELL_BASE";
  price: number;
  quoteDelta: number;
  baseDelta: number;
  /** Set on a SELL that closes a round trip: quote gained over the buy that opened it. */
  roundTrip?: number;
  reason: string;
}

/**
 * Relative slack on the trigger comparisons. These thresholds are products of floats — 90 * 1.1 is
 * 99.00000000000001 — so an exact touch would otherwise be missed by a rounding error.
 */
const EPS = 1e-9;

export function freshSwing(quote: number): SwingState {
  return { pivot: null, holding: "quote", quote, base: 0, entryPrice: null, trades: 0, realised: 0 };
}

/** The smallest threshold worth trading: a round trip must clear both fees and leave something. */
export function feeFloorPct(feePct: number, marginX = 3) {
  return (1 - (1 - feePct / 100) ** 2) * 100 * marginX;
}

/**
 * Advance the state by one price observation. Returns the trade it would make, or null.
 * Mutates `s` only when it trades, so a caller can observe prices without committing.
 */
export function step(s: SwingState, price: number, thresholdPct: number, feePct: number): SwingTrade | null {
  if (!(price > 0)) return null;
  const thr = thresholdPct / 100;
  const fee = feePct / 100;
  if (s.pivot === null) { s.pivot = price; return null; }

  if (s.holding === "quote") {
    if (price > s.pivot) { s.pivot = price; return null; }
    if (price > s.pivot * (1 - thr) * (1 + EPS)) return null;
    const spend = s.quote;
    const got = (spend / price) * (1 - fee);
    s.base = got; s.quote = 0; s.pivot = price; s.holding = "base"; s.entryPrice = price; s.trades++;
    return {
      side: "BUY_BASE", price, quoteDelta: -spend, baseDelta: got,
      reason: `dip ${(thr * 100).toFixed(2)}% off local high — bought ${got.toFixed(8)} at ${price.toPrecision(6)}`,
    };
  }

  if (price < s.pivot) { s.pivot = price; return null; }
  if (price < s.pivot * (1 + thr) * (1 - EPS)) return null;
  const sold = s.base;
  const got = sold * price * (1 - fee);
  // The round trip is worth what came back minus what the matching buy cost.
  const cost = s.entryPrice ? sold / (1 - fee) * s.entryPrice : 0;
  const gain = got - cost;
  s.quote = got; s.base = 0; s.pivot = price; s.holding = "quote"; s.entryPrice = null;
  s.trades++; s.realised += gain;
  return {
    side: "SELL_BASE", price, quoteDelta: got, baseDelta: -sold, roundTrip: gain,
    reason: `rally ${(thr * 100).toFixed(2)}% off local low — sold ${sold.toFixed(8)} at ${price.toPrecision(6)}`,
  };
}

/**
 * Advance an idle market's pivot without letting it trade.
 *
 * With one budget and several watched markets, only one can hold a position. The rest must keep
 * tracking their local high, or they come back armed off a stale pivot — but they must not flip
 * themselves into `base` on a signal no money was behind. Tracking the high and nothing else is
 * also the honest behaviour: a market that dipped while the budget was busy elsewhere, and is still
 * down when the budget frees up, fires immediately on the next tick. The opportunity is deferred,
 * not erased.
 */
export function trackIdle(s: SwingState, price: number) {
  if (!(price > 0) || s.holding !== "quote") return;
  if (s.pivot === null || price > s.pivot) s.pivot = price;
}

/** One executed leg, as it happened on chain. */
export interface SwingLeg extends SwingTrade {
  market: string;
  ts: number;
  hash?: string;
  gasEth: number;
}

/**
 * The live engine's book: one budget, several watched markets.
 *
 * Kept here rather than in the runner so the reporter can read it without importing a process that
 * wants a private key just to be loaded.
 */
export interface SwingBook {
  markets: string[];
  thresholdPct: number;
  startedAt: string;
  startEth: number;
  /** Per-market swing state. Exactly one may be holding `base` — see `active`. */
  swings: Record<string, SwingState>;
  /** The market the budget is currently committed to, or null when the engine is in ETH. */
  active: string | null;
  trades: SwingLeg[];
  gasSpentEth: number;
}
