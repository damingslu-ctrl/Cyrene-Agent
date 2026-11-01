// Wave 3 余量：内核卡片的真窗验收 + 真装一颗 mihomo 内核。
//
// 用法：node scripts/verify/core-card-cdp.mjs              ← 起/重启/停（默认档：借安装版那颗，真 spawn）
//       node scripts/verify/core-card-cdp.mjs --external   ← 控制器可达即接管：不启进程、不写配置
//       node scripts/verify/core-card-cdp.mjs --gate       ← 单写者闸门挡下，再拆掉闸门跑同一条腿（正对照）
//       node scripts/verify/core-card-cdp.mjs --heal       ← 真杀掉我们那颗，看卡片自己报自愈 1/3
//       node scripts/verify/core-card-cdp.mjs --update     ← 真下 22 MB 换装 + busy/latest + 自托管那颗真跑起来
//       node scripts/verify/core-card-cdp.mjs --no-config  ← 没选订阅：配置写不出来就不 spawn
//
// 每一档认的都是**只有真窗才给得出的东西**：
// - `start`：屏上那三行读数（端口 / PID / 控制器）必须与真进程、真 netstat、真控制器一一对照。
//   单测钉住了「settle 写了什么」，钉不住「卡片报的端口是不是真在听的那一组」——
//   而 `network.core.started` 那句话（「端口画的是回执里那一组，不是我猜的」）正是在替后者作保。
// - 同一趟还要把 `runtime/core.yaml` 与真进程命令行对上：`-d <userData>/core -f <userData>/runtime/core.yaml`
//   是 spec D2 那条边界（内核的工作目录与配置都在我们这一侧）唯一的物理证据。
// - 还要对上一件更贵的事：**装上了不等于生效了**。安装版内核在场时，三态发现永远优先借它，
//   于是刚换装的那颗 `core/mihomo.exe` 一步都没走（`--update` 档把这条同时量出来：
//   遮蔽安装目录后同一颗文件才真的跑起来，`/version` 回的就是发布页那一版）。
//
// 为什么这些判据不许留在 JSX 里：这张卡最贵的错是**说假话**（starting 画成运行中、
// external 态给一颗能点的「停止」、起失败回一个勾、把「装上了」说成「用上了」）。
// 判定本身在 `core-view.ts` 有单测；这里要钉的是判定**接上真账之后**还说不说假话。
//
// 两道对称的环境前闸（都在点任何按钮之前，对不上就 exit 2、一个字节不写）：
// 1) `clash-verge.exe` 的状态：起/自愈/更新/无配置四档要它**不在跑**（在跑时量到的是闸门，
//    不是那四条路）；闸门档要它**在跑**，而那只能由探针自己种一枚同名映像来造（见 plantVergeImage）。
// 2) 一次性目录里那两个端口必须真空着——否则 `pickPortPair` 会退到 17890 那一串，
//    量到的失败原因是「这台机器忙」，不是产品。
//
// `--update` 还有第三道：出口搬不搬得完那一整包（见 assertUpdateEgress）。产品给资产那一跳只有
// 120 秒，出口不通时屏上落下的是那句 `fetch failed`，尺子等满 320 秒会把「这台机器没 bulk 出口」
// 报成产品红——所以这一闸在开 app 之前掐表量速率，量不出「搬得完」就不按下那颗键。
//
// 页面上出现之前先过一道沙箱前闸：订阅页必须列出只有这份一次性账本才有的主机名。
// 对不上＝APPDATA 没被吃进去、app 读的是用户真目录；那时候点「起内核」会拿真账本起真内核，
// 所以这道闸排在每一次点击之前，且**任何一档都绕不过去**。
import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const BASE = "D:\\cyrene-core-accept";
const APPDATA = path.join(BASE, "appdata");
const PROFILE = path.join(BASE, "profile");
const VERGE_DIR_NAME = "io.github.clash-verge-rev.clash-verge-rev";
const CONFIG_ROOT = path.join(APPDATA, VERGE_DIR_NAME);
/** 与 Wave 2 那把尺（9336）错开：两把尺可能在同一天被连着跑。 */
const DEBUG_PORT = 9337;
const PAGE_WAIT_MS = 30_000;
/** 起内核里那段「等控制器答话」的窗口是 8 秒；点击之后等回执要宽过它。 */
const ACTION_WAIT_MS = 40_000;
/**
 * 「更新内核」那颗按下去要跑完一整趟：发布页 → 22 MB 资产（每一跳 120 秒上限）→ 对摘要 → 解压 → 换文件。
 * 得起停那 40 秒去等它，量到的就是尺子先到点，而不是产品那四种下场。
 */
const UPDATE_WAIT_MS = 300_000;
/** 卡片自己重读账本的间隔是 10 秒（`POLL_MS`）；等它不请自来要多给几轮。 */
const POLL_WAIT_MS = 45_000;

/**
 * `update` 档的第三道前闸用的数。产品给资产那一跳的窗口是
 * `src/main/verge/mihomo-update.ts` 的 `MIHOMO_TIMEOUT_MS` = 120 秒（到点自己 `abort`，
 * 屏上落下那句 `fetch failed`），包体 22 MB 上下——「这一趟搬得完搬不完」是可以事先量的算术，
 * 不必拿一次真下载去撞那把刀。
 */
const MIHOMO_ASSET_WINDOW_MS = 120_000;
const EGRESS_PROBE_BYTES = 2 * 1024 * 1024;
const EGRESS_PROBE_DEADLINE_MS = 30_000;
/** 120 秒是「到点就砍」的上限，不是「还能搬完」的余量：真撞在 119 秒上，下一趟就换了运气。 */
const EGRESS_BUDGET_MS = MIHOMO_ASSET_WINDOW_MS - 10_000;

/** 截图与报告落在仓库 `.tmp/`，**不在一次性目录内**：开局就 `rmSync(BASE)`，证据会被下一次自己抹掉。 */
const SHOTS = path.join(ROOT, ".tmp", "shots", "core-card");
const REPORTS = path.join(ROOT, ".tmp", "reports");

/** 环境不满足＝exit 2（与 Wave 2 / 客户端更新那把尺同口径）；产品判据不满足＝exit 1。 */
const ENV_EXIT = 2;

/**
 * 每一档自带一组端口与账本形状。
 *
 * 端口写成两两相邻的一对（mixed 在前）：`pickPortPair` 要**两个都空着**才算这组能用，
 * 而卡片那一行读的是 `${mixed} / ${controller}`——两个号都事先量过空闲，判据才敢钉死字面值。
 */
const LEGS = {
  start: { mixed: 59072, controller: 59071, needGateOpen: true },
  external: { mixed: 59072, controller: 59071, needGateOpen: false },
  gate: { mixed: 59074, controller: 59073, needGateOpen: false },
  heal: { mixed: 59076, controller: 59075, needGateOpen: true },
  update: { mixed: 59080, controller: 59079, needGateOpen: true },
  "no-config": { mixed: 59078, controller: 59077, needGateOpen: true, noCurrent: true },
};

const MODE = (() => {
  for (const name of ["external", "gate", "heal", "update", "no-config"]) {
    if (process.argv.includes(`--${name}`)) return name;
  }
  return "start";
})();
const LEG = LEGS[MODE];
if (!LEG) throw new Error(`不认识的档位：${MODE}`);

/* ------------------------------------------------------------------ 账本内容 */

/** 一次性口令：长度给足（`core-log` 的打码跳过 <8 字符的候选值，太短等于没登记）。 */
const SCRATCH_SECRET = "scratch-core-secret-9f3";
/** 订阅正文自带的控制面三颗键：`runtime/core.yaml` 里一个都不许留下（spec D5 的数据面主权）。 */
const FOREIGN_CONTROLLER = "127.0.0.1:59097";
const FOREIGN_SECRET = "subscription-wins";
const FOREIGN_MIXED_PORT = 59096;
/** 只有这份一次性账本里会出现的主机名：页面上看见它，才确认读的不是真目录。 */
const SCRATCH_HOST = "scratch-core.example.test";
const CURRENT_UID = "Sub00000001";

/** 我们自己那一侧的产物路径（全部落在 userData，不在 Verge 目录）。 */
const RUNTIME_FILE = path.join(PROFILE, "runtime", "core.yaml");
const RUNTIME_DIR = path.join(PROFILE, "runtime");
const CORE_DIR = path.join(PROFILE, "core");
const LOG_FILE = path.join(PROFILE, "core.log");
const BUNDLED_EXE = path.join(CORE_DIR, "mihomo.exe");
const STAGING_DIR = path.join(CORE_DIR, "update-staging");

/* ------------------------------------------------------------------ 文案层 */

/**
 * 卡片上每一句话都从三份语言表里取，探针里一个字都不重打。
 *
 * 重打会漂：改了文案尺子还是绿，等于没有尺。判据按「屏上文本以某一语言的这条开头」来认，
 * 于是语言切到哪一档都量得到同一件事。
 */
const LOCALES = ["zh-CN", "en", "ja-JP"];
const TABLES = LOCALES.map((locale) => {
  const file = path.join(ROOT, "src", "renderer", "react", "i18n", `${locale}.json`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
});

function tableValue(localeIndex, keyPath) {
  const raw = keyPath.split(".").reduce((node, part) => node?.[part], TABLES[localeIndex]);
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error(`${LOCALES[localeIndex]}.json 里没有 ${keyPath}`);
  }
  return raw.trim().replace(/\s+/g, " ");
}

/** `network.core.` 之下的那条文案，三种语言各一份。 */
function copyOf(coreKey) {
  return LOCALES.map((_, index) => tableValue(index, `network.core.${coreKey}`));
}

/** 页面上这句是不是那条文案（回执可能往后缀着「详情：…」，所以按开头认）。 */
function isCopy(text, coreKey) {
  if (typeof text !== "string") return false;
  return copyOf(coreKey).some((copy) => text.startsWith(copy));
}

/** 「详情：」那一段的前缀（语言表里 `saidDetail` 占位符之前的一截）。 */
function detailFragments() {
  return LOCALES.map((_, index) => {
    const raw = tableValue(index, "network.core.saidDetail");
    return raw.split(/\{\{[^}]*\}\}/)[0].trim();
  });
}

function hasDetailFragment(text) {
  return detailFragments().some((fragment) => fragment && String(text).includes(fragment));
}

/**
 * 尺子自己的牙：`expectReceipt` 是 async，漏一处 `await` 不报错，只把一个 Promise 交出去——
 * 于是「这句回执是不是那句文案」「脸色对不对」两条判据当场空转，那一档照样能跑绿。
 * 2026-11-01 实测：14 处全都没 await。其中两处把返回值赋给变量后读 `.text`，读到 undefined，
 * 一处在 `bar.text.includes(...)` 上崩（no-config 档那条 TypeError 是尺子的，不是产品的），
 * 另一处（`stopOwnCore` 的收尾）让「停止」那句回执从证据里静静变成一个缺字段——
 * start / external / gate / heal / update 五档都从这个洞上走过一次绿。
 * 所以这道闸排在开 app 之前：每一趟先自证判据真的接上了线。
 */
function assertRulerWired() {
  const self = fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split(/\r?\n/);
  const floating = self
    .map((line, index) => ({ line, no: index + 1 }))
    .filter(({ line }) => /^\s*(?:(?:const|let|var) \w+ = )?expectReceipt\(/.test(line));
  if (floating.length > 0) {
    throw new Error(
      `尺子自己坏了：这 ${floating.length} 处判据没接线（async 断言漏 await＝整条断言空转）：` +
        floating.map(({ no, line }) => `${no}: ${line.trim()}`).join("；"),
    );
  }
}

/* ---------------------------------------------------------------- 盘上取证 */

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/** 目录树里每个文件的 sha256（相对路径为键）；目录不存在回 null。 */
function snapshotTree(dir) {
  if (!fs.existsSync(dir)) return null;
  const out = {};
  const walk = (current, prefix) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(current, entry.name), relative);
      else if (entry.isFile()) out[relative] = sha256(path.join(current, entry.name));
    }
  };
  walk(dir, "");
  return out;
}

