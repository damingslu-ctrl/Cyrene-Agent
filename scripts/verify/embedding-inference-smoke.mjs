#!/usr/bin/env node
// 本地检索模型的真推理实测（生产代码路径）。
//
// 它要加载 ~100MB 的 onnx 权重，所以不进 CI，只显式跑：
//   pnpm run verify:embedding
//
// 模型目录默认取装机位置 %APPDATA%\Mochi\models，也可用 CYRENE_MODELS_DIR 指到别处；
// 两者都是 model-status.ts 生产候选列表里的入口，不是脚本自造的旁路。
import { createRequire } from "node:module";
import * as path from "node:path";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");

const modelsDir =
  process.env.CYRENE_MODELS_DIR ||
  (process.env.APPDATA ? path.join(process.env.APPDATA, "Mochi", "models") : "");
if (!modelsDir || !fs.existsSync(modelsDir)) {
  console.error(`[embedding-smoke] 模型目录不存在：${modelsDir || "(未设置)"}`);
  process.exit(1);
}
process.env.CYRENE_MODELS_DIR = modelsDir;

const compiled = path.join(repoRoot, "dist", "main", "main", "rag", "embedding.js");
if (!fs.existsSync(compiled)) {
  console.error(`[embedding-smoke] 找不到编译产物：${compiled}`);
  console.error("[embedding-smoke] 先跑 'pnpm run build:main'");
  process.exit(1);
}

const { createLocalEmbeddingProvider } = require(compiled);
const { checkEmbeddingModelInstalled, listInstalledEmbeddingModels, getProjectModelBaseDir } = require(
  path.join(repoRoot, "dist", "main", "main", "rag", "model-status.js"),
);

const MODEL_KEY = process.env.CYRENE_SMOKE_MODEL_KEY || "bgeBaseZh";
const EXPECTED_DIMS = Number(process.env.CYRENE_SMOKE_DIMS || 768);

