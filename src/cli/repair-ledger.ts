/**
 * Rebuild the ledger's earnings totals from the journal.
 *
 * `journal.ndjson` is append-only: one row per completed round trip, written at the moment it
 * closed. `state.json` holds running totals of the same thing, and those totals can drift — if a
 * second process closes lots while a bot is live, the bot's next save lands on top and the closes
 * it never saw are lost from the totals even though their journal rows survive.
 *
 * That happened on 21 Sep: nine lots were bought back, six of the closes vanished from
 * `dotEarnedByAgent`, and the site reported a loss ~6,700 DOT smaller than the real one. The fix is
 * to recompute from the rows rather than trust the running total.
 *
 * Usage:
 *   npx tsx src/cli/repair-ledger.ts --bot w1          # dry run, shows what would change
 *   npx tsx src/cli/repair-ledger.ts --bot w1 --yes    # write it
 */
import { config } from "../core/config.js";
import { Ledger } from "../core/ledger.js";
import { log } from "../core/log.js";
import { pauseBot } from "../core/pause.js";
import { Store } from "../data/store.js";

interface JournalRow { ts: number; agent: string; lotId: string | null; dotEarned: number }

async function main() {
  const release = await pauseBot((m) => log("repair", m));
  try { await run(); } finally { release(); }
}

async function run() {
  const apply = process.argv.includes("--yes");
  const store = new Store();
  const ledger = new Ledger(store);
  const rows = store.readLines<JournalRow>("journal.ndjson");

  const byAgent: Record<string, number> = {};
  // Only a closed lot's profit is sweepable. A fresh-capital buy (lotId null) is working
  // inventory the wallet paid for, not something the bot won.
  let fromLots = 0;
  for (const r of rows) {
    byAgent[r.agent] = (byAgent[r.agent] ?? 0) + r.dotEarned;
    if (r.lotId) fromLots += r.dotEarned;
  }
  const unswept = Math.max(0, fromLots - (ledger.state.sweptDot ?? 0));

  const was = ledger.state.dotEarnedByAgent;
  const total = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

  console.log(`\nwallet ${config.WALLET_ADDRESS}  data ${config.DATA_DIR}`);
  console.log(`${rows.length} round trips in the journal\n`);
  console.log("  agent        stored      journal       delta");
  for (const a of new Set([...Object.keys(was), ...Object.keys(byAgent)])) {
    const o = was[a] ?? 0, n = byAgent[a] ?? 0;
    console.log(`  ${a.padEnd(10)} ${o.toFixed(2).padStart(10)} ${n.toFixed(2).padStart(12)} ${(n - o).toFixed(2).padStart(11)}`);
  }
  console.log(`  ${"TOTAL".padEnd(10)} ${total(was).toFixed(2).padStart(10)} ${total(byAgent).toFixed(2).padStart(12)} ${(total(byAgent) - total(was)).toFixed(2).padStart(11)}`);
  console.log(`\n  unsweptEarned ${(ledger.state.unsweptEarned ?? 0).toFixed(2)} -> ${unswept.toFixed(2)}`);

  if (Math.abs(total(byAgent) - total(was)) < 1e-6) { console.log("\nalready correct; nothing to do"); return; }
  if (!apply) { console.log("\ndry run — add --yes to write it"); return; }

  ledger.state.dotEarnedByAgent = byAgent;
  ledger.state.unsweptEarned = unswept;
  ledger.save();
  console.log("\nwritten. The next tick republishes the site with the corrected figure.");
}

main().catch((e) => { console.error(e); process.exit(1); });
