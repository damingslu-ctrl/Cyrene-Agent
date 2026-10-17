# Clash Verge 桌宠并入 Cyrene — 设计

- 日期：2026-10-17
- 状态：待评审
- 范围：把 native（eframe/egui）Clash Verge 桌宠的全部能力重写进 Cyrene fork，并把 Cyrene 的 agent 子系统按耦合图择优并入
- 相关仓库：`D:\Test\workbuddy\cyrene-verge`（分支 `verge`，remote `upstream` = Playa-Cyrene/Cyrene-Agent@master）、`D:\Test\workbuddy\clash verge`（native 产品 + 70 轮验收资产）

## 1. 决策摘要

五条已经拍板的取舍，本文档其余部分都是它们的推论：

| # | 决策 | 取了什么 | 放弃了什么 |
| --- | --- | --- | --- |
| D1 | 融合语义 | 整体换平台，原地重写：形态从 egui 原生窗改为 Electron + canvas 2D | 保留 native 那份 4.8MB 单进程 exe 的技术栈 |
| D2 | 落点 | fork 上游，做内建模块（与 `memory/`、`channels/` 同级） | 官方 plugin-sdk 路线（可卸载、不改上游） |
| D3 | 形象 | 保住像素猫，用 `PixelPetRenderer` 替掉 `Live2DManager` | Live2D 角色、moc3 秋千物理 |
| D4 | LLM 引擎 | 接本地/中转的 OpenAI 兼容端点 | 11 家内置云厂商的直连 |
| D5 | 双轨 | native 版冻结于 P3 收口（期间只修崩溃级 bug），`clash verge/` 立即转为只读资产库 | 一次性切换（会出现桌面上一只猫都没有的空窗期） |

## 2. 为什么必须先分解

Cyrene 不是「一个聊天框」，它本身就是桌宠 + agent runtime。按 git tree 实测：2503 个 blob / 332 MB，`src/renderer` 246 MB（Live2D + Pixi 素材）、`src/main` 7.4 MB / 1001 文件。`src/main` 下的子系统体量：orchestrator 2655 KB（tools 697 / harness 446 / vendors 418）、channels 496、memory 485、chats 388、moments 377、music 269、plugin-host 142、rag 138、scheduler 132、settings 130、learn 123、proactive 117、storage 116、tts 113、browser 111、email 76、cita 66、code-git 64、windows 62、skills 60。

对照 native 桌宠：**17016 行 Rust / 单进程 / 82×108 逻辑像素透明窗**（`main.rs` 9273、`panel.rs` 3942、`clash_state.rs` 2126、`ui.rs` 1252、`platform.rs` 402、`palette.rs` 21）。它没有 LLM 客户端、没有异步 runtime、没有形象渲染管线，「智能」是规则驱动的自主动作。

「全部融合」在一份实现计划里装不下 30+ 个独立子系统，因此本文档按**期**切分，每期都有可独立验收的交付物与退出条件（架构见 §6，分期与退出条件见 §8）。

## 3. 支撑设计的硬事实

以下每条都在 clone 里读过实现，不是从文件名推断。下文用「§3-N」指本节的第 N 条。

