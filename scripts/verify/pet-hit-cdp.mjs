// P5 尺 #71：运行时命中覆盖（真窗 CDP 版）。
// 用法：node scripts/verify/pet-hit-cdp.mjs <shotsDir>
// - 只读只截，**永不点击**；profile 只落在 D:\cyrene-p5-accept\profile（一次性目录）。
// - 逐 form × tier 起窗，读画布 alpha，产出「可点像素占比 / 墨 bbox / 质心」三行。
// - 判据：交互框（getPetDiagnostics().hitRect）与「无气泡/无记号帧的墨并集」的
//   IoU ≥ 0.55，且头部中线一列有可点像素。单帧 IoU 只作读数——朝向/姿态会让它漂。
//   另跑一条验牙：命中框缩到 40% 或平移半个框宽后必须掉到门槛以下，否则这把尺报不了红。
//   找不到猫窗/读不出数 → 报 ENV 红，不报成产品红。
//
// 与 hit-iou.test.ts 的分工：那边量同一套几何的离线栅格化（快、进 CI）；
// 这边量「真窗真的这么开、画布真的有这么大」。两条都要跑，缺一条就少一层证据。
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const PROFILE = "D:\\cyrene-p5-accept\\profile";
const DEBUG_PORT = 9335;
const IOU_MIN = 0.55;
const COMBOS = [
  ["cat", "small"], ["cat", "standard"], ["cat", "large"],
  ["girl", "small"], ["girl", "standard"], ["girl", "large"],
];

function assertSafeProfile(dir) {
  const normalized = path.resolve(dir).toLowerCase();
  if (!normalized.startsWith("d:\\cyrene-p5-accept")) {
    throw new Error(`profile 必须落在 D:\\cyrene-p5-accept 下，收到 ${dir}`);
  }
  return normalized;
}

function writeProfileState(profileDir, form, tier) {
  const dir = path.join(profileDir, "verge");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify({ form, tier }, null, 2), "utf8");
  // 免责声明没同意时 core-bootstrap 用 showOnReady=false 建宠物窗：全程不 show，
  // 画布永远读不到墨。这里按产品默认同意的口径写进 profile，否则量到的是「没开窗」。
  const disclaimerSrc = fs.readFileSync(path.join(ROOT, "src/shared/disclaimer.ts"), "utf8");
  const version = disclaimerSrc.match(/CURRENT_DISCLAIMER_VERSION\s*=\s*"([^"]+)"/)?.[1];
  if (!version) throw new Error("[ENV] 读不出 CURRENT_DISCLAIMER_VERSION，无法准备 profile");
  fs.writeFileSync(path.join(profileDir, "app-settings.json"), JSON.stringify({
    petVisible: true,
    disclaimerAcceptedVersion: version,
  }, null, 2), "utf8");
}

const MEASURE = `(() => {
  const c = document.getElementById("pet-canvas");
  const d0 = window.__cyrene && window.__cyrene.getPetDiagnostics ? window.__cyrene.getPetDiagnostics() : null;
  if (!c || !d0 || !d0.hitRect) return null;
  const g = c.getContext("2d", { willReadFrequently: true, alpha: true });
  const dprX = c.width / window.innerWidth, dprY = c.height / window.innerHeight;
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let n = 0, minX = Infinity, minY = Infinity, maxX = -1, maxY = -1, sx = 0, sy = 0;
  for (let y = 0; y < c.height; y += 1) for (let x = 0; x < c.width; x += 1) {
    if (d[(y * c.width + x) * 4 + 3] < 10) continue;
    n += 1; sx += x; sy += y;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  if (!n) return { ink: 0 };
  const midX = Math.round(c.width / 2), headBottom = minY + (maxY - minY) * 0.35;
  let headCol = false;
  for (let y = minY; y <= headBottom && !headCol; y += 1)
    for (const x of [midX - 1, midX, midX + 1])
      if (d[(y * c.width + x) * 4 + 3] >= 10) { headCol = true; break; }
  return {
    ink: n, bbox: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
    centroid: { x: sx / n, y: sy / n }, headCol, dprX, dprY,
    win: { w: c.width, h: c.height }, diag: d0,
    inner: { w: window.innerWidth, h: window.innerHeight },
    // 读数口（2026-10-24 补）：form/tier 必须出现在报告里，否则「六档读数一模一样」
    // 会看起来像「都合格」，其实是形态根本没切过去——没有这一列就没有证据。
    profile: { form: d0.form ?? null, tier: d0.tier ?? null },
    // 读数口（2026-10-25 补）：基址窗口与绘制原点。气泡把窗口撑宽时，墨会跑到基址之外；
    // 没有这两列，「墨超界」到底是画歪了还是气泡，读报告的人分不出来。
    layout: d0.layout ?? null,
  };
})()`;

