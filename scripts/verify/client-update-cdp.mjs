// Wave 4 T14 的真窗验收档：在主窗「网络 › 设置」里找到「客户端更新」那张卡，按一次「检查更新」，
// 把检查那一段的三种下场各跑一趟——`latest`（发布页那版不比本机新）、`available`（问到更新的一版）、
// `network-failed`（请求没回来）——每趟都是真代码、真出口、真发布页。
//
// 用法：node scripts/verify/client-update-cdp.mjs [--runs=latest,available,failed] [--locales=zh-CN,en,ja-JP]
// 退出码：0 绿／1 红／2 环境没给跑（见 ENV 那段）。
//
// `--locales=` 那一档在做什么：三腿的**每一趟**都可以换一份语言表再跑一遍。语言只走生产通路
// （`window.settings.saveGeneral({language})` → 主进程落 `app-settings.json` → 浏览器侧重载，
// 让 `initUiLocale()` 现读，等价于用户改完语言后的下一次启动），生产代码里照样没有覆写口。
// 重载不能由页面自己发起：产品的全局导航闸把所有 `will-navigate` 都 `preventDefault()` 了
// （`src/main/windows/external-link.ts:46`），页面内的 `location.reload()` 会被静默回掉，
// 所以这里用 CDP 的 `Page.reload`（浏览器侧，同 `webContents.reload()`，不落盘、不改产品一行代码）。
// 切完必须**当场认出是哪一份表**：等的是那一份里的原文卡标题，命中到别的语言就报红——
// 否则语言没切过去，探针会拿着 zh-CN 的表把 en 这一档念成绿的。第一帧尤其骗人：
// i18next 先按出厂回退档画一帧，`initUiLocale()` 从主进程读到语言才翻，所以「有张卡上屏」不算数。
//
// 为什么这三趟就敢叫「真窗」，而计划里那句「假 GitHub 全流程」在这里换了做法：
// 假一台 GitHub 服务器要拧两处，而这两处正是这条通道要守的东西——`CLIENT_RELEASE_API_URL` 没有可注入
// 的 base URL（钉死就是判据），出口白名单也不放行一台假服务器（放行等于把 A3 拆了）。在生产代码里留一条
// dev 覆写最容易，但那条覆写在装机包里也长着嘴。所以这里一根手指都没碰生产代码：
// - `latest`／`available` 用**真发布页**（钉住的 `damingslu-ctrl/Cyrene-Agent`，v1.15.0 挂在上面）。
//   `available` 那一趟靠把本机版本号压低一格造出来：`currentVersion` 是本机唯一可动的自变量，
//   而它本来就是 `app.getVersion()` 现读的——不落盘、不记账，所以「本机是 1.0.0」这句假话不会留下后果。
// - `network-failed` 把出口断在**传输层**：这台机器的 App 里，那一跳走的是主进程 `fetch()`（undici，
//   `src/main/egress/safe-fetch.ts`），它不经过 Chromium 网络栈——第一版探针写的 `--proxy-server=direct`
//   加 `--host-resolver-rules` 实测对它完全无效（照样读到 `latest`，探针当场按「闸没落下」报了红，没让它蒙过去）。
//   换成正经的一层：Node 24 认 `NODE_USE_ENV_PROXY=1`，把 https 出口指到 `127.0.0.1:9`（discard 端口，
//   开局先自己试连一次，握手上了就报 ENV）——白名单照旧放行，它判的是 URL 的 host，败的是那一跳的连接。
//   改 hosts 要管理员权限，本机拿不到，也不该为验收去改系统。
// - `digest-mismatch`（摘要不符）**不在这里跑**：它要动那颗 290 MB 安装包的字节，而下载与安装这两段
//   在这档里一颗按钮都没点——点下去是往盘上写 290 MB，再点一次是退出并被替换，没有反悔通路。
//   那一档的凭据在 `installer-download.test.ts` 与 `update-service.test.ts`（用的是装配层留的注入点），
//   这里不冒充它。真窗覆盖到的只有检查这一段，报告里也是这么写的。
//
// 每一趟都是**一次性目录**：`--user-data-dir` + APPDATA 全指到 `D:\cyrene-update-accept\run-<名>\`。
// 落盘边界（spec D2）在这里是被验的，不是被假设的：每趟结束时对整棵沙箱做文件差分，
// 更新通道只允许留下 `profile/update/settings.json` 这一颗（且只有碰开关那趟有），`updates/` 必须压根没长出来。
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const BASE = "D:\\cyrene-update-accept";
const SHOTS = path.join(BASE, "shots");
const DEBUG_PORT = 9338;
const PAGE_WAIT_MS = 45_000;
const PACKAGE_JSON = path.join(ROOT, "package.json");
/** 钉住的那一版；发布页换了这一档就要跟着换，否则 `available` 那趟的期望不成立。 */
const PINNED_LATEST = "1.15.0";
/** `available` 那一趟把本机版本号压到这里：发布页的 v1.15.0 于是「比本机新」。 */
const OLD_VERSION = "1.0.0";
const SETTINGS_REL = "profile/update/settings.json";

const LOCALES = ["zh-CN", "en", "ja-JP"];
/** 出厂默认语言：新沙箱不切就是它。真值在 `src/shared/ui-language.ts` 的 `UI_LANGUAGE_FALLBACK`。 */
const DEFAULT_LOCALE = "zh-CN";

