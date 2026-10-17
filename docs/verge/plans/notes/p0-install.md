# P0 Task 1 实测记录：依赖装到 D: 并跑绿基线

日期：2026-10-17。机器：Windows 11（Git Bash/MSYS2），当前账号**不在** Administrators 组。
基线提交：`6228ea8e`（branch `verge`）。Node：v24.18.0（满足 engines `>=24 <25`）。

## 1. pnpm 调用形式（Step 1，R3 偏离之一）

- `corepack enable` 按预期失败（非管理员，要写 `C:\Program Files\nodejs\pnpm.CMD`）：
  `EPERM: operation not permitted, open 'C:\Program Files\nodejs\pnpm.CMD'`
- **实际可用的调用形式**（brief 给出的备选路径一，install-directory 版）：

  ```bash
  export COREPACK_HOME='D:\corepack-home'                     # corepack 缓存钉在 D:，不落 C:
  corepack enable --install-directory 'D:\corepack-bin'       # 成功，exit 0
  export PATH="/d/corepack-bin:$PATH"
  cd D:/Test/workbuddy/cyrene-verge
  pnpm --version   # → 10.33.0（仓库内按 package.json packageManager 解析；仓库外会回落 12.14.0，注意）
  ```

- 后果与注意：pnpm 不在系统 PATH，**每个新 shell 都要先 source 环境脚本**（见 §2）；
  `pnpm dev` 内部经 concurrently 再调 `pnpm run …` 也依赖该 PATH，已验证可嵌套。

## 2. 缓存与二进制目录钉到 D:（Step 2）

一次性环境脚本 `D:\p0-env.sh`（本次所有命令均先 `source /d/p0-env.sh`；换机时同样适用）：

```bash
export COREPACK_HOME='D:\corepack-home'
export PATH="/d/corepack-bin:$PATH"
export npm_config_cache='D:\npm-cache'
export ELECTRON_CACHE='D:\electron-cache'
export ELECTRON_BUYOUT_CACHE='D:\electron-cache'
export HTTPS_PROXY='http://127.0.0.1:7896'
export HTTP_PROXY='http://127.0.0.1:7896'
export NO_PROXY='127.0.0.1,localhost'
```

- 目录建立：`mkdir -p /d/pnpm-store /d/npm-cache /d/electron-cache` ✅。
- **未**创建项目 `.npmrc` ✅（避免第 6 处上游文件改动；用户级 `~/.npmrc` 也不存在）。
- C: 侧无新增缓存：`~/.cache` 里只有既有的 codex-runtimes/torch（安装前已存在）；
  corepack 因 `COREPACK_HOME` 指到 D: 未在 `~/.cache/node/corepack` 留下任何东西。
- 关键补充：Node 24 的 `fetch` 默认**不**读 `HTTP(S)_PROXY` 环境变量，需要
  `export NODE_USE_ENV_PROXY=1`，否则 sharp/electron 的下载器报 `TypeError: fetch failed`（实测踩过）。

## 3. 代理状态（Step 2）

- `127.0.0.1:7896` 在监听（PID 16200，即在本机运行的 clash verge 本体——只读确认，未动它）。
- 探活方法（避开 gotcha：探测本身不能被代理劫持）：
  `curl -s --noproxy '*' -x http://127.0.0.1:7896 …` 或设好 `NO_PROXY=127.0.0.1`。
- ⚠️ Windows 下 curl 走 schannel，经代理做 TLS 会报 `CRYPT_E_REVOCATION_OFFLINE`（吊销列表服务器不可达），
  **不代表代理故障**；加 `--ssl-no-revoke` 后验证 GitHub 可达：
  `api.github.com/zen` 返回正常、`github.com/electron/.../SHASUMS256.txt` HTTP 200。
- pnpm/npm registry 直连可用；GitHub 二进制下载经代理实测成功（sharp libvips 日志明确显示
  `Via proxy http://127.0.0.1:7896 no credentials`）。

## 4. 安装结果与构建脚本偏离结论（Step 3，R3）

命令（后台跑，避免中断写坏 store）：

```bash
pnpm install --frozen-lockfile --store-dir "D:\\pnpm-store"   # 退出码 0，Done in 30m 24.1s (pnpm v10.33.0)
```

完整日志：`D:\verge-install.log`。Packages: +1599。

- **`--ignore-scripts` 回落：未需要。** 两个高危包都拿到了预编译产物：
  - `tree-sitter@0.22.4`：`node-gyp-build` 直接命中包内 prebuilds（`prebuilds/win32-x64/` 存在），
    日志 `install: Done`。
  - `sharp@0.32.6`：经代理下载 libvips-8.14.5-win32-x64 成功，`Integrity check passed`，
    DLL 已复制进 `build/Release`（libvips-42.dll 等在位）。
- 加载实测（本机无 VS Build Tools 也成立，因为全部走 prebuild）：
  `node -e require` 对 `.pnpm` 内绝对路径的 `tree-sitter`、`sharp`，以及
  `@lancedb/lancedb`、`@node-rs/jieba`、`@ast-grep/napi`、`silk-wasm` → 全部 OK。
  （注：`require('tree-sitter')` 在项目根报 Cannot find module 是 pnpm 严格布局的**正常**现象，它们不是直接依赖。）
- pnpm 10 默认拦截未在 `onlyBuiltDependencies` 里的构建脚本：本次仅
  `electron-winstaller@5.4.0` 被跳过（只影响 Windows 安装包打桩，P0 不需要，记此备查）。
