export {};

declare global {
  interface Window {
    cyrene: {
      minimize: () => void;
      hide: () => void;
      quit: () => void;
      setInteractive: (interactive: boolean) => Promise<void>;
      moveBy: (dx: number, dy: number) => void;
      moveTo: (x: number, y: number) => void;
      setDragging: (isDragging: boolean) => void;
      captureFrame: () => Promise<string | null>;
      getCursorPosition: () => Promise<{ x: number; y: number } | null>;
      onPetZoom: (callback: (zoom: number) => void) => () => void;
      onPetVisibilityChanged: (callback: (visible: boolean) => void) => () => void;
    };
    /** 与 preload/index.ts 的 vergeApi 逐字对齐；Task 11 补免打扰三入口，Task 12 补贴边藏身与几何下行。 */
    verge: {
      getSnapshot(): Promise<unknown>;
      /** 本机版本信息：设置页与头像菜单版本行的唯一读端（原来读的是 app-update:get-state）。 */
      getAppInfo(): Promise<import("../../shared/app-info").AppInfo>;
      /** bounds 四数取整（位置/尺寸门的依据）；后四列是模型取证量，只喂 GEOM 探针，不参与闸门。 */
      resizePetWindow(
        bounds: {
          x: number;
          y: number;
          width: number;
          height: number;
          pinInWin?: { x: number; y: number };
          center?: { x: number; y: number };
          peekDx?: number;
          e?: number;
        },
      ): void;
      /** 翻转免打扰：开着→取消（回 null）；关着→现在+半小时。 */
      quietFor(): Promise<number | null>;
      isQuiet(): Promise<boolean>;
      setTuck(enabled: boolean): void;
      /** main → 渲染端：quiet 状态变更时发，payload 是**当下** quietUntil（写盘=未来截止，到点清盘=null）。 */
      onQuietChanged(callback: (payload: { quietUntil: number | null }) => void): () => void;
      /** 渲染端起帧拉一次几何基线；窗不存在时 main 返回 null，禁兜底。 */
      getPetGeometry(): Promise<{
        bounds: { x: number; y: number; width: number; height: number };
        workArea: { x: number; y: number; width: number; height: number };
        tuckEnabled: boolean;
        tuckHinted: boolean;
        /** v1.18：声音开关随几何基线一起回（改值走 onSfxChanged）。 */
        sfxEnabled: boolean;
        tuckLimit: number;
      } | null>;
      /** main → 渲染端：display-metrics-changed 重夹取后推新 bounds + workArea。 */
      onPetGeometryChanged(
        callback: (payload: {
          bounds: { x: number; y: number; width: number; height: number };
          workArea: { x: number; y: number; width: number; height: number };
        }) => void,
      ): () => void;
      /** main → 渲染端：tuck 开关变更（菜单与 IPC 双路经收口闸口后统一广播）。 */
      onTuckChanged(callback: (payload: { tuckEnabled: boolean }) => void): () => void;
      /** main → 渲染端：声音开关变更（右键菜单那一勾经收口后广播）。 */
      onSfxChanged(callback: (payload: { sfxEnabled: boolean }) => void): () => void;
      /** 渲染端 → main：第一次藏身开口说过 TUCK_HINT，落盘 tuckHinted，不再重说。 */
      tuckHinted(): void;
      /** 主窗侧边栏「网络」页：读/写本机 mihomo 控制面。 */
      network: {
        get(): Promise<import("../../shared/network-types").NetworkSnapshot>;
        refresh(): Promise<import("../../shared/network-types").NetworkSnapshot>;
        setMode(mode: import("../../shared/network-types").ProxyMode):
          Promise<import("../../shared/network-types").NetworkActionResult>;
        selectNode(group: string, node: string):
          Promise<import("../../shared/network-types").NetworkActionResult>;
        testGroup(group: string): Promise<import("../../shared/network-types").NetworkTestResult>;
        autoSelect(group: string): Promise<import("../../shared/network-types").NetworkAutoSelectResult>;
        /** v1.22 明细页签：规则 / 连接 / 入站 / 配置 / 日志。 */
        rules(force?: boolean): Promise<import("../../shared/network-detail-types").NetworkDetailResult<
          import("../../shared/network-detail-types").RuleEntry[]
        >>;
        connections(): Promise<import("../../shared/network-detail-types").NetworkDetailResult<
          import("../../shared/network-detail-types").ConnectionDetail[]
        >>;
        closeConnection(id: string): Promise<import("../../shared/network-detail-types").NetworkVoidResult>;
        closeAllConnections(): Promise<import("../../shared/network-detail-types").NetworkVoidResult>;
        providers(force?: boolean): Promise<import("../../shared/network-detail-types").NetworkDetailResult<
          import("../../shared/network-detail-types").ProviderInfo[]
        >>;
        providerCheck(name: string): Promise<import("../../shared/network-detail-types").NetworkDetailResult<
          import("../../shared/network-detail-types").ProviderInfo[]
        >>;
        getConfig(): Promise<import("../../shared/network-detail-types").NetworkDetailResult<
          import("../../shared/network-detail-types").CoreConfigView
        >>;
        setConfig(patch: import("../../shared/network-detail-types").CoreConfigPatch): Promise<
          import("../../shared/network-detail-types").NetworkDetailResult<
            import("../../shared/network-detail-types").CoreConfigView
          >
        >;
        startLogs(level?: import("../../shared/network-detail-types").LogLevel):
          Promise<import("../../shared/network-detail-types").NetworkVoidResult>;
        stopLogs(): Promise<import("../../shared/network-detail-types").NetworkVoidResult>;
        getLogs(): Promise<import("../../shared/network-detail-types").NetworkDetailResult<
          import("../../shared/network-detail-types").NetworkLogsState
        >>;
        onLog(callback: (entry: import("../../shared/network-detail-types").LogEntry) => void): () => void;
        onUpdate(callback: (update: import("../../shared/network-types").NetworkUpdate) => void): () => void;
      };
      /** 订阅页（Wave 2）：写操作统一回 ProfileResult，失败也带得上旧列表。 */
      subscriptions: {
        list(): Promise<import("../../shared/subscription-types").ProfileResult>;
        importUrl(url: string, desc?: string): Promise<import("../../shared/subscription-types").ProfileResult>;
        pickFile(): Promise<{ path: string | null }>;
        importFile(path: string, desc?: string): Promise<import("../../shared/subscription-types").ProfileResult>;
        update(uid: string): Promise<import("../../shared/subscription-types").ProfileResult>;
        select(uid: string): Promise<import("../../shared/subscription-types").ProfileResult>;
        remove(uid: string): Promise<import("../../shared/subscription-types").ProfileResult>;
        setOption(uid: string, patch: Record<string, unknown>): Promise<import("../../shared/subscription-types").ProfileResult>;
        onChanged(callback: (rows: import("../../shared/subscription-types").ProfileRow[]) => void): () => void;
      };
      /**
       * 设置页（Wave 3 T9）：verge.yaml 白名单 + Windows 系统代理。
       * `proxySet` 只有开关这一个字段——代理地址与例外列表由 main 现算，页面递不进去。
       */
      settings: {
        get(): Promise<import("../../shared/verge-settings-types").VergeSettingsRead>;
        set(patch: import("../../shared/verge-settings-types").VergeSettingsPatch):
          Promise<import("../../shared/verge-settings-types").VergeSettingsResult>;
        proxyGet(): Promise<import("../../shared/system-proxy-types").SystemProxyRead>;
        proxySet(toggle: { enabled: boolean }):
          Promise<import("../../shared/system-proxy-types").SystemProxySetResult>;
      };
      /**
       * 内核宿主（Wave 3 T10b/T11）：读现状 / 起 / 停 / 重启 / 更新自托管内核。
       * 五条都不递参数、也不回布尔——起哪颗内核、吃哪份配置、从哪儿更新只由 main 决定，
       * 而「被单写者闸门挡下」「我们那颗还在跑所以没换文件」和「真的起来了」必须用同一把尺读出来。
       */
      core: {
        status(): Promise<import("../../shared/core-types").CoreView>;
        start(): Promise<import("../../shared/core-types").CoreView>;
        stop(): Promise<import("../../shared/core-types").CoreView>;
        restart(): Promise<import("../../shared/core-types").CoreView>;
        update(): Promise<import("../../shared/core-types").CoreView>;
      };
      /**
       * 客户端更新（Wave 4 T12d）：读账 / 检查 / 下载 / 安装 / 改自动检查。
       * 四条动作都不递参数、五条都回**整份账**（三本账 + 此刻在走哪一段 + 开关那次落盘的下场）：
       * 「下哪一版」只由 main 算，而排程那条链会在页面看不见的时候改检查那本账。
       */
      clientUpdate: {
        state(): Promise<import("../../shared/client-update-types").ClientUpdateView>;
        check(): Promise<import("../../shared/client-update-types").ClientUpdateView>;
        download(): Promise<import("../../shared/client-update-types").ClientUpdateView>;
        install(): Promise<import("../../shared/client-update-types").ClientUpdateView>;
        setAutoCheck(on: boolean):
          Promise<import("../../shared/client-update-types").ClientUpdateView>;
      };
      /** main → 宠物窗：右键菜单选的互动动作。 */
      onPetCommand(callback: (command: import("../../shared/pet-commands").PetCommand) => void): () => void;
      /** 渲染端 → main：漫游/投掷落定后记一次位置。 */
      settlePetPosition(position: { x: number; y: number }): void;
      /** main → 主窗：打开「网络」页。 */
      onOpenNetworkPanel(callback: () => void): () => void;
    };
  }
}
