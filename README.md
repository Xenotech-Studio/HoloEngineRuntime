# HoloEngineRuntime

统一的渲染引擎封装，提供 WebGL 渲染、相机控制、Raycasting 等功能。

**HoloEngineRuntime 是一个完整的包，整合了原 `holo-rp-core` 的所有功能，并添加了 React Hooks、相机控制和 Raycasting 工具。**

## 功能

### Core（原 holo-rp-core）
- **HoloRP** - 核心渲染管线，支持 4DGS/3DGS/MESH/POINT_CLOUD/LINES
- **RenderTarget** - 渲染目标抽象（Canvas / WebXR）
- **AxisGridRenderer** - 坐标轴和网格渲染
- **WebGL 工具** - 矩阵、着色器、相机等工具函数
- **ColmapPrograms** - ColmapUtil 专用的点云和线段 programs

### React 集成
- **WebGL 管理** - `useWebGL` Hook，管理 WebGL2 上下文和 shader programs
- **相机控制** - `useCameraControls` Hook，支持鼠标、键盘、触摸控制
- **自动插值相机** - `useAutoInterpCamera` Hook，相机自动插值运动
- **平移视图** - `usePanView` Hook，视口平移功能
- **React 组件** - `HoloEngineRuntime` 组件，完整的 React 集成示例

### 工具函数
- **Raycasting** - 屏幕坐标转射线、射线与几何体相交检测
- **Gizmo 状态** - Gizmo 拖拽状态管理

## 使用方式

### 基础使用

```js
import { useWebGL, useCameraControls, screenToRay, HoloEngineRuntime } from '@holoengineruntime';

function MyViewer() {
  const canvasRef = useRef(null);
  const viewMatrixRef = useRef(null);
  const cameraRef = useRef(null);
  
  // WebGL 初始化
  const { gl, program, uniforms, attributes } = useWebGL(canvasRef);
  
  // 相机控制
  const { updateCameraFromInput } = useCameraControls(
    canvasRef,
    viewMatrixRef,
    cameraRef,
    camerasRef,
    onViewMatrixChange,
    onCameraChange
  );
  
  // Raycasting
  const ray = screenToRay(
    mouseX, mouseY,
    viewMatrix,
    projectionMatrix,
    canvasWidth,
    canvasHeight
  );
  
  return <canvas ref={canvasRef} />;
}
```

### 完整示例（使用 HoloEngineRuntime）

```js
import { HoloEngineRuntime } from '@holoengineruntime';

function MyViewer() {
  const canvasRef = useRef(null);
  const sceneManager = new SceneManager();
  
  return (
    <HoloEngineRuntime
      canvasRef={canvasRef}
      sceneManager={sceneManager}
      camera={initialCamera}
      onLoadComplete={handleLoadComplete}
      onError={handleError}
    />
  );
}
```

## API 文档

### Hooks

#### `useWebGL(canvasRef, options)`

初始化 WebGL2 上下文和 shader programs。

**参数：**
- `canvasRef` - Canvas 元素的 ref
- `options` - 配置选项
  - `antialias` - 是否启用抗锯齿（默认 false）
  - `xrCompatible` - 是否 XR 兼容（默认 false）

**返回：**
- `gl` - WebGL2 上下文
- `program` - 4DGS shader program
- `program3DGS` - 3DGS shader program
- `meshProgram` - Mesh shader program
- `uniforms` - 4DGS uniforms
- `attributes` - 4DGS attributes
- `uniforms3DGS` - 3DGS uniforms
- `attributes3DGS` - 3DGS attributes
- `meshUniforms` - Mesh uniforms
- `meshAttributes` - Mesh attributes
- `error` - 错误信息（如果有）

#### `useCameraControls(...)`

交互式相机控制 Hook。