let stepNo = 0;
function step(label) {
  console.log(`[client-update-cdp] → ${++stepNo} ${label}`);
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/** 读不动就记标记，别让一把尺子半路崩：别家 App 攥着自己的 settings.json 时照样量得下去。 */
function safeSha(file) {
  try {
    return sha256(file);
  } catch (error) {
    const stat = fs.statSync(file);
    return `unreadable:${error?.code ?? "?"}:${stat.size}`;
  }
}

/**
 * 沙箱里这棵树落过哪些文件：相对路径 → 「体积:mtime」。
 * 判据认的是**路径集合**（更新通道只许留 `update/settings.json` 这一颗），不是字节；
 * 所以不读内容——Electron 会在 userData 里铺上百个文件，边读边被它攥着的句柄顶出 EBUSY，
 * 一把要跑十分钟还会半路崩的尺子量不了这件事。
 */
function treeSnapshot(root) {
  const out = {};
  const walk = (dir, prefix) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, rel);
      else if (entry.isFile()) {
        const stat = fs.statSync(full);
        out[rel] = `${stat.size}:${Math.round(stat.mtimeMs)}`;
      }
    }
  };
  walk(root, "");
  return out;
}

/**
 * 真用户目录里那两处更新写面（`<userData>/update/settings.json` 与 `<userData>/updates/`）。
 *
 * 只盯**这个 App 可能解析到的那几个目录名**，不扫 %APPDATA% 全部子目录：那底下躺着 Qoder、
 * Cindy 这些别人家的 `updates/`，它们自己会动，把它们算进「我们有没有越界」是一把会自己
 * 假红的尺。目录名从 `src/shared/brand.ts` 现读，不写死——改名那次教训（P4）就是尺写死了身份。
 * `settings.json` 按字节 sha；`updates/` 只记名字、体积与 mtime，那里面可能躺着 290 MB 的包。
 */
function realUpdateSurfaces() {
  const base = process.env.APPDATA;
  if (!base || !fs.existsSync(base)) return {};
  const out = {};
  for (const name of candidateUserDataNames()) {
    const dir = path.join(base, name);
    if (!fs.existsSync(dir)) continue;
    const settings = path.join(dir, "update", "settings.json");
    const updates = path.join(dir, "updates");
    if (fs.existsSync(settings)) out[`${name}/update/settings.json`] = safeSha(settings);
    if (fs.existsSync(updates)) {
      out[`${name}/updates`] = fs.readdirSync(updates).map((part) => {
        const stat = fs.statSync(path.join(updates, part));
        return `${part}:${stat.size}:${Math.round(stat.mtimeMs)}`;
      });
    }
  }
  return out;
}

/** 这个 App 的 userData 可能落在哪几个名字下：现在的身份 + 上一代 + 上游 Verge。 */
function candidateUserDataNames() {
  const brand = fs.readFileSync(path.join(ROOT, "src", "shared", "brand.ts"), "utf8");
  const fromBrand = [...brand.matchAll(/export const (?:DATA_DIR_NAME|PRODUCT_NAME) = "([^"]+)"/g)].map((m) => m[1]);
  if (fromBrand.length < 2) throw new Error(`读不出 brand.ts 里的 DATA_DIR_NAME / PRODUCT_NAME，无法确定该盯哪几个真目录`);
  return [...new Set([...fromBrand, "cyrene-verge", "Cyrene", "clash-verge", "clash-verge-rev", "io.github.clash-verge-rev.clash-verge-rev"])];
}

function assertSandbox() {
  const normalized = path.resolve(BASE).toLowerCase();
  if (!normalized.startsWith("d:\\cyrene-update-accept")) throw new Error(`沙箱必须落在 D:\\cyrene-update-accept 下，收到 ${BASE}`);
  const real = String(process.env.APPDATA ?? "").toLowerCase();
  if (!real) throw new Error("会话里没有 APPDATA，无法确认沙箱跟真目录不是同一个地方");
  if (normalized.startsWith(real)) throw new Error(`沙箱落在真 APPDATA 里面（${real}），拒绝开跑`);
}

/* ------------------------------------------------------------------ 语言文件 */

/**
 * 页面上那句话的**原文**从三份语言文件里读，探针不重打一遍。
 * 重打会漂：改了文案探针还是绿，等于没有尺。
 */
function localeTables() {
  return LOCALES.map((locale) => {
    const json = JSON.parse(fs.readFileSync(path.join(ROOT, "src", "renderer", "react", "i18n", `${locale}.json`), "utf8"));
    const card = json?.network?.clientUpdate;
    if (!card) throw new Error(`${locale}.json 里没有 network.clientUpdate`);
    if (typeof json?.ui?.network !== "string") throw new Error(`${locale}.json 里没有 ui.network（侧栏那颗的 title）`);
    // `copy` 存整份 JSON：查文案一律用全限定键（network.clientUpdate.xxx），
    // 免得键名到了这里被削掉一截、拼出来的路径悄悄指到别处。
    return { locale, card, copy: json, sideLabel: json.ui.network };
  });
}

/** 用屏上那句卡标题认出当前语言：三份都备着，换语言时这把尺还跟着走。 */
function pickLocale(tables, title) {
  const hit = tables.find((entry) => entry.card.title === title);
  if (!hit) throw new Error(`卡上的标题「${title}」不在任何一份语言文件里：${JSON.stringify(tables.map((t) => [t.locale, t.card.title]))}`);
  return hit;
}

function lookup(copy, dottedKey) {
  const value = dottedKey.split(".").reduce((node, part) => (node == null ? undefined : node[part]), copy);
  if (typeof value !== "string") throw new Error(`语言文件里没有 ${dottedKey}`);
  return value;
}

/** 复刻 i18next 的 `{{name}}` 插值（init 里 `escapeValue: false`，所以不做 HTML 转义）。 */
function interp(text, vars = {}) {
  return String(text).replace(/\{\{(\w+)\}\}/g, (_m, name) => String(vars[name] ?? ""));
}

/**
 * 检查那一趟的回执该怎么拼——照 `ClientUpdateSection.tsx` 的 `actionReceipt()`：
 * 有 reason 就 `outcome · reason [· 详情：detail]`，没有就 `outcome [· v版本]`。
 * 判据（outcome／reason／detail）全部来自通道回来的那本账，探针只管拼法：
 * 拼错了就红——「界面上那句话是不是语言文件里那句话」正是这一档要的东西。
 */
