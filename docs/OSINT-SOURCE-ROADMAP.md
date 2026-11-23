# OSINT Source Expansion Roadmap

**Status:** reconciled implementation roadmap; runtime adapter status is recorded in the backlog and candidate registry below.
**Research date:** 2026-11-17  
**Target:** Gods-eye-view (GEV), globe-first public-source OSINT and anomaly context.

## 1. Scope and operating principles

Expand GEV with reproducible, public, source-attributed context for geopolitical events, military-related public activity, maritime and aviation patterns, environmental anomalies, GNSS integrity, and satellite-observed change.

This is an analytical and documentary system, not a tactical command-and-control tool. New work should prioritize historical, delayed, regional, and aggregated signals. Do not add person tracking, private-data collection, targeting workflows, weapon guidance, or features that expose sensitive real-time locations or routes of individual military units. A source observation is not proof of an operation.

Every source adapter must:
- be read-only by default and use documented public APIs or permitted downloads;
- keep credentials server-side, never in browser bundles, source files, fixtures, screenshots, logs, or commits;
- preserve raw response metadata separately from normalized records;
- record source ID, retrieval time, event time, request parameters, source URL, licence/terms, and freshness;
- use bounded requests, response-size limits, timeouts, pagination, caching, retry/backoff, and provider rate limits;
- preserve null/unknown values; never convert missing data into a negative observation;
- show source health, staleness, coverage gaps, and attribution in the UI;
- distinguish observation, source assertion, analyst inference, and conclusion.

## 2. Existing capabilities found upstream

The current upstream source register already documents substantial coverage. Avoid duplicating these integrations:
- OpenSky Network and adsb.lol for public ADS-B flight context and GNSS integrity indicators;
- AISStream for live AIS vessel observations;
- CelesTrak for satellite catalog/TLE data;
- NASA GIBS and CMR/HLS for imagery discovery and visualization;
- NASA FIRMS for active-fire detections;
- GDELT for event/news context;
- USGS for earthquakes;
- GDACS for disaster alerts;
- NOAA weather products, OpenStreetMap, IMF PortWatch, and the existing conflict/news layer;
- the existing military-aircraft layer and GNSS layer.

Existing code seams worth reusing:
- `src/layers/airQuality/source.js`: ECCC AQHI plus the additive OpenAQ PM2.5 provider; OpenAQ is not a replacement for ECCC.
- `src/layers/gnss/source.js`: currently obtains aircraft-reported GNSS integrity through the same-origin proxy; add space-weather context independently.
- `src/layers/military/`: existing public aircraft layer; do not create a second military-flight poller.
- `src/layers/news/`: existing news/event ingestion; use it for source-backed conflict context rather than inventing a parallel headline feed.
- `src/data/analystEngine.js`: pure query engine over data already held by layers; extend through its existing manifest/record seam rather than adding hidden network calls.

## 3. Recommended additional sources

| Priority | Source | Access / cost | Useful signal | Important limitation |
| --- | --- | --- | --- | --- |
| P0 | NOAA SWPC JSON | Public, keyless | Solar flares, geomagnetic activity, Kp and alerts; correlate with GNSS quality anomalies | Space-weather context only; never proof of jamming or military action |
| P0 | UCDP GED | Free downloadable datasets, CC BY 4.0; API token requested from maintainer, 5,000 requests/day | Georeferenced organized-violence events and historical baselines | Event coding, publication lag, and dataset definitions matter; cite codebook and version |
| P1 | Copernicus Data Space STAC / OData | Free registered account with published quotas | Sentinel-1 SAR and Sentinel-2 imagery for retrospective change detection and corroboration | Large data volumes; cloud, revisit, processing and licensing constraints; not a live feed |
| P1 | OpenAQ API v3 | Free API key; 60 requests/minute and 2,000/hour | Air-quality observations as environmental context around reported events | Sensor coverage and provider-specific data licences vary; pollution is not attribution |
| P1 | Global Fishing Watch | Free API key; non-commercial CC BY-NC 4.0; 50,000 requests/day and 1,500,000/month | Aggregated fishing activity, vessel encounters and possible AIS-dark activity as maritime context | Non-commercial only; fishing coverage is not comprehensive maritime or military coverage |
| P2 | ACLED | myACLED account and OAuth-based API access | Event-level political violence and demonstrations for cross-checking | Confirm current eligibility, redistribution and commercial terms before implementation |
| P2 | ReliefWeb API | Approved appname required | Humanitarian reports, disaster and conflict situation reporting | Appname approval and publisher rights; contextual reporting, not a sensor feed |
| P2 | Official defence / alliance / UN publications | Public RSS/pages where available | Primary-source announcements, exercises, deployments and official statements | Publisher-controlled formats; source assertions must not be treated as independently verified facts |

### Primary documentation

