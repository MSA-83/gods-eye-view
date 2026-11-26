# USGS Landsat STAC metadata discovery

## Runtime contract

God’s-Eye-View registers `usgsLandsatStacProxy()` in `server/providers/local.js` and exposes the same-origin routes `/api/landsat/stac` and `/api/landsat/stac/status`. The browser adapter is `src/sources/landsatStac.js`; it never contacts LandsatLook directly and contains no credential path. The server calls the public USGS LandsatLook STAC search endpoint with a bounded `GET` request.

The proxy accepts a WGS84 `bbox`, an ISO-8601 `datetime` interval, up to three collection identifiers, a limit from 1 through 50, and an opaque cursor. It requests a fixed STAC field projection, caps the upstream URL at 8 KiB and the response at 6 MiB, applies a 20-second timeout, same-site protection, per-client and global rate limits, a five-minute cache, and a bounded stale fallback. Upstream failures are sanitized before reaching the browser. The public status endpoint reports keyless operation.

USGS LandsatLook currently returns response-level STAC `links`, including an opaque `rel=next` URL. The proxy converts that next URL into a safe cursor only when its origin and pathname match `https://landsatlook.usgs.gov/stac-server/search`; it does not accept arbitrary browser-supplied upstream URLs. The provider normalizes product ID, collection, geometry or bbox, sensing datetime, platform, instruments, Landsat scene ID, collection category and number, correction, land cloud cover, WRS path/row/type, sun geometry, off-nadir angle, EPSG, safe source links, and safe asset references.

## Safety and semantics

This integration is metadata-only discovery. It does not dereference asset links, download scenes, render imagery, infer change automatically, or present a product as evidence of intent or causality. Asset references are returned only as bounded, HTTPS metadata for an explicitly selected product. Any later image-processing workflow must be a separate, reviewed feature with its own terms, budgets, retention policy, and user action.

USGS identifies Landsat data as public domain, but downstream cloud access and product distribution terms must still be checked before redistribution. The application attribution is `USGS Landsat Collection 2`; it does not imply USGS endorsement. Landsat metadata is observational context and may be delayed, incomplete, or revised by the publisher.

## Official references

- [USGS Spatiotemporal Asset Catalog (STAC)](https://www.usgs.gov/landsat-missions/spatiotemporal-asset-catalog-stac)
- [USGS Landsat data access](https://www.usgs.gov/landsat-missions/landsat-data-access)
- [USGS Introduction to the Landsat STAC tutorial](https://www.usgs.gov/software/introduction-landsat-stac-tutorial)
- [USGS public-domain FAQ for Landsat data in the cloud](https://www.usgs.gov/faqs/are-landsat-data-cloud-still-considered-to-be-within-public-domain)
- [Live LandsatLook STAC catalog](https://landsatlook.usgs.gov/stac-server/)
