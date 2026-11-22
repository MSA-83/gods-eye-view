import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSwpcProduct } from './swpc.js';

test('normalizes post-2026 planetary Kp object rows', () => {
  assert.deepEqual(normalizeSwpcProduct('kp', [
    { time_tag: '2026-11-17 12:00:00.000', kp_index: 5.33 },
    { time_tag: '2026-11-17T15:00:00Z', kp_index: 4.67 },
  ]), [
    { time_tag: '2026-11-17T12:00:00.000Z', kp_index: 5.33 },
    { time_tag: '2026-11-17T15:00:00.000Z', kp_index: 4.67 },
  ]);
});

test('accepts legacy header/value fixtures without changing current output shape', () => {
  assert.deepEqual(normalizeSwpcProduct('kp', [
    ['time_tag', 'Kp'], ['2026-11-17 12:00:00.000', '5.33'],
  ]), [{ time_tag: '2026-11-17T12:00:00.000Z', kp_index: 5.33 }]);
});

test('normalizes replacement RTSW magnetic and plasma records including source selection metadata', () => {
  assert.deepEqual(normalizeSwpcProduct('mag', [
    { time_tag: '2026-11-17 12:00:00.000', bz_gsm: -8.2, bt: 11.4, source: 'DSCOVR', active: true },
  ]), [{ time_tag: '2026-11-17T12:00:00.000Z', bz_gsm: -8.2, bt: 11.4, source: 'DSCOVR', active: true }]);
  assert.deepEqual(normalizeSwpcProduct('wind', [
    { time_tag: '2026-11-17 12:00:00.000', proton_speed: 520, proton_density: 6.2, proton_temperature: 100000, source: 'IMAP', active: true },
  ]), [{ time_tag: '2026-11-17T12:00:00.000Z', proton_speed: 520, proton_density: 6.2, proton_temperature: 100000, source: 'IMAP', active: true }]);
});

test('bounds alert text and rejects non-HTTPS links', () => {
  assert.deepEqual(normalizeSwpcProduct('alerts', [{
    product_id: 'ALERT-001', issue_datetime: '2026-11-17 12:00:00.000',
    message: 'x'.repeat(5000), url: 'javascript:alert(1)',
  }]), [{
    product_id: 'ALERT-001', issue_datetime: '2026-11-17T12:00:00.000Z',
    message: 'x'.repeat(4000), url: null,
  }]);
});

test('rejects malformed timestamps, out-of-range Kp and changed field names', () => {
  assert.throws(() => normalizeSwpcProduct('kp', [{ time_tag: 'yesterday', kp_index: 4 }]), /swpc_schema_drift/);
  assert.throws(() => normalizeSwpcProduct('kp', [{ time_tag: '2026-11-17T12:00:00Z', kp_index: 12 }]), /swpc_schema_drift/);
  assert.throws(() => normalizeSwpcProduct('mag', [{ time_tag: '2026-11-17T12:00:00Z', bz: -2, bt: 3 }]), /swpc_schema_drift/);
  assert.throws(() => normalizeSwpcProduct('unknown', []), /swpc_unknown_product/);
});
