/** Regenerates site/data/stats.json without trading. */
import { Swarm } from "../swarm.js";
import { writeReport } from "../report.js";
const swarm = new Swarm();
const snap = await swarm.market.tick();
try { swarm.lastIntel = await swarm.intel.tick(); } catch {}
const s = await writeReport(swarm, snap);
console.log(`stats.json written — stack ${s.now.dot.toFixed(0)} DOT, earned ${s.dotEarned.total.toFixed(1)} DOT (${s.dotEarned.pct.toFixed(3)}%), price $${s.now.priceUsd.toFixed(6)}`);