const iou = (a, b) => {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  return inter / (a.w * a.h + b.w * b.h - inter);
};

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

async function attach(target) {
  const s = new Session(target.webSocketDebuggerUrl);
  await s.open();
  return s;
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
          s = await attach(t);
          const hit = await evaluate(s, `!!document.getElementById("pet-canvas") && !!window.__cyrene`, 4_000);
          if (hit) return { target: t, session: s };
          s.close();
        } catch { s?.close(); }
      }
    } catch { /* 端口还没起来 */ }
    if (Date.now() > deadline) return null;
    await new Promise((r) => setTimeout(r, 400));
  }
}

function dumpAndKill(child, appLog, why) {
  try { child.kill(); } catch {}
  console.error(`[ENV] ${why}`);
  console.error(appLog.join("").slice(-3000));
  process.exitCode = 2;
  throw new Error(why);
}

/**
 * 删 profile 目录；Electron 退出后句柄不会立刻释放（Windows 上常见 EPERM），
 * 重试几分钟再放弃。删不掉就如实报 ENV，不把它当成产品红。
 */
async function rmProfile(dir) {
  for (let i = 0; i < 30; i++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (e) {
      if (e.code !== "EPERM" && e.code !== "EBUSY") throw e;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`[ENV] 清不掉 ${dir}：上一个 Electron 进程还占着它（ENV 红，不是产品红）`);
}

async function runCombo(form, tier, shots) {
  const profile = assertSafeProfile(PROFILE);
  await rmProfile(profile);
  fs.mkdirSync(profile, { recursive: true });
  writeProfileState(profile, form, tier);
  const electronBin = createRequire(import.meta.url)("electron");
  // ⚠️ 宿主 shell 若导出了 ELECTRON_RUN_AS_NODE（本机 Git Bash 就有），Electron 会以
  // 纯 Node 启动：`require("electron")` 变成 undefined，main 在
  // `protocol.registerSchemesAsPrivileged` 上当场炸。那不是产品红，是 ENV 红——
  // 必须显式删掉这个变量再起窗，否则每次只会得到「没等到猫窗」。
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electronBin, [".", `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`], {
    cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], env,
  });
  const appLog = [];
  child.stdout.on("data", (b) => appLog.push(String(b)));
  child.stderr.on("data", (b) => appLog.push(String(b)));
  const found = await findPetTarget(150_000);
  if (!found) dumpAndKill(child, appLog, `没等到猫窗（${form}/${tier}）：ENV 红，不是产品红`);
  // 启动动画期间猫窗是 show:false 的，画布读到的只能是空帧——先等它真的现身再量，
  // 否则「墨没读到」会被误判成画错了（2026-10-25 #162 起的新前提）。
  // 不能用 document.visibilityState：对「创建时 show:false 且从未 show 过」的窗它仍报
  // visible（实测 create→show→hide→minimize = visible/visible/hidden/hidden），
  // 拿它当现身判据会假绿。真值只能等画布真的出现墨。
  const revealed = await waitPetInk(found.session, 30_000);
  if (!revealed) dumpAndKill(child, appLog, `${form}/${tier}: 猫窗 30s 内没现身（ENV：启动动画没让位，不是产品红）`);
  // boot 读 + 首帧
  await new Promise((r) => setTimeout(r, 2_000));
  const clean = await sampleClean(found.session);
  const m = clean.best;
  if (!m) dumpAndKill(child, appLog, `${form}/${tier}: 24 次采样一次墨都没读到（ENV）`);
  fs.writeFileSync(path.join(shots, `hit-${form}-${tier}.png`), Buffer.from(clean.bestShot.data, "base64"));
  found.session.close();
  child.kill();
  await new Promise((r) => setTimeout(r, 1_500));
  if (!m || !m.ink) dumpAndKill(child, appLog, `${form}/${tier}: 画布读不出墨（ENV）`);
  const hit = {
    x: m.diag.hitRect.x * m.dprX, y: m.diag.hitRect.y * m.dprY,
    w: m.diag.hitRect.width * m.dprX, h: m.diag.hitRect.height * m.dprY,
  };
  const union = clean.union ?? m.bbox;
  const overlap = iou(hit, union);
  const bestFrameOverlap = iou(hit, m.bbox);
  // 验牙：两种真实坏框都必须掉到门槛以下，否则说明这把尺对「框没盖住身体」不敏感。
  // - 缩到 40%（同中心）：点到身体大半会落空；
  // - 平移半个框宽：框整体歪掉（#163 那种「头顶被裁/框歪」的形态）。
  // 注意别用「缩到 70%」做验牙：命中框本来就比身体大时，缩小反而让 IoU 变高，
  // 那是 IoU 的正常性质，不是尺没牙（cat/small 实测 0.627）。
  const shrunk = {
    x: hit.x + hit.w * 0.3, y: hit.y + hit.h * 0.3,
    w: hit.w * 0.4, h: hit.h * 0.4,
  };
  const shifted = { ...hit, x: hit.x + hit.w * 0.5 };
  const mutationShrink = iou(shrunk, union);
  const mutationShift = iou(shifted, union);
  if (mutationShrink >= IOU_MIN || mutationShift >= IOU_MIN) {
    dumpAndKill(child, appLog,
      `${form}/${tier}: 尺没有牙——缩 40% 的 IoU ${mutationShrink.toFixed(3)} / 平移半框 ${mutationShift.toFixed(3)}，至少一个没掉到 ${IOU_MIN} 以下（ENV）`);
  }
  if (m.profile && (m.profile.form !== form || m.profile.tier !== tier)) {
    dumpAndKill(child, appLog, `${form}/${tier}: 窗内形态是 ${m.profile.form}/${m.profile.tier}，切档没生效（ENV/接线，不是画错了）`);
  }
  // 24 帧里最瘦的一帧还比基址窗宽 30% → 气泡整段都在，量不到本体（ENV，不是产品红）。
  const baseW = (m.layout?.base?.width ?? 82) * m.dprX;
  if (m.bbox.w > baseW * 1.3) {
    dumpAndKill(child, appLog,
      `${form}/${tier}: 最瘦一帧仍宽 ${m.bbox.w}px > 基址 ${baseW.toFixed(0)}px×1.3，气泡整段没散（ENV：量测前提不成立）`);
  }
  return {
    form, tier,
    clickableRatio: +(m.ink / (m.win.w * m.win.h)).toFixed(4),
    bbox: m.bbox,
    // 无气泡帧的并集：钉 hitAspect/hitCenter 用这一行，不要用最瘦帧的单帧 bbox。
    // 判据也用它：单帧会随朝向/姿态漂（猫朝左那帧实测 0.543，并集 0.80），
    // 拿单帧判会把「合法的另一种姿态」报成产品红。
    bodyUnion: clean.union,
    centroid: { x: +m.centroid.x.toFixed(1), y: +m.centroid.y.toFixed(1) },
    iou: +overlap.toFixed(3),
    bestFrameIou: +bestFrameOverlap.toFixed(3),
    mutation: { shrink: +mutationShrink.toFixed(3), shift: +mutationShift.toFixed(3) },
    headColumn: m.headCol,
    // 前提读数：画布/页面尺寸、基址窗口、绘制原点、命中框（设备 px）。
    // 不写这几列，「墨只有 47 高」这种数就没人能判是画小了还是被窗裁了。
    win: m.win,
    inner: m.inner,
    dpr: { x: +m.dprX.toFixed(3), y: +m.dprY.toFixed(3) },
    layout: m.layout,
    hitRect: { x: +hit.x.toFixed(1), y: +hit.y.toFixed(1), w: +hit.w.toFixed(1), h: +hit.h.toFixed(1) },
    samples: clean.samples,
    sampleWidths: clean.widths,
  };
}

