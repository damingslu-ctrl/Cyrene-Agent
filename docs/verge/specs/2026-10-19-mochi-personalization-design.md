# 「Mochi」个人化改造设计（配色统一 / 形象换猫 / 断上游 / 自有身份）

- 日期：2026-10-19
- 状态：已裁决，待执行
- 仓库：`D:\Test\workbuddy\cyrene-verge`（分支 `verge`）
- 上游：`https://github.com/Playa-Cyrene/Cyrene-Agent.git`（改造后**不再向它取任何东西**）
- 前置：P0（环境与骨架）、P1（像素猫进壳）已收口。本文档是 P1 之后插入的一条独立轨道，
  编号 **P4 个人化**（P2 数据面 / P3 写操作的时间表不受它影响，可交错推进）
- 依据：用户令「主题要跟猫的配色统一，把里面的所有动漫形象重新画换成猫猫的形象，
  把这个客户端彻底改造为独立软件彻底个人化，升级由我来，不再接收原来官网、GitHub 升级」

## 0. 一句话架构

**一个猫形象系统 + 一份猫色板 + 一个自有身份 + 零上游出口**：
桌面猫、贴纸、头像、状态图、托盘图标、安装包图标全部由 `src/renderer/pet/art.ts` 这一套
矢量原语在**构建期**渲染成位图；全客户端 CSS 变量的值全部从 `src/renderer/pet/tokens.ts`
的色板推导；产品名字/数据目录/图标/更新通道归用户自己；默认启动不产生任何对外请求。

## 1. 五条裁决

| # | 决策 | 取了什么 | 放弃了什么 |
| --- | --- | --- | --- |
| M1 | 产品名 | **`Mochi`**（中文显示「麻糬」）——猫身 token `PAPER #f7f4ec` 就是那团奶油色 | 保留 Cyrene 品牌（法律与情感上都不是用户的） |
| M2 | 形象替换 | **程序化生成**：扩 `art.ts` 成「猫姿态/花色库」，构建期吐 PNG 到应用已在看的路径 | 逐张 AI 生图（风格不统一、离线不可重跑、无法过像素尺） |
| M3 | 换肤方式 | **保住 `--rb-*` 变量名，只改值**；再加一把「每个色值必须来自猫色板」的派生锁 | 新建一套变量体系（会同时打爆 25-token 契约测试与上千处引用） |
| M4 | 委托人格池 | 12 位**猫伴**（沿用 12 套性格字段，只换名字/立绘/称谓「黄金裔」→「猫伴」） | 删掉多人格机制（那是这个产品最有价值的结构性功能） |
| M5 | 模型接入 | **不动用户能连的模型**（11 家条目留着，它们本就 key-gated、不配 key 不发请求），只删上游品牌链接 | 一刀切成本地-only（会把用户自己正在用的 DeepSeek/Anthropic 通道砍断） |

### 改名只动一处的兑现方式

新增 `src/shared/brand.ts` 作为**唯一身份来源**：`PRODUCT_NAME` / `PRODUCT_NAME_ZH` /
`APP_ID` / `DATA_DIR_NAME` / `LOG_PREFIX` / `TITLE_SUFFIX`。运行时读它，
`electron-builder.yml` 与 `package.json` 由脚本从同一份 JSON 生成字段。
用户日后想换名字：改 `brand.ts` + 跑 `node scripts/build/sync-brand.mjs` + 重跑身份迁移测试。

## 2. 现状事实（四路侦察实测，全部带出处）

### 2.1 猫色板已经是一份现成的台账

`src/renderer/pet/tokens.ts` 是唯一 token 源（`src/main/verge/` 无一处十六进制）。
关键值：`ACCENT #5b8def`、`GREEN #4fb477`、`WARN #d97757`、`PAPER #f7f4ec`、
`INK #2b2f3a`、`INK_SOFT #4a5162`、`ROSE #f27d92`、`ROSE_DEEP #dd6a7f`、
`EYE #14171f`、`BG_SOLID #101420`、`FG #e8e6df`、`DIM #9a9daa`，
面板面经 `wash()` 派生：`PANEL_CARD #1c202b`、`CARD_STROKE #2c303a`、`SEP #1a1e2a`。
`src/renderer/pet/art.ts:65,507-512` 有 11 个模块局部色是**漏登记的私有色**，本次一并收进台账。

