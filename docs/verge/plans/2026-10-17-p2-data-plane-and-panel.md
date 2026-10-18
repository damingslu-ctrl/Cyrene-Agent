# P2 数据面 + 面板 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to execute this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 fork 侧的像素猫读到真实的 mihomo 运行数据，并长出 248×482 的配置面板（概览 / 节点 / 订阅 / 播报四页），全程只读、不发任何写操作。

**Architecture:** 数据面集中在 `src/main/verge/`：`verge-config` 从 Clash Verge 的运行目录只读解析控制器地址与 secret，`mihomo-client` 打 REST 接口（含两个流式接口的「只取首帧」处理），`node-view` 是把 `/proxies` 一份 payload 喂满节点页的纯函数层，采样循环只在数据变化时向渲染端外发。面板是独立小窗（248×482，透明、不可聚焦拖拽），锚定在订阅宠物窗 bounds 的广播上，按音乐窗的九步配方接进组合根。

**Tech Stack:** TypeScript / Electron 44（`net.fetch`、`AbortController`）/ React 19 + canvas 混排（面板正文 React，曲线与微历史条走 canvas 指令层）/ `js-yaml`（读 YAML）/ vitest 5。

**Spec:** [docs/verge/specs/2026-10-17-clash-verge-pet-merge-design.md](../specs/2026-10-17-clash-verge-pet-merge-design.md) §6.4（数据面）、§6.3（窗口层：面板 = 独立小窗）、§6.2（形象层）、§6.8（验收三层）

**前置：** [P0+P1 计划](./2026-10-17-p0-p1-pixel-cat-shell.md) 的退出条件核对表必须全绿。P2 站在 `pet-geometry`、`ops`/`tokens`、`verge-store`、`verge-service` 之上，那四个文件是 P2 的输入接口。

**移植源（只读）：** `D:\Test\workbuddy\clash verge\native\src\clash_state.rs`（2126 行，数据面全部判据的出处）、`panel.rs`（3942 行，面板布局与文案）、`main.rs`（面板收起闸门 `panel_idle_tick:3561`、`PANEL_IDLE_SECS:1923`）。

## Global Constraints

- **只读**：P2 不得对 mihomo 发 `PUT`/`POST`（含 `/proxies/{组}`、`/configs`），也不得发 `GET /group/{组}/delay`——它虽是 GET，却驱动内核对着节点出站实测，一样改变用户看到的世界。`fetch` 封装层从签名上就拿不到 method：这是 native 侧「不擅自 PUT 猜回用户出口节点」那条红线的编译期形态，写操作在 P3 经唯一执行入口一起开出。
- 验收器**永不点击**：节点行、「选择最优」、「立即实测」、「复制链接」、模式药丸一律不点（native 侧 #70 的误点事故换来的闸门）。只许点页签格，且每颗点击前重新截图、现量格号。控件的惰性用签名 + 源码 grep + 访问日志证明。
- 上游文件改动 ≤ 5 处（spec §6.1）：`window-manager`、`window-state`、`preload/index.ts`、`default-dependencies.ts`、`core-bootstrap.ts`。面板的新窗口工厂、页面、通道一律新目录增量。
- `ipc-contract.test.ts` 必须绿：新通道三方一致（preload invoke→handle / send→on / listen→外发），注册点从 `src/main/index.ts` 可达，不留白名单。
- 提交格式 `type(scope): 中文描述`。
- 单位与时延照抄 native：一次性接口总预算 `2500ms`、`/traffic` 首帧预算 `1200ms`、连接超时 `800ms`、轮询节奏 `1.5s`、订阅画像刷新 `600s`、`KERNEL_HIST = 10`。
- 面板底**必须不透明**（`#101420`）：native 实测桌布自己在动，留 1.6% 通透会让按字节哈希的验收器把静止格子读成「一直在变」（`panel.rs:44-52` 的教训）。
- 屏幕层只认盘里的变化；负判据必须配正对照；尺自己崩了不许读成 PASS；环境不合格 `exit ENV` 并点名压屏窗口。
- 本机不在 Administrators，缓存与产物一律放 `D:`。

---

## P1 收口移交项（P2 起手必办，出处：`.superpowers/sdd/2026-10-17-p0-p1-pixel-cat-shell/progress.md`）

1. **`resolveGrowthDirection` 必须被真消费**（`src/shared/pet-geometry.ts`，P1 复审 N-5）。P1 里 `renderer.ts` 的 `growLeft/growUp` 恒 `false`，面板不存在，所以这个纯函数只有「对 fake 的单测证据」。P2 的面板展开动画是它的第一个生产调用方——**接不上就说明 P1 的几何面写错了，先回来修，别绕过去自己算方向**。
2. **改藏身常量前先加 `edgePeekTarget()`**（P1 复审 N-4）。`TUCK_PEEK_PX=40 < EDGE_NEAR_PX=60` 让 native `main.rs:4934-4935` 的「只看基准位不含 peek」反抖纪律在当前档常量下**结构上不可观察**（变异测试证明为惰性）。一旦 P2 把 peek 提到 ≥60 或把 EDGE_NEAR 降到 <40，把 peek 算进 gap 立刻变成真缺陷（猫在边缘来回抖）且仍无测试盯住。P2 若气泡展开（`be`）与藏身共存，这条尤其相关。
3. **`--tuck-probe` 缺一次性贴边落位**（P1 复审 N-6）。fork 只搬了阈值 2.5s（`main.rs:5648`），没搬 `:4912-4916`「探针开机一次性把猫贴到工作区右缘」；且 `create-pet-window.ts` 在无保存点时把猫放**主屏居中**。所以任何靠探针看藏身的验收，都得先把猫真拖到右缘，否则会误判成「藏身不生效」。P2 的探针层要么补这次性落位，要么在脚本里显式拖。
4. **跨侧 import 的债**（P1 复审偏离 ④）：`src/renderer/pet/renderer.ts` 现在 import `src/main/verge/tuck-clock.ts`（纯函数放 main 侧是 P1 计划钉死的）。P2 若继续往 `main/verge` 放**运行期被渲染端消费**的纯函数，先裁决「挪进 `src/shared/pet-tuck.ts`」，不要累积第二处。
5. **`src/main/index.ts` 不在任何 tsc program 里**（P1 Task 10 复审 F-7，计划级缺口）：它参与的改动只能靠 vitest 扫描器与运行时暴露。P2 动组合根前先补一次「`tsconfig.main.json` 的 include 覆盖 `src/main/index.ts`」的裁决。
6. **上游文件额度重述**：P1 退出表的「上游 ≤5 处」按勘误 3/9 的口径记账——分支累计（`8d905897..6dd72bea`）上游面已 8 个文件，全部落在 spec §6.1 的白名单内。P2 的「≤5 处」预算是**新增**的，不是累计的。

---

## 文件结构

| 路径 | 动作 | 责任 |
| --- | --- | --- |
| `src/main/verge/verge-config.ts` | 新建 | 配置根发现、`verge.yaml`/`clash-verge.yaml` 只读解析、控制器探活、人话诊断 |
| `src/main/verge/mihomo-client.ts` | 新建 | REST 客户端：GET + Bearer + 每接口超时预算 + 流式接口只取首帧 |
| `src/main/verge/node-view.ts` | 新建 | `/proxies` → 组/成员/延迟/健康度/排序/分页的纯函数层 |
| `src/main/verge/sampler.ts` | 新建 | 采样循环：`AbortController` + 缓存 + 变化才外发 + `dispose` |
| `src/main/verge/verge-service.ts` | 修改 | 挂上 sampler，暴露快照与订阅 |
| `src/main/verge/verge-ipc.ts` | 修改 | `VERGE_GET_SNAPSHOT` 扩为真数据 + `VERGE_PROXIES` + 外发 `VERGE_DATA_PUSH` |
| `src/renderer/pet/panel/*.tsx` | 新建 | 面板四页 React 组件 |
| `src/renderer/pet/panel/index.html`、`main.tsx` | 新建 | 面板页入口 |
| `src/main/windows/create-verge-panel-window.ts` | 新建 | 248×482 透明小窗工厂 |
| `src/main/windows/window-state.ts` | 修改 | 面板窗句柄 + closed 清理 |
| `src/shared/pet-geometry.ts` | 修改 | 面板锚定（复用 `computePetLayout` 的 panel 档）与页签格坐标常量 |
| `src/shared/ipc-channels.ts` | 修改 | `VERGE_*` 通道 |
| `src/preload/index.ts` | 修改 | `window.verge` 白名单扩容 |
| `vite.config.mts` | 修改 | `rolldownOptions.input` 加 `verge-panel` |

---

## Task 1: `verge-config` — 从 Verge 运行目录读出控制器

**Files:**
- Create: `src/main/verge/verge-config.ts`、`verge-config.test.ts`
- Create: `src/main/verge/__fixtures__/clash-verge.yaml`、`verge.yaml`

**Interfaces:**
- Consumes: `js-yaml`（`package.json:160`，本机锁到的实际大版本与导出形态要在 Step 1 确认）。**只用安全 loader**：`load` + 默认 schema，不注册自定义 type，不碰 `unsafeLoad`（详见 Step 1/Step 4）。
- Produces:
  - `const VERGE_APP_DIR_NAME = "io.github.clash-verge-rev.clash-verge-rev"`
  - `discoverConfigRoot(input: { configDir?: string; dataLocalDir?: string; useCache?: boolean }): { root: string | null; reason: string }`
  - `readYamlFile(filePath: string, fallback?: CoreConfigLike): CoreConfigLike` —— `CoreConfigLike = { [key: string]: unknown }`；返回**原型为 null 的普通对象**；文件缺失/非映射返回 fallback，坏语法与自定义标签抛带 `——` 的错误
  - `const MAX_YAML_BYTES = 262_144`
  - `normalizeBaseUrl(raw: string): string`
  - `resolveController(core: CoreConfigLike): ControllerInfo`
  - `humanize(raw: string): string`、`splitReason(s: string): SplitReason`
  - `COLD_NO_CONTROLLER`（逐字照抄 `clash_state.rs:406`）
  - `type ControllerInfo = { available: boolean; baseUrl: string; secret: string; reason: string }`

- [ ] **Step 1: 确认 `js-yaml` 的导入形态与安全边界**

```bash
pnpm ls js-yaml
node -e "const y=require('js-yaml'); console.log(typeof y.load, require('js-yaml/package.json').version)"
node -e "const y=require('js-yaml'); console.log('unsafeLoad:', typeof y.unsafeLoad, 'DEFAULT_SCHEMA:', typeof y.DEFAULT_SCHEMA)"
node -e "const y=require('js-yaml'); try{ y.load('a: !!JS/custom []'); console.log('TAG ACCEPTED -> 不安全'); }catch(e){ console.log('custom tag rejected:', e.name) }"
node -e "const y=require('js-yaml'); const o=y.load('__proto__:\n  polluted: yes\nok: 1'); console.log('polluted=', ({}).polluted, 'ownKeys=', Object.keys(o))"
```

Expected:
1. 打出实际版本号与 `function`。据此决定写 `import { load as loadYaml } from "js-yaml"` 还是 `import yaml from "js-yaml"; yaml.load(...)`；两种都能过 TS，但 fork 里只允许出现一种写法（后面所有 YAML 读取都跟着它）。
2. **`unsafeLoad` 若存在则一律不用**；`DEFAULT_SCHEMA` 若可用就在调用点显式传入（不依赖默认值）。
3. 第四条必须打出 `custom tag rejected`（或 `unknown tag`）。**若打出 `TAG ACCEPTED`，说明这个版本的 `load` 会按标签构造对象，本任务改用仓库里已有的 `yaml` 包（`package.json:180`，`yaml.parse` 不构造自定义类型），并把选定结论记进 spike 小节。**
4. 第五条的 `polluted=` 必须是 `undefined`。这决定 Step 4 是否必须做「重建为 null 原型对象」那一步——不管结果如何，实现都照做，只是把这条实测结果记下来。

把以上四条的实测输出记进 `docs/verge/spikes/p1-window.md` 的「YAML 读取」小节。

- [ ] **Step 2: 写失败的测试（fixture 驱动，不碰真实用户目录）**

