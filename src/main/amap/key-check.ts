// ── 高德 Key 自检（设置页「测试」按钮的唯一实现）─────────────
//
// 只在主进程里打一次真实请求：`/v3/config/district` 是天气与出行两条链路共同的
// 第一个调用，验通它就说明 Key 有效、确实是「Web 服务」类型、IP 白名单与当日
// 配额都还够。错误话术由 client 的 describeAmapError 统一翻译并脱敏，返回体里
// 永远不含 Key 原文——设置页要展示这句话，脱敏不能靠调用方自觉。
import { amapGet, amapList, amapText } from "./client";

export interface AmapKeyCheckResult {
  ok: boolean;
  latency: number;
  /** 通过时回一条解析到的行政区名，证明请求真的打通了；不含 Key。 */
  sample?: string;
  /** 失败时回人能看懂的一句话（已脱敏）；不含 Key。 */
  error?: string;
}

export async function checkAmapKey(key: string): Promise<AmapKeyCheckResult> {
  const start = Date.now();
  const result = await amapGet<{ districts?: unknown }>(
    "/v3/config/district",
    { keywords: "北京", subdistrict: 0 },
    key,
  );
  const latency = Date.now() - start;
  if (!result.ok) return { ok: false, latency, error: result.error };
  const sample = amapText(amapList<{ name?: unknown }>(result.data.districts)[0]?.name);
  return sample ? { ok: true, latency, sample } : { ok: true, latency };
}
