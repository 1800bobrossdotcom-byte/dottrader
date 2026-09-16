/** Shared message types that flow across the swarm bus. */

export type Side = "BUY_DOT" | "SELL_DOT";

export interface MarketSnapshot {
  ts: number;
  /** DOT price in USD */
  priceUsd: number;
  /** DOT price in ETH */
  priceEth: number;
  ethUsd: number;
  liquidityUsd: number;
  volume24hUsd: number;
  priceChange: { m5: number; h1: number; h6: number; h24: number };
  txns24h: { buys: number; sells: number };
  /** Uniswap V4 slot0 tick for the main pool, if read on-chain */
  tick?: number;
  source: "dexscreener" | "onchain" | "mixed";
}

export interface Candle {
  t: number; // bucket start (ms)
  o: number; h: number; l: number; c: number;
  v: number; // usd volume proxy
}

export interface Signal {
  agent: string;
  side: Side;
  /** 0..1 how strongly the agent wants this */
  conviction: number;
  /** Amount of DOT to sell, or USD-equivalent of ETH to spend buying DOT */
  size: { dot?: number; usd?: number };
  reason: string;
  /** Optional tag used for pairing entries/exits (e.g. grid level) */
  tag?: string;
}

export interface IntelReport {
  ts: number;
  burns24h: number; // DOT burned in the lookback
  burnsTotalObserved: number;
  netFlow1h: number; // buys - sells count in the last hour
  buyPressure: number; // 0..1
  bigBuysUsd24h: number;
}

export interface Fill {
  ts: number;
  agent: string;
  side: Side;
  dot: number;
  eth: number;
  usd: number;
  priceUsd: number;
  feesUsd: number;
  txHash?: string;
  paper: boolean;
  tag?: string;
  reason: string;
}

export interface Portfolio {
  dot: number;
  eth: number;
  usdc: number;
}
