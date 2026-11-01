# Clash Verge 全功能整合 + GitHub 同步更新（2026-10-29）

## 0. 为什么现在做

2026-10-19 的 P4 个人化改造刻意断掉了「官网公告 / 上游 GitHub / 更新器」三条通道，
Mochi 只保留"读 Verge 数据、用它的控制器"的协作姿态。2026-10-29 用户明确改口：

> 「clash verge 的所有功能都整合进入客户端，并且随时接入 GitHub 版的同步更新」

这是一次**决策反转**，不是新增小功能：断更新是 P4 的显式契约（`publish: null`、
`src/main/egress/upstream-hosts.ts`、`no-publish-config.test.ts`、`installer-artifacts.mjs`
的 `assertNoUpdateFeed`），现在要把「更新」重新接回来，同时**不许破坏个人化**
（猫色板、猫娘形象、`Mochi` 身份、品牌锁）。本文记录新契约、边界与验收。

## 1. 目标（可判定的四条）

1. **Clash Verge 的主干功能在 Mochi 里都能用**，不再需要打开 Verge 窗口：
   概览/节点（已有）＋ **规则、日志、连接明细、入站（providers）、订阅（profiles）、
   设置（端口/allow-lan/ipv6/日志级别/系统代理/TUN）**。
2. **内核与客户端都能从 GitHub 更新**：客户端从 fork 的 Release 拉安装包，
   内核从 MetaCubeX/mihomo 的 Release 拉压缩包；两者都要校验摘要、可回滚、可关闭。
3. **个人化不被更新覆盖**：更新只替换二进制与打包资源；品牌、色板、形象来自源码，
   更新包天然携带同一套身份；身份锁（`brand-consistency.test.ts` 等）继续在。
4. **不把用户已有的代理搞坏**：Verge 正在运行时 Mochi 不抢内核、不写 Verge 的文件；
   Mochi 自起内核只发生在「控制器不可达」时。

## 2. 不可逆决策

### D1 单写者：文件级写操作只在 Verge 不在跑时发生

- 读：任何时候都允许（`controller-config.ts` 已是只读）。
- 控制器写（模式/节点/测连接/关闭连接/PATCH 配置）：任何时候都允许——这些是内核 API，
  两个客户端同时调用不会互相踩文件。
