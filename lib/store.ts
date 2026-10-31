import { promises as fs } from "fs";
import path from "path";
import type { Deal, Neighborhood, Lead, LeadStatus, TabuStatus } from "./types";
import { resolveDataSource, resolveDataTables } from "./config";
import { withNeighborhoodName, withNeighborhoodTitle } from "./neighborhoodNames";

/**
 * שכבת גישה לנתונים עם שני מימושים:
 *  - "local": קבצי JSON תחת /data (לפיתוח ואימות מקומי)
 *  - "supabase": Postgres מנוהל (פרודקשן)
 * נבחר לפי משתנה הסביבה DATA_SOURCE, עם כשל-סגור בפרודקשן (ראה lib/config.ts).
 * ההכרעה מתבצעת ב-getStore() בזמן ריצה — לא ב-import — כדי לא לשבור `next build`.
 */

const DATA_DIR = path.join(process.cwd(), "data");

export interface DealsQuery {
  /** רק עסקאות מ-N החודשים האחרונים */
  monthsBack?: number;
  /** סינון לפי טווח חדרים (לדמיון) */
  roomsMin?: number;
  roomsMax?: number;
  /** "נכון לתאריך" (בדיקה לאחור): רק עסקאות שלפניו, ו-monthsBack נספר ממנו. ריק = היום */
  asOf?: string | null;
}

export interface Store {
  listNeighborhoods(settlement: string): Promise<Neighborhood[]>;
  getNeighborhood(id: string): Promise<Neighborhood | null>;
  getDealsByNeighborhood(neighborhoodId: string, q?: DealsQuery): Promise<Deal[]>;
  /** עסקאות ברחוב (התאמת שם אחרי הסרת שד'/רחוב, כמו במנוע) — לזיהוי שכונה מהנתונים עצמם */
  getDealsByStreet(street: string, q?: DealsQuery): Promise<Deal[]>;
  /** כל העסקאות — לשימוש בחיפוש שכונה לפי קואורדינטות */
  getAllDeals(): Promise<Deal[]>;
  /** סטטיסטיקות לדף הבית — ללא העמסת כל העסקאות כמערך ל-caller */
  getStats(): Promise<{ dealCount: number; neighborhoodCount: number }>;
  insertLead(lead: Lead): Promise<Lead>;
  getLeads(opts?: { limit?: number; status?: LeadStatus }): Promise<Lead[]>;
  countLeads(): Promise<number>;
  updateLeadStatus(id: string, status: LeadStatus): Promise<void>;
  updateTabuStatus(id: string, tabuStatus: TabuStatus, tabuNotes?: string | null): Promise<void>;
  optOutByPhone(phone: string): Promise<boolean>;
  dataAsOf(): Promise<string>;
}

/** נרמול טלפון להשוואה (מוריד מקפים/רווחים, מאחד 972/0) */
export function normalizePhone(p: string): string {
  let s = (p || "").replace(/[-\s]/g, "");
  if (s.startsWith("+")) s = s.slice(1);
  if (s.startsWith("972")) s = "0" + s.slice(3);
  return s;
}

// ---------- מימוש מקומי (JSON) ----------

