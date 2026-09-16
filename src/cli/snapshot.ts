/** Records the journey's starting point: balances + price right now. Run once. */
import { existsSync } from "node:fs";
import { config } from "../core/config.js";
import { getTrackedPortfolios } from "../core/chain.js";
import { fetchDexScreener } from "../data/market.js";
import { Store } from "../data/store.js";
import type { Baseline } from "../core/ledger.js";

const store = new Store();
if (existsSync(store.p("baseline.json")) && !process.argv.includes("--force")) {
  console.log("baseline.json already exists; pass --force to overwrite (this resets the journey start).");
  process.exit(0);
}
const [tp, m] = await Promise.all([getTrackedPortfolios(), fetchDexScreener()]);
const p = tp.total;
const b: Baseline = {
  startedAt: new Date().toISOString(), wallet: config.WALLET_ADDRESS,
  wallets: tp.wallets,
  dot: p.dot, eth: p.eth, usdc: p.usdc, priceUsd: m.priceUsd, ethUsd: m.ethUsd,
  note: "Journey start across all tracked wallets. Every number on dottrader.app is measured against this.",
};
store.writeJson("baseline.json", b);
if (existsSync(store.p("state.json")) && process.argv.includes("--force")) store.writeJson("state.json", null);
console.log(JSON.stringify(b, null, 2));
console.log(`\nStart: ${p.dot.toLocaleString()} DOT + ${p.eth.toFixed(5)} ETH + ${p.usdc} USDC across ${tp.wallets.length} wallets ≈ $${(p.dot * m.priceUsd + p.eth * m.ethUsd + p.usdc).toFixed(2)} at $${m.priceUsd}`);
