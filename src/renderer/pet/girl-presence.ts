import type { Point2 } from "./ops";

/**
 * 注视存在感：位图猫娘的脸是画死的（瞳孔不会转），「她注意到你了」只能靠整身说话。
 *
 * 三条量，全部是**绘制空间**像素/角度，渲染器直接叠到 `girlAnimBodyFor` 上：
 * - `leanDeg`：朝光标方向压 0..4.2°——从「站着」变成「朝你偏过来」；
 * - `shiftX`：整身朝光标挪 0..2.2px——比倾斜更钝，但两只脚像在挪重心；
 * - `facing`：光标在她另一侧并**停留** 380ms 才翻身，翻完锁 900ms；
 *   跨过中线的一瞬间就翻会像抽搐，这是迟滞存在的理由。
 *
 * `attention/proximity` 是给记号层和文案层用的强度（0..1），不做动画；
 * `notice` 是边沿事件（「！」和一句「嗯？」），只在**从远到近**跨过 0.86 时发一次，
 * 冷却 12s，睡着时不发。
 *
 * 时钟口径与整个渲染器一致：绝对毫秒由调用方注入，暂停/降帧不会让存在感自己走。
 */
export const PRESENCE = {
  /** 距离头心的远近（绘制 px）：near 以内算「贴着」，far 以外完全无感。 */
  nearPx: 60,
  farPx: 300,
  /** 转身阈值：光标偏离头心超过这么多绘制 px 才算「在那边」。 */
  turnPx: 10,
  /** 偏过去要停这么久才真翻（防跨中线抽搐）。 */
  turnHoldMs: 380,
  /** 翻完锁这么久，期间不再翻。 */
  turnLockMs: 900,
  /** 靠近到这个注意力才「！」。 */
  noticeAt: 0.86,
  noticeCooldownMs: 12_000,
  /** 缓动时间常数：240ms 左右，比气泡淡入慢一点，像注意过去而不是弹过去。 */
  easeMs: 240,
  leanMaxDeg: 4.2,
  shiftMaxPx: 2.2,
  /** 倾斜/侧移的饱和距离（绘制 px）：再远也不会更偏。 */
  leanFullPx: 130,
  shiftFullPx: 180,
  /** 单帧 dt 上限：拖窗/挂起回来不该一口气补完。 */
  maxDtMs: 90,
} as const;

export interface GirlPresenceInput {
  now: number;
  /** 光标（绘制空间）；null＝这一拍没有目标（离窗太远/拖拽中）。 */
  gaze: Point2 | null;
  /** 头心（绘制空间）：由图集逐帧脸框算出来，随动作一起动。 */
  head: Point2;
  /** 行为引擎的朝向：不打转向时她保持这个朝向。 */
  facing: 1 | -1;
  /** 站立/坐着才允许转身；走路/拖拽/被投掷时身体方向归物理。 */
  allowTurn: boolean;
  /** 睡着/免打扰时不「！」（闭着眼注意到你不成立）。 */
  awake: boolean;
}

export interface GirlPresencePose {
  attention: number;
  proximity: number;
  leanDeg: number;
  shiftX: number;
  facing: 1 | -1;
}

export interface GirlPresenceUpdate {
  pose: GirlPresencePose;
  /** 这一拍刚跨过注意阈值（边沿，不是状态）。 */
  notice: boolean;
}

const REST: GirlPresencePose = {
  attention: 0,
  proximity: 0,
  leanDeg: 0,
  shiftX: 0,
  facing: 1,
};

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** 0..1 的指数缓动系数；dt 由调用方给，测试可以逐拍喂固定值。 */
function easeK(dtMs: number): number {
  return 1 - Math.exp(-Math.max(0, Math.min(PRESENCE.maxDtMs, dtMs)) / PRESENCE.easeMs);
}

export class GirlPresence {
  private pose: GirlPresencePose = { ...REST };
  private lastAt: number | null = null;
  private lastNoticeAt = -Infinity;
  /** 当前这一侧已经「看」了多久；转身后清零。 */
  private sideSince: number | null = null;
  private lockedUntil = 0;
  private noticedRecently = false;
  /** 上一拍是否在注意圈内：notice 只认「圈外 → 圈内」的边沿。 */
  private inside = false;

