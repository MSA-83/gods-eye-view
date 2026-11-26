import { readResponseJsonCapped } from './common/http.js';
import { makeRateLimiter, clientKey } from './common/rate-limit.js';
import { admitSameSiteKeyless } from './common/same-site.js';

const API_ROOT = 'https://api.openaq.org/v3';
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const LOCATION_LIMIT = 80;
const LATEST_CONCURRENCY = 4;
const CACHE_TTL_MS = 15 * 60_000;
const STALE_MAX_MS = 2 * 60 * 60_000;
const REQUEST_TIMEOUT_MS = 18_000;
const MAX_READING_AGE_MS = 6 * 60 * 60_000;
const MAX_MEASUREMENTS_PER_LOCATION = 8;

/**
 * Safely coerce a finite coordinate inside WGS-84 bounds.
 * @param {unknown} raw
 * @param {number} min
 * @param {number} max
 * @returns {number|null}
 */
function coordinate(raw, min, max) {
  const value = Number(raw);
  return Number.isFinite(value) && value >= min && value <= max ? value : null;
}

/**
 * Convert an OpenAQ measurement into an air-quality layer record. OpenAQ
 * publishes concentrations rather than a universal AQI; the UI therefore
 * labels this scale explicitly as PM2.5 and does not call it AQHI/AQI.
 * @param {object} location
 * @param {object} measurement
 * @param {number} now
 * @returns {object|null}
 */
function normalizeMeasurement(location, measurement, now) {
  const coordinates = location?.coordinates || {};
  const lat = coordinate(coordinates.latitude, -90, 90);
  const lon = coordinate(coordinates.longitude, -180, 180);
  const value = Number(measurement?.value);
  const parameter = String(
    measurement?.parameter?.name || measurement?.parameter?.displayName || '',
  ).toLowerCase();
  const unit = String(measurement?.parameter?.units || '').toLowerCase();
  const observed = Date.parse(
    measurement?.datetime?.utc || measurement?.period?.datetimeFrom?.utc || '',
  );
  if (
    lat === null ||
    lon === null ||
    !Number.isFinite(value) ||
    value < 0 ||
    !parameter.includes('pm25') ||
    !unit.includes('g/m') ||
    !Number.isFinite(observed) ||
    now - observed > MAX_READING_AGE_MS
  )
    return null;
  return {
    id: `openaq:${location.id}:pm25`,
    provider: 'openaq',
    scale: 'PM2.5 µg/m³',
    value: Math.round(value * 10) / 10,
    stationId: String(location.id),
    name: String(location.name || location.locality || `OpenAQ ${location.id}`),
    zone: String(location.country?.code || '').toUpperCase(),
    lat,
    lon,
    observedMs: observed,
    note: String(location.provider?.name || '').trim() || null,
  };
}

/**
 * Fetch a JSON document from OpenAQ with a hard timeout and byte cap.
 * @param {string} url
 * @param {string} key
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<object>}
 */
async function fetchJson(url, key, fetchImpl) {
  const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const response = await fetchImpl(url, {
    signal,
    headers: { Accept: 'application/json', 'X-API-Key': key },
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`OpenAQ HTTP ${response.status}`);
  }
  return readResponseJsonCapped(response, MAX_RESPONSE_BYTES, signal);
}

/**
 * Server-side OpenAQ v3 proxy. It discovers a bounded set of recently updated
 * monitoring locations, retrieves each location's latest measurements with a
 * small concurrency window, and serves only normalized PM2.5 rows. The key is
 * read from OPENAQ_API_KEY and never reaches the browser. Successful snapshots
 * are cached in memory; a recent snapshot is served stale when OpenAQ is down.
 * @param {{fetchImpl?: typeof fetch, now?: () => number}} [options]
 * @returns {import('vite').Plugin}
 */
