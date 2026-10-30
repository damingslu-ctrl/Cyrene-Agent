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

### v1.10.0 发布证据（2026-10-26）

- commit `0e66680c` + tag `v1.10.0`（annotated，peel 同一 commit）只推 fork；
  上游未动。
- CI：手动 dispatch run `40214568365`（ref `v1.10.0`），`package` job 4m39s 全步绿。
- Release [v1.10.0](https://github.com/damingslu-ctrl/Cyrene-Agent/releases/tag/v1.10.0)：
  `isDraft:false`、`isPrerelease:false`、Latest；资产 `Mochi-Setup-1.10.0.exe`
  **296,283,711 B** / `sha256 fd41ca8b65ca70fb4e37ff8280610bd65b866442765a017dee6b5bba54876a08`
  （与 GitHub digest 一致），上传完成 `2026-10-25T17:12:32Z`，公开于 `17:18:10Z`。

### v1.11.0：纸箱、激光、梳毛、薄荷、纸飞机、小鸟与成长记录（2026-10-26）

- 六件新玩具各自成模块（`girl-box` / `girl-laser` / `girl-brush` / `girl-catnip` /
  `girl-plane` / `girl-bird`），状态只有「出生时刻 + 种子 + 互动时刻」，所有位置、
  阶段、命中框由 `now` 解析；`girl-prop-art.ts` 只放画法，不持状态。
- 共享命令 +5（`box` / `laser` / `brush` / `catnip` / `plane`）；小鸟不进菜单，
  随 `bird` 命令与空闲自访。右键「猫娘」子菜单固定七条（手势），玩具在主菜单。
- 引擎新增七个事件入口（`boxKnock` / `boxCatch` / `laserEnd` / `brushEnd` /
  `catnipEnd` / `planeEnd` / `birdFlee`）+ 三个 getter（`birdVisit` / `growthReport` /
  `achievements` 扩容）；十项互动计数进 `PetStats` 与存档。
- 五枚新成就：`box-hide`（2 箱）/ `laser-catch`（3 次）/ `brush-lover`（10 轮）/
  `catnip-high`（2 轮）/ `plane-catch`（2 架）；成就页 10 枚满编。
- 成长记录：一句两行 `{档} · 第 {days} 天` + `徽章 {n}/10 · 互动 {total} 次`，
  优先级 2，安静期拒收；`total` 是十项之和，和成就同一份 `PetStats`。

### 口径与裁决（v1.11.0）

- **命中顺序＝绘制顺序**：新六件画在小虫与毛线球之上，命中判断也整组提前；
  纸箱是组内第一判（它盖住整个人）。真窗 O1 抓到过球偷走敲门的那一下，
  修的是 `tapAt` 顺序，不是探针坐标。
- **纸箱敲门冷却 480ms**：连点只算一次，避免按住刷 `boxes` 之外的无效判定；
  真正计数只在探头窗内抓到脑袋时 +1。
- **梳毛/薄荷整轮走完才计数**：被别的 solo 道具顶掉不结算（`clearSoloToys`）；
  点梳子/薄荷只是加演，不额外计数。
- **小鸟不产出数值**：来访不是玩具，点它只有飞走与羽毛；不入统计、不做成就条件，
  所以「请小鸟」可以随时点，不构成刷分路径。
- **升档优先于玩具完成句**：刷毛完成刚好升档时，气泡给「最喜欢你了。真的。」，
  梳完那句让位；探针按设计行为认账（`brush.line` 接受两组词），不改优先级。
- **成长记录用十项和**：`互动` 读数必须能被 `PetStats` 复算，探针 `growth.agrees`
  同时对齐成就数与十项和，防止报表和存档各算一套。

### 量测与门（v1.11.0）

- `CI=true npx vitest run` → **692 文件 / 7242 通过（1 skipped）**，无红，260.88s
  （v1.10.0 基线 684 / 7185，+8 文件 +57 条）。
- 新增 8 个文件 **55 条**：box 5 / laser 5 / brush 5 / catnip 4 / plane 6 / bird 5 /
  companion-girl-toys2 14 / renderer-girl-toys2 11；其余 7 条落在改过的
  achievements、menu、menu-attach、commands、companion-girl-toys、renderer-girl-toys 上。
- 十道门全绿（brand/main/preload/renderer/sprites/roster/palette/palette-migrate/
  plugin-schema/adapted-models）；`build:main` 776 文件 / `build:preload`（144 +
  learn-exam）/ `build:renderer` 6.53s。
- `check:renderer` 抓到 `boxHeadRect` 缺 `alpha`（TS2741），补齐后转绿。
- 回归单测的牙：临时改回旧命中顺序（`this.box && !this.toyState`）→
  「箱面先敲箱」当场红（knocks 0）；恢复后 `cmp` 与备份逐字节一致，测试转绿。
- 真窗 **148/148 `all clear`**：纸箱敲门「谁呀？」→ 探头抓住 `boxes=1`
  「被、被发现了！」；激光 `lasers=1`；梳毛 `brushes=1`（完成句让位升档）；
  薄荷 `catnips=1`「晕乎乎的…好开心」；纸飞机 `planes=1`「接住啦！」；
  小鸟 `perch → away` 且十项计数前后不变；成长记录
  `心意相通 · 第 1 天\n徽章 3/10 · 互动 14 次` 与成就 3 / 十项和 14 双向对齐；
  第 7 天彩带 20 根；读档重逢后五枚新计数器各为 1。
- 截图与报告：`D:/cyrene-p5-accept/shots-girl-v111/`（36 张 + `pet-girl-report.json`）。
- 未覆盖：纸箱三档探头窗边界逐毫秒、激光轨迹逐帧、梳毛四趟单趟漏帧、
  薄荷打滚完整姿态曲线、纸飞机空手 miss 台词、小鸟跨工作区落脚夹取。

### v1.11.0 发布证据（2026-10-26）

- commit `c205c075` + tag `v1.11.0`（annotated，peel 同一 commit）只推 fork；
  上游未动。
- CI：手动 dispatch run `40219346838`（ref `v1.11.0`），`package` job 6m50s 全步绿。
- Release [v1.11.0](https://github.com/damingslu-ctrl/Cyrene-Agent/releases/tag/v1.11.0)：
  `isDraft:false`、`isPrerelease:false`、Latest；资产 `Mochi-Setup-1.11.0.exe`
  **296,285,308 B** / `sha256 0b7f1e493bb6d81fc8c44b6aa6edd5a60b2e73026f7ad7db15700422364d1407`
  （与 GitHub digest 一致），上传完成 `2026-10-25T18:14:29Z`，公开于 `18:18:38Z`。

### v1.12.0：抓板、铃铛球、发条鼠、打地鼠、抱抱、呼噜、小目标、日记与雨天（2026-10-26）

- 八个纯模块：`girl-scratch` / `girl-bell` / `girl-mouse` / `girl-mole` / `girl-hug` /
  `girl-purr` / `girl-quests` / `girl-diary` / `girl-rain`；状态只有「出生时刻 + 种子 +
  互动笔数」，所有位置、阶段、命中框由 `now` 解析。
- 共享命令 +8（`scratch` / `bell` / `mouse` / `mole` / `hug` / `rain` / `quests` /
  `diary`）；右键菜单从 32 项扩到 40 项，四足形态统一置灰。
- 引擎新增八个计数入口与 getter（`scratchStart/Boost/End`、`bellStart/Ring`、
  `mouseStart/Catch/Miss`、`moleStart/Whack`、`hugStart/Tap`、`rainStart`、
  `questsReport`、`diaryReport`）；`PetStats` 十项 → 十八项。
- 八枚新成就（成就页 18 枚）：`scratch-art`(3) / `bell-fan`(3) / `windup-hunter`(2) /
  `mole-master`(5) / `hug-lover`(3) / `purr-engine`(3) / `rain-listener`(2) /
  `daily-perfect`(3 件小事)。
- 成长记录改三行：`{档} · 第 N 天` / `徽章 n/18` / `互动 N 次`；分母读成就表。

### 口径与裁决（v1.12.0）

- **睡着不接地面玩具是设计**：探针第二次放发条鼠正赶上夜里小睡，引擎静默拒收。
  一度改成「点玩具先叫醒」，撞上两条既有设计锁后撤回；探针改在每段玩具前用
  `toggle-sleep` 摆正前置条件（`awakeForPlay`），并把「叫不醒」本身记为检查。
- **一轮一拍账**：抓板整轮 +1；铃铛每声 +1（封顶 5）；发条鼠抓住 +1、跑掉自嘲不计数；
  地鼠每只 +1、同一只不重复；抱抱开场 +1、点她只叠心不加账；雨天发起 +1。
- **呼噜按串计数**：旧呼噜散尽再起才 +1，连着的摸头只把终点往后推，防止一串摸头刷穿成就。
- **小目标「做过就记」**：不设惩罚、不要求连续；跨天清零前把当天笔数收进日记，
  没笔数的日子不写空条目；`daily-perfect` 看 `quests >= 3`（跨天累计）。
- **散步先收气泡**：气泡占着 `canRoam`，`roamTo` 下一帧会被掰回 `idle`；现在先
  `dismissBubble` 再迈步，菜单不再「点了没反应」。

### 量测与门（v1.12.0）

- `CI=true npx vitest run` → **703 文件 / 7299 通过（1 skipped）**，无红，240.11s
  （v1.11.0 基线 692 / 7242，+11 文件 +57 条；新增全在 11 个新文件里，改过的文件净增 0）。
- 新增 11 个测试文件 **57 条**：scratch 5 / bell 4 / mouse 4 / mole 5 / hug 4 / purr 3 /
  quests 4 / diary 5 / rain 4 / companion-girl-v112 9 / renderer-girl-v112 10。
- 十一道门全绿（brand/main/preload/renderer/sprites/roster/palette/palette-migrate/
  plugin-schema/adapted-models/plugin-sdk）；`build:main` 776 文件 / `build:preload` /
  `build:renderer` 全绿。
- 真窗 **190/190 `all clear`**：抓板 `marks 0→1`、整轮 `scratches=1`；铃铛冷却吞掉
  第二下、第三下 `rings=2`、`bells=2`；发条鼠 `mice=1`、第二轮 `sleepSince=-1` 真开局、
  跑掉「溜走了…」不计数；地鼠 `moles=1`、同只不重复；抱抱 `hugs=1→2`、
  `purrLeft>2500`；雨天 20s 与铃铛/抱抱并行；小目标四行 `2/3`；日记两行；
  成长记录 `心意相通 · 第 1 天\n徽章 3/18\n互动 18 次` 与成就 3 / 十八项和 18 对齐；
  散步 `905 → 882.9(walk) → 830`（75px）。十八项计数 reload 后原样回来。
- 截图与报告：`D:/cyrene-p5-accept/shots-girl-v112/`（46 张 + `pet-girl-report.json`）。
- 未覆盖：抓板八道痕/铃铛五声/抱抱五颗心的封顶边界、地鼠六个冒头窗逐毫秒、
  小目标全清专属句、日记七条封顶与跨天清零的真窗复演、雨天 26 颗雨滴逐颗轨迹；
  `awakeForPlay` 本轮未触发（整场醒着）。

### v1.12.0 发布证据（2026-10-26）

- commit `5e092a87` + tag `v1.12.0`（annotated，peel 同一 commit `5e092a8708cb…`）只推 fork；
  上游未动。
- CI：首跑 run `40227264777`（ref `v1.12.0`）在 `Verify installer artifacts` 红：
  `mpv --version` 探测失败（同一版 mpv 20261021 在 v1.11 run 里刚刚探测通过，判为运行器瞬时态）；
  重新 dispatch run `40230516836`，`package` job 6m51s（20:23:12Z → 20:30:03Z）全步绿。
- Release [v1.12.0](https://github.com/damingslu-ctrl/Cyrene-Agent/releases/tag/v1.12.0)：
  `isDraft:false`、`isPrerelease:false`、Latest；资产 `Mochi-Setup-1.12.0.exe`
  **296,294,875 B** / `sha256 776f48200665979124c7f544adadbfa387a1a6b5f40df4ad652a0f155fbce296`
  （与本地下载件、GitHub asset digest 三处一致），公开于 `2026-10-25T20:44:33Z`。

### v1.13.0：会累的待机舞、九件新玩具与每日签（2026-10-26）

- 待机编排独立成纯模块 `girl-idle`：`dance` 9–14s → `sit` 6.5–10s 或 `lie` 9–13s
  （每轮交替）→ `stand` 0.9–1.4s → 再跳；坐够 55% 再趴一小会儿（5–8s 的 `doze`）。
  状态只有 `since / until / nextRest / rests / bouts / seed / deep`，抖动由
  `idleJitter(seed,bout,salt)` 确定性解析，产品固定 `seed=0x51ede`。
- 渲染器接线：只在活动=idle 且无独演玩具时推进；进入/退出挂起各 reset 一次，
  玩完回来永远先给一整支舞；基础帧段 `idle/sit/drowse/stand`，姿态按
  `GIRL_IDLE_POSTURE = {dance:0, sit:0.42, lie:0.92, stand:0}` 以 240ms 指数缓动；
  自主微动作只在 `dance` 段允许。
- 九个纯模块：`girl-tail`（5.2s，暖身 500ms，320ms 冷却、最多 3 下，三下后晕）/
  `girl-knead`（4.6s，settle 450ms，260ms 冷却、最多 6 拍，收尾起呼噜）/
  `girl-roll`（3.4s，蹲 420ms、滚到 2600ms，300ms 冷却、最多 3 翻）/
  `girl-book`（7.2s，3 页、450ms 冷却）/
  `girl-gift`（6s，300ms 后才能开、彩纸 1400ms，奖励 fish/heart/star 按 seed）/
  `girl-wish`（6s，升起 900ms、悬停到 4600ms）/
  `girl-hopscotch`（8s，三格 16×10、间距 4，220ms 冷却，踩错回第一格）/
  `girl-snow`（24s，30 雪片、3 堆 12×6，300ms 冷却，第三堆立雪人）/
  `girl-fortune`（7s，settle 500ms，四档签文）。
- 引擎：`PetStats` 十八项 → 二十七项（+tails/kneads/rolls/books/gifts/wishes/
  hopscotch/snowmen/fortunes）；九枚新成就（追尾巴 3 / 踩奶 3 / 翻跟头 3 / 看书 2 /
  拆礼物 3 / 许愿 5 / 跳格子 2 / 雪人 1 / 抽签 4 天），成就页 27。
- 天气互斥：`snowStart` 清 `rainUntil`、`rainStart` 清 `snowUntil`；雪和雨都是氛围层，
  不占独演槽；雪里可以并行滚铃铛球。
- 每日抽签落盘 `{day,tier,line,drawn}`：同一天再打开看到同一张，重复揭晓不记账；
  跨天 `ensureDay` 后重抽。
- 菜单 40 → 49 项，共享命令 +9（`tail/knead/roll/book/gift/wish/hopscotch/snow/fortune`）；
  跳格子叫 `hopscotch`，避开已有手势命令 `hop`。
- 命中按绘制倒序：`fortune → hopscotch → wish → gift → book → roll → knead → 尾巴尖 →
  hug → box → laser → brush → catnip → plane → bird`；签纸/星子/书与抱抱的大椭圆重叠，
  必须先拦。雪堆按最近的一堆判。
- `getGirlDiagnostics()` 增九件玩具读数口与整块 `idle`（含 `posture/suspended/until`）。
- 真窗探针补 `forceFrame / waitStat / waitPropGone / waitBubbleLine / toyGate / startToy`；
  追尾巴与踩奶改成「等到玩具退场再读计数」，雪/雨用 `waitPropGone` 确认互斥。

### 口径与裁决（v1.13.0）

- **图集没有真正的坐/趴段，本轮不改图**：逐帧核对 40–50 号「sit」仍是站立的舞蹈姿态，
  `drowse` 也只是闭眼站立；坐/趴由 `girlAnimBodyFor` 的 `sprawl` 压扁 + 摊开演出来，
  `girl-sprite.ts` 已写明。要真坐下得下一轮重画/补拍，不在本轮改 `photo/`。
- **免打扰里永远不趴**：闭眼趴着会被读成睡着（native #67 的同一读法）。
  安静中的 `dance` 只歇成 `sit`；已经在趴时一开安静就当场 `stand`，不留在趴姿。
- **起身必须经过 `stand`**：`sit/lie` 不能直接跳回 `dance`，否则像换了一张贴图。
- **玩完回来先给一整支舞**：任何玩具/活动都 reset 编排，保留「下一轮坐还是趴」游标；
  挂起只 reset 一次，不能每帧刷 `bouts`。
- **一轮一拍账 vs 当场记账**：`tails/kneads/rolls/books` 整轮走完 +1（点多少下不改账）；
  `gift` 只认拆开那一下；`hopscotch` 第三格踩对当场 +1；`snow` 雪人立起来才 +1；
  `fortune` 揭晓才 +1，一天只认一次；被另一件独演道具替掉的中途局不结算。
- **许愿不进陪玩账**：`wishMake` 只 +`wishes` 与亲密度，不写 `dayCounts.toys`，
  也不触发 `noteQuest("play")`——愿望是私人的事，不拿它刷每日目标。
- **08:12 那一跑的 29 条红不是产品闸门 bug**：全部落在玩具结算与闸门采样窗；
  补轮询与现场读数后 256/256，九道玩具闸门全部首试成功（`retried:false`），
  没有为了探针改产品语义。
- **跳格子不叫 `hop`**：`hop` 已是「跳一下」的手势命令；新命令统一 `hopscotch`。

### 量测与门（v1.13.0）

- `CI=true npx vitest run` → **715 文件 / 7381 通过（1 skipped）**，无红，255.08s
  （v1.12.0 基线 703 / 7299，+12 文件 +82 条；12 个新文件 78 条，改动文件净增 4 条）。
- 新增测试：tail 4 / knead 5 / roll 5 / book 5 / gift 5 / wish 5 / hopscotch 5 /
  snow 5 / fortune 4 / idle 9 / companion-girl-v113 12 / renderer-girl-v113 14。
- 十一道门全绿（brand/main/preload/renderer/sprites/roster/palette/palette-migrate/
  plugin-schema/adapted-models/plugin-sdk）；`build:main` 776 文件 / `build:preload`
  144 文件 + learn-exam / `build:renderer` 全绿。pnpm 9 会被 `engines.pnpm>=10.33`
  拒跑，本轮门禁直接用 `node`/`npx` 跑同一批脚本。
- 真窗 **256/256 `all clear`**：九件玩具各 +1（`v13Delta` 九项各 1），
  二十七项 reload 后原样回来；礼物 `opened=true`、许愿 `wished=true`、
  跳格子先踩错再按 1→2→3、雪人第三堆 `built=true`、抽签 `tier=3` 同日重开不变；
  雪雨双向互斥、雪与铃铛并行；成长记录 `徽章 3/27`。
- 待机：`dance 13.9s → sit 9.9s（posture 0.414、clip sit、rests=1）→ dance
  （nextRest=lie、bouts=7）`，全程 `suspended=false / gesture=null`。
- 截图与报告：`D:/cyrene-p5-accept/shots-v113/`（含 `girl-idle-sit.png` 与
  `pet-girl-report.json`）。
- 未覆盖：各玩具封顶边界、礼物不拆作废、跳格子多次踩错的完整序列、雪堆冷却边界、
  抽签跨天换签；趴/深歇与免打扰打断趴的真窗同框（本轮只截到坐），由单测锁语义。

### v1.13.0 发布证据（2026-10-26）

- commit `e2f09c87` + annotated tag `v1.13.0`（tag 对象 `e48a259c…`，peel 同一 commit）；
  只推 fork，上游未动。
- CI：workflow_dispatch run `40251741637`（ref `v1.13.0`），`package` job 4m37s 全步绿
  （00:56:17Z → 01:00:58Z）；仅一条 Node.js 20 弃用 annotation。
- Release [v1.13.0](https://github.com/damingslu-ctrl/Cyrene-Agent/releases/tag/v1.13.0)：
  `isDraft:false`、`isPrerelease:false`、latest；资产 `Mochi-Setup-1.13.0.exe`
  **296,299,092 B** / `sha256 c191c60df721f233c12e34045b764797f4545b5854607db157621030b5bb01ac`
  （本地下载件与 GitHub asset digest 一致），公开于 `2026-10-26T01:11:54Z`。

### v1.14.0：真姿态待机、作息保证与姿态图集（2026-10-26）

- 用户裁决：不许在跳舞上继续叠功能，待机底子必须换。新出 **8 格真姿态图集**
  `girl-poses.webp`（340×248：stand/sit/curl/look/stretch/run/joy/love），源图 7 张
  1136×912 立绘经 `scripts/assets/build-girl-pet-poses.py` 去背、按躯干轴对齐、缩小；
  `stand` 由 `love` 抹掉胸前爱心而来；`girl-pet-poses-meta.ts` 带锚点 0.5/0.959677、
  `inkRefPx 229`、逐格墨框与脸框（curl 脸心比 stand 低 20px）。
- `girl-scene` 统一播放器：`clip | pose` 两态，切幕把屏上那一格冻成底板做 160ms 交叉
  淡化，姿态按 12fps 重绘；缺图时按 `GIRL_POSE_FALLBACK_CLIP` 退回最近的循环帧段。
  `girlPoseBodyFor` 删除 `sprawl`——坐就是坐，不再压扁跳舞帧。
- `girl-idle` 重写成六段作息：`stand/look/sit/curl/stretch/joy`（每段直连同名姿态），
  疲劳权重沿用；新增 `activeBouts`（连 4 段主动必歇）与 `sitsSinceCurl`（坐过一次、
  还没蜷，则下次歇息改蜷），起身必过 `stand`；免打扰不蜷不庆祝，已蜷/开心当场站起。
- 渲染器接线：`girlBasePoseFor`（idle→编排、rest→sit、sleep→安静站/睡蜷）、手势优先级、
  姿态下的饰品/FX/影子按当幕墨框脸框量；回馈手势闸门拆两层（活动态一律照演，只有待机
  编排吃「站定 + 一段一条 + 换段 600ms 内不接」）。
- 27 项统计 / 成就 / 玩具全部沿用，无新增计数；菜单不变。
- 单测全绿 **717 文件 / 7414 passed + 1 skipped（7415）**，比 v1.13 多 2 个文件、33 条
  （girl-pose 11 / girl-scene 13 / girl-idle 9→11 / renderer-girl-v113 14→18 /
  fx+accessory +3）。真窗 **260/260 `all clear`**：站 `t=1.31s` → 坐 `t=9.19s`
  （cushion .9919）→ 蜷 `t=28.23s` → 回站 `t=37.29s`（脸心与蜷差 5.05px）→ 安静站 →
  睡蜷；三段 `clip` 全 null。截图在 `D:/cyrene-p5-accept/shots-v114/`。

### 口径与裁决（v1.14.0）

- **休息是作息，不是抽签**：只按疲劳权重抽 sit/curl 时，长跑里出现过「10 段主动都不歇」，
  单测也随机红。改成 4 段主动强制歇 + 坐后必蜷两条例外，均先写 RED 单测再实现；
  探针窗同步按作息量（坐 ≤60s、蜷 ≤40s、起身 ≤25s），判据不放水。
- **回馈手势 ≠ 自主小动作**：新的站姿闸门起初把 `activity=pet` 的摸头回馈也关了，
  点脸只剩底片；RED 单测（摸头 → `clip=shy`）复现后把闸门拆成「非 idle 一律照演」。
- **探针不能抢结算帧**：板子退场只说明 prop 到点，引擎结算挂在退场后的那一帧绘制里，
  12fps 姿态把缝拉宽；抓板收尾改成 `forceFrame()` + `waitStat`，只改探针不改产品。
- **睡觉与安静仍互斥**：睡脸用 curl 真姿态，安静档只站/看/坐（月牙是唯一记号的口径不变）。

### v1.14.0 发布证据（2026-10-26）

- commit `8154e09c` + annotated tag `v1.14.0`（peel 同一 commit）；只推 fork，上游未动。
- CI：workflow_dispatch run `40263546439`（ref `v1.14.0`），`package` job 4m47s 全步绿
  （03:20:02Z → 03:24:49Z），含 `Verify installer artifacts`；仅一条 Node.js 20 弃用 annotation。
- Release [v1.14.0](https://github.com/damingslu-ctrl/Cyrene-Agent/releases/tag/v1.14.0)：
  `isDraft:false`、`isPrerelease:false`、latest；资产 `Mochi-Setup-1.14.0.exe`
  **296,602,711 B** / `sha256 3a536b8c65545ff2fb40b0b52f01bc132e230803b679a63a82d1e41526c06522`
  （本地下载件与 GitHub asset digest 一致），公开于 `2026-10-26T03:36:10Z`。

### v1.15.0：第二张姿态图集、手势姿态化与真趴下（2026-10-26）

- **图集 II 不能照抄图集 I 的尺**：图集 I 每格各自归一到 229px 墨高，趴着的剪影
  （251×189）照做会被撑成站姿那么高。图集 II 改用**全表一个 scale**（由站姿 `wave` 定尺），
  实测 `wave` 墨高 234 vs 图集 I `stand` 230，差 4px 在同一条 91vb 的尺上；四件事锁在
  `girl-pose-atlas.test.ts`（16 张在册 / 图集 I 的锚点与 curl 脸框逐条不动 / 跨图集站姿墨高≤8 /
  格高与锚点一致 / 脸框在墨框内）。
- **格宽必须按姿态所属图集取**：`girlPoseCellPoint(body, pose, fx, fy)` 用自己那套图的
  `cellW`；拿 340 除 400 宽的格子会把整格钉位往左推 15%，趴着的脸会飘出身子。
  `girl-pose.test.ts` 的锚点断言扩成 stand + prone 两套图各一遍。
- **两套图各拉各的**：`girlPoseReadyFor(pose, {posesReady, poses2Ready})`；图集 II 缺席时
  只有趴那一族退回帧动画（`prone/kneel→sit`、`wash→wink`…），坐/蜷不受牵连。
- **手势不再是舞蹈片段**：招手/鞠躬/屈膝礼/指/歪头/洗脸/哈欠/伸懒腰各画一张；
  点头/摇头/打字/发抖/跳/拍手/捂脸/喝一口没有画，继续走帧段——不硬套一张不像的姿态。
- **深歇是作息不是抽签**：`restStage` 0→1 坐→2 蜷→3 趴，下一档永远比它深一级，
  **趴过并起身才归零**。第一版写成「起身即清零」，实测序列出现 `sit,stand,sit`——深歇被
  一次普通起身打断，趴下永远轮不到；改成单调档位后序列是 `sit,curl,prone,stand`。
  疲劳不能当闸：坐着/蜷着时疲劳本来就在回落，拿「还累不累」判会让趴永远不出现。
- **诊断口径只增不改**：`gesture` 仍是 v1.14 的「当前片段 id」（`renderer-girl-v113` 的旧锁
  不放宽），新增 `gestureId`（手势原 id，真姿态手势期间唯一非空）与 `atlases`。

- 单测全绿 **721 文件 / 7441 passed + 1 skipped（7442，251.49s）**，比 v1.14 多 4 个文件、
  27 条（girl-pose-atlas 7 / girl-gesture 6 / girl-idle-v115 7 / renderer-girl-v115 7）。
- 变异自检两条：① 关掉手势→姿态分支 → v115 渲染器红 3 条；② `prone` 移出免打扰打断名单 →
  「不许趴着画」+「当场站起来」红 2 条。均已恢复并复跑绿。
- 真窗 **269/269 `all clear`**：`t=1.31s` 站 → `t=9.24s` 坐（cushion .9929）→
  `t=28.44s` 蜷（脸心 59.60）→ `t=37.47s` **趴**（脸心 67.06，比蜷低 7.45px，wear→0）→
  `t=51.92s` 起身（脸心 54.19）；四段 `clip` 全 null。手势六条全 `pose=那张/clip=null`，
  `nod` 仍 `clip=peek`，`atlases={poses:true,poses2:true}`。截图
  `D:/cyrene-p5-accept/shots-v115/`（`girl-idle-prone.png` / `girl-gesture-wave.png` /
  `girl-gesture-bow.png` 逐张过目）。

### v1.15.0 发布证据（2026-10-26）

- commit `9d33d587` + annotated tag `v1.15.0`（peel 同一 commit）；只推 fork，上游未动。
- CI：run `40288151517`（ref `v1.15.0`），`07:49:22Z → 07:56:05Z`（6m43s）全步绿，
  `[installer] verified …Mochi-Setup-1.15.0.exe (296880680 bytes) — v1.15.0`。
- artifact zip `296,544,441 B` / `sha256 ab34b8a8…`。**GitHub artifact zip 下载链路在本次
  不可用**：`gh run download` 两次在写 zip 阶段 `unexpected EOF`；改用 curl 断点续传 39 轮
  拿全 296,544,441 B，但 zip CRC 不符（`27d6f40f…` ≠ `ab34b8a8…`），说明续传拼接处损坏。
- 于是用**同一 commit、同一 electron-builder 26.15.3、同一命令**在本机重打包：
  `296,982,786 B` / `sha256 ecc76ae3…`，`verify:installer` 同样核对通过。与 CI 差
  **102,106 B**，来源已定位到 gitignore 的本机 `resources/bin/cyrene-screenshot.exe`
  （本机 2,337,688 B vs CI 645,632 B），不是版本内容差异。
- Release [v1.15.0](https://github.com/damingslu-ctrl/Cyrene-Agent/releases/tag/v1.15.0)：
  非草稿、非预发布、latest，`publishedAt 2026-10-26T07:58:45Z`；附件 `Mochi-Setup-1.15.0.exe`
  `296,982,786 B`，GitHub asset digest `sha256:ecc76ae3…` 与本地 hash 一致。

### v1.16 卡死自愈与发条鼠一帧判死（2026-10-27）

- **「卡死」是 rAF 链断掉，不是渲染变慢**：三条入口都实测可停摆——
  ① `draw()` 抛一次错，异常从回调里逃出去，`requestAnimationFrame(loop)` 那一行再也执行不到；
  ② 链条断过一次后 `ticker` 还留着旧 handle，`start()` 的 `if (this.ticker) return` 把陈旧号码
  当成「还活着」，`resume()` 永远救不回来；③ 拖拽起手 `pause()` 停了 ticker，收口依赖 main.ts
  的 `if (petVisible) resume()`，窗口在拖拽途中被判不可见时那条路直接跳过。
- 修法：循环体 `try/catch/finally`，重挂放 `finally`；`start()` 先 `cancelAnimationFrame` 再清零旧
  handle；`endDrag()` 自己 `if (this.paused) this.resume()`；新增 `disposed` 守卫，`dispose()` 之后
  不许被 `finally` 拉活。坏图每帧抛错时日志按 `DRAW_FAULT_LOG_EVERY_MS=10s` 限流，不刷屏。
  `renderer-liveness.test.ts` 四条测试一条对一条；三条变异（去掉 finally 重挂 / 保留旧 ticker 守卫 /
  去掉 endDrag 恢复）各红一条，均已还原。
- **发条鼠「溜走了…」的根因**：rAF 回调参数是**帧起点**时间，可能早于 `mouseStart` 记的
  `bornAt`；`mouseAlive` 是唯一把负年龄判死的玩具（其余都当「刚出生」），于是下一帧就
  `mouseMiss`，刚放出的老鼠当场消失。真窗探针两次抓到 `mouse.spawn` 失败（`mouse=null`、
  `stats.mice=0`、气泡是「溜走了…」），而同一次报告的 `results.mouse.second.mouse.left=6135.5`
  证明第二只是健康的。改成 `Math.max(0, now - bornAt)`；到期判据 `age < MOUSE_MS` 不变，测试
  同时钉住 `MOUSE_MS-1` 活 / `MOUSE_MS` 死。回退该行 → 新测试红，牙在。
- **门**：`CI=true npx vitest run` 全量 **722 文件 / 7445 passed + 1 skipped（7447，250.20s）**；
  唯一红是 `document-tools` 的 Excel 基线 15s 超时（722 worker 并发），单跑 5/5 绿，与宠物无关。
  `check:renderer` / `check:main` / `check:preload` / `check:brand` / `check:roster` / `check:sprites` /
  `palette:check` / `palette:migrate:check` / `check:plugin-schema` / `check:adapted-models` 全绿；
  `vite build` 通过。
- **真窗 269/269 `all clear`**（`D:/cyrene-p5-accept/shots-v117/`，69 张截图）：发条鼠整条链
  `spawn(left=6090)→发条老鼠？咔哒咔哒的→caught(mice+1)→看你往哪儿跑→persist→gone→respawn(left=6135.9)
  →溜走(老鼠太快了啦)`；同一次 `rest.starts=rest`、`night.line=眼睛该休息啦`、
  `idle` 站→坐→蜷（脸心 59.62）→趴（67.09）→起身（54.18）全绿。前两次失败里那 16 条红未复现，
  归类为自主时间块的探针抖动（真窗报告已保留）。
- 只做本地两笔提交（`a46272fd` 渲染循环、`549e0a4b` 发条鼠），**未改版本号、未发布**；
  当前 `package.json` 仍是 1.15.0。

### v1.17.0：六套日常系统与两条真窗红的收口（2026-10-27）

六个纯模块（`girl-mood/girl-favorite/girl-trick/girl-treasure/girl-garden/girl-hide`）
+ 引擎 13 条新命令（`mood/favorite/tricks/treasure/treasures/hide-seek/garden-plant/
garden/garden-harvest` 与 `trick:` 四件）+ 右键菜单 10 项（含「教她点小把戏」四子项）
+ 五枚新成就（`trick-master/treasure-hunter/hide-seeker/garden-keeper/true-favorite`，
总数 27→**32**）。

- **心情是节奏，不是贴纸**：昨天怎么被陪（`careScore` 摸头 1 / 陪玩 2 / 喂食 2 / 玩具 1）
  滚出今天四档，只通过三根旋钮被看见——`restAfterMs`（26s~55s）、`affinityScale`
  （0.9~1.18）、`chatScale`（0.8~1.4），**不新增任何常驻墨迹**。第一天没有「昨天」，
  固定 `lively` 且 `moodRolled=false` 不参与换算：老存档、老秒表的口径不许被悄悄改掉。
- **本命玩具不新建计数器**：从既有 `PetStats` 里挑，`FAVORITE_MIN=3` 够三次才算，
  打平按词表顺序——同一份统计永远给同一个答案。`true-favorite` 额外要
  `favoriteRivals>=2`：只有一件够格的玩具谈不上「本命」。
- **学会＝次数推出来的，不另存布尔表**：击掌 3 / 转圈 4 / 点头 3 / 害羞 5，
  再教一次也只回「早就学会啦」。菜单与渲染端对同一组 id 靠新的 `src/shared/pet-trick.ts`
  + 单测锁，躲猫猫的命令叫 `hide-seek`（`hide` 已被主窗「隐藏窗口」占走）。
- **三本新账不进 `PetStats`**：那份表的形状被既有存档与测试钉住，改由
  `AchievementExtras` 把 `tricks/treasures/hides/harvests/favorite` 单独递给成就判定。
- **薄荷盆走墙钟**：`plantedAt` 存 `wallNow()`，跨重启继续长（3min 发芽 / 8min 长叶 /
  15min 可收）；空盆用 `-1` 当哨兵，跟「刚在 0 时刻种下」区分开。渲染端拿快照
  `gardenAge` 换回行为时钟再画，不自己存一份计时。
- **躲猫猫的账在引擎、记号在渲染端**：`hideOpen` 是一次性闸门，且「开局后
  `COVER+PEEK+500ms` 之外的回报一律不认」——防止上一局迟到的回执串进下一局；
  落空那句「没找到我，我在这里呢」由 `hideMissReported` 保证只报一次；捂眼时点她＝太早，
  这一下归数数、不算摸头。
- **诊断只增不改**：新增 `mood/favorite/tricks/treasures/garden{stage,ageMs,harvests}/
  hides/hide{phase,left}` 七列，旧列口径不动。

### 本轮两条真窗红（都是产品缺陷，不是探针放水）

- **负年龄一帧判死还没清干净**：v1.16 只修了发条鼠，`bell/hopscotch/hug/mole/snow/rain`
  六处 `*Alive` 里仍留着 `age >= 0`。本轮真窗铃铛整条链红 5 条（`bell.spawn` 读到
  `bell=null`，可气泡已经说了「铃铛球！叮铃叮铃」）——和发条鼠同一个机制。统一夹成
  `Math.max(0, now - bornAt)`；雨天「窗外的时刻一律不画」仍由 `rainAmount`/`buildRainOps`
  把住，不靠 liveness 兜。
- **自主余兴不许顶掉用户点的手势**：`tickGirlScene` 的余兴分支无条件 `startGirlGesture`，
  用户点「剪刀手」举到一半被引擎抽到的 `hop` 换掉（`gesture.point` 读到 `gestureId=hop`）。
  加 `explicitInFlight` 闸门，并且这条余兴**不写进** `lastAmbientGesture`——显式手势举完
  的下一帧照常接上，不悄悄丢掉。非 idle 的互动回馈路径不受牵连（闸门只认显式来源）。

### 门与验收（v1.17.0）

- 单测全绿 **730 文件 / 7508 passed + 1 skipped（7509，273.46s）**，比 v1.16 多 8 文件、
  62 条（六个纯模块 29 + `companion-girl-v117` 16 + `renderer-girl-v117` 7，另有菜单/
  命令/成就三处测试同步扩）。`check:renderer` / `check:main` / `check:preload` /
  `check:brand` / `check:roster` / `check:sprites` / `palette:check` /
  `palette:migrate:check` / `check:plugin-schema` / `check:adapted-models` 十条全绿；
  `build:renderer` 通过。
- 变异自检三条：① bell 回退 `age >= 0` → 新测试红；② rain 同 → 红；③ 把
  `explicitInFlight` 注掉 → `renderer-girl-v115` 红 2 条（顶掉 + 补台）。均已还原并复跑绿。
- 真窗 **295/295 `all clear`**（26 条 `v117.*`，`D:/cyrene-p5-accept/shots-v117/`，71 张截图）：
  击掌 `还差 2 次 → 还差 1 次 → 把手举高一点…啪！` 落盘 `high-five:3`、账本
  `小把戏 1/4`；`今天的心情 · 懒洋洋`；小口袋 `还没捡到过什么 → 捡到汽水瓶盖 →
  1 件 汽水瓶盖 ×1`；薄荷盆 `seed ageMs=272`、盆区绿像素 0→3、重种「盆里还种着东西呢」、
  未熟「还没长好，再等等」；躲猫猫 cover(剩 855ms)→头顶记号 above=14/base=0→早tap
  不认账(hides 仍 0)→peek(剩 2511ms)→found(hides=1「被找到啦！」)→收摊→落空只报一次。
  同一次里铃铛 `spawn(left=5351)→rings 1→冷却→rings 2→gone`、`gesture.point pose=peace`、
  作息 站 `1.31s`→坐 `9.25s`→蜷 `28.43s`→趴 `37.53s`→起身 `51.97s`、发条鼠
  `6093→6138` 全绿。
- 只做本地提交（`66aa09fc` 六处夹零、`f65dac3c` 日常六件套、`39e50f8b` 余兴闸门），
  **未改版本号、未发布、未推送**；当前 `package.json` 仍是 1.15.0。
  提交后重新 `build:renderer`，`dist/renderer` 全部 JS 的 md5 聚合与真窗探针所用那一份
  逐字一致（`36362431cfc76fad3e7fb2d9b9431462`），探针结论对得上现在的树。

### v1.18.0：声音与自娱五件（2026-10-28）

六个纯模块（`girl-sfx` 音谱 / `girl-ball` / `girl-combo` / `girl-lantern` / `girl-fishing` /
`girl-mirror`）+ 出声口 `girl-sfx-audio` + 共享词表与账本 `shared/pet-solo`，
引擎 6 条新命令（`ball/combo/lantern/fishing/mirror/solo`）、菜单 6 项
（「让她拍皮球/演全套/点夜灯/钓条鱼/照镜子」与「她自娱到哪了」）、
声音总开关「给她配上声音」、六枚新成就（`ball-rhythm/full-rundown/lantern-keeper/
fish-feast/mirror-friend/solo-player`，总数 32→**38**）与第 28 项统计 `selfPlay`。

- **声音分两段：谱是纯的，出口只负责响**。`planSfx(event, {volume, muted, step})` 是纯函数
  （13 个事件、4 种波形、逐事件冷却），`girl-sfx-audio` 只按 `at` 排起跳、给 12ms 起音与
  40ms 收尾（免爆音）；建不出上下文（老内核/还没收到手势）或一颗音建崩了就整条咽下。
  `emitSfx` 里一处 `try` 也不设——谱与限流都是纯的，**声音永远不许把渲染器带崩**，失败只记 `blocked`。
- **三重闸门与限流都算「没出声」**：没接出口 / 菜单取消勾选 / 免打扰 → `blocked+1`；
  空谱、同事件冷却、全局 200ms 内已满 3 声 → 同样 `blocked+1`。闸门每声都过，
  勾选翻转不用等重启，下一拍落地就生效（真窗实测 off `{0,2}` → on `{2,0}`）。
- **自娱五件挤同一个独演槽**：起任何一件（含既有互动玩具）都先把槽里旧的清掉；
  被顶掉的那一轮**不结算也不说话**——自己玩到一半被打断，不该记成「玩成了」。
  一轮的账只在收尾那一帧交给引擎（`soloDone`），中途的拨灯/赶蛾/钓鱼/照镜子读数都留在纯模块里。
- **账本只存事实，句子与门槛都在 `pet-solo` 算**：`ball/combo` 存峰值，`lantern/fishing/mirror`
  存累计，`SOLO_CAP=1_000_000` 防坏档一次灌满成就；`moths` 单独一笔，**不进战果、不进成就**；
  `seen` 按 id 记，同一件玩八遍仍算一件。汇报首行是「件数 + 战果」，后两行按战果降序列两件
  （气泡内宽 78px，三行封顶）。
- **空手回来不记账**：`soloDone(kind, 0)` 只补一句「这次没玩出名堂」——不涨亲密度、不记今日陪玩、
  不算 `selfPlay`（成就门槛不能被一轮失败喂出来），但 `seen` 照记（她确实玩了）。
- **声音开关搭几何基线同一次 invoke 回来**，此后只认 `onSfxChanged` 广播；音频上下文在
  `pointerdown`（左右键都算）时 `unlock()`，浏览器不给无手势页面出声的规矩照守。
- **诊断只增不改**：新增 `solo`（整本账）与 `sfx{enabled,played,blocked}`；`stats` 加
  `selfPlay`，探针里的键数锁 27→28（故意写死：新加一项必须来改一次）。

### 本轮四条探针红（三条是尺子，一条是陈锁）

- **镜子点得太密，收场句被徽章顶掉**：220ms 连点 11s 能攒 32 次、当场解锁 `mirror-friend`（12），
  `v118.mirror.ledger` 读到的不是这一轮自己的收场句。改探针：800ms 摊开点五下
  （三张脸都见到、又摸不到 12 的门槛），并给 `mirrorRound` 留 `maxTaps` 上限。
- **种下去那颗芽只数「瓷实核心」会少一像素**：绿点直径只有 2.2 设计像素，猫待机漂 0.1px 的
  亚像素相位一变，`aa>160` 的读数就从 3 掉到 2（2026-10-28 实拍）。改按覆盖度认墨（`aa>80`），
  **断言 `>=3` 不放宽**；空盆同一道闸门读到的仍是 0（负对照还在，牙没松）。
- **尾巴前 500ms 是预热**：一上来就伸手，第一下吞不吞全看截图快慢（三次里有一次读成 2/3）。
  改成先轮询 `phase=chase`（3s 上限）再拍四下，判据仍是「三下尾巴尖＝三次」。
- **`stats` 多了 `selfPlay`**：`v13.stats-keys` 的 27 是活锁不是常数，按设计改成 28 并写明新客。

### 门与验收（v1.18.0）

- 单测全绿 **740 文件 / 7614 passed + 1 skipped（7615，719.86s）**，比 v1.17 多 10 文件、
  106 条（十个新文件 96 条：ball 9 / combo 7 / lantern 7 / fishing 7 / mirror 8 / sfx 7 /
  sfx-audio 6 / pet-solo 12 / companion-girl-v118 20 / renderer-girl-v118 13；其余 10 条是
  既有接线测试随新命令与成就扩的）。机器当时被用户其他应用占着 CPU
  （壁纸 107% / Qoder 71%），比 v1.17 的 273s 慢，但零红。
- 三道 `tsc --noEmit`（main/preload/renderer）全 0；`vite build` 通过。pnpm 9 仍被
  `engines.pnpm` 拒跑，门禁与构建直接用 `node`/`npx` 跑同一批脚本；`dist/renderer`
  的全部 JS md5 聚合为 `90cd9614e637aa793352e0ccf3dbdc71`（含 `我自己拍皮球` 等 v1.18 字面量）。
- 真窗 **343/343 `all clear`**（48 条 `v118.*`，`D:/cyrene-p5-accept/shots-v118/`，77 张截图）：
  拍皮球 `我自己拍皮球 → 连到 5 下（周期 820ms 一拍）→ 收场/落盘`；夜灯 `flares 1→4`、
  飞蛾赶走 1 只（`moths` 涨、战果不变）；钓鱼四钩四中 `鱼儿钓上 4 条`；照镜子三张脸接住 5 次
  （`matched 1→5`）；台本 6/6 全中（5 步 + 谢幕）。收场句 **3 条逐字命中**
  （灯火 4 / 鱼儿 4 / 镜子 5），另两条被当场解锁的徽章顶掉，由各自的 `*.achievement` 记账。
  抢槽（球→灯）旧轮不结算、空手一轮 `这次没玩出名堂` 且 `selfPlay` 不动、安静/四足拒收、
  声音 off→on、重载后账本/落盘/成就/开关全原样；汇报头 `自娱 5/5 件 · 战果 24`。
- 变异自检六条：① `soloScore` 的 `best` 改成累加 → 红 2；② 去掉 `!this.sfxEnabled` → 红 1
  （菜单取消勾选＝一声不出）；③ 去掉 `selfPlay += 1` → 跨 2 文件红 5；④ `soloEndLine` 永远说空手
  → 红 2；⑤ 去掉全局同窗 3 声上限 → 红 1；⑥ `mirror-friend` 门槛 12→11 → 边界那对断言红 1。
  六处均已逐字节还原（`md5sum -c` 全对）并复跑绿。
- 只做本地提交（`09bd8061` 纯模块、`dfdd69ea` 接线、`96c4217d` 探针，外加本段文档），
  **未改版本号、未发布、未推送**；当前 `package.json` 仍是 1.15.0。

### v1.19.0：她的一天（2026-10-29）

三个纯模块（`girl-clock` 时辰 / `girl-festival` 节日 / `girl-day-art` 天色记号与挂饰）
加引擎的 `clockTick` 流水线、两条命令（`clock/festival`）、菜单两项
（「看看现在几点 / 今天是节日吗」，66→**68** 项）、三枚新成就
（`dawn-watch/moon-watch/festive-day`，38→**41**）与 `clock` 诊断快照。

- **八段一天，三种天色只给三个时刻**：凌晨/清晨/上午/正午/午后/黄昏/入夜/夜里
  从 0/300/420/660/780/1020/1140/1320 分起算；`sky` 只挂在清晨（日出）、
  黄昏（日落）、夜里（月亮）三段，其余时段天上什么也不画。
- **换段一句，一天一次，优先级最低**：键是「日期 + 段」，`clockKey` 落盘跨重启仍生效；
  开机第一拍 `primeClock()` 只记账不出声（启动问候已经在讲话），安静期与睡着不记账。
  换段句 priority 0，被节日/徽章占着槽时**段照样记账**——否则 30s 后的迟到句会把
  刚说的节日句顶掉。渲染端每 30s 问一次，`clockTick` 顺序固定：节日 → 作息 → 换段。
- **节日只认五个公历日子**：元旦/情人节/儿童节/万圣夜/圣诞节；当天只做三件事——
  头发另一侧长一枚挂饰、说一句、记一次账（键「日期:节日」，跨重启去重）。
  挂饰是这一天自己长出来的，不占 v1.9 的装扮槽；「下一个」严格跳过当天
  （`days < 1` 直接 continue），所以当天问会报再下一个。
- **看天色是点出来的**：点脑袋当天色记号 → 一天一次（日期+天色记账），
  `skies[kind] += 1` 落盘，那句话 priority 1；看完 `watched` 为真，渲染端把记号收掉。
  睡着/被拖/被投掷/安静/此刻没天色都不接。句子槽被占时徽章照弹但不出声
  （`refreshAchievements(now, !said)`），不抢别人的话。
- **23:30 后三分钟没理她就自己睡，05:00 自己醒**：自动睡只落在 23:30–05:00 窗口内，
  且 `wall − lastUserWall ≥ 180000`；拖拽/投掷/手动哄睡/安静/光标在场都不睡，全程不出声。
  自醒用 `stretch`（伸懒腰）起手并清 `autoSleeping`；手动哄睡的不归这里叫醒。
  `setUserActive` 只在真正翻转时刷新 `lastUserWall`——探针才能把空闲时长原子钉住。
- **睡着时天上不亮记号**：`clockSnapshot` 的 `sky` 在 `activity === "sleep"` 时给 null；
  月亮还在，但她闭着眼，醒了再点同样的机制。
- **报时与节日报告都是 priority 2**：报时三行（`黄昏 · 18:20 / 下一个 万圣夜 / 还有 2 天`），
  节日当天两行、平常日子三行倒计时；两端都按 78px 内宽钉着（单测量过），安静期不接。
- **三枚成就挂在既有计数上**：`dawn-watch`（日出 ≥1）、`moon-watch`（月亮 ≥1）、
  `festive-day`（节日 ≥1）；「日落只是过程」不算成就。仍是一次互动只弹一枚
  （多条件同时满足时余下的等下次互动），安静期不弹也不记账。

### 本轮门禁红与探针尺子（v1.19.0）

- **菜单条数是活锁**：首跑全量套件 1 红——`pet-menu-attach` 把整张菜单写死成 66 项，
  v1.19 加了两项。按设计改成 68 项并补上「看看现在几点 / 今天是节日吗」两行，复跑绿。
- **探针排空成就别借 `pet()`**：`pet()` 本来就不查成就（成就只在会触发检查的互动里弹），
  拿它排空只能读到 `drained=0` 的假象。改为直接调用产品自己的
  `refreshAchievements(performance.now())`，并留 `[ENV]` 守卫——引擎方法不在就报环境错，
  不许静默跳过。圣诞那一轮其实是 `festivalTick` 自己当场解锁了 `festive-day`。

### 门与验收（v1.19.0）

- 单测全绿 **745 文件 / 7665 passed + 1 skipped（7666，211.58s）**，比 v1.18 多 5 文件、
  51 条（5 个新文件 50 条：clock 12 / festival 6 / day-art 6 / companion-girl-v119 18 /
  renderer-girl-v119 8；另 1 条是 `girl-achievements` 新增的 v1.19 三枚成就用例，
  既有「整表」那条顺手从 38 枚扩到 41 枚）。
  首跑 1 红（菜单 66 项，257.67s）→ 修断言后复跑全绿。
- 三道 `tsc --noEmit`（main/preload/renderer）全 0；`desktop-typescript.mjs` 构建
  main 779 / preload 147 文件；`vite build` 5.24s、exit 0。`dist/renderer` 全部 JS
  的 md5 聚合为 `21068a37a3c0693904382b1efb622055`（含「星星挂在我头上」等 v1.19 字面量）；
  探针之后只动过测试断言与探针脚本，应用源码未变，重建产物与探针同源。
- 真窗 **370/370 `all clear`**（27 条 `v119.*`，83 张截图，`D:/cyrene-p5-accept/shots-v119/`）：
  黄昏日落记号 rose 40 → 点一次后记号收掉（rose 0）、报时逐字 `黄昏 · 18:20 / 下一个 万圣夜 /
  还有 2 天`；平常日子节日报告；看天色 `skies.sunset 0→1` 且落盘一致；圣诞挂饰
  A/B 像素 0→17、节日账本 0→1、盘里 `{last:"christmas:2026-12-25",count:1}`、
  `festive-day` 当场解锁、当天报告「星星挂在我头上」；夜里月亮 blue 17 → 原子钉住空闲
  3 分钟自动睡（`autoSleep:true / activity:"sleep"`，记号收掉）→ 05:00:10 自醒伸懒腰
  （`autoSleep:false / activity:"stretch"`，日出 rose 74，没有替她看那一场）。
- 变异自检六条：① `AUTO_SLEEP_IDLE_MS` 180000→120000 → 红 4（跨 2 文件）；
  ② 去掉节日同日去重 → 红 2；③ 去掉看天色同日去重 → 红 2；④ 去掉「睡着不挂天色」→ 红 1；
  ⑤ `nextFestival` 的 `days < 1` 改成 `< 0`（当天也算）→ 红 2；⑥ 星星挂饰画成空 → 红 3
  （跨 2 文件）。六处均逐字节还原（`md5sum -c` 全对），定向 5 文件 / 50 条复跑绿。
- 只做本地提交（`7702a54d` 纯模块、`b47389da` 美术、`b372b594` 接线、`1b0439dd` 探针，
  外加本段文档），**未改版本号、未发布、未推送**；当前 `package.json` 仍是 1.15.0。

### 野性觉醒（v1.20.0）

- **四阶只做两件事**：`WILD_LEVELS` = 家猫 0 / 醒爪 3 / 猎手 8 / 小野猫 15。
  阶位决定她会哪几式（冲刺一开始就会；醒爪才准潜行；猎手才准扑击），
  也决定冷却与冲动频率——小野猫冷却减半、冲动更密，不是「练满就封顶」。
- **点数只认完整演完的一轮**：`recordWild` 在动作收尾时才记账；安静、被叫去漫游、
  被别的动作接管、赶路超时都经 `abortWild` 撤标记，没跑完的那一轮不记。
  夜间 22:00–05:00 双倍（`wildGain` 返回 2）。
  点数与三式计数一律 `WILD_CAP = 1_000_000` 封顶，坏档经 `sanitizeWild` 收成合法账。
- **三行汇报与台账同源**：`家猫 · 野性 0` / `再 3 点成醒爪` / `冲0 潜0 扑0`；
  升满后第二行变「野性全开了」。气泡内宽 78px，三行都不许折。
- **自主冲动**：每拍掷骰概率 0.12 / 0.16 / 0.20 / 0.30；冷却 120s，小野猫 60s。
  冲刺 150px/s、潜行 22px/s；扑击在原点演 `WILD_HUNT_MS = 900ms`；
  赶路上限 `WILD_MOVE_MS = 12_000ms`——贴边卡住也要收场，不许挂着野性标记。
- **三枚成就挂在既有计数上**：`wild-run`（冲刺 ≥1）、`prowler`（潜行 ≥3）、
  `little-wildcat`（阶位 ≥ 小野猫）。仍是每次互动最多弹一枚。
- **野性记号全在身外且双色**：冲刺拖三道速度线、潜行在脸前亮两条专注线、
  扑击只在落点那 450ms 放一圈放射冲击线；每条线都是奶油光边（宽 2.4）
  垫强调色芯（宽 1.1）——桌布颜色不可控，单色软墨等于没画。
- **菜单 68 → 70 项**：加「让她野一下 / 野性到哪了」，两条命令 `wild` / `wild-report`；
  `pet-menu-attach` 的整表锁按设计同步扩到 70。

### 野性三式各有自己的动画（v1.21.0）

- **不再借姿势**：v1.20 的三式借的是姿态图（冲刺＝奔跑图、潜行＝趴姿图、
  扑击＝跃起图），v1.21 起每式播**自己那一行动作帧**。图集 III
  `src/renderer/public/pet/girl-actions.webp`（982,934 B，md5
  `91053fbb966f100b65a1f03317aba25e`）由 `scripts/assets/build-girl-actions.py`
  从 `scripts/assets/source/actions/{zoom,stalk,hunt}-sheet.png` 构建：
  300×400 格、6 列 × 3 行、18 格；`count` 口径与世界图集一致＝**格子数 18**
  （生成器原先把 `CELL_W*COLS*rows` 当 count，已改正）。
- **每行各带自己的尺**：`anchorY = 0.93`、`inkVb = 91` 三行共用；
  `inkRefPx` 与 `anchorX` 逐行不同——冲刺 261.1 / 0.306142、潜行 326.9 / 0.322956、
  扑击 275.8 / 0.439672。`k = s × inkVb / 本行 inkRefPx`，换行画出来不换身高；
  格子坐标换算也用本行 `anchorX`，拿别行的值整格会横移、脚心对不上。
- **节奏各走各的**：冲刺 6 帧 @12fps 循环、潜行 6 帧 @6fps 循环、
  扑击 6 帧 @7fps 一次性（末帧站起即 `done`）。帧号由绝对时钟 × 本行 fps 算，
  不随重绘帧率走；重绘下限同一条公式 `min(30, max(24, ceil(fps×2)))` 三式都落到 24。
- **接缝量过才敢循环**：尾帧接回首帧的位移冲刺 65.4、潜行 52.1，都小于段内最大步进
  105 / 96，看不出跳；扑击 98.5 ≈ 段内最大步进（最后一帧是站起收势），本来一次性。
- **三级兜底各管各的**：动作图集就绪 → 播本行动作；缺 → 退回 v1.20 姿态图
  （run / prone / joy）；姿态也缺 → 退回帧动画（run→walk、prone→sit、joy→happy）。
  坏一套不许把别的拖下水。
- **框也跟着帧走**：每帧的脸框 / 墨框按本行格子坐标经同一套刚体变换投影，
  脸宽三行 39.73 / 39.81 / 39.59（极差 1.0056，同头围锁 < 1.02）；
  三行最低墨线都正好落在 200.00（脚心贴地，不许悬空或插进桌面）。
- **诊断同源**：`action` / `actionFrame` / `atlases.actions` 三个读数来自渲染器自己；
  脸红对扑击与 joy 同为 0.5、音符也对扑击开闸——动作层与姿态层的表情口径对齐。
- **兼容不改形状**：`GirlActionBody` 与 `GirlAnimBody` / `GirlPoseBody` 结构同形，
  记号层、饰品层、投影层一律原样接收，没有为动作再开一条旁路。

### 本轮门禁红与探针尺子（v1.20.0 + v1.21.0）

- **首跑 5 红，全是产品缺陷不是探针放水**（`D:/cyrene-p5-accept/shots-v121/` 第 4 轮）：
  `v120.zoom.credit` / `v120.zoom.line` / `v120.zoom.achievement` /
  `v120.abort.running` / `v120.stalk.credit`。现象一句话：「让她野一下」在她贴边时
  起跑即结束——账本 0→0、气泡没换、成就没弹；随后叫停那一段从藏身位起跑，
  2.1ms 后自己消失，`cooldownLeft = 119997.9`（冷却已经记上了）。
- **根因三层，少修一层都会复现**：
  ① `renderer.ts` 的 `canRoam` 里有一条「贴边 60px 内且开着藏身就冻结」的静态闸门：
  它把「此刻藏没藏」与「离边多近」混为一谈，于是贴边但没藏时每一步都在 `stepWalk`
  里被无声取消；② 两条命令（`wild` / `wander`）都不退藏身，已藏起来
  （`peekDx ≠ 0`）时起跑仍留在藏身位，`idleSecs` 也没归零，命令刚结束就会被
  闲置计时器收起；③ 强制野性没递工作区边界，`wildAim` 只管 ±420，贴右边下令
  会瞄到界外、被夹成零距离——「起跑即到达」，没有位移还照样记账。
- **修法各就各位**：`canRoam` 只看 `|peekDx| > 0.5`（真藏起来了才不让走）；
  新增 `clearTuckForCommand()` 先退藏身（`peekDx = 0` 并重发 GEOM）再把 `idleSecs`
  归零，`wild` 与 `wander` 共用；`startWildNow` 把工作区边界递进
  `wildNow(now, undefined, bounds)`；`companion.wildNow` 的第三参就是这条边界。
- **尺子也要改口径**：三条接缝测试原来断言窗口 x，但窗口 x 会被 workArea 夹住、
  `peekDx` 折进 `pinInWin`，根本测不出「藏没藏」。改为量 GEOM 载荷里的 `peekDx`
  （`renderer-girl-v120.test.ts` 的 `peekOf`）：贴边未藏时命令后第一笔 `peekDx = 0`
  且 `pos.x < edge.x - 50`；已藏时第一笔 `peekDx = 0`、这一趟照样记 1 点；
  散步令同样先把她叫出来。三条都是先红后绿（红是「命令后第一笔仍大于 0」）。

### 门与验收（v1.20.0 + v1.21.0）

- 单测全绿 **750 文件 / 7725 passed + 1 skipped（7726，278.62s）**，比 v1.19 的
  745/7665+1 多 5 文件、60 条。5 个新文件共 48 条：`girl-wild` 14 / `girl-action` 14 /
  `companion-girl-v120` 10 / `renderer-girl-v120` 8 / `renderer-girl-v121` 2；
  既有文件净增 12 条：`girl-fx` +4、`girl-scene` +7、`girl-achievements` +2
  （「整表 41 枚」那条改写成 44 枚，算一次替换）；`pet-menu` / `pet-menu-attach`
  只改整表字面量（68 → 70 项），条数不变。
- 三道 `tsc --noEmit`（main / preload / renderer）全 0。`pnpm run check:*` 本身被
  `engines.pnpm >= 10.33.0` 挡住（本机 9.15.9），改用 `npx tsc -p …` 直跑三遍——
  门禁是环境不是代码。`npx vite build` exit 0；重建后对 **565 个 `dist/renderer`
  文件**跑 `md5sum -c` 全对（旧基线只有 333 个 JS，这轮扩到全量渲染产物）。
- 真窗 **399/399 `all clear`、0 红**（29 条 `v120.*`，其余 370 条是 v1.19 及以前，
  `D:/cyrene-p5-accept/shots-v121/`）：zoom 当场记 1 点、盘里同账、气泡
  「跑起来…风都是甜的」并解锁 `wild-run`；stalk 与 hunt 分别记自己的账；
  半路叫停那一轮 0 记账；猎手阶强制扑击在原点演完再记。
  逐行动作帧也在这轮验了：`zoom/stalk/hunt` 各带 `action` 与 `frames` 两条读数
  （冲刺实测走过 0/1/2/3 四格），诊断里 `atlases.actions = true`。
- 变异自检六条，**预登记的「必红」一条不缺**（`shots-mut-v121`，397 条 / 15 红）：
  ① `restAfterMs → 999_999_999` → `rest.starts` / `rest.pose` / `night.line`
  （`cushion.*` 整段跳过，与预登记的连带一致）；
  ② `AUTO_SLEEP_IDLE_MS → 999_999_999` → `v119.autosleep`；
  ③ 薄荷盆 empty 分支 `return []` → `v117.garden-pot-pixels`；
  ④ `festivalReport` 提前 `return false` → `v119.festival.today`；
  ⑤ 藏身 cover 分支删掉三颗点 → `v117.hide-marks`；
  ⑥ `canIdle = false && …` → `idle.start` / `idle.wake` 加 `idle.sit/curl/prone` 连带。
- 三条与预登记不符的，逐条判过、写在这里：
  ① `zone.feet.clip`（应绿）红——变异 6 下点击时序抖了一下；绿跑与第 4 轮同项都绿，
  判为尺子对时序敏感，不是耦合；② `v119.festival.plain`（应绿）红——变异 4 比预登记
  宽：同一个 `festivalReport` 同时服务「今天」与「平常」两条路，砍掉它必然两条都红，
  判为预登记写窄了；③ `v119.autosleep.mark-off`（应绿）红——这条断言的是
  「因为睡了，所以月亮记号收掉」；不去睡就永远看不到「收掉」，蓝记号停在 17，
  判为场景内耦合（不是产品缺陷），记档不改尺。
- 六处变异逐字节还原：`companion.ts` `3f75b78e…`、`girl-clock.ts` `51a2c4be…`、
  `girl-garden.ts` `2be19cef…`、`girl-hide.ts` `25bcef48…`、`renderer.ts`
  `e5f197a1…`（`mutate.py check` 全 OK），重建产物 md5 与变异前逐文件一致。
- 只做本地提交（`7da0a0d5` 纯模块、`46eb6bcc` 美术、`7459ca8a` 接线、`039da387` 探针，
  外加本段文档），**未改版本号、未发布、未推送**；`package.json` 仍是 1.15.0。

### Wave 1：Clash Verge 数据面与网络页七个页签（2026-10-29）

- 数据面：新增 17 条渲染端可调通道（规则/连接明细/关闭单条/关闭全部/入站/入站测速/
  配置读/配置写/日志起停读）+ 2 条 main→渲染端推送（`verge:network:update` 快照、
  `verge:network:log` 单行日志）。`src/shared/network-detail-types.ts` 把 mihomo 的
  `/rules`、`/connections`、`/providers/proxies`、log 行、`/configs` 收成纯函数；
  `mihomo-client` 扩出 rules/connectionsDetail/closeConnection/closeAllConnections/
  providers/providerHealthCheck/configs/patchConfigs/reloadConfig/nodeDelay/logs(流)；
  `network-service` 做 5s 缓存与「页面关掉即停流」，日志环形缓冲 500 行；
  `network-ipc` 11 条 handler 全参数校验，发送方白名单只放 chat。
- 页面：`NetworkPanel` 拆出 `NetworkTabs`（6 个正文页签 + 1 个齿轮），新增
  `OverviewView` / `NodesView` / `RulesView` / `LogsView` / `ConnectionsView` /
  `ProvidersView` / `SettingsView`；i18n 三语各 +71 键（network 段现共 130 键）；
  `NetworkPanel.css` +455 行。交互口径：规则搜索防抖 200ms、日志暂停就不再追加、
  关闭全部连接二次确认、设置只写白名单键并回读比对。

真窗探针 `scripts/verify/network-tabs-cdp.mjs`（新增，Wave 1 唯一真窗尺）：

- 只用 `D:\cyrene-net-accept\profile` 一次性档，绝不碰 `%APPDATA%`；只点页签——
  模式药丸、节点行、保存、关闭连接、入站测速一律不点，也不动真实光标。
- 页签「开没开」用视图根节点断言；这轮再收紧成「读完了没」：`.net-loading` 必须消失，
  任何页签落在 `.net-view__error` 即整体 FAIL。转圈和错误态都不能冒充「打开了」。
- 每个页签留一张截图（`D:\cyrene-net-accept\shots\01…07`），报告里带
  `window.verge.network.get()` 的 controller 快照与 app 日志尾部，便于区分
  「内核连不上」与「IPC 被挡」。

真窗红两条，都是产品缺陷：

1) **聊天窗从来没登记成 `chat` 类别**，于是 17 条网络通道全被 IPC 网关拒。
   探针日志原文：`IPC sender denied: channel=verge:network:get kind=unknown`。
   policy 里这些通道都是 chat-only，而 `create-aux-windows.ts` 只建窗不登记；
   渲染端 `useDetail` 把任何异常统一咽成 `unreachable`，于是一开始七个页签
   全显示「无法连接内核」。单测全绿是因为它们直接 stub 了 `window.verge` 桥，
   闸门根本没参与——与 2026-10-24 宠物窗事故同型（`create-pet-window.ts`
   已有同款注释）。先红后绿：`ipc-sender-gate.test.ts` 加源文件锁（必须出现
   `markWebContents(…, "chat")` 与关窗时的 `forgetWebContents`），红
   **1 failed | 7 passed**；修好 `create-aux-windows.ts` 后 **8/8** 绿。
2) **入站页把 Go 零值时间印成「更新于 1/1/1 08:05:43」**（坏字符串则印 1970）。
   `parseProviders` 改成把 ≤0 的更新时间读成 null，界面走「从未更新」。
   先红：新增零值/坏值断言 **1 failed | 15 passed**；修后 16/16。

真窗读数（修复后，controller `alpha-e4dd968` @ `127.0.0.1:9097`，mixed 7896）：
概览实时流量在走（4.1 KB/s）、订阅 defond 到 2026/10/29 还剩 11 天；节点 3 个策略组；
规则 18 条；连接 48 → 55 条（代理 3 → 8、直连 45 → 47）；入站 7 个且全部显示
「从未更新」；设置页端口/局域网/IPv6/日志级别/TUN 键齐全。七个页签 `errorText` 全 null。

变异自检五条（Wave 1 预登记，逐个 `cp` 备份、改、跑、还原）：

1) `parseLogLine` 去掉 `type` 字符串校验 → 类型锁红；
2) `buildConfigPatch` 白名单多放一个键 → 配置锁红；
3) 日志流 `finally` 不撤连接超时 → 流锁红；
4) 日志环形缓冲 cap 边界改错 → 500 行锁红；
5) `network-ipc` 去掉进服务前的预校验 → 坏键锁红。

