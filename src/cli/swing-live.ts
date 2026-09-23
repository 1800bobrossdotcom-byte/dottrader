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
import { MARKETS, LIVE_MARKETS, baseToken, type Market } from "../core/markets.js";
import { readPrice, readFee } from "../core/pool.js";
import { freshSwing, step, trackIdle, reconcile, feeFloorPct, type SwingBook } from "../agents/swing.js";
import { Swapper } from "../exec/swap.js";
import { Store } from "../data/store.js";
import { summariseSwing, writeSwingReport } from "../swing-report.js";

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
    fees[m.key] = await readFee(m);
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
  const idleEth = Math.max(0, nativeEth - config.GAS_RESERVE_ETH);
  // Whether there is anything to trade with is not answered by the ETH balance alone: restarting
  // while a position is open leaves almost no ETH, and exiting then would strand the position with
  // nothing able to sell it.
  const investedAtBoot: Market[] = [];
  for (const m of tradeable) {
    const t = baseToken(m);
    if (Number(await swapper.balance(t.address)) > 0) investedAtBoot.push(m);
    await sleep(250);
  }
  if (!(idleEth > 1e-9) && !investedAtBoot.length) {
    console.error(`nothing to trade with: wallet holds ${nativeEth.toFixed(6)} ETH, gas reserve is ${config.GAS_RESERVE_ETH}, budget is ${budgetEth}`);
    process.exit(1);
  }

  let bk = store.readJson<SwingBook | null>(file, null);
  // A market already holding the budget must stay watched even if its fee has since risen past the
  // floor. Dropping it would leave the position with nothing able to sell it: the fee makes new
  // round trips unprofitable, not the exit impossible, and being stuck in the base token is far
  // worse than paying one expensive swap to get out.
  for (const key of new Set([bk?.active, ...investedAtBoot.map((m) => m.key)].filter(Boolean) as string[])) {
    if (tradeable.some((m) => m.key === key)) continue;
    const stuck = markets.find((m) => m.key === key);
    if (!stuck) continue;
    tradeable.push(stuck);
    fees[stuck.key] ??= stuck.feePct;
    log("swing", `⚠️ ${stuck.key} is over its fee floor but holds a position — kept watched so it can be sold`);
  }
  const watching = tradeable.map((m) => m.key);
  // Rebuild the book whenever the shape of the run changes; a state carried across a different
  // market set or threshold is a book that no longer describes what the engine is doing.
  if (!bk || ((bk.thresholdPct !== thresholdPct || bk.markets.join(",") !== watching.join(",")) && !bk.active && !investedAtBoot.length)) {
    // The baseline is the budget, not a snapshot of idle ETH. Taking the snapshot meant a restart
    // while invested recorded a near-zero basis and capped every later trade at that figure.
    bk = {
      markets: watching, thresholdPct, startedAt: new Date().toISOString(), startEth: Math.min(budgetEth, idleEth || budgetEth),
      swings: Object.fromEntries(watching.map((k) => [k, freshSwing(0)])),
      active: null, trades: [], gasSpentEth: 0,
    };
  }
  bk.markets = watching;
  bk.thresholdPct = thresholdPct;
  for (const k of watching) bk.swings[k] ??= freshSwing(0);

  log("swing", `${dry ? "DRY" : "LIVE ⚠️"} watching ${tradeable.length} market(s): ${tradeable.map((m) => `${baseToken(m).symbol}/ETH @ ${fees[m.key]}%`).join(", ")}`);
  log("swing", `threshold ${thresholdPct}% | wallet ${swapper.address} holds ${nativeEth.toFixed(6)} ETH | budget ${budgetEth}, idle ${idleEth.toFixed(6)}, stop-loss ${stopLossPct}%`);
  if (investedAtBoot.length) log("swing", `⚠️ already holding ${investedAtBoot.map((m) => baseToken(m).symbol).join(", ")} at startup — adopted from the chain, not the book`);
  log("swing", `one budget, first qualifying dip gets it; DOT is never read or spent by this process`);

  let cycles = 0;
  for (;;) {
    try {
      cycles++;
      // Refresh dynamic fees hourly rather than every cycle; they drift, they do not jump.
      if (cycles % Math.max(1, Math.round(3600 / everySec)) === 0) {
        for (const m of tradeable) { fees[m.key] = await readFee(m); await sleep(300); }
      }

      const ethNow = Number(await swapper.balance(TOKENS.ETH)) / 1e18;
      // Measured against the budget each cycle, never against a startup snapshot: the snapshot is
      // taken while the money may be committed, and would then cap the engine at the loose change.
      const freeEth = Math.min(budgetEth, Math.max(0, ethNow - config.GAS_RESERVE_ETH));

      // ---- What the chain says we hold. The book is a cache; this is the truth. ----
      //
      // The book used to decide which market held the budget, while only the amounts came from the
      // chain. That is how a second position got opened: a book that said "flat" — stale, reset, or
      // belonging to a second copy of this process — put the engine in VIRTUAL while it already
      // held USDC, spending the leftover ETH above the gas reserve. Which market we are in is a
      // fact about the chain, so it is read from the chain, every cycle, like the amounts are.
      const seen: Record<string, number | null> = Object.fromEntries(tradeable.map((m) => [m.key, null]));
      const held: Record<string, number> = {};
      for (const m of tradeable) {
        try { seen[m.key] = await readPrice(m); } catch (e) {
          // One unreadable market must not blind the engine to the others.
          log("swing", `${m.key}: price unavailable (${(e as Error).message.split("\n")[0]})`);
        }
        await sleep(200); // space the reads; the public Base RPC refuses a burst
        const t = baseToken(m);
        held[m.key] = Number(await swapper.balance(t.address)) / 10 ** t.decimals;
        await sleep(200);
      }

      const rec = reconcile(tradeable.map((m) => m.key), held, seen);
      const holding = tradeable.filter((m) => rec.holding.includes(m.key));

      if (holding.length > 1) {
        // Already broken when this process started. Sell out of them as their triggers come, and
        // open nothing new until one position is left at most.
        log("swing", `⚠️ holding ${holding.length} positions at once (${holding.map((m) => `${held[m.key]} ${baseToken(m).symbol}`).join(", ")}) — selling only, no new buys`);
      }
      if (holding.length <= 1 && bk.active !== rec.active) {
        log("swing", `book said ${bk.active ?? "flat"}, chain says ${rec.active ?? "flat"} — trusting the chain`);
        bk.active = rec.active;
      }

      // Equity is everything the engine controls: idle ETH plus every position marked at what
      // selling it would actually return. Marking only one position would have hidden the second.
      let equityKnown = true;
      let equity = freeEth;
      for (const m of holding) {
        const p = seen[m.key];
        if (p === null) { equityKnown = false; continue; }
        equity += held[m.key] * p * (1 - fees[m.key] / 100);
      }
      const shown = holding.map((m) => `${baseToken(m).symbol} ${seen[m.key]?.toPrecision(6) ?? "?"}`).join(", ");

      // Sell candidates first: freeing the budget always beats committing more of it.
      const order = [...holding, ...tradeable.filter((m) => !holding.includes(m))];

      for (const m of order) {
        const s = bk.swings[m.key];
        const p = seen[m.key];
        if (p === null) continue;
        const amHolding = holding.includes(m);

        if (!amHolding) {
          // Cannot buy while anything is held, and cannot buy without a clean, single-position book.
          if (!rec.mayBuy) { trackIdle(s, p); continue; }
          s.quote = freeEth;
          s.base = 0;
          s.holding = "quote";
        } else {
          s.base = held[m.key];
          s.holding = "base";
          if (s.entryPrice === null) {
            // Adopted a position this process did not open: price it from the last buy on record,
            // or from where it stands now, so it can still be sold rather than held forever.
            const buy = [...bk.trades].reverse().find((x) => x.market === m.key && x.side === "BUY_BASE");
            s.entryPrice = buy?.price ?? p;
            s.pivot ??= s.entryPrice;
          }
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
        else { s.quote = out; t.quoteDelta = out; if (bk.active === m.key) bk.active = null; }
        bk.gasSpentEth += r.gasEth;
        bk.trades.push({ ...t, market: m.key, ts: Date.now(), hash: r.hash, gasEth: r.gasEth });
        log("swing", `${t.side === "BUY_BASE" ? "🟢" : "🔴"} ${m.key} ${t.reason} | got ${out} | gas ${r.gasEth.toFixed(8)} ETH | ${r.hash}`);
        store.writeJson(file, bk);
        break; // one commitment per cycle
      }

      const pnlPct = bk.startEth > 0 ? (equity / bk.startEth - 1) * 100 : 0;
      if (equityKnown && pnlPct <= -stopLossPct) {
        log("swing", `🛑 stop-loss: ${pnlPct.toFixed(2)}% vs the ${stopLossPct}% limit. Halting; holding ${bk.active ?? "ETH"}.`);
        store.writeJson(file, bk); return;
      }
      if (cycles % 15 === 1) {
        const where = holding.length ? `in ${holding.map((m) => m.key).join(" + ")} (${shown})` : `flat, armed on ${tradeable.length}`;
        const val = equityKnown ? `${equity.toFixed(6)} ETH (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%)` : "unknown (price read failed)";
        log("swing", `  ${where} | equity ${val} | ${bk.trades.length} fills | gas ${bk.gasSpentEth.toFixed(6)} ETH`);
      }
      store.writeJson(file, bk);
      // Publish what the page shows from the same numbers the engine just acted on, including the
      // markets whose price read failed — those appear with a null price rather than being dropped.
      writeSwingReport(summariseSwing(bk, seen, fees, new Date().toISOString()));
    } catch (e) {
      log("swing", `cycle failed: ${(e as Error).message}`);
    }
    await sleep(everySec * 1000);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