function expectedCheckNotice(copy, receipt) {
  const outcome = lookup(copy, `network.clientUpdate.check.${receipt.outcome}`);
  if (receipt.reason) {
    const reason = lookup(copy, `network.clientUpdate.reason.${receipt.reason}`);
    return receipt.detail
      ? `${outcome} · ${reason} · ${interp(lookup(copy, "network.clientUpdate.saidDetail"), { detail: receipt.detail })}`
      : `${outcome} · ${reason}`;
  }
  return `${outcome}${receipt.latestVersion ? ` · v${receipt.latestVersion}` : ""}`;
}

/* ---------------------------------------------------------------------- 档位 */

const RUNS = {
  latest: {
    expectVersion: PINNED_LATEST,
    expectOutcome: "latest",
    expectReason: null,
    expectTone: "ok",
    expectLeadKey: "network.clientUpdate.lead.latest",
    expectTarget: null,
    /** 这一趟点开关：这条通道两处落盘写面之一，必须在真窗里被看见一次。 */
    toggle: true,
    switches: [],
  },
  available: {
    expectVersion: OLD_VERSION,
    expectOutcome: "available",
    expectReason: null,
    expectTone: "ok",
    expectLeadKey: "network.clientUpdate.lead.available",
    expectTarget: PINNED_LATEST,
    mutateVersion: OLD_VERSION,
    /** 显式写着不按开关：`undefined` 参与 `===` 比较会把「没碰盘」读成「碰了盘」。 */
    toggle: false,
    switches: [],
  },
  failed: {
    expectVersion: PINNED_LATEST,
    expectOutcome: "failed",
    expectReason: "network-failed",
    expectTone: "error",
    expectLeadKey: "network.clientUpdate.lead.checkFailed",
    expectTarget: null,
    toggle: false,
    /**
     * 断链在 transport 层做（理由与实测过程写在文件头）：这一档唯一的假话是「这条出口没人听」，
     * 而它不落盘、不记账，App 关掉就没了。
     */
    env: {
      NODE_USE_ENV_PROXY: "1",
      HTTPS_PROXY: "http://127.0.0.1:9",
      https_proxy: "http://127.0.0.1:9",
      NO_PROXY: "",
      no_proxy: "",
    },
    switches: [],
  },
};

/* ------------------------------------------------------------------ CDP 机械 */

class Session {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextId = 1;
    this.pending = new Map();
    /** 导航的凭据：`Page.loadEventFired` 来一次加一。换语言那一档等的是它，不是「target 还在列表里」。 */
    this.loadSeq = 0;
  }

  async open() {
    this.ws = new WebSocket(this.wsUrl);
    this.ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.method === "Page.loadEventFired") this.loadSeq += 1;
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

  send(method, params = {}, timeoutMs = 60_000) {
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

  close() {
    try { this.ws.close(); } catch { /* 已经断了 */ }
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
  return `new Promise((resolve, reject) => {
    const poll = (${pollFnSource})();
    const started = performance.now();
    const tick = () => {
      let value;
      try { value = poll(); } catch (error) { reject(String(error)); return; }
      if (value) { resolve(value); return; }
      if (performance.now() - started > ${timeoutMs}) { reject({ reason: "页面等待超时", text: (document.body?.innerText || "").slice(0, 200) }); return; }
      setTimeout(tick, 120);
    };
    tick();
  })`;
}

async function evaluate(session, expression, { awaitPromise = false, timeoutMs = 60_000 } = {}) {
  const res = await session.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise }, timeoutMs);
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text);
  return res.result.value;
}

async function attach(target) {
  const session = new Session(target.webSocketDebuggerUrl);
  await session.open();
  await session.send("Page.enable");
  await session.send("Page.bringToFront").catch(() => {});
  return session;
}

async function shoot(session, name) {
  const { data } = await session.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(SHOTS, name), Buffer.from(data, "base64"));
}

/** 点了不把页面导航走的按钮：按不到就是按不到，不许当成「按过了」。 */
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
 * 卡片此刻在屏幕上说什么。这是一段**要在页面里求值的表达式**，不是探针本地的函数。
 * 每条文本都规范化空白：CJK 折行不该混进逐字对齐。
 */
const READ_CARD = `(() => {
  const view = document.querySelector("section.net-client");
  if (!view) return null;
  const text = (el) => (el ? (el.innerText || "").replace(/\\s+/g, " ").trim() : null);
  const toneOf = (el, prefix) => [...el.classList].find((n) => n.startsWith(prefix))?.slice(prefix.length) ?? null;
  const rows = [...view.querySelectorAll("ul.net-verge__facts > li")];
  return {
    title: text(view.querySelector(".net-card__label")),
    status: text(view.querySelector(".net-status")),
    statusOnline: !!view.querySelector(".net-status.is-online"),
    leads: [...view.querySelectorAll(".net-hint")].map((el) => text(el)),
    notices: [...view.querySelectorAll(".net-notice")].map((el) => ({ text: text(el), tone: toneOf(el, "net-notice--") })),
    facts: rows.map((el) => text(el)),
    marked: rows
      .filter((el) => el.querySelector(".net-client-line"))
      .map((el) => {
        const mark = el.querySelector(".net-client-line");
        return { head: (text(el) || "").split(/：|: /)[0], text: text(mark), tone: toneOf(mark, "net-client-line--") };
      }),
    checkbox: (() => {
      const el = view.querySelector("input[name='client_update_auto_check']");
      return el ? { checked: el.checked, disabled: el.disabled } : null;
    })(),
    buttons: [...view.querySelectorAll("button[name^='client_update_']")].map((el) => ({
      name: el.getAttribute("name"),
      label: text(el),
      disabled: el.disabled,
    })),
  };
})()`;

