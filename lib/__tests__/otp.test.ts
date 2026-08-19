import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";

// Stable server secret for deterministic signatures in tests.
process.env.OTP_SECRET = "test-secret-0123456789abcdef0123456789abcdef";

import {
  signToken,
  verifyToken,
  signLeadProof,
  verifyLeadProof,
  LEAD_PROOF_PURPOSE,
} from "@/lib/otp";

describe("OTP token (send/verify)", () => {
  it("accepts a valid signature + correct code", () => {
    const t = signToken("0501234567", "123456");
    expect(verifyToken(t, "123456")).toMatchObject({ valid: true, phone: "0501234567" });
  });

  it("rejects a wrong code", () => {
    const t = signToken("0501234567", "123456");
    expect(verifyToken(t, "000000")).toMatchObject({ valid: false, error: "wrong_code" });
  });

  it("rejects a tampered signature", () => {
    const t = signToken("0501234567", "123456");
    const tampered = t.slice(0, -2) + (t.slice(-2) === "aa" ? "bb" : "aa");
    expect(verifyToken(tampered, "123456").valid).toBe(false);
  });

  it("Twilio Verify sentinel does not embed the code", () => {
    const t = signToken("0501234567", "VERIFY");
    const decoded = Buffer.from(t, "base64url").toString("utf8");
    expect(decoded).toContain(":VERIFY:");
    expect(verifyToken(t, "anything")).toMatchObject({ valid: true, isTwilioVerify: true });
  });
});

describe("lead-submit proof", () => {
  afterEach(() => vi.useRealTimers());

  it("valid proof verifies for the same (normalized) phone", () => {
    const proof = signLeadProof("0501234567");
    expect(verifyLeadProof(proof, "0501234567")).toEqual({ valid: true });
    // normalization: +972 / 972 / dashes converge
    expect(verifyLeadProof(proof, "+972501234567")).toEqual({ valid: true });
    expect(verifyLeadProof(proof, "972-50-123-4567")).toEqual({ valid: true });
  });

  it("does NOT contain the OTP code and carries the lead-submit purpose", () => {
    const proof = signLeadProof("0501234567");
    const decoded = Buffer.from(proof, "base64url").toString("utf8");
    expect(decoded).toContain(`:${LEAD_PROOF_PURPOSE}:`);
    expect(decoded).not.toMatch(/:\d{6}:/); // no 6-digit code segment
  });

  it("rejects a missing proof", () => {
    expect(verifyLeadProof(undefined, "0501234567")).toMatchObject({ valid: false, error: "missing" });
  });

  it("rejects a bad signature", () => {
    const proof = signLeadProof("0501234567");
    const tampered = proof.slice(0, -2) + (proof.slice(-2) === "aa" ? "bb" : "aa");
    expect(verifyLeadProof(tampered, "0501234567").valid).toBe(false);
  });

  it("rejects phone mismatch (phone A proof cannot submit phone B)", () => {
    const proof = signLeadProof("0501234567");
    expect(verifyLeadProof(proof, "0509999999")).toMatchObject({ valid: false, error: "phone_mismatch" });
  });

  it("rejects an expired proof", () => {
    vi.useFakeTimers();
    const proof = signLeadProof("0501234567");
    vi.advanceTimersByTime(15 * 60 * 1000 + 1000); // TTL + 1s
    expect(verifyLeadProof(proof, "0501234567")).toMatchObject({ valid: false, error: "expired" });
  });

  it("rejects a malformed token", () => {
    expect(verifyLeadProof("not-a-real-token", "0501234567").valid).toBe(false);
  });
});

describe("OTP_SECRET fail-closed in production", () => {
  const savedSecret = process.env.OTP_SECRET;
  const savedEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.OTP_SECRET = savedSecret;
    // NODE_ENV is read-only in some typings; assign via index to restore.
    (process.env as Record<string, string | undefined>).NODE_ENV = savedEnv;
  });

  it("throws at runtime when OTP_SECRET is unset in production (does not silently use dev fallback)", () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    delete process.env.OTP_SECRET;
    expect(() => signLeadProof("0501234567")).toThrow(/OTP_SECRET/);
  });

  it("throws at runtime when OTP_SECRET is the public dev fallback in production", () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.OTP_SECRET = "dev-otp-secret-change-in-production";
    expect(() => signLeadProof("0501234567")).toThrow(/OTP_SECRET/);
  });

  it("remains usable in development without an explicit secret", () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";
    delete process.env.OTP_SECRET;
    expect(() => signLeadProof("0501234567")).not.toThrow();
  });
});