let _localDeals: Deal[] | null = null;
let _localNeigh: Neighborhood[] | null = null;

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(path.join(DATA_DIR, file), "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

class LocalStore implements Store {
  private async deals(): Promise<Deal[]> {
    if (!_localDeals) _localDeals = (await readJson<Deal[]>("deals.json", [])).map(withNeighborhoodName);
    return _localDeals;
  }
  private async neigh(): Promise<Neighborhood[]> {
    if (!_localNeigh) _localNeigh = (await readJson<Neighborhood[]>("neighborhoods.json", [])).map(withNeighborhoodTitle);
    return _localNeigh;
  }

  async listNeighborhoods(settlement: string): Promise<Neighborhood[]> {
    const all = await this.neigh();
    return all.filter((n) => n.settlement === settlement);
  }

  async getNeighborhood(id: string): Promise<Neighborhood | null> {
    const all = await this.neigh();
    return all.find((n) => n.id === id) ?? null;
  }

  async getDealsByNeighborhood(neighborhoodId: string, q: DealsQuery = {}): Promise<Deal[]> {
    const all = await this.deals();
    const cutoff = q.monthsBack ? monthsAgoISO(q.monthsBack, q.asOf) : null;
    return all.filter((d) => {
      if (d.neighborhoodId !== neighborhoodId) return false;
      if (cutoff && d.dealDate < cutoff) return false;
      if (q.asOf && d.dealDate >= q.asOf) return false;
      if (q.roomsMin != null && (d.rooms ?? 0) < q.roomsMin) return false;
      if (q.roomsMax != null && (d.rooms ?? 99) > q.roomsMax) return false;
      return true;
    });
  }

  async getAllDeals(): Promise<Deal[]> {
    return this.deals();
  }

  async getDealsByStreet(street: string, q: DealsQuery = {}): Promise<Deal[]> {
    return filterByStreet(await this.deals(), street, q);
  }

  async getStats(): Promise<{ dealCount: number; neighborhoodCount: number }> {
    const all = await this.deals();
    const neighborhoodCount = new Set(all.map((d) => d.neighborhoodId).filter(Boolean)).size;
    return { dealCount: all.length, neighborhoodCount };
  }

  async insertLead(lead: Lead): Promise<Lead> {
    const file = path.join(DATA_DIR, "leads.json");
    const existing = await readJson<Lead[]>("leads.json", []);
    const withMeta: Lead = {
      ...lead,
      id: lead.id ?? `lead_${Date.now()}`,
      createdAt: lead.createdAt ?? new Date().toISOString(),
      status: lead.status ?? "new",
    };
    existing.push(withMeta);
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(file, JSON.stringify(existing, null, 2), "utf8");
    return withMeta;
  }

  async getLeads(opts: { limit?: number; status?: LeadStatus } = {}): Promise<Lead[]> {
    const all = await readJson<Lead[]>("leads.json", []);
    let res = [...all].reverse(); // newest first
    if (opts.status) res = res.filter((l) => l.status === opts.status);
    if (opts.limit) res = res.slice(0, opts.limit);
    return res;
  }

  async countLeads(): Promise<number> {
    const all = await readJson<Lead[]>("leads.json", []);
    return all.length;
  }

  async updateLeadStatus(id: string, status: LeadStatus): Promise<void> {
    const file = path.join(DATA_DIR, "leads.json");
    const all = await readJson<Lead[]>("leads.json", []);
    const idx = all.findIndex((l) => l.id === id);
    if (idx >= 0) { all[idx].status = status; await fs.writeFile(file, JSON.stringify(all, null, 2), "utf8"); }
  }

  async updateTabuStatus(id: string, tabuStatus: TabuStatus, tabuNotes?: string | null): Promise<void> {
    const file = path.join(DATA_DIR, "leads.json");
    const all = await readJson<Lead[]>("leads.json", []);
    const idx = all.findIndex((l) => l.id === id);
    if (idx >= 0) {
      all[idx].tabuStatus = tabuStatus;
      if (tabuNotes !== undefined) all[idx].tabuNotes = tabuNotes;
      if (tabuStatus === "ordered" && !all[idx].tabuOrderedAt) {
        all[idx].tabuOrderedAt = new Date().toISOString();
      }
      await fs.writeFile(file, JSON.stringify(all, null, 2), "utf8");
    }
  }

  async optOutByPhone(phone: string): Promise<boolean> {
    const file = path.join(DATA_DIR, "leads.json");
    const all = await readJson<Lead[]>("leads.json", []);
    const target = normalizePhone(phone);
    let found = false;
    const now = new Date().toISOString();
    for (const l of all) {
      if (normalizePhone(l.phone) === target) {
        l.optOutAt = now;
        l.consentMarketing = false;
        found = true;
      }
    }
    if (found) await fs.writeFile(file, JSON.stringify(all, null, 2), "utf8");
    return found;
  }

  async dataAsOf(): Promise<string> {
    const all = await this.deals();
    if (!all.length) return new Date().toISOString().slice(0, 10);
    return all.reduce((max, d) => (d.dealDate > max ? d.dealDate : max), all[0].dealDate);
  }
}

// ---------- מימוש Supabase ----------

class SupabaseStore implements Store {
  private async client() {
    const { createClient } = await import("@supabase/supabase-js");
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    return createClient(url, key, { auth: { persistSession: false } });
  }

  /**
   * Wave 0G-L2: explicit, reversible preview-table override for
   * acceptance testing against the isolated deals_v2_preview /
   * neighborhoods_v2_preview tables (see supabase/l1_preview_tables.sql).
   * Off by default — every existing call site is unaffected unless
   * `PREVIEW_TABLES=1` is set, which is not part of any normal deploy
   * config. Deliberately never applied to "leads" (see every call site
   * below — lead reads/writes always target the real `leads` table,
   * regardless of this flag, per this wave's explicit lead-safety
   * requirement) so acceptance testing can exercise real deals/
   * neighborhoods data without ever touching lead capture's data sink.
   */
  private table(name: "deals" | "neighborhoods"): string {
    if (process.env.PREVIEW_TABLES === "1") {
      if (process.env.NODE_ENV === "production") {
        // Extra guard, not required by resolveDataSource() (which only
        // gates DATA_SOURCE): a real production deploy has no reason to
        // ever set this flag, so treat it as almost certainly a
        // misconfiguration rather than a deliberate choice — fail loud
        // instead of silently serving preview data to real users.
        throw new Error("PREVIEW_TABLES=1 is set in a production environment — refusing to serve preview data to real traffic.");
      }
      return `${name}_v2_preview`;
    }
    return resolveDataTables(process.env)[name];
  }

  async listNeighborhoods(settlement: string): Promise<Neighborhood[]> {
    const sb = await this.client();
    const { data, error } = await sb
      .from(this.table("neighborhoods"))
      .select("*")
      .eq("settlement", settlement)
      .order("name");
    if (error) throw error;
    return ((data ?? []) as Neighborhood[]).map(withNeighborhoodTitle);
  }

  async getNeighborhood(id: string): Promise<Neighborhood | null> {
    const sb = await this.client();
    const { data } = await sb.from(this.table("neighborhoods")).select("*").eq("id", id).maybeSingle();
    return data ? withNeighborhoodTitle(data as Neighborhood) : null;
  }

  async getDealsByNeighborhood(neighborhoodId: string, q: DealsQuery = {}): Promise<Deal[]> {
    const sb = await this.client();
    // PostgREST caps a single response at ~1000 rows — a neighborhood can exceed that
    // (proven: one real neighborhood has 3,010 deals), silently truncating the candidate
    // pool an unbounded select() would see. Page with .range() until a short page ends it,
    // matching the exhaustive-pagination fix already applied to getStats() (Wave 0C-2B).
    // .order("id") makes page boundaries deterministic — without it, Postgres gives no
    // ordering guarantee across separate paginated requests.
    const PAGE_SIZE = 1000;
    const all: Deal[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      let query = sb.from(this.table("deals")).select("*").eq("neighborhoodId", neighborhoodId).order("id");
      if (q.monthsBack) query = query.gte("dealDate", monthsAgoISO(q.monthsBack, q.asOf));
      if (q.asOf) query = query.lt("dealDate", q.asOf);
      if (q.roomsMin != null) query = query.gte("rooms", q.roomsMin);
      if (q.roomsMax != null) query = query.lte("rooms", q.roomsMax);
      const { data, error } = await query.range(offset, offset + PAGE_SIZE - 1);
      if (error) throw error;
      const page = (data ?? []) as Deal[];
      all.push(...page);
      if (page.length < PAGE_SIZE) break;
    }
    return all.map(withNeighborhoodName);
  }

  async getAllDeals(): Promise<Deal[]> {
    const sb = await this.client();
    // Full Deal projection (not a narrow id/neighborhoodId/x/y subset) and exhaustive
    // pagination — city-wide fallback logic in lib/valuation.ts filters on `street` and
    // `houseNumber`, which a narrower projection silently strips (proven root cause of
    // the Hartom-30/Weizmann-92 comparable-selection bug, Wave 0E-1B). This must match
    // LocalStore.getAllDeals()'s full-array semantics, not just avoid a crash.
    const PAGE_SIZE = 1000;
    const all: Deal[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await sb.from(this.table("deals")).select("*").order("id").range(offset, offset + PAGE_SIZE - 1);
      if (error) throw error;
      const page = (data ?? []) as Deal[];
      all.push(...page);
      if (page.length < PAGE_SIZE) break;
    }
    return all.map(withNeighborhoodName);
  }

  async getDealsByStreet(street: string, q: DealsQuery = {}): Promise<Deal[]> {
    const core = normalizeStreetName(street);
    if (!core) return [];
    const sb = await this.client();
    // אין אינדקס על street: סריקה אחת בצד השרת (ilike), ואז אותו כלל התאמה כמו במנוע
    const pattern = `%${core.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
    const PAGE_SIZE = 1000;
    const all: Deal[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      let query = sb.from(this.table("deals")).select("*").ilike("street", pattern).order("id");
      if (q.asOf) query = query.lt("dealDate", q.asOf);
      const { data, error } = await query.range(offset, offset + PAGE_SIZE - 1);
      if (error) throw error;
      const page = (data ?? []) as Deal[];
      all.push(...page);
      if (page.length < PAGE_SIZE) break;
    }
    return filterByStreet(all.map(withNeighborhoodName), street, q);
  }

  async getStats(): Promise<{ dealCount: number; neighborhoodCount: number }> {
    const sb = await this.client();
    const countRes = await sb.from(this.table("deals")).select("id", { count: "exact", head: true });
    // A failed count query must not be reported as "0 deals" — that's indistinguishable
    // from a genuinely empty table. Fail loud, matching every other SupabaseStore method.
    if (countRes.error) throw countRes.error;
    const dealCount = countRes.count ?? 0;

    // neighborhoodCount = distinct neighborhoodIds represented in deals (matches
    // LocalStore's Set-based computation — see LocalStore.getStats() above). A single
    // unbounded select was silently capped at PostgREST's default 1000-row response
    // limit, undercounting on any table with more rows than that. Page through the
    // (narrow, single-column) neighborhoodId projection instead so every row is seen.
    const PAGE_SIZE = 1000;
    const neighborhoodIds = new Set<string>();
    for (let offset = 0; offset < dealCount; offset += PAGE_SIZE) {
      const page = await sb
        .from(this.table("deals"))
        .select("neighborhoodId")
        .not("neighborhoodId", "is", null)
        .range(offset, offset + PAGE_SIZE - 1);
      if (page.error) throw page.error;
      for (const row of (page.data ?? []) as Array<{ neighborhoodId: string }>) {
        if (row.neighborhoodId) neighborhoodIds.add(row.neighborhoodId);
      }
    }
    return { dealCount, neighborhoodCount: neighborhoodIds.size };
  }

  async insertLead(lead: Lead): Promise<Lead> {
    const sb = await this.client();
    const { data, error } = await sb.from("leads").insert(lead).select().single();
    if (error) throw error;
    return data as Lead;
  }

  async getLeads(opts: { limit?: number; status?: LeadStatus } = {}): Promise<Lead[]> {
    const sb = await this.client();
    let q = sb.from("leads").select("*").order("createdAt", { ascending: false });
    if (opts.status) q = q.eq("status", opts.status);
    if (opts.limit) q = q.limit(opts.limit);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as Lead[];
  }

  async countLeads(): Promise<number> {
    const sb = await this.client();
    const { count, error } = await sb
      .from("leads")
      .select("*", { count: "exact", head: true });
    if (error) return 0;
    return count ?? 0;
  }

  async updateLeadStatus(id: string, status: LeadStatus): Promise<void> {
    const sb = await this.client();
    await sb.from("leads").update({ status }).eq("id", id);
  }

  async updateTabuStatus(id: string, tabuStatus: TabuStatus, tabuNotes?: string | null): Promise<void> {
    const sb = await this.client();
    const patch: Record<string, unknown> = { tabuStatus };
    if (tabuNotes !== undefined) patch.tabuNotes = tabuNotes;
    if (tabuStatus === "ordered") patch.tabuOrderedAt = new Date().toISOString();
    await sb.from("leads").update(patch).eq("id", id);
  }

  async optOutByPhone(phone: string): Promise<boolean> {
    const sb = await this.client();
    const norm = normalizePhone(phone);
    const intl = "972" + norm.slice(1);
    const { data, error } = await sb
      .from("leads")
      .update({ optOutAt: new Date().toISOString(), consentMarketing: false })
      .or(`phone.eq.${norm},phone.eq.${intl},phone.eq.+${intl}`)
      .select("id");
    if (error) return false;
    return (data?.length ?? 0) > 0;
  }

  async dataAsOf(): Promise<string> {
    const sb = await this.client();
    const { data } = await sb
      .from(this.table("deals"))
      .select("dealDate")
      .order("dealDate", { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data?.dealDate as string) ?? new Date().toISOString().slice(0, 10);
  }
}

// ---------- helpers ----------

const STREET_PREFIX = /^(שד'?|שדרות|רחוב|רח')\s*/i;
/** אותה נורמליזציה כמו ב-lib/valuation.ts: בלי שד'/שדרות/רחוב/רח' */
export function normalizeStreetName(s: string): string {
  return s.replace(STREET_PREFIX, "").trim();
}

/** כלל ההתאמה של המנוע: שם זהה אחרי נורמליזציה, או שם ה-DB חלק מהשם שהוזן (לא להפך) */
function filterByStreet(deals: Deal[], street: string, q: DealsQuery): Deal[] {
  const want = normalizeStreetName(street);
  if (!want) return [];
  return deals.filter((d) => {
    if (!d.street) return false;
    if (q.asOf && d.dealDate >= q.asOf) return false;
    const ds = normalizeStreetName(d.street);
    return ds !== "" && (ds === want || want.includes(ds));
  });
}

function monthsAgoISO(months: number, asOf?: string | null): string {
  const d = asOf ? new Date(asOf + "T00:00:00Z") : new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

let _store: Store | null = null;
export function getStore(): Store {
  if (_store) return _store;
  // Fail-closed in production: throws if DATA_SOURCE is not "supabase" (see lib/config.ts).
  const mode = resolveDataSource(process.env);
  _store = mode === "supabase" ? new SupabaseStore() : new LocalStore();
  return _store;
}

// ---------- מימוש בזיכרון (backtest / בדיקות) ----------

/**
 * Store לקריאה בלבד מעל מערכים שכבר בזיכרון — לבדיקה לאחור (scripts/backtest) ולבדיקות.
 * מתודות הלידים זורקות: אסור שבדיקה לאחור תכתוב ליד.
 * `hide` מסתיר עסקאות לפי id (leave-one-out) בלי לבנות את המערך מחדש.
 */
export class MemoryStore implements Store {
  readonly hide = new Set<string>();
  constructor(private readonly deals: Deal[], private readonly neighborhoods: Neighborhood[]) {}

  private visible(): Deal[] {
    return this.hide.size ? this.deals.filter((d) => !this.hide.has(d.id)) : this.deals;
  }

  async listNeighborhoods(settlement: string): Promise<Neighborhood[]> {
    return this.neighborhoods.filter((n) => n.settlement === settlement);
  }

  async getNeighborhood(id: string): Promise<Neighborhood | null> {
    return this.neighborhoods.find((n) => n.id === id) ?? null;
  }

  async getDealsByNeighborhood(neighborhoodId: string, q: DealsQuery = {}): Promise<Deal[]> {
    const cutoff = q.monthsBack ? monthsAgoISO(q.monthsBack, q.asOf) : null;
    return this.visible().filter((d) => {
      if (d.neighborhoodId !== neighborhoodId) return false;
      if (cutoff && d.dealDate < cutoff) return false;
      if (q.asOf && d.dealDate >= q.asOf) return false;
      if (q.roomsMin != null && (d.rooms ?? 0) < q.roomsMin) return false;
      if (q.roomsMax != null && (d.rooms ?? 99) > q.roomsMax) return false;
      return true;
    });
  }

  async getAllDeals(): Promise<Deal[]> {
    return this.visible();
  }

  async getDealsByStreet(street: string, q: DealsQuery = {}): Promise<Deal[]> {
    return filterByStreet(this.visible(), street, q);
  }

  async getStats(): Promise<{ dealCount: number; neighborhoodCount: number }> {
    const all = this.visible();
    return { dealCount: all.length, neighborhoodCount: new Set(all.map((d) => d.neighborhoodId).filter(Boolean)).size };
  }

  async dataAsOf(): Promise<string> {
    const all = this.visible();
    if (!all.length) return new Date().toISOString().slice(0, 10);
    return all.reduce((max, d) => (d.dealDate > max ? d.dealDate : max), all[0].dealDate);
  }

  private readOnly(): never {
    throw new Error("MemoryStore is read-only (backtest/test store)");
  }
  async insertLead(): Promise<Lead> { return this.readOnly(); }
  async getLeads(): Promise<Lead[]> { return []; }
  async countLeads(): Promise<number> { return 0; }
  async updateLeadStatus(): Promise<void> { return this.readOnly(); }
  async updateTabuStatus(): Promise<void> { return this.readOnly(); }
  async optOutByPhone(): Promise<boolean> { return this.readOnly(); }
}

/** מחליף את ה-store של התהליך (בדיקה לאחור ובדיקות בלבד). null → נבחר מחדש לפי הסביבה. */
export function setStoreForTesting(store: Store | null): void {
  _store = store;
}