/** 通道那本账（页面拿到的整份 view）：判据在这里，不在 DOM 里。 */
async function readState(page) {
  try {
    return await evaluate(page, `window.verge.clientUpdate.state().then((v) => v)`, { awaitPromise: true });
  } catch (error) {
    throw new Error(`读不到通道那本账——preload 的 window.verge.clientUpdate 没到位？${error}`);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`等 ${label} 超时（${timeoutMs}ms）`);
    await sleep(180);
  }
}

/* ------------------------------------------------------------------ 一趟跑法 */

async function runOne(name, config, tables, electronBin, locale) {
  // 默认语言那几趟沿用旧目录名（台账里记的就是 `run-<名>`）；换语言的另开目录，
  // 免得两份语言表共用一颗沙箱、把上一次的 `app-settings.json` 当成这一次的现场。
  const sandbox = path.join(BASE, locale === DEFAULT_LOCALE ? `run-${name}` : `run-${name}-${locale}`);
  const appdata = path.join(sandbox, "appdata");
  const profile = path.join(sandbox, "profile");
  fs.rmSync(sandbox, { recursive: true, force: true });
  fs.mkdirSync(profile, { recursive: true });
  fs.mkdirSync(appdata, { recursive: true });

  const run = { name, locale, sandbox, expect: { outcome: config.expectOutcome, reason: config.expectReason, version: config.expectVersion } };
  const before = { sandbox: treeSnapshot(sandbox), realUpdateSurfaces: realUpdateSurfaces() };

  const env = { ...process.env, APPDATA: appdata, ...(config.env ?? {}) };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(
    electronBin,
    [".", `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`, ...config.switches],
    { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] },
  );
  const appLog = [];
  child.stdout.on("data", (b) => appLog.push(String(b)));
  child.stderr.on("data", (b) => appLog.push(String(b)));

  let failure = null;
  try {
    step(`${name}：等欢迎闸门 target`);
    const gateTarget = await findTarget((url) => url.includes("onboarding=1"), 150_000);
    if (!gateTarget) throw new Error(`没等到欢迎闸门；app 输出：\n${appLog.join("").slice(-2500)}`);
    const gate = await attach(gateTarget);
    await evaluate(gate, waitExpression(`() => () => document.querySelector(".cy-onboarding__button--primary") ? true : null`, PAGE_WAIT_MS), { awaitPromise: true });
    if (!(await click(gate, ".cy-onboarding__button--primary"))) throw new Error("欢迎页没有主按钮");
    await evaluate(gate, waitExpression(`() => () => document.querySelector(".cy-onboarding__actions .cy-onboarding__button--primary") ? true : null`, PAGE_WAIT_MS), { awaitPromise: true });
    await clickThatNavigates(gate, ".cy-onboarding__actions .cy-onboarding__button--primary");
    gate.close();

    step(`${name}：等主窗 target${locale === DEFAULT_LOCALE ? "" : `，先把界面语言切到 ${locale}`}`);
    const mainTarget = await findTarget((url) => url.includes("/react/index.html") && !url.includes("onboarding=1"), 120_000);
    if (!mainTarget) throw new Error(`点完同意没等到主窗 target；app 输出：\n${appLog.join("").slice(-2500)}`);
    let page = await attach(mainTarget);
    await evaluate(page, waitExpression(`() => () => !document.documentElement.hasAttribute("data-ui-theme-pending") ? true : null`, PAGE_WAIT_MS), { awaitPromise: true });

    if (locale !== DEFAULT_LOCALE) {
      // 一把尺要量两份语言，就得先让 App 真的换到那份上：这里用的就是设置菜单里那颗
      // 「界面语言」在生产里走的同一条通路（`UserAvatar.tsx` 的 `selectLanguage`），
      // 再 reload 一次，让 `initUiLocale()` 从主进程现读——等价于用户改完语言后的下一次启动。
      const landed = await evaluate(
        page,
        `window.settings.saveGeneral({ language: ${JSON.stringify(locale)} }).then((v) => v?.language ?? null)`,
        { awaitPromise: true },
      );
      if (landed !== locale) {
        throw new Error(`主进程把语言存成了 ${String(landed)}，不是 ${locale}：语言没落进 app-settings.json，这一档不能算切过去了`);
      }
      // 等这一次导航真的落地，而不是等 `/json/list` 里还有这个 target：老文档在 reload 期间照样
      // 在列表里、照样能 evaluate，在它身上按按钮等于对一副尸体按——按钮点了，新文档开在聊天页，
      // 那张卡永远不上屏（第一趟就是这么「语言没切过去」的）。
      //
      // 重载只能从外面按，不能在页面里按：`installGlobalNavigationGuard()`（`src/main/windows/external-link.ts:46`）
      // 给每个窗口的 `will-navigate` 都挂了 `event.preventDefault()`，页面内的 `location.reload()` 属于
      // 页面自己发起的导航，被这道闸一口回掉——第二/三趟就挂在这里等一个永远不会来的 load 事件。
      // 这是产品的安全边界，不动它；`Page.reload` 走的是浏览器侧（同 `webContents.reload()`），
      // 不触发 `will-navigate`，等价于用户重启 App 后 `initUiLocale()` 从主进程现读那一次。
      const loadBefore = page.loadSeq;
      await page.send("Page.reload", { ignoreCache: false }, 8_000).catch(() => null); // 导航会吞掉回音
      await waitFor(
        async () => (page.loadSeq > loadBefore || page.ws.readyState !== WebSocket.OPEN ? true : null),
        PAGE_WAIT_MS,
        "重新载入落地（load 事件，或这条 ws 被导航关掉）",
      );
      const reloaded = await findTarget((url) => url.includes("/react/index.html") && !url.includes("onboarding=1"), PAGE_WAIT_MS);
      if (!reloaded) throw new Error(`换语言后重新载入没等回主窗 target：这一档的现场在 ${sandbox}`);
      page.close();
      page = await attach(reloaded);
      await evaluate(page, waitExpression(`() => () => !document.documentElement.hasAttribute("data-ui-theme-pending") ? true : null`, PAGE_WAIT_MS), { awaitPromise: true });
    }
    // 侧栏那颗按钮认 title，不认位置：三份语言文件里的 `ui.network` 都拿来比，探针不重打文案。
    const sideLabels = JSON.stringify(tables.map((entry) => entry.sideLabel));
    for (const expr of [
      `() => () => {
        const hit = [...document.querySelectorAll("button.cy-side-action")]
          .find((el) => ${sideLabels}.includes((el.getAttribute("title") || "").trim()));
        if (!hit) return null;
        hit.click();
        return true;
      }`,
      // 「设置」是第八个页签，只有颗齿轮：按类名取，别按文案（文案跟着语言走）。
      `() => () => {
        const hit = document.querySelector(".net-tabs .net-tab--icon");
        if (!hit) return null;
        hit.click();
        return true;
      }`,
    ]) {
      await evaluate(page, waitExpression(expr, PAGE_WAIT_MS), { awaitPromise: true });
    }

    // 语言是真真切过去了还是要等它自己说：i18next 先按出厂回退档画第一帧，`initUiLocale()` 从主进程
    // 读到语言后才翻。所以这里等的是**那一份表里的原文标题**，不是「有张卡上屏」——
    // 早读一步就会把还没翻的界面认成 zh-CN，量的是中文，报的却是 en 档。
    const wantTitle = tables.find((entry) => entry.locale === locale)?.card.title;
    if (!wantTitle) throw new Error(`语言表里没有 ${locale} 那颗卡标题`);
    step(`${name}：等「${wantTitle}」那张卡上屏（${locale} 那份表的原文）`);
    const card0 = await waitFor(
      async () => {
        const value = await evaluate(page, READ_CARD);
        return value && value.title === wantTitle ? value : null;
      },
      PAGE_WAIT_MS,
      `卡标题「${wantTitle}」`,
    );
    const copy = pickLocale(tables, card0.title);
    run.localeOnScreen = copy.locale;
    // 等文案的和认表的是两把尺，这里必须对得上：认到别份表就是语言没切过去，
    // 否则探针会拿着 zh-CN 的表把界面念成绿的。
    if (copy.locale !== locale) {
      throw new Error(`这一档要的是 ${locale}，卡上那句「${card0.title}」落在 ${copy.locale} 那份表里：界面语言没真切过去，后面的逐字对齐都不算数`);
    }

    // 前闸：一次性目录里三本账必须是空的。账本不落盘（只有 autoCheck 落），所以读到东西只有两种解释——
    // 沙箱没吃进去（读的是真目录），或者这条通道在偷偷写盘。两种都不许往下走。
    const state0 = await readState(page);
    run.stateBefore = state0;
    if (state0.currentVersion !== config.expectVersion) {
      throw new Error(`本机版本号不是这一档要的 ${config.expectVersion}（读到 ${state0.currentVersion}）：档位与真窗对不上，后面别看`);
    }
    if (state0.check !== null || state0.download !== null || state0.install !== null) {
      throw new Error(`一次性目录里三本账不是空的：${JSON.stringify({ check: state0.check, download: state0.download, install: state0.install })}`);
    }
    if (state0.autoCheck !== true) throw new Error(`autoCheck 默认该是开（spec D3），读到 ${state0.autoCheck}`);
    if (state0.saved !== null) throw new Error(`state() 那一条通道不该带落盘下场：${JSON.stringify(state0.saved)}`);
    if (card0.leads[0] !== lookup(copy.copy, "network.clientUpdate.lead.never")) {
      throw new Error(`没查过时那句 lead 不对：${card0.leads[0]}`);
    }
    if (fs.existsSync(path.join(profile, "update")) || fs.existsSync(path.join(profile, "updates"))) {
      throw new Error("刚进场就长出了 update/ 或 updates/：这条通道在启动时写了不该写的东西");
    }

    if (config.toggle) {
      step(`${name}：先关掉自动检查（撤销排程那一条链，也顺带让下面那一枪没有对手）`);
      await toggleOff(page, profile, copy, run);
    } else {
      // 排程那条链在 90 秒后开第一枪；真要是赶上它在途，这一趟的回执会是「并到别段那一趟上」，
      // 不是产品红而是没测到——所以先等它空下来。
      await waitFor(async () => (await readState(page)).phase === "idle", 40_000, "phase 退回 idle");
    }

    step(`${name}：按「检查更新」`);
    if (!(await evaluate(page, `(() => { const el = document.querySelector("button[name='client_update_check']"); if (!el || el.disabled) return false; el.click(); return true; })()`))) {
      throw new Error("卡上没有可点的 client_update_check 按钮");
    }

    step(`${name}：等通道那本账落笔（判据来自 main，不来自 DOM）`);
    const state1 = await waitFor(async () => {
      const value = await readState(page);
      return value.check !== null ? value : null;
    }, PAGE_WAIT_MS, "检查那本账落笔");
    run.stateAfter = state1;

    // 环境红与产品红分开：期望 `latest`／`available` 却读到 network-failed，是这条出口此刻不通，
    // 不是这张卡判错——那种情况下面所有逐字对齐都不成立。
    if (config.expectOutcome !== "failed" && state1.check.outcome === "failed" && state1.check.reason === "network-failed") {
      const envError = new Error(`环境没给跑：这一档要真发布页答话，读到的却是 network-failed（${state1.check.detail}）`);
      envError.isEnvironment = true;
      throw envError;
    }
    if (config.expectOutcome === "failed") {
      // 断链这一档如果反倒问到了话，那是**探针的闸没落下**（这台机器上 undici 没认 env 代理，
      // 或者 127.0.0.1:9 上真有个东西在听），不是产品把失败说成了成功——报 ENV，不冤枉它。
      if (state1.check.outcome !== "failed") {
        const envError = new Error(
          `断链那一档没断：出口已经指到 127.0.0.1:9（NODE_USE_ENV_PROXY=1）之后仍读到 ${state1.check.outcome}——` +
            `要么这个 Electron 的 undici 不认 env 代理，要么那颗端口有人听。这一趟不算验过。`,
        );
        envError.isEnvironment = true;
        throw envError;
      }
      if (state1.check.reason !== "network-failed") {
        throw new Error(`断链本该判成 network-failed，实际 reason=${state1.check.reason}：拿不到网却说出别的原因，得查判据`);
      }
    }
    if (state1.check.outcome !== config.expectOutcome) {
      throw new Error(`检查的下场是 ${state1.check.outcome}，这一档要的是 ${config.expectOutcome}（reason=${state1.check.reason} detail=${state1.check.detail}）`);
    }
    if (state1.check.reason !== config.expectReason) throw new Error(`reason 是 ${state1.check.reason}，这一档要的是 ${config.expectReason}`);
    if (config.expectOutcome === "available") {
      if (state1.check.latestVersion !== PINNED_LATEST) throw new Error(`问到的版本是 ${state1.check.latestVersion}，该是发布页那一版 ${PINNED_LATEST}`);
      if (state1.download !== null || state1.install !== null) throw new Error("只按了检查，下载与安装那两本账却动了");
    }
    // 这一趟走完 phase 必须退回 idle；排程那一条链随时可能又开一枪，所以是等而不是当场断。
    await waitFor(async () => (await readState(page)).phase === "idle", 40_000, "这一趟走完 phase 退回 idle");

    step(`${name}：把屏幕上那句话逐字对齐语言文件`);
    const want = expectedCheckNotice(copy.copy, state1.check);
    const card = await waitFor(async () => {
      const value = await evaluate(page, READ_CARD);
      return value && value.notices.some((entry) => entry.text === want) ? value : null;
    }, 15_000, `回执那句「${want}」`);
    run.expectedNotice = want;
    run.cardAfter = card;

    if (card.status !== lookup(copy.copy, "network.clientUpdate.phase.idle") || card.statusOnline) {
      throw new Error(`这一趟走完了，状态那颗还写着「${card.status}」${card.statusOnline ? "（亮着）" : ""}`);
    }
    if (card.leads[0] !== lookup(copy.copy, config.expectLeadKey)) {
      throw new Error(`那句 lead 不对：这一档要 ${config.expectLeadKey} = ${lookup(copy.copy, config.expectLeadKey)}，屏上是 ${card.leads[0]}`);
    }
    const outcomeCopy = lookup(copy.copy, `network.clientUpdate.check.${state1.check.outcome}`);
    const checkLine = card.marked.find((entry) => entry.text?.startsWith(outcomeCopy));
    if (!checkLine) throw new Error(`「上次检查」那一行没画出来：${JSON.stringify(card.marked)}`);
    if (checkLine.tone !== config.expectTone) throw new Error(`脸色是 ${checkLine.tone}，这一档要 ${config.expectTone}`);
    // 「标签 冒号 值」那颗冒号也归语言文件管：探针不重打标点，否则 en 那档用 CJK 冒号排版
    // （`This machine：v…`）这件事就永远量不出来——中文冒号在英文界面上是个真缺陷，不是口味。
    const colon = lookup(copy.copy, "ui.labelColon");
    if (!card.facts.some((text) => text.includes(`${lookup(copy.copy, "network.clientUpdate.currentLabel")}${colon}v${state1.currentVersion}`))) {
      throw new Error(`facts 第一行没写本机版本：${JSON.stringify(card.facts)}`);
    }
    const targetCopy = interp(lookup(copy.copy, "network.clientUpdate.targetLabel"), { version: config.expectTarget ?? PINNED_LATEST });
    const hasTarget = card.facts.some((text) => text.includes(targetCopy));
    if (config.expectTarget && !hasTarget) throw new Error(`没有「${targetCopy}」这句：${JSON.stringify(card.facts)}`);
    if (!config.expectTarget && hasTarget) {
      throw new Error(`这一档没有可装的版本，卡上却写着「${targetCopy}」——把「本来就是这版」说成还有一件事没做完`);
    }
    const buttons = Object.fromEntries(card.buttons.map((entry) => [entry.name, entry]));
    for (const nameAttr of ["client_update_check", "client_update_download", "client_update_install"]) {
      if (!buttons[nameAttr]) throw new Error(`卡上没有 ${nameAttr} 那颗：${JSON.stringify(card.buttons)}`);
      if (buttons[nameAttr].disabled) throw new Error(`${nameAttr} 这趟走完了还灰着：${JSON.stringify(card.buttons)}`);
    }
    if (buttons.client_update_install.label !== lookup(copy.copy, "network.clientUpdate.install.button")) {
      throw new Error(`「安装」没武装却写着「${buttons.client_update_install.label}」——按钮名会骗一次点击`);
    }
    // 三步都不点：下载是往盘上写 290 MB，安装是退出并被替换。这一档只到检查为止。
    if (config.toggle) {
      step(`${name}：把自动检查开回去（不给用户留一条关掉的状态）`);
      await toggleOn(page, profile, copy, run);
    }

    await shoot(page, `${name}-${locale}-01-after-check.png`);
    run.assertionsPassed = true;
  } catch (error) {
    // 半截的现场比结论值钱：红的时候要看清读到过什么，而不是只知道「throw 了」。
    error.run = run;
    failure = error;
  } finally {
    child.kill();
    await Promise.race([new Promise((resolve) => child.once("exit", resolve)), sleep(6_000)]);
    run.appLogTail = appLog.join("").slice(-1200);
    // 落盘边界要等进程真退出再量：还开着的时候 Electron 攥着一堆 leveldb/lock 文件，
    // 读它就是 EBUSY；而且退出钩子里写的东西也算这一趟写的。
    const added = Object.keys(treeSnapshot(sandbox)).filter((rel) => !(rel in before.sandbox));
    // Electron 自己会在 userData 里铺几百个文件，全列进报告会淹掉要看的那一行：
    // 只留计数与「更新通道那两处」，其余想查现场的人有 sandbox 路径可以自己 diff。
    run.addedFileCount = added.length;
    const updateish = added.filter((rel) => /(^|\/)updates?(\/|$)/i.test(rel));
    run.addedUpdateish = updateish;
    run.boundaryOk =
      !updateish.some((rel) => rel !== SETTINGS_REL) && config.toggle === updateish.includes(SETTINGS_REL);
    const realNow = realUpdateSurfaces();
    run.realUpdateSurfacesUnchanged = JSON.stringify(realNow) === JSON.stringify(before.realUpdateSurfaces);
    // 已经有别的原因红了就先报那一个——写面的差值已经记进 run，看现场时一样在。
    if (!failure) {
      if (updateish.some((rel) => rel !== SETTINGS_REL)) {
        failure = new Error(`更新通道写了第三处：${JSON.stringify(updateish)}（spec D2 只给两处）`);
      } else if (config.toggle !== updateish.includes(SETTINGS_REL)) {
        failure = new Error(
          config.toggle ? `按了开关却没在 ${SETTINGS_REL} 留下东西` : `这一趟没碰开关却写了盘：${JSON.stringify(updateish)}`,
        );
      } else if (!run.realUpdateSurfacesUnchanged) {
        failure = new Error(
          `真用户目录里那两处更新写面被碰了：before ${JSON.stringify(before.realUpdateSurfaces)} → after ${JSON.stringify(realNow)}`,
        );
      }
    }
    if (!failure) run.ok = true;
    if (failure) {
      failure.run = run;
      throw failure;
    }
  }
  return run;
}

