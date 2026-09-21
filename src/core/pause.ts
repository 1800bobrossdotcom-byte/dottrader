import { existsSync, writeFileSync, rmSync, statSync, readFileSync } from "node:fs";
import path from "node:path";
import { config } from "./config.js";

/**
 * A file lock between the swarm and the tools that edit its books.
 *
 * The ledger is a JSON file a running bot holds in memory and writes back each tick. A tool that
 * edits it alongside a live bot loses: the bot saves its stale copy over the tool's work. That
 * happened for real — close-lots bought nine lots back, and the bot, still holding the old lots,
 * decided their ETH had been "spent outside the bot" and released them, so six of nine realised
 * losses never reached dotEarned.
 *
 * So: the bot touches BEAT every loop, with "running" or "paused". Anything wanting exclusive
 * access writes KILL and waits for the bot to confirm it has parked.
 */
const KILL = () => path.join(config.DATA_DIR, "KILL");
const BEAT = () => path.join(config.DATA_DIR, "HEARTBEAT");

export const killRequested = () => existsSync(KILL());

/** Called by the swarm each loop, before deciding whether to tick. */
export function beat(state: "running" | "paused") {
  try { writeFileSync(BEAT(), state); } catch { /* a missing data dir is not worth dying for */ }
}

/** How long ago the bot last showed a sign of life, in ms; Infinity if it never has. */
export function sinceBeat(): number {
  try { return Date.now() - statSync(BEAT()).mtimeMs; } catch { return Infinity; }
}

function beatState(): string {
  try { return readFileSync(BEAT(), "utf8").trim(); } catch { return ""; }
}

/**
 * Take exclusive use of this wallet's books. Returns a function that gives them back.
 * Throws if a live bot will not park, rather than corrupting the ledger by racing it.
 */
export async function pauseBot(log: (m: string) => void): Promise<() => void> {
  const tick = config.TICK_SECONDS * 1000;
  const stale = 3 * tick + 30_000;

  if (sinceBeat() > stale) {
    log(`no bot running for this wallet (${config.DATA_DIR}); proceeding`);
    return () => {};
  }

  log(`a bot is live on ${config.DATA_DIR} — asking it to park before touching the ledger`);
  writeFileSync(KILL(), `paused by close-lots at ${new Date().toISOString()}\n`);
  const until = Date.now() + stale;
  for (;;) {
    if (beatState() === "paused") { log("bot parked"); return () => { rmSync(KILL(), { force: true }); log("bot released"); }; }
    // It may also simply have been stopped while we waited.
    if (sinceBeat() > stale) { log("bot went quiet; proceeding"); return () => rmSync(KILL(), { force: true }); }
    if (Date.now() > until) {
      rmSync(KILL(), { force: true });
      throw new Error(`bot on ${config.DATA_DIR} did not park within ${Math.round(stale / 1000)}s. Stop it first: npx pm2 stop dot-bot-<n>`);
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
}
