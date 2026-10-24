import { BRAND, CONSOLE_PREFIX } from "../../shared/brand";
import { disposeAllShellJobs } from "../orchestrator/tools/builtin-tools/shell-job-manager";
import { closeConversationDatabases } from "../storage/conversation-database-client";
/**
 * 默认应用依赖装配（真正的组合根胶水层）：
 * 持有全部业务子系统的导入与工厂闭包，把它们按窄依赖喂给各启动阶段。
 * 只有 index.ts 引用本模块；application.ts 与各 bootstrap 模块不感知具体实现。
 *
 * 本文件内的闭包只做构造与委托；任何长期任务都必须由对应启动阶段显式启动。
 */

import { app, BrowserWindow, dialog, screen } from "electron";
import * as fs from "fs";
import * as path from "path";

import { ensureGpuSandboxAcl } from "../gpu-sandbox-acl";
import { configureVergeIdentity, hasExplicitUserDataDir } from "../app-identity";
import { getExternalContentPaths } from "../external-content-paths";
import { migrateStagedExternalContent } from "../external-content-migration";
import { logger, LogTag, installMainLogSink } from "../logger";
import { renderBanner } from "../../shared/banner";
import { IPC } from "../../shared/ipc-channels";
import { isDev } from "../env";
import {
  loadGeneralSettings,
  saveGeneralSettings,
  onGeneralSettingsChanged,
} from "../settings/settings-facade";
import {
  getCurrentAppIconPath,
  markStartupPhaseReady,
  reactChatWindow,
  setGetCurrentAppIconPath,
} from "../windows/window-state";
import { loadModelSettings, saveModelSettings } from "../settings/model-settings";
import { getConversationTranscriptStore } from "../orchestrator/conversation-transcript-store";
import { getHarnessRunStore } from "../orchestrator/harness/run-store";
import { createModelBackedConversationTranscriptCompactor } from "../orchestrator/conversation-transcript-compactor";
import { ConversationJournalService } from "../orchestrator/conversation-journal-service";
import { activeConversationRegistry } from "../chats/active-conversation-registry";
import { registerSettingsIpc } from "../settings/settings-ipc";
import {
  applyGeneralSettings,
  handleGeneralSettingsChanged,
  syncVolcanoSearchMcp,
} from "../settings/general-settings-lifecycle";
import { registerMemoryUserToolIpc } from "../memory/memory-user-ipc";
import { registerWikiMemoryIpc } from "../memory/wiki-memory-ipc";
import { registerKnowledgeBaseIpc } from "../knowledge-base/knowledge-base-ipc";
import { initializeKnowledgeBase } from "../knowledge-base/knowledge-base-service";
import { createLlmClient } from "../services/llm/llm-client";
import { createTtsSynthesisService } from "../services/tts/tts-synthesis-service";
import { momentsService } from "../moments/moments-service";
import {
  addL2MemoryVector,
  deleteUserMemoryVectors,
  flushRAGStore,
  flushRAGStoreSync,
  getEntriesBySource,
  initWorldbook,
  initVectorMemory,
  disposeVectorMemory,
  isUserMemoryVectorStoreReady,
} from "../rag";
import { isMemoryEnabled, isSummaryMemoryEnabled, setMemoryMode, type MemoryMode } from "../memory/memory-mode";
import { initializeSummaryMemoryScheduler, enableSummaryMemoryScheduler, flushAllSummaryMemory, scheduleSummaryTurn } from "../memory/summary-memory-scheduler";
import { createConversationSessionMigration } from "../orchestrator/conversation-session-migration";
import { createWikiChatSourceReader } from "../memory/wiki-source";
import { initializeWikiMemoryScheduler, enableWikiMemoryScheduler, scheduleWikiTurn } from "../memory/wiki-memory-scheduler";
import { loadSummaryMemoryContext } from "../memory/summary-memory-context";
import { clearLegacyStickerEmbeddingCache, loadStickerTextIndex } from "../sticker-text-matcher";
import { toolRegistry } from "../orchestrator/tools/registry/tool-registry";
import { pluginPromptRegistry } from "../../plugins/prompts";
import type { PluginManager } from "../../plugins/manager";
import { registerAllTools } from "../orchestrator/tools/registry/tool-registration";
import { LspManager } from "../lsp/manager";
import { initSandbox } from "../orchestrator/sandbox/sandbox-exec";
import {
  encodePlanSessionKey,
  enterPlanDiscussing,
  exitPlanMode,
  getPlanState,
  initPlanPaths,
  initPlanStateBroadcaster,
  initPlanStatePersister,
  restorePlanSession,
  type PlanStateSnapshot,
} from "../orchestrator/plan-mode";
import { initMcpManager, pruneMcpServersByIds } from "../orchestrator/mcp-manager";
import { syncPlaywrightMcp, syncFilesystemMcp, REMOVED_BUILTIN_MCP_IDS } from "../sync-mcp-builtin";
import { registerAppInfoIpc } from "../verge/app-info-ipc";
import { registerWindowSystemIpc } from "../windows/window-system-ipc";
import { enqueueLLMTask } from "../llm-queue";
import {
  registerPrivilegedSchemes,
  registerProtocolHandlers,
} from "../protocols/bootstrap";
import { memoryStore } from "../memory/memory-store";
import { backupMemoryRagFiles, reconcileMemoryRag } from "../memory/memory-rag-reconciliation";
import { initReranker, resetReranker } from "../rag/reranker";
import { broadcastCompactionPhase, registerChatsIpc } from "../chats/chats-ipc";
import { registerWorkspaceFilesIpc } from "../chats/workspace-files-ipc";
import { registerOpenInAppIpc } from "../chats/open-in-app";
import { registerBrowserPanelIpc } from "../browser/browser-panel-ipc";
import { registerMomentsIpc } from "../moments/moments-ipc";
import { registerChatUiIpc, getActiveChatSessionId } from "../chats/chat-ui-ipc";
import { createToastWindowController } from "../toast/toast-window";
import { createToastService } from "../toast/toast-service";
import { toastEvents } from "../toast/toast-events";
import { createToastWindowShell } from "../windows/create-toast-window";
import * as chatsStore from "../chats/chats-store";
import { flush as flushTokenUsage } from "../token-usage-store";
import { TtsSessionService } from "../tts/tts-session-service";
import { registerTtsIpc } from "../tts/tts-ipc";
import { loadUserProfile } from "../settings-store";
import { getAppIconPath } from "../app-icon";
import { prepareBackgroundSessionMutation, disposeShellCompletionDispatch, hasActiveConversationRun, registerAgUiIpc } from "../agui-bridge";
import { updateLocaleContext } from "../locale-context";
import { registerCallIpc } from "../call/call-manager";
import { initSkills, skillRegistry } from "../skills";
import { createSchedulerSubsystem } from "../scheduler/bootstrap";
import { createChannelsSubsystem } from "../channels/bootstrap";
import { createLifecyclePublisher } from "../plugin-host/lifecycle-publisher";
import { createPendingTurnLifecycle } from "../plugin-host/pending-turn-lifecycle";
import { startPluginRuntime } from "../plugin-runtime";
import { createAgentRuntime } from "../orchestrator/agent-runtime";
import { reconcileCrashedInterruptions } from "../orchestrator/conversation-interruption-reconciliation";
import { createRuntimeStateService } from "../orchestrator/runtime-state-service";
import { createTranscriptCompactorGetter } from "./transcript-compaction-wiring";
import { createProactiveLifecycle } from "../proactive/proactive-lifecycle";
import { createCitaService } from "../services/cita/cita-service";
import { createSocialContextService } from "../services/social-context/social-context-service";
import { createGitService } from "../code-git/git-service";
import { resolveGitExecutable, type ResolvedGitExecutable } from "../code-git/git-executable";
import { registerCodeGitIpc } from "../code-git/code-git-ipc";
import { installSingleInstanceGuard } from "../single-instance";
import { migrateLegacyUserData } from "../user-data-migration";
import { migrateVergeUserData } from "../verge-identity-migration";
import { createWindowManager } from "../windows/window-manager";
import { createTray } from "../tray";
import { createSplashWindow } from "../startup/create-splash-window";
import { revealStartupWindows } from "../startup/startup-window-reveal";
import { bootstrapMusicService } from "../music/bootstrap";
import { createVergeService } from "../verge/verge-service";
import { registerVergeIpc } from "../verge/verge-ipc";
import { createWorkStatusService } from "../pet/work-status";
import { registerWorkStatusIpc } from "../pet/work-status-ipc";
import { attachPetContextMenu } from "../verge/pet-menu";
import { discoverConfigRoot } from "../verge/controller-config";
import { createNetworkService } from "../verge/network-service";
import { registerNetworkIpc } from "../verge/network-ipc";
import { attachQuietClock, quietChangedPayload } from "../verge/quiet-clock-wiring";
import { armQuiet, isQuietNow } from "../verge/quiet-clock";
import { TUCK_IDLE_SECS, TUCK_PROBE_IDLE_SECS } from "../verge/tuck-clock";
import { resolveMusicPaths } from "../music/paths";
import { initializeScreenshotService } from "../screenshot/screenshot-lifecycle";
import { bootstrapConfigGetters } from "../startup/bootstrap-config";
import { bootstrapPermission } from "../permission/bootstrap";
import { registerPopQuizIpc, registerPopQuizTool } from "../orchestrator/pop-quiz";
import { createExamPaperStore } from "../learn/exam-paper-store";
import { createExamDraftStore } from "../learn/exam-draft";
import { registerExamPaperIpc } from "../learn/exam-paper-ipc";
import { registerLearnExamPageIpc } from "../learn/exam-page-ipc";
import { registerLearnExamTools } from "../orchestrator/learn-exam-tools";
import { GmailAuthService } from "../email/gmail-auth-service";
import { GmailService } from "../email/gmail-service";
import { registerGmailIpc } from "../email/gmail-ipc";
import { MailAttachmentStore } from "../email/mail-attachment-store";

