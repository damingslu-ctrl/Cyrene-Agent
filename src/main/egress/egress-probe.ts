/**
 * `--egress-probe[=<空闲毫秒>]` 探针档（P4 Task 6）。
 *
 * argv 形状沿用 `--tuck-probe` / `--voice-probe` 的既有先例：参数可选，缺省 20s。
 * 探针不改变编排：组合根照常 `application.start()`，因此窗口、渲染进程、verge 三段都会真跑一遍
 * ——尺子量的就是这个软件默认启动后会发出去的东西。验收跑的是全新 userData（没配模型 key），
 * 所以 key-gated 的供应商请求本来就不该出现；真出现了就是要抓的东西，不是噪音。
 * 产物落在 userData 里。验收档必然带 `--user-data-dir=D:/...`，那本来就是一次性目录；
 * 反过来把它放到 userData 的父目录，在 Windows 上会退化成卷根（`D:\`），写不进去。
 */
import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { installEgressWatchdogEverywhere } from "./egress-watchdog";

/** argv 形状沿用 `--tuck-probe`/`--voice-probe` 的既有先例：`--egress-probe=<空闲毫秒>`。 */
export function readEgressProbeArg(argv: string[] = process.argv): number | null {
  const hit = argv.find((arg) => arg.startsWith("--egress-probe"));
  if (!hit) return null;
  const raw = hit.split("=")[1];
  const idleMs = raw ? Number(raw) : 20_000;
  return Number.isFinite(idleMs) && idleMs >= 0 ? idleMs : 20_000;
}

/**
 * 装看门狗 → 空闲 idleMs → 落 JSON → 退出。
 * 退出码即判据：`external === 0` 才是 0，其余 1（E2 直接读退出码）。
 * 落盘失败也只能以退出码 1 收场 —— 这句不是废话：Task 31 第一次真跑时，这里的
 * `mkdirSync` 抛了 EPERM（outDir 曾是 userData 的父目录 = Windows 卷根），异常逃逸到
 * 主进程 → `showErrorBox` 弹模态框 → 探针既不退出也不落盘，验收只能上手杀进程。
 */
export function armEgressProbe(idleMs: number, outDir: string): () => void {
  // 覆盖所有 partition（含启动后新建的）：只挂 defaultSession 的尺子读不到浏览器面板与考试页。
  const watchdog = installEgressWatchdogEverywhere();
  const timer = setTimeout(() => {
    const external = watchdog.entries();
    const file = path.join(outDir, "egress-probe.json");
    const scope = {
      webRequestSessions: watchdog.sessionCount(),
      excludes: "主进程 fetch()/node http（undici）不经过 webRequest，本尺子看不见",
    };
    try {
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ external, pid: process.pid, version: app.getVersion(), scope }, null, 2), "utf8");
    } catch (error) {
      console.log(`[egress-probe] write failed: ${error instanceof Error ? error.message : String(error)}`);
      app.exit(1);
      return;
    }
    console.log(`[egress-probe] external=${external.length} sessions=${scope.webRequestSessions} -> ${file}`);
    app.exit(external.length === 0 ? 0 : 1);
  }, idleMs);
  return () => {
    clearTimeout(timer);
    watchdog.dispose();
  };
}
