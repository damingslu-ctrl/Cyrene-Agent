<p align="center">
  <img src="./docs/image/preview.png" alt="Mochi" width="800">
</p>

<h1 align="center">Mochi（麻糬）</h1>

<p align="center">
  <a href="./README.en.md">English</a> | <strong>中文</strong>
</p>

**麻糬是一只常驻 Windows 桌面的猫，也是一个能替你干活的桌面 Agent。**

> Electron + TypeScript 写的桌面端 AI 伴侣。像素猫常驻桌面角落，聊天、干活、写代码、陪你学习
> 四种会话模式跑在同一个客户端里；十二只猫各有毛色与性格，助手当选「麻糬」，
> 界面配色从猫身色派生——猫和软件是一套颜色。
>
> **本机构建，不联网检查升级。** 装完就是你的，升级由你决定。

---

## ✨ 速览

- 🐱 **像素猫常驻桌面** — 82×108 的猫窗、像素级命中、点击穿透、右键菜单、拖拽、贴边藏身、免打扰月牙
- 🐾 **十二只猫** — 年糕 / 豆花 / 汤圆 / 布丁 / 抹茶 / 可可 / 芝麻 / 栗子 / 海苔 / 棉花 / 鱼丸 / 奶盖；五档毛色 × 十二档姿态
- 💬 **日常聊天（Chat）** — 只聊天、不给工具；结合会话历史、用户风格与长期记忆作答
- 🛠️ **辅助工作（Work）** — 联网搜索、右侧浏览器、文件处理、文档生成、生活服务等工具自由串联
- 💻 **代码协作（Code）** — 绑定可信目录，LSP 语义查询 + 受限的读写改与命令执行，权限审批统一把关
- 📚 **学习陪伴（Learn）** — 绑定 Obsidian Vault，陪着理解材料、整理笔记、生成练习、维护进度
- 🧠 **个性化记忆** — L0 / L1 / L2 分层记忆 + DMAE Worldbook + 条目生命周期管理
- 🔊 **语音交互** — 多引擎 TTS、ASR 与完整语音通话
- 🧰 **工具生态** — 搜索、文件、文档、生活服务、音乐与 MCP 扩展
- 🧩 **插件系统** — 本地插件包扩展工具、渠道与窗口；SDK 与开发指南随仓库提供
- 📱 **多平台接入** — 飞书、微信 iLink、QQ（NapCat / OneBot 11），共享同一只猫的记忆与语气
- 🌙 **主动聊天** — 按时间、状态与偏好主动开口，并支持多渠道定向投递

---

## 🐱 桌面猫

- **像素猫，不是贴图** — 猫身由自研绘制指令模型逐部件合成（`src/renderer/pet/`），五档毛色
  （奶油 / 灰 / 墨 / 蓝 / 粉）× 十二档姿态自由组合；花色与姿态的每一条取景都有单元测试钉住。
- **82×108 基准 + 右缘锚定** — 猫窗按内容宽度撑开，猫始终贴住窗口右缘，缩放时不会跳位。
- **像素级命中** — 命中判据按猫身实际着墨判定，透明区域点不中；点空白处不误触发。
- **右键菜单** — 猫身上右键出菜单：立即打开设置、免打扰半小时、贴边藏身与退出。
- **贴边藏身** — 拖到屏幕边缘会收进缝里，只留一只耳朵和一条缝；藏身位置会记住，
  下次回来还在那儿，并给一次「我在这儿」的提示。
- **免打扰** — 右键开半小时安静，期间不主动开口；到期自己醒，并把这段时间攒下的话一次性交代清楚。
- **崩溃会说话** — 意外退出后重启，猫会告诉你上次是怎么没的，而不是无声消失。

---

## 🎨 主题外观

界面有两套主题，色板直接从猫身色派生（`src/shared/palette-from-cat.ts`），
所以换猫、换主题时界面和猫不会各走各的。

**☀️ 珍珠白（pearl-white）**

<table>
  <tr>
    <td><img src="./docs/image/light1.png" alt="珍珠白主题界面 1" width="400"></td>
    <td><img src="./docs/image/light2.png" alt="珍珠白主题界面 2" width="400"></td>
  </tr>
</table>

**🌙 经典深色（charcoal-pink）**

<table>
  <tr>
    <td><img src="./docs/image/dark1.png" alt="经典深色主题界面 1" width="400"></td>
    <td><img src="./docs/image/dark2.png" alt="经典深色主题界面 2" width="400"></td>
  </tr>
</table>

---

## ⚙️ Agent 核心引擎

> `Work / Code / Learn` 等需要工具调用的会话模式，全部跑在 **Harness** 之上。
> 源码：[`src/main/orchestrator/harness/cyrene-harness.ts`](./src/main/orchestrator/harness/cyrene-harness.ts)

Harness 是这个客户端的核心 Agent Loop，负责把**模型决策、工具执行、副作用记账与状态恢复**
串成一个可中断、可恢复、可回放的连续循环。

