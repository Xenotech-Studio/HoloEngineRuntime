// WebGL 工具函数

/**
 * 创建并编译 shader
 */
export function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compilation error: ${info}`);
  }
  
  return shader;
}

/**
 * 创建并链接 shader program
 */
export function createProgram(gl, vertexShader, fragmentShader) {
  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program linking error: ${info}`);
  }
  
  return program;
}

/**
 * 根据目标 FOV 和 canvas 尺寸计算动态焦距
 * @param {number} targetVerticalFOV - 目标垂直 FOV（角度），如果为 null 则使用 baseFx/baseFy
 * @param {number} canvasWidth - Canvas 宽度
 * @param {number} canvasHeight - Canvas 高度
 * @param {number} baseFx - 基础 fx（当 targetVerticalFOV 为 null 时使用）
 * @param {number} baseFy - 基础 fy（当 targetVerticalFOV 为 null 时使用）
 * @returns {{fx: number, fy: number}} 计算后的焦距
 */
export function calculateDynamicFocal(targetVerticalFOV, canvasWidth, canvasHeight, baseFx, baseFy) {
  if (targetVerticalFOV !== null && targetVerticalFOV !== undefined && canvasHeight > 0) {
    // 将角度转换为弧度
    const verticalFOVRad = (targetVerticalFOV * Math.PI) / 180;
    
    // 根据 FOV 和 canvas 高度计算 fy
    // 公式：verticalFOV = 2 * atan(canvasHeight / (2 * fy))
    // 因此：fy = canvasHeight / (2 * tan(verticalFOV / 2))
    const fy = canvasHeight / (2 * Math.tan(verticalFOVRad / 2));
    
    // 根据纵向 FOV 和宽高比计算横向 FOV，然后计算 fx
    // 这样可以确保横向 FOV 根据宽高比正确调整，避免画面变形
    const aspectRatio = canvasWidth / canvasHeight;
    const horizontalFOVRad = 2 * Math.atan(Math.tan(verticalFOVRad / 2) * aspectRatio);
    // 根据横向 FOV 计算 fx
    // 公式：horizontalFOV = 2 * atan(canvasWidth / (2 * fx))
    // 因此：fx = canvasWidth / (2 * tan(horizontalFOV / 2))
    const fx = canvasWidth / (2 * Math.tan(horizontalFOVRad / 2));
    
    return { fx, fy };
  }
  // 如果没有提供 FOV，使用相机原始焦距
  return { fx: baseFx, fy: baseFy };
}

/**
 * 获取投影矩阵
 * 使用与原始 hybrid.js 相同的计算方式
 */
export function getProjectionMatrix(fx, fy, width, height) {
  const znear = 0.2;
  const zfar = 200;
  return [
    (2 * fx) / width, 0, 0, 0,
    0, -(2 * fy) / height, 0, 0,
    0, 0, zfar / (zfar - znear), 1,
    0, 0, -(zfar * znear) / (zfar - znear), 0,
  ];
}

/**
 * 获取视图矩阵
 * 使用与原始 hybrid.js 相同的计算方式
 */
export function getViewMatrix(camera) {
  const R = camera.rotation.flat();
  const t = camera.position;
  const camToWorld = [
    R[0], R[1], R[2], 0,
    R[3], R[4], R[5], 0,
    R[6], R[7], R[8], 0,
    -t[0] * R[0] - t[1] * R[3] - t[2] * R[6],
    -t[0] * R[1] - t[1] * R[4] - t[2] * R[7],
    -t[0] * R[2] - t[1] * R[5] - t[2] * R[8],
    1
  ];
  return camToWorld;
}

/**
 * 4x4 矩阵乘法
 */
export function multiply4(a, b) {
  return [
    b[0] * a[0] + b[1] * a[4] + b[2] * a[8] + b[3] * a[12],
    b[0] * a[1] + b[1] * a[5] + b[2] * a[9] + b[3] * a[13],
    b[0] * a[2] + b[1] * a[6] + b[2] * a[10] + b[3] * a[14],
    b[0] * a[3] + b[1] * a[7] + b[2] * a[11] + b[3] * a[15],
    b[4] * a[0] + b[5] * a[4] + b[6] * a[8] + b[7] * a[12],
    b[4] * a[1] + b[5] * a[5] + b[6] * a[9] + b[7] * a[13],
    b[4] * a[2] + b[5] * a[6] + b[6] * a[10] + b[7] * a[14],
    b[4] * a[3] + b[5] * a[7] + b[6] * a[11] + b[7] * a[15],
    b[8] * a[0] + b[9] * a[4] + b[10] * a[8] + b[11] * a[12],
    b[8] * a[1] + b[9] * a[5] + b[10] * a[9] + b[11] * a[13],
    b[8] * a[2] + b[9] * a[6] + b[10] * a[10] + b[11] * a[14],
    b[8] * a[3] + b[9] * a[7] + b[10] * a[11] + b[11] * a[15],
    b[12] * a[0] + b[13] * a[4] + b[14] * a[8] + b[15] * a[12],
    b[12] * a[1] + b[13] * a[5] + b[14] * a[9] + b[15] * a[13],
    b[12] * a[2] + b[13] * a[6] + b[14] * a[10] + b[15] * a[14],
    b[12] * a[3] + b[13] * a[7] + b[14] * a[11] + b[15] * a[15],
  ];
}

