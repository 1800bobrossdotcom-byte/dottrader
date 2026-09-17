#!/usr/bin/env node
// Sets BASE_RPC_URL in every .env.w* file after verifying the URL answers as Base mainnet.
//   npm run rpc -- https://base-mainnet.g.alchemy.com/v2/YOUR_KEY
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.chdir(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
const url = (process.argv[2] || "").trim();
if (!/^https:\/\/\S+$/.test(url)) {
  console.log("Usage:  npm run rpc -- https://base-mainnet.g.alchemy.com/v2/YOUR_KEY");
  process.exit(1);
}

const masked = url.replace(/(\/v2\/|\/)[A-Za-z0-9_-]{16,}.*$/, "$1…");
const rpc = async (method, params = []) => {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
};

console.log(`checking ${masked} ...`);
try {
  const t0 = Date.now();
  const chainId = await rpc("eth_chainId");
  const block = await rpc("eth_blockNumber");
  const ms = Date.now() - t0;
  if (chainId !== "0x2105") { console.log(`  ✗ that endpoint is chain ${parseInt(chainId, 16)}, not Base (8453). Create the app on Base Mainnet.`); process.exit(1); }
  console.log(`  ✓ Base mainnet, block ${parseInt(block, 16)}, ${ms} ms for two calls`);
} catch (e) {
  console.log(`  ✗ could not reach it: ${e.message}`); process.exit(1);
}

let changed = 0;
for (const name of ["w1", "w2", "w3"]) {
  const f = `.env.${name}`;
  if (!existsSync(f)) continue;
  const lines = readFileSync(f, "utf8").split("\n");
  let seen = false;
  const out = lines.map((l) => (/^\s*BASE_RPC_URL\s*=/.test(l) ? (seen = true, `BASE_RPC_URL=${url}`) : l));
  if (!seen) out.push(`BASE_RPC_URL=${url}`);
  writeFileSync(f, out.join("\n"));
  console.log(`  wrote ${f}`);
  changed++;
}
if (!changed) { console.log("no .env.w* files found; run  npm run setup  first"); process.exit(1); }
console.log(`\nDone. Restart the bots so they pick it up:\n  npx pm2 restart dot-bot-w1 dot-bot-w2\nThen verify:\n  npm run check`);
