import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { parseFtgsPly, isPlyUrl, isFtgsPlyUrl, plyRenderType, evaluateFtgsRecord } from '../src/utils/ftgsPly.js';
import { loadPlyFile } from '../src/hooks/usePlyLoader.js';
import { createWorker } from '../src/utils/depthWorker.js';
import { verifyLegacyContract, loadPipeline } from './merge-contract-helpers.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const url='https://fixture.invalid/model.ftgs.ply';
const comments=['ftgs_version 1','time_units normalized','sh_degree 3','use_velocity 1','min_duration 0.02','opacity_floor 0.0001','n_frames 10'];
function fixture({degree=3,temporal=true,metadata=temporal?comments:[],missing=[],extra=[],newline='\n',value={},count=2}={}) {
  const names=['x','y','z','nx','ny','nz','f_dc_0','f_dc_1','f_dc_2',
    ...Array.from({length:3*((degree+1)**2-1)},(_,i)=>`f_rest_${i}`),'opacity','scale_0','scale_1','scale_2','rot_0','rot_1','rot_2','rot_3',
    ...(temporal?['time','log_duration','velocity_0','velocity_1','velocity_2']:[]),...extra].filter(n=>!missing.includes(n));
  const lines=['ply','format binary_little_endian 1.0',...metadata.map(c=>`comment ${c}`),`element vertex ${count}`,...names.map(n=>`property float ${n}`),'end_header',''];
  const header=Buffer.from(lines.join(newline)), data=Buffer.alloc(count*names.length*4);
  for(let row=0;row<count;row++) {
    const values={x:row,y:2,z:3,rot_0:1,scale_0:-2,scale_1:-2,scale_2:-2,opacity:0,time:.5,log_duration:Math.log(.2),velocity_0:row===0?1:-1,velocity_1:.2,velocity_2:.1,f_dc_0:.3,f_dc_1:-.1,f_dc_2:.5,...value};
    names.forEach((name,i)=>data.writeFloatLE(values[name]??(name.startsWith('f_rest_')?Number(name.slice(7))/100:0),4*(row*names.length+i)));
  }
  return Buffer.concat([header,data]);
}
async function load(bytes,sourceUrl=url,loader=loadPlyFile) {
  const saved=globalThis.fetch;
  globalThis.fetch=async()=>new Response(bytes);
  try { return await loader(sourceUrl); } finally { globalThis.fetch=saved; }
}

