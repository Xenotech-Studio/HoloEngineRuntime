/**
 * Holo 渲染管线 - 核心渲染逻辑
 * 只负责渲染多个模型和处理视角变换，不包含业务逻辑（如模型加载、用户交互等）
 */

import { getProjectionMatrix, calculateDynamicFocal, multiply4, identity4, createTransformMatrix } from './webgl';
import { renderAxisGrid } from './axisGridRenderer';
import { RenderTarget, CanvasRenderTarget } from './renderTarget';
import { DepthVisualizationRenderer } from './depthVisualizationRenderer';

/**
 * 渲染类型枚举
 */
export const RenderType = {
  '4DGS': '4dgs',  // 4D Gaussian Splatting（动态/时间相关）
  '3DGS': '3dgs',  // 3D Gaussian Splatting（静态，支持SH）
  MESH: 'mesh',    // 网格模型
  LINES: 'lines'   // 线段（相机锥体、连线等）
};

/**
 * 渲染对象接口
 * 每个要渲染的对象需要实现这个接口
 */
export class RenderableObject {
  constructor(id, renderType = RenderType['4DGS']) {
    this.id = id;
    this.renderType = renderType;  // 渲染类型：'4dgs', '3dgs' 或 'mesh'
    
    // 4DGS/3DGS 相关资源
    this.texture = null;           // WebGLTexture (4DGS/3DGS用，存储高斯点数据)
    this.indexBuffer = null;       // WebGLBuffer (4DGS/3DGS的深度排序索引)
    this.vertexCount = 0;         // 顶点数量 (4DGS/3DGS用)
    this.worker = null;            // 深度排序 Worker (4DGS/3DGS用)
    this.sortStrategy = 'back-to-front'; // 排序策略：'none', 'front-to-back', 'back-to-front'
    
    // 3DGS 专用资源（SH系数）
    this.shTexture = null;         // WebGLTexture (3DGS用，存储SH系数，可选)
    this.shTextureR = null;        // WebGLTexture (3DGS用，R通道SH系数，可选)
    this.shTextureG = null;        // WebGLTexture (3DGS用，G通道SH系数，可选)
    this.shTextureB = null;        // WebGLTexture (3DGS用，B通道SH系数，可选)
    this.sphericalHarmonicsDegree = 0;  // SH阶数（0=无SH，1=1阶，2=2阶，3=3阶）
    
    // Mesh 相关资源
    this.vertexBuffer = null;      // WebGLBuffer (mesh的顶点数据)
    this.elementBuffer = null;    // WebGLBuffer (mesh的索引数据)
    this.elementCount = 0;        // 索引数量 (mesh用)
    this.vertexAttributes = null;  // 顶点属性配置 {position, normal, uv, stride}

    // LINES 相关资源（positionBuffer/colorBuffer 复用，或 linesVertexCount）
    this.positionBuffer = null;   // WebGLBuffer (position x,y,z) - 用于LINES
    this.colorBuffer = null;      // WebGLBuffer (color r,g,b) - 用于LINES
    this.linesVertexCount = 0;    // 顶点数（线段数 * 2）

    // 通用资源
    this.modelMatrix = null;       // 4x4 模型变换矩阵（如果为 null 则使用单位矩阵）
    this.ready = false;            // 是否准备好渲染
    this.material = null;          // 材质（可选，用于mesh）
  }

  /**
   * 获取模型变换矩阵
   * @returns {number[]} 4x4 矩阵（16元素数组）
   */
  getModelMatrix() {
    return this.modelMatrix || identity4();
  }

  /**
   * 检查是否准备好渲染
   * @returns {boolean}
   */
  isReady() {
    if (this.renderType === RenderType['4DGS'] || this.renderType === RenderType['3DGS']) {
      return this.ready && this.texture && this.indexBuffer && this.vertexCount > 0;
    }
    if (this.renderType === RenderType.MESH) {
      return this.ready && this.vertexBuffer && this.elementBuffer && this.elementCount > 0;
    }
    if (this.renderType === RenderType.LINES) {
      return this.ready && this.positionBuffer && this.linesVertexCount >= 2;
    }
    return false;
  }
}

/**
 * Holo 渲染管线类
 */
