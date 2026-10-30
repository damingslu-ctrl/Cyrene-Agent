/**
 * Wave 3 T10b/T11：内核宿主的五条通道（读现状 / 起 / 停 / 重启 / 更新）。
 *
 * 这层刻意薄到几乎没有判断——判断都在 `core-manager`（闸门、端口、自愈）、
 * `core-bootstrap`（口令与端口的来处）与 `mihomo-update`（下载与换文件）里。这里只守三条：
 *
 * - **五条通道回同一份形状**。起停的结论不是「成功/失败」而是「现在哪一态、为什么」，
 *   更新也不单独回一份「装没装上」——页面拿同一把尺量五种动作，才不会在重启或换文件
 *   失败那次画出一个假的勾。
 * - **不吞异常，也不演成成功**。装配层真抛了（磁盘只读、userData 被删）就让它出去：
 *   把它折成一份 `state: "stopped"` 的回执，等于告诉用户「没起起来，一切正常」。
 *   更新那一头同理：`mihomo-update` 自己把每档下场折进了 `CoreUpdateState`，
 *   通道不再包第二层，剩下真抛的只有「连回执都构造不出来」那一种。
 * - **更新不动进程**。换上文件不等于重起内核，也不等于生效（安装版还在时优先借它）；
 *   重起是用户自己下一次的点击，这里替他做主就是拿一条他还没同意的前提去断他正在用的代理。
 *
 * 通道归主窗独占（`IPC_SENDER_POLICY` 里的 `["chat"]`）：宠物窗没有理由能替全机起一颗内核，
 * 也没有理由能把内核文件换成另一版。
 */
import type { CoreView } from "../../shared/core-types";
import { IPC } from "../../shared/ipc-channels";
import type { IpcScope } from "../application/ipc-scope";
import type { CoreAssembly } from "./core-bootstrap";

export function registerCoreIpc(ipc: IpcScope, core: CoreAssembly): () => void {
  const view = (): CoreView => ({
    status: core.status(),
    secretSource: core.secretSource(),
    update: core.updateState(),
  });

  ipc.handle(IPC.VERGE_CORE_STATUS, (): CoreView => view());
  ipc.handle(IPC.VERGE_CORE_START, async (): Promise<CoreView> => {
    // 「不再重起」是给用户的说明，不是给人上的锁：预算打满之后手动点一次「起」
    // 就是新一轮意图，计数得跟着归零——不然页面会对着刚起来的内核报「已自愈 3 次」，
    // 而下一次崩在 60s 窗口内时那颗根本不会再被自愈（继承了一份早就烧光的预算）。
    if (core.status().reason === "self-heal-exhausted") core.manager.resetHealBudget();
    await core.manager.start();
    return view();
  });
  ipc.handle(IPC.VERGE_CORE_STOP, async (): Promise<CoreView> => {
    await core.manager.stop();
    return view();
  });
  ipc.handle(IPC.VERGE_CORE_RESTART, async (): Promise<CoreView> => {
    await core.manager.restart();
    return view();
  });
  ipc.handle(IPC.VERGE_CORE_UPDATE, async (): Promise<CoreView> => {
    await core.updateCore();
    return view();
  });

  return () => {
    ipc.removeHandler(IPC.VERGE_CORE_STATUS);
    ipc.removeHandler(IPC.VERGE_CORE_START);
    ipc.removeHandler(IPC.VERGE_CORE_STOP);
    ipc.removeHandler(IPC.VERGE_CORE_RESTART);
    ipc.removeHandler(IPC.VERGE_CORE_UPDATE);
  };
}
