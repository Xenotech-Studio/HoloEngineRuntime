import { dataTextureShader } from './dataTextureShader.js';
/**
 * 4DGS Splat Shader（含 motion，Holotech 同源）
 * 原 Holotech src/shaders.js
 */

export const vertexShaderSource = `
  #version 300 es
  precision highp float;
  precision highp int;

  ${dataTextureShader('u_texture')}
  uniform mat4 projection, view, model;
  uniform vec2 focal;
  uniform vec2 viewport;
  uniform bool depthWriteOnly;
  uniform bool colorOnlyPass;
  // 4D temporal opacity cutoff; independent of depth opacity thresholds.
  uniform float motionAlphaCutoff;
  uniform float centerOpacityThreshold;
  uniform float time;
  uniform float u_gaussianScaleLerp;
  uniform float u_gaussianScaleMin;
  // Linear record stride: lite=4, hp_scale_rot=8, KiriV=32 RGBA texels.
  // textureSize supplies the physical array layout; CPU row padding is preserved.
  // Addressing only needs the stride shift, including across layer boundaries.
  uniform int  u_strideColShift;
  uniform bool u_useHpScaleRot;
  uniform bool u_kiriv;
  uniform bool u_freetimegs;
  uniform bool u_kirivSH;
  uniform int u_kirivSHDegree;
  uniform float u_kirivOpacityFloor;

  in vec2 position;
  in int index;

  out vec4 vColor;
  uniform float quadTailSigma;
  out vec2 vPosition;


  float kv(uint word) {
      uvec4 value = fetch_u_texture(uint(index), word >> 2u, (1u << uint(u_strideColShift)));
      return uintBitsToFloat(value[int(word & 3u)]);
  }

  vec3 kirivColor(vec3 evolvedPosition) {
      if (!u_kirivSH) return vec3(kv(26u), kv(27u), kv(28u));
      vec3 origin = (inverse(view * model) * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      vec3 d = evolvedPosition - origin;
      d = length(d) > 0.0 ? normalize(d) : vec3(0.0, 0.0, 1.0);
      float x=d.x, y=d.y, z=d.z, z2=z*z;
      // Real SH, l ascending / m=-l..l, matching the FTGS gsplat basis.
      float b[16];
      b[0]=0.28209479177387814;
      b[1]=-0.48860251190292*y; b[2]=0.48860251190292*z; b[3]=-0.48860251190292*x;
      b[4]=1.092548430592079*x*y; b[5]=-1.092548430592079*y*z;
      b[6]=0.9461746957575601*z2-0.3153915652525201;
      b[7]=-1.092548430592079*x*z; b[8]=0.5462742152960395*(x*x-y*y);
      b[9]=-0.5900435899266435*y*(3.0*x*x-y*y);
      b[10]=2.890611442640554*x*y*z;
      b[11]=y*(-2.285228997322329*z2+0.4570457994644658);
      b[12]=z*(1.865881662950577*z2-1.119528997770346);
      b[13]=x*(-2.285228997322329*z2+0.4570457994644658);
      b[14]=1.445305721320277*z*(x*x-y*y);
      b[15]=-0.5900435899266435*x*(x*x-3.0*y*y);
      int n=(u_kirivSHDegree+1)*(u_kirivSHDegree+1);
      vec3 rgb=vec3(0.5);
      for (int j=0; j<16; j++) {
          if (j>=n) break;
          rgb += b[j]*vec3(kv(uint(26+j)), kv(uint(26+n+j)), kv(uint(26+2*n+j)));
      }
      return max(rgb, vec3(0.0));
  }

  void main () {
      gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
      float scaleT = clamp(u_gaussianScaleLerp, 0.0, 1.0);

      uvec4 motion1 = fetch_u_texture(uint(index), 3u, (1u << uint(u_strideColShift)));
      vec2 trbf = u_kiriv ? vec2(kv(11u), kv(12u)) : unpackHalf2x16(motion1.w);
      float dt = time - trbf.x;

      // Use x*x instead of pow(x, 2.0) -- some ANGLE/Metal/driver implementations of pow
      // hit a 0^positive edge case that produces NaN, which then cascades through topacity
      // and breaks alpha blending for gaussians whose trbf_center happens to equal time.
      float dtOverScale = dt / trbf.y;
      float topacity = exp(-(dtOverScale * dtOverScale));
      // FTGS uses its full temporal envelope and opacity floor, without STG culling.
      if (!u_freetimegs) {
          float topacityCull = mix(1.0, topacity, scaleT);
          if (topacityCull < motionAlphaCutoff) return;
      }

      uvec4 motion0 = fetch_u_texture(uint(index), 2u, (1u << uint(u_strideColShift)));
      uvec4 static0 = fetch_u_texture(uint(index), 0u, (1u << uint(u_strideColShift)));

      vec2 m0 = unpackHalf2x16(motion0.x), m1 = unpackHalf2x16(motion0.y), m2 = unpackHalf2x16(motion0.z), 
           m3 = unpackHalf2x16(motion0.w), m4 = unpackHalf2x16(motion1.x); 
      
      vec4 trot = vec4(unpackHalf2x16(motion1.y).xy, unpackHalf2x16(motion1.z).xy) * dt;
      vec3 tpos = (vec3(m0.xy, m1.x) * dt + vec3(m1.y, m2.xy) * dt*dt + vec3(m3.xy, m4.x) * dt*dt*dt);
      if (u_kiriv) {
          tpos = vec3(kv(13u), kv(14u), kv(15u))*dt;
          trot = vec4(0.0);
          if (!u_freetimegs) {
              tpos += vec3(kv(16u), kv(17u), kv(18u))*dt*dt + vec3(kv(19u), kv(20u), kv(21u))*dt*dt*dt;
              trot = vec4(kv(22u), kv(23u), kv(24u), kv(25u))*dt;
          }
      }
      
      vec4 cam = view * model * vec4(uintBitsToFloat(static0.xyz) + tpos, 1);
      vec4 pos = projection * cam;
  
      float clip = 1.2 * pos.w;
      if (pos.z < -clip || pos.x < -clip || pos.x > clip || pos.y < -clip || pos.y > clip) return;
      uvec4 static1 = fetch_u_texture(uint(index), 1u, (1u << uint(u_strideColShift)));

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

      if (u_kiriv) {
          vec3 color = kirivColor(uintBitsToFloat(static0.xyz) + tpos);
          if (u_freetimegs) {
              vColor = vec4(color, max(kv(10u)*topacity, u_kirivOpacityFloor));
          } else {
              vColor = depthEff * vec4(color, mix(1.0, kv(10u), scaleT)*topacityEff);
          }
      }

      // Same final center alpha and threshold as the fragment depth pass.
      // In 4D scaleT=0 blends alpha to one; raw packed alpha is not sufficient.
      if (depthWriteOnly && vColor.a < centerOpacityThreshold) return;
      if (!depthWriteOnly && colorOnlyPass && vColor.a == 0.0) return;

      vec4 rot;
      vec3 gaussianScale;
      if (u_kiriv) {
          rot = vec4(kv(3u), kv(4u), kv(5u), kv(6u)) + trot;
          gaussianScale = vec3(kv(7u), kv(8u), kv(9u));
      } else if (u_useHpScaleRot) {
          // hp_scale_rot: pixel 4 (u32[16..19]) = fp32 rotation (wxyz)
          //               pixel 5 (u32[20..22]) = fp32 scale (xyz), u32[23] = pad
          uvec4 hpRot = fetch_u_texture(uint(index), 4u, (1u << uint(u_strideColShift)));
          uvec4 hpScl = fetch_u_texture(uint(index), 5u, (1u << uint(u_strideColShift)));
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
      // Shrink after the axis clamp, preserving the original Gaussian footprint.
      // Keep the default path free of scaling; geometry and varying must agree.
      vec2 quadPosition = position;
      float quadScale = quadTailSigma / 2.0;
      if (quadTailSigma != 2.0) {
          quadPosition = position * quadScale;
      }
      gl_Position = vec4(
          vCenter 
          + quadPosition.x * majorAxis / viewport
          + quadPosition.y * minorAxis / viewport, depthNDC, 1.0);

      vPosition = quadPosition;
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
  
  // Tail radius in vPosition units: 2 sigma => A=-4; 1.5 sigma => A=-2.25.
  uniform float quadTailSigma;
  out vec4 fragColor;
  
  void main () {
      float A = -dot(vPosition, vPosition);
      if (A < -(quadTailSigma * quadTailSigma)) discard;
      float B = exp(A) * vColor.a;
      
      if (depthWriteOnly) {
          if (vColor.a < centerOpacityThreshold) {
              discard;
          }
          if (B < depthOpacityThreshold) {
              discard;
          }
          fragColor = vec4(0.0, 0.0, 0.0, 0.0);
      } else {
          fragColor = vec4(B * vColor.rgb, B);
      }
  }
`.trim();
