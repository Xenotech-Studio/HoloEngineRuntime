// PLAYWRIGHT_MODULE and CHROMIUM_PATH may point to existing local installations.
import { readFileSync } from 'node:fs';
import { vertexShaderSource, fragmentShaderSource } from '../src/shaders/splatShaders.js';
import { vertexShader3DGSSource, fragmentShader3DGSSource } from '../src/shaders/gaussian3dShaders.js';
import { dataTextureShader } from '../src/shaders/dataTextureShader.js';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless:true, executablePath:process.env.CHROMIUM_PATH,
  args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
try {
  const page=await browser.newPage();
  const result=await page.evaluate(async ({sources,uploader,shaderHelper,binding})=>{
    const moduleURL=source=>URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
    const {createDataTextureArray,getDataTextureSet,deleteDataTexture,dataTextureUnits}=await import(moduleURL(uploader));
    const {dataTextureShader}=await import(moduleURL(shaderHelper));
    const gl=document.createElement('canvas').getContext('webgl2');
    if(!gl)throw Error('WebGL2 unavailable');
    function shader(type,source) {
      const s=gl.createShader(type);gl.shaderSource(s,source.trim());gl.compileShader(s);
      if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;
    }
    function program(vs,fs,feedback=false) {
      const p=gl.createProgram();gl.attachShader(p,shader(gl.VERTEX_SHADER,vs));gl.attachShader(p,shader(gl.FRAGMENT_SHADER,fs));
      if(feedback)gl.transformFeedbackVaryings(p,['value'],gl.INTERLEAVED_ATTRIBS);
      gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));return p;
    }
    const {bindDataTexture,dataTextureVariant}=new Function('getDataTextureSet','dataTextureUnits','dataTextureShader','vertexShaderSource','fragmentShaderSource','vertexShader3DGSSource','fragmentShader3DGSSource','createShader',
      binding.replace(/^import .*;$/gm,'').replace(/export /g,'')+'\nreturn {bindDataTexture,dataTextureVariant};')(
      getDataTextureSet,dataTextureUnits,dataTextureShader,...sources.flat(),(_,type,source)=>shader(type,source));
    let compiledPrograms=0,readbackCases=0;
    for(const [vertex,fragment] of sources) for(const count of [1,4,7,8]) {
      const source=vertex.replace(dataTextureShader('u_texture'),dataTextureShader('u_texture',count));
      gl.deleteProgram(program(source,fragment));compiledPrograms++;
    }
    const makeLimited=()=>new Proxy(gl,{get(target,key){
      if(key==='getParameter')return p=>p===gl.MAX_TEXTURE_SIZE?8:p===gl.MAX_ARRAY_TEXTURE_LAYERS?256:gl.getParameter(p);
      const v=target[key];return typeof v==='function'?v.bind(target):v;
    }});
    for(const float of [false,true]) for(const stride of float?[3,8,15]:[4,8,32]) for(const budget of [stride*16*8,512*1024*1024]) {
      const limited=makeLimited();
      const Type=float?Float32Array:Uint32Array, n=21;
      const data=Type.from({length:stride*n*4},(_,i)=>float?i/8-50:i+100);
      gl.activeTexture(gl.TEXTURE0);
      const texture=createDataTextureArray(limited,data,16,float,{stride,budget});
      const set=getDataTextureSet(texture), count=set.textures.length;
      if(count !== (budget === 512*1024*1024 ? 1 : 3)) throw Error(`Unexpected sampler count ${count}`);
      const p=program(`#version 300 es
        precision highp float; precision highp int;
        ${dataTextureShader('u_texture',count,float)}
        in int index; flat out ${float?'vec4':'uvec4'} value;
        void main(){value=fetch_u_texture(uint(index),${stride-1}u,${stride}u);gl_Position=vec4(0);}`,
        '#version 300 es\nprecision highp float;out vec4 color;void main(){color=vec4(1);}',true);
      gl.useProgram(p);bindDataTexture(gl,p,texture,'u_texture');
      const indices=Int32Array.from({length:n},(_,i)=>n-1-i);
      const input=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,input);gl.bufferData(gl.ARRAY_BUFFER,indices,gl.STATIC_DRAW);
      const loc=gl.getAttribLocation(p,'index');gl.enableVertexAttribArray(loc);gl.vertexAttribIPointer(loc,1,gl.INT,0,0);
      const output=gl.createBuffer();gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,output);gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER,n*16,gl.STREAM_READ);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,output);gl.enable(gl.RASTERIZER_DISCARD);gl.beginTransformFeedback(gl.POINTS);
      gl.drawArrays(gl.POINTS,0,n);gl.endTransformFeedback();gl.disable(gl.RASTERIZER_DISCARD);
      const values=new Type(n*4);gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER,0,values);
      for(let i=0;i<n;i++)for(let ch=0;ch<4;ch++) {
        const expected=data[(indices[i]*stride+stride-1)*4+ch];
        if(values[i*4+ch]!==expected)throw Error(`float=${float}, stride=${stride}, count=${count}, index=${indices[i]}: ${values[i*4+ch]} != ${expected}`);
      }
      if(gl.getError()!==gl.NO_ERROR)throw Error('WebGL readback error');
      readbackCases++;deleteDataTexture(gl,texture);gl.deleteProgram(p);gl.deleteBuffer(input);gl.deleteBuffer(output);
    }
    // Exercise production lazy specialization and uniform copying for both passes.
    const limited=makeLimited();
    const texture=createDataTextureArray(limited,new Uint32Array(21*32*4),8,false,{stride:32,budget:2048});
    const shTexture=createDataTextureArray(limited,new Float32Array(21*15*4),8,true,{stride:15,budget:2048});
    let variantCases=0;
    for(let i=0;i<2;i++) {
      const base=program(...sources[i]), cache=new Map();gl.useProgram(base);
      const matrix=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,3,4,5,1]);
      gl.uniformMatrix4fv(gl.getUniformLocation(base,'view'),false,matrix);
      for(const depth of [0,1]) {
        gl.useProgram(base);gl.uniform1i(gl.getUniformLocation(base,'depthWriteOnly'),depth);
        const v=dataTextureVariant(gl,cache,base,{texture,shTexture:i?shTexture:null},!i);
        const copied=gl.getUniform(v.program,gl.getUniformLocation(v.program,'view'));
        if(Array.from(copied).join()!==Array.from(matrix).join())throw Error('Snapshot uniform mismatch');
        if(Number(gl.getUniform(v.program,gl.getUniformLocation(v.program,'depthWriteOnly')))!==depth)throw Error('Depth pass mismatch');
        if(gl.getError()!==gl.NO_ERROR)throw Error('Variant binding error');
        variantCases++;
      }
      for(const v of cache.values())gl.deleteProgram(v.program);gl.deleteProgram(base);
    }
    deleteDataTexture(gl,texture);deleteDataTexture(gl,shTexture);
    return {maxTextureSize:gl.getParameter(gl.MAX_TEXTURE_SIZE),compiledPrograms,readbackCases,variantCases};
  },{sources:[[vertexShaderSource,fragmentShaderSource],[vertexShader3DGSSource,fragmentShader3DGSSource]],
    uploader:readFileSync(new URL('../src/utils/dataTextureArray.js',import.meta.url),'utf8'),
    shaderHelper:readFileSync(new URL('../src/shaders/dataTextureShader.js',import.meta.url),'utf8'),
    binding:readFileSync(new URL('../src/core/utils/dataTextureBinding.js',import.meta.url),'utf8')});
  console.log(result);
} finally {await browser.close();}
