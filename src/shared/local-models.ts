// 本地检索（embedding）模型注册表 — 主进程、下载器与设置页共用的唯一事实源。
//
// 这里只登记「文件清单 + 维度 + 名字」这类跨进程契约；安装状态探测在
// main/rag/model-status.ts，实际加载在 main/rag/embedding.ts。

export type LocalEmbeddingModelKey = "bgeBaseZh" | "bgem3";

export interface LocalModelFileSpec {
  /** 相对模型目录的路径，统一用正斜杠。 */
  path: string;
  /** 期望字节数 — 下载完成后逐文件校验，size 不符即判定为坏档。 */
  bytes: number;
}

export interface LocalEmbeddingModelSpec {
  key: LocalEmbeddingModelKey;
  /** transformers.js 加载用的 HF 全名，恒等于 `Xenova/${dirName}`。 */
  hfName: string;
  /** 模型目录名；项目侧落在 `models/Xenova/${dirName}`。 */
  dirName: string;
  dims: number;
  /** 设置页展示名（非 i18n 文案，模型名是专有名词）。 */
  label: string;
  /** 一句话说明该档的取舍，供设置页 tooltip 直接显示。 */
  note: string;
  totalBytes: number;
  files: LocalModelFileSpec[];
}

// size 取自 HF `?blobs=true` 实测（int8 量化档）。量化权重自带全部张量，
// 不需要 fp32 那份的 `*_external_data` 附属文件——清单里出现它就是坏档。
export const LOCAL_EMBEDDING_MODELS: Record<LocalEmbeddingModelKey, LocalEmbeddingModelSpec> = {
  bgeBaseZh: {
    key: "bgeBaseZh",
    hfName: "Xenova/bge-base-zh-v1.5",
    dirName: "bge-base-zh-v1.5",
    dims: 768,
    label: "BGE-base-zh-v1.5",
    note: "中文检索默认档：103 MB / 768 维，纯 CPU 也快",
    totalBytes: 103_419_513,
    files: [
      { path: "config.json", bytes: 938 },
      { path: "tokenizer.json", bytes: 439_124 },
      { path: "tokenizer_config.json", bytes: 366 },
      { path: "special_tokens_map.json", bytes: 125 },
      { path: "vocab.txt", bytes: 109_540 },
      { path: "quantize_config.json", bytes: 674 },
      { path: "onnx/model_quantized.onnx", bytes: 102_868_746 },
    ],
  },
  bgem3: {
    key: "bgem3",
    hfName: "Xenova/bge-m3",
    dirName: "bge-m3",
    dims: 1024,
    label: "BGE-M3",
    note: "多语种高精档：592 MB / 1024 维，CPU 推理慢数倍",
    totalBytes: 591_850_143,
    files: [
      { path: "config.json", bytes: 770 },
      { path: "tokenizer.json", bytes: 17_082_821 },
      { path: "tokenizer_config.json", bytes: 1_173 },
      { path: "special_tokens_map.json", bytes: 964 },
      { path: "sentencepiece.bpe.model", bytes: 5_069_051 },
      { path: "quantize_config.json", bytes: 834 },
      { path: "onnx/model_quantized.onnx", bytes: 569_694_530 },
    ],
  },
};

export const LOCAL_EMBEDDING_MODEL_KEYS: LocalEmbeddingModelKey[] = Object.keys(
  LOCAL_EMBEDDING_MODELS,
) as LocalEmbeddingModelKey[];

/** 默认档：装得下、跑得快，且本机已随包预置。 */
export const DEFAULT_LOCAL_EMBEDDING_MODEL: LocalEmbeddingModelKey = "bgeBaseZh";

export function isLocalEmbeddingModelKey(value: unknown): value is LocalEmbeddingModelKey {
  return typeof value === "string"
    && Object.prototype.hasOwnProperty.call(LOCAL_EMBEDDING_MODELS, value);
}

/** 设置读盘入口：脏值（旧版本写死的值、手改的 json）静默回落到默认档。 */
export function resolveLocalEmbeddingModelKey(value: unknown): LocalEmbeddingModelKey {
  return isLocalEmbeddingModelKey(value) ? value : DEFAULT_LOCAL_EMBEDDING_MODEL;
}

export function getLocalEmbeddingModel(key: unknown): LocalEmbeddingModelSpec | undefined {
  return isLocalEmbeddingModelKey(key) ? LOCAL_EMBEDDING_MODELS[key] : undefined;
}
