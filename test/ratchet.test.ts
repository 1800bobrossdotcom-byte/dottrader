import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { MarketSnapshot } from "../src/core/types.js";

// config is a module-level singleton read at import time, so DATA_DIR must be fixed before any import
// and the directory wiped between tests instead.
const dir = mkdtempSync(path.join(tmpdir(), "dottrader-"));
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
  const ledger = new Ledger(store);
  return { snap: snap(priceEth), market: new MarketData(store), ledger, intel: null };
}

describe("grid ratchet", () => {
  it("refuses to sell below the last buy-back, then allows it again above", async () => {
    const { GridAgent } = await import("../src/agents/grid.js");
    const g = new GridAgent();
    g.init();

    // A completed round trip: bought back at 2.0e-6, so the grid must not sell cheaper than that.
    g.onLotClosed("grid:1:1", 2.0e-6);

    // The failure we saw live: price collapses, the grid re-anchors low, then a bounce clears grid
    // level 1 and it sells well below the last buy-back. The ratchet must block that sell.
    let ctx = await ctxFor(1.9e-6);
    await g.propose(ctx); // anchors low
    ctx = await ctxFor(1.9e-6 * 1.04); // 1.976e-6: clears level 1 but is under the 2.0e-6 floor
    const blocked = await g.propose(ctx);
    expect(blocked.filter((x) => x.side === "SELL_DOT")).toHaveLength(0);

    // Back above the last buy-back, selling is allowed again.
    ctx = await ctxFor(2.1e-6);
    const allowed = await g.propose(ctx);
    expect(allowed.filter((x) => x.side === "SELL_DOT")).toHaveLength(1);
  });

  it("never ladders a new sell below a slice it already has open", async () => {
    const { GridAgent } = await import("../src/agents/grid.js");
    const g = new GridAgent();
    g.init();
    const base = 2.4e-6;

    let ctx = await ctxFor(base);
    await g.propose(ctx); // anchor
    ctx = await ctxFor(base * 1.04);
    const sells = await g.propose(ctx);
    expect(sells).toHaveLength(1);
    const dot = sells[0].size.dot!;
    const sellPrice = ctx.snap.priceEth;
    ctx.ledger.recordFill({
      ts: 1, agent: "grid", side: "SELL_DOT", dot, eth: dot * sellPrice, usd: 1, priceUsd: 1,
      feesUsd: 0, paper: true, tag: sells[0].tag, reason: "",
    });
    g.onFill(sells[0].tag);

    // Price halves. With a lot open at sellPrice, no further sell may happen below it.
    ctx = await ctxFor(sellPrice * 0.5);
    await g.propose(ctx);
    ctx = await ctxFor(sellPrice * 0.5 * 1.04);
    const after = await g.propose(ctx);
    expect(after.filter((x) => x.side === "SELL_DOT")).toHaveLength(0);
  });

  it("still buys back even when the price is under the ratchet floor", async () => {
    const { GridAgent } = await import("../src/agents/grid.js");
    const g = new GridAgent();
    g.init();
    g.onLotClosed("grid:9:9", 5e-6); // a very high floor

    const ctx = await ctxFor(2.4e-6);
    ctx.ledger.recordFill({
      ts: 1, agent: "grid", side: "SELL_DOT", dot: 1000, eth: 1000 * 2.6e-6, usd: 1, priceUsd: 1,
      feesUsd: 0, paper: true, tag: "grid:1:1", reason: "",
    });
    // 2.4e-6 is ~7.7% below the 2.6e-6 sell, so the buy-back target is met and must be proposed.
    const out = await g.propose(ctx);
    expect(out.filter((x) => x.side === "BUY_DOT")).toHaveLength(1);
  });
});

