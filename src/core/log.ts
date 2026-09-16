const COLORS: Record<string, string> = {
  market: "\x1b[36m", intel: "\x1b[35m", grid: "\x1b[33m", meanrev: "\x1b[34m",
  accumulate: "\x1b[32m", burn: "\x1b[31m", risk: "\x1b[91m", exec: "\x1b[92m",
  ledger: "\x1b[96m", swarm: "\x1b[1m", report: "\x1b[90m",
};
const RESET = "\x1b[0m";
export function log(agent: string, msg: string, extra?: unknown) {
  const ts = new Date().toISOString().slice(11, 19);
  const c = COLORS[agent] ?? "";
  const tail = extra === undefined ? "" : " " + JSON.stringify(extra);
  console.log(`${ts} ${c}[${agent.padEnd(10)}]${RESET} ${msg}${tail}`);
}
