import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
function harness() {
  const source = read('../src/core/utils/holoRP.js')
    .replace(/^import .*;$/gm, '').replace(/export /g, '');
  const context = vm.createContext({});
  vm.runInContext(source + '\nthis.Pipeline = HoloRP;', context);
  const uploads = new Map();
  const gl = new Proxy({ uniform1f: (location, value) => uploads.set(location, value) },
    { get: (target, name) => target[name] ?? (() => {}) });
  const pipeline = new context.Pipeline(gl, {}, {}, {});
  const draw = is4D => {
    uploads.clear();
    pipeline._renderGSObjects([], null, null, null, {},
      { quadTailSigma: 'tail', motionAlphaCutoff: 'motion' }, {}, {}, is4D);
    return uploads;
  };
  return { pipeline, draw };
}

test('legacy defaults and explicit homepage cutoffs reach shader uniforms', () => {
  const { pipeline, draw } = harness();
  let values = draw(true);
  assert.equal(values.get('tail'), 2);
  assert.equal(-(values.get('tail') ** 2), -4);
  assert.equal(values.get('motion'), 0.02);
  pipeline.setQuadTailSigma(1.5);
  pipeline.setMotionAlphaCutoff(0.05);
  values = draw(true);
  assert.equal(values.get('tail'), 1.5);
  assert.equal(-(values.get('tail') ** 2), -2.25);
  assert.equal(values.get('motion'), 0.05);
  values = draw(false);
  assert.equal(values.get('tail'), 1.5);
  assert.equal(values.has('motion'), false);
  assert.equal(pipeline.depthOpacityThreshold, 0.13);
  assert.equal(pipeline.centerOpacityThreshold, 0.65);
  pipeline.setQuadTailSigma(undefined);
  pipeline.setMotionAlphaCutoff(undefined);
  assert.equal(draw(true).get('tail'), 2);
  assert.equal(draw(true).get('motion'), 0.02);
});

test('both shader tails use the radius squared; only 4D culls temporal opacity', () => {
  for (const name of ['splatShaders', 'gaussian3dShaders']) {
    const source = read(`../src/shaders/${name}.js`);
    assert.match(source, /uniform float quadTailSigma;/);
    assert.match(source, /if \(A < -\(quadTailSigma \* quadTailSigma\)\) discard;/);
    assert.doesNotMatch(source, /gl_FragDepth\s*=/);
    assert.match(source, /if \(B < depthOpacityThreshold\)/);
    assert.match(source, /if \(vColor.a < centerOpacityThreshold\)/);
    if (name === 'splatShaders') {
      assert.match(source, /float topacityCull = mix\(1.0, topacity, scaleT\);\s*if \(topacityCull < motionAlphaCutoff\) return;/);
    } else {
      assert.doesNotMatch(source, /motionAlphaCutoff/);
    }
  }
  const hook = read('../src/hooks/useWebGL.js');
  assert.match(hook, /getUniformLocation\(shaderProgram, 'motionAlphaCutoff'\)/);
  for (const program of ['shaderProgram', 'shaderProgram3DGS']) {
    assert.ok(hook.includes(`getUniformLocation(${program}, 'quadTailSigma')`));
  }
});
