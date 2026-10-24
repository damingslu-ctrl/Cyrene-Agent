import { describe, expect, it } from "vitest";
import { buildPetMenuItems, type PetMenuInput } from "./pet-menu";
import { profileFor } from "../../shared/pet-profile";

const input = (over: Partial<PetMenuInput> = {}): PetMenuInput =>
  ({ quietUntil: null, now, tuckEnabled: true, form: "cat", tier: "standard", ...over });

const now = 1_700_000_000_000;

describe("buildPetMenuItems", () => {
  it("安静期间标题变成「安静中 · 剩 N 分」且那条被禁用", () => {
    const items = buildPetMenuItems(input({ quietUntil: now + 5 * 60_000 }));
    expect(items[0].label).toBe("安静中 · 剩 5 分");
    expect(items[0].enabled).toBe(false);
    expect(items[1].label).toBe("取消安静");
  });

  it("不在安静期时第一项是「安静半小时」且可点（负判据配正对照）", () => {
    const items = buildPetMenuItems(input());
    expect(items[0]).toMatchObject({ label: "安静半小时", enabled: true });
  });

  it("藏身开关的勾与状态一致", () => {
    expect(buildPetMenuItems(input({ tuckEnabled: false }))[2]).toMatchObject({
      label: "贴边藏身", checked: false,
    });
  });

  it("互动动作接在安静三条之后、窗口动作另起一段：只有「隐藏」带分隔线", () => {
    const items = buildPetMenuItems(input());
    expect(items.map((item) => item.label)).toEqual([
      "安静半小时", "取消安静", "贴边藏身",
      "摸摸头", "喂小鱼干", "陪它玩", "哄它睡觉", "它现在怎么样", "打开网络面板",
      "形象：像素猫", "形象：猫娘",
      ...(["small", "standard", "large"] as const).map((t) =>
        `身形：${t === "small" ? "小巧" : t === "standard" ? "标准" : "大"} (${profileFor("cat", t).base.width}×${profileFor("cat", t).base.height})`),
      "隐藏", "退出",
    ]);
    // 分隔线：形态组之前一条 + 隐藏之前一条（v1.5.0 起两组动作各占一段）。
    expect(items.filter((item) => item.separatorBefore).map((item) => item.label)).toEqual(["形象：像素猫", "隐藏"]);
  });

  it("形态两档 + 身形三档：当前项勾上，且只有该组一项勾（藏身那颗不算）", () => {
    const items = buildPetMenuItems(input({ form: "girl", tier: "large" }));
    const forms = items.filter((i) => i.label.startsWith("形象"));
    const tiers = items.filter((i) => i.label.startsWith("身形"));
    expect(forms.map((i) => i.label)).toEqual(["形象：像素猫", "形象：猫娘"]);
    expect(forms.map((i) => i.checked)).toEqual([false, true]);
    expect(tiers.map((i) => i.checked)).toEqual([false, false, true]);
    expect([...forms, ...tiers].filter((i) => i.checked)).toHaveLength(2);
  });

  it("setForm/setTier 没注入时两组项 enabled=false（勾也不许变）", () => {
    const items = buildPetMenuItems(input(), {});
    expect(items.filter((i) => i.label.startsWith("形象")).every((i) => i.enabled === false)).toBe(true);
    expect(items.filter((i) => i.label.startsWith("身形")).every((i) => i.enabled === false)).toBe(true);
  });

  it("setForm/setTier 注入后按项传对参数", () => {
    const calls: string[] = [];
    const items = buildPetMenuItems(input({ form: "cat", tier: "standard" }), {
      setForm: (f) => calls.push(`form:${f}`),
      setTier: (t) => calls.push(`tier:${t}`),
    });
    for (const item of items.filter((i) => i.label.startsWith("形象") || i.label.startsWith("身形"))) item.action?.();
    expect(calls).toEqual(["form:cat", "form:girl", "tier:small", "tier:standard", "tier:large"]);
  });

  it("动作只在提供时挂上：传入 bind 的每个动作都被对应项调用", () => {
    const calls: string[] = [];
    const action = (name: string) => () => calls.push(name);
    const items = buildPetMenuItems(
      input({ tuckEnabled: false }),
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