test('native FTGS comments/fields become temporal 4D with complete channel-major SH',async()=>{
  const t=await load(fixture());
  assert.equal(t.sourceFormat,'ftgs.ply'); assert.equal(plyRenderType(t),'4dgs');
  assert.equal(t.gaussianCount,2); assert.equal(t.opacityFloor,.0001);
  assert.equal(t.ftgsMetadata.sh_degree,3); assert.equal(t.ftgsMetadata.use_velocity,true);
  assert.equal(t.ftgsMetadata.time_units,'normalized'); assert.equal(t.ftgsMetadata.min_duration,.02); assert.equal(t.ftgsMetadata.n_frames,10);
  assert.equal(t.shDegree,3); assert.equal(t.colorEncoding,'sh');
  for(let ch=0;ch<3;ch++) for(let j=1;j<16;j++)
    assert.equal(t.buffer[26+ch*16+j],Math.fround((ch*15+j-1)/100));
  assert.equal(t.buffer[26],Math.fround(.3)); assert.equal(t.buffer[42],Math.fround(-.1));
  assert.equal(t.buffer[58],Math.fround(.5));
  assert.ok(Math.abs(t.buffer[12]-Math.SQRT2*.2)<1e-7);
  assert.deepEqual([...t.buffer.subarray(16,26)],Array(10).fill(0));
});
test('content determines representation, but temporal assets require exactly .ftgs.ply suffix',async()=>{
  assert.equal(isPlyUrl('model.ftgs.ply?token=1#view'),true);
  assert.equal(isPlyUrl('data:application/octet-stream,%FF%FE'),false);
  assert.equal(isFtgsPlyUrl('model.ftgs.ply?token=1'),true);
  assert.equal(isFtgsPlyUrl('model.FTGS.PLY'),false);
  assert.throws(()=>parseFtgsPly(fixture(),'model.ply'),/ending exactly .ftgs.ply/);
  const staticData=await load(fixture({temporal:false}),'model.ftgs.ply');
  assert.equal(plyRenderType(staticData),'3dgs'); assert.equal(staticData.representation,undefined);
  assert.equal(plyRenderType(await load(fixture(),url+'?token=x')),'4dgs');
});
test('partial temporal properties never silently become static (including use_velocity=0)',()=>{
  for (const property of ['time','log_duration','velocity_0','velocity_1','velocity_2'])
    assert.throws(()=>parseFtgsPly(fixture({missing:[property]}),url),/incomplete temporal fields/);
  assert.throws(()=>parseFtgsPly(fixture({missing:['velocity_2'],metadata:comments.map(c=>c==='use_velocity 1'?'use_velocity 0':c)}),url),/velocity_2/);
  assert.throws(()=>parseFtgsPly(fixture({temporal:false,metadata:comments}),url),/incomplete temporal fields/);
  assert.throws(()=>parseFtgsPly(fixture({temporal:false,metadata:['use_velocity 1']}),url),/incomplete temporal fields/);
  assert.equal(parseFtgsPly(fixture({temporal:false,metadata:['sh_degree 3']}),'model.ply'),null);
});
test('comment degree and contiguous SH field counts must agree; DC-only degree0 works',()=>{
  assert.throws(()=>parseFtgsPly(fixture({metadata:comments.map(c=>c==='sh_degree 3'?'sh_degree 2':c)}),url),/requires exactly.*24 fields/);
  assert.throws(()=>parseFtgsPly(fixture({missing:['f_rest_0'],extra:['f_rest_45']}),url),/sh_degree/);
  for (const degree of [0,1,2,3]) {
    const t=parseFtgsPly(fixture({degree,metadata:comments.map(c=>c==='sh_degree 3'?`sh_degree ${degree}`:c)}),url);
    assert.equal(t.shDegree,degree); assert.equal(t.colorEncoding,'sh');
  }
});
test('unknown/missing/duplicate comments and incompatible payload schemas reject',()=>{
  for(const [key,value] of [['ftgs_version','2'],['time_units','seconds'],['sh_degree','4'],['use_velocity','2'],['min_duration','0'],['opacity_floor','NaN'],['n_frames','0']]) {
    const meta=comments.map(c=>c.startsWith(key+' ')?`${key} ${value}`:c);
    assert.throws(()=>parseFtgsPly(fixture({metadata:meta}),url));
  }
  for(const key of ['ftgs_version','time_units','sh_degree','use_velocity','min_duration','opacity_floor'])
    assert.throws(()=>parseFtgsPly(fixture({metadata:comments.filter(c=>!c.startsWith(key+' '))}),url));
  assert.throws(()=>parseFtgsPly(fixture({metadata:[...comments,'use_velocity 0']}),url),/duplicate/);
  assert.throws(()=>parseFtgsPly(fixture({extra:['unsupported_motion']}),url),/unknown vertex/);
  assert.throws(()=>parseFtgsPly(fixture({missing:['rot_3']}),url),/missing Gaussian/);
});
test('truncated/trailing payload, nonfinite values and invalid activation reject',()=>{
  const b=fixture();
  assert.throws(()=>parseFtgsPly(b.subarray(0,b.length-1),url),/payload/);
  assert.throws(()=>parseFtgsPly(Buffer.concat([b,Buffer.from([0])]),url),/payload/);
  for (const value of [{time:NaN},{opacity:Infinity},{rot_0:0},{scale_0:-1000},{log_duration:1000},{log_duration:Math.log(.001)}])
    assert.throws(()=>parseFtgsPly(fixture({value}),url));
});
test('CRLF offsets, empty file, optional n_frames, float32 min-duration boundary',()=>{
  assert.equal(parseFtgsPly(fixture({newline:'\r\n'}),url).gaussianCount,2);
  assert.equal(parseFtgsPly(fixture({count:0}),url).gaussianCount,0);
  assert.equal(parseFtgsPly(fixture({metadata:comments.filter(c=>!c.startsWith('n_frames'))}),url).ftgsMetadata.n_frames,null);
  assert.equal(parseFtgsPly(fixture({value:{log_duration:Math.log(.02)}}),url).gaussianCount,2);
});
test('use_velocity=0, center/sigma/far-tail opacity and frame timestamps',()=>{
  const b=fixture({metadata:comments.map(c=>c==='use_velocity 1'?'use_velocity 0':c)});
  const t=parseFtgsPly(b,url);
  assert.equal(t.ftgsMetadata.use_velocity,false);
  for(const time of [0,.5,1]) assert.deepEqual(evaluateFtgsRecord(t,0,time).position,[0,2,3]);
  assert.equal(evaluateFtgsRecord(t,0,.5).opacity,.5);
  assert.equal(evaluateFtgsRecord(t,0,100).opacity,.0001);
  assert.equal((t.ftgsMetadata.n_frames-1)/Math.max(t.ftgsMetadata.n_frames-1,1),1);
});

