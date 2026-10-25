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
//   启动 greet 报「第 7 天」彩带 / 久别台词（不碰用户目录里的其他盘）；
// - v1.10 玩具箱：逗猫棒生出 → 点中 → stats/成就/落盘 → 7s 自收；泡泡六颗 → 点破一颗；
//   落叶一笔；猜拳读数与判词同源；跟随真的挪位置、点她就收工；走路留爪印并自行褪去；
//   睡熟 1.8s 出梦话云、醒来抹掉；首次解锁成就时徽章压过普通台词（与单测同一口径）。
// - v1.11 六件玩具：纸箱（敲箱→探头点头→收箱）、激光（同拍点中红点）、梳毛（起手一道→点击加速→
//   整轮记一次）、薄荷（戳叶吸一口→整轮记一次）、纸飞机（同拍点中）、小鸟（停稳才可点、受惊飞走、
//   不产数值）；每件的计数都要当场落盘，并在整页重载后还在；成长记录两行与徽章/互动读数同源。
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
/** 整块台词表的所有句子（含分组字典，如按羁绊档分行的 GIRL_BOND_LINES）。 */
function sourceBlockLines(name) {
  const src = fs.readFileSync(path.join(ROOT, "src/renderer/pet/companion.ts"), "utf8");
  const block = src.match(new RegExp(`const\\s+${name}[^=]*=\\s*\\{([\\s\\S]*?)\\n\\};`))?.[1];
  if (!block) throw new Error(`[ENV] 读不出 ${name}：验收句子表都没了，先看源码`);
  return [...block.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse(`"${m[1]}"`));
}
const BOND_UP_LINES = sourceBlockLines("GIRL_BOND_LINES");
const BUBBLE_LINES = sourceLines("GIRL_BUBBLE_LINES");
const LEAF_LINES = sourceLines("GIRL_LEAF_LINES");
const FOLLOW_LINES = sourceLines("GIRL_FOLLOW_LINES");
const RPS_LINES = {
  win: sourceFieldLines("GIRL_RPS_LINES", "win"),
  lose: sourceFieldLines("GIRL_RPS_LINES", "lose"),
  draw: sourceFieldLines("GIRL_RPS_LINES", "draw"),
};
const BOX_KNOCK_LINES = sourceLines("GIRL_BOX_KNOCK_LINES");
const BOX_CATCH_LINES = sourceLines("GIRL_BOX_CATCH_LINES");
const LASER_LINES = sourceLines("GIRL_LASER_LINES");
const BRUSH_LINES = sourceLines("GIRL_BRUSH_LINES");
const CATNIP_LINES = sourceLines("GIRL_CATNIP_LINES");
const PLANE_LINES = sourceLines("GIRL_PLANE_LINES");
const BIRD_LINES = sourceLines("GIRL_BIRD_LINES");
const BIRD_AWAY_LINES = sourceLines("GIRL_BIRD_AWAY_LINES");

