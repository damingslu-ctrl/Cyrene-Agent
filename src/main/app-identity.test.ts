import * as path from "node:path";
import { describe, expect, it } from "vitest";

import {
  VERGE_INSTANCE_NAME,
  configureVergeIdentity,
  resolveAppUserDataPath,
  type IdentityApp,
} from "./app-identity";

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
    expect(path.basename(resolved)).toBe("probe-name");
    expect(resolved.endsWith(path.join(path.sep, "probe-name"))).toBe(true);
    expect(resolved).not.toContain(VERGE_INSTANCE_NAME);
    expect(resolved).toBe(path.join("C:/AppData/Roaming", "probe-name"));
  });

  it("配置身份时 setName 与 setPath 都被调用且顺序为 name→userData", () => {
    const calls: string[] = [];
    const app: IdentityApp = {
      setName: (name) => { calls.push(`setName:${name}`); },
      setPath: (key, value) => { calls.push(`setPath:${key}:${path.basename(value)}`); },
    };
    const result = configureVergeIdentity(app, "C:/AppData/Roaming");
    expect(calls).toEqual([
      `setName:${VERGE_INSTANCE_NAME}`,
      `setPath:userData:${VERGE_INSTANCE_NAME}`,
    ]);
    expect(result.name).toBe(VERGE_INSTANCE_NAME);
    expect(result.userDataPath).toBe(path.join("C:/AppData/Roaming", VERGE_INSTANCE_NAME));
  });
});
