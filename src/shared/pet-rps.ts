/** 猜拳的三个手型与判定。菜单、引擎、绘制层共用这一份词表。 */
export const RPS_SIGNS = ["rock", "scissors", "paper"] as const;

export type RpsSign = (typeof RPS_SIGNS)[number];
/** 从玩家视角看这一局。 */
export type RpsOutcome = "win" | "lose" | "draw";

export type RpsCommand = `rps:${RpsSign}`;

export const RPS_LABELS: Record<RpsSign, string> = {
  rock: "石头",
  scissors: "剪刀",
  paper: "布",
};

export function isRpsSign(value: unknown): value is RpsSign {
  return typeof value === "string" && (RPS_SIGNS as readonly string[]).includes(value);
}

/** 石头赢剪刀、剪刀赢布、布赢石头；相同为平。 */
export function judgeRps(player: RpsSign, her: RpsSign): RpsOutcome {
  if (player === her) return "draw";
  const playerWins = (player === "rock" && her === "scissors")
    || (player === "scissors" && her === "paper")
    || (player === "paper" && her === "rock");
  return playerWins ? "win" : "lose";
}

export function rpsCommandFor(sign: RpsSign): RpsCommand {
  return `rps:${sign}`;
}

export function rpsFromCommand(command: string): RpsSign | null {
  if (!command.startsWith("rps:")) return null;
  const sign = command.slice("rps:".length);
  return isRpsSign(sign) ? sign : null;
}
