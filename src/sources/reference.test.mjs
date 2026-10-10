import test from 'node:test';
import assert from 'node:assert/strict';
import { createReferenceSources } from './reference.js';
import { createStandaloneReferenceSources } from '../standalone/layerSources.js';

test('reference factories retain compatibility without starting acquisition or sharing instances', (t) => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', () => {
    requests++;
    throw new Error('unexpected acquisition');
  });
  assert.equal(createReferenceSources, createStandaloneReferenceSources);
  const first = createReferenceSources();
  const second = createReferenceSources();
  assert.deepEqual(Object.keys(first), ['earthquakes', 'synth', 'cables']);   // SYNTH's live places since Oct 10 2026
  assert.notEqual(first.earthquakes, second.earthquakes);
  assert.notEqual(first.synth, second.synth);
  assert.notEqual(first.cables, second.cables);
  assert.equal(typeof first.earthquakes.getSnapshot, 'function');
  assert.equal(typeof first.synth.getSnapshot, 'function');
  assert.equal(typeof first.cables.fetch, 'function');
  assert.equal(requests, 0);
});