import { createIpcScope } from "./ipc-scope";
import { IPC_SENDER_POLICY } from "./ipc-sender-policy";
import { createShutdownCoordinator } from "./shutdown";
import { createStartupReadiness } from "./readiness";
import { createWindowActivationBroker } from "./window-activation";
import { prepareBeforeReady } from "./pre-ready";
import { startShell } from "./shell-bootstrap";
import { startCore } from "./core-bootstrap";
import { startBackground } from "./background";
import type { ApplicationDependencies } from "./application";

/** Loading 最短展示时长（ms）：从实际 show() 时刻起算。 */
const SPLASH_MIN_MS = 2500;
/** 受控退出总超时（ms）：超时后中止信号并记录未完成资源。 */
const SHUTDOWN_TIMEOUT_MS = 10_000;

function broadcastToAuxWindows(channel: string, payload: unknown): void {
  const win = reactChatWindow;
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, payload);
  }
}

async function reconcileUserMemoryIndex(): Promise<void> {
  if (!isMemoryEnabled()) return;
  if (!isUserMemoryVectorStoreReady()) {
    console.warn("[Memory/RAG] reconciliation skipped: vector store is not writable");
    return;
  }
  const report = await reconcileMemoryRag({
    getMemories: () => memoryStore.getAllL2(),
    getVectors: () => getEntriesBySource("user_memory"),
    backup: async () => backupMemoryRagFiles(app.getPath("userData")),
    addVector: addL2MemoryVector,
    markSynced: (l2Id, ragId) => memoryStore.markL2SyncStatus(l2Id, "synced", ragId),
    markSyncFailed: (l2Id, error) => memoryStore.markL2SyncStatus(l2Id, "sync_failed", undefined, error),
    deleteVectors: (ids) => deleteUserMemoryVectors(ids),
    warn: (message, error) => console.warn(`[Memory/RAG] ${message}:`, error),
  });
  logger.info(LogTag.RAG, "reconciliation:", report);
}

async function switchMemoryMode(mode: MemoryMode): Promise<void> {
  if (mode !== "vector") {
    setMemoryMode(mode);
    enableSummaryMemoryScheduler(mode === "summary");
    await enableWikiMemoryScheduler(mode === "wiki");
    resetReranker();
    await disposeVectorMemory();
    return;
  }

  enableSummaryMemoryScheduler(false);
  setMemoryMode("vector");
  await enableWikiMemoryScheduler(false);
  try {
    const modelSettings = loadModelSettings();
    await initVectorMemory("auto", undefined, undefined, modelSettings.embeddingModel, modelSettings.embeddingDimensions);
    await initReranker(modelSettings.rerankerMode);
    await reconcileUserMemoryIndex();
  } catch (error) {
    setMemoryMode("off");
    resetReranker();
    await disposeVectorMemory().catch(() => undefined);
    throw error;
  }
}

/**
 * 启动崩溃恢复：扫描 userData/plans/各会话目录/state.json，把中断的非 NORMAL 会话还原。
 * 只恢复事实不恢复执行权——统一降级 PLAN_DISCUSSING，REVIEW/EXECUTING 来源
 * 由 [PLAN_RECOVERY] 注入中断事实，模型先查证工作区再修订计划重新审批。
 * 快照的会话键取自文件内容（原始 conversationId），目录名只是物理位置；
 * 单个快照损坏只跳过该会话，不阻塞其他恢复。
 */
