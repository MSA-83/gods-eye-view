import { readResponseJsonCapped } from '../common/http.js';
import { admitSameSiteKeyless } from '../common/same-site.js';
import { clientKey, makeRateLimiter } from '../common/rate-limit.js';
import {
  classifySourceHealth,
  createProvenanceEnvelope,
} from '../common/osintEvidence.js';

const API_BASE = 'https://ucdpapi.pcr.uu.se';
const DATASET_VERSION = '26.1';
const DATASET_START = '1989-01-01';
const DATASET_END = '2025-12-31';
const PAGE_SIZE = 100;
const MAX_WINDOW_DAYS = 31;
const CACHE_TTL_MS = 24 * 60 * 60_000;
const STALE_CACHE_MS = 7 * 24 * 60 * 60_000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 256;
const MAX_DAILY_REQUESTS = 4_500;
const LOCATION_PRECISION = Object.freeze({
  1: 'exact-location',
  2: 'within-25-km',
  3: 'administrative-level-2',
  4: 'administrative-level-1',
  5: 'linear-or-fuzzy-area',
  6: 'country-only',
  7: 'international-waters-or-airspace',
});
const DATE_PRECISION = Object.freeze({
  1: 'exact-day',
  2: 'two-to-six-day-range',
  3: 'week-only',
  4: 'eight-to-thirty-day-range-or-month',
  5: 'longer-than-month-up-to-one-year',
});

function failure(code, status = 502, retryAfterAt = null) {
  return Object.assign(new Error(code), { code, status, retryAfterAt });
}

function dateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
    ? value
    : null;
}

function integer(
  value,
  { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {},
) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw failure('ucdp_schema_drift');
  }
  if (typeof value === 'string' && !/^-?\d+$/.test(value.trim())) {
    throw failure('ucdp_schema_drift');
  }
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < min || result > max) {
    throw failure('ucdp_schema_drift');
  }
  return result;
}

function numeric(
  value,
  { min = -Number.MAX_VALUE, max = Number.MAX_VALUE } = {},
) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw failure('ucdp_schema_drift');
  }
  if (typeof value === 'string' && !/^-?\d+(?:\.\d+)?$/.test(value.trim())) {
    throw failure('ucdp_schema_drift');
  }
  const result = Number(value);
  if (!Number.isFinite(result) || result < min || result > max) {
    throw failure('ucdp_schema_drift');
  }
  return result;
}

function text(value, maxLength = 8_000) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw failure('ucdp_schema_drift');
  if (value.length > maxLength) throw failure('ucdp_field_too_large');
  return value;
}

function parseList(value, { min, maxItems, maxValue, allowed } = {}) {
  if (!value) return null;
  const items = value.split(',').map((part) => part.trim());
  if (
    items.length > maxItems ||
    items.some((part) => !/^\d+$/.test(part)) ||
    new Set(items).size !== items.length
  ) {
    throw failure('ucdp_invalid_filter', 400);
  }
  const values = items.map(Number);
  if (values.some((item) => item < min || item > maxValue)) {
    throw failure('ucdp_invalid_filter', 400);
  }
  if (allowed && values.some((item) => !allowed.includes(item))) {
    throw failure('ucdp_invalid_filter', 400);
  }
  return values;
}

