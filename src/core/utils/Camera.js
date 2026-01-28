/**
 * 完整的相机类
 * 参数化记录所有相关属性，通过 getter 自动计算各种矩阵
 * 
 * 设计原则：
 * - 以 position + yaw/pitch 为核心数据源（避免歧义）
 * - 所有矩阵通过 getter 自动计算，确保一致性
 * - 支持 FOV 动态计算焦距
 */

import { multiply4, invert4 } from './webgl';

export class Camera {
  /**
   * 创建相机实例
   * @param {Object} options - 初始化选项
   * @param {Array<number>} options.position - 相机位置 [x, y, z]
   * @param {number} options.yawRad - 水平旋转角度（弧度）
   * @param {number} options.pitchRad - 垂直旋转角度（弧度）
   * @param {Array<number>} options.forwardHorizontalRef - 水平参考方向（用于避免 yaw 歧义）
   * @param {Array<number>} options.worldUp - 世界"上"方向，默认 [0, 1, 0]
   * @param {number} options.fx - 焦距 x，默认 1000
   * @param {number} options.fy - 焦距 y，默认 1000
   * @param {number} options.width - 图像宽度，默认 1920
   * @param {number} options.height - 图像高度，默认 1080
   * @param {number|null} options.targetVerticalFOV - 目标垂直 FOV（角度），如果提供则覆盖 fy
   * @param {number} options.znear - 近裁剪平面，默认 0.2
   * @param {number} options.zfar - 远裁剪平面，默认 200
   * @param {number|string} options.id - 相机 ID，默认 0
   */
  constructor(options = {}) {
    // ========== 核心属性（数据源）==========
    this._position = options.position || [0, 0, 0];
    this._yawRad = options.yawRad ?? 0;
    this._pitchRad = options.pitchRad ?? 0;
    this._forwardHorizontalRef = options.forwardHorizontalRef || [0, 0, 1];
    this._worldUp = options.worldUp || [0, 1, 0];

    // ========== 投影相关属性 ==========
    this._fx = options.fx ?? 1000;
    this._fy = options.fy ?? 1000;
    this._width = options.width ?? 1920;
    this._height = options.height ?? 1080;
    this._targetVerticalFOV = options.targetVerticalFOV ?? null;
    this._znear = options.znear ?? 0.2;
    this._zfar = options.zfar ?? 200;

    // ========== 其他属性 ==========
    this._id = options.id ?? 0;

    // ========== 缓存（用于性能优化）==========
    this._rotationCache = null;
    this._viewMatrixCache = null;
    this._projectionMatrixCache = null;
    this._viewProjMatrixCache = null;
    this._cacheInvalid = true;
  }

  // ========== 核心属性的 Getter/Setter ==========

  get position() {
    return [...this._position]; // 返回副本，避免外部修改
  }

  set position(value) {
    if (!Array.isArray(value) || value.length !== 3) {
      throw new Error('Position must be an array of 3 numbers');
    }
    this._position = [...value];
    this._invalidateCache();
  }

  get yawRad() {
    return this._yawRad;
  }

  set yawRad(value) {
    this._yawRad = value;
    this._invalidateCache();
  }

  get pitchRad() {
    return this._pitchRad;
  }

