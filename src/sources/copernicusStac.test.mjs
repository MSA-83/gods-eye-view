import assert from 'node:assert/strict';
import test from 'node:test';
import { createCopernicusStacSource, encodeQuery } from './copernicusStac.js';

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
  };
}

test('encodes bounded STAC search filters for the same-origin proxy', () => {
  assert.equal(
    encodeQuery({
      bbox: [10, 45, 11, 46],
      datetime: '2026-01-01T00:00:00Z/2026-01-02T00:00:00Z',
      collections: ['sentinel-2-l2a'],
      limit: 5,
      cursor: 'next:sentinel-2-l2a:abc',
    }).toString(),
    'bbox=10%2C45%2C11%2C46&datetime=2026-01-01T00%3A00%3A00Z%2F2026-01-02T00%3A00%3A00Z&collections=sentinel-2-l2a&limit=5&cursor=next%3Asentinel-2-l2a%3Aabc',
  );
  assert.throws(() => encodeQuery({ bbox: [1, 2] }), /bbox/);
  assert.throws(() => encodeQuery({ limit: 51 }), /limit/);
  assert.throws(() => createCopernicusStacSource({ endpoint: 'https://provider.example' }), /same-origin/);
});

test('searches through the proxy and exposes only normalized proxy payloads', async () => {
  const calls = [];
  const source = createCopernicusStacSource({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response({
        status: 'complete',
        items: [{ id: 'S2A_TEST_001' }],
        nextCursor: null,
      });
    },
  });
  const result = await source.search({ collections: ['sentinel-2-l2a'], limit: 1 });
  assert.equal(result.items[0].id, 'S2A_TEST_001');
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^\/api\/copernicus\/stac\?/);
  assert.equal(calls[0].options.headers.Accept, 'application/json');
  assert.equal(calls[0].url.includes('COPERNICUS'), false);
});

test('returns status and sanitizes proxy failures', async () => {
  const source = createCopernicusStacSource({
    fetchImpl: async (url) => {
      if (url.endsWith('/status')) return response({ configured: false, oauth: false });
      return response({ error: 'upstream_unavailable', detail: 'secret-provider-detail' }, 502);
    },
  });
  assert.deepEqual(await source.status(), { configured: false, oauth: false });
  await assert.rejects(
    source.search(),
    (error) => error.status === 502 && error.message === 'upstream_unavailable',
  );
});
