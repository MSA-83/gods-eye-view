const DEFAULT_ENDPOINT = '/api/landsat/stac';
const MAX_RESULTS = 50;

function queryValue(value, field) {
  if (value == null || value === '') return undefined;
  if (typeof value !== 'string')
    throw new TypeError(`${field} must be a string`);
  return value;
}

function encodeQuery(query = {}) {
  const params = new URLSearchParams();
  if (Array.isArray(query.bbox)) {
    if (query.bbox.length !== 4 || !query.bbox.every(Number.isFinite))
      throw new TypeError('bbox must contain four finite numbers');
    params.set('bbox', query.bbox.join(','));
  }
  const datetime = queryValue(query.datetime, 'datetime');
  if (datetime) params.set('datetime', datetime);
  if (query.collections != null) {
    if (
      !Array.isArray(query.collections) ||
      query.collections.length === 0 ||
      !query.collections.every((value) => typeof value === 'string')
    )
      throw new TypeError('collections must be a non-empty string array');
    params.set('collections', query.collections.join(','));
  }
  if (query.limit != null) {
    if (
      !Number.isInteger(query.limit) ||
      query.limit < 1 ||
      query.limit > MAX_RESULTS
    )
      throw new RangeError(`limit must be an integer from 1 to ${MAX_RESULTS}`);
    params.set('limit', String(query.limit));
  }
  const cursor = queryValue(query.cursor, 'cursor');
  if (cursor) params.set('cursor', cursor);
  return params;
}

function safePayload(payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.items))
    throw new Error('landsat_invalid_proxy_payload');
  if (payload.items.length > MAX_RESULTS) throw new Error('landsat_result_cap');
  return payload;
}

/**
 * Browser-side USGS Landsat metadata source. Credentials remain in the server
 * proxy; this adapter never requests an upstream URL or downloads an asset.
 * @param {{fetchImpl?: typeof fetch, endpoint?: string}} [options]
 * @returns {{search: (query?: object) => Promise<object>, status: () => Promise<object>}}
 */
export function createLandsatStacSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
  endpoint = DEFAULT_ENDPOINT,
} = {}) {
  if (typeof endpoint !== 'string' || !endpoint.startsWith('/'))
    throw new TypeError('endpoint must be a same-origin path');

  async function request(path) {
    const response = await fetchImpl(path, {
      headers: { Accept: 'application/json' },
    });
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error('landsat_invalid_proxy_response');
    }
    if (!response.ok) {
      const error = new Error(payload?.error || 'landsat_proxy_unavailable');
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  return {
    async search(query = {}) {
      const params = encodeQuery(query);
      const suffix = params.toString();
      return safePayload(
        await request(`${endpoint}${suffix ? `?${suffix}` : ''}`),
      );
    },
    async status() {
      return request(`${endpoint}/status`);
    },
  };
}

export { DEFAULT_ENDPOINT, encodeQuery };
