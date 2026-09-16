import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "dottrader-"));
  process.env.DATA_DIR = dir;
  process.env.LIVE = "0";
  process.env.TRADING_SLEEVE = "0.3";
  writeFileSync(path.join(dir, "baseline.json"), JSON.stringify({
    startedAt: new Date().toISOString(), wallet: "0x8455cF296e1265b494605207e97884813De21950",
    dot: 100_000, eth: 0.01, usdc: 0, priceUsd: 0.005, ethUsd: 2400, note: "test",
  }));
});

describe("Ledger (DOT-denominated accounting)", () => {
  it("protects the core sleeve and scores a round trip in DOT", async () => {
    const { Ledger } = await import("../src/core/ledger.js");
    const { Store } = await import("../src/data/store.js");
    const L = new Ledger(new Store(dir));
    expect(L.state.coreDot).toBeCloseTo(70_000, 3);
    expect(L.tradeableDot).toBeCloseTo(30_000, 3);

    // Sell 10k DOT at 2e-6 ETH each -> 0.02 ETH
    L.recordFill({ ts: 1, agent: "grid", side: "SELL_DOT", dot: 10_000, eth: 0.02, usd: 48, priceUsd: 0.0048, feesUsd: 0.5, paper: true, tag: "grid:1:1", reason: "t" });
    expect(L.state.portfolio.dot).toBeCloseTo(90_000, 3);
    expect(L.state.openLots).toHaveLength(1);
    expect(L.state.openLots[0].targetBuyPriceEth).toBeCloseTo(2e-6 * 0.97, 12);

    // Price drops 10%: 0.02 ETH now buys ~11,111 DOT (minus fees ~ 10,900)
    L.recordFill({ ts: 2, agent: "grid", side: "BUY_DOT", dot: 10_900, eth: 0.02, usd: 48, priceUsd: 0.0044, feesUsd: 0.5, paper: true, tag: "grid:1:1", reason: "t" });
    expect(L.state.openLots).toHaveLength(0);
    expect(L.state.portfolio.dot).toBeCloseTo(100_900, 3);
    expect(L.totalDotEarned()).toBeCloseTo(900, 3);
    expect(L.state.dotEarnedByAgent.grid).toBeCloseTo(900, 3);
  });

  it("counts fresh-capital buys fully as DOT earned", async () => {
    const { Ledger } = await import("../src/core/ledger.js");
    const { Store } = await import("../src/data/store.js");
    const L = new Ledger(new Store(dir));
    L.recordFill({ ts: 1, agent: "accumulate", side: "BUY_DOT", dot: 2_000, eth: 0.004, usd: 10, priceUsd: 0.005, feesUsd: 0.1, paper: true, reason: "dca" });
    expect(L.totalDotEarned()).toBeCloseTo(2_000, 3);
    expect(L.dotEquivalent(2e-6)).toBeCloseTo(102_000, 3);
  });
});
