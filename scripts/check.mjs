#!/usr/bin/env node
// Verifies each bot's .env file before going live:  npm run check
// Never prints a private key; shows a masked form and which wallet it controls.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { privateKeyToAccount } from "viem/accounts";

process.chdir(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
const parse = (f) => Object.fromEntries(readFileSync(f, "utf8").split("\n").map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)).filter(Boolean).map((m) => [m[1], m[2]]));
const ok = (s) => `  \u2713 ${s}`;
const bad = (s) => `  \u2717 ${s}`;

async function rpcCheck(url) {
  try {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) });
    const j = await r.json();
    return j.result === "0x2105" ? ok(`RPC reachable, Base mainnet (${url.replace(/\/v2\/.*/, "/v2/...")})`) : bad(`RPC answered but is not Base (chainId ${j.result})`);
  } catch (e) { return bad(`RPC unreachable: ${e.message}`); }
}
async function balances(url, addr) {
  const call = (method, params) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }).then((r) => r.json()).then((j) => j.result);
  const pad = addr.slice(2).toLowerCase().padStart(64, "0");
  const [eth, dot] = await Promise.all([call("eth_getBalance", [addr, "latest"]), call("eth_call", [{ to: "0x23A2847d772803f9EFC64B4277b782b06296FE51", data: "0x70a08231" + pad }, "latest"])]);
  return { eth: Number(BigInt(eth)) / 1e18, dot: Number(BigInt(dot)) / 1e18 };
}

let any = false;
for (const name of ["w1", "w2", "w3"]) {
  const f = `.env.${name}`;
  if (!existsSync(f)) continue;
  any = true;
  const e = parse(f);
  console.log(`\n${f}  (bot ${name})`);
  console.log(`  wallet   ${e.WALLET_ADDRESS}`);
  console.log(`  mode     ${e.LIVE === "1" ? "LIVE" : "paper"}   data dir ${e.DATA_DIR}`);
  const key = (e.PRIVATE_KEY || "").trim();
  if (!key) console.log(e.LIVE === "1" ? bad("LIVE=1 but no PRIVATE_KEY: this bot will refuse to start") : ok("no key (fine for paper mode)"));
  else if (!/^0x[0-9a-fA-F]{64}$/.test(key.startsWith("0x") ? key : "0x" + key)) console.log(bad(`PRIVATE_KEY is malformed (${key.length} chars); should be 64 hex characters, optionally with 0x`));
  else {
    const k = key.startsWith("0x") ? key : "0x" + key;
    const derived = privateKeyToAccount(k).address;
    const masked = `${k.slice(0, 6)}...${k.slice(-4)}`;
    if (derived.toLowerCase() === (e.WALLET_ADDRESS || "").toLowerCase()) console.log(ok(`key ${masked} controls this wallet`));
    else console.log(bad(`key ${masked} controls ${derived}, not ${e.WALLET_ADDRESS}`));
  }
  const url = e.BASE_RPC_URL || "https://mainnet.base.org";
  console.log(await rpcCheck(url));
  try {
    const b = await balances(url, e.WALLET_ADDRESS);
    console.log(`  balance  ${b.dot.toLocaleString(undefined, { maximumFractionDigits: 0 })} DOT, ${b.eth.toFixed(5)} ETH` + (b.eth < 0.002 ? "   (low ETH: needs >= 0.002 for gas)" : ""));
  } catch { console.log(bad("could not read balances")); }
  console.log(existsSync(`${e.DATA_DIR}/baseline.json`) ? ok("baseline recorded") : bad(`no baseline yet: run  npm run snapshot -- --bot ${name}`));
}
if (!any) console.log("No .env.w1/.env.w2/.env.w3 files found. Run:  npm run setup");
