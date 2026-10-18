/**
 * 免打扰的自醒时钟：到点当场清盘 + 通知渲染端撤月牙。
 *
 * 对位 native（`main.rs:3990-4001`）：「到点自醒：安静是借来的沉默，还的时候要当面
 * 说一声。只认『上一帧还开着、这一帧到点』这条下降沿，所以开机时就已经过期那一档
 * 不归这里（那是开机队列那句结账），两条路各说一次、不会重叠。」帧循环里查出
 * 下降沿 → `persist.quiet_until = None` → save_persist → 递那句结账——**当场清**，
 * 不能等下一次动作再清：文件里躺着一个已过去的截止，这件事本身就是欠账的凭证
 * （`main.rs:2515-2520`）。
 *
 * Electron 版没有每帧循环：落盘时起 `setTimeout(remaining).unref()`（native 的
 * 帧循环在省电降帧下自己也只便宜 4fps；定时器在进程活着时同样可靠，且 unref
 * 不许拖住退出）。到点当场置 null、落盘、广播 VERGE_QUIET_CHANGED 让渲染端撤月牙。
 */
import { IPC } from "../../shared/ipc-channels";
import { isQuietNow } from "./quiet-clock";

export interface QuietClockWiring {
  service: {
    getState(): { quietUntil: number | null };
    setQuietUntil(until: number | null): void;
  };
  /**
   * 到点通知：走装配点那条 VERGE_QUIET_CHANGED 收口（撤月牙）。
   * 只可能在「当场清盘之后」被调，所以这条路上广播到的必是清盘后的 null；
   * 写盘事件（菜单 / toggle-quiet）不经这里，由同一条收口带当下截止。
   * 何时发到哪些窗由装配点定义。
   */
  notifyWake(): void;
}
export interface QuietClockHandle {
  /** 状态（手工改盘 / 重建窗）变化后重排：旧的定时器作废，剩多久就睡多久。 */
  rearm(): void;
  /** 退出清理：unref 之外的显式收口。 */
  dispose(): void;
}

export function attachQuietClock(wiring: QuietClockWiring): QuietClockHandle {
  let timer: ReturnType<typeof setTimeout> | null = null;

  function schedule(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    const current = wiring.service.getState().quietUntil;
    if (!isQuietNow(current, Date.now())) return;
    const remaining = current! - Date.now();
    timer = setTimeout(() => {
      timer = null;
      // 到点那帧只接受「用户先一步取消」这条路改道：盘上已是 null 就什么都不做
      // （用户自己清的账不需要再「醒」一次）。**截止已过本身就该清**——
      // isQuietNow(截止, 到点) 恒为 false，用它闸清盘会把"当场清"闸成"永远不清"。
      const latest = wiring.service.getState().quietUntil;
      if (latest === null) return;
      // native 的契约：到点自醒要当场清 quiet_until（main.rs:3993），不能等下一次动作。
      wiring.service.setQuietUntil(null);
      wiring.notifyWake();
    }, remaining) as ReturnType<typeof setTimeout>;
    // 免打扰不许拖住进程退出：native 的帧循环退到 quit 时自然消失，这里显式 unref。
    timer.unref?.();
  }

  return {
    rearm: schedule,
    dispose(): void {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

/**
 * VERGE_QUIET_CHANGED 的载荷：携带**当下**的 quietUntil，两件事共用这一条通道——
 * - 到点自醒：传当场清盘后的 null（native main.rs:2515-2517 的「当场清」，语义不变）；
 * - 写盘（菜单 / toggle-quiet）：传刚落进去的那个截止，渲染端按真语义
 *   `quietUntil !== null && Date.now() < quietUntil` 判月牙（剩余分钟同源，:2534）。
 */
export function quietChangedPayload(quietUntil: number | null): { quietUntil: number | null } {
  return { quietUntil };
}

/** 通道名的确认位：notifyWake 的实现应该发这一个。 */
export const QUIET_CHANGED_CHANNEL = IPC.VERGE_QUIET_CHANGED;
