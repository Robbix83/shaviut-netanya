/**
 * lib/config.ts
 * Fail-closed production configuration seams (pure, unit-testable).
 * These are evaluated at request runtime (via getStore / route handlers),
 * never at import time, so `next build` is unaffected.
 */

export type DataSourceMode = "local" | "supabase";

export interface EnvLike {
  DATA_SOURCE?: string;
  NODE_ENV?: string;
  /** Next.js sets this to "phase-production-build" during `next build`. */
  NEXT_PHASE?: string;
}

/**
 * Resolve the data source, failing closed in production REQUEST runtime.
 *  - production (serving requests): DATA_SOURCE MUST be exactly "supabase"; missing or "local" throws.
 *  - production BUILD phase (`next build` prerender/data-collection): not enforced, so a local
 *    build does not break; a real production build runs with DATA_SOURCE=supabase anyway.
 *  - development/test: defaults to "local"; "supabase" honored if set.
 */
export function resolveDataSource(env: EnvLike): DataSourceMode {
  const raw = env.DATA_SOURCE;
  const isProduction = env.NODE_ENV === "production";
  const isBuildPhase = env.NEXT_PHASE === "phase-production-build";

  if (isProduction && !isBuildPhase) {
    if (raw !== "supabase") {
      throw new Error(
        `DATA_SOURCE must be "supabase" in production (got ${raw ?? "undefined"}); refusing to run local store in production.`,
      );
    }
    return "supabase";
  }

  return raw === "supabase" ? "supabase" : "local";
}

/**
 * Authorization decision for the Green incoming webhook, failing closed in production.
 *  - production with no configured token: DENY (never process unauthenticated in prod).
 *  - token configured: provided must match exactly.
 *  - development with no token: allow (local testing convenience).
 */
export function isWebhookAuthorized(opts: {
  expected: string | undefined;
  provided: string | null;
  isProduction: boolean;
}): boolean {
  const { expected, provided, isProduction } = opts;
  if (isProduction && !expected) return false; // fail closed
  if (expected) return provided === expected;
  return true; // dev, no token configured
}
