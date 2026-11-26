import assert from 'node:assert/strict';
import test from 'node:test';
import { createLandsatStacSource, encodeQuery } from './landsatStac.js';

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
      collections: ['landsat-c2l1'],
      limit: 5,
      cursor: 'next:landsat-c2l1:abc',
    }).toString(),
    'bbox=10%2C45%2C11%2C46&datetime=2026-01-01T00%3A00%3A00Z%2F2026-01-02T00%3A00%3A00Z&collections=landsat-c2l1&limit=5&cursor=next%3Alandsat-c2l1%3Aabc',
  );
  assert.throws(() => encodeQuery({ bbox: [1, 2] }), /bbox/);
  assert.throws(() => encodeQuery({ limit: 51 }), /limit/);
  assert.throws(() => createLandsatStacSource({ endpoint: 'https://provider.example' }), /same-origin/);
});

test('searches through the proxy and exposes only normalized proxy payloads', async () => {
  const calls = [];
  const source = createLandsatStacSource({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response({
        status: 'complete',
        items: [{ id: 'LC09_L1GT_172220_20261123_20261123_02_T2' }],
        nextCursor: null,
      });
    },
  });
  const result = await source.search({ collections: ['landsat-c2l1'], limit: 1 });
  assert.equal(result.items[0].id, 'LC09_L1GT_172220_20261123_20261123_02_T2');
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^\/api\/landsat\/stac\?/);
  assert.equal(calls[0].options.headers.Accept, 'application/json');
  assert.equal(calls[0].url.includes('COPERNICUS'), false);
});

test('returns status and sanitizes proxy failures', async () => {
  const source = createLandsatStacSource({
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