/** 关：撤销排程那一条链，并当场看见 settings.json 里那一颗落成 false。 */
async function toggleOff(page, profile, copy, run) {
  const settingsFile = path.join(profile, "update", "settings.json");
  const saveOk = lookup(copy.copy, "network.clientUpdate.save.ok");
  if (!(await evaluate(page, `(() => { const el = document.querySelector("section.net-client input[name='client_update_auto_check']"); if (!el || el.disabled) return false; el.click(); return true; })()`))) {
    throw new Error("开关点不动");
  }
  const disk = await waitFor(async () => {
    if (!fs.existsSync(settingsFile)) return null;
    try {
      const parsed = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
      return parsed?.autoCheck === false ? parsed : null;
    } catch {
      return null;
    }
  }, 15_000, `${settingsFile} 写着 autoCheck:false`);
  run.settingsAfterToggle = disk;
  // 落盘的下场**不在** `state()` 里：IPC 那一支永远把 `saved` 钉成 null（`update-ipc.ts` 的
  // STATE 分支），真值只骑在 `setAutoCheck` 的返回值上，而这一趟是按复选框触发的——探针拿不到
  // 那次的返回值。所以同一条证据换一层读：卡片上那句 `save.ok` 就是 `saved.ok === true`
  // 画出来的，盘上是 false、通道里是 false、屏上有那句，三样对齐比读一个字段更硬。
  const state = await readState(page);
  if (state.autoCheck !== false) throw new Error(`盘上存了 false，通道里的 autoCheck 还是 ${state.autoCheck}`);
  const card = await waitFor(async () => {
    const value = await evaluate(page, READ_CARD);
    return value && value.notices.some((entry) => entry.text === saveOk && entry.tone === "ok") ? value : null;
  }, 15_000, `那句「${saveOk}」`);
  if (card.checkbox?.checked !== false) throw new Error("盘上存了 false，复选框还勾着");
}

