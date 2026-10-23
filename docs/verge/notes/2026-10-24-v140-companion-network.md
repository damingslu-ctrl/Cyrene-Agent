# v1.4.0 验收记录：真桌宠与「网络」页（2026-10-24）

对应 spec：`docs/verge/specs/2026-10-24-companion-and-network-page.md`。
提交：`1b5176bc`（feat）+ `3d6d2123`（chore 版本号）；tag `v1.4.0` 指向 `3d6d2123`。

## 1. 交付面

**主进程数据层（新增）**

- `controller-config.ts`：从 `%APPDATA%`（退 `%LOCALAPPDATA%`）发现 Clash Verge 配置根，
  按 mtime+size 缓存解析 `clash-verge.yaml`；`external-controller` 支持 `:9097` /
  `127.0.0.1:9097` / 带协议整串，**只接受 loopback**，订阅信息读 `profiles.yaml`。
- `mihomo-client.ts`：Bearer 认证；`/version`、`/configs`、`/traffic`（流式取首帧）、
  `/connections`、`/proxies`、`PATCH /configs`、`PUT /proxies/{group}`、
  `GET /group/{group}/delay`；单请求 2.5s 预算；节点过滤掉组 / GLOBAL / 伪节点 / 负载均衡组。
- `network-service.ts`：1.5s 流量轮询 + 10s 快照；失败归因到原因码
  （no-config / no-controller / unauthorized / unreachable / timeout）。
- `network-ipc.ts`：get / refresh / set-mode / select-node / test-group / auto-select，
  加 `network:update` 广播；只写本机 mihomo controller，不新增外部网络出口。

**网络页（渲染端）**

- 侧栏 `NetworkModeButton` 与 动态 / 定时任务 同排；`ChatPagePanel` 增加 `"network"`；
  宠物右键「打开网络面板」也落到同一页。
- `NetworkPanel`：状态头、实时上下行 + 40 点曲线（1.5s/帧 = 最近 60 秒）、
  模式三段、策略组/节点（延迟 + 最近 10 次历史 + 快/稳/名排序 + 单组测速 + 自动择优）、
  订阅卡、连接构成；CSS 全部走 `--rb-*` token，无原始 hex/rgb。
- i18n 三语各新增 74 行 `network.*`。

**桌宠**

- `companion.ts`（729 行）：12 态状态机、加权闲置表（walk 34 / groom 16 / yawn 10 /
  stretch 10 / tilt 10 / sleep 6 / idle 14）、55 px/s 漫游到点减速、拖拽阈值 4 px、
  150ms 速度窗、投掷重力 1400 / 弹性 0.78 / 摩擦 2.5 / 8px 子步、单槽气泡 6s TTL、
  亲密度/饱腹/精力离线衰减（上限 72h，localStorage）。
- 渲染：新增 `squash / walk / step / facing`；走路身体起伏、前后爪反相、朝行进方向转身；
  气泡态窗口用既有 `be` 展开到 172×108，猫钉住不动；停走/落地后只发一次
  `pet-position-settled` 落盘。
- 交互：单击摸摸、双击陪玩、右键新增 摸摸头 / 喂小鱼干 / 陪它玩 / 哄它睡觉 /
  它现在怎么样 / 打开网络面板（前三条保持原位，窗口动作另起一段）。
- `click-through.ts`：`pointerleave` 清最后光标点；`resume` / `refreshAfterWindowMove`
  按最后屏幕点补判一次，漫游、气泡展开、拖拽搬窗后不再出现「松手即穿透」。

## 2. 门禁

- 全量：`CI=true npx vitest run` → **641 files / 6800 passed / 1 skipped (6801)**，
  359.12s，exit 0（02:13–02:19）。
- 类型：`tsc -p tsconfig.main.json --noEmit` / `preload` / `renderer` 三条 exit 0（02:22）。
- 资产：palette `--check`、palette:migrate `--check`、brand `--check`（Mochi dev.damin.mochi）、
  roster（12 cats + 麻糬）、cat-sprites `--check`（198 targets）全部 exit 0。
- 锁：i18n `resources.test.ts` 4/4；IPC 契约 `ipc-contract.test.ts` 8/8（共 12 passed）。
- 安装包：`verify:installer --expect-version 1.4.0` exit 0。

## 3. 变异验牙（每条都先破坏、看红、再还原）

| 锁 | 破坏方式 | 结果 |
| --- | --- | --- |
| 节点过滤 | 让组/伪节点通过过滤 | `mihomo-client.test.ts` 2 条红 |
| 投掷弹跳 | 去掉落地反弹 | `companion.test.ts` 1 条红 |
| 气泡 TTL | 删掉 `update()` 里的到期清理 | 新增的自动到期锁 1 条红 |
| 发布源反向锁 | 往 electron-builder.yml 塞真 publish 块 | `no-publish-config.test.ts` 1 条红 |

气泡 TTL 这一条原本是**假绿**：旧锁只用 `say()` 覆盖，删掉 update 里的到期也不会红。
本轮补了「没有新句子也必须到点消失」的锁，再破坏才红；`electron-builder.yml` 已按字节还原。

