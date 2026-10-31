// Wave 2 的真窗写面档：在一次性目录里开「订阅」页点一次「切换」，同一个前闸下跑三档。
//
// 用法：node scripts/verify/subscriptions-write-cdp.mjs             ← 拒写档（默认，闸门当拒）
//       node scripts/verify/subscriptions-write-cdp.mjs --switch    ← 正向档（闸门开着，真切换）
//       node scripts/verify/subscriptions-write-cdp.mjs --failover  ← 失败档（控制面死的，切换写不成）
//
// 拒写档认两件事：屏上是那句「Clash Verge 正在运行」，盘上一个字节都不动。
// 正向档认另外两件：切换真走通了（账本 current 搬家、runtime 落盘、PUT /configs 敲的是
// 我们自己的控制面），而且该留的东西都留着（`.bak-mochi-*` 里就是切换前那一本账，没有 `.tmp` 残渣）。
// 失败档认的是**反过来的那半条 D5**：内核没吃下这份配置，账本的 `current` 就不许搬家——
// 屏上给红条，`profiles.yaml` 一个字节不动，因而**连备份都不该造出来**。
// 三档是同一把尺的三头：只有拒写档绿，可能拦的是一切写；只有正向档绿，没人证明过它该拦时拦得住；
// 只有「成功」这一头绿，「失败要敢不改账」那条顺序就只是读代码读出来的信念。
// 失败档同时是正向档第 1 条判据的变异验牙：那条「账本 sha 必须变」在这一档里被反过来要求「不许变」，
// 同一份 sha 比对两边都跑得出结论，才不是一句只会绿的废话。
//
// 为什么这一档非要自己造一份账本，而不像 network-tabs-cdp.mjs 那样直接读真数据：
// 点击「切换」是一次**写**尝试。真账本上点错一下就是改用户正在用的订阅，
// 而「闸门会不会真的拦住」正是这档要证的东西——不能拿要证的结论当安全前提。
// 所以：APPDATA 指到一次性目录，账本、正文、控制面文件全是我自己造的；
// 真用户账本只读它的 sha256，用来证明这一趟压根没碰过它。
//
// 三道前闸（都在点击之前）：
// 1) 页面上必须出现只有这份一次性账本才有的主机名，且行数＝3。对不上＝APPDATA
//    没被吃进去、app 读的是真目录，当场红，绝不点。
// 2) 拒写档：点完之后 profiles.yaml 与 profiles/ 的 sha256 必须逐一对齐，runtime 目录必须还没长出来。
//    正向档：反过来——current 必须搬家、runtime 必须长出来，且正文一份不许动。
//    失败档：current 不许搬家、备份不许造出来，且 runtime（若写出）的控制面三颗键仍是注入的那一份。
// 3) 三档对 `clash-verge.exe` 的状态要求**正好相反**：切换两档要它不在跑（在跑时主进程拒写，那一趟量的就不是切换）；
//    拒写档要它在跑（不在跑时闸门是通的，写会一路走到 PUT /configs，只因那个控制面是死的才失败——
//    这时盘上「没动」是假绿，2026-10-31 实测）。对不上就 exit 2 早退、一个字节不写；
//    tasklist 读不出结论按「在跑」处理（fail closed），与主进程同一个口径。
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
const BASE = "D:\\cyrene-sub-accept";
const APPDATA = path.join(BASE, "appdata");
const PROFILE = path.join(BASE, "profile");
/**
 * 截图落在仓库 `.tmp/` 里，**不在一次性目录内**。
 * `writeScratchLedger` 开头就 `rmSync(BASE)`：上一版把 shots 放在 BASE 下面，
 * 于是跑完失败档再跑切换档，失败档那两张现场被抹掉了（同一个坑本档已经踩过一次——
 * 探针自己的 stdout 重定向也不能写进 BASE）。三档的证据要能同时在盘上，才谈得上对质。
 */
const SHOTS = path.join(ROOT, ".tmp", "shots", "subscriptions-write");
const VERGE_DIR_NAME = "io.github.clash-verge-rev.clash-verge-rev";
const CONFIG_ROOT = path.join(APPDATA, VERGE_DIR_NAME);
const DEBUG_PORT = 9336;
const PAGE_WAIT_MS = 30_000;

/** 三档共用开窗、换语言与页面前闸，只在「点下去之后认什么」上分岔。 */
const MODE = process.argv.includes("--switch") ? "switch" : process.argv.includes("--failover") ? "failover" : "refuse";
/** 环境不满足（隔壁在跑 / tasklist 读不出结论）：一个字节不写就退，exit 2 与 client-update-cdp.mjs 同口径。 */
const ENV_EXIT = 2;
const SCRATCH_SECRET = "scratch-secret";
const SCRATCH_MIXED_PORT = 59098;
/** 拒写档与失败档的控制面：指到一个没人听的端口。前者万一是「闸门没拦住」，后者是**故意**要它没拦住的那一步失败。 */
const DEAD_PORT = 59099;
const DEAD_CONTROLLER = `http://127.0.0.1:${DEAD_PORT}`;
/** 订阅正文自己带来的控制面与口令：正向档要证明它们被注入顶掉了（spec D5 的数据面主权）。 */
const FOREIGN_CONTROLLER = "127.0.0.1:59097";
const FOREIGN_SECRET = "subscription-wins";
const FOREIGN_MIXED_PORT = 59096;
/** 正向档点的那一行：一次性账本里从 Sub00000002 切到它。 */
const TARGET_UID = "Sub00000001";
/**
 * 那一行在页面上的位置：账本里 Merge 排在最前，所以行序是 Merge(0) / Scratch A(1) / Scratch B(2)。
 * 这个 1 是 2026-10-31 实测的——上一版按「Scratch A 是第一条订阅」写成 0，
 * 于是真切换成功了（PUT /configs 到了、屏上也画了「Scratch A 当前」）却被读成一条红。
 * 行名那道对照留着：位置再漂一次，红字会直接说出漂到哪儿去了。
 */