function mtimeMs(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

function readLog() {
  try {
    return fs.readFileSync(LOG_FILE, "utf8");
  } catch {
    return "";
  }
}

function countMatches(text, needle) {
  return text.split(needle).length - 1;
}

/** 日志里最后一条以 `needle` 开头的行；没有回 null。 */
function lastLogLine(text, needle) {
  const hits = text.split(/\r?\n/).filter((line) => line.includes(needle));
  return hits.length === 0 ? null : hits[hits.length - 1];
}

/** 更新那行日志里 `asset=` 之后的那一截（就是 `CoreUpdateState.detail`）。 */
function updateLogDetail(line) {
  if (!line) return null;
  const at = line.search(/asset=\S+\s/);
  return at < 0 ? "" : line.slice(at).replace(/^asset=\S+\s+/, "").trim();
}

/**
 * 只跑「取读数」这一类命令：`execFileSync` 带 argv **数组**，没有一个 shell 参与，
 * 所以插值进去的只有 `Number()` 洗过的 pid。命名刻意避开 `exec`，免得读代码的人（和静态检查）
 * 以为这里有一条 shell。
 */
function runCapture(command, args, timeoutMs = 20_000) {
  return execFileSync(command, args, { encoding: "utf8", timeout: timeoutMs, windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
}

/** 本机正在 LISTENING 的 TCP 端口 → 占用它的 PID。与 `core-ports.ts` 同一判据（只看 TCP、只认 LISTENING）。 */
function listeningEntries() {
  let output = "";
  try {
    output = runCapture("netstat", ["-ano"]);
  } catch {
    return [];
  }
  const out = [];
  for (const line of output.split(/\r?\n/)) {
    const columns = line.trim().split(/\s+/);
    if (columns.length < 5) continue;
    if (columns[0].toUpperCase() !== "TCP") continue;
    if (columns[3].toUpperCase() !== "LISTENING") continue;
    const at = String(columns[1]).lastIndexOf(":");
    const port = Number(String(columns[1]).slice(at + 1));
    const pid = Number(columns[4]);
    if (Number.isInteger(port) && port > 0 && port <= 65535 && Number.isInteger(pid)) out.push({ port, pid });
  }
  return out;
}

function listeningPids(port) {
  return [...new Set(listeningEntries().filter((entry) => entry.port === port).map((entry) => entry.pid))];
}

function portIsFree(port) {
  return listeningPids(port).length === 0;
}

/**
 * 某个 pid 的映像路径与命令行。
 *
 * 只信 `CommandLine` 的第一个 token：`Win32_Process.ExecutablePath` 在部分机器上因权限回 null，
 * 而内核是我们自己 spawn 的，命令行头一个就是那条绝对路径。两者都在时要求它们一致。
 */
function processInfo(pid) {
  let text = "";
  try {
    text = runCapture("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command",
      `Get-CimInstance -ClassName Win32_Process -Filter "ProcessId=${Number(pid)}" | Select-Object ProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress`,
    ]);
  } catch {
    return null;
  }
  const trimmed = text.trim();
  if (!trimmed) return null;
  let json = null;
  try {
    json = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (Array.isArray(json)) json = json[0] ?? null;
  if (!json) return null;
  const commandLine = String(json.CommandLine ?? "");
  const quoted = /^"([^"]*)"/.exec(commandLine);
  return {
    pid: Number(json.ProcessId),
    name: String(json.Name ?? ""),
    exe: String(json.ExecutablePath ?? "") || (quoted ? quoted[1] : ""),
    declaredExe: String(json.ExecutablePath ?? ""),
    commandLine,
  };
}

/** 有没有在跑隔壁那款。与主进程同口径：读不出结论＝当作在跑（fail closed）。 */
function vergeRunning() {
  try {
    return /"clash-verge\.exe"/i.test(runCapture("tasklist", ["/FO", "CSV", "/NH"], 12_000));
  } catch {
    return true;
  }
}

/**
 * 种一枚「Verge 同名映像」。
 *
 * 闸门只认 `tasklist` 第一列的映像名，所以把 `node.exe` 复制一份改名就能造出「隔壁在跑」——
 * 而**不必去动用户手上那款产品**（启停人家的应用是另一条纪律）。
 * 命令行里带一个只有我们自己会写的标记，收尾清扫只认带标记的那几枚，绝不误伤。
 */
const PLANT_MARKER = "__cyrene_core_acceptance_plant__";

function plantVergeImage() {
  const dir = path.join(BASE, "plant");
  fs.mkdirSync(dir, { recursive: true });
  const image = path.join(dir, "clash-verge.exe");
  fs.copyFileSync(process.execPath, image);
  const child = spawn(image, ["-e", `globalThis.${PLANT_MARKER}=1;setInterval(() => {}, 1_000_000)`], {
    windowsHide: true,
    stdio: "ignore",
  });
  if (typeof child.pid !== "number") throw new Error("种不下：复制出来的映像没回 pid");
  child.unref();
  return { pid: child.pid, image };
}

function killPlant(plant) {
  if (!plant) return;
  try {
    runCapture("taskkill", ["/F", "/PID", String(plant.pid)]);
  } catch {
    /* 已经没了 */
  }
}

/**
 * 收掉「属于这次验收」的内核：命令行里带着一次性目录的绝对路径才算。
 *
 * 判据说得清才敢动手——用户自己那颗 `verge-mihomo.exe` 的 `-d` 指向他自己的 userData，
 * 与这里没有任何一条命令行相同，绝不会被打进名单。
 */
function sweepOwnCores(reason) {
  let text = "";
  try {
    text = runCapture("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command",
      "Get-CimInstance -ClassName Win32_Process -Filter \"Name='verge-mihomo.exe' OR Name='verge-mihomo-alpha.exe' OR Name='mihomo.exe'\" | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress",
    ]);
  } catch {
    return { killed: [], reason, note: "进程表读不出来，跳过清扫" };
  }
  const trimmed = text.trim();
  if (!trimmed) return { killed: [], reason };
  let rows = [];
  try {
    rows = JSON.parse(trimmed);
  } catch {
    return { killed: [], reason, note: "进程表 JSON 读不出来" };
  }
  if (!Array.isArray(rows)) rows = [rows];
  const needle = BASE.toLowerCase();
  const mine = rows.filter((row) => String(row?.CommandLine ?? "").toLowerCase().includes(needle));
  const killed = [];
  for (const row of mine) {
    try {
      runCapture("taskkill", ["/F", "/PID", String(row.ProcessId)]);
      killed.push({ pid: Number(row.ProcessId), name: String(row.Name ?? "") });
    } catch {
      /* 已经没了 */
    }
  }
  return { killed, reason };
}

/**
 * 安装版内核在不在场——用装配层同一把尺量（三个安装基址 + `verge-mihomo*.exe`）。
 *
 * `--update` 档第二段要走到 `bundled` 态，得先把安装基址从子进程环境里遮掉。
 * 遮哪几个变量不是拍脑袋：只有**真放着内核**的那一档才遮，其余一律原样交给 app。
 */
function installedBaseOf(value) {
  return typeof value === "string" && value ? path.join(value, "Clash Verge") : null;
}

function hasInstalledCore(dir) {
  if (!dir) return false;
  try {
    return fs.readdirSync(dir).some((name) => /^verge-mihomo.*\.exe$/i.test(name));
  } catch {
    return false;
  }
}

/**
 * 装配层同一把尺量出来的安装版内核：三个安装基址按序找，第一个有合格文件的目录算数，
 * 目录里 stable（`verge-mihomo.exe`）优先、否则取名字最小那颗。
 *
 * 只认 `PROGRAMFILES` 是偷懒的：本机装在 `C:\Program Files\Clash Verge`，但用户完全可能
 * 装到 x86 视图或 `<LOCALAPPDATA>\Programs`——那时候尺子会指着一条不存在的路径报「产品跑错了 exe」。
 */
function installedCoreExe(env = process.env) {
  const bases = [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "Programs") : null]
    .filter((value) => typeof value === "string" && value.length > 0);
  for (const base of [...new Set(bases)]) {
    const dir = path.join(base, "Clash Verge");
    let family = [];
    try {
      family = fs.readdirSync(dir).filter((name) => /^verge-mihomo.*\.exe$/i.test(name)).map((name) => name.toLowerCase());
    } catch {
      continue;
    }
    if (family.length === 0) continue;
    const stable = "verge-mihomo.exe";
    const pick = family.includes(stable) ? stable : [...family].sort()[0];
    return { dir, exe: path.join(dir, pick) };
  }
  return null;
}

function hideInstallsEnv() {
  const overrides = {};
  const hidden = [];
  const plans = [
    { key: "PROGRAMFILES", dir: path.join(BASE, "hidden-programfiles") },
    { key: "PROGRAMFILES(X86)", dir: path.join(BASE, "hidden-programfiles-x86") },
    { key: "LOCALAPPDATA", dir: path.join(BASE, "hidden-localappdata") },
  ];
  for (const plan of plans) {
    if (!hasInstalledCore(installedBaseOf(process.env[plan.key]))) continue;
    fs.mkdirSync(path.join(plan.dir, "Programs"), { recursive: true });
    overrides[plan.key] = plan.dir;
    hidden.push(plan.key);
  }
  return { overrides, hidden };
}

/* ------------------------------------------------------------------ 沙箱闸门 */

function assertSandbox() {
  const normalized = path.resolve(BASE).toLowerCase();
  if (!normalized.startsWith("d:\\cyrene-core-accept")) throw new Error(`一次性目录必须落在 D:\\cyrene-core-accept 下，收到 ${BASE}`);
  const real = String(process.env.APPDATA ?? "").toLowerCase();
  if (!real) throw new Error("会话里没有 APPDATA，无法确认一次性目录跟真目录不是同一个地方");
  if (path.resolve(APPDATA).toLowerCase() === real) throw new Error("APPDATA 覆盖后与真 APPDATA 相同，拒绝开写");
  if (normalized.startsWith(real)) throw new Error(`一次性目录落在真 APPDATA 里面（${real}），拒绝开写`);
}