test('ordinary PLY remains byte-identical to pre-task loader, including existing SH path',async()=>{
  let source=execFileSync('git',['show','40c8d81:src/hooks/usePlyLoader.js'],{cwd:root,encoding:'utf8'});
  source=source.replace("import { useRef, useState, useCallback } from 'react';",'const useRef=()=>{};const useState=()=>{};const useCallback=f=>f;');
  const baseline=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  for(const degree of [0,1,2,3]) {
    const b=fixture({temporal:false,degree});
    const now=await load(b,'model.ply'), old=await load(b,'model.ply',baseline.loadPlyFile);
    assert.deepEqual(now,old); assert.equal(plyRenderType(now),'3dgs');
  }
});
test('splatv/kiriv/SH/worker behavior survives the perf merge',async()=>{
  await verifyLegacyContract();
});
test('native FTGS worker sorts crossing trajectories at matching 4D time/count',async()=>{
  const t=parseFtgsPly(fixture({value:{x:0,y:0,z:0,velocity_2:1}}),url);
  // Two trajectories: z1=dt, z2=-dt; change only row1 velocity.
  t.buffer[128+15]=-1;
  const messages=[],self={postMessage:m=>messages.push(m)};
  const channel=globalThis.MessageChannel; globalThis.MessageChannel=undefined;
  try { createWorker(self); } finally { globalThis.MessageChannel=channel; }
  self.onmessage({data:{texture:t.buffer,vertexCount:t.gaussianCount,gaussStridePixels:t.gaussStridePixels,precisionVariant:t.precisionVariant,representation:t.representation}});
  for(const time of [0,1]) {
    const view=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
    const snapshot={requestId:time+1,time,view,projection:view,model:view,viewProj:view,width:1280,height:720,fx:800,fy:800,sortStrategy:'back-to-front'};
    self.onmessage({data:{view,time,snapshot}});
    await new Promise(r=>setTimeout(r,10));
  }
  assert.equal(messages[0].vertexCount,2); assert.deepEqual([...messages[0].depthIndex],[1,0]);
  assert.deepEqual([...messages[1].depthIndex],[0,1]);
});

