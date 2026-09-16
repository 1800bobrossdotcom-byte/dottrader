import { Agent, type Ctx } from "./base.js";
import type { Signal } from "../core/types.js";
import { DOT } from "../core/config.js";
import { REQUIRED_EDGE } from "../core/ledger.js";

interface GridState {
  anchorEth: number | null; // ETH per DOT when the grid was (re)anchored
  filled: Record<string, number>; // level index -> ts of sell
}

/**
 * Grid agent. Sells thin slices of the trading sleeve as DOT/ETH rises through
 * grid levels and buys each slice back lower, ending each cycle with more DOT.
 * Spacing is set wide enough that two ~1.1% swap fees plus impact still leave edge.
 */
export class GridAgent extends Agent<GridState> {
  readonly name = "grid";
  readonly levels = 6;
  /** grid spacing as a fraction (7%) */
  readonly spacing = Math.max(0.05, 2 * (DOT.swapFeePct / 100) + REQUIRED_EDGE);
  constructor() { super({ anchorEth: null, filled: {} }); }

  async propose(ctx: Ctx): Promise<Signal[]> {
    const p = ctx.snap.priceEth;
    if (!(p > 0)) return [];
    const st = this.state;
    const lots = ctx.ledger.state.openLots.filter((l) => l.agent === this.name);

    // (Re)anchor: first run, or price fell well below the grid with nothing open.
    if (st.anchorEth === null || (lots.length === 0 && p < st.anchorEth * (1 - 2 * this.spacing))) {
      st.anchorEth = p; st.filled = {}; this.save();
    }
    // Ratchet: if price ran through every level and we hold no lots, re-anchor higher.
    if (lots.length === 0 && p > st.anchorEth * (1 + this.spacing) ** (this.levels + 1)) {
      st.anchorEth = p; st.filled = {}; this.save();
    }

    const out: Signal[] = [];
    // 1) Buy-backs first: any open lot whose target is met.
    for (const lot of lots) {
      if (p <= lot.targetBuyPriceEth) {
        out.push({
          agent: this.name, side: "BUY_DOT", conviction: 0.9,
          size: { usd: lot.ethReceived * ctx.snap.ethUsd },
          tag: lot.id,
          reason: `grid buy-back: price ${fmt(p)} <= target ${fmt(lot.targetBuyPriceEth)} (sold at ${fmt(lot.sellPriceEth)})`,
        });
      }
    }
    // 2) Sells: first unfilled level at/below current price.
    const slice = ctx.ledger.tradeableDot / this.levels;
    for (let k = 1; k <= this.levels; k++) {
      const level = st.anchorEth * (1 + this.spacing) ** k;
      const key = String(k);
      if (p >= level && !st.filled[key] && slice > 0) {
        const uptrend = ctx.snap.priceChange.h1 > 3 && (ctx.intel?.buyPressure ?? 0.5) > 0.7;
        out.push({
          agent: this.name, side: "SELL_DOT",
          conviction: uptrend ? 0.35 : 0.7, // hold slices longer when flow is strongly bid
          size: { dot: slice },
          tag: `grid:${k}:${Math.floor(Date.now() / 1000)}`,
          reason: `grid level ${k} hit: ${fmt(p)} >= ${fmt(level)} (+${(this.spacing * 100 * k).toFixed(0)}% from anchor)`,
        });
        break;
      }
    }
    return out;
  }

  /** Executor calls this so the level is marked filled only after a real fill. */
  onFill(tag: string | undefined) {
    if (!tag?.startsWith("grid:")) return;
    this.state.filled[tag.split(":")[1]] = Date.now(); this.save();
  }
  onLotClosed(tag: string | undefined) {
    if (!tag?.startsWith("grid:")) return;
    delete this.state.filled[tag.split(":")[1]]; this.save();
  }
}

const fmt = (x: number) => x.toExponential(4);
