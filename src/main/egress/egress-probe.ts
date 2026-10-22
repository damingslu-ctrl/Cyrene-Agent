/**
 * `--egress-probe[=<空闲毫秒>]` 探针档（P4 Task 6）。
 *
 * argv 形状沿用 `--tuck-probe` / `--voice-probe` 的既有先例：参数可选，缺省 20s。
 * 探针不进入 shell → core 编排（不调 `registerCoreIpc`），因此不会有任何
 * key-gated 的模型供应商请求混进表——表里剩下的才是「没人要求也会发」的外部流量。
 * 产物落在 userData 里。验收档必然带 `--user-data-dir=D:/...`，那本来就是一次性目录；
 * 反过来把它放到 userData 的父目录，在 Windows 上会退化成卷根（`D:\`），写不进去。
 */
import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { installEgressWatchdog } from "./egress-watchdog";

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
  const watchdog = installEgressWatchdog();
  const timer = setTimeout(() => {
    const external = watchdog.entries();
    const file = path.join(outDir, "egress-probe.json");
    try {
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ external, pid: process.pid, version: app.getVersion() }, null, 2), "utf8");
    } catch (error) {
      console.log(`[egress-probe] write failed: ${error instanceof Error ? error.message : String(error)}`);
      app.exit(1);
      return;
    }
    console.log(`[egress-probe] external=${external.length} -> ${file}`);
    app.exit(external.length === 0 ? 0 : 1);
  }, idleMs);
  return () => {
    clearTimeout(timer);
    watchdog.dispose();
  };
}
