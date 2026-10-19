/**
 * `--egress-probe[=<空闲毫秒>]` 探针档（P4 Task 6）。
 *
 * argv 形状沿用 `--tuck-probe` / `--voice-probe` 的既有先例：参数可选，缺省 20s。
 * 探针不进入 shell → core 编排（不调 `registerCoreIpc`），因此不会有任何
 * key-gated 的模型供应商请求混进表——表里剩下的才是「没人要求也会发」的外部流量。
 * 产物落在 userData 同级目录（`--user-data-dir=D:/...` 的父目录），
 * 免得探针 JSON 混进真实账本。
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
 */
export function armEgressProbe(idleMs: number, outDir: string): () => void {
  const watchdog = installEgressWatchdog();
  const timer = setTimeout(() => {
    const external = watchdog.entries();
    const file = path.join(outDir, "egress-probe.json");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ external, pid: process.pid, version: app.getVersion() }, null, 2), "utf8");
    console.log(`[egress-probe] external=${external.length} -> ${file}`);
    app.exit(external.length === 0 ? 0 : 1);
  }, idleMs);
  return () => {
    clearTimeout(timer);
    watchdog.dispose();
  };
}
