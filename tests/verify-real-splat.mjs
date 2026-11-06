// Opt-in, real-file CPU verification. Runs the actual hook over streamed HTTP.
// Usage: /usr/bin/time -v node tests/verify-real-splat.mjs /path/model.splatv > report.json
import assert from 'node:assert/strict';
import { createReadStream, readFileSync, openSync, readSync, closeSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { Worker } from 'node:worker_threads';
import { createWorker } from '../src/utils/depthWorker.js';
import { dataTextureSlabs, createDataTextureArray, getDataTextureSet, deleteDataTexture } from '../src/utils/dataTextureArray.js';
import { validateLegacyChunk } from '../src/utils/kiriv.js';

const path = process.argv[2];
if (!path) throw Error('Supply the real .splatv file path');
const memory = () => ({...process.memoryUsage(),peakRssBytes:process.resourceUsage().maxRSS*1024});
const report = {path,node:process.version,fileBytes:statSync(path).size,baseline:memory()};
const fd=openSync(path,'r');
function readAt(offset,length) {
  const b=Buffer.alloc(length);assert.equal(readSync(fd,b,0,length,offset),length);return b;
}
const prefix=readAt(0,8), metadataBytes=readAt(8,prefix.readUInt32LE(4));
assert.equal(prefix.readUInt32LE(0),0x674b);
const header=JSON.parse(metadataBytes.toString())[0];
validateLegacyChunk(header);
const payloadOffset=8+metadataBytes.length;
report.header={magic:prefix.readUInt32LE(0),metadataBytes:metadataBytes.length,payloadOffset,...header};
assert.equal(report.fileBytes,payloadOffset+header.size);

let hookSource=readFileSync(new URL('../src/hooks/useSplatLoader.js',import.meta.url),'utf8');
hookSource=hookSource.replace("import { useRef, useState, useCallback } from 'react';",`
const useRef=current=>({current});
const useState=initial=>[initial,value=>{if(typeof value==='number')globalThis.__realSplatCount=value;}];
const useCallback=f=>f;`)
  .replace("'../utils/kiriv'",JSON.stringify(new URL('../src/utils/kiriv.js',import.meta.url).href));
const loader=(await import(`data:text/javascript;base64,${Buffer.from(hookSource).toString('base64')}`)).useSplatLoader();
const server=createServer((req,res)=>{
  res.writeHead(200,{'Content-Length':report.fileBytes,'Content-Type':'application/octet-stream'});
  const stream=createReadStream(path,{highWaterMark:64*1024});
  stream.on('error',err=>res.destroy(err));res.on('close',()=>stream.destroy());stream.pipe(res);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let texture;
const start=performance.now();
console.error('Loading real file through useSplatLoader and native fetch...');
try {
  texture=await loader.loadSplatFile(`http://127.0.0.1:${server.address().port}/model.splatv`,{intensity:0,tolerance:0});
} finally {
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
report.loadMs=performance.now()-start;report.afterLoad=memory();
assert.equal(texture.data.buffer,texture.buffer.buffer);
assert.equal(texture.data.byteLength,header.size);
const loaderFunctions=readFileSync(new URL('../src/utils/splatObjectLoader.js',import.meta.url),'utf8')
  .replace(/^import .*;$/gm,'').replace(/export /g,'');
const {calculateVertexCount}=vm.runInNewContext(loaderFunctions+'\n;({calculateVertexCount});');
const n=calculateVertexCount(texture.buffer,texture.gaussStridePixels);
assert.equal(n,globalThis.__realSplatCount);
assert.equal(n,25430016);assert.equal(texture.precisionVariant,'lite');assert.equal(texture.gaussStridePixels,4);
report.loader={vertexCount:n,precisionVariant:texture.precisionVariant,gaussStridePixels:texture.gaussStridePixels,
  sourceWidth:texture.width,sourceHeight:texture.height,payloadBytes:texture.data.byteLength,sharedBackingBuffer:true};
console.error(`Loaded ${n} records; peak RSS ${report.afterLoad.peakRssBytes} bytes. Checking checksum and slabs...`);
const hash=createHash('md5');hash.update(prefix);hash.update(metadataBytes);
hash.update(Buffer.from(texture.data.buffer,texture.data.byteOffset,texture.data.byteLength));
report.md5=hash.digest('hex');assert.equal(report.md5,'b239981614153b1c0d6d4aa5b3396809');
report.afterHash=memory();

function half(h) {
  const sign=h&0x8000?-1:1,e=(h>>10)&31,m=h&1023;
  return sign*(e===0?2**-14*m/1024:e===31?(m?NaN:Infinity):2**(e-15)*(1+m/1024));
}
function decode(bytes) {
  const xyz=[0,4,8].map(at=>bytes.readFloatLE(at));
  const rotation=[12,14,16,18].map(at=>half(bytes.readUInt16LE(at)));
  const scales=[20,22,24].map(at=>half(bytes.readUInt16LE(at)));
  const motion=Array.from({length:9},(_,i)=>half(bytes.readUInt16LE(32+2*i)));
  const angular=Array.from({length:4},(_,i)=>half(bytes.readUInt16LE(52+2*i)));
  const temporal=[60,62].map(at=>half(bytes.readUInt16LE(at)));
  const rgba=Array.from(bytes.subarray(28,32));
  const zeroRecord=bytes.every(x=>x===0);
  assert.ok([...xyz,...rotation,...scales,...motion,...angular,...temporal].every(Number.isFinite),'nonfinite decoded attribute');
  if(!zeroRecord) {
    assert.ok(scales.every(x=>x>=0),'negative scale');
    assert.ok(temporal[1]>=0,'negative temporal width');
    assert.ok(Math.hypot(...rotation)>0,'zero quaternion on a nonzero record');
  }
  return {xyz,rotation,scales,rgba,motion,angular,temporal,zeroRecord};
}
const sampleIDs=new Set([0,1,n-2,n-1]);
report.plans=[];
const realConsoleInfo=console.info;
console.info=(...args)=>console.error(...args);
for(const limit of [16384,8192]) for(const mib of [512,256]) {
  const budget=mib*1024*1024;
  const plan=dataTextureSlabs(n*4,texture.width,limit,256,budget,4,8);
  const allocations=[],uploads=[];let bound;
  // Actual uploader, fake GL: assert every upload is a view of the real payload.
  // No shader/driver/GPU allocation is claimed by this CPU test.
  const gl={MAX_TEXTURE_SIZE:1,MAX_ARRAY_TEXTURE_LAYERS:2,UNPACK_ALIGNMENT:3,NO_ERROR:0,
    getParameter:p=>p===1?limit:p===2?256:p===3?4:16,
    createTexture:()=>({id:allocations.length}),bindTexture:(target,t)=>{bound=t;},texParameteri(){},pixelStorei(){},
    texStorage3D:(target,levels,format,width,height,layers)=>allocations.push({width,height,layers,bytes:width*height*layers*16}),
    texSubImage3D:(...args)=>{
      const view=args.at(-1);assert.equal(view.buffer,texture.data.buffer);
      uploads.push({slab:bound.id,byteOffset:view.byteOffset,byteLength:view.byteLength});
    },getError:()=>0,deleteTexture(){}};
  const handle=createDataTextureArray(gl,texture.data,texture.width,false,{stride:4,budget});
  assert.equal(getDataTextureSet(handle).textures.length,mib===512?4:7);
  assert.ok(allocations.every(a=>a.bytes<=budget&&a.width<=limit&&a.height<=limit&&a.layers<=256));
  assert.equal(allocations.reduce((sum,a)=>sum+a.bytes,0),header.size);
  let consumed=0;
  for(const view of uploads){assert.equal(view.byteOffset,consumed);consumed+=view.byteLength;}
  assert.equal(consumed,header.size);
  const ids=new Set([0,1,n-2,n-1]);
  for(let slab=1;slab<plan.slabs.length;slab++) {
    const boundary=slab*plan.pointsPerSlab;
    for(const delta of [-2,-1,0,1])ids.add(boundary+delta);
  }
  for(const id of ids) {
    sampleIDs.add(id);
    const slabIndex=Math.floor(id/plan.pointsPerSlab),local=id%plan.pointsPerSlab,slab=plan.slabs[slabIndex];
    const disk=readAt(payloadOffset+id*64,64);
    for(let sub=0;sub<4;sub++) {
      const pixel=local*4+sub,row=Math.floor(pixel/slab.width);
      const x=pixel%slab.width,y=row%slab.height,z=Math.floor(row/slab.height);
      assert.ok(z<slab.layers);
      const globalTexel=slab.start+(z*slab.height+y)*slab.width+x;
      assert.equal(globalTexel,id*4+sub);
      const mapped=Buffer.from(texture.data.buffer,texture.data.byteOffset+globalTexel*16,16);
      assert.ok(mapped.equals(disk.subarray(sub*16,sub*16+16)),`mismatched record ${id}, texel ${sub}`);
    }
    decode(disk);
  }
  report.plans.push({maxTextureSize:limit,budgetMiB:mib,pointsPerSlab:plan.pointsPerSlab,
    slabs:allocations,totalBytes:allocations.reduce((s,a)=>s+a.bytes,0),checkedPoints:ids.size,uploadViews:uploads.length});
  deleteDataTexture(gl,handle);
}
console.info=realConsoleInfo;
let trailingZeroRecords=0;
for(let id=n-1;id>=0;id--) {
  let zero=true;for(let word=0;word<16;word++)if(texture.data[id*16+word]!==0){zero=false;break;}
  if(!zero)break;trailingZeroRecords++;
}
report.trailingZeroRecords=trailingZeroRecords;
if(trailingZeroRecords){sampleIDs.add(n-trailingZeroRecords-1);sampleIDs.add(n-trailingZeroRecords);}
report.samples=[...sampleIDs].sort((a,b)=>a-b).map(index=>({index,fileOffset:payloadOffset+index*64,...decode(readAt(payloadOffset+index*64,64))}));
report.afterVerification=memory();
report.peakRssToFileRatio=report.afterVerification.peakRssBytes/report.fileBytes;
report.peakRssDeltaToPayloadRatio=(report.afterVerification.peakRssBytes-report.baseline.rss)/header.size;
report.arrayBufferBytesToPayloadRatio=report.afterVerification.arrayBuffers/header.size;
closeSync(fd);
if (process.argv.includes('--worker')) {
  // Optional second measurement: real structured-clone delivery and the actual
  // depth worker's decoder. No GPU and no sorting/SIMD cache are allocated here.
  console.error('Measuring real worker structured clone and decoded arrays...');
  report.beforeWorker=memory();
  const workerCode=`
    const {parentPort}=require('node:worker_threads');
    const vm=require('node:vm');
    const allocations=[];
    const TrackedFloat32Array=new Proxy(Float32Array,{construct(target,args){
      if(typeof args[0]==='number')allocations.push(args[0]*4);
      return Reflect.construct(target,args);
    }});
    const self={postMessage(){}};
    vm.runInNewContext(${JSON.stringify('('+createWorker.toString()+')(self);')},
      {self,Float32Array:TrackedFloat32Array,Uint32Array,Int32Array,setTimeout});
    parentPort.on('message',data=>{
      const before=process.memoryUsage();
      const start=performance.now();
      self.onmessage({data});
      parentPort.postMessage({incomingBytes:data.texture.byteLength,allocations,
        decodeMs:performance.now()-start,before,after:process.memoryUsage()});
    });`;
  const worker=new Worker(workerCode,{eval:true});
  try {
    const completed=new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);});
    // Intentionally no transfer list: identical ownership to createSplatWorker.
    worker.postMessage({texture:texture.buffer,remaining:0,gaussStridePixels:texture.gaussStridePixels});
    report.worker=await completed;
    report.afterWorker=memory();
    assert.equal(report.worker.incomingBytes,header.size);
    assert.deepEqual(report.worker.allocations,[n*3*4,n*9*4,n*4]);
  } finally {await worker.terminate();}
}
console.log(JSON.stringify(report,null,2));
