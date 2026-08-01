/// <reference lib="webworker" />
import {
  BotSearchSession,
  chooseMoveDetailed,
  getProfile,
  type Difficulty,
} from "@uttt/bot";
import { deserializeState, type Move, type Player } from "@uttt/game-engine";

export interface BotWorkerRequest {
  id: number;
  stateJson: string;
  difficulty: Difficulty;
  seed: number;
  /** Stable game id so the Worker can retain TT across turns. */
  gameId: string;
  /** Seat the bot is playing; used to reset TT on side changes. */
  botPlayer: Player;
  /** Generation token; stale generations should be ignored by host. */
  generation?: number;
}

export interface BotWorkerResponse {
  id: number;
  generation?: number;
  move?: Move;
  error?: string;
  info?: {
    depth: number;
    nodes: number;
    timeMs: number;
    ttHits: number;
    aborted: boolean;
    score: number;
    reSearches?: number;
    lmrReductions?: number;
    qNodes?: number;
    solver?: {
      attempted: boolean;
      solved: boolean;
      outcome?: -1 | 0 | 1;
      distance?: number;
      nodes: number;
      reason?: string;
    };
  };
}

let cancelledGeneration = -1;
const session = new BotSearchSession(18);

self.onmessage = (
  event: MessageEvent<
    | BotWorkerRequest
    | { type: "cancel"; generation: number }
    | { type: "reset" }
  >,
) => {
  const data = event.data;
  if ("type" in data && data.type === "cancel") {
    cancelledGeneration = data.generation;
    return;
  }
  if ("type" in data && data.type === "reset") {
    session.reset();
    return;
  }

  const req = data as BotWorkerRequest;
  try {
    const state = deserializeState(req.stateJson);
    const generation = req.generation ?? req.id;
    const profile = getProfile(req.difficulty);
    const result = chooseMoveDetailed(state, {
      difficulty: req.difficulty,
      seed: req.seed,
      maxDepth: profile.maxDepth,
      nodeBudget: profile.nodeBudget,
      timeMs: profile.timeMs,
      shouldAbort: () => cancelledGeneration >= generation,
      session,
      gameId: req.gameId,
      botPlayer: req.botPlayer,
    });

    if (cancelledGeneration >= generation) {
      const res: BotWorkerResponse = {
        id: req.id,
        generation,
        error: "cancelled",
      };
      self.postMessage(res);
      return;
    }
    const res: BotWorkerResponse = {
      id: req.id,
      generation,
      move: result.move,
      info: result.info,
    };
    self.postMessage(res);
  } catch (e) {
    const res: BotWorkerResponse = {
      id: req.id,
      generation: req.generation ?? req.id,
      error: e instanceof Error ? e.message : "Bot error",
    };
    self.postMessage(res);
  }
};
