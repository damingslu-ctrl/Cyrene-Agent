# v1.5.0 拟人态猫娘与分层演出 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把桌宠从「只有四足像素猫」升级为「猫娘 ⇄ 猫猫双形态、身形三档、动作分四层并发演出」，并让猫娘的行为接上主进程真实的 `workStatus` 六档。

**Architecture:** 三根新骨架撑住全部改动。① `rig.ts` 加一层 2×3 仿射 `Mat`/`Map2`，把现在只会「整只猫一次变换」的 `Xf` 变成骨架的一个叶节点，于是头/臂/手能各自挂着转；② `motion.ts` 把姿态从「`applyCompanionPose` 里逐字段 if 活动名」改成「按层采样 clip 轨道」，body/gesture/face 三层同时有值（粒子不是第四层 clip，见口径差⑬）；③ `src/main/pet/work-status.ts` 把散在工具派发/提问卡/流式对话里的既有事件汇成主进程单一权威的 `WorkStatus`，经两条新 IPC 通道下行（另有形态档位两条、点气泡唤卡一条，共五条，见 Task 17/18）。形态与尺寸是纯几何参数（`pet-profile.ts`），`standard` 档必须与今天的常量逐字节相等，好让 ~70 把现存屏幕尺全程不变红。

**Tech Stack:** Electron ^44.7.2 · React 19 + Vite 8.3.4 · TypeScript ^6.0.3 · Vitest ^5.0.5 · esbuild ^0.28.2 · i18next ^26.4.6 · electron-builder ^26.15.3（NSIS）。

**Spec:** `docs/verge/specs/2026-10-24-catgirl-form-and-motion-design.md`（HEAD `f39c1f64`）——本计划按 spec 的 R-D1..R-D12、§3 接口、§4 美术、§5 演出、§6 交互、§7 接驳、§8 尺寸、§9 资产、§10 尺子、§12 分期执行。与 spec 的偏离全部记在文末的**口径差台账①–⑱**（P1 四条在台账本体，⑤–⑱ 在各自任务里就地说明），Task 28 统一回写进 spec §13。

## Global Constraints

每一条对**所有**任务都成立；数值逐字来自 spec 或源码，不得改写。

- **测试只认这一条命令**：`CI=true npx vitest run`（仓库根目录）。`pnpm test` 这条路径在本机因引擎版本不匹配根本不跑，写了不算验。
- **全量门**（Task 8/23/28 逐条跑，绿了才算收口）：`npm run check:main`、`check:preload`、`check:renderer`、`check:brand`、`check:roster`、`check:sprites`、`palette:check`、`palette:migrate:check`、`verify:installer`；本期新增两把屏幕尺由 Task 28 一并跑：`npm run verify:work-status`（#74，Task 18 建）、`npm run verify:pet-hit`（#71，Task 26 建）。
- **四足猫逐像素不变**（R-D2）：`form` 默认 `"cat"`、`tier` 默认 `"standard"`，且 `standard` 档的 `PET_WINDOW_BASE` / 基址 / `PIN` 与 `src/shared/pet-geometry.ts:9-16` 现有常量**逐字节相等**。P1–P4 全程不许把默认值改成 `girl`；翻默认只发生在 Task 27。
- **不出网**（P0 安全口径延续）：不新增任何外部网络出口；mihomo controller secret 只在内存，永不打印、永不入日志、永不入 IPC 载荷。
- **颜色只从 token 派生**（R-D11 之外的色板戒律）：`src/**` 内不得出现新的十六进制字面量；猫娘新增色一律写成 `wash(A, 0..255, B)` 或 `withAlpha(A, 0..1)` 作用于 `pet-tokens.ts` 的板内色（`ACCENT/GREEN/WARN/PAPER/INK/ROSE/ROSE_DEEP/PAPER_SHADE/EYE/SHADOW/…`）。`wash` 的 alpha 是 **0..255**、`withAlpha` 的是 **0..1**，两者越界或 NaN **抛错**（不 clamp）。
- **图层序**（R-D4）：猫娘 ORDER 固定为 `ground_shadow → legs → tail → dress → body → arms → hands → collar → ears → hair_back → hair_front → ahoge → brows → eyes → nose → mouth → blush → tear`，与 `PetLayer` 声明序一致，测试用 `layerKinds()` 逐字段钉死。
- **静帧必须纯**（R-D9）：新增的每个姿态/表情/clip 采样函数，同一输入连调两次逐字段相等；`t` 恒为 0。动画只由绝对时钟 `cat.t = now/1000` 驱动；50 ms 的 `dt` 上限只准用在缓动状态变量上，不准用来推 clip 进度。
- **位图管线无 text 图元**（R-D10）：`buildSpriteOps` 输出里 `kind === "text"` 必须为 0，正对照（raw 里确实有 `zzz` 的 Z）必须仍然能变红。
- **Coopanion 是 AGPL**：只借概念（分层演出、工作状态），不复制其代码、纹理、命名；`dsh-pet` 同。
- **验收器永不点击**：屏幕尺（#71–#74）只读、只截、只量；绝不点节点行、「选择最优」、「立即实测」，绝不对 mihomo 发 PUT/POST。
- **不碰用户别的应用**：不启停/最小化/kill 用户进程；`%APPDATA%\Cyrene`（246 M）只读禁写。
- **大产物离 C 盘**：构建产物、worktree、截图都留在 `D:\Test\workbuddy\` 下。
- **推送与发布通路**（唯一合法形式）：`git -c http.proxy=http://127.0.0.1:7896 push https://github.com/damingslu-ctrl/Cyrene-Agent.git <分支>:<分支>`。**绝不推 upstream（Playa-Cyrene）**。tag push 不触发 CI，发布要 `gh workflow run --repo damingslu-ctrl/Cyrene-Agent`（`gh` 默认指向上游，`--repo` 必须显式）。
- **引用必须 grep 回来**：计划与提交信息里出现的行号、通道名、常量名、计数，一律从源码 grep 核对；凭实现记忆写 = 缺陷。
- **每把新尺都要验牙**：新增锁必须附一条变异证明（故意改坏生产代码，尺子必须变红），跑完还原。禁止恒真断言、空转探针、无边界 `endsWith`。

## 文件结构

新增（spec §3 的六 + 一 + 一，共 8 个实现文件 + 7 个测试文件）：

| 文件 | 责任 | 任务 |
|---|---|---|
| `src/shared/pet-profile.ts` | 形态 × 身形档位的**纯几何参数**：`SizeTier`/`PetForm`/`PetProfile`/`profileFor()`/`SIZE_TIERS`/`FORM_GEOMETRY`/`formGeometry()`（girl 的 hitAspect 由 Task 26 实测反钉） | 1, 26 |
| `src/renderer/pet/rig.ts` | 2×3 仿射 `Mat` + `Joint` 骨架 + `Map2` 适配器 | 2 |
| `src/renderer/pet/face.ts` | `Expression` 16 档、`Mood`→`Expression` 一对多、`FaceParams`、`faceOf()`、`buildFaceOps()` | 9, 10 |
| `src/renderer/pet/motion.ts` | `MotionLayer`/`Channel`/`Clip`/`Env`/`sampleClip`/`springStep`/`CLIPS`/`GESTURE_IDS`/`gestureIds()` | 12, 13, 19, 21 |
| `src/renderer/pet/girl.ts` | 猫娘站姿图元（`GIRL_PROPORTION` + 各部件），`buildGirlOps()` | 6 |
| `src/renderer/pet/form.ts` | `buildPetOps()`：按 `form` 分派到 `buildCatOps`/`buildGirlOps`，叠加 overlay 图层 | 5 |
| `src/main/pet/work-status.ts` ＋ 类型家 `src/shared/work-status-types.ts` | 主进程 `WorkStatus` 六档单一权威 + 事件源适配器 | 16 |
| `src/main/pet/work-status-ipc.ts` ＋ `src/main/verge/profile-ipc.ts` | 两组通道 + 输入校验 + dispose（照 `network-ipc.ts` 的形状） | 17 |
| `src/main/application/window-kind.ts` ＋ `ipc-sender-policy.ts` | `webContents.id → WindowKind` 登记簿与 channel→类别白名单（R-D11） | 15 |
| `scripts/verify/work-status-cdp.mjs` / `pet-hit-cdp.mjs` | 尺 #74 / 尺 #71（只读只截，永不点击） | 18, 26 |
| `src/renderer/main.test.ts` | 宠物窗入口的源码文本锁（main.ts 跑不了单测，锁接线形状） | 22 |

修改（spec §3 的七 + 一，实际按任务）：

| 文件 | 改什么 | 任务 |
|---|---|---|
| `src/shared/pet-geometry.ts` | `computePetLayout`/`resolveGrowthDirection`/`computeCatRect` 收 `profile`/`form`/`k` 可选参，默认值＝今天 | 3 |
| `src/shared/draw-ops.ts` | 追加 11 个猫娘 `PetLayer` 标签 | 5 |
| `src/renderer/pet/art.ts` | 绘图助手的 `xf: Xf`  widen 成 `xf: Map2`；抽出 `buildOverlayOps` | 4, 6 |
| `src/renderer/pet/renderer.ts` | 站姿派发（3 行，Task 6）；用四层 clip 合成替掉 `applyCompanionPose`（拆两条，见口径差④）；`requestBounds` 带上 profile | 6, 14, 17, 27 |
| `src/renderer/pet/companion.ts` | `pickIdleActivity` → `pickRoll`（四层加权）；触诊六类；气泡键 | 19, 22 |
| `src/renderer/pet/cat-variants.ts` | 加 `form` 轴、`GIRL_POSES`/`GIRL_CROPS`（实测重钉）；`CAT_POSES`/`CAT_CROPS` 保留给 icons 支路（口径差⑯） | 24, 25 |
| `src/renderer/pet/click-through.ts` | **不改**——尺 #71 复用它的 `alpha ≥ 10` 判据（`:42`）但不动代码；命中矩形读数走 `renderer.getHitRect()` | 26 |
| `src/renderer/main.ts` | boot 读 + 下行订阅（17）；触摸接线改 `clickKindFor`、双击定时器退役（22）；`getPetDiagnostics` 加 `form/tier/hitRect`（26） | 17, 22, 26 |
| `src/main/application/ipc-scope.ts` | `handle` 加第三参 `{ allow }` 发送者校验 + `strictChannels` | 15 |
| `src/main/windows/window-manager.ts` | 暴露宠物窗 webContents 判定 | 15 |
| `src/main/verge/verge-store.ts` | `VergeState` 加 `form`/`tier`（7）；`DEFAULT_VERGE_STATE` 翻 `girl`/`large`（27） | 7, 27 |
| `src/main/verge/pet-menu.ts` | 形态两档 + 身形三档菜单项 | 7 |
| `src/shared/ipc-channels.ts` | `VERGE_PROFILE_GET` / `VERGE_PROFILE_UPDATE` / `VERGE_WORK_STATUS_GET` / `VERGE_WORK_STATUS_UPDATE`（17）＋ `VERGE_PET_REVEAL_ASK`（18，点气泡唤出提问卡）＋ `SETTINGS_GET_PET_PROFILE` / `SETTINGS_SET_PET_PROFILE`（27，设置页走 settings 族，`["pet"]` 白名单不放宽） | 17, 18, 27 |
| `src/preload/*` + `src/renderer/react/features/settings/AppearanceSettingsPage.tsx` + `zh-CN.json`/`en.json`/`ja-JP.json` | 设置页形态/身形选择器与三语词条（17 只到 preload/d.ts 的四条 verge 通道；选择器本体在 27） | 17, 27 |
| `package.json` | `version` → `1.5.0`（经 `npm run release`） | 28 |

## 分期与任务号对应

- **P1 骨架与站姿**：Task 1–8（几何参数 → rig → 猫娘站姿 → 形态开关入库 → 四足零变化门）
- **P2 表情与分层演出**：Task 9–14（16 表情 → `buildFaceOps` → 尺 #72 → clip 采样 → 16 clip + 尺 #73 → 四层合成）
- **P3 工作状态接驳**：Task 15–18（发送者校验 → `work-status` → 四条 IPC（profile 两条 + work-status 两条）→ 演出表与 `toolName` 白名单 → 第五通道 `pet-reveal-ask`）
- **P4 动作库与仲裁**：Task 19–23（四层加权抽取 → 仲裁 → 18 gesture → 触诊与点击五变体 → 门）
- **P5 档位、资产与发布**：Task 24–28（资产 `form` 轴 → 146 张重出 → 尺 #71 → 三档端到端 → 全量门与 v1.5.0）

**每个任务的执行骨架一致**：Step 0 grep 复核（带期望计数）→ Step 1 写真测试 → 跑红（红因必须是「缺实现」）→ 实现 → 跑绿 + 类型门 → 变异验牙（改坏生产代码、看到点名红、还原）→ 台账 + 单个提交。**每期一个提交**是分期表的硬要求，任务内的「Step N: 提交」把同一期的多个任务收进一个提交时，以分期表为准并在提交信息里列出任务号。

## 任务总览（28 条，与分期表逐条对应）

| # | 期 | 一句话 | 出口判据 |
|---|---|---|---|
| 1 | P1 | `pet-profile.ts` 几何参数；`standard` 档逐字节等于今天 | 单测钉死三档尺寸/钉位/面板，非法值回落 |
| 2 | P1 | `rig.ts`：`Mat` 2×3、`Joint`、`Map2` 适配器 | 矩阵复合/逆推/骨架链单测 |
| 3 | P1 | `pet-geometry` 三函数收 `profile`，默认值＝今天 | 旧断言全绿 + `DEFAULT_PROFILE` 等价条 |
| 4 | P1 | `art.ts` 助手收 `Map2`，`Xf` 补倍数口 | `art-golden` 六条逐字节相等 |
| 5 | P1 | 抽 `buildOverlayOps` + 11 个猫娘层标签 | 覆盖/顺序锁 |
| 6 | P1 | `girl.ts` 站姿 + `form.ts` 分派 | 比例/部件/静帧纯度锁 |
| 7 | P1 | 形态与档位进 `state.json` 与右键菜单 | 存量回落 + 菜单勾选 |
| 8 | P1 | 收口门：四足逐像素不变、猫娘上屏对照 | 全量门绿 |
| 9 | P2 | `face.ts` 16 档差分表 | 名字/差分/泪汗/blink 锁 |
| 10 | P2 | `buildFaceOps` 把差分画成图元 | 眼高光比例与四足同参 |
| 11 | P2 | **尺 #72** 16×15 成对像素差 | 任一对 < `MIN_PIXEL_DIFF` 即红并点名 |
| 12 | P2 | `motion.ts` 采样内核（Env/缓动/blink） | 纯度锁（换掉时钟后不抛） |
| 13 | P2 | `CLIPS` body 12 + 手势种子 9；**尺 #73** 归零 | p=0/p=1 落回 rest |
| 14 | P2 | 四层合成接线；blink/gaze 复活；删 `setRedrawPolicy` | 猫形对照一字不变 |
| 15 | P3 | IPC 发送方白名单（R-D11） | pet 窗以外全拒 |
| 16 | P3 | `work-status.ts` 六档单一权威 + 生产挂钩 | 六档事件序锁 |
| 17 | P3 | 形态/工作状态四条下行 + boot 读 | `structuredClone` 实测与载荷键名锁 |
| 18 | P3 | 六档演出表 + `toolName` 白名单 + **尺 #74** + 第五通道 | 内部标识零泄漏、≥4 档上屏 |
| 19 | P4 | `pickRoll` 四层加权永不停轮（girl 作用域） | 权重/边界/夜间/力竭/去重 |
| 20 | P4 | 仲裁：物理 > workStatus > activity | 六条端到端 |
| 21 | P4 | 手势池补完 18 条 | 每条语义锚点 + CLIPS=30 |
| 22 | P4 | 触摸六类 + 2.5s 合并 + 点击 5 变体（退双击→玩） | 合并/分档/猫形零消耗 |
| 23 | P4 | 收口门：调度等价 + 四足零变化 | 全量门绿 + diff 审计 |
| 24 | P5 | 资产管线加 `form` 轴（GIRL_POSES 暂行） | 12 姿态互异 + `check:sprites` 字节不变 |
| 25 | P5 | 146 张翻 girl + `--measure` 实测重钉 | 先量后钉；正对照仍有牙 |
| 26 | P5 | **尺 #71** 真窗命中；反钉 `FORM_GEOMETRY.girl` | IoU ≥ 0.55 + 头部中线可点 |
| 27 | P5 | 翻默认 girl/large + 设置页 + 三档端到端 | 70×92/82×108/100×132 上屏 |
| 28 | P5 | 全量门 + spec §13 回写 + 发布 v1.5.0 | 安装器 `--expect-version 1.5.0` |

---

## Task 1: `src/shared/pet-profile.ts` — 形态与身形档位的几何参数

**Files:**
- Create: `src/shared/pet-profile.ts`
- Test: `src/shared/pet-profile.test.ts`

**Interfaces:**
- Consumes: 无（只依赖 `pet-geometry.ts` 的现有常量做等价断言）
- Produces:
  - `type SizeTier = "small" | "standard" | "large"`
  - `type PetForm = "cat" | "girl"`
  - `interface PetProfile { form: PetForm; tier: SizeTier; k: number; base: { width: number; height: number }; pin: { x: number; y: number }; panel: { width: number; height: number }; bubbleWidth: number; catScale(e: number): { u: number; s: number } }`
  - `const SIZE_TIERS: readonly SizeTier[]`、`const PET_FORMS: readonly PetForm[]`
  - `const TIER_SCALE: Record<SizeTier, number>`、`const PIN_Y_RATIO = 0.3611`
  - `profileFor(form: PetForm, tier: SizeTier): PetProfile`
  - `interface FormGeometry { centerOffset: { dx: number; dy: number }; hitAspect: { width: number; height: number }; hitBiasY: number }`
  - `const FORM_GEOMETRY: Record<PetForm, FormGeometry>`
  - `formGeometry(form: PetForm): FormGeometry`

**设计口径（写进文件头注释）：** 这一档只做**几何**，不做美术、不读时钟。`standard` 档的每个数值都必须与 `pet-geometry.ts:9-16` 的现有常量相等——这是「四足猫逐像素不变」（R-D2）能成立的结构性理由：默认档不是「差不多」，是同一个数。

三处约定：
1. `k` 只乘在**长度**上（窗口尺寸、`u`、pin 折算后的位移），不乘字号；气泡字号仍按现有 `bubbleBoxRect` 走，Task 3 里明确列为非目标。
2. `centerOffset` 是「窗口内钉位点 → 绘制原点」的位移，单位是 `s`（对 `renderer.ts` 里现在写死的 `-17 * s` / `+4.5 * s`）。猫 `{dx: -17, dy: 4.5}` 照抄；猫娘 `{dx: 0, dy: 4.5}`——身体轴回窗口中线，脚线仍贴钉位。
3. `hitAspect`/`hitBiasY` 合成命中矩形：`w = u·k·hitAspect.width`、`h = u·k·hitAspect.height`，中心在绘制原点**上方** `|hitBiasY|·u·k` 处（`hitBiasY` 为负即上移）。猫 `{2.0, 1.85}` + `bias 0` 必须逐字还原 `computeCatRect`（pet-geometry.ts:171-177）今天算出的四个数；猫娘 `{0.86, 1.55}` + `bias -0.75` 把矩形摊到 viewBox `y 8.5..101.5`、`x 34..86`——即耳朵尖到脚线，头在矩形内（Task 26 的「头顶中线可点」靠这条）。

- [ ] **Step 1: 写失败测试**

创建 `src/shared/pet-profile.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { BUB_W, OPEN_H, OPEN_W, PET_H, PET_W, PIN, scaleFor } from "./pet-geometry";
import {
  FORM_GEOMETRY, PET_FORMS, PIN_Y_RATIO, SIZE_TIERS, TIER_SCALE,
  formGeometry, profileFor, type PetForm,
} from "./pet-profile";

describe("身形档位", () => {
  it("三档 k 与 spec §8 逐字相等", () => {
    expect(SIZE_TIERS).toEqual(["small", "standard", "large"]);
    expect(TIER_SCALE).toEqual({ small: 0.85, standard: 1.0, large: 1.22 });
  });

  it("standard 档就是今天的常量，一个像素都不许动（R-D2 的结构理由）", () => {
    const p = profileFor("cat", "standard");
    expect(p.k).toBe(1);
    expect(p.base).toEqual({ width: PET_W, height: PET_H });
    expect(p.pin).toEqual({ x: PIN.x, y: PIN.y });
  });

  it("小档 70×92 / 大档 100×132；钉位 y = round(h × 0.3611)、x = 窗宽中线", () => {
    expect(profileFor("cat", "small").base).toEqual({ width: 70, height: 92 });
    expect(profileFor("cat", "large").base).toEqual({ width: 100, height: 132 });
    expect(profileFor("cat", "small").pin).toEqual({ x: 35, y: 33 });
    expect(profileFor("cat", "large").pin).toEqual({ x: 50, y: 48 });
    for (const tier of SIZE_TIERS) {
      const { base, pin } = profileFor("cat", tier);
      expect(pin.y).toBe(Math.round(base.height * PIN_Y_RATIO));
      expect(pin.x).toBe(Math.round(base.width / 2));
    }
  });

  it("面板/气泡底数也按 k 取整；standard 还原 OPEN_* 与 BUB_W", () => {
    expect(profileFor("cat", "standard").panel).toEqual({ width: OPEN_W, height: OPEN_H });
    expect(profileFor("cat", "large").panel).toEqual({
      width: Math.round(OPEN_W * 1.22), height: Math.round(OPEN_H * 1.22),
    });
    expect(profileFor("cat", "small").bubbleWidth).toBe(Math.round(BUB_W * 0.85));
  });

  it("`u` 乘 k、`s` 随之而来；k=1 时与 scaleFor 逐字节相等", () => {
    for (const e of [0, 0.5, 1]) {
      const { u, s } = scaleFor(e);
      expect(profileFor("cat", "standard").catScale(e)).toEqual({ u, s });
    }
    const large = profileFor("cat", "large").catScale(0);
    expect(large.u).toBeCloseTo(37 * 1.22, 10);
    expect(large.s).toBeCloseTo(large.u / 60, 10);
  });
});

describe("形态几何轴", () => {
  it("两形态枚举顺序即菜单顺序，猫在前（默认档）", () => {
    expect(PET_FORMS).toEqual(["cat", "girl"]);
  });

  it("猫的几何就是 computeCatRect 今天用的那四个系数", () => {
    expect(FORM_GEOMETRY.cat).toEqual({
      centerOffset: { dx: -17.0, dy: 4.5 },
      hitAspect: { width: 2.0, height: 1.85 },
      hitBiasY: 0,
    });
  });

  it("猫娘是竖的、猫是横的；命中框整体上移到身体中线", () => {
    const g = formGeometry("girl");
    expect(g.hitAspect.height).toBeGreaterThan(FORM_GEOMETRY.cat.hitAspect.height);
    expect(g.hitAspect.width).toBeLessThan(FORM_GEOMETRY.cat.hitAspect.width);
    // bias 为负＝上移。0.75u 换算成 viewBox 单位是 45，配 1.55u 高（46.5 viewBox 单位）
    // 得到脚线上下 −46.5±45 → viewBox y 约 8.5..101.5，正是耳尖到脚线；这条换算在
    // Task 3 的 computeCatRect 与 Task 26 的尺 #71 上各验一次，此处只钉系数本身。
    expect(g.hitBiasY).toBeLessThan(0);
    expect(Math.abs(g.hitBiasY)).toBeLessThan(g.hitAspect.height / 2);
    expect(Math.abs(g.hitBiasY)).toBeGreaterThan(g.hitAspect.height / 2 - 0.05);
    // 身体轴回窗口中线：猫娘的 dx 必须是 0，猫是 -17（给尾巴让位）
    expect(g.centerOffset).toEqual({ dx: 0.0, dy: 4.5 });
  });

  it("未知形态名退回猫，不许抛错把猫清空", () => {
    expect(formGeometry("goldfish" as PetForm)).toEqual(FORM_GEOMETRY.cat);
    expect(profileFor("goldfish" as PetForm, "tiny" as never).tier).toBe("standard");
  });
});
```

- [ ] **Step 2: 跑测试确认它红**

Run: `CI=true npx vitest run src/shared/pet-profile.test.ts`
Expected: FAIL — `Cannot find module './pet-profile'`（或因 `scaleFor`/`PET_W` 未从 pet-geometry 导出而报具名导入错误；若是后者，先在 `pet-geometry.ts` 把 `scaleFor` 由 `export function` 确认可导入——它已经是 `export function scaleFor`，所以只会红在缺模块）。

- [ ] **Step 3: 写实现**

创建 `src/shared/pet-profile.ts`：

```ts
import { BUB_W, OPEN_H, OPEN_W, PET_H, PET_W, PIN, scaleFor } from "./pet-geometry";

/**
 * 形态（猫 / 猫娘）与身形档位（小 / 标准 / 大）的**纯几何参数**。
 * spec §8。这里不做美术、不读时钟、不碰 IPC——只有能被单元测试逐字节钉住的数。
 *
 * 为什么 `standard` 必须等于今天的常量：R-D2「四足猫逐像素不变」不是一句口头承诺，
 * 而是「默认档的所有系数都取 1，于是新代码算出的框与老代码写死的框是同一个数」。
 * 所以本文件里凡与 pet-geometry.ts:9-16 重叠的量，一律**导入常量再乘 k**，不重新字面化。
 *
 * 三条约定：
 * 1. `k` 只乘长度（窗口、`u`、由 s 折算的位移），**不乘字号**——气泡字号仍走现有
 *    `bubbleBoxRect`，档位不改变句子的换行（Task 3 列为非目标）。
 * 2. `centerOffset`：窗口内钉位点 → 绘制原点，单位是 `s`（renderer.ts 现在写死 -17s/+4.5s）。
 * 3. 命中矩形 = 以绘制原点为心、`hitAspect`×u 的框，再整体沿 y 移 `hitBiasY`×u。
 *    猫的 `bias 0` 必须逐字还原 computeCatRect（pet-geometry.ts:171-177）。
 */
export type SizeTier = "small" | "standard" | "large";
export type PetForm = "cat" | "girl";

/** 菜单与设置页的顺序即此顺序；档位从小到大。 */
export const PET_FORMS: readonly PetForm[] = ["cat", "girl"];
export const SIZE_TIERS: readonly SizeTier[] = ["small", "standard", "large"];

export const TIER_SCALE: Record<SizeTier, number> = { small: 0.85, standard: 1.0, large: 1.22 };

/** 钉位在窗口的纵向比例——`round(h × 0.3611)` 在 standard 档正好给出今天的 PIN.y = 39。 */
export const PIN_Y_RATIO = 0.3611;

export interface FormGeometry {
  /** 钉位 → 绘制原点，单位 s。 */
  centerOffset: { dx: number; dy: number };
  /** 命中矩形尺寸，单位 u（猫 = 横摊的 2.0×1.85，尾巴把宽撑出来了）。 */
  hitAspect: { width: number; height: number };
  /** 命中矩形中心的纵向偏移，单位 u；负＝上移。 */
  hitBiasY: number;
}

export const FORM_GEOMETRY: Record<PetForm, FormGeometry> = {
  cat: { centerOffset: { dx: -17.0, dy: 4.5 }, hitAspect: { width: 2.0, height: 1.85 }, hitBiasY: 0 },
  girl: { centerOffset: { dx: 0.0, dy: 4.5 }, hitAspect: { width: 0.86, height: 1.55 }, hitBiasY: -0.75 },
};

export interface PetProfile {
  form: PetForm;
  tier: SizeTier;
  /** 档位线性系数。 */
  k: number;
  /** 收起态窗口基址（物理 px，zoom=1 时）。 */
  base: { width: number; height: number };
  /** 窗口内的钉位点（猫身体锚）。 */
  pin: { x: number; y: number };
  panel: { width: number; height: number };
  bubbleWidth: number;
  /** `scaleFor(e)` 再乘档位的 u/s，绘制与几何共用同一个换算口。 */
  catScale(e: number): { u: number; s: number };
}

const r = (v: number) => Math.round(v);

export function profileFor(form: PetForm, tier: SizeTier): PetProfile {
  const f: PetForm = PET_FORMS.includes(form) ? form : "cat";
  const t: SizeTier = SIZE_TIERS.includes(tier) ? tier : "standard";
  const k = TIER_SCALE[t];
  const base = { width: r(PET_W * k), height: r(PET_H * k) };
  return {
    form: f,
    tier: t,
    k,
    base,
    pin: { x: r(base.width / 2), y: r(base.height * PIN_Y_RATIO) },
    panel: { width: r(OPEN_W * k), height: r(OPEN_H * k) },
    bubbleWidth: r(BUB_W * k),
    catScale: (e: number) => {
      const { u, s } = scaleFor(e);
      return { u: u * k, s: u * k / 60.0 };
    },
  };
}

export function formGeometry(form: PetForm): FormGeometry {
  return FORM_GEOMETRY[PET_FORMS.includes(form) ? form : "cat"];
}
```

⚠️ `SIZE_TIERS` 那行的 `"linear" as never` 是**故意的错**——Step 4 会红，把它改回 `["small", "standard", "large"]`。留着它是为了让实现者在跑测试时确认真的在看红（若你直接抄成正确的，跳过 Step 2 也无从发现）。

- [ ] **Step 4: 修 `SIZE_TIERS` 并跑绿**

Run: `CI=true npx vitest run src/shared/pet-profile.test.ts src/shared/pet-geometry.test.ts`
Expected: PASS（`pet-profile` 全绿；`pet-geometry.test.ts` 仍绿——本任务没改它）。

- [ ] **Step 5: 变异验牙**

临时把 `TIER_SCALE.standard` 改成 `1.1`，跑 `CI=true npx vitest run src/shared/pet-profile.test.ts`，Expected: FAIL（至少 `standard 档就是今天的常量` 与 `catScale` 两条红）。还原后再跑一次，Expected: PASS。把这条记进提交信息。

- [ ] **Step 6: 类型门 + 提交**

```bash
npm run check:main
npm run check:renderer
git add src/shared/pet-profile.ts src/shared/pet-profile.test.ts
git commit -m "feat(pet): 形态与身形档位的几何参数（v1.5.0 P1 Task 1）

standard 档逐字节等于 pet-geometry 现有常量，这是 R-D2 的结构保证。
变异验牙：TIER_SCALE.standard 改 1.1 时「standard＝今天」与 catScale 两条红。"
```

---

## Task 2: `rig.ts` — 2×3 仿射与骨架原语

**Files:**
- Create: `src/renderer/pet/rig.ts`
- Test: `src/renderer/pet/rig.test.ts`

**Interfaces:**
- Consumes: `Point2`（`./ops`）、`Xf`（`./xf`）
- Produces:
  - `interface Mat { a: number; b: number; c: number; d: number; e: number; f: number }`
  - `interface Joint { gx: number; gy: number; rot: number; sx: number; sy: number }`
  - `interface LocalJoint { at: Point2; rot: number; sx: number; sy: number }`
  - `interface Map2 { map(p: Point2): Point2; scaleX(): number; scaleY(): number; k(): number }`
  - `matFromJoint(j: Joint, pivot: Point2): Mat`
  - `matLocal(j: LocalJoint): Mat`
  - `matMul(p: Mat, c: Mat): Mat`
  - `matJoint(parent: Mat, j: LocalJoint): Mat`
  - `matTranslation(dx: number, dy: number): Mat`、`matScale(sx: number, sy: number): Mat`、`matRoot(center: { x: number; y: number }, s: number): Mat`、`MAT_ID: Mat`
  - `matMap(m: Mat, p: Point2): Point2`
  - `toMap2(m: Mat): Map2`、`matOfXf(xf: Xf): Mat`

**为什么要这一层（写进文件头注释）：** 现在整只猫只有**一个** `Xf`，所有部件共用同一支点和同一组 `sx/sy/rot`。于是「歪头」只能歪全身（`TILT_DEG` 就是全身歪 13°），「抬手」只能改手的路径数值。猫娘要头、臂、手各转各的，就必须能把变换**挂起来**（`matMul(parent, child)`）并把结果当变换用——`Xf` 是一个具体类，做不了这件事。

`Map2` 是这次改动能保持小面积的原因：`art.ts` 的绘图助手只需要认这一个接口（Task 4），于是 `Xf`（旧四足，一个不变）和 `Mat`（新骨架）都能喂进去。三个量的语义固定为：**`scaleX()`/`scaleY()`＝沿目标轴的单位长度放大倍数（永远非负，喂给椭圆半径，负 `rx` 会让 `ctx.ellipse` 抛错）**，**`k()`＝面积开方意义上的均匀缩放（喂给线宽、字号、路径宽度）**。所以 `Xf` 侧是 `s·|sx|`、`s·|sy|`、`s`，`Mat` 侧是 `hypot(a,b)`、`hypot(c,d)`、`sqrt(|ad−bc|)`——同一件事的两种算法，`matOfXf` 那条等价测试就是它们的接缝。

`matRoot` 把 viewBox 的 **(60, 100)**（脚线）映到 `center`。这不是随手挑的：`Xf` 的支点就是 `(px, py) = (60, 100)`（`xf.ts:15-16`，注释还专门交代「必须取 60，否则伸懒腰读成平移」），而 `renderer.ts` 把 `center` 定为 `pin + (dx·s, dy·s)`——所以「viewBox 脚线落进 `center`」是**运行时那只猫现在就在用的口径**，猫娘必须同一条线，否则切形态时脚会跳。位图那侧的 `(60, 70)` 取景口径属于 `cat-variants.ts::placeCrop`（它按 `anchor` 自己算 `center` 偏移），Task 25 在那里处理，不在这一层混进来。

- [ ] **Step 1: 写失败测试**

创建 `src/renderer/pet/rig.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { Xf } from "./xf";
import type { Point2 } from "./ops";
import {
  MAT_ID, matFromJoint, matJoint, matLocal, matMap, matMul, matOfXf, matRoot,
  matScale, matTranslation, toMap2, type LocalJoint,
} from "./rig";

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 9);

describe("Mat 原语", () => {
  it("canvas 口径：x' = a·x + c·y + e，y' = b·x + d·y + f", () => {
    const m = { a: 2, b: 3, c: 5, d: 7, e: 11, f: 13 };
    expect(matMap(m, [1, 1])).toEqual([2 + 5 + 11, 3 + 7 + 13]);
    expect(matMap(MAT_ID, [4, -9])).toEqual([4, -9]);
  });

  it("matScale 的 e/f 为 0，且 scaleX/scaleY 与符号无关（负缩放＝镜像，半径仍为正）", () => {
    const m = matScale(-2, 3);
    expect(matMap(m, [4, 5])).toEqual([-8, 15]);
    const map = toMap2(m);
    expect(map.scaleX()).toBeCloseTo(2, 9);
    expect(map.scaleY()).toBeCloseTo(3, 9);
    expect(map.k()).toBeCloseTo(Math.sqrt(6), 9);
  });

  it("matRoot：脚线 viewBox (60,100) → center，与 Xf 的支点同一条线", () => {
    const m = matRoot({ x: 41, y: 43 }, 37 / 60);
    close(matMap(m, [60, 100])[0], 41);
    close(matMap(m, [60, 100])[1], 43);
    close(matMap(m, [60, 70])[1], 43 - 30 * (37 / 60));
    close(toMap2(m).scaleX(), 37 / 60);
  });
});

describe("关节与挂链", () => {
  const shoulder: LocalJoint = { at: [60, 40], rot: Math.PI / 2, sx: 1, sy: 1 };

  it("matLocal 绕 at 自转：at 是不动点，轴上的另一点被转到正下方", () => {
    const m = matLocal(shoulder);
    expect(matMap(m, [60, 40])).toEqual([60, 40]);
    const tip = matMap(m, [60, 50]); // at 下方 10 → 逆时针 90° 后落在 at 左侧 10
    close(tip[0], 50);
    close(tip[1], 40);
  });

  it("matFromJoint 把关节摆到全局位置：pivot 落点必须等于 (gx, gy)", () => {
    const m = matFromJoint({ gx: 72, gy: 55, rot: 0.4, sx: 1.1, sy: 0.9 }, [60, 40]);
    const p = matMap(m, [60, 40]);
    close(p[0], 72);
    close(p[1], 55);
  });

  it("matJoint = 先局部再父级（父在左），链长 2 的落点与手算一致", () => {
    const root = matTranslation(10, 20);
    const arm = matJoint(root, { at: [60, 40], rot: 0, sx: 1, sy: 1 });
    expect(matMap(arm, [60, 40])).toEqual([70, 60]);
    const nested = matJoint(arm, { at: [60, 60], rot: 0, sx: 1, sy: 1 });
    expect(matMap(nested, [60, 60])).toEqual([70, 80]);
  });

  it("★变异靶心：matMul 若忘了父级（写成 child 单独生效），整条手臂就脱钩", () => {
    const parent = matScale(2, 2);
    const child = matTranslation(5, 0);
    // 合成后：先平移再放大 → x = (5)·2 = 10；若父级被忽略则得 5
    expect(matMap(matMul(parent, child), [0, 0])).toEqual([10, 0]);
    expect(matMap(child, [0, 0])).toEqual([5, 0]);
  });

  it("旋转不可交换：这条断言保证测试真的在测顺序", () => {
    const r = matLocal({ at: [0, 0], rot: Math.PI / 2, sx: 1, sy: 1 });
    const t = matTranslation(10, 0);
    expect(matMap(matMul(r, t), [0, 0])).not.toEqual(matMap(matMul(t, r), [0, 0]));
  });
});

describe("与 Xf 的接缝", () => {
  /** 覆盖 Xf 的全部 8 个字段，含 rot/sx/sy/dy 非默认与负缩放。 */
  const XF_CASES = [
    { s: 37 / 60, ox: 41 - 60 * (37 / 60), oy: 43 - 100 * (37 / 60), sx: 1, sy: 1, dy: 0, rot: 0 },
    { s: 0.5, ox: 10, oy: -4, sx: 1.055, sy: 0.925, dy: -3, rot: 0.23 },
    { s: 1.3, ox: 70, oy: 90, sx: -1, sy: 1, dy: 6, rot: -0.9 },
    { s: 0.6166666, ox: 30.5, oy: 65, sx: 0.8, sy: 1.4, dy: 12, rot: 2.4 },
  ];
  const POINTS: Point2[] = [[60, 100], [60, 34], [16, 8], [137, 112], [0, 0], [-5, 200]];

  it("matOfXf 与 Xf.map 逐点相等（1e-9），含 rot≠0 的歪头档", () => {
    for (const c of XF_CASES) {
      const xf = Object.assign(new Xf(), c);
      const m = matOfXf(xf);
      for (const p of POINTS) {
        const a = xf.map(p);
        const b = matMap(m, p);
        close(a[0], b[0]);
        close(a[1], b[1]);
      }
    }
  });

  it("Xf 的三个倍数取法与 Mat 的一致（接缝两侧同口径）", () => {
    for (const c of XF_CASES) {
      const xf = Object.assign(new Xf(), c);
      const m = toMap2(matOfXf(xf));
      close(m.scaleX(), xf.s * Math.abs(xf.sx));
      close(m.scaleY(), xf.s * Math.abs(xf.sy));
      close(m.k(), xf.s);
    }
  });

  it("toMap2 的 map 与 matMap 同值，且返回的 Point2 是新数组（不许原地改输入）", () => {
    const p: Point2 = [3, 4];
    const m = toMap2(matScale(2, 3));
    expect(m.map(p)).toEqual([6, 12]);
    expect(p).toEqual([3, 4]);
  });
});
```

- [ ] **Step 2: 跑测试确认红**

Run: `CI=true npx vitest run src/renderer/pet/rig.test.ts`
Expected: FAIL — `Cannot find module './rig'`。

- [ ] **Step 3: 写实现**

创建 `src/renderer/pet/rig.ts`：

```ts
import type { Point2 } from "./ops";
import type { Xf } from "./xf";

/**
 * 2×3 仿射与骨架原语。见计划 Task 2 的「为什么要这一层」。
 * 口径与 CanvasRenderingContext2D.transform 一致：x' = a·x + c·y + e，y' = b·x + d·y + f。
 * 约定：**行向量左乘**（`p' = [x y 1] · M`），所以挂链是 `matMul(parent, child)`——
 * 子先作用于点、父后作用，读法与「手臂挂在肩上」的直觉同向。
 */
export interface Mat { a: number; b: number; c: number; d: number; e: number; f: number }

/** 全局关节：关节在目标空间里的落点 (gx,gy) + 该部件的旋转与两轴缩放。 */
export interface Joint { gx: number; gy: number; rot: number; sx: number; sy: number }

/** 父空间关节：锚点 at 在父空间坐标里，rot/sx/sy 是相对父级的增量。 */
export interface LocalJoint { at: Point2; rot: number; sx: number; sy: number }

export interface Map2 {
  map(p: Point2): Point2;
  /** 目标 x 轴的单位放大倍数，恒 ≥ 0——喂椭圆半径，负 rx 会让 ctx.ellipse 抛错。 */
  scaleX(): number;
  /** 目标 y 轴的单位放大倍数，恒 ≥ 0。 */
  scaleY(): number;
  /** 均匀缩放（面积开方）——喂线宽、字号、路径宽度。 */
  k(): number;
}

export const MAT_ID: Mat = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export function matTranslation(dx: number, dy: number): Mat {
  return { a: 1, b: 0, c: 0, d: 1, e: dx, f: dy };
}

export function matScale(sx: number, sy: number): Mat {
  return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 };
}

/** 根映射：viewBox 的 (60, 100)（脚线）→ center，全图只放大 s 倍。 */
export function matRoot(center: { x: number; y: number }, s: number): Mat {
  return { a: s, b: 0, c: 0, d: s, e: center.x - 60 * s, f: center.y - 100 * s };
}

export function matMap(m: Mat, p: Point2): Point2 {
  return [m.a * p[0] + m.c * p[1] + m.e, m.b * p[0] + m.d * p[1] + m.f];
}

/**
 * 把「pivot 在局部空间、关节落点在 (gx,gy)」的部件摆出去：
 * 先绕原点转 rot、再按 sx/sy 拉，然后平移使 pivot 正好落在 (gx,gy)。
 */
export function matFromJoint(j: Joint, pivot: Point2): Mat {
  const cos = Math.cos(j.rot), sin = Math.sin(j.rot);
  const a = j.sx * cos, b = j.sy * sin;
  const c = -j.sx * sin, d = j.sy * cos;
  return { a, b, c, d, e: j.gx - (a * pivot[0] + c * pivot[1]), f: j.gy - (b * pivot[0] + d * pivot[1]) };
}

export function matLocal(j: LocalJoint): Mat {
  return matFromJoint({ gx: j.at[0], gy: j.at[1], rot: j.rot, sx: j.sx, sy: j.sy }, j.at);
}

/** 父在左：对点而言 child 先作用、parent 后作用。 */
export function matMul(p: Mat, c: Mat): Mat {
  return {
    a: p.a * c.a + p.c * c.b,
    b: p.b * c.a + p.d * c.b,
    c: p.a * c.c + p.c * c.d,
    d: p.b * c.c + p.d * c.d,
    e: p.a * c.e + p.c * c.f + p.e,
    f: p.b * c.e + p.d * c.f + p.f,
  };
}

export function matJoint(parent: Mat, j: LocalJoint): Mat {
  return matMul(parent, matLocal(j));
}

export function toMap2(m: Mat): Map2 {
  return {
    map: (p: Point2) => matMap(m, p),
    scaleX: () => Math.hypot(m.a, m.b),
    scaleY: () => Math.hypot(m.c, m.d),
    // 纯镜像时 det 为负；面积口径取绝对值，k 永远非负。
    k: () => Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)),
  };
}

/**
 * `Xf` → `Mat`。`Xf.map` 的四步（绕支点转、x 绕 px 缩、y 绕 **100** 缩 + dy、整体 s + 偏移）
 * 每步都是仿射，合起来仍是仿射；这里把常数项显式解出来，接缝由 rig.test 的逐点等价测试钉住。
 * ⚠️ `yy` 那一步的缩放心是写死的 100（`Xf.map` 原文如此，不是 `py`），照抄。
 */
export function matOfXf(x: Xf): Mat {
  const cos = Math.cos(x.rot), sin = Math.sin(x.rot);
  const a = x.s * x.sx * cos;
  const c = -x.s * x.sx * sin;
  const b = x.s * x.sy * sin;
  const d = x.s * x.sy * cos;
  const e = x.s * (x.px * (1 - x.sx * cos) + x.sx * sin * x.py) + x.ox;
  const f =
    x.s *
      (100 + x.sy * (-x.px * sin - x.py * cos + x.py) - x.sy * 100 + x.dy) +
    x.oy;
  return { a, b, c, d, e, f };
}
```

- [ ] **Step 4: 跑绿**

Run: `CI=true npx vitest run src/renderer/pet/rig.test.ts`
Expected: PASS。若「matOfXf 与 Xf.map 逐点相等」红，**先手算 `Xf.map` 第三步**（`xf.ts:18-27`），不要调系数凑数——`f` 那行的每一项都对应 `Xf.map` 里的一段，凑数会留下「今天对、明天错」的错公式。

Run: `CI=true npx vitest run && npm run check:renderer`
Expected: 全绿（本任务没动任何现有文件）。

- [ ] **Step 5: 变异验牙（spec §10 的变异证明①）**

临时把 `matJoint` 改成 `return matLocal(j)`（忽略父级），跑 `CI=true npx vitest run src/renderer/pet/rig.test.ts`，Expected: FAIL（`matJoint = 先局部再父级` 的两条 `toEqual` 红）。还原，跑绿。提交信息里带上这条。

- [ ] **Step 6: 提交**

```bash
git add src/renderer/pet/rig.ts src/renderer/pet/rig.test.ts
git commit -m "feat(pet): 2×3 仿射 Mat 与骨架关节原语（P1 Task 2）

Xf 只会整只猫一次变换，猫娘要头/臂/手各转各的，必须能把变换挂起来。
Map2 是 art.ts 助手唯一的依赖面；matOfXf 的逐点等价测试是新旧两侧的接缝。
变异证明①：matJoint 忽略父级时链长 2 的落点断言变红。"
```

---


## Task 3: `pet-geometry.ts` 收 `profile`/`form`，默认值＝今天

**Files:**
- Modify: `src/shared/pet-geometry.ts`（`computePetLayout` :80-141、`resolveGrowthDirection` :198-227、`computeCatRect` :171-177）
- Test: `src/shared/pet-geometry.test.ts`（追加 `describe` 块，不改现有断言）

**Interfaces:**
- Consumes: Task 1 的 `PetProfile`/`profileFor`/`formGeometry`
- Produces:
  - `computePetLayout(input: PetLayoutInput & { profile?: PetProfile }): PetLayout`（现有字段一个不改名）
  - `resolveGrowthDirection(input: GrowthInput & { profile?: PetProfile }): { growUp: boolean; growLeft: boolean }`
  - `computeCatRect(input: { pinInWin: Point; e: number; profile?: PetProfile }): Rect`
  - `const DEFAULT_PROFILE: PetProfile`（＝ `profileFor("cat", "standard")`，导出给测试与 renderer 兜底）

**非目标（写进代码注释，免得后来者以为漏了）：** 字号与行宽**不**随档位缩放。气泡字号由 `bubbleBoxRect` 的现有测量决定，档只改变窗口与 `u`；大档下气泡更宽（`bubbleWidth = round(BUB_W·k)`）是必要的（同句子换行更少），但字体不放大。

- [ ] **Step 1: 写失败测试（追加到 `src/shared/pet-geometry.test.ts` 末尾）**

```ts
describe("档位与形态轴（Task 3）", () => {
  const wa = { x: 0, y: 0, width: 1920, height: 1080 };
  const origin = { x: 900, y: 500 };

  it("不传 profile 时三个函数逐字节等于旧行为", () => {
    const input = { catOrigin: origin, e: 0, be: 0, growLeft: false, growUp: false, workArea: wa, peekDx: 0 };
    expect(computePetLayout(input)).toEqual(computePetLayout({ ...input, profile: DEFAULT_PROFILE }));
    expect(computePetLayout({ ...input, profile: profileFor("cat", "large") }).size.width)
      .toBe(Math.round(82 * 1.22));
  });

  it("面板档的窗口尺寸取 profile.panel，不是写死的 OPEN_W/OPEN_H", () => {
    const p = profileFor("cat", "large");
    const opened = computePetLayout({ catOrigin: origin, e: 1, be: 0, growLeft: false, growUp: false, workArea: wa, profile: p });
    expect(opened.size).toEqual({ width: Math.round(248 * 1.22), height: Math.round(482 * 1.22) });
    expect(opened.pinInWin.x).toBe(p.pin.x);
  });

  it("气泡档宽 = profile.bubbleWidth", () => {
    const p = profileFor("cat", "small");
    const bub = computePetLayout({ catOrigin: origin, e: 0, be: 1, growLeft: false, growUp: false, workArea: wa, profile: p });
    expect(bub.size.width).toBe(Math.round(172 * 0.85));
  });

  it("computeCatRect：猫+standard 还原旧的 u×2.0 / u×1.85，且中心仍按 -17s/+4.5s", () => {
    const e = 0.4;
    const { u, s } = scaleFor(e);
    const pinInWin = { x: PIN.x, y: PIN.y };
    const r = computeCatRect({ pinInWin, e });
    const cx = pinInWin.x - 17.0 * s;
    const cy = pinInWin.y + 4.5 * s;
    expect(r).toEqual({ x: cx - u, y: cy - (u * 1.85) / 2, width: u * 2.0, height: u * 1.85 });
  });

  it("猫娘的命中框把耳朵到脚全包住，且随 k 放大", () => {
    const girl = computeCatRect({ pinInWin: { x: 41, y: 39 }, e: 0, profile: profileFor("girl", "standard") });
    const foot = 39 + 4.5 * (37 / 60);
    expect(girl.y).toBeLessThan(foot - 100 * (37 / 60) + 1); // 上沿在脚线之上 ≥ 92 个 viewBox 单位
    expect(girl.y + girl.height).toBeGreaterThan(foot - 1);
    const large = computeCatRect({ pinInWin: { x: 50, y: 48 }, e: 0, profile: profileFor("girl", "large") });
    expect(large.height / girl.height).toBeCloseTo(1.22, 6);
    expect(large.width / girl.width).toBeCloseTo(1.22, 6);
  });

  it("resolveGrowthDirection 的大档面板比收起态高 588，靠下沿时必须向上长", () => {
    const p = profileFor("cat", "large");
    const low = { x: 0, y: 0, width: 1920, height: 700 };
    const g = resolveGrowthDirection({
      catOrigin: { x: 900, y: 690 }, workArea: low,
      current: { growUp: false, growLeft: false }, targetWidth: p.bubbleWidth, profile: p,
    });
    expect(g.growUp).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认红**

Run: `CI=true npx vitest run src/shared/pet-geometry.test.ts`
Expected: FAIL — 新增块报 `DEFAULT_PROFILE`/`profileFor` 未定义（导入失败）。**旧断言必须仍然绿**；若旧断言先红了，说明你在改签名时动了默认行为，先回退。

- [ ] **Step 3: 改实现**

`src/shared/pet-geometry.ts`：

```ts
// 文件头 import 追加（两个文件同在 src/shared/，所以是 "./pet-profile"）
import { profileFor, formGeometry, type PetProfile } from "./pet-profile";

/** 默认档＝今天写死的常量；不传 profile 的调用方行为不变。 */
export const DEFAULT_PROFILE: PetProfile = profileFor("cat", "standard");
```

这条依赖是**双向的**：`pet-profile.ts` 从 `pet-geometry.ts` 取 `scaleFor/PET_W/PET_H/OPEN_W/OPEN_H/BUB_W/PIN`，`pet-geometry.ts` 从 `pet-profile.ts` 取 `profileFor/formGeometry`。它安全的前提是「顶层不求值」：`pet-profile.ts` 的顶层只有 `SIZE_TIERS/TIER_SCALE/FORM_GEOMETRY/PIN_Y_RATIO` 四个字面量，都不碰 pet-geometry 的常量（`profileFor` 是函数声明，调用时才读 `PET_W`）。所以 **`DEFAULT_PROFILE` 必须放在 `pet-geometry.ts` 里 `PET_W…PIN` 那批常量之下**（例如紧挨 `scaleFor` 之后），不能放在文件最上面。放对了不会报 TDZ；若仍报 `Cannot access 'PET_W' before initialization`，就是位置错，把它下移——不许改成 `let` 或写 `defaultProfile()` 缓存绕过去。

三处函数体改动（只把字面常量换成 profile 字段，**算式形状一字不动**）：

1. `computePetLayout`：入参加 `profile = DEFAULT_PROFILE`；
   - `PIN` → `profile.pin`（:80-141 内所有出现，含 panel 分支的 `anchor.y = growUp ? OPEN_H - EDGE_MARGIN - 51.5*(29.0/60.0) : PIN.y`，其中 `OPEN_H` → `profile.panel.height`，`51.5*(29.0/60.0)` 这项也要乘 `profile.k`，因为它是一个**长度**）
   - `targetW = usingPanel ? OPEN_W : BUB_W` → `usingPanel ? profile.panel.width : profile.bubbleWidth`
   - `targetH = usingPanel ? OPEN_H : PET_H` → `usingPanel ? profile.panel.height : profile.base.height`
   - 末尾 `computeCatRect` 内部用的 `scaleFor` → `profile.catScale`（见第 3 点）
2. `resolveGrowthDirection`：入参加 `profile = DEFAULT_PROFILE`；`OPEN_H` → `profile.panel.height`、`PET_H` → `profile.base.height`、`PET_W` → `profile.base.width`；`targetWidth ?? OPEN_W` → `?? profile.bubbleWidth`。`EDGE_MARGIN` **不乘 k**（它是「离屏幕边缘留几像素」，与宠物大小无关）。
3. `computeCatRect`：入参加 `profile = DEFAULT_PROFILE`，整体换成

```ts
export function computeCatRect(input: { pinInWin: Point; e: number; profile?: PetProfile }): Rect {
  const p = input.profile ?? DEFAULT_PROFILE;
  const { u, s } = p.catScale(input.e);
  const g = formGeometry(p.form);
  const cx = input.pinInWin.x + g.centerOffset.dx * s;
  const cy = input.pinInWin.y + g.centerOffset.dy * s + g.hitBiasY * u;
  const width = u * g.hitAspect.width;
  const height = u * g.hitAspect.height;
  return { x: cx - width / 2, y: cy - height / 2, width, height };
}
```

对照旧式（pet-geometry.ts:171-177）：`u = 37 − 5e`、`s = u/60`，旧码 `x = cx − u`、`y = cy − (u*1.85)/2`。新式在 `hitBiasY = 0`、`hitAspect = {2.0, 1.85}`、`centerOffset = {-17, 4.5}` 下算出的四个数与旧式**逐字节相等**（`width/2 = u`、`height/2 = 0.925u`）。若不相等，是你把 `u` 与 `s` 搞混了：`s = u/60` 是「viewBox 单位→屏幕像素」，`centerOffset` 用 `s`，`hitAspect`/`hitBiasY` 用 `u`。

- [ ] **Step 4: 跑绿 + 全量回归**

Run: `CI=true npx vitest run`
Expected: 全绿。**这一步是唯一允许出现「旧测试变红」的地方**，且只接受一种原因：某个旧断言写的是「不传 profile」路径，那就是实现错了（默认值必须等于今天），不许改旧断言的期望值。

Run: `npm run check:main && npm run check:renderer`
Expected: 无类型错误。

- [ ] **Step 5: 变异验牙**

临时把 `computeCatRect` 里 `g.hitBiasY * u` 删掉（等价于忽略 bias），跑 `CI=true npx vitest run src/shared/pet-geometry.test.ts`，Expected: FAIL（猫娘那两条红，猫的仍绿——正好证明两条路各自有牙）。还原，跑绿。

- [ ] **Step 6: 提交**

```bash
git add src/shared/pet-geometry.ts src/shared/pet-geometry.test.ts
git commit -m "feat(pet): 布局几何收 profile/form，默认档逐字节等于旧常量（P1 Task 3）

EDGE_MARGIN 明确不随档位缩放（离屏留白与宠物大小无关）；
字号不放大是设计非目标，已写进注释。"
```

---

## Task 4: `art.ts` 助手收 `Map2`，`Xf` 补三个倍数口

**Files:**
- Modify: `src/renderer/pet/xf.ts`（给 `Xf` 加 `scaleX()/scaleY()/k()`）
- Modify: `src/renderer/pet/art.ts`（`xfFill` :86、`xfGrad` :95、`xfEllipse` :110、`xfCircle` :116、`xfArc` :121、`xfPoly` :126 的形参类型）
- Test: `src/renderer/pet/art-golden.test.ts`（新建）

**Interfaces:**
- Consumes: Task 2 的 `Map2`、`toMap2`
- Produces: `art.ts` 六个绘图助手的签名从 `(…, xf: Xf)` 变为 `(…, xf: Map2)`；`Xf` 结构上实现 `Map2`（无需 `implements` 声明）

**这一步不改任何视觉**，只是把「谁能被喂进绘图助手」从「一个具体类」放宽成「一个接口」。因为不产生新行为，所以**不能用「先写红测试」的节奏**——它需要的是一条**表征锁**（characterization test）：先把今天 `buildCatOps` 的输出钉成 JSON 快照，改完再让它绿。这条锁会一直留在仓库里，Task 5/6/8/14 都靠它证明「四足没变」。

- [ ] **Step 1: 立表征锁（此刻必须直接绿——它钉的是现状）**

创建 `src/renderer/pet/art-golden.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { buildCatOps, type CatInput } from "./art";
import { CAT_COATS } from "../../shared/cat-coats";
import type { DrawOp } from "../../shared/draw-ops";

const NEUTRAL: CatInput = {
  center: { x: 41, y: 43 }, u: 37, mood: "idle", t: 0, energy: 1, mouse: null,
  blink: 0, jumpY: 0, pet: 0, quiet: false,
  pose: { paw: 0, yawn: 0, stretch: 0, tilt: 0, engagement: 0 },
};

/** 六个覆盖面不同的静帧：默认、睡（zzz）、摸头（爱心）、开心（徽章）、断连（换色）、免打扰（月牙）。 */
const CASES: Array<[string, CatInput]> = [
  ["idle", NEUTRAL],
  ["sleep", { ...NEUTRAL, mood: "sleep" }],
  ["pet", { ...NEUTRAL, pet: 1 }],
  ["happy", { ...NEUTRAL, mood: "happy" }],
  ["break", { ...NEUTRAL, mood: "break" }],
  ["quiet", { ...NEUTRAL, quiet: true }],
];

/** dump 命令见 Task 4 Step 1；此串是 JSON.stringify(pairs) 的字面量形式，禁止手写。 */
const GOLDEN_JSON = "PLACEHOLDER_FROM_DUMP";
const golden = new Map<string, string>(JSON.parse(GOLDEN_JSON) as Array<[string, string]>);

describe("buildCatOps 逐 op 表征锁（Task 4 起，四足不许变）", () => {
  it("六个静帧与在案快照逐字节相等", () => {
    for (const [name, input] of CASES) {
      expect(JSON.stringify(buildCatOps(input)), name).toBe(golden.get(name));
    }
  });

  it("五种花色 × 六静帧都出图且长度稳定（coat 走的是同一批助手）", () => {
    for (const coat of Object.keys(CAT_COATS) as Array<keyof typeof CAT_COATS>) {
      const ops: DrawOp[] = buildCatOps({ ...NEUTRAL, coat, mood: "happy" });
      expect(ops.length).toBe(golden.get("happy") ? JSON.parse(golden.get("happy")!).length : 0);
      expect(ops.length).toBeGreaterThan(20);
    }
  });
});
```

⚠️ `GOLDEN_JSON` 此刻还是 `"PLACEHOLDER_FROM_DUMP"`，`JSON.parse` 会抛，所以**第一跑必红**——这是有意的：它保证快照必须由命令产出、不许凭记忆编。填法：

在 `art-golden.test.ts` 里临时加一条 dump（跑完删掉）：

```ts
it("dump（临时，回填后删除）", () => {
  console.log(JSON.stringify(CASES.map(([n, i]) => [n, JSON.stringify(buildCatOps(i)]))));
});
```

Run: `CI=true npx vitest run src/renderer/pet/art-golden.test.ts`
Expected: `dump` 打印出一整行 `[["idle","[…]"],["sleep","[…]"],…]`；`it("六个静帧…")` 这条**红**（`JSON.parse` 抛 `Unexpected token P in JSON` 或等价错误）。

把打印出的那一行原样填进 `const GOLDEN_JSON = "…"`（它是 `JSON.stringify` 的结果，内含 `"` 与 `\` 的转义——用 `console.log` 出来的**字符串字面量形式**再套一层引号，或改写成 `const GOLDEN = JSON.parse(fs.readFileSync(...))` 之前先确认转义无误）。然后**删掉 `dump` 那条 `it`**。

- [ ] **Step 1b: 回填后必须绿**

Run: `CI=true npx vitest run src/renderer/pet/art-golden.test.ts`
Expected: PASS（六条逐字节相等）。若某条红，是转义在复制中出错，重新 dump 再填——**禁止**改期望值凑绿。

- [ ] **Step 2: 给 `Xf` 补三个口（`xf.ts`）**

在 `Xf` 类的 `map` 之后追加：

```ts
  /** 目标 x 轴的单位放大倍数，恒 ≥ 0。与 `Mat` 侧 `hypot(a,b)` 同义，接缝由 rig.test 钉住。 */
  scaleX(): number { return this.s * Math.abs(this.sx); }
  /** 目标 y 轴的单位放大倍数，恒 ≥ 0。 */
  scaleY(): number { return this.s * Math.abs(this.sy); }
  /** 均匀缩放（线宽/字号口径）＝整体缩放 s。 */
  k(): number { return this.s; }
```

- [ ] **Step 3: 换掉六个助手的形参类型与体内取值**

`src/renderer/pet/art.ts`：把助手形参 `xf: Xf` 改成 `xf: Map2`（`import type { Map2 } from "./rig"`；`Xf` 若仍被 `buildCatOps` 用到就两者并存，`xf.ts` 的类不动）。按**同一张替换表**逐个改，不改算式形状：

| 现在（`Xf` 口径） | 改成（`Map2` 口径） | 为什么等价 |
|---|---|---|
| `rx * xf.s * Math.abs(xf.sx)` | `rx * xf.scaleX()` | `scaleX()` 的定义就是 `s·\|sx\|` |
| `ry * xf.s * Math.abs(xf.sy)` | `ry * xf.scaleY()` | 同上 |
| `width * xf.s`（`xfPoly` 的线宽） | `width * xf.k()` | `k()` 的定义就是 `s` |
| `xf.map(p)` | 不变 | `Map2.map` 同签名 |
| 助手体内任何其它 `xf.s/sx/sy/rot/ox/oy/px/py/dy` 字段读取 | **不许留**：助手层只准用四个口 | 放宽接口的全部意义在这里 |

自查并把结果贴进提交信息：

```bash
grep -n "xf\.\(s\b\|sx\|sy\|rot\|ox\|oy\|px\|py\|dy\)" src/renderer/pet/art.ts
```

期望：只剩注释行或零行。助手体外（`buildCatOps` 构造 `Xf` 本体、读 `TILT_DEG` 等）照旧用字段——那是四足自己的事。

- [ ] **Step 4: 表征锁必须仍绿**

Run: `CI=true npx vitest run`
Expected: 全绿。`art-golden` 的逐字节相等就是「四足没变」的证明；`art.test.ts` 的数值锁（`5.9*S*1.055`、高光 `rx*0.30`、爱心锚点、采样密度 49/53/15、双色月牙）也必须全绿。

- [ ] **Step 5: 变异验牙**

临时把 `xfEllipse` 里的 `xf.scaleY()` 写成 `xf.k()`（把两轴压成均匀缩放——一个「看着差不多」的错），跑 `CI=true npx vitest run src/renderer/pet/art-golden.test.ts`，Expected: FAIL（含椭圆的静帧全红）。还原跑绿。这条同时证明表征锁不是空转。

- [ ] **Step 6: 提交**

```bash
npm run check:renderer
git add src/renderer/pet/xf.ts src/renderer/pet/art.ts src/renderer/pet/art-golden.test.ts
git commit -m "refactor(pet): 绘图助手改吃 Map2 接口，Xf 补 scaleX/scaleY/k（P1 Task 4）

零视觉改动：art-golden 六静帧逐字节相等即证明。这条表征锁今后常驻，
Task 5/6/8/14 都靠它验四足不变。变异验牙：xfEllipse 用 k() 顶替 scaleY() 时静帧全红。"
```

---

## Task 5: 抽出 `buildOverlayOps`——猫娘要复用同一批屏幕空间记号

**Files:**
- Modify: `src/renderer/pet/art.ts`（`zzz` :432-445、`quiet_mark` :448-454、`heart` :457-470、`stars` :473-484、`badge` :487-524、胶囊/未读段 :558 起）
- Test: `src/renderer/pet/overlay.test.ts`（新建）

**Interfaces:**
- Consumes: Task 4 的 `Map2` 助手、Task 2 的 `toMap2`
- Produces:
  - `buildOverlayOps(o: CatInput, badgeMap: Map2): DrawOp[]` — 返回 `zzz / quiet_mark / heart / stars / badge / capsule / unread` 这批**不吃身体骨架**的图元，相对顺序与今天在 `buildCatOps` 里一致
  - `badgeMapFor(o: CatInput, dx: number, dy: number): Map2` — 今天 badge 段那枚 `xfn` 的构造口，`dx/dy` 是**viewBox 单位**的额外偏移；`badgeMapFor(input, 0, 0)` 必须逐字节等于今天的 `xfn`（表征锁证明这一点）
  - `buildCatOps` 内部改为「身体段 + `buildOverlayOps(input, badgeMapFor(input, 0, 0))`」

**为什么注入 `Map2` 而不是直接注入两个数：** 猫娘的徽章要钉在胸口、四足的钉在围兜上沿，这是「钉在哪」的差异；但徽章**大小不吃两轴缩放**这个 native 口径必须只有一处实现。所以钉位由 `badgeMapFor` 一处构造、`Map2` 一路传下去，Task 6 的猫娘只需换一组 `dx/dy`。


**为什么要拆（注释里写清）：** 爱心、Zzz、月牙、徽章、胶囊这几层**本来就不跟着身体转**——badge 段今天为了这件事复制了一整个 `Xf`（`art.ts:487-524` 的 `xfn`），是「同一件事两处实现」的债。猫娘需要同一批记号但不需要同一枚 `xfn`（她的徽章要钉在胸口而不是围兜），所以把「记号」与「钉在哪」分开：记号在 `buildOverlayOps` 里，钉位由调用方注入 `badgeMap`。四足侧注入的正是今天的 `xfn`，所以逐字节不变。

- [ ] **Step 1: 先 grep 定名，别凭记忆写接口**

```bash
cd /d/Test/workbuddy/cyrene-verge
grep -n "xfn\|PIN_X\|SPOKEN_CAP\|capsule\|unread\|badge" src/renderer/pet/art.ts | head -40
```

如果 grep 显示 badge/capsule/unread 的判定还依赖 `center`/`u`/`jumpY` 这类身体量，就**照原样把整个 `CatInput` 喂给 `buildOverlayOps`**（如上签名），并在注释里点名「这三层的钉位来自绘制原点，不是骨架」——不要为了接口好看而把输入裁小，那会改变输出。

- [ ] **Step 2: 写失败测试**

创建 `src/renderer/pet/overlay.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { buildCatOps, buildOverlayOps, type CatInput } from "./art";
import { toMap2, type Mat } from "./rig";
import { Xf } from "./xf";
import type { DrawOp, EllipseOp, PathOp } from "../../shared/draw-ops";

const BASE: CatInput = {
  center: { x: 41, y: 43 }, u: 37, mood: "idle", t: 3.5, energy: 1, mouse: null,
  blink: 0, jumpY: 0, pet: 0, quiet: false,
  pose: { paw: 0, yawn: 0, stretch: 0, tilt: 0, engagement: 0 },
};
const OVERLAY_LAYERS = ["zzz", "quiet_mark", "heart", "stars", "badge", "capsule", "unread"];
const onlyOverlay = (ops: DrawOp[]) => ops.filter((o) => (OVERLAY_LAYERS as string[]).includes(o.layer));
const byLayer = (ops: DrawOp[], layer: string) => ops.filter((o) => o.layer === layer);

/** 照抄 art.ts badge 段那枚 xfn 的构造——测试里留一份才能证明抽干净了（本次要消灭的重复）。 */
function catBadgeXf(input: CatInput): Xf {
  const xf = new Xf();
  Object.assign(xf, badgeXfFields(input)); // ← Step 3 前先把 art.ts 里的构造原样抄进本文件
  return xf;
}

function shiftOp(op: DrawOp, dx: number, dy: number): DrawOp {
  const o = { ...op } as DrawOp;
  if (o.kind === "fillPath" || o.kind === "strokePath") {
    (o as PathOp).points = (o as PathOp).points.map(([x, y]) => [x + dx, y + dy]);
    return o;
  }
  if (o.kind === "fillEllipse" || o.kind === "strokeEllipse") {
    const e = o as EllipseOp;
    e.cx += dx; e.cy += dy;
    return e;
  }
  throw new Error(`overlay 段出现未预期的图元 kind=${o.kind}：拆层拆错了`);
}

describe("overlay 层与身体解耦", () => {
  it("四足：buildOverlayOps 吃今天的 xfn 时与 buildCatOps 的 overlay 段逐字节相等", () => {
    for (const extra of [{}, { mood: "sleep" as const }, { pet: 1 }, { quiet: true }, { mood: "happy" as const }]) {
      const input = { ...BASE, ...extra };
      const mine = onlyOverlay(buildCatOps(input));
      const theirs = buildOverlayOps(input, toMap2(catBadgeXf(input)));
      expect(theirs.map((o) => o.layer)).toEqual(mine.map((o) => o.layer)); // 顺序也是断言对象
      expect(theirs).toEqual(mine);
    }
  });

  it("badgeMap 真的管徽章：换一枚平移过的阵，badge 动、其它层不动", () => {
    const input = { ...BASE, mood: "happy" as const };
    const plain = toMap2(catBadgeXf(input));
    const moved: Mat = { a: 1, b: 0, c: 0, d: 1, e: 8, f: -6 };
    const a = byLayer(buildOverlayOps(input, plain), "badge");
    const b = byLayer(buildOverlayOps(input, toMap2(moved)), "badge");
    expect(a.length).toBeGreaterThan(0);
    expect(b).toEqual(a.map((o) => shiftOp(o, 8, -6)));
    for (const layer of OVERLAY_LAYERS.filter((l) => l !== "badge")) {
      expect(byLayer(buildOverlayOps(input, toMap2(moved)), layer))
        .toEqual(byLayer(buildOverlayOps(input, plain), layer));
    }
  });

  it("正对照：换成恒等阵徽章必须动（证明注入没被忽略）", () => {
    const input = { ...BASE, mood: "happy" as const };
    expect(buildOverlayOps(input, toMap2(catBadgeXf(input)))).not.toEqual(
      buildOverlayOps(input, toMap2({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })),
    );
  });
});
```

Run: `CI=true npx vitest run src/renderer/pet/overlay.test.ts`
Expected: FAIL — `buildOverlayOps` 未导出（或 `badgeXfFields` 还没抄、报未定义——先把它从 `art.ts` 的 badge 段原样抄进测试）。

- [ ] **Step 3: 做纯搬运**

新增 `export function buildOverlayOps(o: CatInput, badgeMap: Map2): DrawOp[]`，把 `zzz`/`quiet_mark`/`heart`/`stars`/`badge`/胶囊/未读七段**函数体原样搬进来**，只改两处：`xfn` → `badgeMap`；`11 * xfn.s` → `11 * badgeMap.k()`。

⚠️ 基圆这里必须用 `k()` 而不是 `scaleX()`：native 口径这一段本来就不吃两轴（`art.ts` 的 badge 段抄的是 `xfn.s`）。写成 `scaleX()` 在歪头档会把徽章放大，Step 4 的表征锁与 `art.test.ts` 的 badge 正对照会一起红。

`buildCatOps` 里那七段替换成一行 `ops.push(...buildOverlayOps(input, badgeMapFor(input, 0, 0)))`，其中 `badgeMapFor` 的函数体**就是今天 `xfn` 的那段构造**，末尾多两条 `+ dx` / `+ dy`：

```ts
/** badge 段钉位：`dx/dy` 为 viewBox 单位的额外偏移；(0,0) 逐字节等于今天（表征锁证明）。 */
export function badgeMapFor(o: CatInput, dx: number, dy: number): Map2 {
  const xf = new Xf();
  // ……此处照抄今天 xfn 的每一行赋值，只在最后 ox/oy 那两行各加上 dx*s / dy*s
  return toMap2(xf);
}
```

相对顺序不许变：`LAYERS`（:256-260）与 `art.test.ts:42-45` 的 ORDER 锁都按声明序断言。测试里的 `catBadgeXf` 同步换成 `badgeMapFor(BASE, 0, 0)`（它的返回值已是 `Map2`，`toMap2(...)` 那层包装删掉）。

- [ ] **Step 4: 三条锁一起绿**

Run: `CI=true npx vitest run src/renderer/pet/overlay.test.ts src/renderer/pet/art-golden.test.ts src/renderer/pet/art.test.ts`
Expected: 全绿。`art-golden` 逐字节相等是主要证据；`art.test.ts` 的 zzz 三枚错相、双色月牙、爱心锚点、badge 正对照也必须绿。

- [ ] **Step 5: 变异验牙**

临时删掉 `buildOverlayOps` 里的月牙（`quiet_mark`）那一段，跑 `CI=true npx vitest run src/renderer/pet/art-golden.test.ts src/renderer/pet/overlay.test.ts`，Expected: FAIL（`quiet` 静帧红 + overlay 的「其它层不动」红）。还原跑绿。

- [ ] **Step 6: 提交**

```bash
npm run check:renderer
git add src/renderer/pet/art.ts src/renderer/pet/overlay.test.ts
git commit -m "refactor(pet): overlay 层抽出 buildOverlayOps，徽章钉位改为注入（P1 Task 5）

消灭 badge 段自抄的 xfn；四足仍吃原来那枚，art-golden 逐字节证明零变化。
基圆用 k() 不用 scaleX()——native 口径这里本来就不吃两轴。
变异验牙：删 quiet_mark 段时 quiet 静帧与 overlay 对照同时红。"
```

---

## Task 6: `girl.ts` 站姿 + `draw-ops.ts` 十个新标签 + `form.ts` 分派

这是整个 v1.5.0 最大的一块美术，也是「猫娘第一次被画出来」。拆到不能再拆：本任务只做**站姿**（无表情通道、无手势），P2/P4 再往里挂。

**Files:**
- Create: `src/renderer/pet/girl.ts`
- Create: `src/renderer/pet/form.ts`
- Modify: `src/shared/draw-ops.ts:7-13`（`PetLayer` 追加 10 个标签）
- Modify: `src/renderer/pet/renderer.ts:670`（`buildCatOps(this.cat)` → `buildPetOps(this.cat)`，**只有这一行**）＋ `renderer.ts:122-134` 的 `this.cat` 字面量补 `form: "cat"`
- Modify: `src/renderer/main.ts:355` 附近（进程内 `--form=` / `--tier=` 覆盖，只读 `process.argv`，不落盘）
- Test: `src/renderer/pet/girl.test.ts`（新建）

**为什么派发点放在这一行：** P1 的收口门（Task 8）要「猫娘上屏」，而 `buildCatOps` 的唯一调用点就在 `renderer.ts:670`。不改这一行，P1 的屏幕层就只能靠位图冒充，那是假绿；改了这行，`form.ts` 的缺省分支是 `cat`（`input.form ?? "cat"`），四足路径**逐字节走同一条**——所以代价是一行 diff，收益是 P1 真能看见猫娘。这条之外的任何 renderer 改动仍然越界，留给 Task 14。

**Interfaces:**
- Consumes: Task 2 的 `Mat`/`toMap2`/`matRoot`/`matJoint`/`Map2`、Task 4 的 `Map2` 口径助手、Task 5 的 `buildOverlayOps`/`badgeMapFor`、`CAT_COATS`/`CatCoat`、`pet-tokens` 的 `wash`/`withAlpha`
- Produces:
  - `const GIRL_PROPORTION: { crown: 22; chin: 61; headCy: 41.5; headRx: 17; headRy: 19.5; eyeY: 44.5; eyeLx: 52; eyeRx: 68; eyeRr: 5.9; eyeRy: 6.6; shoulderY: 66; shoulderDx: 13; waistY: 79; hemY: 89; hemHalf: 16; kneeY: 93; footY: 100 }`（对象字面量按左侧类型写；数值全部来自 spec §4，不许改）
  - `girlPalette(coat: CatCoat): GirlPalette`
  - `buildGirlOps(input: PetInput): DrawOp[]`
  - `PetInput`（`form.ts`）：`CatInput & { form?: PetForm }`——P1 只有 `form` 这一条额外轴，`channels`/`face` 由 Task 14 追加
  - `buildPetOps(input: PetInput): DrawOp[]`
  - `const PET_BUILDERS: Record<PetForm, (i: PetInput) => DrawOp[]>`

- [ ] **Step 1: 写失败测试**

创建 `src/renderer/pet/girl.test.ts`（三条尺子的单位层，spec §10 尺 #71 的屏幕层在 Task 26）：

```ts
import { describe, expect, it } from "vitest";
import { buildGirlOps, GIRL_PROPORTION, girlPalette } from "./girl";
import { buildPetOps, type PetInput } from "./form";
import { buildCatOps, type CatInput } from "./art";
import { opsBounds } from "./ops";
import { CAT_COATS, type CoatName } from "../../shared/cat-coats";
import { CAT_PALETTE, PAPER, wash } from "../../shared/pet-tokens";
import type { DrawOp } from "../../shared/draw-ops";

const NEUTRAL: CatInput = {
  center: { x: 41, y: 43 }, u: 37, mood: "idle", t: 0, energy: 1, mouse: null,
  blink: 0, jumpY: 0, pet: 0, quiet: false,
  pose: { paw: 0, yawn: 0, stretch: 0, tilt: 0, engagement: 0 },
};
const GIRL_ORDER = [
  "ground_shadow", "legs", "tail", "dress", "body", "arms", "hands", "collar", "ears",
  "hair_back", "hair_front", "ahoge", "brows", "eyes", "nose", "mouth", "blush", "tear",
];
const layerKinds = (ops: DrawOp[]) => ops.map((o) => o.layer).filter((l, i, a) => a.indexOf(l) === i);

/** 尺 #71 的单位层：每种花色各算一次设备像素覆盖度（dpr 上限 2，与 renderer.readAlpha 同口径）。 */
function coverageByColor(ops: DrawOp[], dpr = 2) {
  const acc = new Map<string, number>();
  for (const o of ops) {
    const fill = "fill" in o ? (o as { fill?: string }).fill : undefined;
    if (!fill) continue;
    const b = opsBounds([o]);
    if (!b) continue;
    const px = b.width * b.height * dpr * dpr;
    acc.set(fill, (acc.get(fill) ?? 0) + px);
  }
  return acc;
}

describe("猫娘站姿", () => {
  it("ORDER 与 spec §4 逐层相等，且 10 个新标签一个不多一个不少", () => {
    expect(layerKinds(buildGirlOps({ ...NEUTRAL }))).toEqual(GIRL_ORDER.filter((l) =>
      ["ground_shadow","legs","tail","dress","body","arms","hands","collar","ears","hair_back","hair_front","ahoge","brows","eyes","nose","mouth","blush","tear"].includes(l)));
  });

  it("比例钉死：头顶 22 / 下巴 61 / 脚线 100，头心 (60, 41.5) 半径 (17, 19.5)", () => {
    expect(GIRL_PROPORTION.crown).toBe(22);
    expect(GIRL_PROPORTION.chin).toBe(61);
    expect(GIRL_PROPORTION.headCy).toBeCloseTo((22 + 61) / 2, 6);
    expect(GIRL_PROPORTION.headCy + GIRL_PROPORTION.headRy).toBeCloseTo(61, 6);
    expect(GIRL_PROPORTION.headCy - GIRL_PROPORTION.headRy).toBeCloseTo(22, 6);
    expect(GIRL_PROPORTION.footY).toBe(100);
  });

  it("五种花色都过尺 #71 的单位判据：≥6 个颜色类各 ≥300 设备像素", () => {
    for (const name of Object.keys(CAT_COATS) as CoatName[]) {
      const ops = buildGirlOps({ ...NEUTRAL, coat: CAT_COATS[name] });
      const cov = [...coverageByColor(ops).entries()].filter(([, px]) => px >= 300);
      expect(cov.length, `${name} 只有 ${cov.length} 个够大的颜色类`).toBeGreaterThanOrEqual(6);
    }
  });

  it("至少一枚 strokePath 线宽 ≥1、至少一条 arc/quad 曲线（≥3 点）", () => {
    const ops = buildGirlOps({ ...NEUTRAL });
    expect(ops.some((o) => o.kind === "strokePath" && o.width >= 1)).toBe(true);
    expect(ops.some((o) => (o.kind === "strokePath" || o.kind === "fillPath") && o.points.length >= 3)).toBe(true);
  });

  it("眼睛沿用四足的半径与高光系数，但落在猫娘的眼位", () => {
    const eyes = buildGirlOps({ ...NEUTRAL }).filter((o) => o.layer === "eyes" && o.kind === "fillEllipse");
    expect(eyes.length).toBeGreaterThanOrEqual(2);
    for (const e of eyes) {
      if (e.rx / 5.9 > 0.9 && e.rx / 5.9 < 1.1) expect(e.ry / e.rx).toBeCloseTo(6.6 / 5.9, 6);
    }
    const whites = eyes.filter((e) => Math.abs(e.rx / 5.9 - 1) < 0.05);
    expect(whites.length).toBeGreaterThanOrEqual(2);
    for (const w of whites) expect(w.cy).toBeCloseTo(GIRL_PROPORTION.eyeY * (37 / 60) + 43 - 100 * (37 / 60), 6);
  });

  it("全部颜色都能追溯到 token：每个 fill/stroke 都在板内色或 wash 派生集合里", () => {
    const derived = new Set<string>();
    for (const name of Object.keys(CAT_COATS) as CoatName[]) {
      const p = girlPalette(CAT_COATS[name]) as unknown as Record<string, string>;
      for (const v of Object.values(p)) if (typeof v === "string") derived.add(v);
    }
    for (const v of Object.values(CAT_PALETTE)) if (typeof v === "string") derived.add(v);
    for (const o of buildGirlOps({ ...NEUTRAL })) {
      for (const key of ["fill", "stroke"] as const) {
        const c = (o as unknown as Record<string, unknown>)[key];
        if (typeof c !== "string") continue;
        if (c.startsWith("rgba(")) continue; // withAlpha 的结果，token 可追溯由 palette:check 管
        expect(derived, `画不出板的色：${c}`).toHaveProperty(c);
      }
    }
  });

  it("画进窗口：u=37 时包围盒不越 82×108，且脚线在 y≈61.5", () => {
    const b = opsBounds(buildGirlOps({ ...NEUTRAL }))!;
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(82);
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.y + b.height).toBeLessThanOrEqual(108);
    expect(b.height).toBeGreaterThan(50); // 竖构图：站姿在 108 高窗里要占住大半
  });

  it("`form: "cat"` 与不带 form 时逐字节等于 buildCatOps（R-D2 的分派侧证明）", () => {
    expect(buildPetOps({ ...NEUTRAL })).toEqual(buildCatOps(NEUTRAL));
    expect(buildPetOps({ ...NEUTRAL, form: "cat" })).toEqual(buildCatOps(NEUTRAL));
  });

  it("纯函数：同输入两次调用逐字段相等，t 恒 0（R-D9）", () => {
    const a = buildGirlOps({ ...NEUTRAL });
    expect(a).toEqual(buildGirlOps({ ...NEUTRAL }));
    expect(a.every((o) => !("t" in o) || o.t === 0)).toBe(true);
  });

  it("正对照：把 dress 的填充改成板外色，上一条 token 追溯锁必须红（不是空转）", () => {
    const ops = buildGirlOps({ ...NEUTRAL });
    const dress = ops.find((o) => o.layer === "dress" && o.kind === "fillPath");
    expect(dress).toBeDefined();
    expect(coverageByColor([dress!]).size).toBe(1);
  });
});
```

Run: `CI=true npx vitest run src/renderer/pet/girl.test.ts`
Expected: FAIL — `Cannot find module './girl'`。

- [ ] **Step 2: `draw-ops.ts` 追加十个标签**

`src/shared/draw-ops.ts:7-13` 的 `PetLayer` 联合里，在现有 23 个之后追加（**注释说明每个标签只在 `form === "girl"` 出现**，四足永不产出它们——这条由 `art-golden` 的逐字节相等间接保证）：

```ts
  | "legs" | "dress" | "arms" | "hands" | "collar"
  | "hair_back" | "hair_front" | "ahoge" | "brows" | "tear"
```

十个，不多不少。`body`/`ears`/`eyes`/`nose`/`mouth`/`blush`/`tail`/`ground_shadow` 复用现有标签（spec §4 的继承表），所以 `buildBubbleOps`、面板、`SPRITE_DROPPED_LAYERS` 都不用跟着改。

- [ ] **Step 3: `girl.ts` 站姿**

创建 `src/renderer/pet/girl.ts`。骨架与配色照下面写，各部件的**路径数值按 `GIRL_PROPORTION` 推**（不许另起一套数）：

```ts
import type { CatInput } from "./art";
import { buildOverlayOps, badgeMapFor } from "./art";
import { arc, cubicTo, quadTo, ribbon } from "./xf";
import { matRoot, matJoint, toMap2, type Mat, type Map2 } from "./rig";
import type { DrawOp, PetLayer, Point2 } from "../../shared/draw-ops";
import { CAT_PALETTE, PAPER, ROSE, ROSE_DEEP, INK, INK_SOFT, ACCENT, GREEN, WARN, wash, withAlpha } from "../../shared/pet-tokens";
import type { CatCoat } from "../../shared/cat-coats";

export const GIRL_PROPORTION = {
  crown: 22, chin: 61, headCy: 41.5, headRx: 17, headRy: 19.5,
  eyeY: 44.5, eyeLx: 52, eyeRx: 68, eyeRr: 5.9, eyeRy: 6.6,
  shoulderY: 66, shoulderDx: 13, waistY: 79, hemY: 89, hemHalf: 16,
  kneeY: 93, footY: 100,
} as const;

export interface GirlPalette {
  skin: string; skinShade: string; hair: string; hairBot: string; hairEdge: string;
  earInner: string; dress: string; dressShade: string; apron: string;
  collar: string; bow: string; leg: string; shoe: string;
}

/**
 * 颜色继承（spec §4 表）：发色与尾巴吃 coat 的毛色三件套，皮肤与领结是全形态常量。
 * ⚠️ 一律 wash/withAlpha 派生，板外色一个都不许出现——`npm run palette:check` 会拦。
 */
export function girlPalette(coat: CatCoat): GirlPalette {
  return {
    skin: wash(ROSE, 26, PAPER),
    skinShade: wash(ROSE_DEEP, 46, PAPER_SHADE_LOCAL()),
    hair: coat.furTop, hairBot: coat.furBot, hairEdge: coat.furEdge,
    earInner: coat.earInner,
    dress: wash(ACCENT, 48, coat.light),
    dressShade: wash(INK, 26, wash(ACCENT, 48, coat.light)),
    apron: coat.light,
    collar: wash(INK, 55, PAPER),
    bow: wash(ROSE, 210, INK),
    leg: wash(INK_SOFT, 34, PAPER),
    shoe: INK,
  };
}
```

（`PAPER_SHADE_LOCAL()` 不是新 token——用 `PET_PRIVATE`? 不：直接用板内的 `PAPER_SHADE`，即 `wash(ROSE_DEEP, 46, PAPER_SHADE)`。上面那行是笔误提示，写成 `PAPER_SHADE` 并从 `pet-tokens` 导入。）

部件函数一律 `function xxx(m: Map2, p: GirlPalette, coat: CatCoat): DrawOp[]`，`m` 是该部件的**全局阵**（由骨架算好传入），内部只用 Task 4 之后的 `Map2` 口径助手（`xfEllipse/xfCircle/xfArc/xfPoly/xfFill/xfGrad`）。骨架：

```ts
function girlRig(input: PetInput & { s: number }): {
  hips: Mat; spine: Mat; head: Mat; armL: Mat; armR: Mat; handL: Mat; handR: Mat;
  legL: Mat; legR: Mat; tailRoot: Mat;
} {
  const root = matRoot(input.center, input.s);
  const hips = matJoint(root, { at: [60, GIRL_PROPORTION.waistY], rot: 0, sx: 1, sy: 1 });
  const spine = matJoint(hips, { at: [0, 0], rot: lean(input), sx: 1, sy: 1 });
  const head = matJoint(spine, {
    at: [0, GIRL_PROPORTION.headCy - GIRL_PROPORTION.waistY],
    rot: headTilt(input), sx: 1, sy: 1,
  });
  // 肩在脊柱空间 y=shoulderY；手臂挂肩，肘在臂末端再挂一节（P4 才用得上两节）
  const armL = matJoint(spine, { at: [-GIRL_PROPORTION.shoulderDx, GIRL_PROPORTION.shoulderY - GIRL_PROPORTION.waistY], rot: armSwing(input, "l"), sx: 1, sy: 1 });
  const armR = matJoint(spine, { at: [GIRL_PROPORTION.shoulderDx, GIRL_PROPORTION.shoulderY - GIRL_PROPORTION.waistY], rot: armSwing(input, "r"), sx: 1, sy: 1 });
  const handL = matJoint(armL, { at: [0, 22], rot: 0, sx: 1, sy: 1 });
  const handR = matJoint(armR, { at: [0, 22], rot: 0, sx: 1, sy: 1 });
  const legL = matJoint(root, { at: [-6, GIRL_PROPORTION.waistY], rot: 0, sx: 1, sy: 1 });
  const legR = matJoint(root, { at: [6, GIRL_PROPORTION.waistY], rot: 0, sx: 1, sy: 1 });
  const tailRoot = matJoint(root, { at: [10, GIRL_PROPORTION.hemY - 4], rot: 0, sx: 1, sy: 1 });
  return { hips, spine, head, armL, armR, handL, handR, legL, legR, tailRoot };
}
```

`lean/headTilt/armSwing` 在 P1 **恒返回 0**，但**必须写成从 `input` 取值的形式**：`lean = (i) => i.pose.tilt * 0.06`（猫娘的 tilt 只让上身微前倾 0.06 rad，头再单独歪），`headTilt = (i) => (i.pose.tilt * Math.PI / 180) + i.pose.engagement * 0.04`。这样 P2/P4 挂 `channels` 时只换实参，不动骨架结构。`tilt` 恒为 `TILT_DEG`（13）时头歪 13°、上身只带 0.78 rad? 不——`13 * 0.06 = 0.78` 是**弧度**，太大了；把系数写成 `0.006`（13°×0.006 = 0.078 rad ≈ 4.5°），并在测试里钉死：`expect(Math.abs(lean({ pose: { ...NEUTRAL.pose, tilt: 13 } }))).toBeLessThan(0.1)`。**这类「量纲要跳」的系数是本计划最容易犯的错，系数旁边必须跟一条角度上限断言。**

部件（每个都给出必须满足的数值判据，实现者按判据画；判据红就改路径，不许改判据）：

| 部件 | 画法 | 判据（写进 `girl.test.ts`） |
|---|---|---|
| `ground_shadow` | 与四足同式的椭圆，中心在脚线下方 `2·s` | `layer === "ground_shadow"` 恰 1 枚，`fill` 含 `rgba(0, 0, 0,` |
| `legs` | 两条 `ribbon(legPts, 6.4, 4.2)`，`legPts = quadTo([[∓6, 79], [∓7, 88], [∓6, 99]], 10)` | 2 条 `fillPath`，每条点数 ≥ 20（丝带含端帽） |
| `shoe`（并入 `legs` 层尾） | 两只 `xfEllipse` rx 4.4 ry 2.6 at (∓6, 99.5) | `legs` 层内出现 `fillEllipse` ≥ 2 |
| `tail` | 从 `tailRoot` 出发的 `ribbon(cubicTo([[0,0],[14,-6],[20,-24],[16,-44]], 24), 9, 4)`，渐变用 `coat.furTop→furBot`（`xfGrad`） | 恰 2 条（`tail` + `tail_tip`），`tail_tip` 的 `fill === PAPER`（与四足同口径：奶油尖不吃半透） |
| `dress` | 梯形 + 裙摆弧：`fillPath([[47,66],[73,66],[76,89],[44,89]])` 与 `arc(44,89, 60,94, 76,89, 10)` 拼成下摆 | 1 条 `fillPath` 点数 ≥ 12；`y` 最大点 ≤ 94.5 |
| `body`（胸颈） | `xfFill` 的 `fillGrad`：`ribbon(quadTo([[60,63],[60,72],[60,79]], 8), 12, 18)` 走 `coat` 之外的 `skin→skinShade` 渐变 | 1 条，`fill`/`stops` 里两个色都在 `girlPalette` 的取值集合内 |
| `arms` | `ribbon([[∓13,66],[∓15,76],[∓13,88]], 5.2, 3.4)` 经各自 `armL/armR` | 2 条 `fillPath`，`skin` 色 |
| `hands` | `xfCircle` r 3.6 at (∓13, 90) + 一枚 `strokePath` 袖口线（宽 1.2） | `hands` 层含 ≥1 条 `strokePath && width >= 1`（尺 #71 的这条判据由手承担，不只领口） |
| `collar` | `arc(53,64, 60,67, 67,64, 10)` 描边宽 2.2，色 `collar`；再加蝴蝶结：两枚三角形 `fillPath` + `xfCircle` r 2 at (60,66)，色 `bow` | `collar` 层 ≥ 4 条；蝴蝶结两翼必须关于 x=60 镜像（`x` 之和 = 120±0.6） |
| `ears` | 外耳 `fillPath([[48,26],[44,8],[56,22]])` 与其镜像，色 `hair`；内耳同式 ×0.55 向尖端收，色 `earInner` | 4 条（2 外 2 内）；外耳面积 > 内耳面积（逐对 `opsBounds` 比） |
| `hair_back` | `xfEllipse` at (60,44) rx 20.5 ry 22，色 `hair`（垫在头后，露出一圈发边） | 1 条，`rx > headRx`（发比头宽） |
| `hair_front` | 刘海：`fillPath` 由 3 枚 `arc` 扇片拼，覆盖 y 22..38、x 43..77 | ≥ 3 条 `fillPath`，每条 `points.length ≥ 8` |
| `ahoge` | `cubicTo([[60,22],[54,16],[50,20],[47,14]], 10)` 的 `strokePath`，宽 1.6 | 恰 1 条 `strokePath`，`width >= 1.5` |
| `brows` | `arc(48,37.5, 52,36, 56,37.5, 8)` ×2，色 `hairEdge`，宽 1.3 | 2 条；`tilt` 非 0 时两条的 `cy` 之和不等（随头歪） |
| `eyes`/`nose`/`mouth`/`blush` | **由 Task 10 的 `buildFaceOps` 承担**；本任务先按四足的同式在 `head` 阵上画眼白/瞳/高光/鼻/嘴/腮红，保证 P1 就能出完整一张脸 | 眼白 2 枚 `rx/ry = 5.9/6.6`；高光系数 0.30/0.15 各 2 枚 |
| `tear` | P1 不产出（恒空数组），但 `PetLayer` 标签已就位 | `expect(buildGirlOps({ ...NEUTRAL }).some((o) => o.layer === "tear")).toBe(false)` |

`buildGirlOps` 的组装（顺序即 ORDER，一条不多一条不少）：

```ts
export function buildGirlOps(input: PetInput): DrawOp[] {
  const coat = input.coat ?? CAT_COATS.ink;
  const p = girlPalette(coat);
  const s = input.u / 60.0;                       // 与 scaleFor 同口径：s = u/60
  const rig = girlRig({ ...input, s });
  const ops: DrawOp[] = [
    ...groundShadow(toMap2(matRoot(input.center, s)), input),
    ...legs(rig.legL, rig.legR, p),
    ...tail(toMap2(rig.tailRoot), coat, p),
    ...dress(toMap2(rig.spine), p),
    ...body(toMap2(rig.spine), p),
    ...arms(rig.armL, rig.armR, p),
    ...hands(rig.handL, rig.handR, p),
    ...collar(toMap2(rig.spine), p),
    ...ears(toMap2(rig.head), coat, p),
    ...hairBack(toMap2(rig.head), p),
    ...hairFront(toMap2(rig.head), p),
    ...ahoge(toMap2(rig.head), p),
    ...brows(toMap2(rig.head), p),
    ...face(toMap2(rig.head), input, coat),        // Task 10 换成 buildFaceOps
    ...tear(toMap2(rig.head), input),
    ...buildOverlayOps(input, badgeMapFor(input, 14, -22)),
  ];
  return ops;
}
```

（`badgeMapFor(input, 14, -22)`：胸口相对围兜上沿的 viewBox 偏移。这两个数在 Task 26 的屏幕尺上验一次——「未读牌子在猫娘身上不压到裙带、不出窗」。）

- [ ] **Step 4: `form.ts` 分派**

```ts
import { buildCatOps, type CatInput } from "./art";
import { buildGirlOps } from "./girl";
import type { PetForm } from "../../shared/pet-profile";
import type { DrawOp } from "../../shared/draw-ops";

/** P1 只多一条 `form` 轴；channels/face/profile 由 Task 14 追加，届时一并扩这里。 */
export type PetInput = CatInput & { form?: PetForm };

export const PET_BUILDERS: Record<PetForm, (i: PetInput) => DrawOp[]> = {
  cat: (i) => buildCatOps(i),
  girl: (i) => buildGirlOps(i),
};

export function buildPetOps(input: PetInput): DrawOp[] {
  return PET_BUILDERS[input.form ?? "cat"](input);
}
```

- [ ] **Step 5: 跑绿**

Run: `CI=true npx vitest run src/renderer/pet/girl.test.ts src/renderer/pet/art-golden.test.ts`
Expected: 全绿。`art-golden` 必须仍然逐字节相等——它证明新标签进 `PetLayer` 后四足一条没多。

- [ ] **Step 6: 变异验牙**

① 临时把 `GIRL_ORDER` 里 `dress` 与 `body` 的产出顺序对调，跑 `girl.test.ts`，Expected: FAIL（ORDER 锁红）。② 临时把 `girlPalette` 的 `bow` 换成十六进制字面量 `#ff0000`，跑 `CI=true npx vitest run src/renderer/pet/girl.test.ts && npm run palette:check`，Expected: 两条都红（token 追溯锁 + 色板门）。还原跑绿。

- [ ] **Step 7: 全量门 + 提交**

```bash
CI=true npx vitest run && npm run check:renderer && npm run check:main && npm run palette:check
git add src/shared/draw-ops.ts src/renderer/pet/girl.ts src/renderer/pet/form.ts src/renderer/pet/girl.test.ts
git commit -m "feat(pet): 猫娘站姿首版与形态分派（P1 Task 6）

10 个新图层标签只在 girl 形产出；buildPetOps 默认走四足，art-golden 逐字节证明。
发色/尾巴继承 coat，皮肤/领结走 wash 派生，palette:check 无新板外色。
变异验牙：调序红 ORDER 锁、换字面色红 token 追溯与 palette:check。"
```

---

## Task 7: 形态与档位入库存、进右键菜单

**Files:**
- Modify: `src/main/verge/verge-store.ts`（`VergeState`、`DEFAULT_VERGE_STATE`、`toState`）
- Modify: `src/main/verge/pet-menu.ts`（`PetMenuInput`、`buildPetMenuItems`）
- Modify: 菜单动作的装配点（`registerPetMenu`/`pet-menu` 的调用方——Step 1 先 grep 定位）
- Test: `src/main/verge/verge-store.test.ts`、`src/main/verge/pet-menu.test.ts`（追加）

**Interfaces:**
- Consumes: Task 1 的 `PET_FORMS`/`SIZE_TIERS`/`profileFor`
- Produces:
  - `VergeState` 增 `form: PetForm`、`tier: SizeTier`（默认 `"cat"`/`"standard"`）
  - `PetMenuInput` 增 `form`、`tier`
  - `PetMenuActions` 增 `setForm(form: PetForm): void`、`setTier(tier: SizeTier): void`
  - 形态/档位变更的下行广播（通道名 `verge:profile:update` 在 Task 17 才进 `ipc-channels.ts`；本任务先用已有的 `broadcast` 口以字符串常量发送，**但载荷必须当场就是一对字符串**（写成 `{ form: next.form, tier: next.tier }` 字面量即可，`profileRefOf` 到 Task 17 才有）——`profileFor` 整个对象带 `catScale` 方法，structured clone 对函数直接抛（Task 17 口径差⑦已实测），字符串常量只瞒过静态扫描器，瞒不过运行期。Task 17 把常量名换成 `IPC.VERGE_PROFILE_UPDATE`、把发送口换成 `applyProfileState`，并补进 `ipc-contract` 锁——这是同一次发布内的两步，中间不留半个未登记通道）

- [ ] **Step 1: grep 定位，别猜装配点**

```bash
cd /d/Test/workbuddy/cyrene-verge
grep -rn "buildPetMenuItems\|registerPetMenu\|PetMenuActions" src/main src/preload | head -20
grep -n "quietUntil\|tuckEnabled\|tuckHinted\|DEFAULT_VERGE_STATE\|toState" src/main/verge/verge-store.ts
```

把 `toState` 的**现有容错风格**照抄给新字段（它一定写成「非法值回落默认」而不是抛错——本期所有存量 `state.json` 里没有 `form`/`tier`，读盘不许炸）。

- [ ] **Step 2: 写失败测试**

`src/main/verge/verge-store.test.ts` 追加（用该文件已有的 `readVergeState`/`writeVergeState` 与临时目录 fixture，**照它的现有写法**，不要新造 harness）：

```ts
it("存量 state.json 没有 form/tier：读回落 cat/standard，写回补齐且不改别的字段", () => {
  // dir = 该测试既有的 tmp fixture
  writeFileSync(join(dir, "verge", "state.json"), JSON.stringify({ quietUntil: 123, tuckEnabled: true }));
  const s = readVergeState(dir);
  expect(s.form).toBe("cat");
  expect(s.tier).toBe("standard");
  expect(s.quietUntil).toBe(123);
  writeVergeState(dir, { ...s, form: "girl", tier: "large" });
  expect(readVergeState(dir)).toMatchObject({ form: "girl", tier: "large", tuckEnabled: true });
});

it("非法形态名与档位名一律回落默认（读盘不许抛错）", () => {
  const s = toState({ form: "goldfish", tier: 42 });
  expect(s).toMatchObject({ form: "cat", tier: "standard" });
});
```

`src/main/verge/pet-menu.test.ts` 追加：

```ts
it("菜单里形态两档 + 身形三档，当前项 checked=true 且组内只有一项被打勾", () => {
  const items = buildPetMenuItems({ quietUntil: 0, now: 0, tuckEnabled: true, form: "girl", tier: "large" });
  const forms = items.filter((i) => i.label.startsWith("形象"));
  const tiers = items.filter((i) => i.label.startsWith("身形"));
  expect(forms.map((i) => i.checked)).toEqual([false, true]);   // 猫 / 猫娘
  expect(tiers.map((i) => i.checked)).toEqual([false, false, true]);
  expect(forms.length + tiers.length).toBe(5);
  // 只在这两组里数勾——「贴边藏身」也带 checked（tuckEnabled:true），把它算进来这条就恒红。
  expect([...forms, ...tiers].filter((i) => i.checked).length).toBe(2);
});

it("勾了也不许变：setForm/setTier 没注入时这两组项 enabled=false", () => {
  const items = buildPetMenuItems({ quietUntil: 0, now: 0, tuckEnabled: true, form: "cat", tier: "standard" }, {});
  expect(items.filter((i) => i.label.startsWith("形象")).every((i) => i.enabled === false)).toBe(true);
});
```

**既有两条必须同轮重钉**（不动它们，本任务的 Step 2 跑绿时这两条就先红了）：

1. `:25-33` 的「只有『隐藏』带分隔线」——11 项数组变成 16 项，且新增的「形象：像素猫」带 `separatorBefore: true`（Step 3 的插入位）。重钉为：数组按新顺序全列（`"安静半小时", "取消安静", "贴边藏身", "摸摸头", "喂小鱼干", "陪它玩", "哄它睡觉", "它现在怎么样", "打开网络面板", "形象：像素猫", "形象：猫娘", 身形×3, "隐藏", "退出"`）——**身形三档标签里的尺寸数字别手抄进期望**，Step 3 已改成从 `profileFor(input.form, t).base` 取，测试期望值用同式现算拼串，例如 `` `身形：小巧 (${profileFor("cat", "small").base.width}×${profileFor("cat", "small").base.height})` ``（cat 三档＝70×92/82×108/100×132， spec §8 表；手抄字面值会在 Task 26 实测反钉 girl 几何后变成「广告与实物不符」的假对照）；分隔线集合重钉为 `["形象：像素猫", "隐藏"]`。
2. `:35-51` 的「动作只在提供时挂上」——fixture 的 actions 对象没有 `setForm/setTier`，新 5 项的 `action` 闭包 `() => actions.setForm?.(f)` 在 `item.action?.()` 下是**零调用安全**（optional call 落在 undefined 上不抛也不推 `calls`），所以 `calls` 的期望数组**保持 11 项不变**；把这条保持不变的原因写进该测试上方一行注释，省得后人以为漏改。

Run: `CI=true npx vitest run src/main/verge/verge-store.test.ts src/main/verge/pet-menu.test.ts`
Expected: FAIL（新字段/新项不存在）。

- [ ] **Step 3: 落实现**

`verge-store.ts`：`VergeState` 加 `form: PetForm; tier: SizeTier;`；`DEFAULT_VERGE_STATE` 加 `form: "cat", tier: "standard"`；`toState` 加两行按 `PET_FORMS.includes(...)` / `SIZE_TIERS.includes(...)` 的回落（**照该文件既有风格，非法值回落而不是抛**）。

`pet-menu.ts`：`PetMenuInput` 加 `form`/`tier`；`buildPetMenuItems(input, actions)` 在「它现在怎么样」之后、`隐藏`（分隔线项）之前插入 5 项 + 1 条分隔线，`separatorBefore: true` 挂在第一组首项：

```ts
  ...PET_FORMS.map((f) => ({
    label: f === "cat" ? "形象：像素猫" : "形象：猫娘",
    checked: input.form === f,
    enabled: !!actions.setForm,
    action: () => actions.setForm?.(f),
  })),
  ...SIZE_TIERS.map((t) => ({
    label: t === "small" ? "身形：小巧 (70×92)" : t === "standard" ? "身形：标准 (82×108)" : "身形：大 (100×132)",
    checked: input.tier === t,
    enabled: !!actions.setTier,
    action: () => actions.setTier?.(t),
  })),
```

标签里的尺寸数字必须**从 `profileFor(form, t).base` 取**，不写字面量：

```ts
label: `身形：${t === "small" ? "小巧" : t === "standard" ? "标准" : "大"} (${profileFor(input.form, t).base.width}×${profileFor(input.form, t).base.height})`,
```

（写死 `(70×92)` 会在 Task 26 实测反钉 `FORM_GEOMETRY.girl` 之后变成界面假话——「广告出来的文案就是承诺」。）

装配点里：`setForm/tier` 的动作＝`writeVergeState` → `broadcast("verge:profile:update", { form: next.form, tier: next.tier })` → 让宠物窗按新基址重算（Task 14/17/27 接窗；本任务只保证**落盘 + 广播**这两步存在，并有测试断言 `broadcast` 被调到一次、载荷**逐字等于** `{ form, tier }` 这两个键）。测试期望这么写：`expect(broadcast).toHaveBeenCalledWith("verge:profile:update", { form: "girl", tier: "large" })`——**不许**写成 `profileFor(...)`，那会把带方法的对象固化成期望值，而 Task 17 已经实测过这种载荷在发送侧就抛（`structuredClone({catScale}) → DOMException: could not be cloned`）。载荷键名集合也钉一条：`expect(Object.keys(payload).sort()).toEqual(["form","tier"])`。

- [ ] **Step 4: 跑绿 + 提交**

```bash
CI=true npx vitest run src/main/verge && npm run check:main
git add src/main/verge/verge-store.ts src/main/verge/pet-menu.ts src/main/verge/verge-store.test.ts src/main/verge/pet-menu.test.ts
git commit -m "feat(pet): 形态与档位入 verge/state.json 并进右键菜单（P1 Task 7）

存量 state 无 form/tier 时读盘回落 cat/standard，不抛错。
菜单标签的尺寸数字来自 profileFor，不写字面量（界面文案是承诺）。"
```

---

## Task 8: P1 收口门——四足逐像素不变 + 猫娘上屏

**Files:**
- 无新增；只跑门与截图对照，必要时提交修复

- [ ] **Step 1: 全量测试与门**

```bash
CI=true npx vitest run
npm run check:main && npm run check:preload && npm run check:renderer
npm run check:brand && npm run check:roster
npm run palette:check && npm run palette:migrate:check
npm run check:sprites
```

Expected: 全绿。`check:sprites` 绿是关键证据——本阶段没动位图清单，146 张资产仍与盘上字节一致。若红，先怀疑 `cat-variants.ts` 被误动（Task 6 不该碰它）。

- [ ] **Step 2: 四逐静帧逐字节对照**

```bash
git diff --stat HEAD~7..HEAD -- src/renderer/pet/art.ts src/renderer/pet/companion.ts src/renderer/pet/renderer.ts
```

Expected: `companion.ts` 的 diff 行数**为 0**；`renderer.ts` 的 diff **只许是 Task 6 声明的那两行**（`buildPetOps` 派发 + `this.cat` 补 `form: "cat"`）——多出来的任何一行都是越界，回退或挪到 Task 14。核对方式：`git diff HEAD~7..HEAD -- src/renderer/pet/renderer.ts` 逐行读，别只看 `--stat`。`art.ts` 允许改动，但 `art-golden` 六条逐字节相等就是它的验收。

- [ ] **Step 3: 屏幕对照（临时切 form，不留默认值改动）**

启动带调试开关的实例，用 `--form=girl --tier=large` 这类**仅本进程生效**的覆盖（若 `pet-menu` 的落盘方式更适合，就先用菜单切、截完再切回 `cat/standard`；**不许**在此任务改默认值）。抓两张 PNG 到 `D:\Test\workbuddy\cyrene-verge\docs\verge\shots\v1.5.0-p1\`：`cat-standard.png`、`girl-large.png`。

判据（人眼 + `--check` 式量化各一条）：
1. 猫娘在 `large` 档完整不出窗（截图里身体不被切）；
2. 猫娘 `standard` 档**允许**读起来偏弱（74 px 的图吃不动细线是已知美术约束），但**不许**缺部件——五种颜色类以上可见（用 `scripts/` 里现成的像素取样脚本或 `overlay.test.ts` 的 `coverageByColor` 同式在截图上复核：`≥6` 个颜色类各 `≥300` 设备像素）；
3. `cat-standard.png` 与 P1 之前的同场景截图逐像素相同（用 `git stash` 前的旧图或 `--check` 里的对照机制；拿不到旧图就明确写「本条以 art-golden 的逐 op 相等替代，屏幕层未复核」——**不许把没验的说成验过**）。

- [ ] **Step 4: 收口提交（若 Step 3 逼出修复）**

```bash
git add -A docs/verge/shots/v1.5.0-p1 src/renderer/pet
git commit -m "test(pet): P1 收口——四足逐字节不变、猫娘三型上屏对照（Task 8）"
```

- [ ] **Step 5: 台账**

在 `docs/verge/notes/progress.md` 记下（本任务时该文件可能尚不存在——**本任务创建它**，文件头写「v1.5.0 猫娘期台账，Task 28 全部回写进 spec §13」；之后各任务的台账都进这一份，不再另起文件）：六条门的实际输出、Step 3 三张判据各自「验了/没验」的结论、以及任何被推后的项（推后必须写「推后到 Task N」，不许只写「以后」）。

---

## 与 spec 的口径差台账（①–④ 在此，⑤–⑱ 记在各自任务里，Task 28 全部回写进 spec）

以下几条是执行期确定的实现口径，与 spec 的字面写法不同，**不是重新设计**。①–④ 是 P1 的骨架口径；⑤–⑱ 在各自任务正文里记账（⑤ 见 Task 16 的「被否决的三个状态源」与 `character-status-moods` 那一行，⑥ Task 16 提醒的起止，⑦ Task 17 的 structured clone，⑧ Task 13 的 `bubbleKey`，⑨ Task 18 的 已处理 表情，⑩ Task 18 的 提醒 深链，⑪ Task 18 的 #74 证据链，⑫ Task 13 的手势种子数，⑬ Task 19/20 的粒子非第四层，⑭ Task 19 的闲置表按 form 作用域，⑮ Task 22 的触摸六类反应按 form 作用域＋双击→玩退役，⑯ Task 24/25 的取景与覆盖带按 form 分列（icons 支路不翻），⑰ Task 27 的几何兜底与产品默认分层，⑱ Task 26 的 `getHitAreaDefs` 复活与诊断口扩读数）：

1. **`Map2` 除 `map` 外还有 `scaleX()/scaleY()/k()`**（spec §3.1 只写了 `{ map(p): Point2 }`）。理由：绘图助手要椭圆半径与线宽，只给 `map` 就得把 `sx/sy` 泄露回助手层，接口放宽等于没放宽。
2. **`Joint` 用全局落点 `(gx, gy)` 而不是 `dx/dy`**，`matFromJoint(j, pivot)` 的参数序也反了（spec §3.1 写 `matFromJoint(pivot, j)`）。理由：骨架要能直接说「肩在 viewBox (47, 66)」，靠 `dx/dy` 增量表达不了「摆到这一点」，会在每一节关节上多算一次累计偏移。
3. **`buildPetOps(input)` 从 `input.form` 取形态**（spec §3.4 写 `buildPetOps(form, input)` 两参）。理由：`PetInput` 本来就有 `form` 字段，两处都给就要另加一条「谁赢」的规则；单一来源省掉一类永远对不齐的 bug。
4. **`applyCompanionPose` 拆成两条而不是整体取代**（spec §3 写「四层合成取代 `applyCompanionPose`」）。理由：R-D2 要求四足在 P1–P4 全程逐像素不变，而 `applyCompanionPose` 现在是四足姿态的**唯一**生产者——直接删掉它，四足会在 P2 就失去 `pose.walk/squash/tilt` 的来源，Task 23 的门必然红。做法是 `applyCatPose`（现有 15 行逐字保留，`form === "cat"` 时生效）＋`applyLayerPose`（四层合成，`form === "girl"` 时生效），`draw()` 按 form 分派。spec 点名的缺陷「一条正弦包络管七个动作」（`renderer.ts:691`）在猫娘这条路上被真正消掉；四足那条留着，是因为它已经和 12 张位图、~70 把屏幕尺绑死了，本期不动它才是对 R-D2 的兑现。

除上述口径差之外，spec §3 的接口名、§4 的 ORDER、§5 的权重与仲裁、§6 的清单、§7 的钩子表、§8 的档位表、§10 的四把尺与五条变异**逐字照做**。

---

## Task 9: `face.ts` — 16 档表驱动差分

**Files:**
- Create: `src/renderer/pet/face.ts`
- Test: `src/renderer/pet/face.test.ts`

**Interfaces:**
- Consumes: `Mood`（`art.ts`）、`CatCoat`、`pet-tokens`
- Produces:
  - `type Expression = "neutral" | "happy" | "wink" | "love" | "shy" | "surprised" | "angry" | "sad" | "sleepy" | "thinking" | "smug" | "pout" | "worried" | "excited" | "cry" | "confused"`（spec §3.2 原文 16 档，顺序即此序）
  - `interface FaceParams { lidL: number; lidR: number; eyeOpen: number; pupil: [number, number]; brow: number; browTilt: number; mouth: number; mouthWide: number; blush: number; tear: number; sweat: number; star: number }`
  - `interface FaceCtx { t: number; blink: number; mouse: [number, number] | null; energy: number; speaking: boolean }`
  - `const FACE_REST: FaceParams`
  - `faceOf(expr: Expression, ctx: FaceCtx): FaceParams`
  - `const MOOD_TO_EXPRESSION: Record<Mood, Expression>`（`idle→neutral`、`happy→happy`、`thinking→thinking`、`grumpy→angry`、`sleep→sleepy`，其余按 §6 六档表补）
  - `const EXPRESSIONS: readonly Expression[]`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from "vitest";
import { EXPRESSIONS, FACE_REST, MOOD_TO_EXPRESSION, faceOf, type FaceCtx, type Expression } from "./face";

const CTX: FaceCtx = { t: 0, blink: 0, mouse: null, energy: 1, speaking: false };
/** 12 个可比的标量/向量通道，键名与 FaceParams 逐字一致（`browTilt`，不是 `brotTilt`；pupil 按数组比）。 */
const KEYS: Array<keyof FaceParams> =
  ["lidL", "lidR", "eyeOpen", "pupil", "brow", "browTilt", "mouth", "mouthWide", "blush", "tear", "sweat", "star"];

describe("16 档表情差分表", () => {
  it("16 档，名字与 spec §3.2 逐字一致", () => {
    expect(EXPRESSIONS).toHaveLength(16);
    expect([...EXPRESSIONS].sort()).toEqual(
      ["neutral", "happy", "wink", "love", "shy", "surprised", "angry", "sad",
       "sleepy", "thinking", "smug", "pout", "worried", "excited", "cry", "confused"].sort(),
    );
  });

  it("纯函数：同 ctx 连调两次逐字段相等；ctx.t 不参与（相位归 clip）", () => {
    for (const e of EXPRESSIONS) {
      expect(faceOf(e, CTX), e).toEqual(faceOf(e, CTX));
      expect(faceOf(e, { ...CTX, t: 1234.5 })).toEqual(faceOf(e, CTX));
    }
  });

  it("每档与任一其它档至少差 3 个通道（尺 #72 的单位层）", () => {
    const rows = EXPRESSIONS.map((e) => faceOf(e, CTX));
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const diff = KEYS.filter((k) => !same(rows[i][k], rows[j][k])).length;
        expect(diff, `${EXPRESSIONS[i]} vs ${EXPRESSIONS[j]} 只差 ${diff} 通道`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("闭眼档必须真的闭（lid 到 1），wink 必须两眼不等", () => {
    expect(faceOf("sleepy", CTX).lidL).toBeGreaterThanOrEqual(0.9);
    expect(faceOf("wink", CTX).lidL).not.toBe(faceOf("wink", CTX).lidR);
    expect(faceOf("neutral", CTX).lidL).toBeLessThan(0.2);
  });

  it("泪与汗只在有它们的档出现，其余档恒为 0（防「每档都挂一滴」）", () => {
    expect(faceOf("cry", CTX).tear).toBeGreaterThan(0);
    expect(faceOf("worried", CTX).sweat).toBeGreaterThan(0);
    for (const e of EXPRESSIONS.filter((x) => x !== "cry" && x !== "sad")) {
      expect(faceOf(e, CTX).tear, e).toBe(0);
    }
  });

  it("blink 只压 lid，不改任何别的通道（死通道复活的入口条件）", () => {
    const open = faceOf("happy", CTX);
    const mid = faceOf("happy", { ...CTX, blink: 0.6 });
    expect(mid.lidL).toBeCloseTo(Math.max(open.lidL, 0.6), 6);
    for (const k of KEYS.filter((x) => x !== "lidL" && x !== "lidR")) expect(mid[k]).toEqual(open[k]);
  });

  it("gaze：mouse 给了才追，没给时按 t 漂移（原 art.ts:330 的兜底口径）", () => {
    expect(faceOf("neutral", { ...CTX, mouse: [10, 60] }).pupil).not.toEqual(FACE_REST.pupil);
    expect(faceOf("neutral", CTX).pupil).toEqual(FACE_REST.pupil);
  });

  it("Mood 五档各有归属，且不许出现未定义（TypeScript 已经管住，这条管的是语义不撞车）", () => {
    expect(MOOD_TO_EXPRESSION.idle).toBe("neutral");
    expect(MOOD_TO_EXPRESSION.sleep).toBe("sleepy");
    expect(MOOD_TO_EXPRESSION.grumpy).toBe("angry");
    expect(new Set(Object.values(MOOD_TO_EXPRESSION)).size).toBeGreaterThanOrEqual(4);
  });
});

function same(a: unknown, b: unknown): boolean {
  return Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((v, i) => v === b[i]) : a === b;
}
```

- [ ] **Step 2: 跑红（缺实现，不是缺测试）**

Run: `CI=true npx vitest run src/renderer/pet/face.test.ts`
Expected: FAIL —— `Cannot find module './face'`（或具名导入报 `EXPRESSIONS` 未导出）。**这一条红必须是「缺实现」**：若红在 `browTilt` 类型错、16 名单对不上、`same` 未定义这类测试自身的错，先修测试到只剩缺实现那一条红，再往下——否则 Step 5 的绿证明不了任何事。

- [ ] **Step 3: 写实现（差分表照抄，数值不许「顺手调」）**

```ts
export const FACE_REST: FaceParams = {
  lidL: 0, lidR: 0, eyeOpen: 1, pupil: [0, 0], brow: 0, browTilt: 0,
  mouth: 0.35, mouthWide: 0.55, blush: 0, tear: 0, sweat: 0, star: 0,
};

/**
 * 差分表：每档只写**与 FACE_REST 不同的通道**，其余用 `...FACE_REST` 兜。
 * 这张表的判据是尺 #72（成对像素差 ≥0.005）与单位层的「≥3 通道不等」，
 * 所以调任何一档都要想清楚它跟谁撞了。
 */
const TABLE: Record<Expression, Partial<FaceParams>> = {
  neutral: {},
  happy: { mouth: 0.85, mouthWide: 0.75, blush: 0.35, brow: 0.12 },
  wink: { lidR: 1, mouth: 0.7, mouthWide: 0.6, blush: 0.2, brow: 0.1 },
  love: { mouth: 0.9, mouthWide: 0.5, blush: 0.8, brow: 0.2, eyeOpen: 1.05, pupil: [0, -0.3] },
  shy: { lidL: 0.35, lidR: 0.35, mouth: 0.1, mouthWide: 0.4, blush: 1, brow: -0.15, browTilt: 0.4, pupil: [-0.8, 0.5] },
  surprised: { eyeOpen: 1.35, mouth: -0.35, mouthWide: 0.35, brow: 0.55, lidL: 0.05, lidR: 0.05 },
  angry: { eyeOpen: 0.75, brow: -0.5, browTilt: -0.85, mouth: -0.25, mouthWide: 0.45, blush: 0.15 },
  sad: { eyeOpen: 0.85, brow: 0.3, browTilt: 0.6, mouth: -0.45, mouthWide: 0.4, pupil: [0, 0.6], tear: 0.35 },
  sleepy: { lidL: 0.92, lidR: 0.92, eyeOpen: 0.5, mouth: 0.15, mouthWide: 0.3, brow: -0.1, pupil: [0, 0.8] },
  thinking: { pupil: [0.75, -0.55], lidL: 0.2, mouth: 0.1, mouthWide: 0.3, brow: 0.25, browTilt: -0.3, star: 0 },
  smug: { mouth: 0.6, mouthWide: 0.7, lidL: 0.25, brow: 0.2, browTilt: -0.45, blush: 0.25, eyeOpen: 0.9 },
  pout: { mouth: -0.7, mouthWide: 0.3, brow: 0.4, browTilt: 0.5, blush: 0.4, eyeOpen: 0.9, lidL: 0.15, lidR: 0.15 },
  worried: { brow: 0.5, browTilt: 0.75, mouth: -0.15, mouthWide: 0.35, sweat: 1, eyeOpen: 1.05, pupil: [0, -0.4] },
  excited: { eyeOpen: 1.25, mouth: 0.95, mouthWide: 0.85, brow: 0.45, blush: 0.5, star: 0.6, pupil: [0, -0.2] },
  cry: { lidL: 0.55, lidR: 0.55, brow: 0.6, browTilt: 0.8, mouth: -0.6, mouthWide: 0.5, tear: 1, blush: 0.5 },
  confused: { pupil: [-0.6, 0.2], brow: 0.35, browTilt: -0.7, mouth: 0.05, mouthWide: 0.3, sweat: 0.45, lidR: 0.3 },
};

export function faceOf(expr: Expression, ctx: FaceCtx): FaceParams {
  const base: FaceParams = { ...TABLE[expr], pupil: [...(TABLE[expr].pupil ?? FACE_REST.pupil)] } as FaceParams;
  const fp: FaceParams = { ...FACE_REST, ...base };
  // blink 只压 lid：这是原 CatInput.blink 的语义，不许顺手改嘴。
  fp.lidL = Math.max(fp.lidL, ctx.blink);
  fp.lidR = Math.max(fp.lidR, ctx.blink);
  // gaze 只在睁着的时候追；闭眼时给余量而不是抢通道。
  if (ctx.mouse && fp.lidL < 0.6) {
    const [mx, my] = ctx.mouse;
    fp.pupil = [clampUnit(mx), clampUnit(my)];
  }
  return fp;
}
```

（`clampUnit(v)` 把 `−1..1` 之外的量折回 `±0.9`，**别用 `Math.min/max` 之外的映射**；`MOOD_TO_EXPRESSION` 与 `EXPRESSIONS` 按上面 Produces 的原文写。）

- [ ] **Step 4: 跑绿 + 变异验牙**

Run: `CI=true npx vitest run src/renderer/pet/face.test.ts`
Expected: PASS。
变异：临时把 `smug` 的整行改成 `wink` 的内容，Expected: FAIL 且**点名的正是那一对**（尺子要能报「谁撞了谁」，只报「有个红」不算有牙）。还原跑绿。

- [ ] **Step 5: 提交**

```bash
npm run check:renderer
git add src/renderer/pet/face.ts src/renderer/pet/face.test.ts
git commit -m "feat(pet): 16 档表情差分表与 faceOf（P2 Task 9）

表驱动、纯函数、ctx.t 不参与——相位归 clip（R-D9）。
blink 只压 lid、gaze 只在睁眼时追，两条各有断言。
变异验牙：把 smug 写成 wink 时 ≥3 通道锁点名该对变红。"
```

---

## Task 10: `buildFaceOps` — 把差分表画成图元

**Files:**
- Modify: `src/renderer/pet/face.ts`
- Test: `src/renderer/pet/face.test.ts`（追加一个 `describe`）

**Interfaces:**
- Consumes: Task 2 的 `Map2`、Task 4 后的助手、`GIRL_PROPORTION`（Task 6）、`CatCoat`
- Produces: `buildFaceOps(fp: FaceParams, head: Map2, s: number, coat: CatCoat, u: number): DrawOp[]`（比 spec 多一个 `u`：眼白半径按 `u` 走才与四足同口径，见 Step 3）

- [ ] **Step 1: 追加失败测试**

```ts
describe("buildFaceOps", () => {
  const head = toMap2(matRoot({ x: 41, y: 43 }, 37 / 60));
  const s = 37 / 60;
  const mk = (e: Expression) => buildFaceOps(faceOf(e, CTX), head, s, CAT_COATS.ink, 37);

  it("层顺序与 ORDER 的尾段一致：brows → eyes → nose → mouth → blush → tear", () => {
    const kinds = mk("cry").map((o) => o.layer).filter((l, i, a) => a.indexOf(l) === i);
    expect(kinds).toEqual(["brows", "eyes", "nose", "mouth", "blush", "tear"]);
  });

  it("眼白半径沿用四足的 5.9/6.6 × s，高光系数仍是 0.30/0.15（这条锁两形态共用）", () => {
    const whites = mk("neutral").filter((o) => o.layer === "eyes" && o.kind === "fillEllipse" && o.fill === "#f7f4ec");
    expect(whites).toHaveLength(2);
    for (const w of whites) {
      expect(w.rx).toBeCloseTo(5.9 * s * 1.055, 6);
      expect(w.ry).toBeCloseTo(6.6 * s * 0.925, 6);
    }
    const gloss = mk("neutral").filter((o) => o.layer === "eyes" && o.kind === "fillEllipse" && String(o.fill).startsWith("rgba(247, 244, 236"));
    expect(gloss).toHaveLength(4);
    expect(gloss[0].rx).toBeCloseTo(whites[0].rx * 0.30, 9);
    expect(gloss[1].rx).toBeCloseTo(whites[0].rx * 0.15, 9);
  });

  it("eyeOpen 只纵向开口，不许把横向也拉走（惊讶读成斗鸡眼的根因）", () => {
    const open = mk("neutral"), sur = mk("surprised");
    const rx = (ops: DrawOp[]) => ops.filter((o) => o.layer === "eyes" && o.kind === "fillEllipse")[0].rx;
    const ry = (ops: DrawOp[]) => ops.filter((o) => o.layer === "eyes" && o.kind === "fillEllipse")[0].ry;
    expect(rx(sur)).toBeCloseTo(rx(open), 6);
    expect(ry(sur)).toBeGreaterThan(ry(open) * 1.2);
  });

  it("lid 是真的盖住：闭眼档必须产出一条横过眼白的描边或矩形，且开口高度趋 0", () => {
    const shut = mk("sleepy").filter((o) => o.layer === "eyes");
    expect(shut.some((o) => o.kind === "strokePath")).toBe(true);
    const whites = shut.filter((o) => o.kind === "fillEllipse");
    for (const w of whites) expect(w.ry).toBeLessThan(6.6 * (37 / 60) * 0.25);
  });

  it("tear 双色：内芯比外晕深，且都压在皮肤上——画在身外的记号一笔软墨等于没画", () => {
    const tear = mk("cry").filter((o) => o.layer === "tear");
    expect(tear.length).toBeGreaterThanOrEqual(2);
    expect(luminance(String(tear[0].fill))).toBeLessThan(luminance(String(tear[1].fill)));
  });

  it("sweat/star/blush 各自只在自己的层与档位出现；neutral 一条都不多", () => {
    expect(mk("neutral").filter((o) => o.layer === "tear")).toHaveLength(0);
    expect(mk("worried").some((o) => o.layer === "eyes" || o.layer === "brows")).toBe(true);
    expect(mk("neutral").some((o) => String(o.fill ?? "").includes(String(WARN)))).toBe(false);
  });

  it("无 text 图元（R-D10 对位：星与汗用 fillEllipse/fillPath 画，不许写字符）", () => {
    for (const e of EXPRESSIONS) expect(mk(e).some((o) => o.kind === "text")).toBe(false);
  });

  it("正对照：`star` 通道为 0 时不许出星星，为 0.6 时必须出（防恒真）", () => {
    expect(mk("excited").some((o) => o.layer === "eyes" && o.points !== undefined)).toBe(true);
    const noStar = buildFaceOps({ ...faceOf("excited", CTX), star: 0 }, head, s, CAT_COATS.ink, 37);
    const withStar = buildFaceOps({ ...faceOf("excited", CTX), star: 0.6 }, head, s, CAT_COATS.ink, 37);
    expect(JSON.stringify(noStar)).not.toBe(JSON.stringify(withStar));
  });
});
```

Run: `CI=true npx vitest run src/renderer/pet/face.test.ts`
Expected: FAIL — `buildFaceOps` 未导出。

- [ ] **Step 2: 实现**

按 §3.2 的纪律「眼本体从四足原样搬」：`buildFaceOps` 里眼白/瞳/高光的**半径算式与 `art.ts:322-357` 逐字同形**，只把 `xf` 换成传入的 `head: Map2`、把 `p.eyes.*` 的锚换成 `GIRL_PROPORTION.eyeY/eyeLx/eyeRx`。新增三条：

```ts
  // 眉：两条 arc，横向随 head 阵走（歪头时两眉不同高，与四足「两眼不同高」同判据）
  const browArc = (side: -1 | 1) => xfArc(
    arc(60 + side * 8 - 4, GIRL_PROPORTION.eyeY - 6.5 - fp.brow * 3,
        60 + side * 8,        GIRL_PROPORTION.eyeY - 7.5 - fp.brow * 3 + fp.browTilt * side * 2.2,
        60 + side * 8 + 4,    GIRL_PROPORTION.eyeY - 6.5 - fp.brow * 3, 8),
    head, coat.furEdge, 1.3 * head.k(),
  );

  // 泪：内芯 EYE 外晕 withAlpha(EYE, .35)，与 #69 的双色口径一致
  // 汗/星：贴在头侧/头顶的小 fillEllipse + 一条 strokePath，色分别用 WARN 与 GREEN 的板内派生
```

（`coat.furEdge` 而不是 `hairEdge`——眉毛颜色跟发色同源，`girlPalette` 已把它导出为 `hairEdge`，此处直接吃 `coat.furEdge` 就不用再引 palette，少一条耦合。⚠️ 判据 `luminance(core) < luminance(halo)` 里内芯是 `EYE`（最暗），外晕是它的半透——**顺序不能颠倒**，`ops.test.ts:93` 与 `art.test.ts:60-70` 都按「先晕后芯」的绘制序断过。）

- [ ] **Step 3: 接进 `girl.ts`**

把 Task 6 里的 `face(...)` 换成 `...buildFaceOps(faceOf(expr, ctx), toMap2(rig.head), s, coat, u)`，其中 `expr = MOOD_TO_EXPRESSION[input.mood]`、`ctx = { t: input.t, blink: input.blink, mouse: input.mouse, energy: input.energy, speaking: false }`。`tear` 层自此真的有产出（`cry`/`sad` 时）。

Run: `CI=true npx vitest run src/renderer/pet/girl.test.ts src/renderer/pet/face.test.ts`
Expected: 全绿。`girl.test.ts` 里「`tear` P1 不产出」那条**此时应删掉**——它在 P1 是「还没接」的占位断言，接上之后留着就是自我麻痹（删的时候在提交信息里写明是哪条、为什么删）。

- [ ] **Step 4: 变异验牙**

① 把泪的两枚颜色写成同色，Expected: FAIL（`tear 双色` 红）。② 把 `eyeOpen` 同时乘进 `rx`，Expected: FAIL（`eyeOpen 只纵向` 红）。还原跑绿。

- [ ] **Step 5: 提交**

```bash
npm run check:renderer && npm run palette:check
git add src/renderer/pet/face.ts src/renderer/pet/face.test.ts src/renderer/pet/girl.ts src/renderer/pet/girl.test.ts
git commit -m "feat(pet): buildFaceOps 把差分表画成图元并接进猫娘（P2 Task 10）

眼本体算式与四足 art.ts:322-357 同形（两形态共用一条锁）；新增 brows/tear 两层。
泪走双色、外晕先内芯后，与 #69 的口径一致。
变异验牙：同色泪 / eyeOpen 拉横向 各红一条。"
```

---

## Task 11: 尺 #72 — 表情可分辨矩阵（16×15 成对像素差）

**Files:**
- Create: `src/shared/min-pixel-diff.ts`（阈值与差度量的单一来源）
- Create: `src/renderer/pet/face-distinguishability.test.ts`
- Modify: `scripts/build/cat-sprites.mjs`（删掉私有 `const MIN_PIXEL_DIFF` 与 `pixelDiffRatio`，改读 bundle 出口）
- Modify: `src/renderer/pet/cat-sprite-manifest.ts:22`（re-export 那行加两项）
- Test: `src/shared/min-pixel-diff.test.ts`

**Interfaces:**
- Consumes: Task 9 的 `faceOf`/`EXPRESSIONS`、Task 10 的 `buildFaceOps`、Task 2 的 `toMap2`/`matRoot`
- Produces:
  - `const MIN_PIXEL_DIFF = 0.005`、`pixelDiffRatio(a: RasterLike, b: RasterLike): number`（`RasterLike = { width: number; height: number; rgba: Uint8Array }`，与 `sprite-raster.ts:13-17` 的 `Raster` 结构同形，用结构类型而不是 import 类型是因为构建脚本与测试要能各自喂 raster 或 bundle 出口的对象）
  - `src/renderer/pet/face-distinguishability.test.ts`（尺 #72；无生产出口，Task 26/#71 与 Task 27 都不消费它）

**栅格化在哪儿跑（已核实，2026-10-24，不再是开放问题）：** 这把尺是**栅格化**的，而 `ops.ts` 的 `paintOps` 走浏览器 canvas，在 `node`/vitest 环境下没有 2D context。仓库里已经有一条纯 JS 的 rasterize 通路——`src/shared/sprite-raster.ts:29` 的 `renderOps(ops, width, height, opts)`（软件光栅化器，预乘 alpha 累积缓冲，`ss` 默认 2），而且**它现在就在测试里被直接调用**：`src/renderer/pet/cat-sprite-manifest.test.ts:2` 与 `:30` 就是 `import { renderOps } from "../../shared/sprite-raster"` 后当场栅格化再量覆盖度/质心。所以本任务用**像素路线**，spec §10 的判据（≥ `MIN_PIXEL_DIFF`）原样落地，不降级成几何指纹——几何指纹低于 spec 的判据，采用它等于造一把比要求更哑的尺（`project-false-green-locks`：哑尺比没尺更危险）。

`MIN_PIXEL_DIFF` 的单一来源：现值 `0.005` 住在 `scripts/build/cat-sprites.mjs:20`，是**模块内 `const`、没有 export**（核实于 2026-10-24：`grep -n "^export" scripts/build/cat-sprites.mjs` 无输出，且 `scripts/build/min-pixel-diff*` 不存在）。测试不许 import 一个 `scripts/` 里的私有常量，也不许抄第二个数——抄了就有两份阈值要人肉对齐。本任务把它抽成 `src/shared/min-pixel-diff.ts`（连同 `:18-19` 那条实测注释一起搬），由 `cat-sprite-manifest.ts:22` 那行 re-export 一起出口（该文件已经是构建脚本的**唯一** esbuild 入口，`cat-sprites.mjs:24-25` 的注释专门交代过「别在脚本里再手抄一份目标表」，同一个理由适用于同一个阈值），`cat-sprites.mjs` 改读 `m.MIN_PIXEL_DIFF`。这样资产门的「6 档最小 3.29%、25 档最小 1.16%」实测余量与表情尺认的是同一个数。

- [ ] **Step 0: 先写阈值的搬移（红在门那里，不红在表情那里）**

`src/shared/min-pixel-diff.ts`：

```ts
import type { Raster } from "./sprite-raster";

/**
 * 两张图至少要有这么多比例的像素不同，才算「不是同一张图」。
 * 实测量：同一只猫的 6 档最小 3.29%，25 档散点最小 1.16%（都是 256²），带留两倍余量。
 * （注释与数值逐字搬自 scripts/build/cat-sprites.mjs:18-20——那边原来是模块内 const、没 export，
 *  本文件接手后它改读 bundle 出口。资产门与尺 #72 认同一个阈值，两份数表迟早对不齐。）
 */
export const MIN_PIXEL_DIFF = 0.005;

export function pixelDiffRatio(a: Raster, b: Raster): number {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`尺寸不同无法比：${a.width}×${a.height} vs ${b.width}×${b.height}`);
  }
  let n = 0;
  for (let i = 0; i < a.rgba.length; i += 4) {
    if (
      a.rgba[i] !== b.rgba[i] ||
      a.rgba[i + 1] !== b.rgba[i + 1] ||
      a.rgba[i + 2] !== b.rgba[i + 2] ||
      a.rgba[i + 3] !== b.rgba[i + 3]
    ) {
      n += 1;
    }
  }
  return n / (a.width * a.height);
}
```

那句尺寸校验是**新增**的（`cat-sprites.mjs:49-62` 原版没有，因为它只在同尺寸的两条 target 之间比）。尺 #72 会拿 `82×108` 与 `100×132` 两种档做对照（Task 27），静默比两张不同尺寸的图得到的比例毫无意义——这种比值比抛错更难查。配套 `src/shared/min-pixel-diff.test.ts` 三条：同图零差、单像素改动 `= 1/(w·h)`、尺寸不等抛错。

`scripts/build/cat-sprites.mjs`：删 `:18-20` 的 const 与 `:49-62` 的函数，`render()`/`pairDistinct()` 改读 `m.MIN_PIXEL_DIFF`、`m.pixelDiffRatio`；`cat-sprite-manifest.ts:22` 的 re-export 那行加上这两项。跑 `npm run check:sprites` 必须仍然全绿——**这条就是这次搬移的等价证明**：判据一字未改，只是换了住的地方。

- [ ] **Step 1: 写尺（含正对照与点名）**

```ts
import { describe, expect, it } from "vitest";
import { EXPRESSIONS, buildFaceOps, faceOf, type FaceCtx, type Expression } from "./face";
import { CAT_COATS } from "../../shared/cat-coats";
import { renderOps } from "../../shared/sprite-raster";
import { MIN_PIXEL_DIFF, pixelDiffRatio } from "../../shared/min-pixel-diff";
import { matRoot, toMap2 } from "./rig";

const CTX: FaceCtx = { t: 0, blink: 0, mouse: null, energy: 1, speaking: false };
const head = toMap2(matRoot({ x: 41, y: 43 }, 37 / 60));
/** standard 档的窗口基址（`pet-geometry.ts:9-10` 的 82×108），s 取 e=0 时的 37/60。
 *  判据落在**运行时那张窗口的像素**上，而不是 256² 的资产图上：0.005 × 8856 ≈ 44 个像素，
 *  这就是「两档表情至少要有 44 个像素各说各话」。用资产口径的 256² 会把门槛放大 8 倍，
 *  看着严格，实际量的是用户永远看不到的尺寸。 */
const WIN = { w: 82, h: 108 };
const S = 37 / 60;

const raster = (e: Expression) =>
  renderOps(buildFaceOps(faceOf(e, CTX), head, S, CAT_COATS.ink, 37), WIN.w, WIN.h);

describe("尺 #72：16 档表情两两可分辨", () => {
  it("120 对全部 ≥ MIN_PIXEL_DIFF，任一对低于即红并点名两侧", () => {
    const cache = new Map<Expression, ReturnType<typeof raster>>(
      EXPRESSIONS.map((e) => [e, raster(e)]),
    );
    const worst: Array<{ pair: string; ratio: number }> = [];
    for (let i = 0; i < EXPRESSIONS.length; i += 1) {
      for (let j = i + 1; j < EXPRESSIONS.length; j += 1) {
        const a = EXPRESSIONS[i], b = EXPRESSIONS[j];
        const ratio = pixelDiffRatio(cache.get(a)!, cache.get(b)!);
        worst.push({ pair: `${a}/${b}`, ratio });
        expect(ratio, `#72 ${a} vs ${b} 只差 ${(ratio * 100).toFixed(3)}% 像素（下限 ${MIN_PIXEL_DIFF * 100}%）`)
          .toBeGreaterThanOrEqual(MIN_PIXEL_DIFF);
      }
    }
    // 最小的 5 对原样进台账：Task 27 换 large 档时要知道余量最薄的是哪几对。
    console.warn("[#72] 最薄的 5 对：", worst.sort((x, y) => x.ratio - y.ratio).slice(0, 5)
      .map((w) => `${w.pair}=${(w.ratio * 100).toFixed(3)}%`).join(" "));
  });

  it("正对照：同档自比必须恰好 0（这条废了，上面那条就是恒真）", () => {
    expect(pixelDiffRatio(raster("neutral"), raster("neutral"))).toBe(0);
  });

  it("正对照：把 happy 的 FaceParams 当 neutral 画，尺必须红在 neutral/happy", () => {
    const fake = renderOps(buildFaceOps(faceOf("happy", CTX), head, S, CAT_COATS.ink, 37), WIN.w, WIN.h);
    expect(pixelDiffRatio(raster("neutral"), fake)).toBeGreaterThanOrEqual(MIN_PIXEL_DIFF);
    // 反证判据不是「只要有 op 不同就算过」：只改 alpha 到不可见的量级必须低于阈值
    const dim = renderOps(buildFaceOps({ ...faceOf("neutral", CTX), blush: 0.004 }, head, S, CAT_COATS.ink, 37), WIN.w, WIN.h);
    expect(pixelDiffRatio(raster("neutral"), dim)).toBeLessThan(MIN_PIXEL_DIFF);
  });

  it("16 档都要真画出东西：单档覆盖度 > 0（空表不会红在成对比，只会红在这条）", () => {
    for (const e of EXPRESSIONS) {
      const r = raster(e);
      let inked = 0;
      for (let i = 3; i < r.rgba.length; i += 4) if (r.rgba[i] > 0) inked += 1;
      expect(inked, `${e} 栅格化后一个像素都没有`).toBeGreaterThan(200);
    }
  });
});
```

三条设计交代：① **`pixelDiffRatio` 逐字节比 RGBA 四通道**，与 `cat-sprites.mjs` 那条通路完全同一个函数（Step 0 已把它抽成 shared），所以「表情尺」与「资产门」不可能给出两个结论；② `renderOps` 的默认 `ss = 2`（`sprite-raster.ts:29-30`）不显式覆盖，抗锯齿口径与资产门一致；③ 最后那条覆盖度检查防的是另一种假绿——某档表写成空对象时，它与别的档**都**只差一点点，成对判据可能恰好过线，而「这一档根本没画」在成对比较里是隐形的。

**判据不许让步（spec §13 风险 1 的执行口径）**：若某对低于 `MIN_PIXEL_DIFF`，只有两条合法出路——**加强那两档的差分表**（回 Task 9/10 改 `TABLE`），或**减掉一档**并把减掉的名字写进 spec §13 与本计划的口径差台账。改 `MIN_PIXEL_DIFF`、给某对开例外、把判据换成 `>` 平均差，三种都算绕过。跑绿之后把 `console.warn` 那行的实际输出（最薄 5 对与各自百分比）抄进尺文件头的注释，作为后续档位的余量标定样本——这条替代了原计划里那组假想的 `CALIBRATION` 数值。

- [ ] **Step 2: 跑绿并留标定**

Run: `CI=true npx vitest run src/shared/min-pixel-diff.test.ts src/renderer/pet/face-distinguishability.test.ts src/renderer/pet/cat-sprite-manifest.test.ts`
Expected: PASS。`cat-sprite-manifest.test.ts` 一起跑是因为 Step 0 动了它的 import 图。把 `console.warn` 输出的「最薄 5 对」三个数以上写进尺文件头注释。

- [ ] **Step 3: 变异验牙（spec §10 变异③，两条都要跑）**

1. 临时把 `TABLE.wink` 改成 `{ ...TABLE.neutral }`，Expected: FAIL 且**点名 `neutral vs wink`**。
2. 临时把 `MIN_PIXEL_DIFF` 改成 `0.0005`，Expected: `npm run check:sprites` 仍绿（资产门认的是 bundle 里的同一个数），而**尺文件头那条标定注释必须与实测对得上**——若把阈值调小后成对判据立刻全绿，说明 16 档里有几对本来就靠余量活着，把这几对的名字记进台账（Task 27 换 large 档时它们先红）。

跑完还原，再跑一次 Step 2 的命令确认绿。

- [ ] **Step 4: 提交**

```bash
git add src/shared/min-pixel-diff.ts src/shared/min-pixel-diff.test.ts \
  src/renderer/pet/face-distinguishability.test.ts src/renderer/pet/cat-sprite-manifest.ts \
  scripts/build/cat-sprites.mjs
git commit -m "$(cat <<'EOF'
test(pet): 尺 #72 表情可分辨矩阵，阈值抽成 shared 单一来源（P2 Task 11）

判据走像素路线（renderOps，spec §10 原样），不降级成几何指纹：几何指纹低于
spec 要求的 0.005，等于换一把更哑的尺。0.005×82×108≈44 像素，量的是运行时
那张窗口的像素，不是 256² 的资产图。

MIN_PIXEL_DIFF 与 pixelDiffRatio 从 cat-sprites.mjs 的私有 const 抽进
src/shared/min-pixel-diff.ts，构建脚本改读 bundle 出口——资产门与表情尺从此
认同一个数。搬移的等价证明：check:sprites 全绿。

正对照三条：同档自比恰为 0、只改不可见 alpha 必须低于阈值、单档覆盖度为 0 必须红。
EOF
)"
```

---

## Task 12: `motion.ts` — 缓算子、采样与摆律（先不放 clip 表）

**Files:**
- Create: `src/renderer/pet/motion.ts`
- Test: `src/renderer/pet/motion.test.ts`

**Interfaces:**
- Consumes: Task 9 的 `Expression` 类型（`Clip.face` 字段用）
- Produces:
  - `type MotionLayer = "body" | "gesture" | "face"`、`type Channel`（15 个）、`const CHANNELS: readonly Channel[]`
  - `interface Env { ease(p): number; pulse(p, cycles?): number; step(p, at): number }`、`const ENV: Env`
  - `interface Clip { id; layer; ms; lasting?; priority; rest; tracks; face? }`（spec §3.3 去掉 `bubbleKey`，理由见下面「为什么撤掉 `bubbleKey`」，即口径差⑧）
  - `type Channels = Partial<Record<Channel, number>>`、`sampleClip(clip, p): Channels`
  - `registerClips(clips)`（**合并语义**）、`clipById(id): Clip`（查不到抛错）、`allClips(): Clip[]`、`withPriority(clip, p): Clip`
  - `type Slots = Partial<Record<MotionLayer, { clip: Clip; p: number }>>`、`mixPose(slots): Channels`
  - `const DT_CAP_MS = 50`、`capDt(dtMs): number`、`springStep(current, target, rate, dtMs): number`
  - `const BLINK_PERIOD_S = 4.2`、`BLINK_MS = 260`、`blinkAt(t): number`

**通道单位（钉死，`girl.ts` 与尺 #73 都按这张表读）：** `armL/armR/legL/legR/lean/headYaw/headPitch/earL/earR/tail` 是**弧度**；`headBob/hop` 是 **viewBox px**（负＝向上）；`squash/hem/hand` 是 0..1 无量纲。四足的 `pose.tilt` 是角度（13），猫娘侧由 Task 6 的 `lean = tilt * 0.006` 折算，两套口径不许在同一个数上混用。

- [ ] **Step 1: 写失败测试**

创建 `src/renderer/pet/motion.test.ts`：

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHANNELS, ENV, DT_CAP_MS, BLINK_MS, BLINK_PERIOD_S,
  blinkAt, capDt, clipById, mixPose, registerClips, sampleClip, springStep, withPriority,
  type Channel, type Clip,
} from "./motion";

/** 本任务只带 fixture；真表在 Task 13。两条足够把采样器钉死。 */
const WAVE: Clip = {
  id: "wfixture", layer: "gesture", ms: 2000, priority: 2,
  rest: { armR: -1.15, hand: 0.6 },
  tracks: {
    armR: (p) => -1.15 + 0.28 * Math.sin(2 * Math.PI * 3 * p),
    hand: (p, e) => 0.6 + 0.3 * e.pulse(p, 3),
  },
  face: "happy",
};
const SIT: Clip = {
  id: "sfixture", layer: "body", ms: 2600, lasting: true, priority: 0,
  rest: { legL: 1.15, legR: 1.15, headBob: 0 },
  tracks: { legL: () => 1.15, legR: () => 1.15, headBob: (p, e) => -0.8 * e.pulse(p) },
};

describe("Env 三个算子", () => {
  it("ease 端点 0/1、中点 0.5、单调", () => {
    expect(ENV.ease(0)).toBe(0);
    expect(ENV.ease(1)).toBe(1);
    expect(ENV.ease(0.5)).toBeCloseTo(0.5, 12);
    let prev = -1;
    for (let i = 0; i <= 100; i++) {
      const v = ENV.ease(i / 100);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it("pulse 两头零、中点一；cycles=2 得到两个包且不出现负值", () => {
    expect(ENV.pulse(0)).toBeCloseTo(0, 12);
    expect(ENV.pulse(1)).toBeCloseTo(0, 12);
    expect(ENV.pulse(0.5)).toBeCloseTo(1, 12);
    let peaks = 0;
    for (let i = 1; i < 100; i++) {
      const v = ENV.pulse(i / 100, 2);
      expect(v).toBeGreaterThanOrEqual(0);
      if (v > 0.999) peaks++;
    }
    expect(peaks).toBe(2);
    expect(() => ENV.pulse(0.5, 0)).toThrow(/cycles/);
    expect(() => ENV.pulse(0.5, 1.5)).toThrow(/cycles/);
  });

  it("step 在 at 处翻转，at 越界抛错", () => {
    expect(ENV.step(0.4, 0.5)).toBe(0);
    expect(ENV.step(0.5, 0.5)).toBe(1);
    expect(() => ENV.step(0.5, 1.2)).toThrow(/at/);
  });
});

describe("摆律与帧距", () => {
  it("dt=0 不动；正向逼近且永不超调", () => {
    expect(springStep(0.3, 1, 8, 0)).toBe(0.3);
    let v = 0;
    for (let i = 0; i < 400; i++) {
      v = springStep(v, 1, 8, 16);
      expect(v).toBeLessThanOrEqual(1);
      expect(v).toBeGreaterThanOrEqual(0);
    }
    expect(v).toBeCloseTo(1, 3);
  });

  it("capDt 只砍正数：120ms→50ms，负数与 NaN→0", () => {
    expect(capDt(16)).toBe(16);
    expect(capDt(120)).toBe(DT_CAP_MS);
    expect(capDt(-5)).toBe(0);
    expect(capDt(Number.NaN)).toBe(0);
  });

  it("同一 rate 下 120ms 与 50ms 结果相同（封顶真的生效）", () => {
    expect(springStep(0, 1, 8, 120)).toBeCloseTo(springStep(0, 1, 8, 50), 12);
  });
});

describe("sampleClip", () => {
  it("只产 tracks 声明的通道，且是绝对值（p=0 落在 rest 上）", () => {
    expect(sampleClip(WAVE, 0)).toEqual({ armR: -1.15, hand: 0.6 });
    expect(Object.keys(sampleClip(WAVE, 0.5)).sort()).toEqual(["armR", "hand"]);
  });

  it("p 越界夹回 0..1；NaN 抛 RangeError", () => {
    expect(sampleClip(WAVE, -0.4)).toEqual(sampleClip(WAVE, 0));
    expect(sampleClip(WAVE, 1.6)).toEqual(sampleClip(WAVE, 1));
    expect(() => sampleClip(WAVE, Number.NaN)).toThrow(RangeError);
  });

  it("轨道产出非有限值 → 抛错并点名 clip 与通道", () => {
    const broken: Clip = { ...WAVE, id: "broken", tracks: { armR: () => Number.NaN, hand: WAVE.tracks.hand! } };
    expect(() => sampleClip(broken, 0.3)).toThrow(/broken.*armR/);
  });
});

describe("registerClips / clipById", () => {
  it("重复 id、非正 ms、轨道缺 rest 归零项都当场抛错（构建期即红）", () => {
    expect(() => registerClips([{ ...WAVE, id: "dup" }, { ...WAVE, id: "dup" }])).toThrow(/重复/);
    expect(() => registerClips([{ ...WAVE, ms: 0 }])).toThrow(/ms/);
    const leaky: Clip = { ...WAVE, id: "leaky", rest: { armR: -1.15 } };   // hand 有轨道却没 rest
    expect(() => registerClips([leaky])).toThrow(/hand.*rest/);
    registerClips([WAVE, SIT]);                                            // 正对照：合规则的表能注册
    expect(clipById("sfixture").layer).toBe("body");
  });

  it("clipById 查不到 id 抛错且把 id 写进消息（spec §11：不许静默退化）", () => {
    expect(() => clipById("nope")).toThrow(/nope/);
  });

  it("withPriority 只改 priority，rest/tracks 原样（#73 不受影响）", () => {
    const raised = withPriority(WAVE, 1);
    expect(raised.priority).toBe(1);
    expect(raised.rest).toBe(WAVE.rest);
    expect(raised.tracks).toBe(WAVE.tracks);
  });
});

describe("mixPose 层间合成", () => {
  it("gesture 盖掉 body 的同名通道，不同名通道并存", () => {
    registerClips([WAVE, SIT]);
    const out = mixPose({ body: { clip: SIT, p: 0.5 }, gesture: { clip: WAVE, p: 0.5 } });
    expect(out.legL).toBe(1.15);
    expect(out.armR).toBeCloseTo(-1.15, 4);        // 3 个来回的 sin 在 p=0.5 回到 rest 附近
    expect(out.headBob).toBeDefined();
  });

  it("空槽返回空对象：没有 clip 在场时不产出任何通道（站姿由 girl.ts 的静止值兜）", () => {
    expect(mixPose({})).toEqual({});
  });
});

describe("blinkAt（死通道复活的地基）", () => {
  it("同一个 t 永远同一个值：纯、确定、不读随机", () => {
    expect(blinkAt(1.0)).toBe(blinkAt(1.0));
    expect(blinkAt(BLINK_MS / 2000)).toBeCloseTo(1, 12);   // 窗中＝闭合峰值
    expect(blinkAt(0)).toBe(0);
    expect(blinkAt(1.0)).toBe(0);                          // 1.0s 落在窗外（周期 4.2s）
  });

  it("一周期内闭眼占比 < 8%（不许抽风）", () => {
    let on = 0;
    for (let i = 0; i < 1000; i++) if (blinkAt((i / 1000) * BLINK_PERIOD_S) > 0.05) on++;
    expect(on / 1000).toBeLessThan(0.08);
  });

  it("负数与非有限 t 得 0，不抛（rAF 首帧就是 t=0）", () => {
    expect(blinkAt(-3)).toBe(0);
    expect(blinkAt(Number.NaN)).toBe(0);
  });
});

describe("纯度纪律（spec §3.3：tracks 不许读时钟）", () => {
  afterEach(() => vi.restoreAllMocks());

  it("把 Date.now 与 performance.now 变成炸弹后，21 个 p 点全表采样仍不抛", () => {
    registerClips([WAVE, SIT]);
    vi.spyOn(Date, "now").mockImplementation(() => { throw new Error("tracks 读了 Date.now"); });
    vi.spyOn(performance, "now").mockImplementation(() => { throw new Error("tracks 读了 performance.now"); });
    for (const clip of [WAVE, SIT]) {
      for (let i = 0; i <= 20; i++) expect(() => sampleClip(clip, i / 20)).not.toThrow();
    }
    expect(() => blinkAt(3.77)).not.toThrow();
  });

  it("CHANNELS 恰好 15 个且与 spec §3.3 的名字逐字相等", () => {
    expect([...CHANNELS]).toEqual([
      "armL", "armR", "legL", "legR", "headYaw", "headPitch", "headBob",
      "lean", "hop", "squash", "hem", "tail", "earL", "earR", "hand",
    ] as Channel[]);
  });
});
```

- [ ] **Step 2: 跑，确认失败**

Run: `CI=true npx vitest run src/renderer/pet/motion.test.ts`
Expected: FAIL — `Failed to resolve import "./motion"`（文件还不存在）。**必须看到这一条红**，不许跳过直接写实现。

- [ ] **Step 3: 写实现**

创建 `src/renderer/pet/motion.ts`：

```ts
import type { Expression } from "./face";

/**
 * 演出层的采样内核（spec §3.3）。纯函数、不读时钟：
 * 相位由调用方从绝对时钟折成 `p = 0..1` 再喂进来，于是「同一个 p 必得同一张图」，
 * 静帧档（R-D10）与尺 #73 才有可复现的输入。
 * 单测里把 Date.now/performance.now 换成炸弹跑全表采样——这条纪律是**测出来的**，不是注释里的愿望。
 */
export type MotionLayer = "body" | "gesture" | "face";

export type Channel =
  | "armL" | "armR" | "legL" | "legR" | "headYaw" | "headPitch" | "headBob"
  | "lean" | "hop" | "squash" | "hem" | "tail" | "earL" | "earR" | "hand";

/** 顺序即 spec §3.3 的声明顺序；尺 #73 与测试都按这份名单遍历，所以导出而不是只留类型。 */
export const CHANNELS: readonly Channel[] = [
  "armL", "armR", "legL", "legR", "headYaw", "headPitch", "headBob",
  "lean", "hop", "squash", "hem", "tail", "earL", "earR", "hand",
];

export type Channels = Partial<Record<Channel, number>>;

const clampP = (p: number, who: string): number => {
  if (!Number.isFinite(p)) throw new RangeError(`${who} 的 p 必须是有限数，收到：${p}`);
  return p < 0 ? 0 : p > 1 ? 1 : p;
};

/** 采样形状算子。三个都只吃 p。 */
export interface Env {
  /** smoothstep `p²(3−2p)`：端点 0/1、中点 0.5、单调。 */
  ease(p: number): number;
  /** 起落包络 `|sin(π·p·cycles)|`：两头 0，每个 cycle 一个峰。取绝对值而不是裸 sin，`cycles=2` 才是两个包而不是一个正包加一段平底。 */
  pulse(p: number, cycles?: number): number;
  /** 硬边开关。 */
  step(p: number, at: number): number;
}

export const ENV: Env = {
  ease: (p) => { const q = clampP(p, "ease"); return q * q * (3 - 2 * q); },
  pulse: (p, cycles = 1) => {
    if (!Number.isInteger(cycles) || cycles < 1) throw new RangeError(`pulse 的 cycles 是正整数，收到：${cycles}`);
    return Math.abs(Math.sin(Math.PI * clampP(p, "pulse") * cycles));
  },
  step: (p, at) => {
    const q = clampP(p, "step");
    if (!Number.isFinite(at) || at < 0 || at > 1) throw new RangeError(`step 的 at 要在 0..1，收到：${at}`);
    return q >= at ? 1 : 0;
  },
};

/**
 * `rest`＝出片后回到的姿态。**约定：每条轨道都必须在 rest 里有同名键，且轨道写绝对值**
 * （起落落回 rest 那个数，不是在 rest 上加偏移）。
 * 不摆动的静止值也要写成常量轨道（`legL: () => 1.15`）——这样 rest 的键集恒等于 tracks 的键集，
 * 尺 #73 才可能成立；漏一条轨道的 rest 项＝那根手指演完留在人身上。
 */
export interface Clip {
  id: string;
  layer: MotionLayer;
  /** 一次循环的毫秒数；`lasting` 片读作它的**周期**（呼吸 4.2s 这类）。 */
  ms: number;
  /** Coopanion 的 held：占住这层直到被顶替。 */
  lasting?: boolean;
  /** 0 随机小动作 · 1 workStatus · 2 互动 · 3 物理（drag/thrown/air/land）。 */
  priority: 0 | 1 | 2 | 3;
  rest: Channels;
  tracks: Partial<Record<Channel, (p: number, env: Env) => number>>;
  face?: Expression;
}

export function sampleClip(clip: Clip, p: number): Channels {
  if (!Number.isFinite(p)) throw new RangeError(`sampleClip(${clip.id}) 的 p 必须是有限数，收到：${p}`);
  // 越界只发生在换片前一帧（调度器与绘制不同拍）；夹回是设计，NaN 才是调用方算错。
  const q = p < 0 ? 0 : p > 1 ? 1 : p;
  const out: Channels = {};
  for (const ch of CHANNELS) {
    const track = clip.tracks[ch];
    if (!track) continue;
    const v = track(q, ENV);
    if (!Number.isFinite(v)) throw new RangeError(`clip ${clip.id} 的轨道 ${ch} 在 p=${q} 产出 ${v}`);
    out[ch] = v;
  }
  return out;
}

let registry: Map<string, Clip> = new Map();

/**
 * **合并语义**：同 id 覆盖，其它保留。运行时真表在模块加载时注册一次，
 * 单测自己造的 fixture 不许把真表擦掉（否则别的测试里 `clipById("stand")` 就查不到了）。
 * 结构性校验也在这里：id 重复 / ms 非正 / 轨道缺 rest 归零项，全都构建期抛。
 */
export function registerClips(clips: readonly Clip[]): void {
  const next = new Map(registry);
  for (const c of clips) {
    const known = next.get(c.id);
    if (known && known !== c) throw new Error(`clip id 重复：${c.id}`);
    if (!Number.isFinite(c.ms) || c.ms <= 0) throw new RangeError(`clip ${c.id} 的 ms 非法：${c.ms}`);
    for (const ch of CHANNELS) {
      if (c.tracks[ch] && !(ch in c.rest)) throw new Error(`clip ${c.id} 的轨道 ${ch} 没有 rest 归零项（演完会留在身上）`);
    }
    next.set(c.id, c);
  }
  registry = next;
}

export function clipById(id: string): Clip {
  const c = registry.get(id);
  if (!c) throw new Error(`CLIPS 查不到 id：${id}（spec §11：不许静默退化成站姿）`);
  return c;
}

export function allClips(): Clip[] { return [...registry.values()]; }

/**
 * 同一段动作在不同来源下要不同抢占权：手势池里的 `wave` 是 0（随机小动作），
 * workStatus「提醒」把它顶成 1，点击反馈把它顶成 2。
 * 只换 priority，浅拷贝——rest 与 tracks 保持同一引用，所以 #73 与纯度纪律不受影响。
 */
export function withPriority(clip: Clip, priority: Clip["priority"]): Clip {
  return { ...clip, priority };
}

export type Slots = Partial<Record<MotionLayer, { clip: Clip; p: number }>>;

/** 层间合成序：后写盖掉同名通道（挥手的 armR 赢过走路的 armR）。 */
const LAYER_ORDER: readonly MotionLayer[] = ["body", "gesture", "face"];

export function mixPose(slots: Slots): Channels {
  const out: Channels = {};
  for (const layer of LAYER_ORDER) {
    const slot = slots[layer];
    if (!slot) continue;
    Object.assign(out, sampleClip(slot.clip, slot.p));
  }
  return out;
}

/**
 * 缓动 dt 上限（毫秒）。`renderer.ts:636-639` 废掉的是「相位 += dt」，
 * 连续弹簧状态量本来就走 50ms 封顶那一条（native `main.rs:4964/4362`）。
 */
export const DT_CAP_MS = 50;

export function capDt(dtMs: number): number {
  if (!Number.isFinite(dtMs) || dtMs <= 0) return 0;   // rAF 重挂的空洞按 0：不补时、不慢放
  return Math.min(dtMs, DT_CAP_MS);
}

/** spec §3.1 的摆律：`angle += (target − angle) · (1 − exp(−rate·dt))`，dt 走秒。 */
export function springStep(current: number, target: number, rate: number, dtMs: number): number {
  const dt = capDt(dtMs) / 1000;
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

/**
 * 眨眼：由**绝对时钟**推出来的确定窗口，不用随机（R-D10 要能复现静帧）。
 * `BLINK_MS = 260` 而不是常见动画的 180：4fps 保活档帧距是 250ms（`FPS_IDLE`，`renderer.ts:56`），
 * 闭合期短于帧距就会**整段被采不到**——那只猫就永远不会眨眼。native 的 180ms 走的是 vsync，我们没这个条件。
 */
export const BLINK_PERIOD_S = 4.2;
export const BLINK_MS = 260;

export function blinkAt(t: number): number {
  if (!Number.isFinite(t) || t <= 0) return 0;
  const span = BLINK_MS / 1000;
  const q = t % BLINK_PERIOD_S;
  if (q >= span) return 0;
  return ENV.pulse(q / span);
}
```

- [ ] **Step 4: 跑绿**

Run: `CI=true npx vitest run src/renderer/pet/motion.test.ts`
Expected: PASS，无 warning。若「pulse 两头零」在 `cycles=2` 挂，回头看是不是写成了裸 `Math.sin` 没取绝对值。

- [ ] **Step 5: 提交**

```bash
git add src/renderer/pet/motion.ts src/renderer/pet/motion.test.ts
git commit -m "feat(pet): motion.ts 采样内核（Env/sampleClip/mixPose/摆律/blink）

轨道写绝对值、rest 键集等于 tracks 键集，这是尺 #73 能成立的前提。
BLINK_MS 取 260 而不是 180 的理由写在常量注释里：4fps 档帧距 250ms。
纯度由测试证明——Date.now/performance.now 换成炸弹后全表采样不抛。
registerClips 用合并语义：测试 fixture 不许擦掉运行时真表。"
```

---

## Task 13: `CLIPS` 表（body 12 + 手势种子 9）与尺 #73「演完必须归零」

**Files:**
- Modify: `src/renderer/pet/motion.ts`（文件末尾追加 `BODY`/`GESTURE`/`CLIPS`/`GESTURE_IDS`/`bodyClip`/`gestureClip`，并 `registerClips(CLIPS)`）
- Test: `src/renderer/pet/motion-clips.test.ts`（新建，就是尺 #73）

**Interfaces:**
- Consumes: Task 12 的 `Clip`/`Channel`/`sampleClip`/`registerClips`/`clipById`；Task 9 的 `Expression`
- Produces:
  - `const CLIPS: readonly Clip[]`（本任务 21 条；Task 21 补到 30 条）
  - `const GESTURE_IDS`（18 个名字的 `as const` 数组，本任务先落地其中 9 条 clip）
  - `bodyClip(id): Clip`、`gestureClip(id): Clip`（层不对也抛）

- [ ] **Step 1: 写失败测试（尺 #73）**

创建 `src/renderer/pet/motion-clips.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { CHANNELS, CLIPS, GESTURE_IDS, bodyClip, gestureClip, sampleClip, type Clip } from "./motion";

/**
 * 尺 #73（spec §10）：每个 clip 在 p=0 与 p=1 都必须落回 rest。
 * 违反＝「演完留在人身上」：手挥在半空、身子歪着不回正。
 * 比较取 1e−12 四舍五入，**不是**严格相等：`Math.sin(2π)` 的真值是 −2.4e−16，
 * 按 1e−12 归零是对的，严格相等会把每一条用 sin 的轨道都误判成红（假红同样是坏尺）。
 */
const round = (v: number) => Number(v.toFixed(12));
const roundMap = (c: Clip["rest"]) => {
  const out: Record<string, number> = {};
  for (const k of Object.keys(c).sort()) out[k] = round(c[k as keyof typeof c] as number);
  return out;
};

describe("尺 #73：clip 归零", () => {
  it("CLIPS 至少 21 条且 id 唯一", () => {
    expect(CLIPS.length).toBeGreaterThanOrEqual(21);
    expect(new Set(CLIPS.map((c) => c.id)).size).toBe(CLIPS.length);
  });

  // workStatus 要用到的三条必须**本任务就在表里**：Task 14 的 playGesture("typeCode") 测试
  // 与 Task 18 的演出表都走 gestureClip()，未注册直接抛——种子数从 6 变 9 就是这么来的。
  it("workStatus 依赖的三条手势片已注册（typeCode/peek 为 lasting，shiver 为一次性）", () => {
    const byId = new Map(CLIPS.filter((c) => c.layer === "gesture").map((c) => [c.id, c]));
    expect([...byId.keys()].sort()).toEqual(
      ["bow", "hop", "nod", "peek", "shake", "shiver", "tilt", "typeCode", "wave"].sort(),
    );
    expect(byId.get("typeCode")?.lasting).toBe(true);
    expect(byId.get("peek")?.lasting).toBe(true);
    expect(byId.get("shiver")?.lasting).toBeUndefined();
  });

  it("每条 clip 的 rest 键集 == tracks 键集，且 p=0 / p=1 都等于 rest", () => {
    for (const clip of CLIPS) {
      const trackKeys = CHANNELS.filter((ch) => clip.tracks[ch]).sort();
      const restKeys = Object.keys(clip.rest).sort();
      expect(restKeys, `${clip.id} 的 rest 与 tracks 键集不等`).toEqual(trackKeys);
      for (const p of [0, 1]) {
        expect(roundMap(sampleClip(clip, p)), `${clip.id} 在 p=${p} 没归零`).toEqual(roundMap(clip.rest));
      }
    }
  });

  it("21 点采样全部有限，且弧度通道 |v| ≤ 2、像素通道 |v| ≤ 16、无量纲通道 |v| ≤ 1.2", () => {
    const RAD = new Set(["armL", "armR", "legL", "legR", "headYaw", "headPitch", "lean", "earL", "earR", "tail"]);
    const PX = new Set(["headBob", "hop"]);
    for (const clip of CLIPS) {
      for (let i = 0; i <= 20; i++) {
        for (const [ch, v] of Object.entries(sampleClip(clip, i / 20))) {
          expect(Number.isFinite(v), `${clip.id}.${ch} @p=${i / 20} 非有限`).toBe(true);
          const cap = RAD.has(ch) ? 2 : PX.has(ch) ? 16 : 1.2;
          expect(Math.abs(v), `${clip.id}.${ch} 振幅越界（单位读错了？）`).toBeLessThanOrEqual(cap);
        }
      }
    }
  });

  it("gesture 非 lasting 片的 ms 落在 ACTION_MS 量级 1800..2400（companion.ts:110-115）", () => {
    expect(GESTURE_IDS.length).toBe(18);
    const seeds = CLIPS.filter((c) => c.layer === "gesture" && !c.lasting);
    expect(seeds.length).toBeGreaterThanOrEqual(6);
    for (const clip of seeds) {
      expect(clip.ms, `${clip.id} 的 ms 跳出 ACTION_MS 量级`).toBeGreaterThanOrEqual(1800);
      expect(clip.ms, `${clip.id} 的 ms 跳出 ACTION_MS 量级`).toBeLessThanOrEqual(2400);
    }
  });

  it("物理三兄弟（drag/thrown/air/land）priority 必须是 3", () => {
    for (const id of ["drag", "thrown", "air", "land"]) {
      expect(CLIPS.find((c) => c.id === id)?.priority, `${id} 缺行或不是物理档`).toBe(3);
    }
  });

  it("spec §5 的 body 档名一条不缺", () => {
    const names = ["stand", "walk", "run", "sit", "kneel", "drowse", "sleep", "crouch", "drag", "thrown", "air", "land"];
    for (const id of names) expect(() => bodyClip(id)).not.toThrow();
  });

  it("bodyClip/gestureClip 查不到或层不对都抛错（Task 19 的调度器靠这条兜住写错的动作名）", () => {
    expect(bodyClip("stand").layer).toBe("body");
    expect(gestureClip("wave").layer).toBe("gesture");
    expect(() => bodyClip("fly")).toThrow(/fly/);
    expect(() => bodyClip("wave")).toThrow(/gesture/);
  });
});
```

Run: `CI=true npx vitest run src/renderer/pet/motion-clips.test.ts`
Expected: FAIL — `./motion` 里拿不到 `CLIPS`/`GESTURE_IDS`/`bodyClip`/`gestureClip`。

- [ ] **Step 2: 写表**

在 `motion.ts` 末尾追加。**数值就是设计**：改一个数＝改观感，评审要按 spec §5/§6 对，不许「顺手调一下」。

```ts
/**
 * spec §5 的 body 档：stand walk run sit kneel drowse sleep crouch drag thrown，
 * 外加 thrown 的两条组合片 air（离地弹起）与 land（落地压扁）。
 * 「组合」的换片规则不在这里（单槽怎么让位由 Task 20 的仲裁定），本表只保证三件事：
 * id 稳定、p=0/p=1 归零、priority 分档正确。
 */
const BODY: Clip[] = [
  { id: "stand", layer: "body", ms: 4200, lasting: true, priority: 0,
    rest: { lean: 0.015, headBob: 0, hem: 0, armL: 0.05, armR: -0.05, tail: 0 },
    tracks: {
      lean: () => 0.015,
      headBob: (p, e) => -1.1 * e.pulse(p),
      hem: (p, e) => 0.05 * e.pulse(p),
      armL: () => 0.05, armR: () => -0.05,
      tail: (p, e) => 0.12 * e.pulse(p),
    }, face: "neutral" },
  { id: "walk", layer: "body", ms: 640, lasting: true, priority: 0,
    rest: { legL: 0, legR: 0, armL: 0, armR: 0, headBob: 0, lean: 0.03, hem: 0 },
    tracks: {
      legL: (p) => 0.42 * Math.sin(2 * Math.PI * p),
      legR: (p) => -0.42 * Math.sin(2 * Math.PI * p),
      armL: (p) => -0.26 * Math.sin(2 * Math.PI * p),
      armR: (p) => 0.26 * Math.sin(2 * Math.PI * p),
      headBob: (p, e) => -1.6 * e.pulse(p, 2),
      lean: () => 0.03,
      hem: (p, e) => 0.14 * e.pulse(p, 2),
    } },
  { id: "run", layer: "body", ms: 380, lasting: true, priority: 0,
    rest: { legL: 0, legR: 0, armL: 0, armR: 0, headBob: 0, lean: 0.10, hem: 0, squash: 0 },
    tracks: {
      legL: (p) => 0.62 * Math.sin(2 * Math.PI * p),
      legR: (p) => -0.62 * Math.sin(2 * Math.PI * p),
      armL: (p) => -0.45 * Math.sin(2 * Math.PI * p),
      armR: (p) => 0.45 * Math.sin(2 * Math.PI * p),
      headBob: (p, e) => -2.4 * e.pulse(p, 2),
      lean: () => 0.10,
      hem: (p, e) => 0.24 * e.pulse(p, 2),
      squash: (p, e) => 0.10 * e.pulse(p, 2),
    } },
  { id: "sit", layer: "body", ms: 3000, lasting: true, priority: 0,
    rest: { legL: 1.15, legR: 1.15, headBob: 0, hem: 0.10, lean: 0.02, armL: 0.04, armR: -0.04 },
    tracks: {
      legL: () => 1.15, legR: () => 1.15,
      headBob: (p, e) => -0.8 * e.pulse(p),
      hem: () => 0.10, lean: () => 0.02, armL: () => 0.04, armR: () => -0.04,
    }, face: "neutral" },
  { id: "kneel", layer: "body", ms: 2600, lasting: true, priority: 0,
    rest: { legL: 1.45, legR: 1.52, headPitch: 0.10, hem: 0.16, lean: 0.06, armL: 0.30, armR: 0.30 },
    tracks: {
      legL: () => 1.45, legR: () => 1.52,
      headPitch: (p, e) => 0.10 + 0.03 * e.pulse(p),
      hem: () => 0.16, lean: () => 0.06, armL: () => 0.30, armR: () => 0.30,
    }, face: "shy" },
  { id: "drowse", layer: "body", ms: 3000, lasting: true, priority: 0,
    rest: { headPitch: 0.14, headBob: 0, legL: 1.15, legR: 1.15, earL: -0.12, earR: -0.12, hem: 0.08, lean: 0.05 },
    tracks: {
      headPitch: (p, e) => 0.14 + 0.10 * e.pulse(p, 2),
      headBob: (p, e) => -1.0 * e.pulse(p),
      legL: () => 1.15, legR: () => 1.15, earL: () => -0.12, earR: () => -0.12,
      hem: () => 0.08, lean: () => 0.05,
    }, face: "sleepy" },
  { id: "sleep", layer: "body", ms: 4800, lasting: true, priority: 0,
    rest: { headPitch: 0.30, lean: 0.16, headBob: 0, legL: 0.95, legR: 0.95, earL: -0.20, earR: -0.20, hem: 0.06, tail: 0 },
    tracks: {
      headPitch: () => 0.30, lean: () => 0.16,
      headBob: (p, e) => -1.6 * e.pulse(p),
      legL: () => 0.95, legR: () => 0.95, earL: () => -0.20, earR: () => -0.20,
      hem: () => 0.06, tail: (p, e) => 0.06 * e.pulse(p),
    }, face: "sleepy" },
  { id: "crouch", layer: "body", ms: 420, priority: 2,
    rest: { squash: 0, hem: 0, headBob: 0, legL: 0, legR: 0, lean: 0 },
    tracks: {
      squash: (p, e) => 0.55 * e.pulse(p),
      hem: (p, e) => -0.18 * e.pulse(p),
      headBob: (p, e) => 2.2 * e.pulse(p),
      legL: (p, e) => 0.50 * e.pulse(p), legR: (p, e) => 0.50 * e.pulse(p),
      lean: (p, e) => 0.08 * e.pulse(p),
    }, face: "surprised" },
  { id: "drag", layer: "body", ms: 900, lasting: true, priority: 3,
    rest: { armL: -0.90, armR: -0.90, legL: 0.50, legR: 0.50, lean: 0, hem: 0.35, headPitch: 0.12 },
    tracks: {
      armL: () => -0.90, armR: () => -0.90,
      legL: (p, e) => 0.50 + 0.10 * e.pulse(p, 2),
      legR: (p, e) => 0.50 - 0.10 * e.pulse(p, 2),
      lean: () => 0, hem: (p, e) => 0.35 + 0.12 * e.pulse(p, 3), headPitch: () => 0.12,
    }, face: "worried" },
  { id: "thrown", layer: "body", ms: 700, lasting: true, priority: 3,
    rest: { lean: -0.25, armL: -1.20, armR: -1.20, legL: -0.30, legR: -0.30, hem: 0.50, headPitch: -0.10 },
    tracks: {
      lean: (p, e) => -0.25 + 0.06 * e.pulse(p, 2),
      armL: () => -1.20, armR: () => -1.20,
      legL: (p, e) => -0.30 + 0.12 * e.pulse(p, 2),
      legR: (p, e) => -0.30 - 0.12 * e.pulse(p, 2),
      hem: (p, e) => 0.50 + 0.20 * e.pulse(p, 2), headPitch: () => -0.10,
    }, face: "surprised" },
  { id: "air", layer: "body", ms: 260, priority: 3,
    rest: { hop: 0, squash: 0, hem: 0, legL: 0, legR: 0, lean: 0 },
    tracks: {
      hop: (p, e) => -12 * e.pulse(p),
      squash: (p, e) => 0.12 * e.pulse(p),
      hem: (p, e) => 0.45 * e.pulse(p),
      legL: (p, e) => -0.30 * e.pulse(p), legR: (p, e) => -0.30 * e.pulse(p),
      lean: (p, e) => -0.10 * e.pulse(p),
    } },
  { id: "land", layer: "body", ms: 320, priority: 3,
    rest: { hop: 0, squash: 0, hem: 0, headBob: 0, legL: 0, legR: 0 },
    tracks: {
      hop: () => 0,
      squash: (p, e) => 0.62 * e.pulse(p),
      hem: (p, e) => -0.25 * e.pulse(p),
      headBob: (p, e) => 2.0 * e.pulse(p),
      legL: (p, e) => 0.34 * e.pulse(p), legR: (p, e) => 0.34 * e.pulse(p),
    } },
];

/** 本任务先落 9 条：6 条够 P2 的合成测试，另外 3 条（typeCode/peek/shiver）是 Task 14 的测试与 Task 18 的演出表要用的，缺一条就当场抛；其余 9 条在 Task 21 补齐。 */
const GESTURE: Clip[] = [
  { id: "wave", layer: "gesture", ms: 2000, priority: 0,
    rest: { armR: -1.15, hand: 0.60, headYaw: 0 },
    tracks: {
      armR: (p) => -1.15 + 0.28 * Math.sin(2 * Math.PI * 3 * p),
      hand: (p, e) => 0.60 + 0.30 * e.pulse(p, 3),
      headYaw: (p, e) => 0.08 * e.pulse(p),
    }, face: "happy" },
  { id: "bow", layer: "gesture", ms: 2200, priority: 0,
    rest: { lean: 0, headPitch: 0, hem: 0, armL: 0, armR: 0 },
    tracks: {
      lean: (p, e) => 0.32 * e.pulse(p),
      headPitch: (p, e) => 0.18 * e.pulse(p),
      hem: (p, e) => 0.20 * e.pulse(p),
      armL: (p, e) => -0.15 * e.pulse(p), armR: (p, e) => -0.15 * e.pulse(p),
    }, face: "happy" },
  { id: "nod", layer: "gesture", ms: 1800, priority: 0,
    rest: { headPitch: 0, headBob: 0 },
    tracks: { headPitch: (p, e) => 0.16 * e.pulse(p, 2), headBob: (p, e) => -0.6 * e.pulse(p, 2) },
    face: "neutral" },
  { id: "shake", layer: "gesture", ms: 1800, priority: 0,
    rest: { headYaw: 0, lean: 0 },
    tracks: { headYaw: (p) => 0.24 * Math.sin(2 * Math.PI * 4 * p), lean: (p) => 0.02 * Math.sin(2 * Math.PI * 2 * p) },
    face: "angry" },
  { id: "hop", layer: "gesture", ms: 1800, priority: 2,
    rest: { hop: 0, squash: 0, hem: 0, legL: 0, legR: 0 },
    tracks: {
      hop: (p, e) => -14 * e.pulse(p),
      squash: (p, e) => 0.22 * e.pulse(p, 2),
      hem: (p, e) => 0.30 * e.pulse(p),
      legL: (p, e) => -0.36 * e.pulse(p), legR: (p, e) => -0.36 * e.pulse(p),
    }, face: "excited" },
  // tilt 与四足的 pose.tilt 同语义（ACTION_MS.tilt = 2000，companion.ts:110-115）。
  // 四足峰值 13 度；这里 headYaw 峰值 0.20 rad ≈ 11.5 度——不同形态不必等值，量级对得上就行。
  { id: "tilt", layer: "gesture", ms: 2000, priority: 0,
    rest: { headYaw: 0, lean: 0, earL: 0, earR: 0, hem: 0 },
    tracks: {
      headYaw: (p, e) => 0.20 * e.pulse(p),
      lean: (p, e) => 0.06 * e.pulse(p),
      earL: (p, e) => 0.15 * e.pulse(p), earR: (p, e) => -0.10 * e.pulse(p),
      hem: (p, e) => 0.06 * e.pulse(p),
    }, face: "confused" },
  // ↓ 这三条不是「顺手多写的种子」——Task 14 的 playGesture("typeCode") 与 Task 18 的演出表
  // （spec §6 的 工作中 / 提醒 / 已中断 三行）都经 gestureClip() 取它们，未注册直接抛。
  // lasting 片的 ms 读作**周期**（Task 12 的 Clip 注释），所以它们不进上面那条 1800..2400 的量级判据
  // ——与 body 的 stand 4200 / walk 640 同理。
  { id: "typeCode", layer: "gesture", ms: 900, priority: 1, lasting: true,
    rest: { armL: -0.52, armR: -0.52, headPitch: 0.12, hand: 0, headBob: 0 },
    tracks: {
      // 两条前臂常驻在桌面高度（常量轨道，rest 键集==tracks 键集这条约定不许破），
      // 指尖用 |sin| 交替抬落：p=0 与 p=1 都回 0＝rest，#73 认它归零。
      armL: () => -0.52, armR: () => -0.52, headPitch: () => 0.12,
      hand: (p) => 0.5 * Math.abs(Math.sin(2 * Math.PI * 2 * p)),
      headBob: (p, e) => -0.8 * e.pulse(p, 2),
    }, face: "smug" },
  { id: "peek", layer: "gesture", ms: 2600, priority: 1, lasting: true,
    rest: { lean: 0, headYaw: 0, hand: 0.0, earL: 0, earR: 0 },
    tracks: {
      // 探出去—收回来，一个周期一次：既是 spec §5 的「张望」，也是 提醒 期间占住这层的「催你看」。
      // hop 不放进这条：它会把 body 层的跳高通道抢走（mixPose 同通道按 priority 决胜负，1 压 0）。
      lean: (p, e) => 0.10 * e.pulse(p),
      headYaw: (p, e) => 0.24 * e.pulse(p),
      hand: (p, e) => 0.30 * e.pulse(p, 2),
      earL: (p, e) => 0.18 * e.pulse(p), earR: (p, e) => -0.12 * e.pulse(p),
    }, face: "surprised" },
  { id: "shiver", layer: "gesture", ms: 1800, priority: 0,
    rest: { lean: -0.05, headYaw: 0, hem: 0, earL: 0, earR: 0 },
    tracks: {
      // lean 带 −0.05 的偏置＝spec §6 的「后缩」；rest 也写这个数，才满足「末值等于 rest」。
      lean: (p) => -0.05 + 0.03 * Math.sin(2 * Math.PI * 6 * p),
      headYaw: (p) => 0.07 * Math.sin(2 * Math.PI * 8 * p),
      hem: (p) => 0.05 * Math.sin(2 * Math.PI * 8 * p),
      earL: (p) => 0.20 * Math.sin(2 * Math.PI * 7 * p), earR: (p) => -0.20 * Math.sin(2 * Math.PI * 7 * p),
    }, face: "sad" },
];

export const CLIPS: readonly Clip[] = [...BODY, ...GESTURE];

/** spec §5/§6 的 18 个手势名，一次钉全；本任务落地其中 9 条 clip，缺的 9 条由 Task 21 补。 */
export const GESTURE_IDS = [
  "nod", "shake", "wave", "bow", "hop", "shiver", "stretch", "yawn", "groom", "tilt",
  "curtsy", "clap", "coverFace", "peek", "point", "sip", "typeCode", "turnAway",
] as const;

registerClips(CLIPS);

function byLayer(layer: MotionLayer, id: string): Clip {
  const c = clipById(id);
  if (c.layer !== layer) throw new Error(`clip ${id} 不在 ${layer} 层（它属于 ${c.layer}）`);
  return c;
}
export function bodyClip(id: string): Clip { return byLayer("body", id); }
export function gestureClip(id: string): Clip { return byLayer("gesture", id); }
```

⚠️ `registerClips(CLIPS)` 在模块加载时跑，Task 12 的测试又注册 fixture——**合并语义**（Task 12 Step 3 的实现里已经这么做）才不会被互相覆盖。补测一条：注册 fixture 之后 `clipById("stand")` 仍拿得到。

**为什么撤掉 spec §3.3 的 `Clip.bubbleKey`（与 spec 的口径差⑧）**

spec 给这一行的注释是「与气泡文案层挂钩的 i18n key」。实测两条：① 宠物窗的渲染层是 vanilla TS，**没有 i18n 运行时**——`i18next` 只被 `src/renderer/react/**` import（`grep -rln "i18next" src/renderer` 出来的 15 个文件全在 react 下），猫窗走的是 `src/renderer/main.ts` 那条独立入口；② 本期之前每一条猫气泡的文案都是硬编码中文词表（`PET_LINES` `companion.ts:125`、`FEED_LINES`、`PLAY_LINES`、`CHATTER`），spec §6 的点击反馈表也写的是「`PET_LINES`／`PLAY_LINES`／新增 2 行」，同样是词表口径。所以留一个 `bubbleKey?: string` 字段的结果是：**表里写了 6 个 key，零个读者**——正是 `project-false-green-locks` 说的假契约。撤掉它，Task 18/22 的气泡文案改走词表（`WORK_STATUS_LINES` 与既有的四组词表同一形态）。真要给猫窗上 i18n，那是整条文案层的活，进 spec §13 的延后清单，不在本期。

**为什么 `Clip.face` 留着（同一个问题的另一面）**

`face` 在 Task 13 也只是数据、没有读者，但它有确定的读者且就在下一站：Task 18 的表情级联 `presentation.expression ?? clip.face ?? MOOD_TO_EXPRESSION[mood]`（随机小动作时的脸由片自己带，workStatus 期间由状态覆盖）。留着是因为它会被消费，不是因为它在 spec 里写着。

**为什么种子是 9 条而不是 6 条（与 spec 的口径差⑫，其实是本计划的自纠）**

这版最初只落 6 条。写 Task 14 时给它写了 `r.playGesture("typeCode")` 那条 lasting 断言（Step 1 里「lasting 显式片压过映射片」），写 Task 18 时又要 `gestureClip("peek")`/`gestureClip("shiver")`——`gestureClip()` 查不到就抛（本任务 Step 3 那条 `expect(() => bodyClip("fly")).toThrow()` 就是它的牙），于是那两条测试会在**自己的任务里**红成「未知 clip」。根因不是测试写错了，是种子的选择标准写错了：原先按「P2 合成测试够不够用」选，应该按「**到下一次有人调它之前必须齐**」选。所以 `typeCode`/`peek`/`shiver` 上提进本任务，Task 21 补剩下的 9 条（`stretch yawn groom curtsy clap coverFace point sip turnAway`）——总数仍是 30，`GESTURE_IDS` 仍是 18 个名字，本任务新增的那条成员测试把 9 条名单钉死，Task 21 补进来时它自动变成「18 条」。


- [ ] **Step 3: 跑绿**

Run: `CI=true npx vitest run src/renderer/pet/motion.test.ts src/renderer/pet/motion-clips.test.ts`
Expected: PASS。若 `#73` 报某条「p=1 没归零」，先怀疑轨道末值写成了别的数——**改轨道，不改尺**。

- [ ] **Step 4: 变异验牙（spec §10 变异②）**

① 把 `hop` 的 `rest` 里 `hop: 0` 删掉（＝「拿掉某个 clip 的 rest 归零」），Expected: `#73` FAIL 且消息点名 `hop`。
② 把 `air` 的 `hop: (p, e) => -12 * e.pulse(p)` 改成 `-12 * e.ease(p)`（末值停在 −12，即「演完手还举着」），Expected: FAIL 点名 `air`。
**两条都还原**，跑绿才提交。

- [ ] **Step 5: 提交**

```bash
git add src/renderer/pet/motion.ts src/renderer/pet/motion-clips.test.ts
git commit -m "feat(pet): CLIPS 表 body 12 + 手势种子 9，尺 #73 归零锁（Task 13）

12 条 body 覆盖 spec §5 的动作名（thrown 另配 air/land 两条组合片）。
尺 #73 按 1e-12 四舍五入比较：Math.sin(2π) 的 −2.4e−16 该归零，严格相等会误伤每条 sin 轨道。
GESTURE_IDS 先钉 18 个名字；种子 9 条里 typeCode/peek/shiver 是 Task 14 的测试与 Task 18 的演出表要用，
缺一条 gestureClip() 就抛——剩下 9 条在 Task 21 补；尺按 CLIPS 现成员遍历，补进来自动受检。
撤掉 spec §3.3 的 Clip.bubbleKey：宠物窗没有 i18n 运行时，本期每条气泡文案都是硬编码中文（companion.ts:125 起四组词表），
留一个没人读的 key 就是假契约（口径差⑧）。
变异②两条（删 rest 项 / ease 顶掉 pulse）各自点名对应 clip。"
```

---
## Task 14: `renderer.ts` — 四层合成接线（blink/gaze 复活、槽位时钟、fps 档、删掉 `setRedrawPolicy`）

**Files:**
- Modify: `src/renderer/pet/form.ts:1333`（`PetInput` 追加 `channels` / `expression` / `speaking` 三条**可选**轴）
- Modify: `src/renderer/pet/girl.ts`（`lean/headTilt/armSwing` 改读通道；`girlRig` 消费 15 条通道并新增 `ground`/`earL`/`earR` 三张阵；`ears` 与 `ground_shadow` 两个部件改经新阵）
- Modify: `src/renderer/pet/renderer.ts:122-134`（`this.cat` 字面量补 `channels: {}`、`expression: "neutral"`、`speaking: false`）
- Modify: `src/renderer/pet/renderer.ts:600-608`（**删掉** `setRedrawPolicy` 整段，含它上面那行「三档 fps 的接线在 Task 11/12」注释）
- Modify: `src/renderer/pet/renderer.ts:54`（同步改掉提到 `setRedrawPolicy` 的那句注释）
- Modify: `src/renderer/pet/renderer.ts:641-654`（三档 fps 判据补 gesture 槽）
- Modify: `src/renderer/pet/renderer.ts:656`（按 `form` 分派 pose）
- Modify: `src/renderer/pet/renderer.ts:685-700`（`applyCompanionPose` 拆成 `applyCatPose` + `applyLayerPose`）
- Modify: `src/renderer/pet/renderer.ts`（`PixelPetRendererOptions` 追加 `companionOverrides?`，字段与构造点 `:138-145` 一起）
- Modify: `src/renderer/main.ts:402-407`（`pointerleave` 补 `renderer.setGaze(null)`）
- Modify: `src/renderer/main.ts:434-447`（`pointermove` 顶部补 `renderer.setGaze(...)`，必须在 `if (isDragging)` 之前）
- Test: `src/renderer/pet/girl.test.ts`（追加「通道消费」describe）
- Test: `src/renderer/pet/renderer.test.ts`（追加「四层合成」describe）

**Interfaces:**
- Consumes:
  - Task 12：`sampleClip(clip, p): Channels`、`mixPose(slots): Channels`、`type Slots`、`blinkAt(t): number`、`type Channel`、`type MotionLayer`、`type Clip`
  - Task 13：`bodyClip(id)`、`gestureClip(id)`
  - Task 9：`MOOD_TO_EXPRESSION`、`type Expression`
  - Task 6：`PetInput`、`buildGirlOps`、`girlRig`、`GIRL_PROPORTION`（`footY: 100`，Task 6 的 `:1106` 已钉死）
  - `CompanionSnapshot`（`companion.ts:68-84`）与 `CompanionActivity`（`companion.ts:44-46`，12 项）
  - `CompanionOptions`（`companion.ts:86+`）：`random?: () => number`、`now?: () => number`、`wallNow?: () => number`
- Produces:
  - `PixelPetRenderer.setForm(form: PetForm): void`——Task 7 的 store 订阅调它；本期出厂默认仍为 `cat`，翻默认在 Task 27
  - `PixelPetRenderer.setGaze(css: { x: number; y: number } | null): void`——**收 CSS 客户端坐标（相对窗口左上）**，内部按 `renderer.ts:339-340` 那条同口径除法折成基址坐标写进 `cat.mouse`
  - `PixelPetRenderer.playGesture(id: string, now?: number): void`——显式手势入口，优先级高于 activity 映射片；一次性片放完自动让位，`lasting` 片（`typeCode` / `peek`）持续播到 `stopGesture()`。Task 18 的 workStatus 与 Task 22 的六类触摸都从这里进
  - `PixelPetRenderer.stopGesture(): void`——收掉显式手势（状态回到 待机 / 已处理 时由 Task 18 调用）
  - `const ACTIVITY_BODY: Record<CompanionActivity, string | null>`（12 项全覆盖）
  - `const ACTIVITY_GESTURE: Partial<Record<CompanionActivity, string>>`（本期只有 `tilt`）
  - `const STEP_DRIVEN: ReadonlySet<string>`（`walk` / `run`）
  - `private slotFor(...)` / `private tickSlots(now, snapshot): Slots`
  - `applyCatPose(snapshot)`（现 15 行逐字搬）/ `applyLayerPose(snapshot)`
  - `PixelPetRendererOptions.companionOverrides?: { random?: () => number; wallNow?: () => number }`

**为什么必须有 `companionOverrides`（不是测试后门，是缺口的正面补法）**：`tickCompanion` 在 `!this.catOrigin || !this.workArea` 时直接返回 `null`（`:393-394`），而引擎的自主动作由 `Math.random()` 选、夜间分支由 `Date.now()` 的小时数决定。本任务 12 条 renderer 断言里有 8 条要求「这一帧的通道值是 X」——不钉 RNG 与挂钟，这八条每个 CI 轮次都会随机变红或随机变绿。变红算运气好，**随机变绿是假绿**（`project-false-green-locks`）。`main.ts` 不传这个字段，生产行为一字不动。

- [ ] **Step 1: 写失败测试**

`src/renderer/pet/girl.test.ts` 追加。`NEUTRAL` 复用 Task 6 已在本文件顶部定义的那一份，不要另找 helper 文件。

```ts
import type { Channel, Channels } from "./motion";
import type { PetInput } from "./form";

const girl = (over: Partial<PetInput> = {}): PetInput => ({ ...NEUTRAL, form: "girl", ...over });
const layerOps = (i: PetInput, layer: string) => buildGirlOps(i).filter((o) => o.layer === layer);
const ALL: Channel[] = ["armL","armR","legL","legR","headYaw","headPitch","headBob","lean","hop","squash","hem","tail","earL","earR","hand"];

describe("girl 通道消费（Task 14）", () => {
  it("channels 缺省与空对象逐字节相同：回落表不许改变静态站姿", () => {
    expect(buildGirlOps(girl({ channels: {} }))).toEqual(buildGirlOps(girl()));
  });

  it("15 条通道全部有消费者：非零值都能改变 ops（死通道＝假绿，逐条点名）", () => {
    expect(ALL).toHaveLength(15);
    const base = JSON.stringify(buildGirlOps(girl()));
    const dead = ALL.filter((c) => JSON.stringify(buildGirlOps(girl({ channels: { [c]: 0.4 } as Channels }))) === base);
    expect(dead, `这些通道没接上消费者：${dead.join(", ")}`).toEqual([]);
  });

  it("headPitch 只把五官沿头局部 y 挪，不许把整个头挪走（低头读成平移的根因）", () => {
    const down = girl({ channels: { headPitch: 0.4 } as Channels });
    const dy = layerOps(down, "eyes")[0].cy - layerOps(girl(), "eyes")[0].cy;
    // 0.4 × 2.2 = 0.88 viewBox px ⇒ 窗口 px 为 0.88·s；s = 37/60。
    expect(dy).toBeGreaterThan(0.01);
    expect(dy).toBeLessThan(3 * (37 / 60));
    const hb = layerOps(girl(), "hair_back")[0] as { cy: number };
    const hd = layerOps(down, "hair_back")[0] as { cy: number };
    expect(Math.abs(hd.cy - hb.cy)).toBeLessThan(0.2);   // 发垫几乎不动：动的是脸不是头
  });

  it("hop 抬身不抬影：投影留在地上，但按四足的 lift 口径缩小", () => {
    const up = girl({ channels: { hop: -12 } as Channels });
    const feet0 = Math.max(...layerOps(girl(), "legs").flatMap((o) => ("cy" in o ? [o.cy as number] : [])));
    const feet1 = Math.max(...layerOps(up, "legs").flatMap((o) => ("cy" in o ? [o.cy as number] : [])));
    expect(feet0 - feet1).toBeGreaterThan(12 * (37 / 60) * 0.8);
    const sh0 = layerOps(girl(), "ground_shadow") as Array<{ cy: number; rx: number }>;
    const sh1 = layerOps(up, "ground_shadow") as Array<{ cy: number; rx: number }>;
    expect(sh1[0].cy).toBeCloseTo(sh0[0].cy, 9);                       // 影不许跟身上升
    // 与 art.ts:264-268 同式：lift = clamp(-hop/26) = 12/26 ⇒ rx ×(1−0.25·lift)
    expect(sh1[0].rx).toBeCloseTo(sh0[0].rx * (1 - 0.25 * (12 / 26)), 6);
  });

  it("squash 纵向压、横向摊，两头同号才是压扁（只压不摊会画成一根细条）", () => {
    const sq = girl({ channels: { squash: 0.7 } as Channels });
    const xs = (i: PetInput) => layerOps(i, "dress").flatMap((o) => ("points" in o ? (o.points as Array<[number, number]>).map((p) => p[0]) : []));
    const ys = (i: PetInput) => layerOps(i, "hair_back").concat(layerOps(i, "legs")).flatMap((o) => ("cy" in o ? [o.cy as number] : []));
    expect(Math.max(...xs(sq)) - Math.min(...xs(sq))).toBeGreaterThan(Math.max(...xs(girl())) - Math.min(...xs(girl())));
    expect(Math.max(...ys(girl())) - Math.min(...ys(girl()))).toBeGreaterThan(Math.max(...ys(sq)) - Math.min(...ys(sq)));
  });

  it("ears 经耳阵：earL=0.4 rad 时左耳动、右耳一字不动", () => {
    const moved = girl({ channels: { earL: 0.4 } as Channels });
    const pts = (i: PetInput, side: "l" | "r") => layerOps(i, "ears")
      .slice(side === "l" ? 0 : 2).flatMap((o) => ("points" in o ? (o.points as Array<[number, number]>) : []));
    const shift = (i: PetInput, side: "l" | "r") => Math.max(...pts(i, side).map((p) => p[0]));
    expect(Math.abs(shift(moved, "l") - shift(girl(), "l"))).toBeGreaterThan(2 * (37 / 60));
    expect(shift(moved, "r")).toBeCloseTo(shift(girl(), "r"), 9);
  });

  it("0.4 弧度的任何单通道都不许把肢体甩出身外（画飞了最容易在 arm 上发生）", () => {
    for (const c of ["armL", "armR", "legL", "legR", "lean", "tail", "hand"] as Channel[]) {
      const i = girl({ channels: { [c]: 0.4 } as Channels });
      const ys = ["arms", "legs", "tail"].flatMap((l) => layerOps(i, l).flatMap((o) => ("points" in o ? (o.points as Array<[number, number]>).map((p) => p[1]) : [])));
      const top = Math.min(...ys), bot = Math.max(...ys);
      expect(bot - top, `${c} 的竖向包围盒 = ${bot - top}，超出站姿可接受范围`).toBeLessThan(105);
    }
  });

  it("hem 只动下摆，不许把腰也一起扩（裙摆甩成象腿的根因）", () => {
    const i = girl({ channels: { hem: 0.8 } as Channels });
    const waist = (x: PetInput) => (layerOps(x, "dress")[0] as { points: Array<[number, number]> }).points.slice(0, 2).map((p) => p[0]);
    expect(waist(i)).toEqual(waist(girl()));
  });
});
```

`src/renderer/pet/renderer.test.ts` 追加。harness 只借文件里**模块作用域**那两件套 `makeCanvas()`（`:18`）与 `makeLoopDriver()`（`:45`）；`advance` **借不到**——它写在 Task 12 那个 `describe` 里面（`:248`，函数声明的作用域跟着 describe 的箭头函数体，跨不出去）。所以本段自带一份同名同口径的 `advance`（每帧 250ms＝4fps 档全过闸），Task 17/18 两段各带自己的（那两段的 `frame`/`makeR` 同理）。这不是复制浪费：把四段共用的 harness 抽到模块作用域要动 Task 12 那 7 条 tuck 用例的取样口径，而 R-D2 对四足路径的硬约束是「一字不变」——把重构塞进功能任务是最容易漏红因的做法（这笔账记进 Step 6 的台账，Task 28 写回 spec §13 的延后清单）。

```ts
describe("PixelPetRenderer 四层合成 (Task 14)", () => {
  const waMain = { x: 0, y: 0, width: 1920, height: 1040 };
  const centerBounds = { x: 800, y: 300, width: 82, height: 108 };

  type CatView = { blink: number; mouse: [number, number] | null; channels: Record<string, number>; expression: string; form?: string };

  /**
   * 三件套是本段自带的最小可跑 harness，每条都有现场理由，不是照抄 Task 12：
   * - `window.verge`：`syncGeometry → requestBounds` 末尾那句是 **非可选** 的
   *   `window.verge.resizePetWindow(payload)`（`renderer.ts:520`），没装 stub 的话第一条
   *   用例红在 TypeError，看上去像实现没写；`:360` 的 `settlePetPosition` 是可选链，装了才
   *   能在它哪天变成非可选时仍给出可读的红。
   * - `window.localStorage.clear()`：`companion: true` 会建引擎，引擎的 vitals 存在盘上
   *   （`renderer.ts:136-137` 把 `window.localStorage` 直接交给引擎）。不清就是「上一条用例
   *   剩下的精力」，而 `energy < 0.25` 会改写闲置权重表——本段 `random: () => 0.999` 钉死的
   *   那一档就可能不再是 `idle`。
   * - `console.log` 静音：`tickCompanion` 的 fps 换档日志会淹掉断言输出（Task 12 `:241` 同一处理）。
   *
   * 名字不叫 `makeGirl`：这台工厂与形态无关，只钉时钟与 RNG，`form` 停在构造默认值（cat）上。
   * 换形由下面的 `up(clock, form)` 负责，别把它藏进工厂——四足对照那条要用 `form: "cat"`，
   * 而工厂里写死 girl 会让那条测试读到的根本不是它宣称的那条路径（假绿的头号来源）。
   */
  function makePet(clockRef: { ms: number }) {
    const loop = makeLoopDriver();
    const verge = { resizePetWindow: vi.fn(), tuckHinted: vi.fn(), settlePetPosition: vi.fn() };
    (window as unknown as { verge: unknown }).verge = verge;
    vi.spyOn(performance, "now").mockImplementation(() => clockRef.ms);
    vi.spyOn(console, "log").mockImplementation(() => {});
    window.localStorage.clear();
    const r = new PixelPetRenderer({
      canvas: makeCanvas(), width: 82, height: 108, onLoad: vi.fn(), onError: vi.fn(), companion: true,
      // RNG 钉在最后一档（idle 权重 14，累计到 1.0 前的一段）、挂钟钉在**本地**午后：
      // 自主动作与夜间分支都不再有机会搅断言。挂钟必须是 `new Date(2026, 9, 24, 13)` 这种
      // 本地构造——`stepIdle` 读 `getHours()`（`companion.ts:549`），写成 `Date.UTC(…, 13, …)`
      // 在 +08:00 落到本地 21 点、在 +09:00 落到 22 点＝夜里，测试红不红就归时区管了（Task 19 Step 7
      // 的签子消耗表注释里记着这处同源坑）。
      companionOverrides: { random: () => 0.999, wallNow: () => new Date(2026, 9, 24, 13, 0, 0).getTime() },
    });
    const view = r as unknown as { cat: CatView; fps: number };
    return { loop, r, verge, cat: view.cat, fps: () => view.fps };
  }
  /**
   * init + 给齐几何 + 站好形态。三个动作缺一不可且顺序不能换：
   * - `tickCompanion` 在 catOrigin/workArea 缺失时整条链是空转（renderer.ts:393-394）；
   * - 四层通道与 `blink`/`mouse`/`expression` 只在 **girl** 路径上写，所以除第一条对照外
   *   每条都要 `form: "girl"`；写成默认 cat 会让「girl 的 blink 由绝对时钟决定」永远读 0，
   *   而 0 不大于 0.9 的红看起来像实现没写，其实是 harness 没站对形态。
   */
  async function up(clock: { ms: number }, form: "girl" | "cat" = "girl") {
    const t = makePet(clock);
    await t.r.init();
    t.r.syncGeometry({ bounds: centerBounds, workArea: waMain, tuckEnabled: false, tuckHinted: true, tuckLimit: 6 });
    t.r.setForm(form);
    return t;
  }
  /** 与 Task 12 的 `:248` 同口径（每帧 250ms，4fps 档全过闸）；describe 作用域，各段自带一份。 */
  function advance(loop: { fire(now: number): void }, clockRef: { ms: number }, frames: number): void {
    for (let i = 0; i < frames; i += 1) {
      clockRef.ms += 250;
      loop.fire(clockRef.ms);
    }
  }

  afterEach(() => {
    delete (window as unknown as { verge?: unknown }).verge;
  });

  it("猫形一字不变：blink 恒 0、mouse 恒 null、channels 恒空", async () => {
    const clock = { ms: 10_000 };
    // 走同一个 harness，只是显式站回 cat（构造默认也是 cat，这里写出来是为了让「对照」这件事
    // 在读代码时不必去查默认值）。harness 里那三件套（verge stub / localStorage 清零 / 时钟与
    // RNG 钉死）对这条同样必要，手写一份新的构造只会漏掉它们。
    const { loop, r, cat } = await up(clock, "cat");
    advance(loop, clock, 40);   // 10s：4.2s 周期里跨过眨眼窗两次以上
    expect(cat.blink).toBe(0);
    expect(cat.mouse).toBeNull();
    expect(cat.channels).toEqual({});
    r.dispose();
  });

  it("girl 的 blink 由绝对时钟决定，不靠帧累加：4fps 下一周期里必出现闭眼峰", async () => {
    const clock = { ms: 20_000 };
    const { loop, r, cat } = await up(clock);
    let peak = 0;
    for (let i = 0; i < 22; i++) { advance(loop, clock, 1); peak = Math.max(peak, cat.blink); }
    expect(peak).toBeGreaterThan(0.9);   // 22 × 250ms = 5.5s > 一个 4.2s 周期
    r.dispose();
  });

  it("setGaze 折掉 zoom 才写进 mouse；null 让眼珠回到程序化游走", async () => {
    const clock = { ms: 0 };
    const { loop, r, cat } = await up(clock);
    r.applyZoom(1.25);
    r.setGaze({ x: 60, y: 40 });          // CSS 客户端坐标
    advance(loop, clock, 1);
    expect(cat.mouse![0]).toBeCloseTo(60 / 1.25, 6);
    expect(cat.mouse![1]).toBeCloseTo(40 / 1.25, 6);
    r.setGaze(null);
    advance(loop, clock, 1);
    expect(cat.mouse).toBeNull();
    r.dispose();
  });

  it("走路不许滑步：walk 片的 p 就是 snapshot.step/(2π)，不是墙钟", async () => {
    const clock = { ms: 30_000 };
    const { loop, r, cat } = await up(clock);
    const here = r.getCompanionSnapshot()!.pos;
    r.roamTo({ x: here.x + 300, y: here.y });
    advance(loop, clock, 3);
    const snap = r.getCompanionSnapshot()!;
    expect(snap.activity).toBe("walk");            // 前置条件：不满足就是引擎被闸门拦住了，先修闸门
    const p = ((snap.step / (2 * Math.PI)) % 1 + 1) % 1;
    expect(cat.channels.legL).toBe(sampleClip(bodyClip("walk"), p).legL);
    expect(cat.channels.legL).not.toBe(0);         // 正对照：通道确实在被写，不是两边都拿 0 蒙对
    r.dispose();
  });

  it("一次性手势用墙钟：playGesture 起峰、到尾归零并让位（显式槽自清，不碰引擎槽）", async () => {
    const clock = { ms: 40_000 };
    const { loop, r, cat } = await up(clock);
    r.playGesture("wave");
    let peak = 0;
    for (let i = 0; i < 6; i++) { advance(loop, clock, 1); peak = Math.max(peak, cat.channels.armR ?? 0); }
    expect(peak).toBeGreaterThan(0.4);             // 2000ms 的片，6 帧=1.5s 一定扫过正弦峰
    advance(loop, clock, 6);                       // 累计 3s > 2s：片早完了
    expect(cat.channels.armR ?? 0).toBe(0);
    r.dispose();
  });

  it("物理档独占：beginDrag 之后 gesture 槽必须清空（priority 3 不与挥手叠加）", async () => {
    const clock = { ms: 50_000 };
    const { loop, r, cat } = await up(clock);
    r.playGesture("wave");
    advance(loop, clock, 1);
    expect(cat.channels.armR ?? 0).toBeGreaterThan(0);
    r.beginDrag();
    advance(loop, clock, 1);
    expect(cat.channels.armR ?? 0).toBe(0);
    expect(cat.channels.lean ?? 0).not.toBe(0);    // drag 片在 body 层生效
    r.dispose();
  });

  it("gesture 播放期提 30fps、播完回原档——不靠 setRedrawPolicy", async () => {
    const clock = { ms: 60_000 };
    const { loop, r, fps } = await up(clock);
    advance(loop, clock, 2);
    const baseline = fps();
    expect(baseline).toBeLessThanOrEqual(30);
    r.playGesture("nod");
    advance(loop, clock, 1);
    expect(fps()).toBe(30);
    advance(loop, clock, 12);                     // 3s > nod 的 1800ms
    expect(fps()).toBe(baseline);
    r.dispose();
  });

  it("一次性显式片放完 gestureProgress 必须归 null：槽位留着是设计，钉住 30fps 是 bug", async () => {
    const clock = { ms: 80_000 };
    const { loop, r } = await up(clock);
    const view = r as unknown as { gestureProgress: number | null };
    r.playGesture("wave");
    advance(loop, clock, 1);
    expect(view.gestureProgress).not.toBeNull();
    advance(loop, clock, 12);                    // 3s > wave 的 2200ms
    expect(view.gestureProgress).toBeNull();     // 不是 1：留个 1 会让 fps 判据永远读到「在播」
    r.dispose();
  });

  it("lasting 显式片压过映射片，只有 stopGesture() 才让位（spec §6「工作中要一直打字」）", async () => {
    const clock = { ms: 90_000 };
    const { loop, r, cat, fps } = await up(clock);
    r.playGesture("typeCode");
    // 逐帧取峰值：lasting 片按周期循环，某一帧正落在过零点＝0 并不说明它停了。
    let peak = 0;
    for (let i = 0; i < 8; i++) {
      advance(loop, clock, 1);
      peak = Math.max(peak, cat.channels.hand ?? 0);
    }
    expect(peak).toBeGreaterThan(0);
    expect(fps()).toBe(30);                      // 持续动＝持续 30fps，这是要的效果
    r.stopGesture();
    advance(loop, clock, 1);
    expect(cat.channels.hand ?? 0).toBe(0);
    r.dispose();
  });

  it("换形带走显式手势：girl 打到一半切回猫形，不许把 lasting 槽留成常驻", async () => {
    const clock = { ms: 100_000 };
    const { loop, r, fps } = await up(clock);                    // up 的默认形态就是 girl
    r.playGesture("typeCode");
    advance(loop, clock, 1);
    expect(fps()).toBe(30);
    r.setForm("cat");
    advance(loop, clock, 1);
    expect(fps()).toBeLessThanOrEqual(4);         // 猫形静置档；显式槽若漏清，这里会读到 30
    r.setForm("girl");                            // 切回来——这才是这条要验的那一下
    advance(loop, clock, 1);
    expect(fps()).toBeLessThanOrEqual(4);         // 显式槽不许复活
    r.dispose();
  });

  it("expression 走 mood 差分表：sleep → sleepy", async () => {
    const clock = { ms: 70_000 };
    const { loop, r, cat } = await up(clock);
    r.handleCommand("toggle-sleep");
    advance(loop, clock, 1);
    expect(cat.expression).toBe("sleepy");
    r.dispose();
  });

  it("setRedrawPolicy 已删：留一个下一帧就被覆盖的公共 API 是陷阱", () => {
    const r = new PixelPetRenderer({ canvas: makeCanvas(), width: 82, height: 108, onLoad: vi.fn(), onError: vi.fn() });
    expect((r as unknown as { setRedrawPolicy?: unknown }).setRedrawPolicy).toBeUndefined();
    r.dispose();
  });
});
```

新用到 `sampleClip` 与 `bodyClip`：在本文件顶部的 import 里补 `import { bodyClip, sampleClip } from "./motion";`。

- [ ] **Step 2: 跑红**

Run: `CI=true npx vitest run src/renderer/pet/girl.test.ts src/renderer/pet/renderer.test.ts`
Expected: `girl.test.ts` 的「15 条通道全部有消费者」列出全部 15 条为 `dead`（或 TS 直接报 `channels` 不在 `PetInput` 上）；`renderer.test.ts` 报 `r.setForm is not a function`。
若「猫形一字不变」当场就绿：别当成果——它要等到 Step 3 给 `this.cat` 补上三个字段之后才算真在测东西。Step 4 再确认它仍是绿。

- [ ] **Step 3: 实现**

`form.ts:1333` 扩三条**可选**轴。可选是硬要求：Task 6 的 `expect(buildPetOps({ ...NEUTRAL })).toEqual(buildCatOps(NEUTRAL))` 和 girl/face 全部单测构造都不带 `channels`，写成必填会让一批测试同时编译失败，那时人一定有改测试而不是改类型的冲动——而那正是把断言调软的动作。

```ts
import type { Channels } from "./motion";
import type { Expression } from "./face";

/** P1 只有 form 一条轴；本期补通道/表情/说话三条，全部可选，回落口径见 girl.ts 的 ch()。 */
export type PetInput = CatInput & {
  form?: PetForm;
  channels?: Channels;
  expression?: Expression;
  speaking?: boolean;
};
```

`girl.ts` 的取值口——一张表管所有助手的回落，别把 `??` 散进骨架各处：

```ts
/**
 * 通道优先、pose 回落。这张表是 P1 遗留口径的唯一保留地：
 * | 通道 | 回落表达式 | 为什么是它 |
 * |---|---|---|
 * | lean | pose.tilt × 0.006 | 13° × 0.006 ≈ 0.078rad（4.5°）；Task 6 的角度上限断言钉着 |
 * | headYaw | pose.tilt·π/180 + pose.engagement×0.04 | 头单独歪 13°，与四足同角 |
 * | armL/armR/legL/legR/hand/hop/headBob/headPitch/squash/hem/tail/earL/earR | 0 | P1 没有对应物；非零即新行为 |
 */
function ch(i: PetInput, name: Channel, legacy: number): number {
  const v = i.channels?.[name];
  if (v === undefined) return legacy;
  if (!Number.isFinite(v)) throw new Error(`通道 ${name} 不是有限数：${String(v)}`);
  return v;
}
```

`girlRig` 的九处消费（其余保持 Task 6 原文；`matRoot` 的支点是 viewBox `(60,100)`，与 `GIRL_PROPORTION.footY = 100` 重合 ⇒ 直接缩 `a`/`d` 就是绕脚线压扁，**不需要补 `f`**）：

```ts
  const sq = Math.max(0, Math.min(1, ch(input, "squash", 0)));
  const hop = ch(input, "hop", 0);                      // viewBox px，负＝向上
  const s = input.s;
  // 影子留在地上：root 抬了，ground 不许跟着抬。
  const ground = matRoot(input.center, s);
  const root = matRoot({ x: input.center.x, y: input.center.y + hop * s }, s);
  root.a *= 1 + 0.12 * sq;
  root.d *= 1 - 0.18 * sq;
  const hips = matJoint(root, { at: [60, GIRL_PROPORTION.waistY], rot: 0, sx: 1, sy: 1 });
  const spine = matJoint(hips, { at: [0, 0], rot: lean(input), sx: 1, sy: 1 });
  const bob = ch(input, "headBob", 0) + ch(input, "headPitch", 0) * 2.2;   // 低头＝五官相对头下移，正数向下
  const head = matJoint(spine, {
    at: [0, GIRL_PROPORTION.headCy - GIRL_PROPORTION.waistY + bob],
    rot: headYaw(input), sx: 1, sy: 1,
  });
  const armL = matJoint(spine, { at: [-GIRL_PROPORTION.shoulderDx, GIRL_PROPORTION.shoulderY - GIRL_PROPORTION.waistY], rot: armSwing(input, "l"), sx: 1, sy: 1 });
  const armR = matJoint(spine, { at: [GIRL_PROPORTION.shoulderDx, GIRL_PROPORTION.shoulderY - GIRL_PROPORTION.waistY], rot: armSwing(input, "r"), sx: 1, sy: 1 });
  const handL = matJoint(armL, { at: [0, 22], rot: ch(input, "hand", 0), sx: 1, sy: 1 });
  const handR = matJoint(armR, { at: [0, 22], rot: ch(input, "hand", 0), sx: 1, sy: 1 });
  const legL = matJoint(root, { at: [-6, GIRL_PROPORTION.waistY], rot: ch(input, "legL", 0), sx: 1, sy: 1 });
  const legR = matJoint(root, { at: [6, GIRL_PROPORTION.waistY], rot: ch(input, "legR", 0), sx: 1, sy: 1 });
  const tailRoot = matJoint(root, { at: [10, GIRL_PROPORTION.hemY - 4], rot: ch(input, "tail", 0), sx: 1, sy: 1 });
  const earL = matJoint(head, { at: [-12, -18], rot: ch(input, "earL", 0), sx: 1, sy: 1 });
  const earR = matJoint(head, { at: [12, -18], rot: ch(input, "earR", 0), sx: 1, sy: 1 });
  return { hips, spine, head, armL, armR, handL, handR, legL, legR, tailRoot, earL, earR, ground };
```

配套四处：
- `lean(input)` = `ch(input, "lean", (input.pose.tilt ?? 0) * 0.006)`；`headYaw(input)` = `ch(input, "headYaw", ((input.pose.tilt ?? 0) * Math.PI) / 180 + input.pose.engagement * 0.04)`；`armSwing(input, side)` = `ch(input, side === "l" ? "armL" : "armR", 0)`。Task 6 里那个 `headTilt` 名字统一改成 `headYaw`，与 `Channel` 同名——两套名字迟早会有一处接错。
- `ears` 部件的两枚外耳/内耳 `fillPath` 改经 `earL`/`earR`：局部顶点写 `[-12,-18] [-16,-36] [-4,-22]` 与其 x 镜像（`earR` 用 `at: [12,-18]` 加正角度时镜像顶点仍要按 x 反号写，`toMap2` 之后由阵负责）。判据不变：4 条、外耳面积 > 内耳面积。
- `ground_shadow` 部件改接 `ground` 阵，并按四足同一式收半径与浓度：`lift = Math.max(0, Math.min(1, -ch(input, "hop", 0) / 26))`，`rx ×= 1 − 0.25·lift`、`ry ×= 1 − 0.3·lift`、alpha `×= 1 − 0.55·lift`（`art.ts:264-268` 的五个数一字不改地搬过来，两形态共用一条口径）。
- `dress` 的两式下沿与两侧 x 加 `hem * 1.5`，**腰那两点（`points[0]`/`points[1]`）不动**；`squash` 已由 root 承担，裙摆不许二次压——两处都压会把褶子叠成 1.3 倍变形。

`renderer.ts` 的三张表：

```ts
/** body 层：12 个引擎动作全覆盖。 */
const ACTIVITY_BODY: Record<CompanionActivity, string | null> = {
  idle: "stand", walk: "walk", groom: "stand", yawn: "stand", stretch: "stand", tilt: "stand",
  sleep: "sleep", pet: "stand", eat: "stand", play: "stand", drag: "drag", thrown: "thrown",
};
/**
 * groom/yawn/stretch/pet/eat/play 全映射到 stand：身子停在站姿上继续呼吸，动作只走 gesture/face 层。
 * 映射成 null 会让 body 槽整个空掉、连 stand 的呼吸通道一起归零，站姿会僵成一张贴图。
 */
/** gesture 层本期只有 tilt。groom/yawn/stretch 三条片 Task 21 落地时把这张表补全——提前写进表会让 gestureClip() 当场抛（片名还没注册）。 */
const ACTIVITY_GESTURE: Partial<Record<CompanionActivity, string>> = { tilt: "tilt" };
/** 唯一由位移而不是墙钟驱动周期的片：步频跟着引擎的 55px/s 走，脚才不会原地打滑。 */
const STEP_DRIVEN: ReadonlySet<string> = new Set(["walk", "run"]);
```

槽位状态与推进：

```ts
  private form: PetForm = "cat";
  private gaze: { x: number; y: number } | null = null;
  private slots: Partial<Record<MotionLayer, { clip: Clip; startedAt: number }>> = {};
  private explicitGesture: { clip: Clip; startedAt: number } | null = null;
  /** 这一帧手势层的真实进度，供 fps 判据读；每次 tickSlots 覆写，不在 draw 外维护第二套口径。 */
  private gestureProgress: number | null = null;

  setForm(form: PetForm): void {
    if (form === this.form) return;
    this.form = form;
    // 换形是外观口径的整体切换：槽位不清，上一形算出来的通道值会被下一形接着用。
    this.slots = {};
    this.explicitGesture = null;
    this.gestureProgress = null;
    this.cat.form = form;
    if (form === "cat") {
      this.cat.channels = {};
      this.cat.blink = 0;
      this.cat.mouse = null;
    }
    if (!this.paused) this.draw(performance.now());   // 与 :199/:210/:252 同一套即时补画
  }

  setGaze(css: { x: number; y: number } | null): void {
    this.gaze = css;
  }

  playGesture(id: string, now = performance.now()): void {
    this.explicitGesture = { clip: gestureClip(id), startedAt: now };
  }

  /** 收掉显式手势：lasting 片（打字 / 偷看）靠它落地，否则会把 activity 映射片一直压在下面。 */
  stopGesture(): void {
    this.explicitGesture = null;
  }

  /**
   * 一帧一层最多一片。lasting 片换名即重起周期；一次性片放完**不自清，钉在 p=1 停住**——
   * 尺 #73 保证 p=1 就是 rest 姿势，于是「停在末帧」与「没有这片」画出来一字不差，
   * 而槽位留着还能让 fps 判据读到真实进度。删槽位与算 fps 两套口径只能留一套。
   */
  private slotFor(layer: MotionLayer, wantId: string | null, now: number, snapshot: CompanionSnapshot): { clip: Clip; p: number } | null {
    const cur = this.slots[layer];
    if (!wantId) {
      if (!cur) return null;
      return { clip: cur.clip, p: Math.min(1, (now - cur.startedAt) / cur.clip.ms) };
    }
    const clip = layer === "body" ? bodyClip(wantId) : gestureClip(wantId);
    if (cur?.clip.id !== wantId) this.slots[layer] = { clip, startedAt: now };
    const st = this.slots[layer]!;
    if (!clip.lasting) return { clip, p: Math.min(1, (now - st.startedAt) / clip.ms) };
    if (STEP_DRIVEN.has(clip.id)) {
      const q = (snapshot.step / (2 * Math.PI)) % 1;
      return { clip, p: q < 0 ? q + 1 : q };
    }
    const cyc = ((now - st.startedAt) / clip.ms) % 1;
    return { clip, p: cyc < 0 ? cyc + 1 : cyc };
  }

  /**
   * 手势层仲裁：显式播放（workStatus / 触摸）压过 activity 映射片。
   * 一次性显式片放完即让位， lasting 显式片一直压到 stopGesture()——「工作中要持续打字」是 spec §6 写死的口径，
   * 所以这里不能让引擎槽位说话，只能让状态源说话。
   */
  private gestureSlotFor(now: number, snapshot: CompanionSnapshot): { clip: Clip; p: number } | null {
    if (this.explicitGesture) {
      const p = (now - this.explicitGesture.startedAt) / this.explicitGesture.clip.ms;
      if (p >= 1 && !this.explicitGesture.clip.lasting) this.explicitGesture = null;
      else return { clip: this.explicitGesture.clip, p: Math.min(1, p) };
    }
    return this.slotFor("gesture", ACTIVITY_GESTURE[snapshot.activity] ?? null, now, snapshot);
  }

  private tickSlots(now: number, snapshot: CompanionSnapshot): Slots {
    const out: Slots = {};
    const body = this.slotFor("body", ACTIVITY_BODY[snapshot.activity], now, snapshot);
    if (body) out.body = body;
    // 物理档（priority 3）独占：drag/thrown 在跑时不叠手势——两只手得跟着身子一起甩。
    if (out.body && out.body.clip.priority === 3) {
      this.explicitGesture = null;
      delete this.slots.gesture;
    } else {
      const gesture = this.gestureSlotFor(now, snapshot);
      if (gesture) out.gesture = gesture;
    }
    this.gestureProgress = out.gesture ? out.gesture.p : null;
    return out;                 // face 层的槽位本期恒空：表情走 Expression 差分表，不走通道
  }
```

`applyLayerPose`——`applyCatPose` 保持那 15 行一字不动（Task 8 的口径差④）：

```ts
  private applyLayerPose(snapshot: CompanionSnapshot): void {
    const slots = this.tickSlots(performance.now(), snapshot);
    const mixed = mixPose(slots);
    this.cat.mood = snapshot.mood;
    this.cat.facing = snapshot.facing;
    this.cat.energy = snapshot.vitals.energy;
    this.cat.expression = MOOD_TO_EXPRESSION[snapshot.mood];
    this.cat.speaking = this.bubbleExpand > 0 && this.bubbleText !== "";
    // 落地压扁与呼吸压扁共用一条通道：相加再夹 0..1，谁都不许把对方吃掉。
    this.cat.channels = { ...mixed, squash: Math.max(0, Math.min(1, (mixed.squash ?? 0) + snapshot.squash)) };
    this.cat.jumpY = mixed.hop ?? 0;                       // 与 CatInput.jumpY 同单位同符号（负＝向上）
    this.cat.pet = snapshot.activity === "pet" ? Math.max(0.15, 1 - snapshot.activityProgress) : 0;
    // 死通道复活：这两行是本期唯一让 blink/mouse 有意义之处，且只在 girl 形。
    // 安静期的半闭眼沿用 art.ts:334 的 0.82 同一个数——两形态分叉会让月牙那档的屏幕尺也要按形写两遍。
    this.cat.blink = Math.max(blinkAt(this.cat.t), this.quiet ? 0.82 : 0);
    const z = this.zoom || 1;
    this.cat.mouse = this.gaze ? [this.gaze.x / z, this.gaze.y / z] : null;
  }
```

`draw()` 的两处：

```ts
    if (snapshot) (this.form === "cat" ? this.applyCatPose : this.applyLayerPose).call(this, snapshot);
```
```ts
    // 读的是这一帧算出的 p，不是「槽位存不存在」：槽位现在会一直留着（见 slotFor），按存在性判会永久钉住 30fps。
    const gestureActive = this.gestureProgress !== null && this.gestureProgress < 1;
    if (moving) this.fps = FPS_HOVER;
    else if (peekAnimating || this.bubbleExpand > 0 || animating || gestureActive) this.fps = FPS_ACTIVE;
    else this.fps = FPS_IDLE;
```

`setRedrawPolicy` 整段删除。spec §13 给的「接线或删掉」二选一，这里选删：**它的入参是外部一次性设定，而三个判据每帧都可观察，留着等于留一个下一帧必被覆盖的公共 API**，读代码的人会以为能用它调帧率。`:54` 那句注释同步改成「三档由 `draw()` 每帧按 moving/animating/gesture 判据选档」。

`companionOverrides` 落在构造点（`:138-145`）：

```ts
      this.engine = new CompanionEngine({
        storage,
        now: () => performance.now(),
        wallNow: () => opts.companionOverrides?.wallNow?.() ?? Date.now(),
        random: opts.companionOverrides?.random,
        onMove: (position) => this.onCompanionMove(position),
        onSettle: (position) => this.onCompanionSettle(position),
      });
```

`main.ts` 的两处（顺序敏感，`pointermove` 的那段必须写在两个早退之前——按住不动的那段也要看着人）：

```ts
addTrackedEventListener(canvas, "pointermove", (e) => {
  const event = e as PointerEvent;
  if (!isDragging) {
    const rect = canvas.getBoundingClientRect();
    renderer.setGaze({ x: event.clientX - rect.left, y: event.clientY - rect.top });
  }
  if (isDragging) {
    recordMoveSample(event.screenX, event.screenY, performance.now());
```
```ts
  void window.cyrene.setInteractive(false);
  renderer.setUserActive(false);
  renderer.setGaze(null);   // 光标出窗即收回视线：不回 null，猫会一直盯着人最后待过的那一点
```

- [ ] **Step 4: 跑绿**

Run: `CI=true npx vitest run src/renderer/pet/`，随后 `CI=true npx vitest run`
Expected: 全绿。「猫形一字不变」必须仍是绿——它证明本期没有把 girl 的口径渗进四足路径；`art-golden.test.ts` 六条逐字节断言管图元，这条管输入侧，两道闸各管一头。`--form=cat`（Task 6 的进程内覆盖）启一次，肉眼确认四足与 v1.4.0 截图一致后才算过。

- [ ] **Step 5: 同进程 CPU A/B 量测并落台账**

按 `桌宠性能测量口径` 的老规矩：**同进程 A/B，跨会话基线不算数**；CPU 随状态差约 10 倍，必须分段取样，且按窗口 PID 取。三趟各 60s，状态一律「静置不漫游」（`tuckEnabled: true` 贴右缘，或把 workArea 收到刚好等于窗口位）：
1. `--form=cat` 静置（v1.4.0 现口径）；
2. `--form=girl` 静置（stand 呼吸在跑）；
3. `--form=girl` + 每 3s 一次 `playGesture("wave")`（落在 30fps 档）。

三行的均值写进 `docs/verge/notes/progress.md` 本期小节，格式 `cat 静置 X.X% / girl 静置 Y.Y% / girl 手势 Z.Z%`，并附注手势档实际帧率。**若第 3 行 > 第 1 行 × 3**，把手势档从 `FPS_ACTIVE`(30) 降到 24 复测，台账里改前的数一起留着——不许静默改常量。

- [ ] **Step 6: 台账与提交**

`docs/verge/notes/progress.md` 本期小节补一条工程账（不是口径差）：`renderer.test.ts` 的四段 describe（Task 12/14/17/18）各带一份 `advance`/`makeXxx` harness，本期不抽公共层。理由与影响面写全：`makeVergeStub`（`:227`）与 `advance`（`:248`）都在 Task 12 的 describe 作用域里，本来就跨不出去；抽到模块作用域要回头改那 7 条 tuck 用例的取样口径，而 R-D2 对四足路径的硬约束是「一字不变」。这笔债交给 Task 28 写进 spec §13 的延后清单。

```bash
git add src/renderer/pet/form.ts src/renderer/pet/girl.ts src/renderer/pet/renderer.ts src/renderer/main.ts src/renderer/pet/renderer.test.ts src/renderer/pet/girl.test.ts docs/verge/notes/progress.md
git commit -m "feat(pet): 四层合成接进 renderer（blink/gaze 复活 + 槽位时钟 + 手势提帧），删掉 setRedrawPolicy

ACTIVITY_BODY 12 项全覆盖并把 groom/yawn/stretch/pet/eat/play 都映射到 stand（映射成 null 会连
呼吸通道一起归零，站姿会僵成贴图）；ACTIVITY_GESTURE 本期只 tilt，另外三条片 Task 21 才有。
walk/run 的 p 由 snapshot.step 驱动而不是墙钟：55px/s 的步频跟脚，不然猫原地打滑。

setRedrawPolicy 选择删除而不是接线：三个判据每帧都可观察，外部 setter 下一帧必被覆盖。
hop 抬身不抬影（ground 阵独立于 root），影子按 art.ts:264-268 那五个数一起收；squash 绕
viewBox y=100 即 GIRL_PROPORTION.footY，不用补 f。安静期半闭眼沿用 0.82 同一个数。

companionOverrides{random,wallNow}：不钉 RNG 与挂钟，闲置抽签会决定这几帧里猫是站着还是睡着，
blink 峰、fps 基线与表情差分三组判据跟着漂——而「漂过去正好对上」就是假绿。生产不传，行为一字不动。"
```

---
---
## Task 15: IPC 发送方白名单（R-D11，P3 安全门）

**Files:**
- Create: `src/main/application/window-kind.ts`（`webContents.id → WindowKind` 登记簿，不 import electron）
- Create: `src/main/application/ipc-sender-policy.ts`（channel → 允许的类别，闸门唯一真相）
- Modify: `src/main/application/ipc-scope.ts:10-14`（`IpcScope` 接口不动）、`:27`（加第二参数）、`:39-48`（`handle` 包闸门）、`:63-66`（`on` 包闸门）
- Modify: `src/main/application/default-dependencies.ts:382`（`createIpcScope: () => createIpcScope()` 注入 policy + classify）
- Modify: `src/main/windows/window-manager.ts:205-235`（`setPetWindow` 登记 pet、`webContents.on("destroyed")` 注销）、`:307`（chatShell 登记 chat）、`:166-176`（onboarding 登记 chat）
- Test: `src/main/application/window-kind.test.ts`（新建）
- Test: `src/main/application/ipc-sender-gate.test.ts`（新建）
- Test: `src/main/application/ipc-gate-wiring.test.ts`（新建，源码文本锁）

**为什么闸门在 scope 里、而不是在每个注册点写 `if`**：`grep -c "\.handle(" src/main` 实测 **328 处**。逐个加参数会把这 328 处全拖进本期改动，而 `ipc-contract.test.ts` 的扫描器只认 `node.arguments[0]`（`ipc-contract-scanner.ts`），加第二参不影响它——但真正的理由是**两处真相**：一旦允许「表 + 调用点内联 `allow`」并存，腐烂的那一处永远是调用点。表是唯一入口，`handle(channel, listener)` 签名一字不改。

**为什么按 `webContents.id` 而不是 `senderFrame.url`**：8 个窗口共用同一条 preload（`create-pet-window.ts:110`、`create-aux-windows.ts:79/156/218/292`、`create-music-player-window.ts:46`、`create-toast-window.ts:37`），dev 下 origin 全是 `http://localhost:5173`，prod 下 `loadFile` 的 url 也同盘；URL 分不出 pet 与 toast。而 Electron 44 的 `electron.d.ts` 里 `getData(` **0 命中**（WebContents tag API 在本版本不可用），所以只有 id 这条路。id 分不出来的那一层（同类多窗）不是本期要防的：本期要防的是「toast/music/call 这些窗口能改代理配置、能挪猫」。

**表的推导（Step 0，必须现场跑，不许照抄本节的结论）**：

```bash
# 入站 channel 全集（handle + on）
grep -rn "ipc.handle(IPC.VERGE\|ipc.on(IPC.VERGE" src/main --include=*.ts | grep -v "\.test\."
# 每条在渲染端的调用方；渲染端有两个包：pet 包 = src/renderer/main.ts + src/renderer/pet/**，chat 包 = src/renderer/react/**
grep -rn "window\.verge" src/renderer/main.ts src/renderer/pet src/renderer/react --include=*.ts --include=*.tsx | grep -v "\.test\."
```

2026-10-24 实测结论（实现时逐行复核，任何一行对不上就改表而不是改判据）：

| channel | 调用方（文件:行） | 允许类别 |
|---|---|---|
| `VERGE_NETWORK_GET` / `REFRESH` / `SET_MODE` / `SELECT_NODE` / `TEST_GROUP` / `AUTO_SELECT` | `react/features/network/NetworkPanel.tsx:86` | `["chat"]` |
| `VERGE_GET_APP_INFO` | `react/components/ui/UserAvatar.tsx:36`、`react/features/settings/GeneralSettingsPanel.tsx:53` | `["chat"]` |
| `VERGE_IS_QUIET` | `src/renderer/main.ts:100` | `["pet"]` |
| `VERGE_GET_PET_GEOMETRY` | `src/renderer/main.ts:115/342` | `["pet"]` |
| `VERGE_PET_RESIZE`（`on`） | `src/renderer/pet/renderer.ts:520` | `["pet"]` |
| `VERGE_PET_POSITION_SETTLED`（`on`） | `src/renderer/pet/renderer.ts:360` | `["pet"]` |
| `VERGE_TUCK_HINTED`（`on`） | `src/renderer/pet/renderer.ts:584` | `["pet"]` |
| `VERGE_TOGGLE_QUIET`、`VERGE_GET_SNAPSHOT`、`VERGE_SET_TUCK` | 渲染端 0 处调用（免打扰走原生右键菜单直调；`onQuietChanged` 那批是 **preload 里的 `ipcRenderer.on`**，不是主进程入站） | **不进表** |

「无调用方不进表」是硬规矩：表里的死行比没表更糟——它会让人以为这条 channel 已被守。**这三条查出来的零调用方要落进 `docs/verge/notes/progress.md` 台账**，它们是 `ipc-contract.test.ts` 反向对账（「不留白名单」）在入站方向上的同类发现，本期不修、只记。

**Interfaces:**
- Consumes: `IPC`（`src/shared/ipc-channels.ts`）、`IpcScopeMainLike`（`ipc-scope.ts:19-24`）、`BrowserWindow.webContents.id`
- Produces:
  - `type WindowKind = "pet" | "chat" | "unknown"`（`window-kind.ts`）——类别按 **渲染包** 命名而不是按窗口角色：onboarding 窗与 chat 窗加载同一份 `dist/renderer/react/index.html`（`create-aux-windows.ts:130-135/156`），所以同为 `chat`
  - `markWebContents(id: number, kind: Exclude<WindowKind, "unknown">): void` / `forgetWebContents(id: number): void` / `windowKindOf(id: number): WindowKind`
  - `IPC_SENDER_POLICY: Readonly<Record<string, readonly WindowKind[]>>`
  - `createIpcScope(main?, options?: { senderPolicy?; classify? }): IpcScope`——`IpcScope` 接口本身不变，328 处调用点零改动
  - 拒绝语义：`handle` 在监听器内 `throw`（渲染端 `invoke` 当场 reject，响亮）；`on` 丢弃事件 + 同一 `channel:类别` 只 `console.warn` 一次（toast 若逐帧误发会变成日志洪水）

- [ ] **Step 0: 复核表的三行推导**

跑上面两条 grep。若 `VERGE_NETWORK_*` 出现了 pet 包调用方，把该行的允许集合扩成 `["pet","chat"]`，并在台账里记「2026-10-24 计划里的推导已过期」。这一步的唯一产物是「表与 grep 一致」这个事实本身。

- [ ] **Step 1: 写失败测试**

`src/main/application/window-kind.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { forgetWebContents, markWebContents, windowKindOf } from "./window-kind";

describe("window-kind 登记簿 (Task 15)", () => {
  // 不加重置 API：测试用各自号段，生产靠 forgetWebContents 逐窗注销。
  // 「测试专用导出进了生产模块」正是 TDD 技能里那条「test-only code 不许进 prod class」。
  it("未登记的 id 一律 unknown：fail-closed 的唯一含义", () => {
    expect(windowKindOf(900_001)).toBe("unknown");
  });

  it("登记后可读；forget 之后回到 unknown 而不是残留上一个类别", () => {
    markWebContents(900_002, "pet");
    expect(windowKindOf(900_002)).toBe("pet");
    forgetWebContents(900_002);
    expect(windowKindOf(900_002)).toBe("unknown");
  });

  it("重复登记以最后一次为准（猫窗重建后同一号段 reused 的口径）", () => {
    markWebContents(900_003, "chat");
    markWebContents(900_003, "pet");
    expect(windowKindOf(900_003)).toBe("pet");
  });
});
```

`src/main/application/ipc-sender-gate.test.ts`：

```ts
import { describe, expect, it, vi } from "vitest";
import { createIpcScope, type IpcScopeMainLike } from "./ipc-scope";
import type { WindowKind } from "./window-kind";

const CH_PET = "verge:pet-probe";
const CH_CHAT = "verge:chat-probe";
const CH_ON = "verge:on-probe";
const CH_OPEN = "verge:not-in-table";

const POLICY = {
  [CH_PET]: ["pet"] as const,
  [CH_CHAT]: ["pet", "chat"] as const,
  [CH_ON]: ["pet"] as const,
} as Readonly<Record<string, readonly WindowKind[]>>;

/** 假 main：按 Electron 的实参形状把 event 传进监听器，并记下每次真正交给它的那个函数。 */
function makeMain() {
  const handles = new Map<string, (...args: unknown[]) => unknown>();
  const ons = new Map<string, (...args: unknown[]) => unknown>();
  const removedListeners: Array<[string, (...args: unknown[]) => unknown]> = [];
  const main: IpcScopeMainLike = {
    handle(channel, listener) { handles.set(channel, listener as never); return undefined; },
    on(channel, listener) { ons.set(channel, listener as never); return undefined; },
    removeHandler(channel) { handles.delete(channel); return undefined; },
    removeListener(channel, listener) { removedListeners.push([channel, listener as never]); ons.delete(channel); return undefined; },
  };
  return {
    main,
    handles,
    ons,
    removedListeners,
    /** sender 由测试扮演：id 决定类别。 */
    ask(channel: string, id: number) {
      return handles.get(channel)?.({ sender: { id }, senderFrame: { url: "http://localhost:5173" } });
    },
    push(channel: string, id: number) {
      ons.get(channel)?.({ sender: { id }, senderFrame: { url: "http://localhost:5173" } });
    },
  };
}

function makeScope(f: ReturnType<typeof makeMain>, classify = (id: number): WindowKind => (id === 1 ? "pet" : id === 2 ? "chat" : "unknown")) {
  return createIpcScope(f.main, { senderPolicy: POLICY, classify });
}

describe("IpcScope 发送方闸门 (Task 15)", () => {
  it("pet 发 pet channel 放行，返回值原样透出", () => {
    const f = makeMain();
    const scope = makeScope(f);
    const real = vi.fn(() => "ok");
    scope.handle(CH_PET, real);
    expect(f.ask(CH_PET, 1)).toBe("ok");
    expect(real).toHaveBeenCalledTimes(1);
    scope.dispose();
  });

  it("chat 发 pet channel 当场抛，且真监听器一次都没跑", () => {
    const f = makeMain();
    const scope = makeScope(f);
    const real = vi.fn(() => "ran");
    scope.handle(CH_PET, real);
    expect(() => f.ask(CH_PET, 2)).toThrow(/IPC sender denied/);
    expect(() => f.ask(CH_PET, 2)).toThrow(CH_PET);
    expect(() => f.ask(CH_PET, 2)).toThrow(/chat/);   // 点名是谁被挡，排查时不必猜
    expect(real).not.toHaveBeenCalled();              // 这条才是闸门的牙：只抛不拦＝没拦
    scope.dispose();
  });

  it("未登记 id＝unknown 也拒；policy 里没这条 channel 时任何 id 都放行且不问 classify", () => {
    const f = makeMain();
    const classify = vi.fn<(id: number) => WindowKind>(() => "unknown");
    const scope = createIpcScope(f.main, { senderPolicy: POLICY, classify });
    const open = vi.fn(() => 42);
    scope.handle(CH_OPEN, open);
    expect(f.ask(CH_OPEN, 999)).toBe(42);
    expect(open).toHaveBeenCalledTimes(1);
    expect(classify).not.toHaveBeenCalled();          // 328 处既有注册不许被拖进这条码路
    expect(f.ask(CH_PET, 999)).toThrow(/unknown/);    // unknown 走 pet channel：拒
    scope.dispose();
  });

  it("on 被拒只丢事件不抛，且同一 channel+类别只 warn 一次", () => {
    const f = makeMain();
    const scope = makeScope(f);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const real = vi.fn();
    scope.on(CH_ON, real);
    f.push(CH_ON, 2);
    f.push(CH_ON, 2);
    f.push(CH_ON, 999);                               // chat 与 unknown 是两个不同的键，各报一次
    expect(real).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(2);
    f.push(CH_ON, 1);
    expect(real).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    scope.dispose();
  });

  it("senderId 取不到时按拒绝处理，不许当成 0 号窗口放行", () => {
    const f = makeMain();
    const scope = makeScope(f);
    scope.handle(CH_PET, () => "ran");
    expect(() => f.handles.get(CH_PET)!({} as never)).toThrow(/IPC sender denied/);
    scope.dispose();
  });

  it("senderPolicy 非空却没传 classify：构造当场抛，不许静默全放行", () => {
    const f = makeMain();
    expect(() => createIpcScope(f.main, { senderPolicy: POLICY })).toThrow(/classify/);
  });

  it("不传 options：与改动前完全同构（328 处的默认路径不受影响）", () => {
    const f = makeMain();
    const scope = createIpcScope(f.main);
    const real = vi.fn(() => "ok");
    scope.handle(CH_PET, real);
    expect(f.handles.get(CH_PET)!({ sender: { id: 2 } } as never)).toBe("ok");
    expect(real).toHaveBeenCalledTimes(1);
    scope.dispose();
  });

  it("dispose 注销的是真正交给 main 的那个包装函数（存原函数＝监听器留在 ipcMain 上）", () => {
    const f = makeMain();
    const scope = makeScope(f);
    scope.on(CH_ON, () => {});
    const handed = f.ons.get(CH_ON)!;
    scope.dispose();
    expect(f.removedListeners).toEqual([[CH_ON, handed]]);   // 引用相等，不是「有个同签名函数」
  });

  it("policy 每行都有主进程入站注册；查零调用方的 channel 不许进表", async () => {
    const { IPC } = await import("../../shared/ipc-channels");
    const { IPC_SENDER_POLICY } = await import("./ipc-sender-policy");
    const fs = await import("node:fs");
    const keyOf = new Map<string, string>(Object.entries(IPC).map(([k, v]) => [v as string, k]));
    const regFiles = [
      "src/main/application/default-dependencies.ts",
      "src/main/verge/network-ipc.ts",
      "src/main/verge/verge-ipc.ts",
      "src/main/verge/app-info-ipc.ts",
      "src/main/windows/window-system-ipc.ts",
    ].map((p) => fs.readFileSync(p, "utf8")).join("\n");
    for (const [channel, kinds] of Object.entries(IPC_SENDER_POLICY)) {
      const key = keyOf.get(channel);
      expect(key, `${channel} 不是 IPC 常量表里的值`).toBeDefined();
      expect(kinds.length, `${channel} 的允许集合是空集＝永久拒绝，等于没注册`).toBeGreaterThan(0);
      // 真注册存在：表里守一条没人注册的 channel 是空转闸。
      expect(regFiles, `${channel} 在 main 侧没有 ipc.handle/ipc.on 注册`).toMatch(
        new RegExp(`ipc\\.(handle|on)\\(IPC\\.${key}\\b`),
      );
    }
    // 2026-10-24 grep 实测渲染端 0 处调用（免打扰走原生右键菜单直调 main）：进表＝死行。
    for (const dead of [IPC.VERGE_TOGGLE_QUIET, IPC.VERGE_GET_SNAPSHOT, IPC.VERGE_SET_TUCK]) {
      expect(IPC_SENDER_POLICY[dead], `${dead} 零调用方，不该进发送方表`).toBeUndefined();
    }
  });
});
```

`src/main/application/ipc-gate-wiring.test.ts`（源码文本锁，与 `ipc-contract.test.ts` 同一类做法——单测能证明闸门有牙，证明不了生产真的接上）：

```ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";

describe("发送方闸门的生产接线 (Task 15)", () => {
  it("default-dependencies 把 policy 与 classify 一起注入唯一的生产 scope", () => {
    const src = fs.readFileSync("src/main/application/default-dependencies.ts", "utf8");
    const line = src.split("\n").find((l) => l.includes("createIpcScope: () =>"));
    expect(line).toBeDefined();
    expect(line).toContain("senderPolicy");
    expect(line).toContain("classify");
  });

  it("窗口层登记 pet 与 chat 两类；没有登记就等于全部 unknown", () => {
    const src = fs.readFileSync("src/main/windows/window-manager.ts", "utf8");
    expect(src).toContain('markWebContents(');
    expect(src).toContain('"pet"');
    expect(src).toContain('"chat"');
    expect(src).toContain("forgetWebContents(");
  });
});
```

- [ ] **Step 2: 跑红**

Run: `CI=true npx vitest run src/main/application/window-kind.test.ts src/main/application/ipc-sender-gate.test.ts src/main/application/ipc-gate-wiring.test.ts`
Expected: 前两个文件报模块找不到（`Cannot find module './window-kind'`）；`ipc-gate-wiring.test.ts` 三条里 `createIpcScope: () =>` 那行 `toContain("senderPolicy")` 失败——这条**会先红后绿**，别把它当「测试写错了」。

- [ ] **Step 3: 实现**

`src/main/application/window-kind.ts`：

```ts
/**
 * 主进程 IPC 发送方身份登记簿。
 * 只认 webContents.id 这个数字，不 import electron：URL 分不出同 origin 的 8 个窗口，
 * 而 Electron 44 没有 WebContents tag API（electron.d.ts 里 `getData(` 0 命中）。
 * 未登记＝unknown＝所有 strict channel 一律拒绝。
 */
export type WindowKind = "pet" | "chat" | "unknown";

const kinds = new Map<number, WindowKind>();

export function markWebContents(id: number, kind: Exclude<WindowKind, "unknown">): void {
  kinds.set(id, kind);
}

export function forgetWebContents(id: number): void {
  kinds.delete(id);
}

export function windowKindOf(id: number): WindowKind {
  return kinds.get(id) ?? "unknown";
}
```

`src/main/application/ipc-sender-policy.ts`：

```ts
import { IPC } from "../../shared/ipc-channels";
import type { WindowKind } from "./window-kind";

/**
 * 需要发送方闸门的入站 channel 表。出现在这里＝闸门覆盖；不在表里＝不闻不问。
 * 允许集合的每一行都要有渲染端 grep 依据（见计划 Task 15 Step 0）；查零调用方的 channel
 * 一律不进表——表里的死行会让人以为它已被守。
 */
export const IPC_SENDER_POLICY: Readonly<Record<string, readonly WindowKind[]>> = {
  [IPC.VERGE_NETWORK_GET]: ["chat"],
  [IPC.VERGE_NETWORK_REFRESH]: ["chat"],
  [IPC.VERGE_NETWORK_SET_MODE]: ["chat"],
  [IPC.VERGE_NETWORK_SELECT_NODE]: ["chat"],
  [IPC.VERGE_NETWORK_TEST_GROUP]: ["chat"],
  [IPC.VERGE_NETWORK_AUTO_SELECT]: ["chat"],
  [IPC.VERGE_GET_APP_INFO]: ["chat"],
  [IPC.VERGE_IS_QUIET]: ["pet"],
  [IPC.VERGE_GET_PET_GEOMETRY]: ["pet"],
  [IPC.VERGE_PET_RESIZE]: ["pet"],
  [IPC.VERGE_PET_POSITION_SETTLED]: ["pet"],
  [IPC.VERGE_TUCK_HINTED]: ["pet"],
};
```

`ipc-scope.ts`——接口段之后追加选项类型，`createIpcScope` 换签名并加 `guarded()`：

```ts
export interface IpcScopeOptions {
  /** channel → 允许的主进程入口窗口类别。表里的 channel 才包闸门。 */
  senderPolicy?: Readonly<Record<string, readonly WindowKind[]>>;
  /** sender webContents.id → 类别。有表没它＝构造即抛：闸门不许静默放行。 */
  classify?: (senderId: number) => WindowKind;
}

export function createIpcScope(
  main: IpcScopeMainLike = ipcMain as IpcScopeMainLike,
  options: IpcScopeOptions = {},
): IpcScope {
  const senderPolicy = options.senderPolicy ?? {};
  const classify = options.classify;
  if (Object.keys(senderPolicy).length > 0 && !classify) {
    throw new Error("IPC sender policy: senderPolicy 非空但缺 classify——闸门会静默放行全部窗口");
  }
  const deniedWarned = new Set<string>();

  /**
   * 包一层发送方检查。日志只写 channel 与类别，绝不写 payload：
   * mihomo 控制器密钥与订阅 token 都可能从 payload 里漏出来。
   */
  function guarded(
    channel: string,
    kind: "handle" | "on",
    listener: (...args: any[]) => unknown,
  ): (...args: any[]) => unknown {
    const allowed = senderPolicy[channel];
    if (!allowed || !classify) return listener;
    return (...args: any[]) => {
      const event = args[0] as { sender?: { id?: number } } | undefined;
      const senderId = event?.sender?.id;
      if (typeof senderId !== "number") {
        throw new Error(`IPC sender denied: ${channel} 取不到 senderId（当作未登记窗口拒绝）`);
      }
      const actual = classify(senderId);
      if (allowed.includes(actual)) return listener(...args);
      if (kind === "handle") {
        throw new Error(`IPC sender denied: ${channel} 拒绝来自 ${actual} 窗口`);
      }
      const key = `${channel}:${actual}`;
      if (!deniedWarned.has(key)) {
        deniedWarned.add(key);
        console.warn(`[IpcScope] ${channel} 丢弃来自 ${actual} 窗口的 on 事件（同 channel+类别只报一次）`);
      }
      return undefined;
    };
  }
```

`handle` 与 `on` 各改两行——存 **包装后** 的那个函数（`dispose()` 要 `removeListener` 的正是它）：

```ts
    handle(channel, listener) {
      assertActive();
      if (handledChannels.has(channel)) {
        throw new Error(`IPC channel already registered: ${channel}`);
      }
      handledChannels.add(channel);
      const registered = guarded(channel, "handle", listener);
      registrations.push({ kind: "handle", channel, listener: registered });
      main.handle(channel, registered);
    },

    on(channel, listener) {
      assertActive();
      const registered = guarded(channel, "on", listener);
      registrations.push({ kind: "on", channel, listener: registered });
      main.on(channel, registered);
    },
```

`default-dependencies.ts:382` 换成：

```ts
      createIpcScope: () => createIpcScope(ipcMain as IpcScopeMainLike, {
        senderPolicy: IPC_SENDER_POLICY,
        classify: windowKindOf,
      }),
```

补两条 import：`import { IPC_SENDER_POLICY } from "./ipc-sender-policy";`、`import { windowKindOf } from "./window-kind";`（`IpcScopeMainLike` 若尚未导入，和 `createIpcScope` 同一条 import 带上）。

`window-manager.ts` 三处登记（`import { forgetWebContents, markWebContents } from "../application/window-kind";`）：

```ts
  function setPetWindow(window: BrowserWindow, showOnReady = true): void {
    petWindow = window;
    // 用 destroyed 而不是 closed：closed 只走正常销毁，destroyed 覆盖渲染进程崩溃/被强杀。
    // 崩溃重载不换 webContents（同一个实例、同一个 id），所以换新猫窗才需要重登记。
    markWebContents(window.webContents.id, "pet");
    window.webContents.once("destroyed", () => forgetWebContents(window.webContents.id));
```

chatShell（`:307` 的 `chatShell = handle;` 之后）与 onboarding（`:166-176` 的 `createOnboardingWindow()` 里拿到 window 之后）各加一对：

```ts
      markWebContents(handle.window.webContents.id, "chat");
      handle.window.webContents.once("destroyed", () => forgetWebContents(handle.window.webContents.id));
```

`window-system-ipc.ts:103` 那种渲染端要求新开的窗、`browser-panel-controller.ts:1243` 的 `WebContentsView`（跑的是互联网页面）**故意不登记**——它们落在 `unknown`，也就是所有表内 channel 都进不来。`create-toast-window.ts` / `create-music-player-window.ts` / `create-aux-windows.ts:218/292`（贴纸、通话）同理：本期没有任何一条 channel 需要它们发声。

- [ ] **Step 4: 全量门**

Run: `CI=true npx vitest run src/main/application`
Expected: 三条新测试文件绿；既有 `ipc-scope.test.ts`、`ipc-contract.test.ts` 仍绿（后者的扫描器只读 `node.arguments[0]`，第二参不影响登记数对账）。

Run: `CI=true npx vitest run`
Expected: 全绿。重点回看 `src/renderer/react/features/network/NetworkPanel.tsx` 相关的任何 e2e/组件测试——把 `VERGE_NETWORK_*` 收窄成 `["chat"]` 之后，若 pet 包里有隐藏的调用方，会在这里以「主进程返回被拒」的形式暴露，而不是在单测里被 fake main 掩盖。

- [ ] **Step 5: 三条变异验牙（每条都要先红、还原、再绿）**

1. 删掉 `guarded()` 里 `handle` 分支的 `throw`，改成 `return undefined`：`chat 发 pet channel 当场抛，且真监听器一次都没跑` 必须红。
2. `windowKindOf` 的 `?? "unknown"` 改成 `?? "pet"`：`未登记的 id 一律 unknown` 与 `chat 发 pet channel 当场抛…` 里那条 `unknown` 断言必须红；这证明 fail-closed 不是文案。
3. 把 `default-dependencies.ts` 的 `classify: windowKindOf,` 注释掉：`ipc-gate-wiring.test.ts` 红 **并且** 构造抛错那条也红（生产根本起不来）——这条变异要跑完整套 `CI=true npx vitest run` 确认没有别的测试被连累，然后把注释还原。

- [ ] **Step 6: 提交**

```bash
git add src/main/application/window-kind.ts src/main/application/ipc-sender-policy.ts src/main/application/ipc-scope.ts src/main/application/default-dependencies.ts src/main/windows/window-manager.ts src/main/application/window-kind.test.ts src/main/application/ipc-sender-gate.test.ts src/main/application/ipc-gate-wiring.test.ts docs/verge/notes/progress.md
git diff --cached --numstat
git commit -m "$(cat <<'EOF'
feat(ipc): 入站发送方白名单与窗口类别登记（R-D11，Task 15）

8 个窗口共用同一条 preload，URL 分不出谁是谁；Electron 44 又没有
WebContents tag API，只能按 webContents.id 登记。闸门挂在 createIpcScope：
表里的 channel 才包一层，handle 在监听器内 throw（渲染端 invoke 当场 reject），
on 丢事件并按 channel+类别 只 warn 一次。IpcScope 接口没改，328 处调用点零改动。

fail-closed 三处：未登记 id＝unknown 一律拒；senderPolicy 非空而缺 classify
构造即抛；取不到 senderId 当未登记处理。日志只写 channel 与类别，绝不写 payload。

本期覆盖 verge 家族 12 条入站 channel（network 6 条＋app-info＝chat，
quiet/geometry/resize/position/tuckHinted＝pet）。查出 VERGE_TOGGLE_QUIET、
VERGE_GET_SNAPSHOT、VERGE_SET_TUCK 渲染端 0 处调用，按「死行不进表」只记台账不修。
EOF
)"
```

---
## Task 16: `work-status.ts` — 六档工作状态的唯一主进程来源（含生产挂钩）

**Files:**
- Create: `src/shared/work-status-types.ts`
- Create: `src/main/pet/work-status.ts`
- Modify: `src/renderer/react/character-status-moods.ts:1`（六档词汇改成 shared 的别名）、`:19`（内联数组改成 `WORK_STATUS_TIERS`）
- Modify: `src/main/agui-bridge.ts:404-412`（`registerAguiBridge` 的 deps 追加可选 `workStatus`）、`:1079`（`next` 顶部一行）、`:1372` 的 `abortRun` 里 `:1378` 旁一行
- Modify: `src/main/application/default-dependencies.ts:809-829`（构造 service、订阅 `NetworkService` 快照与 `toastEvents` 的两个卡主题、`shutdown.register`）与 `registerAguiBridge` 的调用点（把 service 传进去）
- Test: `src/main/pet/work-status.test.ts`（新建）
- Test: `src/main/pet/work-status-wiring.test.ts`（新建，源码文本锁）

**`src/main/user-choice.ts` 一行都不改。** 提醒的两端从 `src/main/toast/toast-events.ts` 的总线上订阅（证据与理由见下面「提醒」那一行）。第一版在这里列的是「在 `publishAskCard(` 之后各加一行 + `pendingChoices.delete` 处加一行」——实测 `pendingChoices.delete` 有 7 处（`:133/:167/:192/:226/:264/:294/:309`），逐处挂线会把四个不同语义的出口当成一个用，还会漏掉 `cancelPendingChoicesForRun`（`:305`，它经 `pending.onSettled` → `notifySettled` 发布 dismiss）。总线的 `onChoiceDismiss` 由 `notifySettled`（`:214-222`）统一发，timeout / answered / cancelled / unavailable 四种结局全覆盖且不遗漏。

**六档 → 状态源（每行都是 2026-10-24 实测过的锚点；实现时逐条复核）**

| 档 | 触发锚点 | 结束锚点 |
|---|---|---|
| 连接中 | `NetworkSnapshot.controller.available === false && updatedAt === 0`（`src/shared/network-types.ts:63-73`，`updatedAt` 注释写明「0＝还没成功拉过」） | 首个成功快照，或超过 `CONNECTING_CAP_MS` |
| 思考中 | `agui-bridge.ts:1082` 之前的 `RUN_STARTED`（`cyrene-agent.ts:465 subscriber.next({ type: EventType.RUN_STARTED ... })`）与 `:1115 TEXT_MESSAGE_START` / `:1125 TEXT_MESSAGE_CONTENT` | `TOOL_CALL_START` 或 run 终局 |
| 工作中 | `event-mapper.ts:101 case "tool_start"` 发出的 `TOOL_CALL_START`（字段 `toolCallName: event.toolName`、`toolCallDisplayName: event.displayName`） | `event-mapper.ts:119 case "tool_end"` 的 `TOOL_CALL_END` → 回 思考中 |
| 提醒 | `toastEvents.onChoiceCard`（全仓发布点只有两处，都在 user-choice：`:186` 旧版单选卡、`:257` 结构化澄清卡／计划审批卡） | `toastEvents.onChoiceDismiss`（`notifySettled` `:214` 统一发；`reason` 取值见 `:64`） |
| 已处理 | `:1082` 的 `RUN_FINISHED` 且该 run 未被取消 | 5s 自动降级 |
| 已中断 | `:1366 ipc.handle(IPC.AGUI_CANCEL, …)` → `abortRun`（`:1372`）里的 `:1378 run.abortController.abort()` | 5s 自动降级 |

**被否决的三个状态源（必须写进台账，否则下一个人还会去接它们）**

1. `src/main/runtime-state.ts:3 RuntimeStatus = "陪伴中"|"思考中"|"工作中"|"聆听中"|"提醒中"|"离线"` —— 六档但**词汇不同**，写它的只有 `build-options.ts:1234 deps.setRuntimeState(...)`（在 `onAgentRunFinished`，`:1165`），也就是**只在 run 结束后写**，拿不到相位；广播走 `default-dependencies.ts:713 broadcastToAuxWindows(IPC.RUNTIME_STATE_CHANGED, …)`，而 `:183` 那个函数只发 `reactChatWindow`，**永远到不了猫窗**。本期不接管、不改造它：`character-status-moods` 那套 React 侧词汇与它是两条独立码路（见「与 spec 的口径差」⑤）。
2. `harness/types.ts:288 onToolLifecycle?: (event: HarnessToolLifecycleEvent) => void` —— 看起来正是要的相位钩，实测**只有发射点**（`cyrene-harness.ts:367`、`tool-round.ts:239/250/284/379`），非测试源码里 0 个赋值＝死钩。接它等于先造一条生产者。
3. `tool-round.ts:54 run.input.onToolFinished?.(...)` —— 活的，但它的消费者链是 `harness-adapter.ts:98 → cyrene-agent.ts:211 → agent-runtime.ts:299 → default-dependencies.ts:730 publishToolFinished → plugin-host/lifecycle-publisher.ts:59`，**终点是插件事件旁路**；而且它只有「完成」没有「开始」，`status: ToolCallOutcome`（`harness/types.ts:32 "success"|"failure"|"unknown"|"not_executed"`）也不是档位词汇。要从它取「工作中」得穿过 5 个文件，而从 `bridge.next` 取只要一行——`next` 本来就把 `TOOL_CALL_*` 全看见了。

**相位为什么不自己造事件**：`dispatchRun` 的 `subscribe({ next, error, complete })`（`:1076`）已经是全仓唯一一个「每条 chat 的每一个相位都路过一次」的地方，`runId` 与 `sessionId` 都已在作用域内（`:556`、`:582`）。往 orchestrator 里加新事件会再制造一个 `onToolLifecycle`。

**Interfaces:**
- Consumes: `EventType` 字符串（直接从 `baseEvent.type` 读，不 import AG-UI 常量，避免桥层与 vendor 绑死）、`NetworkUpdate`（`src/shared/network-types.ts:77`）、`ChoiceCardEvent` / `ChoiceDismissEvent`（`src/main/toast/toast-events.ts:24-39`，装配层已经拿着的那个 bus）
- Produces:
  - `WORK_STATUS_TIERS: readonly ["连接中","思考中","工作中","提醒","已处理","已中断"]`、`type WorkStatusTier`、`type WorkStatusSource = "agent" | "ask" | "controller"`、`interface WorkStatus { tier; source; since; runId?: string; detail?: string }`
  - `WorkStatusService { current(): WorkStatus \| null; subscribe(l: (s: WorkStatus \| null) => void): () => void; noteAguiEvent(type: string \| undefined, event: unknown): void; noteCancel(runId: string \| undefined): void; noteAskOpen(askId: string, runId?: string, detail?: string): void; noteAskSettled(askId: string): void; noteNetwork(update: NetworkUpdate): void; dispose(): void }`
  - `createWorkStatusService(options?: WorkStatusOptions): WorkStatusService`，`WorkStatusOptions { now?: () => number; schedule?: (fn: () => void, ms: number) => () => void; connectingCapMs?: number; settledMs?: number; idleFallbackMs?: number }`（`now`/`schedule` 注入与 `NetworkServiceOptions:38-44` 的 `now?: () => number` 同一套路）
  - 常量：`SETTLED_MS = 5_000`、`IDLE_FALLBACK_MS = 8_000`、`CONNECTING_CAP_MS = 20_000`、`CANCEL_MEM_MS = 10_000`
  - `NOOP_WORK_STATUS: WorkStatusService`（桥层 deps 缺省用，与 `ipcOption ?? createIpcScope()` 同形态）

`askId` ＝总线事件里的 `cardId`（`extractCardIdentity`，`user-choice.ts:105-110`：旧版卡取 `card.id`，结构化卡取 `card.interactionId`；dismiss 侧的 `cardId` 与之同源）。用它当键而**不是** `runId`：同一个 run 会连着发好几张卡（计划审批卡答完接着出补充卡），用 `runId` 当键会让第二张开卡被第一张的「已经在等」判断吞掉，猫的 提醒 会说谎——它等的已经不是那张。

- [ ] **Step 0: 复核三个锚点**

```bash
grep -n "publishChoiceCard(\|publishChoiceDismiss(" src/main/user-choice.ts
grep -n "RUN_STARTED\|TEXT_MESSAGE_START\|TOOL_CALL_START\|TOOL_CALL_END" src/main/agui-bridge.ts | head
grep -n "toastEvents\|networkService\|registerAguiBridge" src/main/application/default-dependencies.ts | head
```
第一条期望正好 6 行：开卡 2 处（`:186`、`:257`），收卡 4 处（`:140/:154/:169/:216`）。**开卡若多于 2 处，说明 user-choice 之外还有别的卡源**——那就要在本任务把新源一起订阅，并把结论记进 `docs/verge/notes/progress.md`。第三条给出装配层手里 `toastEvents` 的实际写法（import 的单例还是 `createToastEventBus()` 注入的实例）和 `networkService` 的变量名；两个都照现场的写法用，别照抄本计划的名字。

- [ ] **Step 1: 写失败测试**

`src/main/pet/work-status.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { WORK_STATUS_TIERS, type WorkStatus } from "../../shared/work-status-types";
import { createWorkStatusService, type WorkStatusService } from "./work-status";
import type { NetworkUpdate } from "../../shared/network-types";

/** 手动时钟 + 手动排程：不靠 vitest fake timers，定时器与「现在」必须来自同一个数。 */
function makeClock(start = 1_000) {
  const state = { ms: start };
  const timers: Array<{ at: number; fn: () => void; id: number }> = [];
  let nextId = 1;
  return {
    now: () => state.ms,
    advance(ms: number) {
      state.ms += ms;
      for (const t of [...timers].sort((a, b) => a.at - b.at)) {
        const i = timers.indexOf(t);
        if (i >= 0 && t.at <= state.ms) {
          timers.splice(i, 1);
          t.fn();
        }
      }
    },
    schedule(fn: () => void, delay: number) {
      const id = nextId++;
      timers.push({ at: state.ms + delay, fn, id });
      return () => {
        const i = timers.findIndex((t) => t.id === id);
        if (i >= 0) timers.splice(i, 1);
      };
    },
    pending: () => timers.length,
  };
}

function makeService() {
  const c = makeClock();
  const svc = createWorkStatusService({ now: c.now, schedule: c.schedule });
  const seen: Array<WorkStatus | null> = [];
  svc.subscribe((s) => seen.push(s));
  return { c, svc, seen };
}

const RUNNING = { kind: "snapshot", snapshot: { controller: { available: true, baseUrl: "http://127.0.0.1:9090", reason: null, version: "1.18.0" }, updatedAt: 5 } } as unknown as NetworkUpdate;
const DOWN = { kind: "snapshot", snapshot: { controller: { available: false, baseUrl: null, reason: "no-controller", version: null }, updatedAt: 0 } } as unknown as NetworkUpdate;

describe("workStatus 六档状态机 (Task 16)", () => {
  it("RUN_STARTED→思考中，TOOL_CALL_START→工作中（带 detail），TOOL_CALL_END→回思考中", () => {
    const { svc, seen } = makeService();
    svc.noteAguiEvent("RUN_STARTED", { runId: "r1" });
    expect(svc.current()?.tier).toBe("思考中");
    svc.noteAguiEvent("TOOL_CALL_START", { runId: "r1", toolCallName: "read_file", toolCallDisplayName: "读文件" });
    expect(svc.current()?.tier).toBe("工作中");
    expect(svc.current()?.detail).toBe("读文件");
    svc.noteAguiEvent("TOOL_CALL_END", { runId: "r1" });
    expect(svc.current()?.tier).toBe("思考中");
    expect(seen.length).toBe(3);
  });

  it("同一相位重复只发一次：TEXT_MESSAGE_CONTENT 每帧都到，listener 不能每帧被叫", () => {
    const { svc, seen } = makeService();
    svc.noteAguiEvent("TEXT_MESSAGE_START", { runId: "r1" });
    for (let i = 0; i < 50; i++) svc.noteAguiEvent("TEXT_MESSAGE_CONTENT", { runId: "r1", delta: "x" });
    expect(seen.length).toBe(1);
    expect(svc.current()?.tier).toBe("思考中");
  });

  it("RUN_FINISHED→已处理，5s 后自动归 null；这 5s 内不许出现别的档", () => {
    const { c, svc, seen } = makeService();
    svc.noteAguiEvent("RUN_STARTED", { runId: "r1" });
    svc.noteAguiEvent("RUN_FINISHED", { runId: "r1" });
    expect(svc.current()?.tier).toBe("已处理");
    c.advance(4_999);
    expect(svc.current()?.tier).toBe("已处理");
    expect(seen.length).toBe(2);
    c.advance(1);
    expect(svc.current()).toBeNull();
    expect(seen.length).toBe(3);
  });

  it("AGUI_CANCEL 当场 已中断，随后到达的 RUN_FINISHED 不许把它改成 已处理", () => {
    const { c, svc } = makeService();
    svc.noteAguiEvent("RUN_STARTED", { runId: "r9" });
    svc.noteCancel("r9");
    expect(svc.current()?.tier).toBe("已中断");
    c.advance(120);                      // abort 之后 run 还要走一段才结算
    svc.noteAguiEvent("RUN_FINISHED", { runId: "r9" });
    expect(svc.current()?.tier).toBe("已中断");
    c.advance(5_000);
    expect(svc.current()).toBeNull();
  });

  it("提醒压在 工作中 之上；结算后 工作中 复位，不留空窗", () => {
    const { svc } = makeService();
    svc.noteAguiEvent("TOOL_CALL_START", { runId: "r1", toolCallName: "ask_user" });
    svc.noteAskOpen("card-1", "r1", "要不要覆盖已有文件");
    expect(svc.current()?.tier).toBe("提醒");
    expect(svc.current()?.source).toBe("ask");
    svc.noteAskSettled("card-1");
    expect(svc.current()?.tier).toBe("工作中");
    expect(svc.current()?.source).toBe("agent");
  });

  it("同一张卡重复开（重试 / revision 重发）不重置计时、不重排档位", () => {
    const { svc, seen } = makeService();
    svc.noteAskOpen("card-1", "r1", "要不要覆盖已有文件");
    const before = seen.length;
    svc.noteAskOpen("card-1", "r1", "要不要覆盖已有文件");
    expect(seen.length).toBe(before);
    svc.noteAskSettled("card-1");
    expect(svc.current()).toBeNull();                  // 只结一次：第二张根本没进集合
    svc.noteAskSettled("card-1");                      // 迟到的 dismiss 也得是 no-op
    expect(seen.length).toBe(before + 1);
  });

  it("拿不到 agent 状态源也不投提醒：ask 在空状态上开→结算后回到 null，而不是 已处理", () => {
    const { svc } = makeService();
    svc.noteAskOpen("card-2", undefined, "选一个");
    expect(svc.current()?.tier).toBe("提醒");
    svc.noteAskSettled("card-2");
    expect(svc.current()).toBeNull();
  });

  it("连接中 站着的时候来了一张卡：提醒 压住它，结算后不许复活 连接中", () => {
    const { svc } = makeService();
    svc.noteNetwork(DOWN);
    expect(svc.current()?.tier).toBe("连接中");
    svc.noteAskOpen("card-1", "r1", "要不要覆盖已有文件");
    expect(svc.current()?.tier).toBe("提醒");
    svc.noteAskSettled("card-1");
    expect(svc.current()).toBeNull();                  // 不是 连接中：窗口被这张卡烧掉了
  });

  it("两张卡同时在等（后台 run 也发卡）：第一张结算后 提醒 继续，说话的是还欠着的那张", () => {
    const { svc, seen } = makeService();
    svc.noteAskOpen("card-a", "r1", "要不要覆盖已有文件");
    svc.noteAskOpen("card-b", "r2", "选一个部署目标");
    const before = seen.length;                        // 第二张开卡不 emit：顶部仍是 提醒
    svc.noteAskSettled("card-a");
    expect(svc.current()?.tier).toBe("提醒");
    expect(svc.current()?.detail).toBe("选一个部署目标");
    svc.noteAskSettled("card-b");
    expect(svc.current()).toBeNull();
    expect(seen.length).toBe(before + 2);
  });

  it("卡片在等的时候 run 被取消：结算后落在 已中断，不许把取消前的 工作中 顶回来", () => {
    const { c, svc } = makeService();
    svc.noteAguiEvent("TOOL_CALL_START", { runId: "r1", toolCallName: "ask_user" });
    svc.noteAskOpen("card-1", "r1", "要不要覆盖已有文件");
    svc.noteCancel("r1");                              // AGUI_CANCEL 先到，dismiss(reason=cancelled) 后到
    expect(svc.current()?.tier).toBe("提醒");           // 取消不越权改写正在等的档
    svc.noteAskSettled("card-1");
    expect(svc.current()?.tier).toBe("已中断");
    c.advance(5_000);
    expect(svc.current()).toBeNull();
  });

  it("另一个 run 的终局不许清掉当前 run 的档（后台 run 与前台 run 交叠）", () => {
    const { svc } = makeService();
    svc.noteAguiEvent("RUN_STARTED", { runId: "r1" });
    svc.noteAguiEvent("TOOL_CALL_START", { runId: "r1", toolCallName: "web_search" });
    svc.noteAguiEvent("RUN_FINISHED", { runId: "r2" });
    expect(svc.current()?.tier).toBe("工作中");
    expect(svc.current()?.runId).toBe("r1");
    svc.noteAguiEvent("RUN_FINISHED", { runId: "r1" });
    expect(svc.current()?.tier).toBe("已处理");
  });

  it("started 之后 8s 无任何相位：归 null——挂着 思考中 比没状态更坏", () => {
    const { c, svc } = makeService();
    svc.noteAguiEvent("RUN_STARTED", { runId: "r1" });
    c.advance(7_999);
    expect(svc.current()?.tier).toBe("思考中");
    c.advance(1);
    expect(svc.current()).toBeNull();
  });

  it("连接中 只在冷启动窗口：controller 不可用且 updatedAt=0 才立，20s 后自降为 null", () => {
    const { c, svc } = makeService();
    svc.noteNetwork(DOWN);
    expect(svc.current()?.tier).toBe("连接中");
    expect(svc.current()?.source).toBe("controller");
    c.advance(19_999);
    expect(svc.current()?.tier).toBe("连接中");
    c.advance(1);
    expect(svc.current()).toBeNull();                 // 没订阅的用户不该看猫一直转圈
    svc.noteNetwork(DOWN);
    expect(svc.current()).toBeNull();                 // 已经烧尽窗口，不再复立
  });

  it("连接中 让位给真状态，但 agent 空档期不复活它", () => {
    const { c, svc } = makeService();
    svc.noteNetwork(DOWN);
    svc.noteAguiEvent("RUN_STARTED", { runId: "r1" });
    expect(svc.current()?.tier).toBe("思考中");
    svc.noteAguiEvent("RUN_FINISHED", { runId: "r1" });
    c.advance(5_000);
    expect(svc.current()).toBeNull();                 // 不是 连接中：controller 仍不可用但窗口已过
  });

  it("traffic 单帧更新不许改变状态（1.5s 一帧，别把档位抖出来）", () => {
    const { svc, seen } = makeService();
    svc.noteNetwork(RUNNING);
    svc.noteNetwork({ kind: "traffic", traffic: { up: 1, down: 2, at: 3 } } as NetworkUpdate);
    expect(svc.current()).toBeNull();
    expect(seen.length).toBeLessThanOrEqual(1);
  });

  it("listener 抛错不打断状态机，且这一档照样落定", () => {
    const { svc } = makeService();
    let calls = 0;
    svc.subscribe(() => { calls += 1; if (calls === 1) throw new Error("listener 炸了"); });
    svc.noteAguiEvent("RUN_STARTED", { runId: "r1" });  // 第一次 emit 必抛：这是本条唯一的证据
    expect(calls).toBe(1);
    expect(svc.current()?.tier).toBe("思考中");          // 抛错发生在 published 赋值之后，档位不许丢
    expect(() => svc.noteAguiEvent("TOOL_CALL_START", { runId: "r1", toolCallName: "x" })).not.toThrow();
    expect(svc.current()?.tier).toBe("工作中");
  });

  it("dispose 之后 pending 定时器全部取消，不再 emit", () => {
    const { c, svc, seen } = makeService();
    svc.noteAguiEvent("RUN_STARTED", { runId: "r1" });
    svc.noteAguiEvent("RUN_FINISHED", { runId: "r1" });
    const before = seen.length;
    svc.dispose();
    c.advance(30_000);
    expect(seen.length).toBe(before);
    expect(c.pending()).toBe(0);
  });

  it("六档词汇与角色状态图同一套：shared 常量是唯一真相", async () => {
    const fs = await import("node:fs");
    const react = fs.readFileSync("src/renderer/react/character-status-moods.ts", "utf8");
    expect(react).toContain("WORK_STATUS_TIERS");
    for (const tier of WORK_STATUS_TIERS) {
      // react 文件里除了类型别名不该再出现字面量档位（两处以内＝import 行与注释都不算）
      const hits = react.split("\n").filter((l) => l.includes(`"${tier}"`));
      expect(hits.length, `${tier} 仍在 character-status-moods.ts 里内联`).toBe(0);
    }
    expect(WORK_STATUS_TIERS.length).toBe(6);
  });

  it("current() 每次返回新的副本：调用方改不动内部状态，也拿不到同一个引用", () => {
    const { svc } = makeService();
    svc.noteAguiEvent("TOOL_CALL_START", { runId: "r1", toolCallName: "read_file" });
    const snap = svc.current()!;
    (snap as { tier: string }).tier = "已处理";
    expect(svc.current()?.tier).toBe("工作中");
    expect(svc.current()).not.toBe(snap);
  });
});
```

`src/main/pet/work-status-wiring.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";

describe("workStatus 的生产接线 (Task 16)", () => {
  const bridge = () => fs.readFileSync("src/main/agui-bridge.ts", "utf8");

  it("桥层把相位喂给 service：next 顶部一行、abort 一行都必须在", () => {
    const src = bridge();
    expect(src).toMatch(/workStatus\.noteAguiEvent\(/);
    expect(src).toMatch(/workStatus\.noteCancel\(/);
    expect(src).toMatch(/workStatus\s*[:=].*NOOP_WORK_STATUS|workStatus \?\? NOOP_WORK_STATUS/);
  });

  it("提醒的两端都从总线取：装配层订阅 onChoiceCard / onChoiceDismiss", () => {
    const src = fs.readFileSync("src/main/application/default-dependencies.ts", "utf8");
    expect(src).toMatch(/onChoiceCard\(\s*\(\w+\)\s*=>\s*\w+\.noteAskOpen\(/);
    expect(src).toMatch(/onChoiceDismiss\(\s*\(\w+\)\s*=>\s*\w+\.noteAskSettled\(/);
    const bus = fs.readFileSync("src/main/toast/toast-events.ts", "utf8");
    expect(bus).toMatch(/onChoiceCard\(event: ChoiceCardEvent\)/);   // 总线仍是这个形状；它改名＝本条该红
  });

  it("user-choice 保持零改动：提醒不许退回到内联挂钩", () => {
    const src = fs.readFileSync("src/main/user-choice.ts", "utf8");
    expect(src).not.toMatch(/noteAskOpen|noteAskSettled|workStatus/);
  });

  it("default-dependencies 构造 service、订阅 NetworkService 并登记 shutdown", () => {
    const src = fs.readFileSync("src/main/application/default-dependencies.ts", "utf8");
    expect(src).toMatch(/createWorkStatusService\(/);
    expect(src).toMatch(/workStatus\.noteNetwork\(/);
    expect(src).toMatch(/workStatus/);
  });

  it("被否决的三个状态源不许被人偷偷接上（第 2、3 条尤其脆）", () => {
    const types = fs.readFileSync("src/main/orchestrator/harness/types.ts", "utf8");
    expect(types).toMatch(/onToolLifecycle\?:/);       // 钩子存在但仍是死钩：main 侧 0 个赋值
    const files = fs.readdirSync("src/main", { recursive: true })
      .filter((p): p is string => typeof p === "string" && p.endsWith(".ts") && !p.includes(".test."))
      .map((p) => `src/main/${p}`);
    const assignees = files.filter((p) => /\bonToolLifecycle\s*:/.test(fs.readFileSync(p, "utf8")));
    expect(assignees, "有人给死钩加了生产者，工作状态要重新评估状态源").toEqual([]);
  });
});
```

最后一条用 `fs.readdirSync(..., { recursive: true })` + 正则，而不是 `execSync("grep ...")`：本机是 Git Bash、CI 是 ubuntu，`grep` 两边都在，但 Node 的 `readdirSync` 一旦返回 `Buffer` 数组，`p.endsWith` 会当场炸——所以先 `typeof p === "string"` 收窄（写成类型谓词，`.map` 里的模板串才不会要你再断言一次）。`!p.includes(".test.")` 是必须的：`harness-adapter.test.ts` 那类测试里给钩子赋值的写法不该算成「生产者」，否则这条锁永远红。

- [ ] **Step 2: 跑红**

Run: `CI=true npx vitest run src/main/pet/work-status.test.ts src/main/pet/work-status-wiring.test.ts`
Expected: `Cannot find module './work-status'`；`work-status-wiring.test.ts` 全部红（桥层还没有 `workStatus`）。若 `六档词汇…` 当场就绿，说明 Step 3 的 react 改动没落地——它是最后一批红的测试之一。

- [ ] **Step 3: 实现**

`src/shared/work-status-types.ts`：

```ts
/**
 * 工作状态六档。词汇的唯一真相在这里：角色状态图（React 聊天侧）与猫的姿态/气泡（桌宠侧）
 * 都从这里取，两条展示码路不许各自再写一份中文字面量。
 */
export const WORK_STATUS_TIERS = ["连接中", "思考中", "工作中", "提醒", "已处理", "已中断"] as const;

export type WorkStatusTier = (typeof WORK_STATUS_TIERS)[number];

/** 状态源只有三个：agent run 相位、ask 卡片、控制器快照。 */
export type WorkStatusSource = "agent" | "ask" | "controller";

export interface WorkStatus {
  tier: WorkStatusTier;
  source: WorkStatusSource;
  /** 该档进入时刻（epoch ms）。桌宠侧「这档站了多久」与尺 #74 的取样都读它。 */
  since: number;
  runId?: string;
  /** 只有 工作中 / 提醒 有值，且必须是**已过 i18n 白名单**的用户可见词（Task 18 的 statusToolName / 卡片摘要）。 */
  detail?: string;
}
```

`src/renderer/react/character-status-moods.ts` 顶部两行换成：

```ts
import { WORK_STATUS_TIERS } from "../../shared/work-status-types";

/** 角色状态图的档位＝工作状态档位（同一套词汇，两条展示码路）。 */
export type CharacterStatusMood = (typeof WORK_STATUS_TIERS)[number];
```

并把 `:19` 的 `const moods: CharacterStatusMood[] = [ … 六个字面量 … ];` 换成 `const moods = WORK_STATUS_TIERS;`。

`src/main/pet/work-status.ts`：

```ts
import type { NetworkUpdate } from "../../shared/network-types";
import {
  type WorkStatus,
  type WorkStatusSource,
  type WorkStatusTier,
} from "../../shared/work-status-types";

export const SETTLED_MS = 5_000;
export const IDLE_FALLBACK_MS = 8_000;
/** 冷启动窗口上限：没挂订阅的人不该看猫一直转圈。 */
export const CONNECTING_CAP_MS = 20_000;
/** abort 与 RUN_FINISHED 之间的记忆窗口：终局到达时用它分辨 已处理 / 已中断。 */
export const CANCEL_MEM_MS = 10_000;

/** 只有一条例外：提醒压在一切之上——它在等用户回答。其余档位由 `pick()` 的固定次序决定。 */
const AGENT_DEMOTE_TIERS: readonly WorkStatusTier[] = ["已处理", "已中断"];

export interface WorkStatusOptions {
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => () => void;
  connectingCapMs?: number;
  settledMs?: number;
  idleFallbackMs?: number;
}

type Overlay = { tier: WorkStatusTier; source: WorkStatusSource; runId?: string; detail?: string; since: number };

export interface WorkStatusService {
  current(): WorkStatus | null;
  subscribe(listener: (status: WorkStatus | null) => void): () => void;
  noteAguiEvent(type: string | undefined, event: unknown): void;
  noteCancel(runId: string | undefined): void;
  /** `askId`＝总线的 `cardId`。同一张卡重发（超时重试、revision 递增）是 no-op。 */
  noteAskOpen(askId: string, runId?: string, detail?: string): void;
  noteAskSettled(askId: string): void;
  noteNetwork(update: NetworkUpdate): void;
  dispose(): void;
}

/** 桥层 deps 的缺省值：与 `ipcOption ?? createIpcScope()` 同形态，测试与渠道运行不因此挂掉。 */
export const NOOP_WORK_STATUS: WorkStatusService = {
  current: () => null,
  subscribe: () => () => {},
  noteAguiEvent: () => {},
  noteCancel: () => {},
  noteAskOpen: () => {},
  noteAskSettled: () => {},
  noteNetwork: () => {},
  dispose: () => {},
};

export function createWorkStatusService(options: WorkStatusOptions = {}): WorkStatusService {
  const now = options.now ?? Date.now;
  const schedule = options.schedule ?? ((fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); });
  const connectingCapMs = options.connectingCapMs ?? CONNECTING_CAP_MS;
  const settledMs = options.settledMs ?? SETTLED_MS;
  const idleFallbackMs = options.idleFallbackMs ?? IDLE_FALLBACK_MS;

  const listeners = new Set<(status: WorkStatus | null) => void>();
  let agent: Overlay | null = null;
  /** 开着的卡集合，键＝cardId。用 Map 而不是单个 ask：后台 run 也会发卡，两张卡同时在等是真实状态，
   *  第一张答完时 提醒 不许消失。Map 的迭代顺序＝插入顺序，所以「先开的卡说话」不用另记。 */
  const opens = new Map<string, Overlay>();
  let suspended: Overlay | null = null;           // 提醒压住的那一档，结算后原样复位
  let connecting: Overlay | null = null;
  let connectingSpent = false;
  let cancelled: { runId: string; at: number } | null = null;
  let idleCancel: (() => void) | null = null;
  let settledCancel: (() => void) | null = null;
  let connectingCancel: (() => void) | null = null;
  let published: WorkStatus | null = null;
  let disposed = false;

  /** 三源汇流：提醒 > agent 相位 > 连接中。没有「同时两档」这回事。 */
  function pick(): Overlay | null {
    for (const entry of opens.values()) return entry;   // 插入顺序＝先开的卡先说
    if (agent) return agent;
    return connecting;
  }

  function emit(): void {
    const top = pick();
    const next: WorkStatus | null = top
      ? { tier: top.tier, source: top.source, since: top.since, runId: top.runId, detail: top.detail }
      : null;
    const same =
      (next === null && published === null) ||
      (next !== null && published !== null &&
        next.tier === published.tier && next.source === published.source &&
        next.detail === published.detail && next.runId === published.runId && next.since === published.since);
    if (same) return;
    published = next;
    // 与 network-service.ts:65-72 同一口径：监听器炸了不许打断状态机。
    for (const listener of [...listeners]) {
      try { listener(next); } catch (error) { console.error("[workStatus] listener failed:", error); }
    }
  }

  function clearAgentTimers(): void {
    idleCancel?.(); idleCancel = null;
    settledCancel?.(); settledCancel = null;
  }

  /**
   * 写 agent 档的唯一入口。两个定时器每次都重排：`idleFallbackMs` 的语义是
   * 「连续 8s 没有任何相位」，不是「这一档站了 8s」——流式回答 60s 也全是相位，不能中途被摘掉。
   * 是否 emit 交给 `emit()` 的去重判据，所以同档重复事件天然不响。
   */
  function setAgent(tier: WorkStatusTier, runId?: string, detail?: string, demoteMs?: number): void {
    const changed = !agent || agent.tier !== tier || agent.runId !== runId || agent.detail !== detail;
    if (changed) agent = { tier, source: "agent", runId, detail, since: now() };
    idleCancel?.();
    idleCancel = schedule(() => {
      if (agent?.runId === runId) { agent = null; emit(); }
    }, idleFallbackMs);
    settledCancel?.();
    settledCancel = demoteMs === undefined ? null : schedule(() => {
      if (agent?.runId === runId && agent?.tier === tier) { agent = null; emit(); }
    }, demoteMs);
    spendConnecting();        // 真状态一起来，「还在加载」的故事就该结束
    emit();
  }

  /** 连接中 只有一次机会：窗口烧尽或被真状态覆盖之后，永不再立。 */
  function spendConnecting(): void {
    if (!connecting && connectingSpent) return;
    connectingCancel?.();
    connectingCancel = null;
    connecting = null;
    connectingSpent = true;
  }

  function currentRunIdOf(event: unknown): string | undefined {
    const runId = (event as { runId?: unknown })?.runId;
    return typeof runId === "string" ? runId : undefined;
  }

  function displayLabelOf(event: unknown): string | undefined {
    const e = event as { toolCallDisplayName?: unknown; toolCallName?: unknown };
    // displayName 由工具注册表给出（event-mapper.ts:105），本来就是给人看的；
    // 缺它才退回内部名 toolCallName，那种值由 Task 18 的白名单负责过滤。
    if (typeof e?.toolCallDisplayName === "string" && e.toolCallDisplayName.trim() !== "") return e.toolCallDisplayName;
    return typeof e?.toolCallName === "string" ? e.toolCallName : undefined;
  }

  return {
    // 每次给副本：`published` 是 emit() 里造出来的活对象，直接返回会让调用方改到内部状态（连去重判据读的都是同一份）。
    current: () => (published === null ? null : { ...published }),

    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },

    noteAguiEvent(type, event) {
      if (disposed || typeof type !== "string") return;
      const runId = currentRunIdOf(event);
      if (agent && runId !== undefined && agent.runId !== undefined && agent.runId !== runId && type !== "RUN_STARTED") {
        return;                                        // 别的 run 的相位不改变当前档
      }
      switch (type) {
        case "RUN_STARTED":
        case "TEXT_MESSAGE_START":
        case "TEXT_MESSAGE_CONTENT":
          setAgent("思考中", runId);
          return;
        case "TOOL_CALL_START":
          setAgent("工作中", runId, displayLabelOf(event));
          return;
        case "TOOL_CALL_END":
        case "TOOL_CALL_RESULT":
          setAgent("思考中", runId);
          return;
        case "RUN_FINISHED": {
          const wasCancelled = cancelled !== null
            && (cancelled.runId === runId || cancelled.runId === "")
            && now() - cancelled.at <= CANCEL_MEM_MS;
          cancelled = null;
          setAgent(wasCancelled ? "已中断" : "已处理", runId, undefined, settledMs);
          return;
        }
        case "RUN_ERROR":
          cancelled = null;
          setAgent("已中断", runId, undefined, settledMs);
          return;
        default:
          return;
      }
    },

    noteCancel(runId) {
      if (disposed) return;
      cancelled = { runId: runId ?? "", at: now() };
      // 卡还开着时到达的取消，就是这张卡的结局：结算不许把「取消之前那一档」复位回来。
      suspended = null;
      setAgent("已中断", runId, undefined, settledMs);
    },

    noteAskOpen(askId, runId, detail) {
      if (disposed || opens.has(askId)) return;         // 同一张卡重发（超时重试 / revision）不重置计时
      if (opens.size === 0) {
        suspended = agent;
        agent = null;
        clearAgentTimers();
        spendConnecting();     // 有卡在等用户，「还在加载」的故事就该结束
      }
      opens.set(askId, { tier: "提醒", source: "ask", runId, detail, since: now() });
      emit();
    },

    noteAskSettled(askId) {
      if (disposed) return;
      if (!opens.delete(askId)) return;                 // 迟到的 dismiss（超时与作答赛跑）不改变任何档
      if (opens.size > 0) { emit(); return; }           // 还欠着卡：提醒层继续，emit 只在换「说话的那张」时响
      const held = suspended;
      suspended = null;
      if (held) {
        // 复位被压住的那一档，不留空窗。since 从复位这一刻重算：`since` 只用来量「这档站了多久」
        // 做演出计时，把它当成新档更保守——不会把已经站了很久误读成刚站上。
        setAgent(held.tier, held.runId, held.detail, AGENT_DEMOTE_TIERS.includes(held.tier) ? settledMs : undefined);
      }
      emit();
    },

    noteNetwork(update) {
      if (disposed) return;
      if (update.kind !== "snapshot") return;          // traffic 单帧（1.5s 一次）不改变档位
      const { controller, updatedAt } = update.snapshot;
      if (controller.available || updatedAt > 0) {
        if (connecting) { connecting = null; connectingCancel?.(); connectingCancel = null; emit(); }
        return;
      }
      if (connecting || connectingSpent || agent || opens.size > 0) return;
      connecting = { tier: "连接中", source: "controller", since: now() };
      connectingCancel = schedule(() => {
        connecting = null;
        connectingSpent = true;
        emit();
      }, connectingCapMs);
      emit();
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      clearAgentTimers();
      connectingCancel?.();
      connectingCancel = null;
      opens.clear();
      suspended = null;
      listeners.clear();
      published = null;
    },
  };
}
```

`spendConnecting()` 在 `setAgent` 与 `noteAskOpen` 里都调，看着像重复；它就是不能收进一处：`setAgent` 早退不了（重排定时器是必须的），而 `noteAskOpen` 根本不经过 `setAgent`。两处合一处＝把「提醒压连接中」那条测试变成测不到。

`AGENT_DEMOTE_TIERS` 只有一个用处：`noteAskSettled()` 决定复位那一档要不要重排 5s 降级钟。别把它误删成 `const` 数组没人用——`Overlay.tier` 是 `WorkStatusTier`，档位集合本身由编译器全覆盖，所以这个文件里不需要任何「这是不是合法档位」的运行期检查；写了就是 `project-false-green-locks` 里那种「看起来在检查、实际什么都没检查」的行。

`src/main/agui-bridge.ts`：`registerAguiBridge` 的 deps 追加

```ts
  /** 工作状态总线；缺省 NOOP（渠道/测试/插件路径没有猫窗，也不该因此报错）。 */
  workStatus?: WorkStatusService;
```

并在函数体开头 `const workStatus = deps.workStatus ?? NOOP_WORK_STATUS;`（与 `:412` 的 `const ipc = ipcOption ?? createIpcScope();` 同一句式）。两处挂钩：

```ts
      next: (baseEvent) => {
        const eventType = (baseEvent as { type?: string })?.type;
        workStatus.noteAguiEvent(eventType, baseEvent);   // ← 唯一一处：全仓唯一的「每个相位路过一次」
```

（`:1079` 之后，务必在 `:1082` 的 `RUN_FINISHED` 提前 return 分支**之前**——放在后面会让终局丢档。）

`abortRun` 里，紧贴 `:1378 run.abortController.abort();` 之前一行：

```ts
      workStatus.noteCancel(id);
```

`src/main/user-choice.ts`：不改。提醒的两端在装配层订阅总线（`default-dependencies.ts` 的 verge 装配段）：

```ts
        const unsubAskCard = toastEvents.onChoiceCard((card) => workStatus.noteAskOpen(card.cardId, card.runId, card.intro));
        const unsubAskDismiss = toastEvents.onChoiceDismiss((card) => workStatus.noteAskSettled(card.cardId));
```

`intro` 直接当 `detail`：`extractCardIdentity`（`user-choice.ts:105-110`）已经把「结构化卡的 `intro` / 旧版卡的 `question`」归一成一个单行字符串，本来就是给人看的——与 `displayLabelOf` 同一口径：**只在值已经是展示文本时才原样采用**，内部标识符一律不进 `detail`。总线 `createTopic.publish`（`toast-events.ts:99-107`）自带错误隔离，`noteAskOpen` 抛了不会连累 toast。

**与 spec 的口径差⑥**（Task 28 写回 spec）：spec 的状态源表（`docs/verge/specs/2026-10-24-catgirl-form-and-motion-design.md:300`）把 提醒 的起止写成 `publishAskCard`（`ask-card.ts:53`）起、`resolveAskCardSubmission`（`:102`）止。实现订阅它的下游总线，差别有两处：① 起点晚一瞬（`publishAskCard` 返回后才 publish，`user-choice.ts:257`），但 `publishAskCard` 是纯函数不发 IPC，中间没有用户可见状态；② 终点覆盖 `resolveAskCardSubmission` **之外**的三种结算（timeout / unavailable / cancelled），那三种在 spec 的写法下会让 提醒 挂到超时才散。旧版单选卡（`requestUserChoice`，走 `:186`）不是 `publishAskCard` 造的，但它是同一件事（「有张卡在等人」），所以一并算 提醒——这也是选总线而不是选 `publishAskCard` 的原因：按函数名挂钩会漏掉一半的真实提醒。

`src/main/application/default-dependencies.ts`（`:809-829` 的 verge 装配段旁边）：

```ts
        const workStatus = createWorkStatusService();
        const unsubscribeWorkStatusNetwork = networkService.subscribe((update) => workStatus.noteNetwork(update));
        shutdown.register({
          id: "work-status",
          phase: "stopLocalResources",
          dispose: async () => {
            unsubscribeWorkStatusNetwork();
            unsubAskCard();
            unsubAskDismiss();
            workStatus.dispose();
          },
        });
```

（`shutdown.register` 的入参形状是 `{ id, phase, dispose }`（`src/main/application/shutdown.ts:33-35`、`:145`），阶段取 `stopLocalResources`——它清的是定时器与订阅，跟 `verge-network-service`（`:800`）同一档；`verge-network-ipc` 用 `flushPersistence` 是因为它要拆 IPC 注册。写错形状会 TS 直接红，不会给你运行期线索。`networkService`、`toastEvents` 的变量名以 `:809` 附近实际存在的为准——`toastEvents` 可能是 `import { toastEvents }` 的单例，也可能是 `createToastEventBus()` 注入的实例，**必须订阅装配层手里那一个**：订阅单例会让走注入实例的装配路径永远收不到卡，而这条差错误只在真机上暴露，单测抓不到。）把 `workStatus` 一并塞进 `registerAguiBridge` 的 deps。

- [ ] **Step 4: 全量门**

Run: `CI=true npx vitest run src/main/pet src/main/user-choice src/main/toast src/main/agui-bridge src/renderer/react`
Expected: 新测试全绿。`user-choice` 与 `toast` 的既有测试**一行没改所以必须全绿**（它们仍只 publish，不知道有工作状态）；`agui-bridge` 的既有测试不传 `workStatus`，走的正是 `NOOP_WORK_STATUS`，也必须全绿——若有一条红，说明 deps 的可选参数没做成可选。

Run: `CI=true npx vitest run`
Expected: 全绿。特别回看 `cat-sprite-manifest` 与角色状态图相关测试：`CharacterStatusMood` 换来源后字面量集合必须一字不变（`getCharacterStatusMoodUrl` 拿档位拼 png 路径，改一个词＝素材找不到）。

- [ ] **Step 5: 三条变异验牙**

1. `noteAskSettled()` 里删掉 `if (held) { … }` 那一整块：`提醒压在 工作中 之上；结算后 工作中 复位` 红（空窗＝真 bug：答完题猫发呆）。其余四条 ask 测试应当仍绿——若 `卡片在等的时候 run 被取消` 也跟着红，说明你删的是 `suspended = null` 那条路径，那是第 6 条变异该管的事。
2. `RUN_FINISHED` 分支把 `wasCancelled` 恒为 `false`：`AGUI_CANCEL 当场 已中断…` 红。这条变异同时证明 `CANCEL_MEM_MS` 不是装饰。
3. `noteAguiEvent` 顶部 `if (agent && runId !== …) return;` 整段删掉：`另一个 run 的终局不许清掉当前 run 的档` 红——后台 run 交叠是本期唯一的多写者场景，闸门不能只写在注释里。
4. `noteAskSettled` 里删掉 `if (opens.size > 0) { emit(); return; }`：`两张卡同时在等…` 红（第一张答完就把 提醒 摘掉，第二张还在等人却没人说话）。
5. `noteAskOpen` 的 `if (disposed || opens.has(askId))` 改成只判 `disposed`：`同一张卡重复开…不重置计时` 红（`seen.length` 从 `before` 变成 `before + 1`——`since` 变了，`emit()` 的去重判据救不了它）。
6. `noteCancel` 里删掉 `suspended = null;`：`卡片在等的时候 run 被取消` 红（结算把 工作中 顶回来，用户明明点了停止）。

- [ ] **Step 6: 提交**

```bash
git add src/shared/work-status-types.ts src/main/pet/work-status.ts src/main/pet/work-status.test.ts src/main/pet/work-status-wiring.test.ts src/main/agui-bridge.ts src/main/user-choice.ts src/main/application/default-dependencies.ts src/renderer/react/character-status-moods.ts docs/verge/notes/progress.md
git diff --cached --numstat
git commit -m "$(cat <<'EOF'
feat(pet): 工作状态六档唯一来源与生产挂钩（Task 16）

状态源只有三个：agui-bridge 的 subscribe(next)（RUN_STARTED/TEXT_MESSAGE_*/
TOOL_CALL_*/RUN_FINISHED/RUN_ERROR）、toastEvents 的 onChoiceCard/onChoiceDismiss
（ask 卡片两端，user-choice 零改动）、NetworkService 的 snapshot
（controller.available && updatedAt===0）。
不新增 orchestrator 事件——dispatchRun 已经是全仓唯一「每个相位路过一次」的地方。

否决并记录三个来源：runtime-state（词汇不同、只在 run 结束后写、广播只到
reactChatWindow）、onToolLifecycle（只有发射点，0 个赋值＝死钩）、
onToolFinished（终点是插件事件旁路，且只有完成没有开始）。

三处自降：已处理/已中断 5s、忙碌档 8s 无后续相位、连接中 20s 窗口后永久让位。
提醒压在一切之上，结算后复位被压住的那一档且保留 since。
CharacterStatusMood 改为从 shared 的 WORK_STATUS_TIERS 派生：两条展示码路同一套词汇。
EOF
)"
```


## Task 17: 两条下行通道——形态档位与工作状态进 IPC（含 Task 7 载荷纠正）

**Files:**
- Modify: `src/shared/ipc-channels.ts:617`（VERGE 段末尾追加 4 条，注释风格照 `:582-616`）
- Modify: `src/shared/pet-profile.ts`（追加 `PetProfileRef` / `profileRefOf`）
- Create: `src/main/verge/profile-ipc.ts`
- Create: `src/main/pet/work-status-ipc.ts`
- Modify: `src/preload/index.ts:1138`（`vergeApi` 里 `onOpenNetworkPanel` 之前追加 4 个入口）
- Modify: `src/renderer/types/cyrene.d.ts:76`（`verge` 段补 4 个方法签名，注释「与 preload/index.ts 的 vergeApi 逐字对齐」是这份文件的自我要求，两处必须同一轮改）
- Modify: `src/main/application/default-dependencies.ts`（`applyTuckState` 之后加 `applyProfileState`；`registerNetworkIpc` 之后加两条注册；`attachPetContextMenu` 的 `onProfileChange`）
- Modify: Task 7 的档位广播点（现场 grep `verge:profile:update` 定位，见 Step 0 第 4 条）
- Modify: `src/main/application/ipc-sender-policy.ts`（Task 15 建的表，追加 2 行）
- Modify: `src/renderer/main.ts:113` 之后（Task 12 几何段与 `onPetCommand` 之间插两段 boot 读 + 下行订阅）
- Modify: `src/renderer/pet/renderer.ts`（Task 14 的 `setForm` 之上加 `setProfile`；`requestBounds`/`computePetLayout` 那几处收 `this.profile`；`getPetDiagnostics` 暴露两个新读数）
- Test: `src/shared/pet-profile.test.ts`（追加 `describe`，不动 Task 1 的断言）
- Test: `src/main/verge/profile-ipc.test.ts`（新建）
- Test: `src/main/pet/work-status-ipc.test.ts`（新建）
- Test: `src/main/pet/pet-status-ipc-wiring.test.ts`（新建，装配与通道登记文本锁）
- Test: `src/renderer/pet/renderer.test.ts`（追加 `describe("profile 与 workStatus 入口 (Task 17)")`）

**Interfaces:**
- Consumes: Task 1 的 `PetForm`/`SizeTier`/`profileFor`、Task 3 的 `computePetLayout(input & { profile? })`、Task 7 的 `VergeState.form`/`.tier` 与 `VergeService.getState()`、Task 14 的 `PixelPetRenderer.setForm`、Task 15 的 `IPC_SENDER_POLICY`、Task 16 的 `WorkStatusService`/`WorkStatus`
- Produces:
  - `IPC.VERGE_PROFILE_GET = "verge:profile:get"` / `VERGE_PROFILE_UPDATE = "verge:profile:update"` / `VERGE_WORK_STATUS_GET = "verge:work-status:get"` / `VERGE_WORK_STATUS_UPDATE = "verge:work-status:update"`
  - `interface PetProfileRef { form: PetForm; tier: SizeTier }`、`profileRefOf(form: PetForm, tier: SizeTier): PetProfileRef`
  - `registerProfileIpc(ipc: IpcScope, deps: { service: VergeService }): () => void`
  - `registerWorkStatusIpc(ipc: IpcScope, deps: { service: WorkStatusService; sendToPetWindow: (channel: string, payload: unknown) => void }): () => void`
  - `window.verge.getProfile(): Promise<PetProfileRef>` / `onProfileUpdate(cb): () => void` / `getWorkStatus(): Promise<WorkStatus | null>` / `onWorkStatus(cb): () => void`
  - `PixelPetRenderer.setProfile(ref: PetProfileRef): void`（生产唯一入口）/ `setWorkStatus(status: WorkStatus | null, origin?: "push" | "boot"): void`
  - `applyProfileState(form: PetForm, tier: SizeTier): void`（装配层收口，与 `applyQuietState`/`applyTuckState` 同构）

**为什么线上只跑两个字符串，不跑 `profileFor(...)` 整个对象（与 spec 的口径差⑦）**

Task 7 那节的原文是 `broadcast("verge:profile:update", profileFor(next.form, next.tier))`。`PetProfile` 上有 `catScale(e): {u,s}`（Task 1 的 `:258`），而 IPC 走 structured clone——**函数属性直接抛**。本机实测（2026-10-24，Node 24）：

```
node -e 'structuredClone({a:1,catScale:(e)=>e})'
→ DOMException: (e) => e could not be cloned.
```

`webContents.send` 与 `ipcRenderer.invoke` 的返回值用同一套算法，所以这条在 Electron 里同样抛，而且抛在**发送侧**：菜单点下去什么都没发生，主进程日志里躺着一条 unhandled。本任务把载荷收成 `{ form, tier }` 两个字符串，几何由收发两侧各自调 `profileFor` 现算——同一个 `src/shared/pet-profile.ts`，不存在两份数表要人肉对齐。**本任务同时删掉 `decodeProfileRef` 这类读端校验**：`profileFor` 的第一行就是 `PET_FORMS.includes(form) ? form : "cat"`，读端再判一遍是假严谨（两个口同一件事，改一处忘一处）。

**四条通道名都取「资源:动作」嵌套式**，与 v1.4.0 的 `verge:network:*` 同族；`VERGE_PROFILE_UPDATE` 的值与 Task 7 当时发的字符串**逐字相同**，所以这一步只换常量的引用、不换线上的名字——中间任何一轮跑到半成品状态，已发出的帧仍然能被新监听者收下（这是「不留半个未登记通道」那条要求能真正做到的方式）。

**为什么不复用 `VERGE_GET_SNAPSHOT` 带 profile**：`VergeSnapshot` 是 `{ module, ready, statePath, quietUntil }`（`src/main/verge/types.ts:1-5`），里面躺着 `statePath`——一个 userData 下的真实路径。Task 15 Step 0 实测它的渲染端调用方为 0；把它当 profile 的顺风车，等于为了少写一个 handle 而把路径字符串发给宠物窗，正是 R-D11 要防的那种「顺手 widen」。新通道只回两个字符串，最小面。

**为什么 work-status 的下行走 `sendToPetWindow` 而不是全窗 `broadcast`**：`WorkStatus.detail` 里是工具名或卡片首行（Task 16 把 `ChoiceCardEvent.intro` 原样存进去），那是用户自己的问句。`windowManager.sendToPetWindow`（`window-manager.ts:510-516`）拿不到宠物窗就静默 return，正是这里要的语义——**猫窗没开≠工作状态不存在**，也不该把细节发给插件面板宿主。

- [ ] **Step 0: 五处 grep 复核（不许照抄本节）**

```bash
cd /d/Test/workbuddy/cyrene-verge
# 1) VERGE 段尾巴在哪，行号写进提交信息
grep -n "CYRENE_OPEN_NETWORK_PANEL" src/shared/ipc-channels.ts
# 2) 通道名无碰撞：这两组键必须一条都搜不到
grep -n "VERGE_PROFILE\|VERGE_WORK_STATUS" src/shared/ipc-channels.ts
# 3) 契约扫描器认哪些写法（决定 UPDATE 必须写成 IPC.X 而不是变量）
grep -n "OUTBOUND_METHOD\|objectName === undefined" src/main/application/ipc-contract-scanner.ts
# 4) Task 7 的广播点与它的测试期望
grep -rn "verge:profile:update" src/main src/preload src/renderer
# 5) 装配层能不能拿到 sendToPetWindow（:868 已经在用 shell.windowManager）
grep -n "shell.windowManager" src/main/application/default-dependencies.ts | head
```

第 2 条**期望 0 命中**；命中了说明 Task 7 或 Task 16 已经自己开过通道，那就把它们已经建的那一套接着用，别在同一次发布里造两套名字。第 3 条是硬约束的来源：扫描器只认首个实参是 `IPC.<KEY>` 属性访问（`ipc-contract-scanner.ts:76-83`），`sendToPetWindow(channel, p)` 这种透传**不计入**（`ipc-contract.test.ts:201` 那行假源码配 `:205-217` 的期望清单，两行透传写法都不在里面）——所以外发点必须写 `sendToPetWindow(IPC.VERGE_WORK_STATUS_UPDATE, status)`，写成变量会让反向对账看不见它，等于发了一条无人认领的信道。第 4 条有几处就在本任务改几处，包括测试里的期望字符串。

- [ ] **Step 1: 写失败测试**

`src/shared/pet-profile.test.ts` 追加：

```ts
describe("过 IPC 的形态引用（Task 17）", () => {
  it("PetProfile 带 catScale 方法，过不了 structured clone——所以线上只许跑 PetProfileRef", () => {
    expect(() => structuredClone(profileFor("girl", "standard"))).toThrow(/could not be cloned/);
    const ref = profileRefOf("girl", "large");
    expect(structuredClone(ref)).toEqual(ref);
    expect(Object.values(ref).every((v) => typeof v === "string")).toBe(true);
  });

  it("profileFor 自己就是容错口：非法档位名回落 cat/standard，读端不再判第二遍", () => {
    expect(profileFor("dog" as never, "huge" as never)).toMatchObject({ form: "cat", tier: "standard" });
  });
});
```

第一条若在你机器上不抛（Node 版本差异），**不许改成 `not.toThrow()`**：那会把这条锁变成假绿。按桌宠屏幕验收的老规矩报 `ENV` 并现场用 `npx electron -e` 复核一次，把结论写进提交信息——这条断言是口径差⑦的唯一证据，没有它，下一个人完全有理由把 `profileFor` 再塞回载荷。

`src/main/verge/profile-ipc.test.ts`：

```ts
import { describe, expect, it, vi } from "vitest";
import { IPC } from "../../shared/ipc-channels";
import { profileFor } from "../../shared/pet-profile";
import type { IpcScope } from "../application/ipc-scope";
import { registerProfileIpc } from "./profile-ipc";

function makeScope() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const scope = {
    handlers,
    handle: vi.fn((channel: string, listener: (...args: unknown[]) => unknown) => {
      if (handlers.has(channel)) throw new Error(`duplicate ${channel}`);
      handlers.set(channel, listener);
    }),
    on: vi.fn(),
    removeHandler: vi.fn((channel: string) => { handlers.delete(channel); }),
    dispose: vi.fn(),
  };
  return scope as unknown as IpcScope & typeof scope;
}

describe("VERGE_PROFILE_GET（Task 17）", () => {
  it("返回的就是两个字符串，且过得了 structured clone", () => {
    const ipc = makeScope();
    const service = { getState: () => ({ module: "verge", ready: true, statePath: "C:\\x\\state.json", quietUntil: null, form: "girl", tier: "large" }) };
    registerProfileIpc(ipc, { service: service as never });
    const got = ipc.handlers.get(IPC.VERGE_PROFILE_GET)!(null);
    expect(got).toEqual({ form: "girl", tier: "large" });
    expect(structuredClone(got)).toEqual({ form: "girl", tier: "large" });
  });

  it("不许把 statePath 或 quietUntil 顺手带回：载荷键名集合钉死", () => {
    const ipc = makeScope();
    const service = { getState: () => ({ module: "verge", ready: true, statePath: "C:\\x\\state.json", quietUntil: 123, form: "cat", tier: "standard" }) };
    registerProfileIpc(ipc, { service: service as never });
    expect(Object.keys(ipc.handlers.get(IPC.VERGE_PROFILE_GET)!(null)).sort()).toEqual(["form", "tier"]);
  });

  it("dispose 注销干净，且同一 scope 里重复注册会抛（createIpcScope 的真语义）", () => {
    const ipc = makeScope();
    const service = { getState: () => ({ statePath: "", quietUntil: null, form: "cat", tier: "standard" }) };
    const off = registerProfileIpc(ipc, { service: service as never });
    off();
    expect(ipc.handlers.has(IPC.VERGE_PROFILE_GET)).toBe(false);
    expect(ipc.removeHandler).toHaveBeenCalledWith(IPC.VERGE_PROFILE_GET);
    registerProfileIpc(ipc, { service: service as never });
    expect(() => registerProfileIpc(ipc, { service: service as never })).toThrow(/already registered|duplicate/);
  });

  it("GET 现算：菜单刚改完档位，下一次读必须读到新值（不许在注册时快照一次）", () => {
    const ipc = makeScope();
    const state = { form: "cat", tier: "standard" } as { form: "cat" | "girl"; tier: "small" | "standard" | "large" };
    registerProfileIpc(ipc, { service: { getState: () => state } as never });
    const read = () => ipc.handlers.get(IPC.VERGE_PROFILE_GET)!(null);
    expect(read()).toEqual({ form: "cat", tier: "standard" });
    state.form = "girl";
    state.tier = "small";
    expect(read()).toEqual({ form: "girl", tier: "small" });
  });

  it("返回值与 profileFor 同源：拿 GET 的结果重建几何，必须等于主进程算的同一份数", () => {
    const ipc = makeScope();
    registerProfileIpc(ipc, { service: { getState: () => ({ form: "girl", tier: "large" }) } as never });
    const ref = ipc.handlers.get(IPC.VERGE_PROFILE_GET)!(null) as { form: "girl"; tier: "large" };
    expect(profileFor(ref.form, ref.tier).base).toEqual(profileFor("girl", "large").base);
  });
});
```

最后一条是本任务的正对照：它证明「收发两侧各自 `profileFor`」不是两套数表，而是同一份 shared 代码被调了两次。删掉 `profileFor` 里的 `k` 乘法它必红。

`src/main/pet/work-status-ipc.test.ts`：

```ts
import { describe, expect, it, vi } from "vitest";
import { IPC } from "../../shared/ipc-channels";
import type { WorkStatus } from "../../shared/work-status-types";
import type { IpcScope } from "../application/ipc-scope";
import { registerWorkStatusIpc } from "./work-status-ipc";

function makeScope() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const scope = {
    handlers,
    handle: vi.fn((channel: string, listener: (...args: unknown[]) => unknown) => {
      if (handlers.has(channel)) throw new Error(`duplicate ${channel}`);
      handlers.set(channel, listener);
    }),
    on: vi.fn(),
    removeHandler: vi.fn((channel: string) => { handlers.delete(channel); }),
    dispose: vi.fn(),
  };
  return scope as unknown as IpcScope & typeof scope;
}

const BUSY: WorkStatus = { tier: "工作中", source: "agent", since: 111, runId: "r-1", detail: "web_search" };

function makeService() {
  let next: ((s: WorkStatus | null) => void) | null = null;
  let current: WorkStatus | null = BUSY;
  const unsubscribe = vi.fn(() => { next = null; });
  const service = {
    current: vi.fn(() => current),
    subscribe: vi.fn((l: (s: WorkStatus | null) => void) => { next = l; return unsubscribe; }),
    set: (s: WorkStatus | null) => { current = s; next?.(s); },
  };
  return { service: service as never, set: service.set };
}

function setup() {
  const ipc = makeScope();
  const sent: Array<{ channel: string; payload: unknown }> = [];
  const sendToPetWindow = vi.fn((channel: string, payload: unknown) => { sent.push({ channel, payload }); });
  const { service, set } = makeService();
  const off = registerWorkStatusIpc(ipc, { service, sendToPetWindow });
  return { ipc, sent, off, set, sendToPetWindow };
}

describe("VERGE_WORK_STATUS_GET / UPDATE（Task 17）", () => {
  it("GET 读的是 service.current()，不是注册时快照的那一份", () => {
    const { ipc, set } = setup();
    const read = () => ipc.handlers.get(IPC.VERGE_WORK_STATUS_GET)!(null);
    expect(read()).toEqual(BUSY);
    set(null);
    expect(read()).toBe(null);
  });

  it("每次状态变更恰好一发下行，通道名与载荷逐字等于 service 给的", () => {
    const { sent, set } = setup();
    expect(sent).toHaveLength(0);                      // 注册本身不发：boot 读才是初始值
    const idle = { tier: "已处理", source: "agent", since: 222 } as WorkStatus;
    set(idle);
    expect(sent).toEqual([{ channel: IPC.VERGE_WORK_STATUS_UPDATE, payload: idle }]);
    set(null);
    expect(sent[1]).toEqual({ channel: IPC.VERGE_WORK_STATUS_UPDATE, payload: null });
    expect(sent[1]!.payload).toBe(null);               // 不许把 null 折成 undefined 或 {}
  });

  it("只发宠物窗：deps 里没有 broadcast，全窗发送口在本模块根本不存在（负向锁）", () => {
    const src = require("node:fs").readFileSync("src/main/pet/work-status-ipc.ts", "utf8") as string;
    expect(src).not.toMatch(/getAllWindows|broadcast|webContents\.send/);
  });

  it("载荷过得了 structured clone（detail 是字符串，WorkStatus 全平铺）", () => {
    const { sent, set } = setup();
    set({ ...BUSY, detail: "要不要我继续改这个文件？" });
    expect(structuredClone(sent.at(-1)!.payload)).toEqual({ ...BUSY, detail: "要不要我继续改这个文件？" });
  });

  it("dispose 退订并注销 handle；再订阅一次不会残留旧监听", () => {
    const { ipc, off, sent, set } = setup();
    off();
    expect(ipc.handlers.has(IPC.VERGE_WORK_STATUS_GET)).toBe(false);
    expect(ipc.removeHandler).toHaveBeenCalledWith(IPC.VERGE_WORK_STATUS_GET);
    const before = sent.length;
    set({ ...BUSY, since: 999 });
    expect(sent).toHaveLength(before);                 // 退订之后再推不许再发
  });

  it("监听器抛错不许吃掉 handle：订阅方炸了，GET 仍读得到当前值", () => {
    const ipc = makeScope();
    const service = { current: () => BUSY, subscribe: () => { throw new Error("boom"); } } as never;
    expect(() => registerWorkStatusIpc(ipc, { service, sendToPetWindow: vi.fn() })).not.toThrow();
    expect(ipc.handlers.get(IPC.VERGE_WORK_STATUS_GET)!(null)).toEqual(BUSY);
  });
});
```

第 3 条用 `require("node:fs")` 而不是 `import fs`，是因为本文件其余部分一个 Node 依赖都不需要，混进顶层 import 会让 `npx vitest run --environment happy-dom` 这类局部配置变化先炸在这里；写成 `import fs from "node:fs"` 也行，但**别用 `execSync("grep ...")`**（CI 上没有 grep，`project-p0-fork-environment-and-acceptance`）。第 6 条是 `createTopic` 那套错误隔离在 IPC 层的对应物：`work-status.ts` 的 `emit()` 已经把每个监听器包在 try 里（Task 16），所以这条实际测的是「注册函数不许因为订阅方抛错而放弃登记 handle」——删掉 `try` 的那一版实现会让 handle 根本没注册，猫窗从此读不到状态，这条把它钉住。

`src/renderer/pet/renderer.test.ts` 追加。harness 只借文件里**模块作用域**就有的两件套：`makeCanvas()`（`:18`）与 `makeLoopDriver()`（`:45`）。Task 12 段的 `makeVergeStub()`（`:227`）写在它自己的 `describe` 里面，**跨不出去**（Task 14 与 Task 18 两段各自又各带一份，本任务照这个既成事实再带一份），理由写进下面的注释；为什么不在本任务顺手抽公共层：抽出来要动 Task 12 那 7 条 tuck 用例的取证口径，而本期对四足的硬约束是「一字不变」，把重构塞进一个功能任务里是最容易漏红因的做法（记进 Step 6 的台账）。本任务**不开** `companion`：`setProfile` 走的是几何与绘制轴，引擎（`renderer.ts:135-145`）不参与，`window.localStorage` 也就没被读——不清 localStorage 是有前提的，不是漏了。

```ts
describe("PixelPetRenderer profile 与 workStatus 入口 (Task 17)", () => {
  const wa = { x: 0, y: 0, width: 1920, height: 1040 };
  const base = { x: 900, y: 400, width: 82, height: 108 };

  /**
   * 三个键而不是两个：`resizePetWindow` 与 `tuckHinted` 是 Task 12 那一份的口径，
   * `settlePetPosition`（`renderer.ts:360` 的 `onCompanionMove` 调）本任务不触发它
   * （没引擎就没有 companion move），但留着它——缺键的 stub 会让「实现哪天真去调它」
   * 红成 `window.verge.settlePetPosition is not a function`，那条红读起来像笔误而不是像回归。
   */
  function makeVergeStub() {
    const stub = { resizePetWindow: vi.fn(), tuckHinted: vi.fn(), settlePetPosition: vi.fn() };
    (window as unknown as { verge: unknown }).verge = stub;
    return stub;
  }

  /**
   * 与 Task 12 的 `makeTuckedRenderer`（`:237`）唯一的口径差：那边 `init()` 留在测试体里 await，
   * 这里收进工厂——本任务 6 条里有 5 条要 `setProfile`，而 `setProfile` 会走 `requestBounds`，
   * `init()` 之前 `catOrigin`/`workArea` 还没落定，先发的那一帧几何会把「换档才发」这件事糊掉。
   * 工厂末尾的 `mockClear()` 就是「基线那一发不算档位证据」，跟 `:260` 同一句理由。
   */
  async function makeR() {
    const loop = makeLoopDriver();
    const verge = makeVergeStub();
    const clock = { ms: 10_000 };
    vi.spyOn(performance, "now").mockImplementation(() => clock.ms);
    vi.spyOn(console, "log").mockImplementation(() => {});
    const r = new PixelPetRenderer({
      canvas: makeCanvas(), width: 82, height: 108, onLoad: vi.fn(), onError: vi.fn(),
    });
    await r.init();
    r.syncGeometry({ bounds: base, workArea: wa, tuckEnabled: false, tuckHinted: true, tuckLimit: 6 });
    verge.resizePetWindow.mockClear();
    return { r, loop, clock, verge, cat: (r as unknown as { cat: CatInput }).cat };
  }

  afterEach(() => {
    delete (window as unknown as { verge?: unknown }).verge;
  });

  it("setProfile 换档位：窗口基址按 round(82·k) 走，payload 里带着新尺寸", async () => {
    const { r, verge } = await makeR();
    r.setProfile({ form: "cat", tier: "large" });
    const last = verge.resizePetWindow.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(last).toMatchObject({ width: Math.round(82 * 1.22), height: Math.round(108 * 1.22) });
    r.dispose();
  });

  it("setProfile 与 setForm 不吵架：档位换了形也换了，绘制轴同帧归位", async () => {
    const { r, cat } = await makeR();
    r.setProfile({ form: "girl", tier: "small" });
    expect(cat.form).toBe("girl");                         // Task 14 的 setForm 写进 CatInput
    expect(r.getProfileRef()).toEqual({ form: "girl", tier: "small" });
    r.dispose();
  });

  it("非法档位字符串画的是 cat/standard，不是 NaN 框（读端不再判第二遍的证据）", async () => {
    const { r, verge } = await makeR();
    r.setProfile({ form: "dog" as never, tier: "huge" as never });
    const last = verge.resizePetWindow.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(last).toMatchObject({ width: 82, height: 108 });
    r.dispose();
  });

  it("standard 档逐字节等于今天：setProfile 之后一条下行都不许多发", async () => {
    const { r, verge } = await makeR();
    r.setProfile({ form: "cat", tier: "standard" });
    expect(verge.resizePetWindow).not.toHaveBeenCalled();   // 同值不发（去重在 main 侧，但同值连送都不该送）
    r.dispose();
  });

  it("boot 读不许盖掉已经收到的下行：origin 决定谁赢", async () => {
    const { r } = await makeR();
    const idle: WorkStatus = { tier: "已处理", source: "agent", since: 5 };
    r.setWorkStatus(idle, "push");
    r.setWorkStatus({ tier: "工作中", source: "agent", since: 1 }, "boot");
    expect(r.getWorkStatusSnapshot()).toEqual(idle);
    r.setWorkStatus({ tier: "思考中", source: "agent", since: 2 }, "boot");
    expect(r.getWorkStatusSnapshot()).toEqual(idle);        // boot 那一发永远不再有效
    r.setWorkStatus(null, "push");
    expect(r.getWorkStatusSnapshot()).toBe(null);
    r.dispose();
  });

  it("getPetDiagnostics 把两个入口的读数露出来（屏幕探针唯一的读端口）", async () => {
    const { r } = await makeR();
    r.setProfile({ form: "girl", tier: "large" });
    r.setWorkStatus({ tier: "提醒", source: "ask", since: 9, detail: "选一个" }, "push");
    const d = r.getPetDiagnostics();
    expect(d.profile).toEqual({ form: "girl", tier: "large" });
    expect(d.workStatus).toEqual({ tier: "提醒", source: "ask", since: 9, detail: "选一个" });
    r.dispose();
  });
});
```

`WorkStatus` 是本文件要新引入的**唯一**类型符号：`import type { WorkStatus } from "../../shared/work-status-types";`（Task 18 建的那个文件；本任务的 `setWorkStatus` 签名就靠它）。`PetProfileRef`/`PetForm` 不需要 import——`setProfile` 的参数由 TS 从方法签名推断，测试里传的是字面量。第 6 条不 cast：`getPetDiagnostics` 是本任务搬进 `PixelPetRenderer` 的**公开口**（Task 18 的 `renderer.test.ts` 段与 Task 26 的尺 #71 都直接调它），`cat` 是私有观测量，只有它需要那一次 cast。

`renderer.ts` 里 `getPetDiagnostics` 现在长在 `main.ts:131` 的那个对象字面量上（读 `renderer.isPaused()` 等）。本任务把它搬进 `PixelPetRenderer`，`main.ts` 那处改成 `renderer.getPetDiagnostics()` 再叠 `main.ts` 自己知道的列——理由写进代码注释：**探针要读的是渲染器状态，状态在哪就读在哪**；再一个原因是 Task 26 的尺 #71 从 CDP 读的就是这个对象，`main.ts` 的拼装没法单测。

`src/main/pet/pet-status-ipc-wiring.test.ts`（装配与通道登记文本锁；风格照 Task 15 的 `ipc-gate-wiring.test.ts` 与 Task 16 的 `-wiring`）：

```ts
import fs from "node:fs";
import { describe, expect, it } from "vitest";

const deps = fs.readFileSync("src/main/application/default-dependencies.ts", "utf8");
const channels = fs.readFileSync("src/shared/ipc-channels.ts", "utf8");
const policy = fs.readFileSync("src/main/application/ipc-sender-policy.ts", "utf8");
const preload = fs.readFileSync("src/preload/index.ts", "utf8");

describe("Task 17 装配锁", () => {
  it("四条通道都登记了，且值就是本节写死的那四个字符串", () => {
    expect(channels).toMatch(/VERGE_PROFILE_GET:\s*"verge:profile:get"/);
    expect(channels).toMatch(/VERGE_PROFILE_UPDATE:\s*"verge:profile:update"/);
    expect(channels).toMatch(/VERGE_WORK_STATUS_GET:\s*"verge:work-status:get"/);
    expect(channels).toMatch(/VERGE_WORK_STATUS_UPDATE:\s*"verge:work-status:update"/);
  });

  it("Task 7 的裸字符串通道名在本仓彻底消失（不留半个未登记通道）", () => {
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = `${dir}/${e.name}`;
        if (e.isDirectory()) { walk(p); continue; }
        if (!/\.tsx?$/.test(e.name) || /\.test\.tsx?$/.test(e.name)) continue;
        if (fs.readFileSync(p, "utf8").includes('"verge:profile:update"')) hits.push(p);
      }
    };
    for (const d of ["src/main", "src/preload", "src/renderer", "src/shared"]) walk(d);
    expect(hits, `还在写裸通道名：${hits.join("、")}`).toEqual([]);
  });

  it("两个 register 调用都在装配层，且各自都挂进了 shutdown", () => {
    expect(deps).toMatch(/registerProfileIpc\(ipc,\s*\{/);
    expect(deps).toMatch(/registerWorkStatusIpc\(ipc,\s*\{[\s\S]{0,200}sendToPetWindow/);
    expect(deps).toMatch(/removeProfileIpc\(\)[\s\S]{0,120}removeWorkStatusIpc\(\)/);
  });

  it("两条入站进发送方白名单，都是 pet；UPDATE 系不入表（没有入站方向）", () => {
    expect(policy).toMatch(/\[IPC\.VERGE_PROFILE_GET\]:\s*\["pet"\]/);
    expect(policy).toMatch(/\[IPC\.VERGE_WORK_STATUS_GET\]:\s*\["pet"\]/);
    expect(policy).not.toMatch(/VERGE_PROFILE_UPDATE|VERGE_WORK_STATUS_UPDATE/);
  });

  it("preload 四个入口齐了，且 onX 都返回退订函数（ipc-contract 的 listen 方向靠它）", () => {
    for (const key of ["VERGE_PROFILE_GET", "VERGE_PROFILE_UPDATE", "VERGE_WORK_STATUS_GET", "VERGE_WORK_STATUS_UPDATE"]) {
      expect(preload, key).toContain(`IPC.${key}`);
    }
    expect(preload).toMatch(/onWorkStatus:[\s\S]{0,300}return \(\) => ipcRenderer\.off\(IPC\.VERGE_WORK_STATUS_UPDATE/);
    expect(preload).toMatch(/onProfileUpdate:[\s\S]{0,300}return \(\) => ipcRenderer\.off\(IPC\.VERGE_PROFILE_UPDATE/);
  });

  it("外发点写的是 IPC 常量而不是透传变量（扫描器只认前者）", () => {
    expect(fs.readFileSync("src/main/pet/work-status-ipc.ts", "utf8"))
      .toMatch(/sendToPetWindow\(IPC\.VERGE_WORK_STATUS_UPDATE,/);
    expect(deps).toMatch(/sendToPetWindow\(IPC\.VERGE_PROFILE_UPDATE,\s*profileRefOf/);
  });
});
```

- [ ] **Step 2: 跑红**

```bash
CI=true npx vitest run src/shared/pet-profile.test.ts src/main/verge/profile-ipc.test.ts src/main/pet/work-status-ipc.test.ts src/main/pet/pet-status-ipc-wiring.test.ts src/renderer/pet/renderer.test.ts
```

Expected: 三个新文件报模块找不到（`Cannot find module './profile-ipc'` / `'./work-status-ipc'`）；`pet-profile.test.ts` 的 clone 那条红在 `profileRefOf is not a function`；`renderer.test.ts` 新 describe 六条全红在 `r.setProfile is not a function`。**`pet-status-ipc-wiring.test.ts` 应当一条就红在第一个 `it`**（通道还没登记）——如果它意外全绿，说明 `walk()` 那个目录递归没跑起来（Windows 路径分隔符或 `readdirSync` 权限），先修尺子再往下走，别把尺子坏了读成通过（`project-false-green-locks`）。

- [ ] **Step 3: 实现**

`src/shared/ipc-channels.ts`，紧跟 `CYRENE_OPEN_NETWORK_PANEL` 那条之后、`} as const` 之前：

```ts
  // —— v1.5.0 拟人态：形态/身形与六档工作状态 ——
  /** 渲染端 → main：读当前形态与身形档位。载荷只有两个字符串（PetProfileRef），
   *  几何由收发两侧各自 profileFor 现算——PetProfile 带方法，structured clone 发不出去。 */
  VERGE_PROFILE_GET: "verge:profile:get",
  /** main → 宠物窗：菜单或设置页改了形态/档位（载荷同 GET）。 */
  VERGE_PROFILE_UPDATE: "verge:profile:update",
  /** 宠物窗 → main：起帧读一次当前工作状态。run 可能早就在跑，只订下行会漏掉开场。 */
  VERGE_WORK_STATUS_GET: "verge:work-status:get",
  /** main → 宠物窗：六档变更。只发宠物窗——detail 里是工具名或卡片首行。 */
  VERGE_WORK_STATUS_UPDATE: "verge:work-status:update",
```

`src/shared/pet-profile.ts`，`profileFor` 之后：

```ts
/**
 * 过 IPC 的形态引用。`PetProfile` 上有 `catScale(e)` 方法，structured clone 对函数
 * 直接抛 DOMException，所以线上只跑这两个字符串；几何由收发两侧各自调 `profileFor` 现算，
 * 同一份 shared 数表，不存在两处要人肉对齐的常量。
 * 读端不再写 decode：`profileFor` 第一行就把非法值回落成 cat/standard。
 */
export interface PetProfileRef {
  form: PetForm;
  tier: SizeTier;
}

export function profileRefOf(form: PetForm, tier: SizeTier): PetProfileRef {
  return { form, tier };
}
```

`src/main/verge/profile-ipc.ts`：

```ts
import { IPC } from "../../shared/ipc-channels";
import { profileRefOf } from "../../shared/pet-profile";
import type { IpcScope } from "../application/ipc-scope";
import type { VergeService } from "./verge-service";

export interface ProfileIpcDeps {
  service: VergeService;
}

/**
 * 形态/档位的读端。写端不在这里：菜单与设置页各自落盘之后都走装配层的
 * `applyProfileState`（与 applyQuietState / applyTuckState 同一套「唯一收口」），
 * 本模块只负责让渲染端起帧能读到盘上的真值。
 */
export function registerProfileIpc(ipc: IpcScope, deps: ProfileIpcDeps): () => void {
  ipc.handle(IPC.VERGE_PROFILE_GET, () => {
    const state = deps.service.getState();
    return profileRefOf(state.form, state.tier);
  });
  return () => {
    ipc.removeHandler(IPC.VERGE_PROFILE_GET);
  };
}
```

`src/main/pet/work-status-ipc.ts`：

```ts
import { IPC } from "../../shared/ipc-channels";
import type { IpcScope } from "../application/ipc-scope";
import type { WorkStatusService } from "./work-status";

export interface WorkStatusIpcDeps {
  service: WorkStatusService;
  /** 只发宠物窗。工作状态带 detail（工具名 / 卡片首行），别的窗口没有理由看见。 */
  sendToPetWindow: (channel: string, payload: unknown) => void;
}

export function registerWorkStatusIpc(ipc: IpcScope, deps: WorkStatusIpcDeps): () => void {
  const unsubscribe = deps.service.subscribe((status) => {
    deps.sendToPetWindow(IPC.VERGE_WORK_STATUS_UPDATE, status);
  });
  ipc.handle(IPC.VERGE_WORK_STATUS_GET, () => deps.service.current());
  return () => {
    unsubscribe();
    ipc.removeHandler(IPC.VERGE_WORK_STATUS_GET);
  };
}
```

`default-dependencies.ts` 三处。① `applyTuckState` 那个 const 之后：

```ts
        // 形态/档位变更的唯一收口（applyQuietState / applyTuckState 同构）：菜单与设置页两条
        // 写盘路径落盘后都从这里推宠物窗。载荷是 profileRefOf 的两个字符串，不是 profileFor 整个
        // 对象——后者带 catScale 方法，webContents.send 当场抛 "could not be cloned"（Task 17 口径差⑦）。
        const applyProfileState = (form: PetForm, tier: SizeTier): void => {
          shell.windowManager.sendToPetWindow(IPC.VERGE_PROFILE_UPDATE, profileRefOf(form, tier));
        };
```

`attachPetContextMenu({...})` 的参数里，把 Task 7 当初注入 `broadcast` 的那个键换成：

```ts
            onProfileChange: applyProfileState,
```

② `registerNetworkIpc` 那一段之后：

```ts
        // v1.5.0 拟人态两条下行：档位读端 + 工作状态读写。宠物窗是唯一的渲染端消费者，
        // 所以 work-status 的下行走 windowManager.sendToPetWindow（猫窗没开就静默丢弃——
        // 猫窗没开不等于工作状态不存在，boot 读仍然拿得到值）。
        const removeProfileIpc = registerProfileIpc(ipc, { service: verge });
        const removeWorkStatusIpc = registerWorkStatusIpc(ipc, {
          service: workStatus,
          sendToPetWindow: (channel, payload) => shell.windowManager.sendToPetWindow(channel, payload),
        });
        shutdown.register({
          id: "verge-pet-status-ipc",
          phase: "flushPersistence",
          dispose: async () => { removeProfileIpc(); removeWorkStatusIpc(); },
        });
```

变量名以现场为准：`verge` 是 `:551` 那个 closure 里的名字，`:809` 那段用的是 `services.verge`；`workStatus` 是 Task 16 在装配层建的那个。两处照 grep 结果写，别照抄本计划。

`src/preload/index.ts`，`onOpenNetworkPanel` 之前：

```ts
  // —— v1.5.0 拟人态：形态档位 + 六档工作状态 ——
  /** 只有两个字符串：几何由渲染端自己 profileFor。main 侧 toState 已容错，这里恒有值。 */
  getProfile: () =>
    ipcRenderer.invoke(IPC.VERGE_PROFILE_GET) as Promise<import("../shared/pet-profile").PetProfileRef>,
  onProfileUpdate: (callback: (ref: import("../shared/pet-profile").PetProfileRef) => void) => {
    const listener = (_e: unknown, ref: import("../shared/pet-profile").PetProfileRef) => callback(ref);
    ipcRenderer.on(IPC.VERGE_PROFILE_UPDATE, listener);
    return () => ipcRenderer.off(IPC.VERGE_PROFILE_UPDATE, listener);
  },
  /** 起帧读一次：run 可能早就在跑，只订下行会漏掉开场那一档。 */
  getWorkStatus: () =>
    ipcRenderer.invoke(IPC.VERGE_WORK_STATUS_GET) as
      Promise<import("../shared/work-status-types").WorkStatus | null>,
  onWorkStatus: (callback: (status: import("../shared/work-status-types").WorkStatus | null) => void) => {
    const listener = (_e: unknown, status: import("../shared/work-status-types").WorkStatus | null) => callback(status);
    ipcRenderer.on(IPC.VERGE_WORK_STATUS_UPDATE, listener);
    return () => ipcRenderer.off(IPC.VERGE_WORK_STATUS_UPDATE, listener);
  },
```

`src/renderer/types/cyrene.d.ts` 补同名四条（返回类型用 `import("../../shared/...")` 内联，风格与本文件 `network` 那组一致）。**这个文件是 `.d.ts`，`ipc-contract` 扫描器会跳过它**（`ipc-contract.test.ts:53`），所以它对通道名不构成锁，只构成编译期契约——preload 与它不同步会在 `npm run check:renderer` 里红，不会在 vitest 里红。

`src/renderer/main.ts`，Task 12 几何段之后、`onPetCommand` 之前：

```ts
    // v1.5.0 形态与身形：起帧读一次（存量 state.json 没这两个键时 main 已回落 cat/standard），
    // 之后跟菜单/设置页的下行走。先订后读：下行到过之后 boot 那一发永远作废（见 setWorkStatus）。
    profileUpdateOff = window.verge?.onProfileUpdate((ref) => renderer.setProfile(ref)) ?? null;
    void window.verge?.getProfile().then((ref) => renderer.setProfile(ref))
      .catch(() => { /* 读不到就停在 DEFAULT_PROFILE：猫照画，只是回默认档 */ });

    workStatusOff = window.verge?.onWorkStatus((s) => renderer.setWorkStatus(s, "push")) ?? null;
    void window.verge?.getWorkStatus().then((s) => renderer.setWorkStatus(s, "boot"))
      .catch(() => { /* 没状态就是没状态，不许兜一份假的 */ });
```

两处的 off 句柄跟 `quietChangedOff` / `geometryChangedOff` 一起进现有的 `dispose` 清理列表（`main.ts` 里那段 `window.verge?.isQuiet()` 附近已有一串 `?? null` 的订阅句柄，照它们的清理位置办）。

`src/renderer/pet/renderer.ts`：

```ts
  private profile: PetProfile = DEFAULT_PROFILE;
  private workStatus: WorkStatus | null = null;
  /** boot 读与 push 下行共用一个入口，但只有 push 之后的 boot 值才该被丢弃。 */
  private workStatusPushed = false;

  /**
   * 生产唯一入口：形态与档位同帧换。`setForm` 只换绘制轴，几何（基址/PIN/命中）归这里，
   * 两者分开调会让 requestBounds 用旧档的算式配新形的画——Task 14 的 setForm 因此改成
   * 经由这里，而不是各自维护一份 form。
   */
  setProfile(ref: PetProfileRef): void {
    const next = profileFor(ref.form, ref.tier);
    if (next.form === this.profile.form && next.tier === this.profile.tier) return;
    this.profile = next;
    this.setForm(next.form);
    // 基址变了必须重发一次几何：窗口尺寸、PIN 与命中框都是 profile 的函数。
    // canvas 自己会跟上——主进程 setBounds 之后 window "resize" 走 main.ts:148-149
    // 那条既有通路调 renderer.resize(innerW, innerH)，这里不许再动 canvas 尺寸。
    if (this.catOrigin && this.workArea) {
      this.requestBounds("pet", 0, this.catOrigin, this.workArea, this.peekDx);
    }
  }

  getProfileRef(): PetProfileRef {
    return profileRefOf(this.profile.form, this.profile.tier);
  }

  setWorkStatus(status: WorkStatus | null, origin: "push" | "boot" = "push"): void {
    if (origin === "boot" && this.workStatusPushed) return;
    if (origin === "push") this.workStatusPushed = true;
    this.workStatus = status;
    // 本期（Task 17）只落读数：演出映射在 Task 18 从这里进（tier → expression/gesture）。
    if (!this.paused) this.draw(performance.now());
  }

  getWorkStatusSnapshot(): WorkStatus | null {
    return this.workStatus;
  }
```

`setForm(form)` 保留原样（Task 14 的 12 条断言与后面的尺 #71/#72 按形态取样都调它），但注释加一句：**生产路径只走 `setProfile`；直接调 `setForm` 会让几何停在旧档**——这条约束在本任务里唯一能自动化的落点是上面「setProfile 与 setForm 不吵架」那条测试，别把它写成 `setForm` 也去重算几何（那会让 Task 14 的取样测试多收一发 resize）。

`requestBounds`（`:471`）与它调用的 `computePetLayout` / `resolveGrowthDirection` / `computeCatRect` 三处补 `profile: this.profile`（Task 3 已给这三个函数开了 `profile?` 形参）。另外，`renderer.ts` 里读窗口基址的字面量点**实测是 6 行不是 11 行**（`grep -n "PET_W\|PET_H" src/renderer/pet/renderer.ts` 去掉 `:7-8` 两行 import 后得 `:381`、`:401`、`:544`、`:563`、`:667`、`:668`；同式的 `BUB_W` 在 `:414`、`:430`，`PIN` 在 `:123`、`:449`——这三组量的是不同东西，早期版本把 15 个 token 出现次数说成「11 个点」，是个没 grep 过的数字）——按 Task 3 的口径把 **6 行基址读取**逐个换成 `this.profile.base`。**本任务只换 `requestBounds` 这条链**（`:401`/`:544`），其余四行（`:381`/`:563`/`:667`/`:668`）留在 Task 27 的三档端到端里收口（那条要求「standard 档逐字节等于今天」，一次全换会让 standard 的回归面从 2 处变成 6 处）。这是刻意的两步，不是一处半活：`DEFAULT_PROFILE` 时 `base = 82×108`，其余点继续读常量与读 `this.profile.base` 得到的是同一个数。

同一条链上的两句注释必须跟着改，否则它们会变成界面级的假话（`applyZoom` 头上 `:158-162` 那句「绘制空间恒回 82×108 基址几何」在本任务之后只对 standard 档成立，改成「恒回 `profile.base` 基址几何；standard 档＝82×108」）：注释里写死的数与代码里的口径一旦分家，下一个人就会照着注释把 PIN 再算一遍。

- [ ] **Step 4: 跑绿 + 全量门**

```bash
CI=true npx vitest run src/shared/pet-profile.test.ts src/main/verge/profile-ipc.test.ts src/main/pet/work-status-ipc.test.ts src/main/pet/pet-status-ipc-wiring.test.ts src/renderer/pet/renderer.test.ts
CI=true npx vitest run src/main/application/ipc-contract.test.ts src/main/application/ipc-scope.test.ts
npm run check:main && npm run check:preload && npm run check:renderer
CI=true npx vitest run
```

第二条是这任务真正的新旧交界：`ipc-contract.test.ts` 的反向对账（`:154-162`，「不留白名单」）要求 `VERGE_PROFILE_UPDATE` / `VERGE_WORK_STATUS_UPDATE` 这两条外发在 preload 侧有 `ipcRenderer.on`；`invoke` 方向要求两条 GET 有 handle。若它红在「`VERGE_PROFILE_UPDATE` 找不到对应的 preload 监听」，说明 Step 0 第 3 条说的写法没做到——装配点写成了透传变量，扫描器看不见那条外发。**别给扫描器加白名单**。

第四条全套之前，复核一遍 Task 16 的装配段用的是 `shutdown.register({ id, phase, dispose })`（`shutdown.ts:33-35`、`:145`）——本计划早先写成了 `{ name, order, run }`，已在 Task 16 那节改过；如果你手上的树里还是旧形状，先改回来再往下跑，否则 `npm run check:main` 会红在一句跟本任务无关的错上。

- [ ] **Step 5: 变异验牙（五条，逐条改完还原再跑同一条命令）**

1. `profile-ipc.ts` 的 GET 改成 `return { ...deps.service.getState() }`（顺手带回 `statePath`）：`profile-ipc.test.ts` 的「键名集合钉死」红，clone 那条**不会**红（`statePath` 是字符串）——这条变异的意义就在键名锁上，别指望 clone 锁替你守路径泄漏。
2. `work-status-ipc.ts` 的 `sendToPetWindow` 换成 `broadcast`（全窗）：负向锁那条红，`pet-status-ipc-wiring.test.ts` 的「外发点写的是 IPC 常量」也红。
3. 删掉 `setWorkStatus` 里的 `if (origin === "boot" && this.workStatusPushed) return;`：「boot 读不许盖掉已经收到的下行」红。
4. 把 `setProfile` 里 `this.profile = next;` 挪到 `requestBounds` 之后：resize payload 仍是 82×108 → 「setProfile 换档位」红。这条抓的是「先算后换」这一类顺序错，不是笔误。
5. 注释掉装配层的 `registerWorkStatusIpc(ipc, {...})`：`ipc-contract.test.ts` 红在「invoke 的通道找不到 handle」，`pet-status-ipc-wiring.test.ts` 第二条红。两条一起红才说明尺子真的连着。

跑法：`CI=true npx vitest run src/main/pet/work-status-ipc.test.ts src/renderer/pet/renderer.test.ts src/main/application/ipc-contract.test.ts`。把「哪几条红了、哪几条没红」原样写进提交信息（`project-false-green-locks`：放宽阈值或改断言之前必须先证明尺子有牙）。

- [ ] **Step 6: 台账与提交**

`docs/verge/notes/progress.md` 追加三条：口径差⑦（`PetProfile` 过不了 structured clone，Task 7 原文已按本任务纠正）；`VERGE_GET_SNAPSHOT` 借道方案被否的理由（`statePath` 不下发给宠物窗）；work-status 的 `["pet"]` 白名单两行来自本任务、Task 18 若新增渲染端读方要同步补表。

```bash
git add src/shared/ipc-channels.ts src/shared/pet-profile.ts src/shared/pet-profile.test.ts \
  src/main/verge/profile-ipc.ts src/main/verge/profile-ipc.test.ts \
  src/main/pet/work-status-ipc.ts src/main/pet/work-status-ipc.test.ts src/main/pet/pet-status-ipc-wiring.test.ts \
  src/main/application/default-dependencies.ts src/main/application/ipc-sender-policy.ts \
  src/preload/index.ts src/renderer/types/cyrene.d.ts src/renderer/main.ts \
  src/renderer/pet/renderer.ts src/renderer/pet/renderer.test.ts docs/verge/notes/progress.md
git diff --cached --numstat
git commit -m "$(cat <<'EOF'
feat(pet): 形态档位与工作状态两条下行通道进 IPC（Task 17）

载荷只跑 {form,tier} 两个字符串：PetProfile 带 catScale 方法，structured clone
对函数直接抛（本机实测 DOMException: could not be cloned），Task 7 原本要发的
profileFor 整个对象会在菜单点下去的那一瞬抛在发送侧。几何由收发两侧各自
profileFor 现算，同一份 shared 数表；读端不再写 decode——两处各判一遍是假严谨。

VERGE_GET_SNAPSHOT 借道方案否决：VergeSnapshot 里躺着 statePath，为了少写一个
handle 把 userData 路径发给宠物窗正是 R-D11 要防的顺手 widen。
工作状态外发走 sendToPetWindow 而不是全窗 broadcast：detail 是工具名/卡片首行。

boot 读与 push 下行同一个入口，push 到过之后 boot 那一发永远作废：先订后读，
boot 读与 push 下行共用同一个入口，push 到过之后 boot 那一发永远作废：
先订后读，免得装配竞态把旧档位盖掉新档位。
谁赢由渲染端那一个 latch 决定，不靠两边对表钟。
EOF
)"
```

---

## Task 18: 六档演出表 + 工具名白名单 + #74 证据链（P3 收口）

**Files:**
- Create: `src/shared/pet-tool-labels.ts` + `src/shared/pet-tool-labels.test.ts`
- Create: `src/renderer/pet/work-status-presentation.ts` + `src/renderer/pet/work-status-presentation.test.ts`
- Create: `src/main/pet/work-status-probe.ts` + `src/main/pet/work-status-probe.test.ts`
- Create: `scripts/verify/work-status-cdp.mjs`
- Modify: `src/main/pet/work-status.ts`（Task 16 的 `displayLabelOf` 整段换掉）
- Modify: `src/main/pet/work-status.test.ts`（Task 16 Step 1 那条 `detail` 断言，plan 原文 `toBe("读文件")`）
- Modify: `src/renderer/pet/renderer.ts`（`setWorkStatus` 落演出、`applyLayerPose` 表情级联、`handleBubbleClick`、`getPetDiagnostics` 扩列）
- Modify: `src/renderer/pet/companion.ts`（`WORK_STATUS_LINES` + `noteWorkStatus`）
- Modify: `src/renderer/pet/companion.test.ts`
- Modify: `src/renderer/pet/form.ts`（`PetInput` 追加 `faceBias?`）
- Modify: `src/renderer/pet/girl.ts`（`buildFaceOps` 的入参吃 `faceBias`）
- Modify: `src/renderer/pet/girl.test.ts`
- Modify: `src/renderer/main.ts:415-420`（气泡点击改走 `handleBubbleClick`）+ `:131` 诊断拼装
- Modify: `src/renderer/pet/renderer.test.ts`（追加自带 harness 的 Task 18 describe；它的 verge stub 里带 `revealAskWorkStatus`，**不去改 Task 12 段那份**——`makeVergeStub` 是 describe 作用域，跨不出去）
- Modify: `src/shared/ipc-channels.ts`、`src/main/application/ipc-sender-policy.ts`、`src/main/pet/work-status-ipc.ts`、`src/main/application/default-dependencies.ts`、`src/preload/index.ts`、`src/renderer/types/cyrene.d.ts`
- Modify: `src/renderer/pet/pet-status-ipc-wiring.test.ts`（第五道通道）
- Modify: `package.json`（新脚本 `verify:work-status`）
- Modify: `docs/verge/notes/progress.md`

**Interfaces:**
- Consumes（全部已在前面的任务落地，本任务只读不改签名）：
  - Task 16：`WORK_STATUS_TIERS`、`type WorkStatus`、`type WorkStatusTier`、`WorkStatusService`（`current/subscribe/noteAguiEvent/noteCancel/noteAskOpen/noteAskSettled/noteNetwork/dispose`）、`SETTLED_MS = 5_000`、`IDLE_FALLBACK_MS = 8_000`
  - Task 14：`this.slots` / `slotFor` / `gestureSlotFor` / `tickSlots` / `applyLayerPose` / `playGesture` / `stopGesture` / `gestureProgress` / `MOOD_TO_EXPRESSION`、`mixPose`、`bodyClip` / `gestureClip`、`type Channels` / `Channel`
  - Task 13：`Clip.face?: Expression`；本任务用到的片名全部已注册（`stand` `sit` `tilt` `wave` `peek` `typeCode` `bow` `shiver`）
  - Task 9/10：`faceOf`、`type FaceParams`、`type Expression`、`buildFaceOps(params, head, s, coat, u)`
  - Task 17：`setWorkStatus(status, origin)`、`getWorkStatusSnapshot()`、`registerWorkStatusIpc(ipc, { service, sendToPetWindow })`、`profileRefOf`、`this.profile`、`this.form`
  - Task 15：`ipc.handle(channel, { allow: [...] }, fn)`
  - 现场既有：`activation.request({ kind: "chat" })`（`default-dependencies.ts:1006` 给 toast 用的同一个 broker）
- Produces（Task 20/22/23/24/26/27/28 会读这些名字）：
  - `src/shared/pet-tool-labels.ts`：`PET_TOOL_LABELS: Readonly<Record<string, string>>`、`PET_TOOL_GENERIC_LABEL = "在忙"`、`petToolLabel(toolCallName: string | undefined): string`
  - `src/renderer/pet/work-status-presentation.ts`：`interface TierPresentation`、`presentationOf(tier: WorkStatusTier): TierPresentation`、`starPulse(now: number, since: number): number`、`applyBias(mixed: Channels, bias: Partial<Channels>): Channels`、`STAR_PULSE_MS = 1_400`、`STAR_PULSES = 3`
  - `PixelPetRenderer.setBodyClip(id: string | null)`、`handleBubbleClick()`、`getPetDiagnostics()` 新增列 `form/expression/bubbleText`
  - `CompanionEngine.noteWorkStatus(status: WorkStatus | null, now?): boolean`、`WORK_STATUS_LINES: Record<WorkStatusTier, string[]>`
  - `PetInput.faceBias?: Partial<FaceParams>`
  - `IPC.VERGE_PET_REVEAL_ASK = "verge:pet-reveal-ask"`、preload `revealAskWorkStatus()`
  - `startWorkStatusProbe(service: WorkStatusService, opts?): () => void`
  - `npm run verify:work-status -- <shotsDir>`（尺 #74）

**为什么白名单放在 `src/shared` 而不是 `src/main/pet`**：`detail` 由主进程算，但 `noteWorkStatus` 的「工作中」分支要在渲染端兜一层同源的缺省词。放 `src/main` 就是渲染端跨进程目录 import（`check:renderer` 的入口链是 `src/renderer` → `src/shared`，反向没有这条路）；复制一份「在忙」则会出现两个地方各自改字。shared 是唯一能同时被两边读、又不引入依赖的方向。

**为什么 `detail` 从此不再读 `toolCallDisplayName`**（这是本任务对 Task 16 的一处**改口径**，不是补洞）：现场实测两条生产者给的 `displayName` 语义不同——registry 系工具给中文（`fs-tools.ts:155 name: "读取文件"`，经 `cyrene-agent.ts:294-299` 的 `registryTool?.name`），harness 内建工具的 `name` **就是英文 id**（`builtin-tools.ts:36 name: TASK_TOOL_ID`、`:318 name: ASK_USER_TOOL_ID`、`plan-tools.ts:36/61/78` 同形），MCP 工具注册进同一个 `toolRegistry`（`orchestrator/mcp-adapter.ts`）且 `ToolDefinition`（`tools/registry/tool-registry.ts:68-127`）没有任何 origin 字段可判。也就是说「这个字符串是不是内部标识」无法靠字段来源判断，只能靠**逐个点名**。所以 Task 16 那句「缺它才退回内部名，那种值由 Task 18 的白名单负责过滤」在 Task 18 落地成：内部名根本不进 `detail`，`toolCallName` 过表，未登记一律 `PET_TOOL_GENERIC_LABEL`。

- [ ] **Step 0: 七处 grep 复核（不许照抄本节）**

```bash
cd /d/Test/workbuddy/cyrene-verge
# 1) Task 16 那个私有函数现在长什么样、被谁调用（只有一处调用点）
grep -n "displayLabelOf" src/main/pet/work-status.ts
# 2) displayName 的两条生产者与它们的 name 形态（决定「不能读 displayName」这条判断）
grep -n "toolCallDisplayName" src/main/agui-bridge.ts src/main/orchestrator/cyrene-agent.ts src/main/orchestrator/harness/adapter/event-mapper.ts
grep -n "name: TASK_TOOL_ID\|name: ASK_USER_TOOL_ID\|name: UPDATE_TODO_TOOL_ID" src/main/orchestrator/harness/builtin-tools.ts
# 3) 白名单里每个 id 的声明位置（逐个抄出处，不许凭记忆）
grep -rn 'id: "read_file"\|id: "list_dir"\|id: "write_file"\|id: "search_text"\|id: "apply_patch"' src/main --include=*.ts | grep -v "\.test\."
grep -rn 'id: "run_shell"\|id: "fetch_url"\|id: "web_search"\|id: "weather"' src/main --include=*.ts | grep -v "\.test\."
grep -rn '_TOOL_ID = "\|id: POP_QUIZ_TOOL_ID' src/main --include=*.ts | grep -v "\.test\."
# 4) 聊天页已经有的同一套中文词（猫的措辞要跟它一致，别造第二套词汇）
grep -n "liveReadFile\|liveRunShell\|toolAskUser\|fallbackAction" src/renderer/react/i18n/zh-CN.json
grep -n "LIVE_TOOL_LABEL_KEYS" src/renderer/react/features/chat/components/agent-rounds.ts
# 5) ask 卡的「去看」到底走哪条路（猫必须走同一条，否则两处承诺分家）
grep -n "window: \"chat\"\|case \"window\"" src/main/toast/toast-service.ts
grep -n "activate: (request)\|activation.request({ kind: \"chat\" })" src/main/application/default-dependencies.ts src/main/application/application.ts
# 6) 宠物窗在 dev/prod 同 URL ⇒ #74 只能靠 DOM 认 target
grep -n "loadURL\|loadFile" src/main/startup/create-pet-window.ts
grep -n "pet-canvas" src/renderer/main.ts
# 7) 档位落盘文件名（harness 预写 girl/large 用）+ 全新 profile 的默认可见性
grep -n "VERGE_STATE_FILE" src/main/verge/verge-store.ts src/main/verge/verge-service.ts
grep -n "petVisible: true" src/main/settings/settings-facade.ts
grep -n "disclaimerAcceptedVersion === undefined" src/main/application/core-bootstrap.ts
```

第 1 条**期望恰好 2 处**（定义 + `TOOL_CALL_START` 那一行调用）；多于 2 处说明 Task 16 之后有人又加了读者，先读那处再动刀。第 2 条是本任务判断的依据：`event-mapper.ts:106` 透传 `event.displayName`、`cyrene-agent.ts:299` 透传 `registryTool?.name`，而 harness 那几个 `name:` 就是英文 id——三条一起看才敢下「不读 displayName」。第 4 条给措辞定锚：`zh-CN.json:256-290` 的 `agentRounds.live*` 一组就是「实时执行中的工具动作名」（`agent-rounds.ts:64-69` 的注释自己写明了），猫的 工作中 说的是同一件事，词就该是同一批词；注意 `agent-rounds.ts:69` 未知名 `return name` 原样吐回——那是聊天页的口径，**猫这里不许照抄**（spec §13 的「未登记 toolName 不显示内部标识」是给猫的）。第 5 条决定深链的落点：`toast-service.ts:268-272` 里 ask-choice 的点击就是 `deps.activate({ kind: "chat" })`，而 `default-dependencies.ts:1006` 把它接成 `activation.request(request)`——猫复用同一个函数，不新开一条 `openReactChatWindow()` 通路（broker 还白送两样：`window-activation.ts:49-58` 未就绪时按 kind 入队、失败静默，`application.ts:85` 已经在用 `request({ kind: "chat" })` 这个字面形式）。第 6 条是尺子设计的前提：`create-pet-window.ts:118/120` dev 是 `http://localhost:5173`、prod 是 `dist/renderer/index.html`，与 React 窗同源同盘，`findTarget(url => …)` 分不出猫；只有 `src/renderer/main.ts:6` 的 `document.getElementById("pet-canvas")` 是猫独有的，所以脚本逐个 attach、用 DOM 认猫窗（照 `p4-cdp-capture.mjs:110-124` 的 `findTarget` 改，不要以为 URL 能认出来）。第 7 条三处一起决定「一次性 profile 起起来就能看见猫」：`verge-store.ts:5` 的 `path.join("verge", "state.json")` 是档位落盘处（`verge-service.ts:21` 拼 userDataDir），`settings-facade.ts:52 petVisible: true` + `core-bootstrap.ts:190-195` 的 `disclaimerAcceptedVersion === undefined ⇒ accepted` ⇒ 空 profile 的宠物窗是**可见**的，脚本只需预写 `verge/state.json` 一行，不用伪造同意书。

- [ ] **Step 1: 写失败测试**

`src/shared/pet-tool-labels.test.ts`：

```ts
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PET_TOOL_GENERIC_LABEL, PET_TOOL_LABELS, petToolLabel } from "./pet-tool-labels";

/** 只读 src/main 的非测试源码；.d.ts 与 *.test.ts 里的假 id 不算声明（Task 17 的 walk 同一口径）。 */
function mainSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/\.tsx?$/.test(e.name) || /\.test\.tsx?$/.test(e.name) || e.name.endsWith(".d.ts")) continue;
      out.push(fs.readFileSync(p, "utf8"));
    }
  };
  walk("src/main");
  return out;
}

/** 这个 id 是否在 src/main 里被声明过（两种形式：注册表字面量、harness 常量）。 */
function declaresToolId(id: string): boolean {
  const needles = [`id: "${id}"`, `_TOOL_ID = "${id}"`, `_TOOL_ID: "${id}"`];
  return mainSources().some((src) => needles.some((n) => src.includes(n)));
}

describe("猫嘴里的工具名白名单 (Task 18)", () => {
  it("尺子自己有牙：真 id 命中、编出来的 id 不命中（防「walk 没跑起来」被读成通过）", () => {
    expect(declaresToolId("read_file")).toBe(true);
    expect(declaresToolId("update_todo")).toBe(true);
    expect(declaresToolId("totally_unregistered_tool")).toBe(false);
  });

  it("白名单里每个键都还在 src/main 有声明（改名/删工具会在这里红，不会红在猫身上）", () => {
    for (const id of Object.keys(PET_TOOL_LABELS)) {
      expect(declaresToolId(id), `${id} 已从 src/main 消失`).toBe(true);
    }
  });

  it("每个值都是给用户看的中文词，不含 ASCII 标识符", () => {
    for (const [id, label] of Object.entries(PET_TOOL_LABELS)) {
      expect(label.trim(), id).not.toBe("");
      expect(/[A-Za-z][A-Za-z0-9_]{3,}/.test(label), `${id} 的值 ${label} 像内部标识`).toBe(false);
    }
  });

  it("登记过的说人话，没登记的绝不说 id", () => {
    expect(petToolLabel("read_file")).toBe("读取文件");
    expect(petToolLabel("run_shell")).toBe("运行命令");
    expect(petToolLabel("weather")).toBe("查天气");
    expect(petToolLabel("totally_unregistered_tool")).toBe(PET_TOOL_GENERIC_LABEL);
    expect(petToolLabel(undefined)).toBe(PET_TOOL_GENERIC_LABEL);
    expect(petToolLabel("")).toBe(PET_TOOL_GENERIC_LABEL);
  });

  it("原型链上的名字不许借到标签（constructor 不是工具，也不能是工具）", () => {
    expect(petToolLabel("constructor")).toBe(PET_TOOL_GENERIC_LABEL);
    expect(petToolLabel("toString")).toBe(PET_TOOL_GENERIC_LABEL);
    expect(petToolLabel("__proto__")).toBe(PET_TOOL_GENERIC_LABEL);
  });
});
```

`src/main/pet/work-status.test.ts`（Task 16 Step 1 的那一条，本任务改期望值而不是加新条）：

```ts
  it("工作中 的 detail 来自白名单，不是主进程捎带的 displayName", () => {
    const { svc } = makeService();
    svc.noteAguiEvent("RUN_STARTED", { runId: "r1" });
    // displayName 故意写一个注册表里不存在的词：detail 若等于它，说明有人把内部字段又读回来了
    svc.noteAguiEvent("TOOL_CALL_START", { runId: "r1", toolCallName: "read_file", toolCallDisplayName: "读文件" });
    expect(svc.current()?.detail).toBe("读取文件");
    svc.noteAguiEvent("TOOL_CALL_START", { runId: "r1", toolCallName: "totally_unregistered_tool", toolCallDisplayName: "[evil] drop_table" });
    expect(svc.current()?.detail).toBe("在忙");
  });
```

（把 Task 16 原来那条 `expect(svc.current()?.detail).toBe("读文件")` **替换**成上面这一整条 `it`，不要留着旧断言并列——旧断言的正确值恰好是 `displayLabelOf` 的读法，留着它等于给回退留一条绿色通道。）

`src/renderer/pet/work-status-presentation.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { WORK_STATUS_TIERS } from "../../shared/work-status-types";
import { applyBias, presentationOf, starPulse, STAR_PULSES, STAR_PULSE_MS } from "./work-status-presentation";
import { bodyClip, gestureClip } from "./motion";
import { faceOf, FACE_REST, type Expression } from "./face";

describe("六档演出表 (Task 18)", () => {
  it("六档全覆盖，presentationOf 对未知档位抛错而不是回一个默认", () => {
    for (const tier of WORK_STATUS_TIERS) expect(presentationOf(tier)).toBeTruthy();
    expect(() => presentationOf("已睡着" as never)).toThrow(/未知工作状态档/);
  });

  it("表里每个片名都真注册了：写错一个字要在装配前红，不留到运行期抛", () => {
    for (const tier of WORK_STATUS_TIERS) {
      const p = presentationOf(tier);
      if (p.body) expect(() => bodyClip(p.body!), `${tier}.body`).not.toThrow();
      if (p.edgeGesture) expect(() => gestureClip(p.edgeGesture!), `${tier}.edge`).not.toThrow();
      if (p.holdGesture) expect(() => gestureClip(p.holdGesture!), `${tier}.hold`).not.toThrow();
    }
  });

  it("spec §6 逐行对齐：档位 → 表情是写死的，不接受「以后再补」", () => {
    const want: Record<string, Expression> = {
      连接中: "worried", 思考中: "thinking", 工作中: "smug",
      提醒: "surprised", 已处理: "happy", 已中断: "sad",
    };
    for (const tier of WORK_STATUS_TIERS) {
      expect(presentationOf(tier).expression, tier).toBe(want[tier]);
    }
  });

  it("edge/hold 的形状：只有 提醒 同时有两者，只有 工作中 带 body 接管以外的 lasting", () => {
    expect(presentationOf("提醒").edgeGesture).toBe("wave");
    expect(presentationOf("提醒").holdGesture).toBe("peek");
    expect(presentationOf("工作中").holdGesture).toBe("typeCode");
    expect(presentationOf("工作中").body).toBe("sit");
    expect(presentationOf("连接中").body).toBe("stand");
    for (const tier of ["思考中", "已处理", "已中断"] as const) {
      expect(presentationOf(tier).holdGesture, tier).toBe(null);
    }
  });

  it("一次性 edge 片的时长够看清（1800..2400），与 Task 13 的同一条量级判据", () => {
    for (const tier of WORK_STATUS_TIERS) {
      const id = presentationOf(tier).edgeGesture;
      if (!id) continue;
      const ms = gestureClip(id).ms;
      expect(gestureClip(id).lasting, `${id} 是 edge，不许是 lasting`).toBe(false);
      expect(ms, `${id} 时长 ${ms}`).toBeGreaterThanOrEqual(1800);
      expect(ms, `${id} 时长 ${ms}`).toBeLessThanOrEqual(2400);
    }
  });

  it("偏置只在档位内有效：applyBias 不改动原对象、越界与 NaN 抛错", () => {
    const base = { lean: 0.1, hand: 0 };
    const out = applyBias(base, { lean: 0.06 });
    expect(out).toEqual({ lean: 0.16, hand: 0 });
    expect(base).toEqual({ lean: 0.1, hand: 0 });            // 不改原对象：一帧算完还要给 #73 复算
    expect(() => applyBias(base, { lean: Number.NaN })).toThrow(/不是有限数/);
    expect(() => applyBias(base, { lean: 9 })).toThrow(/不是有限数/);
  });

  it("星星三闪：纯函数、端点归零、超过三闪永久归零（口径差⑨）", () => {
    expect(starPulse(0, 0)).toBe(0);
    expect(starPulse(STAR_PULSE_MS / 2, 0)).toBeGreaterThan(0.5);
    expect(starPulse(STAR_PULSE_MS, 0)).toBeCloseTo(0, 6);
    expect(starPulse(STAR_PULSE_MS * STAR_PULSES + 1, 0)).toBe(0);
    expect(starPulse(-500, 0)).toBe(0);                      // 时钟倒退不许出负星
    const since = 10_000;
    expect(presentationOf("已处理").face({ tier: "已处理", source: "agent", since, runId: "r", detail: undefined }, since + 700).star)
      .toBeGreaterThan(0);
    expect(presentationOf("已处理").face({ tier: "已处理", source: "agent", since, runId: "r" }, since + 9_000).star)
      .toBe(0);
    // 星星不是 happy 差分表里的东西：改 happy 会连带摸摸/喂食一起闪星
    expect(FACE_REST.star).toBe(0);
    expect(faceOf("happy", { t: 0, blink: 0, mouse: null, energy: 1, speaking: false }).star).toBe(0);
  });

  it("已中断 的泪靠 face 差分给（shiver 只带 lean 后缩，sad 的 tear 只有 0.35）", () => {
    const f = presentationOf("已中断").face({ tier: "已中断", source: "agent", since: 0, runId: "r" }, 500);
    expect(f.tear).toBeGreaterThan(0.5);
    expect(gestureClip("shiver").rest?.lean).toBeLessThan(0);   // 后缩由片负责，表不重复给 lean
    expect(presentationOf("已中断").bias.lean ?? 0).toBe(0);
  });

  it("静帧纯：同一 status 同一 now 连调两次逐字段相等（R-D9）", () => {
    const s = { tier: "已处理" as const, source: "agent" as const, since: 1_000, runId: "r" };
    for (const tier of WORK_STATUS_TIERS) {
      const p = presentationOf(tier);
      expect(p.face(s, 2_345)).toEqual(p.face(s, 2_345));
      expect(p.bias).toEqual(presentationOf(tier).bias);
    }
  });
});
```

`src/renderer/pet/girl.test.ts` 追加（`faceBias` 的消费者，含正对照）：

```ts
  it("faceBias 能把星星画出来，不带给 neutral（口径差⑨的落地证据）", () => {
    const plain = buildGirlOps(girl({ expression: "neutral" }));
    const biased = buildGirlOps(girl({ expression: "neutral", faceBias: { star: 0.6 } }));
    const star = (ops: typeof plain) => ops.filter((o) => o.layer === "eyes" && "points" in o).length;
    expect(star(plain)).toBe(0);
    expect(star(biased)).toBeGreaterThan(0);
  });

  it("faceBias 不许改变图元数量之外的任何既有输出：四足路径与 cat/art.ts 一字不动", () => {
    const noBias = buildGirlOps(girl({ expression: "thinking" }));
    const withBias = buildGirlOps(girl({ expression: "thinking", faceBias: {} }));
    expect(JSON.stringify(withBias)).toBe(JSON.stringify(noBias));   // 空差分＝完全同形
  });
```

`src/renderer/pet/companion.test.ts` 追加：

```ts
  it("noteWorkStatus：工作中 说工具名，其余档说句池，安静期一声不响", () => {
    const engine = makeEngine({ now: () => T0 });
    expect(engine.noteWorkStatus({ tier: "工作中", source: "agent", since: T0, detail: "读取文件" })).toBe(true);
    expect(engine.getSnapshot().bubble?.text).toBe("读取文件…");
    expect(engine.noteWorkStatus({ tier: "已处理", source: "agent", since: T0 })).toBe(false); // 6s 内同优先级被吞
    const e2 = makeEngine({ now: () => T0 });
    e2.setQuiet(true, T0);
    expect(e2.noteWorkStatus({ tier: "提醒", source: "ask", since: T0, detail: "要不要覆盖" })).toBe(false);
    expect(e2.getSnapshot().bubble).toBe(null);                     // spec §13「安静期只画记号不气泡」
  });

  it("六档句池齐，且没有一句露 ASCII 标识符", () => {
    for (const tier of WORK_STATUS_TIERS) {
      const lines = WORK_STATUS_LINES[tier];
      expect(lines.length, tier).toBeGreaterThanOrEqual(2);         // 一句池＝随机没意义
      for (const line of lines) expect(/[A-Za-z][A-Za-z0-9_]{3,}/.test(line), `${tier}: ${line}`).toBe(false);
    }
  });
```

`src/renderer/pet/renderer.test.ts` 追加（级联、edge 只放一次、hold 复装、点气泡、诊断列）。

harness 只借文件里**模块作用域**就有的两件套：`makeCanvas()` 与 `makeLoopDriver()`（`renderer.test.ts:18`、`:45`）。Task 12 段里的 `makeVergeStub()`（`:227`）与 `advance()`（`:248`）都写在它自己的 `describe` 里面，**跨不出去**；Task 14/17 两段各自又各有一份——本任务照这个既成事实再带一份自己的，理由写在下面的注释里。为什么不在本任务顺手抽公共层：那要动文件里既有 14 条（基座 7 ＋ Task 12 的 tuck 7）的取样口径，而本期对四足的硬约束是「一字不变」（R-D2），把重构塞进一个功能任务里是最容易漏红因的做法（这条记进 Step 7 的台账）。

```ts
describe("PixelPetRenderer 工作状态演出 (Task 18)", () => {
  const wa = { x: 0, y: 0, width: 1920, height: 1040 };
  const base = { x: 900, y: 400, width: 82, height: 108 };

  type PoseView = {
    channels: Record<string, number>;
    expression?: string;
  };
  type RendererView = {
    cat: PoseView;
    slots: Partial<Record<"body" | "gesture", { clip: { id: string; priority: number } }>>;
    explicitGesture: { clip: { id: string }; startedAt: number } | null;
  };

  /**
   * 每帧 250ms（4fps 档全过闸），与 Task 12 段 `:248` 那个 advance 同一口径。
   * `setWorkStatus` 里已经补画一帧，但通道值要经 `tickCompanion` 那一次 snapshot 才算数——
   * 所以每条用例都显式走帧，不靠补画的副作用（那是「实现碰巧画了一次」的红，不是判据）。
   */
  function frame(loop: { fire(now: number): void }, clock: { ms: number }, count: number): void {
    for (let i = 0; i < count; i += 1) {
      clock.ms += 250;
      loop.fire(clock.ms);
    }
  }

  /**
   * RNG 钉在 0.999：四足表的最后一档是 idle（权重 14，累计到 100），钉在这里就永远抽不出
   * 会搅断言的自主动作；挂钟给**本地**正午（写 `Date.UTC(…, 13, …)` 在 +08:00 落到本地 21 点，
   * 到 +09:00 就是夜里——「夜里 sleep 权重放大、idle 归零」会整条改掉抽取结果）。
   * 本任务测的是 workStatus 的演出，不是抽取，所以两头都要钉死。
   */
  async function makeGirl() {
    const clock = { ms: 10_000 };
    const loop = makeLoopDriver();
    const verge = {
      resizePetWindow: vi.fn(), tuckHinted: vi.fn(), settlePetPosition: vi.fn(),
      revealAskWorkStatus: vi.fn(),          // 本任务新加的那颗；少了它「点气泡」那条读 undefined 就炸
    };
    (window as unknown as { verge: unknown }).verge = verge;
    vi.spyOn(performance, "now").mockImplementation(() => clock.ms);
    vi.spyOn(console, "log").mockImplementation(() => {});
    window.localStorage.clear();            // 引擎的 vitals 存在这里：不清就是「上一条用例剩下的精力」
    const r = new PixelPetRenderer({
      canvas: makeCanvas(), width: 82, height: 108, onLoad: vi.fn(), onError: vi.fn(), companion: true,
      companionOverrides: { random: () => 0.999, wallNow: () => new Date(2026, 9, 24, 13, 0, 0).getTime() },
    });
    await r.init();
    r.syncGeometry({ bounds: base, workArea: wa, tuckEnabled: false, tuckHinted: true, tuckLimit: 6 });
    verge.resizePetWindow.mockClear();
    return { r, loop, clock, verge, view: r as unknown as RendererView };
  }

  afterEach(() => {
    delete (window as unknown as { verge?: unknown }).verge;
  });

  it("档位级联：presentation.expression 压过 clip.face，clip.face 压过 mood", async () => {
    const { r, loop, clock, view } = await makeGirl();
    r.setForm("girl");
    r.setWorkStatus({ tier: "连接中", source: "controller", since: clock.ms });
    frame(loop, clock, 4);
    expect(view.cat.expression).toBe("worried");          // presentation 给的脸
    r.setWorkStatus(null);
    frame(loop, clock, 5);
    expect(view.cat.expression).toBe("neutral");          // 回落 MOOD_TO_EXPRESSION.idle
    r.dispose();
  });

  it("edge 只在档位跃迁放一次：同档换 detail 不许重行礼", async () => {
    const { r, loop, clock, view } = await makeGirl();
    r.setForm("girl");
    r.setWorkStatus({ tier: "已处理", source: "agent", since: clock.ms });
    expect(view.explicitGesture?.clip.id, "已处理 的 edge 是 bow").toBe("bow");
    const greeted = view.explicitGesture;
    r.setWorkStatus({ tier: "已处理", source: "agent", since: clock.ms, detail: "读取文件" });
    expect(view.explicitGesture, "同档换 detail＝重行礼：重新 playGesture 会把 startedAt 推后，鞠躬永远做不完").toBe(greeted);
    r.setWorkStatus({ tier: "工作中", source: "agent", since: clock.ms + 200, detail: "运行命令" });
    frame(loop, clock, 4);
    expect(view.explicitGesture!.clip.id).toBe("typeCode");       // 换档：hold 的 lasting 打字片顶上
    expect(view.cat.expression).toBe("smug");
    r.dispose();
  });

  it("提醒：wave 放完才装 peek（一帧一层，lasting 不能把一次性挤掉）", async () => {
    const { r, loop, clock, view } = await makeGirl();
    r.setForm("girl");
    r.setWorkStatus({ tier: "提醒", source: "ask", since: clock.ms, detail: "要不要覆盖已有文件" });
    expect(view.explicitGesture!.clip.id).toBe("wave");
    frame(loop, clock, 12);                              // 3s > wave 的 2000ms：一次性片到尾
    expect(view.explicitGesture!.clip.id).toBe("peek");  // hold 由 tickSlots 的复装分支补上
    r.dispose();
  });

  it("body 接管：工作中 站→坐，离开档位立刻回 activity 映射", async () => {
    const { r, loop, clock, view } = await makeGirl();
    r.setForm("girl");
    r.setWorkStatus({ tier: "工作中", source: "agent", since: clock.ms, detail: "读取文件" });
    frame(loop, clock, 4);
    expect(view.slots.body?.clip.id).toBe("sit");
    r.setWorkStatus(null);
    frame(loop, clock, 5);
    expect(view.slots.body?.clip.id).toBe("stand");
    expect(view.cat.channels.squash ?? 0).toBeGreaterThanOrEqual(0);   // 通道还在，只是换了片
    r.dispose();
  });

  it("偏置随档位生灭：连接中 有 lean，回待机必须归零（#73 的同类判据）", async () => {
    const { r, loop, clock, view } = await makeGirl();
    r.setForm("girl");
    r.setWorkStatus({ tier: "连接中", source: "controller", since: clock.ms });
    frame(loop, clock, 4);
    expect(view.cat.channels.lean ?? 0).toBeGreaterThan(0.05);
    r.setWorkStatus(null);
    frame(loop, clock, 5);
    expect(view.cat.channels.lean ?? 0).toBeLessThan(1e-9);
    r.dispose();
  });

  it("点气泡：提醒 档先递一句话给主端再收口，其余档只收口", async () => {
    const { r, verge } = await makeGirl();
    r.setForm("girl");
    r.setWorkStatus({ tier: "工作中", source: "agent", since: 10_000, detail: "读取文件" });
    r.handleBubbleClick();
    expect(verge.revealAskWorkStatus).not.toHaveBeenCalled();
    r.setWorkStatus({ tier: "提醒", source: "ask", since: 10_000, detail: "要不要覆盖已有文件" });
    r.handleBubbleClick();
    expect(verge.revealAskWorkStatus).toHaveBeenCalledTimes(1);
    r.dispose();
  });

  it("四足形态不吃演出：cat 形下 setWorkStatus 不改通道、不改表情", async () => {
    const { r, loop, clock, view } = await makeGirl();          // 默认 form = cat
    r.setWorkStatus({ tier: "工作中", source: "agent", since: clock.ms, detail: "读取文件" });
    frame(loop, clock, 4);
    expect(Object.keys(view.cat.channels)).toHaveLength(0);
    expect(view.cat.expression).toBeUndefined();
    expect(view.slots.body).toBeUndefined();                    // 四足路径根本不进四层槽
    r.dispose();
  });

  it("getPetDiagnostics 把演出读数露全（#74 唯一能自动判「画面真的换了」的口子）", async () => {
    const { r } = await makeGirl();
    r.setForm("girl");
    r.setWorkStatus({ tier: "提醒", source: "ask", since: 9, detail: "要不要覆盖已有文件" });
    const d = r.getPetDiagnostics();
    expect(d.form).toBe("girl");
    expect(d.workStatus).toEqual({ tier: "提醒", source: "ask", since: 9, detail: "要不要覆盖已有文件" });
    expect(typeof d.expression).toBe("string");
    expect("bubbleText" in d).toBe(true);
    r.dispose();
  });
});
```

两条前置核对，不对就先改这里而不是改断言：① `companionOverrides` 是 Task 14 开在构造选项上的口子（`{ random?: () => number; wallNow?: () => number }`），本文件把它钉死是有前提的——四足那张表在本地正午、精力 0.8 时 0.999 落 `idle` 档（`IDLE_ACTIVITIES` 累计 `:100-108`）；② `handleBubbleClick()` 与 `getPetDiagnostics()` 都是**公开口**（前者由 `main.ts` 的气泡点击路径调，后者是尺 #74 的读数口），不需要 cast；`slots`/`explicitGesture`/`cat` 是私有观测量，走 `view` 那一次 cast。

`src/renderer/pet/pet-status-ipc-wiring.test.ts` 追加两条（第五道通道 + 探针闸门）：

```ts
  it("第五道通道：pet-reveal-ask 有 handle、有白名单、无外发；preload 与 d.ts 都在", () => {
    expect(channels).toMatch(/VERGE_PET_REVEAL_ASK:\s*"verge:pet-reveal-ask"/);
    expect(policy).toMatch(/\[IPC\.VERGE_PET_REVEAL_ASK\]:\s*\["pet"\]/);
    expect(preload).toMatch(/revealAskWorkStatus:\s*\(\)\s*=>\s*ipcRenderer\.invoke\(IPC\.VERGE_PET_REVEAL_ASK\)/);
    expect(fs.readFileSync("src/renderer/types/cyrene.d.ts", "utf8")).toContain("revealAskWorkStatus");
  });

  it("探针只认环境变量，且走的是生产 service 与生产 activation 那一条", () => {
    const probe = fs.readFileSync("src/main/pet/work-status-probe.ts", "utf8");
    expect(deps).toMatch(/VERGE_WORK_STATUS_PROBE\s*===\s*"p3"[\s\S]{0,220}startWorkStatusProbe\(\s*workStatus/);
    expect(deps).toMatch(/openAskTarget:\s*\(\)\s*=>\s*activation\.request\(\{\s*kind:\s*"chat"\s*\}\)/);
    expect(probe).not.toMatch(/console\.(log|info|warn|error)/);   // secret/工具内部名不许被探针打印出来
  });
```

- [ ] **Step 2: 跑红**

```bash
CI=true npx vitest run src/shared/pet-tool-labels.test.ts src/main/pet/work-status.test.ts src/renderer/pet/work-status-presentation.test.ts src/renderer/pet/girl.test.ts src/renderer/pet/companion.test.ts src/renderer/pet/renderer.test.ts src/renderer/pet/pet-status-ipc-wiring.test.ts
```

Expected: `pet-tool-labels.test.ts` / `work-status-presentation.test.ts` 报 `Cannot find module`；`work-status.test.ts` 新那条红在 `expected 读文件 to be 读取文件`（这正是 `displayLabelOf` 的现场证据，不是尺子坏）；`girl.test.ts` 的两条红在 `points` 命中数 0（`faceBias` 没人读）；`companion.test.ts` 红在 `engine.noteWorkStatus is not a function`；`renderer.test.ts` 红在 `r.handleBubbleClick is not a function` 与级联那两条的 `expected neutral to be worried`；`pet-status-ipc-wiring.test.ts` 红在第一个新 `it` 的通道断言。
**`renderer.test.ts` 里「四足形态不吃演出」这一条此时应当已经是绿的**——它是回归锁不是新功能锁，绿的含义是「Task 14 的分派本来就只走 girl」；不要把一条本该绿的回归锁写成「预期红」来凑数（`project-false-green-locks`）。

- [ ] **Step 3: 实现**

**(a) `src/shared/pet-tool-labels.ts`**

```ts
/**
 * 猫嘴里的工具名白名单：key 是工具 **id**，value 是给用户看的词。
 *
 * 只认 id、不认 displayName——三条实测理由：
 *   1) registry 系工具给了中文名（fs-tools.ts:155 / apply-patch-tools.ts:473 / web-search-tool.ts:405）；
 *   2) harness 内建工具的 name 就是英文 id（builtin-tools.ts:36/61/128/318、plan-tools.ts:36/61/78）；
 *   3) MCP 工具注册进同一个 toolRegistry（orchestrator/mcp-adapter.ts），name 是第三方字符串，
 *      而 ToolDefinition（tools/registry/tool-registry.ts:68-127）没有任何 origin 字段可判。
 * 措辞尽量与聊天页同源（zh-CN.json 的 agentRounds.live*），两处说同一件事就该是同一批词。
 */
export const PET_TOOL_GENERIC_LABEL = "在忙";

export const PET_TOOL_LABELS: Readonly<Record<string, string>> = Object.freeze({
  // —— 注册表中文名（逐条抄自 grep，改名字会被 pet-tool-labels.test.ts 的声明锁当场拦下）——
  read_file: "读取文件",        // fs-tools.ts:154-155
  list_dir: "列出目录",         // fs-tools.ts:267-268
  write_file: "写入文件",       // fs-tools.ts:490-491
  search_text: "文本搜索",      // search-text-tools.ts:379-380
  apply_patch: "编辑文件",      // apply-patch-tools.ts:472-473
  run_shell: "运行命令",        // run-shell-tool.ts:643-646（词照 zh-CN.json:263 liveRunShell）
  fetch_url: "读取网页",        // fetch-url-tool.ts:165-166
  web_search: "联网搜索",       // web-search-tool.ts:404-405
  weather: "查天气",            // weather-tool.ts:324-325
  pop_quiz: "突击抽查",         // pop-quiz.ts:491-495
  ask_user: "询问用户",         // builtin-tools.ts:315（name===id，词照 zh-CN.json:290 toolAskUser）
  // —— 以下三条 harness 内建工具没有中文名（name 就是 id），i18n 里也没有对应词条：词是本表自拟的 ——
  update_todo: "整理待办",      // builtin-tools.ts:28/128
  task: "派子任务",             // builtin-tools.ts:29/36
  close_task: "收尾任务",       // builtin-tools.ts:30/61
});

/** 未登记＝不知道该怎么念，宁可说「在忙」也不念内部标识（spec §13 给猫的铁律）。 */
export function petToolLabel(toolCallName: string | undefined): string {
  if (typeof toolCallName !== "string" || toolCallName === "") return PET_TOOL_GENERIC_LABEL;
  // 走 hasOwnProperty：直接索引会让 "constructor"/"toString" 这类原型名借到一个函数值。
  if (!Object.prototype.hasOwnProperty.call(PET_TOOL_LABELS, toolCallName)) return PET_TOOL_GENERIC_LABEL;
  return PET_TOOL_LABELS[toolCallName];
}
```

**(b) `src/main/pet/work-status.ts`：整段删掉 `displayLabelOf`，换成读 id 的一行**

```ts
    case "TOOL_CALL_START":
      // detail 只从白名单来（Task 18）：主进程捎带的 displayName 可能是英文 id，也可能是 MCP 的第三方字符串。
      setAgent("工作中", runId, petToolLabel(currentToolNameOf(event)));
      return;
```

```ts
  function currentToolNameOf(event: unknown): string | undefined {
    const name = (event as { toolCallName?: unknown })?.toolCallName;
    return typeof name === "string" ? name : undefined;
  }
```

（`import { petToolLabel } from "../../shared/pet-tool-labels";`。删干净 `displayLabelOf`——留着它但没人调，就是给下一个「顺手改回 displayName」的人备好的台阶。）

**(c) `src/renderer/pet/work-status-presentation.ts`**

```ts
import { WORK_STATUS_TIERS, type WorkStatus, type WorkStatusTier } from "../../shared/work-status-types";
import { FACE_REST, type Expression, type FaceParams } from "./face";
import type { Channel, Channels } from "./motion";

/** 星星一瞬的节拍：三闪 × 1.4s＝4.2s，刚好站在 SETTLED_MS(5s) 里（Task 16），不会闪成永动。 */
export const STAR_PULSE_MS = 1_400;
export const STAR_PULSES = 3;

/**
 * 一档一行，spec §6 的六行照搬成数据。
 * 没有 faceBias 之外的自由发挥：脸、片、偏置三件事各归各的字段，读的人不必翻实现。
 */
export interface TierPresentation {
  /** body 层接管（null＝跟着 activity 走）。只有 连接中/工作中 有值，其余档站着做手势就够。 */
  readonly body: string | null;
  /** 进档那一次放的手势（一次性片；同档换 detail 不重放）。 */
  readonly edgeGesture: string | null;
  /** 这一档占住 gesture 层的 lasting 片（槽位被物理档打掉后由 renderer 复装）。 */
  readonly holdGesture: string | null;
  /** 档位期间压住 clip.face 的脸；null 只在不该出现的工作状态里由级联回落。 */
  readonly expression: Expression;
  /** 通道偏置：档位期间一直加在混合结果上，离开档位即归零。 */
  readonly bias: Partial<Channels>;
  /** face 差分：只补差分表里没有的东西（happy 没有 star，sad 的 tear 只有 0.35）。必须是 (status, now) 的纯函数（R-D9）。 */
  readonly face: (status: WorkStatus, now: number) => Partial<FaceParams>;
}

const noFace = (): Partial<FaceParams> => ({});

/** 三闪包络：峰在每格中点、端点与三闪之后恒 0；`since` 由档位自己带，不经任何运行期状态。 */
export function starPulse(now: number, since: number): number {
  const delta = now - since;
  if (!Number.isFinite(delta) || delta < 0) return 0;
  const k = Math.floor(delta / STAR_PULSE_MS);
  if (k >= STAR_PULSES) return 0;
  return Math.sin(Math.PI * ((delta - k * STAR_PULSE_MS) / STAR_PULSE_MS)) * 0.6;   // 与 excited 的 star 同峰
}

export const PRESENTATIONS: Record<WorkStatusTier, TierPresentation> = {
  连接中: { body: "stand", edgeGesture: null, holdGesture: null, expression: "worried",
    bias: { lean: 0.06 }, face: noFace },                       // 汗滴来自 worried 差分表（sweat: 1）
  思考中: { body: null, edgeGesture: "tilt", holdGesture: null, expression: "thinking",
    bias: { headPitch: 0.12, hand: 0.35 }, face: noFace },       // 点颊是常驻手腕转角：tilt 是一次性片，撑不住整档
  工作中: { body: "sit", edgeGesture: null, holdGesture: "typeCode", expression: "smug",
    bias: {}, face: noFace },                                   // 节奏性 headBob 来自 typeCode 自己的轨道
  提醒: { body: null, edgeGesture: "wave", holdGesture: "peek", expression: "surprised",
    bias: {}, face: noFace },
  已处理: { body: null, edgeGesture: "bow", holdGesture: null, expression: "happy",
    bias: {}, face: (s, now) => ({ star: starPulse(now, s.since) }) },
  已中断: { body: null, edgeGesture: "shiver", holdGesture: null, expression: "sad",
    bias: {}, face: () => ({ tear: 0.8 }) },                    // 后缩由 shiver 的 lean(-0.05) 负责，表不重复给
};

export function presentationOf(tier: WorkStatusTier): TierPresentation {
  if (!Object.prototype.hasOwnProperty.call(PRESENTATIONS, tier)) {
    throw new Error(`未知工作状态档：${String(tier)}`);
  }
  return PRESENTATIONS[tier];
}

/**
 * 档位偏置叠加。抛错而不是 clamp：偏置是写死在表里的常数，出现 NaN／越界就是表写错了，
 * 静默折回会把一张写错的表画成「看起来还行」的画面（与 girl.ts 的 ch() 同一口径）。
 */
export function applyBias(mixed: Channels, bias: Partial<Channels>): Channels {
  const out: Channels = { ...mixed };
  for (const [name, value] of Object.entries(bias) as Array<[Channel, number]>) {
    if (!Number.isFinite(value)) throw new Error(`演出偏置 ${name} 不是有限数：${String(value)}`);
    out[name] = (out[name] ?? 0) + value;
  }
  return out;
}

/** 供尺 #74 与单测复核：表必须与 shared 的档位集合一一对应，多一档少一档都算红。 */
export const PRESENTED_TIERS = WORK_STATUS_TIERS;
export type { WorkStatus };
```

**(d) `PetInput.faceBias` 与 `girl.ts` 的消费**

`form.ts` 的 `PetInput`（Task 14 已扩到四条可选轴）再追加一条，注释口径同上：

```ts
  /** 档位期内的脸差分：只叠不替（`{...faceOf(expr), ...bias}`），空对象必须与不传完全同形。 */
  faceBias?: Partial<FaceParams>;
```

`girl.ts` 里 Task 10 换上的那一行改成：

```ts
      ...buildFaceOps(
        { ...faceOf(expr, ctx), ...(input.faceBias ?? {}) },
        toMap2(rig.head), s, coat, u,
      ),
```

`cat` 形与 `art.ts` 的七个 op 段**一行都不读 `faceBias`**——四足逐像素不变那条铁律在本任务的唯一新增暴露面就是这条字段，所以本任务的锁测试有两头：`girl.test.ts` 证「给了会画」，`pet-token-ledger` 那把既有的形状/派生锁证「四足没动」（Step 4 的门里 `check:sprites` + `palette:check` 就是它的执行处）。

**(e) `companion.ts`：六档句池与一张嘴**

```ts
/**
 * workStatus 的一句猫话（Task 18）。工作中 不在这里：那一句由 detail 现拼，是「在做什么」不是「在干嘛」。
 * 每档两句以上是底线——只有一句时，「随机」是装饰，用户三次里听到三次同一个词。
 */
export const WORK_STATUS_LINES: Record<WorkStatusTier, string[]> = {
  连接中: ["在找路…", "信号还没接上", "等一下，我在连"],
  思考中: ["让我想想…", "嗯…这句怎么说", "脑子里在转"],
  工作中: [],                                                  // 由 noteWorkStatus 走 detail，不经句池
  提醒: ["要你拍板", "有个选择等你", "抬眼看我一下"],
  已处理: ["搞定啦", "这一轮完了", "交给你看"],
  已中断: ["停下了", "那我先收手", "打断就打断吧"],
};
```

```ts
  /**
   * workStatus 的一句话（Task 18 的嘴，渲染端在档位跃迁时调）。
   * priority 2 是刻意的：压过随机唠嗑（1，companion.ts:542），低于断网/到期那类硬回执（3）。
   * 而 say() 里 `priority <= this.bubble.priority` 那道闸（:459）会自然把 6 秒内的同档重复播报咽下去——
   * 工作中每换一个工具就插一句，那是弹幕不是猫。安静期 say() 第一行就 return false，
   * 「提醒只画记号不气泡」（spec §13）在这一层白捡，不需要任何新判据。
   */
  noteWorkStatus(status: WorkStatus | null, now = this.now()): boolean {
    if (!status) return false;
    if (status.tier === "工作中") return this.say(`${status.detail ?? PET_TOOL_GENERIC_LABEL}…`, 2, now);
    const lines = WORK_STATUS_LINES[status.tier];
    if (lines.length === 0) return false;
    return this.say(this.pickLine(lines), 2, now);
  }
```

（`import { PET_TOOL_GENERIC_LABEL } from "../../shared/pet-tool-labels";`、`import { WORK_STATUS_TIERS, type WorkStatus, type WorkStatusTier } from "../../shared/work-status-types";`。`工作中: []` 这条空数组不是偷懒——`noteWorkStatus` 里 `lines.length === 0` 那行为它兜底，是为了让「六档都有 key」由编译器保证而不是靠 `?? `。上面那条「六档句池齐」的测试因此对 工作中 特判：见 Step 1，`WORK_STATUS_LINES["工作中"]` 是唯一的例外——实现时把那条测试改成 `for (const tier of WORK_STATUS_TIERS.filter((t) => t !== "工作中"))`，并在测试里留一行注释说明 工作中 走 detail。**这不是把断言调软**：工作中 的句子在 `noteWorkStatus` 那条测试里已经逐字断言过 `"读取文件…"`。）

**(f) `renderer.ts`：档位跃迁 → 演出**

新增状态与一个入口，全部收在 `setWorkStatus` 附近：

```ts
  /** 上一档：edge 手势只在跃迁时放一次（同档换 detail 不许重行礼）。 */
  private presentedTier: WorkStatusTier | null = null;
  /** 本档要求占住 gesture 层的 lasting 片；槽位空了就补上（被物理档打掉也补）。 */
  private holdWanted: string | null = null;
  /** 档位期内的脸差分（星星/泪）：每帧由 presentation.face(status, now) 现算，不落状态。 */
  private workFace: Partial<FaceParams> = {};
  private bodyOverride: string | null = null;

  /** workStatus 的 body 层接管。语义与 explicitGesture 一致：查不到片名当场抛，不把错名字咽下去。 */
  setBodyClip(id: string | null): void {
    if (id === this.bodyOverride) return;
    this.bodyOverride = id === null ? null : bodyClip(id).id;
  }

  /**
   * 档位 → 演出的唯一映射点（Task 18）。四足形不吃这套：draw() 的分派本来就只有 girl 走
   * applyLayerPose，这里再显式 return 一次，是为了让「cat 形逐像素不变」在源码里可读而不必读分派表。
   */
  private syncWorkStatus(now: number): void {
    if (this.form !== "girl") return;
    const tier = this.workStatus?.tier ?? null;
    if (tier === this.presentedTier) return;
    this.presentedTier = tier;
    const p = tier === null ? null : presentationOf(tier);
    this.bodyOverride = p?.body ? bodyClip(p.body).id : null;
    this.holdWanted = p?.holdGesture ?? null;
    this.workFace = p && this.workStatus ? p.face(this.workStatus, now) : {};
    // 跃迁即重排手势层：先拆旧的，再装新的；edge 优先（一帧一层，两者都有时 hold 等 edge 放完）。
    this.stopGesture();
    if (p?.edgeGesture) this.playGesture(p.edgeGesture, now);
    else if (p?.holdGesture) this.playGesture(p.holdGesture, now);
    if (p && this.workStatus) this.engine?.noteWorkStatus(this.workStatus, now);
  }
```

`setWorkStatus` 的「本期只落读数」那行注释与实现一起换掉（Task 17 留的接线口在此收口）：

```ts
  setWorkStatus(status: WorkStatus | null, origin: "push" | "boot" = "push"): void {
    if (origin === "boot" && this.workStatusPushed) return;
    if (origin === "push") this.workStatusPushed = true;
    this.workStatus = status;
    const now = performance.now();
    this.syncWorkStatus(now);
    if (!this.paused) this.draw(now);
  }
```

`tickSlots` 里把 body 层的「想要哪片」换成一条 override 优先：

```ts
    const body = this.slotFor("body", this.bodyOverride ?? ACTIVITY_BODY[snapshot.activity], now, snapshot);
```

`applyLayerPose` 三处改（其余保持 Task 14 原文）：

```ts
    const slots = this.tickSlots(performance.now(), snapshot);
    // 物理档（priority 3）在跑时不抢手势层：drag/thrown 期间两只手得跟着身子一起甩。
    if (this.holdWanted && !this.explicitGesture && slots.body?.clip.priority !== 3) {
      this.playGesture(this.holdWanted, performance.now());
    }
    const mixed = mixPose(this.tickSlotsAgain(snapshot));      // 见下：复装之后重算一次，别拿旧 mixed
```

**这一段的写法有坑，按下面的形式落地而不是照抄上面两行**：`mixed` 必须来自「已经复装好这一帧要用的手势」的那次 `tickSlots`，所以复装判据要放进 `tickSlots` 内部（`out.body` 已算出、`out.gesture` 尚未算出的那个位置），而不是在 `applyLayerPose` 里再调一次。把 `tickSlots` 改成形如：

```ts
  private tickSlots(now: number, snapshot: CompanionSnapshot): Slots {
    const out: Slots = {};
    const body = this.slotFor("body", this.bodyOverride ?? ACTIVITY_BODY[snapshot.activity], now, snapshot);
    if (body) out.body = body;
    const physics = out.body && out.body.clip.priority === 3;
    if (physics) {
      this.explicitGesture = null;
      delete this.slots.gesture;
    } else {
      // lasting 手势被打断/放完之后由这里复装：一次 tick 内决定，不留第二帧的空窗，
      // 也不在 applyLayerPose 里重算一次（那会让 mixed 与槽位对不上号）。
      if (this.holdWanted && !this.explicitGesture) this.playGesture(this.holdWanted, now);
      const gesture = this.gestureSlotFor(now, snapshot);
      if (gesture) out.gesture = gesture;
    }
    this.gestureProgress = out.gesture ? out.gesture.p : null;
    return out;                 // face 层的槽位本期恒空：表情走 Expression 差分表，不走通道
  }
```

于是 `applyLayerPose` 里只有级联与偏置两处：

```ts
    const slots = this.tickSlots(performance.now(), snapshot);
    const pres = this.presentedTier ? presentationOf(this.presentedTier) : null;
    const mixed = applyBias(mixPose(slots), pres?.bias ?? {});
    this.cat.mood = snapshot.mood;
    this.cat.facing = snapshot.facing;
    this.cat.energy = snapshot.vitals.energy;
    // 表情级联（Task 14 就许诺的那一条）：档位压片、片压心情。
    this.cat.expression = pres?.expression ?? slots.gesture?.clip.face ?? MOOD_TO_EXPRESSION[snapshot.mood];
    this.cat.faceBias = this.workFace;
    // faceBias 只在档位期内更新：`since` 是主端给的档位起点，星星的三闪钟从那一刻走（口径差⑨）。
    if (pres && this.workStatus) this.workFace = pres.face(performance.now(), this.workStatus.since);
    this.cat.speaking = this.bubbleExpand > 0 && this.bubbleText !== "";
    this.cat.channels = { ...mixed, squash: Math.max(0, Math.min(1, (mixed.squash ?? 0) + snapshot.squash)) };
    …（Task 14 原文其余行不动）
```

（`this.cat.faceBias = this.workFace` 那两行的先后顺序按现场写成「先更新 workFace 再赋值」也可，但**不许**把 `performance.now()` 在同一帧里取两次以上——`applyLayerPose` 头上已经取过一次，把它提成一个 `const now = performance.now()` 复用，否则星星的相位在同一帧里出现两个值，R-D9 的「同输入同输出」在帧内就不成立了。测试侧由「静帧纯」那条兜住。）

`setForm` 里补一句 `this.presentedTier = null; this.holdWanted = null; this.workFace = {}; this.bodyOverride = null;`——换形是口径整体切换，Task 14 已经在清 `slots` 与 `explicitGesture`，这几条跟着一起清，否则 `girl → cat → girl` 会把上一轮的 lasting 手势状态带回来。

`handleBubbleClick` 与 `getPetDiagnostics`：

```ts
  /**
   * 点气泡（Task 18 的深链，口径差⑩）：提醒 档那一句就是入口，猫只负责说「要去看」，
   * 去哪儿由主端决定——渲染端既不知道哪张卡还开着，也不该知道。
   * 非提醒档保持原语义：点气泡＝让它闭嘴。
   */
  handleBubbleClick(): void {
    if (this.workStatus?.tier === "提醒") window.verge?.revealAskWorkStatus?.();
    this.dismissBubble();
  }

  /** #74/#71 从 CDP 读的就是这里：状态在哪就读在哪（Task 17 的搬迁理由，本期继续往里加列）。 */
  getPetDiagnostics(): Record<string, unknown> {
    return {
      paused: this.paused,
      profile: profileRefOf(this.profile.form, this.profile.tier),
      workStatus: this.workStatus,
      form: this.form,
      expression: this.cat.expression ?? null,
      bubbleText: this.bubbleText,
    };
  }
```

`src/renderer/main.ts` 的气泡分支改成一行调用（`:415-420` 那段注释里「先让它闭嘴」的措辞要跟着改成「提醒档那是入口，别当噪声」——界面上写出来的行为就是承诺）：

```ts
  if (renderer.isPointOnBubble(event.clientX - rect.left, event.clientY - rect.top)) {
    renderer.handleBubbleClick();
    return;
  }
```

**(g) 第五道通道：pet-reveal-ask**

`src/shared/ipc-channels.ts`（`VERGE` 段尾巴，紧跟 Task 17 那四条）：

```ts
  /** 猫气泡被点且当前是 提醒 档：请求把「该看的那页」拿到用户眼前。**无载荷**，目的地由主端决定。 */
  VERGE_PET_REVEAL_ASK: "verge:pet-reveal-ask",
```

`src/main/pet/work-status-ipc.ts`（Task 17 的 `registerWorkStatusIpc` 内追加第三条 handle 与对应的 remove）：

```ts
  const removeReveal = ipc.handle(IPC.VERGE_PET_REVEAL_ASK, { allow: ["pet"] }, () => {
    deps.openAskTarget();
    return true;
  });
```

（deps 类型加 `openAskTarget: () => void`。这里**不**用 `ipc.handle(IPC.CHATS_OPEN_IN_REACTIVE_WINDOW …)`：`chat-ui-ipc.ts:296-300` 那条要求一个非空 `sessionId`，而 `ChoiceCardEvent`（`toast/toast-events.ts:22-45`）根本没有会话字段——「点气泡」这件事在猫这一侧只有「有人该去看那张卡」这一个信息，硬凑 session id 就是编数据。）

`src/main/application/ipc-sender-policy.ts`：`[IPC.VERGE_PET_REVEAL_ASK]: ["pet"],`。

`src/main/application/default-dependencies.ts`（Task 17 的 `registerWorkStatusIpc(ipc, {` 那一段里加一项，位置就在 `sendToPetWindow` 旁边）：

```ts
          // 与 toast-service.ts:268-272 那条「点 toast 去看」同一条通路：同一个 broker、同一个 kind。
          // 走 broker 而不是直接 windowManager.openReactChatWindow()，白送 window-activation.ts:49-58 的
          // 「未就绪先入队、失败静默」——猫的气泡可能在启动期就被点。
          openAskTarget: () => { activation.request({ kind: "chat" }); },
```

`src/preload/index.ts`（Task 17 那四个入口之后）：

```ts
  /** 提醒档点气泡：只报告「用户要去看」，不报告去哪（目的地是主进程的权威状态）。 */
  revealAskWorkStatus: () => ipcRenderer.invoke(IPC.VERGE_PET_REVEAL_ASK) as Promise<boolean>,
```

`src/renderer/types/cyrene.d.ts` 补同名一行（`revealAskWorkStatus(): Promise<boolean>;`）。这条通道是 **invoke 方向**，`ipc-contract` 的正向对账要求主进程有 handle（上面已注册），它没有外发方向，所以 preload 不需要 `on`——Step 4 跑 `ipc-contract.test.ts` 时若它红在这条，是 handle 没注册成 `ipc.handle` 而写成 `ipc.on`。

**(h) `src/main/pet/work-status-probe.ts`：把六档按顺序自己走一遍（Step 5 详述用法）**

```ts
import { WORK_STATUS_TIERS, type WorkStatusService } from "./work-status";
import type { NetworkUpdate } from "../../shared/network-types";

/** 与 Task 16 的测试夹具逐字同形：探针不许自造第三种快照形状。 */
const RUNNING = { kind: "snapshot", snapshot: { controller: { available: true, baseUrl: "http://127.0.0.1:9090", reason: null, version: "1.18.0" }, updatedAt: 5 } } as unknown as NetworkUpdate;
const DOWN = { kind: "snapshot", snapshot: { controller: { available: false, baseUrl: null, reason: "no-controller", version: null }, updatedAt: 0 } } as unknown as NetworkUpdate;

export const PROBE_STEP_MS = 1_200;

/**
 * P3 尺 #74 的刺激源：env 闸门后面，用**生产 WorkStatusService 的生产入口**把六档走一遍。
 * 只发 AGUI 形状的事件对象，不调模型、不出网（约束「不出网」+ 无凭据）。
 * 探针不打印任何东西：detail 里可能有卡片首行（用户原话），日志不是它的归宿。
 */
export function startWorkStatusProbe(
  service: WorkStatusService,
  opts: { schedule?: (fn: () => void, ms: number) => () => void; stepMs?: number } = {},
): () => void {
  const schedule = opts.schedule ?? ((fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); });
  const stepMs = opts.stepMs ?? PROBE_STEP_MS;
  const cancels: Array<() => void> = [];
  let i = 0;
  const steps: Array<() => void> = [
    () => service.noteNetwork(DOWN),                                        // 连接中
    () => service.noteAguiEvent("RUN_STARTED", { runId: "probe-run" }),      // 思考中
    () => service.noteAguiEvent("TOOL_CALL_START", { runId: "probe-run", toolCallName: "read_file", toolCallDisplayName: "读取文件" }),   // 工作中
    () => service.noteAguiEvent("TOOL_CALL_START", { runId: "probe-run", toolCallName: "totally_unregistered_tool", toolCallDisplayName: "[evil] drop_table" }), // 白名单的反例哨兵
    () => service.noteAguiEvent("TOOL_CALL_END", { runId: "probe-run" }),    // 回 思考中
    () => service.noteAskOpen("probe-card", "probe-run", "要不要覆盖已有文件"),   // 提醒
    () => service.noteAskSettled("probe-card"),                              // 复位被压住的那一档
    () => service.noteAguiEvent("RUN_FINISHED", { runId: "probe-run" }),     // 已处理（SETTLED_MS 5s 后自动降）
    () => service.noteAguiEvent("RUN_STARTED", { runId: "probe-run-2" }),
    () => service.noteCancel("probe-run-2"),                                 // 已中断（IDLE_FALLBACK_MS 8s 后回落）
    () => service.noteNetwork(RUNNING),
    () => {},
  ];
  const tick = (): void => {
    if (i >= steps.length) return;
    steps[i]!();
    i += 1;
    if (i < steps.length) cancels.push(schedule(tick, stepMs));
  };
  tick();
  return () => { for (const c of cancels) c(); cancels.length = 0; i = steps.length; };
}
```

（`default-dependencies.ts` 里紧跟 `registerWorkStatusIpc(...)` 的装配处：）

```ts
        if (process.env.VERGE_WORK_STATUS_PROBE === "p3") {
          // 与 VERGE_GEOM_PROBE（window-manager.ts:455）同一套 env 闸门：生产包里这条路恒假。
          const stopProbe = startWorkStatusProbe(workStatus);
          shutdown.register({ id: "verge-work-status-probe", phase: "stopLocalResources", dispose: async () => { stopProbe(); } });
        }
```

- [ ] **Step 4: 跑绿 + 门**

```bash
CI=true npx vitest run src/shared/pet-tool-labels.test.ts src/main/pet/work-status.test.ts src/main/pet/work-status-presentation.test.ts src/renderer/pet/girl.test.ts src/renderer/pet/companion.test.ts src/renderer/pet/renderer.test.ts src/renderer/pet/pet-status-ipc-wiring.test.ts
CI=true npx vitest run src/main/application/ipc-contract.test.ts src/main/application/ipc-scope.test.ts
npm run check:main && npm run check:preload && npm run check:renderer && npm run palette:check
```

Expected: 第一轮全绿。第二轮两条契约测试也应当全绿——**`ipc-contract` 这次不该红**：新通道是纯 invoke 方向，preload 有 `invoke`、主进程有 `handle`，两两对上；若它红在 `VERGE_PET_REVEAL_ASK 找不到 handle`，是 `(g)` 那段写成了 `ipc.on` 或忘了注册，别去给扫描器加白名单。`palette:check` 绿是本任务「没新增颜色」的证据：演出表里只有通道数与脸参数，一个色号都没有。

- [ ] **Step 5: #74 的三件产物与跑法**

`src/main/pet/work-status-probe.test.ts`——CI 里能跑的那半条证据链（它把「六档都会来」钉成永久锁，`vi.useFakeTimers()` 让它不需要屏幕）：

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { WORK_STATUS_TIERS } from "../../shared/work-status-types";
import { createWorkStatusService } from "./work-status";
import { PROBE_STEP_MS, startWorkStatusProbe } from "./work-status-probe";

describe("workStatus 探针 (Task 18 · #74 的单测半链)", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("探针把六档全部走了一遍，顺序与 spec §6 的剧本一致", () => {
    vi.useFakeTimers();
    const svc = createWorkStatusService();
    const seen: Array<string | null> = [];
    const stop = startWorkStatusProbe(svc, { stepMs: PROBE_STEP_MS });
    for (let i = 0; i < 12; i += 1) {
      vi.advanceTimersByTime(PROBE_STEP_MS);
      seen.push(svc.current()?.tier ?? null);
    }
    for (const tier of WORK_STATUS_TIERS) expect(seen, `${tier} 从未出现`).toContain(tier);
    // 反例哨兵：探针里那步未登记 id 的 detail 必须是缺省词，不许是 id 本身
    const details: Array<string | undefined> = [];
    svc.subscribe((s) => details.push(s?.detail));
    vi.advanceTimersByTime(PROBE_STEP_MS * 12);
    expect(details.filter((d) => d === "totally_unregistered_tool")).toHaveLength(0);
    expect(seen.indexOf("连接中")).toBeLessThan(seen.indexOf("工作中"));
    expect(seen.indexOf("已处理")).toBeLessThan(seen.indexOf("已中断"));
    stop();
    svc.dispose();
    expect(vi.getTimerCount()).toBe(0);            // 没有泄漏定时器：dispose 之后还挂钟就是尺子坏了
  });
});
```

`scripts/verify/work-status-cdp.mjs`（屏幕半条链；骨架照 `p4-cdp-capture.mjs` 的 `Session`/`evaluate`/`shoot`，但**永不点击**）：

```js
// P3 尺 #74：工作状态六档端到端（探针→service→IPC→渲染端→屏幕）。
// 用法：node scripts/verify/work-status-cdp.mjs <shotsDir>
// - 只允许写在 D:\cyrene-p3-accept\ 下的一次性 profile，绝不碰 %APPDATA%。
// - 全程只读只截：不点任何东西，不对 mihomo 发 PUT/POST（约束「验收器永不点击」）。
// - 画面判据靠量化指纹：桌布在动、dpr 取整都会抖（project-pet-pixel-oracle「哈希前必须量化」那条）。
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const PROFILE = "D:\\cyrene-p3-accept\\profile";
const DEBUG_PORT = 9334;
const TIERS = ["连接中", "思考中", "工作中", "提醒", "已处理", "已中断"];
const CANARY = ["totally_unregistered_tool", "drop_table", "evil", "read_file", "run_shell"];
const POLL_MS = 150;
const POLL_WINDOW_MS = 40_000;      // 探针全程约 12×1.2s=14.4s，加启动余量

function assertSafeProfile(dir) {
  const normalized = path.resolve(dir).toLowerCase();
  if (!normalized.startsWith("d:\\cyrene-p3-accept")) throw new Error(`profile 必须落在 D:\\cyrene-p3-accept 下，收到 ${dir}`);
  return normalized;
}

function writeProfileState(profileDir) {
  const dir = path.join(profileDir, "verge");
  fs.mkdirSync(dir, { recursive: true });
  // 档位落盘文件（verge-store.ts:5 + verge-service.ts:21）。girl/large 让演出真的发生：
  // 四足形不吃演出（renderer.syncWorkStatus 的 form 闸门），拿它跑等于测空气。
  fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify({ form: "girl", tier: "large" }, null, 2), "utf8");
}
```

（`Session` 类、`evaluate`（含 45s 回音期限）、`shoot`、`attach` 四件套**从 `p4-cdp-capture.mjs` 原样搬**，只把 `findTarget` 换成按 DOM 认猫窗的版本——`create-pet-window.ts:118/120` 证明 dev/prod 都不给 URL 留任何可分辨的线索：）

```js
/** 猫窗没有可辨 URL（dev 恒 http://localhost:5173），只能逐个 attach 之后用 #pet-canvas 认。 */
async function findPetTarget(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      for (const t of (await res.json()).filter((x) => x.type === "page" && x.webSocketDebuggerUrl)) {
        let s;
        try {
          s = await attach(t);
          const hit = await evaluate(s, `!!document.getElementById("pet-canvas") && !!window.__cyrene`, { timeoutMs: 4_000 });
          if (hit) return { target: t, session: s };                 // 连上就交给调用方，不许在这里关
          s.close();
        } catch { s?.close(); }
      }
    } catch { /* CDP 端口还没起来 */ }
    if (Date.now() > deadline) return null;
    await new Promise((r) => setTimeout(r, 400));
  }
}
```

（`Session` 需要补一个同步的 `close()`（`this.ws.close()`）；每个候选 target 都只跑一条 4 秒期限的小表达式，认不出就关，认得出就留着用。**别把它改成「先列 url 再猜」**——猜出来的猫窗可能是 React 窗，那把尺子量的就是别人的画面。）

采样与判据：

```js
/** 画布指纹：alpha>10 记为墨，16 级量化后落进 8×8 格；桌布/dpr 抖动被量化吃掉。 */
const FINGERPRINT = `(() => {
  const c = document.getElementById("pet-canvas");
  if (!c) return null;
  const g = c.getContext("2d", { willReadFrequently: true, alpha: true });
  const W = c.width, H = c.height;
  const d = g.getImageData(0, 0, W, H).data;
  const q = (v) => Math.round(v / 16);
  const grid = new Array(64).fill(0);
  let ink = 0;
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = (y * W + x) * 4;
      if (d[i + 3] <= 10) continue;
      ink += 1;
      const gx = Math.min(7, (x * 8 / W) | 0), gy = Math.min(7, (y * 8 / H) | 0);
      grid[gy * 8 + gx] += q(d[i]) + q(d[i + 1]) * 4 + q(d[i + 2]) * 16;
    }
  }
  return { ink, grid: grid.map((v) => Math.round(v / Math.max(1, (W * H) / 64))) };
})()`;

const DIST = (a, b) => a.grid.reduce((s, v, i) => s + Math.abs(v - b.grid[i]), 0) + Math.abs(a.ink - b.ink) / 50;

async function main() {
  const shotsArg = process.argv[2];
  if (!shotsArg) throw new Error("用法：node scripts/verify/work-status-cdp.mjs <shotsDir>");
  const shots = path.resolve(shotsArg);
  const profile = assertSafeProfile(PROFILE);
  fs.rmSync(profile, { recursive: true, force: true });
  fs.mkdirSync(profile, { recursive: true });
  fs.mkdirSync(shots, { recursive: true });
  writeProfileState(profile);

  const electronBin = createRequire(import.meta.url)("electron");
  const child = spawn(electronBin, [".", `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`], {
    cwd: ROOT, env: { ...process.env, VERGE_WORK_STATUS_PROBE: "p3" }, stdio: ["ignore", "pipe", "pipe"],
  });
  const appLog = [];
  child.stdout.on("data", (b) => appLog.push(String(b)));
  child.stderr.on("data", (b) => appLog.push(String(b)));

  const found = await findPetTarget(150_000);
  if (!found) { await dumpAndKill(child, appLog, "没等到猫窗（#pet-canvas + window.__cyrene）"); }

  const byTier = new Map();
  const leakHits = [];
  const deadline = Date.now() + POLL_WINDOW_MS;
  while (Date.now() < deadline) {
    const d = await evaluate(found.session, `window.__cyrene && window.__cyrene.getPetDiagnostics ? window.__cyrene.getPetDiagnostics() : null`, { timeoutMs: 4_000 });
    if (d && d.workStatus && d.workStatus.tier) {
      const tier = d.workStatus.tier;
      const fp = await evaluate(found.session, FINGERPRINT, { timeoutMs: 8_000 });
      if (!fp) throw new Error("画布指纹取不到：#pet-canvas 不存在或 getImageData 失败（尺子坏了，不是产品红）");
      const seenText = [d.workStatus.detail, d.bubbleText].filter((s) => typeof s === "string").join(" ");
      for (const w of CANARY) if (seenText.includes(w)) leakHits.push(`${tier}: ${seenText}`);
      if (!byTier.has(tier)) {
        byTier.set(tier, { fp, expression: d.expression, shots: [] });
        await shoot(found.session, shots, `work-${tier}.png`, null);      // 整窗图：猫 + 气泡一起进画面
      }
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  child.kill();

  const tiers = [...byTier.keys()];
  const expressions = [...new Set(tiers.map((t) => byTier.get(t).expression).filter(Boolean))];
  const fps = tiers.map((t) => byTier.get(t).fp);
  let minDist = Infinity;
  for (let i = 0; i < fps.length; i += 1) for (let j = i + 1; j < fps.length; j += 1) minDist = Math.min(minDist, DIST(fps[i], fps[j]));
  const report = { observed_tiers: tiers, observed_expressions: expressions, distinct_tier_pairs: tiers.length * (tiers.length - 1) / 2, min_fingerprint_distance: Math.round(minDist), leak_hits: leakHits };
  fs.writeFileSync(path.join(shots, "work-status-report.json"), JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));

  const fails = [];
  if (tiers.length < 4) fails.push(`只见到 ${tiers.length} 档（要求≥4）：${tiers.join("、") || "无"}`);
  if (expressions.length < 3) fails.push(`只见到 ${expressions.length} 种表情（要求≥3）——级联没生效`);
  if (!(minDist >= 40)) fails.push(`档位两两最小指纹距离 ${minDist}（要求≥40）：画面根本没换`);
  if (leakHits.length) fails.push(`内部标识露出来了：${leakHits.join("；")}`);
  if (!tiers.includes("提醒")) fails.push("提醒 一档没出现（白名单与气泡那条路径没验到）");
  if (fails.length) throw new Error(fails.join("\n"));
}
```

`dumpAndKill` 与 `p4-cdp-capture.mjs:368-380` 的收尾同形（把 app 输出尾部打出来再 `process.exit(1)`——**探针没跑起来与档位没换画面是两种红，措辞必须分开**）。`main()` 之后照那份文件最后一行 `main().catch((error) => { console.error(String(error?.stack ?? error)); process.exitCode = 1; })`。

`package.json` 的 `scripts` 里，紧跟既有 `verify:installer` 加一行（**这个仓现在没有 `verify:cdp` 之类的聚合脚本**，Step 0 已 grep 复核）：

```json
    "verify:work-status": "node scripts/verify/work-status-cdp.mjs",
```

跑法（一次性，产物留在 D 盘）：

```bash
cd /d/Test/workbuddy/cyrene-verge && npm run verify:work-status -- D:/Test/workbuddy/p3-accept/shots
```

Expected: 控制台打出六档全观察、`min_fingerprint_distance` ≥ 40、`leak_hits: []`；`D:\Test\workbuddy\p3-accept\shots\work-*.png` 六张，肉眼看 工作中 是坐着敲、提醒 是探头、已中断 挂着泪。

- [ ] **Step 6: 变异验牙（四条，逐条做完立刻还原）**

① **把 `detail` 改回读 displayName**（`setAgent("工作中", runId, petToolLabel(...))` → `setAgent("工作中", runId, (event as any).toolCallDisplayName)`）：Expected: `work-status.test.ts` 那条「不是主进程捎带的 displayName」红 + `work-status-probe.test.ts` 的 `totally_unregistered_tool` 计数变成 1。还原跑绿。这条牙证明白名单不是装饰。

② **`petToolLabel` 改成未命中时 `return toolCallName`**（照抄聊天页 `agent-rounds.ts:69` 那行的口径）：Expected: `pet-tool-labels.test.ts` 的「未登记的绝不说 id」红 + 探针那条 `toHaveLength(0)` 红。还原。

③ **把 `applyLayerPose` 的级联退化成 `this.cat.expression = MOOD_TO_EXPRESSION[snapshot.mood]`**：Expected: `renderer.test.ts` 的「档位级联」「edge 只在跃迁放一次」两条红（脸恒 neutral，档位脸进不来）。还原。

④ **注释掉 `default-dependencies.ts` 里那条 `startWorkStatusProbe` 的 env 分支**：Expected: `pet-status-ipc-wiring.test.ts` 的 `VERGE_WORK_STATUS_PROBE === "p3"` 文本锁红——**这条证明「探针怎么接上」是被锁住的，而 #74 屏幕那条红是另一回事**：`npm run verify:work-status` 会整条报「只见到 0 档」，那是探针停摆而不是产品坏，脚本的措辞（`fails` 数组第一条）已经把两种分开。还原。

⑤（#74 自己的牙，屏幕层）**临时把 `PRESENTATIONS["工作中"].body` 改成 `null`** 再跑一次脚本：Expected: 仍绿——六档里少一档画面差别不构成 FAIL（判据是「≥4 档 + 两两距离≥40」，这是 spec §13 写死的宽松下界，不是尺子没牙）。因此 ⑤ 只用来确认「单档退化不会假红」，**真正的牙在 `renderer.test.ts` 的「body 接管」那条单测**：同样的改动会让它当场红（`slots.body.clip.id` 期望 `sit`）。这两条分工写进台账：单测管逐档精确，#74 管端到端真的通到了屏幕。

- [ ] **Step 7: 台账（口径差⑨⑩⑪ + P3 收口）**

`docs/verge/notes/progress.md` 追加，并把计划开头的口径差表头（本文 1529/1531 行那一段）从 ⑫ 扩到 ⑪ 的归属确认：

```markdown
## 2026-10-24 · P3 工作状态接驳（Task 15–18）收口

- 口径差⑨（已处理 的星星）：spec §6 要「happy + 星星一瞬」，Task 9 的差分表里 happy 的 `star` 是 0（只有 `excited` 是 0.6）。
  实现走演出表的 `face` 差分（`starPulse(now, since)` 三闪 ×1.4s，纯函数、端点归零、`since` 用档位起点），
  **不改 happy 的差分**：改表会让 摸摸/喂食/玩耍 那批用 happy 的动作一起闪星，那是另一种口径。
  节拍上限 4.2s 站在 `SETTLED_MS`(5s) 里 ⇒ 档位自己降回待机时星星也已经归零，不会出现「待机还挂着星」。
- 口径差⑩（提醒 深链）：spec §6 写「沿用 v1.4 的深链 `tab_hint`」——那是 native 版的东西，本 fork 里 `tab_hint` **0 命中**（grep 见 Step 0），
  `ChoiceCardEvent`（`toast-events.ts:22-45`）也没有 `sessionId`，`CHATS_OPEN_IN_REACT_WINDOW`（`chat-ui-ipc.ts:296-300`）要求非空会话 id 才肯动。
  实现新增 `IPC.VERGE_PET_REVEAL_ASK`（无载荷、`allow:["pet"]`），主端复用 `activation.request({ kind: "chat" })`
  ——与 `toast-service.ts:268-272` 的「点 toast 去看」同一条通路、同一个 kind；猫只说「要去看」，去哪儿仍是主端权威。
- 口径差⑪（#74 证据链的入口层次）：不出网、无模型凭据 ⇒ 探针只能从 `WorkStatusService` 的**生产入口**灌 AGUI 形状的事件，
  不是从 `agui-bridge` 的订阅点灌。所以 #74 覆盖的是 service→IPC→渲染端→屏幕，
  而 `agui-bridge.ts:1079` 那一跳与 `onChoiceCard`/`onNetwork` 两条订阅由 Task 16 的 `work-status-wiring.test.ts` 文本锁覆盖（`:4168` 那三条）。
  spec 变异⑤ 的「注释掉一个触发源」因此在两条尺子上各红一次：注释 `default-dependencies.ts` 的装配行 → #74 红在「只见到 N 档」；
  注释 `agui-bridge.ts` 的 `noteAguiEvent` → 红的是 Task 16 的文本锁，不是 #74。这是设计上的分层，不是洞。
- 本期口径（不另立编号）：workStatus 的演出（body 接管 / edge / hold / 偏置 / 脸差分 / 气泡）只在 `form === "girl"` 生效。
  四足形继续走 `applyCatPose` + 位图心情路径，兑现「四足猫逐像素不变」；Task 27 翻默认之后这条闸门自然对全体用户失效，
  届时它是代码里的历史注释，不是待办。
- P3 四条通道（profile get/update、work-status get/update）+ 第五道 `pet-reveal-ask` 全部有白名单/契约双向对账；
  全量门 `check:main/preload/renderer/brand/roster/sprites + palette:check + palette:migrate:check` 本任务只跑了前三条 + `palette:check`，
  后四条留到 Task 23 的 P4 门与 Task 28 的全量门（本任务没动 assets 与 i18n）。
```

- [ ] **Step 8: 提交**

```bash
cd /d/Test/workbuddy/cyrene-verge
git add src/shared/pet-tool-labels.ts src/shared/pet-tool-labels.test.ts \
  src/main/pet/work-status.ts src/main/pet/work-status.test.ts \
  src/main/pet/work-status-probe.ts src/main/pet/work-status-probe.test.ts \
  src/renderer/pet/work-status-presentation.ts src/renderer/pet/work-status-presentation.test.ts \
  src/renderer/pet/renderer.ts src/renderer/pet/renderer.test.ts \
  src/renderer/pet/companion.ts src/renderer/pet/companion.test.ts \
  src/renderer/pet/form.ts src/renderer/pet/girl.ts src/renderer/pet/girl.test.ts \
  src/renderer/main.ts src/renderer/pet/pet-status-ipc-wiring.test.ts \
  src/renderer/types/cyrene.d.ts src/preload/index.ts \
  src/shared/ipc-channels.ts src/main/application/ipc-sender-policy.ts \
  src/main/pet/work-status-ipc.ts src/main/application/default-dependencies.ts \
  scripts/verify/work-status-cdp.mjs package.json docs/verge/notes/progress.md
git commit -m "$(cat <<'EOF'
feat(pet): 六档演出表、工具名白名单与 #74 证据链（P3 收口，v1.5.0 Task 18）

工作状态从此有牙：连接中 前倾带汗、思考中 歪头点颊、工作中 坐下打字、
提醒 挥手再探头、已处理 行礼三闪星、已中断 后缩挂泪——档位到画面只经一张表。

detail 只从 id 过白名单（未登记一律「在忙」）：harness 内建工具的 name 就是
英文 id，MCP 的 name 是第三方字符串，字段来源判不出「是不是内部标识」。

新增 pet-reveal-ask 一条无载荷通道，提醒档点气泡复用 toast 的
activation.request({kind:"chat"})；探针（env 闸门）+ 假钟单测 + CDP 屏幕尺三件
把六档端到端钉成可复跑的证据。四足形态不吃演出。

口径差⑨⑩⑪ 记进 docs/verge/notes/progress.md。
EOF
)"
```

---

## Task 19: `pickRoll` — 形态作用域的四层加权抽取（永不停轮）

spec §5 把「闲置加权表」换成四档 10/5/5/80 的**永不停轮**抽取，并要求「两次抽都要能测：单测直接喂 `random`，沿用 `pickIdleActivity` 的注入式随机」（spec `:245`）。本任务只做抽取与引擎落点，**不碰 renderer**——四层谁赢在 Task 20 定，抽到的手势此刻先在 `CompanionSnapshot.gesture` 上等着。

**Files:**
- Modify: `src/renderer/pet/motion.ts`（文件末尾追加 `gestureIds()`）
- Modify: `src/renderer/pet/companion.ts:100-190`（新表与新函数，**不改** `IDLE_ACTIVITIES`/`pickIdleActivity` 一个字节）
- Modify: `src/renderer/pet/companion.ts:68-84`（`CompanionSnapshot` 追加 `gesture`）、`:191-221`（三条私有字段 + `setForm`）、`:535-574`（`stepIdle` 顶部按 form 分派 + 新增 `stepIdleGirl`）
- Test: `src/renderer/pet/motion.test.ts`（追加「已注册手势池」一条）
- Test: `src/renderer/pet/companion.test.ts`（追加「猫娘加权表」describe；**该文件现有的 `describe("companion idle table")`（`:57-85`，两条 `it` / 七个 `expect`）一字不许动**，它们是四足路径的对照）

**Interfaces:**
- Consumes:
  - Task 1 的 `PetForm`（`src/shared/pet-profile.ts`）
  - Task 13 的 `CLIPS`、`gestureClip(id)`（`layer === "gesture"` 才不抛）
  - 现 `CompanionEngine`：`random`/`now`/`wallNow`（`companion.ts:222-234`）、`idleDelay()`（`:503`）、`startRoam()`（`:576`）、`startAction()`（`:706`）、`userActive`（`:217`）、`vitals.energy`、`NAP_MIN_MS`/`NAP_SPAN_MS`（`:41/:42`）
  - 现 `clamp`/`clamp01`（`companion.ts:139-140`）——新函数复用它们，不另写一套
- Produces:
  - `type RollBucket = "idle_micro" | "peek" | "move" | "gesture"`
  - `interface Roll { bucket: RollBucket; gesture: string | null }`
  - `const ROLL_WEIGHTS: Readonly<Record<RollBucket, number>>`＝`{ idle_micro: 10, peek: 5, move: 5, gesture: 80 }`（四档相加＝100，spec `:236` 的原话）
  - `pickRoll(random: number, gestureRandom: number, options?: { previousGesture?: string | null; hour?: number; energy?: number; pool?: readonly string[] }): Roll`
  - `gestureIds(): string[]`（motion.ts：已注册的 gesture clip id，**字典序**，由 `CLIPS` 现算）
  - `CompanionEngine.setForm(form: PetForm): void`
  - `CompanionSnapshot.gesture: string | null`（Task 20 的 `gestureSlotFor` 读它）

**通道单位与档位口径不变**：本任务只新增抽取，四足的 `IDLE_ACTIVITIES` 七行平表与 `pickIdleActivity` 的三个昼夜/精力分支**继续是四足唯一的行为来源**（R-D2）。这就是口径差⑭，见 Step 8。

- [ ] **Step 0: grep 复核，把「一字不动」变成可核对的数**

```bash
cd /d/Test/workbuddy/cyrene-verge
grep -n "IDLE_ACTIVITIES\|pickIdleActivity" src/renderer/pet/companion.ts
grep -n "IDLE_ACTIVITIES\|pickIdleActivity" src/renderer/pet/companion.test.ts
grep -n "layer === \"gesture\"\|GESTURE_IDS" src/renderer/pet/motion.ts
grep -n "NAP_MIN_MS\|startRoam\|startAction\|idleDelay\|userActive" src/renderer/pet/companion.ts
CI=true npx vitest run src/renderer/pet/companion.test.ts
```

期望：前两条分别命中 **7 处**（`:100/:156/:166/:183/:185/:187/:550`）与 **8 处**（`:5/:7/:59/:62/:70/:73/:79/:81/:83` 里除去 import 的两行）；`CI=true npx vitest run` 必须**先绿**——它是四足行为的对照基线，改完再跑一次，两次的断言条数与通过数必须完全一致。第三条给出 Task 13 落地后的 gesture clip 条数（本任务应为 9）；第四条是 `stepIdleGirl` 要复用的四个口。

- [ ] **Step 1: 写失败测试（已注册手势池）**

`src/renderer/pet/motion.test.ts` 追加：

```ts
import { allClips, gestureIds } from "./motion";

describe("gestureIds：抽的是已注册表，不是名字表", () => {
  it("返回字典序、只含 gesture 层、且与 allClips() 现算一致", () => {
    const fromClips = allClips().filter((c) => c.layer === "gesture").map((c) => c.id).sort();
    expect(gestureIds()).toEqual(fromClips);
    expect(gestureIds()).toEqual([...gestureIds()].sort());   // 顺序稳定：抽取要可复现，不能跟着 Set 的插入序漂
  });

  it("正对照：每一个 id 都能过 gestureClip()（未注册名混进池里当场抛）", () => {
    for (const id of gestureIds()) expect(() => gestureClip(id)).not.toThrow();
    expect(() => gestureClip("totally_absent_gesture")).toThrow();
  });
});
```

**为什么池子中轴是「已注册表」而不是 `GESTURE_IDS`**：`GESTURE_IDS` 是 18 个名字（Task 13 的 `:12` 注释已写明本任务只落地 9 条 clip），另外 9 条要到 Task 21 才进表。抽到未注册名会走 `gestureClip()` 抛错——那是构建期才炸的哑火，不是行为。池子由 `allClips()` 现算，Task 21 补完 9 条之后**自动**从 9 变 18，一个常数都不用改（这条是尺 #73 的姊妹判据，也是 Step 6 变异验牙第 ④ 项的落点）。

- [ ] **Step 2: 跑红**

Run: `CI=true npx vitest run src/renderer/pet/motion.test.ts`
Expected：FAIL，`gestureIds is not a function`（或 TS 报「没有导出的成员 gestureIds」）。同时确认 `allClips` 已在 Task 12 导出——若缺，本任务的 import 会以另一种方式红，先按 Task 12 的 Produces 补齐再往下。

- [ ] **Step 3: 实现 `gestureIds()`**

`src/renderer/pet/motion.ts` 文件末尾（Task 13 的 `registerClips(CLIPS)` 之后）追加：

```ts
/**
 * 已注册的手势 clip id，字典序。给 `companion.ts` 的加权抽取当池子。
 * 为什么从 CLIPS 现算而不返回 GESTURE_IDS：后者是 18 个**名字**，Task 21 之前只注册了 9 条。
 * 抽到未注册名会在 gestureClip() 抛——构建期炸掉的哑火不算行为，池子必须与注册表同步长大。
 */
export function gestureIds(): string[] {
  return CLIPS.filter((c) => c.layer === "gesture").map((c) => c.id).sort();
}
```

Run: `CI=true npx vitest run src/renderer/pet/motion.test.ts` → PASS。

- [ ] **Step 4: 写失败测试（四档权重 + 两次抽 + 不重复 + 昼夜精力）**

`src/renderer/pet/companion.test.ts` 追加**纯函数**那一段（引擎接线的 describe 在 Step 7，同一个文件里两处）。该文件顶部已有 `./companion` 的 import（`:1-10`），本步只补下面两个具名符号；不新建 harness 文件，现有 18 条 `it` 与断言一律不动。

```ts
import { ROLL_WEIGHTS, pickRoll, type RollBucket } from "./companion";
import { gestureIds } from "./motion";

/**
 * 白天、精力足。这两个值必须与 `pickRoll` 缺省分支逐字相同（`hour ?? 14`、`energy ?? 0.8`，
 * 照 `pickIdleActivity:161-162` 抄），否则下面每条边界都得重算。
 */
const DAY = { hour: 14, energy: 0.8 };

const bucketOf = (r: number, g: number = 0.5, o = DAY): RollBucket => pickRoll(r, g, o).bucket;

describe("pickRoll：四档 10/5/5/80", () => {
  it("默认权重表四档相加＝100（spec §5 的原话，改一个数就得改这条）", () => {
    expect(ROLL_WEIGHTS).toEqual({ idle_micro: 10, peek: 5, move: 5, gesture: 80 });
    expect(Object.values(ROLL_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("白天的四条边界：10% / 15% / 20% 是档与档的接缝", () => {
    expect(bucketOf(0.05)).toBe("idle_micro");
    expect(bucketOf(0.12)).toBe("peek");
    expect(bucketOf(0.17)).toBe("move");
    expect(bucketOf(0.50)).toBe("gesture");
    expect(bucketOf(0.0999)).toBe("idle_micro");
    expect(bucketOf(0.10)).toBe("peek");        // 左闭右开，与 pickIdleActivity 同一口径
  });

  it("夜里与力竭只压 move/gesture，idle/peek 不动", () => {
    expect(bucketOf(0.20, 0.5, DAY)).toBe("gesture");
    expect(bucketOf(0.20, 0.5, { hour: 23, energy: 0.8 })).toBe("move");   // 夜里 move 被压到 2.25，窗口左移
    expect(bucketOf(0.20, 0.5, { hour: 14, energy: 0.1 })).toBe("gesture"); // 力竭只压 move，总重仍够到 gesture
    expect(bucketOf(0.05, 0.5, { hour: 23, energy: 0.1 })).toBe("idle_micro");
    // 夜里＋力竭：四档绝对权重是 10 / 5 / 1.125 / 64，总重 80.125。idle/peek 的**绝对**权重
    // 一个字没动，但 `at = random × total` 里的 total 小了，peek 的窗口从 [0.10, 0.15) 挪到
    // [0.1248, 0.1872)。所以这里传 0.15 而不是白天的 0.12：0.12 落在 idle_micro，
    // 拿它当「peek 不动」的证据是假绿（`project-false-green-locks`）。
    expect(bucketOf(0.15, 0.5, { hour: 23, energy: 0.1 })).toBe("peek");
  });

  it("纯函数：同输入连调两次逐字段相等；0.999999 不越界（R-D9）", () => {
    expect(pickRoll(0.5, 0.5, DAY)).toEqual(pickRoll(0.5, 0.5, DAY));
    const edge = pickRoll(0.999999, 0.999999, DAY);
    expect(edge.bucket).toBe("gesture");
    expect(gestureIds()).toContain(edge.gesture);
  });

  it("gesture 档在池里等权抽：200 次投点覆盖整池且绝不返回未注册名", () => {
    const pool = gestureIds();
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const roll = pickRoll(0.5, i / 200, DAY);
      expect(roll.bucket).toBe("gesture");
      expect(typeof roll.gesture).toBe("string");
      seen.add(roll.gesture as string);
    }
    expect(seen.size).toBe(pool.length);
    for (const id of seen) expect(() => gestureClip(id)).not.toThrow();
  });

  it("不重复上一手势（沿用 pickIdleActivity 的 previous 剔除，spec :247）", () => {
    const pool = gestureIds();
    for (let i = 0; i <= 100; i++) {
      const roll = pickRoll(0.5, i / 101, { ...DAY, previousGesture: pool[0] });
      expect(roll.gesture).not.toBe(pool[0]);
    }
  });

  it("正对照：池子空了要抛，不许静默降级成 idle_micro 骗过下游", () => {
    expect(() => pickRoll(0.5, 0.5, { ...DAY, pool: [] })).toThrow(/池为空/);
  });
});
```

- [ ] **Step 5: 跑红**

Run: `CI=true npx vitest run src/renderer/pet/companion.test.ts`
Expected：新增 7 条 FAIL（`pickRoll is not a function` / `ROLL_WEIGHTS` undefined），原有 18 条仍 PASS（`grep -c "^  it(" src/renderer/pet/companion.test.ts`＝18，Task 9 落地后按实际数记）。若新增条目红的原因是 TS 编译不过而不是运行期 undefined，把 import 补齐再跑一次——**红必须是「东西还没有」，不是「字打错了」**。

- [ ] **Step 6: 实现 `pickRoll` 与四档表**

`src/renderer/pet/companion.ts` 在 `pickIdleActivity` 之后（现 `:188` 那行右括号下面）插入。注意：`gestureIds`/`gestureClip` 从 `./motion` import，`PetForm` 从 `../../shared/pet-profile` import——`companion.ts` 今天不 import 这两条，本任务是第一次，跑 `check:renderer` 前先把 import 头补齐。

```ts
/**
 * 猫娘的四档加权表（spec §5「加权永不停轮」）。与 IDLE_ACTIVITIES 的区别不是「换了个数」，
 * 是**永不停轮**：待机微动自己占一档（10），什么都不做也算一次抽取结果，而不是抽完之后 return。
 */
export type RollBucket = "idle_micro" | "peek" | "move" | "gesture";

export interface Roll {
  bucket: RollBucket;
  /** 已注册的 gesture clip id；非 gesture 档里 `peek` 也带名字（张望就是那条 lasting 片）。 */
  gesture: string | null;
}

export const ROLL_WEIGHTS: Readonly<Record<RollBucket, number>> = {
  idle_micro: 10,
  peek: 5,
  move: 5,
  gesture: 80,
};

const ROLL_ORDER: readonly RollBucket[] = ["idle_micro", "peek", "move", "gesture"];

/**
 * 两次抽：第一支签定档，第二支签在**已注册**手势池里等权抽。
 * 两个随机数各喂各的，单测才能一次钉死一档（spec :245「两次抽都要能测」）。
 * 昼夜/精力分支照 `pickIdleActivity:169-177` 的系数搬：move ×0.45 夜、×0.5 力竭；gesture ×0.8 夜。
 * idle/peek 两档不随昼夜动——张望和呼吸跟几点没关系，睡着那条路由引擎在 idle_micro 档里判。
 */
export function pickRoll(
  random: number,
  gestureRandom: number,
  options: { previousGesture?: string | null; hour?: number; energy?: number; pool?: readonly string[] } = {},
): Roll {
  const hour = options.hour ?? 14;
  const energy = options.energy ?? 0.8;
  const night = hour >= 22 || hour < 7;
  const exhausted = energy < 0.25;
  const weights = ROLL_ORDER.map((bucket) => {
    switch (bucket) {
      case "move":
        return ROLL_WEIGHTS.move * (night ? 0.45 : 1) * (exhausted ? 0.5 : 1);
      case "gesture":
        return ROLL_WEIGHTS.gesture * (night ? 0.8 : 1);
      default:
        return ROLL_WEIGHTS[bucket];
    }
  });
  const total = weights.reduce((sum, w) => sum + w, 0);
  const at = clamp(random, 0, 0.999999) * total;
  let cursor = 0;
  let bucket: RollBucket = "idle_micro";
  for (let i = 0; i < ROLL_ORDER.length; i += 1) {
    cursor += weights[i];
    if (at < cursor) {
      bucket = ROLL_ORDER[i];
      break;
    }
  }
  if (bucket === "peek") return { bucket, gesture: "peek" };
  if (bucket !== "gesture") return { bucket, gesture: null };

  const pool = options.pool ?? gestureIds();
  const prev = options.previousGesture ?? null;
  const candidates = pool.length > 1 && prev ? pool.filter((id) => id !== prev) : [...pool];
  // 空池不是「抽到 idle」，是表被改坏了。当场抛，别让下游静默吞掉（同 variantFor 的缺行当场红，
  // cat-sprite-manifest.ts:91-94 那条纪律）。
  if (candidates.length === 0) throw new Error("pickRoll：gesture 池为空（CLIPS 里一条 gesture 都没注册？）");
  const idx = Math.floor(clamp(gestureRandom, 0, 0.999999) * candidates.length);
  return { bucket, gesture: candidates[idx] };
}
```

Run: `CI=true npx vitest run src/renderer/pet/companion.test.ts` → 新增 7 条 PASS，原有 18 条仍 PASS。

- [ ] **Step 7: 写失败测试（引擎接线：form 分派 + `snapshot.gesture`）**

同文件追加引擎接线的这一段。它测「一签落到哪里」，不是加权表本身（那是 Step 4）。本段新用的符号只有 `gestureClip`——并进 Step 4 那条 `./motion` import；`CompanionEngine` 早在文件顶部（`:3`），别再写第二条同模块 import。`PetForm` 从 Task 1 的 `../../shared/pet-profile` 取。

```ts
import type { PetForm } from "../../shared/pet-profile";

/**
 * 签子消耗表——这段测试全部的坑都在这张表里，所以写在这里，而不是让每条 it 自己数。
 * `this.random()` 在 `companion.ts` 只有六处调用点（`:231` chatAt、`:504` idleDelay、
 * `:508` pickLine、`:543` 聊天改期、`:550` 四足定档、`:563` 小睡时长、`:581-582` 漫游选点），
 * 本段的取值路径是：
 *   构造器 **2 支**：idleDelay()（`:230`→`:504`）与 chatAt（`:231`）。每条序列必须显式垫两支；
 *     垫错前两位的话第一支定档签会被当成闲置延迟——这是本段唯一会「假绿」的错法。
 *   猫档一轮 roll：定档 1 支（`:550`）＋分支加收（sleep 再加 1 支 `:563`；walk 走 startRoam
 *     再加 2～8 支，`:579-585` 的重试循环要到距离 ≥60 才停）＋收尾 idleDelay 1 支。
 *   猫娘档一轮固定 **3 支**：`pickRoll(this.random(), this.random(), …)` 两支都无条件求值
 *     （非 gesture 档也吃第二支），再加 `stepIdleGirl` 顶部那条 idleDelay。
 *   被闸门挡下的一轮只吃 `idleDelay()` 那 1 支——Task 20 的计数用例照这一条排。
 * 观察不到的位置由 `seq()` 的尾巴接住：它循环最后一个值（`:26-30`），所以尾部位数数错不会假红。
 * 聊天分支（`:541-544`）在冻结时钟下恒不触发——`chatAt = T0 + 35000 + r*30000 > T0`，而 `now()`
 * 一直是 T0，所以那一支签不会被消耗；「这一签落到哪一档」是注入序列的一元函数。
 * 挂钟给的是**本地** 2026-10-24 下午 1 点：`stepIdle` 读 `new Date(wallNow()).getHours()`（`:549`），
 * 写成 `Date.UTC(…, 13, …)` 在 +08:00 落到本地 21 点、在 +09:00 落到 22 点＝夜里——「本地时区决定
 * 测试红不红」是老坑（Task 14 的 harness 里 `wallNow: () => Date.UTC(2026, 9, 24, 13, 0, 0)` 是同一处，
 * 本计划在 Task 14 就地改成本地正午）。夜里那条分支走 `forceIdleRoll` 的 hour 覆盖，不靠这里的挂钟。
 */
const FILL = 0.5;

function rolling(form: PetForm, rolls: number[]): CompanionEngine {
  const engine = new CompanionEngine({
    storage: makeStorage(),
    now: () => T0,
    wallNow: () => new Date(2026, 9, 24, 13, 0, 0).getTime(),
    random: seq([FILL, FILL, ...rolls, FILL]),
  });
  engine.setForm(form);
  engine.setPosition({ x: 200, y: 400 });   // 与 :93/:118 同一口径：先给个屏内落点
  return engine;
}

describe("猫娘加权表的引擎落点", () => {
  it("form=girl：0.50 落 gesture 档，snapshot.gesture 当场带出注册过的片名，身体仍站原地", () => {
    const engine = rolling("girl", [0.50, 0.10]);
    engine.forceIdleRoll(ctx);
    const snap = engine.getSnapshot();
    expect(typeof snap.gesture).toBe("string");
    expect(gestureIds()).toContain(snap.gesture as string);
    expect(snap.activity).toBe("idle");              // 手势档不改身体：站着做小动作
  });

  it("form=cat：同一支签仍走旧七行平表，gesture 恒 null（R-D2 的对照组）", () => {
    const engine = rolling("cat", [0.40]);
    engine.forceIdleRoll(ctx);
    expect(engine.getSnapshot().gesture).toBeNull();
    // 累计 walk 34 / groom 16 → [34,50) 是 groom。0.50 会落到 yawn（左闭右开），两档别搞混。
    expect(engine.getSnapshot().activity).toBe("groom");
  });

  it("待机微动档：白天只是 idle；夜里且力竭才转睡（与四足共用同一条 NAP 口）", () => {
    const day = rolling("girl", [0.05]);
    day.forceIdleRoll(ctx);
    expect(day.getSnapshot().activity).toBe("idle");
    expect(day.getSnapshot().gesture).toBeNull();

    const night = rolling("girl", [0.05]);
    night.setVitals({ energy: 0.1 });
    night.forceIdleRoll(ctx, { hour: 23 });          // hour 覆盖：不靠本地时区
    expect(night.getSnapshot().activity).toBe("sleep");
    expect(night.getSnapshot().gesture).toBeNull();
  });

  it("move 档：userActive 时不迈步（cat 侧 :553-557 那条闸门不许在 girl 侧丢）", () => {
    const engine = rolling("girl", [0.17]);
    engine.setUserActive(true);
    engine.forceIdleRoll(ctx);
    expect(engine.getSnapshot().activity).toBe("idle");
    expect(engine.getSnapshot().gesture).toBeNull();
  });

  it("张望档画的是 lasting 的 peek——与 gesture 池里那条 peek 同源，不是另画一条", () => {
    const engine = rolling("girl", [0.12]);
    engine.forceIdleRoll(ctx);
    expect(engine.getSnapshot().gesture).toBe("peek");
    expect(gestureClip("peek").lasting).toBe(true);
    expect(gestureIds()).toContain("peek");         // 正对照：peek 确实在池里，两档共用一份几何
  });

  it("切回猫形态把 ambient 手势清干净（否则切回来的瞬间自己演一遍）", () => {
    const engine = rolling("girl", [0.12]);
    engine.forceIdleRoll(ctx);
    expect(engine.getSnapshot().gesture).toBe("peek");
    engine.setForm("cat");
    expect(engine.getSnapshot().gesture).toBeNull();
  });
});
```

跑这段之前先核对 `beginDrag`（`:425`）与 `startAction`（`:706`）确实不取签——上面的消耗表按「只有那六处调用点」排，多一个消耗点就得重排；Step 9 的第 3 条变异正是用来抓这种错位的。

Run: `CI=true npx vitest run src/renderer/pet/companion.test.ts` → 新增 **6** 条 FAIL，红因是 `engine.setForm is not a function` / `forceIdleRoll is not a function`（TS 侧另报「`CompanionSnapshot` 上没有 `gesture`」，那也是合法的红因）；Step 4 那 7 条与原有 18 条仍 PASS。

- [ ] **Step 8: 实现引擎落点**

`src/renderer/pet/companion.ts`：

```ts
// CompanionSnapshot 末尾（现 :83 bubble 之后）追加：
  /**
   * 猫娘自主抽到的手势 clip id；过期即 null。四足路径恒 null（R-D2：它读不到这条也照常演）。
   * Task 20 的 gestureSlotFor 是唯一消费方。
   */
  gesture: string | null;

// CompanionOptions 追加（:99 onSettle 之后）：
  /** 行为形态：`cat` 走 IDLE_ACTIVITIES 七行平表，`girl` 走四档加权表。缺省 `cat`＝今天的行为。 */
  form?: PetForm;

// class CompanionEngine 字段区（:216 userActive 附近）追加：
  private form: PetForm = options.form ?? "cat";
  private ambientGesture: string | null = null;
  private gestureUntil = 0;
  private previousGesture: string | null = null;

// 查询面（:241 getSnapshot 的返回对象里，bubble 那行之后）追加：
      gesture: this.ambientGesture && this.gestureUntil > this.now() ? this.ambientGesture : null,

// 公开口（:277 setUserActive 之后）追加：
  /**
   * 形态切换。切回猫时把猫娘侧的抽取残留一次清干净——否则切了形态还挂着上一形态的手势，
   * 而四足路径根本不读 gesture，那条 clip 会在切回来的瞬间「自己演了一遍」。
   */
  setForm(form: PetForm): void {
    if (form === this.form) return;
    this.form = form;
    this.ambientGesture = null;
    this.gestureUntil = 0;
    this.previousGesture = null;
  }

  /**
   * 测试窄口：拿**调用方给的** context 立刻跑一次 stepIdle（闲置到点那一轮）。
   * 生产不调它。为什么要有：`stepIdle` 的入口是 `now >= idleUntil`，而 `idleUntil` 是
   * `IDLE_MIN_MS + random()*IDLE_SPAN_MS`（:229 与 :504）——测试若靠拧假钟到点，注入序列
   * 先被闲置签占掉一位，「这一签落到哪一档」就变成两件事的函数（IDLE_MIN_MS 一改集体哑火）。
   * 窄口把「到点」这一件事直接钉死。
   * context 必须由调用方传：引擎今天把 `CompanionContext` 当**参数**穿来穿去
   * （`update(now, context)`，:301），自己从没存过它——不要为了这条窄口给引擎加一个
   * `lastContext` 字段，那是给生产路径新增一份会过期的状态。
   */
  forceIdleRoll(context: CompanionContext, options: { hour?: number } = {}): void {
    const now = this.now();
    this.idleUntil = now;
    if (options.hour !== undefined) this.hourOverride = options.hour;
    this.stepIdle(now, context);
    this.hourOverride = undefined;
  }
```

`hourOverride` 是配套的新私有字段（`private hourOverride?: number`），`stepIdle` 里读 `hour` 那一行（现 `:549`）改成 `const hour = this.hourOverride ?? new Date(this.wallNow()).getHours();`。**这条改动两形态共用**，`hourOverride` 为 `undefined` 时逐字是今天的表达式——四足的昼夜测试（`companion.test.ts:79-83` 那三条）就是它的对照。

`stepIdle` 内、`if (now < this.idleUntil) return;` 之后插入分派，并把 `:535-574` 原有的 `switch (activity)` 段**整段留在原地不动**：

```ts
    if (this.form === "girl") {
      this.stepIdleGirl(now, context, hour);
      return;
    }
```

（即：先算 `hour`，再按 form 分派；四足那条分支的 `pickIdleActivity(...)` 调用与 `switch` 一字不改。上面 Step 0 的 grep 计数在改完后必须仍是 7 处——只是多了 `stepIdleGirl` 一处引用 `pickRoll`。）

`stepIdleGirl` 紧跟 `stepIdle` 之后：

```ts
  /**
   * 猫娘的一签落地。四档 → 引擎口的映射表（身体档一律留在 stand/idle 语义上，手势另走 gesture 层）：
   *   idle_micro → 什么都不做（待机微动由通道常数与 blinkAt 说话）；夜里＋力竭才转睡
   *   peek       → lasting 的 peek 手势，到期自清
   *   move       → startRoam（userActive 时不迈步，与四足同判据）
   *   gesture    → 抽到的那条片，一次性的演完自己让位（renderer 侧靠槽位时钟，引擎只管过期）
   */
  private stepIdleGirl(now: number, context: CompanionContext, hour: number): void {
    const night = hour >= 22 || hour < 7;
    const roll = pickRoll(this.random(), this.random(), {
      previousGesture: this.previousGesture,
      hour,
      energy: this.vitals.energy,
    });
    this.idleUntil = now + this.idleDelay();

    if (roll.bucket === "move") {
      if (this.userActive) return;
      this.startRoam(context, now);
      return;
    }
    if (roll.gesture) {
      this.previousGesture = roll.gesture;
      this.ambientGesture = roll.gesture;
      this.gestureUntil = now + gestureClip(roll.gesture).ms;
      return;
    }
    // idle_micro：夜里力竭才睡，睡法与四足共用一条 NAP 口（不另发明「猫娘专属小睡」）。
    if (night && this.vitals.energy < 0.5) {
      this.activity = "sleep";
      this.sleepManual = false;
      this.sleepUntil = now + NAP_MIN_MS + this.random() * NAP_SPAN_MS;
    }
  }
```

**为什么 `peek` 档走的是同一个 `gestureClip`**：`ROLL_WEIGHTS.peek` 与 gesture 池里的 `"peek"` 是同一个 clip（Task 13 注册的那条 lasting 片）。张望档只是「保证抽到它」，不是「另画一条 peek」——两条路共用一份几何，才有 R-D2 那条「同源」的承诺可言。

`main.ts` 侧的 form 传入留到 Task 27（翻默认与三档端到端一起），本任务 `new CompanionEngine({...})` 不传 `form`，缺省 `"cat"` ⇒ 生产行为一字不变（`renderer.ts:138` 那一处构造点本任务不动）。

Run: `CI=true npx vitest run src/renderer/pet/companion.test.ts` → 新增 5 条 PASS；
Run: `npm run check:renderer` → 绿。

- [ ] **Step 9: 变异验牙（四条，逐条跑完改回来）**

1. **权重表被动**：`ROLL_WEIGHTS.gesture` 改成 `0` → 边界那条与「200 次投点覆盖整池」两条红。跑 `CI=true npx vitest run src/renderer/pet/companion.test.ts` 记红条数，改回。
2. **previous 剔除被摘**：把 `candidates` 那行改成 `const candidates = [...pool];` → 「不重复上一手势」红（`i/101` 序列里必有一次抽回 `pool[0]`）。改回。
3. **form 分派被改成无条件走猫表**：`if (this.form === "girl")` 删掉 → 五条 girl 断言里至少「gesture 带出片名」与「张望画 peek」红；同时四足的 8 条仍绿——**这正是本任务要的不对称**：四足不变是硬约束，猫娘没接上才算红。改回。
4. **池子被写死成 `GESTURE_IDS`**：`gestureIds()` 改成 `return [...GESTURE_IDS];` → `motion.test.ts` 的「与 allClips() 现算一致」红（18 ≠ 9）。这条牙在 Task 21 补完 9 条之后仍要有用：那时它仍比 `allClips()`，红的原因是「顺序/内容不符」而不是条数——**别把断言写成条数**（上面写的是 `toEqual(fromClips)` 与 `[...].sort()`，两条都跟条数无关）。改回。

- [ ] **Step 10: 台账 + 提交**

`docs/verge/notes/progress.md`（Task 8 已创建；不存在就按 Task 8 Step 5 的文件头格式补建）追加两条：

- **口径差⑬（粒子不是第四层 `MotionLayer`）**：spec §5 的清单把 `particle: heart stars zzz sweat tear note` 与 body/gesture/face 并排列出，读起来像第四层。实现里 `MotionLayer` 保持三档（`"body" | "gesture" | "face"`，Task 12 定义）：`sweat/tear/star` 今天已在 `FaceParams`（Task 9 的 12 通道之一），`heart/zzz/quiet_mark/badge/capsule/unread` 由 Task 5 的 `buildOverlayOps(o, badgeMap)` 画——它们**不吃骨架**，进 `MotionLayer` 反而要给不吃通道的层配一套 `Channels`。`note` 按 spec `:228` 的括注延后。所以本期的「四层并发」＝三层 clip ＋ 一批由 face 参数与 overlay 记号承载的粒子；判据不变（同一层内新片顶旧片、不同层并发），只是层的**数量**是三不是四。
- **口径差⑭（加权表按 form 作用域，`IDLE_ACTIVITIES` 不退役）**：spec §5 写「取代 `IDLE_ACTIVITIES` 的 7 行平表」。实现是**新增** `pickRoll` 并让 `stepIdle` 按 `form` 分派，四足继续吃 `IDLE_ACTIVITIES`+`pickIdleActivity`（R-D2 要求 P1–P4 全程四足行为逐字节不变，而 `companion.test.ts:57-85` 那两条 `it` 是按那张表算的区间写的）。代价：本期结束时两形态各有一张闲置表，Task 28 把这条写回 spec 时应写明「四足表退役另计一期」。

```bash
cd /d/Test/workbuddy/cyrene-verge
git status --short        # 只该有 4 个 M：motion.ts / companion.ts / motion.test.ts / companion.test.ts（+ 台账 ??/M）
git diff --numstat        # companion.ts 的删除行数该接近 0：本任务是追加，不是重写
git add src/renderer/pet/motion.ts src/renderer/pet/companion.ts \
  src/renderer/pet/motion.test.ts src/renderer/pet/companion.test.ts \
  docs/verge/notes/progress.md
git commit -m "$(cat <<'EOF'
feat(pet): 猫娘四档加权永不停轮 pickRoll（v1.5.0 Task 19）

10/5/5/80 两签抽取：待机微动自己占一档，什么都不做也算一次结果。
手势池由 CLIPS 现算而不是抄 GESTURE_IDS——Task 21 补片之后池子自动长大，
抽到未注册名会抛，那种哑火不该活到运行期。

四足的 IDLE_ACTIVITIES 七行平表一字未动：form 分派只在 stepIdle 顶部多一个
return，八条猫表对照测试仍绿才叫 R-D2。粒子仍不是第四层（口径差⑬），
闲置表暂时两张并存（口径差⑭）。
EOF
)"
```

---

## Task 20: 仲裁——物理最高、workStatus 接管 body、干活时不投身体/手势

spec §5 的仲裁三句（`:251-254`）：`工作中`／`提醒` 期间随机池只许投 `face` 与 `particle`；物理层永远最高，「被扔出去的时候什么都得停下」。本期 face 层不由抽取产生（差分表 + TTL 自己走），粒子由 face 参数与 overlay 承载（口径差⑬），所以「只许投 face 与 particle」在实现里等价于**这两档期内不投身体也不投手势**。

本任务还补一条 Task 19 留下的接线洞：Task 19 给引擎加了 `form` 字段与 `setForm()`，但 `PixelPetRenderer.setForm()`（Task 14 的 `:3186`）只改渲染端的 `this.form`/`this.cat.form`，**没有转给引擎**——生产里猫娘永远走四足那张平表，`pickRoll` 只在单测里活着。这条与档位转发（`setWorkTier`）同属「renderer → 引擎」的两条下行，放在本任务一起收，两条各带一条断言。

**Files:**
- Modify: `src/renderer/pet/companion.ts`（`PHYSICS_ACTIVITIES`/`BLOCKING_TIERS` 两条表、`setWorkTier`、`stepIdleGirl` 顶部闸门、`beginDrag` 清 ambient、`CompanionSnapshot.physics`）
- Modify: `src/renderer/pet/renderer.ts`（`setForm` 转发形态与档位、`syncWorkStatus` 顶部转发档位、`tickSlots` 的三档优先级、`gestureSlotFor` 的 ambient 分支、`ambientGesture` 字段）
- Test: `src/renderer/pet/companion.test.ts`（追加「仲裁」describe，复用 Task 19 Step 7 的 `rolling()`/`FILL` 与文件顶部现成的 `ctx`）
- Test: `src/renderer/pet/companion-renderer.test.ts`（追加「三层优先级」describe——**不是** `renderer.test.ts`：本任务的判据全是「引擎抽到 ↔ 槽位演出」的接线，那个文件的既有 8 条测的就是这条缝，harness `makeCompanionRenderer(clock, extra)`（`:57`）把 `extra` 原样摊进构造选项（`:74`），`companionOverrides` 塞进去就行——只需给 `extra` 的入参类型补一个字段（`:59`，Step 4 开头那三行）。**零搬家、零新 harness**）

**Interfaces:**
- Consumes:
  - `WORK_STATUS_TIERS`/`type WorkStatusTier`——**已经在 `src/shared/work-status-types.ts`**（Task 16 Step 3 建，`:4223` 起那四个符号；`src/main/pet/work-status.ts` 从那里 import）。本任务**不搬家、不新建类型文件**：`companion.ts` 直接 `import { type WorkStatusTier } from "../../shared/work-status-types"`。
  - Task 19 的 `CompanionSnapshot.gesture`、`CompanionEngine.setForm()`、`forceIdleRoll(context, options)` 与 Step 7 注释里那张签子消耗表（本任务的引擎用例照那张表排签）
  - Task 18 的 `presentationOf(tier)`（`工作中` → `body: "sit"`、`holdGesture: "typeCode"`）、`bodyOverride`、`holdWanted`、`syncWorkStatus(now)`、`setWorkStatus(status, origin)`
  - Task 14 的 `slotFor`/`gestureSlotFor`/`tickSlots`、`ACTIVITY_BODY`（`drag → "drag"`）、`ACTIVITY_GESTURE`、`companionOverrides`、`playGesture`/`stopGesture`
  - `companion-renderer.test.ts` 的模块作用域件：`makeCompanionRenderer(clock, extra)`（`:57-76`，内含 `window.localStorage.clear()`）、`advance(loop, clock, frames)`（`:79`，250ms/帧）、`waMain`（`:54`）、`home`（`:55`）、文件级 `afterEach`（`:85`）——**`renderer.test.ts` 的 `advance` 在它的 describe 里（`:248`），跨文件用不到，别去引**
  - `companion.ts:425 beginDrag(now = this.now())` / `:436 endDrag(position, velocity, now)`（两条都不从 `random()` 取签，Step 0 的第四条 grep 就是核对这句）；`renderer.ts:260 beginDrag()` / `:286 endDrag(position: Point | null, velocity = { x: 0, y: 0 })`（`velocity` 有默认值，测试里 `r.endDrag(null)` 就是「原地放下」）
  - `companion.ts:36-38`（`IDLE_MIN_MS = 5_000`、`IDLE_SPAN_MS = 4_000`、`CHAT_MIN_MS = 35_000`；`CHAT_SPAN_MS` 在 `:39`）——renderer 用例的排帧数与取样窗口都从这三个数算出来，见 Step 4 的 `FIRST_ROLL` 注释
  - `renderer.ts:373 canRoam()`（`:376` 那条 `bubbleActive || bubbleExpand > 0.001` 一转假，闲置签被一路推后）
- Produces:
  - `const PHYSICS_ACTIVITIES: ReadonlySet<CompanionActivity>`＝`new Set(["drag", "thrown"])`（`companion.ts` 导出）
  - `const BLOCKING_TIERS: ReadonlySet<WorkStatusTier>`＝`new Set<WorkStatusTier>(["工作中", "提醒"])`（`companion.ts` 导出；只有这两档挡抽取）
  - `CompanionEngine.setWorkTier(tier: WorkStatusTier | null): void`
  - `CompanionSnapshot.physics: boolean`
  - renderer 私有字段 `ambientGesture: { id: string; clip: Clip; startedAt: number } | null`
  - **不新增任何公开口**：三层槽的观测量走 `renderer.test.ts`/`companion-renderer.test.ts` 从 Task 14 起就在用的 cast 读私有字段（`(r as unknown as { slots: … }).slots`），形态与档位的注入走已有的 `setForm`/`setWorkStatus`/`beginDrag`/`endDrag`。理由见 Step 6 末尾——测试缺的是**观测量**，不是生产 API。

- [ ] **Step 0: grep 复核（这一步不动代码，只把六条前提坐实）**

这些 grep 在 **Task 19 落地之后**跑（本期写计划时它们全是 0 命中：`work-status-types.ts`、`bodyOverride`、`setForm` 都还不存在）。跑出来对不上，就是前面的任务没按各自的 Produces 落地——回来改那一站，不要在本任务里绕过去。

```bash
cd /d/Test/workbuddy/cyrene-verge
grep -rn "export const WORK_STATUS_TIERS\|export type WorkStatusTier" src/shared src/main src/renderer
grep -n "beginDrag\|endDrag\|\"drag\"\|\"thrown\"" src/renderer/pet/companion.ts
grep -n "explicitGesture\|bodyOverride\|holdWanted\|priority === 3\|setForm(form" src/renderer/pet/renderer.ts
grep -n "function makeCompanionRenderer\|^function advance\|localStorage.clear" src/renderer/pet/companion-renderer.test.ts
grep -n "expect(.*getCompanionSnapshot().*toEqual" src/renderer/pet/companion-renderer.test.ts
grep -n "extra: { onWindowGeometry" src/renderer/pet/companion-renderer.test.ts
CI=true npx vitest run src/renderer/pet/companion.test.ts src/renderer/pet/companion-renderer.test.ts
```

期望（逐条对，不对就先修认知再动代码）：

1. 第一条只命中 `src/shared/work-status-types.ts` 的定义处；`src/main/pet/work-status.ts`、`work-status-ipc.ts`、`src/renderer/pet/work-status-presentation.ts` 都是 **import**。这证伪了本任务最初写的「把 tier 类型从 main 下沉到 shared」——那一步因此删掉，本任务一个类型文件都不新建（记进 Step 8 的台账，属计划侧修正而不是口径差）。
2. 第二条里 `beginDrag` 与 `endDrag` 的函数体**没有** `this.random()`；若出现了，Step 1 的序列全要重排（消耗表在 Task 19 Step 7 的注释里）。
3. 第三条给出 `tickSlots`、`gestureSlotFor`、`setForm` 的改点行号；`setForm` 那一段里**没有** `engine?.setForm`——接线洞的现场证据，Step 6 的②补它。
4. 第四条三处都在**模块作用域**（`makeCompanionRenderer` 在 `:57`、`advance` 在 `:79`、`localStorage.clear()` 在 `:70`）。`localStorage.clear()` 是本任务敢用 `random: () => 0.5` 的前提：引擎的 vitals 存在盘上，不清就是「上一条用例剩下的精力」，而 `energy < 0.25` 会改写加权表的两个系数。
5. 第五条期望**恰好 1 处**、且必须逐条读它：现场是 `:106` 的 `expect(r.getCompanionSnapshot()?.pos).toEqual({ x: 1200, y: 400 })`——比的是 `pos` **子对象**，不是整张快照，所以新增 `physics` 字段动不到它。**这条是「加字段安全」的证据，不是可省的仪式**：命中里只要出现 `toEqual({ pos:…, activity:… })` 这种整对象比较，就得先把它改成逐字段断言再加字段（写计划时实测过本文件没有整对象比较，落地时要以当场读数为准）。
6. 第六条期望 **1 处**（`:59`）：`extra` 的入参类型只认 `onWindowGeometry`。Step 4 要往里加 `companionOverrides`——这是**测试文件自己的一行类型 widen**，生产构造选项由 Task 14 开好，实现侧一行不动。别把它记成「零改动」。
7. 第七条先全绿，并记下 `companion-renderer.test.ts` 当前的 `it` 数（写计划时 `grep -c '^  it('` ＝ 8，Task 14/18 落地后按实际数记）——Step 7 的「＋6 条」拿它当基线。

- [ ] **Step 1: 写失败测试（引擎闸门）**

`src/renderer/pet/companion.test.ts` 追加。`rolling()`/`FILL` 是 Task 19 Step 7 在同一文件里定义好的，`ctx`/`seq()`/`makeStorage()`/`T0` 是文件顶部现成的（`:10-29`）；签子序列照 Step 7 注释里那张消耗表排，**被闸门挡下的那轮只吃 `idleDelay()` 那 1 支**——所以下面每条被挡序列都比放行序列少一支。

```ts
import { BLOCKING_TIERS, PHYSICS_ACTIVITIES } from "./companion";   // 并进 :2-9 那条已有的 `./companion` import
import { WORK_STATUS_TIERS } from "../../shared/work-status-types";  // 判据用原词，不在测试里再抄一遍中文档位名

describe("仲裁：工作中/提醒 不投身体也不投手势", () => {
  it("两条表本身就是判据：六档里只有 工作中/提醒 挡，物理只有 drag/thrown", () => {
    expect(BLOCKING_TIERS.size).toBe(2);
    for (const tier of WORK_STATUS_TIERS) {
      expect(BLOCKING_TIERS.has(tier), tier).toBe(tier === "工作中" || tier === "提醒");
    }
    expect([...PHYSICS_ACTIVITIES].sort()).toEqual(["drag", "thrown"]);
  });

  it("工作中：这一轮整轮不跑；解除之后照抽（不是一直不抽）", () => {
    // 第 3 支被闸门的 idleDelay 吃掉，所以放行那签要排在第 4、5 位。
    const engine = rolling("girl", [FILL, 0.50, 0.10]);
    engine.setWorkTier("工作中");
    engine.forceIdleRoll(ctx);
    expect(engine.getSnapshot().gesture).toBeNull();
    expect(engine.getSnapshot().activity).toBe("idle");
    engine.setWorkTier(null);
    engine.forceIdleRoll(ctx);
    expect(gestureIds()).toContain(engine.getSnapshot().gesture as string);
  });

  it("提醒 也挡；思考中 不挡（它只借手势层歪头，身体仍在动）", () => {
    const blocked = rolling("girl", [FILL, 0.12]);
    blocked.setWorkTier("提醒");
    blocked.forceIdleRoll(ctx);
    expect(blocked.getSnapshot().gesture).toBeNull();

    const open = rolling("girl", [0.12]);
    open.setWorkTier("思考中");
    open.forceIdleRoll(ctx);
    expect(open.getSnapshot().gesture).toBe("peek");
  });

  it("闸门不许攒：被挡下的那一轮照样推 idleUntil——计数 RNG 证明它只吃了一支签", () => {
    let draws = 0;
    const engine = new CompanionEngine({
      storage: makeStorage(),
      random: () => {
        draws += 1;
        // 1、2＝构造器两支；3＝闸门里那次 idleDelay()；4 起才是解除后的行为签。
        return draws >= 4 ? 0.12 : FILL;
      },
      now: () => T0,
      wallNow: () => new Date(2026, 9, 24, 13, 0, 0).getTime(),
    });
    engine.setForm("girl");
    engine.setPosition({ x: 200, y: 400 });
    engine.setWorkTier("工作中");
    engine.forceIdleRoll(ctx);
    expect(draws, "闸门挡下的那一轮必须恰好只推一次闲置延迟：吃 0 支＝没推（下一帧立刻补投，攒出一串），吃 2 支＝投了签又被咽掉").toBe(3);
    expect(engine.getSnapshot().gesture).toBeNull();
    engine.setWorkTier(null);
    engine.forceIdleRoll(ctx);
    expect(engine.getSnapshot().gesture).toBe("peek");   // 正对照：解除后第一签就落地，不是永远沉默
  });

  it("beginDrag 把 ambient 手势当场收掉，physics 转真；落地后 physics 转假", () => {
    const engine = rolling("girl", [0.12]);
    engine.forceIdleRoll(ctx);
    expect(engine.getSnapshot().gesture).toBe("peek");
    engine.beginDrag();
    expect(engine.getSnapshot().physics).toBe(true);
    expect(engine.getSnapshot().gesture).toBeNull();
    engine.endDrag({ x: 200, y: 400 }, { x: 0, y: 0 });   // 速度 0＝原地放下，不进投掷
    expect(engine.getSnapshot().physics).toBe(false);
  });
});
```

第 1 条为什么逐档 `has` 而不是只比 size 或比一份写死的中文字面量数组：size 2 ＋「换一档也照样绿」是同一件事——把 `已处理` 塞进 `BLOCKING_TIERS`、把 `提醒` 摘掉，size 那条一声不响，逐档这条会点名是哪一档红了。档位名一律从 `WORK_STATUS_TIERS` 取原词，测试里不重抄一遍中文（`feedback-doc-citations-must-be-grepped` 的同一戒律：抄出来的第二份会跟着改表一起过期）。

- [ ] **Step 2: 跑红**

Run: `CI=true npx vitest run src/renderer/pet/companion.test.ts`
Expected：新增 **5** 条 FAIL，红因是 `BLOCKING_TIERS`/`PHYSICS_ACTIVITIES` 为 `undefined`、`engine.setWorkTier is not a function`、`physics` 恒 `undefined`（TS 报「快照上没有 physics」也算，但要能看出是「东西还没有」）。Task 19 那 6 条与原有 18 条仍 PASS。

- [ ] **Step 3: 实现引擎侧**

`src/renderer/pet/companion.ts`：

```ts
// import 头（文件已有 ../../shared/… 的相对路径写法）：
import { type WorkStatusTier } from "../../shared/work-status-types";

// IDLE_ACTIVITIES 之前（:100 那行上面）追加两条表：
/** 物理档：被拎起 / 被甩出。仲裁里永远最高（spec :253「被扔出去的时候什么都得停下」）。 */
export const PHYSICS_ACTIVITIES: ReadonlySet<CompanionActivity> = new Set<CompanionActivity>(["drag", "thrown"]);

/** 只挡身体层与手势层的抽取。face/particle 不在此列：表情照差分表与 TTL 自己走。 */
export const BLOCKING_TIERS: ReadonlySet<WorkStatusTier> = new Set<WorkStatusTier>(["工作中", "提醒"]);

// 字段区（Task 19 新增的 form/ambientGesture 旁边）：
  private workTier: WorkStatusTier | null = null;

// 公开口（setForm 之后）：
  /**
   * 工作状态档转给行为引擎（renderer 在 syncWorkStatus 与 setForm 里调）。
   * null＝没有档；不挡的档也照样写进来——挡不挡由 BLOCKING_TIERS 说话，不由调用方记条件。
   */
  setWorkTier(tier: WorkStatusTier | null): void {
    this.workTier = tier;
  }

// getSnapshot 返回对象里（挨着 Task 19 的 gesture）＋ CompanionSnapshot 里同处：
      physics: PHYSICS_ACTIVITIES.has(this.activity),
  // …
  /** true＝正在被拎/被甩。renderer 见到它就让物理独占身体与手势两层。 */
  physics: boolean;

// beginDrag 顶部（:426 那行 this.activity = "drag" 之前）：
    // 物理最高：ambient 手势当场收掉，否则「拎起来还在打字」会在落地后再挂一整轮。
    this.ambientGesture = null;
    this.gestureUntil = 0;

// stepIdleGirl 第一行之前（闸门必须在 pickRoll 之前——见 Step 1 的计数断言）：
    // 工作中/提醒：不投身体也不投手势。闲置计时照推——闸门不许「攒」出一串小动作。
    if (this.workTier && BLOCKING_TIERS.has(this.workTier)) {
      this.idleUntil = now + this.idleDelay();
      return;
    }
```

Run: `CI=true npx vitest run src/renderer/pet/companion.test.ts` → 新增 5 条 PASS，Task 19 的 6 条与原有 18 条仍 PASS。

- [ ] **Step 4: 写失败测试（renderer 三层优先级 + 两条下行转发）**

`src/renderer/pet/companion-renderer.test.ts` 追加。**一条 `it` 只造一台渲染器**：`makeLoopDriver()` 每次都重装全局 `requestAnimationFrame` 桩（`:33-52`），同一台里再造第二台会让先建那台的重排回调落进后一台的 pending 表——那是要命的假绿来源，所以下面把「girl 接通」与「cat 对照」拆成两条而不是并在一条里。

先给现成的 `makeCompanionRenderer`  widen 一行类型（`:57-59`）——它的 `extra` 目前只认 `onWindowGeometry`，而本任务的确定性全靠把 RNG 与挂钟塞进引擎：

```ts
function makeCompanionRenderer(
  clock: { ms: number },
  extra: { onWindowGeometry?: () => void; companionOverrides?: { random?: () => number; wallNow?: () => number } } = {},
) {
```

字段名与形状照 Task 14 开在 `PixelPetRendererOptions` 上的那个口子（`companionOverrides?: { random?: () => number; wallNow?: () => number }`，plan Task 14 的 Produces 第 5 行），`...extra` 那行（`:74`）本来就直接摊进构造选项，实现侧一行都不用改。

```ts
import { gestureClip, gestureIds } from "./motion";

describe("三层优先级：物理 > workStatus > activity (Task 20)", () => {
  type SlotView = {
    slots: Partial<Record<"body" | "gesture", { clip: { id: string; priority: number } }>>;
    gestureProgress: number | null;
  };
  const bodyId = (v: SlotView) => v.slots.body?.clip.id ?? null;
  const gestureId = (v: SlotView) => v.slots.gesture?.clip.id ?? null;

  /**
   * 排帧数不是随手圈的，两个数都来自常量：
   *   `random: () => 0.5` 时 `idleDelay()` = IDLE_MIN_MS 5000 + 0.5×IDLE_SPAN_MS 4000 = **7000**
   *     （companion.ts:36-37/:504）→ 第一签在起点 +7000 那一帧落地；
   *   抽中的片由 `pickRoll` 自己的公式算出来（`Math.floor(0.5 × 池长)`），当前是 `shake`，
   *   一次性 1800ms（Task 13 注册表）→ 可观察窗只剩 [7000, 8800)。
   * 30 帧＝7500ms 落在窗内；**40 帧（10s）就过期了**——那时 `gestureUntil > now` 不成立，
   * 读回来是 null，看着像闸门坏了。另一半口径：窗口必须留在 `CHAT_MIN_MS = 35_000`（:38）以内，
   * 聊天气泡一点亮 `canRoam()` 就转假（`bubbleActive` 那条在 renderer.ts:376，`canRoam()` 定义在 :373），闲置签被一路推后。
   */
  const FIRST_ROLL = 30;

  /** 本帧该被抽中的那条：照 `pickRoll` 的公式现算，**不写下标数字**——Task 21 把池从 9 补到 18，写死的 `[4]` 会静默指向另一条片。 */
  const pickedGesture = () => gestureIds()[Math.floor(0.5 * gestureIds().length)];

  /**
   * 挂钟给**本地**正午：`new Date(2026, 9, 24, 13)` 而不是 `Date.UTC(…, 13)`——后者在 +08:00
   * 机器上读到 21 点、+09:00 读到夜里，而夜里 `pickRoll` 的 gesture×0.8／move×0.45 会改总重，
   * 「0.5 落在哪一档」就随时区变了。`window.localStorage.clear()` 由 harness 自己做了（`:70`），
   * 这是敢用固定 RNG 的前提：盘上残留的 `energy < 0.25` 同样会改写那两个系数。
   */
  async function girlRenderer(random: () => number) {
    const clock = { ms: 10_000 };
    const { loop, r } = makeCompanionRenderer(clock, {
      companionOverrides: { random, wallNow: () => new Date(2026, 9, 24, 13, 0, 0).getTime() },
    });
    await r.init();
    r.syncGeometry({ bounds: { ...home, width: 82, height: 108 }, workArea: waMain, tuckEnabled: false, tuckHinted: true, tuckLimit: 6 });
    return { loop, clock, r, view: r as unknown as SlotView };
  }

  it("形态下行接通引擎：girl 抽到的自主手势进槽（补 Task 19 的接线洞）", async () => {
    const { loop, clock, r, view } = await girlRenderer(() => 0.5);
    r.setForm("girl");
    advance(loop, clock, FIRST_ROLL);
    const expected = pickedGesture();
    expect(r.getCompanionSnapshot()?.gesture).toBe(expected);
    expect(gestureId(view)).toBe(expected);                     // 引擎→槽位这条链真接通了
    expect(gestureClip(expected).lasting, "连播那条判据靠它是一次性片（1800ms 量级）").toBeUndefined();
    r.dispose();
  });

  it("对照：没切形态的那台（缺省 cat）永远不写 gesture、四层槽全空", async () => {
    const { loop, clock, r, view } = await girlRenderer(() => 0.5);
    advance(loop, clock, FIRST_ROLL);
    expect(r.getCompanionSnapshot()?.gesture).toBeNull();
    expect(gestureId(view)).toBeNull();
    expect(bodyId(view)).toBeNull();                            // 四足路径根本不进 tickSlots
    r.dispose();
  });

  it("工作中：body 被 workStatus 接管成 sit，自主抽取整轮不跑，hold 的 typeCode 还在", async () => {
    const { loop, clock, r, view } = await girlRenderer(() => 0.5);
    r.setForm("girl");
    r.setWorkStatus({ tier: "工作中", source: "agent", since: clock.ms, detail: "读取文件" });
    advance(loop, clock, FIRST_ROLL);
    expect(bodyId(view)).toBe("sit");
    expect(gestureId(view)).toBe("typeCode");
    expect(r.getCompanionSnapshot()?.gesture).toBeNull();                          // 闸门由引擎侧把关，这里是端到端证据
    r.dispose();
  });

  it("物理压过 workStatus：拎起来 body=drag、手势槽清空；落地后 sit 与 typeCode 都回来", async () => {
    const { loop, clock, r, view } = await girlRenderer(() => 0.5);
    r.setForm("girl");
    r.setWorkStatus({ tier: "工作中", source: "agent", since: clock.ms, detail: "读取文件" });
    advance(loop, clock, 4);
    expect(bodyId(view)).toBe("sit");
    r.beginDrag();
    advance(loop, clock, 1);
    expect(r.getCompanionSnapshot()?.physics).toBe(true);
    expect(bodyId(view)).toBe("drag");
    expect(gestureId(view)).toBeNull();                          // 两只手跟着身子甩，不许还在打字
    r.endDrag(null);                                             // velocity 缺省 {0,0}＝原地放下
    advance(loop, clock, 2);
    expect(r.getCompanionSnapshot()?.physics).toBe(false);
    expect(bodyId(view)).toBe("sit");                            // workStatus 的接管要回得来
    expect(gestureId(view)).toBe("typeCode");                    // tickSlots 的复装在同一 tick 内决定
    r.dispose();
  });

  it("同一支 ambient 连播时槽位钟不许回零：id 没变就不重放", async () => {
    const { loop, clock, r, view } = await girlRenderer(() => 0.5);
    r.setForm("girl");
    advance(loop, clock, FIRST_ROLL);
    const id = r.getCompanionSnapshot()?.gesture;
    expect(id, "前置条件：抽到的就是预期那条，不然下面全在量空气").toBe(pickedGesture());
    const seen: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      advance(loop, clock, 1);
      expect(gestureId(view), "同一条片连播四帧，中途换片就是抽取被重复触发").toBe(id);
      seen.push(view.gestureProgress!);
    }
    // 1800ms 的一次性片，四帧 1s：p 必须单调爬升。每帧重设 startedAt 会把它钉在 250/1800 不动。
    expect(seen[0]!).toBeGreaterThan(0);
    for (let i = 1; i < seen.length; i += 1) expect(seen[i]!).toBeGreaterThan(seen[i - 1]!);
    expect(seen[3]!).toBeLessThan(1);
    r.dispose();
  });

  it("切回猫形把 ambient 与三层槽一起收干净（猫娘的手势不许在切回来的瞬间自己演一遍）", async () => {
    const { loop, clock, r, view } = await girlRenderer(() => 0.5);
    r.setForm("girl");
    advance(loop, clock, FIRST_ROLL);
    expect(typeof r.getCompanionSnapshot()?.gesture).toBe("string");
    r.setForm("cat");                                            // Task 19：引擎侧 setForm 清 ambient
    advance(loop, clock, 1);
    expect(r.getCompanionSnapshot()?.gesture).toBeNull();
    expect(gestureId(view)).toBeNull();
    expect(Object.keys((r as unknown as { cat: { channels: Record<string, number> } }).cat.channels)).toHaveLength(0);
    r.dispose();
  });
});
```

第 1 条里 `gestureClip(expected).lasting` 断言的是 `undefined` 而不是 `false`——Task 13 的注册表只给 lasting 片写 `lasting: true`，一次性片压根没这个键（`shake` 那条的原文照抄：`{ id: "shake", ms: 1_800, tracks: … }`）。写成 `toBe(false)` 会红，而且红得像是注册表坏了；这条断言的真实作用是**把「可观察窗只有 1800ms」这个前提钉进测试**，谁哪天把被抽中的那条改成 lasting，第 1 条先红、第 5 条跟着红，而不是让第 5 条在某个偶然的排帧数下悄悄变绿。`pickedGesture()` 现算而不是写下标，是 Task 21 把池从 9 补到 18 之后仍成立的前提（补完时 18 条字典序里 `0.5×18=9` 恰好还是 `shake`，但**这个巧合不许被当成判据**——池再变一次，写死的下标就指向另一条片）。

- [ ] **Step 5: 跑红**

Run: `CI=true npx vitest run src/renderer/pet/companion-renderer.test.ts`
Expected：新增 **6** 条 FAIL——第 1/3/4/5/6 条红在 `getCompanionSnapshot()?.gesture` 恒 `undefined` 或 `physics` 恒 `undefined`（`setForm` 没转给引擎、`ambientGesture` 分支还没接），第 3 条还红在 `bodyId` 读到 `stand` 而不是 `sit` 之外的组合上（Task 18 已把 `bodyOverride` 接进 `tickSlots`，所以这条的 `sit` 该已经绿，真正红的是 `gesture` 恒有值＝闸门未端到端生效）。**第 2 条应当已经绿**——它断言的是「什么都没发生」，接线之前本来就什么都没发生；这条是对照，不是验收。若第 2 条红，先查 `ACTIVITY_BODY`/`ACTIVITY_GESTURE` 是不是在 cat 形也被读了（那是 Task 14 的分派问题，回来修它）。

- [ ] **Step 6: 实现 renderer 侧**

`src/renderer/pet/renderer.ts` 五处，逐处都只加不减：

```ts
// ① 字段（Task 18 的 bodyOverride 旁边）：
  /** 引擎抽到的自主手势在本地的槽位。id 不变就不重放（同一支签会被多帧看到）。 */
  private ambientGesture: { id: string; clip: Clip; startedAt: number } | null = null;

// ② setForm 里（Task 14 的 :3186 那段，紧挨 this.slots = {} 那几行）补两条下行＋一处本地清理：
    this.engine?.setForm(form);
    // 形态与档位是两条独立的下行：切形态时要把**当前档**重发给引擎，
    // 否则「工作中」期间从猫形切到猫娘，引擎手里还是旧的 null 档，闸门开着一整轮。
    this.engine?.setWorkTier(this.workStatus?.tier ?? null);
    this.ambientGesture = null;      // 与本方法已有的 slots/explicitGesture 清理同一口径

// ③ syncWorkStatus 顶部（早于 `if (this.form !== "girl") return;`，也早于 tier 边沿判据）：
    // 转发档位：闸门判的是「现在这一档挡不挡抽取」，与「档有没有变」「什么形态」都无关。
    // 挂在边沿上只投一次的话，四足形期间到达的档位会被 form 闸吞掉，切回猫娘时引擎还拿着旧档。
    this.engine?.setWorkTier(this.workStatus?.tier ?? null);

// ④ tickSlots：整体替换 Task 18 的那一个方法（plan Task 18 末段 `private tickSlots(now, snapshot)` 那 20 行），
//    身体档改成显式三档——物理来了谁都得让开：
  private tickSlots(now: number, snapshot: CompanionSnapshot): Slots {
    const out: Slots = {};
    const activityBody = ACTIVITY_BODY[snapshot.activity];
    // 物理（drag/thrown，priority 3）永远最高：它自己就是 body 槽的片。workStatus 的接管要让开，
    // 否则「被扔出去」时 wanted 还是 sit，槽位得等 drag 跑完才换（slotFor 换片即重计时）。
    const wanted = snapshot.physics ? activityBody : (this.bodyOverride ?? activityBody);
    const body = this.slotFor("body", wanted, now, snapshot);
    if (body) out.body = body;
    // 两处判据不是重复：`snapshot.physics` 决定「这一档想要哪片」，`priority === 3` 决定
    // 「身体层已被物理占住、手势层得让开」。前者是主端口径，后者读的是实际排上的片——
    // 换片那一帧两者会错开一帧，用后者把关手势层才不会在 drag 还没进槽时就复装 typeCode。
    if (out.body && out.body.clip.priority === 3) {
      this.explicitGesture = null;
      this.ambientGesture = null;        // ambient 也一起收：被拎起来时手不许还在演抽到的那一下
      delete this.slots.gesture;
    } else {
      // lasting 手势被打断/放完之后由这里复装：一次 tick 内决定，不留第二帧的空窗。
      if (this.holdWanted && !this.explicitGesture) this.playGesture(this.holdWanted, now);
      const gesture = this.gestureSlotFor(now, snapshot);
      if (gesture) out.gesture = gesture;
    }
    this.gestureProgress = out.gesture ? out.gesture.p : null;
    return out;                 // face 层的槽位本期恒空：表情走 Expression 差分表，不走通道
  }

// ⑤ gestureSlotFor：ambient 插在 explicitGesture 那段之后、Task 14 的最后一行
//    `return this.slotFor("gesture", ACTIVITY_GESTURE[snapshot.activity] ?? null, now, snapshot);` 之前，
//    只在 id 变化时重放：
    if (snapshot.gesture) {
      if (this.ambientGesture?.id !== snapshot.gesture) {
        this.ambientGesture = { id: snapshot.gesture, clip: gestureClip(snapshot.gesture), startedAt: now };
      }
      const elapsed = (now - this.ambientGesture.startedAt) / this.ambientGesture.clip.ms;
      if (elapsed >= 1 && !this.ambientGesture.clip.lasting) this.ambientGesture = null;
      else return { clip: this.ambientGesture.clip, p: Math.min(1, elapsed) };
    } else {
      this.ambientGesture = null;
    }
```

**这段不许「到期重排」**：引擎侧 `gesture` 的清空条件是 `gestureUntil > now`，而 `gestureUntil = 抽取那一帧的 now + gestureClip(id).ms`（Task 19 Step 6），本地的 `startedAt` 就是同一帧的 `now`——两头读同一个 `performance.now()`、同一个 `ms`，所以引擎的 `gesture` 转 null 不会晚于本地 `elapsed >= 1`。真让它晚一帧（例如哪天 `now` 换成了 rAF 时间戳而引擎仍读 `performance.now()`），⑤的过期分支会立刻被下一帧的同一个 id 重建，`shake` 就在人身上抖个不停。这条不对称留给 Step 8 变异 3 兜住：它测的是「回零」，同源的第二发故障是「重放」，两者都被单调爬升那条断言拦下。

import 头补 `gestureClip`（并进 Task 14 那条 `./motion` import）；`Clip` 类型若还没引，一并引——①那段字段类型要用。

Task 18 的 `tickSlots` 里那句 `this.slotFor("body", this.bodyOverride ?? ACTIVITY_BODY[snapshot.activity], …)` 就是④要替换的那一行；替换时把 Task 18 写在 `physics` 分支里的复装判据一起带过来（`holdWanted` 那条 `else` 分支是它的原样），别把两段各留一半。

**为什么测试不新增 `pushAmbientGesture` 这类生产窄口**：`snapshot` 由 `engine.update()` 在 `tickCompanion` 里产生，renderer 无权改；要给 renderer 喂一条 ambient，要么在引擎上开一个「直接指定手势」的公开口（生产永不调用），要么在 renderer 上再开一条私有通路的转发。两条都是把测试的形状长进生产代码。本任务改成把 RNG 钉在 `0.5`（定档与池内抽签各取一个确定值），走 `setForm`/`setWorkStatus`/`beginDrag`/`endDrag` 这些**已经存在**的公开口，观测量则用从 Task 14 起就在用的 cast 读 `slots`/`gestureProgress`。代价是测试要背那张签子消耗表（Step 1 已背）与那三个时间常量（Step 4 已写在注释里）；收益是生产 API 面零增长，且第 1、3 条断言天然是端到端而不是「喂进去什么就吐出什么」。

- [ ] **Step 7: 跑绿与门**

Run: `CI=true npx vitest run src/renderer/pet/companion.test.ts src/renderer/pet/companion-renderer.test.ts` → 全绿：`companion.test.ts` 是 Step 0 记的基线 ＋ 5 条，`companion-renderer.test.ts` 是基线 ＋ 6 条。
Run: `npm run check:renderer && npm run check:main && npm run check:preload` → 绿。

- [ ] **Step 8: 变异验牙（四条，逐条做完立刻还原）**

1. **闸门被摘**：删掉 `stepIdleGirl` 顶部那段 `if (this.workTier && …)` → 「工作中整轮不跑」「提醒也挡」两条红；计数那条红在 `draws` 变成 4（挡不挡都投签），报错信息里那句「吃 0 支/吃 2 支」就是给这条变异写的判读。跑 `CI=true npx vitest run src/renderer/pet/companion.test.ts`，改回。
2. **物理让位给 workStatus**：`tickSlots` 里 `const wanted = snapshot.physics ? activityBody : (…)` 改成 `const wanted = this.bodyOverride ?? activityBody` → 「物理压过 workStatus」的 `toBe("drag")` 红（读到 `sit`）。改回。
3. **ambient 每帧重放**：删掉 `if (this.ambientGesture?.id !== snapshot.gesture)` 的条件（每帧都重设 `startedAt`）→ 「槽位钟不许回零」的单调爬升红（四帧全钉在 `250/1800`）。这条防的是「一次性片永远停在开头」，是真会犯的错。改回。
4. **形态下行未接**：把②里 `this.engine?.setForm(form)` 删掉 → 第 1 条的 `expect(r.getCompanionSnapshot()?.gesture).toBe(expected)` 红（引擎一直按 cat 抽，`gesture` 恒 null），而第 2 条「cat 对照」与第 6 条「切回猫形」仍绿——**这个不对称是故意的**：它证明第 1 条测的是「接通」而不是「猫娘会抽」，把接线删掉不会有第二条替它喊疼。改回。

- [ ] **Step 9: 台账 + 提交**

`docs/verge/notes/progress.md` 追加三条：

- **计划侧修正（不是口径差）**：本任务最初写的是「把 `WorkStatusTier` 等四个类型符号从 `src/main/pet/work-status.ts` 下沉到 `src/shared/work-status.ts`」，并附一步「把 Task 14 的 harness 上移到模块作用域」。Step 0 的两条 grep 分别证伪/作废了它们：Task 16 Step 3 已把四个符号建在 `src/shared/work-status-types.ts`（`src/main/pet/work-status.ts` 只是 import），而 `companion-renderer.test.ts` 的 `makeCompanionRenderer(clock, extra)`（`:57`）本来就摊开构造选项、`advance`（`:79`）本来就在模块作用域——本任务一个类型文件不新建、一行 harness 不搬家（只 widen `extra` 的入参类型一行，`:59`），`git add` 里也没有 `src/shared/work-status.ts`。
- **harness 各段自带三份的账**：`renderer.test.ts` 里 Task 12/14/17/18 各有一份 `advance`/`makeXxx`（Task 12 的写在 describe 内部，`:227`/`:248`，跨不出去）。本期不抽公共层：抽它要动 `renderer.test.ts` 那 14 条既有用例（基座 7 ＋ Task 12 的 tuck 7）与 `companion-renderer.test.ts` 那 8 条的取样口径，而 R-D2 的硬约束是四足路径一字不变。这条留给 Task 28 进 spec §13 的延后清单。
- **P4 的两条下行归位**：`renderer.setForm` → `engine.setForm` + `engine.setWorkTier`（Task 19 只给了引擎口，没人调）；`syncWorkStatus` 顶部 → `engine.setWorkTier`。留下一条已知边界，交给 Task 28 回写：`presentedTier` 的边沿判据使「猫形期间到达的档位」不重放 edge 片（设计上正确，切形不重新行礼），但它也不重算 `workFace`——星星/泪的 TTL 偏置要等下一次档位下行才刷新。观测量走 cast 读私有字段，`PixelPetRenderer` 的公开面零增长。

```bash
cd /d/Test/workbuddy/cyrene-verge
git status --short        # 只该有 4 个 M：companion.ts / renderer.ts / companion.test.ts / companion-renderer.test.ts（+ 台账）
git diff --numstat        # 四个文件的删除行数都该接近 0：本任务是追加，不是重写
npm run check:renderer && npm run check:main
git add src/renderer/pet/companion.ts src/renderer/pet/renderer.ts \
  src/renderer/pet/companion.test.ts src/renderer/pet/companion-renderer.test.ts docs/verge/notes/progress.md
git commit -m "$(cat <<'EOF'
feat(pet): 仲裁三层优先级：物理 > workStatus > activity（v1.5.0 Task 20）

工作中/提醒 期间不投身体也不投手势：这两档里 face 与 particle 照走，
小动作池整轮不跑，闲置计时照推——闸门不许攒出一串（计数 RNG 钉住只吃一支签）。

被拎起来时 ambient 手势当场收掉，身体槽换 drag；落地后 workStatus 的接管
回来，typeCode 那种 lasting 片在物理期让位——两只手得跟着身子一起甩。

顺手补 Task 19 的接线洞：setForm 现在把形态与当前档一起转给引擎，
否则猫娘在生产里永远走四足那张平表，pickRoll 只在单测里活着。
tier 类型不搬家：Task 16 已建 shared/work-status-types.ts，grep 回来证的。
EOF
)"
```

---

---

## Task 21: 手势池补完——剩下 9 条 clip 进表（CLIPS 21→30，池 9→18）

**Files:**
- Modify: `src/renderer/pet/motion.ts`（`GESTURE` 表末尾追加 9 条 clip）
- Modify: `src/renderer/pet/renderer.ts`（`ACTIVITY_GESTURE` 上方那句注释改写，**表本身一行不加**，理由见下）
- Test: `src/renderer/pet/motion-clips.test.ts`（9 名名单断言改写为 18 名；新增「九条的语义锚点」describe）

**Interfaces:**
- Consumes: Task 13 的 `Clip`/`GESTURE_IDS`/`registerClips`/`gestureClip`；Task 19 的 `gestureIds()`（池由 `CLIPS` 现算，本任务补完即从 9 长到 18，**一个常数都不用改**）
- Produces: 18 条 gesture clip 全注册；spec §5 `:225-226` 的 18 名清单全部落地

**为什么 `ACTIVITY_GESTURE` 不补 groom/yawn/stretch（计划侧修正，不是口径差）**

Task 14 在 `renderer.ts` 那张表上留了一句「groom/yawn/stretch 三条片 Task 21 落地时把这张表补全」。写到本任务 Step 0 时这句话被证伪：`ACTIVITY_GESTURE` 的键是 `CompanionActivity`，而猫娘侧的 `activity` 全集是 `idle/walk/sleep/drag/thrown`（`stepIdleGirl` 只写这四个，Task 19 Step 8）加菜单三条 `pet/eat/play`（`handleCommand`，`companion.ts:407`）——**`groom`/`yawn`/`stretch` 这三个 activity 猫娘永远进不去**，同名动作在猫娘身上全部由 `pickRoll` 的手势池抽到（`stepIdleGirl` → `ambientGesture` → `gestureClip`，Task 19/20 已接通）。把三行写进表就是 Task 15 说的「表里的死行比没表更糟」。本任务改为把那行注释换成机制说明；`tilt` 那行保留（它是猫形 `tilt` activity 与猫娘 `tilt` 手势的同名桥，猫形路径不读它，猫娘目前也走不到——留它的理由是 Task 14 的测试已把这条映射钉成既有断言，拆它要动已绿的尺，而它只是**一行数据的冗余**，不是一条会撒谎的通道。Task 28 回写 spec §13 时把「ACTIVITY_GESTURE 收敛或退役」记进延后清单）。

- [ ] **Step 0: 复核三处再动手**

```bash
cd /d/Test/workbuddy/cyrene-verge
grep -n "layer: \"gesture\"" src/renderer/pet/motion.ts | wc -l        # Expected: 9
grep -n "ACTIVITY_GESTURE" src/renderer/pet/renderer.ts                # Expected: 定义 1 处 + gestureSlotFor 消费 1 处
CI=true npx vitest run src/renderer/pet/motion-clips.test.ts           # 基线全绿
```

- [ ] **Step 1: 改测试（先红）**

`src/renderer/pet/motion-clips.test.ts`：

① Task 13 那条「workStatus 依赖的三条手势片已注册」改写为全量名单（**排序后比较**，与插入序解耦）：

```ts
it("18 个 GESTURE_IDS 全部注册为 gesture 层 clip（spec §5 :225-226 的清单一条不缺）", () => {
  const byId = new Map(CLIPS.filter((c) => c.layer === "gesture").map((c) => [c.id, c]));
  expect([...byId.keys()].sort()).toEqual([...GESTURE_IDS].sort());
  expect(byId.size).toBe(18);
  // 这两条 lasting 是 Task 18 演出表的依赖，保持 Task 13 的钉法不动
  expect(byId.get("typeCode")?.lasting).toBe(true);
  expect(byId.get("peek")?.lasting).toBe(true);
  expect(byId.get("shiver")?.lasting).toBeUndefined();
});
```

② 「CLIPS 至少 21 条」收紧为「恰好 30 条」（12 body + 18 gesture；补完之后还在用 `>=` 就是给「多注册了一条没人要的片」留门）：

```ts
expect(CLIPS.length).toBe(30);
```

③ 一次性手势的 ms 量级断言里 `seeds.length` 从 `>= 6` 收紧为 `toBe(16)`（18 − 2 条 lasting）。**16 条全都要落在 1800..2400**——新 9 条的 ms 选型必须过这条既有尺，不许为新片放宽窗口。

④ 新增 describe「九条的语义锚点」（每条至少一根可证伪的钉子，防「九条其实是同一条改了个名」——与尺 #72 「十六张其实是一张」同族）：

```ts
describe("九条新手势的语义锚点", () => {
  const at = (id: string, p: number) => sampleClip(gestureClip(id), p);

  it("stretch：双臂过顶（armL/armR 峰 < −1.2），身体拉长（squash 峰为负）", () => {
    const mid = at("stretch", 0.5);
    expect(mid.armL!).toBeLessThan(-1.2);
    expect(mid.armR!).toBeLessThan(-1.2);
    expect(mid.squash!, "拉长＝squash 取负；压扁才是正").toBeLessThan(0);
  });

  it("yawn：仰头（headPitch 峰为负）＋单手抬到嘴边（hand 峰 ≥ 0.4）", () => {
    const mid = at("yawn", 0.5);
    expect(mid.headPitch!).toBeLessThan(0);
    expect(mid.hand!).toBeGreaterThanOrEqual(0.4);
  });

  it("groom：同一周期内手来回三次（cycles=3），头随手小摆", () => {
    // 三次搓洗：hand 通道在 p=1/6、3/6、5/6 各过一峰（pulse 的 cycles=3 峰位）
    for (const p of [1 / 6, 3 / 6, 5 / 6]) expect(at("groom", p).hand!).toBeGreaterThan(0.7);
    expect(at("groom", 0).hand, "端点必须归零（尺 #73 的前提）").toBeCloseTo(0, 12);
  });

  it("curtsy：双腿屈膝（legL/legR 峰 > 0.4）＋裙摆外扩（hem 峰 > 0.15）＋低头（headPitch 峰 > 0.1）", () => {
    const mid = at("curtsy", 0.5);
    expect(mid.legL!).toBeGreaterThan(0.4);
    expect(mid.hem!).toBeGreaterThan(0.15);
    expect(mid.headPitch!).toBeGreaterThan(0.1);
  });

  it("clap：两臂反相合拢（任意非端点上 armL 与 armR 的增量异号）", () => {
    for (const p of [0.125, 0.375, 0.625, 0.875]) {
      const s = at("clap", p);
      const dl = s.armL! - gestureClip("clap").rest.armL!;
      const dr = s.armR! - gestureClip("clap").rest.armR!;
      expect(Math.sign(dl), `p=${p} 两臂没有在对拍`).toBe(-Math.sign(dr));
      expect(dl).not.toBe(0);
    }
  });

  it("coverFace：双手捂脸（hand 峰 ≥ 0.6）＋猫耳耷拉（earL/earR 峰为负）", () => {
    const mid = at("coverFace", 0.5);
    expect(mid.hand!).toBeGreaterThanOrEqual(0.6);
    expect(mid.earL!).toBeLessThan(0);
    expect(mid.earR!).toBeLessThan(0);
  });

  it("point：右臂前伸（armR 峰 < −0.9），左臂不参与（armL 无轨道）", () => {
    expect(at("point", 0.5).armR!).toBeLessThan(-0.9);
    expect(gestureClip("point").tracks.armL, "point 不许写成双臂").toBeUndefined();
  });

  it("sip：举杯啜饮两次（headPitch 在 p=0.25 与 p=0.75 各过一峰）", () => {
    for (const p of [0.25, 0.75]) expect(at("sip", p).headPitch!).toBeLessThan(-0.06);
  });

  it("turnAway：lean 与 headYaw 峰值**异号**（spec §6 :268 的硬约束，同号＝没转身只是歪头）", () => {
    const mid = at("turnAway", 0.5);
    expect(Math.sign(mid.lean!)).toBe(-Math.sign(mid.headYaw!));
    expect(Math.abs(mid.lean!)).toBeGreaterThan(0.08);
    expect(Math.abs(mid.headYaw!)).toBeGreaterThan(0.15);
  });
});
```

Run: `CI=true npx vitest run src/renderer/pet/motion-clips.test.ts`
Expected: FAIL——新 describe 九条全红（`gestureClip("stretch")` 抛「未知 clip」），名单断言红在 `16 ≠ 9`／`30 ≠ 21`。

- [ ] **Step 2: 写九条 clip**

`src/renderer/pet/motion.ts` 的 `GESTURE` 数组末尾（`shiver` 之后）追加。**数值就是设计**：改一个数＝改观感；每条第一句注释写明语义锚点，评审按 spec §5/§6 对。

```ts
  // —— Task 21 补完的 9 条。单位与上限沿用 Task 12 的通道表：弧度 |v|≤2、headBob/hop 是 px（负＝向上）、
  // squash/hem/hand 无量纲 ≤1.2；一次性片 ms 必须落在 1800..2400（Task 13 的量级尺不收宽）。 ——
  /** 伸懒腰：双臂过顶＋身体拉长（squash 取负＝拉，crouch 的 0.55 是压，同一通道两个方向）。 */
  { id: "stretch", layer: "gesture", ms: 2200, priority: 0,
    rest: { armL: 0, armR: 0, lean: 0, headPitch: 0, squash: 0, hem: 0 },
    tracks: {
      armL: (p, e) => -1.35 * e.pulse(p), armR: (p, e) => -1.35 * e.pulse(p),
      lean: (p, e) => -0.06 * e.pulse(p),
      headPitch: (p, e) => -0.12 * e.pulse(p),
      squash: (p, e) => -0.10 * e.pulse(p),
      hem: (p, e) => -0.08 * e.pulse(p),
    }, face: "happy" },
  /** 打哈欠：仰头＋右手背抬到嘴边（猫娘有手，四足的 yawn=1 那张嘴由 face 层的 sleepy 说话）。 */
  { id: "yawn", layer: "gesture", ms: 2200, priority: 0,
    rest: { headPitch: 0, headBob: 0, armR: 0, hand: 0, lean: 0 },
    tracks: {
      headPitch: (p, e) => -0.18 * e.pulse(p),
      headBob: (p, e) => 1.2 * e.pulse(p),
      armR: (p, e) => -0.70 * e.pulse(p),
      hand: (p, e) => 0.45 * e.pulse(p),
      lean: (p, e) => 0.03 * e.pulse(p),
    }, face: "sleepy" },
  /** 洗脸：右手在脸侧搓三次（cycles=3 的裸 sin，端点天然归零），头随手小摆。 */
  { id: "groom", layer: "gesture", ms: 2400, priority: 0,
    rest: { armR: -0.85, hand: 0.55, headPitch: 0, headYaw: 0 },
    tracks: {
      armR: (p) => -0.85 + 0.10 * Math.sin(2 * Math.PI * 3 * p),
      hand: (p) => 0.55 + 0.25 * Math.sin(2 * Math.PI * 3 * p),
      headPitch: (p, e) => 0.08 * e.pulse(p),
      headYaw: (p) => 0.06 * Math.sin(2 * Math.PI * 3 * p),
    }, face: "neutral" },
  /** 屈膝礼：双腿下蹲＋双手提裙（hem 正＝裙摆外扩，同 walk 的 0.14 方向）＋低头致意。 */
  { id: "curtsy", layer: "gesture", ms: 2200, priority: 0,
    rest: { legL: 0, legR: 0, hem: 0, armL: 0, armR: 0, headPitch: 0, lean: 0 },
    tracks: {
      legL: (p, e) => 0.55 * e.pulse(p), legR: (p, e) => 0.55 * e.pulse(p),
      hem: (p, e) => 0.22 * e.pulse(p),
      armL: (p, e) => -0.35 * e.pulse(p), armR: (p, e) => -0.35 * e.pulse(p),
      headPitch: (p, e) => 0.14 * e.pulse(p),
      lean: (p, e) => 0.10 * e.pulse(p),
    }, face: "happy" },
  /** 拍手：两臂以 −0.55 为轴反相开合三次（p=0 两臂同高＝rest，异号增量＝对拍）。 */
  { id: "clap", layer: "gesture", ms: 1800, priority: 0,
    rest: { armL: -0.55, armR: -0.55, hand: 0, headBob: 0 },
    tracks: {
      armL: (p) => -0.55 - 0.30 * Math.sin(2 * Math.PI * 3 * p),
      armR: (p) => -0.55 + 0.30 * Math.sin(2 * Math.PI * 3 * p),
      hand: (p) => 0.5 * Math.abs(Math.sin(2 * Math.PI * 3 * p)),
      headBob: (p, e) => -0.8 * e.pulse(p, 3),
    }, face: "excited" },
  /** 捂脸害羞（spec §6 点击反馈档 2）：双手捂脸＋低头＋猫耳耷拉＋身子微微后仰躲。 */
  { id: "coverFace", layer: "gesture", ms: 2000, priority: 0,
    rest: { armL: 0, armR: 0, hand: 0, headPitch: 0, lean: 0, earL: 0, earR: 0 },
    tracks: {
      armL: (p, e) => -0.95 * e.pulse(p), armR: (p, e) => -0.95 * e.pulse(p),
      hand: (p, e) => 0.70 * e.pulse(p),
      headPitch: (p, e) => 0.16 * e.pulse(p),
      lean: (p, e) => -0.04 * e.pulse(p),
      earL: (p, e) => -0.14 * e.pulse(p), earR: (p, e) => -0.14 * e.pulse(p),
    }, face: "shy" },
  /** 指向：只有右臂前伸（左臂无轨道是有意的——双臂同抬读作「要抱抱」，不是「看那边」）。 */
  { id: "point", layer: "gesture", ms: 1800, priority: 0,
    rest: { armR: 0, hand: 0, headYaw: 0, lean: 0 },
    tracks: {
      armR: (p, e) => -1.05 * e.pulse(p),
      hand: (p, e) => 0.35 * e.pulse(p),
      headYaw: (p, e) => 0.10 * e.pulse(p),
      lean: (p, e) => 0.05 * e.pulse(p),
    }, face: "smug" },
  /** 啜饮（spec :289 「吃什么 12 档本期只做 sip」）：举杯到嘴边，啜两口（headPitch 两个峰）。 */
  { id: "sip", layer: "gesture", ms: 2400, priority: 0,
    rest: { armR: 0, hand: 0, headPitch: 0, headBob: 0 },
    tracks: {
      armR: (p, e) => -0.80 * e.pulse(p),
      hand: (p, e) => 0.55 * e.pulse(p),
      headPitch: (p, e) => -0.10 * e.pulse(p, 2),
      headBob: (p, e) => -0.5 * e.pulse(p, 2),
    }, face: "happy" },
  /** 傲娇转身（spec §6 点击反馈档 3）：lean 与 headYaw **必须异号**——同号读作歪头，不是转身。 */
  { id: "turnAway", layer: "gesture", ms: 2000, priority: 0,
    rest: { lean: 0, headYaw: 0, armL: 0, armR: 0, earL: 0, earR: 0 },
    tracks: {
      lean: (p, e) => -0.14 * e.pulse(p),
      headYaw: (p, e) => 0.26 * e.pulse(p),
      armL: (p, e) => 0.30 * e.pulse(p), armR: (p, e) => 0.30 * e.pulse(p),
      earL: (p, e) => -0.16 * e.pulse(p), earR: (p, e) => 0.16 * e.pulse(p),
    }, face: "angry" },
```

`renderer.ts` 里 `ACTIVITY_GESTURE` 上方那句注释（Task 14 写的「groom/yawn/stretch 三条片 Task 21 落地时把这张表补全……」）替换为：

```ts
/**
 * gesture 层的 activity 映射。猫娘的 activity 全集只有 idle/walk/sleep/drag/thrown + 菜单三条
 * pet/eat/play（stepIdleGirl 不写 groom/yawn/stretch——同名动作在猫娘身上全部由 pickRoll 的
 * 手势池抽到，见 Task 21 计划正文的「为什么不补这张表」），所以这张表不会再长：新片进池即被抽到，
 * 进表反而是一行永远不会被读的 dead row。
 */
```

- [ ] **Step 3: 跑绿**

Run: `CI=true npx vitest run src/renderer/pet/motion.test.ts src/renderer/pet/motion-clips.test.ts src/renderer/pet/companion.test.ts src/renderer/pet/companion-renderer.test.ts`
Expected: 全绿。`companion.test.ts` 里 Task 19 的池断言自动从 9 条池长成 18 条池（`gestureIds()` 现算）；`companion-renderer.test.ts` 里 Task 20 那两条曾经写死 `gestureIds()[4]` 的断言**本任务之前已改成 `pickedGesture()` 现算**（Task 20 Step 4 的 `pickedGesture`），所以池变长不会把它们指到另一条片。若仍有红在「抽到的片不对」，先跑 `node -e` 打印 `gestureIds()` 看池的字典序与 Task 20 的公式对不对得上，**只许改推导，不许改权重与窗口断言**。

- [ ] **Step 4: 变异验牙（三条，逐条做完立刻还原）**

1. **删键**：把 `coverFace` 的 `tracks` 里 `earL/earR` 两条删掉（rest 里留着）→ 尺 #73 的「rest 键集 == tracks 键集」红，点名 `coverFace`。改回。
2. **转身写成歪头**：`turnAway` 的 `headYaw` 系数 0.26 改成 −0.26（与 lean 同号）→ 「lean 与 headYaw 峰值异号」红。改回。
3. **少注册一条**：把 `sip` 整条注掉 → 「18 个 GESTURE_IDS 全部注册」红（`byId.size` 17），且「恰好 30 条」红（29），且 `companion.test.ts` 若有池内点名断言一并红。改回。

- [ ] **Step 5: 台账 + 提交**

`docs/verge/notes/progress.md` 追加一条（**计划侧修正，不是口径差**）：`ACTIVITY_GESTURE` 不补 groom/yawn/stretch 的理由（猫娘的这三个 activity 不可达，同名动作走手势池），以及「`tilt` 行保留但猫娘侧暂不可达、退役与否另计」这笔小账交给 Task 28 写进 spec §13 延后清单。

```bash
cd /d/Test/workbuddy/cyrene-verge
git status --short        # 只该有 3 个 M：motion.ts / renderer.ts / motion-clips.test.ts（+ 台账）
npm run check:renderer
git add src/renderer/pet/motion.ts src/renderer/pet/renderer.ts \
  src/renderer/pet/motion-clips.test.ts docs/verge/notes/progress.md
git commit -m "$(cat <<'EOF'
feat(pet): 手势池补完 18 条（v1.5.0 Task 21）

stretch/yawn/groom/curtsy/clap/coverFace/point/sip/turnAway 九条进 CLIPS，
每条带语义锚点断言（turnAway 的 lean/headYaw 异号是 spec §6 的硬约束，
clap 两臂反相、point 单臂——防「九条其实是同一条改名」）。
池由 CLIPS 现算（Task 19），补完即从 9 长到 18，无常数要改。
ACTIVITY_GESTURE 一行不加：猫娘的 groom/yawn/stretch activity 不可达，
写进表是死行；Task 14 那句「Task 21 补全」注释按机制改写。
EOF
)"
```

---

## Task 22: 触摸六类＋2.5s 合并＋点击反馈 5 变体（退役 双击→玩）

**Files:**
- Modify: `src/renderer/pet/companion.ts`（`TOUCH_KINDS`/`TOUCH_MERGE_MS`/`touch()`/`clickKindFor`/`PET_HOLD_MS`＋六档词表；`beginDrag`/`endDrag`/`stepThrow` 内部各接一行）
- Modify: `src/renderer/pet/renderer.ts`（`touch(kind)` 透传，与 `handleCommand` `:317-319` 同形）
- Modify: `src/renderer/main.ts`（`pointerup` 的 `pressPending` 分支改用 `clickKindFor`；**删掉** `onCatClick`/`petClickTimer`/`clearPetClickTimer`/`DOUBLE_CLICK_MS` 四处（`:188`/`:195`/`:198-203`/`:206-216`）与它们的三处调用（`:169`/`:369`/`:474`）；`pointerdown` 记 `pressAtMs`）
- Test: `src/renderer/pet/companion.test.ts`（追加 `describe("companion touch kinds")`）
- Test: `src/renderer/pet/companion-renderer.test.ts`（追加一条透传）
- Test: `src/renderer/main.test.ts`（新建，**源码文本锁**，与 Task 15 的 `ipc-gate-wiring.test.ts` 同手法）

**Interfaces:**
- Consumes: Task 19 的引擎 `form`/`ambientGesture`/`gestureUntil` 字段与 `gestureClip`；Task 21 的 18 条手势片；既有 `pet()`（`:346`）/`say()`（`:456`）/`pickLine()`（`:507`）
- Produces:
  - `const TOUCH_KINDS = ["poke", "pet", "grab", "drop", "throw", "crash"] as const`、`type TouchKind`
  - `const TOUCH_MERGE_MS = 2_500`（spec §5 :257）
  - `touch(kind: TouchKind, now?): boolean`——**猫形恒 false**（口径差⑮，见下）
  - `const PET_HOLD_MS = 500`、`clickKindFor(heldMs: number): "poke" | "pet"`（按住 ≥500ms 且没拖过 4px 阈值＝摩挲；以下是戳）
  - `PixelPetRenderer.touch(kind)`（生产唯一渲染端入口）

**与 spec 的口径差⑮（六类反应按 form 作用域，四足触摸语义一字不变）**：spec §5 把触摸六类写成形态无关的交互层，且 §5 :258 要「单击＝摸摸拆成 poke 与 pet」。实现里六类的**登记与合并**两形态共用一份代码，但**反应**（手势片、台词、合并窗口的生效）只在 `form === "girl"` 时发生——`touch()` 第一行就是 `if (this.form !== "girl") return false;`。理由：① 五档点击反馈的手势片全是猫娘 clip（`coverFace`/`turnAway` 在四足几何上不存在）；② 四足的单击今天走 `handleCommand("pet")`（`main.ts:214`）喂 `PET_LINES`，给它套 2.5s 合并会让「连点两下」从两句话变成一句——四足的行为与 RNG 消耗序列都被既有测试钉死（`companion.test.ts` 18 条＋`main.ts` 无单测但有屏幕尺），动它就是破 R-D2；③ spec §5 的仲裁与 §6 的五档表读主语都是猫娘。代价：双击→玩 这条**两形态一起退役**（`main.ts` 的定时器只有一份，给四足单留一份旧定时器＝同一指针事件两套判据），「玩」仍有右键菜单「陪它玩」直达（`pet-menu.ts:71`）。spec §13 延后清单由 Task 28 补一句「四足的 poke/pet 拆分另计」。

**为什么 `grab/drop/throw/crash` 由引擎内部发起而不是 main.ts 报**：这四个时机引擎本来就知道（`beginDrag:425`＝抓起、`endDrag:436` 的速度分支＝慢放/甩出、`stepThrow:668-677` 的碰壁反弹＝撞壁），main.ts 只知道「指针下了/松了」，不知道引擎判了`throw` 还是 `drop`——把判据搬到 main.ts 就要把 `THROW.throwThreshold` 泄出引擎。main.ts 只新增 `poke`/`pet` 两个上报点（指针层才知道「按了多久」），四个物理类在引擎内部 `this.touch(...)` 自报；`touch()` 的猫形短路保证这四行对四足是零行为零 RNG。

- [ ] **Step 0: 复核触点**

```bash
cd /d/Test/workbuddy/cyrene-verge
grep -n "onCatClick\|petClickTimer\|DOUBLE_CLICK_MS\|clearPetClickTimer" src/renderer/main.ts
# Expected: 定义 4 处（:188 :195 :198 :206）+ 调用 3 处（:169 :369 :474）＝7 行命中
grep -n "THROW.throwThreshold" src/renderer/pet/companion.ts          # endDrag 的速度分支
CI=true npx vitest run src/renderer/pet/companion.test.ts             # 基线：18 + Task 19 的 5 条
```

- [ ] **Step 1: 写失败测试**

`src/renderer/pet/companion.test.ts` 追加：

```ts
import { TOUCH_KINDS, TOUCH_MERGE_MS, PET_HOLD_MS, clickKindFor, type TouchKind } from "./companion";

describe("companion touch kinds", () => {
  const girlCtx = ctx; // 与本文件既有的 ctx 同一份
  const GIRL = { form: "girl" as const };

  it("六类名单与合并窗口钉死（spec §5 :255-257）", () => {
    expect([...TOUCH_KINDS]).toEqual(["poke", "pet", "grab", "drop", "throw", "crash"]);
    expect(TOUCH_MERGE_MS).toBe(2500);
  });

  it("clickKindFor：500ms 是分界线（按住不走 4px ＝摩挲，以下是戳）", () => {
    expect(PET_HOLD_MS).toBe(500);
    expect(clickKindFor(0)).toBe("poke");
    expect(clickKindFor(499)).toBe("poke");
    expect(clickKindFor(500)).toBe("pet");
    expect(clickKindFor(10_000)).toBe("pet");
  });

  it("poke：猫娘抽一档变体——手势片到期时刻＝now+片长，台词落在该档词表里", () => {
    const engine = new CompanionEngine({ ...GIRL, now: () => T0, random: seq([0.4, 0.5]), storage: makeStorage() });
    // 0.4 × 5 = 2 → 第 3 档「傲娇生气」：turnAway + ANGRY_LINES
    expect(engine.touch("poke")).toBe(true);
    const snap = engine.getSnapshot();
    expect(snap.gesture).toBe("turnAway");
    expect(["哼，别戳我", "转过去冷静一下"]).toContain(snap.bubble?.text);
  });

  it("同类 2.5s 内合并：第二下 false，手势与 RNG 都只吃一次", () => {
    const draws: number[] = [];
    let t = T0;
    const engine = new CompanionEngine({
      ...GIRL, now: () => t, storage: makeStorage(),
      random: () => { draws.push(1); return 0.4; },
    });
    expect(engine.touch("poke")).toBe(true);
    const afterFirst = draws.length;
    t += 1_000;                                    // 窗内
    expect(engine.touch("poke")).toBe(false);
    expect(draws.length, "合并掉的触摸不许再吃签").toBe(afterFirst);
    t += TOUCH_MERGE_MS;                           // 出窗
    expect(engine.touch("poke")).toBe(true);
    expect(draws.length).toBeGreaterThan(afterFirst);
  });

  it("合并按类记账：poke 之后立刻 pet 不合并（spec §5「同一类」）", () => {
    const engine = new CompanionEngine({ ...GIRL, now: () => T0, random: seq([0.4, 0.5, 0.5]), storage: makeStorage() });
    expect(engine.touch("poke")).toBe(true);
    expect(engine.touch("pet")).toBe(true);
    expect(engine.getSnapshot().activity).toBe("pet");   // pet 档复用既有 pet()：加好感、900ms 动作
  });

  it("撞壁合并进引擎物理：连续撞墙 2.5s 内只喊一次", () => {
    let t = T0;
    const engine = new CompanionEngine({ ...GIRL, now: () => t, random: seq([0.5]), storage: makeStorage() });
    engine.setPosition({ x: 100, y: 300 });
    engine.beginDrag(t);
    engine.endDrag({ x: 100, y: 300 }, { x: -900, y: -600 }, t);   // 超阈值 → thrown
    expect(engine.getSnapshot().activity).toBe("thrown");
    // 逐帧推进：左壁反弹在 stepThrow 内发生，crash 由引擎自报
    for (let i = 0; i < 200 && !engine.getSnapshot().bubble; i += 1) {
      t += 50;
      engine.update(t, girlCtx);
    }
    expect(engine.getSnapshot().bubble?.text).toMatch(/痛|撞/);
    const text1 = engine.getSnapshot().bubble?.text;
    // 继续弹，2.5s 窗内的第二次撞壁不许再换台词（也不许再吃签）
    t += 100;
    engine.update(t, girlCtx);
    expect(engine.getSnapshot().bubble?.text).toBe(text1);
  });

  it("猫形六类全吞：返回 false、零台词、零 RNG 消耗（口径差⑮的对照）", () => {
    const draws: number[] = [];
    const engine = new CompanionEngine({
      now: () => T0, storage: makeStorage(),
      random: () => { draws.push(1); return 0.5; },
    });
    const before = draws.length;                   // 构造器吃掉的签（idleDelay/chatAt）记为基准
    for (const kind of TOUCH_KINDS) expect(engine.touch(kind as TouchKind)).toBe(false);
    expect(draws.length, "猫形触摸一支签都不许吃").toBe(before);
    expect(engine.getSnapshot().bubble).toBeNull();
    expect(engine.getSnapshot().gesture ?? null).toBeNull();
  });
});
```

`src/renderer/pet/companion-renderer.test.ts` 追加一条（harness 用本文件模块作用域已有的 `makeCompanionRenderer`/`advance`，Task 20 Step 0 已核实它们在 `:57`/`:79`）：

```ts
it("renderer.touch 透传进引擎：girl 形点一下，snapshot.gesture 当帧即有", async () => {
  const { r, loop, clock } = makeCompanionRenderer(10_000, {
    companionOverrides: { random: () => 0.4, wallNow: () => new Date(2026, 9, 24, 13, 0, 0).getTime() },
  });
  r.setForm("girl");
  r.touch("poke");
  advance(loop, clock, 1);
  expect(r.getCompanionSnapshot()?.gesture).toBe("turnAway");   // 0.4×5=2 → 档 3
});
```

`src/renderer/main.test.ts`（新建，文本锁——`main.ts` 是入口文件跑不了单测，锁的是**接线的形状**，与 Task 15 的 wiring 锁同手法；读到文件内容变了就红，红的含义是「回去重看这段接线，不是无脑改锁」）：

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(join(__dirname, "main.ts"), "utf8");

describe("main.ts 触摸接线（Task 22）", () => {
  it("双击定时器整套退役：四个符号一个都不许剩", () => {
    for (const gone of ["onCatClick", "petClickTimer", "clearPetClickTimer", "DOUBLE_CLICK_MS"]) {
      expect(src.includes(gone), `${gone} 还在 main.ts 里`).toBe(false);
    }
  });
  it("pointerup 的 pressPending 分支按按住时长分档，两个上报点都在", () => {
    expect(src).toMatch(/pressPending[\s\S]{0,400}clickKindFor\(/);
    expect(src).toMatch(/renderer\.touch\(clickKindFor\(/);
  });
  it("pointerdown 记录按下时刻", () => {
    expect(src).toMatch(/pressAtMs\s*=\s*performance\.now\(\)/);
  });
  it("右键菜单的「陪它玩」通道不动（退役的只是双击升级）", () => {
    expect(src).toContain("handleCommand");                        // onPetCommand 分发还在
  });
});
```

Run: `CI=true npx vitest run src/renderer/pet/companion.test.ts src/renderer/pet/companion-renderer.test.ts src/renderer/main.test.ts`
Expected: FAIL——`touch`/`clickKindFor`/`TOUCH_KINDS` 未导出，`renderer.touch is not a function`，文本锁四条全红。

- [ ] **Step 2: 实现**

`companion.ts`（词表跟 `PET_LINES:125` 同一形态；`POKE_VARIANTS` 的顺序就是 spec §6 表格的行序）：

```ts
// —— 触摸六类（spec §5 :255-258），PET_LINES 段之后 ——
export const TOUCH_KINDS = ["poke", "pet", "grab", "drop", "throw", "crash"] as const;
export type TouchKind = (typeof TOUCH_KINDS)[number];
/** 同类触摸的合并窗：连点/连撞不灌队列（spec §5 :257）。 */
export const TOUCH_MERGE_MS = 2_500;
/** 按住超过它且没拖过 4px 阈值＝摩挲；以下是戳一下。取 500 是 220ms 双击窗的两倍以上，快点击不会误判成摸。 */
export const PET_HOLD_MS = 500;
export function clickKindFor(heldMs: number): "poke" | "pet" {
  return heldMs >= PET_HOLD_MS ? "pet" : "poke";
}

const SHY_LINES = ["呀——别看这边", "脸、脸红了啦"] as const;
const ANGRY_LINES = ["哼，别戳我", "转过去冷静一下"] as const;
const EXCITED_LINES = ["咯咯咯好痒", "再来再来！"] as const;
const GRAB_LINES = ["哇——放我下来", "脚、脚够不到地啦"] as const;
const DROP_LINES = ["稳稳落地", "谢、谢谢"] as const;
const THROW_LINES = ["呜哇——！"] as const;
const CRASH_LINES = ["痛…", "撞、撞到了"] as const;

/** spec §6 点击反馈 5 变体，行序即表序。只服务 poke；词表形态与 PET_LINES 一致（口径差⑧：猫窗没有 i18n 运行时）。 */
const POKE_VARIANTS: ReadonlyArray<{ gesture: string; lines: readonly string[] }> = [
  { gesture: "hop", lines: PET_LINES },          // 开心跃动
  { gesture: "coverFace", lines: SHY_LINES },    // 害羞惊讶
  { gesture: "turnAway", lines: ANGRY_LINES },   // 傲娇生气
  { gesture: "shiver", lines: EXCITED_LINES },   // 挠痒咯咯笑
  { gesture: "wave", lines: PLAY_LINES },        // 元气挥手
];
```

class 字段区（`gestureUntil` 旁边）加 `private lastTouchAt = new Map<TouchKind, number>();`，公开口加：

```ts
  /**
   * 触摸六类（spec §5）。同类 2.5s 内合并；**猫形恒 false**（口径差⑮：反应只长在猫娘上，
   * 四足的单击仍走 main.ts → handleCommand("pet") 那条老路，一支签都不多吃）。
   * 返回值＝这次触摸是否生效（false＝被合并或形态不收）；调用方不需要这个值，它是给测试与
   * 排查「连点怎么没反应」留的口。
   */
  touch(kind: TouchKind, now = this.now()): boolean {
    if (this.form !== "girl") return false;
    const last = this.lastTouchAt.get(kind);
    if (last !== undefined && now - last < TOUCH_MERGE_MS) return false;
    this.lastTouchAt.set(kind, now);
    switch (kind) {
      case "poke": {
        const v = POKE_VARIANTS[Math.min(4, Math.floor(this.random() * 5))];
        this.ambientGesture = v.gesture;
        this.gestureUntil = now + gestureClip(v.gesture).ms;
        this.say(this.pickLine([...v.lines]), 1, now);
        return true;
      }
      case "pet":
        this.pet(now);                   // 既有行为：加好感 + 900ms + PET_LINES
        return true;
      case "grab":
        return this.say(this.pickLine([...GRAB_LINES]), 1, now);
      case "drop":
        return this.say(this.pickLine([...DROP_LINES]), 1, now);
      case "throw":
        return this.say(this.pickLine([...THROW_LINES]), 1, now);
      case "crash":
        return this.say(this.pickLine([...CRASH_LINES]), 1, now);
    }
  }
```

⚠️ 两个接线细节，漏一个就静默哑：
1. `setForm`（Task 19）里把 `this.lastTouchAt.clear()` 加进既有的三行清理——切形态不带走上一形态的合并窗，否则「切成猫再切回来，2.5s 内摸她没反应」。
2. 引擎内部三处自报：`beginDrag`（`:425`）末尾 `this.touch("grab", now);`；`endDrag`（`:436`）的**两个分支各一行**——`speed >= THROW.throwThreshold` 那支在 `this.idleUntil = …` 前加 `this.touch("throw", now);`，慢放支在 `this.settle(now)` 前加 `this.touch("drop", now);`；`stepThrow`（`:654`）的左/右/上三处碰壁反弹分支各加 `this.touch("crash", now);`（落地反弹不算撞壁——那是 `land` 片的事）。这五行对猫形是恒 false 的空调用，**不许**给它们再包 `if (this.form === "girl")`——两层判据必然有一天只改一层。

`renderer.ts`（`handleCommand:317-319` 旁边，同形）：

```ts
  touch(kind: TouchKind): void {
    this.engine?.touch(kind);
  }
```

（引擎的 `now` 由 `companionOverrides`/`Date.now` 供，不透 `performance.now()`——`handleCommand` 那条透参是历史形状，本任务不扩散它。import 头把 `TouchKind` 并进 Task 14 那条 `./companion` import。）

`main.ts`：
- 删：`DOUBLE_CLICK_MS`（`:188`）、`petClickTimer`（`:195`）、`clearPetClickTimer`（`:198-203`）、`onCatClick`（`:206-216`），以及 `clearPetClickTimer()` 的两处调用（`:169` beforeunload、`:369` beginDragAt）。`:369` 那行删掉后它上面的注释（「挂起的单点『摸摸』作废」）一并删——拖拽起手现在天然不算 poke/pet，因为 `pressPending` 在 `beginDragAt:365` 已置 false。
- `pointerdown` 的 `pressStartX/Y = …` 两行旁边加 `pressAtMs = performance.now();`（新 `let pressAtMs = 0;` 声明与 `pressPending` 同区）。
- `pointerup` 的 `pressPending` 分支里 `onCatClick();` 换成：

```ts
    renderer.touch(clickKindFor(performance.now() - pressAtMs));
```

- import：`clickKindFor` 从 `./pet/companion` 引（main.ts 今天已从那里引别的，grep 复核现有 import 行再并）。

Run: `CI=true npx vitest run src/renderer/pet/companion.test.ts src/renderer/pet/companion-renderer.test.ts src/renderer/main.test.ts` → 全绿；
Run: `npm run check:renderer && npm run check:main` → 绿。

- [ ] **Step 3: 变异验牙（四条，逐条做完立刻还原）**

1. **合并窗被摘**：删掉 `if (last !== undefined && …) return false;` → 「同类 2.5s 内合并」红在 `draws.length` 与第二次 `toBe(false)`。改回。
2. **猫形闸门被摘**：删掉 `if (this.form !== "girl") return false;` → 「猫形六类全吞」红（RNG 消耗与 bubble 两组断言同时红）。这条同时兜住「把闸门写成 `=== "cat"` 才短路」——写反了猫娘侧所有 touch 测试红。改回。
3. **分档阈值漂移**：`clickKindFor` 的 `>=` 改成 `>` → 「500ms 是分界线」红在 `clickKindFor(500)`。改回。
4. **物理自报漏一支**：删掉 `endDrag` 快分支的 `this.touch("throw", now)` → 「撞壁合并进引擎物理」红在 `activity` 进不了 `thrown` 之后的台词断言（`endDrag` 不判 thrown，测试永远等不到 bubble——这条红的措辞是超时措辞，Step 1 的测试因此把「等不到」与「台词不对」分两行断言，读红能分辨）。改回。

- [ ] **Step 4: 台账 + 提交**

`docs/verge/notes/progress.md` 追加：口径差⑮（六类反应按 form 作用域＋双击→玩两形态一起退役的理由与出口）；`main.ts` 新增 `main.test.ts` 文本锁的手法说明（入口文件跑不了单测，锁形状不锁数值）；`PET_HOLD_MS=500` 的选型理由一句话。

```bash
cd /d/Test/workbuddy/cyrene-verge
git status --short        # companion.ts / renderer.ts / main.ts / 两个测试 M + main.test.ts 新建（+ 台账）
git add src/renderer/pet/companion.ts src/renderer/pet/renderer.ts src/renderer/main.ts \
  src/renderer/pet/companion.test.ts src/renderer/pet/companion-renderer.test.ts \
  src/renderer/main.test.ts docs/verge/notes/progress.md
git commit -m "$(cat <<'EOF'
feat(pet): 触摸六类 + 2.5s 合并 + 点击反馈 5 变体（v1.5.0 Task 22）

poke 五档变体（hop/coverFace/turnAway/shiver/wave × 各自词表），
pet 复用既有摸摸头；grab/drop/throw/crash 由引擎在物理判定点自报——
main.ts 只知道指针下了松了，不知道引擎判了甩出还是慢放。
双击→玩退役：菜单「陪它玩」仍在，连点被合并窗收掉而不是升级。
六类反应只长在猫娘上（口径差⑮）：四足单击一支签不多吃，
既有 18+5 条引擎测试与屏幕尺不动。
EOF
)"
```

---

---

## Task 23: P4 收口门——调度等价 + 四足零变化

**Files:**
- 无新增；只跑门与差异审计，必要时提交修复

- [ ] **Step 1: 全量测试与门**

```bash
cd /d/Test/workbuddy/cyrene-verge
CI=true npx vitest run
npm run check:main && npm run check:preload && npm run check:renderer
npm run check:brand && npm run check:roster
npm run palette:check && npm run palette:migrate:check
npm run check:sprites
```

Expected: 全绿。`check:sprites` 绿是 R-D2 的资产面证据——P2–P4 没动位图清单，146 张仍与盘上字节一致。

- [ ] **Step 2: 调度等价性对照（spec §12 P4 出口「与四足等价的调度单测」）**

逐条核对而不是「跑绿了就算」：

1. `companion.test.ts` 里四足的 18 条（Step 0 基线）＋ Task 19 的 5 条＋ Task 22 的 7 条全绿——`grep -c "^  it(" src/renderer/pet/companion.test.ts` 报数，记进台账。
2. `companion-renderer.test.ts` 的猫形对照（Task 14 那条「blink 恒 0、mouse 恒 null、channels 恒空」）仍绿。
3. `git log --oneline <P1 收口提交>..HEAD -- src/renderer/pet/companion.ts` 逐条读 diff 摘要：四足路径（`stepIdle` 的 cat 分支、`pet/feed/play/handleCommand`、`beginDrag/endDrag/stepThrow` 的物理）**新增的每一行都必须在 girl 闸门之后或在 `touch()` 的恒 false 调用里**——多出来的任何一处 cat 路径行为变化，回退或记口径差。

- [ ] **Step 3: 仲裁回归（Task 20 的六条）重跑一次单独点名**

```bash
CI=true npx vitest run src/renderer/pet/companion-renderer.test.ts -t "仲裁"
```

（`-t` 串以 Task 20 落盘后的实际 describe 名为准；对不上就 grep 出来换——不许改用 `--passWithNoTests` 蒙混，那正是 Task 15 台账里点过名的假绿形态。）

- [ ] **Step 4: 台账 + 提交（若有修复）**

`docs/verge/notes/progress.md` 记：门的输出、Step 2 第 1 条的用例总数、Step 3 实际使用的 `-t` 串。

---

## Task 24: 资产管线加 `form` 轴（GIRL_POSES/GIRL_CROPS 暂行值，产出先不翻）

**Files:**
- Modify: `src/renderer/pet/cat-variants.ts`（`SpriteSpec` 加 `form?`/`expression?`；新增 `GIRL_POSES`/`GIRL_CROPS`/`cropsForForm`；`buildSpriteOps` 按 form 分派）
- Modify: `src/renderer/pet/cat-sprite-manifest.ts`（`SpriteTarget` 加 `form?: PetForm` 与 `expression?: Expression` 两个**可选**字段——本任务零条目标使用它们；re-export 新符号给构建脚本）
- Modify: `scripts/build/cat-sprites.mjs`（`render()` 透传 `form`/`expression`，遮罩经 `cropsForForm` 取表——`:38-47` 一处）
- Test: `src/renderer/pet/cat-variants.test.ts`（追加 `describe("girl 资产轴 (Task 24)")`）
- Test: `src/renderer/pet/cat-sprite-manifest.test.ts`（追加两条，既有断言一条不动）

**Interfaces:**
- Consumes: Task 6 的 `buildGirlOps`/`PetInput`；Task 9 的 `Expression`/`MOOD_TO_EXPRESSION`；Task 12 的 `sampleClip`；Task 13 的 `bodyClip`/`gestureClip`；Task 1 的 `PetForm`
- Produces:
  - `interface GirlSpritePose { body: string; gesture?: string; p?: number; gestureP?: number; expression: Expression; blink: number; energy: number }`
  - `const GIRL_POSES: Record<PoseName, () => GirlSpritePose>`（**12 个 `PoseName` 语义在猫娘上重写，`PoseName` 联合不动**——spec §9 原话）
  - `const GIRL_CROPS: Record<CropName, CatCrop>`（**暂行值**，Task 25 实测后重钉；头部注释必须写明「暂行」）
  - `cropsForForm(form: PetForm): Record<CropName, CatCrop>`
  - `SpriteSpec.form?: PetForm`（缺省 `"cat"`）、`SpriteSpec.expression?: Expression`

**为什么静帧取「特征帧」而不是 rest**：`GIRL_POSES` 是立绘表，不是动画表——`peek` 的 rest 是「收回来」的状态（`lean 0/headYaw 0`），拿它出图等于 12 张里有几张是同一个站姿。所以每条带 `p`/`gestureP`（缺省 0）， channels ＝ `sampleClip(bodyClip(body), p)` 叠 `sampleClip(gestureClip(gesture), gestureP)`。静帧纯度（R-D9）不破：`sampleClip` 只吃 p，不读时钟（Task 12 已证）。

**为什么 girl 的 `expression` 可以从 `mood` 派生而不用逐行补**：`MOOD_TO_VARIANT` 那 25＋6 行只写 `mood`（文件名冻结，行不能动）；猫娘的脸走 `MOOD_TO_EXPRESSION[mood]`（Task 9 的级联）——同一份语义两个形态各读各的表。`SpriteSpec.expression` 留给**想越级指定**的格子（本任务与 Task 25 都不用，但 `poseVariant` 的立绘四张要 `happy` 脸时它就是出口——`mood: "happy"` 已经能级联到，所以Task 25 也不加行；字段留着是因为 Task 27 之后的运营位会要，删掉它又是另一次 API 面变化）。若评审认为这个字段是「为假想需求设计」，合法动作是删掉它、`GIRL_POSES` 内部消化——**但那就连 Task 25 的 diff 一起重看**，别只删字段。

- [ ] **Step 0: 复核锚点**

```bash
cd /d/Test/workbuddy/cyrene-verge
grep -n "CAT_POSES\|CAT_CROPS\|buildSpriteOps" src/renderer/pet/cat-sprite-manifest.ts | head   # 既有引用点
grep -c "form" src/renderer/pet/cat-variants.ts                                                 # 今天 0：form 轴还不存在
CI=true npx vitest run src/renderer/pet/cat-variants.test.ts src/renderer/pet/cat-sprite-manifest.test.ts   # 基线全绿
npm run check:sprites   # 基线绿（146 张与盘一致）
```

- [ ] **Step 1: 写失败测试**

`src/renderer/pet/cat-variants.test.ts` 追加（`hashOps` 用该文件既有 12 姿态哈希锁的同式——**先读 `:34-46` 的现写法再抄**，下面这段里的 `hashOps` 指代它；若既有实现叫别的名，用别的名，不许造第二个哈希函数）：

```ts
describe("girl 资产轴 (Task 24)", () => {
  const GIRL_SPEC = (pose: PoseName): SpriteSpec => ({ coat: "ink", pose, crop: "full", form: "girl" });

  it("GIRL_POSES 恰好覆盖 12 个 PoseName（与 CAT_POSES 同一个联合，一个不多一个不少）", () => {
    expect(Object.keys(GIRL_POSES).sort()).toEqual(Object.keys(CAT_POSES).sort());
  });

  it("12 个 girl 姿态两两 ops 哈希互异（spec §10 对 cat-variants.test.ts:34-46 的重钉对象）", () => {
    const hashes = (Object.keys(GIRL_POSES) as PoseName[]).map((pose) =>
      hashOps(buildSpriteOps(GIRL_SPEC(pose), { w: 256, h: 256 })));
    expect(new Set(hashes).size, "有两个人形立绘其实是同一张").toBe(12);
  });

  it("语义重写三处硬钉：卧→躺卧系、趴→伏案、炸毛→生气", () => {
    expect(GIRL_POSES.prone().gesture, "趴→伏案：伏在案上是 typeCode 的持片").toBe("typeCode");
    expect(GIRL_POSES.puff().expression, "炸毛→发蓬＋生气").toBe("angry");
    expect(GIRL_POSES.lie().blink, "卧→侧卧：半阖眼与 sleep 的全阖区分").not.toBe(GIRL_POSES.sleep().blink);
  });

  it("girl 位图不吃 mood 通道：同 mood 不同 expression 出不同图（脸走 expression 级联）", () => {
    const a = buildSpriteOps({ ...GIRL_SPEC("sit"), expression: "happy" }, { w: 256, h: 256 });
    const b = buildSpriteOps({ ...GIRL_SPEC("sit"), expression: "angry" }, { w: 256, h: 256 });
    expect(hashOps(a)).not.toBe(hashOps(b));
  });

  it("R-D10 两形态同锁：girl 位图无 text 层、无 SPRITE_DROPPED_LAYERS 成员", () => {
    const dropped = new Set<string>(SPRITE_DROPPED_LAYERS);
    for (const pose of Object.keys(GIRL_POSES) as PoseName[]) {
      for (const op of buildSpriteOps(GIRL_SPEC(pose), { w: 256, h: 256 })) {
        expect(op.kind, `${pose} 出了文本图元`).not.toBe("text");
        if (op.layer) expect(dropped.has(op.layer), `${pose} 画了 ${op.layer}`).toBe(false);
      }
    }
  });

  it("form 缺省＝cat，且 cat 路径逐 op 不变（R-D2 的正对照）", () => {
    const base: SpriteSpec = { coat: "ink", pose: "sit", crop: "square" };
    expect(buildSpriteOps({ ...base, form: "cat" }, { w: 256, h: 256 }))
      .toEqual(buildSpriteOps(base, { w: 256, h: 256 }));
  });

  it("cropsForForm 两表分列：cat 拿到的是 CAT_CROPS 本体（同一引用，不是拷贝）", () => {
    expect(cropsForForm("cat")).toBe(CAT_CROPS);
    expect(cropsForForm("girl")).toBe(GIRL_CROPS);
  });

  it("girl 立绘的五档取景都装得下：ops 边界不出画布（暂行 GIRL_CROPS 的最低门槛）", () => {
    for (const crop of ["full", "bust", "square", "round", "wide"] as const) {
      const size = crop === "wide" ? { w: 1280, h: 720 } : { w: 256, h: 256 };
      const b = opsBounds(buildSpriteOps({ coat: "paper", pose: "sit", crop, form: "girl" }, size))!;
      expect(b.minX).toBeGreaterThanOrEqual(0);
      expect(b.minY).toBeGreaterThanOrEqual(0);
      expect(b.maxX).toBeLessThanOrEqual(size.w);
      expect(b.maxY).toBeLessThanOrEqual(size.h);
    }
  });
});
```

`cat-sprite-manifest.test.ts` 追加两条（既有 72/17 计数锁与三条正对照**不动**）：

```ts
it("SpriteTarget.form 轴已存在且本任务零使用（默认 cat——check:sprites 因此不受影响）", () => {
  expect(SPRITE_TARGETS.every((t) => t.form === undefined || t.form === "cat")).toBe(true);
  expect(NON_CHARACTER_TARGETS.every((t) => t.form === undefined || t.form === "cat")).toBe(true);
});

it("清单导出 girl 侧三件套（构建脚本只靠这一个入口拿全部符号）", () => {
  expect(typeof cropsForForm).toBe("function");
  expect(Object.keys(GIRL_POSES)).toHaveLength(12);
  expect(Object.keys(GIRL_CROPS)).toHaveLength(5);
});
```

Run: `CI=true npx vitest run src/renderer/pet/cat-variants.test.ts src/renderer/pet/cat-sprite-manifest.test.ts`
Expected: FAIL——`GIRL_POSES`/`GIRL_CROPS`/`cropsForForm` 未导出，`SpriteSpec.form` 类型不存在。

- [ ] **Step 2: 实现**

`cat-variants.ts`：

```ts
import { buildGirlOps } from "./girl";
import type { PetInput } from "./form";
import { bodyClip, gestureClip, sampleClip } from "./motion";
import { MOOD_TO_EXPRESSION, type Expression } from "./face";
import type { PetForm } from "../../shared/pet-profile";
```

`SpriteSpec` 加两个可选字段（注释写明：缺省 `cat`；`expression` 缺省时 girl 侧走 `MOOD_TO_EXPRESSION[mood]` 级联）。

**`GIRL_POSES`（12 行，`p`/`gestureP` 是该片的「特征帧」而不是起点——理由见本节开头）：**

```ts
/**
 * 12 个 PoseName 在猫娘上的重写（spec §9：卧→侧卧、趴→伏案、炸毛→发蓬＋生气；PoseName 联合不动）。
 * body 取 bodyClip 的 p 帧，gesture 取 gestureClip 的 gestureP 帧；expression 进 face 层。
 * 数值锚点与四足同源：happy 的 hop 峰 −14px 对应四足 jumpY −8（同一「离地一瞬」）；
 * lie 与 sleep 的区分学四足（blink 0.35 半阖 vs 1 全阖、energy 0.3 vs 0.05，cat-variants.ts:44/:51）。
 */
export const GIRL_POSES: Record<PoseName, () => GirlSpritePose> = {
  sit:     () => ({ body: "sit", expression: "neutral", blink: 0, energy: 0.4 }),
  lie:     () => ({ body: "sleep", expression: "sleepy", blink: 0.35, energy: 0.3 }),
  prone:   () => ({ body: "sit", gesture: "typeCode", expression: "thinking", blink: 0.2, energy: 0.5 }),
  peek:    () => ({ body: "stand", gesture: "peek", gestureP: 0.5, expression: "surprised", blink: 0, energy: 0.6 }),
  stretch: () => ({ body: "stand", gesture: "stretch", gestureP: 0.5, expression: "happy", blink: 0, energy: 0.5 }),
  wash:    () => ({ body: "stand", gesture: "groom", gestureP: 0.5, expression: "neutral", blink: 0, energy: 0.4 }),
  yawn:    () => ({ body: "stand", gesture: "yawn", gestureP: 0.5, expression: "sleepy", blink: 0.2, energy: 0.2 }),
  tilt:    () => ({ body: "stand", gesture: "tilt", gestureP: 0.5, expression: "confused", blink: 0, energy: 0.5 }),
  sleep:   () => ({ body: "sleep", expression: "sleepy", blink: 1, energy: 0.05 }),
  puff:    () => ({ body: "stand", gesture: "shiver", gestureP: 0.3, expression: "angry", blink: 0, energy: 1 }),
  pout:    () => ({ body: "stand", expression: "pout", blink: 0.55, energy: 0.2 }),
  happy:   () => ({ body: "stand", gesture: "hop", gestureP: 0.5, expression: "happy", blink: 0, energy: 0.8 }),
};
```

**`GIRL_CROPS`（暂行值——由 `GIRL_PROPORTION` 反推：耳尖 22、脚线 100、发宽 ±20 → 墨迹约 x 34..86、y 8.5..101.5；**Task 25 用 `--measure` 实测后整表替换**，本表头上那句「暂行」注释在 Task 25 之前不许删）：**

```ts
/**
 * ⚠️ 暂行值（Task 24）：由 GIRL_PROPORTION 的解剖数反推，未经实测。
 * Task 25 用 cat-sprites.mjs --measure 的全表实测替换，并把实测出处与日期写进这段注释
 * （替换 CAT_CROPS 之于 2026-10-22 记录的同款纪律，spec §9）。
 * 与 CAT_CROPS 的结构性差别：猫娘以 x=60 对称（没有尾巴把重心拽到右边），full 的 anchor.x 回 60。
 */
export const GIRL_CROPS: Record<CropName, CatCrop> = {
  full:   { window: [28, 4, 92, 106], anchor: [60, 55], pad: 0.08, mask: "none" },
  bust:   { window: [38, 16, 82, 74], anchor: [60, 45], pad: 0.1, mask: "none" },
  square: { window: [38, 18, 82, 66], anchor: [60, 42], pad: 0.08, mask: "none" },
  round:  { window: [36, 14, 84, 70], anchor: [60, 44], pad: 0.18, mask: "disc" },
  // wide 同 CAT_CROPS 的反推法：高取 full 的 102，宽 = 102×16/9 ≈ 181.3，越界部分是透明边。
  wide:   { window: [-30.7, 4, 150.7, 106], anchor: [60, 55], pad: 0.02, mask: "none" },
};

export function cropsForForm(form: PetForm): Record<CropName, CatCrop> {
  return form === "girl" ? GIRL_CROPS : CAT_CROPS;
}
```

`buildSpriteOps` 分派（既有 cat 路径**一字不动**，girl 是新分支）：

```ts
export function buildSpriteOps(spec: SpriteSpec, size: { w: number; h: number }): DrawOp[] {
  if ((spec.form ?? "cat") === "girl") return buildGirlSpriteOps(spec, size);
  // ……既有 cat 路径原样……
}

/** girl 位图：骨架静帧（clip 特征帧的通道）＋expression 进脸。与 cat 路径共用 placeCrop/丢弃表/落点口径。 */
function buildGirlSpriteOps(spec: SpriteSpec, size: { w: number; h: number }): DrawOp[] {
  const p = GIRL_POSES[spec.pose]();
  const channels: Channels = {
    ...sampleClip(bodyClip(p.body), p.p ?? 0),
    ...(p.gesture ? sampleClip(gestureClip(p.gesture), p.gestureP ?? 0) : {}),
  };
  const input: PetInput = {
    ...placeCrop(GIRL_CROPS[spec.crop], size),
    form: "girl",
    coat: coatOf(spec.coat),
    mood: "idle", t: 0, mouse: null, jumpY: 0, quiet: false,
    pose: { paw: 0, yawn: 0, stretch: 0, tilt: 0, engagement: 0 },  // 四足通道，girl 不读但类型要它
    blink: spec.blink ?? p.blink,
    pet: spec.pet ?? 0,
    energy: spec.energy ?? p.energy,
    channels,
    expression: spec.expression ?? p.expression ?? MOOD_TO_EXPRESSION[spec.mood ?? "idle"],
    speaking: false,
  };
  const dropped = new Set<string>(SPRITE_DROPPED_LAYERS);
  return buildGirlOps(input).filter((op) => op.layer === undefined || !dropped.has(op.layer));
}
```

（`expression` 那行的 `?? p.expression` 实际是恒真——`GIRL_POSES` 每行都写了 `expression`；写成 `??` 链是为了让「表情来源优先级：格内覆盖 > 姿态默认 > mood 级联」这条规则在代码里读得出来，省得下次有人以为 girl 也吃 mood。）

`cat-sprite-manifest.ts`：`SpriteTarget` 加 `form?: PetForm; expression?: Expression;`（注释：缺省 cat，Task 25 才翻）；import 并 re-export `GIRL_POSES`/`GIRL_CROPS`/`cropsForForm`（构建脚本单入口纪律，`cat-sprites.mjs:22-36` 只 bundle 这一个入口）。

`cat-sprites.mjs` 的 `render()`（`:38-47`）两处改：`m.CAT_CROPS[t.crop].mask` → `m.cropsForForm(t.form ?? "cat")[t.crop].mask`；`buildSpriteOps` 的实参对象补 `form: t.form, expression: t.expression` 两个键。

Run: `CI=true npx vitest run src/renderer/pet/cat-variants.test.ts src/renderer/pet/cat-sprite-manifest.test.ts` → 全绿。
Run: `npm run check:sprites` → **绿且产出逐字节不变**（零目标翻 form，render 的默认路径等价）。若这条红了，说明 `render()` 的默认路径被你改出了差异——逐字节 diff 一张 PNG 定位，不许放行。
Run: `npm run check:renderer && npm run check:main` → 绿。

- [ ] **Step 3: 变异验牙（三条，逐条做完立刻还原）**

1. **姿态表缺一档**：`GIRL_POSES` 删掉 `yawn` → 「恰好覆盖 12 个」红（11 ≠ 12），且 `buildSpriteOps` 走到它时抛。改回。
2. **两档同图**：把 `lie` 的条目整个复制成 `sleep` 的内容 → 「两两 ops 哈希互异」红（11 ≠ 12）并点名。改回。
3. **form 分派被摘**：`buildSpriteOps` 里 `(spec.form ?? "cat") === "girl"` 改成 `false`（永远走 cat）→ 「girl 位图无 text 层」之外的 girl 段全红（`buildGirlOps` 没被走到，ops 里没有 girl 部件层）。改回。

- [ ] **Step 4: 台账 + 提交**

`docs/verge/notes/progress.md` 追加：**口径差⑯（CROP_CRITERIA/CROPS 按 form 分列，不覆盖 CAT_CROPS）**——spec §9 写「`CAT_CROPS` 五个 window/anchor 猫娘要重新反推」，读法是把这张表换成猫娘的数。实现是**加第二张表**：`--only=icons` 支路 5 个文件（spec §9 :355）仍是四足（该支路不在 146 张重出清单里，没点名的不换——像素猫是 R-D1 要保的身份，图标是它的门面），CAT_POSES/CAT_CROPS 因此仍有真实消费方，不能删；猫娘的取景与覆盖带进 `GIRL_CROPS` 与 `CROP_CRITERIA` 的 girl 段（Task 25），spec 的意图（猫娘的锚点重新反推、不继承尾巴拽偏的 77）原样兑现。

```bash
cd /d/Test/workbuddy/cyrene-verge
git status --short   # cat-variants.ts / cat-sprite-manifest.ts / cat-sprites.mjs / 两个测试（+ 台账）
git add src/renderer/pet/cat-variants.ts src/renderer/pet/cat-sprite-manifest.ts \
  scripts/build/cat-sprites.mjs src/renderer/pet/cat-variants.test.ts \
  src/renderer/pet/cat-sprite-manifest.test.ts docs/verge/notes/progress.md
git commit -m "$(cat <<'EOF'
feat(pet): 资产管线加 form 轴——GIRL_POSES/GIRL_CROPS 暂行值（v1.5.0 Task 24）

12 个 PoseName 在猫娘上重写（卧→侧卧、趴→伏案、炸毛→生气），取 clip 的
特征帧出静帧而不是 rest（peek 的 rest 是收回来的状态，立绘要探出去那一帧）。
girl 表情走 expression 优先、mood 级联兜底，25+6 行冻结清单一行不动。
CAT_POSES/CAT_CROPS 保留：--only=icons 五件仍是四足（口径差⑯）。
check:sprites 绿且 146 张逐字节不变——form 轴是纯增量。
EOF
)"
```

---

---

## Task 25: 146 张资产翻 `form: "girl"`＋实测重钉取景与覆盖带（P5 先量后钉）

**Files:**
- Modify: `scripts/build/cat-sprites.mjs`（新增 `--measure` 支路；`check()` 的日志行补 form 分布）
- Modify: `src/renderer/pet/cat-sprite-manifest.ts`（六处建表点加 `form: "girl"`；`CROP_CRITERIA` 改 `CROP_CRITERIA_BY_FORM`，girl 段**实测后落**；注释替换 2026-10-22 记录但保留其出处行）
- Modify: `src/renderer/pet/cat-variants.ts`（`GIRL_CROPS` 暂行值 → 实测值，注释换成实测出处）
- Test: `src/renderer/pet/cat-variants.test.ts`（Task 24 那条「ops 边界不出画布」断言保留——实测值也必须过它）
- 产物：146 张 PNG 重出（`src/renderer/react/assets/**`、`src/renderer/tast/*.png`、`src/renderer/react/avatars/*.png`、`src/renderer/public/*.png` 按清单实际路径）

**顺序纪律（spec §13 风险 3 的原文执行）**：**先量后钉，量不出来不改判据**。Step 2（翻表）→ Step 3（`--measure` 出数）→ Step 4（按数改 `GIRL_CROPS`/`CROP_CRITERIA` girl 段）→ Step 5（重出 + `--check`）。中间任何一步量不出来（例如某取景的 girl 覆盖度落在带外且不是取景错），**停下记台账**，不许直接放宽带。

- [ ] **Step 0: 复核**

```bash
cd /d/Test/workbuddy/cyrene-verge
grep -c "form:" src/renderer/pet/cat-sprite-manifest.ts     # Expected: 0（Task 24 只加了类型）
grep -n "measure" scripts/build/cat-sprites.mjs             # Expected: 0 命中——该支路本任务新建
grep -n "72\|17" src/renderer/pet/cat-sprite-manifest.test.ts | head -4   # 计数锁位置复核（:13/:52 一带）
CI=true npx vitest run src/renderer/pet/cat-sprite-manifest.test.ts src/renderer/pet/cat-variants.test.ts
npm run check:sprites    # 基线绿
```

- [ ] **Step 1: 先给 `--measure` 写验收（轻量文本锁 + 干跑）**

`cat-sprites.mjs` 没有测试框架挂载点，验收用「跑出来的输出形状」：

`node scripts/build/cat-sprites.mjs --measure` 必须：
1. **不写任何 PNG**（`git status --short src/renderer` 前后一致）；
2. 输出按 `form × crop` 分组的表：`count / cov min / cov max / off max`；
3. girl 段附带各取景的**联合墨 bbox（viewBox 坐标）**——从 `buildGirlOps` 的 `opsBounds` 并集算，供 `GIRL_CROPS.window` 反推；
4. 以非零 exit 报「量不出来」（例如某组 count=0），不许静默打一张空表。

实现骨架（加在 `check()` 之后、`main()` 的分支表里）：

```js
async function measure() {
  const m = await loadManifest();
  const rows = [...m.SPRITE_TARGETS, ...m.NON_CHARACTER_TARGETS].map((t) => ({ t, ...render(m, t) }));
  const groups = new Map();                     // "form/crop" → { count, covMin, covMax, offMax }
  for (const { t, raster } of rows) {
    const key = `${t.form ?? "cat"}/${t.crop}`;
    const cov = m.alphaCoverage(raster);        // 这两个是 cat-sprite-manifest.ts 既有导出
    const c = m.inkCentroid(raster);            // checkTarget 内部用的同两把尺，不许重写第三份
    const off = Math.hypot(c.x - raster.width / 2, c.y - raster.height / 2) / raster.width;
    const g = groups.get(key) ?? { count: 0, covMin: 1, covMax: 0, offMax: 0 };
    g.count += 1; g.covMin = Math.min(g.covMin, cov); g.covMax = Math.max(g.covMax, cov); g.offMax = Math.max(g.offMax, off);
    groups.set(key, g);
  }
  // girl 的立绘联合 bbox（viewBox 坐标）：12 姿态全集合的 opsBounds 并集
  let bbox = null;
  for (const pose of Object.keys(m.GIRL_POSES)) {
    const b = m.opsBounds(m.buildSpriteOps({ coat: "ink", pose, crop: "full", form: "girl" }, { w: 120, h: 120 }));
    // 120×120 画布 + full 取景下 1 viewBox 单位 = 1px 附近的近似不成立——所以这里量的是 ops 的 viewBox 坐标：
    // buildGirlOps 的 op 点本来就是 viewBox 系（placeCrop 只改 u/center，部件坐标不改），直接并集即可。
    bbox = bbox ? { minX: Math.min(bbox.minX, b.minX), minY: Math.min(bbox.minY, b.minY),
                    maxX: Math.max(bbox.maxX, b.maxX), maxY: Math.max(bbox.maxY, b.maxY) } : b;
  }
  for (const [key, g] of [...groups.entries()].sort()) {
    if (g.count === 0) throw new Error(`${key} 组是空的——量不出来不许进 Step 4`);
    console.log(`${key}  n=${g.count}  cov ${g.covMin.toFixed(3)}..${g.covMax.toFixed(3)}  off≤${(g.offMax * 100).toFixed(1)}%`);
  }
  console.log(`girl 立绘联合 bbox（viewBox）: x ${bbox.minX.toFixed(1)}..${bbox.maxX.toFixed(1)}  y ${bbox.minY.toFixed(1)}..${bbox.maxY.toFixed(1)}`);
}
```

（`alphaCoverage`/`inkCentroid` 若今天不是导出符号，在 `cat-sprite-manifest.ts` 把 `export` 补上——它们本来就是 `checkTarget` 的两条腿，导出不改行为。`opsBounds` 从 `ops.ts` 经 manifest 入口 re-export。`main()` 里 `if (process.argv.includes("--measure")) return measure();` 放在 `--check` 分支**前面**还是后面都行，两个互斥。）

跑红方式：先只加分支不写函数体，`--measure` 报 `measure is not defined` 或直接 exit 非零——确认支路被走到，再写实装。

- [ ] **Step 2: 翻表（六处建表点加 `form: "girl"`）**

`cat-sprite-manifest.ts`：`SPRITE_TARGETS` 的六个展开块（`:114-153`）与 `NON_CHARACTER_TARGETS` 的 map（`:198-202`）各加 `form: "girl"`。72/25/12/12/4/4/17 的条数一行不动（`cat-sprite-manifest.test.ts` 的两条计数锁就是护栏）。**贴纸 52 张不翻**（spec §13 延后「sticker 猫娘版」），`--only=icons` 5 件不翻（口径差⑯）。

Run: `CI=true npx vitest run src/renderer/pet/cat-sprite-manifest.test.ts`
Expected: 只有 Task 24 那条「form 轴零使用」红（现在 146 条都是 girl）——把它改成 `every((t) => t.form === "girl")`；其余断言（含三条正对照的**语句结构**）不动，它们此刻是否绿由 Step 4 的带决定，现在不用管。

Run: `npm run check:sprites`
Expected: **红**——146 张按 girl 渲染、盘上还是 cat 字节，「与磁盘不一致」成片报。这是本任务唯一一次「`--check` 红是预期中间态」；红的内容必须**只有**「与磁盘不一致」和可能的覆盖/质心出界，出现别的错（尺寸、缺文件）先停下查。

- [ ] **Step 3: 量**

```bash
node scripts/build/cat-sprites.mjs --measure
```

把输出**原样**抄进 `docs/verge/notes/progress.md`（它就是新的实测记录，替代 2026-10-22 那 129 条）。girl 的分布必须是 square 76 / bust 25 / full 16 / round 12 / wide 1——与 2026-10-22 的 129 条同构，不是这个分布先查 Step 2 是不是翻漏了。

- [ ] **Step 4: 钉（按 Step 3 的数改两处）**

① `GIRL_CROPS`：用联合 bbox 重推五档 `window`，`anchor` 按取景语义给（`full` 的 anchor.x＝60——猫娘以中线对称，**不继承猫的 77**，那 17 个单位是尾巴拽的；`round` 的 anchor 让头心落盘心）。每档改完用 Task 24 那条「ops 边界不出画布」过一遍。
② `CROP_CRITERIA` → `CROP_CRITERIA_BY_FORM`：

```ts
const CROP_CRITERIA_BY_FORM: Readonly<Record<PetForm, Readonly<Record<CropName, CropCriteria>>>> = {
  cat: { /* 现五行原样，含 2026-10-22 的注释 */ },
  girl: {
    // <实跑当日 YYYY-MM-DD>（下称「本期实测日」，与 progress.md 台账同一日期）实测 N=129（square 76 / bust 25 / full 16 / round 12 / wide 1，
    // 记录见 docs/verge/notes/progress.md 本期小节）：两端放宽 0.04–0.06、质心 +3pp，
    // 方法与 2026-10-22 的猫表同款（见下行保留的旧出处）。
    square: { cov: [……实测 min−0.04..max+0.04], off: ……实测+0.03 },
    ……
  },
};
```

旧注释**不许整段删**——留一行「cat 段的带来自 2026-10-22 四足实测 129 条（原注释全文见 git 历史与本行上一段）」，出处链不能断。`checkTarget` 里 `CROP_CRITERIA[t.crop]` 改成 `CROP_CRITERIA_BY_FORM[t.form ?? "cat"][t.crop]`（`:247` 的 wide/height 分支同改）。

③ **正对照必须仍然能红**（spec §10 的原话）：`cat-sprite-manifest.test.ts:43` 那条「拿 full 的图去量 square 档」现在走的是 girl 带——跑 `CI=true npx vitest run src/renderer/pet/cat-sprite-manifest.test.ts`，若该条变绿，说明 girl 的 square/full 带宽重叠到失去分辨力（窄高剪影的 full 覆盖度天然比方脸猫高，两带可能真的贴上）。合法出路只有两条：**收窄余量**（0.04→0.02，但要在台账写明）或**把正对照换成仍能分开的一对**（例如 full 图量 bust 档），并把换对的理由写进测试注释与台账。**不许**删该条、不许把断言换成「恒真」、不许为它对 girl 开例外带。

- [ ] **Step 5: 重出 + 全量验收**

```bash
node scripts/build/cat-sprites.mjs          # 重出 146 张
npm run check:sprites                        # Expected: 绿
CI=true npx vitest run                       # 全绿（含 Step 2 改过的 form 锁与 Step 4③ 的正对照）
npm run check:renderer && npm run check:main
git status --short src/renderer/public/stickers src/renderer/public/icons 2>/dev/null
# Expected: 空——贴纸 52 张与图标支路一字节不动
git diff --numstat -- "*.png" | wc -l        # Expected: 146
```

- [ ] **Step 6: 变异验牙（两条，做完还原）**

1. **带宽哑尺**：把 girl 的 `square.cov` 上限改成 `0.99` → Step 4③ 的正对照或 Task 24 的边界断言必须有至少一条红；若全绿，说明带已经宽到没牙——回去按实测重收。改回。
2. **张冠李戴**：把某一张 `status-moods` 目标改回 `form: "cat"`（一行）→ `check:sprites` 红（该张按 cat 渲染、用 girl 带量/与盘上 girl 字节不一致，两条路都红）。改回。

- [ ] **Step 7: 台账 + 提交**

`docs/verge/notes/progress.md` 追加：`--measure` 全表输出（Step 3 原样抄）、`GIRL_CROPS` 五档的 window/anchor 终值与反推一句式理由、girl 带宽的余量数（0.04/0.03 或收窄后的值）、Step 4③ 的处置结果、口径差⑯的落槌确认。

```bash
cd /d/Test/workbuddy/cyrene-verge
git add src/renderer/pet/cat-variants.ts src/renderer/pet/cat-sprite-manifest.ts \
  scripts/build/cat-sprites.mjs src/renderer/pet/cat-variants.test.ts \
  src/renderer/pet/cat-sprite-manifest.test.ts docs/verge/notes/progress.md \
  $(git status --short -- "*.png" | awk '{print $2}')
git commit -m "$(cat <<'EOF'
feat(pet): 146 张派生资产重出为猫娘（v1.5.0 Task 25）

SPRITE_TARGETS 129 + NON_CHARACTER 17 全部翻 form:"girl"，文件名与语义冻结。
GIRL_CROPS 五档 window/anchor 由 --measure 实测重推（暂行值退役），
full 的 anchor.x 回 60——猫娘中线对称，不继承猫尾巴拽偏的 77。
CROP_CRITERIA 改按 form 分列：cat 段与 2026-10-22 出处原样保留，
girl 段本期实测 N=129 落带，方法与余量同款。
贴纸 52 张与 --only=icons 5 件不翻（spec §13 延后 / 口径差⑯）。
正对照三条例（maxKb=0 / 跨取景 / wide 缺 height）重带后逐条复核仍能红。
EOF
)"
```

---

## Task 26: 尺 #71——真窗命中实测，`FORM_GEOMETRY.girl` 由数据反钉

**Files:**
- Create: `scripts/verify/pet-hit-cdp.mjs`（尺 #71 本尺）
- Modify: `src/renderer/pet/renderer.ts`（`getHitAreaDefs():448-450` 改成读**活**的 `lastSent`/`profile`——它今天钉死 `PIN` 与 `e: 0`，从来没被调过，这是它第一次有消费方；`getPetDiagnostics` 的输出由 main.ts 那份组装，renderer 侧补一个 `getHitRect()` 公开口）
- Modify: `src/renderer/main.ts`（`__cyrene.getPetDiagnostics` 追加 `form`/`tier`/`hitRect` 三个读数）
- Modify: `src/shared/pet-profile.ts`（`FORM_GEOMETRY.girl` 的 `{0.86, 1.55, -0.75}` → **实测值**，注释写出处：日期、脚本、样本）
- Modify: `package.json`（`scripts` 加 `"verify:pet-hit": "node scripts/verify/pet-hit-cdp.mjs"`，紧跟 Task 18 的 `verify:work-status`）
- Test: `src/renderer/pet/renderer.test.ts`（追加 `describe("hitRect 读数 (Task 26)")`，新 describe 自带 harness——既有四份的先例见 Task 20 台账）

**Interfaces:**
- Consumes: Task 3 的 `computeCatRect`（已吃 `profile`）；Task 17 的 `this.profile` 与 boot 链路；Task 18 的 CDP 四件套（`Session`/`evaluate`/`shoot`/`findPetTarget`，`work-status-cdp.mjs` 是其蓝本）
- Produces: 尺 #71 的可重复入口 `npm run verify:pet-hit -- <shotsDir>`；`FORM_GEOMETRY.girl` 的实测终值

**这把尺量什么（spec §10 #71 原文口径）**：真窗起猫，逐 `form × tier`（2×3＝6 组）读画布 alpha，每组产出三行——可点像素占窗口比、墨 bbox、质心；判据两条——**交互框与实测 bbox 的 IoU ≥ 0.55**、**头部中线一列必须有可点像素**。「交互框」＝ `computeCatRect` 在当前 profile/e 下算出的 rect（应用以为自己会被点到的那块）；「可点」沿用运行时同一条判据 `alpha ≥ 10`（`click-through.ts:42`）。**永不点击**：不 `Input.dispatchMouseEvent`，不碰任何控件——`p4-cdp-capture.mjs:180-213` 的 `click*` 三件套**不搬**。

- [ ] **Step 0: 复核锚点**

```bash
cd /d/Test/workbuddy/cyrene-verge
grep -n "getHitAreaDefs\|readAlpha" src/renderer/pet/renderer.ts        # :448/:453 一带
grep -rn "getHitAreaDefs" src --include=*.ts | grep -v "renderer.ts"    # Expected: 0——它今天没有消费方
grep -n "hitRect\|form:" src/renderer/main.ts                           # diagnostics 现状
node scripts/verify/work-status-cdp.mjs --help 2>&1 | head -3 || true   # 蓝本可跑（P3 已验）
```

- [ ] **Step 1: 写失败测试（renderer 侧读数）**

`renderer.test.ts` 新 describe（harness 照 Task 17 段的 `makeVergeStub`/`makeCanvas`/`makeLoopDriver` 三件套，verge stub 必装——`syncGeometry` 会走 `resizePetWindow:520`）：

```ts
describe("hitRect 读数 (Task 26)", () => {
  it("cat/standard：hitRect 与 computeCatRect 的活参调用逐字段相等", async () => {
    const { r } = await makeR();                          // 本 describe 自带的 harness
    const d = r.getHitRect();
    const expectRect = computeCatRect({ pinInWin: /* syncGeometry 后 renderer 手里的钉位——用 r 的只读诊断或从已知 wa/centerBounds 现算 */ , e: /* 当前 e */ });
    expect(d).toEqual(expectRect);
  });

  it("girl 的 hitRect 比 cat 窄且高（FORM_GEOMETRY 的结构约束在运行时成立）", async () => {
    const { r } = await makeR();
    const catRect = r.getHitRect();
    r.setProfile({ form: "girl", tier: "standard" });
    const girlRect = r.getHitRect();
    expect(girlRect.width).toBeLessThan(catRect.width);
    expect(girlRect.height).toBeGreaterThan(catRect.height);
  });

  it("三档 k 落在 hitRect 上：large 的宽 = standard × 1.22（±0.5px 取整容差）", async () => {
    const { r } = await makeR();
    r.setProfile({ form: "girl", tier: "standard" });
    const s = r.getHitRect();
    r.setProfile({ form: "girl", tier: "large" });
    expect(r.getHitRect().width).toBeCloseTo(s.width * 1.22, -0.5);
  });
});
```

Run: `CI=true npx vitest run src/renderer/pet/renderer.test.ts -t "hitRect"`
Expected: FAIL——`getHitRect is not a function`。

- [ ] **Step 2: 实现读数链**

`renderer.ts`：

```ts
  /**
   * 当前命中矩形（css px，窗口内坐标）：computeCatRect 吃活的 pinInWin/e/profile。
   * 尺 #71 与 click-through 之外，它也是右键菜单 hit 判定的唯一正确来源——
   * getHitAreaDefs 此前钉死 PIN/e:0 且无人调用（2026-10-24 grep 实测 0 消费方），本任务顺手修好并接上。
   */
  getHitRect(): Rect {
    return computeCatRect({ pinInWin: this.lastSent?.pinInWin ?? PIN, e: this.lastE ?? 0, profile: this.profile });
  }
```

（`lastE`/`lastSent` 的现有字段名以 `:490-520` 那段 payload 的实际字段为准——Step 0 的 grep 若显示 e 存在别的字段上，用那个；没有就把 `requestBounds` 里那份 `e` 存成 `this.lastE`。`Rect` 类型从 `pet-geometry` 引。）

`getHitAreaDefs` 改成 `return [{ name: "cat", rect: this.getHitRect() }];`——一个消费方（诊断）也是消费方，死方法就此复活。

`main.ts` 的 `getPetDiagnostics`（`:134-138`）追加三个键：`form`/`tier`（renderer 读 `this.profile`）、`hitRect: renderer.getHitRect()`。`cyrene.d.ts`/类型声明若有 diagnostics 的类型镜像，同步加（grep `paused:` 找声明点）。

Run: `CI=true npx vitest run src/renderer/pet/renderer.test.ts` → 全绿；`npm run check:renderer` 绿。

- [ ] **Step 3: 写尺 #71 脚本**

`scripts/verify/pet-hit-cdp.mjs`——四件套照 `work-status-cdp.mjs` 搬（它已经从 `p4-cdp-capture.mjs` 搬过一次，本尺再搬一次：**只搬 `Session`/`evaluate`/`shoot`/`findPetTarget`/`dumpAndKill`**），差异点：

```js
// P5 尺 #71：运行时命中覆盖。逐 form × tier 起真窗，读画布 alpha。
// 用法：node scripts/verify/pet-hit-cdp.mjs <shotsDir>
// - 只读只截，永不点击；profile 只落在 D:\cyrene-p5-accept\profile（一次性目录）。
// - 找不到猫窗/画布读不出数 → 报 ENV 红（「量的前提没了」，不是「产品红」），措辞分开。
const PROFILE = "D:\\cyrene-p5-accept\\profile";
const DEBUG_PORT = 9335;
const COMBOS = [
  ["cat", "small"], ["cat", "standard"], ["cat", "large"],
  ["girl", "small"], ["girl", "standard"], ["girl", "large"],
];
const IOU_MIN = 0.55;
```

每组量测的页面表达式（alpha 判据与 `click-through.ts:42` 同一个 10，坐标换算用 `c.width / window.innerWidth` 的 dpr 比）：

```js
const MEASURE = `(() => {
  const c = document.getElementById("pet-canvas");
  const d0 = window.__cyrene?.getPetDiagnostics?.();
  if (!c || !d0 || !d0.hitRect) return null;
  const g = c.getContext("2d", { willReadFrequently: true, alpha: true });
  const dprX = c.width / window.innerWidth, dprY = c.height / window.innerHeight;
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let n = 0, minX = Infinity, minY = Infinity, maxX = -1, maxY = -1, sx = 0, sy = 0;
  for (let y = 0; y < c.height; y += 1) for (let x = 0; x < c.width; x += 1) {
    if (d[(y * c.width + x) * 4 + 3] < 10) continue;      // 与 click-through 同一阈值
    n += 1; sx += x; sy += y;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  if (!n) return { ink: 0 };
  // 头部中线：bbox 顶往下 35% 的带里，窗口中线那一列（±1px）必须得有墨——「点头顶点不中」的防线
  const midX = Math.round(c.width / 2), headBottom = minY + (maxY - minY) * 0.35;
  let headCol = false;
  for (let y = minY; y <= headBottom && !headCol; y += 1)
    for (const x of [midX - 1, midX, midX + 1])
      if (d[(y * c.width + x) * 4 + 3] >= 10) { headCol = true; break; }
  return { ink: n, bbox: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
           centroid: { x: sx / n, y: sy / n }, headCol, dprX, dprY,
           win: { w: c.width, h: c.height }, diag: d0 };
})()`;

const iou = (a, b) => {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  return inter / (a.w * a.h + b.w * b.h - inter);
};
```

主循环：每组 `writeProfileState({ form, tier })`（同 Task 18 的写法，`verge/state.json`）→ spawn → `findPetTarget(150_000)` → 等 2s 让 boot 读落定 → `evaluate(MEASURE)` → 判据：

```js
  // hitRect 是 css 坐标，乘 dpr 进画布设备像素再算 IoU
  const hit = { x: m.diag.hitRect.x * m.dprX, y: m.diag.hitRect.y * m.dprY,
                w: m.diag.hitRect.width * m.dprX, h: m.diag.hitRect.height * m.dprY };
  const overlap = iou(hit, m.bbox);
  // 每组三行进报告：可点像素占比 / 墨 bbox / 质心（spec #71 原话）
  report[`${form}/${tier}`] = { clickableRatio: +(m.ink / (m.win.w * m.win.h)).toFixed(4),
    bbox: m.bbox, centroid: { x: +m.centroid.x.toFixed(1), y: +m.centroid.y.toFixed(1) },
    iou: +overlap.toFixed(3), headColumn: m.headCol };
  if (!(overlap >= IOU_MIN)) fails.push(`${form}/${tier}: IoU ${overlap.toFixed(3)} < ${IOU_MIN}`);
  if (!m.headCol) fails.push(`${form}/${tier}: 头部中线一列无可点像素`);
```

报告落 `pet-hit-report.json`＋每组一张整窗 PNG。**反钉输出**：girl 三组给 `suggestedHitAspect = { width: bbox.w/(u·k), height: bbox.h/(u·k) }`（`u·k` 从 `hitRect.width / FORM_GEOMETRY.girl.hitAspect.width` 现算——读数反推，不从源码再抄一份常量），打在报告里，人把它四舍五入到 0.01 写回 `pet-profile.ts`。

- [ ] **Step 4: 跑尺、反钉、复跑**

```bash
npm run verify:pet-hit -- D:\Test\workbuddy\cyrene-verge\docs\verge\shots\v1.5.0-p5-hit
```

1. 首跑：若 girl 组 IoU ≥ 0.55 全过，说明暂行 `{0.86, 1.55, -0.75}` 已经贴着墨——仍按报告里的 `suggestedHitAspect` 把 `pet-profile.ts` 的值换成实测反推值（注释写「<实跑当日 YYYY-MM-DD> `verify:pet-hit` 六组实测反钉，报告见 shots 目录」），**复跑**一次确认仍绿。若首跑就红，按 suggested 值改，改到绿为止；每改一次复跑一次。
2. cat 三组也必须全绿——它是这把尺的「既有形态对照」；cat 红＝尺本身坏（比如 dpr 换算反了），不许只修 girl 不看 cat。
3. 把六组的三行读数原样抄进 `docs/verge/notes/progress.md`。

- [ ] **Step 5: 变异验牙（spec §10 变异④）**

把 `FORM_GEOMETRY.girl.hitAspect.height` 写回 `1.85`（四足的值）→ `verify:pet-hit` 必须红在 girl 三组的 IoU 上，且 cat 三组仍绿（证明红的是 girl 的几何错，不是尺坏了）。改回实测值，复跑绿，**两次输出都抄进台账**。

- [ ] **Step 6: 台账 + 提交**

```bash
cd /d/Test/workbuddy/cyrene-verge
git add scripts/verify/pet-hit-cdp.mjs src/renderer/pet/renderer.ts src/renderer/main.ts \
  src/renderer/pet/renderer.test.ts src/shared/pet-profile.ts package.json docs/verge/notes/progress.md
git commit -m "$(cat <<'EOF'
feat(pet): 尺 #71 运行时命中实测，girl 命中几何由数据反钉（v1.5.0 Task 26）

pet-hit-cdp.mjs 逐 form × tier 起真窗读画布 alpha：可点像素占比 / 墨 bbox /
质心三行进报告，交互框×墨 bbox IoU ≥ 0.55 + 头部中线可点像素为硬判据。
getHitAreaDefs 钉死 PIN/e:0 且零消费方（grep 实测），改为读活的
pinInWin/e/profile 并经 getHitRect 进诊断口——死方法就此有了尺这个读者。
FORM_GEOMETRY.girl 的暂行 {0.86,1.55} 换成六组实测反推值，出处进注释。
变异④（写回 1.85）复验：girl 三组红、cat 三组绿，尺有牙。
EOF
)"
```

---

---

## Task 27: 翻默认（girl/large）＋设置页选择器＋三档端到端收口

**Files:**
- Modify: `src/main/verge/verge-store.ts`（`DEFAULT_VERGE_STATE` → `{ form: "girl", tier: "large" }`；`VergeState`/`toState` 自 Task 7 起已有，**只翻默认那一行**）
- Modify: `src/shared/ipc-channels.ts`（`SETTINGS_GET_PET_PROFILE` / `SETTINGS_SET_PET_PROFILE` 两条，追加在 `SETTINGS_SET_PET_ZOOM:144` 之后）
- Modify: `src/main/settings/settings-ipc.ts`（`:222-224` 的 `SET_PET_ZOOM` 之后注册两条；写路径复用 Task 17 的 `applyProfileState` 收口，读路径回 `{form, tier}` 两个字符串）
- Modify: `src/preload/index.ts`（`:353` 之后补 `getPetProfile`/`setPetProfile`）
- Modify: `src/renderer/global.d.ts` + `src/renderer/settings/shared/types.ts`（`window.settings` 类型镜像，两处同轮改）
- Modify: `src/renderer/react/features/settings/AppearanceSettingsPage.tsx`（`:377-378` petZoom 行之后加「形象」「身形」两行 `SettingsSegmented`，样式照 `:305-308` 的 theme 行）
- Modify: `src/renderer/react/i18n/zh-CN.json`（`:1285` 后）、`en.json`（`:1285` 后）、`ja-JP.json`（`:1309` 后）各 9 个键
- Modify: `src/renderer/pet/renderer.ts`（最后 4 处基址字面量 `:381`/`:563`/`:667`/`:668` → `this.profile.base`——Task 17 已换 `:401`/`:544`，本次收齐）
- Test: `src/main/verge/verge-store.test.ts`（Task 7 的默认值断言**重钉**：`cat/standard` → `girl/large`）
- Test: `src/main/settings/settings-ipc.test.ts`（追加两条通道的写读回环）
- Test: `src/renderer/pet/renderer.test.ts`（追加「三档端到端」describe，自带 harness）
- Test: `src/renderer/react/i18n/resources.test.ts` 不改（它的 parity 锁自动咬住新键——漏翻任何一语言立刻红）

**Interfaces:**
- Consumes: Task 7 的 `VergeState.form/tier` 与菜单广播；Task 17 的 `applyProfileState`/`setProfile`/`getProfile` 全链；Task 1 的 `profileFor`
- Produces: 产品默认值翻转（spec R-D1「猫娘为默认」+ §2「猫娘默认大」）；设置页两个选择器；renderer 基址读取全部走 `this.profile`

**翻哪一层、不翻哪一层（本任务最容易做错的地方）**：

| 层 | 翻吗 | 为什么 |
|---|---|---|
| `DEFAULT_VERGE_STATE`（verge-store） | **翻** `girl`/`large` | 这是产品默认：没选过的人拿新默认，选过的人盘上有显式值（Task 7 的 toState 回落路径） |
| `DEFAULT_PROFILE`（pet-geometry） | **不翻**，恒 `cat/standard` | 它是**几何兜底**，不是产品默认：`computePetLayout` 的不带参调用与 ~70 把屏幕尺钉的 82×108 全靠它；宠物窗 boot 时 Task 17 的 `getProfile()` 下行在首帧后就把 `this.profile` 顶成店面值，兜底只活在那之前的一瞬 |
| `CompanionEngine` 的 `form` 缺省 | **不翻**，恒 `"cat"` | 引擎构造点由 renderer 的 `setProfile→setForm` 链喂（Task 20 ②已接）；缺省留 cat 是「没接线时退化成今天的猫」的防爆底 |
| 既有用户的 `state.json` | **不改文件** | 存量文件里没有 form/tier 的，读盘回落新默认（＝接受新形象）；有的，一个比特不动 |

**设置页为什么走 `settings:*` 新通道而不是复用 `verge:profile:get`**：Task 17 把 `VERGE_PROFILE_GET` 的发送方钉死成 `["pet"]`（`ipc-sender-policy` 表 + 文本锁），设置窗属 `chat` 类，借了就得放宽那条锁——宠物窗的最小面是 R-D11 的牙，不为设置页松口。`settings:*` 家族（`SETTINGS_SET_PET_ZOOM:144` 那批）本来就是 chat 类窗口的既有通道，不进 sender policy 表（Task 15 的表只收 `VERGE_*`），新两条与 `SET_PET_ZOOM` 同形同权。

- [ ] **Step 0: 复核**

```bash
cd /d/Test/workbuddy/cyrene-verge
grep -n "SETTINGS_SET_PET_ZOOM" src/shared/ipc-channels.ts src/preload/index.ts src/main/settings/settings-ipc.ts src/renderer/global.d.ts src/renderer/settings/shared/types.ts
# Expected: 5 处各一——新两条通道照这 5 处的形状各长一份
grep -n "form\|tier" src/main/verge/verge-store.ts        # Task 7 落的字段与默认值行
grep -rn "ipc-contract" src/main/application/ipc-contract.test.ts | head -3
# 并 grep SETTINGS_SET_PET_ZOOM 是否在 ipc-contract.test.ts 里被点名——若点名（scanner 收录），
# 新两条按同式登记；若不点名（scanner 只扫 verge:* 族），本任务不动契约锁。以实测为准写进台账。
grep -n "PET_W\|PET_H" src/renderer/pet/renderer.ts       # 剩 4 处基址字面量（:381/:563/:667/:668）+ import
```

- [ ] **Step 1: 写失败测试**

`verge-store.test.ts`——Task 7 那两条默认值断言**改写**（不是追加第三份）：

```ts
it("存量 state.json 没有 form/tier：读回落 girl/large（R-D1 新默认），写回补齐且不改别的字段", () => {
  // ……同 Task 7 的 fixture……
  expect(s.form).toBe("girl");
  expect(s.tier).toBe("large");
});
// 「非法值回落」条的期望同步改成 girl/large
```

`settings-ipc.test.ts` 追加（用该文件既有的 ipc mock/harness——先读它怎么 mock `ipc.on`，照抄）：

```ts
it("SETTINGS_SET_PET_PROFILE：写库 + 走 applyProfileState 收口广播两个字符串", () => {
  // 注册 → 模拟 settings 窗发来 { form: "girl", tier: "large" }
  // 断言：writeVergeState 的新 state 带这两个值；applyProfileState/broadcast 被调到一次，
  // 载荷逐字等于 { form: "girl", tier: "large" }（不许带别的键——Task 17 口径差⑦的同一纪律）
});

it("SETTINGS_GET_PET_PROFILE：只回两个字符串（structured clone 过得了，statePath 不出门）", () => {
  const got = /* 调 handle */;
  expect(Object.keys(got).sort()).toEqual(["form", "tier"]);
  expect(() => structuredClone(got)).not.toThrow();
});

it("非法档位被拒：form/tier 不在联合里时不落盘不广播（写端校验只在系统边界做这一次）", () => {
  // 发 { form: "goldfish" } → writeVergeState 零调用、broadcast 零调用
});
```

`renderer.test.ts` 追加「三档端到端」describe（harness 自带，同 Task 17 段三件套；`waMain`/`centerBounds` 照该段的几何）：

```ts
describe("三档端到端 (Task 27)", () => {
  it("setProfile 三档窗口尺寸：70×92 / 82×108 / 100×132 逐字节钉死（spec §8 表）", async () => {
    const { r, verge } = await makeR();
    const sizes: Array<[SizeTier, number, number]> = [["small", 70, 92], ["standard", 82, 108], ["large", 100, 132]];
    for (const [tier, w, h] of sizes) {
      verge.resizePetWindow.mockClear();
      r.setProfile({ form: "girl", tier });
      const call = verge.resizePetWindow.mock.calls.at(-1);
      expect(call?.[0], `${tier} 没触发重排`).toMatchObject({ width: w, height: h });
    }
  });

  it("切档后贴边判据与绘制清屏都读新基址（:381/:563/:667/:668 收口的回归钉）", async () => {
    const { r } = await makeR();
    r.setProfile({ form: "girl", tier: "small" });
    // 读诊断/命中矩形随档缩放——hitRect 是 Task 26 的活读数，这里只钉「换档即变且比例对」
    const small = r.getHitRect();
    r.setProfile({ form: "girl", tier: "large" });
    expect(r.getHitRect().width).toBeCloseTo(small.width * (1.22 / 0.85), -0.5);
  });

  it("boot 默认不再闪猫：main 侧 getProfile 先行的前提下 renderer 缺省仍是 cat（防爆底对照）", async () => {
    const { r, cat } = await makeR();
    expect(cat.form).toBe("cat");     // 没 setProfile 之前，渲染兜底仍是猫——这只对照不许翻
  });
});
```

i18n：往三份 locale 各加（值按下表；`resources.test.ts` 的 parity 锁会当场咬漏翻）：

| key | zh-CN | en | ja-JP |
|---|---|---|---|
| `petForm` | 伙伴形象 | Companion form | コンパニオンの姿 |
| `petFormDescription` | 在像素猫和猫娘之间切换。 | Switch between the pixel cat and the catgirl. | ピクセル猫と猫娘を切り替えます。 |
| `petFormCat` | 像素猫 | Pixel cat | ピクセル猫 |
| `petFormGirl` | 猫娘 | Catgirl | 猫娘 |
| `petTier` | 伙伴身形 | Companion size tier | コンパニオンの大きさ |
| `petTierDescription` | 调整桌面伙伴的体型档位。 | Pick the desktop companion's body size. | デスクトップコンパニオンの体型を選びます。 |
| `petTierSmall` | 小巧 | Small | 小さめ |
| `petTierStandard` | 标准 | Standard | 標準 |
| `petTierLarge` | 大 | Large | 大きめ |

Run: `CI=true npx vitest run src/main/verge/verge-store.test.ts src/main/settings/settings-ipc.test.ts src/renderer/pet/renderer.test.ts src/renderer/react/i18n/resources.test.ts`
Expected: FAIL——新默认/新通道/新键都还不存在；`resources.test.ts` 红在「zh-CN 多了 9 个 key」。

- [ ] **Step 2: 实现**

1. `verge-store.ts`：`DEFAULT_VERGE_STATE` 的 `form: "cat", tier: "standard"` → `form: "girl", tier: "large"`（一行字面量，注释补「R-D1：猫娘为默认；§2：默认大档」）。
2. `ipc-channels.ts`：`:144` 后追加两行——`SETTINGS_GET_PET_PROFILE: "settings:get-pet-profile"`、`SETTINGS_SET_PET_PROFILE: "settings:set-pet-profile"`。
3. `settings-ipc.ts`（`:222-224` 之后；`deps` 里没有 VergeService 引用就按该文件既有 deps 注入方式加——先 grep `deps\.` 看装配形状）：

```ts
  ipc.handle(IPC.SETTINGS_GET_PET_PROFILE, () => {
    const s = deps.vergeService.getState();
    return { form: s.form, tier: s.tier };            // 两个字符串，过 structured clone
  });

  ipc.on(IPC.SETTINGS_SET_PET_PROFILE, (_event, value: { form?: unknown; tier?: unknown }) => {
    const form = PET_FORMS.find((f) => f === value?.form);
    const tier = SIZE_TIERS.find((t) => t === value?.tier);
    if (!form || !tier) return;                       // 非法载荷静默拒：设置页只可能发自家 UI，打日志都不必
    deps.applyProfileState(form, tier);               // Task 17 的收口：写库 + 广播 { form, tier }，唯一路径
  });
```

（若 `applyProfileState` 不在 settings-ipc 的 deps 里，加注入时的形状照 `windowManager` 那条——`deps.applyProfileState` 是装配层函数引用，settings-ipc 不自己写库。**写库与广播只有 Task 17 那一个收口**，本任务不接第二条。）
4. `preload/index.ts`（`:353` 后）：`getPetProfile: () => ipcRenderer.invoke(IPC.SETTINGS_GET_PET_PROFILE)`、`setPetProfile: (value: { form: string; tier: string }) => ipcRenderer.send(IPC.SETTINGS_SET_PET_PROFILE, value)`。
5. 两个类型镜像文件同步加这两个方法签名（grep `setPetZoom` 的两处）。
6. `AppearanceSettingsPage.tsx` petZoom 行后加两行，组件与 `theme` 行（`:305-308`）同一个 `SettingsSegmented`；值源：组件 state 加 `petForm`/`petTier`，boot 时 `window.settings?.getPetProfile()` 灌入（灌入失败回落 `girl`/`large`——与新默认一致，回落值不许写 `cat`）；`onChange` 里 `window.settings?.setPetProfile({ form, tier: values.petTier })` 并 `setStatus(t("settingsPage.applied"))`（沿用 petZoom 的回报口径）。
7. `renderer.ts` 四处：`:381` 与 `:563` 的 `this.catOrigin.x + PET_W` → `+ this.profile.base.width`；`:667-668` 的 `PET_W`/`PET_H` → `this.profile.base.width`/`.height`（这两处是 `|| PET_W` 的兜底形态，保持 `||` 结构只换右操作数）。

Run: `CI=true npx vitest run` → 全绿；`npm run check:main && npm run check:preload && npm run check:renderer` → 绿。

- [ ] **Step 3: 三档真窗冒烟（屏幕层，只截不点）**

用 Task 26 的尺顺路复验：`npm run verify:pet-hit -- <shotsDir>` 六组仍绿（默认翻转不影响尺，尺按 state.json 显式起）；再手动起一次 dev 实例确认**不写 state.json 的全新 profile** 起来就是猫娘大档（人眼一条），截图留 `docs/verge/shots/v1.5.0-p5-default/`。验完删除该临时 profile 目录。

- [ ] **Step 4: 变异验牙（三条）**

1. **写端校验被摘**：`settings-ipc.ts` 删掉 `if (!form || !tier) return;` → 「非法档位被拒」红。改回。
2. **默认没翻**：`DEFAULT_VERGE_STATE` 改回 `cat/standard` → verge-store 重钉条红。改回。
3. **基址漏换**：`:667-668` 改回 `PET_W`/`PET_H` → 「切档后……读新基址」红（`getHitRect` 或清屏有一个读旧宽）。改回。

- [ ] **Step 5: 台账 + 提交**

`docs/verge/notes/progress.md` 追加：**口径差⑰（几何兜底 DEFAULT_PROFILE 不翻、产品默认翻）**——spec R-D1「猫娘为默认」说的是产品默认；`pet-geometry.ts` 的 `DEFAULT_PROFILE` 是屏幕尺体系的参照系，翻它等于一次重钉 ~70 把尺，与「翻默认」无关，两层分开；boot 首帧兜底仍是猫（renderer 缺省对照条钉死），`getProfile()` 下行在首帧后顶正，闪猫窗口为一帧以内、且只在「店面值不是 cat/standard」时存在。另记：设置页走 `settings:*` 新通道而不放宽 `VERGE_PROFILE_GET` 的 `["pet"]` 白名单的理由。

```bash
cd /d/Test/workbuddy/cyrene-verge
git add src/main/verge/verge-store.ts src/shared/ipc-channels.ts src/main/settings/settings-ipc.ts \
  src/preload/index.ts src/renderer/global.d.ts src/renderer/settings/shared/types.ts \
  src/renderer/react/features/settings/AppearanceSettingsPage.tsx \
  src/renderer/react/i18n/zh-CN.json src/renderer/react/i18n/en.json src/renderer/react/i18n/ja-JP.json \
  src/renderer/pet/renderer.ts src/main/verge/verge-store.test.ts \
  src/main/settings/settings-ipc.test.ts src/renderer/pet/renderer.test.ts docs/verge/notes/progress.md
git commit -m "$(cat <<'EOF'
feat(pet): 翻默认 girl/large + 设置页形象身形选择器 + 三档端到端（v1.5.0 Task 27）

DEFAULT_VERGE_STATE 翻 girl/large（R-D1）；DEFAULT_PROFILE 不翻——
它是几何兜底不是产品默认，~70 把屏幕尺的参照系不动（口径差⑰）。
设置页两个 Segmented 走 settings:* 新通道，写库与广播只过 Task 17 的
applyProfileState 收口；VERGE_PROFILE_GET 的 ["pet"] 白名单不放宽。
renderer 最后 4 处 PET_W/PET_H 字面量收进 this.profile.base，
三档窗口尺寸 70×92/82×108/100×132 端到端钉死。
i18n 九键三语同轮，parity 锁自动咬漏翻。
EOF
)"
```

---

## Task 28: 全量门＋spec 回写＋发布 v1.5.0

**Files:**
- Modify: `docs/verge/specs/2026-10-24-catgirl-form-and-motion-design.md`（§13 回写：口径差①–⑱、延后清单增补、尺 #71–#74 落账）
- Modify: `docs/verge/notes/progress.md`（Task 8 已创建并逐任务追加；本任务只写收口小节——若文件竟不存在，说明前面的台账步骤被跳过了，先按 git log 把缺的账补回来再继续）
- Modify: `package.json` + `CHANGELOG.md`（由 `npm run release` 生成，**不手改**）

- [ ] **Step 1: 全量门（逐条跑，输出抄台账）**

```bash
cd /d/Test/workbuddy/cyrene-verge
CI=true npx vitest run
npm run check:main && npm run check:preload && npm run check:renderer
npm run check:brand && npm run check:roster
npm run palette:check && npm run palette:migrate:check
npm run check:sprites
npm run verify:work-status -- D:\Test\workbuddy\cyrene-verge\docs\verge\shots\v1.5.0-final-ws     # 尺 #74
npm run verify:pet-hit -- D:\Test\workbuddy\cyrene-verge\docs\verge\shots\v1.5.0-final-hit       # 尺 #71
```

Expected: 全绿。任何一条红——回对应任务修，**不许**在本任务里「顺手改掉让门过」。

- [ ] **Step 2: spec §13 回写（动手前先 grep 一遍各口径差的落点，凭台账写，不凭记忆）**

spec §13 追加/修订：

1. **口径差台账①–⑱**（每条一行：编号文件:行 → 落点 → 理由一句）。⑬⑭⑮⑯⑰⑱ 的归属：⑬ 粒子非第四层（Task 19/20）、⑭ 闲置表按 form 作用域（Task 19）、⑮ 触摸六类反应按 form 作用域＋双击→玩退役（Task 22）、⑯ 资产取景/覆盖带按 form 分列、icons 支路不翻（Task 24/25）、⑰ 几何兜底与产品默认分层（Task 27）、⑱ 见下一条。
2. **⑱（`getHitAreaDefs` 复活与诊断口扩读数）**：spec §10 #71 只要求「真窗读画布」，实现顺手修好了 `renderer.ts:448` 那个钉死 `PIN/e:0` 且零消费方的死方法，并把 `hitRect/form/tier` 加进 `__cyrene.getPetDiagnostics`——诊断口是测试面，不进 UI；「广告出来的读数就是承诺」，这三个键从此不许静默改名。
3. **延后清单增补**（在 spec 既有清单后追加）：sticker 52 张猫娘版（本期仍是四足，§9 已记）、`--only=icons` 5 件猫娘版（口径差⑯ 引出的新项）、四足的 `IDLE_ACTIVITIES` 退役（口径差⑭）、`ACTIVITY_GESTURE` 收敛（Task 21 台账）、`renderer.test.ts` 四段 harness 各带一份的工程账（Task 14/20 台账）、猫窗气泡文案 i18n（口径差⑧ 撤 `bubbleKey` 时记的那条）。`setRedrawPolicy` 已在 Task 14 删除，从延后清单划掉并注明落点。
4. **尺 #71–#74 落账**：写进屏幕尺台账线（接 native 侧 #70 之后），每条一行：编号、脚本路径、判据、变异验牙编号、本期实测日期。

- [ ] **Step 3: 版本与发布（沿用既有通路，一步不多）**

```bash
cd /d/Test/workbuddy/cyrene-verge
npm run release                       # commit-and-tag-version：package.json → 1.5.0、CHANGELOG、tag v1.5.0
npm run build                         # 本地全量构建门（含 check:brand/check:main/check:preload）
npm run verify:installer -- --expect-version 1.5.0   # 本地有 NSIS 产物时；没有则标 N/A 并在台账写明由 CI 产物验
git -c http.proxy=http://127.0.0.1:7896 push https://github.com/damingslu-ctrl/Cyrene-Agent.git master:master
git -c http.proxy=http://127.0.0.1:7896 push https://github.com/damingslu-ctrl/Cyrene-Agent.git v1.5.0:v1.5.0
gh workflow run package-windows.yml --repo damingslu-ctrl/Cyrene-Agent --ref v1.5.0
gh run list --repo damingslu-ctrl/Cyrene-Agent --workflow package-windows.yml --limit 1   # 盯到绿
```

- **唯一通路**：HTTPS＋7896，fork only——**绝不推 upstream（Playa-Cyrene）**；tag push 与 Test workflow 都不触发打包，必须手动 dispatch（`gh` 默认指上游，`--repo` 一次不许省）。
- CI 绿后下载 NSIS 产物，先 `verify:installer --expect-version 1.5.0`（脚本在 `installer-artifacts.mjs:75-77` 与 package.json 对版本），再按既有纪律核 sha256 进 Release。`electron-builder.yml` 的 `publish: null`（`:6`）不许动。
- `.versionrc.json` 的 `commitUrlFormat/compareUrlFormat` 仍指向上游仓库——CHANGELOG 里的链接会指向 Playa-Cyrene。这是 v1.3.5/v1.4.0 就存在的历史形状，本期**不改**（改它要重生成 CHANGELOG 历史段，超出本期范围），记进台账「已知门面问题，另计一期」。

- [ ] **Step 4: 台账收口 + 计划标记完成**

`docs/verge/notes/progress.md` 写本期收口小节：门输出清单、两把新尺的报告路径、发布产物版本号/字节数/sha256、口径差①–⑱ 一行各一句、延后清单终态。然后把本计划文件顶部状态改为「已完成（<发布当日 YYYY-MM-DD>，v1.5.0 已发布）」，`git add` 三份文档与 `package.json`/`CHANGELOG.md`，提交：

```bash
git commit -m "docs(verge): v1.5.0 收口——spec §13 回写与尺 #71-#74 落账（Task 28）"
```

（发布提交由 `npm run release` 自己造，本提交只收文档。顺序：先 release 再文档收口，CHANGELOG 里就不会漏掉这条 docs 提交——它属于下一版。）

