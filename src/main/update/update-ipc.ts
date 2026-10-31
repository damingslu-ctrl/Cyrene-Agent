/**
 * Wave 4 T12d：客户端更新的五条通道（读账 / 检查 / 下载 / 安装 / 改自动检查）。
 *
 * 判定全在 `update-service`（三本账的作废关系、成本顺序、在途两种答案、退出时机），
 * 字节全在 `installer-download`，安装器那一下全在 `installer-launch`。这一层只守四条：
 *
 * - **五条通道回同一份 `ClientUpdateView`**。一次点击的结论不是布尔，而是「三本账现在各写着
 *   什么、此刻在走哪一段」：排程那条链会在用户看不见的时候改检查那本账，页面只拿本次回执
 *   就会画出一张「检查那行还停在昨天」的卡。
 * - **四条动作不接受渲染端的任何参数**。否则「下哪一版、从哪个地址下」就成了渲染端可递的东西，
 *   出口白名单守的是我们这一侧算出来的那两颗 URL，不是别人递进来的。
 * - **改开关只接受一个布尔**。`"false"` 这种字符串关掉的是内存里那一档 + 盘上那颗，
 *   一次没被理解的调用不该留下任何后果；它回的是原样的账，加一句「这一次什么都没改」。
 * - **不吞异常，也不演成成功**。装配层真抛了（`<userData>` 读不到、盘只读）就让它出去：
 *   把它折成一份 `phase: "idle"` 的空账，等于告诉用户「更新没事，是你没点」。
 *
 * `install` 那一趟比较特殊：`launched` 之后服务会当场发起退出，本层的 `view()` 与回执
 * 发出去不发出去都由那次退出说了算。这不是这里的判据，卡片那边的话术按「可能等不到回执」写
 * （`client-update-view.ts` 的 `clientActionFailureKey`）；唯一的凭据是下一次启动读到的版本号。
 *
 * 通道归主窗独占（`IPC_SENDER_POLICY` 里的 `["chat"]`）：宠物窗没有理由能替这台机器换掉 App。
 */
import type { ClientUpdateSave, ClientUpdateView } from "../../shared/client-update-types";
import { IPC } from "../../shared/ipc-channels";
import type { IpcScope } from "../application/ipc-scope";
import type { ClientUpdateService } from "./update-service";

export function registerClientUpdateIpc(ipc: IpcScope, update: ClientUpdateService): () => void {
  /** 动作之后现取账：回的是「这一刻三本账的样子」，不是发起动作时手上的那份。 */
  const view = (saved: ClientUpdateSave | null): ClientUpdateView => ({ ...update.state(), saved });

  ipc.handle(IPC.VERGE_CLIENT_UPDATE_STATE, (): ClientUpdateView => view(null));

  ipc.handle(IPC.VERGE_CLIENT_UPDATE_CHECK, async (): Promise<ClientUpdateView> => {
    await update.check();
    return view(null);
  });

  ipc.handle(IPC.VERGE_CLIENT_UPDATE_DOWNLOAD, async (): Promise<ClientUpdateView> => {
    await update.download();
    return view(null);
  });

  ipc.handle(IPC.VERGE_CLIENT_UPDATE_INSTALL, async (): Promise<ClientUpdateView> => {
    await update.install();
    return view(null);
  });

  ipc.handle(IPC.VERGE_CLIENT_UPDATE_SET_AUTO_CHECK, async (_event, on: unknown): Promise<ClientUpdateView> => {
    if (typeof on !== "boolean") {
      return view({ ok: false, detail: `自动检查只接受一个布尔，收到的是 ${String(on)}——这一次什么都没改` });
    }
    const saved = update.setAutoCheck(on);
    return view({ ok: saved.ok, detail: saved.detail });
  });

  return () => {
    ipc.removeHandler(IPC.VERGE_CLIENT_UPDATE_STATE);
    ipc.removeHandler(IPC.VERGE_CLIENT_UPDATE_CHECK);
    ipc.removeHandler(IPC.VERGE_CLIENT_UPDATE_DOWNLOAD);
    ipc.removeHandler(IPC.VERGE_CLIENT_UPDATE_INSTALL);
    ipc.removeHandler(IPC.VERGE_CLIENT_UPDATE_SET_AUTO_CHECK);
  };
}
