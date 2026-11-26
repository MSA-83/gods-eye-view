import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeLandsatSearch,
  parseQuery,
  SEARCH_URL,
  STAC_ROOT,
  usgsLandsatStacProxy,
} from './landsat.js';

const item = {
  type: 'Feature',
  stac_version: '1.0.0',
  id: 'LC09_L1GT_172220_20261123_20261123_02_T2',
  collection: 'landsat-c2l1',
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [10, 45],
        [11, 45],
        [11, 46],
        [10, 46],
        [10, 45],
      ],
    ],
  },
  bbox: [10, 45, 11, 46],
  properties: {
    datetime: '2026-11-23T09:11:28.139789Z',
    platform: 'LANDSAT_9',
    instruments: ['OLI', 'TIRS'],
    'landsat:scene_id': 'LC91722202026327LGN00',
    'landsat:collection_category': 'T2',
    'landsat:collection_number': '02',
    'landsat:correction': 'L1GT',
    'landsat:cloud_cover_land': 12.5,
    'landsat:wrs_type': '2',
    'landsat:wrs_path': '172',
    'landsat:wrs_row': '220',
    'view:sun_azimuth': 145.2,
    'view:sun_elevation': 38.4,
    'view:off_nadir': 0,
    'proj:epsg': 32601,
  },
  links: [
    {
      rel: 'self',
      type: 'application/geo+json',
      href: 'https://landsatlook.usgs.gov/stac-server/collections/landsat-c2l1/items/LC09_L1GT_172220_20261123_20261123_02_T2',
    },
  ],
  assets: {
    thumbnail: {
      href: 'https://landsatlook.usgs.gov/thumbnail/LC09_L1GT.png',
      type: 'image/png',
      roles: ['thumbnail'],
    },
  },
};

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/geo+json' },
  });
}

function routeFor(hook, options) {
  let route;
  usgsLandsatStacProxy(options)[hook]({
    middlewares: {
      use(path, handler) {
        assert.equal(path, '/api/landsat/stac');
        route = handler;
      },
    },
  });
  assert.equal(typeof route, 'function');
  return route;
}

async function call(
  route,
  {
    method = 'GET',
    url = '/',
    headers = {},
    remoteAddress = '127.0.0.1',
  } = {},
) {
  const response = {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
    end(body = '') {
      this.body = String(body);
    },
  };
  await route(
    {
      method,
      url,
      headers: { host: 'localhost:4173', ...headers },
      socket: { remoteAddress },
    },
    response,
  );
  return { ...response, json: () => JSON.parse(response.body) };
}

test('parseQuery validates bounded Landsat filters and canonicalizes timestamps', () => {
  assert.deepEqual(
    parseQuery(
      '/?bbox=10,45,11,46&datetime=2026-01-01T00:00:00Z/2026-01-02T00:00:00%2B00:00&collections=landsat-c2l1&limit=5&cursor=2026-01-01T00:00:00Z%2CLC09_TEST%2Clandsat-c2l1',
    ),
    {
      bbox: [10, 45, 11, 46],
      datetime: '2026-01-01T00:00:00.000Z/2026-01-02T00:00:00.000Z',
      collections: ['landsat-c2l1'],
      limit: 5,
      cursor: '2026-01-01T00:00:00Z,LC09_TEST,landsat-c2l1',
    },
  );
  assert.throws(() => parseQuery('/?bbox=11,45,10,46'), /invalid_bbox/);
  assert.throws(() => parseQuery('/?limit=51'), /invalid_limit/);
  assert.throws(() => parseQuery('/?unknown=value'), /invalid_query/);
});

