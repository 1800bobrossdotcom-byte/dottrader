import { createWalletClient, http, maxUint256, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { config, DOT } from "../core/config.js";
import { erc20, publicClient } from "../core/chain.js";
import { log } from "../core/log.js";
import type { Fill, MarketSnapshot, Signal } from "../core/types.js";
import { build, buyDotQuote, sellDotQuote, type Quote } from "./kyber.js";

/**
 * Execution agent. Paper mode fills at KyberSwap's quoted output (which already
 * embeds the pool fee and price impact) minus gas, so paper results are honest.
 * Live mode builds the same route and signs it with the hot wallet.
 */
export class Executor {
  private account = config.LIVE && config.PRIVATE_KEY ? privateKeyToAccount(config.PRIVATE_KEY as Hex) : null;
  private wallet = this.account ? createWalletClient({ account: this.account, chain: base, transport: http(config.BASE_RPC_URL) }) : null;

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
    const hash = await this.wallet!.sendTransaction({ to: tx.to, data: tx.data, value: tx.value, gas: (tx.gas * 13n) / 10n });
    log("exec", `⛓  sent ${s.side} ${hash}`);
    const rc = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
    if (rc.status !== "success") { log("exec", `tx reverted ${hash}`); return null; }
    fill.txHash = hash;
    log("exec", `✅ LIVE ${s.side} ${dot.toFixed(0)} DOT ↔ ${eth.toFixed(5)} ETH — ${hash}`);
    return fill;
  }

  /** Sends earned DOT to the vault. Paper mode just returns a fake receipt. */
  async transferDot(to: Address, dot: number): Promise<{ txHash?: string }> {
    if (!config.LIVE) { log("exec", `📝 PAPER sweep ${dot.toFixed(0)} DOT → vault ${to}`); return {}; }
    const hash = await this.wallet!.writeContract({ address: DOT.address, abi: erc20, functionName: "transfer", args: [to, BigInt(Math.floor(dot * 1e18))] });
    const rc = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
    if (rc.status !== "success") throw new Error(`sweep reverted ${hash}`);
    log("exec", `🏦 LIVE sweep ${dot.toFixed(0)} DOT → vault ${to} (${hash})`);
    return { txHash: hash };
  }

  private async ensureAllowance(owner: Address, spender: Address, amount: bigint) {
    const cur = await publicClient.readContract({ address: DOT.address, abi: erc20, functionName: "allowance", args: [owner, spender] });
    if (cur >= amount) return;
    const hash = await this.wallet!.writeContract({ address: DOT.address, abi: erc20, functionName: "approve", args: [spender, maxUint256] });
    await publicClient.waitForTransactionReceipt({ hash });
    log("exec", `approved KyberSwap router ${spender} for DOT (${hash})`);
  }
}
