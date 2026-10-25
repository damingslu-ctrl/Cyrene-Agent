/**
 * 「逗光标」的纯计数器：光标在她身边快速甩两下，才算在逗她。
 *
 * 不在渲染器里写阈值，是因为这几个数决定「她会不会突然扑过去」——
 * 太快会变成跟着鼠标抽搐，太慢则一辈子不触发。纯类可单测，也方便探针喂点。
 * 冷却不在这里：那是引擎的职责（它还要考虑睡觉/安静/被抓着）。
 */
export const TEASE = {
  /** 两次快速移动相隔不超过这么久才算同一次逗弄。 */
  windowMs: 900,
  /** 单次位移超过这么多 px 才算「快速」。 */
  movePx: 26,
  /** 两次采样间隔超过它，速度不可信（光标可能是瞬移/窗口刚搬过）。 */
  fastMs: 240,
  /** 凑满几次快速移动触发一次。 */
  hits: 2,
} as const;

export class TeaseTracker {
  private last: { x: number; y: number; at: number } | null = null;
  private marks: number[] = [];

  /** 喂一个光标采样；返回 true = 这一拍凑满一次逗弄。 */
  feed(x: number, y: number, now: number): boolean {
    if (![x, y, now].every(Number.isFinite)) return false;
    const last = this.last;
    this.last = { x, y, at: now };
    if (!last) return false;
    const dt = now - last.at;
    if (dt <= 0 || dt > TEASE.fastMs) {
      if (dt > TEASE.windowMs) this.marks = [];
      return false;
    }
    const dist = Math.hypot(x - last.x, y - last.y);
    if (dist < TEASE.movePx) return false;

    this.marks = this.marks.filter((at) => now - at <= TEASE.windowMs);
    this.marks.push(now);
    if (this.marks.length < TEASE.hits) return false;
    this.marks = [];
    return true;
  }

  reset(): void {
    this.last = null;
    this.marks = [];
  }

  /** 诊断用：当前窗口里攒了几笔。 */
  get pending(): number {
    return this.marks.length;
  }
}
