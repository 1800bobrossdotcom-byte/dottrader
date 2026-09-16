#!/usr/bin/env node
// Publishes the bots' stats to GitHub every PUBLISH_MINUTES (default 15) so dottrader.app stays current.
// Runs as a pm2 process next to the bots. Only site/data/stats.json and the equity log are pushed, never env files.
//
// Robust to: unpushed commits from a previous failure, new code pushed to the branch meanwhile (rebases,
// keeping this machine's stats on conflict), and missing credentials (prints a clear hint).
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.chdir(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
const minutes = Number(process.env.PUBLISH_MINUTES ?? 15);
const FILES = ["site/data/stats.json", "site/data/equity.ndjson"];
const sh = (c) => execSync(c, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_EDITOR: "true" } }).trim();
const log = (m) => console.log(`${new Date().toISOString().slice(11, 19)} [publish] ${m}`);
const branch = sh("git rev-parse --abbrev-ref HEAD");

function tick() {
  try { sh("git config user.name"); } catch { try { sh("git config user.name dottrader-bot"); } catch {} }
  try { sh("git config user.email"); } catch { try { sh("git config user.email bot@dottrader.app"); } catch {} }
  try {
    // 1) commit anything new (only files that exist yet)
    const present = FILES.filter((f) => existsSync(f));
    if (present.length) sh(`git add -f ${present.join(" ")}`);
    if (sh("git diff --cached --name-only")) sh(`git commit -q -m "site: stats ${new Date().toISOString()}"`);
    // 2) anything to push? (includes commits left over from an earlier failed push)
    sh("git fetch -q origin");
    const ahead = Number(sh(`git rev-list --count origin/${branch}..HEAD`) || 0);
    if (!ahead) { log("nothing new"); return; }
    // 3) rebase onto origin in case new code landed. --autostash tolerates local edits (e.g. a rewritten
    //    package-lock.json). On a conflict keep THIS machine's stats files.
    const lastLine = (e) => String(e.stderr || e.stdout || e.message).trim().split("\n").filter(Boolean).pop() || "unknown error";
    try {
      sh(`git rebase --autostash -q origin/${branch}`);
    } catch (e1) {
      const inProgress = existsSync(".git/rebase-merge") || existsSync(".git/rebase-apply");
      if (!inProgress) throw new Error(`rebase refused: ${lastLine(e1)}`);
      try {
        const conflicted = sh("git diff --name-only --diff-filter=U").split("\n").filter(Boolean);
        if (conflicted.length) { sh(`git checkout --theirs -- ${conflicted.join(" ")}`); sh(`git add -f ${conflicted.join(" ")}`); }
        sh("git rebase --continue");
      } catch (e2) {
        try { sh("git rebase --abort"); } catch { /* already aborted */ }
        throw new Error(`rebase conflict not resolved: ${lastLine(e2)}`);
      }
    }
    sh(`git push -q origin ${branch}`);
    log(`pushed ${ahead} commit(s)`);
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
