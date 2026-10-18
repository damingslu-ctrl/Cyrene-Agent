export {};

declare global {
  interface Window {
    cyrene: {
      minimize: () => void;
      hide: () => void;
      quit: () => void;
      setInteractive: (interactive: boolean) => Promise<void>;
      moveBy: (dx: number, dy: number) => void;
      moveTo: (x: number, y: number) => void;
      setDragging: (isDragging: boolean) => void;
      captureFrame: () => Promise<string | null>;
      getCursorPosition: () => Promise<{ x: number; y: number } | null>;
      onPetZoom: (callback: (zoom: number) => void) => () => void;
      onPetVisibilityChanged: (callback: (visible: boolean) => void) => () => void;
    };
    /** 与 preload/index.ts 的 vergeApi 逐字对齐；Task 11 补免打扰三入口，Task 12 补贴边藏身与几何下行。 */
    verge: {
      getSnapshot(): Promise<unknown>;
      /** bounds 四数取整（位置/尺寸门的依据）；后四列是模型取证量，只喂 GEOM 探针，不参与闸门。 */
      resizePetWindow(
        bounds: {
          x: number;
          y: number;
          width: number;
          height: number;
          pinInWin?: { x: number; y: number };
          center?: { x: number; y: number };
          peekDx?: number;
          e?: number;
        },
      ): void;
      /** 翻转免打扰：开着→取消（回 null）；关着→现在+半小时。 */
      quietFor(): Promise<number | null>;
      isQuiet(): Promise<boolean>;
      setTuck(enabled: boolean): void;
      /** main → 渲染端：quiet 状态变更时发，payload 是**当下** quietUntil（写盘=未来截止，到点清盘=null）。 */
      onQuietChanged(callback: (payload: { quietUntil: number | null }) => void): () => void;
      /** 渲染端起帧拉一次几何基线；窗不存在时 main 返回 null，禁兜底。 */
      getPetGeometry(): Promise<{
        bounds: { x: number; y: number; width: number; height: number };
        workArea: { x: number; y: number; width: number; height: number };
        tuckEnabled: boolean;
        tuckHinted: boolean;
        tuckLimit: number;
      } | null>;
      /** main → 渲染端：display-metrics-changed 重夹取后推新 bounds + workArea。 */
      onPetGeometryChanged(
        callback: (payload: {
          bounds: { x: number; y: number; width: number; height: number };
          workArea: { x: number; y: number; width: number; height: number };
        }) => void,
      ): () => void;
      /** main → 渲染端：tuck 开关变更（菜单与 IPC 双路经收口闸口后统一广播）。 */
      onTuckChanged(callback: (payload: { tuckEnabled: boolean }) => void): () => void;
      /** 渲染端 → main：第一次藏身开口说过 TUCK_HINT，落盘 tuckHinted，不再重说。 */
      tuckHinted(): void;
    };
  }
}
