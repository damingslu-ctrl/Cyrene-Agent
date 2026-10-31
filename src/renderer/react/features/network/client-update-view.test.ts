import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import en from "../../i18n/en.json";
import jaJP from "../../i18n/ja-JP.json";
import zhCN from "../../i18n/zh-CN.json";
import {
  CLIENT_CHECK_OUTCOMES,
  CLIENT_DOWNLOAD_OUTCOMES,
  CLIENT_INSTALL_OUTCOMES,
  CLIENT_UPDATE_PHASES,
  CLIENT_UPDATE_REASONS,
  type ClientCheckReceipt,
  type ClientDownloadReceipt,
  type ClientInstallReceipt,
  type ClientUpdateSave,
  type ClientUpdateState,
  type ClientUpdateView,
} from "../../../../shared/client-update-types";
import {
  CLIENT_CONFIRM_WINDOW_MS,
  CLIENT_CHECK_KEYS,
  CLIENT_DOWNLOAD_KEYS,
  CLIENT_INSTALL_KEYS,
  CLIENT_PHASE_KEYS,
  CLIENT_REASON_KEYS,
  clientActionFailureKey,
  clientActions,
  clientBusy,
  clientCheckKey,
  clientCheckLine,
  clientConfirmAlive,
  clientDownloadKey,
  clientDownloadLine,
  clientInstallKey,
  clientInstallLine,
  clientLeadKey,
  clientPhaseKey,
  clientReasonKey,
  clientSaveLine,
  clientTargetVersion,
  clientTone,
  type ClientAction,
} from "./client-update-view";

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

const AT = 1_732_000_000_000;
const NOW = AT + 60_000;

const check = (over: Partial<ClientCheckReceipt> = {}): ClientCheckReceipt => ({
  outcome: "available",
  at: AT,
  latestVersion: "1.16.0",
  reason: null,
  detail: null,
  ...over,
});
const download = (over: Partial<ClientDownloadReceipt> = {}): ClientDownloadReceipt => ({
  outcome: "ready",
  at: AT,
  version: "1.16.0",
  fileName: "Mochi-Setup-1.16.0.exe",
  bytes: 289_746_294,
  reason: null,
  detail: null,
  ...over,
});
const install = (over: Partial<ClientInstallReceipt> = {}): ClientInstallReceipt => ({
  outcome: "launched",
  at: AT,
  version: "1.16.0",
  reason: null,
  detail: null,
  ...over,
});

const state = (over: Partial<ClientUpdateState> = {}): ClientUpdateState => ({
  currentVersion: "1.15.0",
  autoCheck: true,
  phase: "idle",
  check: null,
  download: null,
  install: null,
  ...over,
});
const view = (over: Partial<ClientUpdateState> = {}, saved: ClientUpdateSave | null = null): ClientUpdateView => ({
  ...state(over),
  saved,
});

describe("client-update-view：词表与枚举一一对上", () => {
  it("四档阶段、三档检查、两档下载、两档安装、十四档原因各映射到自己的 key", () => {
    expect(CLIENT_PHASE_KEYS).toEqual(CLIENT_UPDATE_PHASES.map(clientPhaseKey));
    expect(CLIENT_CHECK_KEYS).toEqual(CLIENT_CHECK_OUTCOMES.map(clientCheckKey));
    expect(CLIENT_DOWNLOAD_KEYS).toEqual(CLIENT_DOWNLOAD_OUTCOMES.map(clientDownloadKey));
    expect(CLIENT_INSTALL_KEYS).toEqual(CLIENT_INSTALL_OUTCOMES.map(clientInstallKey));
    expect(CLIENT_REASON_KEYS).toEqual(CLIENT_UPDATE_REASONS.map(clientReasonKey));
    // 数量本身也是尺：少一档就是有人在枚举里加了词而映射表没跟上。
    expect([CLIENT_UPDATE_PHASES.length, CLIENT_CHECK_OUTCOMES.length, CLIENT_DOWNLOAD_OUTCOMES.length, CLIENT_INSTALL_OUTCOMES.length, CLIENT_UPDATE_REASONS.length]).toEqual([4, 3, 2, 2, 14]);
  });

  it("三本账的词表不共用一支 key：读混了就等于拿下载的话解释安装", () => {
    const all = [...CLIENT_CHECK_KEYS, ...CLIENT_DOWNLOAD_KEYS, ...CLIENT_INSTALL_KEYS, ...CLIENT_PHASE_KEYS];
    expect(new Set(all).size, all.join(", ")).toBe(all.length);
  });
});