- NOAA SWPC data directory: https://services.swpc.noaa.gov/products/
- UCDP downloads and licensing: https://ucdp.uu.se/downloads/
- UCDP API documentation: https://ucdp.uu.se/apidocs/
- Copernicus STAC documentation: https://documentation.dataspace.copernicus.eu/APIs/STAC.html
- Copernicus quotas: https://documentation.dataspace.copernicus.eu/Quotas.html
- OpenAQ API key: https://docs.openaq.org/using-the-api/api-key
- OpenAQ rate limits: https://docs.openaq.org/using-the-api/rate-limits
- Global Fishing Watch API: https://api-doc.globalfishingwatch.org/
- Global Fishing Watch terms and limits: https://globalfishingwatch.org/our-apis/documentation/docs/license-rate-limits
- ACLED API access: https://acleddata.com/api-documentation/getting-started
- ReliefWeb API: https://apidoc.reliefweb.int/

## 4. Proposed integration sequence

### Phase A — source health and provenance (no new map layer)
1. Add a provider registry with stable IDs, endpoint families, auth mode, licence, attribution, polling class, cache TTL, and data sensitivity.
2. Add a source-health view: last success, last failure, response age, quota/backoff state, and coverage caveat.
3. Add a common provenance envelope to all new normalized records.
4. Add synthetic fixtures and schema/contract tests before enabling network calls.

### Phase B — low-cost contextual feeds
1. NOAA SWPC is implemented as a GNSS context provider, separate from aircraft-reported integrity facts.
2. OpenAQ is implemented as a second air-quality provider behind the existing air-quality source interface.
3. UCDP GED has a bounded, version-pinned API adapter; complete the reproducible downloadable snapshot importer with checksums and codebook metadata before treating it as a durable historical archive.

### Phase C — imagery and maritime context
1. Add Copernicus STAC discovery first; do not automatically download full scenes. Record product IDs, acquisition time, platform, orbit direction, polarisation, cloud cover where applicable, footprint and asset links.
2. Build a user-requested, retrospective image-comparison workflow with baseline/after dates, change masks and explicit uncertainty. Do not create a real-time facility-monitoring or tactical targeting workflow.
3. Evaluate Global Fishing Watch only for non-commercial, aggregated maritime context after terms review and API key setup.

### Phase D — corroboration and analyst workflow
1. Correlate event records across independent source families (news/event data, official statements, satellite observations, environment, and public movement aggregates).
2. Track source lineage so syndicated stories and derivative datasets are not counted as independent corroboration.
3. Maintain a claim ledger with supporting and contradictory evidence, source locators, confidence, caveats and status.
4. Keep analyst conclusions separate from raw detections and provider classifications.

## 5. Anomaly model

Use named anomaly classes, not a single opaque "military activity score":

- `ENVIRONMENTAL_ANOMALY`: unusual fire, air-quality, seismic, or weather observation relative to local baseline.
- `GNSS_QUALITY_ANOMALY`: unusual aircraft-reported integrity or positioning-quality indicators.
- `SPACE_WEATHER_CONTEXT`: geomagnetic/solar conditions that may explain GNSS degradation; context, not causal attribution.
- `MARITIME_PATTERN_ANOMALY`: aggregate changes in public vessel/fishing activity or data availability.
- `AVIATION_ACTIVITY_ANOMALY`: regional aggregate changes in public aviation observations, with explicit coverage and classification uncertainty.
- `CONFLICT_EVENT_REPORT`: source-reported event from UCDP, GDELT, ACLED or an official publication.
- `SATELLITE_CHANGE_CANDIDATE`: retrospective image difference requiring human review and independent corroboration.

Each anomaly should include:
`anomaly_id`, `class`, `observed_at`, `event_time_start`, `event_time_end`, `geometry`, `spatial_resolution`, `source_ids`, `evidence_ids`, `baseline_window`, `observed_value`, `expected_range`, `confidence`, `alternative_explanations`, `freshness`, and `review_status`.

Confidence must not be computed by simply counting sources. Score source independence, provenance, temporal alignment, spatial precision, known coverage, and contradictory evidence. Missing observations must remain "unknown", never "normal".

## 6. Credential and privacy handling

The credentials previously pasted into a chat should be treated as exposed and rotated at the provider. Do not copy them into this repository.

Suggested server-side secret names after rotation:
- `FIRMS_MAP_KEY`
- `OPENAQ_API_KEY`
- `NASA_EARTHDATA_TOKEN` (short-lived token only; prefer the provider-supported authentication flow)
- `UCDP_API_TOKEN`
- `GFW_API_TOKEN`
- Copernicus OAuth client credentials stored only in the deployment secret manager.

Only placeholder names belong in `.env.example`. Never put actual values in GitHub Actions, client-side `VITE_*` variables, test fixtures, or logs. Use least privilege, rotation, bounded access and redaction.

## 7. Acceptance tests

Before a provider is enabled:
- schema validation rejects malformed, oversized, duplicate and out-of-range records;
- tests cover empty, partial, stale, delayed, rate-limited and unavailable responses;
- time fields distinguish provider event time, publication time and retrieval time;
- geographic coordinates, units, datum and timezone are normalized explicitly;
- attribution and source terms are present in the source register and UI;
- credentials are not present in browser bundles, fixtures, logs or Git history;
- raw inputs are preserved immutably with retrieval metadata and hashes;
- synthetic tests demonstrate that one source failure cannot blank unrelated layers;
- correlation tests include contradictory evidence and alternative explanations;
- Android/Termux remains able to run the unit tests and build without requiring paid services.

