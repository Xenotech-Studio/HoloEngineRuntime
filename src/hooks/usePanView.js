import { useEffect, useRef } from 'react';
import { invert4, translate4 } from '../core/utils/webgl';
import { globalGizmoDragging } from '../utils/gizmoState';

/**
 * Pan View Hook - 实现视口平移功能
 * 以当前视口的 up、right 为参考来平移视口
 */
export function usePanView({
  canvasRef,
  viewMatrixRef,
  enabled = false
}) {
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const canvas = canvasRef?.current;
    if (!canvas || !enabled) {
      return;
    }

    const handleMouseDown = (e) => {
      // 只在中间键或 Alt+左键时启用 pan
      if (e.button === 1 || (e.button === 0 && e.altKey)) {
        e.preventDefault();
        if (globalGizmoDragging.current) {
          return; // 如果 Gizmo 正在拖拽，不处理
        }
        
        // 让canvas获得焦点，以便接收键盘输入
        if (canvas && canvas.focus) {
          canvas.focus();
        }
        
        isPanningRef.current = true;
        panStartRef.current = {
          x: e.clientX,
          y: e.clientY
        };
        canvas.style.cursor = 'grabbing';
      }
    };

    const handleMouseMove = (e) => {
      if (!isPanningRef.current || globalGizmoDragging.current) {
        return;
      }

      if (!viewMatrixRef?.current) {
        return;
      }

      // viewMatrixRef 可能是一个 ref 对象，需要检查 .current 属性
      let viewMatrix = null;
      if (viewMatrixRef.current.current !== undefined) {
        viewMatrix = viewMatrixRef.current.current;
      } else {
        viewMatrix = viewMatrixRef.current;
      }
      
      if (!viewMatrix || !Array.isArray(viewMatrix) || viewMatrix.length !== 16) {
        return;
      }

      // 计算鼠标移动距离（屏幕空间）
      const deltaX = e.clientX - panStartRef.current.x;
      const deltaY = e.clientY - panStartRef.current.y;

      // 获取 canvas 尺寸
      const canvasWidth = canvas.clientWidth || canvas.width;
      const canvasHeight = canvas.clientHeight || canvas.height;

      // 从 viewMatrix 提取 right 和 up 向量
      // viewMatrix 是 camera-to-world 矩阵（列主序）
      // 第一列（索引 0,1,2）是 right 向量
      // 第二列（索引 4,5,6）是 up 向量
      const right = [viewMatrix[0], viewMatrix[1], viewMatrix[2]];
      const up = [viewMatrix[4], viewMatrix[5], viewMatrix[6]];

      // 归一化
      const rightLen = Math.hypot(right[0], right[1], right[2]);
      const upLen = Math.hypot(up[0], up[1], up[2]);
      const normalizedRight = rightLen > 1e-6 
        ? [right[0] / rightLen, right[1] / rightLen, right[2] / rightLen]
        : [1, 0, 0];
      const normalizedUp = upLen > 1e-6
        ? [up[0] / upLen, up[1] / upLen, up[2] / upLen]
        : [0, 1, 0];

      // 计算相机位置
      const invView = invert4(viewMatrix);
      if (!invView) {
        return;
      }
      const cameraPos = [invView[12], invView[13], invView[14]];

      // 计算相机到原点的距离，用于缩放平移速度
      const cameraDistance = Math.hypot(cameraPos[0], cameraPos[1], cameraPos[2]);
      const panSpeed = Math.max(0.1, cameraDistance * 0.001); // 根据距离调整速度

      // 将屏幕空间的移动转换为世界空间的移动
      // 使用 canvas 尺寸来标准化移动距离
      const worldDeltaX = (deltaX / canvasWidth) * panSpeed;
      const worldDeltaY = (deltaY / canvasHeight) * panSpeed;

      // 计算平移向量（沿 right 和 up 方向）
      const panVector = [
        normalizedRight[0] * worldDeltaX - normalizedUp[0] * worldDeltaY,
        normalizedRight[1] * worldDeltaX - normalizedUp[1] * worldDeltaY,
        normalizedRight[2] * worldDeltaX - normalizedUp[2] * worldDeltaY
      ];

      // 应用平移
      const newCameraPos = [
        cameraPos[0] + panVector[0],
        cameraPos[1] + panVector[1],
        cameraPos[2] + panVector[2]
      ];

      // 构建新的 viewMatrix
      const newViewMatrix = [
        viewMatrix[0], viewMatrix[1], viewMatrix[2], viewMatrix[3],
        viewMatrix[4], viewMatrix[5], viewMatrix[6], viewMatrix[7],
        viewMatrix[8], viewMatrix[9], viewMatrix[10], viewMatrix[11],
        newCameraPos[0], newCameraPos[1], newCameraPos[2], viewMatrix[15]
      ];

      // 更新 viewMatrix
      if (viewMatrixRef.current) {
        if (viewMatrixRef.current.current !== undefined) {
          viewMatrixRef.current.current = newViewMatrix;
        } else {
          viewMatrixRef.current = newViewMatrix;
        }
      }

      // 更新起始位置
      panStartRef.current = {
        x: e.clientX,
        y: e.clientY
      };
    };

    const handleMouseUp = (e) => {
      if (e.button === 1 || (e.button === 0 && e.altKey)) {
        isPanningRef.current = false;
        canvas.style.cursor = enabled ? 'grab' : 'default';
      }
    };

    const handleMouseLeave = () => {
      isPanningRef.current = false;
      canvas.style.cursor = enabled ? 'grab' : 'default';
    };

    // 设置初始光标
    if (enabled) {
      canvas.style.cursor = 'grab';
    }

    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mouseleave', handleMouseLeave);

    // 阻止中间键的默认行为（滚动）
    canvas.addEventListener('auxclick', (e) => {
      if (e.button === 1) {
        e.preventDefault();
      }
    });

    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
      canvas.style.cursor = 'default';
    };
  }, [canvasRef, viewMatrixRef, enabled]);
}

