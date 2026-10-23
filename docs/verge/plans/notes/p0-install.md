# P0 Task 1 实测记录：依赖装到 D: 并跑绿基线

日期：2026-10-17。机器：Windows 11（Git Bash/MSYS2），当前账号**不在** Administrators 组。
基线提交：`6228ea8e`（branch `verge`）。Node：v24.18.0（满足 engines `>=24 <25`）。
首版记录 commit `1f88c543`；本轮按 review 修订的是**记录本身**（§1/§2/§4/§5/§6/§6.1/§7/§8）加两次补测，
安装未重做、store 未删，`node_modules` / `D:\pnpm-store` / 构建产物都是既有状态。

## 1. pnpm 调用形式（Step 1，R3 偏离之一）

- `corepack enable` 按预期失败（非管理员，要写 `C:\Program Files\nodejs\pnpm.CMD`）：
  `EPERM: operation not permitted, open 'C:\Program Files\nodejs\pnpm.CMD'`
- **实际可用的调用形式**（见下方偏离说明；这不是 brief 的预案）：

  ```bash
  export COREPACK_HOME='D:\corepack-home'                     # corepack 缓存钉在 D:，不落 C:
  corepack enable --install-directory 'D:\corepack-bin'       # 成功，exit 0
  export PATH="/d/corepack-bin:$PATH"
  cd D:/Test/workbuddy/cyrene-verge
  pnpm --version   # → 10.33.0（仓库内按 package.json packageManager 解析；仓库外会回落 12.14.0，注意）
  ```

