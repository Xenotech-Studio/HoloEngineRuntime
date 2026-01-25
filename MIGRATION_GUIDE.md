# HoloEngineRuntime 迁移指南

## 从 holo-rp-core 迁移到 HoloEngineRuntime

如果你之前使用 `holo-rp-core` 作为独立的包，现在可以迁移到 `HoloEngineRuntime`，它包含了所有 `holo-rp-core` 的功能，并添加了更多便利功能。

## 目录结构变化

### 旧结构（holo-rp-core）
```
holo-rp-core/
└── src/
    ├── utils/
    └── shaders/
```

### 新结构（HoloEngineRuntime）
```
HoloEngineRuntime/
├── src/
│   ├── core/           # 原 holo-rp-core/src
│   │   ├── utils/
│   │   └── shaders/
│   ├── hooks/          # React Hooks（新增）
│   ├── components/     # React 组件（新增）
│   └── utils/          # 工具函数（新增）
└── index.js            # 统一导出
```

## 导入路径变更

### 旧方式（使用 @holorp 别名）

```js
// vite.config.ts
resolve: {
  alias: {
    '@holorp': path.resolve(__dirname, './holo-rp-core/src'),
  },
}

// 代码中
import { HoloRP } from '@holorp/utils/holoRP';
import { webgl } from '@holorp/utils/webgl';
```

### 新方式（使用 HoloEngineRuntime）

```js
// vite.config.ts
resolve: {
  alias: {
    '@holoengineruntime': path.resolve(__dirname, './HoloEngineRuntime'),
  },
}

// 方式 1：从统一入口导入（推荐）
import { 
  HoloRP, 
  RenderableObject, 
  RenderType,
  CanvasRenderTarget,
  createColmapPrograms
} from '@holoengineruntime';

// 方式 2：从子路径导入
import { HoloRP } from '@holoengineruntime/core';
import { webgl } from '@holoengineruntime/core/webgl';
```

## 在 Holotech 项目中使用

### 更新 vite.config.js

```js
// 旧配置
resolve: {
  alias: {
    '@holorp': path.resolve(__dirname, './holo-rp-core/src'),
  },
}

// 新配置
resolve: {
  alias: {
    '@holorp': path.resolve(__dirname, './src/HoloEngineRuntime/src/core'),
    '@holoengineruntime': path.resolve(__dirname, './src/HoloEngineRuntime'),
  },
}
```

### 更新组件导入

```js
// 旧方式
import { HoloRP } from '@holorp/utils/holoRP';

// 新方式（推荐）
import { HoloRP } from '@holoengineruntime';
```

## 在 ColmapUtil 项目中使用

### 作为 Git Submodule

```bash
# 移除旧的 holo-rp-core
git submodule deinit holo-rp-core
git rm holo-rp-core

# 添加新的 HoloEngineRuntime
git submodule add <holoengineruntime-repo-url> HoloEngineRuntime
```

### 更新 vite.config.ts

```ts
// vite.config.ts
resolve: {
  alias: {
    '@holoengineruntime': path.resolve(__dirname, './HoloEngineRuntime'),
    '@holorp': path.resolve(__dirname, './HoloEngineRuntime/src/core'),
  },
}
```

### 更新代码

```js
// 旧方式
import { HoloRP } from '@holorp/utils/holoRP';
import { createColmapPrograms } from '@holorp/utils/colmapPrograms';

// 新方式
import { 
  HoloRP, 
  createColmapPrograms,
  useWebGL,
  useCameraControls,
  screenToRay
} from '@holoengineruntime';
```

## 优势

1. **统一包** - 所有功能在一个包中，无需管理多个 submodule
2. **更多功能** - 包含 React Hooks、相机控制、Raycasting 等
3. **更好的封装** - 清晰的 API 和文档
4. **易于维护** - 所有代码在一个仓库中

## 注意事项

1. **Shader 路径** - `useWebGL` Hook 需要从项目根目录的 `shaders` 文件夹导入 shader 源码，可能需要根据项目结构调整路径
2. **别名配置** - 推荐使用 `@holoengine` 作为统一入口，`@holorp` 用于直接访问 core 模块
3. **Git 历史** - 如果需要保留 holo-rp-core 的 git 历史，可以考虑使用 git subtree 或手动迁移
