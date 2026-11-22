import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifySourceHealth,
  createProvenanceEnvelope,
  SOURCE_HEALTH_STATES,
} from './osintEvidence.js';

const checkedAt = '2026-11-17T12:00:00Z';

test('provenance envelope normalizes zoned timestamps and freezes the result', () => {
  const envelope = createProvenanceEnvelope({
    sourceId: 'noaa-swpc',
    sourceUrl: 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json#fragment',
    retrievedAt: checkedAt,
    eventTime: '2026-11-17T12:30:00+01:00',
    publishedAt: '2026-11-17T11:55:00Z',
    sourceVersion: 'swpc-json-2026',
    sourceType: 'observation',
    rawSha256: 'a'.repeat(64),
  });
  assert.equal(envelope.sourceUrl, 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json');
  assert.equal(envelope.eventTime, '2026-11-17T11:30:00.000Z');
  assert.equal(envelope.retrievedAt, '2026-11-17T12:00:00.000Z');
  assert.equal(envelope.publishedAt, '2026-11-17T11:55:00.000Z');
  assert.equal(Object.isFrozen(envelope), true);
});

test('missing event and publication times remain null rather than being fabricated', () => {
  const envelope = createProvenanceEnvelope({
    sourceId: 'ucdp-ged',
    sourceUrl: 'https://ucdp.uu.se/downloads/',
    retrievedAt: checkedAt,
  });
  assert.equal(envelope.eventTime, null);
  assert.equal(envelope.publishedAt, null);
});

test('provenance rejects malformed IDs, timestamps, unknown fields and unsafe URLs', () => {
  const base = {
    sourceId: 'noaa-swpc',
    sourceUrl: 'https://example.org/feed',
    retrievedAt: checkedAt,
  };
  for (const input of [
    { ...base, sourceId: 'NOAA SWPC' },
    { ...base, retrievedAt: '2026-11-17T12:00:00' },
    { ...base, retrievedAt: '2026-02-30T12:00:00Z' },
    { ...base, retrievedAt: '2026-11-17T24:00:00Z' },
    { ...base, retrievedAt: '2026-11-17T12:00:00+14:01' },
    { ...base, eventTime: 'yesterday' },
    { ...base, unexpected: true },
    { ...base, sourceUrl: 'http://example.org/feed' },
    { ...base, sourceUrl: 'https://user:pass@example.org/feed' },
    { ...base, sourceUrl: 'https://example.org/feed?api_key=secret' },
    { ...base, sourceUrl: 'https://example.org/feed?X-API-Key=secret' },
    { ...base, sourceUrl: 'https://example.org/feed?client_secret=secret' },
    { ...base, sourceUrl: 'https://example.org/feed?subscription-key=secret' },
    { ...base, rawSha256: 'not-a-hash' },
    { ...base, sourceType: 'inference' },
  ]) {
    assert.throws(() => createProvenanceEnvelope(input), TypeError);
  }
});

test('source health returns fresh at the threshold and stale beyond it', () => {
  const fresh = classifySourceHealth({
    lastSuccessAt: '2026-11-17T11:50:00Z',
    checkedAt,
    staleAfterMs: 10 * 60 * 1000,
  });
  assert.equal(fresh.status, 'fresh');
  assert.equal(fresh.ageMs, 10 * 60 * 1000);

  const stale = classifySourceHealth({
    lastSuccessAt: '2026-11-17T11:49:59Z',
    checkedAt,
    staleAfterMs: 10 * 60 * 1000,
  });
  assert.equal(stale.status, 'stale');
});

test('source health distinguishes partial, unavailable and rate-limited states', () => {
  const base = {
    lastSuccessAt: '2026-11-17T11:59:00Z',
    checkedAt,
    staleAfterMs: 60 * 60 * 1000,
  };
  assert.equal(classifySourceHealth({ ...base, partial: true }).status, 'partial');
  assert.equal(classifySourceHealth({ ...base, available: false }).status, 'unavailable');
  assert.equal(
    classifySourceHealth({
      ...base,
      retryAfterAt: '2026-11-17T12:05:00Z',
    }).status,
    'rate_limited',
  );
  assert.equal(
    classifySourceHealth({
      checkedAt,
      staleAfterMs: 60 * 60 * 1000,
    }).status,
    'unavailable',
  );
});

test('source health rejects invalid thresholds and future success timestamps', () => {
  assert.throws(() => classifySourceHealth({ staleAfterMs: 0 }), TypeError);
  assert.throws(
    () =>
      classifySourceHealth({
        lastSuccessAt: '2026-11-17T12:01:00Z',
        checkedAt,
        staleAfterMs: 60_000,
      }),
    TypeError,
  );
});

test('health state vocabulary is stable and complete', () => {
  assert.deepEqual(SOURCE_HEALTH_STATES, [
    'fresh',
    'stale',
    'partial',
    'unavailable',
    'rate_limited',
  ]);
});
