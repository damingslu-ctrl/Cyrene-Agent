// 凭据校验与脱敏指纹的行为锁。联网搜索与高德两条链路共用这一份判据，
// 所以这里的用例同时是「同一个 Key 在这两边得到同一个结论」的保证。

import { describe, expect, it } from "vitest";
import { maskApiKey, validateApiKey } from "./api-key";

// ── 校验 ────────────────────────────────

describe("validateApiKey", () => {
  it("accepts a valid ASCII key", () => {
    const result = validateApiKey("sk-abc123XYZ", "Test Key");
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe("sk-abc123XYZ");
    expect(result.diagnostics.hasNonAscii).toBe(false);
    expect(result.diagnostics.hasControlChars).toBe(false);
  });

  it("trims whitespace", () => {
    const result = validateApiKey("  sk-abc123  ", "Test Key");
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe("sk-abc123");
    expect(result.diagnostics.trimmed).toBe(true);
  });

  it("rejects empty key", () => {
    const result = validateApiKey("", "Test Key");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("不能为空");
  });

  it("rejects whitespace-only key", () => {
    const result = validateApiKey("   ", "Test Key");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("不能为空");
    expect(result.diagnostics.trimmed).toBe(true);
  });

  it("rejects non-ASCII characters", () => {
    const result = validateApiKey("sk-abc中文123", "Test Key");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("非 ASCII");
    expect(result.diagnostics.hasNonAscii).toBe(true);
  });

  it("rejects smart quotes", () => {
    const result = validateApiKey("sk-abc\u201C123", "Test Key");
    expect(result.valid).toBe(false);
    expect(result.diagnostics.hasNonAscii).toBe(true);
  });

  it("rejects control characters", () => {
    const result = validateApiKey("sk-abc\x00123", "Test Key");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("控制字符");
    expect(result.diagnostics.hasControlChars).toBe(true);
  });

  it("rejects newline in key", () => {
    const result = validateApiKey("sk-abc\n123", "Test Key");
    expect(result.valid).toBe(false);
    expect(result.diagnostics.hasControlChars).toBe(true);
  });

  it("rejects tab in key", () => {
    const result = validateApiKey("sk-abc\t123", "Test Key");
    expect(result.valid).toBe(false);
    expect(result.diagnostics.hasControlChars).toBe(true);
  });

  it("diagnostics never contain the raw key", () => {
    const result = validateApiKey("sk-supersecretkey123", "Test Key");
    const diagnosticsSerialized = JSON.stringify(result.diagnostics);
    expect(diagnosticsSerialized).not.toContain("supersecretkey123");
    // diagnostics only have metadata, not the key itself
    expect(result.diagnostics.length).toBe(20);
    expect(result.diagnostics.hasNonAscii).toBe(false);
  });

  it("reports correct length after trim", () => {
    const result = validateApiKey("  abc  ", "Test Key");
    expect(result.diagnostics.length).toBe(3);
  });

  it("error text names the provider but never the key", () => {
    const result = validateApiKey("中文key", "高德 Key");
    expect(result.error).toContain("高德 Key");
    expect(result.error).not.toContain("中文key");
  });
});

// ── 脱敏指纹 ────────────────────────────

describe("maskApiKey", () => {
  it("只露出前 4 字符并报长度", () => {
    const amapKey = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
    expect(maskApiKey(amapKey)).toBe("a1b2…(32)");
  });

  it("绝不复现完整 Key", () => {
    const key = "abcdefghijklmnopqrstuvwxyz0123456789";
    const masked = maskApiKey(key);
    expect(masked).not.toContain(key);
    expect(key.startsWith(masked.slice(0, 4))).toBe(true);
    // 露出的部分不超过 4 字符，其余全是省略号与长度
    expect(masked.slice(0, 4).length).toBe(4);
    expect(masked).not.toContain(key.slice(4));
  });

  it("短 Key 整体打码，不露出一半", () => {
    expect(maskApiKey("12345678")).toBe("***(8)");
    expect(maskApiKey("ab")).toBe("***(2)");
    expect(maskApiKey("")).toBe("***(0)");
  });

  it("先 trim 再算长度", () => {
    expect(maskApiKey("  a1b2c3d4e5f6  ")).toBe("a1b2…(12)");
  });
});
