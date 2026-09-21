/**
 * Runs the swing engine against live on-chain prices without money.
 *
 * The backtest said cbBTC/WETH returns ~32% over 3.5 days at a 0.5% threshold. That number comes
 * from 5-minute candles, triggering off their highs and lows — which assumes every fill caught the
 * extreme of its bar. Real fills are worse, and one 3.5-day sample of a pair that happened to
 * oscillate is not evidence of an edge. So this walks forward on live prices and records what it
 * would actually have done, and the answer is worth having before any capital is committed.
 *
 *   npx tsx src/cli/swing-paper.ts                        # cbbtc-weth, 0.5%, every 20s
 *   npx tsx src/cli/swing-paper.ts --threshold 0.3 --every 10
 */
import { createPublicClient, http, parseAbi, type Address } from "viem";
import { base } from "viem/chains";
import { config } from "../core/config.js";
import { log } from "../core/log.js";
import { MARKETS, priceFromSqrtX96, type Market } from "../core/markets.js";
import { freshSwing, step, feeFloorPct, type SwingState, type SwingTrade } from "../agents/swing.js";
import { Store } from "../data/store.js";

const poolAbi = parseAbi(["function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 a, uint16 b, uint16 c, uint32 d, bool e)"]);
const client = createPublicClient({ chain: base, transport: http(config.BASE_RPC_URL) });

function flag(n: string, d: number) {
  const i = process.argv.findIndex((a) => a === `--${n}` || a.startsWith(`--${n}=`));
  if (i < 0) return d;
  const v = process.argv[i].includes("=") ? process.argv[i].split("=")[1] : process.argv[i + 1];
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}

interface Persisted { market: string; thresholdPct: number; startedAt: string; startQuote: number; swing: SwingState; log: (SwingTrade & { ts: number })[] }

async function price(m: Market) {
  const [sqrtPriceX96] = await client.readContract({ address: m.pool as Address, abi: poolAbi, functionName: "slot0" });
  return priceFromSqrtX96(sqrtPriceX96, m);
}

async function main() {
  const key = process.argv.includes("--market") ? process.argv[process.argv.indexOf("--market") + 1] : "cbbtc-weth";
  const m = MARKETS[key];
  if (!m) { console.error(`unknown market ${key}; have: ${Object.keys(MARKETS).join(", ")}`); process.exit(1); }

  const thresholdPct = flag("threshold", 1.2);
  const everySec = flag("every", 20);
  const floor = feeFloorPct(m.feePct);
  const store = new Store();
  const file = `swing-${m.key}.json`;

  let st = store.readJson<Persisted | null>(file, null);
  if (!st || st.thresholdPct !== thresholdPct) {
    // Start from 1 unit of the quote token so returns read as a percentage.
    st = { market: m.key, thresholdPct, startedAt: new Date().toISOString(), startQuote: 1, swing: freshSwing(1), log: [] };
  }

  const quoteSym = (m.quote === "token0" ? m.token0 : m.token1).symbol;
  const baseSym = (m.quote === "token0" ? m.token1 : m.token0).symbol;
  log("swing", `PAPER ${baseSym}/${quoteSym} — threshold ${thresholdPct}% (fee floor ${floor.toFixed(3)}%), fee ${m.feePct}%/side, every ${everySec}s`);
  if (thresholdPct < floor) log("swing", `⚠ ${thresholdPct}% is under the ${floor.toFixed(3)}% fee floor — every round trip loses`);
  log("swing", "no keys loaded; this cannot trade");

  let ticks = 0;
  for (;;) {
    try {
      const p = await price(m);
      ticks++;
      const t = step(st.swing, p, thresholdPct, m.feePct);
      if (t) {
        st.log.push({ ...t, ts: Date.now() });
        if (st.log.length > 500) st.log = st.log.slice(-500);
        const held = st.swing.holding === "quote" ? `${st.swing.quote.toFixed(6)} ${quoteSym}` : `${st.swing.base.toFixed(8)} ${baseSym}`;
        log("swing", `${t.side === "BUY_BASE" ? "🟢" : "🔴"} ${t.reason} | holding ${held}${t.roundTrip !== undefined ? ` | round trip ${t.roundTrip >= 0 ? "+" : ""}${(t.roundTrip * 100).toFixed(4)}%` : ""}`);
      }
      // Mark to market so the figure is honest mid-position, not only after a sell.
      const equity = st.swing.holding === "quote" ? st.swing.quote : st.swing.base * p * (1 - m.feePct / 100);
      const hours = (Date.now() - Date.parse(st.startedAt)) / 3.6e6;
      // Quiet while it waits: a trade, or a heartbeat every 15 ticks so it is visibly alive.
      if (t || ticks % 15 === 1) log("swing", `  ${baseSym} ${p.toPrecision(6)} | equity ${(equity * 100 / st.startQuote - 100).toFixed(3)}% | ${st.swing.trades} trades in ${hours.toFixed(1)}h`);
      store.writeJson(file, st);
    } catch (e) {
      log("swing", `tick failed: ${(e as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, everySec * 1000));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