1. **宠物窗的表达入口只有 5 个通道**：`pet:zoom`（`src/shared/ipc-channels.ts:153`）、`pet:visibility-changed`（:42）、`live2d:speech-prepare`、`live2d:mouth-start`、`live2d:mouth-stop`（:286-288），转发点在 `src/main/windows/window-system-ipc.ts:97-105`；第 6 个 `live2d:get-main-diagnostics`（:289）只读诊断，不承载表达。
2. **心情→表情从未进过形象层**：`runtime-state:changed` 只广播给 React 聊天窗（`src/main/application/default-dependencies.ts:175-180`），`feelingToExpression`（`src/main/runtime-state.ts:16-25`）只驱动聊天窗 UI。
3. **主动开口的气泡子系统已被整体删除**（`src/renderer/main.ts:9` 的注释即删除记录；全仓 `bubble` 命中只剩聊天 CSS token）。所以「气泡」在 fork 侧是新增，不是改造。
4. **没有自主动作调度器**：形象层只有 `blink.ts:6-11` 的随机 2.5–6s 眨眼、`expression-reset.ts:18-21` 的 3 分钟回正、`speaking-motion.ts:8-12` 的说话期循环动作。伸懒腰/洗脸/哈欠/歪头这套待机轮播在 Cyrene 里不存在。
5. **宠物窗没有「随内容长大」的机制**：尺寸只能等比 `setSize`（`window-manager.ts:328-337`），基准 400×500（`live2d/manager.ts:12-13`）。但 toast 窗有完整的高度协议可抄：`TOAST_RESIZE → updateHeight → applyBounds → setBounds`（`src/main/toast/toast-window.ts:77-120`）。
6. **宠物窗没挂右键菜单**：`context-menu.ts:9-32` 只 attach 到 chat/sticker/call/music，渲染层无任何 contextmenu 代码；全仓无免打扰（DND）概念。
7. **没有 workArea clamp / 显示器变化监听 / 贴边停靠**：`window-position.ts:8-19` 只做坐标归一，`pet-window-movement.ts:38-47` 只做 16ms 合并的 `setPosition`。
8. **点击穿透是逐像素 alpha**：`click-through.ts:107-126` 每帧 `readPixels` 采样，依赖 `preserveDrawingBuffer:true`（`manager.ts:112`）。这条决定了 HTML 浮层不能叠在宠物窗里（不进 drawing buffer → 恒判透明 → 鼠标穿过去）。
9. **副作用防重放这套 Cyrene 已经有了，而且比 native 侧完整**：四态 outcome（`harness/types.ts:32`）、`SideEffectKind`（:35-38）、映射表 `harness/side-effect-resolver.ts:12-21`（未声明 → `unknown` → 按最危险处理，`tool-registry.ts:187-194` fail-closed）、`uncertainEffects` 入账与 halt（`tool-dispatcher.ts:355-371`、`tool-round.ts:392-405`）、fingerprint 闸门（`uncertain-effect-guard.ts:27-38`）、`non_idempotent` 一律 `no_retry`（`retry-policy.ts:34`）。
10. **但 UI 点击路径完全绕开这套闸门**：面板直接执行不走 `fingerprint` / `ExecutionLedger`（`tool-dispatcher.ts:331-344`）。这是 P3 要解决的结构性缺口，也是 native 侧「误点节点行」事故的等价风险。
11. **`ask_user` 互斥与双时钟已经内建**：排他集合 `{ask_user, confirm_uncertain_effect, submit_plan}`（`tool-round.ts:76-117`），同轮其余调用统一 `not_executed`（:224-257），等待期不计执行超时（:261/:272）。
12. **`onCheckpoint` 已退役**：`harness/run-store.ts:94-95` 抛 `HARNESS_RUN_CHECKPOINT_DISABLED`，durable 边界改为 `onToolLifecycle` + `transcriptSink`（`harness/types.ts:288-292`，装配 `cyrene-harness.ts:342-377`）。README 描述的「每轮 checkpoint」与代码现状不一致，以代码为准。
13. **11 家厂商全部要求 apiKey**（`src/shared/vendor-registry/entries/`），`baseUrl` 可自定义 → 兼容端点走得通；function calling 靠 `supportsTools` + `tool_choice` 怪癖表（`vendors/tool-choice-policy.ts:27-36`），structured output 分 A/B/D/M 四档 × 三模式（`model-types.ts:65-67`、`orchestrator/structured-output/profiles.ts`）。
14. **构建门槛比 README 低**：`pnpm dev` 不含 `build:screenshot-helper`；缺 `cyrene-screenshot.exe` 是功能降级不是崩溃（`screenshot/helper-client.ts:139-141` → `state:"unavailable"`；`screenshot-service.ts:144-150` prewarm try/catch；`background.test.ts:128` 断言降级项）。因此 Rust + VS2022 Build Tools（需管理员）可整体跳过。
15. **死重依赖**：`@lancedb/lancedb`、`@nut-tree-fork/nut-js` 全仓源码零引用，只出现在 `docs/refactor/2026-09-14-dependency-audit-baseline.md:56-59`。`playwright` 不在 `onlyBuiltDependencies` 名单，默认不下载浏览器。
16. **仓库没有视觉回归基建**：无 pixelmatch / golden / screenshot test；`*.visual.test.ts` 实为 JSDOM 读 CSS 断言 token 值（`react-root.visual.test.ts:12-30`）。取帧能力有（`WINDOW_CAPTURE_FRAME`，`window-system-ipc.ts:56`；`canvas.toBlob`，`main.ts:226`），但 E2E 没有。
17. **取帧/模型现状**：Live2D 只有 1 个角色，路径硬编码 `src/renderer/main.ts:74` → `models/cyrene/Cyrene.model3.json`；`model.moc3` 在 git 内；12 个 `.exp3.json` 存在但 `model3.json` 的 `Expressions` 数组为空（表情挂在 motion 的 `"Expression"` 字段上，由 `manager.ts:44-66` 解析）。
18. **BGE-M3 / reranker 权重不在 git**（`.gitignore:210-211`，`models/` 为空），README 引用的 `docs/local-models.md` 在仓库里不存在。不下载就没有向量记忆。

