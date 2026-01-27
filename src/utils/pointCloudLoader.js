/**
 * 点云加载工具（POINT_CLOUD RenderType）
 * 从 positions (N×3) + colors (N×3) 创建 buffer 并填充 RenderableObject。
 * 颜色为 0–1 float，与 COLMAP/Three.js 一致。
 */

import { RenderableObject, RenderType } from '../core/utils/holoRP';

/**
 * 创建点云 WebGL buffer
 * @param {WebGL2RenderingContext} gl
 * @param {Float32Array|number[]} positions - N×3, xyz
 * @param {Float32Array|number[]} colors - N×3, rgb 0–1
 * @returns {{ pointPositionBuffer: WebGLBuffer, pointColorBuffer: WebGLBuffer, pointCount: number }}
 */
export function createPointCloudBuffers(gl, positions, colors) {
  const posArray = positions instanceof Float32Array ? positions : new Float32Array(positions);
  const colorArray = colors instanceof Float32Array ? colors : new Float32Array(colors);
  const n = Math.min(Math.floor(posArray.length / 3), Math.floor(colorArray.length / 3));
  if (n === 0) {
    return { pointPositionBuffer: null, pointColorBuffer: null, pointCount: 0 };
  }

  const pointPositionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, pointPositionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, posArray.subarray(0, n * 3), gl.STATIC_DRAW);

  const pointColorBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, pointColorBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, colorArray.subarray(0, n * 3), gl.STATIC_DRAW);

  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  return {
    pointPositionBuffer,
    pointColorBuffer,
    pointCount: n,
  };
}

/**
 * 创建并填充 POINT_CLOUD RenderableObject
 * @param {WebGL2RenderingContext} gl
 * @param {string} id - 对象 id
 * @param {Float32Array|number[]} positions - N×3
 * @param {Float32Array|number[]} colors - N×3, rgb 0–1
 * @param {number} [pointSize=2] - 点尺寸（像素），对象内部参数
 * @returns {RenderableObject}
 */
export function createPointCloudObject(gl, id, positions, colors, pointSize = 2) {
  const { pointPositionBuffer, pointColorBuffer, pointCount } = createPointCloudBuffers(gl, positions, colors);
  const obj = new RenderableObject(id, RenderType.POINT_CLOUD);
  obj.pointPositionBuffer = pointPositionBuffer;
  obj.pointColorBuffer = pointColorBuffer;
  obj.pointCount = pointCount;
  obj.pointSize = typeof pointSize === 'number' ? pointSize : 2;
  obj.ready = pointCount > 0;
  return obj;
}
