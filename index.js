/**
 * HoloEngineRuntime - 统一的渲染引擎封装
 * 
 * 提供以下功能：
 * - WebGL 上下文和程序管理
 * - 相机控制（鼠标、键盘、触摸）
 * - Raycasting 工具函数
 * - React 组件集成
 * - HoloRP 核心渲染管线（原 holo-rp-core）
 * 
 * 使用示例：
 * ```js
 * import { 
 *   useWebGL, 
 *   useCameraControls, 
 *   screenToRay, 
 *   HoloEngineRuntime,
 *   HoloRP,
 *   RenderableObject,
 *   RenderType
 * } from '@holoengineruntime';
 * ```
 */

// Core (原 holo-rp-core)
export { HoloRP, RenderableObject, RenderType } from './src/core/utils/holoRP';
export { CanvasRenderTarget, WebXRRenderTarget, RenderTarget } from './src/core/utils/renderTarget';
export { initAxisGridRenderer, renderAxisGrid, renderGrid, renderAxes } from './src/core/utils/axisGridRenderer';
export * from './src/core/utils/webgl';
export { DepthVisualizationRenderer } from './src/core/utils/depthVisualizationRenderer';

// Hooks
export { useWebGL } from './src/hooks/useWebGL';
export { useCameraControls } from './src/hooks/useCameraControls';
export { useAutoInterpCamera } from './src/hooks/useAutoInterpCamera';
export { usePanView } from './src/hooks/usePanView';
export { usePlyLoader, loadPlyFile } from './src/hooks/usePlyLoader';
export { useSplatLoader } from './src/hooks/useSplatLoader';

// Components
export { default as HoloEngineRuntime } from './src/components/HoloEngineRuntime';

// Utils
export * from './src/utils/raycasting';
export { globalGizmoDragging } from './src/utils/gizmoState';
export { createDepthWorker } from './src/utils/depthWorker';
export { loadAndSetup3DGSObject, create3DGSTexture, create3DGSIndexBuffer, create3DGSWorker } from './src/utils/ply3dgsLoader';
export { loadAndSetupSplatObject, createSplatTexture, createSplatIndexBuffer, createSplatWorker, loadSplatObject } from './src/utils/splatObjectLoader';
export { loadAndSetupMeshObject, parseOBJ, loadOBJFile, createMeshBuffers } from './src/utils/meshLoader';
export { SceneManager, SplatObject } from './src/utils/sceneManager';
