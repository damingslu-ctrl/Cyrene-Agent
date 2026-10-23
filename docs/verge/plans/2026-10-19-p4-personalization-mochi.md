# P4 个人化改造（Mochi）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to execute this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把这个 fork 改造成一个完全属于用户自己的独立软件——默认启动零对外请求、身份与装机名归 `Mochi`、全客户端配色从猫的色板推导、所有动漫形象换成同一套矢量猫程序化生成的位图。

**Architecture:** 四条面各有一座「唯一来源」：出口面用运行时看门狗（`session.webRequest` 记表）当尺，而不是靠 grep 断言「没有间接路径」；身份面用 `src/shared/brand.ts` 单点，`electron-builder.yml`/`package.json` 由 `scripts/build/sync-brand.mjs` 从它生成，并有生成物一致性测试；配色面用 `src/shared/pet-tokens.ts` → `src/shared/palette-from-cat.ts` → 主题声明面的值，`scripts/build/apply-theme-palette.mjs` 负责把派生值写回 CSS（只改值不改名），再加一把派生锁测试按真实层叠顺序逐色断言「∈ 猫色板 ∪ `wash(板内色)` ∪ 显式白名单」；形象面用 `src/renderer/pet/art.ts` 的 DrawOp 原语扩成变体库，构建期由 `scripts/build/cat-sprites.mjs` 光栅化成 PNG 写进应用**已经在看的确切路径**。分期执行顺序 A（断上游）→ B（自有身份）→ C（配色统一）→ D（形象换猫）→ E（收尾验收）。

**Tech Stack:** TypeScript / Electron 44（`session.webRequest`、`net.fetch`、`BrowserWindow`）/ React 19 + CSS 自定义属性 / Node 24 ESM 脚本（`zlib` + 手写 PNG 编码，无浏览器、无新依赖）/ vitest 5。

**Spec:** [docs/verge/specs/2026-10-19-mochi-personalization-design.md](../specs/2026-10-19-mochi-personalization-design.md)（§1 五条裁决 M1–M5、§2 现状事实、§3 分期 A1–A6/B1–B6/C1–C6/D1–D6/E1–E3、§4 验收三层尺、§5 六条风险、§6 明确不做）

**前置：** P0+P1 已收口（终审 + 复审修复链见 `.superpowers/sdd/2026-10-17-p0-p1-pixel-cat-shell/progress.md`）。P4 是插在 P2/P3 之外的独立轨道，可与它们交错，但**B1（拆 obf 密钥的雷）必须早于任何改名或换 userData 目录的动作**——这是本计划把 A 期放最前面、并把 B1 排在 B 期第一位的原因。

---

## Global Constraints

- **`%APPDATA%\Cyrene` 全程只读禁写**：那是用户真实数据。迁移器只允许以显式常量指向 `cyrene-verge`，且必须有测试断言「不碰 Cyrene」。
- **不 `git push`**：`upstream` 是 `https://github.com/Playa-Cyrene/Cyrene-Agent.git`，本轨道的目的就是不接收它任何东西。
- 提交格式 `type(scope): 中文描述`。
- 测试门：`CI=true npx vitest run <paths>`（**pnpm 不在 PATH**，别写 `pnpm test`）。类型门：`npx tsc -p tsconfig.main.json --noEmit` 与 `npx tsc -p tsconfig.renderer.json --noEmit`。
- **M5：不动模型接入能力**。11 家供应商条目一律留着（本就 key-gated，不配 key 不发请求）；不删第三方 channel/TTS/ASR 适配器。本计划删的只有上游品牌链接与上游注册表。
- **B4 裁决 (c)：不改内部数据文件名与自定义协议名**（`cyrene.sqlite`、`cyrene-chats/`、`logs/cyrene.log`、`cyrene-runs`、`cyrene-tasks`、`cyrene-tts-cache`、`cyrene.*` 事件名、`cyrene-exam`/`cyrene-plugin` scheme、`native/cyrene-screenshot.exe`）。「内部字符串还带 cyrene」是被明确接受的遗留，不是遗漏。
- **M3：`--rb-*` 变量名一个都不改，只改值**。新建变量体系会同时打爆 25-token 契约测试与上千处引用。
- **禁止一次性正则替换全部色值**（spec §C5 明确不做）：会把语义色、状态色、透明度层级一起打平，且无法用像素尺证明没改错。清扫按目录逐批、每目录一提交。
- **生成物进 git，构建期不依赖网络**：`cat-sprites.mjs` 的输出必须提交，像素尺才可跨提交比较；光栅化不许引入需要下载的东西。
- **像素尺只认稳健量**（质心、色相、覆盖度），不认逐字节——native 侧「桌布自己在动 → 哈希前必须量化」的教训。
- **验收三层尺纪律**（spec §4）：负判据一律配正对照；尺自己崩了不许读成 PASS；环境不合格 `exit ENV` 并点名压屏窗口。
- **验收器永不点击**：节点行、「选择最优」、「立即实测」一律不点；不对 mihomo 发 `PUT`/`POST`/`GET /group/*/delay`。
- **上游文件改动按形态记账而非按个数**（P1 收口后的新口径）：纯追加优先；有删改的每处提交正文必须写明「为什么不能落在新目录」。
- 本机不在 Administrators：**缓存与产物一律放 `D:`**，不写 TEMP。
- native 参考侧 `D:\Test\workbuddy\clash verge\` 只读；**禁读文件 `D:\Test\workbuddy\clash verge\src\mascot.ts`**。
- 不做整体重排版：本期换皮换骨不换信息架构。

---

## 文件结构

| 路径 | 动作 | 责任 |
| --- | --- | --- |
| `src/main/egress/egress-watchdog.ts` | 新建 | 给默认 session 挂 `webRequest` 监听，把非本地请求记进内存表；只有这张表能证明「零出口」 |
| `src/main/egress/egress-probe.ts` | 新建 | `--egress-probe` 探针档：空闲 N 秒后打表、落 JSON、退出 |
| `src/main/news/` | 删除 | 公告子系统（唯一的开机自动 fetch 之一） |
| `src/renderer/react/hooks/useNewsFeed.ts` | 删除 | 挂载即触发公告请求的渲染端钩子 |
| `src/renderer/ui/fonts.css` | 修改 | 去掉 Google Fonts `@import`，换系统字体栈 |
| `src/main/protocols/learn-exam-csp.ts` | 修改 | 去掉字体域名放行 |
| `src/main/updater/github-app-updater.ts` | 删除/改死 | 6h `setInterval` 与 GitHub feed |
| `src/main/updater/app-update-service.ts` | 修改 | 删 `checkForUpdates`/`downloadUpdate`/`quitAndInstall` 路径 |
| `src/renderer/react/features/settings/app-update-view.ts` | 修改 | 设置页改为「本机构建，不联网」的版本信息 |
| `scripts/verify/installer-artifacts.mjs` | 修改 | 不再硬性要求 `latest.yml`/`.blockmap` |
| `src/renderer/**/IssueReportDialog.tsx` | 删除/改文案 | 上游 Issue 上报入口 |
| `src/main/windows/external-link.ts` | 修改 | 放行白名单收窄为「不放行上游域名」 |
| `src/main/plugin-marketplace.ts` | 修改 | 远端注册表分支删除，只留 `userData/plugins` 本地枚举 |
| `src/shared/brand.ts` | 新建 | **唯一身份来源**：`PRODUCT_NAME`/`PRODUCT_NAME_ZH`/`APP_ID`/`DATA_DIR_NAME`/`LOG_PREFIX`/`TITLE_SUFFIX` |
| `scripts/build/sync-brand.mjs` | 新建 | 从 `brand.ts` 生成 `electron-builder.yml` 与 `package.json` 的身份字段 |
| `src/main/channels/settings-store.ts` | 修改 | XOR key 去身份派生 + 4 字节校验和 + `obf:2:` 版本化 + 一次性重加密 |
| `src/main/app-identity.ts` | 修改 | 名字与 userData 目录改为读 `brand.ts`；串接迁移 |
| `src/main/user-data-migration.ts` | 修改 | `%APPDATA%\cyrene-verge` → `%APPDATA%\Mochi` 一次性搬迁，幂等、可回退 |
| `src/shared/pet-tokens.ts` | 移动 + 修改 | 猫色板从 `src/renderer/pet/tokens.ts` 搬进 shared（主进程也要读它），并收进 `art.ts` 的 11 个私有色 |
| `src/shared/palette-from-cat.ts` | 新建 | 从猫色板算出全部 `--rb-*` 值（`wash()` 口径），主/渲染两端共用 |
| `scripts/build/apply-theme-palette.mjs` | 新建 | 把派生值按令牌名逐条写回 CSS（只改值、不改名、不增删声明），`--check` 供 CI |
| `src/renderer/ui/theme.css` | 修改 | 删掉与主题文件重名的色声明（现同一名字在 4 个文件里各写一遍，最后写的才生效） |
| `src/renderer/ui/themes/pearl-white.css` | 修改 | 变量名不动、值全换成派生结果（浅色＝奶油纸面 + 墨线 + 蓝强调） |
| `src/renderer/ui/themes/charcoal-pink.css` | 修改 | 同上（深色＝`BG_SOLID #101420` 面 + `FG`） |
| `src/renderer/ui/theme-palette-derivation.test.ts` | 新建 | **派生锁**：按真实层叠顺序解析后逐色断言 ∈ 板 ∪ `wash(板)` ∪ 有理由的白名单 |
| `assets/ui/cyrene-surface-pattern.svg` | 修改 | 工作区底纹的 `rgba(233,30,99,…)` 硬粉换成派生蓝 |
| `src/main/windows/create-aux-windows.ts` | 修改 | 原生窗底色改读派生值（CSS 管不到这几处） |
| `src/shared/color-roles.ts` | 新建 | 品牌色分类器 + 模块 CSS 色面扫描器（纯函数，脚本与测试共用一份判据） |
| `scripts/build/inventory-brand-colors.mjs` | 新建 | 普查 72 个模块 CSS，生成迁移表草案（110 种写法 / 394 处） |
| `scripts/build/color-migration.json` | 新建 | **人工裁决的品牌色表**：每条写法 → `token` 或 `keep + reason` |
| `scripts/build/apply-color-migration.mjs` | 新建 | 按表把品牌色写法替换成 `var(--rb-*)`，`--check` 报漂移 |
| `src/renderer/ui/brand-color-migration.test.ts` | 新建 | **品牌色锁**：残留清零 + 表内令牌三处定义齐全 + 反空转 |
| `src/renderer/ui/hardcoded-color-ratchet.test.ts` | 新建 | **字面量棘轮**：模块 CSS 带色行数只准减（含正对照防 glob 跑空） |
| `src/**/*.css`（43 个文件） | 修改 | 仅由 `apply-color-migration.mjs` 按表替换，不手改、不批正则 |
| `src/renderer/pet/art.ts` | 修改 | 扩成变体库：花色 5 × 姿态 12 × 取景 5（`full`/`bust`/`square`/`round`/`wide`），每个变体是纯函数 → `DrawOp[]` |
| `src/renderer/pet/cat-variants.ts` | 新建 | 姿态/取景表与 `buildSpriteOps`；与 `art.ts` 同住 renderer（R-D13：shared 不能反向依赖绘制树） |
| `src/renderer/pet/cat-sprite-manifest.ts` | 新建 | 198 条资产清单 + 像素尺判据；构建脚本的单一 esbuild 入口 |
| `src/shared/cat-types.ts` | 新建 | `Mood`/`PoseName`/`CropName` 三个无依赖联合类型，shared 侧消费者只认这里 |
| `src/shared/png-encode.ts` | 新建 | 最小 RGBA→PNG 编码器（`zlib` + CRC32），无浏览器无新依赖；落 `src/shared` 的理由见 Phase D 裁决 R-D6 |
| `scripts/build/cat-sprites.mjs` | 新建 | 构建期跑同一套 DrawOp，光栅化后写到应用已在看的确切路径 |
| `src/renderer/react/assets/characters/<猫名>/status-moods/*.png` 等 | 替换 | 72 张状态图（98 MB → ≈4 MB） |
| `src/renderer/public/stickers/` | 替换 | 52 张全换成猫，**52 个 id 一个不删**（id 已持久化进聊天记录/朋友圈），文件名统一 `<id>.png` |
| `src/renderer/live2d/**`、`public/models/cyrene/`、`assets/models/cyrene/`、`public/live2dcubismcore.min.js` | 删除 | P1 终审 PARK 的孤儿 I-2，本轨道关闭 |
| `src/main/tasks/task-character-pool.ts` | 修改 | 12 位猫伴：`nickname` 换猫名，称谓「黄金裔」→「猫伴」，函数名保留 |
| `src/main/moments/character-personas.ts` | 修改 | 语料人设字段平移，性格 1:1 不重新发明 |

---

## 阶段 A：断上游

A 期的判据分两层：**装配面**（通道/注册/消费方拿不到就是拿不到）与**静态标识面**（全仓不再出现上游标识）。
每条 A 期裁决落地时都往同一把锁 `src/main/egress/upstream-off.test.ts` 加一行规则——这把锁是本期的账本，
不是装饰：它带正对照（规则文件若扫不到任何文件、或某条规则连自己的正对照字符串都不匹配，直接红）。

### Task 1: 删公告子系统 + 立起「上游出口清零」锁

**Files:**
- Create: `src/main/egress/upstream-off.test.ts`
- Delete: `src/main/news/`（整目录，仅 `news-feed.ts` 一个文件）
- Delete: `src/shared/news-types.ts`
- Delete: `src/renderer/react/hooks/useNewsFeed.ts`
- Delete: `src/renderer/react/components/ui/NewsDialog.tsx`、`NewsDialog.css`
- Modify: `src/shared/ipc-channels.ts:580-583`（`NEWS_GET`/`NEWS_UPDATED` 与其注释行）
- Modify: `src/preload/index.ts:19`、`:213-230`（`newsApi` 与 `exposeInMainWorld("news", …)`）
- Modify: `src/renderer/global.d.ts:201`（`news?: …NewsApi`）
- Modify: `src/main/application/default-dependencies.ts:42`、`:775-777`
- Modify: `src/renderer/react/components/ui/UserAvatar.tsx`（去 news：`:2` 的 `Megaphone`、`:8`/`:15` 的 import、`:29-31` 两个 state、`:36` 钩子、`:98-102` 未读点、`:206-221` 两个菜单项、`:227-234` 弹窗）
- Modify: `src/renderer/react/i18n/zh-CN.json:2114`、`en.json:2114`、`ja-JP.json:2147`（删 `ui.news` 对象）

**Interfaces:**
- Produces: `src/main/egress/upstream-off.test.ts` 的 `RULES: Rule[]` 与 `sourceFiles()`——Task 2–5 各往里加一条规则，不再新建锁文件。

- [ ] **Step 1: 先写失败的锁**

新建 `src/main/egress/upstream-off.test.ts`：

```ts
/**
 * 「不接收上游任何东西」的可判定契约（spec §3-A）。
 *
 * 为什么不是 grep 一下就完事：这条锁是**常驻**的。删掉公告、字体、更新器之后，
 * 后续任何改动只要把上游域名重新引回 src/，这里当场红。A 期的静态判据全押在这一个文件里，
 * 运行时那把尺（Task 6 的 egress 看门狗）负责证明「没有间接路径」，两把尺不互相替代。
 *
 * 每条规则自带正对照（`positiveControl`）：规则写坏了（转义吃掉、大小写改了）
 * 会在正对照这一行红，而不是安静地扫 0 个命中然后报 PASS——spec §4 的「尺自己崩了不许读成 PASS」。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

/** 锁自身必须排除：它的正对照字符串就是被禁标识，不排除会自炸。 */
const SELF = "upstream-off.test.ts";
const SCAN_ROOTS = ["src", "scripts", "build", "packages"];
const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".mjs", ".css", ".html", ".json", ".yml", ".yaml", ".nsh"]);

interface Rule {
  clause: string;
  pattern: RegExp;
  /** 必须匹配的字面量：规则写坏了这里先红。 */
  positiveControl: string;
  /** 逐文件例外，必须写理由；例外是显式破例，不是放宽判据。 */
  exceptions: Array<{ file: string; reason: string }>;
}

const RULES: Rule[] = [
  {
    clause: "A1 公告",
    pattern: /cyrene-announcement|NEWS_GET|NEWS_UPDATED|useNewsFeed|news-feed/i,
    positiveControl: "https://gitee.com/playa0/cyrene-announcement/raw/main/",
    exceptions: [],
  },
];

function sourceFiles(root: string, out: string[] = []): string[] {
  for (const entry of readdirSync(root)) {
    const full = path.join(root, entry);
    if (entry === "node_modules" || entry === "dist" || entry === "release") continue;
    const stats = statSync(full);
    if (stats.isDirectory()) sourceFiles(full, out);
    else if (SCAN_EXTENSIONS.has(path.extname(full))) out.push(full);
  }
  return out;
}

function scannedFiles(): string[] {
  const roots = path.resolve(process.cwd());
  return SCAN_ROOTS.flatMap((root) => {
    const abs = path.join(roots, root);
    try {
      return statSync(abs).isDirectory() ? sourceFiles(abs) : [];
    } catch {
      return [];
    }
  });
}

describe("上游出口清零（静态标识面）", () => {
  const files = scannedFiles();

  it("扫描器真的在扫东西（空扫不许读成 PASS）", () => {
    expect(files.length).toBeGreaterThan(300);
  });

  for (const rule of RULES) {
    it(`${rule.clause}：全仓不出现上游标识`, () => {
      expect(rule.pattern.test(rule.positiveControl)).toBe(true);
      const hits: string[] = [];
      for (const file of files) {
        if (path.basename(file) === SELF) continue;
        const exempt = rule.exceptions.find((candidate) => file.endsWith(candidate.file));
        const text = readFileSync(file, "utf8");
        rule.pattern.lastIndex = 0;
        if (!rule.pattern.test(text)) continue;
        if (exempt) continue;
        hits.push(path.relative(process.cwd(), file));
      }
      expect(hits).toEqual([]);
    });
  }
});
```

- [ ] **Step 2: 跑锁，确认它因公告代码而红**

Run: `CI=true npx vitest run src/main/egress/upstream-off.test.ts`
Expected: FAIL——「A1 公告」那条列出 `src/main/news/news-feed.ts`、`src/preload/index.ts`、`src/shared/ipc-channels.ts`、`src/renderer/react/hooks/useNewsFeed.ts`、`src/renderer/react/components/ui/NewsDialog.tsx`、`src/renderer/react/components/ui/UserAvatar.tsx` 等命中文件（Step 1 的扫描器判定测试应已 PASS）。

- [ ] **Step 3: 拆装配面（通道 → 注册点 → 消费方，倒序一层层来）**

主进程侧：删 `src/main/news/` 整目录；`default-dependencies.ts` 删 `:42` 的
`import { registerNewsIpc } from "../news/news-feed";` 与 `:775-777`（含那条注释行）。
通道侧：`src/shared/ipc-channels.ts` 删 `NEWS_GET`/`NEWS_UPDATED` 两行及其上方注释。
预加载侧：`src/preload/index.ts` 删 `:19` 的 `NewsApi, NewsPayload` import、`:213-230` 的
`newsApi` 块与 `contextBridge.exposeInMainWorld("news", newsApi)`。
类型侧：`src/renderer/global.d.ts` 删 `:201` 的 `news?:` 行。
渲染侧：删 `useNewsFeed.ts`、`NewsDialog.tsx`、`NewsDialog.css`。

`UserAvatar.tsx` 的具体改动（去掉 news 之外一律不动，更新红点那条通道留着给 Task 3）：

```tsx
// :2 去掉 Megaphone（其余图标保持原序）
import { Bug, Check, ChevronRight, Globe, Languages, Package, Palette, UserRound } from "lucide-react";
// :8 与 :15 两行 import 整行删除（useNewsFeed / NewsDialog）
// :29-31 两个 state 删除：newsOpen / newsUnreadSnapshot（含 :30 的注释行）
// :35-36 「公告仓库只有中/英两份文件…」注释 + `const news = useNewsFeed(…)` 删除
// :98-102 未读点整块删除：{news.unreadCount > 0 && ( <span className="cy-user-avatar-dot" … /> )}
// :206-221 公告菜单项整块删除（DropdownMenu.Item … <Megaphone …/> …）
// :227-234 <NewsDialog … /> 整块删除
```

- [ ] **Step 4: 清文案**

`src/renderer/react/i18n/zh-CN.json`、`en.json`、`ja-JP.json` 各删 `ui` 下的整个 `"news": {…}` 对象
（zh/en 在 `:2114`，ja-JP 在 `:2147`）。三个文件同步删，`resources.test.ts` 的键对齐才不会被打破。

- [ ] **Step 5: 跑锁 + 相关单测 + 两个类型门**

Run:
```bash
CI=true npx vitest run src/main/egress/upstream-off.test.ts src/renderer/react/i18n/resources.test.ts
npx tsc -p tsconfig.main.json --noEmit
npx tsc -p tsconfig.preload.json --noEmit
npx tsc -p tsconfig.renderer.json
```
Expected: 锁的「A1 公告」转绿、扫描器判定绿、`resources.test.ts` 绿；三个 tsc 无输出。
若 `UserAvatar.tsx` 还残留 `news` 引用，tsc 会点名——按行删干净，不许留 `// removed`。

- [ ] **Step 6: 提交**

```bash
git add -A src docs/verge/plans
git commit -m "refactor(egress): 删除上游公告子系统并立起出口清零锁"
```
提交正文须写：这是纯删除（通道→注册→消费 三层各删了什么），以及
`upstream-off.test.ts` 为什么落在 `src/main/egress/` 而不是 `docs/`——它是常驻门禁，
必须跟着 `CI=true npx vitest run` 全量跑才有约束力。

### Task 2: 字体本地化 + CSP 撤掉字体域

**Files:**
- Modify: `src/renderer/ui/fonts.css`（整文件 2 行）
- Modify: `src/main/protocols/learn-exam-csp.ts:5,7`
- Modify: `src/main/protocols/learn-exam-csp.test.ts`（新增一条负判据 + 正对照）
- Modify: `src/main/egress/upstream-off.test.ts`（加 A2 规则）

**Interfaces:**
- Consumes: Task 1 的 `RULES`/`sourceFiles`。
- Produces: 无新接口；`buildLearnExamCsp(isDev)` 的返回串从此不含 `https://`。

- [ ] **Step 1: 加失败的锁**

`upstream-off.test.ts` 的 `RULES` 追加：

```ts
  {
    clause: "A2 字体远端",
    pattern: /fonts\.googleapis\.com|fonts\.gstatic\.com/i,
    positiveControl: '@import url("https://fonts.googleapis.com/css2?family=JetBrains+Mono");',
    exceptions: [],
  },
```

Run: `CI=true npx vitest run src/main/egress/upstream-off.test.ts`
Expected: FAIL——命中 `src/renderer/ui/fonts.css`、`src/main/protocols/learn-exam-csp.ts`、`src/main/protocols/learn-exam-csp.test.ts`（若该测试现有断言里带域名字面量）。

- [ ] **Step 2: 改字体入口**

`src/renderer/ui/fonts.css` 整文件改为（`tokens.css:104-110` 的字体栈已经以 `sans-serif`/`monospace` 收尾，
所以这里**不需要**引入任何位图字体文件；中文 webfont 体积不可接受，spec §3-A2）：

```css
/* UI 用系统字体栈；等宽字族交给 tokens.css 的 --rb-font-mono 候选列表挑本机已有的。
   这里曾经 @import 过 Google Fonts 的 JetBrains Mono——那是默认启动就会发的一条外网请求，
   个人化后不引外部资源，宁可退化到系统 mono（Consolas/Cascadia Mono）。 */
```

- [ ] **Step 3: 改 CSP**

`src/main/protocols/learn-exam-csp.ts` 的两行改为：

```ts
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
```

（只删 `https://fonts.googleapis.com` 与 `https://fonts.gstatic.com`，`'unsafe-inline'` 与
`data:` 原样留着——本期不顺手收紧与本裁决无关的口径。）

- [ ] **Step 4: 给 CSP 补负判据（含正对照）**

在 `src/main/protocols/learn-exam-csp.test.ts` 追加：

```ts
  it("CSP 不放行任何外部域（个人化后连字体也本地）", () => {
    for (const csp of [buildLearnExamCsp(false), buildLearnExamCsp(true)]) {
      // 正对照：dev 档自己就有 http://localhost:5173，说明「含://」这条判据不是永远 false
      expect(csp).toContain("://");
      const origins = [...csp.matchAll(/https?:\/\/([^\s;'"]+)/g)].map((m) => m[1]);
      expect(origins).toEqual(["localhost:5173"]);
    }
  });
```

Run（prod 档 `connect-src` 不含 localhost 时 `origins` 为空数组，上面这条只对 dev 档成立）——
**若 prod 档为空数组导致 `toEqual(["localhost:5173"])` 红，改成按档断言**：

```ts
    expect([...buildLearnExamCsp(false).matchAll(/https?:\/\/([^\s;'"]+)/g)]).toEqual([]);
    expect([...buildLearnExamCsp(true).matchAll(/https?:\/\/([^\s;'"]+)/g)].map((m) => m[1]))
      .toEqual(["localhost:5173", "localhost:5173"]);
```

以实际跑出来的结果为准选一种写法，并在提交正文里记下实测值——不许凭推测留下没跑过的断言。

- [ ] **Step 5: 跑门**

Run:
```bash
CI=true npx vitest run src/main/egress/upstream-off.test.ts src/main/protocols
npx tsc -p tsconfig.main.json --noEmit
```
Expected: 全绿。`src/renderer/ui/` 无类型消费方，`check:renderer` 不受影响。

- [ ] **Step 6: 提交**

`git commit -m "refactor(egress): 字体改系统栈并从 CSP 撤掉字体域名"`。
正文写：9 个 HTML 入口都引 `fonts.css`（实测），所以这一处改完，开机自动请求只剩公告一条（已由 Task 1 删除）。

### Task 3: 更新面装配清零 + 版本信息改本机构建

**Files:**
- Delete: `src/main/updater/github-app-updater.ts`
- Delete: `src/main/updater/app-update-ipc.ts`、`app-update-ipc.test.ts`
- Delete: `src/main/updater/app-update-service.ts`、`app-update-service.test.ts`
- Delete: `src/main/updater/update-policy.ts`、`update-policy.test.ts`
- Delete: `src/shared/app-update.ts`
- Modify: `src/shared/ipc-channels.ts:45-50`
- Modify: `src/preload/index.ts:62-71`、`:125`（及 `AppUpdateApi` import 行）
- Modify: `src/renderer/global.d.ts:205`
- Modify: `src/main/application/background.ts:42`（接口里删 `scheduleUpdateCheck`）
- Modify: `src/main/application/background.ts:269` 附近（删调用）
- Modify: `src/main/application/default-dependencies.ts:1026-1035`（删 `scheduleUpdateCheck` 实现）
- Modify: `src/main/application/electron-lifecycle.ts:63`（删兜底调用）
- Modify: `src/main/application/background.test.ts:41`（删 mock 项）
- Modify: `electron-builder.yml:3-6`（删 `publish` 块）
- Modify: `src/main/updater/update-packaging-config.test.ts`（整文件反转为「publish 必须不存在」）
- Modify: `scripts/verify/installer-artifacts.mjs:1-8,51-69`
- Modify: `package.json`（删 `electron-updater` 依赖，见 Step 6 的授权提示）
- Delete: `src/renderer/react/hooks/useAppUpdate.ts`
- Modify: `src/renderer/react/features/settings/app-update-view.ts`（整文件重写为版本信息）
- Modify: `src/renderer/react/features/settings/app-update-view.test.ts`
- Modify: `src/renderer/react/components/ui/UserAvatar.tsx`（`:7,13,40-44`、`:104-106`、`:186-197`）
- Modify: `src/renderer/react/features/settings/GeneralSettingsPanel.tsx:9,10,46,102-109`
- Modify: `src/main/egress/upstream-off.test.ts`（加 A3 规则）
- Create: `src/main/verge/app-info-ipc.ts`
- Test: `src/main/verge/app-info-ipc.test.ts`

**Interfaces:**
- Produces:
  - `IPC.VERGE_GET_APP_INFO: "verge:get-app-info"`（handle，返回 `AppInfo`）
  - `interface AppInfo { name: string; nameZh: string; version: string; buildChannel: "local"; dataDirName: string; }`（`src/shared/app-info.ts`，新建）
  - `resolveVersionTitleKey(version: string): string | null`（从 `app-update-view.ts` 原样保留——它跟更新无关，只读版本号）
- Consumes: Task 8 才有 `brand.ts`，本任务先用 `app.getName()` / `app.getVersion()`，Task 10 换成 brand（已在 Step 1 说明为什么不算返工）。

- [ ] **Step 1: 先立「装配面拿不到更新通道」的锁**

新建 `src/main/verge/app-info-ipc.ts`，写失败测试 `src/main/verge/app-info-ipc.test.ts`：

```ts
import { describe, expect, it, vi } from "vitest";
import { IPC } from "../../shared/ipc-channels";
import { registerAppInfoIpc } from "./app-info-ipc";

function buildScope() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    handlers,
    ipc: {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler);
      }),
      removeHandler: vi.fn((channel: string) => handlers.delete(channel)),
    },
  };
}

describe("本机版本信息 IPC", () => {
  it("只登记 get-app-info 一条通道，且回执标成本机构建", () => {
    const scope = buildScope();
    const dispose = registerAppInfoIpc(scope.ipc as never, {
      getName: () => "Mochi",
      getVersion: () => "1.3.3",
      dataDirName: "Mochi",
    });
    expect([...scope.handlers.keys()]).toEqual([IPC.VERGE_GET_APP_INFO]);
    expect(scope.handlers.get(IPC.VERGE_GET_APP_INFO)!()).toEqual({
      name: "Mochi", nameZh: "麻糬", version: "1.3.3", buildChannel: "local", dataDirName: "Mochi",
    });
    dispose();
    expect(scope.handlers.size).toBe(0);
  });
});
```

实现 `src/main/verge/app-info-ipc.ts`：

```ts
import { IPC } from "../../shared/ipc-channels";
import { PRODUCT_NAME_ZH } from "../../shared/brand";
import type { AppInfo } from "../../shared/app-info";
import type { IpcScope } from "../application/ipc-scope";

/**
 * 本机版本信息：设置页与 `--brand-probe` 共用的唯一读端。
 *
 * 它顶替的是原来那组 `app-update:*` 通道。`buildChannel` 恒为 `"local"` 不是占位——
 * 本 fork 没有任何升级来源，界面上要敢把这句话讲出来，而不是留一个空状态让人猜。
 * brand 常量在这里就进来了：Task 8 之后换名只改 `shared/brand.ts` 一处。
 */
export function registerAppInfoIpc(
  ipc: IpcScope,
  source: { getName(): string; getVersion(): string; dataDirName: string },
): () => void {
  const read = (): AppInfo => ({
    name: source.getName(),
    nameZh: PRODUCT_NAME_ZH,
    version: source.getVersion(),
    buildChannel: "local",
    dataDirName: source.dataDirName(),
  });
  ipc.handle(IPC.VERGE_GET_APP_INFO, () => read());
  return () => ipc.removeHandler(IPC.VERGE_GET_APP_INFO);
}
```

> 这一步的 `shared/brand` import 会红（Task 8 才建）。**裁决：Task 8 提前到本任务之内完成最小版**——
> 建 `src/shared/brand.ts` 时一次到位（见 Task 8 的完整文件），Task 8 只做 sync-brand 生成器与一致性测试。
> 这不是返工：更新面是 brand 的第二个消费者，先有消费者才有「名字只在一处」的证据。

新建 `src/shared/app-info.ts`：

```ts
export interface AppInfo {
  name: string;
  nameZh: string;
  version: string;
  /** 本 fork 唯一的版本来源就是本机自己，界面上照实说。 */
  buildChannel: "local";
  dataDirName: string;
}
```

- [ ] **Step 2: 加失败的锁（更新面三条一起）**

`RULES` 追加：

```ts
  {
    clause: "A3 更新面",
    pattern: /electron-updater|APP_UPDATE_CHECK|autoUpdater|github-app-updater|scheduleStartupUpdateCheck/i,
    positiveControl: 'import { autoUpdater } from "electron-updater";',
    exceptions: [
      { file: "scripts/verify/installer-artifacts.mjs", reason: "保留的是「latest.yml 不得出现」的反向锁，正文里必须写出这个文件名才能证明锁在生效" },
    ],
  },
  {
    clause: "A3 上游发布源",
    pattern: /provider:\s*github|owner:\s*Playa-Cyrene|repo:\s*Cyrene-Agent/i,
    positiveControl: "provider: github",
    exceptions: [],
  },
```

Run: `CI=true npx vitest run src/main/egress/upstream-off.test.ts src/main/verge/app-info-ipc.test.ts`
Expected: 两条 A3 红（命中 `src/main/updater/*`、`electron-builder.yml`、`src/preload/index.ts`、`src/shared/ipc-channels.ts`、`src/main/application/default-dependencies.ts`）；`app-info-ipc.test.ts` 红在 brand 尚未存在。

- [ ] **Step 3: 建 `src/shared/brand.ts`（一次到位版）**

```ts
/**
 * 唯一身份来源（spec §1 改名只动一处的兑现）。
 *
 * ⚠️ `DATA_DIR_NAME` 与 `APP_ID` 是**已落盘数据**的键：改它们等于换 userData 目录，
 * 必须先跑 Task 9 的迁移与 `settings-store` 的密钥解耦（Task 7），否则频道 secret 的
 * XOR 种子会跟着静默轮换——错钥匙不是报错，是解出乱码并被当成正确值用。
 */
export const PRODUCT_NAME = "Mochi";
/** 中文显示名：猫身 token `PAPER #f7f4ec` 就是那团奶油色，产品叫「麻糬」。 */
export const PRODUCT_NAME_ZH = "麻糬";
export const APP_ID = "dev.damin.mochi";
/** userData 目录名；与 Windows 开始菜单/添加删除列表里的名字同源。 */
export const DATA_DIR_NAME = "Mochi";
/** 日志前缀（`logger-tags.ts` 用）。 */
export const LOG_PREFIX = "Mochi";
/** 窗口标题后缀。 */
export const TITLE_SUFFIX = "Mochi";
/** 装机产物名与 appId 的成对身份，sync-brand.mjs 与一致性测试都读这一份。 */
export const BRAND = {
  productName: PRODUCT_NAME,
  productNameZh: PRODUCT_NAME_ZH,
  appId: APP_ID,
  dataDirName: DATA_DIR_NAME,
  logPrefix: LOG_PREFIX,
  titleSuffix: TITLE_SUFFIX,
} as const;
```

- [ ] **Step 4: 拆更新装配面**

- `src/shared/ipc-channels.ts`：删 `:44-50`（`// GitHub 应用更新` 注释 + 五条通道）。
- `src/preload/index.ts`：删 `:62-71` 的 `appUpdateApi`、`:125` 的 `exposeInMainWorld("appUpdate", …)` 与 `AppUpdateApi`/`AppUpdateState` import。
- `src/renderer/global.d.ts`：删 `:205` `appUpdate?: AppUpdateApi;` 与 `:4` 的 import。
- `src/main/updater/`：整目录删除（5 个实现 + 4 个测试）。留 `src/main/updater/README.md` **不写**——目录直接没了才是判据。
- `src/main/application/background.ts`：接口删 `scheduleUpdateCheck` 行（`:42`），执行队列里删它的调用（`:269` 附近）。
- `src/main/application/default-dependencies.ts`：删 `:1026-1035` 整个 `scheduleUpdateCheck` 实现与 `update-policy`/`github-app-updater` import。
- `src/main/application/electron-lifecycle.ts:63`：删兜底调用。
- `src/main/application/background.test.ts:41`：删 mock 项。
- `electron-builder.yml`：删 `:3-6` `publish` 块。
- `src/shared/app-update.ts`：删（`AppUpdateState`/`AppUpdateApi` 的出处）。
- `src/renderer/react/hooks/useAppUpdate.ts`：删。

在 `default-dependencies.ts` 里登记新通道（同一 `ipc` scope，紧接原 `registerNewsIpc` 的位置）：

```ts
        // 本机版本信息：设置页与 --brand-probe 共用。原来这里是 app-update:* 四条通道。
        const removeAppInfoIpc = registerAppInfoIpc(ipc, {
          getName: () => app.getName(),
          getVersion: () => app.getVersion(),
          dataDirName: () => path.basename(app.getPath("userData")),
        });
```

并把 `removeAppInfoIpc` 串进现有的 dispose 链（与 `removeVergeIpc` 同一处）。

- [ ] **Step 5: 设置页与头像菜单改文案**

`src/renderer/react/features/settings/app-update-view.ts` 整文件重写为：

```ts
import { isNewerVersion } from "../../../../shared/version";
import type { AppInfo } from "../../../../shared/app-info";

/**
 * 版本信息视图：本 fork 没有升级来源，界面上只有「当前版本 + 数据目录」，没有按钮。
 *
 * 原来这个文件是「更新状态 → 界面」的映射（8 个 phase × 动作 × 红点）。
 * 删掉它不是删 UI，是**删掉「会有新版本」这个承诺**——留着一个永不亮的红点和
 * 一个点了只会报 check_failed 的按钮，比没有更误导。
 */
export interface AppInfoView {
  /** 版本行文案，如 `v1.3.3 · 正式版` */
  versionLabel: string;
  /** 升级说明文案 key（i18n：本机构建，不联网检查） */
  noteKey: string;
}

const STABLE_SINCE = "1.3.0";

/** 查版本称号：达到正式版起点返回文案 key，否则 null 只显示 v 号。 */
export function resolveVersionTitleKey(version: string): string | null {
  const trimmed = version.trim();
  return trimmed === STABLE_SINCE || isNewerVersion(trimmed, STABLE_SINCE) ? "ui.version.firstStable" : null;
}

export function resolveAppInfoView(info: AppInfo): AppInfoView {
  const titleKey = resolveVersionTitleKey(info.version);
  return {
    versionLabel: `v${info.version}${titleKey ? ` · ${info.version}` : ""}`,
    noteKey: "appUpdate.localBuild",
  };
}
```

> `versionLabel` 里的称号要走 `t()`，组件层自己翻译；本函数只给 `v<版本>` 与是否有称号。
> 实现时按 `UserAvatar.tsx:44` 现有用法保留 `resolveVersionTitleKey`，**不要**把 i18n key 拼进字符串
> （原来 `resolveAppUpdateView` 只产出 key 的规矩留着）。
> `WEBSITE_URL` 整条删除（`:74-75`）——它是 Task 4 的判据之一，这里先断掉更新面的引用。

`UserAvatar.tsx`：删 `:7` `useAppUpdate` import、`:13` 的 `resolveAppUpdateView, WEBSITE_URL` import
（`resolveVersionTitleKey` 留着）、`:40-41` 两行、`:104-106` 更新红点、`:196` 菜单项里的 `updateView.badge` 点。
版本行改为消费 `window.verge.getAppInfo()`（Task 3 在 preload 里加一条 `VERGE_GET_APP_INFO` invoke，
形状照 `src/preload/verge.ts` 现有 `getSnapshot` 的写法）。
`GeneralSettingsPanel.tsx:102-109` 的「软件更新」整块换成三行只读信息：版本 / 构建方式（本机构建，不联网）/ 数据目录。
`i18n` 三个 json：删 `appUpdate.*` 的 8 个 phase 文案，加 `appUpdate.localBuild` 一条（中英日各一份）。

- [ ] **Step 6: 拆依赖与产物验证**

- `package.json`：从 `dependencies` 删 `electron-updater`；**先确认** `node_modules/electron-updater` 不是别的包的同名残留：
  `npm ls electron-updater` 应只有一条 root 依赖。删依赖属于「降级/移除」动作——执行时在本任务提交正文里记
  「spec §3-A3 裁决：更新器变死代码后它没有消费者」，并按用户「不要问我，一步到位」的授权进行；
  随后跑一次全量 `CI=true npx vitest run` 确认没有测试在 mock 它。
- `scripts/verify/installer-artifacts.mjs`：把 `:51-69` 的 latest.yml/blockmap **正向要求**反转成
  **不得存在**，并把头注释（`:1-8`）的第 2、3 条同步改写：

```js
  // 2. 升级元数据不得存在：本 fork 没有更新来源，latest.yml 一旦出现就说明
  //    publish 块或 electron-updater 被引回来了（Task 3 的反向锁）。
  for (const forbidden of ["latest.yml", `${artifactName}.blockmap`]) {
    const p = path.join(outputDir, forbidden);
    try {
      await stat(p);
      throw new Error(`不应存在的升级元数据：${p}`);
    } catch (err) {
      if (err && err.code !== "ENOENT") throw err;
    }
  }
```

- `src/main/updater/update-packaging-config.test.ts` → 移到 `src/main/egress/no-publish-config.test.ts`
  （目录跟着判据走，更新器目录已删），内容反转：

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

describe("打包配置不携带升级源", () => {
  it("electron-builder.yml 没有 publish 块", () => {
    const config = load(readFileSync(resolve(process.cwd(), "electron-builder.yml"), "utf8")) as {
      publish?: unknown;
    };
    // 正对照：js-yaml 能读出同一文件的其他键，证明解析器没坏、不是「读不到所以 undefined」
    expect(config.nsis).toBeTruthy();
    expect(config.publish).toBeUndefined();
  });
});
```

- [ ] **Step 7: 跑门**

```bash
CI=true npx vitest run src/main/egress src/main/verge src/main/application src/renderer/react/features/settings
npx tsc -p tsconfig.main.json --noEmit
npx tsc -p tsconfig.preload.json --noEmit
npx tsc -p tsconfig.renderer.json
node scripts/verify/installer-artifacts.mjs 2>&1 | head -3
```
Expected: 前四条全绿。最后一条预期是「安装器不存在」类错误（本机没有 `release/` 产物）而不是断言逻辑错——
在提交正文里记下实测到的那句。

- [ ] **Step 8: 提交**

`git commit -m "refactor(updater): 删除 GitHub 更新装配面，设置页改为本机构建版本信息"`。
正文必含：删掉的通道清单、`publish` 块去向、`latest.yml` 反向锁、`electron-updater` 依赖移除的理由，
以及「更新 IPC 面不存在」这条判据由 `upstream-off.test.ts` 的 A3 两条规则 + `no-publish-config.test.ts` 共同承担。

### Task 4: 品牌外链清零（官网 / Issue / 免责 / CLI banner / skills / SDK / .github）

**Files:**
- Delete: `src/renderer/react/components/ui/IssueReportDialog.tsx`、`IssueReportDialog.css`
- Delete: `.github/`（整目录：`ISSUE_TEMPLATE/*`、workflows 里指向上游的字段见 Step 5）
- Modify: `src/renderer/react/components/ui/UserAvatar.tsx`（`:2` 的 `Bug`、`:14` import、`:28` state、`:181-184` 菜单项、`:226` 弹窗）
- Modify: `src/renderer/react/i18n/{zh-CN,en,ja-JP}.json`（删 `ui.reportIssue` 对象；官网条目见 Step 3）
- Modify: `src/renderer/react/features/settings/app-update-view.ts`（`WEBSITE_URL` 已在 Task 3 删；本步删消费方）
- Modify: `src/renderer/react/features/settings/GeneralSettingsPanel.tsx:154`
- Modify: `src/renderer/react/features/settings/DisclaimerSettingsPanel.tsx:92-147`
- Modify: `src/cli/banner/text.ts:5,12`、`src/cli/banner/render.test.ts:60-64`、`src/cli/app.test.ts:56`
- Modify: `src/main/verge/handlers.ts:60`
- Modify: `skills/cyrene-plugin-dev/SKILL.md:124`、`skills/cyrene-plugin-dev/getting-started.md:59`
- Modify: `packages/plugin-sdk/package.json:8`
- Modify: `README.md`、`README.zh-CN.md`（如有上游链接）
- Modify: `src/main/windows/external-link.ts:15-19`（新增上游域名拒绝）
- Test: `src/main/windows/external-link.test.ts`（新建）
- Modify: `src/main/egress/upstream-off.test.ts`（加 A4 规则）

**Interfaces:**
- Consumes: Task 1 的 `RULES`。
- Produces: `exportBlockedHosts`（`src/shared/upstream-hosts.ts`，新建）——`external-link.ts` 与 `upstream-off.test.ts` 共用同一份域名表。

- [ ] **Step 1: 定域名表（一把表，两处消费）**

新建 `src/shared/upstream-hosts.ts`：

```ts
/**
 * 上游域名黑名单。与 `src/main/egress/upstream-off.test.ts` 的静态锁同源：
 * 静态锁管「代码里不出现这些字符串」，这张表管「运行时用户点到也拦得住」。
 * 两条判据都不放行 `playaagentcyrene.online` —— 那是上游官网，不是用户的。
 */
export const UPSTREAM_HOSTS = [
  "github.com",
  "raw.githubusercontent.com",
  "gitee.com",
  "playaagentcyrene.online",
] as const;

/** 命中上游仓库/官网的精确前缀；github.com 只拦上游仓与用户明确要断的 release/raw 路径。 */
export const UPSTREAM_URL_PREFIXES = [
  "https://github.com/Playa-Cyrene/",
  "https://github.com/Playa-0v0/",
  "https://raw.githubusercontent.com/Playa-0v0/",
  "https://gitee.com/playa0/",
  "https://playaagentcyrene.online",
] as const;

export function isUpstreamUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (UPSTREAM_URL_PREFIXES.some((prefix) => raw.startsWith(prefix))) return true;
  return (UPSTREAM_HOSTS as readonly string[]).includes(url.hostname);
}
```

> `github.com`/`gitee.com` 整域拦会连带拦掉用户自己贴的技术链接。
> **裁决：默认整域拦**（spec 的判据是「不再接收原来官网、GitHub 升级」，且这些链接在本 fork 里
> 只可能来自上游品牌语境）；例外走 `UPSTREAM_URL_PREFIXES` 之外的显式放行不做，
> 若日后要放行某个仓库，改这张表并加测试，而不是放宽判据。

- [ ] **Step 2: 加失败的锁**

```ts
  {
    clause: "A4 上游品牌链接",
    pattern: /Playa-Cyrene|Playa-0v0|playa0|playaagentcyrene\.online|ky2569ly@gmail\.com/i,
    positiveControl: "https://github.com/Playa-Cyrene/Cyrene-Agent/issues",
    exceptions: [
      { file: "src/shared/upstream-hosts.ts", reason: "黑名单本身必须写出被禁域名才拦得住" },
    ],
  },
```

Run: `CI=true npx vitest run src/main/egress/upstream-off.test.ts`
Expected: FAIL，命中 `IssueReportDialog.tsx`、`plugin-marketplace.ts`、`DisclaimerSettingsPanel.tsx`、
`news-feed.ts`（已删）、`skills/*`、`packages/plugin-sdk/package.json`、`.github/*`（`.github` 不在
`SCAN_ROOTS` 里——**本任务把 `.github` 加进 `SCAN_ROOTS`**，否则判据面漏了模板目录）。

- [ ] **Step 3: 删 Issue 上报与官网入口**

- 删 `IssueReportDialog.tsx` / `.css`；`UserAvatar.tsx` 删 `:2` 的 `Bug`、`:14` import、`:28` `reportOpen`、
  `:181-184` 菜单项、`:226` 挂载。
- `UserAvatar.tsx` 删 `:198-205` 官网菜单项（含 `Globe` import 与 `:13` 的 `WEBSITE_URL`）。
- `GeneralSettingsPanel.tsx:154` 的官网行删除（同文件里 `openExternal` 的调用一并删；若该函数只剩这一处用，函数也删）。
- i18n 三个 json：删 `ui` 下整个 `"reportIssue": {…}` 与 `ui.website.*`、`ui.news.*`（Task 1 已删 news）键。
  删完跑 `resources.test.ts` 确认三语键数对齐。

- [ ] **Step 4: 免责声明与 CLI banner 改本地文案**

`DisclaimerSettingsPanel.tsx:92-147` 的 `<a href>` 上游链接全部改为纯文本（保留条款内容，去掉「查看原文/仓库」类外链）。
`src/cli/banner/text.ts` 的标题与主页行改为 brand 驱动：

```ts
// :5 产品名与 :12 主页行。原来这两行写死 Cyrene / 上游官网。
import { PRODUCT_NAME, PRODUCT_NAME_ZH } from "../../shared/brand";
export const BANNER_TITLE = `${PRODUCT_NAME}（${PRODUCT_NAME_ZH}）`;
export const BANNER_TAGLINE = "本机构建 · 不联网检查升级";
```

`src/cli/banner/render.test.ts:60-64` 与 `src/cli/app.test.ts:56` 的字面量按新值改（**改测试期望值，不改断言形态**）。
`src/main/verge/handlers.ts:60`、`skills/cyrene-plugin-dev/SKILL.md:124`、
`skills/cyrene-plugin-dev/geting-started.md`（真实文件名 `getting-started.md`）`:59`、
`packages/plugin-sdk/package.json:8`（`repository`/`homepage` 字段）：删除上游地址或改为 `"private": true` +
本地说明。`skills/*.md` 属文档但落在 `SCAN_ROOTS` 内，一并清。
`.github/` 整目录删除（Issue 模板与指向上游的 workflow 字段都在里面）。

- [ ] **Step 5: 运行时拦截（`external-link.ts` 只有协议闸门，没有域名闸门）**

实测：`src/main/windows/external-link.ts:15-19` 只校验协议（http/https/mailto），**没有域名白名单**。
补上：

```ts
import { isUpstreamUrl } from "../../shared/upstream-hosts";

// 现有协议校验之后、shell.openExternal 之前插入：
  if (isUpstreamUrl(url)) {
    return { ok: false, error: "blocked-upstream-host" };
  }
```

新建 `src/main/windows/external-link.test.ts`（负判据配正对照）：

```ts
import { describe, expect, it } from "vitest";
import { isUpstreamUrl } from "../../shared/upstream-hosts";

describe("上游链接拦截", () => {
  it("拦上游、放用户自己的域名（正对照防空判据）", () => {
    expect(isUpstreamUrl("https://github.com/Playa-Cyrene/Cyrene-Agent/issues")).toBe(true);
    expect(isUpstreamUrl("https://gitee.com/playa0/cyrene-plugins/raw/main/registry.json")).toBe(true);
    expect(isUpstreamUrl("https://playaagentcyrene.online/")).toBe(true);
    // 正对照：非上游域名必须放行，否则整条外链通道被关死也算「判据通过」
    expect(isUpstreamUrl("https://api.anthropic.com/v1/messages")).toBe(false);
    expect(isUpstreamUrl("https://www.deepseek.com/")).toBe(false);
    expect(isUpstreamUrl("mailto:someone@example.com")).toBe(false);
    expect(isUpstreamUrl("not a url")).toBe(false);
  });
});
```

- [ ] **Step 6: 跑门 + 提交**

```bash
CI=true npx vitest run src/main/egress src/main/windows/external-link.test.ts src/renderer/react/i18n src/cli
npx tsc -p tsconfig.main.json --noEmit && npx tsc -p tsconfig.renderer.json
```
Expected: 全绿；`upstream-off.test.ts` 的 A4 规则转绿。

`git commit -m "refactor(brand): 清零上游官网与 Issue 入口并补上运行时候域名拦截"`。
正文写：`external-link.ts` 原来**只有协议闸门**（实测纠正 spec §2.3 的「白名单」措辞），
本次是新增域名拦截而不是收窄既有白名单；以及 `.github` 已加入静态扫描根。

### Task 5: 插件市场改本地目录

**Files:**
- Modify: `src/main/plugin-marketplace.ts`（删远端分支，只留本地枚举）
- Modify: `src/main/plugin-runtime.ts:157-166`
- Modify: `src/shared/ipc-channels.ts:576-578`
- Modify: `src/preload/index.ts:551-553`
- Modify: `src/renderer/react/features/settings/PluginModePanel.tsx`（`:25,29,137-158,159,177,187,214,238-239,338,432,501`）
- Delete: `src/renderer/react/features/settings/PluginMarketPreview.tsx`
- Modify: `src/main/plugin-marketplace.test.ts`（18 例中远端用例整体替换为本地用例）
- Modify: `src/renderer/react/features/settings/PluginModePanel.test.ts:317-350`
- Modify: `src/main/egress/upstream-off.test.ts`（加 A5 规则）

**Interfaces:**
- Consumes: `src/plugins/loader.ts:105 inspectPluginDir`、`:17 MANIFEST_FILE = "manifest.json"`、
  `src/main/plugin-runtime.ts:52`（本地 plugins 根）。
- Produces: `listLocalMarketPlugins(pluginsDir: string): Promise<MarketPluginEntry[]>`
  （留在 `src/main/plugin-marketplace.ts`，通道名沿用 `PLUGIN_MARKET_LIST`，语义从「远端索引」改成「本地可装清单」）。

- [ ] **Step 1: 加失败的锁**

```ts
  {
    clause: "A5 插件市场远端源",
    pattern: /Cyrene-Plugins|MARKET_REGISTRY_URLS|MARKET_ZIP_URL_PREFIXES|registry\.json/i,
    positiveControl: "https://raw.githubusercontent.com/Playa-0v0/Cyrene-Plugins/main/registry.json",
    exceptions: [],
  },
```

- [ ] **Step 2: 换成本地枚举**

`src/main/plugin-marketplace.ts` 删 `:18-27` 两组 URL 常量、`:29-32` 超时/体积上限、
`MarketSnapshotEntry`、fetch/zip 下载/哈希校验全套（`:42-185` 的远端路径）。
保留并复用本地能力——`createPluginMarketplaceService` 收敛成一个目录读取：

```ts
import { readdirSync } from "node:fs";
import path from "node:path";
import { MANIFEST_FILE, inspectPluginDir } from "../plugins/loader";
import type { MarketListResult, MarketPluginEntry } from "../shared/plugin-management";

/**
 * 本地插件目录就是本 fork 唯一的「市场」。
 *
 * 原来这里读两份远端 registry.json（GitHub raw + Gitee 镜像）再按 zip 前缀白名单下载，
 * 是开机之后用户一点就发的最大一条外网路径。个人化后不引外部索引：
 * `userData/plugins` 里有什么就列什么，「安装」退化成「放进这个目录再刷新」。
 * 用户自备的 zip 导入通道（plugins/manager）不受影响——那是本地动作。
 */
export async function listLocalMarketPlugins(pluginsDir: string): Promise<MarketListResult> {
  const items: MarketPluginEntry[] = [];
  let entries: string[] = [];
  try {
    entries = readdirSync(pluginsDir);
  } catch {
    return { ok: true, items: [], source: "local" };
  }
  for (const entry of entries) {
    const dir = path.join(pluginsDir, entry);
    const inspected = await inspectPluginDir(dir);
    if (!inspected.ok) continue;
    items.push({
      id: inspected.manifest.id,
      name: inspected.manifest.name ?? inspected.manifest.id,
      version: inspected.manifest.version,
      description: inspected.manifest.description ?? "",
      origin: "local",
      installed: true,
    });
  }
  return { ok: true, items, source: "local" };
}
```

> 上面 `MarketPluginEntry` 的字段与 `inspectPluginDir` 的返回形状**以实测为准**：
> 本任务第一步之前先 `Read` `src/shared/plugin-management.ts` 与 `src/plugins/loader.ts:100-200`，
> 按真实字段名调整（缺 `origin`/`installed` 这类字段就删掉对应行，**不要**为了迁就旧形状保留远端语义）。
> 判据不看形状漂不漂亮，看：`MARKET_REGISTRY_URLS` 不再存在 + 面板拿到的条目全部来自磁盘。

- [ ] **Step 3: 通道与 UI 同步降档**

`ipc-channels.ts:576-578` 只留 `PLUGIN_MARKET_LIST`，删 `PLUGIN_MARKET_INSTALL`/`PLUGIN_MARKET_DETAILS`
（对应 `plugin-runtime.ts:157-166` 三个 handler 只留 list；preload `:551-553` 同步）。
`PluginModePanel.tsx`：删市场源的「实时探测各源死活 / 手动切换指定源」UI（`:137-158`）、
下载/安装按钮（`:238-239`、`:501`）、假预览入口（`:338`、`:432`）；
列表标题改为「本地插件目录」，并在面板里给出目录路径（来自 `plugin-runtime.ts:52`），
因为用户现在的安装动作就是往那个目录放文件。
`PluginMarketPreview.tsx` 整文件删除（它的预览 URL 是假的，spec §3-A5）。

- [ ] **Step 4: 测试改判据**

`src/main/plugin-marketplace.test.ts`：删掉所有 `fetchImpl` 注入的远端用例（约 14 例），
换成 4 例本地用例——目录不存在返回空、非插件目录被跳过、manifest 缺字段被跳过、
一个真插件目录被列出。夹具用 `vi.mock("../plugins/loader")` 造 `inspectPluginDir` 回执，
不碰真实 userData。
`PluginModePanel.test.ts:317-350` 的市场源断言改为「渲染出的条目等于 props 给的本地条目」。

- [ ] **Step 5: 跑门 + 提交**

```bash
CI=true npx vitest run src/main/plugin-marketplace.test.ts src/main/plugin-runtime src/renderer/react/features/settings/PluginModePanel.test.ts src/main/egress
npx tsc -p tsconfig.main.json --noEmit && npx tsc -p tsconfig.preload.json --noEmit && npx tsc -p tsconfig.renderer.json
```

`git commit -m "refactor(plugins): 插件市场远端索引改为本地目录枚举"`。
正文写：删掉的两个 registry 与 zip 前缀白名单去向、`MarketPluginEntry` 字段的实测调整、
以及用户自备 zip 导入通道未被触碰。

### Task 6: 出口看门狗与 `--egress-probe`（A 期唯一的真窗尺）

**Files:**
- Create: `src/main/egress/egress-watchdog.ts`
- Create: `src/main/egress/egress-watchdog.test.ts`
- Create: `src/main/egress/egress-probe.ts`
- Modify: `src/main/index.ts:40` 附近（ready 后安装）
- Modify: `src/main/egress/upstream-off.test.ts`（加一条「看门狗不许被关掉」的自锁）

**Interfaces:**
- Consumes: `session.defaultSession.webRequest`（Electron 44）。
- Produces:
  - `classifyRequest(url: string): "local" | "external"`（纯函数，单测尺）
  - `installEgressWatchdog(session?: Session): { entries(): EgressEntry[]; dispose(): void }`
  - `runEgressProbe(idleMs: number): Promise<void>`（`--egress-probe` 档，落 JSON 后 `app.exit(0)`）

- [ ] **Step 1: 写失败的纯函数尺**

新建 `src/main/egress/egress-watchdog.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { classifyRequest } from "./egress-watchdog";

describe("出口分类", () => {
  it("本地环回与内建 scheme 记为 local", () => {
    for (const url of [
      "http://127.0.0.1:7896/proxies",
      "http://localhost:5173/",
      "file:///D:/app/index.html",
      "data:image/png;base64,AAAA",
      "blob:https://example.com/1",
      "chrome-extension://abcdef/bg.js",
      "cyrene-exam://page/1",
      "cyrene-plugin://mochi/1",
      "local-sticker://stickers/a.png",
      "moment-media://media/a.png",
    ]) {
      expect(classifyRequest(url)).toBe("local");
    }
  });

  it("真外部 origin 记为 external（正对照：分类器不是永远返回 local）", () => {
    expect(classifyRequest("https://fonts.googleapis.com/css2?family=x")).toBe("external");
    expect(classifyRequest("https://gitee.com/playa0/x/raw/main/y")).toBe("external");
    expect(classifyRequest("https://api.anthropic.com/v1/messages")).toBe("external");
  });

  it("解析不了的怪 URL 归 external，宁可多记一笔也不静默放行", () => {
    expect(classifyRequest("not a url")).toBe("external");
  });
});
```

- [ ] **Step 2: 实现分类 + 记表**

```ts
// src/main/egress/egress-watchdog.ts
import { session, type Session } from "electron";

/** 本 fork 认得的自有 scheme：privileged scheme 注册点与 `local-sticker`/`moment-media`。 */
const LOCAL_SCHEMES = ["cyrene-exam", "cyrene-plugin", "local-sticker", "moment-media", "mochi"];

export interface EgressEntry {
  url: string;
  method: string;
  resourceType: string;
  /** 相对进程启动的毫秒数，方便探针排「开机 20s 内」这条判据。 */
  atMs: number;
}

/**
 * 本地 = 环回 + 文件 + 内建数据 scheme。其余一律 external，**包括**模型供应商的 API：
 * 那些是用户配了 key 才会发的显式请求，探针档不该看到它们（探针不配 key），
 * 但静态表里没有「看着像本地其实不是」的容错——宁可记出来让人读。
 */
export function classifyRequest(url: string): "local" | "external" {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "external";
  }
  if (["file:", "data:", "blob:", "chrome-extension:", "devtools:", "about:"].includes(parsed.protocol)) return "local";
  if (LOCAL_SCHEMES.includes(parsed.protocol.replace(":", ""))) return "local";
  if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1") return "local";
  return "external";
}

export function installEgressWatchdog(
  target: Session = session.defaultSession,
  startedAt: number = Date.now(),
): { entries(): EgressEntry[]; dispose(): void } {
  const table: EgressEntry[] = [];
  const listener = (details: Electron.OnBeforeSendHeadersRequestDetails) => {
    if (classifyRequest(details.url) !== "external") return;
    if (table.length < 1000) table.push({
      url: details.url,
      method: details.method,
      resourceType: details.resourceType,
      atMs: Date.now() - startedAt,
    });
  };
  target.webRequest.onBeforeSendHeaders(listener);
  return {
    entries: () => [...table],
    dispose: () => target.webRequest.onBeforeSendHeaders(null),
  };
}
```

- [ ] **Step 3: 探针档**

```ts
// src/main/egress/egress-probe.ts
import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { installEgressWatchdog } from "./egress-watchdog";

/** argv 形状沿用 `--tuck-probe`/`--voice-probe` 的既有先例：`--egress-probe=<空闲毫秒>`。 */
export function readEgressProbeArg(argv: string[] = process.argv): number | null {
  const hit = argv.find((arg) => arg.startsWith("--egress-probe"));
  if (!hit) return null;
  const raw = hit.split("=")[1];
  const idleMs = raw ? Number(raw) : 20_000;
  return Number.isFinite(idleMs) && idleMs >= 0 ? idleMs : 20_000;
}

/**
 * 装看门狗 → 空闲 idleMs → 落 JSON → 退出。
 * 输出位置钉在 userData 之外（`--user-data-dir` 指的 profile 同级），
 * 免得探针产物混进真实账本。
 */
export function armEgressProbe(idleMs: number, outDir: string): () => void {
  const watchdog = installEgressWatchdog();
  const timer = setTimeout(() => {
    const file = path.join(outDir, "egress-probe.json");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ external: watchdog.entries(), pid: process.pid, version: app.getVersion() }, null, 2), "utf8");
    console.log(`[egress-probe] external=${watchdog.entries().length} -> ${file}`);
    app.exit(watchdog.entries().length === 0 ? 0 : 1);
  }, idleMs);
  return () => {
    clearTimeout(timer);
    watchdog.dispose();
  };
}
```

`src/main/index.ts`：在 ready 之后、窗口起来之前装看门狗（非探针档也要装，日志里 warn 出来），
探针档优先短路——`readEgressProbeArg()` 有值时不调 `registerCoreIpc`，避免模型供应商的 key-gated 请求混进表：

```ts
  const egressProbeMs = readEgressProbeArg();
  if (egressProbeMs !== null) {
    armEgressProbe(egressProbeMs, path.dirname(app.getPath("userData")));
  } else {
    egressWatchdog = installEgressWatchdog();
  }
```

- [ ] **Step 4: 给锁加自锁**

`upstream-off.test.ts` 追加一条，防止后来人把看门狗摘掉还让静态锁报绿：

```ts
  {
    clause: "A6 看门狗在场",
    // 反向判据：这条 pattern 命中是**要求**，不是禁止。断言在独立 it 里，见 Step 5。
    pattern: /installEgressWatchdog/,
    positiveControl: "installEgressWatchdog",
    exceptions: [],
  },
```

并把该条改成 required 语义（`RULES` 加可选 `required?: boolean`，`required` 的规则断言「至少命中一次」而不是「零命中」）。

- [ ] **Step 5: 跑门 + 提交**

```bash
CI=true npx vitest run src/main/egress
npx tsc -p tsconfig.main.json --noEmit
```

`git commit -m "feat(egress): 加运行时出口看门狗与 --egress-probe 探针档"`。
正文写：为什么静态 grep 不够（间接路径），以及真正的「默认启动到空闲 20s 外网请求 = 0」
这条判据在 E2 用真进程跑，本任务只交付尺子本身与分类器单测。

---

## 阶段 B：自有身份

B 期唯一的硬顺序：**Task 7（拆密钥雷）必须早于 Task 9（换 userData 目录）**。
`brand.ts` 本身在 Task 3 就落地了——更新面是它的第二个消费者，先有消费者才有「名字只在一处」的证据；
Task 8 只做生成器与一致性锁。

### Task 7: 拆掉 XOR 密钥随身份派生的雷（B1）

**Files:**
- Modify: `src/main/channels/settings-store.ts:26-31`（前缀常量）、`:49-82`（key 派生与 XOR）、`:98-129`（`decryptField`）、`:368-395`（wrap 边界的前缀判断）
- Create: `src/main/channels/obfuscation.ts`
- Test: `src/main/channels/obfuscation.test.ts`
- Modify: `src/main/channels/settings-store.test.ts`、`settings-store-fallback.test.ts:85`、`settings-store-preready.test.ts:47,54`（三个文件的 `getName` mock 随新前缀更新）

**Interfaces:**
- Produces:
  - `export const OBF_PREFIX_V2 = "obf:2:"`、`export const OBF_PREFIX_LEGACY = "obf:"`
  - `export function obfuscateV2(plain: string): string`
  - `export function deobfuscateV2(stored: string): string`（校验和不过 → 抛 `ObfuscationIntegrityError`）
  - `export function deobfuscateLegacy(stored: string, appDataDir: string): string`
  - `export class ObfuscationIntegrityError extends Error`
- Consumes: `app.getPath("appData")`（不随 userData 变）与 `os.userInfo().uid`。

- [ ] **Step 1: 写失败的尺（含「错钥匙必须响」这条 spec 判据）**

新建 `src/main/channels/obfuscation.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import {
  ObfuscationIntegrityError,
  OBF_PREFIX_LEGACY,
  OBF_PREFIX_V2,
  deobfuscateLegacy,
  deobfuscateV2,
  obfuscateV2,
} from "./obfuscation";

/** 与实现同一口径的历史 key：userData 钉在 cyrene-verge，name 钉在 cyrene-verge。 */
function legacyEncrypt(plain: string, appDataDir: string): string {
  // 复刻改造前 settings-store.ts:51-68 的公式，只为用户数据能读回来这一件事存在。
  const { createHash } = require("crypto") as typeof import("crypto");
  const seed = `${appDataDir}\\cyrene-verge::cyrene-verge::cyrene-bot-secret`;
  const key = createHash("sha256").update(seed).digest().subarray(0, 16);
  const buf = Buffer.from(plain, "utf8");
  const out = Buffer.alloc(buf.length);
  for (let i = 0; i < buf.length; i += 1) out[i] = buf[i] ^ key[i % key.length];
  return OBF_PREFIX_LEGACY + out.toString("base64");
}

describe("频道密钥混淆", () => {
  it("v2 round-trip 与身份无关：换 userData 目录/换 app 名都读得回来", () => {
    const stored = obfuscateV2("feishu-secret");
    expect(stored.startsWith(OBF_PREFIX_V2)).toBe(true);
    expect(deobfuscateV2(stored)).toBe("feishu-secret");
  });

  it("v2 密文被改坏一个字符就抛错，不再静默返回乱码（spec §5-1）", () => {
    const stored = obfuscateV2("feishu-secret");
    const body = stored.slice(OBF_PREFIX_V2.length);
    const flipped = `${OBF_PREFIX_V2}${body.slice(0, -2)}${body.endsWith("AA") ? "BB" : "AA"}`;
    expect(() => deobfuscateV2(flipped)).toThrow(ObfuscationIntegrityError);
  });

  it("旧 obf:（无版本）用旧公式解一次，解出的就是当时的明文", () => {
    const appDataDir = "C:\\Users\\tester\\AppData\\Roaming";
    const stored = legacyEncrypt("qq-token", appDataDir);
    expect(deobfuscateLegacy(stored, appDataDir)).toBe("qq-token");
  });

  it("旧 obf: 配错钥匙时解出非法 UTF-8，判为失败而不是返回乱码", () => {
    const stored = legacyEncrypt("qq-token", "C:\\Users\\other\\AppData\\Roaming");
    expect(() => deobfuscateLegacy(stored, "C:\\Users\\tester\\AppData\\Roaming")).toThrow(ObfuscationIntegrityError);
  });
});
```

Run: `CI=true npx vitest run src/main/channels/obfuscation.test.ts` → Expected: FAIL（模块不存在）。

- [ ] **Step 2: 实现（key 不再从 userData / app.name 派生）**

新建 `src/main/channels/obfuscation.ts`：

```ts
import * as os from "node:os";
import * as path from "node:path";

/**
 * 频道 secret 的 XOR 混淆。
 *
 * ⚠️ 这条存在的理由（spec §2.5 的雷）：改造前 `getMachineKey()` 的 seed 是
 * `${app.getPath("userData")}::${app.getName()}::cyrene-bot-secret`（settings-store.ts:52）。
 * 换 app 名或换 userData 目录**等于换钥匙**，而旧的 `deobfuscate` 没有任何完整性校验，
 * 结果不是报错，是解出一段乱码并被当成正确值用——飞书/QQ 的 secret 会静默变成垃圾字符串，
 * 用户只在渠道连不上时才发现。个人化改名（Task 9）正好踩这条，所以雷必须先拆。
 *
 * 现在的 key 只由「机器 + 固定 salt」派生，与 userData、app.name 都无关。
 * `os.userInfo().uid` 在 Windows 上不是真 uid（返回 token 字符串），稳定性够用且
 * 不碰注册表、不落盘第二份凭据。这仍然是**混淆**，不是加密：safeStorage 可用时轮不到它。
 */
const OBF_KEY_SALT = "mochi-obf-key-v2";
const CHECKSUM_BYTES = 4;

export const OBF_PREFIX_V2 = "obf:2:";
/** 旧前缀无版本号；`obf:2:` 也以它开头，所以判断顺序必须 v2 在前。 */
export const OBF_PREFIX_LEGACY = "obf:";

export class ObfuscationIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ObfuscationIntegrityError";
  }
}

function sha256(data: string | Buffer): Buffer {
  const { createHash } = require("node:crypto") as typeof import("node:crypto");
  return createHash("sha256").update(data).digest();
}

function xor(data: Buffer, key: Buffer): Buffer {
  const out = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i += 1) {
    // eslint-disable-next-line no-bitwise
    out[i] = data[i] ^ key[i % key.length];
  }
  return out;
}

function currentKey(): Buffer {
  const uid = (() => {
    try {
      return String(os.userInfo().uid);
    } catch {
      return "unknown-uid";
    }
  })();
  return sha256(`${uid}::${OBF_KEY_SALT}`).subarray(0, 16);
}

/** 历史 key：userData 路径与名字都钉成当年的常量，绝不读当前身份（读了一次就永远解不开）。 */
function legacyKey(appDataDir: string): Buffer {
  const seed = `${path.join(appDataDir, "cyrene-verge")}::cyrene-verge::cyrene-bot-secret`;
  return sha256(seed).subarray(0, 16);
}

export function obfuscateV2(plain: string): string {
  const body = xor(Buffer.from(plain, "utf8"), currentKey());
  const checksum = sha256(body).subarray(0, CHECKSUM_BYTES).toString("hex");
  return `${OBF_PREFIX_V2}${checksum}:${body.toString("base64")}`;
}

export function deobfuscateV2(stored: string): string {
  const rest = stored.slice(OBF_PREFIX_V2.length);
  const separator = rest.indexOf(":");
  if (separator < 0) throw new ObfuscationIntegrityError("obf:2: 缺少校验和字段");
  const checksum = rest.slice(0, separator);
  const body = Buffer.from(rest.slice(separator + 1), "base64");
  const expected = sha256(body).subarray(0, CHECKSUM_BYTES).toString("hex");
  if (checksum !== expected) {
    throw new ObfuscationIntegrityError("obf:2: 校验和不匹配：密钥已轮换或数据被改坏");
  }
  return decodeStrictUtf8(xor(body, currentKey()));
}

export function deobfuscateLegacy(stored: string, appDataDir: string): string {
  const body = Buffer.from(stored.slice(OBF_PREFIX_LEGACY.length), "base64");
  return decodeStrictUtf8(xor(body, legacyKey(appDataDir)));
}

/**
 * 「解出乱码」必须能被判定。XOR 用错钥匙得到的字节大概率不是合法 UTF-8，
 * 而 `Buffer.toString("utf8")` 会把它替换成 U+FFFD 静默放过——所以这里按
 * 重新编码是否等价来否决，宁可返回失败让上层记 warn，也不把乱码当明文。
 */
function decodeStrictUtf8(buf: Buffer): string {
  const text = buf.toString("utf8");
  if (Buffer.from(text, "utf8").equals(buf) && !text.includes("\uFFFD")) return text;
  throw new ObfuscationIntegrityError("解出的字节不是合法 UTF-8：密钥不匹配");
}
```

- [ ] **Step 3: 接进 settings-store**

`settings-store.ts` 删 `:49-82`（`getMachineKey`/`obfuscate`/`deobfuscate`），改由 `./obfuscation` 供：

```ts
const encryptField = (plain: string): string => {
  if (!plain) return "";
  if (isSafeStorageAvailable()) {
    try {
      return ENC_PREFIX + safeStorage.encryptString(Buffer.from(plain, "utf8").length ? plain : plain).toString("base64");
    } catch (err) {
      console.warn("[ChannelsSettings] safeStorage.encryptString 失败, 回退混淆:", err);
    }
  }
  return obfuscateV2(plain);
};
```

> 上面 safeStorage 那行的三元是占位错误示范——**实现时保持原样**（`safeStorage.encryptString(plain)`），
> 只把 `obfuscate(plain)` 换成 `obfuscateV2(plain)`。Step 3 的改动面就两个函数体，别的一律不动。

`decryptField` 的 obf 分支改为（一次性迁移 + 失败不再静默）：

```ts
  if (stored.startsWith(OBF_PREFIX_V2)) {
    try {
      return deobfuscateV2(stored);
    } catch (err) {
      console.warn("[ChannelsSettings] obf:2: 解密失败（密钥轮换或数据损坏），已丢弃该字段:", err);
      return "";
    }
  }
  if (stored.startsWith(OBF_PREFIX_LEGACY)) {
    try {
      // 旧格式：用旧公式解一次，立刻按新公式重写。key 不再随身份派生，所以 Task 9 换目录后
      // 这条仍然解得开——legacyKey 钉的是当年的字面路径，不是当前 userData。
      const plain = deobfuscateLegacy(stored, app.getPath("appData"));
      pendingRewrite = true;
      return plain;
    } catch (err) {
      console.warn("[ChannelsSettings] 旧 obf: 解密失败，已丢弃该字段（不再返回乱码）:", err);
      return "";
    }
  }
```

模块内加 `let pendingRewrite = false;`，`loadChannelsSettings()` 末尾：

```ts
  if (pendingRewrite) {
    pendingRewrite = false;
    // 走 save 的正路重加密落盘（save 内部 wrap 会把明文换成 obf:2:），失败只 warn：
    // 读回来的明文本次仍然可用，下次启动再试一次。
    try {
      saveChannelsSettings(decrypted);
    } catch (err) {
      console.warn("[ChannelsSettings] 旧 obf: 重加密落盘失败:", err);
    }
  }
```

`:368-395` 的 wrap 前缀判断改成 `OBF_PREFIX_V2` + `OBF_PREFIX_LEGACY` 两个都认（否则新写的
`obf:2:` 会被当成明文二次混淆）。

- [ ] **Step 4: 加集成尺（旧格式落盘 → 读回明文 → 盘上已是 v2）**

`settings-store.test.ts` 追加：

```ts
  it("旧 obf: 记录读回明文，并就地升级为 obf:2:", () => {
    const legacy = `${OBF_PREFIX_LEGACY}${Buffer.from(
      Buffer.from("feishu-secret", "utf8").map((b, i) => b ^ legacyKeyByte(i)),
      "base64",
    ).toString()}`;
    fs.writeFileSync(
      path.join(os.tmpdir(), "channels-settings.json"),
      JSON.stringify({ feishu: { enabled: true, appId: "cli_x", appSecret: legacy } }, null, 2),
      "utf8",
    );
    expect(loadChannelsSettings().feishu.appSecret).toBe("feishu-secret");
    const raw = fs.readFileSync(path.join(os.tmpdir(), "channels-settings.json"), "utf8");
    expect(raw).toContain('"appSecret": "obf:2:');
    expect(raw).not.toContain("feishu-secret");
  });
```

`legacyKeyByte(i)` 用 Step 1 测试里的同一份复刻公式（把它从测试文件提到 `obfuscation.test.ts` 的导出辅助，
两个测试文件共用；不要复制两份实现）。夹具里 `app.getPath("appData")` 必须 mock 成与加密时一致的值——
`settings-store-fallback.test.ts:85` 已有 `getName: "live2d-cyrene"` 的 mock 形状可照抄。

- [ ] **Step 5: 跑门 + 提交**

```bash
CI=true npx vitest run src/main/channels
npx tsc -p tsconfig.main.json --noEmit
```

`git commit -m "fix(channels): XOR 密钥去身份派生并加校验和与一次性升级"`。
正文必含：错钥匙现在**响**（抛 `ObfuscationIntegrityError` + warn + 返回空）而不是解出乱码；
`legacyKey` 钉字面路径的理由（Task 9 之后 userData 变了，读当前路径必然解不开旧记录）。

### Task 8: 身份生成器与一致性锁（B2）

**Files:**
- Create: `scripts/build/sync-brand.mjs`
- Create: `src/main/egress/brand-consistency.test.ts`
- Modify: `electron-builder.yml:1-2,75,82`（由脚本生成，人不手改）
- Modify: `package.json:2-3,11,13-15`（同上）
- Modify: `package.json` scripts（加 `"sync:brand": "node scripts/build/sync-brand.mjs"`、`"check:brand": "node scripts/build/sync-brand.mjs --check"`，并把 `check:brand` 串进 `build`）

**Interfaces:**
- Consumes: `src/shared/brand.ts` 的 `BRAND`。
- Produces: `sync-brand.mjs` 导出 `buildBrandFields(brand)` 与 CLI（`--check` 只比对不写）。

- [ ] **Step 1: 写失败的一致性锁**

`src/main/egress/brand-consistency.test.ts`：

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";
import { BRAND } from "../../shared/brand";

/**
 * 生成物与源不一致即红（spec §3-B2 的第二条 CI 判据）。
 *
 * 为什么要有这把锁而不是「记得跑脚本」：`electron-builder.yml` 的 appId/productName
 * 决定装到系统里的名字，`brand.ts` 决定运行时的 userData。两者一旦分叉，
 * 用户看到的是「开始菜单叫 Cyrene、数据目录叫 Mochi」，而这种分叉只有装机后才暴露。
 */
function readFields() {
  const yml = load(readFileSync(resolve(process.cwd(), "electron-builder.yml"), "utf8")) as {
    appId?: string; productName?: string; nsis?: { artifactName?: string; menuCategory?: string };
  };
  const pkg = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as {
    name?: string; productName?: string; description?: string; bin?: Record<string, string>;
  };
  return { yml, pkg };
}

describe("身份生成物与 brand.ts 一致", () => {
  it("electron-builder.yml 的四个身份字段由 BRAND 推出", () => {
    const { yml } = readFields();
    expect(yml.appId).toBe(BRAND.appId);
    expect(yml.productName).toBe(BRAND.productName);
    expect(yml.nsis?.menuCategory).toBe(BRAND.productName);
    expect(yml.nsis?.artifactName).toBe(`${BRAND.productName}-Setup-\${version}.\${ext}`);
  });

  it("package.json 的 name/productName/bin 与 BRAND 同源", () => {
    const { pkg } = readFields();
    expect(pkg.productName).toBe(BRAND.productName);
    expect(pkg.name).toBe(BRAND.productName.toLowerCase());
    expect(Object.keys(pkg.bin ?? [])).toEqual([BRAND.productName.toLowerCase()]);
  });

  it("userData 目录名与 appId 不撞上游（正对照：上游字面量确实不再出现）", () => {
    const { yml, pkg } = readFields();
    expect(pkg.description).not.toMatch(/Cyrene/);
    expect(yml.appId).not.toBe("com.cyrene.live2d");
  });
});
```

Run: `CI=true npx vitest run src/main/egress/brand-consistency.test.ts` → Expected: FAIL（yml 还是 `com.cyrene.live2d`）。

- [ ] **Step 2: 写生成器**

`scripts/build/sync-brand.mjs`：

```js
// 身份字段的唯一生成入口：src/shared/brand.ts -> electron-builder.yml / package.json。
// 用法：node scripts/build/sync-brand.mjs [--check]
//   --check 只比对并打印差异，不写文件；CI 与 build 串这一条（spec §3-B2）。
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * brand.ts 是 TS，脚本不引编译产物（build 顺序里 main 还没编译）。
 * 这里用最窄的正则把 `export const X = "…"` 读出来——读不到即抛错，
 * 绝不在脚本里再维护一份默认值（那才是真正的「两处定义」）。
 */
export function readBrand(file) {
  const source = readFileSync(file, "utf8");
  const pick = (name) => {
    const hit = new RegExp(`export const ${name} = "([^"]+)"`).exec(source);
    if (!hit) throw new Error(`brand.ts 缺少 export const ${name} = "…"`);
    return hit[1];
  };
  return {
    productName: pick("PRODUCT_NAME"),
    productNameZh: pick("PRODUCT_NAME_ZH"),
    appId: pick("APP_ID"),
    dataDirName: pick("DATA_DIR_NAME"),
  };
}

export function buildBrandFields(brand) {
  const lower = brand.productName.toLowerCase();
  return {
    lowerName: lower,
    // electron-builder.yml 里逐行替换的锚点：只碰这四行，其余一律不动。
    yml: [
      ["^appId:.*$", `appId: ${brand.appId}`],
      ["^productName:.*$", `productName: ${brand.productName}`],
      ["^  artifactName:.*$", `  artifactName: ${brand.productName}-Setup-\${version}.\${ext}`],
      ["^  menuCategory:.*$", `  menuCategory: ${brand.productName}`],
    ],
    pkg: {
      name: lower,
      productName: brand.productName,
      description: `${brand.productNameZh}桌面猫（本机构建，不联网升级）`,
      binKey: lower,
    },
  };
}

function applyYml(source, pairs) {
  let text = source;
  for (const [pattern, replacement] of pairs) {
    const re = new RegExp(pattern, "m");
    if (!re.test(text)) throw new Error(`electron-builder.yml 里找不到锚点 ${pattern}`);
    text = text.replace(re, replacement);
  }
  return text;
}

function applyPkg(source, fields) {
  const json = JSON.parse(source);
  const next = {
    ...json,
    name: fields.pkg.name,
    productName: fields.pkg.productName,
    description: fields.pkg.description,
    bin: { [fields.pkg.binKey]: json.bin?.[Object.keys(json.bin ?? {})[0]] ?? "./dist/cli/index.js" },
  };
  // 缩进与键序按现状保真：JSON.stringify 保留插入顺序，而上面展开原对象时
  // name/productName 已在原位，不会把 main/scripts 挤到前面。
  return `${JSON.stringify(next, null, 2)}\n`;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const check = process.argv.includes("--check");
  const brand = readBrand(path.join(projectRoot, "src", "shared", "brand.ts"));
  const fields = buildBrandFields(brand);
  const ymlPath = path.join(projectRoot, "electron-builder.yml");
  const pkgPath = path.join(projectRoot, "package.json");
  const ymlNext = applyYml(readFileSync(ymlPath, "utf8"), fields.yml);
  const pkgNext = applyPkg(readFileSync(pkgPath, "utf8"), fields);
  const drift = [];
  if (readFileSync(ymlPath, "utf8") !== ymlNext) drift.push("electron-builder.yml");
  if (readFileSync(pkgPath, "utf8") !== pkgNext) drift.push("package.json");
  if (check) {
    if (drift.length) {
      console.error(`[brand] 生成物与 src/shared/brand.ts 不一致：${drift.join(", ")}。跑 node scripts/build/sync-brand.mjs`);
      process.exitCode = 1;
    } else {
      console.log(`[brand] ${brand.productName} (${brand.appId}) 一致`);
    }
  } else {
    writeFileSync(ymlPath, ymlNext, "utf8");
    writeFileSync(pkgPath, pkgNext, "utf8");
    console.log(`[brand] 已写入 ${drift.length ? drift.join(", ") : "（无变化）"}`);
  }
}
```

- [ ] **Step 3: 跑生成器，让 Step 1 的锁转绿**

```bash
node scripts/build/sync-brand.mjs
CI=true npx vitest run src/main/egress/brand-consistency.test.ts
git diff --stat electron-builder.yml package.json
```
Expected: 锁绿；diff 只碰 `appId`/`productName`/`artifactName`/`menuCategory` 四行 + package 的 name/productName/description/bin。
**若 diff 里出现无关行（缩进/键序被 JSON.stringify 挪动），不要提交**——改 `applyPkg` 为逐行文本替换，
并在提交正文里记下实测到的偏移。

- [ ] **Step 4: 串门禁**

`package.json` scripts 加：

```json
    "sync:brand": "node scripts/build/sync-brand.mjs",
    "check:brand": "node scripts/build/sync-brand.mjs --check",
```

并把 `check:brand` 放在 `build` 链最前（`"build": "pnpm run check:brand && pnpm run check:main && …"`）。
本机没有 pnpm 时以 vitest 锁为准——一致性测试已在 `CI=true npx vitest run` 的全量面里。

- [ ] **Step 5: 提交**

`git commit -m "feat(brand): 身份字段改由 brand.ts 生成并加一致性门禁"`。

### Task 9: userData 目录迁移到 Mochi（B3）

**Files:**
- Modify: `src/main/user-data-migration.ts`（`migrateLegacyUserData` 参数化 legacy 目录名与标记文件名）
- Create: `src/main/verge-identity-migration.ts`（薄封装：cyrene-verge → Mochi）
- Modify: `src/main/app-identity.ts:16,24-29,75-91`
- Modify: `src/main/application/pre-ready.ts:19-20,43-48`
- Modify: `src/main/application/default-dependencies.ts`（把新迁移塞进 `PreReadyDependencies`）
- Test: `src/main/user-data-migration.test.ts`（追加两例）、`src/main/app-identity.test.ts`

**Interfaces:**
- Produces:
  - `migrateLegacyUserData(input: { appDataPath; targetUserDataPath; legacyDirName; markerFileName })`
  - `export const VERGE_LEGACY_DIR_NAME = "cyrene-verge"`、`VERGE_MIGRATION_MARKER = ".migrated-from-cyrene-verge"`
- Consumes: `BRAND.dataDirName`（Task 8）、`renameWithRetrySync`（`src/main/storage/rename-with-retry.ts:10`）。

- [ ] **Step 1: 先锁住「绝不碰 %APPDATA%\Cyrene」**

`src/main/user-data-migration.test.ts` 追加：

```ts
  it("迁移器拒绝任何指向 Cyrene 的 legacy 目录（那是用户的真实数据，只读禁写）", () => {
    const appData = fs.mkdtempSync(path.join(os.tmpdir(), "mochi-mig-"));
    const forbidden = path.join(appData, "Cyrene");
    fs.mkdirSync(path.join(forbidden, "cyrene-chats"), { recursive: true });
    fs.writeFileSync(path.join(forbidden, "cyrene-chats", "a.json"), "{}", "utf8");
    const before = fs.readdirSync(path.join(forbidden, "cyrene-chats"));

    expect(() =>
      migrateLegacyUserData({
        appDataPath: appData,
        targetUserDataPath: path.join(appData, "Mochi"),
        legacyDirName: "Cyrene",
        markerFileName: ".migrated-from-cyrene-verge",
      }),
    ).toThrow(/禁写|forbidden/);

    // 正对照：被拒绝之后 Cyrene 目录一个字节没动
    expect(fs.readdirSync(path.join(forbidden, "cyrene-chats"))).toEqual(before);
    expect(fs.existsSync(path.join(appData, "Mochi"))).toBe(false);
  });

  it("cyrene-verge -> Mochi 整体重命名并落标记，重跑为 already_migrated", () => {
    const appData = fs.mkdtempSync(path.join(os.tmpdir(), "mochi-mig-"));
    const legacy = path.join(appData, "cyrene-verge");
    fs.mkdirSync(path.join(legacy, "logs"), { recursive: true });
    fs.writeFileSync(path.join(legacy, "logs", "cyrene.log"), "x", "utf8");

    expect(
      migrateLegacyUserData({
        appDataPath: appData,
        targetUserDataPath: path.join(appData, "Mochi"),
        legacyDirName: "cyrene-verge",
        markerFileName: ".migrated-from-cyrene-verge",
      }).status,
    ).toBe("renamed");
    expect(fs.existsSync(path.join(appData, "Mochi", "logs", "cyrene.log"))).toBe(true);
    expect(fs.existsSync(legacy)).toBe(false);
    expect(fs.existsSync(path.join(appData, "Mochi", ".migrated-from-cyrene-verge"))).toBe(true);
  });
```

Run → Expected: FAIL（现签名没有 `legacyDirName`/`markerFileName`，且没有 Cyrene 闸门）。

- [ ] **Step 2: 参数化 + 加闸门**

`src/main/user-data-migration.ts`：`:19` 的常量保留为默认值，`LegacyUserDataMigrationInput`（`:37-42`）扩两个字段，
函数头插入闸门：

```ts
/** 只读禁写的上游目录名：这是用户真实数据，任何迁移都不许把它当源或目标。 */
const FORBIDDEN_DIR_NAMES = new Set(["Cyrene"]);

function assertMigratable(input: LegacyUserDataMigrationInput): void {
  const names = [input.legacyDirName, path.basename(input.targetUserDataPath)];
  for (const name of names) {
    if (FORBIDDEN_DIR_NAMES.has(name)) {
      throw new Error(`迁移被拒绝：\`%APPDATA%\\${name}\` 是上游 Cyrene 的真实用户数据，本 fork 全程只读禁写（spec §6）。`);
    }
  }
}
```

`LEGACY_USER_DATA_DIR_NAME` → `input.legacyDirName`，`MIGRATION_MARKER_FILE_NAME` → `input.markerFileName`
（两处使用点 `:64`、`:60`、`:84` 等按实读数替换）。**两个标记名必须不同**：live2d 那次迁移的标记
`.legacy-user-data-migrated` 会随整体重命名一起搬进 Mochi，若新迁移复用同名标记，它会被上一次的历史标记
判成 `already_migrated` 而静默跳过——这是把数据留在旧目录不搬的静默失败。

- [ ] **Step 3: 身份改读 brand**

`src/main/app-identity.ts`：

```ts
import { BRAND } from "../shared/brand";

/** fork 的实例名：从此由 brand 单点决定（原来写死 "cyrene-verge"）。 */
export const VERGE_INSTANCE_NAME = BRAND.productName;
/** 上一代 fork 目录名，只作为 Task 9 迁移的显式源，不作任何其他用途。 */
export const VERGE_LEGACY_DIR_NAME = "cyrene-verge";
```

`resolveAppUserDataPath`（`:24-29`）的默认 name 参数跟着 `VERGE_INSTANCE_NAME` 走（代码不用改，改的是常量出处）。

- [ ] **Step 4: 排进 pre-ready 顺序**

`pre-ready.ts` 的 `PreReadyDependencies` 加一步，并插在现有 `migrateLegacyUserData()` **之后**、
`registerPrivilegedSchemes()` **之前**：

```ts
  // 身份迁移顺序：先 cyrene-verge -> Mochi（当前目录整体改名，搬走全部既有账本），
  // 再跑历史 live2d-cyrene 迁移（此时它多半返回 none / already_migrated）。
  // 反过来的话，live2d 的残留会先并进 cyrene-verge，再被整体改名搬走——结果一样，
  // 但报错时「旧目录」指向哪一个会说不清，所以钉死这个顺序。
  const vergeMigration = deps.migrateVergeUserData();
  if (vergeMigration.status === "failed" || vergeMigration.status === "partial") {
    throw new Error("Mochi 数据目录迁移未完成，已停止启动以避免使用不完整的数据目录。旧目录原样保留，请勿删除。");
  }
```

`default-dependencies.ts` 里给它接上真实参数（`app.getPath("appData")` + 当前 userData + brand 目录名）。

- [ ] **Step 5: 跑门 + 提交**

```bash
CI=true npx vitest run src/main/user-data-migration.test.ts src/main/app-identity.test.ts src/main/application
npx tsc -p tsconfig.main.json --noEmit
```

`git commit -m "feat(brand): userData 迁移到 Mochi 并拒绝任何触碰上游 Cyrene 目录"`。
正文写：标记名分开的原因、`%APPDATA%\Cyrene` 只读禁写由闸门 + 测试两处钉。

### Task 10: 名字清扫（B4）

**Files（分 (a) 用户可见必改 / (b) 内部字符串可改 / (c) 不许盲改）：**
- (a) Modify: `src/main/tray.ts:41,45`、`src/main/windows/create-aux-windows.ts:67,143,279`、
  `src/main/windows/create-music-player-window.ts:36`、`src/main/windows/create-toast-window.ts:33`、
  `src/renderer/react/features/settings/AppearanceSettingsPage.tsx`（about 文案）、
  `src/cli/banner/text.ts`（Task 4 已接 brand，本步核销）
- (b) Modify: `src/main/logger-tags.ts:20`（`LogTag.Cyrene` → `LogTag.Brand`，值取 `BRAND.logPrefix`）、
  `src/main/verge/banner.ts:8-20`
- (c) **不动**：`cyrene.sqlite`、`cyrene-chats/`、`logs/cyrene.log`、`cyrene-runs`、`cyrene-tasks`、
  `cyrene-tts-cache`、`cyrene.*` AG-UI 事件名、`cyrene-exam`/`cyrene-plugin` scheme、`native/cyrene-screenshot.exe`
- Modify: `README.md`、`README.zh-CN.md` 标题与首段
- Modify: i18n 三个 json 的 about 面板键值
- Test: 受影响的断言按目录随改（`tray.test.ts:70` 等）

**Interfaces:**
- Consumes: `BRAND`、`IPC.VERGE_GET_APP_INFO`（Task 3）。

- [ ] **Step 1: 列出待清扫的字面量并分档**

```bash
grep -rn "Cyrene\|cyrene" src --include=*.ts --include=*.tsx --include=*.css \
  | grep -vi "cyrene.sqlite\|cyrene-chats\|cyrene-runs\|cyrene-tasks\|cyrene-tts-cache\|cyrene-exam\|cyrene-plugin\|cyrene-screenshot\|logs/cyrene\|cyrene\.log\|\"cyrene:" \
  | wc -l
```
把输出按 (a)/(b) 两档抄进提交正文（数量与文件清单，不是逐行），(c) 档明确写成「接受的遗留」。

- [ ] **Step 2: (a) 档逐目录改，每目录一次提交**

统一从 brand 取，不再写死字符串：

```ts
// src/main/tray.ts:45 原来 setToolTip("Cyrene")
import { BRAND } from "../shared/brand";
// …
  tray.setToolTip(BRAND.productNameZh ? `${BRAND.productName}（${BRAND.productNameZh}）` : BRAND.productName);
```

`tray.test.ts:70` 的期望值同批改。`create-aux-windows.ts:67,143,279`、
`create-music-player-window.ts:36`、`create-toast-window.ts:33` 的窗口标题按同一写法接 `BRAND.titleSuffix`。
> ⚠️ 标题拼接的**现有形状**要先读实文件确认（是否已经带 ` - ${documentTitle}`），
> 只替换品牌字面量，不动拼接规则。

- [ ] **Step 3: (b) 档改日志前缀**

`src/main/logger-tags.ts:20` 的 `Cyrene: "cyrene"` 改为
`Brand: BRAND.logPrefix.toLowerCase()`——**键名改了，值必须是 `"mochi"`**。
所有 `LogTag.Cyrene` 调用点（`grep -rn "LogTag.Cyrene" src` 实测计数）跟着改成 `LogTag.Brand`。
> 这里改的是日志**前缀字符串**，不是 `logs/cyrene.log` 文件名（(c) 档）。
> 日志文件名不动，用户的旧日志文件继续在原处被追加，迁移成本 0。

- [ ] **Step 4: README 与 about 面板**

两份 README 标题改 `Mochi`，正文里「上游/Fork 来源」段落改为一段本地说明（不提仓库地址，
遵守 `upstream-off.test.ts` 的 A4 规则）。i18n `about` 面板相关键三语同步。

- [ ] **Step 5: 跑门 + 提交（每目录一提交，别混进功能改动）**

```bash
CI=true npx vitest run src/main/tray.test.ts src/main/windows src/main/logger.test.ts src/renderer/react/features/settings
npx tsc -p tsconfig.main.json --noEmit && npx tsc -p tsconfig.renderer.json
```

`git commit -m "refactor(brand): 用户可见名称与日志前缀统一为 Mochi"`。
正文分 (a)(b)(c) 三档写明改了哪些、哪些是**明确接受的遗留**（spec §3-B4 裁决 (c)）。

### Task 11: 装机身份（B5）

**Files:**
- Create: `src/shared/png-encode.ts`（**不是** `scripts/build/png-encode.mjs`——见 Phase D 裁决 R-D6）
- Create: `src/shared/draw-ops.ts`（把 `Point2` / `PetLayer` / `DrawOp` 三个纯类型从 `src/renderer/pet/ops.ts` 原样搬来——R-D13 的反方向：shared 侧光栅化器不能反过来 import renderer）
- Modify: `src/renderer/pet/ops.ts:1-35`（改成 `import type { DrawOp, PetLayer, Point2 } from "../../shared/draw-ops";` 并 `export type { DrawOp, PetLayer, Point2 } from "../../shared/draw-ops";`，`paintOps`/`toPath2D` 的函数体一行不动；现有 import 方全部继续从 `./ops` 取，不用改）
- Create: `src/shared/sprite-raster.ts`（本任务只交付图标用到的四种图元，Task 22 补全；`DrawOp` 从 `./draw-ops` 取）
- Create: `scripts/build/cat-sprites.mjs`（本任务只交付 `--only=icons` 一条支路，D2 扩全表；它是 **CLI**，用 Phase C 验证过的 esbuild 路子把上面两个 `src/shared/*.ts` 打进 `node_modules/.cache/mochi-palette/` 再 import）
- Create: `assets/mochi-icon.png`、`assets/tray-icon.ico`（覆盖）、`build/installer/mochi-installer-source.png`
- Create: `assets/icon-presets/cyrene-{pink,sun}.png`（**覆盖**，文件名即内部键，见 Step 5）
- Modify: `electron-builder.yml:66`（`win.icon`）、`:84-85`（sidebar 位图）——由 Task 8 的生成器之外的手改（**这两行不在 sync-brand 锚点里，属本任务**）
- Modify: `build/installer/installer.nsh:27`（「开机时自动启动 Cyrene」→ Mochi）
- Modify: `src/shared/ui-icon.ts:2-3`（只改 `fileName` 指向的文件内容与 `label`；`id` 与 `settings-facade.ts:56` 的默认值是内部键，**不动**）
- Test: `src/main/app-icon.test.ts`（若无则新建）、`src/shared/png-encode.test.ts`、`src/shared/sprite-raster.test.ts`

**Interfaces:**
- Produces:
  - `Point2` / `PetLayer` / `DrawOp`（`src/shared/draw-ops.ts`；`src/renderer/pet/ops.ts` 原样重导出，`sprite-raster.ts` 与 `cat-variants.ts` 各从自己那一侧取）
  - `encodePng(width: number, height: number, rgba: Uint8Array): Buffer`（`src/shared/png-encode.ts`，`zlib` + CRC32，零新依赖）
  - `renderOps(ops: DrawOp[], width: number, height: number, opts?: RenderOpts): Raster`（`src/shared/sprite-raster.ts`；本任务只需 `fillPath`/`gradPath`/`fillEllipse`/`fillRoundRect` 四种）
  - `catIconOps(): DrawOp[]`（正面头像取景的猫，复用 `art.ts` 的 `buildCatOps`；画在 `cat-sprites.mjs` 内）

- [ ] **Step 1: 决定 rasterizer 的落点（spec §5-3 的风险就在这一步）**

`ops.ts:37-108` 的 `paintOps` 依赖 `CanvasRenderingContext2D`、`Path2D`、`ellipse`、`clip`、渐变与
`fillText`——Node 里没有，且**不引 `canvas` 原生依赖**（本机无管理员权限、构建期不许联网装包）。
裁决：**写一个只覆盖本期所需图元的最小软件光栅化器**（`fillPath`/`fillEllipse`/`fillRoundRect`/
`gradPath`/`strokePath`/`crescent`/`text` 中本期图标实际用到的四种），并且：

- 像素尺只认**质心 / 色相 / 覆盖度**这类稳健量（spec §5-3），不认逐字节，所以浏览器与
  光栅化器的抗锯齿差异不构成验收风险；
- 桌面猫**运行时**仍走 `paintOps`（浏览器），生成器只产位图资产，两条路径不合并、不互相替代；
- **落点是 `src/shared/sprite-raster.ts`**（R-D6）。本任务只实现 `fillPath`/`gradPath`/`fillEllipse`/
  `fillRoundRect` 四种图元加盒式降采样，够图标用；Task 22 在同文件补 `strokePath`/`strokeEllipse`/
  `crescent`/`disc` 遮罩与 ICO/BMP，那才是位图资产全表的基座。**别在 `scripts/` 下写 `.ts` 逻辑**——
  那里既不进 tsconfig 也不进 vitest，写完就是没测。

**先把 `DrawOp` 搬到 shared（R-D13 的反方向，不做这一步 Task 11 当场红）**：`sprite-raster.ts`
的签名是 `renderOps(ops: DrawOp[], …)`，而 `DrawOp` 现在住在 `src/renderer/pet/ops.ts`——同文件的
`paintOps` 用了 `CanvasRenderingContext2D`/`Path2D`，`tsconfig.main.json` 的 `lib` 只有 `ES2022`，
`src/shared/**/*.ts` 又在它的 include 里，import 一下就会把 DOM 类型整条拉进主进程程序。
所以新建 `src/shared/draw-ops.ts`，把 `ops.ts:1-35` 的 `Point2` / `PetLayer` / `DrawOp` 三个声明
**原样剪切**过去（含注释），再在 `ops.ts` 顶部：

```ts
import type { DrawOp, PetLayer, Point2 } from "../../shared/draw-ops";
export type { DrawOp, PetLayer, Point2 } from "../../shared/draw-ops";
```

`paintOps`、`roundRectPath`、`toPath2D` 与 `ops.ts` 其余消费方一行不改。`sprite-raster.ts` 与
`sprite-raster.test.ts` 只写 `import type { DrawOp, Point2 } from "./draw-ops";`。判据：
`npx tsc -p tsconfig.main.json --noEmit` 在本步就绿，且 `grep -rn "renderer/pet/ops" src/shared` 为 0。

- [ ] **Step 2: PNG 编码器（含失败测试）**

新建 `src/shared/png-encode.test.ts`。落点的三个理由都实测过：`src/shared/**/*.ts` 同时出现在 `tsconfig.main.json`、`tsconfig.preload.json`、`tsconfig.renderer.json` 的 include 里；`vitest.config.mts` 的 include 有 `src/shared/**/*.test.ts`；该目录已有 13 个 `*.test.ts` 先例（`pet-geometry.test.ts` 就是本期用的）。`scripts/` 三条都不满足——这是 R-D6 的全部内容：

```ts
import { describe, expect, it } from "vitest";
import { encodePng } from "./png-encode";

describe("最小 PNG 编码器", () => {
  it("2x2 全红 RGBA 编出合法 PNG（IHDR 尺寸与色深对得上）", () => {
    const rgba = new Uint8Array([255,0,0,255, 255,0,0,255, 255,0,0,255, 255,0,0,255]);
    const png = encodePng(2, 2, rgba);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const ihdr = png.subarray(16, 29);
    expect(ihdr.readUInt32BE(0)).toBe(2);   // width
    expect(ihdr.readUInt32BE(4)).toBe(2);   // height
    expect(ihdr[8]).toBe(8);                // bit depth
    expect(ihdr[9]).toBe(6);                // color type RGBA
  });
});
```

实现 `src/shared/png-encode.ts`（**不是** `scripts/build/png-encode.mjs`，理由见 R-D6）：
`zlib.deflateSync` 压缩「每行前置 filter byte 0」的原始数据，手写 `IHDR/IDAT/IEND` chunk 与 CRC32 表。
约 60 行，注释只写一句为什么不用 `sharp`（`sharp` 在 asarUnpack 里是给 Transformers.js 用的运行时依赖，
构建脚本引它会把打包面搅浑）。

- [ ] **Step 3: 光栅化 + 图标产出**

`scripts/build/cat-sprites.mjs` 本任务交付：

```js
// 生成图标与头像位图：在 Node 里跑与桌面猫同一套 DrawOp（src/renderer/pet/art.ts）。
// 用法：node scripts/build/cat-sprites.mjs [--only=icons] [--check]
// 输出全部进 git（像素尺要能跨提交比较，构建期不依赖网络）。
// 本任务**只用 `buildCatOps` 的默认（墨）花色**：`coat`/`pose` 两个键是 Task 20/21 才存在的
// 东西，这里引用就是向前依赖。图标的花色到 Task 24 的全表生成时再统一换。
const TARGETS = {
  icons: [
    { out: "assets/mochi-icon.png", size: 256, crop: "head", mood: "idle" },
    { out: "assets/tray-icon.ico", size: 32, crop: "head", mood: "idle" },
    { out: "assets/icon-presets/cyrene-pink.png", size: 256, crop: "full", mood: "idle" },
    { out: "assets/icon-presets/cyrene-sun.png", size: 256, crop: "head", mood: "happy" },
    { out: "build/installer/mochi-installer-source.png", size: 150, crop: "full", mood: "happy" },
  ],
  // D2 补：statusMoods / avatars / portraits / stickers / welcome / contextUsage（Task 24）
};
```

`catIconOps()` 把 `CatInput` 的 11 个必填字段钉成一个「identity 取景」的静帧（R-D9：`t = 0` 是唯一
呼吸/摆尾/耳抽同时归零的时刻）：

```js
function catIconOps(mood) {
  return buildCatOps({
    center: { x: 60, y: 60 },   // viewBox 板中心对窗口中心，u=60 → 120 宽正好铺满 120×120
    u: 60, mood, t: 0, energy: 0.5,
    mouse: null, blink: 0, jumpY: 0, pet: 0, quiet: false,
    pose: { paw: 0, yawn: 0, stretch: 0, tilt: 0, engagement: 0 },
  });
}
```

`crop: "head"` 用的取景窗口在 Task 11 里**先硬编码成 `[34, 20, 86, 72]`（x, y, w, h）**，
与 Task 21 的 `square` 档同一组数；Task 21 的 `CAT_CROPS` 落地后由 `cat-sprites.mjs` 改读它——
这一步是临时的，写进注释，别让它悄悄常驻。

`--only=icons` 跑通后：
- `assets/tray-icon.ico` 用 ICONINFO-free 的 BMP-in-ICO 写法（32×32、32bit、含 alpha）自拼容器；
- `build/installer/installer-sidebar.bmp` 由 `mochi-installer-source.png` 同尺寸 24bit BMP 派生
  （NSIS sidebar 不吃 PNG）。**若 24bit BMP 编码器实现代价过大，裁决：`installerSidebar` 两行整条删除，
  用 electron-builder 默认侧栏**——侧栏图不是本期的判据，删它比拖一个 BMP 编码器进计划划算。
  删则必须在提交正文里写明这是 Task 11 的显式让步。

- [ ] **Step 4: 装机身份与 NSIS 文案**

`electron-builder.yml` 的 `win.icon` 改 `assets/mochi-icon.png`（electron-builder 吃 PNG，内部转 ico）
或继续指 `assets/tray-icon.ico`（已被 Step 3 覆盖为猫）。`nsis.artifactName`/`menuCategory`/`appId`
已由 Task 8 生成器写成 Mochi，本步只核对 `git diff`。
`build/installer/installer.nsh:27` 的 `"开机时自动启动 Cyrene"` → `"开机时自动启动 Mochi"`。
> NSIS 的 `Var Cyrene*` 变量名与 `.Cyrene.content-preserve` 暂存目录名属 (c) 档，**不改**——
> 暂存目录名改了会让「升级时装到一半」的中间态文件落到新名字下被当成空目录，
> 用户内容看起来就消失了。这一条务必写进提交正文。

- [ ] **Step 5: 图标预设接本地路径**

`src/shared/ui-icon.ts:1-4` 改的是**值**，不是键。实测这三条决定了改法：

1. `id` 是**已落盘的设置值**——`normalizeUiIcon()` 的函数体就写死了 `value === "cyrene-pink" ? … : "cyrene-sun"`，
   全仓唯一的消费方 `main/app-icon.ts:5` 用 `UI_ICON_PRESETS.find(item => item.id === icon)` 查表。
   改 `id` 等于改内部数据键，spec §6 明令不动。**两个 id 原样保留。**
2. 真正决定图标长相的是 `fileName`：`app-icon.ts:6` 把它拼成 `assets/icon-presets/<fileName>`。
   所以 Step 3 的 TARGETS 产出的两个文件**必须就叫 `cyrene-pink.png` / `cyrene-sun.png`**（文件名也是键），
   猫版花色靠重画这两个文件实现，不靠改名。
3. `previewPath` **全仓零消费**（`grep -rn "previewPath" src` 只命中定义行）。它是死的，
   本期随 `fileName` 同步改成同名文件的相对路径即可，不要为它新增读取点。

于是 Step 3 的 TARGETS 里那两行改为：

```js
    { out: "assets/icon-presets/cyrene-pink.png", size: 256, crop: "full", mood: "idle" },
    { out: "assets/icon-presets/cyrene-sun.png",  size: 256, crop: "head", mood: "happy" },
```

`label` 是用户可见文案（「绮梦」「晴光」），按 spec B2 换成猫的名字；`settings-facade.ts:56`
的默认值 `"cyrene-sun"` **不改**（它是 id，不是显示名）。
> 旧值读不到的兜底不用补：`normalizeUiIcon` 已经把任意输入折进两个合法 id，
> 而 `app-icon.ts` 查不到文件时的行为由 Step 5 现场读实文件确认——**确认结果写进提交正文**。
> 原计划「`mochi-sit`/`mochi-head` 改名」的那版是错的，错在把内部数据键当成了品牌字符串。
> `settings-facade.ts:56` 的默认值也是 `"cyrene-sun"` 这个**键**，同样原样保留，不写迁移。

- [ ] **Step 6: 跑门 + 提交**

```bash
node scripts/build/cat-sprites.mjs --only=icons
CI=true npx vitest run src/shared/png-encode src/shared/sprite-raster src/main/app-icon src/main/egress
npx tsc -p tsconfig.main.json --noEmit
git diff --stat assets build
```

`git add src/shared/png-encode.ts src/shared/png-encode.test.ts src/shared/draw-ops.ts \
  src/shared/sprite-raster.ts src/shared/sprite-raster.test.ts src/renderer/pet/ops.ts \
  scripts/build/cat-sprites.mjs assets build/installer/installer.nsh src/shared/ui-icon.ts electron-builder.yml`
`git commit -m "feat(packaging): 装机身份与图标改为 Mochi 猫"`。

### Task 12: 自启与系统协议「无新增」锁（B6）

**Files:**
- Create: `src/main/egress/scan-source-files.ts`（把 Task 1 的内联遍历器抽出来，两把锁共用）
- Create: `src/main/egress/no-system-identity.test.ts`
- Modify: `src/main/egress/upstream-off.test.ts`（删内联遍历器，改 import）
- Modify: `src/main/settings/launch-at-login.ts:14`（确认默认关，不改逻辑）

**Interfaces:**
- Consumes: 无。
- Produces: 一条常驻负判据锁。

- [ ] **Step 1: 写锁（三条，各带正对照）**

```ts
import { readFileSync, readdirSync, statSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * spec §3-B6：本期不注册系统协议、不开机自启默认开。
 * 现状本来就是这样，所以这个任务交付的是**「没有新增」的锁**，不是新功能。
 * 每条都配正对照：判据用的正则必须能命中一个已知存在的替代写法，否则「零命中」
 * 可能只是判据写坏了（spec §4 的负判据规矩）。
 */
function srcFiles(dir = "src", out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === "release") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) srcFiles(full, out);
    else if (/\.(ts|tsx|mjs|css|html|json|ya?ml|nsh)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("身份不侵入系统", () => {
  it("没有 setAsDefaultProtocolClient", () => {
    const hits = srcFiles().filter((f) => /setAsDefaultProtocolClient/.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
    // 正对照：协议名确实在别处存在（privileged scheme），说明不是扫了个空目录
    expect(srcFiles().some((f) => /registerPrivilegedSchemes|scheme/.test(readFileSync(f, "utf8")))).toBe(true);
  });

  it("没有写 HKCU\\Software\\Classes 或启动项注册表", () => {
    const hits = srcFiles().filter((f) => /Software\\\\Classes|Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Run/.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });

  it("开机自启默认关闭", () => {
    const source = readFileSync(path.resolve(process.cwd(), "src/main/settings/settings-facade.ts"), "utf8");
    expect(/launchAtLogin:\s*false/.test(source) || /launchAtLogin.*default.*false/is.test(source)).toBe(true);
  });
});
```

`srcFiles()` 必须与 `upstream-off.test.ts` 共用同一个遍历器，不许两处各写一份（被终审按重复打回）。
把 Task 1 里内联的 `sourceFiles`/`scannedFiles` 抽到 `src/main/egress/scan-source-files.ts`：

```ts
import { readdirSync, statSync } from "node:fs";
import * as path from "node:path";

export const SCAN_ROOTS = ["src", "scripts", "build", "packages"] as const;
export const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".mjs", ".css", ".html", ".json", ".yml", ".yaml", ".nsh"]);

export function sourceFiles(root: string, out: string[] = []): string[] {
  for (const entry of readdirSync(root)) {
    if (entry === "node_modules" || entry === "dist" || entry === "release") continue;
    const full = path.join(root, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (SCAN_EXTENSIONS.has(path.extname(full))) out.push(full);
  }
  return out;
}

export function scannedFiles(cwd = process.cwd()): string[] {
  return SCAN_ROOTS.flatMap((root) => {
    const abs = path.join(cwd, root);
    try {
      return statSync(abs).isDirectory() ? sourceFiles(abs) : [];
    } catch {
      return [];
    }
  });
}
```

然后 `upstream-off.test.ts` 与 `no-system-identity.test.ts` 都改成
`import { scannedFiles } from "./scan-source-files";`，删掉两处内联副本；上面示例里的 `srcFiles()`
落地时一律写成 `scannedFiles()`。

- [ ] **Step 2: 跑门 + 提交**

```bash
CI=true npx vitest run src/main/egress src/main/settings
```

`git commit -m "test(brand): 锁住不注册系统协议与自启默认关"`。

---

## 阶段 C：配色统一（C1–C6 → Task 13–19）

C 期的判据只有一条：**任何一个还在屏幕上着色的 `--rb-*`/`--md-*` 值，都能由猫色板推出**；
推不出来的必须写进一份显式白名单并给出理由（第三方图标、由外部渲染出来的图、位图本身）。
这条锁不在代码审查里判，在测试里判——人眼在一屏 138 个变量里看不出「这个粉是从哪来的」。

动手前有三条实测事实必须先接受，否则改了也不生效：

1. **同一个令牌名在四个文件里各写一遍。** 四份文件（`tokens.css` / `themes/pearl-white.css` /
   `themes/charcoal-pink.css` / `theme.css`）的令牌名做四路 `comm -12`，交集是 **43 个名字**：
   `--rb-pink-50…700`(7)、`--rb-pink-glow`、`--rb-bg-0…3`、`--rb-bg-elevated`、
   `--rb-text-strong/default/muted/faint/on-pink`(5)、`--rb-border-faint/soft/strong/grid`(4)、
   `--rb-card-bg`、`--rb-divider-light`、`--rb-hover-light`、`--rb-active-light`、
   `--rb-input-*`(4)、`--rb-slider-*`(3)、`--rb-toggle-*`(2)、`--rb-scroll-*`(2)、
   `--rb-glow-pink`、`--rb-glow-soft`、`--rb-shadow-card/elevated/pink`。
   另有 `--rb-feedback-*`(12) 出现在三份里（`tokens.css` 没有它，只住在 `theme.css:7` 的 `:root`、
   `theme.css:28` 的珍珠块、和两份主题文件里）。同一名字写四遍、值各不相同，是「改一处不够」的物理原因。
2. **珍珠白模式下生效的不是 `pearl-white.css`。** 每个入口 HTML 的 link 顺序是
   `ui/tokens.css` 在前、`ui/theme.css` 在后（`src/renderer/react/index.html:7` 与 `:12`；
   `src/renderer/index.html:19/:22`、`call-react/index.html:8/:11`、`music/index.html:8/:11`、
   `learn-exam.html:7/:10` 同一形状）。`theme.css` 第 4–5 行 `@import` 两份主题文件，
   然后**第 28 行起自带一个 `[data-ui-theme="pearl-white"]` 块**——同特异度、源序在后，
   这个块共 69 条声明（56 `--rb-*` + 13 `--md-*`），其中 68 条与 `pearl-white.css` 重名并盖掉它
   （实测 `comm -12`：68/69，唯一不重名的 `--rb-glow-violet` 住在 `tokens.css:81`）。
   只改 `pearl-white.css` 等于改一份被覆盖的文件，
   屏幕上什么也不会变。这是 C 期唯一会让整期白干的一步，也是把 `theme.css` 拉进改动清单的原因。
3. **带颜色字面量的令牌声明一共 104 个不同名字**（按文件数：`tokens.css` 69 行 / `pearl-white.css` 87 /
   `charcoal-pink.css` 85 / `theme.css` 63，合计 304 行、去重 104 个名字；另有 176 行是**非令牌**的
   直接着色属性，归 C5 的清扫与棘轮管，见 Task 19）。手写 304 个值必然出错，
   所以 C3 用脚本按令牌名逐条回写值，派生锁负责证明回写结果就是派生结果。

另有一条搬家的理由写在最前面：**猫色板从 `src/renderer/pet/tokens.ts` 搬到
`src/shared/pet-tokens.ts`**（Task 13）。不是洁癖——原生 `BrowserWindow` 的 `backgroundColor`
是主进程传的字符串，CSS 变量管不到它（`src/main/windows/create-aux-windows.ts:61` 现在自己写着
`#141414` / `#fff8fb`，`:145` 欢迎窗写死 `#fff8fb`）。要让「窗口底色」和「页面底色」真的是
同一只猫的同一张纸，唯一的办法是两边读同一个模块。`src/shared/` 已经是这个仓库放这类东西的地方
（`src/shared/pet-geometry.ts` 就是 P1 Task 6 放进去的），三份 tsconfig 的 `include`
都含 `src/shared/**/*.ts`，所以这一搬不动任何构建配置。

### Task 13: 猫色板搬进 shared 并收口 11 个私有色（C1）

**Files:**
- Move: `src/renderer/pet/tokens.ts` → `src/shared/pet-tokens.ts`
- Move: `src/renderer/pet/tokens.test.ts` → `src/shared/pet-tokens.test.ts`
- Modify: `src/renderer/pet/art.ts:16-19`（import 路径）、`:64-65`、`:503-514`（11 个私有色改为 import）
- Modify: `src/renderer/pet/art.test.ts:4`（import 路径）
- Modify: `src/shared/pet-tokens.test.ts`（新增成员表锁）

**Interfaces:**
- Produces: `src/shared/pet-tokens.ts` 新增 `CAT_PALETTE: Record<string, Color | (() => Color)>`
  （板内色成员表）、`PET_PRIVATE`（单侧专用色，明写**不入库**）；`Color` 类型仍从同一模块导出。
  Task 14 的派生器只准 import 这个模块。

- [ ] **Step 1: 先移动，不动内容**

```bash
git mv src/renderer/pet/tokens.ts src/shared/pet-tokens.ts
git mv src/renderer/pet/tokens.test.ts src/shared/pet-tokens.test.ts
```

改三处 import：`art.ts:19` 的 `} from "./tokens"` 改为 `} from "../../shared/pet-tokens"`；
`art.test.ts:4` 同；`pet-tokens.test.ts:5` 的 `from "./tokens"` 改为 `from "./pet-tokens"`。

> ⚠️ 搬家前自己再跑一次 `grep -rn 'from "./tokens"' src` 确认仍是 3 个 importer（实测只有
> `art.ts`、`art.test.ts`、`tokens.test.ts`）。若有第四个，把它一起改，
> **不要**在 `src/renderer/pet/tokens.ts` 留 re-export 垫片——为不存在的消费者留兼容会被终审打回。

- [ ] **Step 2: 跑门，确认搬家零改动**

```bash
CI=true npx vitest run src/shared src/renderer/pet
npx tsc -p tsconfig.renderer.json --noEmit
npx tsc -p tsconfig.main.json --noEmit
```
Expected：全绿。`art.test.ts` 的绘制断言一条不少（它们锁的是 DrawOp 序列，色值没动就不该红）。

- [ ] **Step 3: 写失败的锁——把「哪些色在板上」钉成成员表**

在 `src/shared/pet-tokens.test.ts` 追加（并把 `CAT_PALETTE`、`PET_PRIVATE` 加进文件头的 import）：

```ts
describe("色板成员表", () => {
  it("板内色就是 CAT_PALETTE 这些，别把单侧专用色混进来", () => {
    // 派生器（Task 14）只能从这份名单里取色，所以这份名单 = 全客户端配色的合法输入域。
    expect(Object.keys(CAT_PALETTE).sort()).toEqual([
      "ACCENT", "ACCENT_DEEP", "ACCENT_FG", "ACCENT_HOVER", "BG_SOLID", "BREAK_EAR",
      "BREAK_FILL", "BREAK_SOFT", "DIM", "EYE", "FG", "GREEN", "GREEN_FG", "INK",
      "INK_SOFT", "PANEL_CARD", "PANEL_SEP", "PANEL_STROKE", "PAPER", "PAPER_SHADE",
      "ROSE", "ROSE_DEEP", "SHADOW", "TODAY_BAR", "WARN", "WARN_FG",
    ]);
  });

  it("单侧专用色进台账但明写不入库，且和 art.ts 的字面量逐一对上", () => {
    // 台账规矩原文（palette.rs:1-10）：只放两个以上模块在同一件事上用的颜色。
    // 这一批本期破例收进来，是为了让派生锁能按名字**排除**它们：
    // 没有名单，「HUD_BOX 不在板上」和「HUD_BOX 忘了抄进板」在测试里长得一模一样。
    expect(PET_PRIVATE.HUD_BOX).toBe("#1a1d26");
    expect(PET_PRIVATE.HUD_INK).toBe("#e8eaf0");
    expect(PET_PRIVATE.HUD_UP).toBe("#7dcda0");
    expect(PET_PRIVATE.CAP_BORDER_ON).toBe("#3a404e");
    expect(PET_PRIVATE.CAP_DOWN_ON).toBe("#87afeb");
    expect(PET_PRIVATE.CAP_BOX_OFF).toBe("#14161d");
    expect(PET_PRIVATE.CAP_BORDER_OFF).toBe("#2c303c");
    expect(PET_PRIVATE.CAP_INK_OFF).toBe("#969caa");
    expect(PET_PRIVATE.CAP_UP_OFF).toBe("#5c9474");
    expect(PET_PRIVATE.CAP_DOWN_OFF).toBe("#6480a8");
    expect(PET_PRIVATE.BADGE_INK).toBe("#ffffff");
  });

  it("正对照：CAT_PALETTE 与 PET_PRIVATE 的值域不相交，且都是不透明 6 位 hex", () => {
    const board = new Set(
      Object.values(CAT_PALETTE).filter((v): v is string => typeof v === "string"),
    );
    expect(board.size).toBeGreaterThanOrEqual(20); // 名单不是空的，否则下面的循环会空过
    for (const v of [...board, ...Object.values(PET_PRIVATE)]) {
      expect(v).toMatch(/^#[0-9a-f]{6}$/);
    }
    for (const v of Object.values(PET_PRIVATE)) expect(board.has(v)).toBe(false);
  });
});
```

- [ ] **Step 4: 实现 `CAT_PALETTE` / `PET_PRIVATE`**

`src/shared/pet-tokens.ts` 末尾追加：

```ts
/**
 * 板内色名单：全客户端配色（`palette-from-cat.ts`）唯一的合法输入域。
 * `PANEL_*` 三个是**函数**（要在具体底上预混才成形），名单里按函数放进去，
 * 由派生器显式调用；下面的成员表断言用 `typeof` 跳过它们，不让函数被当颜色拼进 CSS。
 */
export const CAT_PALETTE: Record<string, Color | (() => Color)> = {
  ACCENT, ACCENT_DEEP, ACCENT_FG, ACCENT_HOVER,
  GREEN, GREEN_FG, WARN, WARN_FG,
  PAPER, PAPER_SHADE, INK, INK_SOFT, EYE,
  ROSE, ROSE_DEEP,
  BREAK_FILL, BREAK_SOFT, BREAK_EAR,
  BG_SOLID, FG, DIM, TODAY_BAR, SHADOW,
  PANEL_CARD: PANEL_CARD as () => Color,
  PANEL_SEP: PANEL_SEP as () => Color,
  PANEL_STROKE: PANEL_CARD_STROKE as () => Color,
};

/**
 * 单侧专用色（本期从 `art.ts` 收编，仍**不进板**）。
 * 台账原文的理由成立：它们只在流量胶囊/徽章这一件事上出现。收进来的唯一理由是
 * 派生锁需要能按名字排除它们——否则「没抄进板」与「不该进板」在测试里不可区分。
 * 新增者请一并更新 `pet-tokens.test.ts` 的字面量断言。
 */
export const PET_PRIVATE = {
  HUD_BOX: "#1a1d26", // main.rs:2988 气泡盒与胶囊共用的墨底
  HUD_INK: "#e8eaf0", // rgb(232,234,240) 读数墨白
  HUD_UP: "#7dcda0", // rgb(125,205,160) 上行绿
  CAP_BORDER_ON: "#3a404e",
  CAP_DOWN_ON: "#87afeb",
  CAP_BOX_OFF: "#14161d",
  CAP_BORDER_OFF: "#2c303c",
  CAP_INK_OFF: "#969caa",
  CAP_UP_OFF: "#5c9474",
  CAP_DOWN_OFF: "#6480a8",
  BADGE_INK: "#ffffff", // ui.rs:1205 Color32::WHITE
} as const;
```

> ⚠️ 先红后绿：Step 3 的成员表断言此时必须**红**（`CAT_PALETTE` 还不存在，`tsc`/vitest 直接报
> 未导出）。跑一次确认它红在哪一行，再回来实现 Step 4。别把「加了但没跑过」当红灯。

- [ ] **Step 5: `art.ts` 改为 import，删掉本地字面量**

`art.ts:64-65` 的 `BADGE_INK` 与 `:503-514` 的 `HUD_*` / `CAP_*` 内联字面量改为 import
`PET_PRIVATE`（与已有的 `ACCENT` 等同一句 import 里加），然后：

```ts
const BADGE_INK = PET_PRIVATE.BADGE_INK;
const HUD_BOX = PET_PRIVATE.HUD_BOX;
const HUD_INK = PET_PRIVATE.HUD_INK;
const HUD_UP = PET_PRIVATE.HUD_UP;
const CAP_ON = [HUD_BOX, PET_PRIVATE.CAP_BORDER_ON, HUD_INK, HUD_UP, PET_PRIVATE.CAP_DOWN_ON];
const CAP_OFF = [
  PET_PRIVATE.CAP_BOX_OFF, PET_PRIVATE.CAP_BORDER_OFF, PET_PRIVATE.CAP_INK_OFF,
  PET_PRIVATE.CAP_UP_OFF, PET_PRIVATE.CAP_DOWN_OFF,
];
```

`CAP_ON`/`CAP_OFF` 的**下标语义（底/描边/读数/上行/下行）与 alpha 表 `CAP_A_ON`/`CAP_A_OFF` 一律不动**——
它们对位 native 的绘制顺序，改了 `art.test.ts` 的胶囊断言会红，那是美术回归、不在本任务范围。
两处原有的台账注释（`以下全是 main.rs 单侧专用的色…不进 tokens.ts`）要改写为
「已收编进 `PET_PRIVATE`，仍不算板内色」——留着旧注释就是下一条改动谎报自己的所在。

- [ ] **Step 6: 跑全部门 + 提交**

```bash
CI=true npx vitest run src/shared src/renderer/pet
npx tsc -p tsconfig.renderer.json --noEmit
```
Expected：Step 3 的三条新断言 + 原有全部断言绿；`art.test.ts` 绿。

```bash
git add -A src/shared src/renderer/pet
git commit -m "refactor(palette): 猫色板搬进 shared 并收编 art.ts 的 11 个私有色"
```

> 提交正文要写清两件事：搬家是为 `BrowserWindow.backgroundColor` 这个 CSS 管不到的着色点铺路（Task 17），
> 不是模块整理；`PET_PRIVATE` 收编是为派生锁提供可排除名单，不改变台账「单侧专用不进板」的规矩。

---

### Task 14: 派生器 `palette-from-cat.ts`（C2）

**Files:**
- Create: `src/shared/palette-from-cat.ts`
- Create: `src/shared/palette-from-cat.test.ts`

**Interfaces:**
- Consumes: `src/shared/pet-tokens.ts` 的具名色与 `wash()` / `withAlpha()` / `hex()`。
- Produces:
  - `type ThemeScheme = "light" | "dark"`；`type TokenMap = Record<string, string>`（键 = `--rb-x` / `--md-x` 全名）
  - `const LIGHT_TOKENS: TokenMap`、`const DARK_TOKENS: TokenMap`、
    `const TOKENS_BY_SCHEME: Record<ThemeScheme, TokenMap>`
  - `const WINDOW_BACKGROUNDS: Record<"pearl-white" | "charcoal-pink", string>`
  - `function contrastRatio(fg: string, bg: string): number`
  - `function derivedValue(scheme: ThemeScheme, token: string): string`（Task 16 的锁按令牌名取值，
    令牌不在表里时抛错——**不许静默返回 undefined**，那会把「忘了派生」读成「这令牌没颜色」）

Task 15/16 的 `apply-theme-palette.mjs` 读 `TOKENS_BY_SCHEME`；Task 16 的派生锁读
`derivedValue()`；Task 17 的 `create-aux-windows.ts` 读 `WINDOW_BACKGROUNDS`。

- [ ] **Step 1: 写派生器**

```ts
/**
 * 全客户端配色的派生器：从猫色板（`pet-tokens.ts`）算出 104 个带颜色的
 * `--rb-*` / `--md-*` 声明值。CSS 文件只是这份表的**落盘形式**，不是第二份真相。
 *
 * 三条规矩都是从 native 那边学来的：
 * 1. **不发明新色**。每个输出值要么是板上一个色，要么是 `wash(板A, α, 板B)` 的预混结果，
 *    要么是由这两者拼出的 rgba / gradient。
 * 2. **透明度只有 `withAlpha` 一条路**。native 美术契约「投影只能差分量」「面板底必须不透明」
 *    靠的就是「半透明只能由 wash/withAlpha 产生」；手写 rgba 会绕过它。
 * 3. **变量名不动**（spec §1 M3）。这里的键是**现有 CSS 里已经存在**的令牌名，一个不多一个不少。
 *    `--rb-pink-*` 仍然叫 pink，值却是猫蓝——这条命名债写在 `tokens.css` 文件头注释里：
 *    改名要打爆上千处引用与 25-token 契约，本期明确不做。
 */
import {
  ACCENT, ACCENT_DEEP, ACCENT_FG, ACCENT_HOVER, BG_SOLID, DIM, FG, GREEN, GREEN_FG,
  INK, INK_SOFT, PAPER, PAPER_SHADE, PANEL_CARD, PANEL_CARD_STROKE, PANEL_SEP,
  ROSE, ROSE_DEEP, SHADOW, WARN, WARN_FG, wash, withAlpha, type Color,
} from "./pet-tokens";

export type ThemeScheme = "light" | "dark";
export type TokenMap = Record<string, string>;

/**
 * 与 `pet-tokens.ts:69` 的 `wash("#ffffff", 13, BG_SOLID)` 同一原料：native 把 WHITE 当
 * **预混的原料**而不是**屏幕上的成品色**（`palette.rs` 台账明写 WHITE 不入板）。
 * 这里沿用同一口径，所以它不出现在 `CAT_PALETTE` 里，只出现在 wash 的 fg 位。
 */
const WHITE = "#ffffff";

/** 浅色：往奶油纸上压一层板内色。α 用 native `theme::over` 的 0..255 量纲。 */
const onPaper = (fg: Color, a: number, base: Color = WHITE): string => wash(fg, a, base);
/** 深色：往墨底上抬一层板内色。 */
const onInk = (fg: Color, a: number, base: Color = BG_SOLID): string => wash(fg, a, base);

function build(scheme: ThemeScheme): TokenMap {
  const light = scheme === "light";
  // —— 表面 ——
  const page = light ? onPaper(PAPER_SHADE, 72, PAPER) : BG_SOLID;
  const workspace = light ? onPaper(PAPER, 190, WHITE) : BG_SOLID;
  const elevated = light ? WHITE : PANEL_CARD();
  const hover = light ? onPaper(ACCENT, 20, WHITE) : onInk(FG, 16);
  const active = light ? onPaper(ACCENT, 38, WHITE) : onInk(FG, 26);
  // —— 强调标度（名字仍叫 pink）——
  const accent = light ? ACCENT : ACCENT_FG;
  const accentHover = light ? ACCENT_DEEP : ACCENT_HOVER;
  // —— 文字 ——
  const strong = light ? INK : FG;
  const secondary = light ? onPaper(INK_SOFT, 190, WHITE) : DIM;
  const disabled = light ? onPaper(INK_SOFT, 132, WHITE) : onInk(DIM, 150);
  const onAccent = light ? WHITE : BG_SOLID;
  // —— 描边 ——
  const bStrong = light ? PAPER_SHADE : onInk(FG, 60);
  const bSoft = light ? onPaper(PAPER_SHADE, 150, WHITE) : PANEL_CARD_STROKE();
  const bFaint = light ? onPaper(PAPER_SHADE, 80, WHITE) : PANEL_SEP();
  return {
    // 表面：bg-* 是历史标度，surface-* 才是消费面（实测 --rb-surface-elevated 被引用 157 次）。
    "--rb-bg-0": page,
    "--rb-bg-1": workspace,
    "--rb-bg-2": hover,
    "--rb-bg-3": active,
    "--rb-bg-elevated": elevated,
    "--rb-surface-page": page,
    "--rb-surface-workspace": workspace,
    "--rb-surface-elevated": elevated,
    "--rb-surface-hover": hover,
    "--rb-surface-active": active,
    // soft 在两档里指向不同的既有底：浅色档它是 hover 的别名（现状就是 var），
    // 深色档 `charcoal-pink.css:9` 把它写成 #252525 = 浮起底。同源赋值，不新增发明。
    "--rb-surface-soft": light ? hover : elevated,
    // 文字：strong/default/primary 同墨，muted/secondary 同值，faint/disabled 同值，
    // on-pink/on-accent 同值。这是现状里就存在的重复角色，M3 不许合并，只能**同源赋值**。
    "--rb-text-strong": strong,
    "--rb-text-default": strong,
    "--rb-text-primary": strong,
    "--rb-text-muted": secondary,
    "--rb-text-secondary": secondary,
    "--rb-text-faint": disabled,
    "--rb-text-disabled": disabled,
    "--rb-text-on-pink": onAccent,
    "--rb-text-on-accent": onAccent,
    // 强调标度
    "--rb-pink-50": light ? onPaper(ACCENT, 16, WHITE) : onInk(ACCENT_FG, 34),
    "--rb-pink-100": light ? onPaper(ACCENT, 40, WHITE) : onInk(ACCENT_FG, 52),
    "--rb-pink-200": light ? onPaper(ACCENT, 82, WHITE) : onInk(ACCENT_FG, 82),
    "--rb-pink-300": light ? onPaper(ACCENT, 130, WHITE) : onInk(ACCENT_FG, 122),
    "--rb-pink-400": light ? onPaper(ACCENT, 190, WHITE) : ACCENT_FG,
    "--rb-pink-500": accent,
    "--rb-pink-600": accentHover,
    "--rb-pink-700": light ? wash(ACCENT_DEEP, 205, INK) : onInk(ACCENT_FG, 190),
    "--rb-pink-glow": ACCENT_FG,
    "--rb-accent": accent,
    "--rb-accent-hover": accentHover,
    // 副强调：旧紫族是从上游品牌渐变的端点抄来的，板上没有紫，换成猫的腮红族。
    "--rb-violet-400": ROSE,
    "--rb-violet-500": ROSE_DEEP,
    "--rb-violet-600": light ? wash(ROSE_DEEP, 205, INK) : onInk(ROSE, 190),
    // 青族：板上没有青，整族并入猫蓝（实测 --rb-cyan-400 全仓只剩 1 处消费者，--rb-cyan-500 为 0）。
    "--rb-cyan-400": ACCENT_FG,
    "--rb-cyan-500": ACCENT,
    // 语义四色：板上 GREEN=成功、WARN=警告、ROSE_DEEP=危险（猫的红是胭脂红，不是警报红）、
    // ACCENT=信息。深色档一律抬到板上的 *_FG 亮端，压不住深底就等于没画。
    "--rb-danger": light ? ROSE_DEEP : ROSE,
    "--rb-success": light ? GREEN : GREEN_FG,
    "--rb-warning": light ? WARN : WARN_FG,
    "--rb-info": accent,
    // 描边
    "--rb-border-faint": bFaint,
    "--rb-border-soft": bSoft,
    "--rb-border-strong": bStrong,
    "--rb-border-grid": light ? onPaper(ACCENT, 22, WHITE) : onInk(ACCENT_FG, 24),
    "--rb-border-default": bSoft,
    "--rb-border-subtle": bFaint,
    "--rb-border-elevated": bStrong,
    "--rb-border-focus": accent,
    // 组件原语（名字里带 light 的是历史命名，深色档同样要有值）
    "--rb-card-bg": elevated,
    "--rb-divider-light": light ? withAlpha(INK, 0.08) : withAlpha(FG, 0.10),
    "--rb-hover-light": light ? withAlpha(INK, 0.04) : withAlpha(FG, 0.06),
    "--rb-active-light": light ? withAlpha(INK, 0.08) : withAlpha(FG, 0.12),
    "--rb-input-bg": light ? WHITE : withAlpha(FG, 0.06),
    "--rb-input-border": light ? PAPER_SHADE : bStrong,
    "--rb-input-text": strong,
    "--rb-input-placeholder": light ? onPaper(INK_SOFT, 140, WHITE) : onInk(DIM, 180),
    "--rb-slider-track": light ? withAlpha(INK, 0.18) : withAlpha(FG, 0.18),
    "--rb-slider-fill": accent,
    "--rb-slider-thumb": light ? WHITE : FG,
    "--rb-toggle-off": light ? bSoft : withAlpha(FG, 0.18),
    "--rb-toggle-on": accent,
    "--rb-scroll-thumb": light ? withAlpha(INK_SOFT, 0.28) : withAlpha(FG, 0.20),
    "--rb-scroll-thumb-hover": light ? withAlpha(INK_SOFT, 0.44) : withAlpha(FG, 0.32),
    // 光晕 / 阴影：只能差分量（美术契约），所以一律 withAlpha(SHADOW/INK/FG)，不用彩色阴影。
    "--rb-glow-pink": `0 0 20px ${withAlpha(accent, light ? 0.26 : 0.34)}`,
    "--rb-glow-soft": `0 0 12px ${light ? withAlpha(INK, 0.10) : withAlpha(FG, 0.08)}`,
    "--rb-glow-violet": `0 0 24px ${withAlpha(ROSE, light ? 0.16 : 0.24)}`,
    "--rb-glow-secondary": `0 0 18px ${withAlpha(ROSE_DEEP, light ? 0.14 : 0.22)}`,
    "--rb-shadow-card": light
      ? `0 4px 16px ${withAlpha(INK, 0.10)}, 0 1px 2px ${withAlpha(INK, 0.06)}`
      : `0 4px 16px ${withAlpha(SHADOW, 0.35)}, 0 1px 2px ${withAlpha(SHADOW, 0.25)}`,
    "--rb-shadow-elevated": light
      ? `0 12px 40px ${withAlpha(INK, 0.14)}, 0 0 0 1px ${withAlpha(ACCENT, 0.10)}`
      : `0 12px 40px ${withAlpha(SHADOW, 0.55)}, 0 0 0 1px ${withAlpha(ACCENT_FG, 0.10)}`,
    "--rb-shadow-pink": `0 8px 32px ${withAlpha(accent, light ? 0.22 : 0.34)}`,
    "--rb-shadow-workspace": light
      ? `inset 0 2px 8px ${withAlpha(INK, 0.04)}, inset 0 0 2px ${withAlpha(INK, 0.03)}`
      : `0 4px 16px ${withAlpha(SHADOW, 0.35)}, 0 1px 2px ${withAlpha(SHADOW, 0.25)}`,
    "--rb-shadow-bubble-neutral": light
      ? `2px 2px 3px ${withAlpha(INK, 0.06)}, 3px 5px 16px ${withAlpha(INK, 0.06)}`
      : `0 2px 10px ${withAlpha(SHADOW, 0.45)}, 0 0 0 1px ${withAlpha(FG, 0.06)}`,
    "--rb-shadow-bubble-accent":
      `2px 2px 4px ${withAlpha(accent, light ? 0.12 : 0.20)}, ` +
      `3px 7px 16px ${withAlpha(accent, light ? 0.16 : 0.24)}`,
    "--rb-shadow-control-hover": light
      ? `2px 2px 5px ${withAlpha(INK, 0.08)}, 3px 8px 18px ${withAlpha(INK, 0.06)}`
      : `0 12px 40px ${withAlpha(SHADOW, 0.55)}, 0 0 0 1px ${withAlpha(ACCENT_FG, 0.10)}`,
    "--rb-shadow-control-focus":
      `0 0 0 3px ${withAlpha(accent, light ? 0.12 : 0.20)}, ` +
      `2px 6px 16px ${withAlpha(light ? INK : SHADOW, 0.08)}`,
    "--rb-task-card-accent-ring": withAlpha(accent, 0.10),
    // 渐变：端点全在板内，色相不越过「蓝」与「胭脂红」这两族
    "--rb-grad-pink": `linear-gradient(135deg, ${ACCENT} 0%, ${ACCENT_DEEP} 100%)`,
    "--rb-grad-pink-hot": `linear-gradient(135deg, ${ACCENT_FG} 0%, ${ACCENT} 50%, ${ACCENT_DEEP} 100%)`,
    "--rb-grad-bg": light
      ? `radial-gradient(ellipse at top, ${onPaper(ACCENT, 26, PAPER)} 0%, ${PAPER} 60%)`
      : `radial-gradient(ellipse at top, ${onInk(ACCENT_FG, 20)} 0%, ${BG_SOLID} 60%)`,
    // 代码块 / diff：三色从 success/danger/info 推，不抄 GitHub 的现成绿红
    "--rb-code-bg": light ? onPaper(INK, 8, WHITE) : elevated,
    "--rb-diff-bg": light ? onPaper(INK, 4, WHITE) : BG_SOLID,
    "--rb-diff-add-bg": light ? onPaper(GREEN, 30, WHITE) : onInk(GREEN, 44),
    "--rb-diff-add-text": light ? wash(GREEN, 215, INK) : GREEN_FG,
    "--rb-diff-remove-bg": light ? onPaper(ROSE_DEEP, 30, WHITE) : onInk(ROSE_DEEP, 48),
    "--rb-diff-remove-text": light ? wash(ROSE_DEEP, 215, INK) : ROSE,
    "--rb-diff-info-bg": light ? onPaper(ACCENT, 30, WHITE) : onInk(ACCENT, 48),
    "--rb-diff-info-text": light ? wash(ACCENT, 215, INK) : ACCENT_FG,
    // Markdown 渲染变量：只列现在带字面量的；`var()` 形式的跟随上面的角色令牌。
    "--md-code-bg": light ? onPaper(INK, 8, WHITE) : withAlpha(FG, 0.05),
    "--md-code-border": bSoft,
    "--md-inline-code-bg": light ? onPaper(INK, 14, WHITE) : withAlpha(FG, 0.08),
    "--md-inline-code-text": strong,
    "--md-quote-bg": light ? onPaper(ACCENT, 12, WHITE) : withAlpha(ACCENT_FG, 0.06),
    "--md-table-border": bSoft,
    "--md-copy-bg": light ? onPaper(INK, 10, WHITE) : withAlpha(FG, 0.06),
    // 浮层反馈（toast / 弹窗）：两档都是墨底浮层，浅色档用 INK、深色档用抬一格的墨。
    "--rb-feedback-surface": light ? INK : onInk(FG, 14),
    "--rb-feedback-fg": light ? PAPER : FG,
    "--rb-feedback-muted": light ? wash(DIM, 210, INK) : DIM,
    "--rb-feedback-border": light ? withAlpha(ACCENT_FG, 0.28) : withAlpha(FG, 0.14),
    "--rb-feedback-details-bg": withAlpha(FG, 0.06),
    "--rb-feedback-shadow": `0 28px 70px ${withAlpha(SHADOW, light ? 0.28 : 0.38)}`,
    "--rb-feedback-danger": ROSE,
    "--rb-feedback-success": GREEN_FG,
    "--rb-feedback-warning": WARN_FG,
    "--rb-feedback-info": ACCENT_FG,
  };
}

export const LIGHT_TOKENS: TokenMap = build("light");
export const DARK_TOKENS: TokenMap = build("dark");
export const TOKENS_BY_SCHEME: Record<ThemeScheme, TokenMap> = { light: LIGHT_TOKENS, dark: DARK_TOKENS };

/**
 * 主进程给原生窗用的底色。CSS 变量在 `new BrowserWindow()` 那一刻还不存在（渲染进程还没起来），
 * 只能传字符串——这就是色板必须住在 `src/shared/` 的理由（见 Task 17）。
 */
export const WINDOW_BACKGROUNDS: Record<"pearl-white" | "charcoal-pink", string> = {
  "pearl-white": LIGHT_TOKENS["--rb-surface-page"],
  "charcoal-pink": DARK_TOKENS["--rb-surface-page"],
};

/** 按令牌名取值；不在表里就抛——静默返回 undefined 会把「忘了派生」读成「这令牌没颜色」。 */
export function derivedValue(scheme: ThemeScheme, token: string): string {
  const value = TOKENS_BY_SCHEME[scheme][token];
  if (value === undefined) throw new Error(`令牌 ${token} 未派生（scheme=${scheme}）`);
  return value;
}

function channels(color: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (!m) throw new RangeError(`contrastRatio 只接受 #rrggbb，收到 ${color}`);
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

/** WCAG 2.1 相对亮度比。派生器用它自检「文字压在这块底上还剩不剩可读性」。 */
export function contrastRatio(fg: string, bg: string): number {
  const lum = ([r, g, b]: [number, number, number]) => {
    const f = (v: number) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const [a, b] = [lum(channels(fg)), lum(channels(bg))];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
```

> 上面这份表**就是本期选定的配色**，不需要执行者再发明数值。Phase E 的屏幕尺若发现某一档
> 对比度不足或明显不对味，改法固定为「只改 `build()` 里那一行的 α/端点，然后重跑
> `node scripts/build/apply-theme-palette.mjs`」，绝不去 CSS 里手改——否则派生锁会红，
> 而那正是我们要的失败方式。

- [ ] **Step 2: 写派生器的结构自检（不依赖 CSS 文件）**

`src/shared/palette-from-cat.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import {
  DARK_TOKENS, LIGHT_TOKENS, TOKENS_BY_SCHEME, WINDOW_BACKGROUNDS, contrastRatio, derivedValue,
} from "./palette-from-cat";
import { CAT_PALETTE } from "./pet-tokens";

const HEX = /#[0-9a-f]{6}/g;
// 上游品牌时代的色：粉主色、紫端点、材料粉。改名不改值、或漏改某档，就会留下这些。
const BANNED = [/#ff5b8a/i, /#f04b7c/i, /#ec4899/i, /#db2777/i, /#be185d/i, /#9f7aea/i,
  /#b794f4/i, /#7c5fcc/i, /#e91e63/i, /#f88fbc/i, /#ff6ec7/i, /#ff7aa0/i, /#ff9fbd/i];

describe("配色派生器", () => {
  it("两把令牌表键集完全相同（换档不许增减令牌）", () => {
    expect(Object.keys(LIGHT_TOKENS).sort()).toEqual(Object.keys(DARK_TOKENS).sort());
  });

  it("derivedValue 对未派生的令牌抛错，而不是返回 undefined", () => {
    expect(() => derivedValue("light", "--rb-没有这个令牌")).toThrow(/未派生/);
    expect(derivedValue("light", "--rb-accent")).toBe(LIGHT_TOKENS["--rb-accent"]);
  });

  it("每一个 hex 都是合法 6 位小写（`hex()` 的往返结果，不是手抄的大写或 3 位缩写）", () => {
    for (const map of [LIGHT_TOKENS, DARK_TOKENS]) {
      for (const [name, value] of Object.entries(map)) {
        for (const h of value.match(HEX) ?? []) expect(h, name).toBe(h.toLowerCase());
        // 正对照：这张表里确实有裸 hex；若某次改动把全表变成 var()，上面的循环会空过。
      }
      expect(Object.values(map).join(" ").match(HEX)!.length).toBeGreaterThan(40);
    }
  });

  it("没有一处残留上游品牌粉/紫", () => {
    for (const map of [LIGHT_TOKENS, DARK_TOKENS]) {
      for (const [name, value] of Object.entries(map)) {
        for (const re of BANNED) expect(re.test(value), `${name} = ${value}`).toBe(false);
      }
    }
  });

  it("正文压在页底/工作区/浮起底上的对比度都不低于 4.5", () => {
    for (const scheme of ["light", "dark"] as const) {
      const t = TOKENS_BY_SCHEME[scheme];
      for (const base of ["--rb-surface-page", "--rb-surface-workspace", "--rb-surface-elevated"]) {
        expect(contrastRatio(t["--rb-text-primary"], t[base]), `${scheme} ${base}`)
          .toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("次级文字在浮起底上不低于 3:1（图形/次级信息门槛）", () => {
    for (const scheme of ["light", "dark"] as const) {
      const t = TOKENS_BY_SCHEME[scheme];
      expect(contrastRatio(t["--rb-text-secondary"], t["--rb-surface-elevated"]))
        .toBeGreaterThanOrEqual(3);
    }
  });

  it("令牌表里凡是写成裸 hex 的成品色，都必须能在猫色板上找到（预混结果除外由 Task 16 复算）", () => {
    const board = new Set(
      Object.values(CAT_PALETTE).filter((v): v is string => typeof v === "string"),
    );
    // 这一条只查「裸值」档（值里只有一个 hex 的令牌）：它们必须是板内色。
    // 多 hex 的值（gradient/shadow）与 rgba 由 Task 16 的完整锁按算式复算。
    for (const scheme of ["light", "dark"] as const) {
      for (const [name, value] of Object.entries(TOKENS_BY_SCHEME[scheme])) {
        const bare = /^#[0-9a-f]{6}$/.exec(value);
        if (!bare) continue;
        expect(board.has(value), `${scheme} ${name} = ${value}`).toBe(true);
      }
    }
  });

  it("文字色不许等于它要压的底色（防止 on-accent 被推成 accent 本身）", () => {
    for (const scheme of ["light", "dark"] as const) {
      const t = TOKENS_BY_SCHEME[scheme];
      expect(t["--rb-text-on-accent"]).not.toBe(t["--rb-accent"]);
      expect(t["--rb-accent-hover"]).not.toBe(t["--rb-accent"]);
      expect(t["--rb-border-focus"]).toBe(t["--rb-accent"]);
    }
  });

  it("原生窗底色取的是页底令牌而不是工作区，且是合法 #rrggbb", () => {
    expect(WINDOW_BACKGROUNDS["pearl-white"]).toBe(LIGHT_TOKENS["--rb-surface-page"]);
    expect(WINDOW_BACKGROUNDS["charcoal-pink"]).toBe(DARK_TOKENS["--rb-surface-page"]);
    for (const v of Object.values(WINDOW_BACKGROUNDS)) expect(v).toMatch(/^#[0-9a-f]{6}$/);
  });
});
```

- [ ] **Step 3: 跑门 + 提交**

```bash
CI=true npx vitest run src/shared/palette-from-cat.test.ts
```
Expected：先红一次（Step 1 还没写就红在模块不存在，写完就全绿）。对比度那两条如果红，
说明 α 选得过浅/过深——**按 `build()` 里那一行改 α，不许放松阈值**。

```bash
git add src/shared/palette-from-cat.ts src/shared/palette-from-cat.test.ts
git commit -m "feat(palette): 从猫色板派生全客户端 --rb-* 配色的单一来源"
```

---
### Task 15: 回写脚本 + `theme.css` 去重 + 两档落盘（C3）

**Files:**
- Create: `scripts/build/apply-theme-palette.mjs`
- Modify: `src/renderer/ui/theme.css`（第 28–91 行那个 `[data-ui-theme="pearl-white"]` 块：删掉 69 条重名声明，只留 `color-scheme`）
- Modify: `src/renderer/ui/themes/charcoal-pink.css:118-121`（`.cy-command-terminal` 那条 scoped 规则改成 `var()`）
- Modify: `src/renderer/ui/tokens.css`（文件头加命名债注释；`:root` 由脚本换成浅色）
- Modify: `src/renderer/react/styles/react-root.visual.test.ts:25-26`（期望值改为派生结果）
- Modify: `package.json`（`scripts` 里加 `palette:apply` / `palette:check`）

**Interfaces:**
- Consumes: Task 14 的 `TOKENS_BY_SCHEME: Record<"light" | "dark", Record<string, string>>`。
- Produces: 命令行 `node scripts/build/apply-theme-palette.mjs [--check]`；退出码 0=一致/已回写，
  1=`--check` 发现漂移或派生表与 CSS 的令牌集不吻合。Task 16 的派生锁**不**依赖这个脚本，
  它自己再解析一遍 CSS（脚本会写、锁会读，两者独立才叫锁）。

- [ ] **Step 1: 先做 `theme.css` 的去重（这一步必须早于回写）**

理由在阶段 C 开头第 2 条实测：`theme.css:28` 那个块同特异度、源序在后，盖掉 `pearl-white.css`
里重名的声明。不先删，回写完珍珠白主题文件也看不到效果。

实测计数（`awk` 按选择器分组数过，不是估的）：`theme.css` 的 `[data-ui-theme="pearl-white"]`
块里共 **69 条**自定义属性声明（56 条 `--rb-*` + 13 条 `--md-*`），其中 **68 条**与
`pearl-white.css` 重名；唯一不重名的 `--rb-glow-violet` 也不是孤儿——`tokens.css:81` 的 `:root`
里就有它。所以整块删干净是安全的：每条都有下游住户。

做法（**手工编辑，不许用正则批删**——这一步删的是声明而不是值，删错一行少一个令牌）：

1. 删掉 `theme.css` 第 28–91 行块内全部 69 条 `--rb-*` / `--md-*` 声明和它们的分组注释，
   **保留 `color-scheme: light;`** 和那对花括号。删完这块应该只剩一行声明。
   删之前逐条确认：`tokens.css:81` 有 `--rb-glow-violet`、`pearl-white.css` 有 13 条 `--md-*`。
2. 把 `charcoal-pink.css:118-121` 那条 scoped 规则改成引用，不留裸 hex：

```css
[data-ui-theme="charcoal-pink"] .cy-command-terminal {
  --rb-surface-elevated: var(--rb-surface-page);
  background: var(--rb-surface-page);
}
```

   **为什么单挑这一条**：四份主题文件里只有它是「带 class 的选择器内部覆盖令牌」
   （实测：`awk` 扫 scoped 选择器的着色声明，命中就这一行）。它的原值是 `#141414` =
   深色档的**页底**，不是 `--rb-surface-elevated` 的本义（`#252525`）。回写脚本按名字回写，
   会把 `#141414` 换成派生的 elevated——终端底色就从「页底那么深」变成「卡片那么深」，
   而且紧邻的 `background: #141414` 又不是声明式令牌、不会被换，两者会分叉。
   改成 `var(--rb-surface-page)` 既保住原意（终端用页底色），又让 Task 16 的锁能把它
   当间接层豁免。改完这两行仍然受 C5 的棘轮管（`background` 那行不再是字面量）。
3. 块上方的注释补一句去向，别留下「这里以前有 69 行」的空洞：

```css
/* 主题色令牌一律住在 themes/pearl-white.css；这里只留 color-scheme，
   因为同特异度下源序在后，块内任何重名令牌都会盖掉主题文件——历史上就把它盖空过。 */
[data-ui-theme="pearl-white"] {
  color-scheme: light;
}
```

- [ ] **Step 2: 写回写脚本**

```js
// scripts/build/apply-theme-palette.mjs
/**
 * 把 `src/shared/palette-from-cat.ts` 的派生值按令牌名逐条写回四份 CSS。
 *
 * 只改值：不增删声明、不改令牌名、不动不在派生表里的行、不动值是 var()/color-mix() 的行。
 * 为什么不手改：带颜色的声明一共 287 行、去重 104 个名字，手改必然出现
 * 「改了三处漏了第四处」——那正是 native 色板台账立规矩要防的事（palette.rs:1-10）。
 * 为什么不把 CSS 变成生成物：这四份文件里还住着选择器、注释、排版与非色令牌，
 * 让脚本拥有整个文件等于让它决定「这行长什么样」，diff 就没人能审了。
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import esbuild from "esbuild"; // vite 的传递依赖，已在树里；本期不新增依赖

const TARGETS = [
  // 顺序 = 浏览器看到的源序（tokens.css 先 link，theme.css 后 link 且它的 @import 在自己规则之前）
  { file: "src/renderer/ui/tokens.css", scheme: "light" },
  { file: "src/renderer/ui/themes/pearl-white.css", scheme: "light" },
  { file: "src/renderer/ui/themes/charcoal-pink.css", scheme: "dark" },
  { file: "src/renderer/ui/theme.css", scheme: "light" },
];
const CHECK = process.argv.includes("--check");
const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|rgba?\(/;

async function loadDerivation() {
  // esbuild 是 vite 的依赖，能在 Node 里直接把那个 TS 模块打成 ESM 再 import；
  // 产物落 node_modules/.cache（在 D: 上，且已被 gitignore），不写系统 TEMP。
  const outfile = resolve("node_modules/.cache/mochi-palette/palette-from-cat.mjs");
  mkdirSync(dirname(outfile), { recursive: true });
  await esbuild.build({
    entryPoints: [resolve("src/shared/palette-from-cat.ts")],
    bundle: true, format: "esm", platform: "node", outfile, logLevel: "silent",
  });
  return import(pathToFileURL(outfile).href);
}

const DECL = /^(\s*)(--(?:rb|md)-[a-z0-9-]+)(\s*):\s*([^;]*);(.*)$/;

/**
 * 逐行处理并**按原样保留每行的行尾**：本仓库 `core.autocrlf=true` 且历史 blob 里 CRLF/LF 混存，
 * 用 split(/\r?\n/) 再 join("\n") 会把没动的行也统一成 LF，diff 立刻变成「整文件重写」。
 * 所以这里按 "\n" 切，行首 \r 留在行尾，join 回 "\n" 就还是原样。
 */
function rewrite(source, map, file) {
  const seen = new Set();
  const lines = source.split("\n");
  let rewritten = 0;
  const out = lines.map((line) => {
    const m = DECL.exec(line);
    if (!m) return line;
    const [, indent, name, colon, value, tail] = m;
    if (!Object.prototype.hasOwnProperty.call(map, name)) return line; // 不在派生表：一字不动
    seen.add(name);
    if (!COLOR_LITERAL.test(value)) return line; // var()/color-mix() 的间接层是故意的，不拍平
    if (value.trim() === map[name]) return line;
    rewritten += 1;
    return `${indent}${name}${colon}: ${map[name]};${tail}`;
  });
  const missing = Object.keys(map).filter((name) => !seen.has(name) && source.includes(`${name}:`));
  if (missing.length) {
    throw new Error(`${file}: 这些令牌在该文件里出现却没被回写（值形态异常）：${missing.join(", ")}`);
  }
  return { text: out.join("\n"), rewritten };
}

const { TOKENS_BY_SCHEME } = await loadDerivation();
let failed = false;
for (const { file, scheme } of TARGETS) {
  const path = resolve(file);
  const before = readFileSync(path, "utf8");
  const { text, rewritten } = rewrite(before, TOKENS_BY_SCHEME[scheme], file);
  if (CHECK) {
    if (rewritten) {
      failed = true;
      console.error(`漂移：${file} 有 ${rewritten} 条值不等于派生结果（跑 npm run palette:apply）`);
    }
    continue;
  }
  if (rewritten) writeFileSync(path, text, "utf8");
  console.log(`${file}: 回写 ${rewritten} 条（scheme=${scheme}）`);
}
process.exit(failed ? 1 : 0);
```

- [ ] **Step 3: 挂进 `package.json`**

```json
"palette:apply": "node scripts/build/apply-theme-palette.mjs",
"palette:check": "node scripts/build/apply-theme-palette.mjs --check",
```

> `palette:check` 本期**不**接进 `verify`/CI 的总门：它依赖 esbuild 现编，而 `build` 脚本在
> 某些装机上是跳过的（P1 实测过「构建可整体跳过 Rust」那条）。它先作为显式命令存在，
> Task 16 的派生锁才是常驻门——锁不依赖这个脚本，这正是把它们分成两个东西的原因。

- [ ] **Step 4: 跑回写，看它到底改了多少**

```bash
node scripts/build/apply-theme-palette.mjs
git diff --stat src/renderer/ui
```
Expected：四个文件都被写到。以「带色字面量的令牌声明行数」为上限核对（实测值）：
`tokens.css` 69、`pearl-white.css` 87、`charcoal-pink.css` 85、`theme.css` ≤9
（Step 1 删掉珍珠块后它只剩 `:root` 里 12 条 `--rb-feedback-*`，其中 9 条带色）。
脚本只写「值与派生结果不同」的行，所以实际数应略低于上限；差太多（比如某文件只动了 3 行）
就是派生表的名字跟 CSS 对不上，当场查，别继续。
**`git diff --numstat` 里每个文件的新增行数必须约等于删除行数**——如果变成「整文件 +287 −287」，
说明行尾被统一了（Step 2 注释里那条坑），当场修脚本，别提交。

- [ ] **Step 5: 更新被这次改动打红的视觉测试期望值**

`src/renderer/react/styles/react-root.visual.test.ts:25-26` 断言的是硬编码色值，
现在必须换成派生结果。不要手写十六进制去凑——把那两行换成从派生器取：

```ts
import { LIGHT_TOKENS } from "../../../shared/palette-from-cat";
// ...
expect(rootStyle.getPropertyValue("--rb-surface-page").trim()).toBe(LIGHT_TOKENS["--rb-surface-page"]);
expect(rootStyle.getPropertyValue("--rb-surface-workspace").trim())
  .toBe(LIGHT_TOKENS["--rb-surface-workspace"]);
```

> 这条改动的正当性要说清楚：这个测试的 JSDOM fixture 顺序是 `tokens.css → react-root.css →
> pearl-white.css`，**不含 `theme.css`**。Step 1 删掉 theme.css 的珍珠块之后，fixture 的层叠
> 结果才第一次等于真实应用的层叠结果——改之前它其实一直在测一份被覆盖的配置。
> 这是把期望值交给派生器的真正理由，不是「测试碍事就顺着测试改」。

- [ ] **Step 6: 跑门 + 提交**

```bash
CI=true npx vitest run src/renderer/react/styles src/shared src/renderer/pet
npx tsc -p tsconfig.renderer.json --noEmit
```
Expected：全绿。`theme-token-contract.test.ts` 也应绿——它只断言令牌名存在（`toContain("--rb-x:")`），
不碰值；Step 1 没删任何名字（69 条各有下游住户），只把 68 条声明从「覆盖者」挪回「被覆盖者」。

```bash
git add scripts/build/apply-theme-palette.mjs package.json src/renderer/ui src/renderer/react/styles
git commit -m "feat(theme): 全客户端配色改为从猫色板派生（两档一并落盘，去掉 theme.css 的覆盖块）"
```

> 提交正文必须写：① `tokens.css` 的 `:root` 现在落的是**浅色**，因为 `normalizeUiTheme()`
> 与 `theme.ts:34` 的兜底都是 `pearl-white`，默认段该跟兜底主题一致，顺带去掉启动瞬间的深→浅闪；
> ② `--rb-pink-*` 的值现在是猫蓝，名字保留是 spec §1 M3 的裁决，命名债记在 `tokens.css` 文件头；
> ③ `theme.css` 删的 69 条同名声明不是精简，是「不删则主题文件的改动不生效」；
> ④ `charcoal-pink.css` 的终端 scoped 覆盖改成 `var(--rb-surface-page)` 是为了让「按名字回写」
> 不发生语义漂移（详见 Step 1 第 2 条）。

- [ ] **Step 7: 补 `tokens.css` 文件头的命名债注释**

在 `:root` 之前加：

```css
/* 命名债（spec §1 M3）：--rb-pink-* / --rb-text-on-pink / --rb-grad-pink / --rb-glow-pink
   这些名字里的 pink 是上游品牌时代留下的，值已由 src/shared/palette-from-cat.ts 派生成
   猫蓝（ACCENT #5b8def）。改名要打爆上千处引用与 25-token 契约，本期明确不做；
   读代码时把 pink 读成「强调色」即可。要改配色请改派生器，别改这里——改了会被派生锁打回。 */
```

---

### Task 16: 派生锁 + 变异检查（C3 的门）

**Files:**
- Create: `src/renderer/ui/theme-palette-derivation.test.ts`

**Interfaces:**
- Consumes: Task 14 的 `TOKENS_BY_SCHEME`、`derivedValue()`。
- Produces: 常驻门 `src/renderer/ui/theme-palette-derivation.test.ts`——C 期之后任何人往这四份
  CSS 里手写一个颜色字面量，它当场红。

- [ ] **Step 1: 先写会红的派生锁**

```ts
/**
 * 派生锁：CSS 里每一个**还在直接着色的** `--rb-*` / `--md-*` 值，都必须等于
 * `src/shared/palette-from-cat.ts` 算出来的那一个。
 *
 * 两条互补的断言，缺一条就是漏的：
 * - 正向：表里的每个令牌，若在 CSS 里以字面量出现，值必须相等（防止有人手改 CSS 里的一个色）。
 * - 反向：CSS 里以字面量出现的每个令牌，必须在表里（防止有人**新写**一个没派生的色）。
 *
 * `var()` / `color-mix()` 形态的声明两条都豁免——那是故意的间接层（跟着角色令牌自动跟变），
 * 拍平它反而丢掉「改一处跟三处」。
 *
 * 层叠是这里最容易看错的东西：同一个令牌名现在在四个文件里各写一遍，而入口 HTML 的 link
 * 顺序 + `theme.css` 自己的 @import 决定了「谁最后写的谁生效」。所以这个测试不是逐文件断言，
 * 而是按真实源序解析后再断言生效值——不然它测的是「每个文件单独看着对」。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TOKENS_BY_SCHEME } from "../../shared/palette-from-cat";

/** 真实源序：`ui/tokens.css` 先 link，`ui/theme.css` 后 link，而 theme.css 的 @import 在它自己规则之前。 */
const SOURCES = [
  "ui/tokens.css",
  "ui/themes/pearl-white.css",
  "ui/themes/charcoal-pink.css",
  "ui/theme.css",
] as const;

const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|rgba?\(/;

interface Decl { name: string; value: string; selector: string }

/**
 * 行级扫描。这四份主题文件是平铺的（没有 CSS 嵌套、没有一行两声明），
 * 所以一旦出现「同一行里既有 `{` 又有 `}`」或花括号不配对，就抛错而不是猜——
 * 尺自己崩了不许读成 PASS（验收三层尺纪律）。
 */
function collectDecls(css: string, label: string): Decl[] {
  const out: Decl[] = [];
  let selector = "";
  let depth = 0;
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const line of stripped.split("\n")) {
    const text = line.replace(/\r$/, "");
    const opens = (text.match(/\{/g) ?? []).length;
    const closes = (text.match(/\}/g) ?? []).length;
    if (opens && closes && text.trim() !== "}") {
      throw new Error(`${label}: 不支持的单行块，请把这一行拆开：${text.trim()}`);
    }
    if (opens) {
      selector = text.slice(0, text.indexOf("{")).trim();
      depth += opens;
      continue;
    }
    if (closes) {
      depth -= closes;
      if (depth < 0) throw new Error(`${label}: 花括号不配对`);
      if (depth === 0) selector = "";
      continue;
    }
    const m = /^\s*(--(?:rb|md)-[a-z0-9-]+)\s*:\s*([^;]+);/.exec(text);
    if (m && depth > 0) out.push({ name: m[1], value: m[2].trim(), selector });
  }
  if (depth !== 0) throw new Error(`${label}: 文件结束时仍处在 ${depth} 层块内`);
  return out;
}

/**
 * 按真实层叠算出生效值：同特异度 → 源序在后者的那条赢，所以直接「后者覆盖前者」。
 *
 * 选择器要**整串相等**才算主题级：`includes('data-ui-theme="charcoal-pink"')` 会把
 * `[data-ui-theme="charcoal-pink"] .cy-command-terminal` 这种 scoped 覆盖也当成主题级，
 * 于是它（源序在后）盖掉真正的主题值——正向那条会因「值不含色面字面量」被豁免，
 * 结果就是**这个令牌在深色档彻底没人管**。Task 15 Step 1 已把那条 scoped 规则改成 `var()`，
 * 但锁不能依赖「CSS 恰好没有 scoped 覆盖」这个前提，它自己必须只认主题级。
 *
 * 四份文件实测无 `@media`（`grep -c` 全 0），所以行级扫描不处理条件块是安全的；
 * 若将来引入 `@media`，选择器串会变成 `@media …`，这些声明会落到「不在主题级」里被漏掉——
 * 到时候要改这个解析器，而不是放松断言。
 */
function effective(scheme: "light" | "dark"): Map<string, string> {
  const wanted = scheme === "light" ? "pearl-white" : "charcoal-pink";
  const map = new Map<string, string>();
  for (const file of SOURCES) {
    const css = readFileSync(resolve(__dirname, "..", file), "utf8");
    for (const d of collectDecls(css, file)) {
      const isDefault = d.selector === ":root";
      const isTheme = d.selector === `[data-ui-theme="${wanted}"]`;
      if (!isDefault && !isTheme) continue;
      map.set(d.name, d.value);
    }
  }
  return map;
}

describe("配色派生锁", () => {
  const light = effective("light");
  const dark = effective("dark");

  it("两档都解析出了 100 个以上令牌，且两档的页底不同（正对照：解析器真的在干活）", () => {
    expect(light.size).toBeGreaterThan(100);
    expect(dark.size).toBeGreaterThan(100);
    expect(light.get("--rb-surface-page")).not.toBe(dark.get("--rb-surface-page"));
    // 若 collectDecls 的选择器判断失效，这里会是「一个都没收到」→ 上面两条先红。
  });

  for (const scheme of ["light", "dark"] as const) {
    it(`${scheme}：表里的令牌若在 CSS 里是字面量，值必须等于派生结果`, () => {
      const eff = scheme === "light" ? light : dark;
      const bad: string[] = [];
      for (const [name, derived] of Object.entries(TOKENS_BY_SCHEME[scheme])) {
        const current = eff.get(name);
        if (current === undefined) continue; // 该档确实没声明这个令牌（theme.css 的珍珠块已删）
        if (!COLOR_LITERAL.test(current)) continue; // var()/color-mix()：故意的间接层
        if (current !== derived) bad.push(`${name}: 生效=${current} 派生=${derived}`);
      }
      expect(bad, `${scheme} 有 ${bad.length} 条与派生结果不一致\n${bad.join("\n")}`).toEqual([]);
    });
  }

  it("反向：CSS 里以字面量出现的着色令牌，必须都在派生表里", () => {
    const orphans: string[] = [];
    for (const [scheme, eff] of [["light", light], ["dark", dark]] as const) {
      for (const [name, value] of eff) {
        if (!COLOR_LITERAL.test(value)) continue;
        if (TOKENS_BY_SCHEME[scheme][name] === undefined) orphans.push(`${scheme} ${name} = ${value}`);
      }
    }
    // 白名单：确有不参与派生的着色令牌时，在这里加条目并写明理由；空表是本期目标。
    const WHITELIST: string[] = [];
    expect(orphans.filter((o) => !WHITELIST.some((w) => o.startsWith(w)))).toEqual([]);
  });

  it("没有任何主题文件留着上游品牌粉/紫的字面量", () => {
    const banned = [/#ff5b8a/i, /#f04b7c/i, /#ec4899/i, /#db2777/i, /#be185d/i, /#9f7aea/i,
      /#b794f4/i, /#7c5fcc/i, /#e91e63/i, /#f88fbc/i, /#ff6ec7/i, /#ff7aa0/i, /#ff9fbd/i,
      /#221c46/i, /#181432/i, /#08070f/i, /#fef7ff/i, /#a094c1/i];
    const hits: string[] = [];
    for (const [scheme, eff] of [["light", light], ["dark", dark]] as const) {
      for (const [name, value] of eff) {
        for (const re of banned) if (re.test(value)) hits.push(`${scheme} ${name} = ${value}`);
      }
    }
    expect(hits, hits.join("\n")).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑锁（此时应当已经是绿的）**

```bash
CI=true npx vitest run src/renderer/ui
```
Expected：四条全绿。绿的理由必须是「Task 15 Step 4 把两档都回写过了」，不是「断言没生效」——
下一条 Step 就是去证明它有效。如果这一步就红，**不要放松断言**，按报出来的那条回 Task 15：
反向红 = 有令牌没进派生表（补 Task 14）；正向红 = 回写没落到生效的那份文件（十有八九是
`theme.css` 的珍珠块又写回东西了，或 scoped 覆盖被当成主题级）。

- [ ] **Step 3: 变异检查——证明这把尺真的会红**

一把一次就绿的锁，跟一把根本没跑的锁看起来一样。用两个故意做坏的值确认四条各自有牙，
每次只改一行、跑完立刻还原（`git diff` 必须是空的才继续）：

```bash
# 3a 正向：把浅色页底临时改回**这次改造前的原值** #ECECEE
#   （回写之后它已经是派生值了，所以这一改就是「有人手改了一个色」的准确模拟）
#   src/renderer/ui/themes/pearl-white.css:3  --rb-surface-page: #ECECEE;
CI=true npx vitest run src/renderer/ui/theme-palette-derivation
# Expected：light 那条红，报错行点名 --rb-surface-page 并打印「生效=… 派生=…」。
git checkout -- src/renderer/ui/themes/pearl-white.css

# 3b 反向：临时新增一个不派生的着色令牌
#   在 pearl-white.css 的主题级块里加一行 --rb-mochi-probe: #123456;
CI=true npx vitest run src/renderer/ui/theme-palette-derivation
# Expected：反向那条红，报出 light --rb-mochi-probe = #123456。
git checkout -- src/renderer/ui/themes/pearl-white.css

# 3c 禁用色：把任意一个着色令牌临时换成上游粉 #e91e63
CI=true npx vitest run src/renderer/ui/theme-palette-derivation
# Expected：禁用色那条红（正向也会一起红，这是对的——它同时不等于派生值）。
git checkout -- src/renderer/ui/themes/pearl-white.css
git status --porcelain   # Expected：只剩 theme-palette-derivation.test.ts
```

> 这一步是本期的验收之一：**没有变异检查的锁不算交付**。native 那边「尺自己崩了不许读成 PASS」
> 的教训就是这么来的（验收三层尺纪律）。三条里任何一条没红，就是解析器或断言漏了，
> 当场修锁、重跑三条，别把「绿」当成通过。

- [ ] **Step 4: 复跑全套门 + 漂移自检**

```bash
npm run palette:check
CI=true npx vitest run src/renderer/ui src/shared src/renderer/react/styles src/renderer/pet
npx tsc -p tsconfig.renderer.json --noEmit
```
Expected：`palette:check` 退出码 0（四份文件零漂移）；派生锁四条全绿；正向表里 104 个令牌，
两档凡以字面量出现者逐一相等。

- [ ] **Step 5: 提交**

```bash
git add src/renderer/ui/theme-palette-derivation.test.ts
git commit -m "test(theme): 派生锁——着色令牌只能来自猫色板的派生结果"
```

> 这是 C 期真正的交付物：前两期的改动让屏幕变成猫色，这一把让**以后**改不回上游色。
> `WHITELIST` 保持为空是本期验收项；Phase E 屏幕尺若要求某个不在板上的色，
> 必须先进派生器（并写明它由板上哪两个色推出），再落 CSS。

---
### Task 17: 原生窗口底色改读派生值（C4）

**Files:**
- Modify: `src/main/windows/create-aux-windows.ts:61`（工作区窗）、`:145`（欢迎窗）
- Modify: `src/main/windows/window-system-ipc.ts:102`（`chrome://gpu` 窗——原来根本没有 `backgroundColor`，是「新增」不是「改读」）
- Modify: `src/main/windows/create-aux-windows.test.ts:126-131`
- Modify: `src/main/windows/window-system-ipc.test.ts`（补 mock 的 options 捕获 + 一条断言）
- Test: `src/main/windows/create-aux-windows.test.ts`（同文件新增一条）

**Interfaces:**
- Consumes: Task 14 的 `WINDOW_BACKGROUNDS: Record<UiTheme, string>` 与 `derivedValue()`。
- Produces: 无新接口。这一 task 是把 C 期「唯一来源」的第三条腿接上：CSS 面（Task 15）、
  锁面（Task 16）、**原生面**（本 task）。`BrowserWindow` 的底色不是 CSS，派生锁看不见它，
  所以它必须由主进程直接读同一个模块——这正是 Task 13 把色板搬进 `src/shared/` 的那条理由。

- [ ] **Step 1: 先写两条会红的断言**

`src/main/windows/create-aux-windows.test.ts` 里现在这条（`:126-131`）断言的是硬编码 `#141414`：

```ts
  it("uses the current system appearance for the workspace background", () => {
    mocks.themeChoice = "system";
    mocks.systemDark = true;
    createReactChatWindowShell();
    expect(lastBrowserWindowOptions().backgroundColor).toBe("#141414");
  });
```

把它**替换**成读派生表的版本，并补一条浅色档 + 一条「两档必须不同」的正对照
（正对照的作用：万一哪天 `WINDOW_BACKGROUNDS` 被写成同一个值，两条断言会同时绿，
只有这条会红）：

```ts
import { WINDOW_BACKGROUNDS } from "../../shared/palette-from-cat";

  it("工作区窗底色等于派生表，而不是主进程里自己写死的值", () => {
    mocks.themeChoice = "system";
    mocks.systemDark = true;
    createReactChatWindowShell();
    expect(lastBrowserWindowOptions().backgroundColor).toBe(WINDOW_BACKGROUNDS["charcoal-pink"]);

    mocks.systemDark = false;
    mocks.browserWindowOptions.length = 0;
    createReactChatWindowShell();
    expect(lastBrowserWindowOptions().backgroundColor).toBe(WINDOW_BACKGROUNDS["pearl-white"]);
  });

  it("正对照：两档窗口底色确实不同（否则说明派生表被写成一个值了）", () => {
    expect(WINDOW_BACKGROUNDS["pearl-white"]).not.toBe(WINDOW_BACKGROUNDS["charcoal-pink"]);
  });
```

再给欢迎窗补一条。它现在根本没有测试覆盖，所以先找到该文件里已有的
`createOnboardingBrowserWindow` 调用（`grep -n "createOnboardingBrowserWindow" src/main/windows/create-aux-windows.test.ts`）；
若一处也没有，就新增一条：

```ts
  it("欢迎窗底色跟随派生表（原来是写死的 #fff8fb）", () => {
    createOnboardingBrowserWindow();
    expect(mocks.browserWindowOptions.at(-1)?.backgroundColor)
      .toBe(WINDOW_BACKGROUNDS["pearl-white"]);
  });
```

> 欢迎窗**不**跟系统外观走是有意的：它只在首次启动出现，此时 `uiTheme` 还没被用户碰过，
> 兜底就是 `pearl-white`（`renderer/ui/theme.ts:34` 的 `.catch()` 与 `normalizeUiTheme()` 都是这条兜底）。
> 所以这里直接取浅色档，别顺手改成 `getEffectiveUiTheme()`——那会让首启窗口的颜色
> 取决于 OS 深色设置，而首启引导的截图与 Phase E 的屏幕尺都按浅色拍。

```bash
CI=true npx vitest run src/main/windows/create-aux-windows.test.ts
```
Expected：新增两条红（`#141414` ≠ `WINDOW_BACKGROUNDS["charcoal-pink"]`，`#fff8fb` ≠ 浅色派生值）。
如果第一条没红，说明回写后的深色页底恰好还是 `#141414`——那就是 Task 14 的 `page` 算错了，当场查。

- [ ] **Step 2: 改两处实现**

`src/main/windows/create-aux-windows.ts`：

```ts
import { WINDOW_BACKGROUNDS } from "../../shared/palette-from-cat";
```

`:61` 原来是：

```ts
  const windowBackgroundColor = getEffectiveUiTheme(uiTheme) === "charcoal-pink" ? "#141414" : "#fff8fb";
```

换成：

```ts
  // 非透明窗口：底色跟随主题，避免暗色主题启动瞬间闪白。
  // 值来自 src/shared/palette-from-cat.ts——渲染侧的 CSS 与这里的原生底色必须是同一次派生，
  // 否则「窗口底色」和「页面底色」会是两只猫的两张纸。
  const windowBackgroundColor = WINDOW_BACKGROUNDS[getEffectiveUiTheme(uiTheme)];
```

`:145` 欢迎窗原来是 `backgroundColor: "#fff8fb",`，换成：

```ts
    backgroundColor: WINDOW_BACKGROUNDS["pearl-white"],
```

> 这两处的**旧值都不在色板上**：`#141414` 恰好等于改造前的深色页底（所以看起来"对"），
> `#fff8fb` 是谁也没认领过的一支粉白。换掉之后 `#141414` 也一起消失——
> 改造后深色页底不再是它（见 `charcoal-pink.css:5`）。改完 `grep -rn "#141414\|#fff8fb" src/`
> 应该只剩 Task 15 已处理过的 CSS 侧，主进程里一个不剩。

- [ ] **Step 3: 第三处：`chrome://gpu` 窗补上底色（spec C4 点名的「新增」处）**

`src/main/windows/window-system-ipc.ts:102` 现在是：

```ts
    const win = new BrowserWindow({ width: 1024, height: 768 });
```

没有 `backgroundColor`，Electron 默认白。`chrome://gpu` 本身是浅色页，所以这里不跟系统外观走，
直接用派生表里的浅色档（与欢迎窗同一个理由：这扇窗没有主题语境，首帧必须是纸色）：

```ts
import { WINDOW_BACKGROUNDS } from "../../shared/palette-from-cat";
// …
    const win = new BrowserWindow({
      width: 1024,
      height: 768,
      // chrome://gpu 是 Chromium 自绘的浅色页；这里仍取派生值而不是留空，
      // 否则暗色主题下会先闪一块 Electron 默认白（C4 的第三处原生面）。
      backgroundColor: WINDOW_BACKGROUNDS["pearl-white"],
    });
```

先让测试能看见 options。`src/main/windows/window-system-ipc.test.ts` 顶部的 `vi.mock` 工厂是提升的，
不能直接闭包外层 `const`，用 `vi.hoisted`：

```ts
const { browserWindowOptions } = vi.hoisted(() => ({ browserWindowOptions: [] as unknown[] }));

vi.mock("electron", () => ({
  app: { getAppPath: () => "/app" },
  ipcMain: { on: vi.fn(), handle: vi.fn(), removeHandler: vi.fn(), removeListener: vi.fn() },
  BrowserWindow: class {
    loadURL = vi.fn();
    show = vi.fn();
    constructor(options?: unknown) {
      browserWindowOptions.push(options);
    }
  },
}));
```

把 `setup()` 的返回值加一个 `fire`（它已经持有 `listeners`）：

```ts
  return {
    send: (payload: unknown) => resizeListener({}, payload),
    setPetWindowBounds: windowManager.setPetWindowBounds as ReturnType<typeof vi.fn>,
    fire: (channel: string) => listeners.get(channel)?.({}),
  };
```

再追加一条断言（正对照是 `not.toBeUndefined()`——它同时证明那扇窗真的被构造了）：

```ts
it("chrome://gpu 窗带派生浅色底（C4 的第三处：此前是 Electron 默认白）", () => {
  const { fire } = setup();
  fire(IPC.SETTINGS_OPEN_CHROME_GPU);
  const opts = browserWindowOptions.at(-1) as { backgroundColor?: string };
  expect(opts?.backgroundColor).not.toBeUndefined();
  expect(opts?.backgroundColor).toBe(WINDOW_BACKGROUNDS["pearl-white"]);
});
```

- [ ] **Step 4: 确认其余窗口的 `#00000000` 不动**

`create-aux-windows.ts:206`、`:281`、`create-music-player-window.ts:38`、`create-toast-window.ts:34`
这四处是 `backgroundColor: "#00000000"`。它们是**透明窗**的「全透明底色」哨兵值（alpha=0），
留着。要在提交正文里写这一句，否则下一个 reviewer 会以为漏扫了。

- [ ] **Step 5: 跑门 + 提交**

```bash
CI=true npx vitest run src/main/windows src/shared
npx tsc -p tsconfig.main.json --noEmit
```
Expected：全绿（`create-aux-windows.test.ts` 其余断言不受影响——它们看的是 bounds/name/icon）。

```bash
git add src/main/windows/create-aux-windows.ts src/main/windows/create-aux-windows.test.ts \
  src/main/windows/window-system-ipc.ts src/main/windows/window-system-ipc.test.ts
git commit -m "fix(main): 原生窗口底色改读猫色板派生值，不再自己写死 #141414/#fff8fb"
```

---

## 阶段 C5：把上游品牌色从模块 CSS 里清出去（Task 18–19）

C3/C4 管的是**令牌面**；但屏幕上还有一整片不经过令牌的着色：72 个模块 CSS 里
**1073 行带颜色字面量**。实测普查（`find src -name '*.css'` 去掉那四份主题文件，
按行扫 `#hex` 与 `rgb()/rgba()`，用 HSV 判色相）：

| 分类 | 不同值 | 出现次数 | 说明 |
| --- | --- | --- | --- |
| 上游粉/洋红 | 50 | 293 | `#ff5b8a` 一个值就 175 次（含 `rgb(255,91,138)` 的 47 次写法） |
| 上游紫 | 24 | 47 | 含紫调近黑面（`#19161f` 6 次、`#4c3762` 4 次）——就是 `tokens.css` 里 `#08070f/#181432/#221c46` 那一族 |
| 红 | 26 | 54 | **必须逐条裁决**：`#e81123` 是 Windows 关闭按钮、`#ff5f57` 是 macOS 灯，`#ef4444/#e5484d/#d4384d` 是我们的 danger |
| 合计 | 100 个值 / 110 种写法 | 394 次 / 348 行 / 43 个文件 | |

两条从实测里长出来的裁决，决定了 C5 的形状：

1. **不做「全量去字面量」。** 1073 行里另外 725 行是中性灰白（`#fff` 85 次、`#1d1d1f` 38 次、
   `#8e8e93` 35 次…）。把它们按「值最接近哪个派生色」批量换成 `var()` 会**静默弄坏深色模式**：
   `background: #fff` 在浅色档映射到 `--rb-surface-elevated` 是对的，在深色档会变成 `#252525`，
   而这条规则原本可能写在 `[data-ui-theme="pearl-white"]` 之外的通用选择器里。
   本仓库对模块 CSS 没有像素尺（Phase E 的屏幕尺只覆盖宠物窗与两个主题的关键界面），
   **没有尺的大规模改动不算改造，算赌博**。所以中性色留给棘轮压着（只准减不准增），
   品牌色（粉/紫）才是这一期的靶子——它们是「这是 Cyrene 不是 Mochi」的视觉身份所在。
2. **不能用「色相窗口」当判据。** 猫的色板里 `ROSE #f27d92` 本来就是粉（耳朵内侧与腮红），
   任何「粉色系一律禁止」的规则会把自家色板判成违规。判据只能是**值枚举**：
   一份提交进仓库的迁移表，逐值写明「换成哪个令牌」或「为什么保留」。

### Task 18: 分类器 + 迁移表 + 品牌色锁（先红）

**Files:**
- Create: `src/shared/color-roles.ts`（纯函数，脚本与测试共用）
- Create: `src/shared/color-roles.test.ts`
- Create: `scripts/build/inventory-brand-colors.mjs`（普查 + 生成迁移表草案）
- Create: `scripts/build/color-migration.json`（**人工裁决后的表**，提交进仓库）
- Create: `src/renderer/ui/brand-color-migration.test.ts`（锁）

**Interfaces:**
- Consumes: Task 14 的 `TOKENS_BY_SCHEME`（锁用它校验「表里的令牌真的存在」）。
- Produces: `classifyBrand(text): BrandFamily | null`、`proposeToken(c): string | "needsReview"`、
  `scanColorLiterals(css: string): LiteralHit[]`（`color-roles.ts`）；
  `scripts/build/color-migration.json` 的形态：
  `{ "<写法>": { "token": "--rb-accent" } | { "keep": true, "reason": "…" } }`。
  Task 19 的回写脚本只消费这张表。

- [ ] **Step 1: 写分类器与它的测试**

`src/shared/color-roles.ts`：

```ts
/**
 * 模块 CSS 里「哪些字面量带着上游品牌身份」的唯一判据。
 *
 * 为什么是值枚举而不是色相窗口：猫自己的色板里有 ROSE #f27d92（耳廓与腮红），
 * 任何「粉一律禁止」的规则会把自家色板判成违规；而 `#e81123` 是 Windows 关闭按钮、
 * `#ff5f57` 是 macOS 交通灯，它们必须留下。所以这里只做**分类**，裁决住在
 * `scripts/build/color-migration.json` 里，人写、提交、由锁逐条核对。
 */
export type BrandFamily = "pink" | "violet" | "red";

export interface LiteralHit {
  /** 文件里原样的写法，保留大小写与空白（回写按它做精确替换）。 */
  text: string;
  family: BrandFamily;
  line: number;
  property: string;
}

const HEX = /#([0-9a-fA-F]{3,8})\b(?![-0-9a-zA-Z])/g;
const FUNC = /\brgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,[^)]*)?\)/g;

/** `url(#fade)` 里的 `#fade` 四个字符全是合法 hex，会被 HEX 命中——所以要先排掉 url()。 */
function isCssValueContext(line: string, index: number): boolean {
  if (line.slice(Math.max(0, index - 4), index + 1).includes("url(")) return false;
  const before = line[index - 1];
  return before === undefined || /[\s(:,]/.test(before);
}

function hsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const rr = r / 255, gg = g / 255, bb = b / 255;
  const max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rr) h = ((gg - bb) / d) % 6;
    else if (max === gg) h = (bb - rr) / d + 2;
    else h = (rr - gg) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

/**
 * 窗口按上游品牌定：
 * - pink：h ∈ [300, 345)（洋红到品牌粉；`#ff5b8a` h=340）
 * - violet：h ∈ [250, 300)（`#c9a7f5`、紫调近黑 `#19161f`）
 * - red：h ∈ [345, 360) ∪ [0, 12)（danger 与 OS 灯都在这一带，交给表去裁决）
 * s ≥ 0.15 才认：低于它的 `#fff1f6` 这类极淡洗色在屏幕上已经不读作品牌粉，
 * 而且深色/浅色两侧都会踩线，判进锁只会逼出无意义的白名单。
 */
export function classifyRgb(r: number, g: number, b: number): BrandFamily | null {
  const { h, s } = hsv(r, g, b);
  if (s < 0.15) return null;
  if (h >= 300 && h < 345) return "pink";
  if (h >= 250 && h < 300) return "violet";
  if (h >= 345 || h < 12) return "red";
  return null;
}

export function scanColorLiterals(css: string): LiteralHit[] {
  const out: LiteralHit[] = [];
  const lines = css.split("\n");
  let property = "";
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i].replace(/\r$/, "");
    const pm = /^\s*([a-z-]+)\s*:/i.exec(raw);
    if (pm) property = pm[1].toLowerCase();
    for (const m of raw.matchAll(HEX)) {
      if (!isCssValueContext(raw, m.index!)) continue;
      let x = m[1];
      if (x.length === 3 || x.length === 4) x = x.slice(0, 3).split("").map((c) => c + c).join("");
      else if (x.length === 8) x = x.slice(0, 6);
      else if (x.length !== 6) continue;
      const fam = classifyRgb(parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16));
      if (fam) out.push({ text: m[0], family: fam, line: i + 1, property });
    }
    for (const m of raw.matchAll(FUNC)) {
      if (!isCssValueContext(raw, m.index!)) continue;
      const fam = classifyRgb(+m[1], +m[2], +m[3]);
      if (fam) out.push({ text: m[0], family: fam, line: i + 1, property });
    }
  }
  return out;
}

const SURFACE_PROPS = /^(background|background-color|border|border-.*-color|box-shadow|fill|outline)/;

/**
 * 建议值。**只是建议**：红族一律返回 `needsReview`，因为「这个红是 danger 还是窗口关闭键」
 * 必须看上下文，机器判错的成本是屏幕上一个小方块变成猫蓝。
 * 粉/紫按明度分档：淡的当洗色、中的当强调、深的当按下态/文字。
 * 紫调近黑（v < 0.25）是**面**不是**强调**，按属性分给面/墨。
 */
export function proposeToken(hit: LiteralHit): string {
  if (hit.family === "red") return "needsReview";
  const rgb = toRgb(hit.text);
  const { s, v } = hsv(rgb[0], rgb[1], rgb[2]);
  if (hit.family === "violet" && v < 0.25) {
    return SURFACE_PROPS.test(hit.property) ? "--rb-surface-elevated" : "--rb-text-primary";
  }
  if (v >= 0.9 && s < 0.45) return "--rb-pink-50";
  if (v >= 0.78) return "--rb-pink-100";
  if (v >= 0.55) return "--rb-accent";
  return "--rb-pink-700";
}

export function toRgb(text: string): [number, number, number] {
  if (text.startsWith("#")) {
    let x = text.slice(1);
    if (x.length === 3) x = x.split("").map((c) => c + c).join("");
    if (x.length === 8) x = x.slice(0, 6);
    if (x.length !== 6) throw new RangeError(`不是可用的 hex：${text}`);
    return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16)];
  }
  const m = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(text);
  if (!m) throw new RangeError(`不是可用的 rgb()：${text}`);
  return [+m[1], +m[2], +m[3]];
}
```

`src/shared/color-roles.test.ts`——**正对照放第一条**，这把尺要是死了，后面全绿也是假的：

```ts
import { describe, expect, it } from "vitest";
import { classifyRgb, proposeToken, scanColorLiterals } from "./color-roles";

describe("品牌色分类器", () => {
  it("正对照：一段明知有粉的 CSS 必须被扫出 3 处，且行号与属性都对", () => {
    const css = [
      ".a { color: #ff5b8a; }",
      ".b { background: rgb(255, 91, 138); }",
      ".c { border-color: #c9a7f5; }",
    ].join("\n");
    const hits = scanColorLiterals(css);
    expect(hits.map((h) => [h.line, h.property, h.family]))
      .toEqual([[1, "color", "pink"], [2, "background", "pink"], [3, "border-color", "violet"]]);
  });

  it("分类：上游粉/紫/红各自入位，中性与自家色不入位", () => {
    expect(classifyRgb(255, 91, 138)).toBe("pink");   // #ff5b8a 上游强调
    expect(classifyRgb(233, 30, 99)).toBe("pink");    // #e91e63 material 粉（surface-pattern）
    expect(classifyRgb(201, 167, 245)).toBe("violet");// #c9a7f5
    expect(classifyRgb(25, 22, 31)).toBe("violet");   // #19161f 紫调近黑
    expect(classifyRgb(232, 17, 35)).toBe("red");     // #e81123 Windows 关闭
    expect(classifyRgb(242, 125, 146)).toBe(null);    // ROSE #f27d92：h=351 → 见下条，自家色靠表不靠窗口
    expect(classifyRgb(255, 255, 255)).toBe(null);
    expect(classifyRgb(29, 29, 31)).toBe(null);       // #1d1d1f
    expect(classifyRgb(142, 142, 147)).toBe(null);    // #8e8e93
  });

  it("ROSE 落在 red 窗口里——所以「禁止」只能由迁移表决定，分类器只负责分类", () => {
    expect(classifyRgb(242, 125, 146)).not.toBe("pink");
    expect(["red", null]).toContain(classifyRgb(242, 125, 146));
  });

  it("url(#fade) 不是颜色", () => {
    expect(scanColorLiterals(".x { mask: url(#fade); }")).toEqual([]);
    expect(scanColorLiterals(".x { background: #fade; }")).toHaveLength(1);
  });

  it("提案：红一律 needsReview，紫调近黑按属性分流", () => {
    expect(proposeToken({ text: "#e81123", family: "red", line: 1, property: "background" }))
      .toBe("needsReview");
    expect(proposeToken({ text: "#19161f", family: "violet", line: 1, property: "background" }))
      .toBe("--rb-surface-elevated");
    expect(proposeToken({ text: "#19161f", family: "violet", line: 1, property: "color" }))
      .toBe("--rb-text-primary");
    expect(proposeToken({ text: "#ff5b8a", family: "pink", line: 1, property: "background" }))
      .toBe("--rb-accent");
    expect(proposeToken({ text: "#ff9fbd", family: "pink", line: 1, property: "border-color" }))
      .toBe("--rb-pink-100");
  });
});
```

> `#fade` 那条断言不是洁癖：`f`/`a`/`d`/`e` 全是合法 hex 字符，`url(#id)` 在前端 SVG 滤镜里遍地都是，
> 分类器如果把那种 `#xxxx` 当颜色，回写脚本就会把 `mask: url(#fade)` 改成 `mask: url(var(--rb-pink-50))`——
> 一种会静默让遮罩消失的坏改动。

```bash
CI=true npx vitest run src/shared/color-roles.test.ts
```
Expected：全绿。红的话按断言里的实测值修分类器，别改断言迁就它。

- [ ] **Step 2: 生成迁移表草案**

`scripts/build/inventory-brand-colors.mjs`：

```js
// scripts/build/inventory-brand-colors.mjs
/**
 * 普查 + 生成迁移表草案。产出的 JSON 是**给人改的**，不是给人读的日志：
 * 回写脚本按它做精确替换，锁按它逐条核对。跑它是为了重建草案，不是每次都跑。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { globSync } from "node:fs";
import { resolve } from "node:path";
import esbuild from "esbuild";

const THEME_FILES = [
  "src/renderer/ui/tokens.css",
  "src/renderer/ui/theme.css",
  "src/renderer/ui/themes/pearl-white.css",
  "src/renderer/ui/themes/charcoal-pink.css",
];

const outfile = resolve("node_modules/.cache/mochi-palette/color-roles.mjs");
await esbuild.build({
  entryPoints: [resolve("src/shared/color-roles.ts")],
  bundle: true, format: "esm", platform: "node", outfile, logLevel: "silent",
});
const { scanColorLiterals, proposeToken } = await import(new URL(`file://${outfile}`).href);

const files = globSync("src/**/*.css", { cwd: process.cwd() })
  .map((f) => f.replace(/\\/g, "/"))
  .filter((f) => !THEME_FILES.includes(f));

const rows = new Map();
let lines = 0;
for (const file of files) {
  const css = readFileSync(file, "utf8");
  const hits = scanColorLiterals(css);
  if (hits.length) lines += 1;
  for (const hit of hits) {
    const key = hit.text.toLowerCase();
    const cur = rows.get(key) ?? {
      spelling: hit.text, family: hit.family, property: hit.property,
      token: proposeToken(hit), count: 0, files: new Set(),
    };
    cur.count += 1;
    cur.files.add(file);
    rows.set(key, cur);
  }
}

const sorted = [...rows.values()].sort((a, b) => b.count - a.count);
const out = {};
for (const r of sorted) {
  out[r.spelling] = r.token === "needsReview"
    ? { needsReview: true, family: r.family, count: r.count, sample: [...r.files][0] }
    : { token: r.token };
}
const target = "scripts/build/color-migration.json";
writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`, "utf8");
console.log(`写入 ${target}：${sorted.length} 个写法，覆盖 ${sorted.reduce((n, r) => n + r.count, 0)} 处，`
  + `其中 needsReview ${sorted.filter((r) => r.token === "needsReview").length} 条`);
```

```bash
node scripts/build/inventory-brand-colors.mjs
```
Expected（实测数字，对不上就是扫描器漏了）：约 **110 条写法**、**394 处**、**100 个不同值**、
**`needsReview` 26 条**（红族全部进这条）。

> `globSync` 从 `node:fs` 导入需要 Node ≥ 22（本机 v24.18.0，够）。若嫌不稳可换成
> `node:path` + 自己写的目录遍历——**不要为此新增依赖**。

- [ ] **Step 3: 人工裁决 26 条 `needsReview`**

规则（按此裁决，不要临场发明）：

- **OS/第三方 chrome 一律 `keep`**：`#e81123`（Windows 关闭按钮）、`#ff5f57`（macOS 红灯）
  及其配套的 `#ff453a`/`#ff4d4f`/`#ff7875`/`#f87171`。理由写「操作系统窗口控件的语义色，改了等于谎称是 Mochi 的按钮」。
- **表达「危险/失败」的改成 `var(--rb-danger)`**：`#ef4444`、`#e5484d`、`#d4384d`、`#d94f61`、
  `#c9342d`、`#dc2626`、`#dc3545`、`#b42345`、`#b42a46`、`#a32937`、`#cf3f58`、`#d1445a`、`#d73a72`、
  `#82071e`（这条是深粉用作 danger 文字，按表落到 `--rb-danger`）。
- **落在粉/紫语义的**（`#ff3b5c`、`#ff7198`、`#e94c7a`、`#e83d75`、`#ec4899` 之类如果混进红族）改判 `--rb-accent`。
- 每条 `keep` 必须有 `reason` 字符串；没有理由的 `keep` 就是漏网的白名单。

裁决完把 `needsReview` 字段删掉，只留 `{ "token": "…" }` 或 `{ "keep": true, "reason": "…" }` 两种形态。
顺带抽查 3–5 条自动提案（尤其 `#ff9fbd`→`--rb-pink-100`、`#4c3762`→`--rb-surface-elevated`），
不对就在表里改——**表是权威，脚本与分类器都不是**。

- [ ] **Step 4: 写锁（此时它应该红，因为 CSS 还没动）**

`src/renderer/ui/brand-color-migration.test.ts`：

```ts
/**
 * 品牌色锁：模块 CSS 里的每一个上游粉/紫字面量，要么已经被换成表里指定的令牌，
 * 要么在表里被明确 `keep` 并写了理由。
 *
 * 三条断言，一条都不能省：
 * 1. 残留：扫模块 CSS，凡命中分类器且不在 `keep` 集合里的写法 → 红。（这条现在就该红。）
 * 2. 可解析：表里引用的每个令牌，必须**同时**在 `tokens.css`、`pearl-white.css`、
 *    `charcoal-pink.css` 三处声明。理由：`plan-approval-preview.html` 与
 *    `plugin-market-preview.html` 这两个入口只 link `ui/theme.css`，拿不到 `tokens.css`；
 *    而只在一份主题文件里出现的令牌，换过去就会在另一档主题里解析为空——**颜色直接消失**。
 * 3. 反空转：表必须有 ≥ 60 条，且 `keep` 都带 reason。防止「把表清空/全判 keep」骗绿。
 */
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { scanColorLiterals } from "../../shared/color-roles";
import { TOKENS_BY_SCHEME } from "../../shared/palette-from-cat";
import migration from "../../../scripts/build/color-migration.json";

const THEME_FILES = [
  "src/renderer/ui/tokens.css",
  "src/renderer/ui/theme.css",
  "src/renderer/ui/themes/pearl-white.css",
  "src/renderer/ui/themes/charcoal-pink.css",
];

const KEEP = new Set(
  Object.entries(migration as Record<string, { keep?: boolean }>)
    .filter(([, v]) => v.keep === true)
    .map(([k]) => k.toLowerCase()),
);

function moduleCss(): string[] {
  return globSync("src/**/*.css", { cwd: resolve(__dirname, "../..") })
    .map((f) => f.replace(/\\/g, "/"))
    .filter((f) => !THEME_FILES.includes(f));
}

describe("上游品牌色只能来自迁移表的裁决", () => {
  const rows = migration as Record<string, { token?: string; keep?: boolean; reason?: string }>;

  it("正对照：迁移表不是空表，且每个 keep 都写了理由", () => {
    const entries = Object.entries(rows);
    expect(entries.length).toBeGreaterThanOrEqual(60);
    const 无理由 = entries.filter(([, v]) => v.keep === true && !(v.reason ?? "").trim().length);
    expect(无理由.map(([k]) => k)).toEqual([]);
    // 分类器扫自己：确保这条测试用到的扫描器不是死的。
    expect(scanColorLiterals(".x { color: #ff5b8a; }")).toHaveLength(1);
  });

  it("模块 CSS 里不残留未裁决的品牌色写法", () => {
    const residue: string[] = [];
    for (const file of moduleCss()) {
      const css = readFileSync(resolve(__dirname, "../..", file), "utf8");
      for (const hit of scanColorLiterals(css)) {
        if (KEEP.has(hit.text.toLowerCase())) continue;
        residue.push(`${file}:${hit.line} ${hit.property}: ${hit.text}`);
      }
    }
    expect(residue, `${residue.length} 处未清\n${residue.slice(0, 40).join("\n")}`).toEqual([]);
  });

  it("表里引用的每个令牌在三份定义文件里都存在", () => {
    const read = (f: string) => readFileSync(resolve(__dirname, "../..", f), "utf8");
    const inTokens = new Set([...read("src/renderer/ui/tokens.css").matchAll(/(--(?:rb|md)-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    const inPearl = new Set([...read("src/renderer/ui/themes/pearl-white.css").matchAll(/(--(?:rb|md)-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    const inCharcoal = new Set([...read("src/renderer/ui/themes/charcoal-pink.css").matchAll(/(--(?:rb|md)-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    const bad: string[] = [];
    for (const [spelling, row] of Object.entries(rows)) {
      if (!row.token) continue;
      if (!inTokens.has(row.token) || !inPearl.has(row.token) || !inCharcoal.has(row.token)) {
        bad.push(`${spelling} -> ${row.token}（三处定义不齐）`);
      }
      if (TOKENS_BY_SCHEME.light[row.token] === undefined || TOKENS_BY_SCHEME.dark[row.token] === undefined) {
        bad.push(`${spelling} -> ${row.token}（不在派生表里）`);
      }
    }
    expect(bad, bad.join("\n")).toEqual([]);
  });
});
```

`vitest.config.mts` 的 `include` 已覆盖 `src/renderer/**`，不用改配置。
但 `resolve(__dirname, "../..")` 依赖测试文件在 `src/renderer/ui/` 下——放到别处就要改这两级。

```bash
CI=true npx vitest run src/renderer/ui/brand-color-migration
```
Expected：**第 2 条红**，报出几十处残留（现在 CSS 还是上游粉）。这就是 Task 19 的靶子。
第 1、3 条必须绿——如果第 3 条现在也红，是表里引了不存在的令牌或第 2 步的提案写错了，先修表。

- [ ] **Step 5: 提交（锁与表一起，CSS 还不动）**

```bash
git add src/shared/color-roles.ts src/shared/color-roles.test.ts \
  scripts/build/inventory-brand-colors.mjs scripts/build/color-migration.json \
  src/renderer/ui/brand-color-migration.test.ts
git commit -m "feat(theme): 品牌色迁移表与分类器，先立起会红的锁"
```

> 提交正文要写清楚：这条锁此刻是红的，Task 19 让它绿；
> 「红锁先落地」是故意的顺序——反过来（先清 CSS 再补锁）就没有任何东西证明清干净了。
> SDD 执行到这一步不要把这条红当失败：它是 Task 19 的输入。

---

### Task 19: 按表回写模块 CSS + 棘轮 + 表面图案换色（C5 的门）

**Files:**
- Create: `scripts/build/apply-color-migration.mjs`
- Modify: `src/**/*.css` 里 43 个含品牌色的文件（由脚本改，不手改）
- Modify: `assets/ui/cyrene-surface-pattern.svg`（15 处 `rgba(233,30,99,α)`）
- Create: `src/renderer/ui/hardcoded-color-ratchet.test.ts`
- Modify: `package.json`（`palette:migrate` / `palette:migrate:check`）

**Interfaces:**
- Consumes: Task 18 的 `scripts/build/color-migration.json`（唯一权威）、`color-roles.ts` 的扫描器。
- Produces: `node scripts/build/apply-color-migration.mjs [--check]`；常驻棘轮
  `hardcoded-color-ratchet.test.ts`（Task 20+ 与 Phase E 都靠它防止改回去）。

- [ ] **Step 1: 写回写脚本**

结构照抄 Task 15 的 `apply-theme-palette.mjs`（同一套 esbuild 现编、同一套「按 `"\n"` 切、
按 `"\n"` 合」保行尾的纪律），差别只在：它替换的是**值里的色面**而不是整条声明的值。

```js
// scripts/build/apply-color-migration.mjs
/**
 * 按 scripts/build/color-migration.json 把模块 CSS 里的上游品牌色换成 var() 引用。
 * 只替换表里点名的写法（大小写不敏感、按原文替换），其余字符一律不动。
 * 表是人工裁决的产物；脚本没有任何自行判断——这是它能被审计的前提。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { globSync } from "node:fs";
import { resolve } from "node:path";
import esbuild from "esbuild";

const THEME_FILES = [
  "src/renderer/ui/tokens.css",
  "src/renderer/ui/theme.css",
  "src/renderer/ui/themes/pearl-white.css",
  "src/renderer/ui/themes/charcoal-pink.css",
];
const CHECK = process.argv.includes("--check");

const outfile = resolve("node_modules/.cache/mochi-palette/color-roles.mjs");
await esbuild.build({
  entryPoints: [resolve("src/shared/color-roles.ts")],
  bundle: true, format: "esm", platform: "node", outfile, logLevel: "silent",
});
const { scanColorLiterals } = await import(new URL(`file://${outfile}`).href);
const migration = JSON.parse(readFileSync(resolve("scripts/build/color-migration.json"), "utf8"));

const targets = Object.entries(migration)
  .filter(([, row]) => row.token)
  // 复用分类器判定「这条写法是不是品牌色」：表里若被人工塞进一条分类器不认的写法，
  // 它就不该被回写——否则锁与脚本对「什么是品牌色」会有两套口径。
  .filter(([spelling]) => scanColorLiterals(`.x{p:${spelling}}`).length > 0)
  .map(([spelling, row]) => ({
    spelling,
    // 判定用不带 g 的副本：带 /g 的 RegExp 有 lastIndex，`.test()` 连续调用会隔次漏判，
    // 表现就是「同一行里第二个写法偶尔没换」。替换才用 /gi。
    probe: new RegExp(escapeRe(spelling), "i"),
    re: new RegExp(escapeRe(spelling), "gi"),
    token: row.token,
  }));

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

let totalLines = 0;
let failed = false;
for (const file of globSync("src/**/*.css", { cwd: process.cwd() })
  .map((f) => f.replace(/\\/g, "/"))
  .filter((f) => !THEME_FILES.includes(f))) {
  const before = readFileSync(file, "utf8");
  const lines = before.split("\n");
  let changed = 0;
  const after = lines.map((line) => {
    if (/url\(/i.test(line)) return line;          // url(#fade) 之类一律不碰
    let next = line;
    for (const { probe, re, token } of targets) {
      if (!probe.test(next)) continue;
      next = next.replace(re, `var(${token})`);
    }
    if (next !== line) changed += 1;
    return next;
  });
  if (!changed) continue;
  totalLines += changed;
  if (CHECK) { failed = true; console.error(`漂移：${file} 还有 ${changed} 行未回写`); continue; }
  writeFileSync(file, after.join("\n"), "utf8");
}
console.log(CHECK ? `--check：${failed ? "有" : "无"}漂移` : `按表回写 ${totalLines} 行`);
process.exit(failed ? 1 : 0);
```

> 上面 `targets` 里那句「复用分类器判定」不是过度设计：表里如果混进一条分类器**不认**的写法
> （人工手加的），它就不该被回写——否则锁与脚本对「什么是品牌色」会有两套口径。
> 执行时如果这一步过滤掉了条目，把被滤掉的写法打印出来并回到 Task 18 修表，
> **不要**把过滤条件删掉。

- [ ] **Step 2: 跑回写，核对行数**

```bash
node scripts/build/apply-color-migration.mjs
git diff --numstat -- src
node scripts/build/apply-theme-palette.mjs --check
CI=true npx vitest run src/renderer/ui/brand-color-migration
```
Expected：回写行数与表里 `count` 之和同量级（实测 394 处、348 行——同一行可能有 2 个写法，
所以**行数 ≤ 处数**是正常的，反过来就是 bug）；`git diff --numstat` 每文件 `+` ≈ `−`
（行尾没被统一）；派生锁仍然绿（主题文件没被碰）；品牌色锁第 2 条转绿。

- [ ] **Step 3: 换表面图案的颜色**

`assets/ui/cyrene-surface-pattern.svg` 里 15 处 `rgba(233, 30, 99, α)`（material 粉 `#e91e63`），
α 分 7 档：0.04×1 / 0.06×1 / 0.08×2 / 0.12×2 / 0.14×5 / 0.18×3 / 0.2×1。
只换三元组，α 一档不动：

```bash
sed -i 's/233, *30, *99/91, 141, 239/g' assets/ui/cyrene-surface-pattern.svg
grep -c '91, 141, 239' assets/ui/cyrene-surface-pattern.svg   # Expected 15
grep -c '233, *30, *99' assets/ui/cyrene-surface-pattern.svg  # Expected 0
```

`91, 141, 239` = `ACCENT #5b8def`（`src/shared/pet-tokens.ts` 的强调蓝）。
**为什么这里允许写死而不是 `var()`**：SVG 是被 CSS 当 `url()` 背景图加载的独立文档，
拿不到宿主页的自定义属性。代价要写明：这张图案浅色/深色共用，
`#5b8def` 在 `PAPER` 与深色页底上都能读，但它**不会随主题变**——
真要分主题就得做两份 SVG 加 `[data-ui-theme]` 选择器，本期不做，也别让下一个人以为忘了。

同时确认 `react-root.visual.test.ts` 里那条 `toContain("cyrene-surface-pattern.svg")` 仍然绿
（它断的是文件名不是颜色，不会红；列出来是因为它是这条资产唯一的测试触点）。

- [ ] **Step 4: 棘轮——中性色只准减不准增**

`src/renderer/ui/hardcoded-color-ratchet.test.ts`：

```ts
/**
 * 字面量棘轮：模块 CSS 里带颜色的行数只准降不准升。
 *
 * 为什么不是「零字面量」：C5 的裁决是不动中性灰白（理由见计划阶段 C5 开头第 1 条），
 * 所以这一期之后仍然会有 ~700 行合法的中性/第三方色。零字面量的断言要么被放松成摆设，
 * 要么逼出一次没有尺护航的大规模改动。棘轮是这里唯一诚实的形状：**当前值抄自实测，
 * 之后任何人加一行新字面量都会红，而往下调要顺手把常量一起改小。**
 */
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const CEILING = 0; // ← Step 4 末尾用实测数字替换（含被 keep 的品牌色行，不含四份主题文件）
const THEME_FILES = [
  "src/renderer/ui/tokens.css",
  "src/renderer/ui/theme.css",
  "src/renderer/ui/themes/pearl-white.css",
  "src/renderer/ui/themes/charcoal-pink.css",
];
const COLOR = /#[0-9a-fA-F]{3,8}\b(?![-0-9a-zA-Z])|\brgba?\(/;

describe("模块 CSS 的字面量棘轮", () => {
  it("带色行的总数不超过棘轮上限，且统计口径本身没有塌", () => {
    const files = globSync("src/**/*.css", { cwd: resolve(__dirname, "../..") })
      .map((f) => f.replace(/\\/g, "/"))
      .filter((f) => !THEME_FILES.includes(f));
    let total = 0;
    const per: Array<[string, number]> = [];
    for (const file of files) {
      const n = readFileSync(resolve(__dirname, "../..", file), "utf8")
        .split("\n").filter((l) => COLOR.test(l)).length;
      if (n) per.push([file, n]);
      total += n;
    }
    expect(files.length).toBeGreaterThan(60);   // 正对照：glob 没跑空（口径塌了会让 total=0 直接绿）
    expect(per.length).toBeGreaterThan(30);     // 正对照：确实还有带色的文件在管
    expect(total).toBeLessThanOrEqual(CEILING);
    if (total < CEILING - 10) {
      // 不是失败，是提醒：降了 10 行以上就该把上限一起调小，否则棘轮白松了 10 行。
      console.warn(`[ratchet] 实测 ${total} < 上限 ${CEILING}，把 CEILING 改成 ${total}`);
    }
  });
});
```

跑它拿到真实数字：

```bash
CI=true npx vitest run src/renderer/ui/hardcoded-color-ratchet
```
Expected：第一次必红（`CEILING = 0` 而实测约 725 上下）。**把报出来的实测值抄进 `CEILING`**，
再跑一次转绿。抄的是实测，不是估计。

- [ ] **Step 5: 全套门 + 起一次真窗肉眼看**

```bash
npm run palette:check && node scripts/build/apply-color-migration.mjs --check
CI=true npx vitest run src/shared src/renderer/ui src/main
npx tsc -p tsconfig.renderer.json --noEmit && npx tsc -p tsconfig.main.json --noEmit
```
Expected：全绿。然后按 P0 那条已验证的启动方式跑一次（`--user-data-dir=D:\cyrene-p0-probe`，
绝不碰 `%APPDATA%\Cyrene`），把「聊天主界面 / 设置页 /  moments 面板 / 语音通话预览」四个界面
在两个主题下各截一张，肉眼看有没有**大片**变灰变白（`var()` 没解析上就是透明/无色，
这是脚本化检查看不出来的那类坏）。截图留到 Phase E 一起归档。

- [ ] **Step 6: 提交**

```bash
git add -A src assets/ui/cyrene-surface-pattern.svg scripts/build package.json
git status --porcelain   # 确认没有把 node_modules/.cache 之类的东西一起加进来
git commit -m "feat(theme): 模块 CSS 的上游粉紫按迁移表改为令牌引用，加字面量棘轮"
```

> 提交正文必须列三件事：① 靶子是上游品牌身份色，中性灰白本期不动、由棘轮压住；
> ② `keep` 的 6 个 OS 语义红各自理由（照表抄）；③ surface-pattern 是独立 SVG 文档，
> 只能写死 `91,141,239`，不随主题变。
> `git add` 用显式路径而不是 `-A src`，是为了避免把 `.superpowers/` 或探针产物混进来——
> 若 `git status` 里出现没预期的文件，先看清再 add。

---

## 阶段 D：形象换猫

本期不是「重画几张图」，是把 **215 MB 的动漫人物位图**换成**与桌面猫同一套 DrawOp 生成**的猫。
先把实测账摆出来——下面每一行都是本仓现在跑命令量出来的，不是估的：

| 目录 | 张数 | 实测像素 | 体积 | 消费方（机制） | 处置 |
| --- | --- | --- | --- | --- | --- |
| `react/assets/characters/<名>/status-moods/` | 72 | 1254×1254 | **97.5 MB** | `react/character-status-moods.ts:3` 的 `import.meta.glob`，键 `./assets/characters/${名}/status-moods/${情绪}.png` | 重生成 |
| `react/assets/status-moods/` | 25 | 1238–2040 方 | 35.9 MB | 12 个文件静态 `import … from "../../../assets/status-moods/工作中.png"`（`characterRuntime.ts:3-18`、`ChatMessageList.tsx:12-17`、`InteractionPanel.tsx:23-26`、`PlanModeToggle`、`ReasoningControl`、`ReviewPanel`、`CodeGitPanel` 等） | 重生成（文件名一个都不能改） |
| `src/renderer/tast/` | 12 | 1230–1440 | 17.0 MB | `react/character-portraits.ts:4-15` 静态 import → `TaskDelegationRow.tsx` | 重生成 |
| `public/stickers/` | 52（44 jpg / 6 png / 2 gif） | 混 | 19.5 MB | `shared/sticker-types.ts:4-57` ID 表 + `main/sticker-descriptions.ts:65-115` 文件表 + `sticker-storage.ts:127-133` 服务。⚠️ 命名谎言实测：`clingy-confused.gif`、`peek.gif`、`love-calm.png` 三个文件头都是 `RIFF`（真身 WebP），44 个 `.jpg` 倒是真 JPEG | 52→24 猫贴纸 |
| `assets/models/cyrene/`＋`src/renderer/public/models/cyrene/` | 两棵树共 42 文件 | 模型包 | 9.1 MB × 2 | 只有孤儿 `src/renderer/live2d/`（12 个文件，**目录外零 import**：按 `from "…\/live2d\/"` 搜只命中 `src/preload/index.ts:20` 的 `./live2d-listener-diagnostics`，那是 preload 里的另一个文件；`src/renderer/pet/{click-through,renderer}.ts` 提到 `live2d/` 只是注释里的判据出处）；⚠️ `live2d/manager.test.ts:100,141` 会**从磁盘**读 `../public/models/cyrene/Cyrene.model3.json`，所以模型树与该测试文件必须在同一次改动里删 | 删（D4） |
| `react/assets/status-float/` | 4 | 1211–1355 | 6.6 MB | `StatusFloat.tsx:3-6` 静态 import | 重生成 |
| `public/context-usage/` | 4 | 1095–1208 | 5.2 MB | `ContextUsageRing.tsx:63,64,65,70` 经 `resolveAsset("context-usage/${档}.png")` 读（`CONTEXT_USAGE_COMPACT_SRC` 是导出常量，别只搜字面量） | 重生成 |
| `react/avatars/` | 13 | 480×480 | 5.1 MB | `react/character-avatars.ts:4-32` 静态 import（12 名＋`昔涟`→`resolveAsset("avatars/cyrene-avatar.png")`）；其中 `昔涟.png` **0 处引用** | 重生成 12 张，`昔涟.png` 删 |
| `react/assets/welcome/` | 4 | 1208–1254 | 6.2 MB | `ChatComposer.tsx:26-29` `?url` import | 重生成 |
| `react/assets/todo/` | 3 | 1175–1254 | 4.5 MB | **0 处引用**（按 basename 与目录名两路 grep 均无命中） | 删 |
| `react/assets/ask/` | 3 | 990–1254 | 3.8 MB | **0 处引用** | 删 |
| `react/assets/avatars/`（`avatar-{dark,light}.png`） | 2 | 1910×1910 | 1.6 MB | **0 处引用** | 删 |
| `react/assets/` 散图 | 7 | 混 | 4.8 MB | 有引用 3 张：`moments.png`（`MomentsModeButton.tsx:2`、`MomentsPanel.tsx`）、`new.png`（`NewTaskButton.tsx:1` `?url`）、`plugin.png`（`PluginModePanel.tsx`）；**0 引用 4 张**：`model.png`、`tools.png`、`sidebar-bg.png`（750×1624）、`思考组件.png`（与 `status-moods/思考中.png` **md5 逐字节相同** `1c991ff7…3253`，纯冗余） | 3 张重生成，4 张删 |
| `public/avatars/cyrene-avatar.png` | 1 | 1200×1200 | 1.8 MB | `useCyreneAvatar.ts:5` 与 `character-avatars.ts:32` 的 `resolveAsset` | 重生成（**文件名不改**：属 B4 裁决 (c) 的内部数据文件名） |
| `public/` 根 | 2 | 1672×941 / 1001×1202 | 3.3 MB | `cyrene-welcome.png` ← `WelcomeGate.tsx:51`（`resolveAsset`，带 `onError` 降级）；`loading.png` ← `public/splash.html:78`，该页由 `main/startup/create-splash-window.ts:48,52` 加载 | 重生成 |
| `public/icons/` | 8（3 png 有引用） | 1024² 与 ≤128 | 2.6 MB | 有引用：`cyrene-{pink,sun}.png` ← `shared/ui-icon.ts:2-3` 的 `previewPath`（`fileName` 由 `main/app-icon.ts:6` 运行时拼到 `assets/icon-presets/`）；`sticker-picker.png` ← `ChatComposer.tsx:232` 的 `resolveAsset("icons/sticker-picker.png")`。**0 引用**：`cyrene-avatar-line-white.png`、`cyrene-avatar-line.svg`、`mimi.png` | 3 张换猫，3 张删；同名的 SVG（attach/clear/mcp）是图标类，R-D4 不动 |
| `icons/providers/`（SVG 13） | 13 | ≤128 | 0.2 MB | `settings/api/presets.ts:12-19` 定义了 `iconUrl: "../icons/providers/*.svg"`，但 `ModelSettingsPanel.tsx:124-143` 的 `providerIcon()` 用 `@lobehub/icons` 组件渲染，**这个字段从没被读过**（全仓 `.iconUrl` 只有 `StyleControl.tsx:79,88` 两处，读的是另一套风格选项） | 删（R-D5），删前跑 Task 25 Step 1 的 grep 门复核 |
| `assets/icon-presets/` | 2 | 1024×1024 | 3.7 MB | `main/app-icon.ts:6` 运行时拼路径 | Task 11 已删，本轨核对 |
| `music/assets/` | 2 | 1187–1254 | 2.9 MB | `logo.png`/`music2.png` ← `music/components/LoadingScreen.tsx:3`、`music/App.tsx:21-22` | 重生成 |
| `toast/assets/toast-avatar.png` | 1 | 1200² | 1.5 MB | `toast/toast.ts:14` 静态 import | 重生成 |
| `settings/100.png` | 1 | 1254² | 1.4 MB | `AppearanceSettingsPage.tsx:41` 静态 import | 重生成 |
| `assets/ui/cyrene-thinking-loop/` | 11 | 帧图＋gif＋webp＋sprite-sheet | 7.4 MB | **0 处引用** | 删 |
| `build/installer/`＋`assets/tray-icon.ico` | 3 | 150 宽 / 32 ico | 1.9 MB | `electron-builder.yml:66,84-85`、`installer.nsh`；`cyrene-installer-source.png`（904×1260）是 `.gitignore:59` 白名单的**主稿**，专供裁 `installer-sidebar.bmp`，不是运行期死文件 | Task 11 已产猫版，本轨只核对；主稿**保留** |

全仓位图（不含 SVG）**231 个 / 252.5 MB**：`src/renderer` 214 个 / 230.9 MB、`assets/` 15 个 / 19.8 MB、`build/` 2 个 / 1.8 MB。另有 SVG 142 个 / 0.4 MB。当前 `du -sh src/renderer` = **237M**；本期之后必须 **< 15 MB**（D3 判据，前后各测一次写进提交正文）。

### D 轨裁决

- **R-D1 尺寸按实测显示档给，不照抄原像素，也不照抄本计划早先的估计。** 下表右列是逐个 CSS 类量出来的
  最大显示框（含 DPR 2 余量后的结论），不是猜的。**这张表是 D 轨所有位图任务唯一的档位来源**——
  Task 24/25 的 target 尺寸与 `checkTarget()` 的 KB 预算都从这里取，两边不一致时以本表为准并回来改任务。

  | 资产 | 源图实测 | 最大显示框（CSS，量到的类） | 定档 |
  |---|---|---|---|
  | `characters/*/status-moods/*.png`(72) | 1254²，中位 1.4 MB，合计 **97.5 MB** | 84px `.cy-interaction-panel__mood-bottom-left`（`RunExperience.css:290`） | `256²` |
  | `react/assets/status-moods/*.png`(25) | 1254–2040²，中位 1.4 MB，合计 **≈37 MB** | 同上 84px；最小 18px `.cy-plan-icon` | `256²` |
  | `react/avatars/*.png`(13) | 480²，≈0.4 MB/张 | 42px（朋友圈头像，`MomentsPanel.css`） | `256²` |
  | `src/renderer/tast/*.png`(12 立绘) | ≈1280²，合计 **17.0 MB** | 34px `.cy-task-delegation__avatar`（`RunExperience.css:130`） | `256²` |
  | `public/context-usage/*.png`(4) | ≈1180²，≈1.3 MB/张 | 52px `.cy-context-usage-menu__mood-figure`（`ContextUsageRing.css:71`） | `256²` |
  | 聊天助手头像 `avatars/cyrene-avatar.png` | — | 38px `.cy-message-avatar__image`（`ChatMessageList.css:100`，`border-radius:50%`） | `256²` 圆形遮罩 |
  | `public/loading.png`（splash logo） | 1001×1202 | 160px `.splash__logo`（`public/splash.html:26`） | `320²` |
  | `react/assets/welcome/*.png`(4) | — | 240px `.cy-composer-welcome`（`ChatComposer.css:18`，`min(100%,240px,28vh)`） | `512²` |
  | `react/assets/status-float/*.png`(4) | — | 58–64px（`StatusFloat.tsx:42` 随机尺寸内联到 `width`） | `256²` |
  | 贴纸 `public/stickers/*`(52) | 混合，最宽 2040，合计 **19.5 MB** | 160px 消息流、360×270 选择器预览（`ChatComposer.css:543`） | `512²` |
  | `public/cyrene-welcome.png` | **1672×941**（16:9 横幅） | `min(860px,100%)` × `aspect-ratio:16/9` + `object-fit:cover`（`WelcomeGate.css:65,71-77`） | **`1280×720` 横幅** |

  ⚠️ 两格是本轮实测**推翻我自己先前估计**的，落地时别再抄旧值：
  ① 欢迎海报不是方图——它按 16:9 铺满 860px 宽的卡，给它 `512²` 会被 `object-fit:cover` 裁掉上下，
  同时在 2× 屏上欠采样；只有这张走横幅档。② context-usage 的显示框是 52px 而不是 320px
  （`ContextUsageRing.css:56` 那个 320px 是弹层 `max-width`，不是图的尺寸），先前写成 `320²` 是把两者混了。
  单张预算：方图 **≤ 60 KB**、横幅 **≤ 120 KB**（`--check` 硬卡）。ICO 另出 16/24/32/48/64/128/256 七档。
  体积判据的算法：本期位图总量 = Task 24 的 **129** 条 + Task 25 的 **17** 条 + Task 26 的 **24** 张贴纸
  = **170 张方图** + 1 张横幅，按上限算 ≈ **10.2 MB + 0.12 MB**；`assets/icons/` 与 `build/` 那几张由 Task 11 管。
  这与「`src/renderer` < 15 MB」的 D3 判据自洽——预算不是装饰，是那条判据的组成部分；
  若 `--check` 跑出来普遍贴着 60 KB 上限，说明 `ss` 或抖动参数给错了，**回头改生成器，不许抬预算**。
- **R-D2 文件名一律不动。** spec D2 的原话是「写到应用**已经在看的确切路径与文件名**」，
  这不是保守：`react/assets/status-moods/` 那 25 张是被 12 个文件**按中文名静态 import** 的，
  改一个名就是编译期断链。唯一的名字变动是 12 个**角色键**（目录名与 `<名>.png`），
  那属于 R-D7 的一次性改名，不是改文件名格式。
- **R-D3 生成物进 git，构建期不联网。** 像素尺要能跨提交比较，`--check` 就是比较工具。
- **R-D4 只换「人物」。** 图标类（`react/assets/file-icons/` 82 张、`assets/icons/vscode/` 42 张、
  `public/icons/providers/` 13 张模型商 logo、`sticker-picker.png`）不是动漫形象，一律不动——
  它们既不吃体积预算，也不属于「打破上游身份」的靶子。
- **R-D5 零引用者直接删，不给替身。** 实测清单 **40 个文件 / 20.8 MB**：`react/assets/todo/`(3)、
  `react/assets/ask/`(3)、`react/assets/avatars/`(2)、`react/assets/{model,tools,sidebar-bg,思考组件}.png`(4)、
  `react/avatars/昔涟.png`(1)、`public/icons/{cyrene-avatar-line-white.png,cyrene-avatar-line.svg,mimi.png}`(3)、
  `public/icons/providers/*.svg`(13)、`assets/ui/cyrene-thinking-loop/`(11)。删比画便宜。
  ⚠️ 三个坑实测过：① `public/context-usage/*` **不是**死文件，它走 `resolveAsset`（`ContextUsageRing.tsx:63-70`），
  按 basename grep 永远搜不到——`resolveAsset("x/y.png")` 的键是拼出来的；② `思考组件.png` 与
  `status-moods/思考中.png` md5 相同，删前者不丢内容；③ `public/icons/providers/*.svg` 的 `iconUrl`
  字段在 `settings/api/presets.ts:12-19` 有定义但**从未被渲染**（`ModelSettingsPanel.tsx:124-143` 用
  `@lobehub/icons` 组件），删之前跑 Task 25 Step 1 的双路 grep 门复核。
  **判据统一成一句话**：按 basename + 目录名 + `resolveAsset`/`?url`/`path.join` 三种取法各搜一遍，四路全空才算死。
- **R-D6 光栅化器与 PNG 编码器住在 `src/shared/`，不是 `scripts/build/*.mjs`。**
  原计划（Task 11）把编码器放在 `scripts/build/`、测试放 `src/main/egress/` 用
  `import … from "../../../scripts/build/png-encode.mjs"`——那条 import 进不了 `tsconfig.main.json`
  的程序（`scripts/` 不在 include 内、`.mjs` 无声明文件、`allowJs` 未开），`npm run check:main` 会红。
  改落 `src/shared/sprite-raster.ts` + `src/shared/png-encode.ts`：三处在内
  （vitest include 覆盖 `src/shared`、三个 tsconfig 都吃得到、art 的单测能直接 import），
  `scripts/build/cat-sprites.mjs` 只当 CLI，用 Phase C 已验证的 esbuild 打包路子取模块。
  Task 11 的 Files/Interfaces/Step 2 已按本裁决同步改写。
- **R-D7 先改名，再生成。** 角色键是文件名，所以 12 只猫的名字（Task 23）必须排在生成（Task 24）之前，
  否则 `characters/<名>/` 要 mv 两次。改名波及面：目录/文件 `git mv`、`task-character-pool.ts`、
  `character-avatars.ts`、`character-portraits.ts`、`prompts/moments_personas/<名>.md`、
  `character-personas.ts` 的语料字段、`react/i18n/{en,ja-JP,zh-CN}.json`。
  **代价明说**：历史转写里落盘的 `assetFileName: "风堇.png"` 在新键表上查不到 →
  `getCharacterStatusMoodUrl` 返回 `null`，而它唯一的消费方 `TaskSessionInspector.tsx:89`
  已经写了 `moodUrl ? {...} : undefined` 的降级——所以是「旧消息没头像」，不是崩。
  本期**不**做历史转写的名字迁移（那是往用户数据里写，B4 裁决 (c) 的边界）。
- **R-D8 「卧/趴/探头/炸毛」走两个新的可选归一化轴，不新写四条部件路径。**
  `buildCatOps` 现有几何只有 `paw/yawn/stretch/tilt` 四个动作参数加 `mood` 五档，
  spec 要的 12 姿态里 8 个已有落点（坐/伸懒腰/洗脸/打哈欠/歪头/睡/委屈/开心），
  4 个（卧/趴/探头/炸毛）没有。加 `sprawl`（趴伏：压扁拉长）与 `puff`（蓬起：横向炸开＋尾毛直立）
  两个 **optional** 参数、折进 `art.ts:209-211` 已有的 `sx_all/sy_all` 那条轴和尾巴摆幅，
  默认 0 ⇒ 桌面猫逐像素不变、现有调用点零改动。
  **为什么不新写路径**：那四条路径要重新定 49 点贝塞尔团子、耳、尾的 viewBox 坐标，
  等于重做一遍 native 用 70 个任务量出来的美术；两轴近似能在 `--check` 的质心/覆盖度尺下被判定，
  重做的不能。**代价**：卧与趴是「同轴不同深度」，剪影差别比真手绘弱——目视档（Task 28）如果
  认不出差别，就把两者深度拉开，而不是去加第三条轴。
- **R-D9 `t = 0` 是唯一的静帧时刻。** `buildCatOps` 的呼吸、整体旋转、尾摆、耳抽全部含 `Math.sin(t·k)`
  或 `t % period`，`t=0` 时四项同时归零 ⇒ 生成结果与调用顺序、时钟无关。
  这条要写成断言（Task 21 的快照锁里 `ops` 连跑两次逐字段相等），否则「构建期可复跑」是句空话。
- **R-D10 `text` 图元不进位图管线。** `buildCatOps` 只在 `zzz` 层发 `text`（`art.ts:408,410` 的两个「Z」），
  其余 `text` 都来自 `buildCapsuleOps`（胶囊读数、未读牌子数字）。软件光栅化器**不支持 `text`，遇到就抛**，
  生成器在调用光栅化器前按层丢掉 `zzz / capsule / unread` 三层。
  理由：静帧状态图靠的是眼/嘴/耳/尾/爱心这些形，Zzz 是给桌面上的活猫用的动效记号；
  为它引字体度量，换来的是「构建期依赖本机字体」——正是本期要避免的那类不确定性。
- **R-D11 Live2D 拆除只删死树，不改标识符。** 实测 `src/renderer/live2d/`（12 个文件）目录外零 import
  （按 `from "…/live2d/"` 搜只命中 `src/preload/index.ts:20` 的 `./live2d-listener-diagnostics`，那是
  preload 里的另一个活文件），所以**这棵树连同两棵模型树（9.1 MB × 2，共 42 文件）与
  `public/live2dcubismcore.min.js`、`package.json` 的两个 pixi 依赖**可以整体删。
  但下面这些**带 live2d 字样的东西全部保留原样**，因为它们不是 Live2D 运行时，改名是纯风险：
  `window.live2dSpeech` / `window.live2dDiagnostics` 两个 preload 桥（`call-react/useCallSession.ts:60,172,180,189`
  与 `react/.../tts-playback.ts:69-103` 是**语音通话和 TTS 口型**的真实消费方，本期功能要留）；
  `shell-bootstrap.ts:78` 的 `createWindowLifecycleTracker("live2d-main", …)`（只是跟踪器的 name 字符串）；
  `global.d.ts:233` 的类型声明；`index.html:14,25` 的 `#live2d-canvas`（**它现在就是像素猫那块画布**，
  `main.ts:5-6` 取它、`:57` 交给 `PixelPetRenderer`，删了猫就没画面了）。
  **怎么收口**：Task 27 把 canvas 与 `main.ts` 的取用一起改名为 `#pet-canvas`（三处，一次改完，
  这是唯一动到的标识符），其余保留，并在提交正文写一句「live2d 字样残留 N 处，属 R-D11 的显式保留」。
- **R-D12 两处「看起来像残留」的字符串是行为闸门，不许顺手改。**
  ① `moments/moments-service.ts:765` 与 `proactive/proactive-lifecycle.ts:63` 都用
  `soul.split("\n## Live2D 与聊天文字的分工")[0]` 来**砍掉 Soul 尾章**——改了 `soul.md` 里那行标题
  而不改这两处，`split` 就返回整篇，主动轮和朋友圈会开始携带它们本来不该带的工具说明（无声行为变化，
  单测未必抓得住）。本期**不改标题**，两处 split 原样留着。
  ② `user-data-migration.ts:19` 的 `LEGACY_USER_DATA_DIR_NAME = "live2d-cyrene"` 是**历史 userData 目录名**，
  删掉它等于砍掉老用户的数据搬家路径。原样保留。
  这条裁决的存在理由：R-D11 删完之后，`grep -i live2d` 仍会命中一大片，那**是预期的**，
  不是「没删干净」——判据是「死代码与位图清零」，不是「这个词从仓库消失」。
- **R-D13 变体库与资产清单住 `src/renderer/pet/`，纯类型住 `src/shared/cat-types.ts`。**
  R-D6 只解决了「`scripts/` 不在任何门内」，没解决反方向的边界：`cat-variants.ts` 要 import
  `art.ts`，而 `art.ts → ops.ts` 里有 `CanvasRenderingContext2D`/`Path2D`；`tsconfig.main.json` 的
  `lib` 只有 `ES2022`，且 `include` 里有 `src/shared/**/*.ts`——把 `cat-variants.ts` 放进 shared，
  `npx tsc -p tsconfig.main.json --noEmit` 会把整条 import 链拉进主进程程序并当场报
  「Cannot find name 'CanvasRenderingContext2D'」（`ops.ts:37,110,127`）。所以：
  - `src/renderer/pet/cat-variants.ts`、`src/renderer/pet/cat-sprite-manifest.ts`（及各自 test）——
    它们依赖 renderer 的绘制树，和 `art.ts` 一起改、一起测（`tsconfig.renderer.json` 的 include 有
    `src/renderer/pet/**/*.ts`，`vitest` 的 include 有 `src/renderer/**/*.test.ts`，R-D6 要的三个条件照样满足）；
  - `src/shared/cat-types.ts` 只放 `Mood` / `PoseName` / `CropName` 三个**无依赖的联合类型**，
    给 shared 侧的 `cat-roster.ts`、`cat-sticker-set.ts` 用，保证 `shared → renderer` 这条边一格都没有；
  - `src/shared/cat-coats.ts`、`cat-roster.ts`、`cat-sticker-set.ts`、`sprite-raster.ts`、`png-encode.ts`
    仍留在 shared（它们只依赖板色与纯数学，不碰 DOM）。
  **判据**：`npx tsc -p tsconfig.main.json --noEmit` 在 Task 13/20/21/24 每步都绿；
  `grep -rn "renderer/" src/shared --include=*.ts` 在测试文件之外为 0。

### Task 20: 花色轴——`src/shared/cat-coats.ts`（D1 之一）

**Files:**
- Create: `src/shared/cat-coats.ts`
- Create: `src/shared/cat-coats.test.ts`
- Modify: `src/renderer/pet/art.ts`（`CatInput` 加 `coat?`、6 个 `BODY_*`/`INNER_EAR` 取值点、`buildCatOps` 内的板色引用）
- Modify: `src/renderer/pet/art.test.ts`（补一条「默认花色＝改动前逐色相同」）

**Interfaces:**
- Consumes: `src/shared/pet-tokens.ts` 的 `INK`/`INK_SOFT`/`PAPER`/`PAPER_SHADE`/`ROSE`/`ROSE_DEEP`/`EYE`/`ACCENT`/`WARN`/`BREAK_*`/`wash`/`withAlpha`（Task 13 的落点）
- Produces:
  - `interface CatCoat { furTop; furBot; furEdge; earInner; light; shade; nose; blush; eye: string }`
  - `type CoatName = "ink" | "paper" | "gray" | "azure" | "rose"`（spec「墨/奶油/灰/蓝/粉」五色的 slug）
  - `const INK_COAT: CatCoat`、`const CAT_COATS: Record<CoatName, CatCoat>`
  - `function coatOf(name: CoatName | undefined): CatCoat`（`undefined` → `INK_COAT`）
  - `function luminance(color: string): number`（0–255，`0.2126R+0.7152G+0.0722B`，四舍五入）

- [ ] **Step 1: 写失败的测试**

新建 `src/shared/cat-coats.test.ts`。三条判据：默认花色逐色等于改动前的常量（这就是「桌面猫像素不变」的证明）、
五色全部由板内色经 `wash` 得到（不许出现新十六进制字面量）、五档对比锁。

```ts
import { describe, expect, it } from "vitest";
import { EYE, INK, INK_SOFT, PAPER, PAPER_SHADE, ROSE, ROSE_DEEP, ACCENT, WARN, wash } from "./pet-tokens";
import { CAT_COATS, COAT_READS_BY, INK_COAT, coatOf, luminance, type CoatName } from "./cat-coats";

/** 板内色全体——本期「不许引入新色相」这条判据的定义域。 */
const BOARD = [INK, INK_SOFT, PAPER, PAPER_SHADE, ROSE, ROSE_DEEP, EYE, ACCENT, WARN] as const;

/** 板内色的所有 wash 像：`wash(板, α, 板)`，α 取 1..255。约 2 万条，构造一次就够。 */
const WASH_IMAGE = new Set<string>();
for (const fg of BOARD) for (const bg of BOARD) for (let a = 1; a <= 255; a += 1) WASH_IMAGE.add(wash(fg, a, bg));

describe("花色轴", () => {
  it("默认花色＝art.ts 改动前用的那批常量（桌面猫零像素变动）", () => {
    expect(coatOf(undefined)).toEqual({
      furTop: INK, furBot: INK_SOFT, furEdge: INK, earInner: ROSE_DEEP,
      light: PAPER, shade: PAPER_SHADE, nose: ROSE_DEEP, blush: ROSE, eye: EYE,
    });
    expect(INK_COAT).toEqual(coatOf("ink"));
  });

  it("五色齐、名字 slug 与 spec 对得上", () => {
    expect(Object.keys(CAT_COATS).sort()).toEqual(["azure", "gray", "ink", "paper", "rose"]);
  });

  it("每档都读得出来：瞳压在眼白上、腮红压在亮面上、胸布比亮面深", () => {
    for (const name of Object.keys(CAT_COATS) as CoatName[]) {
      const c = CAT_COATS[name];
      expect(luminance(c.light) - luminance(c.eye), `${name} 瞳/眼白`).toBeGreaterThanOrEqual(60);
      expect(luminance(c.light) - luminance(c.blush), `${name} 腮红/亮面`).toBeGreaterThanOrEqual(40);
      expect(luminance(c.light) - luminance(c.shade), `${name} 胸布两层`).toBeGreaterThanOrEqual(12);
      // 轮廓不许比身体亮（糊成一片的入口）
      expect(luminance(c.furEdge) - luminance(c.furTop), `${name} 轮廓不超亮`).toBeLessThanOrEqual(6);
    }
  });

  it("深色猫靠亮部结构、奶油猫靠暗部轮廓，两套读法各自锁死", () => {
    for (const name of Object.keys(CAT_COATS) as CoatName[]) {
      const c = CAT_COATS[name];
      if (COAT_READS_BY[name] === "light-markings") {
        expect(luminance(c.light) - luminance(c.furTop), `${name} 亮部对毛面`).toBeGreaterThanOrEqual(40);
      } else {
        expect(luminance(c.furTop) - luminance(c.furEdge), `${name} 毛面对轮廓`).toBeGreaterThanOrEqual(60);
        expect(luminance(c.furTop) - luminance(c.shade), `${name} 毛面对胸布`).toBeGreaterThanOrEqual(30);
      }
    }
    // 正对照：奶油猫是故意走「暗轮廓」这一支的，它的亮部差只有 21 左右，
    // 拿第一条判据去卡它必红——所以两支持平权，不是给某档开后门。
    expect(luminance(CAT_COATS.paper.light) - luminance(CAT_COATS.paper.furTop)).toBeLessThan(40);
    expect(COAT_READS_BY.paper).toBe("dark-outline");
  });

  it("全部板内色或板内色的 wash，不引入新色相", () => {
    for (const name of Object.keys(CAT_COATS) as CoatName[]) {
      for (const [slot, value] of Object.entries(CAT_COATS[name])) {
        expect(BOARD.includes(value as typeof BOARD[number]) || WASH_IMAGE.has(value),
          `${name}.${slot}=${value}`).toBe(true);
      }
    }
  });
});
```

- [ ] **Step 2: 跑到失败**

Run: `CI=true npx vitest run src/shared/cat-coats.test.ts`
Expected: FAIL —— `Cannot find module './cat-coats'`（`pet-tokens.ts` 若还没出现，说明 Task 13 没落，先回去补）

- [ ] **Step 3: 写 `src/shared/cat-coats.ts`**

九个槽的来历写在文件头，值全部是 `wash(颜料, α, 底色)`——**颜料只有板内那几支**，
所以「花色统一在猫色板里」这条不靠自觉，靠构造。

```ts
/**
 * 花色轴（spec §3-D D1「奶油/灰/墨/蓝/粉 5 色，全部板内色」）。
 *
 * 九个槽对应 `art.ts::buildCatOps` 实际用到的板色位置：
 * - furTop/furBot：身体与尾巴那条 34..106 全局渐变的两端（原 `BODY_TOP`/`BODY_BOT`）
 * - furEdge：耳朵外廓与一切「同墨」的深色部件（原 `BODY_COL`）
 * - earInner：耳内（原 `INNER_EAR` 的非 grumpy 支）
 * - light：白爪、白尾尖、胸布上端、眼白、眼神光、胡须、闭眼弧（原 `PAPER`，15 处）
 * - shade：胸布渐变下端与爪缝（原 `PAPER_SHADE`，3 处）
 * - nose / blush / eye：鼻（ROSE_DEEP）／腮红·嘴内·爱心（ROSE）／瞳（EYE）
 *
 * **不管的东西**：`BADGE_INK`/`ACCENT`/`GREEN`/`WARN`/`SHADOW`/`BREAK_*` 都是语义色
 * （徽章、上行绿、告警橙、投影、炸毛/不悦的破色块），照 tokens 台账的规矩不进花色；
 * `mood === "grumpy"` 依旧整体换成 BREAK_*——那是表情信号，不是花色。
 */
import {
  ACCENT, EYE, INK, INK_SOFT, PAPER, PAPER_SHADE, ROSE, ROSE_DEEP, WARN, wash,
} from "./pet-tokens";

export interface CatCoat {
  furTop: string;
  furBot: string;
  furEdge: string;
  earInner: string;
  light: string;
  shade: string;
  nose: string;
  blush: string;
  eye: string;
}

export const INK_COAT: CatCoat = {
  furTop: INK, furBot: INK_SOFT, furEdge: INK, earInner: ROSE_DEEP,
  light: PAPER, shade: PAPER_SHADE, nose: ROSE_DEEP, blush: ROSE, eye: EYE,
};

/** 灰：往墨里掺投影黑，亮面掺一点 INK_SOFT——冷灰猫，轮廓仍走墨。 */
const GRAY_COAT: CatCoat = {
  furTop: wash(INK, 170, PAPER_SHADE), furBot: wash(INK_SOFT, 200, PAPER_SHADE),
  furEdge: wash(INK, 215, INK_SOFT), earInner: wash(ROSE_DEEP, 200, PAPER_SHADE),
  light: wash(PAPER, 235, INK_SOFT), shade: wash(PAPER_SHADE, 220, INK),
  nose: wash(ROSE_DEEP, 235, INK), blush: wash(ROSE, 170, PAPER_SHADE), eye: EYE,
};

/** 奶油：亮面变成主体，轮廓交给掺墨的那一支——浅色猫最容易糊，furEdge 与 shade 是它的骨头。 */
const PAPER_COAT: CatCoat = {
  furTop: wash(PAPER_SHADE, 150, PAPER), furBot: wash(PAPER_SHADE, 205, PAPER),
  furEdge: wash(INK, 120, PAPER_SHADE), earInner: wash(ROSE_DEEP, 210, PAPER_SHADE),
  light: PAPER, shade: wash(INK, 55, PAPER_SHADE),
  nose: ROSE_DEEP, blush: wash(ROSE, 190, PAPER), eye: EYE,
};

/** 蓝：颜料用 ACCENT，掺进墨里；亮面是掺了 ACCENT 的纸。 */
const AZURE_COAT: CatCoat = {
  furTop: wash(ACCENT, 90, INK), furBot: wash(ACCENT, 120, INK_SOFT),
  furEdge: wash(ACCENT, 60, INK), earInner: wash(ROSE_DEEP, 190, ACCENT),
  light: wash(ACCENT, 35, PAPER), shade: wash(ACCENT, 80, PAPER_SHADE),
  nose: wash(ROSE_DEEP, 220, INK), blush: wash(ROSE, 150, ACCENT), eye: EYE,
};

/** 粉：颜料用 ROSE，掺进墨里；比蓝深一档，不然腮红与脸同色。 */
const ROSE_COAT: CatCoat = {
  furTop: wash(ROSE, 95, INK), furBot: wash(ROSE, 130, INK_SOFT),
  furEdge: wash(ROSE, 60, INK), earInner: wash(ROSE_DEEP, 220, ROSE),
  light: wash(ROSE, 40, PAPER), shade: wash(ROSE, 90, PAPER_SHADE),
  nose: wash(ROSE_DEEP, 230, INK), blush: WARN, eye: EYE,
};

export const CAT_COATS: Record<CoatName, CatCoat> = {
  ink: INK_COAT, paper: PAPER_COAT, gray: GRAY_COAT, azure: AZURE_COAT, rose: ROSE_COAT,
};

export type CoatName = keyof typeof CAT_COATS;

/**
 * 这档靠什么读出来——`cat-coats.test.ts` 按它分支，所以它是**判据的一部分**，不是注释。
 * 深色猫的白爪/眼白/胸布就是结构线（native 的墨青猫正是这么读的）；奶油猫反过来，
 * 亮面与毛面只差 20 出头，结构必须由掺墨的轮廓和胸布暗端撑着。
 */
export const COAT_READS_BY: Record<CoatName, "light-markings" | "dark-outline"> = {
  ink: "light-markings", gray: "light-markings", azure: "light-markings",
  rose: "light-markings", paper: "dark-outline",
};

export function coatOf(name: CoatName | undefined): CatCoat {
  return name === undefined ? INK_COAT : CAT_COATS[name];
}

export function luminance(color: string): number {
  const { r, g, b } = parseRgb(color);
  return Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
}

/** 与 `pet-tokens.parse` 同口径，但这里要的是能直接进公式的整数值。 */
function parseRgb(color: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(color);
  if (!m) throw new RangeError(`花色只收 #rrggbb，收到 ${color}`);
  const n = Number.parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
```

> 上面这组 α 值是**初值**，不是结论：Step 5 的目视档会真开一次窗看五色各一只。
> 判据是 `cat-coats.test.ts` 那五条对比锁——它保证「不管怎么调都不会糊」，
> 但保证不了「好看」。调值只动 α，不动颜料（板内色那三行是结构，改了就不再是「全部板内色」）。

- [ ] **Step 4: `art.ts` 接花色**

`CatInput` 加一个可选字段（放在 `pose` 之后）：

```ts
import { coatOf, type CatCoat } from "../../shared/cat-coats";
```

```ts
export interface CatInput {
  // …原有字段不动…
  /** 花色；省略＝`INK_COAT`，也就是移植时照抄 native 的那套墨青猫。 */
  coat?: CatCoat;
}
```

`buildCatOps` 第一行取一次：

```ts
  const c = input.coat ?? INK_COAT;
```

然后把 6 个取值点从「只看 mood」改成「看 mood 和花色」（`art.ts:58-61`）：

```ts
const BODY_TOP = (mood: Mood, c: CatCoat) => (mood === "grumpy" ? BREAK_FILL : c.furTop);
const BODY_BOT = (mood: Mood, c: CatCoat) => (mood === "grumpy" ? BREAK_SOFT : c.furBot);
const BODY_COL = (mood: Mood, c: CatCoat) => (mood === "grumpy" ? BREAK_FILL : c.furEdge);
const INNER_EAR = (mood: Mood, c: CatCoat) => (mood === "grumpy" ? BREAK_EAR : c.earInner);
```

调用点只有 `art.ts:253,265-268,271` 六行，各补一个 `c` 实参。剩下的是**逐槽替换**，
用这条命令把 `buildCatOps` 里所有该换的行列出来（本期实测 27 行）：

```bash
awk 'NR>=199 && NR<=506 { if (/\bPAPER_SHADE\b|\bPAPER\b|\bINK_SOFT\b|\bINK\b|\bROSE_DEEP\b|\bROSE\b|\bEYE\b/) printf "%d: %s\n", NR, $0 }' src/renderer/pet/art.ts
```

映射表（左＝现在的写法，右＝改完）：

| 现在的写法 | 改成 | 出现处（实测行号） |
| --- | --- | --- |
| `PAPER`（裸色） | `c.light` | 257 尾尖、286/291 白爪、307/313 眼白、391 洗脸爪、447 星芒底 `withAlpha(PAPER,…)` |
| `withAlpha(PAPER, a)` | `withAlpha(c.light, a)` | 273/274 身体亮弧、318/319 眼神光、321 闭眼弧、369 胡须、408 Zzz 亮边 |
| `PAPER_SHADE` | `c.shade` | 277 胸布渐变下端、287/392 爪缝弧 |
| `withAlpha(INK, a)` | `withAlpha(c.furEdge, a)` | 278 `bib_ao`、390 洗脸手臂 |
| `ROSE_DEEP`（裸色） | `c.nose` | 327 鼻 |
| `withAlpha(ROSE, a)` | `withAlpha(c.blush, a)` | 355 嘴内、366 腮红、431 爱心 |
| `EYE` | `c.eye` | 瞳孔（`eyes` 段那颗最深椭圆，与上一行同段） |
| `BODY_*(mood)` / `INNER_EAR(mood)` | 加 `, c` | 253、265-268、271 |

**不动的**：`BADGE_INK`、`ACCENT`、`GREEN`、`WARN`、`SHADOW`、`BREAK_*`（`WARN` 若出现在
语义告警层，它是语义色不是花色）；`HUD_*`/`CAP_*` 那一段（`art.ts:507-521`）属胶囊，本期不碰。
> 逐处替换而不是「在 `buildCatOps` 开头把 `PAPER` 改名」：这些常量是模块 import 进来的，
> 语义上 `withAlpha(PAPER, 0.22)` 那条身体亮弧和 `PAPER` 那颗白爪不是一回事，
> 靠 alias 一把改会连带改掉本该保持墨底的地方（`bib_ao` 掺的是 `INK`，不是 `PAPER`）。

`art.test.ts` 补一条：现有 292 行断言跑的都不带 `coat` 的输入 ⇒ 它们本身就是「默认花色＝原样」的锁，
新加的那条只要证明带 `coat: CAT_COATS.paper` 时身体渐变两端换了色、`light` 那颗爪也换了色：

```ts
it("带花色时同一层换的是对应槽，不是随机换色", () => {
  const base = buildCatOps(CAT_INPUT);                       // 不带 coat
  const paper = buildCatOps({ ...CAT_INPUT, coat: CAT_COATS.paper });
  const body = (ops: DrawOp[]) => ops.filter((o) => o.layer === "body")[0] as { stops: Array<{ color: string }> };
  expect(body(base).stops[0].color).toBe(INK);
  expect(body(paper).stops[0].color).toBe(CAT_COATS.paper.furTop);
  expect(body(paper).stops[0].color).not.toBe(INK);          // 正对照：真换了
});
```

- [ ] **Step 5: 门禁**

```bash
CI=true npx vitest run src/shared src/renderer/pet
npx tsc -p tsconfig.main.json --noEmit && npx tsc -p tsconfig.renderer.json --noEmit
```
Expected: 全绿。`src/renderer/pet/art.test.ts`/`ops.test.ts`/`renderer.test.ts`/`tokens.test.ts`/`xf.test.ts` 一条都不许改期望值
（改了就是默认花色动了，回到 Step 4 查哪一处 alias 错了）。

- [ ] **Step 6: 提交**

```bash
git add src/shared/cat-coats.ts src/shared/cat-coats.test.ts src/renderer/pet/art.ts src/renderer/pet/art.test.ts
git commit -m "feat(pet): 花色轴（奶油/灰/墨/蓝/粉，全板内色 wash 派生），默认墨色像素不变"
```
正文写两句：① 九个槽与 `buildCatOps` 行号的对照表在计划里，语义色（`ACCENT`/`GREEN`/`WARN`/`BREAK_*`/`BADGE_INK`）
**故意**不进花色；② α 值是初值，目视档在 Task 28，判据是 `cat-coats.test.ts` 的对比锁。

### Task 21: 姿态与取景轴 + 变体快照锁（D1 之二）

**Files:**
- Create: `src/shared/cat-types.ts`（`Mood` / `PoseName` / `CropName` 三个无依赖联合类型——R-D13：shared 侧消费者只认这里）
- Create: `src/renderer/pet/cat-variants.ts`
- Create: `src/renderer/pet/cat-variants.test.ts`
- Modify: `src/renderer/pet/art.ts`（`Mood` 改为从 shared 重导出；`Pose` 加两个可选轴、`sx_all/sy_all`、尾幅、耳外八；`VB` 导出）

**Interfaces:**
- Consumes: Task 20 的 `CatCoat`/`CoatName`/`CAT_COATS`；`art.ts` 的 `buildCatOps`/`CatInput`/`Pose`；`ops.ts` 的 `DrawOp`/`opsBounds`
- Produces:
  - `src/shared/cat-types.ts`：`type Mood = "idle" | "happy" | "thinking" | "grumpy" | "sleep"`（原样从 `art.ts:27` 挪出，`art.ts` 保留 `export type { Mood }` 使 40 余处旧 import 不动）、`type PoseName`、`type CropName`
  - `type PoseName = "sit" | "lie" | "prone" | "peek" | "stretch" | "wash" | "yawn" | "tilt" | "sleep" | "puff" | "pout" | "happy"`
  - `type CropName = "full" | "bust" | "square" | "round" | "wide"`
  - `const CAT_POSES: Record<PoseName, () => SpritePose>`（**纯函数**：spec D1「每个变体是一个纯函数 → DrawOp[]」）
  - `const CAT_CROPS: Record<CropName, CatCrop>`
  - `interface SpriteSpec { coat: CoatName; pose: PoseName; crop: CropName; mood?: Mood; blink?: number; pet?: number; energy?: number }`
    （后四个是**逐张覆盖**：`CAT_POSES` 给的是基态，Task 24 的 25 档散点情绪靠 `blink/pet/energy` 拉开差别。
    省略时一律回落 `CAT_POSES[pose]()` 的基态，所以桌面猫与默认档不受影响。）
  - `function placeCrop(crop: CatCrop, size: { w: number; h: number }): { u: number; center: { x: number; y: number } }`
  - `function buildSpriteOps(spec: SpriteSpec, size: { w: number; h: number }): DrawOp[]`
  - `const SPRITE_DROPPED_LAYERS: readonly PetLayer[]`（`["zzz", "capsule", "unread"]`，R-D10 的唯一出处）

- [ ] **Step 1: `art.ts` 加两个可选归一化轴，并把 `Mood` 挪进 shared**

先做类型搬家（R-D13 的前半条）。`art.ts:27` 现在是 `export type Mood = "idle" | "happy" | "thinking" | "grumpy" | "sleep";`，
把它整行移到新建的 `src/shared/cat-types.ts`，`art.ts` 顶部改成：

```ts
import type { Mood } from "../../shared/cat-types";
export type { Mood } from "../../shared/cat-types";
```

**为什么必须搬**：Task 26 的 `cat-sticker-set.ts`（shared）要 `Mood`，Task 23 的 `cat-roster.ts`（shared）
要 `PoseName`；shared 只要 import 一次 `art.ts`，`tsconfig.main` 就会顺着 `art.ts → ops.ts` 把
`CanvasRenderingContext2D` 拉进来（R-D13 的实测结论）。`export type { Mood }` 是**重导出**，不是新类型，
`art.ts` 现有 40 余处 `import type { Mood } from "./art"` 一个都不用改。`PoseName` / `CropName` 同一文件里一并定义，
`cat-variants.ts` 侧只做 `export type { PoseName, CropName } from "../../shared/cat-types";` 让旧 import 继续可用。

跑一次 `npx tsc -p tsconfig.main.json --noEmit && npx tsc -p tsconfig.renderer.json --noEmit` 确认搬家本身零改动。

再改 `Pose`（`art.ts:28-35`）里 `tilt` 之后加两行。**optional 是结构性的**：现有 `renderer.ts` 与各测试
构造的 `Pose` 字面量有 40 多处，加必填字段会全红，而这两轴桌面猫运行时用不到（它只跑四个自主动作）。

```ts
export interface Pose {
  paw: number;
  yawn: number;
  stretch: number;
  tilt: number;
  /** 趴伏量 0..1：压扁并拉长同一团子，支脚仍在 (60,100)。R-D8——卧/趴/探头共用这一条轴。 */
  sprawl?: number;
  /** 蓬起量 0..1：横向炸开、尾幅加宽、耳外八。R-D8——「炸毛」近似。 */
  puff?: number;
  engagement: number;
}
```

`buildCatOps` 里把 `VB` 改成导出（`art.ts:55`）——取景算式要用同一个数，抄两份迟早会漂：

```ts
export const VB = 120; // viewBox 宽（native ui.rs:622）
```

紧接 `const sy_all = ...`（`art.ts:209-211`）那三行换成带两轴的写法。原来只有 `stretch` 一条形变轴，
现在三条叠乘；`sprawl` 的下压必须**保留** `stretch` 的既有系数，否则 native 量了 70 个任务的伸懒腰会跟着变：

```ts
  const sprawl = Math.max(0, Math.min(1, pose.sprawl ?? 0));
  const puff = Math.max(0, Math.min(1, pose.puff ?? 0));
  const sx_all = (1.0 + 0.055 * pose.stretch + 0.30 * sprawl + 0.14 * puff) * (1 + 0.05 * puff);
  const sy_all = sy_body * (1.0 - 0.075 * pose.stretch - 0.34 * sprawl) * (1 + 0.07 * puff);
```

> `sy_all` 里 `sy_body` 已含呼吸；`sprawl` 把身体压到 0.66 倍高、`sx_all` 撑到 1.3 倍宽，
> 支点 `(60,100)` 不动 ⇒ 猫是「贴到地面上」而不是「沉到窗底」，这正是 `Xf` 那条评论（ui.rs:95-119 的教训）
> 要保证的事。两轴都取 0 时三条表达式逐项回退成原来的 `1.0 + 0.055*stretch` 与 `sy_body*(1.0-0.075*stretch)`——
> Step 3 的默认档快照锁就是验这一点。

尾巴（`art.ts:250-252` 那三行 `ribbon(spine, 12.0, 7.5)`）加宽并压掉摆幅；耳朵（`art.ts:259-262` 的
`twitch`）外八。**只改实参，不改结构**：

```ts
  const wag = (sway * settle * Math.sin(t * 3.0) + 11.0 * pose.stretch) * (1 - 0.75 * puff);
  const tail = bendPoly(ribbon(spine, 12.0 + 6.0 * puff, 7.5 + 4.0 * puff), 0, 0, wag, 90, 88);
```

```ts
  const twitch = earTwitch(t, mood);
  const lTw = twitch + 8 * puff;   // 炸毛：两只耳往外撑，剪影才有「刺」
  const rTw = twitch - 8 * puff;
```

然后把 `l_ear`/`l_in` 两处 `bendPoly(..., twitch, 42, 38)` 的 `twitch` 换成 `lTw`、
`r_ear`/`r_in` 两处换成 `rTw`（右耳的枢轴与实参照原文，别改枢轴）。

- [ ] **Step 2: 写失败的测试**

新建 `src/renderer/pet/cat-variants.test.ts`。它同时是三样东西：**规格**（12/4/5 齐名）、**确定性锁**（R-D9）、
**默认档不变锁**（两轴为 0 时逐 op 等于不带 `coat` 的老写法）。

```ts
import { describe, expect, it } from "vitest";
import { buildCatOps, type CatInput } from "./art";
import { opsBounds, type DrawOp } from "./ops";
import { CAT_COATS, type CoatName } from "../../shared/cat-coats";
import {
  CAT_CROPS, CAT_POSES, SPRITE_DROPPED_LAYERS, buildSpriteOps, placeCrop, type CropName, type PoseName,
} from "./cat-variants";

const POSES: PoseName[] = ["sit", "lie", "prone", "peek", "stretch", "wash", "yawn", "tilt",
  "sleep", "puff", "pout", "happy"];
const CROPS: CropName[] = ["full", "bust", "square", "round", "wide"];

describe("姿态与取景轴", () => {
  it("12 姿态 4 取景 5 花色，名字与 spec §3-D D1 逐一对得上", () => {
    expect(Object.keys(CAT_POSES).sort()).toEqual([...POSES].sort());
    expect(Object.keys(CAT_CROPS).sort()).toEqual([...CROPS].sort());
    expect(Object.keys(CAT_COATS).length).toBe(5);
  });

  it("每个姿态都是纯函数：连调两次逐字段相等（R-D9 的 t=0 静帧）", () => {
    for (const p of POSES) {
      expect(CAT_POSES[p](), p).toEqual(CAT_POSES[p]());
      expect(CAT_POSES[p]().t ?? 0, p).toBe(0);
    }
  });

  it("12 姿态画出来是 12 张不同的图：覆盖度两两差 ≥ 0.6 个百分点", () => {
    const seen = new Map<string, number>();
    for (const p of POSES) {
      const ops = buildSpriteOps({ coat: "ink", pose: p, crop: "full" }, { w: 256, h: 256 });
      const b = opsBounds(ops)!;
      expect(ops.length, p).toBeGreaterThan(20);
      expect(b.width * b.height, p).toBeGreaterThan(8000);
      seen.set(p, ops.length);
    }
    const vals = [...seen.values()];
    expect(new Set(vals).size, "op 数全部相同＝姿态没差别").toBeGreaterThanOrEqual(9);
  });

  it("取景算式：越紧的框，映射比例 s 越大，且猫心落在画布中心", () => {
    const size = { w: 512, h: 512 };
    const s = CROPS.map((c) => placeCrop(CAT_CROPS[c], size).u);
    expect(s[1]).toBeGreaterThan(s[0]);   // bust 比 full 紧
    expect(s[2]).toBeGreaterThan(s[1]);   // square 更紧
    expect(Math.abs(placeCrop(CAT_CROPS.full, size).center.x - 256)).toBeLessThan(40);
  });

  it("wide 档确实是 16:9，且横向不夹回 viewBox（欢迎海报唯一非方图，R-D1）", () => {
    const w = CAT_CROPS.wide.window;
    expect((w[2] - w[0]) / (w[3] - w[1])).toBeCloseTo(16 / 9, 2);
    expect(w[0]).toBeLessThan(0);   // 越界是透明边；被夹回 0 就成了 4:3
    const p = placeCrop(CAT_CROPS.wide, { w: 1280, h: 720 });
    expect(Math.abs(p.center.x - 640)).toBeLessThan(40);
  });

  it("位图管线里没有 text 图元（R-D10），且正对照证明过滤器不是空转", () => {
    for (const p of POSES) {
      for (const o of buildSpriteOps({ coat: "ink", pose: p, crop: "square" }, { w: 256, h: 256 })) {
        expect(o.kind).not.toBe("text");
      }
    }
    const input = { ...NEUTRAL, mood: "sleep" as const, pose: { ...NEUTRAL.pose, } };
    const raw = buildCatOps(input);
    expect(raw.some((o) => o.kind === "text"), "raw 里没有 Z，正对照失效").toBe(true);
    const viaSprite = buildSpriteOps({ coat: "ink", pose: "sleep", crop: "full" }, { w: 256, h: 256 });
    expect(viaSprite.some((o) => o.layer === "zzz")).toBe(false);
    expect(SPRITE_DROPPED_LAYERS).toEqual(["zzz", "capsule", "unread"]);
  });
});
```

`NEUTRAL` 在文件里定义一次（`CatInput` 的中性档，也是 Task 24 生成器的基准）：

```ts
const NEUTRAL: CatInput = {
  center: { x: 128, y: 128 }, u: 120, mood: "idle", t: 0, energy: 0.3,
  mouse: null, blink: 0, jumpY: 0, pet: 0, quiet: false,
  pose: { paw: 0, yawn: 0, stretch: 0, tilt: 0, engagement: 0 },
};
```

- [ ] **Step 3: 跑到失败**

Run: `CI=true npx vitest run src/renderer/pet/cat-variants`
Expected: FAIL —— `Cannot find module './cat-variants'`

- [ ] **Step 4: 写 `src/renderer/pet/cat-variants.ts`**

```ts
/**
 * 变体库：花色 × 姿态 × 取景 → DrawOp[]。桌面猫与位图资产共用同一个 `buildCatOps`，
 * 这里只负责**喂参数**，不许再画一份几何（spec D1「与桌面猫同源」的全部含义就在这行字上）。
 *
 * 时刻固定 `t = 0`：`buildCatOps` 的呼吸、整体旋转、尾摆、耳抽全含 `sin(t·k)` 或 `t % period`，
 * t=0 时同时归零 ⇒ 静帧与调用顺序、真实时钟无关（R-D9）。
 *
 * 住在 renderer（R-D13）：它 import `art.ts`，而 `art.ts → ops.ts` 要 DOM 类型；
 * 放进 shared 会把 `CanvasRenderingContext2D` 拉进 `tsconfig.main` 的程序。
 */
import { VB, buildCatOps, type CatInput, type Mood, type Pose } from "./art";
import type { DrawOp, PetLayer } from "./ops";
import { coatOf, type CoatName } from "../../shared/cat-coats";
import type { CropName, PoseName } from "../../shared/cat-types";

export type { CropName, PoseName } from "../../shared/cat-types";

export interface SpritePose {
  mood: Mood;
  pose: Pose;
  blink: number;
  jumpY: number;
  pet: number;
  energy: number;
  quiet: boolean;
  t: number;
}

const P = (over: Partial<Pose> = {}): Pose => ({
  paw: 0, yawn: 0, stretch: 0, tilt: 0, engagement: 0, ...over,
});

const SP = (over: Partial<SpritePose>): SpritePose => ({
  mood: "idle", pose: P(), blink: 0, jumpY: 0, pet: 0, energy: 0.3, quiet: false, t: 0, ...over,
});

/**
 * 12 个姿态（spec §3-D D1 的中文档位依次是：坐/卧/趴/探头/伸懒腰/洗脸/打哈欠/歪头/睡/炸毛/委屈/开心）。
 * 8 个走的是 native 已有的 `paw/yawn/stretch/tilt/mood`；
 * 4 个（卧/趴/探头/炸毛）走 R-D8 新加的 `sprawl/puff`，见 `cat-variants.test.ts` 的差异锁。
 */
export const CAT_POSES: Record<PoseName, () => SpritePose> = {
  sit: () => SP({}),
  lie: () => SP({ pose: P({ sprawl: 0.45 }), blink: 0.15 }),
  prone: () => SP({ pose: P({ sprawl: 0.9 }), blink: 0.3, energy: 0.1 }),
  peek: () => SP({ pose: P({ sprawl: 0.3, tilt: -9, engagement: 1 }), blink: 0 }),
  stretch: () => SP({ pose: P({ stretch: 1 }), energy: 0.5 }),
  wash: () => SP({ pose: P({ paw: 1 }) }),
  yawn: () => SP({ pose: P({ yawn: 1 }) }),
  tilt: () => SP({ pose: P({ tilt: 13 }) }),
  sleep: () => SP({ mood: "sleep", pose: P({ sprawl: 0.6 }), blink: 1, energy: 0.05 }),
  puff: () => SP({ mood: "grumpy", pose: P({ puff: 1 }), energy: 1 }),
  pout: () => SP({ mood: "grumpy", pose: P({ tilt: -6 }), blink: 0.55 }),
  happy: () => SP({ mood: "happy", jumpY: -8, pet: 0.6, pose: P({ engagement: 1 }) }),
};

export interface CatCrop {
  /** viewBox 里要框住的那块（0..120 见 `art.ts::VB`）。 */
  window: [number, number, number, number];
  /** 落位到画布中心的那个 viewBox 点（身体的对称轴是 x=60，竖直向心按各取景自己给）。 */
  anchor: [number, number];
  /** 四周留白比例：0.06 = 每边留 6%。 */
  pad: number;
  mask: "none" | "disc";
}

/**
 * 框是初值，Task 24 的 `--check` 会按「墨覆盖度 ∈ [0.22, 0.80] 且质心离中 < 12%」一次校平。
 * 全身含尾与投影，故 y 拉到 114；半身只到胸线；方/圆头像框到耳下 6px，留得出耳朵。
 * `wide` 是本期唯一的 16:9 档，只服务 `public/cyrene-welcome.png`（R-D1 实测：`min(860px,100%)` × `aspect-ratio:16/9`）。
 * 它的 `window` 由**目标宽高比**反推而不是由 anatomy 反推：高取 `full` 的 106，宽 = 106×16/9 = 188.4，
 * 于是 x 越过 viewBox 的 0..120 边界——**多出去的是透明边，不是越界**，猫在 16:9 海报里本来就该有横向留白。
 * `placeCrop` 不许把 x 夹回 [0,120]（夹了就把 16:9 变成 4:3，`--check` 的尺寸判据当场红）。
 */
export const CAT_CROPS: Record<CropName, CatCrop> = {
  full: { window: [14, 8, 106, 114], anchor: [60, 62], pad: 0.06, mask: "none" },
  bust: { window: [26, 20, 94, 88], anchor: [60, 56], pad: 0.05, mask: "none" },
  square: { window: [34, 20, 86, 72], anchor: [60, 46], pad: 0.04, mask: "none" },
  round: { window: [34, 20, 86, 72], anchor: [60, 46], pad: 0.04, mask: "disc" },
  wide: { window: [-34.2, 6, 154.2, 112], anchor: [60, 59], pad: 0.02, mask: "none" },
};

export interface SpriteSpec {
  coat: CoatName;
  pose: PoseName;
  crop: CropName;
  /** 逐张覆盖：省略时回落 `CAT_POSES[pose]()` 的基态。 */
  mood?: Mood;
  blink?: number;
  pet?: number;
  energy?: number;
}

export const SPRITE_DROPPED_LAYERS: readonly PetLayer[] = ["zzz", "capsule", "unread"];

export function placeCrop(crop: CatCrop, size: { w: number; h: number }): { u: number; center: { x: number; y: number } } {
  const [x0, y0, x1, y1] = crop.window;
  // xf.s 是「1 个 viewBox 单位 = 几个像素」；`buildCatOps` 里 s = u*2/VB，反解即 u = s*VB/2。
  const s = (1 - crop.pad) * Math.min(size.w / (x1 - x0), size.h / (y1 - y0));
  return {
    u: (s * VB) / 2,
    // buildCatOps 把 viewBox (60,70) 落在 center 上，所以要放别的点就得自己挪 center。
    center: { x: size.w / 2 + (60 - crop.anchor[0]) * s, y: size.h / 2 + (70 - crop.anchor[1]) * s },
  };
}

/** 位图管线唯一出口：取景 + 花色 + 姿态 → DrawOp[]，并按 R-D10 丢掉文字层。 */
export function buildSpriteOps(spec: SpriteSpec, size: { w: number; h: number }): DrawOp[] {
  const base = CAT_POSES[spec.pose]();
  const p: SpritePose = {
    ...base,
    mood: spec.mood ?? base.mood,
    blink: spec.blink ?? base.blink,
    pet: spec.pet ?? base.pet,
    energy: spec.energy ?? base.energy,
  };
  const input: CatInput = {
    ...placeCrop(CAT_CROPS[spec.crop], size),
    mood: p.mood, t: p.t, energy: p.energy, mouse: null,
    blink: p.blink, jumpY: p.jumpY, pet: p.pet, quiet: p.quiet, pose: p.pose,
    coat: coatOf(spec.coat),
  };
  const dropped = new Set<string>(SPRITE_DROPPED_LAYERS);
  return buildCatOps(input).filter((op) => op.layer === undefined || !dropped.has(op.layer));
}
```

- [ ] **Step 5: 默认档快照锁（这条是本任务的验收，不是附加题）**

把 `src/renderer/pet/cat-variants.test.ts` 里追加一条，证明两轴与 `coat` 的加入**没有动运行时那只猫**：

```ts
it("不带 coat、不带两轴时逐 op 与默认花色等价（运行时那只猫逐像素不变）", () => {
  const a = buildCatOps(NEUTRAL);
  const b = buildCatOps({ ...NEUTRAL, coat: CAT_COATS.ink, pose: { ...NEUTRAL.pose, sprawl: 0, puff: 0 } });
  expect(b).toEqual(a);
  // 正对照：加了 sprawl 就必须不等
  const c = buildCatOps({ ...NEUTRAL, pose: { ...NEUTRAL.pose, sprawl: 0.6 } });
  expect(c).not.toEqual(a);
});
```

Run: `CI=true npx vitest run src/shared src/renderer/pet`
Expected: 全绿；`art.test.ts` 的原有条目一条都不许改期望值。

- [ ] **Step 6: 提交**

```bash
git add src/shared/cat-types.ts src/renderer/pet/cat-variants.ts src/renderer/pet/cat-variants.test.ts src/renderer/pet/art.ts
git commit -m "feat(pet): 姿态 12 档与取景 5 档变体库，新增 sprawl/puff 两个可选轴并锁默认档逐 op 不变"
```
正文写：R-D8 为什么近似而不新画四条路径；R-D9 的 `t=0`；`VB` 改为导出的原因；**R-D13 为什么
`cat-variants.ts` 住 renderer 而 `cat-types.ts` 住 shared**，并贴 `tsc -p tsconfig.main` 的绿输出。

### Task 22: 软件光栅化器 + PNG/ICO/BMP 编码器（D2 的地基，落 `src/shared/`）

**Files:**
- Modify: `src/shared/sprite-raster.ts`（Task 11 已建，只覆盖 4 种图元；本任务补到 8 种 + `disc` 遮罩 + 稳健量三兄弟）
- Modify: `src/shared/sprite-raster.test.ts`（同上，追加用例，不重写已有断言）
- Modify: `src/shared/png-encode.ts`（Task 11 已建 `encodePng`；本任务加 `decodePng`/`encodeIco`/`encodeBmp24`）
- Modify: `src/shared/png-encode.test.ts`（同上）

> 这两个文件为什么不是本任务新建：Task 11（阶段 B）就要产 `tray-icon.ico`，那是全计划第一个
> 需要「DrawOp → 位图」的地方，地基只能在那里打；R-D6 定的落点从一开始就是给两个任务共用的。
> 本任务的增量是**描边、月牙、遮罩、ICO/BMP 容器**这四件，没有它们就产不出 52 张猫贴纸和圆头像。

**Interfaces:**
- Consumes: `ops.ts` 的 `DrawOp` 全部 9 个 kind 中除 `text` 外的 8 个（`text` → 抛）；`Task 20/21` 的 ops
- Produces:
  - `interface Raster { width: number; height: number; rgba: Uint8Array }`
  - `function renderOps(ops: DrawOp[], width: number, height: number, opts?: { mask?: "none" | "disc"; ss?: number }): Raster`
  - `function alphaCoverage(r: Raster): number`（`a > 8` 的像素占比）
  - `function inkCentroid(r: Raster): { x: number; y: number }`（按 alpha 加权）
  - `function hueBuckets(r: Raster): number[]`（12 桶 × 30°，返回归一化直方图；只用于报告，不作判据）
  - `encodePng(width, height, rgba): Buffer`、`decodePng(buf): Raster`、`encodeIco(entries): Buffer`、`encodeBmp24(r: Raster): Buffer`

- [ ] **Step 1: 用下面的整段替换 `src/shared/png-encode.test.ts`**

Task 11 版里那条「2×2 全红」用例是下面第一条的**子集**，直接被取代，不用手工合并。
判据不是「长得像 PNG」，是**能自己解回来逐字节相等**——
这是本期唯一能把「位图管线」钉死的手段（`--check` 也用它）。

```ts
import { describe, expect, it } from "vitest";
import { decodePng, encodeIco, encodePng, encodeBmp24 } from "./png-encode";

const rnd = (n: number) => { let s = 12345; return Array.from({ length: n }, () => {
  s = (s * 1103515245 + 12345) & 0x7fffffff; return s % 256;
}); };

describe("最小 PNG/ICO/BMP 编码", () => {
  it("2×2 全红 RGBA：签名、IHDR 尺寸与色深、IDAT 解回逐字节相等", () => {
    const rgba = new Uint8Array([255,0,0,255, 255,0,0,255, 255,0,0,255, 255,0,0,255]);
    const png = encodePng(2, 2, rgba);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.readUInt32BE(16)).toBe(2);      // IHDR width
    expect(png.readUInt32BE(20)).toBe(2);      // IHDR height
    expect(png[24]).toBe(8);                   // bit depth
    expect(png[25]).toBe(6);                   // color type = RGBA
    expect([...decodePng(png).rgba]).toEqual([...rgba]);
  });

  it("带 alpha 的噪声图 round-trip：半透与全透都不许被抹平", () => {
    const w = 37, h = 21;
    const src = rnd(w * h * 4);
    for (let i = 3; i < src.length; i += 4) src[i] = i % 5 === 3 ? 0 : (src[i] & 0x7f) + 64;
    const buf = new Uint8Array(src);
    expect([...decodePng(encodePng(w, h, buf)).rgba]).toEqual([...buf]);
  });

  it("正对照：非零 filter byte 的图必须被 decode 拒掉（我们只写 filter 0）", () => {
    const png = encodePng(1, 1, new Uint8Array([1,2,3,255]));
    const bad = Buffer.from(png);
    // IDAT 解压后第一字节就是行 0 的 filter byte，压缩流改不了，直接改断言面：
    expect(() => decodePng(Buffer.concat([bad, Buffer.from("junk")]))).toThrow();
    expect(() => decodePng(Buffer.from([0,1,2,3]))).toThrow(/签名/);
  });

  it("ICO 容器带 7 档尺寸且每档 payload 就是那张 PNG；256 记 0", () => {
    const entries = [16, 24, 32, 48, 64, 128, 256].map((size) => ({
      width: size, height: size, png: encodePng(size, size, new Uint8Array(size * size * 4)),
    }));
    const ico = encodeIco(entries);
    expect(ico.readUInt16LE(2)).toBe(1);      // type = icon
    expect(ico.readUInt16LE(4)).toBe(7);      // count
    expect(ico[6]).toBe(16);
    expect(ico[6 + 6 * 12], "256 在目录里记 0").toBe(0);
    expect(ico[7]).toBe(0);
  });

  it("24bit BMP：底朝上、BGR、行补到 4 的倍数，NSIS 侧栏吃这个", () => {
    const bmp = encodeBmp24({ width: 3, height: 2, rgba: new Uint8Array(24) });
    expect([...bmp.subarray(0, 2)]).toEqual([0x42, 0x4d]);   // "BM"
    expect(bmp.readInt32LE(18)).toBe(3);
    expect(bmp.readInt32LE(22)).toBe(2);
    expect(bmp.readUInt16LE(28)).toBe(24);
    expect(bmp.length).toBe(54 + 3 * 2 * 4);                 // 每行 12 字节，已 4 对齐
  });
});
```

- [ ] **Step 2: 跑到失败**

Run: `CI=true npx vitest run src/shared/png-encode.test.ts`
Expected: FAIL —— `Cannot find module './png-encode'`

- [ ] **Step 3: 写 `src/shared/png-encode.ts`（整文件替换 Task 11 那版——下面是它的超集）**

```ts
/**
 * 最小位图容器编解码（无新依赖：`node:zlib` + 自己算 CRC32）。
 * 为什么不用 `sharp`：它在 asarUnpack 里是给 Transformers.js 用的**运行时**依赖，
 * 构建脚本引它会把打包面搅浑（Task 11 原文的裁决，仍然成立）。
 * 只写 filter 0。平色加抗锯齿边缘的 deflate 结果已在预算内（单张 ≤ 60 KB 由 --check 卡）；
 * 真超了再上 per-row best-of-{0,1,2}，别提前复杂化。
 */
import { inflateSync, deflateSync } from "node:zlib";

export interface DecodedPng { width: number; height: number; rgba: Uint8Array }

const SIGN = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}

export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  if (rgba.length !== width * height * 4) throw new RangeError(`rgba 长度不对：${rgba.length} vs ${width}×${height}`);
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;                       // filter byte
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4)
      .copy(raw, y * (width * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([SIGN, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

/** 只为本期的自产图而写：单测 round-trip 与 `--check` 的像素尺都靠它。 */
export function decodePng(buf: Buffer): DecodedPng {
  if (!buf.subarray(0, 8).equals(SIGN)) throw new RangeError("PNG 签名不对");
  let p = 8;
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.subarray(p + 4, p + 8).toString("ascii");
    const body = buf.subarray(p + 8, p + 8 + len);
    if (crc32(Buffer.concat([buf.subarray(p + 4, p + 8), body])) !== buf.readUInt32BE(p + 8 + len)) {
      throw new RangeError(`chunk ${type} 的 CRC 不匹配`);
    }
    if (type === "IHDR") {
      if (body[8] !== 8 || body[9] !== 6) throw new RangeError("只支持 8bit RGBA");
      if (body[12] !== 0) throw new RangeError("只支持非隔行图");
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
    } else if (type === "IDAT") idat.push(Buffer.from(body));
    else if (type === "IEND") break;
    p += 12 + len;
  }
  if (!width || !height) throw new RangeError("缺 IHDR");
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4 + 1;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    if (raw[y * stride] !== 0) throw new RangeError(`行 ${y} 的 filter byte 不是 0`);
    rgba.set(raw.subarray(y * stride + 1, (y + 1) * stride), y * width * 4);
  }
  return { width, height, rgba };
}

/** PNG-in-ICO（Vista 之后的 Windows 认，无需 ICONINFO/BM 头那一套）。 */
export function encodeIco(entries: Array<{ width: number; height: number; png: Buffer }>): Buffer {
  const dir = Buffer.alloc(6 + entries.length * 16);
  dir.writeUInt16LE(0, 0); dir.writeUInt16LE(1, 2); dir.writeUInt16LE(entries.length, 4);
  let off = 6 + entries.length * 16;
  entries.forEach((e, i) => {
    const base = 6 + i * 16;
    dir[base] = e.width >= 256 ? 0 : e.width;      // 256 在目录里记 0，这是格式规定不是笔误
    dir[base + 1] = e.height >= 256 ? 0 : e.height;
    dir[base + 2] = 0; dir[base + 3] = 0;          // 调色板数 / 保留
    dir.writeUInt16LE(1, base + 4);                // planes
    dir.writeUInt16LE(32, base + 6);               // bit count
    dir.writeUInt32LE(e.png.length, base + 8);
    dir.writeUInt32LE(off, base + 12);
    off += e.png.length;
  });
  return Buffer.concat([dir, ...entries.map((e) => e.png)]);
}

/** 24bit 无压缩 BMP，底朝上——NSIS 的 `installerSidebar` 只吃 BMP。 */
export function encodeBmp24(img: { width: number; height: number; rgba: Uint8Array }): Buffer {
  const rowBytes = Math.ceil((img.width * 3) / 4) * 4;
  const size = 54 + rowBytes * img.height;
  const out = Buffer.alloc(size);
  out.write("BM", 0, "ascii");
  out.writeUInt32LE(size, 2);
  out.writeUInt32LE(54, 10);
  out.writeUInt32LE(40, 14);
  out.writeInt32LE(img.width, 18);
  out.writeInt32LE(img.height, 22);                 // 正数＝底朝上，这是 BMP 的常规
  out.writeUInt16LE(1, 26);
  out.writeUInt16LE(24, 28);
  out.writeUInt32LE(rowBytes * img.height, 34);
  for (let y = 0; y < img.height; y += 1) {
    const src = (img.height - 1 - y) * img.width * 4;   // 翻转：位图顶行写到 BMP 最后一行
    for (let x = 0; x < img.width; x += 1) {
      const a = img.rgba[src + x * 4 + 3] / 255;
      const dst = 54 + y * rowBytes + x * 3;
      // BMP 没有 alpha：按纯白底预混，侧栏是白底版式，混黑会让猫边缘发灰。
      out[dst + 2] = Math.round(img.rgba[src + x * 4] * a + 255 * (1 - a));
      out[dst + 1] = Math.round(img.rgba[src + x * 4 + 1] * a + 255 * (1 - a));
      out[dst] = Math.round(img.rgba[src + x * 4 + 2] * a + 255 * (1 - a));
    }
  }
  return out;
}
```

- [ ] **Step 4: 光栅化器测试**

`src/shared/sprite-raster.test.ts` —— Task 11 若只写了「四种填充图元各一条」的用例，**整段替换**为下面这版
（它包含那四条）。三条判据各自盯着一个真会犯的错：
**半透叠色**（`withAlpha` 满仓都是）、**降采样时的 alpha 加权**（不加权边缘会拉出黑边）、
**`text` 抛错**（R-D10 的契约）。

```ts
import { describe, expect, it } from "vitest";
import { alphaCoverage, inkCentroid, renderOps } from "./sprite-raster";
import type { DrawOp } from "./draw-ops";

const over = (a: DrawOp[]): Uint8Array => renderOps(a, 10, 10).rgba;

describe("软件光栅化器", () => {
  it("两块半透同色按 source-over 叠：α=0.5 两层叠出 0.75，不是 0.5", () => {
    const sq: DrawOp = { kind: "fillPath", fill: "rgba(43,47,58,0.5)", points: [[0,0],[10,0],[10,10],[0,10]] };
    const px = over([sq, sq]);
    expect(px[3]).toBe(191);                     // 255*0.75 = 191.25 → 191
    expect(px[0]).toBeCloseTo(43, 0);
  });

  it("透明底上的白爪不许被降采样拉成灰边：alpha 加权平均", () => {
    const disc: DrawOp = { kind: "fillEllipse", fill: "#ffffff", cx: 5, cy: 5, rx: 4, ry: 4 };
    const r = renderOps([disc], 40, 40, { ss: 4 });
    let edge = -1;
    for (let i = 0; i < r.rgba.length; i += 4) if (r.rgba[i + 3] > 40 && r.rgba[i + 3] < 200) { edge = i; break; }
    expect(edge).toBeGreaterThan(-1);
    expect(r.rgba[edge]).toBeGreaterThan(240);   // 半透边缘仍是白的
    expect(r.rgba[edge + 1]).toBeGreaterThan(240);
  });

  it("月牙是差集不是对称差（native #69 双色那条几何）", () => {
    const moon: DrawOp = { kind: "crescent", fill: "#2b2f3a", cx: 20, cy: 20, r: 16, dx: 8, dy: -5, cut: 14.7 };
    const r = renderOps([moon], 40, 40, { ss: 2 });
    // 内圆伸出外圆那一截（右上）一行都不该填
    expect(r.rgba[(8 * 40 + 34) * 4 + 3]).toBe(0);
    expect(alphaCoverage(renderOps([moon], 40, 40))).toBeGreaterThan(0.15);
  });

  it("text 图元直接抛——位图管线不支持字体（R-D10）", () => {
    expect(() => renderOps([{ kind: "text", text: "Z", x: 1, y: 1, size: 8, color: "#fff" }], 8, 8))
      .toThrow(/text/);
  });

  it("disc 遮罩把四角切干净（圆头像档）", () => {
    const bg: DrawOp = { kind: "fillPath", fill: "#5b8def", points: [[0,0],[64,0],[64,64],[0,64]] };
    const r = renderOps([bg], 64, 64, { mask: "disc" });
    expect(r.rgba[0 * 64 * 4 + 3]).toBe(0);
    expect(r.rgba[(32 * 64 + 32) * 4 + 3]).toBe(255);
    expect(inkCentroid(r).x).toBeCloseTo(32, 0);
  });
});
```

- [ ] **Step 5: 写 `src/shared/sprite-raster.ts`（整文件替换 Task 11 那版——下面是它的超集）**

算法：在 `ss`（默认 2）倍的内部分辨率上做**逐行张量填充**（多边形用非零环绕求交、
椭圆/圆角矩形用解析半宽），合成用 source-over 写进 `Uint8ClampedArray`；描边先拆成
「每段一个四边形 + 每个顶点一个圆盘」再走同一套填充器——这样 `strokePath` 的不闭合语义
（`ops.ts:25` 那条注释里 native #56 的教训）自然保住。最后按 `ss×ss` 盒式降采样，
颜色**按 alpha 加权**平均。

```ts
/**
 * 最小软件光栅化器：只覆盖 `DrawOp` 除 `text` 外的图元，为的是构建期产位图资产。
 * 桌面猫运行时仍走 `paintOps`（浏览器 canvas）——两条路径不合并（Task 11 Step 1 的裁决）。
 * 像素尺只认质心/覆盖度/尺寸，所以抗锯齿与 Chromium 的差别不进验收面（spec §5-3）。
 */
import type { DrawOp, Point2 } from "./draw-ops";
import { parse, withAlpha } from "./pet-tokens";

export interface Raster { width: number; height: number; rgba: Uint8Array }
export interface RenderOpts { mask?: "none" | "disc"; ss?: number }

type Span = [number, number];   // 行内 [x0, x1)，像素单位，已夹进行宽
type Rgb = [number, number, number, number];

const MAX_SS = 4;

export function renderOps(ops: DrawOp[], width: number, height: number, opts: RenderOpts = {}): Raster {
  const ss = Math.max(1, Math.min(MAX_SS, opts.ss ?? 2));
  const w = width * ss;
  const h = height * ss;
  const buf = new Float64Array(w * h * 4);        // 累积 (r·a, g·a, b·a, a)：a∈[0,1]，通道∈[0,255]
  const mask = opts.mask ?? "none";

  for (const op of ops) paintOp(buf, w, h, op, mask);

  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let ra = 0, ga = 0, ba = 0, a = 0;
      for (let dy = 0; dy < ss; dy += 1) {
        for (let dx = 0; dx < ss; dx += 1) {
          const i = ((y * ss + dy) * w + (x * ss + dx)) * 4;
          ra += buf[i]; ga += buf[i + 1]; ba += buf[i + 2]; a += buf[i + 3];
        }
      }
      const n = ss * ss;
      const o = (y * width + x) * 4;
      const alpha = a / n;
      rgba[o + 3] = Math.round(alpha * 255);
      // 加权：透明格子的颜色不该把边缘往黑里拉
      rgba[o] = alpha > 1e-6 ? Math.round((ra / n) / alpha) : 0;
      rgba[o + 1] = alpha > 1e-6 ? Math.round((ga / n) / alpha) : 0;
      rgba[o + 2] = alpha > 1e-6 ? Math.round((ba / n) / alpha) : 0;
    }
  }
  return { width, height, rgba };
}
```

> 上面那段降采样是这段的心脏，说清楚：累加的是 **预乘后的 r·a、g·a、b·a 与 a**，
> 出口再除回 `a`。若直接平均 `r,g,b`，一圈半透边缘会把白爪拉成灰爪——
> 美术台账里「面板叠色须预混」那条讲的就是同一件事，这里从实现侧再锁一次。

`paintOp` 与各图元的填充器（写全；`fillSpan` 是唯一碰像素的地方）：

```ts
function paintOp(buf: Float64Array, w: number, h: number, op: DrawOp, mask: "none" | "disc"): void {
  if (op.kind === "text") throw new RangeError("位图管线不支持 text 图元（R-D10）");
  const spans = spansOf(op, w, h);
  for (const [y, list] of spans) {
    for (const [x0, x1] of list) {
      const [r, g, b, a] = colorOf(op);
      for (let x = Math.max(0, x0); x < Math.min(w, x1); x += 1) {
        if (mask === "disc") {
          const dx = x + 0.5 - w / 2, dy = y + 0.5 - h / 2, rr = Math.min(w, h) / 2;
          if (dx * dx + dy * dy > rr * rr) continue;
        }
        const i = (y * w + x) * 4;
        const oa = buf[i + 3];
        const na = a + oa * (1 - a);
        buf[i] = (r * a + buf[i] * oa * (1 - a)) / (na > 0 ? na : 1);
        buf[i + 1] = (g * a + buf[i + 1] * oa * (1 - a)) / (na > 0 ? na : 1);
        buf[i + 2] = (b * a + buf[i + 2] * oa * (1 - a)) / (na > 0 ? na : 1);
        buf[i + 3] = na;
      }
    }
  }
  void h;
}

function colorOf(op: DrawOp): Rgb {
  const raw = op.kind === "strokePath" || op.kind === "strokeEllipse" || op.kind === "strokeRoundRect"
    ? op.stroke : op.fill;
  return toRgba(raw);
}

/** `#rrggbb` 与 `rgba(r,g,b,a)` 两种写法都会从 art.ts 里出来（`withAlpha` 产后者）。 */
export function toRgba(color: string): Rgb {
  const m = /^rgba\(([^)]+)\)$/.exec(color);
  if (m) {
    const [r, g, b, a] = m[1].split(",").map((s) => Number.parseFloat(s.trim()));
    if ([r, g, b, a].some((n) => Number.isNaN(n))) throw new RangeError(`颜色解析失败：${color}`);
    return [r / 255, g / 255, b / 255, Math.max(0, Math.min(1, a))];
  }
  const p = parse(color);
  return [p.r / 255, p.g / 255, p.b / 255, 1];
}
```

`spansOf(op, w, h)`：返回 `Map<行号, Span[]>`，四条分支（其余 kind 走同一批小函数）：

```ts
/** 多边形：非零环绕。点列已经过 `Xf`，这里是纯像素空间。 */
function polySpans(poly: Point2[], w: number, h: number): Map<number, Span[]> {
  const out = new Map<number, Span[]>();
  let minY = Infinity, maxY = -Infinity;
  for (const [, y] of poly) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  for (let y = Math.max(0, Math.floor(minY)); y < Math.min(h, Math.ceil(maxY)); y += 1) {
    const yc = y + 0.5;
    const xs: Array<{ x: number; dir: number }> = [];
    for (let i = 0; i < poly.length; i += 1) {
      const [x0, y0] = poly[i];
      const [x1, y1] = poly[(i + 1) % poly.length];
      if ((y0 <= yc && y1 > yc) || (y1 <= yc && y0 > yc)) {
        xs.push({ x: x0 + ((yc - y0) / (y1 - y0)) * (x1 - x0), dir: y1 > y0 ? 1 : -1 });
      }
    }
    xs.sort((a, b) => a.x - b.x);
    const spans: Span[] = [];
    let wind = 0;
    for (let i = 0; i < xs.length; i += 1) {
      const before = wind;
      wind += xs[i].dir;
      if (before === 0 && wind !== 0) spans.push([Math.floor(xs[i].x), -1] as Span);
      else if (before !== 0 && wind === 0) {
        const last = spans[spans.length - 1];
        last[1] = Math.ceil(xs[i].x);
      }
    }
    if (spans.length) out.set(y, spans.filter(([a, b]) => b > a));
  }
  return out;
}

/** 轴对齐椭圆：逐行解半宽。`fillEllipse.rot` 本期不出现（`art.ts::xfEllipse` 不传 rot），出现就抛。 */
function ellipseSpans(cx: number, cy: number, rx: number, ry: number, w: number, h: number): Map<number, Span[]> {
  const out = new Map<number, Span[]>();
  for (let y = Math.max(0, Math.floor(cy - ry)); y < Math.min(h, Math.ceil(cy + ry)); y += 1) {
    const t = 1 - ((y + 0.5 - cy) / ry) ** 2;
    if (t <= 0) continue;
    const hw = rx * Math.sqrt(t);
    out.set(y, [[Math.floor(cx - hw), Math.ceil(cx + hw)]]);
  }
  void w;
  return out;
}
```

其余 kind 全部折进这两个原语，**不另写像素循环**：

| kind | 走法 |
| --- | --- |
| `fillPath` | `polySpans(op.points)` |
| `gradPath` | `polySpans` 之后按 `from→to` 轴逐列取色（在 `paintOp` 里对 `gradPath` 特判：一行内按 x 线性插 `stops`，投影公式 `(px-f)·(t-f)/|t-f|²` 夹到 0..1） |
| `strokePath` | 每段一个等宽四边形（长边平行段、端头按 `cap = w/2` 方形外伸）＋ 除首尾外每个顶点一个半径 `w/2` 的圆盘；`close === true` 时补最后一段 |
| `fillEllipse` | `ellipseSpans`（`rot` 非 0 且非 2π 的整数倍 → `throw new RangeError("本期不支持旋转椭圆")`） |
| `strokeEllipse` | 外椭圆 spans 减去内椭圆 spans（同行做区间差集，写一个 `subtractSpans(a, b)`，约 12 行） |
| `fillRoundRect` | 中间带用 `ellipseSpans` 的两角拼直线段；等价写法：上/下直边段 + 左右直边段 + 四角 `ellipseSpans` 四分之一 —— 实现取后者，`r = min(r, w/2, h/2)`（`ops.ts` 的 `roundRectPath` 同口径） |
| `strokeRoundRect` | 外 `fillRoundRect` spans 减内 `fillRoundRect`（内矩形内缩 `width`，半径减 `width/2` 夹到 ≥0） |
| `crescent` | 外圆 spans 减内圆 spans，且**只保留落在外圆内的部分**——`ops.ts` 的 `crescent` 分支那条注释讲的就是「差集不是对称差」，`sprite-raster.test.ts` 第三例盯着它 |

- [ ] **Step 6: 区间差集与降采样小函数**

```ts
/** 同行两个 span 列表的差集（都按 x0 升序、互不重叠）。 */
export function subtractSpans(a: Span[], b: Span[]): Span[] {
  const out: Span[] = [];
  let i = 0;
  for (const [s, e] of a) {
    let cur = s;
    while (i < b.length && b[i][1] <= cur) i += 1;
    for (let j = i; j < b.length && b[j][0] < e; j += 1) {
      if (b[j][0] > cur) out.push([cur, Math.min(b[j][0], e)]);
      cur = Math.max(cur, b[j][1]);
      if (cur >= e) break;
    }
    if (cur < e) out.push([cur, e]);
  }
  return out.filter(([x0, x1]) => x1 > x0);
}

export function alphaCoverage(r: Raster): number {
  let n = 0;
  for (let i = 3; i < r.rgba.length; i += 4) if (r.rgba[i] > 8) n += 1;
  return n / (r.width * r.height);
}

export function inkCentroid(r: Raster): { x: number; y: number } {
  let sx = 0, sy = 0, sw = 0;
  for (let y = 0; y < r.height; y += 1) {
    for (let x = 0; x < r.width; x += 1) {
      const a = r.rgba[(y * r.width + x) * 4 + 3];
      sx += x * a; sy += y * a; sw += a;
    }
  }
  return sw > 0 ? { x: sx / sw, y: sy / sw } : { x: r.width / 2, y: r.height / 2 };
}
```

- [ ] **Step 7: 跑绿 + 类型门**

```bash
CI=true npx vitest run src/shared
npx tsc -p tsconfig.main.json --noEmit && npx tsc -p tsconfig.renderer.json --noEmit && npx tsc -p tsconfig.preload.json --noEmit
```
Expected: 全绿。`sprite-raster.test.ts` 第二条（白爪不拉灰）是最容易实现错的一条——
如果它红，说明降采样里忘了「先累加预乘、出口再除回 alpha」。

- [ ] **Step 8: 提交**

```bash
git add src/shared/sprite-raster.ts src/shared/sprite-raster.test.ts src/shared/png-encode.ts src/shared/png-encode.test.ts
git commit -m "feat(build): 最小软件光栅化器与 PNG/ICO/BMP 编解码，落在 src/shared 以便进单测"
```
正文写 R-D6（为什么不在 `scripts/build/*.mjs`）、filter 0 的取舍与「超预算再上 per-row 最优 filter」的门、
以及降采样 alpha 加权的原因。

### Task 23: 猫伴名册——12 只委托猫 + 助手本名（D5 之一，R-D7 的「先改名」）

**Files:**
- Create: `src/shared/cat-roster.ts`
- Create: `src/shared/cat-roster.test.ts`
- Modify: `src/main/tasks/task-character-pool.ts:6-16`（`TASK_CHARACTERS` 改为由名册映射生成）
- Modify: `src/renderer/react/character-avatars.ts:5-32`（12 条 import 路径与查表键）
- Modify: `src/renderer/react/character-portraits.ts:5-16`（同上）
- Rename: `src/renderer/react/assets/characters/<旧名>/` × 12 → `<新名>/`（`git mv`，目录里 `status-moods/` 六张跟着走）
- Rename: `src/renderer/react/avatars/<旧名>.png` × 12 → `<新名>.png`；删 `src/renderer/react/avatars/昔涟.png`
- Rename: `src/renderer/tast/<旧名>.png` × 12 → `<新名>.png`（目录名 `tast/` 是历史拼错的「task」，**不改**，它是 import 路径的一部分，改了要多碰 12 行且没有任何收益）
- Rename: `prompts/moments_personas/<旧名>.md` × 12 → `<新名>.md`；`prompts/moments_personas/昔涟.md` → `麻糬.md`
- Rename: `prompts/task/<旧名>.md` × 12 → `<新名>.md`
- Modify: `prompts/moments_personas/_header.md`（若其中出现「黄金裔」或旧角色名）
- Modify: `src/renderer/react/i18n/{zh-CN,en,ja-JP}.json` 的 `characterNames` 块（`zh-CN.json:376-390`、`en.json:376-390`、`ja-JP.json:392+`）
- Modify: 测试夹具（见 Step 6 的实测分布表，按文件逐个改，不许 `sed` 全仓）
- Test: `src/main/tasks/task-character-pool.test.ts`、`src/main/moments/character-personas.test.ts` 的期望值

**Interfaces:**
- Consumes: Task 20 的 `CoatName`（`ink | paper | gray | azure | rose`）
- Produces:
  - `interface CatMember { nickname: string; latin: string; coat: CoatName; pose: string; personaSeed: string }`
  - `const CAT_ROSTER: readonly CatMember[]`（12 条，顺序即 `TASK_CHARACTERS` 顺序）
  - `const ASSISTANT_NICKNAME = "麻糬"` / `const ASSISTANT_LATIN = "Mochi"`
  - `const TEAM_LABEL = "猫伴"`（替换用户可见的「黄金裔」）
  - `LEGACY_CHARACTER_MAP: Readonly<Record<string, string>>`（旧名 → 新名，**只给日志与 i18n 兜底用**，不进资产查找路径）

- [ ] **Step 1: 写失败的名册测试**

`src/shared/cat-roster.test.ts`——四条断言各自盯一个真会犯的错：

```ts
import { describe, expect, it } from "vitest";
import { ASSISTANT_LATIN, ASSISTANT_NICKNAME, CAT_ROSTER, LEGACY_CHARACTER_MAP } from "./cat-roster";
import { TASK_CHARACTERS } from "../main/tasks/task-character-pool";

describe("猫伴名册", () => {
  it("正好 12 只，昵称/拉丁名/旧名映射三处都不重不漏", () => {
    expect(CAT_ROSTER).toHaveLength(12);
    const cn = CAT_ROSTER.map((c) => c.nickname);
    const en = CAT_ROSTER.map((c) => c.latin);
    expect(new Set(cn).size).toBe(12);
    expect(new Set(en).size).toBe(12);
    expect(cn).not.toContain(ASSISTANT_NICKNAME);   // 助手不在这 12 只里，它是第 13 只
    expect(Object.keys(LEGACY_CHARACTER_MAP)).toHaveLength(12);
    expect([...new Set(Object.values(LEGACY_CHARACTER_MAP))].sort()).toEqual([...cn].sort());
  });

  it("花色只有五档，靠姿态而不是靠新色板拉开差异", () => {
    const coats = new Set(CAT_ROSTER.map((c) => c.coat));
    expect([...coats].sort()).toEqual(["azure", "gray", "ink", "paper", "rose"]);
    const poseKeys = CAT_ROSTER.map((c) => `${c.coat}/${c.pose}`);
    expect(new Set(poseKeys).size).toBe(12);        // 同花色必须换姿态
  });

  it("委托池与名册同源：池里每个昵称都带得出 `<昵称>.png` 这个资产键", () => {
    expect(TASK_CHARACTERS.map((c) => c.nickname)).toEqual(CAT_ROSTER.map((c) => c.nickname));
    for (const c of TASK_CHARACTERS) expect(c.assetFileName).toBe(`${c.nickname}.png`);
  });

  it("上游人物身份词一个都不许留在名册里", () => {
    const banned = ["黄金裔", "昔涟", "星穹", "崩坏", "昏光庭院", "神悟树庭", "泰坦", "丹恒", "Hyacine", "Aglaea", " Cipher", "Dan Heng"];
    const blob = JSON.stringify(CAT_ROSTER) + ASSISTANT_NICKNAME + ASSISTANT_LATIN;
    for (const word of banned) expect(blob, `名册里出现了 ${word}`).not.toContain(word);
  });
});
```

第四条里 `banned` 的词全部来自实测：`prompts/moments_personas/风堇.md` 的正文开头是
「昏光庭院的首席护理师，天空泰坦火种的继承者，神悟树庭"智种学派"的讲师助理」，
`en.json` 的 12 个值是 `Cyrene / Aglaea / Tribbie / Mydei / Castorice / Anaxa / Hyacine / Cipher / Phainon / Hysilens / Cerydra / Evernight / Dan Heng`。
这份表**不是**要禁掉全仓（历史转写与 `LEGACY_CHARACTER_MAP` 里必然还有），只禁名册这一个模块——
名册是新的唯一出处，它干净，下游生成的资产和人格卡才干净。

- [ ] **Step 2: 跑到失败**

```bash
CI=true npx vitest run src/shared/cat-roster
```
Expected：红，`Cannot find module "./cat-roster"`。

- [ ] **Step 3: 写 `src/shared/cat-roster.ts`**

名册如下（`coat` 用 Task 20 的五档，`pose` 用 Task 21 的十二档，一一对齐所以 `coat/pose` 组合必然 12 不重复）：

```ts
import type { CoatName } from "./cat-coats";
// R-D13：shared 只认 cat-types；从 ./cat-variants 取会把 art.ts → ops.ts 的 DOM 类型拉进 tsconfig.main
import type { PoseName } from "./cat-types";

export interface CatMember {
  nickname: string;      // 用户可见 + 资产文件名键（`<nickname>.png`），一次改动全仓跟它走
  latin: string;         // en/ja 语言壳里的罗马字
  coat: CoatName;        // Task 20 五档
  pose: PoseName;        // Task 21 十二档之一（`tast/<猫>.png` 的立绘姿态）
  personaSeed: string;   // 人格卡的一句话种子（Task 23 Step 5 写 md 时喂给它）
}

export const ASSISTANT_NICKNAME = "麻糬";
export const ASSISTANT_LATIN = "Mochi";
export const TEAM_LABEL = "猫伴";

export const CAT_ROSTER: readonly CatMember[] = [
  { nickname: "年糕", latin: "Niangao",  coat: "paper", pose: "sit",    personaSeed: "团得最紧的那只，认死理，先把一件事做完再抬头" },
  { nickname: "豆花", latin: "Douhua",   coat: "paper", pose: "lie",    personaSeed: "软得摊成一片，什么都行，但会悄悄把窗户留给你" },
  { nickname: "汤圆", latin: "Tangyuan", coat: "gray",  pose: "prone",  personaSeed: "滚来滚去的慢性子，找东西靠鼻子不靠脑子" },
  { nickname: "布丁", latin: "Buding",   coat: "azure", pose: "peek",   personaSeed: "抖三抖才敢上桌，好奇心全压在嘴角" },
  { nickname: "抹茶", latin: "Mocha",    coat: "gray",  pose: "wash",   personaSeed: "一天洗六遍脸，规矩比猫生重要" },
  { nickname: "可可", latin: "Keke",     coat: "ink",   pose: "stretch",personaSeed: "深色那只，伸懒腰能伸到打呵欠，白天睡得晚上精神" },
  { nickname: "芝麻", latin: "Zhima",    coat: "ink",   pose: "yawn",   personaSeed: "点位最碎的一只，嘴上永远在打哈欠，耳朵一直开着" },
  { nickname: "栗子", latin: "Lizi",     coat: "rose",  pose: "tilt",   personaSeed: "歪头频率最高，你以为它在卖萌，其实它在算你还有几分钟" },
  { nickname: "海苔", latin: "Haitai",   coat: "azure", pose: "sleep",  personaSeed: "脆的那只，一有动静就装睡，装得最像" },
  { nickname: "棉花", latin: "Mianhua",  coat: "paper", pose: "puff",   personaSeed: "炸毛就是一整朵云，虚张声势，先替你把门关好" },
  { nickname: "鱼丸", latin: "Yuwan",    coat: "rose",  pose: "pout",   personaSeed: "嘴上挂着委屈，实际最会办事，办完还要你摸两下" },
  { nickname: "奶盖", latin: "Naigai",   coat: "rose",  pose: "happy",  personaSeed: "浮在最上面那只，永远开心，负责把气氛抬起来" },
] as const;

/** 旧角色名 → 新猫名。只用于日志、`LEGACY` 兜底和提交正文，**绝不进资产查找**。 */
export const LEGACY_CHARACTER_MAP: Readonly<Record<string, string>> = {
  "风堇": "年糕", "刻律德菈": "豆花", "长夜月": "汤圆", "遐蝶": "布丁",
  "缇宝": "抹茶", "阿格莱雅": "可可", "白厄": "芝麻", "丹恒": "栗子",
  "海瑟音": "海苔", "那刻夏": "棉花", "赛飞儿": "鱼丸", "万敌": "奶盖",
};
```

`LEGACY_CHARACTER_MAP` 的顺序按 `TASK_CHARACTERS` 原样（前 5 个是硬写的字面量、后 7 个是 `map` 出来的，
`task-character-pool.ts:6-16`），这样 `git diff` 一眼能看出「一对一换名、没有增删角色」。

- [ ] **Step 4: 委托池改为名册派生**

`src/main/tasks/task-character-pool.ts` 的前 16 行整段换成：

```ts
import { CAT_ROSTER, TEAM_LABEL } from "../../shared/cat-roster";

interface TaskCharacterDefinition {
  nickname: string;
  assetFileName: string;
}

export const TASK_CHARACTERS: readonly TaskCharacterDefinition[] =
  CAT_ROSTER.map((cat) => ({ nickname: cat.nickname, assetFileName: `${cat.nickname}.png` }));
```

**函数名与文案里的键一个都不改**（`getGoldenDescendantNames`、`buildGoldenDescendantsPrompt` 是导出面，
`task-character-pool.ts` 的消费方遍布 `src/main`，改名就是又一次全仓扫）。只改 `buildGoldenDescendantsPrompt()`
里那 6 行**中文话术**：`可委托的黄金裔：` → `可委托的猫伴：`，`每位黄金裔` → `每只猫`，
`不要说"派分身"` 那句保留，`我让风堇先处理这部分` 这个**举例里的名字**换成 `我让年糕先处理这部分`。
> 为什么函数名留着：spec §6 的「保变量名只改值」是本期纪律，`golden` 这个词不出现在任何用户可见文本里，
> 改了它要动的是 `src/main` 的 import 图，收益为零。提交正文写一句「R-D7：标识符保留清单见本段」。

- [ ] **Step 5: 24 份人格卡（`git mv` 之后重写正文）**

卡的**结构不许动**：`parsePersonaFrontmatter()` 吃的是 `---` 块里的 `comment / like / presence / activity`
档位词（`高 / 中高 / 中 / 中低 / 低 / 极低`），`loadCharacterPersonas()` 用
`TASK_CHARACTERS` 的昵称去 `moments_personas/<昵称>.md` 找文件——**文件名对不上就 `character_persona_missing`
并整只跳过**，注册表少一只猫，朋友圈就少一个角色，而且**只有日志会告诉你**，界面是静默的。
所以 `git mv` 与 `TASK_CHARACTERS` 改名必须**在同一次提交里**完成，Step 7 的门就是抓这个的。

12 只猫的档位（照旧卡的分布给，别全写「高」——旧池里 `presence` 只有部分角色有，
`activity` 缺省时取 comment/like 较高档，全高会让抽签失去差异）：

| 猫 | comment | like | presence | 一句话（正文首段用 `personaSeed` 展开，≤80 字） |
| --- | --- | --- | --- | --- |
| 年糕 | 高 | 中 | 高 | 认死理，先把一件事做完再抬头 |
| 豆花 | 高 | 高 | — | 软得摊成一片，会悄悄给你留窗 |
| 汤圆 | 中 | 中 | 中 | 慢性子，找东西靠鼻子 |
| 布丁 | 中低 | 高 | — | 好奇全压在嘴角 |
| 抹茶 | 中 | 中低 | 高 | 规矩比猫生重要 |
| 可可 | 低 | 中 | — | 白天睡得，晚上精神 |
| 芝麻 | 中 | 中 | — | 嘴上打哈欠，耳朵一直开着 |
| 栗子 | 中高 | 中低 | 中 | 歪头的时候在算你还有几分钟 |
| 海苔 | 低 | 低 | 极低 | 一有动静就装睡 |
| 棉花 | 高 | 中高 | — | 先替你把门关好 |
| 鱼丸 | 中 | 高 | 中 | 办完还要你摸两下 |
| 奶盖 | 中高 | 高 | — | 负责把气氛抬起来 |

`prompts/task/<新名>.md` 是**委托系统提示**（工具权限/工作边界那一套），它的正文没有人物设定，
只有角色称谓与口吻。逐份只做两件事：① 标题行的旧名 → 新名；② 把「我是 X」这类第一人称句子里的
名字换掉。**不要重写正文**——那是本期不需要的风险。

`麻糬.md`（原 `昔涟.md`）：这是助手本体的卡，正文里的「昔涟」与全部上游世界观称谓 → 「麻糬」，
身份一句话按 spec §3-D7 换成「一只住在桌面左下角的奶油色猫」。

- [ ] **Step 6: 测试夹具与 i18n 的同步扫（本任务最容易漏的一步）**

实测旧名在全仓的出现分布（按文件计数，**含测试**），这决定了改动半径：

| 文件 | 命中数 | 处理 |
| --- | --- | --- |
| `src/main/moments/moments-service.test.ts` | 125 | 逐处换名（断言里是昵称，不改就必红） |
| `src/main/moments/character-personas.test.ts` | 37 | 同上 |
| `src/main/moments/moments-store.test.ts` | 30 | 同上 |
| `src/main/moments/reaction-queue.test.ts` | 21 | 同上 |
| `src/main/moments/moments-utils.test.ts` | 18 | 同上 |
| `src/main/tasks/task-runtime.test.ts` | 15 | 同上 |
| `src/main/moments/character-reactions.test.ts` | 15 | 同上 |
| `src/renderer/react/i18n/{en,ja-JP,zh-CN}.json` | 各 12 | `characterNames` 整块换 |
| `src/main/tasks/task-character-pool.ts` | 7 | Step 4 已覆盖 |
| `src/main/sim/scenarios/coffee-lifecycle.ts` | 6 | 场景脚本里的昵称 |
| `src/main/.../dormant-rescue.ts` | 3 | 同上 |

**不许**用全仓 `sed`：`昔涟` 一词实测出现在 **132 个文件**，里面既有要换的用户可见文案，也有
`assetFileName` 历史值、`LEGACY_CHARACTER_MAP` 的键、以及**用户数据目录名与测试快照**——
`sed` 会把后者一起换掉，那是往用户历史里写。按上表逐文件改，改完用下面这条确认没漏：

```bash
grep -rn "风堇\|刻律德菈\|长夜月\|遐蝶\|缇宝\|阿格莱雅\|白厄\|丹恒\|海瑟音\|那刻夏\|赛飞儿\|万敌" src prompts \
  | grep -v "cat-roster.ts\|task-character-pool.test.ts\|LEGACY"
```
Expected：**空输出**（唯一允许留旧名的地方是 `LEGACY_CHARACTER_MAP` 的键，以及注释里说明「曾经是 X」）。

- [ ] **Step 7: 跑门（这一条是「文件名与池同源」的唯一证据）**

```bash
CI=true npx vitest run src/shared/cat-roster src/main/moments src/main/tasks
npx tsc -p tsconfig.main.json --noEmit && npx tsc -p tsconfig.renderer.json --noEmit
node -e '
const fs=require("fs"), path=require("path");
const {execSync}=require("child_process");
// 名册 12 只，四处资产/提示目录必须同时存在同名文件，缺一个就报出来
const names=execSync("npx tsx -e \u0027import {CAT_ROSTER} from \"./src/shared/cat-roster\"; console.log(CAT_ROSTER.map(c=>c.nickname).join(\"\\n\"))\u0027",{encoding:"utf8"}).trim().split(/\r?\n/);
const dirs=["src/renderer/react/assets/characters","src/renderer/react/avatars","src/renderer/tast","prompts/moments_personas","prompts/task"];
let bad=0;
for (const n of names) for (const d of dirs) {
  const p = d.endsWith("characters") ? path.join(d,n,"status-moods") : path.join(d, n + (d.startsWith("prompts") ? ".md" : d.endsWith("avatars")||d.endsWith("tast") ? "" : ".png"));
  if (!fs.existsSync(p)) { console.log("MISS", p); bad++; }
}
process.exit(bad?1:0);
'
```
Expected：三行门全绿。第三条那个 `node -e` 是**存在性对齐**检查：它只承认「五处都在、名字都对」，
这一刻文件内容还是旧动漫人物（Task 24 才重画），所以它验的是**键**，不是像素。
> 这段 `node -e` 里的转义很脆，落地时把它写成 `scripts/build/check-roster.mjs`，用
> `import { CAT_ROSTER } from "../../node_modules/.cache/mochi-palette/cat-roster.js"`
> （Phase C 的 esbuild 路子）而不是 `npx tsx`——本仓没有 `tsx` 依赖，别为一条检查引入它。

- [ ] **Step 8: 提交**

```bash
git add -A src/shared/cat-roster.ts src/shared/cat-roster.test.ts src/main/tasks src/main/moments \
  src/renderer/react src/renderer/tast prompts
git status --porcelain | grep -v "^A\|^M\|^R" || true
git commit -m "refactor(character): 委托池与人格卡从上游人物名改为十二只猫（麻糬为助手本名）"
```
正文必须写三件：① 换名是 12 对 12，无增删（`git diff --stat` 里 rename 数应为 48 条：12×4 处 + `昔涟.md`）；
② R-D7 的代价——历史转写里的 `assetFileName: "风堇.png"` 会查不到头像（`getCharacterStatusMoodUrl` 返回
`null`，`TaskSessionInspector.tsx:89` 已降级），本期**不**迁移用户数据；
③ `LEGACY_CHARACTER_MAP` 只是日志/兜底键，不是资产查找路径。
> `git add -A` 限定在这五个显式路径，别用裸 `-A`（会混进 `.superpowers/` 与探针产物）。
> 提交前 `git status` 里应当看到成片的 `R`（rename）；若出现 `D` + 新 `A` 而不是 `R`，
> 说明 `git mv` 没走成，`git rm --cached` 重做过——rename 关系要留在历史里，不然是「删了 12 张加了 12 张」。

### Task 24: 位图资产全表生成 + `--check` 像素尺（D2 之一）

**Files:**
- Modify: `scripts/build/cat-sprites.mjs`（`TARGETS` 从 `icons` 一条支路扩成全表；加 `--check`）
- Modify: `src/renderer/react/assets/characters/<12 只>/status-moods/*.png`（72 张，256²）
- Modify: `src/renderer/react/assets/status-moods/*.png`（25 张，256²，**文件名一个都不能改**——R-D2）
- Modify: `src/renderer/tast/*.png`（12 张立绘，**256²**——最大显示框只有 34px，见 R-D1 表）
- Modify: `src/renderer/react/avatars/*.png`（12 张方头像，256²）
- Modify: `src/renderer/react/assets/status-float/*.png`（4 张，256²）
- Modify: `src/renderer/react/assets/welcome/*.png`（4 张，512²）
- Create: `src/renderer/pet/cat-sprite-manifest.ts` + `src/renderer/pet/cat-sprite-manifest.test.ts`（清单要 import `buildSpriteOps`，按 R-D13 与变体库同住 renderer；`checkTarget` 本身只吃 `Raster`，不碰 DOM）

**Interfaces:**
- Consumes: Task 20 `coatOf()`、Task 21 `CAT_POSES`/`CAT_CROPS`/`SPRITE_DROPPED_LAYERS`、Task 22 `renderOps`/`encodePng`/`alphaCoverage`/`inkCentroid`
- Produces:
  - `interface SpriteTarget { out: string; size: number; height?: number; crop: CropName; nickname: string; coat: CoatName; pose: PoseName; mood: Mood; blink?: number; pet?: number; energy?: number; maxKb?: number }`
    （`height` 只为 R-D1 表里唯一的横幅档存在——`cyrene-welcome.png` 1280×720；缺省时 `height = size`。
    别为了「统一」把它删掉，也不要把它推广到别的 target。）
  - `const SPRITE_TARGETS: readonly SpriteTarget[]`（下面全表，**清单即数据**，`.mjs` 只负责执行）
  - `const MOOD_TO_VARIANT: Readonly<Record<string, { mood: Mood; pose: PoseName; blink: number; pet: number; energy: number }>>`
  - `function checkTarget(r: Raster, t: SpriteTarget): string[]`（返回违反的判据描述，空数组即通过）

- [ ] **Step 1: 写清单与它的失败测试**

`src/renderer/pet/cat-sprite-manifest.test.ts` 的四条判据是本任务的验收，全部**量出来**而不是看着像：

```ts
import { describe, expect, it } from "vitest";
import { renderOps, alphaCoverage, inkCentroid } from "../../shared/sprite-raster";
import { CAT_CROPS, buildSpriteOps } from "./cat-variants";
import { MOOD_TO_VARIANT, SPRITE_TARGETS, checkTarget } from "./cat-sprite-manifest";

describe("位图资产清单", () => {
  it("清单里每个 out 都是当前真实被读的键（R-D2：25 张散点状态图文件名冻结）", () => {
    const float = SPRITE_TARGETS.filter((t) => t.out.includes("status-float/")).map((t) => t.out.split("/").pop());
    expect([...float].sort()).toEqual(["提醒.png", "离线.png", "聆听中.png", "陪伴中.png"].sort());
    const loose = SPRITE_TARGETS.filter((t) => /assets\/status-moods\//.test(t.out));
    expect(loose).toHaveLength(25);
    const moods = SPRITE_TARGETS.filter((t) => /characters\/[^/]+\/status-moods\//.test(t.out));
    expect(moods).toHaveLength(72);                 // 12 只 × 6 档 CharacterStatusMood
  });

  it("25 档散点情绪全部有落点，不许出现「同两张图」的偷懒映射", () => {
    expect(Object.keys(MOOD_TO_VARIANT)).toHaveLength(25);
    const sig = Object.values(MOOD_TO_VARIANT).map((v) => `${v.mood}/${v.pose}/${v.blink}/${v.pet}/${v.energy}`);
    expect(new Set(sig).size).toBeGreaterThanOrEqual(20);   // 25 档至少 20 种不同签名
  });

  it("抽样的每条目标都过像素尺（全表由 Step 5 的 --check 兜底）", () => {
    for (const t of SPRITE_TARGETS.slice(0, 6)) {          // 前 6 条做代表，全表跑在 Step 5 的 --check
      const crop = CAT_CROPS[t.crop];
      const size = { w: t.size, h: t.height ?? t.size };
      const ops = buildSpriteOps(
        { coat: t.coat, pose: t.pose, crop: t.crop, mood: t.mood, blink: t.blink, pet: t.pet, energy: t.energy },
        size,
      );
      const r = renderOps(ops, size.w, size.h, { mask: crop.mask === "disc" ? "disc" : "none" });
      const bad = checkTarget(r, t);
      expect(bad, `${t.out}: ${bad.join("; ")}`).toEqual([]);
    }
  });

  it("正对照：把预算改成 0 会判红（证明尺真的在量，不是恒真）", () => {
    const t = SPRITE_TARGETS[0];
    const size = { w: t.size, h: t.height ?? t.size };
    const r = renderOps(buildSpriteOps({ coat: t.coat, pose: t.pose, crop: t.crop }, size), size.w, size.h);
    expect(checkTarget(r, { ...t, maxKb: 0 })).not.toEqual([]);
  });
});
```

> `checkTarget` 的 `maxKb: 0` 那条是**故意造的反例**：预算为 0 必判违反，证明判据连着出口。
> 「覆盖度 ∈ [0.22, 0.80]」与「质心离画布中心 <12%」这两个区间是 Step 4 第一次跑全表时**量出来再定**的，
> 现在写死的是初值——落地顺序必须是「先跑、把实测抄进区间、再钉死」，抄的是实测，不是这个初值。

- [ ] **Step 2: `MOOD_TO_VARIANT` 全表（25 条，写全）**

键是 `react/assets/status-moods/` 现有的 25 个中文文件名（实测 `ls` 得到的就是这一组）。
`mood` 是 `art.ts:27` 的 `Mood`（`idle | happy | thinking | grumpy | sleep`），`pose` 是 Task 21 的 `PoseName`：

| 文件名（不变） | mood | pose | blink | pet | energy | 为什么这么给 |
| --- | --- | --- | --- | --- | --- | --- |
| 元气.png | happy | happy | 0 | 0.2 | 0.8 | 抬爪笑，能量最高 |
| 原生.png | idle | sit | 0 | 0 | 0.4 | 基准坐姿，别的档都跟它比 |
| 学习.png | thinking | sit | 0.15 | 0 | 0.55 | 盯住，眼睛半眨 |
| 害羞.png | happy | tilt | 0.4 | 1.0 | 0.5 | 歪头＋满摸头值 → `blush` 层亮 |
| 工作中.png | thinking | wash | 0.1 | 0 | 0.7 | 洗脸＝手上有事做 |
| 已中断.png | grumpy | puff | 0 | 0 | 0.1 | 炸毛，`BREAK_*` 花色自动上 |
| 已处理.png | happy | sit | 0.2 | 0.3 | 0.5 | 收完，回到坐姿 |
| 平静.png | idle | lie | 0.1 | 0 | 0.3 | 趴着不动 |
| 开心.png | happy | happy | 0 | 0.6 | 0.7 | 比元气低一档，避免两档撞图 |
| 思考中.png | thinking | tilt | 0.25 | 0 | 0.5 | 歪头盯 |
| 思考强度.png | thinking | stretch | 0 | 0 | 0.95 | 伸到最长的档当「强度」隐喻 |
| 感动.png | happy | peek | 0.5 | 1.0 | 0.6 | 探头＋满摸头 |
| 担心.png | grumpy | pout | 0.3 | 0 | 0.4 | 嘴角下压 |
| 提醒.png | idle | peek | 0 | 0 | 0.6 | 抬头看一眼 |
| 撒娇.png | happy | pout | 0.35 | 1.0 | 0.6 | 「委屈脸＋满摸头」＝求摸 |
| 治愈.png | happy | lie | 0.5 | 0.4 | 0.45 | 慢眨 |
| 温柔.png | idle | lie | 0.6 | 0.2 | 0.35 | 比治愈更少睁眼 |
| 激动.png | happy | stretch | 0 | 0.5 | 0.9 | 拉长＋高能量 |
| 知性.png | thinking | sit | 0.05 | 0 | 0.5 | 与「学习」差在 blink，别做同一张 |
| 离线.png | sleep | sleep | 1 | 0 | 0.05 | 闭眼趴平 |
| 聆听中.png | idle | tilt | 0.2 | 0 | 0.5 | 歪头听 |
| 自定义.png | idle | sit | 0 | 0 | 0.5 | 中性，供用户改名时兜底 |
| 连接中.png | thinking | peek | 0.1 | 0 | 0.65 | 探头＋盯 |
| 陪伴中.png | idle | lie | 0.15 | 0.3 | 0.35 | 在你手边趴着 |
| 难过.png | grumpy | pout | 0.45 | 0 | 0.2 | 与「担心」差在 blink 与能量 |

6 档 `CharacterStatusMood`（`连接中 / 思考中 / 工作中 / 提醒 / 已处理 / 已中断`）是 12 只猫共用的一张表，
直接复用上面同名行的 variant——**不另开一套数**，这样委托面板与散点状态机用的是同一批姿态语义。

- [ ] **Step 3: `SPRITE_TARGETS` 展开成 129 条**

`characters/<猫>/status-moods/<6 档>.png` = 72 条（`crop: "square"`、`size: 256`、`coat` 取该猫的 `CAT_ROSTER.coat`）；
`react/assets/status-moods/<25 档>.png` = 25 条（`nickname: ASSISTANT_NICKNAME`、`crop: "bust"`、`size: 256`）；
`tast/<猫>.png` = 12 条（`crop: "full"`、`size: 256`）；
`react/avatars/<猫>.png` = 12 条（`crop: "round"`、`size: 256`、`mask: disc`）；
`status-float/<4>.png` = 4 条（`crop: "square"`、`size: 256`）；
`welcome/<chat,code,learn,work>.png` = 4 条（`crop: "full"`、`size: 512`）。合计 **129** 条。

> 尺寸一律从 R-D1 的实测表取，不要在这段里凭手感调档。这 129 条里只有 `welcome/` 那 4 条够得上 512²
> （`.cy-composer-welcome` 显示框 240px，`ChatComposer.css:18`）；立绘看着「应该更大」是因为上游源图
> 就是 1280²，但它在界面上只占 34px——上游那 17 MB 是白烧的，本期不重演。

用代码展开，别手抄（手抄必漏，漏了 `--check` 也只看已有文件）：

```ts
// R-D13：清单住 renderer，shared 侧的依赖一律走 ../../shared/*
import { ASSISTANT_NICKNAME, CAT_ROSTER } from "../../shared/cat-roster";
import type { CoatName } from "../../shared/cat-coats";
import type { CropName, Mood, PoseName } from "../../shared/cat-types";
import { alphaCoverage, encodePng, inkCentroid, type Raster } from "../../shared/sprite-raster";
// `import type` 会被 esbuild 整句擦除，所以 `character-status-moods.ts` 里的 `import.meta.glob`
// 不会进构建期 bundle（那玩意儿只有 Vite 认，esbuild 遇到会炸）。
import type { CharacterStatusMood } from "../react/character-status-moods";

const STATUS_MOODS_6: CharacterStatusMood[] = ["连接中", "思考中", "工作中", "提醒", "已处理", "已中断"];

/** 6 档状态复用 25 档散点里同名行的 variant；缺一行就在建表时当场红，别让它静默退化成 `sit`。 */
function variantFor(mood: CharacterStatusMood) {
  const v = MOOD_TO_VARIANT[mood];
  if (!v) throw new Error(`MOOD_TO_VARIANT 缺 ${mood}`);
  return v;
}

export const SPRITE_TARGETS: readonly SpriteTarget[] = [
  ...CAT_ROSTER.flatMap((cat) => STATUS_MOODS_6.map((mood) => ({
    out: `src/renderer/react/assets/characters/${cat.nickname}/status-moods/${mood}.png`,
    size: 256, crop: "square" as const, nickname: cat.nickname, coat: cat.coat,
    ...variantFor(mood),
  }))),
  ...Object.keys(MOOD_TO_VARIANT).map((file) => ({
    out: `src/renderer/react/assets/status-moods/${file}.png`,
    size: 256, crop: "bust" as const, nickname: ASSISTANT_NICKNAME, coat: "paper" as CoatName,
    ...MOOD_TO_VARIANT[file],
  }))),
  // …其余四组同形，全部由 CAT_ROSTER / 固定数组派生
];
```

`welcome/` 那 4 条的 `pose` 分别钉 `sit / stretch / wash / happy`（对应 chat/code/learn/work 四个入口的
「在做什么」），**这四条是助手（`paper` 花色）而不是 12 只猫**——欢迎页是「我」，不是名册。

- [ ] **Step 4: `--check` 判据（`checkTarget`）**

```ts
import { encodePng } from "./png-encode";

export function checkTarget(r: Raster, t: SpriteTarget): string[] {
  const bad: string[] = [];
  const h = t.height ?? t.size;                              // wide 档唯一：1280×720，其余方形
  if (r.width !== t.size || r.height !== h) bad.push(`尺寸 ${r.width}×${r.height} ≠ ${t.size}×${h}`);
  const kb = encodePng(r.width, r.height, r.rgba).length / 1024;   // 现算，不读磁盘
  const budget = t.maxKb ?? 60;                              // R-D1：单文件 ≤60 KB（横幅 120）
  if (kb > budget) bad.push(`${kb.toFixed(1)} KB > 预算 ${budget} KB`);
  // 16:9 的横幅横向留白是构图（`wide` 的 window 故意越过 viewBox），覆盖度带另给；
  // 分支只看 `height` 是否存在，不新增字段，也就没法「顺手」扩散到别的 target。
  const [covMin, covMax] = t.height === undefined ? [0.22, 0.80] : [0.12, 0.45];
  const cov = alphaCoverage(r);
  if (cov < covMin || cov > covMax) bad.push(`覆盖度 ${cov.toFixed(3)} 出界 [${covMin},${covMax}]`);
  const c = inkCentroid(r);
  const off = Math.hypot(c.x - r.width / 2, c.y - r.height / 2) / r.width;
  if (off > 0.12) bad.push(`质心离中心 ${(off * 100).toFixed(1)}% > 12%`);
  return bad;
}
```

再加两条**跨条目**判据（单张过、整批糊是本期最像样的失败模式）：
① 72 张 `characters/*` 里，同一只猫的 6 张必须两两不同（`alphaCoverage` 差 ≥0.02 或质心距 ≥3%）；
② 25 张散点里，任意两张的 `(覆盖度, 质心)` 距离 > 1.5%（防「两个情绪出同一张图」）。
这两条写在 `--check` 里，不写在单测里——单测跑 129 条渲染太慢，`--check` 是构建门本来就慢。

- [ ] **Step 5: 生成、量、把实测抄进判据、钉死**

`cat-sprites.mjs` 的 esbuild 入口从 Task 11 的 `png-encode` + `sprite-raster` 两文件**扩成一张清单文件的整棵依赖树**：
`bundle: ["src/renderer/pet/cat-sprite-manifest.ts"]` → `node_modules/.cache/mochi-palette/cat-sprite-manifest.mjs`。
这一棵会连带 `cat-variants` / `cat-roster` / `art`（`src/renderer/pet/`）与 `pet-tokens` / `sprite-raster` / `png-encode`
（`src/shared/`；esbuild 按 import 图跨树走，不需要额外配置）。Task 26 会往同一入口补
`export { CAT_STICKERS, STICKER_SIZE }`，届时 `cat-sticker-set` 也进这棵树——**不另开第二个 bundle**。
所以脚本里**不再逐个 import `src/shared/*.ts`**（Task 11 那种两文件写法在 D2 全表下会漏依赖）；
只从缓存目录 import 一个入口，`SPRITE_TARGETS` 与 `buildSpriteOps` 都从它导出。改完先跑一次
`node scripts/build/cat-sprites.mjs --only=icons` 确认 Task 11 的旧支路仍绿，再跑全表。

```bash
node scripts/build/cat-sprites.mjs            # 全表
CI=true npx vitest run src/renderer/pet/cat-sprite-manifest
node scripts/build/cat-sprites.mjs --check    # 幂等 + 判据
npx tsc -p tsconfig.renderer.json --noEmit
npx tsc -p tsconfig.main.json --noEmit        # R-D13 的判据：清单没把 DOM 拉进主进程
```
Expected：第一次 `--check` 会在「覆盖度/质心」上挑出几条真问题（多半是 `sprawl` 把 `sleep` 压得太扁、
`round` 遮罩把耳朵切掉）。**改 `cat-variants.ts` 的参数，不许改判据来迁就产物**——
判据若需要改，改的理由必须写进提交正文，且改后要把 Step 1 的正对照再跑一遍确认它还红。

体积棘轮：把 `du -sh src/renderer/react/assets` 与 `git ls-files -z -- 'src/renderer/**/*.png' | xargs -0 du -ch | tail -1`
两条的输出写进提交正文。R-D1 的预算是 60 KB/张，本任务的 129 张 ≈ 上限 **7.7 MB**（D 轨全量 170 张 ≈ 10.2 MB，
另 41 张由 Task 25/26 交），实测应当远低于此（猫是矢量、大面积纯色，PNG 索引化之前就能压到几 KB～二十几 KB）。

- [ ] **Step 6: 提交**

```bash
git add src/renderer/pet/cat-sprite-manifest.ts src/renderer/pet/cat-sprite-manifest.test.ts \
  scripts/build/cat-sprites.mjs src/renderer/react/assets src/renderer/react/avatars src/renderer/tast
git commit -m "feat(assets): 角色位图全表改为同一套 DrawOp 生成的猫，加 --check 像素尺与体积棘轮"
```
正文列：129 条清单、72/25/12/12/4/4 的分档数、`--check` 的四条判据与两条跨条目判据、
删掉的原动漫位图体积（`git diff --stat` 里应当是成片 `D` + `A`，位图 rename 不成立，这是正常的）。

### Task 25: 非角色资产池 + 死文件清零（D2 之二、D5 的删除半边）

**Files:**
- Modify: `src/renderer/pet/cat-sprite-manifest.ts`（追加 `export const NON_CHARACTER_TARGETS`——R-D13：清单住 renderer，`.mjs` 只执行）
- Modify: `scripts/build/cat-sprites.mjs`（`TARGETS` 再补 `nonCharacter` 一组）
- Create（覆盖）: `src/renderer/public/context-usage/{normal,warm,alert,compact}.png`（**256²**）、
  `src/renderer/public/cyrene-welcome.png`（**1280×720 横幅，本期唯一非方图**）、
  `src/renderer/public/loading.png`（**320²**）、
  `src/renderer/public/avatars/cyrene-avatar.png`（256²）、
  `src/renderer/music/assets/{logo,music2}.png`（256²）、
  `src/renderer/toast/assets/toast-avatar.png`（256²）、
  `src/renderer/settings/100.png`（256²）、
  `src/renderer/react/assets/{moments,new,plugin}.png`（256²）、
  `src/renderer/public/icons/{cyrene-pink,cyrene-sun,sticker-picker}.png`（256²）
- Delete（R-D5 实测 40 个 / 20.8 MB）: `react/assets/todo/`(3)、`react/assets/ask/`(3)、
  `react/assets/avatars/`(2)、`react/assets/{model,tools,sidebar-bg,思考组件}.png`(4)、
  `react/avatars/昔涟.png`(1)、`public/icons/{cyrene-avatar-line-white.png,cyrene-avatar-line.svg,mimi.png}`(3)、
  `public/icons/providers/*.svg`(13)、`assets/ui/cyrene-thinking-loop/`(11)

**Interfaces:**
- Consumes: Task 24 的 `SPRITE_TARGETS` 展开法、`checkTarget`
- Produces: `export const NON_CHARACTER_TARGETS: readonly SpriteTarget[]`（17 条，落在 `src/renderer/pet/cat-sprite-manifest.ts`；Task 28 直接 import）

- [ ] **Step 1: 四路 grep 门（删之前，逐个复核「真的没人读」）**

`resolveAsset` 的键是拼出来的，按 basename grep 会**假阳性地说它死**——`public/context-usage/*` 就是活例
（`ContextUsageRing.tsx:63-70`）。所以判死必须四路全空：

```bash
for b in cyrene-avatar-line-white.png cyrene-avatar-line.svg mimi.png model.png tools.png sidebar-bg.png 思考组件.png; do
  a=$(grep -rn "$b" src scripts build package.json electron-builder.yml 2>/dev/null | grep -v "^src/renderer/public\|^src/renderer/react/assets" | wc -l)
  c=$(grep -rn "${b%.*}" src --include=*.ts --include=*.tsx | grep -v "assets/" | wc -l)
  d=$(grep -rn "todo/\|ask/\|assets/avatars/" src scripts --include=*.ts --include=*.tsx --include=*.css | wc -l)
  echo "$b basename=$a stem=$c dir=$d"
done
```
Expected：三个数全 0 才许进 `git rm`。任何非 0 的，**停下来把那几行贴进提交正文再决定**——
`providers/*.svg` 那一组已经实测确认 `iconUrl` 字段有定义、无消费（`ModelSettingsPanel.tsx:124-143`
走 `@lobehub/icons`），它的 `grep` 结果不该为 0，所以它单列在下面 Step 2 里处理。

- [ ] **Step 2: `providers/` 那一组按「字段死、目录活」处理**

`settings/api/presets.ts:12-19` 的 `iconUrl` 字段**留着不动**（删字段要改 `ModelPreset` 类型，
波及 `profilePreset()` 与所有引用它的测试，收益是省 13 个 20 KB 的 SVG）。
只删 `src/renderer/public/icons/providers/` 下 13 个 SVG，并把 `presets.ts` 顶部加一行注释说明
「`iconUrl` 是上游遗留字段，渲染走 `@lobehub/icons`，文件已不在仓内」——
**注释写的是「为什么留着这个死字段」，不是「这里以后要清」**。

- [ ] **Step 3: 17 条 `NON_CHARACTER_TARGETS`（写全）**

| out | size | crop | coat/pose/mood | 备注 |
| --- | --- | --- | --- | --- |
| `public/context-usage/normal.png` | 256 | bust | paper / sit / idle | 与 `ContextUsageRing` 的「normal」同调；显示框只有 52px |
| `public/context-usage/warm.png` | 256 | bust | paper / tilt / thinking | |
| `public/context-usage/alert.png` | 256 | square | paper / puff / grumpy | 警告档用炸毛，**不用红**（红是 `WARN` 语义，本期不动） |
| `public/context-usage/compact.png` | 256 | square | paper / wash / thinking | 压缩中＝手上在做事 |
| `public/cyrene-welcome.png` | **1280 × 720** | **wide** | paper / happy / happy | `WelcomeGate` 首屏；`size: 1280, height: 720`，全表唯一非方图（R-D1） |
| `public/loading.png` | **320** | bust | paper / peek / idle | splash logo 框 160px；`splash.html:78` 直接当 `<img>` 读，**必须是真 PNG**（它不走 vite） |
| `public/avatars/cyrene-avatar.png` | 256 | round | paper / sit / idle | `useCyreneAvatar.ts:5` + `character-avatars.ts:32` |
| `music/assets/logo.png` | 256 | round | azure / sit / idle | |
| `music/assets/music2.png` | 256 | bust | azure / tilt / happy | |
| `toast/assets/toast-avatar.png` | 256 | round | paper / peek / happy | toast 是系统通知，圆头像最合适 |
| `settings/100.png` | 256 | bust | paper / wash / idle | `AppearanceSettingsPage.tsx:41` |
| `react/assets/moments.png` | 256 | square | rose / peek / happy | 朋友圈入口 |
| `react/assets/new.png` | 256 | square | paper / stretch / happy | `?url` 导入，新任务＝伸一下 |
| `react/assets/plugin.png` | 256 | square | gray / wash / thinking | |
| `public/icons/cyrene-pink.png` | 256 | full | rose / sit / idle | **文件名与 `id` 都不改**（Task 11 Step 5） |
| `public/icons/cyrene-sun.png` | 256 | square | azure / happy / happy | 同上；icon 画在小方框里，耳朵必须完整 |
| `public/icons/sticker-picker.png` | 256 | square | paper / tilt / happy | `ChatComposer.tsx:232` |

> `wide` 那条要传 `height: 720`；`checkTarget()` 对非方图的覆盖度带另给 `[0.12, 0.45]`——
> 同一只猫放进 16:9 画布，横向留白是构图而不是失败。**别把这条豁免扩散到别的 target 上。**

`public/loading.png` 那条是本任务唯一有**机制差异**的：`splash.html` 是 `loadFile` 直接吃的静态页，
它的图不进 vite 图、不进 bundle，所以「像素尺过了但文件名/位置错」在这里会静默坏掉——
Step 5 的验收必须**起一次真 splash 窗**看一眼，不接受只跑 `--check`。

- [ ] **Step 4: 删（一次性，四路 grep 绿之后）**

```bash
git rm -r src/renderer/react/assets/todo src/renderer/react/assets/ask src/renderer/react/assets/avatars \
  src/renderer/react/assets/model.png src/renderer/react/assets/tools.png src/renderer/react/assets/sidebar-bg.png \
  "src/renderer/react/assets/思考组件.png" src/renderer/react/avatars/昔涟.png \
  src/renderer/public/icons/cyrene-avatar-line-white.png src/renderer/public/icons/cyrene-avatar-line.svg \
  src/renderer/public/icons/mimi.png src/renderer/public/icons/providers assets/ui/cyrene-thinking-loop
```
> `昔涟.png` 若已在 Task 23 的 rename 里消失，这里会报 `pathspec did not match` —— 那是**预期**的，
> 说明 Step 1 与 Task 23 的顺序没问题；把报错留在终端，别为了让它「不报错」而加 `|| true`，
> 那会把真的漏删一起吞掉。
> `git rm` 中文路径要引号包住；`assets/ui/cyrene-thinking-loop` 在 git 里是 tracked 资产，
> 删它不需要额外授权，但**必须确认 Step 1 的 `dir=0`**。

- [ ] **Step 5: 跑门 + 一次真 splash 窗**

```bash
node scripts/build/cat-sprites.mjs
node scripts/build/cat-sprites.mjs --check
CI=true npx vitest run src/shared src/renderer/ui src/renderer/pet
npx tsc -p tsconfig.main.json --noEmit
du -sh src/renderer assets
npm run build && node -e 'const{BrowserWindow}=require("electron");' >/dev/null 2>&1 || true
```
最后一条只是**提醒**：splash 窗只能靠真起一次应用来看（`create-splash-window.ts:48` 走 dev URL、
`:52` 走 `dist/renderer/splash.html`）。用 P0 那条已验证的启动方式跑一次，
参数 `--user-data-dir=D:\cyrene-p0-probe`，**绝不碰 `%APPDATA%\Cyrene`**。
肉眼看 splash 上是不是猫——这是本期「脚本量不到的地方还剩多少」的一次诚实记账，
看不看得到猫之外，顺手确认它**不是碎图**（碎图＝路径对了但尺寸/文件名不对）。

- [ ] **Step 6: 提交**

```bash
git add -A src/renderer scripts/build/cat-sprites.mjs assets
git commit -m "feat(assets): 非角色位图换猫，清零 40 个零引用文件（20.8 MB）"
```
正文列 `du -sh` 前后两值、删掉的 40 个文件清单、以及 Step 1 四路 grep 的输出摘要。

### Task 26: 52 张表情包全部换成猫（D2 之三）

**Files:**
- Create: `src/shared/cat-sticker-set.ts`（52 行 `{ id, coat, pose, mood }`，生成器与测试共读这一份）
- Modify: `src/renderer/pet/cat-sprite-manifest.ts`（顶部加一行 `export { CAT_STICKERS, STICKER_SIZE } from "../../shared/cat-sticker-set";`——复用 Task 24 的单一 esbuild 入口）
- Create: `src/main/sticker-catalog.test.ts`（id/文件/描述/真 PNG/尺寸/唯一性 六道锁）
- Modify: `src/main/sticker-descriptions.ts:65-115`（`BUILT_IN_STICKER_FILES` 全部改成 `<id>.png`）
- Modify: `scripts/build/cat-sprites.mjs`（加 `stickers` 支路）
- Delete: `src/renderer/public/stickers/` 下 52 张旧图（47 jpg / 5 png，含 3 个「后缀叫 gif/png、字节是 WebP」的雷）
- Modify: `src/main/moments/moments-service.test.ts:1678,1715`（fixture `stickers/peek.gif` → `stickers/peek.png`）

**Interfaces:**
- Consumes: Task 20 `CoatName`、Task 21 `CAT_POSES`/`CAT_CROPS`、Task 22 `renderOps`/`encodePng`、Task 24 的 `SpriteTarget` 生成法
- Produces:
  - `interface CatSticker { id: string; coat: CoatName; pose: PoseName; mood: Mood }`
  - `const CAT_STICKERS: readonly CatSticker[]`（52 条，**id 一个都不改**）
  - `const STICKER_SIZE = 512`
  - 52 个 `src/renderer/public/stickers/<id>.png`

**为什么保留 52 个 id 而不是砍到 24 个：** `stickerId` 会被写进聊天历史与朋友圈动态（`moments-service.test.ts`
里就有 `ref: "stickers/peek.gif"` 这种落盘引用），`stickerSettings` 也以 id 为键。砍 id 等于让历史消息里的
表情变成死链，得再写一张 old→new 映射表和降级分支——那是给「张数」付的债，而张数不是本期判据。
**id 与语义全留，只换字节**：这正是 R-D2/R-D11 那条「内部键不动，只换用户看见的东西」的同一裁决。
真正要清的是 19.5 MB 的养成系原画，不是 id。

**扩展名是例外，必须一次换干净：** 旧图里 `peek.gif`、`clingy-confused.gif`、`love-calm.png` 三个文件
的字节其实是 **WebP**（`RIFF` 开头）。保留 `.gif` 名字会让我们往一个叫 gif 的文件里写 PNG 字节——
Chromium 按内容嗅探能显示，但 `outgoing-composer.ts:138` 会把文件交给渠道适配器按扩展名判 MIME，
到时候 QQ/微信侧收到的就是一张不显示的图。所以 52 个文件名统一成 `<id>.png`，映射表在
`sticker-descriptions.ts` 一处，改完全仓只有这一个真相源。

- [ ] **Step 1: 写失败的测试**

`src/main/sticker-catalog.test.ts`：

```ts
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BUILT_IN_STICKER_IDS } from "../shared/sticker-types";
import { CAT_STICKERS, STICKER_SIZE } from "../shared/cat-sticker-set";
import { BUILT_IN_STICKER_DESCRIPTIONS, BUILT_IN_STICKER_FILES } from "./sticker-descriptions";

const dir = fileURLToPath(new URL("../renderer/public/stickers/", import.meta.url));
const PNG_MAGIC = "89504e470d0a1a0a";

describe("内置表情包目录", () => {
  it("猫表与 id 表一一对应，且 id 顺序不乱", () => {
    expect(CAT_STICKERS.map((s) => s.id)).toEqual([...BUILT_IN_STICKER_IDS]);
  });

  it("文件表一律是 <id>.png（WebP 冒充 gif 的雷一次排掉）", () => {
    expect(Object.keys(BUILT_IN_STICKER_FILES).sort()).toEqual([...BUILT_IN_STICKER_IDS].sort());
    for (const id of BUILT_IN_STICKER_IDS) expect(BUILT_IN_STICKER_FILES[id], id).toBe(`${id}.png`);
  });

  it("每个 id 都有描述（贴纸转自然语言靠它）", () => {
    expect(Object.keys(BUILT_IN_STICKER_DESCRIPTIONS).sort()).toEqual([...BUILT_IN_STICKER_IDS].sort());
  });

  it("磁盘上每张都是真 PNG，且是 512²（R-D1 贴纸档）", () => {
    for (const id of BUILT_IN_STICKER_IDS) {
      const p = `${dir}${BUILT_IN_STICKER_FILES[id]}`;
      expect(existsSync(p), p).toBe(true);
      const buf = readFileSync(p);
      expect(buf.subarray(0, 8).toString("hex"), p).toBe(PNG_MAGIC);
      expect(buf.readUInt32BE(16), p).toBe(STICKER_SIZE);
      expect(buf.readUInt32BE(20), p).toBe(STICKER_SIZE);
    }
  });

  it("52 张全不一样（同图两用等于表情包缩水）", () => {
    const hashes = BUILT_IN_STICKER_IDS.map((id) =>
      createHash("sha1").update(readFileSync(`${dir}${BUILT_IN_STICKER_FILES[id]}`)).digest("hex"));
    expect(new Set(hashes).size).toBe(BUILT_IN_STICKER_IDS.length);
  });
});
```

- [ ] **Step 2: 跑测试确认它红**

```bash
CI=true npx vitest run src/main/sticker-catalog
```
Expected：`Cannot find module '../shared/cat-sticker-set'`。

- [ ] **Step 3: 写 `src/shared/cat-sticker-set.ts`（52 行写全）**

```ts
import type { CoatName } from "./cat-coats";
import type { Mood, PoseName } from "./cat-types";

export interface CatSticker { id: string; coat: CoatName; pose: PoseName; mood: Mood }

/** 512² —— R-D1：选择器预览 360×270、消息流 160px，2× 屏下都够 */
export const STICKER_SIZE = 512;

/**
 * 52 条与 `BUILT_IN_STICKER_IDS` 同序同 id；`sticker-catalog.test.ts` 锁顺序。
 * 每条都是 (coat, pose, mood) 唯一三元组——重复就是两张图长得一样，测试会红。
 * 选型原则：情绪靠 pose + mood 表达，coat 只做区分度，不承担语义（猫是同一只）。
 */
export const CAT_STICKERS: readonly CatSticker[] = [
  { id: "playful",          coat: "rose",  pose: "peek",    mood: "happy" },
  { id: "love-happy",       coat: "rose",  pose: "happy",   mood: "happy" },
  { id: "confident",        coat: "azure", pose: "sit",     mood: "happy" },
  { id: "serious",          coat: "ink",   pose: "sit",     mood: "idle" },
  { id: "calm",             coat: "paper", pose: "lie",     mood: "idle" },
  { id: "peek",             coat: "gray",  pose: "peek",    mood: "idle" },
  { id: "clingy-confused",  coat: "rose",  pose: "tilt",    mood: "thinking" },
  { id: "love-calm",        coat: "paper", pose: "sit",     mood: "happy" },
  { id: "HI",               coat: "gray",  pose: "sit",     mood: "happy" },
  { id: "hello",            coat: "paper", pose: "peek",    mood: "happy" },
  { id: "goodmoring1",      coat: "paper", pose: "stretch", mood: "sleep" },
  { id: "goodnight",        coat: "azure", pose: "sleep",   mood: "sleep" },
  { id: "teatime",          coat: "rose",  pose: "prone",   mood: "happy" },
  { id: "eating",           coat: "ink",   pose: "sit",     mood: "happy" },
  { id: "Allset",           coat: "azure", pose: "stretch", mood: "happy" },
  { id: "OK",               coat: "paper", pose: "sit",     mood: "idle" },
  { id: "copythat",         coat: "gray",  pose: "sit",     mood: "idle" },
  { id: "Thumbsup",         coat: "paper", pose: "stretch", mood: "happy" },
  { id: "awesome",          coat: "azure", pose: "happy",   mood: "happy" },
  { id: "sogood",           coat: "paper", pose: "happy",   mood: "happy" },
  { id: "sonice",           coat: "gray",  pose: "stretch", mood: "happy" },
  { id: "fighting",         coat: "rose",  pose: "puff",    mood: "happy" },
  { id: "hellyeah",         coat: "ink",   pose: "puff",    mood: "happy" },
  { id: "Thanks",           coat: "rose",  pose: "sit",     mood: "happy" },
  { id: "foryou",           coat: "ink",   pose: "happy",   mood: "happy" },
  { id: "blushhard",        coat: "azure", pose: "peek",    mood: "happy" },
  { id: "shyshort",         coat: "rose",  pose: "peek",    mood: "idle" },
  { id: "hmph",             coat: "ink",   pose: "pout",    mood: "grumpy" },
  { id: "hugtight",         coat: "paper", pose: "prone",   mood: "happy" },
  { id: "Airkiss",          coat: "rose",  pose: "tilt",    mood: "happy" },
  { id: "Gigglelots",       coat: "gray",  pose: "prone",   mood: "happy" },
  { id: "thinking",         coat: "azure", pose: "tilt",    mood: "thinking" },
  { id: "putmd",            coat: "gray",  pose: "pout",    mood: "grumpy" },
  { id: "Whatswrong",       coat: "paper", pose: "tilt",    mood: "thinking" },
  { id: "midmeh",           coat: "gray",  pose: "lie",     mood: "idle" },
  { id: "awkward",          coat: "ink",   pose: "tilt",    mood: "thinking" },
  { id: "Madnow",           coat: "rose",  pose: "puff",    mood: "grumpy" },
  { id: "Hurtcry",          coat: "paper", pose: "lie",     mood: "sleep" },
  { id: "Sobbinghard",      coat: "rose",  pose: "lie",     mood: "sleep" },
  { id: "weeploud",         coat: "gray",  pose: "prone",   mood: "sleep" },
  { id: "PanincCrying",     coat: "rose",  pose: "prone",   mood: "sleep" },
  { id: "missme",           coat: "gray",  pose: "peek",    mood: "happy" },
  { id: "Free",             coat: "rose",  pose: "stretch", mood: "happy" },
  { id: "Dreak",            coat: "ink",   pose: "lie",     mood: "sleep" },
  { id: "outfast",          coat: "ink",   pose: "stretch", mood: "happy" },
  { id: "Vcayover",         coat: "azure", pose: "lie",     mood: "grumpy" },
  { id: "sleepynow",        coat: "paper", pose: "sleep",   mood: "sleep" },
  { id: "deadtired",        coat: "paper", pose: "prone",   mood: "sleep" },
  { id: "sotired",          coat: "gray",  pose: "lie",     mood: "sleep" },
  { id: "giveup",           coat: "ink",   pose: "prone",   mood: "sleep" },
  { id: "poorwallet",       coat: "paper", pose: "pout",    mood: "grumpy" },
  { id: "please",           coat: "azure", pose: "tilt",    mood: "happy" },
];
```

> 顺序必须与 `sticker-types.ts:5-57` 完全一致（测试第一行就锁死）。`Goodmoring1` 这个拼错的 id
> **不改**——它是落盘键；拼错的是历史，改对的是字符串，两者没有可比性。

- [ ] **Step 4: 生成器加 `stickers` 支路**

在 `scripts/build/cat-sprites.mjs` 的 `TARGETS` 里加一组（表从 `cat-sticker-set.ts` 读，不手抄）。
先确认 Step 3 的 bundle 入口已经 re-export 了 `CAT_STICKERS` / `STICKER_SIZE`（Task 26 的 Files 第二行），
脚本只 import 一个 `.mjs` 入口：

```js
import { CAT_STICKERS, STICKER_SIZE } from "../node_modules/.cache/mochi-palette/cat-sprite-manifest.mjs";

const stickers = CAT_STICKERS.map((s) => ({
  out: `src/renderer/public/stickers/${s.id}.png`,
  size: STICKER_SIZE,
  crop: "bust",
  coat: s.coat,
  pose: s.pose,
  mood: s.mood,
  maxKb: 60,
}));
```

跑：

```bash
node scripts/build/cat-sprites.mjs --only=stickers
```
Expected：52 个文件写出，`--check` 六条判据全绿。**若唯一性红**，改 `CAT_STICKERS` 里冲突那一行的 coat，
不要去弱化测试——两张一模一样的图在表情包里就是 bug。

- [ ] **Step 5: 换映射表、删旧图**

`sticker-descriptions.ts:65` 起整段替换为派生式（52 行手写扩展名没有意义）：

```ts
import { BUILT_IN_STICKER_IDS } from "../shared/sticker-types";

/** 内置表情包的文件名映射：统一 `<id>.png`。
 *  旧图里三个文件是「叫 gif/png、字节是 WebP」，扩展名与内容不一致会被渠道按 MIME 发坏，
 *  故本期一次换成真 PNG，文件名从 id 派生，不再逐条维护。 */
export const BUILT_IN_STICKER_FILES: Record<string, string> = Object.fromEntries(
  BUILT_IN_STICKER_IDS.map((id) => [id, `${id}.png`]),
);
```

删旧图时**用显式清单**，不要 `rm -rf` 整个目录（万一路径写错就删到新图）：

```bash
cd src/renderer/public/stickers
# 新图之外的全部旧文件；先 --dry-run 看一眼条数应为 52
git ls-files . | grep -vE '^(Airkiss|Allset|Dreak|Free|Gigglelots|HI|Hurtcry|Madnow|OK|PanincCrying|Sobbinghard|Thanks|Thumbsup|Vcayover|Whatswrong|awesome|awkward|blushhard|calm|clingy-confused|confident|copythat|deadtired|eating|fighting|foryou|giveup|goodmoring1|goodnight|hellyeah|hello|hmph|hugtight|love-calm|love-happy|midmeh|missme|outfast|peek|playful|please|poorwallet|putmd|serious|shyshort|sleepynow|sogood|sonice|sotired|teatime|thinking|weeploud)\.png$' | wc -l
```
Expected：`52`。确认后才删：

```bash
git ls-files . | grep -vE '\.png$' | xargs -r git rm
```
（52 个旧文件里有一部分本来就是 `.png`，会被上面这条漏掉——**它们正是要覆盖的那几个新图，
新图已同名落盘，`git add` 即完成覆盖**。`git status` 里应当是成片 `D` + 少数 `M`，
以实际输出为准；若出现 **0 个 `D`**，说明路径写错了，停下重看，别硬提交。）

改两个测试 fixture：

```bash
grep -n "peek.gif" src/main/moments/moments-service.test.ts
```
两处 `ref: "stickers/peek.gif"` → `ref: "stickers/peek.png"`。

- [ ] **Step 6: 跑门 + 提交**

```bash
CI=true npx vitest run src/main/sticker-catalog src/main/moments src/shared/sticker-types
npx tsc -p tsconfig.main.json --noEmit
node scripts/build/cat-sprites.mjs --check
git add src/shared/cat-sticker-set.ts src/main/sticker-catalog.test.ts src/main/sticker-descriptions.ts \
  src/main/moments/moments-service.test.ts scripts/build/cat-sprites.mjs src/renderer/public/stickers
git commit -m "feat(assets): 52 张自带表情全部换成猫，扩展名统一真 PNG"
```
正文写：52 id 不变（落盘键）、三个 WebP 冒充后缀的文件、`du -sh src/renderer/public/stickers` 前后值。

### Task 27: Live2D 残骸清零（D4）

**Files:**
- Delete: `src/renderer/live2d/`（12 个文件，含 3 个 `.test.ts`；**全仓无 importer**，实测）
- Delete: `src/renderer/public/models/cyrene/`（9.1 MB）与 `assets/models/cyrene/`（9.1 MB）
- Delete: `src/renderer/public/live2dcubismcore.min.js`
- Modify: `src/renderer/index.html:14,25`、`src/renderer/main.ts:5-6`（`#live2d-canvas` → `#pet-canvas`）
- Modify: `package.json`（删 `pixi.js`、`pixi-live2d-display`）

**Interfaces:**
- Consumes: 无
- Produces: `#pet-canvas`（原 `#live2d-canvas`，唯一改名点）；`src/renderer/live2d/` 不再存在

**先看清「不能删的东西」**（R-D11/R-D12 已裁，这里落成执行清单）：

| 名字 | 为什么留 |
|---|---|
| `window.live2dSpeech` / `window.live2dDiagnostics` | 有真消费者：`tts-playback.ts:70-238`、`useCallSession.ts:60-189` 在做 TTS 口型；preload `index.ts:689-715` 暴露 |
| `"live2d-main"`（`shell-bootstrap.ts:78`） | 窗口生命周期追踪的**日志名**，改名会让既有诊断日志断代 |
| `src/renderer/global.d.ts:233` | 上述桥的类型声明 |
| `src/preload/live2d-listener-diagnostics.ts` | 监听泄漏诊断，仍在 `preload/index.ts:20` 使用 |
| `LEGACY_USER_DATA_DIR_NAME = "live2d-cyrene"`（`user-data-migration.ts:19`） | 老用户数据迁移的**源目录名**；改了等于丢掉升级路径 |
| `soul.split("\n## Live2D 与聊天文字的分工")`（`moments-service.ts:765`、`proactive-lifecycle.ts:63`） | 分隔符是行为闸门，不是文案 |
| `prompts/worldbook/Cyrene.md` 文件名 | 按目录扫描注入；只改正文，不改名 |

- [ ] **Step 1: 确认真的没有 importer（删之前）**

```bash
grep -rn "renderer/live2d\|from \"\./live2d\|from \"\.\./live2d" src --include=*.ts --include=*.tsx
```
Expected：**空**。若非空，先修那条 import 再删——`live2d/` 整套已被 `pet/` 取代（Task 9-10），现在只是死树。

- [ ] **Step 2: 按依赖反序删**

```bash
git rm -r src/renderer/live2d
git rm -r src/renderer/public/models assets/models
git rm src/renderer/public/live2dcubismcore.min.js
```
> `src/renderer/public/models` 与 `assets/models` 是同一套模型的两份副本（各 9.1 MB / 21 个文件）。
> `live2d/manager.test.ts:100,141` 从盘上读 `../public/models/cyrene/Cyrene.model3.json`，它随
> `live2d/` 一起删——**两件事必须在同一个提交里**，否则测试会指向不存在的文件。

- [ ] **Step 3: 删依赖（幂等，失败就记让步）**

```bash
npx pnpm@10.33.0 remove pixi.js pixi-live2d-display
```
Expected：`package.json` 少两行、`pnpm-lock.yaml` 有 diff。
若离线/取不到 pnpm，**不要手改 lockfile**：保留这两个依赖，在提交正文写一行
`Task 27 让步：pixi 依赖未移除（pnpm 不可用），源码已无 import，不影响产物`。留着是零成本，
手改 lockfile 是给自己埋一个下次安装就炸的雷。

- [ ] **Step 4: canvas id 改名**

```bash
grep -rn "live2d-canvas" src scripts tools 2>/dev/null
```
Expected：只有 `index.html:14,25` 与 `main.ts:5,6` 四处（已实测）。全部改成 `pet-canvas`：

```html
    #pet-canvas {
  ...
  <canvas id="pet-canvas"></canvas>
```
```ts
const canvas = document.getElementById("pet-canvas") as HTMLCanvasElement;
if (!canvas) throw new Error("Canvas #pet-canvas not found");
```

> 这是本任务唯一的改名，理由：这个 canvas 从 P0 起画的就是像素猫，留着 live2d 的名字会让后来人
> 以为还有一条 2D 骨骼渲染路径。只在四处、且没有外部脚本引用，改是净收益。

- [ ] **Step 5: 门 + 冒烟 + 提交**

```bash
CI=true npx vitest run src/renderer/pet src/main/preload-live2d-listener-diagnostics src/main/moments
npx tsc -p tsconfig.main.json --noEmit
npx tsc -p tsconfig.preload.json --noEmit
npx tsc -p tsconfig.renderer.json --noEmit
npm run build:renderer
```
`build:renderer` 必须绿——`live2dcubismcore.min.js` 被删后若还有动态 `import()`，这里会红；
静态 import 在第一步就抓到了，这一步抓的是**拼出来的 URL**（同 R-D5 的四路 grep 逻辑）。

起一次真窗（只读自家 profile，**不碰 `%APPDATA%\Cyrene`**）：

```bash
npx electron . --user-data-dir=D:\cyrene-p0-probe
```
看三件事：猫窗出现、`document.getElementById("pet-canvas")` 非空、DevTools console 无 404
（旧模型路径若还有残留请求会在这里露出来）。

```bash
git add -A src/renderer src/main src/preload src/renderer/global.d.ts package.json pnpm-lock.yaml
git commit -m "refactor(renderer): 清掉 Live2D 死树与 18MB 模型，canvas 改名 pet-canvas"
```
正文列：删掉的 12 + 42 + 1 个文件、`assets/models` 与 `public/models` 两份副本、两条保留清单
（bridge/diagnostics/tracker/迁移目录），以及 Step 3 若发生让步要单列一行。

### Task 28: D 轨总门（体积 / 像素 / 两主题）

**Files:**
- Create: `scripts/build/cat-contact-sheet.mjs`（把 198 个 target 拼成一张带标签的联系表，写到 `D:\cyrene-p4-accept\sheet.html`，**不进 git**）

**Interfaces:**
- Consumes: Task 26 的 `CAT_STICKERS`、Task 24 的 `SPRITE_TARGETS`、Task 25 的 `NON_CHARACTER_TARGETS`、Task 24 的 `--check`
- Produces: 一个可被浏览器打开、按主题色切换的自检页；三条写进提交正文的实测值

- [ ] **Step 1: 体积三连（前 / 后 / 单张分布）**

```bash
du -sh src/renderer
git ls-files -z -- 'src/renderer/**/*.png' | xargs -0 du -ch | tail -1
git ls-files -z -- 'src/renderer/**/*.png' | xargs -0 ls -l | awk '{print $5}' | sort -n | awk '{a[NR]=$1} END{print "min",a[1],"p50",a[int(NR/2)],"max",a[NR],"n",NR}'
```
判据：`src/renderer` **< 15 MB**（基线 237 MB）；单张 p50 应远低于 60 KB。
若总量超 15 MB：先看是不是 `ss: 2` 开着（R-D1 的预算按 ss=2 算），再考虑调色板量化；
**不许改 `checkTarget` 的预算来迁就产物**。

- [ ] **Step 2: `--check` 全表**

```bash
node scripts/build/cat-sprites.mjs --check
```
Expected：198 条全绿（129 + 17 + 52）。任何一条红都按 Task 24 的裁决处理：改生成参数，不改判据。

- [ ] **Step 3: 联系表 + 两主题截图**

`cat-contact-sheet.mjs` 做三件事：
1. 扫 `SPRITE_TARGETS` / `NON_CHARACTER_TARGETS` / `CAT_STICKERS`（三张表都从 Task 24/26 那一个
   esbuild 入口 `node_modules/.cache/mochi-palette/cat-sprite-manifest.mjs` 读，不另开 bundle），按目录分组；
2. 每条 `<figure><img src="file:///…"><figcaption>相对路径 · 实际 KB</figcaption></figure>`，
   `img { image-rendering: pixelated }`，**按各自真实显示尺寸的一半渲染**（方图 64px、贴纸 96px、横幅 320px）——
   联系表是看「小尺寸下还认不认得出」，不是看大图；
3. 顶部两个按钮切 `data-theme="paper|ink"`，只改 `background`：`#f7f4ec` 与 `#101420`。
   白爪/深墨猫必须两种底上都分得清——这正是用户美术台账里「粉压墨会脏」那条的落地检查。

然后人工看（这是 D 轨唯一不能自动化的判据）：

```bash
npx electron . --user-data-dir=D:\cyrene-p0-probe
```
四眼：① 首屏 `cyrene-welcome.png` 是 16:9 且**猫没被裁头**；② splash 窗的 logo 不是白框；
③ 聊天里助手头像是圆猫（`border-radius:50%` 下耳朵别被切得只剩一撮毛）；④ 表情面板里随便点一张，
消息流里 160px 宽能认出表情。

- [ ] **Step 4: 提交正文里落数**

```bash
git log -1 --format=%H > /dev/null   # 只为确认在提交前跑过
```
提交信息：`chore(assets): D 轨总门——体积、像素尺、两主题联系表`
正文必须含：`du -sh src/renderer` 前/后、PNG 总数与 p50/max、`--check` 的 198/198、
以及 Step 3 四眼的结论（哪一眼没过就写没过，**不写「已检查」这种没有信息的句子**）。

### Task 29: 助手本名与残留文案（D7）

**Files:**
- Modify: `src/renderer/react/i18n/zh-CN.json`（85 处）、`en.json`（1 处）、`ja-JP.json`（1 处）
- Modify: `src/main/moments/character-personas.ts:290-293`、`moments-agent.ts:140`、`moments-context.ts:68,125,128,285`
- Modify: `src/main/call/call-manager.ts:304`
- Modify: `prompts/worldbook/{characters,Cyrene,story,world,_glossary}.md` 正文
- Modify: `src/main/memory/entity-graph.ts:208`（分词词典里那个名字）
- Modify: `skills/cyrene-original-voice/SKILL.md` 与 `references/` 正文

**Interfaces:**
- Consumes: Task 23 的 `ASSISTANT_NICKNAME = "麻糬"`、`ASSISTANT_LATIN = "Mochi"`
- Produces: 用户可见处不再出现「昔涟 / Cyrene / キュレネ」

**替换表（三语，一处不多一处不少）**：

| 语种 | 旧 | 新 | 例外 |
|---|---|---|---|
| zh-CN | 昔涟 | 麻糬 | `"characterNames"` 里角色名由 Task 23 改，不在本任务 |
| en | Cyrene | Mochi | `productName`/`appId` 由 Task 8 管，不在本任务 |
| ja-JP | キュレネ | モチ | |

- [ ] **Step 1: 先分类，再动手（这条决定别改什么）**

```bash
grep -rn "昔涟" src prompts skills --include=*.ts --include=*.tsx --include=*.json --include=*.md | wc -l
grep -rn "昔涟" src --include=*.ts --include=*.tsx | grep -v "\.test\." | grep -vE "^\S+:[0-9]+: *(\*|//|/\*)" | wc -l
```
第一行是全量（含注释与测试），第二行是**非注释、非测试的代码命中**——真正要改的只有第二行。
三类分开处理：

1. **用户可见字符串 / 送进 prompt 的文本** → 必改（上表 Files 列的那些）。
2. **注释** → 可改可不改；本任务只改「名字同时出现在紧邻的用户可见字符串」的那几处，
   避免一个提交里混进 80 行注释 diff。**不改的注释不算债**，它们描述的是历史实现。
3. **内部标识符** → 一律不改：`author === "cyrene"`、`"cyrene"` 这个 author id、
   `LEGACY_USER_DATA_DIR_NAME`、soul 分隔符、`skills/cyrene-original-voice/` 的目录名与 `name:` 字段。

> `skills/cyrene-original-voice` **不改名**，是本轮唯一的显式让步：目录名/`name:` 是技能加载器的键，
> 改名要同时验证加载、快照打包（`prepare:skills`）与 14 个引用它的 prompt 装配点，
> 而用户看不到这个 id——零收益、非零风险。**写进提交正文，不许静默留旧名。**

- [ ] **Step 2: 改代码里的 7 个显示点**

```ts
// character-personas.ts:293
if (author === "cyrene") return ASSISTANT_NICKNAME;
// moments-agent.ts:140
return author === "cyrene" ? ASSISTANT_NICKNAME : "用户";
// moments-context.ts:68 同上；125/128 的 "昔涟已点赞/已评论" → `${ASSISTANT_NICKNAME}已点赞`
// moments-context.ts:285 的 `[${clock}] 昔涟：` → `[${clock}] ${ASSISTANT_NICKNAME}：`
// call-manager.ts:304 的「昔涟克隆音频」→「麻糬克隆音频」
// entity-graph.ts:208 注释里的 "昔涟"、"小鹿" → "麻糬"、"小鹿"（这是分词词典举例，跟代码同一行语义）
```
`moments-context.ts:160,285` 的「提到"你"优先昔涟动态」是**注释**，按 Step 1 第 2 类处理。

- [ ] **Step 3: i18n 三文件**

zh-CN 的 85 处按上下文分两批：
```bash
grep -n "昔涟" src/renderer/react/i18n/zh-CN.json | head -90
```
① `characters.characterNames` 那一块（Task 23 已改为 12 只猫的名字，本任务**跳过**）；
② 其余全部是助手自称（tagline、placeholder、waitText、stickerAlt、call 文案…），逐条换 `麻糬`。
`en.json:377` 的 `"昔涟": "Cyrene"` 是 Task 23 的角色名映射键，**不动**；
`ja-JP.json:393` 同理。两文件里其余 0 处。

> 替换用文件级 `Edit` 逐条改，**不要 `sed -i` 全仓替换**——`昔涟` 在 132 个文件里出现，
> 里面有 14 个 persona 卡（Task 23 已按「每只猫一个档位」重写）与 15 个 moments 文件（一半是注释），
> 一次 sed 会把 Task 23 的工作与注释一起搅进 diff，评审时没法分辨哪行是文案、哪行是逻辑。

- [ ] **Step 4: prompt 与世界书**

`prompts/worldbook/` 五个文件只改「自称」：把「你是昔涟」类句子改成「你是麻糬」，
**世界观段落里指代别人的「昔涟」不动**（如果上下文里她是第三方角色，那是 Task 23 的
`LEGACY_CHARACTER_MAP` 范围，不是本任务）。逐文件读完再改，这一步不接受批量替换。

`prompts/task/*.md`（14 个）在 Task 23 已改标题与第一人称；本任务只复核 `grep -rn "昔涟" prompts/task`
应为空。

- [ ] **Step 5: 门 + 提交**

```bash
CI=true npx vitest run src/main/moments src/main/memory src/renderer/react/i18n src/main/call
npx tsc -p tsconfig.main.json --noEmit
grep -rn "昔涟" src --include=*.ts --include=*.tsx | grep -v "\.test\." | grep -vE "^\S+:[0-9]+: *(\*|//|/\*)" | wc -l
grep -rn "昔涟\|キュレネ" src/renderer/react/i18n | grep -v characterNames | wc -l
```
Expected：第三、四行都是 `0`（注释与 `characterNames` 不计）。测试红多半是快照/期望串里写了旧名——
改期望串，不改实现。

```bash
git add src/renderer/react/i18n src/main/moments src/main/call src/main/memory src/shared prompts \
  skills/cyrene-original-voice
git commit -m "feat(voice): 助手本名改为麻糬，清掉用户可见的旧名"
```
正文列：7 个显示点、3 个语种、`skills/cyrene-original-voice` 不改名的让步与理由、
以及「注释里的旧名保留」这条决定（避免评审把它当漏改）。

## 阶段 E：收口（Task 30–32）

E 期不加功能，只回答三个问题：**全量门绿不绿 / 用户第一眼对不对 / 装出来的东西还是不是这个 App。**
三条都必须留下可复核的输出（命令 + 数字 + 截图路径），写在提交正文里；「已验收」三个字不算证据。

### Task 30: 全量门

**Files:**
- 不改代码（红了就回到对应任务修，不在本任务里打补丁）

**Interfaces:**
- Consumes: Task 1–29 全部产物
- Produces: 一份门禁输出快照（贴进提交正文）

- [ ] **Step 1: 类型三门 + 构建**

```bash
npx tsc -p tsconfig.main.json --noEmit
npx tsc -p tsconfig.preload.json --noEmit
npx tsc -p tsconfig.renderer.json
node scripts/build/desktop-typescript.mjs main
node scripts/build/desktop-typescript.mjs preload
npx vite build
```
Expected：六条全绿。`tsconfig.renderer.json` 没有 `noEmit`（项目原样），它会产出声明文件——
这是既有行为，别在本期顺手改成 `--noEmit`（会掩盖真实构建差异）。

- [ ] **Step 2: 全量测试**

```bash
CI=true npx vitest run
```
Expected：全绿。若出现超时，先看是不是 `scripts/` 下的新文件被误加进了测试路径——
`scripts/` 既不在 tsconfig 也不在 vitest include，**本期不许把它加进去**（R-D6）。
`packages/*` 的 fork-worker 崩溃是老问题，`vitest.config.mts` 已禁用，保持禁用。

- [ ] **Step 3: 资产尺与死链**

```bash
node scripts/build/cat-sprites.mjs --check
CI=true npx vitest run src/main/egress/upstream-off.test.ts
```
Expected：198/198 绿；A 期那把静态锁绿。

### Task 31: 三层验收（出口 / 视觉 / 装机）

**Files:**
- Create: `scripts/verify/p4-visual-oracle.mjs`（读截图 PNG，用 Task 22 的 `decodePng` 量三件事；**不进 vitest**，产物写 `D:\cyrene-p4-accept\shots\report.json`）

**Interfaces:**
- Consumes: 构建产物 `dist/main`、`dist/renderer`；Task 22 `decodePng`
- Produces: `report.json`（三主题 × 四个取样点的数值）

- [ ] **Step 1: 第一层——出口为零**

```bash
npx electron . --user-data-dir=D:\cyrene-p0-probe --egress-probe=20000
```
Expected：stdout 末行 `[egress-probe] external=0`，且 `D:\cyrene-p0-probe\egress-probe.json`
里 `entries: []`。
非零就按 Task 6 的记录逐条查 URL：**本期唯一允许的外部请求是用户显式触发的模型调用**，
空闲档一个都不该有。截图与 JSON 一起贴进提交正文。

- [ ] **Step 2: 第二层——视觉（截图 + 像素判据）**

起窗（只读自家 profile）：

```bash
npx electron . --user-data-dir=D:\cyrene-p0-probe --remote-debugging-port=9333
```
用 chrome-devtools MCP（`list_pages` → `take_screenshot`）各抓一张，存到
`D:\cyrene-p4-accept\shots\`：

| 文件 | 画面 | 判据（脚本量） |
|---|---|---|
| `welcome.png` | 首屏 welcome gate | 海报区域高宽比 ∈ [0.55, 0.58]（16:9）；左上角 8×8 不是纯白（猫没被裁成白底） |
| `avatar-paper.png` | 浅色主题下的一条助手消息 | 头像方形区域**四角**像素与面板底色差 < 6/255（圆遮罩生效）；墨质心离块心 < 3px |
| `avatar-ink.png` | 深色主题同一条消息 | 同上；且墨均亮度 > 60（深底上不能糊成一块） |
| `sticker.png` | 消息流里一张 160px 宽贴纸 | 非透明像素外接框宽 ∈ [120, 200]px；外接框内覆盖率 ∈ [0.25, 0.85] |

切换主题走设置页（Appearance），**不要改 CSS 注入**——验收要验的是用户走得到的那条路。

```bash
node scripts/verify/p4-visual-oracle.mjs D:\cyrene-p4-accept\shots
```
Expected：`report.json` 四张全 `pass: true`。
> 这四条是**屏幕尺**，不是美术品味：它们只回答「圆遮罩有没有 / 猫有没有被裁 / 小尺寸还认不认得出」。
> 任何一条红，先怀疑生成参数（crop/pose/尺寸），别改阈值——阈值只能为了「量法本身错了」而改，
> 改的时候把旧值与被推翻的理由一起写进 `report.json`。

- [ ] **Step 3: 第三层——装机身份**

```bash
npx pnpm@10.33.0 run build
npx electron-builder --win nsis --config.nsis.artifactName="Mochi-Setup-${version}.${ext}"
```
（`pnpm` 不在 PATH 时用 `npx pnpm@10.33.0` 包一层；**不要**为了跑一句脚本去改全局 PATH。）

安装到 D 盘的临时目录，**绝不装进 Program Files**（本机无管理员权限），也**绝不碰
`%APPDATA%\Cyrene`**：

```bash
Mochi-Setup-*.exe /S /D=D:\cyrene-p4-install
```
验收四眼：
1. `D:\cyrene-p4-install` 下 exe 名与安装向导标题都是 **Mochi**（不是 Cyrene）；
2. 开始菜单快捷方式的名字是 Mochi、图标是猫；
3. 用 `--user-data-dir=D:\cyrene-p0-probe` 起一次安装版，托盘菜单与关于页显示 Mochi；
4. 卸载（`Uninstall Mochi.exe /S`）后 `D:\cyrene-p4-install` 清空。

若第 1–3 眼有任一不过：先查 `electron-builder.yml` 的 `productName`/`nsis.menuCategory`/`win.icon`，
再查 Task 8 的生成器——**不要在 Task 31 里改身份字符串**，那是 A/B 期的事，回来改会让提交历史断线。

> 安装会创建开始菜单项与桌面快捷方式；这是**我们自己产品的测试安装**，验收后必须卸载干净。
> 卸载后若 `D:\cyrene-p4-install` 里还剩文件，先 `git status` 确认那些不是仓内文件再删。

### Task 32: 收口提交与移交

**Files:**
- Modify: `docs/verge/plans/2026-10-19-p4-personalization-mochi.md`（把执行中偏离计划的地方补成「落地记录」小节）
- Create: `docs/verge/notes/2026-10-19-p4-acceptance.md`（三层验收输出快照）

**Interfaces:**
- Consumes: Task 30/31 的输出
- Produces: 一份可被下次会话直接接手的验收记录

- [ ] **Step 1: 写验收记录**

`docs/verge/notes/2026-10-19-p4-acceptance.md` 至少含：

```markdown
# P4 个人化验收记录（2026-10-19）

## 门禁
- tsc main/preload/renderer：<pass>
- vitest 全量：<N passed / N failed>
- cat-sprites --check：198/198
- egress-probe：external=0（D:\cyrene-p0-probe\egress-probe.json）

## 体积
- src/renderer：237M → <实测>
- 位图总数 / p50 / max：<实测>

## 视觉
- shots/{welcome,avatar-paper,avatar-ink,sticker}.png + report.json（四张全 pass）

## 装机
- 安装向导标题 / 快捷方式 / exe 名 / 卸载清理：<逐条结论>

## 让步（显式）
- <例：pixi 依赖未移除 / installerSidebar 删除 / skills/cyrene-original-voice 未改名>
```

让步一条都不许省。**期内的显式让步不是失败，没写下来的让步才是**——下一个人会把它当成漏做。

- [ ] **Step 2: 计划文件补「落地记录」**

在计划末尾（本文档）加一节 `## 落地记录`，只写三类内容：
1. 实际改了计划的地方（文件名、尺寸档、测试方式）；
2. 计划里写错、执行时被实测推翻的地方（连同推翻它的那条命令输出）；
3. 明确移到下一期的项（例如 `installerSidebar` 若按 Task 11 的裁决删除）。

不写「已完成 Task N」这类流水账——`git log` 里已经有了。

- [ ] **Step 3: 提交**

```bash
git add docs/verge/notes/2026-10-19-p4-acceptance.md docs/verge/plans/2026-10-19-p4-personalization-mochi.md
git commit -m "docs(verge): P4 个人化验收记录与落地偏差"
```

- [ ] **Step 4: 移交（不合并、不推送）**

```bash
git log --oneline master..HEAD | wc -l
git status --short
```
Expected：工作区干净；提交数与任务数同量级。
按仓库纪律：**`git push` 禁止**（remote `upstream` 是原来的 GitHub 仓），`verge`→`master` 的合并
需要用户显式同意。把这两句原样写进交接消息，不做「顺手合并」。

---

## 执行顺序总表

| 期 | 任务 | 一句话 | 前置 |
|---|---|---|---|
| A | 1–6 | 拆掉公告/字体/更新/品牌外链/插件市场，加运行时出口看门狗 | — |
| B | 7–12 | 拆 obf 密钥雷、brand 落地、userData 迁移、名字清扫、装机身份、自启与协议锁 | A |
| C | 13–19 | 猫色板统一主题与模块 CSS | B |
| D | 20–22 | 花色/姿态/取景轴 + 软件光栅化器 | C（20 要 13 的色板） |
| D | 23 | 12 只猫伴名册 + 助手本名 | 20 |
| D | 24–26 | 198 张位图 + 表情包 + 像素尺 | 20, 21, 22, 23 |
| D | 27 | Live2D 残骸清零 | 24（新图先落盘） |
| D | 28–29 | 体积/视觉总门 + 残名清理 | 24–26（29 另需 23） |
| E | 30–32 | 全量门、三层验收、收口 | 全部 |

**任务之间的硬顺序**（按 `Consumes` 逐条对出来的，不是猜的）：

- 13 → 20（花色轴的九个槽全取 `pet-tokens.ts` 的板色）
- 20 → 21 → 24（花色 → 姿态/取景 → 全表）
- 22 → 24（`checkTarget` 与 `--check` 建在光栅器上）
- 23 → 24（名册决定 72 张状态图的目录名与花色）、23 → 29（助手本名）
- 24 → 25 → 28、24 → 26 → 28（两张资产表与总门都吃 24 的清单）
- 24 → 27（新图先落盘，旧模型后删）
- 30, 31 → 32（验收记录引用总门数字）

其余任务互不阻塞，可按批次并进；但**每个任务自己的测试-实现-提交循环不许跳过**。

---

## 落地记录

写在 2026-10-22 收口时；2026-10-23 补 §4（终审修复轮）。执行期的完整台账
（70+ 条编号裁决 `R-*`、每笔提交的 numstat、每条变异自检）在
`.superpowers/sdd/2026-10-19-p4-personalization-mochi/progress.md`，
而 `.superpowers/` 在 `.gitignore:155` 里——**台账不进仓**。仓内只剩两份可接手材料：
本节与 `docs/verge/notes/2026-10-19-p4-acceptance.md`。所以本节按编号写，便于对照。

下面只写三类东西，不写「已完成 Task N」流水账。

### 1. 实际改了计划的地方

**文件与路径**

| 计划写的 | 实际 | 说明 |
| --- | --- | --- |
| `docs/verge/notes/2026-10-19-p4-acceptance.md` | 同左（**未改**） | 计划字面如此，按计划落。**但仓里既有的笔记约定是 `docs/verge/plans/notes/`**（`p0-install.md` 就在那儿），两处并存——下期想统一就把这份挪过去，别再开第三个目录。 |
| `scripts/verify/p4-visual-oracle.mjs` | 同左，**外加** `p4-cdp-capture.mjs`、`p4-readme-shots.mjs` | 计划只列一把尺；实际要拍屏得自己驱动 CDP（计划写的 chrome-devtools MCP 本会话不可用）。 |
| Task 28 无脚本 | **新增** `scripts/build/cat-contact-sheet.mjs` | 联系表（198 figures / 26 组 / broken 0）用来肉眼过一遍两主题。 |
| `scripts/build/sync-brand.mjs` 只生成身份字段 | **身份字段 + 窗口标题**两件事 | `buildBrandFields` 管 `electron-builder.yml` / `package.json`；`buildWindowTitles` 管 5 份用户可见窗口 html 的 `<title>`。计划没区分这两个职责。 |
| （计划未提） | `scripts/build/apply-theme-palette.mjs` + npm 脚本 `palette:apply` / `palette:check` | C3 落盘脚本。`src/shared/palette-from-cat.ts` 是 104 个带色 `--rb-*`/`--md-*` 声明值的**唯一来源**，计划只说「派生器」。 |
| （计划未提） | `resources/cyrene-skills` → **`resources/mochi-skills`** | 装机后用户能在资源管理器里看见的目录名，跟着品牌走。仓库侧 `vendor/cyrene-skills/` 保留原名（构建源不是用户可见物）。联动 6 文件 12 处：`src/main/external-content-paths.ts`、`src/main/skills/snapshot-install{.ts,.test.ts}`、`scripts/packaging/build-skills-snapshot.mjs`、`scripts/verify/installer-artifacts.mjs`。 |

**尺寸档**

- 像素尺的 198 条目标，工具原话：`checked 198 targets · 12 只猫 × 6 档 + 25 档散点 + 17 张非角色 + 52 张表情`。
- 单张分布：min **4,908 B** / p50 **7,499 B** / max **25,797 B**（max 是 1280×720 的 `cyrene-welcome.png`）。
- `du -sh src/renderer` **6.8 MB**（D 轨前基线 237 MB）。

**测试方式**

| 计划写的 | 实际怎么跑 |
| --- | --- |
| `npx pnpm@10.33.0 run build` | `npm run build:renderer`（本机 pnpm 不可用，见 R-D27-1：`ERR_PNPM_UNEXPECTED_STORE`，node_modules 链在 `D:\pnpm-store\v10` 而 pnpm 要 `D:\.pnpm-store\v10`）。 |
| Task 31 用 chrome-devtools MCP 抓图 | 本会话该 MCP 不可用 → 改直连 CDP（`/json/list` 找 target → `Page.captureScreenshot`），并给每条 CDP 命令加 45 s 回音期限（R-31-5）。 |
| 探针跑在 `D:\cyrene-p0-probe` | 改 `D:\cyrene-p4-accept\profile7`（`profile1…profile13`、`profile-readme`）。一次性 profile 一律落在 `D:\cyrene-p4-accept\` 下，脚本里有 `assertSafeProfile` 拦。 |
| 像素尺用 Task 22 的 `decodePng` 读截图 | **不能用**：产品解码器只支持 8bit RGBA，CDP 截图是 8bit **RGB**（color type 2）+ 自适应行过滤 + 4 KB IDAT，直接 `RangeError`。尺子自带标准 PNG 解码（type 0/2/3/4/6、五种过滤、tRNS、CRC 校验），并先拿产品 `encodePng` 的产物做字节级自检。 |
| 肉眼看「图标是猫」 | 三段量法：装机 exe 图标 vs 同次构建 `win-unpacked` → **MAD 0**；`icon.ico` **原生 256 帧** vs `assets/mochi-icon.png` → **MAD 0**；vs 通用 Electron 图标 → **MAD 267.9**（反对照有牙）。统一白底合成——`ExtractAssociatedIcon` 永远只给 32×32 且丢 alpha，不能用它判小图同一性。 |
| CDP 量托盘菜单 | 量不到：托盘是 `Menu.buildFromTemplate` 的原生窗口，不在 page target 里。改**替代证据链**：装机 `app.asar`（282,909,676 B）字节盘点 `麻糬`×100 / `Mochi`×152 / `dev.damin.mochi`×4，116 处 `Cyrene` 逐处取上下文归类，**全部是标识符**，零用户可见文案。 |
| 32 个任务 | **109 个提交**（`master..HEAD`，截至 `3469cfda`；本文档提交后为 110；10-23 发布包补记后为 **111**）。一条任务常要拆成「先落锁」「再实现」「修复轮」「受控构建镜像」几笔；其中 **8 笔修复提交是 Task 32 之后的终审修复轮**（§4），另有 4 笔文档/构建补记。发布包证据见验收记录 §4：`release/Mochi-Setup-1.3.3.exe` **289,699,205 B**，三件随包二进制齐全。 |

### 2. 计划里写错、被实测推翻的地方

按期序。**每条都附推翻它的那条输出**——没输出的「实测推翻」不算数。

**A/B 期**

| 计划写的 | 实测 | 推翻它的输出 |
| --- | --- | --- |
| Task 12 的静态锁扫描器按计划内联遍历 | 照抄会**漏掉 `.github` 和两个根文件**，A 系列锁等于瞎 | `R-B12-1`：抽出 `src/main/egress/scan-source-files.ts` 共用（Task 1 与 Task 12 两把锁同一份遍历器）。 |
| 插件市场注册表规则按精确字符串匹配 | 需要容忍分隔符，且**没有正对照** | `R-B12-2`。 |
| Task 9 的 `pre-ready.ts:59` 提及产品名 | 应点名**旧数据目录**而不是产品 | 同上批（`task-10b-brief.md`）。 |

**C 期（配色统一）**

| 计划写的 | 实测 | 推翻它的输出 |
| --- | --- | --- |
| Task 18 颜色分类器的 `FUNC` 只认逗号 | 模块 CSS 里 **107 行用空格+斜杠语法**（`rgb(255 91 138 / 10%)` 等），品牌族 40 写法 / 57 处**一个都扫不到** | `R-18-4`（Critical）：后果不是「少清几处」而是**锁会说谎**——Task 19 清完看得见的那批，锁转绿，`#ff5b8a` 仍在 5 处画着。拆成 `FUNC_COMMA` + `FUNC_SPACE` 两条。 |
| Task 18 `classifyRgb(242,125,146)` 期望 `null` | 实测 h=349.2 / s=0.483 → `"red"`，且同一份 brief 的下一条又断言 ROSE 就在 red 窗口里 | `R-18-2`：**修期望值，窗口不动**。 |
| Task 18 `proposeToken("#ff5b8a")` 期望 `--rb-accent` | 纯按 v 分档会落 `--rb-pink-100`（v=1.0） | `R-18-3`：加 s 闸门 `v>=0.9&&s<0.25→pink-50` / `v>=0.78&&s<0.45→pink-100` / `v>=0.55→accent` / 否则 `pink-700`。 |
| Task 18 属性提取用 `/^\s*([a-z-]+)\s*:/i` | 匹配不到**单行规则**（`property` 留空），brief 自己的正对照第一条就会红；模块 CSS 实测 **170 行**是单行规则 | `R-18-2`：改成「就近向前找 `([a-zA-Z-]+)\s*:`」。 |
| Task 18 靶值 `#19161f`（6 处）/ `#4c3762`（4 处） | 仓库里分别 **0 处 / 1 处**（且是死 `var()` 兜底） | `R-18-1`：改按**完备性**扫，不追总数。 |
| Task 15 落盘后 `--check` 应当直接绿 | 首次挂掉的真因是 `(.*)$` **不匹配 CRLF 行尾的 `\r`**（JS 里 `.` 不吞 `\r`），不是折行声明 | `R-15-4`：实现者改 `([\s\S]*)$` 修好。**控制器自己的诊断错了一次**，已写进裁决。 |
| Task 15 的 `theme.css` 回写 ≤9 条 | 实测 **21** 条（块内 44 条） | `R-15-5` 前的当场纠正：上限 65/80/84（实测回写与之一致）。 |
| Task 16 的派生锁只按 `palette:check` 的行判 | 9 个名字上游只写在 `tokens.css` 的 `:root`；Task 15 按裁决把 `:root` 换成浅色默认层后，**深色档对这 9 条再无来源**，静默继承浅色值 | `R-16-1`：把 brief 的 `collectDecls()/effective()` 原样写成 `D:\p4-t16-preflight.mjs` 跑真实 CSS，报出 **9 条深色正向分歧**。修法按 brief 规矩回 Task 15 补 `DARK_TOKENS`，**不放松断言**。 |
| Task 15 落盘脚本「整份文件一个档」 | 初审判出 **1 条 Important = 真回归**：浅色派生值被写进 `theme.css:7` 的 `:root`，而 `:root` 与 `[data-ui-theme="x"]` 同为 (0,1,0)、`@import` 排它自己 `:root` 之前 → 默认深色面板上画出珍珠白反馈色 | `R-C15-1`：修复轮 `d2920867` 改成**按所属选择器**判档；复审用「改 `BLOCK_SCHEMES[2].scheme` 能精确复现那 5 行且不出别的」证明路由真在驱动输出。**控制器自己的独立核验当时也带同一个盲区，没抓到它。** |
| Task 16 的可达集枚举锁够用 | 可达集只是**下界**，改个 α 仍然通过 | `R-14-4`：Task 16 的派生锁必须**按算式逐个复算**。 |
| Task 17 的验收 grep 按名字找 `#141414` | 会误报 `palette-from-cat.ts:38` 的**历史注释**与一个 `it()` 标题 | `R-17-1`：验收 grep 必须**按值限定**（如 `backgroundColor: "#141414"`）。 |

**D 期（形象换猫）**

| 计划写的 | 实测 | 推翻它的输出 |
| --- | --- | --- |
| Task 20 示例里的 `keyof typeof CAT_COATS` | 类型循环 | `R-20-1`：实测报 **TS2502 / TS2456**，按计划 Interfaces 改成显式联合 `"ink"\|"paper"\|"gray"\|"azure"\|"rose"`。 |
| Task 20 用 `paper.light` 证「light 槽换了」 | **假绿**——`paper.light === PAPER` | `R-20-2`：改用 azure 并加 `azure.light !== PAPER` 正对照。 |
| Task 21 的耳外八 `rTw = twitch - 8*puff` | 符号反了：puff=0 时给出 `+twitch`（原式右耳是 `-twitch`），正角度还会把右耳尖往**外**转、左耳尖往**内**转，默认档锁必红 | `R-21-1`：落地 `lTw = twitch - 8*puff; rTw = -twitch + 8*puff`，枢轴 42/78 不动。 |
| Task 21 的「op 数取值 ≥9」 | 实测只有 **5 种**（姿态改的是坐标不是图元数） | `R-21-2`：改判据为整串 op 的**几何签名 12 两两不等**，保留 `ops.length>20` 与包围盒面积>8000 两条下限。 |
| Task 22 超采样 | 忘了把 op 坐标乘 `ss`，形状缩在左上角 `1/ss` | `R-22-1`：disc 质心判据必红。 |
| Task 22 `paintOp` 写直通色、降采样除以 alpha | 半透色被**除两次** | `R-22-2`：改为缓冲存预乘色、出口除回。白爪测试抓不到（会饱和），**半透叠色的 `px[0]≈43` 才抓得到**。 |
| Task 22 的描边定义 | `strokeRoundRect` 内缩 width 与 `strokePath` 的 ±width/2 互相矛盾 | `R-22-3`：统一为 canvas 的「以路径为中心」。`R-22-6`：`strokePath` 用「到折线距离 ≤ w/2」实现，无退化段 NaN。 |
| Task 22 的 `inkCentroid` | 用像素下标，对偶数宽对称形状**恒欠 0.5** | `R-22-4`：改用像素中心。 |
| Task 22 的 ICO 测试偏移 `6+6*12` | 应为 `6+6*16`；`ico[7]` 是首档高度=16 不是 0 | `R-22-5`。 |
| Task 23 说 rename 应为 48 条 | 实测 **121 条** | `R-23-1`：目录级 `git mv` 在 git 里按文件逐条记账（72 status-moods + 12 头像 + 12 立绘 + 12 委托卡 + 12 人格卡 + 麻糬.md）。 |
| Task 23 说委托卡正文只有称谓 | 实测是**完整动漫人格卡** | `R-23-2`：整份重写（保留工作流结构），否则委托出去的 agent 会以风堇的医师身份说话。 |
| Task 23 Step 6 要求 grep「黄金裔」清零 | 命中的是 **798 行世界书**（不在 Task 23 文件表） | `R-23-3`。 |
| Task 23 直接提交 24 份重写的卡 | 会掉 R（相似度 <1%） | `R-23-4`：拆成两条——先 `update-index` 再改内容。 |
| Task 24 的跨条目判据 ①（覆盖度差 / 质心距） | **假阴性**：`thinking/peek/.1` 与 `idle/peek/0` 判不出差别 | `R-24-1`。 |
| Task 24 的「原生 vs 自定义」两条档 | 逐像素差 **0.000%**（`energy` 在 t=0 只调动画幅度） | `R-24-2`：`自定义` 改 `prone`。 |
| Task 24 的统一带 [0.22,0.80] + 质心 12% | 会把整类 `square`/`bust` 判红——肖像是脸填满画框 | `R-24-3`。另加一条显式违规「`crop:"wide"` 却缺 `height`」（`R-24-4`），防方形档被更松的横幅带静默兜住。`full` 锚点 60→77（`R-24-5`）。 |
| Task 26 的 fixture 清单 | 少两处：`moments-service.test.ts:1596` 与 `moment-media-matcher.test.ts:62` 还有 `stickers/sleepynow.jpg` | `R-26-1`：实改 4 处 + `moments-types.ts` 注释。 |
| Task 26 说旧目录 47 jpg / 5 png | 实测 **44 jpg / 6 png / 2 gif**，差的 3 个正是 `peek.gif`/`clingy-confused.gif`/`love-calm.png` 三张 `RIFF…WEBP` 冒充后缀 | `R-26-2`。`R-26-3`：6 张同名 png 是**覆盖**（`M`），`git rm` 只处理 46 个非 png。 |
| Task 25 说 40 张贴纸 | 39 ≠ 40 | `R-25-2`：**不补空文件凑数**。 |
| Task 25 的 splash 起窗脚本 | 第一次「先起应用再连 CDP」扑空（splash 早关，`NO_SPLASH_TARGET`） | `R-25-4`：splash 必须真起窗看。`R-D27-3` 同类教训：**找不到 canvas 先怀疑探针锁错窗**（`/index\.html/` 锁到了 toast 窗 → 假红）。 |
| Task 29 的三处计数 | i18n 实际 **74/48/74**（计划 85/1/1）、prompts **21 个文件**（计划只点 5 个 worldbook）、skills **21 个文件**（计划只点 1 个目录） | `R-29-1`：按「会不会被用户或模型读到」重定范围。 |
| Task 29 说「注释里的旧名保留」 | `allow_multiple` 把注释一起改了，**回退反而更脏** | `R-29-2`：注释一并改名。 |
| Task 29 说不改 `skills/cyrene-original-voice` 目录名 | 不改是对的（调度器按目录名硬编码引用），但 `references/boundary.md:11` 的台词原文是**唯一**剩下的旧名，逐字保留 | `R-29-3`：`skills/` 下 1 处、`prompts/` 0 处、生产 `src` 0 处。 |

**E 期（收口）**

| 计划写的 | 实测 | 推翻它的输出 |
| --- | --- | --- |
| Task 31 探针产物落在 `D:\cyrene-p0-probe\egress-probe.json`、键名 `entries` | 实现落在 userData **之内**、键名 `external`；探针档的 userData 已在卷根下一层，`path.dirname(userData)` 就是 `D:\`，`mkdirSync(recursive)` 只吞 EEXIST → **弹模态 Error 框、进程不退出也不落盘** | `R-31-1`：以验收侧为准（outDir = userData，键名 `external`），落盘失败改成打一行 + `app.exit(1)`——探针档的唯一契约是「退出码即判据」。 |
| Task 31 探针排完尺就退出 | `external=0` 是**「什么都没跑」的 0**（vacuous 探针） | `R-31-3`：探针分支必须 `return application.start()`；另写仓外正对照 `p4-egress-control.mjs`，实测 `saw 1 → 26 → 51 webRequest events`（最后一件是 `dist/renderer/assets/moments-*.png`），证明通道活着。**正对照不绿，`external=0` 不作数。** |
| Task 31 尺子登记在 `webRequest` 上 | 登记在**可改报文**的 channel 上会让 Chromium 把主框架 `file://` 导航压进异步等待 → 没有 `ready-to-show` → 判致命失败；且 Electron 每条 channel 只保留最后一个 listener，别人的 listener 会被静默顶掉 | `R-31-2`：只登记通报通道 `onSendHeaders` + `onErrorOccurred`（同 URL 去重、记 `via`），并加「禁登记阻塞 channel」的锁。 |
| Task 31 头像判据「四角与面板底色差 < 6」 | 实际 `ChatMessageList.css:97-124` 挂着 `filter: drop-shadow(0 2px 8px …pink 22%)` 向下偏移 2px，下角必然离底色 7–9；方底真露出来是粉描边那个量级（21） | `R-31-6`：6 → **15**，并拆出「上两角 < 6」。 |
| Task 31 居中口径 `ink(>20)` | 奶油猫毛 `#f7f4ec` 压奶油面板 `#f9f7f1` 最大通道差只有 5，对 `INK_DELTA` 完全隐形——旧口径量的是**眉毛不是脸**（浅色档旧口径 4.576 假红，新口径 1.675） | `R-31-6`：`ink(>20)` → `silhouette(>4)`，阈值 3 CSS px 不动。旧口径继续报数只作诊断。放宽过的尺补 **11 张合成图变异自检**。 |
| Task 31 要用**仓外临时配置**剥掉三项缺失 `extraResources` | 不需要——electron-builder 自己对缺失源打 `file source doesn't exist` 并跳过，**用仓内原配置就能出包** | `R-31-7`（原裁决作废）：结论的另一半仍成立且必须传下去——**这个测试包不是发布产物**。 |
| Task 30 说「红了回到对应任务修，不在本任务里打补丁」 | 唯一的仓库变更是受控镜像 `dist/renderer/splash.html`（`vite build` 的产物副本，源文件 Task 29 已改） | `R-30-1`：镜像同步算「门禁产物对齐」，不算「在本任务打补丁」——补丁指改实现让门变绿，这里改的是已提交源码的既有产物副本。 |
| Task 28 台账记「198 张 / 2.1 MB」 | 逐字节真值 **1,797,100 B = 1.71 MiB** | 不是资产变了，是**算法不同**：台账那个 2.1 MB 是按 4 KB 块向上取整后的和（198 × ⌈size/4096⌉ × 4096 = **2,125,824 B**）；资产集合在 `26d06198` / `04996dcb` / `HEAD` 三个提交点实测**一个字节都没变**，min/p50/max 三项与台账逐位相同。差异只在总量那一行的口径。 |

**一条贯穿全期的教训**（不是某条计划的错，是环境）：`grep -c $'\r$'` 在这套 Git Bash 上对**任何** CRLF 文件都返回 0（MSYS grep 先把 `\r` 吃掉）——用它判行尾是**空判据**。行尾一律用字节统计。相关地，`src/main/verge/pet-menu.ts` 是 autocrlf 幻影文件（numstat 空、diff 空），**永不暂存**，回退用 `cp` 不用 `git checkout --`（R-16-6）。`settings-facade.ts` 那次 42/42 的幻影 churn，解法是从 `git cat-file blob HEAD:path` 重放那一行内容改动再覆盖回工作树（R-29-6）。

### 3. 明确移到下一期的项

**（a）计划内明文允许的**

1. `package.json` 的 `pixi.js` / `pixi-live2d-display` 两个 devDependencies 仍在（`^7.3.0` / `0.5.0-beta`）。运行时树已由 Task 27 删净，asar 里那处命中就是 package.json 文本本身。删掉属「可以整体删」而非必须（R-D27-1：pnpm store 路径冲突，未手改 lockfile）。
2. **装机侧 `installerSidebar` 的两行配置已在 Task 11 删掉**（计划 line 1931 的自裁裁决：「若 24bit BMP
   编码器实现代价过大，裁决：`installerSidebar` 两行整条删除」）——实测 `electron-builder.yml` 里
   已无 `installerSidebar` 键（只剩 `icon: assets/mochi-icon.png`）。**留到下一期的只是那份没被引用的
   历史素材**：`build/installer/installer-sidebar.bmp` 与 `build/installer/cyrene-installer-source.png`
   （后者是 Task 11 新画的 `mochi-installer-source.png` 的旧版同物）仍在仓里，无消费者。
3. **`docs/design/*`（51 份带日期的上游工程记录）一个字没改**。实测它们**不含**第三方 IP 版权叙述，只有关于被抄代码（dsh / ZCode / gamebot）的 MIT 署名注记——那些不能改写。R-29-7 只动了 `README.md` / `README.en.md` / `MODEL_LICENSE.md` / banner 文案。
4. **`vendor/cyrene-skills/`（仓库侧构建源）保留原名**，只把**装机后**的目录改成 `resources/mochi-skills/`（见 §1）。
5. **免责声明页保留米哈游 / Live2D 鸣谢**（R-31-13，计划 Task 4 Step 4 明文「保留条款内容」）。外链确实清零了（`github=0`、`http://` 与 `https://` 计数 0）；删第三方 IP 的防御性声明不是个人化收益而是法务回退。

**（b）本期发现、明确不做、等下一期**

6. **发布包前置没跑**：测试安装包缺 `cyrene-screenshot.exe` / mpv / MinGit 三项随包二进制，**不是发布产物**。发布包必须先 `cargo` 构建截图助手 + `prepare:mingit` + `prepare:mpv` 再 `package:win`。
7. **窗口标题修复的屏幕层复验**：`src/renderer/react/index.html` 的 `麻糬 · 聊天（React）` → 去掉后缀（提交 `05f73b27`，并给标题加了会红的锁）。第三眼那轮读数跑在修复**之前**，所以 `packaged-identity3.json` 里仍是旧标题——**它是「已修 + 已上锁」，不是「已验收通过」**。
8. **`tsconfig.main.json` 的 `exclude` 含 `src/main/**/*.test.ts`** —— 主进程**测试文件不参与类型检查**。评审第 6 条已提出，**本期 DEFERRED**（属项目原样，不在本期范围）。
9. **`src/main/egress/upstream-off.test.ts` 的例外匹配没有路径边界**（第 176 行 `posixPath(file).endsWith(candidate.file)`）：例外项写 `features/chat/components/svg-sanitize.test.ts` 时，`别的目录/features/chat/components/svg-sanitize.test.ts` 也会被一并豁免。
10. **CSP 尺只认 `scheme://`**（`learn-exam-csp.test.ts:18` 的 `/(?:https?|wss?):\/\/([^\s;'"]+)/g`）：今天 CSP 由固定模板生成、没有裸域名；但若有人写成 `font-src 'self' gstatic.com`（无协议），这条尺看不见。
11. **A1 公告规则的名字覆盖面窄**：规则里点名的 10 个标识符中，只有 **2 个**（`NewsItem`、`cyrene-announcement`）是上游 `src/main/news/news-feed.ts` 里真实存在的名字；其余 8 个（`NewsEntry` / `NewsFetch` / `NewsPayload` / `NewsResult` / `createNewsFeedService` / `parseNews` / `registerNewsIpc` / 裸 `news`）是被「整目录删除」带走的，锁没有单独复述它们的名字。
12. **`ConversationSidebar.css` 等处的 `var(--rb-text-primary, #1d1d1f)` 是死兜底**（实测 5 处：`:59` `:90` `:109` `:113` `:114`）：`--rb-text-primary` 永远有值，那个 `#1d1d1f` 永远不生效。属残余字面量，不影响观感。
13. **`ChatMessageList.test.ts:264` 的 `not.toContain("昔涟已完成")` 已失真**：改名后该字符串本就不可能出现，这条负向断言**恒真**——「负向断言不报错」不代表它还有效。
14. **renderer 的 tsconfig 没有 `noEmit`**（项目原样，按 R-D6 不动）。
15. **`packages/*` 的 fork-worker 仍被禁用**（`vitest.config.mts:19` 注释）：`plugin-sdk/src/testing/index.test.ts` 在 windows-2025 镜像下会让 vitest worker 静默崩溃。
16. **迁移夹具往 `os.tmpdir()` 写**（C 盘）。测试产物落在 C 盘 TEMP，与「产物一律放 D:」的纪律不一致；属测试夹具的既有写法。
17. **`cpSync` 兜底路径会留下空的 `%APPDATA%\cyrene-verge` 孤儿目录**（评审第 7 条）。
18. **M5「gpu 同步构造」的假设**保留为已知限制，未做加固。

**（c）授权与纪律上没做、也不该顺手做的**

19. `git push` 禁止（remote `upstream` 是原来的 GitHub 仓）；`verge`→`master` 的合并需要用户显式同意。
20. `%APPDATA%\Cyrene`（246 MB 上游用户数据）全程**只读禁写**；验收一律用 `D:\cyrene-p4-accept\` 下的一次性 profile。
21. 验收全程没点过节点行 / 「选择最优」/「立即实测」，没对 mihomo 发过 `PUT`/`POST`/`GET /group/*/delay`，没启停过用户自己的其他应用。

### 4. 终审修复轮（验收后新增，2026-10-23）

这一轮**不在原计划里**：Task 32 冻结后做整分支终审，扫出三处「上游仍可访问」的洞、两片锁的盲区
和一条空转测试；收口前复看两把联网工具，又扫出一个重定向旁路（B-4）；
`ef0db71c..HEAD` 的 scoped 复审再扫出三处出口洞（B-5～B-7）与 A6 的可选写法假牙。
修复共 **8 笔**（`21a18032` / `72cacbb7` / `9b9cbea7` / `d92f541f` / `d1e8644c` / `ed693cd6` /
`8a4bcfb0` / `3469cfda`），另有 3 笔文档提交。
下面按 §1–§3 的同一口径记，不重述流水。

**4.1 实际改了计划的地方**

| 项 | 实际 | 为什么计划没覆盖 |
| --- | --- | --- |
| 内置浏览器 | 新增 `src/main/browser/browser-navigation.ts` 作为唯一导航闸门：地址栏、页内导航、重定向、弹窗、右键、favicon、会话恢复七个入口全过；`BrowserPanelResult` 增加 `blocked_upstream_host`，三语提示 | 计划只锁「静态标识面」与「外部链接」，没设计「用户或模型主动把上游装进内置浏览器」这条运行时路径 |
| `fetch_url` | 删除整段 GitHub API 特化（`GITHUB_RESERVED_PREFIXES` / `matchGithubRepoUrl` / `fetchGithubRepoSummary` / `formatGithubMeta`，-126 行）；上游域名在**缓存之前**拒绝 | 静态锁能证明「没有上游字符串」，证明不了「没有通往上游的功能路径」 |
| `download_file` | 协议检查之后、任何网络之前加上游闸门 | 与 `fetch_url` 同口径 |
| 出口看门狗 | `installEgressWatchdogEverywhere()` 覆盖 `defaultSession` + 所有 `session-created` 的 partition；探针 JSON 加 `scope.webRequestSessions` 与 `scope.excludes` | 旧尺只挂 `defaultSession`，而内置浏览器（`persist:cyrene-right-browser`）与考试页（`cyrene-learn-exam`）各用一个 session |
| SVG 消毒 | `stripStyleImports` 在 DOMPurify **前后各剥一次**，覆盖 `url()` 带不带引号、裸字符串、媒体查询尾巴；`@media` / `@keyframes` 保留 | 原实现只删 Google Fonts 那一条域，模型手写 SVG 与 beautiful-mermaid 都能用 `@import` 外呼任意宿主 |
| 出口静态锁 | 新增 **A7「运行时出口闸门在场」**，钉住三个入口的 `parseBrowserNavigation(` / `isUpstreamUrl(` 调用形状 | A6 只管「尺子装没装」，不管「闸门在不在」 |
| 扫描器扩展名 | `SCAN_EXTENSIONS` 补 `.js` / `.cjs` / `.ps1` / `.py` / `.cmd` / `.bat`；正对照钉住四个真实文件（`panel-bridge.js`、`native-import.cjs`、`migrate-user-data.ps1`、`music-component-entry.py`） | 这四份会进产物或被装机流程执行，此前整份在出口规则射程外 |
| 窗口标题锁 | 从手抄五份 html 改成**目录派生 + 白名单**；表情包窗口的「表情包管理」正是手抄漏掉的；title 并进 `sync-brand.mjs` 生成器 | 手抄清单每新增一个窗口就漏一次 |
| 派生锁 / 颜色锁 | 派生锁逐层解开 `var()` 间接层并回写表与 CSS 的 6 处不一致；TS/TSX 七处上游粉改走猫板派生；颜色锁补 hsl 与 `.ts/.tsx` 两片盲区，清掉考试页的裸 HSL 上游粉 | 原锁对 `var()` 一律豁免、只认 hex/rgb，也只看 CSS |
| 重定向闸门 | 新增 `src/main/egress/safe-fetch.ts`：`fetchWithoutUpstreamRedirects()` 手动逐跳，每跳 `isUpstreamUrl`，命中抛 `UpstreamRedirectBlockedError` 且不向上游发请求；两把抓取工具全改走它 | 计划只设计「入口拒绝上游 URL」，没设计「非上游 URL 302 到上游」这条路径；`redirect:"follow"` 让入口闸门只看得到第一跳 |
| 域名归一化 | `isUpstreamHost` 比较前 `.replace(/\.+$/, "")`；新增 `src/shared/upstream-hosts.test.ts`（25 条），把尾点、大小写、子域、仿冒域名四类边界钉死 | 计划把「域名匹配」当成已解决的小节，没写 FQDN 尾点；`URL.hostname` 保留尾点，`github.com.` 能整条绕过 |
| SVG 样式外链 | 匹配前剥 CSS 注释、解十六进制转义；`@import` 删到规则结束；上游 `url()` 换 `url("data:,")`；表现属性 / `style` 属性加 DOMPurify `uponSanitizeAttribute` hook；`read_image_url` 在缓存与模型调用前拒绝上游 | B-3 只把 `@import` 的字面写法补全，没考虑注释分隔（`@import/**/`）、CSS 转义（`@im\70 ort`）与 `style` 里的 `url()`——DOMPurify 不解析 CSS |
| 重定向报文体与方法 | 每次抛错/跟跳前 `body.cancel()`；301/302 的 POST 与 303 改 GET 并去掉 `content-length`/`content-type`；307/308 保留方法与 body；3xx 无 `Location` 原样返回 | 计划只要求「逐跳校验」，没写「响应体要取消」与「重定向的方法语义」；前者漏连接，后者把 POST 语义带错 |
| 看门狗静态锁收紧 | A6 正则由 `installEgressWatchdog(?:Everywhere)?\(` 收紧为 `installEgressWatchdogEverywhere\(` | 旧写法给「退回 defaultSession-only」留了合法通道，静态锁等于没牙 |
| 音乐缓存出口 | `cache-downloader` 从裸 `fetch(playUrl)` 改走 `fetchWithoutUpstreamRedirects()`，并补「上游地址不落盘、不发请求」单测 | 计划的上游出口清单只列了模型可见工具与内置浏览器，漏了播放地址下载这条后台外呼 |

**4.2 被实测推翻的地方**

| 原结论 | 实测 | 推翻它的输出 |
| --- | --- | --- |
| 验收记录 §1 的运行时出口 `external=0` | **只量了 defaultSession**。内置浏览器与考试页的 partition 完全不在表里；把探针当成全量出口证据是**射程外的假绿** | 多 session 测试：两个假 session 都记账、`sessionCount()===2`；变异成「只挂第一个」时测试红 |
| 「静态出口锁通过 = 客户端不访问上游」 | `fetch_url` 有 GitHub API 特化、内置浏览器能装任何 http(s)、SVG 能 `@import` 任意宿主——三条都不在静态规则里 | 三组新测试：7 个上游 host 的 fetch 拒绝、7 个导航入口拦截、4 种 `@import` 写法剥离 |
| A2 扫描器覆盖了「源码」 | `.js/.cjs/.ps1/.py` 整份没扫；把上游域名搬进 `.cjs` 即可绕过 | 正对照断言四个真实文件必须出现在扫描集合里 |
| 标题锁手抄的五份 html 是全集 | 表情包窗口的标题 `表情包管理` 不在清单里，且它确实是用户可见窗口 | 改目录派生后该文件自动进集合，锁当场覆盖 |
| 多 session 注销测试能证明「注销干净」 | **空转**：变异成「已有 session 就返回」时它仍绿——第二个 session 一个 channel 都没登记，注销循环跑了个寂寞 | `R-F7`：注销前先断言 `sessionCount()===2` 与 `second.registered.length>0` |
| 变异自检只需证明「实现坏了测试会红」 | 还得证明**测试自己不是空的**；本轮 11 条红里有 1 条最初没红，就是空转 | 同上 |
| 「定向回归绿 = 改动收口」 | 改了 `fetch_url` 的模型可见描述，`built-in-tools.snapshot.test.ts` 不在定向集合里 → 首轮全量 **1 failed / 594 passed**，红的正是模型可见字段快照 | 更新快照，并改掉 `install_mcp_server` 里「先用 `fetch_url` 读 README」的失效指引（上游 README 已取不到）→ 复跑 **595 passed / 5708 passed / 1 skipped / exit 0**（`D:\cyrene-p4-accept\fix-vitest.log`）。**定向集合是省时，不是收口判据。** |
| 「入口拒绝上游 URL = 这条外呼路径封死了」 | `fetch_url` / `download_file` 用 `redirect:"follow"`：入口检查只看得见第一跳，非上游短链 302 到 GitHub raw 时请求照发。这是终审 freeze 之后才被复看抓到的 | `safe-fetch.test.ts` 6 个上游 host 各自在跟跳前拒绝（`fetch` 只调用一次）；两把工具各加「只请求短链一次、不落盘」；变异短路逐跳闸门 → **8 条当场红**（R-F8） |
| 「`CI=true npx vitest run 2>&1 \| tail` 的退出码可信」 | 读到的是 **`tail` 的 0**：那一轮实际 `1 failed \| 594 passed`，失败被读成通过 | 改落日志再取 `echo "exit=$?"`；以后全量一律 `> 日志 2>&1` 后单独读退出码（R-F9，验收记录 §6） |
| 「`github.com.` 只是 DNS 细节，不影响域名判定」 | `new URL("https://github.com./x").hostname` 原样返回 `github.com.`，与黑名单不相等——**一个尾点绕过整条闸门**；原单测全用无尾点写法，尺子从没照过这个面 | `upstream-hosts.test.ts` 25 条补上尾点/大小写/仿冒域；变异去掉归一化 → **15 条红**（M1，`fix3` 轮） |
| 「过了 DOMPurify，SVG 的外链就断了」 | DOMPurify 不解析 `<style>` 里的 `url()`；`@import` 还能用 `/**/` 分隔或十六进制转义躲开正则。B-3 的「前后各剥一次」只补了字面写法 | 注释+转义、`style` 块、表现属性三组单测；变异归一化/URL 清洗 → 各红 1 条（M2/M3） |
| 「手动逐跳 = 重定向语义完整」 | 命中上游时没取消这一跳的响应体；301/302 的 POST 与 303 没改 GET，`content-length` 还带着旧 body 的长度 | `safe-fetch.test.ts` 21 条：取消响应体可观测、无 `Location` 返回 302、方法改写 `it.each`、307/308 正对照 |
| 「A6 已经把看门狗锁在 Everywhere 上」 | 正则写成 `installEgressWatchdog(?:Everywhere)?\(`，**退回 defaultSession-only 也照样绿** | 收紧后把组合根改回旧调用 → A6 当场红（M4）；`R-F12`：静态锁不许带「可选的更强写法」 |
| 「上游出口清单已经列全（模型工具 + 内置浏览器）」 | 音乐缓存下载用裸 `fetch(playUrl)`，既不逐跳也不拒绝上游；它不在模型可见工具里，但确实是客户端主动发出的请求 | 改走 `fetchWithoutUpstreamRedirects()` 并补「上游地址不发请求、不落盘、不写索引」；变异退回裸 `fetch` → 红 1 条（M6） |

**4.3 明确移到下一期**

22. **主进程 `fetch()` / undici 不经过 `webRequest`**：出口看门狗只看得见 Chromium 的请求。`fetch_url` / `download_file` 的上游拒绝靠**入口闸门 + A7 静态锁**，不是运行时观测；探针 JSON 的 `scope.excludes` 明写这条盲区。**下期不许把 `external=0` 读成「主进程也没发」。**（R-F5）
23. **内置浏览器子资源层不拦**：导航 / 重定向 / 弹窗 / 右键 / favicon / 会话恢复都过闸门，但第三方页面自己发出的 `<img src="https://github.com/…">` 这类子资源请求仍会取。A 期口径是「客户端不主动访问上游」，页面内嵌属用户所访站点的行为；请求级阻断会踩 R-31-2 的阻塞通道坑，留待下期。（R-F6）
24. **`session-created` 的射程边界**：它只覆盖装尺之后创建的 partition。今天所有 partition 都在 ready 后创建（组合根在 `application.start()` 之前装尺），所以够用；若未来出现 pre-ready session，要改成显式登记，不能假设事件一定到。
25. **A7 只钉调用形状**：它证明闸门还在被调用，不证明调用后真的拒绝（那由各入口的单测证明）。静态锁与单测是两条腿，缺一条都别读成全绿。
26. **A8 的射程只到这两把工具**：`fetchWithoutUpstreamRedirects()` 修的是 `fetch_url` / `download_file`。以后新增任何主进程外呼（`net.fetch`、第三方 SDK 自带下载器等），必须自己接逐跳闸门并补锁；**「有 A8」不等于「所有外呼都逐跳校验」**。（R-F8）
27. **OneBot 附件下载仍是裸 `fetch`**：`src/main/channels/adapters/qq/onebot-media.ts:260` 只检查 `http(s)`，没有过上游闸门。附件 URL 由用户自建的 OneBot 实现给出，不在「客户端主动访问上游」口径内，但对方若把地址指向上游，这个出口会真的发请求。下期接 `fetchWithoutUpstreamRedirects()` 并补单测。
28. **A7 / A8 是文本匹配，不是语义分析**：把调用注释掉仍可能满足正则。它们只能当「防止整段被删 / 被换回 `follow`」的绊线，不能替代入口行为单测；下期若要加固，先剥注释再匹配（或改 AST）。
29. **内置浏览器控制器的七个入口没有逐入口行为单测**：`browser-navigation.test.ts` 证明闸门本身、A7 证明控制器还在调用它；但「某个入口漏传或传错 URL」目前只能靠代码审查兜底。下期补地址栏 / 页内导航 / 重定向 / 弹窗 / 右键 / favicon / 会话恢复各自的入口级测试。


### 5. C 轨复审轮（#109 收口，2026-10-23）

Task 14–19（C2–C5）在台账里都已记「交付」，四把配色锁与 `palette:*` 两条门也都是绿的，
但 #109 一直没被翻成 completed。本轮**不凭台账的字翻勾**，按 Phase C 的判据（「每一个还在给屏幕
着色的 `--rb-*` / `--md-*` 都要能从猫色板派生」）回到树上复审，扫出一类**四把锁都看不见的坏**：
规则里的 `var(--rb-*)` 指向一个**从来没被声明过**的令牌。浏览器在 computed-value 阶段把整条声明
丢掉——边框不存在、背景不存在、字体退回继承——而没有一盏红灯。与 A-1「派生锁对 `var()` 间接层
开天窗」同一类：**尺子照不到的地方，就是坏改动能藏身的地方**。

**5.1 实际改了计划的地方**

| 项 | 实际 | 为什么计划没覆盖 |
| --- | --- | --- |
| 五处悬空着色引用 | `modal.css:48` / `:54`、`ChannelsSettingsPanel.css:66` / `:127`、`MailDraftCard.css:7` 改指到**已在两档主题里声明**的令牌（`--rb-text-title` / `--rb-text-body` / `--rb-border-default` / `--rb-surface-elevated`） | 计划与台账把「引用一个不存在的令牌」判成**迁移没引入**的既有缺口（R-19-1 点了名，但裁决停在「不是品牌色残留」），没有把它当**屏幕缺陷**处理 |
| 新增常驻锁 | `src/renderer/ui/color-token-resolution.test.ts`：着色族（`--rb-*` / `--md-*` / `--cy-*`）的每一条 `var()` 引用，必须能解析到 ①任一 CSS 文件里声明过的令牌 ②运行时注入的令牌（TSX 内联样式 `"--name":` / `setProperty("--name", …)`）③**终止于字面量**的兜底链 | 四把既有锁各有射程：派生锁只看主题级声明、品牌色锁只看字面量、棘轮只数带色行数、派生表锁只管表结构——**没有一把问「这个令牌到底存不存在」** |

**5.2 被实测推翻的地方**

| 原结论 | 实测 | 推翻它的输出 |
| --- | --- | --- |
| 「这五个坏令牌是配色迁移带进来的回归」 | `git log --all -S` 下 `--rb-text-em:` / `--rb-text:` / `--rb-border:` / `--rb-surface-raised:` / `--rb-surface-default:` 的**历史提交数都是 0**——它们**从来没被声明过**，是**上游遗留缺陷** | 五条 `git log --all -S` 全空 |
| 「R-19-1 已经对过账，27 处悬空都是既有，不用再管」 | R-19-1 的**事实清单**是对的（它点了 `--rb-text-em` / `--rb-text` / `--rb-border` / `--rb-surface-default` 的名），缺的是下一步：**知道它存在之后，它有没有在伤屏幕**。查消费者发现其中三处都在活路径上——`ChannelsSettingsPanel` 挂在 `AppearanceSettingsPage.tsx:292`，`MailDraftCard` 在 `ChatMessageList.tsx:51` import、`:1169` 渲染 | 逐处查消费者 + 挂载点 |
| 「兜底链里有 fallback 就等于能落地」 | `var(--rb-surface-raised, var(--rb-surface-default))` 两个名字都没声明过——**兜底也悬空**，等于没有背景。兜底链必须递归解到字面量才算数 | 锁里兜底链递归 + 深度封顶 |
| 「两个弹窗声明是死代码，不影响屏幕」 | `src/renderer/ui/modal.ts` 的 `showModal` 确实**零消费者**、`modal.html` 是零引用开发片段——但 CSS 仍随包发布，而**标题/正文两条 `font` 声明在浏览器里就是失效的**。改成指向真实令牌后，将来谁接上 `showModal` 就是对的 | `showModal` 全仓零消费者；`modal.html` 在 `brand-consistency.test.ts:70` 的零引用白名单里 |

**5.3 明确移到下一期**

30. **新锁只管「有没有值」，不管「在当前作用域有没有值」**：某个令牌只在深色主题里声明、却被浅色
    主题的组件引用（Task 19 的 R-19-2 记过 `--cy-pill-bg/-border/-status` 只在深色档声明），新锁看不见
    ——那仍是派生锁的层叠职责。**两把锁互补，不互相顶替。**
31. **新锁的「运行时注入」判定是过近似**：TSX 内联样式以 `"--name":` 认作注入源，对象里恰好有个
    同名键也会被当成注入源。多算比少算安全——少算会把好代码误判成坏。
32. **新锁只覆盖着色族**（`--rb-*` / `--md-*` / `--cy-*`）：非着色族令牌（`--top-height`、`--radix-*`、
    `--size` 等）仍有可能是悬空的，本期不扩射程。