/** 真用户账本（只读 sha，用来证明这一趟压根没碰它）。 */
function realLedgerPath() {
  const base = process.env.APPDATA;
  if (!base) return null;
  for (const name of ["io.github.clash-verge-rev.clash-verge-rev", "clash-verge-rev", "clash-verge"]) {
    const candidate = path.join(base, name, "profiles.yaml");
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * 一次性 Verge 目录：账本 + 正文 + 控制面文件。
 *
 * 正文里故意带着它自己那三颗控制面键：起来的那颗必须吃**我们注入**的那一组，
 * 留着就是「换一个订阅，数据面主权就交回它自己」（spec D5）。
 */
function writeScratchLedger({ controllerHost, mixedPort, withCurrent }) {
  fs.rmSync(BASE, { recursive: true, force: true });
  fs.mkdirSync(path.join(CONFIG_ROOT, "profiles"), { recursive: true });
  fs.mkdirSync(PROFILE, { recursive: true });
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.mkdirSync(REPORTS, { recursive: true });

  const body = (name) => [
    "proxies:",
    `- name: ${name}`,
    "  type: ss",
    "  server: 127.0.0.1",
    "  port: 8321",
    // `cipher`/`password` 不是装饰：缺了它们 mihomo 在解析阶段就 `level=fatal` 退出（code=1），
    // 量到的永远是「自愈打满 3 次」而不是这张卡要证的那四条路。探针实测：带上这两颗键，
    // 同一颗安装版内核 8 秒内答话（v1.19.32，`/version` 回 200）。
    "  cipher: aes-256-gcm",
    "  password: scratch-node-pw",
    `external-controller: ${FOREIGN_CONTROLLER}`,
    `secret: ${FOREIGN_SECRET}`,
    `mixed-port: ${FOREIGN_MIXED_PORT}`,
    "",
  ].join("\n");
  fs.writeFileSync(path.join(CONFIG_ROOT, "profiles", "Sub00000001.yaml"), body("scratch-a"), "utf8");
  fs.writeFileSync(path.join(CONFIG_ROOT, "profiles", "Sub00000002.yaml"), body("scratch-b"), "utf8");
  fs.writeFileSync(path.join(CONFIG_ROOT, "profiles", "Merge.yaml"), "dns:\n  enable: true\n", "utf8");
  fs.writeFileSync(
    path.join(CONFIG_ROOT, "profiles.yaml"),
    [
      ...(withCurrent ? [`current: ${CURRENT_UID}`] : []),
      "items:",
      "  - uid: Merge",
      "    type: merge",
      "    file: Merge.yaml",
      "  - uid: Sub00000001",
      "    type: remote",
      "    file: Sub00000001.yaml",
      `    url: https://${SCRATCH_HOST}/alpha`,
      "    desc: Scratch A",
      "    updated: 1700000000",
      "  - uid: Sub00000002",
      "    type: remote",
      "    file: Sub00000002.yaml",
      `    url: https://${SCRATCH_HOST}/beta`,
      "    desc: Scratch B",
      "    updated: 1700000000",
      "",
    ].join("\r\n"),
    "utf8",
  );
  fs.writeFileSync(
    path.join(CONFIG_ROOT, "clash-verge.yaml"),
    `external-controller: ${controllerHost}\nsecret: ${SCRATCH_SECRET}\nmixed-port: ${mixedPort}\n`,
    "utf8",
  );
}

/* ------------------------------------------------------------------ CDP 装置 */

class Session {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextId = 1;
    this.pending = new Map();
  }

  async open() {
    this.ws = new WebSocket(this.wsUrl);
    this.ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (!msg.id) return;
      const hit = this.pending.get(msg.id);
      if (!hit) return;
      this.pending.delete(msg.id);
      if (msg.error) hit.reject(new Error(`${msg.method}: ${msg.error.message}`));
      else hit.resolve(msg.result);
    });
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", () => reject(new Error(`WebSocket 连不上 ${this.wsUrl}`)), { once: true });
    });
  }

  send(method, params = {}, timeoutMs = 45_000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      // 没有回音期限的尺子会挂死，而挂死绝不能读成 PASS。
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} 在 ${timeoutMs}ms 内没回话`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}

async function findTarget(match, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      const hit = (await res.json()).find((t) => t.type === "page" && match(t.url));
      if (hit?.webSocketDebuggerUrl) return hit;
    } catch {
      /* CDP 端口还没起来 */
    }
    if (Date.now() > deadline) return null;
    await new Promise((r) => setTimeout(r, 250));
  }
}

function waitExpression(pollFnSource, timeoutMs) {
  // reject 带的必须是**字符串**：抛普通对象时 CDP 只把 className 带回来（一路读到的都是 "Object"）。
  return `new Promise((resolve, reject) => {
    const poll = (${pollFnSource})();
    const started = performance.now();
    const tick = () => {
      let value;
      try { value = poll(); } catch (error) { reject(String(error && error.stack ? error.stack : error)); return; }
      if (value) { resolve(value); return; }
      if (performance.now() - started > ${timeoutMs}) { reject("页面等待超时；屏上：「" + ((document.body?.innerText || "").replace(/\\s+/g, " ").slice(0, 400)) + "」"); return; }
      setTimeout(tick, 80);
    };
    tick();
  })`;
}

async function evaluate(session, expression, { awaitPromise = false, timeoutMs = 45_000 } = {}) {
  const res = await session.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise }, timeoutMs);
  if (res.exceptionDetails) {
    const detail = res.exceptionDetails.exception ?? {};
    throw new Error(detail.description ?? detail.value ?? res.exceptionDetails.text ?? "页面抛了一个读不出来的东西");
  }
  return res.result.value;
}

async function attach(target) {
  const session = new Session(target.webSocketDebuggerUrl);
  await session.open();
  await session.send("Page.enable");
  await session.send("Page.bringToFront").catch(() => {});
  sessions.push(session);
  return session;
}

/**
 * 截图名自带递增前缀：`--update` 档会开两扇窗，两趟都从「卡片进场」那一张拍起，
 * 固定文件名就是后一张把前一张静默覆盖掉——那份现场本来是要留下来对质的。
 */
const shots = [];

async function shoot(name) {
  if (!currentPage) return null;
  try {
    const { data } = await currentPage.send("Page.captureScreenshot", { format: "png" });
    const file = path.join(SHOTS, `${MODE}-${String(shots.length + 1).padStart(2, "0")}-${name}`);
    fs.writeFileSync(file, Buffer.from(data, "base64"));
    shots.push(file);
    return file;
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------- 页面侧读数 */

/**
 * 内核卡片此刻在屏上怎么说。
 *
 * 回执条与「那句红字」共用 `.net-notice--error`，所以靠**结构**分开：
 * 回执条紧跟在卡头之后（`.net-card__head + .net-notice`），红字排在事实表之前。
 * 靠类名分不开——两处都是同一个类。
 */
const CORE_VIEW = `(() => {
  const view = document.querySelector("section.net-verge");
  if (!view) return null;
  const clean = (el) => (el?.innerText || "").trim().replace(/\\s+/g, " ");
  const toneOf = (el, prefix) => ((el?.className || "").match(new RegExp(prefix + "(\\\\w+)")) || [])[1] || null;
  const bar = view.querySelector(".net-card__head + .net-notice");
  const errors = [...view.querySelectorAll(":scope > .net-notice--error")];
  const attention = errors.find((el) => el !== bar) || null;
  const buttons = {};
  for (const name of ["core_start", "core_stop", "core_restart", "core_update", "core_refresh"]) {
    const el = view.querySelector("button[name=\\"" + name + "\\"]");
    buttons[name] = el ? { disabled: !!el.disabled, text: clean(el) } : null;
  }
  const updateSpan = view.querySelector(".net-core-update");
  return {
    loading: !!view.querySelector(".net-loading"),
    state: clean(view.querySelector(".net-status")),
    online: !!view.querySelector(".net-status.is-online"),
    bar: bar ? { text: clean(bar), tone: toneOf(bar, "net-notice--") } : null,
    attention: attention ? clean(attention) : null,
    facts: [...view.querySelectorAll("ul.net-verge__facts li")].map(clean),
    updateSpan: updateSpan ? { text: clean(updateSpan), tone: toneOf(updateSpan, "net-core-update--") } : null,
    hints: [...view.querySelectorAll(":scope > .net-hint")].map(clean),
    toolsHint: clean(view.querySelector(".net-view__tools + .net-hint")),
    buttons,
  };
})()`;

/** 订阅页只用来做沙箱前闸：行数 + 那份一次性账本独有的主机名 + 有没有带着红条进场。 */
const SUB_VIEW = `(() => {
  const view = document.querySelector("section.net-prof");
  if (!view) return null;
  const clean = (el) => (el?.innerText || "").trim().replace(/\\s+/g, " ");
  return {
    loading: !!view.querySelector(".net-loading"),
    rows: view.querySelectorAll(".net-prof-row").length,
    hosts: [...view.querySelectorAll(".net-prof-row__meta")].map(clean),
    errors: [...view.querySelectorAll(".net-notice--error")].map(clean),
  };
})()`;

/** 「来源：Verge 安装目录里那颗（我起的进程）」这类行的值部分；没有这一行回 null。 */
function factValue(snapshot, labelKey) {
  const labels = copyOf(labelKey);
  for (let index = 0; index < LOCALES.length; index += 1) {
    const prefix = `${labels[index]}${tableValue(index, "ui.labelColon")}`;
    for (const fact of snapshot?.facts ?? []) {
      if (fact.startsWith(prefix)) return fact.slice(prefix.length).trim();
    }
  }
  return null;
}

/**
 * `wanted` 的值两种写法：
 * - 一个文案 key（`mode.installed`）：那一行的值必须以三语之一开头，判据自己认词。
 * - null：只钉「这一行存在」，值留给调用方按字面量比对（端口、PID、控制器地址都不是文案）。
 */
function expectFacts(snapshot, wanted, forbidden) {
  for (const [labelKey, valueKey] of Object.entries(wanted)) {
    const value = factValue(snapshot, labelKey);
    if (value === null) throw new Error(`卡上没有「${copyOf(labelKey)[0]}」这一行：${JSON.stringify(snapshot.facts)}`);
    if (valueKey === null) continue;
    if (!isCopy(value, valueKey)) {
      throw new Error(`${copyOf(labelKey)[0]}读的是「${value}」，要的是 network.core.${valueKey} 那句：${JSON.stringify(copyOf(valueKey))}`);
    }
  }
  for (const labelKey of forbidden ?? []) {
    const value = factValue(snapshot, labelKey);
    if (value !== null) throw new Error(`这一档不该有「${copyOf(labelKey)[0]}」这一行，屏上却写着「${value}」`);
  }
}

/**
 * 某一行「值」的前缀（三语各一份），交给页面侧的轮询表达式用。
 *
 * 页面里不能调 `factValue`（那是 Node 侧的函数），而判据又必须在页面里就地认行——
 * 于是把语言表算成的前缀注进表达式。写死 `/PID/` 那种字面量是替产品锁定一种语言，
 * 切到 en/ja 就会打空。
 */
function factRowPrefixes(labelKey) {
  const colon = LOCALES.map((_, index) => tableValue(index, "ui.labelColon"));
  const labels = copyOf(labelKey);
  return LOCALES.map((__, index) => `${labels[index]}${colon[index]}`);
}

/** 页面侧共用的一段：按前缀取那一行的值（取不到回 null）。 */
function pageFactGetter(prefixesJson) {
  return `const prefixes = ${prefixesJson};
    const rowOf = (facts) => {
      for (const row of facts) {
        for (const p of prefixes) if (row.startsWith(p)) return row.slice(p.length).trim();
      }
      return null;
    };`;
}

function hasHint(snapshot, coreKey) {
  const texts = [snapshot?.toolsHint, ...(snapshot?.hints ?? [])].filter(Boolean);
  return texts.some((text) => isCopy(text, coreKey));
}

/* -------------------------------------------------------------- 起 app 与导航 */

const children = [];
const sessions = [];
const servers = [];
let currentPage = null;

function spawnApp(extraEnv) {
  const electronBin = createRequire(import.meta.url)("electron");
  const env = { ...process.env, APPDATA, ...extraEnv };
  // 会话环境里可能带着 ELECTRON_RUN_AS_NODE=1：那样 electron 会把自己当 node 跑。
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electronBin, [".", `--user-data-dir=${PROFILE}`, `--remote-debugging-port=${DEBUG_PORT}`], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const appLog = [];
  child.stdout.on("data", (b) => appLog.push(String(b)));
  child.stderr.on("data", (b) => appLog.push(String(b)));
  children.push({ child, appLog });
  return { child, appLog };
}

/**
 * 开窗。第二段（换环境重启同一个 userData）时欢迎闸门已经没了，
 * 所以这里**两条都等**：先等到哪个算哪个，不许假设自己见过的是第一次开窗。
 */
async function openWindow(label) {
  const started = Date.now();
  let onboarding = null;
  let main = null;
  while (Date.now() - started < 150_000) {
    onboarding = await findTarget((url) => url.includes("onboarding=1"), 1_000);
    if (onboarding) break;
    main = await findTarget((url) => url.includes("/react/index.html") && !url.includes("onboarding=1"), 1_000);
    if (main) break;
  }
  if (onboarding) {
    const gate = await attach(onboarding);
    await evaluate(gate, waitExpression(`() => () => document.querySelector(".cy-onboarding__button--primary") ? true : null`, PAGE_WAIT_MS), { awaitPromise: true });
    await click(gate, ".cy-onboarding__button--primary");
    await evaluate(gate, waitExpression(`() => () => document.querySelector(".cy-onboarding__actions .cy-onboarding__button--primary") ? true : null`, PAGE_WAIT_MS), { awaitPromise: true });
    await clickThatNavigates(gate, ".cy-onboarding__actions .cy-onboarding__button--primary");
    main = await findTarget((url) => url.includes("/react/index.html") && !url.includes("onboarding=1"), 120_000);
  }
  if (!main) throw new Error(`第 ${label} 次开窗没等到主窗 target（欢迎闸门也没等到）`);
  const page = await attach(main);
  currentPage = page;
  await evaluate(page, waitExpression(`() => () => !document.documentElement.hasAttribute("data-ui-theme-pending") ? true : null`, PAGE_WAIT_MS), { awaitPromise: true });
  return page;
}

/**
 * 走到内核卡片，并把沙箱前闸跑掉。
 *
 * 顺序是有意的：**先看订阅页，再点内核**。订阅页读的就是内核那一份账本与同一个
 * `getConfigRoot()`，页面上没有那枚一次性主机名＝app 读的是用户真目录；
 * 那时候点「起内核」会拿真账本起真内核，所以这道闸必须排在任何一次点击之前。
 */
async function navigateToCoreCard(page, report) {
  const networkLabels = LOCALES.map((_, index) => tableValue(index, "ui.network"));
  await evaluate(page, waitExpression(`() => () => {
    const hit = [...document.querySelectorAll("button.cy-side-action")]
      .find((el) => ${JSON.stringify(networkLabels)}.includes((el.getAttribute("title") || "").trim()));
    if (!hit) return null;
    hit.click();
    return true;
  }`, PAGE_WAIT_MS), { awaitPromise: true });

  const subscriptionLabels = LOCALES.map((_, index) => tableValue(index, "network.tabSubscriptions"));
  await evaluate(page, waitExpression(`() => () => {
    const hit = [...document.querySelectorAll(".net-tabs [role='tab']")]
      .find((el) => ${JSON.stringify(subscriptionLabels)}.includes((el.textContent || "").trim()));
    if (!hit) return null;
    hit.click();
    return true;
  }`, PAGE_WAIT_MS), { awaitPromise: true });

  const sub = await evaluate(page, waitExpression(`() => () => {
    const v = ${SUB_VIEW};
    return v && !v.loading && (v.rows > 0 || v.errors.length > 0) ? v : null;
  }`, PAGE_WAIT_MS), { awaitPromise: true });
  report.sandboxPreGate = sub;
  if (sub.rows !== 3) throw new Error(`一次性账本该有 3 行，页面上是 ${sub.rows} 行：${JSON.stringify(sub.hosts)}`);
  if (!sub.hosts.some((text) => text.includes(SCRATCH_HOST))) {
    throw new Error(`订阅页里没有 ${SCRATCH_HOST}，说明读的不是 ${CONFIG_ROOT}——绝不点内核那几颗按钮：${JSON.stringify(sub.hosts)}`);
  }
  if (sub.errors.length > 0) throw new Error(`订阅页进场就带红条：${sub.errors.join("；")}`);

  await evaluate(page, waitExpression(`() => () => {
    const gear = document.querySelector(".net-tabs .net-tab--icon");
    if (!gear) return null;
    gear.click();
    return true;
  }`, PAGE_WAIT_MS), { awaitPromise: true });
  const card = await evaluate(page, waitExpression(`() => () => {
    const v = ${CORE_VIEW};
    return v && !v.loading && v.facts.length > 0 ? v : null;
  }`, PAGE_WAIT_MS), { awaitPromise: true });
  report.cardOnEntry = card;
  await shoot("card-entry.png");
  return card;
}

async function click(session, selectorSource) {
  const target = session ?? currentPage;
  return evaluate(target, `(() => { const el = document.querySelector(${JSON.stringify(selectorSource)}); if (!el) return false; el.click(); return true; })()`);
}

/** 点了会把页面导航走的按钮：导航会吞掉回音，只给 5s 并把超时放行。 */
async function clickThatNavigates(session, selector) {
  const hit = await evaluate(
    session,
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`,
    { timeoutMs: 5_000 },
  ).catch(() => null);
  if (hit === false) throw new Error(`没有可点的 ${selector}`);
  return hit === true;
}