五处落在四个文件，四个备份逐字节比对 SAME，还原后定向 193 条复绿。

门：三道 `tsc --noEmit`（main/preload/renderer）全 0；定向 145 条
（`src/main/application` + `src/renderer/react/features/network`，17 文件）绿；
`npx vite build` 12.34s exit 0；main 重建 781 文件；真窗探针 exit 0；
全量套件（`CI=true npx vitest run`）**755 文件 / 7801 通过 / 1 跳过**，exit 0（275.98s）。

只做本地提交，`package.json` 仍是 mochi@1.15.0，未发布、未推送。


### 吃/拍/跳/打字各播自己的行（v1.22.0，2026-10-29）

- **接的是硬套清单，不是新玩具**：v1.21 只把野性三式拆成独立行，日常互动仍在拿跳舞帧
  顶班——喂食借 `happy`、玩耍借 `wave`、蹦跳借 `stretch`、打字借 `wink`
  （`girl-anim.ts` 的 `ACTIVITY_CLIP` / `GESTURE_CLIP` 原表）。这一轮四件事各出 6 帧，
  图集 III 从 3 行 × 6 格扩到 **7 行 × 6 格 = 42 格**（图集 PNG 1800×2800 / 4,108,776 B；
  运行时 webp 2,909,364 B / md5 `c275945e6659ddf832d0d86bf627eb9a`）。
