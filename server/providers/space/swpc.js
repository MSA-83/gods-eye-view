import { readResponseJsonCapped } from '../common/http.js';
import { admitSameSiteKeyless } from '../common/same-site.js';
import {
  classifySourceHealth,
  createProvenanceEnvelope,
} from '../common/osintEvidence.js';

const BASE = 'https://services.swpc.noaa.gov';
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_ROWS = 240;
const PRODUCTS = Object.freeze({
  alerts: {
    path: '/products/alerts.json',
    ttlMs: 60_000,
    staleAfterMs: 900_000,
    kind: 'alerts',
  },
  kp: {
    path: '/products/noaa-planetary-k-index.json',
    ttlMs: 180_000,
    staleAfterMs: 32_400_000,
    kind: 'kp',
  },
  mag: {
    path: '/json/rtsw/rtsw_mag_1m.json',
    ttlMs: 60_000,
    staleAfterMs: 300_000,
    kind: 'mag',
  },
  wind: {
    path: '/json/rtsw/rtsw_wind_1m.json',
    ttlMs: 60_000,
    staleAfterMs: 300_000,
    kind: 'wind',
  },
});

function failure(code, status = 502) {
  return Object.assign(new Error(code), { code, status });
}

/** SWPC timestamps are UTC; accept its space-separated form and ISO Z. */
function validTime(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.includes(' ')
    ? value.replace(' ', 'T') + 'Z'
    : value;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(normalized))
    return null;
  const date = new Date(normalized);
  if (!Number.isFinite(date.getTime())) return null;
  const canonical = date.toISOString();
  return canonical.replace('.000Z', 'Z') === normalized.replace('.000Z', 'Z')
    ? canonical
    : null;
}

function numeric(value, { nullable = false } = {}) {
  if (nullable && (value === null || value === '')) return null;
  if (typeof value !== 'number' && typeof value !== 'string')
    throw failure('swpc_schema_drift');
  if (typeof value === 'string' && !/^-?\d+(?:\.\d+)?$/.test(value.trim()))
    throw failure('swpc_schema_drift');
  const result = Number(value);
  if (!Number.isFinite(result)) throw failure('swpc_schema_drift');
  return result;
}

/** Accept current object rows and legacy header/value arrays for fixtures. */
function objectRows(payload) {
  if (
    !Array.isArray(payload) ||
    payload.length === 0 ||
    payload.length > 20_000
  )
    throw failure('swpc_invalid_payload');
  if (Array.isArray(payload[0])) {
    const headers = payload[0];
    if (
      !headers.every((key) => typeof key === 'string') ||
      !headers.includes('time_tag')
    )
      throw failure('swpc_schema_drift');
    return payload.slice(1).map((values) => {
      if (!Array.isArray(values) || values.length !== headers.length)
        throw failure('swpc_schema_drift');
      return Object.fromEntries(
        headers.map((key, index) => [key, values[index]]),
      );
    });
  }
  if (
    !payload.every(
      (row) => row && typeof row === 'object' && !Array.isArray(row),
    )
  )
    throw failure('swpc_schema_drift');
  return payload;
}

function normalizeRows(kind, payload) {
  if (kind === 'alerts') {
    if (
      !Array.isArray(payload) ||
      payload.length > 500 ||
      !payload.every(
        (row) => row && typeof row === 'object' && !Array.isArray(row),
      )
    )
      throw failure('swpc_schema_drift');
    return payload.slice(0, 100).map((row) => ({
      product_id:
        typeof row.product_id === 'string'
          ? row.product_id.slice(0, 120)
          : null,
      issue_datetime: validTime(row.issue_datetime),
      message:
        typeof row.message === 'string' ? row.message.slice(0, 4000) : null,
      url:
        typeof row.url === 'string' && row.url.startsWith('https://')
          ? row.url.slice(0, 1000)
          : null,
    }));
  }
  return objectRows(payload)
    .slice(-MAX_ROWS)
    .map((row) => {
      const time_tag = validTime(row.time_tag);
      if (!time_tag) throw failure('swpc_schema_drift');
      if (kind === 'kp') {
        const kp = numeric(
          row.kp_index ?? row.Kp ?? row.kp ?? row.estimated_kp,
        );
        if (kp < 0 || kp > 9) throw failure('swpc_schema_drift');
        return { time_tag, kp_index: kp };
      }
      if (kind === 'mag') {
        if (!('bz_gsm' in row) || !('bt' in row))
          throw failure('swpc_schema_drift');
        return {
          time_tag,
          bz_gsm: numeric(row.bz_gsm, { nullable: true }),
          bt: numeric(row.bt, { nullable: true }),
          source:
            typeof row.source === 'string' ? row.source.slice(0, 80) : null,
          active: typeof row.active === 'boolean' ? row.active : null,
        };
      }
      if (kind === 'wind') {
        for (const field of [
          'proton_speed',
          'proton_density',
          'proton_temperature',
        ]) {
          if (!(field in row)) throw failure('swpc_schema_drift');
        }
        return {
          time_tag,
          proton_speed: numeric(row.proton_speed, { nullable: true }),
          proton_density: numeric(row.proton_density, { nullable: true }),
          proton_temperature: numeric(row.proton_temperature, {
            nullable: true,
          }),
          source:
            typeof row.source === 'string' ? row.source.slice(0, 80) : null,
          active: typeof row.active === 'boolean' ? row.active : null,
        };
      }
      throw failure('swpc_unknown_product');
    });
}

