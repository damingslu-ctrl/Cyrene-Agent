import { isNewerVersion } from "../../../../shared/version";
import type { AppInfo } from "../../../../shared/app-info";

/**
 * 版本信息视图：这一页只报「当前版本 + 数据目录」，**升级的那三下点击住在网络页的更新卡上**。
 *
 * 原来这个文件是「更新状态 → 界面」的映射（8 个 phase × 动作 × 红点），P4 删掉它不是删 UI，
 * 是删掉「会有新版本」这个承诺——那时候确实没有任何升级来源。Wave 4 T12 把来源接回来了，
 * 但接在「网络 › 设置 › 客户端更新」那张卡上（那里读的是 main 的账），所以这一页仍然不画按钮；
 * 只有 `noteKey` 那句话必须跟着改口：再说「不联网检查更新」就是把一件已经会做的事说成不会做。
 */
export interface AppInfoView {
  /** 版本行文案，如 `v1.3.3`（称号单独给 key，组件层用 t() 翻译后自行拼接） */
  versionLabel: string;
  /** 版本称号的 i18n key；普通版本为 null，只显示 v 号 */
  titleKey: string | null;
  /** 构建方式文案 key（i18n：本机构建 + 更新归网络页那张卡管） */
  noteKey: string;
}

const STABLE_SINCE = "1.3.0";

/** 查版本称号：达到正式版起点返回文案 key，否则 null 只显示 v 号。 */
export function resolveVersionTitleKey(version: string): string | null {
  const trimmed = version.trim();
  return trimmed === STABLE_SINCE || isNewerVersion(trimmed, STABLE_SINCE) ? "ui.version.firstStable" : null;
}

export function resolveAppInfoView(info: AppInfo): AppInfoView {
  return {
    versionLabel: `v${info.version}`,
    titleKey: resolveVersionTitleKey(info.version),
    noteKey: "appUpdate.updateCard",
  };
}
