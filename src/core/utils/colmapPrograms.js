/**
 * ColmapUtil 用的 WebGL program：点云、线段
 * 供 HoloRP 的 colmapOptions 使用
 */

import { createShader, createProgram } from './webgl';
import { pointCloudVertexShaderSource, pointCloudFragmentShaderSource } from '../shaders/pointCloudShaders';
import { linesVertexShaderSource, linesFragmentShaderSource } from '../shaders/linesShaders';

/**
 * 创建点云 + 线段 programs
 * @param {WebGL2RenderingContext} gl
 * @returns {{ pointCloudProgram, pointCloudUniforms, pointCloudAttributes, linesProgram, linesUniforms, linesAttributes }}
 */
export function createColmapPrograms(gl) {
  const pcVs = createShader(gl, gl.VERTEX_SHADER, pointCloudVertexShaderSource);
  const pcFs = createShader(gl, gl.FRAGMENT_SHADER, pointCloudFragmentShaderSource);
  const pointCloudProgram = createProgram(gl, pcVs, pcFs);
  gl.deleteShader(pcVs);
  gl.deleteShader(pcFs);

  const lnVs = createShader(gl, gl.VERTEX_SHADER, linesVertexShaderSource);
  const lnFs = createShader(gl, gl.FRAGMENT_SHADER, linesFragmentShaderSource);
  const linesProgram = createProgram(gl, lnVs, lnFs);
  gl.deleteShader(lnVs);
  gl.deleteShader(lnFs);

  gl.useProgram(pointCloudProgram);
  const pointCloudUniforms = {
    projection: gl.getUniformLocation(pointCloudProgram, 'projection'),
    view: gl.getUniformLocation(pointCloudProgram, 'view'),
    model: gl.getUniformLocation(pointCloudProgram, 'model'),
    pointSize: gl.getUniformLocation(pointCloudProgram, 'pointSize'),
  };
  const pointCloudAttributes = {
    position: gl.getAttribLocation(pointCloudProgram, 'position'),
    color: gl.getAttribLocation(pointCloudProgram, 'color'),
  };

  gl.useProgram(linesProgram);
  const linesUniforms = {
    projection: gl.getUniformLocation(linesProgram, 'projection'),
    view: gl.getUniformLocation(linesProgram, 'view'),
    model: gl.getUniformLocation(linesProgram, 'model'),
  };
  const linesAttributes = {
    position: gl.getAttribLocation(linesProgram, 'position'),
    color: gl.getAttribLocation(linesProgram, 'color'),
  };

  return {
    pointCloudProgram,
    pointCloudUniforms,
    pointCloudAttributes,
    linesProgram,
    linesUniforms,
    linesAttributes,
  };
}
