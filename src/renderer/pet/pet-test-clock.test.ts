/**
 * 桌宠单测的「基准时刻」必须是本地分量构造，不许是固定瞬间。
 *
 * 起因（2026-11-01，本 fork 头一趟真跑起来的 Test workflow）：CI 的 windows runner 在 UTC，
 * `src/renderer/pet/companion.test.ts` 那句 `expect(GIRL_LINES.wake).toContain(...)` 当场红了，
 * 而本机 +08:00 一直绿。根因不在断言，在基准：`const T0 = 1_700_000_000_000;` 是一颗**固定瞬间**，
 * 它的本地小时随运行机器时区变（+08:00 是早上 6 点，UTC 是晚上 22 点）；引擎的挂钟缺省就落在这颗数上
 * （companion.ts 的 `wallNow ?? now`），于是凡是没显式钉 `wallNow` 的档都会跟着换一套作息语料——
 * 那一趟红的是「白天被吓醒」那句，实际读到的是深夜那套「嘘——」。
 *
 * 判据不是「那颗文件在不在」，是**四件事同时成立**：走查真有射程（A）、谓词自己钉着对照（B）、
 * 射程内每颗文件都不许用固定瞬间当基准（C）、以及按正确写法造的基准在**缺省挂钟**下真的取到白天语料（E）。
 * B 是上一轮 `scripts/` 门禁那条教训的复刻：匹配器一旦「什么都匹配不到」，C 就数不到越界者，
 * 整档会空跑成绿——所以谓词要拿钉死的样本行当场照一遍，包括几种「合法写法不许误红」与「拆行的越界写法必须红」。
 *
 * 射程里的两类越界（2026-11-01 实测：射程 110 颗文件，两类各 0 颗越界）：
 *   ① 裸瞬间字面量——量级 ≥ 1e11 毫秒的整数出现在代码里（不限声明位：`new Date(1_7e12)`、
 *     `dayPartOf(1_7e12)` 这种直接当参数喂给作息函数的，跟当基准用是同一颗雷）。
 *   ② 裸数字基准——被注入成引擎时钟（`now: () => NAME`／`wallNow: () => NAME`，或经一跳
 *     `let t = NAME;` 再注入）的那个名字，其模块作用域声明的右侧是一个裸整数。这一型**不看量级**：
 *     把基准写成 `10_000` 一样是固定瞬间（+08:00 落在早上 8 点、UTC 落在半夜 0 点），只是它跟
 *     「秒表起点／相对时长」在形状上不可区分，所以只能靠「它有没有去当引擎的钟」来判，不能靠数位数。
 *
 * 明知在射程外、写清楚不假称覆盖的两型：测试体内 `let t = 0;` 这种相对起点（多数档不断作息语料，
 * 全判会把合法写法一起锁死）；把基准搬到共享 helper 后文件里没有本地声明（那时由 helper 自己守）。
 * 这两型靠评审与 E 的语义兜，不靠 C——把「看不见」说成「没有」是这一类锁最常见的假绿。
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CompanionEngine, GIRL_LINES } from "./companion";

const petRoot = path.join(process.cwd(), "src", "renderer", "pet");
const SELF = "pet-test-clock.test.ts";

/**
 * 「固定瞬间」的下界：1e11 毫秒 = 1973 年之后的任何时刻都算，同时给相对时长留够余量
 * （一年才 3.15e10，写到 1e11 以上的「时长」在这些单测里不存在）。
 * 低于这条线的秒表起点（`girl-idle.test.ts` 的 `1_000_000`、`girl-scene.test.ts` 的 `10_000`）
 * 不判裸数字这一型——它们不造引擎、也不挂钟；判了会让锁误红，反而没人敢改测试。
 * 同一条数一旦去当引擎的钟，由第②类咬住，不看量级。
 */
const EPOCH_INSTANT_FLOOR = 1e11;

