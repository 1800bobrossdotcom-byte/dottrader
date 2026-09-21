import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

// Minimal .env loader so we don't pull in dotenv. `--bot w1` (or BOT=w1) loads .env.w1 first, then .env.
function loadEnvFile(p: string) {
  if (!existsSync(p)) return false;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
  return true;
}
function loadDotEnv() {
  const i = process.argv.findIndex((a) => a === "--bot" || a.startsWith("--bot="));
  const bot = i >= 0 ? (process.argv[i].includes("=") ? process.argv[i].split("=")[1] : process.argv[i + 1]) : process.env.BOT;
  if (bot) {
    if (!loadEnvFile(path.resolve(process.cwd(), `.env.${bot}`))) {
      console.error(`no .env.${bot} file found; run: npm run setup`);
      process.exit(1);
    }
  }
  loadEnvFile(path.resolve(process.cwd(), ".env"));
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
  /** Distance between grid sell levels, in percent. Tighter = more, smaller round trips. */
  GRID_SPACING_PCT: z.coerce.number().min(1).max(25).default(3.5),
  /** How far below its sell price a slice is bought back, in percent. Floored at the fee cost (see FEE_FLOOR_PCT). */
  GRID_EDGE_PCT: z.coerce.number().min(0).max(25).default(3.0),
  /** Rungs on each side of the anchor. More rungs = smaller slices and more trades across a big move. */
  GRID_LEVELS: z.coerce.number().int().min(1).max(24).default(8),
  /** Let idle ETH buy dips below the anchor and sell them back higher. Doubles the opportunities per swing. */
  GRID_TWO_SIDED: z.coerce.number().int().min(0).max(1).default(1),
  /**
   * Whether the grid may open NEW short lots (sell DOT expecting to buy it back lower).
   * Set to 0 in a strong uptrend: the grid has no trend filter, so it reads every leg up as a level
   * to sell and ends up short DOT all the way. Buy-backs, buy rungs and long closes keep working,
   * so existing lots are still managed to their targets — the bot just stops adding new ones.
   */
  GRID_ALLOW_NEW_SHORTS: z.coerce.number().int().min(0).max(1).default(1),
  /** Minimum gap between one agent's fills. The grid's own rungs enforce the price distance. */
  AGENT_COOLDOWN_SECONDS: z.coerce.number().min(0).default(180),
  /** Orders the swarm may execute in a single tick, across all agents. */
  MAX_FILLS_PER_TICK: z.coerce.number().int().min(1).max(10).default(2),
  /** Blocks per eth_getLogs call. Alchemy's free tier caps this at 10; paid plans allow far more. */
  LOGS_MAX_BLOCK_RANGE: z.coerce.number().int().min(1).max(10_000).default(10),
  /** Ceiling on blocks a single intel tick will scan, so catching up after an outage stays bounded. */
  LOGS_BLOCKS_PER_TICK: z.coerce.number().int().min(10).max(100_000).default(600),
  KYBER_CLIENT_ID: z.string().default("dottrader"),
  DATA_DIR: z.string().default("data"),
  SITE_DATA_DIR: z.string().default("site/data"),
});

export type Config = z.infer<typeof Schema>;
export const config: Config = Schema.parse(process.env);

/**
 * A round trip costs two swap fees (~1.1% each) plus a little price impact: ~2.4% measured. Buying back less
 * than this below the sell price LOSES DOT, so the buy-back gap is floored here, whatever the env file says.
 */
export const FEE_FLOOR_PCT = 2.6;
if (config.GRID_EDGE_PCT < FEE_FLOOR_PCT) {
  console.warn(`GRID_EDGE_PCT=${config.GRID_EDGE_PCT} is below the ${FEE_FLOOR_PCT}% fee floor and would lose DOT; using ${FEE_FLOOR_PCT}%`);
  config.GRID_EDGE_PCT = FEE_FLOOR_PCT;
}

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

/**
 * The journey is the two trading bots, and only the two trading bots.
 *
 * Recorded from chain when the bots were funded on 2026-09-16: w1 got 51,138.99 DOT + 0.01250045 ETH and
 * w2 got 50,000 DOT + 0.0075 ETH. The gas ETH is counted because the grid trades DOT against ETH, so ETH is
 * working capital, not an expense — and because counting it at the end but not the start would inflate the gain.
 *
 * Deliberately EXCLUDED: the vault's retained 9,000 DOT and its gas ETH (see VAULT_BASELINE). The vault is
 * passive. It is not traded, so it is not part of the journey; only what the bots sweep INTO it counts.
 */
export const JOURNEY = {
  startedAt: "2026-09-16T21:52:00.000Z",
  dot: 101_138.99,
  eth: 0.02000045081268512,
  usdc: 0,
  priceUsd: 0.005863,
  ethUsd: 2409.782161939992,
  note: "The journey is the two trading bots. The vault's original 9,000 DOT is excluded; only DOT swept into it counts.",
};

/** DOT-equivalent the bots were funded with (DOT + gas ETH valued in DOT at the funding price). */
export const JOURNEY_START_DOT_EQ =
  JOURNEY.dot + (JOURNEY.eth * JOURNEY.ethUsd + JOURNEY.usdc) / JOURNEY.priceUsd;

/**
 * The vault's holdings at the moment the bots were funded. Subtracted from the vault's live balance so that
 * only swept profit counts toward the journey. Sweeps still go to the vault as before.
 */
export const VAULT_BASELINE = { dot: 9_000, eth: 0.001492486074377686 };

export const TOKENS = {
  ETH: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" as const, // KyberSwap native-ETH placeholder
  WETH: "0x4200000000000000000000000000000000000006" as const,
  USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const,
};
