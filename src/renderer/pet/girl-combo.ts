/**
 * 节目单连招：她把一串真手势按台本连着演完（招手→剪刀手→歪头→洗脸→鞠躬→谢幕），
 * 每一步的**最后 400ms** 是拍点，用户在拍点上点她一下就算跟上；早拍只算催。
 *
 * 台本的手势 id 全部从 `girl-gesture` 的举牌表读 `holdMs`，不写第二份时长——
 * 图集改了时长，节目单自己会跟着变；表里没有的姿态进不了台本（单测钉死）。
 */
import { ACCENT, INK, PAPER, ROSE, ROSE_DEEP, withAlpha } from "../../shared/pet-tokens";
import { type GirlGesturePose, gesturePoseFor } from "./girl-gesture";
import type { DrawOp } from "./ops";

export interface ComboStep {
  gesture: string;
  holdMs: number;
  label: string;
  pose: GirlGesturePose;
}

export const COMBO_FINAL_MS = 1_200;
/** 每一步最后这么久是拍点。 */
export const COMBO_BEAT_MS = 400;

const RUNDOWN: ReadonlyArray<{ id: string; label: string }> = [
  { id: "wave", label: "招手" },
  { id: "point", label: "剪刀手" },
  { id: "tilt", label: "歪头" },
  { id: "groom", label: "洗脸" },
  { id: "bow", label: "鞠躬" },
];

/** 台本里没画到位的姿态一律不进单：宁可少一步，也不演一段不像的舞。 */
function buildRundown(): ComboStep[] {
  const steps: ComboStep[] = [];
  for (const row of RUNDOWN) {
    const pose = gesturePoseFor(row.id);
    if (!pose) continue;
    steps.push({ gesture: row.id, holdMs: pose.holdMs, label: row.label, pose });
  }
  return steps;
}

export const COMBO_STEPS: readonly ComboStep[] = buildRundown();
export const COMBO_SHOW_MS = COMBO_STEPS.reduce((sum, step) => sum + step.holdMs, 0);
export const COMBO_MS = COMBO_SHOW_MS + COMBO_FINAL_MS;
/** 谢幕那一步借「行礼」的画。 */
export const COMBO_FINAL_POSE: GirlGesturePose | null = gesturePoseFor("curtsy");

export interface ComboState {
  bornAt: number;
  seed: number;
  claps: number;
  streak: number;
  best: number;
  /** 已经拍过的段号（一段只许一次）。 */
  applauded: number[];
  lastClapStep: number;
}

export type ComboClap = "clap" | "early" | "miss";

export interface ComboSegment {
  /** 段号；等于 `COMBO_STEPS.length` 时是谢幕。 */
  index: number;
  step: ComboStep;
  /** 本段已经走了多久。 */
  localAge: number;
  /** 本段进度 0..1。 */
  progress: number;
}

export function createCombo(now: number, seed = Math.random()): ComboState {
  return { bornAt: now, seed, claps: 0, streak: 0, best: 0, applauded: [], lastClapStep: -1 };
}

export function comboAge(state: ComboState, now: number): number {
  // 帧起点可能早于出生那一拍：夹到 0 当「刚出生」，别判死。
  return Math.max(0, now - state.bornAt);
}

export function comboAlive(state: ComboState, now: number): boolean {
  return comboAge(state, now) < COMBO_MS;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function comboStepAt(state: ComboState, now: number): ComboSegment | null {
  const age = comboAge(state, now);
  if (age >= COMBO_MS) return null;
  let acc = 0;
  for (let i = 0; i < COMBO_STEPS.length; i += 1) {
    const step = COMBO_STEPS[i];
    if (age < acc + step.holdMs) {
      const localAge = age - acc;
      return { index: i, step, localAge, progress: localAge / step.holdMs };
    }
    acc += step.holdMs;
  }
  const localAge = age - COMBO_SHOW_MS;
  const finalStep: ComboStep = {
    gesture: "curtsy",
    holdMs: COMBO_FINAL_MS,
    label: "谢幕",
    pose: COMBO_FINAL_POSE ?? { pose: "bow", holdMs: COMBO_FINAL_MS },
  };
  return { index: COMBO_STEPS.length, step: finalStep, localAge, progress: localAge / COMBO_FINAL_MS };
}

/** 整台节目的进度（0..1，单调）。 */
export function comboProgress(state: ComboState, now: number): number {
  return clamp(comboAge(state, now) / COMBO_MS, 0, 1);
}

/**
 * 拍一下：拍点内记一次并接连击；一段没拍到，下一段的连击从头数。
 * 「early」不算跟上也不清空——用户催她，不是她出错。
 */
export function comboApplaud(state: ComboState, now: number): ComboClap {
  const seg = comboStepAt(state, now);
  if (!seg) return "miss";
  const onBeat = seg.index >= COMBO_STEPS.length
    || seg.localAge >= seg.step.holdMs - COMBO_BEAT_MS;
  if (!onBeat) return "early";
  if (state.applauded.includes(seg.index)) return "miss";
  state.applauded.push(seg.index);
  state.claps += 1;
  state.streak = seg.index === state.lastClapStep + 1 ? state.streak + 1 : 1;
  state.lastClapStep = seg.index;
  state.best = Math.max(state.best, state.streak);
  return "clap";
}

function starPoints(cx: number, cy: number, r: number): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  for (let i = 0; i < 8; i += 1) {
    const ang = -Math.PI / 2 + (i * Math.PI) / 4;
    const rad = i % 2 === 0 ? r : r * 0.36;
    points.push([cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad]);
  }
  return points;
}

