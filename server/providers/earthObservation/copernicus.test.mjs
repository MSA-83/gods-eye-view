import assert from 'node:assert/strict';
import test from 'node:test';
import {
  copernicusStacProxy,
  normalizeCopernicusSearch,
  parseQuery,
  SEARCH_URL,
  TOKEN_URL,
} from './copernicus.js';

const item = {
  type: 'Feature',
  id: 'S2A_TEST_001',
  collection: 'sentinel-2-l2a',
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
    datetime: '2026-11-23T07:41:39.024000Z',
    platform: 'sentinel-2a',
    'sat:orbit_state': 'descending',
    'sat:relative_orbit': 92,
    'eo:cloud_cover': 12.5,
    instruments: ['MSI'],
  },
  links: [
    {
      rel: 'self',
      type: 'application/geo+json',
      href: 'https://stac.dataspace.copernicus.eu/v1/items/S2A_TEST_001',
    },
    {
      rel: 'next',
      href: 'https://stac.dataspace.copernicus.eu/v1/search',
      body: { token: 'next:sentinel-2-l2a:S2A_TEST_001' },
    },
  ],
  assets: {
    thumbnail: {
      href: 'https://example.dataspace.copernicus.eu/thumbnail.png',
      type: 'image/png',
      roles: ['thumbnail'],
    },
  },
};

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function routeFor(hook, options) {
  let route;
  copernicusStacProxy(options)[hook]({
    middlewares: {
      use(path, handler) {
        assert.equal(path, '/api/copernicus/stac');
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

test('parseQuery validates bounded STAC filters and canonicalizes timestamps', () => {
  assert.deepEqual(
    parseQuery(
      '/?bbox=10,45,11,46&datetime=2026-01-01T00:00:00Z/2026-01-02T00:00:00%2B00:00&collections=sentinel-2-l2a&limit=5&cursor=next%3Asentinel-2-l2a%3Aabc',
    ),
    {
      bbox: [10, 45, 11, 46],
      datetime: '2026-01-01T00:00:00.000Z/2026-01-02T00:00:00.000Z',
      collections: ['sentinel-2-l2a'],
      limit: 5,
      cursor: 'next:sentinel-2-l2a:abc',
    },
  );
  assert.throws(() => parseQuery('/?bbox=11,45,10,46'), /invalid_bbox/);
  assert.throws(() => parseQuery('/?limit=51'), /invalid_limit/);
  assert.throws(() => parseQuery('/?unknown=value'), /invalid_query/);
});

test('normalizes metadata-only STAC features with provenance and bounded next cursor', () => {
  const normalized = normalizeCopernicusSearch(
    {
      type: 'FeatureCollection',
      features: [item],
      links: [
        {
          rel: 'next',
          body: { token: 'next:sentinel-2-l2a:S2A_TEST_001' },
        },
      ],
    },
    '2026-11-23T12:00:00Z',
  );
  assert.equal(normalized.items.length, 1);
  assert.equal(normalized.skippedCount, 0);
  assert.equal(normalized.nextCursor, 'next:sentinel-2-l2a:S2A_TEST_001');
  assert.deepEqual(normalized.items[0].bbox, [10, 45, 11, 46]);
  assert.equal(normalized.items[0].metadata.cloudCover, 12.5);
  assert.equal(normalized.items[0].provenance.sourceId, 'copernicus-dataspace-stac');
  assert.equal(normalized.items[0].provenance.sourceUrl, 'https://stac.dataspace.copernicus.eu/v1/');
  assert.equal(normalized.items[0].assets[0].href.startsWith('https://'), true);

  const malformed = normalizeCopernicusSearch(
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
  test(`${hook}: status, same-site gate, and method validation are deterministic`, async (t) => {
    const previousId = process.env.COPERNICUS_CLIENT_ID;
    const previousSecret = process.env.COPERNICUS_CLIENT_SECRET;
    delete process.env.COPERNICUS_CLIENT_ID;
    delete process.env.COPERNICUS_CLIENT_SECRET;
    t.after(() => {
      if (previousId === undefined) delete process.env.COPERNICUS_CLIENT_ID;
      else process.env.COPERNICUS_CLIENT_ID = previousId;
      if (previousSecret === undefined) delete process.env.COPERNICUS_CLIENT_SECRET;
      else process.env.COPERNICUS_CLIENT_SECRET = previousSecret;
    });
    const route = routeFor(hook, {
      fetchImpl: async () => assert.fail('status and rejected requests must not query upstream'),
    });
    const status = await call(route, { url: '/status' });
    assert.equal(status.statusCode, 200);
    assert.deepEqual(status.json(), {
      configured: false,
      endpoint: 'https://stac.dataspace.copernicus.eu/v1',
      oauth: false,
      cacheEntries: 0,
    });
    const method = await call(route, { method: 'POST' });
    assert.equal(method.statusCode, 405);
    assert.equal(method.headers.allow, 'GET');
    const crossSite = await call(route, { headers: { origin: 'https://foreign.example' } });
    assert.equal(crossSite.statusCode, 403);
  });
}

test('serves bounded search results, forwards only safe metadata filters, and caches pages', async (t) => {
  const previousId = process.env.COPERNICUS_CLIENT_ID;
  const previousSecret = process.env.COPERNICUS_CLIENT_SECRET;
  delete process.env.COPERNICUS_CLIENT_ID;
  delete process.env.COPERNICUS_CLIENT_SECRET;
  t.after(() => {
    if (previousId === undefined) delete process.env.COPERNICUS_CLIENT_ID;
    else process.env.COPERNICUS_CLIENT_ID = previousId;
    if (previousSecret === undefined) delete process.env.COPERNICUS_CLIENT_SECRET;
    else process.env.COPERNICUS_CLIENT_SECRET = previousSecret;
  });
  let calls = 0;
  const route = routeFor('configureServer', {
    now: () => Date.parse('2026-11-23T12:00:00Z'),
    fetchImpl: async (url, options) => {
      calls += 1;
      assert.equal(url, SEARCH_URL);
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.authorization, undefined);
      const body = JSON.parse(options.body);
      assert.deepEqual(body.bbox, [10, 45, 11, 46]);
      assert.deepEqual(body.collections, ['sentinel-2-l2a']);
      assert.equal(body.limit, 1);
      assert.equal(body.fields.include.includes('assets'), true);
      return jsonResponse({ type: 'FeatureCollection', features: [{ ...item, links: item.links.filter((link) => link.rel !== 'next') }] });
    },
  });
  const first = await call(route, {
    remoteAddress: '127.0.0.11',
    url: '/?bbox=10,45,11,46&collections=sentinel-2-l2a&limit=1',
  });
  assert.equal(first.statusCode, 200);
  assert.equal(first.json().items.length, 1);
  assert.equal(first.json().status, 'complete');
  const second = await call(route, {
    remoteAddress: '127.0.0.11',
    url: '/?bbox=10,45,11,46&collections=sentinel-2-l2a&limit=1',
  });
  assert.equal(second.statusCode, 200);
  assert.equal(calls, 1);
  assert.equal(second.json().items[0].provenance.sourceId, 'copernicus-dataspace-stac');
});

test('uses OAuth only server-side and never returns credentials', async (t) => {
  const previousId = process.env.COPERNICUS_CLIENT_ID;
  const previousSecret = process.env.COPERNICUS_CLIENT_SECRET;
  process.env.COPERNICUS_CLIENT_ID = 'client-id-fixture';
  process.env.COPERNICUS_CLIENT_SECRET = 'client-secret-fixture';
  t.after(() => {
    if (previousId === undefined) delete process.env.COPERNICUS_CLIENT_ID;
    else process.env.COPERNICUS_CLIENT_ID = previousId;
    if (previousSecret === undefined) delete process.env.COPERNICUS_CLIENT_SECRET;
    else process.env.COPERNICUS_CLIENT_SECRET = previousSecret;
  });
  const seen = [];
  const route = routeFor('configureServer', {
    fetchImpl: async (url, options) => {
      seen.push({ url, options });
      if (url === TOKEN_URL) return jsonResponse({ access_token: 'token-fixture', expires_in: 600 });
      assert.equal(options.headers.Authorization, 'Bearer token-fixture');
      return jsonResponse({ type: 'FeatureCollection', features: [] });
    },
  });
  const result = await call(route, { remoteAddress: '127.0.0.12' });
  assert.equal(result.statusCode, 200);
  assert.equal(seen[0].url, TOKEN_URL);
  assert.equal(result.body.includes('client-secret-fixture'), false);
  assert.equal(result.body.includes('token-fixture'), false);
});

test('returns stale cached metadata and sanitized upstream errors', async (t) => {
  const previousId = process.env.COPERNICUS_CLIENT_ID;
  const previousSecret = process.env.COPERNICUS_CLIENT_SECRET;
  delete process.env.COPERNICUS_CLIENT_ID;
  delete process.env.COPERNICUS_CLIENT_SECRET;
  t.after(() => {
    if (previousId === undefined) delete process.env.COPERNICUS_CLIENT_ID;
    else process.env.COPERNICUS_CLIENT_ID = previousId;
    if (previousSecret === undefined) delete process.env.COPERNICUS_CLIENT_SECRET;
    else process.env.COPERNICUS_CLIENT_SECRET = previousSecret;
  });
  let nowMs = Date.parse('2026-11-23T12:00:00Z');
  let fail = false;
  const route = routeFor('configureServer', {
    now: () => nowMs,
    fetchImpl: async () => {
      if (fail) return jsonResponse({ error: 'provider details' }, 503);
      return jsonResponse({ type: 'FeatureCollection', features: [{ ...item, links: item.links.filter((link) => link.rel !== 'next') }] });
    },
  });
  assert.equal((await call(route, { remoteAddress: '127.0.0.13' })).statusCode, 200);
  fail = true;
  nowMs += 6 * 60_000;
  const stale = await call(route, { remoteAddress: '127.0.0.13' });
  assert.equal(stale.statusCode, 200);
  assert.equal(stale.json().stale, true);
  assert.equal(stale.json().warning, 'upstream_unavailable');

  const invalid = await call(route, {
    remoteAddress: '127.0.0.13',
    url: '/?limit=not-a-number',
  });
  assert.equal(invalid.statusCode, 400);
  assert.deepEqual(invalid.json(), { error: 'invalid_limit' });
  assert.equal(invalid.body.includes('provider details'), false);
});
