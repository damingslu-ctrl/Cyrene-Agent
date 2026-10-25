// 猫娘专项真窗验收（CDP）：存在感 / 「！」 / 三区 / 脸红 / 连点眩晕 / 静息。
// 用法：node scripts/verify/pet-girl-cdp.mjs <shotsDir>
//
// 只读只点自家宠物窗：探针通过 `window.__cyrene.renderer.tapAt` 喂**窗口内坐标**，
// 不移动系统光标、不点任何外部窗口（真光标会点掉用户的东西，这一条永远不做）。
// 注视同理：先 `setGazeFrozen(true)` 停掉真实光标轮询，再手动 setGazeTarget。
//
// 判据全部读渲染器自己报的同源读数（getPetDiagnostics().girl）：
// - 注视：把目标放到头心左侧 130px，1.1s 后 leanDeg < -1.5 且 facing 翻到 -1；
//   撤掉目标 0.8s 后回到 0；
// - 「！」：把目标贴到头心，noticeAgeMs 落在 [0, 1800] 且引擎真的排了台词；
// - 三区：点头 → coverFace/shy 且脸红上升；点脚 → shiver/wink；
// - 连点：2.4s 内第四下 → dizzyLeft > 2500、星记号 ≥ 12 笔、姿势片切到 shy；
// - 静息：最后一次互动 40s 后自己坐下，片名是 sit（最多等 56s）。
// 任一条不成立就红；环境问题（没窗/没墨）报 ENV，不冒充产品红。
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const PROFILE = "D:\\cyrene-p5-accept\\profile-girl";
const DEBUG_PORT = 9337;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** 探针自己的 Electron 子进程；任何失败路径都要带走它，别留一只无头猫占着端口。 */
let activeChild = null;

function assertSafeProfile(dir) {
  const normalized = path.resolve(dir).toLowerCase();
  if (!normalized.startsWith("d:\\cyrene-p5-accept")) {
    throw new Error(`profile 必须落在 D:\\cyrene-p5-accept 下，收到 ${dir}`);
  }
  return normalized;
}

function writeProfileState(profileDir) {
  const dir = path.join(profileDir, "verge");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify({ form: "girl", tier: "standard" }, null, 2), "utf8");
  const disclaimerSrc = fs.readFileSync(path.join(ROOT, "src/shared/disclaimer.ts"), "utf8");
  const version = disclaimerSrc.match(/CURRENT_DISCLAIMER_VERSION\s*=\s*"([^"]+)"/)?.[1];
  if (!version) throw new Error("[ENV] 读不出 CURRENT_DISCLAIMER_VERSION，无法准备 profile");
  fs.writeFileSync(path.join(profileDir, "app-settings.json"), JSON.stringify({
    petVisible: true,
    disclaimerAcceptedVersion: version,
  }, null, 2), "utf8");
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
        reject(new Error(`CDP ${method} 在 ${timeoutMs}ms 内没回话`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { try { this.ws.close(); } catch {} }
}

async function evaluate(session, expression, timeoutMs = 45_000) {
  const res = await session.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: false }, timeoutMs);
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text);
  return res.result.value;
}

async function findPetTarget(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      for (const t of (await res.json()).filter((x) => x.type === "page" && x.webSocketDebuggerUrl)) {
        let s;
        try {
          s = new Session(t.webSocketDebuggerUrl);
          await s.open();
          const hit = await evaluate(s, `!!document.getElementById("pet-canvas") && !!window.__cyrene`, 4_000);
          if (hit) return { target: t, session: s };
          s.close();
        } catch { s?.close(); }
      }
    } catch { /* 端口还没起来 */ }
    if (Date.now() > deadline) return null;
    await wait(400);
  }
}

function dumpAndKill(child, appLog, why) {
  try { child.kill(); } catch {}
  console.error(`[ENV] ${why}`);
  console.error(appLog.join("").slice(-3000));
  process.exitCode = 2;
  throw new Error(why);
}

