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

### 4. `resizable: false` 下窗口能否被程序化长到 248×482（Task 7 评审 I-5，仍未实测）

原判据写的是 `setBounds`（size+pos 一条指令）。Task 7 fix 轮按 native `main.rs:4308-4315`
拆成两条独立指令后，这条风险**结构上已被两半各自已证的先例覆盖**：

- `setSize` —— 上游 `petZoom` 生产路径就在用它（`settings-ipc.ts` / `general-settings-lifecycle.ts`），
  `resizable: false` 只拦用户拖边框（WS_THICKFRAME），不拦程序化 `SetWindowPos`；
- `setPosition` —— 拖拽链路 `pet-window-movement.ts:91` 一直在用，且已验过「拖得动」。

**但「已覆盖」只证到尺寸档位相近的范围**：zoom 档最长到基址的 1.5 倍左右，从没在
`resizable: false` 下把窗口长到 248×482。这条不许当已证结论引用，Task 10 首次 dev
必须现场掐三段证据（探针 profile 用 `--user-data-dir=D:\cyrene-p0-probe`，别碰用户自己的实例）：

- 正对照：渲染端请求 `248×482` → GEOM 行的 `actual` 必须是 `248x482`（125% 缩放下允许 ±1 DIP）；
- **探针自己在打的先决对照**：改一次尺寸（例如切 `petZoom` 档）→ 必须出现 ≥1 行且 `actual`
  跟着变。没有这一条，下面那串的「0 行」也可能只是 `VERGE_GEOM_PROBE` 没生效。
- 负对照（**已按复审 F-2 改写过**）：同一 bounds 在 ≥1.5s 里持续重发（约每 200ms 一次），
  GEOM 行数必须**恒为 0 增量**。旧写法「连发两帧不出第二行」是废判据——`setPetWindowBounds`
  的 0.5s 节流（native `main.rs:4389` 同口径）在两条门都被删掉的情况下同样会吞掉第二行，
  于是那条判据对着坏实现也是绿的。新写法对节流免疫：门若失效，1.5s 里会出现约 3 行。
- 失败分支：若 `actual` 仍是 `82x108` → `resizable: false` 被证伪，就地改 `resizable: true`
  并用 `min/max` 钉住尺寸，别把这条留给 Task 10 的屏幕验收去发现。

**读 GEOM 行的两条规矩**（复审 F-1）：

1. `pin / center / peek / e` 四列在 main 侧现在打 `-`（main 拿不到猫模型，
   见 `src/main/verge/geom-probe.ts` 的注释）；这四列要有真值，得等 Task 12 给
   PET_RESIZE 载荷扩上 `e / peekDx / pinInWin`。读到 `-` 判不了就判「这一列没证据」，
   不许读成 PASS——这是 spec §6.8 的第三层尺。
2. **拖拽期间的 `applied` 与 `actual` 位置差不算落位失败**。位置权威是
   `PetWindowMoveController`，`setPetWindowBounds` 在拖拽期故意把位置门关掉（只发尺寸），
   所以 `applied`（渲染端想要的位置）与 `actual`（用户正拖着走的窗位）必然分叉。
   判落位只看尺寸列；要看位置对不对，等拖拽结束后那一行的 `actual`。

---

## 追加：色板与胶囊在 Chromium 管线下的口径（Task 8/9 复审要求，spec §6.2 / §9-6）

**先说清证据等级**：下面每一条标了是「代码推导」还是「实测」。本轮只有代码推导——
P1 这半还没有真的解释器上屏（渲染入口在 Task 10 才重写），所以 **§9-6 要求的
「P1 一次、P2 一次」实测都还没发生**。tokens 单测现在钉住的数值只证明
「与 native 逐字节相等」，不证明「在 Chromium 上就长这样」。实测完成后回来改这张表，
不要改单测的数值。

### C1 `fill_grad` 不搬 scanline（结论：不搬，代码推导）

native `ui.rs::scanline_spans/fill_grad` 按 viewBox 的 y 逐扫描线取色再叠，是因为
egui 的 `PathShape` 当时填不了渐变。Chromium 的 `CanvasGradient` 对 AA 路径直接填充，
亚像素边缘由合成器处理。**native #68 的那次翻车（浅色桌布上猫身被洗成灰白，覆盖度
≈0.8）正是逐行叠色在子像素边界重复计色的结果**——把这套叠色搬过来等于把已修好的
bug 重新引入。fork 侧 `xfGrad` 因此只发一条 `gradPath` 指令，轴取 viewBox 的
`x=60` 那条竖线映射后的结果，与 native 的染色方向一致。