/**
 * 启动动画把猫窗压到 onDone 才 show（#162）：画布在 show:false 期间读不到墨。
 * 判据只认「画布真的出现墨」——visibilityState 分不清「没显示」和「显示了」。
 * 这里不改产品、不点、不碰别的窗。
 */
async function waitPetInk(session, timeoutMs) {
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
    await new Promise((r) => setTimeout(r, 400));
  }
}

/**
 * 气泡画在同一块画布上：它把墨 bbox 从 58 撑到 160，IoU 会从 0.72 掉到 0.11——
 * 看上去像「命中的框全歪了」，其实只是量到了气泡（2026-10-25 踩过）。
 * 气泡**只会加墨**，所以取 24 次采样里墨面积最小的一帧即「没有气泡的那一帧」；
 * 顺便在那一帧补一张截图，报告里的图和数字才是同一次观测。
 */
async function sampleClean(session) {
  let best = null;
  let bestShot = null;
  let union = null;
  const widths = [];
  for (let i = 0; i < 24; i++) {
    const m = await evaluate(session, MEASURE, 20_000);
    if (m && m.ink) {
      widths.push(m.bbox.w);
      // 判定「这一帧没有气泡」：墨宽不超过基址窗的 1.3 倍（气泡那几帧是 1.8 倍）。
      // 命中框要盖住**所有**无气泡帧的并集，不能只盖住最瘦的一帧——她抬手/歪头时
      // 墨会往外长几个像素，拿单帧钉框会让另一种姿态的头顶落在框外。
      // 但睡着时的 Zzz、免打扰的月牙也是窄墨，宽度门槛拦不住：它们会把并集顶到窗外
      // （实测 girl/standard 从 y=29 顶到 y=1，cat/standard 从 y=6 顶到 y=0）。
      // 这些是记号不是身体，按「墨顶不得高出命中框 3px 以上」剔掉——猫/女孩各姿态
      // 实测最多高出 1.9–2.1px，3px 留 1px 余量；Zzz 会高出 3px 以上。
      const baseW = (m.layout?.base?.width ?? 82) * m.dprX;
      const hitTop = m.diag.hitRect.y * m.dprY;
      const bodyLike = m.bbox.w <= baseW * 1.3 && m.bbox.y >= hitTop - 3 * m.dprY;
      if (bodyLike) {
        const b = m.bbox;
        union = union
          ? {
              x: Math.min(union.x, b.x), y: Math.min(union.y, b.y),
              w: Math.max(union.x + union.w, b.x + b.w) - Math.min(union.x, b.x),
              h: Math.max(union.y + union.h, b.y + b.h) - Math.min(union.y, b.y),
            }
          : { ...b };
      }
      if (!best || m.bbox.w * m.bbox.h < best.bbox.w * best.bbox.h) {
        best = m;
        bestShot = await session.send("Page.captureScreenshot", { format: "png" }, 20_000);
      }
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  return { best, bestShot, union, widths, samples: widths.length };
}

async function main() {
  const shotsArg = process.argv[2];
  if (!shotsArg) throw new Error("用法：node scripts/verify/pet-hit-cdp.mjs <shotsDir>");
  const shots = path.resolve(shotsArg);
  fs.mkdirSync(shots, { recursive: true });
  const report = {};
  const fails = [];
  // 第三个参数可只跑一档（`girl/standard`）：改一版画就要量一次，六档全跑太慢。
  const only = process.argv[3];
  const combos = only ? COMBOS.filter(([f, t]) => `${f}/${t}` === only) : COMBOS;
  if (!combos.length) throw new Error(`--only 的形态/档位不认识：${only}（要 ${COMBOS.map(([f, t]) => `${f}/${t}`).join(" / ")}）`);
  for (const [form, tier] of combos) {
    const row = await runCombo(form, tier, shots);
    report[`${form}/${tier}`] = row;
    if (!(row.iou >= IOU_MIN)) fails.push(`${form}/${tier}: IoU ${row.iou} < ${IOU_MIN}`);
    if (!row.headColumn) fails.push(`${form}/${tier}: 头部中线一列无可点像素`);
    console.log(JSON.stringify(row));
  }
  fs.writeFileSync(path.join(shots, "pet-hit-report.json"), JSON.stringify(report, null, 2), "utf8");
  if (fails.length) throw new Error(fails.join("\n"));
  console.log("all clear");
}

main().catch((error) => { console.error(String(error?.stack ?? error)); process.exitCode = 1; });
