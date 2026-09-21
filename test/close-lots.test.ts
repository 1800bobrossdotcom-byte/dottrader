import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Fill, MarketSnapshot } from "../src/core/types.js";

// config is a module-level singleton read at import time, so the env must be fixed before any import.
const dir = mkdtempSync(path.join(tmpdir(), "dottrader-"));
process.env.DATA_DIR = dir;
process.env.LIVE = "0";
process.env.TRADING_SLEEVE = "1";
process.env.GRID_SPACING_PCT = "3.5";
process.env.GRID_EDGE_PCT = "3";
process.env.GAS_RESERVE_ETH = "0.002";
process.env.GRID_ALLOW_NEW_SHORTS = "0";

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

const sell = (dot: number, eth: number, tag: string): Fill => ({
  ts: Date.now(), agent: "grid", side: "SELL_DOT", dot, eth, usd: eth * 2400,
  priceUsd: (eth / dot) * 2400, feesUsd: 0, paper: true, tag, reason: "test sell",
});

const buy = (dot: number, eth: number, tag: string): Fill => ({
  ts: Date.now(), agent: "grid", side: "BUY_DOT", dot, eth, usd: eth * 2400,
  priceUsd: (eth / dot) * 2400, feesUsd: 0, paper: true, tag, reason: "test buy",
});

async function freshLedger() {
  const { Ledger } = await import("../src/core/ledger.js");
  const { Store } = await import("../src/data/store.js");
  return new Ledger(new Store(dir));
}

describe("closing an exact lot", () => {
  it("closes the lot at the given index when two lots share an id", async () => {
    const L = await freshLedger();
    // The grid tags by level and second, so two slices filled in the same second collide.
    L.recordFill(sell(1_000, 0.002, "grid:1:100"));
    L.recordFill(sell(4_000, 0.008, "grid:1:100"));
    expect(L.state.openLots).toHaveLength(2);

    // Close the SECOND one explicitly. A tag lookup alone would have unwound the first.
    L.recordFill(buy(3_500, 0.008, "grid:1:100"), 1);

    expect(L.state.openLots).toHaveLength(1);
    expect(L.state.openLots[0].dotSold).toBe(1_000);
    // Bought back 3,500 against 4,000 sold: a 500 DOT loss, recorded honestly.
    expect(L.totalDotEarned()).toBeCloseTo(-500, 6);
  });

  it("falls back to the tag when no index is given", async () => {
    const L = await freshLedger();
    L.recordFill(sell(1_000, 0.002, "grid:1:100"));
    L.recordFill(sell(4_000, 0.008, "grid:2:200"));

    L.recordFill(buy(1_200, 0.002, "grid:1:100"));

    expect(L.state.openLots).toHaveLength(1);
    expect(L.state.openLots[0].dotSold).toBe(4_000);
    expect(L.totalDotEarned()).toBeCloseTo(200, 6);
  });

  it("ignores an index that points at no open short lot", async () => {
    const L = await freshLedger();
    L.recordFill(sell(1_000, 0.002, "grid:1:100"));

    // Index past the end: fall back to the tag rather than throwing or booking fresh capital.
    L.recordFill(buy(1_200, 0.002, "grid:1:100"), 7);

    expect(L.state.openLots).toHaveLength(0);
    expect(L.totalDotEarned()).toBeCloseTo(200, 6);
  });
});

describe("GRID_ALLOW_NEW_SHORTS=0", () => {
  it("stops opening new short lots but still buys existing ones back", async () => {
    const { GridAgent } = await import("../src/agents/grid.js");
    const { MarketData } = await import("../src/data/market.js");
    const { Store } = await import("../src/data/store.js");
    const store = new Store(dir);
    const L = await freshLedger();
    const g = new GridAgent();
    g.init();

    // Anchor low, then run price far above every sell level.
    let ctx = { snap: snap(2.0e-6), market: new MarketData(store), ledger: L, intel: null };
    await g.propose(ctx);
    ctx = { snap: snap(4.0e-6), market: new MarketData(store), ledger: L, intel: null };
    const sells = await g.propose(ctx);
    expect(sells.filter((s) => s.side === "SELL_DOT")).toHaveLength(0);

    // An open lot whose target is met must still be bought back — the flag only blocks new shorts.
    L.recordFill(sell(1_000, 0.003, "grid:1:100"));
    const target = L.state.openLots[0].targetBuyPriceEth;
    ctx = { snap: snap(target * 0.99), market: new MarketData(store), ledger: L, intel: null };
    const buys = await g.propose(ctx);
    expect(buys.filter((s) => s.side === "BUY_DOT" && s.tag === "grid:1:100")).toHaveLength(1);
  });
});
