/**
 * 发布脚本（`scripts/release/publish-update.mjs`）的可判定契约（Wave 4 T13）。
 *
 * 为什么这把尺住在 `src/main/update/` 而不是 `scripts/`：`vitest.config.mts` 的 include 只覆盖
 * `src` 下面那几档，而 `scripts` 里那五份 node:test 的 `.test.mjs` 从没有哪个门跑过它们
 * （`test.yml` 的兜底 chunk 是 `vitest run --exclude "src/**" --passWithNoTests`，
 * `vitest list --exclude "src/**"` 也列不出东西）。
 * 把锁放在跑不到的地方等于没放——发布通路是唯一一条**错了就改不动**的（Release 一旦发出去，
 * 已装机用户拿到的就是它），所以它必须住在 CI 真会跑的那一层里。
 *
 * 另一条纪律：脚本本身不许有第二份真相。安装器名从 `electron-builder.yml` 的
 * `nsis.artifactName` 派生（与 `verify:installer` 同一处），体积下限从 `installer-artifacts.mjs`
 * 导入，仓库名从 `CLIENT_UPDATE_REPO` 对齐——下面那几条「源码文本里不许出现某字面量」的判据
 * 就是在钉这件事，因为光看行为看不出哪一份是抄的。
 */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CLIENT_UPDATE_REPO, INSTALLER_ASSET_PATTERN } from "./github-release";

const scriptPath = fileURLToPath(new URL("../../../scripts/release/publish-update.mjs", import.meta.url));
const scriptSource = readFileSync(scriptPath, "utf8");

/** 被测模块：动态 import 而不是顶层 import——文件被搬走时报「脚本没了」比一句裸 module not found 有用。 */
async function loadPublisher(): Promise<any> {
  try {
    return await import(scriptPath);
  } catch (error) {
    throw new Error(`发布脚本读不到：${scriptPath}\n${String(error)}`);
  }
}

const HEX64 = "0".repeat(63) + "a";

/** 假 gh：按 `gh <argv…>` 记录每一次调用，并按 `answers` 回吐响应。网络与凭据一律不进单测。 */
function fakeGh(answers: Array<{ match: string; code?: number; stdout?: string }> = []) {
  const calls: string[][] = [];
  return {
    calls,
    async run(args: string[]) {
      calls.push(args);
      const hit = answers.find((answer) => args.join(" ").includes(answer.match));
      if (hit && hit.code !== 0 && hit.code !== undefined) {
        return { code: hit.code, stdout: hit.stdout ?? "", stderr: `fake gh failure for ${hit.match}` };
      }
      return { code: hit?.code ?? 0, stdout: hit?.stdout ?? "", stderr: "" };
    },
  };
}

/**
 * 一份「看起来像安装包」的临时产物。
 * 体积闸门读的是 `stat().size`，所以默认造小文件、由调用方把下限一起压小（`minInstallerBytes`
 * 是程序内注入的口子里，命令行不认——那一条也在下面单独钉）。真要验闸门本身的那个用例
 * 才走默认的 20 MB 下限。
 */
function makeFakeInstaller(dir: string, name: string, bytes = 4096): string {
  const file = path.join(dir, name);
  writeFileSync(file, `fake installer ${name}\n`);
  truncateSync(file, bytes);
  return file;
}

describe("publish-update.mjs：发布目标的白名单", () => {
  it("默认仓库就是客户端钉住的那本，两处不许各说各话", async () => {
    const mod = await loadPublisher();
    // 正对照：读得到 DEFAULT_REPO 这个导出，不是 undefined === undefined。
    expect(mod.DEFAULT_REPO).toBeTruthy();
    expect(mod.DEFAULT_REPO).toBe(CLIENT_UPDATE_REPO);
  });

  it("白名单只有那一本：换源与上游都进不来", async () => {
    const mod = await loadPublisher();
    expect(mod.ALLOWED_REPOS).toEqual([CLIENT_UPDATE_REPO]);
    expect(() => mod.assertRepoAllowed(CLIENT_UPDATE_REPO)).not.toThrow();
    // 认错的一本：别人的同名 repo（A4 那条锁禁写上游 owner，所以这里用假 owner）
    expect(() => mod.assertRepoAllowed("someone-else/Cyrene-Agent")).toThrow(/白名单/);
    // 形状看着对但不是钉住的那本
    expect(() => mod.assertRepoAllowed("damingslu-ctrl/Cyrene-AgentX")).toThrow(/白名单/);
    // 空值/非字符串不许读成「没指定就用默认」：这一档错的形状是发到别处去
    expect(() => mod.assertRepoAllowed("")).toThrow(/白名单/);
  });
});

