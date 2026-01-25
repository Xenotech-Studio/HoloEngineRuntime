import { useRef, useState, useCallback } from 'react';

/**
 * RGB转HSV
 */
function rgbToHsv(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
  }
  h = Math.round(h * 60);
  if (h < 0) h += 360;
  const s = max === 0 ? 0 : delta / max;
  const v = max;
  return { h, s, v };
}

function hueDistance(h1, h2) {
  const diff = Math.abs(h1 - h2);
  return Math.min(diff, 360 - diff);
}

function applyColorFilter(textureData, filterConfig) {
  if (!filterConfig || filterConfig.intensity === 0 || filterConfig.tolerance === 0) return;
  const targetColor = filterConfig.color || [0, 0, 0];
  const intensity = Math.max(0, Math.min(1, filterConfig.intensity || 0));
  const tolerance = Math.max(0, Math.min(1, filterConfig.tolerance || 0));
  const targetR = targetColor[0] / 255.0;
  const targetG = targetColor[1] / 255.0;
  const targetB = targetColor[2] / 255.0;
  const targetHsv = rgbToHsv(targetR, targetG, targetB);
  const targetHue = targetHsv.h;
  const pointsPerGaussian = 16;
  const rgbaIndex = 7;
  for (let i = 0; i < textureData.length; i += pointsPerGaussian) {
    const rgbaIndexPos = i + rgbaIndex;
    if (rgbaIndexPos >= textureData.length) break;
    const rgba = textureData[rgbaIndexPos];
    const r = (rgba & 0xff) / 255.0;
    const g = ((rgba >> 8) & 0xff) / 255.0;
    const b = ((rgba >> 16) & 0xff) / 255.0;
    const a = (rgba >> 24) & 0xff;
    const currentHsv = rgbToHsv(r, g, b);
    const currentHue = currentHsv.h;
    const hueDiff = hueDistance(targetHue, currentHue);
    const maxHueDiff = 180;
    const hueSimilarity = 1.0 - (hueDiff / maxHueDiff);
    let influenceFactor = 0;
    if (tolerance === 0) {
      influenceFactor = hueSimilarity >= 1.0 ? 1.0 : 0.0;
    } else {
      const threshold = 1.0 - tolerance;
      if (hueSimilarity >= threshold) {
        influenceFactor = (hueSimilarity - threshold) / tolerance;
      } else {
        influenceFactor = 0;
      }
    }
    const opacityMultiplier = 1.0 - intensity * influenceFactor;
    const newA = Math.max(0, Math.min(255, Math.floor(a * opacityMultiplier)));
    const newRgba = (rgba & 0x00ffffff) | (newA << 24);
    textureData[rgbaIndexPos] = newRgba;
  }
}

/**
 * 加载 .splatv 文件的 Hook（HoloEngineRuntime 内置）
 */
export function useSplatLoader() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [vertexCount, setVertexCount] = useState(0);
  const textureRef = useRef(null);

  const readChunks = useCallback(async (reader, chunks, handleChunk) => {
    let chunk = chunks.shift();
    let buffer = new Uint8Array(chunk.size);
    let offset = 0;
    while (chunk) {
      const { done, value: readValue } = await reader.read();
      if (done) break;
      let value = readValue;
      while (value.length + offset >= chunk.size) {
        buffer.set(value.subarray(0, chunk.size - offset), offset);
        value = value.subarray(chunk.size - offset);
        handleChunk(chunk, buffer.buffer, 0, chunks);
        chunk = chunks.shift();
        if (!chunk) break;
        buffer = new Uint8Array(chunk.size);
        offset = 0;
      }
      if (!chunk) break;
      buffer.set(value, offset);
      offset += value.length;
      const remaining = buffer.byteLength - offset;
      handleChunk(chunk, buffer.buffer, remaining, chunks);
    }
    if (chunk) handleChunk(chunk, buffer.buffer, 0, chunks);
  }, []);

  const loadSplatFile = useCallback(async (url, colorFilter = null) => {
    setLoading(true);
    setError(null);
    setVertexCount(0);
    try {
      const req = await fetch(url, { mode: 'cors', credentials: 'omit' });
      if (req.status !== 200) {
        throw new Error(`${req.status} ${req.statusText} - Unable to load ${req.url}`);
      }
      let currentVertexCount = 0;
      let lastVertexCount = -1;
      let textureData = null;
      let textureWidth = 0;
      let textureHeight = 0;
      let cameras = null;
      const chunkHandler = (chunk, buffer, remaining, chunks) => {
        if (!remaining && chunk.type === 'magic') {
          const intView = new Uint32Array(buffer);
          if (intView[0] !== 0x674b) throw new Error('This does not look like a splatv file');
          chunks.push({ size: intView[1], type: 'chunks' });
        } else if (!remaining && chunk.type === 'chunks') {
          try {
            const bufferView = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
            const text = new TextDecoder('utf-8', { fatal: false }).decode(bufferView);
            const trimmedText = text.trim();
            if (!trimmedText.startsWith('[') && !trimmedText.startsWith('{')) {
              throw new Error('Invalid JSON format: does not start with [ or {');
            }
            const chunkList = JSON.parse(trimmedText);
            if (!Array.isArray(chunkList)) {
              throw new Error('Expected JSON array but got: ' + typeof chunkList);
            }
            for (const chunkItem of chunkList) {
              chunks.push(chunkItem);
              if (chunkItem.type === 'splat') {
                textureWidth = chunkItem.texwidth;
                textureHeight = chunkItem.texheight;
                if (chunkItem.cameras) cameras = chunkItem.cameras;
              }
            }
          } catch (err) {
            console.error('Failed to parse chunks JSON:', err);
            throw new Error(`Failed to parse chunks JSON: ${err.message}`);
          }
        } else if (chunk.type === 'splat') {
          if (currentVertexCount > lastVertexCount || remaining === 0) {
            lastVertexCount = currentVertexCount;
            currentVertexCount = Math.floor((buffer.byteLength - remaining) / 4 / 16);
            const texdata = new Uint32Array(buffer);
            textureData = texdata;
            textureRef.current = {
              data: textureData,
              width: textureWidth,
              height: textureHeight,
              buffer: new Float32Array(buffer),
              cameras: cameras
            };
            setVertexCount(currentVertexCount);
          }
        }
      };
      await readChunks(req.body.getReader(), [{ size: 8, type: 'magic' }], chunkHandler);
      if (textureRef.current && textureRef.current.data && colorFilter && colorFilter.intensity > 0 && colorFilter.tolerance > 0) {
        applyColorFilter(textureRef.current.data, colorFilter);
      }
      setLoading(false);
      return textureRef.current;
    } catch (err) {
      console.error('[useSplatLoader] 加载失败:', err?.message, url);
      setError(err);
      setLoading(false);
      throw err;
    }
  }, [readChunks]);

  return {
    loadSplatFile,
    loading,
    error,
    vertexCount,
    texture: textureRef.current
  };
}
