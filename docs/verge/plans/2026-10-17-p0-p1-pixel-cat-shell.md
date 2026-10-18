# P0 环境与骨架 + P1 像素猫进壳 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to execute this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 fork 出来的 Cyrene 壳在本机跑起来并装进 `src/main/verge/` 空骨架（P0），随后把 native 桌宠的像素猫、82×108 小窗、右键手势与贴边藏身原样搬进 Electron 壳（P1）。

**Architecture:** 上游 Electron 44 + React 19 的组合根不动，新代码集中在 `src/main/verge/`（三段范式 bootstrap/service/ipc）与 `src/renderer/pet/`（canvas 2D 指令式绘制）。几何与色板全部下沉为 `src/shared/pet-geometry.ts` + token 单测，渲染器只解释指令；主进程只负责窗口外框、身份隔离与持久化。

**Tech Stack:** TypeScript 5 / Electron 44 / canvas 2D / vitest 5（pool forks）/ pnpm 10.33.0（corepack）。

**Spec:** [docs/verge/specs/2026-10-17-clash-verge-pet-merge-design.md](../specs/2026-10-17-clash-verge-pet-merge-design.md)

**移植源（只读，不在本仓库）：** `D:\Test\workbuddy\clash verge\native\src\`，其中 `main.rs`（9273 行，几何/藏身/免打扰/重绘策略）、`ui.rs`（1252 行，像素猫美术）、`palette.rs`（21 行，跨模块色 token 台账）。`clash verge/src/mascot.ts` 是废弃的 Tauri SVG 版，**禁止**作为移植源。

## Global Constraints

- 包管理：`packageManager` 锁 `pnpm@10.33.0`；Node engines `>=24 <25`；不引入新依赖（P0/P1 所需能力 Electron + canvas 已有）。
- 磁盘：pnpm store、npm cache、Electron 缓存一律指向 `D:`（本机不在 Administrators，C: 余量紧张）。
- 网络：GitHub 只能走代理 `http://127.0.0.1:7896`；npm registry 直连即可。代理环境变量会污染对 `127.0.0.1` 的本地探测，本地探测必须显式绕代理。
- 上游文件改动 ≤ 5 处（spec §6.1）：宠物窗工厂、`renderer/main.ts`、`window-manager`、`preload/index.ts` 白名单、`default-dependencies.ts`。其余一律新目录 + 新通道增量落地。
- 提交格式：`type(scope): 中文描述`（`AGENTS.md`）。
- 护栏测试必须绿：`src/main/application/ipc-contract.test.ts`（含 100/10/20/100/10/20 下界与「注册点从 `src/main/index.ts` 可达」）。
- P0/P1 **只读不写**：不得对 mihomo 发任何 `PUT`；不得点节点行；不得改用户的出口节点。
- 验收三层口径（spec §6.8）：判据归单测、插管归探针（stderr）、屏幕层只认盘里的变化；负向判据必须配正对照；尺自己崩了不许读成 PASS；环境不合格 `exit ENV` 并点名压屏窗口。
- native 版在 P3 收口前仍是在用版本，本期不得删除或改动 native 仓库的任何产品代码。

---

## 文件结构

| 路径 | 动作 | 责任 |
| --- | --- | --- |
| `src/main/updater/update-policy.ts` | 新建 | 「要不要排期启动更新检查」的纯判据（R1 闸门） |
| `src/main/app-identity.ts` | 新建 | fork 的实例名与 userData 目录解析（R6 命名隔离） |
| `src/main/application/pre-ready.ts` | 修改 | 在拿单实例锁之前应用身份 |
| `src/main/verge/bootstrap.ts` | 新建 | 三段范式的装配入口：建服务、挂 IPC、给 disposer |
| `src/main/verge/verge-service.ts` | 新建 | verge 领域服务（P0 只有状态壳与订阅者） |
| `src/main/verge/verge-store.ts` | 新建 | 原子写存储（`userData/verge/state.json`） |
| `src/main/verge/verge-ipc.ts` | 新建 | `ipc.handle` 注册与 disposer |
| `src/shared/pet-geometry.ts` | 新建 | 猫窗几何：常量、`scaleFor`、`computePetLayout`、`computeCatRect` |
| `src/renderer/pet/tokens.ts` | 新建 | 色板 token（直译 `palette.rs` + `ui.rs` 的墨色） |
| `src/renderer/pet/ops.ts` | 新建 | 绘制指令模型 + canvas 2D 解释器 |
| `src/renderer/pet/art.ts` | 新建 | 由 `ui.rs` 移植的路径构造器，产出 `DrawOp[]` |
| `src/renderer/pet/renderer.ts` | 新建 | `PixelPetRenderer`：满足 Live2DManager 的替换面 |
| `src/renderer/pet/click-through.ts` | 新建 | canvas 2D alpha 命中 → 逐像素穿透 |
| `src/renderer/main.ts` | 重写 | 宠物窗渲染入口（脱钩 Cubism） |
| `src/renderer/index.html` | 修改 | 去掉 `<script src="/live2dcubismcore.min.js">` |
| `src/main/windows/window-manager.ts` | 修改 | `setPetWindowBounds`（右缘锚定 + 去重） |
| `src/main/windows/context-menu.ts` | 修改 | 宠物窗右键菜单挂载点复用 |
| `src/main/startup/create-pet-window.ts` | 修改 | 基址 82×108、dev 也开穿透 |
| `src/shared/ipc-channels.ts` | 修改 | `VERGE_*` 通道 |
| `src/preload/index.ts` | 修改 | `window.verge` 白名单 |
| `src/main/application/core-bootstrap.ts` | 修改 | `CoreServices.verge` |
| `src/main/application/default-dependencies.ts` | 修改 | 装配：服务、IPC、shutdown、更新闸门 |

---

# P0 — 环境与骨架

## Task 1: 依赖装到 D: 并跑绿基线

**Files:**
- Create: `docs/verge/plans/notes/p0-install.md`（实测记录，含 R3 偏离结论）
- 只读参考：`package.json`、`pnpm-workspace.yaml`、`vitest.config.mts`

**Interfaces:**
- Consumes: 无
- Produces: 一个能跑 `pnpm test` / `pnpm build` / `pnpm dev` 的工作目录；`node_modules` 就位。

- [ ] **Step 1: 起 pnpm（corepack，不装到系统目录）**

```bash
corepack enable
corepack prepare pnpm@10.33.0 --activate
pnpm --version   # 必须正好 10.33.0
```

Expected: 输出 `10.33.0`。若 `corepack enable` 因写系统目录要管理员权限，改用 `corepack pnpm@10.33.0 install ...` 的调用形式，并把这条记进 `notes/p0-install.md`。

- [ ] **Step 2: 把缓存与二进制下载钉到 D:，GitHub 走代理**

```bash
cd "D:/Test/workbuddy/cyrene-verge"
mkdir -p /d/pnpm-store /d/npm-cache /d/electron-cache
export npm_config_cache="D:\\npm-cache"
export ELECTRON_CACHE="D:\\electron-cache"
export ELECTRON_BUYOUT_CACHE="D:\\electron-cache"
export HTTPS_PROXY="http://127.0.0.1:7896"
export HTTP_PROXY="http://127.0.0.1:7896"
```

Expected: 三个 D: 目录建立成功。**不**新建项目 `.npmrc`（避免第 6 处上游文件改动）。

- [ ] **Step 3: 安装并记录构建脚本的实际结果**

```bash
pnpm install --frozen-lockfile --store-dir "D:\\pnpm-store" 2>&1 | tee /d/verge-install.log
```

Expected: 退出码 0。若 `tree-sitter` / `sharp` 的 prebuild 拉取失败并回落到 node-gyp（本机无 VS Build Tools），执行 `pnpm install --frozen-lockfile --store-dir "D:\\pnpm-store" --ignore-scripts=tree-sitter,sharp` 并在 `notes/p0-install.md` 写下这条偏离与影响面（`llamaindex`/RAG 属 spec §4.2 排除项，`core-bootstrap.ts:147-153` 已把 `initRag` 失败降级为日志，不阻塞启动）。

- [ ] **Step 4: 跑既有测试建立绿色基线**

```bash
pnpm test 2>&1 | tail -30
```

Expected: `559 tests` 全绿（spec §3-15 的基线）。任何一条红都要先记录、不要在 P0 里修上游测试。

- [ ] **Step 5: 构建并起窗**

```bash
pnpm run build:main && pnpm run build:preload && pnpm run build:renderer
pnpm dev
```

Expected: 宠物窗与聊天窗出现；stderr 无 `Cannot find module` / 原生模块加载失败。这一步就是 spec §9-1 的实测答案，把 `du -sh node_modules dist` 的占用一并记进 `notes/p0-install.md`（R2）。

- [ ] **Step 6: Commit（P0 的第一条）**

```bash
git add docs/verge/plans/notes/p0-install.md
git commit -m "build(verge): 记录依赖安装实测与构建脚本偏离"
```

---

## Task 2: 关掉启动更新排期（R1）

**Files:**
- Create: `src/main/updater/update-policy.ts`
- Create: `src/main/updater/update-policy.test.ts`
- Modify: `src/main/application/default-dependencies.ts:886-889`（`scheduleUpdateCheck`）

**Interfaces:**
- Consumes: 无
- Produces: `shouldScheduleStartupUpdateCheck(input: UpdateCheckPolicyInput): boolean`，`UpdateCheckPolicyInput = { isPackaged: boolean; forkAutoUpdateDisabled: boolean }`。

- [ ] **Step 1: 写失败的测试**

```ts
// src/main/updater/update-policy.test.ts
import { describe, expect, it } from "vitest";
import { FORK_AUTO_UPDATE_DISABLED, shouldScheduleStartupUpdateCheck } from "./update-policy";

describe("shouldScheduleStartupUpdateCheck", () => {
  it("fork 关掉了自动更新时，打包版也不排期启动检查", () => {
    expect(
      shouldScheduleStartupUpdateCheck({ isPackaged: true, forkAutoUpdateDisabled: true }),
    ).toBe(false);
  });

  it("正对照：闸门打开且已打包时才排期（防止把判据写反）", () => {
    expect(
      shouldScheduleStartupUpdateCheck({ isPackaged: true, forkAutoUpdateDisabled: false }),
    ).toBe(true);
  });

  it("未打包永远不排期（沿用上游 isPackaged 短路）", () => {
    expect(
      shouldScheduleStartupUpdateCheck({ isPackaged: false, forkAutoUpdateDisabled: false }),
    ).toBe(false);
  });

  it("fork 的默认值必须是关掉", () => {
    expect(FORK_AUTO_UPDATE_DISABLED).toBe(true);
  });
});
```

- [ ] **Step 2: 跑到红**

```bash
pnpm vitest run src/main/updater/update-policy.test.ts
```

Expected: FAIL（`Cannot find module './update-policy'`）。

- [ ] **Step 3: 最小实现**

```ts
// src/main/updater/update-policy.ts
/**
 * fork 的更新策略闸门。
 *
 * `electron-updater` 检查的是上游仓库的 release：fork 一旦让它排期，
 * 用户会被静默升回上游版本，本地这些 verge 模块连同像素猫一起消失。
 * 发布在 fork 侧走手工打包，所以这里默认关闭排期；
 * 手动检查/下载/安装的 IPC 保留（那是显式动作，不是静默行为）。
 */
export const FORK_AUTO_UPDATE_DISABLED = true;

export interface UpdateCheckPolicyInput {
  isPackaged: boolean;
  forkAutoUpdateDisabled: boolean;
}

export function shouldScheduleStartupUpdateCheck(input: UpdateCheckPolicyInput): boolean {
  if (input.forkAutoUpdateDisabled) return false;
  return input.isPackaged;
}
```

- [ ] **Step 4: 接到装配点并跑到绿**

`src/main/application/default-dependencies.ts` 的 `scheduleUpdateCheck` 改为：

```ts
      scheduleUpdateCheck: async () => {
        if (!shouldScheduleStartupUpdateCheck({
          isPackaged: app.isPackaged,
          forkAutoUpdateDisabled: FORK_AUTO_UPDATE_DISABLED,
        })) {
          return { dispose: () => {} };
        }
        const dispose = scheduleStartupUpdateCheck(core.services.update);
        return { dispose };
      },
```

并在文件头 import 区加：

```ts
import { FORK_AUTO_UPDATE_DISABLED, shouldScheduleStartupUpdateCheck } from "../updater/update-policy";
```

```bash
pnpm vitest run src/main/updater
```

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/main/updater/update-policy.ts src/main/updater/update-policy.test.ts src/main/application/default-dependencies.ts
git commit -m "fix(verge): 关闭 fork 的启动更新排期"
```

---

## Task 3: 实例身份与 userData 隔离（R6）

**Files:**
- Create: `src/main/app-identity.ts`
- Create: `src/main/app-identity.test.ts`
- Modify: `src/main/application/pre-ready.ts`（新增 `configureIdentity()` 依赖并在取锁前调用）
- Modify: `src/main/application/default-dependencies.ts:306-308`（注入实现）

**Interfaces:**
- Consumes: 无
- Produces:
  - `const VERGE_INSTANCE_NAME = "cyrene-verge"`
  - `resolveAppUserDataPath(appDataDir: string, name?: string): string`
  - `configureVergeIdentity(app: IdentityApp, appDataDir: string): { name: string; userDataPath: string }`
  - `PreReadyDependencies` 新增 `configureIdentity(): void`

- [ ] **Step 1: 写失败的测试**

```ts
// src/main/app-identity.test.ts
import { describe, expect, it, vi } from "vitest";
import { resolveAppUserDataPath, configureVergeIdentity, VERGE_INSTANCE_NAME } from "./app-identity";

