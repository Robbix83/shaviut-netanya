# Valuation backtest (VE-1)

Replays real Netanya sales as valuation searches through the real server path
(`resolveAndValuate` → `valuate`), on an in-memory copy of the V2 dataset, with no network.

```bash
npx tsx scripts/backtest/run.ts --label <name> --track pipeline --asof sale --split dev
npx tsx scripts/backtest/compare.ts <runA> <runB> [--identical]
npx tsx scripts/backtest/latency.ts --base http://localhost:3031   # against `npm run dev:preview`
```

## Run options

- **`--track`**
  - **`engine`:** the engine gets the sale's true neighborhood id. This is an oracle input.
  - **`pipeline`:** the engine gets what the browser sends, meaning the `data/street-index.json` id and street label. **Use `pipeline` for decisions.**
- **`--asof`**
  - **`sale`:** leakage-safe. The engine sees only deals dated before the sale, and its time windows count back from the sale date. **Default.**
  - **`today`:** the engine as production runs it, with only the sale itself hidden. Results drift with the calendar.
- **`--split`**
  - **Evaluation year:** the 12 months up to the last sale in the data.
  - **`dev`:** the first half. Tune on it.
  - **`test`:** the second half. Held out; look at it only to confirm a finished change.

## Sample

- **Size:** all eligible sales. Seed 20261027; the sample is deterministic and independent of file order.
- **Eligible means a seller could have typed it in:**
  - a full address,
  - a residential `dealNature`,
  - built area of at least 20 m² and a room count,
  - ₪/m² at or above the engine's floor.
- **Size by split:** 908 dev, 828 test.

## Output

Each run writes `runs/<label>/summary.md`. Per-row `results.json` files are git-ignored; rerun to regenerate them.

## Results, 2026-10-27 (V2 sha256 `1e7d066d…`, pipeline track, leakage-safe)

| Step | Split | Median APE | Bias | Within ±10% | Within ±20% | Price in range | Searches with full-table download |
|---|---|---|---|---|---|---|---|
| Before VE-1 (V1 ids sent to V2) | dev | 31.4% | −30.0% | 14% | 29% | 28% | 92% |
| + server resolves the neighborhood from the dataset (`b2`) | dev | 14.0% | −9.6% | 39% | 65% | 57% | 23% |
| + 70 missing streets searchable (`b3`) | dev | 13.8% | −9.6% | 39% | 65% | 57% | 24% |
| + time adjustment, trend capped at ±5%/yr, + range ±20% (`rc`) | dev | **10.9%** | **+0.1%** | 46% | 71% | 74% | 24% |
| + street query instead of full table (`rc2`, rows identical) | dev | 10.9% | +0.1% | 46% | 71% | 74% | **2%** |
| Same, held out (`rc2`) | **test** | 15.1% | −1.6% | 38% | 57% | 61% | 1% |

The test half is harder because a third of its sales are off-plan, so the target population is shown separately:

| Population | Split | n | Median APE | Bias | Within ±20% | Price in range |
|---|---|---|---|---|---|---|
| **Existing homes** | dev | 834 | **10.6%** | +1.4% | 74% | 77% |
| **Existing homes** | test | 563 | **10.5%** | +5.3% | 72% | 76% |
| Off-plan sales (built after the sale year) | dev | 74 | 39.4% | −39.4% | 35% | 38% |
| Off-plan sales | test | 265 | 32.9% | −31.1% | 27% | 29% |

### Off-plan manual review (`rc3-dev`, `rc3-test`, 2026-10-28)

A build year after the valuation year now returns manual review with no number, the same as land.

- **Off-plan:** all of them (74 dev, 265 test) go to manual review, so no off-plan search shows a number.
- **Existing homes:** numbers are unchanged, at 10.6% / +1.4% on dev and 10.5% / +5.3% on test.
- **Wizard:** the "בבנייה" option sends the year after the current one.

## Experiments kept and rejected (dev split, pipeline track)

| Experiment | Median APE | Bias | Mean APE | Decision |
|---|---|---|---|---|
| Baseline after the identity fix | 13.8% | −9.6% | 20.7% | — |
| 36-month window instead of 60 | 11.4% | −2.1% | 21.0% | Rejected. Tails get worse and full-table downloads rise to 36%. |
| 24-month window | 12.2% | −2.5% | 21.5% | Rejected |
| Trend adjustment, cap ±15%/yr | 13.3% | +7.5% | 23.3% | Rejected. Over-corrects, because new projects inflate the slope. |
| **Trend adjustment, cap ±5%/yr** | **10.9%** | **+0.1%** | **19.5%** | **Kept** |
| Trend + 36-month window | 11.8% | +0.3% | 22.1% | Rejected |
| Exclude off-plan comparables for existing homes | ≈ same | ≈ same | ≈ same | Rejected. No gain. |

## Latency, end to end against Supabase preview (V2)

25 real-payload searches on a dev server:

| | Median | p90 | Max |
|---|---|---|---|
| Before skipping the server geocode | 3.3 s | 9.6 s | 75 s |
| After skipping the server geocode | **0.84 s** | **1.0 s** | 2.6 s |

govmap refuses or ignores requests from this server; each attempt failed after 2–5.6 s. The browser already geocodes the full address, so the server now geocodes only when no coordinates arrive, with a 2.5 s timeout.

### Range cap ±25% for apartments (`rc4-dev`, `rc4-test`, 2026-10-28)

