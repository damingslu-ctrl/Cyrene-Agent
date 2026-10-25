import { INK_SOFT, PAPER, ROSE, ROSE_DEEP, SHADOW, withAlpha } from "../../shared/pet-tokens";
import type { DrawOp, Point2 } from "./ops";

/**
 * 毛线球：猫娘脚边的一件小玩具。
 *
 * 物理在**绘制空间**里跑（82×108 的基址坐标），不碰屏幕坐标、不碰窗口几何——
 * 球只在她的窗子里滚，窗户怎么搬是引擎的事。地面 = 她脚线 `cat.center.y`，
 * 所以「球落地」与「她落地」是同一条线。
 *
 * 步进用固定 8ms 子步：踢出去的初速最高 520px/s，按 4fps 的大 dt 一步算会
 * 直接穿过墙。子步数按 dt 封顶在 10 步（80ms），挂起回来不会补出一整段弹道。
 */
export const TOY = {
  radius: 4.5,
  gravity: 760,
  floorRestitution: 0.42,
  wallRestitution: 0.55,
  rollFriction: 2.2,
  airDrag: 0.35,
  /** 落地的弹跳下限：低于它不再弹，直接贴地。 */
  bounceFloor: 42,
  /** 慢到这个速度就躺下，免得在 0.1px 抖动里永远「在动」。 */
  restSpeed: 9,
  kickPower: 260,
  maxSpeed: 560,
  trailMax: 7,
  /** 每步上限 50ms：rAF 在后台被节流后，回来是补一拍不是补十拍。 */
  maxDt: 0.05,
} as const;

export interface ToyBounds {
  /** 左/右边界（绘制 px，球心可到的范围由 stepToy 再收一个半径）。 */
  left: number;
  right: number;
  /** 地面线（脚线）。 */
  floorY: number;
}

export interface ToyState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 滚动相位（弧度）；毛线的纹路按它转，球才像在滚而不是在滑。 */
  spin: number;
  /** 完全静止（物理不跑，渲染照画）。 */
  rest: boolean;
  trail: Point2[];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function createToy(x: number, floorY: number): ToyState {
  return {
    x,
    y: floorY - TOY.radius,
    vx: 0,
    vy: 0,
    spin: 0,
    rest: true,
    trail: [],
  };
}

/**
 * 踢/推：沿水平方向给初速，并带一点上抛。
 * `dir` 只取符号——点球的哪一边决定往哪边飞，力度与点的位置无关，
 * 这样在 82px 的窗子里永远踢得出可见的一段，不会「点中心不动」。
 */
export function kickToy(state: ToyState, dir: number, power: number = TOY.kickPower): ToyState {
  const sign = dir < 0 ? -1 : 1;
  const speed = clamp(power, 0, TOY.maxSpeed);
  state.vx = sign * speed;
  state.vy = -speed * 0.45;
  state.rest = false;
  state.trail = [];
  return state;
}

/** 点中球没有：slop 是给 74px 小窗的手指容差。 */
export function toyAt(state: ToyState, x: number, y: number, slop = 2.4): boolean {
  return Math.hypot(x - state.x, y - state.y) <= TOY.radius + slop;
}

function pushTrail(state: ToyState): void {
  const speed = Math.hypot(state.vx, state.vy);
  if (speed < 70) return;
  const last = state.trail[state.trail.length - 1];
  if (last && Math.hypot(last[0] - state.x, last[1] - state.y) < 1.2) return;
  state.trail.push([state.x, state.y]);
  if (state.trail.length > TOY.trailMax) state.trail.shift();
}

/** 一步物理。原地改 `state`（渲染器持有一个实例），返回它方便测试链式断言。 */
export function stepToy(state: ToyState, dt: number, bounds: ToyBounds): ToyState {
  if (state.rest) return state;
  const seconds = Number.isFinite(dt) ? clamp(dt, 0, TOY.maxDt) : 0;
  if (seconds <= 0) return state;

  const minX = bounds.left + TOY.radius;
  const maxX = bounds.right - TOY.radius;
  const floorCenter = bounds.floorY - TOY.radius;
  const steps = Math.max(1, Math.ceil(seconds / 0.008));
  const h = seconds / steps;
  let onFloor = false;

  for (let i = 0; i < steps; i += 1) {
    state.vy += TOY.gravity * h;
    state.x += state.vx * h;
    state.y += state.vy * h;

    if (state.x < minX) {
      state.x = minX;
      state.vx = Math.abs(state.vx) * TOY.wallRestitution;
    } else if (state.x > maxX) {
      state.x = maxX;
      state.vx = -Math.abs(state.vx) * TOY.wallRestitution;
    }

    if (state.y >= floorCenter) {
      state.y = floorCenter;
      onFloor = true;
      if (Math.abs(state.vy) > TOY.bounceFloor) {
        state.vy = -Math.abs(state.vy) * TOY.floorRestitution;
      } else {
        state.vy = 0;
        state.vx *= Math.exp(-TOY.rollFriction * h);
      }
    } else {
      onFloor = false;
      state.vx *= Math.exp(-TOY.airDrag * h);
    }

    state.spin += (state.vx * h) / Math.max(1, TOY.radius * 0.75);
  }

  if (onFloor && Math.abs(state.vx) < TOY.restSpeed && Math.abs(state.vy) < TOY.restSpeed) {
    state.vx = 0;
    state.vy = 0;
    state.x = clamp(state.x, minX, maxX);
    state.y = floorCenter;
    state.rest = true;
    state.trail = [];
    return state;
  }
  pushTrail(state);
  return state;
}

export interface ToyArtInput {
  state: ToyState;
  /** 地面线（屏幕/绘制空间的脚线）。 */
  floorY: number;
}

