/**
 * Mesh Lit Shader（有光照）
 * 计算漫反射和环境光
 */

export const meshLitVertexShaderSource = `#version 300 es
precision highp float;

uniform mat4 projection;
uniform mat4 view;
uniform mat4 model;

in vec3 position;
in vec3 normal;
in vec2 uv;

out vec3 vNormal;
out vec2 vUv;
out vec3 vPosition;

void main() {
  mat4 mvp = projection * view * model;
  vec4 worldPos = model * vec4(position, 1.0);
  
  vPosition = worldPos.xyz;
  
  mat3 normalMatrix = mat3(transpose(inverse(model)));
  vNormal = normalize(normalMatrix * normal);
  vUv = uv;
  
  gl_Position = mvp * vec4(position, 1.0);
}
`;

export const meshLitFragmentShaderSource = `#version 300 es
precision highp float;

in vec3 vNormal;
in vec2 vUv;
in vec3 vPosition;

uniform vec3 color;
uniform sampler2D diffuseTexture;
uniform bool useTexture;

uniform vec3 lightDirection;
uniform vec3 lightColor;
uniform float lightIntensity;
uniform float ambientIntensity;
uniform int debugMode;

// 用于背面检测和渲染
uniform vec3 backFaceColor;     // 背面颜色
uniform float backFaceOpacity; // 背面透明度
uniform bool showBackFace;     // 是否显示背面

out vec4 fragColor;

void main() {
  if (debugMode == 0) {
    vec3 normalColor = (vNormal + 1.0) * 0.5;
    normalColor = clamp(normalColor, 0.0, 1.0);
    fragColor = vec4(normalColor, 1.0);
    return;
  }
  
  // 检测是否从背面看
  bool isBackFace = !gl_FrontFacing;
  
  // 获取基础颜色（纹理或纯色）
  vec3 baseColor = useTexture ? texture(diffuseTexture, vUv).rgb : color;
  
  // 如果是背面且启用背面显示，混合纯色和半透明图片
  if (isBackFace && showBackFace) {
    vec3 textureColor = useTexture ? texture(diffuseTexture, vUv).rgb : color;
    float textureAlpha = 0.3;
    vec3 mixedColor = textureColor * textureAlpha + backFaceColor * (1.0 - textureAlpha) * backFaceOpacity;
    float finalAlpha = textureAlpha + backFaceOpacity * (1.0 - textureAlpha);
    fragColor = vec4(mixedColor, finalAlpha);
    return;
  }
  
  // 正面：计算光照
  vec3 lightDir = normalize(-lightDirection);
  float NdotL = max(dot(vNormal, lightDir), 0.0);
  vec3 diffuse = baseColor * lightColor * NdotL * lightIntensity;
  vec3 ambient = baseColor * ambientIntensity;
  vec3 finalColor = ambient + diffuse;
  
  fragColor = vec4(finalColor, 1.0);
}
`;
