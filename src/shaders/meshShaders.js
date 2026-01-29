// Mesh 渲染 Shader（原 Holotech shaders/meshShaders.js）

export const meshVertexShaderSource = `#version 300 es
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

export const meshFragmentShaderSource = `#version 300 es
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
uniform vec3 cameraPosition;  // 相机位置（世界空间）
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
  // 使用 gl_FrontFacing 来判断当前片段是正面还是背面
  // gl_FrontFacing 是 WebGL 内置变量，当片段属于正面三角形时为 true
  // 由于我们禁用了背面剔除（gl.disable(gl.CULL_FACE)），所以可以检测到背面
  // 注意：gl_FrontFacing 基于顶点的缠绕顺序（winding order）
  // 我们的索引顺序是 [0,1,2, 0,2,3]，这是逆时针（正面），所以：
  // - gl_FrontFacing = true：正面（应该看到图片）
  // - gl_FrontFacing = false：背面（应该看到纯色）
  bool isBackFace = gl_FrontFacing;
  
  // 获取基础颜色（纹理或纯色）
  vec3 baseColor = useTexture ? texture(diffuseTexture, vUv).rgb : color;
  
  // 如果是背面且启用背面显示，混合纯色和半透明图片
  if (isBackFace && showBackFace) {
    // 背面：混合纯色（backFaceColor，alpha = backFaceOpacity）和图片（alpha = 0.3）
    vec3 textureColor = useTexture ? texture(diffuseTexture, vUv).rgb : color;
    float textureAlpha = 0.3; // 图片的 alpha
    
    // 混合颜色：图片颜色 * textureAlpha + 纯色 * (1 - textureAlpha) * backFaceOpacity
    // 这样图片会以 0.3 的强度显示，纯色会以 backFaceOpacity 的强度叠加
    vec3 mixedColor = textureColor * textureAlpha + backFaceColor * (1.0 - textureAlpha) * backFaceOpacity;
    // 最终 alpha：图片的 alpha + 纯色的 alpha（考虑混合）
    float finalAlpha = textureAlpha + backFaceOpacity * (1.0 - textureAlpha);
    fragColor = vec4(mixedColor, finalAlpha);
    return;
  }
  
  // 正面：正常渲染纹理或颜色
  // 如果使用纹理（如相机原图平面），使用 Unlit 模式直接输出纹理颜色
  // 如果不使用纹理（纯色 mesh），则使用光照计算
  vec3 finalColor;
  if (useTexture) {
    // Unlit 模式：直接使用纹理颜色，不进行光照计算
    finalColor = baseColor;
  } else {
    // 有光照模式：计算漫反射和环境光
    vec3 lightDir = normalize(-lightDirection);
    float NdotL = max(dot(vNormal, lightDir), 0.0);
    vec3 diffuse = baseColor * lightColor * NdotL * lightIntensity;
    vec3 ambient = baseColor * ambientIntensity;
    finalColor = ambient + diffuse;
  }
  
  fragColor = vec4(finalColor, 1.0);
}
`;
