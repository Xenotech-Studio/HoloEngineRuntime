/**
 * 线段着色器（用于 LINES RenderType）
 * 与 axisGridRenderer 相同格式：position + color，gl.LINES
 */

export const linesVertexShaderSource = `#version 300 es
precision highp float;

uniform mat4 projection;
uniform mat4 view;
uniform mat4 model;

in vec3 position;
in vec3 color;

out vec3 vColor;

void main() {
  vec4 world = model * vec4(position, 1.0);
  gl_Position = projection * view * world;
  vColor = color;
}
`;

export const linesFragmentShaderSource = `#version 300 es
precision highp float;

in vec3 vColor;
uniform float alpha;

out vec4 fragColor;

void main() {
  fragColor = vec4(vColor, alpha);
}
`;
