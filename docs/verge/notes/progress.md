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