/**
 * 按内核卡片上那颗按钮，并等它的回执条上屏。
 *
 * 灰着的按钮**不去按**：按下去 React 直接吞掉，屏幕上什么都没发生，
 * 那几十秒等待会被读成「回执没来」——而这一档真正要证的恰恰是「它按不动」。
 * 于是 disabled 的按钮只读标志位，红字里说清是哪一颗。
 *
 * `receiptKey` 不是修饰：`run()` 一进去就 `setNotice(null)`，但 React 重绘比我们的轮询慢半拍，
 * 只认「有条回执」就会读到上一次点击那还剩几秒的旧条。按那一句文案的三语前缀认，
 * 旧条立刻对不上，等的就是这一次点击的那句。
 *
 * `waitMs` 要给得下真下载：更新那一颗的下载窗口是 120 秒一跳（`MIHOMO_TIMEOUT_MS`），
 * 用起停那 40 秒等它，量到的会是「尺子先到点」，不是产品。
 */
async function pressCoreButton(name, { expectEnabled = true, receiptKey = null, waitMs = ACTION_WAIT_MS } = {}) {
  const selector = `section.net-verge button[name="${name}"]`;
  const pressed = await evaluate(currentPage, `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return { ok: false, reason: "没有那颗按钮" };
    const text = (el.innerText || "").trim().replace(/\\s+/g, " ");
    if (el.disabled) return { ok: false, reason: "按下去时它是灰的", text };
    el.click();
    return { ok: true, text };
  })()`);
  if (expectEnabled && !pressed.ok) throw new Error(`点不到 ${name}：${pressed.reason}（按钮文本「${pressed.text ?? ""}」）`);
  if (!pressed.ok) return null;
  const wanted = receiptKey ? JSON.stringify(copyOf(receiptKey)) : "[]";
  const snapshot = await evaluate(currentPage, waitExpression(`() => () => {
    const wanted = ${wanted};
    const v = ${CORE_VIEW};
    if (!v || !v.bar) return null;
    return wanted.length === 0 || wanted.some((copy) => v.bar.text.startsWith(copy)) ? v : null;
  }`, waitMs), { awaitPromise: true, timeoutMs: waitMs + 20_000 });
  return snapshot;
}

/** 回执条只有 5 秒；连屏上那三行读数一起抓，一次求值拿全一份现场。 */
async function readCore() {
  return evaluate(currentPage, CORE_VIEW);
}

async function expectReceipt(snapshot, coreKey, { tone = null, detailIncludes = null } = {}) {
  if (!snapshot) throw new Error(`这一趟压根没等来回执条（要的是 network.core.${coreKey}）`);
  const bar = snapshot.bar;
  if (!bar) throw new Error(`回执条上屏了却又没了：${JSON.stringify(snapshot.facts)}`);
  if (!isCopy(bar.text, coreKey)) {
    throw new Error(`回执不是 network.core.${coreKey} 那句：屏上「${bar.text}」（要开头匹配 ${JSON.stringify(copyOf(coreKey))}）`);
  }
  if (tone && bar.tone !== tone) throw new Error(`回执脸色是「${bar.tone}」，要「${tone}」：${bar.text}`);
  if (detailIncludes && !bar.text.includes(detailIncludes)) throw new Error(`回执详情里没有「${detailIncludes}」：${bar.text}`);
  return bar;
}

/* -------------------------------------------------------------- 内核侧取证 */

async function controllerRequest(port, pathName, secret) {
  const headers = secret ? { authorization: `Bearer ${secret}` } : {};
  try {
    const res = await fetch(`http://127.0.0.1:${port}${pathName}`, { headers });
    const text = await res.text();
    return { status: res.status, text };
  } catch (error) {
    return { status: null, text: "", error: String(error?.message ?? error) };
  }
}

/** 控制面三颗键主权（spec D5）+ 正文与内置 Merge 都进了链。 */
function checkRuntimeFile(report, ports) {
  if (!fs.existsSync(RUNTIME_FILE)) throw new Error(`runtime 没长出来：${RUNTIME_FILE}`);
  const text = fs.readFileSync(RUNTIME_FILE, "utf8");
  const runtime = parseYaml(text);
  report.runtime = {
    file: RUNTIME_FILE,
    externalController: runtime?.["external-controller"],
    secret: runtime?.secret,
    mixedPort: runtime?.["mixed-port"],
  };
  if (runtime?.["external-controller"] !== `127.0.0.1:${ports.controller}`) {
    throw new Error(`runtime 的 external-controller 不是注入的那一颗：${JSON.stringify(runtime?.["external-controller"])}（要 127.0.0.1:${ports.controller}，且协议前缀该剥掉）`);
  }
  if (runtime?.secret !== SCRATCH_SECRET) throw new Error(`runtime 的 secret 不是我们那一份：${JSON.stringify(runtime?.secret)}`);
  if (runtime?.["mixed-port"] !== ports.mixed) throw new Error(`runtime 的 mixed-port 是 ${JSON.stringify(runtime?.["mixed-port"])}，要 ${ports.mixed}`);
  const leftovers = [FOREIGN_CONTROLLER, FOREIGN_SECRET, String(FOREIGN_MIXED_PORT)].filter((token) => text.includes(token));
  if (leftovers.length > 0) throw new Error(`runtime 里还留着订阅正文自带的控制面字样（${JSON.stringify(leftovers)}）`);
  if (runtime?.proxies?.[0]?.name !== "scratch-a") throw new Error(`runtime 没带上 ${CURRENT_UID} 的正文：${JSON.stringify(runtime?.proxies?.[0])}`);
  if (runtime?.dns?.enable !== true) throw new Error(`内置 Merge 没进链（dns.enable 不是 true）：${JSON.stringify(runtime?.dns)}`);
  return runtime;
}

/**
 * 卡片那行 PID 背后的真身：映像路径 + 命令行两样都得对上。
 *
 * `-d`/`-f` 指到哪两个目录是 spec D2 唯一的物理证据（内核的缓存与配置都在我们这一侧），
 * 光看屏上那个数字证明不了任何事。
 */
function checkCoreProcess(report, pid, { expectedExe, label }) {
  const info = processInfo(pid);
  report.processes = report.processes ?? {};
  report.processes[label] = info;
  if (!info) throw new Error(`pid=${pid} 在进程表里读不出来（${label}）`);
  const fromArgs = /^"([^"]*)"/.exec(info.commandLine)?.[1] ?? "";
  const actual = (fromArgs || info.declaredExe || info.exe || "").toLowerCase();
  if (actual !== expectedExe.toLowerCase()) {
    throw new Error(`${label} 跑的是「${actual}」，要的是「${expectedExe.toLowerCase()}」`);
  }
  const wantDir = CORE_DIR.toLowerCase();
  const wantFile = RUNTIME_FILE.toLowerCase();
  if (!info.commandLine.toLowerCase().includes(`-d ${wantDir}`) || !info.commandLine.toLowerCase().includes(`-f ${wantFile}`)) {
    throw new Error(`${label} 的命令行不是我们拼的那两条参数：${info.commandLine}`);
  }
  return info;
}

/** 端口读数与真 netstat 一一对照：卡片说「这组端口」时，那两个号真在听、且就是我们那颗在听。 */
function checkListening(report, pid, ports, label) {
  const rows = listeningEntries();
  report.listening = { label, pid, ports, rows: rows.filter((row) => row.port === ports.mixed || row.port === ports.controller) };
  for (const port of [ports.mixed, ports.controller]) {
    const owners = [...new Set(rows.filter((row) => row.port === port).map((row) => row.pid))];
    if (owners.length === 0) throw new Error(`${label}：端口 ${port} 没人监听，可卡片上写着这组端口`);
    if (!owners.includes(pid)) throw new Error(`${label}：端口 ${port} 被 ${JSON.stringify(owners)} 占着，不是卡片上那颗 pid=${pid}`);
  }
}

/** Verge 目录一个字节都不许动（spec D2）：这一趟只读它的账本，写全在 userData。 */
function assertVergeDirUntouched(report, before) {
  const after = snapshotTree(CONFIG_ROOT);
  report.vergeDir = { before, after };
  if (JSON.stringify(after) !== JSON.stringify(before)) {
    const changed = Object.keys({ ...before, ...after }).filter((key) => before?.[key] !== after?.[key]);
    throw new Error(`Verge 目录被动了（${JSON.stringify(changed)}）：内核宿主只准读它，写面只有我们自己的 userData（spec D2）`);
  }
}

function assertLogHygiene(report) {
  const text = readLog();
  report.coreLog = { exists: fs.existsSync(LOG_FILE), bytes: text.length, spawnLines: countMatches(text, "spawn pid=") };
  const leaks = [SCRATCH_SECRET, FOREIGN_SECRET].filter((secret) => text.includes(secret));
  if (leaks.length > 0) {
    throw new Error(`core.log 里出现了口令原文（登记过的那一枚没打码）：${JSON.stringify(leaks.map((value) => value.length))} 个候选值命中`);
  }
  return text;
}

/** 起一颗假控制器：只答话、不干活。`--external` 档里它就是「Verge 那颗内核」的替身。 */
function startFakeController() {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ fake: true, version: "fake-external-core" }));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    // 端口填 0＝让系统挑：写死端口被占时失败的原因是「这台机器忙」，不是产品。
    server.listen(0, "127.0.0.1", () => {
      const entry = { server, port: server.address().port, requests };
      servers.push(entry);
      resolve(entry);
    });
  });
}