### 2.2 全客户端颜色是 CSS 自定义属性

根定义 `src/renderer/ui/tokens.css`（约 75 个带色变量，粉紫青系），
覆盖层 `src/renderer/ui/themes/pearl-white.css`（159 个十六进制）、`charcoal-pink.css`（118 个），
`src/renderer/ui/theme.css`（1243 行、130 个）。模式 `UiTheme = "pearl-white" | "charcoal-pink"`
（`src/shared/ui-theme.ts`），主进程 IPC → `document.documentElement.dataset.uiTheme`。
**绕过变量的硬编码色**按目录计数：chat 组件 654、`ui/themes` 277、`ui` 236、
`react/components/ui` 159、settings 101、moments 84、character 44、music 34。
**原生窗底色 CSS 管不到**：`create-aux-windows.ts:145` 引导窗硬编码 `#fff8fb`、
`:61` 聊天窗按主题映射 `#141414`/`#fff8fb`、`window-system-ipc.ts:102` 用 Electron 默认白。

会被打爆的测试：`pet/tokens.test.ts`（锁色板字面量与 wash 结果）、
`react/styles/theme-token-contract.test.ts`（要求 25 个 `--rb-*` 在两个文件里都存在，**只查存在不查值**）、
`react-root.visual.test.ts`（断言 `--rb-surface-page: #ECECEE`、`--rb-surface-workspace: #FFFFFF`）、
`ui/theme-bootstrap.test.ts`、`main/ui-theme.test.ts`、`windows/create-aux-windows.test.ts`。

### 2.3 默认启动就会发的请求只有两条

1. **公告**：`src/main/news/news-feed.ts:13` `https://gitee.com/playa0/cyrene-announcement/raw/main/`，
   `:88` `net.fetch`，`:136-140,145-148` 起 6h 轮询；IPC 无条件注册
   （`default-dependencies.ts:777`）；**聊天 UI 挂载即触发**
   （`react/components/ui/UserAvatar.tsx:36` → `react/hooks/useNewsFeed.ts:45-52`）。
2. **Google Fonts**：`src/renderer/ui/fonts.css:2` `@import`，被 9 个 HTML 入口引用；
   CSP 在 `src/main/protocols/learn-exam-csp.ts:5,7` 放行。

用户点击才发的：官网链接 `settings/app-update-view.ts:75` `playaagentcyrene.online`
（经 `UserAvatar.tsx:201`、`GeneralSettingsPanel.tsx:154`）；Issue 上报
`components/ui/IssueReportDialog.tsx:10` `Playa-Cyrene/Cyrene-Agent/issues`；
插件市场注册表 `src/main/plugin-marketplace.ts:19-26`（GitHub raw + Gitee 镜像）。
更新器：**无任何遥测/崩溃上报**（全仓无 Sentry/PostHog/GA）；
`FORK_AUTO_UPDATE_DISABLED=true`（`updater/update-policy.ts:10`）只掐了 `scheduleUpdateCheck`
一处（`default-dependencies.ts:1027-1034`），`github-app-updater.ts:23-40` 的 6h `setInterval`
仍是活代码，feed 源来自 `electron-builder.yml:3-6` 的 `provider: github, owner: Playa-Cyrene`，
`scripts/verify/installer-artifacts.mjs:51-68` **硬性要求 `latest.yml` + `.blockmap`**。

### 2.4 形象资产：237 MB 里 215 MB 是动漫角色图

