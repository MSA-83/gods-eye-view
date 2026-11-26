import assert from 'node:assert/strict';
import test from 'node:test';
import { openaqProxy } from './openaq.js';

function routeFor(hook, options) {
  let route;
  openaqProxy(options)[hook]({
    middlewares: {
      use(path, handler) {
        assert.equal(path, '/api/openaq');
        route = handler;
      },
    },
  });
  assert.equal(typeof route, 'function');
  return route;
}

async function call(route, { method = 'GET', url = '/', headers = {} } = {}) {
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
      socket: { remoteAddress: '127.0.0.1' },
    },
    response,
  );
  return { ...response, json: () => JSON.parse(response.body) };
}

for (const hook of ['configureServer', 'configurePreviewServer']) {
  test(`${hook}: status responds without querying OpenAQ`, async (t) => {
    const previous = process.env.OPENAQ_API_KEY;
    delete process.env.OPENAQ_API_KEY;
    t.after(() => {
      if (previous === undefined) delete process.env.OPENAQ_API_KEY;
      else process.env.OPENAQ_API_KEY = previous;
    });
    const route = routeFor(hook, {
      fetchImpl: async () => assert.fail('status must not query upstream'),
    });
    const response = await call(route, { url: '/status' });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      configured: false,
      fetchedAt: null,
      count: 0,
      stale: false,
    });
  });

  test(`${hook}: missing key, invalid route, method, and cross-site requests are sanitized`, async (t) => {
    const previous = process.env.OPENAQ_API_KEY;
    delete process.env.OPENAQ_API_KEY;
    t.after(() => {
      if (previous === undefined) delete process.env.OPENAQ_API_KEY;
      else process.env.OPENAQ_API_KEY = previous;
    });
    const route = routeFor(hook, {
      fetchImpl: async () => assert.fail('unconfigured route must not query upstream'),
    });
    const missing = await call(route);
    assert.equal(missing.statusCode, 503);
    assert.deepEqual(missing.json(), { error: 'no_key' });
    assert.equal(missing.body.includes('OPENAQ_API_KEY'), false);

    const invalid = await call(route, { url: '/private' });
    assert.equal(invalid.statusCode, 404);
    assert.deepEqual(invalid.json(), { error: 'not_found' });

    const method = await call(route, { method: 'POST' });
    assert.equal(method.statusCode, 405);
    assert.deepEqual(method.json(), { error: 'method_not_allowed' });
    assert.equal(method.headers.allow, 'GET');

    const crossSite = await call(route, {
      headers: { origin: 'https://foreign.example' },
    });
    assert.equal(crossSite.statusCode, 403);
    assert.match(crossSite.json().error, /cross-origin|cross-site/i);
  });
}
