import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
    expect(state).toEqual({
      quietUntil: null, tuckEnabled: true, tuckHinted: false, sfxEnabled: true, form: "girl", tier: "large",
    });
  });

  it("写盘落在 userData/verge/state.json 且能被读回", () => {
    const dir = freshDir();
    writeVergeState(dir, {
      quietUntil: 1234, tuckEnabled: false, tuckHinted: true, sfxEnabled: false, form: "cat", tier: "standard",
    });
    expect(VERGE_STATE_FILE).toBe(path.join("verge", "state.json"));
    expect(readVergeState(dir)).toEqual({
      quietUntil: 1234, tuckEnabled: false, tuckHinted: true, sfxEnabled: false, form: "cat", tier: "standard",
    });
  });

  it("正对照：坏 JSON 不炸启动，退回默认值（读盘自愈）", () => {
    const dir = freshDir();
    writeVergeState(dir, {
      quietUntil: 1, tuckEnabled: true, tuckHinted: false, sfxEnabled: true, form: "cat", tier: "standard",
    });
    appendFileSync(path.join(dir, VERGE_STATE_FILE), "{ 这不是 JSON");
    expect(readVergeState(dir).tuckEnabled).toBe(true);
  });

  it("quietUntil 必须是数字，脏值一律当 null（免打扰不许被一个字符串永久钉住）", () => {
    const dir = freshDir();
    writeVergeState(dir, {
      quietUntil: null, tuckEnabled: true, tuckHinted: false, sfxEnabled: true, form: "cat", tier: "standard",
    });
    writeFileSync(path.join(dir, VERGE_STATE_FILE), JSON.stringify({ quietUntil: "forever" }));
    expect(readVergeState(dir).quietUntil).toBeNull();
  });

  it("v1.18 sfxEnabled：存量盘里没这个键就当 true（默认有声），脏值同样回 true", () => {
    const dir = freshDir();
    mkdirSync(path.join(dir, "verge"), { recursive: true });
    // v1.17 及以前的盘：整块 JSON 里没有 sfxEnabled。升级后必须能响，不能静默变哑。
    writeFileSync(path.join(dir, VERGE_STATE_FILE), JSON.stringify({ tuckEnabled: true, form: "girl", tier: "large" }));
    expect(readVergeState(dir).sfxEnabled).toBe(true);
    for (const junk of ["true", 1, null, {}, []]) {
      writeFileSync(path.join(dir, VERGE_STATE_FILE), JSON.stringify({ sfxEnabled: junk }));
      expect(readVergeState(dir).sfxEnabled, JSON.stringify(junk)).toBe(true);
    }
    // 显式 false 是唯一能把声音关掉的样子。
    writeFileSync(path.join(dir, VERGE_STATE_FILE), JSON.stringify({ sfxEnabled: false }));
    expect(readVergeState(dir).sfxEnabled).toBe(false);
  });
});