/** 开回去：只有这一趟结束时沙箱里那颗是 true，验收才不给用户留一条关掉的状态。 */
async function toggleOn(page, profile, copy, run) {
  const settingsFile = path.join(profile, "update", "settings.json");
  if (!(await evaluate(page, `(() => { const el = document.querySelector("section.net-client input[name='client_update_auto_check']"); if (!el || el.disabled) return false; el.click(); return true; })()`))) {
    throw new Error("开关开不回去");
  }
  run.settingsFinal = await waitFor(async () => {
    if (!fs.existsSync(settingsFile)) return null;
    try {
      const parsed = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
      return parsed?.autoCheck === true ? parsed : null;
    } catch {
      return null;
    }
  }, 30_000, `${settingsFile} 写回 autoCheck:true`);
  const state = await readState(page);
  if (state.autoCheck !== true) throw new Error(`开回去了，通道里的 autoCheck 是 ${state.autoCheck}`);
  const card = await waitFor(async () => {
    const value = await evaluate(page, READ_CARD);
    return value && value.notices.some((entry) => entry.text === lookup(copy.copy, "network.clientUpdate.save.ok") && entry.tone === "ok")
      ? value
      : null;
  }, 15_000, `开回去那句「${lookup(copy.copy, "network.clientUpdate.save.ok")}」`);
  if (fs.existsSync(path.join(profile, "updates"))) throw new Error("开关那两下把 updates/ 也带出来了：它一个字节都不该写");
}