**参数：**
- `canvasRef` - Canvas 元素的 ref
- `viewMatrixRef` - 视图矩阵的 ref
- `cameraRef` - 相机对象的 ref
- `camerasRef` - 相机数组的 ref
- `onViewMatrixChange` - 视图矩阵变化回调
- `onCameraChange` - 相机变化回调
- `camerasVersion` - 相机版本号（用于触发更新）
- `worldUpPitchAdjust` - world_up 在 pitch 方向上的调整角度（度数）
- `onNotifyUserInput` - 用户输入通知回调
- `disableLeftMouseButton` - 是否禁用左键转视野
- `cameraSpeedMultiplier` - 相机移动速度倍率

**返回：**
- `updateCameraFromInput` - 更新相机输入的函数（需要在渲染循环中调用）

### Core API（原 holo-rp-core）

#### `HoloRP`

核心渲染管线类。

```js
import { HoloRP, RenderableObject, RenderType } from '@holoengineruntime';

const pipeline = new HoloRP(
  gl,
  splatProgram,      // 4DGS program
  splat3DGSProgram,  // 3DGS program
  meshProgram,       // Mesh program
  splatUniforms,
  splat3DGSUniforms,
  meshUniforms,
  splatAttributes,
  splat3DGSAttributes,
  meshAttributes,
  {
    pointCloudProgram,
    pointCloudUniforms,
    pointCloudAttributes,
    linesProgram,
    linesUniforms,
    linesAttributes
  }
);
```

#### `RenderableObject`

渲染对象类，表示要渲染的 3D 对象。

```js
const obj = new RenderableObject('my-object', RenderType.POINT_CLOUD);
obj.positionBuffer = gl.createBuffer();
obj.colorBuffer = gl.createBuffer();
obj.pointCount = 1000;
obj.ready = true;
pipeline.addObject(obj);
```

#### `RenderType`

渲染类型枚举：
- `RenderType['4DGS']` - 4D Gaussian Splatting
- `RenderType['3DGS']` - 3D Gaussian Splatting
- `RenderType.MESH` - 网格模型
- `RenderType.POINT_CLOUD` - 点云
- `RenderType.LINES` - 线段

#### `CanvasRenderTarget`

Canvas 渲染目标。

```js
import { CanvasRenderTarget } from '@holoengineruntime';

const renderTarget = new CanvasRenderTarget(canvas, gl);
pipeline.render(renderTarget);
```

#### `createColmapPrograms(gl)`

创建 ColmapUtil 专用的点云和线段 programs。

```js
import { createColmapPrograms } from '@holoengineruntime';

const { 
  pointCloudProgram, 
  pointCloudUniforms, 
  pointCloudAttributes,
  linesProgram,
  linesUniforms,
  linesAttributes
} = createColmapPrograms(gl);
```

### Utils

#### `screenToRay(screenX, screenY, viewMatrix, projectionMatrix, canvasWidth, canvasHeight)`

将屏幕坐标转换为世界坐标中的射线。

**参数：**
- `screenX` - 屏幕 X 坐标
- `screenY` - 屏幕 Y 坐标
- `viewMatrix` - 4x4 视图矩阵（camera-to-world）
- `projectionMatrix` - 4x4 投影矩阵
- `canvasWidth` - Canvas 宽度
- `canvasHeight` - Canvas 高度

**返回：**
- `{origin: number[], direction: number[]}` - 射线对象，包含起点和方向（归一化）
- `null` - 如果计算失败

#### `rayRectangleIntersection(ray, rectangle)`

射线与矩形相交检测。

**参数：**
- `ray` - 射线对象 `{origin: number[], direction: number[]}`
- `rectangle` - 矩形对象 `{center: number[], u: number[], v: number[], width: number, height: number, thickness: number}`

**返回：**
- `number` - 交点距离（t值）
- `null` - 如果无交点

#### `rayPlaneIntersection(ray, plane)`

射线与平面相交检测。

**参数：**
- `ray` - 射线对象
- `plane` - 平面对象 `{point: number[], normal: number[], size: number[]}`

**返回：**
- `number` - 交点距离（t值）
- `null` - 如果无交点