/** 成就台词在 girl-achievements.ts：验收按表认，不在探针里另抄。 */
function sourceAchievementLine(id) {
  const src = fs.readFileSync(path.join(ROOT, "src/renderer/pet/girl-achievements.ts"), "utf8");
  const hit = src.match(new RegExp(`id:\\s*"${id}"[^}]*?line:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
  if (!hit) throw new Error(`[ENV] 读不出成就 ${id} 的台词：验收句子表都没了，先看源码`);
  return JSON.parse(`"${hit[1]}"`);
}

const FIRST_CATCH_LINE = sourceAchievementLine("first-catch");
const FIRST_WAND_LINE = sourceAchievementLine("first-wand");

/** 猜拳判词与 shared/pet-rps.ts 同义（探针只认结果，不重复实现偏门规则）。 */
function judgeRps(a, b) {
  if (a === b) return "draw";
  const wins = (a === "rock" && b === "scissors") || (a === "scissors" && b === "paper") || (a === "paper" && b === "rock");
  return wins ? "win" : "lose";
}

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
    // v1.10：第一次捉住会同时解锁「第一次抓住光」，成就台词（优先级 2）压过普通捉虫台词。
    check("critter.achievement",
      (caughtDiag.girl.achievements ?? []).includes("first-catch")
        && caughtDiag.girl.achievement?.id === "first-catch"
        && caughtDiag.girl.stats.catches === 1,
      `achievements=${JSON.stringify(caughtDiag.girl.achievements)} tip=${JSON.stringify(caughtDiag.girl.achievement)} catches=${caughtDiag.girl.stats.catches}`);
    check("critter.line", !!caughtSnap.bubble && caughtSnap.bubble.text === FIRST_CATCH_LINE,
      `bubble=${caughtSnap.bubble?.text ?? "null"} expected=${FIRST_CATCH_LINE}（成就首次解锁应压过 ${CRITTER_LINES.length} 句普通台词）`);
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

    // —— N. v1.10.0：玩具箱 / 跟随 / 爪印 / 梦话云 ——
    // N1 逗猫棒：生出一根会摆 7s 的羽毛 → 点中尖端 → stats/成就/落盘 → 闪一下自己收走。
    // 首次捉中也顺带验「成就压过普通台词」：这里必须是 first-wand 的句子，而不是羽毛台词。
    await dismissBubble();
    await wait(260);
    await evaluate(s, `window.__cyrene.renderer.handleCommand("wand")`);
    await wait(200);
    const wandSnapA = await snap();
    const wandDiagA = await diag();
    results.wand = { wand: wandDiagA.girl.wand, bubble: wandSnapA.bubble?.text ?? null };
    await shot("girl-wand.png");
    check("wand.spawn",
      !!wandDiagA.girl.wand && wandDiagA.girl.wand.caught === false && wandDiagA.girl.wand.left > 5_000,
      `wand=${JSON.stringify(wandDiagA.girl.wand)}`);
    check("wand.call", wandSnapA.bubble?.text === "羽毛在这儿——", `bubble=${wandSnapA.bubble?.text ?? "null"}`);

    // 羽毛在摆（~2.3rad/s），读数与点击必须同一拍；否则隔一次 CDP 往返就落在命中圈外。
    let wandAttempt = null;
    for (let i = 0; i < 3; i++) {
      wandAttempt = await evaluate(s, `(() => {
        const d = window.__cyrene.getPetDiagnostics();
        const w = d.girl.wand;
        if (!w) return { ok: false, why: "wand gone" };
        const z = d.layout.zoom;
        window.__cyrene.renderer.tapAt(w.x * z, w.y * z, 40);
        return { ok: true, x: w.x, y: w.y };
      })()`);
      await wait(130);
      if ((await diag()).girl.wand?.caught) break;
    }
    const wandCaught = await diag();
    const wandCaughtSnap = await snap();
    const bondAfterWand = await evaluate(s, `(() => {
      try { return JSON.parse(localStorage.getItem("cyrene.pet.bond.v1") ?? "null"); } catch { return null; }
    })()`);
    results.wandCatch = {
      attempt: wandAttempt,
      caught: wandCaught.girl.wand?.caught ?? null,
      bubble: wandCaughtSnap.bubble?.text ?? null,
      stats: wandCaught.girl.stats,
      achievements: wandCaught.girl.achievements,
      tip: wandCaught.girl.achievement,
      bond: { stats: bondAfterWand?.stats ?? null, achievements: bondAfterWand?.achievements ?? null },
    };
    await wait(150);
    await shot("girl-wand-caught.png");
    check("wand.caught", wandCaught.girl.wand?.caught === true,
      `wand=${JSON.stringify(wandCaught.girl.wand)} attempt=${JSON.stringify(wandAttempt)}`);
    check("wand.stats", wandCaught.girl.stats.wand === 1, `stats=${JSON.stringify(wandCaught.girl.stats)}`);
    check("wand.achievement",
      (wandCaught.girl.achievements ?? []).includes("first-wand")
        && wandCaught.girl.achievement?.id === "first-wand",
      `achievements=${JSON.stringify(wandCaught.girl.achievements)} tip=${JSON.stringify(wandCaught.girl.achievement)}`);
    check("wand.line", wandCaughtSnap.bubble?.text === FIRST_WAND_LINE,
      `bubble=${wandCaughtSnap.bubble?.text ?? "null"} expected=${FIRST_WAND_LINE}`);
    check("wand.persist",
      bondAfterWand?.stats?.wand === 1
        && Array.isArray(bondAfterWand?.achievements) && bondAfterWand.achievements.includes("first-wand"),
      `bond.stats=${JSON.stringify(bondAfterWand?.stats ?? null)} bond.achievements=${JSON.stringify(bondAfterWand?.achievements ?? null)}`);
    const wandDeadline = Date.now() + 9_000;
    let wandLast = wandCaught.girl.wand;
    while (Date.now() < wandDeadline) {
      wandLast = (await diag()).girl.wand;
      if (!wandLast) break;
      await wait(180);
    }
    check("wand.gone", !wandLast, `wand=${JSON.stringify(wandLast)}`);

    // N2 泡泡：六颗一起升起 → 戳破一颗 → 剩五颗 → 5.6s 后整串自己散掉。
    // 成就句是优先级 2、TTL 6s：她刚拿了徽章，这句会正当地压住玩具台词（wand.line 已验证）。
    // 先像用户那样点掉它，再验「第一颗泡泡被戳破时她会说泡泡台词」。
    await dismissBubble();
    await wait(260);
    await evaluate(s, `window.__cyrene.renderer.handleCommand("bubbles")`);
    await wait(200);
    const bubA = await diag();
    results.bubbles = { a: bubA.girl.bubbles };
    await shot("girl-bubbles.png");
    check("bubbles.spawn",
      !!bubA.girl.bubbles && bubA.girl.bubbles.live === 6 && bubA.girl.bubbles.spots.length === 6
        && bubA.girl.bubbles.left > 5_000,
      `bubbles=${JSON.stringify(bubA.girl.bubbles)}`);
    const bubbleAttempt = bubA.girl.bubbles?.spots[0]
      ? await evaluate(s, `(() => {
          const d = window.__cyrene.getPetDiagnostics();
          const spot = d.girl.bubbles?.spots[0];
          if (!spot) return { ok: false, why: "no spot" };
          const z = d.layout.zoom;
          window.__cyrene.renderer.tapAt(spot.x * z, spot.y * z, 40);
          return { ok: true, x: spot.x, y: spot.y, r: spot.r };
        })()`)
      : null;
    await wait(220);
    const bubB = await diag();
    const bubBSnap = await snap();
    results.bubbles.b = { bubbles: bubB.girl.bubbles, bubble: bubBSnap.bubble?.text ?? null, attempt: bubbleAttempt };
    check("bubbles.pop",
      !!bubbleAttempt?.ok && !!bubB.girl.bubbles && bubB.girl.bubbles.live === 5,
      `attempt=${JSON.stringify(bubbleAttempt)} bubbles=${JSON.stringify(bubB.girl.bubbles)}`);
    check("bubbles.stats", bubB.girl.stats.bubbles === 1, `stats=${JSON.stringify(bubB.girl.stats)}`);
    check("bubbles.line", !!bubBSnap.bubble && BUBBLE_LINES.includes(bubBSnap.bubble.text),
      `bubble=${bubBSnap.bubble?.text ?? "null"}`);
    const bubbleDeadline = Date.now() + 8_000;
    let bubbleLast = bubB.girl.bubbles;
    while (Date.now() < bubbleDeadline) {
      bubbleLast = (await diag()).girl.bubbles;
      if (!bubbleLast) break;
      await wait(200);
    }
    check("bubbles.gone", !bubbleLast, `bubbles=${JSON.stringify(bubbleLast)}`);

    // N3 落叶：一把叶子从头顶撒下来，带一句台词，5.6s 内自己落完。
    await evaluate(s, `window.__cyrene.renderer.handleCommand("leaves")`);
    await wait(200);
    const leafDiag = await diag();
    const leafSnap = await snap();
    results.leaves = { left: leafDiag.girl.leaves?.left ?? null, bubble: leafSnap.bubble?.text ?? null };
    await shot("girl-leaves.png");
    check("leaves.spawn", !!leafDiag.girl.leaves && leafDiag.girl.leaves.left > 4_000,
      `leaves=${JSON.stringify(leafDiag.girl.leaves)}`);
    check("leaves.line", !!leafSnap.bubble && LEAF_LINES.includes(leafSnap.bubble.text),
      `bubble=${leafSnap.bubble?.text ?? "null"}`);
    const leafDeadline = Date.now() + 7_000;
    let leafLast = leafDiag.girl.leaves;
    while (Date.now() < leafDeadline) {
      leafLast = (await diag()).girl.leaves;
      if (!leafLast) break;
      await wait(200);
    }
    check("leaves.gone", !leafLast, `leaves=${JSON.stringify(leafLast)}`);

    // N4 猜拳：玩家出石头 → 读她出的手 → 判词与 shared/pet-rps.ts 同义 → 3.6s 收走。
    await evaluate(s, `window.__cyrene.renderer.handleCommand("rps:rock")`);
    await wait(220);
    const rpsDiag = await diag();
    const rpsSnap = await snap();
    const rps = rpsDiag.girl.rps;
    const rpsOutcome = rps ? judgeRps("rock", rps.her) : null;
    results.rps = { rps, bubble: rpsSnap.bubble?.text ?? null, expectedOutcome: rpsOutcome };
    await shot("girl-rps.png");
    check("rps.spawn",
      !!rps && rps.player === "rock" && ["rock", "scissors", "paper"].includes(rps.her) && rps.left > 3_000,
      `rps=${JSON.stringify(rps)}`);
    check("rps.outcome", !!rps && rps.outcome === rpsOutcome,
      `her=${rps?.her} outcome=${rps?.outcome} expected=${rpsOutcome}`);
    check("rps.line",
      !!rps && !!rpsSnap.bubble && RPS_LINES[rps.outcome].includes(rpsSnap.bubble.text),
      `bubble=${rpsSnap.bubble?.text ?? "null"} outcome=${rps?.outcome ?? "null"}`);
    const rpsDeadline = Date.now() + 5_000;
    let rpsLast = rps;
    while (Date.now() < rpsDeadline) {
      rpsLast = (await diag()).girl.rps;
      if (!rpsLast) break;
      await wait(200);
    }
    check("rps.gone", !rpsLast, `rps=${JSON.stringify(rpsLast)}`);

    // N5 跟随：答应一声 → 光标移到她右侧 120px → 她真的迈步（窗口原点也动）→ 点她收工。
    const followStartSnap = await snap();
    await evaluate(s, `window.__cyrene.renderer.handleCommand("follow")`);
    await wait(200);
    const followDiagA = await diag();
    const followSnapA = await snap();
    results.follow = {
      start: followStartSnap.pos.x,
      a: followDiagA.girl.follow,
      bubble: followSnapA.bubble?.text ?? null,
    };
    check("follow.start", !!followDiagA.girl.follow, `follow=${JSON.stringify(followDiagA.girl.follow)}`);
    check("follow.line", !!followSnapA.bubble && FOLLOW_LINES.includes(followSnapA.bubble.text),
      `bubble=${followSnapA.bubble?.text ?? "null"}`);
    g = await readGeo();
    await setGaze((g.headX + 120) * g.zoom, g.headY * g.zoom);
    await wait(900);
    const followDiagB = await diag();
    const followSnapB = await snap();
    const followMoved = followSnapB.pos.x - followStartSnap.pos.x;
    results.follow.b = { follow: followDiagB.girl.follow, x: followSnapB.pos.x, moved: followMoved };
    check("follow.moves", followMoved > 8,
      `x ${followStartSnap.pos.x} → ${followSnapB.pos.x}（+${followMoved}px）follow=${JSON.stringify(followDiagB.girl.follow)}`);
    check("follow.target", !!followDiagB.girl.follow && followDiagB.girl.follow.lastTargetX > followStartSnap.pos.x,
      `lastTargetX=${followDiagB.girl.follow?.lastTargetX ?? "null"} start=${followStartSnap.pos.x}`);
    await shot("girl-follow.png");
    g = await readGeo();
    await tapAt(g.headX * g.zoom, g.headY * g.zoom);
    await wait(180);
    const followDiagC = await diag();
    results.follow.c = followDiagC.girl.follow;
    check("follow.stops", followDiagC.girl.follow === null, `follow=${JSON.stringify(followDiagC.girl.follow)}`);

    // N6 爪印：走一段就踩出爪印（屏幕坐标系，窗口搬动不会把印子留在旧位置），3.2s 内褪完。
    await evaluate(s, `window.__cyrene.renderer.handleCommand("wander")`);
    await wait(600);
    const printDiagA = await diag();
    results.prints = { a: printDiagA.girl.prints };
    await shot("girl-prints.png");
    check("prints.spawn", printDiagA.girl.prints > 0, `prints=${printDiagA.girl.prints}`);
    const printDeadline = Date.now() + 12_000;
    let printLast = printDiagA.girl.prints;
    while (Date.now() < printDeadline) {
      printLast = (await diag()).girl.prints;
      if (printLast === 0) break;
      await wait(250);
    }
    check("prints.gone", printLast === 0, `prints=${printLast}`);

    // N7 梦话云：睡熟 1.8s 后头顶浮出一朵云（截图取证），醒来 sleepSince 立刻归 -1。
    await dismissBubble();
    await wait(600);
    await evaluate(s, `window.__cyrene.renderer.handleCommand("toggle-sleep")`);
    await wait(2_400);
    const dreamSnap = await snap();
    const dreamDiag = await diag();
    results.dream = {
      activity: dreamSnap.activity,
      sleepSince: dreamDiag.girl.sleepSince,
      mood: dreamSnap.mood,
      quiet: dreamDiag.quiet,
    };
    await shot("girl-dream.png");
    check("dream.sleep", dreamSnap.activity === "sleep" && dreamDiag.girl.sleepSince >= 0,
      `activity=${dreamSnap.activity} sleepSince=${Math.round(dreamDiag.girl.sleepSince)}`);
    await evaluate(s, `window.__cyrene.renderer.handleCommand("toggle-sleep")`);
    await wait(500);
    const dreamWokeDiag = await diag();
    const dreamWokeSnap = await snap();
    results.dream.wake = { activity: dreamWokeSnap.activity, sleepSince: dreamWokeDiag.girl.sleepSince };
    check("dream.wake", dreamWokeSnap.activity !== "sleep" && dreamWokeDiag.girl.sleepSince < 0,
      `activity=${dreamWokeSnap.activity} sleepSince=${dreamWokeDiag.girl.sleepSince}`);

    // —— O. v1.11.0：纸箱 / 激光 / 梳毛 / 薄荷 / 纸飞机 / 小鸟 / 成长记录 ——
    // 新五枚成就的第一道门槛都压在「多轮」上（box≥2 / laser≥3 / brush≥10 / catnip≥2 / plane≥2），
    // 所以这一轮验的是玩具回执、计数与落盘；成就与跨重启由后面的 reload 段一并收。
    const bondNow = () => evaluate(s, `(() => {
      try { return JSON.parse(localStorage.getItem("cyrene.pet.bond.v1") ?? "null"); } catch { return null; }
    })()`);
    const v11Before = (await diag()).girl.stats;

    // O1 纸箱：先躲进去 → 敲箱（箱身）→ 等到探头窗口 → 点头框 → 计数/落盘/收箱。
    await dismissBubble();
    await wait(260);
    await evaluate(s, `window.__cyrene.renderer.handleCommand("box")`);
    await wait(240);
    const boxA = await diag();
    const boxASnap = await snap();
    results.box = { a: boxA.girl.box, bubble: boxASnap.bubble?.text ?? null };
    await shot("girl-box.png");
    check("box.spawn",
      !!boxA.girl.box && boxA.girl.box.phase !== "peek" && boxA.girl.box.left > 5_000
        && !!boxA.girl.box.head,
      `box=${JSON.stringify(boxA.girl.box)}`);
    const boxKnock = await evaluate(s, `(() => {
      const d = window.__cyrene.getPetDiagnostics();
      const b = d.girl.box;
      if (!b) return { ok: false, why: "box gone" };
      const z = d.layout.zoom;
      const x = b.x + b.w / 2;
      const y = b.y + b.h * 0.5;
      window.__cyrene.renderer.tapAt(x * z, y * z, 40);
      return { ok: true, x, y, phase: b.phase };
    })()`);
    await wait(200);
    const boxB = await diag();
    const boxBSnap = await snap();
    results.box.knock = { attempt: boxKnock, box: boxB.girl.box, bubble: boxBSnap.bubble?.text ?? null };
    check("box.knock", !!boxKnock?.ok && (boxB.girl.box?.knocks ?? 0) >= 1,
      `attempt=${JSON.stringify(boxKnock)} box=${JSON.stringify(boxB.girl.box)}`);
    check("box.knock-line", !!boxBSnap.bubble && BOX_KNOCK_LINES.includes(boxBSnap.bubble.text),
      `bubble=${boxBSnap.bubble?.text ?? "null"}`);

    let boxPeek = null;
    const boxPeekDeadline = Date.now() + 4_500;
    while (Date.now() < boxPeekDeadline) {
      boxPeek = (await diag()).girl.box;
      if (boxPeek?.phase === "peek" && boxPeek.head) break;
      await wait(110);
    }
    results.box.peek = boxPeek;
    check("box.peek", !!boxPeek && boxPeek.phase === "peek" && !!boxPeek.head,
      `box=${JSON.stringify(boxPeek)}`);
    const boxCatch = boxPeek?.head ? await evaluate(s, `(() => {
      const d = window.__cyrene.getPetDiagnostics();
      const b = d.girl.box;
      if (!b || !b.head) return { ok: false, why: "no head box" };
      const z = d.layout.zoom;
      window.__cyrene.renderer.tapAt(b.head.x * z, b.head.y * z, 40);
      return { ok: true, x: b.head.x, y: b.head.y, phase: b.phase };
    })()`) : null;
    await wait(220);
    const boxC = await diag();
    const boxCSnap = await snap();
    const bondAfterBox = await bondNow();
    results.box.catch = {
      attempt: boxCatch, box: boxC.girl.box, stats: boxC.girl.stats, bubble: boxCSnap.bubble?.text ?? null,
    };
    await shot("girl-box-caught.png");
    check("box.catch",
      !!boxCatch?.ok && boxC.girl.box?.caught === true && boxC.girl.stats.boxes === v11Before.boxes + 1,
      `attempt=${JSON.stringify(boxCatch)} box=${JSON.stringify(boxC.girl.box)} stats=${JSON.stringify(boxC.girl.stats)}`);
    check("box.line", !!boxCSnap.bubble && BOX_CATCH_LINES.includes(boxCSnap.bubble.text),
      `bubble=${boxCSnap.bubble?.text ?? "null"}`);
    check("box.persist", bondAfterBox?.stats?.boxes === boxC.girl.stats.boxes,
      `bond.stats=${JSON.stringify(bondAfterBox?.stats ?? null)}`);
    const boxDeadline = Date.now() + 4_000;
    let boxLast = boxC.girl.box;
    while (Date.now() < boxDeadline) {
      boxLast = (await diag()).girl.box;
      if (!boxLast) break;
      await wait(180);
    }
    check("box.gone", !boxLast, `box=${JSON.stringify(boxLast)}`);

    // O2 激光：红点在眼前画 Lissajous → 同一拍点击 → 计数/落盘 → 700ms 收场。
    await dismissBubble();
    await wait(260);
    await evaluate(s, `window.__cyrene.renderer.handleCommand("laser")`);
    await wait(240);
    const laserA = await diag();
    const laserASnap = await snap();
    results.laser = { a: laserA.girl.laser, bubble: laserASnap.bubble?.text ?? null };
    await shot("girl-laser.png");
    check("laser.spawn",
      !!laserA.girl.laser && laserA.girl.laser.caught === false && laserA.girl.laser.left > 6_500,
      `laser=${JSON.stringify(laserA.girl.laser)}`);
    let laserTap = null;
    for (let i = 0; i < 3; i += 1) {
      laserTap = await evaluate(s, `(() => {
        const d = window.__cyrene.getPetDiagnostics();
        const l = d.girl.laser;
        if (!l || l.caught) return { ok: false, why: "laser gone/caught" };
        const z = d.layout.zoom;
        window.__cyrene.renderer.tapAt(l.x * z, l.y * z, 40);
        return { ok: true, x: l.x, y: l.y };
      })()`);
      await wait(140);
      if ((await diag()).girl.laser?.caught) break;
    }
    const laserC = await diag();
    const laserCSnap = await snap();
    const bondAfterLaser = await bondNow();
    results.laser.catch = {
      attempt: laserTap, laser: laserC.girl.laser, stats: laserC.girl.stats, bubble: laserCSnap.bubble?.text ?? null,
    };
    check("laser.caught",
      !!laserTap?.ok && laserC.girl.laser?.caught === true && laserC.girl.stats.lasers === v11Before.lasers + 1,
      `attempt=${JSON.stringify(laserTap)} laser=${JSON.stringify(laserC.girl.laser)} stats=${JSON.stringify(laserC.girl.stats)}`);
    check("laser.line", !!laserCSnap.bubble && LASER_LINES.includes(laserCSnap.bubble.text),
      `bubble=${laserCSnap.bubble?.text ?? "null"}`);
    check("laser.persist", bondAfterLaser?.stats?.lasers === laserC.girl.stats.lasers,
      `bond.stats=${JSON.stringify(bondAfterLaser?.stats ?? null)}`);
    const laserDeadline = Date.now() + 3_000;
    let laserLast = laserC.girl.laser;
    while (Date.now() < laserDeadline) {
      laserLast = (await diag()).girl.laser;
      if (!laserLast) break;
      await wait(160);
    }
    check("laser.gone", !laserLast, `laser=${JSON.stringify(laserLast)}`);

    // O3 梳毛：梳子沿她身上扫 → 1.4s 后已有第一道 → 点梳子加速 → 整轮 6s 才记一次。
    await dismissBubble();
    await wait(260);
    await evaluate(s, `window.__cyrene.renderer.handleCommand("brush")`);
    await wait(240);
    const brushA = await diag();
    const brushASnap = await snap();
    results.brush = { a: brushA.girl.brush, bubble: brushASnap.bubble?.text ?? null };
    await shot("girl-brush.png");
    check("brush.spawn",
      !!brushA.girl.brush && brushA.girl.brush.left > 5_000 && brushA.girl.brush.strokes === 0,
      `brush=${JSON.stringify(brushA.girl.brush)}`);
    await wait(1_400);
    const brushB = await diag();
    results.brush.mid = brushB.girl.brush;
    check("brush.strokes", (brushB.girl.brush?.strokes ?? 0) >= 1,
      `brush=${JSON.stringify(brushB.girl.brush)}`);
    const brushTap = await evaluate(s, `(() => {
      const d = window.__cyrene.getPetDiagnostics();
      const b = d.girl.brush;
      if (!b) return { ok: false, why: "brush gone" };
      const z = d.layout.zoom;
      window.__cyrene.renderer.tapAt(b.x * z, b.y * z, 40);
      return { ok: true, x: b.x, y: b.y, strokes: b.strokes };
    })()`);
    await wait(180);
    const brushC = await diag();
    results.brush.tap = { attempt: brushTap, brush: brushC.girl.brush };
    check("brush.boost", !!brushTap?.ok && (brushC.girl.brush?.boosts ?? 0) >= 1,
      `attempt=${JSON.stringify(brushTap)} brush=${JSON.stringify(brushC.girl.brush)}`);
    const brushDeadline = Date.now() + 7_000;
    let brushLast = brushC.girl.brush;
    while (Date.now() < brushDeadline) {
      brushLast = (await diag()).girl.brush;
      if (!brushLast) break;
      await wait(220);
    }
    const brushDone = await diag();
    const brushDoneSnap = await snap();
    const bondAfterBrush = await bondNow();
    results.brush.done = { stats: brushDone.girl.stats, bubble: brushDoneSnap.bubble?.text ?? null };
    check("brush.done", !brushLast && brushDone.girl.stats.brushes === v11Before.brushes + 1,
      `brush=${JSON.stringify(brushLast)} stats=${JSON.stringify(brushDone.girl.stats)}`);
    check("brush.line", !!brushDoneSnap.bubble
      && (BRUSH_LINES.includes(brushDoneSnap.bubble.text) || BOND_UP_LINES.includes(brushDoneSnap.bubble.text)),
      `bubble=${brushDoneSnap.bubble?.text ?? "null"}`
        + (BOND_UP_LINES.includes(brushDoneSnap.bubble?.text) ? "（升档优先，梳完那句按设计让位）" : ""));
    check("brush.persist", bondAfterBrush?.stats?.brushes === brushDone.girl.stats.brushes,
      `bond.stats=${JSON.stringify(bondAfterBrush?.stats ?? null)}`);

    // O4 薄荷：叶束在脚边 → 戳一下多吸一口（只涨亲密度不计数）→ 整轮结束才记一次。
    await dismissBubble();
    await wait(260);
    await evaluate(s, `window.__cyrene.renderer.handleCommand("catnip")`);
    await wait(240);
    const catnipA = await diag();
    const catnipASnap = await snap();
    results.catnip = { a: catnipA.girl.catnip, bubble: catnipASnap.bubble?.text ?? null };
    await shot("girl-catnip.png");
    check("catnip.spawn",
      !!catnipA.girl.catnip && ["sniff", "roll"].includes(catnipA.girl.catnip.phase)
        && catnipA.girl.catnip.left > 5_000,
      `catnip=${JSON.stringify(catnipA.girl.catnip)}`);
    const catnipTap = await evaluate(s, `(() => {
      const d = window.__cyrene.getPetDiagnostics();
      const c = d.girl.catnip;
      if (!c) return { ok: false, why: "catnip gone" };
      const z = d.layout.zoom;
      window.__cyrene.renderer.tapAt(c.x * z, c.y * z, 40);
      return { ok: true, x: c.x, y: c.y, phase: c.phase };
    })()`);
    await wait(200);
    const catnipB = await diag();
    results.catnip.puff = { attempt: catnipTap, catnip: catnipB.girl.catnip };
    check("catnip.puff",
      !!catnipTap?.ok && (catnipB.girl.catnip?.puffs ?? 0) >= 1 && catnipB.girl.stats.catnips === v11Before.catnips,
      `attempt=${JSON.stringify(catnipTap)} catnip=${JSON.stringify(catnipB.girl.catnip)} stats=${JSON.stringify(catnipB.girl.stats)}`);
    const catnipDeadline = Date.now() + 7_500;
    let catnipLast = catnipB.girl.catnip;
    while (Date.now() < catnipDeadline) {
      catnipLast = (await diag()).girl.catnip;
      if (!catnipLast) break;
      await wait(220);
    }
    const catnipDone = await diag();
    const catnipDoneSnap = await snap();
    const bondAfterCatnip = await bondNow();
    results.catnip.done = { stats: catnipDone.girl.stats, bubble: catnipDoneSnap.bubble?.text ?? null };
    check("catnip.done", !catnipLast && catnipDone.girl.stats.catnips === v11Before.catnips + 1,
      `catnip=${JSON.stringify(catnipLast)} stats=${JSON.stringify(catnipDone.girl.stats)}`);
    check("catnip.line", !!catnipDoneSnap.bubble && CATNIP_LINES.includes(catnipDoneSnap.bubble.text),
      `bubble=${catnipDoneSnap.bubble?.text ?? "null"}`);
    check("catnip.persist", bondAfterCatnip?.stats?.catnips === catnipDone.girl.stats.catnips,
      `bond.stats=${JSON.stringify(bondAfterCatnip?.stats ?? null)}`);

    // O5 纸飞机：从窗一侧飞过整扇窗 → 同一拍点中 → 计数/落盘 → 900ms 收场。
    await dismissBubble();
    await wait(260);
    await evaluate(s, `window.__cyrene.renderer.handleCommand("plane")`);
    await wait(320);
    const planeA = await diag();
    const planeASnap = await snap();
    results.plane = { a: planeA.girl.plane, bubble: planeASnap.bubble?.text ?? null };
    await shot("girl-plane.png");
    check("plane.spawn",
      !!planeA.girl.plane && planeA.girl.plane.caught === false && planeA.girl.plane.left > 6_000,
      `plane=${JSON.stringify(planeA.girl.plane)}`);
    let planeTap = null;
    for (let i = 0; i < 3; i += 1) {
      planeTap = await evaluate(s, `(() => {
        const d = window.__cyrene.getPetDiagnostics();
        const p = d.girl.plane;
        if (!p || p.caught) return { ok: false, why: "plane gone/caught" };
        const z = d.layout.zoom;
        window.__cyrene.renderer.tapAt(p.x * z, p.y * z, 40);
        return { ok: true, x: p.x, y: p.y };
      })()`);
      await wait(140);
      if ((await diag()).girl.plane?.caught) break;
    }
    const planeC = await diag();
    const planeCSnap = await snap();
    const bondAfterPlane = await bondNow();
    results.plane.catch = {
      attempt: planeTap, plane: planeC.girl.plane, stats: planeC.girl.stats, bubble: planeCSnap.bubble?.text ?? null,
    };
    check("plane.caught",
      !!planeTap?.ok && planeC.girl.plane?.caught === true && planeC.girl.stats.planes === v11Before.planes + 1,
      `attempt=${JSON.stringify(planeTap)} plane=${JSON.stringify(planeC.girl.plane)} stats=${JSON.stringify(planeC.girl.stats)}`);
    check("plane.line", !!planeCSnap.bubble && PLANE_LINES.includes(planeCSnap.bubble.text),
      `bubble=${planeCSnap.bubble?.text ?? "null"}`);
    check("plane.persist", bondAfterPlane?.stats?.planes === planeC.girl.stats.planes,
      `bond.stats=${JSON.stringify(bondAfterPlane?.stats ?? null)}`);
    const planeDeadline = Date.now() + 3_000;
    let planeLast = planeC.girl.plane;
    while (Date.now() < planeDeadline) {
      planeLast = (await diag()).girl.plane;
      if (!planeLast) break;
      await wait(160);
    }
    check("plane.gone", !planeLast, `plane=${JSON.stringify(planeLast)}`);

    // O6 小鸟：飞进来 → 停稳才可点 → 点它受惊飞走；全程不产数值。
    await dismissBubble();
    await wait(260);
    const birdBefore = (await diag()).girl.stats;
    await evaluate(s, `window.__cyrene.renderer.handleCommand("bird")`);
    await wait(220);
    const birdA = await diag();
    const birdASnap = await snap();
    results.bird = { a: birdA.girl.bird, bubble: birdASnap.bubble?.text ?? null };
    check("bird.spawn",
      !!birdA.girl.bird && birdA.girl.bird.pose === "in" && birdA.girl.bird.clickable === false
        && birdA.girl.bird.left > 6_000,
      `bird=${JSON.stringify(birdA.girl.bird)}`);
    check("bird.call", !!birdASnap.bubble && BIRD_LINES.includes(birdASnap.bubble.text),
      `bubble=${birdASnap.bubble?.text ?? "null"}`);
    let birdPerch = null;
    const birdPerchDeadline = Date.now() + 4_000;
    while (Date.now() < birdPerchDeadline) {
      birdPerch = (await diag()).girl.bird;
      if (birdPerch?.pose === "perch" && birdPerch.clickable) break;
      await wait(110);
    }
    results.bird.perch = birdPerch;
    check("bird.perch", !!birdPerch && birdPerch.pose === "perch" && birdPerch.clickable === true,
      `bird=${JSON.stringify(birdPerch)}`);
    await shot("girl-bird.png");
    const birdTap = birdPerch ? await evaluate(s, `(() => {
      const d = window.__cyrene.getPetDiagnostics();
      const b = d.girl.bird;
      if (!b) return { ok: false, why: "bird gone" };
      const z = d.layout.zoom;
      window.__cyrene.renderer.tapAt(b.x * z, b.y * z, 40);
      return { ok: true, x: b.x, y: b.y, pose: b.pose };
    })()`) : null;
    await wait(200);
    const birdB = await diag();
    const birdBSnap = await snap();
    const birdAfter = birdB.girl.stats;
    results.bird.flee = { attempt: birdTap, bird: birdB.girl.bird, bubble: birdBSnap.bubble?.text ?? null, stats: birdAfter };
    await shot("girl-bird-away.png");
    check("bird.flee", !!birdTap?.ok && !!birdB.girl.bird && birdB.girl.bird.pose === "away",
      `attempt=${JSON.stringify(birdTap)} bird=${JSON.stringify(birdB.girl.bird)}`);
    check("bird.line", !!birdBSnap.bubble && BIRD_AWAY_LINES.includes(birdBSnap.bubble.text),
      `bubble=${birdBSnap.bubble?.text ?? "null"}`);
    check("bird.no-stats", JSON.stringify(birdAfter) === JSON.stringify(birdBefore),
      `before=${JSON.stringify(birdBefore)} after=${JSON.stringify(birdAfter)}`);
    const birdDeadline = Date.now() + 3_000;
    let birdLast = birdB.girl.bird;
    while (Date.now() < birdDeadline) {
      birdLast = (await diag()).girl.bird;
      if (!birdLast) break;
      await wait(160);
    }

    // O7 成长记录：两行以内、徽章数与互动总数与读数同源（不许另算一套）。
    await evaluate(s, `window.__cyrene.renderer.handleCommand("growth")`);
    await wait(200);
    const growthSnap = await snap();
    const growthDiag = await diag();
    const growthText = growthSnap.bubble?.text ?? "";
    const growthLines = growthText.split("\n");
    const growthStats = growthDiag.girl.stats;
    const growthTotal = Object.values(growthStats).reduce((acc, n) => acc + n, 0);
    const growthTail = growthLines[1]?.match(/^徽章 (\d+)\/10 · 互动 (\d+) 次$/);
    results.growth = {
      text: growthText,
      achievements: growthDiag.girl.achievements.length,
      total: growthTotal,
      stats: growthStats,
    };
    await shot("girl-growth.png");
    check("growth.lines",
      growthLines.length === 2 && / · 第 \d+ 天$/.test(growthLines[0] ?? "") && !!growthTail,
      `bubble=${JSON.stringify(growthText)}`);
    check("growth.agrees",
      !!growthTail && Number(growthTail[1]) === growthDiag.girl.achievements.length
        && Number(growthTail[2]) === growthTotal,
      `徽章=${growthTail?.[1]} achievements=${growthDiag.girl.achievements.length} 互动=${growthTail?.[2]} total=${growthTotal}`);
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
          achievements: d.girl.achievements ?? [],
          stats: d.girl.stats,
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
      achievements: m.achievements ?? [],
      stats: m.stats ?? null,
      matched: milestone.ok,
    };
    check("milestone.days", m.days === 7, `days=${m.days}`);
    check("milestone.line", !!milestone.first && milestone.first.text.includes("第 7 天"),
      `bubble=${milestone.first?.text ?? "null"}`);
    check("milestone.window", milestone.ok && m.left > 0 && m.daysShown === 7,
      `left=${Math.round(m.left ?? 0)} days=${m.daysShown}`);
    check("milestone.ribbons", m.above >= 8, `above=${m.above}`);
    // v1.10：重载后 stats/成就必须从 bond 盘上回来；第 7 天这一档还会静默解锁「七日之约」。
    check("milestone.achievements",
      ["first-catch", "first-wand", "seven-days"].every((id) => (m.achievements ?? []).includes(id)),
      `achievements=${JSON.stringify(m.achievements)}`);
    // v1.11：六件新玩具的计数也必须在整页重载后从 bond 盘上回来（各自正好一轮）。
    check("milestone.stats",
      ["boxes", "lasers", "brushes", "catnips", "planes"].every((k) => (m.stats?.[k] ?? -1) === 1),
      `stats=${JSON.stringify(m.stats ?? null)}`);

    await patchBondAndReload(`
      bond.metAt = now;
      bond.celebrated = ["day:7"];
      bond.lastSeenAt = now - 4 * 3600000;
    `);
    const reunion = await waitBootLine("重逢", (t) => REUNION_LINES.includes(t));
    await waitPetInk(s, 20_000, appLog, child);
    await shot("girl-reunion.png");
    const r = reunion.settled ?? reunion.first ?? {};
    results.reunion = {
      bubble: reunion.first?.text ?? null,
      days: r.days,
      form: r.form,
      achievements: r.achievements ?? [],
      matched: reunion.ok,
    };
    check("reunion.line", !!reunion.first && REUNION_LINES.includes(reunion.first.text),
      `bubble=${reunion.first?.text ?? "null"}`);
    check("reunion.days", r.days === 1, `days=${r.days}`);
    // 重逢这句优先级 2 会压住别的台词，但不许把已经拿到手的成就洗掉。
    check("reunion.achievements",
      ["first-catch", "first-wand"].every((id) => (r.achievements ?? []).includes(id)),
      `achievements=${JSON.stringify(r.achievements)}`);
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
