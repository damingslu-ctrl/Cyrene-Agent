import type { CoatName } from "./cat-coats";
import type { Mood, PoseName } from "./cat-types";

export interface CatSticker { id: string; coat: CoatName; pose: PoseName; mood: Mood }

/** 512² —— R-D1：选择器预览 360×270、消息流 160px，2× 屏下都够 */
export const STICKER_SIZE = 512;

/**
 * 52 条与 `BUILT_IN_STICKER_IDS` 同序同 id；`sticker-catalog.test.ts` 锁顺序。
 * 每条都是 (coat, pose, mood) 唯一三元组——重复就是两张图长得一样，测试会红。
 * 选型原则：情绪靠 pose + mood 表达，coat 只做区分度，不承担语义（猫是同一只）。
 */
export const CAT_STICKERS: readonly CatSticker[] = [
  { id: "playful",          coat: "rose",  pose: "peek",    mood: "happy" },
  { id: "love-happy",       coat: "rose",  pose: "happy",   mood: "happy" },
  { id: "confident",        coat: "azure", pose: "sit",     mood: "happy" },
  { id: "serious",          coat: "ink",   pose: "sit",     mood: "idle" },
  { id: "calm",             coat: "paper", pose: "lie",     mood: "idle" },
  { id: "peek",             coat: "gray",  pose: "peek",    mood: "idle" },
  { id: "clingy-confused",  coat: "rose",  pose: "tilt",    mood: "thinking" },
  { id: "love-calm",        coat: "paper", pose: "sit",     mood: "happy" },
  { id: "HI",               coat: "gray",  pose: "sit",     mood: "happy" },
  { id: "hello",            coat: "paper", pose: "peek",    mood: "happy" },
  { id: "goodmoring1",      coat: "paper", pose: "stretch", mood: "sleep" },
  { id: "goodnight",        coat: "azure", pose: "sleep",   mood: "sleep" },
  { id: "teatime",          coat: "rose",  pose: "prone",   mood: "happy" },
  { id: "eating",           coat: "ink",   pose: "sit",     mood: "happy" },
  { id: "Allset",           coat: "azure", pose: "stretch", mood: "happy" },
  { id: "OK",               coat: "paper", pose: "sit",     mood: "idle" },
  { id: "copythat",         coat: "gray",  pose: "sit",     mood: "idle" },
  { id: "Thumbsup",         coat: "paper", pose: "stretch", mood: "happy" },
  { id: "awesome",          coat: "azure", pose: "happy",   mood: "happy" },
  { id: "sogood",           coat: "paper", pose: "happy",   mood: "happy" },
  { id: "sonice",           coat: "gray",  pose: "stretch", mood: "happy" },
  { id: "fighting",         coat: "rose",  pose: "puff",    mood: "happy" },
  { id: "hellyeah",         coat: "ink",   pose: "puff",    mood: "happy" },
  { id: "Thanks",           coat: "rose",  pose: "sit",     mood: "happy" },
  { id: "foryou",           coat: "ink",   pose: "happy",   mood: "happy" },
  { id: "blushhard",        coat: "azure", pose: "peek",    mood: "happy" },
  { id: "shyshort",         coat: "rose",  pose: "peek",    mood: "idle" },
  { id: "hmph",             coat: "ink",   pose: "pout",    mood: "grumpy" },
  { id: "hugtight",         coat: "paper", pose: "prone",   mood: "happy" },
  { id: "Airkiss",          coat: "rose",  pose: "tilt",    mood: "happy" },
  { id: "Gigglelots",       coat: "gray",  pose: "prone",   mood: "happy" },
  { id: "thinking",         coat: "azure", pose: "tilt",    mood: "thinking" },
  { id: "putmd",            coat: "gray",  pose: "pout",    mood: "grumpy" },
  { id: "Whatswrong",       coat: "paper", pose: "tilt",    mood: "thinking" },
  { id: "midmeh",           coat: "gray",  pose: "lie",     mood: "idle" },
  { id: "awkward",          coat: "ink",   pose: "tilt",    mood: "thinking" },
  { id: "Madnow",           coat: "rose",  pose: "puff",    mood: "grumpy" },
  { id: "Hurtcry",          coat: "paper", pose: "lie",     mood: "sleep" },
  { id: "Sobbinghard",      coat: "rose",  pose: "lie",     mood: "sleep" },
  { id: "weeploud",         coat: "gray",  pose: "prone",   mood: "sleep" },
  { id: "PanincCrying",     coat: "rose",  pose: "prone",   mood: "sleep" },
  { id: "missme",           coat: "gray",  pose: "peek",    mood: "happy" },
  { id: "Free",             coat: "rose",  pose: "stretch", mood: "happy" },
  { id: "Dreak",            coat: "ink",   pose: "lie",     mood: "sleep" },
  { id: "outfast",          coat: "ink",   pose: "stretch", mood: "happy" },
  { id: "Vcayover",         coat: "azure", pose: "lie",     mood: "grumpy" },
  { id: "sleepynow",        coat: "paper", pose: "sleep",   mood: "sleep" },
  { id: "deadtired",        coat: "paper", pose: "prone",   mood: "sleep" },
  { id: "sotired",          coat: "gray",  pose: "lie",     mood: "sleep" },
  { id: "giveup",           coat: "ink",   pose: "prone",   mood: "sleep" },
  { id: "poorwallet",       coat: "paper", pose: "pout",    mood: "grumpy" },
  { id: "please",           coat: "azure", pose: "tilt",    mood: "happy" },
];
