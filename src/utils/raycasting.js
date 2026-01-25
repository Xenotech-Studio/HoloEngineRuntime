/**
 * Raycasting 工具函数
 * 从 useGizmo 中提取的 raycasting 相关功能，供 ColmapUtil 等复用
 */

import { invert4 } from '../core/utils/webgl';

/**
 * 将屏幕坐标转换为世界坐标中的射线
 * @param {number} screenX - 屏幕 X 坐标
 * @param {number} screenY - 屏幕 Y 坐标
 * @param {number[]} viewMatrix - 4x4 视图矩阵（camera-to-world）
 * @param {number[]} projectionMatrix - 4x4 投影矩阵
 * @param {number} canvasWidth - Canvas 宽度
 * @param {number} canvasHeight - Canvas 高度
 * @returns {{origin: number[], direction: number[]}|null} 射线对象，包含起点和方向（归一化）
 */
export function screenToRay(screenX, screenY, viewMatrix, projectionMatrix, canvasWidth, canvasHeight) {
  // 标准化设备坐标 (NDC)
  // 注意：在OpenGL/WebGL中，NDC的X范围是[-1, 1]，其中-1是左，1是右
  // 屏幕坐标(0, 0)在左上角，NDC坐标(-1, 1)也在左上角
  const x = (2.0 * screenX) / canvasWidth - 1.0;
  const y = 1.0 - (2.0 * screenY) / canvasHeight;

  // 计算射线方向（在相机空间中）
  const invView = invert4(viewMatrix);
  if (!invView) return null;

  // 从viewMatrix提取相机位置
  const camPos = [invView[12], invView[13], invView[14]];

  // 计算射线方向（在相机空间中）
  // 投影矩阵格式：
  // [2*fx/width,  0,           0,  0]
  // [0,          -2*fy/height, 0,  0]
  // [0,           0,           a,  b]
  // [0,           0,           1,  0]
  // 其中 projectionMatrix[0] = 2*fx/width, projectionMatrix[5] = -2*fy/height
  
  const znear = 0.2;
  
  // 计算近平面上的点（在相机空间中）
  // 使用投影矩阵的焦距参数来正确计算
  // projectionMatrix[0] = 2*fx/width (正数)
  // projectionMatrix[5] = -2*fy/height (负数)
  // 在相机空间中，X向右为正，Y向上为正，Z向前为正（但OpenGL中相机看向-Z）
  // NDC坐标：x范围[-1, 1]（-1左，1右），y范围[-1, 1]（-1下，1上）
  const nearPoint = [
    (x * znear) / projectionMatrix[0],  // x方向：使用projectionMatrix[0]，x已经是正确的NDC坐标
    (y * znear) / projectionMatrix[5],  // y方向：注意projectionMatrix[5]是负数，y也是正确的NDC坐标（上正下负），所以直接除即可
    -znear  // z方向：负Z（相机看向-Z方向）
  ];

  // 计算从相机位置到近平面点的方向向量（在相机空间中）
  // 相机在相机空间的原点(0,0,0)，近平面在z=-znear
  // 从相机到近平面点的方向是nearPoint本身
  // 但我们需要的是从相机指向场景的方向（正Z方向），所以Z需要取反
  // 对于X和Y，由于nearPoint已经正确计算了，我们只需要取反Z
  const rayDir = [
    nearPoint[0],   // X方向：保持原样
    nearPoint[1],   // Y方向：保持原样
    -nearPoint[2]  // Z方向：取反，从-Z变为+Z（从相机指向场景）
  ];

  // 转换到世界空间
  // 使用viewMatrix的逆矩阵的旋转部分（前3x3）来转换方向向量
  // 注意：方向向量只需要旋转，不需要平移
  const worldRayDir = [
    rayDir[0] * invView[0] + rayDir[1] * invView[4] + rayDir[2] * invView[8],
    rayDir[0] * invView[1] + rayDir[1] * invView[5] + rayDir[2] * invView[9],
    rayDir[0] * invView[2] + rayDir[1] * invView[6] + rayDir[2] * invView[10]
  ];

  const len = Math.hypot(worldRayDir[0], worldRayDir[1], worldRayDir[2]);
  if (len < 1e-6) return null;

  return {
    origin: camPos,
    direction: [worldRayDir[0] / len, worldRayDir[1] / len, worldRayDir[2] / len]
  };
}

