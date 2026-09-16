# dottrader

A multi-agent trading swarm with a single objective: **end every cycle holding more $DOT than it started with.**
Every fill, win and loss is published to [dottrader.app](https://dottrader.app) from the moment the journey started.

## What is $DOT?

[$DOT](https://usedot.xyz) is the token of Dot, a privacy-first AI platform (private chat, image, video, code, and an
OpenAI-compatible API) that takes payment in USDC or $DOT. Protocol economics per the
[docs](https://git.usedot.xyz/tokenomics/protocol-economics.md): **100% of $DOT paid to the protocol is burned**, and revenue
funds buybacks that are burned too. Supply is fixed at 1,000,000,000.

| | |
|---|---|
| Chain | Base (chain id 8453) |
| Contract | [`0x23A2847d772803f9EFC64B4277b782b06296FE51`](https://basescan.org/token/0x23A2847d772803f9EFC64B4277b782b06296FE51) |
| Liquidity | Uniswap V4 DOT/ETH pool ([DexScreener](https://dexscreener.com/base/0x5f547579519beaa158cddd3543604029165f66e86a00c373d0ee90c38784921b)); dynamic-fee hook, ~1.1% per swap |
| Journey wallet | [`0x8455cF296e1265b494605207e97884813De21950`](https://basescan.org/address/0x8455cF296e1265b494605207e97884813De21950) |

The ~1.1% swap fee is the single most important fact for strategy design: a round trip costs ~2.2% before price impact,
so the swarm trades **rarely and wide**, never scalps, and measures itself in DOT rather than dollars.

## The swarm

```
market ─► intel ─► [ grid | meanrev | accumulate ] ─► risk ─► executor ─► ledger ─► dottrader.app
```

| Agent | Role |
|---|---|
| **market** | Blends DexScreener (USD, volume, liquidity) with the on-chain Uniswap V4 `slot0` price. Builds 5-minute candles. |
| **intel** | Reads Base directly: DOT burns (transfers to the burn addresses) and every swap in the V4 pool → buy pressure, net flow, burns/24h. |
| **grid** | Sells thin slices of the *trading sleeve* as DOT/ETH climbs ~7% grid levels; buys each slice back ≥3% lower. Each closed level nets more DOT. Holds slices longer when flow is strongly bid. |
| **meanrev** | On sharp, stretched moves (z-score > 2.2 over 4h with fading buy pressure) sells a small slice and buys it back when the move fades. A time stop (72h) re-enters DOT so the swarm is never stranded in ETH during an uptrend. |
| **accumulate** | Converts fresh ETH/USDC into DOT on a daily budget (`DCA_USD_PER_DAY`), buying harder into dips and after burns. Silent until a budget is set. |
| **risk** | Veto power over everything. Core sleeve (default 70% of the stack) is never sold. Halts selling if the DOT-equivalent stack is down 3% on the day. Enforces liquidity, order-size, gas-reserve and cooldown limits. One order per tick. `data/KILL` stops everything. |
| **executor** | Quotes and routes via KyberSwap's aggregator (free, no key). Paper mode fills at the real quoted output, fees and impact included. Live mode builds the same route and signs with a hot wallet. |
| **ledger** | Scores every closed round trip in DOT earned, per agent, and tracks DOT parked in ETH as open lots. |

## Quick start (paper mode)

```bash
npm install
cp .env.example .env            # defaults are fine for paper mode
npm run snapshot                # records the journey start (already done for the journey wallet)
npm run swarm                   # runs a tick every 60s, writes site/data/stats.json
npm run site                    # serve dottrader.app locally
```

`npm run swarm:once` runs a single tick (used by the GitHub Actions scheduler).

## Going live

The journey wallet currently holds ~119k DOT but **almost no ETH**, so live mode cannot run until gas is funded.

1. Create a **dedicated hot wallet** for the swarm. Move only the trading sleeve (30% of the DOT) plus ~0.01 ETH for gas into it.
   Never put your main wallet's private key on a server.
2. In `.env`: `LIVE=1`, `PRIVATE_KEY=<hot wallet key>`, `WALLET_ADDRESS=<hot wallet address>`, and ideally a dedicated `BASE_RPC_URL`.
3. Run `npm run snapshot --force` once from the hot wallet so the journey baseline matches, then `npm run swarm`.
4. To pause instantly: `touch data/KILL`. Remove the file to resume.

The executor refuses to start if the private key does not match `WALLET_ADDRESS`, refuses fills whose quote deviates >5% from
market, and never spends below `GAS_RESERVE_ETH`.

## Wallets and the vault

| Wallet | Role |
|---|---|
| `0x8455cF29…De21950` | **Vault / ledger.** Holds the core DOT stack. Every DOT the swarm earns is swept here. |
| `0xcFCFc8e4…86BAc86` | Trading wallet 1 (ETH → accumulates DOT, then grids it). |
| `0x57C4e8C3…d6d545a` | Trading wallet 2. |

**Trading wallets do not need DOT to start.** They hold ETH; the accumulator buys DOT with it (`DCA_USD_PER_DAY`), and the grid
and mean-reversion agents then work that inventory. Only round-trip *profit* is swept to the vault, so the working inventory
stays in the trading wallet and keeps compounding. Set `SWEEP_INVENTORY_ABOVE_DOT` if you also want surplus inventory moved.

Run one swarm process per trading wallet (`WALLET_ADDRESS` + `PRIVATE_KEY` + its own `DATA_DIR`). Each process sweeps
earned DOT to `VAULT_ADDRESS` once `SWEEP_MIN_DOT` has accumulated, keeping `SWEEP_KEEP_DOT` as working float.
`TRACKED_WALLETS` lists every wallet that counts toward the journey total on the site.

## Publishing dottrader.app

`site/` is a static page that reads `site/data/stats.json`. Two workflows are included:

- `.github/workflows/pages.yml` publishes `site/` to GitHub Pages (a `CNAME` for dottrader.app is included; point the domain's DNS at GitHub Pages).
- `.github/workflows/paper-swarm.yml` runs a paper tick on a schedule and commits the updated stats, so the site stays live with zero servers. Uncomment the `schedule` block to enable it.

If you run the swarm on your own machine or a VPS instead, just push `site/data/stats.json` (or rsync `site/`) wherever the domain is hosted.

## Configuration

See `.env.example`. Key knobs: `TRADING_SLEEVE` (fraction of DOT the swarm may trade), `MAX_SLIPPAGE_PCT`, `GAS_RESERVE_ETH`,
`DCA_USD_PER_DAY`, `MAX_LOT_HOURS`, `TICK_SECONDS`.

## Development

```bash
npm run typecheck
npm test
```

## Honesty notes

- Paper results use real aggregator quotes at the moment of the signal but do not experience MEV, failed transactions or block-time slippage. Expect live results to be a little worse.
- "DOT earned" only counts **closed** round trips (and fresh-capital buys). Open lots are shown separately and valued at the current price in the DOT-equivalent figure.
- The strategy is designed to win in a choppy or falling DOT/ETH market and to tread water (not lose DOT) in a straight-up market. It is not designed to beat simply holding in a parabolic move; the core sleeve exists precisely so most of the stack still rides that.
