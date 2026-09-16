import { config, DOT, TOKENS } from "../core/config.js";

const BASE = "https://aggregator-api.kyberswap.com/base/api/v1";
const headers = { "x-client-id": config.KYBER_CLIENT_ID, "content-type": "application/json" };

export interface Quote {
  tokenIn: string; tokenOut: string;
  amountIn: bigint; amountOut: bigint;
  amountInUsd: number; amountOutUsd: number; gasUsd: number;
  routerAddress: string;
  routeSummary: unknown;
}

/** Quote via KyberSwap's free aggregator. Routes through the V4 DOT/ETH pool; includes fees + impact. */
export async function quote(tokenIn: string, tokenOut: string, amountIn: bigint): Promise<Quote> {
  const u = new URL(`${BASE}/routes`);
  // KyberSwap rejects checksummed native-token addresses; lowercase everything.
  u.searchParams.set("tokenIn", tokenIn.toLowerCase());
  u.searchParams.set("tokenOut", tokenOut.toLowerCase());
  u.searchParams.set("amountIn", amountIn.toString());
  const r = await fetch(u, { headers: { "x-client-id": config.KYBER_CLIENT_ID } });
  const text = await r.text();
  let j: { code: number; message: string; data?: { routeSummary: Record<string, string>; routerAddress: string } };
  try { j = JSON.parse(text); } catch { throw new Error(`kyber quote: HTTP ${r.status} ${text.slice(0, 200)}`); }
  if (j.code !== 0 || !j.data) throw new Error(`kyber quote: ${j.message} (${text.slice(0, 300)}) url=${u}`);
  const s = j.data.routeSummary;
  return {
    tokenIn, tokenOut, amountIn,
    amountOut: BigInt(s.amountOut),
    amountInUsd: Number(s.amountInUsd), amountOutUsd: Number(s.amountOutUsd),
    gasUsd: Number(s.gasUsd ?? 0) + Number(s.l1FeeUsd ?? 0),
    routerAddress: j.data.routerAddress,
    routeSummary: s,
  };
}

export interface BuiltTx { to: `0x${string}`; data: `0x${string}`; value: bigint; amountOut: bigint; gas: bigint }

/** Turn a quote into calldata for the KyberSwap router. */
export async function build(q: Quote, sender: string, slippagePct: number): Promise<BuiltTx> {
  const r = await fetch(`${BASE}/route/build`, {
    method: "POST", headers,
    body: JSON.stringify({
      routeSummary: q.routeSummary, sender, recipient: sender,
      slippageTolerance: Math.round(slippagePct * 100), // bps
      deadline: Math.floor(Date.now() / 1000) + 120,
      source: config.KYBER_CLIENT_ID,
    }),
  });
  const j = (await r.json()) as { code: number; message: string; data?: { data: `0x${string}`; routerAddress: `0x${string}`; amountOut: string; gas: string; transactionValue?: string } };
  if (j.code !== 0 || !j.data) throw new Error(`kyber build: ${j.message}`);
  const value = q.tokenIn.toLowerCase() === TOKENS.ETH.toLowerCase() ? q.amountIn : 0n;
  return { to: j.data.routerAddress, data: j.data.data, value, amountOut: BigInt(j.data.amountOut), gas: BigInt(j.data.gas || "600000") };
}

export const sellDotQuote = (dot: number) => quote(DOT.address, TOKENS.ETH, BigInt(Math.floor(dot * 1e18)));
export const buyDotQuote = (eth: number) => quote(TOKENS.ETH, DOT.address, BigInt(Math.floor(eth * 1e18)));