describe("publish-update.mjs：只有一份真相", () => {
  it("安装器名从 electron-builder.yml 派生，脚本里不抄品牌字面量", async () => {
    const mod = await loadPublisher();
    // 正对照：文本里确实出现过 artifactName（有人把它换成硬编码时这里先红）
    expect(/artifactName/.test(scriptSource)).toBe(true);
    expect(/nsis\?\.artifactName|nsis\.artifactName/.test(scriptSource)).toBe(true);
    // 反判据：品牌名一旦抄进脚本，改名就会静默按旧名找文件（`sync-brand.mjs` 头注禁止的第二处定义）
    expect(scriptSource).not.toMatch(/Mochi-Setup/);
    expect(scriptSource).not.toMatch(/productName/);

    const build = await mod.resolveBuild();
    // 真仓库配置派生出来的名字必须被**客户端**那条资产正则认——这条锁住的是
    // 「打包改了 artifactName，客户端从此永远找不到安装包」这一档最难看的漂移。
    expect(INSTALLER_ASSET_PATTERN.test(build.assetName)).toBe(true);
    expect(build.assetName).toBe(`Mochi-Setup-${build.version}.exe`);
    expect(build.tag).toBe(`v${build.version}`);
    expect(build.outputDir).toBeTruthy();
  });

  it("体积下限从 verify:installer 导入，不在发布脚本里再写一个数", async () => {
    const mod = await loadPublisher();
    expect(/from "\.\.\/verify\/installer-artifacts\.mjs"/.test(scriptSource)).toBe(true);
    expect(scriptSource).not.toMatch(/MIN_INSTALLER_BYTES\s*=\s*\d/);
    // 真值与 verify:installer 同一档（导出后两边共用）
    const verify = await import(new URL("../../../scripts/verify/installer-artifacts.mjs", import.meta.url).href);
    expect(mod.MIN_INSTALLER_BYTES).toBe(verify.MIN_INSTALLER_BYTES);
    expect(() => mod.assertInstallerSize(1024)).toThrow(/体积/);
    expect(() => mod.assertInstallerSize(mod.MIN_INSTALLER_BYTES + 1)).not.toThrow();
  });

  it("tag 与 package.json 版本号同号才许发", async () => {
    const mod = await loadPublisher();
    expect(() => mod.assertTagMatchesVersion("v1.16.0", "1.16.0")).not.toThrow();
    expect(() => mod.assertTagMatchesVersion("v1.16.1", "1.16.0")).toThrow(/同号/);
    // 不带 v：gh 会建出第二个标签，客户端按 tag 读版本号，两处会各认一半
    expect(() => mod.assertTagMatchesVersion("1.16.0", "1.16.0")).toThrow(/v/);
    expect(() => mod.assertTagMatchesVersion(undefined, "1.16.0")).toThrow(/tag/);
  });
});

