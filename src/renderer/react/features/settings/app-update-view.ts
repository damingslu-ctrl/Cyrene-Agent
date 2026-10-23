import { isNewerVersion } from "../../../../shared/version";
import type { AppInfo } from "../../../../shared/app-info";

/**
 * 版本信息视图：本 fork 没有升级来源，界面上只有「当前版本 + 数据目录」，没有按钮。
 *
 * 原来这个文件是「更新状态 → 界面」的映射（8 个 phase × 动作 × 红点）。
 * 删掉它不是删 UI，是**删掉「会有新版本」这个承诺**——留着一个永不亮的红点和
 * 一个点了只会报 check_failed 的按钮，比没有更误导。
 */
export interface AppInfoView {
  /** 版本行文案，如 `v1.3.3`（称号单独给 key，组件层用 t() 翻译后自行拼接） */
  versionLabel: string;
  /** 版本称号的 i18n key；普通版本为 null，只显示 v 号 */
  titleKey: string | null;
  /** 构建方式文案 key（i18n：本机构建，不联网检查） */
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
    noteKey: "appUpdate.localBuild",
  };
}
