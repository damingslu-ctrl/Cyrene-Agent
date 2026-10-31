/**
 * 起安装器（Wave 4 T12c）：把已经自证过字节的那颗包 detached 起来，然后我们自己退。
 *
 * 这一层薄，但「薄」不等于没有判错的余地。四条只有这里能判错的线：
 *
 * 1) **`spawn()` 返回不等于安装器起来了**。ENOENT（包被人删了、在 U 盘上、被杀毒软件
 *    收走）是以**异步 `error` 事件**报的，不是在返回值里。而这一趟的唯一出口是「起来了
 *    我们就退」——所以必须等 `spawn` 或 `error` 其中一个真落下来才敢宣布成功。
 *    立刻 resolve 的形状是：App 退了，安装器从来没跑，桌上什么都没有，用户以为更新卡住了。
 * 2) **参数不是装饰，是三条行为的开关**（见 `CLIENT_INSTALLER_ARGS` 那一段的出处）。
 *    spec D3 字面写的是 `shell.openPath` 起安装器，但那条口**不能带参数**，
 *    而上面这三条全靠参数才成立；所以这里走 `spawn`。这是对 spec 的一处刻意偏离，
 *    偏离的理由与代价都记在 `docs/verge/notes/progress.md`。
 * 3) **路径必须长得像安装包**。文件名一路从我们自己的版本号推出来（`installer-download.ts`
 *    的文件头第 5 条），到这一层再按 basename 死判一次：这一层唯一的动作是
 *    「把一个 exe 以 detached 方式起来」，那是整个通道里破坏力最大的一格，
 *    判据不许靠「上游调用方大概没拼错」。
 * 4) **`launch-failed` 是唯一一档「什么都没发生」的败**：App 还在跑、包还在盘上、
 *    用户还能再点一次。所以起失败的时候绝对不许走到退出那一步。
 */
import { spawn, type SpawnOptions } from "node:child_process";
import path from "node:path";

/**
 * 静默升级的三个参数，每一个都对应安装器里一处真实分支（app-builder-lib 26.15.3 的
 * NSIS 模板，行号是本机 `node_modules/.pnpm/…/templates/nsis/` 里读出来的）：
 *
 * - `/S` 静默。除了 spec D3 明写，还有一条只在自家才有的理由：`build/installer/installer.nsh`
 *   的 `customInit` 那段**升级保护**（把 `models/skills/prompts` 先挪进同级暂存目录，
 *   装完再搬回）整块包在 `${If} ${Silent}` 里——非静默的向导路径反而不保护。
 *   换句话说：不静默，旧卸载器的 `RMDir /r` 就会连着用户自己放进去的模型一起清空目录。
 * - `--updated`「这是升级，不是首装」。三处分支读它：`allowOnlyOneInstallerInstance.nsh:108`
 *   看见它先 `Sleep 300`/`1000` 等 App 自己退，而不是弹「程序正在运行」那个模态框或直接
 *   `taskkill`；`installUtil.nsh:86-92` 的 `setIsTryToKeepShortcuts` 在开了
 *   `allowToChangeInstallationDirectory` 时**只有**带 `--updated` 才保留快捷方式；
 *   `common.nsh:125` 的 `StartApp` 会把 `--updated` 再传给 App。
 * - `--force-run` 装完把 App 起回来。`installSection.nsh:104-109`：非 oneClick（我们
 *   `electron-builder.yml` 是 `oneClick: false`）的向导安装器，**只有同时满足
 *   `${isForceRun}` 与 `${Silent}` 才在收尾时启动 App**——向导模式自己有「完成时运行」那个勾，
 *   静默模式没有。少了这一条，静默升级跑完桌上就没有猫了。
 *
 * 参数写在这里而不是硬编码在调用处：这一格的全部风险都是「说好了静默升级、结果参数变了
 * 一件事」，把它做成可注入的形状，单测才能钉住每一颗参数的存在。
 */
export const CLIENT_INSTALLER_ARGS: readonly string[] = ["/S", "--updated", "--force-run"];

/** `spawn` 之后等 `spawn`/`error` 事件落下来的上限。真机上是几十毫秒的量级，这一档只兜「事件一个都不来」。 */
export const CLIENT_LAUNCH_SETTLE_MS = 5_000;

/** 与 `installer-download.ts` 同一把形状尺，这里带锚点重列一次是有意的（见文件头第 3 条）。 */
const INSTALLER_NAME = /^Mochi-Setup-\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\.exe$/;

/** `child_process.spawn()` 返回的那一颗里，本层真正会用的三格。 */
export interface LaunchHandle {
  pid?: number;
  once(event: "spawn", listener: () => void): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
  unref?(): unknown;
}

export type SpawnInstaller = (file: string, args: readonly string[], options: SpawnOptions) => LaunchHandle;

export type InstallerLaunchResult =
  | { ok: true; pid: number | null }
  | { ok: false; detail: string };

export interface InstallerLauncher {
  launch(filePath: string): Promise<InstallerLaunchResult>;
  args(): readonly string[];
}

export interface InstallerLauncherOptions {
  spawnImpl?: SpawnInstaller;
  args?: readonly string[];
  settleMs?: number;
  log?(line: string): void;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createInstallerLauncher(options: InstallerLauncherOptions = {}): InstallerLauncher {
  const doSpawn = options.spawnImpl ?? ((file, args, init) => spawn(file, [...args], init));
  const args = options.args ?? CLIENT_INSTALLER_ARGS;
  const settleMs = options.settleMs ?? CLIENT_LAUNCH_SETTLE_MS;
  const log = options.log ?? (() => {});

  async function launch(filePath: string): Promise<InstallerLaunchResult> {
    const name = path.basename(filePath);
    if (!INSTALLER_NAME.test(name)) {
      return { ok: false, detail: `不是安装包的样子，不启动：${name}` };
    }
    let child: LaunchHandle;
    try {
      child = doSpawn(filePath, args, {
        // detached + stdio:"ignore" + unref：安装器要在我们退出之后还活着，
        // 并且不许拖着父进程的任何句柄（拖着就是在等一个永远不会回来的退出码）。
        detached: true,
        stdio: "ignore",
        // 不是修饰：不盖这一层，用户桌面上会闪出一个控制台窗口。
        windowsHide: true,
      });
    } catch (error) {
      return { ok: false, detail: `安装器没起来：${messageOf(error)}` };
    }
    return new Promise<InstallerLaunchResult>((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve({
          ok: false,
          detail: `${Math.round(settleMs / 1000)} 秒里安装器既没报 spawn 也没报 error——不能当它起来了`,
        });
      }, settleMs);
      child.once("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        // 这一档要说得出来是什么：ENOENT（包没了）与 EACCES（被按住）在用户那边是两件事。
        resolve({ ok: false, detail: `安装器没起来：${messageOf(error)}` });
      });
      child.once("spawn", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.unref?.();
        log(`安装器已起来：${name}（pid ${child.pid ?? "?"}，参数 ${args.join(" ")}）`);
        resolve({ ok: true, pid: child.pid ?? null });
      });
    });
  }

  return { launch, args: () => args };
}
