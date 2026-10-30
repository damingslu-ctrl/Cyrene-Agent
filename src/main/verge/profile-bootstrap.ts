/**
 * 订阅写面的装配层：把 `profile-service` 那七个注入点接到真盘、真控制面、真下载上。
 *
 * `profile-service` 的单测用假端口证判据（零写入、顺序、闸门），这边证的是**接线**：
 * 每一根线都只能在这里接错，而且接错了在那边全都看不出来。三条只有装配层才有的判断：
 *
 * 1) **配置目录每次操作现查**。`createProfileStore` 要的是定死的 `configRoot`，
 *    而 Verge 的目录在用户手上会挪（安装版↔便携版）。这里按当前值重建端口，
 *    查不到目录就直说——抱着开机那一刻的路径不放，用户只会看到「订阅列表是空的」。
 * 2) **注入的是控制面，不是整份 clash-verge.yaml**。只搬 `external-controller` / `secret` /
 *    `mixed-port` 三个键：其余（端口、tun、dns、日志级别）归 Wave 3 的设置页管，
 *    现在跟着订阅正文走反而会把用户在 Verge 里调好的东西悄悄改掉。
 * 3) **`external-controller` 剥掉协议前缀**。mihomo 要的是 `host:port`，把
 *    `http://127.0.0.1:9097` 原样写进去内核直接起不来；而**给客户端的 baseUrl 必须留着协议**，
 *    两边看着像同一个值，其实是两种写法（所以单测里各钉了一遍）。
 *
 * 控制面读不出来时这里是**抛错**，不是回一份空注入：宁可这次切换失败，
 * 也不能让 runtime 配置里少了我们的控制器地址——那等于把数据面主权交回订阅自己。
 * 抛在 `writeRuntime` 之前，所以失败的这一次盘上不会多一个字节。
 */
import { readControllerConfig, type ControllerConfig } from "./controller-config";
import { createMihomoClient, type MihomoClient } from "./mihomo-client";
import { ProfilesStoreError } from "./profiles-store";
import { createProfileStore, readProfileSource } from "./profile-store-port";
import { createProfileService, type ProfileService, type ProfileStorePort } from "./profile-service";
import type { FetchLike } from "./subscription-fetch";
import { createVergeRunningProbe } from "./verge-process";

/** 装配层只用得到 reloadConfig 这一颗；按这个宽度收，测试就不必伪造整个客户端。 */
type Reloader = Pick<MihomoClient, "reloadConfig">;

export interface ProfileBootstrapOptions {
  /**
   * Verge 的数据目录（`profiles.yaml` 与 `profiles/` 都在这儿）。
   * 每次操作都会再问一次：这台机器上它可能压根不存在，也可能在用户手里搬家。
   */
  getConfigRoot(): string | null;
  /** 本客户端的 userData：runtime 配置写这儿，不进 Verge 目录（spec D2 的边界）。 */
  userData: string;
  fetch?: FetchLike;
  isVergeRunning?(): boolean;
  createClient?(config: ControllerConfig): Reloader;
  now?(): Date;
}

export function createProfileAssembly(options: ProfileBootstrapOptions): ProfileService {
  const controller = (): ControllerConfig => {
    const result = readControllerConfig(options.getConfigRoot());
    if (!result.ok) {
      throw new ProfilesStoreError(
        "invalid",
        `读不到控制面配置（${result.reason}）：clash-verge.yaml 里得有一条本机 external-controller`,
      );
    }
    return result.config;
  };

  let cached: { root: string; port: ProfileStorePort } | null = null;
  const port = (): ProfileStorePort => {
    const root = options.getConfigRoot();
    if (root === null) {
      throw new ProfilesStoreError("invalid", "找不到 Clash Verge 的配置目录（clash-verge.yaml 不在预期位置）");
    }
    if (!cached || cached.root !== root) {
      cached = { root, port: createProfileStore({ configRoot: root, userData: options.userData, now: options.now }) };
    }
    return cached.port;
  };

  const store: ProfileStorePort = {
    readDoc: () => port().readDoc(),
    writeDoc: (doc) => port().writeDoc(doc),
    readProfileFile: (name) => port().readProfileFile(name),
    writeProfileFile: (name, text) => port().writeProfileFile(name, text),
    removeProfileFile: (name) => port().removeProfileFile(name),
    writeRuntime: (uid, text) => port().writeRuntime(uid, text),
  };

  const makeClient = options.createClient
    ?? ((config: ControllerConfig) => createMihomoClient({ baseUrl: config.baseUrl, secret: config.secret }));
  let client: Reloader | null = null;
  let clientKey = "";

  return createProfileService({
    store,
    fetch: options.fetch ?? ((url, init) => globalThis.fetch(url, init)),
    readSourceFile: readProfileSource,
    now: options.now,
    // 探针读不到 tasklist 时当作「Verge 在跑」（fail closed）；非 Windows 没有这个映像名，
    // 结论同样是拒写。这一期的系统代理与 TUN 也都是 Windows 口径，不在这里猜别的平台。
    isVergeRunning: options.isVergeRunning ?? createVergeRunningProbe(),
    inject: () => {
      const config = controller();
      const injected: Record<string, unknown> = {
        "external-controller": config.baseUrl.replace(/^[a-z]+:\/\//i, ""),
        secret: config.secret,
      };
      // 没有就不写：写 null 会把订阅自己的 mixed-port 抹掉。
      if (config.mixedPort !== null) injected["mixed-port"] = config.mixedPort;
      return injected;
    },
    reload: async (file: string) => {
      const config = controller();
      const key = `${config.baseUrl}\u0000${config.secret}`;
      if (!client || clientKey !== key) {
        client = makeClient(config);
        clientKey = key;
      }
      await client.reloadConfig(file);
    },
  });
}
