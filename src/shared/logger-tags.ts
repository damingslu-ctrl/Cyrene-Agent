/**
 * Canonical tag names used by the logger.
 *
 * Tags are 16-character columns. If a new tag exceeds that, it gets truncated
 * in log output, so keep names short.
 *
 * 列里所有标签都是 PascalCase（`padTag` 只做 16 字符截断/补空格，不改变大小写），
 * 所以品牌标签的**键名**跟着兄弟项走 PascalCase（`Brand`），**值**由 `BRAND.logPrefix`
 * 单点决定——它是 `"Mochi"`，不是小写的 `"mochi"`，否则这一列会与其余 24 个标签错位。
 */
import { BRAND } from "./brand";

export const LogTag = {
  Runtime: "Runtime",
  Electron: "Electron",
  BuiltinTools: "BuiltinTools",
  FsTools: "FsTools",
  LifeTools: "LifeTools",
  TravelTools: "TravelTools",
  EmailTools: "EmailTools",
  Skills: "Skills",
  SkillTools: "SkillTools",
  TodoStore: "TodoStore",
  MCP: "MCP",
  Permission: "Permission",
  Brand: BRAND.logPrefix,
  Worldbook: "Worldbook",
  EntityGraph: "EntityGraph",
  RAG: "RAG",
  Reranker: "Reranker",
  InboundServer: "InboundServer",
  Channels: "Channels",
  Feishu: "Feishu",
  Wechat: "Wechat",
  StickerEmbed: "StickerEmbed",
  AgUiBridge: "AgUiBridge",
  Call: "Call",
  ASR: "ASR",
} as const;

export type LogTagKey = keyof typeof LogTag;
