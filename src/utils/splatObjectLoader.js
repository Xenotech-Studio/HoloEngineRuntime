import { createDataTextureArray, deleteDataTexture } from './dataTextureArray';
/**
 * Splat对象加载工具函数（HoloEngineRuntime 内置）
 */

import { createDepthWorker } from './depthWorker';
import { getGLErrorName } from '../core/utils/webgl';

export function createSplatTexture(gl, textureData) {
  gl.activeTexture(gl.TEXTURE0);
  return createDataTextureArray(gl, textureData.data, textureData.width, false, {stride: textureData.gaussStridePixels || 4});
}

export function createSplatIndexBuffer(gl) {
  return gl.createBuffer();
}

export function createSplatWorker(textureBuffer, onMessage, onError, gaussStridePixels = 4, metadata = {}) {
  const worker = createDepthWorker();
  if (onMessage) worker.onmessage = onMessage;
  if (onError) worker.onerror = onError;
  worker.postMessage({ texture: textureBuffer, remaining: 0, gaussStridePixels,
    vertexCount: metadata.gaussianCount, precisionVariant: metadata.precisionVariant,
    representation: metadata.representation });
  return worker;
}

export function calculateVertexCount(buffer, gaussStridePixels = 4, gaussianCount = undefined) {
  const strideU32 = gaussStridePixels * 4;
  if (gaussianCount !== undefined) {
    if (!Number.isSafeInteger(gaussianCount) || gaussianCount < 0 || gaussianCount * strideU32 * 4 > buffer.byteLength) throw new Error('Invalid effective gaussian_count');
    return gaussianCount;
  }
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
  if (targetObject) {
    targetObject.disposeGpu?.();
    targetObject.ready = false;
    targetObject.texture = null;
    targetObject.shTexture = null;
  }
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
  const vertexCount = calculateVertexCount(textureData.buffer, gaussStridePixels, textureData.gaussianCount);
  const worker = createSplatWorker(textureData.buffer, workerMessageHandler, onWorkerError, gaussStridePixels, textureData);
  if (targetObject) {
    targetObject.disposeGpu = () => {
      worker.terminate();
      deleteDataTexture(gl, texture);
      gl.deleteBuffer(indexBuffer);
    };
    targetObject.texture = texture;
    targetObject.textureWidth = textureData.width;
    targetObject.textureHeight = textureData.height;
    targetObject.indexBuffer = indexBuffer;
    targetObject.vertexCount = vertexCount;
    targetObject.worker = worker;
    targetObject.gaussStridePixels = gaussStridePixels;
    targetObject.precisionVariant = precisionVariant;
    for (const key of ['representation', 'colorEncoding', 'shDegree', 'opacityFloor', 'kirivHeader', 'gaussianCount']) targetObject[key] = textureData[key];
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
    representation: textureData.representation,
    kirivHeader: textureData.kirivHeader,
  };
}

export function loadSplatObject({ gl, textureData, onWorkerMessage, onWorkerError }) {
  if (!gl || !textureData) throw new Error('loadSplatObject: gl and textureData are required');
  const gaussStridePixels = textureData.gaussStridePixels || 4;
  const texture = createSplatTexture(gl, textureData);
  const indexBuffer = createSplatIndexBuffer(gl);
  const vertexCount = calculateVertexCount(textureData.buffer, gaussStridePixels, textureData.gaussianCount);
  const worker = createSplatWorker(textureData.buffer, onWorkerMessage, onWorkerError, gaussStridePixels, textureData);
  return {
    texture,
    indexBuffer,
    worker,
    vertexCount,
    textureWidth: textureData.width,
    textureHeight: textureData.height,
    gaussStridePixels, precisionVariant: textureData.precisionVariant,
    representation: textureData.representation, colorEncoding: textureData.colorEncoding,
    shDegree: textureData.shDegree, opacityFloor: textureData.opacityFloor,
    kirivHeader: textureData.kirivHeader, gaussianCount: textureData.gaussianCount
  };
}
