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
// - 深夜：卡在 30s 询问拍点前把时钟拨到 23:30 → 气泡出现深夜台词；
// - v1.9 装扮：`accessory:bow` → 引擎报 bow、bond 存档同步、回执台词；换回 none 同理；
// - v1.9 伴飞小虫：召唤 → 白天蝴蝶/夜里流萤、未捉；点它的实时坐标 → 捉住、+0.02 亲密度、
//   闪光结束后从诊断里消失；
// - v1.9 小鱼干：feed → 道具出现、进度递增、2.6s 后收场；
// - v1.9 睡毯：睡下时下半身盖上一整块玫瑰毯（画布下半身玫瑰像素骤增），
//   醒来那一块掉回毯子以下的量级（皮肤本身也落在这色段，不按「回到某一帧」判）；
// - v1.9 散步：wander → 走起来且落点位移在 60–160px 设计窗内；
// - v1.9 纪念日/重逢：只改本应用自己的 bond 存档（metAt/lastSeenAt）后整页重载，
//   启动 greet 报「第 7 天」彩带 / 久别台词（不碰用户目录里的其他盘）。
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
const CRITTER_LINES = sourceLines("GIRL_CRITTER_LINES");
const REUNION_LINES = sourceLines("GIRL_REUNION_LINES");

/** 从 `const NAME = { field: [...] }` 里读一张台词表（装扮是按件分组的字典）。 */
function sourceFieldLines(name, field) {
  const src = fs.readFileSync(path.join(ROOT, "src/renderer/pet/companion.ts"), "utf8");
  const block = src.match(new RegExp(`const\\s+${name}[^=]*=\\s*\\{([\\s\\S]*?)\\n\\};`))?.[1];
  const body = block?.match(new RegExp(`\\b${field}:\\s*\\[([\\s\\S]*?)\\]`))?.[1];
  if (!body) throw new Error(`[ENV] 读不出 ${name}.${field}：验收句子表都没了，先看源码`);
  return [...body.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse(`"${m[1]}"`));
}

const ACCESSORY_BOW_LINES = sourceFieldLines("GIRL_ACCESSORY_LINES", "bow");
const ACCESSORY_NONE_LINES = sourceFieldLines("GIRL_ACCESSORY_LINES", "none");

