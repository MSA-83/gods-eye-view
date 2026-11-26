import { readResponseJsonCapped } from '../../sources/httpBody.js';
import {
  AIR_QUALITY_PROVIDERS,
  airQualityColor,
  bandForValue,
  bandRiskText,
  valueLabel,
} from './model.js';

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

/**
 * Normalize the server-owned OpenAQ snapshot into the common air-quality row
 * contract used by markers, overlays, analyst records, and the Weather card.
 * @param {object} payload
 * @param {number} [now=Date.now()]
 * @returns {Array<object>}
 */
export function normalizeOpenAqSnapshot(payload, now = Date.now()) {
  if (!Array.isArray(payload?.readings))
    throw new Error('Malformed OpenAQ snapshot');
  const provider = AIR_QUALITY_PROVIDERS.openaq;
  const rows = [];
  for (const raw of payload.readings) {
    const lat = Number(raw?.lat);
    const lon = Number(raw?.lon);
    const value = Number(raw?.value);
    const observedMs = Number(raw?.observedMs);
    if (
      !Number.isFinite(lat) ||
      lat < -90 ||
      lat > 90 ||
      !Number.isFinite(lon) ||
      lon < -180 ||
      lon > 180 ||
      !Number.isFinite(value) ||
      value < 0 ||
      !Number.isFinite(observedMs) ||
      now - observedMs > 6 * 60 * 60_000
    )
      continue;
    const band = bandForValue(provider.id, value);
    rows.push({
      id: String(raw.id || `openaq:${raw.stationId || rows.length}:pm25`),
      provider: provider.id,
      scale: provider.scale,
      value,
      band,
      stationId: String(raw.stationId || raw.id || rows.length),
      name: String(raw.name || 'OpenAQ station'),
      zone: String(raw.zone || ''),
      lat,
      lon,
      observedMs,
      color: airQualityColor(band),
      label: valueLabel(provider.id, value),
      risk: bandRiskText(band),
      note: raw.note ? String(raw.note) : null,
    });
  }
  return rows.sort(
    (a, b) => b.value - a.value || a.stationId.localeCompare(b.stationId),
  );
}

/**
 * Fetch OpenAQ through the server proxy. No OpenAQ credential is ever exposed
 * to the browser; a missing key is represented as an unavailable optional
 * provider so ECCC can continue supplying Canada-wide AQHI readings.
 * @param {{fetchImpl?: Function, now?: () => number}} [options]
 * @returns {{getSnapshot: Function}}
 */
export function createOpenAqAirQualitySource({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
} = {}) {
  return {
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl('/api/openaq', {
        signal,
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (response.status === 503) return { readings: [], unavailable: true };
      const payload = await readResponseJsonCapped(
        response,
        MAX_RESPONSE_BYTES,
        signal,
      );
      if (!response.ok) throw new Error(`OpenAQ HTTP ${response.status}`);
      signal?.throwIfAborted();
      return {
        readings: normalizeOpenAqSnapshot(payload, now()),
        stale: Boolean(payload.stale),
      };
    },
  };
}
