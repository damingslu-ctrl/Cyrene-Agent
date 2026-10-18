import { afterEach, describe, expect, it, vi } from "vitest";
import { attachQuietClock, quietChangedPayload, QUIET_CHANGED_CHANNEL } from "./quiet-clock-wiring";

const timers: Array<ReturnType<typeof setTimeout>> = [];

afterEach(() => {
  for (const t of timers.splice(0)) clearTimeout(t);
  vi.useRealTimers();
});

describe("attachQuietClock（到点自醒的 wiring）", () => {
  it("到点当场清盘 + 通知渲染端（native 的契约：清盘不能等下一次动作再清）", () => {
    vi.useFakeTimers();
    let now = 1_000_000;
    vi.setSystemTime(now);
    let state = { quietUntil: null as number | null };
    const wakeNotifies: number[] = [];
    const clock = attachQuietClock({
      service: {
        getState: () => ({ ...state }),
        setQuietUntil: (until) => { state = { quietUntil: until }; },
      },
      notifyWake: () => wakeNotifies.push(state.quietUntil ?? -1),
    });

    // 落盘半小时：定时器按剩余时长排，unref 不许拖住退出
    state = { quietUntil: now + 30 * 60_000 };
    clock.rearm();
    now += 30 * 60_000;
    vi.setSystemTime(now);
    vi.advanceTimersByTime(30 * 60_000);
    expect(state.quietUntil).toBeNull();            // 盘里当场回到 null
    expect(wakeNotifies).toEqual([-1]);             // 渲染端撤月牙的通知发了

    clock.dispose();
  });

  it("上一帧还开着、这一帧被用户先取消：到点不清（以盘上最新值为准）", () => {
    vi.useFakeTimers();
    let now = 1_000_000;
    vi.setSystemTime(now);
    let state = { quietUntil: now + 60_000 as number | null };
    let notified = 0;
    const clock = attachQuietClock({
      service: {
        getState: () => ({ ...state }),
        setQuietUntil: (until) => { state = { quietUntil: until }; },
      },
      notifyWake: () => { notified += 1; },
    });
    clock.rearm();

    // 半路用户点了「取消安静」：盘变成 null
    state = { quietUntil: null };
    vi.setSystemTime(now + 90_000);
    vi.advanceTimersByTime(90_000);
    expect(state.quietUntil).toBeNull();
    expect(notified).toBe(0);   // 用户自己清的账，不需要再「醒」一次

    clock.dispose();
  });

  it("rearm 重排：先把截止推迟再 rearm，旧的不作数、新的到点才发", () => {
    vi.useFakeTimers();
    let now = 1_000_000;
    vi.setSystemTime(now);
    let state = { quietUntil: now + 10_000 as number | null };
    let notified = 0;
    const clock = attachQuietClock({
      service: {
        getState: () => ({ ...state }),
        setQuietUntil: (until) => { state = { quietUntil: until }; },
      },
      notifyWake: () => { notified += 1; },
    });
    clock.rearm();
    // 手工把 quietUntil 改成更远的未来（重启验收的那档对手盘）并重排
    state = { quietUntil: now + 60_000 };
    clock.rearm();
    vi.setSystemTime(now + 30_000);
    vi.advanceTimersByTime(30_000);
    expect(state.quietUntil).toBe(now + 60_000);   // 旧定时器没把新截止清掉
    expect(notified).toBe(0);
    vi.advanceTimersByTime(30_000);
    expect(state.quietUntil).toBeNull();
    expect(notified).toBe(1);

    clock.dispose();
  });

  it("不在安静期 rearm 是 no-op（不开空定时器）", () => {
    let state = { quietUntil: null as number | null };
    let notified = 0;
    const clock = attachQuietClock({
      service: {
        getState: () => ({ ...state }),
        setQuietUntil: (until) => { state = { quietUntil: until }; },
      },
      notifyWake: () => { notified += 1; },
    });
    expect(() => clock.rearm()).not.toThrow();
    expect(notified).toBe(0);
    clock.dispose();
  });

  it("通道名与载荷形不变量：payload 恒 { quietUntil: null }，频道是 verge:quiet-changed", () => {
    expect(quietChangedPayload()).toEqual({ quietUntil: null });
    expect(QUIET_CHANGED_CHANNEL).toBe("verge:quiet-changed");
  });
});
