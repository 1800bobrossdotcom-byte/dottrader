/**
 * Live swing trading across several cheap, oscillating pairs. Real money.
 *
 * One budget, many watched markets, first qualifying dip gets the money:
 *
 *   SWING_BUDGET_ETH=0.006 npx tsx src/cli/swing-live.ts --bot w1
 *   npx tsx src/cli/swing-live.ts --bot w1 --dry                  # decide, price, never send
 *   npx tsx src/cli/swing-live.ts --bot w1 --markets cbbtc-weth   # one market, as before
 *
 * Watching a single pair gave two or three signals a day, which is far too thin to ever learn
 * whether the edge is real. Four pairs give enough samples to measure it. That is what this is for
 * — instrumentation, not a promise: none of these pairs showed a robust edge once the backtests
 * were re-run with pessimistic fills, so the stop-loss below is the part to trust.
 *
 * Deliberately isolated from the DOT swarm: its own state file, its own book, its own process. It
 * trades ETH against each market's base token and never reads or spends DOT, so the worst case is
 * bounded by SWING_BUDGET_ETH rather than by anything in the stack.
 *
 * Every cycle reads balances from the chain rather than trusting the state file. The DOT ledger
 * drifted from reality more than once; a book that can silently disagree with the chain is worse
 * than no book.
 */
import { config, TOKENS } from "../core/config.js";
import { log } from "../core/log.js";
import { MARKETS, LIVE_MARKETS, quotePerBase, baseToken, slot0PriceAbi, poolFeeAbi, type Market } from "../core/markets.js";
import { freshSwing, step, trackIdle, feeFloorPct, type SwingState, type SwingTrade } from "../agents/swing.js";
import { Swapper } from "../exec/swap.js";
import { Store } from "../data/store.js";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";

const reader = createPublicClient({ chain: base, transport: http(config.BASE_RPC_URL) });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const num = (n: string, d: number) => {
  const i = process.argv.findIndex((a) => a === `--${n}` || a.startsWith(`--${n}=`));
  if (i < 0) return d;
  const v = Number(process.argv[i].includes("=") ? process.argv[i].split("=")[1] : process.argv[i + 1]);
  return Number.isFinite(v) ? v : d;
};
const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i < 0 ? undefined : process.argv[i + 1];
};

interface Leg extends SwingTrade { market: string; ts: number; hash?: string; gasEth: number }
interface Book {
  markets: string[];
  thresholdPct: number;
  startedAt: string;
  startEth: number;
  /** Per-market swing state. Exactly one may be holding `base` — see `active`. */
  swings: Record<string, SwingState>;
  /** The market the budget is currently committed to, or null when the engine is in ETH. */
  active: string | null;
  trades: Leg[];
  gasSpentEth: number;
}

/**
 * Price, retrying through the rate limiter.
 *
 * The public Base RPC answered "over rate limit" after six calls in three seconds. Four markets
 * polled every 20 seconds will hit it regularly, and a read that simply throws would take the whole
 * cycle with it — including the stop-loss check, and including every market later in the list than
 * the one that failed.
 */
async function price(m: Market) {
  let last: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      const sqrt = await reader.readContract({ address: m.pool, abi: slot0PriceAbi, functionName: "slot0" });
      return quotePerBase(sqrt, m);
    } catch (e) { last = e; await sleep(700 * 2 ** i); }
  }
  throw last;
}

/** Live fee, falling back to the screening figure rather than skipping the market. */
async function feePct(m: Market) {
  try {
    const f = await reader.readContract({ address: m.pool, abi: poolFeeAbi, functionName: "fee" });
    return Number(f) / 10_000;
  } catch {
    return m.feePct;
  }
}

