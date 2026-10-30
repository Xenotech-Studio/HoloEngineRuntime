import { useRef, useState, useCallback } from 'react';
import { KIRIV_MAGIC, LEGACY_MAGIC, parseKiriV, validateLegacyChunk } from '../utils/kiriv';

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
    if (chunk) throw new Error('Truncated splatv payload');
  }, []);

  const loadSplatFile = useCallback(async (url, colorFilter = null) => {
    setLoading(true);
    setError(null);
    setVertexCount(0);
    textureRef.current = null;
    try {
      const req = await fetch(url, { mode: 'cors', credentials: 'omit' });
      if (req.status !== 200) {
        throw new Error(`${req.status} ${req.statusText} - Unable to load ${req.url}`);
      }
      // Peek/replay a fragmented prefix without a second fetch. Legacy keeps its
      // original streaming texture path; v2 is fully validated before publication.
      const sourceReader = req.body.getReader();
      const prefixParts = [];
      let prefixLength = 0;
      while (prefixLength < 8) {
        const part = await sourceReader.read();
        if (part.done) throw new Error('Truncated splat prefix');
        prefixParts.push(part.value); prefixLength += part.value.length;
      }
      const prefetched = new Uint8Array(prefixLength);
      let copied = 0;
      for (const part of prefixParts) { prefetched.set(part, copied); copied += part.length; }
      const magic = new DataView(prefetched.buffer).getUint32(0, true);
      if (magic === KIRIV_MAGIC) {
        const parts = [prefetched];
        let total = prefetched.length;
        while (true) {
          const { done, value } = await sourceReader.read();
          if (done) break;
          total += value.length;
          if (total > 1073741824) throw new Error('KiriV: input exceeds 1 GiB limit');
          parts.push(value);
        }
        const bytes = new Uint8Array(total);
        let at = 0;
        for (const part of parts) { bytes.set(part, at); at += part.length; }
        const texture = parseKiriV(bytes);
        if (colorFilter?.intensity > 0 && colorFilter?.tolerance > 0) {
          throw new Error('KiriV: legacy packed-color filter is unsupported for float/SH color');
        }
        textureRef.current = texture;
        setVertexCount(texture.gaussianCount);
        setLoading(false);
        return texture;
      }
      if (magic !== LEGACY_MAGIC) throw new Error('Unknown splatv/KiriV magic');
      let replayed = false;
      const legacyReader = { read: () => {
        if (!replayed) { replayed = true; return Promise.resolve({ done: false, value: prefetched }); }
        return sourceReader.read();
      } };
      let currentVertexCount = 0;
      let lastVertexCount = -1;
      let textureData = null;
      let textureWidth = 0;
      let textureHeight = 0;
      let cameras = null;
      // 默认 lite 格式: 4 pixels/gauss = 16 u32. hp_scale_rot 扩展为 8 pixels/gauss = 32 u32.
      let gaussStridePixels = 4;
      let precisionVariant = 'lite';
      const chunkHandler = (chunk, buffer, remaining, chunks) => {
        if (!remaining && chunk.type === 'magic') {
          const intView = new Uint32Array(buffer);
          if (intView[0] !== 0x674b) throw new Error('This does not look like a splatv file');
          if (intView[1] === 0 || intView[1] > 16777216) throw new Error('Invalid legacy header length');
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
                validateLegacyChunk(chunkItem);
                textureWidth = chunkItem.texwidth;
                textureHeight = chunkItem.texheight;
                if (chunkItem.cameras) cameras = chunkItem.cameras;
                // 解析高精度变体元数据。未声明则按 lite 处理。
                if (typeof chunkItem.gauss_stride_pixels === 'number') {
                  gaussStridePixels = chunkItem.gauss_stride_pixels;
                }
                if (typeof chunkItem.precision_variant === 'string') {
                  precisionVariant = chunkItem.precision_variant;
                }
              }
            }
          } catch (err) {
            console.error('Failed to parse chunks JSON:', err);
            throw new Error(`Failed to parse chunks JSON: ${err.message}`);
          }
        } else if (chunk.type === 'splat') {
          if (currentVertexCount > lastVertexCount || remaining === 0) {
            lastVertexCount = currentVertexCount;
            const strideU32 = gaussStridePixels * 4;
            currentVertexCount = Math.floor((buffer.byteLength - remaining) / 4 / strideU32);
            const texdata = new Uint32Array(buffer);
            textureData = texdata;
            textureRef.current = {
              data: textureData,
              width: textureWidth,
              height: textureHeight,
              buffer: new Float32Array(buffer),
              cameras: cameras,
              gaussStridePixels,
              precisionVariant,
            };
            setVertexCount(currentVertexCount);
          }
        }
      };
      await readChunks(legacyReader, [{ size: 8, type: 'magic' }], chunkHandler);
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