- **偏离定性（修正）**：brief:19 给出的唯一备选是改成 `corepack pnpm@10.33.0 install …` 的调用形式；
  `corepack enable --install-directory` **不在 brief 里**，是本任务自己的偏离（R3 记一条）。
  偏离理由：`package.json:41` 的 `dev` 脚本内部 shell 出去调**裸 `pnpm`**
  （`pnpm run build:main && … && concurrently "vite --strictPort" "…"`），并发子进程没法带上
  `corepack pnpm@10.33.0` 前缀，只有 PATH 上真存在 `pnpm` 这条命令才跑得通；
  所以选了 install-directory，而不是 brief 的前缀调用形式。代价：`D:\corepack-bin` 是新增目录，
  每个新 shell 必须先 source 环境脚本（下一节）。
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
export NODE_USE_ENV_PROXY=1   # 必须：Node 24 的 fetch 只认这个开关才读上面的代理（缺了 sharp/electron 下载就死）
export electron_config_cache='D:\electron-cache'   # 必须：electron 44 的 install.js 只读这个变量，不读 ELECTRON_CACHE（见 §4）
```

- 本块是唯一事实源，本机 `D:\p0-env.sh` 已同步为同一组变量（仅 `NO_PROXY` 那行在原文件里拆成
  赋值 + `export` 两行，等价）。复测补进去的两行是 `NODE_USE_ENV_PROXY=1` 和
  `electron_config_cache=D:\electron-cache`；此前它们只在散文里出现，
  直接复制本块的人会踩 §4 记录的 `TypeError: fetch failed` 和 C: 落缓存。

- 目录建立：`mkdir -p /d/pnpm-store /d/npm-cache /d/electron-cache` ✅。
- **未**创建项目 `.npmrc` ✅（避免第 6 处上游文件改动；用户级 `~/.npmrc` 也不存在）。
- C: 侧新增缓存（复测更正）：`~/.cache` 确实只有既有的 codex-runtimes/torch，corepack 因
  `COREPACK_HOME` 指到 D: 也没在 `~/.cache/node/corepack` 留东西——**但 `~/.cache` 不是唯一入口**：
  Electron 二进制归档实际落在了 `C:\Users\damin\AppData\Local\electron\Cache\`（151M，见 §4）。
  另记（非缓存）：跑 `pnpm dev` 会创建应用自身的数据目录 `C:\Users\damin\AppData\Roaming\Cyrene\`，
  这是 userData 不是下载缓存，P0 不归它管，Task 3（R6 userData 隔离）才是它的归属。
- 关键补充：Node 24 的 `fetch` 默认**不**读 `HTTP(S)_PROXY` 环境变量，需要
  `export NODE_USE_ENV_PROXY=1`（已并入上方环境块），否则 sharp/electron 的下载器报 `TypeError: fetch failed`（实测踩过）。
  漏掉它还有第二条更隐蔽的路径：`node_modules/electron/index.js:33-41` 在首次 `require('electron')` 时才惰性跑
  `install.js`，届时在 `pnpm dev` 里抛 "Electron failed to install correctly"，看起来像构建问题而不是代理问题。

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
- **`ELECTRON_CACHE` 为什么是空的（复测查明，不是"zip 用完即删"）**：
  `node_modules/electron/install.js:44` 传给 `@electron/get` 的是
  `cacheRoot: process.env.electron_config_cache`——**只读 `electron_config_cache` 这一个变量**，
  `ELECTRON_CACHE` 整个链路无人消费。`cacheRoot` 为 undefined 时
  `@electron/get@5` 回落 `envPaths('electron').cache`，Windows 上即
  `C:\Users\damin\AppData\Local\electron\Cache\`。实测该目录确有本次下载的归档：
  ```
  C:\Users\damin\AppData\Local\electron\Cache\bb424f90…\electron-v44.4.3-win32-x64.zip   151M  (mtime 12:51)
  ```
  ⇒ 后果一（违反 P0 硬规则）：这 151M 落在 C:，"缓存全部留在 D:" 在 electron 这条路径上是破的；
  复测已把归档按同一哈希目录复制到 `D:\electron-cache\bb424f90…\electron-v44.4.3-win32-x64.zip`
  （158247567 字节；哈希目录名 = `sha256("https://github.com/electron/electron/releases/download/v44.4.3")`
  = `bb424f9061e7a2927a7fcc04709593fe81ac4633e2cd40456f2ef431743b1ee7`，已用 @electron/get 的 `Cache.getCacheDirectory`
  同一算法离线复算核对，所以 `cacheRoot=D:\electron-cache` 能直接命中），C: 原件未删。
  ⇒ 后果二（下游任务）：P3 打包（`electron-builder` / `package:win:dir`，package.json:40）走同一个
  `@electron/get`；没有这条 pin 时它会再次经代理下载同一个 zip 并写进 C:，
  且新机上如果忘了 `NODE_USE_ENV_PROXY=1` 就当场 `TypeError: fetch failed`。
  ⇒ 处置：§2 环境块已加 `export electron_config_cache='D:\electron-cache'`（本机 `D:\p0-env.sh` 同步）。

## 5. 测试基线（Step 4）——真实数字，非 559 全绿

命令：`pnpm test`（vitest run，pool=forks/maxWorkers=4）。日志：`D:\verge-test.log`。

- **Test Files: 4 failed | 555 passed (559)；Tests: 5 failed | 5362 passed | 1 skipped (5368)，退出码 1。**
  （brief 里"559 tests"实际是 559 个**文件**/5368 个用例，此处按真实口径记录。）
- 5 条失败**全部是 `Error: Test timed out in 5000ms`**，无一条断言失败：
  （5s 不是 vitest 默认值——`vitest.config.mts:6` 写的是 `testTimeout: process.env.CI ? 30_000 : 5_000`，
  即**本仓库自己**在非 CI 下把阈值定在 5s、CI 下 30s；对慢盘的敏感度是配置带来的，不是框架默认。）
  1. `src/main/agui-bridge.test.ts` × 2（"成功桌面对话…" / "v2 pending claim…"）
  2. `src/main/chats/chats-pending-queue.test.ts` × 1（"恢复后的附件…"）
  3. `src/main/orchestrator/harness/cyrene-harness.test.ts` × 1（"轮次内压缩保存检查点…"）
  4. `src/main/orchestrator/tools/document-tools.test.ts` × 1（"write_excel 覆盖已有文件…"）
- **归因定性：原因「推断」而非「证实」（复测更正）。** 首跑时后台确有 `du -sh node_modules` 在抢磁盘，
  但"单独重跑这 4 个文件 → 4 passed / 155 tests"（`D:\verge-test-rerun.log`）一次改了三个变量
  （du 已退出、并行文件数从 559 降到 4、装了 30 分钟 + 跑完一整轮后的页缓存是热的），
  它只能证明"这 5 条用例能通过"，加上"全是 `Test timed out`、零断言失败"能排除逻辑回归之外，
  **不能把 `du` 单独指认为凶手**。
- 复测把"无并发 I/O 的全量跑"补上了（本任务的关键基线数字，后续任务都对着它比）：

  | 命令 | 并发 I/O | testTimeout | 结果 | 用时 | 退出码 | 日志 |
  |---|---|---|---|---|---|---|
  | `pnpm test`（原始首跑） | 有 `du -sh node_modules` | 5s | Files 4 failed / Tests **5 failed \| 5362 passed \| 1 skipped (5368)** | — | 1 | `D:\verge-test.log` |
  | `pnpm test`（复测：无 du、无 build、无 electron，串行独占磁盘） | **无** | 5s | Files **1 failed \| 558 passed (559)** / Tests **1 failed \| 5366 passed \| 1 skipped (5368)** | 176.84s | 1 | `D:\verge-test-clean-baseline.log` |
  | `CI=true pnpm test`（只改超时到 30s，源码里没有任何地方读 `process.env.CI`，除 vitest.config.mts:6） | 无 | 30s | Files **559 passed (559)** / Tests **5367 passed \| 1 skipped (5368)** | 150.58s | **0** | `D:\verge-test-ci30s.log` |

- 结论（按实测口径）：
  1. `du` **不是必要条件**——磁盘独占时同一批 5s 超时仍复现了 **1 条**
     （`src/main/agui-bridge.test.ts > agui-bridge sticker event ordering > 成功桌面对话把来源、模式和 canonical runId 交给收尾回调`，5023ms），
     另外 4 条这次自己过了。所以正确说法是"**本盘上全量 559 文件 / maxWorkers=4 的跑法贴着 5s 阈值**，
     并发 I/O 只会放大它"，不是"du 造成的 flake"。
  2. 未出现新的失败类型、未出现断言失败 ⇒ 基线**没有逻辑回归**，可用。
  3. **后续任务（Task 2-12）跑测的推荐口径：`CI=true pnpm test`**（30s 阈值，实测全绿 exit 0，150s）。
     按字面 `pnpm test` 的话，请把"偶发 1~5 条 `Test timed out in 5000ms`"当作本仓非 CI 阈值下的已知噪音，
     **不得**据此放行回归，也不得据此判定回归——用 `CI=true` 复跑一次再定性。
- 复测环境备注：5173 上仍挂着一个上一轮 dev 跑剩的 vite 进程（PID 16808，13:04:36 启动，非本次启动，
  按"不动别人起的进程"纪律没有杀它）。两次全量跑期间它累计只走了 0.17s CPU（29.98→30.16），
  属空转，可视为未参与磁盘争用。

## 6. 构建与起窗（Step 5）

- `pnpm run build:main && pnpm run build:preload && pnpm run build:renderer` → 退出码 0
  （renderer `✓ built in 41.22s`，日志 `D:\verge-build.log`）。
- 首跑 `pnpm dev`（日志 `D:\verge-dev.log`）：**当时刻录下来的窗口验收不成立**。本文首版
  （commit `1f88c543`）写的是"聊天窗出现、宠物窗以 `windows-revealed` + `core/chat-load` 为准、
  透明窗枚举不到属正常"。
  复测（见 §6.1）把这三句全部推翻，正确结论在下面。进程清理方面：那次确实只杀了自己启动的
  electron 树（主 PID 6864 + 6 子，`taskkill /T /F`，事后无 electron.exe 残留），
  但 **concurrently 里的 vite 没跟着死**——PID 16808（`node …\vite\bin\vite.js --strictPort`，13:04:36 起）
  至今仍占着 5173。它不是本次启动的进程，按纪律没杀；**后续任务自己跑 `pnpm dev` 前必须先收掉它**，
  否则 `vite --strictPort` 直接起不来（TaskStop 也不会级联杀 vite）。
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

### 6.1 宠物窗验收：复测后的实测结论（Task 5/7/10 继承的基线，按这条，不按上一版）

**为什么 `core/windows-revealed` 证明不了宠物窗**（先承认这条证据链本来就不成立）：
`src/main/application/core-bootstrap.ts:248-255` 调的是
`revealStartupWindows({ splashWindow, chatWindow, onboardingWindow, showOnboardingWindow: !disclaimerAccepted, … })`，
**宠物窗根本没被传进去**；`:257` 的 `core/windows-revealed` 只是这次 await 之后的打点。
`src/main/startup/startup-window-reveal.ts:25` 的注释自己写明"桌宠不属于通用 reveal"，
`:41-45` 的逻辑是 `showOnboardingWindow ? onboarding.show() : chat.show()`——二选一。
`core/chat-load`（`core-bootstrap.ts:179`）是聊天页加载器，与宠物窗无关。
⇒ 这两个日志能证明的最强命题只有"splash 关闭 + 欢迎窗**或**聊天窗之一被 show"，
对宠物窗可见性**零区分度**；"无边框透明窗枚举不到"这句也因此无法被证伪。

**判别性检查（本轮实测，两条独立证据）**：

1. *读活设置文件*：`C:\Users\damin\AppData\Roaming\Cyrene\app-settings.json` **不存在**
   （dev 期 userData 实测就是这条路径，日志里 `[Screenshot] helper output-dir = …\Roaming\Cyrene\screenshots` 可对照）。
   于是 `loadGeneralSettings()` 全走默认：`petVisible: true`（`src/main/settings/settings-facade.ts:49`），
   而 `disclaimerAcceptedVersion` 缺省被 normalize 成**空串**（`:127` 默认值、`:349-351` normalize，
   空串 ≠ `undefined`）⇒ `hasCurrentDisclaimerConsent()`（`src/main/windows/window-manager.ts:107-110`）
   对着 `CURRENT_DISCLAIMER_VERSION = "2026-09-27"`（`src/shared/disclaimer.ts:2`）判 false
   ⇒ `core-bootstrap.ts:193` 实际执行的是 `createPetWindow(petVisible && disclaimerAccepted)` = **`createPetWindow(false)`**
   ⇒ `window-manager.ts:197-208` `showOnReady=false` ⇒ `setPetWindow` 走 else 分支
   `schedulePetWindowResourceRelease`（`:158`）⇒ **30s 后 `window.destroy()`**
   （`:97-105`，`PET_WINDOW_RESOURCE_RELEASE_DELAY_MS = 30_000` 在 `:20`）。
2. *临时插桩 + 真实窗口枚举*（枚举含不可见窗，标题按 UTF-16 取，不存在 GBK 乱码问题）：

   A. 默认（未接受免责声明）这台机器现在的状态——`[PetProbe]` 三行 + `EnumWindows`：
   ```
   [PetProbe] created      showOnReady=false isVisible=false bounds={"x":760,"y":266,"width":400,"height":500} settings={"petZoom":1,"petAlwaysOnTop":true,"disclaimerAcceptedVersion":""}
   [PetProbe] ready-to-show showOnReady=false isVisible=false bounds={…400x500} destroyed=false
   [PetProbe] +8s          isVisible=false bounds={…400x500} url=http://localhost:5173/
   EnumWindows(含 invisible, 启动后 ~40s):   electron 7 个 PID 名下共 14 个顶层窗，**没有 400x500 的宠物窗**（已被 30s 释放定时器 destroy）
       唯一 vis=True 的业务窗: rect=(512,106)-(1408,934) 896x828  title='昔涟 · 聊天（React）'  ← 这是**欢迎/免责声明窗**
                               （窗口创建尺寸 880x820 + 边框 = 896x828、center:true 与 workArea 居中吻合；
                                标题不是 "欢迎使用 Cyrene" 是因为 onboarding 也加载 `/react/`，
                                document.title 覆盖了 BrowserWindow 的 title 选项）
                               聊天窗本体: rect=(145,72)-(1774,968) 1629x896  vis=**False**
   ```
   B. 同一份构建、只把设置喂成"已接受免责声明"（用 `--user-data-dir='D:\cyrene-p0-probe'`，
      目录里手写 `app-settings.json = {"disclaimerAcceptedVersion":"2026-09-27"}`，全部留在 D:）：
   ```
   [PetProbe] created       showOnReady=true  isVisible=false bounds={"x":760,"y":266,"width":400,"height":500}
   [PetProbe] ready-to-show showOnReady=true  isVisible=**true**  bounds={…400x500} destroyed=false
   [PetProbe] +8s           isVisible=**true**  bounds={…400x500} url=http://localhost:5173/
   EnumWindows: PID=17696 vis=**True** rect=(760,266)-(1160,766) 400x500 class='Chrome_WidgetWin_1' title='Cyrene'
                聊天窗同时 vis=True 1629x896 title='昔涟 · 聊天（React）'
   ```
   （注意 `layered=False`：这台机的 Electron 44 透明宠物窗**并不带** `WS_EX_LAYERED`，
   但它是**可枚举、可判可见**的——"透明窗枚举不到"这句本身就是错的。）

**验收结论（改写 brief:53-57 那句"宠物窗与聊天窗出现"）**：
- P0 基线在**全新 profile** 下并不满足字面验收：宠物窗只被创建、随即被 30s 资源释放定时器销毁，
  屏幕上出现的是**免责声明/欢迎窗**（聊天窗被创建但没 show）。
- 宠物窗**能**出现且可见、尺寸 400x500、位置取 `petWindowX/Y`（缺省居中到 (760,266)），
  前提是 `petVisible=true` **且** `disclaimerAcceptedVersion` 等于当前版本。
- 对 Task 5/7/10 的实际含义：宠物窗工厂重写后要用**已接受免责声明的 profile** 验收，
  否则会看到"窗口根本没创建出来"的假象；判可见性别再看 `windows-revealed`，
  用 `win.isVisible()/getBounds()` 或含不可见窗的 `EnumWindows`（脚本留在 `D:\verge-enum.ps1`，
  输出 `D:\verge-enum-noconsent.txt` / `D:\verge-enum-accepted.txt`）。
- 插桩是**临时**的：`src/main/startup/create-pet-window.ts` 已 `git checkout --` 还原，
  随后 `pnpm run build:main` 重编译（`grep -c PetProbe dist/main/main/startup/create-pet-window.js` = 0），
  本任务提交只含本 notes 文件。

## 7. 工作树副作用（未提交，留给后续任务知情的偏离）

跑 test/build/dev 后 `git status` 出现的脏文件（首版按"只提交 notes"纪律**未提交、未回滚**；
本轮复测后的实际处置见各条）：

1. `dist/renderer/models/cyrene/Cyrene.model3.json`：`build:renderer` 会把 motion3 路径里的
   `#` 重写为 `%23`（vite 资源 URL 规范化）。仓库里跟踪了 dist，所以构建必然弄脏它——
   后续每个涉及 renderer 的任务都会重现，属已知噪音。
