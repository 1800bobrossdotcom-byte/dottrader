/**
 * Live swing trading on a cheap, oscillating pair. Real money.
 *
 * Deliberately isolated from the DOT swarm: its own state file, its own book, its own process.
 * It trades ETH against the market's base token and never reads or spends DOT, so the worst case
 * is bounded by SWING_BUDGET_ETH rather than by anything in the stack.
 *
 *   SWING_BUDGET_ETH=0.006 npx tsx src/cli/swing-live.ts --bot w1
 *   npx tsx src/cli/swing-live.ts --bot w1 --dry        # decide, price, but never send
 *
 * Every tick reads balances from the chain rather than trusting the state file. The DOT ledger
 * drifted from reality more than once; a book that can silently disagree with the chain is worse
 * than no book.
 */
import type { Address } from "viem";
import { config, TOKENS } from "../core/config.js";
import { log } from "../core/log.js";
import { MARKETS, priceFromSqrtX96, type Market } from "../core/markets.js";
import { freshSwing, step, feeFloorPct, type SwingState, type SwingTrade } from "../agents/swing.js";
import { Swapper } from "../exec/swap.js";
import { publicClient } from "../core/chain.js";
import { Store } from "../data/store.js";
import { createPublicClient, http, parseAbi } from "viem";
import { base } from "viem/chains";

const poolAbi = parseAbi(["function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 a, uint16 b, uint16 c, uint32 d, bool e)"]);
const reader = createPublicClient({ chain: base, transport: http(config.BASE_RPC_URL) });

const num = (n: string, d: number) => {
  const i = process.argv.findIndex((a) => a === `--${n}` || a.startsWith(`--${n}=`));
  if (i < 0) return d;
  const v = Number(process.argv[i].includes("=") ? process.argv[i].split("=")[1] : process.argv[i + 1]);
  return Number.isFinite(v) ? v : d;
};

interface Book { market: string; thresholdPct: number; startedAt: string; startEth: number; swing: SwingState; trades: (SwingTrade & { ts: number; hash?: string; gasEth: number })[]; gasSpentEth: number }

async function price(m: Market) {
  const [sqrt] = await reader.readContract({ address: m.pool as Address, abi: poolAbi, functionName: "slot0" });
  return priceFromSqrtX96(sqrt, m);
}

