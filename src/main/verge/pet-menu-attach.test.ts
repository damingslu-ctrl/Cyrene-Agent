import { beforeEach, describe, expect, it, vi } from "vitest";

/** context-menu 事件参数的最小切片（宠物窗菜单不读 params.x/y，只收事件）。 */
export interface PetContextMenuParamsSlice {
  isEditable?: boolean;
  selectionText?: string;
}

const mocks = vi.hoisted(() => ({
  contextMenuListeners: [] as Array<(event: unknown, params: PetContextMenuParamsSlice) => void>,
  menuTemplates: [] as Array<Array<Record<string, unknown>>>,
  popupCalls: [] as Array<Record<string, unknown>>,
}));

vi.mock("electron", () => ({
  BrowserWindow: class {
    isDestroyed = () => false;
    webContents = {
      on: (event: string, listener: (event: unknown, params: PetContextMenuParamsSlice) => void) => {
        if (event !== "context-menu") throw new Error(`unexpected webContents event: ${event}`);
        mocks.contextMenuListeners.push(listener);
      },
    };
  },
  Menu: {
    buildFromTemplate: (template: Array<Record<string, unknown>>) => {
      mocks.menuTemplates.push(template);
      return {
        popup: (options: Record<string, unknown>) => mocks.popupCalls.push(options),
      };
    },
  },
}));

import { BrowserWindow } from "electron";
import { attachPetContextMenu } from "./pet-menu";
import type { VergeService } from "./verge-service";

/** 有账的 service mock：quietUntil/tuckEnabled 的读写都被记录。 */
function makeService(initial: { quietUntil: number | null; tuckEnabled: boolean }): VergeService & {
  writes: Array<{ quietUntil: number | null }>;
  tuckWrites: boolean[];
} {
  const writes: Array<{ quietUntil: number | null }> = [];
  const tuckWrites: boolean[] = [];
  let state = { ...initial, tuckHinted: false };
  return {
    writes,
    tuckWrites,
    getSnapshot: vi.fn(() => ({ module: "verge", ready: true, statePath: "", quietUntil: state.quietUntil })),
    getState: vi.fn(() => ({ ...state })),
    setQuietUntil: vi.fn((until) => {
      writes.push({ quietUntil: until });
      state = { ...state, quietUntil: until };
    }),
    setTuckEnabled: vi.fn((enabled) => {
      tuckWrites.push(enabled);
      state = { ...state, tuckEnabled: enabled };
    }),
    markTuckHinted: vi.fn(),
  } as never;
}

/** 新建 mock 窗、挂菜单、触发一次右键，返回模板、handle 与两条收口的记账。 */
function rightClick(service: VergeService, quit = vi.fn(), onQuietStateChange = vi.fn(), onTuckStateChange = vi.fn()) {
  const win = new BrowserWindow() as unknown as BrowserWindow & { isDestroyed: () => boolean };
  attachPetContextMenu({ window: win, service, quit, onQuietStateChange, onTuckStateChange });
  const listener = mocks.contextMenuListeners.at(-1);
  if (!listener) throw new Error("context-menu listener was not registered");
  listener({}, {});
  return {
    template: mocks.menuTemplates.at(-1) ?? [],
    popup: mocks.popupCalls.at(-1),
    service,
    win,
    onQuietStateChange,
    onTuckStateChange,
  };
}

function itemByLabel(template: Array<Record<string, unknown>>, label: string) {
  const item = template.find((entry) => entry.label === label);
  if (!item) throw new Error(`menu item not found: ${label}`);
  return item;
}

beforeEach(() => {
  mocks.contextMenuListeners.length = 0;
  mocks.menuTemplates.length = 0;
  mocks.popupCalls.length = 0;
});

