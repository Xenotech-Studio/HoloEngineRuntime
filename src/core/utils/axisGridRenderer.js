/**
 * 坐标轴和网格渲染工具
 * 使用简单的线条渲染，在 Splat 渲染之前绘制
 */

import { createShader, createProgram } from './webgl';

/**
 * 初始化坐标轴和网格的渲染资源
 */
export function initAxisGridRenderer(gl, program) {
  // 坐标轴长度
  const axisLength = 10.0;
  
  // 准备顶点数据（包含位置和颜色）
  // 格式：[x, y, z, r, g, b, ...]
  
  // X轴（红色）
  const xAxisData = new Float32Array([
    0, 0, 0,        1, 0, 0,  // 起点
    axisLength, 0, 0,  1, 0, 0,  // 终点
  ]);
  
  // Y轴（绿色）
  const yAxisData = new Float32Array([
    0, 0, 0,        0, 1, 0,  // 起点
    0, axisLength, 0,  0, 1, 0,  // 终点
  ]);
  
  // Z轴（蓝色）
  const zAxisData = new Float32Array([
    0, 0, 0,        0, 0, 1,  // 起点
    0, 0, axisLength,  0, 0, 1,  // 终点
  ]);

  // 地面网格：在 Y=0 平面上
  const gridSize = 20;
  const gridLines = [];
  
  // 主网格线（每5格，较亮）
  for (let i = -gridSize; i <= gridSize; i += 5) {
    // X 方向的线（沿 Z 方向延伸）
    const color = 0.5;  // 增加亮度，更容易看到
    gridLines.push(-gridSize, 0, i,  color, color, color);
    gridLines.push( gridSize, 0, i,  color, color, color);
    // Z 方向的线（沿 X 方向延伸）
    gridLines.push(i, 0, -gridSize,  color, color, color);
    gridLines.push(i, 0,  gridSize,  color, color, color);
  }
  
  // 次网格线（每格，较暗）
  for (let i = -gridSize; i <= gridSize; i += 1) {
    if (i % 5 !== 0) {  // 跳过主网格线
      const color = 0.25;  // 增加亮度
      gridLines.push(-gridSize, 0, i,  color, color, color);
      gridLines.push( gridSize, 0, i,  color, color, color);
      gridLines.push(i, 0, -gridSize,  color, color, color);
      gridLines.push(i, 0,  gridSize,  color, color, color);
    }
  }
  
  const gridData = new Float32Array(gridLines);

  // 创建缓冲区
  const createBuffer = (data) => {
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return { buffer, count: data.length / 6 }; // 每个顶点6个浮点数（3位置+3颜色）
  };

  const xAxisBuffer = createBuffer(xAxisData);
  const yAxisBuffer = createBuffer(yAxisData);
  const zAxisBuffer = createBuffer(zAxisData);
  const gridBuffer = createBuffer(gridData);

  // 简单的着色器程序
  const vsSource = `#version 300 es
precision highp float;

uniform mat4 projection;
uniform mat4 view;

in vec3 position;
in vec3 color;

out vec3 vColor;

void main() {
  gl_Position = projection * view * vec4(position, 1.0);
  vColor = color;
}`;

  const fsSource = `#version 300 es
precision highp float;

in vec3 vColor;
out vec4 fragColor;

void main() {
  fragColor = vec4(vColor, 1.0);
}`;

  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vsSource);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fsSource);
  const axisGridProgram = createProgram(gl, vertexShader, fragmentShader);

  // 获取 attribute 和 uniform 位置
  const positionLoc = gl.getAttribLocation(axisGridProgram, 'position');
  const colorLoc = gl.getAttribLocation(axisGridProgram, 'color');
  const projectionLoc = gl.getUniformLocation(axisGridProgram, 'projection');
  const viewLoc = gl.getUniformLocation(axisGridProgram, 'view');

  return {
    program: axisGridProgram,
    buffers: {
      xAxis: xAxisBuffer,
      yAxis: yAxisBuffer,
      zAxis: zAxisBuffer,
      grid: gridBuffer,
    },
    attributes: {
      position: positionLoc,
      color: colorLoc,
    },
    uniforms: {
      projection: projectionLoc,
      view: viewLoc,
    },
    cleanup: () => {
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      gl.deleteProgram(axisGridProgram);
      gl.deleteBuffer(xAxisBuffer.buffer);
      gl.deleteBuffer(yAxisBuffer.buffer);
      gl.deleteBuffer(zAxisBuffer.buffer);
      gl.deleteBuffer(gridBuffer.buffer);
    },
  };
}

