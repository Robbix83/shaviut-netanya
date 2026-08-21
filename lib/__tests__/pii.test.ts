import { describe, it, expect } from "vitest";
import { maskPhone } from "@/lib/pii";

describe("maskPhone — server-log PII masking", () => {
  it("keeps prefix + last 2 digits, masks the middle", () => {
    expect(maskPhone("0501234567")).toBe("050*****67");
  });
  it("strips separators before masking", () => {
    expect(maskPhone("050-123-4567")).toBe("050*****67");
    expect(maskPhone("+972501234567")).toBe("972*******67");
  });
  it("never returns the full number", () => {
    const m = maskPhone("0501234567");
    expect(m).not.toContain("1234");
    expect(m).not.toBe("0501234567");
  });
  it("handles short/empty/nullish safely", () => {
    expect(maskPhone("")).toBe("[phone]");
    expect(maskPhone(null)).toBe("[phone]");
    expect(maskPhone(undefined)).toBe("[phone]");
    expect(maskPhone("12345")).toBe("[phone]");
  });
});
