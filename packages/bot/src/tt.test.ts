import { describe, expect, it } from "vitest";
import { MATE } from "./constants";
import { TT_EXACT, TT_LOWER, TT_UPPER, TranspositionTable } from "./tt";

describe("TranspositionTable", () => {
  it("rejects different hi keys that share the same lo index", () => {
    const tt = new TranspositionTable(4);
    tt.beginSearch();
    tt.store({ lo: 1, hi: 10 }, 3, 12, TT_EXACT, { board: 0, cell: 0 }, 0);
    expect(tt.probe({ lo: 1, hi: 11 }, 0)).toBeNull();
    const hit = tt.probe({ lo: 1, hi: 10 }, 0);
    expect(hit?.score).toBe(12);
    expect(hit?.move).toEqual({ board: 0, cell: 0 });
  });

  it("prefers deeper entries of the same generation", () => {
    const tt = new TranspositionTable(4);
    tt.beginSearch();
    tt.store({ lo: 2, hi: 2 }, 5, 10, TT_EXACT, null, 0);
    tt.store({ lo: 2, hi: 2 }, 2, 99, TT_EXACT, null, 0);
    expect(tt.probe({ lo: 2, hi: 2 }, 0)?.depth).toBe(5);
    expect(tt.probe({ lo: 2, hi: 2 }, 0)?.score).toBe(10);
  });

  it("normalizes mate scores across plies", () => {
    const tt = new TranspositionTable(4);
    tt.beginSearch();
    tt.store({ lo: 3, hi: 3 }, 4, MATE - 3, TT_EXACT, { board: 1, cell: 1 }, 3);
    const atPly1 = tt.probe({ lo: 3, hi: 3 }, 1);
    expect(atPly1?.score).toBe(MATE - 1);
    const atPly5 = tt.probe({ lo: 3, hi: 3 }, 5);
    expect(atPly5?.score).toBe(MATE - 5);
  });

  it("reports per-search hit counts", () => {
    const tt = new TranspositionTable(4);
    tt.beginSearch();
    tt.store({ lo: 4, hi: 4 }, 2, 1, TT_LOWER, null, 0);
    tt.probe({ lo: 4, hi: 4 }, 0);
    tt.probe({ lo: 4, hi: 4 }, 0);
    expect(tt.hitsThisSearch()).toBe(2);
    tt.beginSearch();
    expect(tt.hitsThisSearch()).toBe(0);
  });

  it("keeps upper/lower flags", () => {
    const tt = new TranspositionTable(4);
    tt.beginSearch();
    tt.store({ lo: 5, hi: 5 }, 3, -8, TT_UPPER, null, 0);
    expect(tt.probe({ lo: 5, hi: 5 }, 0)?.flag).toBe(TT_UPPER);
  });
});
