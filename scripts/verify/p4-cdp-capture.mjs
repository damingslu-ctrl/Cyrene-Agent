// P4 Task 31 第二层的取样档：把四个画面拍成四张区域图，交给 p4-visual-oracle.mjs 量。
// 用法：node scripts/verify/p4-cdp-capture.mjs <shotsDir>
// - 只允许写在 D:\cyrene-p4-accept\ 下的一次性 profile，绝不碰 %APPDATA%。
// - 画面全部走用户真能走的路：欢迎闸门点确认、侧栏点开一条会话、设置页切主题。
//   不做 CSS 注入，也不从渲染层直调 IPC。
// - 会话内容是一份 v1 旧格式数据，靠应用自己的导入路径落库
//   （src/main/chats/chats-store-core.ts 的 schema_migrations=100 分支）。
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const PROFILE = "D:\\cyrene-p4-accept\\profile";
const DEBUG_PORT = 9333;
const SESSION_ID = "p4-accept-visual";
// 页面侧轮询的上限必须小于 CDP 单条命令的回音期限（45s），否则「条件没等出来」会先撞上
// 回音期限，报成「CDP 没回话」——那是尺子的故障措辞，会把产品问题掩盖成通讯问题。
const PAGE_WAIT_MS = 30_000;
let stepNo = 0;
function step(label) {
  console.log(`[p4-cdp-capture] → ${++stepNo} ${label}`);
}

function assertSafeProfile(dir) {
  const normalized = path.resolve(dir).toLowerCase();
  if (!normalized.startsWith("d:\\cyrene-p4-accept")) {
    throw new Error(`profile 必须落在 D:\\cyrene-p4-accept 下，收到 ${dir}`);
  }
  return normalized;
}

function writeFixtureSession(profileDir) {
  const at = Date.now() - 60_000;
  const record = {
    id: SESSION_ID,
    title: "P4 视觉验收",
    identityId: null,
    mode: "chat",
    pinned: true,
    schemaVersion: 1,
    createdAt: at,
    updatedAt: at + 2000,
    messages: [
      { id: "p4-u1", role: "user", content: "给我看看现在的样子。", at },
      { id: "p4-a1", role: "model", content: "我一直在这儿，毛色也换了。", at: at + 1000, answersUserMessageId: "p4-u1" },
      { id: "p4-a2", role: "model", content: "", sticker: "serious", at: at + 2000, answersUserMessageId: "p4-u1" },
    ],
  };
  const dir = path.join(profileDir, "cyrene-chats", "sessions");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${SESSION_ID}.json`), JSON.stringify(record, null, 2), "utf8");
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
      // 每条 CDP 命令都要有回音期限：target 被销毁（比如闸门页导航走了）之后，
      // Runtime.evaluate 永远不再返回，没有这一层就是无限挂死——
      // 尺子挂死绝不能读成 PASS，必须读成 FAIL。
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} 在 ${timeoutMs}ms 内没回话（多半是 target 已销毁或页面卡住）`));
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

