import { DOT } from "../core/config.js";
import type { Candle, MarketSnapshot } from "../core/types.js";
import { getPoolState } from "../core/chain.js";
import { Store } from "./store.js";
import { log } from "../core/log.js";

const DS_URL = `https://api.dexscreener.com/token-pairs/v1/base/${DOT.address}`;

interface DsPair {
  pairAddress: string; priceUsd: string; priceNative: string;
  liquidity?: { usd?: number }; volume: { h24: number };
  priceChange: { m5?: number; h1?: number; h6?: number; h24?: number };
  txns: { h24: { buys: number; sells: number } };
}

export async function fetchDexScreener(): Promise<MarketSnapshot> {
  const res = await fetch(DS_URL, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`dexscreener ${res.status}`);
  const pairs = (await res.json()) as DsPair[];
  const main = pairs.find((p) => p.pairAddress.toLowerCase() === DOT.poolId) ?? pairs[0];
  if (!main) throw new Error("no DOT pair on dexscreener");
  const priceUsd = Number(main.priceUsd);
  const priceEth = Number(main.priceNative);
  return {
    ts: Date.now(),
    priceUsd,
    priceEth,
    ethUsd: priceEth > 0 ? priceUsd / priceEth : 0,
    liquidityUsd: main.liquidity?.usd ?? 0,
    volume24hUsd: main.volume.h24,
    priceChange: {
      m5: main.priceChange.m5 ?? 0, h1: main.priceChange.h1 ?? 0,
      h6: main.priceChange.h6 ?? 0, h24: main.priceChange.h24 ?? 0,
    },
    txns24h: main.txns.h24,
    source: "dexscreener",
  };
}

/**
 * Market data agent: blends DexScreener (USD, volume, liquidity) with the on-chain
 * V4 pool price (authoritative, un-lagged). Maintains 5-minute candles on disk so
 * strategies have history from the first minute the swarm runs.
 */
export class MarketData {
  candles: Candle[];
  last?: MarketSnapshot;
  private readonly bucketMs = 5 * 60_000;
  constructor(private store = new Store()) {
    this.candles = store.readJson<Candle[]>("candles-5m.json", []);
  }

  async tick(): Promise<MarketSnapshot> {
    let snap: MarketSnapshot;
    try {
      snap = await fetchDexScreener();
    } catch (e) {
      // Fall back to the last snapshot's USD context and on-chain price only.
      if (!this.last) throw e;
      snap = { ...this.last, ts: Date.now(), source: "onchain" };
    }
    try {
      const pool = await getPoolState();
      snap.tick = pool.tick;
      // On-chain price wins; DexScreener's ETH/USD is used to convert.
      if (snap.ethUsd > 0) {
        snap.priceEth = pool.ethPerDot;
        snap.priceUsd = pool.ethPerDot * snap.ethUsd;
        snap.source = snap.source === "dexscreener" ? "mixed" : "onchain";
      }
    } catch (e) {
      log("market", `on-chain read failed, using dexscreener only: ${(e as Error).message}`);
    }
    this.last = snap;
    this.pushCandle(snap);
    this.store.writeJson("candles-5m.json", this.candles.slice(-5000));
    this.store.append("snapshots.ndjson", snap);
    return snap;
  }

  pushCandle(s: MarketSnapshot) {
    const t = Math.floor(s.ts / this.bucketMs) * this.bucketMs;
    const last = this.candles[this.candles.length - 1];
    if (last && last.t === t) {
      last.h = Math.max(last.h, s.priceUsd); last.l = Math.min(last.l, s.priceUsd); last.c = s.priceUsd;
    } else {
      this.candles.push({ t, o: s.priceUsd, h: s.priceUsd, l: s.priceUsd, c: s.priceUsd, v: s.volume24hUsd / 288 });
    }
  }

  /** Simple helpers strategies lean on. */
  closes(n: number) { return this.candles.slice(-n).map((c) => c.c); }
  vwap(n: number) {
    const cs = this.candles.slice(-n);
    const v = cs.reduce((a, c) => a + c.v, 0);
    return v > 0 ? cs.reduce((a, c) => a + c.c * c.v, 0) / v : mean(cs.map((c) => c.c));
  }
  zscore(n: number) {
    const xs = this.closes(n);
    if (xs.length < 6) return 0;
    const m = mean(xs);
    const sd = Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length);
    return sd > 0 ? (xs[xs.length - 1] - m) / sd : 0;
  }
  /** Realised volatility of 5m log returns over n candles, annualised-ish (per day). */
  realisedVolDaily(n: number) {
    const xs = this.closes(n);
    if (xs.length < 6) return 0;
    const r = xs.slice(1).map((x, i) => Math.log(x / xs[i]));
    const m = mean(r);
    const sd = Math.sqrt(r.reduce((a, x) => a + (x - m) ** 2, 0) / r.length);
    return sd * Math.sqrt(288);
  }
}

export function mean(xs: number[]) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