/** 模块作用域的「名字 = 一个裸整数」声明（行首不缩进）。 */
const MODULE_BARE_DECL = /^(?:export\s+)?(?:const|let)\s+([A-Za-z0-9_$]+)\s*=\s*(\d[\d_]*)\s*;?\s*$/;

const NUM_TOKEN = /\d[\d_]*/g;
const QUOTED = /"[^"]*"|'[^']*'|`[^`]*`/g;
/** 注入为引擎时钟的形态：箭头直通，或 `now: NAME` 直接把名字挂上去。 */
const CLOCK_INJECTION = /(?:\bnow|\bwallNow)\s*:\s*(?:\(\)\s*=>\s*|[a-zA-Z_$]+\s*=>\s*)?([A-Za-z0-9_$]+)/g;
/** 一跳：`let t = NAME;`——可变钟从模块那颗基准取初值，所以基准名在赋值号右边。 */
function seedSourceOf(name: string): RegExp {
  return new RegExp(`(?:let|const)\\s+${name}\\s*=\\s*([A-Za-z0-9_$]+)\\s*;`);
}

/** 注释里的数字不是代码，字符串里的长数字多半是摘要／id：都不许算成越界。 */
function codePart(line: string): string {
  const cut = line.indexOf("//");
  return (cut === -1 ? line : line.slice(0, cut)).replace(QUOTED, '""');
}

/**
 * 一行的越界读数（第①类）：命中就返回越界形态的名字，否则 null。
 * `+=`、时长常量与增量都低于下界，所以 `t += 86_400_000;` 不该被咬。
 */
function fixedInstantForm(line: string): string | null {
  for (const token of codePart(line).match(NUM_TOKEN) ?? []) {
    if (Number(token.replace(/_/g, "")) >= EPOCH_INSTANT_FLOOR) return `裸 epoch 字面量 ${token}`;
  }
  return null;
}

/**
 * 把 `=\n` 折回同一行：声明拆成两行（`const T0 =` / 换行 / `  1_700_000_000_000;`）也是同一颗雷，
 * 按原文逐行扫会「看不见」——少认这一型，那颗文件就从走查里蒸发，C 便空跑成绿。
 * 折行后行号仍指向声明起手的这一行，报错才点得出位置。
 */
function logicalLines(src: string): { no: number; text: string }[] {
  const raw = src.split(/\r?\n/);
  const out: { no: number; text: string }[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const no = i + 1;
    let text = raw[i];
    if (/=\s*$/.test(codePart(text)) && i + 1 < raw.length) {
      text = `${text.trimEnd()} ${raw[i + 1].trim()}`;
      i += 1;
    }
    out.push({ no, text });
  }
  return out;
}

interface Offender {
  file: string;
  line: number;
  form: string;
  text: string;
}

function engineTestFiles(): string[] {
  return readdirSync(petRoot)
    .filter((name) => name.endsWith(".test.ts") && name !== SELF)
    .sort();
}

