/**
 * Mesh 对象加载工具函数（HoloEngineRuntime 内置）
 */

export function parseOBJ(objText) {
  const lines = objText.split('\n');
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const tempPositions = [];
  const tempNormals = [];
  const tempUvs = [];
  const vertexMap = new Map();
  let nextIndex = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parts = trimmed.split(/\s+/);
    const type = parts[0];
    if (type === 'v') {
      const x = parseFloat(parts[1]);
      const y = parseFloat(parts[2]);
      const z = parseFloat(parts[3]);
      tempPositions.push(x, y, z);
    } else if (type === 'vn') {
      const x = parseFloat(parts[1]);
      const y = parseFloat(parts[2]);
      const z = parseFloat(parts[3]);
      tempNormals.push(x, y, z);
    } else if (type === 'vt') {
      const u = parseFloat(parts[1]);
      const v = parseFloat(parts[2]);
      tempUvs.push(u, v);
    } else if (type === 'f') {
      const faceVertices = [];
      for (let i = 1; i < parts.length; i++) {
        const indicesStr = parts[i].split('/');
        const vIdx = parseInt(indicesStr[0]) - 1;
        const vtIdx = indicesStr[1] ? parseInt(indicesStr[1]) - 1 : -1;
        const vnIdx = indicesStr[2] ? parseInt(indicesStr[2]) - 1 : -1;
        const key = `${vIdx}/${vtIdx}/${vnIdx}`;
        let index;
        if (vertexMap.has(key)) {
          index = vertexMap.get(key);
        } else {
          index = nextIndex++;
          vertexMap.set(key, index);
          if (vIdx >= 0 && vIdx < tempPositions.length / 3) {
            positions.push(tempPositions[vIdx * 3], tempPositions[vIdx * 3 + 1], tempPositions[vIdx * 3 + 2]);
          } else {
            positions.push(0, 0, 0);
          }
          if (vnIdx >= 0 && vnIdx < tempNormals.length / 3) {
            normals.push(tempNormals[vnIdx * 3], tempNormals[vnIdx * 3 + 1], tempNormals[vnIdx * 3 + 2]);
          } else {
            normals.push(NaN, NaN, NaN);
          }
          if (vtIdx >= 0 && vtIdx < tempUvs.length / 2) {
            uvs.push(tempUvs[vtIdx * 2], tempUvs[vtIdx * 2 + 1]);
          } else {
            uvs.push(0, 0);
          }
        }
        faceVertices.push(index);
      }
      if (faceVertices.length >= 3) {
        for (let i = 1; i < faceVertices.length - 1; i++) {
          indices.push(faceVertices[0], faceVertices[i], faceVertices[i + 1]);
        }
      }
    }
  }

  let nanCount = 0;
  for (let i = 0; i < normals.length; i += 3) {
    if (isNaN(normals[i])) nanCount++;
  }

  if (nanCount > 0) {
    const maxIndex = Math.max(...indices);
    const positionsCount = positions.length / 3;
    const normalsCount = normals.length / 3;
    if (maxIndex >= positionsCount) {
      console.error(`[meshLoader] 错误：indices 中的最大索引 ${maxIndex} 超出了 positions 数组的范围 ${positionsCount}`);
    }
    if (positionsCount !== normalsCount) {
      console.error(`[meshLoader] 错误：positions 数组大小 (${positionsCount}) 与 normals 数组大小 (${normalsCount}) 不匹配！`);
    }
    const vertexNormalSums = new Array(positionsCount).fill(null).map(() => [0, 0, 0]);
    const vertexNormalCounts = new Array(positionsCount).fill(0);
    const maxPositions = positionsCount;
    for (let i = 0; i < indices.length; i += 3) {
      const idx0 = indices[i];
      const idx1 = indices[i + 1];
      const idx2 = indices[i + 2];
      if (idx0 < 0 || idx0 >= maxPositions || idx1 < 0 || idx1 >= maxPositions || idx2 < 0 || idx2 >= maxPositions) {
        continue;
      }
      const p0 = [positions[idx0 * 3], positions[idx0 * 3 + 1], positions[idx0 * 3 + 2]];
      const p1 = [positions[idx1 * 3], positions[idx1 * 3 + 1], positions[idx1 * 3 + 2]];
      const p2 = [positions[idx2 * 3], positions[idx2 * 3 + 1], positions[idx2 * 3 + 2]];
      const v1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
      const v2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
      const faceNormal = [
        v1[1] * v2[2] - v1[2] * v2[1],
        v1[2] * v2[0] - v1[0] * v2[2],
        v1[0] * v2[1] - v1[1] * v2[0]
      ];
      let len = Math.sqrt(faceNormal[0] * faceNormal[0] + faceNormal[1] * faceNormal[1] + faceNormal[2] * faceNormal[2]);
      if (len > 1e-6) {
        if (len < 0.001) {
          const scale = 1000.0;
          faceNormal[0] *= scale;
          faceNormal[1] *= scale;
          faceNormal[2] *= scale;
          len *= scale;
        }
        const normalizedNormal = [faceNormal[0] / len, faceNormal[1] / len, faceNormal[2] / len];
        vertexNormalSums[idx0][0] += normalizedNormal[0];
        vertexNormalSums[idx0][1] += normalizedNormal[1];
        vertexNormalSums[idx0][2] += normalizedNormal[2];
        vertexNormalCounts[idx0]++;
        vertexNormalSums[idx1][0] += normalizedNormal[0];
        vertexNormalSums[idx1][1] += normalizedNormal[1];
        vertexNormalSums[idx1][2] += normalizedNormal[2];
        vertexNormalCounts[idx1]++;
        vertexNormalSums[idx2][0] += normalizedNormal[0];
        vertexNormalSums[idx2][1] += normalizedNormal[1];
        vertexNormalSums[idx2][2] += normalizedNormal[2];
        vertexNormalCounts[idx2]++;
      }
    }
    for (let i = 0; i < normals.length; i += 3) {
      if (isNaN(normals[i])) {
        const vertexIndex = i / 3;
        const count = vertexNormalCounts[vertexIndex];
        if (count > 0) {
          const avgNormal = [
            vertexNormalSums[vertexIndex][0] / count,
            vertexNormalSums[vertexIndex][1] / count,
            vertexNormalSums[vertexIndex][2] / count
          ];
          const len = Math.sqrt(avgNormal[0] * avgNormal[0] + avgNormal[1] * avgNormal[1] + avgNormal[2] * avgNormal[2]);
          if (len > 0.0001) {
            normals[i] = avgNormal[0] / len;
            normals[i + 1] = avgNormal[1] / len;
            normals[i + 2] = avgNormal[2] / len;
          } else {
            normals[i] = 0;
            normals[i + 1] = 1;
            normals[i + 2] = 0;
          }
        } else {
          normals[i] = 0;
          normals[i + 1] = 1;
          normals[i + 2] = 0;
        }
      }
    }
  }

  let validNormals = 0;
  let invalidNormals = 0;
  for (let i = 0; i < normals.length; i += 3) {
    const len = Math.sqrt(normals[i] * normals[i] + normals[i + 1] * normals[i + 1] + normals[i + 2] * normals[i + 2]);
    if (len > 0.9 && len < 1.1) {
      validNormals++;
    } else {
      invalidNormals++;
      if (len > 0.0001) {
        normals[i] /= len;
        normals[i + 1] /= len;
        normals[i + 2] /= len;
      }
    }
  }
  if (invalidNormals > 0) {
    console.warn(`[meshLoader] OBJ 解析完成，但有 ${invalidNormals} 个无效法线`);
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: new Uint16Array(indices)
  };
}

