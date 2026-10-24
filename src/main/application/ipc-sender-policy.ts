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
  [IPC.VERGE_GET_APP_INFO]: ["chat"],
};
