import type { CoatName } from "./cat-coats";
// R-D13：shared 只认 cat-types；从 ./cat-variants 取会把 art.ts → ops.ts 的 DOM 类型拉进 tsconfig.main
import type { PoseName } from "./cat-types";

export interface CatMember {
  nickname: string; // 用户可见 + 资产文件名键（`<nickname>.png`），一次改动全仓跟它走
  latin: string; // en/ja 语言壳里的罗马字
  coat: CoatName; // Task 20 五档
  pose: PoseName; // Task 21 十二档之一（`tast/<猫>.png` 的立绘姿态）
  personaSeed: string; // 人格卡的一句话种子（Task 23 Step 5 写 md 时喂给它）
}

export const ASSISTANT_NICKNAME = "麻糬";
export const ASSISTANT_LATIN = "Mochi";
export const TEAM_LABEL = "猫伴";

export const CAT_ROSTER: readonly CatMember[] = [
  { nickname: "年糕", latin: "Niangao", coat: "paper", pose: "sit", personaSeed: "团得最紧的那只，认死理，先把一件事做完再抬头" },
  { nickname: "豆花", latin: "Douhua", coat: "paper", pose: "lie", personaSeed: "软得摊成一片，什么都行，但会悄悄把窗户留给你" },
  { nickname: "汤圆", latin: "Tangyuan", coat: "gray", pose: "prone", personaSeed: "滚来滚去的慢性子，找东西靠鼻子不靠脑子" },
  { nickname: "布丁", latin: "Buding", coat: "azure", pose: "peek", personaSeed: "抖三抖才敢上桌，好奇心全压在嘴角" },
  { nickname: "抹茶", latin: "Mocha", coat: "gray", pose: "wash", personaSeed: "一天洗六遍脸，规矩比猫生重要" },
  { nickname: "可可", latin: "Keke", coat: "ink", pose: "stretch", personaSeed: "深色那只，伸懒腰能伸到打呵欠，白天睡得晚上精神" },
  { nickname: "芝麻", latin: "Zhima", coat: "ink", pose: "yawn", personaSeed: "点位最碎的一只，嘴上永远在打哈欠，耳朵一直开着" },
  { nickname: "栗子", latin: "Lizi", coat: "rose", pose: "tilt", personaSeed: "歪头频率最高，你以为它在卖萌，其实它在算你还有几分钟" },
  { nickname: "海苔", latin: "Haitai", coat: "azure", pose: "sleep", personaSeed: "脆的那只，一有动静就装睡，装得最像" },
  { nickname: "棉花", latin: "Mianhua", coat: "paper", pose: "puff", personaSeed: "炸毛就是一整朵云，虚张声势，先替你把门关好" },
  { nickname: "鱼丸", latin: "Yuwan", coat: "rose", pose: "pout", personaSeed: "嘴上挂着委屈，实际最会办事，办完还要你摸两下" },
  { nickname: "奶盖", latin: "Naigai", coat: "rose", pose: "happy", personaSeed: "浮在最上面那只，永远开心，负责把气氛抬起来" },
] as const;

/** 旧角色名 → 新猫名。只用于日志、`LEGACY` 兜底和提交正文，**绝不进资产查找**。 */
export const LEGACY_CHARACTER_MAP: Readonly<Record<string, string>> = {
  "风堇": "年糕", "刻律德菈": "豆花", "长夜月": "汤圆", "遐蝶": "布丁",
  "缇宝": "抹茶", "阿格莱雅": "可可", "白厄": "芝麻", "丹恒": "栗子",
  "海瑟音": "海苔", "那刻夏": "棉花", "赛飞儿": "鱼丸", "万敌": "奶盖",
};
