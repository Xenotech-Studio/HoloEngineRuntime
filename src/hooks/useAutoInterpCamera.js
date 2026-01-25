import { useEffect, useRef, useCallback } from 'react';
import { getViewMatrix } from '../core/utils/webgl';

/**
 * 自动插值相机控制 Hook
 * 实现相机在左右端点之间的自动插值运动
 */
export function useAutoInterpCamera(
  viewMatrixRef,
  cameraRef,
  camerasRef,
  onViewMatrixChange,
  onCameraChange,
  enabled = false,
  autoInterpDurationMs = 2000,
  camerasVersion = 0,
  worldUpPitchAdjust = 0,
  onInterrupted = null,
  onResume = null,
  onCountdownProgressChange = null,
  onUserInput = null  // 交互控制器通知用户输入的接口
) {
  // 相位系统：使用相位作为索引，0 到 2π，初始为 π/2（对应 50% 进度）
  const phaseRef = useRef(Math.PI / 2); // 初始相位：π/2，对应 50% 插值进度
  const phaseStartTimeRef = useRef(0); // 相位开始时间，用于计算相位增量
  const worldUpRef = useRef(null); // 世界的"上"方向（从初始相机的 UP 方向提取）
  const userInterruptedRef = useRef(false); // 标记用户是否手动中断过自动运镜
  const lastUserActionTimeRef = useRef(0); // 最后一次用户操作的时间戳
  const lastLoggedSecondsRef = useRef(-1); // 上次打印的秒数，用于避免重复打印
  const countdownProgressRef = useRef(0); // 倒计时进度（0-1），从3秒开始计算
  const lastResetTimeRef = useRef(0); // 上次重置倒计时的时间，用于避免重复重置

  const lerp = (a, b, t) => a + (b - a) * t;

  // 根据 yaw 和 pitch 构建旋转矩阵（确保 roll=0）
  const buildRotationFromYawPitch = useCallback((yawRad, pitchRad, worldUp, forwardHorizontalRef) => {
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
  }, []);

  const interpolateCamera = useCallback((fromCam, toCam, t) => {
    const pos = [
      lerp(fromCam.position[0], toCam.position[0], t),
      lerp(fromCam.position[1], toCam.position[1], t),
      lerp(fromCam.position[2], toCam.position[2], t),
    ];

    // 如果两个相机都有 yawRad 和 pitchRad，使用 yaw/pitch 插值
    if (fromCam.yawRad !== undefined && toCam.yawRad !== undefined &&
        fromCam.pitchRad !== undefined && toCam.pitchRad !== undefined &&
        fromCam.forwardHorizontalRef && toCam.forwardHorizontalRef &&
        worldUpRef.current) {
      // 只对 yaw 进行插值，pitch 保持不变（使用 fromCam 的 pitch，因为左右端点相机的 pitch 应该相同）
      const interpolatedYaw = lerp(fromCam.yawRad, toCam.yawRad, t);
      // 保持 pitch 不变（使用 fromCam 的 pitch，因为左右端点相机的 pitch 应该相同）
      const pitch = fromCam.pitchRad;
      // 使用 fromCam 的参考水平方向（左右端点相机应该使用相同的参考方向）
      const forwardHorizontalRef = fromCam.forwardHorizontalRef;
      
      // 根据插值后的 yaw 和 pitch 构建旋转矩阵（确保 roll=0）
      const rotation = buildRotationFromYawPitch(interpolatedYaw, pitch, worldUpRef.current, forwardHorizontalRef);
      
      return {
        ...fromCam,
        position: pos,
        rotation: rotation,
        yawRad: interpolatedYaw,
        pitchRad: pitch,
        forwardHorizontalRef: forwardHorizontalRef, // 保持参考方向
        worldUp: fromCam.worldUp || worldUpRef.current, // 保持 world up
        fx: lerp(fromCam.fx, toCam.fx, t),
        fy: lerp(fromCam.fy, toCam.fy, t),
      };
    }

    // 回退到原来的旋转矩阵插值方法
    const rotA = fromCam.rotation.flat();
    const rotB = toCam.rotation.flat();
    const rot = rotA.map((v, i) => lerp(v, rotB[i], t));
    
    // Orthonormalize
    let a = rot.slice(0, 3);
    let b = rot.slice(3, 6);
    let c = rot.slice(6, 9);
    const normalize = (v) => {
      const len = Math.hypot(v[0], v[1], v[2]) || 1;
      return [v[0] / len, v[1] / len, v[2] / len];
    };
    const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    const sub = (u, v) => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
    const cross = (a, b) => [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
    a = normalize(a);
    b = sub(b, [dot(a, b) * a[0], dot(a, b) * a[1], dot(a, b) * a[2]]);
    b = normalize(b);
    c = cross(a, b);

    return {
      ...fromCam,
      position: pos,
      rotation: [a, b, c],
      fx: lerp(fromCam.fx, toCam.fx, t),
      fy: lerp(fromCam.fy, toCam.fy, t),
    };
  }, [buildRotationFromYawPitch]);

  // 更新视图矩阵
  const updateViewMatrix = useCallback((newViewMatrix) => {
    viewMatrixRef.current = newViewMatrix;
    if (onViewMatrixChange) {
      onViewMatrixChange(newViewMatrix);
    }
  }, [viewMatrixRef, onViewMatrixChange]);

  // 中断自动插值
  const interruptAutoInterp = useCallback((hasUserInput = true) => {
    const wasActive = phaseStartTimeRef.current > 0 && enabled;
    
    // 如果自动移动正在运行，且用户还未中断过，则视为用户手动中断
    if (wasActive && !userInterruptedRef.current && enabled && hasUserInput) {
      userInterruptedRef.current = true;
      lastUserActionTimeRef.current = performance.now();
      lastLoggedSecondsRef.current = -1;
      // 停止相位推进（但不重置相位值，保持当前位置）
      phaseStartTimeRef.current = 0;
      if (countdownProgressRef.current !== 0) {
        countdownProgressRef.current = 0;
        if (onCountdownProgressChange) {
          onCountdownProgressChange(0);
        }
      }
      if (onInterrupted) {
        onInterrupted();
      }
    } else if (hasUserInput && userInterruptedRef.current) {
      // 如果倒计时已经开始，且有真实的用户输入，重置倒计时
      const now = performance.now();
      if (now - lastResetTimeRef.current > 100) {
        lastResetTimeRef.current = now;
        lastUserActionTimeRef.current = now;
        lastLoggedSecondsRef.current = -1;
        // 重置进度条
        if (countdownProgressRef.current !== 0) {
          countdownProgressRef.current = 0;
          if (onCountdownProgressChange) {
            onCountdownProgressChange(0);
          }
        }
      }
    }
  }, [enabled, onInterrupted, onCountdownProgressChange]);

  // 暴露中断接口给交互控制器
  useEffect(() => {
    if (onUserInput) {
      onUserInput(interruptAutoInterp);
    }
    // 当 interruptAutoInterp 变化时，更新回调
    return () => {
      if (onUserInput) {
        onUserInput(null);
      }
    };
  }, [onUserInput, interruptAutoInterp]);

  // 初始化世界的"上"方向（从初始相机提取）
  useEffect(() => {
    // 初始化世界的"上"方向
    if (camerasRef.current && camerasRef.current.length > 0) {
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

        const r = initialCam.rotation.flat();
        const initialRight = [r[0], r[3], r[6]];
        const initialUp = [r[1], r[4], r[7]];
        
        const rightNorm = normalize(initialRight);
        let worldUp = normalize(initialUp);

        // 如果有 pitch 调整，绕 right 向量旋转 up
        if (worldUpPitchAdjust === null || worldUpPitchAdjust === undefined) {
          worldUp = [0, 1, 0];
        } else if (Math.abs(worldUpPitchAdjust) > 1e-6) {
          const pitchAdjustRad = (worldUpPitchAdjust * Math.PI) / 180;
          worldUp = normalize(rotateAroundAxis(initialUp, rightNorm, pitchAdjustRad));
        }

        worldUpRef.current = worldUp;
      }
    }
  }, [camerasVersion, worldUpPitchAdjust, camerasRef]);

  // 当开启/关闭自动插值或相机列表变更时，重置相位系统
  useEffect(() => {
    const isCountdownActive = userInterruptedRef.current && 
                              lastUserActionTimeRef.current > 0 && 
                              (performance.now() - lastUserActionTimeRef.current) < 5000;
    
    if (enabled && camerasRef.current && camerasRef.current.length >= 2) {
      if (!isCountdownActive) {
        userInterruptedRef.current = false;
        phaseRef.current = Math.PI / 2;
        phaseStartTimeRef.current = performance.now();
      }
    } else if (!isCountdownActive) {
      phaseRef.current = Math.PI / 2;
      phaseStartTimeRef.current = 0;
    }
  }, [enabled, camerasVersion, camerasRef]);

  // 更新自动插值相机
  const updateAutoInterpCamera = useCallback((deltaTime) => {
    if (!viewMatrixRef.current) return false; // 返回 false 表示没有更新

    // 检查是否需要自动恢复自动运镜（5秒无操作后）
    if (userInterruptedRef.current && camerasRef.current && camerasRef.current.length > 1) {
      const timeSinceLastAction = performance.now() - lastUserActionTimeRef.current;
      const remainingTime = 5000 - timeSinceLastAction;
      
      if (timeSinceLastAction >= 5000) { // 5秒无操作
        userInterruptedRef.current = false;
        lastUserActionTimeRef.current = 0;
        lastLoggedSecondsRef.current = -1;
        if (countdownProgressRef.current !== 0) {
          countdownProgressRef.current = 0;
          if (onCountdownProgressChange) {
            onCountdownProgressChange(0);
          }
        }
        if (onResume) {
          onResume();
        }
        // 恢复后，重新开始相位推进
        if (enabled && camerasRef.current && camerasRef.current.length >= 2) {
          phaseStartTimeRef.current = performance.now();
        }
      } else if (remainingTime > 0) {
        const remainingSeconds = Math.ceil(remainingTime / 1000);
        if (remainingSeconds >= 1 && remainingSeconds <= 5) {
          if (remainingSeconds !== lastLoggedSecondsRef.current) {
            lastLoggedSecondsRef.current = remainingSeconds;
          }
        }
        
        // 计算倒计时进度（从3秒开始显示进度条，0-3秒之间）
        const newProgress = remainingTime <= 3000 ? (3000 - remainingTime) / 3000 : 0;
        if (newProgress !== countdownProgressRef.current) {
          countdownProgressRef.current = newProgress;
          if (onCountdownProgressChange) {
            onCountdownProgressChange(newProgress);
          }
        }
      } else {
        if (countdownProgressRef.current !== 0) {
          countdownProgressRef.current = 0;
          if (onCountdownProgressChange) {
            onCountdownProgressChange(0);
          }
        }
      }
    }

    // 自动插值：使用相位系统在 leftCam 和 rightCam 之间插值
    if (enabled && !userInterruptedRef.current && camerasRef.current && camerasRef.current.length >= 2) {
      const leftCam = camerasRef.current[0];
      const rightCam = camerasRef.current[camerasRef.current.length - 1];
      
      if (leftCam && rightCam) {
        // 初始化相位开始时间
        if (phaseStartTimeRef.current === 0) {
          phaseStartTimeRef.current = performance.now();
        }
        
        // 计算相位增量：根据 autoInterpDurationMs 计算一个完整周期（2π）的时间
        const fullCycleDuration = 2 * autoInterpDurationMs;
        const now = performance.now();
        const elapsed = now - phaseStartTimeRef.current;
        
        // 更新相位：从初始 π/2 开始，随时间推进
        const phaseSpeed = (2 * Math.PI) / fullCycleDuration;
        phaseRef.current = (Math.PI / 2) + (phaseSpeed * elapsed);
        
        // 将相位归一化到 [0, 2π)
        phaseRef.current = phaseRef.current % (2 * Math.PI);
        if (phaseRef.current < 0) {
          phaseRef.current += 2 * Math.PI;
        }
        
        // 使用 cos 函数将相位映射到插值进度 [0, 1]
        const t = (1 + Math.cos(phaseRef.current)) / 2;
        
        // 在 leftCam 和 rightCam 之间插值
        const blended = interpolateCamera(leftCam, rightCam, t);
        cameraRef.current = blended;
        updateViewMatrix(getViewMatrix(blended));
        if (onCameraChange) {
          const currentIndex = t > 0.5 ? camerasRef.current.length - 1 : 0;
          onCameraChange(blended, currentIndex);
        }
        return true; // 返回 true 表示已更新
      }
    } else if (!enabled) {
      phaseStartTimeRef.current = 0;
    }

    return false; // 返回 false 表示没有更新
  }, [viewMatrixRef, cameraRef, camerasRef, updateViewMatrix, enabled, autoInterpDurationMs, interpolateCamera, onCameraChange, onResume, onCountdownProgressChange]);

  // 启动自动插值
  const startAutoInterp = useCallback(() => {
    if (enabled && camerasRef.current && camerasRef.current.length >= 2) {
      userInterruptedRef.current = false;
      lastUserActionTimeRef.current = 0;
      if (countdownProgressRef.current !== 0) {
        countdownProgressRef.current = 0;
        if (onCountdownProgressChange) {
          onCountdownProgressChange(0);
        }
      }
      
      phaseRef.current = Math.PI / 2;
      phaseStartTimeRef.current = performance.now();
      
      // 立即更新相机到 50% 插值位置
      const leftCam = camerasRef.current[0];
      const rightCam = camerasRef.current[camerasRef.current.length - 1];
      if (leftCam && rightCam) {
        const blended = interpolateCamera(leftCam, rightCam, 0.5);
        cameraRef.current = blended;
        updateViewMatrix(getViewMatrix(blended));
      }
    }
  }, [enabled, camerasRef, interpolateCamera, updateViewMatrix, onCountdownProgressChange]);

  return {
    updateAutoInterpCamera,
    startAutoInterp,
    interruptAutoInterp,
    countdownProgress: countdownProgressRef.current,
  };
}