export function buildUcdpRequest(requestUrl) {
  const url =
    requestUrl instanceof URL
      ? requestUrl
      : new URL(requestUrl, 'http://localhost');
  const allowedParams = new Set([
    'startDate',
    'endDate',
    'page',
    'country',
    'type',
  ]);
  for (const key of url.searchParams.keys()) {
    if (!allowedParams.has(key)) throw failure('ucdp_invalid_query', 400);
  }

  const startDate = dateOnly(url.searchParams.get('startDate'));
  const endDate = dateOnly(url.searchParams.get('endDate'));
  if (!startDate || !endDate) throw failure('ucdp_date_range_required', 400);
  if (
    startDate < DATASET_START ||
    endDate > DATASET_END ||
    startDate > endDate
  ) {
    throw failure('ucdp_date_range_out_of_coverage', 400);
  }
  const days =
    (Date.parse(`${endDate}T00:00:00Z`) -
      Date.parse(`${startDate}T00:00:00Z`)) /
    86_400_000;
  if (days >= MAX_WINDOW_DAYS) {
    throw failure('ucdp_date_window_too_large', 400);
  }

  const pageValue = url.searchParams.get('page') ?? '1';
  const page = integer(pageValue, { min: 1, max: 5_000 });
  if (!page) throw failure('ucdp_invalid_page', 400);
  const countries = parseList(url.searchParams.get('country'), {
    min: 1,
    maxItems: 8,
    maxValue: 999,
  });
  const types = parseList(url.searchParams.get('type'), {
    min: 1,
    maxItems: 3,
    maxValue: 3,
    allowed: [1, 2, 3],
  });

  const upstream = new URL(`/api/gedevents/${DATASET_VERSION}`, API_BASE);
  upstream.searchParams.set('pagesize', String(PAGE_SIZE));
  upstream.searchParams.set('page', String(page));
  upstream.searchParams.set('StartDate', startDate);
  upstream.searchParams.set('EndDate', endDate);
  if (countries) upstream.searchParams.set('Country', countries.join(','));
  if (types) upstream.searchParams.set('TypeOfViolence', types.join(','));

  return {
    page,
    pageSize: PAGE_SIZE,
    startDate,
    endDate,
    countries,
    types,
    upstreamUrl: upstream.toString(),
  };
}

export function normalizeUcdpEvent(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw failure('ucdp_schema_drift');
  }
  const id = integer(row.id, { min: 1 });
  const year = integer(row.year, { min: 1989, max: 2025 });
  const typeOfViolence = integer(row.type_of_violence, { min: 1, max: 3 });
  const dateStart = dateOnly(row.date_start);
  const dateEnd = dateOnly(row.date_end);
  const datePrecision = integer(row.date_prec, { min: 1, max: 5 });
  const wherePrecision = integer(row.where_prec, { min: 1, max: 7 });
  if (
    !id ||
    !year ||
    !typeOfViolence ||
    !dateStart ||
    !dateEnd ||
    dateStart > dateEnd ||
    !datePrecision ||
    !wherePrecision
  ) {
    throw failure('ucdp_schema_drift');
  }

  const latitude = numeric(row.latitude, { min: -90, max: 90 });
  const longitude = numeric(row.longitude, { min: -180, max: 180 });
  if ((latitude === null) !== (longitude === null)) {
    throw failure('ucdp_schema_drift');
  }

  const fatalities = {
    sideA: integer(row.deaths_a, { min: 0 }),
    sideB: integer(row.deaths_b, { min: 0 }),
    civilians: integer(row.deaths_civilians, { min: 0 }),
    unknownStatus: integer(row.deaths_unknown, { min: 0 }),
    low: integer(row.low, { min: 0 }),
    best: integer(row.best, { min: 0 }),
    high: integer(row.high, { min: 0 }),
  };
  if (
    fatalities.low !== null &&
    fatalities.best !== null &&
    fatalities.high !== null &&
    !(fatalities.low <= fatalities.best && fatalities.best <= fatalities.high)
  ) {
    throw failure('ucdp_fatality_range_invalid');
  }

  const activeYear =
    row.active_year === true ||
    row.active_year === 1 ||
    row.active_year === '1';
  if (
    row.active_year !== true &&
    row.active_year !== false &&
    row.active_year !== 0 &&
    row.active_year !== 1 &&
    row.active_year !== '0' &&
    row.active_year !== '1'
  ) {
    throw failure('ucdp_schema_drift');
  }

  const event = {
    id,
    relid: text(row.relid, 160),
    year,
    activeYear,
    codeStatus: text(row.code_status, 40),
    typeOfViolence,
    conflict: {
      id: integer(row.conflict_new_id, { min: 1 }),
      name: text(row.conflict_name, 2_000),
    },
    dyad: {
      id: integer(row.dyad_new_id, { min: 1 }),
      name: text(row.dyad_name, 2_000),
    },
    actors: {
      sideAId: integer(row.side_a_new_id, { min: 1 }),
      sideA: text(row.side_a, 2_000),
      sideBId: integer(row.side_b_new_id, { min: 1 }),
      sideB: text(row.side_b, 2_000),
      sideAGwno: text(row.gwnoa, 80),
      sideBGwno: text(row.gwnob, 80),
    },
    location: {
      country: text(row.country, 200),
      countryId: integer(row.country_id, { min: 1 }),
      region: text(row.region, 80),
      name: text(row.where_coordinates, 2_000),
      description: text(row.where_description, 4_000),
      admin1: text(row.adm_1, 500),
      admin2: text(row.adm_2, 500),
      latitude,
      longitude,
      precision: wherePrecision,
      precisionLabel: LOCATION_PRECISION[wherePrecision],
    },
    time: {
      start: dateStart,
      end: dateEnd,
      precision: datePrecision,
      precisionLabel: DATE_PRECISION[datePrecision],
    },
    eventClarity: integer(row.event_clarity, { min: 1, max: 2 }),
    fatalities,
    source: {
      numberOfSources: integer(row.number_of_sources, { min: -1 }),
      articleReferences: text(row.source_article, 20_000),
      office: text(row.source_office, 1_000),
      date: text(row.source_date, 80),
      headline: text(row.source_headline, 4_000),
      original: text(row.source_original, 2_000),
    },
  };
  return event;
}

