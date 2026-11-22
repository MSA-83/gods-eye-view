# OSINT Evidence and Source Health Contract

**Status:** foundational helper contract; provider adoption and UI integration remain pending.
**Version:** 1.0
**Scope:** server-side, read-only public-source ingestion and retrospective/aggregated analysis.

## Provenance envelope

Every normalized OSINT record should carry a provenance envelope with:

| Field | Required | Meaning |
| --- | --- | --- |
| `sourceId` | yes | Stable kebab-case ID from `config/osint-source-candidates.json` or an approved provider registry |
| `sourceUrl` | yes | Canonical HTTPS source/endpoint URL, without credentials or secret query parameters |
| `retrievedAt` | yes | ISO-8601 timestamp with explicit timezone for this retrieval |
| `recordId` | no | Provider's stable record identifier |
| `eventTime` | no | When the described event/measurement occurred |
| `publishedAt` | no | When the provider published the record |
| `sourceVersion` | no | Dataset release, API schema, collection or provider version |
| `sourceType` | no | `observation`, `source-assertion`, `context`, or `derived` |
| `license` | no | Applicable licence/terms identifier or concise note |
| `attribution` | no | Human-readable source credit |
| `rawSha256` | no | SHA-256 of a preserved raw response/file, when retention is permitted |

The helper in `server/providers/common/osintEvidence.js` validates and freezes this envelope. It rejects unknown keys, invalid timestamps, non-HTTPS URLs, URL user-info, credential-like query parameters and malformed SHA-256 values. It does not fetch, persist or hash data itself.

Never put API keys, access tokens, cookies, authorization headers, signed download URLs or personal data into this envelope. Keep request secrets out of provenance and logs.

## Source-health states

`classifySourceHealth()` returns one of:

- `fresh`: last successful retrieval is within the provider-specific freshness threshold.
- `stale`: a prior success exists, but its age exceeds the threshold.
- `partial`: provider returned a usable but incomplete result.
- `unavailable`: no usable successful retrieval exists or the provider is explicitly unavailable.
- `rate_limited`: a provider-supplied retry-after time is still in the future.

Priority is deterministic: rate-limited, unavailable, partial, stale, fresh. A provider adapter must supply its own threshold; one global freshness threshold is inappropriate for sources ranging from live alerts to annual datasets.

## Time semantics

Keep event time, publication time and retrieval time separate. A missing event timestamp stays null/unknown. Do not substitute retrieval time for event time. Preserve the provider's original timestamp and timezone in raw evidence when possible; normalized timestamps must be UTC ISO-8601.

## Evidence and claim boundaries

- `OBSERVATION`: value directly returned by a sensor/dataset.
- `SOURCE_ASSERTION`: claim made by a publisher or official statement.
- `INFERENCE`: analyst interpretation derived from evidence.
- `CONCLUSION`: bounded finding supported by the claim ledger.

Source independence must be explicit. A downstream API that republishes another provider's dataset is derivative, not an independent corroborating source. Conflicting source definitions must remain separate.

## Required adapter tests

Test valid and malformed envelopes, unknown keys, timestamp offsets, missing event time, secret-bearing URLs, stale/fresh boundaries, future timestamps, partial results, unavailable providers and retry-after/rate-limited states. Each adapter must additionally test empty, malformed, oversized, delayed and schema-drift responses with synthetic fixtures.

## Current implementation boundary

This contract and its pure validation/classification helpers are foundations only. They do not yet wire health into layer UI, normalize existing provider records, enable any new network source, or claim that all existing data has complete provenance. Provider adoption is tracked in `docs/OSINT-SOURCE-ROADMAP.md`.