  reset(facing: 1 | -1 = 1): void {
    this.pose = { ...REST, facing };
    this.lastAt = null;
    this.lastNoticeAt = -Infinity;
    this.sideSince = null;
    this.lockedUntil = 0;
    this.noticedRecently = false;
    this.inside = false;
  }

  get current(): GirlPresencePose {
    return { ...this.pose };
  }

  update(input: GirlPresenceInput): GirlPresenceUpdate {
    const dt = this.lastAt === null ? 0 : Math.max(0, input.now - this.lastAt);
    this.lastAt = input.now;
    const k = easeK(dt);

    let targetLean = 0;
    let targetShift = 0;
    let targetAttention = 0;
    let targetProximity = 0;
    let notice = false;

    if (input.gaze) {
      const dx = input.gaze[0] - input.head[0];
      const dy = input.gaze[1] - input.head[1];
      const dist = Math.hypot(dx, dy);
      targetProximity = 1 - smoothstep(PRESENCE.nearPx, PRESENCE.farPx, dist);
      targetAttention = targetProximity;
      // 倾斜/侧移是「注意」不是「指南针」：光标在 300px 外时不再越远越歪，
      // 只在 far..far+120 这段淡出（与 main.ts 的 420px 取舍同一段语义）。
      const engage = 1 - smoothstep(PRESENCE.farPx, PRESENCE.farPx + 120, dist);

      const insideNow = targetAttention >= PRESENCE.noticeAt;
      if (insideNow && !this.inside && input.awake && input.now - this.lastNoticeAt >= PRESENCE.noticeCooldownMs) {
        notice = true;
        this.lastNoticeAt = input.now;
        this.noticedRecently = true;
      }
      if (!insideNow) this.noticedRecently = false;
      this.inside = insideNow;

      if (input.allowTurn) {
        targetLean = Math.max(-1, Math.min(1, dx / PRESENCE.leanFullPx)) * PRESENCE.leanMaxDeg * engage;
        targetShift = Math.max(-1, Math.min(1, dx / PRESENCE.shiftFullPx)) * PRESENCE.shiftMaxPx * engage;
        this.stepFacing(input, dx);
      } else {
        // 身体在走路/拖拽时方向归物理，但内部朝向要跟上引擎，下一拍站着才不跳。
        this.pose.facing = input.facing;
        this.sideSince = null;
      }
    } else {
      this.inside = false;
      this.noticedRecently = false;
      this.sideSince = null;
      if (!input.allowTurn) this.pose.facing = input.facing;
    }

    this.pose.attention += (targetAttention - this.pose.attention) * k;
    this.pose.proximity += (targetProximity - this.pose.proximity) * k;
    this.pose.leanDeg += (targetLean - this.pose.leanDeg) * k;
    this.pose.shiftX += (targetShift - this.pose.shiftX) * k;
    // 数值收敛到目标后归零，免得 4fps 档一直报 1e-9 的抖动。
    if (Math.abs(this.pose.leanDeg) < 0.02) this.pose.leanDeg = 0;
    if (Math.abs(this.pose.shiftX) < 0.02) this.pose.shiftX = 0;
    return { pose: { ...this.pose }, notice };
  }

  private stepFacing(input: GirlPresenceInput, dx: number): void {
    if (input.now < this.lockedUntil) return;
    const want = (dx >= 0 ? 1 : -1) as 1 | -1;
    if (want === this.pose.facing) {
      this.sideSince = null;
      return;
    }
    if (Math.abs(dx) < PRESENCE.turnPx) {
      this.sideSince = null;
      return;
    }
    if (this.sideSince === null) {
      this.sideSince = input.now;
      return;
    }
    if (input.now - this.sideSince < PRESENCE.turnHoldMs) return;
    this.pose.facing = want;
    this.sideSince = null;
    this.lockedUntil = input.now + PRESENCE.turnLockMs;
  }
}

/** 给渲染器的初值：还没跑过 update 时也要有一个合法朝向。 */
export function restingPresence(facing: 1 | -1 = 1): GirlPresencePose {
  return { ...REST, facing };
}