  set pitchRad(value) {
    // 限制 pitch 范围，避免万向锁
    this._pitchRad = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, value));
    this._invalidateCache();
  }

  get forwardHorizontalRef() {
    return [...this._forwardHorizontalRef];
  }

  set forwardHorizontalRef(value) {
    if (!Array.isArray(value) || value.length !== 3) {
      throw new Error('forwardHorizontalRef must be an array of 3 numbers');
    }
    this._forwardHorizontalRef = this._normalize([...value]);
    this._invalidateCache();
  }

  get worldUp() {
    return [...this._worldUp];
  }

  set worldUp(value) {
    if (!Array.isArray(value) || value.length !== 3) {
      throw new Error('worldUp must be an array of 3 numbers');
    }
    this._worldUp = this._normalize([...value]);
    this._invalidateCache();
  }

  // ========== 投影属性的 Getter/Setter ==========

  get fx() {
    // 如果设置了 targetVerticalFOV，动态计算 fx
    if (this._targetVerticalFOV !== null && this._height > 0) {
      const aspectRatio = this._width / this._height;
      const verticalFOVRad = (this._targetVerticalFOV * Math.PI) / 180;
      const horizontalFOVRad = 2 * Math.atan(Math.tan(verticalFOVRad / 2) * aspectRatio);
      return this._width / (2 * Math.tan(horizontalFOVRad / 2));
    }
    return this._fx;
  }

  set fx(value) {
    this._fx = value;
    this._targetVerticalFOV = null; // 清除 FOV 设置
    this._invalidateCache();
  }

  get fy() {
    // 如果设置了 targetVerticalFOV，动态计算 fy
    if (this._targetVerticalFOV !== null && this._height > 0) {
      const verticalFOVRad = (this._targetVerticalFOV * Math.PI) / 180;
      return this._height / (2 * Math.tan(verticalFOVRad / 2));
    }
    return this._fy;
  }

  set fy(value) {
    this._fy = value;
    this._targetVerticalFOV = null; // 清除 FOV 设置
    this._invalidateCache();
  }

  get width() {
    return this._width;
  }

  set width(value) {
    this._width = value;
    this._invalidateCache();
  }

  get height() {
    return this._height;
  }

  set height(value) {
    this._height = value;
    this._invalidateCache();
  }

  get targetVerticalFOV() {
    return this._targetVerticalFOV;
  }

  set targetVerticalFOV(value) {
    this._targetVerticalFOV = value;
    this._invalidateCache();
  }

  get znear() {
    return this._znear;
  }

  set znear(value) {
    this._znear = value;
    this._invalidateCache();
  }

  get zfar() {
    return this._zfar;
  }

  set zfar(value) {
    this._zfar = value;
    this._invalidateCache();
  }

  get id() {
    return this._id;
  }

  set id(value) {
    this._id = value;
  }

  // ========== 矩阵计算（Getter）==========

  /**
   * 获取旋转矩阵（从 yaw/pitch 计算）
   * @returns {Array<Array<number>>} 3x3 旋转矩阵 [[right], [up], [forward]]
   */
  get rotation() {
    if (this._rotationCache && !this._cacheInvalid) {
      return this._rotationCache.map(row => [...row]); // 返回副本
    }

    const rotation = this._buildRotationFromYawPitch(
      this._yawRad,
      this._pitchRad,
      this._worldUp,
      this._forwardHorizontalRef
    );

    this._rotationCache = rotation.map(row => [...row]); // 缓存副本
    return rotation.map(row => [...row]); // 返回副本
  }

  /**
   * 获取视图矩阵（camera-to-world）
   * @returns {Array<number>} 4x4 视图矩阵（列主序，16 元素数组）
   */
  get viewMatrix() {
    if (this._viewMatrixCache && !this._cacheInvalid) {
      return [...this._viewMatrixCache]; // 返回副本
    }

    const R = this.rotation.flat();
    const t = this._position;

    const camToWorld = [
      R[0], R[1], R[2], 0,
      R[3], R[4], R[5], 0,
      R[6], R[7], R[8], 0,
      -t[0] * R[0] - t[1] * R[3] - t[2] * R[6],
      -t[0] * R[1] - t[1] * R[4] - t[2] * R[7],
      -t[0] * R[2] - t[1] * R[5] - t[2] * R[8],
      1
    ];

    this._viewMatrixCache = [...camToWorld];
    return [...camToWorld]; // 返回副本
  }

  /**
   * 获取投影矩阵
   * @returns {Array<number>} 4x4 投影矩阵（列主序，16 元素数组）
   */
  get projectionMatrix() {
    if (this._projectionMatrixCache && !this._cacheInvalid) {
      return [...this._projectionMatrixCache]; // 返回副本
    }

    const fx = this.fx;
    const fy = this.fy;
    const width = this._width;
    const height = this._height;
    const znear = this._znear;
    const zfar = this._zfar;

    const proj = [
      (2 * fx) / width, 0, 0, 0,
      0, -(2 * fy) / height, 0, 0,
      0, 0, zfar / (zfar - znear), 1,
      0, 0, -(zfar * znear) / (zfar - znear), 0,
    ];

    this._projectionMatrixCache = [...proj];
    return [...proj]; // 返回副本
  }

  /**
   * 获取视图投影矩阵（projectionMatrix * viewMatrix）
   * @returns {Array<number>} 4x4 视图投影矩阵（列主序，16 元素数组）
   */
  get viewProjMatrix() {
    if (this._viewProjMatrixCache && !this._cacheInvalid) {
      return [...this._viewProjMatrixCache]; // 返回副本
    }

    const viewProj = multiply4(this.projectionMatrix, this.viewMatrix);
    this._viewProjMatrixCache = [...viewProj];
    return [...viewProj]; // 返回副本
  }

  /**
   * 获取视图模型矩阵（viewMatrix * modelMatrix）
   * @param {Array<number>} modelMatrix - 4x4 模型矩阵
   * @returns {Array<number>} 4x4 视图模型矩阵
   */
  getViewModelMatrix(modelMatrix) {
    return multiply4(this.viewMatrix, modelMatrix);
  }

  /**
   * 获取视图投影模型矩阵（projectionMatrix * viewMatrix * modelMatrix）
   * @param {Array<number>} modelMatrix - 4x4 模型矩阵
   * @returns {Array<number>} 4x4 视图投影模型矩阵
   */
  getViewProjModelMatrix(modelMatrix) {
    return multiply4(this.viewProjMatrix, modelMatrix);
  }

  /**
   * 获取世界到相机矩阵（viewMatrix 的逆矩阵）
   * @returns {Array<number>} 4x4 世界到相机矩阵
   */
  get worldToCameraMatrix() {
    const inv = invert4(this.viewMatrix);
    if (!inv) {
      console.warn('[Camera] Failed to invert viewMatrix');
      return null;
    }
    return inv;
  }

  // ========== 辅助方法 ==========

  /**
   * 从 yaw 和 pitch 构建旋转矩阵（确保 roll=0）
   * @private
   */
  _buildRotationFromYawPitch(yawRad, pitchRad, worldUp, forwardHorizontalRef) {
    const normalize = (v) => {
      const len = Math.hypot(v[0], v[1], v[2]);
      return len > 1e-6 ? [v[0] / len, v[1] / len, v[2] / len] : [0, 1, 0];
    };

    const cross = (a, b) => [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];

    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

    const rotateAroundAxis = (v, axis, rad) => {
      const u = normalize(axis);
      const [x, y, z] = u;
      const c = Math.cos(rad);
      const s = Math.sin(rad);
      const dotVal = dot(v, u);
      return [
        v[0] * c + (y * v[2] - z * v[1]) * s + x * dotVal * (1 - c),
        v[1] * c + (z * v[0] - x * v[2]) * s + y * dotVal * (1 - c),
        v[2] * c + (x * v[1] - y * v[0]) * s + z * dotVal * (1 - c),
      ];
    };

    const forwardHorizontalNorm = normalize(forwardHorizontalRef);

    // 应用 yaw 旋转（绕 worldUp）
    let rotatedHorizontalNorm = forwardHorizontalNorm;
    if (Math.abs(yawRad) > 1e-6) {
      rotatedHorizontalNorm = normalize(rotateAroundAxis(forwardHorizontalNorm, worldUp, yawRad));
    }

    // 应用 pitch 旋转
    const cosPitch = Math.cos(pitchRad);
    const sinPitch = Math.sin(pitchRad);
    const forward = normalize([
      rotatedHorizontalNorm[0] * cosPitch + worldUp[0] * sinPitch,
      rotatedHorizontalNorm[1] * cosPitch + worldUp[1] * sinPitch,
      rotatedHorizontalNorm[2] * cosPitch + worldUp[2] * sinPitch,
    ]);

    // 计算 right 和 up（确保正交，roll=0）
    let right = cross(worldUp, forward);
    const rightLen = Math.hypot(right[0], right[1], right[2]);
    if (rightLen < 1e-6) {
      // forward 与 worldUp 平行，使用默认参考方向
      const defaultRight = Math.abs(dot(forward, [1, 0, 0])) < 0.9
        ? normalize(cross(worldUp, [1, 0, 0]))
        : normalize(cross(worldUp, [0, 1, 0]));
      right = defaultRight;
    } else {
      right = normalize(right);
    }
    const up = normalize(cross(forward, right));

    return [
      [right[0], up[0], forward[0]],
      [right[1], up[1], forward[1]],
      [right[2], up[2], forward[2]],
    ];
  }

  /**
   * 归一化向量
   * @private
   */
  _normalize(v) {
    const len = Math.hypot(v[0], v[1], v[2]);
    return len > 1e-6 ? [v[0] / len, v[1] / len, v[2] / len] : [0, 1, 0];
  }

  /**
   * 使缓存失效
   * @private
   */
  _invalidateCache() {
    this._cacheInvalid = true;
    this._rotationCache = null;
    this._viewMatrixCache = null;
    this._projectionMatrixCache = null;
    this._viewProjMatrixCache = null;
  }

  /**
   * 更新 yaw 和 pitch（用于旋转操作）
   * @param {number} dYaw - yaw 增量（弧度）
   * @param {number} dPitch - pitch 增量（弧度）
   */
  rotate(dYaw, dPitch) {
    this._yawRad += dYaw;
    this._pitchRad = Math.max(
      -Math.PI / 2 + 0.01,
      Math.min(Math.PI / 2 - 0.01, this._pitchRad + dPitch)
    );
    this._invalidateCache();
  }

  /**
   * 移动相机位置（在相机本地坐标系中）
   * @param {number} dx - 右移距离
   * @param {number} dy - 上移距离
   * @param {number} dz - 前移距离
   */
  moveLocal(dx, dy, dz) {
    const rotation = this.rotation;
    const right = [rotation[0][0], rotation[1][0], rotation[2][0]];
    const up = [rotation[0][1], rotation[1][1], rotation[2][1]];
    const forward = [rotation[0][2], rotation[1][2], rotation[2][2]];

    this._position[0] += right[0] * dx + up[0] * dy + forward[0] * dz;
    this._position[1] += right[1] * dx + up[1] * dy + forward[1] * dz;
    this._position[2] += right[2] * dx + up[2] * dy + forward[2] * dz;

    this._invalidateCache();
  }

  /**
   * 移动相机位置（在世界坐标系中）
   * @param {number} dx - X 轴移动距离
   * @param {number} dy - Y 轴移动距离
   * @param {number} dz - Z 轴移动距离
   */
  moveWorld(dx, dy, dz) {
    this._position[0] += dx;
    this._position[1] += dy;
    this._position[2] += dz;
    this._invalidateCache();
  }

  /**
   * 转换为普通对象（用于向后兼容）
   * @returns {Object} 普通相机对象
   */
  toPlainObject() {
    // 如果设置了 targetVerticalFOV，返回原始的 fx/fy（而不是根据 FOV 计算的值）
    // 这样 HoloRP 可以根据 targetVerticalFOV 重新计算
    // 如果没有设置 targetVerticalFOV，返回当前计算的 fx/fy
    return {
      id: this._id,
      width: this._width,
      height: this._height,
      position: [...this._position],
      rotation: this.rotation.map(row => [...row]),
      fx: this._targetVerticalFOV !== null ? this._fx : this.fx,  // 如果有 FOV，返回原始 fx
      fy: this._targetVerticalFOV !== null ? this._fy : this.fy,  // 如果有 FOV，返回原始 fy
      yawRad: this._yawRad,
      pitchRad: this._pitchRad,
      forwardHorizontalRef: [...this._forwardHorizontalRef],
      worldUp: [...this._worldUp],
      targetVerticalFOV: this._targetVerticalFOV, // 包含 FOV 信息，供 HoloRP 使用
    };
  }

  /**
   * 从普通对象创建 Camera 实例
   * @param {Object} plainObject - 普通相机对象
   * @returns {Camera} Camera 实例
   */
  static fromPlainObject(plainObject) {
    // 如果已经有 yawRad 和 pitchRad，直接使用
    if (plainObject.yawRad !== undefined && plainObject.pitchRad !== undefined) {
      return new Camera({
        id: plainObject.id,
        width: plainObject.width,
        height: plainObject.height,
        position: plainObject.position,
        yawRad: plainObject.yawRad,
        pitchRad: plainObject.pitchRad,
        forwardHorizontalRef: plainObject.forwardHorizontalRef || [0, 0, 1],
        worldUp: plainObject.worldUp || [0, 1, 0],
        fx: plainObject.fx,
        fy: plainObject.fy,
        targetVerticalFOV: plainObject.targetVerticalFOV,
        znear: plainObject.znear,
        zfar: plainObject.zfar,
      });
    }

    // 如果没有 yawRad/pitchRad，从 rotation 矩阵提取
    if (plainObject.rotation && Array.isArray(plainObject.rotation)) {
      const R = plainObject.rotation.flat();
      const forward = [R[6], R[7], R[8]]; // 第三列是 forward
      const worldUp = plainObject.worldUp || [0, 1, 0];
      
      const normalize = (v) => {
        const len = Math.hypot(v[0], v[1], v[2]);
        return len > 1e-6 ? [v[0] / len, v[1] / len, v[2] / len] : [0, 0, 1];
      };
      const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      
      const forwardNorm = normalize(forward);
      const forwardUpComponent = dot(forwardNorm, worldUp);
      const pitchRad = Math.asin(Math.max(-1, Math.min(1, forwardUpComponent)));
      
      // 计算水平方向
      let forwardHorizontal = [
        forwardNorm[0] - forwardUpComponent * worldUp[0],
        forwardNorm[1] - forwardUpComponent * worldUp[1],
        forwardNorm[2] - forwardUpComponent * worldUp[2],
      ];
      const forwardHorizontalLen = Math.hypot(forwardHorizontal[0], forwardHorizontal[1], forwardHorizontal[2]);
      if (forwardHorizontalLen < 1e-6) {
        forwardHorizontal = [1, 0, 0];
      } else {
        forwardHorizontal = normalize(forwardHorizontal);
      }
      
      // yaw 设为 0（相对于参考方向）
      const yawRad = 0;
      
      return new Camera({
        id: plainObject.id,
        width: plainObject.width,
        height: plainObject.height,
        position: plainObject.position,
        yawRad: yawRad,
        pitchRad: pitchRad,
        forwardHorizontalRef: forwardHorizontal,
        worldUp: worldUp,
        fx: plainObject.fx,
        fy: plainObject.fy,
        targetVerticalFOV: plainObject.targetVerticalFOV,
        znear: plainObject.znear,
        zfar: plainObject.zfar,
      });
    }

    // 完全回退：使用默认值
    return new Camera({
      id: plainObject.id,
      width: plainObject.width || 1920,
      height: plainObject.height || 1080,
      position: plainObject.position || [0, 0, 0],
      yawRad: 0,
      pitchRad: 0,
      forwardHorizontalRef: [0, 0, 1],
      worldUp: [0, 1, 0],
      fx: plainObject.fx || 1000,
      fy: plainObject.fy || 1000,
      targetVerticalFOV: plainObject.targetVerticalFOV,
      znear: plainObject.znear,
      zfar: plainObject.zfar,
    });
  }

  /**
   * 克隆相机
   * @returns {Camera} 新的 Camera 实例
   */
  clone() {
    return new Camera({
      id: this._id,
      width: this._width,
      height: this._height,
      position: [...this._position],
      yawRad: this._yawRad,
      pitchRad: this._pitchRad,
      forwardHorizontalRef: [...this._forwardHorizontalRef],
      worldUp: [...this._worldUp],
      fx: this._fx,
      fy: this._fy,
      targetVerticalFOV: this._targetVerticalFOV,
      znear: this._znear,
      zfar: this._zfar,
    });
  }
}