export class HoloRP {
  constructor(gl, splatProgram, splat3DGSProgram, meshProgram, splatUniforms, splat3DGSUniforms, meshUniforms, splatAttributes, splat3DGSAttributes, meshAttributes, colmapOptions = {}) {
    this.gl = gl;
    
    // 向后兼容：检测参数数量
    if (arguments.length === 4) {
      // 旧的方式：constructor(gl, program, uniforms, attributes)
      const program = splatProgram;
      const uniforms = splat3DGSProgram; // 实际上是第二个参数
      const attributes = meshProgram; // 实际上是第三个参数
      
      // 使用旧参数作为 splat 资源
      this.splatProgram = program;
      this.splatUniforms = uniforms;
      this.splatAttributes = attributes;
      
      // 3DGS 和 Mesh 资源使用相同的值（向后兼容）
      this.splat3DGSProgram = program;
      this.splat3DGSUniforms = uniforms;
      this.splat3DGSAttributes = attributes;
      this.meshProgram = program;
      this.meshUniforms = uniforms;
      this.meshAttributes = attributes;
    } else {
      // 新的方式：所有参数都提供
      this.splatProgram = splatProgram;  // 4DGS program
      this.splatUniforms = splatUniforms;  // 4DGS uniforms
      this.splatAttributes = splatAttributes;  // 4DGS attributes
      
      this.splat3DGSProgram = splat3DGSProgram;  // 3DGS program
      this.splat3DGSUniforms = splat3DGSUniforms;  // 3DGS uniforms
      this.splat3DGSAttributes = splat3DGSAttributes;  // 3DGS attributes
      
      // Mesh 渲染资源
      this.meshProgram = meshProgram;
      this.meshUniforms = meshUniforms;
      this.meshAttributes = meshAttributes;
      
      // 如果没有提供 meshProgram，使用 splatProgram
      if (!meshProgram) {
        this.meshProgram = splatProgram;
        this.meshUniforms = splatUniforms;
        this.meshAttributes = splatAttributes;
      }
      
      // 如果没有提供 3DGS program，使用 4DGS program（向后兼容）
      if (!splat3DGSProgram) {
        this.splat3DGSProgram = splatProgram;
        this.splat3DGSUniforms = splatUniforms;
        this.splat3DGSAttributes = splatAttributes;
      }
    }
    
    // 向后兼容：保留旧的属性名
    this.program = this.splatProgram;
    this.uniforms = this.splatUniforms;
    this.attributes = this.splatAttributes;
    
    // ColmapUtil：线段（可选）
    const opts = colmapOptions && typeof colmapOptions === 'object' ? colmapOptions : {};
    this.linesProgram = opts.linesProgram || null;
    this.linesUniforms = opts.linesUniforms || null;
    this.linesAttributes = opts.linesAttributes || null;
    
    // 渲染对象列表
    this.objects = new Map(); // id -> RenderableObject
    
    // WebGL 资源
    this.vertexBuffer = null;        // 共享的顶点缓冲区（用于所有对象）
    this.axisGridRenderer = null;    // 坐标轴和网格渲染器
    this.defaultTexture = null;      // 默认纹理（用于 mesh，当没有纹理时）
    this.depthVisualizationRenderer = null; // 深度可视化渲染器
    
    // 渲染状态
    this.viewMatrix = null;          // 当前视图矩阵
    this.camera = null;               // 当前相机对象（用于计算投影矩阵）
    this.targetVerticalFOV = null;   // 目标垂直 FOV（可选）
    this.enableAxisGrid = true;      // 是否启用坐标轴和网格渲染（默认启用）
    this.meshDebugMode = -1;         // Mesh 调试模式：-1=正常光照, 0=法线颜色（调试）
    this.showDepthVisualization = false; // 是否显示深度可视化
    this.depthRange = 30.0;          // 深度范围（米），用于映射，例如 30.0 表示关注 10-30 米范围
    this.depthRangeNear = 10.0;      // 近处深度范围（米），用于调整颜色渐变的起始距离
    this.depthGamma = 1.5;           // Gamma 值，用于调整映射曲线的非线性程度（>1 时增强近处，<1 时增强远处）
    this.depthOpacityThreshold = 0.13; // 深度写入的像素不透明度阈值（0.0-1.0），过滤当前像素的透明度，默认0.13
    this.centerOpacityThreshold = 0.65; // 深度写入的中心点不透明度阈值（0.0-1.0），过滤高斯点中心位置的透明度，默认0.65
    
    // 初始化共享资源
    this._initSharedResources();
  }

  /**
   * 初始化共享资源
   */
  _initSharedResources() {
    const gl = this.gl;
    
    // 创建共享的顶点缓冲区
    const triangleVertices = new Float32Array([-2, -2, 2, -2, 2, 2, -2, 2]);
    this.vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, triangleVertices, gl.STATIC_DRAW);
    
    // 创建默认纹理（1x1 白色纹理，用于 mesh shader 的 sampler）
    this.defaultTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.defaultTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([255, 255, 255, 255]) // 白色
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /**
   * 初始化坐标轴和网格渲染器
   * @param {Function} initAxisGridRenderer - 初始化函数
   */
  initAxisGrid(initAxisGridRenderer) {
    try {
      this.axisGridRenderer = initAxisGridRenderer(this.gl, this.splatProgram);
    } catch (err) {
      console.error('[HoloRP] 初始化坐标轴网格渲染器失败:', err);
      this.axisGridRenderer = null;
    }
  }

  /**
   * 添加渲染对象
   * @param {RenderableObject} obj - 渲染对象
   */
  addObject(obj) {
    if (!(obj instanceof RenderableObject)) {
      console.warn('[HoloRP] 对象必须是 RenderableObject 实例');
      return;
    }
    this.objects.set(obj.id, obj);
  }

  /**
   * 移除渲染对象
   * @param {string} id - 对象 ID
   */
  removeObject(id) {
    this.objects.delete(id);
  }

  /**
   * 获取渲染对象
   * @param {string} id - 对象 ID
   * @returns {RenderableObject|null}
   */
  getObject(id) {
    return this.objects.get(id) || null;
  }

  /**
   * 获取所有渲染对象
   * @returns {RenderableObject[]}
   */
  getAllObjects() {
    return Array.from(this.objects.values());
  }

