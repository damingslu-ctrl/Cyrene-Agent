// P5 尺 #71：运行时命中覆盖（真窗 CDP 版）。
// 用法：node scripts/verify/pet-hit-cdp.mjs <shotsDir>
// - 只读只截，**永不点击**；profile 只落在 D:\cyrene-p5-accept\profile（一次性目录）。
// - 逐 form × tier 起窗，读画布 alpha，产出「可点像素占比 / 墨 bbox / 质心」三行。
// - 判据：交互框（getPetDiagnostics().hitRect）与墨 bbox 的 IoU ≥ 0.55，
//   且头部中线一列有可点像素。找不到猫窗/读不出数 → 报 ENV 红，不报成产品红。
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

async function runCombo(form, tier, shots) {
  const profile = assertSafeProfile(PROFILE);
  fs.rmSync(profile, { recursive: true, force: true });
  fs.mkdirSync(profile, { recursive: true });
  writeProfileState(profile, form, tier);
  const electronBin = createRequire(import.meta.url)("electron");
  const child = spawn(electronBin, [".", `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`], {
    cwd: ROOT, stdio: ["ignore", "pipe", "pipe"],
  });
  const appLog = [];
  child.stdout.on("data", (b) => appLog.push(String(b)));
  child.stderr.on("data", (b) => appLog.push(String(b)));
  const found = await findPetTarget(150_000);
  if (!found) dumpAndKill(child, appLog, `没等到猫窗（${form}/${tier}）：ENV 红，不是产品红`);
  // boot 读 + 首帧
  await new Promise((r) => setTimeout(r, 2_000));
  const m = await evaluate(found.session, MEASURE, 20_000);
  const shot = await found.session.send("Page.captureScreenshot", { format: "png" }, 20_000);
  fs.writeFileSync(path.join(shots, `hit-${form}-${tier}.png`), Buffer.from(shot.data, "base64"));
  found.session.close();
  child.kill();
  if (!m || !m.ink) dumpAndKill(child, appLog, `${form}/${tier}: 画布读不出墨（ENV）`);
  const hit = {
    x: m.diag.hitRect.x * m.dprX, y: m.diag.hitRect.y * m.dprY,
    w: m.diag.hitRect.width * m.dprX, h: m.diag.hitRect.height * m.dprY,
  };
  const overlap = iou(hit, m.bbox);
  return {
    form, tier,
    clickableRatio: +(m.ink / (m.win.w * m.win.h)).toFixed(4),
    bbox: m.bbox,
    centroid: { x: +m.centroid.x.toFixed(1), y: +m.centroid.y.toFixed(1) },
    iou: +overlap.toFixed(3),
    headColumn: m.headCol,
  };
}

async function main() {
  const shotsArg = process.argv[2];
  if (!shotsArg) throw new Error("用法：node scripts/verify/pet-hit-cdp.mjs <shotsDir>");
  const shots = path.resolve(shotsArg);
  fs.mkdirSync(shots, { recursive: true });
  const report = {};
  const fails = [];
  for (const [form, tier] of COMBOS) {
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
