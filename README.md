# HoloEngineRuntime

统一的渲染引擎封装，提供 WebGL 渲染、相机控制、Raycasting 等功能。

**HoloEngineRuntime 是一个完整的包，整合了原 `holo-rp-core` 的所有功能，并添加了 React Hooks、相机控制和 Raycasting 工具。**

## 功能

### Core（原 holo-rp-core）
- **HoloRP** - 核心渲染管线，支持 4DGS/3DGS/MESH/LINES/POINT_CLOUD
- **RenderTarget** - 渲染目标抽象（Canvas / WebXR）
- **AxisGridRenderer** - 坐标轴和网格渲染
- **WebGL 工具** - 矩阵、着色器、相机等工具函数

### React 集成
- **WebGL 管理** - `useWebGL` Hook，管理 WebGL2 上下文和 shader programs
- **相机控制** - `useFpsCameraControl` 和 `useOrbitCameraControl` Hooks，支持两种相机控制模式
  - **FPS 模式**：第一人称视角，适合自由探索场景
  - **Orbit 模式**：轨道相机，相机围绕目标点旋转，适合查看固定对象
- **自动插值相机** - `useAutoInterpCamera` Hook，相机自动插值运动
- **平移视图** - `usePanView` Hook，视口平移功能
- **React 组件** - `HoloEngineRuntime` 组件，完整的 React 集成示例

### 工具函数
- **Raycasting** - 屏幕坐标转射线、射线与几何体相交检测
- **Gizmo 状态** - Gizmo 拖拽状态管理

## 使用方式

### 基础使用

#### 选择相机控制模式

HoloEngineRuntime 提供两种相机控制模式，根据使用场景选择：

- **`useFpsCameraControl`** - FPS（第一人称）模式
  - 适合：自由探索场景、游戏式导航
  - 特点：相机位置可以自由移动，鼠标拖拽旋转视角，WASD 移动相机位置
  
- **`useOrbitCameraControl`** - Orbit（轨道）模式
  - 适合：查看固定对象、模型查看器
  - 特点：相机围绕目标点旋转，鼠标拖拽旋转视角，滚轮缩放距离

#### 示例代码