describe("publish-update.mjs：凭据与摘要", () => {
  it("SHA256SUMS.txt 是 coreutils 那个格式", async () => {
    const mod = await loadPublisher();
    const line = mod.buildSumsContent({ digest: HEX64.toUpperCase(), assetName: "Mochi-Setup-1.16.0.exe" });
    const [hex, name] = line.trimEnd().split("  ");
    // 两个空格 + 文件名 + 换行：`sha256sum -c` 认这个形状，二进制模式的 ` *name` 不认。
    expect(line).toBe(`${HEX64}  Mochi-Setup-1.16.0.exe\n`);
    // 摘要必须小写：GitHub 的 digest 也是小写，混着比就成了「摘要不一致」。
    expect(hex).toBe(HEX64);
    expect(name).toBe("Mochi-Setup-1.16.0.exe");
  });

  it("GitHub 的 digest 认法与客户端同一档：读不出就当没有", async () => {
    const mod = await loadPublisher();
    expect(mod.parseGhDigest(`sha256:${HEX64}`)).toBe(HEX64);
    expect(mod.parseGhDigest(` SHA256:${HEX64.toUpperCase()} `)).toBe(HEX64);
    // 缺前缀 / 别的算法 / 长度不对 / 不是字符串：一律 null。
    // 这一档为什么不能放：客户端的 digest-missing 与 verifyPublished 用的是同一个认法，
    // 把「上游没给凭据」读成「凭据是空串」，就等于把 290 MB 的裸下载当成验过的更新。
    expect(mod.parseGhDigest(HEX64)).toBeNull();
    expect(mod.parseGhDigest(`sha512:${HEX64}`)).toBeNull();
    expect(mod.parseGhDigest("sha256:deadbeef")).toBeNull();
    expect(mod.parseGhDigest(undefined)).toBeNull();
    expect(mod.parseGhDigest(null)).toBeNull();
  });

  it("本地摘要真的是这个文件的 sha256（流式实现不许漏尾）", async () => {
    const mod = await loadPublisher();
    const dir = mkdtempSync(path.join(tmpdir(), "mochi-publish-"));
    try {
      const file = path.join(dir, "payload.bin");
      // 4096 + 1234 不是 4 KB 的整数倍：只在「整块读」的实现里才会露出漏尾的破绽。
      writeFileSync(file, Buffer.alloc(4096 + 1234, 7));
      const expected = createHash("sha256").update(readFileSync(file)).digest("hex");
      expect(await mod.sha256File(file)).toBe(expected);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("命令行不认「放宽体积下限」这个口子：能被脚本参数拆掉的闸门不是闸门", async () => {
    const mod = await loadPublisher();
    expect(() => mod.parseArgs(["--min-installer-bytes", "1"])).toThrow(/不认识的参数/);
    expect(mod.parseArgs(["--publish", "--notes-file", "docs/x.md"])).toEqual({
      publish: true,
      help: false,
      notesFile: "docs/x.md",
    });
  });
});

describe("publish-update.mjs：默认只出计划", () => {
  it("不带 --publish 时一条命令都不发，且计划里写的是钉住的那本", async () => {
    const mod = await loadPublisher();
    const dir = mkdtempSync(path.join(tmpdir(), "mochi-publish-plan-"));
    try {
      const build = await mod.resolveBuild();
      const gh = fakeGh();
      const log: string[] = [];
      const result = await mod.publishUpdate(
        { publish: false, notesFile: "docs/x.md", installer: makeFakeInstaller(dir, build.assetName), minInstallerBytes: 1024, outputDir: dir, tag: build.tag, version: build.version },
        { gh: gh.run, log: (s: string) => log.push(s) }
      );
      expect(gh.calls).toEqual([]);
      expect(result.published).toBe(false);
      const plan = log.join("\n");
      expect(plan).toContain("gh release create");
      expect(plan).toContain(`--repo ${CLIENT_UPDATE_REPO}`);
      expect(plan).toContain(mod.SUMS_ASSET_NAME);
      // 正对照：计划里必须把摘要也算出来了（说明本地那几道门真跑过，不是光打印）
      expect(plan).toContain(result.digest);
      // 计划模式不落盘：没点头之前不许在产物目录里留文件
      expect(result.sumsWritten).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("--publish 缺 --notes-file 就拒绝，且不留下任何半成品", async () => {
    const mod = await loadPublisher();
    const gh = fakeGh();
    await expect(
      mod.publishUpdate({ publish: true, notesFile: null }, { gh: gh.run, log() {} })
    ).rejects.toThrow(/notes-file/);
    expect(gh.calls).toEqual([]);
  });

  it("本地产物里带 latest.yml 就不许发：旧通道的反向锁在这一头也得守住", async () => {
    const mod = await loadPublisher();
    const dir = mkdtempSync(path.join(tmpdir(), "mochi-publish-feed-"));
    try {
      const build = await mod.resolveBuild();
      makeFakeInstaller(dir, build.assetName);
      writeFileSync(path.join(dir, "latest.yml"), "version: 1.16.0\n");
      const gh = fakeGh();
      await expect(
        mod.preflight({ installer: path.join(dir, build.assetName), outputDir: dir }, { gh: gh.run, log() {} })
      ).rejects.toThrow(/latest\.yml/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("体积不合理的产物不许发", async () => {
    const mod = await loadPublisher();
    const dir = mkdtempSync(path.join(tmpdir(), "mochi-publish-tiny-"));
    try {
      const build = await mod.resolveBuild();
      const file = path.join(dir, build.assetName);
      writeFileSync(file, "not a real installer");
      await expect(mod.preflight({ installer: file, outputDir: dir }, { log() {} })).rejects.toThrow(/体积/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("publish-update.mjs：发出去那一圈校验", () => {
  /** `gh api … -q …` 的假响应：只喂这一圈要读的字段。 */
  function releaseJson({ digest = `sha256:${HEX64}`, name = "Mochi-Setup-1.16.0.exe" } = {}) {
    return JSON.stringify({
      tag_name: "v1.16.0",
      assets: [{ name, digest, size: 21 * 1024 * 1024, browser_download_url: "https://github.com/x/y/releases/download/v1.16.0/a.exe" }],
    });
  }

  it("远端摘要与本地一致才算发成功", async () => {
    const mod = await loadPublisher();
    const gh = fakeGh([
      { match: "releases/tags/v1.16.0", stdout: releaseJson() },
      { match: "releases/latest", stdout: JSON.stringify({ tag_name: "v1.16.0" }) },
    ]);
    const check = await mod.verifyPublished({ gh: gh.run, repo: CLIENT_UPDATE_REPO, tag: "v1.16.0", assetName: "Mochi-Setup-1.16.0.exe", digest: HEX64 });
    expect(check.ok).toBe(true);
    expect(check.assetName).toBe("Mochi-Setup-1.16.0.exe");
  });

  it("摘要对不上就报红：这是货不对板，不是网络抖一下", async () => {
    const mod = await loadPublisher();
    const gh = fakeGh([
      { match: "releases/tags/v1.16.0", stdout: releaseJson({ digest: `sha256:${"f".repeat(64)}` }) },
      { match: "releases/latest", stdout: JSON.stringify({ tag_name: "v1.16.0" }) },
    ]);
    const check = await mod.verifyPublished({ gh: gh.run, repo: CLIENT_UPDATE_REPO, tag: "v1.16.0", assetName: "Mochi-Setup-1.16.0.exe", digest: HEX64 });
    expect(check.ok).toBe(false);
    expect(check.reason).toBe("digest-mismatch");
    expect(check.detail).toMatch(/不一致|不匹配/);
  });

  it("远端没给摘要同样报红：客户端那一头本来就会 digest-missing 拒装", async () => {
    const mod = await loadPublisher();
    // 键整个不存在（GitHub 对没算出摘要的资产就是这样）：`digest: undefined` 走的是默认值，
    // 造不出这一档，所以这里手写响应体而不是复用 releaseJson。
    const gh = fakeGh([
      {
        match: "releases/tags/v1.16.0",
        stdout: JSON.stringify({ tag_name: "v1.16.0", assets: [{ name: "Mochi-Setup-1.16.0.exe", size: 4096 }] }),
      },
      { match: "releases/latest", stdout: JSON.stringify({ tag_name: "v1.16.0" }) },
    ]);
    const check = await mod.verifyPublished({ gh: gh.run, repo: CLIENT_UPDATE_REPO, tag: "v1.16.0", assetName: "Mochi-Setup-1.16.0.exe", digest: HEX64 });
    expect(check.ok).toBe(false);
    expect(check.reason).toBe("digest-missing");
  });

  it("资产不在那一版里就报红：客户端按名字找，找不到是 no-asset", async () => {
    const mod = await loadPublisher();
    const gh = fakeGh([
      { match: "releases/tags/v1.16.0", stdout: releaseJson({ name: "Mochi-Setup-1.15.0.exe" }) },
      { match: "releases/latest", stdout: JSON.stringify({ tag_name: "v1.16.0" }) },
    ]);
    const check = await mod.verifyPublished({ gh: gh.run, repo: CLIENT_UPDATE_REPO, tag: "v1.16.0", assetName: "Mochi-Setup-1.16.0.exe", digest: HEX64 });
    expect(check.ok).toBe(false);
    expect(check.reason).toBe("no-asset");
  });

  it("latest 还指向旧版要单独说：客户端读的正是 releases/latest", async () => {
    const mod = await loadPublisher();
    const gh = fakeGh([
      { match: "releases/tags/v1.16.0", stdout: releaseJson() },
      { match: "releases/latest", stdout: JSON.stringify({ tag_name: "v1.15.0" }) },
    ]);
    const check = await mod.verifyPublished({ gh: gh.run, repo: CLIENT_UPDATE_REPO, tag: "v1.16.0", assetName: "Mochi-Setup-1.16.0.exe", digest: HEX64 });
    expect(check.ok).toBe(false);
    expect(check.reason).toBe("not-latest");
    // 用户点了「检查更新」看到的会是 1.15.0，而屏幕上写的是「已经是最新版」——最难查的那种。
    expect(check.detail).toContain("v1.15.0");
    // 允许显式认这个形状（发过更高版本的补丁场景），但默认不算成功。
    const relaxed = await mod.verifyPublished({
      gh: gh.run, repo: CLIENT_UPDATE_REPO, tag: "v1.16.0", assetName: "Mochi-Setup-1.16.0.exe", digest: HEX64, allowNotLatest: true,
    });
    expect(relaxed.ok).toBe(true);
    expect(relaxed.reason).toBeNull();
  });

  it("发布前要求远端已有那个 tag：不许 gh 顺手建一个轻量标签", async () => {
    const mod = await loadPublisher();
    const gh = fakeGh([{ match: "git/ref/tags/v1.16.0", code: 1, stdout: "" }]);
    await expect(
      mod.assertRemoteTag({ gh: gh.run, repo: CLIENT_UPDATE_REPO, tag: "v1.16.0" })
    ).rejects.toThrow(/annotated tag|标签/);
    // 认 `object.type === "tag"`（引用对象是 tag 而不是 commit）：轻量标签的 type 是 commit，
    // 它不带作者与日期，回滚时认不出「这一版是谁、为什么打的」。
    const annotated = fakeGh([{ match: "git/ref/tags/v1.16.0", code: 0, stdout: JSON.stringify({ object: { type: "tag" } }) }]);
    await expect(mod.assertRemoteTag({ gh: annotated.run, repo: CLIENT_UPDATE_REPO, tag: "v1.16.0" })).resolves.toBe("tag");
    const lightweight = fakeGh([{ match: "git/ref/tags/v1.16.0", code: 0, stdout: JSON.stringify({ object: { type: "commit" } }) }]);
    await expect(mod.assertRemoteTag({ gh: lightweight.run, repo: CLIENT_UPDATE_REPO, tag: "v1.16.0" })).rejects.toThrow(/轻量/);
  });

  it("那一版已经有 Release 就拒绝重发：发出去的东西不改写", async () => {
    const mod = await loadPublisher();
    const gh = fakeGh([{ match: "release view v1.16.0", code: 0, stdout: releaseJson() }]);
    await expect(
      mod.assertReleaseAbsent({ gh: gh.run, repo: CLIENT_UPDATE_REPO, tag: "v1.16.0" })
    ).rejects.toThrow(/已存在/);
    const fresh = fakeGh([{ match: "release view v1.16.0", code: 1, stdout: "" }]);
    await expect(mod.assertReleaseAbsent({ gh: fresh.run, repo: CLIENT_UPDATE_REPO, tag: "v1.16.0" })).resolves.toBeUndefined();
  });

  it("完整一趟：计划 → 建 Release → 校验摘要，命令形状与手敲的那条一致", async () => {
    const mod = await loadPublisher();
    const dir = mkdtempSync(path.join(tmpdir(), "mochi-publish-run-"));
    try {
      const build = await mod.resolveBuild();
      const installerPath = makeFakeInstaller(dir, build.assetName);
      const digest = await mod.sha256File(installerPath);
      const gh = fakeGh([
        { match: "release view", code: 1, stdout: "" },
        { match: "release create", code: 0, stdout: "" },
        { match: "git/ref/tags", code: 0, stdout: JSON.stringify({ object: { type: "tag" } }) },
        {
          match: "releases/tags",
          code: 0,
          stdout: JSON.stringify({
            tag_name: build.tag,
            assets: [{ name: build.assetName, digest: `sha256:${digest}`, size: 21 * 1024 * 1024 }],
          }),
        },
        { match: "releases/latest", code: 0, stdout: JSON.stringify({ tag_name: build.tag }) },
      ]);
      const log: string[] = [];
      const result = await mod.publishUpdate(
        { publish: true, installer: installerPath, minInstallerBytes: 1024, outputDir: dir, notesFile: "docs/release-notes.md", tag: build.tag, version: build.version },
        { gh: gh.run, log: (s: string) => log.push(s) }
      );
      expect(result.published).toBe(true);
      expect(result.ok).toBe(true);
      expect(result.reason).toBeNull();
      const create = gh.calls.find((args) => args[0] === "release" && args[1] === "create");
      expect(create).toBeTruthy();
      const joined = create!.join(" ");
      expect(joined).toContain(`--repo ${CLIENT_UPDATE_REPO}`);
      expect(joined).toContain("--notes-file docs/release-notes.md");
      expect(joined).toContain(build.assetName);
      expect(joined).toContain(mod.SUMS_ASSET_NAME);
      // 那一圈校验真的发过请求，而不是 publishUpdate 里顺手 return ok:true
      expect(gh.calls.some((args) => args.join(" ").includes("releases/latest"))).toBe(true);
      // 落盘的 SHA256SUMS.txt 里那一行的名字必须与资产名一致，否则 `sha256sum -c` 认不出目录
      const sums = readFileSync(path.join(dir, mod.SUMS_ASSET_NAME), "utf8");
      expect(sums).toBe(`${result.digest}  ${build.assetName}\n`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("发出去但摘要对不上时整趟判失败：不许报「发布成功」", async () => {
    const mod = await loadPublisher();
    const dir = mkdtempSync(path.join(tmpdir(), "mochi-publish-bad-"));
    try {
      const build = await mod.resolveBuild();
      const installerPath = makeFakeInstaller(dir, build.assetName);
      const gh = fakeGh([
        { match: "release view", code: 1, stdout: "" },
        { match: "release create", code: 0, stdout: "" },
        { match: "git/ref/tags", code: 0, stdout: JSON.stringify({ object: { type: "tag" } }) },
        {
          match: "releases/tags",
          code: 0,
          stdout: JSON.stringify({ tag_name: build.tag, assets: [{ name: build.assetName, digest: `sha256:${"f".repeat(64)}` }] }),
        },
        { match: "releases/latest", code: 0, stdout: JSON.stringify({ tag_name: build.tag }) },
      ]);
      const result = await mod.publishUpdate(
        { publish: true, installer: installerPath, minInstallerBytes: 1024, outputDir: dir, notesFile: "docs/x.md", tag: build.tag, version: build.version },
        { gh: gh.run, log() {} }
      );
      // 注意是 ok:false 而不是 throw：Release 已经建出来了，这一趟不可回滚，
      // 说「发布成功」是把用户往坑里推，说「发出去了但摘要对不上」才是能接着处理的那句话。
      expect(result.published).toBe(true);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe("digest-mismatch");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("代理是每条 gh 调用都带上的，不是只在文档里写一句", async () => {
    const mod = await loadPublisher();
    const env = mod.ghEnv({ HTTPS_PROXY: "http://127.0.0.1:7896", PATH: process.env.PATH });
    expect(env.HTTPS_PROXY).toBe("http://127.0.0.1:7896");
    // 直连被 SNI DPI 拦着：没有代理时明确警告，而不是让 gh 挂在那儿超时后让人猜。
    expect(mod.ghEnv({} as Record<string, string>)).toBeTruthy();
    expect(/7896|HTTPS_PROXY|代理/.test(scriptSource)).toBe(true);
  });
});
