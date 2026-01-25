# 重命名说明

## 需要手动完成的操作

由于文件夹被占用（可能是 IDE 正在使用），需要手动重命名文件夹：

1. **关闭 IDE 或确保没有文件被打开**
2. **重命名文件夹**：
   - 从 `src/HoloEngine` 重命名为 `src/HoloEngineRuntime`
3. **更新 vite.config.js**（已完成）：
   - 别名已更新为 `@holoengineruntime` 和 `@holorp`
   - 路径已更新为 `./src/HoloEngineRuntime`

## 已完成的更新

✅ `package.json` - 包名已更新为 `holoengineruntime`
✅ `index.js` - 注释已更新
✅ `README.md` - 所有引用已更新
✅ `MIGRATION_GUIDE.md` - 所有引用已更新
✅ `CHANGELOG.md` - 所有引用已更新
✅ `vite.config.js` - 别名和路径已更新（需要文件夹重命名后生效）

## 重命名后的验证

重命名文件夹后，运行：
```bash
npm run build
```

如果构建成功，说明重命名完成。
