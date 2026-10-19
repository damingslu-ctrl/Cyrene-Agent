import { describe, expect, it } from "vitest";
import { buildLearnExamCsp } from "./learn-exam-csp";

describe("learn exam content security policy", () => {
  it("allows Vite's injected inline runtime only in development", () => {
    const devScriptPolicy = buildLearnExamCsp(true).match(/script-src[^;]*/)?.[0];
    const productionScriptPolicy = buildLearnExamCsp(false).match(/script-src[^;]*/)?.[0];
    expect(devScriptPolicy).toBe("script-src 'self' 'unsafe-eval' 'unsafe-inline'");
    expect(productionScriptPolicy).toBe("script-src 'self'");
  });

  it("CSP 不放行任何外部域（个人化后连字体也本地）", () => {
    // 实测（buildLearnExamCsp 的真实返回串）：
    //   prod 档整串不含任何 scheme://；dev 档只有 connect-src 的本地 HMR 两个源
    //   （http://localhost:5173 与 ws://localhost:5173，故匹配器要连 wss? 一起认，
    //   只写 https? 会把 ws:// 那条漏在尺外）。
    const origins = (csp: string) =>
      [...csp.matchAll(/(?:https?|wss?):\/\/([^\s;'"]+)/g)].map((match) => match[1]);
    // 正对照：dev 档自己就带 localhost HMR 源，说明「外部域为空」不是永远为真的空扫。
    expect(origins(buildLearnExamCsp(true))).toEqual(["localhost:5173", "localhost:5173"]);
    expect(origins(buildLearnExamCsp(false))).toEqual([]);
  });
});