## 4. 合并范围

### 4.1 纳入

- **native 桌宠的全部能力**（§5 清单）——这是产品主体。
- Cyrene 的 **agent runtime**：harness、tool registry、permission/审批卡、`ask_user`、transcript/journal。
- Cyrene 的 **memory(DMAE + Worldbook) / relationship / social-context**：零形象耦合、零第三方账号，是「桌宠有没有人格连续性」的唯一来源，native 侧自研成本最高。
- Cyrene 的 **proactive + scheduler**：让猫主动说话的核心；`proactive-policy.ts` 自带「未配模型即跳过」闸门，配置缺失时优雅退化。
- Cyrene 的 **prompts/（人设语料）+ sticker-\***：内容资产，无 key 也能跑。
- **可选（P5，条件成立才做）**：tts（gptsovits 本地引擎路线）→ 有 TTS 才接 `mouth-sync`；asr / call 推迟到有人明确要（channels 见 §4.2，属排除项）。

### 4.2 明确排除（不是推迟，是划出边界）

| 排除项 | 理由 |
| --- | --- |
| `rag` / `knowledge-base` | 依赖需手动下载的本地权重或云端 embedding，本机零可运行性 |
| `music` | 要网易云 OpenAPI appId + 私钥 + 扫码登录 + mpv 二进制 + `build:music-component`（需 uv/PyInstaller，CI 都不跑） |
| `email` | 要 Google OAuth client id/secret + 浏览器授权 |
| `browser` / `lsp` / `code-git` | 面向「开发工作台」的胶水，与桌宠 persona 无关；`lsp` 要 13 种 language server 在 PATH |
| `channels`（飞书/微信 iLink/QQ） | 要各平台应用凭据；QQ 还要本地 NapCat |
| `plugin-marketplace` | 在线装第三方代码，与「fork 自己维护」冲突 |
| `moments` / `news` | `news` 硬编码上游公告仓库；`moments` 要 LLM + 表情包素材，性价比低 |
| `electron-updater` | 见 §7 R1 |
| Live2D 管线（`pixi.js` + `pixi-live2d-display` + Cubism） | 被 `PixelPetRenderer` 取代；依赖保留在 package.json 里不卸载，但启动路径不再加载 |

排除项带来的收益：上游合并面从 30+ 子系统缩到约 8 个目录，fork 的差异集中在新目录而非改上游文件。

## 5. native 侧必须重建的能力清单

「移植后不许悄悄丢功能」的对照表。列在 spec 里是为了 P3 收口时能逐项打勾。

