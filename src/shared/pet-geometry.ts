/**
 * 猫窗几何的唯一出处。
 *
 * 逐位对应 native `main.rs` 的展开协议（:4241-4306）与绘制中心反推（:4377-4409）。
 * 这些数字不是审美选择：所有屏幕尺都按它们量，改一个数等于作废一批验收器。
 * 单位为 DIP（Electron 逻辑像素），与 native 的 egui 逻辑像素同一坐标系。
 */

export const PET_W = 82.0;
export const PET_H = 108.0;
export const OPEN_W = 248.0;
export const OPEN_H = 482.0;
export const BUB_W = 172.0;
/** 猫内容中心在收起窗口内的位置；窗口绕它长，拖拽与展开都不动它。 */
export const PIN = { x: 41.0, y: 39.0 };
export const EDGE_MARGIN = 4.0;

export interface Point { x: number; y: number }
export interface Size { width: number; height: number }
export interface Rect { x: number; y: number; width: number; height: number }
export interface WorkArea extends Rect {}

export interface PetLayoutInput {
  /** 收起档窗口原点（native 的 `pet_pos`）。 */
  catOrigin: Point;
  /** 面板展开度 0..1。P1 只取 0/1 两档（步进 resize），但函数支持连续值供 P2 动画复用。 */
  e: number;
  /** 气泡展开度 0..1。 */
  be: number;
  growLeft: boolean;
  growUp: boolean;
  workArea: WorkArea;
  /** 贴边藏身的窥视偏移，只进绘制偏移。 */
  peekDx: number;
}

export interface PetLayout {
  size: Size;
  pos: Point;
  anchor: Point;
  /** 夹紧把窗口往里推了多少（未乘 g）。 */
  clampDelta: Point;
  /** 猫内容中心在窗口内的位置（夹紧随 g 生效后）。 */
  pinInWin: Point;
  g: number;
}

export function scaleFor(e: number): { u: number; s: number } {
  const u = 37.0 + (32.0 - 37.0) * e;
  return { u, s: u / 60.0 };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(hi, lo));

export function computePetLayout(input: PetLayoutInput): PetLayout {
  const { catOrigin, e, be, growLeft, growUp, workArea, peekDx } = input;

  const usingPanel = e > 0.001;
  const targetW = usingPanel ? OPEN_W : BUB_W;
  const targetH = usingPanel ? OPEN_H : PET_H;
  const g = usingPanel ? e : be;

  const anchor: Point = usingPanel
    ? {
        x: growLeft ? OPEN_W - PIN.x : PIN.x,
        y: growUp ? OPEN_H - EDGE_MARGIN - 51.5 * (29.0 / 60.0) : PIN.y,
      }
    : { x: growLeft ? BUB_W - PIN.x : PIN.x, y: PIN.y };

  const pinScreen = { x: catOrigin.x + PIN.x, y: catOrigin.y + PIN.y };
  const unclamped = { x: pinScreen.x - anchor.x, y: pinScreen.y - anchor.y };
  const clamped = {
    x: clamp(unclamped.x, workArea.x, workArea.x + workArea.width - targetW),
    y: clamp(unclamped.y, workArea.y, workArea.y + workArea.height - targetH),
  };
  const clampDelta = { x: clamped.x - unclamped.x, y: clamped.y - unclamped.y };

  const pin = { x: pinScreen.x + clampDelta.x * g, y: pinScreen.y + clampDelta.y * g };
  const catInWin = { x: PIN.x + (anchor.x - PIN.x) * g, y: PIN.y + (anchor.y - PIN.y) * g };
  const size = {
    width: PET_W + (targetW - PET_W) * g,
    height: PET_H + (targetH - PET_H) * g,
  };

  const rawPos = { x: pin.x - catInWin.x, y: pin.y - catInWin.y };
  const peeking = e < 0.05 && be < 0.05;
  const pos = peeking
    ? {
        x: rawPos.x + peekDx,
        y: rawPos.y,
      }
    : g === 0
      ? catOrigin
      : rawPos;

  return {
    size,
    pos,
    anchor,
    clampDelta,
    pinInWin: { x: pin.x - pos.x, y: pin.y - pos.y },
    g,
  };
}

/** 交互区：贴猫体，中点在绘制中心右 ~17s / 上 ~6s。 */
export function computeCatRect(input: { pinInWin: Point; e: number }): Rect {
  const { u, s } = scaleFor(input.e);
  const center = { x: input.pinInWin.x - 17.0 * s, y: input.pinInWin.y + 4.5 * s };
  const cx = center.x + 17.0 * s;
  const cy = center.y - 6.0 * s;
  return { x: cx - u, y: cy - (u * 1.85) / 2, width: u * 2.0, height: u * 1.85 };
}

export interface GrowthInput {
  catOrigin: Point;
  workArea: WorkArea;
  current: { growUp: boolean; growLeft: boolean };
  /** 判据用的目标宽度：面板档 248，气泡档 172（native 分两次判）。 */
  targetWidth?: number;
}

export function resolveGrowthDirection(input: GrowthInput): { growUp: boolean; growLeft: boolean } {
  const { catOrigin, workArea, current } = input;
  const top = workArea.y;
  const bottom = workArea.y + workArea.height;
  const left = workArea.x;
  const right = workArea.x + workArea.width;

  const fitsDown = catOrigin.y + OPEN_H <= bottom - EDGE_MARGIN;
  const fitsUp = catOrigin.y + PET_H - OPEN_H >= top + EDGE_MARGIN;
  const growUp = current.growUp
    ? fitsUp
    : fitsDown
      ? false
      : fitsUp && !fitsDown
        ? true
        : fitsDown && !fitsUp
          ? false
          : catOrigin.y + PET_H - top < bottom - catOrigin.y;

  const targetWidth = input.targetWidth ?? OPEN_W;
  const fitsRight = catOrigin.x + PET_W + (targetWidth - PET_W) <= right - EDGE_MARGIN;
  const fitsLeft = catOrigin.x + PET_W - targetWidth >= left + EDGE_MARGIN;
  const growLeft = current.growLeft
    ? fitsLeft
    : fitsRight
      ? false
      : fitsLeft && !fitsRight
        ? true
        : fitsRight && !fitsLeft
          ? false
          : catOrigin.x + PET_W - left < right - catOrigin.x;

  return { growUp, growLeft };
}