describe("app-identity", () => {
  it("userData 目录落在独立的 cyrene-verge 下", () => {
    expect(resolveAppUserDataPath("C:/AppData/Roaming")).toContain(VERGE_INSTANCE_NAME);
    expect(resolveAppUserDataPath("C:/AppData/Roaming")).not.toMatch(/[/\\]Cyrene[/\\]?$/);
  });

  it("正对照：显式传 name 时按传入值拼路径（证明拼接用的是 name 而不是常量）", () => {
    expect(resolveAppUserDataPath("C:/AppData/Roaming", "probe-name")).toBe(
      "C:/AppData/Roaming/probe-name".replace(/\//g, require("node:path").sep),
    );
  });

  it("配置身份时 setName 与 setPath 都被调用且顺序为 name→userData", () => {
    const calls: string[] = [];
    const app = {
      setName: (n: string) => { calls.push(`setName:${n}`); },
      setPath: (k: string, p: string) => { calls.push(`setPath:${k}:${p.split(/[\\/]/).pop()}`); },
    };
    const result = configureVergeIdentity(app, "C:/AppData/Roaming");
    expect(calls).toEqual([`setName:${VERGE_INSTANCE_NAME}`, `setPath:userData:${VERGE_INSTANCE_NAME}`]);
    expect(result.name).toBe(VERGE_INSTANCE_NAME);
    expect(vi.isCallNotFn).toBeTypeOf("function");
  });
});
```

> 注：最后一条 `vi.isCallNotFn` 断言是排版占位检查，实现阶段若该 API 不存在请删掉这一行（不要为此改产品代码）——它的唯一作用是逼写测试的人真正跑一遍而不是盲提交。

- [ ] **Step 2: 跑到红**

```bash
pnpm vitest run src/main/app-identity.test.ts
```

Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

```ts
// src/main/app-identity.ts
import path from "node:path";

/**
 * fork 的进程身份。
 *
 * 单实例锁与 userData 目录都取自应用名。不改身份的话，`verge` 分支启动时会
 * 被已安装的上游 Cyrene 判为「第二实例」而直接退出（`app.requestSingleInstanceLock`
 * 按名字建锁），反过来也会把上游那份踢下线。双轨期间两套账本必须各写各的。
 */
export const VERGE_INSTANCE_NAME = "cyrene-verge";

export function resolveAppUserDataPath(appDataDir: string, name: string = VERGE_INSTANCE_NAME): string {
  return path.join(appDataDir, name);
}

export interface IdentityApp {
  setName(name: string): void;
  setPath(key: "userData", value: string): void;
}

export function configureVergeIdentity(
  app: IdentityApp,
  appDataDir: string,
): { name: string; userDataPath: string } {
  const userDataPath = resolveAppUserDataPath(appDataDir);
  app.setName(VERGE_INSTANCE_NAME);
  app.setPath("userData", userDataPath);
  return { name: VERGE_INSTANCE_NAME, userDataPath };
}
```

- [ ] **Step 4: 接进 pre-ready，保证在取锁之前**

`pre-ready.ts`：

```ts
export interface PreReadyDependencies {
  /** 必须先于 installSingleInstance：单实例锁与 userData 都按应用名解析。 */
  configureIdentity(): void;
  installSingleInstance(onSecondInstance: () => void): boolean;
  ...
}

export function prepareBeforeReady(deps: PreReadyDependencies): PreReadyResult {
  deps.configureIdentity();

  const isPrimary = deps.installSingleInstance(() => {
    deps.activation.request({ kind: "chat" });
  });
  ...
}
```

`default-dependencies.ts` 的 `prepare:` 体内加一行（紧随 `return { app, dialog, ...` 之后的对象里）：

```ts
      configureIdentity: () => {
        configureVergeIdentity(app, app.getPath("appData"));
      },
```

> 后果要写进实测记录：身份一改，`migrateLegacyUserData()` 的搬运目标变成 `cyrene-verge`，首次启动会从旧目录复制一份数据过来。这是期望行为（fork 不与上游抢账本），但必须肉眼确认复制成功。

- [ ] **Step 5: 验证 + 屏幕层取证**

```bash
pnpm vitest run src/main/app-identity.test.ts
rm -rf "$APPDATA/cyrene-verge"
pnpm dev &
sleep 12
ls "$APPDATA" | grep -i "cyrene"
```

Expected: 同时存在 `Cyrene`（上游，未被动过）与 `cyrene-verge`（新目录）。只出现 `Cyrene` 判 FAIL——说明身份没生效，锁会被上游抢占。关掉上游 Cyrene 后再起一次 fork，两个进程不得互相踢下线。

- [ ] **Step 6: Commit**

```bash
git add src/main/app-identity.ts src/main/app-identity.test.ts src/main/application/pre-ready.ts src/main/application/default-dependencies.ts
git commit -m "fix(verge): 隔离 fork 的实例身份与用户数据目录"
```

---

## Task 4: `src/main/verge/` 三段骨架挂上装配点

**Files:**
- Create: `src/main/verge/types.ts`、`verge-store.ts`、`verge-service.ts`、`verge-ipc.ts`、`bootstrap.ts`
- Create: `src/main/verge/verge-store.test.ts`
- Modify: `src/shared/ipc-channels.ts`（新增 `VERGE_GET_SNAPSHOT`）
- Modify: `src/preload/index.ts`（`window.verge` 白名单）
- Modify: `src/main/application/core-bootstrap.ts:39-55`（`CoreServices.verge`）
- Modify: `src/main/application/default-dependencies.ts:471-494`（建服务 + return 字段）、`registerCoreIpc`（注册）、`shutdown.register`

**Interfaces:**
- Consumes: `IpcScope`（`application/ipc-scope.ts`）、`renameWithRetrySync`（`storage/rename-with-retry.ts:7`）
- Produces:
  - `bootstrapVergeService(opts: { userDataDir: string }): VergeBootstrap`
  - `VergeBootstrap = { service: VergeService; dispose(): void }`
  - `VergeService.getSnapshot(): VergeSnapshot`
  - `VergeSnapshot = { module: "verge"; ready: true; statePath: string; quietUntil: number | null }`
  - `readVergeState(dir: string): VergeState` / `writeVergeState(dir: string, state: VergeState): void`
  - IPC：`IPC.VERGE_GET_SNAPSHOT = "verge:get-snapshot"`，preload `window.verge.getSnapshot()`

- [ ] **Step 1: 写失败的测试（存储的原子性与自愈）**

```ts
// src/main/verge/verge-store.test.ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readVergeState, writeVergeState, VERGE_STATE_FILE } from "./verge-store";

const dirs: string[] = [];
function freshDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "verge-state-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("verge-store", () => {
  it("首次读取没有文件时给默认状态（藏身默认开，同 native）", () => {
    const state = readVergeState(freshDir());
    expect(state).toEqual({ quietUntil: null, tuckEnabled: true, tuckHinted: false });
  });

  it("写盘落在 userData/verge/state.json 且能被读回", () => {
    const dir = freshDir();
    writeVergeState(dir, { quietUntil: 1234, tuckEnabled: false, tuckHinted: true });
    expect(VERGE_STATE_FILE).toBe(path.join("verge", "state.json"));
    expect(readVergeState(dir)).toEqual({ quietUntil: 1234, tuckEnabled: false, tuckHinted: true });
  });

  it("正对照：坏 JSON 不炸启动，退回默认值（读盘自愈）", () => {
    const dir = freshDir();
    writeVergeState(dir, { quietUntil: 1, tuckEnabled: true, tuckHinted: false });
    const { appendFileSync } = require("node:fs");
    appendFileSync(path.join(dir, VERGE_STATE_FILE), "{ 这不是 JSON");
    expect(readVergeState(dir).tuckEnabled).toBe(true);
  });

  it("quietUntil 必须是数字，脏值一律当 null（免打扰不许被一个字符串永久钉住）", () => {
    const dir = freshDir();
    writeVergeState(dir, { quietUntil: null, tuckEnabled: true, tuckHinted: false });
    const { writeFileSync } = require("node:fs");
    writeFileSync(path.join(dir, VERGE_STATE_FILE), JSON.stringify({ quietUntil: "forever" }));
    expect(readVergeState(dir).quietUntil).toBeNull();
  });
});
```

- [ ] **Step 2: 跑到红**

```bash
pnpm vitest run src/main/verge
```

Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现存储、服务、IPC、装配**

```ts
// src/main/verge/verge-store.ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { renameWithRetrySync } from "../storage/rename-with-retry";

export const VERGE_STATE_FILE = path.join("verge", "state.json");

export interface VergeState {
  /** 免打扰到期时刻（本地 epoch ms）。null = 不在安静期。 */
  quietUntil: number | null;
  /** 贴边藏身开关。native 侧手写 Default 为 true，这里保持同口径。 */
  tuckEnabled: boolean;
  /** 「第一次藏身先解释一句」的凭据，跨重启只说一次。 */
  tuckHinted: boolean;
}

export const DEFAULT_VERGE_STATE: VergeState = {
  quietUntil: null,
  tuckEnabled: true,
  tuckHinted: false,
};

function toState(raw: unknown): VergeState {
  if (typeof raw !== "object" || raw === null) return { ...DEFAULT_VERGE_STATE };
  const input = raw as Record<string, unknown>;
  return {
    quietUntil: typeof input.quietUntil === "number" && Number.isFinite(input.quietUntil)
      ? input.quietUntil
      : null,
    tuckEnabled: typeof input.tuckEnabled === "boolean" ? input.tuckEnabled : DEFAULT_VERGE_STATE.tuckEnabled,
    tuckHinted: input.tuckHinted === true,
  };
}

