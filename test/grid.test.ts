import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { MarketSnapshot } from "../src/core/types.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "dottrader-"));
  process.env.DATA_DIR = dir; process.env.LIVE = "0"; process.env.TRADING_SLEEVE = "0.3";
  writeFileSync(path.join(dir, "baseline.json"), JSON.stringify({ startedAt: "", wallet: "0x", dot: 100_000, eth: 0, usdc: 0, priceUsd: 0.005, ethUsd: 2500, note: "" }));
});
const mk = (priceEth: number): MarketSnapshot => ({
  ts: Date.now(), priceUsd: priceEth * 2500, priceEth, ethUsd: 2500, liquidityUsd: 400_000, volume24hUsd: 1,
  priceChange: { m5: 0, h1: 0, h6: 0, h24: 0 }, txns24h: { buys: 0, sells: 0 }, source: "dexscreener",
});

describe("Grid agent", () => {
  it("sells a slice when price climbs a level and buys it back below target", async () => {
    const { GridAgent } = await import("../src/agents/grid.js");
    const { Ledger } = await import("../src/core/ledger.js");
    const { Store } = await import("../src/data/store.js");
    const { MarketData } = await import("../src/data/market.js");
    const g = new GridAgent(); g.init();
    const ledger = new Ledger(new Store(dir));
    const market = new MarketData(new Store(dir));
    const base = 2e-6;
    expect(await g.propose({ snap: mk(base), market, ledger, intel: null })).toHaveLength(0); // anchors
    const up = base * (1 + g.spacing) * 1.001;
    const sells = await g.propose({ snap: mk(up), market, ledger, intel: null });
    expect(sells).toHaveLength(1);
    expect(sells[0].side).toBe("SELL_DOT");
    expect(sells[0].size.dot).toBeCloseTo(30_000 / g.levels, 3);
    // simulate fill
    const dot = sells[0].size.dot!;
    ledger.recordFill({ ts: 1, agent: "grid", side: "SELL_DOT", dot, eth: dot * up, usd: 1, priceUsd: 1, feesUsd: 0, paper: true, tag: sells[0].tag, reason: "" });
    g.onFill(sells[0].tag);
    // same price: no new sell (level filled), no buy (target not met)
    expect(await g.propose({ snap: mk(up), market, ledger, intel: null })).toHaveLength(0);
    // drop below target: buy-back proposed for the lot
    const buys = await g.propose({ snap: mk(up * 0.96), market, ledger, intel: null });
    expect(buys).toHaveLength(1);
    expect(buys[0].side).toBe("BUY_DOT");
    expect(buys[0].tag).toBe(sells[0].tag);
  });
});