export function buildComboOps(
  state: ComboState,
  now: number,
  face: { cx: number; top: number; w: number },
  floorY: number,
): DrawOp[] {
  if (!comboAlive(state, now)) return [];
  const age = comboAge(state, now);
  const seg = comboStepAt(state, now);
  if (!seg) return [];
  const alpha = Math.min(1, 0.42 + age / 300) * clamp((COMBO_MS - age) / 620, 0, 1);
  const ops: DrawOp[] = [];
  const chipW = 8;
  const chipH = 5;
  const gap = 3;
  const total = COMBO_STEPS.length * chipW + (COMBO_STEPS.length - 1) * gap;
  const x0 = clamp(face.cx - total / 2, 2, Math.max(2, 82 - total - 2));
  const y = Math.max(2, face.top - 11);
  // 台前一行节目牌：演完填实，正在演的高亮并把牌子抬起来。
  for (let i = 0; i < COMBO_STEPS.length; i += 1) {
    const done = i < seg.index;
    const current = i === seg.index;
    const tone = done ? ROSE : current ? ACCENT : PAPER;
    const lift = current ? Math.sin(seg.progress * Math.PI) * 1.6 : 0;
    const cx = x0 + i * (chipW + gap);
    if (done) ops.push({ kind: "fillRoundRect", fill: withAlpha(tone, 0.72 * alpha), x: cx, y: y - lift, w: chipW, h: chipH, r: 1.8 });
    ops.push({
      kind: "strokeRoundRect",
      stroke: withAlpha(done ? INK : tone, (done ? 0.6 : current ? 0.92 : 0.5) * alpha),
      width: current ? 1.2 : 0.8,
      x: cx,
      y: y - lift,
      w: chipW,
      h: chipH,
      r: 1.8,
    });
    if (current) {
      // 拍点提示：最后 400ms 牌下一颗心跳点，手指知道该拍了。
      if (seg.localAge >= seg.step.holdMs - COMBO_BEAT_MS) {
        const beat = (seg.localAge - (seg.step.holdMs - COMBO_BEAT_MS)) / COMBO_BEAT_MS;
        ops.push({
          kind: "fillEllipse",
          fill: withAlpha(PAPER, (0.95 - beat * 0.4) * alpha),
          cx: cx + chipW / 2,
          cy: y + chipH + 2.6,
          rx: 1.6 - beat * 0.6,
          ry: 1.6 - beat * 0.6,
        });
      }
    }
  }
  // 地面一道台沿：粉笔双色，告诉用户「这是舞台不是地板花」。
  ops.push({ kind: "strokePath", stroke: withAlpha(PAPER, 0.5 * alpha), width: 1, points: [[face.cx - face.w * 0.5, floorY + 3], [face.cx + face.w * 0.5, floorY + 3]] });
  ops.push({ kind: "strokePath", stroke: withAlpha(ROSE_DEEP, 0.38 * alpha), width: 0.6, points: [[face.cx - face.w * 0.5, floorY + 4.4], [face.cx + face.w * 0.5, floorY + 4.4]] });

  // 谢幕：彩星炸开 + 掌声记数（每拍一颗，钉在台牌行下面）。
  if (seg.index >= COMBO_STEPS.length) {
    const p = clamp(seg.localAge / COMBO_FINAL_MS, 0, 1);
    for (let i = 0; i < 3; i += 1) {
      const cx = face.cx - 12 + i * 12;
      const cy = y - 6 - p * 9 - (i % 2) * 2.5;
      ops.push({ kind: "fillPath", fill: withAlpha(PAPER, (1 - p) * 0.95 * alpha), points: starPoints(cx, cy, 3.2 - p * 0.8) });
      ops.push({ kind: "fillPath", fill: withAlpha(i === 1 ? ACCENT : ROSE, (1 - p) * 0.9 * alpha), points: starPoints(cx, cy, 1.9 - p * 0.5) });
    }
  }
  for (let i = 0; i < state.claps; i += 1) {
    const cx = x0 + (i % 6) * (chipW + gap) + chipW / 2;
    const cy = y + chipH + 5.5 + Math.floor(i / 6) * 4;
    ops.push({ kind: "fillEllipse", fill: withAlpha(ACCENT, 0.85 * alpha), cx, cy, rx: 1.4, ry: 1.4 });
  }
  return ops;
}