const TARGET_ROW_INDEX = 1;

/**
 * 语言文件里的模板拆成「占位符前/后」两段字面量。
 *
 * 不在探针里重打一遍文案：重打会漂——改了文案探针还是绿，等于没有尺。
 * 三档都从这里取：拒写档要闸门那句原文，失败档要「失败」那条与「不许出现的成功回执」。
 */
function subTemplate(key) {
  return ["zh-CN", "en", "ja-JP"].map((locale) => {
    const file = path.join(ROOT, "src", "renderer", "react", "i18n", `${locale}.json`);
    const raw = JSON.parse(fs.readFileSync(file, "utf8"))?.network?.sub?.[key];
    if (typeof raw !== "string" || !raw.trim()) throw new Error(`${locale}.json 里没有 network.sub.${key}`);
    const cut = raw.split(/\{\{[^}]*\}\}/);
    return {
      locale,
      full: raw.trim().replace(/\s+/g, " "),
      prefix: cut[0].trim(),
      suffix: (cut[1] ?? "").trim(),
    };
  });
}

/** 闸门那句话的原文（无占位符，整条对齐）。 */
function gatedCopies() {
  return subTemplate("gated").map((tpl) => tpl.full);
}

/** 一条屏上提示是不是这个模板（占位符两头夹住，中间的变量名不猜）。 */
function noticeMatches(text, tpl) {
  return typeof text === "string" && text.startsWith(tpl.prefix) && (tpl.suffix === "" || text.endsWith(tpl.suffix));
}

function firstNoticeByTemplate(list, templates) {
  for (const text of list ?? []) {
    const tpl = templates.find((candidate) => noticeMatches(text, candidate));
    if (tpl) return { text, tpl };
  }
  return null;
}

/** 只有这份一次性账本里会出现的主机名：页面上看见它，才确认读的不是真目录。 */
const SCRATCH_HOST = "scratch.example.test";

/** 真用户账本（只读 sha，用来证明没被碰）。找不到就记 null，不算失败。 */
function realLedgerPath() {
  const base = process.env.APPDATA;
  if (!base) return null;
  for (const name of [VERGE_DIR_NAME, "clash-verge-rev", "clash-verge"]) {
    const candidate = path.join(base, name, "profiles.yaml");
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function snapshot(dir) {
  if (!fs.existsSync(dir)) return null;
  const out = {};
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (!entry.isFile()) continue;
    out[entry.name] = sha256(path.join(dir, entry.name));
  }
  return out;
}

let stepNo = 0;
function step(label) {
  console.log(`[subscriptions-write-cdp] → ${++stepNo} ${label}`);
}

/**
 * 本机有没有在跑隔壁那款。口径跟主进程的闸门保持一致：读不出结论＝当作在跑（fail closed）。
 *
 * 只有正向档用得上。闸门拦下时盘上什么都不动，那时长出来的是「current 没搬家」这条红，
 * 会被读成「切换有 bug」——环境不满足要早退，不能混进产品判据里。
 */
function vergeRunning() {
  try {
    const out = execFileSync("tasklist", ["/FO", "CSV", "/NH"], { encoding: "utf8", timeout: 8_000 });
    return /"clash-verge\.exe"/i.test(out);
  } catch {
    return true;
  }
}

/**
 * 一次性控制面：替真内核接 `PUT /configs`，只回 204 并把收到的请求原样记下。
 *
 * 正向档要证的不是 mihomo 会不会重载配置（那是 Wave 3 内核档的事），是主进程这条写路的
 * **顺序与产物**：runtime 先落盘 → 拿落盘那个路径去敲控制面 → 才动账本的 current。
 * 有了这份请求账，「敲的是谁、口令对不对、body.path 是不是刚写的那份」都能当场对质。
 * 端口填 0＝让系统挑：写死端口被占时失败的原因是「这台机器忙」，不是产品。
 */
function startScratchCore() {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      requests.push({
        method: req.method,
        url: req.url,
        auth: String(req.headers.authorization ?? ""),
        body: Buffer.concat(chunks).toString("utf8"),
      });
      const authed = String(req.headers.authorization ?? "") === `Bearer ${SCRATCH_SECRET}`;
      res.writeHead(authed ? 204 : 401, { "Content-Type": "application/json" });
      res.end(authed ? "" : JSON.stringify({ message: "scratch core: unauthorized" }));
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, port: address.port, requests });
    });
  });
}

/** 目录树里所有 `*.tmp`：原子写是 tmp→rename，留下残渣＝改名没走完（或者压根不该有）。 */
function findTempResidue(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findTempResidue(full));
    else if (entry.name.endsWith(".tmp")) out.push(full);
  }
  return out;
}

/** `file` 这一份账的备份名（`<file>.bak-mochi-YYYYMMDD-HHmmss[-N]`）。 */
function backupsOf(dir, file) {
  if (!fs.existsSync(dir)) return [];
  const prefix = `${file}.bak-mochi-`;
  return fs.readdirSync(dir).filter((name) => name.startsWith(prefix)).sort();
}

/** 请求台账的一行：口令只说「带没带」，不把值原样印进日志（口令进日志就是泄露）。 */
function describeRequest(item) {
  return `${item.method} ${item.url} · auth=${item.auth ? "Bearer(有)" : "无"} · ${item.body.slice(0, 200)}`;
}

