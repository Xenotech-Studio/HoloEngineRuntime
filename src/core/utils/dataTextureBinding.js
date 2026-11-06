import { getDataTextureSet, dataTextureUnits } from '../../utils/dataTextureArray.js';
import { dataTextureShader } from '../../shaders/dataTextureShader.js';
import { vertexShaderSource, fragmentShaderSource } from '../../shaders/splatShaders.js';
import { vertexShader3DGSSource, fragmentShader3DGSSource } from '../../shaders/gaussian3dShaders.js';
import { createShader } from './webgl';

export function bindDataTexture(gl, program, texture, name, firstUnit = 0) {
  if (!texture) return 0;
  const set = getDataTextureSet(texture);
  const textures = set?.textures || [texture];
  textures.forEach((item,i) => {
    gl.activeTexture(gl.TEXTURE0 + firstUnit + i);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, item);
    gl.uniform1i(gl.getUniformLocation(program, i ? `${name}${i}` : name), firstUnit+i);
  });
  if (textures.length > 1) gl.uniform1ui(gl.getUniformLocation(program, `${name}PointsPerSlab`),set.pointsPerSlab);
  return textures.length;
}

// Lazily specialize the standard program. Reflection copies common uniforms so
// accepted-sort snapshots and both color/depth passes remain exactly paired.
// Only large-model draws use reflection; ordinary draws keep the original path.
export function dataTextureVariant(gl, cache, base, obj, is4DGS) {
  const count = getDataTextureSet(obj.texture)?.textures.length || 1;
  const shCount = getDataTextureSet(obj.shTexture)?.textures.length || 1;
  if (count === 1 && shCount === 1) return null;
  if (count + (obj.shTexture ? shCount : 0) > dataTextureUnits(gl)) throw new Error('Insufficient data texture units');
  const key = `${is4DGS}:${count}:${shCount}`;
  let variant = cache.get(key);
  if (!variant) {
    let source = is4DGS ? vertexShaderSource : vertexShader3DGSSource;
    source = source.replace(dataTextureShader('u_texture'),dataTextureShader('u_texture',count));
    if (!is4DGS) source = source.replace(dataTextureShader('u_shTexture',1,true),dataTextureShader('u_shTexture',shCount,true));
    const vs = createShader(gl,gl.VERTEX_SHADER,source);
    let fs, program;
    try {
      fs = createShader(gl,gl.FRAGMENT_SHADER,is4DGS ? fragmentShaderSource : fragmentShader3DGSSource);
      program = gl.createProgram();
      gl.attachShader(program,vs); gl.attachShader(program,fs);
      // Keep the currently bound shared quad and instance index attributes.
      for (const name of ['position','index']) {
        const location = gl.getAttribLocation(base,name);
        if (location >= 0) gl.bindAttribLocation(program,location,name);
      }
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
      const uniforms = [];
      for(let i=0;i<gl.getProgramParameter(base,gl.ACTIVE_UNIFORMS);i++) {
        const info = gl.getActiveUniform(base,i);
        if (info.name.startsWith('u_texture') || info.name.startsWith('u_shTexture')) continue;
        const target = gl.getUniformLocation(program,info.name);
        if (target !== null) uniforms.push({source:gl.getUniformLocation(base,info.name),target,type:info.type});
      }
      variant = {program,uniforms}; cache.set(key,variant);
    } catch(error) {
      if (program) gl.deleteProgram(program);
      throw error;
    } finally { gl.deleteShader(vs); if(fs) gl.deleteShader(fs); }
  }
  gl.useProgram(variant.program);
  for (const {source,target,type} of variant.uniforms) {
    const value = gl.getUniform(base,source);
    switch(type) {
      case gl.FLOAT: gl.uniform1f(target,value); break;
      case gl.FLOAT_VEC2: gl.uniform2fv(target,value); break;
      case gl.FLOAT_VEC3: gl.uniform3fv(target,value); break;
      case gl.FLOAT_VEC4: gl.uniform4fv(target,value); break;
      case gl.FLOAT_MAT4: gl.uniformMatrix4fv(target,false,value); break;
      case gl.UNSIGNED_INT: gl.uniform1ui(target,value); break;
      case gl.INT: case gl.BOOL: gl.uniform1i(target,value); break;
      default: throw new Error(`Unsupported splat uniform type ${type}`);
    }
  }
  const used = bindDataTexture(gl,variant.program,obj.texture,'u_texture');
  if (!is4DGS && obj.shTexture) bindDataTexture(gl,variant.program,obj.shTexture,'u_shTexture',used);
  return variant;
}
