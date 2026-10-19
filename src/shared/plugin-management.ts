export type PluginRuntimeStatus =
  | "disabled"
  | "starting"
  | "running"
  | "stopping"
  | "failed";

export interface PluginListEntry {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  entry: string;
  apiVersion: number;
  source: "builtin" | "user";
  /** 用户插件来源：market 表示经插件市场安装（宿主安装记录可查），local 表示本地 ZIP 导入 */
  origin?: "local" | "market";
  path: string;
  defaultEnabled: boolean;
  configuredEnabled: boolean;
  enabled: boolean;
  status: PluginRuntimeStatus;
  error?: string;
  hasUnregister: boolean;
  canOpen: boolean;
  /** Icon as a data URL when the plugin provides a valid image file. */
  icon?: string;
  /** 设置面板 HTML 裸文件名；仅已启用且校验通过时透出（渲染端据此挂载 iframe） */
  settingsPanel?: string;
  /** 面板挂载的设置分区；缺省挂「插件」分区 */
  settingsSection?: "channels" | "plugins";
}

export interface PluginScanIssue {
  root: string;
  path?: string;
  source: "builtin" | "user";
  message: string;
}

export interface PluginOverview {
  plugins: PluginListEntry[];
  issues: PluginScanIssue[];
}

/** 本地插件目录条目：直接来自 userData/plugins 下通过校验的 manifest，无远端索引字段 */
export interface MarketPluginEntry {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  /** 插件目录绝对路径，面板据此说明条目来源 */
  path: string;
}

export interface MarketListResult {
  ok: boolean;
  error?: string;
  plugins: MarketPluginEntry[];
  /** 被枚举的本地插件目录绝对路径；用户把插件文件夹放进这里即可 */
  directory?: string;
}

export interface PluginManagementApi {
  list(): Promise<PluginOverview | PluginListEntry[]>;
  setEnabled(id: string, enabled: boolean): Promise<{ ok: boolean; error?: string }>;
  open(id: string): Promise<{ ok: boolean; error?: string }>;
  rescan(): Promise<PluginOverview>;
  importZip(): Promise<{
    ok: boolean;
    canceled?: boolean;
    error?: string;
    plugin?: { id: string; name: string; version: string };
    overview?: PluginOverview;
  }>;
  uninstall(id: string): Promise<{ ok: boolean; error?: string; overview?: PluginOverview }>;
  marketList(): Promise<MarketListResult>;
}

/**
 * 设置面板桥的渲染端转发 API：pluginId 由设置页宿主脚本按 iframe 归属
 * 填入，不来自面板消息（主进程还会做 sender 窗口校验）。
 */
export interface PluginPanelApi {
  invoke(pluginId: string, channel: string, args: unknown[]): Promise<unknown>;
}