| 池 | 路径 | 体量 | 消费方 |
| --- | --- | --- | --- |
| Live2D 模型 ×2 | `src/renderer/public/models/cyrene/`、`assets/models/cyrene/` | 9.1M×2 | 只有孤儿 `renderer/live2d/*`（`manager.ts:133`） |
| 内置贴纸 | `src/renderer/public/stickers/`（52 张 jpg/png/gif） | 20M | `shared/sticker-types.ts:4-57` `BUILT_IN_STICKER_IDS` + `main/sticker-descriptions.ts:65` 文件表 + `main/sticker-storage.ts:132` 服务 |
| 委托立绘 | `src/renderer/tast/`（12 张，崩铁角色名） | 17M | `react/character-portraits.ts:4-15` 静态 import |
| 角色状态图 | `react/assets/characters/<名>/status-moods/*.png`（12×6） | 98M | `react/character-status-moods.ts` 的 `import.meta.glob` |
| 朋友圈头像 | `react/avatars/*.png`（13 张，含 `昔涟`→`public/avatars/cyrene-avatar.png`） | 5.2M | `react/character-avatars.ts:4-32` |
| 共享心情/浮动/欢迎/待办/提问/上下文环 | `react/assets/{status-moods,status-float,welcome,todo,ask}`、`public/context-usage/` | 60M | 见 §2.4 消费方清单 |
| 应用图标 | `assets/tray-icon.ico`、`assets/icon-presets/cyrene-{sun,pink}.png`、`build/installer/*` | 4M | `main/tray.ts:41`、`main/app-icon.ts:6`、`electron-builder.yml:66,84` |

**人格池是代码定义、不是用户数据**：`src/main/tasks/task-character-pool.ts:6-16` 列 12 个
`{nickname, assetFileName}`，`buildGoldenDescendantsPrompt()` 把名字写进系统提示（称谓「黄金裔」）；
`src/main/moments/character-personas.ts`（620 行）是每位的性格语料；
i18n 三个 json 也带这些名字。**所以换猫 = 改这份池子的名字 + 重画资源 + 改称谓，机制原样保留。**

### 2.5 身份已经走了一半，剩下一半会踩雷

运行时身份已隔离：`configureVergeIdentity()` 在任何读取之前 `app.setName("cyrene-verge")` +
`setPath("userData", %APPDATA%\cyrene-verge)`（`src/main/app-identity.ts:16,80,88-90`），
`pre-ready.ts:34` 排第一。**但装到系统里的还是 `Cyrene.exe` / `com.cyrene.live2d` /
开始菜单分类 `Cyrene` / `Cyrene-Setup-${version}.exe`**（`electron-builder.yml:1-2,66,72-85`）。

> **雷（必须先拆）**：`src/main/channels/settings-store.ts:52`
> `seed = ${app.getPath("userData")}::${app.getName()}::cyrene-bot-secret` → SHA256 取 16 字节做 XOR。
> 改名字或换 userData 目录**等于换钥匙**，而 `deobfuscate`（`:72-82`）没有完整性校验，
> 结果不是报错而是**解出乱码并被当成正确值用**。修法见 §3.2。

其余：无 `setAsDefaultProtocolClient`、无注册表写入、无系统级协议（自定义 scheme 仅渲染端）；
开机自启 `launch-at-login.ts:14` 存在但默认关（`settings-facade.ts:52`）；
所有运行期文件都挂在 `app.getPath("userData")` 下（无硬编码 `%APPDATA%\Cyrene`）；
单实例锁随 `app.name` 派生，`pre-ready.ts:34` 保证先设身份再取锁。

## 3. 分期设计（执行顺序即此序）

### A 断上游（先做：改动小、风险低、立见收益）

- **A1 公告整删**：删 `src/main/news/`、`default-dependencies.ts:777` 注册、
  `shared/ipc-channels.ts` 通道、preload 白名单、`useNewsFeed.ts` 与 `UserAvatar.tsx:36` 的挂载触发。
  判据：全仓 grep `gitee.com|playa0` 为 0。
- **A2 字体本地化**：`fonts.css:2` 的 `@import` 改为系统字体栈（不引入新位图字体文件，
  中文体积不可接受）；CSP 去掉 `fonts.googleapis.com`/`fonts.gstatic.com` 放行。
- **A3 更新器变死代码**：删 `github-app-updater.ts` 的排程与轮询、删 `electron-builder.yml:3-6`
  的 `publish` 块、`app-update-service.ts` 的 `checkForUpdates`/`downloadUpdate`/`quitAndInstall`
  路径整体移除、设置页改成「版本信息（本机构建，不联网）」、
  `installer-artifacts.mjs:51-68` 不再要求 `latest.yml`/blockmap。
  **判据是装配面**：`registerCoreIpc` 里拿不到任何 update 通道，测试断言「更新 IPC 面不存在」。
