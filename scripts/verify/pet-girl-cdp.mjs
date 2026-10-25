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
// - 毛线球：诊断里有球；点它 → 球动、hop、说玩具台词、亲密度 +0.01；8s 内自己停下；
// - 摸头连击 / 羁绊：三下连续摸头 → patCombo ≥ 3、跨进「依赖」、升级记号在场，
//   状态卡四行同时报「依赖 · 第 N 天」，每行按真 Chromium 字宽量都 ≤ 78px 内宽；
// - 晨间：把墙上时钟拨到明天 08:00 → 她演伸懒腰，days 变 2 且问候句带「第 2 天」
//   （只改 Date.now，不动行为秒表）；
// - 惊醒：右键睡眠后点头 → startleLeft > 800、醒回 idle、说被吓到的台词；
// - 扑光标：冻结真实光标后手动甩两下（90ms / 170px）→ pounces +1、位置真的挪了；
// - 坐垫：rest 期间 cushion > 0.9，below 层多出坐垫笔数；
// - 深夜：卡在 30s 询问拍点前把时钟拨到 23:30 → 气泡出现深夜台词。
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

/** 从引擎源码读一份台词表：验收按表认句子，不在探针里另抄一份（改词就会一起红）。 */
function sourceLines(name) {
  const src = fs.readFileSync(path.join(ROOT, "src/renderer/pet/companion.ts"), "utf8");
  const body = src.match(new RegExp(`const\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\];`))?.[1];
  if (!body) throw new Error(`[ENV] 读不出 ${name}：验收句子表都没了，先看源码`);
  return [...body.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse(`"${m[1]}"`));
}