export function readVergeState(userDataDir: string): VergeState {
  const file = path.join(userDataDir, VERGE_STATE_FILE);
  try {
    return toState(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return { ...DEFAULT_VERGE_STATE };
  }
}

/** 原子写：先落同目录 `.tmp` 再 rename。native 的账本被半截写过，这里不重演。 */
export function writeVergeState(userDataDir: string, state: VergeState): void {
  const dir = path.join(userDataDir, path.dirname(VERGE_STATE_FILE));
  mkdirSync(dir, { recursive: true });
  const target = path.join(userDataDir, VERGE_STATE_FILE);
  const tmp = `${target}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
  renameWithRetrySync(tmp, target);
}
```

```ts
// src/main/verge/types.ts
export interface VergeSnapshot {
  module: "verge";
  ready: true;
  statePath: string;
  quietUntil: number | null;
}
```

```ts
// src/main/verge/verge-service.ts
import path from "node:path";
import { readVergeState, writeVergeState, VERGE_STATE_FILE, type VergeState } from "./verge-store";
import type { VergeSnapshot } from "./types";

export interface VergeService {
  getSnapshot(): VergeSnapshot;
  getState(): VergeState;
  setQuietUntil(until: number | null): void;
  setTuckEnabled(enabled: boolean): void;
  markTuckHinted(): void;
}

export function createVergeService(userDataDir: string): VergeService {
  let state = readVergeState(userDataDir);
  const persist = () => writeVergeState(userDataDir, state);

  return {
    getSnapshot: () => ({
      module: "verge",
      ready: true,
      statePath: path.join(userDataDir, VERGE_STATE_FILE),
      quietUntil: state.quietUntil,
    }),
    getState: () => ({ ...state }),
    setQuietUntil: (until) => { state = { ...state, quietUntil: until }; persist(); },
    setTuckEnabled: (enabled) => { state = { ...state, tuckEnabled: enabled }; persist(); },
    markTuckHinted: () => { state = { ...state, tuckHinted: true }; persist(); },
  };
}
```

```ts
// src/main/verge/verge-ipc.ts
import { IPC } from "../../shared/ipc-channels";
import type { IpcScope } from "../application/ipc-scope";
import type { VergeService } from "./verge-service";

export function registerVergeIpc(ipc: IpcScope, service: VergeService): () => void {
  ipc.handle(IPC.VERGE_GET_SNAPSHOT, () => service.getSnapshot());
  return () => ipc.removeHandler(IPC.VERGE_GET_SNAPSHOT);
}
```

```ts
// src/main/verge/bootstrap.ts
import { createVergeService, type VergeService } from "./verge-service";

export interface VergeBootstrap {
  service: VergeService;
  dispose(): void;
}

/**
 * 装配 verge 内建模块。
 *
 * 这里不连 mihomo、不起采样循环：P0 只要骨架挂上装配点并且不拖慢启动。
 * 数据面的连接在 P2 的 `watchers` 里按 background 阶段起。
 */
export function bootstrapVergeService(input: {
  userDataDir: string;
  ipc: { handle: (c: string, l: (...a: unknown[]) => unknown) => void; removeHandler: (c: string) => void };
}): VergeBootstrap {
  const service = createVergeService(input.userDataDir);
  const disposeIpc = registerVergeIpc(input.ipc as never, service);
  return { service, dispose: disposeIpc };
}
```

`src/shared/ipc-channels.ts` 在 `PET_ZOOM` 附近加：

```ts
  VERGE_GET_SNAPSHOT: "verge:get-snapshot",
```

`src/preload/index.ts` 加一个显式白名单面（放在 `cyreneApi` 之后、`contextBridge.exposeInMainWorld("cyrene", …)` 附近）：

```ts
const vergeApi = {
  getSnapshot: () => ipcRenderer.invoke(IPC.VERGE_GET_SNAPSHOT),
};
contextBridge.exposeInMainWorld("verge", vergeApi);
```

`core-bootstrap.ts` 的 `CoreServices` 加字段：

```ts
  verge: import("../verge/verge-service").VergeService;
```

`default-dependencies.ts`：在 `const music = bootstrapMusicService(resolveMusicPaths());` 之后加

```ts
        const verge = createVergeService(app.getPath("userData"));
```

在 return 对象里 `music,` 之前加 `verge,`。在 `registerCoreIpc` 体内（`registerNewsIpc(ipc);` 之后）加：

```ts
        registerVergeIpc(ipc, services.verge);
```

在同文件已有的 shutdown 注册区（`:720` 附近那条 `browser-panel-session` 旁边）加：

```ts
        shutdown.register({
          id: "verge-state",
          phase: "flushPersistence",
          dispose: async () => { /* P2 起在此刷帐本；骨架期状态是即时原子写，无缓冲 */ },
        });
```

- [ ] **Step 4: 跑护栏与全量测试**

```bash
pnpm vitest run src/main/verge src/main/application/ipc-contract.test.ts
pnpm test
```

Expected: `verge-store` 4 条 PASS；`ipc-contract` 7 条 PASS（`verge:get-snapshot` 三向一致且从 `src/main/index.ts` 可达）；全量测试不低于 Step 4 of Task 1 的基线。

- [ ] **Step 5: 屏幕层确认猫窗未受影响**

```bash
pnpm dev
```

Expected: Live2D 模型照常出现、可拖可点。这是 P0 退出条件里「猫窗未受影响」的判据——不要用「看起来正常」代替：确认 `%APPDATA%\cyrene-verge\verge\state.json` 存在（说明服务真被装配了）。

- [ ] **Step 6: Commit**

```bash
git add src/main/verge src/shared/ipc-channels.ts src/preload/index.ts src/main/application/core-bootstrap.ts src/main/application/default-dependencies.ts
git commit -m "build(verge): 接入内建模块骨架"
```

> P0 退出条件核对：`ipc-contract.test.ts` 绿、猫窗未受影响、`git log` 上 P0 的收尾提交是 `build(verge): 接入内建模块骨架`（Task 1–3 的记录性提交在其前）。

---

# P1 — 像素猫进壳

## Task 5: 窗口层尖峰（spec §9-3 / §9-4）

**Files:**
- Create: `docs/verge/spikes/p1-window.md`
- Create: `src/main/verge/geom-probe.ts` + `geom-probe.test.ts`
- Modify: `src/main/windows/window-manager.ts`（把解析后的 bounds 打到 stderr）

**Interfaces:**
- Consumes: `IPC.WINDOW_MOVE_TO` 现有链路
- Produces: `formatGeomProbe(input: GeomProbeInput): string` —— 一行 `GEOM\t…` 格式的取证文本，供主进程 stderr 与后续尺读取。

- [ ] **Step 1: 写探针行的失败测试**

```ts
// src/main/verge/geom-probe.test.ts
import { describe, expect, it } from "vitest";
import { formatGeomProbe } from "./geom-probe";

describe("formatGeomProbe", () => {
  it("按 native 的 GEOM 行口径输出，字段顺序固定", () => {
    expect(
      formatGeomProbe({
        t: 12.5, applied: { x: 1800, y: 640 }, actual: { x: 1800, y: 640, width: 82, height: 108 },
        pin: { x: 41.0, y: 39.0 }, center: { x: 24.0, y: 43.0 }, peekDx: 0, e: 0, dpr: 1.5,
      }),
    ).toBe("GEOM\t12.5\tapplied 1800,640\tactual 1800,640 82x108\tpin 41.0,39.0\tcenter 24.0,43.0\tpeek 0.0\te 0.00\tdpr 1.50");
  });

  it("applied 与 actual 不一致时两列都要打出来（这是 native 那次「整窗空白」的取证前提）", () => {
    const line = formatGeomProbe({
      t: 1, applied: { x: 100, y: 100 }, actual: { x: 104, y: 96, width: 82, height: 108 },
      pin: { x: 41, y: 39 }, center: { x: 24, y: 43 }, peekDx: 0, e: 0, dpr: 1,
    });
    expect(line).toContain("applied 100,100");
    expect(line).toContain("actual 104,96");
  });
});
```

- [ ] **Step 2: 跑到红 → Step 3: 实现**

```ts
// src/main/verge/geom-probe.ts
export interface GeomProbeInput {
  t: number;
  applied: { x: number; y: number };
  actual: { x: number; y: number; width: number; height: number };
  pin: { x: number; y: number };
  center: { x: number; y: number };
  peekDx: number;
  e: number;
  dpr: number;
}

/** 与 native `main.rs:4392` 的 GEOM 行同构，字段顺序不许改（屏幕尺按位读）。 */
export function formatGeomProbe(input: GeomProbeInput): string {
  const f1 = (v: number) => v.toFixed(1);
  const f2 = (v: number) => v.toFixed(2);
  return [
    "GEOM",
    f1(input.t),
    `applied ${Math.round(input.applied.x)},${Math.round(input.applied.y)}`,
    `actual ${Math.round(input.actual.x)},${Math.round(input.actual.y)} ${Math.round(input.actual.width)}x${Math.round(input.actual.height)}`,
    `pin ${f1(input.pin.x)},${f1(input.pin.y)}`,
    `center ${f1(input.center.x)},${f1(input.center.y)}`,
    `peek ${f1(input.peekDx)}`,
    `e ${f2(input.e)}`,
    `dpr ${f2(input.dpr)}`,
  ].join("\t");
}
```

Expected: 两条 PASS。

- [ ] **Step 4: 尖峰实测并落档**

在 dev 下把宠物窗临时改成 82×108（`PET_WINDOW_BASE_*` 常量先改成 82/108 再跑，Task 7 才正式落）：`VERGE_GEOM_PROBE=1 pnpm dev`，把下列四问的答案写进 `docs/verge/spikes/p1-window.md`：

1. 125% / 150% 缩放下 `win.getSize()`（DIP）与 `win.getContentBounds()`、屏幕截图像素宽的换算关系；`devicePixelRatio` 读到的值与 `formatGeomProbe` 的 `dpr` 是否一致。
2. `setIgnoreMouseEvents(true, { forward: true })` 在 82×108 透明窗上的实际穿透边界：把鼠标放到窗内透明处点桌面图标，能否命中桌面（穿透成立）；放到猫身上能否命中窗（不成立）。
3. `win.setBounds()` 连续改变宽度（82 → 248）时 Windows DWM 是否留残影；已有的 canvas 快照 overlay 手段（`renderer/main.ts:239-269`）能否等效压住。
4. `capturePage()` 取到的 PNG 是否保留 alpha 通道（像素尺与 2D 命中都靠它）。

- [ ] **Step 5: Commit**

```bash
git add docs/verge/spikes/p1-window.md src/main/verge/geom-probe.ts src/main/verge/geom-probe.test.ts
git commit -m "docs(verge): 记录 82x108 透明窗的 DPI 与穿透实测"
```

---

## Task 6: `pet-geometry.ts` 纯函数（原生几何的逐位复现）

**Files:**
- Create: `src/shared/pet-geometry.ts`、`src/shared/pet-geometry.test.ts`

**Interfaces:**
- Consumes: 无（零依赖，纯数）
- Produces（P1/P2 全部坐标尺的基座）:
  - 常量 `PET_W=82 PET_H=108 OPEN_W=248 OPEN_H=482 BUB_W=172 PIN={x:41,y:39} EDGE_MARGIN=4`
  - `scaleFor(e: number): { u: number; s: number }`
  - `computePetLayout(input: PetLayoutInput): PetLayout`
  - `computeCatRect(input: CatRectInput): Rect`
  - `resolveGrowthDirection(input: GrowthInput): { growUp: boolean; growLeft: boolean }`
  - 类型 `Point / Rect / WorkArea / PetLayout`

- [ ] **Step 1: 写失败的测试（手算锚点，全部来自 native 常量）**

```ts
// src/shared/pet-geometry.test.ts
import { describe, expect, it } from "vitest";
import {
  BUB_W, EDGE_MARGIN, OPEN_H, OPEN_W, PET_H, PET_W, PIN,
  computeCatRect, computePetLayout, resolveGrowthDirection, scaleFor,
} from "./pet-geometry";

const wa = { x: 0, y: 0, width: 1920, height: 1040 };

describe("pet-geometry 常量", () => {
  it("钉位点与四档尺寸照抄 native", () => {
    expect({ PET_W, PET_H, OPEN_W, OPEN_H, BUB_W, PIN }).toEqual({
      PET_W: 82, PET_H: 108, OPEN_W: 248, OPEN_H: 482, BUB_W: 172, PIN: { x: 41, y: 39 },
    });
    expect(EDGE_MARGIN).toBe(4);
  });

  it("u 在收起/展开两档分别是 37 / 32，s = u/60", () => {
    expect(scaleFor(0)).toEqual({ u: 37, s: 37 / 60 });
    expect(scaleFor(1)).toEqual({ u: 32, s: 32 / 60 });
  });
});

describe("computePetLayout", () => {
  it("g=0 时窗口精确回到 82×108、原点即猫位（native 注释的同一条要求）", () => {
    const layout = computePetLayout({
      catOrigin: { x: 1800, y: 900 }, e: 0, be: 0, growLeft: false, growUp: false,
      workArea: wa, peekDx: 0,
    });
    expect(layout.size).toEqual({ width: 82, height: 108 });
    expect(layout.pos).toEqual({ x: 1800, y: 900 });
  });

  it("面板向下向右展开：原点按 pin - anchor，尺寸线性插值", () => {
    const layout = computePetLayout({
      catOrigin: { x: 1000, y: 400 }, e: 1, be: 0, growLeft: false, growUp: false,
      workArea: wa, peekDx: 0,
    });
    expect(layout.size).toEqual({ width: 248, height: 482 });
    expect(layout.pos).toEqual({ x: 1000 + 41 - 41, y: 400 + 39 - 39 });
    expect(layout.anchor).toEqual({ x: 41, y: 39 });
  });

  it("growUp 时锚点 y = OPEN_H - 4 - 51.5*(29/60)（影子离窗口底 4px）", () => {
    const layout = computePetLayout({
      catOrigin: { x: 100, y: 500 }, e: 1, be: 0, growLeft: false, growUp: true,
      workArea: { x: 0, y: 0, width: 1920, height: 1200 }, peekDx: 0,
    });
    expect(layout.anchor.y).toBeCloseTo(482 - 4 - 51.5 * (29 / 60), 6);
  });

  it("growLeft 时锚点 x = OPEN_W - PIN.x，右缘成为不动边", () => {
    const layout = computePetLayout({
      catOrigin: { x: 1700, y: 400 }, e: 1, be: 0, growLeft: true, growUp: false,
      workArea: wa, peekDx: 0,
    });
    expect(layout.anchor.x).toBe(248 - 41);
    expect(layout.pos.x).toBeCloseTo(1700 + 41 - 207, 6);
  });

  it("夹紧只按 g 生效：g=0 的收起态绝不因夹紧搬窗（胶囊与藏身都靠这条）", () => {
    const layout = computePetLayout({
      catOrigin: { x: 1878, y: 1000 }, e: 0, be: 0, growLeft: false, growUp: false,
      workArea: wa, peekDx: 0,
    });
    expect(layout.pos).toEqual({ x: 1878, y: 1000 });
    expect(layout.clampDelta).toEqual({ x: -40, y: -68 });
  });

  it("气泡档：g=be，尺寸只撑到 172 宽、108 高", () => {
    const layout = computePetLayout({
      catOrigin: { x: 1700, y: 900 }, e: 0, be: 1, growLeft: true, growUp: false,
      workArea: wa, peekDx: 0,
    });
    expect(layout.size).toEqual({ width: 172, height: 108 });
    expect(layout.anchor.x).toBe(172 - 41);
  });

  it("peekDx 只进绘制偏移，不进窗口原点（native 的「猫直接消失」教训）", () => {
    const withPeek = computePetLayout({
      catOrigin: { x: 1836, y: 900 }, e: 0, be: 0, growLeft: false, growUp: false,
      workArea: wa, peekDx: 40,
    });
    expect(withPeek.pos.x).toBe(1876);
    expect(withPeek.pinInWin.x).toBeCloseTo(1, 6);
  });
});

describe("computeCatRect", () => {
  it("收起态包围盒落在 82×108 窗口内，底部 32px 留给胶囊", () => {
    const rect = computeCatRect({ pinInWin: { x: 41, y: 39 }, e: 0 });
    expect(rect.x).toBeCloseTo(41 - 37 - 17 * (37 / 60) + 17 * (37 / 60), 6);
    expect(rect.width).toBeCloseTo(74, 6);
    expect(rect.height).toBeCloseTo(68.45, 2);
    expect(rect.y + rect.height).toBeLessThanOrEqual(108 - 32 + 0.5);
  });
});

describe("resolveGrowthDirection", () => {
  it("向下放得下就向下（默认方向不许变）", () => {
    expect(
      resolveGrowthDirection({ catOrigin: { x: 100, y: 100 }, workArea: wa, current: { growUp: false, growLeft: false } }),
    ).toEqual({ growUp: false, growLeft: false });
  });

  it("底部不够、顶部够 → 翻向上", () => {
    expect(
      resolveGrowthDirection({ catOrigin: { x: 100, y: 600 }, workArea: wa, current: { growUp: false, growLeft: false } }),
    ).toEqual({ growUp: true, growLeft: false });
  });

  it("右边不够、左边够 → 翻向左", () => {
    expect(
      resolveGrowthDirection({ catOrigin: { x: 1700, y: 100 }, workArea: wa, current: { growUp: false, growLeft: false } }),
    ).toEqual({ growUp: false, growLeft: true });
  });

  it("两头都放不下 → 选空间大的一侧", () => {
    expect(
      resolveGrowthDirection({
        catOrigin: { x: 900, y: 470 },
        workArea: { x: 0, y: 0, width: 1920, height: 560 },
        current: { growUp: false, growLeft: false },
      }).growUp,
    ).toBe(false);
  });
});
```

- [ ] **Step 2: 跑到红**

```bash
pnpm vitest run src/shared/pet-geometry.test.ts
```

Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

```ts
// src/shared/pet-geometry.ts
/**
 * 猫窗几何的唯一出处。
 *
 * 逐位对应 native `main.rs` 的展开协议（:4241-4306）与绘制中心反推（:4377-4409）。
 * 这些数字不是审美选择：所有屏幕尺都按它们量，改一个数等于作废一批验收器。
 * 单位为 DIP（Electron 逻辑像素），与 native 的 egui 逻辑像素同一坐标系。
 */

export const PET_W = 82.0;
export const PET_H = 108.0;
export const OPEN_W = 248.0;
export const OPEN_H = 482.0;
export const BUB_W = 172.0;
/** 猫内容中心在收起窗口内的位置；窗口绕它长，拖拽与展开都不动它。 */
export const PIN = { x: 41.0, y: 39.0 };
export const EDGE_MARGIN = 4.0;

export interface Point { x: number; y: number }
export interface Size { width: number; height: number }
export interface Rect { x: number; y: number; width: number; height: number }
export interface WorkArea extends Rect {}

export interface PetLayoutInput {
  /** 收起档窗口原点（native 的 `pet_pos`）。 */
  catOrigin: Point;
  /** 面板展开度 0..1。P1 只取 0/1 两档（步进 resize），但函数支持连续值供 P2 动画复用。 */
  e: number;
  /** 气泡展开度 0..1。 */
  be: number;
  growLeft: boolean;
  growUp: boolean;
  workArea: WorkArea;
  /** 贴边藏身的窥视偏移，只进绘制偏移。 */
  peekDx: number;
}

export interface PetLayout {
  size: Size;
  pos: Point;
  anchor: Point;
  /** 夹紧把窗口往里推了多少（未乘 g）。 */
  clampDelta: Point;
  /** 猫内容中心在窗口内的位置（夹紧随 g 生效后）。 */
  pinInWin: Point;
  g: number;
}

export function scaleFor(e: number): { u: number; s: number } {
  const u = 37.0 + (32.0 - 37.0) * e;
  return { u, s: u / 60.0 };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(hi, lo));

export function computePetLayout(input: PetLayoutInput): PetLayout {
  const { catOrigin, e, be, growLeft, growUp, workArea, peekDx } = input;

  const usingPanel = e > 0.001;
  const targetW = usingPanel ? OPEN_W : BUB_W;
  const targetH = usingPanel ? OPEN_H : PET_H;
  const g = usingPanel ? e : be;

  const anchor: Point = usingPanel
    ? {
        x: growLeft ? OPEN_W - PIN.x : PIN.x,
        y: growUp ? OPEN_H - EDGE_MARGIN - 51.5 * (29.0 / 60.0) : PIN.y,
      }
    : { x: growLeft ? BUB_W - PIN.x : PIN.x, y: PIN.y };

  const pinScreen = { x: catOrigin.x + PIN.x, y: catOrigin.y + PIN.y };
  const unclamped = { x: pinScreen.x - anchor.x, y: pinScreen.y - anchor.y };
  const clamped = {
    x: clamp(unclamped.x, workArea.x, workArea.x + workArea.width - targetW),
    y: clamp(unclamped.y, workArea.y, workArea.y + workArea.height - targetH),
  };
  const clampDelta = { x: clamped.x - unclamped.x, y: clamped.y - unclamped.y };

  const pin = { x: pinScreen.x + clampDelta.x * g, y: pinScreen.y + clampDelta.y * g };
  const catInWin = { x: PIN.x + (anchor.x - PIN.x) * g, y: PIN.y + (anchor.y - PIN.y) * g };
  const size = {
    width: PET_W + (targetW - PET_W) * g,
    height: PET_H + (targetH - PET_H) * g,
  };

  const rawPos = { x: pin.x - catInWin.x, y: pin.y - catInWin.y };
  const peeking = e < 0.05 && be < 0.05;
  const pos = peeking
    ? {
        x: clamp(rawPos.x + peekDx, workArea.x, workArea.x + workArea.width - size.width),
        y: rawPos.y,
      }
    : rawPos;

  return {
    size,
    pos,
    anchor,
    clampDelta,
    pinInWin: { x: pin.x - pos.x, y: pin.y - pos.y },
    g,
  };
}

/** 交互区：贴猫体，中点在绘制中心右 ~17s / 上 ~6s。 */
export function computeCatRect(input: { pinInWin: Point; e: number }): Rect {
  const { u, s } = scaleFor(input.e);
  const center = { x: input.pinInWin.x - 17.0 * s, y: input.pinInWin.y + 4.5 * s };
  const cx = center.x + 17.0 * s;
  const cy = center.y - 6.0 * s;
  return { x: cx - u, y: cy - (u * 1.85) / 2, width: u * 2.0, height: u * 1.85 };
}

export interface GrowthInput {
  catOrigin: Point;
  workArea: WorkArea;
  current: { growUp: boolean; growLeft: boolean };
  /** 判据用的目标宽度：面板档 248，气泡档 172（native 分两次判）。 */
  targetWidth?: number;
}

export function resolveGrowthDirection(input: GrowthInput): { growUp: boolean; growLeft: boolean } {
  const { catOrigin, workArea, current } = input;
  const top = workArea.y;
  const bottom = workArea.y + workArea.height;
  const left = workArea.x;
  const right = workArea.x + workArea.width;

  const fitsDown = catOrigin.y + PET_H + OPEN_H - PET_H <= bottom - EDGE_MARGIN;
  const fitsUp = catOrigin.y + PET_H - OPEN_H >= top + EDGE_MARGIN;
  const growUp = current.growUp
    ? fitsUp
    : fitsDown
      ? false
      : fitsUp && !fitsDown
        ? true
        : fitsDown && !fitsUp
          ? false
          : catOrigin.y + PET_H - top > bottom - catOrigin.y;

  const targetWidth = input.targetWidth ?? OPEN_W;
  const fitsRight = catOrigin.x + PET_W + (targetWidth - PET_W) <= right - EDGE_MARGIN;
  const fitsLeft = catOrigin.x + PET_W - targetWidth >= left + EDGE_MARGIN;
  const growLeft = current.growLeft
    ? fitsLeft
    : fitsRight
      ? false
      : fitsLeft && !fitsRight
        ? true
        : fitsRight && !fitsLeft
          ? false
          : catOrigin.x + PET_W - left > right - catOrigin.x;

  return { growUp, growLeft };
}
```

> `fitsDown` 写成 `catOrigin.y + OPEN_H <= bottom - EDGE_MARGIN` 的等价式（native 原式）；上面那行保留了 `+ PET_H - PET_H` 的推导痕迹，实现时化简为 `catOrigin.y + OPEN_H <= bottom - EDGE_MARGIN` 并保证测试仍绿——化简属于可读性，不改判据。

- [ ] **Step 4: 跑到绿**

```bash
pnpm vitest run src/shared/pet-geometry.test.ts
```

Expected: 全部 PASS。任何一条红都不要靠调期望值过关：期望值是从 native 抄的，红了说明实现抄错了。

- [ ] **Step 5: Commit**

```bash
git add src/shared/pet-geometry.ts src/shared/pet-geometry.test.ts
git commit -m "feat(verge): 落地下猫窗几何的纯函数判据"
```

---

## Task 7: 82×108 基址 + `PET_RESIZE` 通道（main 侧）

**Files:**
- Modify: `src/main/startup/create-pet-window.ts:6-7`（基址）、`:115-117`（dev 也开穿透）、`:63-79`（离屏判定改用 `computePetLayout` 的夹紧语义）
- Modify: `src/main/windows/window-manager.ts`（`setPetWindowBounds`、保留 `applyPetWindowZoom` 的 zoom 语义）
- Modify: `src/shared/ipc-channels.ts`（`VERGE_PET_RESIZE`）、`src/preload/index.ts`（`resizePetWindow`）、`src/main/windows/window-system-ipc.ts`（`ipc.on`）

**Interfaces:**
- Consumes: `computePetLayout`（Task 6）、`formatGeomProbe`（Task 5）
- Produces:
  - `WindowManager.setPetWindowBounds(bounds: { x: number; y: number; width: number; height: number }): void`（>0.5 去重，同 native `:4308-4315`）
  - preload `window.verge.resizePetWindow(bounds)` → `IPC.VERGE_PET_RESIZE = "verge:pet-resize"`
  - 常量导出改为 `PET_WINDOW_BASE_WIDTH = 82` / `PET_WINDOW_BASE_HEIGHT = 108`

- [ ] **Step 1: 写失败的测试（去重与锚定）**

```ts
// src/main/windows/pet-bounds.test.ts
import { describe, expect, it, vi } from "vitest";
import { shouldApplyBounds } from "./pet-bounds";

describe("shouldApplyBounds", () => {
  it("同一位置重复请求不发指令（native 的 >0.5 去重）", () => {
    expect(
      shouldApplyBounds({ x: 100, y: 100, width: 82, height: 108 }, { x: 100, y: 100, width: 82, height: 108 }),
    ).toBe(false);
  });

  it("0.4px 抖动忽略，0.6px 位移应用", () => {
    const base = { x: 100, y: 100, width: 82, height: 108 };
    expect(shouldApplyBounds(base, { ...base, x: 100.4 })).toBe(false);
    expect(shouldApplyBounds(base, { ...base, x: 100.6 })).toBe(true);
  });

  it("尺寸与位置各自独立判断（展开动画期间两条指令分别发）", () => {
    const base = { x: 100, y: 100, width: 82, height: 108 };
    expect(shouldApplyBounds(base, { ...base, width: 248, height: 482 })).toBe(true);
  });
});
```

- [ ] **Step 2: 跑到红**

```bash
pnpm vitest run src/main/windows/pet-bounds.test.ts
```

Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

```ts
// src/main/windows/pet-bounds.ts
export interface PetBounds { x: number; y: number; width: number; height: number }

const DRIFT_EPSILON = 0.5;

/** 位移与尺寸合起来的欧氏距离过阈才发指令，防止每帧空转 DWM。 */
export function shouldApplyBounds(current: PetBounds, next: PetBounds): boolean {
  const d = Math.hypot(next.x - current.x, next.y - current.y, next.width - current.width, next.height - current.height);
  return d > DRIFT_EPSILON;
}
```

`window-manager.ts` 内加方法（放在 `applyPetWindowZoom` 旁边）：

```ts
    setPetWindowBounds(bounds: { x: number; y: number; width: number; height: number }): void {
      const win = getUsablePetWindow();
      if (!win) return;
      const current = win.getBounds();
      if (!shouldApplyBounds(current, bounds)) return;
      win.setBounds(bounds, false);
      lastPetBounds = bounds;
      if (process.env.VERGE_GEOM_PROBE) {
        const actual = win.getBounds();
        console.error(formatGeomProbe({
          t: performance.now() / 1000,
          applied: bounds,
          actual,
          pin: PIN, center: { x: PIN.x - 17 * (37 / 60), y: PIN.y + 4.5 * (37 / 60) },
          peekDx: 0, e: 0, dpr: 1,
        }));
      }
    },
```

并在文件头加：

```ts
import { shouldApplyBounds } from "./pet-bounds";
import { formatGeomProbe } from "../verge/geom-probe";
import { PIN } from "../../shared/pet-geometry";
let lastPetBounds: { x: number; y: number; width: number; height: number } | null = null;
```

`window-system-ipc.ts` 加注册：

```ts
  ipc.on(IPC.VERGE_PET_RESIZE, (_event, bounds: { x: number; y: number; width: number; height: number }) => {
    deps.windowManager?.setPetWindowBounds(bounds);
  });
```

`src/shared/ipc-channels.ts`：`VERGE_PET_RESIZE: "verge:pet-resize",`
`src/preload/index.ts` 的 `vergeApi` 补：

```ts
  resizePetWindow: (bounds: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.send(IPC.VERGE_PET_RESIZE, bounds),
```

`create-pet-window.ts`：常量改 82/108，并把 `if (!ctx.isDev)` 的穿透条件去掉（dev 也要能验穿透——这是 Task 5 尖峰得出的第一手结论）。

- [ ] **Step 4: 跑到绿 + 实测起窗**

```bash
pnpm vitest run src/main/windows/pet-bounds.test.ts src/main/application/ipc-contract.test.ts
VERGE_GEOM_PROBE=1 pnpm dev 2> /d/verge-geom.log
grep -c "^GEOM" /d/verge-geom.log
```

Expected: 测试 PASS；日志里至少一行 `GEOM`，其 `actual 1800,900 82x108` 形态与 Task 5 的 DPI 结论一致。屏幕上看：猫以小窗出现，且不再占 400×500 的空白区（Live2D 模型此时会显示不全，属预期，Task 10 换渲染器后恢复）。

- [ ] **Step 5: Commit**

```bash
git add src/main/windows/pet-bounds.ts src/main/windows/pet-bounds.test.ts src/main/windows/window-manager.ts src/main/windows/window-system-ipc.ts src/main/startup/create-pet-window.ts src/shared/ipc-channels.ts src/preload/index.ts
git commit -m "feat(verge): 宠物窗改为 82x108 基址并打通尺寸通道"
```

---

## Task 8: 色板 token 与绘制指令模型

**Files:**
- Create: `src/renderer/pet/tokens.ts`、`tokens.test.ts`
- Create: `src/renderer/pet/ops.ts`、`ops.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `tokens.ts`：`ACCENT GREEN WARN PAPER INK INK_SOFT ROSE ROSE_DEEP PAPER_SHADE EYE BREAK_FILL BREAK_SOFT BREAK_EAR SHADOW BG_SOLID FG DIM ACCENT_DEEP ACCENT_FG ACCENT_HOVER TODAY_BAR GREEN_FG WARN_FG`（`Color` = `#rrggbb` 字符串 + alpha 分量分离），`wash(color, alpha, bg)`（sRGB 空间预混，见下）
  - `ops.ts`：`type DrawOp`、`paintOps(ctx: CanvasRenderingContext2D, ops: DrawOp[]): void`、`opsBounds(ops: DrawOp[]): Rect | null`

- [ ] **Step 1: 写失败的测试（token 台账 + 预混等价）**

```ts
// src/renderer/pet/tokens.test.ts
import { describe, expect, it } from "vitest";
import { ACCENT, BG_SOLID, GREEN, INK, PAPER, WARN, wash, hex } from "./tokens";

describe("视觉 token 台账", () => {
  it("品牌三色与奶油纸色逐字节等于 palette.rs", () => {
    expect(hex(ACCENT)).toBe("#5b8def");
    expect(hex(GREEN)).toBe("#4fb477");
    expect(hex(WARN)).toBe("#d97757");
    expect(hex(PAPER)).toBe("#f7f4ec");
    expect(hex(INK)).toBe("#2b2f3a");
    expect(hex(BG_SOLID)).toBe("#101420");
  });

  it("wash 的预混结果与 native panel.rs 的 CARD/SEP/CARD_STROKE 等价", () => {
    // CARD = wash(WHITE,13,BG_SOLID) → 255*0.051 + 16*(1-0.051) ≈ 28 …
    expect(hex(wash("#ffffff", 13, BG_SOLID))).toBe("#1c202c");
    expect(hex(wash("#ffffff", 11, BG_SOLID))).toBe("#1a1e29");
  });

  it("正对照：alpha=255 时 wash 原样返回（不预混不该改变颜色）", () => {
    expect(hex(wash(ACCENT, 255, BG_SOLID))).toBe(hex(ACCENT));
  });

  it("alpha=0 时 wash 完全等于基色（负判据要有正对照，别把「没叠」读成「叠错了」）", () => {
    expect(hex(wash(ACCENT, 0, BG_SOLID))).toBe(hex(BG_SOLID));
  });
});
```

```ts
// src/renderer/pet/ops.test.ts
import { describe, expect, it } from "vitest";
import { opsBounds } from "./ops";
import type { DrawOp } from "./ops";

describe("opsBounds", () => {
  it("空指令集返回 null（不许返回 0 尺寸框）", () => {
    expect(opsBounds([])).toBeNull();
  });

  it("按路径点求包围盒，椭圆按中心加减半径", () => {
    const ops: DrawOp[] = [
      { kind: "fillPath", fill: "#000", points: [[10, 20], [30, 5]] },
      { kind: "fillEllipse", fill: "#000", cx: 60, cy: 63.5, rx: 10, ry: 3.2 },
    ];
    expect(opsBounds(ops)).toEqual({ x: 10, y: 5, width: 50, height: 58.5 });
  });
});
```

- [ ] **Step 2: 跑到红**

```bash
pnpm vitest run src/renderer/pet
```

Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

```ts
// src/renderer/pet/tokens.ts
/**
 * 色板：直译 native `palette.rs` 与 `ui.rs:17-39`、`panel.rs::theme`。
 *
 * ⚠️ 关于预混：native 侧 `wash/over` 存在的理由是「本机 GL/DWM 管线会把 alpha 再过一遍
 * sRGB，半透填充实测亮 4-7 倍」。Chromium 的合成路径不是那条管线，所以这里的
 * `wash` 结果必须在 fork 侧重新实测一次再钉进单测（spec §9-6）：
 * 若 Chromium 的半透叠加与设计一致，正文可以直接用 rgba 而不必预混——
 * 但 token 单测必须锁定「面板底不透明」这一条（native 的 #19/#20 教训与桌布漂移）。
 * 在此之前，一律走 `wash` 预混，行为与 native 对齐。
 */
export type Color = string; // "#rrggbb"

export const ACCENT = "#5b8def";
export const GREEN = "#4fb477";
export const WARN = "#d97757";
export const PAPER = "#f7f4ec";

export const INK = "#2b2f3a";
export const INK_SOFT = "#4a5162";
export const ROSE = "#f27d92";
export const ROSE_DEEP = "#dd6a7f";
export const PAPER_SHADE = "#d8d1c2";
export const EYE = "#14171f";
export const BREAK_FILL = "#5c6472";
export const BREAK_SOFT = "#777f8d";
export const BREAK_EAR = "#9c8a92";
export const SHADOW = "#000000";

export const BG_SOLID = "#101420";
export const FG = "#e8e6df";
export const DIM = "#9a9daa";
export const ACCENT_DEEP = "#4a7fe0";
export const ACCENT_FG = "#8ab4ff";
export const ACCENT_HOVER = "#6f9bff";
export const TODAY_BAR = "#b2caff";
export const GREEN_FG = "#7fd6a2";
export const WARN_FG = "#f0c4b4";

export function hex(color: Color | { r: number; g: number; b: number }): string {
  const c = typeof color === "string" ? parse(color) : color;
  const p = (v: number) => Math.round(v).toString(16).padStart(2, "0");
  return `#${p(c.r)}${p(c.g)}${p(c.b)}`;
}

export function parse(color: Color): { r: number; g: number; b: number } {
  const body = color.replace("#", "");
  return {
    r: parseInt(body.slice(0, 2), 16),
    g: parseInt(body.slice(2, 4), 16),
    b: parseInt(body.slice(4, 6), 16),
  };
}

/** sRGB 空间把 `fg` 按 alpha 叠到 `bg` 上，返回不透明色（等价 native `theme::over`）。 */
export function wash(fg: Color, alpha: number, bg: Color): Color {
  const f = parse(fg);
  const b = parse(bg);
  const t = Math.max(0, Math.min(255, alpha)) / 255;
  const m = (a: number, c: number) => Math.round(a * t + c * (1 - t));
  return hex({ r: m(f.r, b.r), g: m(f.g, b.g), b: m(f.b, b.b) });
}

export function withAlpha(color: Color, alpha: number): string {
  const { r, g, b } = parse(color);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(255, alpha)) / 255})`;
}
```