  /**
   * 清空所有渲染对象
   */
  clearObjects() {
    this.objects.clear();
  }

  /**
   * 设置视图矩阵
   * @param {number[]} viewMatrix - 4x4 视图矩阵（16元素数组）
   */
  setViewMatrix(viewMatrix) {
    if (viewMatrix && Array.isArray(viewMatrix) && viewMatrix.length === 16) {
      this.viewMatrix = viewMatrix;
    }
  }

  /**
   * 设置相机对象（用于计算投影矩阵）
   * @param {Object} camera - 相机对象（包含 fx, fy 等属性）
   */
  setCamera(camera) {
    this.camera = camera;
  }

  /**
   * 设置目标垂直 FOV
   * @param {number|null} fov - 目标垂直 FOV（角度），如果为 null 则使用相机的 fx/fy
   */
  setTargetVerticalFOV(fov) {
    this.targetVerticalFOV = fov;
  }

  /**
   * 设置是否启用坐标轴和网格渲染
   * @param {boolean} enable - 是否启用
   */
  setEnableAxisGrid(enable) {
    this.enableAxisGrid = enable;
  }

  /**
   * 设置 Mesh 调试模式
   * @param {number} mode - 调试模式：-1=正常光照, 0=法线颜色（调试）
   */
  setMeshDebugMode(mode) {
    this.meshDebugMode = mode !== undefined && mode !== null ? mode : -1;
  }

  /**
   * 设置是否显示深度可视化
   * @param {boolean} show - 是否显示深度可视化
   */
  setShowDepthVisualization(show) {
    this.showDepthVisualization = show === true;
    
    // 延迟初始化深度可视化渲染器（只在需要时创建）
    if (this.showDepthVisualization && !this.depthVisualizationRenderer) {
      try {
        this.depthVisualizationRenderer = new DepthVisualizationRenderer(this.gl);
      } catch (err) {
        console.error('[HoloRP] 初始化深度可视化渲染器失败:', err);
        this.showDepthVisualization = false;
      }
    }
  }

  /**
   * 设置深度范围（用于映射）
   * @param {number} range - 深度范围（米），例如 10.0 表示关注 0-10 米范围。如果 <= 0 则使用原始 NDC 深度
   */
  setDepthRange(range) {
    this.depthRange = range !== undefined && range !== null ? Math.max(0, range) : 10.0;
  }

  /**
   * 设置近处深度范围（用于映射）
   * @param {number} rangeNear - 近处深度范围（米），用于调整颜色渐变的起始距离
   */
  setDepthRangeNear(rangeNear) {
    this.depthRangeNear = rangeNear !== undefined && rangeNear !== null ? Math.max(0, rangeNear) : 10.0;
  }

  /**
   * 设置深度映射的 Gamma 值
   * @param {number} gamma - Gamma 值，用于调整映射曲线的非线性程度（>1 时增强近处，<1 时增强远处）
   */
  setDepthGamma(gamma) {
    this.depthGamma = gamma !== undefined && gamma !== null ? Math.max(0.1, Math.min(5.0, gamma)) : 1.5;
  }

  /**
   * 设置深度写入的像素不透明度阈值
   * @param {number} threshold - 像素不透明度阈值（0.0-1.0），只有像素不透明度超过此值才会写入深度
   */
  setDepthOpacityThreshold(threshold) {
    this.depthOpacityThreshold = threshold !== undefined && threshold !== null ? Math.max(0.0, Math.min(1.0, threshold)) : 0.13;
  }

  /**
   * 设置对象的排序策略（用于3DGS/4DGS）
   * @param {string} objectId - 对象ID
   * @param {string} strategy - 排序策略：'none'（不排序）、'front-to-back'（从近到远）、'back-to-front'（从远到近）
   */
  setObjectSortStrategy(objectId, strategy) {
    const obj = this.objects.get(objectId);
    if (obj && (obj.renderType === RenderType['3DGS'] || obj.renderType === RenderType['4DGS'])) {
      obj.sortStrategy = strategy || 'back-to-front';
      // 如果worker已创建，立即更新排序策略
      if (obj.worker) {
        obj.worker.postMessage({ sortStrategy: obj.sortStrategy });
      }
    }
  }

  /**
   * 设置深度写入的中心点不透明度阈值
   * @param {number} threshold - 中心点不透明度阈值（0.0-1.0），只有中心点不透明度超过此值的高斯点才会写入深度
   */
  setCenterOpacityThreshold(threshold) {
    this.centerOpacityThreshold = threshold !== undefined && threshold !== null ? Math.max(0.0, Math.min(1.0, threshold)) : 0.65;
  }

