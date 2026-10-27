/**
 * 小把戏命令词表：菜单与渲染端对同一组 id。
 * 真正的学习次数/文案在 `renderer/pet/girl-trick.ts`；两边 id 由单测锁住。
 */
export const TRICK_IDS = ["high-five", "spin", "nod", "shy"] as const;

export type TrickId = (typeof TRICK_IDS)[number];
export type TrickCommand = `trick:${TrickId}`;

export const TRICK_COMMANDS: ReadonlyArray<TrickCommand> =
  TRICK_IDS.map((id) => `trick:${id}` as const);

export function trickCommandFor(id: TrickId): TrickCommand {
  return `trick:${id}`;
}

/** `trick:spin` → `"spin"`；不是小把戏命令返回 null。 */
export function trickFromCommand(command: string): TrickId | null {
  if (!command.startsWith("trick:")) return null;
  const id = command.slice("trick:".length);
  return (TRICK_IDS as readonly string[]).includes(id) ? (id as TrickId) : null;
}
