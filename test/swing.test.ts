import { describe, it, expect } from "vitest";
import { freshSwing, step, feeFloorPct, type SwingState } from "../src/agents/swing.js";

const run = (prices: number[], thr: number, fee: number, start = 1) => {
  const s = freshSwing(start);
  const trades = [];
  for (const p of prices) { const t = step(s, p, thr, fee); if (t) trades.push(t); }
  return { s, trades };
};

describe("swing trader", () => {
  it("buys a dip off the local high and sells the rally off the local low", () => {
    // rise to 110, dip 10% to 99 -> buy; then fall to 90, rally 10% to 99 -> sell
    const { s, trades } = run([100, 105, 110, 99, 95, 90, 99], 10, 0);
    expect(trades.map((t) => t.side)).toEqual(["BUY_BASE", "SELL_BASE"]);
    expect(trades[0].price).toBe(99);
    expect(trades[1].price).toBe(99);
    // bought at 99 and sold at 99 with no fee: flat.
    expect(s.realised).toBeCloseTo(0, 9);
  });

  it("re-arms, so one range can be worked repeatedly", () => {
    const wave = [];
    for (let i = 0; i < 6; i++) wave.push(100, 90, 100);
    const { s } = run(wave, 9, 0);
    // A static ladder fires once per level and stops; this keeps trading the same range.
    expect(s.trades).toBeGreaterThan(4);
  });

  it("loses on every round trip when the threshold is under the fee", () => {
    // 1% swings against a 1.1%/side pool: exactly DOT's problem.
    const wave = [];
    for (let i = 0; i < 25; i++) wave.push(100, 99, 100);
    const { s } = run(wave, 1, 1.1);
    expect(s.trades).toBeGreaterThan(10);
    expect(s.realised).toBeLessThan(0);
    // The stack itself shrinks, not just the profit.
    expect(s.quote + s.base * 100).toBeLessThan(1);
  });

  it("keeps the same swings profitable on a cheap pool", () => {
    const wave = [];
    for (let i = 0; i < 25; i++) wave.push(100, 99, 100);
    const { s } = run(wave, 1, 0.01);
    expect(s.realised).toBeGreaterThan(0);
    expect(s.quote + s.base * 100).toBeGreaterThan(1);
  });

  it("never trades while price only moves in its favour", () => {
    const { s } = run([100, 101, 102, 103, 104, 105], 3, 0.01);
    expect(s.trades).toBe(0);
    expect(s.pivot).toBe(105);
  });

  it("puts the fee floor above a round trip, with margin", () => {
    expect(feeFloorPct(1.1)).toBeGreaterThan(2.19 * 2);   // DOT: needs >4% swings to be worth it
    expect(feeFloorPct(0.01)).toBeLessThan(0.1);          // cbBTC/WETH: 0.06%
  });

  it("does not move the state on an observation that does not trade", () => {
    const s: SwingState = freshSwing(1);
    step(s, 100, 5, 0.01);
    const before = { ...s };
    step(s, 99, 5, 0.01);
    expect(s.holding).toBe(before.holding);
    expect(s.quote).toBe(before.quote);
    expect(s.trades).toBe(0);
  });
});

describe("price orientation", () => {
  it("prices the base in quote units, so a falling number means the base got cheaper", async () => {
    const { MARKETS, quotePerBase, token1PerToken0 } = await import("../src/core/markets.js");
    const m = MARKETS["cbbtc-weth"];
    // Real sqrtPriceX96 read from the pool at 09:00 UTC on 21 Sep 2026.
    const sqrt = BigInt("0x1e1b197a96f38cfe1070");

    // The pool's own orientation is cbBTC per WETH — upside down for a WETH-quoted engine.
    expect(token1PerToken0(sqrt, m)).toBeCloseTo(0.0322005, 6);
    // What the engine must see: WETH per cbBTC, matching the series the backtest ran on.
    expect(quotePerBase(sqrt, m)).toBeCloseTo(31.0554, 3);
  });

  it("reads a cbBTC rally as a rally, not a dip", async () => {
    const { MARKETS, quotePerBase } = await import("../src/core/markets.js");
    const { freshSwing, step } = await import("../src/agents/swing.js");
    const m = MARKETS["cbbtc-weth"];
    const at0600 = quotePerBase(BigInt("0x1e553b586b72a97edca7"), m);
    const at0900 = quotePerBase(BigInt("0x1e1b197a96f38cfe1070"), m);

    // cbBTC gained ~1.5% against ETH over that window.
    expect(at0900).toBeGreaterThan(at0600);

    // Holding ETH and waiting for a dip, a 1.5% rally must NOT trigger a buy.
    const s = freshSwing(1);
    step(s, at0600, 1.2, m.feePct);
    expect(step(s, at0900, 1.2, m.feePct)).toBeNull();
    expect(s.holding).toBe("quote");
  });
});