## 4. 真实 controller 冒烟（只读）

直连本机 controller（密钥只在内存里用，不打印）：

```
GET /version     200  {"version":"alpha-e4dd968"}
GET /configs     200  mode=rule  mixed-port=7896
GET /proxies     200  144 项
GET /traffic     200  首帧 1051ms  {"up":70,"down":44,...}
GET /connections 200  42 条
```

只有 GET，没有切节点 / 切模式 / 测速，未改动任何共享状态。

## 5. 屏幕层（窗口级）

用一次性 profile `D:\cyrene-p4-accept\profile-v140` 起开发档（走真实欢迎闸门点同意），
再点侧栏「网络」，CDP 整窗截图 `D:\cyrene-p4-accept\shots-v140\network-page.png`：

- 侧栏入口在 空间动态 之后；页头 `Clash Verge · alpha-e4dd968`；
- 首帧先是「内核未连接 / 正在读取内核状态…」，约 2.5s 后变「内核已连接」并上真实数据：
  42 条连接（代理 4 / 直连 38 / 拦截 0）、订阅 `defond`（还有 17 天到期）、
  3 个策略组、节点按延迟排序（60 / 66 / 92 / 94 / 101 ms…，带稳定度）。
- 首帧的「内核未连接」是加载态文案，不是真实离线；探针第一次读到的 `online=false`
  就是这个加载帧，**最终态以截图和 2.5s 后的文本为准**。

未做：桌宠窗新姿态（漫游/投掷/气泡）没有再做窗口级录屏验收，只有单测 + art/renderer
假画布锁覆盖；猫窗在全新 profile 下默认不显示，本次没有为了拍猫去改默认可见性。

## 6. 安装包与发布

- `release/Mochi-Setup-1.4.0.exe` **289,755,998 B**；blockmap 295,986 B；
  SHA-256 `3da9a5120ea3ecea1dc69e308f8e3c295a50420240c81f5dad69520ae7d3407c`；
  Authenticode `NotSigned`。
- `app.asar` 02:09:17 生成；`find src -newer app.asar` 为空，打包内容与 `1b5176bc` 一致。
- 推送：`74ff01f4..3d6d2123 master -> master`（HTTPS + `http.proxy=http://127.0.0.1:7896`），
  tag `v1.4.0` 新推。`gh` 默认解析到上游 `Playa-Cyrene/Cyrene-Agent`，
  dispatch 会 403；必须显式 `--repo damingslu-ctrl/Cyrene-Agent`。
- CI：tag push 仍未触发 package-windows（与 v1.3.5 同），手动
  `workflow_dispatch --ref v1.4.0` run **40002944044** → package job success（4m43s）。
  该 SHA 上没有 Test 工作流运行（fork 的 Test 从未跑过），全量测试以本地为准。
- Release：<https://github.com/damingslu-ctrl/Cyrene-Agent/releases/tag/v1.4.0> 非草稿；
  资产 `Mochi-Setup-1.4.0.exe` 289,755,998 B，远端 `digest` = 本地 SHA-256。
  本记录提交在 tag 之后，与 v1.3.5 的先例相同（tag 不随文档移动）。

## 7. 尺子坏过的地方（不是产品坏了，但要记）

1. **打包 mpv 首次探测失败**：`verify:installer` 在 02:12 报
   `mpv --version 探测失败`（execFile 5s 预算）。`release/win-unpacked/.../mpv.exe` 与
   `resources/bin/mpv/mpv.exe` md5 完全相同（`3c082489…`），手动 `--version` 正常，
   重跑 168ms 通过。判为 121 MB 新拷贝文件冷启动 / 杀软扫描的瞬时停顿，
   **没有为了变绿去放宽 5s 预算**。
2. **`ELECTRON_RUN_AS_NODE`**：从本终端直接 spawn electron 会把 `electron` 当 node 跑，
   主进程在 `protocol.registerSchemesAsPrivileged` 处崩。屏幕探针必须显式删掉该环境变量。
3. **加载态读数**：截图探针在首帧抓到「内核未连接」就当作 `online`，险些把加载态记成
   离线缺陷；改成等 2.5s 后取最终文本，并在记录里写明两段读数。

## 8. 复跑方式

```bash
# 门禁
CI=true npx vitest run
npx tsc -p tsconfig.main.json --noEmit
npx tsc -p tsconfig.preload.json --noEmit
npx tsc -p tsconfig.renderer.json
node scripts/build/apply-theme-palette.mjs --check
node scripts/build/apply-color-migration.mjs --check
node scripts/build/sync-brand.mjs --check
node scripts/build/check-roster.mjs
node scripts/build/cat-sprites.mjs --check

# 装机产物
node scripts/verify/installer-artifacts.mjs --expect-version 1.4.0

# 屏幕（一次性 profile，需先 unset ELECTRON_RUN_AS_NODE）
node "D:/Test/workbuddy/.scratch-network-shot.mjs"   # 仓库外一次性探针，未入库
```