> `wash("#ffffff", 13, BG_SOLID)` 的期望值 `#1c202c` 是按 native `over()` 的 `round` 口径手算的：`r = round(255*.051 + 16*.949) = 28 = 0x1c`、`g = round(255*.051 + 20*.949) = 32 = 0x20`、`b = round(255*.051 + 32*.949) = 43 = 0x2b`。**实现者必须先跑一遍 `pnpm vitest run` 看实际值**：若与 `#1c202c` 差 1，以手算式为准修实现（`43` 的 `round` 归属），并把最终结论同时记进 `docs/verge/spikes/p1-window.md`——这条是 spec §9-6 的第一半实测。

```ts
// src/renderer/pet/ops.ts
import type { Rect } from "../../../shared/pet-geometry";

export type Point2 = [number, number];

export type DrawOp =
  | { kind: "fillPath"; fill: string; points: Point2[] }
  | { kind: "gradPath"; from: Point2; to: Point2; stops: Array<{ at: number; color: string }>; points: Point2[] }
  | { kind: "strokePath"; stroke: string; width: number; points: Point2[]; close?: boolean }
  | { kind: "fillEllipse"; fill: string; cx: number; cy: number; rx: number; ry: number; rot?: number }
  | { kind: "strokeEllipse"; stroke: string; width: number; cx: number; cy: number; rx: number; ry: number }
  | { kind: "crescent"; fill: string; cx: number; cy: number; r: number; dx: number; dy: number; cut: number }
  | { kind: "text"; text: string; x: number; y: number; size: number; color: string };

/** 只解释指令，不做任何判定——判据全在单测与探针里。 */
export function paintOps(ctx: CanvasRenderingContext2D, ops: DrawOp[]): void {
  for (const op of ops) {
    switch (op.kind) {
      case "fillPath":
        ctx.fillStyle = op.fill;
        ctx.fill(toPath2D(op.points));
        break;
      case "gradPath": {
        const grad = ctx.createLinearGradient(op.from[0], op.from[1], op.to[0], op.to[1]);
        for (const stop of op.stops) grad.addColorStop(stop.at, stop.color);
        ctx.fillStyle = grad;
        ctx.fill(toPath2D(op.points));
        break;
      }
      case "strokePath":
        ctx.strokeStyle = op.stroke;
        ctx.lineWidth = op.width;
        ctx.stroke(toPath2D(op.points));
        break;
      case "fillEllipse":
        ctx.fillStyle = op.fill;
        ctx.beginPath();
        ctx.ellipse(op.cx, op.cy, op.rx, op.ry, op.rot ?? 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      case "strokeEllipse":
        ctx.strokeStyle = op.stroke;
        ctx.lineWidth = op.width;
        ctx.beginPath();
        ctx.ellipse(op.cx, op.cy, op.rx, op.ry, 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      case "crescent": {
        // 双色记号：底层实圆 + 上层偏移圆「咬」掉一块（native ui.rs::crescent 同构）。
        ctx.fillStyle = op.fill;
        ctx.beginPath();
        ctx.arc(op.cx, op.cy, op.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.save();
        ctx.globalCompositeOperation = "destination-out";
        ctx.beginPath();
        ctx.arc(op.cx + op.dx, op.cy + op.dy, op.cut, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        break;
      }
      case "text":
        ctx.fillStyle = op.color;
        ctx.font = `${op.size}px sans-serif`;
        ctx.textBaseline = "middle";
        ctx.fillText(op.text, op.x, op.y);
        break;
    }
  }
}

export function toPath2D(points: Point2[]): Path2D {
  const path = new Path2D();
  if (points.length === 0) return path;
  path.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i += 1) path.lineTo(points[i][0], points[i][1]);
  path.closePath();
  return path;
}

export function opsBounds(ops: DrawOp[]): Rect | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const eat = (x: number, y: number) => {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  };
  for (const op of ops) {
    if ("points" in op) for (const [x, y] of op.points) eat(x, y);
    if (op.kind === "fillEllipse" || op.kind === "strokeEllipse") {
      eat(op.cx - op.rx, op.cy - op.ry);
      eat(op.cx + op.rx, op.cy + op.ry);
    }
    if (op.kind === "crescent") {
      eat(op.cx - op.r, op.cy - op.r);
      eat(op.cx + op.r, op.cy + op.r);
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
```