| 域 | 能力 | 依据（native 侧） | Electron 侧的落点 |
| --- | --- | --- | --- |
| 数据面 | mihomo REST：/proxies /version /configs /connections /traffic(流式) /memory(流式)；一次 /proxies 喂满节点页 | `clash_state.rs` | `src/main/verge/mihomo-client.ts`，采样范式抄 `news/news-feed.ts:91-168`，流式重连抄 `channels/adapters/qqbot/qqbot-ws-client.ts:241` 的 `scheduleReconnect` |
| 数据面 | Verge 侧：verge.yaml / profiles.yaml 解析、订阅到期、`chains[0]` 定去向、7 组里只有 5 组可手动挑节点 | `clash_state.rs` | `src/main/verge/verge-config.ts`（js-yaml 已是依赖） |
| 数据面 | 节点行集契约：两档数据源都列 `all` 原样，DIRECT 不再时有时无；伪节点排最后但保留在闸门/排序/自动实测的旧口径 | #57 | `verge/node-view.ts`，单测锁死 |
| 播报 | 事件驱动状态气泡、说人话文案层 + 人格层、气泡即入口（句子领路到该细看的那页）、节点深链要翻到那一页并画出 | #7/#40/#48/#58/#59 | `verge/narrative.ts` + `PET_RESIZE` + 面板锚点跳转 |
| 播报 | 环形播报帐本（只有真播出去的才进帐）+ 面板「播报」页 + 行也是入口 + 停留 2.5s 才销账 + 已读行从计时表删掉 | #55/#60/#62/#64 | `verge/spoken-ledger.ts` |
| 播报 | 未读角标：在场 + 整行进视口才销账、牌子画条数、清账出口是页头计数器、无欠账降 DIM 不消失、serde 默认已读不造欠账 | #61/#63 | 角标由 `PixelPetRenderer` 画在 `cx+30, y=26` |
| 免打扰 | 右键猫 = 安静半小时；闸门只压 dispatch 不烧凭据；到点自醒当场清 `quiet_until`；醒来说三行值班简报；收起态挂月牙且不许睡脸冒充；标题行「安静 剩 N 分」向上取整 | #52/#53/#54/#66/#67 | 宠物窗 context menu（新增）+ `verge/quiet.ts` |
| 自主动作 | 伸懒腰 / 洗脸 / 哈欠 / 歪头，带待机调度器 | #37 | `renderer/verge/idle-actions.ts`（全仓无先例，从零写） |
| 面板 | 概览（今日曲线 + 近 7 日柱状 + 用量 + 峰值标签让位）、节点页（7 行/页 + 行翻页器 + 快/稳/名排序 + 完整 10 条 history 的微历史条 + 模式药丸）、页签滑动、页脚折叠线约束、20s 无操作收起（五道闸门 + 4s 探针档） | #12/#14/#28/#29/#31/#33/#36/#44/#50/#51 | 独立小窗，音乐窗 9 步配方（§6.3） |
| 交互 | 左键拖拽、精确矩形命中（20px 统一命中区）、Esc 出口、摸头互动与爱心、面板展开动画期间命中区随窗口原点走 | #8/#11/#25/#39/#65 | `setIgnoreMouseEvents(forward)` + 渲染层 `setInteractive` |
| 主动发现 | 代理没生效、当前节点变卡、上行被持续占满（256KB/s 连续 60s 说一次）、切节点回执与反悔、失败在面板关着时也要说、测速中退出两步确认、续订成功一句话 | #24/#26/#34/#41/#42/#47/#18 | `verge/watchers.ts` + `proactive` 闸门复用 |
| 健壮性 | 单实例闸门、崩溃自报 `crash.log`、坏帐本不无声、账本原子写 + 读盘自愈、开机第一眼引导、位置记忆、贴边藏身给线索且关得掉 | #15/#16/#17/#39/#43/#46 | `single-instance.ts` 改名 + `render-process-gone` 系（§6.7） |

美术契约（不进功能表，但进 §6.8 的判据层单测）：74px 吃细线、粉压墨会脏、面板叠色须预混、投影只能差分量、面板底必须不透明、画在猫身外的记号必须双色、`fill_grad` 亚像素扫描线不许叠出 ~0.8 覆盖度（#68/#69）。

## 6. 分期架构

### 6.1 仓库形态与上游合并策略

- 分支：`verge` 为主干；`upstream/master` 每周至少 fetch 一次，rebase 而非 merge（保持单线，便于 bisect）。
- 目录约定：新代码集中在 `src/main/verge/` 与 `src/renderer/verge/`，遵守既有三段范式 `bootstrap.ts` / `<domain>-service.ts` / `<domain>-ipc.ts`（范式见 `scheduler/bootstrap.ts:47`、`proactive/proactive-lifecycle.ts:48`、`music/bootstrap.ts:14-24`）。
- 装配点：组合根在 `src/main/index.ts:34` → `createDefaultApplicationDependencies()`（`application/default-dependencies.ts:259`），阶段划分 prepare(:306) / startShell(:329) / startCore(:361) / startBackground(:841)，顺序权威在 `application/core-bootstrap.ts:119-178`。新模块必须：在 `createLowCostServices`（:378-496）加服务、在 `CoreServices`（`core-bootstrap.ts:39-55`）加字段、在 `registerCoreIpc`（:659-792）注册 IPC、长任务在 background 阶段起并返回 `{dispose}`（:890-898）、清理走 `shutdown.register({id,phase,dispose})`（`core-bootstrap.ts:204-243`）。
- 护栏：`application/ipc-contract.test.ts` + `ipc-contract-scanner.ts:244` 要求注册点从 `index.ts` 可达；preload 是显式白名单（`src/preload/index.ts:124/230/524/583/1061`）。改完必须绿。
- 上游文件的最小改动清单控制在 5 处以内：宠物窗工厂、`renderer/main.ts`（渲染器替换）、window-manager 的 `PET_RESIZE`、preload 白名单、updater gate。其余全部以新目录 + 新通道增量落地。
- 提交格式按 `AGENTS.md:7-10`：`type(scope): 中文描述`。