/* ---------------------------------------------------------------------- 主流程 */

function parseRuns() {
  const runsArg = process.argv.slice(2).find((arg) => arg.startsWith("--runs="))?.slice("--runs=".length);
  const names = (runsArg ?? Object.keys(RUNS).join(",")).split(",").map((s) => s.trim()).filter(Boolean);
  for (const name of names) if (!RUNS[name]) throw new Error(`不认识这一档：${name}（可选 ${Object.keys(RUNS).join("/")}）`);
  return names;
}

/**
 * 语言档默认只跑出厂那一档（zh-CN）：`--locales=` 才把三腿在别份语言表上再各跑一遍。
 * 名字必须落在 `src/shared/ui-language.ts` 的白名单里——写个 `ko` 进来，主进程会静默回落中文，
 * 而这一档的期望是韩文，那把尺只会把自己绕晕。
 */
function parseLocales() {
  const arg = process.argv.slice(2).find((value) => value.startsWith("--locales="))?.slice("--locales=".length);
  const names = (arg ?? DEFAULT_LOCALE).split(",").map((value) => value.trim()).filter(Boolean);
  for (const name of names) {
    if (!LOCALES.includes(name)) throw new Error(`不认识这个语言档：${name}（可选 ${LOCALES.join("/")}，白名单在 src/shared/ui-language.ts）`);
  }
  return names;
}

