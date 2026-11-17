const SOURCE_HEALTH_STATES = Object.freeze([
  'fresh',
  'stale',
  'partial',
  'unavailable',
  'rate_limited',
]);

const ISO_WITH_ZONE =
  /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00))$/;
const SOURCE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SECRET_QUERY_KEYS = new Set([
  'key',
  'apikey',
  'xapikey',
  'subscriptionkey',
  'token',
  'accesstoken',
  'authtoken',
  'auth',
  'authorization',
  'clientsecret',
  'secret',
  'password',
  'sig',
  'signature',
  'bearer',
  'credential',
  'credentials',
]);
const ENVELOPE_KEYS = new Set([
  'sourceId',
  'recordId',
  'sourceUrl',
  'retrievedAt',
  'eventTime',
  'publishedAt',
  'sourceVersion',
  'sourceType',
  'license',
  'attribution',
  'rawSha256',
]);

function timestamp(value, field, { optional = false } = {}) {
  if (value == null && optional) return null;
  const match = typeof value === 'string' ? ISO_WITH_ZONE.exec(value) : null;
  const year = match ? Number(match[1]) : 0;
  const month = match ? Number(match[2]) : 0;
  const day = match ? Number(match[3]) : 0;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  if (
    !match ||
    day > daysInMonth[month - 1] ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new TypeError(
      `${field} must be an ISO-8601 timestamp with a timezone`,
    );
  }
  return new Date(value).toISOString();
}

function optionalText(value, field, maxLength = 512) {
  if (value == null) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new TypeError(
      `${field} must be a non-empty string up to ${maxLength} characters`,
    );
  }
  return value.trim();
}

/**
 * Validate a source-attributed envelope without performing network or storage I/O.
 * Secrets must never be included in the URL or any envelope field.
 */
export function createProvenanceEnvelope(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('provenance envelope must be an object');
  }
  for (const key of Object.keys(input)) {
    if (!ENVELOPE_KEYS.has(key)) {
      throw new TypeError(`unknown provenance field: ${key}`);
    }
  }
  if (typeof input.sourceId !== 'string' || !SOURCE_ID.test(input.sourceId)) {
    throw new TypeError('sourceId must be a stable kebab-case identifier');
  }

  let sourceUrl;
  try {
    sourceUrl = new URL(input.sourceUrl);
  } catch {
    throw new TypeError('sourceUrl must be a valid HTTPS URL');
  }
  if (
    sourceUrl.protocol !== 'https:' ||
    sourceUrl.username ||
    sourceUrl.password ||
    [...sourceUrl.searchParams.keys()].some((key) => {
      const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      return (
        SECRET_QUERY_KEYS.has(normalized) ||
        normalized.endsWith('apikey') ||
        normalized.endsWith('subscriptionkey')
      );
    })
  ) {
    throw new TypeError(
      'sourceUrl must not contain credentials or secret query parameters',
    );
  }
  sourceUrl.hash = '';

  const retrievedAt = timestamp(input.retrievedAt, 'retrievedAt');
  const eventTime = timestamp(input.eventTime, 'eventTime', { optional: true });
  const publishedAt = timestamp(input.publishedAt, 'publishedAt', {
    optional: true,
  });
  const rawSha256 = optionalText(input.rawSha256, 'rawSha256', 64);
  if (rawSha256 && !SHA256.test(rawSha256)) {
    throw new TypeError('rawSha256 must be a lowercase SHA-256 hex digest');
  }
  const sourceType = input.sourceType ?? 'observation';
  if (
    !['observation', 'source-assertion', 'context', 'derived'].includes(
      sourceType,
    )
  ) {
    throw new TypeError('sourceType is not supported');
  }

  const envelope = {
    sourceId: input.sourceId,
    sourceUrl: sourceUrl.toString(),
    retrievedAt,
    eventTime,
    publishedAt,
    sourceType,
  };
  for (const key of ['recordId', 'sourceVersion', 'license', 'attribution']) {
    const value = optionalText(
      input[key],
      key,
      key === 'attribution' ? 1024 : 512,
    );
    if (value !== undefined) envelope[key] = value;
  }
  if (rawSha256) envelope.rawSha256 = rawSha256;
  return Object.freeze(envelope);
}

/**
 * Classify provider health using provider-specific freshness and retry limits.
 * A future last-success timestamp is rejected instead of being treated as fresh.
 */
export function classifySourceHealth({
  lastSuccessAt = null,
  checkedAt = new Date().toISOString(),
  staleAfterMs,
  retryAfterAt = null,
  available = true,
  partial = false,
} = {}) {
  if (!Number.isFinite(staleAfterMs) || staleAfterMs <= 0) {
    throw new TypeError('staleAfterMs must be a positive finite number');
  }
  if (typeof available !== 'boolean' || typeof partial !== 'boolean') {
    throw new TypeError('available and partial must be booleans');
  }
  const checked = timestamp(checkedAt, 'checkedAt');
  const checkedMs = Date.parse(checked);
  const lastSuccess = timestamp(lastSuccessAt, 'lastSuccessAt', {
    optional: true,
  });
  const retryAfter = timestamp(retryAfterAt, 'retryAfterAt', {
    optional: true,
  });
  const lastSuccessMs = lastSuccess ? Date.parse(lastSuccess) : null;
  if (lastSuccessMs != null && lastSuccessMs > checkedMs) {
    throw new TypeError('lastSuccessAt cannot be later than checkedAt');
  }

  let status;
  if (retryAfter && Date.parse(retryAfter) > checkedMs) status = 'rate_limited';
  else if (!available || !lastSuccess) status = 'unavailable';
  else if (partial) status = 'partial';
  else if (checkedMs - lastSuccessMs > staleAfterMs) status = 'stale';
  else status = 'fresh';

  return Object.freeze({
    status,
    checkedAt: checked,
    lastSuccessAt: lastSuccess,
    retryAfterAt: retryAfter,
    ageMs: lastSuccessMs == null ? null : checkedMs - lastSuccessMs,
  });
}

export { SOURCE_HEALTH_STATES };
