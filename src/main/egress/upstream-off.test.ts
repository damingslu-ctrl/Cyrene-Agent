/**
 * 「不接收上游任何东西」的可判定契约（spec §3-A）。
 *
 * 为什么不是 grep 一下就完事：这条锁是**常驻**的。删掉公告、字体、更新器之后，
 * 后续任何改动只要把上游域名重新引回 src/，这里当场红。A 期的静态判据全押在这一个文件里，
 * 运行时那把尺（Task 6 的 egress 看门狗）负责证明「没有间接路径」，两把尺不互相替代。
 *
 * 每条规则自带正对照（`positiveControls`）：规则写坏了（转义吃掉、大小写改了）
 * 会在正对照这一行红，而不是安静地扫 0 个命中然后报 PASS——spec §4 的「尺自己崩了不许读成 PASS」。
 *
 * **A3 从 Wave 4 起是反向契约，不再只是一条禁令**。原来的口径是「把上游那套更新器拆干净」，
 * 判据只有「不许在」；现在客户端自己有更新通道（`src/main/update/`），只禁不够——
 * 三层必须同时成立才算这一条守住：
 *   1) 上游的更新器与发布源配置**不在**（`electron-updater`、`provider: github`）；
 *   2) 我们自己的通道**在**（service / 装配 / IPC 三个落点各自要留调用形状），
 *      且拦住旧通道的那两句反向锁（`publish: null`、`assertNoUpdateFeed`）字面在场；
 *   3) 更新面**只钉这两个仓库**（客户端 fork + `MetaCubeX/mihomo`，见文件末那段普查）。
 * 少了 2) 与 3)，「拆掉旧通道」这条路可以被一路改成「一个更新通道都没有」，
 * 也可以被改成「多一个没人审过的来源」——而这两档在「只禁」的静态面上都读成绿。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { scannedFiles, sourceFiles } from "./scan-source-files";
import { CLIENT_UPDATE_REPO } from "../update/github-release";
import { MIHOMO_RELEASE_API_URL } from "../verge/mihomo-update";

/** 锁自身必须排除：它的正对照字符串就是被禁标识，不排除会自炸。 */
const SELF = "upstream-off.test.ts";
/**
 * 根目录文件不属于任何扫描根，但 A3 的几条判据就住在它们里面：
 * `publish`/`provider` 在 `electron-builder.yml`，`electron-updater` 依赖在 `package.json`。
 * 不显式列出来的话，A3 会扫到一个空集合然后报 PASS——锁自己瞎了却读成「干净」。
 */

interface Rule {
  clause: string;
  pattern: RegExp;
  /**
   * 必须匹配的字面量：规则写坏了这里先红。
   * 是数组而非单值：一个 pattern 里并了几个分支（如 `autoUpdater` 与 `provider: github`）时，
   * 每个分支都要有自己的正对照，否则「哪个分支被写坏了」仍然看不出来。
   */
  positiveControls: string[];
  /** 逐文件例外，必须写理由；例外是显式破例，不是放宽判据。 */
  exceptions: Array<{ file: string; reason: string }>;
  /**
   * 反向判据：这条规则的命中是**要求**，不是禁止。
   * `required` 的规则断言「至少命中一次」；不写则维持「零命中」。
   * 目前只有 A6（看门狗在场）用它。
   */
  required?: boolean;
  /**
   * `required` 规则的额外落点：命中必须出现在这些文件里（相对仓库根，`/` 分隔）。
   * 没有它的话，只留 `egress-watchdog.ts` 的实现体就能让「至少命中一次」读成绿——
   * 组合根的装配被删掉也看不出来，自锁就成了摆设。
   */
  requiredIn?: string[];
}

