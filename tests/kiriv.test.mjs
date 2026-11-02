import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseKiriV, validateLegacyChunk, KIRIV_MAGIC, evaluateKiriVRecord } from '../src/utils/kiriv.js';
import { createWorker } from '../src/utils/depthWorker.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const baseHeader = () => ({ representations:'freetimegs', payload_layout:'native', gaussian_count:1,
  record_bytes:116, size:116, color_encoding:'sh', sh_degree:0, render_profile:'ftgs', opacity_floor:0.0001,
  time:{ units:'normalized',range:[0,1],fps:null,n_frames:10 },
  coordinates:{space:'training',axis_convention:'unspecified',world_from_file:null}, losses:[] });
function record() {
  const a = new Float32Array(29);
  a.set([1,2,3,1,0,0,0, -1,-2,-3, 0,0.5, Math.log(0.2), 0.7,-0.4,0.1]);
  a.set([0.2,-0.1,0.3],26);
  return a;
}
function file(h=baseHeader(), a=record()) {
  const json = Buffer.from(JSON.stringify(h));
  const start = Math.ceil((12+json.length)/16)*16;
  const result=Buffer.alloc(start+a.byteLength);
  result.writeUInt32LE(KIRIV_MAGIC); result.writeUInt16LE(2,4); result.writeUInt32LE(json.length,8);
  json.copy(result,12); Buffer.from(a.buffer,a.byteOffset,a.byteLength).copy(result,start);
  return result;
}
function badHeader(key,value,pattern) {
  const h=baseHeader(); h[key]=value;
  assert.throws(()=>parseKiriV(file(h)),pattern);
}