```js
import { 
  useWebGL, 
  useFpsCameraControl,  // 或 useOrbitCameraControl
  screenToRay, 
  HoloEngineRuntime 
} from '@holoengineruntime';

function MyViewer() {
  const canvasRef = useRef(null);
  const viewMatrixRef = useRef(null);
  const cameraRef = useRef(null);
  const camerasRef = useRef([]);
  
  // WebGL 初始化
  const { gl, program, uniforms, attributes } = useWebGL(canvasRef);
  
  // 相机控制 - FPS 模式示例
  const fpsControls = useFpsCameraControl(
    canvasRef,
    viewMatrixRef,
    cameraRef,
    camerasRef,
    (viewMatrix) => { /* onViewMatrixChange */ },
    (camera, index) => { /* onCameraChange */ },
    0, // camerasVersion
    0, // worldUpPitchAdjust
    null, // onNotifyUserInput
    false, // disableLeftMouseButton
    0.5, // cameraSpeedMultiplier
    true // enabled
  );
  
  // 或者使用 Orbit 模式
  // const orbitControls = useOrbitCameraControl(
  //   canvasRef,
  //   viewMatrixRef,
  //   cameraRef,
  //   camerasRef,
  //   (viewMatrix) => { /* onViewMatrixChange */ },
  //   (camera, index) => { /* onCameraChange */ },
  //   0, // camerasVersion
  //   0, // worldUpPitchAdjust
  //   null, // onNotifyUserInput
  //   false, // disableLeftMouseButton
  //   0.5, // cameraSpeedMultiplier
  //   15, // initialOrbitRadius
  //   0.6, // minOrbitRadius
  //   true // enabled
  // );
  
  // 在渲染循环中更新相机
  useEffect(() => {
    const loop = () => {
      fpsControls.updateCameraFromInput(0.016); // deltaTime
      requestAnimationFrame(loop);
    };
    loop();
  }, [fpsControls]);
  
  // Raycasting
  const ray = screenToRay(
    mouseX, mouseY,
    viewMatrixRef.current,
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

#### `useFpsCameraControl(...)`

FPS（第一人称）风格相机控制 Hook。

**参数：**
- `canvasRef` - Canvas 元素的 ref
- `viewMatrixRef` - 视图矩阵的 ref（4x4 矩阵，camera-to-world）
- `cameraRef` - 相机对象的 ref（Camera 实例）
- `camerasRef` - 相机数组的 ref（可选，用于相机切换）
- `onViewMatrixChange` - 视图矩阵变化回调 `(viewMatrix) => void`
- `onCameraChange` - 相机变化回调 `(camera, index) => void`
- `camerasVersion` - 相机版本号（用于触发更新，默认 0）
- `worldUpPitchAdjust` - world_up 在 pitch 方向上的调整角度（度数，默认 0）
- `onNotifyUserInput` - 用户输入通知回调（用于中断自动插值，默认 null）
- `disableLeftMouseButton` - 是否禁用左键转视野（默认 false）
- `cameraSpeedMultiplier` - 相机移动速度倍率（默认 0.5）
- `enabled` - 是否启用此控制模式（默认 true）

**返回：**
- `updateCameraFromInput(deltaTime)` - 更新相机输入的函数（需要在渲染循环中调用）
- `focusOnTarget(target)` - 聚焦到目标位置的函数
- `activeKeys` - 当前按下的按键数组（只读）
- `carousel` - 是否处于轮播模式（只读）
- **`hasDragged`** - **拖拽状态 ref**，用于检测用户是否已经发生了拖拽
  - 访问方式：`controls.hasDragged.current`（`true` 表示已经发生了拖拽）
- **`getMouseDownPos()`** - **获取鼠标按下位置**的函数
  - 返回：`{x, y}` 或 `null`（用于检测拖拽距离）

#### `useOrbitCameraControl(...)`

Orbit（轨道）风格相机控制 Hook。

**参数：**
- `canvasRef` - Canvas 元素的 ref
- `viewMatrixRef` - 视图矩阵的 ref（4x4 矩阵，camera-to-world）
- `cameraRef` - 相机对象的 ref（Camera 实例）
- `camerasRef` - 相机数组的 ref（可选，用于相机切换）
- `onViewMatrixChange` - 视图矩阵变化回调 `(viewMatrix) => void`
- `onCameraChange` - 相机变化回调 `(camera, index) => void`
- `camerasVersion` - 相机版本号（用于触发更新，默认 0）
- `worldUpPitchAdjust` - world_up 在 pitch 方向上的调整角度（度数，默认 0）
- `onNotifyUserInput` - 用户输入通知回调（用于中断自动插值，默认 null）
- `disableLeftMouseButton` - 是否禁用左键转视野（默认 false）
- `cameraSpeedMultiplier` - 相机移动速度倍率（默认 0.5）
- `initialOrbitRadius` - 初始轨道半径（默认 15）
- `minOrbitRadius` - 最小轨道半径（默认 0.6）
- `enabled` - 是否启用此控制模式（默认 true）

**返回：**
- `updateCameraFromInput(deltaTime)` - 更新相机输入的函数（需要在渲染循环中调用）
- `focusOnTarget(target)` - 聚焦到目标位置的函数
- `activeKeys` - 当前按下的按键数组（只读）
- `carousel` - 始终为 `false`（Orbit 模式不支持轮播）
- **`hasDragged`** - **拖拽状态 ref**，用于检测用户是否已经发生了拖拽
  - 访问方式：`controls.hasDragged.current`（`true` 表示已经发生了拖拽）
- **`getMouseDownPos()`** - **获取鼠标按下位置**的函数
  - 返回：`{x, y}` 或 `null`（用于检测拖拽距离）

### 拖拽检测 API

相机控制 Hook 提供了拖拽检测 API，允许应用区分"点击"和"拖拽"操作。这对于实现交互逻辑非常重要（例如：拖拽时旋转视角，点击时选择对象）。

#### 工作原理

- **拖拽**：用户按下鼠标并移动超过 5 像素 → `hasDragged.current` 为 `true`
- **点击**：用户按下鼠标但未移动或移动距离很小 → `hasDragged.current` 为 `false`

#### 使用示例

```js
const controls = useFpsCameraControl(/* ... */);

// 在点击事件处理中检测拖拽
const handleClick = (e) => {
  // 方法 1：使用 hasDragged ref（推荐）
  if (controls.hasDragged.current) {
    // 已经发生了拖拽，不处理点击（避免误触发选择等操作）
    return;
  }
  
  // 方法 2：使用鼠标按下位置检测拖拽距离（后备方案）
  const mouseDownPos = controls.getMouseDownPos();
  if (mouseDownPos) {
    const dx = Math.abs(e.clientX - mouseDownPos.x);
    const dy = Math.abs(e.clientY - mouseDownPos.y);
    const DRAG_THRESHOLD = 5; // 像素
    if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
      // 发生了拖拽，不处理点击
      return;
    }
  }
  
  // 处理点击事件（选择对象、打开菜单等）
  selectObject(e.clientX, e.clientY);
};
```

#### 注意事项

1. **Ref 访问**：`hasDragged` 是一个 ref，需要通过 `.current` 访问
2. **延迟清除**：拖拽状态会在鼠标释放后延迟清除（使用 `setTimeout`），以确保在 `click` 事件触发时仍能正确检测到拖拽状态
3. **适用场景**：
   - 拖拽时忽略点击事件（避免误触发选择、取消选择等操作）
   - 点击时执行特定操作（如选择对象、打开菜单等）

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
    linesProgram,
    linesUniforms,
    linesAttributes,
    pointCloudProgram,
    pointCloudUniforms,
    pointCloudAttributes
  }
);
```

