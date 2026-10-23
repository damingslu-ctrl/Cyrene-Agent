import { describe, expect, it } from "vitest";
import { buildPetMenuItems } from "./pet-menu";

const now = 1_700_000_000_000;

describe("buildPetMenuItems", () => {
  it("安静期间标题变成「安静中 · 剩 N 分」且那条被禁用", () => {
    const items = buildPetMenuItems({ quietUntil: now + 5 * 60_000, now, tuckEnabled: true });
    expect(items[0].label).toBe("安静中 · 剩 5 分");
    expect(items[0].enabled).toBe(false);
    expect(items[1].label).toBe("取消安静");
  });

  it("不在安静期时第一项是「安静半小时」且可点（负判据配正对照）", () => {
    const items = buildPetMenuItems({ quietUntil: null, now, tuckEnabled: true });
    expect(items[0]).toMatchObject({ label: "安静半小时", enabled: true });
  });

  it("藏身开关的勾与状态一致", () => {
    expect(buildPetMenuItems({ quietUntil: null, now, tuckEnabled: false })[2]).toMatchObject({
      label: "贴边藏身", checked: false,
    });
  });

  it("互动动作接在安静三条之后、窗口动作另起一段：只有「隐藏」带分隔线", () => {
    const items = buildPetMenuItems({ quietUntil: null, now, tuckEnabled: true });
    expect(items.map((item) => item.label)).toEqual([
      "安静半小时", "取消安静", "贴边藏身",
      "摸摸头", "喂小鱼干", "陪它玩", "哄它睡觉", "它现在怎么样", "打开网络面板",
      "隐藏", "退出",
    ]);
    expect(items.filter((item) => item.separatorBefore).map((item) => item.label)).toEqual(["隐藏"]);
  });

  it("动作只在提供时挂上：传入 bind 的每个动作都被对应项调用", () => {
    const calls: string[] = [];
    const action = (name: string) => () => calls.push(name);
    const items = buildPetMenuItems(
      { quietUntil: null, now, tuckEnabled: false },
      {
        quiet: action("quiet"), cancelQuiet: action("cancel"), toggleTuck: action("tuck"),
        pet: action("pet"), feed: action("feed"), play: action("play"),
        toggleSleep: action("sleep"), status: action("status"), openNetwork: action("network"),
        hide: action("hide"), quit: action("quit"),
      },
    );
    for (const item of items) item.action?.();
    expect(calls).toEqual([
      "quiet", "cancel", "tuck", "pet", "feed", "play", "sleep", "status", "network", "hide", "quit",
    ]);
  });
});
