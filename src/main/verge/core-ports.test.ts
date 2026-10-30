import { describe, expect, it } from "vitest";
import { DEFAULT_CONTROLLER_PORT, DEFAULT_MIXED_PORT } from "../../shared/core-types";
import { pickPortPair } from "./core-source";
import { createUsedPortsProbe, parseListeningPorts } from "./core-ports";

/** 本机 `netstat -ano` 的真形状：表头是中文的，状态词不是。 */
const SAMPLE = [
  "活动连接",
  "",
  "  协议  本地地址          外部地址                状态           PID",
  "  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1032",
  "  TCP    0.0.0.0:445            0.0.0.0:0              LISTENING       4",
  "  TCP    127.0.0.1:9097         0.0.0.0:0              LISTENING       4321",
  "  TCP    127.0.0.1:5354         0.0.0.0:0              LISTENING       9088",
  "  TCP    127.0.0.1:5354         127.0.0.1:52113        ESTABLISHED     9088",
  "  TCP    127.0.0.1:7897         127.0.0.1:52884        ESTABLISHED     4321",
  "  TCP    192.168.1.7:52990      140.82.113.26:443      TIME_WAIT       0",
  "  TCP    [::]:135               [::]:0                 LISTENING       1032",
  "  TCP    [::1]:4532             [::]:0                 LISTENING       6240",
  "  TCP    [::1]:4533             [::1]:52010            ESTABLISHED     6240",
  "  UDP    0.0.0.0:5353           *:*                                    9088",
  "  UDP    [::]:5353              *:*                                    9088",
].join("\r\n");

describe("netstat 输出 → 在听的端口", () => {
  it("只认 TCP 且状态是 LISTENING，去重升序", () => {
    expect(parseListeningPorts(SAMPLE)).toEqual([135, 445, 4532, 5354, 9097]);
  });

  it("已经连出去的那一条不算占用：7897 只在 ESTABLISHED 里出现，就不该进表", () => {
    expect(parseListeningPorts(SAMPLE)).not.toContain(7897);
    expect(parseListeningPorts(SAMPLE)).toContain(9097);
  });

  it("空状态那一列（TIME_WAIT 那行）与 UDP 都不进表", () => {
    expect(parseListeningPorts("  TCP    1.2.3.4:1        5.6.7.8:2        TIME_WAIT       0")).toEqual([]);
    expect(parseListeningPorts("  UDP    0.0.0.0:9999     *:*                              4")).toEqual([]);
  });

  it("`0.0.0.0:0` 那种「任意端口」不算占用，超界与非数字端口也不算", () => {
    expect(parseListeningPorts("  TCP    0.0.0.0:0        0.0.0.0:0        LISTENING       4")).toEqual([]);
    expect(parseListeningPorts("  TCP    0.0.0.0:70000    0.0.0.0:0        LISTENING       4")).toEqual([]);
    expect(parseListeningPorts("  TCP    0.0.0.0:http     0.0.0.0:0        LISTENING       4")).toEqual([]);
  });

  it("状态词大小写不敏感（英文版也是 listening 那一族词）", () => {
    expect(parseListeningPorts("  tcp    127.0.0.1:8080   0.0.0.0:0        Listening       7")).toEqual([8080]);
  });

  it("表头与空行不会混进表里", () => {
    expect(parseListeningPorts(SAMPLE)).not.toContain(Number.NaN);
    expect(parseListeningPorts("")).toEqual([]);
  });
});

describe("探针", () => {
  it("读得动就报表上的端口", () => {
    expect(createUsedPortsProbe({ readNetstat: () => SAMPLE })()).toEqual([135, 445, 4532, 5354, 9097]);
  });

  it("读不动回空表——宁可用默认档起一次，也不悄悄退到 17890 让数据面找不着内核", () => {
    const probe = createUsedPortsProbe({
      readNetstat: () => {
        throw new Error("netstat 起不来");
      },
    });
    expect(probe()).toEqual([]);
    // 这一档的实际后果要看得见：空表＝默认档照用，而不是退到扫描段。
    expect(pickPortPair(probe())).toEqual({ mixed: DEFAULT_MIXED_PORT, controller: DEFAULT_CONTROLLER_PORT });
  });

  it("正对照：9097 真的在听时，默认档就不许再被选中", () => {
    const probe = createUsedPortsProbe({ readNetstat: () => "  TCP    127.0.0.1:9097   0.0.0.0:0   LISTENING   4321" });
    expect(pickPortPair(probe())).not.toEqual({ mixed: DEFAULT_MIXED_PORT, controller: DEFAULT_CONTROLLER_PORT });
  });
});