/**
 * 4x4 矩阵求逆
 */
export function invert4(a) {
  let b00 = a[0] * a[5] - a[1] * a[4];
  let b01 = a[0] * a[6] - a[2] * a[4];
  let b02 = a[0] * a[7] - a[3] * a[4];
  let b03 = a[1] * a[6] - a[2] * a[5];
  let b04 = a[1] * a[7] - a[3] * a[5];
  let b05 = a[2] * a[7] - a[3] * a[6];
  let b06 = a[8] * a[13] - a[9] * a[12];
  let b07 = a[8] * a[14] - a[10] * a[12];
  let b08 = a[8] * a[15] - a[11] * a[12];
  let b09 = a[9] * a[14] - a[10] * a[13];
  let b10 = a[9] * a[15] - a[11] * a[13];
  let b11 = a[10] * a[15] - a[11] * a[14];
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return null;
  return [
    (a[5] * b11 - a[6] * b10 + a[7] * b09) / det,
    (a[2] * b10 - a[1] * b11 - a[3] * b09) / det,
    (a[13] * b05 - a[14] * b04 + a[15] * b03) / det,
    (a[10] * b04 - a[9] * b05 - a[11] * b03) / det,
    (a[6] * b08 - a[4] * b11 - a[7] * b07) / det,
    (a[0] * b11 - a[2] * b08 + a[3] * b07) / det,
    (a[14] * b02 - a[12] * b05 - a[15] * b01) / det,
    (a[8] * b05 - a[10] * b02 + a[11] * b01) / det,
    (a[4] * b10 - a[5] * b08 + a[7] * b06) / det,
    (a[1] * b08 - a[0] * b10 - a[3] * b06) / det,
    (a[12] * b04 - a[13] * b02 + a[15] * b00) / det,
    (a[9] * b02 - a[8] * b04 - a[11] * b00) / det,
    (a[5] * b07 - a[4] * b09 - a[6] * b06) / det,
    (a[0] * b09 - a[1] * b07 + a[2] * b06) / det,
    (a[13] * b01 - a[12] * b03 - a[14] * b00) / det,
    (a[8] * b03 - a[9] * b01 + a[10] * b00) / det,
  ];
}

/**
 * 4x4 矩阵旋转
 */
export function rotate4(a, rad, x, y, z) {
  let len = Math.hypot(x, y, z);
  x /= len;
  y /= len;
  z /= len;
  let s = Math.sin(rad);
  let c = Math.cos(rad);
  let t = 1 - c;
  let b00 = x * x * t + c;
  let b01 = y * x * t + z * s;
  let b02 = z * x * t - y * s;
  let b10 = x * y * t - z * s;
  let b11 = y * y * t + c;
  let b12 = z * y * t + x * s;
  let b20 = x * z * t + y * s;
  let b21 = y * z * t - x * s;
  let b22 = z * z * t + c;
  return [
    a[0] * b00 + a[4] * b01 + a[8] * b02,
    a[1] * b00 + a[5] * b01 + a[9] * b02,
    a[2] * b00 + a[6] * b01 + a[10] * b02,
    a[3] * b00 + a[7] * b01 + a[11] * b02,
    a[0] * b10 + a[4] * b11 + a[8] * b12,
    a[1] * b10 + a[5] * b11 + a[9] * b12,
    a[2] * b10 + a[6] * b11 + a[10] * b12,
    a[3] * b10 + a[7] * b11 + a[11] * b12,
    a[0] * b20 + a[4] * b21 + a[8] * b22,
    a[1] * b20 + a[5] * b21 + a[9] * b22,
    a[2] * b20 + a[6] * b21 + a[10] * b22,
    a[3] * b20 + a[7] * b21 + a[11] * b22,
    a[12],
    a[13],
    a[14],
    a[15],
  ];
}

/**
 * 4x4 矩阵平移
 */
export function translate4(a, x, y, z) {
  return [
    ...a.slice(0, 12),
    a[0] * x + a[4] * y + a[8] * z + a[12],
    a[1] * x + a[5] * y + a[9] * z + a[13],
    a[2] * x + a[6] * y + a[10] * z + a[14],
    a[3] * x + a[7] * y + a[11] * z + a[15],
  ];
}