const RULES: Rule[] = [
  {
    clause: "A1 公告",
    pattern:
      /cyrene-announcement|NEWS_GET|NEWS_UPDATED|useNewsFeed|news-feed|news:get|exposeInMainWorld\(\s*"news"|NewsItem|NewsDialog|news-types/i,
    positiveControls: ["https://gitee.com/playa0/cyrene-announcement/raw/main/"],
    exceptions: [],
  },
  {
    clause: "A2 字体远端",
    pattern: /fonts\.googleapis\.com|fonts\.gstatic\.com/i,
    positiveControls: ['@import url("https://fonts.googleapis.com/css2?family=JetBrains+Mono");'],
    exceptions: [
      {
        file: "features/chat/components/svg-sanitize.test.ts",
        reason:
          "Fixtures of the stripStyleImports regression test: the domain must appear in the input to prove the sanitizer deletes it.",
      },
      {
        file: "features/chat/components/svg-card-block.test.ts",
        reason:
          "Same reason: asserts renderSvgCardSafe strips a remote font @import from user SVG.",
      },
      {
        file: "features/chat/components/mermaid-block.test.ts",
        reason:
          "Same reason: asserts the mermaid pipeline emits no Google Fonts reference.",
      },
    ],
  },
  {
    clause: "A3 更新面",
    pattern: /electron-updater|APP_UPDATE_CHECK|autoUpdater|github-app-updater|scheduleStartupUpdateCheck/i,
    positiveControls: ['import { autoUpdater } from "electron-updater";'],
    exceptions: [
      { file: "scripts/verify/installer-artifacts.mjs", reason: "保留的是「latest.yml 不得出现」的反向锁，正文里必须写出这个文件名才能证明锁在生效" },
      {
        file: ".github/workflows/package-windows.yml",
        reason: "工作流注释记录「升级源已拆除」：必须写出 electron-updater / latest.yml 才能表达反向约束；该文件不参与打包",
      },
    ],
  },
  {
    clause: "A3 上游发布源",
    // `provider` 的值在 YAML 里可以带引号（`provider: "github"`），不带引号的写法只是其中一种：
    // 只认裸值等于让「加个引号」就能绕过这条锁。
    pattern: /provider:\s*["']?github|owner:\s*Playa-Cyrene|repo:\s*Cyrene-Agent/i,
    positiveControls: ["provider: github", 'provider: "github"', "provider: 'github'"],
    exceptions: [],
  },
  {
    clause: "A3 自研更新通道在场（service 构造）",
    // 反向判据：拆掉上游更新器之后，「客户端有自己的更新通道」这件事必须一直在代码里看得见。
    // 只认调用形状、不认裸标识：光留着 `createClientUpdateService` 的实现体而把装配摘掉，
    // 「更新」卡片会安静地从界面上消失，而按裸标识写的锁仍然绿（A6 踩过同一档）。
    //
    // 一个形状一条规则、一条规则一个落点，不并成一条三选一的 pattern：并起来的话，
    // 三个形状全住在组合根那一个文件里，摘掉其中任何一个，「命中文件集合 ⊇ 落点」照样成立——
    // 尺子量的是「这个文件里出现过点什么」，而那恰恰不是契约。IPC 注册被删时「更新」卡片仍在，
    // 只是点下去没有任何东西应答。
    pattern: /createClientUpdateService\s*\(/,
    positiveControls: ["createClientUpdateService({"],
    exceptions: [],
    required: true,
    requiredIn: ["src/main/update/update-bootstrap.ts"],
  },
  {
    clause: "A3 自研更新通道在场（组合根装配）",
    pattern: /createClientUpdateAssembly\s*\(/,
    positiveControls: ["createClientUpdateAssembly({"],
    exceptions: [],
    required: true,
    requiredIn: ["src/main/application/default-dependencies.ts"],
  },
  {
    clause: "A3 自研更新通道在场（IPC 注册）",
    pattern: /registerClientUpdateIpc\s*\(/,
    positiveControls: ["registerClientUpdateIpc(ipc, service)"],
    exceptions: [],
    required: true,
    requiredIn: ["src/main/application/default-dependencies.ts"],
  },
  {
    clause: "A3 发布源显式置空",
    // `publish: null` 是**显式**拦掉 electron-builder 的 origin 推断，不是「没配发布源」。
    // `no-publish-config.test.ts` 判的是「解析出来不是发布配置」——键被整个删掉时它仍然绿，
    // 而 CI 的 actions/checkout 会建出 origin，那时 electron-builder 自己造一个 GitHub
    // 发布源并产出 latest.yml（`d7c39d92` 那次就是这么红的）。所以要求这一行字面在场。
    pattern: /^publish:\s*null\s*$/m,
    positiveControls: ["publish: null"],
    exceptions: [],
    required: true,
    requiredIn: ["electron-builder.yml"],
  },
  {
    clause: "A3 旧通道反向锁在场",
    // 「产物里不许有 latest.yml」这句话本身也得被锁住：它住在 verify:installer 里。
    // 有人把这段反向锁删掉（或整个脚本删掉）时，`publish: null` 哪天被抹平就没有第二道拦的了。
    // 认函数调用形状而不是文件名：文件还在、判据被摘走，是最常见的一种「锁还在但其实没用」。
    pattern: /assertNoUpdateFeed\s*\(/,
    positiveControls: ["await assertNoUpdateFeed(outputDir)"],
    exceptions: [],
    required: true,
    requiredIn: ["scripts/verify/installer-artifacts.mjs"],
  },
  {
    clause: "A1/A3 编译前抹掉整棵输出",
    // P4 删了 `src/main/news`（公告）与 `src/main/updater`（更新器）两组源码，而 esbuild 只写
    // 这一趟编译到的文件、**不回收**上一次在而这次不在的产物，打包打的又是 `dist/**/*`
    // （`electron-builder.yml:27`）：源码面归零之后，产物面没有任何一处会跟着归零。
    // 本轮按形状实测过（临时模块 → 编进 dist → 删源码 → 用改前脚本再编，那颗 JS 原地留着），
    // 但**没有**声称历史装机包里躺着那两组名字：当前那颗包的 `app.asar` grep 不到它们
    // （正对照 `default-dependencies` 3 命中），说明这台机器的 dist 曾经整体清过——运气，不是设计。
    // 这里认的是「整棵抹掉」这个形状（`rmSync(outDir, …)`），不是某个目录名：原来只抹 `plugins`
    // 那一行治的是一个露出来的名字，编译出的 JS 从来没人管（与 T13 扫描器按名字跳过 `release` 同档）。
    pattern: /rmSync\(\s*outDir\s*,/,
    positiveControls: ["rmSync(outDir, { recursive: true, force: true });"],
    exceptions: [],
    required: true,
    requiredIn: ["scripts/build/desktop-typescript.mjs"],
  },
  {
    clause: "A4 上游品牌链接",
    pattern: /Playa-Cyrene|Playa-0v0|playa0|playaagentcyrene\.online|ky2569ly@gmail\.com/i,
    positiveControls: ["https://github.com/Playa-Cyrene/Cyrene-Agent/issues"],
    exceptions: [
      { file: "src/shared/upstream-hosts.ts", reason: "黑名单本身必须写出被禁域名才拦得住" },
      {
        file: "src/main/windows/external-link.test.ts",
        reason: "运行时拦截的负判据：必须把上游 URL 当作输入，才能证明 isUpstreamUrl 真的拦住",
      },
      {
        file: "packages/plugin-sdk/package.json",
        reason: "`@playa0v0/cyrene-plugin-sdk` 是已发布的 npm scope/包名，改名属于身份任务，不在外链清零范围内；本任务只删 repository 字段",
      },
      {
        file: "packages/plugin-sdk/README.md",
        reason: "README 正文的安装与 import 语句必须写出真实包名，否则用户装不到",
      },
      {
        file: "scripts/plugin-sdk/build-sdk.mjs",
        reason: "构建脚本注释里的包名，与 package.json 同名",
      },
      {
        file: "scripts/plugin-sdk/verify-package.mjs",
        reason: "打包校验脚本注释里的包名，与 package.json 同名",
      },
      {
        file: "scripts/plugin-sdk/smoke-examples.mjs",
        reason: "冒烟测试 require 的是真实包名，改字符串会让示例编译走空",
      },
    ],
  },
  {
    clause: "A5 插件市场远端源",
    pattern: /Cyrene-Plugins|MARKET_REGISTRY_URLS|MARKET_ZIP_URL_PREFIXES|registry\.json/i,
    positiveControls: ["https://raw.githubusercontent.com/Playa-0v0/Cyrene-Plugins/main/registry.json"],
    // 本地目录枚举落地后，这条锁没有任何合法例外：插件市场只读 userData/plugins。
    exceptions: [],
  },
  {
    clause: "A6 看门狗在场",
    // 反向判据：这条 pattern 命中是**要求**，不是禁止。
    // 必须点名 `Everywhere`：旧式 `/installEgressWatchdog(?:Everywhere)?\(/`
    // 会把退回「只挂 defaultSession」的回归读成绿（B-2 又是原样）。
    // 只认「调用形状」（名字后面跟括号），不认裸标识：本文件的 import 与
    // `ReturnType<typeof ...>` 类型标注里也有这个名字，裸标识锁会把「装配被删」读成绿。
    pattern: /installEgressWatchdogEverywhere\s*\(/,
    positiveControls: ["installEgressWatchdogEverywhere("],
    exceptions: [],
    required: true,
    requiredIn: ["src/main/index.ts"],
  },
  {
    clause: "A7 运行时出口闸门在场",
    // A6 管「尺子装没装」，这条管「闸门还在不在」：三个能让客户端主动访问上游的入口
    // （内置浏览器、fetch_url、download_file）必须各自保留一次调用形状。
    pattern: /parseBrowserNavigation\s*\(|isUpstreamUrl\s*\(/,
    positiveControls: ["parseBrowserNavigation(targetUrl)", "isUpstreamUrl(url)"],
    exceptions: [],
    required: true,
    requiredIn: [
      "src/main/browser/browser-panel-controller.ts",
      "src/main/orchestrator/tools/builtin-tools/fetch-url-tool.ts",
      "src/main/orchestrator/tools/builtin-tools/download-file-tool.ts",
    ],
  },
  {
    clause: "A8 重定向逐跳过上游闸门",
    // 入口闸门只看得见第一跳：非上游短链可以 302 到上游，`redirect: "follow"` 会直接跟过去。
    // 三把联网工具（读网页、下文件、联网搜索）必须走逐跳校验的 helper，不许退回 follow。
    // 搜索工具现在会跟着搜索引擎的重定向（实测 www.bing.com → cn.bing.com），
    // 跟跳转这件事本身就把「第一跳不是上游」的假设打穿了。
    // 高德那一层是第四个出口：它替天气/出行/POI 四把工具发请求，退回裸 fetch 等于一次退三步。
    pattern: /fetchWithoutUpstreamRedirects\s*\(/,
    positiveControls: ["fetchWithoutUpstreamRedirects(url, {"],
    exceptions: [],
    required: true,
    requiredIn: [
      "src/main/amap/client.ts",
      "src/main/orchestrator/tools/builtin-tools/fetch-url-tool.ts",
      "src/main/orchestrator/tools/builtin-tools/download-file-tool.ts",
      "src/main/orchestrator/tools/builtin-tools/web-search-tool.ts",
    ],
  },
];

/** 例外表的 `file` 一律用 `/` 分隔书写，跟 `path.sep` 无关（Windows 上是 `\`）。 */
function posixPath(file: string): string {
  return file.split(path.sep).join("/");
}

describe("上游出口清零（静态标识面）", () => {
  const files = scannedFiles();

  it("扫描器真的在扫东西（空扫不许读成 PASS）", () => {
    expect(files.length).toBeGreaterThan(300);
    // 根配置文件必须真的进了扫描集合：A3 的 publish / 依赖判据只能在这里被证伪，
    // 少了它们规则就是「永远扫不到」的死锁而不是锁。
    const rel = files.map((file) => posixPath(path.relative(process.cwd(), file)));
    expect(rel).toEqual(
      expect.arrayContaining(["electron-builder.yml", "package.json"]),
    );
    // A-2 正对照：扩展名集合是活的。这四个文件只靠 `.js/.cjs/.ps1/.py` 分支才进得来——
    // 有人把 SCAN_EXTENSIONS 收回去时这里先红，而不是等上游域名搬进 .cjs 才发现。
    expect(rel).toEqual(
      expect.arrayContaining([
        "src/main/plugin-panel/panel-bridge.js",
        "src/plugins/native-import.cjs",
        "scripts/migrate-user-data.ps1",
        "scripts/packaging/music-component-entry.py",
      ]),
    );
    // A-3 正对照：目录名不能当「这是产物」的判据。`sourceFiles` 原来按名字跳过 `release`，
    // 于是 `scripts/release/publish-update.mjs`（往 GitHub 推安装包的那支脚本）整份在射程外——
    // 白名单放开成上游那一本时，A4 一条都不红。这一行钉住它在射程里。
    expect(rel).toEqual(expect.arrayContaining(["scripts/release/publish-update.mjs"]));
  });

  for (const rule of RULES) {
    it(`${rule.clause}：${rule.required ? "必须出现（反向判据）" : "全仓不出现上游标识"}`, () => {
      for (const control of rule.positiveControls) {
        expect(rule.pattern.test(control), `正对照未命中，规则写坏了：${control}`).toBe(true);
      }
      const hits: string[] = [];
      for (const file of files) {
        if (path.basename(file) === SELF) continue;
        const exempt = rule.exceptions.find((candidate) => posixPath(file).endsWith(candidate.file));
        const text = readFileSync(file, "utf8");
        rule.pattern.lastIndex = 0;
        if (!rule.pattern.test(text)) continue;
        if (exempt) continue;
        hits.push(path.relative(process.cwd(), file));
      }
      if (!rule.required) {
        expect(hits).toEqual([]);
        return;
      }
      // 反向判据 = 必须命中；再钉住组合根，免得实现体还在、装配被摘掉也能读成绿。
      expect(hits.length, `${rule.clause}：看门狗被摘掉了`).toBeGreaterThan(0);
      const normalized = hits.map((hit) => posixPath(hit));
      for (const requiredIn of rule.requiredIn ?? []) {
        expect(normalized, `${rule.clause}：组合根 ${requiredIn} 没有安装看门狗`).toContain(requiredIn);
      }
    });
  }
});

/**
 * A3 的第 3 层：更新面只钉这两个仓库。
 *
 * 为什么不塞进 `RULES`：Rule 的判据形状只有「0 次」与「≥1 次」，这一段要判的是
 * **集合相等**——「除了这两本，一本都不许多；这两本，一本都不许少」。第三本来源长什么样
 * 是写锁的时候不知道的，所以只能普查（把每个 URL 字面量真解析一遍），不能列禁品。
 * 顺带一提这里必须用 `new URL()` 而不是切字符串：`https://api.github.com@evil.tld/x` 的
 * 真 host 是 `evil.tld`，按前缀切会把假发布页读成自己人。
 */
/** 会替更新通道发请求的源码根目录（测试文件不在普查里：那里的 URL 是夹具）。 */
const UPDATE_FACING_ROOTS = ["src/main/update", "scripts/release"];
/**
 * 内核通道的钉与闸门住在 `src/main/verge` 里，但那一整目录**不全是**更新面：
 * `mihomo-client.ts` 的 `https://www.gstatic.com/generate_204` 是延迟探测，不是升级来源，
 * 把整个目录拉进普查会把一件合法的事报成违规。所以这里点名真正参与更新的那两份。
 */
const UPDATE_FACING_FILES = ["src/main/verge/mihomo-update.ts", "src/main/verge/core-source.ts"];
/** 客户端安装包在 fork 的 Release，内核在 mihomo 上游的 Release——只有这两本。 */
const PINNED_REPOS = ["damingslu-ctrl/Cyrene-Agent", "MetaCubeX/mihomo"];
/** 与 `core-source.ts` 的 `isAllowedUpdateUrl` 同一口径（资产会 302 到 `*.githubusercontent.com`）。 */
const PINNED_HOSTS = ["api.github.com", "github.com"];

/** 注释里的假仓库名：写出来是为了证明按路径段比，不是网络路径。 */
const TRAP_REPOS: Array<{ ref: string; reason: string }> = [
  {
    ref: "damingslu-ctrl/Cyrene-Agent-evil",
    reason: "github-release.ts 的前缀陷阱反例：证明 `Cyrene-AgentX` 这种同前缀的假 repo 认不出来就不算拦",
  },
];
/** 注释里的假 host：同上，是 `isAllowedUpdateUrl` 的负样本。 */
const TRAP_HOSTS: Array<{ host: string; reason: string }> = [
  { host: "api.github.com.evil.tld", reason: "core-source.ts 注释里的假发布页反例：证明判 host 而不是判前缀" },
  { host: "evil.tld", reason: "同一句里的 `api.github.com@evil.tld` 反例：真 host 是 evil.tld，`new URL` 认得出来" },
];

const URL_TOKEN = /https?:\/\/[^\s"'`<>\])}]+/g;

function updateFacingSources(base = process.cwd()): string[] {
  const out: string[] = [];
  for (const root of UPDATE_FACING_ROOTS) {
    const abs = path.join(base, root);
    try {
      if (statSync(abs).isDirectory()) out.push(...sourceFiles(abs));
    } catch {
      // 根目录还没建：不在这儿抛，交给下面那段覆盖度正对照判红。
    }
  }
  for (const rel of UPDATE_FACING_FILES) {
    const abs = path.join(base, rel);
    try {
      if (statSync(abs).isFile()) out.push(abs);
    } catch {
      // 同上：点名文件被搬走时由覆盖度那一条说清是哪一份。
    }
  }
  return out.filter((file) => !/\.(test|spec)\.[cm]?[jt]sx?$/.test(path.basename(file)));
}

/** URL 里那两段 `owner/name`：与生产代码 `releaseBelongsToRepo` 同一个认法（按路径段，不吃前缀）。 */
function repoRefFromUrl(url: URL): string | null {
  const segments = url.pathname.split("/").filter((part) => part !== "");
  const offset = segments[0] === "repos" ? 1 : 0;
  const owner = segments[offset];
  const name = segments[offset + 1];
  return owner && name ? `${owner}/${name}`.toLowerCase() : null;
}

/** 扫出更新面所有的 URL 字面量；模板串里的变量（`${...}`）不是字面主机名，由运行时那把尺管。 */
function urlLiterals(files: string[]): Array<{ token: string; url: URL | null; file: string }> {
  const out: Array<{ token: string; url: URL | null; file: string }> = [];
  for (const file of files) {
    const rel = posixPath(path.relative(process.cwd(), file));
    for (const token of readFileSync(file, "utf8").match(URL_TOKEN) ?? []) {
      if (/[${}]/.test(token)) continue;
      let url: URL | null = null;
      try {
        url = new URL(token);
      } catch {
        url = null;
      }
      out.push({ token, url, file: rel });
    }
  }
  return out;
}

describe("更新面只钉这两个仓库（A3 反向契约第 3 层）", () => {
  const files = updateFacingSources();
  const literals = urlLiterals(files);

  it("普查范围不是空的，而且点名得到那几份（空扫不许读成 PASS）", () => {
    const rel = files.map((file) => posixPath(path.relative(process.cwd(), file)));
    expect(rel.length, "更新面普查扫到 0 个文件：目录被搬走了").toBeGreaterThan(3);
    expect(rel).toEqual(
      expect.arrayContaining([
        "src/main/update/github-release.ts",
        "src/main/update/update-service.ts",
        "src/main/verge/mihomo-update.ts",
        "src/main/verge/core-source.ts",
        // 发布脚本是更新面的第四个入口：它不在场时「谁都能发版」这件事没人拦。
        "scripts/release/publish-update.mjs",
      ]),
    );
  });

  it("URL 解析器没坏：更新面确实扫到了发布页那一族 host（正对照）", () => {
    const hosts = new Set(literals.flatMap((entry) => (entry.url ? [entry.url.hostname] : [])));
    expect(hosts.has("api.github.com"), "一个 URL 都没解析出来：普查的尺子瞎了").toBe(true);
  });

  it("更新面的 host 只许是钉住的那一族（api／github／*.githubusercontent，多一个来源当场红）", () => {
    const offenders = literals
      .filter((entry) => entry.url !== null)
      .filter(
        (entry) =>
          !PINNED_HOSTS.includes(entry.url!.hostname) &&
          !entry.url!.hostname.endsWith(".githubusercontent.com") &&
          !TRAP_HOSTS.some((trap) => trap.host === entry.url!.hostname),
      );
    expect(
      offenders.map((entry) => `${entry.file} → ${entry.token}`),
      "更新面出现了没钉过的 host：更新路径上的每一个来源都要先过出口白名单，再加一本得先改这份锁",
    ).toEqual([]);
  });

  it("github 上的 owner/name 与钉住的那两本集合相等（多一本红、少一本也红）", () => {
    const refs = literals
      .filter((entry) => entry.url !== null && PINNED_HOSTS.includes(entry.url!.hostname))
      .map((entry) => ({ ref: repoRefFromUrl(entry.url!), file: entry.file }))
      .filter((entry): entry is { ref: string; file: string } => entry.ref !== null);
    const found = new Set(
      refs.map((entry) => entry.ref).filter((ref) => !TRAP_REPOS.some((trap) => trap.ref.toLowerCase() === ref)),
    );
    // 客户端那本在源码里是模板变量（`repos/${CLIENT_UPDATE_REPO}/…`），扫不到字面量，
    // 所以把它从**导出的常量**上取：改钉等于改常量，这一句才拦得住「静默换源」。
    found.add(CLIENT_UPDATE_REPO.toLowerCase());
    found.add(repoRefFromUrl(new URL(MIHOMO_RELEASE_API_URL)) ?? "");
    const allowed = new Set(PINNED_REPOS.map((repo) => repo.toLowerCase()));
    const extras = [...found].filter((ref) => !allowed.has(ref));
    const missing = [...allowed].filter((ref) => !found.has(ref));
    expect(extras, `更新面多出一本没钉过的仓库，命中的是：${refs.map((entry) => `${entry.file} → ${entry.ref}`).join(", ")}`).toEqual([]);
    expect(missing, `更新面少了一本钉过的仓库（通道被摘掉了？）：${missing.join(", ")}`).toEqual([]);
  });

  it("客户端与内核的钉各自还挂在原来的常量上", () => {
    expect(CLIENT_UPDATE_REPO).toBe(PINNED_REPOS[0]);
    const mihomo = new URL(MIHOMO_RELEASE_API_URL);
    expect(mihomo.hostname).toBe("api.github.com");
    expect(repoRefFromUrl(mihomo)).toBe(PINNED_REPOS[1].toLowerCase());
  });
});