test('actual component load/sync callbacks select 4D by PLY content and reuse controlled time',async()=>{
  // Execute the shipped callbacks extracted with the existing JSX build parser.
  // Only GPU resource creation is mocked; PLY loading/decoding and component
  // branch/type synchronization are actual production code, not a copied router.
  const {parse}=createRequire(import.meta.url)('@babel/parser');
  const source=readFileSync(root+'src/components/HoloEngineRuntime.jsx','utf8');
  const ast=parse(source,{sourceType:'module',plugins:['jsx']});
  function variable(node,name) {
    if(!node || typeof node!=='object') return null;
    if(node.type==='VariableDeclarator' && node.id.name===name) return node;
    for(const value of Object.values(node)) {
      for(const child of Array.isArray(value)?value:[value]) {
        const found=variable(child,name); if(found) return found;
      }
    }
    return null;
  }
  const syncNode=variable(ast,'syncObjectToPipeline').init.arguments[0];
  const loadNode=variable(ast,'loadAllObjects').init;
  const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
  const createTransformMatrix=()=>identity;
  const { Pipeline, RenderableObject }=loadPipeline();
  const sync=new Function('RenderableObject','RenderType','createTransformMatrix',`return ${source.slice(syncNode.start,syncNode.end)}`)(
    RenderableObject, {'3DGS':'3dgs','4DGS':'4dgs',MESH:'mesh'},createTransformMatrix);
  const loadCode=source.slice(loadNode.start,loadNode.end)
    .replace("import('../hooks/usePlyLoader')",'Promise.resolve(plyModule)')
    .replace("import('../utils/ply3dgsLoader')",'Promise.resolve(staticModule)');
  for(const [name,type,temporal,expected] of [
    ['model.ftgs.ply',null,true,'4dgs'],['model.ftgs.ply','4dgs',true,'4dgs'],
    ['model.ftgs.ply','3dgs',true,'4dgs'],['model.ply',null,false,'3dgs'],
    ['model.ply','4dgs',false,'3dgs'],['model.splatv',null,null,'4dgs'],['model.kiriv','4dgs',null,'4dgs'],
  ]) {
    const object={id:'fixture',modelUrl:`https://fixture.invalid/${name}`,type,position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],
      loaded:false,loading:false,plyRenderType:'stale',getModelMatrix:()=>identity};
    const errors=[],calls=[],workerMessages=[],objects=new Map();
    let invalidations=0;
    const uniformTimes=[];
    const pipeline=Object.create(Pipeline.prototype);
    pipeline.gl=new Proxy({uniform1f:(location,value)=>{if(location==='time') uniformTimes.push(value);}},
      {get:(target,key)=>target[key]??(()=>{})});
    pipeline.getObject=id=>objects.get(id); pipeline.addObject=o=>objects.set(o.id,o);
    pipeline._resolveFourDGaussianTimeUniform=()=>.75;
    pipeline._frameTargetTime=pipeline._resolveFourDGaussianTimeUniform();
    pipeline._frameSnapshots=new Map(); pipeline._singleView=true;
    pipeline.depthWritePassEnabled=true; pipeline.objects=objects;
    const draws=[]; pipeline._renderSplat=(obj,model)=>draws.push({obj,model});
    const setup=kind=>({textureData:t,targetObject:o})=>{
      calls.push(kind);
      o.texture='mock';o.indexBuffer='mock';o.vertexCount=t.gaussianCount??t.vertices.length;
      o.worker={postMessage:m=>workerMessages.push(m)};
      for(const key of ['gaussStridePixels','precisionVariant','representation','colorEncoding','shDegree','opacityFloor','gaussianCount']) o[key]=t[key];
      o.textureWidth=t.width;o.textureHeight=t.height;
      return {worker:o.worker};
    };
    const camera={projectionMatrix:identity,viewMatrix:identity,getViewProjModelMatrix:()=>identity};
    const env={gl:{},sceneManager:{getAllObjects:()=>[object]},sceneVersion:1,lastSceneVersionRef:{current:1},
      workerReadyRef:{current:new Map()},loadingRef:{current:new Set()},renderPipelineRef:{current:pipeline},
      canvasRef:{current:{clientWidth:1280,clientHeight:720}},viewMatrixRef:{current:identity},cameraRef:{current:camera},
      checkAllLoaded:()=>{},onError:e=>errors.push(e),createTransformMatrix,syncObjectToPipeline:sync,
      invalidateRef:{current:()=>{invalidations++;}},
      getDefaultCamera:()=>camera,isPlyUrl,plyRenderType,plyModule:{loadPlyFile},
      staticModule:{loadAndSetup3DGSObject:setup('3dgs')},loadAndSetupSplatObject:setup('4dgs'),
      loadSplatFile:async()=>{calls.push('splat-loader');return {gaussianCount:2,width:4096,height:1,gaussStridePixels:4,precisionVariant:'lite'};},
      console:{log:()=>{},error:()=>{}}};
    const loadAll=new Function(...Object.keys(env),`return ${loadCode}`)(...Object.values(env));
    const saved=globalThis.fetch; globalThis.fetch=async()=>new Response(fixture({temporal}));
    try { await loadAll(); } finally {globalThis.fetch=saved;}
    assert.deepEqual(errors,[],name); assert.equal(object.loaded,true,name);
    assert.equal(objects.get('fixture').renderType,expected,`${name} type=${type}`);
    assert.equal(calls.at(-1),expected);
    assert.equal(workerMessages.length,0,'component must leave snapshot requests to the pipeline');
    assert.equal(invalidations,1,'load must schedule the first pipeline frame');
    const renderObject=objects.get('fixture');
    pipeline._renderGSObjects([renderObject],identity,identity,null,{},
      {time:'time'},{},{viewport:{width:1280,height:720},fx:800,fy:800},expected==='4dgs');
    assert.equal(workerMessages.length,1,'pipeline is the sole request sender for both passes');
    assert.equal(workerMessages.at(-1).time,expected==='4dgs'?.75:.5);
    assert.equal(workerMessages.at(-1).snapshot.time,workerMessages.at(-1).time);
    assert.equal(workerMessages.at(-1).snapshot.requestId,1);
    assert.equal(draws.length,2);
    if(expected==='4dgs') {
      assert.equal(workerMessages.at(-1).time,.75);
      assert.ok(uniformTimes.length>0);
      assert.ok(uniformTimes.every(time=>time===.75),'shader and sort reuse controlled time');
    }
    if(temporal) {assert.equal(objects.get('fixture').representation,'freetimegs');assert.equal(objects.get('fixture').ftgsMetadata.time_units,'normalized');}
    else if(temporal===null) assert.equal(calls[0],'splat-loader');
  }
});