**待实测**：渐变边界在 74px 档是否有可见的色带（banding）。Task 10 上屏后按
`file/verify_*.py` 的逐配对最小值判据量一次猫身中段。

### C2 胶囊静默降的是 RGB 而不是 alpha（结论：照抄 native 的换色表，代码推导）

native `main.rs:4979-5018` 的 `CAP_ON/CAP_OFF` 是两张**不透明色表**，静默时整颗
胶囊换一张表，alpha 只在 `al(v) = (v as f32 * cap_op) as u8` 里承担展开动画。
原注释的教训是「alpha 在这条 GL/DWM 管线上会被放大一档」——那是 egui 侧的观测。
Chromium 合成对 `rgba()` 做的是标准 sRGB over，不存在那条放大路径，所以**这条教训
不迁移，但结论（降 RGB）仍然照抄**：天天挂在眼前的东西靠透明度退让，在浅色桌面上
会退成「一块更淡的深色」，读起来像坏了而不是像安静了。

**待实测**：`rgba(20, 22, 29, 0.745)`（静默档底）叠在浅色桌布上是否与
`rgb(20,22,29)` 不透明叠色肉眼等价。不等价则要把 `CAP_A_*` 表在 fork 侧重新调，
并把结论写回这里。

### C3 alpha 的两种量纲必须分开（结论：拆成两个函数，代码推导）

native 自己就是两套：`ui.rs:145 with_alpha(c, a: f32 0..1)` 与
`panel.rs::theme::over(a: u8 0..255)`。混用一次的实际代价是地面投影
（native 用 `0.016` 这种 f32）被传进 `over()` 后变成 `over(4)`——一块几乎看不见的
影子；反向传则 `0.016*255` 进 `with_alpha` 被 clamp 成实心黑盘。fork 侧不做 clamp：
`withAlpha` 只收 0..1、`wash` 只收 0..255，越界或 NaN 直接抛
（`tokens.test.ts` 钉了双向抛错）。

### C4 月牙为什么不能用 `destination-out`（结论：剪域 + evenodd 差集，代码推导）

native `crescent` 是逐行填「外圆弦减内圆弦」——被咬掉的区域**不画**，底下是什么就留
什么。猫窗是透明的，`destination-out` 是擦除：它会在 drawing buffer 上打一个洞，
让 Task 5 的 alpha 命中尺把那块读成「穿透」，于是月牙自己变成鼠标穿透区。

**但裸 evenodd 也不对**（复审 N-2）：两圆 evenodd 是**对称差**，会把「内圆伸出外圆」
的那一截也填上。本原语的实际参数是 `d = 0.516r`、`cut = 0.92r`，两圆相交、内圆伸出
最多 `0.436r`——收起档那颗月牙约 3px 的 INK 加 2px 的 PAPER 脱节墨点，且越出
`opsBounds` 宣告的外圆框（`art.test.ts` 的窗内判据正以那个框为前提）。
落地写法是**先按外圆 `clip()`、再在剪域里走两圆 evenodd**：剪域切掉伸出去的那截，
evenodd 挖掉重叠的那截，合成真正的 `outer ∖ inner`，全程纯叠加、不打洞。
`ops.test.ts` 钉了三条：`globalCompositeOperation` 全程不变、`clip` 恰好一次且发生在
`fill:evenodd` 之前、剪域那条弧是**外圆**（`arc cx cy r`）而不是内圆。

### C5 面板表面三色（BG_SOLID / CARD / SEP）

`palette.rs:8-10` 明写它们是「过了本机 GL/DWM 管线的预混结果，搬到面板外面就没有
意义」。fork 侧的 `PANEL_CARD()/PANEL_SEP()` 目前只证明与 native 逐字节相等，
**§6.2 要求的按 Chromium 重推导在 P1 没有对象可推**（P1 不画面板），归 P2 实测。
`tokens.ts` 的头注释已把这条标成「不是 fork 侧的契约、重测前不得当验收判据」。
