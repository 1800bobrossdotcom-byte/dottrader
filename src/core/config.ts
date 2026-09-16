import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

// Minimal .env loader so we don't pull in dotenv.
function loadDotEnv() {
  const p = path.resolve(process.cwd(), ".env");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
loadDotEnv();

const Schema = z.object({
  BASE_RPC_URL: z.string().url().default("https://mainnet.base.org"),
  /** The wallet THIS process trades. Defaults to trading wallet 1; the vault is never a process wallet. */
  WALLET_ADDRESS: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .default("0xcFCFc8e42AEBFC58AB78093217C2C4bB186BAc86"),
  /** Comma-separated list of every wallet that counts toward the journey stack (holding + trading wallets). */
  TRACKED_WALLETS: z
    .string()
    .default(
      "0x8455cF296e1265b494605207e97884813De21950,0xcFCFc8e42AEBFC58AB78093217C2C4bB186BAc86,0x57C4e8C39d72540244FE8eDD302C7C463d6d545a,0x5d58D13A239fD0030CAFcd3a11727783ddeff5A2",
    )
    .transform((v) => v.split(",").map((a) => a.trim()).filter((a) => /^0x[0-9a-fA-F]{40}$/.test(a))),
  /** Where earned DOT is swept. Defaults to the main holding wallet ("the ledger"). */
  VAULT_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/).default("0x8455cF296e1265b494605207e97884813De21950"),
  /** Sweep only once at least this much earned DOT has piled up (keeps gas overhead negligible). */
  SWEEP_MIN_DOT: z.coerce.number().min(0).default(1000),
  /** DOT to keep in the trading wallet as working float; everything earned above it is swept. */
  SWEEP_KEEP_DOT: z.coerce.number().min(0).default(0),
  /** If set, working inventory above this many DOT is also swept as "extra". Unset = keep all inventory working. */
  SWEEP_INVENTORY_ABOVE_DOT: z.coerce.number().min(0).default(Infinity),
  LIVE: z.coerce.number().int().min(0).max(1).default(0),
  PRIVATE_KEY: z.string().optional(),
  TICK_SECONDS: z.coerce.number().positive().default(60),
  TRADING_SLEEVE: z.coerce.number().min(0).max(1).default(0.3),
  MAX_SLIPPAGE_PCT: z.coerce.number().positive().max(5).default(1.0),
  GAS_RESERVE_ETH: z.coerce.number().min(0).default(0.002),
  KYBER_CLIENT_ID: z.string().default("dottrader"),
  DATA_DIR: z.string().default("data"),
  SITE_DATA_DIR: z.string().default("site/data"),
});

export type Config = z.infer<typeof Schema>;
export const config: Config = Schema.parse(process.env);

/** Hard-coded facts about the DOT token and its market on Base. */
export const DOT = {
  chainId: 8453,
  symbol: "DOT",
  decimals: 18,
  address: "0x23A2847d772803f9EFC64B4277b782b06296FE51" as const,
  totalSupply: 1_000_000_000,
  /** Uniswap V4 DOT/ETH pool id (bytes32). This is where ~100% of liquidity lives. */
  poolId: "0x5f547579519beaa158cddd3543604029165f66e86a00c373d0ee90c38784921b" as const,
  /** Uniswap V4 singletons on Base. */
  poolManager: "0x498581fF718922c3f8e6A244956aF099B2652b2b" as const,
  stateView: "0xA3c0c9b65baD0b08107Aa264b0f3dB444b867A71" as const,
  /** The pool uses a dynamic-fee hook; observed swap fee is ~1.1%. Round trip ~2.2% before impact. */
  swapFeePct: 1.1,
  burnAddresses: [
    "0x000000000000000000000000000000000000dEaD",
    "0x0000000000000000000000000000000000000000",
  ] as const,
  links: {
    site: "https://usedot.xyz",
    docs: "https://git.usedot.xyz",
    dexscreener:
      "https://dexscreener.com/base/0x5f547579519beaa158cddd3543604029165f66e86a00c373d0ee90c38784921b",
    basescan: "https://basescan.org/token/0x23A2847d772803f9EFC64B4277b782b06296FE51",
  },
};

export const TOKENS = {
  ETH: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" as const, // KyberSwap native-ETH placeholder
  WETH: "0x4200000000000000000000000000000000000006" as const,
  USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const,
};
