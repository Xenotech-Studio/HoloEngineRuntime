import test from 'node:test';
import assert from 'node:assert/strict';
import { FrameMetrics } from '../src/core/utils/frameMetrics.js';

function harness() {
  let created = 0, active = null;
  const ext = { GPU_DISJOINT_EXT: 1, TIME_ELAPSED_EXT: 2 };
  const gl = {
    QUERY_RESULT_AVAILABLE: 3, QUERY_RESULT: 4, CURRENT_QUERY: 5,
    ready: false, disjoint: false, reads: [], deleted: [],
    getExtension: () => ext, isContextLost: () => false,
    getParameter() { return this.disjoint; }, getQuery: () => active,
    createQuery: () => ({ id: ++created }),
    beginQuery(_, q) { assert.equal(active, null); active = q; },
    endQuery() { active = null; }, deleteQuery(q) { this.deleted.push(q); },
    getQueryParameter(q, key) {
      this.reads.push([q, key]);
      if (key === this.QUERY_RESULT_AVAILABLE) return this.ready;
      assert.ok(this.ready, 'never read an unavailable result');
      return 12400000;
    },
  };
  return { gl, timing: new FrameMetrics(gl), created: () => created };
}

test('sample every eight frames, bounded to three in flight, recycle only on later frames', () => {
  const { gl, timing, created } = harness();
  for (let i = 0; i < 8; i++) { timing.begin(); timing.end(); }
  assert.equal(created(), 1);
  assert.equal(gl.reads.length, 0);
  for (let i = 0; i < 32; i++) { timing.begin(); timing.end(); }
  assert.equal(created(), 3);
  assert.equal(timing.pending.length, 3);
  gl.ready = true;
  timing.begin(); timing.end();
  assert.equal(timing.take().gpuMs, 12.4);
  for (let i = 0; i < 8; i++) { timing.begin(); timing.end(); }
  assert.equal(created(), 3);
  timing.dispose();
  assert.equal(gl.deleted.length, 3);
});

test('disjoint discards pending samples and collected values; absent extension is harmless', () => {
  const { gl, timing } = harness();
  for (let i = 0; i < 8; i++) { timing.begin(); timing.end(); }
  timing.add('gpuMs', 2);
  gl.disjoint = true;
  timing.begin(); timing.end();
  assert.equal(timing.pending.length, 0);
  assert.equal(timing.take().gpuMs, null);
  assert.equal(gl.reads.length, 0);
  const absent = new FrameMetrics({ getExtension: () => null });
  absent.begin(); absent.end(); absent.dispose();
  assert.equal(absent.take().gpuMs, null);
});