/**
 * 创建单位矩阵
 */
export function identity4() {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
}

/**
 * 从 eye、target、up 构建视图矩阵（列主序）
 * @param {[number,number,number]} eye - 相机位置
 * @param {[number,number,number]} target - 观察目标
 * @param {[number,number,number]} up - 世界空间上方向
 * @returns {number[]} 4x4 视图矩阵
 */
export function lookAtViewMatrix(eye, target, up) {
  const ex = eye[0], ey = eye[1], ez = eye[2];
  let fx = target[0] - ex, fy = target[1] - ey, fz = target[2] - ez;
  let len = Math.hypot(fx, fy, fz);
  if (len < 1e-8) return identity4();
  fx /= len; fy /= len; fz /= len;

  let ux = up[0], uy = up[1], uz = up[2];
  let rx = uy * fz - uz * fy, ry = uz * fx - ux * fz, rz = ux * fy - uy * fx;
  len = Math.hypot(rx, ry, rz);
  if (len < 1e-8) return identity4();
  rx /= len; ry /= len; rz /= len;

  ux = fy * rz - fz * ry; uy = fz * rx - fx * rz; uz = fx * ry - fy * rx;
  len = Math.hypot(ux, uy, uz);
  if (len >= 1e-8) { ux /= len; uy /= len; uz /= len; }

  return [
    rx, ux, -fx, 0,
    ry, uy, -fy, 0,
    rz, uz, -fz, 0,
    -(rx * ex + ry * ey + rz * ez),
    -(ux * ex + uy * ey + uz * ez),
    fx * ex + fy * ey + fz * ez,
    1,
  ];
}

/**
 * 创建平移矩阵
 */
export function createTranslationMatrix(x, y, z) {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    x, y, z, 1,
  ];
}

/**
 * 创建缩放矩阵
 */
export function createScaleMatrix(sx, sy, sz) {
  return [
    sx, 0, 0, 0,
    0, sy, 0, 0,
    0, 0, sz, 0,
    0, 0, 0, 1,
  ];
}

/**
 * 创建绕X轴旋转矩阵
 */
export function createRotationXMatrix(rad) {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [
    1, 0, 0, 0,
    0, c, s, 0,
    0, -s, c, 0,
    0, 0, 0, 1,
  ];
}

/**
 * 创建绕Y轴旋转矩阵
 */
export function createRotationYMatrix(rad) {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [
    c, 0, -s, 0,
    0, 1, 0, 0,
    s, 0, c, 0,
    0, 0, 0, 1,
  ];
}

/**
 * 创建绕Z轴旋转矩阵
 */
