# HoloEngine Changelog

## 2026-01-25 - 文档整理

### 修改

- **文档整理** - 整理和更新所有文档
  - 更新 README.md：整合目录结构说明，更新别名信息（@holorp），合并 SETUP.md 内容
  - 更新 MIGRATION_GUIDE.md：统一使用 @holorp 别名
  - 删除历史文档：SUMMARY.md, REORGANIZATION_PLAN.md, STRUCTURE.md, SETUP.md（内容已整合到 README.md）

## 2026-01-25 - 初始版本

### 新增

- **HoloEngineRuntime 封装层** - 创建统一的渲染引擎封装
  - `HoloEngineRuntime/src/core/` - 原 holo-rp-core 的内容
    - `utils/` - 核心工具函数（webgl.js, holoRP.js, renderTarget.js 等）
    - `shaders/` - 着色器（点云、线段等）
  - `HoloEngineRuntime/src/hooks/` - React Hooks
    - `useWebGL.js` - WebGL 上下文和程序管理
    - `useCameraControls.js` - 交互式相机控制
    - `useAutoInterpCamera.js` - 自动插值相机控制
    - `usePanView.js` - 平移视图控制
  - `HoloEngineRuntime/src/components/` - React 组件
    - `HoloEngineRuntime.jsx` - 完整的渲染引擎运行时组件
  - `HoloEngineRuntime/src/utils/` - 工具函数
    - `raycasting.js` - Raycasting 工具函数（从 useGizmo 提取）
    - `gizmoState.js` - Gizmo 状态管理
  - `HoloEngineRuntime/index.js` - 统一导出接口
  - `HoloEngineRuntime/package.json` - 包配置
  - `HoloEngineRuntime/README.md` - 使用文档

### 修改

- **路径调整** - 更新所有导入路径以适应新的目录结构
  - 所有源代码统一放在 `src/` 目录下（core、hooks、components、utils）
  - `useWebGL.js` - shader 导入路径调整为 `../../../shaders`（相对于 `src/hooks/`）
  - `useCameraControls.js` - `globalGizmoDragging` 导入从 `../utils/gizmoState`（相对于 `src/hooks/`）
  - `HoloEngineRuntime.jsx` - hooks 和 core 导入路径调整为相对路径（相对于 `src/components/`）
  - 所有内部导入路径都是相对于 `src/` 目录的

### 目的

这个封装层的主要目的是：
1. **代码复用** - 方便 ColmapUtil 等项目复用 Holotech 的渲染引擎功能
2. **统一接口** - 提供清晰的 API 和文档
3. **易于维护** - 集中管理相关功能，便于更新和维护

### 使用方式

```js
// 统一导入
import { 
  useWebGL, 
  useCameraControls, 
  screenToRay, 
  HoloEngineRuntime 
} from '@holoengineruntime';
```
