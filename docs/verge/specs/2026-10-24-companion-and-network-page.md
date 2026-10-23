# v1.4.0：真桌宠与「网络」一级页面

参考：`PC2005-cloud/dsh-pet`（一次性动作链 / 拖拽投掷弹簧 / 单槽气泡 / 点击回应池）、
`Pal-AI-Lab/Coopanion`（加权闲置表 / 不重复 / 漫游减速 / 限时鼠标租约 / 心情与亲密度）。
本地基线：`src/main/verge/*` 只有画像骨架，宠物窗只有 5 个表达通道，且流量胶囊常驻。

## 1. 目标

1. **宠物从 HUD 变成伙伴**：常驻流量胶囊删掉；猫会呼吸、眨眼、自主漫游、
   做动作（舔爪/打哈欠/伸懒腰/歪头）、睡觉、被摸、被喂、玩耍、被拎起、被扔出去。
2. **Clash Verge 收进主界面**：侧边栏新增「网络」一级入口，页面内完成看流量/切模式/
   选节点/测速/自动择优/看订阅与连接构成，不再依赖桌宠小面板。
3. **一步到位发布**：v1.4.0 构建并发布 GitHub Release。

## 2. 数据层（main）

- `controller-config.ts`：发现 Clash Verge 配置根（`%APPDATA%\io.github.clash-verge-rev.clash-verge-rev`，
  退 `%LOCALAPPDATA%`），按 mtime 缓存解析 `clash-verge.yaml` → `{baseUrl, secret, mixedPort}`。
- `mihomo-client.ts`：Bearer 认证；`/version`、`/configs`、`/traffic`（流式取首帧）、
  `/connections`、`/proxies`、`PATCH /configs`、`PUT /proxies/{group}`、
  `GET /group/{group}/delay`。所有请求 2.5s 预算。
- `network-service.ts`：1.5s 流量轮询 + 10s 快照；节点组只列真正节点（排除组/内置/伪节点）；
  订阅信息从 `profiles.yaml`（current + base64url 名字取用户名与到期）；
  失败给**原因码**（no-config / no-controller / unauthorized / unreachable / timeout），文案在渲染端 i18n。
- `network-ipc.ts`：get / refresh / set-mode / select-node / test-group / auto-best + `network:update` 广播。
- 只写操作限制在本机 mihomo controller，不新增任何外部网络出口。

## 3. 网络页（renderer）

- `ChatPagePanel` 增加 `"network"`；侧栏按钮 `NetworkModeButton`（与「动态/定时任务」同排，
  宠物右键「打开网络面板」也切到这一页）。
- `NetworkPanel`：状态头（连接/版本/原因）、模式三段、实时上下行 + 40 点曲线
  （1.5s/帧 = 最近 60 秒；60 点会撑到 90 秒，与「实时」语义不符）、
  当前节点卡（组切换、节点列表、延迟条、点选）、实测/自动择优、订阅卡、连接构成条。
- 全部走 `--rb-*` token；空态/离线态/测速态齐备；i18n 三语（zh-CN/en/ja-JP）。

## 4. 宠物行为引擎（renderer）

- `companion.ts`：状态机 `idle | walk | groom | yawn | stretch | tilt | sleep | pet | eat | play | drag | thrown`
  - 加权闲置表 + 不重复上一动作；漫游速度 55 px/s，到达减速；工作区内夹取。
  - 亲密度/饱腹/精力落 localStorage，按离线时长衰减；喂食/玩耍/摸头改变数值。
  - 单槽气泡：优先级 + 6s TTL；安静期禁言；网络事件（离线/恢复/切节点）与闲置唠叨。
  - 拖拽：4px 阈值区分点击与拖动；150ms 速度窗；投掷重力 1400、弹性 0.78、
    摩擦 2.5/s、8px 子步；落地压扁。
- 渲染：新增 `pose.squash / face / walk / step`；猫走路时身体起伏、前后爪交替、尾巴反向摆；
  气泡态窗口用既有 `be` 展开（172×108），猫钉住不动，气泡画在空出来的一侧。
- 交互：单击=摸摸（爱心+亲密度）；右键菜单新增摸摸/喂食/玩耍/睡觉/状态/打开网络页。
- 移动权威：渲染端算原点 → `moveTo`；停走/落地后一次 `pet-position-settled` 落盘，
  不逐帧写盘。贴边藏身期间不漫游；气泡打开时藏身闸门关闭。

## 5. 验收

- 单测：配置解析、节点过滤、原因码、投掷物理、行为权重、气泡优先级、菜单项。
- 变异验牙：节点过滤、投掷弹跳、气泡 TTL 各破坏一次必须红。
- 门：`CI=true npx vitest run`、check:main/preload/renderer、palette/i18n/ipc-contract、build。
- 屏幕：dev 起窗截屏检查网络页与宠物新姿态；至少一条真实 controller 冒烟（本机 9097）。
- 发布：version 1.4.0 → tag → CI → GitHub Release（中文说明）。