const failures = [];
function check(label, condition, detail) {
  if (condition) {
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    failures.push(label);
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function norm(vec) {
  let sum = 0;
  for (const v of vec) sum += v * v;
  return Math.sqrt(sum);
}
function cosine(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot / (norm(a) * norm(b));
}

console.log(`[embedding-smoke] 模型目录：${modelsDir}`);
const baseDir = getProjectModelBaseDir("embedding", MODEL_KEY);
console.log(`[embedding-smoke] 生产候选解析到的 baseDir：${baseDir ?? "(null)"}`);

console.log("\n[1] 安装态（MODEL_INSTALL_LIST 读的就是这一层）");
check(`${MODEL_KEY} 判定为已安装`, checkEmbeddingModelInstalled(MODEL_KEY) === true);
check(
  "列出已安装清单",
  listInstalledEmbeddingModels().includes(MODEL_KEY),
  `listInstalledEmbeddingModels() = [${listInstalledEmbeddingModels().join(", ")}]`,
);

const provider = createLocalEmbeddingProvider(MODEL_KEY);
console.log("\n[2] Provider 构造");
check("createLocalEmbeddingProvider 返回非 null", provider !== null);
if (!provider) {
  console.error("\n[embedding-smoke] 生产路径给不出 provider，后续推理无从谈起。");
  process.exit(1);
}
check(`声明维度与注册表一致（${EXPECTED_DIMS}）`, provider.dims === EXPECTED_DIMS, `dims=${provider.dims}`);
check("cacheIdentity 打上 local 出处", provider.cacheIdentity?.provider === "local", provider.cacheIdentity?.model);

const zh = "麻糬今天也趴在桌角守着代理";
const en = "The cat sleeps on the windowsill while the proxy runs.";

let t0 = Date.now();
const single = await provider.embed(zh);
const firstMs = Date.now() - t0;
console.log(`\n[3] 单条推理（含首次加载权重，耗时 ${firstMs}ms）`);
check(`长度为 ${EXPECTED_DIMS} 维`, single.length === EXPECTED_DIMS, `got ${single.length}`);
check("全部是有限数", single.every((v) => Number.isFinite(v)));
check("归一化后模长 ≈ 1", Math.abs(norm(single) - 1) < 1e-3, `|v|=${norm(single).toFixed(6)}`);
check("不是全零向量", single.some((v) => Math.abs(v) > 1e-6));

t0 = Date.now();
const solo = await provider.embedBatch([zh]);
const pair = await provider.embedBatch([zh, en]);
const batchMs = Date.now() - t0;
console.log(`\n[4] 批量推理（${batchMs}ms，管线已热）`);
check("批量返回条数 = 输入条数", pair.length === 2);
check("每行都是预期维度", pair.every((v) => v.length === EXPECTED_DIMS), `${pair.map((v) => v.length).join("/")}`);
check("每行都归一化", pair.every((v) => Math.abs(norm(v) - 1) < 1e-3));
check("空批量短路返回空数组", (await provider.embedBatch([])).length === 0);
// 单元素批次没有 padding 干扰，cos 必须是 1——这一条才管得住 embedBatch 用
// subarray 手切行时切错位的可能。
check(
  "单元素批次与单条完全一致（cos=1）",
  cosine(single, solo[0]) > 0.99999,
  `cos=${cosine(single, solo[0]).toFixed(6)}`,
);
// 混长度批次里，短句那一行会被批内最长句的 padding 扰动：实测带 0.979~0.986，
// 且不随补齐长度增长（8/32/128/256 词都在同一带内）。0.97 是带下沿留余量，
// 明显跌破说明批切分退化成了另一件事，得回头看 pooling。
check(
  "混长度批次第 0 行仍在扰动带内（cos>0.97）",
  cosine(single, pair[0]) > 0.97,
  `cos=${cosine(single, pair[0]).toFixed(6)}`,
);

// 判据设计：只换 3~5 个字的同主题对照 + 同批无关对照。
// 「比随机基线高」不能证明能检索，所以要每组都比一次自己的无关对照；
// 0.55 这个下限对照的是生产向量阈值 minScore=0.3（src/main/rag/vectorstore.ts:382）——
// 无关句实测 0.24~0.29 正好卡在它下面，合法改写（实测 0.78~0.82）不能掉到 0.55 以下。
const probes = [
  ["猫在窗台上睡觉", "猫咪在窗边打盹", "本季度营收同比增长百分之十八"],
  ["今天天气很好", "今天阳光不错", "服务器磁盘空间不足告警"],
  ["请帮我写一封请假邮件", "麻烦代写一份休假申请", "推荐几部好看的科幻电影"],
]
  .map(([a, b, c]) => [a, b, c].map(provider.embed.bind(provider)))
  .flat();
const [same1, near1, away1, same2, near2, away2, same3, near3, away3] = await Promise.all(probes);

console.log("\n[5] 语义分辨力（选型是否成立的判据）");
const pairs = [
  ["猫在窗台上睡觉", same1, "猫咪在窗边打盹", near1, "本季度营收同比增长百分之十八", away1],
  ["今天天气很好", same2, "今天阳光不错", near2, "服务器磁盘空间不足告警", away2],
  ["请帮我写一封请假邮件", same3, "麻烦代写一份休假申请", near3, "推荐几部好看的科幻电影", away3],
];
let sameMin = 1;
let awayMax = 0;
for (const [ta, va, tb, vb, tc, vc] of pairs) {
  const s = cosine(va, vb);
  const away = Math.max(cosine(va, vc), cosine(vb, vc));
  sameMin = Math.min(sameMin, s);
  awayMax = Math.max(awayMax, away);
  console.log(`  「${ta}」×「${tb}」 cos=${s.toFixed(4)}  vs 无关句 max cos=${away.toFixed(4)}`);
}
// 这一档是本尺子自己守的：向量层没有「同主题最低分」的概念，分数只用来排序，
// 掉到无关句区间以下就不是模型在工作了。
check("同主题相近档整体可用（最小 cos ≥ 0.55）", sameMin >= 0.55, `min=${sameMin.toFixed(4)}`);
check(
  "每组同主题都高过它的无关对照",
  pairs.every(([, va, , vb, , vc]) => {
    const same = cosine(va, vb);
    return same > Math.max(cosine(va, vc), cosine(vb, vc));
  })
);
check("无关句没有盖过同主题最低分", awayMax < sameMin, `awayMax=${awayMax.toFixed(4)} < sameMin=${sameMin.toFixed(4)}`);

const english = await provider.embed(en);
check("中英混排同一模型可用（跨语言检索的前提）", english.length === EXPECTED_DIMS && Math.abs(norm(english) - 1) < 1e-3);

console.log("");
if (failures.length > 0) {
  console.error(`[embedding-smoke] FAIL（${failures.length} 项）：${failures.join(" / ")}`);
  process.exit(1);
}
console.log(`[embedding-smoke] PASS — ${MODEL_KEY} 走生产代码路径产出 ${EXPECTED_DIMS} 维归一化向量。`);
