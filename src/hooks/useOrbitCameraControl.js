import { useEffect, useRef, useCallback } from 'react';
import { Camera } from '../core/utils/Camera';
import { globalGizmoDragging } from '../utils/gizmoState';

/**
 * Orbit 风格相机控制 Hook
 * 实现轨道相机控制：相机围绕目标点旋转，鼠标拖拽旋转，滚轮缩放
 */
export function useOrbitCameraControl(
  canvasRef,
  viewMatrixRef,
  cameraRef,
  camerasRef,
  onViewMatrixChange,
  onCameraChange,
  camerasVersion = 0,
  worldUpPitchAdjust = 0,
  onNotifyUserInput = null,
  disableLeftMouseButton = false,
  cameraSpeedMultiplier = 0.5,
  initialOrbitRadius = 15,
  minOrbitRadius = 0.6,
  enabled = true  // 是否启用此控制模式
) {
  const activeKeysRef = useRef([]);
  const mouseDownRef = useRef(false);
  const mouseStartRef = useRef({ x: 0, y: 0 });
  const touchStartRef = useRef({ x: 0, y: 0, altX: 0, altY: 0 });
  const currentCameraIndexRef = useRef(0);
  const worldUpRef = useRef(null);
  const cameraSpeedMultiplierRef = useRef(cameraSpeedMultiplier);
  const minOrbitRadiusRef = useRef(minOrbitRadius);
  
  // Orbit 模式特有的状态：目标点和距离
  const targetRef = useRef([0, 0, 0]); // 目标点（世界坐标）
  const distanceRef = useRef(initialOrbitRadius); // 相机到目标点的距离
  const targetDistanceRef = useRef(initialOrbitRadius); // 目标距离（用于平滑缩放）
  
  cameraSpeedMultiplierRef.current = cameraSpeedMultiplier;
  minOrbitRadiusRef.current = minOrbitRadius;

  const normalize = useCallback((v, fallback = [0, 0, 1]) => {
    const len = Math.hypot(v[0], v[1], v[2]);
    return len > 1e-6 ? [v[0] / len, v[1] / len, v[2] / len] : [...fallback];
  }, []);

  const dot = useCallback((a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], []);

  const cross = useCallback((a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ], []);

  const rotateAroundAxis = useCallback((v, axis, rad) => {
    const u = normalize(axis, [0, 1, 0]);
    const [x, y, z] = u;
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    const dotVal = dot(v, u);
    return [
      v[0] * c + (y * v[2] - z * v[1]) * s + x * dotVal * (1 - c),
      v[1] * c + (z * v[0] - x * v[2]) * s + y * dotVal * (1 - c),
      v[2] * c + (x * v[1] - y * v[0]) * s + z * dotVal * (1 - c),
    ];
  }, [dot, normalize]);

  // 更新视图矩阵（从 Camera 实例同步）
  const updateViewMatrix = useCallback((camera) => {
    if (globalGizmoDragging.current) {
      return;
    }
    if (camera && camera instanceof Camera) {
      const newViewMatrix = camera.viewMatrix;
      viewMatrixRef.current = newViewMatrix;
      if (onViewMatrixChange) {
        onViewMatrixChange(newViewMatrix);
      }
    } else if (Array.isArray(camera) && camera.length === 16) {
      // 向后兼容：直接传入矩阵
      viewMatrixRef.current = camera;
      if (onViewMatrixChange) {
        onViewMatrixChange(camera);
      }
    }
  }, [viewMatrixRef, onViewMatrixChange]);

  // 从视图矩阵计算目标点和距离（使用 Camera 类）
  const updateTargetAndDistance = useCallback(() => {
    if (!cameraRef.current) {
      return;
    }

    if (!(cameraRef.current instanceof Camera)) {
      try {
        cameraRef.current = Camera.fromPlainObject(cameraRef.current);
      } catch (error) {
        console.error('[useOrbitCameraControl] Failed to convert camera to Camera instance:', error);
        return;
      }
    }

    const camera = cameraRef.current;
    const cameraPos = camera.position;

    // 提取 forward 向量（从 rotation 矩阵）
    const rotation = camera.rotation;
    const forward = [rotation[0][2], rotation[1][2], rotation[2][2]];

    const forwardNorm = normalize(forward, [0, 0, 1]);

    // 使用 orbit 半径计算支点（相机前方）
    const orbitRadius = Math.max(0.1, distanceRef.current);
    const pivot = [
      cameraPos[0] + forwardNorm[0] * orbitRadius,
      cameraPos[1] + forwardNorm[1] * orbitRadius,
      cameraPos[2] + forwardNorm[2] * orbitRadius,
    ];

    targetRef.current = pivot;
    distanceRef.current = orbitRadius;
    targetDistanceRef.current = orbitRadius;
  }, [cameraRef, normalize]);

  // 根据目标点、距离和当前相机方向计算视图矩阵
  const computeViewMatrix = useCallback(() => {
    if (!cameraRef.current) {
      return viewMatrixRef.current;
    }

    if (!(cameraRef.current instanceof Camera)) {
      try {
        cameraRef.current = Camera.fromPlainObject(cameraRef.current);
      } catch (error) {
        console.error('[useOrbitCameraControl] Failed to convert camera to Camera instance:', error);
        return viewMatrixRef.current;
      }
    }

    const camera = cameraRef.current;
    const worldUp = worldUpRef.current || camera.worldUp || [0, 1, 0];
    const target = targetRef.current;
    const distance = Math.max(0.1, distanceRef.current);

    const cameraPos = camera.position;
    let offset = [
      cameraPos[0] - target[0],
      cameraPos[1] - target[1],
      cameraPos[2] - target[2],
    ];
    let offsetLen = Math.hypot(offset[0], offset[1], offset[2]);
    if (offsetLen < 1e-6) {
      offset = [0, 0, distance];
      offsetLen = distance;
    }
    const scale = distance / offsetLen;
    offset = [offset[0] * scale, offset[1] * scale, offset[2] * scale];

    const newCameraPos = [
      target[0] + offset[0],
      target[1] + offset[1],
      target[2] + offset[2],
    ];

    const forward = normalize([
      target[0] - newCameraPos[0],
      target[1] - newCameraPos[1],
      target[2] - newCameraPos[2],
    ], [0, 0, 1]);

    const forwardUpComponent = dot(forward, worldUp);
    const pitchRad = Math.asin(Math.max(-1, Math.min(1, forwardUpComponent)));

    let forwardHorizontal = [
      forward[0] - forwardUpComponent * worldUp[0],
      forward[1] - forwardUpComponent * worldUp[1],
      forward[2] - forwardUpComponent * worldUp[2],
    ];
    const forwardHorizontalLen = Math.hypot(forwardHorizontal[0], forwardHorizontal[1], forwardHorizontal[2]);
    if (forwardHorizontalLen < 1e-6) {
      const fallbackRight = normalize(cross(worldUp, [1, 0, 0]), [1, 0, 0]);
      forwardHorizontal = normalize(cross(fallbackRight, worldUp), [0, 0, 1]);
    } else {
      forwardHorizontal = normalize(forwardHorizontal);
    }

    camera.position = newCameraPos;
    camera.yawRad = 0;
    camera.pitchRad = pitchRad;
    camera.forwardHorizontalRef = forwardHorizontal;
    camera.worldUp = worldUp;

    return camera.viewMatrix;
  }, [cameraRef, cross, dot, normalize, viewMatrixRef]);

  const focusOnTarget = useCallback((target) => {
    if (!cameraRef.current || !Array.isArray(target) || target.length !== 3) {
      return;
    }

    if (!(cameraRef.current instanceof Camera)) {
      try {
        cameraRef.current = Camera.fromPlainObject(cameraRef.current);
      } catch (error) {
        console.error('[useOrbitCameraControl] Failed to convert camera to Camera instance:', error);
        return;
      }
    }

    const camera = cameraRef.current;
    const rotation = camera.rotation;
    const forward = normalize([rotation[0][2], rotation[1][2], rotation[2][2]], [0, 0, 1]);
    const cameraPos = camera.position;
    const toTarget = [
      target[0] - cameraPos[0],
      target[1] - cameraPos[1],
      target[2] - cameraPos[2],
    ];
    const planeDistance = Math.abs(dot(forward, toTarget));
    const orbitRadius = Math.max(0.1, planeDistance);
    const newPos = [
      target[0] - forward[0] * orbitRadius,
      target[1] - forward[1] * orbitRadius,
      target[2] - forward[2] * orbitRadius,
    ];

    camera.position = newPos;
    targetRef.current = [...target];
    distanceRef.current = orbitRadius;
    targetDistanceRef.current = orbitRadius;
    updateViewMatrix(camera);
  }, [cameraRef, normalize, dot, updateViewMatrix]);

  const applyOrbitRotation = useCallback((dYaw, dPitch) => {
    if (globalGizmoDragging.current) {
      return;
    }

    if (!cameraRef.current) {
      return;
    }

    if (!(cameraRef.current instanceof Camera)) {
      try {
        cameraRef.current = Camera.fromPlainObject(cameraRef.current);
      } catch (error) {
        console.error('[useOrbitCameraControl] Failed to convert camera to Camera instance:', error);
        return;
      }
    }

    const camera = cameraRef.current;
    const worldUp = worldUpRef.current || camera.worldUp || [0, 1, 0];
    const cameraPos = camera.position;
    const rotation = camera.rotation;
    const forward = normalize([rotation[0][2], rotation[1][2], rotation[2][2]], [0, 0, 1]);

    const orbitRadius = Math.max(0.1, distanceRef.current);
    const pivot = [
      cameraPos[0] + forward[0] * orbitRadius,
      cameraPos[1] + forward[1] * orbitRadius,
      cameraPos[2] + forward[2] * orbitRadius,
    ];
    targetRef.current = pivot;

    let offset = [
      cameraPos[0] - pivot[0],
      cameraPos[1] - pivot[1],
      cameraPos[2] - pivot[2],
    ];

    if (Math.abs(dYaw) > 1e-6) {
      offset = rotateAroundAxis(offset, worldUp, dYaw);
    }

    let forwardAfterYaw = normalize([-offset[0], -offset[1], -offset[2]], [0, 0, 1]);
    const currentPitch = Math.asin(Math.max(-1, Math.min(1, dot(forwardAfterYaw, worldUp))));
    const nextPitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, currentPitch + dPitch));
    const appliedPitch = nextPitch - currentPitch;

    if (Math.abs(appliedPitch) > 1e-6) {
      let right = cross(worldUp, forwardAfterYaw);
      right = normalize(right, [1, 0, 0]);
      offset = rotateAroundAxis(offset, right, appliedPitch);
    }

    const newCameraPos = [
      pivot[0] + offset[0],
      pivot[1] + offset[1],
      pivot[2] + offset[2],
    ];

    const newForward = normalize([
      pivot[0] - newCameraPos[0],
      pivot[1] - newCameraPos[1],
      pivot[2] - newCameraPos[2],
    ], [0, 0, 1]);

    const forwardUpComponent = dot(newForward, worldUp);
    const pitchRad = Math.asin(Math.max(-1, Math.min(1, forwardUpComponent)));

    let forwardHorizontal = [
      newForward[0] - forwardUpComponent * worldUp[0],
      newForward[1] - forwardUpComponent * worldUp[1],
      newForward[2] - forwardUpComponent * worldUp[2],
    ];
    const forwardHorizontalLen = Math.hypot(forwardHorizontal[0], forwardHorizontal[1], forwardHorizontal[2]);
    if (forwardHorizontalLen < 1e-6) {
      const fallbackRight = normalize(cross(worldUp, [1, 0, 0]), [1, 0, 0]);
      forwardHorizontal = normalize(cross(fallbackRight, worldUp), [0, 0, 1]);
    } else {
      forwardHorizontal = normalize(forwardHorizontal);
    }

    camera.position = newCameraPos;
    camera.yawRad = 0;
    camera.pitchRad = pitchRad;
    camera.forwardHorizontalRef = forwardHorizontal;
    camera.worldUp = worldUp;

    distanceRef.current = orbitRadius;
    updateViewMatrix(camera);
  }, [cameraRef, cross, dot, normalize, rotateAroundAxis, updateViewMatrix]);

  // 初始化世界的"上"方向
  useEffect(() => {
    if (camerasRef.current && camerasRef.current.length > 0) {
      const initialCamIndex = camerasRef.current.length >= 3 ? 1 : 0;
      const initialCam = camerasRef.current[initialCamIndex];
      
      if (initialCam && initialCam.worldUp) {
        worldUpRef.current = initialCam.worldUp;
      } else if (initialCam && initialCam.rotation) {
        const normalize = (v) => {
          const len = Math.hypot(v[0], v[1], v[2]);
          return len > 1e-6 ? [v[0] / len, v[1] / len, v[2] / len] : [0, 1, 0];
        };
        
        const r = initialCam.rotation.flat();
        const initialUp = [r[1], r[4], r[7]];
        worldUpRef.current = normalize(initialUp);
      } else {
        worldUpRef.current = [0, 1, 0];
      }
      
      // 初始化目标点和距离
      if (viewMatrixRef.current) {
        updateTargetAndDistance();
      }
    }
  }, [camerasVersion, worldUpPitchAdjust, viewMatrixRef, updateTargetAndDistance]);

  // 通知外部有用户输入
  const notifyUserInput = useCallback((hasUserInput = true) => {
    if (onNotifyUserInput && hasUserInput) {
      onNotifyUserInput(hasUserInput);
    }
  }, [onNotifyUserInput]);

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
      
      const isViewControlKey = ['KeyA', 'KeyD', 'KeyW', 'KeyS', 'Space', 
                                'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight'].includes(e.code);
      
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
          let cam = camerasRef.current[index];
          // 确保是 Camera 实例
          if (!(cam instanceof Camera)) {
            cam = Camera.fromPlainObject(cam);
            camerasRef.current[index] = cam;
          }
          cameraRef.current = cam;
          updateViewMatrix(cam);
          updateTargetAndDistance();
          notifyUserInput();
          if (onCameraChange) onCameraChange(cam, index);
        }
      }

      // +/- 切换相机
      if (['-', '_'].includes(e.key) && camerasRef.current) {
        currentCameraIndexRef.current = (currentCameraIndexRef.current + camerasRef.current.length - 1) % camerasRef.current.length;
        let cam = camerasRef.current[currentCameraIndexRef.current];
        if (!(cam instanceof Camera)) {
          cam = Camera.fromPlainObject(cam);
          camerasRef.current[currentCameraIndexRef.current] = cam;
        }
        cameraRef.current = cam;
        updateViewMatrix(cam);
        updateTargetAndDistance();
        notifyUserInput();
        if (onCameraChange) onCameraChange(cam, currentCameraIndexRef.current);
      }
      if (['+', '='].includes(e.key) && camerasRef.current) {
        currentCameraIndexRef.current = (currentCameraIndexRef.current + 1) % camerasRef.current.length;
        let cam = camerasRef.current[currentCameraIndexRef.current];
        if (!(cam instanceof Camera)) {
          cam = Camera.fromPlainObject(cam);
          camerasRef.current[currentCameraIndexRef.current] = cam;
        }
        cameraRef.current = cam;
        updateViewMatrix(cam);
        updateTargetAndDistance();
        notifyUserInput();
        if (onCameraChange) onCameraChange(cam, currentCameraIndexRef.current);
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
  }, [enabled, viewMatrixRef, camerasRef, updateViewMatrix, onCameraChange, notifyUserInput, updateTargetAndDistance]);

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

      const dx = e.clientX - mouseStartRef.current.x;
      const dy = e.clientY - mouseStartRef.current.y;

      if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) {
        notifyUserInput();
      }

      // Orbit 模式：鼠标拖拽旋转相机围绕支点
      const sensitivity = 0.005;
      const dYaw = dx * sensitivity;
      const dPitch = -dy * sensitivity;
      applyOrbitRotation(dYaw, dPitch);
      
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
  }, [enabled, canvasRef, viewMatrixRef, updateViewMatrix, notifyUserInput, applyOrbitRotation, disableLeftMouseButton]);

  // 滚轮控制（缩放）
  useEffect(() => {
    if (!enabled) return; // 如果未启用，不注册事件监听器
    
    const handleWheel = (e) => {
      // Orbit 模式：滚轮缩放（改变距离）
      notifyUserInput();
      e.preventDefault();

      const { innerHeight } = window;
      const lineHeight = 10;
      const scale = e.deltaMode === 1 ? lineHeight : e.deltaMode === 2 ? innerHeight : 1;
      
      // 根据滚轮方向调整距离
      const zoomSpeed = 0.1;
      const delta = e.deltaY * scale * zoomSpeed;
      
      const oldDistance = targetDistanceRef.current;
      targetDistanceRef.current = Math.max(0.1, Math.min(100, targetDistanceRef.current + delta));
      
      // 平滑过渡到目标距离
      distanceRef.current += (targetDistanceRef.current - distanceRef.current) * 0.1;
      
      const newViewMatrix = computeViewMatrix();
      updateViewMatrix(newViewMatrix);
    };

    window.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      window.removeEventListener('wheel', handleWheel);
    };
  }, [enabled, viewMatrixRef, updateViewMatrix, notifyUserInput, computeViewMatrix]);

  // 触摸控制
  useEffect(() => {
    if (!enabled) return; // 如果未启用，不注册事件监听器
    
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleTouchStart = (e) => {
      e.preventDefault();
      if (e.touches.length === 1) {
        notifyUserInput();
        touchStartRef.current = {
          x: e.touches[0].clientX,
          y: e.touches[0].clientY,
          altX: 0,
          altY: 0,
        };
      } else if (e.touches.length === 2) {
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
        
        if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001) {
          notifyUserInput();
        }

        applyOrbitRotation(dx, -dy);
        
        touchStartRef.current = {
          x: e.touches[0].clientX,
          y: e.touches[0].clientY,
          altX: 0,
          altY: 0,
        };
      } else if (e.touches.length === 2 && touchStartRef.current.altX > 0) {
        // 双指：缩放
        const dscale =
          Math.hypot(touchStartRef.current.x - touchStartRef.current.altX, touchStartRef.current.y - touchStartRef.current.altY) /
          Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);

        if (Math.abs(dscale - 1) > 0.001) {
          notifyUserInput();
        }

        targetDistanceRef.current = Math.max(0.1, Math.min(100, targetDistanceRef.current * dscale));
        distanceRef.current += (targetDistanceRef.current - distanceRef.current) * 0.1;

        const newViewMatrix = computeViewMatrix();
        updateViewMatrix(newViewMatrix);
        
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
  }, [enabled, canvasRef, viewMatrixRef, updateViewMatrix, notifyUserInput, applyOrbitRotation, computeViewMatrix]);

  // 在渲染循环中处理键盘输入（Orbit 模式：按 Fly 模式同样的键盘响应）
  const updateCameraFromInput = useCallback((deltaTime) => {
    if (!enabled || !cameraRef.current) {
      return;
    }

    // 确保是 Camera 实例
    if (!(cameraRef.current instanceof Camera)) {
      try {
        cameraRef.current = Camera.fromPlainObject(cameraRef.current);
      } catch (error) {
        console.error('[useOrbitCameraControl] Failed to convert camera to Camera instance:', error);
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
    const beforePos = camera.position;
    const minOrbitRadius = minOrbitRadiusRef.current;

    // W/S：拉近/拉远（同时调整环绕半径，直到阈值）
    const rotation = camera.rotation;
    const forward = normalize([rotation[0][2], rotation[1][2], rotation[2][2]], [0, 0, 1]);
    const hasW = activeKeysRef.current.includes('KeyW');
    const hasS = activeKeysRef.current.includes('KeyS');

    if (hasW) {
      const delta = [forward[0] * moveSpeed, forward[1] * moveSpeed, forward[2] * moveSpeed];
      camera.position = [
        camera.position[0] + delta[0],
        camera.position[1] + delta[1],
        camera.position[2] + delta[2],
      ];
      moved = true;

      if (distanceRef.current > minOrbitRadius) {
        const nextRadius = Math.max(minOrbitRadius, distanceRef.current - moveSpeed);
        distanceRef.current = nextRadius;
        targetDistanceRef.current = nextRadius;
      } else {
        targetRef.current = [
          targetRef.current[0] + delta[0],
          targetRef.current[1] + delta[1],
          targetRef.current[2] + delta[2],
        ];
      }
    }

    if (hasS) {
      const delta = [forward[0] * moveSpeed, forward[1] * moveSpeed, forward[2] * moveSpeed];
      camera.position = [
        camera.position[0] - delta[0],
        camera.position[1] - delta[1],
        camera.position[2] - delta[2],
      ];
      moved = true;

      distanceRef.current += moveSpeed;
      targetDistanceRef.current = distanceRef.current;
    }

    // A/D：左移/右移
    if (activeKeysRef.current.includes('KeyA')) {
      camera.moveLocal(-moveSpeed, 0, 0);
      moved = true;
    }
    if (activeKeysRef.current.includes('KeyD')) {
      camera.moveLocal(moveSpeed, 0, 0);
      moved = true;
    }

    // 空格：上升
    if (hasSpace) {
      const worldUp = worldUpRef.current || camera.worldUp;
      camera.moveWorld(-worldUp[0] * moveSpeed, -worldUp[1] * moveSpeed, -worldUp[2] * moveSpeed);
      moved = true;
    }

    // Shift / Alt：下降
    if (hasShiftAlt) {
      const worldUp = worldUpRef.current || camera.worldUp;
      camera.moveWorld(worldUp[0] * moveSpeed, worldUp[1] * moveSpeed, worldUp[2] * moveSpeed);
      moved = true;
    }

    if (moved) {
      const afterPos = camera.position;
      const delta = [
        afterPos[0] - beforePos[0],
        afterPos[1] - beforePos[1],
        afterPos[2] - beforePos[2],
      ];
      targetRef.current = [
        targetRef.current[0] + delta[0],
        targetRef.current[1] + delta[1],
        targetRef.current[2] + delta[2],
      ];
      updateViewMatrix(camera);
    }

    if (Math.abs(targetDistanceRef.current - distanceRef.current) > 0.001) {
      distanceRef.current += (targetDistanceRef.current - distanceRef.current) * 0.1;
      const newViewMatrix = computeViewMatrix();
      updateViewMatrix(newViewMatrix);
    }
  }, [enabled, cameraRef, updateViewMatrix, notifyUserInput, computeViewMatrix, cameraSpeedMultiplier]);

  return {
    updateCameraFromInput,
    focusOnTarget,
    activeKeys: activeKeysRef.current,
    carousel: false,
  };
}
