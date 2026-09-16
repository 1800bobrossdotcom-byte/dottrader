import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config, DOT, JOURNEY } from "./core/config.js";
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
  baseline: { startedAt: string; dot: number; eth: number; usdc: number; priceUsd: number; usd: number; dotEquivalent: number; setupNote?: string } | null;
  vault: { address: string; sweptDot: number; unsweptEarned: number; sweeps: Sweep[] };
  wallets: { address: string; dot: number; eth: number; usdc: number; role: "vault" | "trading" }[];
  onchain: { dot: number; eth: number; usdc: number; dotEquivalent: number } | null;
  /** When the wallets/onchain figures were last read successfully (they are reused when the RPC hiccups). */
  onchainAt?: string;
  now: { dot: number; eth: number; usdc: number; priceUsd: number; priceEth: number; ethUsd: number; usd: number; dotEquivalent: number };
  dotEarned: { total: number; pct: number; byAgent: Record<string, number> };
  openLots: { id: string; agent: string; dotSold: number; ethReceived: number; sellPriceEth: number; targetBuyPriceEth: number; ts: number }[];
  wins: JournalRow[];
  recentFills: { ts: number; agent: string; side: string; dot: number; usd: number; priceUsd: number; paper: boolean; txHash?: string; reason: string }[];
  equity: { t: number; dotEq: number; priceUsd: number }[];
  /** Which trading wallets contributed to this (merged) file. */
  processes: string[];
  market: { liquidityUsd: number; volume24hUsd: number; change: MarketSnapshot["priceChange"]; txns24h: MarketSnapshot["txns24h"]; burns24h: number };
}
export interface JournalRow { ts: number; agent: string; lotId: string | null; dotSold: number; dotBought: number; dotEarned: number; sellPriceUsd: number | null; buyPriceUsd: number; holdHours: number; paper: boolean; txHash?: string }

export async function buildStats(swarm: Swarm, snap: MarketSnapshot): Promise<Stats> {
  const store = new Store();
  const L = swarm.ledger;
  void L.baseline;
  const p = L.state.portfolio;
  const journal = store.readLines<JournalRow>("journal.ndjson");
  const fills = L.fills().slice(-50).reverse();
  const snaps = store.readLines<MarketSnapshot>("snapshots.ndjson");
  const total = L.totalDotEarned();
  let wallets: Stats["wallets"] = [];
  let onchain: Stats["onchain"] = null;
  let onchainAt: string | undefined;
  try {
    const tp = await getTrackedPortfolios();
    wallets = tp.wallets.map((w) => ({ ...w, role: w.address.toLowerCase() === config.VAULT_ADDRESS.toLowerCase() ? "vault" : "trading" }));
    onchain = { ...tp.total, dotEquivalent: tp.total.dot + (snap.priceEth > 0 ? tp.total.eth / snap.priceEth : 0) };
    onchainAt = new Date().toISOString();
  } catch {
    // RPC hiccup (public endpoints rate-limit): reuse the last successful read from this process's previous stats file.
    const prev = readPrevStats();
    if (prev?.wallets?.length) { wallets = prev.wallets; onchain = prev.onchain; onchainAt = prev.onchainAt; }
  }
  // Equity curve: the on-chain DOT-equivalent of ALL tracked wallets, appended by whichever process ticks. Shared across processes.
  mkdirSync(config.SITE_DATA_DIR, { recursive: true });
  const eqFile = path.join(config.SITE_DATA_DIR, "equity.ndjson");
  if (onchain) appendFileSync(eqFile, JSON.stringify({ t: snap.ts, dotEq: onchain.dotEquivalent, priceUsd: snap.priceUsd }) + "\n");
  const equity = readEquity(eqFile);
  void snaps;
  return {
    generatedAt: new Date().toISOString(),
    mode: config.LIVE ? "live" : "paper",
    wallet: config.WALLET_ADDRESS,
    token: { symbol: DOT.symbol, address: DOT.address, chain: "Base", links: DOT.links },
    baseline: {
      startedAt: JOURNEY.startedAt, dot: JOURNEY.dot, eth: JOURNEY.eth, usdc: JOURNEY.usdc, priceUsd: JOURNEY.priceUsd,
      usd: JOURNEY.dot * JOURNEY.priceUsd + JOURNEY.eth * JOURNEY.ethUsd + JOURNEY.usdc,
      // ETH and USDC held at the start count as the DOT they could have bought that day, so start and now compare like for like.
      dotEquivalent: JOURNEY.dot + (JOURNEY.eth * JOURNEY.ethUsd + JOURNEY.usdc) / JOURNEY.priceUsd,
      setupNote: JOURNEY.setupNote,
    },
    vault: { address: config.VAULT_ADDRESS, sweptDot: L.state.sweptDot ?? 0, unsweptEarned: L.state.unsweptEarned ?? 0, sweeps: L.sweeps().slice(-50).reverse() },
    wallets,
    onchain,
    onchainAt,
    now: { dot: p.dot, eth: p.eth, usdc: p.usdc, priceUsd: snap.priceUsd, priceEth: snap.priceEth, ethUsd: snap.ethUsd, usd: p.dot * snap.priceUsd + p.eth * snap.ethUsd + p.usdc, dotEquivalent: L.dotEquivalent(snap.priceEth) },
    dotEarned: { total, pct: (total / JOURNEY.dot) * 100, byAgent: L.state.dotEarnedByAgent },
    openLots: L.state.openLots.map(({ id, agent, dotSold, ethReceived, sellPriceEth, targetBuyPriceEth, ts }) => ({ id, agent, dotSold, ethReceived, sellPriceEth, targetBuyPriceEth, ts })),
    wins: journal.slice(-100).reverse(),
    recentFills: fills.map(({ ts, agent, side, dot, usd, priceUsd, paper, txHash, reason }) => ({ ts, agent, side, dot, usd, priceUsd, paper, txHash, reason })),
    equity,
    processes: [config.WALLET_ADDRESS],
    market: { liquidityUsd: snap.liquidityUsd, volume24hUsd: snap.volume24hUsd, change: snap.priceChange, txns24h: snap.txns24h, burns24h: swarm.lastIntel?.burns24h ?? 0 },
  };
}