#### `pointToRayDistance(point, ray)`

计算点到射线的距离。

**参数：**
- `point` - 点坐标 `[x, y, z]`
- `ray` - 射线对象

**返回：**
- `number` - 点到射线的距离

### Components

#### `HoloEngineRuntime`

完整的 React 组件，集成 WebGL 渲染、相机控制、场景管理等功能。

**Props：**
- `canvasRef` - Canvas 元素的 ref
- `sceneManager` - SceneManager 实例
- `camera` - 初始相机对象
- `onLoadComplete` - 加载完成回调
- `onError` - 错误回调
- `skipFileCameraInit` - 是否跳过文件相机初始化
- `onViewMatrixRefReady` - 视图矩阵 ref 就绪回调
- `onCameraRefReady` - 相机 ref 就绪回调
- `disableLeftMouseButton` - 是否禁用左键转视野
- `sceneVersion` - 场景版本号
- `targetVerticalFOV` - 目标垂直 FOV（角度）
- `meshDebugMode` - Mesh 调试模式
- `selectedObjectId` - 选中的对象ID
- `cameraSpeedMultiplier` - 相机移动速度倍率
- `showDepthVisualization` - 是否显示深度可视化
- `depthRange` - 深度范围（米）
- `depthRangeNear` - 近处深度范围（米）
- `depthGamma` - Gamma 值
- `depthOpacityThreshold` - 深度写入的像素不透明度阈值
- `centerOpacityThreshold` - 深度写入的中心点不透明度阈值

## 目录结构

```
HoloEngineRuntime/
├── src/                          # 所有源代码
│   ├── core/                     # 原 holo-rp-core 的内容
│   │   ├── utils/               # 核心工具函数
│   │   │   ├── webgl.js         # WebGL 工具函数
│   │   │   ├── holoRP.js        # 核心渲染管线
│   │   │   ├── renderTarget.js  # 渲染目标（Canvas/WebXR）
│   │   │   ├── axisGridRenderer.js  # 坐标轴网格渲染器
│   │   │   ├── colmapPrograms.js    # ColmapUtil 专用 programs
│   │   │   └── depthVisualizationRenderer.js  # 深度可视化
│   │   └── shaders/             # 着色器
│   │       ├── pointCloudShaders.js
│   │       ├── linesShaders.js
│   │       └── depthVisualizationShaders.js
│   ├── hooks/                    # React Hooks
│   │   ├── useWebGL.js          # WebGL 上下文管理
│   │   ├── useCameraControls.js # 相机控制
│   │   ├── useAutoInterpCamera.js # 自动插值相机
│   │   └── usePanView.js        # 平移视图
│   ├── components/               # React 组件
│   │   └── HoloEngineRuntime.jsx # 完整的渲染引擎运行时
│   └── utils/                    # 工具函数
│       ├── raycasting.js         # Raycasting 工具
│       └── gizmoState.js         # Gizmo 状态管理
├── index.js                      # 统一导出接口
├── package.json                  # 包配置
├── LICENSE                       # MIT 许可证
├── README.md                     # 使用文档
├── MIGRATION_GUIDE.md            # 迁移指南
└── CHANGELOG.md                  # 变更日志
```

### 导入路径规则

所有导入路径都是相对于 `src/` 目录的：

- **从 hooks 导入 core**：`import { createShader } from '../core/utils/webgl';`
- **从 components 导入 hooks 和 core**：`import { useWebGL } from '../hooks/useWebGL';`
- **从 utils 导入 core**：`import { invert4 } from '../core/utils/webgl';`
- **从 hooks 导入 utils**：`import { globalGizmoDragging } from '../utils/gizmoState';`

## 依赖

**无外部依赖** - HoloEngineRuntime 是自包含的，所有功能都在包内。

注意：`useWebGL` Hook 需要从项目根目录的 `shaders` 文件夹导入 shader 源码（这是 Holotech 项目的特定需求，其他项目可能需要调整）。

## 注意事项