export async function loadOBJFile(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to load OBJ file: ${response.statusText}`);
    const text = await response.text();
    return parseOBJ(text);
  } catch (error) {
    console.error('加载 OBJ 文件失败:', error);
    throw error;
  }
}

export function createMeshBuffers(gl, meshData) {
  const { positions, normals, uvs, indices } = meshData;
  const vertexCount = positions.length / 3;
  const positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
  const normalBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, normals, gl.STATIC_DRAW);
  const uvBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);
  const elementBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, elementBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
  const vertexData = new Float32Array(vertexCount * 8);
  for (let i = 0; i < vertexCount; i++) {
    const offset = i * 8;
    vertexData[offset + 0] = positions[i * 3 + 0];
    vertexData[offset + 1] = positions[i * 3 + 1];
    vertexData[offset + 2] = positions[i * 3 + 2];
    vertexData[offset + 3] = normals[i * 3 + 0];
    vertexData[offset + 4] = normals[i * 3 + 1];
    vertexData[offset + 5] = normals[i * 3 + 2];
    vertexData[offset + 6] = uvs[i * 2 + 0];
    vertexData[offset + 7] = uvs[i * 2 + 1];
  }
  const vertexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertexData, gl.STATIC_DRAW);
  const vertexAttributes = {
    position: 0,
    normal: 0,
    uv: 0,
    stride: 0,
    positionBuffer: positionBuffer,
    normalBuffer: normalBuffer,
    uvBuffer: uvBuffer,
    interleavedBuffer: vertexBuffer
  };
  return {
    vertexBuffer,
    elementBuffer,
    elementCount: indices.length,
    vertexAttributes
  };
}

export async function loadAndSetupMeshObject({ gl, objUrl, targetObject }) {
  if (!gl || !objUrl) throw new Error('loadAndSetupMeshObject: gl and objUrl are required');
  const meshData = await loadOBJFile(objUrl);
  const { vertexBuffer, elementBuffer, elementCount, vertexAttributes } = createMeshBuffers(gl, meshData);
  if (targetObject) {
    targetObject.renderType = 'mesh';
    targetObject.vertexBuffer = vertexBuffer;
    targetObject.elementBuffer = elementBuffer;
    targetObject.elementCount = elementCount;
    targetObject.vertexAttributes = vertexAttributes;
    targetObject.ready = true;
  }
  return {
    vertexBuffer,
    elementBuffer,
    elementCount,
    vertexAttributes
  };
}
