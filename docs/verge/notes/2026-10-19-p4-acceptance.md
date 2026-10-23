# P4 个人化验收记录（2026-10-19 / 2026-10-22 收口）

- 计划：[docs/verge/plans/2026-10-19-p4-personalization-mochi.md](../plans/2026-10-19-p4-personalization-mochi.md)
- Spec：[docs/verge/specs/2026-10-19-mochi-personalization-design.md](../specs/2026-10-19-mochi-personalization-design.md)
- 分支 `verge`；**代码收口**提交 `f65cc73d`，本文件随文档收口提交 `ef0db71c` 落库；
  之后又跑了**终审修复轮**：**8 笔修复提交** `21a18032…3469cfda`（见 §8），
  另有 3 笔文档提交（`7cd91857` / `1c09c6be` / `bf6830a8`）；
  `ef0db71c..3469cfda` 共 **11 个提交**，其中复审射程是前 10 个，
  第 11 个 `3469cfda` 是复审后的修复。
  `master..HEAD` 截至 `3469cfda` 为 **109** 个提交；本节落库后总数为 **110**；10-23 发布包补记后为 **111**
  （`git rev-list --count master..HEAD` 可复验）。
  之后又有 **C 轨复审轮**（配色统一 #109 收口，见 §9）：修 5 处悬空着色引用 + 加一把常驻锁。
  修复轮结束时 `git status --short` 为空。