/**
 * 射线与矩形相交检测（使用薄长方体检测）
 * @param {{origin: number[], direction: number[]}} ray - 射线对象
 * @param {{center: number[], u: number[], v: number[], width: number, height: number, thickness: number}} rectangle - 矩形对象
 * @returns {number|null} 交点距离（t值），如果无交点返回 null
 */
export function rayRectangleIntersection(ray, rectangle) {
  const { origin: rayOrig, direction: rayDir } = ray;
  const { center, u, v, width, height, thickness } = rectangle;
  
  // 计算平面的法向量（u × v）
  const normal = [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0]
  ];
  const normalLen = Math.hypot(normal[0], normal[1], normal[2]);
  if (normalLen < 1e-6) {
    return null; // u和v平行，无效矩形
  }
  const normalNorm = [normal[0] / normalLen, normal[1] / normalLen, normal[2] / normalLen];
  
  // 计算射线与平面的交点
  const toCenter = [
    center[0] - rayOrig[0],
    center[1] - rayOrig[1],
    center[2] - rayOrig[2]
  ];
  const denom = rayDir[0] * normalNorm[0] + rayDir[1] * normalNorm[1] + rayDir[2] * normalNorm[2];
  
  if (Math.abs(denom) < 1e-6) {
    return null; // 射线与平面平行
  }
  
  const t = (toCenter[0] * normalNorm[0] + toCenter[1] * normalNorm[1] + toCenter[2] * normalNorm[2]) / denom;
  
  if (t < 0) {
    return null; // 交点在射线后方
  }
  
  // 计算交点
  const intersection = [
    rayOrig[0] + t * rayDir[0],
    rayOrig[1] + t * rayDir[1],
    rayOrig[2] + t * rayDir[2]
  ];
  
  // 计算交点在矩形局部坐标系中的坐标
  const toIntersection = [
    intersection[0] - center[0],
    intersection[1] - center[1],
    intersection[2] - center[2]
  ];
  
  // 投影到u和v方向
  const localU = toIntersection[0] * u[0] + toIntersection[1] * u[1] + toIntersection[2] * u[2];
  const localV = toIntersection[0] * v[0] + toIntersection[1] * v[1] + toIntersection[2] * v[2];
  const localN = toIntersection[0] * normalNorm[0] + toIntersection[1] * normalNorm[1] + toIntersection[2] * normalNorm[2];
  
  // 检查是否在矩形范围内（考虑厚度）
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const halfThickness = thickness / 2;
  
  if (Math.abs(localU) <= halfWidth && 
      Math.abs(localV) <= halfHeight && 
      Math.abs(localN) <= halfThickness) {
    return t;
  }
  
  return null;
}

/**
 * 射线与平面相交检测
 * @param {{origin: number[], direction: number[]}} ray - 射线对象
 * @param {{point: number[], normal: number[], size: number[]}} plane - 平面对象
 * @returns {number|null} 交点距离（t值），如果无交点返回 null
 */
