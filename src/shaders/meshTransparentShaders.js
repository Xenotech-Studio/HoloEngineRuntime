/**
 * Mesh Transparent Shader（透明）
 * 支持透明度混合
 */

export const meshTransparentVertexShaderSource = `#version 300 es
precision highp float;

uniform mat4 projection;
uniform mat4 view;
uniform mat4 model;

in vec3 position;
in vec3 normal;
in vec2 uv;

out vec2 vUv;
out vec3 vPosition;

void main() {
  mat4 mvp = projection * view * model;
  vec4 worldPos = model * vec4(position, 1.0);
  
  vPosition = worldPos.xyz;
  vUv = uv;
  
  gl_Position = mvp * vec4(position, 1.0);
}
`;

export const meshTransparentFragmentShaderSource = `#version 300 es
precision highp float;

in vec2 vUv;
in vec3 vPosition;

uniform vec3 color;
uniform sampler2D diffuseTexture;
uniform bool useTexture;
uniform float alpha;  // 透明度（0-1）

out vec4 fragColor;

void main() {
  vec3 baseColor = useTexture ? texture(diffuseTexture, vUv).rgb : color;
  float finalAlpha = useTexture ? texture(diffuseTexture, vUv).a * alpha : alpha;
  
  fragColor = vec4(baseColor, finalAlpha);
}
`;
