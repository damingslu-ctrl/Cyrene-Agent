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
//   不产数值）；每件的计数都要当场落盘，并在整页重载后还在；成长记录（v1.12 起三行）
//   与徽章/互动读数同源、徽章分母与源码成就表一致。
// - v1.12 六件新玩具 + 两本账 + 雨：抓板（板面补痕→整轮记一次）、铃铛球（点响、冷却吞掉第二下）、
//   发条鼠（抓住计数 / 跑掉不计数只自嘲）、地鼠（只认冒头的那只、同一只不重复计）、
//   抱抱（开场计数并起呼噜、点上身再抱紧）、雨天（氛围层，玩别的也不收雨）；今日小目标与
//   猫咪日记的排版；18 项计数器整页重载后原样回来。
// - v1.13 九件新玩具：追尾巴（尾巴尖三抓→第四下晃晕）、踩奶（踩一拍→整轮记一次并起呼噜）、
//   翻跟头（滞空里点一下翻一圈→整轮记一次）、看书（翻页→整轮记一次）、礼物盒（拆开当场记账）、
//   许愿星（点星当场记账，一颗星一个愿）、跳格子（踩错重来、三格踩满记账）、下雪（三堆拍实
//   立雪人；雨雪互斥两个方向；雪里还能玩独演玩具）、每日抽签（同一天同一张、揭一次才记账）；
//   27 项计数器整页重载后原样回来。
// - v1.17 日常系统：心情/本命/小把戏/小口袋/薄荷盆/躲猫猫六列读数与引擎快照同源；击掌教三次
//   学会并当场落盘；五本账报告各说一句；嗅一件进小口袋；薄荷盆种下后脚边真的多出一点绿、
//   未熟收不了；躲猫猫捂眼点＝太早、探头点中＝逮到（hides+1 落盘）、第二轮没人点只报一次落空。
// - v1.19「她的一天」：`clock`/`festival` 两张嘴的句子按源码表认（报时三行、节日两行/三行）；
//   黄昏那枚记号画在窗角、点它＝一起看天（skies.sunset+1、看完即收、回执同一句），点别处不算；
//   圣诞节头上多一枚蓝星挂饰（同一块头侧区域的像素 A/B）且账本 festive-day 解锁；
//   23:40 人走开满三分钟自己睡（月亮记号随之收掉），05:00 自己伸懒腰醒来（日出记号亮起）。
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
const SCRATCH_START_LINES = sourceLines("GIRL_SCRATCH_START_LINES");
const SCRATCH_LINES = sourceLines("GIRL_SCRATCH_LINES");
const BELL_START_LINES = sourceLines("GIRL_BELL_START_LINES");
const BELL_LINES = sourceLines("GIRL_BELL_LINES");
const MOUSE_START_LINES = sourceLines("GIRL_MOUSE_START_LINES");
const MOUSE_LINES = sourceLines("GIRL_MOUSE_LINES");
const MOUSE_MISS_LINES = sourceLines("GIRL_MOUSE_MISS_LINES");
const MOLE_START_LINES = sourceLines("GIRL_MOLE_START_LINES");
const MOLE_LINES = sourceLines("GIRL_MOLE_LINES");
const MOLE_END_LINES = sourceLines("GIRL_MOLE_END_LINES");
const HUG_START_LINES = sourceLines("GIRL_HUG_START_LINES");
const HUG_LINES = sourceLines("GIRL_HUG_LINES");
const RAIN_START_LINES = sourceLines("GIRL_RAIN_START_LINES");
const TAIL_START_LINES = sourceLines("GIRL_TAIL_START_LINES");
const TAIL_LINES = sourceLines("GIRL_TAIL_LINES");
const TAIL_DIZZY_LINES = sourceLines("GIRL_TAIL_DIZZY_LINES");
const KNEAD_START_LINES = sourceLines("GIRL_KNEAD_START_LINES");
const KNEAD_LINES = sourceLines("GIRL_KNEAD_LINES");
const ROLL_START_LINES = sourceLines("GIRL_ROLL_START_LINES");
const ROLL_LINES = sourceLines("GIRL_ROLL_LINES");
const BOOK_START_LINES = sourceLines("GIRL_BOOK_START_LINES");
const BOOK_LINES = sourceLines("GIRL_BOOK_LINES");
const GIFT_START_LINES = sourceLines("GIRL_GIFT_START_LINES");
const GIFT_LINES = sourceLines("GIRL_GIFT_LINES");
const WISH_START_LINES = sourceLines("GIRL_WISH_START_LINES");
const WISH_LINES = sourceLines("GIRL_WISH_LINES");
const HOP_START_LINES = sourceLines("GIRL_HOP_START_LINES");
const HOP_LINES = sourceLines("GIRL_HOP_LINES");
const HOP_MISS_LINES = sourceLines("GIRL_HOP_MISS_LINES");
const SNOW_START_LINES = sourceLines("GIRL_SNOW_START_LINES");
const SNOWMAN_LINES = sourceLines("GIRL_SNOWMAN_LINES");
const FORTUNE_START_LINES = sourceLines("GIRL_FORTUNE_START_LINES");