### 6.2 形象层：`PixelPetRenderer`

替换契约：实现 `getModel / getGL / getHitAreaDefs / applyZoom / resize / pause / resume / dispose`（面定义在 `live2d/manager.ts:222-281`），`renderer/main.ts` 其余链路原样保留。

- 绘制：canvas 2D。色板直译 `palette.rs`（跨模块共享的颜色 token 台账，它的存在理由就是「改一处必须跟着改另外三处」）与 `ui.rs`（1252 行）、`panel.rs`（3942 行）的绘制函数；`preserveDrawingBuffer:true` + `resolution≤2` 的取帧能力必须保留（像素尺的前提）。
- ⚠️ **面板表面色不能照搬**：native 侧 `panel.rs` 的 `BG_SOLID / CARD / SEP` 是为「本机 GL/DWM 管线」预混过的（`palette.rs:1-10` 明确写了这条约束），Chromium 的合成路径不同，预混值搬到 canvas 上会偏。这三个色要在 fork 侧重新按实际管线推导，并把推导结果写进 token 单测——对应 native 的 audit-13 视觉 token 台账。
- 命中：`getHitAreaDefs` 返回单个「猫身矩形」，等价 native 侧 `cat_rect = Rect::from_center_size(center + (17s, -6s), vec2(2u, 1.85u))`（`collapsed u=37, s=u/60`）。逻辑放在 `renderer/verge/cat-rect.ts`，常量导出供单测（对齐 Cyrene 的 `ContextUsageRing.tsx:20-24` 惯例）。
- 待机动作：`idle-actions.ts` 自建调度器（伸懒腰/洗脸/哈欠/歪头），随机间隔与互斥照抄 native 侧的排程；`blink.ts:6-11` 只作参考不作依赖。
- 记号：未读角标、安静月牙、Zzz 由渲染器画，不在 DOM 里（DOM 不进 drawing buffer，见 §3-8）。画在猫身外的记号必须双色。
- 情绪→形象：新增 `verge:feeling` IPC 并接到渲染器（§3-2 那条从未打通的链路，本次补上）。

### 6.3 窗口层

- **基准尺寸**：宠物窗 400×500 → 收起档 82×108 逻辑像素（`petZoom` 等比）。改 `live2d/manager.ts:12-13` 的常量为渲染器可配置项。
- **`PET_RESIZE` 不变式**：抄 toast 的高度协议（`toast-window.ts:77-120`），但锚点是**猫右缘**：窗宽从 82 撑到 150/172（气泡）或 248（面板）时，主进程按 `newLeft = rightAnchor - newWidth` 重算原点。native 侧 `pin` 到 131.0 的行为必须逐位复现，否则所有坐标尺作废、且「面板展开动画期间命中区」（#65）的结论要重测。动画期间命中区跟着窗口原点一起搬是**正确行为**（用户看到的正是当下那一帧），不修。
- **面板 = 独立小窗**：248×482，按音乐窗 9 步配方（入口 HTML → `main.tsx` → `vite.config.mts:120-128` 加 input → 窗口工厂（transparent / frame:false / `backgroundColor:#00000000` / `focusable:false` / show:false / persisted state）→ `window-state.ts` 句柄 + closed 清理 → window-manager 暴露 → preload 白名单 → `ipc.handle` + disposer → `-webkit-app-region` 拖拽）。锚定：订阅宠物窗 bounds 广播，把 `resolveDisplay()` 换成跟随分支。**否决**「宠物窗叠 HTML 浮层」（§3-8）与「复用聊天窗」（min 960×540、非透明）。
- **从零新写四件**：宠物窗 context menu（右键=安静半小时，`Menu.popup({window})` 现成）；`workArea` clamp + `screen.on('display-metrics-changed')`；贴边藏身（含线索与可关开关）；面板 20s 无操作收起五道闸门（判据必须看高度，气泡只撑宽；CPU 按窗口 PID 取；量闲置前先移开光标）。

