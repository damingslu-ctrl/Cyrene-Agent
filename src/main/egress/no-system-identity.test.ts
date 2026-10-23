import { readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { scannedFiles } from "./scan-source-files";

describe("身份不侵入系统", () => {
  it("没有 setAsDefaultProtocolClient", () => {
    const hits = scannedFiles().filter((f) => !f.endsWith("no-system-identity.test.ts") && /setAsDefaultProtocolClient/.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
    // 正对照：协议名确实在别处存在（privileged scheme），说明不是扫了个空目录
    expect(scannedFiles().some((f) => /registerPrivilegedSchemes|scheme/.test(readFileSync(f, "utf8")))).toBe(true);
  });

  it("没有写 HKCU\Software\Classes 或启动项注册表", () => {
    const re = /Software\\Classes|Software\\Microsoft\\Windows\\CurrentVersion\\Run/;
    // 正对照：尺能命中已知写法
    expect(re.test('const x = "Software\\Classes\\Cyrene";')).toBe(true);
    const hits = scannedFiles().filter((f) => !f.endsWith("no-system-identity.test.ts") && re.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });

  it("开机自启默认关闭", () => {
    const source = readFileSync(path.resolve(process.cwd(), "src/main/settings/settings-facade.ts"), "utf8");
    expect(source.length).toBeGreaterThan(200);
    const m = /launchAtLogin:\s*false/.test(source) || /launchAtLogin.*default.*false/is.test(source);
    expect(m).toBe(true);
  });
});
