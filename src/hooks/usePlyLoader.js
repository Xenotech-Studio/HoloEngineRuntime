import { useRef, useState, useCallback } from 'react';

/**
 * 解析PLY文件header
 */
function parsePlyHeader(headerText) {
  const lines = headerText.split('\n').filter(line => line.trim());
  const header = {
    format: null,
    vertexCount: 0,
    fields: [],
    headerSizeBytes: 0,
    bytesPerVertex: 0,
    sphericalHarmonicsDegree: 0
  };

  let inVertexElement = false;
  let headerEndIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const words = line.split(/\s+/);

    if (line === 'end_header') {
      headerEndIndex = headerText.indexOf('end_header') + 'end_header'.length;
      header.headerSizeBytes = headerEndIndex + 1;
      break;
    }

    if (words[0] === 'format') {
      header.format = words[1];
      if (words[1] !== 'binary_little_endian') throw new Error('只支持 binary_little_endian 格式');
    } else if (words[0] === 'element' && words[1] === 'vertex') {
      header.vertexCount = parseInt(words[2], 10);
      inVertexElement = true;
    } else if (words[0] === 'element' && words[1] !== 'vertex') {
      inVertexElement = false;
    } else if (inVertexElement && words[0] === 'property') {
      const fieldName = words[2];
      const fieldType = words[1];
      header.fields.push({ name: fieldName, type: fieldType });
      let bytes = 0;
      if (fieldType === 'float') bytes = 4;
      else if (fieldType === 'uchar') bytes = 1;
      else if (fieldType === 'uint') bytes = 4;
      else if (fieldType === 'int') bytes = 4;
      header.bytesPerVertex += bytes;
      if (fieldName.startsWith('f_rest_')) {
        const shIndex = parseInt(fieldName.replace('f_rest_', ''), 10);
        if (shIndex >= 0 && shIndex <= 44) {
          if (shIndex < 3) header.sphericalHarmonicsDegree = Math.max(header.sphericalHarmonicsDegree, 1);
          else if (shIndex < 8) header.sphericalHarmonicsDegree = Math.max(header.sphericalHarmonicsDegree, 2);
          else header.sphericalHarmonicsDegree = Math.max(header.sphericalHarmonicsDegree, 3);
        }
      }
    }
  }

  return header;
}

function readPlyVertex(dataView, header, vertexIndex) {
  const offset = header.headerSizeBytes + vertexIndex * header.bytesPerVertex;
  const vertex = {};
  let currentOffset = offset;

  for (const field of header.fields) {
    if (field.type === 'float') {
      vertex[field.name] = dataView.getFloat32(currentOffset, true);
      currentOffset += 4;
    } else if (field.type === 'uchar') {
      vertex[field.name] = dataView.getUint8(currentOffset);
      currentOffset += 1;
    } else if (field.type === 'uint') {
      vertex[field.name] = dataView.getUint32(currentOffset, true);
      currentOffset += 4;
    } else if (field.type === 'int') {
      vertex[field.name] = dataView.getInt32(currentOffset, true);
      currentOffset += 4;
    }
  }

  return vertex;
}