export function normalizeSwpcProduct(product, payload) {
  const spec = PRODUCTS[product];
  if (!spec) throw failure('swpc_unknown_product', 400);
  return normalizeRows(spec.kind, payload);
}

/**
 * Read-only NOAA SWPC adapter using the replacement RTSW endpoints from 2026.
 */
export function swpcProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
} = {}) {
  const cache = new Map();
  const inFlight = new Map();

  async function acquire(product) {
    const spec = PRODUCTS[product];
    const previous = cache.get(product);
    if (previous && now() - previous.fetchedAtMs < spec.ttlMs)
      return { ...previous, stale: false, partial: false };
    if (!inFlight.has(product)) {
      const work = (async () => {
        const sourceUrl = new URL(spec.path, BASE).toString();
        const response = await fetchImpl(sourceUrl, {
          signal: AbortSignal.timeout(12_000),
          redirect: 'error',
          headers: {
            Accept: 'application/json',
            'User-Agent': 'gods-eye-view-swpc/1.0',
          },
        });
        if (!response.ok) {
          const status = response.status;
          await response.body?.cancel();
          throw failure(
            status === 429 ? 'swpc_rate_limited' : 'swpc_upstream_unavailable',
            status === 429 ? 429 : 502,
          );
        }
        const payload = await readResponseJsonCapped(
          response,
          MAX_RESPONSE_BYTES,
        );
        const rows = normalizeRows(spec.kind, payload);
        const fetchedAtMs = now();
        const fetchedAt = new Date(fetchedAtMs).toISOString();
        const latest = rows.reduce((latestTime, row) => {
          const candidate = row.time_tag ?? row.issue_datetime;
          return candidate &&
            (!latestTime || Date.parse(candidate) > Date.parse(latestTime))
            ? candidate
            : latestTime;
        }, null);
        const provenance = createProvenanceEnvelope({
          sourceId: 'noaa-swpc',
          recordId: product,
          sourceUrl,
          retrievedAt: fetchedAt,
          eventTime: latest,
          sourceVersion: 'swpc-operational-json-2026',
          sourceType: 'observation',
          attribution: 'NOAA Space Weather Prediction Center',
          license:
            'U.S. Government data; preserve NOAA attribution and notices',
        });
        const entry = { rows, fetchedAt, fetchedAtMs, latest, provenance };
        cache.set(product, entry);
        return entry;
      })();
      inFlight.set(product, work);
      work
        .finally(() => {
          if (inFlight.get(product) === work) inFlight.delete(product);
        })
        .catch(() => {});
    }
    try {
      const entry = await inFlight.get(product);
      return { ...entry, stale: false, partial: false };
    } catch (error) {
      if (previous)
        return {
          ...previous,
          stale: true,
          partial: true,
          error: error.code ?? 'swpc_unavailable',
        };
      throw error;
    }
  }

  async function handler(req, res) {
    const send = (status, body) => {
      if (res.destroyed || res.headersSent) return;
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        ...(status === 405 ? { Allow: 'GET' } : {}),
        ...(status === 429 ? { 'Retry-After': '60' } : {}),
      });
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'GET') return send(405, { error: 'method_not_allowed' });
    if (req.url !== '/' && req.url !== '')
      return send(400, { error: 'invalid_query' });
    const results = await Promise.all(
      Object.keys(PRODUCTS).map(async (product) => {
        try {
          const entry = await acquire(product);
          const checkedAt = new Date(now()).toISOString();
          return [
            product,
            {
              data: entry.rows,
              latest: entry.latest,
              retrievedAt: entry.fetchedAt,
              provenance: entry.provenance,
              health: classifySourceHealth({
                lastSuccessAt: entry.fetchedAt,
                checkedAt,
                staleAfterMs: PRODUCTS[product].staleAfterMs,
                available: true,
                partial: entry.partial,
              }),
              ...(entry.stale
                ? { stale: true, warning: entry.error ?? 'cached_data' }
                : {}),
            },
          ];
        } catch (error) {
          const checkedAt = new Date(now()).toISOString();
          return [
            product,
            {
              data: [],
              latest: null,
              provenance: null,
              health: classifySourceHealth({
                checkedAt,
                staleAfterMs: PRODUCTS[product].staleAfterMs,
                available: false,
              }),
              error: error.code ?? 'swpc_unavailable',
            },
          ];
        }
      }),
    );
    const checkedAt = new Date(now()).toISOString();
    const sources = Object.fromEntries(results);
    const available = results.filter(
      ([, value]) => value.health.status !== 'unavailable',
    ).length;
    send(available ? 200 : 503, {
      schemaVersion: 1,
      source: 'NOAA SWPC',
      attribution: 'NOAA Space Weather Prediction Center',
      checkedAt,
      status:
        available === results.length
          ? 'complete'
          : available
            ? 'partial'
            : 'unavailable',
      sources,
      interpretation:
        'Space-weather context only. These observations do not establish the cause of GNSS degradation or intentional interference.',
    });
  }

  const install = ({ middlewares }) => {
    middlewares.use('/api/space-weather', (req, res) => {
      if (admitSameSiteKeyless(req, res)) return;
      return handler(req, res);
    });
  };
  return {
    name: 'noaa-swpc-proxy',
    configureServer: install,
    configurePreviewServer: install,
  };
}
