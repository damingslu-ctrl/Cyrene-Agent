import { IPC } from "../../shared/ipc-channels";
import { PRODUCT_NAME_ZH } from "../../shared/brand";
import type { AppInfo } from "../../shared/app-info";
import type { IpcScope } from "../application/ipc-scope";

/**
 * 本机版本信息：设置页与 `--brand-probe` 共用的唯一读端。
 *
 * 它顶替的是原来那组 `app-update:*` 通道。`buildChannel` 恒为 `"local"` 不是占位——
 * 本 fork 没有任何升级来源，界面上要敢把这句话讲出来，而不是留一个空状态让人猜。
 * brand 常量在这里就进来了：Task 8 之后换名只改 `shared/brand.ts` 一处。
 */
export function registerAppInfoIpc(
  ipc: IpcScope,
  source: { getName(): string; getVersion(): string; dataDirName(): string },
): () => void {
  const read = (): AppInfo => ({
    name: source.getName(),
    nameZh: PRODUCT_NAME_ZH,
    version: source.getVersion(),
    buildChannel: "local",
    dataDirName: source.dataDirName(),
  });
  ipc.handle(IPC.VERGE_GET_APP_INFO, () => read());
  return () => ipc.removeHandler(IPC.VERGE_GET_APP_INFO);
}
