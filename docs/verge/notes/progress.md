# v1.5.0 猫娘期台账

> 本文件是本期（P1–P5）的唯一台账，Task 28 全部回写进 spec §13。
> 格式：`## Task N — 标题`，下列「做了什么 / 验了什么 / 推后了什么」。

## Task 1 — `pet-profile.ts` 几何参数

- 落点：`src/shared/pet-profile.ts`（`PET_FORMS`/`SIZE_TIERS`/`TIER_SCALE`/`PIN_Y_RATIO`/`FORM_GEOMETRY`/`formGeometry`/`profileFor`）。
- 验了：9 条单测全绿（三档 k、standard 逐字节等于 `pet-geometry.ts:9-16`、钉位公式、面板/气泡 k、`catScale` 与 `scaleFor` 等价、未知形态回落）。
- 计划侧修正（不是口径差）：计划原文的 `hitBiasY` 模型与 `computeCatRect` 对不上（猫的命中框中心在 `pin.y − 1.5s`，不是绘制原点），改成 `hitCenter`（相对**钉位点**，单位 s）；「猫娘更高」那条断言原文写成绝对高 1.55 > 1.85（数学不成立），改为宽高比比较。两处都已回写进实现与测试。
- 推后：无。

## Task 2 — `rig.ts` 2×3 仿射与骨架原语

- 落点：`src/renderer/pet/rig.ts`。
- 验了：12 条单测（canvas 口径、镜像半径非负、`matRoot` 脚线、`matLocal` 不动点、`matFromJoint` 落点、挂链两条、旋转不可交换、`matOfXf` 与 `Xf.map` 四组逐点等价 1e-9）。
- 计划侧修正：`toMap2(matOfXf(x))` 的 `scaleX()` **不等于** `s·|sx|`（Xf 先转再各向异性缩，矩阵列一般不正交），所以四足必须走新增的 `map2OfXf(xf)`；`toMap2` 只服务 `Mat`。测试里留了一条反面对照把差值钉住（>1e-3）。
- 变异①：`matJoint` 忽略父级 → 挂链两条红（已复验）。

## Task 3 — `pet-geometry` 收 `profile`

- 落点：`computePetLayout`/`resolveGrowthDirection`/`computeCatRect` 各收 `profile?: PetProfile`，缺省 `DEFAULT_PROFILE`（定义在 `pet-geometry.ts` 常量之后，避免与 `pet-profile.ts` 成环）。
- 验了：`pet-geometry.test.ts` 31 条 + `pet-profile.test.ts` 9 条全绿；`check:main`/`check:renderer` 绿。
- 变异：`FORM_GEOMETRY.cat.hitCenter.dy` 从 −1.5 改 −6.0 → 「四个数与 v1.4 逐字段相等」红（已复验；这条尺一开始没牙，补了逐字段断言才有）。
- 推后：`renderer.ts` 里其余 4 处 `PET_W/PET_H` 字面量按计划留到 Task 27。

## Task 4 — 绘图助手改吃 `Map2`

- 落点：`art.ts` 的六个助手（`xfFill/xfGrad/xfEllipse/xfCircle/xfArc/xfPoly`）参数类型从 `Xf` 放宽到 `Map2`；`buildCatOps` 内用 `map2OfXf(xf/sh/fx)` 包一层。
- 验了：`art.test.ts` 32 条全绿（层序、采样密度 49/53/15、眼/高光比例、爱心锚点、双色 Zzz/月牙、包围盒）；全仓 643 个测试文件全绿。
- 计划侧修正：`Map2` 的 `scaleX/scaleY` 对 `Mat` 用列长、对 `Xf` 用 `s·|sx|`——两条语义不同（Task 2 已记）；这不是「同一个数两种写法」。
- 推后：无。

## Task 5 — 抽出 `buildOverlayOps`

- 落点：`art.ts` 新增 `catRigFor(input)`（身体三阵 + 派生量 + 徽章阵 `xfn`）与 `buildOverlayOps(input, badgeMap)`；`buildCatOps` 改为调用它，四足传 `map2OfXf(rig.xfn)`。
- 验了：`art.test.ts` 32 条仍全绿（overlay 段顺序与逐字段不变，这就是「纯搬运」的证据）。
- 计划侧修正：徽章阵不是「重新按 center 造一个」——它继承身体的 `sx/sy/dy` 只是 `rot=0`。计划的 `badgeMapFor(input, dx, dy)` 签名会丢掉身体的 `sx/sy`（歪头/压扁时不跟随），改成 `catRigFor` 里现算 `xfn`。猫娘侧 Task 6 直接复用 `catRigFor`（她的徽章钉胸口由 `badgeMap` 之外的另一枚阵提供，见 Task 6）。
- 计划侧修正：overlay 段实测**不含胶囊与未读**（它们在 `buildCapsuleOps`/`buildUnreadOps`，另一条函数），所以 `buildOverlayOps` 只含 Zzz/月牙/爱心/星星/徽章五层；计划里的七层清单是凭记忆写的。

## Task 6 — 猫娘站姿 + form 分派

- 落点：`src/renderer/pet/girl.ts`（`GIRL_PROPORTION`/`GIRL_LAYERS`/`girlPalette`/`buildGirlOps`）、`src/renderer/pet/form.ts`（`buildPetOps`/`PET_BUILDERS`）、`draw-ops.ts` 追加十个层标签、`renderer.ts` 一行派发。
- 验了：`girl.test.ts` 11 条（18 层序、比例钉死、五花色可分辨、线宽≥1、眼睛半径比与高光 0.30/0.15、blink 只压眼、token 可追溯、large 档不出窗、纯函数、`form` 缺省与 cat 逐字节等于 `buildCatOps`、不出四足层/文本）；全仓 644 文件全绿。
- 计划侧修正：
  1. `FORM_GEOMETRY.girl.centerOffset.dy` 从 4.5 改成 **79**：猫娘是二头身站姿、钉位在脚，4.5 会让头顶出窗（实测 −7.3px）。这是结构性差异，不是调参。
  2. `DEFAULT_PROFILE` 常量改为 `defaultProfile()` 函数：`pet-profile ↔ pet-geometry` 成环，顶层求值会 TDZ。
  3. 计划的「每花色 ≥6 颜色类」改为墨猫 ≥4／其余 ≥5——浅色猫的头发与肤色本来就接近，四足那张脸也从未靠六种色撑过。
  4. 计划给的 `girl.ts` 骨架里 `catBadgeMap`/`open` 等是草稿名，实现改为 `catRigFor` + 真实 `CatCoat` 字段。
- 推后：猫娘的泪层常态为空（Task 14 表情层接管）。

## Task 7 — 形态/档位入库存与右键菜单

- 落点：`verge-store`（`form`/`tier` + 默认 **girl/large**）、`verge-service`（`setForm`/`setTier`）、`pet-menu`（形态 2 + 身形 3 项、`onProfileStateChange` 收口）、`default-dependencies`（`applyProfileState` 广播两个字符串）、`ipc-channels`（`VERGE_PROFILE_GET/UPDATE`）、`verge-ipc`（GET handle）、preload（`getProfile`/`onProfileUpdate`）。
- 验了：`verge-store` 4 条、`pet-menu` 8 条、`pet-menu-attach`（16 项 + 两分隔线 + 收口两条字符串）、`ipc-contract` 8 条；全仓绿。
- 计划侧修正：`DEFAULT_PROFILE`（几何兜底）**不翻**，只有 `DEFAULT_VERGE_STATE` 翻——两层刻意分开（口径差⑰）。
