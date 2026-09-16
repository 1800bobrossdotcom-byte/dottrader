#!/usr/bin/env node
// One-time setup, cross-platform (Windows PowerShell, Mac, Linux):
//   npm run setup
// Installs dependencies, asks about each bot, writes .env.wN, records each bot's baseline.
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const isWin = process.platform === "win32";
const npx = isWin ? "npx.cmd" : "npx";
const npm = isWin ? "npm.cmd" : "npm";

const BOTS = [
  ["w1", "0xcFCFc8e42AEBFC58AB78093217C2C4bB186BAc86"],
  ["w2", "0x57C4e8C39d72540244FE8eDD302C7C463d6d545a"],
  ["w3", "0x5d58D13A239fD0030CAFcd3a11727783ddeff5A2"],
];

// --- tiny stdin line reader (works with a real terminal and with piped input) ---
const stdin = process.stdin;
stdin.setEncoding("utf8");
let pending = "";
let ended = false;
stdin.on("end", () => { ended = true; });
function takeLine() {
  const i = pending.indexOf("\n");
  if (i < 0) return null;
  const line = pending.slice(0, i).replace(/\r$/, "");
  pending = pending.slice(i + 1);
  return line;
}
function readLine() {
  return new Promise((res) => {
    const ready = takeLine();
    if (ready !== null) return res(ready);
    if (ended) return res("");
    const onData = (chunk) => {
      pending += chunk;
      const line = takeLine();
      if (line !== null) { stdin.removeListener("data", onData); stdin.pause(); res(line); }
    };
    stdin.on("data", onData);
    stdin.once("end", () => { stdin.removeListener("data", onData); res(pending.replace(/\r$/, "")); pending = ""; });
    stdin.resume();
  });
}
async function ask(q) { process.stdout.write(q); return (await readLine()).trim(); }

// Hidden input for the private key (no echo). Falls back to a normal prompt when not in a real terminal.
async function askHidden(q) {
  if (!stdin.isTTY) return ask(q);
  process.stdout.write(q);
  return new Promise((res) => {
    let buf = "";
    const CTRL_C = String.fromCharCode(3);
    const BACKSPACES = [String.fromCharCode(127), String.fromCharCode(8)];
    const onData = (ch) => {
      for (const c of String(ch)) {
        if (c === "\r" || c === "\n") {
          stdin.setRawMode(false); stdin.removeListener("data", onData); stdin.pause();
          process.stdout.write("\n"); return res(buf.trim());
        }
        if (c === CTRL_C) process.exit(1);
        if (BACKSPACES.includes(c)) buf = buf.slice(0, -1); else buf += c;
      }
    };
    stdin.setRawMode(true); stdin.resume(); stdin.on("data", onData);
  });
}
// Ask for a key, verify it belongs to the bot wallet, and show a masked confirmation. Enter skips (paper mode).
async function askForKey(expectedAddr) {
  const { privateKeyToAccount } = await import("viem/accounts");
  for (;;) {
    let key = await askHidden("  Private key (paste, then Enter; typing is hidden; Enter alone = skip for paper mode): ");
    key = key.trim();
    if (!key) { console.log("  no key: this bot will run in paper mode until you add one"); return ""; }
    if (!key.startsWith("0x")) key = "0x" + key;
    if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
      console.log(`  that is ${key.length - 2} hex characters; a key is exactly 64. Try pasting again (or Enter to skip).`);
      continue;
    }
    const derived = privateKeyToAccount(key).address;
    const masked = `${key.slice(0, 6)}...${key.slice(-4)}`;
    if (derived.toLowerCase() === expectedAddr.toLowerCase()) {
      console.log(`  key ${masked} verified: it controls ${derived}`);
      return key;
    }
    console.log(`  key ${masked} controls ${derived}, NOT this bot's wallet ${expectedAddr}. Paste the right one (or Enter to skip).`);
  }
}

const bold = (s) => `${String.fromCharCode(27)}[1m${s}${String.fromCharCode(27)}[0m`;
const say = (s) => console.log(`\n${bold(s)}`);

say("1/4 Checking Node.js");
const major = Number(process.versions.node.split(".")[0]);
if (major < 22) {
  console.log(`Node ${process.version} is too old; install the LTS (22+) from https://nodejs.org and run again.`);
  process.exit(1);
}
console.log(`Node ${process.version} ok`);

say("2/4 Installing dependencies (1-3 minutes the first time)");
const inst = spawnSync(npm, ["install", "--no-audit", "--no-fund"], { stdio: "inherit", shell: isWin });
if (inst.status !== 0) { console.log("npm install failed; scroll up for the error."); process.exit(1); }
console.log("dependencies installed");

say("3/4 Bot wallets");
for (const [name, addr] of BOTS) {
  const f = `.env.${name}`;
  if (existsSync(f)) { console.log(`${f} already exists, leaving it alone`); continue; }
  console.log(`\nBot ${name} = ${addr}`);
  const yn = await ask("  Set up this bot? type y then Enter (or just Enter to skip): ");
  if (!/^y/i.test(yn)) continue;
  const key = await askForKey(addr);
  const rpc = (await ask("  Base RPC URL (Enter for public https://mainnet.base.org): ")) || "https://mainnet.base.org";
  const example = readFileSync(".env.example", "utf8")
    .split("\n")
    .filter((l) => !/^(WALLET_ADDRESS|PRIVATE_KEY|DATA_DIR|LIVE|BASE_RPC_URL)=/.test(l));
  const body = [...example, `WALLET_ADDRESS=${addr}`, `PRIVATE_KEY=${key}`, `DATA_DIR=data/${name}`, "LIVE=0", `BASE_RPC_URL=${rpc}`, ""].join("\n");
  writeFileSync(f, body);
  try { chmodSync(f, 0o600); } catch { /* windows */ }
  mkdirSync(`data/${name}`, { recursive: true });
  console.log(`  wrote ${f} (LIVE=0, paper mode)`);
  console.log("  reading balances from Base to record the starting point (10-20 seconds)...");
  const snap = spawnSync(npx, ["tsx", "src/cli/snapshot.ts", "--bot", name], { stdio: ["ignore", "pipe", "pipe"], shell: isWin, encoding: "utf8" });
  if (snap.status === 0) {
    console.log("  " + snap.stdout.trim().split("\n").pop());
    console.log(`  baseline recorded in data/${name}/baseline.json`);
  } else {
    console.log(`  could not reach Base right now; run later:  npm run snapshot -- --bot ${name}`);
  }
}

say("4/4 Done");
const kill = isWin ? "New-Item data\\w1\\KILL" : "touch data/w1/KILL";
console.log(`Next:
  npx pm2 start ecosystem.config.cjs     start every bot you set up (paper mode)
  npx pm2 logs                           watch them think (Ctrl+C stops watching, bots keep running)
  npx pm2 stop all                       stop

Go live: edit .env.w1 (and w2, w3), set LIVE=1 and paste the PRIVATE_KEY, then:  npx pm2 restart all
Pause one bot:  ${kill}   (delete that file to resume)`);
process.exit(0);
