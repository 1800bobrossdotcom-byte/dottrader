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
  args: "src/cli/swing-paper.ts --threshold 0.5 --every 20",
  interpreter: "node",
  cwd: __dirname,
  autorestart: true,
  restart_delay: 10000,
  out_file: "logs/swing-paper.log",
  error_file: "logs/swing-paper.err.log",
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
  })), publisher, swingPaper],
};
