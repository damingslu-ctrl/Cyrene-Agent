import { CURRENT_DISCLAIMER_VERSION } from "../../shared/disclaimer";

export interface SplashPolicySettings {
  petVisible: boolean;
  disclaimerAcceptedVersion?: string;
}

/**
 * 有登场动画时不再建 Loading 窗——启动期只留一条动画。
 *
 * 判据与 core-bootstrap 建宠物窗的口径完全相同（petVisible && 免责声明已接受）：
 * 那边不建窗/不 show 时动画不会播，这边就不能把 Loading 也撤掉——否则首启
 * （未同意声明）或用户藏起桌宠时，启动期会变成一片空白。
 */
export function shouldSkipStartupSplash(settings: SplashPolicySettings): boolean {
  const consent = settings.disclaimerAcceptedVersion === undefined
    || settings.disclaimerAcceptedVersion === CURRENT_DISCLAIMER_VERSION;
  return settings.petVisible && consent;
}