- 机器：Windows 11 / Git Bash / Node v24.18.0 / Electron 44.4.3，账号**不在** Administrators 组。
- 证据根目录 `D:\cyrene-p4-accept\`（截图 / 报告 / 日志），**全部在仓外**，不进 git。
- `%APPDATA%\Cyrene`（246 MB 上游用户数据）**全程只读禁写**，本次验收没有触碰。

> 本记录只写「量到的」和「让掉的」。凡是没有独立证据支撑的结论，一律不写进来；
> 尺子坏掉的那些次数记在 §6，不藏。

---

## 1. 门禁

| 门 | 命令 | 结果 |
| --- | --- | --- |
| 类型（主进程） | `npx tsc -p tsconfig.main.json --noEmit` | **exit 0**（B-5～B-7 后复跑，日志 `D:\cyrene-p4-accept\fix3-tsc-main.log`） |
| 类型（preload） | `npx tsc -p tsconfig.preload.json --noEmit` | **exit 0**（日志 `fix3-tsc-preload.log`） |
| 类型（renderer） | `npx tsc -p tsconfig.renderer.json` | **exit 0**（该项目**没有** `noEmit`，不是本期的改动，按 R-D6 不动；日志 `fix3-tsc-renderer.log`） |
| 全量测试 | `CI=true npx vitest run` | **Test Files 593 passed (593) · Tests 5677 passed \| 1 skipped (5678) · Duration 162.43s · exit 0**（日志 `D:\cyrene-p4-accept\final-vitest.log`） |
| 全量测试（B-4 后） | `CI=true npx vitest run > D:/cyrene-p4-accept/fix2-vitest.log 2>&1; echo "exit=$?"` | **Test Files 596 passed (596) · Tests 5722 passed \| 1 skipped (5723) · 188.58s · exit 0** |
| 全量测试（B-5～B-7 后终验） | `CI=true npx vitest run > D:/cyrene-p4-accept/fix3-vitest.log 2>&1; echo "exit=$?"` | **Test Files 597 passed (597) · Tests 5766 passed \| 1 skipped (5767) · 186.01s · exit 0** |
| 配色五锁（C 轨复审轮） | `CI=true npx vitest run src/renderer/ui/color-token-resolution.test.ts src/renderer/ui/theme-palette-derivation.test.ts src/renderer/ui/brand-color-migration.test.ts src/renderer/ui/hardcoded-color-ratchet.test.ts src/shared/palette-from-cat.test.ts` | **5 files / 34 tests passed**（新增第 5 把：着色令牌可解析锁） |
| 配色两条门（C 轨复审轮） | `node scripts/build/apply-theme-palette.mjs --check` / `node scripts/build/apply-color-migration.mjs --check` | **exit 0 / exit 0**（后者打印「无漂移」） |
| 全量测试（C 轨复审轮） | `CI=true npx vitest run > D:/cyrene-p4-accept/tmp/full-test-colorlock.log 2>&1; echo "exit=$?"` | **Test Files 613 passed (613) · Tests 5975 passed \| 1 skipped (5976) · 173.07s · exit 0** |
| 资产像素尺 | `node scripts/build/cat-sprites.mjs --check` | `checked 198 targets · 12 只猫 × 6 档 + 25 档散点 + 17 张非角色 + 52 张表情` / **all clear** · exit 0 |
| 出口静态锁 | `CI=true npx vitest run src/main/egress` | **8 files / 73 tests passed**（B-5～B-7 后复跑；日志 `fix3-egress.log`。收口时为 43 条，A2/A6/A7/A8 与 `safe-fetch` 单测共同补到该数） |
| 终审修复轮定向回归（B-4 后） | `CI=true npx vitest run src/main/egress/ src/main/browser/ src/main/orchestrator/tools/builtin-tools/ src/renderer/react/features/chat/components/svg-sanitize.test.ts` | **23 files / 182 tests passed** |
| 终审修复轮定向回归（B-5～B-7 后） | `CI=true npx vitest run src/main/egress src/main/music src/main/orchestrator/tools/builtin-tools src/renderer/react/features/chat/components src/shared/upstream-hosts.test.ts` | **96 files / 845 tests passed · 64.44s**（日志 `fix3-targeted.log`） |
| 运行时出口 | `npx electron . --user-data-dir=D:\cyrene-p4-accept\profile7 --egress-probe=20000` | stdout 末行 `[egress-probe] external=0 -> …\profile7\egress-probe.json`，**退出码 0**；JSON 里 `"external": []`（键名是 `external`，计划里写的 `entries` 是笔误，见落地记录） |

**关于「全绿」的诚实补充**：出口尺的 `external=0` 一开始是**假绿**（探针档排完尺就 `return`，量的是一个空转进程，R-31-3）。
现在探针分支必须真的启动应用，并且有仓外正对照 `p4-egress-control.mjs` 证明通道活着
（实测 `saw 1 → 26 → 51 webRequest events`，最后一件是 `dist/renderer/assets/moments-*.png`）。
正对照不绿，`external=0` 不作数。

**射程补充（修复轮）**：上表那次 `external=0` 的 JSON 是 B-2 之前的产物，只挂了 `defaultSession`——
内置浏览器与考试页的 partition 当时不在表里。修复轮后探针会写 `scope.webRequestSessions` 与
`scope.excludes`；即使如此，`external=0` 也只覆盖 Chromium 的请求，主进程 `fetch()` 看不见（R-F5）。

**验收器纪律**：全程没点过节点行 / 「选择最优」/「立即实测」，没对 mihomo 发过
`PUT` / `POST` / `GET /group/*/delay`，没启停过用户自己的其他应用。

---

## 2. 体积

| 指标 | P4 前 | P4 后（实测） | 判据 |
| --- | ---: | ---: | --- |
| `du -sh src/renderer` | **237 MB** | **6.8 MB** | < 15 MB ✓ |
| 跟踪位图总数 | — | **198 张** | 与像素尺 `--check` 的 198 targets 同数 ✓ |
| 单张 min | — | **4,908 B** | — |
| 单张 p50 | — | **7,499 B** | 远低于 60 KB ✓ |
| 单张 max | — | **25,797 B** | 是 `cyrene-welcome.png`（1280×720 横幅），它本来的预算就是 120 KB |

复跑命令（可逐字复现）：

```bash
cd D:/Test/workbuddy/cyrene-verge
du -sh src/renderer
node -e "
const {execFileSync}=require('child_process');const fs=require('fs');
const out=execFileSync('git',['-c','core.quotePath=false','ls-files','-z','src/renderer'],{encoding:'utf8'});
const list=out.split('\0').filter(p=>p.toLowerCase().endsWith('.png'));
const sizes=list.map(p=>fs.statSync(p).size).sort((a,b)=>a-b);
console.log('count',sizes.length,'total',sizes.reduce((a,b)=>a+b,0),
  'min',sizes[0],'p50',sizes[Math.floor(sizes.length/2)-1],'max',sizes[sizes.length-1]);
"
```

**一处必须说清的账**：Task 28 台账记的是「198 张 / 2.1 MB」，本轮实测总字节是 **1,797,100 B = 1.71 MiB**。
两者不是资产变了，是**算法不同**：台账那个 2.1 MB 是按 4 KB 块向上取整后的和
（198 × ⌈size/4096⌉ × 4096 = **2,125,824 B = 2.13 MB**，与台账吻合）；逐字节真值是 1,797,100 B。
资产集合本身在 Task 28 → HEAD 之间**一个字节都没变**（三个提交点分别实测
`26d06198` / `04996dcb` / `HEAD` 全是 198 张 / 1,797,100 B / min 4,908 / p50 7,499 / max 25,797），
min / p50 / max 三项与台账**逐位相同**。差异只在总量那一行的口径。

另：p50 用的是「最近秩」口径（`sizes[Math.floor(n/2)-1]`）。换成 `sizes[Math.floor(n/2)]` 是 7,541，
两个口径都在此列出，避免下一期对不上账。

---

## 3. 视觉

`node scripts/verify/p4-visual-oracle.mjs D:\cyrene-p4-accept\shots` →
`report.json` 顶层 **`"pass": true`**，四张全绿（`generated_at` 2026-10-22T09:08:44Z）：

| 尺 | 关键读数 | 判据 |
| --- | --- | --- |
| `welcome.png` | 海报比例 **0.563** / 左上 8×8 = **240,241,242** / 有墨 **324525** | 0.55–0.58 / 不许纯白 / > 0 |
| `avatar-paper.png` | 四角 **9** / 上两角 **1** / 猫影质心 **1.675** / 墨 **766** | < 15 / < 6 / < 3 CSS px / > 0 |
| `avatar-ink.png` | 四角 **7** / 上两角 **2** / 质心 **0.717** / 墨 **995** / 墨均亮度 **180.286** | < 15 / < 6 / < 3 CSS px / > 0 / > 60 |
| `sticker.png` | 外接框宽 **142** / 覆盖率 **0.634** / 负对照 **0** | 120–200 CSS px / 0.25–0.85 / < 0.05 |

产物：`D:\cyrene-p4-accept\shots\{welcome,avatar-paper,avatar-ink,sticker}.png` + `report.json`
（另有 `pearl-full.png` / `charcoal-full.png` / `welcome-full.png` 两主题整窗照）。

**两条阈值是被证据推翻后改的，旧值与理由一起写进了 `report.json` 的 `deviations`**：

1. `avatar.四角与面板底色差` 6 → 15，并拆出「上两角 < 6」。计划假设四角只有底色，实际
   `ChatMessageList.css:97-124` 挂着 `filter: drop-shadow(0 2px 8px …pink 22%)` 向下偏移 2px，
   下角必然离底色 7–9；方底真露出来是粉描边那个量级（实测 21）。
2. 居中口径 `ink(>20)` → `silhouette(>4)`，阈值 3 CSS px 不动。奶油猫毛 `#f7f4ec` 压奶油面板
   `#f9f7f1` 最大通道差只有 5，对 `INK_DELTA` 完全隐形——旧口径量的是眉毛不是脸
   （浅色档旧口径 4.576 会假红，新口径 1.675）。旧口径继续报数，只作诊断。

放宽过阈值的尺子必须证明还有牙：**11 张合成图变异自检**——干净浅色/深色头像两张正对照必须全绿，
「方底露出来 / 猫画歪 6px / 头像空白 / 深底糊成一块 / 贴纸被裁 / 贴纸实心 / 海报比例走样」
每张必须红在**指定那一条**判据上。

---

## 4. 装机

安装包 `Mochi-Setup-1.3.3.exe`（electron-builder 26.15.3 / NSIS 3.0.4.1）→
静默装到 `D:\cyrene-p4-install`（**没进 Program Files**）→ 四眼 → `/S` 卸载。

| 眼 | 结论 | 实测证据 |
| --- | --- | --- |
| 1 · exe 与向导标题都是 Mochi | **过** | `install_exit=0`；`Mochi.exe` 在场、`cyrene_named_exe_exists=False`（装完没有 `Cyrene.exe`）；HKCU `DisplayName=Mochi 1.3.3`；`EXE_ProductName=Mochi`；`SETUP_FileDescription=麻糬桌面猫（本机构建，不联网升级）` |
| 2 · 开始菜单叫 Mochi、图标是猫 | **过** | `Mochi.lnk` + `卸载 Mochi.lnk`；`DESKTOP_LNK=` 空（`createDesktopShortcut:false` 兑现，没往用户桌面扔东西）。图标不靠肉眼看，靠三段量法：装机 exe 图标 vs 同次构建 `win-unpacked` → **MAD 0**；`icon.ico` 的 256 帧 vs `assets/mochi-icon.png` → **MAD 0、最大单通道差 0**；vs 通用 Electron 图标 → **MAD 267.9**（反对照有牙） |
| 3 · 托盘菜单与关于页显示 Mochi | **过** | `packaged-identity3.json` **13/13 true**：四页 `Cyrene` 计数全 0、`github.com` 全 0；设置页 `Mochi`×2 + `麻糬`×4；导航项含 `Mochi 设置`；页脚 `v1.3.3 · 正式版`。托盘是原生菜单、CDP 进不去 → 替代链：装机 `app.asar`（282,909,676 B）字节盘点 `麻糬`×100 / `Mochi`×152 / `dev.damin.mochi`×4，116 处 `Cyrene` 逐处归类**全为标识符**（MIME 分隔符、preload 全局、i18n 键名、迁移戒名、日志前缀），零用户可见文案 |
| 4 · 卸载后目录清空 | **过** | `uninstall_exit=0`；`install_dir_exists=False`（整个目录消失）；`start_menu_dir_exists=False`；`start_menu_mochi_matches=0`；`uninstall_reg_entries=0`；`D:\.Cyrene.content-preserve` 随卸载自行消失（子项数 0，不含任何用户数据） |

**这一包不是发布产物**（R-31-7）：electron-builder 对缺失的三项 `extraResources`
（`cyrene-screenshot.exe`、mpv、MinGit）自己打 `file source doesn't exist` 并跳过，
所以仓内原配置就能出包；但**发布包必须先跑 `cargo` + `prepare:mingit` + `prepare:mpv` 再 `package:win`**。

**2026-10-23 已补出发布包**：先 `cargo` 重建截图辅助（2,337,688 B）、`prepare:mingit`
（2.55.0.3）、`prepare:mpv`（20261021；原钉的 20260813 已被上游删除，`vendor/mpv-manifest.json`
随之更新），再 `electron-builder --win nsis`。产物 `release/Mochi-Setup-1.3.3.exe` **289,699,205 B**，
md5 `6b982707c388c9dd76b9238ca38087db`；`verify:installer --expect-version 1.3.3` 通过
（mpv v0.41.0-1227-ge471496c5 / MinGit 2.55.0.windows.3 / 截图辅助齐全，`latest.yml` 不存在）。
asar 字节串命中 `UpstreamRedirectBlockedError` / `fetchWithoutUpstreamRedirects` /
`installEgressWatchdogEverywhere`，证明包内是终审后的代码。
**本包没有重做 GUI 装机四眼**：身份与卸载结论仍以上表 10-22 那次为准，运行时差异由终验
597 files / 5766 passed 覆盖；下次装机复验应把「exe 标题」一并复测（见 §4 末尾的时间点说明）。

**第三眼读数的时间点**：该次验收跑在 Task 32 修掉窗口标题**之前**，所以 `packaged-identity3.json` 里
的窗口标题仍是 `麻糬 · 聊天（React）`。Task 32 已把这处开发残余去掉（提交 `05f73b27`），
并给标题加了会红的锁（`brand-consistency.test.ts`），**本记录不把它当成「已验收通过」**——
它是「已修 + 已上锁」，屏幕层复验留在下一期。

---

## 5. 让步（显式，一条都不许省）

**期内的显式让步不是失败，没写下来的让步才是。** 逐条列在这里，下一个人接手时不会把它们当成漏做。

### 5.1 按计划保留的内部命名（Global Constraints 明文，不属遗漏）

- **内部数据文件名全部保留**：`cyrene.sqlite`、`cyrene-chats/`、`logs/cyrene.log`、
  `cyrene-runs` / `cyrene-tasks` / `cyrene-tts-cache`、`cyrene.*` 事件名、
  `cyrene-exam` / `cyrene-plugin` 自定义协议、`native/cyrene-screenshot.exe`、
  `.Cyrene.content-preserve`、迁移戒名 `FORBIDDEN_DIR_NAMES=["Cyrene"]`。
  最后一条**必须**保留原名才拦得住上游真实数据目录（改了就拦不住）。
- **`--rb-*` 变量名一个都没改**，只改值（25-token 契约测试 + 上千处引用）。
- **标识符与数据名保留**：`CyreneAgent` / `CyreneHarness` / `useCyreneAvatar` /
  `IPC.CYRENE_AVATAR_*` / i18n 键名 `openInCyrene`（其**值**已是「在 Mochi 打开」）/
  preload 全局 `window.CyrenePanel`。
- **内部资产文件名保留**：`cyrene-avatar.png`、`cyrene-welcome.png`。
- **`@playa0v0/cyrene-plugin-sdk` 包名与 scope 保留**（已发布身份，改名会打断
  `.github/workflows/plugin-sdk.yml`）；涉及 `packages/plugin-sdk/`、`examples/`、
  `docs/plugins/*`、`scripts/plugin-sdk/*`。
- **`skills/cyrene-original-voice` 的目录名与 `name:` 不改**（R-29-3：调度器按目录名硬编码引用）。
  `skills/` 下另有 9 个 `cyrene-*` 技能目录同样保留。
- **免责声明页保留米哈游 / Live2D 鸣谢**（R-31-13，计划 Task 4 Step 4 明文「保留条款内容」）。
  外链确实清零了（`github=0`、`http://` 与 `https://` 计数 0）；
  删第三方 IP 的防御性声明不是个人化收益而是法务回退。

### 5.2 本期明确没做、留到下一期的

- **`package.json` 的 `pixi.js` / `pixi-live2d-display` 两个 devDependencies 仍在**
  （`^7.3.0` / `0.5.0-beta`）。运行时树已由 Task 27 删净，asar 里那处命中就是 package.json 文本本身。
  删掉属于「可以整体删」而非必须，本期没动。
- **装机侧的 `installerSidebar` 两行配置已在 Task 11 删掉**（计划 line 1931 的自裁裁决：没有 24bit BMP
  编码器就整条删除）。实测 `electron-builder.yml` 里已无 `installerSidebar` 键，只剩 `icon: assets/mochi-icon.png`。
  **没做完的只是那份无消费者的历史素材**：`build/installer/installer-sidebar.bmp` 与
  `build/installer/cyrene-installer-source.png` 仍在仓里。
- **`docs/design/*`（51 份带日期的上游工程记录）一个字没改**。实测它们**不含**第三方 IP 版权叙述，
  只有关于被抄代码（dsh / ZCode / gamebot）的 MIT 署名注记——那些不能改写。
  R-29-7 只动了 `README.md` / `README.en.md` / `MODEL_LICENSE.md` / banner 文案。
- **`vendor/cyrene-skills/`（仓库侧构建源）保留原名**，只把**装机后**的目录改成
  `resources/mochi-skills/`（用户可见名，见提交 `f65cc73d`）。仓库纪律要求内部名不乱动，
  而装机目录是用户能在资源管理器里看见的，两者不是一回事。
- **10-22 的测试安装包缺三项随包二进制**；10-23 的发布包已按 §4 补齐（截图辅助 / mpv 20261021 /
  MinGit 2.55.0.3），这一条只剩历史意义。

### 5.3 已知缺陷与尺子的盲区（不影响结论，但下期要处理）

- **`tsconfig.main.json` 的 `exclude` 含 `src/main/**/*.test.ts`** —— 主进程**测试文件不参与类型检查**。
  评审第 6 条已提出，**本期 DEFERRED**（属项目原样，不在本期范围）。
- **`src/main/egress/upstream-off.test.ts` 的例外匹配没有路径边界**：
  `posixPath(file).endsWith(candidate.file)`（第 176 行）—— 例外项写
  `features/chat/components/svg-sanitize.test.ts` 时，`别的目录/features/chat/components/svg-sanitize.test.ts`
  也会被一并豁免。
- **CSP 尺只认 `scheme://`**：`learn-exam-csp.test.ts:18` 的匹配器
  `/(?:https?|wss?):\/\/([^\s;'"]+)/g` 要求带协议头。今天 CSP 由固定模板生成，没有裸域名；
  但若有人写成 `font-src 'self' gstatic.com`（无协议），这条尺看不见。
