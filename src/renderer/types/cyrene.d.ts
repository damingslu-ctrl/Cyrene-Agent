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
    /** 与 preload/index.ts:1066-1069 逐字对齐；resizePetWindow 走 ipcRenderer.send，返回 void（落位不可 await）。 */
    verge: {
      getSnapshot(): Promise<unknown>;
      resizePetWindow(bounds: { x: number; y: number; width: number; height: number }): void;
    };
  }
}
