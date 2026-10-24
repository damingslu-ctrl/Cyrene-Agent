import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readVergeState, writeVergeState, VERGE_STATE_FILE } from "./verge-store";

const dirs: string[] = [];
function freshDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "verge-state-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("verge-store", () => {
  it("首次读取没有文件时给默认状态（藏身默认开，同 native）", () => {
    const state = readVergeState(freshDir());
    expect(state).toEqual({ quietUntil: null, tuckEnabled: true, tuckHinted: false, form: "girl", tier: "large" });
  });

  it("写盘落在 userData/verge/state.json 且能被读回", () => {
    const dir = freshDir();
    writeVergeState(dir, { quietUntil: 1234, tuckEnabled: false, tuckHinted: true, form: "cat", tier: "standard" });
    expect(VERGE_STATE_FILE).toBe(path.join("verge", "state.json"));
    expect(readVergeState(dir)).toEqual({ quietUntil: 1234, tuckEnabled: false, tuckHinted: true, form: "cat", tier: "standard" });
  });

  it("正对照：坏 JSON 不炸启动，退回默认值（读盘自愈）", () => {
    const dir = freshDir();
    writeVergeState(dir, { quietUntil: 1, tuckEnabled: true, tuckHinted: false, form: "cat", tier: "standard" });
    appendFileSync(path.join(dir, VERGE_STATE_FILE), "{ 这不是 JSON");
    expect(readVergeState(dir).tuckEnabled).toBe(true);
  });

  it("quietUntil 必须是数字，脏值一律当 null（免打扰不许被一个字符串永久钉住）", () => {
    const dir = freshDir();
    writeVergeState(dir, { quietUntil: null, tuckEnabled: true, tuckHinted: false, form: "cat", tier: "standard" });
    writeFileSync(path.join(dir, VERGE_STATE_FILE), JSON.stringify({ quietUntil: "forever" }));
    expect(readVergeState(dir).quietUntil).toBeNull();
  });
});