export function normalizeUcdpPage(payload, { requestUrl, retrievedAt, page }) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw failure('ucdp_invalid_payload');
  }
  const totalCount = integer(payload.TotalCount, { min: 0 });
  const totalPages = integer(payload.TotalPages, { min: 0 });
  if (
    totalCount === null ||
    totalPages === null ||
    !Array.isArray(payload.Result) ||
    payload.Result.length > PAGE_SIZE
  ) {
    throw failure('ucdp_schema_drift');
  }
  const events = payload.Result.map((row) => {
    const event = normalizeUcdpEvent(row);
    const provenance = createProvenanceEnvelope({
      sourceId: 'ucdp-ged',
      recordId: String(event.id),
      sourceUrl: requestUrl,
      retrievedAt,
      sourceVersion: `GED ${DATASET_VERSION}`,
      sourceType: 'context',
      license: 'CC BY 4.0',
      attribution: 'Uppsala Conflict Data Program, Uppsala University',
    });
    return { ...event, provenance };
  });
  return { page, pageSize: PAGE_SIZE, totalCount, totalPages, events };
}

export function ucdpGedProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  getToken = () => process.env.UCDP_API_TOKEN,
  now = () => Date.now(),
} = {}) {
  const cache = new Map();
  const inFlight = new Map();
  const requestTimes = [];
  const rateLimit = makeRateLimiter({
    windowMs: 60_000,
    max: 4,
    globalMax: 80,
  });

  function reserveDailyRequest(nowMs) {
    const cutoff = nowMs - 86_400_000;
    while (requestTimes.length && requestTimes[0] <= cutoff) {
      requestTimes.shift();
    }
    if (requestTimes.length >= MAX_DAILY_REQUESTS) {
      return requestTimes[0] + 86_400_000;
    }
    requestTimes.push(nowMs);
    return null;
  }

  async function acquire(request) {
    const key = request.upstreamUrl;
    const previous = cache.get(key);
    if (previous && now() - previous.fetchedAtMs < CACHE_TTL_MS) {
      return { ...previous, stale: false, partial: false };
    }
    if (!inFlight.has(key)) {
      const work = (async () => {
        const token = String(getToken() ?? '').trim();
        if (!token) throw failure('ucdp_token_required', 503);
        const currentTime = now();
        const retryAt = reserveDailyRequest(currentTime);
        if (retryAt) {
          throw failure(
            'ucdp_daily_request_budget_reached',
            429,
            new Date(retryAt).toISOString(),
          );
        }
        const response = await fetchImpl(request.upstreamUrl, {
          signal: AbortSignal.timeout(15_000),
          redirect: 'error',
          headers: {
            Accept: 'application/json',
            'User-Agent': 'gods-eye-view-ucdp/1.0',
            'x-ucdp-access-token': token,
          },
        });
        if (!response.ok) {
          const status = response.status;
          await response.body?.cancel();
          if (status === 401 || status === 403) {
            throw failure('ucdp_token_rejected', 503);
          }
          if (status === 429) {
            throw failure(
              'ucdp_upstream_rate_limited',
              429,
              new Date(now() + 60_000).toISOString(),
            );
          }
          throw failure('ucdp_upstream_unavailable', 502);
        }
        const payload = await readResponseJsonCapped(
          response,
          MAX_RESPONSE_BYTES,
        );
        const fetchedAtMs = now();
        const fetchedAt = new Date(fetchedAtMs).toISOString();
        const normalized = normalizeUcdpPage(payload, {
          requestUrl: request.upstreamUrl,
          retrievedAt: fetchedAt,
          page: request.page,
        });
        const entry = { ...normalized, fetchedAt, fetchedAtMs };
        cache.set(key, entry);
        if (cache.size > MAX_CACHE_ENTRIES) {
          const oldest = [...cache.entries()].sort(
            (a, b) => a[1].fetchedAtMs - b[1].fetchedAtMs,
          )[0];
          if (oldest) cache.delete(oldest[0]);
        }
        return entry;
      })();
      inFlight.set(key, work);
      work
        .finally(() => {
          if (inFlight.get(key) === work) inFlight.delete(key);
        })
        .catch(() => {});
    }
    try {
      return { ...(await inFlight.get(key)), stale: false, partial: false };
    } catch (error) {
      if (previous && now() - previous.fetchedAtMs < STALE_CACHE_MS) {
        return {
          ...previous,
          stale: true,
          partial: true,
          error: error.code ?? 'ucdp_unavailable',
          retryAfterAt: error.retryAfterAt ?? null,
        };
      }
      throw error;
    }
  }

  async function handler(req, res) {
    const send = (status, body, retryAfterSeconds = null) => {
      if (res.destroyed || res.headersSent) return;
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        ...(retryAfterSeconds
          ? { 'Retry-After': String(retryAfterSeconds) }
          : {}),
      });
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'GET') {
      return send(405, { error: 'method_not_allowed' });
    }
    let request;
    try {
      request = buildUcdpRequest(new URL(req.url, 'http://localhost'));
    } catch (error) {
      return send(error.status ?? 400, {
        error: error.code ?? 'invalid_query',
      });
    }
    if (!rateLimit(clientKey(req))) {
      return send(429, { error: 'ucdp_local_rate_limited' }, 60);
    }

    try {
      const entry = await acquire(request);
      const checkedAt = new Date(now()).toISOString();
      const health = classifySourceHealth({
        lastSuccessAt: entry.fetchedAt,
        checkedAt,
        staleAfterMs: STALE_CACHE_MS,
        available: true,
        partial: entry.partial,
        retryAfterAt: entry.retryAfterAt,
      });
      return send(200, {
        schemaVersion: 1,
        dataset: 'UCDP Georeferenced Event Dataset',
        datasetVersion: DATASET_VERSION,
        coverage: { start: DATASET_START, end: DATASET_END },
        retrievedAt: entry.fetchedAt,
        checkedAt,
        health,
        pagination: {
          page: entry.page,
          pageSize: entry.pageSize,
          totalCount: entry.totalCount,
          totalPages: entry.totalPages,
        },
        events: entry.events,
        interpretation: [
          'UCDP GED is a versioned dataset of organized lethal violence, not a real-time incident feed.',
          'Preserve date and location precision and the low/best/high fatality estimates; do not infer intent or current operational status.',
        ].join(' '),
        ...(entry.stale
          ? { warning: entry.error ?? 'cached_data', stale: true }
          : {}),
      });
    } catch (error) {
      const checkedAt = new Date(now()).toISOString();
      const retryAfterAt = error.retryAfterAt ?? null;
      const health = classifySourceHealth({
        checkedAt,
        staleAfterMs: STALE_CACHE_MS,
        available: false,
        retryAfterAt,
      });
      return send(
        error.status ?? 502,
        {
          error: error.code ?? 'ucdp_unavailable',
          ...(error.code === 'ucdp_token_required'
            ? {
                setup:
                  'Set UCDP_API_TOKEN on the server; never expose it to the browser.',
              }
            : {}),
          health,
        },
        retryAfterAt
          ? Math.max(
              1,
              Math.ceil(
                (Date.parse(retryAfterAt) - Date.parse(checkedAt)) / 1000,
              ),
            )
          : null,
      );
    }
  }

  const install = ({ middlewares }) => {
    middlewares.use('/api/conflict-events/ucdp', (req, res) => {
      if (admitSameSiteKeyless(req, res)) return;
      return handler(req, res);
    });
  };
  return {
    name: 'ucdp-ged-proxy',
    configureServer: install,
    configurePreviewServer: install,
  };
}
