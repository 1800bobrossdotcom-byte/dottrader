import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The commit each bot process is actually running, stamped into stats.json.
 * Pulling new code does nothing until the processes restart, and without this there is no way to
 * tell a stale site from a stale process — they look identical from the outside.
 */
let cached: string | null = null;
export function codeVersion(): string {
  if (cached === null) {
    const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
    try {
      const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      cached = sha || "unknown";
    } catch {
      cached = "unknown";
    }
  }
  return cached;
}