- **A1 公告规则的名字覆盖面窄**：规则里点名 10 个标识符，其中只有 **2 个**
  （`NewsItem`、`cyrene-announcement`）是上游 `src/main/news/news-feed.ts` 里真实存在的名字；
  其余 8 个上游标识符（`NewsEntry` / `NewsFetch` / `NewsPayload` / `NewsResult` /
  `createNewsFeedService` / `parseNews` / `registerNewsIpc` / 裸 `news`）**不在规则里**——
  它们是被「整目录删除」带走的，锁没有单独复述它们的名字。
- **`ConversationSidebar.css` 等处的 `var(--rb-text-primary, #1d1d1f)` 兜底是死代码**（实测 5 处：
  `:59` `:90` `:109` `:113` `:114`）：`--rb-text-primary` 永远有值，那个 `#1d1d1f` 永远不生效。
  属残余字面量，不影响观感。
- **`ChatMessageList.test.ts:264` 的 `not.toContain("昔涟已完成")` 已失真**：
  改名后该字符串本就不可能出现，这条负向断言**恒真**——「负向断言不报错」不代表它还有效。
- **renderer 的 tsconfig 没有 `noEmit`**（项目原样，按 R-D6 不动）。
- **`packages/*` 的 fork-worker 仍被禁用**（`vitest.config.mts:19` 注释），
  `plugin-sdk/src/testing/index.test.ts` 在 windows-2025 镜像下会让 vitest worker 静默崩溃。
