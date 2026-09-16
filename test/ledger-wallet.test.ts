import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "dottrader-"));
  process.env.DATA_DIR = dir; process.env.LIVE = "0";
});

describe("Ledger per-wallet baseline", () => {
  it("sizes the sleeve from this process's wallet, not the tracked total", async () => {
    const { writeFileSync } = await import("node:fs");
    const path = await import("node:path");
    process.env.WALLET_ADDRESS = "0xcFCFc8e42AEBFC58AB78093217C2C4bB186BAc86";
    process.env.TRADING_SLEEVE = "0.5";
    writeFileSync(path.join(dir, "baseline.json"), JSON.stringify({
      startedAt: "", wallet: "0x", dot: 110_000, eth: 0.02, usdc: 0, priceUsd: 0.005, ethUsd: 2400, note: "",
      wallets: [
        { address: "0x8455cF296e1265b494605207e97884813De21950", dot: 9_000, eth: 0.0015, usdc: 0 },
        { address: "0xcFCFc8e42AEBFC58AB78093217C2C4bB186BAc86", dot: 51_000, eth: 0.0125, usdc: 0 },
        { address: "0x57C4e8C39d72540244FE8eDD302C7C463d6d545a", dot: 50_000, eth: 0.0075, usdc: 0 },
      ],
    }));
    const { Ledger } = await import("../src/core/ledger.js");
    const { Store } = await import("../src/data/store.js");
    const L = new Ledger(new Store(dir));
    expect(L.state.portfolio.dot).toBe(51_000);
    expect(L.state.coreDot).toBeCloseTo(25_500, 6);
    expect(L.tradeableDot).toBeCloseTo(25_500, 6);
  });
});
