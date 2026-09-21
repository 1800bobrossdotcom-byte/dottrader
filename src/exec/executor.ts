import { createWalletClient, http, maxUint256, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { config, DOT } from "../core/config.js";
import { erc20, noteWriteBlock, publicClient } from "../core/chain.js";
import { log } from "../core/log.js";
import type { Fill, MarketSnapshot, Signal } from "../core/types.js";
import { build, buyDotQuote, sellDotQuote, type Quote } from "./kyber.js";

/**
 * Hands out transaction nonces for back-to-back sends.
 *
 * The node cannot be trusted for this on its own: right after a tx confirms, the pending transaction
 * count often still reads as the old value, so the next send reuses that nonce and is rejected as an
 * underpriced replacement. (The same read-after-write lag `noteWriteBlock` handles for balances.)
 * So the counter is kept locally and only ever moves forward — a fresh read is a floor, never a
 * rewind — which also lets a send whose response was lost resync on the next attempt.
 */
export class NonceTracker {
  private next: number | null = null;
  constructor(private readonly readPending: () => Promise<number>) {}
  async take(): Promise<number> {
    const chain = await this.readPending();
    this.next = this.next === null ? chain : Math.max(chain, this.next);
    return this.next;
  }
  /** Called only after a send was accepted; a rejected send consumed nothing. */
  used() { if (this.next !== null) this.next++; }
}

/**
 * Execution agent. Paper mode fills at KyberSwap's quoted output (which already
 * embeds the pool fee and price impact) minus gas, so paper results are honest.
 * Live mode builds the same route and signs it with the hot wallet.
 */
export class Executor {
  private account = config.LIVE && config.PRIVATE_KEY ? privateKeyToAccount(config.PRIVATE_KEY as Hex) : null;
  private wallet = this.account ? createWalletClient({ account: this.account, chain: base, transport: http(config.BASE_RPC_URL) }) : null;
  private nonces = new NonceTracker(() =>
    publicClient.getTransactionCount({ address: this.account!.address, blockTag: "pending" }));

  constructor() {
    if (config.LIVE && !this.account) throw new Error("LIVE=1 requires PRIVATE_KEY");
    if (this.account && this.account.address.toLowerCase() !== config.WALLET_ADDRESS.toLowerCase())
      throw new Error(`PRIVATE_KEY is for ${this.account.address}, but WALLET_ADDRESS is ${config.WALLET_ADDRESS}`);
  }

  async execute(s: Signal, snap: MarketSnapshot): Promise<Fill | null> {
    let q: Quote;
    if (s.side === "SELL_DOT") q = await sellDotQuote(s.size.dot!);
    else q = await buyDotQuote((s.size.usd ?? 0) / snap.ethUsd);

    const dot = s.side === "SELL_DOT" ? Number(q.amountIn) / 1e18 : Number(q.amountOut) / 1e18;
    const eth = s.side === "SELL_DOT" ? Number(q.amountOut) / 1e18 : Number(q.amountIn) / 1e18;
    const usd = s.side === "SELL_DOT" ? q.amountOutUsd : q.amountInUsd;
    const impliedPriceUsd = usd / dot;
    // Sanity: the quote must not be wildly off the market snapshot.
    const dev = Math.abs(impliedPriceUsd / snap.priceUsd - 1);
    if (dev > 0.05) { log("exec", `quote deviates ${(dev * 100).toFixed(1)}% from market; skipping`, { impliedPriceUsd, market: snap.priceUsd }); return null; }

    const fill: Fill = {
      ts: Date.now(), agent: s.agent, side: s.side, dot, eth, usd, priceUsd: impliedPriceUsd,
      feesUsd: usd * (DOT.swapFeePct / 100) + q.gasUsd, paper: !config.LIVE, tag: s.tag, reason: s.reason,
    };

    if (!config.LIVE) {
      log("exec", `📝 PAPER ${s.side} ${dot.toFixed(0)} DOT ↔ ${eth.toFixed(5)} ETH ($${usd.toFixed(2)}) — ${s.reason}`);
      return fill;
    }

    const me = this.account!.address as Address;
    if (s.side === "SELL_DOT") await this.ensureAllowance(me, q.routerAddress as Address, q.amountIn);
    const tx = await build(q, me, config.MAX_SLIPPAGE_PCT);
    const hash = await this.wallet!.sendTransaction({ to: tx.to, data: tx.data, value: tx.value, gas: (tx.gas * 13n) / 10n, nonce: await this.nonces.take() });
    this.nonces.used();
    log("exec", `⛓  sent ${s.side} ${hash}`);
    const rc = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
    noteWriteBlock(rc.blockNumber);
    if (rc.status !== "success") { log("exec", `tx reverted ${hash}`); return null; }
    fill.txHash = hash;
    log("exec", `✅ LIVE ${s.side} ${dot.toFixed(0)} DOT ↔ ${eth.toFixed(5)} ETH — ${hash}`);
    return fill;
  }

  /** Sends earned DOT to the vault. Paper mode just returns a fake receipt. */
  async transferDot(to: Address, dot: number): Promise<{ txHash?: string }> {
    if (!config.LIVE) { log("exec", `📝 PAPER sweep ${dot.toFixed(0)} DOT → vault ${to}`); return {}; }
    const hash = await this.wallet!.writeContract({ address: DOT.address, abi: erc20, functionName: "transfer", args: [to, BigInt(Math.floor(dot * 1e18))], nonce: await this.nonces.take() });
    this.nonces.used();
    const rc = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
    noteWriteBlock(rc.blockNumber);
    if (rc.status !== "success") throw new Error(`sweep reverted ${hash}`);
    log("exec", `🏦 LIVE sweep ${dot.toFixed(0)} DOT → vault ${to} (${hash})`);
    return { txHash: hash };
  }

  private async ensureAllowance(owner: Address, spender: Address, amount: bigint) {
    const cur = await publicClient.readContract({ address: DOT.address, abi: erc20, functionName: "allowance", args: [owner, spender] });
    if (cur >= amount) return;
    const hash = await this.wallet!.writeContract({ address: DOT.address, abi: erc20, functionName: "approve", args: [spender, maxUint256], nonce: await this.nonces.take() });
    this.nonces.used();
    noteWriteBlock((await publicClient.waitForTransactionReceipt({ hash })).blockNumber);
    log("exec", `approved KyberSwap router ${spender} for DOT (${hash})`);
  }
}
