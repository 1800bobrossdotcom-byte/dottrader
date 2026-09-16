import { Agent, type Ctx } from "./base.js";
import type { Signal } from "../core/types.js";
import { config } from "../core/config.js";

interface AccState { spentTodayUsd: number; day: string; lastBuyTs: number }
const DCA_USD_PER_DAY = Number(process.env.DCA_USD_PER_DAY ?? 0);

/**
 * Accumulator agent. Converts fresh ETH/USDC in the wallet into DOT on a daily
 * budget (DCA_USD_PER_DAY), buying harder into dips and right after burns.
 * With no budget configured it stays silent - it never spends the gas reserve.
 */
export class AccumulatorAgent extends Agent<AccState> {
  readonly name = "accumulate";
  constructor() { super({ spentTodayUsd: 0, day: "", lastBuyTs: 0 }); }

  async propose(ctx: Ctx): Promise<Signal[]> {
    if (DCA_USD_PER_DAY <= 0) return [];
    const day = new Date().toISOString().slice(0, 10);
    if (this.state.day !== day) { this.state.day = day; this.state.spentTodayUsd = 0; this.save(); }
    const remaining = DCA_USD_PER_DAY - this.state.spentTodayUsd;
    if (remaining <= 0.5) return [];
    if (Date.now() - this.state.lastBuyTs < 3.6e6) return [];

    const spendableEthUsd = Math.max(0, ctx.ledger.state.portfolio.eth - config.GAS_RESERVE_ETH - 0.001) * ctx.snap.ethUsd;
    const spendable = spendableEthUsd + ctx.ledger.state.portfolio.usdc;
    if (spendable < 1) return [];

    // Base clip = budget / 12 buys per day. Boost into dips and after burns.
    let clip = DCA_USD_PER_DAY / 12;
    let why = "dca";
    if (ctx.snap.priceChange.h24 < -8) { clip *= 2; why += "+dip"; }
    if ((ctx.intel?.burns24h ?? 0) > 0) { clip *= 1.5; why += "+burn"; }
    const usd = Math.min(clip, remaining, spendable);
    return [{ agent: this.name, side: "BUY_DOT", conviction: 0.6, size: { usd },
      reason: `${why}: $${usd.toFixed(2)} of $${DCA_USD_PER_DAY}/day` }];
  }
  onFill(usd: number) { this.state.spentTodayUsd += usd; this.state.lastBuyTs = Date.now(); this.save(); }
}
