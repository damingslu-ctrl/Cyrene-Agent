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

## Task 9–11 — 16 档表情、buildFaceOps、尺 #72

- 落点：`src/renderer/pet/face.ts`（`Expression`/`FaceParams`/`FaceCtx`/`FACE_REST`/`TABLE`/`faceOf`/`MOOD_TO_EXPRESSION`/`buildFaceOps`）、`src/shared/min-pixel-diff.ts`（阈值与差度量单一来源）、`src/renderer/pet/face-distinguishability.test.ts`（尺 #72）。
- 验了：`face.test.ts` 8 条（16 名单、纯函数、≥3 通道、闭眼/wink、泪汗、blink 只压 lid、gaze、mood 归属）；`min-pixel-diff` 4 条；尺 #72 三条（16×15 全过、同图零差正对照、变异靶心）；`check:sprites` 仍 all clear（阈值搬移的等价证明）。
- 计划侧修正：
  1. 尺 #72 的画布从「整窗 164×216」改成「贴脸 104×104」并用手工头阵：整窗分母让所有表情差 <0.5%，那不是表情不可分辨，是尺把空白算进了分母。
  2. `girl.ts` 的脸部改为调用 `buildFaceOps`（单一来源），`GirlSpriteInput` 加 `expression`；`buildFaceOps` 的 `head` 在运行时由 `matRoot` 给，测试里用恒等阵。
  3. `MIN_PIXEL_DIFF`/`pixelDiffRatio` 移入 `src/shared/min-pixel-diff.ts`，`cat-sprites.mjs` 改读 bundle 出口，`cat-sprite-manifest.ts` re-export。
- 推后：`buildFaceOps` 的 `s`/`u` 参数暂未参与半径（眼睛按 head 阵缩放），Task 14 接通道时再统一。

## Task 12–14 — motion 内核、CLIPS/尺 #73、四层合成接线

- 落点：`src/renderer/pet/motion.ts`（Env/Clip/sampleClip/mixPose/springStep/blinkAt/注册表 + BODY 12 + GESTURE 9）、`motion-clips.test.ts`（尺 #73）、`renderer.ts`（`setForm`/`setExpression`/`playGesture` + `composeChannels` 槽位时钟）。
- 验了：`motion.test.ts` 17 条、尺 #73 8 条（rest 键集、p=0/p=1 归零、21 点振幅上限、ms 量级、物理 priority、body 档名、查不到抛错）、`renderer.test.ts` 18 条（含新增 4 条：cat 不走合成、girl 眨眼、槽位钟单调、手势只消费一次）；全仓 649 文件 / 6885 条绿。
- 计划侧修正：
  1. 尺 #73 的 rest 比较用 `toBeCloseTo(…, 12)` 而不是 `toEqual`：`Math.sin(π)` 的 1.2e-16 会被 round 成 `−0`，`Object.is(−0,0)` 是 false——那是浮点符号假红。
  2. `girl.ts` 的部件改为通道驱动（root 阵吃 lean/hop/squash/headBob，头阵吃 headPitch/headYaw，手臂各绕肩转 armL/armR，裙摆吃 hem，尾巴吃 tail）；`buildGirlOps` 的 `expression` 交给 `buildFaceOps`。
  3. 手势槽位「一次性片没新片时留到演完」——直接删槽会让连播四帧在第一帧后消失，也让 fps 判据读不到进度。
  4. `buildFaceOps` 的 `s`/`u` 参数暂未参与（眼睛按 head 阵缩放），保留签名给 Task 27 的三档端到端。

## Task 15–18 — 发送方闸门、workStatus 六档、两条通道、演出表

- 落点：`src/main/application/window-kind.ts`（id→类别登记簿）、`ipc-sender-policy.ts`（channel→类别）、`ipc-scope.ts`（可选闸门）、`src/shared/work-status-types.ts`、`src/main/pet/work-status.ts`（六档服务 + 8s 空洞回落 + 未知工具代称）、`work-status-ipc.ts`（GET/UPDATE 两条）、`work-status-presentation.ts`（六档演出表）、preload 两条入口、`default-dependencies` 装配 + `VERGE_PROFILE_GET` handle。
- 验了：`ipc-sender-gate.test.ts` 4 条（pet/chat 放行与拒绝、on 也过闸、表外零改动、无 sender 按 unknown）、`work-status.test.ts` 10 条（事件序、中断/成功、未知工具不泄漏、细节只挂两档、8s 回落、nextTickAt、订阅/退订、get 副本、dispose）、`work-status-presentation.test.ts` 5 条；`ipc-contract` 8 条；全仓 652 文件 / 6904 条绿。
- 计划侧修正：
  1. 闸门默认**不启用**，只由生产组合根注入 `senderPolicy`：单测与 fixture 没有真实 sender，默认开闸会把 window-system-ipc 那批既有测试全判成攻击。
  2. 没配 policy 时**零包装**（listener 原样转发），保住了 `ipc-scope.test.ts` 那两条「转发的是原函数」的形状断言。
  3. workStatus 的 8s 空洞回落到 `null`（空闲），不是「已处理」——后者会让 UI 假报「做完啦」。
- 推后：`VERGE_PET_REVEAL_ASK` 第五通道（点气泡唤卡）与 #74 真窗探针留到 P5 的 Task 28 一起收（当前 `revealAskWorkStatus` 未接）。

## Task 19–23 — pickRoll、18 手势、触摸六类、P4 门

