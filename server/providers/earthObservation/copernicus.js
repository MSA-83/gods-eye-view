import { readResponseJsonCapped } from '../common/http.js';
import { makeRateLimiter, clientKey } from '../common/rate-limit.js';
import { admitSameSiteKeyless } from '../common/same-site.js';
import {
  classifySourceHealth,
  createProvenanceEnvelope,
} from '../common/osintEvidence.js';

const STAC_ROOT = 'https://stac.dataspace.copernicus.eu/v1';
const SEARCH_URL = `${STAC_ROOT}/search`;
const TOKEN_URL =
  'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token';
const SOURCE_URL = `${STAC_ROOT}/`;
const SOURCE_ID = 'copernicus-dataspace-stac';
const MAX_RESPONSE_BYTES = 6 * 1024 * 1024;
const MAX_REQUEST_BODY_BYTES = 16 * 1024;
const MAX_RESULTS = 50;
const MAX_COLLECTIONS = 3;
const MAX_CURSOR_LENGTH = 512;
const REQUEST_TIMEOUT_MS = 20_000;
const TOKEN_TIMEOUT_MS = 12_000;
const CACHE_TTL_MS = 5 * 60_000;
const STALE_MAX_MS = 30 * 60_000;
const MAX_CACHE_ENTRIES = 64;
const STALE_AFTER_MS = 15 * 60_000;
const MAX_GEOMETRY_BYTES = 180_000;
const MAX_LINKS = 24;
const MAX_ASSETS = 40;
const COLLECTION_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const CURSOR_PATTERN = /^[A-Za-z0-9:_./-]{1,512}$/;
const ISO_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/;

const FIELDS = Object.freeze([
  'id',
  'type',
  'geometry',
  'bbox',
  'links',
  'assets',
  'collection',
  'properties.datetime',
  'properties.start_datetime',
  'properties.end_datetime',
  'properties.platform',
  'properties.constellation',
  'properties.instruments',
  'properties.sat:orbit_state',
  'properties.sat:relative_orbit',
  'properties.eo:cloud_cover',
  'properties.sar:polarizations',
  'properties.sar:product_type',
  'properties.created',
  'properties.updated',
]);

function failure(code, status = 502) {
  return Object.assign(new Error(code), { code, status });
}

function finiteNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw failure(`invalid_${field}`, 400);
  return number;
}

function parseBbox(value) {
  if (value == null || value === '') return undefined;
  const parts = String(value).split(',');
  if (parts.length !== 4) throw failure('invalid_bbox', 400);
  const bbox = parts.map((part) => finiteNumber(part.trim(), 'bbox'));
  if (
    bbox[0] < -180 ||
    bbox[0] > 180 ||
    bbox[2] < -180 ||
    bbox[2] > 180 ||
    bbox[1] < -90 ||
    bbox[1] > 90 ||
    bbox[3] < -90 ||
    bbox[3] > 90 ||
    bbox[0] > bbox[2] ||
    bbox[1] > bbox[3]
  )
    throw failure('invalid_bbox', 400);
  return bbox;
}

function canonicalTimestamp(value, field) {
  if (!ISO_PATTERN.test(value)) throw failure(`invalid_${field}`, 400);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw failure(`invalid_${field}`, 400);
  return new Date(parsed).toISOString();
}

function parseDatetime(value) {
  if (value == null || value === '') return undefined;
  const parts = String(value).split('/');
  if (parts.length !== 2) throw failure('invalid_datetime', 400);
  const start =
    parts[0] === '..' ? '..' : canonicalTimestamp(parts[0], 'datetime');
  const end =
    parts[1] === '..' ? '..' : canonicalTimestamp(parts[1], 'datetime');
  if (start !== '..' && end !== '..' && Date.parse(start) > Date.parse(end))
    throw failure('invalid_datetime', 400);
  return `${start}/${end}`;
}

function parseCollections(value) {
  if (value == null || value === '') return undefined;
  const collections = String(value)
    .split(',')
    .map((collection) => collection.trim())
    .filter(Boolean);
  if (
    collections.length === 0 ||
    collections.length > MAX_COLLECTIONS ||
    !collections.every((collection) => COLLECTION_PATTERN.test(collection))
  )
    throw failure('invalid_collections', 400);
  return [...new Set(collections)];
}

function parseLimit(value) {
  if (value == null || value === '') return 12;
  if (!/^\d+$/.test(String(value))) throw failure('invalid_limit', 400);
  const limit = Number(value);
  if (limit < 1 || limit > MAX_RESULTS) throw failure('invalid_limit', 400);
  return limit;
}

