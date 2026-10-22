// README 用图生成器：拍当前构建的**干净**窗口照（无验收档的内部会话标题）。
// 与 p4-cdp-capture.mjs 的区别只有两处：会话夹具用中性文案、输出整窗而非量尺取样框。
// 场景全部走用户真能走的路：欢迎闸门点同意 → 侧栏点开会话 → 设置页切主题。
//
// 用法：node scripts/verify/p4-readme-shots.mjs <outDir>
// 只允许写在 D:\cyrene-p4-accept\ 下的一次性 profile，绝不碰 %APPDATA%。
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const PROFILE = "D:\\cyrene-p4-accept\\profile-readme";
const DEBUG_PORT = 9338;
const SESSION_ID = "mochi-readme";
const PAGE_WAIT_MS = 30_000;
let stepNo = 0;
function step(label) {
  console.log(`[p4-readme-shots] → ${++stepNo} ${label}`);
}

function assertSafeProfile(dir) {
  const normalized = path.resolve(dir).toLowerCase();
  if (!normalized.startsWith("d:\\cyrene-p4-accept")) {
    throw new Error(`profile 必须落在 D:\\cyrene-p4-accept 下，收到 ${dir}`);
  }
  return normalized;
}

/** 会话夹具：走应用自己的导入路径落库（schema_migrations=100 分支）。文案是中性闲聊，不是验收术语。 */
function writeFixtureSession(profileDir) {
  const at = Date.now() - 60_000;
  const record = {
    id: SESSION_ID,
    title: "和麻糬聊天",
    identityId: null,
    mode: "chat",
    pinned: true,
    schemaVersion: 1,
    createdAt: at,
    updatedAt: at + 2000,
    messages: [
      { id: "m-u1", role: "user", content: "今天有点累。", at },
      { id: "m-a1", role: "model", content: "那就把爪子搭在桌沿上歇一会儿，剩下的事不着急。", at: at + 1000, answersUserMessageId: "m-u1" },
      { id: "m-a2", role: "model", content: "", sticker: "serious", at: at + 2000, answersUserMessageId: "m-u1" },
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

async function shoot(session, outDir, name) {
  const { data } = await session.send("Page.captureScreenshot", { format: "png" });
  const file = path.join(outDir, name);
  fs.writeFileSync(file, Buffer.from(data, "base64"));
  return file;
}

async function click(session, selector) {
  return evaluate(
    session,
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`,
  );
}

/** 点下去会导航走的按钮：导航会吞掉回音，只给 5s 并把超时放行。 */
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

async function main() {
  const outArg = process.argv[2];
  if (!outArg) throw new Error("用法：node scripts/verify/p4-readme-shots.mjs <outDir>");
  const out = path.resolve(outArg);
  const profile = assertSafeProfile(PROFILE);
  fs.rmSync(profile, { recursive: true, force: true });
  fs.mkdirSync(profile, { recursive: true });
  fs.mkdirSync(out, { recursive: true });
  writeFixtureSession(profile);

  const electronBin = createRequire(import.meta.url)("electron");
  const child = spawn(electronBin, [".", `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const appLog = [];
  child.stdout.on("data", (b) => appLog.push(String(b)));
  child.stderr.on("data", (b) => appLog.push(String(b)));

  const meta = { captured_at: new Date().toISOString(), session_id: SESSION_ID, shots: {} };
  try {
    step("等欢迎闸门 target");
    const gateTarget = await findTarget((url) => url.includes("onboarding=1"), 150_000);
    if (!gateTarget) throw new Error(`没等到欢迎闸门；app 输出：\n${appLog.join("").slice(-2000)}`);
    const gate = await attach(gateTarget);
    step("等欢迎页主按钮挂载");
    await evaluate(
      gate,
      waitExpression(`() => () => document.querySelector(".cy-onboarding__button--primary") ? true : null`, PAGE_WAIT_MS),
      { awaitPromise: true },
    );
    step("点欢迎页主按钮（去看条款）");
    if (!(await click(gate, ".cy-onboarding__button--primary"))) throw new Error("欢迎页没有主按钮");
    step("等条款页 footer 主按钮");
    await evaluate(
      gate,
      waitExpression(`() => () => document.querySelector(".cy-onboarding__actions .cy-onboarding__button--primary") ? true : null`, PAGE_WAIT_MS),
      { awaitPromise: true },
    );
    step("点「接受并继续」（这一步会把闸门页导航走，不等回音）");
    await clickThatNavigates(gate, ".cy-onboarding__actions .cy-onboarding__button--primary");

    step("等主窗 target");
    const chatTarget = await findTarget((url) => url.includes("/react/index.html") && !url.includes("onboarding=1"), 120_000);
    if (!chatTarget) throw new Error(`点完同意没等到主窗 target；app 输出：\n${appLog.join("").slice(-2000)}`);
    const page = await attach(chatTarget);
    step("等主题闸门摘掉（data-ui-theme-pending）");
    await evaluate(
      page,
      waitExpression(`() => () => !document.documentElement.hasAttribute("data-ui-theme-pending") ? true : null`, PAGE_WAIT_MS),
      { awaitPromise: true },
    );

    step("在侧栏找夹具会话并点开");
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
    if (!opened.ok) throw new Error(`侧栏里没有夹具会话（data-session-id=${SESSION_ID}）`);
    step(`已点开「${opened.title}」，等它的回复上屏`);
    await evaluate(
      page,
      waitExpression(`() => () => document.body.innerText.includes("剩下的事不着急") ? true : null`, PAGE_WAIT_MS),
      { awaitPromise: true },
    );
    // 气泡与头像挂着入场动效，冻在第 0 帧再拍，免得拍到半途的位移。
    await evaluate(page, `(() => { const all = document.getAnimations(); all.forEach((a) => { a.pause(); try { a.currentTime = 0; } catch {} }); return all.length; })()`);
    step("拍珍珠白整窗");
    meta.shots["chat-pearl.png"] = await shoot(page, out, "chat-pearl.png");

    // 各会话模式的窗口照：只切顶部模式分段项，不触发任何模型调用。
    // 拍不到就不拍——README 宁可少一张图，也不要一张编出来的图。
    for (const mode of ["work", "code", "learn"]) {
      step(`切到 ${mode} 模式`);
      // ModeSwitch 是 Mantine SegmentedControl：真正触发 onChange 的是它内部的 radio，
      // label 只是外观。点 radio 才是「用户点的那一下」。
      const hit = await evaluate(
        page,
        `(() => {
          const input = document.querySelector('input[name="conversation-mode"][value=${JSON.stringify(mode)}]');
          if (input) { input.click(); return { ok: true, via: "radio" }; }
          const label = [...document.querySelectorAll(".cy-mode-switch__label")]
            .find((el) => (el.textContent || "").trim() === ${JSON.stringify(mode)});
          if (label) { label.click(); return { ok: true, via: "label" }; }
          return { ok: false, seen: [...document.querySelectorAll(".cy-mode-switch__label")].map((el) => (el.textContent || "").trim()) };
        })()`,
      ).catch(() => ({ ok: false, seen: [] }));
      if (!hit.ok) {
        meta.shots[`mode-${mode}.png`] = "SKIPPED: 找不到该模式分段项";
        continue;
      }
      await new Promise((r) => setTimeout(r, 1500));
      const onScreen = await evaluate(
        page,
        waitExpression(
          `() => () => {
            const view = document.querySelector(".cy-app-router__view");
            return view && !view.className.includes("is-hidden") ? true : null;
          }`,
          15_000,
        ),
        { awaitPromise: true },
      ).catch(() => null);
      if (!onScreen) {
        meta.shots[`mode-${mode}.png`] = "SKIPPED: 模式视图没挂上";
        continue;
      }
      await evaluate(page, `(() => { const all = document.getAnimations(); all.forEach((a) => { a.pause(); try { a.currentTime = 0; } catch {} }); return all.length; })()`);
      meta.shots[`mode-${mode}.png`] = await shoot(page, out, `mode-${mode}.png`);
    }
    step("切回 Chat 模式");
    await evaluate(
      page,
      `(() => { const input = document.querySelector('input[name="conversation-mode"][value="chat"]'); if (input) input.click(); return true; })()`,
    ).catch(() => null);
    await new Promise((r) => setTimeout(r, 800));

    step("进设置页切「经典深色」");
    if (!(await click(page, ".cy-settings-btn"))) throw new Error("没有设置入口 .cy-settings-btn");
    await evaluate(
      page,
      waitExpression(`() => () => document.querySelector(".cy-settings-back") ? true : null`, PAGE_WAIT_MS),
      { awaitPromise: true },
    );
    const segmented = await clickByText(page, ".ant-segmented-item", "经典深色");
    if (!segmented.ok) throw new Error(`找不到「经典深色」这一档；分段项文本：${JSON.stringify(segmented.seen)}`);
    await evaluate(
      page,
      waitExpression(`() => () => document.documentElement.dataset.uiTheme === "charcoal-pink" ? true : null`, 20_000),
      { awaitPromise: true },
    );
    step("返回工作台");
    await click(page, ".cy-settings-back");
    await evaluate(
      page,
      waitExpression(
        `() => () => {
          const view = document.querySelector(".cy-app-router__view");
          return view && !view.className.includes("is-hidden") && !view.inert ? true : null;
        }`,
        20_000,
      ),
      { awaitPromise: true },
    );
    await evaluate(page, `(() => { const all = document.getAnimations(); all.forEach((a) => { a.pause(); try { a.currentTime = 0; } catch {} }); return all.length; })()`);
    step("拍炭黑整窗");
    meta.shots["chat-charcoal.png"] = await shoot(page, out, "chat-charcoal.png");

    fs.writeFileSync(path.join(out, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`, "utf8");
    console.log(`[p4-readme-shots] chat-pearl/chat-charcoal + meta.json -> ${out}`);
  } catch (error) {
    fs.writeFileSync(path.join(out, "capture-error.txt"), `${error && error.stack ? error.stack : error}\n\napp log:\n${appLog.join("")}`, "utf8");
    throw error;
  } finally {
    child.kill();
    await new Promise((r) => setTimeout(r, 800));
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}

main().catch((error) => {
  console.error(`[p4-readme-shots] FAIL（停在第 ${stepNo} 步）${error && error.stack ? error.stack : error}`);
  process.exitCode = 1;
});