1. **Shader 路径**：`useWebGL` Hook 需要导入 shader 源码
   - 在 Holotech 项目中：路径为 `../../../shaders`（相对于 `src/HoloEngineRuntime/src/hooks/`）
   - 在其他项目中：需要根据项目结构调整 `src/hooks/useWebGL.js` 中的 shader 导入路径
   - 或者：将 shader 文件复制到 HoloEngine 内部，使用相对路径导入
   - 详细说明见上面的"处理 Shader 导入"部分

2. **Gizmo 状态**：`useCameraControls` 使用 `globalGizmoDragging` 来防止在 Gizmo 拖拽时更新相机

3. **渲染循环**：需要在 `requestAnimationFrame` 中调用 `updateCameraFromInput`

4. **内部路径**：HoloEngineRuntime 内部使用相对路径，所有导入都是相对于 `src/` 目录的
   - `src/hooks/` → `../core/utils/` （相对路径）
   - `src/components/` → `../hooks/` 和 `../core/utils/` （相对路径）
   - `src/utils/` → `../core/utils/` （相对路径）

## 安装和设置

### 作为 Git Submodule 使用

#### 1. 添加 Submodule

```bash
# 在其他项目中添加 HoloEngineRuntime
git submodule add <holoengineruntime-repo-url> HoloEngineRuntime
```

#### 2. 配置构建工具

**Vite**

```ts
// vite.config.ts
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@holoengine': path.resolve(__dirname, './HoloEngine'),
      '@holorp': path.resolve(__dirname, './HoloEngineRuntime/src/core'),  // 指向 core
    },
  },
});
```

**Webpack**

```js
// webpack.config.js
module.exports = {
  resolve: {
    alias: {
      '@holoengine': path.resolve(__dirname, 'HoloEngine'),
      '@holorp': path.resolve(__dirname, 'HoloEngineRuntime/src/core'),
    },
  },
};
```

#### 3. 处理 Shader 导入

`useWebGL` Hook 需要导入 shader 源码。有两种方式：

**方式 1：调整 shader 路径（推荐）**

如果项目有自己的 shader 文件，修改 `HoloEngineRuntime/src/hooks/useWebGL.js`：

```js
// 原路径（Holotech 项目）
import { vertexShaderSource } from '../../../shaders';

// 修改为你的项目路径
import { vertexShaderSource } from '../path/to/your/shaders';
```

**方式 2：复制 shader 到 HoloEngine**

将 shader 文件复制到 `HoloEngineRuntime/src/shaders/`，然后修改导入路径：

```js
import { vertexShaderSource } from '../src/shaders';
```

#### 4. 使用 HoloEngine

```js
// 从统一入口导入（推荐）
import { 
  HoloRP, 
  useWebGL, 
  useCameraControls, 
  screenToRay,
  createColmapPrograms
} from '@holoengineruntime';

// 或直接从 core 导入
import { HoloRP } from '@holorp/utils/holoRP';
import { webgl } from '@holorp/utils/webgl';
```

### 在 Holotech 项目中使用

HoloEngine 已经在 `src/HoloEngine` 目录下，可以直接使用：

```js
// 从统一入口导入
import { HoloRP, useWebGL } from './HoloEngineRuntime';

// 或者使用别名（如果配置了）
import { HoloRP } from '@holoengineruntime';
```

## 迁移到 ColmapUtil

这个封装层可以直接复制到 ColmapUtil 项目中使用：

1. 复制整个 `HoloEngineRuntime` 文件夹（或作为 git submodule）
2. 确保 shader 文件路径正确（可能需要调整 `useWebGL.js` 中的导入路径）
3. 根据 ColmapUtil 的需求调整相机控制方式
4. 使用 `HoloEngineRuntime` 组件作为参考实现自己的渲染组件

**优势**：
- ✅ 所有功能在一个包中，无需单独的 holo-rp-core
- ✅ 统一的导入接口
- ✅ 完整的文档和示例
- ✅ 可以作为 git submodule 复用
