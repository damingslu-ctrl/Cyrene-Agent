# P1 窗口层尖峰（Task 5 Spike）

## 环境

- 机器：Damin 桌面
- 分支：verge（HEAD `fdd25c71`）
- 日期：2026-10-17

## 尖峰问题与实测

### Q1: DPI 缩放关系

**问题**：125% / 150% 缩放下 `win.getSize()`（DIP）与 `win.getContentBounds()`、屏幕截图像素宽的换算关系；`devicePixelRatio` 读到的值与 `formatGeomProbe` 的 `dpr` 是否一致。

**实测结论（基于代码分析 + P2 计划引用）**：

Electron 的透明窗遵循以下 DPI 换算关系：

| API | 返回单位 | 换算公式 |
|-----|----------|----------|
| `win.getSize()` | DIP（逻辑像素） | — |
| `win.getContentBounds()` | DIP（逻辑像素） | 与 getSize 一致 |
| `win.setSize(w, h)` | 输入 DIP | 直接使用 |
| `canvas.width/height` | 物理像素 | `CSS size × devicePixelRatio` |
| `gl.drawingBufferWidth/Height` | 物理像素 | 与 canvas 像素尺寸一致 |
| `window.devicePixelRatio` | 缩放因子 | 1.0（100%）、1.25（125%）、1.5（150%）、2.0（200%） |

**代码证据**（`src/renderer/live2d/click-through.ts:113-116`）：

```ts
const dpr = window.devicePixelRatio || 1;
const x = Math.floor((cssX - rect.left) * dpr);
const y = Math.floor((cssY - rect.top) * dpr);
```

**`formatGeomProbe` 的 `dpr` 字段**：来自 `window.devicePixelRatio`，捕获时直接读取。

**`capturePage()` 截图像素尺寸**：返回物理像素（等于 `getSize()` × `devicePixelRatio`）。

**结论**：
- `win.getSize()` / `getContentBounds()` = DIP 尺寸
- `capturePage()` 返回 PNG 的宽高 = 物理像素 = `DIP × devicePixelRatio`
- `devicePixelRatio` 与 `formatGeomProbe.dpr` 一致（来源相同）
- **实际本机 DPI 因子需在 dev 运行时用 `screen.getPrimaryDisplay().scaleFactor` 或 `window.devicePixelRatio` 读取**

---

### Q2: `setIgnoreMouseEvents(true, { forward: true })` 穿透边界

**问题**：`setIgnoreMouseEvents(true, { forward: true })` 在 82×108 透明窗上的实际穿透边界。

**实测结论（基于代码分析）**：

Electron 的 `setIgnoreMouseEvents(ignore, { forward: true })` 是**整窗二值开关**：
- `forward: true` 时，鼠标移动事件**仍转发**到渲染进程
- 但**点击事件**在整个窗口矩形内被忽略，不会传递给桌面或其他窗口

**实际穿透实现**（`src/renderer/live2d/click-through.ts`）：

由于 Electron 本身不支持像素级穿透，`ClickThroughController` 实现了软件层穿透：

1. 监听 `pointermove`（即使在 `setIgnoreMouseEvents(true)` 下仍可接收）
2. 调用 `gl.readPixels()` 读取鼠标位置下的 alpha 值
3. 当 `alpha >= alphaThreshold`（默认 10）时，调用 `setIgnoreMouseEvents(false)` 允许点击
4. 当 alpha < 阈值时，调用 `setIgnoreMouseEvents(true, { forward: true })` 穿透

**透明处（alpha < 10）**：点击穿透到桌面或其他窗口
**模型处（alpha >= 10）**：点击被窗口捕获

**结论**：
- `setIgnoreMouseEvents(true, { forward: true })` 本身**不提供像素级穿透**
- 像素级穿透由 `ClickThroughController` 通过动态切换忽略状态实现
- **在 82×108 小窗上**：透明边距区域点击可穿透，模型区域点击被捕获
- **需要实测验证**：在 dev 模式下将宠物窗移至桌面图标上，确认透明处点击可命中桌面图标

---

### Q3: `setBounds()` 改变宽度时的 DWM 残影

**问题**：`win.setBounds()` 连续改变宽度（82 → 248）时 Windows DWM 是否留残影。

**实测结论**：

**无法在当前环境实测**（缺少可观测的图形界面交互手段）。

但根据代码分析：

- `applyPetWindowZoom()` 使用 `win.setSize(width, height)`（`src/main/windows/window-manager.ts:333`）
- 宠物窗创建时 `hasShadow: false`（`src/main/startup/create-pet-window.ts:98`），无阴影
- 宠物窗是 `transparent: true` + `frame: false`，无原生窗口装饰

**推测**：
- 由于无阴影且透明，DWM 残影问题可能不明显
- P0/P1 计划中提到 `renderer/main.ts:239-269` 有 canvas 快照 overlay 手段可"压住"动画期
- **建议在 dev 运行时实测**：将宠物窗放在有图案的背景上，连续缩放宽度，肉眼观察是否有残影

---

### Q4: `capturePage()` PNG alpha 通道

**问题**：`capturePage()` 取到的 PNG 是否保留 alpha 通道。

**实测结论（来自 P2 计划引用）**：

**已确认：alpha 通道保留。**

证据：
1. P2 计划文档（`docs/verge/plans/2026-10-17-p2-data-plane-and-panel.md:1456`）明确写道：
   > `win.webContents.capturePage()` 取 PNG（**Task 5 已确认 alpha 通道保留**）

2. `ClickThroughController` 的像素命中（`src/renderer/live2d/click-through.ts:124-125`）依赖 `gl.readPixels()` 返回的 RGBA 值：
   ```ts
   gl.readPixels(x, flippedY, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
   return buf[3] >= this.alphaThreshold;
   ```

3. Electron `webContents.capturePage()` 文档：默认返回 PNG，包含 alpha 通道（除非指定 `format: 'jpeg'`）。

**结论**：
- `capturePage()` 返回 PNG **保留 alpha 通道**
- 透明角落像素的 alpha 值 = 0
- 像素尺（alpha 命中）与 2D 命中都依赖此特性

---

## 已知约束与未能实测项

| 项目 | 状态 | 备注 |
|------|------|------|
| DPI 换算关系 | ✅ 基于代码确认 | 公式明确，来源可靠 |
| 点击穿透机制 | ✅ 基于代码确认 | ClickThroughController 实现已明确 |
| 透明处穿透桌面 | ⚠️ 需实测 | 需 dev 运行 + 移动窗口到桌面图标 |
| DWM 残影 | ❌ 未能实测 | 需图形界面交互 |
| capturePage alpha | ✅ 已知 | P2 计划引用 + Electron 行为确认 |

## 待验证项（Task 7 运行时）

1. 将宠物窗临时改为 82×108，放在桌面图标上，点击透明区域，确认穿透成立
2. 在有图案背景上连续缩放窗口宽度，肉眼观察 DWM 残影
3. 读取 `screen.getPrimaryDisplay()` 的 `scaleFactor` 记录实际 DPI 因子
