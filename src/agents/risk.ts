import { existsSync } from "node:fs";
import { config } from "../core/config.js";
import { log } from "../core/log.js";
import type { Signal } from "../core/types.js";
import type { Ctx } from "./base.js";

export interface RiskVerdict { approved: Signal[]; rejected: { signal: Signal; why: string }[]; halted?: string }

const MIN_LIQUIDITY_USD = 100_000;
const MAX_ORDER_PCT_OF_LIQ = 0.5; // keep price impact small
const MAX_OPEN_LOTS_FRACTION = 0.6; // of the sleeve may sit in ETH at once
const DAILY_DOT_DRAWDOWN_HALT = 0.03; // stop selling if DOT-equivalent is down 3% on the day
const lastFillByAgent = new Map<string, number>();
const COOLDOWN_MS = config.AGENT_COOLDOWN_SECONDS * 1_000;

/**
 * Risk agent. Has veto power over every signal. Nothing reaches the executor
 * without passing here. It thinks in DOT: the core sleeve is untouchable, and
 * losing DOT on the day halts further selling.
 */
export function riskCheck(signals: Signal[], ctx: Ctx): RiskVerdict {
  const rejected: RiskVerdict["rejected"] = [];
  const approved: Signal[] = [];
  const killFile = ctx.ledger.store.p("KILL");
  if (existsSync(killFile)) return { approved: [], rejected: signals.map((s) => ({ signal: s, why: "kill switch" })), halted: "KILL file present" };

  if (ctx.snap.liquidityUsd < MIN_LIQUIDITY_USD)
    return { approved: [], rejected: signals.map((s) => ({ signal: s, why: "liquidity too thin" })), halted: `liquidity $${ctx.snap.liquidityUsd.toFixed(0)} < $${MIN_LIQUIDITY_USD}` };

  const st = ctx.ledger.state;
  const dotEq = ctx.ledger.dotEquivalent(ctx.snap.priceEth);
  const dayDd = st.daily.dotStart > 0 ? 1 - dotEq / st.daily.dotStart : 0;
  const lotsEth = st.openLots.reduce((a, l) => a + l.ethReceived, 0);
  const sleeveEthValue = (st.portfolio.dot - st.coreDot + lotsEth / Math.max(ctx.snap.priceEth, 1e-12)) * ctx.snap.priceEth;

  for (const s of [...signals].sort((a, b) => b.conviction - a.conviction)) {
    const last = lastFillByAgent.get(s.agent) ?? 0;
    if (Date.now() - last < COOLDOWN_MS) { rejected.push({ signal: s, why: "agent cooldown" }); continue; }
    const usd = s.side === "SELL_DOT" ? (s.size.dot ?? 0) * ctx.snap.priceUsd : (s.size.usd ?? 0);
    if (usd < 1) { rejected.push({ signal: s, why: "order below $1" }); continue; }
    if (usd > ctx.snap.liquidityUsd * (MAX_ORDER_PCT_OF_LIQ / 100)) { rejected.push({ signal: s, why: `order $${usd.toFixed(0)} > ${MAX_ORDER_PCT_OF_LIQ}% of liquidity` }); continue; }

    if (s.side === "SELL_DOT") {
      const dot = s.size.dot ?? 0;
      // DOT a long lot bought with trading ETH was never part of the protected core, so selling it
      // back must not be blocked by the sleeve — otherwise a long lot can never be closed.
      const isLongClose = !!s.tag && st.openLots.some((l) => l.id === s.tag && (l.side ?? "short") === "long");
      if (!isLongClose && st.portfolio.dot - dot < st.coreDot) { rejected.push({ signal: s, why: `would breach core sleeve (${st.coreDot.toFixed(0)} DOT)` }); continue; }
      if (dayDd > DAILY_DOT_DRAWDOWN_HALT) { rejected.push({ signal: s, why: `daily DOT drawdown ${(dayDd * 100).toFixed(1)}% - selling halted` }); continue; }
      if (sleeveEthValue > 0 && (lotsEth + dot * ctx.snap.priceEth) / sleeveEthValue > MAX_OPEN_LOTS_FRACTION) { rejected.push({ signal: s, why: "too much of the sleeve already parked in ETH" }); continue; }
    } else {
      const ethNeeded = usd / Math.max(ctx.snap.ethUsd, 1);
      const isLotClose = !!s.tag && st.openLots.some((l) => l.id === s.tag);
      if (!isLotClose && st.portfolio.eth - ethNeeded < config.GAS_RESERVE_ETH && st.portfolio.usdc < usd) {
        rejected.push({ signal: s, why: "would dip into gas reserve" }); continue;
      }
    }
    if (config.LIVE && st.portfolio.eth < config.GAS_RESERVE_ETH) { rejected.push({ signal: s, why: `live mode needs >= ${config.GAS_RESERVE_ETH} ETH for gas` }); continue; }
    approved.push(s);
    // A small per-tick cap keeps the swarm deliberate and each tick easy to audit.
    if (approved.length >= config.MAX_FILLS_PER_TICK) break;
  }
  for (const r of rejected) log("risk", `✗ ${r.signal.agent} ${r.signal.side}: ${r.why}`);
  return { approved, rejected };
}

export function noteFill(agent: string) { lastFillByAgent.set(agent, Date.now()); }
