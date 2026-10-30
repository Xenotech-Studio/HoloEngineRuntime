import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

const source = readFileSync(new URL('../src/utils/depthWorker.js', import.meta.url), 'utf8');
const code = source.slice(0, source.indexOf('export function createDepthWorker'));
const bytes = readFileSync(new URL('../src/utils/depth-sort.wasm', import.meta.url));
const context = vm.createContext({});
vm.runInContext(code + '\nthis.make = createSimdSorter;', context);
const make = () => {
  const simd = context.make(bytes);
  assert.ok(simd, 'test requires actual SIMD, never silently tests fallback');
  return simd;
};
let seed = 0x738ac12;
const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);

// Independent copy of pre-optimization numeric expressions, with stable bucket
// ordering expressed as comparison sort rather than production counting sort.
function reference(p, m, c, n, moving, time, view) {
  return Array.from({ length: n }, (_, i) => {
    let x = p[3*i], y = p[3*i+1], z = p[3*i+2];
    if (moving) {
      const dt = time - c[i], dt2 = dt * dt, dt3 = dt2 * dt, b = 9*i;
      x += m[b]*dt + m[b+3]*dt2 + m[b+6]*dt3;
      y += m[b+1]*dt + m[b+4]*dt2 + m[b+7]*dt3;
      z += m[b+2]*dt + m[b+5]*dt2 + m[b+8]*dt3;
    }
    return ((view[2]*x + view[6]*y + view[10]*z)*4096) | 0;
  });
}
function check(simd, p, m, c, moving, time, view) {
  const n = c.length;
  const expected = reference(p, m, c, n, moving, time, view);
  const actual = simd.depths(p, m, c, n, moving, time, view);
  assert.deepEqual(Array.from(actual.subarray(0, n), x => x | 0), expected);
  const min = Math.min(...expected), max = Math.max(...expected), inv = 65536 / (max-min);
  for (let i = 0; i < n; i++) actual[i] = actual[i] | 0;
  const buckets = simd.quantize(min, inv);
  const clamp = x => Math.max(0, Math.min(65535, x | 0));
  const expectedBuckets = expected.map(x => clamp((x-min)*inv));
  const actualBuckets = Array.from(buckets.subarray(0, n), clamp);
  assert.deepEqual(actualBuckets, expectedBuckets);
  for (const direction of [1,-1]) {
    const indices = b => Array.from({ length:n }, (_,i) => i).sort((a,c) => direction*(b[a]-b[c]));
    assert.deepEqual(indices(actualBuckets), indices(expectedBuckets));
  }
}

test('SIMD numeric expressions match original JS for seeded random data and memory growth', () => {
  const simd = make();
  for (const n of [0,1,2,3,31,1025,4096]) {
    const p = Float32Array.from({length:n*3}, () => (random()-.5)*10000);
    const m = Float32Array.from({length:n*9}, () => (random()-.5)*100);
    const c = Float32Array.from({length:n}, random);
    for (let frame=0; frame<12; frame++) {
      const view = Array.from({length:16}, () => (random()-.5)*10);
      check(simd,p,m,c,frame%2===0,random(),view);
    }
  }
});

test('SIMD preserves ToInt32 wrapping, NaN/Inf, signed zero, cancellation and equal depths', () => {
  const special = [NaN,Infinity,-Infinity,0,-0,2**30,-(2**30),2**-149, 1, -1, 2**100];
  for (const moving of [false,true]) {
    const n = 257;
    const p = Float32Array.from({length:n*3}, (_,i) => special[i%special.length]);
    const m = Float32Array.from({length:n*9}, (_,i) => special[(i*7)%special.length]);
    const c = Float32Array.from({length:n}, (_,i) => special[(i*3)%special.length]);
    for (const v of [0,1,-1,Infinity,NaN,2**100]) {
      const view = Array(16).fill(v);
      check(make(),p,m,c,moving,.5,view);
    }
  }
  const n=513, p=new Float32Array(n*3).fill(1), m=new Float32Array(n*9), c=new Float32Array(n);
  check(make(),p,m,c,false,.5,Array(16).fill(1));
});

function worker(texture, simd, strategy) {
  const tasks=[], messages=[];
  const self={postMessage: m => messages.push(m)};
  const ctx=vm.createContext({ self, initialSimd:simd, setTimeout:fn=>tasks.push(fn) });
  vm.runInContext(code+'\ncreateWorker(self, null, initialSimd);', ctx);
  self.onmessage({data:{texture,vertexCount:texture.length/16}});
  return time => {
    const view=[1,0,.5,0,0,1,-.25,0,0,0,1,0,0,0,0,1];
    self.onmessage({data:{view,time,sortStrategy:strategy,snapshot:{requestId:time+1}}});
    while(tasks.length) tasks.shift()();
    return Array.from(messages.at(-1).depthIndex);
  };
}

test('complete worker indices are identical for random packed models in all strategies', () => {
  for (const strategy of ['front-to-back','back-to-front','none']) {
    for (const n of [1,2,17,1025]) {
      const texture=new Float32Array(n*16), u32=new Uint32Array(texture.buffer);
      for(let i=0;i<n;i++) {
        for(let k=0;k<3;k++) texture[i*16+k]=(random()-.5)*1000;
        for(let k=8;k<16;k++) u32[i*16+k]=(random()*2**32)>>>0;
      }
      const js=worker(texture,null,strategy), wasm=worker(texture,make(),strategy);
      for(const t of [0,.1,.5,1]) assert.deepEqual(wasm(t),js(t));
    }
  }
});

test('maximum depth bucket 65536 is clamped, every index survives, ties retain original order', () => {
  const texture=new Float32Array(16*513);
  for(let i=0;i<513;i++) texture[i*16+2]=i===512 ? 1 : 0;
  for(const simd of [null,make()]) {
    const indices=worker(texture,simd,'back-to-front')(0);
    assert.deepEqual(indices,[512,...Array.from({length:512},(_,i)=>i)]);
  }
});

test('feature detection and corrupt binaries fall back without throwing', () => {
  for(const WebAssembly of [undefined,{validate:()=>false},{validate:()=>{throw Error('disabled');}}]) {
    const ctx=vm.createContext({WebAssembly});
    vm.runInContext(code+'\nthis.make=createSimdSorter;',ctx);
    assert.equal(ctx.make(bytes),null);
  }
  assert.equal(context.make(new Uint8Array([0])),null);
});
