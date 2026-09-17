import { describe, it, expect } from "vitest";
import { JOURNEY, JOURNEY_START_DOT_EQ, VAULT_BASELINE } from "../src/core/config.js";

/**
 * The journey is the two trading bots. The vault's original stack is excluded; only DOT swept into it counts.
 * These tests pin that accounting so a later refactor can't quietly fold the vault back into the start.
 */
describe("journey accounting", () => {
  it("starts from the two bots' funding, not the vault", () => {
    expect(JOURNEY.dot).toBeCloseTo(101_138.99, 2);
    // 51,138.99 (w1) + 50,000 (w2); the vault's retained 9,000 is not included
    expect(JOURNEY.dot).toBeCloseTo(51_138.99 + 50_000, 2);
    expect(VAULT_BASELINE.dot).toBe(9_000);
  });

  it("values the bots' gas ETH in DOT so start and now compare like for like", () => {
    const ethAsDot = (JOURNEY.eth * JOURNEY.ethUsd) / JOURNEY.priceUsd;
    expect(ethAsDot).toBeGreaterThan(8_000);
    expect(ethAsDot).toBeLessThan(8_500);
    expect(JOURNEY_START_DOT_EQ).toBeCloseTo(JOURNEY.dot + ethAsDot, 6);
    expect(JOURNEY_START_DOT_EQ).toBeGreaterThan(109_000);
    expect(JOURNEY_START_DOT_EQ).toBeLessThan(110_000);
  });

  it("counts the vault only for what has been swept in", () => {
    const priceEth = 2.3e-6;
    const asDot = (dot: number, eth: number) => dot + eth / priceEth;
    const vaultContribution = (dot: number, eth: number) =>
      Math.max(0, asDot(dot, eth) - asDot(VAULT_BASELINE.dot, VAULT_BASELINE.eth));

    // Untouched vault contributes nothing to the journey.
    expect(vaultContribution(VAULT_BASELINE.dot, VAULT_BASELINE.eth)).toBeCloseTo(0, 6);
    // A 500 DOT sweep shows up as exactly 500.
    expect(vaultContribution(VAULT_BASELINE.dot + 500, VAULT_BASELINE.eth)).toBeCloseTo(500, 6);
    // A vault somehow below its baseline never contributes a negative.
    expect(vaultContribution(0, 0)).toBe(0);
  });
});
