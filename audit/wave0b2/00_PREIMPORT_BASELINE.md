# 00 — PRE-IMPORT BASELINE (Wave 0B-2)

**Date:** 2026-08-20 · **Mode:** controlled data migration, verify-first, exact-parity, NO lead import, no deploy.

## Git
- HEAD: `753afa6fadd1df037d6415e7258b7146638ba805`
- status: clean at start (verified).

## Gate (before this wave)
- `npm test` → 58 passed. `tsc --noEmit` → clean. `next build` → exit 0. (Re-confirmed below.)

## Source file SHA-256 + sizes (authority for parity + immutability proof)
| File | SHA-256 | Bytes |
|------|---------|-------|
| data/neighborhoods.json | `366255233b70cd9da9b5b092fd8441b52a018fa3ddac57c36a1003f7ea493939` | 2,947 |
| data/deals.json | `18b3796e8f1c085a7099c22d59b67201ae30c9cb66f197c746e8090008e11a8f` | 6,906,271 |
| data/leads.json | `ba332e0179406c8037b4eba1cb08a6ea925b7225151c3dcf941b3dfc3c1c9649` | 20,086 |

> `data/leads.json` is hashed only to **prove it is never touched or imported**; its contents are not read or logged.

## Source record counts (computed from files — authoritative)
| Metric | Value | Historical baseline | Match |
|--------|-------|---------------------|-------|
| neighborhoods | **21** | 21 | ✅ |
| deals | **12,642** | 12,642 | ✅ |
| duplicate Deal IDs | **0** | 0 | ✅ |
| duplicate neighborhood IDs | **0** | — | ✅ |
| orphan deals (neighborhoodId ∉ neighborhoods) | **0** | 0 | ✅ |
| neighborhoods with 0 deals | **0** | 0 | ✅ |

## Property-type counts
| type | count | baseline | match |
|------|-------|----------|-------|
| apartment | **11,951** | 11,951 | ✅ |
| house | **391** | 391 | ✅ |
| land | **300** | 300 | ✅ |

## dealDate range
- min: **1998-02-06** · max: **2026-06-08** (matches historical "latest 2026-06-08").

## Null counts for key Deal fields (as-is — NOT to be fixed)
| field | null count |
|-------|-----------|
| rooms | 300 |
| areaSqm | 494 |
| plotSqm | 12,367 |
| floor | 3,829 |
| yearBuilt | **0** (no nulls) |
| houseNumber | 2,608 |
| x | 0 |
| y | 0 |

Sentinel values present (kept as-is per instruction — **not** cleaned): `yearBuilt === 0` in **3,468** deals; `rooms === 0` in **579** deals. Outliers/near-duplicates are preserved. This wave is storage migration, not data-quality remediation.

## Object shape (confirms exact projection, no extra/missing fields)
- Deal object keys (19, = deals table columns): `address, areaSqm, dealDate, dealNature, floor, houseNumber, id, neighborhood, neighborhoodId, plotSqm, price, pricePerSqm, propertyType, rooms, settlement, street, x, y, yearBuilt`.
- Neighborhood object keys (5, = neighborhoods table columns): `id, name, settlement, x, y`.

## Credential availability (checked; PRESENCE only — never values)
- `process.env.NEXT_PUBLIC_SUPABASE_URL`: **absent**
- `process.env.SUPABASE_SERVICE_ROLE_KEY`: **absent**
- `.env.local`: no `SUPABASE*` keys
→ The real import cannot run until the operator provides these (see WAVE0B2_REPORT for exact instructions). Tool + tests are built and gated regardless.