2. `src/main/orchestrator/tools/__snapshots__/built-in-tools.snapshot.test.ts.snap`：
   `git diff` 内容为空，纯 LF/CRLF 换行符噪音（core.autocrlf 环境现象）。
   复测两轮全量 `pnpm test` 又把它弄脏了一次（同样空 diff），提交前已 `git checkout --` 还原。
3. 复测轮**没有**跑 `build:renderer`（只做 `build:main`），所以第 1 条的 `#`→`%23` 脏文件本轮未出现；
   `git status` 在提交前是干净的，提交只含本 notes 文件。

## 8. 新机复做清单（self-review + 复测后补）

1. 建 `D:\p0-env.sh`（与 §2 的块同一组变量，只有 `NO_PROXY` 写法不同）→ 每条命令先 source。少 `NODE_USE_ENV_PROXY=1`
   就在 sharp/electron 下载处 `TypeError: fetch failed`；少 `electron_config_cache` 就有 151M 落到 C:。
2. `corepack enable --install-directory` 到 D:（管理员机器可直接 `corepack enable`）；
   注意这是**本任务的偏离**，不是 brief 预案，理由见 §1。
3. `pnpm install --frozen-lockfile --store-dir D:\pnpm-store`（留 30+ 分钟，后台跑）。
4. 进 `node_modules/electron` 手动 `node install.js`（electron 44 无 postinstall）。
5. 跑测试**用 `CI=true pnpm test`** 作为验收口径（30s 阈值，实测 559 files / 5367 tests 全绿，150s）；
   裸 `pnpm test` 在本盘贴 5s 阈值，会偶发 `Test timed out in 5000ms`（§5）。
   两种跑法都不要并行 du/大 I/O 任务。