- **electron@44.4.3 新行为（重要发现）**：npm 包已**不再带 postinstall 自动下载**（package.json 无 scripts，
  `index.js` 首次使用时惰性跑 `install.js`）。为避免下载混进 dev 启动路径，装完手动执行：

  ```bash
  cd node_modules/electron && source /d/p0-env.sh && export NODE_USE_ENV_PROXY=1 && node install.js
  # → dist/electron.exe 就位（dist 368M），path.txt=electron.exe
  ```

  实测第一次不带 `NODE_USE_ENV_PROXY=1` 报 `TypeError: fetch failed`，带上后成功。
  `D:\electron-cache` 跑完后为 0 —— 该版 install.js 不落 ELECTRON_CACHE（zip 用完即删），
  属预期外小偏离，无后果（二进制已在 dist/）。

## 5. 测试基线（Step 4）——真实数字，非 559 全绿

命令：`pnpm test`（vitest run，pool=forks/maxWorkers=4）。日志：`D:\verge-test.log`。

- **Test Files: 4 failed | 555 passed (559)；Tests: 5 failed | 5362 passed | 1 skipped (5368)，退出码 1。**
  （brief 里"559 tests"实际是 559 个**文件**/5368 个用例，此处按真实口径记录。）
- 5 条失败**全部是 `Error: Test timed out in 5000ms`**（vitest 默认 5s 超时），无断言失败：
  1. `src/main/agui-bridge.test.ts` × 2（"成功桌面对话…" / "v2 pending claim…"）
  2. `src/main/chats/chats-pending-queue.test.ts` × 1（"恢复后的附件…"）
  3. `src/main/orchestrator/harness/cyrene-harness.test.ts` × 1（"轮次内压缩保存检查点…"）
  4. `src/main/orchestrator/tools/document-tools.test.ts` × 1（"write_excel 覆盖已有文件…"）
- 归因：首跑时后台还有 `du -sh node_modules`（磁盘 I/O 风暴）在跑，这批 5s 级超时是**并发 I/O 争用的时间性 flake**。
  证据：单独重跑这 4 个文件 → **4 passed / 155 tests 全过**（`D:\verge-test-rerun.log`）。
- 按 P0 纪律：未修改任何上游测试。结论=基线本质绿色，超时阈值对慢盘敏感；
  后续任务如遇同 5 条超时，先排查磁盘争用再怀疑回归。

## 6. 构建与起窗（Step 5）

- `pnpm run build:main && pnpm run build:preload && pnpm run build:renderer` → 退出码 0
  （renderer `✓ built in 41.22s`，日志 `D:\verge-build.log`）。
- `pnpm dev`（日志 `D:\verge-dev.log`）：vite `ready in 609ms`（http://localhost:5173/），
  Electron 主进程 banner 正常，`core/windows-revealed (at 18456ms)`——**聊天窗出现**
  （PowerShell 枚举到 electron.exe 主窗标题，GBK 控制台下显示为乱码，内容即"昔涟·聊天"类标题）；
  宠物窗为无边框透明窗，`Get-Process.MainWindowTitle` 枚举不到属正常，以 windows-revealed +
  `core/chat-load 7135ms` 两步日志为准。**验证完成后只杀了自己启动的进程树**
  （主 PID 6864 及 6 个子进程，`taskkill /T /F` 全数终止，事后确认无 electron.exe 残留；
  TaskStop 不会级联杀 electron，必须手动按 PID 收）。
- **stderr 中无 `Cannot find module` / 原生模块加载失败**（grep `Cannot find module|ERR_MODULE|MODULE_NOT_FOUND` 零命中；
  `RAG init FAILED` 0 次，`core/initRag 888ms` 成功——§4 的 prebuild 结论在此闭环）。
- dev 期仅有的降级日志（均非阻塞、非本次改动引起）：
  - `[Screenshot] native helper prewarm failed: … cyrene-screenshot.exe ENOENT`
    ——截图助手是独立 Rust 产物（`build:screenshot-helper` 未跑），P0 不需要；
  - `[Reranker] bge-reranker-base 未找到…自动降级为 none`（模型文件不在本机）；
  - `[Memory/RAG] reconciliation skipped: vector store is not writable`（首次无库）；
  - `[WechatBot] No credentials`。
- R2 占用（`du -sh node_modules dist`，实测）：
  - `node_modules`: **2.3G**（du 扫 pnpm 硬链接巨树耗时 >15 分钟，本身是慢盘信号，R2 容量评估时按此量级留余量）
  - `dist`: **244M**
  - 参考：`D:\pnpm-store`: **1.9G**

## 7. 工作树副作用（未提交，留给后续任务知情的偏离）

跑 test/build/dev 后 `git status` 出现两个脏文件（**均未提交、未回滚**，按"只提交 notes"纪律处理）：

1. `dist/renderer/models/cyrene/Cyrene.model3.json`：`build:renderer` 会把 motion3 路径里的
   `#` 重写为 `%23`（vite 资源 URL 规范化）。仓库里跟踪了 dist，所以构建必然弄脏它——
   后续每个涉及 renderer 的任务都会重现，属已知噪音。
2. `src/main/orchestrator/tools/__snapshots__/built-in-tools.snapshot.test.ts.snap`：
   `git diff` 内容为空，纯 LF/CRLF 换行符噪音（core.autocrlf 环境现象）。

## 8. 新机复做清单（self-review 后补）

1. 建 `D:\p0-env.sh`（§2）→ 每条命令先 source；**必须**带 `NODE_USE_ENV_PROXY=1`。
2. `corepack enable --install-directory` 到 D:（管理员机器可直接 `corepack enable`）。
3. `pnpm install --frozen-lockfile --store-dir D:\pnpm-store`（留 30+ 分钟，后台跑）。
4. 进 `node_modules/electron` 手动 `node install.js`（electron 44 无 postinstall）。
5. 跑测试时**不要**并行跑 du/大 I/O 任务，避免制造 §5 那类超时 flake。