- **四条新行各带自己的尺与节拍**：
  | 行 | 触发 | fps | 循环 | 一圈/一次 | inkRefPx | anchorX |
  | eat | 活动 `eat`（feed） | 9 | 循环 | 667ms | 338.3 | 0.381026 |
  | bat | 活动 `play` | 11 | 循环 | 545ms | 323.0 | 0.427608 |
  | hop | 手势 `hop` | 10 | 一次性 | 600ms | 309.4 | 0.390274 |
  | type | 手势 `typeCode` | 8 | 循环 | 750ms | 343.4 | 0.403451 |
  眼睛定尺取每张表里 ≥2 帧的中位：eat 66.0 / bat 63.5 / hop 56.5 / type 73.0；
  闭眼（咀嚼闭眼、眯眼）与手挡脸的单帧被 ±25% 过滤器剔掉，不参与定尺。
- **映射只收这四件**：`GIRL_ACTIVITY_ACTION`（eat/play）与 `GIRL_GESTURE_ACTION`
  （hop/typeCode）两张表落在 `girl-scene.ts`；打底优先级仍是「真姿态 > 专属动作 > 帧段」——
  eat/play 本身没有姿态才轮到动作行，idle/rest/sleep 照旧姿态优先、walk/groom/drag 照旧帧段，
  不许一行通用动作把所有互动都盖掉。`actionsReady` 从渲染器 tick 一路传进
  `girlBaseVisualFor`，图集坏掉只让这四件退回原帧段。