test('native FTGS + count excludes runtime texture padding',()=>{
  const t=parseKiriV(file());
  assert.equal(t.gaussianCount,1); assert.equal(t.gaussStridePixels,32);
  assert.equal(t.buffer[13],Math.fround(0.7));
  assert.equal(t.buffer[26],Math.fround(0.2));
  assert.ok(t.buffer.length>128);
});
test('unknown semantic tags and version/flags reject',()=>{
  for (const [k,v,p] of [['representations','unknown',/representations/],['payload_layout','auto',/payload_layout/],
    ['sh_degree',4,/SH degree/],['color_encoding','decoder',/color_encoding/],['render_profile','auto',/profile/],
    ['gaussian_count',1.5,/count/],['record_bytes',120,/size/],['size',0,/size/],['opacity_floor',-1,/profile/]]) badHeader(k,v,p);
  const v=file(); v.writeUInt16LE(3,4); assert.throws(()=>parseKiriV(v),/version/);
  const flags=file(); flags.writeUInt16LE(1,6); assert.throws(()=>parseKiriV(flags),/flags/);
  const magic=file(); magic.writeUInt32LE(0,0); assert.throws(()=>parseKiriV(magic),/magic/);
});
test('truncation, overflow, trailing bytes and malformed UTF8 reject',()=>{
  const b=file();
  for (const n of [0,4,8,11,12,20,b.length-1]) assert.throws(()=>parseKiriV(b.subarray(0,n)));
  assert.throws(()=>parseKiriV(Buffer.concat([b,Buffer.from([0])])),/payload/);
  const huge=file(); huge.writeUInt32LE(0xffffffff,8); assert.throws(()=>parseKiriV(huge),/length/);
  const utf=file(); utf[12]=0xff; assert.throws(()=>parseKiriV(utf));
  const h=baseHeader(); h.gaussian_count=Number.MAX_SAFE_INTEGER; h.size=Number.MAX_SAFE_INTEGER;
  assert.throws(()=>parseKiriV(file(h)),/size/);
});
test('native nonfinite, invalid scales, zero quaternion, FTGS nonlinear coefficients reject',()=>{
  for (const [slot,value] of [[0,NaN],[10,Infinity],[7,-1000],[12,-1000],[16,1],[22,1]]) {
    const a=record(); a[slot]=value; assert.throws(()=>parseKiriV(file(baseHeader(),a)));
  }
  const a=record(); a.fill(0,3,7); assert.throws(()=>parseKiriV(file(baseHeader(),a)),/quaternion/);
});
test('timeline, affine metadata, reserved bytes, preview quantization validate',()=>{
  badHeader('time',{units:'ticks',range:[0,1],fps:null,n_frames:null},/timeline/);
  badHeader('time',{units:'seconds',range:[1,1],fps:null,n_frames:null},/timeline/);
  badHeader('coordinates',{space:'training',axis_convention:'unknown',world_from_file:Array(16).fill(0)},/affine/);
  const h=baseHeader(); Object.assign(h,{payload_layout:'standard',color_encoding:'rgb',record_bytes:64,size:64});
  const a=Buffer.alloc(64); a.writeUInt16LE(0x3c00,12); a.writeUInt16LE(0x3c00,20); a.writeUInt16LE(0x3c00,22); a.writeUInt16LE(0x3c00,24); a.writeUInt16LE(0x3c00,62);
  assert.equal(parseKiriV(file(h,a)).gaussianCount,1);
  a[26]=1; assert.throws(()=>parseKiriV(file(h,a)),/reserved/);
  Object.assign(h,{payload_layout:'preview',record_bytes:56,size:56});
  assert.throws(()=>parseKiriV(file(h,Buffer.alloc(56))),/quantization/);
});
test('timeline mapping normalizes position and angular polynomials',()=>{
  const h=baseHeader(); h.time={units:'seconds',range:[2,6],fps:30,n_frames:121};
  const a=record(); a[11]=4;
  const t=parseKiriV(file(h,a));
  assert.equal(t.buffer[11],0.5);
  assert.equal(t.buffer[13],Math.fround(a[13]*4));
  assert.ok(Math.abs(t.buffer[12]-Math.SQRT2*Math.exp(a[12])/4)<1e-8);
});
test('empty native file is valid',()=>{
  const h=baseHeader(); h.gaussian_count=0; h.size=0;
  assert.equal(parseKiriV(file(h,new Float32Array(0))).gaussianCount,0);
});
test('legacy defaults STG, validates lite/high, rejects incompatible declarations',()=>{
  const c={type:'splat',size:65536,texwidth:4096,texheight:1};
  assert.deepEqual(validateLegacyChunk(c),{representation:'stg',precisionVariant:'lite',gaussStridePixels:4});
  assert.equal(validateLegacyChunk({...c,precision_variant:'hp_scale_rot',gauss_stride_pixels:8}).gaussStridePixels,8);
  for (const override of [{representations:'freetimegs'},{representations:'unknown'},{precision_variant:'other'},{payload_layout:'native'},{gauss_stride_pixels:8},{size:65535},{format_version:3},{representations:'stg',representation:'unknown'}]) assert.throws(()=>validateLegacyChunk({...c,...override}));
});

