import { useEffect, useState } from "react";
import { Alert, Button, Input, Modal, Radio, Spin } from "antd";
import { BookOpen, Heart, Images } from "lucide-react";
import type { LocalModelInstallView, ModelInstallProgressView, ModelSettings, SettingsApi } from "../../../settings/shared/types";
import { useTranslation } from "../../i18n";
import { SettingsInput, SettingsSlider, SettingsSwitch } from "../../components/ui/SettingsControls";
import { StickerManagerModal } from "./StickerManagerModal";
import { Card } from "../../components/ui/Card";

type RuntimeSync = "off" | "local" | "llm";
type StickerSize = "small" | "standard" | "large";
type Values = { runtimeSync: RuntimeSync; stickerEnabled: boolean; stickerSize: StickerSize; stickerSimilarityThreshold: number; embeddingDimensions?: number };
type Notice = { type: "success" | "error" | "info"; text: string };
type ExtendedSettingsApi = SettingsApi & { getRerankerStatus?: () => Promise<{ light: boolean; standard: boolean }> };

const defaults: Values = { runtimeSync: "off", stickerEnabled: true, stickerSize: "standard", stickerSimilarityThreshold: 0.55 };

/** 字节数按 MiB 取整显示：清单本身是精确字节，UI 只关心量级。 */
function formatMb(bytes: number): string {
  return (bytes / 1048576).toFixed(0);
}

function settingsApi(): ExtendedSettingsApi | undefined {
  return window.settings as unknown as ExtendedSettingsApi | undefined;
}

function readValues(config: Partial<Values>): Values {
  return {
    runtimeSync: config.runtimeSync === "local" || config.runtimeSync === "llm" ? config.runtimeSync : "off",
    stickerEnabled: config.stickerEnabled !== false,
    stickerSize: config.stickerSize === "small" || config.stickerSize === "large" ? config.stickerSize : "standard",
    stickerSimilarityThreshold: typeof config.stickerSimilarityThreshold === "number" ? config.stickerSimilarityThreshold : 0.55,
    embeddingDimensions: typeof config.embeddingDimensions === "number" ? config.embeddingDimensions : undefined,
  };
}

