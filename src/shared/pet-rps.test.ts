import { describe, expect, it } from "vitest";
import { RPS_SIGNS, judgeRps, rpsCommandFor, rpsFromCommand, type RpsSign } from "./pet-rps";

describe("猜拳词表与判定", () => {
  it("石头赢剪刀、剪刀赢布、布赢石头，同手为平（九种组合全覆盖）", () => {
    const wins: Record<RpsSign, RpsSign> = { rock: "scissors", scissors: "paper", paper: "rock" };
    for (const player of RPS_SIGNS) {
      for (const her of RPS_SIGNS) {
        const expected = player === her ? "draw" : wins[player] === her ? "win" : "lose";
        expect(judgeRps(player, her), `${player} vs ${her}`).toBe(expected);
      }
    }
  });

  it("命令往返：三条命令都认，前缀像但手型不对的一律 null", () => {
    for (const sign of RPS_SIGNS) {
      const command = rpsCommandFor(sign);
      expect(command).toBe(`rps:${sign}`);
      expect(rpsFromCommand(command)).toBe(sign);
    }
    for (const bad of ["rps:", "rps:lizard", "rock", "accessory:rock", "rps:ROCK", ""]) {
      expect(rpsFromCommand(bad), bad).toBeNull();
    }
  });
});
