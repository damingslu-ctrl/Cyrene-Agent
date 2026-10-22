import { describe, expect, it } from "vitest";
import { ASSISTANT_LATIN, ASSISTANT_NICKNAME, CAT_ROSTER, LEGACY_CHARACTER_MAP } from "./cat-roster";
import { TASK_CHARACTERS } from "../main/tasks/task-character-pool";

describe("猫伴名册", () => {
  it("正好 12 只，昵称/拉丁名/旧名映射三处都不重不漏", () => {
    expect(CAT_ROSTER).toHaveLength(12);
    const cn = CAT_ROSTER.map((c) => c.nickname);
    const en = CAT_ROSTER.map((c) => c.latin);
    expect(new Set(cn).size).toBe(12);
    expect(new Set(en).size).toBe(12);
    expect(cn).not.toContain(ASSISTANT_NICKNAME); // 助手不在这 12 只里，它是第 13 只
    expect(Object.keys(LEGACY_CHARACTER_MAP)).toHaveLength(12);
    expect([...new Set(Object.values(LEGACY_CHARACTER_MAP))].sort()).toEqual([...cn].sort());
  });

  it("花色只有五档，靠姿态而不是靠新色板拉开差异", () => {
    const coats = new Set(CAT_ROSTER.map((c) => c.coat));
    expect([...coats].sort()).toEqual(["azure", "gray", "ink", "paper", "rose"]);
    const poseKeys = CAT_ROSTER.map((c) => `${c.coat}/${c.pose}`);
    expect(new Set(poseKeys).size).toBe(12); // 同花色必须换姿态
  });

  it("委托池与名册同源：池里每个昵称都带得出 `<昵称>.png` 这个资产键", () => {
    expect(TASK_CHARACTERS.map((c) => c.nickname)).toEqual(CAT_ROSTER.map((c) => c.nickname));
    for (const c of TASK_CHARACTERS) expect(c.assetFileName).toBe(`${c.nickname}.png`);
  });

  it("上游人物身份词一个都不许留在名册里", () => {
    const banned = [
      "黄金裔", "昔涟", "星穹", "崩坏", "昏光庭院", "神悟树庭", "泰坦", "丹恒",
      "Hyacine", "Aglaea", " Cipher", "Dan Heng",
    ];
    const blob = JSON.stringify(CAT_ROSTER) + ASSISTANT_NICKNAME + ASSISTANT_LATIN;
    for (const word of banned) expect(blob, `名册里出现了 ${word}`).not.toContain(word);
  });
});
