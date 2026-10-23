// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClickThroughController } from "./click-through";
import type { PixelPetRenderer } from "./renderer";

function makeCanvas() {
  const listeners = new Map<string, EventListener>();
  let left = 0;
  const canvas = {
    addEventListener: vi.fn((type: string, fn: EventListener) => {
      listeners.set(type, fn);
    }),
    removeEventListener: vi.fn((type: string) => {
      listeners.delete(type);
    }),
    getBoundingClientRect: () => ({ left, top: 0, right: left + 82, bottom: 108, width: 82, height: 108 }),
  };
  return {
    canvas: canvas as unknown as HTMLCanvasElement,
    listeners,
    moveWindowTo(nextLeft: number): void {
      left = nextLeft;
    },
  };
}

function makeDriver() {
  const pending = new Map<number, FrameRequestCallback>();
  let handle = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
    handle += 1;
    pending.set(handle, cb);
    return handle;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id: number) => {
    pending.delete(id);
  });
  return {
    fire(): void {
      const next = pending.entries().next().value as [number, FrameRequestCallback] | undefined;
      if (!next) throw new Error("no pending requestAnimationFrame callback");
      pending.delete(next[0]);
      next[1](0);
    },
    hasPending(): boolean {
      return pending.size > 0;
    },
  };
}

function pointerMove(type: string, clientX: number, clientY: number): Event {
  return Object.assign(new Event(type), { clientX, clientY }) as unknown as PointerEvent;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ClickThroughController", () => {
  it("光标落在猫身上才发 true，且同状态重复 move 不刷 IPC", () => {
    const { canvas, listeners } = makeCanvas();
    const driver = makeDriver();
    const readAlpha = vi.fn(() => 200);
    const onInteractive = vi.fn();
    new ClickThroughController(canvas, { readAlpha } as unknown as PixelPetRenderer, { onInteractive });

    listeners.get("pointermove")!(pointerMove("pointermove", 10, 20));
    driver.fire();
    expect(readAlpha).toHaveBeenCalledWith(10, 20);
    expect(onInteractive).toHaveBeenCalledTimes(1);
    expect(onInteractive).toHaveBeenLastCalledWith(true);

    listeners.get("pointermove")!(pointerMove("pointermove", 12, 24));
    driver.fire();
    expect(onInteractive).toHaveBeenCalledTimes(1);
  });

  it("窗口在静止光标底下挪了：同一光标点按新窗口坐标重判", () => {
    const { canvas, listeners, moveWindowTo } = makeCanvas();
    const driver = makeDriver();
    const readAlpha = vi.fn(() => 200);
    const onInteractive = vi.fn();
    const controller = new ClickThroughController(
      canvas,
      { readAlpha } as unknown as PixelPetRenderer,
      { onInteractive },
    );

    listeners.get("pointermove")!(pointerMove("pointermove", 10, 20));
    driver.fire();
    expect(onInteractive).toHaveBeenLastCalledWith(true);

    // 猫漫游把窗口向左挪了 30px：同一个屏幕点现在是窗口内的 (40,20)。
    readAlpha.mockReturnValue(0);
    moveWindowTo(-30);
    controller.refreshAfterWindowMove();
    expect(driver.hasPending()).toBe(true);
    driver.fire();
    expect(readAlpha).toHaveBeenLastCalledWith(40, 20);
    expect(onInteractive).toHaveBeenLastCalledWith(false);
  });

  it("光标离开窗口后清点：窗口再动也不替它重判", () => {
    const { canvas, listeners } = makeCanvas();
    const driver = makeDriver();
    const readAlpha = vi.fn(() => 200);
    const onInteractive = vi.fn();
    const controller = new ClickThroughController(
      canvas,
      { readAlpha } as unknown as PixelPetRenderer,
      { onInteractive },
    );

    listeners.get("pointermove")!(pointerMove("pointermove", 10, 20));
    driver.fire();
    readAlpha.mockClear();
    listeners.get("pointerleave")!(pointerMove("pointerleave", 10, 20));
    controller.refreshAfterWindowMove();
    expect(driver.hasPending()).toBe(false);
    expect(readAlpha).not.toHaveBeenCalled();
  });

  it("暂停期间窗口挪动不重判；恢复时用最后光标点补一次", () => {
    const { canvas, listeners, moveWindowTo } = makeCanvas();
    const driver = makeDriver();
    const readAlpha = vi.fn(() => 200);
    const onInteractive = vi.fn();
    const controller = new ClickThroughController(
      canvas,
      { readAlpha } as unknown as PixelPetRenderer,
      { onInteractive },
    );

    listeners.get("pointermove")!(pointerMove("pointermove", 10, 20));
    driver.fire();
    controller.pause();
    readAlpha.mockReturnValue(0);
    moveWindowTo(20);
    controller.refreshAfterWindowMove();
    expect(driver.hasPending()).toBe(false);

    controller.resume();
    expect(driver.hasPending()).toBe(true);
    driver.fire();
    expect(onInteractive).toHaveBeenLastCalledWith(false);
  });

  it("dispose 后不再接 move / refresh", () => {
    const { canvas, listeners } = makeCanvas();
    const driver = makeDriver();
    const readAlpha = vi.fn(() => 200);
    const onInteractive = vi.fn();
    const controller = new ClickThroughController(
      canvas,
      { readAlpha } as unknown as PixelPetRenderer,
      { onInteractive },
    );
    const move = listeners.get("pointermove")!;
    controller.dispose();
    move(pointerMove("pointermove", 10, 20));
    controller.refreshAfterWindowMove();
    expect(driver.hasPending()).toBe(false);
    expect(onInteractive).not.toHaveBeenCalled();
  });
});
