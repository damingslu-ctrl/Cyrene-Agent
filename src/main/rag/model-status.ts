// Model installation status detection
// Provides unified model availability checks for embedding and reranker models.

import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { app } from "electron";
import {
  LOCAL_EMBEDDING_MODELS,
  LOCAL_EMBEDDING_MODEL_KEYS,
  type LocalEmbeddingModelKey,
} from "../../shared/local-models";

const HF_CACHE_DIR = path.join(os.homedir(), ".cache", "huggingface", "Xenova");

// All models require these files to be considered "installed"
const REQUIRED_FILES = ["tokenizer.json", "config.json", "onnx/model_quantized.onnx"];

// Possible sub-paths for each model.
//
// IMPORTANT: sub-paths are baseDir-specific.
//   - Project baseDirs (`<root>/models`) expect the **canonical Xenova layout**
//     that transformers.js itself appends at load time:
//     `pipeline("feature-extraction", "Xenova/bge-m3")` resolves to
//     `<localModelPath>/Xenova/bge-m3/tokenizer.json`. So on the project side
//     the canonical layout is `models/Xenova/bge-m3/`, NOT `models/bge-m3/`.
//   - HF cache baseDir (`~/.cache/huggingface/Xenova`) already ends with the
//     `Xenova/` segment that huggingface-cli writes. The canonical model
//     sub-dir there is therefore just `bge-m3/` (not `Xenova/bge-m3/`).
//
// PROJECT_SUB_PATHS layout:
//   models/Xenova/bge-base-zh-v1.5/       ← embedding-bgeBaseZh
//   models/Xenova/bge-m3/                 ← embedding-bgem3
//   models/bge-reranker-base/             ← reranker-standard
//
// HF_CACHE_SUB_PATHS layout (~/.cache/huggingface/Xenova/):
//   bge-base-zh-v1.5/                     ← embedding-bgeBaseZh
//   bge-m3/                               ← embedding-bgem3
//
// Embedding entries are derived from the shared registry so a new model can
// never be installable but undetectable (the two lists drifting is how
// "放到 models/ 却检测不到" gets filed).
const PROJECT_SUB_PATHS: Record<string, string[]> = {
  "reranker-standard": ["bge-reranker-base"],
};

const HF_CACHE_SUB_PATHS: Record<string, string[]> = {};

for (const key of LOCAL_EMBEDDING_MODEL_KEYS) {
  const dirName = LOCAL_EMBEDDING_MODELS[key].dirName;
  PROJECT_SUB_PATHS[embeddingModelId(key)] = [`Xenova/${dirName}`];
  HF_CACHE_SUB_PATHS[embeddingModelId(key)] = [dirName];
}

function embeddingModelId(modelKey: string): string {
  return `embedding-${modelKey}`;
}

function toModelId(kind: "embedding" | "reranker", modelKey: string): string {
  // 只有 standard 一档 reranker，modelKey 由调用方固定传入。
  return kind === "embedding" ? embeddingModelId(modelKey) : "reranker-standard";
}

/**
 * Canonical project-side sub-directory for a model, e.g. `Xenova/bge-m3`.
 * The downloader must write exactly this layout or the loader can't find it.
 * Returns null for an unregistered model.
 */
export function getProjectModelSubPath(kind: "embedding" | "reranker", modelKey: string): string | null {
  return PROJECT_SUB_PATHS[toModelId(kind, modelKey)]?.[0] ?? null;
}

/** Result of probing one (baseDir, subPath) candidate. */
interface CandidateCheck {
  /** Absolute path to the candidate model directory. */
  modelDir: string;
  /** Required files that are missing in this candidate. Empty = fully installed. */
  missingFiles: string[];
}

/**
 * Probe a single baseDir + modelId for a fully-installed model.
 * Returns every candidate under baseDir (for diagnostics) plus whether at
 * least one candidate is complete.
 */