- **A4 品牌链接清零**：`app-update-view.ts:75`、`IssueReportDialog.tsx:10`、
  `DisclaimerSettingsPanel.tsx:92-147`、`cli/banner/text.ts:12`、`skills/cyrene-plugin-dev/*`、
  `.github/ISSUE_TEMPLATE/*`、`packages/plugin-sdk/package.json:8` —— 删外链或改本地文案。
  `external-link.ts:16-21` 的白名单同步收窄为「不放行上游域名」。
- **A5 插件市场改本地目录**：`plugin-marketplace.ts:19-26` 的远端注册表分支删除，
  只留 `userData/plugins` 本地枚举；`PluginMarketPreview.tsx` 的假预览 URL 删。
- **A6 出口看门狗**：新增一条**运行时**证据——启动时给 `session.webRequest` 挂监听，
  把「非 `127.0.0.1`/`localhost`/`file:`/`chrome-extension:`/`data:`」的请求记进内存表，
  探针档 `--egress-probe` 打表后退出。测试判据：**默认启动到空闲 20s，外网请求 = 0**。
  这条是 A 期唯一的「真窗尺」，因为静态 grep 证明不了没有间接路径。

### B 自有身份

- **B1 拆雷（先于改名）**：`settings-store.ts` 的 XOR key 改为
  **不随 `userData`/`app.name` 派生**的稳定常量 + 机器维度（`os.userInfo().uid` 级别，可接受），
  并给 `obf:` 加 4 字节校验和与前缀版本号（`obf:2:`）；旧 `obf:`（无版本）用**旧公式**解一次、
  立刻用新公式重写入盘。判据：构造一条旧 `obf:` 落盘 → 迁移后读回明文；
  构造一条被改坏的 → **抛错/记 warn 并返回空**，不再静默乱码。
- **B2 brand.ts 落地** + `sync-brand.mjs`（把 `productName`/`appId`/`artifactName`/`menuCategory`
  写进 `electron-builder.yml`，把 `name`/`description`/`bin` 写进 `package.json`），
  两条都进 CI 判据（生成物与源不一致即红）。
- **B3 userData 迁移**：`%APPDATA%\cyrene-verge` → `%APPDATA%\Mochi`，一次性搬迁
  （改名 + 写 `.migrated-from` 标记，幂等，失败可回退）；`app-identity.ts` 目标目录跟着 brand 走。
  **`%APPDATA%\Cyrene` 全程只读禁写**（那是用户真实数据），迁移器只允许以显式常量指向
  `cyrene-verge`，并加测试断言「不碰 Cyrene」。
- **B4 名字清扫**：`tray.ts:45` 提示、`create-aux-windows.ts:67,143,279`、
  `create-music-player-window.ts:36`、`create-toast-window.ts:33`、`banner.ts:8-20`、
  `cli/banner/text.ts:5-13`、`logger-tags.ts:20` `LogTag.Cyrene`、README 两份标题、
  i18n about 面板。分 (a) 用户可见必改 / (b) 内部字符串可改 / (c) **键在既有数据上不许盲改**：
  `cyrene.sqlite`、`cyrene-chats/`、`logs/cyrene.log`、`cyrene-runs`、`cyrene-tasks`、
  `cyrene-tts-cache`、`cyrene.*` AG-UI 事件名、`cyrene-exam`/`cyrene-plugin` scheme、
  `native/cyrene-screenshot.exe`。
  **裁决 (c)：本期只改「用户可见」与「日志前缀」，数据文件名与协议名原样保留**
  —— 改它们的收益是 0，代价是一条跨 4 处的迁移链（builder files、helper-path、verify 脚本、
  既有用户数据）。「内部字符串看起来还带 cyrene」在本文档里是被明确接受的遗留，不是遗漏。
- **B5 装机身份**：`electron-builder.yml` 的 `appId`/`productName`/`artifactName`/`menuCategory`
  由 B2 生成；图标换 §D 生成的猫图标（`assets/tray-icon.ico`、`installer-sidebar.bmp`）。
