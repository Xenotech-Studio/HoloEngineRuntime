/**
 * Splat对象加载工具函数（HoloEngineRuntime 内置）
 */

import { createDepthWorker } from './depthWorker';
import { getGLErrorName } from '../core/utils/webgl';

export function createSplatTexture(gl, textureData) {
  const texture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32UI, textureData.width, textureData.height, 0, gl.RGBA_INTEGER, gl.UNSIGNED_INT, textureData.data);
  return texture;
}

export function createSplatIndexBuffer(gl) {
  return gl.createBuffer();
}

export function createSplatWorker(textureBuffer, onMessage, onError, gaussStridePixels = 4) {
  const worker = createDepthWorker();
  if (onMessage) worker.onmessage = onMessage;
  if (onError) worker.onerror = onError;
  worker.postMessage({ texture: textureBuffer, remaining: 0, gaussStridePixels });
  return worker;
}

export function calculateVertexCount(buffer, gaussStridePixels = 4) {
  const strideU32 = gaussStridePixels * 4;
  return Math.floor(buffer.byteLength / 4 / strideU32);
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
    // 上传完成后把 depthIndex 的 ArrayBuffer transfer 回 worker 复用（消除每帧 ~N*4B 的主线程垃圾 → GC 抖动）。
    // gl.bufferData 已同步把数据拷进 GPU，此处 detach 安全；transfer 后本线程不得再碰 depthIndex（已 detach）。
    try {
      const buf = depthIndex.buffer;
      if (buf && buf.byteLength > 0 && e.target && typeof e.target.postMessage === 'function') {
        e.target.postMessage({ returnedDepthBuffer: buf }, [buf]);
      }
    } catch { /* 回收失败无妨，退化为每帧新分配 */ }
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

export function loadAndSetupSplatObject({ gl, textureData, targetObject, onFirstDepthSort, onWorkerError, onWebGLError }) {
  if (!gl || !textureData) throw new Error('loadAndSetupSplatObject: gl and textureData are required');
  const gaussStridePixels = textureData.gaussStridePixels || 4;
  const precisionVariant = textureData.precisionVariant || 'lite';
  const texture = createSplatTexture(gl, textureData);
  const indexBuffer = createSplatIndexBuffer(gl);
  const workerMessageHandler = createStandardWorkerMessageHandler({
    gl,
    indexBuffer,
    targetObject,
    onFirstDepthSort,
    onError: onWebGLError
  });
  const worker = createSplatWorker(textureData.buffer, workerMessageHandler, onWorkerError, gaussStridePixels);
  const vertexCount = calculateVertexCount(textureData.buffer, gaussStridePixels);
  if (targetObject) {
    targetObject.texture = texture;
    targetObject.textureWidth = textureData.width;
    targetObject.textureHeight = textureData.height;
    targetObject.indexBuffer = indexBuffer;
    targetObject.vertexCount = vertexCount;
    targetObject.worker = worker;
    targetObject.gaussStridePixels = gaussStridePixels;
    targetObject.precisionVariant = precisionVariant;
  }
  return {
    texture,
    indexBuffer,
    worker,
    vertexCount,
    textureWidth: textureData.width,
    textureHeight: textureData.height,
    gaussStridePixels,
    precisionVariant,
  };
}

export function loadSplatObject({ gl, textureData, onWorkerMessage, onWorkerError }) {
  if (!gl || !textureData) throw new Error('loadSplatObject: gl and textureData are required');
  const gaussStridePixels = textureData.gaussStridePixels || 4;
  const texture = createSplatTexture(gl, textureData);
  const indexBuffer = createSplatIndexBuffer(gl);
  const worker = createSplatWorker(textureData.buffer, onWorkerMessage, onWorkerError, gaussStridePixels);
  const vertexCount = calculateVertexCount(textureData.buffer, gaussStridePixels);
  return {
    texture,
    indexBuffer,
    worker,
    vertexCount,
    textureWidth: textureData.width,
    textureHeight: textureData.height
  };
}
