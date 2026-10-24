/**
 * 猫窗几何的唯一出处。
 *
 * 逐位对应 native `main.rs` 的展开协议（:4241-4306）与绘制中心反推（:4377-4409）。
 * 这些数字不是审美选择：所有屏幕尺都按它们量，改一个数等于作废一批验收器。
 * 单位为 DIP（Electron 逻辑像素），与 native 的 egui 逻辑像素同一坐标系。
 *
 * v1.5.0（Task 3）：三个布局函数收可选的 `profile`（形态×身形档），**缺省值就是今天的常量**，
 * 所以不传参的既有调用与全部旧屏幕尺继续逐字节不变。`DEFAULT_PROFILE` 从
 * `./pet-profile` 取——pet-profile 只依赖本文件的常量，两个模块之间没有运行期循环
 * （pet-profile 的顶层字面量不读本文件，只有函数体读）。
 */
import { formGeometry, profileFor, type PetProfile } from "./pet-profile";

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
  /** 形态×档位；缺省＝今天的四足标准档（v1.5.0 Task 3，所有旧调用一字不改）。 */
  profile?: PetProfile;
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
  /**
   * 猫内容中心在窗口内的位置——native 的 `pin_in_win = pet + PIN + peek_off - applied_pos`
   * （`main.rs:4379`），分子是**未随夹紧位移的** `pinScreen`。
   * 不变式：`pos + pinInWin === pinScreen + peek`——夹紧只挪窗口、不挪猫，
   * 所以展开面板时猫钉在原地（`PIN` 的注释「窗口绕它长」说的就是这条）。
   * 写成 `pin`（已含 `clampDelta·g`）会让两个 `clampDelta·g` 相消、猫跟着窗口一起滑。
   */
  pinInWin: Point;
  g: number;
}

/**
 * 几何兜底：今天的四足标准档。它是**参照系**，不是产品默认（产品默认在 verge-store）。
 * 必须是函数而不是顶层常量：pet-profile.ts 在它自己的顶层 import 本文件的常量，
 * 两个模块成环时谁先求值不确定，顶层 `profileFor(...)` 会在另一半的 TC 里读到 undefined
 * （TDZ 不是理论风险——girl.test 引入第三个 import 顺序时就当场炸过）。
 */
export function defaultProfile(): PetProfile {
  return profileFor("cat", "standard");
}

export function scaleFor(e: number): { u: number; s: number } {
  const u = 37.0 + (32.0 - 37.0) * e;
  return { u, s: u / 60.0 };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(hi, lo));

/**
 * native main.rs:4171-4184 的同一条规则搬到窗口层：
 * 显示器拓扑变了（拔副屏 / 改缩放）之后，窗口 bounds 按新 workArea 双轴夹回，
 * 尺寸不变。夹完的窗口原点即新的 catOrigin（peeking 态下 win_pos 与猫位同轴）。
 */
export function clampBoundsToWorkArea(bounds: Rect, workArea: WorkArea): Rect {
  return {
    x: clamp(bounds.x, workArea.x, workArea.x + workArea.width - bounds.width),
    y: clamp(bounds.y, workArea.y, workArea.y + workArea.height - bounds.height),
    width: bounds.width,
    height: bounds.height,
  };
}

