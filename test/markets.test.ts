import { describe, it, expect } from "vitest";
import { MARKETS, LIVE_MARKETS, quotePerBase, token1PerToken0, baseToken, quoteToken } from "../src/core/markets.js";
import { getAddress } from "viem";
import { freshSwing, step, trackIdle, feeFloorPct } from "../src/agents/swing.js";

const WETH = "0x4200000000000000000000000000000000000006";

describe("market definitions", () => {
  it("addresses carry a valid EIP-55 checksum", () => {
    // A hand-typed checksum is what viem rejected the first time these were written; every address
    // here now comes out of `probe-pools.ts`, and this is the check that keeps it that way.
    for (const m of Object.values(MARKETS)) {
      expect(getAddress(m.pool)).toBe(m.pool);
      expect(getAddress(m.token0.address)).toBe(m.token0.address);
      expect(getAddress(m.token1.address)).toBe(m.token1.address);
    }
  });

  it("quotes every market in ETH, whichever side the pool puts WETH on", () => {
    // VIRTUAL is the reason this matters: WETH is its token1, the opposite of every other pool.
    // A copied `quote: "token0"` would have run that market upside down — buying every rally.
    for (const m of Object.values(MARKETS)) {
      expect(getAddress(quoteToken(m).address)).toBe(getAddress(WETH));
      expect(getAddress(baseToken(m).address)).not.toBe(getAddress(WETH));
    }
    expect(MARKETS["virtual-weth"].quote).toBe("token1");
    expect(MARKETS["cbbtc-weth"].quote).toBe("token0");
  });

  it("keeps vvv-weth out of the live set", () => {
    // Screened at 0.05% but the pool charges ~0.28%/side, so the backtest that recommended it was
    // run against a fifth of the real cost. It stays defined and unused until that is re-run.
    expect(MARKETS["vvv-weth"]).toBeDefined();
    expect(LIVE_MARKETS).not.toContain("vvv-weth");
    for (const k of LIVE_MARKETS) expect(MARKETS[k]).toBeDefined();
  });

  it("only lists live markets the default threshold can actually pay for", () => {
    for (const k of LIVE_MARKETS) expect(feeFloorPct(MARKETS[k].feePct)).toBeLessThan(1.2);
    expect(feeFloorPct(MARKETS["vvv-weth"].feePct)).toBeGreaterThan(1.2);
  });
});

describe("orientation, derived not assumed", () => {
  it("inverts a token0-quoted pool and leaves a token1-quoted one alone", () => {
    const sqrt = BigInt("0x1e1b197a96f38cfe1070");
    const cb = MARKETS["cbbtc-weth"];
    expect(quotePerBase(sqrt, cb)).toBeCloseTo(1 / token1PerToken0(sqrt, cb), 10);

    const v = MARKETS["virtual-weth"];
    expect(quotePerBase(sqrt, v)).toBeCloseTo(token1PerToken0(sqrt, v), 10);
  });
});

describe("idle markets while the budget is committed elsewhere", () => {
  it("follows the local high but never takes a position", () => {
    const s = freshSwing(1);
    trackIdle(s, 100);
    trackIdle(s, 110);
    trackIdle(s, 90); // a 18% dip, deep past any threshold
    expect(s.holding).toBe("quote");
    expect(s.trades).toBe(0);
    expect(s.pivot).toBe(110);
  });

  it("defers the missed signal rather than erasing it", () => {
    // The budget was busy through the dip. When it frees up and the price is still down, the very
    // next observation must fire — the pivot is still the pre-dip high.
    const s = freshSwing(0);
    trackIdle(s, 100);
    trackIdle(s, 95);
    s.quote = 1;
    const t = step(s, 95, 1.2, 0.01);
    expect(t?.side).toBe("BUY_BASE");
  });

  it("leaves a market holding base untouched", () => {
    const s = freshSwing(1);
    step(s, 100, 1.2, 0.01);
    step(s, 90, 1.2, 0.01);
    expect(s.holding).toBe("base");
    const pivot = s.pivot;
    trackIdle(s, 200);
    expect(s.pivot).toBe(pivot);
  });
});