export function CyreneSettingsPanel() {
  const { t } = useTranslation();
  const [values, setValues] = useState<Values>(defaults);
  const [memoryMode, setMemoryMode] = useState<ModelSettings["memoryMode"]>("vector");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [models, setModels] = useState<LocalModelInstallView[]>([]);
  const [currentModelKey, setCurrentModelKey] = useState("");
  const [installing, setInstalling] = useState<{ modelKey: string; progress: ModelInstallProgressView | null } | null>(null);
  const [switchingKey, setSwitchingKey] = useState<string | null>(null);
  const [rerankerInstalled, setRerankerInstalled] = useState<boolean | null>(null);
  // 档位以主进程设置为准：降级发生在主进程（模型缺失时 standard 实际按 none 跑），
  // 本地再存一份只会让按钮显示成一个值、真正跑的是另一个值。
  const [rerankerMode, setRerankerMode] = useState<"standard" | "none">("standard");
  const [addOpen, setAddOpen] = useState(false);
  const [stickerManagerOpen, setStickerManagerOpen] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState("");
  const [pickedPath, setPickedPath] = useState("");
  const [stickerId, setStickerId] = useState("");
  const [stickerDescription, setStickerDescription] = useState("");
  const [stickerPhrases, setStickerPhrases] = useState("");

  useEffect(() => {
    let active = true;
    const api = settingsApi();
    if (!api) { setNotice({ type: "error", text: t("settingsPage.cyrene.unavailable") }); setLoading(false); return; }
    void api.getConfig().then((config) => { if (active) { setValues(readValues(config)); setMemoryMode(config.memoryMode === "summary" || config.memoryMode === "wiki" || config.memoryMode === "off" ? config.memoryMode : "vector"); setRerankerMode(config.rerankerMode === "none" ? "none" : "standard"); setLoading(false); } }).catch(() => { if (active) { setNotice({ type: "error", text: t("settingsPage.cyrene.loadFailed") }); setLoading(false); } });
    void api.getRerankerStatus?.().then((status) => { if (active) setRerankerInstalled(status.standard); }).catch(() => {});
    void api.getModelInstallList?.().then((list) => {
      if (!active || !list) return;
      setModels(list.models);
      setCurrentModelKey(list.currentModelKey);
    }).catch(() => {});
    // 下载进度只在本页挂载期间订阅；收尾事件顺手刷新清单，让按钮翻成「启用」。
    const offProgress = api.onModelInstallProgress?.((progress) => {
      if (!active) return;
      setInstalling((current) => (current && current.modelKey === progress.modelKey ? { ...current, progress } : current));
      if (progress.phase === "done" || progress.phase === "cancelled" || progress.phase === "error") {
        void api.getModelInstallList?.().then((list) => {
          if (!active || !list) return;
          setModels(list.models);
          setCurrentModelKey(list.currentModelKey);
        }).catch(() => {});
      }
    });
    return () => { active = false; offProgress?.(); };
  }, [t]);

  function update<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    setNotice(null);
    if (key === "runtimeSync") settingsApi()?.previewRuntimeSync(value as RuntimeSync);
  }

  async function save() {
    const api = settingsApi();
    if (!api) return;
    setSaving(true);
    try {
      await api.saveConfig({ ...values, embeddingDimensions: values.embeddingDimensions && values.embeddingDimensions > 0 ? Math.min(65536, Math.round(values.embeddingDimensions)) : undefined });
      setNotice({ type: "success", text: t("settingsPage.cyrene.saved") });
    } catch {
      try {
        const persisted = await api.getConfig();
        setValues(readValues(persisted));
      } catch { /* keep the current form if config reload also fails */ }
      setNotice({ type: "error", text: t("settingsPage.cyrene.saveFailed") });
    }
    finally { setSaving(false); }
  }

  async function openStickerManager() {
    setStickerManagerOpen(true);
  }

  async function pickStickerFile() {
    try {
      const path = await settingsApi()?.stickerPickFile?.();
      if (!path) return;
      setPickedPath(path);
      if (!stickerId) setStickerId((path.split(/[\\/]/).pop() ?? "").replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, ""));
    } catch { setAddError(t("settingsPage.cyrene.pickFailed")); }
  }

  async function addSticker() {
    const api = settingsApi();
    const id = stickerId.trim();
    const description = stickerDescription.trim();
    const phrases = stickerPhrases.split("\n").map((part) => part.trim()).filter(Boolean);
    if (!pickedPath || !/^[a-zA-Z0-9_-]+$/.test(id) || !description || !phrases.length) {
      setAddError(t("settingsPage.cyrene.stickerInvalid"));
      return;
    }
    if (!api?.stickerAdd) return;
    setAddError("");
    setAddBusy(true);
    try {
      const result = await api.stickerAdd({ sourcePath: pickedPath, id, description, phrases });
      if (result && typeof result === "object" && "ok" in result && result.ok === false) throw new Error("Sticker add failed");
      setAddOpen(false);
      setPickedPath(""); setStickerId(""); setStickerDescription(""); setStickerPhrases("");
      setNotice({ type: "success", text: t("settingsPage.cyrene.stickerAdded") });
    } catch { setAddError(t("settingsPage.cyrene.stickerAddFailed")); }
    finally { setAddBusy(false); }
  }

  function openStickerDialog() {
    setPickedPath("");
    setStickerId("");
    setStickerDescription("");
    setStickerPhrases("");
    setAddError("");
    setAddOpen(true);
  }

  async function selectReranker(mode: "standard" | "none") {
    const api = settingsApi();
    if (!api?.rerankerSetMode) return;
    try {
      const okay = await api.rerankerSetMode(mode);
      if (!okay) throw new Error("Reranker switch failed");
      setRerankerMode(mode);
    } catch { setNotice({ type: "error", text: t("settingsPage.cyrene.rerankerFailed") }); }
  }

  function labelOf(modelKey: string): string {
    return models.find((model) => model.modelKey === modelKey)?.label ?? modelKey;
  }

  async function refreshModelList(): Promise<void> {
    const list = await settingsApi()?.getModelInstallList?.();
    if (!list) return;
    setModels(list.models);
    setCurrentModelKey(list.currentModelKey);
  }

  async function selectEmbedding(modelKey: string) {
    const api = settingsApi();
    if (!api?.embeddingSetModel || switchingKey) return;
    setSwitchingKey(modelKey);
    setNotice(null);
    try {
      const result = await api.embeddingSetModel(modelKey);
      if (!result.ok) throw new Error(result.error ?? "");
      setCurrentModelKey(modelKey);
      setNotice({ type: "success", text: t("settingsPage.cyrene.switchDone", { label: labelOf(modelKey) }) });
      await refreshModelList();
    } catch {
      setNotice({ type: "error", text: t("settingsPage.cyrene.embeddingFailed") });
    } finally {
      setSwitchingKey(null);
    }
  }

  async function installModel(modelKey: string) {
    const api = settingsApi();
    if (!api?.modelInstallRun || installing) return;
    setInstalling({ modelKey, progress: null });
    setNotice(null);
    try {
      const result = await api.modelInstallRun(modelKey);
      if (!result.ok) throw new Error(result.error ?? "");
      setNotice({
        type: "success",
        text: result.alreadyInstalled
          ? t("settingsPage.cyrene.installAlready", { label: labelOf(modelKey) })
          : t("settingsPage.cyrene.installDone", { label: labelOf(modelKey) }),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setNotice({
        type: "error",
        text: message.includes("E_MODEL_INSTALL_CANCELLED")
          ? t("settingsPage.cyrene.installCancelled")
          : t("settingsPage.cyrene.installFailed", { error: message }),
      });
    } finally {
      setInstalling(null);
      await refreshModelList();
    }
  }

  async function cancelInstall() {
    await settingsApi()?.modelInstallCancel?.();
  }

  return <>
    <h1>{t("settingsPage.cyrene.title")}</h1>
    <p className="cy-settings-intro">{t("settingsPage.cyrene.description")}</p>
    {notice && <Alert className="cy-settings-alert" showIcon type={notice.type} title={notice.text} closable onClose={() => setNotice(null)} />}
    {loading ? <div className="cy-settings-loading"><Spin /></div> : <>
      <section className="cy-settings-section"><div className="cy-settings-section__heading"><h2><Heart size={18} />{t("settingsPage.cyrene.runtimeTitle")}</h2><p>{t("settingsPage.cyrene.runtimeDescription")}</p></div>
        <Card><div className="cy-settings-row cy-cyrene-radio-row"><div className="cy-settings-row__copy"><strong>{t("settingsPage.cyrene.runtimeMode")}</strong><span>{t("settingsPage.cyrene.runtimeHint")}</span></div><Radio.Group value={values.runtimeSync} optionType="button" buttonStyle="solid" onChange={(event) => update("runtimeSync", event.target.value as RuntimeSync)}><Radio.Button value="off">{t("settingsPage.cyrene.off")}</Radio.Button><Radio.Button value="local">{t("settingsPage.cyrene.local")}</Radio.Button><Radio.Button value="llm">{t("settingsPage.cyrene.llm")}</Radio.Button></Radio.Group></div>{values.runtimeSync === "llm" && <div className="cy-settings-row cy-cyrene-note">{t("settingsPage.cyrene.llmCost")}</div>}</Card>
      </section>
      <section className="cy-settings-section"><div className="cy-settings-section__heading"><h2><Images size={18} />{t("settingsPage.cyrene.stickerTitle")}</h2><p>{t("settingsPage.cyrene.stickerDescription")}</p></div>
        <Card><div className="cy-settings-row"><div className="cy-settings-row__copy"><strong>{t("settingsPage.cyrene.stickerEnabled")}</strong><span>{t("settingsPage.cyrene.stickerEnabledHint")}</span></div><SettingsSwitch ariaLabel={t("settingsPage.cyrene.stickerEnabled")} checked={values.stickerEnabled} onChange={(checked) => update("stickerEnabled", checked)} /></div>
          <div className="cy-settings-row cy-cyrene-radio-row"><div className="cy-settings-row__copy"><strong>{t("settingsPage.cyrene.stickerSize")}</strong></div><Radio.Group value={values.stickerSize} optionType="button" buttonStyle="solid" onChange={(event) => update("stickerSize", event.target.value as StickerSize)}><Radio.Button value="small">{t("settingsPage.cyrene.small")}</Radio.Button><Radio.Button value="standard">{t("settingsPage.cyrene.standard")}</Radio.Button><Radio.Button value="large">{t("settingsPage.cyrene.large")}</Radio.Button></Radio.Group></div>
          <div className="cy-settings-row"><div className="cy-settings-row__copy"><strong>{t("settingsPage.cyrene.threshold")}</strong><span>{t("settingsPage.cyrene.thresholdHint")}</span></div><div className="cy-settings-row__control cy-settings-slider"><SettingsSlider min={0.3} max={0.9} step={0.05} value={values.stickerSimilarityThreshold} ariaLabel={t("settingsPage.cyrene.threshold")} onChange={(value) => update("stickerSimilarityThreshold", value)} /><span>{values.stickerSimilarityThreshold.toFixed(2)}</span></div></div>
          <div className="cy-settings-row cy-cyrene-actions"><Button onClick={() => void openStickerManager()}>{t("settingsPage.cyrene.manageStickers")}</Button><Button onClick={openStickerDialog}>{t("settingsPage.cyrene.addSticker")}</Button></div>
        </Card>
      </section>
      {memoryMode === "vector" && <section className="cy-settings-section"><div className="cy-settings-section__heading"><h2><BookOpen size={18} />{t("settingsPage.cyrene.retrievalTitle")}</h2><p>{t("settingsPage.cyrene.retrievalDescription")}</p></div>
        <Card>
            <div className="cy-settings-row cy-cyrene-models">
              <div className="cy-settings-row__copy"><strong>{t("settingsPage.cyrene.embeddingModel")}</strong><span>{t("settingsPage.cyrene.embeddingHint")}</span></div>
              <div className="cy-cyrene-model-list">
                {models.length === 0 && <span className="cy-cyrene-model-empty">{t("settingsPage.cyrene.modelListUnavailable")}</span>}
                {models.map((model) => {
                  const isCurrent = model.modelKey === currentModelKey;
                  const task = installing?.modelKey === model.modelKey ? installing : null;
                  const percent = task?.progress && task.progress.bytesTotal > 0
                    ? Math.min(100, Math.round((task.progress.bytesDone / task.progress.bytesTotal) * 100))
                    : 0;
                  return <div className={isCurrent ? "cy-cyrene-model cy-cyrene-model--current" : "cy-cyrene-model"} key={model.modelKey}>
                    <div className="cy-cyrene-model__copy">
                      <strong>{model.label}</strong>
                      <span>{t("settingsPage.cyrene.modelSpecs", { dims: model.dims, mb: formatMb(model.bytesTotal) })} · {model.installed ? t("settingsPage.cyrene.installed") : t("settingsPage.cyrene.notInstalled")}{isCurrent ? ` · ${t("settingsPage.cyrene.modelCurrent")}` : ""}</span>
                    </div>
                    <div className="cy-cyrene-model__actions">
                      {!model.installed && <Button size="small" loading={Boolean(task)} disabled={Boolean(installing) && !task} onClick={() => void installModel(model.modelKey)}>{t("settingsPage.cyrene.modelInstall")}</Button>}
                      {model.installed && !isCurrent && <Button size="small" loading={switchingKey === model.modelKey} disabled={Boolean(switchingKey)} onClick={() => void selectEmbedding(model.modelKey)}>{t("settingsPage.cyrene.modelUse")}</Button>}
                    </div>
                    {task && <div className="cy-cyrene-install">
                      <div className="cy-cyrene-install__bar"><span style={{ width: `${percent}%` }} /></div>
                      <div className="cy-cyrene-install__meta">
                        <span>{percent}%{task.progress?.file ? ` · ${t("settingsPage.cyrene.modelFile", { index: task.progress.fileIndex, total: task.progress.fileCount })}` : ""}</span>
                        <Button size="small" onClick={() => void cancelInstall()}>{t("settingsPage.cyrene.cancel")}</Button>
                      </div>
                    </div>}
                  </div>;
                })}
              </div>
            </div>
            <div className="cy-settings-row"><div className="cy-settings-row__copy"><strong>{t("settingsPage.cyrene.embeddingDimensions")}</strong><span>{t("settingsPage.cyrene.embeddingDimensionsHint")}</span></div><SettingsInput className="cy-cyrene-dimensions" type="number" min={1} max={65536} value={values.embeddingDimensions ?? ""} placeholder={t("settingsPage.cyrene.autoDetect")} aria-label={t("settingsPage.cyrene.embeddingDimensions")} onChange={(event) => update("embeddingDimensions", event.target.value ? Number(event.target.value) : undefined)} /></div>
            <div className="cy-settings-row cy-cyrene-radio-row"><div className="cy-settings-row__copy"><strong>{t("settingsPage.cyrene.reranker")}</strong><span>{rerankerInstalled === null ? t("settingsPage.cyrene.unknown") : rerankerInstalled ? t("settingsPage.cyrene.installed") : t("settingsPage.cyrene.notInstalled")}{rerankerInstalled === false && rerankerMode === "standard" ? t("settingsPage.cyrene.rerankerDowngraded") : ""}</span></div><Radio.Group value={rerankerMode} optionType="button" buttonStyle="solid" onChange={(event) => void selectReranker(event.target.value as "standard" | "none")}><Radio.Button value="standard">bge-reranker-base</Radio.Button><Radio.Button value="none">{t("settingsPage.cyrene.off")}</Radio.Button></Radio.Group></div>
        </Card>
      </section>}
      <div className="cy-settings-form-footer"><Button type="primary" loading={saving} onClick={() => void save()}>{t("settingsPage.cyrene.save")}</Button></div>
    </>}
    <Modal className="cy-settings-theme-modal" open={addOpen} title={t("settingsPage.cyrene.addSticker")} okText={t("settingsPage.cyrene.add")} cancelText={t("settingsPage.cyrene.cancel")} okButtonProps={{ loading: addBusy }} onOk={() => void addSticker()} onCancel={() => setAddOpen(false)} destroyOnHidden><div className="cy-cyrene-sticker-form">{addError && <Alert type="error" showIcon title={addError} />}<label><span>{t("settingsPage.cyrene.stickerFile")}</span><div className="cy-cyrene-sticker-file"><Button onClick={() => void pickStickerFile()}>{t("settingsPage.cyrene.chooseFile")}</Button><span>{pickedPath.split(/[\\/]/).pop() || t("settingsPage.cyrene.noFile")}</span></div></label><label><span>{t("settingsPage.cyrene.stickerId")}</span><SettingsInput value={stickerId} onChange={(event) => setStickerId(event.target.value)} /></label><label><span>{t("settingsPage.cyrene.stickerDescriptionField")}</span><SettingsInput value={stickerDescription} onChange={(event) => setStickerDescription(event.target.value)} /></label><label><span>{t("settingsPage.cyrene.stickerPhrases")}</span><Input.TextArea rows={3} value={stickerPhrases} onChange={(event) => setStickerPhrases(event.target.value)} /></label></div></Modal>
    <StickerManagerModal open={stickerManagerOpen} onClose={() => setStickerManagerOpen(false)} />
  </>;
}