describe("client-update-view：三颗按钮该不该按下去", () => {
  it("只有 idle 算闲着：败与成都退回 idle，昨天那次失败不许读成还在跑", () => {
    expect(clientBusy("idle")).toBe(false);
    expect(CLIENT_UPDATE_PHASES.filter(clientBusy)).toEqual(["checking", "downloading", "installing"]);
  });

  it("闸门只在 main 那一侧：没包、内核在跑、检查刚败都不许让页面自己把按钮灰掉", () => {
    // 这一条的形状就是它的口径：`clientActions` 只接 busy 与 armed 两个布尔，
    // 手上有没有包、内核跑不跑都递不进来——复算出来的灰是「没人知道为什么灰的按钮」。
    expect(clientActions(false, false)).toEqual({
      check: true,
      download: true,
      install: true,
      installLabelKey: "network.clientUpdate.install.button",
    });
    expect(clientActions(true, false)).toEqual({
      check: false,
      download: false,
      install: false,
      installLabelKey: "network.clientUpdate.install.button",
    });
  });

  it("武装中那颗安装要说「再按一次」，不许顶着按钮名骗一次点击", () => {
    expect(clientActions(false, true).installLabelKey).toBe("network.clientUpdate.installConfirm");
    expect(clientActions(true, true).check).toBe(false);
  });
});

describe("client-update-view：卡片顶那句说明的优先级", () => {
  it("在途排第一：那一趟正在重写检查那本账，读旧账会说成「已经发现了新版」", () => {
    for (const phase of ["checking", "downloading", "installing"] as const) {
      const busy = view(state({ phase, check: check(), download: download(), install: install() }));
      expect(clientLeadKey(busy), phase).toBe(`network.clientUpdate.lead.${phase}`);
    }
  });

  it("有包可装排在检查之前：三本账互不作废落到页面上就是这个次序", () => {
    const readyButCheckFailed = view(state({ check: check({ outcome: "failed", latestVersion: null, reason: "network-failed" }), download: download() }));
    expect(clientLeadKey(readyButCheckFailed)).toBe("network.clientUpdate.lead.ready");
    const launchedFirst = view(state({ download: download(), install: install() }));
    expect(clientLeadKey(launchedFirst)).toBe("network.clientUpdate.lead.launched");
  });

  it("查得到、本来就是这版、从没查过、检查败了——四种各说一句，绝不共用", () => {
    expect(clientLeadKey(view(state({ check: check() })))).toBe("network.clientUpdate.lead.available");
    expect(clientLeadKey(view(state({ check: check({ outcome: "latest" }) }))))
      .toBe("network.clientUpdate.lead.latest");
    expect(clientLeadKey(view(state()))).toBe("network.clientUpdate.lead.never");
    expect(clientLeadKey(view(state({ check: check({ outcome: "failed", reason: "network-failed" }) }))))
      .toBe("network.clientUpdate.lead.checkFailed");
  });
});

describe("client-update-view：脸色只给坏消息上色", () => {
  it("latest / available / ready / launched 都是 ok：一次问得出结果的检查不是失败", () => {
    expect(clientTone("latest", null)).toBe("ok");
    expect(clientTone("available", null)).toBe("ok");
    expect(clientTone("ready", null)).toBe("ok");
    expect(clientTone("launched", null)).toBe("ok");
  });

  it("in-flight 与 core-running 是中性：一个说「你没等到」，一个说「按设计这次不换」", () => {
    expect(clientTone("failed", "in-flight")).toBe("neutral");
    expect(clientTone("failed", "core-running")).toBe("neutral");
  });

  it("其余十三档失败都染红，一档都不许漏", () => {
    const reds = CLIENT_UPDATE_REASONS.filter((reason) => !["in-flight", "core-running"].includes(reason));
    expect(reds.length).toBe(12);
    for (const reason of reds) expect(clientTone("failed", reason), reason).toBe("error");
  });

  it("败了但没带原因时也染红，不许读成中性", () => {
    expect(clientTone("failed", null)).toBe("error");
  });
});

