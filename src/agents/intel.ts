import { latestBlock, scanBurns, scanSwaps } from "../core/chain.js";
import { config } from "../core/config.js";
import { log } from "../core/log.js";
import type { IntelReport } from "../core/types.js";
import { Store } from "../data/store.js";

interface IntelState {
  lastBlock: number;
  burnsTotal: number;
  burnEvents: { block: number; dot: number; ts: number }[];
  swaps: { block: number; ts: number; ethDelta: number; dotDelta: number; isBuy: boolean }[];
}

const BLOCKS_PER_HOUR = 1800; // Base: 2s blocks
const LOOKBACK_START_BLOCKS = BLOCKS_PER_HOUR; // a cold start scans an hour back, then catches up tick by tick

/**
 * On-chain intelligence agent. Watches the DOT contract for burns (the protocol's
 * buyback-and-burn is the fundamental driver) and the V4 pool for order flow.
 * It does not trade; it publishes an IntelReport the strategy agents read.
 */
export class IntelAgent {
  readonly name = "intel";
  private store = new Store();
  private state: IntelState;
  constructor() {
    this.state = this.store.readJson<IntelState>("agent-intel.json", {
      lastBlock: 0, burnsTotal: 0, burnEvents: [], swaps: [],
    });
  }

  async tick(): Promise<IntelReport> {
    const head = Number(await latestBlock());
    const from = this.state.lastBlock ? this.state.lastBlock + 1 : head - LOOKBACK_START_BLOCKS;
    // Bound the work per tick. After an outage the gap can be thousands of blocks; scanning it in
    // slices keeps each tick quick and lets the agent walk forward instead of retrying a range the
    // provider will always refuse.
    const target = Math.min(head, from + config.LOGS_BLOCKS_PER_TICK - 1);
    if (target >= from) {
      try {
        const [burns, swaps] = await Promise.all([scanBurns(BigInt(from), BigInt(target)), scanSwaps(BigInt(from), BigInt(target))]);
        const now = Date.now();
        for (const b of burns.events) {
          this.state.burnEvents.push({ block: b.block, dot: b.dot, ts: now - (head - b.block) * 2000 });
          this.state.burnsTotal += b.dot;
          log("burn", `🔥 ${b.dot.toLocaleString()} DOT burned (block ${b.block})`);
        }
        for (const s of swaps.swaps) this.state.swaps.push({ ...s, ts: now - (head - s.block) * 2000 });
        // Bank whichever scan got least far: both must cover a block before it can be considered read.
        const scanned = Number(burns.scannedTo < swaps.scannedTo ? burns.scannedTo : swaps.scannedTo);
        if (scanned >= from) this.state.lastBlock = scanned;
        if (!burns.complete || !swaps.complete) {
          log("intel", `scan stopped at block ${scanned} of ${target} (RPC range limit); resuming next tick`);
        } else if (target < head) {
          log("intel", `catching up: block ${scanned}, ${head - scanned} behind`);
        }
      } catch (e) {
        log("intel", `scan failed (${from}-${target}): ${(e as Error).message}`);
      }
    }
    const cutoff24 = Date.now() - 24 * 3.6e6;
    const cutoff1 = Date.now() - 3.6e6;
    this.state.burnEvents = this.state.burnEvents.filter((b) => b.ts > cutoff24);
    this.state.swaps = this.state.swaps.filter((s) => s.ts > cutoff24);
    this.store.writeJson("agent-intel.json", this.state);

    const last1h = this.state.swaps.filter((s) => s.ts > cutoff1);
    const buys = last1h.filter((s) => s.isBuy).length;
    const sells = last1h.length - buys;
    const buyEth = last1h.filter((s) => s.isBuy).reduce((a, s) => a + Math.abs(s.ethDelta), 0);
    const sellEth = last1h.filter((s) => !s.isBuy).reduce((a, s) => a + Math.abs(s.ethDelta), 0);
    const report: IntelReport = {
      ts: Date.now(),
      burns24h: this.state.burnEvents.reduce((a, b) => a + b.dot, 0),
      burnsTotalObserved: this.state.burnsTotal,
      netFlow1h: buys - sells,
      buyPressure: buyEth + sellEth > 0 ? buyEth / (buyEth + sellEth) : 0.5,
      bigBuysUsd24h: 0,
    };
    log("intel", `swaps1h=${last1h.length} buyPressure=${report.buyPressure.toFixed(2)} burns24h=${report.burns24h.toFixed(0)} DOT`);
    return report;
  }
}