/**
 * 渲染坐标轴和网格
 */
export function renderAxisGrid(gl, renderer, projectionMatrix, viewMatrix) {
  const { program, buffers, attributes, uniforms } = renderer;

  // 保存当前状态
  const prevProgram = gl.getParameter(gl.CURRENT_PROGRAM);
  const prevDepthTest = gl.isEnabled(gl.DEPTH_TEST);
  const prevDepthMask = gl.getParameter(gl.DEPTH_WRITEMASK);
  const prevBlend = gl.isEnabled(gl.BLEND);
  const prevBlendSrc = gl.getParameter(gl.BLEND_SRC_RGB);
  const prevBlendDst = gl.getParameter(gl.BLEND_DST_RGB);
  const prevLineWidth = gl.getParameter(gl.LINE_WIDTH);
  
  // 使用轴网格程序
  gl.useProgram(program);
  
  // 设置 uniform
  gl.uniformMatrix4fv(uniforms.projection, false, projectionMatrix);
  gl.uniformMatrix4fv(uniforms.view, false, viewMatrix);
  
  // 启用深度测试和深度写入（临时）
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.depthMask(true);  // 启用深度写入
  
  // 使用混合模式，让网格在 Splat 之上可见
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  
  // 设置 attribute
  gl.enableVertexAttribArray(attributes.position);
  gl.enableVertexAttribArray(attributes.color);
  
  // 绘制网格（细线）
  gl.lineWidth(1.0);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.grid.buffer);
  gl.vertexAttribPointer(attributes.position, 3, gl.FLOAT, false, 24, 0);
  gl.vertexAttribPointer(attributes.color, 3, gl.FLOAT, false, 24, 12);
  gl.drawArrays(gl.LINES, 0, buffers.grid.count);
  
  // 绘制坐标轴（粗线）
  gl.lineWidth(3.0);
  
  // X轴（红色）
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.xAxis.buffer);
  gl.vertexAttribPointer(attributes.position, 3, gl.FLOAT, false, 24, 0);
  gl.vertexAttribPointer(attributes.color, 3, gl.FLOAT, false, 24, 12);
  gl.drawArrays(gl.LINES, 0, buffers.xAxis.count);
  
  // Y轴（绿色）
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.yAxis.buffer);
  gl.vertexAttribPointer(attributes.position, 3, gl.FLOAT, false, 24, 0);
  gl.vertexAttribPointer(attributes.color, 3, gl.FLOAT, false, 24, 12);
  gl.drawArrays(gl.LINES, 0, buffers.yAxis.count);
  
  // Z轴（蓝色）
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.zAxis.buffer);
  gl.vertexAttribPointer(attributes.position, 3, gl.FLOAT, false, 24, 0);
  gl.vertexAttribPointer(attributes.color, 3, gl.FLOAT, false, 24, 12);
  gl.drawArrays(gl.LINES, 0, buffers.zAxis.count);
  
  // 恢复状态
  gl.useProgram(prevProgram);
  if (!prevDepthTest) gl.disable(gl.DEPTH_TEST);
  gl.depthMask(prevDepthMask);  // 恢复深度写入状态
  if (!prevBlend) gl.disable(gl.BLEND);
  gl.blendFunc(prevBlendSrc, prevBlendDst);  // 恢复混合函数
  gl.lineWidth(prevLineWidth);
  gl.disableVertexAttribArray(attributes.position);
  gl.disableVertexAttribArray(attributes.color);
}