/**
 * runtime 的控制面主权（spec D5）：三颗键必须是被注入的那一份，订阅正文自带的那一份**一个都不许留下**。
 *
 * 逐颗对之外还要整篇扫一遍：注入是「链尾覆写」，正文里那三行如果没被顶掉而是被**追加**在别处
 * （比如 merge 链把整段塞进某个子键底下），只比顶层键名的判据会照样绿。
 * 失败档（控制面是死的）也走这一条：那份 runtime 即便写出来了，主权也不能丢。
 */
function checkRuntimeSovereignty({ runtimeFile, controllerHost, report }) {
  const text = fs.readFileSync(runtimeFile, "utf8");
  const runtime = parseYaml(text);
  report.runtime = {
    file: runtimeFile,
    externalController: runtime?.["external-controller"],
    secret: runtime?.secret,
    mixedPort: runtime?.["mixed-port"],
  };
  if (runtime?.["external-controller"] !== controllerHost) {
    throw new Error(`runtime 的 external-controller 不是注入的那一份（要 ${controllerHost}，且协议前缀该剥掉）：${JSON.stringify(runtime?.["external-controller"])}`);
  }
  if (runtime?.secret !== SCRATCH_SECRET) {
    throw new Error(`runtime 的 secret 不是我们那一份：${JSON.stringify(runtime?.secret)}——注入没压过订阅正文（spec D5）`);
  }
  if (runtime?.["mixed-port"] !== SCRATCH_MIXED_PORT) {
    throw new Error(`runtime 的 mixed-port 是 ${JSON.stringify(runtime?.["mixed-port"])}，要 ${SCRATCH_MIXED_PORT}（订阅自带 ${FOREIGN_MIXED_PORT}）`);
  }
  const leftovers = [FOREIGN_CONTROLLER, FOREIGN_SECRET, String(FOREIGN_MIXED_PORT)].filter((token) => text.includes(token));
  if (leftovers.length > 0) {
    throw new Error(`runtime 里还留着订阅正文自带的控制面字样（${JSON.stringify(leftovers)}）：换一个订阅就把数据面主权交回它自己`);
  }
  return runtime;
}

/**
 * 正向档的盘上判据：切换真走通了，而且每一步的产物都对得上。
 *
 * 六条腿各自回答一个问题，少一条就有一段是「猜的」：
 * 1) 账本 `current` 搬家，且除 current 之外一个字段不许掉（`x-note` 与 items 顺序都在射程里）；
 * 2) 切换前那一本账留在了 `.bak-mochi-*` 里——sha 对得上动手前的快照，只该有这一份；
 * 3) runtime 落在**我们自己的 userData**里，不在 Verge 目录里（spec D2 的边界），且带上了订阅正文与内置 Merge；
 * 4) runtime 的控制面三颗键全是被注入的那一份，订阅正文自带的 `external-controller`/`secret`/`mixed-port` 被顶掉，
 *    而且整篇扫一遍都不该再出现那三个字样（spec D5 的数据面主权——只验「能切换」验不出这条，所以要在产物里逐颗对；
 *    见 checkRuntimeSovereignty）；
 * 5) 一次性控制面正好收到一次 `PUT /configs`，带的是我们的口令，指的就是刚写出去的那个文件；
 * 6) 没有 `.tmp` 残渣，两份正文的 sha 没动，真用户账本的 sha 没动。
 */
