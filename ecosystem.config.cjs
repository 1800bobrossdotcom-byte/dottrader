// pm2 process file: one swarm process per trading wallet, each with its own env file.
// Usage on the server:   npx pm2 start ecosystem.config.cjs && npx pm2 save
// Logs:                  npx pm2 logs
// Pause one bot:         touch data/w1/KILL   (delete the file to resume)
const fs = require("fs");
const path = require("path");

function envFile(name) {
  const p = path.join(__dirname, name);
  if (!fs.existsSync(p)) return null;
  const out = {};
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const bots = ["w1", "w2", "w3"]
  .map((w) => ({ name: `dot-bot-${w}`, env: envFile(`.env.${w}`) }))
  .filter((b) => b.env);

// Paper only: no keys, reads the pool and records what it would have done. Start it on its own with
//   npx pm2 start ecosystem.config.cjs --only swing-paper
// so it does not also bring the trading bots back up.
const swingPaper = {
  name: "swing-paper",
  script: path.join(__dirname, "node_modules", "tsx", "dist", "cli.mjs"),
  args: "src/cli/swing-paper.ts --threshold 1.2 --every 20",
  interpreter: "node",
  cwd: __dirname,
  autorestart: true,
  restart_delay: 10000,
  out_file: "logs/swing-paper.log",
  error_file: "logs/swing-paper.err.log",
  time: true,
};

// Live swing trading. Opt in by putting SWING_BUDGET_ETH in .env.w1 (or .env.w2) — an env file the
// process reads for itself, not a shell variable that dies with the window. Without it this app is
// not registered at all, so `pm2 start` can never bring up an unconfigured live trader.
const swingLive = ["w1", "w2"]
  .map((w) => ({ w, env: envFile(`.env.${w}`) }))
  .filter((b) => b.env && Number(b.env.SWING_BUDGET_ETH) > 0)
  .map((b) => ({
    name: `swing-${b.w}`,
    script: path.join(__dirname, "node_modules", "tsx", "dist", "cli.mjs"),
    args: `src/cli/swing-live.ts --bot ${b.w}`,
    interpreter: "node",
    cwd: __dirname,
    env: b.env,
    autorestart: true,
    restart_delay: 15000,
    max_memory_restart: "300M",
    out_file: `logs/swing-${b.w}.log`,
    error_file: `logs/swing-${b.w}.err.log`,
    time: true,
  }));

// Keeps the site's balances and mark current while the bots are stopped. They are what normally
// refresh stats.json once a tick, so without this the page freezes at whatever was true when
// trading stopped and the publisher has nothing to push.
const reporter = envFile(".env.w1") && {
  name: "dot-report",
  script: path.join(__dirname, "node_modules", "tsx", "dist", "cli.mjs"),
  args: "src/cli/report.ts --bot w1 --every 10",
  interpreter: "node",
  cwd: __dirname,
  env: envFile(".env.w1"),
  autorestart: true,
  restart_delay: 30000,
  out_file: "logs/dot-report.log",
  error_file: "logs/dot-report.err.log",
  time: true,
};

const publisher = {
  name: "dot-publish",
  script: path.join(__dirname, "scripts", "publish.mjs"),
  interpreter: "node",
  cwd: __dirname,
  autorestart: true,
  restart_delay: 60000,
  out_file: "logs/dot-publish.log",
  error_file: "logs/dot-publish.err.log",
  time: true,
};

module.exports = {
  apps: [...bots.map((b) => ({
    name: b.name,
    // Launch tsx's JS entry directly: on Windows, pm2 cannot run "npx" (it is a .cmd shim, not JavaScript).
    script: path.join(__dirname, "node_modules", "tsx", "dist", "cli.mjs"),
    args: `src/main.ts --bot ${b.name.replace("dot-bot-", "")}`,
    interpreter: "node",
    cwd: __dirname,
    env: b.env,
    autorestart: true,
    restart_delay: 10000,
    max_memory_restart: "300M",
    out_file: `logs/${b.name}.log`,
    error_file: `logs/${b.name}.err.log`,
    time: true,
  })), publisher, swingPaper, ...swingLive, ...(reporter ? [reporter] : [])],
};
