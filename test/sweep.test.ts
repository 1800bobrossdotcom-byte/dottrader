import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "dottrader-"));
  process.env.DATA_DIR = dir; process.env.LIVE = "0"; process.env.TRADING_SLEEVE = "1"; process.env.SWEEP_MIN_DOT = "100";
  // A trading wallet: starts with ETH only.
  writeFileSync(path.join(dir, "baseline.json"), JSON.stringify({ startedAt: "", wallet: "0x", dot: 0, eth: 0.0125, usdc: 0, priceUsd: 0.005, ethUsd: 2400, note: "" }));
});

describe("Vault sweep", () => {
  it("keeps accumulated inventory working and sweeps only round-trip profit", async () => {
    const { Ledger } = await import("../src/core/ledger.js");
    const { Store } = await import("../src/data/store.js");
    const L = new Ledger(new Store(dir));
    expect(L.state.coreDot).toBe(0);
    // accumulate 4,000 DOT with fresh ETH -> inventory, not sweepable
    L.recordFill({ ts: 1, agent: "accumulate", side: "BUY_DOT", dot: 4_000, eth: 0.008, usd: 20, priceUsd: 0.005, feesUsd: 0.2, paper: true, reason: "dca" });
    expect(L.tradeableDot).toBeCloseTo(4_000, 6);
    expect(L.sweepable()).toBe(0);
    // grid round trip nets +150 DOT
    L.recordFill({ ts: 2, agent: "grid", side: "SELL_DOT", dot: 1_000, eth: 0.0022, usd: 5.2, priceUsd: 0.0052, feesUsd: 0.05, paper: true, tag: "grid:1:2", reason: "" });
    L.recordFill({ ts: 3, agent: "grid", side: "BUY_DOT", dot: 1_150, eth: 0.0022, usd: 5.2, priceUsd: 0.0045, feesUsd: 0.05, paper: true, tag: "grid:1:2", reason: "" });
    expect(L.totalDotEarned()).toBeCloseTo(4_150, 6);
    expect(L.sweepable()).toBeCloseTo(150, 6);
    L.recordSweep({ ts: 4, dot: 150, to: "0xvault", paper: true });
    expect(L.state.portfolio.dot).toBeCloseTo(4_000, 6);
    expect(L.state.sweptDot).toBe(150);
    expect(L.sweepable()).toBe(0);
    // swept DOT still counts toward the journey stack
    expect(L.dotEquivalent(2e-6)).toBeCloseTo(4_150, 6);
  });
});