<details>
<summary><b>设计与实现细节</b>（点击展开）</summary>

> 会话轨迹由 **CTA（Canonical Transcript Architecture）** 承载：canonical journal 是唯一权威源，
> 模型上下文、UI 投影与渠道消息全部从 transcript 派生；压缩摘要以 checkpoint 形式持久化，
> 热日志归档到 `segments/`，支持跨进程崩溃恢复与编辑 / 重新生成回溯。
> 源码：`src/main/orchestrator/conversation-*.ts`（store / journal-service / compactor / projection 等）

**关键设计：**

- **连续的 while + Function Calling 循环** — 每轮调用 LLM，按其返回的 `toolCalls` 进入工具派发，无 `toolCalls` 时由模型主动结束当前 turn。
- **assistantMessage 必写回** — 每轮模型返回的 assistant 消息必须无条件 `push` 进 `messages`，否则下一轮模型会看不到自己上一步的回复，loop 立即崩。
- **Ask 互斥路径** — `ask_user` / `confirm_uncertain_effect` 是用户等待类内置工具，必须独占本轮：其余同轮工具全部以 `not_executed` 协议结果写回，并 `discardProgressBuffer()` 丢弃进度文本。
- **四态 outcome 与 uncertainEffects 拦截** — 工具结果分为 `success / failure / unknown / not_executed`。当 `unknown` 且 `sideEffect === non_idempotent` 时，副作用会被记入 `state.uncertainEffects`，并 `halted = true` 暂停本轮后续同类调用，防止自动重放危险副作用。
- **失败重试** — 工具失败时根据 `classifyToolResultError` + `resolveSideEffect` 决定是否重试；`sleepWithJitter` 退避可被 `AbortSignal` 中断。
- **保守并行调度** — 默认串行，仅"显式声明并发安全的纯读工具"可并行（默认上限 4）；结果始终按模型原始 tool-call 顺序提交；halt / error / cancel 时已执行结果不丢弃，出错槽位以合成失败结果闭合 transcript。
- **双时钟超时** — 执行计时与用户等待计时分离：`ask_user` 等待用户期间暂停执行计时，用户思考多久都不消耗任务超时预算。
- **双层压缩（Mid-loop + Journal Compaction）** — harness 每轮开始时根据 token 预算判断是否需要压缩上下文，超阈值时复用 LLM 做历史摘要，保留 todo 与已确定结果，压缩后 checkpoint 失败立即熔断；构建上下文超预算时再触发 journal 级压缩——摘要以 compaction checkpoint 持久化进 transcript，热日志归档至 `segments/`，二次压缩保留前次摘要，编辑 / 重新生成不能跨压缩边界回溯。
- **前缀缓存体系** — 稳定前缀分层（stablePrefix / sessionPrefix / mode），Todo 等易变状态禁止进入前缀；工具清单在 run 期间冻结；动态事实一次性物化进 transcript 而非每轮拼接；`cacheEpoch` 缓存周期跨压缩 / 恢复推进；Kimi `prompt_cache_key` 等厂商缓存 hints 在请求层统一注入。
- **工具输出双级截断** — 大输出落盘存储（`ToolOutputRef`），模型消息只保留 preview；需要完整内容时由模型调用内置 `read_tool_result` 按需回读，大幅降低上下文占用。
- **上下文容量快照** — 每轮请求前与终态各发一次 `context_usage` 快照事件，驱动 UI 上下文环实时显示。
- **截断可见化** — 输出命中模型长度上限（`finishReason = length`）时在回复尾部追加提示，不静默截断。
- **流式优先与降级** — 仅在零增量且供应商明确不支持 stream + tools 时降级非流式，绝不重放半截流；token 用量记账区分缓存命中。
- **全程 signal-aware** — 几乎每个 `await` 都用 `raceWithSignal` 包裹，`signal.aborted` 时返回 `cancelled()`（`finalAnswer = ''`，**不发 `final_answer` 事件**）。
- **每轮 checkpoint** — 通过 `onCheckpoint` 把 `messages` + `state` + `rounds` 持久化，跨进程崩溃后可恢复；恢复时崩溃孤儿工具按运行状态归为 `unknown`（而非误判 `not_executed`），避免重放外部副作用。

**4 种终止状态：**

| 状态 | `terminated` | `terminateReason` | 触发条件 |
| :---: | :---: | :---: | :--- |
| ✅ success | `false` | `undefined` | 模型不再调用工具，主动结束当前 turn |
| ⚪ cancelled | `true` | `cancelled` | `AbortSignal` 触发（`finalAnswer = ''`） |
| 🟥 error | `true` | `error` | LLM 抛错或 checkpoint 失败 |
| 🟨 timeout | `true` | `timeout` | 超过 `config.totalTimeoutMs` |

**主流程：**

```
① 初始化 → ② 主循环 → ③ LLM → ④ 工具调度 → ⑤ 状态账本 → ⑥ 终态结算
```

</details>

---

## 🚀 快速开始

### 前置条件