function probeCandidates(
  modelId: string,
  baseDir: string,
  subPathsLookup: Record<string, string[]>,
): {
  installed: boolean;
  candidates: CandidateCheck[];
} {
  const subPaths = subPathsLookup[modelId] ?? [];
  const candidates: CandidateCheck[] = subPaths.map((subPath) => {
    const modelDir = path.join(baseDir, subPath);
    const missingFiles = REQUIRED_FILES.filter((file) => !fs.existsSync(path.join(modelDir, file)));
    return { modelDir, missingFiles };
  });
  const installed = candidates.some((c) => c.missingFiles.length === 0);
  return { installed, candidates };
}

/**
 * Resolve all candidate base directories in priority order.
 *
 * Priority:
 *   1. CYRENE_MODELS_DIR env var (highest — explicit override)
 *   2. process.cwd() + "models"  (when launched from project root, e.g. `electron .`)
 *   3. directory beside the executable + "models" (release users drop models here)
 *   4. <userData>/models  (app-managed install target — the downloader writes here)
 *   5. app.getAppPath() + "models"  (development fallback)
 *   6. process.resourcesPath + "models"  (packaged extraResources fallback)
 *
 * Why this matters: the previous implementation used
 * `path.join(__dirname, "..", "..", "..", "models")` — but the compiled
 * file lives at `dist/main/main/rag/model-status.js`, so `__dirname`
 * points there and ".."×3 lands at `dist/models` (always wrong).
 * In packaged builds `process.resourcesPath` is the asar dir, which
 * is read-only and not where users drop models.
 */
export function getProjectModelsDirCandidates(): string[] {
  const out: string[] = [];
  if (process.env.CYRENE_MODELS_DIR) out.push(process.env.CYRENE_MODELS_DIR);
  const cwdModels = path.join(process.cwd(), "models");
  if (!out.includes(cwdModels)) out.push(cwdModels);
  const executableModels = path.join(path.dirname(process.execPath), "models");
  if (!out.includes(executableModels)) out.push(executableModels);
  // <userData>/models 是唯一保证「非管理员装机也能写」的位置，下载器就落在这里；
  // 开发态与打包态因此共用同一份模型，重装不必再下一遍。
  try {
    const userDataModels = path.join(app.getPath("userData"), "models");
    if (!out.includes(userDataModels)) out.push(userDataModels);
  } catch {
    // app not ready yet — fall through
  }
  try {
    const appModels = path.join(app.getAppPath(), "models");
    if (!out.includes(appModels)) out.push(appModels);
  } catch {
    // app not ready yet — fall through
  }
  if (process.resourcesPath) {
    const resModels = path.join(process.resourcesPath, "models");
    if (!out.includes(resModels)) out.push(resModels);
  }
  return out;
}

/** Primary project-models directory (highest-priority candidate). */
export function getProjectModelsDir(): string {
  return getProjectModelsDirCandidates()[0];
}

/**
 * Where the in-app downloader installs models: `<userData>/models`.
 * Returns null when the app is not ready yet (before `app.whenReady()`).
 */
export function getInstallableModelsDir(): string | null {
  try {
    return path.join(app.getPath("userData"), "models");
  } catch {
    return null;
  }
}

/**
 * Resolve the base directory containing a complete local model. This is the
 * same probe used by the settings status UI, so a displayed installed model
 * and the runtime loader can never disagree about its location.
 */
export function getProjectModelBaseDir(kind: "embedding" | "reranker", modelKey: string): string | null {
  const modelId = toModelId(kind, modelKey);
  for (const baseDir of getProjectModelsDirCandidates()) {
    const probe = probeCandidates(modelId, baseDir, PROJECT_SUB_PATHS);
    if (probe.installed) return baseDir;
  }
  return null;
}

/**
 * Detailed per-model diagnostic for troubleshooting "model not detected" bugs.
 *
 * Semantics:
 * - A project model directory "exists" if at least one candidate sub-path
 *   directory exists under any project base dir (even if incomplete).
 * - If a project model directory exists but is incomplete, we do NOT
 *   fall back to the HuggingFace cache — that would silently mask the
 *   real problem (user dropped a partial model into the project tree).
 * - HF cache is only used as fallback when no project model directory
 *   exists at all.
 *
 * Returned object:
 *   - modelId: the canonical model identifier we probed
 *   - installed: true if at least one probe succeeded (project or HF)
 *   - source: "project" | "hf-cache" | null  (which candidate set matched)
 *   - matchedAt: absolute path of the directory that satisfied all required
 *                files (null when installed is false)
 *   - existingProjectDir: first project-side directory that exists at all
 *                (even if incomplete). null when no project directory exists.
 *   - modelDirCandidates: every project baseDir we probed
 *   - subPathCandidates: sub-paths tried under each baseDir
 *   - requiredFiles: file names that must all be present
 *   - missingFiles: missing files in `existingProjectDir` when project exists
 *                  but is incomplete; otherwise []
 */
