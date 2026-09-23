import { describe, it, expect } from "vitest";
import { reconcile } from "../src/agents/swing.js";

const KEYS = ["cbbtc-weth", "usdc-weth", "virtual-weth", "cbxrp-weth"];
const none = Object.fromEntries(KEYS.map((k) => [k, 0]));
const priced = { "cbbtc-weth": 31.4, "usdc-weth": 0.00036, "virtual-weth": 0.00027, "cbxrp-weth": 0.00057 };

describe("who holds the budget, decided by the chain", () => {
  it("refuses to buy while a position is open, whatever the book believes", () => {
    // The real failure: the book said flat while the wallet held 11.09 USDC, so the engine spent
    // the 0.000564 ETH left above the gas reserve on a second position in VIRTUAL.
    const r = reconcile(KEYS, { ...none, "usdc-weth": 11.089114 }, priced);
    expect(r.holding).toEqual(["usdc-weth"]);
    expect(r.active).toBe("usdc-weth");
    expect(r.mayBuy).toBe(false);
  });

  it("nominates no active market when two are held, and still refuses to buy", () => {
    // Two positions means something already went wrong; the engine should be unwinding, not
    // picking one of them and carrying on as though it were normal.
    const r = reconcile(KEYS, { ...none, "usdc-weth": 11.089114, "virtual-weth": 2.0772 }, priced);
    expect(r.holding).toEqual(["usdc-weth", "virtual-weth"]);
    expect(r.active).toBeNull();
    expect(r.mayBuy).toBe(false);
  });

  it("allows buying only when every market is empty", () => {
    const r = reconcile(KEYS, none, priced);
    expect(r.holding).toEqual([]);
    expect(r.active).toBeNull();
    expect(r.mayBuy).toBe(true);
  });

  it("treats leftover dust as flat, so a sale's rounding remainder does not wedge the engine", () => {
    // A sale can leave a few units behind. Counting that as a position would stop it ever buying
    // again — the same failure as trading while invested, in the other direction.
    const r = reconcile(KEYS, { ...none, "usdc-weth": 0.0001 }, priced); // 0.0001 USDC ≈ 3.6e-8 ETH
    expect(r.holding).toEqual([]);
    expect(r.mayBuy).toBe(true);
  });

  it("counts a balance it cannot price as held", () => {
    // A rate-limited price read must not be an invitation to spend: refusing to buy is the safe
    // way to be wrong, and the position still shows up so it can be sold once the price returns.
    const r = reconcile(KEYS, { ...none, "cbxrp-weth": 500 }, { ...priced, "cbxrp-weth": null });
    expect(r.holding).toEqual(["cbxrp-weth"]);
    expect(r.active).toBe("cbxrp-weth");
    expect(r.mayBuy).toBe(false);
  });

  it("ignores a market it is not watching", () => {
    const r = reconcile(["usdc-weth"], { "usdc-weth": 0, "virtual-weth": 2.07 }, priced);
    expect(r.mayBuy).toBe(true);
  });
});
