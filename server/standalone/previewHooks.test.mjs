import test from 'node:test';
import assert from 'node:assert/strict';
import { mapillaryProxy } from '../providers/mapillary.js';
import { ucdpGedProxy } from '../providers/conflict/ucdp.js';
import { swpcProxy } from '../providers/space/swpc.js';

function middlewareRecorder() {
  const registrations = [];
  return {
    registrations,
    middlewares: {
      use(...args) {
        registrations.push(args);
        return Symbol('connect-app');
      },
    },
  };
}

test('preview hooks register middleware without returning Connect post-hooks', () => {
  const cases = [
    ['mapillary', mapillaryProxy()],
    ['ucdp', ucdpGedProxy({ fetchImpl: async () => ({}) })],
    ['swpc', swpcProxy({ fetchImpl: async () => ({}) })],
  ];

  for (const [name, plugin] of cases) {
    const recorder = middlewareRecorder();
    const result = plugin.configurePreviewServer({
      middlewares: recorder.middlewares,
    });
    assert.equal(result, undefined, `${name} returned a Vite post-hook`);
    assert.ok(recorder.registrations.length > 0, `${name} did not register middleware`);
  }
});
