import { describe, expect, it } from "vitest";
import type { ProxyNode } from "../../../../../shared/network-types";
import {
  delayTone,
  formatBytes,
  formatSpeed,
  nodeStability,
  sortNodes,
  subscriptionProgress,
} from "./network-view";

function node(name: string, delay: number | null, history: Array<number | null> = []): ProxyNode {
  return { name, type: "Shadowsocks", delay, history, alive: delay !== null };
}

describe("formatSpeed", () => {
  it("按 1024 进位，保留一位小数", () => {
    expect(formatSpeed(0)).toBe("0 B/s");
    expect(formatSpeed(512)).toBe("512 B/s");
    expect(formatSpeed(1024)).toBe("1.0 KB/s");
    expect(formatSpeed(1536)).toBe("1.5 KB/s");
    expect(formatSpeed(1024 * 1024 * 3.4)).toBe("3.4 MB/s");
    expect(formatSpeed(1024 ** 3)).toBe("1.0 GB/s");
  });

  it("负值/NaN/Infinity 落到 0（不许把坏帧显示成天文数字）", () => {
    expect(formatSpeed(-1)).toBe("0 B/s");
    expect(formatSpeed(Number.NaN)).toBe("0 B/s");
    expect(formatSpeed(Number.POSITIVE_INFINITY)).toBe("0 B/s");
  });
});

describe("formatBytes", () => {
  it("订阅流量用同一进位，但不带每秒", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1024 ** 2)).toBe("1.0 MB");
    expect(formatBytes(12.34 * 1024 ** 3)).toBe("12.3 GB");
    expect(formatBytes(-5)).toBe("0 B");
  });
});

describe("迟延分档", () => {
  it("≤150 绿、≤400 黄、其余红；没有值/非正数是灰", () => {
    expect(delayTone(12)).toBe("good");
    expect(delayTone(150)).toBe("good");
    expect(delayTone(151)).toBe("medium");
    expect(delayTone(400)).toBe("medium");
    expect(delayTone(401)).toBe("bad");
    expect(delayTone(null)).toBe("none");
    expect(delayTone(0)).toBe("none");
    expect(delayTone(Number.NaN)).toBe("none");
  });
});

describe("nodeStability", () => {
  it("最近 10 次里成功占比；没有样本返回 null", () => {
    expect(nodeStability([100, 120, 130])).toBe(1);
    expect(nodeStability([100, null, 130, null])).toBe(0.5);
    expect(nodeStability([])).toBeNull();
  });
});

describe("subscriptionProgress", () => {
  it("已用占比夹在 0..1；总量未知时 0", () => {
    expect(subscriptionProgress(10, 30, 100)).toBeCloseTo(0.4);
    expect(subscriptionProgress(150, 0, 100)).toBe(1);
    expect(subscriptionProgress(-10, 0, 100)).toBe(0);
    expect(subscriptionProgress(1, 1, 0)).toBe(0);
  });
});

describe("sortNodes", () => {
  const nodes = [
    node("香港 01", 380, [null, null, 300]),
    node("日本 01", 90, [90, 91, 92]),
    node("美国 01", null, []),
    node("日本 02", 90, [null, null, null]),
  ];

  it("快：有延迟的升序，没有延迟的垫底，同延迟按名字", () => {
    expect(sortNodes(nodes, "speed").map((n) => n.name))
      .toEqual(["日本 01", "日本 02", "香港 01", "美国 01"]);
  });

  it("稳：成功率降序，再按延迟升序，无样本垫底", () => {
    expect(sortNodes(nodes, "stability").map((n) => n.name))
      .toEqual(["日本 01", "香港 01", "日本 02", "美国 01"]);
  });

  it("名：按中文语言环境排序", () => {
    expect(sortNodes(nodes, "name").map((n) => n.name))
      .toEqual(["美国 01", "日本 01", "日本 02", "香港 01"]);
  });

  it("不改入参顺序（排序只出新数组）", () => {
    const before = nodes.map((n) => n.name);
    sortNodes(nodes, "speed");
    expect(nodes.map((n) => n.name)).toEqual(before);
  });
});
