import { config } from "./core/config.js";
import { log } from "./core/log.js";
import { Swarm } from "./swarm.js";

const once = process.argv.includes("--once");
log("swarm", `dottrader swarm starting — mode=${config.LIVE ? "LIVE ⚠️" : "PAPER"} wallet=${config.WALLET_ADDRESS} sleeve=${config.TRADING_SLEEVE * 100}% tick=${config.TICK_SECONDS}s`);
const swarm = new Swarm();

async function loop() {
  for (;;) {
    try { await swarm.tick(); } catch (e) { log("swarm", `tick failed: ${(e as Error).message}`); }
    if (once) break;
    await new Promise((r) => setTimeout(r, config.TICK_SECONDS * 1000));
  }
}
loop();
