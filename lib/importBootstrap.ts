/**
 * lib/importBootstrap.ts
 * Pure, side-effect-free logic for the Wave 0B-2 Supabase bootstrap import.
 * No Supabase client, no fs, no env access here → fully unit-testable.
 * The CLI (scripts/import-supabase-bootstrap.ts) wires these to real I/O.
 */

/** The ONLY Supabase project this tool is permitted to write to. */
export const EXPECTED_PROJECT_REF = "sddtjsojbdxtakpwpqlz";
/** Full expected host — pinned (not just the ref) so a wrong TLD (.net/.in) cannot pass. */
export const EXPECTED_PROJECT_HOST = `${EXPECTED_PROJECT_REF}.supabase.co`;

/** Exact persisted columns (camelCase), matching supabase/bootstrap_v1.sql + SupabaseStore. */
export const NEIGHBORHOOD_COLUMNS = ["id", "name", "settlement", "x", "y"] as const;
export const DEAL_COLUMNS = [
  "id", "dealDate", "price", "propertyType", "rooms", "areaSqm", "plotSqm",
  "floor", "yearBuilt", "dealNature", "address", "houseNumber", "street",
  "neighborhoodId", "neighborhood", "settlement", "x", "y", "pricePerSqm",
] as const;

/** Numeric columns per table — used for deterministic canonicalization only. */
const NEIGHBORHOOD_NUMERIC = new Set(["x", "y"]);
const DEAL_NUMERIC = new Set(["price", "rooms", "areaSqm", "plotSqm", "floor", "yearBuilt", "x", "y", "pricePerSqm"]);
const DEAL_DATE = new Set(["dealDate"]);

/** Derive the Supabase project ref from a project URL (`https://<ref>.supabase.co`). */
export function deriveProjectRef(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).host; // e.g. sddtjsojbdxtakpwpqlz.supabase.co
    const m = host.match(/^([a-z0-9]+)\.supabase\.(co|in|net)$/i);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/** Parse the host of the configured URL (lowercased). */
export function deriveProjectHost(url: string | undefined | null): string | null {
  if (!url) return null;
  try { return new URL(url).host.toLowerCase(); } catch { return null; }
}

/** Hard gate: only the EXACT expected host (ref + `.supabase.co`) may be written to. */
export function assertTargetProject(url: string | undefined | null): { ok: boolean; ref: string | null; error?: string } {
  const host = deriveProjectHost(url);
  const ref = deriveProjectRef(url);
  if (!host) return { ok: false, ref: null, error: "could not parse NEXT_PUBLIC_SUPABASE_URL host" };
  if (host !== EXPECTED_PROJECT_HOST) {
    return { ok: false, ref, error: `refusing to write: connected host "${host}" != expected "${EXPECTED_PROJECT_HOST}"` };
  }
  return { ok: true, ref };
}

/** Project an arbitrary object down to exactly the given columns; undefined → null. Drops unknown fields. */
export function projectRow(obj: Record<string, unknown>, columns: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of columns) out[c] = obj[c] === undefined ? null : obj[c];
  return out;
}
export const projectNeighborhood = (n: Record<string, unknown>) => projectRow(n, NEIGHBORHOOD_COLUMNS);
export const projectDeal = (d: Record<string, unknown>) => projectRow(d, DEAL_COLUMNS);

export interface SourceValidation {
  ok: boolean;
  errors: string[];
  neighborhoodCount: number;
  dealCount: number;
}

