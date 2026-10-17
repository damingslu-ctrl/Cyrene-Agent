import { createVergeService } from "./verge-service";

export interface VergeBootstrap {
  service: ReturnType<typeof createVergeService>;
  dispose(): void;
}

/**
 * 装配 verge 内建模块。
 *
 * 这里不连 mihomo、不起采样循环：P0 只要骨架挂上装配点并且不拖慢启动。
 * 数据面的连接在 P2 的 `watchers` 里按 background 阶段起。
 */
export function bootstrapVergeService(input: {
  userDataDir: string;
}): VergeBootstrap {
  const service = createVergeService(input.userDataDir);
  return { service, dispose: () => {} };
}
