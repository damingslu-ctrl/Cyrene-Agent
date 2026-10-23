/**
 * API Key 的校验与脱敏展示（与 `shared/search-engines.ts` 同层的事实源）。
 *
 * 为什么住在 shared：这段判据原先只有联网搜索在用（`search-backend-filter.ts`），
 * 高德那条链路要做同一件事——用户从网页控制台复制 Key 时最常踩的就是全角引号、
 * 零宽空格和尾随换行，三种凭据的失败形态一模一样。各写一份的话，改一处宽松了
 * 另一处还严着，用户只会看到「同一个 Key 这边能用那边不能用」。
 */

export interface KeyValidationResult {
  valid: boolean;
  normalized: string;
  error?: string;
  /** 只含元数据，永不含 Key 本身。 */
  diagnostics: { length: number; trimmed: boolean; hasNonAscii: boolean; hasControlChars: boolean };
}

/**
 * 校验凭据是否可安全发出。不泄漏原始 Key，只返回脱敏诊断。
 * `label` 只用来拼错误话术（如「MiniMax API Key」「高德 Key」）。
 */
export function validateApiKey(rawKey: string, label: string): KeyValidationResult {
  const originalLength = rawKey.length;
  const normalized = rawKey.trim();
  const trimmed = normalized.length !== originalLength;
  const hasNonAscii = /[^\x20-\x7E]/.test(normalized);
  const hasControlChars = /[\x00-\x1F\x7F]/.test(normalized);
  const diagnostics = { length: normalized.length, trimmed, hasNonAscii, hasControlChars };

  if (normalized.length === 0) {
    return { valid: false, normalized: "", error: `${label}不能为空`, diagnostics };
  }
  if (hasControlChars) {
    return { valid: false, normalized: "", error: `${label}包含控制字符，请重新输入`, diagnostics };
  }
  if (hasNonAscii) {
    return { valid: false, normalized: "", error: `${label}包含非 ASCII 字符，请确认是否复制了多余内容`, diagnostics };
  }
  return { valid: true, normalized, diagnostics };
}

/**
 * 用于日志/回执的 Key 指纹：最多露出前 4 字符，其余只报长度。
 * 短于 8 字符整体打码——那种长度下「露前 4」等于露出一半。
 */
export function maskApiKey(rawKey: string): string {
  const key = rawKey.trim();
  if (key.length <= 8) return `***(${key.length})`;
  return `${key.slice(0, 4)}…(${key.length})`;
}