/** 探针自己的 Electron 子进程；任何失败路径都要带走它，别留一只无头猫占着端口。 */
let activeChild = null;
/** 中途 ENV 红时也要把已经量到的读数落盘，别让前二十条检查随着异常一起丢。 */
let partialWriter = null;

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
    // 气泡收起/展开会换窗宽，画布先清成透明再重画；正好截在空档里会得到
    // 一张几百字节的纯空图（v1.9 真跑抓到 girl-lean-left 315B）。空帧不是
    // 产品画面，等一拍重截，不把噪声留在证据里。
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const r = await s.send("Page.captureScreenshot", { format: "png" }, 20_000);
      const buf = Buffer.from(r.data, "base64");
      if (buf.length >= 1_200 || attempt === 3) {
        fs.writeFileSync(path.join(shots, name), buf);
        return buf.length;
      }
      await wait(160);
    }
  };
  // 睡毯的判据不能只看 above 笔数：睡姿本身会收掉几笔（脸红/注意），
  // 记号线加减相抵后笔数差不出毯子。直接数**画布下半身**的玫瑰色像素：
  // 毯子是 0.88 不透明的整块玫瑰，醒来必须退回去。
  const rosePixels = () => evaluate(s, `(() => {
    const d = window.__cyrene.getPetDiagnostics();
    const c = document.getElementById("pet-canvas");
    if (!c) return { n: 0, box: null, reason: "no canvas" };
    const ctx = c.getContext("2d", { willReadFrequently: true });
    const scale = c.width / Math.max(1, c.clientWidth);
    const h = d.hitRect;
    const x0 = Math.max(0, Math.floor(h.x * scale));
    const x1 = Math.min(c.width, Math.ceil((h.x + h.width) * scale));
    const y0 = Math.max(0, Math.floor((h.y + h.height * 0.45) * scale));
    const y1 = Math.min(c.height, Math.ceil((h.y + h.height * 0.98) * scale));
    const data = ctx.getImageData(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)).data;
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      if (a > 200 && r > 205 && g > 95 && g < 185 && b > 115 && b < 200) n++;
    }
    return { n, box: [x0, y0, x1 - x0, y1 - y0], scale };
  })()`);
  // 气泡开合会换窗宽，画布被清成透明直到下一帧重画；这时读到的 0 不是「她没有玫瑰色」，
  // 而是尺子踩空了。空帧重取，并把「基线非零」本身也变成一条检查。
  const rosePixelsSettled = async () => {
    let r = await rosePixels();
    for (let i = 0; i < 5 && r.n === 0; i += 1) {
      await wait(160);
      r = await rosePixels();
    }
    return r;
  };
  const results = {};
  const checks = [];
  const check = (name, ok, detail) => {
    checks.push({ name, ok, detail });
    if (!ok) process.exitCode = 1;
  };
  partialWriter = () => {
    try {
      fs.writeFileSync(path.join(shots, "pet-girl-report.partial.json"),
        JSON.stringify({ results, checks }, null, 2), "utf8");
    } catch { /* 落盘失败不掩盖原始异常 */ }
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

  // —— L. v1.9.0：装扮 / 伴飞小虫 / 小鱼干 / 睡毯 / 散步 ——
  // 全部走右键菜单同一条命令通道（handleCommand），验的是「菜单 → 引擎 → 画」整条线；
  // 读数口是 getGirlDiagnostics() 新增的 accessory/critter/snack/milestoneLeft。
  {
    let pre = await snap();
    if (pre.activity === "sleep") {
      await evaluate(s, `window.__cyrene.renderer.handleCommand("toggle-sleep")`);
      await wait(320);
      pre = await snap();
    }
    await dismissBubble();
    await wait(220);

    // L1 装扮：命令改引擎 + 落自己的 bond 存档 + 一句回执；截图留证。
    await evaluate(s, `window.__cyrene.renderer.handleCommand("accessory:bow")`);
    await wait(260);
    const bowDiag = await diag();
    const bowSnap = await snap();
    const bondAfterBow = await evaluate(s, `(() => {
      try { return JSON.parse(localStorage.getItem("cyrene.pet.bond.v1") ?? "null"); } catch { return null; }
    })()`);
    results.accessory = {
      accessory: bowDiag.girl.accessory,
      persisted: bondAfterBow?.accessory ?? null,
      bubble: bowSnap.bubble?.text ?? null,
    };
    await shot("girl-accessory-bow.png");
    check("accessory.state", bowDiag.girl.accessory === "bow", `accessory=${bowDiag.girl.accessory}`);
    check("accessory.persist", bondAfterBow?.accessory === "bow", `bond.accessory=${bondAfterBow?.accessory ?? "null"}`);
    check("accessory.line", !!bowSnap.bubble && ACCESSORY_BOW_LINES.includes(bowSnap.bubble.text),
      `bubble=${bowSnap.bubble?.text ?? "null"}`);

    await evaluate(s, `window.__cyrene.renderer.handleCommand("accessory:none")`);
    await wait(220);
    const noneDiag = await diag();
    const noneSnap = await snap();
    check("accessory.clear", noneDiag.girl.accessory === "none", `accessory=${noneDiag.girl.accessory}`);
    check("accessory.clear-line", !!noneSnap.bubble && ACCESSORY_NONE_LINES.includes(noneSnap.bubble.text),
      `bubble=${noneSnap.bubble?.text ?? "null"}`);

    // L2 伴飞小虫：召唤 → 白天蝴蝶/夜里流萤 → 点它捉住 → 闪光后消失 → 亲密度 +0.02。
    await dismissBubble();
    const affinityBeforeCatch = (await snap()).vitals.affinity;
    await evaluate(s, `window.__cyrene.renderer.handleCommand("summon-critter")`);
    await wait(180);
    const critterDiag = await diag();
    const expectedKind = await evaluate(s,
      `(() => { const h = new Date().getHours(); return h >= 6 && h < 18 ? "butterfly" : "firefly"; })()`);
    results.critter = {
      kind: critterDiag.girl.critter?.kind ?? null,
      expectedKind,
      caught: critterDiag.girl.critter?.caught ?? null,
      pos: critterDiag.girl.critter ? { x: critterDiag.girl.critter.x, y: critterDiag.girl.critter.y } : null,
    };
    await shot("girl-critter.png");
    check("critter.spawn", !!critterDiag.girl.critter, `critter=${JSON.stringify(critterDiag.girl.critter)}`);
    check("critter.kind", critterDiag.girl.critter?.kind === expectedKind,
      `kind=${critterDiag.girl.critter?.kind} expected=${expectedKind}`);
    check("critter.flying", critterDiag.girl.critter?.caught === false, `caught=${critterDiag.girl.critter?.caught}`);

    // 点它：读数与点击必须在同一个 JS 拍里完成——它绕着脸飞（~46px/s），
    // 中间隔一次 CDP 往返就会落在命中圈外。最多补点三下。
    let catchAttempt = null;
    for (let i = 0; i < 3; i++) {
      catchAttempt = await evaluate(s, `(() => {
        const d = window.__cyrene.getPetDiagnostics();
        const c = d.girl.critter;
        if (!c) return { ok: false, why: "critter gone" };
        const z = d.layout.zoom;
        window.__cyrene.renderer.tapAt(c.x * z, c.y * z, 40);
        return { ok: true, x: c.x, y: c.y };
      })()`);
      await wait(130);
      if ((await diag()).girl.critter?.caught) break;
    }
    const caughtDiag = await diag();
    const caughtSnap = await snap();
    results.critterCatch = {
      attempt: catchAttempt,
      caught: caughtDiag.girl.critter?.caught ?? null,
      bubble: caughtSnap.bubble?.text ?? null,
      affinityBefore: affinityBeforeCatch,
      affinityAfter: caughtSnap.vitals.affinity,
    };
    // 气泡出现/收回会带着窗口改尺寸：立刻截会撞上两次重绘之间的空画布。
    await wait(140);
    await shot("girl-critter-caught.png");
    check("critter.caught", caughtDiag.girl.critter?.caught === true,
      `critter=${JSON.stringify(caughtDiag.girl.critter)} attempt=${JSON.stringify(catchAttempt)}`);
    check("critter.line", !!caughtSnap.bubble && CRITTER_LINES.includes(caughtSnap.bubble.text),
      `bubble=${caughtSnap.bubble?.text ?? "null"}`);
    check("critter.affinity", caughtSnap.vitals.affinity > affinityBeforeCatch + 0.005,
      `${affinityBeforeCatch.toFixed(3)} → ${caughtSnap.vitals.affinity.toFixed(3)}`);
    await wait(760);
    const afterFlash = await diag();
    check("critter.gone", afterFlash.girl.critter === null, `critter=${JSON.stringify(afterFlash.girl.critter)}`);

    // L3 小鱼干：喂 → 脚边出现鱼 → 进度在走 → 2.6s 后自己收场。
    await dismissBubble();
    await evaluate(s, `window.__cyrene.renderer.handleCommand("feed")`);
    await wait(220);
    const snackA = await diag();
    await shot("girl-snack.png");
    await wait(700);
    const snackB = await diag();
    results.snack = { a: snackA.girl.snack, b: snackB.girl.snack };
    check("snack.spawn", !!snackA.girl.snack, `snack=${JSON.stringify(snackA.girl.snack)}`);
    check("snack.progress", !!snackB.girl.snack && snackB.girl.snack.progress > (snackA.girl.snack?.progress ?? 1),
      `${snackA.girl.snack?.progress?.toFixed(3) ?? "null"} → ${snackB.girl.snack?.progress?.toFixed(3) ?? "null"}`);
    const snackDeadline = Date.now() + 4_000;
    let snackLast = snackB.girl.snack;
    while (Date.now() < snackDeadline) {
      snackLast = (await diag()).girl.snack;
      if (!snackLast) break;
      await wait(220);
    }
    check("snack.gone", !snackLast, `snack=${JSON.stringify(snackLast)}`);

    // L4 睡毯：睡着时下半身盖上一整块玫瑰毯；醒来收走。
    await dismissBubble();
    await wait(260);
    const awakePink = await rosePixelsSettled();
    await evaluate(s, `window.__cyrene.renderer.handleCommand("toggle-sleep")`);
    await wait(520);
    const sleepSnap2 = await snap();
    const sleepPink = await rosePixelsSettled();
    results.blanket = {
      activity: sleepSnap2.activity,
      awakePink: awakePink.n,
      sleepPink: sleepPink.n,
      box: sleepPink.box,
      scale: sleepPink.scale,
    };
    await shot("girl-blanket.png");
    check("blanket.sleep", sleepSnap2.activity === "sleep", `activity=${sleepSnap2.activity}`);
    check("blanket.baseline", awakePink.n > 0, `醒着玫瑰像素 ${awakePink.n}`);
    check("blanket.pixels", sleepPink.n >= 150 && sleepPink.n >= awakePink.n + 100,
      `玫瑰像素 ${awakePink.n} → ${sleepPink.n}`);
    await evaluate(s, `window.__cyrene.renderer.handleCommand("toggle-sleep")`);
    await wait(420);
    const wokeSnap = await snap();
    const wakePink = await rosePixelsSettled();
    results.blanket.wakePink = wakePink.n;
    check("blanket.wake", wokeSnap.activity !== "sleep", `activity=${wokeSnap.activity}`);
    // 不能拿「醒着基线 +80」当上界：这扇窗从大腿到脚，皮肤本身就在玫瑰色段里，
    // 不同待机帧露出的腿/手数量不同（实测基线 37–131 都出现过）。毯子本身是 660+ 像素，
    // 「收走了」的判据应该是那一块的量级掉了，而不是回到另一帧的皮肤数。
    check("blanket.clears", wakePink.n + 400 <= sleepPink.n && wakePink.n < sleepPink.n / 2,
      `醒来玫瑰像素 ${wakePink.n}（睡时 ${sleepPink.n}、醒着基线 ${awakePink.n}）`);

    // L5 散步：命令 → 走起来 → 落点位移在设计的 60–160px 内。
    await dismissBubble();
    await wait(2_000);
    const walkBefore = await snap();
    await evaluate(s, `window.__cyrene.renderer.handleCommand("wander")`);
    await wait(400);
    const walkMid = await snap();
    results.wander = { before: walkBefore.pos.x, mid: walkMid.pos.x, activity: walkMid.activity };
    check("wander.starts", walkMid.activity === "walk" || walkMid.pos.x !== walkBefore.pos.x,
      `activity=${walkMid.activity} x=${walkBefore.pos.x} → ${walkMid.pos.x}`);
    const walkDeadline = Date.now() + 8_000;
    let walkEnd = walkMid;
    while (Date.now() < walkDeadline) {
      walkEnd = await snap();
      if (walkEnd.activity === "idle" || walkEnd.activity === "rest") break;
      await wait(250);
    }
    const walked = Math.abs(walkEnd.pos.x - walkBefore.pos.x);
    results.wanderEnd = { x: walkEnd.pos.x, delta: walked, activity: walkEnd.activity };
    check("wander.distance", walked >= 55 && walked <= 165, `delta=${walked}px（设计窗 60–160）`);
  }

  // —— M. v1.9.0：纪念日与久别重逢 ——
  // 只改写**本应用自己**的 localStorage bond（不动用户目录里任何别人的盘），
  // 写完就在同一拍里 location.reload()：中间不留「旧页面又存一次盘」的竞态。
  // 新页面按盘上的 metAt/lastSeenAt 走启动问候——启动问候会先等 profile 落档
  // （v1.9 真窗验收抓到过「猫形态抢跑」），所以这里轮询到那句话为止。
  {
    const patchBondAndReload = async (patchExpr) => {
      const originBefore = await evaluate(s, `performance.timeOrigin`);
      // 先写盘再发重载：写与导航之间只隔一次 CDP 往返。页面自己的存盘都发生在
      // 用户动作上，这里没有动作，不会被旧页面的内存快照盖回去。
      await evaluate(s, `(() => {
        const KEY = "cyrene.pet.bond.v1";
        let bond = {};
        try { bond = JSON.parse(localStorage.getItem(KEY) ?? "{}") ?? {}; } catch { bond = {}; }
        const now = Date.now();
        ${patchExpr}
        localStorage.setItem(KEY, JSON.stringify(bond));
        return bond;
      })()`);
      const readDoc = () => evaluate(s, `(() => ({
        origin: performance.timeOrigin,
        bridge: !!window.__cyrene,
        canvas: !!document.getElementById("pet-canvas"),
      }))()`, 5_000).catch(() => null);
      const deadline = Date.now() + 40_000;
      let lastError = null;
      let reloadAt = 0;
      for (;;) {
        const now = Date.now();
        if (now >= reloadAt) {
          try { await s.send("Page.reload", { ignoreCache: false }, 20_000); } catch (e) { lastError = String(e); }
          reloadAt = now + 8_000;
        }
        const st = await readDoc();
        if (st && st.bridge && st.canvas && st.origin > originBefore) break;
        if (Date.now() > deadline) {
          throw new Error(`[ENV] 重载后 40s 没等到新页面的渲染桥（last=${JSON.stringify(lastError)}）`);
        }
        await wait(150);
      }
      await evaluate(s, `window.__cyrene.setGazeFrozen(true)`).catch(() => {});
    };
    // 命中那一拍就取读数与截图：纪念日彩带只有 5.2s，等 waitPetInk 轮询完再读就凉了。
    const waitBootLine = async (label, hit) => {
      const read = () => evaluate(s, `(() => {
        const cy = window.__cyrene;
        if (!cy) return null;
        const snap = cy.renderer.getCompanionSnapshot();
        const d = cy.getPetDiagnostics();
        return {
          text: snap.bubble?.text ?? null,
          days: snap.days,
          form: d.form,
          left: d.girl.milestoneLeft,
          daysShown: d.girl.milestoneDays,
          above: d.girl.fx.above,
        };
      })()`, 5_000).catch(() => null);
      const deadline = Date.now() + 25_000;
      let last = null;
      while (Date.now() < deadline) {
        last = await read();
        if (last && last.text && hit(last.text)) {
          await wait(180);
          const settled = await read();
          return { ok: true, first: last, settled: settled ?? last };
        }
        await wait(120);
      }
      return { ok: false, first: last, settled: last };
    };

    await patchBondAndReload(`
      bond.metAt = now - 6 * 86400000 - 30000;
      bond.celebrated = [];
      bond.lastSeenAt = now;
    `);
    const milestone = await waitBootLine("纪念日", (t) => t.includes("第 7 天"));
    await waitPetInk(s, 20_000, appLog, child);
    await shot("girl-milestone.png");
    const m = milestone.settled ?? milestone.first ?? {};
    results.milestone = {
      days: m.days,
      bubble: milestone.first?.text ?? null,
      form: m.form,
      left: m.left,
      daysShown: m.daysShown,
      above: m.above,
      matched: milestone.ok,
    };
    check("milestone.days", m.days === 7, `days=${m.days}`);
    check("milestone.line", !!milestone.first && milestone.first.text.includes("第 7 天"),
      `bubble=${milestone.first?.text ?? "null"}`);
    check("milestone.window", milestone.ok && m.left > 0 && m.daysShown === 7,
      `left=${Math.round(m.left ?? 0)} days=${m.daysShown}`);
    check("milestone.ribbons", m.above >= 8, `above=${m.above}`);

    await patchBondAndReload(`
      bond.metAt = now;
      bond.celebrated = ["day:7"];
      bond.lastSeenAt = now - 4 * 3600000;
    `);
    const reunion = await waitBootLine("重逢", (t) => REUNION_LINES.includes(t));
    await waitPetInk(s, 20_000, appLog, child);
    await shot("girl-reunion.png");
    const r = reunion.settled ?? reunion.first ?? {};
    results.reunion = { bubble: reunion.first?.text ?? null, days: r.days, form: r.form, matched: reunion.ok };
    check("reunion.line", !!reunion.first && REUNION_LINES.includes(reunion.first.text),
      `bubble=${reunion.first?.text ?? "null"}`);
    check("reunion.days", r.days === 1, `days=${r.days}`);
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
  try { partialWriter?.(); } catch {}
  try { activeChild?.kill(); } catch {}
  console.error(String(error?.stack ?? error));
  if (process.exitCode === undefined || process.exitCode === 0) process.exitCode = 1;
});
