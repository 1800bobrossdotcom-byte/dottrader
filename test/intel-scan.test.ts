import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "dottrader-intel-"));
process.env.DATA_DIR = dir;
process.env.LIVE = "0";
process.env.LOGS_MAX_BLOCK_RANGE = "10";
process.env.LOGS_BLOCKS_PER_TICK = "600";

beforeEach(() => { for (const f of readdirSync(dir)) rmSync(path.join(dir, f), { force: true, recursive: true }); });

/**
 * Alchemy's free tier refuses an eth_getLogs range wider than 10 blocks. The scanner must chunk to
 * that width, and when a chunk is refused it must report how far it got rather than throwing away
 * the whole scan — otherwise the caller retries the same range forever and never catches up.
 */
describe("log scanning under an RPC range cap", () => {
  it("chunks to the configured width and never asks for more", async () => {
    const seen: Array<[bigint, bigint]> = [];
    const { publicClient, scanBurns } = await import("../src/core/chain.js");
    vi.spyOn(publicClient, "getLogs").mockImplementation((async (a: { fromBlock: bigint; toBlock: bigint }) => {
      seen.push([a.fromBlock, a.toBlock]);
      return [];
    }) as never);

    const r = await scanBurns(1000n, 1029n);
    expect(r.complete).toBe(true);
    expect(r.scannedTo).toBe(1029n);
    // 30 blocks at a width of 10 is exactly three calls, none wider than the cap.
    expect(seen).toHaveLength(3);
    for (const [from, to] of seen) expect(Number(to - from) + 1).toBeLessThanOrEqual(10);
    expect(seen[0]).toEqual([1000n, 1009n]);
    expect(seen[2]).toEqual([1020n, 1029n]);
    vi.restoreAllMocks();
  });

  it("banks the blocks it read when the provider refuses a later chunk", async () => {
    const { publicClient, scanBurns } = await import("../src/core/chain.js");
    let calls = 0;
    vi.spyOn(publicClient, "getLogs").mockImplementation((async () => {
      if (++calls > 2) throw new Error("Under the Free tier plan, you can make eth_getLogs requests with up to a 10 block range");
      return [];
    }) as never);

    const r = await scanBurns(1000n, 1099n);
    expect(r.complete).toBe(false);
    // Two chunks succeeded, so blocks 1000-1019 are read and the next tick resumes from 1020.
    expect(r.scannedTo).toBe(1019n);
    vi.restoreAllMocks();
  });

  it("reports nothing scanned when the very first chunk is refused", async () => {
    const { publicClient, scanBurns } = await import("../src/core/chain.js");
    vi.spyOn(publicClient, "getLogs").mockImplementation((async () => { throw new Error("rate limited"); }) as never);
    const r = await scanBurns(1000n, 1099n);
    expect(r.complete).toBe(false);
    // Below the start block, so the caller knows not to advance its cursor.
    expect(r.scannedTo).toBe(999n);
    vi.restoreAllMocks();
  });
});