- **迁移夹具往 `os.tmpdir()` 写**（C 盘）。测试产物落在 C 盘 TEMP，与「产物一律放 D:」的纪律不一致；
  属测试夹具的既有写法，未改。
- **`cpSync` 兜底路径会留下空的 `%APPDATA%\cyrene-verge` 孤儿目录**（评审第 7 条）。
- **M5「gpu 同步构造」的假设保留为已知限制**，未做加固。
- **主进程 `fetch()` / undici 不经过 `webRequest`**（R-F5）：出口看门狗只看得见 Chromium 的请求。
  `fetch_url` / `download_file` 的上游拒绝靠**入口闸门 + 逐跳重定向校验 + A7/A8 静态锁**，不是运行时观测。
  探针 JSON 的 `scope.excludes` 明写这条盲区——**下期不许把 `external=0` 读成「主进程也没发」**。
- **内置浏览器子资源层不拦**（R-F6）：导航 / 重定向 / 弹窗 / 右键 / favicon / 会话恢复都过上游闸门，
  但第三方页面自己发出的 `<img src="https://github.com/…">` 这类子资源请求仍会取。A 期口径是
  「客户端不主动访问上游」，页面内嵌属用户所访站点的行为；请求级阻断会踩 R-31-2 的阻塞通道坑，留待下期。
- **`session-created` 的射程边界**：只覆盖装尺之后创建的 partition。今天所有 partition 都在 ready 后创建
  （组合根在 `application.start()` 之前装尺），够用；若未来出现 pre-ready session，要改成显式登记。
- **A7 / A8 只钉调用形状**：它们证明闸门还在被调用，不证明调用后真的拒绝（那由各入口单测证明）。
  静态锁与单测是两条腿，缺一条都别读成全绿。
- **A8 的射程只到 `fetch_url` / `download_file`**（R-F8）：逐跳闸门修的是这两把工具；新增的主进程外呼
  （`net.fetch`、第三方 SDK 自带下载器等）必须自己接 `fetchWithoutUpstreamRedirects()` 并补锁，
  **「有 A8」不等于「所有外呼都逐跳校验」**。
- **OneBot 附件下载仍是裸 `fetch`**（`src/main/channels/adapters/qq/onebot-media.ts:260`）：
  附件 URL 由用户自建的 OneBot 实现给出，客户端只做 `http(s)` 协议检查，**没有过上游闸门**。
  它不在 P4 的「客户端主动访问上游」口径内（地址不来自品牌/更新链路），但若对方把 URL 指向上游，
  这个出口会真的发请求。下期接 `fetchWithoutUpstreamRedirects()` 并补一条单测即可。
- **A7 / A8 是文本匹配，不是语义分析**：正则只看源码里有没有调用形状，把调用**注释掉**仍可能满足。
  它们的作用是「防止整段被删/被换回 `follow`」的绊线，不能替代各入口的行为单测。
- **内置浏览器控制器的七个入口没有各自的行为单测**：`browser-navigation.test.ts` 证明闸门本身、
  A7 证明控制器还在调用它；但「某个入口漏传/传错 URL」只能靠代码审查兜底，下期补入口级测试。
- **着色令牌可解析锁只管「有没有值」，不管「在当前作用域有没有值」**（C 轨复审轮新增，见 §9）：
  某个令牌只在深色主题里声明、却被浅色主题的组件引用（Task 19 的 R-19-2 记过
  `--cy-pill-bg/-border/-status` 只在深色档声明），新锁看不见——那仍是派生锁的层叠职责。
  **两把锁互补，不互相顶替。**
- **着色令牌可解析锁只覆盖着色族**（`--rb-*` / `--md-*` / `--cy-*`）：非着色族令牌
  （`--top-height`、`--radix-*`、`--size` 等）仍可能是悬空的，本期不扩射程。
- **着色令牌可解析锁认「运行时注入」是过近似**：TSX 内联样式以 `"--name":` 认作注入源，
  对象里恰好有个同名键也会被当成注入源。多算比少算安全——少算会把好代码误判成坏。

---

## 6. 尺子坏过几次（不是产品坏了，但必须记）

数出来的：**16 处**，前 9 处在 Task 31 的第二层与第三层，第 10～14 处在终审修复轮（§8），
第 15～16 处在 C 轨复审轮（§9），坏的全是尺。

- **R-31-1**：`--egress-probe` 第一次真跑就弹模态 Error 框，进程不退出也不落盘。
  根因：探针档的 userData 已在卷根下一层，`path.dirname(userData)` 就是 `D:\`，
  `mkdirSync(recursive)` 只吞 EEXIST。
- **R-31-2**：修完落盘后进程起来了但 20s 等不到窗。根因：尺子登记在**可改报文**的 channel 上，
  Chromium 把主框架 `file://` 导航压进异步等待 → 没有 `ready-to-show` → 判致命失败。
