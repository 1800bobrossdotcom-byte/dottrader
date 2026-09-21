import { config } from "./core/config.js";
import { log } from "./core/log.js";
import { Swarm } from "./swarm.js";
import { beat, killRequested } from "./core/pause.js";

const once = process.argv.includes("--once");
log("swarm", `dottrader swarm starting — mode=${config.LIVE ? "LIVE ⚠️" : "PAPER"} wallet=${config.WALLET_ADDRESS} sleeve=${config.TRADING_SLEEVE * 100}% tick=${config.TICK_SECONDS}s`);
// Stated plainly at boot: whether the grid may open new short lots is the difference between
// riding a trend out and selling into it, and it is set in a file the process reads for itself.
log("swarm", `grid: new short lots ${config.GRID_ALLOW_NEW_SHORTS ? "ALLOWED" : "OFF"}, buy rungs ${config.GRID_TWO_SIDED ? "on" : "off"}, ${config.GRID_LEVELS} levels ${config.GRID_SPACING_PCT}% apart`);
const swarm = new Swarm();

async function loop() {
  let parked = false;
  for (;;) {
    // A KILL file parks the bot without stopping the process, so a tool can edit the ledger without
    // this tick saving a stale copy over its work. The heartbeat is how the tool knows we have.
    if (killRequested()) {
      beat("paused");
      if (!parked) { log("swarm", `KILL file present in ${config.DATA_DIR} — parked, not trading (delete it to resume)`); parked = true; }
    } else {
      if (parked) { log("swarm", "KILL file gone — resuming"); parked = false; }
      beat("running");
      try { await swarm.tick(); } catch (e) { log("swarm", `tick failed: ${(e as Error).message}`); }
    }
    if (once) break;
    await new Promise((r) => setTimeout(r, config.TICK_SECONDS * 1000));
  }
}
loop();
