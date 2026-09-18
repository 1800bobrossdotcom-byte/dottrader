import { createPublicClient, http, parseAbi, type Address, type Hex } from "viem";
import { base } from "viem/chains";
import { config, DOT, TOKENS } from "./config.js";
import type { Portfolio } from "./types.js";

export const publicClient = createPublicClient({
  chain: base,
  transport: http(config.BASE_RPC_URL, { batch: true, retryCount: 3 }),
});

const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function transfer(address,uint256) returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

const stateView = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
  "function getLiquidity(bytes32 poolId) view returns (uint128)",
]);

const transferEvent = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"])[0];
export { erc20 };

const multicall3 = parseAbi(["function getEthBalance(address) view returns (uint256)"]);
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;

// Read-after-write: an RPC can still serve a block that predates a swap we just confirmed, so a balance
// read taken seconds after a fill can report the pre-trade stack. Every write records its block here, and
// every balance read waits for the node to catch up and is then pinned to one block so wallets can't tear.
let minBlock = 0n;
export function noteWriteBlock(b: bigint) { if (b > minBlock) minBlock = b; }

async function readBlock(timeoutMs = 20_000): Promise<bigint | undefined> {
  if (minBlock === 0n) return undefined;
  const until = Date.now() + timeoutMs;
  for (;;) {
    const n = await publicClient.getBlockNumber({ cacheTime: 0 });
    if (n >= minBlock) return n;
    if (Date.now() >= until) return undefined; // node is lagging badly; a stale read beats no read at all
    await new Promise((r) => setTimeout(r, 1_000));
  }
}

/** Balances for every tracked wallet, plus the sum. One multicall so public RPCs don't rate-limit us. */
export async function getTrackedPortfolios() {
  const wallets = config.TRACKED_WALLETS as Address[];
  const blockNumber = await readBlock();
  const res = await publicClient.multicall({
    allowFailure: false,
    blockNumber,
    contracts: wallets.flatMap((w) => [
      { address: MULTICALL3, abi: multicall3, functionName: "getEthBalance", args: [w] } as const,
      { address: DOT.address, abi: erc20, functionName: "balanceOf", args: [w] } as const,
      { address: TOKENS.USDC, abi: erc20, functionName: "balanceOf", args: [w] } as const,
    ]),
  });
  const each: Portfolio[] = wallets.map((_, i) => ({
    eth: Number(res[i * 3]) / 1e18, dot: Number(res[i * 3 + 1]) / 1e18, usdc: Number(res[i * 3 + 2]) / 1e6,
  }));
  const total = each.reduce((a, p) => ({ dot: a.dot + p.dot, eth: a.eth + p.eth, usdc: a.usdc + p.usdc }), { dot: 0, eth: 0, usdc: 0 });
  return { wallets: wallets.map((address, i) => ({ address, ...each[i] })), total, block: blockNumber ? Number(blockNumber) : null };
}

export async function getPortfolio(addr: Address = config.WALLET_ADDRESS as Address): Promise<Portfolio> {
  const blockNumber = await readBlock();
  const [eth, dot, usdc] = await publicClient.multicall({
    allowFailure: false,
    blockNumber,
    contracts: [
      { address: MULTICALL3, abi: multicall3, functionName: "getEthBalance", args: [addr] },
      { address: DOT.address, abi: erc20, functionName: "balanceOf", args: [addr] },
      { address: TOKENS.USDC, abi: erc20, functionName: "balanceOf", args: [addr] },
    ],
  });
  return { eth: Number(eth) / 1e18, dot: Number(dot) / 1e18, usdc: Number(usdc) / 1e6 };
}

/** Reads the V4 pool's current price straight from the chain. Returns DOT per ETH and ETH per DOT. */
export async function getPoolState() {
  const [sqrtPriceX96, tick, , lpFee] = await publicClient.readContract({
    address: DOT.stateView,
    abi: stateView,
    functionName: "getSlot0",
    args: [DOT.poolId as Hex],
  });
  // token0 = ETH (address 0), token1 = DOT. price = token1/token0 = DOT per ETH.
  const p = (Number(sqrtPriceX96) / 2 ** 96) ** 2;
  return { dotPerEth: p, ethPerDot: 1 / p, tick, lpFee };
}

/** Sum DOT transferred to burn addresses between two blocks (chunked for public RPC's 2000-block cap). */
export async function scanBurns(fromBlock: bigint, toBlock: bigint) {
  let total = 0;
  const events: { block: number; from: string; dot: number }[] = [];
  const step = 1_900n;
  for (let start = fromBlock; start <= toBlock; start += step + 1n) {
    const end = start + step > toBlock ? toBlock : start + step;
    const logs = await publicClient.getLogs({
      address: DOT.address,
      event: transferEvent,
      args: { to: [...DOT.burnAddresses] as Address[] },
      fromBlock: start,
      toBlock: end,
    });
    for (const l of logs) {
      const dot = Number(l.args.value ?? 0n) / 1e18;
      total += dot;
      events.push({ block: Number(l.blockNumber), from: l.args.from ?? "", dot });
    }
  }
  return { total, events };
}

/** Count buy/sell swaps in the main pool over a block range by reading PoolManager Swap events. */
export async function scanSwaps(fromBlock: bigint, toBlock: bigint) {
  const swapEvent = parseAbi([
    "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)",
  ])[0];
  const out: { block: number; ethDelta: number; dotDelta: number; isBuy: boolean }[] = [];
  const step = 1_900n;
  for (let start = fromBlock; start <= toBlock; start += step + 1n) {
    const end = start + step > toBlock ? toBlock : start + step;
    const logs = await publicClient.getLogs({
      address: DOT.poolManager,
      event: swapEvent,
      args: { id: DOT.poolId as Hex },
      fromBlock: start,
      toBlock: end,
    });
    for (const l of logs) {
      // V4 emits the swapper's BalanceDelta: positive = swapper receives, negative = swapper pays.
      // token0 = ETH, token1 = DOT, so dotDelta > 0 means someone bought DOT.
      const ethDelta = Number(l.args.amount0 ?? 0n) / 1e18;
      const dotDelta = Number(l.args.amount1 ?? 0n) / 1e18;
      out.push({ block: Number(l.blockNumber), ethDelta, dotDelta, isBuy: dotDelta > 0 });
    }
  }
  return out;
}

export async function latestBlock() {
  return publicClient.getBlockNumber();
}
