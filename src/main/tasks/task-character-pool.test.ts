import { describe, expect, it } from "vitest";
import { TaskCharacterLeasePool, buildGoldenDescendantsPrompt, getGoldenDescendantNames } from "./task-character-pool";

describe("TaskCharacterLeasePool", () => {
  it("exports one canonical companion list for prompts and tool schemas", () => {
    expect(getGoldenDescendantNames()).toEqual(expect.arrayContaining(["年糕", "奶盖"]));
    expect(buildGoldenDescendantsPrompt()).toContain("猫伴");
    expect(buildGoldenDescendantsPrompt()).toContain("年糕");
  });
  it("leases the companion explicitly selected by the model", () => {
    const pool = new TaskCharacterLeasePool();
    const lease = pool.acquire("chat-a", "年糕");

    expect(lease).toMatchObject({ nickname: "年糕", assetFileName: "年糕.png" });
  });

  it("rejects an unknown or already busy companion in the same conversation", () => {
    const pool = new TaskCharacterLeasePool();
    pool.acquire("chat-a", "年糕");

    expect(() => pool.acquire("chat-a", "年糕")).toThrow("TASK_COMPANION_BUSY");
    expect(() => pool.acquire("chat-a", "未知角色")).toThrow("TASK_COMPANION_UNKNOWN");
  });

  it("releases an explicit lease idempotently", () => {
    const pool = new TaskCharacterLeasePool();
    const lease = pool.acquire("chat-a", "年糕");
    lease.release();
    lease.release();

    expect(pool.acquire("chat-a", "年糕").nickname).toBe("年糕");
  });
});