function parseCursor(value) {
  if (value == null || value === '') return undefined;
  const cursor = String(value);
  if (!CURSOR_PATTERN.test(cursor) || cursor.length > MAX_CURSOR_LENGTH)
    throw failure('invalid_cursor', 400);
  return cursor;
}

function parseQuery(url) {
  const query = new URL(url, 'http://localhost').searchParams;
  const allowed = new Set([
    'bbox',
    'datetime',
    'collections',
    'limit',
    'cursor',
  ]);
  for (const key of query.keys()) {
    if (!allowed.has(key)) throw failure('invalid_query', 400);
  }
  return {
    bbox: parseBbox(query.get('bbox')),
    datetime: parseDatetime(query.get('datetime')),
    collections: parseCollections(query.get('collections')),
    limit: parseLimit(query.get('limit')),
    cursor: parseCursor(query.get('cursor')),
  };
}

function queryKey(query) {
  return JSON.stringify(query);
}

function safeHttpsUrl(value) {
  if (typeof value !== 'string' || value.length > 2000) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function text(value, maxLength) {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, maxLength)
    : null;
}

function finiteArray(value, length) {
  return (
    Array.isArray(value) &&
    value.length === length &&
    value.every((entry) => Number.isFinite(Number(entry)))
  );
}

function normalizeBbox(value) {
  if (!finiteArray(value, 4) && !finiteArray(value, 6)) return null;
  const bbox = value.map(Number);
  const [west, south, east, north] = bbox;
  if (
    west < -180 ||
    west > 180 ||
    east < -180 ||
    east > 180 ||
    south < -90 ||
    south > 90 ||
    north < -90 ||
    north > 90 ||
    west > east ||
    south > north
  )
    return null;
  return bbox;
}

function normalizeGeometry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const geometry = {
    type: text(value.type, 32),
    coordinates: value.coordinates,
  };
  if (!geometry.type || !Array.isArray(geometry.coordinates)) return null;
  try {
    if (JSON.stringify(geometry).length > MAX_GEOMETRY_BYTES) return null;
  } catch {
    return null;
  }
  return geometry;
}

function normalizeLink(link) {
  if (!link || typeof link !== 'object') return null;
  const href = safeHttpsUrl(link.href);
  const rel = text(link.rel, 64);
  if (!href || !rel || rel === 'next') return null;
  return {
    rel,
    href,
    ...(text(link.type, 160) ? { type: text(link.type, 160) } : {}),
    ...(text(link.title, 240) ? { title: text(link.title, 240) } : {}),
  };
}

function normalizeAsset(asset) {
  if (!asset || typeof asset !== 'object') return null;
  const href = safeHttpsUrl(asset.href);
  if (!href) return null;
  return {
    href,
    ...(text(asset.title, 240) ? { title: text(asset.title, 240) } : {}),
    ...(text(asset.type, 160) ? { type: text(asset.type, 160) } : {}),
    ...(Array.isArray(asset.roles)
      ? {
          roles: asset.roles
            .filter((role) => typeof role === 'string')
            .slice(0, 8),
        }
      : {}),
  };
}

function normalizeItem(item, retrievedAt) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const id = text(item.id, 256);
  const properties = item.properties;
  if (!id || !properties || typeof properties !== 'object') return null;
  const datetimeMs = properties.datetime
    ? Date.parse(properties.datetime)
    : NaN;
  const datetime = Number.isFinite(datetimeMs)
    ? new Date(datetimeMs).toISOString()
    : null;
  if (!datetime) return null;
  const collection = Array.isArray(item.collection)
    ? item.collection.find((value) => typeof value === 'string')
    : typeof item.collection === 'string'
      ? item.collection
      : Array.isArray(item.collections)
        ? item.collections.find((value) => typeof value === 'string')
        : null;
  const geometry = normalizeGeometry(item.geometry);
  const bbox = normalizeBbox(item.bbox);
  if (!geometry && !bbox) return null;
  const links = Array.isArray(item.links)
    ? item.links.map(normalizeLink).filter(Boolean).slice(0, MAX_LINKS)
    : [];
  const assets =
    item.assets && typeof item.assets === 'object'
      ? Object.entries(item.assets)
          .slice(0, MAX_ASSETS)
          .map(([key, asset]) => {
            const normalized = normalizeAsset(asset);
            return normalized
              ? { key: key.slice(0, 120), ...normalized }
              : null;
          })
          .filter(Boolean)
      : [];
  const metadata = {
    platform: text(properties.platform, 120),
    constellation: text(properties.constellation, 120),
    orbitState: text(properties['sat:orbit_state'], 32),
    relativeOrbit: Number.isFinite(Number(properties['sat:relative_orbit']))
      ? Number(properties['sat:relative_orbit'])
      : null,
    cloudCover: Number.isFinite(Number(properties['eo:cloud_cover']))
      ? Number(properties['eo:cloud_cover'])
      : null,
    instruments: Array.isArray(properties.instruments)
      ? properties.instruments
          .filter((value) => typeof value === 'string')
          .slice(0, 8)
      : [],
    polarizations: Array.isArray(properties['sar:polarizations'])
      ? properties['sar:polarizations']
          .filter((value) => typeof value === 'string')
          .slice(0, 8)
      : [],
    productType: text(properties['sar:product_type'], 80),
    created: text(properties.created, 64),
    updated: text(properties.updated, 64),
  };
  const provenance = createProvenanceEnvelope({
    sourceId: SOURCE_ID,
    recordId: id,
    sourceUrl: SOURCE_URL,
    retrievedAt,
    eventTime: datetime,
    sourceVersion: 'stac-1.1.0',
    sourceType: 'observation',
    attribution: 'Copernicus Data Space Ecosystem',
    license:
      'Collection-specific Copernicus and contributing-mission terms apply',
  });
  return {
    id,
    collection: collection || null,
    datetime,
    bbox,
    geometry,
    metadata,
    links,
    assets,
    provenance,
  };
}