export function rayPlaneIntersection(ray, plane) {
  const { origin: rayOrig, direction: rayDir } = ray;
  const { point: planePoint, normal: planeNormal, size } = plane;

  // 计算射线与平面的交点
  const toPlane = [
    planePoint[0] - rayOrig[0],
    planePoint[1] - rayOrig[1],
    planePoint[2] - rayOrig[2]
  ];
  const denom = rayDir[0] * planeNormal[0] + rayDir[1] * planeNormal[1] + rayDir[2] * planeNormal[2];
  
  if (Math.abs(denom) < 1e-6) {
    // 射线与平面平行
    return null;
  }

  const t = (toPlane[0] * planeNormal[0] + toPlane[1] * planeNormal[1] + toPlane[2] * planeNormal[2]) / denom;
  
  if (t < 0) {
    // 交点在射线后方
    return null;
  }

  // 计算交点
  const intersection = [
    rayOrig[0] + t * rayDir[0],
    rayOrig[1] + t * rayDir[1],
    rayOrig[2] + t * rayDir[2]
  ];

  // 计算交点在平面上的局部坐标（相对于平面中心）
  const toIntersection = [
    intersection[0] - planePoint[0],
    intersection[1] - planePoint[1],
    intersection[2] - planePoint[2]
  ];

  // 构建平面的局部坐标系（需要两个切向量）
  // 选择一个与法向量不平行的参考向量
  let ref = [1, 0, 0];
  if (Math.abs(planeNormal[0]) > 0.9) {
    ref = [0, 1, 0];
  }
  
  // 计算第一个切向量（u方向）
  const u = [
    ref[1] * planeNormal[2] - ref[2] * planeNormal[1],
    ref[2] * planeNormal[0] - ref[0] * planeNormal[2],
    ref[0] * planeNormal[1] - ref[1] * planeNormal[0]
  ];
  const uLen = Math.hypot(u[0], u[1], u[2]);
  if (uLen < 1e-6) {
    // 如果ref与法向量平行，使用另一个参考
    ref = [0, 0, 1];
    const u2 = [
      ref[1] * planeNormal[2] - ref[2] * planeNormal[1],
      ref[2] * planeNormal[0] - ref[0] * planeNormal[2],
      ref[0] * planeNormal[1] - ref[1] * planeNormal[0]
    ];
    const u2Len = Math.hypot(u2[0], u2[1], u2[2]);
    if (u2Len < 1e-6) {
      return null;
    }
    const uNorm = [u2[0] / u2Len, u2[1] / u2Len, u2[2] / u2Len];
    
    // 计算第二个切向量（v方向）
    const v = [
      planeNormal[1] * uNorm[2] - planeNormal[2] * uNorm[1],
      planeNormal[2] * uNorm[0] - planeNormal[0] * uNorm[2],
      planeNormal[0] * uNorm[1] - planeNormal[1] * uNorm[0]
    ];
    
    // 计算局部坐标
    const localU = toIntersection[0] * uNorm[0] + toIntersection[1] * uNorm[1] + toIntersection[2] * uNorm[2];
    const localV = toIntersection[0] * v[0] + toIntersection[1] * v[1] + toIntersection[2] * v[2];
    
    // 检查是否在平面范围内
    const halfWidth = size[0] / 2;
    const halfHeight = size[1] / 2;
    if (Math.abs(localU) <= halfWidth && Math.abs(localV) <= halfHeight) {
      return t;
    }
    return null;
  }
  
  const uNorm = [u[0] / uLen, u[1] / uLen, u[2] / uLen];
  
  // 计算第二个切向量（v方向）
  const v = [
    planeNormal[1] * uNorm[2] - planeNormal[2] * uNorm[1],
    planeNormal[2] * uNorm[0] - planeNormal[0] * uNorm[2],
    planeNormal[0] * uNorm[1] - planeNormal[1] * uNorm[0]
  ];
  
  // 计算局部坐标
  const localU = toIntersection[0] * uNorm[0] + toIntersection[1] * uNorm[1] + toIntersection[2] * uNorm[2];
  const localV = toIntersection[0] * v[0] + toIntersection[1] * v[1] + toIntersection[2] * v[2];
  
  // 检查是否在平面范围内
  const halfWidth = size[0] / 2;
  const halfHeight = size[1] / 2;
  if (Math.abs(localU) <= halfWidth && Math.abs(localV) <= halfHeight) {
    return t;
  }
  return null;
}

/**
 * 计算点到射线的距离
 * @param {number[]} point - 点坐标 [x, y, z]
 * @param {{origin: number[], direction: number[]}} ray - 射线对象
 * @returns {number} 点到射线的距离
 */
export function pointToRayDistance(point, ray) {
  const { origin, direction } = ray;
  
  // 从射线起点到点的向量
  const toPoint = [
    point[0] - origin[0],
    point[1] - origin[1],
    point[2] - origin[2]
  ];
  
  // 计算点在射线方向上的投影长度
  const projection = toPoint[0] * direction[0] + toPoint[1] * direction[1] + toPoint[2] * direction[2];
  
  // 计算投影点
  const projectionPoint = [
    origin[0] + projection * direction[0],
    origin[1] + projection * direction[1],
    origin[2] + projection * direction[2]
  ];
  
  // 计算点到投影点的距离
  const dx = point[0] - projectionPoint[0];
  const dy = point[1] - projectionPoint[1];
  const dz = point[2] - projectionPoint[2];
  
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