- **Before the cap:** 7–8% of apartment searches showed a range wider than ±25%, sometimes over ₪1M on a ₪2.4M flat. Those were also the least accurate searches, with a median error of 17%–60%.
- **The cap:** ranges are now cut at ±25% around the mid, and those searches are marked low confidence.
- **Cost:** coverage moved from 77.7% to 77.2% on dev and from 76.0% to 75.9% on test.
- **Check:** after the cap the widest apartment range is ±25.0%, and none is wider.

### Which deals are compared (`rand5000-pool`, 2026-10-30)

Three changes to the apartment pool, measured one at a time on the same 5,000 sales. Each changed a
few hundred valuations or fewer, so the gains are small and the settings were not tuned on them.

- The whole street stays in the pool when it crosses neighbourhoods (324 valuations changed).
- Sales from a developer are dropped for a resale apartment when at least 3 others remain: the deal
  is dated up to one year after the building's year, or before it (528 changed).
- Deals described as office, shop, storage or parking are dropped (62 changed, no measurable gain;
  kept because they are not apartments).

| | `rand5000-index` | `rand5000-pool` |
|---|---|---|
| MdAPE | 8.2% | 8.1% |
| bias | -1.7% | -1.5% |
| within ±10% | 56.8% | 57.5% |
| in range | 56.2% | 56.7% |
| in range, last 12 months | 54.5% | 54.7% |
| errors above 40% | 7.0% | 6.6% |

### Market index for the time adjustment (`rand5000-index`, 2026-10-30)

Apartments now use a monthly Netanya price index (`data/market-index.json`, 6-month median ₪/m²,
built by `scripts/build-market-index.ts`) instead of the neighbourhood trend capped at ±5% a year.
Each deal may move at most ±30%. The index only reads months before the valuation date. Houses keep
the old trend. Re-run the script after every data refresh.

Same 5,000 random sales (2021-07 to 2026-07), apartments, ±10% ceiling:

| | `rand5000-cap10` | `rand5000-index` |
|---|---|---|
| MdAPE | 9.5% | 8.2% |
| bias | -3.6% | -1.7% |
| within ±10% | 51.6% | 56.8% |
| in range | 50.8% | 56.2% |
| in range, last 12 months | 54.3% | 54.5% |
| median bias 2022 / 2026 | -9.5% / +5.9% | -6.6% / +2.2% |

The index settings were picked on these same sales, so the gain may shrink on new sales.

### Comparison approach for apartments (`rc7-dev`, `rc7-test`, 2026-10-30)

From the appraisal report (sections 7, 8, 15): each comparable is adjusted to the subject (size, floor),
weighted by recency, same building and size closeness, and the mid is a weighted median. The range comes
from how much the comparables agree, not from a fixed percentage. Duplicate deals count once. Hard limits
stay: ₪1M gap, and ±20% at the time of this table. The ceiling later moved to ±10%: on 5,000 random sales (`rand5000-cap10`, 2021-07 to 2026-07) 50.8% of apartment prices fall in range, 54.3% in the last year; median gap ₪434K. Parameters were tuned on dev only; test confirmed them.

| | rc6 dev | rc7 dev | rc6 test | rc7 test |
|---|---|---|---|---|
| MdAPE | 10.6% | 8.7% | 10.6% | 9.8% |
| bias | +1.5% | +1.4% | +5.3% | +5.6% |
| in range | 66% | 66% | 67% | 66% |

Apartments sold since 2024 (dev + test, n=1,348), median gap and in range: under ₪2M ₪510K, 70%;
₪2M–3M ₪743K, 70%; ₪3M–4M ₪909K, 64%; over ₪4M ₪1M, 49%. Overall median gap ₪754K (rc6: about ₪870K).
Not available to the engine: parking, condition, balcony and view, which limits accuracy further.

### Hard range ceiling for apartments (`rc6-dev`, `rc6-test`, 2026-10-30)

Decision by the agent: an apartment range is never wider than ±20% and never has a gap over ₪1M.
The ₪1M cap beats the percentage floors; the mid is unchanged. Scatter above ±25% still lowers
confidence, and low confidence plus a cut range shows "הערכה ראשונית" with a personal-check offer.

| | dev | test |
|---|---|---|
| MdAPE | 10.6% | 10.6% |
| bias | +1.5% | +5.3% |
| in range | 66% | 67% |

Apartments sold since 2024 (dev + test, n=1,348), in range: under ₪2M 69%, ₪2M–3M 74%, ₪3M–4M 63%,
over ₪4M 48%. No gap above ₪1M.

### Honest "same building" label + ±15% floor for same-building apartments (`rc5-dev`, `rc5-test`, 2026-10-30)

- **Label fix:** `building` scope now requires every comparable to carry the searched house number.
  - Before, the 60 m geo tier could tag a street segment as "the same building" when the browser sent only the street's point. For example, ויצמן 82 was labelled building from deals at 62–108.
  - The city-wide fallback (±12 numbers) is now labelled `street`.
  - On rand1000, 744 → 498 searches are labelled building, and the estimate is unchanged (MdAPE 10.6%).
- **Floor:**
  - **Same-building apartments:** the minimum range is ±15% (was ±20%), because a ~₪900K range looked unprofessional when the building's deals agree.
  - **Same-building coverage:** 73% dev / 72% test, down from 82% / 81%.
  - **Floors tried:** ±15%, ±12.5% and ±10%. ±15% was chosen by the user.
- **Overall:** MdAPE 10.6% dev / 10.6% test, price in range 70% / 70%.
