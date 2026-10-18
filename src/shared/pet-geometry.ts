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
  /**
   * 夹紧把窗口往里推了多少（未乘 g）。口径是**目标档** targetW/targetH
   * （native main.rs:4269-4272 的 delta），不是当前窗口尺寸。
   * 注意 native main.rs:4171-4184 另有一段「收起态每帧按 PET_W/PET_H 夹基准位」的
   * 有状态兜底，不属本纯函数，落点在 Task 12。
   */
  clampDelta: Point;
  /** 猫内容中心在窗口内的位置（夹紧随 g 生效后；peek 时已含 peekDx）。 */
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
  // native main.rs:4283-4303（任务 #38 的事故）：藏身分两步——
  // 1. 窗口只允许滑到「自己的边贴住屏幕边」，绝不出屏（出屏会把底部流量胶囊切一半）；
  // 2. 猫再在窗口内多走一个 peekDx，走出窗口的那半由窗口裁掉。
  // 夹的是**当前** size.width（native 用 win_size），不是 targetW。
  // g===0 时 rawPos 数学上就等于 catOrigin，所以不需要额外的分支。
  const pos = peeking
    ? {
        x: clamp(
          rawPos.x + peekDx,
          workArea.x,
          workArea.x + workArea.width - size.width,
        ),
        y: rawPos.y,
      }
    : rawPos;

  return {
    size,
    pos,
    anchor,
    clampDelta,
    // native main.rs:4379 的 pin_in_win 含 peek_off：Task 10 的绘制中心必须拿到
    // 已经藏进窗口右侧的那个位置，否则猫会反向补回原屏幕位、藏身失效。
    pinInWin: {
      x: pin.x + (peeking ? peekDx : 0) - pos.x,
      y: pin.y - pos.y,
    },
    g,
  };
}

export interface RestoreOriginInput {
  /** 上次落盘的窗口原点（native 的 `pet_pos` 持久化值）。 */
  saved: Point;
  /** 猫所在显示器的工作区——不是主屏，否则会把副屏上的合法位置拽回主屏（native `main.rs:4146-4147`）。 */
  workArea: WorkArea;
  /** 当前 zoom 下的窗口尺寸。 */
  size: Size;
}

/**
 * 把保存点夹回工作区，保证整只猫可见。夹的是**窗口原点**、按**当前尺寸**，
 * 与 computePetLayout 收起档同一把 `clamp`（`hi < lo` 时让 `lo` 赢）。
 * 这是启动兜底；每帧的 workArea 夹取在渲染端（Task 12，对应 native `:4171-4184`）。
 */
export function clampRestoreOrigin(input: RestoreOriginInput): Point {
  const { saved, workArea, size } = input;
  return {
    x: clamp(saved.x, workArea.x, workArea.x + workArea.width - size.width),
    y: clamp(saved.y, workArea.y, workArea.y + workArea.height - size.height),
  };
}

export interface CatRectInput {
  pinInWin: Point;
  e: number;
}

/** 交互区：贴猫体，中点在绘制中心右 ~17s / 上 ~6s。 */
export function computeCatRect(input: CatRectInput): Rect {
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

/**
 * 逐字对照 native `main.rs:4187-4232` 的粘性 if 链：
 * 当前方向放得下就不动；放不下才换边；两头都放不下时用 fallback（空间大的一侧）。
 */
function resolveAxis(current: boolean, fitsTrue: boolean, fitsFalse: boolean, fallback: boolean): boolean {
  if (current ? fitsTrue : fitsFalse) return current;
  if (fitsTrue && !fitsFalse) return true;
  if (fitsFalse && !fitsTrue) return false;
  return fallback;
}

export function resolveGrowthDirection(input: GrowthInput): { growUp: boolean; growLeft: boolean } {
  const { catOrigin, workArea, current } = input;
  const top = workArea.y;
  const bottom = workArea.y + workArea.height;
  const left = workArea.x;
  const right = workArea.x + workArea.width;

  const fitsDown = catOrigin.y + OPEN_H <= bottom - EDGE_MARGIN;
  const fitsUp = catOrigin.y + PET_H - OPEN_H >= top + EDGE_MARGIN;
  const growUp = resolveAxis(
    current.growUp,
    fitsUp,
    fitsDown,
    // native :4199：上方空间（到猫底）> 下方空间（到猫顶）时向上长。
    catOrigin.y + PET_H - top > bottom - catOrigin.y,
  );

  const targetWidth = input.targetWidth ?? OPEN_W;
  const fitsRight = catOrigin.x + PET_W + (targetWidth - PET_W) <= right - EDGE_MARGIN;
  const fitsLeft = catOrigin.x + PET_W - targetWidth >= left + EDGE_MARGIN;
  const growLeft = resolveAxis(
    current.growLeft,
    // fitsTrue 这一格对应该轴的「native 第二分支能放下的一侧」= 能向左翻。
    fitsLeft,
    fitsRight,
    catOrigin.x + PET_W - left > right - catOrigin.x,
  );

  return { growUp, growLeft };
}
