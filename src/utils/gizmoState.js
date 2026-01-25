/**
 * Gizmo 状态管理
 * 用于在相机控制和 Gizmo 交互之间共享状态
 */

// 全局标志：标记Gizmo是否正在拖拽（用于防止相机控制干扰）
export const globalGizmoDragging = { current: false };