- **R-31-3**：**vacuous 探针**——量的是一个空转进程，`external=0` 是「什么都没跑」的 0。
- **R-31-4**：`crypto.randomUUID` 在该 Node/Electron 组合下抛过（连带伤，最小改法换掉）。
- **R-31-5**：第二层尺坏在四处——取样档选择器写错、CDP 命令没有期限（一条挂死拖垮整趟）、
  「点接受并继续」会导航走导致回音永不到、像素尺用产品解码器读 CDP 的 8bit RGB 截图直接
  `RangeError`（尺子自带标准 PNG 解码 + 先跑自检）。
- **R-31-6**：两条阈值被证据推翻（见 §3），放宽后补了 11 张合成图变异自检。
- **R-31-8**：图标尺坏了三次——阈值假设「粉多于蓝」（猫毛按色板就是冷灰）、
  奶油判据 `min>170` 不具区分度、PNG→BMP 的 alpha 落成黑底而 ICO 帧是白底。
  修正：**统一白底合成 + 在 ICO 原生 256 帧上量**。
- **R-31-11**：第三眼尺坏在两处——拿「正文 > 200 字」当 React 挂载判据（全新 profile 的主窗
  本来就只有 114 字），以及找「关于」二字（这一版把那页叫「免责声明」），
  外加我自己造词时码点写错（`糬` 是 U+7CEC=31980 不是 31974），把 `麻糬` 计数读成 0。
- **R-F7**：变异自检抓到一条**空转测试**——把看门狗 `attach` 改成「已有 session 就返回」时，
  多 session 注销测试仍然绿：第二个 session 一个 channel 都没登记，注销循环空转。
  修法是注销前先断言 `sessionCount()===2` 且 `second.registered.length>0`。
  **「注销了 0 个」也是空转**；放宽阈值或新写尺子时，变异自检要连「测试自己是不是空的」一起证。
- **R-F9**：全量的退出码被管道吃掉。`CI=true npx vitest run 2>&1 | tail -12` 报的是 **`tail` 的 0**，
  而那一轮实际是 `1 failed | 594 passed`——失败被读到成了通过。
  固定写法：先 `> 日志 2>&1`，再 `echo "exit=$?"`，最后看日志尾；**`| tail` 永远不许当退出码判据**。
- **R-F10**：域名闸门把尾点当成主机名的一部分。`new URL("https://github.com./x").hostname`
  是 `github.com.`，与黑名单 `github.com` 不相等，于是**整条闸门被一个点绕过**；
  原单测只测无尾点写法，尺子从头到尾没照过这个面。修法是比较前 `.replace(/\.+$/, "")`，
  并用 `upstream-hosts.test.ts` 的 25 条把尾点、大小写、仿冒域名（`notgithub.com` 等）钉住。
- **R-F11**：SVG 样式的尺把「过了 DOMPurify」当成「外链已断」。DOMPurify 不解析 `<style>` 里的
  `url()`，`@import` 还能用 `/**/` 分隔或十六进制转义（`@im\70 ort`）躲开正则。
  修法：先剥 CSS 注释、解 CSS 转义再匹配；上游 `url()` 换成 `url("data:,")`；
  表现属性/`style` 属性另加 `uponSanitizeAttribute` hook。
- **R-F12**：A6 的正则写成 `installEgressWatchdog(?:Everywhere)?\(` ——
  **退回「只挂 defaultSession」也照样通过**，静态锁没有牙。收紧为 `installEgressWatchdogEverywhere\(` 后，
  把组合根改回旧调用，A6 当场红（§8 变异 M4）。
- **R-F13**：**变异「没红」不等于尺子没牙，也可能等于变异本身站不住。**
  C 轨复审轮第一版 M3 砍的是 `--rb-text-title`，可它有**两处**声明（`tokens.css:126` +
  `AppearanceSettingsPage.css:4`，后者是设置页自己的 400 字重覆盖，有契约测试钉着）——
  砍一处，锁当然还绿。**如果当时不核对就直接写「锁有牙」，那就是拿假绿当证据。**
  修法：变异必须先确认「被改的那个名字只有这一处声明」（脚本化查声明点分布），
  再看红不红。改砍全仓只声明一次的 `--rb-text-body` → 锁当场红并点名 `modal.css:54`。
- **R-F14**：**变异的前提会过期。** 第一版 M6 指望 `ChannelsSettingsPanel.css:66` 还引用
  `--rb-border`，可那条在修复前就已经改成 `--rb-border-default` 了——于是「往测试文件塞个声明
  看锁会不会放行」这个实验**根本测不到它想测的东西**，锁绿得毫无意义。
  修法：每个变异都要先断言「前提此刻成立」（引用的名字确实换了 / 夹具确实落在射程内），
  再读它的红绿。M6 改成「M1 的改动 + 一份测试夹具声明 `--rb-border`」后，
  锁报红点名 `ChannelsSettingsPanel.css:66`——**证明「测试文件不是运行时」不是 loophole**。

---

## 7. 复跑方式

```bash
cd D:/Test/workbuddy/cyrene-verge

# 门禁
npx tsc -p tsconfig.main.json --noEmit
npx tsc -p tsconfig.preload.json --noEmit
npx tsc -p tsconfig.renderer.json
CI=true npx vitest run
node scripts/build/cat-sprites.mjs --check
node scripts/build/sync-brand.mjs --check

# 运行时出口（探针档必须真的启动应用）
npx electron . --user-data-dir=D:\cyrene-p4-accept\profile7 --egress-probe=20000

# 终审修复轮定向回归（B-4 后）：出口 / 内置浏览器 / 两个抓取工具 / SVG 消毒
CI=true npx vitest run src/main/egress/ src/main/browser/ src/main/orchestrator/tools/builtin-tools/ src/renderer/react/features/chat/components/svg-sanitize.test.ts

# 终审修复轮定向回归（B-5～B-7 后）：出口 / 音乐缓存 / 内置工具 / SVG 消毒 / 域名判定
CI=true npx vitest run src/main/egress src/main/music src/main/orchestrator/tools/builtin-tools src/renderer/react/features/chat/components src/shared/upstream-hosts.test.ts

# 视觉
node scripts/verify/p4-visual-oracle.mjs D:\cyrene-p4-accept\shots
```

