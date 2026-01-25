/**
 * 3DGS PLY 对象加载（HoloEngineRuntime 内置）
 * 基于 INRIA V1 格式的 PLY 文件加载
 */

import { createDepthWorker } from './depthWorker';
import { getGLErrorName } from '../core/utils/webgl';

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

  const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  if (textureData.width > maxTextureSize || textureData.height > maxTextureSize) {
    throw new Error(`create3DGSTexture: 纹理尺寸超过WebGL限制(${maxTextureSize})`);
  }

  const texture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

  const oldAlignment = gl.getParameter(gl.UNPACK_ALIGNMENT);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);

  let dataToUpload = textureData.data;
  if (actualSize > expectedSize) {
    dataToUpload = textureData.data.subarray(0, expectedSize);
  }
  if (!(dataToUpload instanceof Uint32Array) && dataToUpload instanceof Float32Array) {
    dataToUpload = new Uint32Array(dataToUpload.buffer, dataToUpload.byteOffset, expectedSize);
  }

  try {
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA32UI,
      textureData.width, textureData.height, 0,
      gl.RGBA_INTEGER, gl.UNSIGNED_INT,
      dataToUpload
    );
  } catch (err) {
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, oldAlignment);
    throw err;
  }
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, oldAlignment);

  const error = gl.getError();
  if (error !== gl.NO_ERROR) {
    throw new Error(`create3DGSTexture: WebGL错误 ${getGLErrorName(gl, error)} (${error})`);
  }
  return texture;
}

export function create3DGSIndexBuffer(gl) {
  return gl.createBuffer();
}

export function createSHTexture(gl, vertices, shDegree) {
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

  const texture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, textureWidth, textureHeight, 0, gl.RGBA, gl.FLOAT, shData);
  return texture;
}

export function create3DGSWorker(textureBuffer, vertexCount, onMessage, onError) {
  const worker = createDepthWorker();
  if (onMessage) worker.onmessage = onMessage;
  if (onError) worker.onerror = onError;
  worker.postMessage({ texture: textureBuffer, vertexCount, remaining: 0 });
  return worker;
}

export function createStandardWorkerMessageHandler({ gl, indexBuffer, targetObject, onFirstDepthSort, onError }) {
  let firstDepthSortReceived = false;

  return (e) => {
    if (!e.data.depthIndex || !indexBuffer) return;
    const { depthIndex, vertexCount } = e.data;

    const shouldLog = typeof window !== 'undefined' && window.enableAssetPreviewDebugLogs;
    if (shouldLog && targetObject) {
      targetObject._lastDepthIndices = new Uint32Array(depthIndex);
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, depthIndex, gl.DYNAMIC_DRAW);

    if (targetObject) {
      targetObject.vertexCount = vertexCount;
      if (!firstDepthSortReceived) targetObject.ready = true;
    }

    const err = gl.getError();
    if (err !== gl.NO_ERROR && onError) onError(err, getGLErrorName(gl, err));

    if (!firstDepthSortReceived && onFirstDepthSort) {
      firstDepthSortReceived = true;
      onFirstDepthSort(vertexCount);
    }
  };
}

export function loadAndSetup3DGSObject({ gl, textureData, targetObject, onFirstDepthSort, onWorkerError, onWebGLError }) {
  if (!gl || !textureData) throw new Error('loadAndSetup3DGSObject: gl and textureData are required');

  const texture = create3DGSTexture(gl, textureData);
  const indexBuffer = create3DGSIndexBuffer(gl);
  const shTexture = createSHTexture(gl, textureData.vertices, textureData.sphericalHarmonicsDegree || 0);
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
