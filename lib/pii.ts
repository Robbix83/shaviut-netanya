/**
 * lib/pii.ts — minimal PII masking for server logs.
 * Keeps enough signal to debug (prefix + last 2 digits) without logging a full number.
 */

/** Mask a phone number for logs: e.g. "0501234567" → "050*****67". */
export function maskPhone(phone: string | null | undefined): string {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.length < 6) return "[phone]";
  return digits.slice(0, 3) + "*".repeat(digits.length - 5) + digits.slice(-2);
}
