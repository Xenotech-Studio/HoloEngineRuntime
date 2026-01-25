import { useEffect, useRef, useState } from 'react';
import { createShader, createProgram } from '../core/utils/webgl';
import { vertexShaderSource, fragmentShaderSource } from '../shaders';
import { meshVertexShaderSource, meshFragmentShaderSource } from '../shaders/meshShaders';
import { vertexShader3DGSSource, fragmentShader3DGSSource } from '../shaders/gaussian3dShaders';

/**
 * WebGL 上下文和程序管理 Hook
 */
export function useWebGL(canvasRef, options = {}) {
  const [gl, setGl] = useState(null);
  const [program, setProgram] = useState(null);  // 4DGS program
  const [program3DGS, setProgram3DGS] = useState(null);  // 3DGS program
  const [meshProgram, setMeshProgram] = useState(null);
  const [error, setError] = useState(null);
  const uniformsRef = useRef({});
  const attributesRef = useRef({});
  const uniforms3DGSRef = useRef({});
  const attributes3DGSRef = useRef({});
  const meshUniformsRef = useRef({});
  const meshAttributesRef = useRef({});

  useEffect(() => {
    if (!canvasRef.current) return;

    try {
      const canvas = canvasRef.current;
      const contextOptions = {
        antialias: options.antialias ?? false,
        xrCompatible: options.xrCompatible ?? false,
        depth: true,  // 启用深度缓冲区，用于绘制坐标轴和网格
        stencil: true,  // 启用stencil缓冲区，用于区分不同的高斯点云
        ...options
      };

      const glContext = canvas.getContext('webgl2', contextOptions);
      if (!glContext) {
        throw new Error('WebGL2 not supported');
      }

      // 创建 shaders
      const vertexShader = createShader(glContext, glContext.VERTEX_SHADER, vertexShaderSource);
      const fragmentShader = createShader(glContext, glContext.FRAGMENT_SHADER, fragmentShaderSource);
      
      // 检查着色器编译状态
      if (!glContext.getShaderParameter(vertexShader, glContext.COMPILE_STATUS)) {
        const info = glContext.getShaderInfoLog(vertexShader);
        console.error('[useWebGL] 顶点着色器编译失败:', info);
      } else {
      }
      if (!glContext.getShaderParameter(fragmentShader, glContext.COMPILE_STATUS)) {
        const info = glContext.getShaderInfoLog(fragmentShader);
        console.error('[useWebGL] 片段着色器编译失败:', info);
      } else {
      }
      
      // 创建 splat program
      const shaderProgram = createProgram(glContext, vertexShader, fragmentShader);
      if (!glContext.getProgramParameter(shaderProgram, glContext.LINK_STATUS)) {
        const info = glContext.getProgramInfoLog(shaderProgram);
        console.error('[useWebGL] Splat Program 链接失败:', info);
      }
      glContext.useProgram(shaderProgram);

      // 创建 mesh shaders
      const meshVertexShader = createShader(glContext, glContext.VERTEX_SHADER, meshVertexShaderSource);
      const meshFragmentShader = createShader(glContext, glContext.FRAGMENT_SHADER, meshFragmentShaderSource);
      
      // 检查 mesh 着色器编译状态
      if (!glContext.getShaderParameter(meshVertexShader, glContext.COMPILE_STATUS)) {
        const info = glContext.getShaderInfoLog(meshVertexShader);
        console.error('[useWebGL] Mesh 顶点着色器编译失败:', info);
      }
      if (!glContext.getShaderParameter(meshFragmentShader, glContext.COMPILE_STATUS)) {
        const info = glContext.getShaderInfoLog(meshFragmentShader);
        console.error('[useWebGL] Mesh 片段着色器编译失败:', info);
      }
      
      // 创建 mesh program
      const meshShaderProgram = createProgram(glContext, meshVertexShader, meshFragmentShader);
      if (!glContext.getProgramParameter(meshShaderProgram, glContext.LINK_STATUS)) {
        const info = glContext.getProgramInfoLog(meshShaderProgram);
        console.error('[useWebGL] Mesh Program 链接失败:', info);
      }

      // 创建 3DGS shaders
      const vertexShader3DGS = createShader(glContext, glContext.VERTEX_SHADER, vertexShader3DGSSource);
      const fragmentShader3DGS = createShader(glContext, glContext.FRAGMENT_SHADER, fragmentShader3DGSSource);
      
      // 检查 3DGS 着色器编译状态
      if (!glContext.getShaderParameter(vertexShader3DGS, glContext.COMPILE_STATUS)) {
        const info = glContext.getShaderInfoLog(vertexShader3DGS);
        console.error('[useWebGL] 3DGS 顶点着色器编译失败:', info);
      }
      if (!glContext.getShaderParameter(fragmentShader3DGS, glContext.COMPILE_STATUS)) {
        const info = glContext.getShaderInfoLog(fragmentShader3DGS);
        console.error('[useWebGL] 3DGS 片段着色器编译失败:', info);
      }
      
      // 创建 3DGS program
      const shaderProgram3DGS = createProgram(glContext, vertexShader3DGS, fragmentShader3DGS);
      if (!glContext.getProgramParameter(shaderProgram3DGS, glContext.LINK_STATUS)) {
        const info = glContext.getProgramInfoLog(shaderProgram3DGS);
        console.error('[useWebGL] 3DGS Program 链接失败:', info);
      }

      // 设置 WebGL 状态
      glContext.disable(glContext.DEPTH_TEST);
      glContext.enable(glContext.BLEND);
      // 使用预乘 alpha blending (ONE, ONE_MINUS_SRC_ALPHA)
      // 因为片段着色器输出的是预乘 alpha：fragColor = vec4(B * vColor.rgb, B)
      // 配合 back-to-front 排序，实现标准的半透明渲染
      glContext.blendFuncSeparate(
        glContext.ONE,
        glContext.ONE_MINUS_SRC_ALPHA,
        glContext.ONE,
        glContext.ONE_MINUS_SRC_ALPHA
      );
      glContext.blendEquationSeparate(glContext.FUNC_ADD, glContext.FUNC_ADD);
      
      // 设置清除颜色为黑色（与原始代码一致）
      // 注意：原始代码没有显式设置 clearColor，使用默认值 (0, 0, 0, 0)
      glContext.clearColor(0, 0, 0, 0);

      // 获取 uniform 和 attribute 位置
      uniformsRef.current = {
        projection: glContext.getUniformLocation(shaderProgram, 'projection'),
        viewport: glContext.getUniformLocation(shaderProgram, 'viewport'),
        focal: glContext.getUniformLocation(shaderProgram, 'focal'),
        view: glContext.getUniformLocation(shaderProgram, 'view'),
        model: glContext.getUniformLocation(shaderProgram, 'model'),
        time: glContext.getUniformLocation(shaderProgram, 'time'),
        texture: glContext.getUniformLocation(shaderProgram, 'u_texture'),
        depthOpacityThreshold: glContext.getUniformLocation(shaderProgram, 'depthOpacityThreshold'),
        centerOpacityThreshold: glContext.getUniformLocation(shaderProgram, 'centerOpacityThreshold'),
        depthWriteOnly: glContext.getUniformLocation(shaderProgram, 'depthWriteOnly'),
      };

      attributesRef.current = {
        position: glContext.getAttribLocation(shaderProgram, 'position'),
        index: glContext.getAttribLocation(shaderProgram, 'index'),
      };

      // 获取 3DGS uniform 和 attribute 位置
      glContext.useProgram(shaderProgram3DGS);
      uniforms3DGSRef.current = {
        projection: glContext.getUniformLocation(shaderProgram3DGS, 'projection'),
        viewport: glContext.getUniformLocation(shaderProgram3DGS, 'viewport'),
        focal: glContext.getUniformLocation(shaderProgram3DGS, 'focal'),
        view: glContext.getUniformLocation(shaderProgram3DGS, 'view'),
        model: glContext.getUniformLocation(shaderProgram3DGS, 'model'),
        texture: glContext.getUniformLocation(shaderProgram3DGS, 'u_texture'),
        shTexture: glContext.getUniformLocation(shaderProgram3DGS, 'u_shTexture'),
        sphericalHarmonicsDegree: glContext.getUniformLocation(shaderProgram3DGS, 'sphericalHarmonicsDegree'),
        depthOpacityThreshold: glContext.getUniformLocation(shaderProgram3DGS, 'depthOpacityThreshold'),
        centerOpacityThreshold: glContext.getUniformLocation(shaderProgram3DGS, 'centerOpacityThreshold'),
        depthWriteOnly: glContext.getUniformLocation(shaderProgram3DGS, 'depthWriteOnly'),
      };

      attributes3DGSRef.current = {
        position: glContext.getAttribLocation(shaderProgram3DGS, 'position'),
        index: glContext.getAttribLocation(shaderProgram3DGS, 'index'),
      };

      // 获取 mesh uniform 和 attribute 位置
      glContext.useProgram(meshShaderProgram);
      meshUniformsRef.current = {
        projection: glContext.getUniformLocation(meshShaderProgram, 'projection'),
        view: glContext.getUniformLocation(meshShaderProgram, 'view'),
        model: glContext.getUniformLocation(meshShaderProgram, 'model'),
        color: glContext.getUniformLocation(meshShaderProgram, 'color'),
        diffuseTexture: glContext.getUniformLocation(meshShaderProgram, 'diffuseTexture'),
        useTexture: glContext.getUniformLocation(meshShaderProgram, 'useTexture'),
        lightDirection: glContext.getUniformLocation(meshShaderProgram, 'lightDirection'),
        lightColor: glContext.getUniformLocation(meshShaderProgram, 'lightColor'),
        lightIntensity: glContext.getUniformLocation(meshShaderProgram, 'lightIntensity'),
        ambientIntensity: glContext.getUniformLocation(meshShaderProgram, 'ambientIntensity'),
        debugMode: glContext.getUniformLocation(meshShaderProgram, 'debugMode'),
      };

      const positionLoc = glContext.getAttribLocation(meshShaderProgram, 'position');
      const normalLoc = glContext.getAttribLocation(meshShaderProgram, 'normal');
      const uvLoc = glContext.getAttribLocation(meshShaderProgram, 'uv');
      
      // 验证属性location是否正确获取
      if (positionLoc < 0) {
        console.warn('[useWebGL] 警告：position 属性 location 获取失败！');
      }
      if (normalLoc < 0) {
        console.error('[useWebGL] 错误：normal 属性 location 获取失败！这会导致法线数据无法正确传递！');
      }
      if (uvLoc < 0) {
        console.warn('[useWebGL] 警告：uv 属性 location 获取失败！');
      }
      
      
      meshAttributesRef.current = {
        position: positionLoc,
        normal: normalLoc,
        uv: uvLoc,
      };

      // 切换回 splat program
      glContext.useProgram(shaderProgram);

      // 设置顶点缓冲区
      const triangleVertices = new Float32Array([-2, -2, 2, -2, 2, 2, -2, 2]);
      const vertexBuffer = glContext.createBuffer();
      glContext.bindBuffer(glContext.ARRAY_BUFFER, vertexBuffer);
      glContext.bufferData(glContext.ARRAY_BUFFER, triangleVertices, glContext.STATIC_DRAW);
      
      const aPosition = attributesRef.current.position;
      glContext.enableVertexAttribArray(aPosition);
      glContext.bindBuffer(glContext.ARRAY_BUFFER, vertexBuffer);
      glContext.vertexAttribPointer(aPosition, 2, glContext.FLOAT, false, 0, 0);

      // 设置索引缓冲区
      const indexBuffer = glContext.createBuffer();
      const aIndex = attributesRef.current.index;
      glContext.enableVertexAttribArray(aIndex);
      glContext.bindBuffer(glContext.ARRAY_BUFFER, indexBuffer);
      glContext.vertexAttribIPointer(aIndex, 1, glContext.INT, false, 0, 0);
      glContext.vertexAttribDivisor(aIndex, 1);

      // 设置纹理
      const texture = glContext.createTexture();
      glContext.bindTexture(glContext.TEXTURE_2D, texture);
      glContext.uniform1i(uniformsRef.current.texture, 0);

      setGl(glContext);
      setProgram(shaderProgram);
      setProgram3DGS(shaderProgram3DGS);
      setMeshProgram(meshShaderProgram);
      setError(null);

      return () => {
        // 清理资源
        if (vertexShader) glContext.deleteShader(vertexShader);
        if (fragmentShader) glContext.deleteShader(fragmentShader);
        if (shaderProgram) glContext.deleteProgram(shaderProgram);
        if (vertexShader3DGS) glContext.deleteShader(vertexShader3DGS);
        if (fragmentShader3DGS) glContext.deleteShader(fragmentShader3DGS);
        if (shaderProgram3DGS) glContext.deleteProgram(shaderProgram3DGS);
        if (meshVertexShader) glContext.deleteShader(meshVertexShader);
        if (meshFragmentShader) glContext.deleteShader(meshFragmentShader);
        if (meshShaderProgram) glContext.deleteProgram(meshShaderProgram);
        if (vertexBuffer) glContext.deleteBuffer(vertexBuffer);
        if (indexBuffer) glContext.deleteBuffer(indexBuffer);
        if (texture) glContext.deleteTexture(texture);
      };
    } catch (err) {
      console.error('WebGL initialization error:', err);
      setError(err);
    }
  }, [canvasRef, options.antialias, options.xrCompatible]);

  return {
    gl,
    program,  // 4DGS program
    program3DGS,  // 3DGS program
    meshProgram,
    uniforms: uniformsRef.current,
    attributes: attributesRef.current,
    uniforms3DGS: uniforms3DGSRef.current,
    attributes3DGS: attributes3DGSRef.current,
    meshUniforms: meshUniformsRef.current,
    meshAttributes: meshAttributesRef.current,
    error
  };
}


