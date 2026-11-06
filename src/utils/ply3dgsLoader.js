/**
 * 3DGS PLY 对象加载（HoloEngineRuntime 内置）
 * 基于 INRIA V1 格式的 PLY 文件加载
 */

import { createStandardWorkerMessageHandler } from './splatObjectLoader';
import { createDepthWorker } from './depthWorker';
import { createDataTextureArray, getDataTextureSet, deleteDataTexture, dataTextureUnits } from './dataTextureArray';

export function create3DGSTexture(gl, textureData) {
  if (!textureData || !textureData.data || !textureData.width || !textureData.height) {
    throw new Error('create3DGSTexture: 无效的纹理数据');
  }

  const expectedSize = textureData.width * textureData.height * 4;
  const actualSize = textureData.data.length;
  if (actualSize < expectedSize) {
    throw new Error(`create3DGSTexture: 纹理数据大小不足。期望: ${expectedSize}, 实际: ${actualSize}`);
  }
  if (!(textureData.data instanceof Uint32Array)) {
    throw new Error(`create3DGSTexture: 数据格式错误，期望Uint32Array，实际${textureData.data.constructor.name}`);
  }

  gl.activeTexture(gl.TEXTURE0);
  return createDataTextureArray(gl, textureData.data.subarray(0, expectedSize), textureData.width);
}

export function create3DGSIndexBuffer(gl) {
  return gl.createBuffer();
}

export function createSHTexture(gl, vertices, shDegree, maxTextures = 8) {
  if (shDegree === 0 || !vertices || vertices.length === 0) return null;
  const shCoeffPerChannel = shDegree === 1 ? 3 : shDegree === 2 ? 8 : shDegree === 3 ? 15 : 0;
  if (shCoeffPerChannel === 0) return null;
  const hasSH = vertices[0].f_rest_0 !== undefined;
  if (!hasSH) return null;

  const numPoints = vertices.length;
  const textureWidth = 1024;
  const textureHeight = Math.ceil((numPoints * shCoeffPerChannel) / textureWidth);
  const shData = new Float32Array(textureWidth * textureHeight * 4);

  for (let i = 0; i < numPoints; i++) {
    const v = vertices[i];
    const baseIndex = i * shCoeffPerChannel;
    for (let ch = 0; ch < 3; ch++) {
      for (let coeff = 0; coeff < shCoeffPerChannel; coeff++) {
        const shIndex = ch * 15 + coeff;
        const fieldName = shIndex === 0 ? `f_dc_${ch}` : `f_rest_${shIndex - 1}`;
        const value = v[fieldName] !== undefined ? v[fieldName] : 0;
        const texIndex = (baseIndex + coeff) * 4 + ch;
        if (texIndex < shData.length) shData[texIndex] = value;
      }
    }
  }

  gl.activeTexture(gl.TEXTURE1);
  return createDataTextureArray(gl, shData, textureWidth, true, {stride: shCoeffPerChannel, maxTextures});
}

export function create3DGSWorker(textureBuffer, vertexCount, onMessage, onError) {
  const worker = createDepthWorker();
  if (onMessage) worker.onmessage = onMessage;
  if (onError) worker.onerror = onError;
  worker.postMessage({ texture: textureBuffer, vertexCount, remaining: 0 });
  return worker;
}

export { createStandardWorkerMessageHandler } from './splatObjectLoader';

export function loadAndSetup3DGSObject({ gl, textureData, targetObject, onFirstDepthSort, onWorkerError, onWebGLError }) {
  if (!gl || !textureData) throw new Error('loadAndSetup3DGSObject: gl and textureData are required');

  if (targetObject) {
    targetObject.disposeGpu?.();
    targetObject.ready = false;
    targetObject.texture = null;
    targetObject.shTexture = null;
  }
  const texture = create3DGSTexture(gl, textureData);
  const indexBuffer = create3DGSIndexBuffer(gl);
  let shTexture;
  try {
    shTexture = createSHTexture(gl, textureData.vertices, textureData.sphericalHarmonicsDegree || 0,
      dataTextureUnits(gl) - getDataTextureSet(texture).textures.length);
  } catch (error) {
    deleteDataTexture(gl, texture);
    gl.deleteBuffer(indexBuffer);
    throw error;
  }
  const vertexCount = textureData.vertices ? textureData.vertices.length : 0;

  const workerMessageHandler = createStandardWorkerMessageHandler({
    gl,
    indexBuffer,
    targetObject,
    onFirstDepthSort,
    onError: onWebGLError
  });
  const worker = create3DGSWorker(textureData.buffer, vertexCount, workerMessageHandler, onWorkerError);

  if (targetObject) {
    targetObject.disposeGpu = () => {
      worker.terminate();
      deleteDataTexture(gl, texture);
      deleteDataTexture(gl, shTexture);
      gl.deleteBuffer(indexBuffer);
    };
    targetObject.texture = texture;
    targetObject.textureWidth = textureData.width;
    targetObject.textureHeight = textureData.height;
    targetObject.indexBuffer = indexBuffer;
    targetObject.vertexCount = vertexCount;
    targetObject.worker = worker;
    targetObject.shTexture = shTexture;
    targetObject.sphericalHarmonicsDegree = textureData.sphericalHarmonicsDegree || 0;
  }

  return {
    texture,
    indexBuffer,
    worker,
    vertexCount,
    textureWidth: textureData.width,
    textureHeight: textureData.height,
    shTexture,
    sphericalHarmonicsDegree: textureData.sphericalHarmonicsDegree || 0
  };
}