  /**
   * 渲染一帧
   * @param {RenderTarget} renderTarget - 渲染目标（Canvas 或 WebXR）
   * @param {Function} onBeforeRender - 渲染前的回调（可选，用于更新相机等）
   * @param {Function} onUpdateWorker - 更新 Worker 的回调（可选，用于深度排序）
   * @param {XRFrame} frame - XR 帧（仅 XR 模式需要）
   * @param {string[]} objectOrder - 可选的对象ID顺序列表，如果提供则按此顺序渲染（用于匹配hierarchy顺序）
   */
  render(renderTarget, onBeforeRender = null, onUpdateWorker = null, frame = null, objectOrder = null) {
    const gl = this.gl;
    
    const hasSplat = !!(this.splatProgram && this.splatUniforms);
    const hasLines = !!(this.linesProgram && this.linesUniforms);
    if (!gl || (!hasSplat && !hasLines)) {
      return;
    }

    if (!renderTarget || !(renderTarget instanceof RenderTarget)) {
      return;
    }

    // 调用渲染前回调（用于更新相机等）
    if (onBeforeRender) {
      onBeforeRender();
    }

    // 开始一帧渲染（XR 模式需要传递 frame）
    if (!renderTarget.beginFrame(frame)) {
      return;
    }

    // 先获取视图列表以获取视口信息（用于 FBO 尺寸）
    const initialViews = renderTarget.getViews();
    if (initialViews.length === 0) {
      return;
    }

    // 获取第一个视图的视口（用于 FBO 尺寸）
    const firstView = initialViews[0];
    const viewport = firstView.viewport;

    // 如果启用深度可视化，设置 FBO
    let useDepthVisualization = this.showDepthVisualization && this.depthVisualizationRenderer;
    if (useDepthVisualization) {
      // 设置 FBO 尺寸
      this.depthVisualizationRenderer.setupFramebuffer(viewport.width, viewport.height);
      
      // 绑定 FBO（后续渲染会写入 FBO）
      if (!this.depthVisualizationRenderer.bindFramebuffer()) {
        // FBO 设置失败，回退到正常渲染
        useDepthVisualization = false;
      } else {
        // 清除 FBO（颜色和深度）
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      }
    }

    // 使用 program（若有 splat 则先切到 splat，否则由各类型绘制时再切换）
    if (this.splatProgram) {
      gl.useProgram(this.program);
    }

    // 如果未使用深度可视化，绑定默认 framebuffer
    if (!useDepthVisualization) {
      renderTarget.bindFramebuffer();
    }

    // 如果是 Canvas 模式，先计算投影矩阵并设置到 RenderTarget
    let computedProjectionMatrix = null;
    if (renderTarget instanceof CanvasRenderTarget) {
      const viewport = renderTarget.currentView.viewport;
      const activeCamera = this.camera || { fx: 1000, fy: 1000 };
      const { fx, fy } = calculateDynamicFocal(
        this.targetVerticalFOV,
        viewport.width,
        viewport.height,
        activeCamera.fx,
        activeCamera.fy
      );
      computedProjectionMatrix = getProjectionMatrix(fx, fy, viewport.width, viewport.height);
      
      // 设置到 CanvasRenderTarget
      renderTarget.setProjectionMatrix(computedProjectionMatrix);
      renderTarget.setViewMatrix(this.viewMatrix);
      renderTarget.setFocal(fx, fy);
    }

    // 重新获取视图列表（投影矩阵已设置）
    const views = renderTarget.getViews();
    if (views.length === 0) {
      return;
    }

    // 为每个视图渲染
    for (const viewInfo of views) {
      // 设置视口
      gl.viewport(
        viewInfo.viewport.x,
        viewInfo.viewport.y,
        viewInfo.viewport.width,
        viewInfo.viewport.height
      );

      // 获取投影矩阵（Canvas 模式已计算，XR 模式由 RenderTarget 提供）
      // 如果 viewInfo.projectionMatrix 为 null，使用计算好的投影矩阵
      const projectionMatrix = viewInfo.projectionMatrix || computedProjectionMatrix;
      
      // 获取视图矩阵（XR 模式使用已转换的视图矩阵，普通模式使用设置的视图矩阵）
      const viewMatrix = viewInfo.viewMatrix || this.viewMatrix;
      
      // 确保矩阵有效
      if (!projectionMatrix || !Array.isArray(projectionMatrix) || projectionMatrix.length !== 16) {
        console.warn('[HoloRP] 投影矩阵无效，跳过此视图');
        continue;
      }
      if (!viewMatrix || !Array.isArray(viewMatrix) || viewMatrix.length !== 16) {
        console.warn('[HoloRP] 视图矩阵无效，跳过此视图');
        continue;
      }

      // 设置投影矩阵、viewport、focal uniform（splat 用）
      if (this.uniforms && this.uniforms.projection && projectionMatrix) {
        gl.uniformMatrix4fv(this.uniforms.projection, false, projectionMatrix);
      }
      if (this.uniforms && this.uniforms.viewport) {
        gl.uniform2fv(this.uniforms.viewport, new Float32Array([
          viewInfo.viewport.width,
          viewInfo.viewport.height
        ]));
      }
      if (this.uniforms && this.uniforms.focal) {
        gl.uniform2fv(this.uniforms.focal, new Float32Array([viewInfo.fx, viewInfo.fy]));
      }

      if (viewMatrix && this.uniforms && this.uniforms.view) {
        gl.uniformMatrix4fv(this.uniforms.view, false, viewMatrix);
      }

      const time = Math.sin(Date.now() / 1000) / 2 + 1 / 2;
      if (this.uniforms && this.uniforms.time) {
        gl.uniform1f(this.uniforms.time, time);
      }

      // 获取所有对象并按类型分组
      // 如果提供了objectOrder，按照指定顺序获取对象（匹配hierarchy顺序）
      let objects;
      if (objectOrder && Array.isArray(objectOrder)) {
        // 按照指定的顺序获取对象
        objects = [];
        for (const id of objectOrder) {
          const obj = this.objects.get(id);
          if (obj) {
            objects.push(obj);
          }
        }
        // 添加不在顺序列表中的对象（以防万一）
        const orderedIds = new Set(objectOrder);
        for (const obj of this.objects.values()) {
          if (!orderedIds.has(obj.id)) {
            objects.push(obj);
          }
        }
      } else {
        // 使用默认顺序（Map的插入顺序）
        objects = this.getAllObjects();
      }
      
      const gsObjects = [];  // 4DGS和3DGS对象
      const meshObjects = [];
      const lineObjects = [];
      
      for (const obj of objects) {
        if (obj.renderType === RenderType['4DGS'] || obj.renderType === RenderType['3DGS']) {
          gsObjects.push(obj);
        } else if (obj.renderType === RenderType.MESH) {
          meshObjects.push(obj);
        } else if (obj.renderType === RenderType.LINES) {
          lineObjects.push(obj);
        }
      }

      // 先渲染所有 Mesh（使用深度测试）
      if (meshObjects.length > 0 && this.meshProgram) {
        gl.enable(gl.DEPTH_TEST);
        gl.disable(gl.BLEND);
        gl.useProgram(this.meshProgram);
        
        // 设置 mesh shader 的 uniform
        if (this.meshUniforms.projection && projectionMatrix) {
          gl.uniformMatrix4fv(this.meshUniforms.projection, false, projectionMatrix);
        }
        if (this.meshUniforms.view && viewMatrix) {
          gl.uniformMatrix4fv(this.meshUniforms.view, false, viewMatrix);
        }
        
        // 设置默认颜色（如果没有材质）
        if (this.meshUniforms.color) {
          gl.uniform3f(this.meshUniforms.color, 0.8, 0.8, 0.8);
        }
        if (this.meshUniforms.useTexture) {
          gl.uniform1i(this.meshUniforms.useTexture, false);
        }
        
        // 设置默认平行光（从右上方照射）
        if (this.meshUniforms.lightDirection) {
          // 平行光方向：从 (1, 1, 0) 方向照射（已归一化）
          // 注意：lightDirection 是从光源指向表面的方向
          const lightDir = [-1, 5, 1];
          const len = Math.sqrt(lightDir[0] * lightDir[0] + lightDir[1] * lightDir[1] + lightDir[2] * lightDir[2]);
          const normalizedDir = [lightDir[0] / len, lightDir[1] / len, lightDir[2] / len];
          gl.uniform3f(
            this.meshUniforms.lightDirection,
            normalizedDir[0],
            normalizedDir[1],
            normalizedDir[2]
          );
        }
        if (this.meshUniforms.lightColor) {
          // 白色平行光
          gl.uniform3f(this.meshUniforms.lightColor, 1.0, 1.0, 1.0);
        }
        if (this.meshUniforms.lightIntensity) {
          // 平行光强度
          gl.uniform1f(this.meshUniforms.lightIntensity, 0.6);
        }
        if (this.meshUniforms.ambientIntensity) {
          // 环境光强度
          gl.uniform1f(this.meshUniforms.ambientIntensity, 0.6);
        }
        
        // 绑定默认纹理到 TEXTURE0（即使不使用，sampler 也需要绑定有效纹理）
        if (this.meshUniforms.diffuseTexture !== undefined && this.meshUniforms.diffuseTexture !== null) {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, this.defaultTexture);
          gl.uniform1i(this.meshUniforms.diffuseTexture, 0);
        }
        
        // 设置调试模式（-1=正常光照, 0=法线颜色）
        if (this.meshUniforms.debugMode !== undefined && this.meshUniforms.debugMode !== null) {
          gl.uniform1i(this.meshUniforms.debugMode, this.meshDebugMode !== undefined && this.meshDebugMode !== null ? this.meshDebugMode : -1);
        }
        
        for (const obj of meshObjects) {
          this._renderMesh(obj, viewMatrix, projectionMatrix);
        }
      }

      // 再渲染所有 4DGS/3DGS（使用 alpha blending 和深度测试）
      // 将4DGS和3DGS分开处理，使用不同的shader
      const objects4DGS = gsObjects.filter(obj => obj.renderType === RenderType['4DGS']);
      const objects3DGS = gsObjects.filter(obj => obj.renderType === RenderType['3DGS']);
      
      // 渲染 4DGS 对象
      if (objects4DGS.length > 0 && this.splatProgram) {
        this._renderGSObjects(objects4DGS, viewMatrix, projectionMatrix, onUpdateWorker, 
          this.splatProgram, this.splatUniforms, this.splatAttributes, viewInfo, true);
      }
      
      // 渲染 3DGS 对象
      if (objects3DGS.length > 0 && this.splat3DGSProgram) {
        this._renderGSObjects(objects3DGS, viewMatrix, projectionMatrix, onUpdateWorker, 
          this.splat3DGSProgram, this.splat3DGSUniforms, this.splat3DGSAttributes, viewInfo, false);
      }

      // 绘制 LINES 对象（相机锥体、连线等）
      if (lineObjects.length > 0 && this.linesProgram && this.linesUniforms) {
        this._renderLines(lineObjects, viewMatrix, projectionMatrix);
      }

      // 绘制坐标轴和网格（如果启用）- 只在第一个视图绘制（避免重复）
      if (this.enableAxisGrid && this.axisGridRenderer && viewMatrix && views.indexOf(viewInfo) === 0) {
        try {
          renderAxisGrid(gl, this.axisGridRenderer, projectionMatrix, viewMatrix);
        } catch (err) {
          console.error('[HoloRP] 绘制坐标轴网格失败:', err);
        }
      }
    }

