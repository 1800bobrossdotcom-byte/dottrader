import { describe, it, expect } from "vitest";
import { mergeStats, type Stats } from "../src/report.js";

const base = (over: Partial<Stats>): Stats => ({
  generatedAt: "2026-09-16T23:00:00Z", mode: "live", wallet: "0xa",
  token: { symbol: "DOT", address: "0x", chain: "Base", links: { site: "", docs: "", dexscreener: "", basescan: "" } },
  baseline: null, journeyStackNow: null, vault: { address: "0xv", sweptDot: 0, unsweptEarned: 0, sweeps: [] }, wallets: [], onchain: null,
  now: { dot: 1, eth: 0, usdc: 0, priceUsd: 1, priceEth: 1, ethUsd: 1, usd: 1, dotEquivalent: 1 },
  dotEarned: { total: 0, pct: 0, byAgent: {} }, openLots: [], wins: [], recentFills: [], equity: [], processes: ["0xa"],
  market: { liquidityUsd: 0, volume24hUsd: 0, change: { m5: 0, h1: 0, h6: 0, h24: 0 }, txns24h: { buys: 0, sells: 0 }, burns24h: 0 },
  ...over,
});

describe("mergeStats", () => {
  it("keeps wallet balances from the process that last read the chain, even if a fresher process failed", () => {
    const failed = base({ generatedAt: "2026-09-16T23:10:00Z", wallet: "0xb", wallets: [], onchain: null });
    const good = base({ generatedAt: "2026-09-16T23:09:00Z", wallets: [{ address: "0xv", dot: 9000, eth: 0, usdc: 0, role: "vault" }], onchain: { dot: 9000, eth: 0, usdc: 0, dotEquivalent: 9000 }, onchainAt: "2026-09-16T23:09:00Z", journeyStackNow: 12345 });
    const m = mergeStats([failed, good]);
    expect(m.generatedAt).toBe(failed.generatedAt);
    expect(m.wallets).toHaveLength(1);
    expect(m.onchain?.dot).toBe(9000);
    expect(m.processes).toEqual(["0xb", "0xa"]);
    expect(m.journeyStackNow).toBe(12345);
  });
});
