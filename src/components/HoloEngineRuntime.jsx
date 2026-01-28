import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { useWebGL } from '../hooks/useWebGL';
import { useSplatLoader } from '../hooks/useSplatLoader';
import { useFpsCameraControl } from '../hooks/useFpsCameraControl';
import { useOrbitCameraControl } from '../hooks/useOrbitCameraControl';
import { loadAndSetupSplatObject } from '../utils/splatObjectLoader';
import { loadAndSetupMeshObject } from '../utils/meshLoader';
import { getViewMatrix, createTransformMatrix, getProjectionMatrix, calculateDynamicFocal, multiply4, getGLErrorName } from '../core/utils/webgl';
import { Camera } from '../core/utils/Camera';
import { initAxisGridRenderer } from '../core/utils/axisGridRenderer';
import { SceneManager } from '../utils/sceneManager';
import { HoloRP, RenderableObject, RenderType } from '../core/utils/holoRP';
import { CanvasRenderTarget } from '../core/utils/renderTarget';

/**
 * Holo Engine 运行时
 * 负责编辑器场景窗口的渲染，支持多对象场景管理
 */
export default function HoloEngineRuntime({ 
  canvasRef, 
  sceneManager, // SceneManager 实例
  camera,
  onLoadComplete,
  onError,
  skipFileCameraInit = true,
  onViewMatrixRefReady = null,
  onCameraRefReady = null,
  disableLeftMouseButton = false,
  sceneVersion = 0, // 场景版本号，用于触发重新加载
  targetVerticalFOV = null, // 目标垂直 FOV（角度），如果提供则根据 canvas 高度动态计算 fy
  meshDebugMode = 0, // Mesh 调试模式：0=法线颜色, 1=位置颜色, 2=法线长度, 3=法线-位置差异
  selectedObjectId = null, // 选中的对象ID，用于计算距离以调整移动速度
  cameraSpeedMultiplier = 0.5, // 相机移动速度倍率（由 EditorViewer 计算）
  cameraMode = 'fly', // 相机模式：'fly' (FPS) 或 'orbit'，默认 'fly'（向前兼容）
  showDepthVisualization = false, // 是否显示深度可视化
  depthRange = 30.0, // 深度范围（米），用于调整颜色渐变的最远距离
  depthRangeNear = 10.0, // 近处深度范围（米），用于调整颜色渐变的起始距离
  depthGamma = 1.5, // Gamma 值，用于调整映射曲线的非线性程度
  depthOpacityThreshold = 0.13, // 深度写入的像素不透明度阈值（0.0-1.0）
  centerOpacityThreshold = 0.65 // 深度写入的中心点不透明度阈值（0.0-1.0）
}) {
  // 移除调试日志 - 功能已正常工作
  
  const { gl, program, program3DGS, meshProgram, programPointCloud, programLines, uniforms, attributes, uniforms3DGS, attributes3DGS, meshUniforms, meshAttributes, pointCloudUniforms, pointCloudAttributes, linesUniforms, linesAttributes, error: webGLError } = useWebGL(canvasRef, { antialias: false });
  
  const animationFrameRef = useRef(null);
  const renderPipelineRef = useRef(null);
  const renderTargetRef = useRef(null);
  
  useEffect(() => {
    if (!gl || !program || !uniforms || !attributes || !canvasRef.current) return;
    
    const extendedOptions = {};
    if (programPointCloud && pointCloudUniforms && pointCloudAttributes) {
      extendedOptions.pointCloudProgram = programPointCloud;
      extendedOptions.pointCloudUniforms = pointCloudUniforms;
      extendedOptions.pointCloudAttributes = pointCloudAttributes;
    }
    if (programLines && linesUniforms && linesAttributes) {
      extendedOptions.linesProgram = programLines;
      extendedOptions.linesUniforms = linesUniforms;
      extendedOptions.linesAttributes = linesAttributes;
    }
    const pipeline = new HoloRP(
      gl, program, program3DGS, meshProgram || program,
      uniforms, uniforms3DGS, meshUniforms || uniforms,
      attributes, attributes3DGS, meshAttributes || attributes,
      extendedOptions
    );
    pipeline.initAxisGrid(initAxisGridRenderer);
    renderPipelineRef.current = pipeline;
    
    // 创建 Canvas 渲染目标
    const renderTarget = new CanvasRenderTarget(canvasRef.current, gl);
    renderTargetRef.current = renderTarget;
    
    return () => {
      if (renderPipelineRef.current) {
        renderPipelineRef.current.dispose();
        renderPipelineRef.current = null;
      }
      if (renderTargetRef.current) {
        renderTargetRef.current.dispose();
        renderTargetRef.current = null;
      }
    };
  }, [gl, program, program3DGS, meshProgram, programPointCloud, programLines, uniforms, attributes, uniforms3DGS, attributes3DGS, meshUniforms, meshAttributes, pointCloudUniforms, pointCloudAttributes, linesUniforms, linesAttributes]);

  // 单独更新 FOV（不重新创建渲染管线）
  // FOV 仅存在 Camera.targetVerticalFOV；HoloRP 用其 projectionMatrix getter
  useEffect(() => {
    if (cameraRef.current && cameraRef.current instanceof Camera) {
      cameraRef.current.targetVerticalFOV = targetVerticalFOV;
    }
  }, [targetVerticalFOV]);

  // 单独更新 Mesh 调试模式（不重新创建渲染管线）
  useEffect(() => {
    if (renderPipelineRef.current) {
      renderPipelineRef.current.setMeshDebugMode(meshDebugMode);
    }
  }, [meshDebugMode]);

  // 单独更新深度可视化设置（不重新创建渲染管线）
  useEffect(() => {
    if (renderPipelineRef.current) {
      renderPipelineRef.current.setShowDepthVisualization(showDepthVisualization);
    }
  }, [showDepthVisualization]);

  // 单独更新深度范围（不重新创建渲染管线）
  useEffect(() => {
    if (renderPipelineRef.current) {
      renderPipelineRef.current.setDepthRange(depthRange);
    }
  }, [depthRange]);

  // 单独更新近处深度范围（不重新创建渲染管线）
  useEffect(() => {
    if (renderPipelineRef.current) {
      renderPipelineRef.current.setDepthRangeNear(depthRangeNear);
    }
  }, [depthRangeNear]);

  // 单独更新深度 Gamma（不重新创建渲染管线）
  useEffect(() => {
    if (renderPipelineRef.current) {
      renderPipelineRef.current.setDepthGamma(depthGamma);
    }
  }, [depthGamma]);

  // 设置深度写入的不透明度阈值
  useEffect(() => {
    if (renderPipelineRef.current) {
      renderPipelineRef.current.setDepthOpacityThreshold(depthOpacityThreshold);
    }
  }, [depthOpacityThreshold]);

  useEffect(() => {
    if (renderPipelineRef.current) {
      renderPipelineRef.current.setCenterOpacityThreshold(centerOpacityThreshold);
    }
  }, [centerOpacityThreshold]);

  // 获取默认相机（使用 Camera 类）
  const getDefaultCamera = useCallback(() => {
    return new Camera({
      id: 0,
      width: 1920,
      height: 1080,
      position: [0, 0, 15],  // 默认位置稍微向后，便于观察
      yawRad: 0,
      pitchRad: 0,
      forwardHorizontalRef: [0, 0, 1],
      worldUp: [0, 1, 0],
      fx: 1000,
      fy: 1000,
      targetVerticalFOV: targetVerticalFOV,
    });
  }, [targetVerticalFOV]);


  // 将外部传入的 camera 转换为 Camera 实例（如果是普通对象）
  const normalizedCamera = useMemo(() => {
    if (!camera) return null;
    // 如果已经是 Camera 实例，直接返回
    if (camera instanceof Camera) {
      return camera;
    }
    // 如果是普通对象，转换为 Camera 实例
    return Camera.fromPlainObject(camera);
  }, [camera]);

  const initialViewMatrix = useMemo(() => {
    if (skipFileCameraInit) {
      const defaultCamera = getDefaultCamera();
      return defaultCamera.viewMatrix;
    } else if (normalizedCamera) {
      return normalizedCamera.viewMatrix;
    }
    return [0.99, 0.01, -0.14, 0, 0.02, 0.99, 0.12, 0, 0.14, -0.12, 0.98, 0, -0.09, -0.26, 0.2, 1];
  }, [skipFileCameraInit, normalizedCamera, getDefaultCamera]);
  
  const viewMatrixRef = useRef(initialViewMatrix);
  
  // 初始化 viewMatrixRef
  useEffect(() => {
    if (skipFileCameraInit) {
      if (!viewMatrixRef.current || viewMatrixRef.current.length !== 16) {
        const defaultCamera = getDefaultCamera();
        viewMatrixRef.current = defaultCamera.viewMatrix;
      }
    } else if (normalizedCamera) {
      if (!viewMatrixRef.current || viewMatrixRef.current.length !== 16) {
        viewMatrixRef.current = normalizedCamera.viewMatrix;
      }
    }
    
    if (onViewMatrixRefReady && viewMatrixRef.current) {
      onViewMatrixRefReady(viewMatrixRef);
    }
  }, [skipFileCameraInit, normalizedCamera, getDefaultCamera, onViewMatrixRefReady]);
  
  // 相机控制相关的 refs（确保都是 Camera 实例）
  const initialCameraRefValue = skipFileCameraInit 
    ? getDefaultCamera() 
    : (normalizedCamera || getDefaultCamera());
  const cameraRef = useRef(initialCameraRefValue);
  const camerasRef = useRef([initialCameraRefValue]);
  const [camerasVersion, setCamerasVersion] = useState(0);
  const camerasVersionBump = () => {
    setCamerasVersion((v) => v + 1);
  };
  
  const cameraInitializedRef = useRef(false);
  
  useEffect(() => {
    if (!cameraInitializedRef.current) {
      if (skipFileCameraInit) {
        if (!viewMatrixRef.current || viewMatrixRef.current.length !== 16) {
          const defaultCamera = getDefaultCamera();
          cameraRef.current = defaultCamera;
          camerasRef.current = [defaultCamera];
          viewMatrixRef.current = defaultCamera.viewMatrix;
          camerasVersionBump();
        }
      } else {
        if (!cameraRef.current) {
          cameraRef.current = normalizedCamera || getDefaultCamera();
        }
      }
      cameraInitializedRef.current = true;
    }

    // 确保 cameraRef.current 始终是 Camera 实例
    if (cameraRef.current && !(cameraRef.current instanceof Camera)) {
      try {
        cameraRef.current = Camera.fromPlainObject(cameraRef.current);
        // 同时更新 camerasRef
        if (camerasRef.current && camerasRef.current.length > 0) {
          const index = camerasRef.current.findIndex(cam => cam === cameraRef.current || (cam && !(cam instanceof Camera)));
          if (index >= 0) {
            camerasRef.current[index] = cameraRef.current;
          }
        }
      } catch (error) {
        console.error('[HoloEngineRuntime] Failed to convert camera to Camera instance:', error);
        // 如果转换失败，使用默认相机
        cameraRef.current = getDefaultCamera();
      }
    }
    
    if (onCameraRefReady && cameraRef.current && cameraInitializedRef.current) {
      onCameraRefReady(cameraRef);
    }
  }, [normalizedCamera, skipFileCameraInit, getDefaultCamera, onCameraRefReady]);
  
  // 集成相机控制 - 直接使用对应的相机控制 hook
  const isOrbitMode = cameraMode === 'orbit';
  
  const fpsControls = useFpsCameraControl(
    canvasRef,
    viewMatrixRef,
    cameraRef,
    camerasRef,
    (newViewMatrix) => {
      if (newViewMatrix && newViewMatrix.length === 16) {
        viewMatrixRef.current = newViewMatrix;
      }
    },
    (nextCamera) => {
      if (nextCamera) {
        cameraRef.current = nextCamera;
      }
    },
    camerasVersion,
    null, // worldUpPitchAdjust
    null, // onNotifyUserInput
    disableLeftMouseButton,
    cameraSpeedMultiplier, // 相机移动速度倍率（由 EditorViewer 计算）
    !isOrbitMode // enabled: 只在非 Orbit 模式时启用
  );
  
  const orbitControls = useOrbitCameraControl(
    canvasRef,
    viewMatrixRef,
    cameraRef,
    camerasRef,
    (newViewMatrix) => {
      if (newViewMatrix && newViewMatrix.length === 16) {
        viewMatrixRef.current = newViewMatrix;
      }
    },
    (nextCamera) => {
      if (nextCamera) {
        cameraRef.current = nextCamera;
      }
    },
    camerasVersion,
    null, // worldUpPitchAdjust
    null, // onNotifyUserInput
    disableLeftMouseButton,
    cameraSpeedMultiplier, // 相机移动速度倍率（由 EditorViewer 计算）
    isOrbitMode // enabled: 只在 Orbit 模式时启用
  );
  
  const { updateCameraFromInput } = isOrbitMode ? orbitControls : fpsControls;

  // 加载所有场景对象相关的 refs
  const loadingRef = useRef(new Set());
  const workerReadyRef = useRef(new Map()); // 跟踪每个对象的Worker是否完成第一次深度排序
  const loadCompleteCheckRef = useRef(null); // 用于延迟检查加载完成
  
  // 使用 ref 跟踪上次的场景版本，以便检测变化
  const lastSceneVersionRef = useRef(sceneVersion);
  
  // 同步场景对象到渲染管线的辅助函数
  const syncObjectToPipeline = useCallback((sceneObj, pipeline, workerReadyRef) => {
    let renderObj = pipeline.getObject(sceneObj.id);
    
    if (!renderObj) {
      // 创建新的渲染对象
      renderObj = new RenderableObject(sceneObj.id);
      pipeline.addObject(renderObj);
    }
    
    // 更新渲染对象的资源（如果场景对象已加载）
    if (sceneObj.loaded) {
      // 根据asset的type字段判断类型（优先），如果没有type则根据文件扩展名推断
      let objType = sceneObj.type;
      if (!objType) {
        // 向后兼容：根据文件扩展名推断
        if (sceneObj.modelUrl && (sceneObj.modelUrl.endsWith('.obj') || sceneObj.modelUrl.endsWith('.OBJ'))) {
          objType = 'mesh';
        } else if (sceneObj.modelUrl && (sceneObj.modelUrl.endsWith('.ply') || sceneObj.modelUrl.endsWith('.PLY'))) {
          objType = '3dgs';
        } else {
          objType = '4dgs';
        }
      }
      
      if (objType === 'mesh') {
        // Mesh 对象
        renderObj.renderType = RenderType.MESH;
        renderObj.vertexBuffer = sceneObj.vertexBuffer;
        renderObj.elementBuffer = sceneObj.elementBuffer;
        renderObj.elementCount = sceneObj.elementCount || 0;
        renderObj.vertexAttributes = sceneObj.vertexAttributes;
        // 清除 splat 相关属性，避免混淆
        renderObj.texture = null;
        renderObj.indexBuffer = null;
        renderObj.vertexCount = 0;
        renderObj.worker = null;
      } else if (objType === '3dgs') {
        // 3DGS 对象
        renderObj.renderType = RenderType['3DGS'];
        renderObj.texture = sceneObj.texture;
        renderObj.indexBuffer = sceneObj.indexBuffer;
        renderObj.vertexCount = sceneObj.vertexCount || 0;
        renderObj.worker = sceneObj.worker;
        renderObj.shTexture = sceneObj.shTexture;
        renderObj.sphericalHarmonicsDegree = sceneObj.sphericalHarmonicsDegree || 0;
        // 清除 mesh 相关属性，避免混淆
        renderObj.vertexBuffer = null;
        renderObj.elementBuffer = null;
        renderObj.elementCount = 0;
        renderObj.vertexAttributes = null;
      } else {
        // 4DGS 对象（默认）
        renderObj.renderType = RenderType['4DGS'];
        renderObj.texture = sceneObj.texture;
        renderObj.indexBuffer = sceneObj.indexBuffer;
        renderObj.vertexCount = sceneObj.vertexCount || 0;
        renderObj.worker = sceneObj.worker;
        // 清除 mesh 相关属性，避免混淆
        renderObj.vertexBuffer = null;
        renderObj.elementBuffer = null;
        renderObj.elementCount = 0;
        renderObj.vertexAttributes = null;
      }
      
      // 计算模型矩阵（每次更新，因为位置/旋转/缩放可能变化）
      if (sceneObj.position && sceneObj.rotation && sceneObj.scale) {
        const rotationRad = sceneObj.rotation.map(deg => (deg * Math.PI) / 180);
        renderObj.modelMatrix = createTransformMatrix(sceneObj.position, rotationRad, sceneObj.scale);
      }
      
      // 检查是否准备好渲染
      if (objType === 'mesh') {
        // Mesh 对象不需要 Worker，直接标记为就绪
        renderObj.ready = true;
      } else {
        // Splat 对象需要 Worker 完成第一次深度排序
        if (sceneObj.worker) {
          const workerReady = workerReadyRef.current.get(sceneObj.id);
          renderObj.ready = workerReady === true;
        } else {
          renderObj.ready = true; // 没有 Worker 的对象认为已就绪
        }
      }
    } else {
      // 场景对象未加载，标记为未就绪
      renderObj.ready = false;
    }
  }, []);
  
  // 同步场景对象到渲染管线
  useEffect(() => {
    if (!renderPipelineRef.current || !sceneManager) {
      return;
    }
    
    const pipeline = renderPipelineRef.current;
    const sceneObjects = sceneManager.getAllObjects();
    
    // 获取当前渲染管线中的对象 ID
    const pipelineObjectIds = new Set(pipeline.getAllObjects().map(obj => obj.id));
    const sceneObjectIds = new Set(sceneObjects.map(obj => obj.id));
    
    // 移除不在场景中的对象
    pipelineObjectIds.forEach(id => {
      if (!sceneObjectIds.has(id)) {
        pipeline.removeObject(id);
      }
    });
    
    // 添加或更新场景中的对象
    sceneObjects.forEach(sceneObj => {
      syncObjectToPipeline(sceneObj, pipeline, workerReadyRef);
    });
  }, [sceneManager, sceneVersion, syncObjectToPipeline]);

  // 加载所有场景对象
  const { loadSplatFile } = useSplatLoader();
  
  // 检查所有对象是否真正加载完成
  const checkAllLoaded = useCallback(() => {
    if (!gl || !sceneManager) return;
    
    const objects = sceneManager.getAllObjects();
    
    // 检查条件：
    // 1. 没有对象正在加载中
    // 2. 所有对象都已标记为loaded
    // 3. 所有对象的Worker都完成了第一次深度排序
    const noLoading = loadingRef.current.size === 0;
    const allLoaded = objects.length === 0 || objects.every(obj => obj.loaded);
    const allWorkersReady = objects.length === 0 || objects.every(obj => {
      if (!obj.loaded) return false;
      // 如果有Worker，检查是否完成第一次深度排序
      if (obj.worker) {
        return workerReadyRef.current.get(obj.id) === true;
      }
      // 没有Worker的对象认为已就绪
      return true;
    });
    
    if (noLoading && allLoaded && allWorkersReady && onLoadComplete) {
      // 延迟一小段时间确保所有资源都已就绪
      if (loadCompleteCheckRef.current) {
        clearTimeout(loadCompleteCheckRef.current);
      }
      loadCompleteCheckRef.current = setTimeout(() => {
        onLoadComplete();
        loadCompleteCheckRef.current = null;
      }, 100); // 100ms延迟确保所有异步操作完成
    }
  }, [gl, sceneManager, onLoadComplete]);
  
  useEffect(() => {
    if (!gl || !sceneManager) return;
    
    const loadAllObjects = async () => {
      const objects = sceneManager.getAllObjects();
      
      // 如果场景版本变化，只重置未加载对象的加载状态
      // 对于已经加载的对象，保留它们的workerReadyRef状态，这样它们可以继续渲染
      if (sceneVersion !== lastSceneVersionRef.current) {
        lastSceneVersionRef.current = sceneVersion;
        objects.forEach(obj => {
          if (obj.loaded) {
            // 已经加载的对象，如果worker还在工作，说明已经完成第一次深度排序
            // 保留或重新设置workerReadyRef状态，确保可以继续渲染
            if (obj.worker) {
              // 如果worker存在且对象已加载，说明已经完成初始化，设置为就绪
              if (!workerReadyRef.current.has(obj.id)) {
                workerReadyRef.current.set(obj.id, true);
                // 立即更新渲染对象的 ready 状态
                if (renderPipelineRef.current) {
                  const renderObj = renderPipelineRef.current.getObject(obj.id);
                  if (renderObj) {
                    renderObj.ready = true;
                  }
                }
              }
            } else {
              // 没有worker的对象，不需要workerReadyRef状态
              workerReadyRef.current.delete(obj.id);
            }
          } else {
            // 未加载的对象，重置加载状态
            obj.loading = false;
            workerReadyRef.current.delete(obj.id);
          }
        });
        // 只清除正在加载的对象
        loadingRef.current.forEach(id => {
          const obj = objects.find(o => o.id === id);
          if (!obj || !obj.loaded) {
            loadingRef.current.delete(id);
          }
        });
      }
      
      for (const obj of objects) {
        if (obj.loaded || obj.loading) continue;
        
        obj.loading = true;
        loadingRef.current.add(obj.id);
        workerReadyRef.current.set(obj.id, false); // 初始状态：Worker未就绪
        
        try {
          // 根据asset的type字段判断类型（优先），如果没有type则根据文件扩展名推断
          let objType = obj.type;
          if (!objType) {
            // 向后兼容：根据文件扩展名推断
            if (obj.modelUrl && (obj.modelUrl.endsWith('.obj') || obj.modelUrl.endsWith('.OBJ'))) {
              objType = 'mesh';
            } else if (obj.modelUrl && (obj.modelUrl.endsWith('.ply') || obj.modelUrl.endsWith('.PLY'))) {
              objType = '3dgs'; // PLY文件默认为3DGS
            } else {
              objType = '4dgs'; // 默认4DGS（.splatv格式）
            }
          }
          
          if (objType === 'mesh') {
            // 加载 mesh 对象
            if (gl) {
              await loadAndSetupMeshObject({
                gl,
                objUrl: obj.modelUrl,
                targetObject: obj
              });
              
              obj.loaded = true;
              obj.loading = false;
              loadingRef.current.delete(obj.id);
              workerReadyRef.current.set(obj.id, true); // mesh 不需要 worker，直接标记为就绪
              
              console.log(`[HoloEngineRuntime] Mesh 加载完成: ${obj.id.substring(0, 8)}... (${obj.elementCount} 索引)`);
              
              // 立即同步到渲染管线
              if (renderPipelineRef.current) {
                syncObjectToPipeline(obj, renderPipelineRef.current, workerReadyRef);
              }
              
              checkAllLoaded();
            }
          } else if (objType === '3dgs') {
            // 加载 3DGS PLY 对象
            const { loadPlyFile } = await import('../hooks/usePlyLoader');
            const textureData = await loadPlyFile(obj.modelUrl);
            
            if (textureData && gl) {
              const { loadAndSetup3DGSObject } = await import('../utils/ply3dgsLoader');
              const { worker } = loadAndSetup3DGSObject({
                gl,
                textureData,
                targetObject: obj,
                onFirstDepthSort: (vertexCount) => {
                  workerReadyRef.current.set(obj.id, true);
                  console.log(`[HoloEngineRuntime] 3DGS Worker 第一次深度排序完成: ${obj.id.substring(0, 8)}... (${vertexCount} 顶点)`);
                  checkAllLoaded();
                },
                onWorkerError: (err) => {
                  console.error(`[HoloEngineRuntime] Worker 错误 (${obj.id}):`, err);
                },
                onWebGLError: (error, errorName) => {
                  console.error(`[HoloEngineRuntime] Worker 消息处理时 WebGL 错误:`, error, errorName);
                }
              });
              
              obj.loaded = true;
              obj.loading = false;
              loadingRef.current.delete(obj.id);
              
              // 打印3DGS加载统计信息
              const sourceVertexCount = textureData.vertices ? textureData.vertices.length : 0;
              const textureSize = `${textureData.width}x${textureData.height}`;
              const actualVertexCount = obj.vertexCount || 0;
              console.log(`[HoloEngineRuntime] 3DGS 加载完成: ${obj.id.substring(0, 8)}...`, {
                源文件总点数: sourceVertexCount,
                实际渲染点数: actualVertexCount,
                纹理尺寸: textureSize,
                SH阶数: obj.sphericalHarmonicsDegree || 0,
                纹理数据大小: `${(textureData.data.byteLength / 1024 / 1024).toFixed(2)} MB`
              });
              
              // 立即同步到渲染管线
              if (renderPipelineRef.current) {
                syncObjectToPipeline(obj, renderPipelineRef.current, workerReadyRef);
              }
              
              // 发送初始view矩阵到Worker
              if (gl && canvasRef.current && renderPipelineRef.current && viewMatrixRef.current && cameraRef.current) {
                const canvas = canvasRef.current;
                const canvasWidth = canvas.clientWidth || canvas.width || window.innerWidth;
                const canvasHeight = canvas.clientHeight || canvas.height || window.innerHeight;
                const activeCamera = cameraRef.current;
                
                // 更新相机的宽高（如果 canvas 尺寸变化）
                activeCamera.width = canvasWidth;
                activeCamera.height = canvasHeight;
                
                const projectionMatrix = activeCamera.projectionMatrix;
                const viewMatrix = activeCamera.viewMatrix;
                const currentModelMatrix = obj.getModelMatrix ? obj.getModelMatrix() : createTransformMatrix(obj.position, obj.rotation.map(deg => (deg * Math.PI) / 180), obj.scale);
                const viewProj = activeCamera.getViewProjModelMatrix(currentModelMatrix);
                
                if (viewProj && Array.isArray(viewProj) && viewProj.length >= 16 && obj.worker) {
                  obj.worker.postMessage({ view: viewProj });
                }
              }
              
              checkAllLoaded();
            }
          } else {
            // 加载 4DGS splat 对象（默认）
            const textureData = await loadSplatFile(obj.modelUrl, { color: [0, 0, 0], intensity: 0, tolerance: 0 });
            
            if (textureData && gl) {
              // 使用高度封装的工具函数加载splat对象
              const { worker } = loadAndSetupSplatObject({
                gl,
                textureData,
                targetObject: obj,
                onFirstDepthSort: (vertexCount) => {
                  // 第一次深度排序完成时的回调
                  workerReadyRef.current.set(obj.id, true);
                  
                  // 立即更新渲染对象的 ready 状态
                  if (renderPipelineRef.current) {
                    const renderObj = renderPipelineRef.current.getObject(obj.id);
                    if (renderObj) {
                      renderObj.ready = true;
                    }
                  }
                  
                  checkAllLoaded(); // 检查是否可以完成加载
                },
                onWorkerError: (err) => {
                  console.error(`[HoloEngineRuntime] Worker 错误 (${obj.id}):`, err);
                },
                onWebGLError: (error, errorName) => {
                  console.error(`[HoloEngineRuntime] Worker 消息处理时 WebGL 错误:`, error, errorName);
                }
              });
              
              obj.loaded = true;
              obj.loading = false;
              loadingRef.current.delete(obj.id);
              
              console.log(`[HoloEngineRuntime] 4DGS 加载完成: ${obj.id.substring(0, 8)}... (${obj.vertexCount} 顶点)`);
              
              // 立即同步到渲染管线
              if (renderPipelineRef.current) {
                syncObjectToPipeline(obj, renderPipelineRef.current, workerReadyRef);
              }
              
              // 发送初始视图投影矩阵到 Worker（相机相关，由组件自行管理）
              const canvas = canvasRef.current;
              const canvasWidth = canvas ? (canvas.clientWidth || canvas.width || window.innerWidth) : window.innerWidth;
              const canvasHeight = canvas ? (canvas.clientHeight || canvas.height || window.innerHeight) : window.innerHeight;
              const activeCamera = cameraRef.current || getDefaultCamera();
              
              // 更新相机的宽高（如果 canvas 尺寸变化）
              activeCamera.width = canvasWidth;
              activeCamera.height = canvasHeight;
              
              const modelMatrix = obj.getModelMatrix(createTransformMatrix);
              const viewProj = activeCamera.getViewProjModelMatrix(modelMatrix);
              worker.postMessage({ view: viewProj });
              
              // Worker的第一次深度排序完成后会通过onmessage回调标记为就绪
              // 这里不立即检查，等待Worker返回第一次深度排序结果
            }
          }
        } catch (err) {
          console.error(`[HoloEngineRuntime] 加载对象 ${obj.id} 失败:`, err);
          obj.loading = false;
          loadingRef.current.delete(obj.id);
          workerReadyRef.current.delete(obj.id);
          if (onError) {
            onError(err);
          }
          checkAllLoaded(); // 即使出错也要检查，避免永远显示loading
        }
      }
      
      // 如果没有对象需要加载，立即检查
      if (objects.length === 0 || objects.every(obj => obj.loaded || obj.loading === false)) {
        checkAllLoaded();
      }
    };
    
    loadAllObjects();
    
    // 清理函数
    return () => {
      if (loadCompleteCheckRef.current) {
        clearTimeout(loadCompleteCheckRef.current);
        loadCompleteCheckRef.current = null;
      }
    };
  }, [gl, sceneManager, loadSplatFile, getDefaultCamera, onLoadComplete, onError, sceneVersion, checkAllLoaded]);

  const lastFrameTimeRef = useRef(performance.now());

  // 渲染循环
  const render = useCallback(() => {
    if (!renderPipelineRef.current || !renderTargetRef.current || !sceneManager) {
      animationFrameRef.current = requestAnimationFrame(render);
      return;
    }
    
    // 获取hierarchy顺序的对象ID列表（确保按照SceneManager中的顺序渲染）
    const objectOrder = sceneManager.getAllObjects().map(obj => obj.id);
    
    const canvas = canvasRef.current;
    if (!canvas) {
      animationFrameRef.current = requestAnimationFrame(render);
      return;
    }

    // 更新相机输入（业务逻辑：用户交互）
    const now = performance.now();
    const deltaTime = (now - lastFrameTimeRef.current) / 1000;
    lastFrameTimeRef.current = now;
    updateCameraFromInput(deltaTime);

    // 更新渲染管线的视图矩阵和相机
    const pipeline = renderPipelineRef.current;
    if (cameraRef.current) {
      // 更新相机的 canvas 尺寸（如果变化）
      const canvasWidth = canvas.clientWidth || canvas.width || window.innerWidth;
      const canvasHeight = canvas.clientHeight || canvas.height || window.innerHeight;
      if (cameraRef.current.width !== canvasWidth || cameraRef.current.height !== canvasHeight) {
        cameraRef.current.width = canvasWidth;
        cameraRef.current.height = canvasHeight;
      }
      
      // 使用 Camera 类的 viewMatrix getter
      pipeline.setViewMatrix(cameraRef.current.viewMatrix);
      // 传递 Camera 实例；HoloRP 用其 projectionMatrix getter（含 targetVerticalFOV）
      pipeline.setCamera(cameraRef.current);
    }

    // 调用渲染管线进行渲染（使用 RenderTarget）
    // 传入objectOrder确保按照hierarchy顺序渲染
    pipeline.render(
      renderTargetRef.current,
      null, // 渲染前回调（已在上面更新）
      (objId, worker, viewProj) => {
        // 更新 Worker（用于深度排序）
        if (viewProj && Array.isArray(viewProj) && viewProj.length >= 16) {
          worker.postMessage({ view: viewProj });
        }
      },
      null, // XR frame（非XR模式）
      objectOrder // 对象顺序列表（按hierarchy顺序）
    );

    animationFrameRef.current = requestAnimationFrame(render);
  }, [canvasRef, updateCameraFromInput, sceneManager]);

  // 启动渲染循环
  useEffect(() => {
    if (!gl || !uniforms) {
      return;
    }

    if (!canvasRef.current) {
      return;
    }

    animationFrameRef.current = requestAnimationFrame(render);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [gl, uniforms, render]);


  // 处理错误
  const errorHandledRef = useRef(false);
  
  useEffect(() => {
    if (webGLError && onError && !errorHandledRef.current) {
      errorHandledRef.current = true;
      onError(webGLError);
    }
  }, [webGLError, onError]);

  return null;
}

