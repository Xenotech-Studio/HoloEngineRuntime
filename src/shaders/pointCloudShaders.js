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

// colmap4d 4D time gating (all default to the disabled/identity case)
uniform float timeEnabled;   // 0.0 = disabled (bit-identical to the pre-4D path)
uniform float currentTime;   // scrubber time, relative seconds
uniform float sigmaT;        // half-window (fully shown), relative seconds
uniform float sigmaSoft;     // B3 softening band width beyond sigmaT (0 = hard cutoff = B2)

in vec2 position;
in vec3 instancePos;
in vec3 instanceColor;
in float instanceTime;       // relative seconds; < 0.0 = temporally-unbounded (always shown)

out vec3 vColor;

void main() {
  vec4 world = model * vec4(instancePos, 1.0);
  vec4 clip = projection * view * world;
  vec2 ndc = clip.xy / clip.w;
  float depthNDC = clip.z / clip.w;
  vColor = instanceColor;

  // colmap4d time gating. Relative seconds are >= 0 by construction (t - t0); a negative
  // instanceTime marks a temporally-unbounded point that is never gated. Instead of fading
  // alpha (which would force blending + depth sorting), out-of-window points shrink their
  // quad to nothing in the soft band [sigmaT, sigmaT+sigmaSoft] and beyond that are pushed
  // outside the NDC clip box (never w = 0). timeEnabled=0 or sigmaSoft=0 keeps prior behavior.
  float sizeScale = 1.0;
  if (timeEnabled > 0.5 && instanceTime >= 0.0) {
    float d = abs(instanceTime - currentTime);
    float outer = sigmaT + sigmaSoft;
    if (d > outer) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    if (sigmaSoft > 0.0 && d > sigmaT) {
      sizeScale = clamp((outer - d) / sigmaSoft, 0.0, 1.0);
    }
  }

  vec2 halfSize = vec2(pointSize, pointSize) / viewport;
  vec2 offset = (position.xy * 0.5) * halfSize * sizeScale;
  gl_Position = vec4(ndc + offset, depthNDC, 1.0);
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