## 8. Decision

NOAA SWPC and OpenAQ are implemented runtime integrations, and UCDP has a bounded version-pinned API adapter. They add distinct explanatory value while fitting existing GEV layer seams. Treat Copernicus STAC as the next runtime integration: metadata-only discovery first, gated by account setup, OAuth handling, quota, collection terms, and synthetic contract tests. Treat Global Fishing Watch as a later research integration gated by organisational eligibility and non-commercial terms. ACLED and ReliefWeb remain optional until access and reuse terms are confirmed.

This roadmap distinguishes implemented runtime adapters from research candidates. It does not claim that credentials have been rotated or that live upstream acceptance testing is a permanent guarantee; deterministic fixtures and local validation remain the release gate.

### Reconciliation note — 2026-11-23

This roadmap was reconciled after the OpenAQ implementation was validated and published to `MSA-83/gods-eye-view`. NOAA SWPC and OpenAQ are now marked as implemented runtime adapters; UCDP is marked partial because its bounded API proxy exists but its reproducible checksummed snapshot importer remains outstanding. Copernicus Data Space STAC metadata discovery is therefore the next P1 runtime milestone. The candidate registry uses the same status distinctions and does not imply that unimplemented candidates are connected.


## 9. Upstream synchronization review (2026-11-17)

The previous source-roadmap pull request was merged into `main`. A fresh comparison against upstream confirms that the fork contains the upstream snapshot at `624c229bc2a86fc1e47ed34c95fc7cefa2ac1676`; the fork's current main is a descendant of that snapshot. The three-commit comparison result is the fork's merge/roadmap history, not three missing upstream commits. Do not re-import the same upstream history.

The upstream snapshot includes these changes relevant to GEV:
- **Lifecycle cleanup:** launch and satellite layers unregister their world-clock sources on destroy and register on init. Keep the regression test pattern used by the earthquakes layer.
- **Renderer basemap contract:** basemap changes are routed through the globe/renderer port. New map providers should use that contract rather than calling Cesium directly.
- **Flight and vessel context previews:** entity cards can use renderer-owned previews. Keep rendering resources scoped to card visibility and dispose auxiliary contexts when cards close.
- **Voice action override:** application-provided `voice.openStories({ isCurrent })` takes precedence over the default Stories page behavior.

The upstream PR descriptions report successful tests/builds for the relevant changes, but this audit did not execute those tests locally. The fork's merged sync PR #1 was a very large update; a passing GitHub mergeability result is not a substitute for local validation. Run the repository's documented test, format, boundary, library, build, stub-renderer and conformance gates before a production release.

## 10. New source candidates and source-contract cautions

### Additional candidates

- **Global Energy Monitor (GEM):** open-access downloadable datasets describing energy infrastructure and resources. Useful as a static strategic-infrastructure baseline and for retrospective context. This is not a live activity feed. Review the licence and attribution attached to each specific dataset before bundling or redistributing it: https://globalenergymonitor.org/download-data/
- **OpenSanctions:** useful for carefully sourced entity-resolution and sanctions-context lookups, not for identifying military operations. Hosted API access requires an API key; public-interest work may qualify for a free key, while commercial API use is metered/paid. Treat this as access-gated, not a generally unlimited free API. Never auto-screen incidental people from live map observations; use only deliberate analyst-initiated entity research with false-match warnings: https://www.opensanctions.org/docs/api/ and https://www.opensanctions.org/docs/api/authentication/

### NOAA SWPC contract and implementation notes

NOAA's SWPC data service exposes products, JSON, text and archive endpoints. Its 2026 service-change notice announced JSON format changes for several products, including planetary K-index and solar-wind magnetic-field summaries. For the implemented adapter, retain these contract controls during future maintenance:
1. Pin the exact product endpoint(s) and document their current schema.
2. Preserve source timestamps and distinguish observed values from forecasts/alerts.
3. Add fixtures for both valid and malformed/changed payloads.
4. Reject unknown schema shapes rather than silently interpreting them.
5. Keep space-weather conditions as a contextual covariate, never as proof of GNSS interference or intentional action.

Official documentation: https://www.spaceweather.gov/content/data-access and https://www.weather.gov/media/notification/pdf_2026/scn26-21_Data_Format_Changes_Impacting_SWPC_Products.pdf

## 11. Implementation backlog and acceptance gates

The following backlog records both completed runtime integrations and remaining implementation tasks:

