import {
  CLOCK_INCREMENT_MS,
  CLOCK_INITIAL_MS,
  type ClockState,
} from "@uttt/contracts";
import type { Player } from "@uttt/game-engine";

/** Create a clock. When paused, time does not elapse until startClock. */
export function createClock(paused = false): ClockState {
  return {
    xMs: CLOCK_INITIAL_MS,
    oMs: CLOCK_INITIAL_MS,
    turnStartedAt: paused ? null : Date.now(),
    incrementMs: CLOCK_INCREMENT_MS,
    activePlayer: "X",
  };
}

export function startClock(clock: ClockState, now = Date.now()): ClockState {
  return {
    ...clock,
    activePlayer: clock.activePlayer ?? "X",
    turnStartedAt: now,
  };
}

/** Apply elapsed time against the active player; returns timeout player if any. */
export function tickClock(
  clock: ClockState,
  now = Date.now(),
): { clock: ClockState; timedOut: Player | null } {
  if (!clock.activePlayer || clock.turnStartedAt === null) {
    return { clock, timedOut: null };
  }

  const elapsed = Math.max(0, now - clock.turnStartedAt);
  const next = { ...clock };

  if (clock.activePlayer === "X") {
    next.xMs = Math.max(0, clock.xMs - elapsed);
    if (next.xMs <= 0) return { clock: next, timedOut: "X" };
  } else {
    next.oMs = Math.max(0, clock.oMs - elapsed);
    if (next.oMs <= 0) return { clock: next, timedOut: "O" };
  }

  next.turnStartedAt = now;
  return { clock: next, timedOut: null };
}

export function afterMove(clock: ClockState, nextPlayer: Player | null): ClockState {
  const { clock: ticked } = tickClock(clock);
  const next = { ...ticked };

  if (clock.activePlayer === "X") {
    next.xMs += clock.incrementMs;
  } else if (clock.activePlayer === "O") {
    next.oMs += clock.incrementMs;
  }

  next.activePlayer = nextPlayer;
  next.turnStartedAt = nextPlayer ? Date.now() : null;
  return next;
}

export function freezeClock(clock: ClockState): ClockState {
  const { clock: ticked } = tickClock(clock);
  return {
    ...ticked,
    activePlayer: null,
    turnStartedAt: null,
  };
}