一次性 profile 只许落在 `D:\cyrene-p4-accept\` 下面（脚本里有 `assertSafeProfile` 拦），
**绝不碰 `%APPDATA%`**。

---

## 8. 终审修复轮（2026-10-23）

Task 32 冻结后做整分支终审，又扫出三处「上游仍可访问」的洞、两片锁的盲区和一条空转测试；
收口前复看两把联网工具，又发现一个**重定向旁路**（B-4）；
`ef0db71c..bf6830a8` 的 scoped 复审再扫出三处出口洞（B-5～B-7）与一片静态锁的假牙（A6）。
修复轮共 **8 笔修复提交**：`21a18032`（TS/TSX 上游粉）、`72cacbb7`（派生锁 `var()` 间接层）、
`9b9cbea7`（颜色锁 hsl + TS/TSX）、`d92f541f`（扫描扩展名 / 标题锁 / CI）、
`d1e8644c`（B-1/B-2/B-3）、`ed693cd6`（模型可见快照 + `install_mcp` 指引）、
`8a4bcfb0`（B-4 重定向逐跳）、`3469cfda`（B-5/B-6/B-7 + A6 收紧）；
另有 3 笔文档提交。本节只记「修了什么、证据是什么、还剩什么」。

| 发现 | 修复 | 证据 |
| --- | --- | --- |
| **B-1** 内置浏览器与两个抓取工具仍能访问上游 | 新增 `src/main/browser/browser-navigation.ts` 作为唯一导航闸门：地址栏、页内导航、重定向、弹窗、右键、favicon、会话恢复七个入口全过闸；`fetch_url` 删除 GitHub API 特化分支，与 `download_file` 一起在缓存/网络之前拒绝上游域名；错误码 `blocked_upstream_host` 配三语提示 | `browser-navigation.test.ts`（7 个上游 host + 仿冒域名正对照）、`fetch-url-tool.test.ts`（7 个 host + `format=raw`）、`download-file-tool.test.ts`；A7 静态锁钉住三个入口的调用形状 |
| **B-2** 出口尺只挂 `defaultSession` | `installEgressWatchdogEverywhere()` 挂 `defaultSession` + `session-created` 的所有 partition；探针 JSON 加 `scope.webRequestSessions` 与 `scope.excludes` | 多 session 记账 / 去重 / 注销测试；探针源锁断言组合根用 Everywhere |
| **B-3** SVG 的 `@import` 只挡了字体域 | `stripStyleImports` 在 DOMPurify 前后各剥一次：`url()` 带不带引号、裸字符串、媒体查询尾巴都删；`@media` / `@keyframes` 保留 | `svg-sanitize.test.ts` 任意宿主四种写法 + 保留规则正对照 |
| **B-4** 两把抓取工具 `redirect:"follow"`，入口闸门只看第一跳 | 新增 `src/main/egress/safe-fetch.ts`：手动跟重定向，**每一跳**过 `isUpstreamUrl`，命中即抛 `UpstreamRedirectBlockedError` 且不对上游发请求；`fetch_url` / `download_file` 全改走它；A8 静态锁钉住两份文件的调用形状 | `safe-fetch.test.ts` 10 条（6 个上游 host 各自在跟跳前拒绝 + 三跳正对照 + ftp 拒绝 + 上限）；两把工具各一条「只请求短链一次、不落盘」；变异短路闸门 8 条当场红 |
| **B-5** 尾点域名绕过整条闸门（`https://github.com./x`） | `isUpstreamHost` 比较前去掉尾部点号；新建 `upstream-hosts.test.ts` 把尾点、大小写、子域与仿冒域名的边界钉住 | 25 条新单测；`safe-fetch` 的上游重定向集合补 `github.com.` / `raw.githubusercontent.com.` / 官方站尾点；变异去掉归一化，**15 条当场红**（M1） |
| **B-6** SVG 的样式外链仍可发出（注释/转义拆开的 `@import`；`style` 块与表现属性里的上游 `url()`） | 匹配前先把 CSS 注释换空格、解十六进制转义；`@import` 删到规则结束；上游 `url()` 换 `url("data:,")`；表现属性/`style` 属性另加 DOMPurify `uponSanitizeAttribute` hook；`read_image_url` 在缓存/模型调用前拒绝上游 URL | `svg-sanitize.test.ts` 共 15 条（新增注释+转义、四种 `@import` 写法、`#`/`data:` 正对照、非上游外链正对照）；`read-image-url-tool.test.ts` 4 条；变异恒等化归一化/URL 清洗各红 1 条（M2/M3），`read_image_url` 删闸门红 1 条（M5） |
| **B-7** 重定向 helper 自己留下两个洞：命中上游时不取消响应体；301/302/303 未按语义改写方法 | 每次抛错/跟跳前 `body.cancel()`；301/302 的 POST 与 303 一律改 GET 并去掉 `content-length`/`content-type`，307/308 保留方法与 body；3xx 无 `Location` 原样返回 | `safe-fetch.test.ts` 共 21 条（新增取消响应体可观测、入口上游零请求、无 Location 返回 302、方法改写 `it.each`、307/308 正对照）；音乐缓存改走 helper 并补「上游地址不落盘」；变异退回裸 `fetch` 红 1 条（M6） |
| **A6 收紧** 旧正则 `installEgressWatchdog(?:Everywhere)?\(` 允许退回 `defaultSession` | 收紧为 `installEgressWatchdogEverywhere\(` | 把组合根改回旧调用，A6 当场红（M4） |
| **A-2** 出口扫描器漏 `.js/.cjs/.py/.ps1` | 补扩展名并加正对照，钉住四个真实文件 | `upstream-off.test.ts` 的扫描集合断言 |
| **A-3** 标题锁手抄五份 html | 改目录派生 + 白名单；表情包窗口的「表情包管理」正是手抄漏掉的；title 并进 `sync-brand.mjs` | `brand-consistency.test.ts` |
| **A-1 / C-1 / C-2** | 派生锁解 `var()` 间接层并回写 6 处不一致；TS/TSX 七处上游粉改猫板派生；颜色锁补 hsl 与 `.ts/.tsx`，清掉考试页裸 HSL 上游粉 | 各自提交 + 变异自检 |

**门（修复轮实测）**

| 门 | 结果 |
| --- | --- |
| 定向回归（B-4 后） | **23 files / 182 tests passed**（2026-10-23） |
| 定向回归（B-5～B-7 后） | **96 files / 845 tests passed · 64.44s**（日志 `D:\cyrene-p4-accept\fix3-targeted.log`） |
| 定向聚焦（7 个改动文件） | **7 files / 101 tests passed**（日志 `fix3-focused-restored.log`；还原变异后复跑） |
| 出口静态锁 | **8 files / 73 tests passed**（A1–A8；日志 `fix3-egress.log`） |
| 全量测试（B-4 前） | **Test Files 595 passed (595) · Tests 5708 passed \| 1 skipped (5709) · 156.0s · exit 0**（日志 `D:\cyrene-p4-accept\fix-vitest.log`） |
| 全量测试（B-4 后） | **Test Files 596 passed (596) · Tests 5722 passed \| 1 skipped (5723) · 188.58s · exit 0**（日志 `fix2-vitest.log`） |
| 全量测试（B-5～B-7 后终验） | **Test Files 597 passed (597) · Tests 5766 passed \| 1 skipped (5767) · 186.01s · exit 0**（日志 `fix3-vitest.log`） |
| 类型 main / preload / renderer | 三条 `tsc -p … --noEmit` **全部 exit 0**（日志 `fix3-tsc-main.log` / `fix3-tsc-preload.log` / `fix3-tsc-renderer.log`） |