/** 签文在 girl-fortune.ts 的 FORTUNE_TIERS 里（渲染端只认档位，句子由引擎给）。 */
function sourceFortuneLines() {
  const src = fs.readFileSync(path.join(ROOT, "src/renderer/pet/girl-fortune.ts"), "utf8");
  const body = src.match(/export const FORTUNE_TIERS[^=]*=\s*\[([\s\S]*?)\]\s*as const/)?.[1];
  if (!body) throw new Error("[ENV] 读不出 FORTUNE_TIERS：抽签的签文没处核对，先看源码");
  return [...body.matchAll(/line:\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse(`"${m[1]}"`));
}
const FORTUNE_LINES = sourceFortuneLines();

/** v1.17 四档心情的显示名：报告第一行「今天的心情 · X」按这张表认。 */
function sourceMoodLabels() {
  const src = fs.readFileSync(path.join(ROOT, "src/renderer/pet/girl-mood.ts"), "utf8");
  const body = src.match(/export const MOOD_LABELS[^=]*=\s*\{([\s\S]*?)\};/)?.[1];
  if (!body) throw new Error("[ENV] 读不出 MOOD_LABELS：心情报告没处核对，先看源码");
  return Object.fromEntries(
    [...body.matchAll(/(\w+):\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => [m[1], JSON.parse(`"${m[2]}"`)]),
  );
}
const MOOD_LABELS = sourceMoodLabels();
const MOOD_IDS = Object.keys(MOOD_LABELS);

/**
 * v1.18 自娱的句子表在 shared/pet-solo.ts：开场句是字典字面量，收场句是 `(n) => \`…${n}…\``
 * 的模板。两处都从源码读，探针不另抄一份——改词、加件都会跟着一起核对。
 */
function sourceSoloLines() {
  const src = fs.readFileSync(path.join(ROOT, "src/shared/pet-solo.ts"), "utf8");
  const start = src.match(/const SOLO_START[^;]*?=\s*\{([\s\S]*?)\n\};/)?.[1];
  const end = src.match(/const SOLO_END[^;]*?=\s*\{([\s\S]*?)\n\};/)?.[1];
  if (!start || !end) throw new Error("[ENV] 读不出 SOLO_START/SOLO_END：自娱的句子没处核对，先看源码");
  const starts = Object.fromEntries(
    [...start.matchAll(/(\w+):\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => [m[1], JSON.parse(`"${m[2]}"`)]),
  );
  const ends = Object.fromEntries(
    [...end.matchAll(/(\w+):\s*\(n\)\s*=>\s*`([^`]*)`/g)].map((m) => [m[1], m[2]]),
  );
  const kinds = src.match(/export const SOLO_KINDS\s*=\s*\[([\s\S]*?)\]\s*as const/)?.[1];
  if (!kinds) throw new Error("[ENV] 读不出 SOLO_KINDS：自娱有几件玩具没处核对，先看源码");
  const list = [...kinds.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
  const idle = src.match(/export const SOLO_IDLE_LINE\s*=\s*"((?:[^"\\]|\\.)*)"/)?.[1];
  const empty = src.match(/export const SOLO_EMPTY_LINE\s*=\s*"((?:[^"\\]|\\.)*)"/)?.[1];
  if (!idle || !empty) throw new Error("[ENV] 读不出 SOLO_IDLE_LINE/SOLO_EMPTY_LINE：零战果的说法没处核对");
  return { kinds: list, starts, ends, idle: JSON.parse(`"${idle}"`), empty: JSON.parse(`"${empty}"`) };
}
const SOLO = sourceSoloLines();
/** 收场句按源码模板拼：`皮球连到 ${n} 下` 这种带数字的一句，探针只认拼出来的那一条。 */
const soloEndLine = (kind, n) => (SOLO.ends[kind] ?? "").split("${n}").join(String(n));

/**
 * 皮球的落地拍是解析量（周期 820ms、落地前后各 260ms），三个数都在 `girl-ball.ts`。
 * 探针按源码常量算「下一次落地后多久点」，不抄数字：改了周期探针跟着改点法，
 * 不会出现「产品改了、探针还按老拍子点」那种假红。
 */
function sourceBallTiming() {
  const src = fs.readFileSync(path.join(ROOT, "src/renderer/pet/girl-ball.ts"), "utf8");
  const num = (name) => {
    const hit = src.match(new RegExp(`export const ${name}\\s*=\\s*([\\d_]+)`));
    if (!hit) throw new Error(`[ENV] 读不出 girl-ball.ts 的 ${name}：落地拍窗没处算，先看源码`);
    return Number(hit[1].replace(/_/g, ""));
  };
  return { ms: num("BALL_MS"), period: num("BALL_PERIOD_MS"), window: num("BALL_WINDOW_MS"), cooldown: num("BALL_COOLDOWN_MS") };
}
const BALL = sourceBallTiming();

/**
 * 每件玩具落到账本上的字段名（`SOLO_FIELD`）也从源码读：探针不许自己拼 `ballBest` 这种键，
 * 否则改了字段名会「探针读不到→当成 0→看着像没记账」那种假红。
 */
function sourceSoloFieldMap() {
  const src = fs.readFileSync(path.join(ROOT, "src/shared/pet-solo.ts"), "utf8");
  const body = src.match(/export const SOLO_FIELD[^;]*?=\s*\{([\s\S]*?)\n\};/)?.[1];
  if (!body) throw new Error("[ENV] 读不出 SOLO_FIELD：自娱账本的字段名没处核对，先看源码");
  const map = Object.fromEntries([...body.matchAll(/(\w+):\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => [m[1], m[2]]));
  if (Object.keys(map).length === 0) throw new Error("[ENV] SOLO_FIELD 读出来是空的：尺子坏了，不是账本空着");
  return map;
}
const SOLO_FIELD_READ = sourceSoloFieldMap();

/**
 * 页面内的一轮玩具：读坐标与点下去必须落在同一拍里，所以整轮写在页面里跑。
 * 每步都先 `draw()` 催一帧——Electron 后台把 rAF 压得很稀，不催就读不到推进后的读数。
 * 坐标一律「设计空间 × layout.zoom」（tapAt 吃窗口 CSS 坐标），且每次点前现读，不缓存。
 *
 * 这段是**注入页面的源码字符串**，内部不许出现模板插值；判据仍由 Node 侧算，页面只带样本回来。
 */
const SOLO_PROBE_SRC = `(() => {
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  const D = () => window.__cyrene.getPetDiagnostics();
  const frame = () => { try { window.__cyrene.renderer.draw(performance.now()); } catch (e) { /* 催不动帧：照旧读同一拍 */ } };
  const click = (x, y, z) => { window.__cyrene.renderer.tapAt(x * z, y * z, 40); };
  window.__soloProbe = {
    ballRound: async (count, period, life, win) => {
      const out = [];
      for (let i = 0; i < count; i += 1) {
        frame();
        const b = D().girl.ball;
        if (!b) { out.push({ i: i, gone: true }); break; }
        const age = life - b.left;
        const local = age - Math.floor(age / period) * period;
        const waitMs = ((period - local) % period) + Math.round(win / 3);
        await sleep(waitMs);
        const g = D();
        const now = g.girl.ball;
        if (!now) { out.push({ i: i, gone: true }); break; }
        click(now.x, now.y, g.layout.zoom);
        frame();
        const a = D().girl.ball;
        out.push({ i: i, waitMs: waitMs, x: now.x, y: now.y, r: now.r,
          bounces: a ? a.bounces : null, streak: a ? a.streak : null,
          drops: a ? a.drops : null, best: a ? a.best : null, left: a ? Math.round(a.left) : null });
      }
      return out;
    },
    lanternRound: async (pats, gap, mothMs) => {
      const taps = [];
      for (let i = 0; i < pats; i += 1) {
        frame();
        const g = D();
        const l = g.girl.lantern;
        if (!l) { taps.push({ i: i, gone: true }); break; }
        click(l.x, l.y, g.layout.zoom);
        frame();
        const a = D().girl.lantern;
        taps.push({ i: i, flares: a ? a.flares : null, glow: a ? Math.round(a.glow * 100) / 100 : null });
        await sleep(gap);
      }
      const tries = [];
      const deadline = performance.now() + mothMs;
      for (;;) {
        if (performance.now() >= deadline) break;
        const g = D();
        const l = g.girl.lantern;
        if (!l) { tries.push({ gone: true }); break; }
        const far = Math.hypot(l.moth.x - l.x, l.moth.y - l.y);
        if (far > 7) {
          const before = l.scares;
          click(l.moth.x, l.moth.y, g.layout.zoom);
          frame();
          const a = D().girl.lantern;
          tries.push({ far: Math.round(far * 10) / 10, before: before, after: a ? a.scares : null });
          if (a && a.scares > before) break;
        }
        await sleep(60);
      }
      return { taps: taps, mothTries: tries };
    },
    fishRound: async (step, maxMs) => {
      const hits = [];
      const phases = [];
      let last = 0;
      const deadline = performance.now() + maxMs;
      for (;;) {
        if (performance.now() >= deadline) break;
        frame();
        const g = D();
        const f = g.girl.fishing;
        if (!f) { break; }
        if (phases.indexOf(f.phase) < 0) phases.push(f.phase);
        if (f.phase === 'bite') {
          click(f.x, f.y, g.layout.zoom);
          frame();
          const a = D().girl.fishing;
          if (a && a.catches > last) {
            last = a.catches;
            hits.push({ catches: a.catches, misses: a.misses, left: Math.round(a.left) });
          }
        }
        await sleep(step);
      }
      return { hits: hits, phases: phases };
    },
    /**
     * 照镜子：每次「她在做脸」就点镜面。maxTaps 是刻意留的上限——镜子每点一下都算接住，
     * 按 220ms 一路点下去一轮能攒到 32，越过 mirror-friend（12）那一档，收场句就被徽章顶掉，
     * 「账本报数」这条就量不到了。点够几张脸就收手，把收场句留给这一轮自己。
     */
    mirrorRound: async (gap, maxMs, maxTaps) => {
      const marks = [];
      const faces = [];
      let last = 0;
      const deadline = performance.now() + maxMs;
      for (;;) {
        if (performance.now() >= deadline) break;
        if (maxTaps && marks.length >= maxTaps) break;
        frame();
        const g = D();
        const m = g.girl.mirror;
        if (!m) { break; }
        if (m.expression) {
          if (faces.indexOf(m.expression) < 0) faces.push(m.expression);
          click(m.x + m.w / 2, m.y + m.h / 2, g.layout.zoom);
          frame();
          const a = D().girl.mirror;
          if (a && a.matched > last) {
            last = a.matched;
            marks.push({ expr: m.expression, matched: a.matched, streak: a.streak, best: a.best });
          }
        }
        await sleep(gap);
      }
      return { marks: marks, faces: faces };
    },
    comboRound: async (gap, maxMs) => {
      const claps = [];
      const steps = [];
      let last = 0;
      let tail = null;
      const deadline = performance.now() + maxMs;
      for (;;) {
        if (performance.now() >= deadline) break;
        frame();
        const g = D();
        const c = g.girl.combo;
        if (!c) { break; }
        if (steps.indexOf(c.step) < 0) steps.push(c.step);
        const h = g.hitRect;
        click(h.x + h.width / 2, h.y + h.height * 0.55, g.layout.zoom);
        frame();
        const a = D().girl.combo;
        tail = a;
        if (a && a.claps > last) {
          last = a.claps;
          claps.push({ step: c.step, steps: c.steps, claps: a.claps, streak: a.streak, best: a.best });
        }
        await sleep(gap);
      }
      return { claps: claps, steps: steps, stepsTotal: tail ? tail.steps : null,
        final: tail ? { claps: tail.claps, streak: tail.streak, best: tail.best } : null };
    },
    sfxWatch: async (ms) => {
      const before = D().girl.sfx;
      const deadline = performance.now() + ms;
      let ticks = 0;
      for (;;) {
        if (performance.now() >= deadline) break;
        frame();
        ticks += 1;
        await sleep(120);
      }
      return { before: before, after: D().girl.sfx, ticks: ticks };
    },
  };
  return true;
})()`;

/** 小目标回执也走同一个气泡（pendingLine 在气泡空下来时说），收尾句可能被它顶掉。 */
const QUEST_DONE_LINES = [
  ...sourceBlockLines("GIRL_QUEST_DONE_LINES"),
  ...sourceLines("GIRL_QUESTS_DONE_LINES"),
];

/** v1.12 那 18 项计数器：v1.13 的九件会让总数变长，这里的「原样回来」只钉这 18 项。 */
const V12_STAT_KEYS = [
  "pats", "catches", "wand", "bubbles", "pounces",
  "boxes", "lasers", "brushes", "catnips", "planes",
  "scratches", "bells", "mice", "moles", "hugs", "purrs", "rains", "quests",
];
const pickStats = (stats, keys) => Object.fromEntries(keys.map((k) => [k, stats?.[k] ?? null]));

/** 成就台词在 girl-achievements.ts：验收按表认，不在探针里另抄。 */
function sourceAchievementLine(id) {
  const src = fs.readFileSync(path.join(ROOT, "src/renderer/pet/girl-achievements.ts"), "utf8");
  const hit = src.match(new RegExp(`id:\\s*"${id}"[^}]*?line:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
  if (!hit) throw new Error(`[ENV] 读不出成就 ${id} 的台词：验收句子表都没了，先看源码`);
  return JSON.parse(`"${hit[1]}"`);
}

/** 徽章总数：成长记录里的「徽章 n/总数」分母必须和源码数组一致。 */
function sourceAchievementCount() {
  const src = fs.readFileSync(path.join(ROOT, "src/renderer/pet/girl-achievements.ts"), "utf8");
  const body = src.match(/export const ACHIEVEMENT_IDS\s*=\s*\[([\s\S]*?)\]\s*as\s+const/)?.[1];
  if (!body) throw new Error("[ENV] 读不出 ACHIEVEMENT_IDS：成长记录的分母没处核对，先看源码");
  return [...body.matchAll(/"((?:[^"\\]|\\.)*)"/g)].length;
}

const FIRST_CATCH_LINE = sourceAchievementLine("first-catch");
const FIRST_WAND_LINE = sourceAchievementLine("first-wand");
const ACHIEVEMENT_COUNT = sourceAchievementCount();

/**
 * v1.19 她的一天：时辰表、天色台词、节日表、窗角记号的位置全从源码读。
 * 探针只负责「拨表 → 按表算期望」，不另抄一份标签/句子——改词就会一起红。
 */
function sourcePhaseTable() {
  const src = fs.readFileSync(path.join(ROOT, "src/renderer/pet/girl-clock.ts"), "utf8");
  const body = src.match(/export const PHASES[^=]*=\s*\[([\s\S]*?)\]\s*as const/)?.[1];
  if (!body) throw new Error("[ENV] 读不出 PHASES：时辰表没处核对，先看源码");
  return [...body.matchAll(/phase:\s*"(\w+)",\s*label:\s*"([^"]+)",\s*fromMinute:\s*([\d\s*+]+),\s*sky:\s*(?:null|"(\w+)")/g)]
    .map((m) => ({
      phase: m[1],
      label: m[2],
      // `5 * 60` 这种算式按乘号拆开算，不拿 eval 开洞。
      fromMinute: m[3].split("*").reduce((acc, part) => acc * Number(part.trim()), 1),
      sky: m[4] ?? null,
    }));
}

function sourceSkyLines() {
  const src = fs.readFileSync(path.join(ROOT, "src/renderer/pet/girl-clock.ts"), "utf8");
  const body = src.match(/const SKY_LINES[^=]*=\s*\{([\s\S]*?)\};/)?.[1];
  if (!body) throw new Error("[ENV] 读不出 SKY_LINES：天色台词没处核对，先看源码");
  return Object.fromEntries(
    [...body.matchAll(/(\w+):\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => [m[1], JSON.parse(`"${m[2]}"`)]),
  );
}

function sourceFestivals() {
  const src = fs.readFileSync(path.join(ROOT, "src/renderer/pet/girl-festival.ts"), "utf8");
  const body = src.match(/export const FESTIVALS[^=]*=\s*\[([\s\S]*?)\]\s*as const/)?.[1];
  if (!body) throw new Error("[ENV] 读不出 FESTIVALS：节日表没处核对，先看源码");
  return [...body.matchAll(
    /\{\s*id:\s*"([\w-]+)",\s*month:\s*(\d+),\s*day:\s*(\d+),\s*label:\s*"([^"]+)",\s*line:\s*"([^"]+)",\s*ornament:\s*"(\w+)"/g,
  )].map((m) => ({
    id: m[1], month: Number(m[2]), day: Number(m[3]), label: m[4], line: m[5], ornament: m[6],
  }));
}

/** 窗角那枚记号的位置：命中的点必须落在真画出来的那枚上。 */
function sourceSkyMark() {
  const src = fs.readFileSync(path.join(ROOT, "src/renderer/pet/girl-day-art.ts"), "utf8");
  const body = src.match(/export const SKY_MARK[^=]*=\s*\{([\s\S]*?)\};/)?.[1];
  if (!body) throw new Error("[ENV] 读不出 SKY_MARK：天色记号没处核对，先看源码");
  return Object.fromEntries([...body.matchAll(/(\w+):\s*(-?[\d.]+)/g)].map((m) => [m[1], Number(m[2])]));
}

/** 两张汇报嘴的模板：固定字从引擎源码抄，时刻/节日/天数由探针按上面几张表算。 */
function sourceReportTemplates() {
  const src = fs.readFileSync(path.join(ROOT, "src/renderer/pet/companion.ts"), "utf8");
  const clock = src.match(/`([^`]*\$\{clockLine\(wall\)\}[^`]*)`/)?.[1];
  const plain = src.match(/`([^`]*今天不是节日[^`]*)`/)?.[1];
  const today = src.match(/`([^`]*今天是 \$\{today\.label\}[^`]*)`/)?.[1];
  if (!clock || !plain || !today) throw new Error("[ENV] 读不出报时/节日模板：验收句子没处核对，先看源码");
  // 源码里的 `\n` 是字面量，气泡里的是真换行。
  const unesc = (text) => text.replace(/\\n/g, "\n");
  return { clock: unesc(clock), plain: unesc(plain), today: unesc(today) };
}

const PHASES = sourcePhaseTable();
const SKY_LINES = sourceSkyLines();
const FESTIVALS = sourceFestivals();
const SKY_MARK = sourceSkyMark();
const REPORT_TPL = sourceReportTemplates();

const phaseOfMinute = (minute) => PHASES.reduce((acc, p) => (minute >= p.fromMinute ? p : acc), PHASES[0]);
const clockLineOf = (wallMs) => {
  const d = new Date(wallMs);
  const minute = d.getHours() * 60 + d.getMinutes();
  return `${phaseOfMinute(minute).label} · ${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
};
const festivalOnOf = (wallMs) => {
  const d = new Date(wallMs);
  return FESTIVALS.find((f) => f.month === d.getMonth() + 1 && f.day === d.getDate()) ?? null;
};
/** 严格在「今天之后」的第一个节日：按日历逐日找，不调用产品的 nextFestival。 */
const nextFestivalOf = (wallMs) => {
  const d = new Date(wallMs);
  const start = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  for (let day = 1; day <= 370; day += 1) {
    const t = new Date(start + day * 86_400_000);
    const hit = FESTIVALS.find((f) => f.month === t.getUTCMonth() + 1 && f.day === t.getUTCDate());
    if (hit) return { def: hit, days: day };
  }
  throw new Error("[ENV] 一年内找不到下一个节日：节日表坏了");
};
const fillReport = (tpl, vars) => tpl.replace(/\$\{([^}]+)\}/g, (whole, expr) => {
  const key = expr.trim();
  if (!(key in vars)) throw new Error(`[ENV] 汇报模板里出现没约定的量 ${key}：先从源码补断言`);
  return String(vars[key]);
});

/** 当前在展示的徽章台词（没在展示＝null）：用来认「徽章按设计压过了玩具句」。 */
function shownAchievementLine(girl) {
  const id = girl?.achievement?.id;
  return id ? { id, line: sourceAchievementLine(id) } : null;
}

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

/**
 * v1.18 自娱用的「页面内跑完一整轮」：读坐标与点下去必须发生在同一拍里。
 *
 * CDP 一次往返 30–80ms，而皮球的拍窗是 ±260ms、咬钩窗 900ms、台本拍点是每段最后 400ms——
 * 用 Node 侧循环去「先读后点」，点下去时那一拍早就过去了，量到的是探针的腿脚不利索，
 * 不是玩具没接住。所以整轮放在页面里跑完，一次性把逐拍样本带回来。
 */
async function evaluateInPage(session, expression, timeoutMs = 45_000) {
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
  /**
   * 结算与待机编排都挂在渲染帧上（prop 过期后的下一帧才走 engine.*End；段位也要靠一帧推进），
   * 而 Electron 在后台/离屏时会把 rAF 压得很稀。探针手动催一帧再读，避免把「还没结算」
   * 误判成「没记上」、把「还没换段」误判成「编排没动」。
   */
  const forceFrame = () => evaluate(s, `(() => {
    try {
      window.__cyrene.renderer.draw(performance.now());
      return true;
    } catch {
      return false;
    }
  })()`);
  const waitStat = async (key, target, timeoutMs = 2_500) => {
    const deadline = Date.now() + timeoutMs;
    let value = null;
    for (;;) {
      await forceFrame();
      value = (await diag()).girl.stats[key];
      if (value === target || Date.now() >= deadline) return value;
      await wait(120);
    }
  };
  const waitPropGone = async (key, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    let prop = null;
    for (;;) {
      await forceFrame();
      prop = (await diag()).girl[key] ?? null;
      if (!prop || Date.now() >= deadline) return prop;
      await wait(160);
    }
  };
  /** 收尾句要等 prop 过期后的那一帧才由引擎说：帧被压稀时立即读只会读到上一句。 */
  const waitBubbleLine = async (table, timeoutMs = 2_500) => {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    for (;;) {
      await forceFrame();
      const n = await snap();
      last = n.bubble?.text ?? null;
      if (last && (table.includes(last) || BOND_UP_LINES.includes(last) || QUEST_DONE_LINES.includes(last))) {
        return last;
      }
      if (Date.now() >= deadline) return last;
      await wait(120);
    }
  };
  /** 玩具开工的门禁现场：区分「渲染端本地闸」与「引擎闸」，只在第一次没起来时落盘。 */
  const toyGate = () => evaluate(s, `(() => {
    const r = window.__cyrene.renderer;
    let snapshot = null;
    try { snapshot = r.getCompanionSnapshot(); } catch { /* 旧构建没引擎口也照样报本地闸 */ }
    return {
      form: r.form ?? null,
      quiet: !!r.quiet,
      dragging: !!r.dragging,
      paused: !!r.paused,
      catMood: r.cat?.mood ?? null,
      drawAgeMs: typeof r.lastDrawAt === "number" ? Math.round(performance.now() - r.lastDrawAt) : null,
      fps: r.fps ?? null,
      activity: snapshot?.activity ?? null,
      snapMood: snapshot?.mood ?? null,
      dizzyLeft: Math.round(snapshot?.dizzyLeft ?? 0),
      now: Math.round(performance.now()),
    };
  })()`);
  /**
   * 起一件独演玩具。**第一次点下去的结果才是判据**（该红就红），失败时把门禁现场
   * 写进报告、并只补一次重试——重试只为把后面的点击从连环红里捞出来，不改判据。
   * 道具出生按帧轮询：CDP 往返可能已经跨过第一个短相。
   */
  const startToy = async (command, key, where) => {
    const arm = async () => {
      await evaluate(s, `window.__cyrene.renderer.handleCommand(${JSON.stringify(command)})`);
      let prop = null;
      for (let i = 0; i < 12; i += 1) {
        await forceFrame();
        prop = (await diag()).girl[key] ?? null;
        if (prop) break;
        await wait(140);
      }
      return prop;
    };
    await dismissBubble();
    await wait(260);
    const gateBefore = await toyGate();
    const first = await arm();
    const out = { where, command, first, prop: first, retried: false, gateBefore };
    if (!first) {
      out.gateRejected = await toyGate();
      out.retried = true;
      out.prop = await arm();
      out.gateAfterRetry = await toyGate();
    }
    results.toyGates ??= [];
    results.toyGates.push(out);
    return out;
  };
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
  /** v1.12：重载前的 18 项计数快照，M 段拿它核对「计数器原样回来」。 */
  let v12StatsForReload = null;
  /** v1.13：重载前的 27 项计数快照（九件新玩具各走完一轮之后）。 */
  let v13StatsForReload = null;
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
  // 睡着不接地面玩具是产品设计（renderer-girl-toys2 的锁）——夜里跑探针时她可能真睡着了，
  // 探针要玩玩具就得先按菜单同一条命令叫醒，否则测到的是「设计静默拒收」而不是玩具。
  const awakeForPlay = async (why) => {
    const cur = await snap();
    if (cur.activity !== "sleep") return cur;
    await evaluate(s, `window.__cyrene.renderer.handleCommand("toggle-sleep")`);
    await wait(360);
    await dismissBubble();
    await wait(200);
    const woke = await snap();
    results.awake ??= {};
    results.awake[why] = { woke: woke.activity !== "sleep", activity: woke.activity };
    check(`awake.${why}`, woke.activity !== "sleep",
      `叫醒后 activity=${woke.activity}（${why} 的前置条件没摆正）`);
    return woke;
  };
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
    ? { activity: restSnap.activity, clip: restDiag.girl.clip, pose: restDiag.girl.pose }
    : { lastSeen };
  // 坐下那一帧可能还挂着起身前抽到的小动作（peek 等一次性段）：等它演完再看基础段。
  // v1.14 起「坐」是真姿态格：基准段是 pose=sit + clip=null，不再是一段循环的 sit 帧动画。
  let restPose = restDiag?.girl.pose ?? null;
  let restClip = restDiag?.girl.clip ?? null;
  let restGesture = restDiag?.girl.gesture ?? null;
  if (restSnap) {
    const restClipDeadline = Date.now() + 2_500;
    for (;;) {
      const d = await diag();
      restPose = d.girl.pose;
      restClip = d.girl.clip;
      restGesture = d.girl.gesture;
      if ((restPose === "sit" && restClip === null && restGesture === null) || Date.now() >= restClipDeadline) break;
      await wait(120);
    }
  }
  results.rest.clipSettled = { pose: restPose, clip: restClip, gesture: restGesture };
  check("rest.starts", !!restSnap, restSnap ? "rest" : `56s 内没坐下；最后一次看到的快照=${JSON.stringify(lastSeen)}`);
  check("rest.pose", restPose === "sit" && restClip === null,
    `pose=${restPose ?? "null"} clip=${restClip ?? "null"} gesture=${restGesture ?? "null"}`);
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
    check("box.line", !!boxCSnap.bubble
      && (BOX_CATCH_LINES.includes(boxCSnap.bubble.text) || BOND_UP_LINES.includes(boxCSnap.bubble.text)),
      `bubble=${boxCSnap.bubble?.text ?? "null"}`
        + (BOND_UP_LINES.includes(boxCSnap.bubble?.text) ? "（升档优先，捉箱那句按设计让位）" : ""));
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
    check("laser.line",
      !!laserCSnap.bubble
        && (LASER_LINES.includes(laserCSnap.bubble.text)
          || BOND_UP_LINES.includes(laserCSnap.bubble.text)
          || QUEST_DONE_LINES.includes(laserCSnap.bubble.text)
          || shownAchievementLine(laserC.girl)?.line === laserCSnap.bubble.text),
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
    const catnipStart = await startToy("catnip", "catnip", "O4");
    const catnipASnap = await snap();
    results.catnip = { start: catnipStart, a: catnipStart.first, bubble: catnipASnap.bubble?.text ?? null };
    await shot("girl-catnip.png");
    check("catnip.spawn",
      !!catnipStart.first && ["sniff", "roll"].includes(catnipStart.first.phase)
        && catnipStart.first.left > 5_000,
      `first=${JSON.stringify(catnipStart.first)}`);
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
    const catnipLast = await waitPropGone("catnip", 7_500);
    if (!catnipLast) await waitStat("catnips", v11Before.catnips + 1);
    const catnipLine = catnipLast ? null : await waitBubbleLine(CATNIP_LINES);
    const catnipDone = await diag();
    const catnipDoneSnap = await snap();
    const bondAfterCatnip = await bondNow();
    results.catnip.done = {
      stats: catnipDone.girl.stats,
      bubble: catnipLine ?? catnipDoneSnap.bubble?.text ?? null,
    };
    check("catnip.done", !catnipLast && catnipDone.girl.stats.catnips === v11Before.catnips + 1,
      `catnip=${JSON.stringify(catnipLast)} stats=${JSON.stringify(catnipDone.girl.stats)}`);
    check("catnip.line", !!catnipLine, `bubble=${catnipLine ?? "null"}`);
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

    // O7 成长记录：v1.12 起三行（徽章与互动各占一行，78px 内宽不折行）；
    // 徽章数与互动总数必须和读数同源（不许另算一套），分母按源码成就表核。
    await evaluate(s, `window.__cyrene.renderer.handleCommand("growth")`);
    await wait(200);
    const growthSnap = await snap();
    const growthDiag = await diag();
    const growthText = growthSnap.bubble?.text ?? "";
    const growthLines = growthText.split("\n");
    const growthStats = growthDiag.girl.stats;
    const growthTotal = Object.values(growthStats).reduce((acc, n) => acc + n, 0);
    const growthBadge = growthLines[1]?.match(/^徽章 (\d+)\/(\d+)$/);
    const growthTotalLine = growthLines[2]?.match(/^互动 (\d+) 次$/);
    results.growth = {
      text: growthText,
      achievements: growthDiag.girl.achievements.length,
      total: growthTotal,
      stats: growthStats,
    };
    await shot("girl-growth.png");
    check("growth.lines",
      growthLines.length === 3 && / · 第 \d+ 天$/.test(growthLines[0] ?? "")
        && !!growthBadge && !!growthTotalLine,
      `bubble=${JSON.stringify(growthText)}`);
    check("growth.agrees",
      !!growthBadge && !!growthTotalLine
        && Number(growthBadge[1]) === growthDiag.girl.achievements.length
        && Number(growthBadge[2]) === ACHIEVEMENT_COUNT
        && Number(growthTotalLine[1]) === growthTotal,
      `徽章=${growthBadge?.[1]}/${growthBadge?.[2]}（源码 ${ACHIEVEMENT_COUNT}）`
        + ` achievements=${growthDiag.girl.achievements.length}`
        + ` 互动=${growthTotalLine?.[1]} total=${growthTotal}`);

    // —— P. v1.12.0：抓板 / 铃铛球 / 发条鼠 / 地鼠 / 抱抱+呼噜 / 雨天 / 两本账 ——
    // 六件玩具各演一轮，验「出生 → 命中/整轮结算 → 落盘」；雨天是氛围层，单独验
    // 「玩别的也不收雨」。最后把 18 项 stats 原样交给 reload 段核对。
    const v12Before = (await diag()).girl.stats;

    // P1 猫抓板：进场 600ms → 板面点一下补一道痕（当场不结算）→ 整轮 5.2s 才记一次。
    await awakeForPlay("scratch");
    await dismissBubble();
    await wait(260);
    await evaluate(s, `window.__cyrene.renderer.handleCommand("scratch")`);
    await wait(240);
    const scratchA = await diag();
    const scratchASnap = await snap();
    results.scratch = { a: scratchA.girl.scratch, bubble: scratchASnap.bubble?.text ?? null };
    await shot("girl-scratch.png");
    check("scratch.spawn",
      !!scratchA.girl.scratch && scratchA.girl.scratch.phase === "enter" && scratchA.girl.scratch.left > 4_400,
      `scratch=${JSON.stringify(scratchA.girl.scratch)}`);
    check("scratch.line", !!scratchASnap.bubble && SCRATCH_START_LINES.includes(scratchASnap.bubble.text),
      `bubble=${scratchASnap.bubble?.text ?? "null"}`);
    await wait(520);
    const scratchTap = await evaluate(s, `(() => {
      const d = window.__cyrene.getPetDiagnostics();
      const b = d.girl.scratch;
      if (!b) return { ok: false, why: "scratch gone" };
      const z = d.layout.zoom;
      window.__cyrene.renderer.tapAt(b.x * z, b.y * z, 40);
      return { ok: true, x: b.x, y: b.y, phase: b.phase };
    })()`);
    await wait(200);
    const scratchB = await diag();
    results.scratch.tap = { attempt: scratchTap, scratch: scratchB.girl.scratch, stats: scratchB.girl.stats };
    check("scratch.tap",
      !!scratchTap?.ok && (scratchB.girl.scratch?.marks ?? 0) >= 1
        && scratchB.girl.stats.scratches === v12Before.scratches,
      `attempt=${JSON.stringify(scratchTap)} scratch=${JSON.stringify(scratchB.girl.scratch)} stats=${JSON.stringify(scratchB.girl.stats)}`);
    const scratchDeadline = Date.now() + 7_000;
    let scratchLast = scratchB.girl.scratch;
    while (Date.now() < scratchDeadline) {
      scratchLast = (await diag()).girl.scratch;
      if (!scratchLast) break;
      await wait(180);
    }
    // 板子退场只说明 prop 到点了；引擎的结算挂在**退场后的那一帧绘制**里。
    // 姿态待机是 12fps，探针这一秒可能正好停在两帧之间，先强推一帧并等统计落账。
    await forceFrame();
    const scratchCount = await waitStat("scratches", v12Before.scratches + 1, 2_000);
    const scratchDone = await diag();
    const scratchDoneSnap = await snap();
    const bondAfterScratch = await bondNow();
    results.scratch.done = {
      stats: scratchDone.girl.stats, bubble: scratchDoneSnap.bubble?.text ?? null, waited: scratchCount,
    };
    check("scratch.done", !scratchLast && scratchDone.girl.stats.scratches === v12Before.scratches + 1,
      `scratch=${JSON.stringify(scratchLast)} stats=${JSON.stringify(scratchDone.girl.stats)} waited=${scratchCount}`);
    check("scratch.line-done", !!scratchDoneSnap.bubble && SCRATCH_LINES.includes(scratchDoneSnap.bubble.text),
      `bubble=${scratchDoneSnap.bubble?.text ?? "null"}`);
    check("scratch.persist", bondAfterScratch?.stats?.scratches === scratchDone.girl.stats.scratches,
      `bond.stats=${JSON.stringify(bondAfterScratch?.stats ?? null)}`);

    // P2 铃铛球：点响第一声 → 冷却内第二下被吞掉（不重复计）→ 冷却外第三下才再响。
    await awakeForPlay("bell");
    await dismissBubble();
    await wait(260);
    await evaluate(s, `window.__cyrene.renderer.handleCommand("bell")`);
    await wait(240);
    const bellA = await diag();
    const bellASnap = await snap();
    results.bell = { a: bellA.girl.bell, bubble: bellASnap.bubble?.text ?? null };
    await shot("girl-bell.png");
    check("bell.spawn",
      !!bellA.girl.bell && bellA.girl.bell.rings === 0 && bellA.girl.bell.left > 4_600,
      `bell=${JSON.stringify(bellA.girl.bell)}`);
    check("bell.line", !!bellASnap.bubble && BELL_START_LINES.includes(bellASnap.bubble.text),
      `bubble=${bellASnap.bubble?.text ?? "null"}`);
    const bellTap1 = await evaluate(s, `(() => {
      const d = window.__cyrene.getPetDiagnostics();
      const b = d.girl.bell;
      if (!b) return { ok: false, why: "bell gone" };
      const z = d.layout.zoom;
      window.__cyrene.renderer.tapAt(b.x * z, b.y * z, 40);
      return { ok: true, x: b.x, y: b.y };
    })()`);
    await wait(160);
    const bellB = await diag();
    const bellBSnap = await snap();
    results.bell.ring = { attempt: bellTap1, bell: bellB.girl.bell, stats: bellB.girl.stats, bubble: bellBSnap.bubble?.text ?? null };
    check("bell.ring",
      !!bellTap1?.ok && bellB.girl.bell?.rings === 1 && bellB.girl.stats.bells === v12Before.bells + 1,
      `attempt=${JSON.stringify(bellTap1)} bell=${JSON.stringify(bellB.girl.bell)} stats=${JSON.stringify(bellB.girl.stats)}`);
    check("bell.ring-line", !!bellBSnap.bubble && BELL_LINES.includes(bellBSnap.bubble.text),
      `bubble=${bellBSnap.bubble?.text ?? "null"}`);
    await wait(120);
    const bellTap2 = await evaluate(s, `(() => {
      const d = window.__cyrene.getPetDiagnostics();
      const b = d.girl.bell;
      if (!b) return { ok: false, why: "bell gone" };
      const z = d.layout.zoom;
      window.__cyrene.renderer.tapAt(b.x * z, b.y * z, 40);
      return { ok: true, x: b.x, y: b.y };
    })()`);
    await wait(160);
    const bellC = await diag();
    results.bell.cooldown = { attempt: bellTap2, bell: bellC.girl.bell, stats: bellC.girl.stats };
    check("bell.cooldown",
      !!bellTap2?.ok && bellC.girl.bell?.rings === 1 && bellC.girl.stats.bells === v12Before.bells + 1,
      `attempt=${JSON.stringify(bellTap2)} bell=${JSON.stringify(bellC.girl.bell)} stats=${JSON.stringify(bellC.girl.stats)}`);
    await wait(200);
    const bellTap3 = await evaluate(s, `(() => {
      const d = window.__cyrene.getPetDiagnostics();
      const b = d.girl.bell;
      if (!b) return { ok: false, why: "bell gone" };
      const z = d.layout.zoom;
      window.__cyrene.renderer.tapAt(b.x * z, b.y * z, 40);
      return { ok: true, x: b.x, y: b.y };
    })()`);
    await wait(160);
    const bellD = await diag();
    results.bell.again = { attempt: bellTap3, bell: bellD.girl.bell, stats: bellD.girl.stats };
    check("bell.again",
      !!bellTap3?.ok && bellD.girl.bell?.rings === 2 && bellD.girl.stats.bells === v12Before.bells + 2,
      `attempt=${JSON.stringify(bellTap3)} bell=${JSON.stringify(bellD.girl.bell)} stats=${JSON.stringify(bellD.girl.stats)}`);
    const bellDeadline = Date.now() + 7_000;
    let bellLast = bellD.girl.bell;
    while (Date.now() < bellDeadline) {
      bellLast = (await diag()).girl.bell;
      if (!bellLast) break;
      await wait(180);
    }
    check("bell.gone", !bellLast, `bell=${JSON.stringify(bellLast)}`);

    // P3 发条鼠：点中算抓住并计数；第二轮不点，等它跑掉只自嘲，不产出数值。
    await awakeForPlay("mouse");
    await dismissBubble();
    await wait(260);
    await evaluate(s, `window.__cyrene.renderer.handleCommand("mouse")`);
    await wait(300);
    const mouseA = await diag();
    const mouseASnap = await snap();
    results.mouse = { a: mouseA.girl.mouse, bubble: mouseASnap.bubble?.text ?? null };
    await shot("girl-mouse.png");
    check("mouse.spawn",
      !!mouseA.girl.mouse && mouseA.girl.mouse.caught === false && mouseA.girl.mouse.left > 5_400,
      `mouse=${JSON.stringify(mouseA.girl.mouse)}`);
    check("mouse.line", !!mouseASnap.bubble && MOUSE_START_LINES.includes(mouseASnap.bubble.text),
      `bubble=${mouseASnap.bubble?.text ?? "null"}`);
    const mouseTap = await evaluate(s, `(() => {
      const d = window.__cyrene.getPetDiagnostics();
      const m = d.girl.mouse;
      if (!m) return { ok: false, why: "mouse gone" };
      const z = d.layout.zoom;
      window.__cyrene.renderer.tapAt(m.x * z, m.y * z, 40);
      return { ok: true, x: m.x, y: m.y };
    })()`);
    await wait(180);
    const mouseB = await diag();
    const mouseBSnap = await snap();
    const bondAfterMouse = await bondNow();
    results.mouse.catch = { attempt: mouseTap, mouse: mouseB.girl.mouse, stats: mouseB.girl.stats, bubble: mouseBSnap.bubble?.text ?? null };
    check("mouse.caught",
      !!mouseTap?.ok && mouseB.girl.mouse?.caught === true && mouseB.girl.stats.mice === v12Before.mice + 1,
      `attempt=${JSON.stringify(mouseTap)} mouse=${JSON.stringify(mouseB.girl.mouse)} stats=${JSON.stringify(mouseB.girl.stats)}`);
    check("mouse.line-catch", !!mouseBSnap.bubble && MOUSE_LINES.includes(mouseBSnap.bubble.text),
      `bubble=${mouseBSnap.bubble?.text ?? "null"}`);
    check("mouse.persist", bondAfterMouse?.stats?.mice === mouseB.girl.stats.mice,
      `bond.stats=${JSON.stringify(bondAfterMouse?.stats ?? null)}`);
    const mouseGoneDeadline = Date.now() + 3_000;
    let mouseLast = mouseB.girl.mouse;
    while (Date.now() < mouseGoneDeadline) {
      mouseLast = (await diag()).girl.mouse;
      if (!mouseLast) break;
      await wait(140);
    }
    check("mouse.gone", !mouseLast, `mouse=${JSON.stringify(mouseLast)}`);
    // 第二轮必须真的开局：上一轮 6.4s 里她可能在夜里睡着，睡着拒收地面玩具是设计，
    // 先叫醒再发第二只——这里把开局读数留在报告里，失败时一眼看出是没接还是没说。
    await awakeForPlay("mouse-second");
    await dismissBubble();
    await wait(260);
    await evaluate(s, `window.__cyrene.renderer.handleCommand("mouse")`);
    await wait(260);
    const mouseSecond = await diag();
    const mouseSecondSnap = await snap();
    results.mouse.second = {
      mouse: mouseSecond.girl.mouse,
      activity: mouseSecondSnap.activity,
      sleepSince: mouseSecond.girl.sleepSince,
      bubble: mouseSecondSnap.bubble?.text ?? null,
    };
    check("mouse.respawn", !!mouseSecond.girl.mouse,
      `mouse=${JSON.stringify(mouseSecond.girl.mouse)} activity=${mouseSecondSnap.activity}`
        + ` sleepSince=${Math.round(mouseSecond.girl.sleepSince)}`);
    // 「跑掉了」这句挂在**渲染帧**上（prop 过期那一帧才走 engine.mouseMiss），而且她睡着时
    // 按设计闷掉。探针守着 6.4s 的跑动期：真打盹就先叫醒，别把设计静默读成丢台词；
    // 归零后给气泡一个采样窗（帧序/高优先级台词可能让这句晚一拍），别拿单帧快照判生死。
    const mouseMissDeadline = Date.now() + 8_000;
    let mouseMissSeen = null;
    let missActivity = null;
    while (Date.now() < mouseMissDeadline) {
      await forceFrame();
      const d = await diag();
      mouseMissSeen = d.girl.mouse;
      if (!mouseMissSeen) break;
      missActivity = (await snap()).activity;
      if (missActivity === "sleep") {
        await evaluate(s, `window.__cyrene.renderer.handleCommand("toggle-sleep")`);
        await wait(240);
        await dismissBubble();
      }
      await wait(140);
    }
    let missBubble = null;
    const missSeenTexts = [];
    const missBubbleDeadline = Date.now() + 2_500;
    for (;;) {
      await forceFrame();
      const s0 = await snap();
      if (s0.bubble?.text && !missSeenTexts.includes(s0.bubble.text)) missSeenTexts.push(s0.bubble.text);
      if (s0.bubble && MOUSE_MISS_LINES.includes(s0.bubble.text)) {
        missBubble = s0.bubble.text;
        break;
      }
      if (Date.now() >= missBubbleDeadline) break;
      await wait(100);
    }
    const mouseAfterMiss = await diag();
    results.mouse.miss = {
      bubble: missBubble,
      bubblesSeen: missSeenTexts,
      activity: missActivity,
      stats: mouseAfterMiss.girl.stats,
    };
    check("mouse.miss",
      !mouseMissSeen && mouseAfterMiss.girl.stats.mice === v12Before.mice + 1 && !!missBubble,
      `mouse=${JSON.stringify(mouseMissSeen)} activity=${missActivity}`
        + ` stats=${JSON.stringify(mouseAfterMiss.girl.stats)} bubbles=${JSON.stringify(missSeenTexts)}`);

    // P4 打地鼠：只认冒头的那一只；同一只二次点击不重复计；整轮收尾说「手都拍热了」。
    await awakeForPlay("mole");
    const moleStart = await startToy("mole", "mole", "P4");
    const moleASnap = await snap();
    results.mole = { start: moleStart, a: moleStart.first, bubble: moleASnap.bubble?.text ?? null };
    await shot("girl-mole.png");
    check("mole.spawn", !!moleStart.first && moleStart.first.hits === 0 && moleStart.first.left > 4_800,
      `first=${JSON.stringify(moleStart.first)}`);
    check("mole.line", !!moleASnap.bubble && MOLE_START_LINES.includes(moleASnap.bubble.text),
      `bubble=${moleASnap.bubble?.text ?? "null"}`);
    let moleHead = null;
    const moleHeadDeadline = Date.now() + 3_000;
    while (Date.now() < moleHeadDeadline) {
      moleHead = (await diag()).girl.mole;
      if (moleHead?.activeSlot !== null && moleHead?.activeSlot !== undefined) break;
      await wait(110);
    }
    results.mole.head = moleHead;
    check("mole.head", !!moleHead && moleHead.activeSlot !== null,
      `mole=${JSON.stringify(moleHead)}`);
    const moleTap = moleHead ? await evaluate(s, `(() => {
      const d = window.__cyrene.getPetDiagnostics();
      const m = d.girl.mole;
      if (!m) return { ok: false, why: "mole gone" };
      const z = d.layout.zoom;
      window.__cyrene.renderer.tapAt(m.x * z, m.y * z, 40);
      return { ok: true, x: m.x, y: m.y, slot: m.activeSlot };
    })()`) : null;
    await wait(140);
    const moleB = await diag();
    const moleBSnap = await snap();
    results.mole.whack = { attempt: moleTap, mole: moleB.girl.mole, stats: moleB.girl.stats, bubble: moleBSnap.bubble?.text ?? null };
    check("mole.whack",
      !!moleTap?.ok && moleB.girl.mole?.hits === 1 && moleB.girl.stats.moles === v12Before.moles + 1,
      `attempt=${JSON.stringify(moleTap)} mole=${JSON.stringify(moleB.girl.mole)} stats=${JSON.stringify(moleB.girl.stats)}`);
    check("mole.line-whack", !!moleBSnap.bubble && MOLE_LINES.includes(moleBSnap.bubble.text),
      `bubble=${moleBSnap.bubble?.text ?? "null"}`);
    const moleTap2 = await evaluate(s, `(() => {
      const d = window.__cyrene.getPetDiagnostics();
      const m = d.girl.mole;
      if (!m) return { ok: false, why: "mole gone" };
      const z = d.layout.zoom;
      window.__cyrene.renderer.tapAt(m.x * z, m.y * z, 40);
      return { ok: true, x: m.x, y: m.y, slot: m.activeSlot };
    })()`);
    await wait(120);
    const moleC = await diag();
    results.mole.double = { attempt: moleTap2, mole: moleC.girl.mole, stats: moleC.girl.stats };
    check("mole.double",
      !!moleTap2?.ok && moleC.girl.mole?.hits === 1 && moleC.girl.stats.moles === v12Before.moles + 1,
      `attempt=${JSON.stringify(moleTap2)} mole=${JSON.stringify(moleC.girl.mole)} stats=${JSON.stringify(moleC.girl.stats)}`);
    const moleLast = await waitPropGone("mole", 7_500);
    const moleLine = moleLast ? null : await waitBubbleLine(MOLE_END_LINES);
    const moleDone = await diag();
    results.mole.done = { stats: moleDone.girl.stats, bubble: moleLine };
    check("mole.done",
      !moleLast && moleDone.girl.stats.moles === v12Before.moles + 1 && !!moleLine,
      `mole=${JSON.stringify(moleLast)} stats=${JSON.stringify(moleDone.girl.stats)} bubble=${moleLine ?? "null"}`);

    // P5 抱抱：一开场就计数并起呼噜；点上身＝再抱紧一点（不重复计 hug 次数）。
    await awakeForPlay("hug");
    const hugStart = await startToy("hug", "hug", "P5");
    const hugA = await diag();
    const hugASnap = await snap();
    results.hug = {
      start: hugStart, a: hugStart.first, purrLeft: hugA.girl.purrLeft, stats: hugA.girl.stats,
      bubble: hugASnap.bubble?.text ?? null,
    };
    await shot("girl-hug.png");
    check("hug.spawn",
      !!hugStart.first && hugStart.first.taps === 0 && hugStart.first.left > 3_000
        && hugA.girl.stats.hugs === v12Before.hugs + 1,
      `first=${JSON.stringify(hugStart.first)} stats=${JSON.stringify(hugA.girl.stats)}`);
    const hugAAch = shownAchievementLine(hugA.girl);
    check("hug.line", !!hugASnap.bubble
      && (HUG_START_LINES.includes(hugASnap.bubble.text)
        || BOND_UP_LINES.includes(hugASnap.bubble.text)
        || (!!hugAAch && hugASnap.bubble.text === hugAAch.line)),
      `bubble=${hugASnap.bubble?.text ?? "null"}`
        + (hugAAch ? `（${hugAAch.id} 徽章在展示）` : ""));
    check("hug.purr", hugA.girl.purrLeft > 2_500, `purrLeft=${Math.round(hugA.girl.purrLeft)}`);
    const hugTap = await evaluate(s, `(() => {
      const d = window.__cyrene.getPetDiagnostics();
      const h = d.girl.hug;
      if (!h) return { ok: false, why: "hug gone" };
      const z = d.layout.zoom;
      window.__cyrene.renderer.tapAt(h.x * z, h.y * z, 40);
      return { ok: true, x: h.x, y: h.y };
    })()`);
    await wait(180);
    const hugB = await diag();
    const hugBSnap = await snap();
    results.hug.tap = { attempt: hugTap, hug: hugB.girl.hug, stats: hugB.girl.stats, bubble: hugBSnap.bubble?.text ?? null };
    check("hug.tap",
      !!hugTap?.ok && hugB.girl.hug?.taps === 1 && hugB.girl.stats.hugs === v12Before.hugs + 1,
      `attempt=${JSON.stringify(hugTap)} hug=${JSON.stringify(hugB.girl.hug)} stats=${JSON.stringify(hugB.girl.stats)}`);
    const hugBAch = shownAchievementLine(hugB.girl);
    check("hug.line-tap", !!hugBSnap.bubble
      && (HUG_LINES.includes(hugBSnap.bubble.text)
        || BOND_UP_LINES.includes(hugBSnap.bubble.text)
        || (!!hugBAch && hugBSnap.bubble.text === hugBAch.line)),
      `bubble=${hugBSnap.bubble?.text ?? "null"}`
        + (hugBAch ? `（${hugBAch.id} 徽章在展示）` : ""));
    const hugLast = await waitPropGone("hug", 4_500);
    let hugPurr = (await diag()).girl.purrLeft;
    const hugPurrDeadline = Date.now() + 4_000;
    while (hugPurr >= 2_000 && Date.now() < hugPurrDeadline) {
      await wait(160);
      hugPurr = (await diag()).girl.purrLeft;
    }
    const hugAfter = await diag();
    results.hug.done = { hug: hugLast, purrLeft: hugPurr, stats: hugAfter.girl.stats };
    check("hug.done",
      !hugLast && hugAfter.girl.stats.hugs === v12Before.hugs + 1 && hugPurr < 2_000,
      `hug=${JSON.stringify(hugLast)} purrLeft=${Math.round(hugPurr)} stats=${JSON.stringify(hugAfter.girl.stats)}`);

    // P6 雨天：氛围层不占玩具槽 —— 雨里点铃铛球、再抱一下，雨一直在；20s 后自己收。
    await awakeForPlay("rain");
    const rainStart = await startToy("rain", "rain", "P6");
    await wait(800);
    const rainA = await diag();
    const rainASnap = await snap();
    results.rain = {
      start: rainStart, a: rainStart.first, now: rainA.girl.rain,
      stats: rainA.girl.stats, bubble: rainASnap.bubble?.text ?? null,
    };
    await shot("girl-rain.png");
    check("rain.spawn",
      !!rainStart.first && rainA.girl.rain?.amount === 1 && rainA.girl.rain.left > 18_000
        && rainA.girl.stats.rains === v12Before.rains + 1,
      `first=${JSON.stringify(rainStart.first)} rain=${JSON.stringify(rainA.girl.rain)} stats=${JSON.stringify(rainA.girl.stats)}`);
    check("rain.line", !!rainASnap.bubble && RAIN_START_LINES.includes(rainASnap.bubble.text),
      `bubble=${rainASnap.bubble?.text ?? "null"}`);
    const rainBellStart = await startToy("bell", "bell", "P6-parallel");
    const rainBell = await diag();
    const rainBellSnap = await snap();
    results.rain.parallel = {
      start: rainBellStart, rain: rainBell.girl.rain, bell: rainBellStart.first,
      bubble: rainBellSnap.bubble?.text ?? null,
    };
    check("rain.parallel",
      !!rainBellStart.first && !!rainBell.girl.rain && !!rainBell.girl.bell
        && !!rainBellSnap.bubble && BELL_START_LINES.includes(rainBellSnap.bubble.text),
      `first=${JSON.stringify(rainBellStart.first)} rain=${JSON.stringify(rainBell.girl.rain)} bell=${JSON.stringify(rainBell.girl.bell)} bubble=${rainBellSnap.bubble?.text ?? "null"}`);
    const rainHugStart = await startToy("hug", "hug", "P6-survives");
    const rainHug = await diag();
    results.rain.survives = { start: rainHugStart, rain: rainHug.girl.rain, bell: rainHug.girl.bell, hug: rainHugStart.first };
    check("rain.survives",
      !!rainHugStart.first && !!rainHug.girl.rain && rainHug.girl.bell === null,
      `rain=${JSON.stringify(rainHug.girl.rain)} bell=${JSON.stringify(rainHug.girl.bell)} first=${JSON.stringify(rainHugStart.first)}`);

    // P7 两本账：今日小目标四行（汇总 + 三件小事）、猫咪日记四行以内。
    await dismissBubble();
    await wait(260);
    await evaluate(s, `window.__cyrene.renderer.handleCommand("quests")`);
    await wait(200);
    const questsSnap = await snap();
    const questsText = questsSnap.bubble?.text ?? "";
    const questLines = questsText.split("\n");
    results.quests = { text: questsText };
    await shot("girl-quests.png");
    check("quests.lines",
      questLines.length === 4
        && /^今日小目标( \d\/3| 全清啦)$/.test(questLines[0] ?? "")
        && /^[✓·] 摸摸头 \d\/5$/.test(questLines[1] ?? "")
        && /^[✓·] 陪它玩 \d\/2$/.test(questLines[2] ?? "")
        && /^[✓·] 喂小鱼干 \d\/1$/.test(questLines[3] ?? ""),
      `bubble=${JSON.stringify(questsText)}`);
    await evaluate(s, `window.__cyrene.renderer.handleCommand("diary")`);
    await wait(200);
    const diarySnap = await snap();
    const diaryText = diarySnap.bubble?.text ?? "";
    const diaryLines = diaryText.split("\n");
    results.diary = { text: diaryText };
    await shot("girl-diary.png");
    check("diary.lines",
      diaryLines.length >= 2 && diaryLines.length <= 4
        && diaryLines[0] === "猫咪日记" && /^\d+月\d+日 /.test(diaryLines[1] ?? ""),
      `bubble=${JSON.stringify(diaryText)}`);

    // P8 雨收场：它自己到点消失；27 项计数的重载快照等 Q 段跑完再取。
    const rainLast = await waitPropGone("rain", 24_000);
    if (!rainLast) await waitStat("rains", v12Before.rains + 1);
    const v12Done = await diag();
    check("rain.gone",
      !rainLast && v12Done.girl.stats.rains === v12Before.rains + 1,
      `rain=${JSON.stringify(rainLast)} stats=${JSON.stringify(v12Done.girl.stats)}`);

    // —— Q. v1.13.0：九件新玩具 ——
    // 每件都走菜单同一条命令通道（handleCommand），验「出生 → 点击/整轮结算 → 落盘」。
    // 动目标（尾巴尖/许愿星）读坐标与 tapAt 必须在同一次 evaluate 里：跨一次 CDP 往返，
    // 尾巴尖已经甩出去十几像素，点到的是空气。
    await dismissBubble();
    await wait(220);
    const v13Before = (await diag()).girl.stats;
    const V13_STAT_KEYS = [
      "tails", "kneads", "rolls", "books", "gifts",
      "wishes", "hopscotch", "snowmen", "fortunes",
    ];
    const lineIn = (text, table) => typeof text === "string" && table.includes(text);
    /** 收尾句可能被升档（priority 2）、新徽章或小目标回执抢走话筒：都算设计内的「她开口了」。 */
    const toySaid = (girl, text, table) => {
      if (lineIn(text, table)) return true;
      if (lineIn(text, BOND_UP_LINES) || lineIn(text, QUEST_DONE_LINES)) return true;
      const badge = shownAchievementLine(girl);
      return !!badge && badge.line === text;
    };
    /** 玩具诊断坐标是设计空间；tapAt 吃窗口内 CSS 坐标，乘 zoom 再点。 */
    const tapToyAt = (expr) => evaluate(s, `(() => {
      const d = window.__cyrene.getPetDiagnostics();
      const p = ${expr};
      if (!p) return { ok: false, why: "target gone" };
      const z = d.layout.zoom;
      window.__cyrene.renderer.tapAt(p.x * z, p.y * z, 40);
      return { ok: true, x: p.x, y: p.y };
    })()`);
    /** 雪堆诊断给左上角（三堆还互相压着）：按住它自己那张矩形取中心。 */
    const tapPile = (index) => evaluate(s, `(() => {
      const d = window.__cyrene.getPetDiagnostics();
      const snow = d.girl.snow;
      if (!snow) return { ok: false, why: "snow gone" };
      const p = snow.piles[${index}];
      const x = p.x + p.w / 2;
      const y = p.y + p.h / 2;
      const z = d.layout.zoom;
      window.__cyrene.renderer.tapAt(x * z, y * z, 40);
      return { ok: true, x, y };
    })()`);
    const tapSquare = (index) => evaluate(s, `(() => {
      const d = window.__cyrene.getPetDiagnostics();
      const hop = d.girl.hopscotch;
      if (!hop) return { ok: false, why: "hopscotch gone" };
      const p = hop.squares[${index}];
      const z = d.layout.zoom;
      window.__cyrene.renderer.tapAt(p.x * z, p.y * z, 40);
      return { ok: true, x: p.x, y: p.y };
    })()`);

    // 出生检查只认「还剩大半程」：CDP 往返可能已经跨过第一个短相（settle/warmup 等），按相位钉会假红。
    // Q1 追尾巴：三抓尾巴尖（间隔 > 320ms 冷却）→ 第四下晃晕；整轮走完才记一次。
    await awakeForPlay("tail");
    const tailStart = await startToy("tail", "tail", "Q1");
    const tailASnap = await snap();
    results.tail = { start: tailStart, a: tailStart.first, bubble: tailASnap.bubble?.text ?? null };
    await shot("girl-tail.png");
    check("tail.spawn",
      !!tailStart.first && tailStart.first.left > 3_800,
      `tail=${JSON.stringify(tailStart.first)} gate=${JSON.stringify(tailStart.gateRejected ?? null)}`);
    check("tail.line", !!tailASnap.bubble && TAIL_START_LINES.includes(tailASnap.bubble.text),
      `bubble=${tailASnap.bubble?.text ?? "null"}`);
    await wait(320);
    // 尾巴前 500ms 是 warmup，点了也不算数（尾巴还没甩起来）。以前一上来就伸手，
    // 第一下吞不吞全看截图那几百毫秒——2026-10-28 实拍 3 次里有一次读成 hits 2/3。
    // 等它真进 chase 再出手，判据还是「三下尾巴尖＝三次」。
    const tailChaseDeadline = Date.now() + 3_000;
    for (;;) {
      if ((await diag()).girl.tail?.phase === "chase") break;
      if (Date.now() > tailChaseDeadline) break;
      await wait(120);
    }
    const tailHits = [];
    for (let i = 0; i < 4; i += 1) {
      if (i > 0) await wait(360);
      const tap = await tapToyAt("d.girl.tail");
      await wait(70);
      const after = await diag();
      tailHits.push({ tap, hits: after.girl.tail?.hits ?? null, phase: after.girl.tail?.phase ?? null });
    }
    const tailDizzy = await diag();
    const tailDizzySnap = await snap();
    results.tail.hits = tailHits;
    results.tail.dizzy = { tail: tailDizzy.girl.tail, bubble: tailDizzySnap.bubble?.text ?? null };
    await shot("girl-tail-dizzy.png");
    check("tail.hits",
      tailHits.slice(0, 3).every((h) => h.tap.ok) && tailHits[2].hits === 3,
      `hits=${JSON.stringify(tailHits)}`);
    check("tail.dizzy",
      !!tailHits[3].tap.ok && tailHits[3].hits === 3
        && !!tailDizzySnap.bubble && TAIL_DIZZY_LINES.includes(tailDizzySnap.bubble.text),
      `hits=${tailHits[3]?.hits} bubble=${tailDizzySnap.bubble?.text ?? "null"}`);
    const tailLast = await waitPropGone("tail", 7_500);
    if (!tailLast) await waitStat("tails", v13Before.tails + 1);
    if (!tailLast) await waitBubbleLine(TAIL_LINES);
    const tailDone = await diag();
    const tailDoneSnap = await snap();
    const bondAfterTail = await bondNow();
    results.tail.done = { stats: tailDone.girl.stats, bubble: tailDoneSnap.bubble?.text ?? null };
    check("tail.done", !tailLast && tailDone.girl.stats.tails === v13Before.tails + 1,
      `tail=${JSON.stringify(tailLast)} stats=${JSON.stringify(tailDone.girl.stats)}`);
    check("tail.line-done", !!tailDoneSnap.bubble && toySaid(tailDone.girl, tailDoneSnap.bubble.text, TAIL_LINES),
      `bubble=${tailDoneSnap.bubble?.text ?? "null"}`);
    check("tail.persist", bondAfterTail?.stats?.tails === tailDone.girl.stats.tails,
      `bond.stats=${JSON.stringify(bondAfterTail?.stats ?? null)}`);

    // Q2 踩奶：踩中坐垫一拍 → 整轮 4.6s 走完才记一次，并把呼噜续上。
    await awakeForPlay("knead");
    const kneadStart = await startToy("knead", "knead", "Q2");
    const kneadASnap = await snap();
    results.knead = { start: kneadStart, a: kneadStart.first, bubble: kneadASnap.bubble?.text ?? null };
    await shot("girl-knead.png");
    check("knead.spawn",
      !!kneadStart.first && kneadStart.first.left > 3_200,
      `knead=${JSON.stringify(kneadStart.first)} gate=${JSON.stringify(kneadStart.gateRejected ?? null)}`);
    check("knead.line", !!kneadASnap.bubble && KNEAD_START_LINES.includes(kneadASnap.bubble.text),
      `bubble=${kneadASnap.bubble?.text ?? "null"}`);
    await wait(320);
    const kneadTap = await tapToyAt("d.girl.knead");
    await wait(150);
    const kneadB = await diag();
    results.knead.tap = { attempt: kneadTap, knead: kneadB.girl.knead, stats: kneadB.girl.stats };
    check("knead.beat",
      !!kneadTap.ok && kneadB.girl.knead?.beats === 1 && kneadB.girl.stats.kneads === v13Before.kneads,
      `attempt=${JSON.stringify(kneadTap)} knead=${JSON.stringify(kneadB.girl.knead)} stats=${JSON.stringify(kneadB.girl.stats)}`);
    const kneadLast = await waitPropGone("knead", 7_500);
    if (!kneadLast) await waitStat("kneads", v13Before.kneads + 1);
    if (!kneadLast) await waitBubbleLine(KNEAD_LINES);
    const kneadDone = await diag();
    const kneadDoneSnap = await snap();
    const bondAfterKnead = await bondNow();
    results.knead.done = {
      stats: kneadDone.girl.stats,
      purrLeft: kneadDone.girl.purrLeft,
      bubble: kneadDoneSnap.bubble?.text ?? null,
    };
    check("knead.done", !kneadLast && kneadDone.girl.stats.kneads === v13Before.kneads + 1,
      `knead=${JSON.stringify(kneadLast)} stats=${JSON.stringify(kneadDone.girl.stats)}`);
    check("knead.purr", kneadDone.girl.purrLeft > 2_500, `purrLeft=${kneadDone.girl.purrLeft}`);
    check("knead.line-done", !!kneadDoneSnap.bubble && toySaid(kneadDone.girl, kneadDoneSnap.bubble.text, KNEAD_LINES),
      `bubble=${kneadDoneSnap.bubble?.text ?? "null"}`);
    check("knead.persist", bondAfterKnead?.stats?.kneads === kneadDone.girl.stats.kneads,
      `bond.stats=${JSON.stringify(bondAfterKnead?.stats ?? null)}`);

    // Q3 翻跟头：滞空里点一下翻一圈 → 整轮 3.4s 走完才记一次。
    await awakeForPlay("roll");
    await dismissBubble();
    await wait(260);
    await evaluate(s, `window.__cyrene.renderer.handleCommand("roll")`);
    await wait(240);
    const rollA = await diag();
    const rollASnap = await snap();
    results.roll = { a: rollA.girl.roll, bubble: rollASnap.bubble?.text ?? null };
    await shot("girl-roll.png");
    check("roll.spawn",
      !!rollA.girl.roll && rollA.girl.roll.left > 2_200,
      `roll=${JSON.stringify(rollA.girl.roll)}`);
    check("roll.line", !!rollASnap.bubble && ROLL_START_LINES.includes(rollASnap.bubble.text),
      `bubble=${rollASnap.bubble?.text ?? "null"}`);
    await wait(420);
    const rollTap = await tapToyAt("d.girl.roll");
    await wait(150);
    const rollB = await diag();
    const rollBSnap = await snap();
    results.roll.tap = { attempt: rollTap, roll: rollB.girl.roll, bubble: rollBSnap.bubble?.text ?? null };
    check("roll.flip",
      !!rollTap.ok && rollB.girl.roll?.flips === 1 && rollB.girl.stats.rolls === v13Before.rolls,
      `attempt=${JSON.stringify(rollTap)} roll=${JSON.stringify(rollB.girl.roll)} stats=${JSON.stringify(rollB.girl.stats)}`);
    let rollLast = rollB.girl.roll;
    const rollDeadline = Date.now() + 4_600;
    while (Date.now() < rollDeadline) {
      rollLast = (await diag()).girl.roll;
      if (!rollLast) break;
      await wait(180);
    }
    if (!rollLast) await waitStat("rolls", v13Before.rolls + 1);
    const rollDone = await diag();
    const rollDoneSnap = await snap();
    const bondAfterRoll = await bondNow();
    results.roll.done = { stats: rollDone.girl.stats, bubble: rollDoneSnap.bubble?.text ?? null };
    check("roll.done", !rollLast && rollDone.girl.stats.rolls === v13Before.rolls + 1,
      `roll=${JSON.stringify(rollLast)} stats=${JSON.stringify(rollDone.girl.stats)}`);
    check("roll.line-done", !!rollDoneSnap.bubble && toySaid(rollDone.girl, rollDoneSnap.bubble.text, ROLL_LINES),
      `bubble=${rollDoneSnap.bubble?.text ?? "null"}`);
    check("roll.persist", bondAfterRoll?.stats?.rolls === rollDone.girl.stats.rolls,
      `bond.stats=${JSON.stringify(bondAfterRoll?.stats ?? null)}`);

    // Q4 看书：翻两页（间隔 > 450ms 冷却）→ 整轮 7.2s 合上书才记一次。
    await awakeForPlay("book");
    await dismissBubble();
    await wait(260);
    await evaluate(s, `window.__cyrene.renderer.handleCommand("book")`);
    await wait(240);
    const bookA = await diag();
    const bookASnap = await snap();
    results.book = { a: bookA.girl.book, bubble: bookASnap.bubble?.text ?? null };
    await shot("girl-book.png");
    check("book.spawn",
      !!bookA.girl.book && bookA.girl.book.left > 5_800,
      `book=${JSON.stringify(bookA.girl.book)}`);
    check("book.line", !!bookASnap.bubble && BOOK_START_LINES.includes(bookASnap.bubble.text),
      `bubble=${bookASnap.bubble?.text ?? "null"}`);
    await wait(320);
    const bookTap1 = await tapToyAt("d.girl.book");
    await wait(520);
    const bookTap2 = await tapToyAt("d.girl.book");
    await wait(150);
    const bookB = await diag();
    const bookBSnap = await snap();
    results.book.tap = { first: bookTap1, second: bookTap2, book: bookB.girl.book, bubble: bookBSnap.bubble?.text ?? null };
    check("book.pages",
      !!bookTap1.ok && !!bookTap2.ok && bookB.girl.book?.pages === 2 && bookB.girl.stats.books === v13Before.books,
      `first=${JSON.stringify(bookTap1)} second=${JSON.stringify(bookTap2)} book=${JSON.stringify(bookB.girl.book)} stats=${JSON.stringify(bookB.girl.stats)}`);
    let bookLast = bookB.girl.book;
    const bookDeadline = Date.now() + 8_000;
    while (Date.now() < bookDeadline) {
      bookLast = (await diag()).girl.book;
      if (!bookLast) break;
      await wait(200);
    }
    if (!bookLast) await waitStat("books", v13Before.books + 1);
    const bookDone = await diag();
    const bookDoneSnap = await snap();
    const bondAfterBook = await bondNow();
    results.book.done = { stats: bookDone.girl.stats, bubble: bookDoneSnap.bubble?.text ?? null };
    check("book.done", !bookLast && bookDone.girl.stats.books === v13Before.books + 1,
      `book=${JSON.stringify(bookLast)} stats=${JSON.stringify(bookDone.girl.stats)}`);
    check("book.line-done", !!bookDoneSnap.bubble && toySaid(bookDone.girl, bookDoneSnap.bubble.text, BOOK_LINES),
      `bubble=${bookDoneSnap.bubble?.text ?? "null"}`);
    check("book.persist", bondAfterBook?.stats?.books === bookDone.girl.stats.books,
      `bond.stats=${JSON.stringify(bondAfterBook?.stats ?? null)}`);

    // Q5 礼物盒：进场 300ms 前点不开 → 拆开那一刻当场记账（不等整轮结束）。
    await awakeForPlay("gift");
    await dismissBubble();
    await wait(260);
    await evaluate(s, `window.__cyrene.renderer.handleCommand("gift")`);
    await wait(240);
    const giftA = await diag();
    const giftASnap = await snap();
    results.gift = { a: giftA.girl.gift, bubble: giftASnap.bubble?.text ?? null };
    await shot("girl-gift.png");
    check("gift.spawn",
      !!giftA.girl.gift && !giftA.girl.gift.opened && giftA.girl.gift.left > 5_000,
      `gift=${JSON.stringify(giftA.girl.gift)}`);
    check("gift.line", !!giftASnap.bubble && GIFT_START_LINES.includes(giftASnap.bubble.text),
      `bubble=${giftASnap.bubble?.text ?? "null"}`);
    await wait(320);
    const giftTap = await tapToyAt("d.girl.gift");
    await wait(200);
    const giftB = await diag();
    const giftBSnap = await snap();
    const bondAfterGift = await bondNow();
    results.gift.open = {
      attempt: giftTap,
      gift: giftB.girl.gift,
      bubble: giftBSnap.bubble?.text ?? null,
      stats: giftB.girl.stats,
    };
    await shot("girl-gift-open.png");
    check("gift.open",
      !!giftTap.ok && giftB.girl.gift?.opened === true && giftB.girl.gift?.phase === "open"
        && giftB.girl.stats.gifts === v13Before.gifts + 1,
      `attempt=${JSON.stringify(giftTap)} gift=${JSON.stringify(giftB.girl.gift)} stats=${JSON.stringify(giftB.girl.stats)}`);
    check("gift.line-open", !!giftBSnap.bubble && toySaid(giftB.girl, giftBSnap.bubble.text, GIFT_LINES),
      `bubble=${giftBSnap.bubble?.text ?? "null"}`);
    check("gift.persist", bondAfterGift?.stats?.gifts === giftB.girl.stats.gifts,
      `bond.stats=${JSON.stringify(bondAfterGift?.stats ?? null)}`);

    // Q6 许愿星：升空 900ms 后才能点（rise 期点不中）；点星当场记账。
    await awakeForPlay("wish");
    await dismissBubble();
    await wait(260);
    await evaluate(s, `window.__cyrene.renderer.handleCommand("wish")`);
    await wait(240);
    const wishA = await diag();
    const wishASnap = await snap();
    results.wish = { a: wishA.girl.wish, bubble: wishASnap.bubble?.text ?? null };
    await shot("girl-wish.png");
    check("wish.spawn",
      !!wishA.girl.wish && !wishA.girl.wish.wished && wishA.girl.wish.left > 5_000,
      `wish=${JSON.stringify(wishA.girl.wish)}`);
    check("wish.line", !!wishASnap.bubble && WISH_START_LINES.includes(wishASnap.bubble.text),
      `bubble=${wishASnap.bubble?.text ?? "null"}`);
    await wait(800);
    const wishTap = await tapToyAt("d.girl.wish");
    await wait(200);
    const wishB = await diag();
    const wishBSnap = await snap();
    const bondAfterWish = await bondNow();
    results.wish.make = {
      attempt: wishTap,
      wish: wishB.girl.wish,
      bubble: wishBSnap.bubble?.text ?? null,
      stats: wishB.girl.stats,
    };
    await shot("girl-wish-made.png");
    check("wish.make",
      !!wishTap.ok && wishB.girl.wish?.wished === true && wishB.girl.stats.wishes === v13Before.wishes + 1,
      `attempt=${JSON.stringify(wishTap)} wish=${JSON.stringify(wishB.girl.wish)} stats=${JSON.stringify(wishB.girl.stats)}`);
    check("wish.line-made", !!wishBSnap.bubble && toySaid(wishB.girl, wishBSnap.bubble.text, WISH_LINES),
      `bubble=${wishBSnap.bubble?.text ?? "null"}`);
    check("wish.persist", bondAfterWish?.stats?.wishes === wishB.girl.stats.wishes,
      `bond.stats=${JSON.stringify(bondAfterWish?.stats ?? null)}`);

    // Q7 跳格子：踩错重来（进度归零）→ 按 0/1/2 踩满三格才记一次。
    await awakeForPlay("hopscotch");
    await dismissBubble();
    await wait(260);
    await evaluate(s, `window.__cyrene.renderer.handleCommand("hopscotch")`);
    await wait(240);
    const hopA = await diag();
    const hopASnap = await snap();
    results.hop = { a: hopA.girl.hopscotch, bubble: hopASnap.bubble?.text ?? null };
    await shot("girl-hopscotch.png");
    check("hop.spawn",
      !!hopA.girl.hopscotch && hopA.girl.hopscotch.squares.length === 3
        && hopA.girl.hopscotch.next === 0 && hopA.girl.hopscotch.left > 7_000,
      `hop=${JSON.stringify(hopA.girl.hopscotch)}`);
    check("hop.line", !!hopASnap.bubble && HOP_START_LINES.includes(hopASnap.bubble.text),
      `bubble=${hopASnap.bubble?.text ?? "null"}`);
    const hopMissTap = await tapSquare(1);
    await wait(160);
    const hopMiss = await diag();
    const hopMissSnap = await snap();
    results.hop.miss = { attempt: hopMissTap, hop: hopMiss.girl.hopscotch, bubble: hopMissSnap.bubble?.text ?? null };
    check("hop.miss",
      !!hopMissTap.ok && hopMiss.girl.hopscotch?.next === 0
        && !!hopMissSnap.bubble && HOP_MISS_LINES.includes(hopMissSnap.bubble.text),
      `attempt=${JSON.stringify(hopMissTap)} hop=${JSON.stringify(hopMiss.girl.hopscotch)} bubble=${hopMissSnap.bubble?.text ?? "null"}`);
    await wait(280);
    const hopSteps = [];
    for (let i = 0; i < 3; i += 1) {
      if (i > 0) await wait(280);
      const tap = await tapSquare(i);
      await wait(90);
      hopSteps.push({ tap, next: (await diag()).girl.hopscotch?.next ?? null });
    }
    await wait(160);
    const hopDone = await diag();
    const hopDoneSnap = await snap();
    const bondAfterHop = await bondNow();
    results.hop.done = { steps: hopSteps, hop: hopDone.girl.hopscotch, bubble: hopDoneSnap.bubble?.text ?? null };
    await shot("girl-hopscotch-done.png");
    check("hop.done",
      hopSteps.every((x) => x.tap.ok) && hopSteps[2].next === 3
        && hopDone.girl.stats.hopscotch === v13Before.hopscotch + 1,
      `steps=${JSON.stringify(hopSteps)} hop=${JSON.stringify(hopDone.girl.hopscotch)} stats=${JSON.stringify(hopDone.girl.stats)}`);
    check("hop.line-done", !!hopDoneSnap.bubble && toySaid(hopDone.girl, hopDoneSnap.bubble.text, HOP_LINES),
      `bubble=${hopDoneSnap.bubble?.text ?? "null"}`);
    check("hop.persist", bondAfterHop?.stats?.hopscotch === hopDone.girl.stats.hopscotch,
      `bond.stats=${JSON.stringify(bondAfterHop?.stats ?? null)}`);

    // Q8 下雪：三堆拍实立雪人（当场记账）→ 雨雪互斥两个方向 → 雪里还能玩独演玩具。
    await awakeForPlay("snow");
    await dismissBubble();
    await wait(260);
    await evaluate(s, `window.__cyrene.renderer.handleCommand("snow")`);
    await wait(400);
    const snowA = await diag();
    const snowASnap = await snap();
    results.snow = { a: snowA.girl.snow, bubble: snowASnap.bubble?.text ?? null };
    await shot("girl-snow.png");
    check("snow.spawn",
      !!snowA.girl.snow && !snowA.girl.snow.built && snowA.girl.snow.piles.length === 3
        && snowA.girl.snow.amount > 0.2 && snowA.girl.snow.left > 22_800,
      `snow=${JSON.stringify(snowA.girl.snow)}`);
    check("snow.line", !!snowASnap.bubble && SNOW_START_LINES.includes(snowASnap.bubble.text),
      `bubble=${snowASnap.bubble?.text ?? "null"}`);
    const pileTaps = [];
    for (let i = 0; i < 3; i += 1) {
      if (i > 0) await wait(360);
      const tap = await tapPile(i);
      await wait(120);
      const after = await diag();
      pileTaps.push({ tap, built: after.girl.snow?.built ?? null, snowmen: after.girl.stats.snowmen });
    }
    const snowBuilt = await diag();
    const snowBuiltSnap = await snap();
    const bondAfterSnow = await bondNow();
    results.snow.built = {
      taps: pileTaps,
      snow: snowBuilt.girl.snow,
      bubble: snowBuiltSnap.bubble?.text ?? null,
      stats: snowBuilt.girl.stats,
    };
    await shot("girl-snowman.png");
    check("snow.built",
      pileTaps.every((x) => x.tap.ok) && snowBuilt.girl.snow?.built === true
        && snowBuilt.girl.stats.snowmen === v13Before.snowmen + 1,
      `taps=${JSON.stringify(pileTaps)} snow=${JSON.stringify(snowBuilt.girl.snow)} stats=${JSON.stringify(snowBuilt.girl.stats)}`);
    // 第一只雪人会解锁「雪人建筑师」：徽章句（priority 2）会盖掉普通收尾句，两种都认。
    check("snow.line-built", !!snowBuiltSnap.bubble && toySaid(snowBuilt.girl, snowBuiltSnap.bubble.text, SNOWMAN_LINES),
      `bubble=${snowBuiltSnap.bubble?.text ?? "null"}`);
    check("snow.persist", bondAfterSnow?.stats?.snowmen === snowBuilt.girl.stats.snowmen,
      `bond.stats=${JSON.stringify(bondAfterSnow?.stats ?? null)}`);
    // 雨收雪：引擎清 snowUntil、渲染端丢掉这份粒子。
    await evaluate(s, `window.__cyrene.renderer.handleCommand("rain")`);
    await wait(260);
    const snowToRain = await diag();
    results.snow.cancelledByRain = { snow: snowToRain.girl.snow, rain: snowToRain.girl.rain };
    await shot("girl-snow-cancelled.png");
    check("snow.cancel-by-rain",
      !snowToRain.girl.snow && !!snowToRain.girl.rain,
      `snow=${JSON.stringify(snowToRain.girl.snow)} rain=${JSON.stringify(snowToRain.girl.rain)}`);
    // 雪收雨：反方向也得当场收干净，新雪不继承上一场的雪人。
    await evaluate(s, `window.__cyrene.renderer.handleCommand("snow")`);
    await wait(260);
    const rainToSnow = await diag();
    results.snow.cancelledBySnow = { snow: rainToSnow.girl.snow, rain: rainToSnow.girl.rain };
    check("rain.cancel-by-snow",
      !rainToSnow.girl.rain && !!rainToSnow.girl.snow && rainToSnow.girl.snow.built === false,
      `snow=${JSON.stringify(rainToSnow.girl.snow)} rain=${JSON.stringify(rainToSnow.girl.rain)}`);
    // 雪是氛围层：不占独演槽，铃铛球照样能起。
    const snowBellStart = await startToy("bell", "bell", "Q8");
    const snowBell = await diag();
    results.snow.withBell = { start: snowBellStart, snow: snowBell.girl.snow, bell: snowBellStart.first };
    await shot("girl-snow-bell.png");
    check("snow.keeps-solo-toy",
      !!snowBell.girl.snow && !!snowBellStart.first,
      `snow=${JSON.stringify(snowBell.girl.snow)} bell=${JSON.stringify(snowBellStart.first)} gate=${JSON.stringify(snowBellStart.gateRejected ?? null)}`);

    // Q9 每日抽签：揭一次才记账；同一天再开是同一张签、只有签纸在本地翻开。
    await awakeForPlay("fortune");
    await dismissBubble();
    await wait(260);
    await evaluate(s, `window.__cyrene.renderer.handleCommand("fortune")`);
    await wait(240);
    const fortuneA = await diag();
    const fortuneASnap = await snap();
    const fate = fortuneA.girl.fortune?.tier ?? -1;
    results.fortune = {
      tier: fate,
      a: fortuneA.girl.fortune,
      bubble: fortuneASnap.bubble?.text ?? null,
    };
    check("fortune.spawn",
      !!fortuneA.girl.fortune && fortuneA.girl.fortune.left > 6_000
        && fate >= 0 && fate < FORTUNE_LINES.length,
      `fortune=${JSON.stringify(fortuneA.girl.fortune)} lines=${FORTUNE_LINES.length}`);
    check("fortune.line", !!fortuneASnap.bubble && FORTUNE_START_LINES.includes(fortuneASnap.bubble.text),
      `bubble=${fortuneASnap.bubble?.text ?? "null"}`);
    await wait(420);
    const fortuneTap = await tapToyAt("d.girl.fortune");
    await wait(200);
    const fortuneB = await diag();
    const fortuneBSnap = await snap();
    const bondFortune = await bondNow();
    results.fortune.reveal = {
      attempt: fortuneTap,
      fortune: fortuneB.girl.fortune,
      bubble: fortuneBSnap.bubble?.text ?? null,
      bond: bondFortune?.fortune ?? null,
    };
    await shot("girl-fortune.png");
    check("fortune.reveal",
      !!fortuneTap.ok && fortuneB.girl.fortune?.revealed === true
        && fortuneB.girl.stats.fortunes === v13Before.fortunes + 1,
      `attempt=${JSON.stringify(fortuneTap)} fortune=${JSON.stringify(fortuneB.girl.fortune)} stats=${JSON.stringify(fortuneB.girl.stats)}`);
    check("fortune.line-reveal",
      !!fortuneBSnap.bubble && toySaid(fortuneB.girl, fortuneBSnap.bubble.text, [FORTUNE_LINES[fate]]),
      `bubble=${fortuneBSnap.bubble?.text ?? "null"} expect=${JSON.stringify(FORTUNE_LINES[fate])}`);
    check("fortune.persist",
      bondFortune?.fortune?.drawn === true && bondFortune?.fortune?.tier === fate
        && bondFortune?.fortune?.line === FORTUNE_LINES[fate]
        && bondFortune?.stats?.fortunes === fortuneB.girl.stats.fortunes,
      `bond.fortune=${JSON.stringify(bondFortune?.fortune ?? null)} stats=${bondFortune?.stats?.fortunes}`);
    // 同一天再开：签还是那一张，但已揭过 → 引擎不再记账。
    await evaluate(s, `window.__cyrene.renderer.handleCommand("fortune")`);
    await wait(240);
    const fortuneC = await diag();
    const fortuneCSnap = await snap();
    check("fortune.same-day",
      !!fortuneC.girl.fortune && fortuneC.girl.fortune.tier === fate
        && fortuneC.girl.fortune.revealed === false
        && fortuneC.girl.stats.fortunes === v13Before.fortunes + 1,
      `fortune=${JSON.stringify(fortuneC.girl.fortune)} stats=${JSON.stringify(fortuneC.girl.stats)}`);
    check("fortune.line-reopen",
      !!fortuneCSnap.bubble && FORTUNE_START_LINES.includes(fortuneCSnap.bubble.text),
      `bubble=${fortuneCSnap.bubble?.text ?? "null"}`);
    await wait(420);
    const fortuneReopenTap = await tapToyAt("d.girl.fortune");
    await wait(200);
    const fortuneD = await diag();
    const bondFortune2 = await bondNow();
    results.fortune.reopen = {
      attempt: fortuneReopenTap,
      fortune: fortuneD.girl.fortune,
      stats: fortuneD.girl.stats,
      bond: bondFortune2?.fortune ?? null,
    };
    check("fortune.once-a-day",
      !!fortuneReopenTap.ok && fortuneD.girl.fortune?.revealed === true
        && fortuneD.girl.stats.fortunes === v13Before.fortunes + 1
        && bondFortune2?.fortune?.drawn === true,
      `attempt=${JSON.stringify(fortuneReopenTap)} fortune=${JSON.stringify(fortuneD.girl.fortune)} stats=${JSON.stringify(fortuneD.girl.stats)}`);

    // Q 收口：九件各走完一轮，27 项里这九项各自正好 +1；整份 stats 交给 reload 段原样核对。
    const v13Done = await diag();
    v13StatsForReload = v13Done.girl.stats;
    v12StatsForReload = pickStats(v13StatsForReload, V12_STAT_KEYS);
    results.v12Stats = v12StatsForReload;
    results.v13Stats = v13StatsForReload;
    const bondFinal = await bondNow();
    const v13Delta = Object.fromEntries(
      V13_STAT_KEYS.map((k) => [k, (v13StatsForReload[k] ?? -1) - (v13Before[k] ?? 0)]),
    );
    results.v13Delta = {
      delta: v13Delta,
      before: pickStats(v13Before, V13_STAT_KEYS),
      after: pickStats(v13StatsForReload, V13_STAT_KEYS),
    };
    check("v13.counters",
      V13_STAT_KEYS.every((k) => v13Delta[k] === 1),
      `delta=${JSON.stringify(v13Delta)} before=${JSON.stringify(pickStats(v13Before, V13_STAT_KEYS))} after=${JSON.stringify(pickStats(v13StatsForReload, V13_STAT_KEYS))}`);
    // 27 是 v1.17 的数；v1.18 加了 selfPlay（自娱玩出名堂的次数），所以是 28。
    // 这行故意写死：新加一项统计必须来改一次，不能悄悄多一列。
    check("v13.stats-keys",
      Object.keys(v13StatsForReload).length === 28,
      `keys=${Object.keys(v13StatsForReload).length} stats=${JSON.stringify(v13StatsForReload)}`);
    check("v13.persist",
      V13_STAT_KEYS.every((k) => bondFinal?.stats?.[k] === v13StatsForReload[k]),
      `bond.stats=${JSON.stringify(bondFinal?.stats ?? null)}`);

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
    // v1.12：18 项计数（含抓板/铃铛/发条鼠/地鼠/抱抱/呼噜/雨/目标）整页重载后原样回来。
    check("milestone.stats-v12",
      !!v12StatsForReload
        && JSON.stringify(pickStats(m.stats ?? null, V12_STAT_KEYS)) === JSON.stringify(v12StatsForReload),
      `before=${JSON.stringify(v12StatsForReload)} after=${JSON.stringify(pickStats(m.stats ?? null, V12_STAT_KEYS))}`);
    // v1.13：27 项计数（含追尾巴/踩奶/翻跟头/看书/礼物/许愿/跳格子/雪人/抽签）整页重载后原样回来。
    check("milestone.stats-v13",
      !!v13StatsForReload && JSON.stringify(m.stats ?? null) === JSON.stringify(v13StatsForReload),
      `before=${JSON.stringify(v13StatsForReload)} after=${JSON.stringify(m.stats ?? null)}`);

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

  // —— N. v1.14.0：真姿态待机（站立 → 坐 → 蜷 → 起身，不再借跳舞帧压扁装坐） ——
  // 这段要看真实编排的整段时长（坐 6–10s、蜷 8–13s），不能靠 poke 内部时钟缩短。
  // 先摸一下把编排 reset 成站定、并按住 userActive：引擎的静息/漫游都不许插队，
  // 否则「走到一半变成 walk」会把编排重置，读到的段位就不是产品节奏了。
  {
    const readIdle = () => evaluate(s, `(() => {
      const d = window.__cyrene.getPetDiagnostics();
      return {
        idle: d.girl.idle ?? null,
        pose: d.girl.pose ?? null,
        clip: d.girl.clip ?? null,
        gesture: d.girl.gesture ?? null,
        gestureId: d.girl.gestureId ?? null,
        atlases: d.girl.atlases ?? null,
        face: d.girl.face ?? null,
        cushion: d.girl.cushion ?? 0,
        activity: window.__cyrene.renderer.getCompanionSnapshot()?.activity ?? null,
      };
    })()`, 5_000);

    await evaluate(s, `(() => {
      const r = window.__cyrene.renderer;
      r.handleCommand("pet");
      r.setUserActive(true);
      return true;
    })()`);
    let act = await snap();
    const idleDeadline = Date.now() + 15_000;
    while (act.activity !== "idle" && Date.now() < idleDeadline) {
      await wait(200);
      act = await snap();
    }
    check("idle.activity", act.activity === "idle", `activity=${act.activity}`);
    await forceFrame();
    const start = await readIdle();
    results.idle = { start: start.idle, startPose: start.pose, startClip: start.clip, startGesture: start.gesture };
    // 复位后从站定起跳；姿态图就绪时基础段必须是真姿态格，而不是循环帧段。
    check("idle.start",
      !!start.idle && start.idle.phase === "stand" && start.idle.pose === "stand"
        && start.idle.suspended === false && start.idle.left > 0
        && (start.gesture !== null || (start.pose === "stand" && start.clip === null)),
      `idle=${JSON.stringify(start.idle)} pose=${start.pose} clip=${start.clip} gesture=${start.gesture}`);

    // 等一个「干净的坐段」：真姿态坐格、没有一次性手势在演（手势只许在站定时出场）。
    // 作息保证四段主动之内必歇一段，45s 留出换段+手势的余量。
    let rest = null;
    const restDeadline = Date.now() + 60_000;
    while (Date.now() < restDeadline) {
      await forceFrame();
      const r = await readIdle();
      if (r.idle?.phase === "sit" && r.pose === "sit" && r.clip === null && r.gesture === null) {
        rest = r;
        break;
      }
      await wait(220);
    }
    let seated = null;
    if (rest) {
      // 坐垫按 180ms 时间常数展开：等它到位再判，不能拿换段的第一帧说「没坐下」。
      await wait(800);
      await forceFrame();
      seated = await readIdle();
    }
    results.idle.sit = seated?.idle ?? null;
    results.idle.sitPose = seated ? { pose: seated.pose, clip: seated.clip, cushion: seated.cushion } : null;
    check("idle.sit",
      !!seated && !!seated.idle && seated.idle.phase === "sit"
        && !seated.idle.suspended && seated.pose === "sit" && seated.clip === null
        && seated.cushion > 0.9,
      `rest=${JSON.stringify(rest?.idle)} settled=${JSON.stringify(seated?.idle)} pose=${seated?.pose} clip=${seated?.clip} cushion=${seated?.cushion}`);
    if (seated) await shot("girl-idle-sit.png");

    // 坐够了自己蜷起来歇：同样是真姿态格；脸要比站着时低（头真的下来了，不是换色）。
    // 55% 当场打盹；没打盹的那条路会在下一轮主动（≤4 段）后强制蜷，40s 覆盖两条路。
    const standFaceY = start.face?.cy ?? null;
    let curl = null;
    const curlDeadline = Date.now() + 40_000;
    while (Date.now() < curlDeadline) {
      await forceFrame();
      const r = await readIdle();
      if (r.idle?.phase === "curl" && r.pose === "curl" && r.clip === null && r.gesture === null) {
        curl = r;
        break;
      }
      await wait(200);
    }
    const curlFaceDrops = !!(curl && start.face && curl.face && curl.face.cy > start.face.cy + 2);
    results.idle.curl = curl?.idle ?? null;
    results.idle.curlPose = curl ? { pose: curl.pose, clip: curl.clip, face: curl.face } : null;
    check("idle.curl",
      !!curl && !curl.idle.suspended && curl.pose === "curl" && curl.clip === null && curlFaceDrops,
      `curl=${JSON.stringify(curl?.idle)} pose=${curl?.pose} clip=${curl?.clip} `
        + `face=${curl?.face?.cy ?? "null"} standFace=${standFaceY ?? "null"}`);
    if (curl) await shot("girl-idle-curl.png");

    // v1.15：真趴下。歇息三档 sit → curl → prone 是作息，不是抽签；趴是图集 II 的一格，
    // 剪影比 curl 更矮更宽，脸也再低一截。这里只等它自然出现（起身后的下一轮才会趴）。
    let prone = null;
    const proneDeadline = Date.now() + 75_000;
    while (Date.now() < proneDeadline) {
      await forceFrame();
      const r = await readIdle();
      if (r.idle?.phase === "prone" && r.pose === "prone" && r.clip === null && r.gesture === null) {
        prone = r;
        break;
      }
      await wait(200);
    }
    results.idle.prone = prone?.idle ?? null;
    results.idle.pronePose = prone ? { pose: prone.pose, clip: prone.clip, face: prone.face } : null;
    const proneFaceDrops = !!(prone && curl?.face && prone.face && prone.face.cy > curl.face.cy + 2);
    check("idle.prone",
      !!prone && !prone.idle.suspended && prone.pose === "prone" && prone.clip === null && proneFaceDrops,
      `prone=${JSON.stringify(prone?.idle)} pose=${prone?.pose} clip=${prone?.clip} `
        + `face=${prone?.face?.cy ?? "null"} curlFace=${curl?.face?.cy ?? "null"}`);
    if (prone) await shot("girl-idle-prone.png");

    // 起身：回到站姿，头抬回来，基础段仍是真姿态格。
    let back = null;
    const backDeadline = Date.now() + 25_000;
    while (Date.now() < backDeadline) {
      await forceFrame();
      const r = await readIdle();
      if (r.idle?.phase === "stand" && r.pose === "stand" && r.clip === null && r.gesture === null) {
        back = r;
        break;
      }
      await wait(200);
    }
    results.idle.back = back?.idle ?? null;
    results.idle.backPose = back ? { pose: back.pose, clip: back.clip, face: back.face } : null;
    check("idle.wake",
      !!back && !back.idle.suspended && back.pose === "stand" && back.clip === null
        && (curl?.face ? back.face.cy < curl.face.cy : true)
        && (prone?.face ? back.face.cy < prone.face.cy : true),
      `back=${JSON.stringify(back?.idle)} pose=${back?.pose} clip=${back?.clip} face=${back?.face?.cy ?? "null"}`);
    if (back) await shot("girl-idle-back.png");

    // 安静档：立刻站起来，且绝不用睡脸冒充安静（月牙是唯一记号）。
    await evaluate(s, `window.__cyrene.renderer.setQuiet(true)`);
    await forceFrame();
    const hush = await readIdle();
    results.idle.hush = { idle: hush.idle, pose: hush.pose, clip: hush.clip, mood: (await snap()).mood };
    check("idle.quiet-stand",
      hush.pose === "stand" && hush.clip === null && hush.idle?.phase === "stand",
      `pose=${hush.pose} clip=${hush.clip} idle=${JSON.stringify(hush.idle)}`);
    await shot("girl-idle-quiet.png");
    await evaluate(s, `window.__cyrene.renderer.setQuiet(false)`);

    // 睡着：真蜷格 + 睡毯/Zzz；打开安静当场站直。
    await evaluate(s, `window.__cyrene.renderer.handleCommand("toggle-sleep")`);
    await wait(400);
    await forceFrame();
    const asleep = await readIdle();
    results.idle.sleep = { pose: asleep.pose, clip: asleep.clip, face: asleep.face, activity: asleep.activity };
    check("idle.sleep-curl",
      asleep.activity === "sleep" && asleep.pose === "curl" && asleep.clip === null,
      `activity=${asleep.activity} pose=${asleep.pose} clip=${asleep.clip}`);
    await shot("girl-idle-sleep.png");
    await evaluate(s, `window.__cyrene.renderer.setQuiet(true)`);
    await forceFrame();
    const wakeHush = await readIdle();
    results.idle.sleepHush = { pose: wakeHush.pose, clip: wakeHush.clip, idle: wakeHush.idle };
    check("idle.sleep-quiet-stand",
      wakeHush.pose === "stand" && wakeHush.clip === null,
      `pose=${wakeHush.pose} clip=${wakeHush.clip}`);
    await evaluate(s, `window.__cyrene.renderer.setQuiet(false)`);
    await evaluate(s, `window.__cyrene.renderer.handleCommand("toggle-sleep")`);
  }

  // v1.15：手势落到真姿态。招手/鞠躬/剪刀手/歪头/洗脸/哈欠各是一张画，不是舞蹈片段；
  // 没有对应画的（点头）继续走帧段。判据全读渲染器同源读数 + 图集是否到位。
  {
    const readGesture = () => evaluate(s, `(() => {
      const d = window.__cyrene.getPetDiagnostics();
      return {
        pose: d.girl.pose ?? null,
        clip: d.girl.clip ?? null,
        gesture: d.girl.gesture ?? null,
        gestureId: d.girl.gestureId ?? null,
        atlases: d.girl.atlases ?? null,
      };
    })()`, 5_000);

    await evaluate(s, `window.__cyrene.renderer.setUserActive(true)`);
    await forceFrame();
    const ready = await readGesture();
    results.gestureAtlases = ready.atlases;
    check("gesture.atlases",
      !!ready.atlases && ready.atlases.poses === true && ready.atlases.poses2 === true,
      `atlases=${JSON.stringify(ready.atlases)}`);

    const cases = [
      ["bow", "bow"],
      ["point", "peace"],
      ["tilt", "tilt"],
      ["groom", "wash"],
      ["yawn", "yawn"],
      ["wave", "wave"],
    ];
    const seen = [];
    for (const [id, pose] of cases) {
      await evaluate(s, `window.__cyrene.renderer.playGesture(${JSON.stringify(id)})`);
      // 手势是 160ms 交叉淡化 + 1.2~1.8s 停留：取中间那一段读，别抢淡化帧也别等它退场。
      await wait(400);
      await forceFrame();
      const g = await readGesture();
      seen.push({ id, pose: g.pose, clip: g.clip, gestureId: g.gestureId });
      check(`gesture.${id}`,
        g.pose === pose && g.clip === null && g.gestureId === id,
        `pose=${g.pose} clip=${g.clip} gestureId=${g.gestureId}`);
      if (id === "wave") await shot("girl-gesture-wave.png");
      if (id === "bow") await shot("girl-gesture-bow.png");
      // 等这一张举完再起下一张，避免被判成「同一段没换」。
      await wait(1_700);
    }
    results.gestures = seen;

    // 没有对应画的：点头仍走帧段，不许硬套一张不像的姿态。
    await evaluate(s, `window.__cyrene.renderer.playGesture("nod")`);
    await wait(300);
    await forceFrame();
    const nod = await readGesture();
    results.gestureNod = nod;
    check("gesture.nod-clip",
      nod.clip === "peek" && nod.pose === null && nod.gestureId === "nod",
      `pose=${nod.pose} clip=${nod.clip} gestureId=${nod.gestureId}`);
    await wait(1_500);
    await evaluate(s, `window.__cyrene.renderer.setUserActive(false)`);
  }

  // —— R. v1.17.0：日常系统（心情 / 本命 / 小把戏 / 拾荒 / 薄荷盆 / 躲猫猫） ——
  // 六本账都归引擎持有，渲染端只借嘴说、按快照画：判据读同源诊断，外加一次真画布的绿像素
  // （薄荷盆的叶子是这一层唯一用 GREEN 的东西）。单槽气泡是产品契约——报告 2 级、动作回执
  // 1 级、同级默认不抢：每个「动作」前先 dismiss，否则回执会被上一条报告吞掉
  // （与 companion.test 的单槽锁同一个口径，别把契约当 bug）。
  {
    const bondNow = () => evaluate(s, `(() => {
      try { return JSON.parse(localStorage.getItem("cyrene.pet.bond.v1") ?? "null"); } catch { return null; }
    })()`);
    const lineIn = (text, table) => typeof text === "string" && table.includes(text);
    /** 升档 / 徽章按设计抢得过动作回执：认这两类也算「她真的开口了」。 */
    const saidOrSteal = (girl, text, table) => lineIn(text, table)
      || lineIn(text, BOND_UP_LINES)
      || shownAchievementLine(girl)?.line === text;

    /** 躲猫猫三段靠帧推进：CDP 往返比 1.1s 的捂眼还慢一拍，必须轮询相位而不是拍脑袋 sleep。 */
    const waitHidePhase = async (want, timeoutMs) => {
      const deadline = Date.now() + timeoutMs;
      let last = null;
      for (;;) {
        await forceFrame();
        last = (await diag()).girl.hide;
        if (last?.phase === want || Date.now() >= deadline) return last;
        await wait(140);
      }
    };
    const waitHideGone = async (timeoutMs) => {
      const deadline = Date.now() + timeoutMs;
      let last = null;
      for (;;) {
        await forceFrame();
        last = (await diag()).girl.hide;
        if (!last || Date.now() >= deadline) return last;
        await wait(140);
      }
    };
    /** 脸框是设计空间；tapAt 吃窗口 CSS 坐标，读完立刻点，别让动画把落点挪走。 */
    const tapFaceNow = () => evaluate(s, `(() => {
      const d = window.__cyrene.getPetDiagnostics();
      const f = d.girl.face;
      if (!f) return { ok: false, why: "no face" };
      const z = d.layout.zoom;
      const x = f.cx;
      const y = f.top + f.h / 2;
      window.__cyrene.renderer.tapAt(x * z, y * z, 40);
      return { ok: true, x, y };
    })()`);
    /**
     * 薄荷盆那一点绿＝这层唯一的 GREEN。区域贴着右脚（盆画在 face.cx + w*0.42、地面线处），
     * 按画布真实变换（resize 里 setTransform(dpr*zoom)）换算像素坐标，不靠 zoom 猜测。
     */
    const potGreen = () => evaluate(s, `(() => {
      const r = window.__cyrene.renderer;
      const d = window.__cyrene.getPetDiagnostics();
      const f = d.girl.face;
      const floorY = r.cat?.center?.y;
      const c = document.getElementById("pet-canvas");
      if (!f || typeof floorY !== "number" || !c) return { green: -1, drawn: -1, why: "no face/floor/canvas" };
      const ctx = c.getContext("2d", { willReadFrequently: true });
      const m = ctx.getTransform();
      const gx = f.cx + f.w * 0.42;
      const map = (x, y) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];
      const [ax, ay] = map(gx - 11, floorY - 12);
      const [bx, by] = map(gx + 11, floorY + 7);
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx)));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by)));
      const x1 = Math.min(c.width, Math.ceil(Math.max(ax, bx)));
      const y1 = Math.min(c.height, Math.ceil(Math.max(ay, by)));
      if (x1 - x0 < 2 || y1 - y0 < 2) return { green: -1, drawn: -1, why: "empty box", box: [x0, y0, x1, y1] };
      const data = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
      let green = 0;
      let drawn = 0;
      for (let i = 0; i < data.length; i += 4) {
        const rr = data[i], gg = data[i + 1], bb = data[i + 2], aa = data[i + 3];
        if (aa > 20) drawn++;
        // 种下去那颗绿点直径只有 2.2 设计像素：只认 aa>160 的「瓷实核心」时，
        // 猫待机漂 0.1px 的亚像素相位一变，读数就从 3 掉到 2（2026-10-28 实拍）。
        // 按覆盖度认墨：半盖住的边缘只要还看得出绿（aa>80）也算这颗芽。
        // 空盆里只有 PAPER/INK_SHADE，没有绿——同一道闸门在种之前读到的仍是 0，牙没松。
        if (aa > 80 && gg > 130 && gg - rr > 40 && gg - bb > 25) green++;
      }
      return { green, drawn, gx: Math.round(gx * 10) / 10, floorY: Math.round(floorY * 10) / 10, box: [x0, y0, x1 - x0, y1 - y0] };
    })()`);
    // 气泡开合会清画布：空帧（drawn=0）不是「没长叶子」，重取再判。
    const potGreenSettled = async () => {
      let r = await potGreen();
      for (let i = 0; i < 5 && r.drawn === 0; i += 1) {
        await forceFrame();
        await wait(160);
        r = await potGreen();
      }
      return r;
    };

    await awakeForPlay("v117");
    await dismissBubble();
    await wait(240);

    // R0 六列读数：全部来自引擎快照（渲染端不另算一份），盘上也还没有任何 v1.17 进度。
    const rBase = await diag();
    const rBaseBond = await bondNow();
    const rBaseAbove = rBase.girl.fx.above;
    results.v117 = {
      base: {
        mood: rBase.girl.mood,
        favorite: rBase.girl.favorite,
        tricks: rBase.girl.tricks,
        treasures: rBase.girl.treasures,
        garden: rBase.girl.garden,
        hides: rBase.girl.hides,
        hide: rBase.girl.hide,
      },
    };
    check("v117.diag-columns",
      MOOD_IDS.includes(rBase.girl.mood)
        && (rBase.girl.favorite === null
          || (typeof rBase.girl.favorite === "object"
            && typeof rBase.girl.favorite.id === "string"
            && rBase.girl.favorite.count >= 3))
        && rBase.girl.tricks === 0 && rBase.girl.treasures === 0
        && rBase.girl.garden.stage === "empty" && rBase.girl.garden.ageMs === -1
        && rBase.girl.garden.harvests === 0
        && rBase.girl.hides === 0 && rBase.girl.hide === null,
      `girl=${JSON.stringify(results.v117.base)}`);
    check("v117.bond-clean",
      (rBaseBond?.tricks?.counts?.["high-five"] ?? -1) === 0
        && (rBaseBond?.treasures?.counts?.button ?? -1) === 0
        && (rBaseBond?.garden?.plantedAt ?? 0) === -1
        && (rBaseBond?.hides ?? -1) === 0,
      `bond=${JSON.stringify({ tricks: rBaseBond?.tricks ?? null, treasures: rBaseBond?.treasures ?? null, garden: rBaseBond?.garden ?? null, hides: rBaseBond?.hides ?? null })}`);

    // R1 小把戏：教三次才学会；每次的回执、次数、学没学会都当场读。
    const trickSteps = [];
    for (let i = 0; i < 3; i += 1) {
      await evaluate(s, `window.__cyrene.renderer.handleCommand("trick:high-five")`);
      await wait(220);
      const d = await diag();
      const n = await snap();
      trickSteps.push({
        step: i + 1,
        count: n.tricks?.counts?.["high-five"] ?? null,
        learned: d.girl.tricks,
        bubble: n.bubble?.text ?? null,
      });
      if (i === 0) {
        check("v117.trick.step1",
          trickSteps[0].count === 1 && trickSteps[0].learned === 0 && trickSteps[0].bubble === "击掌 · 还差 2 次",
          JSON.stringify(trickSteps[0]));
      } else if (i === 1) {
        check("v117.trick.step2",
          trickSteps[1].count === 2 && trickSteps[1].learned === 0 && trickSteps[1].bubble === "击掌 · 还差 1 次",
          JSON.stringify(trickSteps[1]));
      } else {
        check("v117.trick.learned",
          trickSteps[2].count === 3 && trickSteps[2].learned === 1
            && saidOrSteal(d.girl, trickSteps[2].bubble, ["把手举高一点…啪！"]),
          JSON.stringify(trickSteps[2]));
      }
    }
    const bondTricks = await bondNow();
    results.v117.tricks = { steps: trickSteps, bond: bondTricks?.tricks ?? null };
    check("v117.trick.persist",
      bondTricks?.tricks?.counts?.["high-five"] === 3,
      `bond.tricks=${JSON.stringify(bondTricks?.tricks ?? null)}`);

    await evaluate(s, `window.__cyrene.renderer.handleCommand("tricks")`);
    await wait(220);
    const tricksReport = (await snap()).bubble?.text ?? null;
    results.v117.tricksReport = tricksReport;
    check("v117.trick.report",
      !!tricksReport && tricksReport.startsWith("小把戏 1/4") && tricksReport.includes("✓ 击掌"),
      `bubble=${tricksReport ?? "null"}`);

    // R2 两本只读账：心情按真表报档位；本命报告与诊断同名同数。
    await evaluate(s, `window.__cyrene.renderer.handleCommand("mood")`);
    await wait(220);
    const moodDiag = await diag();
    const moodText = (await snap()).bubble?.text ?? null;
    const moodLabel = MOOD_LABELS[moodDiag.girl.mood] ?? null;
    results.v117.mood = { id: moodDiag.girl.mood, label: moodLabel, bubble: moodText };
    check("v117.mood-report",
      !!moodLabel && !!moodText && moodText.startsWith(`今天的心情 · ${moodLabel}`) && moodText.includes("\n"),
      `bubble=${moodText ?? "null"} id=${moodDiag.girl.mood}`);
    await evaluate(s, `window.__cyrene.renderer.handleCommand("favorite")`);
    await wait(220);
    const favDiag = await diag();
    const fav = favDiag.girl.favorite;
    const favText = (await snap()).bubble?.text ?? null;
    results.v117.favorite = { favorite: fav, bubble: favText };
    check("v117.favorite-report",
      !!favText && (fav
        ? favText.startsWith(`本命玩具 ${fav.label} · ${fav.count} 次`) && favText.includes("\n")
        : favText.startsWith("本命玩具 还没选中")),
      `bubble=${favText ?? "null"} favorite=${JSON.stringify(fav)}`);

    // R3 小口袋：空袋报告 → 嗅一件 → 计数/落盘/点名 → 报告列出那一件。
    await evaluate(s, `window.__cyrene.renderer.handleCommand("treasures")`);
    await wait(220);
    const pocketEmpty = (await snap()).bubble?.text ?? null;
    results.v117.pocketEmpty = pocketEmpty;
    check("v117.pocket-empty",
      pocketEmpty === "小口袋 还没捡到过什么\n带我到处转转吧",
      `bubble=${pocketEmpty ?? "null"}`);
    await dismissBubble();
    await wait(200);
    await evaluate(s, `window.__cyrene.renderer.handleCommand("treasure")`);
    await wait(220);
    const sniffDiag = await diag();
    const sniffText = (await snap()).bubble?.text ?? null;
    const sniffBond = await bondNow();
    const sniffTotal = Object.values(sniffBond?.treasures?.counts ?? {})
      .reduce((sum, v) => sum + (typeof v === "number" ? v : 0), 0);
    results.v117.treasure = { total: sniffDiag.girl.treasures, bondTotal: sniffTotal, bubble: sniffText };
    check("v117.treasure-sniff",
      sniffDiag.girl.treasures === 1 && sniffTotal === 1
        && typeof sniffText === "string" && sniffText.startsWith("捡到") && sniffText.endsWith("，先收好"),
      `bubble=${sniffText ?? "null"} total=${sniffDiag.girl.treasures} bondTotal=${sniffTotal}`);
    await evaluate(s, `window.__cyrene.renderer.handleCommand("treasures")`);
    await wait(220);
    const pocketOne = (await snap()).bubble?.text ?? null;
    results.v117.pocketOne = pocketOne;
    check("v117.pocket-one",
      !!pocketOne && pocketOne.startsWith("小口袋 1 件") && pocketOne.includes("×1"),
      `bubble=${pocketOne ?? "null"}`);

    // R4 薄荷盆：空盆报告 → 种下（画布上真的多出一点绿 + 盘上有播种时刻）→ 未熟收不了。
    await dismissBubble();
    await wait(200);
    await evaluate(s, `window.__cyrene.renderer.handleCommand("garden")`);
    await wait(220);
    const gardenEmpty = (await snap()).bubble?.text ?? null;
    await dismissBubble();
    await wait(200);
    await forceFrame();
    const potBefore = await potGreenSettled();
    await evaluate(s, `window.__cyrene.renderer.handleCommand("garden-plant")`);
    await wait(260);
    const plantDiag = await diag();
    const plantText = (await snap()).bubble?.text ?? null;
    const plantBond = await bondNow();
    await forceFrame();
    const potAfter = await potGreenSettled();
    await shot("girl-garden-v117.png");
    results.v117.garden = {
      emptyBubble: gardenEmpty,
      potBefore,
      potAfter,
      stage: plantDiag.girl.garden,
      bubble: plantText,
      bond: plantBond?.garden ?? null,
    };
    check("v117.garden-empty",
      gardenEmpty === "薄荷盆 空着\n种一颗吧，很快会发芽",
      `bubble=${gardenEmpty ?? "null"}`);
    check("v117.garden-plant",
      plantDiag.girl.garden.stage === "seed"
        && plantDiag.girl.garden.ageMs >= 0 && plantDiag.girl.garden.ageMs < 60_000
        && plantText === "种下啦，等它发芽"
        && typeof plantBond?.garden?.plantedAt === "number" && plantBond.garden.plantedAt > 0,
      `garden=${JSON.stringify(plantDiag.girl.garden)} bubble=${plantText ?? "null"} bond=${JSON.stringify(plantBond?.garden ?? null)}`);
    check("v117.garden-pot-pixels",
      potAfter.green >= 3 && potAfter.green - potBefore.green >= 3,
      `before=${JSON.stringify(potBefore)} after=${JSON.stringify(potAfter)}`);
    await evaluate(s, `window.__cyrene.renderer.handleCommand("garden-plant")`);
    await wait(220);
    const replantText = (await snap()).bubble?.text ?? null;
    const replantDiag = await diag();
    await evaluate(s, `window.__cyrene.renderer.handleCommand("garden-harvest")`);
    await wait(220);
    const harvestText = (await snap()).bubble?.text ?? null;
    const harvestDiag = await diag();
    const harvestBond = await bondNow();
    results.v117.garden.replant = { bubble: replantText, garden: replantDiag.girl.garden };
    results.v117.garden.harvest = { bubble: harvestText, garden: harvestDiag.girl.garden, bond: harvestBond?.garden ?? null };
    check("v117.garden-replant",
      replantText === "盆里还种着东西呢" && replantDiag.girl.garden.stage === "seed",
      `bubble=${replantText ?? "null"} garden=${JSON.stringify(replantDiag.girl.garden)}`);
    check("v117.garden-harvest-reject",
      harvestText === "还没长好，再等等" && harvestDiag.girl.garden.stage === "seed"
        && harvestDiag.girl.garden.harvests === 0 && (harvestBond?.garden?.harvests ?? 0) === 0,
      `bubble=${harvestText ?? "null"} garden=${JSON.stringify(harvestDiag.girl.garden)} bond=${JSON.stringify(harvestBond?.garden ?? null)}`);

    // R5 躲猫猫第一轮：捂眼点＝太早（不记账、不摸头）→ 探头点中＝逮到（hides+1 落盘）→ 收走。
    await dismissBubble();
    await wait(200);
    await evaluate(s, `window.__cyrene.renderer.handleCommand("hide-seek")`);
    await wait(240);
    const hideA = await diag();
    const hideASnap = await snap();
    results.v117.hide = {
      a: {
        hide: hideA.girl.hide,
        hides: hideA.girl.hides,
        bubble: hideASnap.bubble?.text ?? null,
        above: hideA.girl.fx.above,
      },
    };
    check("v117.hide-cover",
      hideA.girl.hide?.phase === "cover" && hideA.girl.hides === 0
        && hideASnap.bubble?.text === "你来找我呀，数到三就探头",
      `hide=${JSON.stringify(hideA.girl.hide)} bubble=${hideASnap.bubble?.text ?? "null"}`);
    check("v117.hide-marks",
      hideA.girl.fx.above - rBaseAbove >= 3,
      `above=${hideA.girl.fx.above} base=${rBaseAbove}`);
    const earlyTap = await tapFaceNow();
    await wait(160);
    const hideEarly = await diag();
    const hideEarlySnap = await snap();
    results.v117.hide.early = {
      tap: earlyTap,
      hide: hideEarly.girl.hide,
      hides: hideEarly.girl.hides,
      bubble: hideEarlySnap.bubble?.text ?? null,
    };
    check("v117.hide-early",
      !!earlyTap.ok && hideEarly.girl.hides === 0 && hideEarly.girl.hide?.phase === "cover"
        && hideEarlySnap.bubble?.text === "你来找我呀，数到三就探头",
      JSON.stringify(results.v117.hide.early));

    const peek = await waitHidePhase("peek", 2_200);
    const peekSnap = await snap();
    results.v117.hide.peek = { hide: peek, bubble: peekSnap.bubble?.text ?? null };
    check("v117.hide-peek", peek?.phase === "peek" && peek?.left > 500, `hide=${JSON.stringify(peek)}`);
    await shot("girl-hide-peek.png");
    const catchTap = await tapFaceNow();
    await wait(180);
    const hideFound = await diag();
    const hideFoundSnap = await snap();
    const bondCaught = await bondNow();
    results.v117.hide.found = {
      tap: catchTap,
      hide: hideFound.girl.hide,
      hides: hideFound.girl.hides,
      bubble: hideFoundSnap.bubble?.text ?? null,
      bondHides: bondCaught?.hides ?? null,
    };
    await shot("girl-hide-found.png");
    check("v117.hide-found",
      !!catchTap.ok && hideFound.girl.hides === 1 && hideFound.girl.hide?.phase === "found"
        && bondCaught?.hides === 1,
      JSON.stringify(results.v117.hide.found));
    check("v117.hide-found-line",
      saidOrSteal(hideFound.girl, results.v117.hide.found.bubble, ["被找到啦！"]),
      `bubble=${results.v117.hide.found.bubble ?? "null"}`);
    const foundGone = await waitHideGone(3_000);
    results.v117.hide.foundGone = foundGone;
    check("v117.hide-clears", !foundGone, `hide=${JSON.stringify(foundGone)}`);

    // R6 躲猫猫第二轮：探头窗口没人点 → 渲染端报一次「没找到」；hides 不涨，也不重复报。
    await dismissBubble();
    await wait(200);
    await evaluate(s, `window.__cyrene.renderer.handleCommand("hide-seek")`);
    await wait(240);
    const missPeek = await waitHidePhase("peek", 2_000);
    const miss = await waitHidePhase("miss", 3_200);
    const missDiag = await diag();
    const missSnap = await snap();
    results.v117.hide.miss = {
      peek: missPeek?.phase ?? null,
      hide: miss,
      hides: missDiag.girl.hides,
      bubble: missSnap.bubble?.text ?? null,
    };
    check("v117.hide-miss",
      missPeek?.phase === "peek" && miss?.phase === "miss" && missDiag.girl.hides === 1
        && missSnap.bubble?.text === "没找到我，我在这里呢",
      JSON.stringify(results.v117.hide.miss));
    const missGone = await waitHideGone(2_500);
    await forceFrame();
    const missAfter = await diag();
    const missAfterSnap = await snap();
    results.v117.hide.missGone = {
      hide: missGone,
      hides: missAfter.girl.hides,
      bubble: missAfterSnap.bubble?.text ?? null,
    };
    check("v117.hide-miss-once",
      !missGone && missAfter.girl.hides === 1
        && missAfterSnap.bubble?.text === "没找到我，我在这里呢",
      JSON.stringify(results.v117.hide.missGone));
  }

  // —— S. v1.18.0 自娱五件 + 声音：整轮在页面里跑完 ——
  // 皮球的落地拍窗只有 BALL.window 那一小段，咬钩窗 900ms、台本拍点是每段最后 400ms，
  // 而一次 CDP 往返 30–80ms 还夹着后台稀帧：Node 侧「先读坐标再点」量到的是探针的腿脚，
  // 不是玩具没接住。所以每轮都在页面里读一拍点一拍，只把逐拍样本带回来判。
  {
    results.v118 = {};
    const girlOf = async () => (await diag()).girl;
    const bondNow = () => evaluate(s, `(() => {
      try { return JSON.parse(localStorage.getItem("cyrene.pet.bond.v1") ?? "null"); } catch { return null; }
    })()`);
    /** 收场句命中记录：徽章/升档按设计顶得过动作回执，所以「原句命中几次」才是判据，不是「句句命中」。 */
    const endLines = [];
    const sayEnd = async (kind, value) => {
      const want = soloEndLine(kind, value);
      const got = await waitBubbleLine([want], 4_500);
      endLines.push({ kind, want, got, exact: got === want });
      return got;
    };
    const install = async () => {
      const ok = await evaluate(s, SOLO_PROBE_SRC);
      if (ok !== true) throw new Error("[ENV] 页面内跑轮的探针助手没装上（__soloProbe）：旧构建，不是产品红");
    };
    /** 页面里跑不完的一次往返（IPC）用全局摆渡：先踢一发，再轮询那个全局。 */
    const kickGlobal = (expr) => evaluate(s, `(() => {
      window.__probeBridge = null;
      ${expr}
      return true;
    })()`);
    const pollGlobal = async (timeoutMs = 6_000) => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const v = await evaluate(s, `window.__probeBridge === undefined ? null : window.__probeBridge`);
        if (v !== null || Date.now() >= deadline) return v;
        await wait(120);
      }
    };
    const geoRead = () => kickGlobal(`window.verge.getPetGeometry().then((g) => {
      window.__probeBridge = { keys: Object.keys(g).sort(), sfxEnabled: g.sfxEnabled };
    }, (e) => { window.__probeBridge = { error: String(e) }; });`);
    await install();
    /** 起一件并把「她真的开场了」变成一条判据（首点结果才算，startToy 自己会补一次重试）。 */
    const armSolo = async (command, key, where) => {
      await awakeForPlay(where);
      await dismissBubble();
      await wait(240);
      const started = await startToy(command, key, where);
      check(`v118.${key}.start`, !!started.prop, `gate=${JSON.stringify(started.gateBefore)}`);
      const snap0 = await snap();
      return { started, startLine: snap0.bubble?.text ?? null };
    };

    // S0 开机面：声音通道与空账本（干净档上盘里没写过 sfx，默认必须是「开着」）。
    const s0 = { channels: {}, solo: null, sfx: null };
    s0.channels.onSfxChanged = await evaluate(s, `typeof window.verge.onSfxChanged`);
    s0.channels.shape = await evaluate(s, `(() => {
      const off = window.verge.onSfxChanged(() => { /* 只验通道能挂上：菜单才是唯一的写者，翻转本身归单测 */ });
      const type = typeof off;
      if (type === 'function') off();
      return { offType: type };
    })()`);
    await geoRead();
    s0.geo = await pollGlobal();
    const g0 = await girlOf();
    s0.solo = g0.solo;
    s0.sfx = g0.sfx;
    s0.selfPlay = g0.stats.selfPlay;
    results.v118.boot = s0;
    check("v118.boot.channel", s0.channels.onSfxChanged === "function" && s0.channels.shape?.offType === "function",
      `onSfxChanged=${s0.channels.onSfxChanged} off=${JSON.stringify(s0.channels.shape)}`);
    check("v118.boot.geometry", !!s0.geo && s0.geo.sfxEnabled === true && !s0.geo.error,
      `geo=${JSON.stringify(s0.geo)}`);
    check("v118.boot.solo-empty", s0.solo && SOLO.kinds.every((k) => s0.solo[SOLO_FIELD_READ[k]] === 0)
      && Array.isArray(s0.solo.seen) && s0.solo.seen.length === 0,
      `solo=${JSON.stringify(s0.solo)}`);
    check("v118.boot.sfx-on", s0.sfx?.enabled === true && s0.selfPlay === 0,
      `sfx=${JSON.stringify(s0.sfx)} selfPlay=${s0.selfPlay}`);

    // S1 皮球：按落地拍连点五下 → 峰值进账本、轮数进统计、落盘。
    const sp0 = (await girlOf()).stats.selfPlay;
    const soloBeforeBall = JSON.stringify((await girlOf()).solo);
    const s1 = await armSolo("ball", "ball", "v118-ball");
    const ballStartOk = s1.startLine === SOLO.starts.ball;
    check("v118.ball.start-line", ballStartOk, `bubble=${s1.startLine ?? "null"} want=${SOLO.starts.ball}`);
    await shot("girl-solo-ball.png");
    s1.samples = await evaluateInPage(
      s, `window.__soloProbe.ballRound(5, ${BALL.period}, ${BALL.ms}, ${BALL.window})`, 60_000);
    const ballLast = [...s1.samples].reverse().find((x) => typeof x.bounces === "number") ?? null;
    const ballGone = await waitPropGone("ball", 12_000);
    const g1 = await girlOf();
    const ballEndLine = await sayEnd("ball", ballLast?.best ?? 0);
    results.v118.ball = {
      startLine: s1.startLine, samples: s1.samples, last: ballLast, gone: ballGone,
      end: ballEndLine, solo: g1.solo, sfx: g1.sfx, achievements: g1.achievements,
      selfPlay: g1.stats.selfPlay, ballBestNow: (await girlOf()).solo.ballBest,
    };
    check("v118.ball.beat", (ballLast?.bounces ?? 0) >= 4 && (ballLast?.best ?? 0) >= 4,
      `samples=${JSON.stringify(s1.samples)}`);
    check("v118.ball.settle", !ballGone && g1.solo.ballBest === (ballLast?.best ?? -1)
      && g1.stats.selfPlay === sp0 + 1,
      `gone=${JSON.stringify(ballGone)} ballBest=${g1.solo.ballBest} last=${JSON.stringify(ballLast)} selfPlay=${g1.stats.selfPlay}`);
    check("v118.ball.line", ballEndLine === soloEndLine("ball", ballLast?.best ?? 0)
      || shownAchievementLine(g1)?.line === ballEndLine,
      `bubble=${ballEndLine ?? "null"} want=${soloEndLine("ball", ballLast?.best ?? 0)} steal=${JSON.stringify(shownAchievementLine(g1))}`);
    check("v118.ball.achievement", g1.achievements.includes("ball-rhythm"),
      `achievements=${JSON.stringify(g1.achievements)}`);
    check("v118.sfx.wired", g1.sfx.played > 0 && g1.sfx.enabled === true,
      `sfx=${JSON.stringify(g1.sfx)}（played>0 才算渲染桥真接上了出声口；响没响人耳才晓得，脚本只认台账）`);
    check("v118.ball.disk", (await bondNow())?.solo?.ballBest === g1.solo.ballBest
      && JSON.stringify(g1.solo) !== soloBeforeBall,
      `disk=${JSON.stringify((await bondNow())?.solo ?? null)} solo=${JSON.stringify(g1.solo)}`);

    // S2 夜灯：点四下火苗 + 吓走一只蛾子（蛾子另记一笔，不进战果）。
    const soloBeforeLantern = (await girlOf()).solo;
    const s2 = await armSolo("lantern", "lantern", "v118-lantern");
    results.v118.lantern = { startLine: s2.startLine };
    check("v118.lantern.start-line", s2.startLine === SOLO.starts.lantern,
      `bubble=${s2.startLine ?? "null"} want=${SOLO.starts.lantern}`);
    await shot("girl-solo-lantern.png");
    s2.round = await evaluateInPage(s, `window.__soloProbe.lanternRound(4, 420, 5_000)`, 40_000);
    const lanternGone = await waitPropGone("lantern", 14_000);
    const g2 = await girlOf();
    const lanternFlares = s2.round.taps.map((t) => t.flares).filter((n) => typeof n === "number").pop() ?? 0;
    const lanternEndLine = await sayEnd("lantern", lanternFlares);
    const mothDelta = g2.solo.moths - (soloBeforeLantern.moths ?? 0);
    results.v118.lantern = { ...results.v118.lantern, round: s2.round, gone: lanternGone,
      end: lanternEndLine, solo: g2.solo, moths: g2.solo.moths, mothsBefore: soloBeforeLantern.moths };
    check("v118.lantern.flares", lanternFlares >= 4, `taps=${JSON.stringify(s2.round.taps)}`);
    check("v118.lantern.moth", (s2.round.mothTries ?? []).some((t) => typeof t.after === "number" && t.after > t.before)
      && mothDelta >= 1,
      `tries=${JSON.stringify(s2.round.mothTries)} moths=${g2.solo.moths} before=${soloBeforeLantern.moths}`);
    check("v118.lantern.ledger", !lanternGone && g2.solo.flares === (soloBeforeLantern.flares ?? 0) + lanternFlares
      && lanternEndLine === soloEndLine("lantern", lanternFlares),
      `gone=${JSON.stringify(lanternGone)} flares=${g2.solo.flares} round=${lanternFlares} bubble=${lanternEndLine ?? "null"}`);

    // S3 钓鱼：只在咬钩那一拍伸爪。
    const soloBeforeFish = (await girlOf()).solo;
    const s3 = await armSolo("fishing", "fishing", "v118-fishing");
    check("v118.fishing.start-line", (await snap()).bubble?.text === SOLO.starts.fishing,
      `bubble=${s3.startLine ?? "null"} want=${SOLO.starts.fishing}`);
    await shot("girl-solo-fishing.png");
    s3.round = await evaluateInPage(s, `window.__soloProbe.fishRound(150, 16_500)`, 40_000);
    const fishGone = await waitPropGone("fishing", 6_000);
    const g3 = await girlOf();
    const fishCatches = s3.round.hits.length;
    const fishEnd = await sayEnd("fishing", fishCatches);
    results.v118.fishing = { round: s3.round, gone: fishGone, end: fishEnd, solo: g3.solo };
    check("v118.fishing.bite", fishCatches >= 3 && s3.round.phases.includes("bite"),
      `hits=${JSON.stringify(s3.round.hits)} phases=${JSON.stringify(s3.round.phases)}`);
    check("v118.fishing.ledger", !fishGone && g3.solo.fish === (soloBeforeFish.fish ?? 0) + fishCatches
      && fishEnd === soloEndLine("fishing", fishCatches),
      `gone=${JSON.stringify(fishGone)} fish=${g3.solo.fish} round=${fishCatches} bubble=${fishEnd ?? "null"}`);

    // S4 照镜子：镜面中心跟着换脸点。
    const soloBeforeMirror = (await girlOf()).solo;
    const s4 = await armSolo("mirror", "mirror", "v118-mirror");
    check("v118.mirror.start-line", s4.startLine === SOLO.starts.mirror,
      `bubble=${s4.startLine ?? "null"} want=${SOLO.starts.mirror}`);
    await shot("girl-solo-mirror.png");
    // 220ms 连点能把镜子点到 32 次、当场解锁 mirror-friend，收场句就被徽章顶掉；
    // 改成 800ms 摊开点五下：三张脸都见到、又摸不到 12 的门槛，收场句才是这一轮自己的。
    s4.round = await evaluateInPage(s, `window.__soloProbe.mirrorRound(800, 11_000, 5)`, 30_000);
    const mirrorGone = await waitPropGone("mirror", 6_000);
    const g4 = await girlOf();
    const mirrorMatched = (g4.mirror === null ? (s4.round.marks.at(-1)?.matched ?? 0) : g4.mirror.matched);
    const mirrorEndLine = await sayEnd("mirror", mirrorMatched);
    results.v118.mirror = { round: s4.round, gone: mirrorGone, end: mirrorEndLine, solo: g4.solo };
    check("v118.mirror.copy", mirrorMatched >= 3 && s4.round.faces.length >= 3,
      `marks=${JSON.stringify(s4.round.marks)} faces=${JSON.stringify(s4.round.faces)}`);
    check("v118.mirror.ledger", !mirrorGone && g4.solo.mirror === (soloBeforeMirror.mirror ?? 0) + mirrorMatched
      && mirrorEndLine === soloEndLine("mirror", mirrorMatched),
      `gone=${JSON.stringify(mirrorGone)} mirror=${g4.solo.mirror} round=${mirrorMatched} bubble=${mirrorEndLine ?? "null"}`);

    // S5 台本：整场跟着拍，一步不落地走完。
    const soloBeforeCombo = (await girlOf()).solo;
    const spBeforeCombo = (await girlOf()).stats.selfPlay;
    const s5 = await armSolo("combo", "combo", "v118-combo");
    check("v118.combo.start-line", s5.startLine === SOLO.starts.combo,
      `bubble=${s5.startLine ?? "null"} want=${SOLO.starts.combo}`);
    await shot("girl-solo-combo.png");
    s5.round = await evaluateInPage(s, `window.__soloProbe.comboRound(150, 14_000)`, 30_000);
    const comboGone = await waitPropGone("combo", 6_000);
    const g5 = await girlOf();
    const segCount = (s5.round.stepsTotal ?? 0) + 1;
    const comboEndLine = await sayEnd("combo", s5.round.final?.best ?? 0);
    results.v118.combo = { round: s5.round, gone: comboGone, end: comboEndLine, solo: g5.solo,
      achievements: g5.achievements, segCount };
    check("v118.combo.full", (s5.round.final?.claps ?? 0) >= segCount && (s5.round.final?.best ?? 0) >= segCount,
      `final=${JSON.stringify(s5.round.final)} segs=${segCount} steps=${JSON.stringify(s5.round.steps)}`);
    check("v118.combo.ledger", !comboGone && g5.solo.comboBest === (s5.round.final?.best ?? -1)
      && g5.stats.selfPlay === spBeforeCombo + 1
      && (s5.round.final?.best ?? 0) >= (soloBeforeCombo.comboBest ?? 0),
      `gone=${JSON.stringify(comboGone)} comboBest=${g5.solo.comboBest} final=${JSON.stringify(s5.round.final)} selfPlay=${g5.stats.selfPlay}`);
    check("v118.combo.achievement", g5.achievements.includes("full-rundown")
      && g5.achievements.includes("solo-player"),
      `achievements=${JSON.stringify(g5.achievements)}`);
    check("v118.end-lines", endLines.filter((e) => e.exact).length >= 3,
      `lines=${JSON.stringify(endLines)}`);

    // S6 互斥与零战果：新件顶掉旧件，但被顶的那一轮不许结算；空手回来只说「没玩出名堂」。
    const soloBeforePreempt = (await girlOf()).solo;
    const spBeforePreempt = (await girlOf()).stats.selfPlay;
    const preBall = await startToy("ball", "ball", "v118-preempt-ball");
    await evaluate(s, `window.__cyrene.renderer.handleCommand("lantern")`);
    await wait(320);
    const gPre = await girlOf();
    const preSnap = await snap();
    results.v118.preempt = { ball: !!preBall.prop, solo: gPre.solo, bubble: preSnap.bubble?.text ?? null,
      ballNow: gPre.ball, lanternNow: gPre.lantern };
    check("v118.preempt.swap", !!preBall.prop && gPre.ball === null && !!gPre.lantern,
      `ball=${JSON.stringify(gPre.ball)} lantern=${JSON.stringify(gPre.lantern)}`);
    check("v118.preempt.no-settle", JSON.stringify(gPre.solo) === JSON.stringify(soloBeforePreempt)
      && gPre.stats.selfPlay === spBeforePreempt,
      `solo=${JSON.stringify(gPre.solo)} before=${JSON.stringify(soloBeforePreempt)} selfPlay=${gPre.stats.selfPlay}`);
    check("v118.preempt.line", preSnap.bubble?.text === SOLO.starts.lantern,
      `bubble=${preSnap.bubble?.text ?? "null"} want=${SOLO.starts.lantern}`);
    const emptyGone = await waitPropGone("lantern", 14_000);
    await forceFrame();
    const gEmpty = await girlOf();
    const emptyLine = await waitBubbleLine([SOLO.empty], 3_000);
    const spAfterEmpty = (await girlOf()).stats.selfPlay;
    results.v118.emptyRound = { gone: emptyGone, line: emptyLine, solo: gEmpty.solo, selfPlay: spAfterEmpty };
    check("v118.empty.clears", !emptyGone, `lantern=${JSON.stringify(emptyGone)}`);
    check("v118.empty-line", emptyLine === SOLO.empty, `bubble=${emptyLine ?? "null"} want=${SOLO.empty}`);
    check("v118.empty-no-account", gEmpty.solo.flares === soloBeforePreempt.flares && spAfterEmpty === spBeforePreempt,
      `flares=${gEmpty.solo.flares} before=${soloBeforePreempt.flares} selfPlay=${spAfterEmpty}`);

    // S7 三道闸：免打扰、猫形态、声音开关。前两道是「根本不接」，最后一道只咽声音。
    const s7 = {};
    await evaluate(s, `window.__cyrene.renderer.setQuiet(true)`);
    await wait(260);
    await dismissBubble();
    await wait(200);
    const soloBeforeQuiet = JSON.stringify((await girlOf()).solo);
    const sfxBeforeQuiet = (await girlOf()).sfx;
    await evaluate(s, `window.__cyrene.renderer.handleCommand("ball")`);
    await wait(420);
    const gQuiet = await girlOf();
    const quietSnap = await snap();
    const sfxAfterQuiet = gQuiet.sfx;
    s7.quiet = { ball: gQuiet.ball, bubble: quietSnap.bubble?.text ?? null, soloSame: JSON.stringify(gQuiet.solo) === soloBeforeQuiet,
      playedBefore: sfxBeforeQuiet.played, playedAfter: sfxAfterQuiet.played };
    await evaluate(s, `window.__cyrene.renderer.setQuiet(false)`);
    await wait(320);
    check("v118.quiet-refused", s7.quiet.ball === null && s7.quiet.soloSame && s7.quiet.playedAfter === s7.quiet.playedBefore,
      JSON.stringify(s7.quiet));
    await dismissBubble();
    await evaluate(s, `window.__cyrene.renderer.setForm("cat")`);
    await wait(700);
    await evaluate(s, `window.__cyrene.renderer.handleCommand("ball")`);
    await wait(420);
    const gCat = await diag();
    s7.cat = { form: gCat.form, ball: gCat.girl.ball, solo: gCat.girl.solo };
    await evaluate(s, `window.__cyrene.renderer.setForm("girl")`);
    await wait(900);
    s7.formRestored = (await diag()).form;
    check("v118.form-refused", s7.cat.form === "cat" && s7.cat.ball === null && s7.formRestored === "girl",
      JSON.stringify(s7.cat) + " restored=" + s7.formRestored);

    await awakeForPlay("v118-sfx-gate");
    const sfxGateStart = await startToy("ball", "ball", "v118-sfx-gate");
    await evaluate(s, `window.__cyrene.renderer.setSfxEnabled(false)`);
    await wait(160);
    s7.sfxOff = await evaluateInPage(s, `window.__soloProbe.sfxWatch(1_600)`, 30_000);
    const offDelta = { played: s7.sfxOff.after.played - s7.sfxOff.before.played,
      blocked: s7.sfxOff.after.blocked - s7.sfxOff.before.blocked };
    await evaluate(s, `window.__cyrene.renderer.setSfxEnabled(true)`);
    await wait(160);
    s7.sfxOn = await evaluateInPage(s, `window.__soloProbe.sfxWatch(1_600)`, 30_000);
    const onDelta = { played: s7.sfxOn.after.played - s7.sfxOn.before.played,
      blocked: s7.sfxOn.after.blocked - s7.sfxOn.before.blocked };
    results.v118.sfxGate = { started: !!sfxGateStart.prop, off: s7.sfxOff, offDelta: offDelta, on: s7.sfxOn, onDelta: onDelta };
    check("v118.sfx-off", !!sfxGateStart.prop && offDelta.played === 0 && offDelta.blocked >= 1
      && s7.sfxOff.after.enabled === false,
      `delta=${JSON.stringify(offDelta)} watch=${JSON.stringify(s7.sfxOff)}`);
    check("v118.sfx-on", s7.sfxOn.after.enabled === true && onDelta.played >= 1,
      `delta=${JSON.stringify(onDelta)} watch=${JSON.stringify(s7.sfxOn)}`);
    const sfxBallGone = await waitPropGone("ball", 12_000);
    results.v118.sfxGate.ballGone = sfxBallGone;

    // S8 汇报：一句「自娱 5/5 件 · 战果 N」——N 由账本原样相加，探针不重算。
    await dismissBubble();
    await wait(240);
    await evaluate(s, `window.__cyrene.renderer.handleCommand("solo")`);
    await wait(300);
    const gReport = await girlOf();
    const reportSnap = await snap();
    const reportText = reportSnap.bubble?.text ?? null;
    const reportScore = SOLO.kinds.reduce((sum, k) => sum + (gReport.solo[SOLO_FIELD_READ[k]] ?? 0), 0);
    results.v118.report = { bubble: reportText, solo: gReport.solo, score: reportScore, idle: gReport.solo.seen.length };
    check("v118.report-head", reportText?.startsWith(`自娱 ${SOLO.kinds.length}/${SOLO.kinds.length} 件 · 战果 ${reportScore}`),
      `bubble=${JSON.stringify(reportText)} score=${reportScore} solo=${JSON.stringify(gReport.solo)}`);
    check("v118.report-seen", gReport.solo.seen.length === SOLO.kinds.length
      && SOLO.kinds.every((k) => gReport.solo.seen.includes(k)),
      `seen=${JSON.stringify(gReport.solo.seen)}`);
    check("v118.report-noToy", gReport.ball === null && gReport.combo === null && gReport.lantern === null
      && gReport.fishing === null && gReport.mirror === null,
      `ball=${JSON.stringify(gReport.ball)} combo=${JSON.stringify(gReport.combo)} lantern=${JSON.stringify(gReport.lantern)}`);

    // S9 跨重启：账本原样回来，声音按盘里的默认（开着）重建，不继承渲染端那次翻转。
    const reloadPre = {
      origin: await evaluate(s, `performance.timeOrigin`),
      solo: (await girlOf()).solo,
      selfPlay: (await girlOf()).stats.selfPlay,
      achievements: (await girlOf()).achievements,
    };
    await geoRead();
    const geoBeforeReload = await pollGlobal();
    let reloadAt = 0;
    let lastError = null;
    const reloadDeadline = Date.now() + 40_000;
    for (;;) {
      const now = Date.now();
      if (now >= reloadAt) {
        try { await s.send("Page.reload", { ignoreCache: false }, 20_000); } catch (e) { lastError = String(e); }
        reloadAt = now + 8_000;
      }
      const st = await evaluate(s, `(() => ({
        origin: performance.timeOrigin,
        bridge: !!window.__cyrene,
        canvas: !!document.getElementById("pet-canvas"),
      }))()`, 5_000).catch(() => null);
      if (st && st.bridge && st.canvas && st.origin > reloadPre.origin) break;
      if (Date.now() > reloadDeadline) {
        throw new Error(`[ENV] 重载后 40s 没等到新页面的渲染桥（last=${JSON.stringify(lastError)}）`);
      }
      await wait(150);
    }
    if (!(await waitPetInk(s, 20_000, appLog, child))) {
      dumpAndKill(child, appLog, "重载后 20s 猫窗没现身（ENV：启动动画没让位，不是自娱账本丢了）");
    }
    await evaluate(s, `window.__cyrene.setGazeFrozen(true)`).catch(() => {});
    await install();
    const ledgerDeadline = Date.now() + 30_000;
    let gReload = await girlOf();
    for (;;) {
      gReload = await girlOf();
      if (gReload.solo?.seen?.length === SOLO.kinds.length || Date.now() >= ledgerDeadline) break;
      await wait(250);
    }
    await geoRead();
    const geoAfterReload = await pollGlobal();
    const bondReload = await bondNow();
    results.v118.reload = {
      before: reloadPre, after: { solo: gReload.solo, selfPlay: gReload.stats.selfPlay, sfx: gReload.sfx },
      geoBefore: geoBeforeReload, geoAfter: geoAfterReload, disk: bondReload?.solo ?? null,
    };
    check("v118.reload.ledger", JSON.stringify(gReload.solo) === JSON.stringify(reloadPre.solo)
      && gReload.stats.selfPlay === reloadPre.selfPlay,
      `after=${JSON.stringify(gReload.solo)} before=${JSON.stringify(reloadPre.solo)} selfPlay=${gReload.stats.selfPlay}/${reloadPre.selfPlay}`);
    check("v118.reload.disk", JSON.stringify(bondReload?.solo ?? null) === JSON.stringify(reloadPre.solo),
      `disk=${JSON.stringify(bondReload?.solo ?? null)} memory=${JSON.stringify(reloadPre.solo)}`);
    check("v118.reload.sfx", geoBeforeReload?.sfxEnabled === true && geoAfterReload?.sfxEnabled === true
      && gReload.sfx.enabled === true,
      `geoBefore=${JSON.stringify(geoBeforeReload)} geoAfter=${JSON.stringify(geoAfterReload)} sfx=${JSON.stringify(gReload.sfx)}`);
    check("v118.reload.achievements", SOLO.kinds.length === 5
      && ["ball-rhythm", "full-rundown", "solo-player"].every((id) => gReload.achievements.includes(id))
      && reloadPre.achievements.includes("ball-rhythm"),
      `after=${JSON.stringify(gReload.achievements)} before=${JSON.stringify(reloadPre.achievements)}`);
    await shot("girl-solo-v118.png");
  }

  // —— T. v1.19「她的一天」：窗角天色记号 / 一起看天 / 节日挂饰 / 自己睡 / 自己醒 ——
  // 判据全部按源码表算：拨到黄昏看角落那枚落日（玫瑰像素）、点它只看一次（账本+台词+记号收掉）、
  // 节日挂饰按同一块头侧区域做像素 A/B、23:41 人走开满三分钟自己睡（月亮记号随之收掉）、
  // 05:00 自己伸懒腰醒来（日出记号亮起且没被记成「看过」）。
  // 整段只在页面里拨 Date.now（引擎的壁钟），行为秒表 performance.now 不动。
  {
    results.v119 = {};
    const bondNow = () => evaluate(s, `(() => {
      try { return JSON.parse(localStorage.getItem("cyrene.pet.bond.v1") ?? "null"); } catch { return null; }
    })()`);
    const setWall = (ms) => evaluate(s, `(() => {
      if (typeof window.__realDateNowV119 !== "function") window.__realDateNowV119 = Date.now;
      Date.now = () => ${Math.round(ms)};
      return Date.now();
    })()`);
    const restoreWall = () => evaluate(s, `(() => {
      if (typeof window.__realDateNowV119 === "function") {
        Date.now = window.__realDateNowV119;
        delete window.__realDateNowV119;
      }
      return Date.now();
    })()`);
    const settle = async (frames = 2) => {
      for (let i = 0; i < frames; i += 1) { await forceFrame(); await wait(110); }
    };
    /**
     * 窗角那枚记号：先画一帧再数（气泡换宽会把画布清成透明），只认两族颜色——
     * 玫瑰（日轮）与强调蓝（月亮/地平线）。Zzz 是奶油墨，不进这两族，别把睡脸算成记号。
     */
    const cornerCount = () => evaluate(s, `(() => {
      window.__cyrene.renderer.draw(performance.now());
      const d = window.__cyrene.getPetDiagnostics();
      const c = document.getElementById("pet-canvas");
      if (!c) return { rose: 0, blue: 0, scale: 0 };
      const ctx = c.getContext("2d", { willReadFrequently: true });
      const scale = (c.width / Math.max(1, c.clientWidth)) * ((d.layout && d.layout.zoom) || 1);
      const x0 = Math.max(0, Math.floor((${SKY_MARK.x} - 8) * scale));
      const x1 = Math.min(c.width, Math.ceil((${SKY_MARK.x} + 9) * scale));
      const y0 = Math.max(0, Math.floor((${SKY_MARK.y} - 7) * scale));
      const y1 = Math.min(c.height, Math.ceil((${SKY_MARK.y} + 8) * scale));
      const data = ctx.getImageData(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)).data;
      let rose = 0, blue = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
        if (a > 120 && r > 200 && g > 70 && g < 200 && b > 95 && b < 215) rose += 1;
        if (a > 120 && b > 150 && b - r > 55 && b - g > 40) blue += 1;
      }
      return { rose, blue, scale: +scale.toFixed(2), box: [x0, y0, x1 - x0, y1 - y0] };
    })()`);
    /** 头侧挂饰那一小块：脸框 / 朝向 / 半径都按 girl-day-art 的同一条算式现算。 */
    const headBlue = () => evaluate(s, `(() => {
      window.__cyrene.renderer.draw(performance.now());
      const d = window.__cyrene.getPetDiagnostics();
      const snap = window.__cyrene.renderer.getCompanionSnapshot();
      const face = d.girl && d.girl.face;
      if (!face) return { blue: 0, face: null };
      const c = document.getElementById("pet-canvas");
      if (!c) return { blue: 0, face };
      const ctx = c.getContext("2d", { willReadFrequently: true });
      const scale = (c.width / Math.max(1, c.clientWidth)) * ((d.layout && d.layout.zoom) || 1);
      const facing = (snap && snap.facing) ?? 1;
      const r = Math.max(2.8, face.w * 0.15);
      const cx = face.cx - facing * face.w * 0.56;
      const cy = face.top + face.h * 0.1;
      const x0 = Math.max(0, Math.floor((cx - r * 1.9) * scale));
      const x1 = Math.min(c.width, Math.ceil((cx + r * 1.9) * scale));
      const y0 = Math.max(0, Math.floor((cy - r * 1.9) * scale));
      const y1 = Math.min(c.height, Math.ceil((cy + r * 1.9) * scale));
      const data = ctx.getImageData(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)).data;
      let blue = 0;
      for (let i = 0; i < data.length; i += 4) {
        const rr = data[i], gg = data[i + 1], bb = data[i + 2], aa = data[i + 3];
        if (aa > 120 && bb > 150 && bb - rr > 55 && bb - gg > 40) blue += 1;
      }
      return { blue, facing, cx: +cx.toFixed(2), cy: +cy.toFixed(2), r: +r.toFixed(2), scale: +scale.toFixed(2) };
    })()`);

    const t0 = await diag();
    if (!t0.girl?.clock) {
      throw new Error(`[ENV] 诊断里没有 girl.clock（拿到 ${JSON.stringify(t0.girl?.clock ?? null)}）：旧构建，不是产品红`);
    }
    results.v119.diag = { clock: t0.girl.clock, checkInMs: t0.girl.clockCheckInMs };
    const quietNow = await evaluate(s, `window.__cyrene.renderer.quiet === true`);
    check("v119.diag", typeof t0.girl.clockCheckInMs === "number"
      && t0.girl.clockCheckInMs >= 0 && t0.girl.clockCheckInMs <= 30_000,
      `clock=${JSON.stringify(t0.girl.clock)} checkInMs=${t0.girl.clockCheckInMs}`);
    check("v119.not-quiet", quietNow === false, `renderer.quiet=${quietNow}`);
    await awakeForPlay("v119");

    // 挑三个「当天和次日都不是节日」的日子：黄昏 / 平常日 / 睡觉日各占一个。
    const dayStart = (offset) => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() + offset);
      return d;
    };
    const atHour = (day, h, m) => {
      const d = new Date(day.getTime());
      d.setHours(h, m, 0, 0);
      return d.getTime();
    };
    const goodDays = [];
    for (let i = 1; i <= 60 && goodDays.length < 3; i += 1) {
      const day = dayStart(i);
      const next = dayStart(i + 1);
      if (festivalOnOf(day.getTime()) === null && festivalOnOf(next.getTime()) === null) {
        goodDays.push({ offset: i, day });
      }
    }
    if (goodDays.length < 3) throw new Error("[ENV] 60 天里凑不出三个「当天和次日都不是节日」的日子：节日表坏了");
    const duskAt = atHour(goodDays[0].day, 18, 20);
    const plainAt = atHour(goodDays[1].day, 10, 0);
    const sleepAt = atHour(goodDays[2].day, 23, 35);
    const sleepLaterAt = atHour(goodDays[2].day, 23, 41);
    const wakeAt = atHour(dayStart(goodDays[2].offset + 1), 5, 0) + 10_000;
    // 圣诞节取「今天之后的下一个 12-25」：今年的已经过去了（含当天）就说明年，保证账本键是新的。
    const todayMid = dayStart(0);
    let xmasYear = todayMid.getFullYear();
    let xmasDay = new Date(xmasYear, 11, 25, 0, 0, 0, 0);
    if (xmasDay.getTime() <= todayMid.getTime()) {
      xmasYear += 1;
      xmasDay = new Date(xmasYear, 11, 25, 0, 0, 0, 0);
    }
    const xmasAt = atHour(xmasDay, 10, 0);
    results.v119.walls = {
      dusk: new Date(duskAt).toISOString(), plain: new Date(plainAt).toISOString(),
      sleep: new Date(sleepAt).toISOString(), sleepLater: new Date(sleepLaterAt).toISOString(),
      wake: new Date(wakeAt).toISOString(), xmas: new Date(xmasAt).toISOString(),
    };

    // T1 黄昏：角落亮起落日记号，报时那张嘴按源码模板对句子。
    await dismissBubble();
    await setWall(duskAt);
    await settle(2);
    const duskClock = (await diag()).girl.clock;
    const duskMark = await cornerCount();
    results.v119.dusk = { clock: duskClock, mark: duskMark };
    check("v119.phase.dusk", duskClock?.phase === "dusk", `phase=${duskClock?.phase}`);
    check("v119.sky.sunset", duskClock?.sky?.kind === "sunset", `sky=${JSON.stringify(duskClock?.sky ?? null)}`);
    check("v119.sky.fresh", duskClock?.sky?.watched === false
      && duskClock?.skies?.sunrise === 0 && duskClock?.skies?.sunset === 0 && duskClock?.skies?.moon === 0,
      `sky=${JSON.stringify(duskClock?.sky ?? null)} skies=${JSON.stringify(duskClock?.skies ?? null)}`);
    check("v119.festival.none", duskClock?.festival === null && duskClock?.autoSleep === false,
      `festival=${JSON.stringify(duskClock?.festival ?? null)} autoSleep=${duskClock?.autoSleep}`);
    check("v119.sky.mark", duskMark.rose >= 12, `corner=${JSON.stringify(duskMark)}`);
    await shot("girl-day-sunset-mark.png");

    const nextDusk = nextFestivalOf(duskAt);
    await dismissBubble();
    await evaluate(s, `window.__cyrene.renderer.handleCommand("clock")`);
    await wait(260);
    const clockSnap = await snap();
    const clockWant = fillReport(REPORT_TPL.clock, {
      "clockLine(wall)": clockLineOf(duskAt),
      "next.def.label": nextDusk.def.label,
      "next.days": nextDusk.days,
    });
    results.v119.clockMouth = { got: clockSnap?.bubble?.text ?? null, want: clockWant };
    check("v119.clock.mouth", clockSnap?.bubble?.text === clockWant,
      `got=${JSON.stringify(clockSnap?.bubble?.text ?? null)} want=${JSON.stringify(clockWant)}`);

    // T2 平常日：节日那张嘴报倒计时。
    await dismissBubble();
    await evaluate(s, `window.__cyrene.renderer.handleCommand("festival")`);
    await wait(260);
    const plainSnap = await snap();
    const plainWant = fillReport(REPORT_TPL.plain, {
      "next.def.label": nextDusk.def.label,
      "next.days": nextDusk.days,
    });
    results.v119.festivalPlain = { got: plainSnap?.bubble?.text ?? null, want: plainWant };
    check("v119.festival.plain", plainSnap?.bubble?.text === plainWant,
      `got=${JSON.stringify(plainSnap?.bubble?.text ?? null)} want=${JSON.stringify(plainWant)}`);

    // T3 一起看天：点窗角那一枚 → 账本 +1、watched 翻真、回执就是天色那句、记号收掉。
    // 重复点不会多记账（同一天同一场只看一次），所以躲猫猫之类抢掉的一手可以补点。
    await dismissBubble();
    await settle(1);
    const zoomAtTap = (await diag()).layout.zoom;
    let watchClock = null;
    for (let i = 0; i < 3; i += 1) {
      await tapAt(SKY_MARK.x * zoomAtTap, SKY_MARK.y * zoomAtTap);
      await wait(260);
      watchClock = (await diag()).girl.clock;
      if (watchClock?.skies?.sunset === 1) break;
    }
    const watchSnap = await snap();
    const markWatched = await cornerCount();
    const bondWatched = await bondNow();
    results.v119.watch = {
      clock: watchClock, bubble: watchSnap?.bubble?.text ?? null, mark: markWatched,
      disk: bondWatched?.skies ?? null, skyKey: bondWatched?.skyKey ?? null,
    };
    check("v119.watch.count", watchClock?.skies?.sunset === 1,
      `skies=${JSON.stringify(watchClock?.skies ?? null)}`);
    check("v119.watch.flag", watchClock?.sky?.kind === "sunset" && watchClock?.sky?.watched === true,
      `sky=${JSON.stringify(watchClock?.sky ?? null)}`);
    check("v119.watch.line", watchSnap?.bubble?.text === SKY_LINES.sunset,
      `got=${JSON.stringify(watchSnap?.bubble?.text ?? null)} want=${JSON.stringify(SKY_LINES.sunset)}`);
    check("v119.watch.mark-off", markWatched.rose <= 2, `corner=${JSON.stringify(markWatched)}`);
    check("v119.watch.disk", bondWatched?.skies?.sunset === 1,
      `disk=${JSON.stringify(bondWatched?.skies ?? null)}`);
    await shot("girl-day-sunset-watched.png");

    // T4 圣诞节：同一块头侧区域做像素 A/B（平常日 vs 圣诞），账本 +1、徽章 festive-day、报节日。
    await dismissBubble();
    await setWall(plainAt);
    await settle(2);
    const plainClock = (await diag()).girl.clock;
    const headA = await headBlue();
    await setWall(xmasAt);
    await settle(2);
    const xmasClock = (await diag()).girl.clock;
    const headB = await headBlue();
    await shot("girl-day-christmas.png");
    const xmas = FESTIVALS.find((f) => f.id === "christmas");
    results.v119.xmas = { plain: plainClock?.festival ?? null, xmas: xmasClock?.festival ?? null, headA, headB };
    check("v119.ornament.diag", !!xmas && (plainClock?.festival ?? null) === null
      && xmasClock?.festival?.id === "christmas"
      && xmasClock?.festival?.label === xmas.label
      && xmasClock?.festival?.ornament === xmas.ornament,
      `plain=${JSON.stringify(plainClock?.festival ?? null)} xmas=${JSON.stringify(xmasClock?.festival ?? null)}`);
    check("v119.ornament.pixels", headB.blue >= headA.blue + 8 && headB.blue >= 8,
      `A=${headA.blue} B=${headB.blue} A@(${headA.cx},${headA.cy}) facing=${headA.facing} `
      + `B@(${headB.cx},${headB.cy}) facing=${headB.facing}`);

    const festivalsBase = t0.girl.clock.festivals;
    const ledgerDeadline = Date.now() + 40_000;
    let xmasLedger = null;
    while (Date.now() < ledgerDeadline) {
      await forceFrame();
      const n = await snap();
      xmasLedger = n?.clock ?? null;
      if (xmasLedger?.festivals === festivalsBase + 1) break;
      await wait(180);
    }
    const bondXmas = await bondNow();
    results.v119.festivalLedger = { base: festivalsBase, clock: xmasLedger, disk: bondXmas?.festival ?? null };
    check("v119.festival.ledger", xmasLedger?.festivals === festivalsBase + 1,
      `base=${festivalsBase} now=${xmasLedger?.festivals}`);
    check("v119.festival.disk", bondXmas?.festival?.count === festivalsBase + 1,
      `disk=${JSON.stringify(bondXmas?.festival ?? null)} base=${festivalsBase}`);

    // 徽章一次只弹一枚：走产品自己的判定函数把之前的欠账排空（festivalTick 用的同一条路）。
    let festive = ((await diag()).girl.achievements ?? []).includes("festive-day");
    let drained = 0;
    while (!festive && drained < 24) {
      const step = await evaluate(s, `(() => {
        const engine = window.__cyrene.renderer?.engine;
        if (!engine || typeof engine.refreshAchievements !== "function") return "no-engine";
        engine.refreshAchievements(performance.now());
        return "ok";
      })()`);
      if (step !== "ok") throw new Error("[ENV] refreshAchievements 不可达：" + step);
      await forceFrame();
      await wait(110);
      drained += 1;
      festive = ((await diag()).girl.achievements ?? []).includes("festive-day");
    }
    results.v119.achievement = { drained, festive, achievements: (await diag()).girl.achievements };
    check("v119.festival.achievement", festive,
      `drained=${drained} achievements=${JSON.stringify((await diag()).girl.achievements)}`);

    await dismissBubble();
    await evaluate(s, `window.__cyrene.renderer.handleCommand("festival")`);
    await wait(260);
    const todaySnap = await snap();
    const todayWant = fillReport(REPORT_TPL.today, { "today.label": xmas.label, "today.line": xmas.line });
    results.v119.festivalToday = { got: todaySnap?.bubble?.text ?? null, want: todayWant };
    check("v119.festival.today", todaySnap?.bubble?.text === todayWant,
      `got=${JSON.stringify(todaySnap?.bubble?.text ?? null)} want=${JSON.stringify(todayWant)}`);

    // T5 自己睡 / 自己醒：先把「上一次看见你」钉在 23:35（同一次求值里翻两下，不给帧插队），
    // 再拨到 23:41——三分钟没人理，下一次时辰拍就该自己钻进被窝。
    try {
      await awakeForPlay("v119-night");
      await dismissBubble();
      await evaluate(s, `(() => {
        if (typeof window.__realDateNowV119 !== "function") window.__realDateNowV119 = Date.now;
        Date.now = () => ${Math.round(sleepAt)};
        const r = window.__cyrene.renderer;
        r.setUserActive(true);
        r.setUserActive(false);
        return true;
      })()`);
      await settle(2);
      const nightClock = (await diag()).girl.clock;
      const nightMark = await cornerCount();
      results.v119.night = { clock: nightClock, mark: nightMark };
      check("v119.night.moon", nightClock?.phase === "night" && nightClock?.sky?.kind === "moon"
        && nightClock?.sky?.watched === false,
        `phase=${nightClock?.phase} sky=${JSON.stringify(nightClock?.sky ?? null)}`);
      check("v119.night.mark", nightMark.blue >= 8, `corner=${JSON.stringify(nightMark)}`);
      await shot("girl-day-night.png");

      await setWall(sleepLaterAt);
      const sleepDeadline = Date.now() + 40_000;
      let slept = null;
      while (Date.now() < sleepDeadline) {
        await forceFrame();
        const n = await snap();
        slept = { autoSleep: n?.clock?.autoSleep ?? null, activity: n?.activity ?? null };
        if (slept.autoSleep === true && slept.activity === "sleep") break;
        await wait(180);
      }
      const asleepMark = await cornerCount();
      results.v119.autoSleep = { observed: slept, mark: asleepMark };
      check("v119.autosleep", slept?.autoSleep === true && slept?.activity === "sleep",
        `observed=${JSON.stringify(slept)}`);
      check("v119.autosleep.mark-off", asleepMark.blue < 3 && asleepMark.rose < 3,
        `corner=${JSON.stringify(asleepMark)}`);
      await shot("girl-day-autosleep.png");

      await setWall(wakeAt);
      const wakeDeadline = Date.now() + 40_000;
      let woke = null;
      while (Date.now() < wakeDeadline) {
        await forceFrame();
        const n = await snap();
        woke = { autoSleep: n?.clock?.autoSleep ?? null, activity: n?.activity ?? null };
        if (woke.autoSleep === false && woke.activity !== "sleep") break;
        await wait(180);
      }
      await settle(2);
      const dawnClock = (await diag()).girl.clock;
      const dawnMark = await cornerCount();
      results.v119.autoWake = { observed: woke, clock: dawnClock, mark: dawnMark };
      check("v119.autowake", woke?.autoSleep === false && woke?.activity !== "sleep",
        `observed=${JSON.stringify(woke)}`);
      check("v119.autowake.mark", dawnClock?.sky?.kind === "sunrise" && dawnMark.rose >= 10,
        `sky=${JSON.stringify(dawnClock?.sky ?? null)} corner=${JSON.stringify(dawnMark)}`);
      check("v119.sky.no-watch", dawnClock?.skies?.sunrise === 0 && dawnClock?.sky?.watched === false,
        `skies=${JSON.stringify(dawnClock?.skies ?? null)} sky=${JSON.stringify(dawnClock?.sky ?? null)}`);
      await shot("girl-day-dawn.png");
    } finally {
      // 拨过的表必须还回去：后面就算有检查红了，也不能把伪时间留给下一次读盘。
      await restoreWall();
    }
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