- **收口两路**：一次性行（hop）由帧表自己报 `done`——600ms 一到就谢幕，手势时长 1800ms 只当兜底；
  循环行（eat/bat/type）永远不报 `done`，手势行靠 `until = at + gestureClip(id).ms`
  （typeCode 900ms），活动行靠活动结束换段。打字这条最容易卡死，专门锁了「900ms 后必须回站姿」。
- **尺与框一起扩到 42 格**：每格脸框都落在墨框内（slack 1.5px）、墨底不越过脚心线、
  每行至少一格踩在 y=200（±0.5）；七行共用一个头围，脸宽实测 39.59–39.81（极差 1.0056 < 1.02）。
  重绘下限 `min(30, max(24, ceil(fps×2)))` 四行全落 24fps。
- **变异自检三条证明新锁有牙**：① 把动作分支短路（`false && input.actionsReady`）→
  3 条红（吃、拍两条 renderer 接缝 + 一条 girl-scene 映射）；② 把 `until` 改成 `at`
  （丢掉手势时长）→ hop/type 两条接缝红（跳完不谢幕、打字卡行）；③ 删掉 tick 调用点的
  `actionsReady: this.girlActionsReady` → 吃、拍两条红。三处逐字节还原后定向复绿。

### 门与验收（v1.22.0）