function nextCursor(payload) {
  if (!Array.isArray(payload?.links)) return null;
  const next = payload.links.find(
    (link) => link?.rel === 'next' && typeof link?.body?.token === 'string',
  );
  const token = next?.body?.token;
  return token &&
    CURSOR_PATTERN.test(token) &&
    token.length <= MAX_CURSOR_LENGTH
    ? token
    : null;
}

export function normalizeCopernicusSearch(payload, retrievedAt) {
  if (
    !payload ||
    payload.type !== 'FeatureCollection' ||
    !Array.isArray(payload.features)
  )
    throw failure('copernicus_schema_drift');
  if (payload.features.length > MAX_RESULTS)
    throw failure('copernicus_result_cap');
  const items = payload.features
    .map((item) => normalizeItem(item, retrievedAt))
    .filter(Boolean);
  return {
    items,
    skippedCount: payload.features.length - items.length,
    nextCursor: nextCursor(payload),
  };
}

function credentials() {
  const clientId = String(process.env.COPERNICUS_CLIENT_ID || '').trim();
  const clientSecret = String(
    process.env.COPERNICUS_CLIENT_SECRET || '',
  ).trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/**
 * Server-side Copernicus Data Space STAC metadata discovery proxy. It accepts
 * bounded filters, requests only STAC metadata, never follows asset links, and
 * optionally uses OAuth client credentials kept exclusively in the server
 * environment.
 * @param {{fetchImpl?: typeof fetch, now?: () => number}} [options]
 * @returns {import('vite').Plugin}
 */
export function copernicusStacProxy({
  fetchImpl = fetch,
  now = () => Date.now(),
} = {}) {
  const cache = new Map();
  let tokenCache = null;
  let tokenInflight = null;
  const allow = makeRateLimiter({ windowMs: 60_000, max: 12, globalMax: 48 });

  const response = (res, status, body, headers = {}) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    for (const [name, value] of Object.entries(headers))
      res.setHeader(name, value);
    res.end(JSON.stringify(body));
  };

  async function bearerToken() {
    const auth = credentials();
    if (!auth) return null;
    const current = now();
    if (tokenCache && tokenCache.expiresAtMs - current > 30_000)
      return tokenCache.value;
    if (!tokenInflight) {
      tokenInflight = (async () => {
        const body = new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: auth.clientId,
          client_secret: auth.clientSecret,
        });
        const upstream = await fetchImpl(TOKEN_URL, {
          method: 'POST',
          signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
          redirect: 'error',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body,
        });
        if (!upstream.ok) {
          await upstream.body?.cancel().catch(() => {});
          throw failure(
            upstream.status === 429
              ? 'copernicus_rate_limited'
              : 'copernicus_auth_unavailable',
            upstream.status === 429 ? 429 : 503,
          );
        }
        const payload = await readResponseJsonCapped(upstream, 64 * 1024);
        if (
          typeof payload?.access_token !== 'string' ||
          payload.access_token.length > 8192
        )
          throw failure('copernicus_auth_schema_drift', 503);
        const expiresIn = Number(payload.expires_in);
        tokenCache = {
          value: payload.access_token,
          expiresAtMs:
            now() +
            (Number.isFinite(expiresIn) && expiresIn > 0
              ? expiresIn * 1000
              : 9 * 60_000),
        };
        return tokenCache.value;
      })().finally(() => {
        tokenInflight = null;
      });
    }
    return tokenInflight;
  }

  async function fetchSearch(query) {
    const body = {
      ...(query.bbox ? { bbox: query.bbox } : {}),
      ...(query.datetime ? { datetime: query.datetime } : {}),
      ...(query.collections ? { collections: query.collections } : {}),
      limit: query.limit,
      ...(query.cursor ? { token: query.cursor } : {}),
      fields: { include: FIELDS },
    };
    const serialized = JSON.stringify(body);
    if (serialized.length > MAX_REQUEST_BODY_BYTES)
      throw failure('copernicus_request_too_large', 400);
    const token = await bearerToken();
    const headers = {
      Accept: 'application/geo+json, application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'gods-eye-view-copernicus-stac/1.0',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    const upstream = await fetchImpl(SEARCH_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: 'error',
      headers,
      body: serialized,
    });
    if (!upstream.ok) {
      const status = upstream.status;
      await upstream.body?.cancel().catch(() => {});
      throw failure(
        status === 429
          ? 'copernicus_rate_limited'
          : status === 401 || status === 403
            ? 'copernicus_unavailable'
            : 'copernicus_upstream_unavailable',
        status === 429 ? 429 : status === 401 || status === 403 ? 503 : 502,
      );
    }
    return readResponseJsonCapped(upstream, MAX_RESPONSE_BYTES);
  }

  async function getSnapshot(query) {
    const key = queryKey(query);
    const current = now();
    const previous = cache.get(key);
    if (previous && current - previous.fetchedAtMs <= CACHE_TTL_MS)
      return previous;
    try {
      const payload = await fetchSearch(query);
      const retrievedAt = new Date(now()).toISOString();
      const normalized = normalizeCopernicusSearch(payload, retrievedAt);
      const entry = {
        ...normalized,
        fetchedAt: retrievedAt,
        fetchedAtMs: Date.parse(retrievedAt),
        stale: false,
      };
      cache.delete(key);
      cache.set(key, entry);
      while (cache.size > MAX_CACHE_ENTRIES)
        cache.delete(cache.keys().next().value);
      return entry;
    } catch (error) {
      if (previous && current - previous.fetchedAtMs <= STALE_MAX_MS)
        return { ...previous, stale: true, error: 'upstream_unavailable' };
      throw error;
    }
  }

  const install = (server) => {
    server.middlewares.use('/api/copernicus/stac', async (req, res) => {
      if (req.method !== 'GET')
        return response(
          res,
          405,
          { error: 'method_not_allowed' },
          { Allow: 'GET' },
        );
      if (admitSameSiteKeyless(req, res)) return;
      const path = String(req.url || '/').split('?')[0];
      if (path === '/status')
        return response(res, 200, {
          configured: Boolean(credentials()),
          endpoint: STAC_ROOT,
          oauth: Boolean(credentials()),
          cacheEntries: cache.size,
        });
      if (path !== '/' && path !== '')
        return response(res, 404, { error: 'not_found' });
      if (!allow(clientKey(req)))
        return response(res, 429, { error: 'rate_limited' });
      try {
        const query = parseQuery(req.url || '/');
        const snapshot = await getSnapshot(query);
        const checkedAt = new Date(now()).toISOString();
        const health = classifySourceHealth({
          lastSuccessAt: snapshot.fetchedAt,
          checkedAt,
          staleAfterMs: STALE_AFTER_MS,
          available: true,
          partial: snapshot.skippedCount > 0,
        });
        return response(res, 200, {
          schemaVersion: 1,
          source: SOURCE_ID,
          endpoint: STAC_ROOT,
          checkedAt,
          retrievedAt: snapshot.fetchedAt,
          stale: snapshot.stale,
          status: snapshot.stale
            ? 'stale'
            : snapshot.skippedCount
              ? 'partial'
              : 'complete',
          health,
          query,
          items: snapshot.items,
          skippedCount: snapshot.skippedCount,
          nextCursor: snapshot.nextCursor,
          attribution: 'Copernicus Data Space Ecosystem',
          interpretation:
            'STAC metadata discovery only. Asset links are references; this endpoint does not download scenes or establish operational intent.',
          ...(snapshot.error ? { warning: snapshot.error } : {}),
        });
      } catch (error) {
        console.warn(
          '[copernicus-stac-proxy] request failed:',
          error?.code || 'upstream_error',
        );
        return response(
          res,
          error?.status === 429 ? 429 : error?.status === 400 ? 400 : 502,
          {
            error:
              error?.status === 400
                ? error.code
                : error?.status === 429
                  ? 'rate_limited'
                  : 'upstream_unavailable',
          },
        );
      }
    });
  };

  return {
    name: 'copernicus-stac-proxy',
    configureServer: install,
    configurePreviewServer: install,
  };
}

export { FIELDS, SEARCH_URL, STAC_ROOT, TOKEN_URL, parseQuery };
