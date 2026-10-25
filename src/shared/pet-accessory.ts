/**
 * 猫娘装扮的**共享**词表：渲染端画、主进程菜单发命令，两边都必须认识同一组 id。
 * 这里只放 id 与用户词，不放画法（画法在 renderer/pet/girl-accessory.ts）。
 */
export const ACCESSORY_IDS = ["none", "bell", "bow", "scarf", "flower", "star"] as const;
export type AccessoryId = (typeof ACCESSORY_IDS)[number];

export interface AccessoryEntry {
  id: AccessoryId;
  name: string;
}

export const ACCESSORIES: readonly AccessoryEntry[] = [
  { id: "none", name: "不戴" },
  { id: "bell", name: "铃铛项圈" },
  { id: "bow", name: "蝴蝶结" },
  { id: "scarf", name: "小围巾" },
  { id: "flower", name: "耳边小花" },
  { id: "star", name: "星星发夹" },
] as const;

/** 坏存档/坏命令一律回「不戴」：宁可素着，也不能让 UI 读到 undefined。 */
export function normalizeAccessory(value: unknown): AccessoryId {
  return typeof value === "string" && (ACCESSORY_IDS as readonly string[]).includes(value)
    ? (value as AccessoryId)
    : "none";
}