| ID | Work | Priority | Acceptance gate |
| --- | --- | --- | --- |
| GEV-OSINT-01 | Add provider-neutral provenance envelope and source-health status contract | P0 | **Implemented foundation:** `server/providers/common/osintEvidence.js` validates provenance envelopes and classifies freshness/availability; adopted by SWPC and UCDP adapters. UI-wide adoption remains pending |
| GEV-OSINT-02 | Add NOAA SWPC context provider through server-side proxy | P0 | **Implemented:** `server/providers/space/swpc.js`, registered in `server/providers/local.js`; read-only `/api/space-weather`, bounded JSON, schema validation, cache/stale fallback, provenance and health; fixture tests cover current and legacy product shapes |
| GEV-OSINT-03 | Add OpenAQ as an additive provider to the existing air-quality source | P1 | **Implemented:** `server/providers/openaq.js` and `src/layers/airQuality/openaq.js`; ECCC remains independent; key stays server-side; bounded discovery, response caps, rate limiting, cache/stale fallback, attribution, explicit PM2.5 scale, and middleware/normalization tests are present |
| GEV-OSINT-04 | Import versioned UCDP GED snapshots with checksums and codebook metadata | P1 | **Partially implemented:** version-pinned GED 26.1 API proxy at `/api/conflict-events/ucdp`, token server-side, 31-day windows, page cap, cache/stale fallback, daily request budget, provenance and health. Reproducible snapshot importer, checksums and codebook bundle remain pending |
| GEV-OSINT-05 | Add Copernicus STAC metadata discovery | P1 | OAuth kept server-side; bounded paging; metadata-only default; no automatic full-scene downloads |
| GEV-OSINT-06 | Evaluate GEM static infrastructure packs | P2 | Dataset-by-dataset licence review; version, download date, checksum and attribution |
| GEV-OSINT-07 | Evaluate OpenSanctions deliberate lookup workflow | P2 | Confirm public-interest eligibility and API terms; explicit user action; entity match score and false-positive caveat |
| GEV-OSINT-08 | Evaluate Global Fishing Watch aggregated historical maritime context | P2 | Non-commercial terms gate; no individual-vessel operational tracking or tactical use |

The provenance/source-health foundation is implemented and adopted by the NOAA SWPC, UCDP, and OpenAQ adapters. NOAA SWPC is a read-only contextual feed, not an attribution engine. UCDP is currently a version-pinned API proxy, not yet a reproducible local snapshot importer. OpenAQ is an additive, fault-isolated air-quality provider with server-only credentials. The next runtime milestone is Copernicus STAC metadata discovery; separately, complete the UCDP snapshot importer with checksums and codebook/version metadata. Reuse existing layer and server-provider seams, keep secrets server-side, and add synthetic tests before enabling any additional provider.


## 12. Further public-source audit (2026-11-17)

This follow-up adds two public Copernicus services discovered during a fresh source review. They complement Sentinel discovery and existing FIRMS/GDACS layers without duplicating those feeds.

### Copernicus Emergency Management Service (CEMS) Mapping API

- **Access:** Public activation metadata and non-restricted products are freely viewable/downloadable. The mapping API exposes activation metadata, AOIs, product links and GIS service endpoints.
- **Useful data:** Event footprints, delineation/grading products, post-event damage assessments and retrospective reference products.
- **Integration:** Add metadata discovery first; cache activation pages, preserve activation code and product version, and link to the official product rather than bulk-mirroring large rasters. Use only public/non-restricted activations.
- **Caveat:** CEMS is an emergency mapping service, not a military activity feed. It can provide independent geospatial context for reported industrial accidents, wildfires, storms, floods and humanitarian emergencies. Some activations are sensitive/restricted.
- **Official docs:** https://mapping.emergency.copernicus.eu/about/how-to-harvest-cems-mapping-data/ and https://documentation.dataspace.copernicus.eu/Data/CEMS.html

### EUMETSAT Data Store / EUMETView

- **Access:** Account registration and product-specific licensing may apply. The Data Store supports API-based discovery and downloads; EUMETView exposes imagery and OGC services.
- **Useful data:** Meteosat and Metop imagery and products for cloud, atmospheric, ocean and environmental context; near-real-time and historical modes.
- **Integration:** Treat as a metadata/catalog provider first. Record platform, instrument, product collection, sensing time, processing level, footprint and licence. Avoid downloading large scenes automatically.
- **Caveat:** Smartphone access to the Data Store UI is not natively supported; API/CLI access may still be practical from a server. Product availability and latency differ by collection.
- **Official docs:** https://user.eumetsat.int/data-access and https://user.eumetsat.int/resources/user-guides/frequently-asked-questions-for-data-store

### Source-contract corrections

- Global Fishing Watch registration is not an unrestricted anonymous free tier. Its terms require a qualifying organisation application and non-commercial use; request limits are shared across tokens at 50,000/day and 1,500,000/month. Do not enable it until organisational eligibility and the project's non-commercial status are confirmed.
- NOAA SWPC changed multiple JSON product schemas effective 31 March 2026 and deprecated several RTSW products from 30 April 2026. Adapter fixtures must use the post-change formats; do not implement against old key/value-array samples or deprecated endpoints. See https://www.weather.gov/media/notification/pdf_2026/scn26-21_Data_Format_Changes_Impacting_SWPC_Products.pdf.
- UCDP currently publishes GED 26.1 downloads under CC BY 4.0 with codebooks and version history. Use the download release as the initial reproducible path; confirm API version and access requirements independently. See https://ucdp.uu.se/downloads/ and https://ucdp.uu.se/apidocs/.
- OpenAQ's published general-use limit is 60 requests/minute and 2,000/hour; key is supplied in the `X-API-Key` header. Never place it in a browser request. See https://docs.openaq.org/using-the-api/rate-limits and https://docs.openaq.org/using-the-api/api-key.

