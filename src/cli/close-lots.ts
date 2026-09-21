/**
 * Manually close open short lots at market.
 *
 * The grid opens a short lot every time price rises through a level: it sells a slice of DOT and parks
 * the proceeds in ETH, waiting to buy the slice back GRID_EDGE_PCT lower. That is a bet on mean
 * reversion. In a sustained uptrend the buy-back price never prints, the parked ETH buys back less DOT
 * every day the price rises, and the lots are dead weight — the grid has no trend filter, so it cannot
 * unwind them by itself.
 *
 * This tool unwinds chosen lots at the current market price. Losses are realised, which is the point:
 * holding a short lot is a continuing bet, not a way to avoid the loss already taken.
 *
 * Usage (per bot — each has its own wallet, key and data dir):
 *   npm run close-lots -- --bot w1 --sold-below 3.0e-6          # dry run, prints the plan
 *   npm run close-lots -- --bot w1 --sold-below 3.0e-6 --yes    # execute
 *   npm run close-lots -- --bot w1 --all --yes                  # every short lot
 *   npm run close-lots -- --bot w1 --ids grid:3:1789,grid:4:179 --yes
 *
 * Stop the bot first (`npx pm2 stop dot-bot-w1`) so it cannot trade the same ETH underneath this.
 */
import { config } from "../core/config.js";
import { getPortfolio } from "../core/chain.js";
import { Ledger, isShort, type OpenLot } from "../core/ledger.js";
import { log } from "../core/log.js";
import { MarketData } from "../data/market.js";
import { GridAgent } from "../agents/grid.js";
import { Executor } from "../exec/executor.js";
import { pauseBot } from "../core/pause.js";
import type { Signal } from "../core/types.js";

function flag(name: string): string | undefined {
  const i = process.argv.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i < 0) return undefined;
  const a = process.argv[i];
  return a.includes("=") ? a.split("=").slice(1).join("=") : (process.argv[i + 1] ?? "");
}
const has = (name: string) => process.argv.includes(`--${name}`);
const fmt = (x: number) => x.toExponential(4);

async function main() {
  const soldBelow = flag("sold-below") ? Number(flag("sold-below")) : undefined;
  const ids = flag("ids")?.split(",").map((s) => s.trim()).filter(Boolean);
  const all = has("all");
  const execute = has("yes");

  if (!all && !ids?.length && !(soldBelow && soldBelow > 0)) {
    console.error("pick lots with --sold-below <ethPerDot>, --ids <a,b,c>, or --all");
    process.exit(1);
  }

  // Park any live bot FIRST. The ledger is read into memory here and written back; a bot ticking
  // alongside would save its own stale copy over these closes, which is exactly how nine realised
  // losses turned into six silent "released" lots once already.
  const release = await pauseBot((m) => log("close", m));
  try { await run({ soldBelow, ids, all, execute }); } finally { release(); }
}

