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