### 6.4 数据面 `src/main/verge/`

- `mihomo-client.ts`：一次性 `/proxies` 喂满节点页；`/traffic`、`/memory` 是流式（WS/SSE），必须独立连接 + 退避重连；`chains[0]` 决定连接去向。secret/token 从 Verge 运行态读取，自建原子写存储（`storage/rename-with-retry.ts:7`），不复用 `settings-facade.ts:457-465` 的非原子 `writeFileSync`。
- `node-view.ts`：组/节点视图模型，把「7 组里只有 5 组可挑」「伪节点排最后但保留旧口径」「行集不随数据源变」写成纯函数 + 单测。
- `watchers.ts`：代理没生效、节点变卡、上行占满、到期提醒（只用猫气泡，禁 toast；每日一次、跨重启去重）。复用 `proactive` 的冷却闸门而不是自己起 timer。
- 采样循环：`net.fetch` + `AbortController` + cache + `setInterval().unref()` + `dispose`，仅在变化时 `webContents.send`（范式 `news-feed.ts:91-168`）。main→renderer 的节点健康流要新写一层节流/背压。

### 6.5 P3 核心：换节点的唯一执行入口

面板点击与模型工具必须共用同一个执行入口，签名上带 `capability` 与 `fingerprint`，落 `ExecutionLedger`。理由：现状 UI 路径完全绕开闸门（§3-10），会出现「UI 刚换过、模型又换一次且无审计」。

- 工具注册：`effectKind:"external_side_effect"` + `risk:"network"`（样例 `tools/life-tools.ts:67-109`），自动获得 `non_idempotent` 防重放（`uncertain-effect-guard.ts:27-38`）、`no_retry`（`retry-policy.ts:34`）、审批卡（`permission.ts:228`）与 `confirm_uncertain_effect` 闭环。
- 回执与反悔：`prev` 只能在点击那一刻抄（认账排在写回快照前）；失败要敢在面板关着时说出来；两步确认只 gate `testing` 态，窗口常量与气泡停留共用一个值。Alt+F4 / `WM_CLOSE` 在 Electron 里对应 `close` 事件拦截，native 侧那条「仍直达」的缺口这次一并补。
- 永久禁区照抄进 UI 与工具两侧：不点节点行以外的写操作、不碰模式药丸、不擅自 PUT 猜回出口节点。

### 6.6 agent 接入

- 端点：OpenAI 兼容 + 自定义 `baseUrl`。P4 第一件事是**实测该端点的 function calling 与 structured output 支持度**，落档到 `verge/docs/capability-probe.md`；不支持 JSON schema 时退到 `prompt_json`，并确认修复重试（`structured-output/runner.ts`）在低端点上的表现。
- 记忆：DMAE（L0/L1/L2 + 激活/沉默/遗忘抵抗打分）+ Worldbook 原样启用。无 embedding 权重时向量层关闭，走 BM25/jieba 路径（`@node-rs/jieba` 在启动路径上强制加载，不可卸载）。
- 主动性：`proactive`（60s + 抖动自重排，`proactive-trigger.ts:84-86/417`；闸门 `proactive-policy.ts`）作为 verge 播报的第二话筒；`scheduler` 面向用户任务，不拿来做采样。
- 双话筒仲裁：verge 事件气泡与 agent 主动发言共用一个「嘴」。裁决规则照 native 侧「唯一的嘴」：路由绑在句子不绑在调用时刻，进帐只认 `spoken_row`。

### 6.7 持久化、迁移与崩溃

