import test from 'node:test';
import assert from 'node:assert/strict';
import { dataTextureLayout, createDataTextureArray } from '../src/utils/dataTextureArray.js';

test('real GPU boundary math for lite, HP, KiriV, PLY and SH', () => {
  for (const [width, stride] of [[4096,4], [4096,8], [4096,32], [1024,4], [1024,3], [1024,8], [1024,15]]) {
    const count = Math.floor(width * 16384 / stride);
    assert.equal(dataTextureLayout(count * stride, width, 16384, 256).layers, 1);
    assert.equal(dataTextureLayout((count + 1) * stride, width, 16384, 256).layers, 2);
  }
  assert.throws(() => dataTextureLayout(129, 8, 8, 2), /requires 3 layers/);
});

function mockGL(fail = 0) {
  const uploads = [], deleted = [], alignment = [];
  const gl = { MAX_TEXTURE_SIZE: 1, MAX_ARRAY_TEXTURE_LAYERS: 2, UNPACK_ALIGNMENT: 3,
    NO_ERROR: 0, getParameter: p => p === 1 ? 8 : p === 2 ? 8 : 4,
    createTexture: () => ({}), bindTexture() {}, texParameteri() {},
    pixelStorei: (...args) => alignment.push(args),
    texStorage3D: (...args) => { gl.storage = args.slice(3); },
    texSubImage3D: (...args) => uploads.push(args),
    getError: () => fail, deleteTexture: t => deleted.push(t) };
  return { gl, uploads, deleted, alignment };
}

test('uploads every component unchanged across rows/layers, including a partial final row', () => {
  for (const ArrayType of [Uint32Array, Float32Array]) {
    for (const preferredWidth of [5, 8, 16]) {
      const {gl, uploads} = mockGL();
      const data = ArrayType.from({length: 151 * 4}, (_, i) => i + 1);
      createDataTextureArray(gl, data, preferredWidth, ArrayType === Float32Array);
      const [w, h, layers] = gl.storage;
      assert.ok(w <= 8 && h <= 8 && layers <= 8);
      const reconstructed = new ArrayType(w * h * layers * 4);
      for (const args of uploads) {
        const [, , x, y, z, width, height, depth, , , view] = args;
        assert.equal(view.buffer, data.buffer);
        assert.ok(x + width <= w && y + height <= h && z < layers);
        assert.equal(depth, 1);
        reconstructed.set(view, ((z * h + y) * w + x) * 4);
      }
      assert.deepEqual(reconstructed.subarray(0, data.length), data);
    }
  }
});

test('allocation failure deletes texture and restores unpack state', () => {
  const {gl, deleted, alignment, uploads} = mockGL(1285);
  assert.throws(() => createDataTextureArray(gl, new Uint32Array(16), 8), /allocation failed/);
  assert.equal(deleted.length, 1);
  assert.equal(uploads.length, 0);
  assert.deepEqual(alignment.at(-1), [gl.UNPACK_ALIGNMENT, 4]);
});

// Budget/retry tests use small actual buffers; real-size plans use no fake GPU memory.
import { dataTextureSlabs, getDataTextureSet, deleteDataTexture } from '../src/utils/dataTextureArray.js';
test('real model fits seven 256 MiB slabs, preserving every point', () => {
  for(const limit of [8192,16384]) {
    const plan=dataTextureSlabs(101720064,4096,limit,256,256*1024*1024,4,8);
    assert.equal(plan.slabs.length,7); assert.equal(plan.pointsPerSlab,4194304);
    assert.equal(plan.slabs.reduce((n,s)=>n+s.length,0),101720064);
    assert.ok(plan.slabs.every(s=>s.width*s.height*s.layers*16<=256*1024*1024));
    assert.throws(()=>dataTextureSlabs(101720064,4096,limit,256,128*1024*1024,4,8),/needs 13 textures/);
  }
});

test('INVALID_OPERATION halves budget, deletes partial plan, caches success and deletes all siblings', () => {
  let error=0, bound, allocations=0;
  const deleted=[], uploaded=[];
  const gl={MAX_TEXTURE_SIZE:1,MAX_ARRAY_TEXTURE_LAYERS:2,UNPACK_ALIGNMENT:3,NO_ERROR:0,INVALID_OPERATION:1282,
    getParameter:p=>p===1?8:p===2?256:p===3?4:16,
    createTexture:()=>({}),bindTexture:(t,v)=>{bound=v;},texParameteri(){},pixelStorei(){},
    texStorage3D:(t,l,f,w,h,d)=>{allocations++;if(w*h*d*16>256)error=1282;},
    getError:()=>{const e=error;error=0;return e;},deleteTexture:t=>deleted.push(t),
    texSubImage3D:(...args)=>uploaded.push({texture:bound,data:args.at(-1)})};
  const data=Uint32Array.from({length:160},(_,i)=>i);
  const texture=createDataTextureArray(gl,data,8,false,{budget:512});
  const set=getDataTextureSet(texture);
  assert.equal(set.budget,256);assert.equal(set.textures.length,3);
  assert.equal(deleted.length,1);assert.equal(allocations,4);
  assert.deepEqual(uploaded.flatMap(x=>Array.from(x.data)),Array.from(data));
  const next=createDataTextureArray(gl,data,8,false,{budget:512});
  assert.equal(allocations,7); // Reuses successful budget; no failing probe.
  deleteDataTexture(gl,texture);deleteDataTexture(gl,next);
  assert.equal(deleted.length,7);
});

test('retry deletes earlier successful slabs too, before any upload', () => {
  let error=0, allocations=0, uploads=0;
  const deleted=[];
  const gl={MAX_TEXTURE_SIZE:1,MAX_ARRAY_TEXTURE_LAYERS:2,UNPACK_ALIGNMENT:3,NO_ERROR:0,INVALID_OPERATION:1282,
    getParameter:p=>p===1?8:p===2?256:p===3?4:16,
    createTexture:()=>({}),bindTexture(){},texParameteri(){},pixelStorei(){},
    texStorage3D:()=>{if(++allocations===2)error=1282;},
    getError:()=>{const e=error;error=0;return e;},deleteTexture:t=>{assert.equal(uploads,0);deleted.push(t);},
    texSubImage3D:()=>uploads++};
  const texture=createDataTextureArray(gl,new Uint32Array(160),8,false,{budget:512});
  assert.equal(deleted.length,2);assert.equal(allocations,5);
  assert.equal(getDataTextureSet(texture).textures.length,3);assert.equal(uploads,3);
});

test('vertex/fragment/combined sampler limits leave two units and fail before allocation', () => {
  let allocations=0;
  const gl={MAX_TEXTURE_SIZE:1,MAX_ARRAY_TEXTURE_LAYERS:2,UNPACK_ALIGNMENT:3,
    MAX_TEXTURE_IMAGE_UNITS:4,MAX_VERTEX_TEXTURE_IMAGE_UNITS:5,MAX_COMBINED_TEXTURE_IMAGE_UNITS:6,
    getParameter:p=>({1:8,2:256,3:4,4:16,5:4,6:32}[p]),pixelStorei(){},createTexture:()=>{allocations++;return {};}};
  assert.throws(()=>createDataTextureArray(gl,new Uint32Array(160),8,false,{budget:256}),/only 2 sampler slots/);
  assert.equal(allocations,0);
});