export function computePetLayout(input: PetLayoutInput): PetLayout {
  const { catOrigin, e, be, growLeft, growUp, workArea, peekDx } = input;
  const profile = input.profile ?? defaultProfile();
  const { base, pin: profilePin, panel, bubbleWidth } = profile;

  const usingPanel = e > 0.001;
  const targetW = usingPanel ? panel.width : bubbleWidth;
  const targetH = usingPanel ? panel.height : base.height;
  const g = usingPanel ? e : be;

  const anchor: Point = usingPanel
    ? {
        x: growLeft ? panel.width - profilePin.x : profilePin.x,
        y: growUp ? panel.height - EDGE_MARGIN - 51.5 * (29.0 / 60.0) : profilePin.y,
      }
    : { x: growLeft ? bubbleWidth - profilePin.x : profilePin.x, y: profilePin.y };

  const pinScreen = { x: catOrigin.x + profilePin.x, y: catOrigin.y + profilePin.y };
  const unclamped = { x: pinScreen.x - anchor.x, y: pinScreen.y - anchor.y };
  const clamped = {
    x: clamp(unclamped.x, workArea.x, workArea.x + workArea.width - targetW),
    y: clamp(unclamped.y, workArea.y, workArea.y + workArea.height - targetH),
  };
  const clampDelta = { x: clamped.x - unclamped.x, y: clamped.y - unclamped.y };

  const pin = { x: pinScreen.x + clampDelta.x * g, y: pinScreen.y + clampDelta.y * g };
  const catInWin = { x: profilePin.x + (anchor.x - profilePin.x) * g, y: profilePin.y + (anchor.y - profilePin.y) * g };
  const size = {
    width: base.width + (targetW - base.width) * g,
    height: base.height + (targetH - base.height) * g,
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
      x: pinScreen.x + (peeking ? peekDx : 0) - pos.x,
      y: pinScreen.y - pos.y,
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
  /** 形态×档位；缺省＝今天的四足标准档。 */
  profile?: PetProfile;
}

/**
 * 交互区：以钉位点为基准的矩形。
 * 猫：中心 (pin.x, pin.y − 1.5s)、宽 2u、高 1.85u——与 v1.4 的四个数逐字节相等；
 * 猫娘：中心 (pin.x, pin.y − 45.75s)、宽 0.86u、高 1.55u（Task 26 的尺 #71 实测反钉）。
 */
export function computeCatRect(input: CatRectInput): Rect {
  const profile = input.profile ?? defaultProfile();
  const g = formGeometry(profile.form);
  const { u, s } = profile.catScale(input.e);
  const cx = input.pinInWin.x + g.hitCenter.dx * s;
  const cy = input.pinInWin.y + g.hitCenter.dy * s;
  const width = u * g.hitAspect.width;
  const height = u * g.hitAspect.height;
  return { x: cx - width / 2, y: cy - height / 2, width, height };
}

export interface GrowthInput {
  catOrigin: Point;
  workArea: WorkArea;
  current: { growUp: boolean; growLeft: boolean };
  /** 判据用的目标宽度：面板档 248，气泡档 172（native 分两次判）。缺省取 profile.panel/bubble。 */
  targetWidth?: number;
  /** 形态×档位；缺省＝今天的四足标准档。 */
  profile?: PetProfile;
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
  const profile = input.profile ?? defaultProfile();
  const baseW = profile.base.width;
  const baseH = profile.base.height;
  const panelH = profile.panel.height;
  const top = workArea.y;
  const bottom = workArea.y + workArea.height;
  const left = workArea.x;
  const right = workArea.x + workArea.width;

  const fitsDown = catOrigin.y + panelH <= bottom - EDGE_MARGIN;
  const fitsUp = catOrigin.y + baseH - panelH >= top + EDGE_MARGIN;
  const growUp = resolveAxis(
    current.growUp,
    fitsUp,
    fitsDown,
    // native :4199：上方空间（到猫底）> 下方空间（到猫顶）时向上长。
    catOrigin.y + baseH - top > bottom - catOrigin.y,
  );

  const targetWidth = input.targetWidth ?? profile.panel.width;
  const fitsRight = catOrigin.x + baseW + (targetWidth - baseW) <= right - EDGE_MARGIN;
  const fitsLeft = catOrigin.x + baseW - targetWidth >= left + EDGE_MARGIN;
  const growLeft = resolveAxis(
    current.growLeft,
    // fitsTrue 这一格对应该轴的「native 第二分支能放下的一侧」= 能向左翻。
    fitsLeft,
    fitsRight,
    catOrigin.x + baseW - left > right - catOrigin.x,
  );

  return { growUp, growLeft };
}
