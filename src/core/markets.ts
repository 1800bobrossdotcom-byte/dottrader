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
const CBBTC = { address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf" as Address, symbol: "cbBTC", decimals: 8 };

export const MARKETS: Record<string, Market> = {
  // PancakeSwap v3, 0.01%. Deepest cheap venue for the BTC/ETH ratio on Base.
  "cbbtc-weth": {
    key: "cbbtc-weth",
    pool: "0xC211e1f853A898Bd1302385CCdE55f33a8C4B3f3",
    token0: WETH,
    token1: CBBTC,
    feePct: 0.01,
    quote: "token0", // hold WETH between trades; buy cbBTC on dips, sell it back on rallies
  },
};

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
