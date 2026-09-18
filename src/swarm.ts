import { config } from "./core/config.js";
import { getPortfolio } from "./core/chain.js";
import { Ledger } from "./core/ledger.js";
import { log } from "./core/log.js";
import type { Fill, IntelReport, Signal } from "./core/types.js";
import { MarketData } from "./data/market.js";
import { AccumulatorAgent } from "./agents/accumulate.js";
import { GridAgent } from "./agents/grid.js";
import { IntelAgent } from "./agents/intel.js";
import { MeanRevAgent } from "./agents/meanrev.js";
import { noteFill, riskCheck } from "./agents/risk.js";
import type { Ctx } from "./agents/base.js";
import { Executor } from "./exec/executor.js";
import { writeReport } from "./report.js";

/**
 * The swarm. One tick =
 *   market → intel → every strategy proposes → risk vetoes → executor fills → ledger scores in DOT → report.
 */
export class Swarm {
  market = new MarketData();
  ledger = new Ledger();
  intel = new IntelAgent();
  grid = new GridAgent();
  meanrev = new MeanRevAgent();
  accumulate = new AccumulatorAgent();
  executor = new Executor();
  lastIntel: IntelReport | null = null;
  private strategies = [this.grid, this.meanrev, this.accumulate];

  constructor() {
    for (const a of this.strategies) a.init();
    if (!this.ledger.baseline) log("swarm", "no baseline.json yet — run `npm run snapshot` to record the journey start");
  }

  async tick(): Promise<Fill | null> {
    this.ledger.rollDay();
    const snap = await this.market.tick();
    log("market", `DOT $${snap.priceUsd.toFixed(6)} (${snap.priceEth.toExponential(3)} ETH) h1 ${snap.priceChange.h1}% h24 ${snap.priceChange.h24}% liq $${snap.liquidityUsd.toFixed(0)} [${snap.source}]`);

    if (config.LIVE) {
      const onchain = await getPortfolio();
      this.ledger.syncPortfolio(onchain);
      // The chain is the truth: release any lot whose ETH was spent outside the bot (e.g. a manual swap),
      // otherwise the grid waits forever to buy back with ETH that is gone.
      for (const r of this.ledger.reconcileWithChain(onchain.eth)) {
        log("ledger", `⚖ ${r.dropped ? "released" : "shrank"} lot ${r.lotId}: ${r.ethRemoved.toFixed(6)} ETH spent outside the bot (${r.dotReleased.toFixed(0)} DOT unwound)`);
        // A shrunk lot is still open, so its grid level stays closed; only a fully released lot frees one.
        if (r.dropped) this.grid.onLotDropped(r.lotId);
      }
    }

    try { this.lastIntel = await this.intel.tick(); } catch (e) { log("intel", `skipped: ${(e as Error).message}`); }

    const ctx: Ctx = { snap, market: this.market, ledger: this.ledger, intel: this.lastIntel };
    const signals: Signal[] = [];
    for (const a of this.strategies) {
      try {
        const s = await a.propose(ctx);
        for (const sig of s) log(a.name, `→ ${sig.side} ${sig.size.dot ? sig.size.dot.toFixed(0) + " DOT" : "$" + (sig.size.usd ?? 0).toFixed(2)} conv=${sig.conviction.toFixed(2)} :: ${sig.reason}`);
        signals.push(...s);
      } catch (e) { log(a.name, `error: ${(e as Error).message}`); }
    }

    const verdict = riskCheck(signals, ctx);
    if (verdict.halted) log("risk", `⛔ halted: ${verdict.halted}`);

    let fill: Fill | null = null;
    for (const s of verdict.approved) {
      try {
        fill = await this.executor.execute(s, snap);
      } catch (e) { log("exec", `failed: ${(e as Error).message}`); }
      if (!fill) continue;
      noteFill(s.agent);
      this.ledger.recordFill(fill);
      if (s.agent === "grid") { if (fill.side === "SELL_DOT") this.grid.onFill(fill.tag); else this.grid.onLotClosed(fill.tag, fill.dot > 0 ? fill.eth / fill.dot : 0); }
      if (s.agent === "meanrev") this.meanrev.onFill(fill.side);
      if (s.agent === "accumulate") this.accumulate.onFill(fill.usd);
      const earned = this.ledger.totalDotEarned();
      log("ledger", `stack ${this.ledger.state.portfolio.dot.toFixed(0)} DOT | DOT earned so far ${earned >= 0 ? "+" : ""}${earned.toFixed(1)} | open lots ${this.ledger.state.openLots.length}`);
    }

    await this.maybeSweep();
    await writeReport(this, snap);
    return fill;
  }

  /** Move earned DOT to the vault once enough has piled up. The trading wallet keeps only its working float. */
  async maybeSweep() {
    const vault = config.VAULT_ADDRESS.toLowerCase();
    if (vault === config.WALLET_ADDRESS.toLowerCase()) return; // trading from the vault itself: nothing to move
    const dot = this.ledger.sweepable();
    if (dot <= 0) return;
    try {
      const { txHash } = await this.executor.transferDot(config.VAULT_ADDRESS as `0x${string}`, dot);
      this.ledger.recordSweep({ ts: Date.now(), dot, to: config.VAULT_ADDRESS, txHash, paper: !config.LIVE });
      log("ledger", `🏦 swept ${dot.toFixed(0)} DOT to vault; total swept ${this.ledger.state.sweptDot.toFixed(0)} DOT`);
    } catch (e) { log("exec", `sweep failed: ${(e as Error).message}`); }
  }
}
