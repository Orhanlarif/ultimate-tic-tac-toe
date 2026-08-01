import type { Player } from "@uttt/game-engine";
import { EndgameTable } from "./endgameTable.js";
import { TranspositionTable } from "./tt.js";
import { playerToSide, type Side } from "./types.js";

/**
 * Owns a persistent transposition table for one bot game session.
 * Safe for Worker module scope; not a package-level singleton for SSR/tests.
 */
export class BotSearchSession {
  tt: TranspositionTable;
  private sizePower: number;
  private endgame: EndgameTable | null = null;
  gameId: string | null = null;
  botSide: Side | null = null;

  constructor(ttSizePower = 18) {
    this.sizePower = ttSizePower;
    this.tt = new TranspositionTable(ttSizePower);
  }

  /**
   * Proven endgame results stay valid for the whole game, so this table is
   * created lazily and never cleared mid-game.
   */
  endgameTable(): EndgameTable {
    this.endgame ??= new EndgameTable(17);
    return this.endgame;
  }

  /**
   * Prepare for a root search. Clears TT when the game or bot seat changes.
   */
  beginSearch(gameId: string, botPlayer: Player, ttSizePower?: number): void {
    const side = playerToSide(botPlayer);
    if (ttSizePower !== undefined && ttSizePower !== this.sizePower) {
      this.sizePower = ttSizePower;
      this.tt = new TranspositionTable(ttSizePower);
      this.gameId = gameId;
      this.botSide = side;
      this.tt.beginSearch();
      return;
    }
    if (this.gameId !== gameId || this.botSide !== side) {
      this.tt.clear();
      this.endgame?.clear();
      this.gameId = gameId;
      this.botSide = side;
    }
    this.tt.beginSearch();
  }

  reset(): void {
    this.tt.clear();
    this.endgame?.clear();
    this.gameId = null;
    this.botSide = null;
  }
}
