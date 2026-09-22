/**
 * What the wallets actually hold, right now, read one call at a time.
 *
 *   npx tsx src/cli/watch-wallets.ts
 *   npx tsx src/cli/watch-wallets.ts --json
 *
 * This exists because the hourly check was being hand-written each time and got it wrong. The
 * public Base RPC drops calls under load, and a JSON-RPC batch does not avoid that — it hides it,
 * returning an `error` and no `result` for one id while the rest succeed. A reader that defaults a
 * missing result to zero then reports a perfectly healthy wallet as drained, and, far worse, can
 * report a wallet that has started trading as untouched: a dropped balanceOf on cbBTC is
 * indistinguishable from holding no cbBTC.
 *
 * So every read here is serial, spaced, retried, and allowed to fail loudly. A balance this cannot
 * establish is reported as UNKNOWN and exits non-zero. It never guesses zero.
 */
import { erc20 } from "../core/chain.js";
import { config } from "../core/config.js";
import { MARKETS, LIVE_MARKETS, baseToken } from "../core/markets.js";
import { createPublicClient, http, getAddress, type Address } from "viem";
import { base } from "viem/chains";

const client = createPublicClient({ chain: base, transport: http(config.BASE_RPC_URL) });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const DOT = "0x23A2847d772803f9EFC64B4277b782b06296FE51" as Address;
const WALLETS: Record<string, Address> = {
  w1: "0xcFCFc8e42AEBFC58AB78093217C2C4bB186BAc86",
  w2: "0x57C4e8C39d72540244FE8eDD302C7C463d6d545a",
};

/** A value that was read, or an explicit admission that it could not be. */
type Reading = { ok: true; value: number } | { ok: false; error: string };

async function attempt<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  let last = "";
  for (let i = 0; i < 4; i++) {
    try {
      const value = await fn();
      await sleep(900); // the rate limit bites at roughly two calls a second
      return { ok: true, value };
    } catch (e) {
      last = (e as Error).message.split("\n")[0];
      await sleep(1200 * 2 ** i);
    }
  }
  return { ok: false, error: last };
}

async function tokenBalance(token: Address, holder: Address, decimals: number): Promise<Reading> {
  const r = await attempt(() => client.readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [holder] }));
  return r.ok ? { ok: true, value: Number(r.value) / 10 ** decimals } : r;
}

async function main() {
  const asJson = process.argv.includes("--json");
  const out: Record<string, unknown> = { at: new Date().toISOString() };
  let unreadable = 0;
  const show = (label: string, r: Reading | { ok: false; error: string }, digits = 8) => {
    if (r.ok) { if (!asJson) console.log(`  ${label.padEnd(12)} ${r.value.toFixed(digits)}`); return r.value; }
    unreadable++;
    if (!asJson) console.log(`  ${label.padEnd(12)} UNKNOWN — read failed: ${r.error}`);
    return null;
  };

  for (const [name, addr] of Object.entries(WALLETS)) {
    if (!asJson) console.log(`\n${name} ${getAddress(addr)}`);
    const w: Record<string, unknown> = {};

    const nonce = await attempt(() => client.getTransactionCount({ address: addr }));
    w.txCount = show("txcount", nonce.ok ? { ok: true, value: nonce.value } : nonce, 0);

    const eth = await attempt(() => client.getBalance({ address: addr }));
    w.eth = show("ETH", eth.ok ? { ok: true, value: Number(eth.value) / 1e18 } : eth);

    w.dot = show("DOT", await tokenBalance(DOT, addr, 18), 2);

    // Only w1 trades the swing markets; reading them for w2 would be four pointless calls into a
    // rate limiter, and every wasted call makes a real read more likely to be dropped.
    if (name === "w1") {
      const held: Record<string, unknown> = {};
      for (const key of LIVE_MARKETS) {
        const t = baseToken(MARKETS[key]);
        held[t.symbol] = show(t.symbol, await tokenBalance(t.address, addr, t.decimals));
      }
      w.swingTokens = held;
    }
    out[name] = w;
  }

  if (asJson) console.log(JSON.stringify(out, null, 2));
  if (unreadable) {
    console.error(`\n${unreadable} balance(s) could not be read. This is NOT a report of zero — re-run before concluding anything.`);
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