CEMS and EUMETSAT remain research candidates with no runtime adapter enabled. NOAA SWPC, UCDP, and OpenAQ runtime adapters are implemented in the repository as described in the reconciled backlog above; UCDP's durable snapshot importer remains pending. OpenAQ's runtime path is server-proxied and does not imply that its upstream key or provider terms are universally available. This documentation does not claim that the CEMS or EUMETSAT sources are connected or that any candidate has passed permanent live-provider acceptance testing.


## 13. Military expenditure and arms-transfer datasets (2026-11-17)

A further official-source review identified three useful strategic-context datasets. These are annual, country-level or multi-year series; none is a live military activity feed.

### SIPRI Military Expenditure Database

- **Coverage:** Annual national military-expenditure time series from 1949 through 2025, with values in local currency, current/constant US dollars, GDP share and per-capita measures. The 2026 workbook revision was published 27 April 2026.
- **Access:** Public downloadable Excel workbook. The World Bank Indicators API exposes the SIPRI-derived indicator `MS.MIL.XPND.GD.ZS` (military expenditure as a share of GDP) through a keyless API v2.
- **Terms:** SIPRI permits fair-use statistical/analytical use with attribution; reproduction beyond fair-use and commercial use require permission/licensing. A World Bank API endpoint does not erase the underlying SIPRI source terms.
- **Integration:** Prefer annual snapshots and the World Bank API for selected indicators; preserve source year, release/revision date, retrieval time, country code, units and missing-value semantics.
- **Caveat:** Expenditure is an input measure, not a direct measure of military capability, readiness, force posture or operational activity. The World Bank series is derived from SIPRI and must not be counted as independent corroboration.
- **Official sources:** https://www.sipri.org/databases/milex ; https://www.sipri.org/about/terms-and-conditions ; https://api.worldbank.org/v2/country/all/indicator/MS.MIL.XPND.GD.ZS?format=json ; https://datahelpdesk.worldbank.org/knowledgebase/articles/889392

### SIPRI Arms Transfers Database

- **Coverage:** Publicly accessible records of international transfers of major conventional arms from 1950 through the most recent full calendar year; the 9 March 2026 update covers 1950-2025.
- **Access:** Web database with CSV export; annual updates.
- **Terms:** Non-commercial use and SIPRI fair-use restrictions apply unless a separate licence is obtained.
- **Integration:** Use aggregated country/year and five-year trend series. Preserve database version, query parameters and export date.
- **Caveat:** SIPRI's Trend-Indicator Value (TIV) estimates the volume of major-arms transfers; it is not a monetary transaction value, market price or proof of delivery timing beyond the source's own coding. Treat uncertain estimates and incomplete public reporting explicitly.
- **Official sources:** https://www.sipri.org/databases/armstransfers ; https://www.sipri.org/databases/armstransfers/sources-and-methods ; https://www.sipri.org/databases/financial-value-global-arms-trade

### NATO Defence Expenditure Reports

- **Coverage:** Annual expenditure series and breakdowns for NATO Allies, published as PDF and spreadsheet tables.
- **Access:** Public reports and downloadable tables; no stable public API was verified.
- **Integration:** Parse only versioned annual tables, preserve NATO's definition, cut-off date, estimated/actual status and source workbook.
- **Caveat:** NATO and SIPRI use different definitions and collection methods. The 2014-2025 report uses a 3 June 2025 information cut-off and identifies 2024/2025 figures as estimates. Do not silently splice the series or label estimates as actuals.
- **Official source:** https://www.nato.int/en/news-and-events/articles/news/2025/08/28/defence-expenditure-of-nato-countries-2014-2025

### Comparability and source-independence rule

SIPRI, the World Bank's SIPRI-derived indicator, and NATO expenditure tables are not three independent confirmations of a single event. Keep them as separate source records, preserve their lineage and definitions, and use them for slow-moving strategic baselines rather than event attribution.



## 14. UN arms-transparency and trade-statistics sources (2026-11-17)

### United Nations Register of Conventional Arms (UNROCA)

- **Coverage:** Annual government-reported international transfers across seven categories of major conventional arms, with an optional additional small-arms/light-weapons category and invited background information on holdings, national production and policies.
- **Access:** Public state submissions and UN Secretary-General reports via UNROCA and the UN Digital Library. No stable public API was verified in this review.
- **Reporting caveat:** Participation and completeness vary. A nil return may cover up to three years under UN rules; a missing submission is not evidence that no transfer occurred. State reporting may distinguish actual transfers from authorizations. Preserve that distinction.
- **Integration:** Ingest versioned report/document metadata and tabular data only after validating the reporting year, state, category, nil-return status, and whether values represent actual transfers or authorizations.
- **Official sources:** https://www.unroca.org/ ; https://digitallibrary.un.org/record/4124068 ; https://mandates.un.org/mandate/A/RES/80/28

### UN Comtrade HS Chapter 93

