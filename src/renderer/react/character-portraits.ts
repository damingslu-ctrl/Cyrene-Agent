// 角色立绘头像映射：task 委托面板与朋友圈评论共用同一份静态资源。
// 文件名与昵称一一对应（昵称.png）；静态 import 保证资源进打包产物，
// 不在立绘池内的角色查不到头像，渲染层降级为无头像即可。
import niangaoUrl from "../tast/年糕.png";
import douhuaUrl from "../tast/豆花.png";
import tangyuanUrl from "../tast/汤圆.png";
import budingUrl from "../tast/布丁.png";
import mochaUrl from "../tast/抹茶.png";
import kekeUrl from "../tast/可可.png";
import zhimaUrl from "../tast/芝麻.png";
import liziUrl from "../tast/栗子.png";
import haitaiUrl from "../tast/海苔.png";
import mianhuaUrl from "../tast/棉花.png";
import yuwanUrl from "../tast/鱼丸.png";
import naigaiUrl from "../tast/奶盖.png";

/** 立绘文件名 → 打包后 url */
const portraitByAssetFileName: Readonly<Record<string, string>> = {
  "年糕.png": niangaoUrl,
  "豆花.png": douhuaUrl,
  "汤圆.png": tangyuanUrl,
  "布丁.png": budingUrl,
  "抹茶.png": mochaUrl,
  "可可.png": kekeUrl,
  "芝麻.png": zhimaUrl,
  "栗子.png": liziUrl,
  "海苔.png": haitaiUrl,
  "棉花.png": mianhuaUrl,
  "鱼丸.png": yuwanUrl,
  "奶盖.png": naigaiUrl,
};

/** 立绘文件名查头像；非立绘池资源返回 null */
export function getCharacterPortraitByAssetFileName(assetFileName: string): string | null {
  return portraitByAssetFileName[assetFileName] ?? null;
}

/** 角色昵称查头像（昵称即文件名主干）；查不到返回 null */
export function getCharacterPortrait(nickname: string): string | null {
  return getCharacterPortraitByAssetFileName(`${nickname}.png`);
}
