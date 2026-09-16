#!/usr/bin/env node
// Publishes the bots' stats to GitHub every PUBLISH_MINUTES (default 15) so dottrader.app stays current.
// Runs as a pm2 process next to the bots. Only site/data/*.json and the equity log are pushed, never env files.
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.chdir(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
const minutes = Number(process.env.PUBLISH_MINUTES ?? 15);
const sh = (c) => execSync(c, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" }).trim();
const log = (m) => console.log(`${new Date().toISOString().slice(11, 19)} [publish] ${m}`);

function tick() {
  try {
    sh("git add -f site/data/stats.json site/data/equity.ndjson");
    const staged = sh("git diff --cached --name-only");
    if (!staged) { log("nothing new"); return; }
    sh(`git commit -q -m "site: stats ${new Date().toISOString()}"`);
    sh("git push -q");
    log(`pushed ${staged.split("\n").length} file(s)`);
  } catch (e) {
    log(`failed: ${String(e.stderr || e.message).trim().split("\n").pop()}`);
    try { sh("git reset -q"); } catch {}
  }
}
log(`publishing site/data every ${minutes} min`);
tick();
setInterval(tick, minutes * 60_000);
