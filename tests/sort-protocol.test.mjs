import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

function workerHarness(moving = false) {
  const messages = [], tasks = [];
  const self = { postMessage: m => messages.push(m) };
  const source = readFileSync(new URL('../src/utils/depthWorker.js', import.meta.url), 'utf8');
  vm.runInNewContext(source.slice(0, source.indexOf('export function createDepthWorker')) + '\ncreateWorker(self);', {
    self, Float32Array, Uint32Array, Int32Array, Math, Date, setTimeout: fn => tasks.push(fn),
  });
  const texture = new Float32Array(32);
  texture[0] = 1; texture[2] = 2; texture[16] = -1; texture[18] = -2;
  if (moving) new Uint32Array(texture.buffer)[8] = 0x3c00;
  self.onmessage({ data: { texture, vertexCount: 2 } });
  let id = 0;
  return {
    messages,
    request(angle, time = 0.5) {
      const view = [1,0,Math.sin(angle),0, 0,1,0,0, 0,0,Math.cos(angle),0, 0,0,0,1];
      const snapshot = { requestId: ++id, view, time };
      self.onmessage({ data: { view, time, snapshot } });
      while (tasks.length) tasks.shift()();
      return messages.at(-1);
    },
  };
}

test('frozen time: tiny rotations accumulate against last actual sort', () => {
  for (const moving of [false, true]) {
    const w = workerHarness(moving);
    assert.ok(w.request(0).depthIndex);
    for (let i = 1; i <= 5; i++) assert.equal(w.request(i * 0.002).depthIndex, undefined);
    const result = w.request(0.012);
    assert.ok(result.depthIndex);
    assert.equal(result.requestId, 7);
    assert.equal(result.snapshot.view[2], Math.sin(0.012));
    assert.equal(result.time, 0.5);
    assert.equal(w.messages.filter(m => m.depthIndex).length, 2);
  }
});

test('static time changes acknowledge same order; moving geometry sorts new time', () => {
  const stationary = workerHarness();
  const first = stationary.request(0);
  const next = stationary.request(0, 0.8);
  assert.equal(next.orderId, first.orderId);
  assert.equal(next.depthIndex, undefined);
  assert.equal(next.snapshot.time, 0.8);
  const moving = workerHarness(true);
  moving.request(0);
  assert.ok(moving.request(0, 0.8).depthIndex);
});

export function loadPipeline() {
  const source = readFileSync(new URL('../src/core/utils/holoRP.js', import.meta.url), 'utf8')
    .replace(/^import .*;$/gm, '').replace(/export /g, '');
  const identity4 = () => [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
  const context = { identity4, multiply4: (a,b) => a.map((_,i) => {
    const r=i%4, c=Math.floor(i/4); return [0,1,2,3].reduce((sum,k)=>sum+a[k*4+r]*b[c*4+k],0);
  }) };
  vm.createContext(context);
  vm.runInContext(source + '\nthis.Pipeline = HoloRP;', context);
  return { ...context, identity4 };
}

test('two passes and multiple views send one snapshot per object per frame', () => {
  const { Pipeline, identity4 } = loadPipeline();
  const sent = [], drawn = [];
  let modelReads = 0;
  const pipeline = Object.create(Pipeline.prototype);
  pipeline.gl = new Proxy({}, { get: () => () => {} });
  pipeline._frameSnapshots = new Map();
  pipeline._frameTargetTime = 0.3;
  pipeline._singleView = true;
  pipeline.depthWritePassEnabled = true;
  pipeline._renderSplat = (obj, model) => drawn.push(model);
  const object = { getModelMatrix: () => { modelReads++; return identity4(); }, worker: { postMessage: m => sent.push(m) } };
  const viewInfo = { viewport: { width: 100, height: 100 }, fx: 80, fy: 80 };
  const render = () => pipeline._renderGSObjects([object], identity4(), identity4(), null, {}, {}, {}, viewInfo, true);
  render(); render();
  assert.equal(sent.length, 1);
  assert.equal(modelReads, 1);
  assert.equal(drawn.length, 4);
  assert.equal(sent[0].snapshot.time, 0.3);
  assert.ok(drawn.every(model => model === drawn[0]));
  pipeline._frameSnapshots = new Map();
  render();
  assert.equal(sent.length, 1, 'identical frame must not create a result/invalidation loop');
});

export function handlerHarness() {
  const source = readFileSync(new URL('../src/utils/splatObjectLoader.js', import.meta.url), 'utf8')
    .replace(/^import .*;$/gm, '').replace(/export /g, '');
  const targetObject = {}, uploads = [], returned = [];
  const gl = { bindBuffer() {}, bufferData: (_, indices) => uploads.push([...indices]), getError: () => 0, NO_ERROR: 0 };
  const context = { getGLErrorName() {}, Uint32Array };
  vm.createContext(context);
  vm.runInContext(source + '\nthis.handler = createStandardWorkerMessageHandler;', context);
  const handler = context.handler({ gl, indexBuffer: {}, targetObject });
  return { targetObject, uploads, returned,
    send: data => handler({ data, target: { postMessage: m => returned.push(m) } }),
    flush: () => targetObject.flushSortResult?.(),
  };
}

test('indices and snapshot commit as one version; incompatible reuse is rejected', () => {
  const h = handlerHarness();
  const snapshot = { requestId: 1, time: 0.2, view: [1] };
  h.send({ snapshot, requestId: 1, orderId: 1, depthIndex: new Uint32Array([1,0]), vertexCount: 2 });
  h.flush();
  assert.equal(h.targetObject.acceptedSort.snapshot, snapshot);
  h.send({ snapshot: { requestId: 2, time: 0.9 }, requestId: 2, orderId: 99 });
  h.flush();
  assert.equal(h.targetObject.acceptedSort.snapshot, snapshot);
  h.send({ snapshot: { requestId: 3, time: 0.7 }, requestId: 3, orderId: 1 });
  h.flush();
  assert.equal(h.targetObject.acceptedSort.snapshot.time, 0.7);
  assert.equal(h.uploads.length, 1);
});