- 落点：`companion.ts`（`ROLL_WEIGHTS`/`pickRoll`/`bucketOf`/`stepIdleGirl` + `TOUCH_KINDS`/`touch`/`POKE_VARIANTS`/`clickKindFor`）、`motion.ts`（补 9 条手势，CLIPS=30）、`renderer.ts`（`touch`）、`main.ts`（`reportTouch` 取代双击定时器）、`main.test.ts`（接线文本锁）。
- 验了：`companion.test.ts` 36 条（含四档权重窗口、夜间/力竭右移、previous 剔除、池空抛错、六类合并、猫形零消耗、五档变体、切形态清窗）、尺 #73 8 条（CLIPS=30、18 名全注册、16 条一次性片 ms 量级）；全仓 653 文件 / 6927 条绿。
- 计划侧修正：
  1. `pickRoll` 的窗口断言不写死端点：总重随昼夜/精力变（100 / 81.25 / 80.125），写死分数区间会在系数改动时变成哑尺——`bucketOf` 用绝对权重现算。
  2. `main.ts` 的 `onCatClick` 改名 `reportTouch`：退役后它不再是「点击」语义，文本锁也据此钉住旧名不许回来。
  3. Task 20 的仲裁（物理 > workStatus > activity）在 Task 14 的 `composeChannels` 里以「body 按活动、gesture 显式优先」实现；P3 的 workStatus 尚未接进 `composeChannels`（当前只走 mood 级联），这笔在 Task 27 的三档端到端里补。

## Task 24–25 — 资产 form 轴、146 张重出、实测重钉

- 落点：`cat-variants.ts`（`SpriteSpec.form`/`GIRL_POSES`/`GIRL_CROPS`/`cropsForForm` + `buildGirlSpriteOps`）、`cat-sprite-manifest.ts`（六处建表点 + 非角色 17 张加 `form: "girl"`；`CROP_CRITERIA` 改按 form 分列）、`cat-sprites.mjs`（`render()` 透传 form、新增 `--measure`、阈值按形态分列）。
- 实测（2026-10-24 `--measure`）：girl square n=83 cov 0.150–0.157、bust n=30 cov 0.180–0.192、full n=17 cov 0.091–0.118、round n=15 cov 0.136–0.142、wide n=1 cov 0.058。猫娘覆盖度只有四足的三到五成（窄高、留白多），拿猫的带量她必红。
- 验了：146 张全量重出 1267.3 KB，`check:sprites` all clear；`cat-variants.test.ts` 14 条、`cat-sprite-manifest.test.ts` 10 条；全仓 653 文件 / 6937 条绿。
- 口径差⑯落地：`CROP_CRITERIA_BY_FORM` 分列（cat 段保留 2026-10-22 出处，girl 段记本期实测）；图标支路 5 件（`assets/mochi-icon.png`/`icon-presets`×2/`tray-icon.ico`/安装器源图）**不翻**，仍是四足。
- 计划侧修正：
  1. `MIN_PIXEL_DIFF` 按形态分列（cat 0.5%、girl 0.15%）：猫娘 bust 取景里脸只占画布 1/6，同一个 0.5% 会把不同的画判成同一张。这是「量不出更细的分辨率」的下限，不是放空——girl 段仍有 1.5‰ 的牙。
  2. 撞车的 mood 改姿态（治愈→happy、温柔→tilt、陪伴中→peek、开心→stretch、学习/担心→prone、难过→lie、激动→peek），五对 0.000%/0.07%/0.12%/0.22%/0.35% 全部拉开到 0.15% 以上。
  3. 正对照从 full→square 换成 full→bust：girl 的 full（0.091–0.118）与 square（0.150–0.157）重带后已能分辨但不再跨界，full 图量 bust 仍红（0.118 < 0.13）。
  4. `GIRL_CROPS` 从暂行值放大（bust/square/round 窗口都加宽）：猫娘的头比猫宽，原窗口会把耳朵切出画布。

## Task 26–27 — 尺 #71 命中实测反钉、默认翻转与设置页

- 落点：`renderer.ts`（`getHitRect` 活读数 + `setProfile` + 6 处基址收进 profile）、`main.ts`（`getPetDiagnostics` 加 `hitRect/form/tier`；boot 读 + `onProfileUpdate` 先订后读）、`scripts/verify/pet-hit-cdp.mjs`（真窗 CDP 版，只读不点）、`src/renderer/pet/hit-iou.test.ts`（离线层，进 CI）、`settings-ipc.ts`/`preload`/`global.d.ts`/`types.ts`（两条 settings 通道）、`AppearanceSettingsPage.tsx`（形态/身形两行选择器）、三语九键。
- 验了：`hit-iou.test.ts` 2 条（六组 IoU ≥0.55 + 头部中线有墨；变异④写回 1.85 时 IoU 掉下去）、`renderer.test.ts` 22 条（含 4 条 hitRect/getHitAreaDefs）、`resources.test.ts` 4 条（三语 parity）、全仓 654 文件 / 6943 条；八道脚本门（main/preload/renderer/brand/roster/palette×2/sprites）全绿。
- **实测反钉（尺 #71 的成果）**：`FORM_GEOMETRY.girl` 从暂行 `{0.86, 1.55, dy −45.75s}` 改成 **`{1.32, 2.00, dy +29.4s}`**。实测：猫娘墨 bbox 在 standard 档是 1.32u×2.00u、中心在钉位**下方** 0.49u（三档实测 1.09–1.56 宽 / 1.79–2.19 高）。暂行值窄 35%、矮 28%，IoU 只有 0.09–0.15——「点头顶点不中」的根因就是它。
- 计划侧修正：
  1. 尺 #71 拆两层：`hit-iou.test.ts`（离线、进 CI、本轮已绿）+ `pet-hit-cdp.mjs`（真窗、手动跑）。CDP 版本轮未跑（需起 Electron + D 盘 profile，数分钟）——**这一条未验，必须明说**。
  2. 旧断言「猫娘命中框整体上移」被实测推翻（改为在钉位下方）；这是实测纠正暂行值，不是尺让步。
  3. 设置页走 `settings:get/set-pet-profile` 两条新通道（不比 `verge:profile:get` 的 `["pet"]` 白名单），写路径复用装配层收口。
- 推后：CDP 版 #71 的真窗跑一次（Task 28 发版前）；#74 的 `verify:work-status` 与 `VERGE_PET_REVEAL_ASK` 第五通道仍缺。

## Task 28 — 全量门、发版