export function openaqProxy(options = {}) {
  const { fetchImpl = fetch, now = () => Date.now() } = options;
  let cache = null;
  let inflight = null;
  const allow = makeRateLimiter({ windowMs: 60_000, max: 12, globalMax: 48 });

  const key = () => String(process.env.OPENAQ_API_KEY || '').trim();
  const response = (res, status, body, headers = {}) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    for (const [name, value] of Object.entries(headers))
      res.setHeader(name, value);
    res.end(JSON.stringify(body));
  };

  async function latestForLocation(location, apiKey) {
    const payload = await fetchJson(
      `${API_ROOT}/locations/${encodeURIComponent(location.id)}/latest`,
      apiKey,
      fetchImpl,
    );
    const measurements = Array.isArray(payload?.results) ? payload.results : [];
    return measurements
      .slice(0, MAX_MEASUREMENTS_PER_LOCATION)
      .map((measurement) => normalizeMeasurement(location, measurement, now()))
      .filter(Boolean);
  }

  async function refresh(apiKey) {
    const locationsUrl = `${API_ROOT}/locations?limit=${LOCATION_LIMIT}&page=1&order_by=last_updated&sort_order=desc&is_monitor=true`;
    const locationPayload = await fetchJson(locationsUrl, apiKey, fetchImpl);
    if (!Array.isArray(locationPayload?.results))
      throw new Error('Malformed OpenAQ locations response');
    const locations = locationPayload.results.filter(
      (location) => location?.id != null,
    );
    const readings = [];
    let cursor = 0;
    async function worker() {
      while (cursor < locations.length) {
        const location = locations[cursor++];
        try {
          readings.push(...(await latestForLocation(location, apiKey)));
        } catch (error) {
          // One retired or temporarily unavailable station must not erase the
          // global snapshot. The aggregate reports partial coverage instead.
          console.warn(
            '[openaq-proxy] location refresh failed:',
            error?.message || error,
          );
        }
      }
    }
    await Promise.all(
      Array.from(
        { length: Math.min(LATEST_CONCURRENCY, locations.length) },
        worker,
      ),
    );
    const deduped = new Map();
    for (const reading of readings) {
      const existing = deduped.get(reading.id);
      if (!existing || existing.observedMs < reading.observedMs)
        deduped.set(reading.id, reading);
    }
    return {
      fetchedAt: now(),
      stale: false,
      count: deduped.size,
      readings: [...deduped.values()],
    };
  }

  async function getSnapshot() {
    const current = now();
    if (cache && current - cache.fetchedAt <= CACHE_TTL_MS) return cache;
    if (inflight) return inflight;
    inflight = refresh(key())
      .then((next) => {
        cache = next;
        return next;
      })
      .catch((error) => {
        if (cache && current - cache.fetchedAt <= STALE_MAX_MS)
          return { ...cache, stale: true, error: 'upstream_unavailable' };
        throw error;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  }

  const install = (server) => {
    server.middlewares.use('/api/openaq', async (req, res) => {
      if (req.method !== 'GET')
        return response(
          res,
          405,
          { error: 'method_not_allowed' },
          { Allow: 'GET' },
        );
      if (admitSameSiteKeyless(req, res)) return;
      const path = String(req.url || '/').split('?')[0];
      const apiKey = key();
      if (path === '/status') {
        return response(res, 200, {
          configured: Boolean(apiKey),
          fetchedAt: cache?.fetchedAt ?? null,
          count: cache?.count ?? 0,
          stale: Boolean(cache?.stale),
        });
      }
      if (path !== '/' && path !== '')
        return response(res, 404, { error: 'not_found' });
      if (!apiKey) return response(res, 503, { error: 'no_key' });
      const admission = allow(clientKey(req));
      if (!admission.allowed)
        return response(res, 429, {
          error: 'rate_limited',
          retryAfterMs: admission.retryAfterMs,
        });
      try {
        return response(res, 200, await getSnapshot());
      } catch (error) {
        console.warn('[openaq-proxy] refresh failed:', error?.message || error);
        return response(res, 502, { error: 'upstream_unavailable' });
      }
    });
  };
  return {
    name: 'openaq-proxy',
    configureServer: install,
    configurePreviewServer(server) {
      install(server);
    },
  };
}
