import { describe, expect, it } from "vitest";
import { VERGE_IMAGE, createVergeRunningProbe, isVergeImageRunning, parseTasklistImages } from "./verge-process";

/** 真机 tasklist /FO CSV /NH 的形状（中文表头在没有 /NH 时长这样，一并演一下）。 */
const TASKLIST = [
  '"映像名称","PID","会话名","会话#   ","内存使用 "',
  '"clash-verge.exe","16520","Console","1","212,616 K"',
  '"verge-mihomo.exe","736","Console","1","136,860 K"',
  '"Mochi.exe","9036","Console","1","155,736 K"',
  "",
].join("\r\n");

describe("verge-process 解析", () => {
  it("取第一列原样；不带引号开头的行不参与判断", () => {
    expect(parseTasklistImages(TASKLIST)).toEqual([
      "映像名称",
      VERGE_IMAGE,
      "verge-mihomo.exe",
      "Mochi.exe",
    ]);
    expect(parseTasklistImages("")).toEqual([]);
    expect(parseTasklistImages("\r\n  \r\n")).toEqual([]);
  });

  it("只有 clash-verge.exe 算「那款在跑」：自家内核与自家客户端都不算，大小写都认", () => {
    expect(isVergeImageRunning(parseTasklistImages(TASKLIST))).toBe(true);
    expect(isVergeImageRunning(["verge-mihomo.exe", "mochi.exe"])).toBe(false);
    // 安装方式不同可能出全大写；比对那一层统一小写，别指望调用方记得
    expect(isVergeImageRunning(["CLASH-Verge.EXE"])).toBe(true);
    expect(isVergeImageRunning(parseTasklistImages('"CLASH-VERGE.EXE","1","Console","1","1 K"'))).toBe(true);
  });
});

describe("verge-process 探针", () => {
  it("2 秒内的重复提问用缓存：一次订阅操作不该 spawn 五次 tasklist", () => {
    let calls = 0;
    const clock = { t: 1000 };
    const probe = createVergeRunningProbe({
      readTasklist: () => {
        calls += 1;
        return TASKLIST;
      },
      now: () => clock.t,
    });
    expect(probe()).toBe(true);
    clock.t = 1500;
    expect(probe()).toBe(true);
    expect(calls).toBe(1);
    clock.t = 3001;
    expect(probe()).toBe(true);
    expect(calls).toBe(2);
  });

  it("Verge 退出后，过一秒那档缓存必须换成「不在跑」——不然闸门永远关着", () => {
    let output = TASKLIST;
    let t = 0;
    const probe = createVergeRunningProbe({ readTasklist: () => output, now: () => t });
    expect(probe()).toBe(true);
    output = '"Mochi.exe","9036","Console","1","155,736 K"';
    expect(probe()).toBe(true); // 还在缓存里
    t = 2001;
    expect(probe()).toBe(false);
  });

  it("探测不了就当它在跑（宁可拒写也不猜）；这个判断本身也按 TTL 重试", () => {
    let t = 0;
    let calls = 0;
    const probe = createVergeRunningProbe({
      readTasklist: () => {
        calls += 1;
        throw new Error("tasklist 不存在");
      },
      now: () => t,
    });
    expect(probe()).toBe(true);
    expect(probe()).toBe(true);
    expect(calls).toBe(1);
    t = 2500;
    expect(probe()).toBe(true);
    expect(calls).toBe(2);
  });

  it("空输出＝一个进程都没列出来＝没在跑（这跟探测失败是两件事，不许混）", () => {
    const probe = createVergeRunningProbe({ readTasklist: () => "", now: () => 0 });
    expect(probe()).toBe(false);
  });
});
