# 实施计划：Clash Verge 全功能整合 + GitHub 同步更新

依据 `docs/verge/specs/2026-10-29-clash-verge-full-integration-design.md`。
每步都按 TDD：先写会红的测试，再实现，再跑门。每个 Wave 结束做本地提交（不推送、不改版本号）。

## Wave 1 数据面与页面

### T1 共享类型与解析（纯函数）

- 新文件 `src/shared/network-detail-types.ts`：
  `RuleEntry`（type/payload/proxy/hits/lastHit）、`LogEntry`（type/payload/time）、
  `ConnectionDetail`（id/host/process/chains/rule/upload/download/start）、
  `ProviderInfo`（name/type/vehicle/updatedAt/nodeCount/alive）、`CoreConfigView`（白名单键）。
- 测试 `network-detail-types.test.ts`：`parseRules` / `parseConnectionsDetail` /
  `parseProviders` / `parseLogLine` / `pickConfigView`。
  先红：喂真实形状（mihomo v1.18 的 `/rules`、`/connections`、`/providers/proxies`、log 行），
  断言字段与容错（坏行返回 null、缺字段用默认值、不抛异常）。

### T2 客户端扩容

- `mihomo-client.ts` 加：`rules()`、`connectionsDetail()`、`closeConnection(id)`、
  `closeAllConnections()`、`providers()`、`providerHealthCheck(name)`、`configs()`、
  `patchConfigs(patch)`、`reloadConfig(path)`、`nodeDelay(name)`、`logs(onLine)`（流）。
- 测试：用假 fetch 断言 URL、方法、`Authorization`、超时；`logs` 流的分行/取消/坏行跳过；
  `patchConfigs` 只发白名单键（多一个键就抛 `bad-response`）。
- 变异预登记：① 删掉 401→unauthorized 映射 → 对应红；② 让 `logs` 不取消 reader → 泄漏测试红。

### T3 服务聚合与 IPC

- `network-service` 加 `fetchRules/fetchConnections/fetchProviders/fetchConfig/saveConfig/
  closeConnection/closeAllConnections/providerCheck/startLogs/stopLogs`，
  缓存与"页面关掉即停流"；日志环形缓冲 500 行。
- `network-ipc` 加 11 条 handler，全部做参数校验；发送方白名单只放 `chat`。
- preload 暴露 `network.rules()` 等；`onLogs` 订阅。
- 测试：服务聚合/缓存/停流；IPC 入参校验（空名、非白名单键、坏 id）。

### T4 页面页签

- `NetworkPanel` 拆 `NetworkTabs`；新增 `RulesView` / `LogsView` / `ConnectionsView` /
  `ProvidersView` / `SettingsView`（设置只读 + 写白名单）。
- 交互：规则搜索防抖 200ms；日志暂停时不再追加；关闭全部连接二次确认；
  providers 单个测速；设置保存后读回比对。
- 测试：每个视图的空态/加载态/错误态；暂停语义；二次确认；i18n key 全量。

### T5 门

`npx tsc` 三份 + 新增单测 + 全量套件；`npx vite build`；真窗探针只验网络页六个页签可开
（不点破坏性按钮）。

## Wave 2 订阅

### T6 profiles 读写纯模块

- 新 `src/main/verge/profiles-store.ts`：读 `profiles.yaml`（保留未知字段）、
  生成 uid、原子写、写前备份、增删改查、`select`、`remove`（禁删 Merge/Script）。
- 测试：真实 profiles.yaml 片段；写入保留 `option`/`extra`；tmp→rename 顺序；
  备份文件名格式；坏 YAML 拒绝且不落盘。

### T7 下载与 runtime config

- 新 `src/main/verge/subscription-fetch.ts`（UA、大小上限、超时、重定向逐跳？订阅可能重定向，
  最多 5 跳且每跳都非上游）、`runtime-config.ts`（merge 链 + 注入控制器/端口）。
- 测试：假 fetch 的 200/302/404/超大/坏 YAML；merge 的 prepend/append 语义；
  注入键覆盖订阅里的 external-controller。

### T8 切换与 IPC/UI

- `profile-service.ts`：导入（URL/文件）、更新、切换（先 runtime 后 current）、删除。
- IPC 8 条；订阅页 UI（列表/当前标记/更新/删除/导入对话框）。
- 测试：切换失败 current 不动；Verge 在跑 → `verge-running` 且零写入（用假进程探测）。

## Wave 3 设置与内核

### T9 设置面

- `verge-settings.ts`：读 `verge.yaml` 白名单键（system proxy / TUN / 端口），写只改目标键。
- `system-proxy.ts`：注册表读写 + 广播（用注入的 exec 假实现测试），状态以读回为准。
- TUN：`PATCH /configs { tun: { enable } }`，失败原因原样翻译。
- UI 设置页：开关 + 端口 + allow-lan/ipv6/log-level + 错误提示。

### T10 内核宿主

- `core-manager.ts`：三态发现、端口探测、spawn/stop/restart、崩溃自愈 3 次、
  日志落 `<userData>/core.log`；`core-source.ts` 纯函数（选二进制/选端口）。
- 测试：假 fs/假 spawn；端口占用 → 换端口；自愈上限。

### T11 内核更新

- `mihomo-update.ts`：GitHub API + digest 校验 + 解压（用系统 `tar`/`Expand-Archive`，
  不引依赖）；失败不动当前内核（先解到临时目录再换）。
- 测试：假响应（有/无 digest、摘要不符、只有 prerelease）。

## Wave 4 客户端更新与锁

### T12 update-service

- 新 `src/main/update/update-service.ts` + `github-release.ts`（纯解析）+ `installer-launch.ts`。
- `app.getVersion()` 与 tag semver 比较；90s 首查 + 6h；只检查不下载；digest 必填。
- 设置页「更新」区：当前版本/最新版本/检查/下载/安装/关闭自动检查。
- 测试：semver 边界、digest 缺失拒绝、下载中断不留半包、重复点击去重。

### T13 锁改写与发布脚本

- `upstream-off.test.ts` A3：改成反向契约（禁 electron-updater/latest.yml，
  要求 `update-service` 在场且只出现两个仓库 URL）。
- 新增 `scripts/release/publish-update.mjs`：`gh release create --repo …` + 上传安装包 + SHA256SUMS。
- 变异自检：删 digest 校验、semver 改字符串比较、白名单放开、Verge-running 闸门删掉。

### T14 真窗验收与文档

- 真窗：六个页签 + 设置读写 + 假更新全流程（本地 HTTP 服务器）。
- 文档：`docs/verge/notes/progress.md` 增「决策反转：从断更新到自研更新通道」；
  更新 `docs/verge/notes/environment-notes.md`（仓库/资产名/权限边界）。
- 本地提交：数据面 / 页面 / 订阅 / 设置内核 / 更新 / 文档。

## 验收口径（每 Wave 都要）

- `npx tsc -p tsconfig.{main,preload,renderer}.json --noEmit` 三份 0。
- 定向单测绿；Wave 末全量 `CI=true npx vitest run` 绿。
- 写盘操作跑「不写 Verge 目录」的负判据（假 fs 断言零写入）。
- 每个新闸门至少有 1 条变异自检，变异后必须红，还原后复绿。
