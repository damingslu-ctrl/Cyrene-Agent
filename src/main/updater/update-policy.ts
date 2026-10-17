// src/main/updater/update-policy.ts
/**
 * fork 的更新策略闸门。
 *
 * `electron-updater` 检查的是上游仓库的 release：fork 一旦让它排期，
 * 用户会被静默升回上游版本，本地这些 verge 模块连同像素猫一起消失。
 * 发布在 fork 侧走手工打包，所以这里默认关闭排期；
 * 手动检查/下载/安装的 IPC 保留（那是显式动作，不是静默行为）。
 */
export const FORK_AUTO_UPDATE_DISABLED = true;

export interface UpdateCheckPolicyInput {
  isPackaged: boolean;
  forkAutoUpdateDisabled: boolean;
}

export function shouldScheduleStartupUpdateCheck(input: UpdateCheckPolicyInput): boolean {
  if (input.forkAutoUpdateDisabled) return false;
  return input.isPackaged;
}
