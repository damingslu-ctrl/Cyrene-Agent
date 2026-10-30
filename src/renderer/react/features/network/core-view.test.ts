import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import en from "../../i18n/en.json";
import jaJP from "../../i18n/ja-JP.json";
import zhCN from "../../i18n/zh-CN.json";
import {
  CORE_MODES,
  CORE_REASONS,
  CORE_SECRET_SOURCES,
  CORE_STATES,
  CORE_UPDATE_OUTCOMES,
  CORE_UPDATE_REASONS,
  EMPTY_CORE_STATUS,
  MAX_SELF_HEAL,
  type CoreStatus,
  type CoreUpdateState,
  type CoreView,
} from "../../../../shared/core-types";
import {
  coreActions,
  coreAttention,
  coreHealReadout,
  coreLeadKey,
  coreModeKey,
  coreOnline,
  corePortReadout,
  coreReasonKey,
  coreReceipt,
  coreSecretKey,
  coreStateKey,
  coreUptimeMs,
  coreUpdateKey,
  coreUpdateLine,
  coreUpdateReasonKey,
  coreUpdateReceipt,
  coreUpdateTone,
  isOwnCore,
  type CoreReceipt as CoreReceiptShape,
} from "./core-view";

const RESOURCES: Record<string, Record<string, unknown>> = {
  "zh-CN": zhCN as unknown as Record<string, unknown>,
  en: en as unknown as Record<string, unknown>,
  "ja-JP": jaJP as unknown as Record<string, unknown>,
};

