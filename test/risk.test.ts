import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { MarketSnapshot } from "../src/core/types.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "dottrader-"));
  process.env.DATA_DIR = dir; process.env.LIVE = "0"; process.env.TRADING_SLEEVE = "0.3";
  writeFileSync(path.join(dir, "baseline.json"), JSON.stringify({ startedAt: "", wallet: "0x", dot: 100_000, eth: 0.01, usdc: 0, priceUsd: 0.005, ethUsd: 2400, note: "" }));
});

const snap: MarketSnapshot = {
  ts: Date.now(), priceUsd: 0.005, priceEth: 2e-6, ethUsd: 2500, liquidityUsd: 400_000, volume24hUsd: 200_000,
  priceChange: { m5: 0, h1: 0, h6: 0, h24: 0 }, txns24h: { buys: 1, sells: 1 }, source: "dexscreener",
};

describe("Risk agent", () => {
  it("rejects sells that would breach the core sleeve, approves sane ones, one per tick", async () => {
    const { Ledger } = await import("../src/core/ledger.js");
    const { Store } = await import("../src/data/store.js");
    const { MarketData } = await import("../src/data/market.js");
    const { riskCheck } = await import("../src/agents/risk.js");
    const ledger = new Ledger(new Store(dir));
    const ctx = { snap, market: new MarketData(new Store(dir)), ledger, intel: null };
    const v = riskCheck([
      { agent: "a", side: "SELL_DOT", conviction: 0.9, size: { dot: 50_000 }, reason: "too big" },
      { agent: "b", side: "SELL_DOT", conviction: 0.5, size: { dot: 5_000 }, reason: "fine" },
      { agent: "c", side: "SELL_DOT", conviction: 0.4, size: { dot: 5_000 }, reason: "also fine but second" },
    ], ctx);
    expect(v.rejected.map((r) => r.signal.agent)).toContain("a");
    expect(v.approved).toHaveLength(1);
    expect(v.approved[0].agent).toBe("b");
  });
  it("halts everything when the KILL file exists", async () => {
    writeFileSync(path.join(dir, "KILL"), "");
    const { Ledger } = await import("../src/core/ledger.js");
    const { Store } = await import("../src/data/store.js");
    const { MarketData } = await import("../src/data/market.js");
    const { riskCheck } = await import("../src/agents/risk.js");
    const ctx = { snap, market: new MarketData(new Store(dir)), ledger: new Ledger(new Store(dir)), intel: null };
    const v = riskCheck([{ agent: "b", side: "SELL_DOT", conviction: 0.5, size: { dot: 5_000 }, reason: "x" }], ctx);
    expect(v.halted).toMatch(/KILL/);
    expect(v.approved).toHaveLength(0);
  });
});