function assertSwitched({ ledgerFile, profilesDir, runtimeDir, realLedger, before, core, report }) {
  const afterLedger = sha256(ledgerFile);
  report.switch = { ledgerBefore: before.ledger, ledgerAfter: afterLedger };
  if (afterLedger === before.ledger) {
    throw new Error(`profiles.yaml 一个字节没动，可页面上「当前」搬家了：屏幕读的是回执，账本才是真相`);
  }

  const doc = parseYaml(fs.readFileSync(ledgerFile, "utf8"));
  if (doc?.current !== TARGET_UID) throw new Error(`账本 current＝${JSON.stringify(doc?.current)}，要的是 ${TARGET_UID}`);
  if ((doc?.items ?? []).find((item) => item.uid === TARGET_UID)?.["x-note"] !== "keep-me") {
    throw new Error(`账本里不认识的字段被弄丢了（x-note）：${JSON.stringify(doc?.items?.find((item) => item.uid === TARGET_UID))}`);
  }

  const backups = backupsOf(CONFIG_ROOT, "profiles.yaml");
  if (backups.length !== 1) throw new Error(`profiles.yaml 该正好留 1 份 .bak-mochi-*，实际 ${backups.length} 份：${JSON.stringify(backups)}`);
  const backupFile = path.join(CONFIG_ROOT, backups[0]);
  const backupSha = sha256(backupFile);
  report.backup = { name: backups[0], sha256: backupSha };
  if (backupSha !== before.ledger) {
    throw new Error(`备份${backups[0]} 的 sha=${backupSha} 跟动手前的账本 sha=${before.ledger} 对不上：备份里存的不是切换前那一本`);
  }
  const beforeDoc = parseYaml(fs.readFileSync(backupFile, "utf8"));
  if (JSON.stringify(beforeDoc?.items) !== JSON.stringify(doc?.items)) {
    throw new Error("切换只该动 current，items 却被重排或改写了");
  }

  const runtimeFile = path.join(runtimeDir, `${TARGET_UID}.yaml`);
  if (!fs.existsSync(runtimeFile)) throw new Error(`runtime 没长出来：${runtimeFile}`);
  const runtime = checkRuntimeSovereignty({
    runtimeFile,
    controllerHost: `127.0.0.1:${core.port}`,
    report,
  });
  if (runtime?.proxies?.[0]?.name !== "scratch-a") {
    throw new Error(`runtime 里没带上 ${TARGET_UID} 的正文：${JSON.stringify(runtime?.proxies?.[0])}`);
  }
  if (runtime?.dns?.enable !== true) {
    throw new Error(`内置 Merge 没进链（dns.enable 不是 true）：${JSON.stringify(runtime?.dns)}`);
  }

  const puts = core.requests.filter((item) => item.method === "PUT" && item.url === "/configs");
  report.coreRequests = core.requests.map(describeRequest);
  if (puts.length !== 1) {
    throw new Error(`一次性控制面收到 ${puts.length} 次 PUT /configs（要正好 1 次）；全部请求：${JSON.stringify(report.coreRequests)}`);
  }
  if (puts[0].auth !== `Bearer ${SCRATCH_SECRET}`) throw new Error(`PUT /configs 的口令不对：${JSON.stringify(puts[0].auth)}`);
  let reloaded = null;
  try {
    reloaded = JSON.parse(puts[0].body || "{}")?.path;
  } catch {
    throw new Error(`PUT /configs 的请求体不是 JSON：${JSON.stringify(puts[0].body)}`);
  }
  if (typeof reloaded !== "string" || path.resolve(reloaded) !== path.resolve(runtimeFile)) {
    throw new Error(`PUT /configs 指的文件不是刚写出去的那份 runtime：${JSON.stringify(reloaded)} vs ${runtimeFile}`);
  }

  const residue = [...findTempResidue(CONFIG_ROOT), ...findTempResidue(runtimeDir)];
  if (residue.length > 0) throw new Error(`原子写留下 .tmp 残渣：${JSON.stringify(residue)}`);

  const afterProfiles = snapshot(profilesDir);
  report.after = { ledger: afterLedger, profiles: afterProfiles, realLedger: realLedger ? sha256(realLedger) : null };
  if (JSON.stringify(afterProfiles) !== JSON.stringify(before.profiles)) throw new Error("profiles/ 里的正文被改了：切换不该重抄订阅正文");
  if (before.realLedger !== null && report.after.realLedger !== before.realLedger) throw new Error(`真用户账本被动了：${realLedger}`);
}

/**
 * 失败档的盘上判据：内核没吃下这份配置，账本就不许改口（spec D5 后半条，真窗版）。
 *
 * 这一档同时是正向档第 1 条判据的变异验牙——同一次 sha 比对在这儿**反过来**要求「不许变」。
 * 两边都跑出结论（正向绿＝它认得成功，失败绿＝它也认得失败），那条 sha 断言才不是一句只会绿的废话。
 *
 * 五条腿：
 * 1) 屏上有红条，而且必须是「切换失败」那一条：出现闸门那句话＝隔壁中途启动了，环境变了不是产品变了；
 * 2) 页面上的「当前」没搬家，也不许冒出「已切到」那条成功回执（失败时抢跑就是骗屏）；
 * 3) `profiles.yaml` 一个字节不动，因而**连一条 `.bak-mochi-*` 都不该造出来**（备份是重写账本的副产品）；
 * 4) 写出去的 runtime（若已落盘）主权仍在：注入的三颗键在、订阅正文那三颗字样整篇扫不出来；
 * 5) 正文没被重抄、没有 `.tmp` 残渣、真用户账本没动。
 */
function assertFailedOver({ ledgerFile, profilesDir, runtimeDir, realLedger, before, view, settled, report }) {
  const afterLedger = sha256(ledgerFile);
  report.failover = { ledgerBefore: before.ledger, ledgerAfter: afterLedger, errors: settled.errors };

  const failedTemplates = subTemplate("failed");
  const failure = firstNoticeByTemplate(settled.errors, failedTemplates);
  if (!failure) {
    throw new Error(`失败档没等到「切换失败」那条红条；屏上错误=${JSON.stringify(settled.errors)}（要匹配 ${JSON.stringify(failedTemplates.map((t) => t.prefix))}）`);
  }
  const gateTexts = gatedCopies();
  if (settled.errors.some((text) => gateTexts.includes(text))) {
    throw new Error(`这一趟冒出的是闸门那句话（${JSON.stringify(settled.errors)}）：跑中途 Clash Verge 启动了，`
      + "环境变了不是产品变了——这一档要闸门开着，重跑前请先退掉隔壁");
  }
  report.failureReason = failure.text;

  const success = firstNoticeByTemplate(settled.notices, subTemplate("selected"));
  if (success) throw new Error(`切换失败了却同时给出成功回执：${JSON.stringify(success.text)}`);
  if (settled.currentIndex !== view.currentIndex) {
    throw new Error(`红条说了失败，页面上的「当前」却搬家了：${view.currentIndex} → ${settled.currentIndex}（${JSON.stringify(settled.rowNames)}）`);
  }

  if (afterLedger === before.ledger) {
    const doc = parseYaml(fs.readFileSync(ledgerFile, "utf8"));
    if (doc?.current !== "Sub00000002") throw new Error(`账本 sha 没动但 current 读出来不是 Sub00000002：${JSON.stringify(doc?.current)}`);
  } else {
    throw new Error(`内核没吃下这份配置，账本却被人改了（sha ${before.ledger} → ${afterLedger}）：`
      + "顺序必须是 runtime 落盘 → PUT 成功 → 才写 current。正向档那条「sha 必须变」的牙也在这儿的镜像里");
  }

  const backups = backupsOf(CONFIG_ROOT, "profiles.yaml");
  if (backups.length !== 0) throw new Error(`账本没改口却造出了备份（${JSON.stringify(backups)}）：备份是重写 profiles.yaml 的副产品`);

  const runtimeFile = path.join(runtimeDir, `${TARGET_UID}.yaml`);
  report.runtimeWritten = fs.existsSync(runtimeFile);
  if (report.runtimeWritten) {
    checkRuntimeSovereignty({ runtimeFile, controllerHost: `127.0.0.1:${DEAD_PORT}`, report });
  } else {
    throw new Error(`runtime 压根没落盘（${runtimeFile}）：这一趟失败发生在写文件之前，`
      + "量的就不是「失败不改账」这条顺序了。若是产品改成了先探内核再落盘，这条判据要跟着重议");
  }

  const residue = [...findTempResidue(CONFIG_ROOT), ...findTempResidue(runtimeDir)];
  if (residue.length > 0) throw new Error(`原子写留下 .tmp 残渣：${JSON.stringify(residue)}`);

  const afterProfiles = snapshot(profilesDir);
  report.after = { ledger: afterLedger, profiles: afterProfiles, realLedger: realLedger ? sha256(realLedger) : null };
  if (JSON.stringify(afterProfiles) !== JSON.stringify(before.profiles)) throw new Error("profiles/ 里的正文被改了：切换失败也不该重抄订阅正文");
  if (before.realLedger !== null && report.after.realLedger !== before.realLedger) throw new Error(`真用户账本被动了：${realLedger}`);
}