async function run({ soldBelow, ids, all, execute }: { soldBelow?: number; ids?: string[]; all: boolean; execute: boolean }) {
  const ledger = new Ledger();
  const grid = new GridAgent();
  grid.init();
  const snap = await new MarketData().tick();
  const price = snap.priceEth;
  if (!(price > 0)) { console.error("no price; aborting"); process.exit(1); }

  // The chain is the truth about how much ETH is actually spendable.
  let ethAvailable = ledger.state.portfolio.eth;
  if (config.LIVE) {
    const onchain = await getPortfolio();
    ledger.syncPortfolio(onchain);
    ethAvailable = onchain.eth;
  }
  const spendable = Math.max(0, ethAvailable - config.GAS_RESERVE_ETH);

  const shorts = ledger.state.openLots.filter(isShort);
  const picked = shorts
    .filter((l) => (all ? true : ids?.length ? ids.includes(l.id) : l.sellPriceEth < soldBelow!))
    .sort((a, b) => a.sellPriceEth - b.sellPriceEth); // worst first: they need the deepest retrace

  console.log(`\nwallet ${config.WALLET_ADDRESS}  data ${config.DATA_DIR}  ${config.LIVE ? "LIVE" : "PAPER"}`);
  console.log(`price now ${fmt(price)} ETH/DOT   spendable ETH ${spendable.toFixed(6)}`);
  console.log(`${shorts.length} open short lots, ${picked.length} selected\n`);
  if (!picked.length) { console.log("nothing to do"); return; }

  console.log("  sold at      DOT sold   ETH held   buys now       hole");
  let sold = 0, eth = 0;
  for (const l of picked) {
    const buys = l.ethReceived / price;
    console.log(`  ${fmt(l.sellPriceEth)}  ${l.dotSold.toFixed(0).padStart(9)}  ${l.ethReceived.toFixed(6)}  ${buys.toFixed(0).padStart(9)}  ${(buys - l.dotSold).toFixed(0).padStart(9)}`);
    sold += l.dotSold; eth += l.ethReceived;
  }
  console.log(`  ${"TOTAL".padEnd(9)}  ${sold.toFixed(0).padStart(9)}  ${eth.toFixed(6)}  ${(eth / price).toFixed(0).padStart(9)}  ${(eth / price - sold).toFixed(0).padStart(9)}`);
  console.log(`\n  (the hole is already taken — it exists whether or not these lots are closed.`);
  console.log(`   closing costs roughly ${(eth / price * 0.011).toFixed(0)} DOT more, in swap fees.)\n`);

  if (eth > spendable) console.log(`⚠ selected lots claim ${eth.toFixed(6)} ETH but only ${spendable.toFixed(6)} is spendable; will close what fits, worst first.\n`);
  if (!execute) { console.log("dry run — add --yes to execute"); return; }

  const executor = new Executor();
  let budget = spendable;
  let bought = 0, spent = 0, done = 0;
  for (const lot of picked) {
    if (lot.ethReceived > budget) { log("close", `skip ${lot.id}: needs ${lot.ethReceived.toFixed(6)} ETH, ${budget.toFixed(6)} left`); continue; }
    const signal: Signal = {
      agent: "grid", side: "BUY_DOT", conviction: 1,
      size: { usd: lot.ethReceived * snap.ethUsd },
      tag: lot.id,
      reason: `manual close: unwinding lot sold at ${fmt(lot.sellPriceEth)} (target ${fmt(lot.targetBuyPriceEth)} out of reach)`,
    };
    let fill;
    try { fill = await executor.execute(signal, snap); } catch (e) { log("close", `failed ${lot.id}: ${(e as Error).message}`); continue; }
    if (!fill) { log("close", `no fill for ${lot.id}`); continue; }

    // Close this exact lot by index: ids are not unique, so a tag lookup could unwind the wrong slice.
    const idx = ledger.state.openLots.indexOf(lot);
    ledger.recordFill(fill, idx >= 0 ? idx : undefined);
    // Free the grid level and raise the ratchet to what we just paid, so the grid cannot turn around
    // and re-sell this slice cheaper than it was repurchased.
    grid.onLotClosed(lot.id, fill.dot > 0 ? fill.eth / fill.dot : 0);

    bought += fill.dot; spent += fill.eth; budget -= fill.eth; done++;
    log("close", `closed ${lot.id}: ${fill.eth.toFixed(6)} ETH → ${fill.dot.toFixed(0)} DOT (sold ${lot.dotSold.toFixed(0)})`);
  }

  console.log(`\nclosed ${done}/${picked.length} lots: spent ${spent.toFixed(6)} ETH, bought back ${bought.toFixed(0)} DOT`);
  console.log(`${ledger.state.openLots.filter(isShort).length} short lots still open`);
  console.log(`\nSet GRID_ALLOW_NEW_SHORTS=0 in .env before restarting, or the grid will sell these slices straight back.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
