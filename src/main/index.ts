/**
 * Electron 主进程入口 —— 应用组合根（Composition Root）。
 *
 * 此文件只表达应用生命周期：创建 Application、绑定 Electron 生命周期、
 * 在 ready 前完成同步预配置，并在主进程就绪后按
 * shell → core → background 阶段启动。全部业务子系统的装配位于
 * application/default-dependencies.ts；启动编排位于 application/application.ts。
 */

import { app } from "electron";
import { createApplication } from "./application/application";
import { createDefaultApplicationDependencies } from "./application/default-dependencies";
import { installEgressWatchdog } from "./egress/egress-watchdog";
import { armEgressProbe, readEgressProbeArg } from "./egress/egress-probe";
import { registerPluginPanelScheme } from "./plugin-panel-protocol";
import { installGlobalNavigationGuard } from "./windows/external-link";

// 打包版双击启动时 stdout/stderr 管道可能不存在或中途关闭，
// 此时任何 console.log 写入都会抛异步 EPIPE 并升级成 uncaughtException 弹错误框
// （如 mcp-adapter connectMcpServer 的连接日志）。在入口最顶部挂 error 监听器
// 静默兜底：日志丢弃无害，业务不受影响。
for (const stream of [process.stdout, process.stderr]) {
  stream?.on?.("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EPIPE") return;
    throw err;
  });
}

// 插件设置面板协议：scheme 特权必须在 app.ready 之前注册（Electron 硬性要求）
registerPluginPanelScheme();

// 全局导航兜底：阻止任何窗口的页面内导航（含拖放文件跳转 file://），
// http(s) 外链转交系统浏览器。必须在任何窗口创建之前注册。
installGlobalNavigationGuard();

const application = createApplication(createDefaultApplicationDependencies());

application.installLifecycleHandlers();
application.prepareBeforeReady();

/**
 * 运行时出口看门狗（P4 Task 6）：A 期唯一的「真窗尺」。
 * 静态锁只能证明标识面干净，间接路径（库内写死的地址、运行时拼出来的 host）要在这里记。
 */
let egressWatchdog: ReturnType<typeof installEgressWatchdog> | null = null;

/** 非探针档也要看得见：把新登记的外部请求逐条 warn 出来，10s 一次，不阻塞退出。 */
function watchEgressInBackground(): void {
  let reported = 0;
  const timer = setInterval(() => {
    const entries = egressWatchdog?.entries() ?? [];
    for (; reported < entries.length; reported += 1) {
      const entry = entries[reported];
      console.warn(`[egress] external ${entry.method} ${entry.resourceType} ${entry.url}`);
    }
  }, 10_000);
  timer.unref();
}

if (application.isPrimaryProcess()) {
  void app.whenReady()
    .then(() => {
      // ready 之后、窗口起来之前装：此时 defaultSession 已可用，首窗请求也会被记到。
      const egressProbeMs = readEgressProbeArg();
      if (egressProbeMs !== null) {
        // 探针档短路：不进入 shell → core 编排，registerCoreIpc 不会跑，
        // 模型供应商的 key-gated 请求不会混进表里。
        // 产物就落在 userData 里：Task 31 的验收判据钉的就是 `<user-data-dir>/egress-probe.json`，
        // 而且 `--user-data-dir` 本身就指定了一次性目录。曾经写成它的父目录，
        // 在 Windows 上父目录就是卷根，`mkdir 'D:\'` 直接 EPERM。
        armEgressProbe(egressProbeMs, app.getPath("userData"));
        return;
      }
      egressWatchdog = installEgressWatchdog();
      watchEgressInBackground();
      return application.start();
    })
    .catch((error) => application.handleFatalStartup(error));
}