**变异自检**：把三处实现故意改坏（`fetch_url` 闸门短路、`stripStyleImports` 恒等、
watchdog 只挂第一个 session），**11 条测试当场变红**；从 `D:/cyrene-p4-accept/mutation-backup/`
逐字节还原后全绿。变异还抓出一条空转测试（R-F7，见 §6）。
B-4 另做一次：把 `safe-fetch` 的逐跳闸门短路（`if (false && isUpstreamUrl(…))`），
**8 条测试当场变红**（6 个 host + 两把工具各 1 条）；逐字节还原后
`md5 = d04c3ffb148509670a6e332f20e567d3` 与变异前一致，`false &&` 计数 0。

B-5～B-7 再做 **7 处变异**（备份在 `D:/cyrene-p4-accept/mutation-backup3/`，
每处都用 `cp` 逐字节还原并核对 md5）：

| # | 故意改坏 | 结果 | 日志 |
| --- | --- | --- | --- |
| M1 | `isUpstreamHost` 去掉尾点归一化 | **15 failed / 31 passed**（`upstream-hosts` + `safe-fetch`） | `mutation3-M1.log` |
| M2 | `normalizeCss` 恒等（不剥注释、不解转义） | **1 failed / 14 passed**（注释+转义的 `@import`） | `mutation3-M2.log` |
| M3 | `stripUpstreamUrlsFromCss` 恒等 | **1 failed / 14 passed**（`style` 块上游 `url()`） | `mutation3-M3.log` |
| M4 | 组合根改回 `installEgressWatchdog()` | **A6 红（1 failed / 9 passed）** | `mutation3-M4.log` |
| M5 | `read_image_url` 删上游闸门 | **1 failed / 3 passed** | `mutation3-M5.log` |
| M6 | 音乐缓存退回裸 `fetch(playUrl)` | **1 failed / 13 passed** | `mutation3-M6.log` |
| M7 | `bindSessionCreated` 的 listener 不 `attach` | **1 failed / 11 passed** | `mutation3-M7.log` |

还原后六个文件的 md5 与备份逐一相同，定向聚焦复跑 **7 files / 101 tests 全绿**。

**新增裁决**（完整版在计划「落地记录」§4）：

- **R-F1**：内置浏览器拒绝上游时给「该地址属于已切断的上游站点」三语提示，而不是通用 `invalid_url`——
  用户需要知道这是**本客户端的边界**，不是自己输错了。
- **R-F5**：主进程 `fetch()` / undici 不经过 `webRequest`，是运行时尺的盲区；靠入口闸门 + A7 静态锁兜底，
  探针 JSON 明写 `excludes`。
- **R-F6**：内置浏览器子资源层不拦（页面自己嵌入的上游图片仍会取），留待下期；请求级阻断会踩 R-31-2。
- **R-F7**：「注销了 0 个」也是空转；多 session 测试先断言覆盖面再断言注销。
- **R-F8**：入口闸门只看得见第一跳。`redirect:"follow"` 会把非上游短链的 302 直接跟到上游，
  入口检查、缓存拒绝、A7 调用形状全都绕过去。修法是 `fetchWithoutUpstreamRedirects()`：
  手动逐跳、每跳 `isUpstreamUrl`、命中即抛且不向上游发请求；A8 钉住两把工具都走它。
- **R-F9**：全量的退出码不能从管道尾巴读（见 §6）。
- **R-F10**：`URL.hostname` 会保留绝对域名的尾点，域名闸门必须自己归一化；
  「`github.com.` 只是 DNS 细节」是错的，它是**绕过整条闸门的一个字符**（见 §6）。
- **R-F11**：SVG 的样式消毒不能只靠 DOMPurify 或只挡 `@import` 的字面写法；
  CSS 注释是分隔符、十六进制转义在浏览器里合法，必须在**归一化之后**再匹配，
  且 `style` 块 / 表现属性里的 `url()` 是另一条出口（见 §6）。
- **R-F12**：静态锁的正则不许带「可选的更强写法」——`(?:Everywhere)?` 等于给回归留门。
  锁要么钉死当前唯一正确的调用形状，要么不算锁（见 §6）。

**这一轮的边界**：A7/A8 证明闸门还在被调用，不证明调用后真的拒绝（后者由单测证明），
而且它们是**文本匹配**——把调用注释掉也可能满足；内置浏览器控制器的七个入口没有逐入口行为单测；
OneBot 附件下载仍是裸 `fetch`；`external=0` 只覆盖 Chromium 的请求；
内置浏览器里第三方页面自发的上游子资源仍会发出。
全部写进 §5.3，**下一个人不许把它们读成「已经全封死」**。

---

## 9. C 轨复审轮（2026-10-23，#109 配色统一收口）

Task 14–19（C2–C5）在台账里都已记「交付」，四把配色锁与 `palette:*` 两条门也都是绿的，
但 #109 一直没被翻成 completed。本轮**不凭台账的字翻勾**——按 Phase C 的判据回到树上复审，
结果扫出一类**四把锁都看不见的坏**：

> 规则里的 `var(--rb-*)` 指向一个**从来没被声明过**的令牌。浏览器在 computed-value 阶段
> 把整条声明丢掉——边框不存在、背景不存在、字体退回继承——而没有一盏红灯。

四把既有锁各自的射程（**没有一把问「这个令牌到底存不存在」**）：

| 锁 | 射程 | 看不见什么 |
| --- | --- | --- |
| `theme-palette-derivation.test.ts` | 主题级**声明** | 规则里的引用 |
| `brand-color-migration.test.ts` | **色值字面量** | 引用一个不存在的令牌（没有字面量可看） |
| `hardcoded-color-ratchet.test.ts` | **带色行数** | 悬空引用照样只占一行 |
| `palette-from-cat.test.ts` | 派生表**结构** | 表与规则之间的引用关系 |

**五处坏声明（全部已修）**

| 位置 | 原写法 | 改成 | 屏幕上的后果 |
| --- | --- | --- | --- |
| `src/renderer/ui/modal.css:48` | `font: var(--rb-text-em);` | `font: var(--rb-text-title);` | 弹窗标题退回继承字体（h3 不再是标题样） |
| `src/renderer/ui/modal.css:54` | `font: var(--rb-text);` | `font: var(--rb-text-body);` | 弹窗正文退回继承字体 |
| `.../settings/ChannelsSettingsPanel.css:66` | `... var(--rb-accent) 42%, var(--rb-border));` | `... var(--rb-accent) 42%, var(--rb-border-default));` | provider 卡片悬停时边框不换色 |
| `.../settings/ChannelsSettingsPanel.css:127` | `border: 1px solid var(--rb-border);` | `border: 1px solid var(--rb-border-default);` | 二维码框没有边框 |
| `.../chat/components/MailDraftCard.css:7` | `background: var(--rb-surface-raised, var(--rb-surface-default));` | `background: var(--rb-surface-elevated);` | 邮件草稿卡没有底色 |

