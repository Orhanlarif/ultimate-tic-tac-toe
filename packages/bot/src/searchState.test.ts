import { describe, expect, it } from "vitest";
import {
  applyMove,
  createGame,
  getLegalMoves,
  type Move,
} from "@uttt/game-engine";
import { createRng } from "./index";
import {
  computeHash,
  FULL_MASK,
  hashesMatch,
  IS_WIN,
  lineThreatCount,
  SearchState,
  threatsFromBits,
} from "./searchState";

describe("SearchState make/unmake", () => {
  it("restores hash and fields after unmake", () => {
    const game = createGame();
    const state = new SearchState(game);
    const before = {
      hash: { ...state.hash },
      side: state.side,
      active: state.active,
      empty: state.emptyCount,
      cells: state.cells.slice(),
      winners: state.winners.slice(),
    };

    const move: Move = { board: 4, cell: 4 };
    expect(state.make(move)).toBe(true);
    expect(hashesMatch(state.hash, before.hash)).toBe(false);
    state.unmake();

    expect(hashesMatch(state.hash, before.hash)).toBe(true);
    expect(state.side).toBe(before.side);
    expect(state.active).toBe(before.active);
    expect(state.emptyCount).toBe(before.empty);
    expect([...state.cells]).toEqual([...before.cells]);
    expect([...state.winners]).toEqual([...before.winners]);
    expect(hashesMatch(computeHash(state), state.hash)).toBe(true);
  });

  it("counts distinct-square forks only", () => {
    const fork = lineThreatCount([1, 1, 0, 1, 1, 0, 0, 0, 0], 1, 0);
    expect(fork.twos).toBeGreaterThanOrEqual(2);
    expect(fork.forks).toBeGreaterThanOrEqual(2);

    const sameSquare = lineThreatCount([0, 1, 1, 1, 2, 0, 1, 0, 0], 1, 0);
    expect(sameSquare.twos).toBe(2);
    expect(sameSquare.forks).toBe(0);
  });

  it("matches engine legal moves through a short game", () => {
    let game = createGame();
    const state = new SearchState(game);
    for (let i = 0; i < 20; i++) {
      if (game.status !== "in_progress") break;
      const engineMoves = getLegalMoves(game);
      const searchMoves: Move[] = [];
      state.collectMoves(searchMoves);
      expect(searchMoves).toHaveLength(engineMoves.length);
      for (const m of engineMoves) {
        expect(searchMoves).toContainEqual(m);
      }
      const move = engineMoves[i % engineMoves.length]!;
      const next = applyMove(game, move);
      expect(next.ok).toBe(true);
      if (!next.ok) break;
      expect(state.make(move)).toBe(true);
      game = next.state;
      expect(state.currentPlayer()).toBe(game.currentPlayer);
      expect(state.status === 0).toBe(game.status === "in_progress");
    }
  });

  it("keeps incremental hash equal to full recompute over random playouts", () => {
    const rng = createRng(12345);
    for (let gameIdx = 0; gameIdx < 40; gameIdx++) {
      let game = createGame();
      const state = new SearchState(game);
      const stack: Move[] = [];
      for (let ply = 0; ply < 60; ply++) {
        if (game.status !== "in_progress") break;
        expect(hashesMatch(computeHash(state), state.hash)).toBe(true);
        const legal = getLegalMoves(game);
        const move = legal[Math.floor(rng() * legal.length)]!;
        const next = applyMove(game, move);
        expect(next.ok).toBe(true);
        if (!next.ok) break;
        expect(state.make(move)).toBe(true);
        game = next.state;
        stack.push(move);
        expect(hashesMatch(computeHash(state), state.hash)).toBe(true);
      }
      while (stack.length) {
        stack.pop();
        state.unmake();
        expect(hashesMatch(computeHash(state), state.hash)).toBe(true);
      }
    }
  });

  it("keeps bitboards in sync with cells and winners over random playouts", () => {
    const rng = createRng(999);
    for (let gameIdx = 0; gameIdx < 20; gameIdx++) {
      let game = createGame();
      const state = new SearchState(game);
      const stack: Move[] = [];

      const check = () => {
        for (let b = 0; b < 9; b++) {
          let x = 0;
          let o = 0;
          for (let c = 0; c < 9; c++) {
            const v = state.cells[b * 9 + c]!;
            if (v === 1) x |= 1 << c;
            else if (v === 2) o |= 1 << c;
          }
          expect(state.bits[0][b]).toBe(x);
          expect(state.bits[1][b]).toBe(o);
          const w = state.winners[b]!;
          expect((state.metaBits[0] >> b) & 1).toBe(w === 1 ? 1 : 0);
          expect((state.metaBits[1] >> b) & 1).toBe(w === 2 ? 1 : 0);
          expect((state.metaBits[2] >> b) & 1).toBe(w === 3 ? 1 : 0);
        }
      };

      for (let ply = 0; ply < 50; ply++) {
        if (game.status !== "in_progress") break;
        check();
        const legal = getLegalMoves(game);
        const move = legal[Math.floor(rng() * legal.length)]!;
        const next = applyMove(game, move);
        if (!next.ok) break;
        expect(state.make(move)).toBe(true);
        game = next.state;
        stack.push(move);
      }
      check();
      while (stack.length) {
        stack.pop();
        state.unmake();
        check();
      }
    }
  });
});

describe("bitboard threat tables", () => {
  it("agrees with the array-based reference implementation", () => {
    const rng = createRng(4242);
    for (let trial = 0; trial < 400; trial++) {
      let x = 0;
      let o = 0;
      const vals: number[] = [];
      for (let c = 0; c < 9; c++) {
        const r = rng();
        const v = r < 0.35 ? 1 : r < 0.7 ? 2 : 0;
        vals.push(v);
        if (v === 1) x |= 1 << c;
        else if (v === 2) o |= 1 << c;
      }
      const expected = lineThreatCount(vals, 1, 0);
      const actual = threatsFromBits(x, o, { twos: 0, ones: 0, forks: 0 });
      expect(actual.twos).toBe(expected.twos);
      expect(actual.ones).toBe(expected.ones);
      expect(actual.forks).toBe(expected.forks);
    }
  });

  it("detects wins and full boards", () => {
    expect(IS_WIN[0b000000111]).toBe(1);
    expect(IS_WIN[0b100010001]).toBe(1);
    expect(IS_WIN[0b000000011]).toBe(0);
    expect(FULL_MASK).toBe(0b111111111);
  });
});