function readPrevStats(): Stats | null {
  const f = path.join(config.SITE_DATA_DIR, `stats.${config.WALLET_ADDRESS.toLowerCase()}.json`);
  if (!existsSync(f)) return null;
  try { return JSON.parse(readFileSync(f, "utf8")) as Stats; } catch { return null; }
}

/** Hourly-deduped equity points, most recent 30 days. */
function readEquity(file: string) {
  if (!existsSync(file)) return [];
  const byHour = new Map<number, { t: number; dotEq: number; priceUsd: number }>();
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line) continue;
    try { const p = JSON.parse(line); byHour.set(Math.floor(p.t / 3.6e6), p); } catch { /* skip bad line */ }
  }
  return [...byHour.values()].sort((a, b) => a.t - b.t).slice(-24 * 30);
}

/**
 * Each swarm process writes stats.<wallet>.json, then stats.json is rebuilt as the merge of every
 * per-wallet file. Two trading wallets therefore show up as one journal on dottrader.app.
 */
export async function writeReport(swarm: Swarm, snap: MarketSnapshot) {
  mkdirSync(config.SITE_DATA_DIR, { recursive: true });
  const mine = await buildStats(swarm, snap);
  writeFileSync(path.join(config.SITE_DATA_DIR, `stats.${config.WALLET_ADDRESS.toLowerCase()}.json`), JSON.stringify(mine, null, 2));
  const parts: Stats[] = readdirSync(config.SITE_DATA_DIR)
    .filter((f) => /^stats\.0x[0-9a-f]{40}\.json$/.test(f))
    .map((f) => { try { return JSON.parse(readFileSync(path.join(config.SITE_DATA_DIR, f), "utf8")) as Stats; } catch { return null; } })
    .filter((x): x is Stats => !!x);
  const merged = mergeStats(parts.length ? parts : [mine]);
  writeFileSync(path.join(config.SITE_DATA_DIR, "stats.json"), JSON.stringify(merged, null, 2));
  return merged;
}

export function mergeStats(parts: Stats[]): Stats {
  const byFreshness = [...parts].sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt));
  const fresh = byFreshness[0];
  // Wallet balances: take them from whichever process most recently read the chain successfully.
  const withChain = byFreshness.filter((p) => p.wallets?.length).sort((a, b) => Date.parse(b.onchainAt ?? b.generatedAt) - Date.parse(a.onchainAt ?? a.generatedAt))[0];
  const byAgent: Record<string, number> = {};
  for (const p of parts) for (const [k, v] of Object.entries(p.dotEarned.byAgent)) byAgent[k] = (byAgent[k] ?? 0) + v;
  const total = Object.values(byAgent).reduce((a, b) => a + b, 0);
  const byTs = <T extends { ts: number }>(xs: T[]) => xs.sort((a, b) => b.ts - a.ts);
  return {
    ...fresh,
    mode: parts.some((p) => p.mode === "live") ? "live" : "paper",
    processes: parts.map((p) => p.wallet),
    wallets: withChain?.wallets ?? [],
    onchain: withChain?.onchain ?? null,
    onchainAt: withChain?.onchainAt,
    dotEarned: { total, pct: fresh.baseline && fresh.baseline.dot > 0 ? (total / fresh.baseline.dot) * 100 : 0, byAgent },
    openLots: byTs(parts.flatMap((p) => p.openLots)),
    wins: byTs(parts.flatMap((p) => p.wins)).slice(0, 100),
    recentFills: byTs(parts.flatMap((p) => p.recentFills)).slice(0, 50),
    vault: {
      address: fresh.vault.address,
      sweptDot: parts.reduce((a, p) => a + p.vault.sweptDot, 0),
      unsweptEarned: parts.reduce((a, p) => a + p.vault.unsweptEarned, 0),
      sweeps: byTs(parts.flatMap((p) => p.vault.sweeps)).slice(0, 50),
    },
    now: {
      ...fresh.now,
      // "now" wallet numbers are per-process; the site uses onchain totals for the stack, so sum the paper portfolios here for completeness.
      dot: parts.reduce((a, p) => a + p.now.dot, 0),
      eth: parts.reduce((a, p) => a + p.now.eth, 0),
      usdc: parts.reduce((a, p) => a + p.now.usdc, 0),
      usd: parts.reduce((a, p) => a + p.now.usd, 0),
      dotEquivalent: parts.reduce((a, p) => a + p.now.dotEquivalent, 0),
    },
  };
}
