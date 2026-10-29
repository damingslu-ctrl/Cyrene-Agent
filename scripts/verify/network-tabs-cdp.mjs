// Wave 1 的真窗取样档：从侧栏进「网络」，只把七个页签逐个点开看一眼。
// 用法：node scripts/verify/network-tabs-cdp.mjs [shotsDir]
// - 只允许写在 D:\cyrene-net-accept\ 下的一次性 profile，绝不碰 %APPDATA%。
// - 只点页签：模式药丸、节点行、保存、关闭连接、入站测速这些会改内核状态的一律不点。
// - 每个页签的「开没开」由视图自己的根节点断言（空态/错误态也算开），
//   不拿「没报错」冒充「打开了」。
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const PROFILE = "D:\\cyrene-net-accept\\profile";
const DEFAULT_SHOTS = "D:\\cyrene-net-accept\\shots";
const DEBUG_PORT = 9334;
const PAGE_WAIT_MS = 30_000;
let stepNo = 0;
function step(label) {
  console.log(`[network-tabs-cdp] → ${++stepNo} ${label}`);
}

function assertSafeProfile(dir) {
  const normalized = path.resolve(dir).toLowerCase();
  if (!normalized.startsWith("d:\\cyrene-net-accept")) {
    throw new Error(`profile 必须落在 D:\\cyrene-net-accept 下，收到 ${dir}`);
  }
  return normalized;
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

/** 在页面里轮询一个返回「取到就给出、没取到就 null」的函数；超时即 reject。 */
function waitExpression(pollFnSource, timeoutMs) {
  return `new Promise((resolve, reject) => {
    const poll = (${pollFnSource})();
    const started = performance.now();
    const tick = () => {
      let value;
      try { value = poll(); } catch (error) { reject(String(error)); return; }
      if (value) { resolve(value); return; }
      if (performance.now() - started > ${timeoutMs}) { reject({ reason: "页面等待超时", seen: document.querySelector(".net-tabs") ? [...document.querySelectorAll(".net-tabs [role='tab']")].map((el) => (el.textContent || "").trim()) : null }); return; }
      setTimeout(tick, 80);
    };
    tick();
  })`;
}

async function evaluate(session, expression, { awaitPromise = false, timeoutMs = 45_000 } = {}) {
  const res = await session.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise }, timeoutMs);
  if (res.exceptionDetails) {
    const detail = res.exceptionDetails.exception?.description ?? res.exceptionDetails.text;
    throw new Error(detail);
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

async function shoot(session, shots, name) {
  const { data } = await session.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(shots, name), Buffer.from(data, "base64"));
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

const BODY_TABS = [
  { label: "概览", root: ".net-hero", file: "01-overview.png" },
  { label: "节点", root: "section.net-nodes", file: "02-nodes.png" },
  { label: "规则", root: "section.net-rules", file: "03-rules.png" },
  { label: "日志", root: "section.net-logs", file: "04-logs.png" },
  { label: "连接", root: "section.net-conns", file: "05-connections.png" },
  { label: "入站", root: "section.net-providers", file: "06-providers.png" },
  { label: "设置", root: "section.net-settings", file: "07-settings.png", gear: true },
];

function clickTab(label) {
  return waitExpression(
    `() => () => {
      const tabs = [...document.querySelectorAll(".net-tabs [role='tab']")];
      const hit = tabs.find((el) => (el.textContent || "").trim() === ${JSON.stringify(label)});
      if (!hit) return null;
      hit.click();
      return { ok: true, labels: tabs.map((el) => (el.textContent || "").trim()), selected: hit.getAttribute("aria-selected") };
    }`,
    5_000,
  );
}

/** 齿轮页签没有文字，只能按类名找它，再用 aria-selected 认它成为了当前页签。 */
function waitGearOpen() {
  return waitExpression(
    `() => () => {
      const gear = document.querySelector(".net-tab--icon");
      const view = document.querySelector("section.net-settings");
      if (!gear || !view) return null;
      if (gear.getAttribute("aria-selected") !== "true") return null;
      return { ok: true, text: (view.innerText || "").slice(0, 160) };
    }`,
    PAGE_WAIT_MS,
  );
}

function waitTabOpen(label, root) {
  return waitExpression(
    `() => () => {
      const tabs = [...document.querySelectorAll(".net-tabs [role='tab']")];
      const hit = tabs.find((el) => (el.textContent || "").trim() === ${JSON.stringify(label)});
      const view = document.querySelector(${JSON.stringify(root)});
      if (!hit || !view) return null;
      if (hit.getAttribute("aria-selected") !== "true") return null;
      return { ok: true, labels: tabs.map((el) => (el.textContent || "").trim()), text: (document.querySelector(${JSON.stringify(root)})?.innerText || "").slice(0, 160) };
    }`,
    PAGE_WAIT_MS,
  );
}

/**
 * 页签开出来不等于读到了东西：.net-loading 还在就是还在转圈。
 * 等它消失再取样，空态和错误态都算「读完了」，错误态单独把原文带回来。
 */
function waitSettled(root) {
  return waitExpression(
    `() => () => {
      const view = document.querySelector(${JSON.stringify(root)});
      if (!view) return null;
      if (view.querySelector(".net-loading")) return null;
      const alert = view.querySelector(".net-view__error");
      return { settled: true, errorText: alert ? (alert.innerText || "").trim() : null, text: (view.innerText || "").slice(0, 200) };
    }`,
    15_000,
  );
}

async function main() {
  const shots = path.resolve(process.argv[2] ?? DEFAULT_SHOTS);
  const profile = assertSafeProfile(PROFILE);
  fs.rmSync(profile, { recursive: true, force: true });
  fs.mkdirSync(profile, { recursive: true });
  fs.mkdirSync(shots, { recursive: true });

  const electronBin = createRequire(import.meta.url)("electron");
  // 会话环境里可能带着 ELECTRON_RUN_AS_NODE=1：那样 electron 会把自己当 node 跑，
  // 主进程一 require("electron") 就拿到 undefined。子进程必须把这条剥掉。
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electronBin, [".", `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const appLog = [];
  child.stdout.on("data", (b) => appLog.push(String(b)));
  child.stderr.on("data", (b) => appLog.push(String(b)));

  const report = { started_at: new Date().toISOString(), tabs: [], shots: {} };
  try {
    step("等欢迎闸门 target");
    const gateTarget = await findTarget((url) => url.includes("onboarding=1"), 150_000);
    if (!gateTarget) throw new Error(`没等到欢迎闸门；app 输出：\n${appLog.join("").slice(-2000)}`);
    const gate = await attach(gateTarget);
    step("等欢迎页主按钮上屏");
    await evaluate(
      gate,
      waitExpression(`() => () => document.querySelector(".cy-onboarding__button--primary") ? true : null`, PAGE_WAIT_MS),
      { awaitPromise: true },
    );
    step("点欢迎页主按钮（去看条款）");
    if (!(await click(gate, ".cy-onboarding__button--primary"))) throw new Error("欢迎页没有主按钮");
    await evaluate(
      gate,
      waitExpression(`() => () => document.querySelector(".cy-onboarding__actions .cy-onboarding__button--primary") ? true : null`, PAGE_WAIT_MS),
      { awaitPromise: true },
    );
    step("点「接受并继续」");
    await clickThatNavigates(gate, ".cy-onboarding__actions .cy-onboarding__button--primary");

    step("等主窗 target");
    const chatTarget = await findTarget((url) => url.includes("/react/index.html") && !url.includes("onboarding=1"), 120_000);
    if (!chatTarget) throw new Error(`点完同意没等到主窗 target；app 输出：\n${appLog.join("").slice(-2000)}`);
    const page = await attach(chatTarget);
    await evaluate(
      page,
      waitExpression(`() => () => !document.documentElement.hasAttribute("data-ui-theme-pending") ? true : null`, PAGE_WAIT_MS),
      { awaitPromise: true },
    );

    step("从侧栏打开「网络」");
    const opened = await evaluate(
      page,
      waitExpression(
        `() => () => {
          const buttons = [...document.querySelectorAll("button.cy-side-action")];
          const hit = buttons.find((el) => ["网络", "Network", "ネットワーク"].includes((el.getAttribute("title") || "").trim()));
          if (!hit) return null;
          hit.click();
          return { ok: true, titles: buttons.map((el) => (el.getAttribute("title") || "").trim()) };
        }`,
        PAGE_WAIT_MS,
      ),
      { awaitPromise: true },
    );
    report.sideActions = opened.titles;

    step("等页签栏（7 个）与默认概览");
    const shell = await evaluate(
      page,
      waitExpression(
        `() => () => {
          const tabs = [...document.querySelectorAll(".net-tabs [role='tab']")];
          if (tabs.length !== 7) return null;
          if (!document.querySelector(".net-hero")) return null;
          return { labels: tabs.map((el) => (el.textContent || "").trim()), icon: document.querySelectorAll(".net-tab--icon").length };
        }`,
        PAGE_WAIT_MS,
      ),
      { awaitPromise: true },
    );
    // 面板自己拿到的快照：controller.reason 直接说明「读不到内核」是连不上还是 IPC 被挡。
    report.snapshot = await evaluate(
      page,
      `window.verge?.network ? window.verge.network.get().then((s) => ({ ok: true, controller: s.controller })).catch((error) => ({ ok: false, error: String(error) })) : { ok: false, error: "window.verge.network 不存在" }`,
      { awaitPromise: true },
    );
    const expected = ["概览", "节点", "规则", "日志", "连接", "入站", ""];
    if (JSON.stringify(shell.labels) !== JSON.stringify(expected)) {
      throw new Error(`页签文案不对：${JSON.stringify(shell.labels)}`);
    }
    if (shell.icon !== 1) throw new Error(`齿轮页签不见了（.net-tab--icon=${shell.icon}）`);
    const overview = await evaluate(page, waitSettled(".net-hero"), { awaitPromise: true });
    report.tabs.push({ label: "概览", root: ".net-hero", via: "默认", text: overview.text, errorText: overview.errorText });
    await shoot(page, shots, "01-overview.png");
    report.shots["01-overview.png"] = true;
    step("默认概览：在且读完");

    for (const tab of BODY_TABS.slice(1)) {
      const label = tab.label;
      step(`点开「${label}」`);
      let view;
      if (tab.gear) {
        const gear = await evaluate(
          page,
          `(() => { const el = document.querySelector(".net-tab--icon"); if (!el) return false; el.click(); return true; })()`,
        );
        if (!gear) throw new Error("齿轮页签点不到");
        view = await evaluate(page, waitGearOpen(), { awaitPromise: true });
      } else {
        const clicked = await evaluate(page, clickTab(label), { awaitPromise: true });
        if (!clicked?.ok) throw new Error(`页签「${label}」不在：${JSON.stringify(clicked?.labels)}`);
        view = await evaluate(page, waitTabOpen(label, tab.root), { awaitPromise: true });
      }
      const settled = await evaluate(page, waitSettled(tab.root), { awaitPromise: true });
      report.tabs.push({ label, root: tab.root, text: settled.text, errorText: settled.errorText });
      await shoot(page, shots, tab.file);
      report.shots[tab.file] = true;
      step(`「${label}」在且读完（${settled.text.replace(/\s+/g, " ").slice(0, 60)}）`);
    }

    const errored = report.tabs.filter((tab) => tab.errorText);
    if (errored.length > 0) {
      throw new Error(`页签读完落在错误态：${errored.map((tab) => `${tab.label}→${tab.errorText.replace(/\s+/g, " ")}`).join("；")}`);
    }

    step("回到概览收尾");
    await evaluate(page, clickTab("概览"), { awaitPromise: true });
    await evaluate(page, waitTabOpen("概览", ".net-hero"), { awaitPromise: true });

    report.ok = true;
    report.appLogTail = appLog.join("").slice(-1500);
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    report.ok = false;
    report.error = String(error?.message ?? error);
    console.error(`[network-tabs-cdp] FAIL: ${report.error}`);
    console.error(`[network-tabs-cdp] app 输出尾部：\n${appLog.join("").slice(-3000)}`);
    process.exitCode = 1;
  } finally {
    child.kill();
  }
}

main();
