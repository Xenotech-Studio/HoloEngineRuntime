/**
 * 深度可视化渲染器
 * 使用 FBO + 深度纹理实现深度可视化
 */

import { createShader, createProgram } from './webgl';
import { depthVisualizationVertexShader, depthVisualizationFragmentShader } from '../shaders/depthVisualizationShaders';

/**
 * 深度可视化渲染器类
 */
export class DepthVisualizationRenderer {
  constructor(gl) {
    this.gl = gl;
    
    // FBO 资源
    this.framebuffer = null;
    this.colorTexture = null;
    this.depthTexture = null;
    this.width = 0;
    this.height = 0;
    
    // Shader 资源
    this.program = null;
    this.vertexShader = null;
    this.fragmentShader = null;
    this.uniforms = {};
    this.attributes = {};
    
    // 全屏 quad 缓冲区
    this.quadBuffer = null;
    
    // 初始化
    this._initShader();
    this._initQuad();
  }

  /**
   * 初始化深度可视化 shader
   * @private
   */
  _initShader() {
    const gl = this.gl;
    
    try {
      // 创建 shader
      this.vertexShader = createShader(gl, gl.VERTEX_SHADER, depthVisualizationVertexShader);
      this.fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, depthVisualizationFragmentShader);
      
      // 创建 program
      this.program = createProgram(gl, this.vertexShader, this.fragmentShader);
      
      // 获取 uniform 位置
      this.uniforms = {
        depthTexture: gl.getUniformLocation(this.program, 'depthTexture'),
        near: gl.getUniformLocation(this.program, 'near'),
        far: gl.getUniformLocation(this.program, 'far'),
        depthRange: gl.getUniformLocation(this.program, 'depthRange'),
        depthRangeNear: gl.getUniformLocation(this.program, 'depthRangeNear'),
        gamma: gl.getUniformLocation(this.program, 'gamma')
      };
      
      // 获取 attribute 位置
      this.attributes = {
        position: gl.getAttribLocation(this.program, 'position')
      };
    } catch (err) {
      console.error('[DepthVisualizationRenderer] Shader 初始化失败:', err);
      throw err;
    }
  }

  /**
   * 初始化全屏 quad
   * @private
   */
  _initQuad() {
    const gl = this.gl;
    
    // 全屏 quad 顶点（NDC 空间，覆盖整个屏幕）
    const quadVertices = new Float32Array([
      -1.0, -1.0,  // 左下
       1.0, -1.0,  // 右下
      -1.0,  1.0,  // 左上
       1.0,  1.0   // 右上
    ]);
    
    this.quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW);
  }

  /**
   * 创建或更新 FBO 和纹理（当 canvas 尺寸变化时调用）
   * @param {number} width - 宽度
   * @param {number} height - 高度
   */
  setupFramebuffer(width, height) {
    const gl = this.gl;
    
    // 如果尺寸没变化，不需要重新创建
    if (this.width === width && this.height === height && this.framebuffer) {
      return;
    }
    
    // 清理旧资源
    this.disposeFramebuffer();
    
    this.width = width;
    this.height = height;
    
    // 创建 FBO
    this.framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    
    // 创建颜色纹理
    this.colorTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.colorTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      width,
      height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    
    // 创建深度纹理
    this.depthTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.depthTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.DEPTH_COMPONENT24, // WebGL2 支持 24 位深度
      width,
      height,
      0,
      gl.DEPTH_COMPONENT,
      gl.UNSIGNED_INT,
      null
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    
    // 附加纹理到 FBO
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.colorTexture,
      0
    );
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.DEPTH_ATTACHMENT,
      gl.TEXTURE_2D,
      this.depthTexture,
      0
    );
    
    // 检查 FBO 完整性
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      console.error('[DepthVisualizationRenderer] FBO 不完整:', status);
      this.disposeFramebuffer();
      throw new Error('Framebuffer setup failed');
    }
    
    // 解绑
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  /**
   * 绑定 FBO（用于渲染场景到 FBO）
   */
  bindFramebuffer() {
    if (!this.framebuffer) {
      return false;
    }
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.framebuffer);
    return true;
  }

  /**
   * 解绑 FBO（恢复到默认 framebuffer）
   */
  unbindFramebuffer() {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
  }

  /**
   * 渲染深度可视化（全屏 quad）
   * @param {number} near - 近平面距离
   * @param {number} far - 远平面距离
   * @param {number} colorMode - 颜色模式：0=灰度, 1=彩虹, 2=热力图
   * @param {number} depthRange - 深度范围（米），用于映射，例如 10.0 表示关注 0-10 米范围。如果 <= 0 则使用原始 NDC 深度
   * @param {number} depthRangeNear - 近处深度范围（米），用于调整颜色渐变的起始距离
   * @param {number} gamma - Gamma 值，用于调整映射曲线的非线性程度（>1 时增强近处，<1 时增强远处）
   */
  renderDepthVisualization(near = 0.1, far = 1000.0, colorMode = 0, depthRange = 30.0, depthRangeNear = 10.0, gamma = 1.5) {
    const gl = this.gl;
    
    if (!this.program || !this.depthTexture) {
      return;
    }
    
    // 使用深度可视化 shader
    gl.useProgram(this.program);
    
    // 绑定深度纹理
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.depthTexture);
    if (this.uniforms.depthTexture !== null) {
      gl.uniform1i(this.uniforms.depthTexture, 0);
    }
    
    // 设置 uniform
    if (this.uniforms.near !== null) {
      gl.uniform1f(this.uniforms.near, near);
    }
    if (this.uniforms.far !== null) {
      gl.uniform1f(this.uniforms.far, far);
    }
    if (this.uniforms.depthRange !== null) {
      gl.uniform1f(this.uniforms.depthRange, depthRange);
    }
    if (this.uniforms.depthRangeNear !== null) {
      gl.uniform1f(this.uniforms.depthRangeNear, depthRangeNear);
    }
    if (this.uniforms.gamma !== null) {
      gl.uniform1f(this.uniforms.gamma, gamma);
    }
    
    // 禁用深度测试和混合（全屏覆盖）
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    
    // 绑定全屏 quad
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    if (this.attributes.position >= 0) {
      gl.enableVertexAttribArray(this.attributes.position);
      gl.vertexAttribPointer(this.attributes.position, 2, gl.FLOAT, false, 0, 0);
    }
    
    // 绘制全屏 quad（使用 TRIANGLE_STRIP）
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    
    // 清理
    if (this.attributes.position >= 0) {
      gl.disableVertexAttribArray(this.attributes.position);
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  /**
   * 清理 FBO 资源
   */
  disposeFramebuffer() {
    const gl = this.gl;
    
    if (this.framebuffer) {
      gl.deleteFramebuffer(this.framebuffer);
      this.framebuffer = null;
    }
    
    if (this.colorTexture) {
      gl.deleteTexture(this.colorTexture);
      this.colorTexture = null;
    }
    
    if (this.depthTexture) {
      gl.deleteTexture(this.depthTexture);
      this.depthTexture = null;
    }
    
    this.width = 0;
    this.height = 0;
  }

  /**
   * 清理所有资源
   */
  dispose() {
    const gl = this.gl;
    
    // 清理 FBO
    this.disposeFramebuffer();
    
    // 清理 shader
    if (this.program) {
      gl.deleteProgram(this.program);
      this.program = null;
    }
    if (this.vertexShader) {
      gl.deleteShader(this.vertexShader);
      this.vertexShader = null;
    }
    if (this.fragmentShader) {
      gl.deleteShader(this.fragmentShader);
      this.fragmentShader = null;
    }
    
    // 清理 quad buffer
    if (this.quadBuffer) {
      gl.deleteBuffer(this.quadBuffer);
      this.quadBuffer = null;
    }
  }
}