```ts
// src/main/verge/verge-config.test.ts
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  COLD_NO_CONTROLLER, MAX_YAML_BYTES, discoverConfigRoot, humanize, normalizeBaseUrl, readYamlFile, resolveController, splitReason,
} from "./verge-config";

const dirs: string[] = [];
function tmpDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "verge-root-"));
  dirs.push(dir);
  return dir;
}
function fakeRoot(files: Record<string, string>): string {
  const dir = tmpDir();
  const root = path.join(dir, "io.github.clash-verge-rev.clash-verge-rev");
  require("node:fs").mkdirSync(root, { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(path.join(root, name), body, "utf8");
  return dir;
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("normalizeBaseUrl", () => {
  it("三种写法收敛成同一个 http://host:port（native 的三种分支）", () => {
    expect(normalizeBaseUrl(":9097")).toBe("http://127.0.0.1:9097");
    expect(normalizeBaseUrl("127.0.0.1:9097")).toBe("http://127.0.0.1:9097");
    expect(normalizeBaseUrl("http://127.0.0.1:9097/")).toBe("http://127.0.0.1:9097");
  });
});

describe("discoverConfigRoot", () => {
  // cachedRoot 是模块级全局：除专门测缓存的两条，其余一律 useCache: false，
  // 否则前一条正向测试会把 root 缓存下来，让后面的「找不到」断言因别人的缓存而假绿。
  it("Roaming 配置目录下有 Verge 目录就用它", () => {
    const dir = fakeRoot({});
    expect(discoverConfigRoot({ configDir: dir, useCache: false }).root).toContain("io.github.clash-verge-rev");
  });

  it("正对照：两处都没有时给出可行动作而不是空路径", () => {
    const result = discoverConfigRoot({ configDir: "Q:/nope", dataLocalDir: "Q:/nope2", useCache: false });
    expect(result.root).toBeNull();
    expect(result.reason).toContain("先打开一次 Clash Verge");
  });

  it("LocalAppData 兜底分支可用（便携安装模式）", () => {
    const dir = fakeRoot({});
    expect(discoverConfigRoot({ configDir: "Q:/nope", dataLocalDir: dir, useCache: false }).root).toContain("io.github.clash-verge-rev");
  });

  it("成功才缓存：找不到时不留负缓存，装好 Verge 后下一轮自己就好", () => {
    invalidateConfigRoot();
    expect(discoverConfigRoot({ configDir: "Q:/nope" }).root).toBeNull();
    const dir = fakeRoot({});
    // 同一次调用不带 useCache：上一步没缓存成功结果，所以这一步必须真的去磁盘找
    expect(discoverConfigRoot({ configDir: dir }).root).toContain("io.github.clash-verge-rev");
    // 这一步即使把 configDir 换成不存在的路径也仍返回缓存 —— 证明「成功才缓存」生效
    rmSync(path.join(dir, "io.github.clash-verge-rev"), { recursive: true, force: true });
    expect(discoverConfigRoot({ configDir: "Q:/nope" }).root).toContain("io.github.clash-verge-rev");
    invalidateConfigRoot();
    expect(discoverConfigRoot({ configDir: "Q:/nope" }).root).toBeNull();
  });
});

describe("resolveController", () => {
  it("external-controller 缺失 → 给出 COLD_NO_CONTROLLER 原文（气泡只演 —— 前的诊断）", () => {
    const info = resolveController({});
    expect(info.available).toBe(false);
    expect(info.reason).toBe(COLD_NO_CONTROLLER);
  });

  it("有地址无 secret 时 secret 为空串（接口仍可用，不该判成不可用）", () => {
    expect(resolveController({ "external-controller": ":9097" })).toMatchObject({
      available: true, baseUrl: "http://127.0.0.1:9097", secret: "",
    });
  });
});

describe("人话诊断", () => {
  it("一句话被 —— 切成诊断与动作两段", () => {
    const parts = splitReason("连不上 —— 打开 Clash Verge 再试一次");
    expect(parts.head).toBe("连不上");
    expect(parts.action).toBe("打开 Clash Verge 再试一次");
  });

  it("Windows socket 错误号各自对应一条人话（判据取自传输层字面量）", () => {
    expect(humanize("Connection refused: os error 10061")).toContain("没开外部接口");
    expect(humanize("TimedOut: os error 10060")).toContain("超时");
    expect(humanize("Failed to lookup: os error 11001")).toContain("解析不到");
  });

  it("正对照：空串走默认那句，不许抛", () => {
    expect(humanize("")).toBe("状态读不出来 —— 打开 Clash Verge 再试一次");
  });
});

describe("readYamlFile 的安全边界", () => {
  // 这些文件不是我们自己写的：Clash Verge 的目录用户可编辑，别的进程也能写。
  function yamlFile(body: string): string {
    const file = path.join(tmpDir(), "clash-verge.yaml");
    writeFileSync(file, body, "utf8");
    return file;
  }

  it("读得到就给出键值（正常路径 = 后面上面所有测试的正对照）", () => {
    const core = readYamlFile(yamlFile('external-controller: ":9097"\nsecret: "abc"\n'), {});
    expect(resolveController(core)).toMatchObject({ available: true, baseUrl: "http://127.0.0.1:9097", secret: "abc" });
  });

  it("文件不存在返回 fallback，不抛（首次启动时 clash-verge.yaml 就是没有）", () => {
    expect(readYamlFile(path.join(tmpDir(), "nope.yaml"), { hit: 1 })).toEqual({ hit: 1 });
  });

  it("自定义标签构造不出对象：带 !! 标签的文档当场失败，错误能被 —— 切开", () => {
    let err = "";
    try {
      readYamlFile(yamlFile("a: !!JS/custom whatever\n"), {});
    } catch (error) {
      err = String(error);
    }
    expect(err).not.toBe("");
    expect(splitReason(err.replace(/^Error:\s*/, "")).head.length).toBeGreaterThan(0);
  });

  it("__proto__ 键只是数据：Object.prototype 不许被污染", () => {
    const polluted = (globalThis as { __pollutedHere?: unknown }).__pollutedHere;
    const core = readYamlFile(yamlFile("__proto__:\n  __pollutedHere: yes\nok: 1\n"), {});
    expect(({} as Record<string, unknown>).__pollutedHere).toBeUndefined();
    expect((globalThis as { __pollutedHere?: unknown }).__pollutedHere).toBe(polluted);
    // 重建后的对象原型为 null：`toString` 这类继承来的键一律不存在
    expect(Object.getPrototypeOf(core)).toBeNull();
  });

  it("超大文件直接拒（锚点/别名放大不是我们的威胁模型，但要有上界）", () => {
    const huge = yamlFile(`big: "${"x".repeat(MAX_YAML_BYTES + 10)}"\n`);
    expect(() => readYamlFile(huge, {})).toThrow();
  });

  it("文档不是映射（纯标量/序列）时按空映射处理，不抛", () => {
    expect(readYamlFile(yamlFile("- a\n- b\n"), { fallback: true })).toEqual({ fallback: true });
    expect(readYamlFile(yamlFile("just a string\n"), { fallback: true })).toEqual({ fallback: true });
  });
});
```

- [ ] **Step 3: 跑到红**

```bash
pnpm vitest run src/main/verge/verge-config.test.ts
```

Expected: FAIL（模块不存在）。

- [ ] **Step 4: 实现**

```ts
// src/main/verge/verge-config.ts
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { DEFAULT_SCHEMA, load as loadYaml } from "js-yaml";

export const VERGE_APP_DIR_NAME = "io.github.clash-verge-rev.clash-verge-rev";

/** 只读这两个文件，它们由 Verge 自己写；上界是给坏文件与放大攻击的，不是给正常路径的。 */
export const MAX_YAML_BYTES = 262_144;

/** 「内核没开外部接口」的开场白：气泡只演 `——` 前，面板卡片演完整一句。 */
export const COLD_NO_CONTROLLER =
  "Clash Verge 没开外部接口 —— 在「设置 → 控制」里打开外部控制器（填 127.0.0.1:9097），重启内核后我就能读实时数据";

export interface ConfigRootResult { root: string | null; reason: string }

/**
 * 只缓存**成功**结果：失败不缓存，这样「用户装好 Clash Verge 后桌宠自己开始出数据」成立。
 * （native `clash_state.rs:22-32` 同一条理由。）
 */
let cachedRoot: string | null = null;

export function discoverConfigRoot(input: {
  configDir?: string;
  dataLocalDir?: string;
  useCache?: boolean;
}): ConfigRootResult {
  if (input.useCache !== false && cachedRoot) return { root: cachedRoot, reason: "" };
  const candidates = [input.configDir, input.dataLocalDir]
    .filter((dir): dir is string => typeof dir === "string" && dir.length > 0)
    .map((dir) => path.join(dir, VERGE_APP_DIR_NAME));
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found) {
    cachedRoot = found;
    return { root: found, reason: "" };
  }
  return {
    root: null,
    reason: `没找到 Clash Verge 的配置 —— 先打开一次 Clash Verge，让它把配置生成出来（${candidates[0] ?? VERGE_APP_DIR_NAME}）`,
  };
}

export function invalidateConfigRoot(): void { cachedRoot = null; }

export type CoreConfigLike = Record<string, unknown>;

export function normalizeBaseUrl(raw: string): string {
  const withScheme = raw.startsWith("http://") || raw.startsWith("https://")
    ? raw
    : raw.startsWith(":")
      ? `http://127.0.0.1:${raw.slice(1)}`
      : `http://${raw}`;
  return withScheme.replace(/\/+$/, "");
}

export interface ControllerInfo {
  available: boolean;
  baseUrl: string;
  secret: string;
  reason: string;
}

export function resolveController(core: CoreConfigLike): ControllerInfo {
  const raw = typeof core["external-controller"] === "string" ? core["external-controller"] as string : "";
  const secret = typeof core.secret === "string" ? core.secret : "";
  if (!raw) return { available: false, baseUrl: "", secret: "", reason: COLD_NO_CONTROLLER };
  return { available: true, baseUrl: normalizeBaseUrl(raw), secret, reason: "" };
}

export interface SplitReason { head: string; action: string }

/** `——` 是诊断与动作的唯一分界；原始报错一律收进**末尾括号**，它永远进不了气泡。 */
export function splitReason(s: string): SplitReason {
  const at = s.indexOf("——");
  if (at < 0) return { head: s.trim(), action: "" };
  return { head: s.slice(0, at).trim(), action: s.slice(at + 2).trim() };
}

export function humanize(raw: string): string {
  if (!raw) return "状态读不出来 —— 打开 Clash Verge 再试一次";
  const low = raw.toLowerCase();
  // 判据取自传输层字面量：10061 拒绝、10060 超时、11001 解析不到、10054 被切断。
  if (low.includes("10061") || low.includes("connection refused")) {
    return "没开外部接口 —— 在「设置 → 控制」里把它打开后重启内核";
  }
  if (low.includes("10060") || low.includes("timed out") || low.includes("timeout")) {
    return "内核响应超时 —— 它可能正在重启，过一会儿再看";
  }
  if (low.includes("11001") || low.includes("could not resolve") || low.includes("dns")) {
    return "地址解析不到 —— 检查外部控制器填的是 127.0.0.1";
  }
  if (low.includes("10054") || low.includes("connection reset")) {
    return "连接被切断 —— 内核刚重启，下一轮会自动接上";
  }
  if (low.includes("401") || low.includes("unauthorized")) {
    return "密钥不对 —— Verge 改了 secret，重启我就重新读一次";
  }
  return `读不到内核 —— 打开 Clash Verge 再试一次（${raw}）`;
}

