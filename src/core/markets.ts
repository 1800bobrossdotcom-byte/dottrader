import type { Address } from "viem";

/**
 * A pair the swing engine can work.
 *
 * Two properties decide whether a pair is tradeable at all, and both are structural rather than a
 * matter of timing:
 *
 *  - `feePct` per swap. A round trip pays it twice, so it is the floor under every profitable move.
 *    DOT/ETH charges 1.1% a side: a re-arming swing trader loses money there at every threshold,
 *    because the toll is larger than the swings. cbBTC/WETH charges 0.01%, which is 110x cheaper.
 *  - Whether the pair oscillates or trends. Buying dips and selling rallies needs something to
 *    revert to. A ratio of two correlated majors wobbles around a level; a token in price discovery
 *    does not, and selling into its rise is how the DOT grid lost 9,725 DOT.
 */
export interface Market {
  key: string;
  /** Uniswap-V3-style pool, read directly for price; no API in the hot path. */
  pool: Address;
  /** token0/token1 as the pool orders them, with their decimals. */
  token0: { address: Address; symbol: string; decimals: number };
  token1: { address: Address; symbol: string; decimals: number };
  /** Fee per swap, in percent. */
  feePct: number;
  /**
   * Which side the engine holds between trades — the one it is trying to accumulate. Its P&L is
   * measured in this token, and for the DOT journey that means ETH: the swing engine's winnings
   * are what the accumulator later spends on DOT.
   */
  quote: "token0" | "token1";
}

const WETH = { address: "0x4200000000000000000000000000000000000006" as Address, symbol: "WETH", decimals: 18 };

/**
 * Every field here was read off the pool by `src/cli/probe-pools.ts`, not typed by hand.
 *
 * Both of the mistakes that nearly put real money on a reversed strategy were transcription
 * mistakes — a hand-typed EIP-55 checksum viem rejected, and a price orientation assumed rather
 * than derived from which token the pool calls token0. VIRTUAL settles that argument: WETH is its
 * token1, the opposite of every other pool here, so a copied `quote: "token0"` would have run that
 * market upside down.
 *
 * `feePct` is a snapshot, not a constant: these are dynamic-fee pools and the live value is read
 * each cycle (see `readFeePct`). The number here is only the fallback and the screening figure.
 */
export const MARKETS: Record<string, Market> = {
  // 0.01%/side, ~47,000 WETH in range. The BTC/ETH ratio: two correlated majors, so it wobbles
  // around a level instead of trending away — the one property this strategy needs.
  "cbbtc-weth": {
    key: "cbbtc-weth",
    pool: "0xC211e1f853A898Bd1302385CCdE55f33a8C4B3f3",
    token0: WETH,
    token1: { address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf" as Address, symbol: "cbBTC", decimals: 8 },
    feePct: 0.01,
    quote: "token0",
  },

  // 0.01%/side, ~11,600 WETH in range. ETH against the dollar. Buying "cheap USDC" is selling ETH
  // into strength and buying it back on the dip, which is the same trade the accumulator wants.
  "usdc-weth": {
    key: "usdc-weth",
    pool: "0x72AB388E2E2F6FaceF59E3C3FA2C4E29011c2D38",
    token0: WETH,
    token1: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address, symbol: "USDC", decimals: 6 },
    feePct: 0.01,
    quote: "token0",
  },

  // 0.05%/side, ~2.7m WETH in range. NOTE the orientation: WETH is token1 in this pool.
  "virtual-weth": {
    key: "virtual-weth",
    pool: "0x9c087Eb773291e50CF6c6a90ef0F4500e349B903",
    token0: { address: "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b" as Address, symbol: "VIRTUAL", decimals: 18 },
    token1: WETH,
    feePct: 0.05,
    quote: "token1",
  },

  // 0.05%/side, ~2,900 WETH in range. Thinner than the rest; fine at this size, not at scale.
  "cbxrp-weth": {
    key: "cbxrp-weth",
    pool: "0xB90fe999Be6869AF0aFC557DCCfBE169EA3403D6",
    token0: WETH,
    token1: { address: "0xcb585250f852C6c6bf90434AB21A00f02833a4af" as Address, symbol: "cbXRP", decimals: 6 },
    feePct: 0.05,
    quote: "token0",
  },

  // NOT in the live set. Screened at the 0.05% tier, but the pool actually charges ~0.28%/side —
  // a 0.57% round trip, five times the cost the +69% backtest was run against. That number is void
  // until it is re-run at the real fee, and the threshold surface already looked like noise-fitting
  // (+50.3 / +0.2 / +4.9 / -0.9 / +5.6 across neighbouring thresholds is not an edge, it is a fit).
  "vvv-weth": {
    key: "vvv-weth",
    pool: "0x7eC6C9D993D9832Aa654593f2Dbc21303650Bc6c",
    token0: WETH,
    token1: { address: "0xacfE6019Ed1A7Dc6f7B508C02d1b04ec88cC21bf" as Address, symbol: "VVV", decimals: 18 },
    feePct: 0.2862,
    quote: "token0",
  },
};