function assertSandbox() {
  const normalized = path.resolve(BASE).toLowerCase();
  if (!normalized.startsWith("d:\\cyrene-sub-accept")) throw new Error(`一次性目录必须落在 D:\\cyrene-sub-accept 下，收到 ${BASE}`);
  const real = String(process.env.APPDATA ?? "").toLowerCase();
  if (!real) throw new Error("会话里没有 APPDATA，无法确认一次性目录跟真目录不是同一个地方");
  if (path.resolve(APPDATA).toLowerCase() === real) throw new Error("APPDATA 覆盖后与真 APPDATA 相同，拒绝开写");
  if (normalized.startsWith(real)) throw new Error(`一次性目录落在真 APPDATA 里面（${real}），拒绝开写`);
}

/** 造一份最小但形状正确的 Verge 目录：账本 + 正文 + 控制面文件，全在一次性目录里。 */
function writeScratchLedger(controllerAddress) {
  fs.rmSync(BASE, { recursive: true, force: true });
  fs.mkdirSync(path.join(CONFIG_ROOT, "profiles"), { recursive: true });
  fs.mkdirSync(PROFILE, { recursive: true });
  fs.mkdirSync(SHOTS, { recursive: true });

  // 正文里故意带一份自己的控制面：切换产物上这三颗键必须被注入顶掉，
  // 留着就等于换一个订阅把数据面主权交回订阅自己（spec D5）。
  const body = (name) => [
    "proxies:",
    `- name: ${name}`,
    "  type: ss",
    "  server: 127.0.0.1",
    "  port: 8321",
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
      "current: Sub00000002",
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
      "    x-note: keep-me",
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
  // 拒写档给一个没人听的端口（万一闸门没拦住，这一次写也够不着用户那个真内核）；
  // 正向档给探针自己起的那一颗（PUT 走不通就不许动账本，这是被验的顺序本身）。
  fs.writeFileSync(
    path.join(CONFIG_ROOT, "clash-verge.yaml"),
    `external-controller: ${controllerAddress}\nsecret: ${SCRATCH_SECRET}\nmixed-port: ${SCRATCH_MIXED_PORT}\n`,
    "utf8",
  );
}

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
  // reject 带的必须是**字符串**：抛普通对象时 CDP 只把 className 带回来（一路读到的都是 "Object"），
  // 红字里那些「屏上现在到底是什么」正好全丢——2026-10-31 实测。
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
    // 抛出去的值有三种形状：Error（有 description）、普通对象（只有 className，读回来是 "Object"）、
    // 原始字符串/数字（只有 value）。三种都要保住原文，否则红字就成了一句没信息的 "Object"。
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
  return session;
}

/**
 * 截图名自带档位前缀。
 * 三档共用那个一次性目录，而 `writeScratchLedger` 开头就是 `rmSync(BASE)`：
 * 不带档位的话，跑完失败档再跑正向档，前一张现场（含三档共用的 `01-subscriptions-before.png`）就没了
 * ——2026-10-31 那趟 `02-subscriptions-failover.png` 正是这样被下一次切换档抹掉的。
 * 两条腿的证据要能同时在盘上，才谈得上对质。
 */
async function shoot(session, name) {
  const { data } = await session.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(SHOTS, `${MODE}-${name}`), Buffer.from(data, "base64"));
}