- 先红后绿：实现前 7 条红（映射导出缺失 + `action` 读数恒为 null），这就是本轮的验收尺。
- 全量 `CI=true npx vitest run`：**756 文件 / 7811 passed + 1 skipped（7812）/ 273.88s**，
  exit 0；比 Wave 1 的 755 / 7801+1 多 1 文件、10 条。
- 三道 `tsc --noEmit`（main / preload / renderer）全 0；`npx vite build` 9.01s exit 0；
  `node scripts/build/desktop-typescript.mjs main` 781 文件。
- 真窗 **413/413 `all clear`、0 红**（`D:/cyrene-p5-accept/shots-v122/`，91 张截图），
  其中 14 条 `v122.*`：吃三拍帧号 0/1/2、`action=eat` 且 pose/clip 全 null、1600ms 后回站姿；
  拍帧号 0/1/3、2000ms 后回站姿；跳帧号 0/1/2 且 `gestureId=hop`、600ms 演完回站姿；
  打字帧号 0/1/2 且 `gestureId=typeCode`、900ms 到点回站姿（循环行没被卡住）。
  截图 `girl-eat-action.png`（叼鱼）/ `girl-bat-action.png`（伸爪拍球）/
  `girl-hop-action.png` / `girl-type-action.png`。
- 探针纪律不变：全程只用 `handleCommand` / `playGesture`，不发任何鼠标事件；
  `girlOf` / `afterBeat` 从 v1.20 的块里提到函数作用域，两段共用一份读数口径。