async function main() {
  const key = process.argv.includes("--market") ? process.argv[process.argv.indexOf("--market") + 1] : "cbbtc-weth";
  const m = MARKETS[key];
  if (!m) { console.error(`unknown market ${key}`); process.exit(1); }
  const dry = process.argv.includes("--dry");
  const thresholdPct = num("threshold", 1.2);
  const everySec = num("every", 20);
  const budgetEth = Number(process.env.SWING_BUDGET_ETH ?? 0);
  // Stop once this much of the starting budget is gone. A strategy validated only by backtest
  // deserves a floor it cannot argue its way past.
  const stopLossPct = num("stop-loss", 25);
  const floor = feeFloorPct(m.feePct);

  if (!config.PRIVATE_KEY) { console.error("no PRIVATE_KEY; use --bot w1 to load its env file"); process.exit(1); }
  if (!(budgetEth > 0)) { console.error("set SWING_BUDGET_ETH to the ETH this engine may use, e.g. SWING_BUDGET_ETH=0.006"); process.exit(1); }
  if (thresholdPct < floor) { console.error(`threshold ${thresholdPct}% is under the ${floor.toFixed(3)}% fee floor — every round trip would lose`); process.exit(1); }

  const baseTok = m.quote === "token0" ? m.token1 : m.token0;
  const swapper = new Swapper();
  const store = new Store();
  const file = `swing-live-${m.key}.json`;
  let bk = store.readJson<Book | null>(file, null);

  const nativeEth = Number(await swapper.balance(TOKENS.ETH)) / 1e18;
  const spendable = Math.min(budgetEth, Math.max(0, nativeEth - config.GAS_RESERVE_ETH));
  // Guard the divisor before it is used: a zero start makes every P&L NaN, and a NaN silently
  // fails the stop-loss comparison, leaving the engine running with no floor at all.
  if (!(spendable > 1e-9)) {
    console.error(`nothing to trade with: wallet holds ${nativeEth.toFixed(6)} ETH, gas reserve is ${config.GAS_RESERVE_ETH}, budget is ${budgetEth}`);
    process.exit(1);
  }
  if (!bk || bk.thresholdPct !== thresholdPct) {
    bk = { market: m.key, thresholdPct, startedAt: new Date().toISOString(), startEth: spendable, swing: freshSwing(spendable), trades: [], gasSpentEth: 0 };
  }

  log("swing", `${dry ? "DRY" : "LIVE ⚠️"} ${baseTok.symbol}/ETH on ${m.key} — threshold ${thresholdPct}% (floor ${floor.toFixed(3)}%), fee ${m.feePct}%/side`);
  log("swing", `wallet ${swapper.address} holds ${nativeEth.toFixed(6)} ETH; budget ${budgetEth} ETH, spendable ${spendable.toFixed(6)}, stop-loss ${stopLossPct}%`);
  log("swing", `DOT is never read or spent by this process`);

  let ticks = 0;
  for (;;) {
    try {
      const p = await price(m);
      ticks++;

      // The chain decides what we hold, not the state file.
      const ethNow = Number(await swapper.balance(TOKENS.ETH)) / 1e18;
      const baseNow = Number(await swapper.balance(baseTok.address)) / 10 ** baseTok.decimals;
      bk.swing.quote = bk.swing.holding === "quote" ? Math.min(bk.swing.quote, Math.max(0, ethNow - config.GAS_RESERVE_ETH)) : 0;
      bk.swing.base = bk.swing.holding === "base" ? baseNow : bk.swing.base;

      const equity = bk.swing.holding === "quote" ? bk.swing.quote : bk.swing.base * p * (1 - m.feePct / 100);
      const pnlPct = bk.startEth > 0 ? (equity / bk.startEth - 1) * 100 : 0;
      if (pnlPct <= -stopLossPct) {
        log("swing", `🛑 stop-loss: ${pnlPct.toFixed(2)}% vs the ${stopLossPct}% limit. Halting; holding ${bk.swing.holding}.`);
        store.writeJson(file, bk); return;
      }

      const t = step(bk.swing, p, thresholdPct, m.feePct);
      if (t) {
        if (dry) {
          log("swing", `[dry] ${t.side} — ${t.reason}`);
        } else {
          const [tokIn, tokOut] = t.side === "BUY_BASE" ? [TOKENS.ETH as string, baseTok.address as string] : [baseTok.address as string, TOKENS.ETH as string];
          const amountIn = t.side === "BUY_BASE"
            ? BigInt(Math.floor(-t.quoteDelta * 1e18))
            : BigInt(Math.floor(-t.baseDelta * 10 ** baseTok.decimals));
          const r = await swapper.swap(tokIn, tokOut, amountIn);
          const out = Number(r.amountOut) / (t.side === "BUY_BASE" ? 10 ** baseTok.decimals : 1e18);
          // Correct the book to the amount that actually arrived.
          if (t.side === "BUY_BASE") { bk.swing.base = out; t.baseDelta = out; } else { bk.swing.quote = out; t.quoteDelta = out; }
          bk.gasSpentEth += r.gasEth;
          bk.trades.push({ ...t, ts: Date.now(), hash: r.hash, gasEth: r.gasEth });
          log("swing", `${t.side === "BUY_BASE" ? "🟢" : "🔴"} ${t.reason} | got ${out} | gas ${r.gasEth.toFixed(8)} ETH | ${r.hash}`);
        }
      }
      if (t || ticks % 15 === 1) {
        log("swing", `  ${baseTok.symbol} ${p.toPrecision(6)} | equity ${equity.toFixed(6)} ETH (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%) | ${bk.swing.trades} trades | gas ${bk.gasSpentEth.toFixed(6)} ETH`);
      }
      store.writeJson(file, bk);
    } catch (e) {
      log("swing", `tick failed: ${(e as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, everySec * 1000));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
