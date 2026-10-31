import { describe, expect, it } from "vitest";
import { rateCheck, rateRefund } from "../rateLimit";

describe("rateRefund", () => {
  it("gives a failed attempt back", () => {
    const key = "test:refund";
    for (let i = 0; i < 5; i++) {
      expect(rateCheck(key, 2, 60_000)).toBe(true);
      rateRefund(key);
    }
  });

  it("still blocks attempts that were not refunded", () => {
    const key = "test:no-refund";
    expect(rateCheck(key, 2, 60_000)).toBe(true);
    expect(rateCheck(key, 2, 60_000)).toBe(true);
    expect(rateCheck(key, 2, 60_000)).toBe(false);
  });

  it("ignores an unknown key", () => {
    expect(() => rateRefund("test:missing")).not.toThrow();
  });
});