/** 在页面里轮询一个返回「取到就给出、没取到就 null」的函数；超时即 reject，不把没拍到说成拍到了。 */
function waitExpression(pollFnSource, timeoutMs) {
  return `new Promise((resolve, reject) => {
    const poll = (${pollFnSource})();
    const started = performance.now();
    const tick = () => {
      let value;
      try { value = poll(); } catch (error) { reject(String(error)); return; }
      if (value) { resolve(value); return; }
      if (performance.now() - started > ${timeoutMs}) { reject("页面等待超时"); return; }
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

function rectExpression(source) {
  return waitExpression(
    `() => () => {
      const el = (${source});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width < 8 || (el instanceof HTMLImageElement && !el.complete)) return null;
      return { x: r.x, y: r.y, width: r.width, height: r.height, dpr: window.devicePixelRatio,
        src: el.currentSrc || el.src || null, theme: document.documentElement.dataset.uiTheme || null };
    }`,
    PAGE_WAIT_MS,
  );
}

/** clip = 元素框四周各留 pad 个 CSS 像素的背景，尺才量得到「圆遮罩外的面板」。 */
function clipOf(rect, pad = 16) {
  const x = Math.max(0, Math.floor(rect.x - pad));
  const y = Math.max(0, Math.floor(rect.y - pad));
  const right = Math.ceil(rect.x + rect.width) + (x > 0 ? pad : 0);
  const bottom = Math.ceil(rect.y + rect.height) + (y > 0 ? pad : 0);
  // clip 取整：区域图与 meta 里记录的框必须是同一个整数框，否则量到的像素对不上号。
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y), scale: 1 };
}

async function shoot(session, shots, name, clip) {
  const params = { format: "png" };
  if (clip) params.clip = clip;
  const { data } = await session.send("Page.captureScreenshot", params);
  const file = path.join(shots, name);
  fs.writeFileSync(file, Buffer.from(data, "base64"));
  return file;
}

async function click(session, selector) {
  return evaluate(
    session,
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`,
  );
}

/**
 * 「点下去会把页面导航走」的那类按钮：导航会吞掉这条 Runtime.evaluate 的回音，
 * 于是没有期限的尺子就挂死在已发出的命令上，报成通讯故障（Task 31 第二层第一次就折在这儿）。
 * 只给 5s 并把超时放行；「点没点着」由下一步的可观察后果来断言（主窗 target 出不出现）。
 */
