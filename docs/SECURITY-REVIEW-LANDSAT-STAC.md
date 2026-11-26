# Landsat STAC AppSec review

## Scope and authorization

**SCOPE:** `MSA-83/gods-eye-view` source code
**AUTH:** owned system
**BOUNDARY:** local repository and local deterministic tests only
**EXCLUSIONS:** no active probing, exploitation, or credential testing against USGS, LandsatLook, production, or third-party infrastructure
**POSTURE:** defensive AppSec review

## Executive summary

The review covered the USGS Landsat STAC server proxy, browser adapter, package export, provider registration, boundary declaration, registry, and secret-exposure controls. One low-severity trust-boundary defect was confirmed and remediated: the configurable browser adapter endpoint accepted protocol-relative URLs such as `//provider.example`, which could make `fetch()` leave the application origin despite the adapter's same-origin contract. Server-side upstream access remained fixed to the LandsatLook origin and search path, and no SSRF, credential leak, automatic scene download, or metadata-boundary violation was confirmed.

## Finding

### [LOW-001] Protocol-relative endpoint bypass in the browser adapter — remediated

- **Affected asset:** `src/sources/landsatStac.js:createLandsatStacSource`
- **Classification:** CWE-601 (open redirect-like trust-boundary escape); OWASP A05:2021 Security Misconfiguration / A10:2021 SSRF defense-in-depth
- **Evidence:** the original validation accepted any string beginning with `/`. In URL fetch semantics, `//provider.example` is a protocol-relative URL and can resolve to a different origin. The adapter's JSDoc and implementation promise same-origin requests, so the accepted input violated the intended boundary.
- **Reproduction before remediation:** instantiate `createLandsatStacSource({ endpoint: '//provider.example' })`; the original validation did not throw, and a subsequent request would have passed the protocol-relative URL to `fetch()`.
- **Remediation:** the endpoint guard now requires a leading slash and rejects `endpoint.startsWith('//')`. A deterministic regression test covers the protocol-relative case alongside absolute-URL rejection.
- **Verification:** `node --import=./build/registerVue.js --test src/sources/landsatStac.test.mjs server/providers/earthObservation/landsat.test.mjs` passes 9/9 after the fix. The fix was published in commit `1afd3f39fc76643d0d1c2c1f0f5623d8fad50e85`.
- **Detection guidance:** retain the adapter test; optionally add a static rule that rejects configurable browser fetch endpoints unless they are validated as same-origin relative paths.

## Confirmed security properties

The server proxy uses a fixed `https://landsatlook.usgs.gov/stac-server/search` target, rejects redirects, validates response-level pagination origin and pathname before extracting the opaque cursor, caps request URL and response size, applies timeout and rate limits, uses same-site protection, and sanitizes upstream errors. Asset and source links are normalized as HTTPS references and are not dereferenced. The browser adapter makes same-origin requests only and carries no credential configuration. Repository and bundle scans found no private keys, JWT-like credentials, or Landsat credentials; `.env` and `.env.local` remain ignored.

## Not tested

- Live USGS/LandsatLook behavior, availability, rate limits, TLS configuration, or current publisher response changes.
- Production deployment configuration, reverse proxy headers, CDN behavior, and host-header policy.
- Full dependency CVE/SCA review and CI enforcement configuration.
- Any scene download or downstream image-processing workflow, which is intentionally outside this metadata-only provider.
- Active exploitation or intrusive testing of any third-party or production endpoint.
