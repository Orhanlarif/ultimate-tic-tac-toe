"use client";

import type { Difficulty } from "@uttt/bot";
import { getHostTimeoutMs, pickEmergencyMove } from "@uttt/bot";
import {
  applyMove,
  createGame,
  serializeState,
  type GameState,
  type Move,
  type Player,
} from "@uttt/game-engine";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  BotWorkerRequest,
  BotWorkerResponse,
} from "@/workers/bot.worker";

export type BotPhase = "setup" | "playing" | "bot_thinking" | "ended";

/** "random" is resolved to a concrete seat every time a game starts. */
export type SeatChoice = "random" | Player;

const MIN_THINK_MS: Record<Difficulty, number> = {
  easy: 280,
  medium: 420,
  hard: 500,
};

function nextSeed() {
  return Math.floor(Math.random() * 1_000_000_000);
}

function resolveSeat(choice: SeatChoice): Player {
  if (choice !== "random") return choice;
  return Math.random() < 0.5 ? "X" : "O";
}

export function useBotGame() {
  const [phase, setPhase] = useState<BotPhase>("setup");
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [seatChoice, setSeatChoice] = useState<SeatChoice>("random");
  const [youAre, setYouAre] = useState<Player>("X");
  const [state, setState] = useState<GameState>(() => createGame());
  const [seed, setSeed] = useState(nextSeed);
  const [endedReason, setEndedReason] = useState<"normal" | "resign" | null>(
    null,
  );

  const workerRef = useRef<Worker | null>(null);
  const reqIdRef = useRef(0);
  const generationRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const invalidateBotWork = useCallback(() => {
    const generation = generationRef.current;
    generationRef.current += 1;
    reqIdRef.current += 1;
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (workerRef.current) {
      try {
        workerRef.current.postMessage({ type: "cancel", generation });
      } catch {
        // Worker may already be terminated.
      }
      workerRef.current.terminate();
      workerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      invalidateBotWork();
    };
  }, [invalidateBotWork]);

  const ensureWorker = useCallback(() => {
    if (typeof window === "undefined") return null;
    if (!workerRef.current) {
      workerRef.current = new Worker(
        new URL("../workers/bot.worker.ts", import.meta.url),
      );
    }
    return workerRef.current;
  }, []);

  const lastMove = useMemo(() => {
    if (!state.moves.length) return null;
    return state.moves[state.moves.length - 1]!;
  }, [state.moves]);

  const applyHumanMove = useCallback(
    (board: number, cell: number) => {
      if (phase !== "playing") return;
      if (state.currentPlayer !== youAre) return;
      const result = applyMove(state, {
        board: board as Move["board"],
        cell: cell as Move["cell"],
      });
      if (!result.ok) return;
      setState(result.state);
      if (result.state.status !== "in_progress") {
        setEndedReason("normal");
        setPhase("ended");
      } else {
        setPhase("bot_thinking");
      }
    },
    [phase, state, youAre],
  );

  const runBotTurn = useCallback(
    async (
      game: GameState,
      diff: Difficulty,
      turnSeed: number,
      gameId: string,
      humanSeat: Player,
    ) => {
      if (game.status !== "in_progress") return;
      const generation = generationRef.current;
      const startedAt = performance.now();
      const botPlayer: Player = humanSeat === "X" ? "O" : "X";

      const finish = async (move: Move) => {
        if (generation !== generationRef.current) return;
        const elapsed = performance.now() - startedAt;
        const wait = Math.max(0, MIN_THINK_MS[diff] - elapsed);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        if (generation !== generationRef.current) return;

        const result = applyMove(game, move);
        if (!result.ok) {
          setPhase("playing");
          return;
        }
        setState(result.state);
        if (result.state.status !== "in_progress") {
          setEndedReason("normal");
          setPhase("ended");
        } else {
          setPhase("playing");
        }
      };

      // Never run a second search on the UI thread. Emergency move is O(legal).
      const emergency = () => pickEmergencyMove(game, turnSeed);

      const worker = ensureWorker();
      if (!worker) {
        await new Promise((r) => setTimeout(r, MIN_THINK_MS[diff]));
        if (generation !== generationRef.current) return;
        await finish(emergency());
        return;
      }

      const id = ++reqIdRef.current;
      const req: BotWorkerRequest = {
        id,
        generation,
        stateJson: serializeState(game),
        difficulty: diff,
        seed: turnSeed,
        gameId,
        botPlayer,
      };

      await new Promise<void>((resolve) => {
        let settled = false;
        const done = (fn: () => void) => {
          if (settled) return;
          settled = true;
          if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
          }
          if (generation === generationRef.current) fn();
          resolve();
        };
        const onMessage = (event: MessageEvent<BotWorkerResponse>) => {
          if (event.data.id !== id) return;
          worker.removeEventListener("message", onMessage);
          done(() => {
            if (event.data.move) void finish(event.data.move);
            else void finish(emergency());
          });
        };
        worker.addEventListener("message", onMessage);
        worker.postMessage(req);
        timeoutRef.current = setTimeout(() => {
          worker.removeEventListener("message", onMessage);
          try {
            worker.postMessage({ type: "cancel", generation });
          } catch {
            // ignore
          }
          worker.terminate();
          if (workerRef.current === worker) workerRef.current = null;
          done(() => {
            try {
              void finish(emergency());
            } catch {
              setPhase("playing");
            }
          });
        }, getHostTimeoutMs(diff));
      });
    },
    [ensureWorker],
  );

  useEffect(() => {
    if (phase !== "bot_thinking") return;
    const game = stateRef.current;
    if (game.currentPlayer === youAre) {
      setPhase("playing");
      return;
    }
    const turnSeed = seed + game.moveCount * 997;
    void runBotTurn(game, difficulty, turnSeed, `bot-${seed}`, youAre);
  }, [phase, difficulty, youAre, seed, runBotTurn, state.moveCount]);

  const start = useCallback(
    (opts?: { difficulty?: Difficulty; seatChoice?: SeatChoice }) => {
      invalidateBotWork();
      const d = opts?.difficulty ?? difficulty;
      const choice = opts?.seatChoice ?? seatChoice;
      const seat = resolveSeat(choice);
      const fresh = createGame();
      const s = nextSeed();
      setDifficulty(d);
      setSeatChoice(choice);
      setYouAre(seat);
      setSeed(s);
      setState(fresh);
      setEndedReason(null);
      if (seat === "O") {
        setPhase("bot_thinking");
      } else {
        setPhase("playing");
      }
    },
    [difficulty, invalidateBotWork, seatChoice],
  );

  const resign = useCallback(() => {
    if (phase !== "playing" && phase !== "bot_thinking") return;
    invalidateBotWork();
    setEndedReason("resign");
    setState((prev) => ({
      ...prev,
      status: "won",
      winner: youAre === "X" ? "O" : "X",
    }));
    setPhase("ended");
  }, [invalidateBotWork, phase, youAre]);

  // No seat override, so a "random" pick is re-rolled for every rematch.
  const rematch = useCallback(() => {
    start();
  }, [start]);

  const backToSetup = useCallback(() => {
    invalidateBotWork();
    setPhase("setup");
    setEndedReason(null);
    setState(createGame());
  }, [invalidateBotWork]);

  return {
    phase,
    difficulty,
    setDifficulty,
    seatChoice,
    setSeatChoice,
    youAre,
    state,
    lastMove,
    endedReason,
    start,
    rematch,
    resign,
    backToSetup,
    onMove: applyHumanMove,
  };
}
