import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeOpenAqSnapshot } from './openaq.js';

test('normalizes PM2.5 rows with explicit provider identity and concentration scale', () => {
  const now = Date.parse('2026-11-17T12:00:00Z');
  const rows = normalizeOpenAqSnapshot(
    {
      readings: [
        {
          id: 'openaq:42:pm25',
          stationId: '42',
          name: 'Delhi Central',
          zone: 'IN',
          lat: 28.63,
          lon: 77.22,
          value: 58.4,
          observedMs: now - 30 * 60_000,
        },
      ],
    },
    now,
  );
  assert.deepEqual(rows[0], {
    id: 'openaq:42:pm25',
    provider: 'openaq',
    scale: 'PM2.5 µg/m³',
    value: 58.4,
    band: 'very-high',
    stationId: '42',
    name: 'Delhi Central',
    zone: 'IN',
    lat: 28.63,
    lon: 77.22,
    observedMs: now - 30 * 60_000,
    color: '#c1121f',
    label: '58.4',
    risk: 'Very High health risk',
    note: null,
  });
});

test('drops invalid coordinates, negative concentrations, and stale observations', () => {
  const now = Date.parse('2026-11-17T12:00:00Z');
  const rows = normalizeOpenAqSnapshot(
    {
      readings: [
        { id: 'bad-lat', lat: 91, lon: 1, value: 2, observedMs: now },
        { id: 'bad-value', lat: 1, lon: 1, value: -1, observedMs: now },
        { id: 'stale', lat: 1, lon: 1, value: 2, observedMs: now - 7 * 60 * 60_000 },
      ],
    },
    now,
  );
  assert.deepEqual(rows, []);
});

test('rejects a structurally malformed proxy payload', () => {
  assert.throws(() => normalizeOpenAqSnapshot({ readings: null }), /Malformed OpenAQ snapshot/);
});