    // 如果使用深度可视化，渲染深度可视化到默认 framebuffer
    if (useDepthVisualization && this.depthVisualizationRenderer) {
      // 解绑 FBO，切换到默认 framebuffer
      this.depthVisualizationRenderer.unbindFramebuffer();
      renderTarget.bindFramebuffer();
      
      // 设置视口
      gl.viewport(0, 0, viewport.width, viewport.height);
      
      // 计算 near/far（从投影矩阵或使用默认值）
      // 注意：WebGL 投影矩阵的 near/far 信息在矩阵中，但提取比较复杂
      // 这里使用合理的默认值，或者可以从相机参数计算
      const near = 0.1;
      const far = 1000.0;
      
      // 如果有相机信息，可以尝试从投影矩阵计算
      // 但为了简化，先使用固定值
      
      // 渲染深度可视化（传递深度范围参数，固定使用灰度模式）
      this.depthVisualizationRenderer.renderDepthVisualization(
        near,
        far,
        0, // 固定使用灰度模式
        this.depthRange,
        this.depthRangeNear,
        this.depthGamma
      );
    }

    // 结束一帧渲染
    renderTarget.endFrame();
  }

  /**
   * 渲染 4DGS/3DGS 对象组（统一的渲染逻辑）
   * @private
   */
  _renderGSObjects(objects, viewMatrix, projectionMatrix, onUpdateWorker, program, uniforms, attributes, viewInfo, is4DGS) {
    const gl = this.gl;
    
    // 启用深度测试和深度写入
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    
    // 启用stencil buffer
    gl.enable(gl.STENCIL_TEST);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
    
    // 启用混合模式（4DGS和3DGS使用相同的预乘alpha混合）
    // 片段着色器输出预乘alpha：fragColor = vec4(B * vColor.rgb, B)
    // 配合back-to-front排序（从远到近），实现标准的半透明渲染
    // 预乘alpha混合需要先渲染远的点，后渲染近的点
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(
      gl.ONE,
      gl.ONE_MINUS_SRC_ALPHA,
      gl.ONE,
      gl.ONE_MINUS_SRC_ALPHA
    );
    gl.blendEquationSeparate(gl.FUNC_ADD, gl.FUNC_ADD);
    
    gl.useProgram(program);
    
    // 设置 shader 的 uniform
    if (uniforms.projection && projectionMatrix) {
      gl.uniformMatrix4fv(uniforms.projection, false, projectionMatrix);
    }
    if (uniforms.viewport) {
      gl.uniform2fv(uniforms.viewport, new Float32Array([
        viewInfo.viewport.width,
        viewInfo.viewport.height
      ]));
    }
    if (uniforms.focal) {
      gl.uniform2fv(uniforms.focal, new Float32Array([viewInfo.fx, viewInfo.fy]));
    }
    if (uniforms.view && viewMatrix) {
      gl.uniformMatrix4fv(uniforms.view, false, viewMatrix);
    }
    
    // 4DGS需要time uniform，3DGS不需要
    if (is4DGS && uniforms.time) {
      const time = Math.sin(Date.now() / 1000) / 2 + 1 / 2;
      gl.uniform1f(uniforms.time, time);
    }
    
    // 设置深度写入的不透明度阈值
    if (uniforms.depthOpacityThreshold !== undefined && uniforms.depthOpacityThreshold !== null) {
      gl.uniform1f(uniforms.depthOpacityThreshold, this.depthOpacityThreshold);
    }
    if (uniforms.centerOpacityThreshold !== undefined && uniforms.centerOpacityThreshold !== null) {
      gl.uniform1f(uniforms.centerOpacityThreshold, this.centerOpacityThreshold);
    }
    
    // 绑定共享的顶点缓冲区（position）
    const aPosition = attributes?.position;
    if (aPosition !== undefined && aPosition >= 0 && this.vertexBuffer) {
      gl.enableVertexAttribArray(aPosition);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
      gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);
    }
    
    // 为每个点云分配不同的stencil值，并渲染
    for (let i = 0; i < objects.length; i++) {
      const obj = objects[i];
      const stencilValue = i + 1;
      
      gl.stencilFunc(gl.ALWAYS, stencilValue, 0xFF);
      gl.stencilMask(0xFF);
      
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      
      if (i === 0) {
        // 第一个点云：使用两遍渲染
        if (uniforms.depthWriteOnly !== undefined && uniforms.depthWriteOnly !== null) {
          gl.uniform1i(uniforms.depthWriteOnly, 0);
        }
        gl.depthFunc(gl.LEQUAL);
        gl.depthMask(false);
        this._renderSplat(obj, viewMatrix, projectionMatrix, onUpdateWorker, program, uniforms, attributes, is4DGS);
        
        if (uniforms.depthWriteOnly !== undefined && uniforms.depthWriteOnly !== null) {
          gl.uniform1i(uniforms.depthWriteOnly, 1);
        }
        gl.depthFunc(gl.LEQUAL);
        gl.depthMask(true);
        this._renderSplat(obj, viewMatrix, projectionMatrix, onUpdateWorker, program, uniforms, attributes, is4DGS);
      } else {
        if (uniforms.depthWriteOnly !== undefined && uniforms.depthWriteOnly !== null) {
          gl.uniform1i(uniforms.depthWriteOnly, 0);
        }
        gl.depthFunc(gl.LEQUAL);
        gl.depthMask(false);
        this._renderSplat(obj, viewMatrix, projectionMatrix, onUpdateWorker, program, uniforms, attributes, is4DGS);
        
        if (uniforms.depthWriteOnly !== undefined && uniforms.depthWriteOnly !== null) {
          gl.uniform1i(uniforms.depthWriteOnly, 1);
        }
        gl.depthFunc(gl.LEQUAL);
        gl.depthMask(true);
        this._renderSplat(obj, viewMatrix, projectionMatrix, onUpdateWorker, program, uniforms, attributes, is4DGS);
      }
    }
  }

  /**
   * 渲染单个 4DGS/3DGS 对象
   * @private
   */
  _renderSplat(obj, viewMatrix, projectionMatrix, onUpdateWorker, program = null, uniforms = null, attributes = null, is4DGS = true) {
    const gl = this.gl;
    const modelMatrix = obj.getModelMatrix();
    
    // 更新 Worker（用于深度排序）
    if (onUpdateWorker && obj.worker) {
      const viewModel = multiply4(viewMatrix || identity4(), modelMatrix);
      const viewProj = multiply4(projectionMatrix, viewModel);
      if (viewProj && Array.isArray(viewProj) && viewProj.length >= 16) {
        // 先更新排序策略（如果需要）
        const sortStrategy = obj.sortStrategy || 'back-to-front';
        obj.worker.postMessage({ sortStrategy });
        // 然后更新view矩阵
        onUpdateWorker(obj.id, obj.worker, viewProj);
      }
    }
    
    if (!obj.isReady()) {
      return;
    }

    // 使用传入的uniforms和attributes，如果没有则使用默认的
    const activeUniforms = uniforms || this.splatUniforms;
    const activeAttributes = attributes || this.splatAttributes;
    
    try {
      // 设置该对象的 model 矩阵
      if (activeUniforms.model) {
        gl.uniformMatrix4fv(activeUniforms.model, false, modelMatrix);
      }

      // 绑定该对象的纹理
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, obj.texture);
      
      // 3DGS需要绑定SH纹理（如果存在）
      if (!is4DGS && obj.shTexture && activeUniforms.shTexture) {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, obj.shTexture);
        gl.uniform1i(activeUniforms.shTexture, 1);
      }
      
      // 设置SH阶数（3DGS）
      if (!is4DGS && activeUniforms.sphericalHarmonicsDegree !== undefined && activeUniforms.sphericalHarmonicsDegree !== null) {
        gl.uniform1i(activeUniforms.sphericalHarmonicsDegree, obj.sphericalHarmonicsDegree || 0);
      }

      // 绑定该对象的索引缓冲区
      if (obj.indexBuffer) {
        const aIndex = activeAttributes?.index;
        if (aIndex !== undefined && aIndex >= 0) {
          gl.enableVertexAttribArray(aIndex);
          gl.bindBuffer(gl.ARRAY_BUFFER, obj.indexBuffer);
          gl.vertexAttribIPointer(aIndex, 1, gl.INT, false, 0, 0);
          gl.vertexAttribDivisor(aIndex, 1);
        }
      }

      // 绘制该对象
      gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, obj.vertexCount);
    } catch (err) {
      console.error(`[HoloRP] 绘制 ${obj.renderType} 对象 ${obj.id} 时出错:`, err);
    }
  }

  /**
   * 渲染 Mesh 对象
   * @private
   */
  _renderMesh(obj, viewMatrix, projectionMatrix) {
    const gl = this.gl;
    
    if (!obj.isReady()) {
      return;
    }

    try {
      const modelMatrix = obj.getModelMatrix();

      // 设置 uniform
      if (this.meshUniforms.model) {
        gl.uniformMatrix4fv(this.meshUniforms.model, false, modelMatrix);
      }

      // 绑定顶点缓冲区
      const attrs = obj.vertexAttributes || {};
      const useSeparateBuffers = attrs.positionBuffer && attrs.normalBuffer && attrs.uvBuffer;
      
      if (useSeparateBuffers) {
        // 使用分离的缓冲区
        if (this.meshAttributes?.position !== undefined && this.meshAttributes.position >= 0) {
          gl.bindBuffer(gl.ARRAY_BUFFER, attrs.positionBuffer);
          gl.enableVertexAttribArray(this.meshAttributes.position);
          gl.vertexAttribPointer(this.meshAttributes.position, 3, gl.FLOAT, false, 0, 0);
          gl.vertexAttribDivisor(this.meshAttributes.position, 0);
        }
        
        if (this.meshAttributes?.normal !== undefined && this.meshAttributes.normal >= 0) {
          gl.bindBuffer(gl.ARRAY_BUFFER, attrs.normalBuffer);
          gl.enableVertexAttribArray(this.meshAttributes.normal);
          gl.vertexAttribPointer(this.meshAttributes.normal, 3, gl.FLOAT, false, 0, 0);
          gl.vertexAttribDivisor(this.meshAttributes.normal, 0);
        }
        
        if (this.meshAttributes?.uv !== undefined && this.meshAttributes.uv >= 0) {
          gl.bindBuffer(gl.ARRAY_BUFFER, attrs.uvBuffer);
          gl.enableVertexAttribArray(this.meshAttributes.uv);
          gl.vertexAttribPointer(this.meshAttributes.uv, 2, gl.FLOAT, false, 0, 0);
          gl.vertexAttribDivisor(this.meshAttributes.uv, 0);
        }
      } else if (obj.vertexBuffer) {
        // 使用交错的缓冲区
        gl.bindBuffer(gl.ARRAY_BUFFER, obj.vertexBuffer);
        const stride = (attrs.stride !== undefined && attrs.stride !== null) ? Number(attrs.stride) : 32;
        
        if (this.meshAttributes?.position !== undefined && this.meshAttributes.position >= 0) {
          const posOffset = (attrs.position !== undefined && attrs.position !== null) ? Number(attrs.position) : 0;
          gl.enableVertexAttribArray(this.meshAttributes.position);
          gl.vertexAttribPointer(this.meshAttributes.position, 3, gl.FLOAT, false, stride, posOffset);
          gl.vertexAttribDivisor(this.meshAttributes.position, 0);
        }
        
        if (this.meshAttributes?.normal !== undefined && this.meshAttributes.normal >= 0) {
          const normalOffset = (attrs.normal !== undefined && attrs.normal !== null) ? Number(attrs.normal) : 12;
          gl.enableVertexAttribArray(this.meshAttributes.normal);
          gl.vertexAttribPointer(this.meshAttributes.normal, 3, gl.FLOAT, false, stride, normalOffset);
          gl.vertexAttribDivisor(this.meshAttributes.normal, 0);
        }
        
        if (this.meshAttributes?.uv !== undefined && this.meshAttributes.uv >= 0) {
          const uvOffset = (attrs.uv !== undefined && attrs.uv !== null) ? Number(attrs.uv) : 24;
          gl.enableVertexAttribArray(this.meshAttributes.uv);
          gl.vertexAttribPointer(this.meshAttributes.uv, 2, gl.FLOAT, false, stride, uvOffset);
          gl.vertexAttribDivisor(this.meshAttributes.uv, 0);
        }
      }

      // 绑定索引缓冲区
      if (obj.elementBuffer) {
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, obj.elementBuffer);
      }
      
      // 使用 drawElements 绘制
      gl.drawElements(gl.TRIANGLES, obj.elementCount, gl.UNSIGNED_SHORT, 0);
    } catch (err) {
      console.error(`[HoloRP] 绘制 Mesh 对象 ${obj.id} 时出错:`, err);
    }
  }

  /**
   * 渲染 LINES 对象组
   * @private
   */
  _renderLines(objects, viewMatrix, projectionMatrix) {
    const gl = this.gl;
    const prog = this.linesProgram;
    const uniforms = this.linesUniforms;
    const attrs = this.linesAttributes;
    if (!prog || !uniforms || !attrs) return;

    gl.useProgram(prog);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    if (uniforms.projection && projectionMatrix) {
      gl.uniformMatrix4fv(uniforms.projection, false, projectionMatrix);
    }
    if (uniforms.view && viewMatrix) {
      gl.uniformMatrix4fv(uniforms.view, false, viewMatrix);
    }

    for (const obj of objects) {
      if (!obj.isReady()) continue;
      const model = obj.getModelMatrix();
      if (uniforms.model) {
        gl.uniformMatrix4fv(uniforms.model, false, model);
      }

      gl.enableVertexAttribArray(attrs.position);
      gl.enableVertexAttribArray(attrs.color);
      const buf = obj.positionBuffer;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.vertexAttribPointer(attrs.position, 3, gl.FLOAT, false, 24, 0);
      gl.vertexAttribPointer(attrs.color, 3, gl.FLOAT, false, 24, 12);
      gl.drawArrays(gl.LINES, 0, obj.linesVertexCount);
    }

    gl.disableVertexAttribArray(attrs.color);
    gl.disableVertexAttribArray(attrs.position);
  }


  /**
   * 清理资源
   */
  dispose() {
    const gl = this.gl;
    
    // 清理坐标轴网格渲染器
    if (this.axisGridRenderer && this.axisGridRenderer.cleanup) {
      this.axisGridRenderer.cleanup();
      this.axisGridRenderer = null;
    }

    // 清理深度可视化渲染器
    if (this.depthVisualizationRenderer) {
      this.depthVisualizationRenderer.dispose();
      this.depthVisualizationRenderer = null;
    }

    // 清理顶点缓冲区
    if (this.vertexBuffer && gl) {
      gl.deleteBuffer(this.vertexBuffer);
      this.vertexBuffer = null;
    }

    // 清理默认纹理
    if (this.defaultTexture && gl) {
      gl.deleteTexture(this.defaultTexture);
      this.defaultTexture = null;
    }

    // 清空对象列表
    this.clearObjects();
  }
}