export function readYamlFile(filePath: string, fallback: CoreConfigLike = {}): CoreConfigLike {
  if (!existsSync(filePath)) return fallback;
  let text: string;
  try {
    // 上界先于解析：这两个文件我们自己不写，只读；放大攻击不该靠 loader 兜。
    if (statSync(filePath).size > MAX_YAML_BYTES) {
      throw new Error(`配置文件超过 ${MAX_YAML_BYTES} 字节`);
    }
    text = readFileSync(filePath, "utf8");
  } catch (error) {
    throw new Error(`配置读不出来 —— 重新打开 Clash Verge 让它重写（${String(error)}）`);
  }
  let parsed: unknown;
  try {
    // 安全 loader：js-yaml 4+ 的 `load` 默认 schema 只构造标量/映射/序列，`unsafeLoad` 才会按
    // 标签构造任意对象。fork 里禁用后者、禁止 addType；Step 1 第 3 条实测若打出 TAG ACCEPTED，
    // 整段改用 `yaml` 包的 `parse`（package.json:180），下游三个函数签名不变。
    parsed = loadYaml(text, { schema: DEFAULT_SCHEMA });
  } catch (error) {
    // 自定义标签、坏语法都落这里：报错必须带 ——，splitReason 才切得开、面板才演得下。
    throw new Error(`配置读不出来 —— 重新打开 Clash Verge 让它重写（${String(error)}）`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return fallback;
  return rebuildPlain(parsed as Record<string, unknown>);
}

/**
 * 重建为原型 null 的普通对象：loader 就算把 `__proto__` 当成赋值处理，攻击面也止于这个
 * 临时对象，进不了进程里任何真实原型链。解析出来的值只允许标量 / 数组 / 映射三种。
 */
function rebuildPlain(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = Object.create(null);
  for (const key of Object.getOwnPropertyNames(value)) {
    const raw = (value as Record<string, unknown>)[key];
    if (raw === null || typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
      out[key] = raw;
    } else if (Array.isArray(raw)) {
      out[key] = raw.map((item) =>
        item !== null && typeof item === "object" && !Array.isArray(item)
          ? rebuildPlain(item as Record<string, unknown>)
          : item,
      );
    } else if (typeof raw === "object") {
      out[key] = rebuildPlain(raw as Record<string, unknown>);
    }
    // 函数 / symbol / bigint 一律丢弃：配置里没有它们的位置。
  }
  return out;
}
```

- [ ] **Step 5: 跑到绿 + Commit**

```bash
pnpm vitest run src/main/verge/verge-config.test.ts
git add src/main/verge/verge-config.ts src/main/verge/verge-config.test.ts
git commit -m "feat(verge): 从 Verge 运行目录解析内核控制器"
```

---

## Task 2: `mihomo-client` — 只读 REST，含两个流式接口

**Files:**
- Create: `src/main/verge/mihomo-client.ts`、`mihomo-client.test.ts`

**Interfaces:**
- Consumes: `ControllerInfo`、`humanize`、Electron `net.fetch`
- Produces:
  - `const QUICK_MS = 2500`、`TRAFFIC_FIRST_FRAME_MS = 1200`、`CONNECT_TIMEOUT_MS = 800`
  - `type Fetcher = (url: string, init: RequestInit) => Promise<Response>`
  - `createMihomoClient(input: { controller: () => ControllerInfo; fetcher?: Fetcher }): MihomoClient`
  - `MihomoClient = { version(); configsMode(); proxies(); traffic(); memory(); connections() }` —— **全部无 method 参数，且没有 `nodeHealth(name)`**：native 在 `clash_state.rs:870` 明确删掉了那趟 `/proxies/{节点}`，健康度与微历史条就地从同一份 `/proxies` payload 算（Task 3 的 `parseProxies` → `leaves: Map<name, KernelDelay>` + `stability(...)`）
  - `type TrafficFrame = { up: number; down: number; upTotal: number; downTotal: number }`
  - `type CoreSnapshotFrame = { connections: number; proxy: number; direct: number; reject: number; memory: number | null }`
  - `firstJsonFrame(text: string): unknown | null`（纯函数，newline-delimited JSON 只取首帧）

- [ ] **Step 1: 写失败的测试（流式首帧与连接分类是这一层的两个真坑）**

```ts
// src/main/verge/mihomo-client.test.ts
import { describe, expect, it, vi } from "vitest";
import { classifyConnections, createMihomoClient, firstJsonFrame, withAuth } from "./mihomo-client";

describe("firstJsonFrame", () => {
  it("多帧连在一起只取第一帧（旧实现 into_json 把流当单文档，流量永远读成 --）", () => {
    expect(firstJsonFrame('{"up":1,"down":2}\n{"up":3,"down":4}\n')).toEqual({ up: 1, down: 2 });
  });
  it("首帧没有尾随换行也要能解出来", () => {
    expect(firstJsonFrame('{"up":9}')).toEqual({ up: 9 });
  });
  it("正对照：空响应给 null，不抛（下一轮再试，别把一次空帧当故障）", () => {
    expect(firstJsonFrame("")).toBeNull();
  });
});

describe("withAuth", () => {
  it("secret 为空时不发 Authorization 头（很多本地内核就没设 secret）", () => {
    expect(withAuth("", {})).toEqual({});
  });
  it("有 secret 时是 Bearer", () => {
    expect(withAuth("s3cr3t", {}).headers).toEqual({ Authorization: "Bearer s3cr3t" });
  });
});

describe("classifyConnections", () => {
  it("chains[0] 决定去向；PASS 算直连，REJECT* 算拦截，缺失只进总数不猜", () => {
    const val = { connections: [
      { chains: ["🚀 节点选择"] },
      { chains: ["DIRECT"] },
      { chains: ["PASS"] },
      { chains: ["REJECT-DROP"] },
      { chains: [] },
    ] };
    expect(classifyConnections(val)).toEqual({ connections: 5, proxy: 1, direct: 2, reject: 1 });
  });
  it("字段缺失或不是数组算「一条都没有」，不当解析失败（没连接本来就是最常见的事实）", () => {
    expect(classifyConnections({})).toEqual({ connections: 0, proxy: 0, direct: 0, reject: 0 });
  });
});

describe("createMihomoClient 的只读约束", () => {
  it("每个请求都不带 method（客户端压根没有写路径）", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetcher = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ proxies: {} }), { status: 200 });
    });
    const client = createMihomoClient({
      controller: () => ({ available: true, baseUrl: "http://127.0.0.1:9097", secret: "", reason: "" }),
      fetcher: fetcher as never,
    });
    await client.proxies();
    await client.configsMode();
    expect(calls.every((call) => call.init.method === undefined)).toBe(true);
    expect(calls.map((call) => call.url)).toEqual([
      "http://127.0.0.1:9097/proxies",
      "http://127.0.0.1:9097/configs",
    ]);
  });

  it("控制器不可用时不调网络，直接带回人话诊断", async () => {
    const fetcher = vi.fn();
    const client = createMihomoClient({
      controller: () => ({ available: false, baseUrl: "", secret: "", reason: "没开外部接口 —— 打开设置" }),
      fetcher: fetcher as never,
    });
    await expect(client.traffic()).rejects.toThrow("没开外部接口");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("客户端只有六个 GET 方法，没有 nodeHealth —— 健康度就地从同一份 /proxies 算", () => {
    const client = createMihomoClient({
      controller: () => ({ available: true, baseUrl: "http://127.0.0.1:9097", secret: "", reason: "" }),
      fetcher: vi.fn() as never,
    }) as Record<string, unknown>;
    expect(Object.keys(client).sort()).toEqual(
      ["configsMode", "connections", "memory", "proxies", "traffic", "version"].sort(),
    );
    // 负判据的正对照：nodeHealth 不存在不是因为键名拼错或对象为空
    expect(typeof client.proxies).toBe("function");
  });
});
```

- [ ] **Step 2: 跑到红** → Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

```ts
// src/main/verge/mihomo-client.ts
import { net } from "electron";
import type { ControllerInfo } from "./verge-config";

export const QUICK_MS = 2500;
export const TRAFFIC_FIRST_FRAME_MS = 1200;
export const CONNECT_TIMEOUT_MS = 800;

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export interface TrafficFrame { up: number; down: number; upTotal: number; downTotal: number }
export interface CoreSnapshotFrame {
  connections: number; proxy: number; direct: number; reject: number; memory: number | null;
}

