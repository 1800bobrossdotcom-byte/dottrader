#!/usr/bin/env bash
# One-time setup: checks Node, installs dependencies, and creates one .env.wN file per bot by asking questions.
# Run from the dottrader folder:   bash scripts/setup.sh
set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

say "1/4 Checking Node.js"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install it from https://nodejs.org (LTS), then run this script again."; exit 1
fi
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt 22 ]; then echo "Node $(node -v) is too old; need 22+. Install the LTS from https://nodejs.org"; exit 1; fi
echo "Node $(node -v) ok"

say "2/4 Installing dependencies (1-3 minutes on first run, you'll see npm output below)"
npm install --no-audit --no-fund --loglevel=http 2>&1 | tail -n 40
echo "dependencies installed"

say "3/4 Bot wallets"
BOTS=(
  "w1|0xcFCFc8e42AEBFC58AB78093217C2C4bB186BAc86"
  "w2|0x57C4e8C39d72540244FE8eDD302C7C463d6d545a"
  "w3|0x5d58D13A239fD0030CAFcd3a11727783ddeff5A2"
)
for entry in "${BOTS[@]}"; do
  name="${entry%%|*}"; addr="${entry##*|}"
  f=".env.$name"
  if [ -f "$f" ]; then echo "$f already exists, leaving it alone"; continue; fi
  echo
  echo "Bot $name = $addr"
  read -r -p "  Set up this bot? type y then Enter (or just Enter to skip): " yn
  case "$yn" in [yY]*) ;; *) continue ;; esac
  read -r -s -p "  Private key for $addr (typing is hidden, press Enter to skip for paper mode): " key; echo
  read -r -p "  Base RPC URL (Enter for public https://mainnet.base.org): " rpc
  rpc=${rpc:-https://mainnet.base.org}
  {
    grep -vE '^(WALLET_ADDRESS|PRIVATE_KEY|DATA_DIR|LIVE|BASE_RPC_URL)=' .env.example
    echo "WALLET_ADDRESS=$addr"
    echo "PRIVATE_KEY=$key"
    echo "DATA_DIR=data/$name"
    echo "LIVE=0"
    echo "BASE_RPC_URL=$rpc"
  } > "$f"
  chmod 600 "$f"
  mkdir -p "data/$name"
  echo "  wrote $f (LIVE=0, paper mode)"
  echo "  reading balances from Base to record the starting point (10-20 seconds)..."
  if env $(grep -v '^#' "$f" | xargs) npx tsx src/cli/snapshot.ts | tail -n 1; then
    echo "  baseline recorded in data/$name/baseline.json"
  else
    echo "  could not reach Base right now; run this later:  env \$(cat $f | xargs) npm run snapshot"
  fi
done

say "4/4 Done"
cat <<'MSG'
Next:
  npx pm2 start ecosystem.config.cjs     start every bot you set up (paper mode)
  npx pm2 logs                           watch them think
  npx pm2 stop all                       stop

When you're ready for real trades: change LIVE=0 to LIVE=1 in .env.w1 (and w2, w3), then
  npx pm2 restart all
Pause one bot at any time:  touch data/w1/KILL   (delete the file to resume)
MSG