/** 合法写法的形状：本地分量构造的时刻。年月日时分都可以改，形状不许改成固定瞬间。 */
const LOCAL_COMPONENT_BASE = /=\s*new Date\(\s*\d{4}\s*,\s*\d{1,2}\s*,\s*\d{1,2}\s*,\s*\d{1,2}/;

/**
 * 一颗文件里「去当了引擎的钟」的名字集合，加上经由一跳 `let t = NAME;` 接过去的基准名。
 * 判据落在「有没有挂钟」而不是「数字多大」，所以 `10_000` 当引擎时钟也照样是固定瞬间。
 */
function clockSeededNames(src: string): Set<string> {
  const injected = new Set<string>();
  for (const m of src.matchAll(CLOCK_INJECTION)) injected.add(m[1]);
  const out = new Set<string>(injected);
  for (const name of injected) {
    const hop = src.match(seedSourceOf(name));
    if (hop) out.add(hop[1]);
  }
  return out;
}

/** 第②类：模块作用域那颗裸数字声明，一旦其名字在时钟注入集合里，就是固定瞬间基准。 */
function bareClockBaseForm(src: string): { line: number; form: string; text: string }[] {
  const seeds = clockSeededNames(src);
  if (seeds.size === 0) return [];
  const hits: { line: number; form: string; text: string }[] = [];
  for (const { no, text } of logicalLines(src)) {
    if (/^\s/.test(text)) continue; // 只看模块作用域：测试体内的相对起点在射程外，写在文件头
    const m = codePart(text).trim().match(MODULE_BARE_DECL);
    if (m && seeds.has(m[1])) {
      hits.push({ line: no, form: `裸数字基准 ${m[1]} = ${m[2]}`, text: text.trim() });
    }
  }
  return hits;
}

function scanFixedInstants(): Offender[] {
  const hits: Offender[] = [];
  for (const name of engineTestFiles()) {
    const src = readFileSync(path.join(petRoot, name), "utf8");
    for (const { no, text } of logicalLines(src)) {
      const form = fixedInstantForm(text);
      if (form) hits.push({ file: name, line: no, form, text: text.trim() });
    }
    for (const o of bareClockBaseForm(src)) hits.push({ ...o, file: name });
  }
  return hits;
}

describe("桌宠单测的基准时刻不许是固定瞬间", () => {
  it("A 走查真有射程（空走查不许读成绿）", () => {
    const files = engineTestFiles();
    expect(files.length).toBeGreaterThan(0);
    // 正对照：上一轮红的那颗必须在射程里，且它的基准确实读得到。
    expect(files).toContain("companion.test.ts");
    const sources = new Map(files.map((name) => [name, readFileSync(path.join(petRoot, name), "utf8")]));
    expect(sources.get("companion.test.ts")).toMatch(LOCAL_COMPONENT_BASE);
    // 这一型在造引擎的文件里各处都有：少于 10 颗＝基准声明被改没了，走查于是看不见东西，
    // C 会空跑成绿（2026-11-01 实测：整档形状 11 颗、模块作用域那颗基准 10 颗 / 射程 110 颗）。
    // 认形状不认字面——换年月日、改名字都不该让 A 红，钉死字面就是钉错方向的锁。
    const withLocalBase = files.filter((name) => LOCAL_COMPONENT_BASE.test(sources.get(name) ?? ""));
    expect(withLocalBase.length).toBeGreaterThanOrEqual(10);
    // 计数只是「射程非空」的旁证；真正逐颗咬住基准的是 C 的第②类——
    // 一颗文件即使还留着别的分量 Date，它那颗被改成裸数字的模块基准也会被点名。
  });

  it("B 谓词自己钉着对照（合法写法不误红、越界写法不许隐身）", () => {
    // 越界侧：整句裸字面量 + 拆成两行的同一颗 + 不当声明也算的调用位。
    expect(fixedInstantForm("const T0 = 1_700_000_000_000;")).toContain("裸 epoch 字面量");
    expect(fixedInstantForm("const T0 =\n  1_700_000_000_000;")).toContain("裸 epoch 字面量");
    expect(fixedInstantForm("expect(dayPartOf(1_700_000_000_000)).toBe(\"night\");")).toContain("裸 epoch 字面量");
    expect(fixedInstantForm("const at = new Date(1_700_000_000_000);")).toContain("裸 epoch 字面量");
    // 合法侧：本地分量构造 / 相对时长 / 秒表起点 / 注释里的自述 / 增量 / 字符串里的长数字。
    expect(fixedInstantForm("const T0 = new Date(2023, 10, 15, 6, 13, 20).getTime();")).toBeNull();
    expect(fixedInstantForm("const YEAR_MS = 31_536_000_000;")).toBeNull();
    expect(fixedInstantForm("const T0 = 1_000_000;")).toBeNull();
    expect(fixedInstantForm("// 原来那颗 1_700_000_000_000 是固定瞬间")).toBeNull();
    expect(fixedInstantForm("    t += 86_400_000;")).toBeNull();
    expect(fixedInstantForm('const blob = "sha256:1700000000000170000000000";')).toBeNull();
    // 折行还得保住行号：被吞进去的那一行不许重复报，报出来的仍是声明起手那一行。
    // 结尾的 5 是文件末尾换行带出的空行，不是漏报。
    const folded = logicalLines("const A = 1;\nconst T0 =\n  1_700_000_000_000;\nconst B = 2;\n");
    expect(folded.map((l) => l.no)).toEqual([1, 2, 4, 5]);
    expect(fixedInstantForm(folded[1].text)).toContain("裸 epoch 字面量");
    // 第②类的对照：同样一颗 `10_000`，挂上引擎的钟就越界，只做秒表起点就合法。
    const injected = ["const T0 = 10_000;", "const e = new CompanionEngine({ now: () => T0 });"].join("\n");
    expect(bareClockBaseForm(injected).map((o) => `${o.line} ${o.form}`)).toEqual(["1 裸数字基准 T0 = 10_000"]);
    const hop = [
      "const T0 = 1_000;",
      "it(\"x\", () => {",
      "  let t = T0;",
      "  const e = new CompanionEngine({ storage, now: () => t });",
      "});",
    ].join("\n");
    expect(bareClockBaseForm(hop).map((o) => `${o.line} ${o.form}`)).toEqual(["1 裸数字基准 T0 = 1_000"]);
    // 合法侧：分量基准挂着钟 / 纯模块测试拿它当秒表 / 时长只做增量。
    expect(bareClockBaseForm(["const T0 = new Date(2023, 10, 15, 6, 13, 20).getTime();", "const e = new CompanionEngine({ now: () => T0 });"].join("\n"))).toEqual([]);
    expect(bareClockBaseForm(["const T0 = 10_000;", "const scene = new GirlScenePlayer(pose(\"stand\"), T0);"].join("\n"))).toEqual([]);
    expect(bareClockBaseForm(["const YEAR_MS = 31_536_000_000;", "  t += YEAR_MS;"].join("\n"))).toEqual([]);
    // 时钟注入集合自己也得有正对照：少了它，第②类会谁都不咬，C 空跑成绿。
    // `wallNow` 那种简写挂钟不是基准（值在别处），所以它不进集合——写在这里是给下一轮的人看形状。
    expect([...clockSeededNames("const e = new CompanionEngine({ now: () => t, wallNow });")]).toEqual(["t"]);
    expect([...clockSeededNames("const e = new CompanionEngine({ now: () => t, wallNow: () => WALL });")].sort()).toEqual(["WALL", "t"]);
    // 一跳也得有正对照：`let t = T0;` 之后注入的是 t，越界那颗写在 T0 上——只认直通的话第②类会漏。
    expect([...clockSeededNames("let t = T0;\nconst e = new CompanionEngine({ now: () => t });")].sort()).toEqual(["T0", "t"]);
  });

  it("C 射程内每颗文件都没有固定瞬间基准", () => {
    const offenders = scanFixedInstants();
    expect(offenders.map((o) => `${o.file}:${o.line} ${o.form} ← ${o.text}`)).toEqual([]);
  });

  it("E 按正确写法造的基准，缺省挂钟下取的就是白天那套语料", () => {
    // 这一条管「换算写对了没有」：分量抄成 23 点，+08:00 与 UTC 两侧都会红在这里。
    const base = new Date(2023, 10, 15, 6, 13, 20).getTime();
    expect(new Date(base).getHours()).toBe(6);
    const data = new Map<string, string>();
    let t = base;
    const engine = new CompanionEngine({
      storage: {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => void data.set(key, value),
      },
      now: () => t,
      random: () => 0.5,
    });
    engine.setForm("girl");
    engine.toggleSleep(t);
    t += 500;
    engine.touch("feet", t);
    expect(GIRL_LINES.wake).toContain(engine.getSnapshot().bubble?.text);
  });
});
