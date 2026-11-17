# OSINT Source Expansion Roadmap

**Status:** research baseline; no new provider adapter is enabled by this document.  
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
- `src/layers/airQuality/source.js`: currently ECCC AQHI; add OpenAQ as an additional provider, not a replacement.
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
1. Add NOAA SWPC as a GNSS context provider, separate from aircraft-reported integrity facts.
2. Add OpenAQ as a second air-quality provider behind the existing air-quality source interface.
3. Add UCDP GED as a versioned, historical conflict-event dataset. Prefer a downloadable, checksummed release for the first iteration; add API access only after token handling and paging tests.

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

Implement NOAA SWPC, OpenAQ and UCDP first. They add distinct explanatory value while fitting existing GEV layer seams. Treat Copernicus STAC and Global Fishing Watch as the next research integrations, gated by account setup, quota and licence review. ACLED and ReliefWeb remain optional until access and reuse terms are confirmed.

This roadmap is a research/design artifact. It does not claim that any new provider has been connected, that the credentials have been rotated, or that runtime integration tests have passed.


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

### NOAA SWPC contract update

NOAA's SWPC data service exposes products, JSON, text and archive endpoints. Its 2026 service-change notice announced JSON format changes for several products, including planetary K-index and solar-wind magnetic-field summaries. Before implementing the SWPC adapter:
1. Pin the exact product endpoint(s) and document their current schema.
2. Preserve source timestamps and distinguish observed values from forecasts/alerts.
3. Add fixtures for both valid and malformed/changed payloads.
4. Reject unknown schema shapes rather than silently interpreting them.
5. Keep space-weather conditions as a contextual covariate, never as proof of GNSS interference or intentional action.

Official documentation: https://www.spaceweather.gov/content/data-access and https://www.weather.gov/media/notification/pdf_2026/scn26-21_Data_Format_Changes_Impacting_SWPC_Products.pdf

## 11. Implementation backlog and acceptance gates

The following are implementation tasks, not completed runtime integrations:

| ID | Work | Priority | Acceptance gate |
| --- | --- | --- | --- |
| GEV-OSINT-01 | Add provider-neutral provenance envelope and source-health status contract | P0 | **Foundation helper and unit tests added in branch**; provider adoption, UI health display and end-to-end integration remain pending |
| GEV-OSINT-02 | Add NOAA SWPC context provider through server-side proxy | P0 | Pinned JSON fixtures, schema drift tests, no client secret, clear observation/forecast labels |
| GEV-OSINT-03 | Add OpenAQ as an additive provider to the existing air-quality source | P1 | Existing ECCC behavior unchanged; key remains server-side; provider attribution and sensor licence surfaced |
| GEV-OSINT-04 | Import versioned UCDP GED snapshots with checksums and codebook metadata | P1 | Reproducible import, source version recorded, duplicate/event-time tests, CC BY attribution |
| GEV-OSINT-05 | Add Copernicus STAC metadata discovery | P1 | OAuth kept server-side; bounded paging; metadata-only default; no automatic full-scene downloads |
| GEV-OSINT-06 | Evaluate GEM static infrastructure packs | P2 | Dataset-by-dataset licence review; version, download date, checksum and attribution |
| GEV-OSINT-07 | Evaluate OpenSanctions deliberate lookup workflow | P2 | Confirm public-interest eligibility and API terms; explicit user action; entity match score and false-positive caveat |
| GEV-OSINT-08 | Evaluate Global Fishing Watch aggregated historical maritime context | P2 | Non-commercial terms gate; no individual-vessel operational tracking or tactical use |

The provenance/source-health foundation is implemented in the current feature branch, but no provider adapter is enabled by that helper alone. The next runtime milestone is the P0 NOAA SWPC context adapter, followed by versioned UCDP ingestion. Reuse existing layer and server-provider seams, keep secrets server-side, and add synthetic tests before any live provider is enabled.


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

These additions remain research candidates. No CEMS, EUMETSAT, SWPC, OpenAQ, or UCDP runtime adapter is claimed by this documentation change.


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

