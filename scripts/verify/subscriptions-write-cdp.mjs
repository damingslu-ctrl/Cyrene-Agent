// Wave 2 的真窗写面档：在一次性目录里开「订阅」页，点一次「切换」，认两件事——
// 闸门当拒（屏上是那句「Clash Verge 正在运行」），盘上一个字节都不动。
//
// 用法：node scripts/verify/subscriptions-write-cdp.mjs
//
// 为什么这一档非要自己造一份账本，而不像 network-tabs-cdp.mjs 那样直接读真数据：
// 点击「切换」是一次**写**尝试。真账本上点错一下就是改用户正在用的订阅，
// 而「闸门会不会真的拦住」正是这档要证的东西——不能拿要证的结论当安全前提。
// 所以：APPDATA 指到一次性目录，账本、正文、控制面文件全是我自己造的；
// 真用户账本只读它的 sha256，用来证明这一趟压根没碰过它。
//
// 两道前闸（都在点击之前）：
// 1) 页面上必须出现只有这份一次性账本才有的主机名，且行数＝3。对不上＝APPDATA
//    没被吃进去、app 读的是真目录，当场红，绝不点。
// 2) 点完之后 profiles.yaml 与 profiles/ 的 sha256 必须逐一对齐，runtime 目录必须还没长出来。
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const BASE = "D:\\cyrene-sub-accept";
const APPDATA = path.join(BASE, "appdata");
const PROFILE = path.join(BASE, "profile");
const SHOTS = path.join(BASE, "shots");
const VERGE_DIR_NAME = "io.github.clash-verge-rev.clash-verge-rev";
const CONFIG_ROOT = path.join(APPDATA, VERGE_DIR_NAME);
const DEBUG_PORT = 9336;
const PAGE_WAIT_MS = 30_000;

/**
 * 闸门那句话的**原文**，从三份语言文件里读，不在探针里重打一遍。
 * 重打会漂：改了文案探针还是绿，等于没有尺。
 */
function gatedCopies() {
  return ["zh-CN", "en", "ja-JP"].map((locale) => {
    const file = path.join(ROOT, "src", "renderer", "react", "i18n", `${locale}.json`);
    const copy = JSON.parse(fs.readFileSync(file, "utf8"))?.network?.sub?.gated;
    if (typeof copy !== "string" || !copy.trim()) throw new Error(`${locale}.json 里没有 network.sub.gated`);
    return copy.trim().replace(/\s+/g, " ");
  });
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

function assertSandbox() {
  const normalized = path.resolve(BASE).toLowerCase();
  if (!normalized.startsWith("d:\\cyrene-sub-accept")) throw new Error(`一次性目录必须落在 D:\\cyrene-sub-accept 下，收到 ${BASE}`);
  const real = String(process.env.APPDATA ?? "").toLowerCase();
  if (!real) throw new Error("会话里没有 APPDATA，无法确认一次性目录跟真目录不是同一个地方");
  if (path.resolve(APPDATA).toLowerCase() === real) throw new Error("APPDATA 覆盖后与真 APPDATA 相同，拒绝开写");
  if (normalized.startsWith(real)) throw new Error(`一次性目录落在真 APPDATA 里面（${real}），拒绝开写`);
}

/** 造一份最小但形状正确的 Verge 目录：账本 + 正文 + 控制面文件，全在一次性目录里。 */
function writeScratchLedger() {
  fs.rmSync(BASE, { recursive: true, force: true });
  fs.mkdirSync(path.join(CONFIG_ROOT, "profiles"), { recursive: true });
  fs.mkdirSync(PROFILE, { recursive: true });
  fs.mkdirSync(SHOTS, { recursive: true });

  const body = (name) => `proxies:\n- name: ${name}\n  type: ss\n  server: 127.0.0.1\n  port: 8321\n`;
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
  // 控制面指到一个没人听的端口：万一闸门没拦住，这一次写也够不着用户那个真内核。
  fs.writeFileSync(
    path.join(CONFIG_ROOT, "clash-verge.yaml"),
    "external-controller: http://127.0.0.1:59099\nsecret: scratch-secret\nmixed-port: 59098\n",
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
  return `new Promise((resolve, reject) => {
    const poll = (${pollFnSource})();
    const started = performance.now();
    const tick = () => {
      let value;
      try { value = poll(); } catch (error) { reject(String(error)); return; }
      if (value) { resolve(value); return; }
      if (performance.now() - started > ${timeoutMs}) { reject({ reason: "页面等待超时", text: (document.body?.innerText || "").slice(0, 160) }); return; }
      setTimeout(tick, 80);
    };
    tick();
  })`;
}

async function evaluate(session, expression, { awaitPromise = false, timeoutMs = 45_000 } = {}) {
  const res = await session.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise }, timeoutMs);
  if (res.exceptionDetails) {
    throw new Error(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text);
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

async function shoot(session, name) {
  const { data } = await session.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(SHOTS, name), Buffer.from(data, "base64"));
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
  writeScratchLedger();

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

  const report = { started_at: new Date().toISOString(), sandbox: { configRoot: CONFIG_ROOT, profile: PROFILE, realLedger }, before };
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

    step("点非当前那一行的「切换」（写尝试）");
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
  }
}

main();
