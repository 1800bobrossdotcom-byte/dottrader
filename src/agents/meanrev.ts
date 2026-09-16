import { Agent, type Ctx } from "./base.js";
import type { Signal } from "../core/types.js";
import { config } from "../core/config.js";

interface MRState { lastSellTs: number }
const MAX_LOT_HOURS = Number(process.env.MAX_LOT_HOURS ?? 72);

/**
 * Mean-reversion agent. When DOT/USD stretches far above its recent mean on a
 * sharp move, sell a small slice; buy it back when the move fades. Lots that
 * never come back are force-closed after MAX_LOT_HOURS so the swarm is never
 * stranded in ETH while DOT trends up (the objective is DOT, not USD).
 */
export class MeanRevAgent extends Agent<MRState> {
  readonly name = "meanrev";
  constructor() { super({ lastSellTs: 0 }); }

  async propose(ctx: Ctx): Promise<Signal[]> {
    const out: Signal[] = [];
    const z = ctx.market.zscore(48); // last 4h of 5m candles
    const p = ctx.snap.priceEth;
    const lots = ctx.ledger.state.openLots.filter((l) => l.agent === this.name);

    for (const lot of lots) {
      const ageH = (Date.now() - lot.ts) / 3.6e6;
      if (p <= lot.targetBuyPriceEth || (z < -1 && p < lot.sellPriceEth * 0.985)) {
        out.push({ agent: this.name, side: "BUY_DOT", conviction: 0.85, tag: lot.id,
          size: { usd: lot.ethReceived * ctx.snap.ethUsd },
          reason: `mean-rev buy-back: z=${z.toFixed(2)}, price ${p.toExponential(3)} vs sold ${lot.sellPriceEth.toExponential(3)}` });
      } else if (ageH > MAX_LOT_HOURS) {
        out.push({ agent: this.name, side: "BUY_DOT", conviction: 1, tag: lot.id,
          size: { usd: lot.ethReceived * ctx.snap.ethUsd },
          reason: `mean-rev time stop: lot open ${ageH.toFixed(0)}h > ${MAX_LOT_HOURS}h, re-entering DOT` });
      }
    }

    const cooldownOk = Date.now() - this.state.lastSellTs > 2 * 3.6e6;
    const stretched = z > 2.2 && ctx.snap.priceChange.h1 > 4;
    const flowFading = (ctx.intel?.buyPressure ?? 0.5) < 0.65;
    if (stretched && flowFading && cooldownOk && lots.length < 2) {
      const dot = ctx.ledger.tradeableDot * 0.15;
      if (dot > 0) out.push({ agent: this.name, side: "SELL_DOT", conviction: Math.min(1, (z - 1.5) / 2),
        size: { dot }, tag: `mr:${Math.floor(Date.now() / 1000)}`,
        reason: `mean-rev sell: z=${z.toFixed(2)} h1=${ctx.snap.priceChange.h1.toFixed(1)}% buyPressure=${(ctx.intel?.buyPressure ?? 0.5).toFixed(2)}` });
    }
    return out;
  }
  onFill(side: string) { if (side === "SELL_DOT") { this.state.lastSellTs = Date.now(); this.save(); } }
  static get sleeve() { return config.TRADING_SLEEVE; }
}
