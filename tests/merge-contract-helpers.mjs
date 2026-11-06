import { createDataTextureArray } from '../src/utils/dataTextureArray.js';
// Behavioral replacement for the temporary 40c8d81 source-byte lock.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseKiriV, KIRIV_MAGIC } from '../src/utils/kiriv.js';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const old = path => execFileSync('git', ['show', `40c8d81:${path}`], { cwd: new URL('../', import.meta.url), encoding: 'utf8' });
export const identity4 = () => [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
function moduleVM(source, names, globals = {}) {
  source = source.replace(/^import .*;$/gm, '').replace(/^export \{[^\n]*\} from .*;$/gm, '').replace(/export /g, '');
  return vm.runInNewContext(source + '\n;({' + names.join(',') + '});', globals);
}
export function loadPipeline() {
  return moduleVM(read('src/core/utils/holoRP.js') + '\nconst Pipeline=HoloRP;', ['Pipeline','RenderableObject'], {
    dataTextureVariant: () => null,
    createTransformMatrix: identity4,
    identity4, multiply4: (a,b) => a.map((_,i) => [0,1,2,3].reduce((sum,k) => sum+a[k*4+i%4]*b[Math.floor(i/4)*4+k],0)),
  });
}
function uniforms() {
  const source = read('src/hooks/useWebGL.js');
  const result = {};
  for (const name of ['uniformsRef', 'uniforms3DGSRef']) {
    const block = source.match(new RegExp(name + '\\.current = (\\{[\\s\\S]*?\\n      \\});'));
    assert.ok(block, name);
    result[name] = new Function('glContext','shaderProgram','shaderProgram3DGS', 'return ' + block[1])(
      { getUniformLocation: (program,name) => `${program}:${name}` }, '4d', '3d');
  }
  return result;
}
function nativeFile() {
  const header = {representations:'freetimegs',payload_layout:'native',gaussian_count:1,record_bytes:116,size:116,
    color_encoding:'sh',sh_degree:0,render_profile:'ftgs',opacity_floor:.0001,
    time:{units:'normalized',range:[0,1],fps:null,n_frames:10},
    coordinates:{space:'training',axis_convention:'unspecified',world_from_file:null},losses:[]};
  const a = new Float32Array(29);
  a.set([1,2,3,1,0,0,0,-1,-2,-3,0,.5,Math.log(.2),.7,-.4,.1]); a.set([.2,-.1,.3],26);
  const json=Buffer.from(JSON.stringify(header)), start=Math.ceil((12+json.length)/16)*16;
  const bytes=Buffer.alloc(start+a.byteLength);
  bytes.writeUInt32LE(KIRIV_MAGIC);bytes.writeUInt16LE(2,4);bytes.writeUInt32LE(json.length,8);
  json.copy(bytes,12);Buffer.from(a.buffer).copy(bytes,start);
  return bytes;
}

export async function verifyLegacyContract() {
  // useWebGL -> HoloRP: execute actual uniform registration and actual per-object upload.
  const { uniformsRef:u, uniforms3DGSRef:u3 } = uniforms();
  const { Pipeline } = loadPipeline();
  const values = new Map(), draws=[];
  const pipeline=Object.create(Pipeline.prototype);
  pipeline.gl=new Proxy({uniform1i:(k,v)=>values.set(k,v),uniform1ui:(k,v)=>values.set(k,v),
    uniform1f:(k,v)=>values.set(k,v),drawArraysInstanced:(...v)=>draws.push(v)},
    {get:(target,key)=>target[key]??(()=>{})});
  const cases=[
    [{precisionVariant:'lite'},[0,0,0,0,0,2,0]],
    [{precisionVariant:'hp_scale_rot',gaussStridePixels:8},[0,0,0,0,0,3,1]],
    [{precisionVariant:'kiriv_f32',representation:'freetimegs',colorEncoding:'sh',shDegree:3,opacityFloor:.0001,textureWidth:4096},[1,1,1,3,.0001,5,0]],
  ];
  for (const [metadata,expected] of cases) {
    values.clear();
    pipeline._renderSplat({...metadata,isReady:()=>true,texture:{},vertexCount:2},identity4(),{},u,{},true);
    assert.deepEqual(['kiriv','freetimegs','kirivSH','kirivSHDegree','kirivOpacityFloor','strideColShift','useHpScaleRot'].map(k=>values.get(u[k])),expected);
  }
  pipeline._renderSplat({isReady:()=>true,texture:{},shTexture:{},sphericalHarmonicsDegree:3,vertexCount:2},identity4(),{},u3,{},false);
  assert.equal(values.get(u3.shTexture),1); assert.equal(values.get(u3.sphericalHarmonicsDegree),3);
  assert.equal(draws.length,4); assert.ok(draws.every(v=>v[3]===2));

  // splatObjectLoader: effective count, metadata, and exact upload data survive setup.
  const requests=[],uploads=[], worker={postMessage:m=>requests.push(m)};
  const loader=moduleVM(read('src/utils/splatObjectLoader.js'),['calculateVertexCount','loadAndSetupSplatObject'],
    {createDataTextureArray,createDepthWorker:()=>worker,getGLErrorName:()=>'',Uint32Array,Float32Array});
  const texture=parseKiriV(nativeFile()), target={};
  const gl=new Proxy({NO_ERROR:0,getError:()=>0,getParameter:()=>16384,createTexture:()=>({}),createBuffer:()=>({}),texSubImage3D:(...args)=>uploads.push(args)},
    {get:(target,key)=>target[key]??(()=>{})});
  loader.loadAndSetupSplatObject({gl,textureData:texture,targetObject:target});
  assert.equal(target.vertexCount,1); assert.equal(requests[0].vertexCount,1);
  assert.equal(requests[0].gaussStridePixels,32); assert.equal(requests[0].precisionVariant,'kiriv_f32');
  assert.equal(requests[0].representation,'freetimegs');
  assert.equal(target.representation,'freetimegs');assert.equal(target.colorEncoding,'sh');assert.equal(target.shDegree,0);
  assert.deepEqual(uploads[0].at(-1),texture.data);
  assert.equal(uploads[0].at(-1).buffer,texture.data.buffer);
  assert.equal(loader.calculateVertexCount(texture.buffer,32,1),1);
  assert.throws(()=>loader.calculateVertexCount(texture.buffer,32,1000000),/gaussian_count/);

  // ply3dgsLoader: compare every uploaded SH float with the previous implementation.
  const vertices=Array.from({length:2},(_,row)=>Object.fromEntries([
    ...Array.from({length:3},(_,i)=>[`f_dc_${i}`,row+i/4]),
    ...Array.from({length:45},(_,i)=>[`f_rest_${i}`,row+i/64]),
  ]));
  const shUploads=source=>{
    const out=[];
    const {createSHTexture}=moduleVM(source,['createSHTexture'],{Float32Array,createDataTextureArray});
    const gl=new Proxy({NO_ERROR:0,getError:()=>0,getParameter:()=>16384,createTexture:()=>({}),texSubImage3D:(...args)=>out.push(args.at(-1)),texImage2D:(...args)=>out.push(args.at(-1))},{get:(target,key)=>target[key]??(()=>{})});
    assert.equal(createSHTexture(gl,vertices,0),null);
    for(const degree of [1,2,3]) createSHTexture(gl,vertices,degree);
    return out;
  };
  assert.deepEqual(shUploads(read('src/utils/ply3dgsLoader.js')),shUploads(old('src/utils/ply3dgsLoader.js')));

  // gaussian3dShaders: evaluate the shipped scalar alpha/depth expressions
  // against the old shader, independently of the perf-only geometry cutoff.
  const staticColor=source=>{
    const block=source.match(/float depthF = [^;]+;\s*float depthEff = [^;]+;\s*float aEff = [^;]+;/);
    assert.ok(block);
    assert.match(source,/vColor = depthEff \* vec4\(splat.rgb, aEff\);/);
    return new Function('pos_proj','scaleT','splat','clamp','mix',
      block[0].replace(/float /g,'const ')+';return [...splat.rgb.map(c=>depthEff*c),depthEff*aEff];');
  };
  const staticNow=staticColor(read('src/shaders/gaussian3dShaders.js'));
  const staticOld=staticColor(old('src/shaders/gaussian3dShaders.js'));
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x)), mix=(a,b,t)=>a*(1-t)+b*t;
  for(const z of [-2,-1,-.5,0,1]) for(const scaleT of [0,.5,1]) for(const alpha of [0,.5,1]) {
    const args=[{z,w:1},scaleT,{rgb:[.25,.5,.75],a:alpha},clamp,mix];
    assert.deepEqual(staticNow(...args),staticOld(...args));
  }

  // kiriv/cpu-probe/validate CLI: execute the actual tools, compare all decoded records,
  // samples and shader SH bases with the old reader and the old shader's expressions.
  const baseline=await import(`data:text/javascript;base64,${Buffer.from(old('src/utils/kiriv.js')).toString('base64')}`);
  const bytes=nativeFile(); assert.deepEqual(parseKiriV(bytes),baseline.parseKiriV(bytes));
  const dir=mkdtempSync(join(tmpdir(),'her-contract-')), asset=join(dir,'sample.kiriv'), request=join(dir,'request.json');
  writeFileSync(asset,bytes);
  const directions=[[1,0,0],[0,1,0],[0,0,1],[.6,0,.8]];
  writeFileSync(request,JSON.stringify({files:[{path:asset,rows:[0]}],directions}));
  const options={timeout:15000,maxBuffer:1024*1024,encoding:'utf8'};
  const validated=JSON.parse(execFileSync(process.execPath,[new URL('./validate-kiriv.mjs',import.meta.url).pathname,asset],options));
  assert.deepEqual(validated,{validated:true,gaussian_count:1,representation:'freetimegs',layout:'native',runtime_bytes:texture.buffer.byteLength});
  const probe=JSON.parse(execFileSync(process.execPath,[new URL('./cpu-probe.mjs',import.meta.url).pathname,request],options));
  assert.deepEqual(probe.files[0].header,texture.kirivHeader);
  assert.deepEqual(probe.files[0].records[0].record,[...texture.buffer.subarray(0,74)]);
  for(const sample of probe.files[0].records[0].samples) {
    const {time,...value}=sample;
    assert.deepEqual(value,baseline.evaluateKiriVRecord(texture.buffer,'freetimegs',time,.0001));
  }
  const assignments=[...old('src/shaders/splatShaders.js').matchAll(/b\[\d+\]\s*=[^;]+;/g)].map(m=>m[0]).join('\n');
  const bases=new Function('x','y','z',`const z2=z*z,b=[];${assignments};return b;`);
  const actualAssignments=[...read('src/shaders/splatShaders.js').matchAll(/b\[\d+\]\s*=[^;]+;/g)].map(m=>m[0]).join('\n');
  const actualBases=new Function('x','y','z',`const z2=z*z,b=[];${actualAssignments};return b;`);
  assert.deepEqual(directions.map(d=>actualBases(...d)),directions.map(d=>bases(...d)));
  // JSON has no signed-zero encoding; compare CLI output to the old values
  // through the same serialization, after strict signed-zero equality above.
  assert.deepEqual(probe.shader_bases,JSON.parse(JSON.stringify(directions.map(d=>bases(...d)))));
  writeFileSync(asset,bytes.subarray(0,bytes.length-1));
  const invalid=spawnSync(process.execPath,[new URL('./validate-kiriv.mjs',import.meta.url).pathname,asset],options);
  assert.notEqual(invalid.status,0);assert.match(invalid.stderr,/payload/);
  // Loader stream/layout, worker indices/count, and KiriV validation/degeneracies
  // are exercised by the retained kiriv.test.mjs and ftgs-ply.test.mjs cases.
}