- 目录：`userData/verge/{state.json, usage.json, spoken-ledger.json, crash.log}`；启动时若 `%LOCALAPPDATA%\clash-verge-pet\` 存在且未迁移，做一次性导入 + 原文件只读备份（不删）。不迁就丢位置、帐本、按日用量。
- 崩溃自报：`app.on('render-process-gone')` + `child-process-gone` + `process.on('exit')` + 未捕获异常，写 `crash.log` 并带本地时刻；下次启动若 `crash.log` 有未结记录 → 开机自报。native 侧 `panic=abort` 的「猫无声消失」在 Electron 里等价于 renderer OOM/crash，必须同样可见。
- 单实例：`requestSingleInstanceLock` 的标识与 native 的 `CreateMutexW` 名字区分开（`cyrene-verge` vs `clash-verge-pet`），双轨期间互不抢占；P3 收口后 native 侧改为「检测到 fork 在跑就自己不启动」。
- 开机自启：**这条在 fork 侧是现成的**（`settings/launch-at-login.ts:14` 用 `app.setLoginItemSettings`），不像 native 侧要自己写注册表 Run 键、因而需要你单独授权。启用与否仍按用户显式开关，不默认打开。

### 6.8 验收体系（像素 oracle 的 Chromium 等价物）

Cyrene 没有视觉回归基建（§3-16），因此**不承诺自动 golden**。落地为三层，再加一条性能口径：

1. **判据层（单测）**：几何常量、色板、覆盖度、命中区、文案构造函数全部导出为常量/纯函数，用 vitest 锁死。沿用 native 侧「判据归单测」口径，并把 Cyrene 已有的 `*.visual.test.ts`（JSDOM 读 CSS）作为 token 断言的载体。
2. **插管层（探针档）**：`--verge-probe` 一类的启动开关，让主进程把关键状态（`cat_rect`、`PET_RESIZE` 后的原点、`quiet_until`、帐本末条 `at`）打到 stderr，等价 native 的 `GEOM` / `PTRDN` / `GESTURE` 三行取证。点击的成败**只认盘里的变化**，不许用「屏幕上看见反应」当凭据。
3. **屏幕层（截图尺）**：Python 侧继续用屏幕截图 + 逐像素量，复用 `clash verge/file/verify_*.py` 的判据骨架，只把坐标模型换成「Chromium 透明窗 + DPI 缩放」。已知确定性问题必须先压住再读：chart.js 动画、CSS transition、`motion` 弹层、rAF 节流、Windows 透明窗的 DWM 合成差异。环境前提一律 `require`（当场停手），不写成 `ok`；尺自己崩了不许读成 PASS；环境不合格要 `exit ENV` 并点名压屏窗口。
4. **性能口径**：CPU 随状态差约 10 倍，必须分段取样；跨会话基线会漂，用同进程 A/B；Electron 的取样按窗口 PID 聚合（含 GPU 进程）。

## 7. 风险登记册

| # | 风险 | 处置 |
| --- | --- | --- |
| R1 | `electron-updater` 静默升级会把 fork 覆盖回上游 | P0 关闭（gate 配置 + 单测锁「不会自动更新」），发布走手工打包。代价：上游修复需手动 rebase 带入 |
| R2 | 非管理员 + C: 只剩 ~24G | pnpm store、npm cache、Electron 缓存全部指到 D:；不装 Rust/VS Build Tools；跳过 mingit/mpv/music-component；预计 D: 占用 3–5 GB |
| R3 | `@node-rs/jieba` / `@ast-grep/napi` 在启动路径强制加载，装不上就起不来 | P0 首先验证 `pnpm install --frozen-lockfile` 后 `pnpm dev` 能起；起不来就在 `verge` 分支把这两个的加载改为可选降级（改 import 点：`rag/index.ts:8`、`tools/registry/tool-registration.ts:16`），并在本文档 §9 追加这条偏离的记录 |
| R4 | 兼容端点不支持 function calling → agent 大脑退化 | P4 第一件事是能力探测并落档；退化路线（prompt_json + 修复重试）必须在验收里跑通一条最小工具链 |
| R5 | 70 轮像素尺在 Chromium 下大面积作废（DWM/字体/合成路径不同） | 分层：判据与探针层照搬、屏幕层重写坐标模型；每期的「退出条件」写成「对应尺在 fork 侧绿」，不绿不退役 native 功能 |
| R6 | 双进程互踩（两只猫、两套账本） | §6.7 命名隔离；双轨期间 `state.json` 各写各的，P3 收口后 native 侧让位 |
| R7 | UI 与模型双入口导致重复换节点 | §6.5 唯一执行入口 + `ExecutionLedger`；这是 P3 的验收主项 |
| R8 | 上游活跃（2026-10-16 刚 push、35 open issues），rebase 成本 | 差异集中在新目录；每周一 fetch；改动上游文件≤5 处 |
| R9 | README 与代码不一致（`onCheckpoint` 已退役，§3-12；`docs/local-models.md` 缺失，§3-18） | 一切以 clone 里的代码为准；本文档 §3 的每条都带 file:line |

## 8. 分期与退出条件

> **计划粒度**：本文档是六期的总纲，不是一份可执行的实现计划。下一份计划只覆盖 **P0 + P1**，其余各期在自己的 spec-compliance 检查后再单独出计划——一次计划装不下六期，硬塞的结果是任何一处红都无法定位（见 §10「不采用大爆炸」）。

| 期 | 交付物 | 退出条件（全绿才算完） |
| --- | --- | --- |
| P0 环境与骨架 | 依赖装到 D:、`pnpm dev` 起来、`pnpm test` 绿、updater 关闭、`src/main/verge/` 三段空模块挂上装配点 | `ipc-contract.test.ts` 绿；猫窗未受影响；`git log` 只有一条 `build(verge): 接入内建模块骨架` |
| P1 像素猫进壳 | `PixelPetRenderer` + 82×108 基准 + `PET_RESIZE` 右缘锚定 + 矩形命中 + 拖拽 + 右键 context menu + workArea/显示器监听 + 贴边藏身 | 屏幕上猫在右下角、拖得动、点得中、窗宽随内容撑开且原点按公式左移；藏身给线索且关得掉 |
| P2 数据面 + 面板 | `mihomo-client` + `verge-config` + `node-view` + 面板小窗（概览/节点/播报三页 + 分页 + 排序 + 微历史条 + 20s 收起） | 面板能读到真实 7 组、5 组可挑、行集稳定；只读，不写任何 PUT |
| P3 唯一执行入口 | 换节点（工具 + UI 共用入口、fingerprint、ledger、回执与反悔、两步确认退出闸门）+ `watchers` 全部上线 + 帐本/未读/停留销账 + 三本账迁移 | 判据层与探针层全绿；节点安全网（5 组在用节点哈希）前后一致；**native 版至此冻结** |
| P4 agent 大脑 | 兼容端点接入 + 能力探测落档 + harness/工具注册接 verge + DMAE/Worldbook + proactive 第二话筒 + 待机动作调度器 | 一条最小工具链跑通（模型调 verge 工具 → 审批卡 → 回执 → 进帐本）；没端点时全部优雅退化不崩 |
| P5 二梯队 | 人设语料/贴纸接入；可选本地 TTS → 接 `mouth-sync` | 至少一条人设链路可验证（口癖/贴纸进入气泡文案构造函数，且被 `--voice-probe` 档跑到）；未接 TTS 时 `mouth-sync` 必须保持不加载、不报错。本周期可长期搁置，但搁置要写成明确决定而不是默认漂移 |

`moments`/`news`/`music`/`email`/`browser`/`lsp`/`code-git`/`channels`/`plugin-marketplace`/`rag`/`knowledge-base` 不在任何期的退出条件里。

## 9. 待实测（写实现计划前必须有答案）

1. `pnpm install --frozen-lockfile` 在本机的实际结果与磁盘占用；`pnpm dev` 是否真能起窗（R2/R3）。
2. 兼容端点的 function calling / structured output 档位（R4）。
3. Chromium 透明窗下 82×108 的 DPI 行为：`devicePixelRatio` 与 egui `ppa` 的对应关系、`setIgnoreMouseEvents(forward)` 在小窗上的实际穿透边界。
4. `PET_RESIZE` 在 Windows DWM 下的残影：native 侧靠 canvas 快照 overlay 抑制（`manager.ts:240-245`），fork 侧要确认等效手段。
5. 待机动作调度器需要的「前台闲置」凭据：`GetLastInputInfo` 在 Electron 里要经 native 边（native 侧已有等价实现可参考）。
6. 面板三个表面色（`BG_SOLID` / `CARD` / `SEP`）在 Chromium 合成下的预混重推导（§6.2 的 ⚠️）——P1 出猫身、P2 出面板时各实测一次，结论落进 token 单测。

## 10. 决策记录

- 不采用插件路线：`plugin-sdk` 的 port 面不足以承载常驻小窗、自定义渲染层、右键手势与开机自启，且会削弱「换节点要走同一审计入口」这条硬要求。
- 不采用大爆炸单轨：30+ 子系统 + 559 测试同时动，红了无法定位，且中途 `dist-native/` 断供。
- 保像素猫的代价已被接受：放弃 moc3 物理摆动（秋千惯性需自己写缓动），并自建 Cyrene 体系里没有的两件——待机自主动作调度器、feeling→形象绑定。
- native 侧的验收资产按只读复用，`clash verge/file/verify_*.py` 的判据骨架视为规格的一部分，而不是可丢弃的历史包袱。