- 全量门（2026-10-24）：`CI=true npx vitest run` → **654 文件 / 6943 条通过（1 skipped）**；
  `check:main`/`check:preload`/`check:renderer`/`check:brand`/`check:roster` 全绿；
  `palette:check`/`palette:migrate:check` 无漂移；`check:sprites` → 198 targets all clear。
- 构建：`pnpm` 因引擎版本不匹配跑不了（已知环境限制），改为逐条跑
  `desktop-typescript.mjs main|preload` + `npx vite build`，全部成功；
  `npx electron-builder --win` 出 **Mochi-Setup-1.5.0.exe（289,432,850 B）**；
  `verify:installer --expect-version 1.5.0` → verified（mpv v0.41.0 / mingit 2.55.0 / screenshot helper 2,337,688 B）。
- `npm run release` 不可用：`commit-and-tag-version` **不在 node_modules**（`release:dry` 报
  「不是内部或外部命令」）。按「不新增依赖」的约束，版本与 CHANGELOG 手工升级（1.4.0 → 1.5.0）。
  这条记进台账：下一期要么补装该 devDependency，要么把 release 脚本换成仓库内实现。
- 未推送、未建 GitHub Release：本轮只做到「本地构建 + 安装包校验通过」。

### 发布（2026-10-24）