const TOY_LINES = sourceLines("GIRL_TOY_LINES");
const POUNCE_LINES = sourceLines("GIRL_POUNCE_LINES");
const WAKE_LINES = [...sourceLines("GIRL_WAKE_LINES"), ...sourceLines("GIRL_WAKE_NIGHT_LINES")];
const NIGHT_LINES = sourceLines("GIRL_NIGHT_LINES");

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
  const dismissBubble = () => evaluate(s, `window.__cyrene.renderer.dismissBubble()`);
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
  check("diag.new-fields",
    typeof settled.girl.nightCheckInMs === "number"
      && typeof settled.girl.pounces === "number"
      && typeof settled.girl.teasePending === "number",
    `nightCheckInMs=${settled.girl.nightCheckInMs} pounces=${settled.girl.pounces} tease=${settled.girl.teasePending}`);

  // —— F. 毛线球：先在、点它会滚、8s 内自己停下 ——
  // 眩晕台词是优先级 2、TTL 6s：不先清掉，玩具台词（1）根本顶不上去。
  await dismissBubble();
  await wait(250);
  const toyBase = await diag();
  const toyBefore = toyBase.girl.toy;
  const affinityBeforeToy = (await snap()).vitals.affinity;
  results.toy = { before: toyBefore };
  check("toy.exists", !!toyBefore, `toy=${JSON.stringify(toyBefore)}`);
  if (toyBefore) {
    await tapAt(toyBefore.x * probeGeo.zoom, toyBefore.y * probeGeo.zoom);
    await wait(260);
    const kicked = await diag();
    const kickedSnap = await snap();
    results.toy.kick = {
      toy: kicked.girl.toy,
      bubble: kickedSnap.bubble?.text ?? null,
      gesture: kickedSnap.gesture,
      activity: kickedSnap.activity,
      affinity: kickedSnap.vitals.affinity,
    };
    await shot("girl-toy-kick.png");
    check("toy.kick.moves",
      !!kicked.girl.toy && (!kicked.girl.toy.rest || Math.abs(kicked.girl.toy.x - toyBefore.x) > 6),
      `before=${JSON.stringify(toyBefore)} after=${JSON.stringify(kicked.girl.toy)}`);
    check("toy.kick.gesture", kickedSnap.gesture === "hop", `gesture=${kickedSnap.gesture}`);
    check("toy.kick.line", !!kickedSnap.bubble && TOY_LINES.includes(kickedSnap.bubble.text),
      `bubble=${kickedSnap.bubble?.text ?? "null"}`);
    check("toy.kick.affinity", kickedSnap.vitals.affinity > affinityBeforeToy + 0.004,
      `${affinityBeforeToy.toFixed(3)} → ${kickedSnap.vitals.affinity.toFixed(3)}`);

    let toyRest = null;
    const toyDeadline = Date.now() + 8_000;
    while (Date.now() < toyDeadline) {
      const n = await diag();
      if (n.girl.toy?.rest) { toyRest = n.girl.toy; break; }
      await wait(200);
    }
    results.toy.rest = toyRest;
    check("toy.settles", !!toyRest, toyRest ? `x=${toyRest.x.toFixed(1)} y=${toyRest.y.toFixed(1)}` : "8s 内没停下");
    if (toyRest) {
      check("toy.in-bounds", toyRest.x > 4 && toyRest.x < 80 && toyRest.y > 20 && toyRest.y < 108,
        `x=${toyRest.x.toFixed(1)} y=${toyRest.y.toFixed(1)}`);
    }
  }

  // —— G. 摸头连击 + 羁绊升档：0.5 起、已有一次摸头 +0.04 与挠脚 +0.03、球 +0.01，
  //       三下连击把亲密度推过 0.66 → 「依赖」。状态句同时报档位与相识天数。——
  await dismissBubble();
  await wait(250);
  let comboSnap = null;
  for (let i = 0; i < 3; i++) {
    g = await readGeo();
    await tapAt(g.headX * g.zoom, g.headY * g.zoom);
    // 650ms 合并窗：每下隔 760ms，既不被吞，第三下也仍在 3.2s 连击窗里。
    await wait(i === 2 ? 220 : 760);
  }
  comboSnap = await snap();
  const comboDiag = await diag();
  results.combo = {
    patCombo: comboSnap.patCombo, bond: comboSnap.bond, bondUpLeft: comboSnap.bondUpLeft,
    bubble: comboSnap.bubble?.text ?? null, fx: comboDiag.girl.fx,
    affinity: comboSnap.vitals.affinity,
  };
  await shot("girl-combo-bond.png");
  check("combo.count", comboSnap.patCombo >= 3, `patCombo=${comboSnap.patCombo}`);
  check("bond.tier", comboSnap.bond.id === "reliant", `bond=${comboSnap.bond.id}/${comboSnap.bond.name}`);
  check("bond.up", comboSnap.bondUpLeft > 600, `bondUpLeft=${Math.round(comboSnap.bondUpLeft)}`);
  check("bond.fx", comboDiag.girl.fx.above >= 3, `above=${comboDiag.girl.fx.above}`);

  await dismissBubble();
  await evaluate(s, `window.__cyrene.renderer.handleCommand("status")`);
  await wait(220);
  const statusSnap = await snap();
  results.status = { bubble: statusSnap.bubble?.text ?? null, bond: statusSnap.bond, days: statusSnap.days };
  check("status.bond", !!statusSnap.bubble && statusSnap.bubble.text.includes(statusSnap.bond.name),
    `bubble=${statusSnap.bubble?.text ?? "null"} bond=${statusSnap.bond.name}`);
  check("status.days", !!statusSnap.bubble && statusSnap.bubble.text.includes(`第 ${statusSnap.days} 天`),
    `bubble=${statusSnap.bubble?.text ?? "null"} days=${statusSnap.days}`);
  // 状态卡是四行小卡片（v1.8 尺 #62）：在真 Chromium 里按 9px sans-serif 量每一行，
  // 必须全落在 78px 内宽里——旧估算把 `·` 当 5.2px，句子真宽 78.3 被切在盒外。
  const statusText = statusSnap.bubble?.text ?? "";
  const statusFit = await evaluate(s, `(() => {
    const ctx = document.createElement("canvas").getContext("2d");
    ctx.font = "9px sans-serif";
    return ${JSON.stringify(statusText)}.split(String.fromCharCode(10))
      .map((line) => ({ line, w: +ctx.measureText(line).width.toFixed(2) }));
  })()`);
  results.status.fit = statusFit;
  check("status.lines", statusFit.length === 4, `lines=${statusFit.length}`);
  check("status.fits", statusFit.length > 0 && statusFit.every((l) => l.w <= 78),
    statusFit.map((l) => `${l.w}px「${l.line}」`).join(" / "));

  // —— H. 晨间伸懒腰：把**墙上时钟**拨到明天 08:00（行为秒表仍是 performance.now）。
  //       跨日让 morningKey 必不相同，顺带验「相识天数」从 1 变 2。
  //       她刚演完摸头（activity=pet）时不会被打断——这是产品规矩，探针要等回 idle。——
  {
    const idleDeadline = Date.now() + 6_000;
    while (Date.now() < idleDeadline) {
      const n = await snap();
      if (n.activity === "idle") break;
      await wait(120);
    }
  }
  const tomorrowMorning = new Date();
  tomorrowMorning.setDate(tomorrowMorning.getDate() + 1);
  tomorrowMorning.setHours(8, 0, 0, 0);
  const fakeMorningMs = tomorrowMorning.getTime();
  // 伸懒腰挂在 greet()（每天第一次露脸）而不是每帧：伪时钟和 greet 必须同一拍。
  await evaluate(s, `(() => {
    window.__realDateNow = Date.now;
    Date.now = () => ${fakeMorningMs};
    window.__cyrene.renderer.greet();
    return Date.now();
  })()`);
  await wait(320);
  const morning = await snap();
  // 上一句状态卡是优先级 2（同槽不降级），会压住晨间问候。先清槽再 greet 一次：
  // maybeMorningStretch 按日期去重，这一步只补台词，不会重演伸懒腰。
  await dismissBubble();
  await evaluate(s, `window.__cyrene.renderer.greet()`);
  await wait(220);
  const morningTalk = await snap();
  results.morning = {
    activity: morning.activity, days: morning.days,
    bubble: morningTalk.bubble?.text ?? null, talkActivity: morningTalk.activity,
  };
  await shot("girl-morning-stretch.png");
  check("morning.stretch", morning.activity === "stretch", `activity=${morning.activity}`);
  check("morning.days", morning.days === 2, `days=${morning.days}`);
  check("morning.line", !!morningTalk.bubble && morningTalk.bubble.text.includes("第 2 天"),
    `bubble=${morningTalk.bubble?.text ?? "null"}`);
  const morningText = morningTalk.bubble?.text ?? "";
  const morningFit = await evaluate(s, `(() => {
    const ctx = document.createElement("canvas").getContext("2d");
    ctx.font = "9px sans-serif";
    return ${JSON.stringify(morningText)}.split(String.fromCharCode(10))
      .map((line) => ({ line, w: +ctx.measureText(line).width.toFixed(2) }));
  })()`);
  results.morning.fit = morningFit;
  check("morning.lines", morningFit.length === 3, `lines=${morningFit.length}`);
  check("morning.fits", morningFit.length === 3 && morningFit.every((l) => l.w <= 78),
    morningFit.map((l) => `${l.w}px「${l.line}」`).join(" / "));
  await evaluate(s, `(() => { Date.now = window.__realDateNow; delete window.__realDateNow; })()`);

  // —— I. 惊醒：右键睡眠 → 点头。睡着时碰头走 startle，不走摸头反馈。——
  await dismissBubble();
  await evaluate(s, `window.__cyrene.renderer.handleCommand("toggle-sleep")`);
  await wait(400);
  const asleep = await snap();
  check("startle.sleep", asleep.activity === "sleep", `activity=${asleep.activity}`);
  g = await readGeo();
  await tapAt(g.headX * g.zoom, g.headY * g.zoom);
  await wait(180);
  const startled = await snap();
  const startledDiag = await diag();
  results.startle = {
    activity: startled.activity, gesture: startled.gesture, startleLeft: startled.startleLeft,
    bubble: startled.bubble?.text ?? null, clip: startledDiag.girl.clip,
  };
  await shot("girl-startle.png");
  check("startle.wakes", startled.activity === "idle", `activity=${startled.activity}`);
  check("startle.timer", startled.startleLeft > 800 || startledDiag.girl.startleLeft > 800,
    `snap=${Math.round(startled.startleLeft)} diag=${Math.round(startledDiag.girl.startleLeft)}`);
  check("startle.line", !!startled.bubble && WAKE_LINES.includes(startled.bubble.text),
    `bubble=${startled.bubble?.text ?? "null"}`);

  // —— J. 扑光标：冻结真实光标后手动甩三下（第一次只记基线，后两笔才算逗弄）。——
  // 先静默 >900ms，让上一笔落在窗口外——否则两次快速采样就会提前触发。
  await wait(1_000);
  await dismissBubble();
  g = await readGeo();
  const beforePounce = await snap();
  // 采样间隔必须 ≤240ms：CDP 往返会拖到 ~300ms，隐藏窗的 setTimeout 会被节流到
  // 数百 ms；用 80ms 忙等卡住同一拍，间隔只由页面内的 performance.now 决定。
  const pounceX1 = (g.headX - 120) * g.zoom;
  const pounceX2 = (g.headX + 50) * g.zoom;
  const pounceY = g.headY * g.zoom;
  await evaluate(s, `(() => {
    const r = window.__cyrene.renderer;
    const spin = (x) => {
      r.setGazeTarget([x, ${pounceY}]);
      const t0 = performance.now();
      while (performance.now() - t0 < 80) { /* 卡住 80ms，模拟快速甩手 */ }
    };
    spin(${pounceX1});
    spin(${pounceX2});
    spin(${pounceX1});
  })()`);
  await wait(400);
  const pounced = await snap();
  const pouncedDiag = await diag();
  results.pounce = {
    before: { x: beforePounce.pos.x, pounces: beforePounce.pounces, facing: beforePounce.facing },
    after: { x: pounced.pos.x, pounces: pounced.pounces, facing: pounced.facing },
    bubble: pounced.bubble?.text ?? null, gesture: pounced.gesture, teasePending: pouncedDiag.girl.teasePending,
  };
  await shot("girl-pounce.png");
  check("pounce.count", pounced.pounces === beforePounce.pounces + 1,
    `${beforePounce.pounces} → ${pounced.pounces}`);
  check("pounce.moved", pounced.pos.x !== beforePounce.pos.x, `x=${beforePounce.pos.x} → ${pounced.pos.x}`);
  check("pounce.line", !!pounced.bubble && POUNCE_LINES.includes(pounced.bubble.text),
    `bubble=${pounced.bubble?.text ?? "null"}`);
  check("pounce.tease-cleared", pouncedDiag.girl.teasePending === 0, `teasePending=${pouncedDiag.girl.teasePending}`);
  await setGaze(null);

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
    await wait(700);
    const cushioned = await diag();
    results.cushion = { cushion: cushioned.girl.cushion, below: cushioned.girl.fx.below, clip: cushioned.girl.clip };
    await shot("girl-rest.png");
    check("cushion.rises", cushioned.girl.cushion > 0.9, `cushion=${cushioned.girl.cushion.toFixed(2)}`);
    check("cushion.ink", cushioned.girl.fx.below >= 3, `below=${cushioned.girl.fx.below}`);
  }

  // —— K. 深夜提醒：等「距下一拍 <5s」，再把墙上时钟拨到明天 23:30。
  //        只拨 Date.now（引擎的 wallNow），行为秒表 performance.now 不动。 ——
  let nightBubble = null;
  let nightPhaseReady = false;
  if (restSnap) {
    const phaseDeadline = Date.now() + 32_000;
    while (Date.now() < phaseDeadline) {
      const d = await diag();
      if (d.girl.nightCheckInMs < 5_000) { nightPhaseReady = true; break; }
      await wait(150);
    }
    const nightAt = new Date();
    nightAt.setDate(nightAt.getDate() + 1);
    nightAt.setHours(23, 30, 0, 0);
    await dismissBubble();
    const preNight = await snap();
    if (preNight.activity === "sleep") {
      // 睡着时 nightNudge 按设计拒收：先叫醒，再考她「深夜会不会提醒」。
      await evaluate(s, `window.__cyrene.renderer.handleCommand("toggle-sleep")`);
      await wait(220);
    }
    await dismissBubble();
    await evaluate(s, `(() => { window.__realDateNowNight = Date.now; Date.now = () => ${nightAt.getTime()}; })()`);
    const nightDeadline = Date.now() + 6_000;
    while (Date.now() < nightDeadline) {
      const d = await snap();
      const text = d.bubble?.text ?? null;
      if (text && NIGHT_LINES.includes(text)) { nightBubble = text; break; }
      if (d.activity === "sleep") {
        await evaluate(s, `window.__cyrene.renderer.handleCommand("toggle-sleep")`);
      } else if (text) {
        // 占着话筒的自主碎碎念（优先级 1）会挡住夜间提醒（0）：清掉再等这一拍。
        await dismissBubble();
      }
      await wait(160);
    }
    await evaluate(s, `(() => { Date.now = window.__realDateNowNight; delete window.__realDateNowNight; })()`);
  }
  results.night = { phaseReady: nightPhaseReady, bubble: nightBubble };
  check("night.line", !!nightBubble, nightPhaseReady ? `bubble=${nightBubble ?? "null"}` : "32s 内没等到询问拍点");

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
