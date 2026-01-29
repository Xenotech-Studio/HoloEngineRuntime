/**
 * Mesh Unlit Shader（无光照）
 * 直接输出纹理或颜色，不进行光照计算
 */

export const meshUnlitVertexShaderSource = `#version 300 es
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

export const meshUnlitFragmentShaderSource = `#version 300 es
precision highp float;

in vec2 vUv;
in vec3 vPosition;

uniform vec3 color;
uniform sampler2D diffuseTexture;
uniform bool useTexture;
uniform float alpha;  // 透明度（0-1）

// 用于背面检测和渲染
uniform vec3 backFaceColor;     // 背面颜色
uniform float backFaceOpacity; // 背面透明度
uniform bool showBackFace;     // 是否显示背面

out vec4 fragColor;

void main() {
  // 检测是否从背面看
  bool isBackFace = !gl_FrontFacing;
  
  // 获取基础颜色（纹理或纯色）
  vec3 baseColor = useTexture ? texture(diffuseTexture, vUv).rgb : color;
  
  // 如果是背面且启用背面显示，混合纯色和半透明图片
  if (isBackFace && showBackFace) {
    vec3 textureColor = useTexture ? texture(diffuseTexture, vUv).rgb : color;
    float textureAlpha = 0.3 * alpha; // 应用 alpha
    vec3 mixedColor = textureColor * textureAlpha + backFaceColor * (1.0 - textureAlpha) * backFaceOpacity;
    float finalAlpha = textureAlpha + backFaceOpacity * (1.0 - textureAlpha);
    fragColor = vec4(mixedColor, finalAlpha);
    return;
  }
  
  // 正面：直接输出颜色（Unlit），应用 alpha
  fragColor = vec4(baseColor, alpha);
}
`;