export interface ModelStatusDetail {
  modelId: string;
  installed: boolean;
  source: "project" | "hf-cache" | null;
  matchedAt: string | null;
  existingProjectDir: string | null;
  modelDirCandidates: string[];
  subPathCandidates: string[];
  requiredFiles: string[];
  missingFiles: string[];
}

export function getModelInstallStatusDetail(
  kind: "embedding" | "reranker",
  modelKey: string,
): ModelStatusDetail {
  const modelId = toModelId(kind, modelKey);

  const subPaths = PROJECT_SUB_PATHS[modelId] ?? [];
  const projectBaseDirs = getProjectModelsDirCandidates();

  // Walk every project (baseDir, subPath) combination.
  let existingProjectDir: string | null = null;
  let existingProjectMissing: string[] = [];
  let projectMatchedAt: string | null = null;

  for (const baseDir of projectBaseDirs) {
    const probe = probeCandidates(modelId, baseDir, PROJECT_SUB_PATHS);
    for (const c of probe.candidates) {
      if (fs.existsSync(c.modelDir)) {
        if (existingProjectDir === null) {
          existingProjectDir = c.modelDir;
          existingProjectMissing = c.missingFiles;
        }
        if (c.missingFiles.length === 0 && projectMatchedAt === null) {
          projectMatchedAt = c.modelDir;
        }
      }
    }
  }

  if (projectMatchedAt) {
    return {
      modelId,
      installed: true,
      source: "project",
      matchedAt: projectMatchedAt,
      existingProjectDir: projectMatchedAt,
      modelDirCandidates: projectBaseDirs,
      subPathCandidates: subPaths,
      requiredFiles: REQUIRED_FILES,
      missingFiles: [],
    };
  }

  // Project model dir exists but is incomplete → refuse to fall back.
  if (existingProjectDir !== null) {
    return {
      modelId,
      installed: false,
      source: null,
      matchedAt: null,
      existingProjectDir,
      modelDirCandidates: projectBaseDirs,
      subPathCandidates: subPaths,
      requiredFiles: REQUIRED_FILES,
      missingFiles: existingProjectMissing,
    };
  }

  // No project model dir at all → try HF cache as last resort.
  const hfProbe = probeCandidates(modelId, HF_CACHE_DIR, HF_CACHE_SUB_PATHS);
  const hfHit = hfProbe.candidates.find((c) => c.missingFiles.length === 0);
  if (hfHit) {
    return {
      modelId,
      installed: true,
      source: "hf-cache",
      matchedAt: hfHit.modelDir,
      existingProjectDir: null,
      modelDirCandidates: projectBaseDirs,
      subPathCandidates: subPaths,
      requiredFiles: REQUIRED_FILES,
      missingFiles: [],
    };
  }

  return {
    modelId,
    installed: false,
    source: null,
    matchedAt: null,
    existingProjectDir: null,
    modelDirCandidates: projectBaseDirs,
    subPathCandidates: subPaths,
    requiredFiles: REQUIRED_FILES,
    missingFiles: [],
  };
}

export function checkEmbeddingModelInstalled(modelKey: string): boolean {
  const detail = getModelInstallStatusDetail("embedding", modelKey);
  return detail.installed;
}

/** 已安装的本机 embedding 模型 key（按注册表顺序）。 */
export function listInstalledEmbeddingModels(): LocalEmbeddingModelKey[] {
  return LOCAL_EMBEDDING_MODEL_KEYS.filter(checkEmbeddingModelInstalled);
}

export function checkRerankerModelInstalled(): boolean {
  const detail = getModelInstallStatusDetail("reranker", "standard");
  return detail.installed;
}
