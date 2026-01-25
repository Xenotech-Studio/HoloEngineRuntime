// 3DGS Shader（静态高斯，原 Holotech shaders/gaussian3dShaders.js）

export const vertexShader3DGSSource = `
  #version 300 es
  precision highp float;
  precision highp int;
  
  uniform highp usampler2D u_texture;
  uniform highp sampler2D u_shTexture;
  uniform mat4 projection, view, model;
  uniform vec2 focal;
  uniform vec2 viewport;
  uniform int sphericalHarmonicsDegree;
  
  in vec2 position;
  in int index;
  
  out vec4 vColor;
  out vec2 vPosition;
  
  vec3 evaluateSH(int degree, vec3 dir) {
    return vec3(1.0);
  }
  
  void main () {
      gl_Position = vec4(0.0, 0.0, 2.0, 1.0);

      uvec4 static0 = texelFetch(u_texture, ivec2(((uint(index) & 0xffu) << 2), uint(index) >> 8), 0);
      uvec4 static1 = texelFetch(u_texture, ivec2(((uint(index) & 0xffu) << 2) | 1u, uint(index) >> 8), 0);

      vec3 pos = uintBitsToFloat(static0.xyz);
      vec4 cam = view * model * vec4(pos, 1);
      vec4 pos_proj = projection * cam;
  
      float clip = 1.2 * pos_proj.w;
      if (pos_proj.z < -clip || pos_proj.x < -clip || pos_proj.x > clip || pos_proj.y < -clip || pos_proj.y > clip) return;

      vec4 rot = vec4(unpackHalf2x16(static0.w).xy, unpackHalf2x16(static1.x).xy);
      vec3 gaussianScale = vec3(unpackHalf2x16(static1.y).xy, unpackHalf2x16(static1.z).x);
      
      vec3 modelScale = vec3(
        length(model[0].xyz),
        length(model[1].xyz),
        length(model[2].xyz)
      );
      vec3 scale = gaussianScale * modelScale;
      
      rot /= sqrt(dot(rot, rot));

      mat3 R = mat3(
        1.0 - 2.0 * (rot.z * rot.z + rot.w * rot.w), 2.0 * (rot.y * rot.z - rot.x * rot.w), 2.0 * (rot.y * rot.w + rot.x * rot.z),
        2.0 * (rot.y * rot.z + rot.x * rot.w), 1.0 - 2.0 * (rot.y * rot.y + rot.w * rot.w), 2.0 * (rot.z * rot.w - rot.x * rot.y),
        2.0 * (rot.y * rot.w - rot.x * rot.z), 2.0 * (rot.z * rot.w + rot.x * rot.y), 1.0 - 2.0 * (rot.y * rot.y + rot.z * rot.z));
      
      mat3 S = mat3(scale.x, 0.0, 0.0, 0.0, scale.y, 0.0, 0.0, 0.0, scale.z);
      mat3 M = S * R;
      mat3 Vrk = 4.0 * transpose(M) * M;
      
      vec3 modelCol0 = model[0].xyz;
      vec3 modelCol1 = model[1].xyz;
      vec3 modelCol2 = model[2].xyz;
      float len0 = length(modelCol0);
      float len1 = length(modelCol1);
      float len2 = length(modelCol2);
      vec3 rotCol0 = len0 > 1e-6 ? modelCol0 / len0 : vec3(1.0, 0.0, 0.0);
      vec3 rotCol1 = len1 > 1e-6 ? modelCol1 / len1 : vec3(0.0, 1.0, 0.0);
      vec3 rotCol2 = len2 > 1e-6 ? modelCol2 / len2 : vec3(0.0, 0.0, 1.0);
      vec3 v0 = normalize(rotCol0);
      vec3 v1 = rotCol1 - dot(rotCol1, v0) * v0;
      v1 = normalize(v1);
      vec3 v2 = rotCol2 - dot(rotCol2, v0) * v0 - dot(rotCol2, v1) * v1;
      v2 = normalize(v2);
      if (dot(cross(v0, v1), v2) < 0.0) {
        v2 = -v2;
      }
      mat3 modelRot = mat3(v0, v1, v2);
      Vrk = modelRot * Vrk * transpose(modelRot);
      
      mat3 J = mat3(
        focal.x / cam.z, 0., -(focal.x * cam.x) / (cam.z * cam.z), 
        0., -focal.y / cam.z, (focal.y * cam.y) / (cam.z * cam.z), 
        0., 0., 0.
      );
      mat3 T = transpose(mat3(view)) * J;
      mat3 cov2d = transpose(T) * Vrk * T;
  
      float mid = (cov2d[0][0] + cov2d[1][1]) / 2.0;
      float radius = length(vec2((cov2d[0][0] - cov2d[1][1]) / 2.0, cov2d[0][1]));
      float lambda1 = mid + radius, lambda2 = mid - radius;
  
      if(lambda2 < 0.0) return;
      vec2 diagonalVector = normalize(vec2(cov2d[0][1], lambda1 - cov2d[0][0]));
      vec2 majorAxis = min(sqrt(2.0 * lambda1), 1024.0) * diagonalVector;
      vec2 minorAxis = min(sqrt(2.0 * lambda2), 1024.0) * vec2(diagonalVector.y, -diagonalVector.x);
      
      uint rgba = static1.w;
      float opacity = float((rgba >> 24) & 0xffu) / 255.0;
      
      vColor = 
        clamp(pos_proj.z/pos_proj.w+1.0, 0.0, 1.0) * 
        vec4(1.0, 1.0, 1.0, opacity) *
        vec4(
          (rgba) & 0xffu, 
          (rgba >> 8) & 0xffu, 
          (rgba >> 16) & 0xffu, 
          (rgba >> 24) & 0xffu) / 255.0;

      vec2 vCenter = vec2(pos_proj) / pos_proj.w;
      float depthNDC = pos_proj.z / pos_proj.w;
      gl_Position = vec4(
          vCenter 
          + position.x * majorAxis / viewport 
          + position.y * minorAxis / viewport, depthNDC, 1.0);

      vPosition = position;
  }
`.trim();

export const fragmentShader3DGSSource = `
  #version 300 es
  precision highp float;
  
  in vec4 vColor;
  in vec2 vPosition;
  
  uniform float depthOpacityThreshold;
  uniform float centerOpacityThreshold;
  uniform bool depthWriteOnly;
  
  out vec4 fragColor;
  
  void main () {
      float A = -dot(vPosition, vPosition);
      if (A < -4.0) discard;
      float B = exp(A) * vColor.a;
      
      if (depthWriteOnly) {
          if (vColor.a < centerOpacityThreshold) {
              discard;
          }
          if (B < depthOpacityThreshold) {
              discard;
          }
          gl_FragDepth = gl_FragCoord.z;
          fragColor = vec4(0.0, 0.0, 0.0, 0.0);
      } else {
          gl_FragDepth = gl_FragCoord.z;
          fragColor = vec4(B * vColor.rgb, B);
      }
  }
`.trim();