describe("client-update-view：三本账各画一行", () => {
  it("检查那行把版本号原样端出来：latest 与 failed 读到了也说得出", () => {
    const line = clientCheckLine(check({ outcome: "latest", latestVersion: "1.15.0" }), NOW);
    expect(line).not.toBeNull();
    expect(line?.version).toBe("1.15.0");
    expect(line?.outcomeKey).toBe("network.clientUpdate.check.latest");
    expect(line?.tone).toBe("ok");
    expect(line?.agoMs).toBe(60_000);
  });

  it("时钟倒挂时不给「多久前」：「-40 分钟前」不是一句人话", () => {
    const line = clientCheckLine(check({ at: NOW + 40_000 }), NOW);
    expect(line?.agoMs).toBeNull();
  });

  it("没落笔的那本就是 null，不造一行空账", () => {
    expect(clientCheckLine(null, NOW)).toBeNull();
    expect(clientDownloadLine(null, NOW)).toBeNull();
    expect(clientInstallLine(null, NOW)).toBeNull();
  });

  it("下载那行只有 ready 才报体积：败的那趟盘上没东西，画出来是「已经下了 0 B」", () => {
    expect(clientDownloadLine(download(), NOW)?.bytes).toBe(289_746_294);
    const failed = clientDownloadLine(download({ outcome: "failed", bytes: 0, reason: "write-failed", detail: "盘满" }), NOW);
    expect(failed?.bytes).toBeNull();
    expect(failed?.fileName).toBe("Mochi-Setup-1.16.0.exe");
    expect(failed?.reasonKey).toBe("network.clientUpdate.reason.write-failed");
    expect(failed?.detail).toBe("盘满");
  });

  it("安装那行的版本号是包那一版，不是本机那一版", () => {
    const line = clientInstallLine(install({ outcome: "failed", version: "1.16.0", reason: "stale-package" }), NOW);
    expect(line?.version).toBe("1.16.0");
    expect(line?.tone).toBe("error");
    expect(line?.reasonKey).toBe("network.clientUpdate.reason.stale-package");
  });
});

describe("client-update-view：版本差、落盘与确认窗", () => {
  it("只有真有更靠前的那一版才报「可装」：本来就是这版不许说成还有一件事没做完", () => {
    expect(clientTargetVersion(view(state({ check: check() })))).toBe("1.16.0");
    expect(clientTargetVersion(view(state({ check: check({ outcome: "latest", latestVersion: "1.15.0" }) }))))
      .toBeNull();
    expect(clientTargetVersion(view(state({ check: check({ latestVersion: "1.15.0" }) }))))
      .toBeNull();
    expect(clientTargetVersion(view(state({ check: check({ outcome: "failed", reason: "network-failed" }) }))))
      .toBeNull();
  });

  it("落盘三态：null 不许演成成功；败了要说「内存改了、盘上没住」", () => {
    expect(clientSaveLine(null)).toBeNull();
    expect(clientSaveLine({ ok: true, detail: null })).toEqual({ tone: "ok", textKey: "network.clientUpdate.save.ok" });
    expect(clientSaveLine({ ok: false, detail: "盘只读" })).toEqual({ tone: "error", textKey: "network.clientUpdate.save.failed" });
  });

  it("安装那一下没回音不等于没装：那句说的是「可能已经起来了」，其余两条照说失败", () => {
    // 断的是 catch 那一路的话术：`launched` 之后回执可能根本发不出去。
    const keys = (["check", "download", "install"] as const).map((action: ClientAction) => clientActionFailureKey(action));
    expect(keys).toEqual([
      "network.clientUpdate.ipcFailed",
      "network.clientUpdate.ipcFailed",
      "network.clientUpdate.installNoReply",
    ]);
  });

  it("确认窗只认那一窗之内：没武装、超窗、时钟倒挂都不算武装", () => {
    expect(clientConfirmAlive(null, NOW)).toBe(false);
    expect(clientConfirmAlive(NOW, NOW)).toBe(true);
    expect(clientConfirmAlive(NOW - CLIENT_CONFIRM_WINDOW_MS, NOW)).toBe(true);
    expect(clientConfirmAlive(NOW - CLIENT_CONFIRM_WINDOW_MS - 1, NOW)).toBe(false);
    expect(clientConfirmAlive(NOW + 1, NOW)).toBe(false);
    expect(CLIENT_CONFIRM_WINDOW_MS).toBe(10_000);
  });
});

