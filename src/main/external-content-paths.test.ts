import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { load } from "js-yaml";
import { afterEach, describe, expect, it } from "vitest";

import {
  findPromptPath,
  findSkillPath,
  resolveExternalContentPaths,
  resolveSkillScanSources,
  resolveSkillsSnapshotArchivePath,
} from "./external-content-paths";

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cyrene-content-paths-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("resolveExternalContentPaths", () => {
  it("uses repository content in development", () => {
    const repository = path.resolve("E:/repo");
    const userData = path.resolve("E:/user-data");

    const result = resolveExternalContentPaths({
      isPackaged: false,
      appPath: repository,
      executablePath: path.join(repository, "node.exe"),
      userDataPath: userData,
    });

    expect(result.promptDirectories).toEqual([path.join(repository, "prompts")]);
    expect(result.builtinSkillDirectory).toBe(path.join(repository, "skills"));
    expect(result.userSkillDirectories).toEqual([path.join(userData, "skills")]);
  });

  it("keeps user-editable content in userData and shipped content beside the executable", () => {
    const installRoot = path.resolve("E:/Cyrene");
    const userData = path.resolve("E:/user-data");

    const result = resolveExternalContentPaths({
      isPackaged: true,
      appPath: path.join(installRoot, "resources", "app.asar"),
      executablePath: path.join(installRoot, "Cyrene.exe"),
      userDataPath: userData,
    });

    expect(result.promptDirectories).toEqual([
      path.join(userData, "prompts"),
      path.join(installRoot, "prompts"),
    ]);
    expect(result.builtinSkillDirectory).toBe(path.join(installRoot, "skills"));
    expect(result.userSkillDirectories).toEqual([path.join(userData, "skills")]);
  });
});

describe("external content lookup", () => {
  it("prefers a user prompt and falls back to the shipped prompt", () => {
    const root = temporaryDirectory();
    const userPrompts = path.join(root, "prompts");
    const defaultPrompts = path.join(root, "defaults", "prompts");
    fs.mkdirSync(userPrompts, { recursive: true });
    fs.mkdirSync(defaultPrompts, { recursive: true });
    fs.writeFileSync(path.join(defaultPrompts, "soul.md"), "default", "utf8");

    expect(findPromptPath("soul.md", [userPrompts, defaultPrompts])).toBe(
      path.join(defaultPrompts, "soul.md"),
    );

    fs.writeFileSync(path.join(userPrompts, "soul.md"), "user", "utf8");
    expect(findPromptPath("soul.md", [userPrompts, defaultPrompts])).toBe(
      path.join(userPrompts, "soul.md"),
    );
  });

  it("prefers a user-installed skill asset over the shipped asset", () => {
    const root = temporaryDirectory();
    const builtinSkills = path.join(root, "install", "skills");
    const userDataSkills = path.join(root, "user-data", "skills");
    const relativeAsset = path.join("styles", "default.json");

    for (const directory of [builtinSkills, userDataSkills]) {
      fs.mkdirSync(path.join(directory, "xlsx", "styles"), { recursive: true });
      fs.writeFileSync(path.join(directory, "xlsx", relativeAsset), directory, "utf8");
    }

    expect(findSkillPath("xlsx", relativeAsset, {
      builtinSkillDirectory: builtinSkills,
      userSkillDirectories: [userDataSkills],
    })).toBe(path.join(userDataSkills, "xlsx", relativeAsset));
  });

  it("scans the shipped skills folder as builtin and the userData folder as user", () => {
    const root = temporaryDirectory();
    const installSkills = path.join(root, "install", "skills");
    const userDataSkills = path.join(root, "user-data", "skills");
    fs.mkdirSync(installSkills, { recursive: true });
    fs.mkdirSync(userDataSkills, { recursive: true });

    expect(resolveSkillScanSources({
      builtinSkillDirectory: installSkills,
      userSkillDirectories: [userDataSkills],
    })).toEqual([
      { directory: installSkills, source: "builtin" },
      { directory: userDataSkills, source: "user" },
    ]);
  });
});

/**
 * 快照归档路径是「打包目标」与「运行时查找」两处定义的交接点：
 * 打包把 vendor/cyrene-skills 复制到 resources/<to>/，运行时去 resources/<目录>/ 找。
 * 两边只要有一个改了名字，装完就是「首启没有技能」——而且只在装机后才暴露。
 */
describe("skills 快照归档路径", () => {
  const installRoot = path.resolve("E:/install");
  const resourcesPath = path.join(installRoot, "resources");
  const paths = { installRoot };

  it("打包后从 resources/mochi-skills 读快照", () => {
    const resolved = resolveSkillsSnapshotArchivePath(paths, {
      isPackaged: true,
      resourcesPath,
      existsSync: () => true,
    });
    expect(resolved).toBe(path.join(resourcesPath, "mochi-skills", "skills-snapshot.zip"));
  });

  it("开发态仍从仓库 vendor/cyrene-skills 读快照（仓库侧目录名按仓库纪律保留）", () => {
    const resolved = resolveSkillsSnapshotArchivePath(paths, {
      isPackaged: false,
      existsSync: () => true,
    });
    expect(resolved).toBe(path.join(installRoot, "vendor", "cyrene-skills", "skills-snapshot.zip"));
  });

  it("归档不存在时返回 null（而不是指着一个不存在的路径）", () => {
    const resolved = resolveSkillsSnapshotArchivePath(paths, {
      isPackaged: true,
      resourcesPath,
      existsSync: () => false,
    });
    expect(resolved).toBeNull();
  });

  it("运行时查找的目录名与 electron-builder.yml 的打包目标同名", () => {
    const yml = load(fs.readFileSync(path.resolve(process.cwd(), "electron-builder.yml"), "utf8")) as {
      extraResources?: { from: string; to: string }[];
    };
    const entry = (yml.extraResources ?? []).find((item) => item.from === "vendor/cyrene-skills");
    expect(entry, "electron-builder.yml 里没有 vendor/cyrene-skills 的 extraResources 条目").toBeDefined();

    const resolved = resolveSkillsSnapshotArchivePath(paths, {
      isPackaged: true,
      resourcesPath,
      existsSync: () => true,
    });
    expect(path.basename(path.dirname(resolved!))).toBe(entry!.to);

    // 正对照：上游那套旧目录名必须判为不合格，否则这条锁形同虚设。
    expect("cyrene-skills").not.toBe(entry!.to);
  });
});
