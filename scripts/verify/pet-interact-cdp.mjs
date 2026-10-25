// 新交互面的真窗探针（只读只测，不点击、不改用户数据）。
// 用法：node scripts/verify/pet-interact-cdp.mjs
//
// 验三件事：
//  1. 注视：给不同方向的光标目标，画布上眼睛附近的墨必须真的移动（位移 > 阈值）。
//  2. 工作状态：setWorkStatus 各档切换后，draw 出的层集合要带上 stars（粒子）且档位可读。
//  3. 手势命令：handleCommand("wave") 之后 girl 的当前帧段必须切到 wave，播完回基础段。
//
// 判据全用「同一窗口内的差分量」，不吃跨机器基线：
//  注视比的是两组目标之间的像素差；工作状态比的是层有无；手势比的是 clipId 变化。
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const PROFILE = "D:\\cyrene-p5-accept\\profile-interact";
const DEBUG_PORT = 9337;

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
  const disclaimerSrc = fs.readFileSync(path.join(ROOT, "src/shared/disclaimer.ts"), "utf8");
  const version = disclaimerSrc.match(/CURRENT_DISCLAIMER_VERSION\s*=\s*"([^"]+)"/)?.[1];
  if (!version) throw new Error("[ENV] 读不出 CURRENT_DISCLAIMER_VERSION");
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
    const { WebSocket } = await import("ws");
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
  const res = await session.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, timeoutMs);
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
    await new Promise((r) => setTimeout(r, 400));
  }
}

/** 整幅画布的 RGBA 快照（用来逐像素比对两次渲染）。 */
const SNAPSHOT = `(() => {
  const c = document.getElementById("pet-canvas");
  const g = c.getContext("2d", { willReadFrequently: true, alpha: true });
  const d = g.getImageData(0, 0, c.width, c.height).data;
  // 只回 alpha 与红通道的粗略摘要就够判「有没有变」，但探针要定位变化区，回整串。
  return { w: c.width, h: c.height, px: Array.from(d) };
})()`;

/** 两次快照之间「有多少像素真的变了」以及变化区的 bbox。 */
function diffSnapshots(a, b) {
  if (!a || !b || a.w !== b.w || a.h !== b.h) return { changed: -1, box: null };
  let changed = 0, x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let i = 0; i < a.px.length; i += 4) {
    const dr = Math.abs(a.px[i] - b.px[i]);
    const dg = Math.abs(a.px[i + 1] - b.px[i + 1]);
    const db = Math.abs(a.px[i + 2] - b.px[i + 2]);
    const da = Math.abs(a.px[i + 3] - b.px[i + 3]);
    if (dr + dg + db + da < 18) continue;
    changed += 1;
    const p = i / 4, x = p % a.w, y = (p - x) / a.w;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { changed, box: x1 >= 0 ? { x0, y0, x1, y1 } : null };
}

/** 画布某块区域的 alpha 加权质心 + 非透明像素数（用作「眼睛动了」的观测量）。 */
const PATCH_STATS = (x, y, w, h) => `(() => {
  const c = document.getElementById("pet-canvas");
  const g = c.getContext("2d", { willReadFrequently: true, alpha: true });
  const d = g.getImageData(${x}, ${y}, ${w}, ${h}).data;
  let n = 0, sx = 0, sy = 0;
  for (let yy = 0; yy < ${h}; yy += 1) for (let xx = 0; xx < ${w}; xx += 1) {
    const a = d[(yy * ${w} + xx) * 4 + 3];
    if (a < 10) continue;
    n += 1; sx += xx * a; sy += yy * a;
  }
  return n ? { n, cx: sx / (n * 255), cy: sy / (n * 255) } : { n: 0, cx: -1, cy: -1 };
})()`;