/** Validate the source datasets (no cleaning — reject-only). */
export function validateSource(
  neighborhoods: Record<string, unknown>[],
  deals: Record<string, unknown>[],
): SourceValidation {
  const errors: string[] = [];

  const nIds = neighborhoods.map((n) => n.id);
  if (new Set(nIds).size !== nIds.length) errors.push("duplicate neighborhood ids in source");
  if (nIds.some((id) => typeof id !== "string" || !id)) errors.push("neighborhood with missing/invalid id");
  const badNeigh = neighborhoods.filter((n) => !n.name || !n.settlement).length;
  if (badNeigh > 0) errors.push(`${badNeigh} neighborhood(s) missing NOT-NULL name/settlement`);

  const dIds = deals.map((d) => d.id);
  if (new Set(dIds).size !== dIds.length) errors.push("duplicate Deal ids in source");
  if (dIds.some((id) => typeof id !== "string" || !id)) errors.push("deal with missing/invalid id");

  const nSet = new Set(nIds);
  const orphans = deals.filter((d) => !nSet.has(d.neighborhoodId)).length;
  if (orphans > 0) errors.push(`${orphans} orphan deal(s) whose neighborhoodId is not in neighborhoods`);

  const badType = deals.filter((d) => !["apartment", "house", "land"].includes(String(d.propertyType))).length;
  if (badType > 0) errors.push(`${badType} deal(s) with propertyType not in {apartment,house,land}`);

  const badDate = deals.filter((d) => d.dealDate != null && Number.isNaN(Date.parse(String(d.dealDate)))).length;
  if (badDate > 0) errors.push(`${badDate} deal(s) with unparseable dealDate`);

  return { ok: errors.length === 0, errors, neighborhoodCount: neighborhoods.length, dealCount: deals.length };
}

/** Split rows into sequential batches of `size`. */
export function batchRows<T>(rows: T[], size: number): T[][] {
  if (size <= 0) throw new Error("batch size must be > 0");
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** Canonicalize one projected row for cross-store digest comparison (representation-normalized). */
export function canonicalizeRow(
  row: Record<string, unknown>,
  columns: readonly string[],
  numeric: Set<string>,
  dateCols: Set<string>,
): unknown[] {
  return columns.map((c) => {
    const v = row[c];
    if (v === null || v === undefined) return null;
    if (numeric.has(c)) return Number(v);
    if (dateCols.has(c)) return String(v).slice(0, 10);
    return String(v);
  });
}

/** Deterministic digest of a row set: project → canonicalize → sort by id → JSON → FNV-1a hash. */
export function digestRows(
  rows: Record<string, unknown>[],
  columns: readonly string[],
  numeric: Set<string>,
  dateCols: Set<string>,
): { digest: string; count: number } {
  const canon = rows
    .map((r) => canonicalizeRow(projectRow(r, columns), columns, numeric, dateCols))
    .sort((a, b) => String(a[0]).localeCompare(String(b[0]))); // sort by id (column 0)
  const json = JSON.stringify(canon);
  return { digest: fnv1a(json), count: rows.length };
}

export const digestNeighborhoods = (rows: Record<string, unknown>[]) =>
  digestRows(rows, NEIGHBORHOOD_COLUMNS, NEIGHBORHOOD_NUMERIC, new Set());
export const digestDeals = (rows: Record<string, unknown>[]) =>
  digestRows(rows, DEAL_COLUMNS, DEAL_NUMERIC, DEAL_DATE);

/** Strip anything that looks like a secret from a string before logging (defense-in-depth). */
export function redactSecrets(s: string): string {
  return String(s)
    .replace(/sb_secret_[A-Za-z0-9_-]+/g, "sb_secret_[REDACTED]")
    .replace(/sb_publishable_[A-Za-z0-9_-]+/g, "sb_publishable_[REDACTED]")
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, "[REDACTED_JWT]")
    .replace(/\b(apikey|authorization|bearer)\b\s*[:=]?\s*\S+/gi, "$1 [REDACTED]");
}

export interface SupabaseErrorLike {
  message?: unknown; code?: unknown; details?: unknown; hint?: unknown; status?: unknown; statusCode?: unknown;
}

/**
 * Build a safe, informative one-line error for a Supabase/PostgREST failure.
 * Reads ONLY whitelisted fields (never request headers/keys) and redacts secrets.
 */