6. 跑 `pnpm dev` 前先确认 5173 空闲：上一轮 dev 的 vite 不会被 TaskStop / concurrently 带走
   （§6 复测备注），`vite --strictPort` 撞上就整轮起不来；杀 electron 要按 PID 收，不级联。
7. 宠物窗验收看 §6.1：要"已接受免责声明"的 profile，判据是 `isVisible()`/`getBounds()`
   或含不可见窗的 `EnumWindows`，**不要**引用 `core/windows-revealed`。

## 9. Task 3 实测记录：实例身份与 userData 隔离（R6）

三条裁决的实测口径都在这一节：§9.1 更正 plan 里"切身份会复制旧数据"的说法，并记下 R6 **没覆盖**的
channels 密钥轮换例外；§9.2 记 `--user-data-dir` 与身份覆盖的优先级（修复轮已改成显式开关赢）；
§9.3 记隔离取证；§9.4 记顺序测试；§9.5 记修复轮新增的顺序约束——日志落盘目录不能在模块加载期捕获。

### 9.1 切身份后的首启行为 = 全新用户态，不复制任何东西（更正 Task 3 Step 4 的"后果"段）

plan 原文写"身份一改，`migrateLegacyUserData()` 的搬运目标变成 `cyrene-verge`，
首次启动会从旧目录复制一份数据过来"。**本机不成立**，理由与实测：

