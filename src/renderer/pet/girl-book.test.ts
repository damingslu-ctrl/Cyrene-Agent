import { describe, expect, it } from "vitest";
import {
  BOOK_MS,
  BOOK_PAGES,
  BOOK_SETTLE_MS,
  BOOK_TURN_COOLDOWN_MS,
  bookAlive,
  bookAtPoint,
  bookPhase,
  bookRectFor,
  buildBookOps,
  createBook,
  turnPage,
} from "./girl-book";

const FACE = { cx: 41, top: 22, bottom: 56, w: 46, h: 34 };
const FLOOR = 84;

function finite(ops: ReturnType<typeof buildBookOps>): boolean {
  for (const op of ops) {
    for (const [key, value] of Object.entries(op)) {
      if (key === "kind" || key === "fill" || key === "stroke") continue;
      if (typeof value === "number" && !Number.isFinite(value)) return false;
      if (Array.isArray(value) && value.some((p) => p.some((n: number) => !Number.isFinite(n)))) return false;
    }
  }
  return true;
}

describe("看书", () => {
  it("时间表：摊开 → 阅读 → 收走", () => {
    const s = createBook(0, 0.3);
    expect(bookPhase(s, 0)).toBe("settle");
    expect(bookPhase(s, BOOK_SETTLE_MS - 1)).toBe("settle");
    expect(bookPhase(s, BOOK_SETTLE_MS)).toBe("read");
    expect(bookAlive(s, BOOK_MS - 1)).toBe(true);
    expect(bookAlive(s, BOOK_MS)).toBe(false);
  });

  it("书摊在她胸前，宽高都在窗内", () => {
    const s = createBook(0, 0.2);
    const rect = bookRectFor(s, 1_500, FACE);
    expect(rect.w).toBeGreaterThanOrEqual(26);
    expect(rect.w).toBeLessThanOrEqual(40);
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.w).toBeLessThanOrEqual(82);
    expect(rect.y).toBeGreaterThan(FACE.top);
    expect(rect.y + rect.h).toBeLessThanOrEqual(FLOOR);
  });

  it("点书翻页：铺垫期不认、有冷却、三页翻完不再翻", () => {
    const s = createBook(0, 0.1);
    expect(turnPage(s, 200)).toBe(false);
    expect(turnPage(s, 1_000)).toBe(true);
    expect(turnPage(s, 1_000 + BOOK_TURN_COOLDOWN_MS - 1)).toBe(false);
    expect(turnPage(s, 1_000 + BOOK_TURN_COOLDOWN_MS)).toBe(true);
    expect(turnPage(s, 1_600 + BOOK_TURN_COOLDOWN_MS)).toBe(true);
    expect(s.page).toBe(BOOK_PAGES);
    expect(turnPage(s, 2_200 + BOOK_TURN_COOLDOWN_MS)).toBe(false);
  });

  it("点书命中书本矩形；书外点不到", () => {
    const s = createBook(0, 0.1);
    const rect = bookRectFor(s, 1_200, FACE);
    expect(bookAtPoint(s, 1_200, FACE, rect.x + rect.w / 2, rect.y + rect.h / 2)).toBe(true);
    expect(bookAtPoint(s, 1_200, FACE, rect.x - 30, rect.y)).toBe(false);
    expect(bookAtPoint(s, 200, FACE, rect.x + rect.w / 2, rect.y + rect.h / 2)).toBe(false);
  });

  it("画法：摊开的书页、书脊与字行；坐标全有限，收走后清空", () => {
    const s = createBook(0, 0.4);
    turnPage(s, 1_000);
    const ops = buildBookOps(s, 1_200, FACE);
    expect(ops.filter((op) => op.kind === "fillRoundRect").length).toBeGreaterThanOrEqual(2);
    expect(ops.filter((op) => op.kind === "strokePath").length).toBeGreaterThanOrEqual(3);
    expect(finite(ops)).toBe(true);
    expect(buildBookOps(s, BOOK_MS, FACE)).toEqual([]);
  });
});
