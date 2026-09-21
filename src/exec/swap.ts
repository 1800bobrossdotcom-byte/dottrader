import { createWalletClient, http, maxUint256, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { config, TOKENS } from "../core/config.js";
import { erc20, noteWriteBlock, publicClient } from "../core/chain.js";
import { log } from "../core/log.js";
import { build, quote } from "./kyber.js";
import { NonceTracker } from "./executor.js";

/**
 * Generic single swap for any token pair, in raw units.
 *
 * The DOT executor wraps the same KyberSwap calls but bakes in DOT's 18 decimals and its own
 * fill/ledger shape. cbBTC has 8, and the swing engine keeps its own book, so it gets a plain
 * swapper instead of a shared path bent to fit both.
 */
export class Swapper {
  private account = privateKeyToAccount(config.PRIVATE_KEY as Hex);
  private wallet = createWalletClient({ account: this.account, chain: base, transport: http(config.BASE_RPC_URL) });
  private nonces = new NonceTracker(() =>
    publicClient.getTransactionCount({ address: this.account.address, blockTag: "pending" }));

  get address() { return this.account.address; }

  async balance(token: Address | typeof TOKENS.ETH): Promise<bigint> {
    if (token.toLowerCase() === TOKENS.ETH.toLowerCase()) return publicClient.getBalance({ address: this.account.address });
    return publicClient.readContract({ address: token as Address, abi: erc20, functionName: "balanceOf", args: [this.account.address] });
  }

  /** Swaps exactly `amountIn` of tokenIn. Returns what actually arrived, read from the chain. */
  async swap(tokenIn: string, tokenOut: string, amountIn: bigint, maxSlippagePct = config.MAX_SLIPPAGE_PCT) {
    const q = await quote(tokenIn, tokenOut, amountIn);
    const isNative = tokenIn.toLowerCase() === TOKENS.ETH.toLowerCase();
    if (!isNative) await this.ensureAllowance(tokenIn as Address, q.routerAddress as Address, amountIn);

    const before = await this.balance(tokenOut as Address);
    const tx = await build(q, this.account.address, maxSlippagePct);
    const hash = await this.wallet.sendTransaction({
      to: tx.to, data: tx.data, value: tx.value, gas: (tx.gas * 13n) / 10n, nonce: await this.nonces.take(),
    });
    this.nonces.used();
    const rc = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
    noteWriteBlock(rc.blockNumber);
    if (rc.status !== "success") throw new Error(`swap reverted ${hash}`);

    // Trust the chain over the quote: `amountOut` is what the route predicted, not what arrived.
    const after = await this.balance(tokenOut as Address);
    const gasEth = Number(rc.gasUsed * rc.effectiveGasPrice + (rc.l1Fee ?? 0n)) / 1e18;
    return { hash, amountOut: after - before, quoted: q.amountOut, gasEth, block: rc.blockNumber };
  }

  private async ensureAllowance(token: Address, spender: Address, amount: bigint) {
    const cur = await publicClient.readContract({ address: token, abi: erc20, functionName: "allowance", args: [this.account.address, spender] });
    if (cur >= amount) return;
    const hash = await this.wallet.writeContract({
      address: token, abi: erc20, functionName: "approve", args: [spender, maxUint256], nonce: await this.nonces.take(),
    });
    this.nonces.used();
    noteWriteBlock((await publicClient.waitForTransactionReceipt({ hash })).blockNumber);
    log("swap", `approved ${spender} for ${token} (${hash})`);
  }
}