function leaf(locale: string, key: string): unknown {
  let node: unknown = RESOURCES[locale];
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

const OWN_RUNNING: CoreStatus = {
  state: "running",
  mode: "installed",
  pid: 4321,
  ports: { mixed: 17890, controller: 17891 },
  controller: "http://127.0.0.1:17891",
  reason: null,
  detail: null,
  healAttempts: 0,
  startedAt: 1_732_000_000_000,
};

const EXTERNAL_RUNNING: CoreStatus = {
  ...OWN_RUNNING,
  mode: "external",
  pid: null,
  ports: null,
  controller: "http://127.0.0.1:9097",
};

const view = (
  status: CoreStatus,
  secretSource: CoreView["secretSource"] = "verge",
  update: CoreUpdateState | null = null,
): CoreView => ({
  status,
  secretSource,
  update,
});

/** 一次「装上了」的回执——更新那条线的所有判定都从这里起步。 */
const INSTALLED: CoreUpdateState = {
  outcome: "installed",
  tag: "v1.19.33",
  asset: "mihomo-windows-amd64-v1.19.33.zip",
  reason: null,
  detail: null,
  at: 1_732_000_050_000,
};

describe("core-view：状态词与原因词的口径", () => {
  it("五档状态、三种来源、十三档原因、三种口令来路都映射到自己的 key", () => {
    for (const state of CORE_STATES) expect(coreStateKey(state)).toBe(`network.core.state.${state}`);
    for (const mode of CORE_MODES) expect(coreModeKey(mode)).toBe(`network.core.mode.${mode}`);
    for (const reason of CORE_REASONS) expect(coreReasonKey(reason)).toBe(`network.core.reason.${reason}`);
    for (const source of CORE_SECRET_SOURCES) expect(coreSecretKey(source)).toBe(`network.core.secret.${source}`);
  });

  /** `mode === null` 是「这一班还没认领过任何内核」，画成 external 就是在编。 */
  it("模式为 null 时走 none 那一档，不冒充 external", () => {
    expect(coreModeKey(null)).toBe("network.core.mode.none");
    expect(coreModeKey("external")).toBe("network.core.mode.external");
  });

  it("只有 running 算在线：starting 与 blocked 都不许亮绿点", () => {
    expect(coreOnline("running")).toBe(true);
    for (const state of CORE_STATES.filter((entry) => entry !== "running")) {
      expect(coreOnline(state), state).toBe(false);
    }
  });

  /** external 的进程归 Verge 的服务管；凡是会 kill 的判定都得先分清这一点。 */
  it("isOwnCore 只认我们起的那两颗，external 与 null 都不算", () => {
    expect(isOwnCore(OWN_RUNNING)).toBe(true);
    expect(isOwnCore({ ...OWN_RUNNING, mode: "bundled" })).toBe(true);
    expect(isOwnCore(EXTERNAL_RUNNING)).toBe(false);
    expect(isOwnCore(EMPTY_CORE_STATUS)).toBe(false);
  });
});

describe("core-view：四颗按钮该不该按下去", () => {
  it("running 且是我们起的：起灰着、停与重启能按", () => {
    expect(coreActions(OWN_RUNNING, false)).toEqual({
      start: false, stop: true, restart: true, update: true, hintKey: null,
    });
  });

  /** 这就是 Wave 3 最贵的一条：external 态给一颗能点的「停止」＝替用户关掉他在用的 Verge。 */
  it("external 在跑时停与重启都灰，并给出那句话", () => {
    const actions = coreActions(EXTERNAL_RUNNING, false);
    expect(actions).toEqual({
      start: false, stop: false, restart: false, update: true, hintKey: "network.core.hint.external",
    });
  });

  it("starting 也不算「已经起来」：起灰着，停要等到真起来才给", () => {
    const actions = coreActions({ ...OWN_RUNNING, state: "starting", pid: null }, false);
    expect(actions.start).toBe(false);
    expect(actions.stop).toBe(true);
  });

  it("停着 / 退出 / 被挡下时只给得起那颗", () => {
    for (const status of [
      EMPTY_CORE_STATUS,
      { ...OWN_RUNNING, state: "exited" as const, pid: null, reason: "exited" as const },
      { ...OWN_RUNNING, state: "blocked" as const, pid: null, reason: "verge-running" as const },
    ]) {
      expect(coreActions(status, false), status.state).toEqual({
        start: true, stop: false, restart: false, update: true, hintKey: null,
      });
    }
  });

  /** 在途时 restart 必须一起灰：manager 只合并在途的 start，restart 不合并，连点会真起停起一遍。 */
  it("在途时四颗全灰，且说的是「正在忙」而不是「不该点」", () => {
    expect(coreActions(EMPTY_CORE_STATUS, true)).toEqual({
      start: false, stop: false, restart: false, update: false, hintKey: "network.core.hint.busy",
    });
    // busy 排在前：正在等回执时冒出「这颗不是我们起的」会把人领错方向。
    expect(coreActions(EXTERNAL_RUNNING, true).hintKey).toBe("network.core.hint.busy");
  });

  /**
   * 「更新」这颗不跟内核状态走。页面照 `state` 再算一遍就是把 `canSwap` 写两处，
   * 而装配层那条闸门排在下载之前——running 时点下去得到的是 `busy` 那句，不烧流量。
   */
  it("内核在跑时更新照样给按：换不换得动只在装配层判一次", () => {
    expect(coreActions(OWN_RUNNING, false).update).toBe(true);
    expect(coreActions(EXTERNAL_RUNNING, false).update).toBe(true);
    expect(coreActions({ ...OWN_RUNNING, state: "blocked" as const, pid: null }, false).update).toBe(true);
    // 唯一能灰掉它的理由是「上一次点击还在路上」。
    for (const status of [OWN_RUNNING, EXTERNAL_RUNNING, EMPTY_CORE_STATUS]) {
      expect(coreActions(status, true).update, status.state).toBe(false);
    }
  });
});

describe("core-view：读数", () => {
  it("external 态端口是 null：读数回 null，不写成 0 / 0", () => {
    expect(corePortReadout(OWN_RUNNING)).toBe("17890 / 17891");
    expect(corePortReadout(EXTERNAL_RUNNING)).toBeNull();
    expect(corePortReadout(EMPTY_CORE_STATUS)).toBeNull();
  });

  it("自愈次数：0 次不占一行，打满时按上限报", () => {
    expect(coreHealReadout(OWN_RUNNING)).toBeNull();
    expect(coreHealReadout({ ...OWN_RUNNING, healAttempts: 1 })).toBe(`1/${MAX_SELF_HEAL}`);
    expect(coreHealReadout({ ...OWN_RUNNING, healAttempts: MAX_SELF_HEAL })).toBe(`${MAX_SELF_HEAL}/${MAX_SELF_HEAL}`);
    // 账上多出来的次数不夸大：宁可钳在上限，也不写「4/3」这种没人信的话。
    expect(coreHealReadout({ ...OWN_RUNNING, healAttempts: MAX_SELF_HEAL + 2 })).toBe(`${MAX_SELF_HEAL}/${MAX_SELF_HEAL}`);
  });

  /** external 的 startedAt 是我们发现它的时刻，不是它起来的时刻——那个数字不该端给用户。 */
  it("已运行只在数得清的时候给：非 own、非 running、时钟倒挂都不给", () => {
    const now = OWN_RUNNING.startedAt! + 90_000;
    expect(coreUptimeMs(OWN_RUNNING, now)).toBe(90_000);
    expect(coreUptimeMs(EXTERNAL_RUNNING, now)).toBeNull();
    expect(coreUptimeMs({ ...OWN_RUNNING, state: "starting" }, now)).toBeNull();
    expect(coreUptimeMs({ ...OWN_RUNNING, startedAt: null }, now)).toBeNull();
    expect(coreUptimeMs({ ...OWN_RUNNING, startedAt: now + 5_000 }, now)).toBeNull();
  });
});

describe("core-view：卡片顶那句说明", () => {
  /** 绿点上再叠一层「出问题了」是同一张卡自相矛盾；红字只跟着没在跑的那几态。 */
  it("coreAttention：有原因且没在跑才算要提醒", () => {
    expect(coreAttention({ ...OWN_RUNNING, state: "exited", reason: "exited" })).toBe(true);
    expect(coreAttention({ ...OWN_RUNNING, state: "blocked", reason: "verge-running" })).toBe(true);
    expect(coreAttention(OWN_RUNNING)).toBe(false);
    expect(coreAttention(EMPTY_CORE_STATUS)).toBe(false);
    // 账上同时写着 running 与 reason＝settle 被绕过了，这时也不许在绿点上叠红字。
    expect(coreAttention({ ...OWN_RUNNING, reason: "exited" })).toBe(false);
  });

  it("五种「此刻在看什么」各说一句，绝不共用", () => {
    expect(coreLeadKey({ ...OWN_RUNNING, state: "exited", reason: "exited" })).toBe("network.core.hint.attention");
    expect(coreLeadKey({ ...OWN_RUNNING, state: "starting" })).toBe("network.core.hint.starting");
    expect(coreLeadKey(OWN_RUNNING)).toBe("network.core.hint.ownRunning");
    expect(coreLeadKey(EXTERNAL_RUNNING)).toBe("network.core.hint.externalRunning");
    expect(coreLeadKey(EMPTY_CORE_STATUS)).toBe("network.core.hint.idle");
  });

  /** 「还没起来」与「起来但不是我们起的」共用一句话，是最难从界面上看出来的一种谎。 */
  it("own 与 external 的说明行不共用 key", () => {
    expect(coreLeadKey(OWN_RUNNING)).not.toBe(coreLeadKey(EXTERNAL_RUNNING));
  });
});

describe("core-view：回执说什么", () => {
  /** 起失败不抛错，只写在 state/reason 里：按「有没有抛」判成败会永远判成成功。 */
  it("start 之后是 running 才算成；blocked/exited 一律报红并抄 reason 那句话", () => {
    expect(coreReceipt("start", view(OWN_RUNNING))).toEqual({
      tone: "ok", textKey: "network.core.started", detail: null,
    } satisfies CoreReceiptShape);
    const blocked = view({ ...OWN_RUNNING, state: "blocked", pid: null, reason: "verge-running", detail: "先退出 Verge" });
    expect(coreReceipt("start", blocked)).toEqual({
      tone: "error", textKey: "network.core.reason.verge-running", detail: "先退出 Verge",
    } satisfies CoreReceiptShape);
  });

  /** 吃现成的控制器不是「我起起来了」：那句话得说清这颗不是我们 spawn 的。 */
  it("start 之后 running 但是 external：说「用上了现成的」，不冒领成自己起的", () => {
    expect(coreReceipt("start", view(EXTERNAL_RUNNING))).toEqual({
      tone: "ok", textKey: "network.core.adopted", detail: null,
    } satisfies CoreReceiptShape);
  });

  it("restart 成功说的是重启，不是首次起来", () => {
    expect(coreReceipt("restart", view(OWN_RUNNING)).textKey).toBe("network.core.restarted");
  });

  /** 停完账上却不是 stopped：这是真矛盾，不许画成成功。 */
  it("stop 只有落到 stopped 才算成", () => {
    expect(coreReceipt("stop", view(EMPTY_CORE_STATUS)).tone).toBe("ok");
    expect(coreReceipt("stop", view(OWN_RUNNING))).toEqual({
      tone: "error", textKey: "network.core.stopNotStopped", detail: null,
    } satisfies CoreReceiptShape);
  });

  /** reason 为 null 的失败（比如刚 settle 出 exited 又没带原因）也得有话说，不能空一条。 */
  it("没有 reason 时退到状态词", () => {
    const receipt = coreReceipt("start", view({ ...OWN_RUNNING, state: "exited", pid: null, reason: null }));
    expect(receipt.tone).toBe("error");
    expect(receipt.textKey).toBe("network.core.state.exited");
  });
});

describe("core-view：更新那本账（装上了 ≠ 生效了）", () => {
  it("四种下场、六种失败原因各映射到自己的 key", () => {
    for (const outcome of CORE_UPDATE_OUTCOMES) {
      expect(coreUpdateKey(outcome), outcome).toBe(`network.core.update.outcome.${outcome}`);
    }
    for (const reason of CORE_UPDATE_REASONS) {
      expect(coreUpdateReasonKey(reason), reason).toBe(`network.core.update.reason.${reason}`);
    }
  });

  /** busy 是「按设计没换」：报绿像成功、报红像故障，两种都会把人支去一件不需要做的事。 */
  it("只有 failed 染红；busy 走中性，latest 也算问出了结果", () => {
    expect(coreUpdateTone("failed")).toBe("error");
    expect(coreUpdateTone("busy")).toBe("neutral");
    expect(coreUpdateTone("installed")).toBe("ok");
    expect(coreUpdateTone("latest")).toBe("ok");
  });

  /**
   * 两条账不许互相冒充：进程那套词（「内核起来了」）出现在更新回执里，
   * 就是本页最贵的一种谎——绿点在跑，跟文件换没换上没有关系。
   */
  it("更新回执与起停回执各说各的词表", () => {
    const processKeys = [
      "network.core.started",
      "network.core.adopted",
      "network.core.restarted",
      "network.core.stopped",
      "network.core.stopNotStopped",
    ];
    for (const outcome of CORE_UPDATE_OUTCOMES) {
      const receipt = coreUpdateReceipt({ ...INSTALLED, outcome });
      expect(receipt, outcome).not.toBeNull();
      expect(processKeys, outcome).not.toContain(receipt!.textKey);
    }
    for (const action of ["start", "stop", "restart"] as const) {
      expect(coreReceipt(action, view(OWN_RUNNING, "verge", INSTALLED)).textKey).not.toContain("update");
    }
  });

  it("失败先说原因，没说原因才退到下场那一句", () => {
    expect(coreUpdateReceipt({ ...INSTALLED, outcome: "failed", reason: "digest-mismatch" })).toEqual({
      tone: "error",
      textKey: "network.core.update.reason.digest-mismatch",
      detail: null,
    } satisfies CoreReceiptShape);
    expect(coreUpdateReceipt({ ...INSTALLED, outcome: "failed", reason: null })).toEqual({
      tone: "error",
      textKey: "network.core.update.outcome.failed",
      detail: null,
    } satisfies CoreReceiptShape);
    // 非失败时就算账上还挂着旧 reason，也不许拿它当这句话——「装上了」后面不能跟一句「摘要不符」。
    expect(coreUpdateReceipt({ ...INSTALLED, reason: "digest-mismatch" })!.textKey)
      .toBe("network.core.update.outcome.installed");
  });

  it("detail 照抄回执里那份，不自己拼", () => {
    expect(coreUpdateReceipt({ ...INSTALLED, detail: "sha256 前 8 位 1f3a9c20" })!.detail).toBe("sha256 前 8 位 1f3a9c20");
  });

  /** 账上一次都没落下＝main 那侧被绕过；这时候闭嘴比编一句「更新完成」诚实。 */
  it("没有更新记录时不造回执", () => {
    expect(coreUpdateReceipt(null)).toBeNull();
  });

  it("常驻那行读得出下场、原因与版本号", () => {
    const line = coreUpdateLine({ ...INSTALLED, outcome: "failed", reason: "no-asset" }, INSTALLED.at + 90_000);
    expect(line).toEqual({
      tone: "error",
      outcomeKey: "network.core.update.outcome.failed",
      reasonKey: "network.core.update.reason.no-asset",
      tag: "v1.19.33",
      agoMs: 90_000,
    });
    // 成功那一档不挂 reason，页面就没有第二段红字可画。
    expect(coreUpdateLine(INSTALLED, INSTALLED.at + 1_000)!.reasonKey).toBeNull();
  });

  it("时钟倒挂与没试过更新都不给「多久前」", () => {
    expect(coreUpdateLine(INSTALLED, INSTALLED.at - 1)!.agoMs).toBeNull();
    expect(coreUpdateLine(INSTALLED, INSTALLED.at)!.agoMs).toBe(0);
    expect(coreUpdateLine(null, INSTALLED.at)).toBeNull();
  });

  /** 问到发布页之前就失败时 tag 是 null：这一行不能画出「v?」，更不能猜一个版本号。 */
  it("没问到版本号时 tag 就是 null", () => {
    expect(coreUpdateLine({ ...INSTALLED, tag: null, asset: null }, INSTALLED.at)!.tag).toBeNull();
  });
});

describe("内核卡片的 i18n 锁：每档枚举都得有三种语言的话", () => {
  const keys = [
    ...CORE_STATES.map(coreStateKey),
    ...CORE_MODES.map(coreModeKey),
    coreModeKey(null),
    ...CORE_REASONS.map(coreReasonKey),
    ...CORE_SECRET_SOURCES.map(coreSecretKey),
    ...CORE_UPDATE_OUTCOMES.map(coreUpdateKey),
    ...CORE_UPDATE_REASONS.map(coreUpdateReasonKey),
    "network.core.update.button",
    "network.core.update.lastLabel",
    "network.core.update.ago",
    "network.core.update.firstHint",
  ];

  it.each(keys)("%s 三种语言都有非空值", (key) => {
    for (const locale of Object.keys(RESOURCES)) {
      const value = leaf(locale, key);
      expect(typeof value, `${locale} · ${key}`).toBe("string");
      expect((value as string).trim(), `${locale} · ${key}`).not.toBe("");
    }
  });

  /**
   * 正对照：上面那张表是代码里生成的，路径写错或 CORE_REASONS 被清空都会「全绿地空转」。
   * 这条按源码扫：组件与 core-view 里写死的每一把 network.core.* 都得落到一句人话。
   */
  it("卡片与判定层里写死的每个 key 三种语言都有值", () => {
    const files = ["CoreSection.tsx", "core-view.ts"];
    const keys = new Set<string>();
    for (const file of files) {
      const src = readFileSync(resolve(__dirname, file), "utf8");
      for (const match of src.matchAll(/"(network\.core\.[A-Za-z0-9_.]+)"/g)) keys.add(match[1]);
    }
    const list = [...keys];
    expect(list.length, "一把 key 都没扫到，尺子本身坏了").toBeGreaterThan(10);
    for (const key of list) {
      for (const locale of Object.keys(RESOURCES)) {
        const value = leaf(locale, key);
        expect(typeof value, `${locale} · ${key}`).toBe("string");
        expect((value as string).trim(), `${locale} · ${key}`).not.toBe("");
      }
    }
  });

  /**
   * 反向那一半：词表里不许留「没人生产」的词。
   *
   * 上面两条都只朝一个方向量（枚举 → 三种语言里有这句话），所以「语言里挂着一档进程
   * 永远说不出来的原因」这种形状两头都不红——T10 收口时 `CORE_REASONS` 里那四档
   * 下载/摘要/解压的词就是这么活下来的：它们从来不是 `core-manager` 的产出，而 T11
   * 给更新另起了 `CORE_UPDATE_REASONS`，那四档从此不会有生产者。于是这里把尺反过来拿：
   * `network.core.reason` 底下挂的 key 必须与枚举一一对上，两本词表还必须互不相交——
   * 一旦共用一档，「用更新的话解释进程」就会从缝隙里钻回页面。
   */
  it("进程那本词表不许留没人生产的词，两本词表不许共用一档", () => {
    const shared = CORE_REASONS.filter((reason) =>
      (CORE_UPDATE_REASONS as readonly string[]).includes(reason)
    );
    expect(shared).toEqual([]);
    for (const locale of Object.keys(RESOURCES)) {
      const process = leaf(locale, "network.core.reason") as Record<string, string>;
      expect(Object.keys(process).sort(), `${locale} 的进程词表`).toEqual([...CORE_REASONS].sort());
      const update = leaf(locale, "network.core.update.reason") as Record<string, string>;
      expect(Object.keys(update).sort(), `${locale} 的更新词表`).toEqual([...CORE_UPDATE_REASONS].sort());
    }
  });
});
