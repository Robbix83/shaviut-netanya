# Graph Report - C:/leads  (2026-08-19)

## Corpus Check
- 92 files · ~55,201 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 653 nodes · 1075 edges · 43 communities (32 shown, 11 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 14 edges (avg confidence: 0.94)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Alert Matching & Local Store
- API Route Handlers
- Geo & Accessibility APIs
- Admin Leads Dashboard
- Valuation Wizard UI
- NPM Dependencies
- TypeScript Config
- Lead Capture & Notifications
- CBS Statistics Panel
- System Architecture Overview
- Dev Dependencies & Tools
- Mavat Building Permits Panel
- Main Harvest Pipeline
- Missing Data Recovery
- WhatsApp Notifications
- Local Seed Data Generator
- Street-Level Harvesting
- Plot Enrichment & Stats
- Admin Auth & Protected Routes
- Gov Data Fetcher
- App Shell & SEO
- Street Discovery
- Marketing Content & Branding
- OG Image Generator
- Street Autocomplete
- Neighborhood Discovery
- Renewal Data Fetcher
- Street Remapping
- Street Mapping API
- Raw Streets API
- Privacy Page
- Terms Page
- All Streets Fetcher
- Deal Remapping
- Address Test Suite
- Next.js Config
- PostCSS Config
- Discovery Pipeline Overview
- HTTP Methods

## God Nodes (most connected - your core abstractions)
1. `getStore()` - 31 edges
2. `Deal` - 22 edges
3. `scripts` - 18 edges
4. `LocalStore` - 16 edges
5. `Lead` - 16 edges
6. `compilerOptions` - 16 edges
7. `Store` - 15 edges
8. `SupabaseStore` - 15 edges
9. `Neighborhood` - 15 edges
10. `valuate()` - 15 edges

## Surprising Connections (you probably didn't know these)
- `GET()` --calls--> `getStore()`  [EXTRACTED]
  app/api/admin/leads/route.ts → lib/store.ts
- `Home()` --calls--> `getStore()`  [EXTRACTED]
  app/page.tsx → lib/store.ts
- `Props` --references--> `TabuStatus`  [EXTRACTED]
  components/TabuPanel.tsx → lib/types.ts
- `Dashboard()` --calls--> `getStore()`  [EXTRACTED]
  app/admin/(protected)/dashboard/page.tsx → lib/store.ts
- `PATCH()` --calls--> `getStore()`  [EXTRACTED]
  app/api/admin/leads/[id]/route.ts → lib/store.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Lead Capture Flow: API → Store → Notify** — readme_api_lead, readme_data_store, readme_notify [EXTRACTED 1.00]
- **Data Harvesting Pipeline: Playwright → nadlan.gov.il → Store** — readme_harvest_script, readme_playwright, readme_nadlan_gov, readme_data_store [EXTRACTED 1.00]
- **Valuation Flow: Address Autocomplete → Engine → Types** — readme_api_valuation, readme_valuation_engine, readme_types, readme_govmap_lib [INFERRED 0.85]

## Communities (43 total, 11 thin omitted)

### Community 0 - "Alert Matching & Local Store"
Cohesion: 0.07
Nodes (16): AlertMatch, buildAlertMessage(), matchAlerts(), DATA_DIR, DealsQuery, LocalStore, monthsAgoISO(), normalizePhone() (+8 more)

### Community 1 - "API Route Handlers"
Cohesion: 0.07
Nodes (48): PATCH(), runtime, VALID_STATUSES, VALID_TABU, GET(), runtime, GET(), runtime (+40 more)

### Community 2 - "Geo & Accessibility APIs"
Cohesion: 0.07
Nodes (40): GET(), loadPois(), neighborhoodCentroid(), runtime, localResolve(), POST(), runtime, streetIndexResolve() (+32 more)

### Community 3 - "Admin Leads Dashboard"
Cohesion: 0.07
Nodes (35): FMT_DATE(), LeadsTable(), NIS(), PanelTab, parseAddress(), PT_ICON, STATUS_OPTS, TIMING (+27 more)

### Community 4 - "Valuation Wizard UI"
Cohesion: 0.07
Nodes (30): Home(), AddressSearch(), ApiSuggestion, Props, StreetSuggestion, ScrollToWizard(), AGENT, Comparable (+22 more)

### Community 5 - "NPM Dependencies"
Cohesion: 0.06
Nodes (33): next, next-auth, dependencies, next, next-auth, react, react-dom, @supabase/supabase-js (+25 more)

### Community 6 - "TypeScript Config"
Cohesion: 0.07
Nodes (28): dom, dom.iterable, esnext, .next/dev/types/**/*.ts, next-env.d.ts, .next/types/**/*.ts, node_modules, scripts (+20 more)

### Community 7 - "Lead Capture & Notifications"
Cohesion: 0.14
Nodes (22): Body, POST(), runtime, POST(), runtime, sendInforu(), sendOTP(), sendTwilio() (+14 more)

### Community 8 - "CBS Statistics Panel"
Cohesion: 0.13
Nodes (21): GET(), runtime, AgeBar(), CbsPanel(), fmt(), fmtPct(), fmtWage(), Props (+13 more)

### Community 9 - "System Architecture Overview"
Cohesion: 0.10
Nodes (24): API Route: /api/autocomplete, API Route: /api/lead, API Route: /api/valuation, lib/store.ts — Storage Layer (local JSON / Supabase), scripts/google-apps-script.gs — Sheets Webhook, Google Sheets — Lead Log via Webhook, lib/govmap.ts — Address Autocomplete + Geocoding, govmap.gov.il — Address Completion Service (+16 more)

### Community 10 - "Dev Dependencies & Tools"
Cohesion: 0.09
Nodes (23): autoprefixer, devDependencies, autoprefixer, playwright, playwright-extra, postcss, puppeteer-extra-plugin-stealth, tailwindcss (+15 more)

### Community 11 - "Mavat Building Permits Panel"
Cohesion: 0.13
Nodes (17): GET(), runtime, MavatPanel(), Props, STATUS_CFG, _cache, cacheKey(), DemolitionEntity (+9 more)

### Community 12 - "Main Harvest Pipeline"
Cohesion: 0.19
Nodes (19): { chromium: chromiumExtra }, classify(), decodeDealData(), discoverNeighborhoods(), harvestByStreets(), harvestNeighborhood(), HEADERS, HEBREW_FLOOR (+11 more)

### Community 13 - "Missing Data Recovery"
Cohesion: 0.16
Nodes (19): appendToDeals(), { chromium: chromiumExtra }, classify(), DATA_DIR, DEALS_FILE, decodeDealData(), findMissingStreets(), harvestStreet() (+11 more)

### Community 14 - "WhatsApp Notifications"
Cohesion: 0.20
Nodes (17): confirmOptOut(), extractSender(), extractText(), POST(), runtime, agentLicense(), agentName(), appendToSheet() (+9 more)

### Community 15 - "Local Seed Data Generator"
Cohesion: 0.20
Nodes (16): APT_NATURES, between(), coordFor(), genDealsForNeighborhood(), HOUSE_NATURES, isoDate(), jitter(), LAND_NATURES (+8 more)

### Community 16 - "Street-Level Harvesting"
Cohesion: 0.20
Nodes (15): classify(), DATA_DIR, decodeDealData(), harvestStreet(), HEBREW_FLOOR, loadStreetCoords(), main(), normalize() (+7 more)

### Community 17 - "Plot Enrichment & Stats"
Cohesion: 0.20
Nodes (12): { chromium: chromiumExtra }, DATA_DIR, main(), queryPlotSqm(), sleep(), StealthPlugin, confidence(), CONFIDENCE_THRESHOLDS (+4 more)

### Community 18 - "Admin Auth & Protected Routes"
Cohesion: 0.15
Nodes (4): GET(), runtime, { handlers, auth, signIn, signOut }, config

### Community 19 - "Gov Data Fetcher"
Cohesion: 0.27
Nodes (11): classifyNature(), DATA_DIR, discoverFields(), fetchPage(), main(), NEIGH_ALIASES, normalize(), normNeigh() (+3 more)

### Community 20 - "App Shell & SEO"
Cohesion: 0.28
Nodes (5): jsonLd, metadata, viewport, Analytics(), WhatsAppButton()

### Community 21 - "Street Discovery"
Cohesion: 0.46
Nodes (7): extract(), HEADERS, main(), NEIGHBORHOODS, queryStreets(), sleep(), streetsFor()

### Community 22 - "Marketing Content & Branding"
Cohesion: 0.38
Nodes (7): Real Transactions Data Source, 19 Neighborhoods in Netanya Coverage, Result Within 30 Seconds, OG Image – Shaviut Netanya, Shaviut Netanya – Property Valuation Tool, Netanya Real Estate Market, Free Instant Apartment Valuation Based on Real Transactions

### Community 23 - "OG Image Generator"
Cohesion: 0.57
Nodes (6): hebrew_font(), latin_font(), lerp(), make(), rtl(), _try()

### Community 24 - "Street Autocomplete"
Cohesion: 0.47
Nodes (5): buildIndex(), GET(), IndexedStreet, runtime, streetMatches()

### Community 25 - "Neighborhood Discovery"
Cohesion: 0.53
Nodes (5): CANDIDATES, HEADERS, main(), resolve(), sleep()

### Community 26 - "Renewal Data Fetcher"
Cohesion: 0.60
Nodes (4): clean(), Complex, extractStreet(), main()

### Community 27 - "Street Remapping"
Cohesion: 0.50
Nodes (4): dist(), main(), Neigh, Street

## Knowledge Gaps
- **208 isolated node(s):** `PanelTab`, `STATUS_OPTS`, `PT_ICON`, `TIMING`, `PT_LABEL` (+203 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **11 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Deal` connect `Alert Matching & Local Store` to `API Route Handlers`, `Main Harvest Pipeline`, `Missing Data Recovery`, `Local Seed Data Generator`, `Street-Level Harvesting`, `Plot Enrichment & Stats`, `Gov Data Fetcher`?**
  _High betweenness centrality (0.053) - this node is a cross-community bridge._
- **Why does `getStore()` connect `API Route Handlers` to `Alert Matching & Local Store`, `Geo & Accessibility APIs`, `Admin Leads Dashboard`, `Valuation Wizard UI`, `Lead Capture & Notifications`, `Mavat Building Permits Panel`, `WhatsApp Notifications`, `Admin Auth & Protected Routes`?**
  _High betweenness centrality (0.048) - this node is a cross-community bridge._
- **Why does `Neighborhood` connect `Alert Matching & Local Store` to `API Route Handlers`, `Geo & Accessibility APIs`, `Main Harvest Pipeline`, `Missing Data Recovery`, `Local Seed Data Generator`, `Plot Enrichment & Stats`, `Gov Data Fetcher`?**
  _High betweenness centrality (0.029) - this node is a cross-community bridge._
- **What connects `PanelTab`, `STATUS_OPTS`, `PT_ICON` to the rest of the system?**
  _208 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Alert Matching & Local Store` be split into smaller, more focused modules?**
  _Cohesion score 0.06954997077732321 - nodes in this community are weakly interconnected._
- **Should `API Route Handlers` be split into smaller, more focused modules?**
  _Cohesion score 0.06715063520871144 - nodes in this community are weakly interconnected._
- **Should `Geo & Accessibility APIs` be split into smaller, more focused modules?**
  _Cohesion score 0.07446808510638298 - nodes in this community are weakly interconnected._