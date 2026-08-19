import { promises as fs } from "fs";
import path from "path";
import type { Deal, Neighborhood, Lead, LeadStatus, TabuStatus } from "./types";
import { resolveDataSource } from "./config";

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
}

export interface Store {
  listNeighborhoods(settlement: string): Promise<Neighborhood[]>;
  getNeighborhood(id: string): Promise<Neighborhood | null>;
  getDealsByNeighborhood(neighborhoodId: string, q?: DealsQuery): Promise<Deal[]>;
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
    if (!_localDeals) _localDeals = await readJson<Deal[]>("deals.json", []);
    return _localDeals;
  }
  private async neigh(): Promise<Neighborhood[]> {
    if (!_localNeigh) _localNeigh = await readJson<Neighborhood[]>("neighborhoods.json", []);
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
    const cutoff = q.monthsBack ? monthsAgoISO(q.monthsBack) : null;
    return all.filter((d) => {
      if (d.neighborhoodId !== neighborhoodId) return false;
      if (cutoff && d.dealDate < cutoff) return false;
      if (q.roomsMin != null && (d.rooms ?? 0) < q.roomsMin) return false;
      if (q.roomsMax != null && (d.rooms ?? 99) > q.roomsMax) return false;
      return true;
    });
  }

  async getAllDeals(): Promise<Deal[]> {
    return this.deals();
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

  async listNeighborhoods(settlement: string): Promise<Neighborhood[]> {
    const sb = await this.client();
    const { data, error } = await sb
      .from("neighborhoods")
      .select("*")
      .eq("settlement", settlement)
      .order("name");
    if (error) throw error;
    return (data ?? []) as Neighborhood[];
  }

  async getNeighborhood(id: string): Promise<Neighborhood | null> {
    const sb = await this.client();
    const { data } = await sb.from("neighborhoods").select("*").eq("id", id).maybeSingle();
    return (data as Neighborhood) ?? null;
  }

  async getDealsByNeighborhood(neighborhoodId: string, q: DealsQuery = {}): Promise<Deal[]> {
    const sb = await this.client();
    let query = sb.from("deals").select("*").eq("neighborhoodId", neighborhoodId);
    if (q.monthsBack) query = query.gte("dealDate", monthsAgoISO(q.monthsBack));
    if (q.roomsMin != null) query = query.gte("rooms", q.roomsMin);
    if (q.roomsMax != null) query = query.lte("rooms", q.roomsMax);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as Deal[];
  }

  async getAllDeals(): Promise<Deal[]> {
    const sb = await this.client();
    const { data, error } = await sb.from("deals").select("id,neighborhoodId,x,y");
    if (error) throw error;
    return (data ?? []) as Deal[];
  }

  async getStats(): Promise<{ dealCount: number; neighborhoodCount: number }> {
    const sb = await this.client();
    const [countRes, neighRes] = await Promise.all([
      sb.from("deals").select("id", { count: "exact", head: true }),
      sb.from("deals").select("neighborhoodId").not("neighborhoodId", "is", null),
    ]);
    const dealCount = countRes.count ?? 0;
    const neighborhoodCount = new Set((neighRes.data ?? []).map((d: any) => d.neighborhoodId)).size;
    return { dealCount, neighborhoodCount };
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
      .from("deals")
      .select("dealDate")
      .order("dealDate", { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data?.dealDate as string) ?? new Date().toISOString().slice(0, 10);
  }
}

// ---------- helpers ----------

function monthsAgoISO(months: number): string {
  const d = new Date();
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
