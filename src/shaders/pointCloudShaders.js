/**
 * 点云着色器（POINT_CLOUD RenderType）
 * 参考 4DGS：每个点渲染一个 quad，但无时间插值、无高斯参数，纯色。
 * 每点 = 边缘刚好等于点尺寸的 quad，solid color。
 */

export const pointCloudVertexShaderSource = `#version 300 es
precision highp float;

uniform mat4 projection;
uniform mat4 view;
uniform mat4 model;
uniform vec2 viewport;
uniform float pointSize;

in vec2 position;
in vec3 instancePos;
in vec3 instanceColor;

out vec3 vColor;

void main() {
  vec4 world = model * vec4(instancePos, 1.0);
  vec4 clip = projection * view * world;
  vec2 ndc = clip.xy / clip.w;
  float depthNDC = clip.z / clip.w;

  vec2 halfSize = vec2(pointSize, pointSize) / viewport;
  vec2 offset = (position.xy * 0.5) * halfSize;
  gl_Position = vec4(ndc + offset, depthNDC, 1.0);
  vColor = instanceColor;
}
`;

export const pointCloudFragmentShaderSource = `#version 300 es
precision highp float;

uniform float alpha;

in vec3 vColor;

out vec4 fragColor;

void main() {
  fragColor = vec4(vColor, alpha);
}
`;