export interface ToyOps {
  below: DrawOp[];
  above: DrawOp[];
}

/** 球离地越高，影子越小越淡。 */
function liftOf(state: ToyState, floorY: number): number {
  const restY = floorY - TOY.radius;
  return clamp((restY - state.y) / 18, 0, 1);
}

/**
 * 毛线球的两层画法：
 * - `below`：地面投影（与猫同一套多环伪高斯，球虽小也要「落地」）；
 * - `above`：拖尾 → 线头 → 球体 → 三道毛线 → 高光。
 * 球体本身用玫瑰底 + 奶油光边 + 深玫瑰纹路：它在桌布与猫身之间都要读得出来，
 * 所以不依赖「背景一定是浅色」。
 */
export function buildToyOps(input: ToyArtInput): ToyOps {
  const { state, floorY } = input;
  const r = TOY.radius;
  const lift = liftOf(state, floorY);
  const below: DrawOp[] = [];
  const above: DrawOp[] = [];

  const shadowShrink = 1 - 0.32 * lift;
  const shadowFade = 1 - 0.45 * lift;
  below.push({
    kind: "fillEllipse", fill: withAlpha(PAPER, 0.04 * shadowFade),
    cx: state.x, cy: floorY + 0.5, rx: r * 1.7 * shadowShrink, ry: r * 0.7 * shadowShrink,
    layer: "ground_shadow",
  });
  for (const [f, a] of [[1, 0.05], [0.72, 0.06], [0.46, 0.07]] as const) {
    below.push({
      kind: "fillEllipse", fill: withAlpha(SHADOW, a * shadowFade),
      cx: state.x, cy: floorY + 0.4,
      rx: r * 1.25 * f * shadowShrink, ry: r * 0.46 * f * shadowShrink,
      layer: "ground_shadow",
    });
  }

  state.trail.forEach(([tx, ty], i) => {
    const age = (i + 1) / state.trail.length;
    const rr = r * (0.28 + 0.34 * age);
    above.push({
      kind: "fillEllipse", fill: withAlpha(PAPER, 0.20 * age),
      cx: tx, cy: ty, rx: rr * 1.5, ry: rr * 1.2, layer: "stars",
    });
    above.push({
      kind: "fillEllipse", fill: withAlpha(ROSE_DEEP, 0.20 * age),
      cx: tx, cy: ty, rx: rr, ry: rr * 0.85, layer: "stars",
    });
  });

  // 线头：从球底拖到地面的一小截。静止时是它「停下来了」的视觉证据；
  // 滚动时随 spin 摆动，像被球带着走。先画线、后画球，球会压住起点。
  const tailY = floorY - 0.2;
  const tailSway = state.rest ? 0 : Math.sin(state.spin * 2) * 1.6;
  const tail: Point2[] = [
    [state.x - r * 0.25, state.y + r * 0.7],
    [state.x - r * 0.9, state.y + r * 1.1],
    [state.x - r * 1.6 + tailSway, tailY - 0.6],
    [state.x - r * 2.2 - tailSway * 0.5, tailY],
  ];
  above.push({ kind: "strokePath", stroke: withAlpha(PAPER, 0.92), width: 1.9, points: tail, layer: "stars" });
  above.push({ kind: "strokePath", stroke: withAlpha(ROSE_DEEP, 0.9), width: 0.9, points: tail, layer: "stars" });

  // 奶油光边：桌布/猫身两种底色下都把球从背景里剥出来。
  above.push({
    kind: "fillEllipse", fill: withAlpha(PAPER, 0.95),
    cx: state.x, cy: state.y, rx: r + 0.95, ry: r + 0.95, layer: "stars",
  });
  above.push({
    kind: "fillEllipse", fill: withAlpha(ROSE_DEEP, 0.95),
    cx: state.x, cy: state.y + r * 0.18, rx: r * 0.98, ry: r * 0.9, layer: "stars",
  });
  above.push({
    kind: "fillEllipse", fill: withAlpha(ROSE, 0.98),
    cx: state.x, cy: state.y - r * 0.06, rx: r * 0.9, ry: r * 0.84, layer: "stars",
  });

  // 三道毛线：绕球心按 spin 旋转的正弦弧。奶油底 + 深玫瑰芯，小尺寸也读得出缠绕感。
  const strandCount = 3;
  for (let k = 0; k < strandCount; k += 1) {
    const ang = state.spin + (k * Math.PI) / strandCount;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const pts: Point2[] = [];
    for (let i = 0; i <= 6; i += 1) {
      const u = -0.82 + (1.64 * i) / 6;
      const v = Math.sin(u * Math.PI) * 0.22;
      const lx = u * r;
      const ly = v * r;
      pts.push([state.x + lx * ca - ly * sa, state.y + lx * sa + ly * ca]);
    }
    above.push({ kind: "strokePath", stroke: withAlpha(PAPER, 0.82), width: 1.35, points: pts, layer: "stars" });
    above.push({ kind: "strokePath", stroke: withAlpha(ROSE_DEEP, 0.75), width: 0.55, points: pts, layer: "stars" });
  }

  above.push({
    kind: "fillEllipse", fill: withAlpha(PAPER, 0.55),
    cx: state.x - r * 0.34, cy: state.y - r * 0.38, rx: r * 0.26, ry: r * 0.18, layer: "stars",
  });
  above.push({
    kind: "fillEllipse", fill: withAlpha(INK_SOFT, 0.18),
    cx: state.x + r * 0.3, cy: state.y + r * 0.5, rx: r * 0.4, ry: r * 0.18, layer: "stars",
  });

  return { below, above };
}