- 只做本地提交（`a2aeb16c` 美术、`5bee4684` 接线、`f53fbb3e` 测试、`886ca16a` 探针，
  外加本段文档），**未改版本号、未发布、未推送**；`package.json` 仍是 mochi@1.15.0。


### 点头/摇头/拍手/捂脸各播自己的行（v1.23.0，2026-10-29）

- **仍是同一份硬套清单**：`GESTURE_CLIP` 里点头/摇头借 `peek`、拍手借 `happy`、
  捂脸借 `shy`。这一轮四件事各出 6 帧，图集 III 从 7 行 × 6 格扩到
  **11 行 × 6 格 = 66 格**（图集 PNG 1800×4400 / 6,769,356 B；运行时 webp 4,787,694 B /
  md5 `02565c0b0950ba189a6f56f5d8b36ce8`）。四张源帧表放在
  `scripts/assets/source/actions/{nod,shake,clap,coverFace}-sheet.png`。
- **四条新行各带自己的尺与节拍**：
  | 行 | 触发 | fps | 循环 | 一圈/一次 | inkRefPx | anchorX |
  | nod | 手势 `nod` | 7 | 一次性 | 857ms | 365.9 | 0.429487 |
  | shake | 手势 `shake` | 9 | 循环 | 667ms | 352.5 | 0.476141 |
  | clap | 手势 `clap` | 10 | 循环 | 600ms | 333.2 | 0.423333 |
  | coverFace | 手势 `coverFace` | 8 | 循环 | 750ms | 326.9 | 0.405794 |
  眼睛定尺：nod 69.0 / shake 85.0 / clap 70.0（各取 ≥2 帧的中位，闭眼/眯眼/肉垫混检的帧
  被 ±25% 过滤器剔掉）；coverFace 整行爪子贴脸、52 帧检测到的全是肉垫对，改按同批同尺
  借 clap 的 70.0（墨高 395–428 与 clap 407–419 齐平）。