/** 发布页自己取一次：资产选择规则与 `pickMihomoAsset` 同一条（连字符最少那颗），免得尺子跟着上游改名一起烂。 */
async function fetchReleaseEvidence() {
  const res = await fetch("https://api.github.com/repos/MetaCubeX/mihomo/releases/latest", {
    headers: { accept: "application/vnd.github+json", "user-agent": "mochi-core-acceptance/v1" },
  });
  if (!res.ok) throw new Error(`发布页回 ${res.status}`);
  const release = await res.json();
  const candidates = (release.assets ?? [])
    .filter((asset) => /^mihomo-windows-amd64-.*\.zip$/i.test(String(asset.name ?? "")) && String(asset.browser_download_url ?? ""))
    .map((asset) => ({ name: asset.name, digest: String(asset.digest ?? "").toLowerCase(), downloadUrl: String(asset.browser_download_url ?? "") }));
  if (candidates.length === 0) throw new Error("发布页里没有 windows-amd64 的 zip");
  const pick = [...candidates].sort((a, b) => a.name.split("-").length - b.name.split("-").length || a.name.localeCompare(b.name))[0];
  const matched = /^sha256:([0-9a-f]{64})$/.exec(pick.digest);
  if (!matched) throw new Error(`发布页没给 ${pick.name} 的 sha256：${JSON.stringify(pick.digest)}`);
  // `downloadUrl` 也带回来：前闸三量的是「产品真会去敲的那条 URL 搬不搬得动」，
  // 换成另一个域或另一颗资产，量到的就不是这一腿的出口了。
  return { tag: release.tag_name, asset: pick.name, digest: matched[1], downloadUrl: pick.downloadUrl, candidates: candidates.length };
}

/**
 * 出口探针：按产品那条资产 URL 取头 `EGRESS_PROBE_BYTES` 字节，取满就掐。
 *
 * 走法与产品对齐到能对齐的地步：`fetch` 默认跟跳转（`Range` 实测过 GitHub 那两跳带得过去，
 * 回 206 且 `content-range: bytes 0-…/<总长>`），UA 用产品那颗 `mochi-core-updater/v1`，
 * 超时交给 `AbortController`——跟 `downloadBytes` 里同一个机制。
 * 出口开关也对齐：`spawnApp` 是 `{...process.env, APPDATA, ...extraEnv}`，`update` 档不注入代理，
 * 所以尺子这个进程和 app 那个进程吃的是**同一组** `HTTPS_PROXY` / `NODE_USE_ENV_PROXY`。
 * 一个字节也不落盘。
 */
async function probeAssetEgress(release) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EGRESS_PROBE_DEADLINE_MS);
  let totalBytes = null;
  let got = 0;
  // 读数一律带着「按这一速率整包要几秒」：判定用的是产品的窗口，不是我看顺眼的某个 KB/s。
  const shape = (ms, extra = {}) => ({
    bytes: got,
    ms,
    totalBytes,
    kbps: got > 0 ? Math.max(1, Math.round(got / (ms / 1000) / 1024)) : 0,
    projectedMs: got > 0 && totalBytes ? Math.round((totalBytes / got) * ms) : null,
    ...extra,
  });
  try {
    const res = await fetch(release.downloadUrl, {
      headers: { range: `bytes=0-${EGRESS_PROBE_BYTES - 1}`, "user-agent": "mochi-core-updater/v1" },
      signal: controller.signal,
    });
    // 206 是「服务器认了 Range」；回 200 就是整包往这儿灌，读满探针那 2 MB 也照样算得出速率。
    if (res.status !== 206 && res.status !== 200) throw new Error(`回 ${res.status}`);
    const fromRange = /\/(\d+)\s*$/.exec(String(res.headers.get("content-range") ?? ""));
    const declared = fromRange ? Number(fromRange[1]) : Number(res.headers.get("content-length"));
    totalBytes = Number.isFinite(declared) && declared > 0 ? declared : null;
    const reader = res.body?.getReader?.();
    if (!reader) throw new Error("没给可读的响应体");
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.length;
      if (got >= EGRESS_PROBE_BYTES) break;
    }
    return shape(Date.now() - startedAt);
  } catch (error) {
    const ms = Date.now() - startedAt;
    const cause = error?.cause?.code ?? error?.cause?.message ?? "";
    // 分得清「自己掐表」与「对家掀了」：两种都带着速率回交给 `assertUpdateEgress` 判。
    // 前者是这一档的常态（慢腿等不满一整段），那仍是一个能拿来投影的速率；后者连这一小段都没稳住，
    // 摊出来的速率不算数——留在这儿不判，判它的地方就是唯一说这句话的地方。
    const aborted = error?.name === "AbortError" || error?.cause?.name === "AbortError";
    if (got > 0) {
      return shape(ms, { cutShort: aborted ? "到点自己掐表" : `${String(error?.message ?? error)}${cause ? `（${cause}）` : ""}`, timedOut: aborted });
    }
    throw new Error(`${hostOf(release.downloadUrl)} 回不来：${String(error?.message ?? error)}${cause ? `（${cause}）` : ""}，${ms}ms 内一个字节都没到`);
  } finally {
    clearTimeout(timer);
    // 探针自己拉起的那条流要还回去：不掐，node 的事件循环一直被它撑着，
    // 尺子会在报完 ENV 之后挂在那儿不退（`--external` 那趟就是这样被外面的超时杀掉的）。
    controller.abort();
  }
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return String(url).slice(0, 60);
  }
}

/** 前闸三取回来的发布页，腿里那一趟直接复用：同一趟问两次发布页，两次的答案可能不是同一版。 */
let updateRelease = null;

/**
 * `update` 档的第三道前闸：先把「这条出口搬不搬得完那一整包」量出来，再决定开不开 app。
 *
 * 排在 `spawnApp` 之前是有理由的：这一腿的产品判据要真下真换，出口不通时它在屏上留下的
 * 只有那句 `mihomo-windows-amd64-….zip 没下回来：请求没回来：fetch failed`——
 * 尺子拿 320 秒去等一句环境话，最后报的是产品红（exit 1），读起来像「换装这条路坏了」。
 * 2026-11-01 实测：这台机器此刻直连 GitHub 是元数据通、bulk 不通（1 MB 段 ECONNRESET，
 * 2 MB 段 27 KB/s），Clash Verge 那 7896 没在听（用户把 GUI 关了，尺子不去启它）。
 * 所以这一闸只说一句话：**这一趟没开 app、一个字节都没写，缺的是一条能搬 bulk 的出口。**
 */
async function assertUpdateEgress(report) {
  let release;
  try {
    release = await fetchReleaseEvidence();
  } catch (error) {
    throw new EnvError(`发布页这一趟问不到（${error?.message ?? error}）：环境不通，不是产品没换成`);
  }
  report.release = release;
  updateRelease = release;
  let probe;
  try {
    probe = await probeAssetEgress(release);
  } catch (error) {
    throw new EnvError(`${error?.message ?? error}；这一档要真下 ${release.asset}，包搬不动是环境问题，不是产品没换成`);
  }
  report.egressProbe = { ...probe, tag: release.tag, asset: release.asset, productWindowMs: MIHOMO_ASSET_WINDOW_MS, budgetMs: EGRESS_BUDGET_MS };
  if (probe.projectedMs === null) {
    throw new EnvError(
      `${hostOf(release.downloadUrl)} 这一趟读不出包的总长（content-range / content-length 都没有），` +
        `算不出「${release.asset} 在 ${MIHOMO_ASSET_WINDOW_MS / 1000} 秒里搬不搬得完」——证明不了就别按下那颗键。`,
    );
  }
  if (probe.cutShort && !probe.timedOut) {
    // 对家先把连接掀了：这一段速率根本不代表一条搬得动 22 MB 的腿。早先这一档跟「自己掐表」并成一回事，
    // 于是 192 KB 后 destroy 的那种腿会投影成「几秒就到」并放行——产品随后红给你看。
    throw new EnvError(
      `${hostOf(release.downloadUrl)} 这一趟连 ${EGRESS_PROBE_BYTES} 字节这一小段都没稳住：探针收到 ${probe.bytes} 字节用了 ${probe.ms}ms` +
        `（约 ${probe.kbps} KB/s，断因：${probe.cutShort}），摊不出可信的速率，这一档就不下结论。`,
    );
  }
  if (probe.projectedMs > EGRESS_BUDGET_MS) {
    throw new EnvError(
      `${hostOf(release.downloadUrl)} 这一趟搬不完 ${release.asset}：探针收到 ${probe.bytes} 字节用了 ${probe.ms}ms（约 ${probe.kbps} KB/s），` +
        `整包 ${probe.totalBytes} 字节按这速率要 ${Math.round(probe.projectedMs / 1000)} 秒，而产品给资产那一跳只有 ` +
        `${MIHOMO_ASSET_WINDOW_MS / 1000} 秒（这一闸要它落在 ${EGRESS_BUDGET_MS / 1000} 秒内）` +
        `${probe.cutShort ? `，探针自己到点就断了：${probe.cutShort}` : ""}。` +
        "补一条能搬 bulk 的出口再跑这一档：`HTTPS_PROXY` 配 `NODE_USE_ENV_PROXY=1` 会随 spawnApp 进 app 的环境，不注入就是直连。",
    );
  }
}

/* ------------------------------------------------------------------- 各档腿 */

let stepNo = 0;
function step(label) {
  console.log(`[core-card-cdp:${MODE}] → ${++stepNo} ${label}`);
}

/** 公共收尾：把「我们起的这颗」停干净，并证明停干净了。 */
async function stopOwnCore(report, expectPortsReleased) {
  const snapshot = await pressCoreButton("core_stop", { receiptKey: "stopped" });
  const bar = await expectReceipt(snapshot, "stopped", { tone: "ok" });
  expectFacts(snapshot, {}, ["portsLabel", "pidLabel", "controllerLabel"]);
  if (!isCopy(snapshot.state, "state.stopped")) throw new Error(`点完停止，状态徽标不是「已停止」：${snapshot.state}`);
  if (snapshot.online) throw new Error(`账上说是已停止，徽标还亮着绿点`);
  if (snapshot.attention) throw new Error(`停成功了却还挂着一句红字：${snapshot.attention}`);
  if (!hasHint(snapshot, "hint.idle")) throw new Error(`停下之后顶上那句说明没回到「现在没有内核归我管」：${JSON.stringify(snapshot.hints)}`);
  report.stop = { bar: bar.text, facts: snapshot.facts };
  if (expectPortsReleased) {
    await new Promise((r) => setTimeout(r, 1_200));
    const still = listeningEntries().filter((row) => row.port === expectPortsReleased.mixed || row.port === expectPortsReleased.controller);
    report.portsAfterStop = still;
    if (still.length > 0) throw new Error(`停下之后端口还在听：${JSON.stringify(still)}——卡片说「已停止」而真端口没收回`);
  }
  return snapshot;
}

