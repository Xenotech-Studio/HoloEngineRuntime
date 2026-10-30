/**
 * 4DGS Splat Shader（含 motion，Holotech 同源）
 * 原 Holotech src/shaders.js
 */

export const vertexShaderSource = `
  #version 300 es
  precision highp float;
  precision highp int;

  uniform highp usampler2D u_texture;
  uniform mat4 projection, view, model;
  uniform vec2 focal;
  uniform vec2 viewport;
  uniform bool depthWriteOnly;
  uniform bool colorOnlyPass;
  uniform float centerOpacityThreshold;
  uniform float time;
  uniform float u_gaussianScaleLerp;
  uniform float u_gaussianScaleMin;
  // splatv 精度变体支持。
  //   stride=4 pixels/gauss (16 u32) — lite (默认): 1024 gauss/row,
  //       columnMask=0x3FFu, columnShift=2, rowShift=10.
  //   stride=8 pixels/gauss (32 u32) — hp_scale_rot: 512 gauss/row,
  //       columnMask=0x1FFu, columnShift=3, rowShift=9. 在 pixel 4-5 (u32 16..22) 增量
  //       保存 fp32 rotation + fp32 scale, pixel 0-3 与 lite bit-equivalent.
  //   u_useHpScaleRot=true 时 shader 从 pixel 4-5 读 fp32 rot/scale 代替 fp16 fallback.
  uniform uint u_strideColMask;
  uniform int  u_strideColShift;
  uniform int  u_strideRowShift;
  uniform bool u_useHpScaleRot;

  in vec2 position;
  in int index;

  out vec4 vColor;
  out vec2 vPosition;

  ivec2 gaussCoord(uint subPixel) {
      // 把 gauss index + sub-pixel 偏移转成纹理坐标。
      uint col = ((uint(index) & u_strideColMask) << uint(u_strideColShift)) | subPixel;
      uint row = uint(index) >> uint(u_strideRowShift);
      return ivec2(int(col), int(row));
  }

  void main () {
      gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
      float scaleT = clamp(u_gaussianScaleLerp, 0.0, 1.0);

      uvec4 motion1 = texelFetch(u_texture, gaussCoord(3u), 0);
      vec2 trbf = unpackHalf2x16(motion1.w);
      float dt = time - trbf.x;

      // Use x*x instead of pow(x, 2.0) -- some ANGLE/Metal/driver implementations of pow
      // hit a 0^positive edge case that produces NaN, which then cascades through topacity
      // and breaks alpha blending for gaussians whose trbf_center happens to equal time.
      float dtOverScale = dt / trbf.y;
      float topacity = exp(-(dtOverScale * dtOverScale));
      float topacityCull = mix(1.0, topacity, scaleT);
      if (topacityCull < 0.02) return;

      uvec4 motion0 = texelFetch(u_texture, gaussCoord(2u), 0);
      uvec4 static0 = texelFetch(u_texture, gaussCoord(0u), 0);

      vec2 m0 = unpackHalf2x16(motion0.x), m1 = unpackHalf2x16(motion0.y), m2 = unpackHalf2x16(motion0.z), 
           m3 = unpackHalf2x16(motion0.w), m4 = unpackHalf2x16(motion1.x); 
      
      vec4 trot = vec4(unpackHalf2x16(motion1.y).xy, unpackHalf2x16(motion1.z).xy) * dt;
      vec3 tpos = (vec3(m0.xy, m1.x) * dt + vec3(m1.y, m2.xy) * dt*dt + vec3(m3.xy, m4.x) * dt*dt*dt);
      
      vec4 cam = view * model * vec4(uintBitsToFloat(static0.xyz) + tpos, 1);
      vec4 pos = projection * cam;
  
      float clip = 1.2 * pos.w;
      if (pos.z < -clip || pos.x < -clip || pos.x > clip || pos.y < -clip || pos.y > clip) return;
      uvec4 static1 = texelFetch(u_texture, gaussCoord(1u), 0);

      uint rgba = static1.w;
      vec4 splat = vec4(
          float((rgba) & 0xffu),
          float((rgba >> 8) & 0xffu),
          float((rgba >> 16) & 0xffu),
          float((rgba >> 24) & 0xffu)
      ) / 255.0;
      float depthF = clamp(pos.z / pos.w + 1.0, 0.0, 1.0);
      float depthEff = mix(1.0, depthF, scaleT);
      float topacityEff = mix(1.0, topacity, scaleT);
      float alphaEff = mix(1.0, splat.a, scaleT);
      vColor = depthEff * vec4(1.0, 1.0, 1.0, topacityEff) * vec4(splat.rgb, alphaEff);

      // Same final center alpha and threshold as the fragment depth pass.
      // In 4D scaleT=0 blends alpha to one; raw packed alpha is not sufficient.
      if (depthWriteOnly && vColor.a < centerOpacityThreshold) return;
      if (!depthWriteOnly && colorOnlyPass && vColor.a == 0.0) return;

      vec4 rot;
      vec3 gaussianScale;
      if (u_useHpScaleRot) {
          // hp_scale_rot: pixel 4 (u32[16..19]) = fp32 rotation (xyzw)
          //               pixel 5 (u32[20..22]) = fp32 scale (xyz), u32[23] = pad
          uvec4 hpRot = texelFetch(u_texture, gaussCoord(4u), 0);
          uvec4 hpScl = texelFetch(u_texture, gaussCoord(5u), 0);
          rot = vec4(uintBitsToFloat(hpRot.x), uintBitsToFloat(hpRot.y),
                     uintBitsToFloat(hpRot.z), uintBitsToFloat(hpRot.w)) + trot;
          gaussianScale = vec3(uintBitsToFloat(hpScl.x), uintBitsToFloat(hpScl.y), uintBitsToFloat(hpScl.z));
      } else {
          rot = vec4(unpackHalf2x16(static0.w).xy, unpackHalf2x16(static1.x).xy) + trot;
          gaussianScale = vec3(unpackHalf2x16(static1.y).xy, unpackHalf2x16(static1.z).x);
      }
      
      vec3 minGs = vec3(max(u_gaussianScaleMin, 0.0));
      vec3 scale = mix(minGs, gaussianScale, scaleT);
      
      rot /= sqrt(dot(rot, rot));

      mat3 R = mat3(
        1.0 - 2.0 * (rot.z * rot.z + rot.w * rot.w), 2.0 * (rot.y * rot.z - rot.x * rot.w), 2.0 * (rot.y * rot.w + rot.x * rot.z),
        2.0 * (rot.y * rot.z + rot.x * rot.w), 1.0 - 2.0 * (rot.y * rot.y + rot.w * rot.w), 2.0 * (rot.z * rot.w - rot.x * rot.y),
        2.0 * (rot.y * rot.w - rot.x * rot.z), 2.0 * (rot.z * rot.w + rot.x * rot.y), 1.0 - 2.0 * (rot.y * rot.y + rot.z * rot.z));
      
      mat3 S = mat3(scale.x, 0.0, 0.0, 0.0, scale.y, 0.0, 0.0, 0.0, scale.z);
      mat3 M = S * R;
      mat3 Vrk = 4.0 * transpose(M) * M;
      
      // Audit #1: covariance push-forward, Sigma_world = A Sigma_local A^T.
      // Keep STG's wxyz + column-major R convention above; do not commute
      // model-axis scaling with local rotation or discard reflection/shear.
      mat3 A = mat3(model);
      Vrk = A * Vrk * transpose(A);
      mat3 J = mat3(
        focal.x / cam.z, 0., -(focal.x * cam.x) / (cam.z * cam.z), 
        0., -focal.y / cam.z, (focal.y * cam.y) / (cam.z * cam.z), 
        0., 0., 0.
    );
      mat3 T = transpose(mat3(view)) * J;
      mat3 cov2d = transpose(T) * Vrk * T;
  
      // Audit #3: symmetric 2x2 eigensystem, scaled to avoid overflow.
      // Use det/lambda_max for the thin axis, not cancellation-prone mid-radius.
      vec3 covariance = vec3(cov2d[0][0],
          0.5 * cov2d[0][1] + 0.5 * cov2d[1][0], cov2d[1][1]);
      if (any(isnan(covariance)) || any(isinf(covariance))) return;
      float magnitude = max(max(abs(covariance.x), abs(covariance.y)), abs(covariance.z));
      vec3 c = covariance / max(magnitude, 1e-30);
      float mid = 0.5 * (c.x + c.z);
      float radius = length(vec2(0.5 * (c.x - c.z), c.y));
      float major = max(mid + radius, 0.0);
      float determinant = c.x * c.z - c.y * c.y;
      // 8 float32 eps in normalized units: repair roundoff, not genuinely
      // indefinite input. A valid covariance is positive semidefinite.
      const float psdTolerance = 9.5367431640625e-7;
      if (min(c.x, c.z) < -psdTolerance || determinant < -psdTolerance) return;
      float minor = major > 0.0 ? max(determinant / major, 0.0) : 0.0;
      vec2 eigenvector = c.x >= c.z ? vec2(major - c.z, c.y) : vec2(c.y, major - c.x);
      float eigenLength = length(eigenvector);
      vec2 diagonalVector = eigenLength > 0.0 ? eigenvector / eigenLength : vec2(1.0, 0.0);

      // Audit #2: training forward_lite/forward.cu adds 0.3 pixel^2 I.
      // This shader stores 4*Sigma (paired with /viewport below), so add 1.2.
      // Adding isotropic I to eigenvalues is equivalent to adding it to the
      // diagonal, but preserves the pixel floor even for very thin ellipses.
      float lambda1 = magnitude * major + 1.2;
      float lambda2 = magnitude * minor + 1.2;
      vec2 majorAxis = min(sqrt(2.0 * lambda1), 1024.0) * diagonalVector;
      vec2 minorAxis = min(sqrt(2.0 * lambda2), 1024.0) * vec2(diagonalVector.y, -diagonalVector.x);
      

      vec2 vCenter = vec2(pos) / pos.w;
      float depthNDC = pos.z / pos.w;
      gl_Position = vec4(
          vCenter 
          + position.x * majorAxis / viewport 
          + position.y * minorAxis / viewport, depthNDC, 1.0);

      vPosition = position;
  }
`.trim();

export const fragmentShaderSource = `
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
