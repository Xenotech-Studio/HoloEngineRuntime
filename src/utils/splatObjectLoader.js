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
  let pending = null;
  const target = targetObject || {};
  target.acceptedSort = null;
  target.ready = false;
  target._sortInvalidated = true;

  const recycle = result => {
    const buffer = result?.depthIndex?.buffer;
    if (buffer?.byteLength && result.worker?.postMessage) {
      result.worker.postMessage({ returnedDepthBuffer: buffer }, [buffer]);
    }
  };

  // Called once per object at the display-frame boundary, never from onmessage.
  target.flushSortResult = () => {
    if (!pending) return;
    const result = pending;
    pending = null;
    const shouldLog = typeof window !== 'undefined' && window.enableAssetPreviewDebugLogs;
    if (result.depthIndex) {
      if (shouldLog) target._lastDepthIndices = new Uint32Array(result.depthIndex);
      const uploadStart = target.frameMetrics ? performance.now() : null;
      gl.bindBuffer(gl.ARRAY_BUFFER, indexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, result.depthIndex, gl.DYNAMIC_DRAW);
      if (uploadStart !== null) target.frameMetrics.add('sortUploadMs', performance.now() - uploadStart);
      recycle(result);
    }
    target.acceptedSort = { snapshot: result.snapshot, orderId: result.orderId };
    target.vertexCount = result.vertexCount;
    target.ready = true;
    // Synchronous driver queries are diagnostic-only on the production hot path.
    if (shouldLog) {
      const err = gl.getError();
      if (err !== gl.NO_ERROR && onError) onError(err, getGLErrorName(gl, err));
    }
    if (!firstDepthSortReceived) {
      firstDepthSortReceived = true;
      onFirstDepthSort?.(result.vertexCount);
    }
  };

  return (e) => {
    if (e.data.sortInvalidated) target._sortInvalidated = true;
    if (!e.data.snapshot || !indexBuffer) return;
    const result = { ...e.data, worker: e.target };
    // Match the echoed snapshot, including requests coalesced by the worker.
    if (target.frameMetrics && result.depthIndex && Number.isFinite(result.snapshot.metricsSentAt)) {
      const roundTrip = performance.now() - result.snapshot.metricsSentAt;
      target.frameMetrics.add('sortRoundTripMs', roundTrip);
      if (Number.isFinite(result.sortMs)) target.frameMetrics.add('sortWaitMs', Math.max(0, roundTrip - result.sortMs));
    }
    const latestId = pending?.snapshot.requestId ?? target.acceptedSort?.snapshot.requestId ?? 0;
    if (result.requestId <= latestId) { recycle(result); return; }
    if (!result.depthIndex) {
      // An acknowledgement may advance time/view, but only with the exact order
      // already uploaded or retained in pending. Never pair it with another order.
      if (pending?.orderId === result.orderId) {
        pending = { ...pending, snapshot: result.snapshot, requestId: result.requestId };
      } else if (!pending && target.acceptedSort?.orderId === result.orderId) {
        pending = result;
      }
    } else {
      recycle(pending); // Superseded in-flight indices go straight back to the pool.
      pending = result;
    }
    // Compatibility for callers without a render object/frame boundary.
    if (!targetObject) target.flushSortResult();
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