- [ ] **Step 4: 跑到绿**

```bash
pnpm vitest run src/renderer/pet
```

Expected: PASS（`wash` 期望值按 Step 3 的说明对齐后再跑）。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/pet/tokens.ts src/renderer/pet/tokens.test.ts src/renderer/pet/ops.ts src/renderer/pet/ops.test.ts
git commit -m "feat(verge): 落地像素猫色板 token 与绘制指令模型"
```

---

## Task 9: 美术移植（原语 + 部件路径 + `drawCat` 层序）

**Files:**
- Create: `src/renderer/pet/xf.ts` + `xf.test.ts`
- Create: `src/renderer/pet/art.ts` + `art.test.ts`
- 只读移植源：`ui.rs`（`Xf:95-119`、`rot/bend_poly/ribbon:122-255`、`body_path:198`、`tail_spine:210`、耳朵/围兜/鼻:230-260、`scanline_spans/fill_grad/fill_solid/crescent/stroke_poly/ellipse/circle/ground_shadow/heart:315-551`、`TILT_DEG/Pose:552-587`、`draw_cat:588-1200`）

**Interfaces:**
- Consumes: `DrawOp`、`tokens`、`scaleFor`
- Produces:
  - `xf.ts`：`class Xf { s, ox, oy, sx, sy, dy, rot, px, py; map(p: Point2): Point2 }`、`ribbon(points, w0, w1): Point2[]`（含圆头端帽）、`cubicTo(pts, n=12)`、`quadTo(pts, n=10)`、`arc(...)`
  - `art.ts`：`buildCatOps(input: CatInput): DrawOp[]`，`CatInput = { center: Point2; u: number; mood: Mood; t: number; energy: number; mouse: Point2 | null; blink: number; jumpY: number; pet: number; pose: Pose; quiet: boolean; unreadCount: number }`
  - `buildCapsuleOps(input: CapsuleInput): DrawOp[]`
  - `Mood = "idle" | "happy" | "thinking" | "grumpy" | "sleep"`、`Pose = { paw: number; yawn: number; stretch: number; tilt: number; engagement: number }`

**移植纪律（本任务的全部判据）：**

- [ ] **Step 1: 写失败的测试（层序 + 关键数值不许漂）**

```ts
// src/renderer/pet/art.test.ts
import { describe, expect, it } from "vitest";
import { buildCapsuleOps, buildCatOps, layerKinds } from "./art";
import { BG_SOLID, INK, PAPER, wash } from "./tokens";

