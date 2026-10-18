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
    /** 与 preload/index.ts 的 vergeApi 逐字对齐；Task 11 补免打扰三入口与自醒下行。 */
    verge: {
      getSnapshot(): Promise<unknown>;
      resizePetWindow(bounds: { x: number; y: number; width: number; height: number }): void;
      /** 翻转免打扰：开着→取消（回 null）；关着→现在+半小时。 */
      quietFor(): Promise<number | null>;
      isQuiet(): Promise<boolean>;
      setTuck(enabled: boolean): void;
      /** main → 渲染端：到点自醒当场清盘时发，payload 为清盘后的 quietUntil。 */
      onQuietChanged(callback: (payload: { quietUntil: number | null }) => void): () => void;
    };
  }
}
