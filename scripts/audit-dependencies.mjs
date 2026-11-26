#!/usr/bin/env node
// Enforce npm audit findings while documenting the one currently unpatched
// upstream advisory that cannot yet be remediated by a released picomatch.
import { spawnSync } from 'node:child_process';

const allowed = new Map([
  [
    'GHSA-fc5q-39xc-vjpf',
    {
      packageName: 'picomatch',
      reason: 'No patched npm release is published as of 2026-11-17; track upstream before removing this exception.',
    },
  ],
]);

const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(command, ['audit', '--json'], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
  maxBuffer: 16 * 1024 * 1024,
});

if (result.error) throw result.error;
let report;
try {
  report = JSON.parse(result.stdout || '');
} catch {
  process.stderr.write(result.stderr || result.stdout || 'npm audit returned no JSON output\n');
  process.exit(2);
}
if (report.error) {
  process.stderr.write(JSON.stringify(report.error, null, 2) + '\n');
  process.exit(2);
}

const rank = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
const blocked = [];
const accepted = [];

for (const [packageName, vulnerability] of Object.entries(report.vulnerabilities || {})) {
  if ((rank[vulnerability.severity] ?? 0) < rank.moderate) continue;
  const advisories = (vulnerability.via || []).filter((item) => item && typeof item === 'object');
  if (!advisories.length) {
    // npm repeats an upstream advisory's severity on dependent packages in
    // the chain. Those entries have only string-valued `via` links; the
    // vulnerable package itself has the advisory object and is checked below.
    continue;
  }
  for (const advisory of advisories) {
    const id = String(advisory.url || '').split('/').pop();
    const exception = allowed.get(id);
    if (exception && exception.packageName === packageName) {
      accepted.push({ packageName, id, reason: exception.reason });
    } else {
      blocked.push({
        packageName,
        severity: vulnerability.severity,
        id: id || advisory.title || 'unknown-advisory',
        title: advisory.title || '',
        url: advisory.url || '',
      });
    }
  }
}

for (const item of accepted) {
  process.stdout.write(`ACCEPTED UNPATCHED ADVISORY: ${item.packageName} ${item.id}\n  ${item.reason}\n`);
}
if (blocked.length) {
  process.stderr.write('Blocking moderate/high/critical npm audit findings:\n');
  process.stderr.write(JSON.stringify(blocked, null, 2) + '\n');
  process.exit(1);
}
const totals = report.metadata?.vulnerabilities || {};
process.stdout.write(
  `npm audit policy passed: ${totals.total ?? 0} total findings; ${accepted.length} documented unpatched exception(s).\n`,
);