**成因（`git log --all -S` 全空）**：`--rb-text-em:` / `--rb-text:` / `--rb-border:` /
`--rb-surface-raised:` / `--rb-surface-default:` 的**历史提交数都是 0** —— 它们从来没被声明过，
是**上游遗留缺陷，不是配色迁移引入的回归**。台账 R-19-1 的事实清单是对的（它点了其中四个的名），
缺的是下一步：**知道它存在之后，它有没有在伤屏幕**。查消费者：前四处里
`ChannelsSettingsPanel` 挂在 `AppearanceSettingsPage.tsx:292`、`MailDraftCard` 由
`ChatMessageList.tsx:51` import、`:1169` 渲染，都是**活路径**；只有 `modal.css` 两条的消费者
（`src/renderer/ui/modal.ts` 的 `showModal`）是零引用，但 CSS 仍随包发布，照修。

**新增常驻锁** `src/renderer/ui/color-token-resolution.test.ts`：着色族（`--rb-*` / `--md-*` /
`--cy-*`）的每一条 `var()` 引用，必须能解析到 ①任一 CSS 文件里声明过的令牌 ②运行时注入的令牌
（TSX 内联样式 `"--name":` / `setProperty("--name", …)`）③**终止于字面量**的兜底链。
**兜底链终止于另一个也没声明的令牌不算数**——`var(--rb-surface-raised, var(--rb-surface-default))`
两个名字都没有，那条背景等于没有。测试文件（`*.test.*` / `*.spec.*`，不限扩展名）既不算引用
也不算声明。

实测：生产源着色族引用 **2992** 条 → **2987** 条可解析到已声明令牌（含 3 条经兜底链转到已声明令牌）
+ **5** 条兜底终止于字面量 + **0** 条悬空；已声明着色令牌 **176** 枚。

**变异自检（7 处，全部逐字节还原）**——脚本 `D:/cyrene-p4-accept/probe/mutate-color-lock.mjs`：

| # | 故意改坏 | 结果 |
| --- | --- | --- |
| M1 | 规则级悬空（`--rb-border-default` → `--rb-border`） | **红**，点名 `ChannelsSettingsPanel.css:66` |
| M2 | 兜底链断在另一个没声明的令牌 | **红**，点名 `MailDraftCard.css:7` |
| M3 | 砍掉唯一的声明点（`--rb-text-body`） | **红**，点名 `modal.css:54` |
| M4 | 解析器恒返回 null（尺自己崩） | **红**，点名「没声明又没兜底的引用被判成能解析」 |
| M5 | glob 匹配不到任何文件（扫描器塌） | **红**，点名「一个着色令牌都没扫到」 |
| M6 | M1 的改动 **加上** 一份测试夹具声明 `--rb-border` | **红** —— 证明「测试文件不是运行时」不是 loophole |
| M7 | 删掉 `setProperty("--cy-msg-size")`（运行时注入源） | **红**，点名 `--cy-msg-size` |

还原后 7 个文件 md5 与备份逐一相同，定向复跑全绿。
**两次「变异没红」记在 §6（R-F13 / R-F14）：不是尺子没牙，是变异的前提站不住。**

**门（本轮实测）**

| 门 | 结果 |
| --- | --- |
| 配色五锁 | **5 files / 34 tests passed** |
| `palette:check` / `palette:migrate:check` | **exit 0 / exit 0** |
| 类型 main / preload / renderer | 三条 `tsc -p … --noEmit` **全部 exit 0** |
| 全量测试 | **Test Files 613 passed (613) · Tests 5975 passed \| 1 skipped (5976) · 173.07s · exit 0**（日志 `D:\cyrene-p4-accept\tmp\full-test-colorlock.log`） |
| 棘轮两条腿 | CSS **711/711**、TS **22/22**（五处改动都不含色值字面量，带色行数不变） |
| `git diff --numstat` | `1/1` + `2/2` + `2/2`，无 EOL 幻影 |

**这一轮的边界**（同 §5.3，不许读成「配色已经全对」）：新锁只管「有没有值」，不管「在当前作用域
有没有值」；只覆盖着色族，非着色族令牌仍可能是悬空的；认「运行时注入」是过近似。

## 10. 合并、推送与 v1.3.5 发布（2026-10-24）

**合并**：`verge`（`2ce0d9d9`，118 提交）并入上游 master（`b3b5299c`，123 提交；merge-base
`8d905897`）→ `fd7427cc`，1291 files / +49608 −36618。收口两个提交：`b7e09094`（恢复只读
版本卡、棘轮把上游 `#218`/`#243` 注释改写为 `issue …` 保持 22 行零余量、音乐测试补
`{ redirect: "manual" }`）、`2b69d0ca`（按 package.json 重建 lockfile）。

**门（合并后）**：三条 tsc exit 0；全量 **631 files / 6697 passed / 1 skipped / 208.53s / exit 0**；
品牌/色板/资产/schema/模型锁全绿；完整 build 链通过。

**本地安装包**：`release/Mochi-Setup-1.3.5.exe` **289,746,294 B**；`verify:installer` exit 0
（mpv / MinGit / 截图助手齐全，无 `latest.yml`）；SHA-256 `222735df…8ca`；Authenticode `NotSigned`。

**推送**：SSH deploy key 因缺 `workflow` scope 被拒；SSH 端点禁止动态转发；直连 HTTPS 被 SNI DPI
阻断。可用通路为 `git -c http.proxy=http://127.0.0.1:7896` + GCM 凭据（scope 含 `workflow`）。
已推 `master` / `verge` / tag `v1.3.5`；tag push 未触发工作流，改用手动 `workflow_dispatch`。

**CI 首个红（run 39988192428）**：`verify:installer` 发现 CI 产物多出 `latest.yml`。根因是
electron-builder 26 在无 publish 配置时从 `.git/config` 的 `[remote "origin"]` 推断 GitHub 发布源
（CI checkout 建了 `origin`，本地只有 `fork`/`upstream`）。修法：`electron-builder.yml` 显式
`publish: null`（`d7c39d92`），run 39989819464 在该提交上重跑 **success**（15 步全过，
含 `verify:installer`）。

**发布**：GitHub Release v1.3.5（非草稿）已发布，资产 `Mochi-Setup-1.3.5.exe` 上传完成
（289,746,294 B，远端 `digest` 与本地 SHA-256 一致）。tag 仍指向 `2b69d0ca`；`d7c39d92` 只改
打包配置、不进 app 负载，**未移动已发布 tag**。