- 代码事实（`src/main/user-data-migration.ts:60-72`）：搬运源恒为
  `LEGACY_USER_DATA_DIR_NAME = "live2d-cyrene"`，它**不读 `Cyrene`**。旧目录不存在时直接返回
  `status="none"`，一个字节都不搬。
- 环境事实（实测）：`%APPDATA%` 下只有 `Cyrene`（246M，含 `.legacy-user-data-migrated`），
  `live2d-cyrene` 不存在。
- 首启实测（14:24:17，`pnpm dev`，临时 stderr 探针，提交前已回滚）：
  - `migrateLegacyUserData status=none target=C:\Users\damin\AppData\Roaming\cyrene-verge`
  - 新目录内容是一份干净的空账本（Chromium 的 `Cache/`、`Local Storage/`、空的 `cyrene.sqlite` 等），
    没有任何上游会话/记忆/设置数据。
  - `.legacy-user-data-migrated` **确实写进了新目录**：`{"status":"none","completedAt":"2026-10-17T06:24:17.931Z"}`。
    机制：迁移闭包先用 `app.getPath("userData")` 取 target，目录在这一步就被创建（目录 mtime `17.929`，
    早于 ready 之后的 `Cache/` 等 `17.99`），所以 `user-data-migration.ts:68-70` 的
    "目标在、旧目录不在 ⇒ 补记完成标记"分支命中。**这条标记是好事**：以后即使用户再跑一次 1.2.x 旧版
    重建出 `live2d-cyrene`，fork 也不会再把它并进来。
