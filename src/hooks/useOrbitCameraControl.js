import { useEffect, useRef, useCallback } from 'react';
import { invert4, translate4, rotate4, getViewMatrix, multiply4 } from '../core/utils/webgl';
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
  enabled = true  // 是否启用此控制模式
) {
  const activeKeysRef = useRef([]);
  const mouseDownRef = useRef(false);
  const mouseStartRef = useRef({ x: 0, y: 0 });
  const touchStartRef = useRef({ x: 0, y: 0, altX: 0, altY: 0 });
  const currentCameraIndexRef = useRef(0);
  const worldUpRef = useRef(null);
  const cameraSpeedMultiplierRef = useRef(cameraSpeedMultiplier);
  
  // Orbit 模式特有的状态：目标点和距离
  const targetRef = useRef([0, 0, 0]); // 目标点（世界坐标）
  const distanceRef = useRef(5.0); // 相机到目标点的距离
  const targetDistanceRef = useRef(5.0); // 目标距离（用于平滑缩放）
  
  // 旋转状态
  const rotationXRef = useRef(0); // 绕X轴的旋转（pitch）
  const rotationYRef = useRef(0); // 绕Y轴的旋转（yaw）
  
  cameraSpeedMultiplierRef.current = cameraSpeedMultiplier;

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
    if (!cameraRef.current || !(cameraRef.current instanceof Camera)) {
      return;
    }
    
    const camera = cameraRef.current;
    const cameraPos = camera.position;
    
    // 提取 forward 向量（从 rotation 矩阵）
    const rotation = camera.rotation;
    const forward = [rotation[0][2], rotation[1][2], rotation[2][2]];
    
    // 估算目标点：相机位置 - forward * distance
    const normalize = (v) => {
      const len = Math.hypot(v[0], v[1], v[2]);
      return len > 1e-6 ? [v[0] / len, v[1] / len, v[2] / len] : [0, 0, 1];
    };
    const forwardNorm = normalize(forward);
    
    const estimatedTarget = [
      cameraPos[0] - forwardNorm[0] * distanceRef.current,
      cameraPos[1] - forwardNorm[1] * distanceRef.current,
      cameraPos[2] - forwardNorm[2] * distanceRef.current
    ];
    
    targetRef.current = estimatedTarget;
  }, [cameraRef]);

  // 根据目标点、距离和旋转计算视图矩阵
  const computeViewMatrix = useCallback(() => {
    const target = targetRef.current;
    const distance = distanceRef.current;
    const rotX = rotationXRef.current;
    const rotY = rotationYRef.current;
    
    const worldUp = worldUpRef.current || [0, 1, 0];
    
    // 计算相机位置：从目标点出发，根据旋转计算偏移
    // 先绕Y轴旋转（水平旋转），再绕X轴旋转（垂直旋转）
    const cosY = Math.cos(rotY);
    const sinY = Math.sin(rotY);
    const cosX = Math.cos(rotX);
    const sinX = Math.sin(rotX);
    
    // 计算相机相对于目标点的偏移
    // 初始方向为 [0, 0, distance]（相机在目标点前方）
    // 先绕Y轴旋转（水平）
    const offsetX = distance * sinY * cosX;
    const offsetY = distance * sinX;
    const offsetZ = distance * cosY * cosX;
    
    // 计算相机位置
    const cameraPos = [
      target[0] + offsetX,
      target[1] + offsetY,
      target[2] + offsetZ
    ];
    
    // 计算相机的 right, up, forward 向量
    const forward = [
      target[0] - cameraPos[0],
      target[1] - cameraPos[1],
      target[2] - cameraPos[2]
    ];
    
    const normalize = (v) => {
      const len = Math.hypot(v[0], v[1], v[2]);
      return len > 1e-6 ? [v[0] / len, v[1] / len, v[2] / len] : [0, 0, 1];
    };
    
    const forwardNorm = normalize(forward);
    
    // 计算 right 向量（forward × worldUp）
    const cross = (a, b) => [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
    
    let right = cross(forwardNorm, worldUp);
    const rightLen = Math.hypot(right[0], right[1], right[2]);
    if (rightLen < 1e-6) {
      // forward 与 worldUp 平行，使用默认方向
      const defaultRight = Math.abs(forwardNorm[0]) < 0.9 
        ? normalize([1, 0, 0])
        : normalize([0, 1, 0]);
      right = defaultRight;
    } else {
      right = normalize(right);
    }
    
    // 计算 up 向量（right × forward）
    const up = normalize(cross(right, forwardNorm));
    
    // 更新 Camera 实例
    if (!cameraRef.current || !(cameraRef.current instanceof Camera)) {
      // 如果没有 Camera 实例，创建一个
      const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      const forwardUpComponent = dot(forwardNorm, worldUp);
      const pitchRad = Math.asin(Math.max(-1, Math.min(1, forwardUpComponent)));
      
      let forwardHorizontal = [
        forwardNorm[0] - forwardUpComponent * worldUp[0],
        forwardNorm[1] - forwardUpComponent * worldUp[1],
        forwardNorm[2] - forwardUpComponent * worldUp[2],
      ];
      const forwardHorizontalLen = Math.hypot(forwardHorizontal[0], forwardHorizontal[1], forwardHorizontal[2]);
      if (forwardHorizontalLen < 1e-6) {
        forwardHorizontal = [Math.cos(rotY), 0, Math.sin(rotY)];
      } else {
        forwardHorizontal = normalize(forwardHorizontal);
      }
      
      cameraRef.current = new Camera({
        position: cameraPos,
        yawRad: rotY,
        pitchRad: pitchRad,
        forwardHorizontalRef: forwardHorizontal,
        worldUp: worldUp,
        fx: 1000,
        fy: 1000,
      });
    } else {
      // 计算 pitch（从 forward 和 worldUp 计算）
      const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
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
        forwardHorizontal = [Math.cos(rotY), 0, Math.sin(rotY)];
      } else {
        forwardHorizontal = normalize(forwardHorizontal);
      }
      
      cameraRef.current.position = cameraPos;
      cameraRef.current.yawRad = rotY;
      cameraRef.current.pitchRad = pitchRad;
      cameraRef.current.forwardHorizontalRef = forwardHorizontal;
      cameraRef.current.worldUp = worldUp;
    }
    
    return cameraRef.current.viewMatrix;
  }, [cameraRef]);

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

      // Orbit 模式：鼠标拖拽旋转相机围绕目标点
      const sensitivity = 0.005;
      const dYaw = dx * sensitivity;
      const dPitch = dy * sensitivity;
      rotationYRef.current += dYaw; // 水平旋转（yaw）
      rotationXRef.current = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, rotationXRef.current + dPitch)); // 垂直旋转（pitch）

      console.log('[Orbit Mode] 鼠标拖拽旋转:', { 
        dx, 
        dy, 
        dYaw: dYaw.toFixed(4), 
        dPitch: dPitch.toFixed(4),
        rotationY: rotationYRef.current.toFixed(4),
        rotationX: rotationXRef.current.toFixed(4),
        target: targetRef.current.map(v => v.toFixed(2)),
        distance: distanceRef.current.toFixed(2)
      });

      const newViewMatrix = computeViewMatrix();
      updateViewMatrix(newViewMatrix);
      
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
  }, [enabled, canvasRef, viewMatrixRef, updateViewMatrix, notifyUserInput, computeViewMatrix, disableLeftMouseButton]);

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
      
      console.log('[Orbit Mode] 滚轮缩放:', { 
        deltaY: e.deltaY, 
        delta: delta.toFixed(4),
        oldDistance: oldDistance.toFixed(2),
        newDistance: targetDistanceRef.current.toFixed(2),
        currentDistance: distanceRef.current.toFixed(2)
      });
      
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
          console.log('[Orbit Mode] 单指触摸旋转:', { 
            dx: dx.toFixed(4), 
            dy: dy.toFixed(4),
            rotationY: rotationYRef.current.toFixed(4),
            rotationX: rotationXRef.current.toFixed(4)
          });
        }

        rotationYRef.current += dx;
        rotationXRef.current = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, rotationXRef.current + dy));

        const newViewMatrix = computeViewMatrix();
        updateViewMatrix(newViewMatrix);
        
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
          const oldDistance = targetDistanceRef.current;
          console.log('[Orbit Mode] 双指触摸缩放:', { 
            dscale: dscale.toFixed(4),
            oldDistance: oldDistance.toFixed(2),
            newDistance: (oldDistance * dscale).toFixed(2)
          });
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
  }, [enabled, canvasRef, viewMatrixRef, updateViewMatrix, notifyUserInput, computeViewMatrix]);

  // 在渲染循环中处理键盘输入（Orbit模式：WASD移动目标点）
  const updateCameraFromInput = useCallback((deltaTime) => {
    if (!enabled || !viewMatrixRef.current) return; // 如果未启用，不处理输入

    const speedMultiplier = cameraSpeedMultiplierRef.current;
    const moveSpeed = speedMultiplier * deltaTime * 60;

    // 从当前视图矩阵提取方向向量
    const right = [
      viewMatrixRef.current[0],
      viewMatrixRef.current[1],
      viewMatrixRef.current[2]
    ];
    const up = [
      viewMatrixRef.current[4],
      viewMatrixRef.current[5],
      viewMatrixRef.current[6]
    ];
    const forward = [
      viewMatrixRef.current[8],
      viewMatrixRef.current[9],
      viewMatrixRef.current[10]
    ];

    const normalize = (v) => {
      const len = Math.hypot(v[0], v[1], v[2]);
      return len > 1e-6 ? [v[0] / len, v[1] / len, v[2] / len] : [0, 0, 1];
    };

    const rightNorm = normalize(right);
    const upNorm = normalize(up);
    const forwardNorm = normalize(forward);

    let targetMoved = false;
    const moveActions = [];
    const oldTarget = [...targetRef.current];

    // W/S：前后移动目标点
    if (activeKeysRef.current.includes('KeyW')) {
      targetRef.current[0] += forwardNorm[0] * moveSpeed;
      targetRef.current[1] += forwardNorm[1] * moveSpeed;
      targetRef.current[2] += forwardNorm[2] * moveSpeed;
      targetMoved = true;
      moveActions.push('目标点前进');
    }
    if (activeKeysRef.current.includes('KeyS')) {
      targetRef.current[0] -= forwardNorm[0] * moveSpeed;
      targetRef.current[1] -= forwardNorm[1] * moveSpeed;
      targetRef.current[2] -= forwardNorm[2] * moveSpeed;
      targetMoved = true;
      moveActions.push('目标点后退');
    }

    // A/D：左右移动目标点
    if (activeKeysRef.current.includes('KeyA')) {
      targetRef.current[0] -= rightNorm[0] * moveSpeed;
      targetRef.current[1] -= rightNorm[1] * moveSpeed;
      targetRef.current[2] -= rightNorm[2] * moveSpeed;
      targetMoved = true;
      moveActions.push('目标点左移');
    }
    if (activeKeysRef.current.includes('KeyD')) {
      targetRef.current[0] += rightNorm[0] * moveSpeed;
      targetRef.current[1] += rightNorm[1] * moveSpeed;
      targetRef.current[2] += rightNorm[2] * moveSpeed;
      targetMoved = true;
      moveActions.push('目标点右移');
    }

    // Space/Shift：上下移动目标点
    const hasSpace = activeKeysRef.current.includes('Space');
    const shiftKey = activeKeysRef.current.includes('Shift') || 
                     activeKeysRef.current.includes('ShiftLeft') || 
                     activeKeysRef.current.includes('ShiftRight');
    const hasShiftAlt = shiftKey || 
                        activeKeysRef.current.includes('AltLeft') || 
                        activeKeysRef.current.includes('AltRight');

    if (hasSpace) {
      targetRef.current[0] += upNorm[0] * moveSpeed;
      targetRef.current[1] += upNorm[1] * moveSpeed;
      targetRef.current[2] += upNorm[2] * moveSpeed;
      targetMoved = true;
      moveActions.push('目标点上升');
    }
    if (hasShiftAlt) {
      targetRef.current[0] -= upNorm[0] * moveSpeed;
      targetRef.current[1] -= upNorm[1] * moveSpeed;
      targetRef.current[2] -= upNorm[2] * moveSpeed;
      targetMoved = true;
      moveActions.push('目标点下降');
    }

    if (targetMoved) {
      const targetDelta = [
        targetRef.current[0] - oldTarget[0],
        targetRef.current[1] - oldTarget[1],
        targetRef.current[2] - oldTarget[2]
      ];
      console.log('[Orbit Mode] 键盘移动目标点:', { 
        actions: moveActions.join(', '),
        moveSpeed: moveSpeed.toFixed(4),
        deltaTime: deltaTime != null ? deltaTime.toFixed(4) : 'undefined',
        oldTarget: oldTarget.map(v => v.toFixed(2)),
        newTarget: targetRef.current.map(v => v.toFixed(2)),
        targetDelta: targetDelta.map(v => v.toFixed(4)),
        distance: distanceRef.current.toFixed(2)
      });
      notifyUserInput(true);
      // 平滑过渡距离
      distanceRef.current += (targetDistanceRef.current - distanceRef.current) * 0.1;
      const newViewMatrix = computeViewMatrix();
      updateViewMatrix(newViewMatrix);
    } else {
      // 即使没有移动，也要平滑过渡距离
      if (Math.abs(targetDistanceRef.current - distanceRef.current) > 0.001) {
        distanceRef.current += (targetDistanceRef.current - distanceRef.current) * 0.1;
        const newViewMatrix = computeViewMatrix();
        updateViewMatrix(newViewMatrix);
      }
    }
  }, [enabled, viewMatrixRef, updateViewMatrix, notifyUserInput, computeViewMatrix, cameraSpeedMultiplier]);

  return {
    updateCameraFromInput,
    activeKeys: activeKeysRef.current,
    carousel: false,
  };
}