/** 断链那一档的前提：那颗 discard 端口真的没人听。有人听就是环境变了，不是产品的事。 */
async function assertDeadProxy(target) {
  const net = await import("node:net");
  const { hostname, port } = new URL(target);
  const envError = (why) => Object.assign(new Error(`127.0.0.1:${port} 那颗假出口没死透：${why}`), { isEnvironment: true });
  await new Promise((resolve, reject) => {
    const socket = net.connect({ host: hostname, port: Number(port) });
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };
    socket.setTimeout(3_000, () => finish(envError("连上去超时（有东西半挂着）")));
    socket.once("connect", () => finish(envError("居然握手上了，这台机器上有人在那颗端口上听")));
    socket.once("error", () => finish(null));
  });
}

async function main() {
  const names = parseRuns();
  const locales = parseLocales();
  assertSandbox();
  if (names.some((name) => RUNS[name].env)) {
    await assertDeadProxy(RUNS[names.find((name) => RUNS[name].env)].env.HTTPS_PROXY);
    step("出口预闸：127.0.0.1:9 确实没人听");
  }
  fs.mkdirSync(SHOTS, { recursive: true });

  const tables = localeTables();
  const electronBin = createRequire(import.meta.url)("electron");
  const packageBefore = sha256(PACKAGE_JSON);
  const report = { started_at: new Date().toISOString(), runs: names, locales, results: [], ok: false };
  const results = [];

  const restorePackageJson = (backup) => {
    fs.writeFileSync(PACKAGE_JSON, fs.readFileSync(backup, "utf8"), "utf8");
    if (sha256(PACKAGE_JSON) !== packageBefore) throw new Error(`package.json 还原后与进场时不是同一份字节：${PACKAGE_JSON}`);
    fs.rmSync(backup, { force: true });
    step(`package.json 已按字节还原（sha ${packageBefore.slice(0, 12)}…）`);
  };

  try {
    for (const locale of locales) {
      for (const name of names) {
        const config = RUNS[name];
        let backup = null;
        if (config.mutateVersion) {
          // 只有 `available` 这一档动 package.json：备份放在树外，跑完按字节还原，sha 当场对。
          backup = path.join(BASE, "package.json.bak");
          fs.copyFileSync(PACKAGE_JSON, backup);
          const raw = fs.readFileSync(PACKAGE_JSON, "utf8");
          const patched = raw.replace(/("version":\s*")[^"]*(")/, `$1${config.mutateVersion}$2`);
          if (patched === raw) throw new Error("package.json 里找不到 version 那一行，造不出 available 这一档");
          // 正则写完不靠它自己说成功： parse 回来对一遍，写坏了就在这儿红，别让 App 带着半个版本号启动。
          if (JSON.parse(patched)?.version !== config.mutateVersion) {
            throw new Error(`改完的 package.json 解析出来不是 ${config.mutateVersion}，正则碰错了地方`);
          }
          fs.writeFileSync(PACKAGE_JSON, patched, "utf8");
          step(`${name}：本机版本号临时压到 ${config.mutateVersion}（真发布页那一版于是「比本机新」）`);
        }
        try {
          results.push(await runOne(name, config, tables, electronBin, locale));
        } finally {
          if (backup) restorePackageJson(backup);
        }
      }
    }
    report.results = results;
    report.ok = true;
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    report.results = results;
    report.error = error instanceof Error ? error.message : JSON.stringify(error?.reason ?? error ?? error);
    report.environment = error?.isEnvironment === true;
    // 红那一趟的现场要进报告：读不到 stateAfter / cardAfter / addedUpdateish，就等于只知道自己错了、
    // 不知道错在哪一层（main 没落账？页面没说那句话？还是写面越了界？）。
    if (error?.run) report.failedRun = error.run;
    console.error(`[client-update-cdp] ${error?.isEnvironment ? "ENV（不是产品红）" : "FAIL"}: ${report.error}`);
    console.error(JSON.stringify(report, null, 2));
    for (const result of results) if (!result?.ok) console.error(`[client-update-cdp] ${result?.name} app 输出尾部：\n${result?.appLogTail}`);
    process.exitCode = error?.isEnvironment ? 2 : 1;
  }
  // 还原没做成是比红更贵的事：树里留一个假版本号，下一趟构建会把它发出去。
  if (sha256(PACKAGE_JSON) !== packageBefore) {
    console.error(`[client-update-cdp] 注意：package.json 的 sha 与进场时不同，还原没做完——先按备份补回去再动别的`);
    process.exitCode = 1;
  }
}

main();
