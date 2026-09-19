import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { MarketSnapshot } from "../src/core/types.js";

// config is a module-level singleton read at import time, so DATA_DIR must be fixed before any import.
const dir = mkdtempSync(path.join(tmpdir(), "dottrader-2s-"));
process.env.DATA_DIR = dir;
process.env.LIVE = "0";
process.env.TRADING_SLEEVE = "1";
process.env.GRID_SPACING_PCT = "3.5";
process.env.GRID_EDGE_PCT = "3";
process.env.GAS_RESERVE_ETH = "0.002";

beforeEach(() => {
  for (const f of readdirSync(dir)) rmSync(path.join(dir, f), { force: true, recursive: true });
  writeFileSync(path.join(dir, "baseline.json"), JSON.stringify({
    startedAt: "", wallet: "0x", dot: 30_000, eth: 0.05, usdc: 0, priceUsd: 0.005, ethUsd: 2400, note: "",
  }));
});

const snap = (priceEth: number): MarketSnapshot => ({
  ts: Date.now(), priceUsd: priceEth * 2400, priceEth, ethUsd: 2400, liquidityUsd: 400_000, volume24hUsd: 1,
  priceChange: { m5: 0, h1: 0, h6: 0, h24: 0 }, txns24h: { buys: 0, sells: 0 }, source: "dexscreener",
});

async function ctxFor(priceEth: number) {
  const { Ledger } = await import("../src/core/ledger.js");
  const { Store } = await import("../src/data/store.js");
  const { MarketData } = await import("../src/data/market.js");
  const store = new Store(dir);
  return { snap: snap(priceEth), market: new MarketData(store), ledger: new Ledger(store), intel: null };
}

describe("two-sided grid", () => {
  it("buys a dip with idle ETH and sells it back above the fee floor", async () => {
    const { GridAgent } = await import("../src/agents/grid.js");
    const g = new GridAgent();
    g.init();
    const base = 2.4e-6;

    let ctx = await ctxFor(base);
    await g.propose(ctx); // anchor here

    // Price falls through the first buy rung (-3.5%): idle ETH should buy.
    ctx = await ctxFor(base * 0.96);
    const buys = (await g.propose(ctx)).filter((s) => s.side === "BUY_DOT");
    expect(buys).toHaveLength(1);
    expect(buys[0].tag).toMatch(/^gridlong:/);

    // Record the fill; it must open a LONG lot, not a short one.
    const price = ctx.snap.priceEth;
    const dot = (buys[0].size.usd ?? 0) / ctx.snap.priceUsd;
    ctx.ledger.recordFill({
      ts: 1, agent: "grid", side: "BUY_DOT", dot, eth: dot * price, usd: 1, priceUsd: ctx.snap.priceUsd,
      feesUsd: 0, paper: true, tag: buys[0].tag, reason: "",
    });
    g.onFill(buys[0].tag);
    expect(ctx.ledger.state.openLots).toHaveLength(1);
    expect(ctx.ledger.state.openLots[0].side).toBe("long");
    // A long lot parks no ETH, so it must not reserve any against future buys.
    expect(ctx.ledger.state.openLots[0].ethReceived).toBe(0);

    // Below the fee floor the lot stays open; above it, the grid sells it back.
    ctx = await ctxFor(price * 1.01);
    expect((await g.propose(ctx)).filter((s) => s.side === "SELL_DOT" && s.tag?.startsWith("gridlong:"))).toHaveLength(0);
    ctx = await ctxFor(price * 1.04);
    const closes = (await g.propose(ctx)).filter((s) => s.tag?.startsWith("gridlong:"));
    expect(closes).toHaveLength(1);
    expect(closes[0].side).toBe("SELL_DOT");
  });

  it("never spends ETH a short lot has already promised to a buy-back", async () => {
    const { Ledger } = await import("../src/core/ledger.js");
    const { Store } = await import("../src/data/store.js");
    const L = new Ledger(new Store(dir));
    L.syncPortfolio({ dot: 30_000, eth: 0.05, usdc: 0 });
    // 0.05 ETH on chain, 0.002 reserved for gas: 0.048 is free while nothing is open.
    expect(L.unreservedEth).toBeCloseTo(0.048, 9);

    // A sell parks 0.03 ETH against a future buy-back; only the remainder may open a long lot.
    L.recordFill({ ts: 1, agent: "grid", side: "SELL_DOT", dot: 10_000, eth: 0.03, usd: 1, priceUsd: 1, feesUsd: 0, paper: true, tag: "grid:1:1", reason: "" });
    L.syncPortfolio({ dot: 20_000, eth: 0.08, usdc: 0 });
    expect(L.unreservedEth).toBeCloseTo(0.08 - 0.002 - 0.03, 9);
  });

  it("scores a long round trip by the ETH it gained, not the DOT it moved", async () => {
    const { Ledger } = await import("../src/core/ledger.js");
    const { Store } = await import("../src/data/store.js");
    const L = new Ledger(new Store(dir));
    // Buy 5,000 DOT for 0.010 ETH (2.0e-6), sell it back for 0.011 ETH (2.2e-6).
    L.recordFill({ ts: 1, agent: "grid", side: "BUY_DOT", dot: 5000, eth: 0.010, usd: 1, priceUsd: 1, feesUsd: 0, paper: true, tag: "gridlong:1:1", reason: "" });
    const before = L.totalDotEarned();
    L.recordFill({ ts: 2, agent: "grid", side: "SELL_DOT", dot: 5000, eth: 0.011, usd: 1, priceUsd: 1, feesUsd: 0, paper: true, tag: "gridlong:1:1", reason: "" });
    // 0.001 ETH gained at 2.2e-6 ETH/DOT is ~455 DOT-equivalent. The DOT count itself is unchanged.
    expect(L.totalDotEarned() - before).toBeCloseTo(0.001 / 2.2e-6, 0);
    expect(L.state.openLots).toHaveLength(0);
  });

  it("leaves a long lot alone when reconciling ETH against the chain", async () => {
    const { Ledger } = await import("../src/core/ledger.js");
    const { Store } = await import("../src/data/store.js");
    const L = new Ledger(new Store(dir));
    L.recordFill({ ts: 1, agent: "grid", side: "BUY_DOT", dot: 5000, eth: 0.010, usd: 1, priceUsd: 1, feesUsd: 0, paper: true, tag: "gridlong:1:1", reason: "" });
    // A long lot holds DOT, not ETH, so an empty ETH balance says nothing about it.
    expect(L.reconcileWithChain(0)).toHaveLength(0);
    expect(L.state.openLots).toHaveLength(1);
  });
});