async function rmProfile(dir) {
  for (let i = 0; i < 30; i++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (e) {
      if (e.code !== "EPERM" && e.code !== "EBUSY") throw e;
      await wait(500);
    }
  }
  throw new Error(`[ENV] 清不掉 ${dir}：上一个 Electron 进程还占着它（ENV 红，不是产品红）`);
}

async function waitPetInk(session, timeoutMs, appLog, child) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const ink = await evaluate(session, `(() => {
      const c = document.getElementById("pet-canvas");
      if (!c) return 0;
      const d = c.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] >= 10) n++;
      return n;
    })()`, 10_000).catch(() => 0);
    if (ink > 0) return true;
    if (Date.now() > deadline) return false;
    await wait(400);
  }
}

async function main() {
  const shotsArg = process.argv[2];
  if (!shotsArg) throw new Error("用法：node scripts/verify/pet-girl-cdp.mjs <shotsDir>");
  const shots = path.resolve(shotsArg);
  fs.mkdirSync(shots, { recursive: true });
  const profile = assertSafeProfile(PROFILE);
  await rmProfile(profile);
  fs.mkdirSync(profile, { recursive: true });
  writeProfileState(profile);

  const electronBin = createRequire(import.meta.url)("electron");
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electronBin, [".", `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`], {
    cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], env,
  });
  activeChild = child;
  const appLog = [];
  child.stdout.on("data", (b) => appLog.push(String(b)));
  child.stderr.on("data", (b) => appLog.push(String(b)));

  const found = await findPetTarget(150_000);
  if (!found) dumpAndKill(child, appLog, "没等到猫窗：ENV 红，不是产品红");
  const s = found.session;
  if (!(await waitPetInk(s, 30_000, appLog, child))) {
    dumpAndKill(child, appLog, "猫窗 30s 内没现身（ENV：启动动画没让位，不是产品红）");
  }
  await wait(1_500);

  const diag = () => evaluate(s, `window.__cyrene.getPetDiagnostics()`);
  const snap = () => evaluate(s, `window.__cyrene.renderer.getCompanionSnapshot()`);
  const setGaze = (x, y) => evaluate(s, `window.__cyrene.renderer.setGazeTarget(${x === null ? "null" : `[${x}, ${y}]`})`);
  // 命中尺一次都不许缓存：气泡换向（growLeft）会把猫在窗内的落点挪 bubbleWidth−base，
  // 旧坐标就落在框外了。每一下点击/注视前现读。
  const readGeo = async () => {
    const g = await evaluate(s, `(() => {
      const d = window.__cyrene.getPetDiagnostics();
      return { d, innerWidth: window.innerWidth, canvasWidth: document.getElementById("pet-canvas")?.clientWidth ?? 0 };
    })()`);
    const l = g.d.hitRect;
    const zoom = g.d.layout.zoom;
    if (typeof zoom !== "number" || !(zoom > 0)) {
      throw new Error(`[ENV] 渲染器没报 layout.zoom（拿到 ${JSON.stringify(zoom)}）：旧构建，不是产品红`);
    }
    return {
      d: g.d, hit: l, zoom, innerWidth: g.innerWidth, canvasWidth: g.canvasWidth,
      headX: l.x + l.width / 2, headY: l.y + l.height * 0.2,
      bodyY: l.y + l.height * 0.55, feetY: l.y + l.height * 0.85,
    };
  };
  const shot = async (name) => {
    const r = await s.send("Page.captureScreenshot", { format: "png" }, 20_000);
    fs.writeFileSync(path.join(shots, name), Buffer.from(r.data, "base64"));
  };
  const results = {};
  const checks = [];
  const check = (name, ok, detail) => {
    checks.push({ name, ok, detail });
    if (!ok) process.exitCode = 1;
  };
  const waitActivity = async (want, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const n = await snap();
      if (n.activity === want) return n;
      if (Date.now() > deadline) return n;
      await wait(200);
    }
  };

  // 冻结真实光标：探针不能移用户的鼠标，手动目标必须不被 120ms 轮询盖掉。
  await evaluate(s, `window.__cyrene.setGazeFrozen(true)`);
  await wait(600);
  const probeGeo = await readGeo();
  if (probeGeo.d.form !== "girl" || probeGeo.d.tier !== "standard") {
    dumpAndKill(child, appLog, `窗内形态是 ${probeGeo.d.form}/${probeGeo.d.tier}，切档没生效（ENV/接线，不是画错了）`);
  }
  results.geometry = {
    hitRect: probeGeo.hit, zoom: probeGeo.zoom,
    innerWidth: probeGeo.innerWidth, canvasWidth: probeGeo.canvasWidth,
    headX: probeGeo.headX, headY: probeGeo.headY, bodyY: probeGeo.bodyY, feetY: probeGeo.feetY,
  };
  await waitActivity("idle", 15_000);
  results.baseline = await diag();
  await shot("girl-baseline.png");

  // —— A. 注视存在感：目标放左侧 130px ——
  let g = await readGeo();
  await setGaze((g.headX - 130) * g.zoom, g.headY * g.zoom);
  await wait(1_100);
  const lean = await diag();
  results.lean = lean.girl;
  await shot("girl-lean-left.png");
  check("lean.left", lean.girl.presence.leanDeg < -1.5, `leanDeg=${lean.girl.presence.leanDeg.toFixed(2)}`);
  check("lean.shift", lean.girl.presence.shiftX < -0.4, `shiftX=${lean.girl.presence.shiftX.toFixed(2)}`);
  check("lean.facing", lean.girl.presence.facing === -1, `facing=${lean.girl.presence.facing}`);

  await setGaze(null);
  await wait(800);
  const released = await diag();
  results.leanReleased = released.girl;
  check("lean.release", Math.abs(released.girl.presence.leanDeg) < 0.5,
    `leanDeg=${released.girl.presence.leanDeg.toFixed(2)}`);

  // —— B. 「！」边沿：贴到脸上 ——
  g = await readGeo();
  await setGaze(g.headX * g.zoom, g.headY * g.zoom);
  await wait(420);
  const noticed = await diag();
  const noticedSnap = await snap();
  results.notice = { girl: noticed.girl, bubble: noticedSnap.bubble };
  await shot("girl-notice.png");
  check("notice.age", noticed.girl.noticeAgeMs >= 0 && noticed.girl.noticeAgeMs <= 1_800,
    `noticeAgeMs=${noticed.girl.noticeAgeMs}`);
  check("notice.bubble", !!noticedSnap.bubble && noticedSnap.bubble.text.length > 0,
    `bubble=${noticedSnap.bubble?.text ?? "null"}`);
  await setGaze(null);

  // —— C. 三区：点头（coverFace/shy）与点脚（shiver/wink）——
  const tapAt = (x, y) => evaluate(s, `window.__cyrene.renderer.tapAt(${x}, ${y}, 40)`);
  g = await readGeo();
  await tapAt(g.headX * g.zoom, g.headY * g.zoom);
  // shy / wink 都只有 9 帧（24fps ≈ 375ms）：450ms 时早已回到基础段（happy/idle）。
  // 验收要量的是「点到头有没有演那一段」，取样窗必须落在段内。
  await wait(200);
  const head = await diag();
  const headSnap = await snap();
  results.headTap = { girl: head.girl, gesture: headSnap.gesture };
  await shot("girl-head-tap.png");
  check("zone.head.clip", head.girl.clip === "shy", `clip=${head.girl.clip}`);
  check("zone.head.gesture", headSnap.gesture === "coverFace", `gesture=${headSnap.gesture}`);
  check("zone.head.blush", head.girl.blush > 0.3, `blush=${head.girl.blush.toFixed(2)}`);

  await wait(1_500);
  g = await readGeo();
  await tapAt(g.headX * g.zoom, g.feetY * g.zoom);
  await wait(200);
  const feet = await diag();
  const feetSnap = await snap();
  results.feetTap = { girl: feet.girl, gesture: feetSnap.gesture };
  await shot("girl-feet-tap.png");
  check("zone.feet.clip", feet.girl.clip === "wink", `clip=${feet.girl.clip}`);
  check("zone.feet.gesture", feetSnap.gesture === "shiver", `gesture=${feetSnap.gesture}`);
  // 点脚是新的一句：屏幕上不许还挂着摸头那句话（同级可顶，见 companion.say）。
  check("zone.feet.bubble", !!feetSnap.bubble && feetSnap.bubble.text !== headSnap.bubble?.text,
    `head=${headSnap.bubble?.text ?? "null"} feet=${feetSnap.bubble?.text ?? "null"}`);

  // —— D. 连点眩晕：等上一轮 tap 出窗（2.4s）再连点四下 ——
  // 200ms 取样窗 + 截图后，距点脚只剩 ~1.9s：不补足 2.4s 会把那一下算进连点。
  await wait(2_600);
  for (let i = 0; i < 4; i++) {
    g = await readGeo();
    await tapAt(g.headX * g.zoom, g.bodyY * g.zoom);
    await wait(120);
  }
  await wait(300);
  const dizzy = await diag();
  const dizzySnap = await snap();
  results.dizzy = { girl: dizzy.girl, activity: dizzySnap.activity, dizzyLeft: dizzySnap.dizzyLeft };
  await shot("girl-dizzy.png");
  check("dizzy.left", dizzy.girl.dizzyLeft > 2_500, `dizzyLeft=${dizzy.girl.dizzyLeft}`);
  check("dizzy.stars", dizzy.girl.fx.above >= 12, `above=${dizzy.girl.fx.above}`);
  check("dizzy.still", dizzySnap.activity === "idle", `activity=${dizzySnap.activity}`);

  await wait(4_200);
  const settled = await diag();
  results.dizzyEnded = settled.girl;
  check("dizzy.ended", settled.girl.dizzyLeft === 0, `dizzyLeft=${settled.girl.dizzyLeft}`);

  // —— E. 静息：最后一次互动 40s 后坐下（引擎是唯一计时权威，这里只等）——
  // 探针不动真光标，但真光标可能正好压在窗上（userActive=true 会按设计延后坐下）。
  // 这是一次性清场，不是绕过产品判据：之后再没有 pointer 事件进来。
  await evaluate(s, `window.__cyrene.renderer.setUserActive(false)`);
  const restDeadline = Date.now() + 56_000;
  let restSnap = null;
  let restDiag = null;
  let lastSeen = null;
  while (Date.now() < restDeadline) {
    const n = await snap();
    lastSeen = { activity: n.activity, dizzyLeft: n.dizzyLeft, gesture: n.gesture, bubble: n.bubble?.text ?? null };
    if (n.activity === "rest") {
      restSnap = n;
      restDiag = await diag();
      break;
    }
    await wait(400);
  }
  results.rest = restSnap
    ? { activity: restSnap.activity, clip: restDiag.girl.clip }
    : { lastSeen };
  check("rest.starts", !!restSnap, restSnap ? "rest" : `56s 内没坐下；最后一次看到的快照=${JSON.stringify(lastSeen)}`);
  check("rest.clip", restDiag?.girl.clip === "sit", `clip=${restDiag?.girl.clip ?? "null"}`);
  if (restSnap) {
    // sit 段的头几帧还接近站姿：等半秒再截图，取到真的坐下去那一张。
    await wait(600);
    await shot("girl-rest.png");
  }

  const failed = checks.filter((c) => !c.ok);
  results.checks = checks;
  fs.writeFileSync(path.join(shots, "pet-girl-report.json"), JSON.stringify(results, null, 2), "utf8");
  console.log(JSON.stringify({ checks, geometry: results.geometry }, null, 2));
  s.close();
  child.kill();
  await wait(1_500);
  if (failed.length) {
    throw new Error(failed.map((f) => `${f.name}: ${f.detail}`).join("\n"));
  }
  console.log("all clear");
}

main().catch(async (error) => {
  try { activeChild?.kill(); } catch {}
  console.error(String(error?.stack ?? error));
  if (process.exitCode === undefined || process.exitCode === 0) process.exitCode = 1;
});
