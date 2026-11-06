import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { validateLegacyChunk } from '../src/utils/kiriv.js';
import { dataTextureLayout, createDataTextureArray, getDataTextureSet } from '../src/utils/dataTextureArray.js';

const header = {type:'splat',size:1627521024,texwidth:4096,texheight:24834,
  precision_variant:'lite',gauss_stride_pixels:4,
  cameras:[{id:0,img_name:'00000',width:1280,height:720,position:[0,0,-4],
    rotation:[[1,0,0],[0,1,0],[0,0,1]],fy:1000,fx:1000}]};
const source = readFileSync(new URL('../src/utils/splatObjectLoader.js', import.meta.url),'utf8')
  .replace(/^import .*;$/gm,'').replace(/export /g,'');
const { calculateVertexCount, createSplatTexture } = vm.runInNewContext(source +
  '\n;({calculateVertexCount,createSplatTexture});', {createDataTextureArray});

test('exact failing header validates and yields 25,430,016 records without a hardware-height guard', () => {
  assert.equal(8 + 292 + header.size, 1627521324);
  assert.equal(validateLegacyChunk(header).gaussStridePixels,4);
  assert.equal(header.size,header.texwidth * header.texheight * 16);
  assert.equal(calculateVertexCount({byteLength:header.size},4),25430016);
});

for (const limit of [16384,8192]) {
  test(`exact 25.4M-point upload splits into bounded objects at GPU limit ${limit}`, () => {
    const uploads=[], storage=[];
    class LogicalPayload extends Uint32Array {
      get length() { return header.size/4; }
      subarray(start,end) { return {source:this,start,end,length:end-start}; }
    }
    const data=new LogicalPayload(0);
    const gl={MAX_TEXTURE_SIZE:1,MAX_ARRAY_TEXTURE_LAYERS:2,UNPACK_ALIGNMENT:3,NO_ERROR:0,
      getParameter:p=>p===1?limit:p===2?256:p===3?4:16,
      createTexture:()=>({}),activeTexture(){},bindTexture(){},texParameteri(){},pixelStorei(){},
      texStorage3D:(...args)=>storage.push(args.slice(3)),texSubImage3D:(...args)=>uploads.push(args),getError:()=>0};
    const texture=createSplatTexture(gl,{width:4096,height:24834,data});
    const set=getDataTextureSet(texture);
    assert.equal(set.textures.length,4);
    assert.equal(set.pointsPerSlab,8388608);
    assert.deepEqual(storage,[[4096,8192,1],[4096,8192,1],[4096,8192,1],[4096,258,1]]);
    assert.equal(storage.reduce((n,[w,h,d])=>n+w*h*d*16,0),header.size);
    let consumed=0;
    for(const args of uploads) {
      const view=args.at(-1);
      assert.equal(view.source,data);assert.equal(view.start,consumed);consumed=view.end;
    }
    assert.equal(consumed,header.size/4);
    for(const index of [0,8388607,8388608,16777215,16777216,25165823,25165824,25430015]) {
      const slab=Math.floor(index/set.pointsPerSlab),local=index%set.pointsPerSlab;
      for(let sub=0;sub<4;sub++) {
        const p=local*4+sub,{width,height,start}=set.slabs[slab];
        const row=Math.floor(p/width), x=p%width,y=row%height,z=Math.floor(row/height);
        assert.equal(start+(z*height+y)*width+x,index*4+sub);
      }
    }
  });
}
