import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildUcdpRequest,
  normalizeUcdpEvent,
  normalizeUcdpPage,
} from './ucdp.js';

const fixture = {
  id: 42,
  relid: 'AAA-2025-1-123-1',
  year: 2025,
  active_year: true,
  code_status: 'Clear',
  type_of_violence: 1,
  conflict_new_id: 100,
  conflict_name: 'Example conflict',
  dyad_new_id: 200,
  dyad_name: 'Government - Group',
  side_a_new_id: 10,
  side_a: 'Government',
  side_b_new_id: 20,
  side_b: 'Group',
  number_of_sources: -1,
  source_article: 'Publisher, 2025-11-17, Example report',
  source_office: 'Publisher',
  source_date: '',
  source_headline: 'Example report',
  source_original: 'Local authority',
  where_prec: 3,
  where_coordinates: 'Example district',
  where_description: 'District centroid',
  adm_1: 'Example province',
  adm_2: 'Example district',
  latitude: 12.5,
  longitude: 23.5,
  country: 'Exampleland',
  country_id: 999,
  region: 'Africa',
  event_clarity: 1,
  date_prec: 2,
  date_start: '2025-11-15',
  date_end: '2025-11-17',
  deaths_a: 2,
  deaths_b: 1,
  deaths_civilians: 3,
  deaths_unknown: 0,
  best: 6,
  high: 8,
  low: 4,
  gwnoa: '999',
  gwnob: null,
};

test(
  'builds fixed-version UCDP requests with bounded date filters and pagination',
  () => {
  const request = buildUcdpRequest(
    'http://localhost/?startDate=2025-11-01&endDate=2025-11-30&page=2&country=999&type=1,3',
  );
  const upstream = new URL(request.upstreamUrl);
  assert.equal(upstream.origin, 'https://ucdpapi.pcr.uu.se');
  assert.equal(upstream.pathname, '/api/gedevents/26.1');
  assert.equal(upstream.searchParams.get('pagesize'), '100');
  assert.equal(upstream.searchParams.get('page'), '2');
  assert.equal(upstream.searchParams.get('StartDate'), '2025-11-01');
  assert.equal(upstream.searchParams.get('EndDate'), '2025-11-30');
  assert.equal(upstream.searchParams.get('Country'), '999');
  assert.equal(upstream.searchParams.get('TypeOfViolence'), '1,3');
  assert.equal(upstream.searchParams.has('token'), false);
});

test(
  'rejects open-ended, over-wide, out-of-coverage and unknown filters',
  () => {
  assert.throws(
    () => buildUcdpRequest('http://localhost/?startDate=2025-11-01'),
    /ucdp_date_range_required/,
  );
  assert.throws(
    () =>
      buildUcdpRequest(
        'http://localhost/?startDate=2025-10-01&endDate=2025-11-01',
      ),
    /ucdp_date_window_too_large/,
  );
  assert.throws(
    () =>
      buildUcdpRequest(
        'http://localhost/?startDate=2026-01-01&endDate=2026-01-10',
      ),
    /ucdp_date_range_out_of_coverage/,
  );
  assert.throws(
    () =>
      buildUcdpRequest(
        'http://localhost/?startDate=2025-11-01&endDate=2025-11-10&url=https://example.com',
      ),
    /ucdp_invalid_query/,
  );
});

test(
  'preserves event IDs, coded date/location precision and fatality ranges',
  () => {
  const event = normalizeUcdpEvent(fixture);
  assert.equal(event.id, 42);
  assert.equal(event.relid, 'AAA-2025-1-123-1');
  assert.equal(event.location.precision, 3);
  assert.equal(event.location.precisionLabel, 'administrative-level-2');
  assert.equal(event.time.precision, 2);
  assert.equal(event.time.precisionLabel, 'two-to-six-day-range');
  assert.deepEqual(event.fatalities, {
    sideA: 2,
    sideB: 1,
    civilians: 3,
    unknownStatus: 0,
    low: 4,
    best: 6,
    high: 8,
  });
  assert.equal(event.source.numberOfSources, -1);
});

test(
  'rejects malformed coordinates, invalid precision and inconsistent fatality ranges',
  () => {
  assert.throws(
    () => normalizeUcdpEvent({ ...fixture, latitude: 91 }),
    /ucdp_schema_drift/,
  );
  assert.throws(
    () => normalizeUcdpEvent({ ...fixture, where_prec: 8 }),
    /ucdp_schema_drift/,
  );
  assert.throws(
    () =>
      normalizeUcdpEvent({
        ...fixture,
        low: 9,
        best: 6,
        high: 8,
      }),
    /ucdp_fatality_range_invalid/,
  );
  assert.throws(
    () =>
      normalizeUcdpEvent({
        ...fixture,
        date_start: '2025-11-18',
        date_end: '2025-11-17',
      }),
    /ucdp_schema_drift/,
  );
});

test(
  'adds versioned provenance to each event without token leakage',
  () => {
  const page = normalizeUcdpPage(
    { TotalCount: 1, TotalPages: 1, Result: [fixture] },
    {
      requestUrl:
        'https://ucdpapi.pcr.uu.se/api/gedevents/26.1?pagesize=100&page=1',
      retrievedAt: '2026-11-17T18:00:00.000Z',
      page: 1,
    },
  );
  assert.equal(page.events[0].provenance.sourceId, 'ucdp-ged');
  assert.equal(page.events[0].provenance.sourceVersion, 'GED 26.1');
  assert.equal(page.events[0].provenance.license, 'CC BY 4.0');
  assert.equal(page.events[0].provenance.sourceUrl.includes('token'), false);
});