- **Coverage:** Reported international merchandise trade statistics, including HS Chapter 93 (arms and ammunition; parts and accessories). This is a customs classification, not a complete military-equipment taxonomy.
- **Access:** Public keyless preview API; official API documentation advertises up to 500 preview records. The free registered tier currently advertises up to 500 API calls/day, 1 call/second and 100,000 records per call; confirm limits before enabling an adapter.
- **Terms and credentials:** Follow UN Comtrade fair-use policy. A registered API key belongs in server-side secret storage only, never in browser code, fixtures or URLs committed to Git.
- **Integration:** Use annual country/partner aggregates for historical trade context; preserve reporter, partner, flow, HS revision, period, publication/release date, units and API query. Prefer the keyless preview for contract tests.
- **Caveat:** Customs reporting can be delayed, revised, asymmetric or incomplete. HS93 does not cover every defence-related product and is not proof of actual delivery, deployment or operational intent.
- **Official sources:** https://comtradeplus.un.org/en/api-docs ; https://comtradeplus.un.org/en/subscriptions ; https://uncomtrade.org/docs/policy-on-comtrade-data-use/

### Source-independence and triangulation

UNROCA, UN Comtrade and SIPRI are different datasets with different reporting methods and scopes. They may overlap in underlying government declarations or trade records. Do not count them as independent corroboration without tracing source lineage. Keep UNROCA state-reported transfers, customs trade statistics and SIPRI's research-coded arms-transfer series separate.



## 11. SIPRI workbook audit and integration boundary (2026-11-17)

A user-supplied copy of `SIPRI-Milex-data-1949-2025_v1.2.xlsx` was inspected as a source artifact. Its worksheets provide country-level military-expenditure series for 1949–2025, with the following measurement families:

- Local currency, financial years and calendar years, at current prices.
- Constant 2024 US dollars and current US dollars.
- Military expenditure as a share of GDP.
- Per-capita expenditure (1988–2025).
- Military expenditure as a share of government spending (1988–2025).
- Regional totals and a separate footnotes sheet.

The workbook itself states that blue figures are SIPRI estimates and red figures indicate high uncertainty. Regional totals can also contain estimates for missing country data; unavailable values and non-existent/non-independent country-years use distinct markers. Preserve those distinctions. Do not coerce `...`, `xxx`, blanks, or footnote codes into zero.

The workbook's footnotes are analytically material, not decorative spreadsheet clutter. They describe changes in scope, missing years, off-budget expenditure, pensions, paramilitary inclusion, budget versus actual spending, exchange-rate distortions, and country-specific methodology. Preserve footnote references with each extracted record and expose the relevant caveat in any comparison.

**Important interpretation boundary:** SIPRI defines military expenditure as an input/resource measure, not a direct measure of military capability, readiness, deployment, intent or operational activity. Its series are revised as new sources become available. Recent-year values can be budget/adopted/revised estimates; country coverage and definitions differ. The workbook must therefore be presented as annual strategic context, never as a live military-activity layer or a direct anomaly detector.

**Workbook revision and provenance:** the inspected file identifies itself as the SIPRI 2026 Military Expenditure Database, version `v1.2`, with data through 2025. SIPRI's database page states that the file was revised on 27 April 2026 and supersedes earlier versions. Pin the workbook version, retrieval date, SHA-256 and original filename for every future ingestion run. Do not assume a later workbook has the same columns or footnote numbering.

**Licence gate:** SIPRI states that commercial use requires authorization/licensing. The fair-use limit and conditions must be checked against SIPRI's current Terms and Conditions before extracting, caching, displaying, or redistributing data. A public download does not mean unrestricted redistribution. Do not commit the user-supplied workbook or a bulk derivative dataset to this repository. Prefer source links and a user-controlled, local import workflow until the applicable use rights are confirmed.

### Proposed normalized record

```json
{
  "sourceId": "sipri-milex",
  "datasetVersion": "2026-v1.2",
  "countryOrRegion": "ISO-3166-1 alpha-3 where applicable",
  "year": 2025,
  "periodBasis": "calendar-year | financial-year",
  "measure": "constant-2024-usd-million | current-usd-million | local-currency | gdp-share | government-spending-share | per-capita-current-usd",
  "value": 0,
  "currency": null,
  "estimateFlag": "sipri-estimate | high-uncertainty | reported | unknown",
  "footnoteRefs": [],
  "sourceWorksheet": "Constant (2024) US$",
  "retrievedAt": "ISO-8601 UTC",
  "rawSha256": "64 lowercase hexadecimal characters"
}
```

This is a proposed schema, not an implemented adapter. Preserve the original displayed cell value and marker separately from the normalized numeric value. Store `...`, `xxx`, blank and missing as distinct states; retain worksheet name, original row/column, unit, period basis and footnote reference. Do not infer ISO codes for disputed or historical entities without a versioned country crosswalk.

### Validation and release gates

1. Verify workbook SHA-256, filename, workbook revision and worksheet names before parsing.
2. Reject unknown worksheet layouts, unexpected year ranges, duplicate country-year-measure keys and invalid numeric values.
3. Preserve estimate/high-uncertainty styling and footnote markers; tests must cover each marker and footnote mapping.
4. Validate year basis, units and constant-dollar base year before comparisons.
5. Do not merge SIPRI, NATO, EDA or World Bank-delivered SIPRI-derived series into one unlabelled field.
6. Run an independent spot-check against the official SIPRI page and source notes; record discrepancies instead of silently overwriting.
7. Keep workbook ingestion offline and user-controlled until licence, retention and redistribution requirements are approved.

