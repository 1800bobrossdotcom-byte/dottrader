import { describe, it, expect } from "vitest";
import { pairRoundTrips, toTriggerPct, summariseSwing } from "../src/swing-report.js";
import { freshSwing, type SwingBook, type SwingLeg } from "../src/agents/swing.js";
import { LIVE_MARKETS } from "../src/core/markets.js";

const leg = (o: Partial<SwingLeg> & { side: SwingLeg["side"]; market: string; ts: number }): SwingLeg => ({
  price: 1, quoteDelta: 0, baseDelta: 0, reason: "", gasEth: 0, ...o,
});

describe("pairing round trips", () => {
  it("charges both legs' gas against the round trip", () => {
    // A 1.2% swing on 0.004 ETH grosses 0.000048; two legs of gas cost about 0.000004. Reporting
    // the gross would overstate every round trip by roughly 8%, which at this size is the margin.
    const trips = pairRoundTrips([
      leg({ side: "BUY_BASE", market: "usdc-weth", ts: 1000, price: 100, gasEth: 0.000002 }),
      leg({ side: "SELL_BASE", market: "usdc-weth", ts: 1000 + 3.6e6, price: 101.2, gasEth: 0.000002, roundTrip: 0.000048 }),
    ]);
    expect(trips).toHaveLength(1);
    expect(trips[0].netEth).toBeCloseTo(0.000044, 12);
    expect(trips[0].gasEth).toBeCloseTo(0.000004, 12);
    expect(trips[0].holdHours).toBeCloseTo(1, 6);
    expect(trips[0].entryPrice).toBe(100);
    expect(trips[0].exitPrice).toBe(101.2);
  });

  it("matches each sell to its own market's buy", () => {
    const trips = pairRoundTrips([
      leg({ side: "BUY_BASE", market: "cbbtc-weth", ts: 1, price: 31 }),
      leg({ side: "BUY_BASE", market: "usdc-weth", ts: 2, price: 0.0004 }),
      leg({ side: "SELL_BASE", market: "usdc-weth", ts: 3, price: 0.000405, roundTrip: 5 }),
      leg({ side: "SELL_BASE", market: "cbbtc-weth", ts: 4, price: 31.4, roundTrip: 7 }),
    ]);
    expect(trips.map((t) => t.market)).toEqual(["cbbtc-weth", "usdc-weth"]); // newest first
    expect(trips.find((t) => t.market === "usdc-weth")!.entryPrice).toBe(0.0004);
    expect(trips.find((t) => t.market === "cbbtc-weth")!.entryPrice).toBe(31);
  });

  it("ignores a sell with no matching buy rather than inventing an entry price", () => {
    // The book only keeps the last 50 fills; a sell whose buy has scrolled off must not be reported
    // as a round trip against a made-up entry of zero.
    expect(pairRoundTrips([leg({ side: "SELL_BASE", market: "usdc-weth", ts: 9, roundTrip: 3 })])).toEqual([]);
  });

  it("leaves an open position out of the closed record", () => {
    const trips = pairRoundTrips([leg({ side: "BUY_BASE", market: "usdc-weth", ts: 1, price: 100 })]);
    expect(trips).toEqual([]);
  });
});

describe("distance to the next trigger", () => {
  it("counts down as a held-quote market falls toward its buy", () => {
    // Holding ETH, pivot 100, threshold 1.2% → buys at 98.8.
    expect(toTriggerPct(100, 100, "quote", 1.2)).toBeCloseTo(1.2149, 3);
    expect(toTriggerPct(100, 99.4, "quote", 1.2)).toBeCloseTo(0.6073, 3);
    expect(toTriggerPct(100, 98.8, "quote", 1.2)).toBe(0);
  });

  it("counts down as a held-base market rises toward its sell", () => {
    expect(toTriggerPct(100, 100, "base", 1.2)).toBeCloseTo(1.2, 6);
    expect(toTriggerPct(100, 101.2, "base", 1.2)).toBe(0);
  });

  it("never reports a negative gap once the trigger is passed", () => {
    expect(toTriggerPct(100, 90, "quote", 1.2)).toBe(0);
    expect(toTriggerPct(100, 110, "base", 1.2)).toBe(0);
  });

  it("says nothing rather than guessing when the price could not be read", () => {
    expect(toTriggerPct(100, null, "quote", 1.2)).toBeNull();
    expect(toTriggerPct(null, 100, "quote", 1.2)).toBeNull();
  });
});

describe("the published summary", () => {
  const book = (): SwingBook => ({
    markets: [...LIVE_MARKETS], thresholdPct: 1.2, startedAt: "2026-09-22T22:40:00.000Z", startEth: 0.004,
    swings: Object.fromEntries(LIVE_MARKETS.map((k) => [k, freshSwing(0)])),
    active: null, trades: [], gasSpentEth: 0,
  });

  it("marks an open position at what selling would actually return", () => {
    const bk = book();
    bk.active = "usdc-weth";
    bk.swings["usdc-weth"] = { pivot: 0.00036, holding: "base", quote: 0, base: 11.089114, entryPrice: 0.00036, trades: 1, realised: 0 };
    bk.trades = [leg({ side: "BUY_BASE", market: "usdc-weth", ts: 1, price: 0.00036, quoteDelta: -0.004, baseDelta: 11.089114 })];

    const r = summariseSwing(bk, { "usdc-weth": 0.00037 }, { "usdc-weth": 0.01 }, "2026-09-23T00:00:00.000Z");
    // The exit fee comes off on the way out, so the mark is below the raw amount x price.
    expect(r.position!.amount).toBe(11.089114);
    expect(r.totals.equityEth).toBeCloseTo(11.089114 * 0.00037 * 0.9999, 12);
    expect(r.position!.unrealisedEth).toBeCloseTo(r.totals.equityEth! - 0.004, 12);
    expect(r.position!.sellTriggerPrice).toBeCloseTo(0.00036 * 1.012, 12);
  });

  it("keeps a market whose price failed to read, with a null price rather than dropping it", () => {
    // Dropping it would make the page quietly claim the engine watches fewer pairs than it does.
    const r = summariseSwing(book(), { "cbxrp-weth": null }, {}, null);
    expect(r.markets.map((m) => m.key)).toEqual(LIVE_MARKETS);
    expect(r.markets.find((m) => m.key === "cbxrp-weth")!.price).toBeNull();
    expect(r.markets.find((m) => m.key === "cbxrp-weth")!.toTriggerPct).toBeNull();
  });

  it("reports a fee it could not read as the market's stored figure, not zero", () => {
    const r = summariseSwing(book(), {}, {}, null);
    for (const m of r.markets) expect(m.feePct).toBeGreaterThan(0);
  });

  it("survives having no book at all", () => {
    const r = summariseSwing(null, {}, {}, null);
    expect(r.markets).toEqual([]);
    expect(r.position).toBeNull();
    expect(r.totals.fills).toBe(0);
    expect(r.totals.pnlPct).toBeNull();
  });
});
