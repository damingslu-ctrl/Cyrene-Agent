import { describe, expect, it } from "vitest";
import {
  DARK_TOKENS, LIGHT_TOKENS, TOKENS_BY_SCHEME, WINDOW_BACKGROUNDS, contrastRatio, derivedValue,
} from "./palette-from-cat";
import { CAT_PALETTE, wash } from "./pet-tokens";

const HEX = /#[0-9a-f]{6}/g;
// 上游品牌时代的色：粉主色、紫端点、材料粉。改名不改值、或漏改某档，就会留下这些。
const BANNED = [/#ff5b8a/i, /#f04b7c/i, /#ec4899/i, /#db2777/i, /#be185d/i, /#9f7aea/i,
  /#b794f4/i, /#7c5fcc/i, /#e91e63/i, /#f88fbc/i, /#ff6ec7/i, /#ff7aa0/i, /#ff9fbd/i];

describe("配色派生器", () => {
  it("两把令牌表键集完全相同（换档不许增减令牌）", () => {
    expect(Object.keys(LIGHT_TOKENS).sort()).toEqual(Object.keys(DARK_TOKENS).sort());
  });

  it("derivedValue 对未派生的令牌抛错，而不是返回 undefined", () => {
    expect(() => derivedValue("light", "--rb-没有这个令牌")).toThrow(/未派生/);
    expect(derivedValue("light", "--rb-accent")).toBe(LIGHT_TOKENS["--rb-accent"]);
  });

  it("每一个 hex 都是合法 6 位小写（`hex()` 的往返结果，不是手抄的大写或 3 位缩写）", () => {
    for (const map of [LIGHT_TOKENS, DARK_TOKENS]) {
      for (const [name, value] of Object.entries(map)) {
        for (const h of value.match(HEX) ?? []) expect(h, name).toBe(h.toLowerCase());
        // 正对照：这张表里确实有裸 hex；若某次改动把全表变成 var()，上面的循环会空过。
      }
      expect(Object.values(map).join(" ").match(HEX)!.length).toBeGreaterThan(40);
    }
  });

  it("没有一处残留上游品牌粉/紫", () => {
    for (const map of [LIGHT_TOKENS, DARK_TOKENS]) {
      for (const [name, value] of Object.entries(map)) {
        for (const re of BANNED) expect(re.test(value), `${name} = ${value}`).toBe(false);
      }
    }
  });

  it("正文压在页底/工作区/浮起底上的对比度都不低于 4.5", () => {
    for (const scheme of ["light", "dark"] as const) {
      const t = TOKENS_BY_SCHEME[scheme];
      for (const base of ["--rb-surface-page", "--rb-surface-workspace", "--rb-surface-elevated"]) {
        expect(contrastRatio(t["--rb-text-primary"], t[base]), `${scheme} ${base}`)
          .toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("次级文字在浮起底上不低于 3:1（图形/次级信息门槛）", () => {
    for (const scheme of ["light", "dark"] as const) {
      const t = TOKENS_BY_SCHEME[scheme];
      expect(contrastRatio(t["--rb-text-secondary"], t["--rb-surface-elevated"]))
        .toBeGreaterThanOrEqual(3);
    }
  });

  it("令牌表里凡是写成裸 hex 的成品色，都必须能在猫色板上找到（预混结果除外由 Task 16 复算）", () => {
    const board = new Set(
      Object.values(CAT_PALETTE).filter((v): v is string => typeof v === "string"),
    );
    // 这一条只查「裸值」档（值里只有一个 hex 的令牌）：它们必须是板内色。
    // 多 hex 的值（gradient/shadow）与 rgba 由 Task 16 的完整锁按算式复算。
    // ⚠️ 与 brief 文本唯一的偏差（理由与实测数字见 task-14-report.md）：`wash()` 的返回值
    // 本身就是一个裸 hex，所以「值里只有一个 hex」并不能推出「它是板内色」——实测 104 个令牌里
    // light 49 + dark 32 = 81 个是板外裸 hex，逐个复算后**全部**是 wash 的预混结果，发明色 0 个。
    // 本条的「除外」口径由它自己的括号写明（预混结果除外），按值形状区分不开板内色与预混色，
    // 所以这里把「除外」实现为**可复算**：合法集 = 板内色 ∪ wash(板内色|WHITE, 0..255, 板内色|WHITE)。
    // 拼不出来的裸 hex 照样红，锁住的仍是规矩 1「不发明新色」；没有放松任何阈值。
    const legal = new Set(board);
    const inputs = [...board, "#ffffff"];
    for (const fg of inputs) for (const bg of inputs) for (let a = 0; a <= 255; a++) legal.add(wash(fg, a, bg));
    for (const scheme of ["light", "dark"] as const) {
      for (const [name, value] of Object.entries(TOKENS_BY_SCHEME[scheme])) {
        const bare = /^#[0-9a-f]{6}$/.exec(value);
        if (!bare) continue;
        expect(legal.has(value), `${scheme} ${name} = ${value}`).toBe(true);
      }
    }
  });

  it("文字色不许等于它要压的底色（防止 on-accent 被推成 accent 本身）", () => {
    for (const scheme of ["light", "dark"] as const) {
      const t = TOKENS_BY_SCHEME[scheme];
      expect(t["--rb-text-on-accent"]).not.toBe(t["--rb-accent"]);
      expect(t["--rb-accent-hover"]).not.toBe(t["--rb-accent"]);
      expect(t["--rb-border-focus"]).toBe(t["--rb-accent"]);
    }
  });

  it("原生窗底色取的是页底令牌而不是工作区，且是合法 #rrggbb", () => {
    expect(WINDOW_BACKGROUNDS["pearl-white"]).toBe(LIGHT_TOKENS["--rb-surface-page"]);
    expect(WINDOW_BACKGROUNDS["charcoal-pink"]).toBe(DARK_TOKENS["--rb-surface-page"]);
    for (const v of Object.values(WINDOW_BACKGROUNDS)) expect(v).toMatch(/^#[0-9a-f]{6}$/);
  });
});