## 12. Additional strategic context sources

### European Defence Agency Defence Data

EDA publishes annual defence data collected and compiled since 2006 (some indicators from 2005), including expenditure, investment and selected defence-capability/force indicators. This adds an EU-specific institutional series that can help compare European defence trends, but it overlaps with SIPRI and NATO and uses its own definitions. Keep all three source series separate, label year/forecast/estimate status, and document scope and units. Official portal: https://www.eda.europa.eu/publications-and-data/defence-data

### SIPRI National Budget Archive

The archive provides discovery access to national primary-source documents used in SIPRI expenditure estimates, including budget documents, white papers and official publications. Use it to trace a figure back to the originating document where available. The archive is a discovery index; the original publisher remains the source of the document. It is not independent corroboration of SIPRI where SIPRI already used the same document. Official portal: https://www.sipri.org/databases/national-budget-archive

### World Bank WDI indicators: derivative access path only

World Bank indicators `MS.MIL.XPND.GD.ZS` (military expenditure as a share of GDP) and `MS.MIL.XPND.ZS` (military expenditure as a share of general government expenditure) provide convenient API access, but their stated source is SIPRI. Treat them as a delivery/normalization path to SIPRI-derived data, not an independent source. The World Bank's own indicator pages reference SIPRI's terms. Keep the underlying attribution and licence constraints intact:
- https://data.worldbank.org/indicator/MS.MIL.XPND.GD.ZS
- https://data.worldbank.org/indicator/MS.MIL.XPND.ZS

### Comparability rule

SIPRI, NATO and EDA figures may diverge because their definitions, reporting periods, coverage, GDP assumptions, treatment of pensions/paramilitary forces and estimate cut-off dates differ. A difference is not automatically an error or evidence of concealment. Preserve parallel series with source-specific metadata; compare only after an explicit definition crosswalk.


## 13. NOAA SWPC adapter implementation

**Status: implemented and published in the MSA-83 repository; contract tests added; broader runtime CI and UI presentation remain pending.**

The local provider stack exposes a read-only `GET /api/space-weather` route. It requests four fixed NOAA SWPC products: active alerts, planetary Kp, replacement RTSW magnetic-field data, and replacement RTSW solar-wind plasma data. Each feed has an independent cache lifetime and health classification; partial upstream failure can retain a previous successful response with an explicit partial/stale marker.

The adapter normalizes records, caps response size and retained row counts, validates timestamps and numeric ranges, preserves the RTSW `source` and `active` fields, and attaches the common provenance envelope. It refuses client-selected upstream URLs and applies the existing same-site keyless request gate. No API key is required and no client-side secret is introduced.

**Important 2026 compatibility note:** NOAA/NWS Service Change Notice 26-21 announces the March 2026 transition of planetary Kp and related products to object rows and the April 2026 retirement of legacy `/products/solar-wind/*` endpoints. The adapter uses `/json/rtsw/rtsw_mag_1m.json` and `/json/rtsw/rtsw_wind_1m.json`, whose records expose satellite `source` and forecaster `active` metadata. Do not revert to the retired plasma/magnetometer paths.

The adapter is a contextual data feed only. Space-weather observations can help assess environmental conditions relevant to GNSS, HF radio and satellite operations; they do not establish the cause of a GNSS anomaly, nor do they prove intentional interference. Keep the deterministic GNSS classifier independent from this feed.

Validation currently covers current object rows, legacy fixture compatibility, replacement RTSW field names, source-selection metadata, timestamp handling, Kp range checks, alert text bounds and URL scheme filtering. Live upstream integration, UI presentation, end-to-end route tests and Android/Termux validation remain pending.


## 14. UCDP GED versioned event adapter

**Status: server adapter and synthetic contract tests implemented; token and UI integration remain pending.**

The local provider stack exposes a read-only `GET /api/conflict-events/ucdp` route backed by the fixed UCDP GED API resource `gedevents/26.1`. The adapter requires a server-side `UCDP_API_TOKEN` environment variable and sends it only in the documented `x-ucdp-access-token` header. It does not place credentials in URLs, browser code, provenance or logs. No token was present during this implementation, so no live UCDP API request was made.

The request contract is deliberately bounded:

- Explicit `startDate` and `endDate` are required and must fall within GED 26.1 coverage, 1989-01-01 through 2025-12-31.
- Maximum date window is 31 calendar days; the upstream API applies both `StartDate` and `EndDate` to `date_end`.
- Page size is fixed at 100. The client can request one validated page at a time.
- Optional `country` (Gleditsch and Ward country IDs) and `type` (1, 2 or 3) filters are validated before constructing the fixed upstream URL.
- A process-local 4,500-request rolling 24-hour budget stays below UCDP's published 5,000/day quota; an additional per-client minute limiter, single-flight request coalescing, 24-hour page cache and bounded stale fallback reduce upstream load. This budget is per server process, not a distributed quota ledger.

