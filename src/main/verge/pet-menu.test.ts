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
      "摸摸头", "喂小鱼干", "陪它玩", "哄它睡觉", "它现在怎么样",
      "给她打扮", "放只小虫逗逗她", "陪她散散步",
      "挥挥逗猫棒", "吹一串泡泡", "撒一把落叶", "跟我来", "猜拳",
      "纸箱躲猫猫", "照个红点点", "给她梳梳毛", "闻闻猫薄荷", "放架纸飞机", "请小鸟来做客",
      "磨磨爪子", "滚个铃铛球", "放只发条鼠", "来局打地鼠", "抱一下", "下场小雨",
      "成长记录", "今日小目标", "猫咪日记",
      "让它做个动作",
      "打开网络面板",
      "形象：像素猫", "形象：猫娘",
      ...(["small", "standard", "large"] as const).map((t) =>
        `身形：${t === "small" ? "小巧" : t === "standard" ? "标准" : "大"} (${profileFor("cat", t).base.width}×${profileFor("cat", t).base.height})`),
      "隐藏", "退出",
    ]);
    // 分隔线：形态组之前一条 + 隐藏之前一条（v1.5.0 起两组动作各占一段）。
    expect(items.filter((item) => item.separatorBefore).map((item) => item.label)).toEqual(["形象：像素猫", "隐藏"]);
  });

  it("猫娘专属动作：四足形态下置灰，切到猫娘后可点；装扮子菜单列全六件", () => {
    const catItems = buildPetMenuItems(input({ form: "cat" }), {
      accessory: () => {}, critter: () => {}, wander: () => {},
      wand: () => {}, bubbles: () => {}, leaves: () => {}, follow: () => {}, rps: () => {},
      box: () => {}, laser: () => {}, brush: () => {}, catnip: () => {}, plane: () => {}, bird: () => {}, growth: () => {},
      scratch: () => {}, bell: () => {}, mouse: () => {}, mole: () => {}, hug: () => {}, rain: () => {},
      quests: () => {}, diary: () => {},
    });
    const girlItems = buildPetMenuItems(input({ form: "girl" }), {
      accessory: () => {}, critter: () => {}, wander: () => {},
      wand: () => {}, bubbles: () => {}, leaves: () => {}, follow: () => {}, rps: () => {},
      box: () => {}, laser: () => {}, brush: () => {}, catnip: () => {}, plane: () => {}, bird: () => {}, growth: () => {},
      scratch: () => {}, bell: () => {}, mouse: () => {}, mole: () => {}, hug: () => {}, rain: () => {},
      quests: () => {}, diary: () => {},
    });
    const find = (items: typeof catItems, label: string) => items.find((i) => i.label === label)!;
    for (const label of [
      "给她打扮", "放只小虫逗逗她", "陪她散散步",
      "挥挥逗猫棒", "吹一串泡泡", "撒一把落叶", "跟我来", "猜拳",
      "纸箱躲猫猫", "照个红点点", "给她梳梳毛", "闻闻猫薄荷", "放架纸飞机", "请小鸟来做客",
      "磨磨爪子", "滚个铃铛球", "放只发条鼠", "来局打地鼠", "抱一下", "下场小雨",
      "成长记录", "今日小目标", "猫咪日记",
    ]) {
      expect(find(catItems, label).enabled, label).toBe(false);
      expect(find(girlItems, label).enabled, label).toBe(true);
    }
    expect(find(girlItems, "给她打扮").submenu?.map((i) => i.label))
      .toEqual(["不戴", "铃铛项圈", "蝴蝶结", "小围巾", "耳边小花", "星星发夹"]);
    expect(find(girlItems, "猜拳").submenu?.map((i) => i.label)).toEqual(["石头", "剪刀", "布"]);
  });

  it("装扮子项发的是 `accessory:<id>` 命令，小虫/散步/玩具各发自己的命令", () => {
    const sent: string[] = [];
    const items = buildPetMenuItems(input({ form: "girl" }), {
      accessory: (id) => sent.push(`accessory:${id}`),
      critter: () => sent.push("summon-critter"),
      wander: () => sent.push("wander"),
      wand: () => sent.push("wand"),
      bubbles: () => sent.push("bubbles"),
      leaves: () => sent.push("leaves"),
      follow: () => sent.push("follow"),
      rps: (sign) => sent.push(`rps:${sign}`),
      box: () => sent.push("box"),
      laser: () => sent.push("laser"),
      brush: () => sent.push("brush"),
      catnip: () => sent.push("catnip"),
      plane: () => sent.push("plane"),
      bird: () => sent.push("bird"),
      growth: () => sent.push("growth"),
      scratch: () => sent.push("scratch"),
      bell: () => sent.push("bell"),
      mouse: () => sent.push("mouse"),
      mole: () => sent.push("mole"),
      hug: () => sent.push("hug"),
      rain: () => sent.push("rain"),
      quests: () => sent.push("quests"),
      diary: () => sent.push("diary"),
    });
    for (const child of items.find((i) => i.label === "给她打扮")!.submenu!) child.action?.();
    items.find((i) => i.label === "放只小虫逗逗她")!.action?.();
    items.find((i) => i.label === "陪她散散步")!.action?.();
    for (const label of [
      "挥挥逗猫棒", "吹一串泡泡", "撒一把落叶", "跟我来",
      "纸箱躲猫猫", "照个红点点", "给她梳梳毛", "闻闻猫薄荷", "放架纸飞机", "请小鸟来做客",
      "磨磨爪子", "滚个铃铛球", "放只发条鼠", "来局打地鼠", "抱一下", "下场小雨",
      "成长记录", "今日小目标", "猫咪日记",
    ]) {
      items.find((i) => i.label === label)!.action?.();
    }
    for (const child of items.find((i) => i.label === "猜拳")!.submenu!) child.action?.();
    expect(sent).toEqual([
      "accessory:none", "accessory:bell", "accessory:bow",
      "accessory:scarf", "accessory:flower", "accessory:star",
      "summon-critter", "wander",
      "wand", "bubbles", "leaves", "follow",
      "box", "laser", "brush", "catnip", "plane", "bird",
      "scratch", "bell", "mouse", "mole", "hug", "rain",
      "growth", "quests", "diary",
      "rps:rock", "rps:scissors", "rps:paper",
    ]);
  });

  it("手势子菜单七条，命令与手势同名", () => {
    const sent: string[] = [];
    const items = buildPetMenuItems(input({ form: "girl" }), { gesture: (cmd) => sent.push(cmd) });
    const submenu = items.find((i) => i.label === "让它做个动作")!.submenu!;
    expect(submenu.map((i) => i.label)).toEqual([
      "招招手", "跳一下", "鼓鼓掌", "鞠个躬", "点点头", "歪歪头", "伸个懒腰",
    ]);
    for (const child of submenu) child.action?.();
    expect(sent).toEqual(["wave", "hop", "clap", "bow", "nod", "tilt", "stretch"]);
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
