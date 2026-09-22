/**
 * Read a pool's own description of itself, so market definitions are never hand-typed.
 *
 *   npx tsx src/cli/probe-pools.ts 0x7C74... 0x7ec6...
 *
 * Prints a ready-to-paste `Market` for each address. This exists because both of the mistakes that
 * nearly put money on a reversed strategy were transcription mistakes: a hand-typed EIP-55 checksum
 * that viem rejected, and a price orientation assumed rather than derived from which token the pool
 * calls token0. The chain knows both. Ask it.
 *
 * Requests are issued one at a time with a pause between them. Firing them in parallel is what made
 * the public Base RPC drop five of six reads with "RPC Request failed".
 */
import { createPublicClient, http, parseAbi, getAddress, type Address } from "viem";
import { base } from "viem/chains";
import { config } from "../core/config.js";
import { quotePerBase, slot0PriceAbi, type Market } from "../core/markets.js";

const poolAbi = parseAbi([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function fee() view returns (uint24)",
  "function liquidity() view returns (uint128)",
]);
const erc20Abi = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);

const client = createPublicClient({ chain: base, transport: http(config.BASE_RPC_URL) });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Gap between calls. The public Base RPC answers "over rate limit" well below one call a second. */
const PACE_MS = Number(process.env.PROBE_PACE_MS ?? 1500);

/** One call at a time, with backoff. A public RPC will refuse a burst and succeed on a trickle. */
async function read<T>(what: string, fn: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let i = 0; i < 5; i++) {
    try {
      const v = await fn();
      await sleep(PACE_MS);
      return v;
    } catch (e) {
      last = e;
      await sleep(PACE_MS * 2 ** (i + 1));
    }
  }
  throw new Error(`${what}: ${(last as Error)?.message ?? last}`);
}

async function token(address: Address) {
  const symbol = await read(`symbol ${address}`, () => client.readContract({ address, abi: erc20Abi, functionName: "symbol" }));
  const decimals = await read(`decimals ${address}`, () => client.readContract({ address, abi: erc20Abi, functionName: "decimals" }));
  return { address: getAddress(address), symbol, decimals: Number(decimals) };
}

async function probe(raw: string) {
  const pool = getAddress(raw) as Address;
  const t0 = await read(`token0 ${pool}`, () => client.readContract({ address: pool, abi: poolAbi, functionName: "token0" }));
  const t1 = await read(`token1 ${pool}`, () => client.readContract({ address: pool, abi: poolAbi, functionName: "token1" }));
  const fee = await read(`fee ${pool}`, () => client.readContract({ address: pool, abi: poolAbi, functionName: "fee" }));
  const liq = await read(`liquidity ${pool}`, () => client.readContract({ address: pool, abi: poolAbi, functionName: "liquidity" }));
  const sqrt = await read(`slot0 ${pool}`, () => client.readContract({ address: pool, abi: slot0PriceAbi, functionName: "slot0" }));

  const token0 = await token(t0 as Address);
  const token1 = await token(t1 as Address);
  const WETH = "0x4200000000000000000000000000000000000006";
  // The engine holds and measures in ETH, so the WETH side is the quote wherever the pool puts it.
  const quote: "token0" | "token1" =
    getAddress(token0.address) === getAddress(WETH) ? "token0"
    : getAddress(token1.address) === getAddress(WETH) ? "token1"
    : "token0";
  const m: Market = {
    key: `${(quote === "token0" ? token1 : token0).symbol.toLowerCase()}-weth`,
    pool, token0, token1, feePct: Number(fee) / 10_000, quote,
  };
  const baseTok = quote === "token0" ? token1 : token0;
  // In-range liquidity, valued in the quote token. A pool that quotes a nice price on a thousand
  // dollars of depth will swallow the whole edge in slippage on the trade you actually send.
  const q = quote === "token0" ? token0 : token1;
  const depthQuote = (Number(liq) / Number(sqrt) * 2 ** 96) / 10 ** q.decimals;
  return { m, price: quotePerBase(sqrt, m), baseSymbol: baseTok.symbol, depthQuote, quoteSymbol: q.symbol };
}

async function main() {
  const addrs = process.argv.slice(2).filter((a) => a.startsWith("0x"));
  if (!addrs.length) { console.error("usage: probe-pools.ts <pool> [pool...]"); process.exit(1); }
  for (const a of addrs) {
    try {
      const { m, price, baseSymbol, depthQuote, quoteSymbol } = await probe(a);
      console.log(`\n// ${baseSymbol}/${quoteSymbol} — ${m.feePct}%/side, 1 ${baseSymbol} = ${price.toPrecision(8)} ${quoteSymbol}, ~${depthQuote.toPrecision(4)} ${quoteSymbol} in range`);
      console.log(`  ${JSON.stringify(m.key)}: ${JSON.stringify(m, null, 2).replace(/\n/g, "\n  ")},`);
    } catch (e) {
      console.error(`\n// ${a} FAILED: ${(e as Error).message}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