- ⇒ R6 的真实语义：**fork 与上游各写各的账本，且 fork 起步就是新用户**（全新 profile）。
  连带后果见 §9.2。

**R6 没有覆盖全部账本：identity 一变，channels 的混淆密钥就轮换**（修复轮补记，Important #3）

上面"各写各的账本"只说到目录，没说**同一份数据跨目录搬运后还能不能解出来**。有一个子系统会坏：

- 机制（源码事实）：`src/main/channels/settings-store.ts:51-56` 的 `getMachineKey()` 用
  **`app.getPath("userData")` 绝对路径 + `app.getName()`** 做 SHA256 当 XOR 混淆 seed；
  同文件 `:71-82` 的 `deobfuscate()` 只做前缀判断、没有完整性校验，解错了也**不报错**。
  所以 seed 一变（目录从 `…\live2d-cyrene`/`…\Cyrene` 变成 `…\cyrene-verge`，名字也从 `Cyrene`
  变成 `cyrene-verge`，两个因子同时变），`obf:<base64>` 字段会**静默解成乱码**。
- 触发条件：**装了旧版、存在 `%APPDATA%\live2d-cyrene` 的机器**。那种机器上
  `user-data-migration.ts:79-90` 走 `renamed`（旧目录整体改名成新目录）或 `merged`（逐项并入）分支，
  把 `channels-settings.json` **原字节**搬进 `cyrene-verge` —— 文件还在、字段还带 `obf:` 前缀、
  载入不抛错，但飞书/QQ 的 AppSecret、Token、Encrypt Key 解密结果是垃圾，机器人凭证当场失效且无提示。
  本机不触发：`live2d-cyrene` 不存在，迁移返回 `status="none"`，一个字节都没搬（见上面的实测）。
- 不受影响的：`enc:` 字段走 safeStorage（Windows DPAPI 绑的是**登录账户**，不是目录/应用名），
  搬过去照样能解；`plain:` 本来就没密钥。
- 本任务**不修**（P0/P1 完全不碰 channels），也没有可用的观测点：这条只能在"有 `obf:` 存量数据
  的机器"上才会暴露。后续真要修的方向（任选，别默认它已经发生）：让 seed 与 userData/应用名解耦
  （存一份随目录走的固定 key），或给 `deobfuscate` 加完整性校验（MAC/校验位）从而能报"密钥变了"
  而不是返回垃圾，或在 `decryptField` 失败时降级成"要求用户重新填"的显式状态。
  **在那之前，任何"把上游 userData 搬进 fork 目录"的任务都要先把这条列进风险。**