test('normalizes Landsat metadata and response-level href pagination', () => {
  const normalized = normalizeLandsatSearch(
    {
      type: 'FeatureCollection',
      features: [item],
      links: [
        {
          rel: 'next',
          href: `${SEARCH_URL}?limit=1&next=2026-11-23T09%3A11%3A28Z%2CLC09_TEST%2Clandsat-c2l1`,
        },
      ],
    },
    '2026-11-23T12:00:00Z',
  );
  assert.equal(normalized.items.length, 1);
  assert.equal(normalized.nextCursor, '2026-11-23T09:11:28Z,LC09_TEST,landsat-c2l1');
  assert.equal(normalized.items[0].metadata.landsatSceneId, 'LC91722202026327LGN00');
  assert.equal(normalized.items[0].metadata.cloudCoverLand, 12.5);
  assert.equal(normalized.items[0].metadata.wrsPath, '172');
  assert.equal(normalized.items[0].provenance.sourceId, 'usgs-landsat-stac');
  assert.equal(normalized.items[0].provenance.sourceUrl, `${STAC_ROOT}/`);
  assert.equal(normalized.items[0].assets[0].href.startsWith('https://'), true);

  const malformed = normalizeLandsatSearch(
    {
      type: 'FeatureCollection',
      features: [
        { ...item, id: 'bad-time', properties: { datetime: 'not-a-date' } },
        { ...item, id: 'bad-geometry', geometry: null, bbox: null },
      ],
    },
    '2026-11-23T12:00:00Z',
  );
  assert.deepEqual(malformed.items, []);
  assert.equal(malformed.skippedCount, 2);
});

for (const hook of ['configureServer', 'configurePreviewServer']) {
  test(`${hook}: public status, same-site gate, and method validation`, async () => {
    const route = routeFor(hook, {
      fetchImpl: async () => assert.fail('status and rejected requests must not query upstream'),
    });
    const status = await call(route, { url: '/status' });
    assert.equal(status.statusCode, 200);
    assert.deepEqual(status.json(), {
      configured: true,
      endpoint: STAC_ROOT,
      oauth: false,
      cacheEntries: 0,
    });
    assert.equal((await call(route, { method: 'POST' })).statusCode, 405);
    assert.equal((await call(route, { headers: { origin: 'https://foreign.example' } })).statusCode, 403);
  });
}

test('serves bounded GET search results and caches metadata pages', async () => {
  let calls = 0;
  const route = routeFor('configureServer', {
    fetchImpl: async (url, options) => {
      calls += 1;
      assert.equal(options.method, 'GET');
      assert.equal(url.startsWith(`${SEARCH_URL}?`), true);
      const query = new URL(url).searchParams;
      assert.equal(query.get('bbox'), '10,45,11,46');
      assert.equal(query.get('collections'), 'landsat-c2l1');
      assert.equal(query.get('limit'), '1');
      assert.equal(query.get('next'), null);
      assert.match(query.get('fields'), /assets/);
      return jsonResponse({
        type: 'FeatureCollection',
        features: [item],
        links: [],
      });
    },
  });
  const url = '/?bbox=10,45,11,46&collections=landsat-c2l1&limit=1';
  const first = await call(route, { remoteAddress: '127.0.0.11', url });
  assert.equal(first.statusCode, 200);
  assert.equal(first.json().items.length, 1);
  assert.equal(first.json().status, 'complete');
  const second = await call(route, { remoteAddress: '127.0.0.11', url });
  assert.equal(second.statusCode, 200);
  assert.equal(calls, 1);
});

test('returns stale cached metadata and sanitized upstream errors', async () => {
  let nowMs = Date.parse('2026-11-23T12:00:00Z');
  let fail = false;
  const route = routeFor('configureServer', {
    now: () => nowMs,
    fetchImpl: async () => {
      if (fail) return jsonResponse({ error: 'provider details' }, 503);
      return jsonResponse({ type: 'FeatureCollection', features: [item], links: [] });
    },
  });
  assert.equal((await call(route, { remoteAddress: '127.0.0.12' })).statusCode, 200);
  fail = true;
  nowMs += 6 * 60_000;
  const stale = await call(route, { remoteAddress: '127.0.0.12' });
  assert.equal(stale.statusCode, 200);
  assert.equal(stale.json().stale, true);
  assert.equal(stale.json().warning, 'upstream_unavailable');
  assert.equal(stale.body.includes('provider details'), false);
});
