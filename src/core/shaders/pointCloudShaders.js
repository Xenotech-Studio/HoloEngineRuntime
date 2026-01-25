/**
 * 点云着色器（用于 POINT_CLOUD RenderType）
 * 支持 position + color，gl.POINTS
 */

export const pointCloudVertexShaderSource = `#version 300 es
precision highp float;

uniform mat4 projection;
uniform mat4 view;
uniform mat4 model;
uniform float pointSize;

in vec3 position;
in vec3 color;

out vec3 vColor;

void main() {
  vec4 world = model * vec4(position, 1.0);
  gl_Position = projection * view * world;
  gl_PointSize = pointSize;
  vColor = color;
}
`;

export const pointCloudFragmentShaderSource = `#version 300 es
precision highp float;

in vec3 vColor;

out vec4 fragColor;

void main() {
  fragColor = vec4(vColor, 1.0);
}
`;