- **B6 自启与协议**：`launch-at-login` 默认保持关；不注册系统协议（现状即如此，测试锁住「没有新增」）。

### C 配色统一（换肤）

- **C1 台账收口**：把 `art.ts` 的 11 个私有色并进 `tokens.ts`，`tokens.test.ts` 扩锁。
- **C2 主题派生器**：新增 `src/renderer/ui/palette-from-cat.ts`，从猫色板算出
  `--rb-*` 需要的全部值（背景用 `wash()` 口径，文本用 `FG/DIM`，强调用 `ACCENT` 系，
  语义色用 `GREEN/WARN`，粉饰用 `ROSE`）。`pearl-white.css` / `charcoal-pink.css` 的
  **变量名一个不改，值全部改成派生结果**（浅色主题=奶油纸面 + 墨线 + 蓝强调；
  深色主题 = `BG_SOLID #101420` 面 + `FG`）。
- **C3 派生锁**：新测试 `theme-palette-derivation.test.ts`——把两份主题文件里所有十六进制
  逐个断言「∈ 猫色板 ∪ `wash(板内色)` ∪ 显式登记的中性/遮罩白名单」，
  白名单必须写理由。**这是「主题跟猫统一」从口号变成可判定契约的地方。**
- **C4 原生窗底色**：`create-aux-windows.ts:61,145` 与 `window-system-ipc.ts:102`
  改为读 C2 的派生值；`create-aux-windows.test.ts` 的 `#141414`/`#fff8fb` 断言随之更新。
- **C5 硬编码色清扫**：按体量降序逐目录扫（chat 组件 654 → `ui` 236 → `components/ui` 159 → …），
  每目录一提交，判据是「该目录 `#[0-9a-fA-F]{3,8}` 命中数降到只剩白名单项」。
  **明确不做**：一次性正则替换全部色值（会把语义色、状态色、透明度层级一起打平，
  而且无法用像素尺证明没改错）。
- **C6 `react-root.visual.test.ts` 的期望值按新值改**，改前先在提交正文里写清新值来自哪个派生式。

### D 形象换猫

- **D1 猫库扩面**：`pet/art.ts` 现在画的是「一只 82×108 的坐姿猫 + 表情/动作」。
  新增**变体轴**：花色（奶油/灰/墨/蓝/粉 5 色，全部板内色）、姿态（坐/卧/趴/探头/伸懒腰/洗脸/
  打哈欠/歪头/睡/炸毛/委屈/开心，12 个）、取景（全身/半身/方头像/圆形头像裁）。
  每个变体是一个**纯函数 → DrawOp[]**，与桌面猫同源，可单测、可复跑。
- **D2 构建期生成器** `scripts/build/cat-sprites.mjs`：在 Node 里跑同一套 DrawOp，
  用一个最小 canvas 光栅化器（无浏览器）渲染成 PNG，写到应用**已经在看的确切路径与文件名**：
  `react/assets/characters/<猫名>/status-moods/{连接中,思考中,工作中,提醒,已处理,已中断}.png`、
  `react/avatars/<猫名>.png`、`tast/<猫名>.png`、`public/stickers/<id>.<ext>`、
  `public/avatars/cyrene-avatar.png`、`react/assets/{welcome,todo,ask,status-float}/*`、
  `public/context-usage/*`、`assets/icon-presets/*`、`assets/tray-icon.ico`、
  `build/installer/cyrene-installer-source.png` → 更名 `mochi-installer-source.png`。
  生成物**进 git**（像素尺要可比，构建期不依赖网络）。
- **D3 尺寸与体积预算**：状态图从平均 1.4 MB 降到 ≤ 60 KB（矢量猫本来就小图），
  12×6 张共 72 张 ≈ 4 MB（原 98 MB）；贴纸 52→**24 张猫表情包**（`BUILT_IN_STICKER_IDS` 同步收窄，
  每个 id 的中文描述在 `sticker-descriptions.ts` 重写）；总渲染资产 215 MB → 目标 **< 15 MB**。
  判据：`du -sh src/renderer` 前后各测一次并进提交正文。
