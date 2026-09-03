/**
 * 点云加载工具（POINT_CLOUD RenderType）
 * 从 positions (N×3) + colors (N×3) 创建 buffer 并填充 RenderableObject。
 * 颜色为 0–1 float，与 COLMAP/Three.js 一致。
 */

import { RenderableObject, RenderType } from '../core/utils/holoRP';

/** Sentinel time for a temporally-unbounded (always-shown) point (spec §I.A). */
export const POINT_TIME_TIMELESS = -1.0;

/**
 * Rebase an int64-ns timestamp to a float32-safe relative-seconds value (colmap4d spec §I.B).
 * Raw epoch ns (~1.7e18) overflows float32's 24-bit mantissa; (t - t0) over a capture spans
 * seconds and keeps ~µs precision. t0 = the model's min timestamp.
 * @param {bigint|number|null|undefined} tNs - timestamp in ns (null/undefined = timeless)
 * @param {bigint|number} t0Ns - rebase origin (model min ns)
 * @returns {number} relative seconds, or POINT_TIME_TIMELESS for a timeless point
 */
export function rebaseToSecondsF32(tNs, t0Ns) {
  if (tNs === null || tNs === undefined) return POINT_TIME_TIMELESS;
  return Number(BigInt(tNs) - BigInt(t0Ns)) / 1e9;
}

/**
 * 创建点云 WebGL buffer
 * @param {WebGL2RenderingContext} gl
 * @param {Float32Array|number[]} positions - N×3, xyz
 * @param {Float32Array|number[]} colors - N×3, rgb 0–1
 * @param {Float32Array|number[]|null} [times] - N×1, 相对秒（<0 = 时间无界）；省略则无时间通道
 * @returns {{ pointPositionBuffer, pointColorBuffer, pointTimeBuffer, pointCount }}
 */
export function createPointCloudBuffers(gl, positions, colors, times = null) {
  const posArray = positions instanceof Float32Array ? positions : new Float32Array(positions);
  const colorArray = colors instanceof Float32Array ? colors : new Float32Array(colors);
  const n = Math.min(Math.floor(posArray.length / 3), Math.floor(colorArray.length / 3));
  if (n === 0) {
    return { pointPositionBuffer: null, pointColorBuffer: null, pointTimeBuffer: null, pointCount: 0 };
  }

  const pointPositionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, pointPositionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, posArray.subarray(0, n * 3), gl.STATIC_DRAW);

  const pointColorBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, pointColorBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, colorArray.subarray(0, n * 3), gl.STATIC_DRAW);

  let pointTimeBuffer = null;
  if (times) {
    const timeArray = times instanceof Float32Array ? times : new Float32Array(times);
    if (timeArray.length >= n) {
      pointTimeBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, pointTimeBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, timeArray.subarray(0, n), gl.STATIC_DRAW);
    }
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  return {
    pointPositionBuffer,
    pointColorBuffer,
    pointTimeBuffer,
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
 * @param {Float32Array|number[]|null} [times] - N×1 相对秒（<0 = 时间无界）；省略则无时间通道
 * @returns {RenderableObject}
 */
export function createPointCloudObject(gl, id, positions, colors, pointSize = 2, times = null) {
  const { pointPositionBuffer, pointColorBuffer, pointTimeBuffer, pointCount } =
    createPointCloudBuffers(gl, positions, colors, times);
  const obj = new RenderableObject(id, RenderType.POINT_CLOUD);
  obj.pointPositionBuffer = pointPositionBuffer;
  obj.pointColorBuffer = pointColorBuffer;
  obj.pointTimeBuffer = pointTimeBuffer;
  obj.pointCount = pointCount;
  obj.pointSize = typeof pointSize === 'number' ? pointSize : 2;
  obj.ready = pointCount > 0;
  return obj;
}