async function legStart(report) {
  const ports = { mixed: LEG.mixed, controller: LEG.controller };
  step("点「起内核」（借安装目录里那颗，真 spawn）");
  const started = await pressCoreButton("core_start", { receiptKey: "started" });
  await expectReceipt(started, "started", { tone: "ok" });
  report.start = { bar: started.bar.text, facts: started.facts, state: started.state, buttons: started.buttons };
  if (!started.online) throw new Error(`内核起来了却没亮绿点：${started.state}`);
  if (!isCopy(started.state, "state.running")) throw new Error(`状态徽标不是「运行中」：${started.state}`);
  expectFacts(started, {
    modeLabel: "mode.installed",
    secretLabel: "secret.verge",
    controllerLabel: null,
    portsLabel: null,
    pidLabel: null,
  }, []);
  // 上面那四条只认「行在不在」；值逐条钉死在下面（端口那行是字面数，不是一句文案）。
  if (factValue(started, "controllerLabel") !== `http://127.0.0.1:${ports.controller}`) {
    throw new Error(`控制器那一行不是回执里那个地址：${JSON.stringify(factValue(started, "controllerLabel"))}`);
  }
  if (factValue(started, "portsLabel") !== `${ports.mixed} / ${ports.controller}`) {
    throw new Error(`端口那行读的是「${factValue(started, "portsLabel")}」，要「${ports.mixed} / ${ports.controller}」：`
      + "这就是账本上声明的那一组（两个号起先都量过空闲），漂了就说明 pickPortPair 退到了扫描段");
  }
  const pid = Number(factValue(started, "pidLabel"));
  if (!Number.isInteger(pid) || pid <= 0) throw new Error(`PID 那一行读不出数字：${JSON.stringify(factValue(started, "pidLabel"))}`);
  report.pid = pid;
  if (factValue(started, "healLabel") !== null) throw new Error(`一次都没崩过，卡上却写着自愈计数：${factValue(started, "healLabel")}`);

  step("屏上读数 ↔ 真进程/真端口/真控制器 三方对照");
  const installedExe = requireInstalledCoreExe(report);
  checkCoreProcess(report, pid, { expectedExe: installedExe, label: "start" });
  checkListening(report, pid, ports, "start");
  checkRuntimeFile(report, ports);
  const authorized = await controllerRequest(ports.controller, "/version", SCRATCH_SECRET);
  const unauthorized = await controllerRequest(ports.controller, "/version", null);
  const foreign = await controllerRequest(ports.controller, "/version", FOREIGN_SECRET);
  report.controller = { authorized, unauthorized, foreign };
  if (authorized.status !== 200) throw new Error(`用我们注入的口令敲控制器回 ${authorized.status}：整条数据面会全瞎`);
  if (unauthorized.status !== 401) throw new Error(`不带口令竟然也回 ${unauthorized.status}，说明口令压根没生效`);
  if (foreign.status !== 401) throw new Error(`用订阅正文那把口令也回 ${foreign.status}，说明注入没压过它（spec D5）`);

  step("灰不灰：运行中该有停止/重启，更新仍可点");
  for (const name of ["core_stop", "core_restart", "core_update"]) {
    if (started.buttons[name]?.disabled) throw new Error(`运行中 ${name} 是灰的，点不动`);
  }
  if (started.buttons.core_start?.disabled === false) throw new Error(`已经有一颗在应答了，「起内核」还准按（再点一次什么也不发生，灰着比让人以为「点了没反应」好）`);
  if (hasHint(started, "hint.external")) throw new Error(`这是我们自己起的那颗，卡上却写着「要停 Verge 那颗请回 Clash Verge」`);
  if (!hasHint(started, "hint.ownRunning")) throw new Error(`顶上那句说明没认领「这一颗是我起的」：${JSON.stringify(started.hints)}`);

  step("等一次不请自来的轮询：「已运行」得自己长出来");
  // 起来那一刻 `now` 还是进页面时的钟，`now - startedAt` 是负数 → 这一行按判定不该画。
  // 它只能靠卡片每 10 秒自己重读长出来——这一条同时是「账是活的」那句话说到的那次轮询。
  const uptimePrefixes = JSON.stringify(factRowPrefixes("uptimeLabel"));
  const polled = await evaluate(currentPage, waitExpression(`() => () => {
    ${pageFactGetter(uptimePrefixes)}
    const v = ${CORE_VIEW};
    if (!v || v.loading) return null;
    return rowOf(v.facts) === null ? null : v;
  }`, POLL_WAIT_MS), { awaitPromise: true, timeoutMs: POLL_WAIT_MS + 15_000 });
  report.uptimePoll = { facts: polled.facts };
  report.uptimeReadout = factValue(polled, "uptimeLabel");
  if (!report.uptimeReadout) throw new Error(`轮询等到了「已运行」这一行却读不出值：${JSON.stringify(polled.facts)}`);
  if (!isCopy(polled.state, "state.running")) throw new Error(`长出「已运行」那一行时状态却不在「运行中」：${polled.state}`);

  step("点「重启」：账上换一颗 pid，端口以回执为准");
  const restarted = await pressCoreButton("core_restart", { receiptKey: "restarted" });
  await expectReceipt(restarted, "restarted", { tone: "ok" });
  const pid2 = Number(factValue(restarted, "pidLabel"));
  report.restart = { bar: restarted.bar.text, pidBefore: pid, pidAfter: pid2 };
  if (!Number.isInteger(pid2) || pid2 === pid) throw new Error(`重启之后 pid 没换：${pid} → ${pid2}`);
  checkCoreProcess(report, pid2, { expectedExe: installedExe, label: "restart" });
  checkListening(report, pid2, ports, "restart");
  if (await controllerRequest(ports.controller, "/version", SCRATCH_SECRET).then((r) => r.status) !== 200) {
    throw new Error(`重启起来的那颗用同一把口令敲不开：口令来源变了还是端口变了`);
  }

  step("点「停止」：kill 是我们发的，pid 与端口都收回来了");
  await stopOwnCore(report, ports);

  step("盘上收尾：日志、脱敏、Verge 目录");
  const log = assertLogHygiene(report);
  if (countMatches(log, "spawn pid=") !== 2) throw new Error(`这一趟该正好 spawn 两次（起 + 重启），日志里数到 ${countMatches(log, "spawn pid=")} 次`);
  if (!log.includes("已停止（我们发起的）")) throw new Error(`日志里没有「我们发起的停止」那一句：起停两条腿少了一条现场`);
  if (!log.includes("runtime 配置已写 core.yaml")) throw new Error(`日志里没记那份 runtime 配置写出去了：${RUNTIME_FILE}`);
  if (!log.includes("口令来源=verge")) throw new Error(`日志里没说清这一班用的是 Verge 账上那把口令`);
}

async function legExternal(report) {
  const fake = servers[0];
  const controllerHost = `http://127.0.0.1:${fake.port}`;
  step("点「起内核」：控制器可达就该只接管、不动手");
  const started = await pressCoreButton("core_start", { receiptKey: "adopted" });
  await expectReceipt(started, "adopted", { tone: "ok" });
  report.external = { bar: started.bar.text, facts: started.facts, buttons: started.buttons, hints: started.hints };
  if (!started.online || !isCopy(started.state, "state.running")) throw new Error(`接管成功却没亮绿点：${started.state}`);
  expectFacts(started, { modeLabel: "mode.external", secretLabel: "secret.none" }, ["portsLabel", "pidLabel", "uptimeLabel", "healLabel"]);
  if (factValue(started, "controllerLabel") !== controllerHost) {
    throw new Error(`控制器那一行不是那本账上声明的地址：${JSON.stringify(factValue(started, "controllerLabel"))} vs ${controllerHost}`);
  }
  // 「端口没有」与「PID 没有」是这一档最容易被画歪的两行：external 的 startedAt 是我们发现它的时刻，
  // 把它写成「已运行 34 秒」是编出来的数字；pid 报 null 也不是「没在跑」。
  if (started.attention) throw new Error(`接管成功却挂着一句红字：${started.attention}`);
  if (!hasHint(started, "hint.externalRunning")) throw new Error(`顶上那句说明没说是吃别人的内核：${JSON.stringify(started.hints)}`);

  step("会 kill 进程的两颗按钮必须按不动");
  for (const name of ["core_stop", "core_restart"]) {
    if (started.buttons[name]?.disabled === false) {
      throw new Error(`${name} 在 external 态是亮的：那点下去是替用户关掉他正在用的那颗`);
    }
  }
  if (started.buttons.core_start?.disabled === false) throw new Error(`已经接管上了，「起内核」还准按`);
  if (started.buttons.core_update?.disabled) throw new Error(`external 态把「更新内核」也灰了：那颗占的是 Verge 的安装目录，我们那颗文件从来不在它手上`);
  if (!hasHint(started, "hint.external")) throw new Error(`灰着一排按钮却没说明为什么灰：${JSON.stringify(started.hints)}`);

  step("不动手的证据：没 spawn、没写配置、没占端口，那颗假控制器还在");
  const log = assertLogHygiene(report);
  if (countMatches(log, "spawn pid=") !== 0) throw new Error(`接管这条路 spawn 了 ${countMatches(log, "spawn pid=")} 次内核：可达即不动手那条戒律没守住`);
  if (!log.includes(`控制器可达，用 external=${controllerHost}`)) throw new Error(`日志里没有「控制器可达，用 external」这一句：${JSON.stringify(log.split(/\r?\n/).slice(-6))}`);
  if (fs.existsSync(RUNTIME_DIR)) throw new Error(`接管这一档写出了 ${RUNTIME_DIR}：不启进程就不该动配置`);
  if (fs.existsSync(CORE_DIR)) throw new Error(`接管这一档长出了 ${CORE_DIR}：连内核的工作目录都不该碰`);
  if (listeningPids(LEG.mixed).length > 0 || listeningPids(LEG.controller).length > 0) {
    throw new Error(`接管这一档把端口占住了：${JSON.stringify(listeningEntries().filter((row) => row.port === LEG.mixed || row.port === LEG.controller))}`);
  }
  const alive = await controllerRequest(fake.port, "/version", null);
  report.fakeControllerStillAlive = alive.status;
  if (alive.status !== 200) throw new Error(`我们接管完，那颗替身控制器却不答话了（回 ${alive.status}）：说明动的是它，不是账本`);
  report.fakeRequests = fake.requests.slice(0, 12);
  if (!fake.requests.some((line) => line.endsWith("/version"))) throw new Error(`假控制器一次都没被敲过，那「接管」是从哪儿判出来的：${JSON.stringify(fake.requests)}`);
}

async function legGate(report) {
  step("闸门开着时种一枚同名映像：这一档要的是「隔壁在跑」");
  const plant = plantVergeImage();
  report.plant = plant;
  let tripped = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (vergeRunning()) { tripped = true; break; }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!tripped) throw new Error(`种下去的 ${plant.image} 没让 tasklist 认出 clash-verge.exe：这一档量的就不是闸门`);

  step("点「起内核」：闸门在 spawn 之前就该挡下");
  const blocked = await pressCoreButton("core_start", { receiptKey: "reason.verge-running" });
  await expectReceipt(blocked, "reason.verge-running", { tone: "error" });
  report.gate = { bar: blocked.bar.text, facts: blocked.facts, attention: blocked.attention, buttons: blocked.buttons };
  if (blocked.online) throw new Error(`被闸门挡下了却亮着绿点`);
  if (!isCopy(blocked.state, "state.blocked")) throw new Error(`状态不是「没让它起」：${blocked.state}`);
  expectFacts(blocked, { modeLabel: "mode.none", secretLabel: "secret.none" }, ["portsLabel", "pidLabel", "controllerLabel", "uptimeLabel"]);
  if (!blocked.attention) throw new Error(`挡下了却没在卡上留那句红字（只有回执条一闪的话，用户回头就看不见原因了）`);
  if (!isCopy(blocked.attention, "reason.verge-running")) throw new Error(`那句红字说的不是闸门：${blocked.attention}`);
  if (!hasHint(blocked, "hint.attention")) throw new Error(`顶上那句说明没先让人去看下面那句红字：${JSON.stringify(blocked.hints)}`);
  if (blocked.buttons.core_stop?.disabled === false || blocked.buttons.core_restart?.disabled === false) {
    throw new Error(`手上没有一颗进程，「停止/重启」却是亮的`);
  }

  step("挡下时一个字节都不许多写");
  const log = assertLogHygiene(report);
  if (countMatches(log, "spawn pid=") !== 0) throw new Error(`闸门挡下的这一次真的 spawn 了内核`);
  if (fs.existsSync(RUNTIME_DIR)) throw new Error(`闸门挡下却写出了 runtime：那一枚是没人吃的孤儿文件`);
  if (fs.existsSync(CORE_DIR)) throw new Error(`闸门挡下却长出了内核目录：${CORE_DIR}`);
  assertVergeDirUntouched(report, report.vergeBefore);

  step("正对照：拔掉这枚映像，同一颗按钮就得真的起得来");
  killPlant(plant);
  report.plantClearedAt = new Date().toISOString();
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (!vergeRunning()) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  if (vergeRunning()) throw new Error(`拔掉同名映像后 tasklist 还说 clash-verge.exe 在跑：正对照没法做`);
  // 探针那一份结果缓存 2 秒（VERGE_PROBE_TTL_MS）：不等过它，第二次点击读到的还是上一轮的旧账。
  await new Promise((r) => setTimeout(r, 3_000));
  const opened = await pressCoreButton("core_start", { receiptKey: "started" });
  await expectReceipt(opened, "started", { tone: "ok" });
  report.gatePositive = { bar: opened.bar.text, facts: opened.facts };
  const pid = Number(factValue(opened, "pidLabel"));
  if (!Number.isInteger(pid) || pid <= 0) throw new Error(`闸门拆开后起来了，可 PID 那一行读不出来：${JSON.stringify(opened.facts)}`);
  checkListening(report, pid, { mixed: LEG.mixed, controller: LEG.controller }, "gate-positive");
  checkRuntimeFile(report, { mixed: LEG.mixed, controller: LEG.controller });
  const authorized = await controllerRequest(LEG.controller, "/version", SCRATCH_SECRET);
  if (authorized.status !== 200) throw new Error(`正对照那颗起来了却敲不开控制器（回 ${authorized.status}）`);
  await stopOwnCore(report, { mixed: LEG.mixed, controller: LEG.controller });
}

/** 借安装版那颗的档位共用：读不出这颗内核就是环境不满足，不该记在产品头上。 */
function requireInstalledCoreExe(report) {
  const installed = installedCoreExe();
  if (!installed) throw new EnvError("三个安装基址里都没有 `verge-mihomo*.exe`：这一档要量的「借安装版那颗」根本不存在");
  report.installedCore = installed;
  return installed.exe;
}

