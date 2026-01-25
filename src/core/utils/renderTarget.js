/**
 * 渲染目标接口
 * 封装不同的渲染输出路径（Canvas、WebXR等）
 */

import { multiply4, identity4 } from './webgl';

/**
 * 视图信息
 */
export class ViewInfo {
  constructor() {
    this.projectionMatrix = null;  // 4x4 投影矩阵
    this.viewMatrix = null;        // 4x4 视图矩阵（已转换）
    this.viewport = { x: 0, y: 0, width: 0, height: 0 };  // 视口信息
    this.fx = 0;                    // 焦距 x
    this.fy = 0;                    // 焦距 y
  }
}

/**
 * 渲染目标基类
 */
export class RenderTarget {
  /**
   * 开始一帧渲染
   * @param {XRFrame} frame - XR 帧（仅 XR 模式需要）
   * @returns {boolean} 是否成功开始
   */
  beginFrame(frame = null) {
    throw new Error('beginFrame() must be implemented');
  }

  /**
   * 获取视图列表
   * @returns {ViewInfo[]} 视图信息数组（普通模式返回1个，XR返回2个）
   */
  getViews() {
    throw new Error('getViews() must be implemented');
  }

  /**
   * 结束一帧渲染
   */
  endFrame() {
    throw new Error('endFrame() must be implemented');
  }

  /**
   * 绑定帧缓冲区
   */
  bindFramebuffer() {
    throw new Error('bindFramebuffer() must be implemented');
  }

  /**
   * 获取 WebGL 上下文
   * @returns {WebGL2RenderingContext}
   */
  getGL() {
    throw new Error('getGL() must be implemented');
  }

  /**
   * 清理资源
   */
  dispose() {
    // 默认实现为空，子类可以覆盖
  }
}

/**
 * Canvas 渲染目标（普通模式）
 */
export class CanvasRenderTarget extends RenderTarget {
  constructor(canvas, gl) {
    super();
    this.canvas = canvas;
    this.gl = gl;
    this.currentView = new ViewInfo();
    // 这些值会在 render 过程中由 HoloRP 设置
    this._projectionMatrix = null;
    this._viewMatrix = null;
    this._fx = 0;
    this._fy = 0;
  }

  beginFrame() {
    if (!this.canvas || !this.gl) {
      return false;
    }

    // 获取 canvas 的实际尺寸
    const canvasWidth = this.canvas.clientWidth || this.canvas.width || window.innerWidth;
    const canvasHeight = this.canvas.clientHeight || this.canvas.height || window.innerHeight;

    // 更新 canvas 尺寸
    if (this.canvas.width !== canvasWidth || this.canvas.height !== canvasHeight) {
      this.canvas.width = canvasWidth;
      this.canvas.height = canvasHeight;
    }

    // 检查 canvas 尺寸
    if (canvasWidth === 0 || canvasHeight === 0) {
      return false;
    }

    // 绑定默认帧缓冲区
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);

    // 清除画布
    this.gl.viewport(0, 0, canvasWidth, canvasHeight);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);

    // 更新视图信息的视口（投影矩阵和视图矩阵会在 render 过程中设置）
    this.currentView.viewport = { x: 0, y: 0, width: canvasWidth, height: canvasHeight };

    return true;
  }

  getViews() {
    // 更新视图信息（这些值在 render 过程中由 HoloRP 设置）
    this.currentView.projectionMatrix = this._projectionMatrix;
    this.currentView.viewMatrix = this._viewMatrix;
    this.currentView.fx = this._fx;
    this.currentView.fy = this._fy;
    return [this.currentView];
  }

  endFrame() {
    // Canvas 模式不需要特殊处理
  }

  bindFramebuffer() {
    // Canvas 模式使用默认帧缓冲区
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
  }

  getGL() {
    return this.gl;
  }

  /**
   * 设置投影矩阵（由 HoloRP 调用）
   * @param {number[]} projectionMatrix - 4x4 投影矩阵
   */
  setProjectionMatrix(projectionMatrix) {
    this._projectionMatrix = projectionMatrix;
  }

  /**
   * 设置视图矩阵（由 HoloRP 调用）
   * @param {number[]} viewMatrix - 4x4 视图矩阵
   */
  setViewMatrix(viewMatrix) {
    this._viewMatrix = viewMatrix;
  }

  /**
   * 设置焦距（由 HoloRP 调用）
   * @param {number} fx - 焦距 x
   * @param {number} fy - 焦距 y
   */
  setFocal(fx, fy) {
    this._fx = fx;
    this._fy = fy;
  }
}

