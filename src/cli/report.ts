/**
 * Regenerates site/data/stats.json without trading.
 *
 * With `--every <minutes>` it keeps doing so. The bots are what normally refresh the site, once per
 * tick — so when they are stopped the file never changes, the publisher has nothing to push, and
 * the page silently freezes at whatever was true when trading stopped. A stopped experiment should
 * still show live balances and an honest mark; only its trade history is finished.
 */
import { statSync } from "node:fs";
import { config } from "../core/config.js";
import { log } from "../core/log.js";
import { Swarm } from "../swarm.js";
import { writeReport } from "../report.js";
import { Store } from "../data/store.js";
import { MARKETS } from "../core/markets.js";
import { readPrice, readFee, sleep } from "../core/pool.js";
import { summariseSwing, writeSwingReport } from "../swing-report.js";
import type { SwingBook } from "../agents/swing.js";

function flag(name: string): number | undefined {
  const i = process.argv.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i < 0) return undefined;
  const v = Number(process.argv[i].includes("=") ? process.argv[i].split("=")[1] : process.argv[i + 1]);
  return Number.isFinite(v) ? v : undefined;
}

const swarm = new Swarm();

/**
 * Refresh the swing engine's public journal from its book on disk.
 *
 * The engine writes this itself every cycle, so this only matters when it is stopped or wedged —
 * exactly when the page would otherwise freeze and quietly show hours-old prices as current. The
 * book's own mtime is published alongside, so the site can say how stale the engine is rather than
 * implying it is live.
 */
async function swingOnce() {
  const store = new Store();
  const file = "swing-live-multi.json";
  const bk = store.readJson<SwingBook | null>(file, null);
  if (!bk) return;
  let bookAt: string | null = null;
  try { bookAt = statSync(store.p(file)).mtime.toISOString(); } catch { /* keep null */ }

  const prices: Record<string, number | null> = {};
  const fees: Record<string, number> = {};
  for (const key of bk.markets) {
    const m = MARKETS[key];
    if (!m) continue;
    try { prices[key] = await readPrice(m); } catch { prices[key] = null; }
    await sleep(250);
    fees[key] = await readFee(m);
    await sleep(250);
  }
  writeSwingReport(summariseSwing(bk, prices, fees, bookAt));
}

async function once() {
  const snap = await swarm.market.tick();
  try { swarm.lastIntel = await swarm.intel.tick(); } catch { /* intel is optional for a report */ }
  const s = await writeReport(swarm, snap);
  try { await swingOnce(); } catch (e) { log("report", `swing journal failed: ${(e as Error).message}`); }
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