const base = {
  center: { x: 41, y: 43 }, u: 37, mood: "idle" as const, t: 0, energy: 1,
  mouse: null, blink: 0, jumpY: 0, pet: 0,
  pose: { paw: 0, yawn: 0, stretch: 0, tilt: 0, engagement: 0 }, quiet: false, unreadCount: 0,
};

describe("buildCatOps 层序", () => {
  it("绘制顺序照抄 ui.rs::draw_cat：影子→尾→耳→身→围兜→爪→眼→鼻嘴→腮红→洗脸爪→Zzz→月牙→爱心→星→角标", () => {
    expect(layerKinds(buildCatOps(base))).toEqual([
      "ground_shadow", "tail", "tail_tip", "ears", "body", "body_light", "body_stroke",
      "bib", "bib_ao", "paws", "eyes", "nose", "mouth", "blush",
    ]);
  });

  it("免打扰时月牙压在 Zzz 之后且必须两层（墨 + PAPER 反咬）", () => {
    const ops = buildCatOps({ ...base, quiet: true });
    const crescents = ops.filter((op) => op.layer === "quiet_mark");
    expect(crescents).toHaveLength(2);
    expect(crescents.map((op) => op.fill)).toEqual([INK, PAPER]);
  });

  it("正对照：安静期间不许出现 Zzz（月牙与 Zzz 屏幕互斥）", () => {
    expect(buildCatOps({ ...base, quiet: true }).some((op) => op.layer === "zzz")).toBe(false);
    expect(buildCatOps({ ...base, quiet: false, mood: "sleep" }).some((op) => op.layer === "zzz")).toBe(true);
  });

  it("猫身包围盒在收起档必须落进 74×68 且不出 82 宽窗口", () => {
    const ops = buildCatOps(base);
    const xs = ops.flatMap((op) => ("points" in op ? op.points.map(([x]) => x) : []));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThanOrEqual(82);
  });

  it("爱心整段行程连半径都留在窗内（旧的 44+26ph 会被拦腰裁掉）", () => {
    const ops = buildCatOps({ ...base, pet: 1 });
    const hearts = ops.filter((op) => op.layer === "heart");
    expect(hearts.length).toBeGreaterThan(0);
    for (const heart of hearts) {
      expect(heart.ry).toBeLessThan(heart.cy);
      expect(heart.cy + heart.ry).toBeLessThanOrEqual(108);
    }
  });
});

describe("buildCapsuleOps", () => {
  it("默认档 70×32、圆角 9、位于窗口底部（cy = 高 - 16 - 4）", () => {
    const ops = buildCapsuleOps({ rectWidth: 82, rectHeight: 108, e: 0, growLeft: false, up: 0, down: 0, pinX: 41 });
    const body = ops[0];
    expect(body.width).toBe(70);
    expect(body.height).toBe(32);
    expect(body.cy).toBeCloseTo(108 - 32 / 2 - 4, 6);
  });

  it("growLeft 时胶囊贴右缘（cx = max.x - PIN.x）", () => {
    const right = buildCapsuleOps({ rectWidth: 172, rectHeight: 108, e: 0, growLeft: true, up: 0, down: 0, pinX: 41 })[0];
    expect(right.cx).toBeCloseTo(172 - 41, 6);
  });

  it("无流量时降的是 RGB 亮度而不是 alpha，并且描边比填充亮一档", () => {
    const ops = buildCapsuleOps({ rectWidth: 82, rectHeight: 108, e: 0, growLeft: false, up: 0, down: 0, pinX: 41 });
    expect(ops[0].fill).not.toBe(ops[1].stroke);
    expect(ops[0].alpha).toBeUndefined();
  });

  it("展开动画期间随 e 淡出：e=0.5 起完全消失", () => {
    const ops = buildCapsuleOps({ rectWidth: 248, rectHeight: 482, e: 0.6, growLeft: false, up: 1, down: 1, pinX: 41 });
    expect(ops).toEqual([]);
  });
});
```

> 上面用到的 `op.layer` 是给判据用的标签字段：`DrawOp` 增补可选 `layer?: string`，`paintOps` 忽略它。这是为了「屏幕层出问题时能一眼指出是哪一层画歪了」，不是运行时行为。

- [ ] **Step 2: 跑到红**

```bash
pnpm vitest run src/renderer/pet/art.test.ts
```

Expected: FAIL（模块不存在）。

- [ ] **Step 3: 逐函数移植（不许改数值、不许改层序）**

按下表把 `ui.rs` 的每个构造器搬成 `Point2[]` 生成器；`Xf::map` 的旋转与缩放**必须以脚部支点 `(60, 100)` 为心**，且 x 缩放时 `px` 也要取 60，否则「伸懒腰」会读成 2px 平移（`ui.rs:95-119` 的原注释就是这条教训）。

| native | fork 函数 | 必抄的数值 |
| --- | --- | --- |
| `ear_l_outer` | `earLOuter()` | `[(34,40),(28,16),(52,30)]` |
| `body_path` | `bodyPath()` | viewBox 120 的贝塞尔控制点原样 |
| `tail_spine` + `ribbon(line, w0, w1)` | `tailSpine()` / `ribbon()` | 尾尖白色段用 `fill_solid(PAPER)`，`ribbon` 两端要补圆头帽 |
| `bib_path` | `bibPath()` | 渐变 `PAPER→PAPER_SHADE`，支点 `(61,104)`；AO 椭圆 `(60,63.5,10,3.2)` 色 `INK@0.10` |
| `ground_shadow` | `groundShadow()` | 只能用差分量叠（native 美术约束：投影不是黑块） |
| `crescent` | 见 `ops.ts` 的 `crescent` 指令 | 半径 `1.28*9*s` 与 `9*s` 两层、偏移 `(0.42r, -0.30r)`、切割 `0.92r` |
| 爱心 | `heartOps()` | `hx = center + (14 + 11*ph)*s`、`hy = center - (41 + 18*ph)*s`、`r = (3 + 2.4*ph)*s*1.7`、三枚错相 `t*0.55 + i/3` |
| 角标 | `badgeOps()` | `BADGE = (103, 28)` viewBox；`x<8` 会掉出 74px 窗口；`SPOKEN_CAP = 7` 是「一位数塞得进 r=6 墨底」的结构性上限 |
| `fill_grad` | 用 `gradPath` 指令直接渐变填充 | **不要**移植 scanline 叠色（native #68 的亚像素叠加坑就是它造成的；Chromium 对 AA 路径直接填渐变即可） |

胶囊色对（`CAP_ON/CAP_OFF` 与对应 alpha 表）从 `main.rs:4979-5018` 抄，安静降亮度那条**改 RGB、不改 alpha**（原注释：alpha 在这条管线上会被放大一档；Chromium 下要重新实测，实测结论写进 `docs/verge/spikes/p1-window.md`）。

- [ ] **Step 4: 跑到绿 + 屏幕层比对**

```bash
pnpm vitest run src/renderer/pet
pnpm dev
```

屏幕层：把 fork 截图与 native `dist-native/` 那份并排看三处——尾巴白色尾尖、围兜与身体的接缝、耳朵内侧的粉。用现成的 `clash verge/file/verify_*.py` 判据骨架（逐配对最小值 + GT90 覆盖度），坐标模型换成 Task 5 实测的 DPI 换算。Expected: 猫的墨迹覆盖度在两档桌布上都不低于 GT90；负判据（「猫身不许被洗成灰白」）配一条正对照（亮桌布 + 暗桌布各测一次）。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/pet/xf.ts src/renderer/pet/xf.test.ts src/renderer/pet/art.ts src/renderer/pet/art.test.ts
git commit -m "feat(verge): 移植像素猫的美术层序与部件路径"
```

---

## Task 10: `PixelPetRenderer` 与渲染入口重写

**Files:**
- Create: `src/renderer/pet/renderer.ts`、`renderer.test.ts`、`src/renderer/pet/click-through.ts`
- Modify: `src/renderer/main.ts`（重写）、`src/renderer/index.html`（去 Cubism script）

**Interfaces:**
- Consumes: `buildCatOps`、`buildCapsuleOps`、`computePetLayout`、`computeCatRect`
- Produces（替换 `live2d/manager.ts:222-281` 那套面）:
  - `class PixelPetRenderer { constructor(opts: { canvas: HTMLCanvasElement; width: number; height: number; onLoad(): void; onError(e: unknown): void }); init(): Promise<void>; applyZoom(zoom: number): void; resize(w: number, h: number): void; pause(): void; resume(): void; dispose(): void; getHitAreaDefs(): HitAreaDef[]; readAlpha(cssX: number, cssY: number): number; getCanvas(): HTMLCanvasElement }`
  - `window.verge.resizePetWindow` 的调用方（步进 `g ∈ {0,1}`）
  - 删除对 `getGL()` 的依赖：`click-through.ts` 改用 `readAlpha()`（canvas 2D `getImageData`，context 以 `willReadFrequently: true` 创建）

- [ ] **Step 1: 写失败的测试（面存在性 + 命中矩形）**

```ts
// src/renderer/pet/renderer.test.ts
import { describe, expect, it, vi } from "vitest";
import { PixelPetRenderer } from "./renderer";
import { computeCatRect } from "../../../shared/pet-geometry";

function makeCanvas() {
  const canvas = {
    width: 82, height: 108, style: {} as Record<string, string>,
    getContext: vi.fn(() => ({
      setTransform: vi.fn(), clearRect: vi.fn(), save: vi.fn(), restore: vi.fn(),
      beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), stroke: vi.fn(), ellipse: vi.fn(),
      moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), fillText: vi.fn(),
      createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([0, 0, 0, 255]) })),
      globalCompositeOperation: "", fillStyle: "", strokeStyle: "", lineWidth: 1, font: "", textBaseline: "",
    })),
  };
  return canvas as unknown as HTMLCanvasElement & { getContext: ReturnType<typeof vi.fn> };
}

describe("PixelPetRenderer", () => {
  it("替换面全齐：Live2DManager 用到的每个方法都得有", () => {
    const r = new PixelPetRenderer({ canvas: makeCanvas(), width: 82, height: 108, onLoad: vi.fn(), onError: vi.fn() });
    for (const method of ["init", "applyZoom", "resize", "pause", "resume", "dispose", "getHitAreaDefs", "readAlpha"] as const) {
      expect(typeof r[method]).toBe("function");
    }
  });

  it("hit area 就是 native 的 cat_rect（82×108 收起档），不再是整窗矩形", () => {
    const r = new PixelPetRenderer({ canvas: makeCanvas(), width: 82, height: 108, onLoad: vi.fn(), onError: vi.fn() });
    const [area] = r.getHitAreaDefs();
    const expected = computeCatRect({ pinInWin: { x: 41, y: 39 }, e: 0 });
    expect(area.rect).toMatchObject({ x: expect.closeTo(expected.x, 3), y: expect.closeTo(expected.y, 3) });
  });

  it("pause 停 ticker、resume 重启（拖窗时的 DWM 残影抑制靠这一条）", () => {
    const r = new PixelPetRenderer({ canvas: makeCanvas(), width: 82, height: 108, onLoad: vi.fn(), onError: vi.fn() });
    r.pause();
    expect(r.isPaused()).toBe(true);
    r.resume();
    expect(r.isPaused()).toBe(false);
  });
});
```

- [ ] **Step 2: 跑到红** → Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 renderer 与穿透**