### 9.2 `--user-data-dir` 与身份覆盖的优先级（修复轮已改：显式开关赢）

**历史（bc37b32b 当时）**：`configureVergeIdentity` 在 `app.ready` 之前无条件调
`app.setPath("userData", …)`，而 `setPath` 的优先级**高于** Chromium 的命令行开关，于是显式给的
`--user-data-dir` 被静默吞掉。实测（同一构建，临时探针）：

```
[probe] argv=["--user-data-dir=D:/task3-udd-probe"] userData=C:\Users\damin\AppData\Roaming\cyrene-verge
```

开关写法正确、目录 `D:/task3-udd-probe` 也被 Chromium 建了出来，但 `app.getPath("userData")` 仍解析到
`%APPDATA%\cyrene-verge`。⇒ §6.1 里"用 `--user-data-dir=D:\cyrene-p0-probe` 拿一个已同意免责的 profile
来验宠物窗"这条路当时失效，且**没有任何日志说明被覆盖**（优先级反转是静默的）。

**修复轮（本任务之后的提交）**：`configureVergeIdentity(app, appDataDir, argv = process.argv)` 先认开关
（纯函数 `hasExplicitUserDataDir(argv)`，认 `--user-data-dir=<path>` 与 Chromium 等价的单短横线写法），
显式给过就**跳过 `setPath`**，返回值里的 `userDataPath` 改成 `app.getPath("userData")` 真正解析出来的那个，
并打一条 warn（默认可见级别就是 warn，用 info 会被吞）：

```
WARN  Runtime          检测到显式 --user-data-dir，跳过 fork 的 userData 覆盖，本次实际使用：D:\task3fix-udd-probe
```

实测（15:33:34，`electron . --user-data-dir=D:/task3fix-udd-probe`）：Chromium 子进程（gpu-process /
network service / renderer）的命令行都变成 `--user-data-dir="D:\task3fix-udd-probe"`，日志与账本都落在
该目录（`logs/cyrene.log`、`cyrene.sqlite`、`Local Storage/` …），`%APPDATA%\cyrene-verge` 那一轮**没有**
新增字节。⇒ **§6.1 的屏幕层验收路径恢复可用**（Task 1 定的 `--user-data-dir=D:\cyrene-p0-probe` 喂免责声明
的机制重新有效）。`setName` 仍无条件执行：单实例锁按名字建，显式指定的目录同样与上游账本隔离，R6 不受影响。

### 9.3 隔离取证（替代 plan Step 5 的"关掉上游做对照"）

**禁动上游**（用户裁决）：不启停/聚焦/结束已安装的上游 Cyrene，不读写 `%APPDATA%\Cyrene`。据此换三条证据链：

1. **身份与目录真的换了**（dev 期临时 stderr 探针，提交前已回滚；`pnpm dev` 首启 14:24:17）：
   `setName=cyrene-verge app.name=cyrene-verge userData(set)=C:\Users\damin\AppData\Roaming\cyrene-verge
   app.getPath("userData")=C:\Users\damin\AppData\Roaming\cyrene-verge app.getPath("appData")=C:\Users\damin\AppData\Roaming`
   进程树层面也一致：Chromium 子进程（gpu-process、network service）自带的
   `--user-data-dir="C:\Users\damin\AppData\Roaming\cyrene-verge"`。
2. **锁在新身份下仍然工作**：主实例（7 个 electron 进程）存活时再起一个同身份实例（`pnpm start`），
   第二进程只打印身份探针就 `exit 0`，日志里**没有** `migrateLegacyUserData` 那一行
   ⇒ `prepareBeforeReady` 在迁移之前就返回 `isPrimaryProcess=false`；主实例 7 进程不受影响。
   - ⚠️ plan/裁决里"新目录应含自己的 `SingletonLock`"这条**在 Windows 不成立**：实测
     `Cyrene` 与 `cyrene-verge` 两个目录里都没有 `SingletonLock/SingletonSocket/SingletonCookie`
     （`user-data-migration.ts:23` 列这些名字是给 POSIX 打包版的）。Windows 上 Chromium 的
     `ProcessSingleton` 用命名互斥体而不是目录里的锁文件；互斥体名取自 userData 路径这一层是
     **源码推断、本机未直接测量**，测到的是"userData 已独立 + 第二实例被同一把新锁拒之门外"。
     要真正测出"与上游不再抢锁"，只能等一台同时装了上游且允许启停它的机器，或改为读互斥体名。
