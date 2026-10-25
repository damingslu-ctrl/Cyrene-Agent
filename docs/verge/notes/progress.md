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