function convertPlyToTextureData(vertices, header) {
  const numPoints = vertices.length;
  const textureWidth = 1024;
  const totalPixels = numPoints * 4;
  const textureHeight = Math.ceil(totalPixels / textureWidth);
  const maxTextureSize = 16384;
  if (textureHeight > maxTextureSize) {
    throw new Error(`纹理高度过大: ${textureHeight}，超过WebGL限制(${maxTextureSize})。点数: ${numPoints}。`);
  }

  const totalElements = textureWidth * textureHeight * 4;
  const textureData = new Uint32Array(totalElements);
  const floatData = new Float32Array(textureData.buffer);

  function floatToHalf(f) {
    const buf = new ArrayBuffer(4);
    const view = new DataView(buf);
    view.setFloat32(0, f, true);
    const bits = view.getUint32(0, true);
    const sign = (bits >> 16) & 0x8000;
    const exp = (bits >> 23) & 0xFF;
    const mantissa = bits & 0x7FFFFF;
    if (exp === 0) return sign;
    if (exp === 255) return sign | 0x7C00;
    const newExp = exp - 127 + 15;
    if (newExp >= 31) return sign | 0x7C00;
    if (newExp <= 0) return sign;
    return sign | (newExp << 10) | (mantissa >> 13);
  }

  for (let i = 0; i < numPoints; i++) {
    const v = vertices[i];
    const baseIndex = i * 16;

    floatData[baseIndex + 0] = v.x || 0;
    floatData[baseIndex + 1] = v.y || 0;
    floatData[baseIndex + 2] = v.z || 0;
    const rot0Half = floatToHalf(v.rot_0 || 0);
    const rot1Half = floatToHalf(v.rot_1 || 0);
    textureData[baseIndex + 3] = (rot1Half << 16) | rot0Half;

    const rot2Half = floatToHalf(v.rot_2 || 0);
    const rot3Half = floatToHalf(v.rot_3 || 0);
    textureData[baseIndex + 4] = (rot3Half << 16) | rot2Half;

    const SH_C0 = 0.28209479177387814;
    let r = 0, g = 0, b = 0, a = 0;
    if (v.f_dc_0 !== undefined) {
      r = Math.floor(Math.max(0, Math.min(1, (0.5 + SH_C0 * v.f_dc_0))) * 255);
      g = Math.floor(Math.max(0, Math.min(1, (0.5 + SH_C0 * v.f_dc_1))) * 255);
      b = Math.floor(Math.max(0, Math.min(1, (0.5 + SH_C0 * v.f_dc_2))) * 255);
    }
    if (v.opacity !== undefined) {
      a = Math.floor(Math.max(0, Math.min(1, (1 / (1 + Math.exp(-v.opacity))))) * 255);
    }
    textureData[baseIndex + 7] = (a << 24) | (b << 16) | (g << 8) | r;

    const scale0 = v.scale_0 !== undefined ? Math.exp(v.scale_0) : 0.01;
    const scale1 = v.scale_1 !== undefined ? Math.exp(v.scale_1) : 0.01;
    const scale2 = v.scale_2 !== undefined ? Math.exp(v.scale_2) : 0.01;
    const scale0Half = floatToHalf(scale0);
    const scale1Half = floatToHalf(scale1);
    const scale2Half = floatToHalf(scale2);
    textureData[baseIndex + 5] = (scale1Half << 16) | scale0Half;
    textureData[baseIndex + 6] = scale2Half;

    for (let j = 12; j < 16; j++) textureData[baseIndex + j] = 0;
  }

  return {
    data: textureData,
    width: textureWidth,
    height: textureHeight,
    buffer: textureData.buffer,
    vertices: vertices,
    sphericalHarmonicsDegree: header.sphericalHarmonicsDegree
  };
}

/**
 * 独立加载 PLY 文件（无 React 状态，供动态 import 等场景使用）
 * @param {string} url - PLY 文件 URL
 * @returns {Promise<Object>} 纹理数据 { data, width, height, buffer, vertices, sphericalHarmonicsDegree }
 */
export async function loadPlyFile(url) {
  const response = await fetch(url, { mode: 'cors', credentials: 'omit' });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} - Unable to load ${url}`);

  const arrayBuffer = await response.arrayBuffer();
  const dataView = new DataView(arrayBuffer);
  const textDecoder = new TextDecoder();
  const maxHeaderSize = Math.min(8192, arrayBuffer.byteLength);
  const headerBytes = new Uint8Array(arrayBuffer, 0, maxHeaderSize);
  let headerText = textDecoder.decode(headerBytes);

  if (!headerText.includes('end_header')) throw new Error('找不到 end_header，PLY文件格式可能不正确');
  const headerEndIndex = headerText.indexOf('end_header') + 'end_header'.length;
  headerText = headerText.substring(0, headerEndIndex);

  const header = parsePlyHeader(headerText);
  header.headerSizeBytes = headerEndIndex + 1;

  const vertices = [];
  for (let i = 0; i < header.vertexCount; i++) {
    vertices.push(readPlyVertex(dataView, header, i));
  }

  return convertPlyToTextureData(vertices, header);
}

/**
 * 加载PLY文件的Hook（HoloEngineRuntime 内置）
 */
export function usePlyLoader() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [vertexCount, setVertexCount] = useState(0);
  const textureRef = useRef(null);

  const loadPlyFileFromHook = useCallback(async (url) => {
    setLoading(true);
    setError(null);
    setVertexCount(0);
    try {
      const textureData = await loadPlyFile(url);
      textureRef.current = textureData;
      setVertexCount(textureData.vertices?.length ?? 0);
      setLoading(false);
      return textureData;
    } catch (err) {
      console.error('[usePlyLoader] 加载失败:', err?.message, url);
      setError(err);
      setLoading(false);
      throw err;
    }
  }, []);

  return {
    loadPlyFile: loadPlyFileFromHook,
    loading,
    error,
    vertexCount,
    texture: textureRef.current
  };
}