3. **上游账本没被碰过**：dev 前后各取一次 `%APPDATA%\Cyrene` 顶层 `ls -la --time-style=full-iso` 快照对比，
   31 个条目的名称/大小/mtime 全等；唯一差异是 `..`（父目录 `%APPDATA%` 因为新建 `cyrene-verge` 改了 mtime）。
   再加两道：`find "$APPDATA/Cyrene" -newermt "2026-10-17 14:20:00"` **零命中**（整棵子树未被写过）、
   `du -sh` 仍是 246M。收尾只收自己起的 PID（`taskkill //T //F //PID`），5173 已确认释放。

### 9.4 顺序约束的测试（R6 的全部意义所在）

`src/main/application/pre-ready.test.ts`：`configureIdentity` 进入调用序列，并新增独立用例断言
`calls.indexOf("configure-identity") === 0` 且严格早于 `single-instance-lock`/`migrate-user-data`/
`gpu-switches`/`gpu-acl`；非主进程分支也断言身份已配好（拿不到锁正是因为它按新名字去争）。
- RED（实现前）：该文件 3 条红 —— 顺序数组缺 `configure-identity`、`indexOf` 返回 `-1`、
  `configureIdentity` 未被调用；`app-identity.test.ts` 整文件红（`Cannot find module './app-identity'`）。
- GREEN（实现后）：`CI=true pnpm vitest run src/main/app-identity.test.ts src/main/application/pre-ready.test.ts`
  ⇒ 2 files / 10 tests 全绿。
- 全量口径（§5）：`CI=true pnpm test` ⇒ **exit 0，561 files / 5375 passed + 1 skipped**，127.86s。
  相对 Task 1 基线（559/5367+1）的增量 = Task 2 的 `update-policy.test.ts` + Task 3 的
  `app-identity.test.ts`（3 条）与新增顺序用例（1 条），无测试丢失。
- `pnpm run check:main` 通过（`PreReadyDependencies` 新增必填成员后组合根仍编译；组合根只有
  `default-dependencies.ts` 一处实现，`application.ts` 不感知）。

### 9.5 修复轮的顺序约束：`userData` 的**捕获点**也必须晚于身份（Important #1）

"身份要在取锁前配好"还不够——**任何把 `app.getPath("userData")` 的结果长期记住的东西**都算一个读取点。
`src/main/logger.ts` 原来在模块顶层就 `installFileLogSink(app.getPath("userData"))`，而入口
`src/main/index.ts` 的 import 图（`index → application/default-dependencies.ts → ../logger`）
早于 `application.prepareBeforeReady()`，那一刻 `productName`（`package.json:3` = `Cyrene`）决定的还是
上游目录；`log-sink-file.ts:85-87` 把路径闭包进 sink（`mkdirSync(userDataDir/logs)` + 每行 `appendFileSync`），
于是 fork 的启动 warn/error **永久**写进 `%APPDATA%\Cyrene\logs\cyrene.log`。目录侧的痕迹本机可见：
`%APPDATA%\Cyrene\logs\`（空目录，mtime 2026-10-17 13:04:37）就是修复前的构建留下的。

修复：模块顶层只留级别解析，落盘接收器改由导出的 `installMainLogSink()` 安装，调用点唯一——
`default-dependencies.ts` 的 `configureIdentity` 闭包里紧跟 `configureVergeIdentity()` 之后。
实测（15:24:00，`electron .` + `CYRENE_LOG_LEVEL=info`）：日志落在
`%APPDATA%\cyrene-verge\logs\cyrene.log`（2575 字节），`%APPDATA%\Cyrene\logs\` 前后都**零文件**、
mtime 未变，整棵 `%APPDATA%\Cyrene` 子树 `find -newermt 15:00` 零命中。
测试锁在 `src/main/logger.test.ts`：仅 import 不得创建上游目录的 `logs/`，安装后的 sink 绑的是
身份改动之后的目录，且重复安装幂等。

**给下游的规则**：新代码不要在模块顶层读 `app.getPath("userData")` 并缓存结果；要么延迟到调用时读，
要么挂到 `configureIdentity()` 之后。

