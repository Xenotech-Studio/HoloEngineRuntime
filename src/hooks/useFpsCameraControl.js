import { useEffect, useRef, useCallback } from 'react';
import { invert4, translate4, rotate4, getViewMatrix } from '../core/utils/webgl';
import { Camera } from '../core/utils/Camera';
import { globalGizmoDragging } from '../utils/gizmoState';

/**
 * FPS 风格相机控制 Hook
 * 实现第一人称视角控制：鼠标拖拽旋转视角，WASD移动相机位置
 */
export function useFpsCameraControl(
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
  cameraSpeedMultiplier = 0.5,  // 相机移动速度倍率（由 EditorViewer 计算）
  enabled = true  // 是否启用此控制模式
) {
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

  // 更新视图矩阵（从 Camera 实例同步）
  const updateViewMatrix = useCallback((camera) => {
    // 根本修复：如果 Gizmo 正在拖拽，不要更新 viewMatrixRef，避免重置相机
    if (globalGizmoDragging.current) {
      return;
    }
    if (camera && camera instanceof Camera) {
      const newViewMatrix = camera.viewMatrix;
      viewMatrixRef.current = newViewMatrix;
      if (onViewMatrixChange) {
        onViewMatrixChange(newViewMatrix);
      }
    }
  }, [viewMatrixRef, onViewMatrixChange]);

  // 从视图矩阵（camera-to-world）提取 forward 向量
  const extractForward = useCallback((viewMatrix) => {
    // viewMatrix 是 camera-to-world 矩阵，第三列（索引8,9,10）是 forward 向量
    return [viewMatrix[8], viewMatrix[9], viewMatrix[10]];
  }, []);

  // 基于 world_up 约束的 yaw/pitch 旋转（使用 Camera 类）
  const applyYawPitchRotation = useCallback((dYaw, dPitch) => {
    // 防御性检查：如果Gizmo正在拖拽，直接返回
    if (globalGizmoDragging.current) {
      return;
    }

    if (!cameraRef.current) {
      console.warn('[useFpsCameraControl] cameraRef.current is null');
      return;
    }

    // 如果不是 Camera 实例，尝试转换
    if (!(cameraRef.current instanceof Camera)) {
      try {
        cameraRef.current = Camera.fromPlainObject(cameraRef.current);
      } catch (error) {
        console.error('[useFpsCameraControl] Failed to convert camera to Camera instance:', error);
        return;
      }
    }

    const camera = cameraRef.current;

    // 确保 worldUp 已初始化
    if (!worldUpRef.current) {
      worldUpRef.current = camera.worldUp;
    }

    // 使用 Camera 类的 rotate 方法
    camera.rotate(dYaw, dPitch);

    // 同步更新 viewMatrixRef
    updateViewMatrix(camera);
  }, [cameraRef, updateViewMatrix]);


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
    if (camerasRef.current && camerasRef.current.length > 0) {
      const initialCamIndex = camerasRef.current.length >= 3 ? 1 : 0;
      let initialCam = camerasRef.current[initialCamIndex];
      
      // 确保是 Camera 实例
      if (initialCam && !(initialCam instanceof Camera)) {
        initialCam = Camera.fromPlainObject(initialCam);
        camerasRef.current[initialCamIndex] = initialCam;
      }
      
      if (initialCam && initialCam instanceof Camera) {
        worldUpRef.current = initialCam.worldUp;
      } else if (initialCam && initialCam.rotation) {
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

        const r = initialCam.rotation.flat();
        const initialRight = [r[0], r[3], r[6]];
        const initialUp = [r[1], r[4], r[7]];
        
        const rightNorm = normalize(initialRight);
        let worldUp = normalize(initialUp);

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
    if (!enabled) return; // 如果未启用，不注册事件监听器
    
    const handleKeyDown = (e) => {
      const activeElement = document.activeElement;
      if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA' || activeElement.contentEditable === 'true')) {
        return;
      }
      
      const canvas = canvasRef?.current;
      if (!canvas) {
        return;
      }
      
      const isCanvasFocused = activeElement === canvas;
      if (!isCanvasFocused) {
        return;
      }
      
      carouselRef.current = false;
      
      const isViewControlKey = ['KeyA', 'KeyD', 'KeyW', 'KeyS', 'Space', 
                                'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight',
                                'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code);
      
      if (isViewControlKey) {
        notifyUserInput();
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
          // 确保是 Camera 实例
          if (!(cam instanceof Camera)) {
            cameraRef.current = Camera.fromPlainObject(cam);
          } else {
            cameraRef.current = cam;
          }
          updateViewMatrix(cameraRef.current);
          notifyUserInput();
          if (onCameraChange) onCameraChange(cameraRef.current, index);
        }
      }

      // +/- 切换相机
      if (['-', '_'].includes(e.key) && camerasRef.current) {
        currentCameraIndexRef.current = (currentCameraIndexRef.current + camerasRef.current.length - 1) % camerasRef.current.length;
        const cam = camerasRef.current[currentCameraIndexRef.current];
        // 确保是 Camera 实例
        if (!(cam instanceof Camera)) {
          cameraRef.current = Camera.fromPlainObject(cam);
        } else {
          cameraRef.current = cam;
        }
        updateViewMatrix(cameraRef.current);
        notifyUserInput();
        if (onCameraChange) onCameraChange(cameraRef.current, currentCameraIndexRef.current);
      }
      if (['+', '='].includes(e.key) && camerasRef.current) {
        currentCameraIndexRef.current = (currentCameraIndexRef.current + 1) % camerasRef.current.length;
        const cam = camerasRef.current[currentCameraIndexRef.current];
        // 确保是 Camera 实例
        if (!(cam instanceof Camera)) {
          cameraRef.current = Camera.fromPlainObject(cam);
        } else {
          cameraRef.current = cam;
        }
        updateViewMatrix(cameraRef.current);
        notifyUserInput();
        if (onCameraChange) onCameraChange(cameraRef.current, currentCameraIndexRef.current);
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
      const activeElement = document.activeElement;
      if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA' || activeElement.contentEditable === 'true')) {
        return;
      }
      
      const canvas = canvasRef?.current;
      if (!canvas) {
        return;
      }
      
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
  }, [enabled, viewMatrixRef, camerasRef, updateViewMatrix, onCameraChange, notifyUserInput]);

  // 鼠标控制
  useEffect(() => {
    if (!enabled) return; // 如果未启用，不注册事件监听器
    
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleMouseDown = (e) => {
      if (globalGizmoDragging.current) {
        mouseDownRef.current = false;
        return;
      }

      if (disableLeftMouseButton && e.button === 0) {
        mouseDownRef.current = false;
        return;
      }
      
      if (e.button !== 0 && e.button !== 2) {
        mouseDownRef.current = false;
        return;
      }
      
      if (e.defaultPrevented) {
        mouseDownRef.current = false;
        return;
      }
      
      if (canvas && canvas.focus) {
        canvas.focus();
      }
      
      carouselRef.current = false;
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
      if (globalGizmoDragging.current) {
        mouseDownRef.current = false;
        mouseStartRef.current = { x: 0, y: 0 };
        return;
      }

      if (!mouseDownRef.current) return;

      if (disableLeftMouseButton && (e.buttons & 1) === 1 && (e.buttons & 2) === 0) {
        mouseDownRef.current = false;
        return;
      }
      
      if (e.defaultPrevented) {
        return;
      }

      const { innerWidth, innerHeight } = window;
      const dx = e.clientX - mouseStartRef.current.x;
      const dy = e.clientY - mouseStartRef.current.y;

      if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) {
        notifyUserInput();
      }

      if (!viewMatrixRef.current) {
        console.warn('[useFpsCameraControl] viewMatrixRef.current is null, skipping rotation');
        return;
      }

      // FPS 风格：左键/右键拖拽控制视角
      const sensitivity = 0.005;
      const dYaw = dx * sensitivity;
      const dPitch = dy * sensitivity;

      // 确保 cameraRef.current 是 Camera 实例
      if (!cameraRef.current) {
        console.warn('[useFpsCameraControl] cameraRef.current is null, skipping rotation');
        return;
      }

      if (!(cameraRef.current instanceof Camera)) {
        // 如果不是 Camera 实例，尝试转换
        console.warn('[useFpsCameraControl] cameraRef.current is not a Camera instance, attempting conversion');
        try {
          cameraRef.current = Camera.fromPlainObject(cameraRef.current);
        } catch (error) {
          console.error('[useFpsCameraControl] Failed to convert camera to Camera instance:', error);
          return;
        }
      }

      const camPos = cameraRef.current.position;
      console.log('[Fly Mode] 鼠标拖拽旋转:', { 
        dx, 
        dy, 
        dYaw: dYaw.toFixed(4), 
        dPitch: dPitch.toFixed(4), 
        camPose: [camPos[0].toFixed(4), camPos[1].toFixed(4), camPos[2].toFixed(4)], 
        viewMatrix: cameraRef.current.viewMatrix.map(v => v.toFixed(4)) 
      });

      try {
        applyYawPitchRotation(dYaw, dPitch);
      } catch (error) {
        console.error('[useFpsCameraControl] Error in applyYawPitchRotation:', error);
      }
      
      mouseStartRef.current = { x: e.clientX, y: e.clientY };
      e.preventDefault();
    };

    const handleMouseUp = (e) => {
      if (disableLeftMouseButton && e.button === 0) {
        return;
      }
      
      if (e.button === 0 || e.button === 2) {
        mouseDownRef.current = false;
        mouseStartRef.current = { x: 0, y: 0 };
        e.preventDefault();
        e.stopPropagation();
      }
    };

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
  }, [enabled, canvasRef, viewMatrixRef, updateViewMatrix, notifyUserInput, applyYawPitchRotation, disableLeftMouseButton]);

  // 滚轮控制
  useEffect(() => {
    if (!enabled) return; // 如果未启用，不注册事件监听器
    
    const handleWheel = (e) => {
      if (Math.abs(e.deltaX) < 0.1 && Math.abs(e.deltaY) > 0.1) {
        return;
      }

      if (Math.abs(e.deltaX) < 0.1 && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        return;
      }

      carouselRef.current = false;
      notifyUserInput();
      e.preventDefault();

      const { innerWidth, innerHeight } = window;
      const lineHeight = 10;
      const scale = e.deltaMode === 1 ? lineHeight : e.deltaMode === 2 ? innerHeight : 1;

      if (!cameraRef.current) {
        return;
      }

      // 确保是 Camera 实例
      if (!(cameraRef.current instanceof Camera)) {
        try {
          cameraRef.current = Camera.fromPlainObject(cameraRef.current);
        } catch (error) {
          console.error('[useFpsCameraControl] Failed to convert camera to Camera instance:', error);
          return;
        }
      }

      if (e.shiftKey) {
        // Shift + 滚轮：仅水平平移
        console.log('[Fly Mode] Shift + 滚轮水平平移:', { deltaX: e.deltaX, scale });
        cameraRef.current.moveLocal((e.deltaX * scale) / innerWidth, 0, 0);
        updateViewMatrix(cameraRef.current);
      } else if (e.ctrlKey || e.metaKey) {
        return;
      } else {
        // 普通滚轮：仅水平旋转（yaw）
        if (Math.abs(e.deltaX) > 0.1) {
          const sensitivity = 0.0025;
          const dYaw = (e.deltaX * scale) * sensitivity;
          console.log('[Fly Mode] 滚轮水平旋转:', { deltaX: e.deltaX, dYaw: dYaw.toFixed(4) });
          
          applyYawPitchRotation(dYaw, 0);
        }
      }
    };

    window.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      window.removeEventListener('wheel', handleWheel);
    };
  }, [enabled, viewMatrixRef, updateViewMatrix, notifyUserInput, applyYawPitchRotation]);

  // 触摸控制
  useEffect(() => {
    if (!enabled) return; // 如果未启用，不注册事件监听器
    
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleTouchStart = (e) => {
      e.preventDefault();
      if (e.touches.length === 1) {
        carouselRef.current = false;
        notifyUserInput();
        touchStartRef.current = {
          x: e.touches[0].clientX,
          y: e.touches[0].clientY,
          altX: 0,
          altY: 0,
        };
      } else if (e.touches.length === 2) {
        carouselRef.current = false;
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
        if (!cameraRef.current) {
          return;
        }

        // 确保是 Camera 实例
        if (!(cameraRef.current instanceof Camera)) {
          try {
            cameraRef.current = Camera.fromPlainObject(cameraRef.current);
          } catch (error) {
            console.error('[useFpsCameraControl] Failed to convert camera to Camera instance:', error);
            return;
          }
        }

        const dx = (4 * (e.touches[0].clientX - touchStartRef.current.x)) / innerWidth;
        const dy = (4 * (e.touches[0].clientY - touchStartRef.current.y)) / innerHeight;
        
        if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001) {
          notifyUserInput();
          console.log('[Fly Mode] 单指触摸旋转:', { dx: dx.toFixed(4), dy: dy.toFixed(4) });
        }

        // 使用 Camera 类的 rotate 方法
        cameraRef.current.rotate(dx, -dy);
        updateViewMatrix(cameraRef.current);
        touchStartRef.current = {
          x: e.touches[0].clientX,
          y: e.touches[0].clientY,
          altX: 0,
          altY: 0,
        };
      } else if (e.touches.length === 2 && touchStartRef.current.altX > 0) {
        const dtheta =
          Math.atan2(touchStartRef.current.y - touchStartRef.current.altY, touchStartRef.current.x - touchStartRef.current.altX) -
          Math.atan2(e.touches[0].clientY - e.touches[1].clientY, e.touches[0].clientX - e.touches[1].clientX);
        const dscale =
          Math.hypot(touchStartRef.current.x - touchStartRef.current.altX, touchStartRef.current.y - touchStartRef.current.altY) /
          Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        const dx = (e.touches[0].clientX + e.touches[1].clientX - (touchStartRef.current.x + touchStartRef.current.altX)) / 2;
        const dy = (e.touches[0].clientY + e.touches[1].clientY - (touchStartRef.current.y + touchStartRef.current.altY)) / 2;

        if (Math.abs(dtheta) > 0.001 || Math.abs(dscale - 1) > 0.001 || Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) {
          notifyUserInput();
          console.log('[Fly Mode] 双指触摸操作:', { dtheta: dtheta.toFixed(4), dscale: dscale.toFixed(4), dx: dx.toFixed(2), dy: dy.toFixed(2) });
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
  }, [enabled, canvasRef, viewMatrixRef, updateViewMatrix, notifyUserInput]);

  // 在渲染循环中处理键盘输入（使用 Camera 类）
  const updateCameraFromInput = useCallback((deltaTime) => {
    if (!enabled || !cameraRef.current) {
      return;
    }

    // 确保是 Camera 实例
    if (!(cameraRef.current instanceof Camera)) {
      try {
        cameraRef.current = Camera.fromPlainObject(cameraRef.current);
      } catch (error) {
        console.error('[useFpsCameraControl] Failed to convert camera to Camera instance:', error);
        return;
      }
    }

    const camera = cameraRef.current;
    const shiftKey = activeKeysRef.current.includes('Shift') || 
                     activeKeysRef.current.includes('ShiftLeft') || 
                     activeKeysRef.current.includes('ShiftRight');

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
    
    if (hasWASD || hasSpace || hasShiftAlt || hasArrowKeys) {
      notifyUserInput(true);
    }

    const speedMultiplier = cameraSpeedMultiplierRef.current;
    const moveSpeed = speedMultiplier * deltaTime * 60;

    let moved = false;
    const moveActions = [];

    // W/S：前进/后退
    if (activeKeysRef.current.includes('KeyW')) {
      camera.moveLocal(0, 0, moveSpeed);
      moved = true;
      moveActions.push('前进');
    }
    if (activeKeysRef.current.includes('KeyS')) {
      camera.moveLocal(0, 0, -moveSpeed);
      moved = true;
      moveActions.push('后退');
    }

    // A/D：左移/右移
    if (activeKeysRef.current.includes('KeyA')) {
      camera.moveLocal(-moveSpeed, 0, 0);
      moved = true;
      moveActions.push('左移');
    }
    if (activeKeysRef.current.includes('KeyD')) {
      camera.moveLocal(moveSpeed, 0, 0);
      moved = true;
      moveActions.push('右移');
    }

    // 空格：上升
    if (hasSpace) {
      const worldUp = worldUpRef.current || camera.worldUp;
      camera.moveWorld(-worldUp[0] * moveSpeed, -worldUp[1] * moveSpeed, -worldUp[2] * moveSpeed);
      moved = true;
      moveActions.push('上升');
    }

    // Shift / Alt：下降
    if (hasShiftAlt) {
      const worldUp = worldUpRef.current || camera.worldUp;
      camera.moveWorld(worldUp[0] * moveSpeed, worldUp[1] * moveSpeed, worldUp[2] * moveSpeed);
      moved = true;
      moveActions.push('下降');
    }

    if (moved) {
      console.log('[Fly Mode] 键盘移动:', { 
        actions: moveActions.join(', '), 
        moveSpeed: moveSpeed.toFixed(4), 
        deltaTime: deltaTime != null ? deltaTime.toFixed(4) : 'undefined' 
      });
    }

    // 方向键：控制 yaw/pitch
    const rotateSpeed = 0.02 * deltaTime * 60;
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
    
    if (dYaw !== 0 || dPitch !== 0) {
      console.log('[Fly Mode] 方向键旋转:', { dYaw: dYaw.toFixed(4), dPitch: dPitch.toFixed(4), rotateSpeed: rotateSpeed.toFixed(4) });
      applyYawPitchRotation(dYaw, dPitch);
    }

    // 焦距调整
    if (activeKeysRef.current.includes('BracketLeft')) {
      camera.fx /= 1.01;
      camera.fy /= 1.01;
      camera.moveLocal(0, 0, 0.1);
    }
    if (activeKeysRef.current.includes('BracketRight')) {
      camera.fx *= 1.01;
      camera.fy *= 1.01;
      camera.moveLocal(0, 0, -0.1);
    }

    // 自动旋转（carousel）
    if (carouselRef.current) {
      // 暂时跳过
    }

    // 游戏手柄支持
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    let hasGamepadInput = false;
    for (const gamepad of gamepads) {
      if (!gamepad) continue;

      const axisThreshold = 0.1;
      const moveSpeed = 0.06;
      const rotateSpeed = 0.02;

      if (Math.abs(gamepad.axes[0]) > axisThreshold) {
        camera.moveLocal(moveSpeed * gamepad.axes[0], 0, 0);
        hasGamepadInput = true;
      }
      if (Math.abs(gamepad.axes[1]) > axisThreshold) {
        camera.moveLocal(0, 0, -moveSpeed * gamepad.axes[1]);
        hasGamepadInput = true;
      }
      if (gamepad.buttons[12]?.pressed || gamepad.buttons[13]?.pressed) {
        camera.moveWorld(0, -moveSpeed * (gamepad.buttons[12]?.pressed - gamepad.buttons[13]?.pressed), 0);
        hasGamepadInput = true;
      }
      if (gamepad.buttons[14]?.pressed || gamepad.buttons[15]?.pressed) {
        camera.moveLocal(-moveSpeed * (gamepad.buttons[14]?.pressed - gamepad.buttons[15]?.pressed), 0, 0);
        hasGamepadInput = true;
      }
      if (Math.abs(gamepad.axes[2]) > axisThreshold) {
        camera.rotate(rotateSpeed * gamepad.axes[2], 0);
        hasGamepadInput = true;
      }
      if (Math.abs(gamepad.axes[3]) > axisThreshold) {
        camera.rotate(0, -rotateSpeed * gamepad.axes[3]);
        hasGamepadInput = true;
      }
      // 注意：tilt (roll) 在 FPS 模式下通常不使用
    }
    
    if (hasGamepadInput) {
      notifyUserInput(true);
    }

    // 同步更新 viewMatrixRef
    updateViewMatrix(camera);
  }, [enabled, cameraRef, updateViewMatrix, notifyUserInput, applyYawPitchRotation, cameraSpeedMultiplier]);

  return {
    updateCameraFromInput,
    activeKeys: activeKeysRef.current,
    carousel: carouselRef.current,
  };
}