```ts
// src/renderer/pet/renderer.ts
import { computeCatRect, computePetLayout, PET_H, PET_W, PIN, scaleFor } from "../../../shared/pet-geometry";
import { paintOps } from "./ops";
import { buildCapsuleOps, buildCatOps, type CatInput } from "./art";

export interface HitAreaDef { name: string; rect: { x: number; y: number; width: number; height: number } }

export interface PixelPetRendererOptions {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  onLoad(): void;
  onError(error: unknown): void;
}

const FPS_IDLE = 4;
const FPS_ACTIVE = 30;
const FPS_HOVER = 60;

export class PixelPetRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private zoom = 1;
  private ticker = 0;
  private paused = false;
  private fps = FPS_IDLE;
  private frame = 0;
  private cat: CatInput;

  constructor(private readonly opts: PixelPetRendererOptions) {
    const ctx = opts.canvas.getContext("2d", { willReadFrequently: true, alpha: true });
    if (!ctx) throw new Error("canvas 2D context unavailable");
    this.ctx = ctx;
    this.cat = {
      center: { x: PIN.x - 17 * scaleFor(0).s, y: PIN.y + 4.5 * scaleFor(0).s },
      u: scaleFor(0).u, mood: "idle", t: 0, energy: 1, mouse: null, blink: 0,
      jumpY: 0, pet: 0, pose: { paw: 0, yawn: 0, stretch: 0, tilt: 0, engagement: 0 },
      quiet: false, unreadCount: 0,
    };
  }

  async init(): Promise<void> {
    this.applyZoom(this.zoom);
    this.opts.onLoad();
    this.start();
  }

  isPaused(): boolean { return this.paused; }

  /** native 靠 2u 宽表达缩放；这里以视口宽度 / 82 为基准。 */
  applyZoom(zoom: number): void {
    this.zoom = zoom > 0 ? zoom : 1;
    this.resize(this.opts.canvas.clientWidth, this.opts.canvas.clientHeight);
  }

  resize(width: number, height: number): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.opts.canvas.width = Math.max(1, Math.round(width * dpr));
    this.opts.canvas.height = Math.max(1, Math.round(height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  pause(): void { this.paused = true; this.stop(); }
  resume(): void { this.paused = false; this.start(); }

  dispose(): void { this.stop(); }

  getHitAreaDefs(): HitAreaDef[] {
    return [{ name: "cat", rect: computeCatRect({ pinInWin: { x: PIN.x, y: PIN.y }, e: 0 }) }];
  }

  readAlpha(cssX: number, cssY: number): number {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const x = Math.floor(cssX * dpr);
    const y = Math.floor(cssY * dpr);
    if (x < 0 || y < 0 || x >= this.opts.canvas.width || y >= this.opts.canvas.height) return 0;
    return this.ctx.getImageData(x, y, 1, 1).data[3];
  }

  /** P1 只做两档步进：面板/气泡在 P2 才带 e 动画。 */
  requestBounds(content: "pet" | "bubble" | "panel", g: number, catOrigin: { x: number; y: number }, workArea: Parameters<typeof computePetLayout>[0]["workArea"], peekDx = 0): void {
    const layout = computePetLayout({
      catOrigin, e: content === "panel" ? g : 0, be: content === "bubble" ? g : 0,
      growLeft: false, growUp: false, workArea, peekDx,
    });
    window.verge.resizePetWindow({ x: Math.round(layout.pos.x), y: Math.round(layout.pos.y), width: Math.round(layout.size.width), height: Math.round(layout.size.height) });
  }

  setRedrawPolicy(fps: number): void { this.fps = fps; if (!this.paused) { this.stop(); this.start(); } }

  private start(): void {
    if (this.ticker || this.paused) return;
    let last = 0;
    const interval = 1000 / this.fps;
    this.ticker = window.setInterval(() => {
      const now = performance.now();
      if (now - last < interval - 1) return;
      last = now;
      this.draw();
    }, interval);
  }

  private stop(): void {
    if (this.ticker) window.clearInterval(this.ticker);
    this.ticker = 0;
  }

  private draw(): void {
    this.frame += 1;
    this.cat.t = this.frame / this.fps;
    const w = this.opts.canvas.clientWidth || PET_W;
    const h = this.opts.canvas.clientHeight || PET_H;
    this.ctx.clearRect(0, 0, w, h);
    paintOps(this.ctx, [
      ...buildCatOps(this.cat),
      ...buildCapsuleOps({ rectWidth: w, rectHeight: h, e: 0, growLeft: false, up: 0, down: 0, pinX: PIN.x }),
    ]);
  }
}
```

```ts
// src/renderer/pet/click-through.ts
// 与 live2d/click-through.ts 同判据（alphaThreshold ?? 10、rAF 合帧、状态变化才发 IPC），
// 差别只在取样从 gl.readPixels 换成 canvas 2D 的 getImageData。
// 取不到 alpha 时按「穿透」处理还是「不穿透」？——沿用上游的宽松策略返回 true，
// 并把这条写进注释：宁可让桌面多收一次点击，也不把猫变成一块点不掉的玻璃。
```

`src/renderer/main.ts` 重写要点（保留既有链路，只换渲染器）：

1. `new PixelPetRenderer({...})` 替换 `new Live2DManager({...})`；删掉 `resolveAsset("models/cyrene/Cyrene.model3.json")` 与 ExpressionReset/MouthSync/SpeakingMotion/Blink/MouseFocus 五个 Live2D 控制器的装配（口型在 P5 才接，`live2dSpeech` 的 IPC 面先保留但不接渲染器）。
2. 保留 `ClickThroughController` 等价物但喂 `readAlpha`；`onInteractive` 仍走 `window.cyrene.setInteractive`。
3. **拖拽必须 gate 左键**：`pointerdown` 处加 `if (event.button !== 0) return;`（现状不判按钮，右键会顺手拖窗，而右键是「安静半小时」的手势）。
4. 保留拖拽期的 canvas 快照 overlay（`main.ts:239-269` 那套抑制 DWM 残影的手段，Task 5 已确认在 82×108 上有效）。
5. `petZoom` 启动竞态的重读逻辑原样保留。
6. `beforeunload` 的 dispose 链改指新渲染器。
7. `index.html` 删掉 `<script src="/live2dcubismcore.min.js">`；`#live2d-canvas` 的 id 可保留（CSS 与 `getElementById` 共用，改名属于无关重构）。

- [ ] **Step 4: 跑到绿 + 屏幕层验收（P1 的主验收）**

```bash
pnpm vitest run src/renderer/pet src/main/application/ipc-contract.test.ts
pnpm dev
```

Expected 逐条核：猫出现在屏幕右下角（82×108 小窗，透明处能点穿到桌面）、左键拖得动、点猫有跳跃反馈、右键不拖窗、`window.verge.getSnapshot()` 返回 `module: "verge"`。P1 退出条件的屏幕层判据全部走查一遍：

```bash
python "D:/Test/workbuddy/clash verge/file/verify_cat_present.py"   # 复用判据骨架，坐标模型改 Chromium
```

（脚本名按 native 仓库里现存的那批尺来选；新增的 fork 侧尺放在 `D:/Test/workbuddy/clash verge/file/`，不动 native 产品代码。）

- [ ] **Step 5: Commit**

```bash
git add src/renderer/pet/renderer.ts src/renderer/pet/renderer.test.ts src/renderer/pet/click-through.ts src/renderer/main.ts src/renderer/index.html
git commit -m "feat(verge): 像素猫渲染器接管宠物窗"
```

---

## Task 11: 右键菜单 + 免打扰（落盘、自醒、月牙）

**Files:**
- Create: `src/main/verge/pet-menu.ts` + `pet-menu.test.ts`
- Create: `src/main/verge/quiet-clock.ts` + `quiet-clock.test.ts`
- Modify: `src/main/windows/window-manager.ts`（挂 `attachContextMenu` 到宠物窗）、`src/preload/index.ts`（`quietFor/setTuck/isQuiet`）

**Interfaces:**
- Consumes: `VergeService`（Task 4）
- Produces:
  - `QUIET_DURATION_MS = 30 * 60_000`
  - `isQuietNow(quietUntil: number | null, now: number): boolean`
  - `quietRemainingMinutes(quietUntil: number, now: number): number`（向上取整、至少 1 —— native #66 的口径）
  - `buildPetMenuItems(input): MenuItemInit[]`（安静半小时 / 安静中·剩 N 分（禁用）/ 取消安静 / 藏身开关 / 隐藏 / 退出）

- [ ] **Step 1: 写失败的测试**

```ts
// src/main/verge/quiet-clock.test.ts
import { describe, expect, it } from "vitest";
import { QUIET_DURATION_MS, isQuietNow, quietRemainingMinutes, armQuiet } from "./quiet-clock";

const now = 1_700_000_000_000;

describe("quiet-clock", () => {
  it("半小时档时长照抄 native", () => {
    expect(QUIET_DURATION_MS).toBe(30 * 60 * 1000);
  });

  it("到点即失效，且不许差 1ms 还在响", () => {
    expect(isQuietNow(now + 1000, now)).toBe(true);
    expect(isQuietNow(now, now)).toBe(false);
  });

  it("正对照：null（不在安静期）判为 false", () => {
    expect(isQuietNow(null, now)).toBe(false);
  });

  it("剩余分钟向上取整且至少 1（剩 10 秒也得说「剩 1 分」）", () => {
    expect(quietRemainingMinutes(now + 10_000, now)).toBe(1);
    expect(quietRemainingMinutes(now + 91_000, now)).toBe(2);
  });

  it("再点一次是取消，不是续期（native 的反向路径回执）", () => {
    expect(armQuiet({ current: now + 60_000, now })).toBeNull();
    expect(armQuiet({ current: null, now })).toBe(now + QUIET_DURATION_MS);
  });
});
```

```ts
// src/main/verge/pet-menu.test.ts
import { describe, expect, it } from "vitest";
import { buildPetMenuItems } from "./pet-menu";

const now = 1_700_000_000_000;

describe("buildPetMenuItems", () => {
  it("安静期间标题变成「安静中 · 剩 N 分」且那条被禁用", () => {
    const items = buildPetMenuItems({ quietUntil: now + 5 * 60_000, now, tuckEnabled: true });
    expect(items[0].label).toBe("安静中 · 剩 5 分");
    expect(items[0].enabled).toBe(false);
    expect(items[1].label).toBe("取消安静");
  });

  it("不在安静期时第一项是「安静半小时」且可点（负判据配正对照）", () => {
    const items = buildPetMenuItems({ quietUntil: null, now, tuckEnabled: true });
    expect(items[0]).toMatchObject({ label: "安静半小时", enabled: true });
  });

  it("藏身开关的勾与状态一致", () => {
    expect(buildPetMenuItems({ quietUntil: null, now, tuckEnabled: false })[2]).toMatchObject({
      label: "贴边藏身", checked: false,
    });
  });
});
```

- [ ] **Step 2: 跑到红** → 实现（`quiet-clock.ts` / `pet-menu.ts` 按上面判据写纯函数 + 一个把 items 交给 `Menu.buildFromTemplate` 的 `attachPetContextMenu(win, service, quit)`）。关键实现：

```ts
// src/main/verge/quiet-clock.ts
export const QUIET_DURATION_MS = 30 * 60 * 1000;

export function isQuietNow(quietUntil: number | null, now: number): boolean {
  return quietUntil !== null && now < quietUntil;
}

export function quietRemainingMinutes(quietUntil: number, now: number): number {
  return Math.max(1, Math.ceil((quietUntil - now) / 60_000));
}

/** 已在安静期 → 取消（返回 null）；不在 → 续半小时。 */
export function armQuiet(input: { current: number | null; now: number }): number | null {
  return isQuietNow(input.current, input.now) ? null : input.now + QUIET_DURATION_MS;
}
```

菜单挂载走现成的 `windows/context-menu.ts` 配方（`webContents.on("context-menu", (e, params) => Menu.buildFromTemplate(items).popup({ window }))`）——把宠物窗加进它的挂载点即可，`params.x/y` 对宠物窗用不上（菜单纯动作，无「拷贝图片」这类项）。

自醒：`quietUntil` 落盘后起一个 `setTimeout(remaining).unref()`，到点**当场清 `quiet_until`**（native 的契约：`到点自醒要当场清 quiet_until`，不能等到下一次动作再清），并通过 `window.verge` 的外发通道让渲染器撤月牙。渲染器侧 `quiet: true` 时必须闸住「睡着」这条分支（月牙与 Zzz 屏幕互斥）。

- [ ] **Step 3: 屏幕层 + 探针层验收**

```bash
VERGE_GEOM_PROBE=1 pnpm dev
```

Expected:
1. 右键菜单弹出四项，点「安静半小时」后 `%APPDATA%\cyrene-verge\verge\state.json` 里 `quietUntil` 变化（**盘里的变化才算数**，屏幕上看见月牙不算）；
2. 猫身上出现双色月牙，深色桌布下仍可见（单层软墨在深色桌布上等于没画）；
3. 安静期间猫不许睡着；
4. 把 `quietUntil` 手工改成 `now + 5000` 重启进程，5 秒后盘里 `quietUntil` 必须回到 `null`。

- [ ] **Step 4: 跑到绿 + Commit**

```bash
pnpm vitest run src/main/verge
git add src/main/verge/quiet-clock.ts src/main/verge/quiet-clock.test.ts src/main/verge/pet-menu.ts src/main/verge/pet-menu.test.ts src/main/windows/window-manager.ts src/preload/index.ts
git commit -m "feat(verge): 宠物窗右键菜单与免打扰半小时"
```

---

## Task 12: workArea 夹取、显示器变更与贴边藏身

**Files:**
- Create: `src/main/verge/tuck-clock.ts` + `tuck-clock.test.ts`
- Modify: `src/main/windows/window-manager.ts`（`screen.on("display-metrics-changed")` → 重夹取）、`src/renderer/pet/renderer.ts`（peek 只进绘制偏移）

**Interfaces:**
- Consumes: `computePetLayout`、`resolveGrowthDirection`、`VergeService.setTuckEnabled/markTuckHinted`
- Produces:
  - `TUCK_PEEK_PX = 40`、`EDGE_NEAR_PX = 60`、`TUCK_IDLE_SECS = 6`、`TUCK_PROBE_IDLE_SECS = 2.5`
  - `shouldTuck(input: { tuckEnabled, userActive, idleSecs, limit, e, be, bubbleOpen }): boolean`
  - `tuckHintShout(input: { tuckOn, hinted, engaging }): string | null`，`TUCK_HINT = "放着不动\n我会贴边藏起来\n点我就回来"`
  - `tuckStep(current: number, target: number, dt: number, peekDx: number): number`（`k = min(dt, 0.05) * 3.5`，`|残余| < 0.5` 时吸附）
  - `unTuckForDrag(position: { x: number }, peekDx: number): { x: number }`（`pet_pos = pos + peek_dx`，然后 `peek_dx = 0`）

