/**
 * 「哪些端口已经被占」的真身——内核宿主挑端口前问的那一句。
 *
 * 判据用 `netstat -ano` 而不是「逐个端口试着 bind 一下」：后者要异步，而
 * `CoreManagerDeps.usedPorts()` 是同步的（起内核那一条路要在 spawn 之前一次问完）；
 * 更要命的是 bind 试探会真的占住那个端口几十毫秒，这期间内核自己来绑就会撞。
 *
 * 探测不了的时候**回空表**（当作没人占），不是「当作全被占」。两边都会错，但错的代价不对称：
 * 空表最坏是一次起不来——内核绑不上端口 → 控制器不应答 → `not-ready`，页面看得见原因、
 * core.log 里留着内核自己那句 `address already in use`；反过来把全表当成被占，我们会退到
 * 17890 那一串去起，而整条数据面（`clash-verge.yaml` 里的 9097）还在原地找内核，
 * 于是「起来了但什么都看不见」——那一档连错误都没有，最难查。
 */
import { execFileSync } from "node:child_process";

/** 一次 `netstat` 的等待上限：它偶尔会被 WMI 拖住，拖久了不如当作探测不了。 */
export const NETSTAT_TIMEOUT_MS = 5000;

/**
 * `netstat -ano` 的原始输出 → 本机正在监听（TCP LISTENING）的端口号，去重升序。
 *
 * 只认 TCP：内核要占的是 TCP 端口，UDP 那一堆（5353、NetBIOS）与它不冲突。
 * 状态词在中文版 Windows 上也是英文（本地化的只有表头），所以按不区分大小写比。
 */
export function parseListeningPorts(output: string): number[] {
  const ports = new Set<number>();
  for (const line of output.split(/\r?\n/)) {
    const columns = line.trim().split(/\s+/);
    if (columns.length < 4) continue;
    if (columns[0].toUpperCase() !== "TCP") continue;
    if (columns[3].toUpperCase() !== "LISTENING") continue;
    const port = portOfAddress(columns[1]);
    if (port !== null) ports.add(port);
  }
  return [...ports].sort((a, b) => a - b);
}

/**
 * `127.0.0.1:9097`、`[::1]:4532`、`0.0.0.0:0` → 最后一段冒号后的数字。
 *
 * 取「最后一个冒号」而不是 split 长度 2：IPv6 的地址本身带冒号，还被方括号包住。
 * 端口不是合法整数（0、超界、非数字）一律 null——`0.0.0.0:0` 那种「任意端口」不算占用。
 */
function portOfAddress(raw: string): number | null {
  const at = raw.lastIndexOf(":");
  if (at < 0 || at === raw.length - 1) return null;
  const text = raw.slice(at + 1);
  if (!/^\d+$/.test(text)) return null;
  const port = Number(text);
  return port >= 1 && port <= 65535 ? port : null;
}

export interface UsedPortsProbeDeps {
  /** 返回 netstat 的原始输出；抛错＝探测不了。单测换假的。 */
  readNetstat?(): string;
}

/**
 * 装配层用的探针。会顺带把默认档与扫描段并进结果吗？不会——
 * 「我们自己那颗还活着」这件事由 `core-manager` 的账来判断，不靠端口表。
 */
export function createUsedPortsProbe(deps: UsedPortsProbeDeps = {}): () => number[] {
  const readNetstat = deps.readNetstat ?? defaultReadNetstat;
  return () => {
    try {
      return parseListeningPorts(readNetstat());
    } catch {
      return [];
    }
  };
}

function defaultReadNetstat(): string {
  return execFileSync("netstat", ["-ano"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: NETSTAT_TIMEOUT_MS,
  });
}