- **站桩手势行改按鞋底对地线（`SHOE_GROUND`）**：AI 出帧表按每帧自己的剪影居中，
  低头帧整只被抬高——nod 的 f1/f2 鞋底比 f0 高 50px、coverFace 的 f4 低 36px；按墨底对齐
  会读成「点头时猫往上飘」。构建器给这四行加了第二条对齐口径：取每帧粉色鞋底（脚）的
  最低行，用 `dip = max(墨底 − 鞋底)` 把地线整体抬高，使最深的墨迹（尾巴尖/影子）不越脚心线。
  跑/跳/扑这些真腾空的行**不能**这么对齐，所以按行显式点开，不设全局开关。
  已验证第 0–6 行与上一版逐像素一致（`git show HEAD:` 对比，最大像素差 0）。
- **映射只加这四件**：`GIRL_GESTURE_ACTION` 补 nod/shake/clap/coverFace；
  有真姿态的手势（wave/bow/curtsy/point/tilt/groom/yawn/stretch）一律不进表——
  优先级仍是「动作行 > 姿态 > 帧段」，手势表只在没有姿态时接。
- **收口两路沿用 v1.22 的口径**：nod 是一次性行，末格停住即由 `scene.isDone` 谢幕
  （857ms），手势时长 1800ms 只当兜底；shake/clap（1800ms）与 coverFace（2000ms）
  是循环行，靠 `until = at + gestureClip(id).ms` 收口，到点必须回站姿。
