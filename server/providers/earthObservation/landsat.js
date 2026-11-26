import { readResponseJsonCapped } from '../common/http.js';
import { makeRateLimiter, clientKey } from '../common/rate-limit.js';
import { admitSameSiteKeyless } from '../common/same-site.js';
import {
  classifySourceHealth,
  createProvenanceEnvelope,
} from '../common/osintEvidence.js';

const STAC_ROOT = 'https://landsatlook.usgs.gov/stac-server';
const SEARCH_URL = `${STAC_ROOT}/search`;
const SOURCE_URL = `${STAC_ROOT}/`;
const SOURCE_ID = 'usgs-landsat-stac';
const MAX_RESPONSE_BYTES = 6 * 1024 * 1024;
const MAX_REQUEST_URL_BYTES = 8 * 1024;
const MAX_RESULTS = 50;
const MAX_COLLECTIONS = 3;
const MAX_CURSOR_LENGTH = 512;
const REQUEST_TIMEOUT_MS = 20_000;
const CACHE_TTL_MS = 5 * 60_000;
const STALE_MAX_MS = 30 * 60_000;
const MAX_CACHE_ENTRIES = 64;
const STALE_AFTER_MS = 15 * 60_000;
const MAX_GEOMETRY_BYTES = 180_000;
const MAX_LINKS = 24;
const MAX_ASSETS = 40;
const COLLECTION_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const CURSOR_PATTERN = /^[A-Za-z0-9:,.+_/%=-]{1,512}$/;
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
  'properties.landsat:scene_id',
  'properties.landsat:collection_category',
  'properties.landsat:collection_number',
  'properties.landsat:correction',
  'properties.landsat:cloud_cover_land',
  'properties.landsat:wrs_type',
  'properties.landsat:wrs_path',
  'properties.landsat:wrs_row',
  'properties.proj:epsg',
  'properties.instruments',
  'properties.view:sun_azimuth',
  'properties.view:sun_elevation',
  'properties.view:off_nadir',
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
    landsatSceneId: text(properties['landsat:scene_id'], 80),
    collectionCategory: text(properties['landsat:collection_category'], 16),
    collectionNumber: text(properties['landsat:collection_number'], 16),
    correction: text(properties['landsat:correction'], 16),
    cloudCoverLand: Number.isFinite(
      Number(properties['landsat:cloud_cover_land']),
    )
      ? Number(properties['landsat:cloud_cover_land'])
      : null,
    wrsType: text(properties['landsat:wrs_type'], 8),
    wrsPath: text(properties['landsat:wrs_path'], 8),
    wrsRow: text(properties['landsat:wrs_row'], 8),
    sunAzimuth: Number.isFinite(Number(properties['view:sun_azimuth']))
      ? Number(properties['view:sun_azimuth'])
      : null,
    sunElevation: Number.isFinite(Number(properties['view:sun_elevation']))
      ? Number(properties['view:sun_elevation'])
      : null,
    offNadir: Number.isFinite(Number(properties['view:off_nadir']))
      ? Number(properties['view:off_nadir'])
      : null,
    instruments: Array.isArray(properties.instruments)
      ? properties.instruments
          .filter((value) => typeof value === 'string')
          .slice(0, 8)
      : [],
    epsg: Number.isFinite(Number(properties['proj:epsg']))
      ? Number(properties['proj:epsg'])
      : null,
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
    attribution: 'USGS Landsat Collection 2',
    license: 'USGS Landsat data are public domain; AWS access terms may apply',
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
    (link) => link?.rel === 'next' && typeof link?.href === 'string',
  );
  if (!next?.href) return null;
  try {
    const url = new URL(next.href);
    if (
      url.origin !== new URL(STAC_ROOT).origin ||
      url.pathname !== '/stac-server/search'
    )
      return null;
    const token = url.searchParams.get('next');
    return token &&
      CURSOR_PATTERN.test(token) &&
      token.length <= MAX_CURSOR_LENGTH
      ? token
      : null;
  } catch {
    return null;
  }
}

export function normalizeLandsatSearch(payload, retrievedAt) {
  if (
    !payload ||
    payload.type !== 'FeatureCollection' ||
    !Array.isArray(payload.features)
  )
    throw failure('landsat_schema_drift');
  if (payload.features.length > MAX_RESULTS)
    throw failure('landsat_result_cap');
  const items = payload.features
    .map((item) => normalizeItem(item, retrievedAt))
    .filter(Boolean);
  return {
    items,
    skippedCount: payload.features.length - items.length,
    nextCursor: nextCursor(payload),
  };
}

/**
 * Server-side USGS LandsatLook STAC metadata discovery proxy. The public
 * catalog is queried with bounded filters; asset links are never followed.
 * @param {{fetchImpl?: typeof fetch, now?: () => number}} [options]
 * @returns {import('vite').Plugin}
 */
export function usgsLandsatStacProxy({
  fetchImpl = fetch,
  now = () => Date.now(),
} = {}) {
  const cache = new Map();
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

  async function fetchSearch(query) {
    const params = new URLSearchParams();
    if (query.bbox) params.set('bbox', query.bbox.join(','));
    if (query.datetime) params.set('datetime', query.datetime);
    if (query.collections)
      params.set('collections', query.collections.join(','));
    params.set('limit', String(query.limit));
    if (query.cursor) params.set('next', query.cursor);
    params.set('fields', FIELDS.join(','));
    const requestUrl = `${SEARCH_URL}?${params}`;
    if (requestUrl.length > MAX_REQUEST_URL_BYTES)
      throw failure('landsat_request_too_large', 400);
    const upstream = await fetchImpl(requestUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: 'error',
      headers: {
        Accept: 'application/geo+json, application/json',
        'User-Agent': 'gods-eye-view-usgs-landsat-stac/1.0',
      },
    });
    if (!upstream.ok) {
      const status = upstream.status;
      await upstream.body?.cancel().catch(() => {});
      throw failure(
        status === 429
          ? 'landsat_rate_limited'
          : status === 401 || status === 403
            ? 'landsat_unavailable'
            : 'landsat_upstream_unavailable',
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
      const normalized = normalizeLandsatSearch(payload, retrievedAt);
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
    server.middlewares.use('/api/landsat/stac', async (req, res) => {
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
          configured: true,
          endpoint: STAC_ROOT,
          oauth: false,
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
          attribution: 'USGS Landsat Collection 2',
          interpretation:
            'STAC metadata discovery only. Asset links are references; this endpoint does not download scenes or establish operational intent.',
          ...(snapshot.error ? { warning: snapshot.error } : {}),
        });
      } catch (error) {
        console.warn(
          '[landsat-stac-proxy] request failed:',
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
    name: 'landsat-stac-proxy',
    configureServer: install,
    configurePreviewServer: install,
  };
}

export { FIELDS, SEARCH_URL, STAC_ROOT, parseQuery };
