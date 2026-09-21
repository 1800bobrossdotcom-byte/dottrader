import { describe, it, expect } from "vitest";
process.env.LIVE = "0";

describe("NonceTracker", () => {
  it("does not reuse a nonce when the node's count lags a confirmed send", async () => {
    const { NonceTracker } = await import("../src/exec/executor.js");
    // The node keeps reporting 52 even after the tx using 52 confirmed — the bug that rejected
    // three of nine buy-backs as "replacement transaction underpriced".
    const n = new NonceTracker(async () => 52);

    expect(await n.take()).toBe(52);
    n.used();
    expect(await n.take()).toBe(53);
    n.used();
    expect(await n.take()).toBe(54);
  });

  it("does not consume a nonce when a send is rejected", async () => {
    const { NonceTracker } = await import("../src/exec/executor.js");
    const n = new NonceTracker(async () => 10);

    expect(await n.take()).toBe(10);
    // send threw, so `used()` is never called and the nonce stays available
    expect(await n.take()).toBe(10);
    n.used();
    expect(await n.take()).toBe(11);
  });

  it("follows the chain forward when other transactions used the account", async () => {
    const { NonceTracker } = await import("../src/exec/executor.js");
    let chain = 5;
    const n = new NonceTracker(async () => chain);

    expect(await n.take()).toBe(5);
    n.used();
    // A sweep or a manual transaction moved the account on without this tracker.
    chain = 20;
    expect(await n.take()).toBe(20);
  });

  it("never rewinds when the node reports a stale count", async () => {
    const { NonceTracker } = await import("../src/exec/executor.js");
    let chain = 30;
    const n = new NonceTracker(async () => chain);

    expect(await n.take()).toBe(30);
    n.used();
    chain = 28; // stale read from a lagging node
    expect(await n.take()).toBe(31);
  });
});
