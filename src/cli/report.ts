/**
 * Regenerates site/data/stats.json without trading.
 *
 * With `--every <minutes>` it keeps doing so. The bots are what normally refresh the site, once per
 * tick — so when they are stopped the file never changes, the publisher has nothing to push, and
 * the page silently freezes at whatever was true when trading stopped. A stopped experiment should
 * still show live balances and an honest mark; only its trade history is finished.
 */
import { config } from "../core/config.js";
import { log } from "../core/log.js";
import { Swarm } from "../swarm.js";
import { writeReport } from "../report.js";

function flag(name: string): number | undefined {
  const i = process.argv.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i < 0) return undefined;
  const v = Number(process.argv[i].includes("=") ? process.argv[i].split("=")[1] : process.argv[i + 1]);
  return Number.isFinite(v) ? v : undefined;
}

const swarm = new Swarm();

async function once() {
  const snap = await swarm.market.tick();
  try { swarm.lastIntel = await swarm.intel.tick(); } catch { /* intel is optional for a report */ }
  const s = await writeReport(swarm, snap);
  log("report", `stack ${s.now.dot.toFixed(0)} DOT, earned ${s.dotEarned.total.toFixed(1)} DOT (${s.dotEarned.pct.toFixed(3)}%), price $${s.now.priceUsd.toFixed(6)}`);
}

const every = flag("every");
if (every === undefined) {
  await once();
} else {
  log("report", `refreshing site/data every ${every} min for ${config.WALLET_ADDRESS} (not trading)`);
  for (;;) {
    try { await once(); } catch (e) { log("report", `failed: ${(e as Error).message}`); }
    await new Promise((r) => setTimeout(r, every * 60_000));
  }
}
