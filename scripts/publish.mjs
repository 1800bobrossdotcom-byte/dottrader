#!/usr/bin/env node
// Publishes the bots' stats to GitHub every PUBLISH_MINUTES (default 15) so dottrader.app stays current.
// Runs as a pm2 process next to the bots. Only site/data/stats.json and the equity log are pushed, never env files.
//
// Design: the stats files on disk are the source of truth. Each tick syncs the repo to GitHub exactly and
// re-commits the current stats on top, so new code pushed to the branch never causes a conflict, and a
// missed push is simply retried next tick. This also keeps the working copy current with the branch.
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.chdir(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
const minutes = Number(process.env.PUBLISH_MINUTES ?? 15);
const FILES = ["site/data/stats.json", "site/data/equity.ndjson", "site/data/swing.json"];
const sh = (c) => execSync(c, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_EDITOR: "true" } }).trim();
const log = (m) => console.log(`${new Date().toISOString().slice(11, 19)} [publish] ${m}`);
const branch = sh("git rev-parse --abbrev-ref HEAD");

function tick() {
  try { sh("git config user.name"); } catch { try { sh("git config user.name dottrader-bot"); } catch {} }
  try { sh("git config user.email"); } catch { try { sh("git config user.email bot@dottrader.app"); } catch {} }
  try {
    // The stats files on disk are the truth. Snapshot them, sync the repo to GitHub exactly (this drops any
    // local stats commits that never made it out, and any stray local edits to tracked files), then re-commit
    // the snapshot as one fresh commit on top. Nothing to rebase, so nothing can conflict.
    const present = FILES.filter((f) => existsSync(f));
    const snapshot = Object.fromEntries(present.map((f) => [f, readFileSync(f)]));
    sh("git fetch -q origin");
    const remote = sh(`git rev-parse origin/${branch}`);
    const remoteFiles = Object.fromEntries(present.map((f) => { try { return [f, execSync(`git show ${remote}:${f}`, { stdio: ["ignore", "pipe", "ignore"] })]; } catch { return [f, null]; } }));
    const changed = present.filter((f) => !remoteFiles[f] || Buffer.compare(remoteFiles[f], snapshot[f]) !== 0);
    if (!changed.length) { log("nothing new"); return; }
    sh(`git reset -q --hard ${remote}`);
    for (const f of present) writeFileSync(f, snapshot[f]);
    sh(`git add -f ${present.join(" ")}`);
    if (!sh("git diff --cached --name-only")) { log("nothing new"); return; }
    sh(`git commit -q -m "site: stats ${new Date().toISOString()}"`);
    sh(`git push -q origin ${branch}`);
    log(`pushed ${changed.join(", ")}`);
  } catch (e) {
    const msg = String(e.stderr || e.message).trim().split("\n").filter(Boolean).pop() || "unknown error";
    if (/auth|credential|403|denied|could not read Username/i.test(msg)) {
      log(`push rejected (${msg}). Fix once: open PowerShell in this folder, run  git push  and sign in when the browser opens; then this process will succeed on its next try.`);
    } else {
      log(`failed: ${msg}`);
    }
  }
}
log(`branch ${branch}: publishing ${FILES.join(", ")} every ${minutes} min`);
tick();
setInterval(tick, minutes * 60_000);