- **Windows 10 / 11 64 位**
- **Node.js 24 LTS**、**pnpm 10.33.0**（首次可运行 `npm install --global pnpm@10.33.0` 安装）
- **[Rust stable](https://www.rust-lang.org/tools/install)** + **[Visual Studio 2022 Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)**（源码构建截图功能必需；Build Tools 勾选「使用 C++ 的桌面开发」工作负载即可）

> 飞书、微信 iLink、`nut-js` 键鼠自动化及原生截图功能依赖 Windows 环境。
>
> 用打包好的 `Mochi-Setup-<版本号>.exe` 安装时，无需另外安装 Rust 和 Visual Studio Build Tools。

### 1. 克隆并安装依赖

```bash
# 在本仓库根目录执行（仓库地址以你自己的本地路径为准）
pnpm install --frozen-lockfile
```

首次安装会下载 Electron 及其相关依赖，具体耗时取决于网络环境。

### 2. 构建并启动

首次从源码运行时，需要先构建 Rust 原生截图助手：

```bash
pnpm run build:screenshot-helper
pnpm run build
pnpm start
```

> [!IMPORTANT]
>
> 原生截图助手不会以 `.exe` 形式提交到 Git 仓库，因此首次克隆后必须执行一次 `pnpm run build:screenshot-helper`。
>
> **Windows 用户**也可以直接双击项目根目录的 `setup.bat` 完成依赖安装、构建和全局命令链接，之后双击 `start.bat` 即可启动。运行前需安装 pnpm 10.33.0。

开发模式：

```bash
pnpm run build:screenshot-helper
pnpm dev
```

构建 Windows 可分发版本（自动构建 Electron 应用和 Rust 截图助手）：

```bash
pnpm run package:win:dir
```

### 3. 安装 BGE-M3

麻糬无需本地大语言模型即可正常聊天，但建议安装 **BGE-M3 Embedding 模型**：

BGE-M3 模型文件放在本仓库的 `models/Xenova/bge-m3/` 目录（离线获取，不联网下载）。
仓库里只跟踪占位文件，模型权重不会被提交进版本库。

> [!IMPORTANT]
>
> 未安装 BGE-M3 不会影响基础聊天，依赖 Embedding 的增强功能（贴纸语义匹配、Worldbook 语义召回、
> RAG 检索）会自动关闭或降级。

### 4. 命令行入口（可选）

项目附带 `mochi` 命令行入口，执行 `pnpm run build:cli && pnpm link --global` 后即可在任意目录使用，
提供 `version`、`run` 等子命令，详见 `mochi --help`。

> `pnpm run build` 已包含 `build:cli`，但 `pnpm link --global` 仍需单独运行。正式安装版的 `mochi desktop` 入口将在 1.x 提供。

---

## 🔑 配置 API Key

应用启动后，**点击系统托盘图标 → 打开设置**，完成以下基础配置：

1. **🔑 模型设置**：选择 LLM 厂商预设，填写 API Key、Base URL 与模型名称。  
   这是麻糬正常聊天和运行 Agent 的必要配置。

2. **🎙️ TTS 设置**（可选）：选择 Mossland、MiniMax、MiMo、GPT-SoVITS 或自定义云端语音合成服务。

3. **🎧 ASR 设置**（可选）：如需使用语音通话，可配置阿里云实时 ASR 的 AppKey 与 AccessKey，或填写 Mossland 共用 API Key、MiniMax ASR API Key。

4. **📱 外部渠道**（可选）：根据需要连接飞书或微信 iLink，在手机端与麻糬对话。

5. **🎵 音乐**（可选）：配置网易云音乐 OpenAPI 凭据后可启用音乐工具；播放器已内置，无需安装网易云客户端。

相关配置会保存在应用的 `<userData>/` 目录（`%APPDATA%\Mochi`）中，修改后通常无需重启应用。

---

## ✨ 功能

### 核心功能

#### 💬 日常聊天（Chat）

- **独立聊天流程** — Chat 模式专注于对话，不暴露、不调用也不执行任何工具。
- **人格化回复** — 结合助手当选猫、近期会话、社交上下文、用户风格与个性化记忆生成回复。
- **多会话历史** — 不同会话独立保存，可自动生成标题、排序和重命名。
- **多端聊天风格** — 桌面聊天、手机渠道和语音通话可使用不同的表达风格。
- **回复分段** — 可选择「全部分段 / 仅 Chat 分段 / 关闭」，长回复能够按语义拆分为多个聊天气泡。

下面各会话模式是 Harness 的"消费者"：

#### 🛠️ 辅助工作（Work）

<img src="./docs/image/work.png" alt="Work 模式示意" width="800">

- **Harness 主循环驱动** — 单条消息进入 [Harness](./src/main/orchestrator/harness/cyrene-harness.ts) 的 while 循环：每轮调用 LLM → 写回 assistant 消息 → 派发工具 → 写回 tool result → 检查不确定副作用 → 继续或结束。预处理器（CITA 上下文理解）在 Harness 入口前完成；循环内每轮携带精简执行人设（[`prompts/cyrene_harness.md`](./prompts/cyrene_harness.md)，只约束表达风格、不污染工具参数，冲突时按「任务正确性 > 信息清晰 > 猫的语气」取舍）；完整人设层（Soul）在 Harness 出口后生成回复文本。
- **工具自由串联** — 支持联网搜索、网页读取、文件读写、文档生成、生活服务等工具按需组合调用；模型可自行决定下一个工具，无需预先编排流程。
- **右侧浏览器控制** — 麻糬可以在应用内打开网址、读取页面元素，并按需点击、填写普通文本、滚动或截图检查。浏览器页面始终显示在右侧面板，操作结果可直接观察；控制权在同一对话的多轮消息间保持，任务完成后由麻糬显式退出。页面内容只作为网页数据处理，密码、验证码与支付信息由用户亲自输入。

#### 💻 代码协作（Code）

<img src="./docs/image/code.png" alt="Code 模式示意" width="800">

- **在 Work 基础上叠加代码专属工具** — 复用 [Harness](./src/main/orchestrator/harness/cyrene-harness.ts) 主循环，额外注册代码专用工具集（读写改、命令执行、LSP 查询等）；工具执行前由权限审批（checkPermission）过滤不安全调用，Execution Policy 决定是否需要用户二次确认。
- **绑定可信工作目录** — 所有读写、命令执行与 LSP 查询必须落在用户预先绑定的目录内；模型无法指定或切换工作目录，越权访问（包括 `..` 与符号链接逃逸）会被直接拒绝。
- **代码语义查询（LSP）** — Code 模式可在已绑定工作目录中查询定义、引用、悬停、符号与诊断；不会修改文件。
- **改写留痕与一键还原** — 每次改写前自动留底（`src/main/orchestrator/review/`），跑完在审阅面板里逐文件看 diff，
  还能「还原到这次改动之前」；计划审批另走 `src/main/orchestrator/plan-mode.ts`。
- **外部服务由用户管理** — 麻糬只提供 LSP 客户端，不随应用捆绑、下载、升级或静默安装语言服务器；请自行安装所需服务。
- **安全边界** — 语言服务进程以 `stdio: "pipe"` 启动，`shell: false`，`cwd` 强制为绑定工作目录；模型不能指定命令、服务 ID 或工作目录。

<details>
<summary><b>LSP 支持的语言与自定义配置</b>（点击展开）</summary>

**内置支持的语言** — TypeScript / JavaScript / JSON、Python、Go、Rust、C / C++、Java、C#、PHP、Ruby、Kotlin、Lua、Vue、YAML（13 种，详见 `src/main/lsp/server-catalog.ts`）。

**启动顺序** — 先按命令是否为绝对路径定位，否则在工作区 `node_modules/.bin` 中查找，最后回退到系统 PATH 逐目录遍历（Windows 还会按 `PATHEXT` 追加 `.exe` / `.cmd` 等扩展名）。

**安装与排障** — 常见服务如 `typescript-language-server`、`pyright-langserver`、`gopls`、`rust-analyzer`、`clangd`、`jdtls`、`OmniSharp`、`intelephense`、`ruby-lsp`、`kotlin-language-server`、`lua-language-server`、`vue-language-server`、`yaml-language-server`；Windows 可用 `where pyright-langserver` 检查是否可发现。

**自定义服务命令** — 在应用数据目录的 `general-settings.json` 中配置 `lspServerOverrides`，只覆盖 builtin 服务的 `command` / `args` / `extensions` / `initializationOptions`，不接受模型在对话中传入的启动命令。例如：

```json
{
  "lspServerOverrides": [
    {
      "id": "python-pyright",
      "command": "basedpyright-langserver",
      "args": ["--stdio"]
    }
  ]
}
```

**进程复用与释放** — 同一 serverId 的 LSP 进程在同一工作区内复用，避免反复冷启动；应用退出时统一释放。

</details>

#### 📚 学习陪伴（Learn）

<img src="./docs/image/learn.png" alt="Learn 模式示意" width="800">

- **Obsidian Vault 工作区** — 绑定一个 Vault 作为学习工作区，约定 `materials/`、`notes/`、`exercises/`、`templates/` 与 `learn/progress.md` 目录结构，详见 [Learn 模式指南](docs/user-guide/learn-mode.md)。
- **基于 RAG 与个性化记忆** — 学习材料通过 [RAG 文档知识库](#-rag-文档知识库) 索引后参与检索，学习进度与偏好进入 L2 长期记忆，跨会话保持连续。
- **陪伴式理解** — 通过提问、拆解、类比和讨论帮助用户理解材料，而非代替用户完成学习任务。
- **笔记与练习** — 在 Vault 内共同整理概念、生成练习与记录复盘，并自动维护学习进度总览。
- **尊重学习节奏** — 用户没懂时换种方式解释，用户已懂时推进到下一步，不因答错而责备。

#### 📝 富文本与代码渲染

- **Markdown 渲染** — 支持标题、列表、引用、表格、链接、代码块等常见 Markdown 内容。
- **代码高亮** — 支持多种常用编程语言的代码块语法高亮和代码复制。
- **数学公式** — 支持行内公式与块级公式渲染。
- **流式兼容** — 生成过程中保持稳定输出，消息完成后再渲染为完整富文本内容。

#### 🎵 音乐陪伴

- **内置播放器** — 桌面端内置音乐播放器，支持歌单标签切换、本地缓存与播放列表管理。
- **网易云音乐数据源** — 通过自研 `NeteaseOpenapiProvider` 调用网易云 OpenAPI，提供搜索歌曲 / 艺人 / 专辑、每日推荐、我的歌单与收藏等能力。
- **mpv 内置播放** — 由 `MpvController` 控制打包内置的 mpv 进程，实现加载、播放、暂停、跳转、音量、停止等控制，无需唤起外部客户端。
- **多工具串联** — 在 `Work / Learn` 模式中可与其他工具（联网搜索、文件、文档等）组合完成「搜歌 → 加入歌单 → 播放」等连续任务。
- **懒启动 + 可降级** — 音乐后端在首次真实音乐操作时才建立网络会话，空闲时不会占用资源；mpv 缺失时不影响聊天与其他核心功能。

#### 🧠 个性化记忆

- **L0 / L1 / L2 分层记忆** — 分别管理核心用户画像、近期状态和长期经历。
- **记忆证据链** — 记忆内容保留来源与上下文，减少无依据的画像推断。
- **冲突检测与解决** — 对旧记忆与新信息进行召回、评分和语义判断，区分语境变化、偏好演变与直接冲突。
- **自研 DMAE Worldbook** — 通过触发词、优先级、内在价值、连带触发与 Active / Dormant / Archived 状态管理角色知识和长期互动内容。
- **关系与风格沉淀** — 根据长期交互逐步形成用户偏好、交流习惯与关系上下文。

#### 🔊 语音交互

- **多 TTS 引擎** — 支持 Mossland、MiniMax、MiMo、GPT-SoVITS 与自定义云端语音服务。
- **ASR** — 支持阿里云实时语音识别，以及 Mossland、MiniMax 在每轮说话结束后的完整音频转写。
- **完整语音通话** — 通过 `LISTENING → THINKING → SPEAKING` 状态流完成连续语音交流。
- **VAD 静默检测** — 自动判断用户是否结束说话并触发回复。

#### 🧰 工具生态

内置和扩展的工具主要覆盖以下类别：

- **文档与办公** — 生成 Word、Excel、PDF 和 Markdown 文档。
- **联网能力** — 网页搜索、网页读取、内容提取和信息整理。
- **文件处理** — 读取、写入、浏览本地文件及识别图片内容。
- **生活服务** — 天气、地图、翻译、汇率、记账和行程规划等。
- **音乐能力** — 搜索歌曲、获取推荐并调用本地音乐客户端播放。
- **任务协作** — 任务清单、用户选择卡片、任务委派与子任务处理。
- **MCP 扩展** — 通过 Model Context Protocol 接入额外的外部工具与服务。

<details>
<summary><b>🧩 高级功能</b>（点击展开）</summary>

#### 📚 RAG 文档知识库

- 支持 `txt`、`md`、`pdf`、`docx`、`xlsx`、`pptx`、`csv`、`json` 等格式导入。
- 支持向量检索、BM25 与 Reranker 组成的混合检索流程。
- 支持本地 Embedding 与 OpenAI-compatible 云端 Embedding。
- 检索结果保留来源信息，方便追溯原始文档。
- 支持实体关系信息与自定义分词词典。

#### 🔌 MCP（Model Context Protocol）

- 支持 `stdio`、SSE 与 HTTP Transport。
- 支持在设置页面管理和启停 MCP Server。
- MCP 工具会统一接入工具注册、权限审批与 Execution Policy。
- 第三方 MCP Server 的实际稳定性取决于其自身实现。

#### 📱 外部渠道

- **飞书 Lark** — 通过官方 SDK 和 WebSocket 长连接接入，无需公网服务器或内网穿透，详见 [飞书接入指南](docs/user-guide/feishu.md)。
- **微信 iLink** — 支持长轮询消息接收、文本发送和部分媒体处理。
- **QQ / NapCat** — 通过 OneBot 11 反向 WebSocket 接入，支持白名单私聊、群内 @、引用及多媒体消息；详见 [NapCat 接入指南](docs/user-guide/napcat-onebot.md)。
- **多渠道统一人格** — 桌面端、飞书、微信与 QQ 共享同一只猫的角色设定和记忆能力。
- **渠道独立风格** — 可针对手机聊天与桌面聊天使用不同表达方式。

#### ✨ Skill 系统

- 支持内置 Skill 与用户自定义 Skill。
- 用户目录中的同名 Skill 可以整体覆盖内置版本。
- 支持 `invoke_skill`、参考资料读取与 Slash Command。
- 包含路径防护、重复读取限制与大文本截断机制。

#### 🧩 插件系统

- **本地插件包** — 一个文件夹（`manifest.json` + JS 入口文件）就是一个插件，在设置页统一管理启停；支持 ZIP 导入，安装走 staging 隔离校验 + 原子替换 + 失败自动回滚，内置路径穿越与压缩炸弹防护。
- **开放能力** — 插件可以注册 AI 工具、弹出自有窗口、调用宿主 LLM、接入新聊天渠道、监听生命周期事件、注入每轮动态上下文，并可申请私有存储、安全密钥、只读会话分页、自有定时任务与语音输入租约等宿主服务。
- **信任边界** — 用户插件首次发现一律停用，需在设置页手动启用；插件创建的定时任务必须用户核对配置后才生效；语音输入通过独占租约避免双输入源冲突。
- **开发者工具链** — SDK 源码随仓库提供（[`packages/plugin-sdk`](./packages/plugin-sdk)），包含全部公开类型、Manifest 校验与 Mock Context 测试工具，运行时仅依赖 `ajv`；配套《[插件开发指南](docs/plugins/plugin-dev-guide.md)》与 `cyrene-plugin-dev` Skill，无需阅读宿主源码即可完成开发。
- **官方示例** — 仓库 [`examples/`](./examples) 提供天气查询、长期记忆、定时自动化、系统状态与本地 ASR 契约五个示例，均可直接作为开发起点。
- **插件分享** — 本版本不接远端收录仓库：把插件目录压成 zip 直接发给对方，对方在设置页「插件 → 添加」里导入即可。

#### 🌙 主动聊天

- **状态感知** — 根据时间、用户活跃状态、会话状态和角色心情判断是否适合主动交流。
- **不打扰策略** — 深夜、用户正在聊天或连续未回应时降低或停止主动消息。
- **多渠道投递** — 可选择桌面、微信或飞书作为主动消息目标。
- **渠道失败保护** — 指定手机渠道不可用时取消发送，不会擅自改投桌面端。

</details>

---

<details>
<summary><b>🔧 开发功能</b>（点击展开）</summary>

#### 🧪 单元测试

- Vitest 5 覆盖 asr / tts / channels / chats / memory / orchestrator / plugins / rag / skills 等核心模块。
- `pnpm test` 一次性 / `pnpm run test:watch` 监听模式。
- 插件开发：`pnpm run check:plugin-sdk` 校验 SDK 打包，`pnpm run test:plugin-examples` 端到端验证官方示例。

#### 🎬 场景模拟

- `pnpm run sim` 默认场景，`sim:coffee` / `sim:mix` / `sim:rescue` 单场景调试，产物输出到 `sim-result/`。
- `pnpm run sim:sweep --rewardGain=3,5,7,10` 跑 Worldbook 评分参数 sweep。

#### 🖼️ 截图与验收脚本

- `scripts/verify/p4-cdp-capture.mjs` — 用 CDP 驱动真实应用走完欢迎页 → 条款 → 主窗的路径并截图。
- `scripts/verify/p4-visual-oracle.mjs` — 读截图 PNG，按亮度 / 色相 / 覆盖度等稳健量给出主题视觉判据。
- `scripts/verify/p4-readme-shots.mjs` — 生成 README 用图（珍珠白 / 经典深色 / 四种模式）。
- `node scripts/build/cat-sprites.mjs --check` — 校验 198 张猫精灵图与清单一致。

</details>

---

## 🧱 技术栈

| 层级 | 技术 |
|---|---|
| 运行环境 | Node.js 24 LTS + Electron 44 |
| 开发语言 | TypeScript 5 |
| 构建工具 | Vite 8 + esbuild（主进程 / preload / CLI 各自打包） |
| 界面渲染 | HTML / CSS + React 19 + Tailwind CSS 4 + Ant Design X / Mantine + Chart.js |
| 桌面猫 | 自研像素猫绘制指令模型（`src/renderer/pet/`）+ Canvas 2D，五档毛色 × 十二档姿态 |
| 主题色板 | 猫身色派生（`src/shared/palette-from-cat.ts`）→ 珍珠白 / 经典深色两套令牌 |
| Agent 核心 | [Harness](./src/main/orchestrator/harness/cyrene-harness.ts) 主循环 + CTA 会话轨迹 + Structured Output / Native Function Calling |
| Agent 事件协议 | AG-UI（`@ag-ui/core`、`@ag-ui/client`）— 通过 `RUN_STARTED / STEP_* / TEXT_MESSAGE_* / TOOL_CALL_* / RUN_FINISHED` 等事件与渲染进程解耦 |
| 工具与沙箱 | 自研工具调度 + 副作用记账 + 重试策略 + 权限审批；Windows 命令沙箱 `@anthropic-ai/sandbox-runtime` |
| 代码协作 | 自研 `LspManager` + `vscode-jsonrpc`（LSP 客户端）、`@ast-grep/napi`（结构化代码搜索）、`simple-git`（git 集成） |
| 工具扩展 | `@modelcontextprotocol/sdk`（stdio / SSE / HTTP Transport） |
| 插件系统 | [`packages/plugin-sdk`](./packages/plugin-sdk)（公开类型 + Manifest Schema 校验 + Mock Context 测试工具） |
| 记忆与检索 | Embedding（`@xenova/transformers`）+ BM25 + 自研 Cross-Encoder Reranker + DMAE V5.1（关键词命中召回 + 激活度衰减 + 三态可逆）+ `@node-rs/jieba` |
| 浏览器与桌面自动化 | Playwright + `@nut-tree-fork/nut-js` |
| 富文本渲染 | Streamdown + Shiki + KaTeX（Markdown / 代码高亮 / 公式） |
| 语音与媒体 | 多引擎 TTS / ASR + `silk-wasm` |
| 原生截图助手 | Rust + DXGI Desktop Duplication / Direct2D + WIC PNG + NDJSON IPC |
| 文档与邮件 | ExcelJS、docx、PDFKit、Nodemailer |
| 测试 | Vitest 5 |

---

## 📦 项目结构

```
models/                # 本机 AI 模型（用户放置，仓库只跟踪占位文件）
└── Xenova/bge-m3/     # Embedding 模型（贴纸语义 + 场景识别，~570MB）

src/
├── cli/               # 命令行入口（mochi 命令）
├── main/              # Electron 主进程
│   ├── orchestrator/  # Agent 核心：Harness 主循环 + CTA 会话轨迹 + 工具调度 + 权限审批
│   │   ├── harness/   # Harness（while 循环 + compaction + retry + uncertainty）
│   │   ├── tools/     # 工具注册表与内置工具（含 Code 模式工具、ast-grep 搜索）
│   │   ├── vendors/   # 多模型厂商适配（分级 Structured Output + Function Calling）
│   │   ├── sandbox/   # Windows 命令执行沙箱
│   │   ├── review/    # 改写留痕（写前快照 + 逐轮 diff + 一键还原）
│   │   └── structured-output/  # 统一 Structured Output 管线
│   ├── channels/      # 外部渠道适配（飞书 / 微信 iLink / QQ OneBot 11）
│   ├── memory/        # L0/L1/L2 记忆引擎 + DMAE Worldbook + 实体关系图
│   ├── rag/           # 检索增强生成 + Worldbook 注入
│   ├── lsp/           # LSP 客户端（manager / client / server-catalog）
│   ├── code-git/      # Code 模式 git 服务（status / commit / branch / push）
│   ├── learn/         # Learn 模式（Obsidian Vault 绑定 + 进度总览）
│   ├── tasks/         # 任务面板（任务执行 / 委派 / 子 Agent 运行时）
│   ├── music/         # 音乐陪伴（播放 / 推荐 / 会话）
│   ├── moments/       # 动态 / 社交信息流
│   ├── permission/    # 权限审批（checkPermission / risk 等级）
│   ├── plugin-host/   # 插件宿主服务
│   ├── proactive/     # 主动对话（模型 / 策略 / 路由）
│   ├── skills/        # Skill 系统（内置 + 用户自定义）
│   ├── asr/ tts/ call/ # 语音识别 / 合成 / 通话
│   ├── cita/          # CITA 上下文理解与建议引擎
│   ├── relationship/ social-context/  # 用户关系画像 / 社交上下文
│   ├── scheduler/     # 定时任务（提醒 / 日程）
│   ├── egress/        # 出口看门狗（运行时拦上游域名）+ 静态标识锁
│   ├── verge/         # 桌宠壳层（右键菜单 / 免打扰 / 贴边藏身 / 状态存储）
│   └── ...            # prompts / protocols / services / settings / startup / windows 等
├── plugins/           # 插件系统核心（manifest 校验 / 加载器 / 生命周期）
├── preload/           # Electron preload 桥接
├── renderer/          # Vite 渲染层（React 19 组件库 + 像素猫渲染 + 各窗口入口）
│   └── pet/           # 像素猫（绘制指令 / 花色 / 姿态 / 命中判据）
└── shared/            # 主进程与渲染进程共享代码（品牌 / 色板 / 猫名册）

examples/              # 插件开发示例（weather-tool / long-term-memory / ...）
packages/plugin-sdk/   # 插件 SDK 源码
scripts/               # 构建 / 打包 / 验收脚本（含 verify/ 下的 CDP 截图与像素尺）
```

> 静态资源源文件见 `src/renderer/public/`（音频 / 头像 / 贴纸 / 图标等）。
> 品牌真值在 `src/shared/brand.ts`，色板真值在 `src/shared/palette-from-cat.ts`——改名与换色都只改这一处。

---

## ❓ 常见问题

### 麻糬支持本地大模型和其他第三方模型平台吗？

对兼容矩阵里没有收录的本地模型、自定义端点和第三方平台，本项目只提供基础的通用兼容与容错处理。

因为这些端点没有经过完整 Work 流程验证：

- 不保证稳定运行
- 不保证 Structured Output 与 Function Calling 可用
- 不保证完整的 Agent 工具链能跑通
- 暂不提供配置指引、兼容性排障与错误诊断

未收录的模型、本地模型与自定义端点默认使用通用 **Tier D** 档位，实际兼容性需要用户自行验证。

当前收录的模型名称、能力范围与核验状态维护在[模型适配清单](./docs/references/adapted-models.md)，该清单是准绳。

> BGE-M3 是本项目使用的本地 Embedding 增强模型，不是用于聊天的本地大语言模型。

### API Key 安全吗？

> [!WARNING]
>
> 当前版本不建议在公用电脑或不受信任的环境下使用。

LLM、视觉模型、ASR、TTS 等第三方服务的凭据保存在应用的 `<userData>/` 目录（`%APPDATA%\Mochi`）里：

- `<userData>/model-settings.json`：LLM 与视觉模型配置（明文）
- `<userData>/app-settings.json`：ASR、TTS、地图、搜索、邮件等配置（明文）
- `<userData>/weixin/credentials.json`：微信 iLink Bot 凭据（明文）
- `<userData>/mcp-servers.json`：MCP Server 配置，含 `env` 环境变量（明文）
- `<userData>/channels-settings.json`：渠道设置；飞书 `appSecret` 与 QQ `accessToken` 使用 `safeStorage`
- `<userData>/music/netease/account.enc`：网易云音乐登录 cookie（`safeStorage` 加密）

大部分凭据目前以明文本地文件保存，主要靠操作系统对用户数据目录的权限保护。

飞书渠道凭据与网易云音乐登录 cookie 使用 Electron `safeStorage` 加密：

- Windows：DPAPI
- macOS：Keychain
- Linux：libsecret
- 系统钥匙环不可用时，回退到较弱的本地混淆方式

不要分享或上传 `<userData>/`、设置文件与日志文件，也不要把它们同步到公共网盘或提交进 Git 仓库。

要清空凭据与配置，删除下列文件后重启应用：

```text
<userData>/model-settings.json
<userData>/app-settings.json
<userData>/weixin/credentials.json
<userData>/mcp-servers.json
<userData>/channels-settings.json
<userData>/music/netease/account.enc
```

### 能在 macOS 或 Linux 上跑吗？

麻糬当前面向并主要在 **Windows 10 / 11** 上测试。

| 平台 | 状态 | 说明 |
|---|:---:|---|
| Windows 10 / 11 | ✅ 已测试 | 主要支持平台 |
| macOS | ⚠️ 未完整验证 | Electron 应用本身可以运行，但透明窗口、鼠标穿透与窗口层级可能有问题 |
| Linux | ⚠️ 未完整验证 | 桌面环境与系统钥匙环的差异会影响部分功能 |

`game-bot` 模块依赖原生 `nut.js`，只在 Windows 上做过端到端测试。

反馈兼容性问题时，请附上运行环境、错误日志与复现步骤。

### 内存占用过高或 OOM 怎么办？

按顺序试这几步：

1. **关掉 Reranker**  
   设置 → 设置 → RAG / 文档导入 → Reranker 模式选 `none`。

2. **关掉用不到的 MCP 服务**  
   浏览器自动化之类的服务会另起 Chromium 进程。

3. **减少体积过大的 RAG 文档**  
   把暂时用不到的知识库文件移走，降低索引与检索开销。

4. **关掉不用的窗口与后台任务**  
   长跑的工具任务、语音服务与多个会话会持续占用资源。

5. **重启应用**  
   释放模型、索引、浏览器子进程与长跑任务占用的内存。

Embedding 索引用后台 Worker、批处理与缓存来压低导入文档时的内存峰值。

如果仍然 OOM，在开发模式下用 Chrome DevTools 的 Memory Profiler 抓 Heap Snapshot，并附上复现步骤与相关日志。

### 怎么升级？

本版**不联网检查升级**，也不会从任何远端拉取更新。升级方式只有一种：由你在本地重新构建，或安装新的发行版。

需要改的只是本仓库里的代码与素材；没有任何自动升级通道会替你决定什么时候换。

---

## 📄 许可证

本仓库的**源代码**遵循 [MIT License](./LICENSE)，Copyright (c) 2026 Playa。

第三方依赖的授权与归属见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) 与 `LICENSES/` 目录。

桌面猫的像素美术、界面色板与界面文案均为本仓库自有内容，随 MIT 授权一同分发。

---

## 🙏 致谢

- **原作者与贡献者** — 本项目基于 Playa 发起、并由众多贡献者共同完成的 MIT 开源项目发展而来，
  贡献者名单见 [docs/CONTRIBUTORS.md](./docs/CONTRIBUTORS.md)。
- **Git for Windows / MinGit** — Windows 发行版在系统 Git 缺失时附带 MinGit 作为兜底。
- **mpv** — 内置音乐播放器的播放核心。

---