describe("attachPetContextMenu", () => {
  it("右键弹出六项：安静半小时 / 取消安静 / 贴边藏身 / 隐藏 / 退出（藏身前有分隔线）", () => {
    const { template, popup } = rightClick(makeService({ quietUntil: null, tuckEnabled: true }));
    const labels = template.filter((entry) => entry.type !== "separator").map((entry) => entry.label);
    expect(labels).toEqual(["安静半小时", "取消安静", "贴边藏身", "隐藏", "退出"]);
    // 分隔线且只有一条，正好卡在「隐藏」前（性格动作 ⊖ 窗口动作的分界，native 托盘同类分法）。
    const hideIndex = template.findIndex((entry) => entry.label === "隐藏");
    expect(template[hideIndex - 1]).toMatchObject({ type: "separator" });
    expect(template.filter((entry) => entry.type === "separator")).toHaveLength(1);
    expect(popup?.window).toBeInstanceOf(BrowserWindow);
  });

  it("点「安静半小时」写盘半小时（落盘才算数，屏幕上的月牙只是影子）", () => {
    const service = makeService({ quietUntil: null, tuckEnabled: true });
    const { template, onQuietStateChange } = rightClick(service);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_700_000_000_000);
      itemByLabel(template, "安静半小时").click?.();
      const until = 1_700_000_000_000 + 30 * 60_000;
      expect(service.writes).toEqual([{ quietUntil: until }]);
      // 写盘只是半件事：必须把**当下这个截止**（不是恒 null）交给收口去 rearm 自醒钟
      // 并广播上屏。漏掉它 → 半小时后没人清盘，盘里躺着已过去的截止（native
      // main.rs:2515-2517 明令当场清的欠账态），若此前排过更近的陈旧截止还会在旧点
      // 误触发、把这次合法的新 quiet 提前抹掉；月牙也要等重启才出现。
      expect(onQuietStateChange.mock.calls).toEqual([[until]]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("安静期间第一项是「安静中 · 剩 N 分」且禁用；点「取消安静」清盘（反向路径）", () => {
    const now = Date.now();
    const service = makeService({ quietUntil: now + 5 * 60_000, tuckEnabled: false });
    const { template, onQuietStateChange } = rightClick(service);
    expect(itemByLabel(template, "安静中 · 剩 5 分")).toMatchObject({ enabled: false });
    expect(itemByLabel(template, "取消安静")).toMatchObject({ enabled: true });
    itemByLabel(template, "取消安静").click?.();
    expect(service.writes).toEqual([{ quietUntil: null }]);
    // 取消也走同一条收口：rearm 让残留的旧定时器作废、广播 null 当场撤月牙（main.rs:2503 的翻转）。
    expect(onQuietStateChange.mock.calls).toEqual([[null]]);
  });

  it("点「贴边藏身」翻转开关并走 tuck 收口广播新值；点「退出」走注入的 quit 链路", () => {
    const quit = vi.fn();
    const service = makeService({ quietUntil: null, tuckEnabled: false });
    const { template, onTuckStateChange } = rightClick(service, quit);
    itemByLabel(template, "贴边藏身").click?.();
    expect(service.tuckWrites).toEqual([true]);
    // 「取消勾选立刻回位」的另一半：落盘之后必须把新值广播到渲染端（Task 11 quiet 收口同构）。
    expect(onTuckStateChange.mock.calls).toEqual([[true]]);
    itemByLabel(template, "退出").click?.();
    expect(quit).toHaveBeenCalledOnce();
  });

  it("点「隐藏」就地收窗（hide 走 BrowserWindow，不穿 IPC）", () => {
    const service = makeService({ quietUntil: null, tuckEnabled: true });
    const { template, win } = rightClick(service);
    const hide = vi.fn();
    (win as unknown as { hide: unknown }).hide = hide;
    itemByLabel(template, "隐藏").click?.();
    expect(hide).toHaveBeenCalledOnce();
  });

  it("quiet 收口只认 quiet：点藏身/隐藏/退出不惊动它，也不顺手写 quiet 的盘", () => {
    const service = makeService({ quietUntil: null, tuckEnabled: false });
    const { template, onQuietStateChange, win } = rightClick(service);
    (win as unknown as { hide: unknown }).hide = vi.fn();
    itemByLabel(template, "贴边藏身").click?.();
    itemByLabel(template, "隐藏").click?.();
    itemByLabel(template, "退出").click?.();
    // 这三条与安静期无关（tuck/hide/quit 语义不变）：收口一次都不该被叫到。
    expect(onQuietStateChange).not.toHaveBeenCalled();
    expect(service.writes).toEqual([]);
  });
});