/** The markets the live engine works unless told otherwise. `vvv-weth` is deliberately absent. */
export const LIVE_MARKETS = ["cbbtc-weth", "usdc-weth", "virtual-weth", "cbxrp-weth"];

/** The token the engine is trying to accumulate on this market (always the ETH side here). */
export function quoteToken(m: Market) { return m.quote === "token0" ? m.token0 : m.token1; }
/** The token it buys and sells to accumulate the quote. */
export function baseToken(m: Market) { return m.quote === "token0" ? m.token1 : m.token0; }

/** Token1 per token0, the raw orientation a v3 pool prices in (for cbBTC/WETH: cbBTC per WETH). */
export function token1PerToken0(sqrtPriceX96: bigint, m: Market): number {
  const raw = (Number(sqrtPriceX96) / 2 ** 96) ** 2;
  return raw * 10 ** (m.token0.decimals - m.token1.decimals);
}

/**
 * How much of the quote token one unit of the base token costs — the only orientation the swing
 * logic may use, because it is the one where a falling number means the base got CHEAPER.
 *
 * A pool prices token1 in token0. When the quote is token0 that is upside down for us: cbBTC per
 * WETH *falling* means you get fewer cbBTC for your ETH, i.e. cbBTC became dearer. Feeding that
 * series to "buy the dip" buys every rally and sells every low — which is what this did before the
 * reciprocal was applied, and the backtest that justified the strategy ran on WETH per cbBTC.
 */
export function quotePerBase(sqrtPriceX96: bigint, m: Market): number {
  const t1PerT0 = token1PerToken0(sqrtPriceX96, m);
  return m.quote === "token0" ? 1 / t1PerT0 : t1PerT0;
}

/**
 * Just the price word out of `slot0()`.
 *
 * Uniswap V3 returns seven values there; Aerodrome/Slipstream pools return six, and asking for the
 * full Uniswap tuple fails on them with "Position 223 is out of bounds". `sqrtPriceX96` is the first
 * word in both, and the price is all this engine wants, so decode that and ignore the rest.
 */
export const slot0PriceAbi = [{
  type: "function", name: "slot0", stateMutability: "view", inputs: [],
  outputs: [{ name: "sqrtPriceX96", type: "uint160" }],
}] as const;

/**
 * Current fee, in hundredths of a basis point.
 *
 * These pools set their fee dynamically: the same VVV pool answered 0.2763% and 0.2862% minutes
 * apart. A threshold checked once against a hardcoded fee can therefore be above the floor at boot
 * and below it an hour later, which is how a strategy quietly starts losing on every round trip.
 */
export const poolFeeAbi = [{
  type: "function", name: "fee", stateMutability: "view", inputs: [],
  outputs: [{ name: "", type: "uint24" }],
}] as const;