- [ ] **Step 1: 写失败的测试**

```ts
// src/main/verge/tuck-clock.test.ts
import { describe, expect, it } from "vitest";
import {
  EDGE_NEAR_PX, TUCK_HINT, TUCK_IDLE_SECS, TUCK_PEEK_PX,
  shouldTuck, tuckHintShout, tuckStep, unTuckForDrag,
} from "./tuck-clock";

describe("tuck 常量", () => {
  it("照抄 native：藏一半约当 82 宽的 54%，近边阈值 60，闲置 6 秒", () => {
    expect({ TUCK_PEEK_PX, EDGE_NEAR_PX, TUCK_IDLE_SECS }).toEqual({ TUCK_PEEK_PX: 40, EDGE_NEAR_PX: 60, TUCK_IDLE_SECS: 6 });
    expect(TUCK_PEEK_PX / 82).toBeGreaterThan(0.5);
  });
});

describe("shouldTuck 五道闸门", () => {
  const open = { tuckEnabled: true, userActive: false, idleSecs: 7, limit: TUCK_IDLE_SECS, e: 0, be: 0, bubbleOpen: false };
  it("全开才藏", () => { expect(shouldTuck(open)).toBe(true); });
  it("开关关了不藏（用户关得掉）", () => { expect(shouldTuck({ ...open, tuckEnabled: false })).toBe(false); });
  it("刚拖过不藏", () => { expect(shouldTuck({ ...open, userActive: true })).toBe(false); });
  it("不够久不藏", () => { expect(shouldTuck({ ...open, idleSecs: 5.9 })).toBe(false); });
  it("正对照：面板或气泡在开着时不藏（藏身会把气泡 anchor 顶出屏）", () => {
    expect(shouldTuck({ ...open, e: 0.02 })).toBe(false);
    expect(shouldTuck({ ...open, be: 0.02 })).toBe(false);
    expect(shouldTuck({ ...open, bubbleOpen: true })).toBe(false);
  });
});

describe("tuckHintShout", () => {
  it("第一次真藏之前先解释，且只说一次", () => {
    expect(tuckHintShout({ tuckOn: true, hinted: false, engaging: true })).toBe(TUCK_HINT);
    expect(tuckHintShout({ tuckOn: true, hinted: true, engaging: true })).toBeNull();
    expect(tuckHintShout({ tuckOn: true, hinted: false, engaging: false })).toBeNull();
  });
});

describe("tuckStep 缓动", () => {
  it("按 k = min(dt,0.05)*3.5 逼近，残余不足 0.5 吸附到位", () => {
    expect(tuckStep(0, 40, 0.016, 0)).toBeCloseTo(40 * 0.056, 6);
    expect(tuckStep(39.8, 40, 0.016, 0)).toBe(40);
  });
  it("目标 0 时往回收", () => {
    expect(tuckStep(40, 0, 0.016, 0)).toBeLessThan(40);
  });
});

describe("unTuckForDrag", () => {
  it("拖走时把窗口按 peek 补回原位再清偏移（否则猫会反向补偿、被窗裁掉）", () => {
    expect(unTuckForDrag({ x: 1836 }, 40)).toEqual({ x: 1876 });
  });
});
```

- [ ] **Step 2: 跑到红** → **Step 3: 实现**（纯函数按上表；渲染器把 `peekDx` 只加进 `center` 的绘制偏移，`applied_pos` 交给 `computePetLayout` 的夹紧分支；`say()` 类动作必须先归零 `peekDx`）

显示器变更接在 `window-manager.ts` 里，用现成的 `screen` 单例：

```ts
    screen.on("display-metrics-changed", () => {
      const win = getUsablePetWindow();
      if (!win) return;
      const bounds = win.getBounds();
      const wa = screen.getDisplayMatching(bounds).workArea;
      const clamped = clampBoundsToWorkArea(bounds, wa);
      if (!shouldApplyBounds(bounds, clamped)) return;
      win.setBounds(clamped, false);
      persistPetPosition(clamped.x, clamped.y);
    });
```

（`clampBoundsToWorkArea` 放在 `src/shared/pet-geometry.ts` 里导出，一行 `clamp` 两轴，配一条单测：窗在副屏且副屏被拔掉后必须回到主屏 workArea 内。）

- [ ] **Step 4: 屏幕层 + 探针层验收（P1 收尾）**

逐条核，每条都要盘/日志证据：
1. 猫贴左/右边缘停 6 秒后滑走，**只露出双眼 + 胶囊完整**（胶囊被切一半是 native #38 修掉的缺陷，不许复发）；
2. 第一次藏身时气泡说 `TUCK_HINT`，重开进程不再说（`tuckHinted` 落盘）；
3. 右键菜单「贴边藏身」取消勾选后立刻回位且不再藏；
4. 拖走时猫不消失（探针：`GEOM` 行的 `applied` 与 `actual` 一致、`peek 0.0`）；
5. 改变缩放/拔掉副屏后猫仍在 workArea 内。

- [ ] **Step 5: Commit**

```bash
git add src/main/verge/tuck-clock.ts src/main/verge/tuck-clock.test.ts src/shared/pet-geometry.ts src/renderer/pet/renderer.ts src/main/windows/window-manager.ts
git commit -m "feat(verge): 贴边藏身与显示器变更夹取"
```

---

## P1 退出条件核对表

| 判据 | 取证方式 |
| --- | --- |
| 猫在屏幕右下角、82×108 | 屏幕尺 + `GEOM` 行的 `actual … 82x108` |
| 拖得动 | `pet-window-movement` 落盘的 `{x,y}` 变化 |
| 点得中 | `window.verge.getSnapshot()` 无变化但状态文件有动作痕迹；左键点击写 `state.json` |
| 窗宽随内容撑开且原点按公式左移 | `computePetLayout` 单测（growLeft 锚点 207 / 气泡 131） |
| 藏身给线索且关得掉 | `state.json` 的 `tuckHinted` / `tuckEnabled` |
| 免打扰半小时 | `state.json` 的 `quietUntil` + 到点自清 |
| `ipc-contract.test.ts` 绿 | `pnpm vitest run src/main/application/ipc-contract.test.ts` |
| 上游文件改动 ≤ 5 处 | `git diff --stat master..verge` 人工核 |

---

## 勘误（执行期发现的计划缺陷，以本节为准覆盖上文）

计划与 native 源码冲突时，**以 native 为准**（spec §Global Constraints「只搬不改」是
本计划的约束，计划正文的手算值不是）。执行到 Task 6-9 的复审时确认了六处：

1. **Task 6 Step 的 `withPeek.pos.x` 手算值 `1876` 作废，应为 `1838`。** native
   `main.rs:4299` 的 peek 分支自己夹 x，上界是「屏幕右边 − 当前窗宽」= 1920 − 82 = 1838；
   计划把这一步漏掉了，放到 1876 会把底部胶囊切一半（native 任务 #38 修过的正是这个）。
   同时 native `:4377-4383` 的 `pin_in_win` 含 `peek_off.x`，计划里没带这一项。
   已按 native 补回（commit `14e24b58`）。核对表第 4 行的「growLeft 锚点 207」不受影响。

2. **Task 6 的回落比较符写反。** 计划要求「两侧都放不下时取左」，native 是
   `right_gap > left_gap` 才贴右。判据以 native 为准。

3. **`tsconfig.renderer.json` 必须加 `src/renderer/pet/**`。** 上游那份 include 让
   整个 pet 目录对 `check:renderer` 不可见（空跑），23 个真实错误漏到运行时。
   这是超出 spec §6.1 白名单的第 6 处上游改动，已在 commit `1496c1a9` 的正文里
   记明理由与影响面。

4. **`DrawOp` 需要三件 native 才画得出的能力**（Task 8 的指令模型原本没列）：
   `fillRoundRect` / `strokeRoundRect`（胶囊是 70×32 圆角 9 + 1.0 描边，
   用椭圆近似会把读数基线压进圆角里）、`text.align`（胶囊数值右对齐、
   Zzz 与未读数字居中）、`strokePath.close`（native `stroke_poly` 不闭合，
   默认闭合会给胡须和闭眼连出一条首尾直线，native 任务 #56）。

5. **`unreadCount` 属于 `CapsuleInput`，不属于 `CatInput`。** native 的未读牌子
   （`main.rs:5096-5136`）锚在**窗口矩形 + growLeft**（`bc = rect.min.x + PIN.x ± 30`，
   `y = 26`），不跟猫的 `Xf` 变换走；把它接进 `buildCatOps` 会让牌子在贴边藏身时
   跟着猫体滑出窗口，正是 native #38 修过的那类错。Task 10 的渲染器示例里
   `buildCatOps({ … unreadCount: 0 })` 这一行删掉，改为把未读条数喂给
   `buildCapsuleOps`。

6. **提交 scope 统一为 `(pet)`**，不是各任务正文里混用的 `(verge)`——`src/renderer/pet/**`
   与 `src/shared/pet-geometry.ts` 都属于桌宠渲染层，`(verge)` 留给 `src/main/verge/**`
   与 `src/main/windows/**`、`src/main/startup/**` 的窗口侧改动。

Task 7 评审（`task-7-review.md`）又确认三处，Task 10 开工前必读：

7. **Task 7 Step 4 的屏幕验收在本任务不可达，改由 Task 10 的首次 dev 补做。**
   计划的判据（`grep -c "^GEOM"` ≥ 1）依赖一个还不存在的调用方——P1 的树里
   `resizePetWindow` 只有 preload 声明、没有渲染端调用。Task 10 第一次起 dev 时必须现场掐
   三段证据（正对照 248×482 落到 `actual`、负对照同档连发不再打第二行、失败分支改
   `resizable: true`），取证口径见 `docs/verge/spikes/p1-window.md` 待验证项 4。
   这不是「那就不验」：主交付物「尺寸通道打通」今天只有对着 fake 的单测证据。

8. **Task 10 的渲染端不许把自己当位置权威。** native 的保存点只由拖拽写
   （`pet-window-movement.ts` 的 `finishDragging` 落盘），PET_RESIZE 是跟随通道。
   main 侧已加闸门：**拖拽期间位置门关闭、尺寸门照常**（`window-manager.ts`
   的 `petWindowDragging`），所以 Task 10 必须照常调 `window.verge.setDragging(true/false)`，
   否则猫在拖拽末尾会被渲染端的旧 `catOrigin` 拽回起点。渲染端要在
   `setDragging(false)` 之后重算一次 bounds 再发。

9. **Task 10 需要给 `window.verge` 补全局类型。** `src/renderer/types/cyrene.d.ts` 里
   没有 `verge` 声明，Task 10 一调 `window.verge.resizePetWindow` 就会在
   `check:renderer` 下报 TS 错，而 Task 10 的 Files 列表里没有 `cyrene.d.ts`——
   把它加进 Task 10 的改动清单（属上游文件，计入 spec §6.1 额度）。
   另：`src/renderer/live2d/manager.ts:12-13` 仍自带 400×500 私有基址，主窗已 82×108，
   「画布被裁」是计划认可的中间态（Task 10 换渲染器即消失），Task 10 不必为它单独解释。

Task 10 评审（`task-10-review.md`）再添两处，Task 11/12 开工前必读：

10. **猫相位是绝对时间，50ms dt 封顶只喂缓动量（勘误 6 的锚点张冠李戴）。**
    Task 10 正文「`t` 改按 dt 积分并封顶 50ms（native `main.rs:4964`）」引用错了对象：
    native 的 4964（peek 缓动）与 3962（通用缓动 `dt_raw.clamp(0,0.05)`）封顶的是
    **缓动状态量**（panel_anim / be / blink / peek_dx），猫动画的相位源是绝对时间
    `let t = ctx.input(|i| i.time)`（main.rs:3945）整条传进 `draw_cat`（main.rs:4736-4745），
    呼吸/摆尾/动作包络都拿它做相位。按勘误 6 原样积分的后果可证：4fps 档每帧 dt 被
    封到 0.05s，猫钟以 0.2× 真实速度走，呼吸周期约从 4.2s 拉长到 21s。已改：
    `this.cat.t = now / 1000`（rAF 时间戳 / 1000），50ms 封顶留给 P2 的缓动状态量。
    检修锚点：renderer.ts draw()；native 对账 main.rs:3945/4736/4964/3962。

11. **渲染循环的裁决：rAF 赢，计划正文示例的 setInterval 作废。**
    计划正文与全局约束「GC：render loop 走 rAF」互相矛盾（示例代码写了
    `setInterval(…, 1000/fps)`），实现当时按示例走了 setInterval，属「矛盾无人裁决」。
    现裁决 rAF 为准：fps 档是**闸**（`now − lastDrawAt ≥ 1000/fps − 2.5ms` 才重绘），
    不是定时器；被闸的帧照常重新挂 rAF（native 的 repaint_after 33ms/250ms 语义在
    Chromium 里的直译就是帧闸）。落定于 commit `4bca363c`（renderer.ts start/draw）。
