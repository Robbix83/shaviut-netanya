/**
 * lib/adminAuth.ts
 * Pure authorization predicate for admin sign-in, extracted as a testable seam.
 * Used by auth.ts `signIn` callback. No framework dependency → unit-testable.
 *
 * Fail-closed rule:
 *  - If ADMIN_EMAIL is configured: authorize ONLY the exact matching email.
 *  - If ADMIN_EMAIL is NOT configured:
 *      - production  → DENY everyone (never silently authorize arbitrary Google accounts)
 *      - development → allow (local convenience only; explicitly non-production)
 */
export interface AdminAuthEnv {
  adminEmail: string | undefined;
  isProduction: boolean;
}

export function isAdminAuthorized(
  email: string | null | undefined,
  env: AdminAuthEnv,
): boolean {
  const adminEmail = env.adminEmail?.trim();
  if (adminEmail) {
    return !!email && email === adminEmail;
  }
  // ADMIN_EMAIL unset: fail closed in production, convenient in dev.
  return !env.isProduction;
}
