/**
 * 唯一身份来源（spec §1 改名只动一处的兑现）。
 *
 * ⚠️ `DATA_DIR_NAME` 与 `APP_ID` 是**已落盘数据**的键：改它们等于换 userData 目录，
 * 必须先跑 Task 9 的迁移与 `settings-store` 的密钥解耦（Task 7），否则频道 secret 的
 * XOR 种子会跟着静默轮换——错钥匙不是报错，是解出乱码并被当成正确值用。
 */
export const PRODUCT_NAME = "Mochi";
/** 中文显示名：猫身 token `PAPER #f7f4ec` 就是那团奶油色，产品叫「麻糬」。 */
export const PRODUCT_NAME_ZH = "麻糬";
export const APP_ID = "dev.damin.mochi";
/** userData 目录名；与 Windows 开始菜单/添加删除列表里的名字同源。 */
export const DATA_DIR_NAME = "Mochi";
/** 日志前缀（`logger-tags.ts` 用）。 */
export const LOG_PREFIX = "Mochi";
/** 窗口标题后缀。 */
export const TITLE_SUFFIX = "Mochi";
/**
 * `console.*` 直调行的方括号前缀（如 `[Mochi] ...`）。
 *
 * 历史上主进程 16 个文件各写死一份 `[Cyrene]` 字面量；这里给它们同一个来源，
 * 换名只改 `LOG_PREFIX` 一处。走 `logger` 的行仍用 `LogTag.Brand`（同一个值的
 * PascalCase 16 字符列），两条路径共用这一个身份源。
 */
export const CONSOLE_PREFIX = `[${LOG_PREFIX}]`;
/** 装机产物名与 appId 的成对身份，sync-brand.mjs 与一致性测试都读这一份。 */
export const BRAND = {
  productName: PRODUCT_NAME,
  productNameZh: PRODUCT_NAME_ZH,
  appId: APP_ID,
  dataDirName: DATA_DIR_NAME,
  logPrefix: LOG_PREFIX,
  titleSuffix: TITLE_SUFFIX,
} as const;