- **文件级写**（profiles.yaml、profiles/*.yaml、verge.yaml、runtime config）：先探测
  `clash-verge.exe` 是否在跑（`tasklist` 或 `process.kill(pid,0)` 同源进程枚举）。
  在跑 → 返回 `verge-running`，UI 说「Clash Verge 正在运行，先退出它再由我接管」，
  不写入。理由：两个进程各自持有一份内存态，谁后写谁赢，静默丢改动比拒绝更糟。

### D2 内核宿主三态：external / installed / bundled

- **external**：控制器可达（9097 或发现到的端口）→ 直接用，不启进程。默认态。
- **installed**：控制器不可达且本机有 `C:\Program Files\Clash Verge\verge-mihomo*.exe`
  → 以 `-d <Mochi core dir> -f <runtime config>` 启动它（只读借用二进制）。
- **bundled**：两者都没有 → 从 `MetaCubeX/mihomo` 的 GitHub Release 下载
  `mihomo-windows-amd64-v*.zip`，校验 `digest`（GitHub API `assets[].digest` 的
  `sha256:` 前缀）后解压到 `%LOCALAPPDATA%\Mochi\core\`。
- 端口：默认 mixed 7897 / controller 9097；被占则从 17890 起找空闲，
  写进生成的 runtime config 并记进 Mochi 自己的状态文件（不改 Verge 的 verge.yaml）。
- 启动/停止/重启由 `core-manager` 负责；崩溃自愈最多 3 次，之后只报原因。

### D3 更新：自研 update-service，不引入 electron-updater

- 理由：`electron-builder` 的 `publish` 会产出 `latest.yml`，与 P4 的反向锁直接冲突；
  自研通道只发一次 HTTPS GET + 下载，能在单测里用假 fetch 全流程验收，也不引入
  新依赖（`electron-updater` 会动 lockfile 与打包图）。
- 客户端通道：`https://api.github.com/repos/damingslu-ctrl/Cyrene-Agent/releases/latest`
  （公开仓库、无 token；60 次/时够用），比较 `tag_name` 与 `app.getVersion()` 的 semver。
- 资产：`Mochi-Setup-<version>.exe`（与 `sync-brand.mjs` 生成的 `artifactName` 同源）。
  校验：release asset 的 `digest` 必须是 `sha256:…` 且与下载文件相符；缺失即拒绝安装。
- 内核通道：`https://api.github.com/repos/MetaCubeX/mihomo/releases/latest`，同上校验。
- 时机：启动后 90s 一次、之后每 6h；**只检查不自动下载**。下载需用户在设置页点。
- 安装：下载到 `<userData>/updates/`，校验后起安装器并退出。原文这里写的是 `shell.openPath`，
  落地时改成 `child_process.spawn`——那条口**带不了参数**，而 `/S --updated --force-run` 三颗都必要
  （理由与逐条分支见 `src/main/update/installer-launch.ts` 文件头）。静默与「这是升级」的语义不变。
  保留最近 1 份安装包，旧包在下次成功下载后删除。
- 关闭：设置页可关自动检查；关掉后只有手动按钮会发请求。
- 出口边界：更新器是**唯一**允许访问 `api.github.com` / `github.com` /
  `objects.githubusercontent.com` 的模块；三把联网工具（fetch_url / download_file /
  浏览器）继续走 `isUpstreamUrl` 黑名单，不放宽。`UPSTREAM_HOSTS` 里保留 `github.com`
  ——它拦的是"用户让模型去抓上游"，不是"客户端检查自己的更新"。

### D4 权限边界：系统代理可做，TUN 只做「经内核 API + 诚实报错」

- 系统代理：写 `HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings` 的
  `ProxyEnable` / `ProxyServer` / `ProxyOverride`，再广播设置变更。当前进程是普通用户，
  这条路可行。
- TUN：mihomo 需要管理员 + wintun；本机用户不在 Administrators（P4 记录）。Mochi
  **不提权、不装服务**。TUN 开关走 `PATCH /configs` 递给内核：内核是 Verge 的服务在跑时
  可能成功，是 Mochi 普通权限自起时必然失败——把内核返回的错误原样翻译给用户，
  不做"假成功"。
- 系统代理与 TUN 的开关状态以「读回来的值」为准，不以点击为准。

### D5 订阅：Verge 兼容格式，原子写 + 备份，切走 runtime config

- 直接读写 Verge 的数据目录（`profiles.yaml` + `profiles/*.yaml`），保留未知字段；
  任何写入前先复制一份 `<file>.bak-mochi-<yyyymmdd-HHmmss>`，写入用
  `<file>.tmp` → rename。
- 切换：读目标 profile → 按 merge 链（只支持 `merge` 类型：深合并 map、
  `prepend-*`/`append-*` 列表）生成 runtime config → 注入控制器/端口/DNS 基础键 →
  写 `<userData>/runtime/<uid>.yaml` → `PUT /configs {"path": …}` → 成功后写回
  `profiles.yaml.current`。失败则 current 不动（先写盘再改账会造出"账上切了、内核没切"）。
- 导入：URL（`fetch`，UA `clash-verge/v2.4.2`，20s 超时，≤16MB）或本地文件；
  解析 YAML 必须含 `proxies` 或 `proxy-providers`，否则拒绝；uid 用 10 位
  `[A-Za-z0-9]` 随机串（与 Verge 同形）。
- 更新订阅：重新下载 → 原子替换 → 若该 profile 是 current，重新生成 runtime 并 reload。
- 删除：先清 current 指向（若有）再删文件；不允许删 `Merge`/`Script` 两个内置项。
- 脚本（`type: script`）与规则增强（`type: rules`/`proxies`/`groups`）只读展示，
  不在本期执行 JS——执行用户脚本是任意代码执行面，留给下一期单独设计。

## 3. 数据面（main）

扩 `src/main/verge/mihomo-client.ts`（保持"只读控制器 + 最小写"原则）：

| 能力 | 接口 | 用途 |
| --- | --- | --- |
| 规则 | `GET /rules` | 规则页（总数/命中/类型过滤/搜索） |
| 日志 | `GET /logs?level=`（NDJSON 流） | 日志页（暂停/级别/关键字） |
| 连接明细 | `GET /connections` | 连接页（进程/规则/链路/上下行） |
| 关闭连接 | `DELETE /connections/{id}`、`DELETE /connections` | 单条/全部 |
| 入站 | `GET /providers/proxies` | providers 页（类型/节点数/更新时间） |
| 入站测速 | `GET /providers/proxies/{name}/healthcheck` | 单个刷新 |
| 完整配置 | `GET /configs` | 设置页初值（端口/allow-lan/ipv6/tun/log-level/mode） |
| 改配置 | `PATCH /configs`（只允许白名单键） | 设置页保存/TUN |
| 换配置 | `PUT /configs` `{path}` | 订阅切换 |
| 单节点测速 | `GET /proxies/{name}/delay` | 节点页"测这一个" |

白名单：`mixed-port`、`port`、`socks-port`、`allow-lan`、`ipv6`、`mode`、
`log-level`、`tun.enable`、`tun.stack`。其他键一律拒绝（防止把整个配置写崩）。

聚合：`network-service` 增加按需拉取的子快照（rules/logs/connections/providers/config），
页面关掉即停流；日志流最多 500 行、连接最多 200 条（渲染端同口径）。

## 4. 页面

`NetworkPanel` 从单页改为六个页签：概览 / 节点 / 规则 / 日志 / 连接 / 入站，
设置收进页头齿轮（第七个页签「设置」）。沿用现有 token 与卡片语言；
新增页签只读优先，写操作都要二次确认（关闭全部连接、删除订阅）。

## 5. 锁的改写（P4 契约 → 新契约）

| 旧锁 | 新契约 |
| --- | --- |
| `no-publish-config.test.ts`：`publish` 必须为空 | **保留**：更新不走 electron-builder 发布源 |
| `upstream-off.test.ts` A3：禁止一切更新标识 | 改成「禁止 electron-updater / latest.yml；要求 update-service 在场」（正反两条判据） |
| `installer-artifacts.mjs` `assertNoUpdateFeed` | **保留**：仍然不许 latest.yml |
| `upstream-hosts.ts` 含 github.com | **保留**：工具出口继续拦；更新器单独放行 |
| 无发布流程 | 新增 `scripts/release/publish-update.mjs`：上传安装包 + `SHA256SUMS.txt`；release 说明写明版本 |

新增锁：
- `update-service` 必须校验 digest（缺 digest 时测试断言拒绝）。
- semver 比较的边界（1.9.9 < 1.10.0、预发布 < 正式、tag 前缀 `v`）。
- 更新器请求只出现两个仓库 URL，不出现 electron-updater/latest.yml。

## 6. 验收

- 单测：新模块 100% 有测试；**变异自检**至少四条（删 digest 校验、把 semver 比较
  换成字符串比较、把白名单键放开、把"Verge 在跑"闸门删掉），每条都要红。
- 真窗：网络页六个页签在真数据下可用（规则条数 = `/rules` 总数、日志流能暂停、
  连接能关一条、providers 能测速一次、订阅能切回原 profile、系统代理开关读回一致）。
- 更新：用假 GitHub 响应跑全流程（有更新/无更新/摘要不符/网络失败），
  真实请求只在设置页手动触发时发生，且可在日志里看到 URL 与结果。
- 不动 `%APPDATA%\Cyrene`；不写 C: 的大文件（更新包默认落在 userData，可在设置里改目录）。

## 7. 分期

1. **W1 数据面 + 页面**（规则/日志/连接/入站 + 完整配置读）。
2. **W2 订阅**（导入/更新/切换/删除 + merge 链）。
3. **W3 设置与内核**（系统代理/TUN/端口/日志级别 + 内核三态）。
4. **W4 更新**（客户端 + 内核 + 锁改写 + 发布脚本）。