export function formatSupabaseError(operation: string, error: SupabaseErrorLike | null | undefined): string {
  if (error == null) return `${operation} failed: no error object returned`;
  const parts = [`${operation} failed`];
  const status = error.status ?? error.statusCode;
  if (status !== undefined && status !== null && status !== "") parts.push(`status=${String(status)}`);
  if (error.code !== undefined && error.code !== null && error.code !== "") parts.push(`code=${String(error.code)}`);
  parts.push(`message=${error.message != null ? String(error.message) : "(none)"}`);
  if (error.details) parts.push(`details=${String(error.details)}`);
  if (error.hint) parts.push(`hint=${String(error.hint)}`);
  return redactSecrets(parts.join(" | "));
}

/**
 * Interpret a Supabase count result. A count of **0 is a VALID success** (expected
 * initial state). Fail ONLY on a real error, or when no count was returned at all.
 * Never treats 0/falsy as failure.
 */
export function interpretCountResult(
  table: string,
  result: { count?: number | null; error?: SupabaseErrorLike | null } | null | undefined,
): number {
  if (!result) throw new Error(`count(${table}) failed: no result object returned`);
  if (result.error) throw new Error(formatSupabaseError(`count(${table})`, result.error));
  if (result.count === null || result.count === undefined) {
    throw new Error(`count(${table}) failed: no count returned though error was null (check Prefer: count=exact / Content-Range)`);
  }
  return result.count; // 0 is a valid count
}

/** 64-bit FNV-1a hash as hex (dependency-free, deterministic; not for security). */
export function fnv1a(str: string): string {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < str.length; i++) {
    h ^= BigInt(str.charCodeAt(i));
    h = (h * prime) & mask;
  }
  return h.toString(16).padStart(16, "0");
}

export interface CliArgs {
  dryRun: boolean;
  resume: boolean;
  batchSize: number;
}

/** Parse CLI flags. Default is DRY-RUN (no writes); real writes require explicit --write. */
export function parseArgs(argv: string[]): CliArgs {
  const has = (f: string) => argv.includes(f);
  const write = has("--write") || has("--execute");
  const bs = argv.find((a) => a.startsWith("--batch-size="));
  let batchSize = bs ? parseInt(bs.split("=")[1], 10) : 500;
  if (!Number.isFinite(batchSize) || batchSize < 1) batchSize = 500;
  if (batchSize > 1000) batchSize = 1000; // conservative ceiling
  return { dryRun: !write, resume: has("--resume"), batchSize };
}

/** Decide whether the remote preflight permits import. */
export function checkPreflight(
  counts: { neighborhoods: number; deals: number; leads: number },
  opts: { resume: boolean },
): { ok: boolean; stop?: string } {
  if (counts.leads > 0) {
    return { ok: false, stop: `leads table has ${counts.leads} rows — refusing (leads must stay 0)` };
  }
  if (!opts.resume && (counts.neighborhoods > 0 || counts.deals > 0)) {
    return {
      ok: false,
      stop: `initial import requires empty tables (neighborhoods=${counts.neighborhoods}, deals=${counts.deals}); use --resume to intentionally continue`,
    };
  }
  return { ok: true };
}

export interface ResumeManifest {
  targetProjectRef: string;
  sourceNeighborhoodsSha256: string;
  sourceDealsSha256: string;
}

/** Validate that a resume is safe: same project + identical source hashes. */
export function validateResume(
  manifest: ResumeManifest | null,
  current: { ref: string; neighborhoodsSha: string; dealsSha: string; leads: number },
): { ok: boolean; error?: string } {
  if (!manifest) return { ok: false, error: "resume requested but no prior manifest found" };
  if (manifest.targetProjectRef !== current.ref) return { ok: false, error: "resume manifest project ref mismatch" };
  if (manifest.sourceNeighborhoodsSha256 !== current.neighborhoodsSha) return { ok: false, error: "neighborhoods source hash changed since manifest — refusing resume" };
  if (manifest.sourceDealsSha256 !== current.dealsSha) return { ok: false, error: "deals source hash changed since manifest — refusing resume" };
  if (current.leads > 0) return { ok: false, error: "leads must be 0 to resume" };
  return { ok: true };
}
