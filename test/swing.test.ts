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