/**
 * WebXR 渲染目标（XR模式）
 */
export class WebXRRenderTarget extends RenderTarget {
  constructor(gl, session, refSpace, worldTransform = null) {
    super();
    this.gl = gl;
    this.session = session;
    this.refSpace = refSpace;
    this.worldTransform = worldTransform || identity4();
    this.frame = null;
    this.pose = null;
    this.glLayer = null;
    this.views = [];
  }

  beginFrame(frame) {
    if (!this.gl || !this.session || !this.refSpace) {
      return false;
    }

    if (!frame) {
      return false;
    }

    this.frame = frame;
    // 使用最新的 refSpace（可能通过 setRefSpace 更新）
    const refSpace = this.refSpace;
    this.pose = frame.getViewerPose(refSpace);
    
    if (!this.pose) {
      return false;
    }

    this.glLayer = this.session.renderState.baseLayer;
    if (!this.glLayer) {
      return false;
    }

    // 绑定 XR 帧缓冲区
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.glLayer.framebuffer);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);

    // 为每个 view（左右眼）创建视图信息
    this.views = [];
    for (const view of this.pose.views) {
      const viewInfo = new ViewInfo();
      const viewport = this.glLayer.getViewport(view);
      
      // 设置视口
      viewInfo.viewport = {
        x: viewport.x,
        y: viewport.y,
        width: viewport.width,
        height: viewport.height
      };

      // 使用 XR 提供的投影矩阵
      viewInfo.projectionMatrix = view.projectionMatrix;

      // 计算变换后的视图矩阵
      // transformedView = view.transform.inverse.matrix * worldTransform
      const viewTransform = view.transform.inverse.matrix;
      viewInfo.viewMatrix = multiply4(viewTransform, this.worldTransform);

      // 计算焦距（从投影矩阵）
      viewInfo.fx = (viewInfo.projectionMatrix[0] * viewport.width) / 2;
      viewInfo.fy = -(viewInfo.projectionMatrix[5] * viewport.height) / 2;

      this.views.push(viewInfo);
    }

    return true;
  }

  getViews() {
    return this.views;
  }

  endFrame() {
    // XR 模式不需要特殊处理，由 XR session 管理
  }

  bindFramebuffer() {
    // XR 模式使用 XR 提供的帧缓冲区
    if (this.glLayer) {
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.glLayer.framebuffer);
    }
  }

  getGL() {
    return this.gl;
  }

  /**
   * 设置世界变换矩阵（用于调整 XR 中的世界空间）
   * @param {number[]} worldTransform - 4x4 世界变换矩阵
   */
  setWorldTransform(worldTransform) {
    if (worldTransform && Array.isArray(worldTransform) && worldTransform.length === 16) {
      this.worldTransform = worldTransform;
    }
  }

  /**
   * 获取世界变换矩阵
   * @returns {number[]} 4x4 世界变换矩阵
   */
  getWorldTransform() {
    return this.worldTransform;
  }

  /**
   * 设置参考空间（用于更新 refSpace，如果它在创建后改变了）
   * @param {XRReferenceSpace} refSpace - XR 参考空间
   */
  setRefSpace(refSpace) {
    this.refSpace = refSpace;
  }
}

