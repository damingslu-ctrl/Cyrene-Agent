# P4 个人化验收记录（2026-10-19 / 2026-10-22 收口）

- 计划：[docs/verge/plans/2026-10-19-p4-personalization-mochi.md](../plans/2026-10-19-p4-personalization-mochi.md)
- Spec：[docs/verge/specs/2026-10-19-mochi-personalization-design.md](../specs/2026-10-19-mochi-personalization-design.md)
- 分支 `verge`；**代码收口**提交 `f65cc73d`，本文件随文档收口提交 `ef0db71c` 落库
  （`master..HEAD` 共 **98** 个提交，截至 `ef0db71c`），工作区干净。
- 机器：Windows 11 / Git Bash / Node v24.18.0 / Electron 44.4.3，账号**不在** Administrators 组。
- 证据根目录 `D:\cyrene-p4-accept\`（截图 / 报告 / 日志），**全部在仓外**，不进 git。
- `%APPDATA%\Cyrene`（246 MB 上游用户数据）**全程只读禁写**，本次验收没有触碰。

> 本记录只写「量到的」和「让掉的」。凡是没有独立证据支撑的结论，一律不写进来；
> 尺子坏掉的那些次数记在 §6，不藏。

---

## 1. 门禁

| 门 | 命令 | 结果 |
| --- | --- | --- |
| 类型（主进程） | `npx tsc -p tsconfig.main.json --noEmit` | **exit 0** |
| 类型（preload） | `npx tsc -p tsconfig.preload.json --noEmit` | **exit 0** |
| 类型（renderer） | `npx tsc -p tsconfig.renderer.json` | **exit 0**（该项目**没有** `noEmit`，不是本期的改动，按 R-D6 不动） |
| 全量测试 | `CI=true npx vitest run` | **Test Files 593 passed (593) · Tests 5677 passed \| 1 skipped (5678) · Duration 162.43s · exit 0**（日志 `D:\cyrene-p4-accept\final-vitest.log`） |
| 资产像素尺 | `node scripts/build/cat-sprites.mjs --check` | `checked 198 targets · 12 只猫 × 6 档 + 25 档散点 + 17 张非角色 + 52 张表情` / **all clear** · exit 0 |
| 出口静态锁 | `CI=true npx vitest run src/main/egress` | **7 files / 43 tests passed** |
| 运行时出口 | `npx electron . --user-data-dir=D:\cyrene-p4-accept\profile7 --egress-probe=20000` | stdout 末行 `[egress-probe] external=0 -> …\profile7\egress-probe.json`，**退出码 0**；JSON 里 `"external": []`（键名是 `external`，计划里写的 `entries` 是笔误，见落地记录） |

**关于「全绿」的诚实补充**：出口尺的 `external=0` 一开始是**假绿**（探针档排完尺就 `return`，量的是一个空转进程，R-31-3）。
现在探针分支必须真的启动应用，并且有仓外正对照 `p4-egress-control.mjs` 证明通道活着
（实测 `saw 1 → 26 → 51 webRequest events`，最后一件是 `dist/renderer/assets/moments-*.png`）。
正对照不绿，`external=0` 不作数。

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
- **测试安装包缺三项随包二进制**（见 §4 末尾），不是发布产物。

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

---

## 6. 尺子坏过几次（不是产品坏了，但必须记）

数出来的：**9 处**，全部在 Task 31 的第二层与第三层，坏的全是尺。

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

# 视觉
node scripts/verify/p4-visual-oracle.mjs D:\cyrene-p4-accept\shots
```

一次性 profile 只许落在 `D:\cyrene-p4-accept\` 下面（脚本里有 `assertSafeProfile` 拦），
**绝不碰 `%APPDATA%`**。