- **D4 孤儿清理（关闭 P1 终审 PARK 的 I-2）**：删 `src/renderer/live2d/**`、
  `public/models/cyrene/`、`assets/models/cyrene/`、`public/live2dcubismcore.min.js`、
  live2d 生命周期/IPC/preload 面、`user-data-migration.ts:19` 的 `live2d-cyrene` 源、
  `renderer/index.html:25` 与 `main.ts:5` 的 `#live2d-canvas` → `#pet-canvas`。
  **按「通道 → 注册点 → 消费方」倒序一次清一层**，每层一次提交，`ipc-contract.test.ts` 必须每层都绿。
- **D5 人格池换猫**：`task-character-pool.ts` 的 12 个 `nickname` 换成猫名，称谓「黄金裔」→「猫伴」
  （`buildGoldenDescendantsPrompt()` 文案、`character-personas.ts` 语料的人设字段、
  i18n 三个 json 的键值同步）；`getGoldenDescendantNames` 等**函数名保留**（改名牵连调用面，
  在正文注释里记「历史称谓」即可）。性格 1:1 平移，不重新发明。
- **D6 视觉验收**：`AppearanceSettingsPage.tsx:119` 与 UI 图标预设的候选图换成猫；
  托盘/窗口图标按新 `brand.ts` 路径解析。

### E 收尾与验收

E1 全仓门禁（vitest 全量 + 两个 tsc）、E2 真窗三层尺（含 A6 的 egress 探针 0 外网请求、
C 的两套主题截图、D 的图标/贴纸/头像目视与像素尺）、E3 装机冒烟（NSIS 产物名/图标/添加删除列表
显示 Mochi，且**不碰** `%APPDATA%\Cyrene`）。

## 4. 验收三层尺（沿用 spec §6.8）

| 层 | 判据 | 工具 |
| --- | --- | --- |
| 单元 | 派生锁（C3）、身份一致性（B2 生成物同步）、obf 迁移与校验和（B1）、每只猫变体的 DrawOp 快照（D1） | `CI=true npx vitest run <paths>` |
| 探针 | `--egress-probe` 外网请求表必须空；`--brand-probe` 打印 name/userData/appId 供对账 | 真进程 + 落盘 JSON |
| 屏幕 | 两套主题各截聊天/设置/moments/贴纸四档；图标与头像按已知锚点量质心与色相 | CDP + `crop.ps1` |

负判据一律配正对照；尺自己崩了不许读成 PASS；环境不合格 `exit ENV` 并点名压屏窗口。

## 5. 风险与对策

1. **obf 密钥轮换静默损坏**（B1）——先拆雷再改名；加校验和让错钥匙**响**而不是解出乱码。
2. **派生锁太严导致真实中性色进不来**（C3）——白名单显式登记 + 写理由，宁可显式破例也不要放宽判据。
3. **构建期光栅化与浏览器渲染不一致**（D2）——用同一套 DrawOp，差异只在抗锯齿；
   像素尺判据只认质心/色相/覆盖度这类稳健量，不认逐字节（native 侧「桌布自己在动→哈希前先量化」的教训）。
4. **贴纸 52→24 让历史消息里的图片 404**（D3）——`sticker-storage.ts` 查不到文件时渲染降级，
   并在迁移里把旧内置贴纸 ID 映射到最近的猫贴纸（用户自备包不受影响）。
5. **改名波及测试海量字面量**（B4）——先加 brand 模块与生成器，再一次性清扫，
   清扫提交按目录切，别混进功能改动。
6. **上游文件额度**（跨期约束）：本轨道必然再动上游文件。按 P1 收口后的新口径执行——
   **看改动形态而非个数**，纯追加优先，有删改的每处提交正文写明为什么不能落在新目录。

## 6. 明确不做

- 不改模型接入能力（M5）；不删第三方 channel/TTS/ASR 适配器（都 key-gated、非上游品牌）。
- 不改内部数据文件名与自定义协议名（B4 裁决 (c)）。
- 不注册系统协议、不开机自启（B6）。
- 不碰 `%APPDATA%\Cyrene`；不 `git push`；native 侧维持只读。
- 不做整体重排版（本期是「换皮换骨不换信息架构」，页面结构改动另立轨道）。
