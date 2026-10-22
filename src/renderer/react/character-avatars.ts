// 角色头像映射：朋友圈评论与互动通知用这份小头像（用户提供的方形头像），
// task 委托面板的立绘头像是另一套资源（character-portraits.ts），两者用途不同。
// 静态 import 保证资源进打包产物；头像池之外的角色查不到，渲染层降级为无头像。
import niangaoUrl from "./avatars/年糕.png";
import douhuaUrl from "./avatars/豆花.png";
import tangyuanUrl from "./avatars/汤圆.png";
import budingUrl from "./avatars/布丁.png";
import mochaUrl from "./avatars/抹茶.png";
import kekeUrl from "./avatars/可可.png";
import zhimaUrl from "./avatars/芝麻.png";
import liziUrl from "./avatars/栗子.png";
import haitaiUrl from "./avatars/海苔.png";
import mianhuaUrl from "./avatars/棉花.png";
import yuwanUrl from "./avatars/鱼丸.png";
import naigaiUrl from "./avatars/奶盖.png";

/** 昵称 → 头像 url */
const avatarByNickname: Readonly<Record<string, string>> = {
  "年糕": niangaoUrl,
  "豆花": douhuaUrl,
  "汤圆": tangyuanUrl,
  "布丁": budingUrl,
  "抹茶": mochaUrl,
  "可可": kekeUrl,
  "芝麻": zhimaUrl,
  "栗子": liziUrl,
  "海苔": haitaiUrl,
  "棉花": mianhuaUrl,
  "鱼丸": yuwanUrl,
  "奶盖": naigaiUrl,
};

/** 角色昵称查头像；池外角色返回 null */
export function getCharacterAvatar(nickname: string): string | null {
  return avatarByNickname[nickname] ?? null;
}