export function createRotationZMatrix(rad) {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [
    c, s, 0, 0,
    -s, c, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
}

/**
 * 获取WebGL错误代码名称
 * @param {WebGL2RenderingContext} gl - WebGL上下文
 * @param {number} error - 错误代码
 * @returns {string} 错误名称
 */
export function getGLErrorName(gl, error) {
  const errorNames = {
    [gl.NO_ERROR]: 'NO_ERROR',
    [gl.INVALID_ENUM]: 'INVALID_ENUM',
    [gl.INVALID_VALUE]: 'INVALID_VALUE',
    [gl.INVALID_OPERATION]: 'INVALID_OPERATION',
    [gl.INVALID_FRAMEBUFFER_OPERATION]: 'INVALID_FRAMEBUFFER_OPERATION',
    [gl.OUT_OF_MEMORY]: 'OUT_OF_MEMORY',
    [gl.CONTEXT_LOST_WEBGL]: 'CONTEXT_LOST_WEBGL',
  };
  return errorNames[error] || `UNKNOWN(${error})`;
}

/**
 * 四元数工具函数
 * 四元数格式：[w, x, y, z]
 */

/**
 * 从欧拉角（弧度）创建四元数
 * 旋转顺序：Z -> X -> Y (Unity风格，与createTransformMatrix一致)
 * @param {number} rx - X轴旋转（弧度）
 * @param {number} ry - Y轴旋转（弧度）
 * @param {number} rz - Z轴旋转（弧度）
 * @returns {number[]} 四元数 [w, x, y, z]
 */
export function eulerToQuaternion(rx, ry, rz) {
  // 计算每个轴的半角
  const cx = Math.cos(rx * 0.5);
  const sx = Math.sin(rx * 0.5);
  const cy = Math.cos(ry * 0.5);
  const sy = Math.sin(ry * 0.5);
  const cz = Math.cos(rz * 0.5);
  const sz = Math.sin(rz * 0.5);
  
  // 按 Z -> X -> Y 顺序组合旋转
  // q = qy * qx * qz
  const w = cy * cx * cz + sy * sx * sz;
  const x = cy * sx * cz + sy * cx * sz;
  const y = sy * cx * cz - cy * sx * sz;
  const z = cy * cx * sz - sy * sx * cz;
  
  return [w, x, y, z];
}

/**
 * 从四元数转换为欧拉角（弧度）
 * 旋转顺序：Z -> X -> Y (Unity风格)
 * @param {number[]} q - 四元数 [w, x, y, z]
 * @returns {number[]} 欧拉角 [rx, ry, rz]（弧度）
 */
export function quaternionToEuler(q) {
  const [w, x, y, z] = q;
  
  // 计算旋转矩阵的元素（列主序格式，但这里我们直接使用元素值）
  // 旋转矩阵从四元数的标准公式：
  // R = [
  //   [1-2(y²+z²),  2(xy+wz),     2(xz-wy)    ]
  //   [2(xy-wz),    1-2(x²+z²),   2(yz+wx)    ]
  //   [2(xz+wy),    2(yz-wx),     1-2(x²+y²)  ]
  // ]
  const m11 = 1 - 2 * (y * y + z * z);
  const m12 = 2 * (x * y + w * z);
  const m13 = 2 * (x * z - w * y);
  const m21 = 2 * (x * y - w * z);
  const m22 = 1 - 2 * (x * x + z * z);
  const m23 = 2 * (y * z + w * x);
  const m31 = 2 * (x * z + w * y);
  const m32 = 2 * (y * z - w * x);
  const m33 = 1 - 2 * (x * x + y * y);
  
  // 从旋转矩阵提取欧拉角（Z-X-Y顺序，Unity风格）
  // 对于 Z-X-Y 顺序，提取公式：
  // rx = asin(-m32)
  // ry = atan2(m31, m33)
  // rz = atan2(m12, m22)
  const rx = Math.asin(Math.max(-1, Math.min(1, -m32)));
  
  let ry, rz;
  const cosRx = Math.cos(rx);
  if (Math.abs(cosRx) > 1e-6) {
    ry = Math.atan2(m31, m33);
    rz = Math.atan2(m12, m22);
  } else {
    // 万向锁情况（rx ≈ ±90°）
    ry = 0;
    rz = Math.atan2(-m21, m11);
  }
  
  return [rx, ry, rz];
}

/**
 * 四元数乘法 q1 * q2
 * @param {number[]} q1 - 第一个四元数 [w, x, y, z]
 * @param {number[]} q2 - 第二个四元数 [w, x, y, z]
 * @returns {number[]} 结果四元数 [w, x, y, z]
 */
export function multiplyQuaternion(q1, q2) {
  const [w1, x1, y1, z1] = q1;
  const [w2, x2, y2, z2] = q2;
  
  return [
    w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2,
    w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2,
    w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2,
    w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2
  ];
}

/**
 * 创建绕轴旋转的四元数
 * @param {number} angle - 旋转角度（弧度）
 * @param {number[]} axis - 旋转轴 [x, y, z]（会被归一化）
 * @returns {number[]} 四元数 [w, x, y, z]
 */
export function axisAngleToQuaternion(angle, axis) {
  const len = Math.hypot(axis[0], axis[1], axis[2]);
  if (len < 1e-6) {
    return [1, 0, 0, 0]; // 单位四元数
  }
  
  const halfAngle = angle * 0.5;
  const s = Math.sin(halfAngle);
  const c = Math.cos(halfAngle);
  
  const normAxis = [axis[0] / len, axis[1] / len, axis[2] / len];
  
  return [
    c,
    normAxis[0] * s,
    normAxis[1] * s,
    normAxis[2] * s
  ];
}

/**
 * 从平移、旋转（欧拉角）、缩放创建变换矩阵
 * 旋转顺序：Z -> X -> Y (Unity风格)
 */
export function createTransformMatrix(translation, rotation, scale) {
  const [tx, ty, tz] = translation || [0, 0, 0];
  const [rx, ry, rz] = rotation || [0, 0, 0];
  const [sx, sy, sz] = scale || [1, 1, 1];
  
  // 创建缩放矩阵
  const scaleMat = createScaleMatrix(sx, sy, sz);
  
  // 创建旋转矩阵（Z -> X -> Y顺序）
  const rotZ = createRotationZMatrix(rz);
  const rotX = createRotationXMatrix(rx);
  const rotY = createRotationYMatrix(ry);
  const rotMat = multiply4(multiply4(rotY, rotX), rotZ);
  
  // 组合：先缩放，再旋转，最后平移
  const scaled = multiply4(rotMat, scaleMat);
  const translated = createTranslationMatrix(tx, ty, tz);
  return multiply4(translated, scaled);
}