async function click(session, selector) {
  return evaluate(
    session,
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`,
  );
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
 * 订阅页现在长什么样：行、当前标记、红条、有没有那个只属于一次性账本的主机名。
 * 这是一段**要在页面里求值的表达式**，不是探针本地的函数——
 * 上一版把它写成函数再 `${readView}()` 拼进去，页面拿到的是函数源码，
 * 于是一路 `undefined` 当「读完了」，前闸正好把它拦住（没点下去，一个字节没写）。
 */
const READ_VIEW = `(() => {
  const view = document.querySelector("section.net-prof");
  if (!view) return null;
  const rows = [...view.querySelectorAll(".net-prof-row")];
  return {
    loading: !!view.querySelector(".net-loading"),
    rows: rows.length,
    currentIndex: rows.findIndex((el) => el.classList.contains("is-current")),
    rowNames: rows.map((el) => (el.querySelector(".net-prof-row__name")?.innerText || "").trim().replace(/\\s+/g, " ")),
    hosts: [...view.querySelectorAll(".net-prof-row__meta")].map((el) => (el.innerText || "").trim().replace(/\\s+/g, " ")),
    notices: [...view.querySelectorAll(".net-notice")].map((el) => (el.innerText || "").trim().replace(/\\s+/g, " ")),
    errors: [...view.querySelectorAll(".net-notice--error")].map((el) => (el.innerText || "").trim().replace(/\\s+/g, " ")),
    count: (view.querySelector(".net-card__count")?.innerText || "").trim(),
  };
})()`;

async function main() {
  assertSandbox();

  // 三档对隔壁那款的状态要求**正好相反**，而且这条不是锦上添花——2026-10-31 实测出来的：
  // Verge 不在跑时闸门是通的，拒写档照样点下去、照样写出 runtime/Sub00000001.yaml，
  // 只是因为一次性账本的控制面指到一个没人听的端口，PUT /configs 才失败在「写 runtime 之后、
  // 动账本之前」。那时 profiles.yaml 的 sha 没动，但拦住它的不是闸门——照原样读就是假绿。
  const writesAttempted = MODE === "switch" || MODE === "failover";
  const running = vergeRunning();
  if (writesAttempted && running) {
    console.error(`[subscriptions-write-cdp] ENV: 检测到 clash-verge.exe 在跑（tasklist 读不出结论也按在跑处理）。`
      + `${MODE} 档量的是闸门开着那条路，这一趟没开 app、没造目录、一个字节都没写。`);
    process.exitCode = ENV_EXIT;
    return;
  }
  if (MODE === "refuse" && !running) {
    console.error("[subscriptions-write-cdp] ENV: clash-verge.exe 不在跑，单写者闸门是通的——拒写档这一刻量不到闸门。"
      + "（实测它会一路写到 runtime/<uid>.yaml，然后失败在 PUT /configs：那个控制面是死的。那条路现在有专门的 --failover 档在量。）"
      + "要看闸门，请先把 Clash Verge 开着再跑这一档。这一趟没开 app、一个字节都没写。");
    process.exitCode = ENV_EXIT;
    return;
  }

  // 正向档要先有活的控制面可敲；拒写档与失败档不需要——它们那一份指到死端口才是想要的形状。
  let core = null;
  if (MODE === "switch") {
    try {
      core = await startScratchCore();
    } catch (error) {
      console.error(`[subscriptions-write-cdp] ENV: 一次性控制面起不来（${error?.message ?? error}）；这一趟没开 app、一个字节都没写。`);
      process.exitCode = ENV_EXIT;
      return;
    }
  }
  const controllerAddress = core ? `http://127.0.0.1:${core.port}` : DEAD_CONTROLLER;
  writeScratchLedger(controllerAddress);

  const ledgerFile = path.join(CONFIG_ROOT, "profiles.yaml");
  const profilesDir = path.join(CONFIG_ROOT, "profiles");
  const runtimeDir = path.join(PROFILE, "runtime");
  const realLedger = realLedgerPath();
  const before = { ledger: sha256(ledgerFile), profiles: snapshot(profilesDir), realLedger: realLedger ? sha256(realLedger) : null };

  const electronBin = createRequire(import.meta.url)("electron");
  // 会话环境里可能带着 ELECTRON_RUN_AS_NODE=1：那样 electron 会把自己当 node 跑。
  const env = { ...process.env, APPDATA };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electronBin, [".", `--user-data-dir=${PROFILE}`, `--remote-debugging-port=${DEBUG_PORT}`], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const appLog = [];
  child.stdout.on("data", (b) => appLog.push(String(b)));
  child.stderr.on("data", (b) => appLog.push(String(b)));

  const report = {
    started_at: new Date().toISOString(),
    mode: MODE,
    sandbox: { configRoot: CONFIG_ROOT, profile: PROFILE, realLedger },
    controller: controllerAddress,
    before,
  };
  try {
    step("等欢迎闸门 target");
    const gateTarget = await findTarget((url) => url.includes("onboarding=1"), 150_000);
    if (!gateTarget) throw new Error(`没等到欢迎闸门；app 输出：\n${appLog.join("").slice(-2000)}`);
    const gate = await attach(gateTarget);
    await evaluate(gate, waitExpression(`() => () => document.querySelector(".cy-onboarding__button--primary") ? true : null`, PAGE_WAIT_MS), { awaitPromise: true });
    if (!(await click(gate, ".cy-onboarding__button--primary"))) throw new Error("欢迎页没有主按钮");
    await evaluate(gate, waitExpression(`() => () => document.querySelector(".cy-onboarding__actions .cy-onboarding__button--primary") ? true : null`, PAGE_WAIT_MS), { awaitPromise: true });
    await clickThatNavigates(gate, ".cy-onboarding__actions .cy-onboarding__button--primary");

    step("等主窗 target 并进「网络」");
    const chatTarget = await findTarget((url) => url.includes("/react/index.html") && !url.includes("onboarding=1"), 120_000);
    if (!chatTarget) throw new Error(`点完同意没等到主窗 target；app 输出：\n${appLog.join("").slice(-2000)}`);
    const page = await attach(chatTarget);
    await evaluate(page, waitExpression(`() => () => !document.documentElement.hasAttribute("data-ui-theme-pending") ? true : null`, PAGE_WAIT_MS), { awaitPromise: true });
    await evaluate(
      page,
      waitExpression(
        `() => () => {
          const hit = [...document.querySelectorAll("button.cy-side-action")]
            .find((el) => ["网络", "Network", "ネットワーク"].includes((el.getAttribute("title") || "").trim()));
          if (!hit) return null;
          hit.click();
          return true;
        }`,
        PAGE_WAIT_MS,
      ),
      { awaitPromise: true },
    );

    step("点开「订阅」页签");
    await evaluate(
      page,
      waitExpression(
        `() => () => {
          const hit = [...document.querySelectorAll(".net-tabs [role='tab']")]
            .find((el) => ["订阅", "Subscriptions", "購読"].includes((el.textContent || "").trim()));
          if (!hit) return null;
          hit.click();
          return true;
        }`,
        PAGE_WAIT_MS,
      ),
      { awaitPromise: true },
    );

    step("等账本读完");
    // 「读完」＝不转圈了，并且要么有行、要么有失败条。
    // 只等「不转圈」会在首帧 rows=0 就放行，把「还没读到」读成「读到 0 行」。
    const view = await evaluate(page, waitExpression(`() => () => {
      const v = ${READ_VIEW};
      return v && !v.loading && (v.rows > 0 || v.errors.length > 0) ? v : null;
    }`, PAGE_WAIT_MS), { awaitPromise: true });
    report.view = view;
    await shoot(page, "01-subscriptions-before.png");

    // 前闸一：读到的必须是这份一次性账本，不是用户的真账本。
    if (view.rows !== 3) {
      throw new Error(`一次性账本该有 3 行，页面上是 ${view.rows} 行：${JSON.stringify(view.rowNames)}；失败条 ${JSON.stringify(view.errors)}`);
    }
    if (!view.hosts.some((text) => text.includes(SCRATCH_HOST))) {
      throw new Error(`页面里没有 ${SCRATCH_HOST}，说明读的不是 ${CONFIG_ROOT}：${JSON.stringify(view.hosts)}`);
    }
    if (view.currentIndex !== 2) throw new Error(`「当前」标记没落在第三行（index=${view.currentIndex}）：${JSON.stringify(view.rowNames)}`);
    if (!view.rowNames[view.currentIndex]?.includes("Scratch B")) {
      throw new Error(`页面上的「当前」不是账本里那个 Sub00000002：${JSON.stringify(view.rowNames)}`);
    }
    if (view.errors.length > 0) throw new Error(`进场就带着红条：${view.errors.join("；")}`);

    step(MODE === "switch"
      ? "点非当前那一行的「切换」（正向档：要它真写）"
      : MODE === "failover"
        ? "点非当前那一行的「切换」（失败档：控制面是死的，要它写不成账）"
        : "点非当前那一行的「切换」（拒写档：要它写不成）");
    // 认按钮只认文案：那一行的 ops 里有切换/更新/删除三颗，点错一颗就是另一种写。
    const clicked = await evaluate(page, `(() => {
      const want = ["切换", "Use", "切り替え"];
      const rows = [...document.querySelectorAll("section.net-prof .net-prof-row")];
      const row = rows.find((el) => (el.querySelector(".net-prof-row__name")?.innerText || "").trim().startsWith("Scratch A"));
      if (!row) return { ok: false, reason: "没有 Scratch A 那一行" };
      if (row.classList.contains("is-current")) return { ok: false, reason: "Scratch A 已经是当前项，点了不算切换" };
      const button = [...row.querySelectorAll(".net-prof-row__ops button")]
        .find((el) => !el.disabled && want.includes((el.innerText || "").trim()));
      if (!button) return { ok: false, reason: "那一行没有可点的切换按钮" };
      const label = (button.innerText || "").trim();
      button.click();
      return { ok: true, label, rowName: (row.querySelector(".net-prof-row__name")?.innerText || "").trim().replace(/\\s+/g, " ") };
    })()`);
    if (!clicked?.ok) throw new Error(`点不到「切换」：${clicked?.reason}`);
    report.click = clicked;

    if (MODE === "switch") {
      step("等「当前」搬到 Scratch A 那一行");
      // 主进程的成功回执直接把 rows 换掉，所以页面上的「当前」就是账本的样子。
      // 既没搬家也没红条＝请求悬在半路（或压根没发出去）：不在这儿放过，让 30s 超时读成红。
      const switchWait = waitExpression(`() => () => {
        const v = ${READ_VIEW};
        if (!v || v.loading) return null;
        return v.currentIndex === ${TARGET_ROW_INDEX} || v.errors.length > 0 ? v : null;
      }`, PAGE_WAIT_MS);
      let switched;
      try {
        switched = await evaluate(page, switchWait, { awaitPromise: true });
      } catch (error) {
        // 超时的这一趟要把现场全留下：页面此刻的样子 + 一次性控制面收到过什么。
        // 少了这两样，「没搬家」只能靠猜——到底是请求没发出、卡在 PUT、还是回执没刷到屏上。
        report.viewAtFailure = await evaluate(page, READ_VIEW).catch(() => null);
        report.coreRequests = core.requests.map(describeRequest);
        await shoot(page, "02-subscriptions-switch-timeout.png").catch(() => {});
        throw new Error(`正向切换没等到账本搬家：${error instanceof Error ? error.message : String(error)}`
          + `；页面此刻 ${JSON.stringify(report.viewAtFailure)}；控制面收到 ${JSON.stringify(report.coreRequests)}`);
      }
      report.viewAfter = switched;
      await shoot(page, "02-subscriptions-switched.png");
      if (switched.errors.length > 0) throw new Error(`正向切换被当成失败报了：${switched.errors.join("；")}`);
      if (switched.currentIndex !== TARGET_ROW_INDEX) {
        throw new Error(`「当前」没搬到第 ${TARGET_ROW_INDEX} 行（现在在 index=${switched.currentIndex}）：${JSON.stringify(switched.rowNames)}`);
      }
      if (!switched.rowNames[switched.currentIndex]?.startsWith("Scratch A")) {
        throw new Error(`「当前」标记落在的不是 Scratch A 那一行：${JSON.stringify(switched.rowNames)}`);
      }
      // 回执既要对得上语言文件里那条模板（文案改了尺子跟着改），也要点出切过去的**是哪一个**。
      const ack = firstNoticeByTemplate(switched.notices, subTemplate("selected"));
      if (!ack || !ack.text.includes("Scratch A")) {
        throw new Error(`切完了却没有那条「已切到 Scratch A」回执（notices=${JSON.stringify(switched.notices)}）`);
      }
      report.switchNotice = ack.text;
      assertSwitched({ ledgerFile, profilesDir, runtimeDir, realLedger, before, core, report });
    } else if (MODE === "failover") {
      step("等「切换失败」那条红条上屏");
      // 死端口是 ECONNREFUSED，回话很快；30s 是留给「压根没发出去」那种红——
      // 那种情况下盘上没动是**碰巧**，不是一条被证明了的顺序。
      let settled;
      try {
        settled = await evaluate(page, waitExpression(`() => () => {
          const v = ${READ_VIEW};
          if (!v || v.loading) return null;
          return v.errors.length > 0 || v.currentIndex === ${TARGET_ROW_INDEX} ? v : null;
        }`, PAGE_WAIT_MS), { awaitPromise: true });
      } catch (error) {
        report.viewAtFailure = await evaluate(page, READ_VIEW).catch(() => null);
        await shoot(page, "02-subscriptions-failover-timeout.png").catch(() => {});
        throw new Error(`失败档既没等来红条也没等来搬家：${error instanceof Error ? error.message : String(error)}`
          + `；页面此刻 ${JSON.stringify(report.viewAtFailure)}`);
      }
      report.viewAfter = settled;
      await shoot(page, "02-subscriptions-failover.png");
      assertFailedOver({ ledgerFile, profilesDir, runtimeDir, realLedger, before, view, settled, report });
    } else {
      step("等闸门那句话上屏");
      // 逐字对齐语言文件里的原文：只认「有 Clash Verge 这几个字」的话，
      // 任何一条带这个名字的错都会被判成闸门生效。
      // 这句话**没等到也不在这里抛**：先去看盘。负对照（把闸门拆掉）验的就是
      // 「盘上的 sha 断言自己会不会红」——在这儿抛掉，下面那四条永远轮不到。
      const copies = gatedCopies();
      let gated;
      try {
        gated = await evaluate(page, waitExpression(`() => () => {
          const v = ${READ_VIEW};
          if (!v) return null;
          const want = ${JSON.stringify(copies)};
          const hit = v.errors.find((text) => want.includes(text));
          return hit ? { text: hit, errors: v.errors } : null;
        }`, 15_000), { awaitPromise: true });
      } catch (error) {
        gated = { missed: true, reason: String(error?.reason ?? error), seenErrors: (await evaluate(page, READ_VIEW))?.errors ?? null };
      }
      report.gatedNotice = gated;
      report.gatedCopies = copies;

      const after = { ledger: sha256(ledgerFile), profiles: snapshot(profilesDir), realLedger: realLedger ? sha256(realLedger) : null };
      report.after = after;
      report.runtimeDirExists = fs.existsSync(runtimeDir);
      await shoot(page, "02-subscriptions-gated.png");
      const settledView = await evaluate(page, READ_VIEW);
      report.viewAfter = settledView;

      if (after.ledger !== before.ledger) throw new Error(`profiles.yaml 被改了：闸门没拦住（屏上条 ${JSON.stringify(settledView.errors)}）`);
      if (JSON.stringify(after.profiles) !== JSON.stringify(before.profiles)) throw new Error("profiles/ 目录里的正文被改了");
      if (report.runtimeDirExists) throw new Error(`${runtimeDir} 长出来了：拒写之前不该碰 runtime`);
      if (before.realLedger !== null && after.realLedger !== before.realLedger) throw new Error(`真用户账本被动了：${realLedger}`);
      if (gated?.text === undefined) throw new Error(`闸门那句话没上屏（${gated?.reason}）；盘上虽然没动，但屏幕上没说清为什么`);
      if (settledView.currentIndex !== view.currentIndex) {
        throw new Error(`红条说了「不改」，页面上的「当前」却搬家了：${view.currentIndex} → ${settledView.currentIndex}`);
      }
    }

    report.ok = true;
    report.appLogTail = appLog.join("").slice(-1500);
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    report.ok = false;
    // 页面侧 reject 出来的是普通对象（{reason, seen}），String() 只会得到 [object Object]，
    // 上一版就这样把红读成一条没有信息的 "Object"。
    report.error = error instanceof Error
      ? String(error.message)
      : JSON.stringify(error?.reason !== undefined || error?.text !== undefined ? { reason: error?.reason, seen: error?.text } : error);
    console.error(`[subscriptions-write-cdp] FAIL: ${report.error}`);
    // 红的时候更要给全 report：负对照要看的正是 before/after 两组 sha
    // ——「闸门拆了以后，真用户账本有没有被连带改掉」只在这份 JSON 里能读出来。
    console.error(JSON.stringify(report, null, 2));
    console.error(`[subscriptions-write-cdp] app 输出尾部：\n${appLog.join("").slice(-3000)}`);
    process.exitCode = 1;
  } finally {
    child.kill();
    core?.server?.close();
  }
}

main();
