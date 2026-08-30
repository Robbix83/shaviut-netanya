/**
 * Wednesday Launch Sprint L1 — pre-import logical backup of production
 * Supabase tables (deals, neighborhoods, leads). This is a row-content
 * (PostgREST-level) backup, not a physical pg_dump — no direct Postgres
 * connection string is configured in this environment, only the REST API
 * via @supabase/supabase-js. Read-only against production; writes nothing
 * to any table. Output is written to audit/launch/backups/, which is
 * .gitignore'd (never committed — these are real production data dumps).
 */
import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import path from "path";

function loadEnvLocal() {
  const content = readFileSync(path.resolve(process.cwd(), ".env.local"), "utf8");
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

const PAGE_SIZE = 1000;

async function fetchAll(sb: ReturnType<typeof createClient>, table: string, orderCol: string) {
  const rows: any[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await sb.from(table).select("*").order(orderCol).range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`BACKUP_READ_FAILED:${table}:${error.code}:${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    // A server-side max-rows cap smaller than PAGE_SIZE could return a
    // short page mid-table, not just at the true end — that would look
    // identical to "last page" here. The independent head-count check in
    // main() (BACKUP_COUNT_MISMATCH) is what actually rules this out.
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return rows;
}

async function countRows(sb: ReturnType<typeof createClient>, table: string): Promise<number> {
  const { count, error } = await sb.from(table).select("*", { count: "exact", head: true });
  if (error) throw new Error(`BACKUP_COUNT_FAILED:${table}:${error.code}:${error.message}`);
  if (count === null) throw new Error(`BACKUP_COUNT_FAILED:${table}:no_count_returned`);
  return count;
}

async function main() {
  loadEnvLocal();
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const backupDir = path.resolve(process.cwd(), "audit", "launch", "backups");
  mkdirSync(backupDir, { recursive: true });

  const manifest: Record<string, { rowCount: number; sha256: string; file: string }> = {};

  for (const [table, orderCol] of [
    ["neighborhoods", "id"],
    ["deals", "id"],
    ["leads", "id"],
  ] as const) {
    const expectedCount = await countRows(sb, table);
    const rows = await fetchAll(sb, table, orderCol);
    if (rows.length !== expectedCount) {
      throw new Error(
        `BACKUP_COUNT_MISMATCH:${table}:fetched=${rows.length}:expected=${expectedCount} — backup is incomplete, not writing partial data`
      );
    }
    const serialized = JSON.stringify(rows);
    const digest = sha256(serialized);
    const file = path.join(backupDir, `${table}-backup.json`);
    writeFileSync(file, serialized, "utf8");
    manifest[table] = { rowCount: rows.length, sha256: digest, file: path.relative(process.cwd(), file) };
    console.log(`${table.toUpperCase()}_BACKUP_ROWS=${rows.length}`);
    console.log(`${table.toUpperCase()}_BACKUP_SHA256=${digest}`);
  }

  const manifestPath = path.join(backupDir, "backup-manifest.json");
  writeFileSync(
    manifestPath,
    JSON.stringify({ createdAtNote: "Wednesday Launch Sprint L1 pre-import backup", tables: manifest }, null, 2),
    "utf8"
  );
  console.log("BACKUP_MANIFEST=" + path.relative(process.cwd(), manifestPath));
  console.log("BACKUP_DONE=YES");
}

main().catch((e) => {
  console.error("BACKUP_FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
