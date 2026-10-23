import { readdirSync } from "node:fs";
import type { Dirent } from "node:fs";
import path from "node:path";
import { inspectPluginDir } from "../plugins/loader";
import type { MarketListResult, MarketPluginEntry } from "../shared/plugin-management";

/**
 * 本地插件目录就是本 fork 唯一的「市场」。
 *
 * 原来这里读两份远端索引（GitHub raw + Gitee 镜像）再按 zip 前缀白名单下载，
 * 是开机之后用户一点就发的最大一条外网路径。个人化后不引外部索引：
 * `userData/plugins` 里有什么就列什么，「安装」退化成「放进这个目录再刷新」。
 * 用户自备的 zip 导入通道（plugins/manager）不受影响——那是本地动作。
 */
export async function listLocalMarketPlugins(pluginsDir: string): Promise<MarketListResult> {
  let entries: Dirent<string>[] = [];
  try {
    entries = readdirSync(pluginsDir, { withFileTypes: true });
  } catch {
    // 目录还不存在是正常状态（用户尚未放过插件），不是错误。
    return { ok: true, plugins: [], directory: pluginsDir };
  }
  const items: MarketPluginEntry[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(pluginsDir, entry.name);
    // inspectPluginDir 是本地目录的唯一校验入口：manifest 缺字段、entry 越界等都在这里被拒绝
    const { manifest } = await inspectPluginDir(dir);
    if (!manifest) continue;
    items.push({
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      author: manifest.author,
      path: dir,
    });
  }
  items.sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
  return { ok: true, plugins: items, directory: pluginsDir };
}