describe("更新卡片的 i18n 锁：每档枚举都得有三种语言的话", () => {
  const keys = [
    ...CLIENT_PHASE_KEYS,
    "network.clientUpdate.phase.unread",
    ...CLIENT_CHECK_KEYS,
    ...CLIENT_DOWNLOAD_KEYS,
    ...CLIENT_INSTALL_KEYS,
    ...CLIENT_REASON_KEYS,
    ...["checking", "downloading", "installing", "launched", "ready", "available", "latest", "never", "checkFailed"].map(
      (arm) => `network.clientUpdate.lead.${arm}`,
    ),
    "network.clientUpdate.check.button",
    "network.clientUpdate.download.button",
    "network.clientUpdate.install.button",
    "network.clientUpdate.check.label",
    "network.clientUpdate.download.label",
    "network.clientUpdate.install.label",
  ];

  it.each(keys)("%s 三种语言都有非空值", (key) => {
    for (const locale of Object.keys(RESOURCES)) {
      const value = leaf(locale, key);
      expect(typeof value, `${locale} · ${key}`).toBe("string");
      expect((value as string).trim(), `${locale} · ${key}`).not.toBe("");
    }
  });

  /**
   * 正对照：上面那张表是代码里生成的，路径写错或枚举被清空都会「全绿地空转」。
   * 这条按源码扫：卡片与判定层里写死的每一把 network.clientUpdate.* 都得落到一句人话。
   */
  it("卡片与判定层里写死的每个 key 三种语言都有值", () => {
    const files = ["ClientUpdateSection.tsx", "client-update-view.ts"];
    const found = new Set<string>();
    for (const file of files) {
      const src = readFileSync(resolve(__dirname, file), "utf8");
      for (const match of src.matchAll(/"(network\.clientUpdate\.[A-Za-z0-9_.]+)"/g)) found.add(match[1]);
    }
    const list = [...found];
    expect(list.length, "一把 key 都没扫到，尺子本身坏了").toBeGreaterThan(20);
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
   * `reason` 那把尺两头都量：语言文件里挂的档位必须与 `CLIENT_UPDATE_REASONS` 一一对上。
   * T11 那四档没人生产的下载/摘要词就是这么活下来的——只朝一个方向量，
   * 「语言里多了一句进程永远说出来的一档」这种形状两头都不红。
   */
  it("四本词表与枚举一一对上，一处不多一处不少", () => {
    const tables: [string, readonly string[]][] = [
      ["reason", CLIENT_UPDATE_REASONS],
      ["phase", CLIENT_UPDATE_PHASES],
      ["check", CLIENT_CHECK_OUTCOMES],
      ["download", CLIENT_DOWNLOAD_OUTCOMES],
      ["install", CLIENT_INSTALL_OUTCOMES],
    ];
    for (const locale of Object.keys(RESOURCES)) {
      for (const [table, enumValues] of tables) {
        const node = leaf(locale, `network.clientUpdate.${table}`) as Record<string, string>;
        const arms = Object.keys(node).filter((key) => (enumValues as readonly string[]).includes(key));
        expect(arms.sort(), `${locale} · network.clientUpdate.${table}`).toEqual([...enumValues].sort());
      }
    }
  });

  /**
   * `phase` 与 `check` 那两本底下除了枚举还挂着页面自己用的档位（`unread` / `button` / `label`），
   * 所以上面只比枚举那一部分。这一条把剩下的部分钉死：除枚举外**只许**有那几支，
   * 多出来的一档没人生产，少一支就是卡片上的 key 落空。
   */
  it("枚举之外的分支只有点名那几支", () => {
    for (const locale of Object.keys(RESOURCES)) {
      const phaseTable = leaf(locale, "network.clientUpdate.phase") as Record<string, string>;
      expect(Object.keys(phaseTable).sort(), `${locale} · phase`).toEqual([...CLIENT_UPDATE_PHASES, "unread"].sort());
      const checkTable = leaf(locale, "network.clientUpdate.check") as Record<string, string>;
      expect(Object.keys(checkTable).sort(), `${locale} · check`).toEqual([...CLIENT_CHECK_OUTCOMES, "button", "label"].sort());
    }
  });

  /**
   * 那句「升级成功」是这张卡最贵的假话：`launched` 之后这个进程就没了，装好没装好无从知道。
   * 所以这里不只锁 key，还锁措辞——三种语言都不许出现「成功/完了」那一类收口话，
   * 而且都必须点出「下一次启动的版本号才是凭据」这条唯一的出口。
   */
  it("launched 那句话不许冒充升级成功，必须把凭据交给下一次启动", () => {
    const forbidden = /升级成功|升级完成|已升级|安装成功|successfully|succeeded|完了しました|正常に/;
    for (const locale of Object.keys(RESOURCES)) {
      const text = leaf(locale, "network.clientUpdate.install.launched") as string;
      expect(text, `${locale} 的 launched 措辞`).toBeTruthy();
      expect(text, `${locale} 的 launched 不许冒领结果`).not.toMatch(forbidden);
      expect(text, `${locale} 的 launched 要把凭据交给下一次启动`).toMatch(/下一次启动|下次启动|next start|next launch|次の起動/);
    }
  });
});