async function legHeal(report) {
  const ports = { mixed: LEG.mixed, controller: LEG.controller };
  const installedExe = requireInstalledCoreExe(report);
  step("先正常起一颗我们自己的");
  const started = await pressCoreButton("core_start", { receiptKey: "started" });
  await expectReceipt(started, "started", { tone: "ok" });
  const pid1 = Number(factValue(started, "pidLabel"));
  checkCoreProcess(report, pid1, { expectedExe: installedExe, label: "heal-before" });
  report.heal = { pidBefore: pid1 };

  step(`真杀掉 pid=${pid1}（我们自己 spawn 的那颗），一个字也不碰隔壁`);
  runCapture("taskkill", ["/F", "/PID", String(pid1)]);

  step("不动任何按钮，等卡片自己把新账换上屏");
  // 这一条是这张卡最容易被跳过的一档：崩溃发生在页面看不见的时候，
  // 只读一次就会一直停在点按钮那一瞬间的旧账上——所以判据是「谁也不按，屏上自己变」。
  // PID 那一行的标签按三语前缀认（写死 /PID/ 是替产品锁定一种语言，切到 en/ja 就空手而归）。
  const pidPrefixes = JSON.stringify(factRowPrefixes("pidLabel"));
  const healed = await evaluate(currentPage, waitExpression(`() => () => {
    ${pageFactGetter(pidPrefixes)}
    const v = ${CORE_VIEW};
    if (!v || v.loading) return null;
    const pid = Number(rowOf(v.facts));
    return v.online && Number.isInteger(pid) && pid > 0 && pid !== ${pid1} ? v : null;
  }`, POLL_WAIT_MS), { awaitPromise: true, timeoutMs: POLL_WAIT_MS + 15_000 });
  report.heal.bar = healed.bar ? healed.bar.text : null;
  report.heal.facts = healed.facts;
  const pid2 = Number(factValue(healed, "pidLabel"));
  if (pid2 === pid1) throw new Error(`屏上还是那颗 pid：${pid1}`);
  if (factValue(healed, "healLabel") !== "1/3") throw new Error(`自愈那一行读的是「${factValue(healed, "healLabel")}」，要 1/3`);
  if (!isCopy(healed.state, "state.running")) throw new Error(`重起之后状态徽标不是「运行中」：${healed.state}`);
  if (healed.attention) throw new Error(`自愈成功了还挂着红字：${healed.attention}`);

  step("新 pid 的三方对照 + 日志里的两次 spawn");
  checkCoreProcess(report, pid2, { expectedExe: installedExe, label: "heal-after" });
  checkListening(report, pid2, ports, "heal-after");
  const authorized = await controllerRequest(ports.controller, "/version", SCRATCH_SECRET);
  report.heal.controller = authorized.status;
  if (authorized.status !== 200) throw new Error(`自愈起来的那颗用同一把口令敲不开（回 ${authorized.status}）`);
  const log = assertLogHygiene(report);
  if (countMatches(log, "spawn pid=") !== 2) throw new Error(`崩溃自愈这一趟该有 2 次 spawn，日志里数到 ${countMatches(log, "spawn pid=")} 次`);
  if (!log.includes("内核退出 mode=installed")) throw new Error(`日志里没记那次真退出：${JSON.stringify(lastLogLine(log, "内核退出"))}`);
  if (!log.includes("第 1/3 次自愈重起")) throw new Error(`日志里没记第 1 次自愈：${JSON.stringify(lastLogLine(log, "自愈"))}`);

  step("人工「重启」= 新一轮意图：自愈计数要归零");
  const restarted = await pressCoreButton("core_restart", { receiptKey: "restarted" });
  await expectReceipt(restarted, "restarted", { tone: "ok" });
  report.heal.reset = { facts: restarted.facts, pidAfter: Number(factValue(restarted, "pidLabel")) };
  if (factValue(restarted, "healLabel") !== null) throw new Error(`手动重启之后还挂着自愈计数：${factValue(restarted, "healLabel")}`);
  await stopOwnCore(report, ports);
}

async function legUpdate(report) {
  const ports = { mixed: LEG.mixed, controller: LEG.controller };
  const installedExe = requireInstalledCoreExe(report);
  // 发布页由前闸三取、出口由前闸三量（`report.release` / `report.egressProbe` 就在那一趟里落下）：
  // 腿里再问一次会多一个「两次答案不是同一版」的形状，而那正好是这一档最难查的错。
  const release = updateRelease;
  if (!release) throw new EnvError("发布页没由前闸三取回来：这一档的入口不在 main 的闸门序列里");

  step("第一次点「更新内核」：真下 22 MB、对摘要、换装（此刻没有我们在跑的那颗）");
  if (fs.existsSync(BUNDLED_EXE)) throw new Error(`开局就该没有 ${BUNDLED_EXE}：这一档要量的是「从没有到装上」`);
  const first = await pressCoreButton("core_update", { receiptKey: "update.outcome.installed", waitMs: UPDATE_WAIT_MS });
  const firstBar = await expectReceipt(first, "update.outcome.installed", { tone: "ok" });
  report.updateInstalled = { bar: firstBar.text, span: first.updateSpan, facts: first.facts };
  // 「装上了」这句不许偷来一颗绿点当「用上了」：这一档此刻一颗进程都不是我们起的。
  if (first.online) throw new Error(`换完文件这张卡就亮了绿点：把「装上了」说成「生效了」`);
  if (!hasDetailFragment(firstBar.text)) {
    throw new Error(`installed 的回执没把那句「本机还有安装版那颗」带给用户：${firstBar.text}`);
  }
  if (!fs.existsSync(BUNDLED_EXE)) throw new Error(`回执说装上了，${BUNDLED_EXE} 却不在盘上`);
  report.installedExeEvidence = { sha256: sha256(BUNDLED_EXE), bytes: fs.statSync(BUNDLED_EXE).size, tag: release.tag };
  if (fs.existsSync(STAGING_DIR)) throw new Error(`临时目录没清掉：${STAGING_DIR}`);
  // 这里不敲控制器：这一趟压根没起进程，`/version` 只会回一个 ECONNREFUSED，
  // 把它记成「换装前的版本」是给报告留一条谁也不读的假对照。真版本在下面那颗起来之后量。

  let log = assertLogHygiene(report);
  if (!log.includes(`摘要已核对 ${release.digest}`)) {
    throw new Error(`日志里没有「摘要已核对 <发布页那个 sha256>」：核对的不是我独立取回来的那一版（要 ${release.digest}）`);
  }
  if (countMatches(log, "摘要已核对") !== 1) throw new Error(`这趟核对摘要 ${countMatches(log, "摘要已核对")} 次，要正好 1 次`);
  const installedLine = lastLogLine(log, "更新 outcome=installed");
  if (!installedLine) throw new Error(`日志里没有 outcome=installed 那一行`);
  report.shadowNote = updateLogDetail(installedLine);
  // `installed` 这一档的 detail 只有「本机还有安装版那颗」一个来源（见 mihomo-update 的 settle），
  // 所以「detail 非空」＝那句提醒说出口了，不必把产品内部的措辞在尺子里重打一遍。
  if (!report.shadowNote) throw new Error(`installed 的回执里没有「装了却不生效」那句提醒：${installedLine}`);

  step("起了它才发现：三态发现优先借安装版，我们那颗一步都没走");
  const started = await pressCoreButton("core_start", { receiptKey: "started" });
  await expectReceipt(started, "started", { tone: "ok" });
  expectFacts(started, { modeLabel: "mode.installed" }, []);
  const borrowedPid = Number(factValue(started, "pidLabel"));
  checkCoreProcess(report, borrowedPid, { expectedExe: installedExe, label: "update-borrowed" });
  const runningVersion = JSON.parse((await controllerRequest(ports.controller, "/version", SCRATCH_SECRET)).text || "{}");
  report.borrowedVersion = runningVersion;
  const shaBorrowed = sha256(BUNDLED_EXE);
  const mtimeBorrowed = mtimeMs(BUNDLED_EXE);

  step("跑着的时候点「更新内核」：要中性色那句 busy，而且不烧那 22 MB");
  const busy = await pressCoreButton("core_update", { receiptKey: "update.outcome.busy", waitMs: UPDATE_WAIT_MS });
  await expectReceipt(busy, "update.outcome.busy", { tone: "neutral" });
  report.updateBusy = { bar: busy.bar.text };
  if (sha256(BUNDLED_EXE) !== shaBorrowed) throw new Error(`busy 这一次却把 ${BUNDLED_EXE} 换了`);
  if (mtimeMs(BUNDLED_EXE) !== mtimeBorrowed) throw new Error(`busy 这一次动了文件的时间戳`);
  log = readLog();
  if (countMatches(log, "摘要已核对") !== 1) throw new Error(`busy 这一趟真去下载并核对摘要了（${countMatches(log, "摘要已核对")} 次）：明知换不了还先烧带宽`);
  if (!lastLogLine(log, "更新 outcome=busy")) throw new Error(`日志里没记 outcome=busy 那一行`);
  if (fs.existsSync(STAGING_DIR)) throw new Error(`busy 这一次留下了临时目录`);

  step("停下来再点：逐字节相同那句 latest，文件与时间戳都不许动");
  await stopOwnCore(report, ports);
  const latest = await pressCoreButton("core_update", { receiptKey: "update.outcome.latest", waitMs: UPDATE_WAIT_MS });
  await expectReceipt(latest, "update.outcome.latest", { tone: "ok" });
  report.updateLatest = { bar: latest.bar.text, span: latest.updateSpan, facts: latest.facts };
  if (sha256(BUNDLED_EXE) !== shaBorrowed) throw new Error(`latest 这一次重写了文件`);
  if (mtimeMs(BUNDLED_EXE) !== mtimeBorrowed) throw new Error(`latest 这一次动了时间戳（「文件没动」那句是假的）`);
  if (fs.existsSync(STAGING_DIR)) throw new Error(`latest 留下了临时目录`);
  log = readLog();
  if (countMatches(log, "摘要已核对") !== 2) throw new Error(`latest 这一趟该核对一次摘要（共 2 次），实际 ${countMatches(log, "摘要已核对")} 次`);
  if (!lastLogLine(log, "更新 outcome=latest")) throw new Error(`日志里没记 outcome=latest 那一行`);

  step("第二段：把安装版遮掉再开一扇窗——同一颗文件这时候才真的算「生效」");
  const hide = hideInstallsEnv();
  report.bundledPhase = { hiddenBases: hide.hidden };
  if (hide.hidden.length === 0) throw new EnvError("这台机器上找不到要遮的安装基址，走不到 bundled 态：没有基址可遮是环境问题，不是产品没换成");
  if (hasInstalledCore(installedBaseOf(hide.overrides.PROGRAMFILES)) || hasInstalledCore(installedBaseOf(hide.overrides["PROGRAMFILES(X86)"]))) {
    throw new Error(`遮完还看得见内核：遮蔽目录里居然放着 verge-mihomo*.exe`);
  }
  await closeApp("换 bundled 档的环境要重开一扇窗");
  spawnApp(hide.overrides);
  const page2 = await openWindow("bundled 段");
  const card2 = await navigateToCoreCard(page2, report.bundledPhase);
  // 更新那本账活在内存里（`CoreUpdateState` 不落盘）：重开之后卡片回到「还没试过更新」。
  // 这一条不许悄悄放过——「上次更新」那行只在同一班里可见，是这张卡的边界。
  if (card2.updateSpan) throw new Error(`重开一扇窗之后「${copyOf("update.lastLabel")[0]}」那一行还在：${JSON.stringify(card2.facts)}`);
  if (!hasHint(card2, "update.firstHint")) throw new Error(`重开后没把「还没试过更新」那句教回卡片：${JSON.stringify(card2.hints)}`);
  const bundledStart = await pressCoreButton("core_start", { receiptKey: "started" });
  await expectReceipt(bundledStart, "started", { tone: "ok" });
  expectFacts(bundledStart, { modeLabel: "mode.bundled" }, []);
  const bundledPid = Number(factValue(bundledStart, "pidLabel"));
  checkCoreProcess(report, bundledPid, { expectedExe: BUNDLED_EXE, label: "bundled" });
  const bundledPorts = { mixed: LEG.mixed, controller: LEG.controller };
  checkListening(report, bundledPid, bundledPorts, "bundled");
  const running = await controllerRequest(bundledPorts.controller, "/version", SCRATCH_SECRET);
  report.bundledPhase.version = running;
  if (running.status !== 200) throw new Error(`自托管那颗的控制器回 ${running.status}：装上了却敲不开`);
  if (!String(running.text).includes(release.tag)) {
    throw new Error(`真跑起来的这颗不是发布页那一版（要含 ${release.tag}，回的是 ${running.text.slice(0, 120)}）`);
  }
  report.bundledPhase.facts = bundledStart.facts;
  await stopOwnCore(report, bundledPorts);
  const finalLog = assertLogHygiene(report);
  // `core.log` 是跨两扇窗 append-only 的同一本账，所以这里数的是整趟的总数：
  // 借安装版那颗一次 + 遮掉之后自托管那颗一次 = 2。
  if (countMatches(finalLog, "spawn pid=") !== 2) throw new Error(`更新这一整趟（两扇窗同一本日志）只该有 2 次 spawn：借安装版一次、自托管一次。实际 ${countMatches(finalLog, "spawn pid=")} 次`);
}

