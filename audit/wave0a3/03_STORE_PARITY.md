# 03 — STORE PARITY (LocalStore vs SupabaseStore)

**Method:** code analysis of `lib/store.ts` against the shared `Store` interface. No refactor.

| Method | Local behavior | Supabase behavior | Equivalent? | Notable divergence |
|--------|----------------|-------------------|-------------|--------------------|
| **insertLead** | id = `lead_<Date.now()>`; createdAt = app ISO; status "new"; writes full object to JSON; **never throws** | inserts raw `lead`; id = DB `gen_random_uuid()`; createdAt = DB `now()`; status DB default; **throws on error** | **NO** | **ID FORMAT differs** (`lead_<ms>` vs UUID). **Timestamp source differs** (app vs DB). **Error behavior differs** (local swallows→file; supabase throws→caller 500). **CONTRACT RISK:** inserts columns missing from committed schema (see 02) → would fail on real Supabase. **Concurrency:** local read-modify-write, **no lock** (race, lost update); supabase single atomic INSERT. |
| **getLeads** | reverse (newest first) + status filter + limit | `order createdAt desc` + eq status + limit | YES | equivalent ordering/semantics |
| **countLeads** | array length | `count exact head` | YES | — |
| **updateLeadStatus** | findIndex + rewrite file | `update {status} eq id` | YES | both no-op if id absent |
| **updateTabuStatus** | writes tabuStatus/tabuNotes/tabuOrderedAt to JSON | `update patch eq id` | Partial | **CONTRACT RISK:** tabu columns absent from committed schema → supabase update fails |
| **optOutByPhone** | normalizes **both** stored and input phone via `normalizePhone`; sets optOutAt + consentMarketing=false | matches input against 3 literal variants (`norm`, `972…`, `+972…`) **without normalizing the stored value**; same field updates | **NO** | **Supabase opt-out is weaker:** if a lead's stored `phone` has dashes/spaces or a non-canonical form, the `.or(phone.eq.…)` match **misses** → opt-out silently fails. Local normalizes the stored side and always matches. Privacy-law relevant. |
| **getStats** | distinct neighborhoodId over all deals | count exact + distinct neighborhoodId | YES | — |
| **listNeighborhoods** | filter by settlement (file order) | eq settlement **+ order by name** | Mostly | **ordering differs** (file order vs alphabetical) — cosmetic |
| **getDealsByNeighborhood** | filter; rooms range uses `(d.rooms ?? 0)` / `(d.rooms ?? 99)` so **null rooms can pass** min/max | SQL `gte/lte rooms` → **null rooms excluded** from range filters | **NO** | comparable selection differs when `rooms` is null (local includes, supabase excludes). Affects valuation inputs in supabase mode. |
| **getAllDeals** | returns **full** Deal objects | selects only **`id,neighborhoodId,x,y`** | **NO** | supabase returns **partial** deals. Safe only if callers use just those 4 fields (interface intends coordinate/neighborhood search). Any caller expecting price/area/rooms would break in supabase mode. |
| **dataAsOf** | max dealDate across deals | `order dealDate desc limit 1` | YES | — |

## Highest-impact parity divergences
1. **insertLead contract** — supabase inserts columns absent from committed schema (see 02): CONDITIONAL P0.
2. **optOutByPhone normalization** — supabase can silently miss opt-outs for non-canonical stored phones (privacy/compliance).
3. **getAllDeals partial select** — supabase returns 4 fields only; a latent break if any caller needs full deals.
4. **rooms-null range handling** — divergent comparable inclusion between stores.
5. **ID format** — `lead_<ms>` vs UUID; anything that pattern-matches lead ids must tolerate both.
6. **Concurrency** — LocalStore has no locking (pre-existing; Wave 1 candidate). On Vercel serverless the local FS is also non-persistent, reinforcing that production must be Supabase.

No changes made this wave.
