import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config, DOT } from "./core/config.js";
import type { MarketSnapshot } from "./core/types.js";
import type { Swarm } from "./swarm.js";
import { Store } from "./data/store.js";
import { getTrackedPortfolios } from "./core/chain.js";
import type { Sweep } from "./core/ledger.js";

export interface Stats {
  generatedAt: string;
  mode: "paper" | "live";
  wallet: string;
  token: { symbol: string; address: string; chain: string; links: typeof DOT.links };
  baseline: { startedAt: string; dot: number; eth: number; usdc: number; priceUsd: number; usd: number } | null;
  vault: { address: string; sweptDot: number; unsweptEarned: number; sweeps: Sweep[] };
  wallets: { address: string; dot: number; eth: number; usdc: number; role: "vault" | "trading" }[];
  onchain: { dot: number; eth: number; usdc: number; dotEquivalent: number } | null;
  now: { dot: number; eth: number; usdc: number; priceUsd: number; priceEth: number; ethUsd: number; usd: number; dotEquivalent: number };
  dotEarned: { total: number; pct: number; byAgent: Record<string, number> };
  openLots: { id: string; agent: string; dotSold: number; ethReceived: number; sellPriceEth: number; targetBuyPriceEth: number; ts: number }[];
  wins: JournalRow[];
  recentFills: { ts: number; agent: string; side: string; dot: number; usd: number; priceUsd: number; paper: boolean; txHash?: string; reason: string }[];
  equity: { t: number; dotEq: number; priceUsd: number }[];
  market: { liquidityUsd: number; volume24hUsd: number; change: MarketSnapshot["priceChange"]; txns24h: MarketSnapshot["txns24h"]; burns24h: number };
}
export interface JournalRow { ts: number; agent: string; lotId: string | null; dotSold: number; dotBought: number; dotEarned: number; sellPriceUsd: number | null; buyPriceUsd: number; holdHours: number; paper: boolean; txHash?: string }

export async function buildStats(swarm: Swarm, snap: MarketSnapshot): Promise<Stats> {
  const store = new Store();
  const L = swarm.ledger;
  const b = L.baseline;
  const p = L.state.portfolio;
  const journal = store.readLines<JournalRow>("journal.ndjson");
  const fills = L.fills().slice(-50).reverse();
  const snaps = store.readLines<MarketSnapshot>("snapshots.ndjson");
  // Equity curve: DOT-equivalent over time, sampled hourly from snapshots (paper: portfolio at that time is approximated by current).
  const byHour = new Map<number, MarketSnapshot>();
  for (const s of snaps) byHour.set(Math.floor(s.ts / 3.6e6), s);
  const equity = [...byHour.values()].slice(-24 * 30).map((s) => ({ t: s.ts, dotEq: L.dotEquivalent(s.priceEth), priceUsd: s.priceUsd }));
  const total = L.totalDotEarned();
  let wallets: Stats["wallets"] = [];
  let onchain: Stats["onchain"] = null;
  try {
    const tp = await getTrackedPortfolios();
    wallets = tp.wallets.map((w) => ({ ...w, role: w.address.toLowerCase() === config.VAULT_ADDRESS.toLowerCase() ? "vault" : "trading" }));
    onchain = { ...tp.total, dotEquivalent: tp.total.dot + (snap.priceEth > 0 ? tp.total.eth / snap.priceEth : 0) };
  } catch { /* RPC hiccup: leave wallets empty; the page handles it */ }
  return {
    generatedAt: new Date().toISOString(),
    mode: config.LIVE ? "live" : "paper",
    wallet: config.WALLET_ADDRESS,
    token: { symbol: DOT.symbol, address: DOT.address, chain: "Base", links: DOT.links },
    baseline: b ? { startedAt: b.startedAt, dot: b.dot, eth: b.eth, usdc: b.usdc, priceUsd: b.priceUsd, usd: b.dot * b.priceUsd + b.eth * b.ethUsd + b.usdc } : null,
    vault: { address: config.VAULT_ADDRESS, sweptDot: L.state.sweptDot ?? 0, unsweptEarned: L.state.unsweptEarned ?? 0, sweeps: L.sweeps().slice(-50).reverse() },
    wallets,
    onchain,
    now: { dot: p.dot, eth: p.eth, usdc: p.usdc, priceUsd: snap.priceUsd, priceEth: snap.priceEth, ethUsd: snap.ethUsd, usd: p.dot * snap.priceUsd + p.eth * snap.ethUsd + p.usdc, dotEquivalent: L.dotEquivalent(snap.priceEth) },
    dotEarned: { total, pct: b && b.dot > 0 ? (total / b.dot) * 100 : 0, byAgent: L.state.dotEarnedByAgent },
    openLots: L.state.openLots.map(({ id, agent, dotSold, ethReceived, sellPriceEth, targetBuyPriceEth, ts }) => ({ id, agent, dotSold, ethReceived, sellPriceEth, targetBuyPriceEth, ts })),
    wins: journal.slice(-100).reverse(),
    recentFills: fills.map(({ ts, agent, side, dot, usd, priceUsd, paper, txHash, reason }) => ({ ts, agent, side, dot, usd, priceUsd, paper, txHash, reason })),
    equity,
    market: { liquidityUsd: snap.liquidityUsd, volume24hUsd: snap.volume24hUsd, change: snap.priceChange, txns24h: snap.txns24h, burns24h: swarm.lastIntel?.burns24h ?? 0 },
  };
}

export async function writeReport(swarm: Swarm, snap: MarketSnapshot) {
  mkdirSync(config.SITE_DATA_DIR, { recursive: true });
  const stats = await buildStats(swarm, snap);
  writeFileSync(path.join(config.SITE_DATA_DIR, "stats.json"), JSON.stringify(stats, null, 2));
  return stats;
}