export function withAuth(secret: string, init: RequestInit = {}): RequestInit {
  if (!secret) return init;
  return { ...init, headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${secret}` } };
}

/** newline-delimited JSON 只取首帧；空白与帧间换行一律忽略。 */
export function firstJsonFrame(text: string): unknown | null {
  const trimmed = text.trimStart();
  if (!trimmed) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{" || ch === "[") depth += 1;
    else if (ch === "}" || ch === "]") {
      depth -= 1;
      if (depth === 0) {
        try { return JSON.parse(trimmed.slice(0, i + 1)); } catch { return null; }
      }
    } else if (depth === 0 && /\s/.test(ch)) { /* 帧间空白 */ }
  }
  try { return JSON.parse(trimmed); } catch { return null; }
}

export function classifyConnections(val: unknown): { connections: number; proxy: number; direct: number; reject: number } {
  const arr = (val as { connections?: unknown })?.connections;
  if (!Array.isArray(arr)) return { connections: 0, proxy: 0, direct: 0, reject: 0 };
  let proxy = 0;
  let direct = 0;
  let reject = 0;
  for (const item of arr) {
    const chains = (item as { chains?: unknown })?.chains;
    const head = Array.isArray(chains) && typeof chains[0] === "string" ? chains[0] : "";
    if (head === "DIRECT" || head === "PASS") direct += 1;
    else if (head.startsWith("REJECT")) reject += 1;
    else if (head.length === 0) { /* 没给处置：只进总数，不猜 */ }
    else proxy += 1;
  }
  return { connections: arr.length, proxy, direct, reject };
}

export interface MihomoClient {
  version(): Promise<string>;
  configsMode(): Promise<string>;
  proxies(): Promise<Record<string, unknown>>;
  traffic(): Promise<TrafficFrame>;
  memory(): Promise<number>;
  connections(): Promise<CoreSnapshotFrame>;
}

export function createMihomoClient(input: { controller: () => ControllerInfo; fetcher?: Fetcher }): MihomoClient {
  const fetcher: Fetcher = input.fetcher ?? ((url, init) => net.fetch(url, init));

  async function get(pathname: string, budgetMs: number, opts: { text?: boolean } = {}): Promise<unknown> {
    const controller = input.controller();
    if (!controller.available) throw new Error(controller.reason || "读不到内核 —— 打开 Clash Verge 再试一次");
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), budgetMs);
    try {
      const response = await fetcher(`${controller.baseUrl}${pathname}`, {
        ...withAuth(controller.secret),
        signal: abort.signal,
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const body = opts.text ? await response.text() : await response.json();
      return opts.text ? firstJsonFrame(body as string) : body;
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : String(error));
    } finally {
      clearTimeout(timer);
    }
  }

  const num = (val: unknown, key: string) => {
    const raw = (val as Record<string, unknown> | null)?.[key];
    return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
  };

  return {
    async version() {
      const val = await get("/version", QUICK_MS) as { version?: string };
      return val?.version ?? "";
    },
    // ⚠️ 运行模式必须读运行时 /configs：切过模式后 yaml 不一定同步，读 yaml 会让面板高亮停在旧值。
    async configsMode() {
      const val = await get("/configs", QUICK_MS) as { mode?: string };
      return typeof val?.mode === "string" ? val.mode : "";
    },
    async proxies() {
      const val = await get("/proxies", QUICK_MS) as Record<string, unknown>;
      return val ?? {};
    },
    async traffic() {
      const frame = await get("/traffic", TRAFFIC_FIRST_FRAME_MS, { text: true }) as Record<string, unknown> | null;
      if (!frame) throw new Error("traffic 接口未返回任何数据帧 —— 等下一轮");
      return { up: num(frame, "up"), down: num(frame, "down"), upTotal: num(frame, "upTotal"), downTotal: num(frame, "downTotal") };
    },
    async memory() {
      const frame = await get("/memory", TRAFFIC_FIRST_FRAME_MS, { text: true }) as Record<string, unknown> | null;
      return frame ? num(frame, "inuse") : 0;
    },
    async connections() {
      const val = await get("/connections", QUICK_MS);
      const counts = classifyConnections(val);
      const memory = (val as Record<string, unknown>)?.memory;
      return { ...counts, memory: typeof memory === "number" && memory > 0 ? memory : null };
    },
  };
}
```

- [ ] **Step 4: 跑到绿 + Commit**

```bash
pnpm vitest run src/main/verge/mihomo-client.test.ts
git add src/main/verge/mihomo-client.ts src/main/verge/mihomo-client.test.ts
git commit -m "feat(verge): 只读的 mihomo REST 客户端与流式首帧解析"
```

---

## Task 3: `node-view` — 一份 `/proxies` 喂满节点页

**Files:**
- Create: `src/main/verge/node-view.ts`、`node-view.test.ts`
- Create: `src/main/verge/__fixtures__/proxies.sample.json`

**Interfaces:**
- Consumes: `mihomo-client.proxies()` 的原始 payload
- Produces:
  - `const KERNEL_HIST = 10`、`const PAGE_ROWS = 7`
  - `isPseudoNode(name): boolean`
  - `parseProxies(val, nowSec): { groups: Map<string,string>; leaves: Map<string, KernelDelay> }`
  - `type KernelDelay = { ms: number | null; ageSec: number | null; hist: number[]; histLen: number }`
  - `type NodeHealth = { name: string; alive: boolean; lastMs: number | null; ageSec: number | null; baselineMs: number | null; sampleKey: string }`
  - `parseNodeHealth(name, val, nowSec): NodeHealth`
  - `memberNames(val, group): string[]`（**`all` 原样，含伪节点**）
  - `scopeDelays(members, leaves)`（成员全不在表里时退回全表）
  - `selectableGroups(val): string[]`（Selector + 有非伪成员，按成员数降序、同数按名字）
  - `resolvePrimaryGroup(groups): string | null`
  - `type SortMode = "fast" | "stable" | "name"`；`buildNodeRows(input): NodeRow[]`（行集 + 排序 + 分页）

- [ ] **Step 1: 写失败的测试（行集契约 #57 是这一层的验收主项）**

```ts
// src/main/verge/node-view.test.ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  KERNEL_HIST, PAGE_ROWS, buildNodeRows, isPseudoNode, memberNames, parseNodeHealth, parseProxies,
  resolvePrimaryGroup, selectableGroups,
} from "./node-view";

const val = JSON.parse(readFileSync(path.join(__dirname, "__fixtures__/proxies.sample.json"), "utf8"));
const now = 1_700_000_000;

describe("行集契约（#57）", () => {
  it("成员名单就是 `all` 原样，DIRECT 这类伪节点不消失", () => {
    expect(memberNames(val, "🚀 节点选择")).toEqual(["🇭🇰 1", "🇹🇼 2", "DIRECT", "REJECT"]);
  });

  it("两档数据源数出同一个行数：内核实测档不许比刚实测档少一行", () => {
    const rows = buildNodeRows({
      val, group: "🚀 节点选择", nowSec: now, sort: "fast", page: 0, pageRows: PAGE_ROWS, freshDelays: null,
    });
    const names = rows.rows.map((row) => row.name);
    expect(names).toEqual(["🇭🇰 1", "🇹🇼 2", "DIRECT", "REJECT"]);
  });

  it("正对照：伪节点保留但钉在同一层末尾，不抢排位", () => {
    const rows = buildNodeRows({ val, group: "🚀 节点选择", nowSec: now, sort: "fast", page: 0, pageRows: PAGE_ROWS, freshDelays: null });
    expect(rows.rows[0].name).toBe("🇭🇰 1");
    expect(rows.rows.at(-1)!.pseudo).toBe(true);
  });

  it("内核没测过的成员留一条空读数、显示「未测」，不许当 0ms 也不许漏掉", () => {
    const rows = buildNodeRows({ val, group: "只有没测的", nowSec: now, sort: "fast", page: 0, pageRows: PAGE_ROWS, freshDelays: null });
    expect(rows.rows[0]!.ms).toBeNull();
    expect(rows.rows[0]!.label).toBe("未测");
  });
});

describe("延迟与历史", () => {
  it("history 升序，末条最新；delay 0 是「没测通」不是「0ms 飞快」", () => {
    const { leaves } = parseProxies(val, now);
    const hk1 = leaves.get("🇭🇰 1")!;
    expect(hk1.ms).toBe(31);
    expect(hk1.hist).toHaveLength(KERNEL_HIST);
    expect(hk1.hist.filter((v) => v === 0).length).toBeGreaterThan(0);
  });

  it("读数可能几小时前：ageSec 必须算出来，报警的地方要先过新鲜度闸门", () => {
    const { leaves } = parseProxies(val, now);
    expect(leaves.get("🇹🇼 2")!.ageSec).toBeGreaterThan(3600);
  });

  it("健康度中位数区分「突然变慢」与「一直这么慢」", () => {
    const health = parseNodeHealth("🇭🇰 1", val.proxies["🇭🇰 1"], now);
    expect(health.baselineMs).toBeGreaterThan(0);
    expect(health.sampleKey).toBe("🇭🇰 1|2026-10-17T09:59:40Z");
  });
});

describe("可挑的组", () => {
  it("只收 Selector；URLTest / Fallback 不列（手选上去下一周期就被改回去，那是骗人）", () => {
    expect(selectableGroups(val)).toEqual(expect.arrayContaining(["🚀 节点选择"]));
    expect(selectableGroups(val)).not.toContain("♻️ 自动选择");
  });

  it("只有 DIRECT / REJECT 的组不进翻页器（挑不出东西的组不该列）", () => {
    expect(selectableGroups(val)).not.toContain("🛑 全球拦截");
  });

  it("同成员数必须有次级键，否则每轮组序跟着哈希序抖", () => {
    const first = selectableGroups(val);
    for (let i = 0; i < 5; i += 1) expect(selectableGroups(val)).toEqual(first);
  });

  it("主组按候选名单命中，兜底取名字里带「选择」且最长的", () => {
    expect(resolvePrimaryGroup(new Map([["🚀 节点选择", "x"], ["🐟 漏网之鱼", "y"]]))).toBe("🚀 节点选择");
    expect(resolvePrimaryGroup(new Map([["自定义选择", "x"], ["选择", "y"]]))).toBe("自定义选择");
  });
});

describe("分页", () => {
  it("7 行一页（嵌套 ScrollArea 报不出超过一个视口的高度，只能分页）", () => {
    const big = { proxies: { 大组: { now: "a", all: Array.from({ length: 20 }, (_, i) => `n${i}`) }, ...Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`n${i}`, { history: [{ delay: i + 1, time: "2026-10-17T09:59:40Z" }] }])) } };
    const page0 = buildNodeRows({ val: big, group: "大组", nowSec: now, sort: "name", page: 0, pageRows: PAGE_ROWS, freshDelays: null });
    expect(page0.rows).toHaveLength(7);
    expect(page0.pageCount).toBe(3);
    expect(page0.rows[0].name).toBe("n0");
  });
});
```

- [ ] **Step 2: 准备 fixture 并跑到红**

`src/main/verge/__fixtures__/proxies.sample.json`（手写，形态取自 native 注释里的本机实测：7 组里 5 组 Selector、每节点整整 10 条 history）：

```json
{
  "proxies": {
    "🚀 节点选择": { "type": "Selector", "now": "🇭🇰 1", "all": ["🇭🇰 1", "🇹🇼 2", "DIRECT", "REJECT"], "history": [] },
    "♻️ 自动选择": { "type": "URLTest", "now": "🇭🇰 1", "all": ["🇭🇰 1", "🇹🇼 2"], "history": [] },
    "🐟 漏网之鱼": { "type": "Fallback", "now": "DIRECT", "all": ["DIRECT"], "history": [] },
    "🛑 全球拦截": { "type": "Selector", "now": "REJECT", "all": ["REJECT-DROP", "REJECT"], "history": [] },
    "🎯 全球直连": { "type": "Selector", "now": "DIRECT", "all": ["DIRECT", "PASS", "COMPATIBLE"], "history": [] },
    "只有没测的": { "type": "Selector", "now": "🈳 没测", "all": ["🈳 没测"], "history": [] },
    "🇭🇰 1": {
      "type": "SS",
      "history": [
        { "time": "2026-10-17T09:58:00Z", "delay": 30 }, { "time": "2026-10-17T09:58:10Z", "delay": 0 },
        { "time": "2026-10-17T09:58:20Z", "delay": 29 }, { "time": "2026-10-17T09:58:30Z", "delay": 33 },
        { "time": "2026-10-17T09:58:40Z", "delay": 0 }, { "time": "2026-10-17T09:58:50Z", "delay": 32 },
        { "time": "2026-10-17T09:59:00Z", "delay": 28 }, { "time": "2026-10-17T09:59:10Z", "delay": 0 },
        { "time": "2026-10-17T09:59:20Z", "delay": 31 }, { "time": "2026-10-17T09:59:30Z", "delay": 30 },
        { "time": "2026-10-17T09:59:40Z", "delay": 31 }
      ]
    },
    "🇹🇼 2": {
      "type": "SS",
      "history": [
        { "time": "2026-10-16T09:00:00Z", "delay": 88 }, { "time": "2026-10-16T09:00:10Z", "delay": 90 },
        { "time": "2026-10-16T09:00:20Z", "delay": 91 }, { "time": "2026-10-16T09:00:30Z", "delay": 89 },
        { "time": "2026-10-16T09:00:40Z", "delay": 92 }, { "time": "2026-10-16T09:00:50Z", "delay": 0 },
        { "time": "2026-10-16T09:01:00Z", "delay": 87 }, { "time": "2026-10-16T09:01:10Z", "delay": 88 },
        { "time": "2026-10-16T09:01:20Z", "delay": 90 }, { "time": "2026-10-16T09:01:30Z", "delay": 89 },
        { "time": "2026-10-16T09:01:40Z", "delay": 93 }
      ]
    },
    "DIRECT": { "type": "Data", "history": [{ "time": "2026-10-17T09:00:00Z", "delay": 1 }] },
    "REJECT": { "type": "Data", "history": [] },
    "REJECT-DROP": { "type": "Data", "history": [] },
    "PASS": { "type": "Data", "history": [] },
    "COMPATIBLE": { "type": "Data", "history": [] },
    "🈳 没测": { "type": "SS", "history": [] }
  }
}
```

```bash
pnpm vitest run src/main/verge/node-view.test.ts
```

Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

```ts
// src/main/verge/node-view.ts
export const KERNEL_HIST = 10;
export const PAGE_ROWS = 7;

const PSEUDO_NODES = new Set(["DIRECT", "REJECT", "REJECT-DROP", "PASS", "COMPATIBLE"]);

export function isPseudoNode(name: string): boolean {
  return PSEUDO_NODES.has(name);
}

export interface KernelDelay {
  ms: number | null;
  ageSec: number | null;
  hist: number[];
  histLen: number;
}

export interface NodeRow {
  name: string;
  ms: number | null;
  ageSec: number | null;
  hist: number[];
  pseudo: boolean;
  label: string;
  selected: boolean;
}

export type SortMode = "fast" | "stable" | "name";

function rfc3339Epoch(s: string): number | null {
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : Math.floor(t / 1000);
}

function kernelDelay(samples: unknown[], nowSec: number): KernelDelay {
  const last = samples[samples.length - 1] as Record<string, unknown> | undefined;
  const take = Math.min(samples.length, KERNEL_HIST);
  const hist: number[] = [];
  for (const sample of samples.slice(samples.length - take)) {
    const delay = (sample as Record<string, unknown>)?.delay;
    hist.push(typeof delay === "number" && delay >= 0 ? Math.trunc(delay) : 0);
  }
  const lastDelay = typeof last?.delay === "number" ? Math.trunc(last.delay) : 0;
  const lastTime = typeof last?.time === "string" ? rfc3339Epoch(last.time) : null;
  return {
    ms: lastDelay > 0 ? lastDelay : null,
    ageSec: lastTime === null ? null : nowSec - lastTime,
    hist,
    histLen: take,
  };
}

export function parseProxies(
  val: unknown,
  nowSec: number,
): { groups: Map<string, string>; leaves: Map<string, KernelDelay> } {
  const proxies = (val as { proxies?: Record<string, Record<string, unknown>> })?.proxies ?? {};
  const groups = new Map<string, string>();
  const leaves = new Map<string, KernelDelay>();
  for (const [name, node] of Object.entries(proxies)) {
    if (typeof node.now === "string") {
      groups.set(name, node.now);
      // 有 `now` 的是组不是叶子节点。
      continue;
    }
    // ⚠️ 伪节点**也**进这张表：它是 `all` 的成员，内核也确实给了它读数。
    // 一刀切掉会让「内核实测」那一档比「刚实测」少一行，同一组节点在眼前自己变短（#57）。
    const history = node.history;
    if (!Array.isArray(history) || history.length === 0) continue;
    leaves.set(name, kernelDelay(history, nowSec));
  }
  return { groups, leaves };
}

export function memberNames(val: unknown, group: string): string[] {
  const all = (val as { proxies?: Record<string, { all?: unknown }> })?.proxies?.[group]?.all;
  return Array.isArray(all) ? all.filter((item): item is string => typeof item === "string") : [];
}

export function scopeDelays(members: string[], leaves: Map<string, KernelDelay>): Map<string, KernelDelay> {
  if (members.length === 0) return leaves;
  const scoped = new Map<string, KernelDelay>();
  for (const member of members) {
    scoped.set(member, leaves.get(member) ?? { ms: null, ageSec: null, hist: [], histLen: 0 });
  }
  return scoped;
}

export function selectableGroups(val: unknown): string[] {
  const proxies = (val as { proxies?: Record<string, Record<string, unknown>> })?.proxies ?? {};
  const byCount: Array<[number, string]> = [];
  for (const [name, node] of Object.entries(proxies)) {
    if (typeof node.now !== "string") continue;
    if (typeof node.type === "string" && node.type !== "Selector") continue;
    // 入组闸门数**非伪**成员；显示行集走 `memberNames`（`all` 原样），两件事不许搅回一起。
    const real = memberNames(val, name).filter((item) => !isPseudoNode(item));
    if (real.length === 0) continue;
    byCount.push([real.length, name]);
  }
  // 同成员数必须有次级键，否则每轮组序跟着哈希序抖。
  byCount.sort((a, b) => (b[0] - a[0]) || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  return byCount.map(([, name]) => name);
}

const PRIMARY_CANDIDATES = ["🚀 节点选择", "节点选择", "GLOBAL", "Proxy", "代理选择", "♻️ 自动选择"];

export function resolvePrimaryGroup(groups: Map<string, string>): string | null {
  for (const candidate of PRIMARY_CANDIDATES) {
    if (groups.has(candidate)) return candidate;
  }
  let best: string | null = null;
  for (const name of groups.keys()) {
    if (!name.includes("选择")) continue;
    if (best === null || name.length > best.length) best = name;
  }
  return best;
}

export interface NodeHealth {
  name: string;
  alive: boolean;
  lastMs: number | null;
  ageSec: number | null;
  baselineMs: number | null;
  sampleKey: string;
}

export function parseNodeHealth(name: string, val: unknown, nowSec: number): NodeHealth {
  const history = (val as { history?: unknown[] })?.history ?? [];
  const last = history[history.length - 1] as Record<string, unknown> | undefined;
  const delay = typeof last?.delay === "number" ? Math.trunc(last.delay) : 0;
  const time = typeof last?.time === "string" ? last.time : "";
  const sorted = history
    .map((item) => (item as Record<string, unknown>).delay)
    .filter((d): d is number => typeof d === "number" && d > 0)
    .sort((a, b) => a - b);
  return {
    name,
    alive: delay > 0,
    lastMs: delay > 0 ? delay : null,
    ageSec: time ? nowSec - (rfc3339Epoch(time) ?? nowSec) : null,
    baselineMs: sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : null,
    sampleKey: time ? `${name}|${time}` : name,
  };
}

/** 稳定度：0..1，越接近 1 越稳。用完整 10 条 history 算，而不是只看末条。 */
function stability(delay: KernelDelay): number {
  const samples = delay.hist.filter((v) => v > 0);
  if (samples.length < 2) return 0;
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const variance = samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length;
  return Math.max(0, 1 - Math.sqrt(variance) / Math.max(mean, 1));
}

export function buildNodeRows(input: {
  val: unknown;
  group: string | null;
  nowSec: number;
  sort: SortMode;
  page: number;
  pageRows: number;
  /** 「刚实测」那一档的临时覆盖表；null = 用内核实测。两档都必须数出同一个行集。 */
  freshDelays: Map<string, number> | null;
}): { rows: NodeRow[]; page: number; pageCount: number } {
  const { val, group, nowSec, sort, freshDelays } = input;
  if (!group) return { rows: [], page: 0, pageCount: 0 };

  const { groups, leaves } = parseProxies(val, nowSec);
  const members = memberNames(val, group);
  const scoped = scopeDelays(members, leaves);
  const selected = groups.get(group) ?? "";

  const all: NodeRow[] = members.map((name) => {
    const delay = scoped.get(name) ?? { ms: null, ageSec: null, hist: [], histLen: 0 };
    const override = freshDelays?.get(name);
    const ms = override !== undefined ? override : delay.ms;
    return {
      name,
      ms,
      ageSec: delay.ageSec,
      hist: delay.hist,
      pseudo: isPseudoNode(name),
      label: ms === null ? "未测" : `${ms}ms`,
      selected: name === selected,
    };
  });

  const sortKey = (row: NodeRow): number => {
    // 伪节点排最后但**保留在行集里**；这是显示层的事，不是「看不见」。
    if (row.pseudo) return Number.MAX_SAFE_INTEGER;
    if (sort === "name") return 0;
    if (sort === "stable") return -stability(scoped.get(row.name) ?? { ms: null, ageSec: null, hist: [], histLen: 0 });
    return row.ms ?? Number.MAX_SAFE_INTEGER - 1;
  };

  all.sort((a, b) => {
    const ka = sortKey(a);
    const kb = sortKey(b);
    if (ka !== kb) return ka - kb;
    if (sort === "name") return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });

  const pageCount = Math.max(1, Math.ceil(all.length / input.pageRows));
  const page = Math.min(Math.max(0, input.page), pageCount - 1);
  return { rows: all.slice(page * input.pageRows, (page + 1) * input.pageRows), page, pageCount };
}
```

- [ ] **Step 4: 跑到绿 + Commit**

```bash
pnpm vitest run src/main/verge/node-view.test.ts
git add src/main/verge/node-view.ts src/main/verge/node-view.test.ts src/main/verge/__fixtures__
git commit -m "feat(verge): 一份 proxies 喂满节点页的行集与排序"
```

---

## Task 4: 采样循环与 service 装配

**Files:**
- Create: `src/main/verge/sampler.ts`、`sampler.test.ts`
- Modify: `src/main/verge/verge-service.ts`、`verge-ipc.ts`、`bootstrap.ts`
- Modify: `src/main/application/default-dependencies.ts`（`registerCoreIpc` 之后起 sampler，`shutdown.register` 里 dispose）

**Interfaces:**
- Consumes: `createMihomoClient`、`discoverConfigRoot`/`readYamlFile`/`resolveController`、`VergeService`
- Produces:
  - `createVergeSampler(input: { client: MihomoClient; controller?: () => ControllerInfo; now?: () => number; onFrame: (frame: VergeFrame) => void; log?: (msg: string) => void }): Sampler`
  - `Sampler = { start(): () => void; tick(): Promise<void>; latest(): VergeFrame | null; failLevel(): number; invalidateController(): void }`
  - `const POLL_INTERVAL_MS = 1500`、`const PROF_REFRESH_MS = 600_000`、`const BACKOFF_STEPS_MS = [1500, 3000, 6000, 12000]`
  - `shouldEmit(prev: VergeFrame | null, next: VergeFrame): boolean`（**只在变化时外发**）
  - `type VergeFrame = { controller: ControllerInfo; traffic: TrafficFrame | null; core: CoreSnapshotFrame | null; proxies: unknown | null; mode: string | null; reason: string | null; at: number }`

- [ ] **Step 1: 写失败的测试（变化判定与退避重连是这一层的全部风险）**

```ts
// src/main/verge/sampler.test.ts
import { describe, expect, it, vi } from "vitest";
import { BACKOFF_STEPS_MS, POLL_INTERVAL_MS, createVergeSampler, shouldEmit } from "./sampler";

const frame = (over: Record<string, unknown> = {}) => ({
  controller: { available: true, baseUrl: "http://127.0.0.1:9097", secret: "", reason: "" },
  traffic: { up: 1, down: 2, upTotal: 3, downTotal: 4 },
  core: { connections: 5, proxy: 1, direct: 3, reject: 1, memory: 100 },
  proxies: { proxies: { A: { now: "x" } } },
  mode: "rule",
  reason: null,
  at: 1000,
  ...over,
});

describe("采样节奏", () => {
  it("1.5s 一轮、退避 4 档封顶（native 的预算，不许顺手调快）", () => {
    expect(POLL_INTERVAL_MS).toBe(1500);
    expect(BACKOFF_STEPS_MS).toEqual([1500, 3000, 6000, 12000]);
  });
});

describe("shouldEmit 只在变化时外发", () => {
  it("第一帧必发", () => { expect(shouldEmit(null, frame() as never)).toBe(true); });
  it("完全相同的一帧不发（每 1.5s 推一份一样的数据是纯浪费 IPC）", () => {
    expect(shouldEmit(frame() as never, frame() as never)).toBe(false);
  });
  it("正对照：只有时间戳变也不算变化", () => {
    expect(shouldEmit(frame({ at: 1000 }) as never, frame({ at: 2500 }) as never)).toBe(false);
  });
  it("流量、连接数、组内当前节点、模式、诊断语任一变都必须发", () => {
    expect(shouldEmit(frame() as never, frame({ traffic: { up: 9, down: 2, upTotal: 3, downTotal: 4 } }) as never)).toBe(true);
    expect(shouldEmit(frame() as never, frame({ core: { connections: 6, proxy: 1, direct: 3, reject: 1, memory: 100 } }) as never)).toBe(true);
    expect(shouldEmit(frame() as never, frame({ mode: "global" }) as never)).toBe(true);
    expect(shouldEmit(frame() as never, frame({ reason: "连不上 —— 试着重开" }) as never)).toBe(true);
  });
});

describe("故障与恢复", () => {
  it("接口抛错时保留上一帧数据、只换诊断语，并把失败档位推进", async () => {
    const onFrame = vi.fn();
    const client = {
      traffic: vi.fn().mockRejectedValueOnce(new Error("Connection refused: os error 10061"))
        .mockResolvedValue({ up: 1, down: 2, upTotal: 3, downTotal: 4 }),
      connections: vi.fn().mockResolvedValue({ connections: 1, proxy: 1, direct: 0, reject: 0, memory: null }),
      proxies: vi.fn().mockResolvedValue({ proxies: {} }),
      configsMode: vi.fn().mockResolvedValue("rule"),
      version: vi.fn().mockResolvedValue("1.18.0"),
      memory: vi.fn().mockResolvedValue(1),
    };
    const sampler = createVergeSampler({ client: client as never, onFrame });
    await sampler.tick();
    expect(onFrame).toHaveBeenCalledTimes(1);
    expect(sampler.latest()!.reason).toContain("没开外部接口");
    expect(sampler.failLevel()).toBe(1);
    await sampler.tick();
    expect(sampler.failLevel()).toBe(0);
  });

  it("控制器不可用时不去打网络（每 1.5s 撞一次 refused 只会把日志刷满）", async () => {
    const traffic = vi.fn();
    const sampler = createVergeSampler({
      client: { traffic } as never,
      controller: () => ({ available: false, baseUrl: "", secret: "", reason: "没开外部接口 —— 打开设置" }),
      onFrame: vi.fn(),
    });
    await sampler.tick();
    expect(traffic).not.toHaveBeenCalled();
    expect(sampler.latest()!.reason).toBe("没开外部接口 —— 打开设置");
  });
});
```

- [ ] **Step 2: 跑到红** → **Step 3: 实现**

```ts
// src/main/verge/sampler.ts
import type { ControllerInfo } from "./verge-config";
import { humanize } from "./verge-config";
import type { CoreSnapshotFrame, MihomoClient, TrafficFrame } from "./mihomo-client";

export const POLL_INTERVAL_MS = 1500;
export const PROF_REFRESH_MS = 600_000;
export const BACKOFF_STEPS_MS = [1500, 3000, 6000, 12000] as const;

export interface VergeFrame {
  controller: ControllerInfo;
  traffic: TrafficFrame | null;
  core: CoreSnapshotFrame | null;
  proxies: unknown | null;
  mode: string | null;
  reason: string | null;
  at: number;
}

/** 变化判据刻意不含 `at`：只带时间戳的重复帧不该占用 IPC。 */
export function shouldEmit(prev: VergeFrame | null, next: VergeFrame): boolean {
  if (!prev) return true;
  const key = (f: VergeFrame) => JSON.stringify({
    up: f.traffic?.up ?? null, down: f.traffic?.down ?? null,
    upTotal: f.traffic?.upTotal ?? null, downTotal: f.traffic?.downTotal ?? null,
    core: f.core ?? null, mode: f.mode ?? null, reason: f.reason,
    groups: f.proxies ? Object.entries((f.proxies as { proxies?: Record<string, { now?: string }> }).proxies ?? {})
      .filter(([, node]) => typeof node.now === "string")
      .map(([name, node]) => `${name}=>${node.now}`) : null,
  });
  return key(prev) !== key(next);
}

export interface SamplerInput {
  client: MihomoClient;
  controller?: () => ControllerInfo;
  now?: () => number;
  onFrame(frame: VergeFrame): void;
  log?(msg: string): void;
}

export function createVergeSampler(input: SamplerInput) {
  const now = input.now ?? Date.now;
  let latest: VergeFrame | null = null;
  let failLevel = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  async function tick(): Promise<void> {
    const controller = input.controller?.() ?? { available: true, baseUrl: "", secret: "", reason: "" };
    const next: VergeFrame = {
      controller,
      traffic: latest?.traffic ?? null,
      core: latest?.core ?? null,
      proxies: latest?.proxies ?? null,
      mode: latest?.mode ?? null,
      reason: null,
      at: now(),
    };
    if (!controller.available) {
      next.reason = controller.reason;
    } else {
      // 一次 tick 打齐四个只读接口；任一失败只污染 reason，不清空上一帧数据。
      const collect = async (): Promise<void> => {
        const errors: string[] = [];
        try { next.proxies = await input.client.proxies(); } catch (e) { errors.push(String(e)); }
        try { next.traffic = await input.client.traffic(); } catch (e) { errors.push(String(e)); }
        try { next.core = await input.client.connections(); } catch (e) { errors.push(String(e)); }
        try { next.mode = await input.client.configsMode(); } catch (e) { errors.push(String(e)); }
        if (errors.length > 0) next.reason = humanize(errors[0]);
      };
      await collect();
    }

    failLevel = next.reason ? Math.min(failLevel + 1, BACKOFF_STEPS_MS.length - 1) : 0;
    if (shouldEmit(latest, next)) {
      latest = next;
      input.onFrame(next);
    } else {
      latest = next;
    }
  }

  function schedule(): void {
    if (stopped) return;
    timer = setTimeout(async () => {
      await tick();
      schedule();
    }, BACKOFF_STEPS_MS[failLevel]);
    // 采样循环不该让进程留在世上：`unref` 等价 native 侧的后台线程口径。
    (timer as unknown as { unref?(): void }).unref?.();
  }

  return {
    tick,
    latest: () => latest,
    failLevel: () => failLevel,
    invalidateController() {
      failLevel = 0;
    },
    /** 返回 dispose；装配点必须接住它，退出时停循环。 */
    start(): () => void {
      stopped = false;
      schedule();
      return () => {
        stopped = true;
        if (timer) clearTimeout(timer);
        timer = null;
      };
    },
  };
}
```

`verge-service.ts` 增 `{ setFrame(frame: VergeFrame): void; onFrame(listener: (frame: VergeFrame) => void): () => void }`。本任务新增/改动的通道必须**三方一起落**（`ipc-contract.test.ts` 没有白名单，少一边就红）：

| 通道 | 值 | preload | 主进程 | 说明 |
| --- | --- | --- | --- | --- |
| `VERGE_GET_SNAPSHOT` | `"verge:get-snapshot"` | `window.verge.getSnapshot()`（invoke，P0 已落） | `ipc.handle` 改为返回真数据 | P0 的 `{ module, ready, statePath, quietUntil }` 保留，新增 `frame: VergeFrame \| null` 字段 |
| `VERGE_PROXIES` | `"verge:proxies"` | `window.verge.getProxies()`（invoke） | `ipc.handle` 返回 `sampler.latest()?.proxies ?? null` | 面板打开时自己拉一次，不等下一帧 |
| `VERGE_DATA_PUSH` | `"verge:data-push"` | `window.verge.onData(cb)`（`ipcRenderer.on` = listen） | `broadcastToAuxWindows(IPC.VERGE_DATA_PUSH, frame)`（外发） | 只有 `shouldEmit` 为真才发 |

**不加** `VERGE_REFRESH`：面板要重采就等下一帧（`POLL_INTERVAL_MS = 1500`），手动刷新按钮在 native 侧也没有对应物；多一条通道就多一处三方一致要维护，而它换不来任何判据。

装配：

```ts
// default-dependencies.ts（registerCoreIpc 之后、shutdown 注册区）
        const vergeSampler = createVergeSampler({
          client: createMihomoClient({
            controller: () => resolveController(readYamlFile(path.join(root, "clash-verge.yaml"), {})),
          }),
          onFrame: (frame) => { services.verge.setFrame(frame); broadcastToAuxWindows(IPC.VERGE_DATA_PUSH, frame); },
        });
        shutdown.register({ id: "verge-sampler", phase: "stopProducers", dispose: async () => { vergeStop?.(); } });
```

> `start()` 在 **background 阶段**调用（与 `prewarmScreenshot`/`scheduleUpdateCheck` 同一组），不在 `startCore` 里起：sampler 一跑就发网络请求，放进核心启动关键路径会把宠物窗第一帧拖慢。

- [ ] **Step 4: 跑到绿 + 探针验收**

```bash
pnpm vitest run src/main/verge
VERGE_GEOM_PROBE=1 pnpm dev 2>&1 | grep -c "VERGE"
```

Expected: 测试全绿；打开 Clash Verge 的情况下 stderr 出现 `VERGE\tframe\tup=…\tdown=…\tgroups=7\tselectable=5`（在 `onFrame` 里按 `formatGeomProbe` 的口径加一行 `VERGE` 前缀取证，屏幕层就靠它数「7 组 / 5 组可挑」）；关掉 Clash Verge，`reason` 变成 `COLD_NO_CONTROLLER` 且**没有 refused 日志风暴**（退避生效）。

- [ ] **Step 5: Commit**

```bash
git add src/main/verge/sampler.ts src/main/verge/sampler.test.ts src/main/verge/verge-service.ts src/main/verge/verge-ipc.ts src/main/verge/bootstrap.ts src/main/application/default-dependencies.ts src/shared/ipc-channels.ts src/preload/index.ts
git commit -m "feat(verge): 起内核采样循环并只在变化时外发"
```

---

## Task 5: 面板小窗壳（248×482，跟随宠物窗）

**Files:**
- Create: `src/renderer/pet/panel/index.html`、`main.tsx`、`Panel.tsx`
- Create: `src/main/windows/create-verge-panel-window.ts`
- Modify: `src/main/windows/window-state.ts`、`window-manager.ts`、`vite.config.mts:120-128`、`src/preload/index.ts`、`src/shared/ipc-channels.ts`

**Interfaces:**
- Consumes: `computePetLayout`（panel 档）、宠物窗 bounds 广播
- Produces:
  - `createVergePanelWindow(ctx: PanelWindowContext): BrowserWindow`（九步配方第 4 步）
  - `WindowManager.openVergePanel(growUp, growLeft)` / `closeVergePanel()` / `isVergePanelOpen()`
  - `IPC.VERGE_PANEL_OPEN = "verge:panel-open"`（preload send → main on）
  - `IPC.VERGE_PANEL_BOUNDS = "verge:panel-bounds"`（main 外发 → preload listen）
  - `panelAnchor(petBounds: Rect, growLeft: boolean, growUp: boolean): Rect`（纯函数，放 `src/shared/pet-geometry.ts`）

- [ ] **Step 1: 写失败的测试（锚定必须与 P1 的几何同一套数）**

先讲清算的是什么：**面板是第二个窗，猫窗不动**。所以面板外框由 native 的 pin 协议导出——屏幕上「猫内容中心」这个点（`petBounds + PIN`）在面板里必须落在收起态同一个相对位置，两窗叠加处只有「猫洞」，面板不许在洞里画卡片。因此下面钉的是 **pin 不动**，不是「底缘不动」：native 的 `grow_up` 档锚点 `OPEN_H - 4 - 51.5 * (29/60) = 453.1083`（`main.rs:4241-4247`），比收起态的 `PIN.y = 39` 大 414.1083，面板底比猫窗底**高 40px**（`467.89` vs `508`）——这是 native 的原样行为，不许「顺手修正」。

```ts
// src/shared/pet-geometry.test.ts 追加
import { OPEN_H, PIN, panelAnchor } from "./pet-geometry";

describe("panelAnchor", () => {
  const pet = { x: 1000, y: 400, width: 82, height: 108 };
  /** native grow_up 锚点：OPEN_H - 4 - 51.5 * (29/60)。 */
  const GROW_UP_ANCHOR_Y = 482 - 4 - (51.5 * 29) / 60;

  it("向右下展开：面板左上角就是猫窗左上角", () => {
    expect(panelAnchor(pet, false, false)).toEqual({ x: 1000, y: 400, width: 248, height: 482 });
  });

  it("向左展开：右缘不动（newLeft = rightAnchor - newWidth，grow_left 气泡档同理）", () => {
    const rect = panelAnchor(pet, true, false);
    expect(rect.x).toBeCloseTo(1000 + PIN.x - (248 - PIN.x), 6);
    expect(rect.x + rect.width).toBe(1082);
  });

  it("向上展开：pin 在屏幕上不动，面板底比猫窗底高 40（native 原样，别修正）", () => {
    const rect = panelAnchor(pet, false, true);
    expect(GROW_UP_ANCHOR_Y).toBeCloseTo(453.1083, 3);
    // 未取整前是 439 - 453.1083 = -14.1083；对外框一律取整（Electron setContentSize 吃整数）
    expect(rect.y).toBe(-14);
    // 正对照：底缘确实不重合，这条断言存在是为了防止有人把它「改对」成 508
    expect(rect.y + rect.height).not.toBeCloseTo(400 + 108, 3);
    expect(400 + 108 - (rect.y + rect.height)).toBe(40);
  });

  it("面板尺寸恒为 248×482，外框取整不留小数（Electron setContentSize 吃整数）", () => {
    for (const [gl, gu] of [[false, false], [true, false], [false, true], [true, true]] as const) {
      const rect = panelAnchor(pet, gl, gu);
      expect([rect.width, rect.height]).toEqual([248, OPEN_H]);
      expect(Number.isInteger(rect.x)).toBe(true);
      expect(Number.isInteger(rect.y)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: 跑到红** → **Step 3: 实现**

```ts
// src/shared/pet-geometry.ts 追加
/**
 * 面板档的外框：由 `computePetLayout` 的 panel 分支导出，两者不许各算一遍。
 * workArea 给一个必然不夹紧的大框——面板的夹紧由调用方（窗口工厂）用真实 workArea 再做一次，
 * 这里的职责只是「pin 协议下的理想外框」。
 */
export function panelAnchor(petBounds: Rect, growLeft: boolean, growUp: boolean): Rect {
  const layout = computePetLayout({
    catOrigin: { x: petBounds.x, y: petBounds.y },
    e: 1, be: 0, growLeft, growUp,
    workArea: { x: -1e6, y: -1e6, width: 2e6, height: 2e6 },
    peekDx: 0,
  });
  return {
    x: Math.round(layout.pos.x),
    y: Math.round(layout.pos.y),
    width: Math.round(layout.size.width),
    height: Math.round(layout.size.height),
  };
}
```

窗口工厂照抄音乐窗九步（`create-music-player-window.ts` 为形），差别只在：`transparent: true`、`backgroundColor: "#00000000"`、`focusable: false`、`resizable: false`、`hasShadow: false`、`skipTaskbar: true`、`show: false`，且**位置来自 `panelAnchor` 而不是持久化状态**。

```ts
// src/main/windows/create-verge-panel-window.ts
import { BrowserWindow } from "electron";
import path from "node:path";
import { OPEN_H, OPEN_W } from "../../shared/pet-geometry";

export interface PanelWindowContext {
  getAppPath(): string;
  isDev: boolean;
  preloadPath: string;
}

export function createVergePanelWindow(ctx: PanelWindowContext): BrowserWindow {
  const win = new BrowserWindow({
    width: Math.round(OPEN_W),
    height: Math.round(OPEN_H),
    transparent: true,
    backgroundColor: "#00000000",
    frame: false,
    show: false,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: { preload: ctx.preloadPath, contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  if (ctx.isDev) win.loadURL(`http://localhost:5173/src/renderer/pet/panel/index.html`);
  else win.loadFile(path.join(ctx.getAppPath(), "dist", "renderer", "src", "renderer", "pet", "panel", "index.html"));
  return win;
}
```

跟随宠物窗：`window-manager.ts` 里宠物窗 `moved`/`resized` 与 `setPetWindowBounds` 成功后外发 `IPC.VERGE_PANEL_BOUNDS`，面板渲染进程用 `-webkit-app-region: drag` 只给标题行，其余不吞滚轮。`vite.config.mts` 的 `rolldownOptions.input` 加一行 `"verge-panel": resolve(import.meta.dirname, "src/renderer/pet/panel/index.html")`。

- [ ] **Step 4: 跑到绿 + 屏幕验收**

```bash
pnpm vitest run src/shared/pet-geometry.test.ts src/main/application/ipc-contract.test.ts
pnpm dev
```

Expected: 点猫 → 248×482 面板在猫的右下/左下/右上任一侧出现且**猫不被推出面板**；拖动猫，面板跟着走；`ipc-contract` 对 `verge:panel-open`(send→on)、`verge:panel-bounds`(外发→listen) 两条都对上。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/pet/panel src/main/windows/create-verge-panel-window.ts src/main/windows/window-state.ts src/main/windows/window-manager.ts vite.config.mts src/preload/index.ts src/shared/ipc-channels.ts src/shared/pet-geometry.ts src/shared/pet-geometry.test.ts
git commit -m "feat(verge): 面板小窗挂上宠物窗锚定"
```

---

## Task 6: 面板表面色在 Chromium 下的重推导（spec §9-6）

**Files:**
- Modify: `src/renderer/pet/tokens.ts`、`tokens.test.ts`
- Create: `docs/verge/spikes/p2-panel-colors.md`

**Interfaces:**
- Produces: `PANEL_BG / PANEL_CARD / PANEL_CARD_STROKE / PANEL_SEP`（fork 侧最终值），以及一条把它们钉死的单测。

- [ ] **Step 1: 写实测步骤（先量，再写断言）**

1. 在面板里画四块 1px 精度已知的色块：`#101420` 实心、`rgba(255,255,255,13/255)` 叠在 `#101420`（预混后不透明）、同 alpha 的**未预混**半透、`wash(WHITE, 18, CARD)`。
2. `win.webContents.capturePage()` 取 PNG（Task 5 已确认 alpha 通道保留），用 Python 读这四块中心 5×5 的中位数。
3. 与 native 面板同位置的截图逐通道比差；把结论写进 `p2-panel-colors.md`：Chromium 是否会把 alpha 再过一遍 sRGB（native 实测是亮 4-7 倍）。

- [ ] **Step 2: 把实测结果写进失败测试**

```ts
// src/renderer/pet/tokens.test.ts 追加
describe("面板表面色（fork 管线实测推导）", () => {
  it("面板底不透明（桌布漂移会把字节哈希的验收尺读成「一直在变」）", () => {
    expect(PANEL_BG).toBe("#101420");
    expect(PANEL_BG_ALPHA).toBe(255);
  });

  it("卡底 / 描边 / 分隔线按 fork 管线推导，与 native 的 CARD/CARD_STROKE/SEP 逐通道差 ≤1", () => {
    expect(PANEL_CARD).toBe("#1c202c");
    expect(PANEL_CARD_STROKE).toBe("#242833");
    expect(PANEL_SEP).toBe("#1a1e29");
  });

  it("正对照：不预混的半透白在屏幕上比设计亮 → 正文必须走 wash，不许直接写 rgba", () => {
    expect(PANEL_PIPELINE_AMPLIFIES_ALPHA).toBe(false);
    // 若实测为 true，把上面这条改成与 native 同口径的 `wash` 强制断言，并在 spike 里记证据。
  });
});
```

- [ ] **Step 3: 实现常量并按实测调整**（`PANEL_*` 从实测表里落；`PANEL_PIPELINE_AMPLIFIES_ALPHA` 由截图数据决定 true/false，两者都对应一条实现分支：false 时正文可直接写 `rgba`，true 时一律 `wash`。本任务把这条决定**写死并留证据**，不留「以后再看」。）

- [ ] **Step 4: 跑到绿 + Commit**

```bash
pnpm vitest run src/renderer/pet/tokens.test.ts
git add src/renderer/pet/tokens.ts src/renderer/pet/tokens.test.ts docs/verge/spikes/p2-panel-colors.md
git commit -m "feat(verge): 按 Chromium 管线重推面板表面色"
```

---

## Task 7: 面板四页与折叠线预算

**Files:**
- Create: `src/renderer/pet/panel/OverviewPage.tsx`、`NodesPage.tsx`、`ProfilePage.tsx`、`SpokenPage.tsx`
- Create: `src/renderer/pet/panel/tabs.ts` + `tabs.test.ts`
- Create: `tools/verify_panel_fold.py`

**Interfaces:**
- Consumes: `VergeFrame`、`buildNodeRows`、`PAGE_ROWS`
- Produces:
  - `const TABS = ["概览", "节点", "订阅", "播报"]`、`UNREAD_TAB_INDEX = 3`
  - `tabCellRect(index: number, tabs: string[]): Rect`（页签格坐标，纯函数）
  - `const FOLD_LINE = 414`（native 面板正文的折叠线，Chromium 下要重量，见 Step 4）
  - 每页页脚底边 `footerBottom(page, state): number`

- [ ] **Step 1: 写失败的测试（页签格与折叠预算）**

```ts
// src/renderer/pet/panel/tabs.test.ts
import { describe, expect, it } from "vitest";
import { FOLD_LINE, TABS, UNREAD_TAB_INDEX, footerBottom, tabCellRect } from "./tabs";

describe("页签", () => {
  it("四页顺序与 native 一致，未读角标格号先钉在「播报」（P2 只有常量、不画牌子——帐本在 P3 才有）", () => {
    expect(TABS).toEqual(["概览", "节点", "订阅", "播报"]);
    expect(UNREAD_TAB_INDEX).toBe(3);
  });

  it("格子等宽铺满 248 宽，第四格右缘不超过窗口（页签数从三变四时所有钉死 x 的尺都要重算）", () => {
    const cells = TABS.map((_, i) => tabCellRect(i, TABS));
    expect(cells[0].x).toBeCloseTo(8, 6);
    expect(cells.at(-1)!.x + cells.at(-1)!.width).toBeLessThanOrEqual(248 - 8);
    expect(cells[1].x).toBeCloseTo(cells[0].x + cells[0].width, 6);
  });
});

describe("折叠线预算", () => {
  it("四页页脚都必须落在折叠线以上（native 实测 概览 407/414、节点 405/414、订阅 400/409、播报 402/412）", () => {
    expect(footerBottom("overview", {})).toBeLessThanOrEqual(FOLD_LINE);
    expect(footerBottom("nodes", { rows: 7, pageCount: 2 })).toBeLessThanOrEqual(FOLD_LINE);
    expect(footerBottom("profile", {})).toBeLessThanOrEqual(FOLD_LINE);
    expect(footerBottom("spoken", { rows: 7 })).toBeLessThanOrEqual(FOLD_LINE);
  });

  it("正对照：概览页只剩 7px 余量，任何 +8px 的装饰都会把页脚顶下去", () => {
    expect(FOLD_LINE - footerBottom("overview", {})).toBeLessThan(15);
    expect(footerBottom("overview", { extra: 8 })).toBeGreaterThan(FOLD_LINE);
  });
});
```

- [ ] **Step 2: 跑到红** → **Step 3: 实现布局方程**（`footerBottom` 用与渲染同一套高度常量累加，**不许**从 DOM 反推——DOM 反推的页脚高度在 chart.js 动画没跑完时会变。渲染端把它用作 `min-height` 的预算依据，保证「算出来的」与「画出来的」同源。）

> **与 spec §8 的一处偏离（有意为之，写明在此）**：spec 的 P2 交付物写的是「概览/节点/播报三页」，本计划做**四页**，把 native 的「订阅」页一起搬。理由是 `panel.rs:271` 的页签数组就是四格、未读角标钉在第 4 格（index 3），三格与四格的页签格宽不同，所有钉死 x 的尺都要跟着改算式；先按三格落地、P3 再加第四格，等于把同一批尺子写两遍。若执行中被证明订阅页的数据源拿不到（`profiles.yaml` 结构变了或目录不存在），**退三页**并把这条偏离的结果记进 `docs/verge/spikes/p2-panel-colors.md`，同时 `TABS` 与 `tabCellRect` 的格子数、`UNREAD_TAB_INDEX` 一起改回 3——三格档的格宽 = `(248 - 2*8) / 3`，页签测试要同步换期望值。

四页内容按 native 口径搬：

| 页 | 必含 | 只读约束 |
| --- | --- | --- |
| 概览 | 未连接时的引导态、实时流量 + 90 秒曲线、今日累计（对比近 7 日均值）、运行模式只读显示、当前节点 + 「选择最优」**禁用**、打开配置目录、藏身开关 | 模式药丸不接写接口；「选择最优」在 P3 前点了只出气泡「这条要等换节点通道开齐」 |
| 节点 | 组翻页器（只列 `selectableGroups`）、7 行/页、排序三档（快/稳/名）、微历史条（10 条）、未测显示「未测」 | 行点击在 P3 前不接 `PUT`：命中只出「这条要等 P3」并选中视觉态 |
| 订阅 | 订阅列表（`profiles.yaml` 只读）、当前订阅标记、用户名/主机标签（`subscriptionUser` / `subscriptionHostLabel`） | 不复制、不打开链接、不更新订阅 |
| 播报 | **P2 只演空态**：「今天还没有播报。猫开口过一次，就会出现在这儿。」环形帐本存储（`spoken-ledger.json`）、未读角标与停留销账都在 P3（spec §8 的 P3 交付物），P2 **不许提前建 store** 也不许造假的样例条目——空态就是本页在 P2 的全部渲染路径，折叠尺照量它 | 只读；无行可点 |

- [ ] **Step 4: 屏幕层尺（重写坐标模型）**

```python
# tools/verify_panel_fold.py（判据骨架复用 clash verge/file/verify_fold.py）
# require: Clash Verge 在跑、桌面只有宠物窗与面板、屏幕缩放取已知值
# 每页各量一次「内容底边 / 页脚底边」两个数，页脚底边 > FOLD_LINE 判 FAIL。
# 已知确定性风险必须先压住再读：chart.js 动画（`animation: false`）、
# CSS transition（面板打开后等 600ms）、rAF 节流（窗口不得最小化）、
# 桌布自绘（截图两帧取交集，漂移 >2 的像素不算）。
```

Expected: 四页全绿。任何一页红 → 回到 Step 3 改布局预算，**不许**改 `FOLD_LINE` 期望值迁就实现。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/pet/panel tools/verify_panel_fold.py
git commit -m "feat(verge): 面板四页与折叠线预算"
```

---

## Task 8: 面板 20s 无操作自动收起

**Files:**
- Create: `src/renderer/pet/panel/idle-tick.ts` + `idle-tick.test.ts`
- Modify: `src/renderer/pet/panel/Panel.tsx`、`src/main/verge/geom-probe.ts`（探针档）、`src/shared/ipc-channels.ts`、`src/preload/index.ts`、`src/main/verge/verge-ipc.ts`（`VERGE_CURSOR_POS` handle）、`src/main/windows/window-manager.ts`（`VERGE_PANEL_CLOSE` on → `closeVergePanel()`）

**Interfaces:**
- Consumes: `WindowManager.isVergePanelOpen()` / `closeVergePanel()`（Task 5）、宠物窗/面板窗 bounds（Task 5）、`VERGE_PANEL_BOUNDS` 推送的面板矩形（Task 5）、`window.verge.getProxies()` 的在途状态（Task 4）
- Produces:
  - `const PANEL_IDLE_MS = 20_000`、`const PANEL_IDLE_PROBE_MS = 4_000`
  - `panelIdleTick(input: { open, settled, active, busy, held, dt, lim }): { held: number; collapse: boolean }`
  - `isCursorInsideWindow(rect, cursor): boolean`
  - `usePaintedFrame(): boolean`（在 `Panel.tsx` 里产出 `settled`：首帧双 `requestAnimationFrame` 后置位。面板窗 `show: false` + `ready-to-show` 才 `show()`，隐藏期间 Chromium 节流 rAF，所以「渲染进程自己画完过一帧」天然等价于「窗口真在屏幕上站好了」，不需要额外通道从主进程回传。）
  - `IPC.VERGE_CURSOR_POS = "verge:cursor-pos"`（preload invoke → main handle，返回 `screen.getCursorPoint()`）
  - `IPC.VERGE_PANEL_CLOSE = "verge:panel-close"`（preload send → main on，main 里执行 `closeVergePanel()`）

> **native 五道闸门的第二道在 fork 侧换了形态（有意为之，写明在此）**：native 的 `panel_idle_tick(open, e, active, busy, held, dt, lim)` 里 `e >= 0.99` 卡的是**同一个窗从 82×108 长到 248×482 的生长动画**（`main.rs:937 panel_anim`）——那个窗口同时是猫和面板，所以展开必然是一段尺寸斜坡。fork 侧面板是**第二个窗**（Task 5），猫窗全程 82×108 不变，生长动画没有载体：面板要么还没 `show()`，要么已经整幅站在锚点上。所以 `e` 这个入参在 fork 里退化成一个布尔闸：`settled = 面板窗已可见 && show() 之后至少过完一帧`。**这一道闸的目的原样保留**——刚点开的那一帧不许被上一轮的余量收回去。fork 侧若要补视觉上的展开动效，用 CSS `transform`/`opacity` 在面板体内做（不改外框尺寸，锚定与「猫洞」都不受影响），届时 `settled` 的判据换成读同一段 transition 的结束事件，入参形态不许再改。

- [ ] **Step 1: 写失败的测试（五道闸门 + 负判据的正对照）**

```ts
// src/renderer/pet/panel/idle-tick.test.ts
import { describe, expect, it } from "vitest";
import { PANEL_IDLE_MS, panelIdleTick } from "./idle-tick";

const open = { open: true, settled: true, active: false, busy: false, held: 19_000, dt: 1_000, lim: PANEL_IDLE_MS };

describe("panelIdleTick", () => {
  it("时长照抄 native：20 秒", () => { expect(PANEL_IDLE_MS).toBe(20_000); });

  it("攒满就收，收起即归零（下次展开重新计满一整轮）", () => {
    expect(panelIdleTick(open)).toEqual({ held: 0, collapse: true });
  });

  it("差 1 秒不收", () => {
    expect(panelIdleTick({ ...open, held: 18_000 })).toEqual({ held: 19_000, collapse: false });
  });

  it("五道闸门任何一道开着就把计数**清零**，不是暂停", () => {
    expect(panelIdleTick({ ...open, open: false })).toEqual({ held: 0, collapse: false });
    expect(panelIdleTick({ ...open, settled: false })).toEqual({ held: 0, collapse: false });
    expect(panelIdleTick({ ...open, active: true })).toEqual({ held: 0, collapse: false });
    expect(panelIdleTick({ ...open, busy: true })).toEqual({ held: 0, collapse: false });
  });

  it("正对照：面板刚 `show()` 出来那一帧绝不收（native 的 `e>=0.99` 那道闸在 fork 侧的等价物）", () => {
    expect(panelIdleTick({ ...open, settled: false, held: 25_000 })).toEqual({ held: 0, collapse: false });
  });

  it("在途刷新不收（native「立即实测进行中」那道闸在 P2 的等价物）", () => {
    expect(panelIdleTick({ ...open, busy: true, held: 30_000 })).toEqual({ held: 0, collapse: false });
  });

  it("P2 的 lim 只有两种取值，探针档不许被生产代码读到", () => {
    expect(PANEL_IDLE_PROBE_MS).toBe(4_000);
  });
});

describe("isCursorInsideWindow", () => {
  it("native 的迟滞外扩 3px 原样搬：出边 1~2px 还算在场，第 3px 起算离场", () => {
    const win = { x: 100, y: 100, width: 248, height: 482 };
    // 右缘 347 是窗内最后一列（100+248=348 为开区间上界），外扩 3 → 命中区间 [97, 351)
    expect(isCursorInsideWindow(win, { x: 347, y: 581 })).toBe(true);
    expect(isCursorInsideWindow(win, { x: 350, y: 584 })).toBe(true); // 正对照：迟滞本身
    expect(isCursorInsideWindow(win, { x: 351, y: 584 })).toBe(false); // 刚好跨过第 3px
    expect(isCursorInsideWindow(win, { x: 96, y: 100 })).toBe(false); // 左侧出边 4px
    // 正对照：z-order 与坐标无关——被别窗压住但光标还在矩形内，照样算活跃
    expect(isCursorInsideWindow(win, { x: 200, y: 300 })).toBe(true);
  });
});
```

（`PANEL_IDLE_PROBE_MS` 与 `isCursorInsideWindow` 从同一模块导入，test 头部一行了结：`import { PANEL_IDLE_MS, PANEL_IDLE_PROBE_MS, isCursorInsideWindow, panelIdleTick } from "./idle-tick";`）

命中区与 z-order 无关（native 口径：`main.rs` 用 `PointerMoved` 事件 + `screen_rect().expand(3.0)` 判在场，从不问「光标下面是不是我的窗口」）。fork 侧同样只比坐标、不查栈顶，`isCursorInsideWindow` 的入参就是纯矩形——面板 `focusable: false` 且渲染进程被 `setIgnoreMouseEvents(forward)` 让出鼠标，**永远拿不到自己的 hover 事件**，这条闸门全靠主进程那份全局光标坐标撑着。`VERGE_CURSOR_POS` 的 handle 里只做一件事：读 `screen.getCursorPoint()` 并**换算成与 `win.getBounds()` 同一单位**（DIP）再返回。两处的单位口径必须一致，否则 125% / 150% 缩放下矩形会整体缩水，光标明明在面板里却判成离场、面板 4 秒就收——这个坑在 P1 Task 5 的 DPI spike 里量过，执行时把 `screen.getCursorPoint()` 与 `win.getBounds()` 的读数一起写进 `docs/verge/spikes/p1-window.md`，两边同框对比一次才算闭环。另加一条：拖动猫窗的那一轮里不许读这个判据（`screen.getCursorPoint()` 的取数时刻与 `VERGE_PANEL_BOUNDS` 推送的矩形不在同一帧，拖窗时二者必然错位）。

- [ ] **Step 2: 跑到红** → **Step 3: 实现**（`active` = 本帧有指针/滚轮/键盘事件 **或** 光标仍在窗口矩形内；光标停在面板上就算活跃——人在读数据，只是手没动。光标坐标渲染进程拿不到，每 tick 走一次 `window.verge.getCursorScreenPoint()`（`VERGE_CURSOR_POS` invoke→handle，主进程里就一行 `screen.getCursorPoint()`），1 秒一次的轮询不构成性能项。`busy` = **这一道闸在 P2 换了观测源，写明在此**：native 的 `data.testing` 是**自己按下「立即实测」时置真的本地旗标**（`main.rs:731/758` 在发出 `TestNodes` 前后置位），不是从内核读回来的字段——`/proxies` 的 `history` 里只有 `time` 与 `delay`（`clash_state.rs:1291-1304`，native 从不解析 `status`）。P2 既不许发 `GET /group/{组}/delay`、也不许发任何写请求，那面旗标在 fork 侧**没有生产者**。所以 P2 的 `busy` 取渲染进程唯一真实存在的在途操作：`window.verge.getProxies()` 从发出到返回的那一段（面板打开、翻页、换组各拉一次）。P3 开出唯一执行入口后，把 `busy` 扩成 native 原口径 `testing || busy`（那时才真的有「我们按下去的那一发」要护住结果）。闸门本身的形态与计数行为不许改——改的只是它的输入源。`collapse === true` 时渲染进程 `window.verge.requestPanelClose()`，收起动作由主进程 `closeVergePanel()` 执行——句柄、`isVergePanelOpen` 状态和 `VERGE_PANEL_BOUNDS` 的停发都在主进程那边，渲染进程不许自己 `win.close()`。）

**收合证据看哪一维（native 量具坑一，fork 侧换了载体但坑没变）**：native 收的是同一个窗，所以「`482 → 108` 的高度回弹」是干净证据；气泡把窗口横向撑到 172 却从不撑高。fork 侧面板是第二个窗，收起 = 那个窗**不再可见**，猫窗从头到尾都是 108 高（气泡只改它的宽）。所以验收器认的是「面板窗 `isVisible()` 由 true 变 false」，并且必须**按窗句柄取窗口**而不是按进程名或按尺寸猜——猫窗在收起那一刻常常正好开口（播报在面板开着时被静音，一收就解禁），拿「屏幕上没有 482 高的窗了」当证据会误判成收起早了半秒。宽度一律不作证据。

CPU 取样按窗口 PID 聚合（含 GPU 进程），性能口径照 native：分段取样、同进程 A/B。

- [ ] **Step 4: 探针档 + 屏幕验收**

```bash
pnpm vitest run src/renderer/pet/panel/idle-tick.test.ts src/main/application/ipc-contract.test.ts
```

```bash
VERGE_PANEL_FORCE_BUSY=1 pnpm dev --verge-panel-idle-probe   # busy 档
pnpm dev --verge-panel-idle-probe                            # 正常档（正对照）
```

Expected: 探针档把 `lim` 换成 `4_000ms`，把面板打开、**光标移出窗口矩形**（移出前先回读落点确认真的在矩形 + 3px 之外——native 量具坑三：`--default` 分支忘了先 `away()`，产品正确不收、脚本报「42 秒还没收」），4 秒后面板窗 `isVisible()` 变 false 且猫窗仍在原位；把光标停在面板矩形内（含 3px 迟滞带）10 秒**不许**收（负判据的正对照）。第二轮再点开，必须**重新**等满 4 秒——中途活跃把整场等待作废，不是一次性开关。

取证行（`--verge-panel-idle-probe` 下由 `geom-probe.ts` 打，前缀沿用 `VERGE`）：每 tick 一行 `VERGE<TAB>idle<TAB>held=<ms><TAB>active=<0|1><TAB>settled=<0|1><TAB>busy=<0|1><TAB>cursor=<x>,<y><TAB>panel=<x>,<y>,<w>,<h>`。尺子读 stderr 判「为什么没收」，不靠猜；同时打 `screen.getCursorPoint()` 原始值与换算后的 DIP 值两列，缩放档一跑就能看出单位错没错。

`busy` 那一档**不靠点击证明**：`VERGE_PANEL_FORCE_BUSY=1` 只在 `--verge-panel-idle-probe` 下生效，把渲染进程的 `busy` 输入钉成常量 true（等价于「那发 `getProxies()` 一直挂着」），面板停在亮着的状态 12 秒不许收；去掉该环境变量后同一面板必须在 4 秒档收起（正对照，证明「不收」不是尺子挂了——native #70 的教训：尺自己崩了不许读成 PASS）。验收器全程只切页签：不点节点行、不点「立即实测」「选择最优」「复制链接」、不碰模式药丸。


- [ ] **Step 5: Commit**

```bash
git add src/renderer/pet/panel/idle-tick.ts src/renderer/pet/panel/idle-tick.test.ts src/renderer/pet/panel/Panel.tsx src/main/verge/geom-probe.ts src/main/verge/verge-ipc.ts src/main/windows/window-manager.ts src/shared/ipc-channels.ts src/preload/index.ts
git commit -m "feat(verge): 面板无人操作自动收起"
```

---

## Task 9: P2 收尾 — 只读红线与安全网

**Files:**
- Create: `tools/verify_verge_readonly.py`
- Modify: `docs/verge/spikes/p2-panel-colors.md`（补 P2 退出条件实测记录）

**Interfaces:**
- Produces: 一条可重复执行的安全网脚本 + P2 退出条件核对表。

- [ ] **Step 1: 写安全网（节点在用哈希前后一致）**

```python
# tools/verify_verge_readonly.py
# 永久闸门（native 侧误点事故换来的，fork 侧一条不许松）：
#   绝不点：节点行、「选择最优」、「立即实测」、「复制链接」、模式药丸。
#   只许点：页签格（每次点击前重新截图、现量格号，量不过当场停手）。
# 1) 读 /proxies，取 5 个可挑组的 `now`，算 sha256 → before
# 2) 开面板 → 四页各切一遍（每页停留 1s）→ 关面板；重复 5 轮
# 3) 再读一次 → after；assert before == after，否则 exit 1 并打印差异组
# 4) state.json / usage.json / spoken-ledger.json / crash.log 逐字节备份 + 还原（放进 finally）
# 5) 静态证明「点不到的东西确实点不到」：
#    - grep `src/main/verge/mihomo-client.ts` 与 `src/renderer/pet/panel/**` 里不得出现
#      `"PUT"` / `"POST"` / `method:`（客户端从签名上就拿不到 method，这里只是双保险）
#    - 若 mihomo 访问日志可得，断言本轮无 PUT/POST 命中 /proxies|/configs
# 6) 环境不合格（Verge 没跑 / 面板起不来 / 屏幕上有别的窗口压屏）→ exit ENV 并点名窗口，
#    脚本自己崩了不许读成 PASS
```

Expected: `exit 0`。**这一条是 P2 的硬闸门**：native 侧「误点节点行不可还原」的事故已经发生过一次，任何一条红都不许用「大概没生效」解释过去。而那些**不許點**的控件，它们的惰性由「拿不到 method 的签名 + 源码 grep + 访问日志」三件证明，不靠点击证明。

- [ ] **Step 2: 跑全量护栏**

```bash
pnpm test
pnpm run check:main && pnpm run check:renderer
git diff --stat master..verge
```

Expected: 全绿；上游文件改动计数 ≤ 5（`create-pet-window.ts`、`renderer/main.ts`、`window-manager.ts`、`preload/index.ts`、`default-dependencies.ts` + `core-bootstrap.ts`/`vite.config.mts`/`ipc-channels.ts` 中的每一处都要在 PR 描述里点名理由；超出就把它拆成「新目录承接」的形态）。

- [ ] **Step 3: 屏幕层跑 P2 退出条件**

| 判据 | 取证 |
| --- | --- |
| 面板读到真实 7 组 | `VERGE` 探针行 `groups=7` |
| 5 组可挑 | 翻页器格数 + `VERGE` 行 `selectable=5` |
| 行集稳定 | 连开面板 5 次，同一组行数与首行名次一致（`buildNodeRows` 单测 + 屏幕尺各一次） |
| 只读 | `verify_verge_readonly.py` exit 0 |
| 四页页脚在折叠线以上 | `verify_panel_fold.py` 全绿 |
| 20s 收起 | 探针档 + 光标停留的正对照 |

- [ ] **Step 4: Commit**

```bash
git add tools/verify_verge_readonly.py docs/verge/spikes
git commit -m "test(verge): 落地只读红线的安全网"
```

- [ ] **Step 5: 决定 native 侧的去留**

P2 结束**不**冻结 native 版（冻结点在 P3 收口之后，见 spec §8）。这一步只做记录：把「P2 退出条件已绿 / 尚未接管切节点 / 双轨继续」写进 `docs/verge/spikes/p2-panel-colors.md` 末尾，并把 P3 计划要回答的三个问题列出来（唯一执行入口签名、ledger 落盘形态、watchers 复用 proactive 闸门的方式）。