function recoverInterruptedPlanSessions(plansRoot: string): void {
  let entries: string[];
  try {
    entries = fs.readdirSync(plansRoot);
  } catch {
    return; // plans 目录不存在 = 从未用过计划模式
  }
  for (const entry of entries) {
    const stateFile = path.join(plansRoot, entry, "state.json");
    try {
      if (!fs.existsSync(stateFile)) continue;
      const snapshot = JSON.parse(fs.readFileSync(stateFile, "utf8")) as PlanStateSnapshot;
      const conversationId = typeof snapshot.conversationId === "string" ? snapshot.conversationId : entry;
      const result = restorePlanSession(conversationId, snapshot);
      if (result.ok) {
        console.log(`[PlanMode] 恢复中断会话 ${conversationId}: ${snapshot.state} → PLAN_DISCUSSING`);
      } else {
        console.warn(`[PlanMode] 跳过非法快照 ${entry}: ${result.reason}`);
      }
    } catch (err) {
      console.warn(`[PlanMode] 读取快照失败 ${stateFile}:`, err);
    }
  }
}

export function createDefaultApplicationDependencies(): ApplicationDependencies {
  // Agent Runtime 早于插件管理器构造；通过窄闭包在运行期转发宿主事件，避免反转启动顺序。
  let pluginManager: PluginManager | undefined;
  // 宠物窗右键菜单/免打扰的挂载点（Task 11）：createLowCostServices（core 阶段先跑）
  // 造好 verge service 后把闭包塞进来；createPetWindow 在 core 后段才第一次被调
  // （core-bootstrap.ts:195，晚于 registerCoreIpc），所以首窗挂载时闭包必已就位。
  let attachVergePetMenu: ((win: Electron.BrowserWindow) => void) | null = null;
  // quiet 写盘收口（Task 11 修复轮）：createLowCostServices 造好自醒钟后把闭包塞进来，
  // registerCoreIpc 的 toggle 路径与宠物窗菜单共用同一条——rearm + 广播当下截止。
  // 两处各写各的会留下「盘上有已过去的截止没人清、月牙等重启才上屏」的欠账态
  // （native main.rs:2515-2517 明令当场清）。
  let onVergeQuietStateChange: ((quietUntil: number | null) => void) | null = null;
  // tuck 开关收口（Task 12）：与 quiet 同构——菜单与 VERGE_SET_TUCK 共用一条广播，
  // 「取消勾选立刻回位且不再藏」要求渲染端即时收到新值，不许等重启。
  let onVergeTuckStateChange: ((enabled: boolean) => void) | null = null;
  // 自动压缩与 CHATS_COMPACT 必须共享同一个会话级压缩器，避免两条路径各自组装 provider。
  const getTranscriptCompactor = createTranscriptCompactorGetter(() =>
    createModelBackedConversationTranscriptCompactor({
      store: getConversationTranscriptStore(app.getPath("userData")),
      runReader: getHarnessRunStore(app.getPath("userData")),
      // 统一向窗口推送运行前和运行中压缩的阶段及上下文占用。
      onPhase: (phase, conversationId, usage) => broadcastCompactionPhase(conversationId, phase, usage),
    }));
  // 生命周期事件发布器：插件系统就绪前发布的事件没有监听器，直接丢弃
  const lifecyclePublisher = createLifecyclePublisher({
    publish: (event, payload) => pluginManager
      ? pluginManager.publishHostEvent(event, payload)
      : Promise.resolve(),
  });
  // 桌面轮次协调器：turn:finished 等待"终态 + 渲染端落盘确认"双条件；
  // 计时器均 unref，应用退出前统一清理，不发布任何事件
  const pendingTurnLifecycle = createPendingTurnLifecycle({
    publisher: lifecyclePublisher,
    onAbandon: (runId, reason) => {
      console.warn(`[plugins] 桌面轮次事件放弃发布: runId=${runId} reason=${reason}`);
    },
  });
  app.on("will-quit", () => {
    pendingTurnLifecycle.disposeAll();
  });
  const readiness = createStartupReadiness();
  const activation = createWindowActivationBroker();
  const shutdown = createShutdownCoordinator({ readiness, timeoutMs: SHUTDOWN_TIMEOUT_MS });
  shutdown.register({ id: "shell-completion-dispatch", phase: "quiesce", dispose: disposeShellCompletionDispatch });
  shutdown.register({ id: "shell-jobs", phase: "stopLocalResources", dispose: disposeAllShellJobs });
  shutdown.register({ id: "conversation-database", phase: "closePersistence", dispose: closeConversationDatabases });

  // 注入应用图标路径 getter（窗口工厂统一读取，避免循环依赖）。
  // 必须在 shell 阶段之前注入：聊天窗口壳与托盘在 shell 阶段创建时就会读取，
  // 若等到 core 阶段再注入，托盘会拿到空路径而显示 Electron 默认图标。
  // getter 为惰性求值，此处注册不触发磁盘读取。
  setGetCurrentAppIconPath(() => getAppIconPath(loadGeneralSettings().uiIcon));

  return {
    app,
    dialog,
    readiness,
    activation,
    shutdown,

    prepare: () => prepareBeforeReady({
      // 探针/验收启动带 --user-data-dir 时，pre-ready 会凭这个标志整步跳过 userData 搬运
      usesExplicitUserDataDir: hasExplicitUserDataDir(process.argv),
      configureIdentity: () => {
        const identity = configureVergeIdentity(app, app.getPath("appData"));
        // 落盘接收器必须晚于身份：installFileLogSink 会把传入的 userData 永久绑进闭包，
        // 早一步（模块顶层）就会绑到上游 %APPDATA%\Cyrene。
        installMainLogSink();
        if (identity.explicitUserDataDir) {
          // 默认可见级别是 warn，info 会被吞掉，所以这条优先级让路提示用 warn。
          logger.warn(
            LogTag.Runtime,
            `检测到显式 --user-data-dir，跳过 fork 的 userData 覆盖，本次实际使用：${identity.userDataPath}`,
          );
        }
      },
      installSingleInstance: (onSecondInstance) => installSingleInstanceGuard(app, onSecondInstance),
      migrateLegacyUserData: () => {
        return migrateLegacyUserData({
          appDataPath: app.getPath("appData"),
          targetUserDataPath: app.getPath("userData"),
        });
      },
      // 身份改名（cyrene-verge → Mochi）带来的一次性搬运。命令行显式给了 --user-data-dir
      // 时，pre-ready 整步跳过这两次搬运（探针 profile 不该接走用户的真账本）。这两次真跑时
      // getPath("userData") 之所以只会是 brand 目录，靠的是上面 usesExplicitUserDataDir 与
      // configureVergeIdentity 读的是同一个 process.argv —— 谁改了其中一处，另一处就会跟着失效。
      migrateVergeUserData: () => migrateVergeUserData({
        appDataPath: app.getPath("appData"),
        targetUserDataPath: app.getPath("userData"),
      }),
      registerPrivilegedSchemes,
      configureGpuSwitches: () => {
        if (loadGeneralSettings().disableGpuElectron) {
          app.commandLine.appendSwitch("disable-gpu");
          app.commandLine.appendSwitch("enable-unsafe-swiftshader");
        }
      },
      ensureGpuSandboxAcl: () => ensureGpuSandboxAcl({
        isPackaged: app.isPackaged,
        exeDir: path.dirname(app.getPath("exe")),
        userDataDir: app.getPath("userData"),
      }),
      activation,
    }),

    startShell: () => startShell({
      readiness,
      activation,
      shutdown,
      writeStartupLog: () => {
        // banner 是纯文本（无色彩、无日志前缀），与 logger 输出区分开
        process.stdout.write("\n" + renderBanner() + "\n\n");
        logger.info(LogTag.Runtime, `starting ${BRAND.productName} Agent`);
      },
      // 生产组合根：这里才打开 R-D11 的发送方闸门（单测默认不开，见 ipc-scope 注释）。
      createIpcScope: () => createIpcScope(undefined, { senderPolicy: IPC_SENDER_POLICY }),
      createSplashWindow: (options) => createSplashWindow({ isDev, onShown: options.onShown }),
      createWindowManager: () => createWindowManager({
        getCurrentAppIconPath,
        isDev,
        loadPetWindowSettingsSlice: loadGeneralSettings,
        persistPetWindowPosition: ({ x, y }) => saveGeneralSettings({ petWindowX: x, petWindowY: y }),
        attachPetContextMenu: (win) => attachVergePetMenu?.(win),
      }),
      createChatShell: (windowManager) => windowManager.createReactChatWindowShell(),
      registerProtocolHandlers,
      registerShellIpc: ({ ipc, windowManager, live2dWindowLifecycle }) => {
        // quit 由组合根注入：窗口系统 IPC 不直接依赖 electron app，且退出仍走受控链路。
        registerWindowSystemIpc({ ipc, windowManager, quit: () => app.quit() });
        registerChatUiIpc({ ipc, live2dWindowLifecycle, windowManager });
      },
      createTray: (input) => createTray({
        togglePetWindow: input.togglePetWindow,
        requestActivation: input.requestActivation,
        quit: () => app.quit(),
      }),
      flushTokenUsage,
    }),

    startCore: (shell) => startCore({
      shell,
      readiness,
      activation,
      shutdown,
      minimumSplashMs: SPLASH_MIN_MS,
      markStartupWindowsReady: () => markStartupPhaseReady(),

      // 升级迁移：NSIS 暂存的安装目录用户内容合并进 userData，
      // 必须在任何 prompts/skills 读取（initSkills、prompt 加载）之前执行
      migrateStagedExternalContent: () => migrateStagedExternalContent({
        isPackaged: app.isPackaged,
        ...getExternalContentPaths(),
      }),
      // Skill 系统：扫描双源 skills + 注册 meta-tool
      initSkills,

      createLowCostServices: () => {
        const runtimeStateService = createRuntimeStateService();
        runtimeStateService.onChange(() => {
          broadcastToAuxWindows(IPC.RUNTIME_STATE_CHANGED, runtimeStateService.getState());
        });

        const llmClient = createLlmClient();
        const ttsSynthesisService = createTtsSynthesisService();
        clearLegacyStickerEmbeddingCache(app.getPath("userData"));
        const citaService = createCitaService({ llmClient });
        const socialContextService = createSocialContextService({ llmClient, enqueueLLMTask });
        const proactiveLifecycle = createProactiveLifecycle({
          loadGeneralSettings,
          // runReader 接入 harness 运行存储：孤儿工具按运行状态归类，避免误判 not_executed
          conversationJournal: new ConversationJournalService({
            store: getConversationTranscriptStore(app.getPath("userData")),
            runReader: getHarnessRunStore(app.getPath("userData")),
          }),
        });
        // 主动聊天服务初始化是纯装配；触发器由 background 阶段启动
        proactiveLifecycle.initializeProactiveChatService();

        // 崩溃对账：启动时对进程崩溃遗留的 interrupted run 幂等补写 crashed 中断边界。
        // 异步、失败仅日志，不阻塞启动关键路径；两 store 单例在此刻均已就绪。
        void reconcileCrashedInterruptions({
          runStore: getHarnessRunStore(app.getPath("userData")),
          transcriptStore: getConversationTranscriptStore(app.getPath("userData")),
          now: Date.now,
        }).then((result) => {
          if (result.written > 0) {
            console.log(`[CrashReconcile] 补写 ${result.written} 条崩溃边界，跳过 ${result.skipped} 个已有边界的中断 run`);
          }
        }).catch((error) => {
          console.error("[CrashReconcile] 崩溃对账失败（仅日志，不阻塞启动）:", error);
        });

        const ttsSessionService = new TtsSessionService((request, signal, emit) =>
          ttsSynthesisService.synthesizeSession(request, signal, emit),
        );

        // 应用图标 getter 已在工厂体开头注入（早于 shell 阶段的窗口壳/托盘创建）。

        // 内置工具配置 getter
        bootstrapConfigGetters({
          loadGeneralSettings,
        });

        // Locale Context（从 GeneralSettings 的语言配置同步）
        const generalSettings = loadGeneralSettings();
        updateLocaleContext({
          uiLocale: generalSettings.language,
          dateLocale: generalSettings.language,
          asrLanguage: generalSettings.asrLanguage,
        });

        // Git：服务对象预创建；仓库监听只在打开仓库后启动
        // 探测结果在进程内缓存：成功过一次就不再重复探测，避免启动高峰期
        // 偶发超时导致 Git 面板误报"未检测到可用 Git"；探测失败不缓存，下次自动重试
        let resolvedGit: ResolvedGitExecutable | null = null;
        const git = createGitService({
          getSession: chatsStore.getSessionRecord,
          resolveExecutable: async () => {
            resolvedGit ??= await resolveGitExecutable({
              systemCommand: "git",
              bundledPath: app.isPackaged
                ? path.join(process.resourcesPath, "mingit", "cmd", "git.exe")
                : path.join(app.getAppPath(), "resources", "mingit", "cmd", "git.exe"),
            });
            return resolvedGit;
          },
        });

        // LSP：管理器预创建；具体语言服务进程按需启动
        const lsp = new LspManager({
          getServerOverrides: () => loadGeneralSettings().lspServerOverrides,
        });

        // Gmail clients are lazy: service construction reads no mailbox data and starts no network request.
        const gmailAuth = new GmailAuthService();
        const mailAttachmentStore = new MailAttachmentStore();
        const gmail = new GmailService(gmailAuth, { resolveAttachment: (reference) => mailAttachmentStore.resolve(reference) });

        // 截图：原生 helper IPC、全局热键。预热在 background 阶段执行。
        const initialSettings = loadGeneralSettings();
        const screenshot = initializeScreenshotService({
          initialHotkey: initialSettings.screenshotHotkey ?? "Alt+Shift+S",
          getReactChatWindow: () => reactChatWindow,
          capturePetWindow: () => shell.windowManager.capturePetWindow(),
          ipc: shell.ipc,
        });

        // Cloud Music wiring（MusicService + IPC + Agent 工具）；
        // 后端由首次音乐动作惰性连接，退出清理由中心协调器负责。
        const music = bootstrapMusicService(resolveMusicPaths());

        // Verge 内建模块骨架：store → service → IPC 三段装配
        const verge = createVergeService(app.getPath("userData"));

        // v1.4.0 网络页：本机 mihomo 控制器聚合。轮询在 core 阶段起，退出时停。
        const network = createNetworkService({
          getConfigRoot: () => discoverConfigRoot({
            appData: process.env.APPDATA,
            localAppData: process.env.LOCALAPPDATA,
          }),
        });
        network.start();
        shutdown.register({
          id: "verge-network-service",
          phase: "stopLocalResources",
          dispose: async () => { network.stop(); },
        });

        // 宠物窗右键菜单（Task 11）：菜单动作写盘走 service，窗口动作就地取 win。
        // 到点自醒也在这里接：落盘后的 setTimeout(remaining).unref()，到点当场清、
        // 广播撤月牙；所有写盘路径（菜单 / toggle-quiet 的 IPC）都走下面同一个收口。
        // 这段必须先于首窗挂载就位（createPetWindow 在 core-bootstrap 的后段才调用）。
        const quietClock = attachQuietClock({
          service: verge,
          // 到点自醒只在「当场清盘之后」被调，所以这里读回来的一定是 null——
          // 广播的仍是清盘后的 quietUntil，native 语义不变（main.rs:2515-2517）。
          // 闭包晚绑定：notifyWake 由定时器触发，那时 applyQuietState 已就位。
          notifyWake: () => applyQuietState(verge.getState().quietUntil),
        });
        // quiet 状态变更的唯一收口：先按当下 quietUntil 重排自醒钟，再把当下值广播出去。
        // 菜单（pet-menu）与 VERGE_TOGGLE_QUIET 都必须走这一个函数，不许两处各写各的。
        const applyQuietState = (quietUntil: number | null): void => {
          quietClock.rearm();
          for (const win of BrowserWindow.getAllWindows()) {
            if (!win.isDestroyed()) win.webContents.send(
              IPC.VERGE_QUIET_CHANGED,
              quietChangedPayload(quietUntil),
            );
          }
        };
        // tuck 开关变更的唯一收口（applyQuietState 同构，Task 11 先例）：两条写盘路径
        // （菜单 / VERGE_SET_TUCK）落盘后都从这里广播当下值，渲染端据此开/关藏身闸门。
        const applyTuckState = (enabled: boolean): void => {
          for (const win of BrowserWindow.getAllWindows()) {
            if (!win.isDestroyed()) win.webContents.send(IPC.VERGE_TUCK_CHANGED, { tuckEnabled: enabled });
          }
        };
        // 启动即重排：盘上若躺着未来截止（含重启验收的 now+5000），进程一起来
        // 自醒钟就到位——不依赖下一次 toggle 才排上定时器。
        quietClock.rearm();
        // 形态/档位的唯一收口（与 applyQuietState 同构）：载荷必须是两个字符串——
        // profileFor(...) 带 catScale 方法，structured clone 会当场抛。
        const applyProfileState = (form: "cat" | "girl", tier: "small" | "standard" | "large"): void => {
          const payload = { form, tier };
          for (const win of BrowserWindow.getAllWindows()) {
            if (!win.isDestroyed()) win.webContents.send(IPC.VERGE_PROFILE_UPDATE, payload);
          }
        };
        attachVergePetMenu = (win) => {
          attachPetContextMenu({
            window: win,
            service: verge,
            quit: () => app.quit(),
            onQuietStateChange: applyQuietState,
            onTuckStateChange: (enabled) => onVergeTuckStateChange?.(enabled),
            onProfileStateChange: (form, tier) => applyProfileState(form, tier),
            onPetCommand: (command) => {
              if (!win.isDestroyed()) win.webContents.send(IPC.VERGE_PET_COMMAND, command);
            },
            openNetworkPanel: () => {
              void shell.windowManager.openReactChatWindow().then(() => {
                for (const target of BrowserWindow.getAllWindows()) {
                  if (!target.isDestroyed()) target.webContents.send(IPC.CYRENE_OPEN_NETWORK_PANEL);
                }
              });
            },
          });
        };
        onVergeQuietStateChange = applyQuietState;
        onVergeTuckStateChange = applyTuckState;
        shutdown.register({
          id: "verge-quiet-clock",
          phase: "stopLocalResources",
          dispose: async () => { quietClock.dispose(); },
        });

        return {
          runtimeState: runtimeStateService,
          llm: llmClient,
          cita: citaService,
          social: socialContextService,
          tts: ttsSynthesisService,
          ttsSession: ttsSessionService,
          proactive: proactiveLifecycle,
          git,
          lsp,
          gmailAuth,
          gmail,
          mailAttachmentStore,
          screenshot,
          music,
          verge,
          network,
        };
      },

      // SRT 沙箱初始化（检测安装状态，不弹 UAC）：必须在 registerAllTools 前，
      // 让 run_shell 的 workspace_mutation 分支能用上沙箱。失败不阻塞启动。
      initSandbox: () => initSandbox(),

      initPlanMode: () => {
        const plansRoot = path.join(app.getPath("userData"), "plans");
        // 计划模式路径根注入：write_plan / plan.md 读写基于 userData/plans/<会话键>/
        initPlanPaths(app.getPath("userData"));
        // 状态持久化（durable transition）：同步写盘，approvePlan 返回时 state.json 已落盘，
        // 崩溃恢复不丢"执行正在进行"的事实；null = 回 NORMAL，删除 state.json 清尸
        initPlanStatePersister((conversationId, snapshot) => {
          const stateFile = path.join(plansRoot, encodePlanSessionKey(conversationId), "state.json");
          if (!snapshot) {
            fs.rmSync(stateFile, { force: true });
            return;
          }
          fs.mkdirSync(path.dirname(stateFile), { recursive: true });
          fs.writeFileSync(stateFile, JSON.stringify(snapshot, null, 2), "utf8");
        });
        // 计划模式状态广播：所有状态切换都广播到所有窗口
        initPlanStateBroadcaster((conversationId, state) => {
          const payload = { conversationId, state };
          for (const win of BrowserWindow.getAllWindows()) {
            win.webContents.send(IPC.PLAN_STATE_CHANGED, payload);
          }
        });
        // 启动崩溃恢复：非 NORMAL 快照统一降级 PLAN_DISCUSSING，不自动恢复执行权
        recoverInterruptedPlanSessions(plansRoot);
      },

      // 工具注册：集中到一个显式入口（依赖沙箱/Git/LSP 就绪）
      registerAllTools: (services) => registerAllTools({ lspManager: services.lsp, gmailService: services.gmail }),

      initRag: async () => {
        const modelSettings = loadModelSettings();
        const knowledgeBase = initializeKnowledgeBase(app.getPath("userData"));
        setMemoryMode(modelSettings.memoryMode);
        initializeSummaryMemoryScheduler({
          userDataRoot: app.getPath("userData"),
          sessions: chatsStore,
          onError: (conversationId, error) => logger.warn(LogTag.RAG, "summary memory update failed:", conversationId, error),
        });
        enableSummaryMemoryScheduler(isSummaryMemoryEnabled());
        const wikiMigration = createConversationSessionMigration(app.getPath("userData"));
        initializeWikiMemoryScheduler({
          userDataRoot: app.getPath("userData"),
          sourceReader: createWikiChatSourceReader({
            transcriptStore: getConversationTranscriptStore(app.getPath("userData")),
            listSessions: chatsStore.listSessions,
            ensureConversationMigrated: (id) => wikiMigration.ensureConversationMigrated(id),
          }),
          onError: (conversationId, error) => logger.warn(LogTag.RAG, "wiki memory update failed:", conversationId, error),
        });
        await enableWikiMemoryScheduler(modelSettings.memoryMode === "wiki");
        await initWorldbook();
        if (isMemoryEnabled()) {
          await initVectorMemory("auto", undefined, undefined, modelSettings.embeddingModel, modelSettings.embeddingDimensions);
        } else {
          logger.info(LogTag.RAG, "vector memory disabled by settings");
        }
        // 注册 RAG 落盘：受控退出在 flushPersistence 阶段刷盘；
        // Windows 会话结束（断电/强制关机）走同步紧急落盘兜底
        shutdown.register({
          id: "rag-store",
          phase: "flushPersistence",
          dispose: async () => { await flushRAGStore(); },
        });
        shutdown.registerEmergencyFlush("rag-store", () => flushRAGStoreSync());
        shutdown.register({
          id: "summary-memory",
          phase: "flushPersistence",
          dispose: async () => { await flushAllSummaryMemory(); },
        });
        shutdown.register({
          id: "wiki-memory",
          phase: "flushPersistence",
          dispose: async () => { await enableWikiMemoryScheduler(false); },
        });
        shutdown.register({
          id: "knowledge-base",
          phase: "flushPersistence",
          dispose: async () => { await knowledgeBase.close(); },
        });
        logger.info(LogTag.RAG, "RAG initialized OK");
      },

      createRuntime: (services) => {
        const transcriptCompactor = getTranscriptCompactor();
        return createAgentRuntime({
          runtimeStateService: services.runtimeState,
          llmClient: services.llm,
          enqueueLLMTask,
          loadModelSettings,
          loadGeneralSettings,
          loadUserProfile,
          toolRegistry,
          skillRegistry,
          getStickerTextIndex: loadStickerTextIndex,
          broadcastRuntimeStateChanged: () => {
            broadcastToAuxWindows(IPC.RUNTIME_STATE_CHANGED, services.runtimeState.getState());
          },
          citaService: services.cita,
          socialContextScheduler: services.social.scheduler,
          chatsStore,
          buildSummaryMemoryContext: (conversationId) => loadSummaryMemoryContext({
            conversationId,
            userDataRoot: app.getPath("userData"),
            getSessionRecord: chatsStore.getSessionRecord,
          }),
          scheduleSummaryTurn: (input) => scheduleSummaryTurn(input),
          scheduleWikiTurn: (input) => scheduleWikiTurn(input),
          socialAtomStore: services.social.store,
          buildPluginPromptContext: (input) => pluginPromptRegistry.build(input),
          publishPluginHostEvent: (event, payload) => pluginManager
            ? pluginManager.publishHostEvent(event, payload)
            : Promise.resolve(),
          publishToolFinished: (event) => lifecyclePublisher.publishToolFinished(event),
          transcriptCompactor,
        });
      },

      createChannels: (runtime, services) => createChannelsSubsystem({
        agentRuntime: runtime,
        ttsSynthesisService: services.tts,
        getReactChatWindow: () => reactChatWindow,
        ipc: shell.ipc,
        publishLifecycle: lifecyclePublisher,
      }),

      startPlugins: async (services, scheduler, runtime) => {
        pluginManager = await startPluginRuntime({
          llmClient: services.llm,
          ipc: shell.ipc,
          schedulerStore: scheduler.store,
          agentRuntime: runtime,
          // 插件启停后让调度引擎重新归一化逾期任务并重排计时器（不补跑）。
          onPluginRunningStateChange: () => scheduler.engine.refreshPluginTasks(),
          // 插件面板仅由工作区设置页承载。
          getPanelHostWebContents: () => [reactChatWindow]
            .filter((window) => window && !window.isDestroyed())
            .map((window) => window!.webContents),
        });
        return pluginManager;
      },

      createScheduler: (runtime) => createSchedulerSubsystem({
        agentRuntime: runtime,
        getReactChatWindow: () => reactChatWindow,
        ipc: shell.ipc,
        publishLifecycle: lifecyclePublisher,
        // runReader 接入 harness 运行存储：孤儿工具按运行状态归类，避免误判 not_executed
        conversationJournal: new ConversationJournalService({
          store: getConversationTranscriptStore(app.getPath("userData")),
          runReader: getHarnessRunStore(app.getPath("userData")),
        }),
        getActiveConversation: () => activeConversationRegistry.getMostRecent(),
        // 插件任务只有在所属插件运行中才允许触发；用户任务不受影响。
        canRunTask: (task) => !task.ownerPluginId
          || (pluginManager?.isRunning(task.ownerPluginId) ?? false),
      }),

      registerCoreIpc: async ({ ipc, runtime, services }) => {
        const transcriptCompactor = getTranscriptCompactor();
        // 设置变更反应：窗口/托盘/截图热键/主动服务联动
        onGeneralSettingsChanged((before, after) =>
          handleGeneralSettingsChanged(before, after, {
            windowManager: shell.windowManager,
            tray: shell.tray,
            screenshotService: services.screenshot,
            proactiveLifecycle: services.proactive,
            broadcastToAuxWindows,
          }),
        );

        registerSettingsIpc({
          ipc,
          windowManager: shell.windowManager,
          getGeneralSettings: loadGeneralSettings,
          saveGeneralSettings,
          getModelSettings: loadModelSettings,
          saveModelSettings,
          runtimeStateService: services.runtimeState,
          proactiveLifecycle: services.proactive,
          reconcileUserMemoryIndex,
          switchMemoryMode,
          syncVolcanoSearchMcp,
          syncPlaywrightMcp,
          syncFilesystemMcp,
        });
        registerGmailIpc({ ipc, auth: services.gmailAuth, service: services.gmail, attachmentStore: services.mailAttachmentStore });

        // Verge 内建模块骨架：IPC 注册到 shell.ipc（IpcScope.dispose 时自动清除处理器）
        const removeVergeIpc = registerVergeIpc(ipc, services.verge);

        // v1.5.0 工作状态：六档单一权威 + 两条下行（只在宠物窗收 UPDATE）。
        const workStatusService = createWorkStatusService();
        const removeWorkStatusIpc = registerWorkStatusIpc(ipc, {
          service: workStatusService,
          sendToPetWindow: (channel, payload) => shell.windowManager.sendToPetWindow(channel, payload),
        });

        // v1.4.0 网络页：服务订阅 → 全窗广播；动作失败回原因码，页面据此给文案。
        const removeNetworkIpc = registerNetworkIpc(ipc, {
          service: services.network,
          broadcast: (channel, payload) => {
            for (const win of BrowserWindow.getAllWindows()) {
              if (!win.isDestroyed()) win.webContents.send(channel, payload);
            }
          },
        });

        // 漫游/投掷停稳后的一次性落盘：渲染端只在停稳时发，不逐帧写盘。
        ipc.on(IPC.VERGE_PET_POSITION_SETTLED, (_event, position: unknown) => {
          if (typeof position !== "object" || position === null) return;
          const { x, y } = position as Record<string, unknown>;
          if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) return;
          saveGeneralSettings({ petWindowX: Math.round(x), petWindowY: Math.round(y) });
        });
        shutdown.register({
          id: "verge-network-ipc",
          phase: "flushPersistence",
          dispose: async () => { removeNetworkIpc(); },
        });

        // 本机版本信息：设置页与 --brand-probe 共用。原来这里是 app-update:* 五条通道。
        const removeAppInfoIpc = registerAppInfoIpc(ipc, {
          getName: () => app.getName(),
          getVersion: () => app.getVersion(),
          dataDirName: () => path.basename(app.getPath("userData")),
        });

        // Task 11 的三条渲染入口与到点自醒重排：
        // - toggle-quiet 是 invoke（拿翻转后的 quietUntil 回执）；is-quiet 是取回执的读。
        // - 写盘后一律走 onVergeQuietStateChange 这一条收口（rearm + 广播当下值），
        //   与宠物窗菜单同一个函数：两处各写各的就会漏掉自醒钟或漏掉月牙。
        //   「手工把 quietUntil 改小再重启」那档验收由启动时的 attachQuietClock 覆盖。
        ipc.handle(IPC.VERGE_TOGGLE_QUIET, () => {
          const next = armQuiet({ current: services.verge.getState().quietUntil, now: Date.now() });
          services.verge.setQuietUntil(next);
          onVergeQuietStateChange?.(next);
          return next;
        });
        ipc.handle(IPC.VERGE_IS_QUIET, () => {
          const state = services.verge.getState();
          return isQuietNow(state.quietUntil, Date.now());
        });
        ipc.on(IPC.VERGE_SET_TUCK, (_event, enabled: unknown) => {
          if (typeof enabled !== "boolean") return;
          services.verge.setTuckEnabled(enabled);
          // 落盘 + 广播同一个收口（与菜单 onTuckStateChange 共用 applyTuckState）：
          // 渲染端要即时开/关藏身闸门——「取消勾选立刻回位」不允许等重启。
          onVergeTuckStateChange?.(enabled);
        });
        // Task 12：第一次藏身开口说过 TUCK_HINT 后由渲染端上报，落盘一次不再重说。
        // 只有这一条写路径——探针/菜单都不碰 tuckHinted。
        ipc.on(IPC.VERGE_TUCK_HINTED, () => {
          services.verge.markTuckHinted();
        });
        // 渲染端起帧拉一次几何基线（它不是位置权威，但算 peek 目标与夹取要先有窗在哪）。
        // 无窗返回 null——禁兜底：拿不到就是没窗，不许用常量拼一份假基线。
        ipc.handle(IPC.VERGE_GET_PET_GEOMETRY, () => {
          const bounds = shell.windowManager?.getPetWindowBounds() ?? null;
          if (!bounds) return null;
          const { workArea } = screen.getDisplayMatching(bounds);
          const state = services.verge.getState();
          return {
            bounds,
            workArea,
            tuckEnabled: state.tuckEnabled,
            tuckHinted: state.tuckHinted,
            // native main.rs:5648 的同一个开关：--tuck-probe 把藏身阈值缩到 2.5s，
            // 让屏幕验收在几秒内拍到藏身；阈值权威在主端，渲染端只消费。
            tuckLimit: process.argv.includes("--tuck-probe") ? TUCK_PROBE_IDLE_SECS : TUCK_IDLE_SECS,
          };
        });
        shutdown.register({
          id: "verge-module",
          phase: "flushPersistence",
          dispose: async () => { removeVergeIpc(); removeWorkStatusIpc(); workStatusService.dispose(); },
        });
        // 本机版本信息与 Verge 快照同属一条读通道，注销也挂在同一处。
        shutdown.register({
          id: "app-info-ipc",
          phase: "flushPersistence",
          dispose: async () => { removeAppInfoIpc(); },
        });

        registerMemoryUserToolIpc({
          ipc,
          windowManager: shell.windowManager,
        });
        registerWikiMemoryIpc(ipc);
        registerKnowledgeBaseIpc(ipc);

        // ── TTS IPC ──
        registerTtsIpc({ ipc, ttsSessionService: services.ttsSession });

        // 聊天会话存储 IPC（chats-store.initialize 建好 cyrene-chats 目录并加载 index）
        await registerChatsIpc(ipc, {
          llmClient: services.llm,
          isPrimaryModelBusy: hasActiveConversationRun,
          beforeWorkspaceBindingChange: prepareBackgroundSessionMutation,
          beforeSessionDelete: prepareBackgroundSessionMutation,
          transcriptCompactor,
        });
        await registerMomentsIpc(ipc);
        registerCodeGitIpc({ ipc, service: services.git });
        // 会话工作区只读文件（右侧面板文件树 / 预览）
        registerWorkspaceFilesIpc(ipc);
        // 工作区右上角"打开"菜单：本机应用探测 + 打开执行
        registerOpenInAppIpc(ipc);
        const examPaperStore = createExamPaperStore(app.getPath("userData"));
        const browserPanel = registerBrowserPanelIpc({
          ipc,
          getWindow: () => reactChatWindow,
          getExamRecord: (examId) => examPaperStore.get(examId),
          getViewportMode: () => loadGeneralSettings().browserViewportMode,
        });
        shutdown.register({
          id: "browser-panel-session",
          phase: "flushPersistence",
          dispose: async () => { await browserPanel.persistSessionForShutdown(); },
        });

        // AG-UI 事件流桥：渲染进程 invoke(AGUI_RUN) → CyreneAgent 跑 Agent 循环 → 事件透传
        registerAgUiIpc(
          (input) => runtime.buildOptions(input),
          (result, latestUserText, context) => runtime.onRunFinished(result, latestUserText, context),
          () => reactChatWindow,
          services.proactive.proactiveConversationLifecycle,
          ipc,
          pendingTurnLifecycle,
        );

        // 计划模式开关/查询 IPC
        ipc.handle(IPC.PLAN_SET_MODE, (_event, payload: { conversationId?: string; target?: "on" | "off"; workspaceRoot?: string }) => {
          const conversationId = payload?.conversationId;
          const target = payload?.target;
          if (!conversationId) return { ok: false, reason: "缺少 conversationId" };
          if (target !== "on" && target !== "off") return { ok: false, reason: "target 必须是 on/off" };
          const current = getPlanState(conversationId);
          if (target === "on") {
            if (current !== "NORMAL") return { ok: true, state: current }; // 已激活：no-op
            const t = enterPlanDiscussing(conversationId, payload.workspaceRoot);
            if (!t.ok) return { ok: false, reason: t.reason, state: current };
            return { ok: true, state: getPlanState(conversationId) };
          }
          // target === "off"
          if (current === "EXECUTING") {
            return { ok: false, reason: "计划执行中，不可手动退出", state: current };
          }
          if (current === "NORMAL") return { ok: true, state: current };
          exitPlanMode(conversationId);
          return { ok: true, state: getPlanState(conversationId) };
        });
        ipc.handle(IPC.PLAN_GET_STATE, (_event, payload: { conversationId?: string }) => {
          const conversationId = payload?.conversationId;
          if (!conversationId) return { state: "NORMAL" as const };
          return { state: getPlanState(conversationId) };
        });

        // 权限模块：磁盘加载 + 权限/选择卡片 IPC（必须在 createWindow 之后、任意工具调用之前）
        bootstrapPermission(ipc);
        // pop_quiz 抽查工具：IPC（提交/跳过）与工具注册（learn 模式可见）
        registerPopQuizIpc(ipc);
        registerPopQuizTool();
        // 正式试卷：答案与评分资料仅由主进程存储；Learn 工具负责出卷、取卷批改与保存结果。
        const examDraftStore = createExamDraftStore(app.getPath("userData"), examPaperStore);
        void examDraftStore.deleteExpired().catch((error) => {
          console.warn("[LearnExam] 清理过期出卷草稿失败:", error);
        });
        void examPaperStore.recoverInterruptedGrading().catch((error) => {
          console.warn("[LearnExam] 恢复中断批改状态失败:", error);
        });
        registerExamPaperIpc(examPaperStore, ipc);
        registerLearnExamPageIpc(examPaperStore, ipc);
        registerLearnExamTools(examPaperStore, examDraftStore);
        registerCallIpc(ipc);
      },

      loadGeneralSettings,
      applyGeneralSettings: (settings, services) => applyGeneralSettings(settings, {
        windowManager: shell.windowManager,
        tray: shell.tray,
        screenshotService: services.screenshot,
        proactiveLifecycle: services.proactive,
        broadcastToAuxWindows,
      }),
      wireToastCenter: ({ ipc, windowManager }) => {
        // 提醒中心组合根：窗口控制器 + 生命周期权威服务 + 事件总线订阅
        const toastWindowController = createToastWindowController({
          createWindow: createToastWindowShell,
          getChatWindow: () => reactChatWindow,
          getDisplayMatching: (bounds) => screen.getDisplayMatching(bounds),
          getCursorScreenPoint: () => screen.getCursorScreenPoint(),
        });
        const toastService = createToastService({
          bus: toastEvents,
          window: toastWindowController,
          activate: (request) => { activation.request(request); },
          openTasksWindow: () => { void windowManager.openScheduledTasks(); },
          // 音效总开关：设置页可关；每次弹窗时读取，改动即时生效
          isSoundEnabled: () => loadGeneralSettings().toastSoundEnabled,
          shouldSuppressNotify: (event) => {
            // 焦点抑制三条件：事件带会话 + 聊天窗口聚焦 + 激活会话一致。
            // 调度任务结果落在任务历史（无会话落点），恒不抑制。
            if (!event.sessionId) return false;
            const chat = reactChatWindow;
            if (!chat || chat.isDestroyed() || !chat.isFocused()) return false;
            return getActiveChatSessionId() === event.sessionId;
          },
        });
        toastService.registerIpc(ipc);
        // 预创建隐藏窗口，提前加载渲染页，首次弹出零延迟
        toastWindowController.preload();
        shutdown.register({
          id: "toast-center",
          phase: "stopLocalResources",
          dispose: async () => {
            toastService.dispose();
            toastWindowController.dispose();
          },
        });
      },
      revealStartupWindows,
    }),

    startBackground: (core) => startBackground({
      core,
      readiness,
      shutdown,
      channels: core.channels,
      scheduler: core.scheduler,
      pruneRemovedMcp: async () => {
        // 一次性清理已下架的内置 MCP（Firecrawl hosted 等）
        const removed = await pruneMcpServersByIds([...REMOVED_BUILTIN_MCP_IDS]);
        if (removed.length > 0) {
          console.log(CONSOLE_PREFIX + " 已清理遗留的已下架内置 MCP:", removed.join(", "));
        }
      },
      syncBuiltInMcp: async () => {
        // 内置 MCP 自动连接：Playwright / Filesystem（均默认关闭，选项控制）
        await syncPlaywrightMcp(loadGeneralSettings());
        await syncFilesystemMcp({
          filesystemMcpEnabled: loadGeneralSettings().filesystemMcpEnabled,
          allowedDir: app.getPath("downloads"),
        });
      },
      restoreMcp: (signal) => initMcpManager({ signal }),
      reconcileMemory: async (signal) => {
        if (signal.aborted || !isMemoryEnabled()) return;
        try {
          await reconcileUserMemoryIndex();
        } catch (err) {
          console.warn("[Memory/RAG] startup reconciliation failed:", err);
          throw err;
        }
      },
      initializeReranker: async () => {
        if (!isMemoryEnabled()) return;
        // initReranker 内部检测模型是否安装，未安装自动降级为 none
        try {
          const modelSettings = loadModelSettings();
          await initReranker(modelSettings.rerankerMode);
          logger.info(LogTag.Reranker, "initialized with mode:", modelSettings.rerankerMode);
        } catch (err) {
          logger.warn(LogTag.Reranker, "startup init failed:", err);
        }
      },
      prewarmScreenshot: async () => {
        await core.services.screenshot.prewarm();
      },
      startProactiveTrigger: async () => {
        core.services.proactive.initializeProactiveTrigger();
        return { dispose: () => core.services.proactive.stopProactiveTrigger() };
      },
      startMomentsReactionScanner: async () => {
        // 启动即补扫一轮：重启前已逾期的反应任务尽快续上，不等第一个扫描周期
        momentsService.startReactionScanner();
        return { dispose: () => momentsService.stopReactionScanner() };
      },
    }),

    logFatal: (error) => {
      console.error(CONSOLE_PREFIX + " fatal startup error:", error);
      logger.error(LogTag.Runtime, "fatal startup error:", error);
    },
  };
}
