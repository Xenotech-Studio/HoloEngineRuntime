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
  pipeline.setQuadTailSigma(1.75);
  pipeline.setMotionAlphaCutoff(0.05);
  values = draw(true);
  assert.equal(values.get('tail'), 1.75);
  assert.equal(-(values.get('tail') ** 2), -3.0625);
  assert.equal(values.get('motion'), 0.05);
  values = draw(false);
  assert.equal(values.get('tail'), 1.75);
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

test('quad scaling preserves default coordinates and the Gaussian mapping after axis clamping', () => {
  for (const name of ['splatShaders', 'gaussian3dShaders']) {
    const source = read(`../src/shaders/${name}.js`);
    const vertex = source.slice(0, source.indexOf('export const fragmentShader'));
    assert.match(vertex, /uniform float quadTailSigma;/);
    const scale = vertex.match(/float quadScale = quadTailSigma \/ ([\d.]+);/);
    assert.ok(scale);
    const divisor = Number(scale[1]);
    assert.equal(2 / divisor, 1);
    assert.equal(1.5 / divisor, 0.75);
    assert.match(vertex, /vec2 quadPosition = position;\s*float quadScale = quadTailSigma \/ 2.0;\s*if \(quadTailSigma != 2.0\) \{\s*quadPosition = position \* quadScale;\s*\}/);
    assert.ok(vertex.indexOf('min(sqrt(2.0 * lambda2), 1024.0)') < vertex.indexOf('float quadScale'));
    assert.match(vertex, /quadPosition.x \* majorAxis \/ viewport/);
    assert.match(vertex, /quadPosition.y \* minorAxis \/ viewport/);
    assert.match(vertex, /vPosition = quadPosition;/);
    // At a fixed screen point, interpolation recovers the same Gaussian
    // coordinate whether the endpoints are +/-2 or +/-sigma.
    for (const sigma of [2, 1.5]) {
      const k = sigma / divisor;
      const radius = 2 * k;
      assert.equal(radius, sigma);
      for (const axis of [12, 1024]) {
        for (const coordinate of [-1, -0.5, 0, 0.5, 1]) {
          const screen = coordinate * axis;
          const t = (screen + radius * axis) / (2 * radius * axis);
          const interpolated = -radius * (1 - t) + radius * t;
          assert.ok(Math.abs(interpolated - coordinate) < 1e-12);
          assert.ok(Math.abs(Math.exp(-(interpolated ** 2)) - Math.exp(-(coordinate ** 2))) < 1e-12);
        }
      }
    }
  }
});