#### `RenderableObject`

渲染对象类，表示要渲染的 3D 对象。

```js
const obj = new RenderableObject('my-object', RenderType.MESH);
obj.vertexBuffer = gl.createBuffer();
obj.elementBuffer = gl.createBuffer();
obj.elementCount = 1000;
obj.ready = true;
pipeline.addObject(obj);
```

#### `RenderType`

渲染类型枚举：
- `RenderType['4DGS']` - 4D Gaussian Splatting
- `RenderType['3DGS']` - 3D Gaussian Splatting
- `RenderType.MESH` - 网格模型
- `RenderType.LINES` - 线段
- `RenderType.POINT_CLOUD` - 点云（每点一纯色 quad，无时间插值、无高斯参数）

#### `CanvasRenderTarget`

Canvas 渲染目标。

```js
import { CanvasRenderTarget } from '@holoengineruntime';

const renderTarget = new CanvasRenderTarget(canvas, gl);
pipeline.render(renderTarget);
```

### Utils

#### `createPointCloudObject(gl, id, positions, colors)` / `createPointCloudBuffers(gl, positions, colors)`

点云渲染：从 `positions`（N×3 xyz）、`colors`（N×3 rgb 0–1）创建 `RenderableObject` 或 WebGL buffer。每点渲染为固定像素大小的纯色 quad。将对象 `pipeline.addObject(obj)` 后即可绘制。

```js
import { createPointCloudObject, HoloRP, RenderType } from '@holoengineruntime';

const obj = createPointCloudObject(gl, 'points', positions, colors);
pipeline.addObject(obj);
```

点尺寸由 `RenderableObject.pointSize`（默认 2，像素）控制，也可通过 `createPointCloudObject(..., pointSize)` 传入。

#### `createLinesObject(gl, id, positions, colors)` / `updateLinesObject(gl, obj, positions, colors)`

线段渲染：从 `positions`（N×3）、`colors`（N×3，rgb 0–1）创建 LINES `RenderableObject`，或更新已有对象的 buffer。与 `pipeline.addObject` 配合使用。

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
│   │   │   └── depthVisualizationRenderer.js  # 深度可视化
│   │   └── shaders/             # 核心着色器（线段、深度等，点云shader待实现）
│   │       ├── linesShaders.js
│   │       └── depthVisualizationShaders.js
│   ├── shaders/                  # useWebGL 用 shaders（4DGS、mesh、3DGS）
│   │   ├── index.js
│   │   ├── splatShaders.js
│   │   ├── meshShaders.js
│   │   └── gaussian3dShaders.js
│   ├── hooks/                    # React Hooks
│   │   ├── useWebGL.js          # WebGL 上下文管理
│   │   ├── useFpsCameraControl.js # FPS 相机控制
│   │   ├── useOrbitCameraControl.js # Orbit 相机控制
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

**Shaders 内置**：4DGS splat、mesh、3DGS 等 shader 已放在包内 `src/shaders/`（`splatShaders`、`meshShaders`、`gaussian3dShaders`），`useWebGL` 从 `../shaders` 导入，无需宿主项目提供 shaders。

## 注意事项

1. **Shader 路径**：`useWebGL` 从包内 `../shaders` 导入（`src/shaders/`），与 Holotech 同源，无需额外配置。

2. **Gizmo 状态**：`useFpsCameraControl` 和 `useOrbitCameraControl` 使用 `globalGizmoDragging` 来防止在 Gizmo 拖拽时更新相机。

3. **渲染循环**：需要在 `requestAnimationFrame` 中调用 `updateCameraFromInput`。

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

#### 3. Shader 与 useWebGL

Shaders（4DGS、mesh、3DGS）已内置在 `src/shaders/`，`useWebGL` 从 `../shaders` 导入，无需项目额外提供。若需自定义，可替换包内 `src/shaders/` 对应文件或修改 `useWebGL` 导入路径。

#### 4. 使用 HoloEngine

```js
// 从统一入口导入（推荐）
import { 
  HoloRP, 
  useWebGL, 
  useFpsCameraControl,
  useOrbitCameraControl, 
  screenToRay,
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

## 在业务项目中使用

封装层可复制或作为 git submodule 接入业务项目：

1. 复制 `HoloEngineRuntime` 或 `git submodule add` 引入
2. 配置构建别名 `@holoengineruntime` 指向该目录
3. 用 `useWebGL`、`HoloRP`、`createPointCloudObject` / `createLinesObject` 等实现渲染；线段、点云等通过 `extendedOptions` 传入管线

**优势**：功能集中、统一导入、便于复用。
