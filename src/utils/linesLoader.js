/**
 * 线段渲染对象工具（LINES RenderType）
 * 从 positions (N×3) + colors (N×3) 创建 LINES RenderableObject。
 * 格式：单 buffer 交错 position+color，stride 24。
 */

import { RenderableObject, RenderType } from '../core/utils/holoRP';

/**
 * 创建 LINES RenderableObject
 * @param {WebGL2RenderingContext} gl
 * @param {string} id - 对象 id
 * @param {Float32Array|number[]} positions - N×3, xyz
 * @param {Float32Array|number[]} colors - N×3, rgb 0–1
 * @returns {RenderableObject}
 */
export function createLinesObject(gl, id, positions, colors) {
  const pos = positions instanceof Float32Array ? positions : new Float32Array(positions);
  const col = colors instanceof Float32Array ? colors : new Float32Array(colors);
  const n = Math.min(Math.floor(pos.length / 3), Math.floor(col.length / 3));
  if (n === 0) {
    const obj = new RenderableObject(id, RenderType.LINES);
    obj.positionBuffer = null;
    obj.linesVertexCount = 0;
    obj.ready = false;
    return obj;
  }
  const interleaved = new Float32Array(n * 6);
  for (let i = 0; i < n; i++) {
    interleaved[i * 6 + 0] = pos[i * 3 + 0];
    interleaved[i * 6 + 1] = pos[i * 3 + 1];
    interleaved[i * 6 + 2] = pos[i * 3 + 2];
    interleaved[i * 6 + 3] = col[i * 3 + 0];
    interleaved[i * 6 + 4] = col[i * 3 + 1];
    interleaved[i * 6 + 5] = col[i * 3 + 2];
  }
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, interleaved, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  const obj = new RenderableObject(id, RenderType.LINES);
  obj.positionBuffer = buf;
  obj.linesVertexCount = n;
  obj.ready = true;
  return obj;
}

/**
 * 更新 LINES 对象的 buffer 数据
 * @param {WebGL2RenderingContext} gl
 * @param {RenderableObject} obj - LINES 对象
 * @param {Float32Array|number[]} positions - N×3
 * @param {Float32Array|number[]} colors - N×3
 */
export function updateLinesObject(gl, obj, positions, colors) {
  if (obj.renderType !== RenderType.LINES) return;
  if (obj.positionBuffer) gl.deleteBuffer(obj.positionBuffer);
  const pos = positions instanceof Float32Array ? positions : new Float32Array(positions);
  const col = colors instanceof Float32Array ? colors : new Float32Array(colors);
  const n = Math.min(Math.floor(pos.length / 3), Math.floor(col.length / 3));
  if (n === 0) {
    obj.positionBuffer = null;
    obj.linesVertexCount = 0;
    obj.ready = false;
    return;
  }
  const interleaved = new Float32Array(n * 6);
  for (let i = 0; i < n; i++) {
    interleaved[i * 6 + 0] = pos[i * 3 + 0];
    interleaved[i * 6 + 1] = pos[i * 3 + 1];
    interleaved[i * 6 + 2] = pos[i * 3 + 2];
    interleaved[i * 6 + 3] = col[i * 3 + 0];
    interleaved[i * 6 + 4] = col[i * 3 + 1];
    interleaved[i * 6 + 5] = col[i * 3 + 2];
  }
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, interleaved, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  obj.positionBuffer = buf;
  obj.linesVertexCount = n;
  obj.ready = true;
}