// Execute actual hook code without React/browser/GPU. React state/ref adapters
// expose the returned object; all parsing/streaming functions are the real source.
async function hook(source) {
  source=source.replace("import { useRef, useState, useCallback } from 'react';",
    'const useRef=(current)=>({current}); const useState=()=>[null,()=>{}]; const useCallback=f=>f;');
  source=source.replace("'../utils/kiriv'",JSON.stringify(new URL('../src/utils/kiriv.js',import.meta.url).href));
  return (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)).useSplatLoader();
}
async function loadBytes(loader, bytes, fragmented=false) {
  const oldFetch=globalThis.fetch;
  globalThis.fetch=async()=>new Response(new ReadableStream({ start(c){
    if(fragmented) { c.enqueue(bytes.subarray(0,3)); c.enqueue(bytes.subarray(3,7)); c.enqueue(bytes.subarray(7,97)); c.enqueue(bytes.subarray(97)); }
    else c.enqueue(bytes);
    c.close();
  }}),{status:200});
  try { return await loader.loadSplatFile('https://fixture.invalid/file'); }
  finally { globalThis.fetch=oldFetch; }
}
const oldSource=execFileSync('git',['show','9efdc47:src/hooks/useSplatLoader.js'],{cwd:root,encoding:'utf8'});
const newSource=readFileSync(new URL('../src/hooks/useSplatLoader.js',import.meta.url),'utf8');
test('old reader explicitly rejects new magic; new hook accepts fragmented v2',async()=>{
  // Expected failures log in the production hook; silence only this test output.
  const prev=console.error; console.error=()=>{};
  try {
    const old=await hook(oldSource); await assert.rejects(()=>loadBytes(old,file()),/does not look like a splatv/);
    const now=await hook(newSource); assert.equal((await loadBytes(now,file(),true)).gaussianCount,1);
    await assert.rejects(()=>loadBytes(now,file().subarray(0,10)),/truncated/i);
  } finally { console.error=prev; }
});

