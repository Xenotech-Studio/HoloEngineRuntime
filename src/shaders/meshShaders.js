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

out vec4 fragColor;

void main() {
  if (debugMode == 0) {
    vec3 normalColor = (vNormal + 1.0) * 0.5;
    normalColor = clamp(normalColor, 0.0, 1.0);
    fragColor = vec4(normalColor, 1.0);
    return;
  }
  
  vec3 baseColor = useTexture ? texture(diffuseTexture, vUv).rgb : color;
  vec3 lightDir = normalize(-lightDirection);
  float NdotL = max(dot(vNormal, lightDir), 0.0);
  vec3 diffuse = baseColor * lightColor * NdotL * lightIntensity;
  vec3 ambient = baseColor * ambientIntensity;
  vec3 finalColor = ambient + diffuse;
  
  fragColor = vec4(finalColor, 1.0);
}
`;