The normalized event record preserves the stable UCDP `id`, the version-specific `relid`, actor/dyad new IDs, source references, date range and `date_prec`, location coordinates and `where_prec`, and the separate low/best/high fatality estimates. It explicitly preserves `number_of_sources = -1` rather than converting it to zero. Each event receives a provenance envelope pinned to GED 26.1 and CC BY 4.0 attribution.

**Interpretation guardrails:** GED records organized violence where armed force by an organized actor caused at least one direct death. It is not a complete feed of all violence and it is not real-time. `where_prec` values 3–7 may describe administrative centroids, broad/fuzzy features, country-only locations or international waters/airspace; do not render every coordinate as an exact point. `date_prec` values 2–5 represent wider temporal uncertainty. Keep the low/best/high fatality interval intact and do not infer intent, readiness or current operational status from the dataset.

The UCDP Candidate Events Dataset is not included in this adapter. The current download center lists the September 2026 monthly release as 26.0.9, while the API documentation page still lists an older candidate API release. Do not silently substitute Candidate Events for GED or assume the API version is current; evaluate the published download/codebook and API release separately before adding it.

**Credential follow-up:** request an API token from the UCDP API maintainer and configure `UCDP_API_TOKEN` in the server environment. The token must never be committed to the repository or added to client-side settings. Live API verification, browser/UI integration, multi-process quota accounting and Android/Termux deployment validation remain pending.

## 14. Multi-hazard, active-fire and space-object metadata candidates (2026-11-17)

The candidate registry now includes three additional sources. These are research candidates only; no new provider, polling job, map layer or secret has been enabled.

### GDACS — Global Disaster Awareness and Coordination System

- **Potential value:** GeoJSON event discovery for earthquakes, tropical cyclones, floods and other hazards; adds multi-hazard context alongside existing specialist hazard layers.
- **Access and terms:** Public APIs are documented in the GDACS Swagger and 2025 quick-start. GDACS requests acknowledgement as “Global Disaster Awareness and Coordination System, GDACS”; review the current disclaimer and terms before reuse.
- **Integration gate:** Pin the event-list endpoint and response schema, use bounded date windows and paging, cache conservatively, preserve event type, alert level, event/update timestamps, geometry and official event URL.
- **Interpretation:** An alert level is a GDACS classification, not ground-truth confirmation or a universal severity scale. Keep GDACS classification separate from analyst assessment.
- **Official references:** https://www.gdacs.org/gdacsapi/swagger/index.html and https://www.gdacs.org/Documents/2025/GDACS_API_quickstart_v2.pdf

### NASA FIRMS — active-fire and thermal-anomaly detections

- **Potential value:** MODIS and VIIRS satellite thermal detections, including acquisition time, sensor/platform, confidence and fire radiative power (FRP).
- **Access and limits:** Free MAP_KEY required. FIRMS documents a limit of 5,000 transactions per 10-minute interval; large requests may consume multiple transactions. WFS/WMS layers are updated every 15 minutes, but observation-to-publication latency varies by product, sensor and region.
- **Integration gate:** Keep the key server-side; use bounded AOI/date/sensor requests; preserve product/version, acquisition time in UTC, sensor, confidence, FRP and retrieval time. Check data availability before polling.
- **Interpretation:** A thermal anomaly is not proof of a confirmed fire, cause or intent. MODIS numeric confidence and VIIRS categorical confidence are different scales and must not be directly compared. Distinguish NRT, RT and URT streams and their geographic coverage.
- **Official references:** https://firms.modaps.eosdis.nasa.gov/api/ , https://firms2.modaps.eosdis.nasa.gov/content/academy/data_api/firms_api_use.html , https://firms2.modaps.eosdis.nasa.gov/mapserver/wfs-info/ , and https://firms.modaps.eosdis.nasa.gov/api/data_availability

### ESA DISCOS — space-object catalogue metadata

- **Potential value:** Object registration, launch-vehicle and spacecraft metadata for trackable, unclassified objects; complements dynamic public orbital data with catalogue context.
- **Access and terms:** DISCOSweb requires account registration and acceptance of its terms. ESA requires source acknowledgement in derived works and redistributions.
- **Integration gate:** Review the current API version, authentication, schema and terms before implementation; keep credentials server-side and pin source version/retrieval time.
- **Interpretation:** DISCOS does not distribute surveillance-derived orbital or attitude ephemerides. Treat it as catalogue metadata, not live tracking or a replacement for orbital element sources.
- **Official reference:** https://discosweb.esoc.esa.int/

### Prioritisation

1. **GDACS (P1):** strongest candidate for broad multi-hazard context, subject to a schema/terms spike and checks for overlap with existing earthquake/cyclone providers.
2. **NASA FIRMS (P1):** useful if the existing FIRMS provider does not already cover the required sensor/product fields; prefer extending the existing provider rather than creating a duplicate.
3. **ESA DISCOS (P2):** metadata enrichment only; lower priority until account access and API terms are confirmed.

Before implementation, run a duplicate-capability review against the existing provider tree, add synthetic fixtures, document attribution and freshness, and prove that source outages cannot suppress unrelated layers. Do not enable any of these sources merely because they appear in the candidate registry.
