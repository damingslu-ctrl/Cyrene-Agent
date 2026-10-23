export interface AppInfo {
  name: string;
  nameZh: string;
  version: string;
  /** 本 fork 唯一的版本来源就是本机自己，界面上照实说。 */
  buildChannel: "local";
  dataDirName: string;
}
