import { useEffect, useRef, useCallback } from 'react';
import { invert4, translate4, rotate4, getViewMatrix } from '../core/utils/webgl';
import { globalGizmoDragging } from '../utils/gizmoState';

/**
 * 交互式相机控制 Hook
 * 实现鼠标、键盘、触摸和游戏手柄控制
 */
export function useCameraControls(
  canvasRef,
  viewMatrixRef,
  cameraRef,
  camerasRef,
  onViewMatrixChange,
  onCameraChange,
  camerasVersion = 0,
  worldUpPitchAdjust = 0,  // world_up 在 pitch 方向上的调整角度（度数，默认 0）
  onNotifyUserInput = null,  // 当用户有输入时通知外部（用于中断自动插值）
  disableLeftMouseButton = false,  // 如果为true，禁用左键转视野（仅保留右键）
  cameraSpeedMultiplier = 0.5  // 相机移动速度倍率（由 EditorViewer 计算）
) {
  // 移除调试日志 - 功能已正常工作
  
  const activeKeysRef = useRef([]);
  const mouseDownRef = useRef(false);
  const mouseStartRef = useRef({ x: 0, y: 0 });
  const touchStartRef = useRef({ x: 0, y: 0, altX: 0, altY: 0 });
  const carouselRef = useRef(false);
  const currentCameraIndexRef = useRef(0);
  const jumpDeltaRef = useRef(0);
  const worldUpRef = useRef(null); // 世界的"上"方向（从初始相机的 UP 方向提取）
  const cameraSpeedMultiplierRef = useRef(cameraSpeedMultiplier); // 使用 ref 存储最新的速度倍率
  
  // 同步更新 ref 值（在每次渲染时立即更新，不等待 useEffect）
  cameraSpeedMultiplierRef.current = cameraSpeedMultiplier;

  // 更新视图矩阵
  const updateViewMatrix = useCallback((newViewMatrix) => {
    // 根本修复：如果 Gizmo 正在拖拽，不要更新 viewMatrixRef，避免重置相机
    // 这是唯一必要的根本性修复，因为它阻止了所有可能的相机重置路径
    if (globalGizmoDragging.current) {
      return;
    }
    viewMatrixRef.current = newViewMatrix;
    if (onViewMatrixChange) {
      onViewMatrixChange(newViewMatrix);
    }
  }, [viewMatrixRef, onViewMatrixChange]);

  // 从视图矩阵（camera-to-world）提取 forward 向量
  const extractForward = useCallback((viewMatrix) => {
    // viewMatrix 是 camera-to-world 矩阵，第三列（索引8,9,10）是 forward 向量
    return [viewMatrix[8], viewMatrix[9], viewMatrix[10]];
  }, []);

  // 基于 world_up 约束的 yaw/pitch 旋转
  const applyYawPitchRotation = useCallback((viewMatrix, dYaw, dPitch) => {
    // 防御性检查：如果Gizmo正在拖拽，直接返回原始矩阵
    // 注意：这个检查可能是冗余的，因为 handleMouseMove 已经被阻止了
    // 但保留它作为额外的安全措施
    if (globalGizmoDragging.current) {
      return viewMatrix;
    }

    if (!worldUpRef.current) {
      // 如果还没有初始化 world_up，使用默认的 Y 轴向上
      worldUpRef.current = [0, 1, 0];
    }

    const worldUp = worldUpRef.current;
    let inv = invert4(viewMatrix);
    if (!inv) {
      console.warn('[useCameraControls] Failed to invert viewMatrix');
      return viewMatrix;
    }

    // 提取相机在世界空间中的位置
    // viewMatrix 是 camera-to-world 矩阵（列主序），它的最后一列的前三个元素就是相机位置
    const cameraPos = [viewMatrix[12], viewMatrix[13], viewMatrix[14]];
    
    // 验证位置有效性
    if (isNaN(cameraPos[0]) || isNaN(cameraPos[1]) || isNaN(cameraPos[2]) || 
        !isFinite(cameraPos[0]) || !isFinite(cameraPos[1]) || !isFinite(cameraPos[2])) {
      console.error('[useCameraControls] Invalid camera position extracted:', cameraPos);
      return viewMatrix;
    }

    // 尝试从 cameraRef 获取当前的 yaw/pitch 和参考水平方向
    let currentYaw = 0;
    let currentPitch = 0;
    let forwardHorizontalRef = null;

    if (cameraRef.current && 
        cameraRef.current.yawRad !== undefined && 
        cameraRef.current.pitchRad !== undefined &&
        cameraRef.current.forwardHorizontalRef) {
      // 使用相机对象中记录的 yaw/pitch
      currentYaw = cameraRef.current.yawRad;
      currentPitch = cameraRef.current.pitchRad;
      forwardHorizontalRef = cameraRef.current.forwardHorizontalRef;
    } else if (cameraRef.current && cameraRef.current.worldUp) {
      // 如果相机有worldUp但没有yaw/pitch，从viewMatrix提取
      const forward = extractForward(viewMatrix);
      const normalize = (v) => {
        const len = Math.hypot(v[0], v[1], v[2]);
        return len > 1e-6 ? [v[0] / len, v[1] / len, v[2] / len] : [0, 1, 0];
      };
      const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      const forwardNorm = normalize(forward);
      const forwardUpComponent = dot(forwardNorm, cameraRef.current.worldUp);
      currentPitch = Math.asin(Math.max(-1, Math.min(1, forwardUpComponent)));
      let forwardHorizontal = [
        forwardNorm[0] - forwardUpComponent * cameraRef.current.worldUp[0],
        forwardNorm[1] - forwardUpComponent * cameraRef.current.worldUp[1],
        forwardNorm[2] - forwardUpComponent * cameraRef.current.worldUp[2],
      ];
      const forwardHorizontalLen = Math.hypot(forwardHorizontal[0], forwardHorizontal[1], forwardHorizontal[2]);
      if (forwardHorizontalLen > 1e-6) {
        forwardHorizontalRef = normalize(forwardHorizontal);
      }
      currentYaw = 0; // 默认yaw为0
    } else {
      // 如果没有记录，从 viewMatrix 中提取并估算
      const forward = extractForward(viewMatrix);
      const normalize = (v) => {
        const len = Math.hypot(v[0], v[1], v[2]);
        return len > 1e-6 ? [v[0] / len, v[1] / len, v[2] / len] : [0, 1, 0];
      };
      const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      const forwardNorm = normalize(forward);
      
      // 计算当前 pitch
      const forwardUpComponent = dot(forwardNorm, worldUp);
      currentPitch = Math.asin(Math.max(-1, Math.min(1, forwardUpComponent)));
      
      // 计算当前水平方向
      let forwardHorizontal = [
        forwardNorm[0] - forwardUpComponent * worldUp[0],
        forwardNorm[1] - forwardUpComponent * worldUp[1],
        forwardNorm[2] - forwardUpComponent * worldUp[2],
      ];
      const forwardHorizontalLen = Math.hypot(forwardHorizontal[0], forwardHorizontal[1], forwardHorizontal[2]);
      if (forwardHorizontalLen > 1e-6) {
        forwardHorizontalRef = normalize(forwardHorizontal);
      } else {
        // 使用默认方向
        const defaultDir = Math.abs(dot(worldUp, [1, 0, 0])) < 0.9 
          ? normalize([1, 0, 0])
          : normalize([0, 1, 0]);
        const defaultHorizontal = [
          defaultDir[0] - dot(defaultDir, worldUp) * worldUp[0],
          defaultDir[1] - dot(defaultDir, worldUp) * worldUp[1],
          defaultDir[2] - dot(defaultDir, worldUp) * worldUp[2],
        ];
        forwardHorizontalRef = normalize(defaultHorizontal);
      }
      // yaw 设为 0（相对于参考方向）
      currentYaw = 0;
    }

    // 应用增量
    const newYaw = currentYaw + dYaw;
    const newPitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, currentPitch + dPitch));

    // 根据新的 yaw 和 pitch 重建旋转矩阵（确保 roll=0）
    const rotation = buildRotationFromYawPitch(newYaw, newPitch, worldUp, forwardHorizontalRef);

    // 构建新的 camera-to-world 矩阵（列主序）
    // rotation 是 3x3 旋转矩阵（行主序），需要转换为列主序的 4x4 矩阵
    // 新的 camera-to-world 矩阵 = [R | cameraPos; 0 0 0 | 1]
    const newViewMatrix = [
      rotation[0][0], rotation[0][1], rotation[0][2], 0,
      rotation[1][0], rotation[1][1], rotation[1][2], 0,
      rotation[2][0], rotation[2][1], rotation[2][2], 0,
      cameraPos[0], cameraPos[1], cameraPos[2], 1,  // 保持原始相机位置
    ];
    
    // 验证：确保位置没有被改变
    const finalCameraPos = [newViewMatrix[12], newViewMatrix[13], newViewMatrix[14]];
    const posDiff = Math.hypot(
      finalCameraPos[0] - cameraPos[0],
      finalCameraPos[1] - cameraPos[1],
      finalCameraPos[2] - cameraPos[2]
    );
    if (posDiff > 0.0001) {
      console.warn('[useCameraControls] Camera position changed during rotation!', {
        original: cameraPos,
        final: finalCameraPos,
        diff: posDiff
      });
    }

    // 更新 cameraRef 中的 yaw/pitch 信息
    if (cameraRef.current) {
      cameraRef.current = {
        ...cameraRef.current,
        yawRad: newYaw,
        pitchRad: newPitch,
        forwardHorizontalRef: forwardHorizontalRef,
        worldUp: worldUp, // 保持 world up
      };
    }

    return newViewMatrix;
  }, [extractForward, cameraRef]);


  // 根据 yaw 和 pitch 构建旋转矩阵（确保 roll=0）
  const buildRotationFromYawPitch = (yawRad, pitchRad, worldUp, forwardHorizontalRef) => {
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
    // 使用 cross(worldUp, forward) 得到 right，符合相机坐标系的约定
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
  };


  // 通知外部有用户输入（用于中断自动插值）
  const notifyUserInput = useCallback((hasUserInput = true) => {
    if (onNotifyUserInput && hasUserInput) {
      onNotifyUserInput(hasUserInput);
    }
  }, [onNotifyUserInput]);

  // 初始化世界的"上"方向（从初始相机提取）
  useEffect(() => {
    // 初始化世界的"上"方向
    // 优先从中心相机（索引1，如果存在）提取，否则从第一个相机提取
    // 这个计算应该和 buildLateralCameras 中的计算一致
    if (camerasRef.current && camerasRef.current.length > 0) {
      // 优先使用中心相机（索引1），如果没有则使用第一个
      const initialCamIndex = camerasRef.current.length >= 3 ? 1 : 0;
      const initialCam = camerasRef.current[initialCamIndex];
      
      // 如果相机对象中已经有 worldUp，直接使用
      if (initialCam && initialCam.worldUp) {
        worldUpRef.current = initialCam.worldUp;
      } else if (initialCam && initialCam.rotation) {
        // 否则从相机旋转矩阵中提取并计算
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

        // rotation 是列主序矩阵：
        // 第一列（索引0）：right 向量
        // 第二列（索引1）：up 向量
        // 第三列（索引2）：forward 向量
        const r = initialCam.rotation.flat();
        const initialRight = [r[0], r[3], r[6]];
        const initialUp = [r[1], r[4], r[7]];
        
        const rightNorm = normalize(initialRight);
        let worldUp = normalize(initialUp);

        // 如果有 pitch 调整，绕 right 向量旋转 up（与 buildLateralCameras 中的计算一致）
        // 如果 worldUpPitchAdjust 为 null，则使用坐标系的 up [0, 1, 0] (Y-up)
        if (worldUpPitchAdjust === null || worldUpPitchAdjust === undefined) {
          worldUp = [0, 1, 0];
        } else if (Math.abs(worldUpPitchAdjust) > 1e-6) {
          const pitchAdjustRad = (worldUpPitchAdjust * Math.PI) / 180;
          worldUp = normalize(rotateAroundAxis(initialUp, rightNorm, pitchAdjustRad));
        }

        worldUpRef.current = worldUp;
      }
    }
  }, [camerasVersion, worldUpPitchAdjust]);


  // 键盘控制
  useEffect(() => {
    const handleKeyDown = (e) => {
      // 如果用户正在输入框中输入，不处理键盘事件
      const activeElement = document.activeElement;
      if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA' || activeElement.contentEditable === 'true')) {
        return;
      }
      
      // 检查canvas是否有焦点
      const canvas = canvasRef?.current;
      if (!canvas) {
        return;
      }
      
      // 只有当canvas有焦点时才处理键盘事件
      const isCanvasFocused = activeElement === canvas;
      if (!isCanvasFocused) {
        return;
      }
      
      carouselRef.current = false;
      
      // 检查是否是控制视角的按键（FPS 风格）
      const isViewControlKey = ['KeyA', 'KeyD', 'KeyW', 'KeyS', 'Space', 
                                'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight',
                                'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code);
      
      // 检测到用户按下视角控制键，通知外部
      if (isViewControlKey) {
        notifyUserInput();
        // 阻止浏览器默认行为（如空格键滚动页面、方向键滚动等）
        e.preventDefault();
      }
      
      if (!activeKeysRef.current.includes(e.code)) {
        activeKeysRef.current.push(e.code);
      }

      // 数字键切换相机
      if (/\d/.test(e.key) && camerasRef.current) {
        const index = parseInt(e.key);
        if (index < camerasRef.current.length) {
          currentCameraIndexRef.current = index;
          const cam = camerasRef.current[index];
          cameraRef.current = cam;
          const vm = getViewMatrix(cam);
          updateViewMatrix(vm);
          notifyUserInput();
          if (onCameraChange) onCameraChange(cam, index);
        }
      }

      // +/- 切换相机
      if (['-', '_'].includes(e.key) && camerasRef.current) {
        currentCameraIndexRef.current = (currentCameraIndexRef.current + camerasRef.current.length - 1) % camerasRef.current.length;
        const cam = camerasRef.current[currentCameraIndexRef.current];
        cameraRef.current = cam;
        updateViewMatrix(getViewMatrix(cam));
        notifyUserInput();
        if (onCameraChange) onCameraChange(cam, currentCameraIndexRef.current);
      }
      if (['+', '='].includes(e.key) && camerasRef.current) {
        currentCameraIndexRef.current = (currentCameraIndexRef.current + 1) % camerasRef.current.length;
        const cam = camerasRef.current[currentCameraIndexRef.current];
        cameraRef.current = cam;
        updateViewMatrix(getViewMatrix(cam));
        notifyUserInput();
        if (onCameraChange) onCameraChange(cam, currentCameraIndexRef.current);
      }

      // V 键：保存视图矩阵到 URL
      if (e.code === 'KeyV') {
        const viewMatrix = viewMatrixRef.current;
        const hash = '#' + JSON.stringify(viewMatrix.map((k) => Math.round(k * 100) / 100));
        window.location.hash = hash;
      }

      // P 键：启动自动旋转
      if (e.code === 'KeyP') {
        carouselRef.current = true;
      }
    };

    const handleKeyUp = (e) => {
      // 如果用户正在输入框中输入，不处理键盘事件
      const activeElement = document.activeElement;
      if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA' || activeElement.contentEditable === 'true')) {
        return;
      }
      
      // 检查canvas是否有焦点
      const canvas = canvasRef?.current;
      if (!canvas) {
        return;
      }
      
      // 只有当canvas有焦点时才处理键盘事件
      const isCanvasFocused = activeElement === canvas;
      if (!isCanvasFocused) {
        return;
      }
      
      activeKeysRef.current = activeKeysRef.current.filter((k) => k !== e.code);
    };

    const handleBlur = () => {
      activeKeysRef.current = [];
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [viewMatrixRef, camerasRef, updateViewMatrix, onCameraChange, notifyUserInput]);

  // 鼠标控制
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleMouseDown = (e) => {
      // 最高优先级：如果Gizmo正在拖拽，完全忽略并清除状态
      if (globalGizmoDragging.current) {
        mouseDownRef.current = false;
        return;
      }

      // 如果禁用了左键，只允许右键
      if (disableLeftMouseButton && e.button === 0) {
        mouseDownRef.current = false;
        return;
      }
      
      // 支持左键和右键（FPS 风格），但如果禁用了左键则只支持右键
      if (e.button !== 0 && e.button !== 2) {
        mouseDownRef.current = false;
        return;
      }
      
      // 检查事件是否已经被其他处理器处理（比如Gizmo）
      if (e.defaultPrevented) {
        mouseDownRef.current = false;
        return;
      }
      
      // 让canvas获得焦点，以便接收键盘输入
      if (canvas && canvas.focus) {
        canvas.focus();
      }
      
      carouselRef.current = false;
      // 检测到用户按下鼠标（准备移动视角），通知外部
      notifyUserInput();
      e.preventDefault();
      e.stopPropagation();
      mouseStartRef.current = { x: e.clientX, y: e.clientY };
      mouseDownRef.current = true;
    };

    const handleContextMenu = (e) => {
      e.preventDefault();
    };

    const handleMouseMove = (e) => {
      // 最高优先级：如果Gizmo正在拖拽，完全忽略并清除状态
      if (globalGizmoDragging.current) {
        mouseDownRef.current = false;
        mouseStartRef.current = { x: 0, y: 0 };
        return;
      }

      if (!mouseDownRef.current) return;

      // 如果禁用了左键，且当前是左键拖拽（buttons === 1 表示只有左键按下），则忽略
      // 这样可以避免Gizmo拖拽时触发相机控制
      if (disableLeftMouseButton && (e.buttons & 1) === 1 && (e.buttons & 2) === 0) {
        // 只有左键按下，没有右键，且禁用了左键，所以忽略
        // 同时清除mouseDownRef，防止后续处理
        mouseDownRef.current = false;
        return;
      }
      
      // 如果事件已经被其他处理器阻止（比如Gizmo），也忽略
      if (e.defaultPrevented) {
        return;
      }

      const { innerWidth, innerHeight } = window;
      const dx = e.clientX - mouseStartRef.current.x;
      const dy = e.clientY - mouseStartRef.current.y;

      // 检测到用户移动视角，通知外部
      if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) {
        notifyUserInput();
      }

      // 确保viewMatrixRef.current存在且有效
      if (!viewMatrixRef.current) {
        console.warn('[useCameraControls] viewMatrixRef.current is null, skipping rotation');
        return;
      }


      // FPS 风格：左键/右键拖拽控制视角
      // 水平右拖→向右转头（yaw += dx * sensitivity）
      // 垂直上拖→低头（pitch += dy * sensitivity）
      const sensitivity = 0.005;
      const dYaw = dx * sensitivity; // 反转左右方向：向右拖动 = 向右旋转
      const dPitch = dy * sensitivity;

      try {
        const newViewMatrix = applyYawPitchRotation(viewMatrixRef.current, dYaw, dPitch);
        if (newViewMatrix && newViewMatrix.length === 16) {
          updateViewMatrix(newViewMatrix);
        } else {
          console.warn('[useCameraControls] Invalid viewMatrix from applyYawPitchRotation');
        }
      } catch (error) {
        console.error('[useCameraControls] Error in applyYawPitchRotation:', error);
      }
      
      mouseStartRef.current = { x: e.clientX, y: e.clientY };
      e.preventDefault();
    };

    const handleMouseUp = (e) => {
      // 如果禁用了左键，只处理右键
      if (disableLeftMouseButton && e.button === 0) {
        return; // 忽略左键
      }
      
      // 支持左键和右键
      if (e.button === 0 || e.button === 2) {
        mouseDownRef.current = false;
        mouseStartRef.current = { x: 0, y: 0 };
        e.preventDefault();
        e.stopPropagation();
      }
    };

    // 使用 capture 模式确保能捕获右键事件
    canvas.addEventListener('mousedown', handleMouseDown, true);
    canvas.addEventListener('contextmenu', handleContextMenu, true);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown, true);
      canvas.removeEventListener('contextmenu', handleContextMenu, true);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [canvasRef, viewMatrixRef, updateViewMatrix, notifyUserInput, applyYawPitchRotation, disableLeftMouseButton]);

  // 滚轮控制（禁用上下方向滑动，只保留左右方向）
  useEffect(() => {
    const handleWheel = (e) => {
      // 如果只有上下滑动（deltaY），忽略该事件
      if (Math.abs(e.deltaX) < 0.1 && Math.abs(e.deltaY) > 0.1) {
        return;
      }

      // 如果只有上下滑动且没有修饰键，忽略该事件
      if (Math.abs(e.deltaX) < 0.1 && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        return;
      }

      carouselRef.current = false;
      // 检测到用户滚轮操作，通知外部
      notifyUserInput();
      e.preventDefault();

      const { innerWidth, innerHeight } = window;
      const lineHeight = 10;
      const scale = e.deltaMode === 1 ? lineHeight : e.deltaMode === 2 ? innerHeight : 1;

      if (e.shiftKey) {
        // Shift + 滚轮：仅水平平移（忽略垂直方向）
        let inv = invert4(viewMatrixRef.current);
        inv = translate4(inv, (e.deltaX * scale) / innerWidth, 0, 0);
        updateViewMatrix(invert4(inv));
      } else if (e.ctrlKey || e.metaKey) {
        // Ctrl/Cmd + 滚轮：前后移动（禁用，因为依赖 deltaY）
        // 已禁用，因为需要 deltaY
        return;
      } else {
        // 普通滚轮：仅水平旋转（yaw），忽略垂直方向（pitch）
        if (Math.abs(e.deltaX) > 0.1) {
          const sensitivity = 0.0025;
          const dYaw = (e.deltaX * scale) * sensitivity;
          
          const newViewMatrix = applyYawPitchRotation(viewMatrixRef.current, dYaw, 0);
          updateViewMatrix(newViewMatrix);
        }
      }
    };

    window.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      window.removeEventListener('wheel', handleWheel);
    };
  }, [viewMatrixRef, updateViewMatrix, notifyUserInput, applyYawPitchRotation]);

  // 触摸控制
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleTouchStart = (e) => {
      e.preventDefault();
      if (e.touches.length === 1) {
        carouselRef.current = false;
        // 检测到用户开始触摸（准备移动视角），通知外部
        notifyUserInput();
        touchStartRef.current = {
          x: e.touches[0].clientX,
          y: e.touches[0].clientY,
          altX: 0,
          altY: 0,
        };
      } else if (e.touches.length === 2) {
        carouselRef.current = false;
        // 检测到用户开始双指触摸（准备移动视角），通知外部
        notifyUserInput();
        touchStartRef.current = {
          x: e.touches[0].clientX,
          y: e.touches[0].clientY,
          altX: e.touches[1].clientX,
          altY: e.touches[1].clientY,
        };
      }
    };

    const handleTouchMove = (e) => {
      e.preventDefault();
      const { innerWidth, innerHeight } = window;

      if (e.touches.length === 1 && touchStartRef.current.x > 0) {
        // 单指：旋转
        const dx = (4 * (e.touches[0].clientX - touchStartRef.current.x)) / innerWidth;
        const dy = (4 * (e.touches[0].clientY - touchStartRef.current.y)) / innerHeight;
        
        // 检测到用户触摸移动视角，通知外部
        if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001) {
          notifyUserInput();
        }

        let inv = invert4(viewMatrixRef.current);

        const d = 4;
        inv = translate4(inv, 0, 0, d);
        inv = rotate4(inv, dx, 0, 1, 0);
        inv = rotate4(inv, -dy, 1, 0, 0);
        inv = translate4(inv, 0, 0, -d);

        updateViewMatrix(invert4(inv));
        touchStartRef.current = {
          x: e.touches[0].clientX,
          y: e.touches[0].clientY,
          altX: 0,
          altY: 0,
        };
      } else if (e.touches.length === 2 && touchStartRef.current.altX > 0) {
        // 双指：缩放、旋转、平移
        const dtheta =
          Math.atan2(touchStartRef.current.y - touchStartRef.current.altY, touchStartRef.current.x - touchStartRef.current.altX) -
          Math.atan2(e.touches[0].clientY - e.touches[1].clientY, e.touches[0].clientX - e.touches[1].clientX);
        const dscale =
          Math.hypot(touchStartRef.current.x - touchStartRef.current.altX, touchStartRef.current.y - touchStartRef.current.altY) /
          Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        const dx = (e.touches[0].clientX + e.touches[1].clientX - (touchStartRef.current.x + touchStartRef.current.altX)) / 2;
        const dy = (e.touches[0].clientY + e.touches[1].clientY - (touchStartRef.current.y + touchStartRef.current.altY)) / 2;

        // 检测到用户双指操作，通知外部
        if (Math.abs(dtheta) > 0.001 || Math.abs(dscale - 1) > 0.001 || Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) {
          notifyUserInput();
        }

        let inv = invert4(viewMatrixRef.current);
        inv = rotate4(inv, dtheta, 0, 0, 1);
        inv = translate4(inv, -dx / innerWidth, -dy / innerHeight, 0);
        inv = translate4(inv, 0, 0, 3 * (1 - dscale));

        updateViewMatrix(invert4(inv));
        touchStartRef.current = {
          x: e.touches[0].clientX,
          y: e.touches[0].clientY,
          altX: e.touches[1].clientX,
          altY: e.touches[1].clientY,
        };
      }
    };

    const handleTouchEnd = (e) => {
      e.preventDefault();
      touchStartRef.current = { x: 0, y: 0, altX: 0, altY: 0 };
    };

    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    canvas.addEventListener('touchend', handleTouchEnd, { passive: false });

    return () => {
      canvas.removeEventListener('touchstart', handleTouchStart);
      canvas.removeEventListener('touchmove', handleTouchMove);
      canvas.removeEventListener('touchend', handleTouchEnd);
    };
  }, [canvasRef, viewMatrixRef, updateViewMatrix, notifyUserInput]);

  // 在渲染循环中处理键盘输入
  const updateCameraFromInput = useCallback((deltaTime) => {
    if (!viewMatrixRef.current) return;

    let inv = invert4(viewMatrixRef.current);
    const shiftKey = activeKeysRef.current.includes('Shift') || 
                     activeKeysRef.current.includes('ShiftLeft') || 
                     activeKeysRef.current.includes('ShiftRight');

    // FPS 风格的键盘控制
    const hasWASD = activeKeysRef.current.includes('KeyA') || 
                    activeKeysRef.current.includes('KeyD') || 
                    activeKeysRef.current.includes('KeyW') || 
                    activeKeysRef.current.includes('KeyS');
    const hasSpace = activeKeysRef.current.includes('Space');
    const hasShiftAlt = shiftKey || 
                        activeKeysRef.current.includes('AltLeft') || 
                        activeKeysRef.current.includes('AltRight');
    const hasArrowKeys = activeKeysRef.current.includes('ArrowUp') ||
                         activeKeysRef.current.includes('ArrowDown') ||
                         activeKeysRef.current.includes('ArrowLeft') ||
                         activeKeysRef.current.includes('ArrowRight');
    
    // 检测到用户使用键盘移动视角，通知外部
    if (hasWASD || hasSpace || hasShiftAlt || hasArrowKeys) {
      notifyUserInput(true);
    }

    // 从 camera-to-world 矩阵（inv）直接提取方向向量
    // translate4 在局部空间平移：x=right方向, y=up方向, z=forward方向
    
    // 使用传入的速度倍率（由 EditorViewer 计算），通过 ref 获取最新值避免闭包问题
    const speedMultiplier = cameraSpeedMultiplierRef.current;
    const moveSpeed = speedMultiplier * deltaTime * 60; // 按帧率调整速度

    // W/S：前进/后退（沿相机 forward，相机空间的Z方向）
    // translate4(inv, 0, 0, z) 沿着 forward 方向移动
    if (activeKeysRef.current.includes('KeyW')) {
      inv = translate4(inv, 0, 0, moveSpeed);  // 前进：+Z方向
    }
    if (activeKeysRef.current.includes('KeyS')) {
      inv = translate4(inv, 0, 0, -moveSpeed); // 后退：-Z方向
    }

    // A/D：左移/右移（沿相机 right，相机空间的X方向）
    // translate4(inv, x, 0, 0) 沿着 right 方向移动
    if (activeKeysRef.current.includes('KeyA')) {
      inv = translate4(inv, -moveSpeed, 0, 0); // 左移：-X方向
    }
    if (activeKeysRef.current.includes('KeyD')) {
      inv = translate4(inv, moveSpeed, 0, 0);  // 右移：+X方向
    }

    // 空格：上升（沿世界的"上"方向）
    // Space：上升（沿世界的"上"方向）
    if (hasSpace) {
      const worldUp = worldUpRef.current || [0, 1, 0];
      inv = translate4(inv, -worldUp[0] * moveSpeed, -worldUp[1] * moveSpeed, -worldUp[2] * moveSpeed);
    }

    // Shift / Alt：下降（沿世界的"上"方向反方向）
    if (hasShiftAlt) {
      const worldUp = worldUpRef.current || [0, 1, 0];
      inv = translate4(inv, worldUp[0] * moveSpeed, worldUp[1] * moveSpeed, worldUp[2] * moveSpeed);
    }

    // 方向键：控制 yaw/pitch（第一人称视角旋转）
    // ArrowLeft: 左转（yaw 减少），ArrowRight: 右转（yaw 增加）
    // ArrowUp: 低头（pitch 减少），ArrowDown: 抬头（pitch 增加）
    const rotateSpeed = 0.02 * deltaTime * 60; // 按帧率调整旋转速度
    let dYaw = 0;
    let dPitch = 0;
    
    if (activeKeysRef.current.includes('ArrowLeft')) {
      dYaw -= rotateSpeed;
    }
    if (activeKeysRef.current.includes('ArrowRight')) {
      dYaw += rotateSpeed;
    }
    if (activeKeysRef.current.includes('ArrowUp')) {
      dPitch -= rotateSpeed;
    }
    if (activeKeysRef.current.includes('ArrowDown')) {
      dPitch += rotateSpeed;
    }
    
    // 如果有方向键输入，应用 yaw/pitch 旋转
    if (dYaw !== 0 || dPitch !== 0) {
      const newViewMatrix = applyYawPitchRotation(viewMatrixRef.current, dYaw, dPitch);
      updateViewMatrix(newViewMatrix);
      // 注意：应用旋转后，需要重新获取 inv，因为 viewMatrix 已更新
      inv = invert4(newViewMatrix);
    }

    // 焦距调整
    if (activeKeysRef.current.includes('BracketLeft') && cameraRef.current) {
      cameraRef.current.fx /= 1.01;
      cameraRef.current.fy /= 1.01;
      inv = translate4(inv, 0, 0, 0.1);
    }
    if (activeKeysRef.current.includes('BracketRight') && cameraRef.current) {
      cameraRef.current.fx *= 1.01;
      cameraRef.current.fy *= 1.01;
      inv = translate4(inv, 0, 0, -0.1);
    }

    // 自动旋转（carousel）
    if (carouselRef.current) {
      // 这里需要 defaultViewMatrix，暂时跳过
      // const defaultViewMatrix = ...;
      // let inv = invert4(defaultViewMatrix);
      // const t = Math.sin((Date.now() - start) / 5000);
      // inv = translate4(inv, 2.5 * t, 0, 6 * (1 - Math.cos(t)));
      // inv = rotate4(inv, -0.6 * t, 0, 1, 0);
      // updateViewMatrix(invert4(inv));
    }

    // 移除跳跃效果（FPS 风格不需要）

    // 游戏手柄支持
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    let hasGamepadInput = false;
    for (const gamepad of gamepads) {
      if (!gamepad) continue;

      const axisThreshold = 0.1;
      const moveSpeed = 0.06;
      const rotateSpeed = 0.02;

      if (Math.abs(gamepad.axes[0]) > axisThreshold) {
        inv = translate4(inv, moveSpeed * gamepad.axes[0], 0, 0);
        hasGamepadInput = true;
      }
      if (Math.abs(gamepad.axes[1]) > axisThreshold) {
        inv = translate4(inv, 0, 0, -moveSpeed * gamepad.axes[1]);
        hasGamepadInput = true;
      }
      if (gamepad.buttons[12]?.pressed || gamepad.buttons[13]?.pressed) {
        inv = translate4(inv, 0, -moveSpeed * (gamepad.buttons[12]?.pressed - gamepad.buttons[13]?.pressed), 0);
        hasGamepadInput = true;
      }
      if (gamepad.buttons[14]?.pressed || gamepad.buttons[15]?.pressed) {
        inv = translate4(inv, -moveSpeed * (gamepad.buttons[14]?.pressed - gamepad.buttons[15]?.pressed), 0, 0);
        hasGamepadInput = true;
      }
      if (Math.abs(gamepad.axes[2]) > axisThreshold) {
        inv = rotate4(inv, rotateSpeed * gamepad.axes[2], 0, 1, 0);
        hasGamepadInput = true;
      }
      if (Math.abs(gamepad.axes[3]) > axisThreshold) {
        inv = rotate4(inv, -rotateSpeed * gamepad.axes[3], 1, 0, 0);
        hasGamepadInput = true;
      }
      const tiltAxis = (gamepad.buttons[6]?.value || 0) - (gamepad.buttons[7]?.value || 0);
      if (Math.abs(tiltAxis) > axisThreshold) {
        inv = rotate4(inv, rotateSpeed * tiltAxis, 0, 0, 1);
        hasGamepadInput = true;
      }
    }
    
    // 检测到用户使用游戏手柄移动视角，通知外部
    if (hasGamepadInput) {
      notifyUserInput(true);
    }

    updateViewMatrix(invert4(inv));
  }, [viewMatrixRef, cameraRef, camerasRef, updateViewMatrix, notifyUserInput, applyYawPitchRotation, cameraSpeedMultiplier]);

  return {
    updateCameraFromInput,
    activeKeys: activeKeysRef.current,
    carousel: carouselRef.current,
  };
}

