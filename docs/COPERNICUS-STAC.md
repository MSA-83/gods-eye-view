# Copernicus Data Space STAC metadata discovery

**Status:** implemented runtime integration
**Source ID:** `copernicus-dataspace-stac`
**Implemented:** 2026-11-23

God's Eye View now provides bounded, server-side discovery of Copernicus Data Space catalog metadata through the public STAC API. The integration is deliberately metadata-only. It returns normalized product identity, footprint geometry or bounding box, acquisition time, platform and instrument fields, orbit metadata, cloud cover where supplied, provenance, source links, and safe asset references. It does not fetch asset URLs, download scenes, process imagery, or infer change automatically.

## Runtime contract

The local Vite/Node provider registers these same-origin routes:

- `GET /api/copernicus/stac`
- `GET /api/copernicus/stac/status`

The search route accepts only the following query parameters:

- `bbox=west,south,east,north`, with WGS84 longitude and latitude bounds;
- `datetime=start/end`, using ISO 8601 timestamps or an open interval (`..`);
- `collections=a,b,c`, limited to three conservative collection identifiers;
- `limit`, bounded from 1 through 50;
- `cursor`, an opaque bounded STAC pagination token.

The server sends a POST request to the fixed upstream endpoint `https://stac.dataspace.copernicus.eu/v1/search`. It forwards only the validated spatial, temporal, collection, limit, and cursor filters plus an allowlisted STAC field projection. The upstream response is capped at 6 MiB, requests have a 20-second timeout, redirects are rejected, and response parsing is schema-checked before normalization.

Copernicus STAC response-level `links[rel="next"].body.token` values are returned as `nextCursor` when they pass the local bounded-token policy. The client must treat this value as opaque and send it back only through the same-origin adapter. No arbitrary upstream URL is accepted from a browser request.

## Credential boundary

Public catalog discovery currently works without credentials. Optional OAuth client-credentials support is available for deployments that need authenticated quota or access behavior. The token endpoint is the official CDSE Keycloak endpoint:

`https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token`

Only `COPERNICUS_CLIENT_ID` and `COPERNICUS_CLIENT_SECRET` are read by the server. They are submitted in the server-side token request, cached only in process memory with an expiry margin, and never included in normalized responses, browser requests, logs, fixtures, or client bundles. `.env.example` contains names only. The credentials supplied during earlier work were not copied into this repository and should be rotated if they were real.

## Reliability and abuse controls

The provider uses the repository's same-site gate and rate-limiter contract, a per-client and global request budget, request coalescing through the cache flow, a five-minute fresh cache, a 30-minute stale fallback window, a 64-entry cache bound, and a 15-minute source-health stale threshold. Successful responses expose the normalized source state and provenance. When an upstream failure occurs after a usable cached response, the route returns that response marked `stale` with the sanitized warning `upstream_unavailable`. Without usable cache, errors expose stable local codes only; upstream payloads, URLs, credentials, and exception details are not returned.

The implementation intentionally uses stricter local bounds than any provider quota. Provider quotas and transfer/concurrency policies can change, so deployments must consult the live CDSE quota documentation before increasing polling or enabling additional workflows.

## Attribution and interpretation

The normalized provenance envelope identifies Copernicus Data Space Ecosystem, the STAC catalog URL, retrieval time, provider event time, and the source contract version (`stac-1.1.0`). Collection-specific Copernicus and contributing-mission terms apply. Product metadata and asset references are discovery results, not a license grant to redistribute imagery. Any future scene-processing workflow must be explicitly user-requested, asynchronous, terms-aware, and separated from this metadata route.

Sentinel observations support retrospective, human-reviewed change detection and corroboration. A catalog hit is not evidence of an incident, intent, military activity, or current operational status. Cloud cover, revisit, processing level, footprint, acquisition latency, and collection-specific availability must remain visible to analysts. Missing metadata remains null rather than being converted into a negative observation.

## Code and tests

- Server proxy: `server/providers/earthObservation/copernicus.js`
- Deterministic server contract tests: `server/providers/earthObservation/copernicus.test.mjs`
- Same-origin browser adapter: `src/sources/copernicusStac.js`
- Browser adapter tests: `src/sources/copernicusStac.test.mjs`
- Provider registration: `server/providers/local.js`
- Browser package export: `package.json`

The deterministic tests cover query validation, canonical timestamps, response-level pagination, malformed feature rejection, same-site and method gates, cache reuse, OAuth server-only behavior, stale fallback, sanitized errors, and browser payload validation. They do not claim permanent live-provider acceptance; network behavior, quotas, availability, and collection terms must be rechecked operationally.

## Official references

[1]: https://documentation.dataspace.copernicus.eu/APIs/STAC.html "Copernicus Data Space STAC API"
[2]: https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Catalog.html "Copernicus Data Space Catalog API"
[3]: https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Catalog/Examples.html "Copernicus Data Space Catalog API examples"
[4]: https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Overview/Authentication.html "Copernicus Data Space Sentinel Hub authentication"
[5]: https://documentation.dataspace.copernicus.eu/APIs/Token.html "Copernicus Data Space token API"
[6]: https://documentation.dataspace.copernicus.eu/Quotas.html "Copernicus Data Space quotas"