- 推送：`master` → fork（`9adedb07..3fe6c05f`）、tag `v1.5.0` → fork（只推 fork，未推 upstream）。
- CI：`gh workflow run package-windows.yml --repo damingslu-ctrl/Cyrene-Agent --ref v1.5.0`
  → run [40085476244](https://github.com/damingslu-ctrl/Cyrene-Agent/actions/runs/40085476244) 全绿
  （含 `Verify installer artifacts`）。
- Release：[v1.5.0](https://github.com/damingslu-ctrl/Cyrene-Agent/releases/tag/v1.5.0)，
  资产 `Mochi-Setup-1.5.0.exe` **289,331,348 B**，
  sha256 `ecbf006e8c1779861b05bd667003652c26dddd42950be7c442d097582a7434e1`（与 CI 下载件逐字节一致）。
- 本地包 `release/Mochi-Setup-1.5.0.exe` 289,432,850 B / sha256 `889d2ac4…`：与 CI 包不同（构建环境差异），
  **发布资产取 CI 包**，本地包只作 `verify:installer` 的本地证据。
- `electron-builder.yml` 的 `publish: null` 未动。

## v1.6.0：逐帧动作提到原片 24fps + 高清姿态立绘（2026-10-25）

### 根因（不是「帧不够」，是「时钟慢」+「采样错拍」）

- 源片 `scripts/assets/source/pet-intro.mp4` 容器实测 **146 帧 @24fps / 6.083s**
  （mp4 `stts`：145×25/600s；`mvhd` 44100/266438）。旧管线只抽 15fps 的 91 帧。
- 逐帧像素比对：146 帧里只有 **88 张不同的画**（保持帧数分布 1×40 / 2×40 / 3×7 / 5×1），
  即原片本来就按「每 2 帧换一张」的 12 画/秒节拍。15fps 采样与它错拍，动作段再按 3–10fps 播，
  每张画被撑到 **100–333ms**——这就是用户说的「做不到视频一样连贯」。
- 循环段接缝：逐段实测首尾差 53.3–99.6，段内相邻帧差 6.97–36.8，**接缝比段内步进大 1.3–2.5 倍**，
  直接 wrap 必看见一次回跳。

### 改动

- `build-pet-intro.cjs`：`FPS 15 → 24`（与源片 1:1，不再丢帧）；重启动画图集 146 帧 / 304×248。
- `build-girl-anim.py`：`COUNT 91 → 146`；16 段区间换算到 24fps 全帧（0..145）；
  30 格静帧表的 25 情绪 + 12 姿态源帧号按**画面**重映射到新图集（不是按时间缩放）。
- `girl-anim.ts`：`GIRL_CLIP_PLAY` 按原片节拍分两档——静息循环 12fps（一拍两格）、
  动作与走路 24fps；新增 `loopMode`（默认 `pingpong`）与 `redrawFloorFor()`（片段帧率 2×，封顶 30）。
- `renderer.ts`：重绘下限改用 `redrawFloorFor`（原先 `片段 fps + 1`，在 24fps 段上会让重绘落后）。
- 新增 `build-girl-poses.py`：用户给的 7 张 1136×912 参考图 → 7 格高清姿态图集（340×248/格）
  + 512 高整身立绘 `girl-large.webp`。抠像用「色差种子 → 最大连通域 → 闭运算 → 填洞 → 外缘软 alpha」：
  只按色差会把背景那层粉色柔光与星星整片留下（深色桌布上是一片灰雾）；
  实测最大连通域 274,923 px vs 次大 1,730 px，差两个数量级，这条判据稳。
- `cat-variants.ts`：姿态优先取高清图集（`GIRL_POSE_FROM_HIRES` 6 个），其余与全部情绪档仍取静帧表。

### 量测与门

- `cat-sprites --measure`（197 张）：square 0.409–0.484 / bust 0.373–0.497 / full 0.213–0.296 /
  round 0.349–0.450 / wide 0.141，质心 ≤14.2%，字节 33–148 KB（256/512 档）、横幅 244 KB。
  带宽与预算按这组数重标（girl：square 0.39–0.51 / bust 0.35–0.52 / full 0.19–0.32 /
  round 0.33–0.47；预算 256 档 100 KB、512 档 210 KB、横幅 280 KB）。
- `CI=true npx vitest run` → **659 文件 / 7001 通过（1 skipped）**。
- `check:brand` / `check:main` / `check:preload` / `check:renderer` / `check:sprites` / `check:roster`
  与 `build:main|preload|cli|renderer` 全绿。
- 真窗命中尺（`pet-hit-cdp.mjs`，girl/standard）：质心 42.7 对窗轴 41、IoU **0.799**、
  bbox 26,31,39×55、变异对照 shrink 0.167 / shift 0.388（判红）→ `all clear`。

### 发布（2026-10-25）

- 推送：`master` → fork（`2aa41638..67768e37`）、tag `v1.6.0` → fork（只推 fork，未推 upstream）。
- CI：`gh workflow run package-windows.yml --repo damingslu-ctrl/Cyrene-Agent --ref v1.6.0`
  → run [40174667242](https://github.com/damingslu-ctrl/Cyrene-Agent/actions/runs/40174667242)
  `package` 6m8s 全绿（含 `Verify installer artifacts`）。
- Release：[v1.6.0](https://github.com/damingslu-ctrl/Cyrene-Agent/releases/tag/v1.6.0)，
  资产 `Mochi-Setup-1.6.0.exe` **296,245,158 B**，
  sha256 `3ad1d26567fe4b7a1118d95a0f696fedaacb546de19d228c9861df6427d30e86`。
- 首次 `gh run download` 在代理下中断（`unexpected EOF`），重试即成功——
  295MB 级产物走 7896 代理要留重试余地。
- 与 v1.5.0 相比安装包 +6.9 MB：146 帧图集（1.63 MB）+ 7 格高清姿态（592 KB）
  + 197 张派生位图增大（8.9 → 9.3 MB）+ 重建的全部页面资产。

## v1.7.0：猫娘专项——存在感、记号层、三区互动与静息（2026-10-25）

> 用户令：「我说的主要是猫娘形态，对它进行巨量提升吧，发挥你的想象」。本轮新能力全部只在
> `form === "girl"` 分支生效；四足的行为表、RNG 消耗与演出路径原样不动。

### 交付内容

| # | 能力 | 落点 |
|---|---|---|
| 1 | 逐帧脸框/墨框 | `scripts/assets/build-girl-face.py` 实测 146 帧 → `girl-face-meta.ts`；`girlFaceBox`/`girlInkBox` 把格内比例按朝向/缩放/旋转折进绘制空间 |
| 2 | 注视存在感 | `girl-presence.ts`：朝光标压 ≤4.2°、侧移 ≤2.2px（240ms 缓动）；转身要停 380ms、翻完锁 900ms；「注意」只认跨过 0.86 的边沿，冷却 12s |
| 3 | 屏幕记号层 | `girl-fx.ts`：地面投影（3.5% 奶油底光 + 五环伪高斯）、腮红、`!`、晕星、开心音符、生气蒸汽、走路/落地尘；画在身外的一律双色 |
| 4 | 三区点击 | `girl-zones.ts`：命中框 0–36% 头 / 36–76% 身 / 76–100% 脚，各有台词与手势；2.4s 内第 4 下 → 晕 3.6s、冷却 6s |
| 5 | 猫娘人格文案 | `GIRL_LINES`（摸/喂/玩/头/脚/晕/注意）、`GIRL_CHATTER`（四时段）、`GIRL_GREETINGS`；四足词表原样保留 |
| 6 | 静息周期 | 一个人待满 40s → 坐 18–30s（`rest` 活动 → `sit` 片）→ 起身伸懒腰 2.2s |
| 7 | 待机微动作 | `idle_micro` 档 35% 抽 `peek`/`wink`，短到不打断静坐 |
| 8 | 同级可顶 | `say(..., replaceSame)`：点完头立刻点脚，第二句顶掉第一句；≥3 的播报仍不可抢 |
| 9 | 渲染器接线 | 投影分两趟画、`tapAt(cssX,cssY,heldMs)` 统一入口、`getGirlDiagnostics()`（presence/noticeAgeMs/dizzyLeft/blush/clip/fx 计数） |
| 10 | 真窗探针 | `scripts/verify/pet-girl-cdp.mjs`：CDP 点画布、冻结真光标、18 条判据、报告落盘 |

### 口径与裁决

- 静息排在 `canRoam` 闸**之前**：贴边藏身时 `peekDx>0.5` 让 `canRoam` 恒 false，坐下挂在那道闸后面等于永远轮不到她歇。再加一条「光标压在她窗子里就把独处秒表按在 0」——否则手一离开窗子她会立刻坐下，读起来像「等你好久了」。
- 歇完先伸懒腰 2.2s 再回待机，并把静息秒表从「歇完」重新起算；不重置会变成「坐 25s + 站 15s」凑满 40s，坐下反成常态。
- `replaceSame` 只给用户刚做的动作；网络播报（优先级 ≥3）不可被顶掉——把重要信息换掉比少一句撒娇糟得多。
- 尺的 `zoom` 必须从 `getLayoutInfo()` 读：气泡展开时窗口 innerWidth 是 172 而基址 82，`innerWidth/base` 会算成 2.09，探针喂进去的坐标全落到命中框外（本轮真窗踩过）。`getLayoutInfo` 现在报 `{ base, center, s, zoom }`。
- 短手势（shy/wink 9 帧 @24fps ≈375ms）的取样窗从 450ms 收到 200ms；否则截到的是已经播完的 `happy/idle`。
- 探针的「真光标」是全局副作用不能动，加 `__cyrene.setGazeFrozen(true)` 停掉 120ms 轮询，让手动 `setGazeTarget` 稳定生效；该开关只在 debug 面，产品路径永不置真。

### 量测与门

- `CI=true npx vitest run` → **664 文件 / 7057 通过（1 skipped）**。两条与桌宠无关的用例在全量并发下失败（`agui-bridge.test.ts` 轮询窗口多读一次、`document-tools.test.ts` 15s 超时），单文件复跑 **138/138 绿** → 判为机器负载抖动，不记为产品红。
- 猫娘相关 7 个测试文件 **117 条**全绿：companion 57 / girl-anim 16 / girl-sprite 15 / girl-presence 9 / girl-fx 8 / girl-zones 8 / girl-face-meta 4。
- `check:brand` / `check:main` / `check:preload` / `check:renderer` / `check:sprites` / `check:roster` / `palette:check` / `palette:migrate:check` 全绿；`build:main`（773 文件）/ `build:preload`（141 + learn-exam）/ `build:cli` / `build:renderer` 全绿。
- 真窗 18/18 `all clear`（girl/standard，zoom=1，hitRect 19.66,30.18,45.88×63.27）：
  `lean.left` −3.96° / `lean.shift` −1.50px / `lean.facing` −1 / `lean.release` −0.15°；
  `notice.age` 422.6ms + 气泡「刚刚在看什么呀？」；
  头：clip `shy` / gesture `coverFace` / blush 0.72；
  脚：clip `wink` / gesture `shiver` / 气泡换成「别、别挠那里」；
  晕：剩余 3169.3ms / 记号层 16 笔 / 站定 `idle` / 结束归 0；
  坐：activity `rest`、clip `sit`。
- 截图与报告：`D:/cyrene-p5-accept/shots-girl5/`（`girl-baseline` / `girl-lean-left` / `girl-notice` / `girl-head-tap` / `girl-feet-tap` / `girl-dizzy` / `girl-rest` + `pet-girl-report.json`）。

### 发布（2026-10-25）

- 推送：`master` → fork（`5e8b2b12..ca5e3059`）、tag `v1.7.0` → fork（只推 fork，未推 upstream）。
- CI：`gh workflow run package-windows.yml --repo damingslu-ctrl/Cyrene-Agent --ref v1.7.0`
  → run [40193658507](https://github.com/damingslu-ctrl/Cyrene-Agent/actions/runs/40193658507)
  `package` 6m49s 全绿（含 `Verify installer artifacts`）。
- Release：[v1.7.0](https://github.com/damingslu-ctrl/Cyrene-Agent/releases/tag/v1.7.0)，
  资产 `Mochi-Setup-1.7.0.exe` **296,256,156 B**，
  sha256 `231624311181af73cc592bba26e9fd40791215828c34853a162720150d218399`（较 v1.6.0 +10,998 B）。
- 收口复验：在**最终构建**（`dist/cli` 报 v1.7.0）上重跑 `pet-girl-cdp.mjs`，18/18 `all clear`。
- 发版后工作树只剩 `.cache/*.png` 这一批量测贴图（已加进 ignore）；`dist/` 不入库。

## v1.8.0：猫娘专项 II——玩具、羁绊、作息与扑光标（2026-10-25）

> 用户令：「继续给我猫娘专项，你懂我的，我要超级多！」。所有新能力仍只在 `form === "girl"`
> 生效；四足的行为表、RNG 与渲染路径不动。

### 交付内容

| # | 能力 | 落点 |
|---|---|---|
| 1 | 毛线球玩具 + 物理 | `girl-toy.ts`：绘制空间里的固定 8ms 子步物理（r 4.5 / g 760 / 地面 0.42 / 墙 0.55 / 踢力 260 / 封顶 560 / 拖尾 7），首次自扒拉 12–22s、之后 14–26s，点球踢出 + `hop` + 台词 + 亲密度 +0.01 |
| 2 | 坐垫 | `girl-fx.ts` 的 `cushionOps`：`activity === "rest"` 时 180ms 指数淡入，`below` 层；起身淡出 |
| 3 | 羁绊五档 | `girl-bond.ts`：初识 0 / 熟悉 0.22 / 亲近 0.45 / 依赖 0.66 / 心意相通 0.86；升级炸爱心 2.6s + `clap` + 档位专属台词；状态卡与问候都报「相识第 N 天」 |
| 4 | 相识天数 | `daysTogether` 按本地日历日算（见面当天=1、坏档回 1）；`metAt` 落盘，跨重启保留 |
| 5 | 摸头连击 | 3.2s 窗、封顶 5；第 3/4 下换 `shiver`/`hop`，第 5 下多 +0.02；第 2 下起换连击台词；`patCombo` 进快照 |
| 6 | 受惊唤醒 | 睡着被碰 → 立刻 `idle` + 1.6s 缩身 + 夜/日两套台词；这一拍不走摸头/挠脚反馈 |
| 7 | 晨间伸懒腰 | 只在 `greet()`：5–11 点、每个日历日一次、`morningKey` 落盘去重；问候第 2 天起「第 N 天」独占一行 |
| 8 | 深夜提醒 | 渲染端每 30s 问一次；23 点后/5 点前、同一晚 45 分钟去重、优先级 0；睡/拖/扔/安静时不吵 |
| 9 | 逗光标 → 扑 | `girl-tease.ts`：900ms 内 ≥2 次 ≥26px 快速移动；扑一步 9–26px、压扁 220ms、18s 冷却、<6px 不扑 |
| 10 | 四行状态卡 | 亲密度/饱腹/精力/称号·天数，`\n` 硬换行；四足仍一行 |
| 11 | 气泡排版修复 | 字宽表换 Chromium 实测值（`·` 全角 9.00 / `%` 8.29 / `—` 8.05 / 空格 2.02）；`fillText` 带 `maxWidth` 硬边界 |
| 12 | 诊断与探针 | `getGirlDiagnostics` 增 `toy/cushion/bondUpLeft/patCombo/startleLeft/pounces/teasePending/nightCheckInMs`；`pet-girl-cdp.mjs` 扩到 48 条 |

### 口径与裁决

- 玩具物理必须跑在**绘制空间**：窗口会因气泡从 82 撑到 172，用 CSS 像素算弹道会让球在气泡开合时瞬移。边界由渲染端给（左右 5px、地面=脚线），物理本身不读窗口。
- 自动扒球不出声、不涨好感：她一个人的时候自言自语会变成噪声源；手动踢才走 `play` + 台词 + `+0.01`，两条路径在 `toyBat(auto)` 里分叉。
- 升级广播只挂在 `rewardAffinity`：`setVitals` 与读档不许误报「刚刚升级」，否则启动时会把旧档位念一遍。
- 深夜提醒不挂 `stepIdle`：多一个每拍分支等于多一个随机源，会把既有行为表的抽签全部挪位；改成渲染端 30s 轮询 + 引擎自己去重。
- 扑的位移夹在 `[9,26]px`：小于 9 像原地扭一下，大于 26 在 82px 窗里读成瞬移；`<6px` 直接拒绝，免得贴着光标抽搐。
- 晨间伸懒腰只从 `greet()` 触发：挂在每帧会在伪时钟/补帧下反复演；探针必须把 `Date.now` 与 `greet()` 放在同一个 evaluate 里。
- 状态卡与问候用 `\n` 硬换行，不走贪心折行：`依赖 · 第 1 天` 这类词组被从中间劈开比多一行难读；`\n` 同时让单测能按行锁文案。
- 气泡断行表的 `·` 必须按全角 9px 算：旧表按 5.2 估，状态句算 74.5、真宽 78.3，真窗里最后两个字切在盒外。合成端再加 `maxWidth`，估算再偏也只能压紧字距。

### 量测与门（2026-10-25）

- `CI=true npx vitest run` → **667 文件 / 7089 通过（1 skipped）**，无红。
- 猫娘相关 12 个文件 **205 条**全绿：companion 68 / art 37 / renderer 22 / girl-anim 16 /
  girl-sprite 15 / girl-fx 12 / girl-presence 9 / girl-zones 8 / girl-toy 6 / girl-bond 4 /
  girl-tease 4 / girl-face-meta 4。
- `check:brand` / `check:main` / `check:preload` / `check:renderer` / `check:sprites` /
  `check:roster` / `palette:check` / `palette:migrate:check` 全绿；`build:main`（773 文件）/
  `build:preload` / `build:cli`（v1.8.0）/ `build:renderer`（11.71s）全绿。
- 真窗 48/48 `all clear`（girl/standard，zoom=1）：
  球 x 67 → 20.30（vx 139.24、trail 7）→ 落 57.0/83.2，`hop` + 「接住！」+ 亲密度 0.570→0.580；
  连击 3 下 → `reliant/依赖`、`bondUpLeft=1600`、记号 `above=60`；
  状态四行实测 47.29 / 38.29 / 38.29 / 58.06 px（内宽 78）；
  晨间 `stretch` + `days=2` + 「早呀，今天也要一起\n第 2 天」；
  受惊 `sleep→idle`、剩余 1406ms、「被、被你摸醒了…」；
  扑 0→1、x 919→905、「抓到你啦！」、`teasePending=0`；
  静息 `rest`+`sit`、坐垫 1.00、地面 13 笔；深夜「眼睛该休息啦」。
- 截图与报告：`D:/cyrene-p5-accept/shots-v1.8-7/`（13 张 + `pet-girl-report.json`）。
- 未覆盖：坐垫只验了终态，没量 180ms 曲线；自动扒球的 12–26s 实际等待由单测锁；
  扑的 18s 冷却、深夜 45 分钟去重都只验了首次；运动观感用 3× 放大截图目检补充。

### v1.8.1 收口：换行禁则（2026-10-25）

- 触发：v1.8.0 打 tag 后、CI 构建期间目检 `girl-morning-stretch.png`，发现问候句仍被劈成
  「早呀，今天也要一 / 起」——预断只解决了「第 N 天」，第一行本身 81px 仍超 78px；
  继续扫连击截图又见「今天也想多黏你— / 会儿」。
- 处置：主动取消 CI run 40199751553（尚未构建完，未发 Release）；v1.8.0 的 commit
  `a5c97400` 与 tag 保留不改写，修复后从 v1.8.1 发。
- 修复：四段问候按标点预断两行；`wrapBubbleText` 加两条中文禁则——收尾标点不落行首
  （把上一字一起带下去）、末行 1–2 字时从上一行匀（标点连同前一个字一起搬）。
  探针新增 `morning.lines` / `morning.fits`，判据 48 → 50 条。
- 量测：全量 **667 文件 / 7092 通过（1 skipped）**；猫娘 12 文件 **208 条**；
  真窗 **50/50**；晨间三行实测 27 / 54 / 27.03px；连击气泡变成
  「今天也想多黏你 / 一会儿」，不再有孤字。
- 截图与报告：`D:/cyrene-p5-accept/shots-v1.8-9/`（13 张 + `pet-girl-report.json`）。

### 发布（2026-10-25）

- 提交 `0b6a7168`（fix(pet): 问候句与长句不再劈出孤字）、tag `v1.8.1`；只推 fork，未推 upstream。
- CI run [40200850130](https://github.com/damingslu-ctrl/Cyrene-Agent/actions/runs/40200850130)
  → package 成功。
- Release [v1.8.1](https://github.com/damingslu-ctrl/Cyrene-Agent/releases/tag/v1.8.1)（Latest）：
  `Mochi-Setup-1.8.1.exe` 296,261,011 B，
  sha256 `78ed910dcd60bb26935fdeae72f81393cac448b0d02c8d1a4e1ee10767647f6c`（与 CI 下载件逐字节一致）。
- v1.8.0：tag 保留，CI run 40199751553 主动取消，不发 Release。

### 猫娘专项 III：可见的小世界（v1.9.0，2026-10-25）

| # | 能力 | 落地 |
|---|------|------|
| 1 | 装扮系统 | `shared/pet-accessory.ts` 六项词表；`girl-accessory.ts` 五件逐帧脸框锚定；右键子菜单 + `accessory:<id>` 命令；存档 `accessory` |
| 2 | 伴飞小虫 | `girl-critter.ts`：蝴蝶 6–18 点 / 流萤其余；绕脸轨道、12s 寿命、520ms 捉后闪光；+0.02 亲密度 |
| 3 | 喂食道具 | `girl-snack.ts`：620ms 下落 + 摇尾，2.6s 收场；`feed` 命令顺带生成，数值仍归引擎 |
| 4 | 纪念日 | `girl-milestone.ts`：7/30/100/365、5.2s、`celebrated` 跨重启记账；彩带 10 枚 |
| 5 | 久别重逢 | `REUNION_GAP_MS = 3h`；台词 3 句；优先于普通问候、低于纪念日 |
| 6 | 星期语料 | `GIRL_WEEKDAY_CHATTER` 三池 + `WEEKDAY_CHATTER_CHANCE 0.5`；深夜不换池 |
| 7 | 睡毯 | `girl-fx.blanketOps` 6 笔；`mood === "sleep" && !quiet` |
| 8 | 散步 | `girl-wander.ts` 60–160px、贴边掉头；`roamTo` 引擎接管 |
| 9 | 诊断/探针 | `getPetDiagnostics().girl` 增 5 组读数；探针 50 → **78** 条 |

### 口径与裁决（v1.9.0）

- 装扮锚在 `girlFaceBox` 的逐帧脸框上：立绘每一帧的脸/头发都在动，固定比例钉会飘到空气里。
  每件先铺奶油光边再压色，深色桌布上也读得出来。
- 选择写 `BOND_KEY` 并立即落盘；同一件再点不出声。坏存档/坏命令一律回「不戴」，
  UI 永远不读到 undefined。
- 捉虫不碰睡眠：`sleep/drag/thrown` 时引擎拒绝，点击继续走三区——叫醒她只能靠摸或戳，
  虫子不能替用户动手。拒绝不能吞点击，否则睡着的猫娘点头会失效。
- 纪念日优先于重逢与「第 N 天」；安静期不点火也不记账，醒来补。`celebrated` 写
  `day:N`，同一天重开不重演；`milestoneLeft` 与渲染端共用 5200ms。
- 重逢判定必须在写回 `lastSeenAt` 之前读；`save()` 也刷新 `lastSeenAt`，否则关窗
  落位会把整场陪跑算成「没见过」。
- 开窗问候等 `profileReady`：抢在 profile 前 `greet` 会用四足台词，并把
  「第 N 天」/彩带/重逢整条分支吃掉；`greetedKey` 只在 `say` 真说出口时写。
- 星期语料抽签 `< 0.5` 才换池：一半日子仍按时段说，日历是线索不是准点播报机。
- 睡毯只在真睡且非安静时出笔：免打扰是「陪你不吵」，不是「她睡了」（native #67 同一条规矩）。
- 小虫首刷 45–85s、复刷 30–75s：见面就放虫会抢开机问候；手动召唤不受此限。
- 捉虫台词用「小家伙」：夜里是流萤，说「小蝴蝶」会穿帮。
- 睡毯的尺按「毯子贡献」判：采样窗里皮肤本身落在玫瑰色段，不同待机帧腿/手露出数量
  不同（实测基线 36–131），不能拿「回到基线 +80」当判据；睡时 860 → 醒 121，
  掉 739 像素才算收走。
- 空帧不是产品帧：换窗宽时画布清成透明，真跑抓到过 315B 纯空图。`shot()` 对
  <1200B 重截，`rosePixels` 对 0 重取，并把「基线非零」变成一条检查。
- 截图里头顶绿色对勾是「开心」徽章（`GREEN`，`mood === "happy"`），不是环境浮层；
  早期把它当噪声是因为新开进程是 idle，没有徽章。

### 量测与门（v1.9.0）

- `CI=true npx vitest run` → **673 文件 / 7128 通过（1 skipped）**，无红。
- 猫娘相关 18 个文件 **242 条**绿：新增 6 个文件 32 条（accessory 5 / critter 6 /
  snack 4 / milestone 2 / wander 4 / companion-girl-three 11），`girl-fx` +2，
  原 12 文件 208 条不变；菜单两文件 **19 条**绿（装扮子项 + 命令两条）。
- `check:brand` / `check:main` / `check:preload` / `check:renderer` / `check:sprites` /
  `check:roster` / `palette:check` / `palette:migrate:check` 全绿；
  `build:main`（774 文件）/ `build:preload` / `build:renderer`（6.07s）全绿。
- 真窗 **78/78 `all clear`**（girl/standard，zoom=1）：
  蝴蝶结 `bow` + 存档 `bow` + 「蝴蝶结，系好了」；换回 `none` + 「先这样也很好看」；
  夜间流萤捉住、`0.700 → 0.720`、「小家伙，对不起啦」、闪光后归 null；
  小鱼干进度 `0.088 → 0.371` 后收场；睡毯 `36 → 860`、醒来 `121`；
  散步 `+103px`（60–160 窗内）；第 7 天「我们认识第 7 天啦」、`left≈4903`、`above=20`；
  重逢「你回来了…我等好久」、`days=1`。
- 截图与报告：`D:/cyrene-p5-accept/shots-girl-v190/`（19 张 + `pet-girl-report.json`）。
- 未覆盖：五件装扮只有蝴蝶结真窗戴过，其余四件单测锁；小虫自主首刷/复刷没有等满，
  也没有单测锁（只验手动召唤）；白天蝴蝶只由单测锁；小鱼干没有逐帧量下落曲线；
  睡毯不比对具体待机帧；纪念日只真窗验第 7 天；重逢只验第一次。

### v1.9.0 发布证据（2026-10-26）

- commit `2615d165` + tag `v1.9.0` 只推 fork；CI run `40209095085`；
  资产 `Mochi-Setup-1.9.0.exe` **296,267,356 B** /
  `sha256 0692e801d9cc5045268c81059a876c64f4e3911fa158efd68ec1af9983abb9b2`
  （与 GitHub digest 一致），`isDraft:false`、Latest，上传完成 `2026-10-25T16:22:33Z`。
- 插曲：首轮 upload 404（Release 未真正建立），改 `gh release create` 带资产重建；
  tag/commit 未动，API 复核通过。

### v1.10.0：玩具箱、跟随、爪印、梦话云与五枚成就（2026-10-26）

| # | 能力 | 契约 / 关键值 | 入口 |
|---|---|---|---|
| 1 | 逗猫棒 | `WAND_MS 7000`、`WAND_CATCH_MS 520`；尖端半径 `max(6, face.w*0.34)` | 右键 / `wand` |
| 2 | 泡泡 | `BUBBLES_MS 5600`、6 颗、破 `320ms`、每 4 下说一句 | 右键 / `bubbles` |
| 3 | 落叶 | `LEAVES_MS 5600`、7 片、纯观众型 | 右键 / `leaves` |
| 4 | 猜拳 | `RPS_MS 3600`；`judgeRps` 共享判定；赢 +0.012、平 +0.005 | 右键子菜单 / `rps:*` |
| 5 | 跟我来 | `FOLLOW_MS 12000`、±160px、到位 14px、步进 42px | 右键 / `follow` |
| 6 | 爪印 | `PRINT_MS 3200`、间隔 260ms、上限 10、屏幕坐标 | 走路自动 |
| 7 | 梦话云 | 睡熟 `1800ms` 后出，`quiet` 不出，醒来即收 | 睡下自动 |
| 8 | 五枚成就 | catch / wand / bubbles≥12 / days≥7 / tier heart；徽章 3.6s，台词 TTL 6s | 互动自动 |
| 9 | 菜单与命令 | 5 个猫娘专属项（猜拳带三手子菜单）；四足置灰/忽略 | `pet-menu.ts` / `pet-commands.ts` |
| 10 | 诊断口 | `wand/bubbles/leaves/rps/prints/follow/achievements/achievement/stats/sleepSince` | `getGirlDiagnostics()` |

### 口径与裁决（v1.10.0）

- **头顶道具共用一把脸尺**：全部走 `girlFaceAt(now)`，立绘每帧的脸都在动，固定比例锚必飘。
- **四条时间线无物理**：坐标由出生时刻 + 种子解析，点中只记 `caughtAt/poppedAt`；
  渲染、诊断、探针同拍同落点。只有毛线球保留原有 8ms 子步物理。
- **点击路由**：三区 → 头顶道具 → 脚下毛线球；玩具在睡着/被拖/眩晕/安静期拒绝，
  但**不吞点击**——睡着时点玩具要落到三区，点头叫醒才不失真。
- **跟随允许边说边走**：`canRoam()` 的气泡闸只在 `follow !== null` 放行；其余气泡照旧。
  目标是光标横位相对窗心的偏移，夹到 ±160px 与工作区；差 42px 才重发 `roamTo`，
  否则每帧归零会把她的速度钉死；点她/到时/睡着/被拖/agent 忙立即收工。
- **爪印记屏幕坐标**：搬窗时脚印留在桌布上，走远自然滑出；窗内坐标会像贴纸一样被拖走。
- **梦话云不等于免打扰**：`quiet` 时不画——那半小时是陪你不吵，不是她睡下了；
  自动宣布一个没发生的事比不画更糟。
- **成就只从既有计数器来**：一次互动最多弹一枚，安静期不弹不记账；首次解锁台词优先级 2，
  压普通玩具台词（1），但 `< bondUpUntil` 时让位给升档句；`greet` 用 `!said` 让纪念日/重逢
  先说。`stats`/`achievements` 随 `BOND_KEY` 落盘，跨重启保留。
- **泡泡每 4 下说一句**：连续动作颗颗配词会变弹幕；第 1/5/9 颗说，保留反馈不刷屏。
- **猜拳输了不扣分**：陪伴游戏不是排位，保证多玩永远正向。
- **一条时间线自己收场**：各自 `alive()` + `left` 读数，到寿命 `tick*` 归 null；
  没有新定时器、没有全局「当前玩具」状态机，生成时清空对方即可互斥。
- **探针修的是尺，不是产品**：成就首次解锁句合法地压住泡破台词；探针先模拟用户
  「点掉这句」再验泡泡自己的词，`say()` 优先级未改。

### 量测与门（v1.10.0）

- `CI=true npx vitest run` → **684 文件 / 7185 通过（1 skipped）**，无红
  （v1.9 基线 673 / 7128，+11 文件 +57 条）。
- 新增 11 个文件 **55 条**：wand 6 / bubbles 5 / leaves 3 / follow 3 / prints 4 /
  achievements 6 / dream 3 / rps 4 / pet-rps 2 / companion-girl-toys 11 / renderer-girl-toys 8；
  改动过的 15 个相关文件合计 **91 条**绿（pet-menu 10 + attach 9 + commands 6 + three 11 等）。
- 色板棘轮：TS/TSX **22 行 / 上限 22**（RPS 玩家牌三行字面量收回 `girl-rps.ts`
  token；先红后绿，未抬上限）。`check:brand` / `check:main` / `check:preload` /
  `check:renderer` / `check:sprites` / `check:roster` / `palette:check` /
  `palette:migrate:check` / `check:plugin-schema` / `check:adapted-models` 全绿；
  `build:main`（776 文件）/ `build:preload`（144 + learn-exam）/ `build:renderer`（6.84s）/
  `build:cli`（v1.10.0）全绿。
- 真窗 **110/110 `all clear`**（girl/standard，zoom=1）：
  逗猫棒 `left 6790` 未捉 → 同拍点中 → `stats.wand=1` + `first-wand` + 存档同步，7s 收；
  泡泡 `6 → 5`、气泡「再吹一串嘛」；落叶 `left 5392`、「哇…下叶子雨了」；
  猜拳本轮抽到「输了」→「再来一局嘛」，判定与探针同源；
  跟随 `+49.5px`、`left 11793`，点她后 `follow=null`；爪印 4 枚自行褪去；
  梦话云 `sleepSince=122289` → 醒 `-1`；捉虫首解锁 `first-catch` 压过普通句、
  亲密度 `0.700 → 0.720`；第 7 天补解锁 `seven-days`；重逢读档三枚成就在场。
- 截图与报告：`D:/cyrene-p5-accept/shots-girl-v110/`（27 张 + `pet-girl-report.json`）。
- 未覆盖：逗猫棒空挥 miss 台词、泡泡连破 12 颗的成就、落叶逐帧旋落曲线、猜拳另外两组
  胜负词、跟随 12s 到时与跨工作区夹取、搬窗后爪印滑出、梦话云笔数与 1.8s 前静默、
  `bubble-lover` 与 `heart-bond` 真窗触发——均由对应单测锁条件，未在真窗复演。