test('real legacy asset returns identical texture/count/layout/cameras through old and new hooks',async()=>{
  const path=process.env.KIRIV_LEGACY_FIXTURE;
  assert.ok(path,'set KIRIV_LEGACY_FIXTURE to the real iteration_5.splatv');
  const bytes=readFileSync(path), old=await hook(oldSource), now=await hook(newSource);
  const a=await loadBytes(old,bytes), b=await loadBytes(now,bytes,true);
  assert.deepEqual(b,a); // byte-for-byte data, floats including padding, cameras and stride
  console.log(JSON.stringify({legacy_regression_bytes:bytes.length,count:b.data.length/(b.gaussStridePixels*4),precision:b.precisionVariant}));
});
test('legacy hp_scale_rot hook path matches old reader byte for byte',async()=>{
  const payload=Buffer.alloc(4096*16);
  payload.writeFloatLE(2,0); payload.writeUInt16LE(0x3c00,12);
  payload.writeUInt16LE(0x3c00,20); payload.writeUInt16LE(0x3c00,22); payload.writeUInt16LE(0x3c00,24);
  payload.writeUInt16LE(0x3c00,62);
  payload.writeFloatLE(1,64); payload.writeFloatLE(1,80); payload.writeFloatLE(1,84); payload.writeFloatLE(1,88);
  const h=Buffer.from(JSON.stringify([{type:'splat',size:payload.length,texwidth:4096,texheight:1,precision_variant:'hp_scale_rot',gauss_stride_pixels:8}]));
  const b=Buffer.alloc(8+h.length+payload.length); b.writeUInt32LE(0x674b); b.writeUInt32LE(h.length,4); h.copy(b,8); payload.copy(b,8+h.length);
  const old=await hook(oldSource),now=await hook(newSource);
  assert.deepEqual(await loadBytes(now,b,true),await loadBytes(old,b));
});
async function sortAtTimes(factory,texture,extra={}) {
  const messages=[],self={postMessage:m=>messages.push(m)};
  const channel=globalThis.MessageChannel; globalThis.MessageChannel=undefined;
  try { factory(self); } finally { globalThis.MessageChannel=channel; }
  self.onmessage({data:{texture,gaussStridePixels:4,...extra}});
  for (const time of [0,0.5,1]) {
    const view=[1,0,.2,0,0,1,.3,0,0,0,1,0,0,0,0,1];
    const snapshot={requestId:1+time*2,time,view,projection:view,model:view,viewProj:view,width:1280,height:720,fx:800,fy:800,sortStrategy:'back-to-front'};
    self.onmessage({data:{view,time,snapshot}});
    await new Promise(r=>setTimeout(r,10));
  }
  return messages.map(m=>({time:m.time,vertexCount:m.vertexCount,depthIndex:m.depthIndex}));
}
test('legacy motion worker produces identical sort indices at t=0/.5/1',async()=>{
  let source=execFileSync('git',['show','9efdc47:src/utils/depthWorker.js'],{cwd:root,encoding:'utf8'});
  source=source.replace('function createWorker(self)', 'export function createWorker(self)');
  const old=(await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)).createWorker;
  const loader=await hook(newSource);
  const texture=(await loadBytes(loader,readFileSync(process.env.KIRIV_LEGACY_FIXTURE))).buffer;
  const a=await sortAtTimes(old,texture),b=await sortAtTimes(createWorker,texture);
  assert.equal(a.length,3); assert.deepEqual(b,a);
});
test('FTGS worker orders crossing linear trajectories at matching time',async()=>{
  const texture=new Float32Array(4096*4);
  for(let row=0;row<2;row++) {texture[row*128+11]=0.5; texture[row*128+15]=row===0?2:-2;}
  const sorted=await sortAtTimes(createWorker,texture,{vertexCount:2,gaussStridePixels:32,precisionVariant:'kiriv_f32',representation:'freetimegs'});
  assert.deepEqual([...sorted[0].depthIndex],[1,0]);
  assert.deepEqual([...sorted[2].depthIndex],[0,1]);
});
test('worker uses effective count + float32 FTGS motion, excludes texture padding',async()=>{
  const t=parseKiriV(file());
  const messages=[];
  const self={postMessage:m=>messages.push(m)};
  // Remove MessageChannel only while constructing worker to use deterministic timer pump.
  const channel=globalThis.MessageChannel; globalThis.MessageChannel=undefined;
  try { createWorker(self); } finally { globalThis.MessageChannel=channel; }
  self.onmessage({data:{texture:t.buffer,vertexCount:1,gaussStridePixels:32,precisionVariant:'kiriv_f32',representation:'freetimegs'}});
  const view=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
  const snapshot={requestId:1,time:0,view,projection:view,model:view,viewProj:view,width:1280,height:720,fx:800,fy:800,sortStrategy:'back-to-front'};
  self.onmessage({data:{view,time:0,snapshot}});
  await new Promise(r=>setTimeout(r,10));
  assert.equal(messages[0].vertexCount,1); assert.deepEqual([...messages[0].depthIndex],[0]);
  assert.throws(()=>self.onmessage({data:{texture:t.buffer,vertexCount:1000000}}),/vertexCount/);
});
test('formula degeneracy: FTGS == zero-higher-order STG except alpha floor',()=>{
  const a=parseKiriV(file()).buffer;
  for(const t of [0,0.5,1,a[11],a[11]-a[12]/Math.SQRT2,a[11]+a[12]/Math.SQRT2]) {
    const ft=evaluateKiriVRecord(a,'freetimegs',t,0), stg=evaluateKiriVRecord(a,'stg',t,0);
    assert.deepEqual(ft,stg);
  }
  assert.equal(evaluateKiriVRecord(a,'freetimegs',100,0.0001).opacity,0.0001);
});
test('degenerate zero velocity/single frame, narrow sigma and STG temporal cutoff boundary',()=>{
  const h=baseHeader(); h.time.n_frames=1;
  const raw=record(); raw.fill(0,13,26); raw[12]=-20;
  const a=parseKiriV(file(h,raw)).buffer;
  for(const t of [0,.5,1,a[11],a[11]-a[12]/Math.SQRT2,a[11]+a[12]/Math.SQRT2]) {
    const result=evaluateKiriVRecord(a,'freetimegs',t,0.0001);
    assert.deepEqual(result.position,[1,2,3]); assert.ok(Number.isFinite(result.opacity));
  }
  assert.equal(evaluateKiriVRecord(a,'freetimegs',a[11],0.0001).weight,1);
  const b=parseKiriV(file()).buffer;
  const t=b[11]+b[12]*Math.sqrt(-Math.log(.02));
  assert.ok(Math.abs(evaluateKiriVRecord(b,'stg',t).weight-.02)<1e-15);
});