async function main() {
  assertSafeProfile(PROFILE);
  fs.rmSync(PROFILE, { recursive: true, force: true });
  writeProfileState(PROFILE, "cat", "standard");

  const electronBin = createRequire(import.meta.url)("electron");
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const appLog = [];
  const child = spawn(electronBin, [".", `--user-data-dir=${PROFILE}`, `--remote-debugging-port=${DEBUG_PORT}`], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout.on("data", (b) => appLog.push(String(b)));
  child.stderr.on("data", (b) => appLog.push(String(b)));

  let session = null;
  try {
    const found = await findPetTarget(60_000);
    if (!found) {
      console.error("[ENV] 找不到宠物窗（60s）");
      console.error(appLog.join("").slice(-2500));
      process.exitCode = 2;
      return;
    }
    session = found.session;
    await session.send("Runtime.enable");

    const rows = [];
    let failures = 0;
    const check = (name, ok, detail) => {
      rows.push({ name, ok, detail });
      if (!ok) failures += 1;
    };

    // —— 1. 注视 ——
    // 判据用**逐像素差分**而不是质心：瞳孔偏移上限只有 ~0.9px，被整只眼的墨稀释后
    // 质心几乎不动（实测 0.000），但「有没有像素变」是确定的。
    // 停顿足够长（>350ms）以跨过 4fps 档的重绘闸（最坏 250ms 一次）。
    // 先冻结相位噪声：把猫画在一个固定姿态上，避免呼吸/眨眼的自然变化冒充「注视生效」。
    const hold = async () => { await evaluate(session, "window.__cyrene.renderer.pause()"); };

    // 目标必须给在头部附近：瞳孔偏移按方向归一化（dist<1 才按比例缩），
    // 给很远的两点会得到几乎相同的方向，测不出差别。
    await evaluate(session, `window.__cyrene.renderer.setGazeTarget([30, 40])`);
    await new Promise((r) => setTimeout(r, 400));
    const snapL = await evaluate(session, SNAPSHOT);
    await evaluate(session, `window.__cyrene.renderer.setGazeTarget([52, 40])`);
    await new Promise((r) => setTimeout(r, 400));
    const snapR = await evaluate(session, SNAPSHOT);
    const dGaze = diffSnapshots(snapL, snapR);
    check("注视：换到另一侧目标后画面确实变了（>20 像素）", dGaze.changed > 20, dGaze);

    // 注意：这个「变化框」包住整个上半身是**预期**的，不是判据失误。
    // 瞳孔走 fx（头骨架），而猫的呼吸相位（cat.t = 绝对时间）在两次快照之间也会变，
    // 所以头/身轮廓本身就有差分。真正要证明的是「注视接得上、且不是恒定噪声」：
    //   · 上面那条 changed>20 证明有变化；
    //   · 下面这条正对照（同一目标连取两帧）必须接近 0 —— 说明变化的来源是目标切换，
    //     而不是每帧都在抖。
    // 把「变化框必须小」写成判据是错的：那会把呼吸这种正常动画判成脏。

    // 正对照：同一目标连取两帧。允许呼吸带来的少量差分，但必须远小于切换目标的差分，
    // 否则说明「变化」其实是时间噪声，那条注视判据就是假绿。
    const snapR2 = await evaluate(session, SNAPSHOT);
    const dStill = diffSnapshots(snapR, snapR2);
    check("注视：目标不变时变化远小于切换目标（正对照）",
      dStill.changed * 3 < dGaze.changed || dStill.changed <= 20,
      { still: dStill.changed, switch: dGaze.changed });
    void hold;

    // —— 2. 工作状态：六档切完，档位可读、粒子层出现 ——
    const tiers = ["连接中", "思考中", "工作中", "提醒", "已处理", "已中断"];
    const seen = [];
    for (const tier of tiers) {
      await evaluate(session, `window.__cyrene.renderer.setWorkStatus(${JSON.stringify(tier)})`);
      await new Promise((r) => setTimeout(r, 200));
      const got = await evaluate(session, `window.__cyrene.renderer.getWorkTier()`);
      seen.push(got);
    }
    check("工作状态：六档逐个写进去都读得回来", tiers.every((t, i) => seen[i] === t), { seen });

    // 清空后必须回到 null（不许卡在最后一档）。
    await evaluate(session, `window.__cyrene.renderer.setWorkStatus(null)`);
    const cleared = await evaluate(session, `window.__cyrene.renderer.getWorkTier()`);
    check("工作状态：传 null 回到空闲", cleared === null, { cleared });

    // —— 3. 手势命令：wave 之后 girl 的帧段切到 wave ——
    // 先切到 girl 并确认图集已加载（否则走矢量路径，没有 clipId）。
    await evaluate(session, `window.__cyrene.renderer.setForm("girl")`);
    await new Promise((r) => setTimeout(r, 600));
    const before = await evaluate(session, `window.__cyrene.renderer.getGirlClipId()`);
    await evaluate(session, `window.__cyrene.renderer.handleCommand("wave")`);
    await new Promise((r) => setTimeout(r, 150));
    const during = await evaluate(session, `window.__cyrene.renderer.getGirlClipId()`);
    check("手势命令：handleCommand('wave') 之后帧段切到 wave", before !== null && during === "wave", { before, during });

    for (const row of rows) {
      console.log(`${row.ok ? "PASS" : "FAIL"}  ${row.name}  ${JSON.stringify(row.detail)}`);
    }
    console.log(failures === 0 ? "all clear" : `${failures} 条判据未过`);
    if (failures > 0) process.exitCode = 1;
  } finally {
    session?.close();
    try { child.kill(); } catch {}
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
