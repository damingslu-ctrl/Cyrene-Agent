import { IPC } from "../../shared/ipc-channels";
import type { WindowKind } from "./window-kind";

/**
 * channel → 允许的发送方类别（R-D11 的唯一真相）。
 *
 * 「无调用方不进表」是硬规矩：表里的死行比没表更糟——它会让人以为这条 channel 已被守。
 * 所以只有**真实有渲染端调用方**的入站通道进这张表；未列出的通道不过闸（老通道零改动）。
 */
export const IPC_SENDER_POLICY: Readonly<Record<string, readonly WindowKind[]>> = {
  [IPC.VERGE_IS_QUIET]: ["pet"],
  [IPC.VERGE_GET_PET_GEOMETRY]: ["pet"],
  [IPC.VERGE_PET_RESIZE]: ["pet"],
  [IPC.VERGE_PET_POSITION_SETTLED]: ["pet"],
  [IPC.VERGE_TUCK_HINTED]: ["pet"],
  [IPC.VERGE_PROFILE_GET]: ["pet"],
  [IPC.VERGE_NETWORK_GET]: ["chat"],
  [IPC.VERGE_NETWORK_REFRESH]: ["chat"],
  [IPC.VERGE_NETWORK_SET_MODE]: ["chat"],
  [IPC.VERGE_NETWORK_SELECT_NODE]: ["chat"],
  [IPC.VERGE_NETWORK_TEST_GROUP]: ["chat"],
  [IPC.VERGE_NETWORK_AUTO_SELECT]: ["chat"],
  [IPC.VERGE_NETWORK_RULES]: ["chat"],
  [IPC.VERGE_NETWORK_CONNECTIONS]: ["chat"],
  [IPC.VERGE_NETWORK_CLOSE_CONNECTION]: ["chat"],
  [IPC.VERGE_NETWORK_CLOSE_ALL_CONNECTIONS]: ["chat"],
  [IPC.VERGE_NETWORK_PROVIDERS]: ["chat"],
  [IPC.VERGE_NETWORK_PROVIDER_CHECK]: ["chat"],
  [IPC.VERGE_NETWORK_CONFIG_GET]: ["chat"],
  [IPC.VERGE_NETWORK_CONFIG_SET]: ["chat"],
  [IPC.VERGE_NETWORK_LOGS_START]: ["chat"],
  [IPC.VERGE_NETWORK_LOGS_STOP]: ["chat"],
  [IPC.VERGE_NETWORK_LOGS_GET]: ["chat"],
  [IPC.VERGE_GET_APP_INFO]: ["chat"],
  // —— v1.24 订阅页：八条入站全部只认主窗（宠物窗没有订阅 UI，也不该能删订阅）——
  [IPC.VERGE_SUB_LIST]: ["chat"],
  [IPC.VERGE_SUB_IMPORT_URL]: ["chat"],
  [IPC.VERGE_SUB_PICK_FILE]: ["chat"],
  [IPC.VERGE_SUB_IMPORT_FILE]: ["chat"],
  [IPC.VERGE_SUB_UPDATE]: ["chat"],
  [IPC.VERGE_SUB_SELECT]: ["chat"],
  [IPC.VERGE_SUB_REMOVE]: ["chat"],
  [IPC.VERGE_SUB_SET_OPTION]: ["chat"],
  // —— Wave 3 T9 设置页：改的是这台机器的上网方式，宠物窗没有这个 UI，也不该有 ——
  [IPC.VERGE_SETTINGS_GET]: ["chat"],
  [IPC.VERGE_SETTINGS_SET]: ["chat"],
  [IPC.VERGE_SYS_PROXY_GET]: ["chat"],
  [IPC.VERGE_SYS_PROXY_SET]: ["chat"],
  // —— Wave 3 T10b 内核卡片：起的是这台机器上的一个进程，宠物窗没有这个 UI，也不该有决定权 ——
  [IPC.VERGE_CORE_STATUS]: ["chat"],
  [IPC.VERGE_CORE_START]: ["chat"],
  [IPC.VERGE_CORE_STOP]: ["chat"],
  [IPC.VERGE_CORE_RESTART]: ["chat"],
};