async function main() {
  const dry = process.argv.includes("--dry");
  const thresholdPct = num("threshold", 1.2);
  const everySec = num("every", 20);
  const budgetEth = Number(process.env.SWING_BUDGET_ETH ?? 0);
  // Stop once this much of the starting budget is gone. A strategy validated only by backtest
  // deserves a floor it cannot argue its way past.
  const stopLossPct = num("stop-loss", 25);
  const keys = (arg("markets") ?? arg("market") ?? LIVE_MARKETS.join(",")).split(",").map((k) => k.trim()).filter(Boolean);

  const unknown = keys.filter((k) => !MARKETS[k]);
  if (unknown.length) { console.error(`unknown market(s): ${unknown.join(", ")}. Known: ${Object.keys(MARKETS).join(", ")}`); process.exit(1); }
  if (!config.PRIVATE_KEY) { console.error("no PRIVATE_KEY; use --bot w1 to load its env file"); process.exit(1); }
  if (!(budgetEth > 0)) { console.error("set SWING_BUDGET_ETH to the ETH this engine may use, e.g. SWING_BUDGET_ETH=0.006"); process.exit(1); }

  const markets = keys.map((k) => MARKETS[k]);
  const swapper = new Swapper();
  const store = new Store();
  const file = "swing-live-multi.json";

  // Live fees decide which markets are tradeable at all: a dynamic-fee pool can price itself out of
  // the threshold, and trading it anyway loses on every round trip no matter how well timed.
  const fees: Record<string, number> = {};
  const tradeable: Market[] = [];
  for (const m of markets) {
    fees[m.key] = await feePct(m);
    const floor = feeFloorPct(fees[m.key]);
    if (thresholdPct < floor) {
      log("swing", `⛔ ${m.key} skipped: ${thresholdPct}% threshold is under its ${floor.toFixed(3)}% fee floor (${fees[m.key]}%/side)`);
    } else {
      tradeable.push(m);
    }
    await sleep(300);
  }
  if (!tradeable.length) { console.error(`no market clears the fee floor at a ${thresholdPct}% threshold`); process.exit(1); }

  const nativeEth = Number(await swapper.balance(TOKENS.ETH)) / 1e18;
  const spendable = Math.min(budgetEth, Math.max(0, nativeEth - config.GAS_RESERVE_ETH));
  // Guard the divisor before it is used: a zero start makes every P&L NaN, and a NaN silently
  // fails the stop-loss comparison, leaving the engine running with no floor at all.
  if (!(spendable > 1e-9)) {
    console.error(`nothing to trade with: wallet holds ${nativeEth.toFixed(6)} ETH, gas reserve is ${config.GAS_RESERVE_ETH}, budget is ${budgetEth}`);
    process.exit(1);
  }

  let bk = store.readJson<Book | null>(file, null);
  // A market already holding the budget must stay watched even if its fee has since risen past the
  // floor. Dropping it would leave the position with nothing able to sell it: the fee makes new
  // round trips unprofitable, not the exit impossible, and being stuck in the base token is far
  // worse than paying one expensive swap to get out.
  if (bk?.active && !tradeable.some((m) => m.key === bk!.active)) {
    const held = markets.find((m) => m.key === bk!.active);
    if (held) {
      tradeable.push(held);
      fees[held.key] ??= held.feePct;
      log("swing", `⚠️ ${held.key} is over its fee floor but holds the budget — kept watched so it can be sold`);
    }
  }
  const watching = tradeable.map((m) => m.key);
  // Rebuild the book whenever the shape of the run changes; a state carried across a different
  // market set or threshold is a book that no longer describes what the engine is doing.
  if (!bk || ((bk.thresholdPct !== thresholdPct || bk.markets.join(",") !== watching.join(",")) && !bk.active)) {
    bk = {
      markets: watching, thresholdPct, startedAt: new Date().toISOString(), startEth: spendable,
      swings: Object.fromEntries(watching.map((k) => [k, freshSwing(0)])),
      active: null, trades: [], gasSpentEth: 0,
    };
  }
  bk.markets = watching;
  bk.thresholdPct = thresholdPct;
  for (const k of watching) bk.swings[k] ??= freshSwing(0);

  log("swing", `${dry ? "DRY" : "LIVE ⚠️"} watching ${tradeable.length} market(s): ${tradeable.map((m) => `${baseToken(m).symbol}/ETH @ ${fees[m.key]}%`).join(", ")}`);
  log("swing", `threshold ${thresholdPct}% | wallet ${swapper.address} holds ${nativeEth.toFixed(6)} ETH | budget ${budgetEth}, spendable ${spendable.toFixed(6)}, stop-loss ${stopLossPct}%`);
  log("swing", `one budget, first qualifying dip gets it; DOT is never read or spent by this process`);

  let cycles = 0;
  for (;;) {
    try {
      cycles++;
      // Refresh dynamic fees hourly rather than every cycle; they drift, they do not jump.
      if (cycles % Math.max(1, Math.round(3600 / everySec)) === 0) {
        for (const m of tradeable) { fees[m.key] = await feePct(m); await sleep(300); }
      }

      const ethNow = Number(await swapper.balance(TOKENS.ETH)) / 1e18;
      const freeEth = Math.min(spendable, Math.max(0, ethNow - config.GAS_RESERVE_ETH));

      const active = bk.active ? tradeable.find((m) => m.key === bk!.active) : undefined;
      let equity = freeEth;
      // While the budget is in a base token, `freeEth` is near zero and says nothing about what the
      // position is worth. If that market's price read fails, equity is simply unknown — and an
      // unknown equity must not be read as a 100% loss, or a rate limit would trip the stop-loss
      // and halt a perfectly healthy engine.
      let equityKnown = !bk.active;
      let shown = "";

      // The market holding the budget is read first, always: its price is the one the stop-loss is
      // measured against, and it is the only market that can free the money up again.
      // Everything else rotates, so a rate limit that bites partway through the list does not
      // always bite the same markets — otherwise the pair listed last would be polled a fraction
      // as often as the pair listed first, and would look far quieter than it is.
      const order = active
        ? [active, ...tradeable.filter((m) => m.key !== active.key)]
        : tradeable.map((_, i) => tradeable[(i + cycles) % tradeable.length]);

      for (const m of order) {
        const s = bk.swings[m.key];
        let p: number;
        try {
          p = await price(m);
        } catch (e) {
          // One unreadable market must not blind the engine to the other three.
          log("swing", `${m.key}: price unavailable (${(e as Error).message.split("\n")[0]})`);
          continue;
        }
        await sleep(200); // space the reads; the public Base RPC refuses a burst

        if (active && m.key !== active.key) { trackIdle(s, p); continue; }

        if (!active) {
          // Flat: every market is a candidate, and the budget is whatever the chain says we hold.
          s.quote = freeEth;
          s.base = 0;
          s.holding = "quote";
        } else {
          s.base = Number(await swapper.balance(baseToken(m).address)) / 10 ** baseToken(m).decimals;
          await sleep(200);
          equity = s.base * p * (1 - fees[m.key] / 100);
          equityKnown = true;
          shown = `${baseToken(m).symbol} ${p.toPrecision(6)}`;
        }

        const t = step(s, p, thresholdPct, fees[m.key]);
        if (!t) continue;

        if (dry) {
          log("swing", `[dry] ${m.key} ${t.side} — ${t.reason}`);
          // A dry run must not pretend to hold something it never bought.
          if (t.side === "BUY_BASE") { s.holding = "quote"; s.base = 0; s.quote = freeEth; }
          continue;
        }

        const baseTok = baseToken(m);
        const [tokIn, tokOut] = t.side === "BUY_BASE"
          ? [TOKENS.ETH as string, baseTok.address as string]
          : [baseTok.address as string, TOKENS.ETH as string];
        const amountIn = t.side === "BUY_BASE"
          ? BigInt(Math.floor(-t.quoteDelta * 1e18))
          : BigInt(Math.floor(-t.baseDelta * 10 ** baseTok.decimals));
        const r = await swapper.swap(tokIn, tokOut, amountIn);
        const out = Number(r.amountOut) / (t.side === "BUY_BASE" ? 10 ** baseTok.decimals : 1e18);
        // Correct the book to the amount that actually arrived.
        if (t.side === "BUY_BASE") { s.base = out; t.baseDelta = out; bk.active = m.key; }
        else { s.quote = out; t.quoteDelta = out; bk.active = null; }
        bk.gasSpentEth += r.gasEth;
        bk.trades.push({ ...t, market: m.key, ts: Date.now(), hash: r.hash, gasEth: r.gasEth });
        log("swing", `${t.side === "BUY_BASE" ? "🟢" : "🔴"} ${m.key} ${t.reason} | got ${out} | gas ${r.gasEth.toFixed(8)} ETH | ${r.hash}`);
        store.writeJson(file, bk);
        break; // one budget, one commitment per cycle
      }

      const pnlPct = bk.startEth > 0 ? (equity / bk.startEth - 1) * 100 : 0;
      if (equityKnown && pnlPct <= -stopLossPct) {
        log("swing", `🛑 stop-loss: ${pnlPct.toFixed(2)}% vs the ${stopLossPct}% limit. Halting; holding ${bk.active ?? "ETH"}.`);
        store.writeJson(file, bk); return;
      }
      if (cycles % 15 === 1) {
        const where = bk.active ? `in ${bk.active} (${shown})` : `flat, armed on ${tradeable.length}`;
        const val = equityKnown ? `${equity.toFixed(6)} ETH (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%)` : "unknown (price read failed)";
        log("swing", `  ${where} | equity ${val} | ${bk.trades.length} fills | gas ${bk.gasSpentEth.toFixed(6)} ETH`);
      }
      store.writeJson(file, bk);
    } catch (e) {
      log("swing", `cycle failed: ${(e as Error).message}`);
    }
    await sleep(everySec * 1000);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