async function legNoConfig(report) {
  const ports = { mixed: LEG.mixed, controller: LEG.controller };
  step("没选订阅时点「起内核」：配置写不出来就不该 spawn");
  const blocked = await pressCoreButton("core_start", { receiptKey: "reason.no-config" });
  const bar = await expectReceipt(blocked, "reason.no-config", { tone: "error" });
  report.noConfig = { bar: bar.text, facts: blocked.facts, attention: blocked.attention, buttons: blocked.buttons };
  if (blocked.online) throw new Error(`配置都没写出来却亮了绿点`);
  if (!isCopy(blocked.state, "state.blocked")) throw new Error(`状态不是「没让它起」：${blocked.state}`);
  // 口令来源是 `verge` 而不是 `none`：`writeRuntimeConfig` 先 `resolveSecret()` 再合成配置，
  // 合成失败那一步抛出时口令已经定了源。这一行报的是「这一班口令从哪儿来」，不是「配置成了没」。
  expectFacts(blocked, { secretLabel: "secret.verge" }, ["portsLabel", "pidLabel", "controllerLabel", "uptimeLabel"]);
  if (!bar.text.includes("no-profile")) {
    throw new Error(`红字里没带上那句能照着动手的原因（要含 no-profile）：${bar.text}`);
  }

  step("一个字节都不许多写");
  if (fs.existsSync(RUNTIME_DIR)) throw new Error(`配置合成失败却建了 runtime 目录：${RUNTIME_DIR}`);
  const log = assertLogHygiene(report);
  if (countMatches(log, "spawn pid=") !== 0) throw new Error(`配置写不出来还是 spawn 了内核：一颗吃着坏配置的内核会把输入问题演成进程问题`);
  if (!log.includes("runtime 配置写不出来，不起：no-profile")) throw new Error(`日志里没记那句「配置写不出来，不起」：${JSON.stringify(lastLogLine(log, "runtime 配置写不出来"))}`);
  assertVergeDirUntouched(report, report.vergeBefore);
  const ledger = path.join(CONFIG_ROOT, "profiles.yaml");
  if (sha256(ledger) !== report.ledgerBefore) throw new Error(`内核这条腿把订阅账本改了：起内核只准读它`);
}

/** 环境不满足与产品判据不满足是两种红：前者 exit 2，且一个字节都不该写。 */
class EnvError extends Error {}

/* --------------------------------------------------------------------- 主路 */

/** 报告与截图落在仓库 `.tmp/`：开局那句 `rmSync(BASE)` 会把一次性目录整个抹掉，证据不能住在里面。 */
function writeReport(report) {
  fs.mkdirSync(REPORTS, { recursive: true });
  const file = path.join(REPORTS, `core-card-${MODE}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2), "utf8");
  return file;
}

async function main() {
  assertRulerWired();
  assertSandbox();

  // 前闸一：`clash-verge.exe` 的状态。要求按档位分（见 LEGS.needGateOpen）。
  const running = vergeRunning();
  if (LEG.needGateOpen && running) {
    console.error(`[core-card-cdp] ENV: clash-verge.exe 在跑（tasklist 读不出结论也按在跑处理）。`
      + `${MODE} 档量的是闸门开着那几条路，这一趟没开 app、没造目录、一个字节都没写。`);
    process.exitCode = ENV_EXIT;
    return;
  }
  // `external` 与 `gate` 两档不吃这道前闸，各自有理由：external 的控制器地址就写在我们那本一次性账上
  // （可达即接管，排在闸门之前判，隔壁在不在跑都不影响读数）；gate 档要的是「隔壁在跑」，
  // 而那枚映像由探针自己种、自己拆（见 plantVergeImage），拆完还要能确认拆干净——
  // 所以它需要的是**开局时不在跑**，这一点由它自己的等待循环把关。
  if (MODE === "gate" && running) {
    console.error(`[core-card-cdp] ENV: clash-verge.exe 已经在跑，闸门档正对照那半（拆掉同名映像后必须能起）没法做；这一趟没开 app、一个字节都没写。`);
    process.exitCode = ENV_EXIT;
    return;
  }
  // 前闸二：这一档那两个号必须真空着（否则 pickPortPair 退到扫描段，量到的不是产品）。
  const busy = [LEG.mixed, LEG.controller].filter((port) => !portIsFree(port));
  if (busy.length > 0) {
    console.error(`[core-card-cdp] ENV: 端口 ${JSON.stringify(busy)} 已被占用，${MODE} 档要的端口对起不来在这一组上；这一趟没开 app、一个字节都没写。`);
    process.exitCode = ENV_EXIT;
    return;
  }
  if (listeningPids(DEBUG_PORT).length > 0) {
    console.error(`[core-card-cdp] ENV: CDP 端口 ${DEBUG_PORT} 还被占着（上一趟没退干净？）；这一趟没开 app。`);
    process.exitCode = ENV_EXIT;
    return;
  }
  // 前闸三：`update` 档要真下整包（产品的资产那一跳只有 120 秒），出口搬不动就别让产品去撞那把刀。
  if (MODE === "update") {
    try {
      await assertUpdateEgress(report);
    } catch (error) {
      report.ok = false;
      report.envError = true;
      report.error = `ENV: ${error?.message ?? error}`;
      // 落报告：这一趟没开 app，但读数得留下——不然盘上留着的是上一趟的失败现场，会被读成这一趟的。
      const file = writeReport(report);
      console.error(`[core-card-cdp] ${report.error}`);
      console.error(`[core-card-cdp] 这一趟没开 app、没造目录、一个字节都没写；探针读数在 ${file}`);
      process.exitCode = ENV_EXIT;
      return;
    }
  }

  // 开局先扫一遍上一次崩在这里的自己人：判据是命令行里带着一次性目录，与用户那颗不可能重合。
  report.sweepAtStart = sweepOwnCores("start");

  const controllerHost = MODE === "external" ? null : `http://127.0.0.1:${LEG.controller}`;
  if (MODE === "external") {
    try {
      const fake = await startFakeController();
      report.fakeControllerPort = fake.port;
    } catch (error) {
      console.error(`[core-card-cdp] ENV: 假控制器起不来（${error?.message ?? error}）；这一趟没开 app、一个字节都没写。`);
      process.exitCode = ENV_EXIT;
      return;
    }
    writeScratchLedger({
      controllerHost: `http://127.0.0.1:${servers[0].port}`,
      mixedPort: LEG.mixed,
      withCurrent: !LEG.noCurrent,
    });
  } else {
    writeScratchLedger({ controllerHost, mixedPort: LEG.mixed, withCurrent: !LEG.noCurrent });
  }
  if (MODE !== "external" && listeningPids(LEG.controller).length > 0) {
    throw new EnvError(`写完账本之后 ${LEG.controller} 被人占了（外部控制器判据会被它骗过去）；这一趟不算产品判据`);
  }

  const ledgerFile = path.join(CONFIG_ROOT, "profiles.yaml");
  report.ledgerBefore = sha256(ledgerFile);
  report.vergeBefore = snapshotTree(CONFIG_ROOT);
  const realLedger = realLedgerPath();
  report.realLedger = { path: realLedger, shaBefore: realLedger ? sha256(realLedger) : null };

  spawnApp({});
  const page = await openWindow("第一段");
  await navigateToCoreCard(page, report);

  try {
    if (MODE === "start") await legStart(report);
    else if (MODE === "external") await legExternal(report);
    else if (MODE === "gate") await legGate(report);
    else if (MODE === "heal") await legHeal(report);
    else if (MODE === "update") await legUpdate(report);
    else await legNoConfig(report);

    // 每档共用的两条收尾判据：Verge 目录没动、真用户账本没动。
    if (MODE !== "gate") assertVergeDirUntouched(report, report.vergeBefore);
    if (report.realLedger.path) {
      report.realLedger.shaAfter = sha256(report.realLedger.path);
      if (report.realLedger.shaAfter !== report.realLedger.shaBefore) throw new Error(`真用户账本被动了：${report.realLedger.path}`);
    }
    report.ok = true;
  } catch (error) {
    report.ok = false;
    report.error = error instanceof Error ? String(error.message) : JSON.stringify(error);
    // 环境不满足与产品判据不满足是两种红：词表里点名了 EnvError 的那些（没有可借的内核、发布页问不到）
    // 必须走 exit 2，否则「这台机器缺东西」会被读成「产品有 bug」，下一次换台机器就不会再跑这一档。
    if (error instanceof EnvError) {
      report.envError = true;
      report.error = `ENV: ${report.error}`;
    }
    report.screenAtFailure = await readCore().catch(() => null);
    report.coreLogAtFailure = readLog().split(/\r?\n/).slice(-12);
  } finally {
    await shoot(`99-${MODE}-${report.ok ? "pass" : "fail"}.png`);
    await closeApp("收尾");
    // 假控制器是这一趟自己起的监听句柄：不关掉，node 的事件循环就一直有人撑着，
    // 尺子会在**报告已经写成 ok:true 之后**挂在那儿不退（上一趟 --external 就是这样被外面的超时杀的）。
    for (const entry of servers.splice(0)) {
      await new Promise((resolve) => entry.server.close(() => resolve()));
    }
    for (const session of sessions.splice(0)) {
      try { session.ws?.close(); } catch { /* 已经断了 */ }
    }
    report.sweepAtEnd = sweepOwnCores("end");
    // 只记「tasklist 里此刻有没有 clash-verge.exe」这个原始读数：用户自己那款在跑时它也是 true，
    // 名字叫 plantLeftovers 就等于把用户的应用记成我们的残留。
    report.clashVergeImageAtEnd = vergeRunning();
  }

  const file = writeReport(report);
  if (report.ok) {
    console.log(JSON.stringify({ ok: true, mode: MODE, report: file }, null, 2));
    return;
  }
  console.error(`[core-card-cdp] FAIL: ${report.error}`);
  console.error(JSON.stringify(report, null, 2));
  console.error(`[core-card-cdp] 报告与截图：${file}`);
  process.exitCode = report.envError ? ENV_EXIT : 1;
}

/**
 * 优雅退窗：走 `Browser.close`，让主进程那套退场钩子真的跑一遍
 * （内核那条 `verge-core-host` 就排在里面）。等不到退出再强杀——
 * 强杀会让下一段（bundled 档）撞上没释放的单实例锁。
 */
async function closeApp(reason) {
  const entry = children[children.length - 1];
  if (!entry) return;
  try {
    const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
    const browserTarget = await res.json();
    if (browserTarget?.webSocketDebuggerUrl) {
      const browser = new Session(browserTarget.webSocketDebuggerUrl);
      await browser.open();
      await browser.send("Browser.close", {}, 8_000).catch(() => undefined);
      browser.ws.close();
    }
  } catch {
    /* 拿不到 CDP 就直接强杀 */
  }
  const exited = await Promise.race([
    new Promise((resolve) => entry.child.once("exit", () => resolve("exit"))),
    new Promise((resolve) => setTimeout(() => resolve("timeout"), 15_000)),
  ]);
  if (exited !== "exit") {
    try {
      entry.child.kill();
    } catch {
      /* 已经没了 */
    }
    report.closes = report.closes ?? [];
    report.closes.push({ reason, forced: true });
  } else {
    report.closes = report.closes ?? [];
    report.closes.push({ reason, forced: false });
  }
  children.pop();
  currentPage = null;
}

const report = {
  started_at: new Date().toISOString(),
  mode: MODE,
  sandbox: { configRoot: CONFIG_ROOT, profile: PROFILE, debugPort: DEBUG_PORT },
  ports: { mixed: LEG.mixed, controller: LEG.controller },
  needGateOpen: LEG.needGateOpen,
};

main().catch((error) => {
  const isEnv = error instanceof EnvError;
  console.error(`[core-card-cdp] ${isEnv ? "ENV" : "FAIL"}: ${error?.message ?? error}`);
  process.exitCode = isEnv ? ENV_EXIT : 1;
});