- **尺与框一起扩到 66 格**：每格脸框落在墨框内（slack 1.5px）、墨底不越脚心线；
  站桩四行锁「每格墨底落在 366–372 窄带、行内跨度 ≤4px」，飞跳两行（zoom/hop）作对照组
  （跨度 >20px 才许离地）；十一行共用一个头围，脸宽实测仍在 1.02 极差以内。
- **变异自检三条证明新锁有牙**：① 从手势表删掉 `nod` → 映射 1 条 + 点头接缝 1 条红；
  ② 把 nod 的 `loop` 改回 true → 循环表 1 条 + 节拍 1 条红；③ 把 nod f1 的墨底压到 380
  （旧口径的落点）→ 鞋底窄带 1 条 + 「脚不穿地线」1 条红。三处逐字节还原后定向复绿。

### 门与验收（v1.23.0）

- 先红后绿：接线前 5 条红（映射表 + 四条 renderer 接缝），`girl-action.test.ts` 同步扩到
  11 行后先绿（数据面先落地）。
- 全量 `CI=true npx vitest run`：**757 文件 / 7819 passed + 1 skipped（7820）/ 229.51s**，
  exit 0；比 v1.22 的 756 / 7811+1 多 1 文件、8 条。
- 三道 `tsc --noEmit`（main / preload / renderer）全 0；`npx vite build` exit 0；
  `node scripts/build/desktop-typescript.mjs main` 781 文件。
- 真窗 **429/429 通过、0 红**（`.tmp/verify-v123f/`，95 张截图 + `pet-girl-report.json`），
  其中 16 条 `v123.*`：点头帧号 `[0,0,1,2]` 在走、857ms 自己谢幕（回到 `pose=stand`）；
  摇头 `[0,1,2,3]`、拍手 `[0,1,2,3]`、捂脸 `[0,0,1,2]` 各按本行 fps 走帧，
  到 1800/1800/2000ms 的手势时长回待机（这三条量到的是 `pose=sit`）；
  四条都验 `gestureId` 与 `pose/clip=null`（专属动作行不吃姿态打底、也不落回帧段）。
  截图 `girl-nod-action.png` / `girl-shake-action.png` / `girl-clap-action.png` /
  `girl-coverFace-action.png`。
- **谢幕尺（`expectHome`）本轮放宽了两处，逐条记在案**（`scripts/verify/pet-girl-cdp.mjs:5204-5209`）：
  ① 不再硬要求回到**站姿**——等待那几百毫秒里作息编排可能已经让她坐下，2026-10-29 首轮
  三条 home 全量到 `pose=sit`，那是编排不是卡行；② `pose` 允许为 null，但人必须在某个地方：
  要么有静帧，要么正在走/被拖/被投（`src/renderer/pet/girl-scene.ts:69` 写明这三段本就没有静帧）。
- **放宽之后尺子仍有牙**（产品级变异，不动尺）：把 `src/renderer/pet/renderer.ts:3752` 的
  `until = at + gestureClip(id).ms` 改成 `at + 600_000`（手势永不谢幕）→ `npx vite build` exit 0、
  真窗探针 **exit 1、429 条里 6 红**，其中 4 条正是谢幕尺：
  `v122.type.home`（`action=type gestureId=typeCode` 卡住）、
  `v123.shake.home` / `v123.clap.home` / `v123.coverFace.home` 同型；
  另外两条 `v118.fishing.ledger`、`v118.end-lines` 是连坐——她一直举着手势，别的播报抢不到话筒。
  **`v123.nod.home` 没红是设计如此**：点头是一次性行，末格报 `done` 自己谢幕，本就不靠手势时长
  （v1.22 的 eat/bat/hop 同理没红）。还原后 `renderer.ts` sha256 `3ae8a58f4d9d7544…` 逐字节一致，
  复建 `vite build` exit 0。脚本 `.tmp/mutate-home-ruler.py`（日志 `.tmp/mutate-home-ruler.log`）。
- **已知容差**：coverFace 第 4→5 帧脸团约 7% 缩放跳动（AIGC 出帧不一致），
  在 91vb 运行时上约 2–3px，肉眼近不可辨，未为此重出整行。
- 里程碑标签撞号记一笔：代码注释里的 `v1.24` 已被「订阅页（Wave 2）」占用
  （`src/shared/ipc-channels.ts:654`、`src/main/application/ipc-sender-policy.ts:35` 等 4 处），
  所以下一轮猫娘动作行从 **v1.25** 起编，不许一个号两个意思。
- 只做本地提交（`623e23dc` 美术、`8e8132aa` 接线、`61211b8c` 测试、`3e978d2c` 探针，外加本段文档），**未改版本号、未发布、未推送**；`package.json` 仍是 mochi@1.15.0。
