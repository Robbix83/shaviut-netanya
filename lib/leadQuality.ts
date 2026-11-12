import type { Lead } from "@/lib/types";

/** A lead that isn't a real seller: marked "not relevant" in admin, named as a test, or a made-up phone
 * (a run of 5+ identical digits after the prefix, e.g. 0522222222 / 0542221111 → "22221111" has "2222"…). */
export function isTestLead(l: Pick<Lead, "name" | "phone" | "status">): boolean {
  if (l.status === "not_relevant") return true;
  const name = (l.name ?? "").toLowerCase();
  if (/בדיקה|ניסיון|test/.test(name)) return true;
  const digits = (l.phone ?? "").replace(/\D/g, "").replace(/^972/, "0");
  return /(\d)\1{4,}/.test(digits.slice(3));
}