describe("ledger reconciliation with the chain", () => {
  it("releases lots whose ETH was spent outside the bot, without crediting bot profit", async () => {
    const { Ledger } = await import("../src/core/ledger.js");
    const { Store } = await import("../src/data/store.js");
    const L = new Ledger(new Store(dir));

    // Two sells park 0.02 ETH in total.
    L.recordFill({ ts: 1, agent: "grid", side: "SELL_DOT", dot: 4000, eth: 0.01, usd: 1, priceUsd: 1, feesUsd: 0, paper: true, tag: "grid:1:1", reason: "" });
    L.recordFill({ ts: 2, agent: "grid", side: "SELL_DOT", dot: 4000, eth: 0.01, usd: 1, priceUsd: 1, feesUsd: 0, paper: true, tag: "grid:2:2", reason: "" });
    expect(L.state.openLots).toHaveLength(2);
    const earnedBefore = L.totalDotEarned();

    // A manual swap leaves only 0.0104 ETH on chain; 0.002 is the gas reserve, so 0.0084 is
    // spendable against 0.02 claimed. That gap clears the 3% tolerance, so it is closed in full.
    const recs = L.reconcileWithChain(0.0104);
    expect(recs).toHaveLength(2);
    // Oldest first: the missing ETH cannot belong to a slice whose proceeds just arrived.
    expect(recs[0].lotId).toBe("grid:1:1");
    expect(recs[0].dropped).toBe(true);
    expect(recs[1].lotId).toBe("grid:2:2");
    expect(recs[1].dropped).toBe(false); // only shrank, so its grid level must stay closed
    expect(L.state.openLots).toHaveLength(1);
    expect(L.state.openLots[0].id).toBe("grid:2:2");
    // Released DOT is never counted as the bot earning anything.
    expect(L.totalDotEarned()).toBeCloseTo(earnedBefore, 9);
    expect(L.reconciliations()).toHaveLength(2);

    // Idempotent: with the books now matching the chain, nothing further is released.
    expect(L.reconcileWithChain(0.0104)).toHaveLength(0);
  });

  it("ignores the ordinary gas drift that made the grid dump its stack", async () => {
    const { Ledger } = await import("../src/core/ledger.js");
    const { Store } = await import("../src/data/store.js");
    const L = new Ledger(new Store(dir));
    // Three sells park 0.03 ETH gross. The wallet holds slightly less because each swap burned gas —
    // no ETH left for anything else. Reconciling here used to shrink the newest lot every tick, free
    // its grid level and let the grid re-sell the same slice indefinitely.
    for (const i of [1, 2, 3]) {
      L.recordFill({ ts: i, agent: "grid", side: "SELL_DOT", dot: 4000, eth: 0.01, usd: 1, priceUsd: 1, feesUsd: 0, paper: true, tag: `grid:${i}:${i}`, reason: "" });
    }
    // 0.0299 gross-minus-gas, plus the 0.002 reserve still sitting in the wallet.
    expect(L.reconcileWithChain(0.0319)).toHaveLength(0);
    expect(L.state.openLots).toHaveLength(3);
    // A real external spend still gets caught.
    expect(L.reconcileWithChain(0.020).length).toBeGreaterThan(0);
  });

  it("attributes hand-traded DOT separately from the bot's own fills", async () => {
    const { Ledger } = await import("../src/core/ledger.js");
    const { Store } = await import("../src/data/store.js");
    const L = new Ledger(new Store(dir));
    // Bot sells 4,000 DOT; wallet should hold 26,000.
    L.recordFill({ ts: 1, agent: "grid", side: "SELL_DOT", dot: 4000, eth: 0.01, usd: 1, priceUsd: 1, feesUsd: 0, paper: true, tag: "grid:1:1", reason: "" });
    expect(L.botDotDelta()).toBeCloseTo(-4000, 6);
    // Chain shows 31,000: someone bought 5,000 DOT by hand.
    expect(L.manualDotDelta(31_000)).toBeCloseTo(5_000, 6);
    // Chain matches the bot exactly: no manual activity.
    expect(L.manualDotDelta(26_000)).toBeCloseTo(0, 6);
  });
});
