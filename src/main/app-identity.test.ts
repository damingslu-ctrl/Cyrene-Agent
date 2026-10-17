import * as path from "node:path";
import { describe, expect, it } from "vitest";

import {
  VERGE_INSTANCE_NAME,
  configureVergeIdentity,
  hasExplicitUserDataDir,
  resolveAppUserDataPath,
  type IdentityApp,
} from "./app-identity";

function makeRecordingApp(userDataPath = "C:/AppData/Roaming/unresolved") {
  const calls: string[] = [];
  const app: IdentityApp = {
    setName: (name) => { calls.push(`setName:${name}`); },
    setPath: (key, value) => { calls.push(`setPath:${key}:${path.basename(value)}`); },
    getPath: (key) => { calls.push(`getPath:${key}`); return userDataPath; },
  };
  return { calls, app };
}

describe("app-identity", () => {
  it("userData 目录落在独立的 cyrene-verge 下", () => {
    const resolved = resolveAppUserDataPath("C:/AppData/Roaming");
    expect(path.basename(resolved)).toBe(VERGE_INSTANCE_NAME);
    expect(resolved).toContain(VERGE_INSTANCE_NAME);
    // 不改身份时这里会是 …\Cyrene（上游安装版的账本），必须不是它
    expect(resolved).not.toMatch(/[/\\]Cyrene[/\\]?$/);
  });

  it("正对照：显式传 name 时按传入值拼路径（证明拼接用的是 name 而不是常量）", () => {
    const resolved = resolveAppUserDataPath("C:/AppData/Roaming", "probe-name");
    expect(resolved.endsWith(path.join(path.sep, "probe-name"))).toBe(true);
    expect(resolved).not.toContain(VERGE_INSTANCE_NAME);
    expect(resolved).toBe(path.join("C:/AppData/Roaming", "probe-name"));
  });

  it("配置身份时 setName 与 setPath 都被调用且顺序为 name→userData", () => {
    const { calls, app } = makeRecordingApp();
    // 两参调用 = brief 钉住的契约；默认 argv 里没有 --user-data-dir，所以走覆盖分支
    const result = configureVergeIdentity(app, "C:/AppData/Roaming");
    expect(calls).toEqual([
      `setName:${VERGE_INSTANCE_NAME}`,
      `setPath:userData:${VERGE_INSTANCE_NAME}`,
    ]);
    expect(result.name).toBe(VERGE_INSTANCE_NAME);
    expect(result.userDataPath).toBe(path.join("C:/AppData/Roaming", VERGE_INSTANCE_NAME));
    expect(result.explicitUserDataDir).toBe(false);
  });

  it("显式 --user-data-dir 时不调 setPath，返回 Electron 解析出的目录", () => {
    const { calls, app } = makeRecordingApp("D:/probe-profile");
    const result = configureVergeIdentity(app, "C:/AppData/Roaming", [
      "electron",
      ".",
      "--user-data-dir=D:/probe-profile",
    ]);
    expect(calls).toEqual([`setName:${VERGE_INSTANCE_NAME}`, "getPath:userData"]);
    expect(result).toEqual({
      name: VERGE_INSTANCE_NAME,
      userDataPath: "D:/probe-profile",
      explicitUserDataDir: true,
    });
  });

  it("setName 不受开关影响：显式指定 userData 目录时同样改名（锁与上游隔离）", () => {
    const { calls, app } = makeRecordingApp("D:/probe-profile");
    configureVergeIdentity(app, "C:/AppData/Roaming", ["--user-data-dir=D:/probe-profile"]);
    expect(calls[0]).toBe(`setName:${VERGE_INSTANCE_NAME}`);
  });
});

describe("hasExplicitUserDataDir", () => {
  it("识别带值的 --user-data-dir 与 Chromium 等价的单短横线写法", () => {
    expect(hasExplicitUserDataDir(["--user-data-dir=D:/x"])).toBe(true);
    expect(hasExplicitUserDataDir(["-user-data-dir=D:/x"])).toBe(true);
    expect(hasExplicitUserDataDir(["electron", ".", "--user-data-dir=D:\\x"])).toBe(true);
  });

  it("裸开关（无值）与其它开关都不算显式指定", () => {
    expect(hasExplicitUserDataDir([])).toBe(false);
    expect(hasExplicitUserDataDir(["electron", ".", "--remote-debugging-port=9222"])).toBe(false);
    // 无值形态下 setPath 更可靠，保持覆盖
    expect(hasExplicitUserDataDir(["--user-data-dir"])).toBe(false);
    // 路径里恰好含该字串的参数不能被误判为开关（正则锚定在行首）
    expect(hasExplicitUserDataDir(["D:/tools/--user-data-dir=x"])).toBe(false);
  });
});