async function clickThatNavigates(session, selector) {
  const hit = await evaluate(
    session,
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`,
    { timeoutMs: 5_000 },
  ).catch(() => null);
  if (hit === false) throw new Error(`没有可点的 ${selector}`);
  return hit === true;
}

async function clickByText(session, selector, text) {
  return evaluate(
    session,
    `(() => {
      const items = [...document.querySelectorAll(${JSON.stringify(selector)})];
      const hit = items.find((el) => (el.textContent || "").trim() === ${JSON.stringify(text)});
      if (!hit) return { ok: false, seen: items.map((el) => (el.textContent || "").trim()) };
      hit.click();
      return { ok: true, seen: items.map((el) => (el.textContent || "").trim()) };
    })()`,
  );
}

function freezeAnimations() {
  return `(() => {
    const all = document.getAnimations();
    all.forEach((a) => { a.pause(); try { a.currentTime = 0; } catch {} });
    return all.map((a) => a.animationName || "anonymous");
  })()`;
}

async function main() {
  const shotsArg = process.argv[2];
  if (!shotsArg) throw new Error("用法：node scripts/verify/p4-cdp-capture.mjs <shotsDir>");
  const shots = path.resolve(shotsArg);
  const profile = assertSafeProfile(PROFILE);
  fs.rmSync(profile, { recursive: true, force: true });
  fs.mkdirSync(profile, { recursive: true });
  fs.mkdirSync(shots, { recursive: true });
  writeFixtureSession(profile);

  const electronBin = createRequire(import.meta.url)("electron");
  const child = spawn(electronBin, [".", `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const appLog = [];
  child.stdout.on("data", (b) => appLog.push(String(b)));
  child.stderr.on("data", (b) => appLog.push(String(b)));

  const meta = { captured_at: new Date().toISOString(), session_id: SESSION_ID, shots: {}, states: {} };
  try {
    // ---- 闸门第一页：欢迎海报 ----
    step("等欢迎闸门 target");
    const gateTarget = await findTarget((url) => url.includes("onboarding=1"), 150_000);
    if (!gateTarget) throw new Error(`没等到欢迎闸门；app 输出：\n${appLog.join("").slice(-2000)}`);
    step(`连上门闸 target（${gateTarget.url}）`);
    const gate = await attach(gateTarget);
    const poster = await evaluate(gate, rectExpression(`document.querySelector(".cy-onboarding__poster")`), { awaitPromise: true });
    const welcomeClip = clipOf(poster, 8);
    meta.shots = { "welcome.png": { rect: poster, clip: welcomeClip } };
    meta.states.gate = { poster };
    step(`海报就位（${Math.round(poster.width)}x${Math.round(poster.height)}），拍 welcome`);
    await shoot(gate, shots, "welcome.png", welcomeClip);
    await shoot(gate, shots, "welcome-full.png", null);

    // 欢迎页主按钮只是「去看条款」，条款页 footer 里那颗才是「同意」。
    step("点欢迎页主按钮（去看条款）");
    if (!(await click(gate, ".cy-onboarding__button--primary"))) throw new Error("欢迎页没有主按钮");
    step("等条款页 footer 主按钮");
    await evaluate(gate, rectExpression(`document.querySelector(".cy-onboarding__actions .cy-onboarding__button--primary")`), { awaitPromise: true });
    step("点「接受并继续」（这一步会把闸门页导航走，不等回音）");
    const accepted = await clickThatNavigates(gate, ".cy-onboarding__actions .cy-onboarding__button--primary");
    step(`同意按钮已按下（回音=${accepted ? "收到" : "被导航吞掉，属预期"}）`);

    // ---- 主窗：从侧栏打开导入的会话 ----
    step("等主窗 target");
    const chatTarget = await findTarget((url) => url.includes("/react/index.html") && !url.includes("onboarding=1"), 120_000);
    if (!chatTarget) throw new Error(`点完同意没等到主窗 target；app 输出：\n${appLog.join("").slice(-2000)}`);
    step(`连上主窗 target（${chatTarget.url}）`);
    const page = await attach(chatTarget);
    step(`主窗可见性 = ${await evaluate(page, "document.visibilityState")}，等主题闸门摘掉`);
    // 闸门先过：`data-ui-theme-pending` 由 preload 桥回来的主题落地才摘，挂着就等于整棵 React 树没显示。
    await evaluate(
      page,
      waitExpression(`() => () => !document.documentElement.hasAttribute("data-ui-theme-pending") ? true : null`, PAGE_WAIT_MS),
      { awaitPromise: true },
    );
    /**
     * 侧栏那一行到底是哪个 DOM：生产里默认走 antd `Conversations`，行是
     * `li.ant-conversations-item[data-session-id]`；`.cy-sidebar-session` 只在项目分组视图里出现。
     * 写死后者就会等一个不存在的节点（Task 31 第二层第一次真跑挂在这儿，挂的是尺不是产品）。
     * 两种都认，谁在场点谁；点不到就报错，绝不把「没点开」拍成「拍到了」。
     */
    step("在侧栏找导入的那条会话并点开");
    const opened = await evaluate(
      page,
      waitExpression(
        `() => () => {
          const row = document.querySelector('[data-session-id=${JSON.stringify(SESSION_ID)}]')
            || document.querySelector('.cy-sidebar-session[data-session-id=${JSON.stringify(SESSION_ID)}]');
          if (!row) return null;
          row.click();
          return { ok: true, tag: row.tagName.toLowerCase(), title: (row.textContent || "").trim().slice(0, 40) };
        }`,
        PAGE_WAIT_MS,
      ),
      { awaitPromise: true },
    );
    if (!opened.ok) throw new Error(`侧栏里没有导入的那条会话（data-session-id=${SESSION_ID}）`);
    step(`已点开 ${opened.tag}「${opened.title}」，等它的回复上屏`);
    // 画面必须真的是导入的那一条：认它独有的那句回复。
    const onScreen = await evaluate(
      page,
      waitExpression(
        `() => () => document.body.innerText.includes("我一直在这儿，毛色也换了。") ? true : null`,
        PAGE_WAIT_MS,
      ),
      { awaitPromise: true },
    );
    if (!onScreen) throw new Error("点开之后画面里没有那条导入会话的回复");

    step("量头像与贴纸的框");
    const avatar = await evaluate(page, rectExpression(`document.querySelector(".cy-message--assistant .cy-message-avatar__image")`), { awaitPromise: true });
    const sticker = await evaluate(page, rectExpression(`document.querySelector(".cy-message__sticker")`), { awaitPromise: true });
    // 头像挂着 3s 的 cyrene-avatar-float（±3px translateY），取样前冻在第 0 帧。
    const animations = await evaluate(page, freezeAnimations());
    const avatarClip = clipOf(avatar);
    const stickerClip = clipOf(sticker);
    meta.states.pearl = { avatar, sticker, animations, opened };
    meta.shots["avatar-paper.png"] = { rect: avatar, clip: avatarClip };
    meta.shots["sticker.png"] = { rect: sticker, clip: stickerClip };
    step(`框就位（头像 ${Math.round(avatar.width)}x${Math.round(avatar.height)}，动效 ${animations.length} 条已冻），拍 pearl 三张`);
    await shoot(page, shots, "avatar-paper.png", avatarClip);
    await shoot(page, shots, "sticker.png", stickerClip);
    await shoot(page, shots, "pearl-full.png", null);

    // ---- 设置页切「经典深色」，回工作台再拍同一条消息 ----
    step("进设置页");
    if (!(await click(page, ".cy-settings-btn"))) throw new Error("没有设置入口 .cy-settings-btn");
    step("等设置页返回按钮（＝设置页已挂载）");
    await evaluate(page, rectExpression(`document.querySelector(".cy-settings-back")`), { awaitPromise: true });
    step("点分段项「经典深色」");
    const segmented = await clickByText(page, ".ant-segmented-item", "经典深色");
    if (!segmented.ok) throw new Error(`找不到「经典深色」这一档；分段项文本：${JSON.stringify(segmented.seen)}`);
    await evaluate(
      page,
      waitExpression(`() => () => document.documentElement.dataset.uiTheme === "charcoal-pink" ? true : null`, 20_000),
      { awaitPromise: true },
    );
    meta.states.segmented = segmented;
    step("返回工作台");
    await click(page, ".cy-settings-back");
    await evaluate(
      page,
      waitExpression(`() => () => {
        const view = document.querySelector(".cy-app-router__view");
        return view && !view.className.includes("is-hidden") && !view.inert ? true : null;
      }`, 20_000),
      { awaitPromise: true },
    );

    step("量深色下的头像框");
    const darkAvatar = await evaluate(page, rectExpression(`document.querySelector(".cy-message--assistant .cy-message-avatar__image")`), { awaitPromise: true });
    const darkAnimations = await evaluate(page, freezeAnimations());
    const darkClip = clipOf(darkAvatar);
    meta.states.charcoal = { avatar: darkAvatar, animations: darkAnimations, theme: darkAvatar.theme };
    meta.shots["avatar-ink.png"] = { rect: darkAvatar, clip: darkClip };
    step(`深色主题 = ${darkAvatar.theme}，拍 ink 两张`);
    await shoot(page, shots, "avatar-ink.png", darkClip);
    await shoot(page, shots, "charcoal-full.png", null);

    fs.writeFileSync(path.join(shots, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`, "utf8");
    console.log(`[p4-cdp-capture] welcome/avatar-paper/avatar-ink/sticker + meta.json -> ${shots}`);
  } catch (error) {
    fs.writeFileSync(path.join(shots, "capture-error.txt"), `${error && error.stack ? error.stack : error}\n\napp log:\n${appLog.join("")}`, "utf8");
    throw error;
  } finally {
    child.kill();
    await new Promise((r) => setTimeout(r, 800));
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}

main().catch((error) => {
  // 报出停在第几步：挂死的措辞（「CDP 没回话」）只有配上步号才知道是尺子哪一段坏了。
  console.error(`[p4-cdp-capture] FAIL（停在第 ${stepNo} 步）${error && error.stack ? error.stack : error}`);
  process.exitCode = 1;
});
