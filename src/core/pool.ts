/**
 * Reading a pool's price and fee, patiently.
 *
 * The public Base RPC answers "over rate limit" after roughly six calls in three seconds, so every
 * read here retries with backoff rather than throwing on the first refusal. A dropped read must
 * stay a dropped read: `readPrice` throws and `readFee` falls back to the market's screening
 * figure, because a price silently reported as zero would look to a dip-buyer like a free asset.
 */
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { config } from "./config.js";
import { quotePerBase, slot0PriceAbi, poolFeeAbi, type Market } from "./markets.js";

const reader = createPublicClient({ chain: base, transport: http(config.BASE_RPC_URL) });
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** ETH per unit of the market's base token. Throws if the pool cannot be read. */
export async function readPrice(m: Market): Promise<number> {
  let last: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      const sqrt = await reader.readContract({ address: m.pool, abi: slot0PriceAbi, functionName: "slot0" });
      return quotePerBase(sqrt, m);
    } catch (e) { last = e; await sleep(700 * 2 ** i); }
  }
  throw last;
}

/** Live fee per swap in percent; these pools price dynamically. Falls back to the stored figure. */
export async function readFee(m: Market): Promise<number> {
  try {
    const f = await reader.readContract({ address: m.pool, abi: poolFeeAbi, functionName: "fee" });
    return Number(f) / 10_000;
  } catch {
    return m.feePct;
  }
}
