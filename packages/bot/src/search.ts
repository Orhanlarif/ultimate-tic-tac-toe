import type { GameState, Move } from "@uttt/game-engine";
import { budgetExhausted, createBudget, remainingNodes, type SearchBudget } from "./budget.js";
import { MATE } from "./constants.js";
import {
  endgameEligible,
  solveExact,
  solverInfoFrom,
} from "./endgame.js";
import { EndgameTable } from "./endgameTable.js";
import {
  classifyInto,
  emptyFeatures,
  evaluate,
  F_FREE_SEND,
  F_LOCAL_BLOCK,
  F_LOCAL_WIN,
  F_META_BLOCK,
  F_META_THREAT,
  F_META_WIN,
  F_QUIET,
  orderScore,
} from "./evaluation.js";
import { MOVE_TABLE, SearchState, WIN_LINES } from "./searchState.js";
import type { BotSearchSession } from "./session.js";
import { TT_EXACT, TT_LOWER, TT_UPPER, TranspositionTable } from "./tt.js";
import type {
  ChooseMoveResult,
  DifficultyProfile,
  SearchInfo,
  SolverInfo,
} from "./types.js";

interface SearchContext {
  rootSide: 0 | 1;
  budget: SearchBudget;
  tt: TranspositionTable | null;
  /** Two killer move codes per ply, laid out as [ply * 2], [ply * 2 + 1]. */
  killers: Int16Array;
  history: Int32Array;
  /** counterMoves[prevMoveCode] = move code that refuted it. */
  counterMoves: Int16Array;
  /** moveStack[ply] = code of the move played from that ply. */
  moveStack: Int16Array;
  pvMove: Move | null;
  usePvs: boolean;
  useLmr: boolean;
  qDepth: number;
  /** Remaining selective-extension budget for the current path. */
  maxExtensions: number;
  reSearches: number;
  lmrReductions: number;
  extensions: number;
  qNodes: number;
}

const NO_CODE = -1;
/** A game is at most 81 plies deep; extensions never push far past that. */
const MAX_PLY = 128;
/** Initial half-width of the aspiration window, in evaluation points. */
const ASPIRATION_START = 30;
/** Beyond this half-width, re-searching with a full window is cheaper. */
const ASPIRATION_MAX = 600;

function moveCode(move: Move): number {
  return move.board * 9 + move.cell;
}

/**
 * Fallback endgame table for sessionless searches (tests, arena, server).
 * Proven results are position-intrinsic, so reuse across calls is safe.
 */
let fallbackEndgame: EndgameTable | null = null;

function sharedEndgameTable(enabled: number): EndgameTable | null {
  if (enabled <= 0) return null;
  fallbackEndgame ??= new EndgameTable(16);
  return fallbackEndgame;
}

interface ScoredMove {
  move: Move;
  score: number;
}

export function searchBestMove(
  game: GameState,
  profile: DifficultyProfile,
  rng: () => number,
  opts?: {
    timeMs?: number;
    maxDepth?: number;
    nodeBudget?: number;
    shouldAbort?: () => boolean;
    session?: BotSearchSession;
    gameId?: string;
    botPlayer?: "X" | "O";
    /** Test/override hook for PVS. */
    usePvs?: boolean;
  },
): ChooseMoveResult {
  const state = new SearchState(game);
  const rootSide = state.side;
  const start = performanceNow();

  const instantWin = findInstantMetaWin(state, rootSide);
  if (instantWin) {
    return {
      move: instantWin,
      info: baseInfo(1, 1, 0, false, MATE),
    };
  }

  const defensive = findDefensiveMove(state, rootSide);
  if (defensive && profile.trustTacticalShortcuts) {
    return {
      move: defensive,
      info: baseInfo(1, 1, 0, false, 0),
    };
  }

  const timeMs = opts?.timeMs ?? profile.timeMs;
  const maxDepth = opts?.maxDepth ?? profile.maxDepth;
  const nodeBudget = opts?.nodeBudget ?? profile.nodeBudget;
  const budget = createBudget({
    timeMs,
    nodeBudget,
    shouldAbort: opts?.shouldAbort,
  });

  let tt: TranspositionTable | null = null;
  if (profile.useTt) {
    if (opts?.session && opts.gameId) {
      const seat = opts.botPlayer ?? (rootSide === 0 ? "X" : "O");
      opts.session.beginSearch(opts.gameId, seat, profile.ttSizePower);
      tt = opts.session.tt;
    } else {
      tt = new TranspositionTable(profile.ttSizePower);
      tt.beginSearch();
    }
  }

  const fallback = pickEmergencyFromState(state, rng);
  let solverInfo: SolverInfo | undefined;

  // Exact endgame attempt with a share of the remaining budget.
  const eg = endgameEligible(
    state,
    profile.endgameEmptyAuto,
    profile.endgameEmptyTry,
  );
  if (eg.eligible && profile.endgameNodeShare > 0) {
    const share = Math.floor(remainingNodes(budget) * profile.endgameNodeShare);
    const solverBudget = createBudget({
      timeMs: Math.max(1, budget.deadline - performanceNow()),
      nodeBudget: Math.max(1, share),
      shouldAbort: opts?.shouldAbort,
    });
    // Mirror abort onto parent via shared shouldAbort; copy nodes back after.
    const result = solveExact(state, rootSide, solverBudget, {
      maxEmpty: eg.maxEmpty,
      maxBranching: eg.maxBranching,
      table: opts?.session
        ? opts.session.endgameTable()
        : sharedEndgameTable(profile.endgameEmptyTry),
    });
    budget.nodes += solverBudget.nodes;
    // Sub-budget exhaustion must not kill remaining heuristic search.
    // Only propagate external cancel or parent wall-clock expiry.
    if (opts?.shouldAbort?.() || performanceNow() >= budget.deadline) {
      budget.aborted = true;
    }
    solverInfo = solverInfoFrom(result);
    if (result.status === "solved") {
      const score =
        result.outcome === 1
          ? MATE - result.distance
          : result.outcome === -1
            ? -MATE + result.distance
            : 0;
      return {
        move: result.move,
        info: {
          ...baseInfo(result.distance, budget.nodes, performanceNow() - start, false, score),
          solver: solverInfo,
        },
      };
    }
  }

  const ctx: SearchContext = {
    rootSide,
    budget,
    tt,
    killers: new Int16Array(MAX_PLY * 2).fill(NO_CODE),
    history: new Int32Array(81),
    counterMoves: new Int16Array(81).fill(NO_CODE),
    moveStack: new Int16Array(MAX_PLY).fill(NO_CODE),
    // Deep profiles verify the defensive move by search, but still look at it
    // first so the refutation of everything else comes cheap.
    pvMove: defensive,
    usePvs: opts?.usePvs ?? profile.usePvs,
    useLmr: profile.useLmr,
    qDepth: profile.qDepth,
    maxExtensions: profile.maxExtensions,
    reSearches: 0,
    lmrReductions: 0,
    extensions: 0,
    qNodes: 0,
  };

  let bestMove = fallback;
  let bestScore = -Infinity;
  let completedDepth = 0;
  let lastRootScores: ScoredMove[] = [];

  for (let depth = 1; depth <= maxDepth; depth++) {
    if (budgetExhausted(budget)) break;
    budget.aborted = false;
    // Age history so older iterations do not dominate move ordering.
    for (let i = 0; i < ctx.history.length; i++) ctx.history[i]! >>= 1;

    const aspirate =
      depth >= 3 && Number.isFinite(bestScore) && Math.abs(bestScore) < MATE / 2;
    let delta = ASPIRATION_START;
    let alpha = aspirate ? bestScore - delta : -Infinity;
    let beta = aspirate ? bestScore + delta : Infinity;

    let result = searchRoot(state, depth, alpha, beta, ctx);
    // Widen only the side that failed, doubling until the window opens fully.
    while (!budget.aborted && (result.score <= alpha || result.score >= beta)) {
      if (result.score <= alpha) {
        beta = (alpha + beta) / 2;
        alpha -= delta;
      } else {
        beta += delta;
      }
      delta *= 2;
      if (delta > ASPIRATION_MAX) {
        alpha = -Infinity;
        beta = Infinity;
      }
      ctx.reSearches += 1;
      result = searchRoot(state, depth, alpha, beta, ctx);
    }

    if (budget.aborted) {
      // The iteration is incomplete, but a root move that overtook the previous
      // principal variation is still a same-depth comparison, so keep it rather
      // than throwing away the whole deepest iteration.
      if (
        result.searched >= 2 &&
        result.firstMove !== null &&
        !sameMove(result.move, result.firstMove) &&
        result.score > alpha &&
        result.score < beta
      ) {
        bestMove = result.move;
        bestScore = result.score;
        if (result.scored.length > 0) lastRootScores = result.scored;
      }
      break;
    }

    bestMove = result.move;
    bestScore = result.score;
    completedDepth = depth;
    ctx.pvMove = bestMove;
    if (result.scored.length > 0) lastRootScores = result.scored;

    if (Math.abs(bestScore) >= MATE - 100) break;
  }

  if (
    profile.candidateWindow > 0 &&
    completedDepth > 0 &&
    Math.abs(bestScore) < MATE - 100 &&
    !budget.aborted
  ) {
    const exact = scoreAllRootMoves(state, completedDepth, ctx);
    if (!budget.aborted && exact.length > 0) {
      lastRootScores = exact;
      bestMove = exact[0]!.move;
      bestScore = exact[0]!.score;
    }
  }

  const chosen = selectByDifficulty(
    state,
    rootSide,
    bestMove,
    bestScore,
    lastRootScores,
    profile,
    rng,
  );

  const info: SearchInfo = {
    depth: completedDepth,
    nodes: budget.nodes,
    timeMs: performanceNow() - start,
    ttHits: tt?.hitsThisSearch() ?? 0,
    aborted: budget.aborted,
    score: bestScore,
    reSearches: ctx.reSearches,
    lmrReductions: ctx.lmrReductions,
    qNodes: ctx.qNodes,
    solver: solverInfo,
  };

  return { move: chosen, info };
}

/** Fast deterministic legal move for worker timeouts / host fallbacks. */
export function pickEmergencyMove(game: GameState, seed: number): Move {
  const state = new SearchState(game);
  let t = seed >>> 0;
  const rng = () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
  return pickEmergencyFromState(state, rng);
}

function baseInfo(
  depth: number,
  nodes: number,
  timeMs: number,
  aborted: boolean,
  score: number,
): SearchInfo {
  return { depth, nodes, timeMs, ttHits: 0, aborted, score };
}

function selectByDifficulty(
  state: SearchState,
  rootSide: 0 | 1,
  bestMove: Move,
  bestScore: number,
  scored: ScoredMove[],
  profile: DifficultyProfile,
  rng: () => number,
): Move {
  if (scored.length === 0) return bestMove;

  if (Math.abs(bestScore) >= MATE - 100) {
    const critical = scored.filter((s) => Math.abs(s.score - bestScore) <= 1);
    return critical[0]?.move ?? bestMove;
  }

  const safe = filterUnsafeMetaLosses(state, rootSide, scored);
  const pool = safe.length > 0 ? safe : scored;

  if (profile.candidateWindow <= 0 && profile.softBlunderRate <= 0) {
    return pool[0]?.move ?? bestMove;
  }

  const top = pool[0]!.score;
  const window =
    profile.candidateWindow > 0
      ? profile.candidateWindow
      : 0;
  let candidates =
    window > 0
      ? pool.filter((s) => top - s.score <= window)
      : [pool[0]!];

  if (
    profile.softBlunderRate > 0 &&
    pool.length > 1 &&
    rng() < profile.softBlunderRate &&
    Math.abs(bestScore) < MATE - 100
  ) {
    // Meta-safe near-miss: expand the window and bias away from the top move.
    const blunderWindow = Math.max(window, 160);
    const soft = pool.filter((s) => top - s.score <= blunderWindow);
    if (soft.length > 1) {
      const withoutBest = soft.slice(1);
      candidates = withoutBest.length > 0 ? withoutBest : soft;
      return softmaxPick(
        candidates,
        Math.max(profile.candidateTemperature, 0.85),
        rng,
      );
    }
  }

  if (candidates.length <= 1) return candidates[0]?.move ?? bestMove;
  if (profile.candidateWindow <= 0) return candidates[0]?.move ?? bestMove;

  return softmaxPick(candidates, profile.candidateTemperature, rng);
}

function filterUnsafeMetaLosses(
  state: SearchState,
  rootSide: 0 | 1,
  scored: ScoredMove[],
): ScoredMove[] {
  const safe: ScoredMove[] = [];
  let anyUnsafe = false;
  for (const entry of scored) {
    if (allowsOpponentMetaWin(state, entry.move, rootSide)) {
      anyUnsafe = true;
    } else {
      safe.push(entry);
    }
  }
  if (anyUnsafe && safe.length > 0) return safe;
  return scored;
}

function softmaxPick(
  candidates: ScoredMove[],
  temperature: number,
  rng: () => number,
): Move {
  if (temperature <= 0) return candidates[0]!.move;
  const max = candidates[0]!.score;
  const weights = candidates.map((c) =>
    Math.exp((c.score - max) / Math.max(0.01, temperature * 40)),
  );
  const total = weights.reduce((s, w) => s + w, 0);
  let r = rng() * total;
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i]!;
    if (r <= 0) return candidates[i]!.move;
  }
  return candidates[candidates.length - 1]!.move;
}

interface RootResult {
  move: Move;
  score: number;
  scored: ScoredMove[];
  /** How many root moves were fully searched before any abort. */
  searched: number;
  /** First root move tried, i.e. the previous principal variation. */
  firstMove: Move | null;
}

function searchRoot(
  state: SearchState,
  depth: number,
  alpha: number,
  beta: number,
  ctx: SearchContext,
): RootResult {
  const moves = orderedRootMoves(state, ctx.pvMove);
  let bestMove = moves[0]!;
  let bestScore = -Infinity;
  let a = alpha;
  const scored: ScoredMove[] = [];
  let firstMove: Move | null = null;

  for (let i = 0; i < moves.length; i++) {
    const move = moves[i]!;
    if (budgetExhausted(ctx.budget)) {
      ctx.budget.aborted = true;
      break;
    }
    ctx.moveStack[0] = moveCode(move);
    state.make(move);
    const ext = ctx.maxExtensions;
    let score: number;
    if (ctx.usePvs && i > 0 && depth > 1) {
      score = alphaBeta(state, depth - 1, a, a + 1, 1, ctx, ext);
      if (!ctx.budget.aborted && score > a && score < beta) {
        ctx.reSearches += 1;
        score = alphaBeta(state, depth - 1, a, beta, 1, ctx, ext);
      }
    } else {
      score = alphaBeta(state, depth - 1, a, beta, 1, ctx, ext);
    }
    state.unmake();
    if (ctx.budget.aborted) break;
    scored.push({ move, score });
    if (firstMove === null) firstMove = move;
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
    if (score > a) a = score;
    if (a >= beta) break;
  }

  const searched = scored.length;
  scored.sort((x, y) => y.score - x.score);
  return { move: bestMove, score: bestScore, scored, searched, firstMove };
}

function scoreAllRootMoves(
  state: SearchState,
  depth: number,
  ctx: SearchContext,
): ScoredMove[] {
  const moves = orderedRootMoves(state, ctx.pvMove);
  const scored: ScoredMove[] = [];
  for (const move of moves) {
    if (budgetExhausted(ctx.budget)) {
      ctx.budget.aborted = true;
      break;
    }
    ctx.moveStack[0] = moveCode(move);
    state.make(move);
    const score = alphaBeta(
      state,
      Math.max(0, depth - 1),
      -Infinity,
      Infinity,
      1,
      ctx,
      ctx.maxExtensions,
    );
    state.unmake();
    if (ctx.budget.aborted) break;
    scored.push({ move, score });
  }
  scored.sort((x, y) => y.score - x.score);
  return scored;
}

function alphaBeta(
  state: SearchState,
  depth: number,
  alpha: number,
  beta: number,
  ply: number,
  ctx: SearchContext,
  extLeft: number,
): number {
  ctx.budget.nodes += 1;
  if (budgetExhausted(ctx.budget)) {
    return evaluate(state, ctx.rootSide);
  }

  if (state.status !== 0) {
    const score = evaluate(state, ctx.rootSide);
    if (score >= MATE - 1000) return score - ply;
    if (score <= -MATE + 1000) return score + ply;
    return score;
  }

  if (depth <= 0) {
    return forcingSearch(state, alpha, beta, ctx.qDepth, ply, ctx);
  }

  const maximizing = state.side === ctx.rootSide;
  const hashLo = state.hashLo;
  const hashHi = state.hashHi;
  let ttCode = NO_CODE;

  if (ctx.tt && ctx.tt.probeAt(hashLo, hashHi, ply)) {
    const tt = ctx.tt;
    if (tt.hitDepth >= depth) {
      const score = tt.hitScore;
      if (tt.hitFlag === TT_EXACT) return score;
      if (tt.hitFlag === TT_LOWER) alpha = Math.max(alpha, score);
      else if (tt.hitFlag === TT_UPPER) beta = Math.min(beta, score);
      if (alpha >= beta) return score;
    }
    ttCode = tt.hitMoveCode;
  }

  const plyIdx = ply < MAX_PLY ? ply : MAX_PLY - 1;
  const moves = abPool[plyIdx]!;
  state.collectMoves(moves);
  if (moves.length === 0) return evaluate(state, ctx.rootSide);

  const prevCode = ply > 0 ? ctx.moveStack[ply - 1]! : NO_CODE;
  const counter =
    prevCode !== NO_CODE ? ctx.counterMoves[prevCode]! : NO_CODE;
  const flags = flagPool[plyIdx]!;
  orderMoves(state, moves, ttCode, counter, plyIdx, ctx, flags);

  // A single legal reply costs nothing extra to look at one ply deeper.
  let nodeExtension = 0;
  if (moves.length === 1 && extLeft > 0) nodeExtension = 1;

  let best = maximizing ? -Infinity : Infinity;
  let bestCode = NO_CODE;
  const alphaOrig = alpha;
  const betaOrig = beta;
  const moveCount = moves.length;
  const killer0 = ctx.killers[plyIdx * 2]!;
  const killer1 = ctx.killers[plyIdx * 2 + 1]!;

  for (let moveIndex = 0; moveIndex < moveCount; moveIndex++) {
    if (budgetExhausted(ctx.budget)) break;

    const move = moves[moveIndex]!;
    const code = moveCode(move);
    const feat = flags[moveIndex]!;
    let extension = nodeExtension;
    // Meta-decisive replies decide games; do not let them fall off the horizon.
    if (extension === 0 && extLeft > 0 && feat & (F_META_WIN | F_META_BLOCK)) {
      extension = 1;
    }
    if (extension > 0) ctx.extensions += 1;

    const fullDepth = depth - 1 + extension;
    let nextDepth = fullDepth;
    let reduced = false;

    if (
      ctx.useLmr &&
      extension === 0 &&
      depth >= 3 &&
      moveIndex >= 3 &&
      feat & F_QUIET &&
      !(feat & F_FREE_SEND) &&
      state.emptyCount > 12 &&
      moveCount >= 6 &&
      code !== ttCode &&
      code !== killer0 &&
      code !== killer1
    ) {
      const r = lmrReduction(depth, moveIndex);
      if (r > 0) {
        nextDepth = Math.max(1, depth - 1 - r);
        reduced = true;
        ctx.lmrReductions += 1;
      }
    }

    const childExt = extLeft - extension;
    ctx.moveStack[ply] = code;
    state.make(move);
    let score: number;
    if (ctx.usePvs && moveIndex > 0 && depth > 1) {
      const nullAlpha = maximizing ? alpha : beta - 1;
      const nullBeta = maximizing ? alpha + 1 : beta;
      score = alphaBeta(state, nextDepth, nullAlpha, nullBeta, ply + 1, ctx, childExt);
      const improves = maximizing ? score > alpha : score < beta;
      if (!ctx.budget.aborted && improves && score < beta && score > alpha) {
        ctx.reSearches += 1;
        score = alphaBeta(state, fullDepth, alpha, beta, ply + 1, ctx, childExt);
      } else if (!ctx.budget.aborted && reduced && improves) {
        ctx.reSearches += 1;
        score = alphaBeta(state, fullDepth, alpha, beta, ply + 1, ctx, childExt);
      }
    } else if (reduced) {
      score = alphaBeta(state, nextDepth, alpha, beta, ply + 1, ctx, childExt);
      const improves = maximizing ? score > alpha : score < beta;
      if (!ctx.budget.aborted && improves) {
        ctx.reSearches += 1;
        score = alphaBeta(state, fullDepth, alpha, beta, ply + 1, ctx, childExt);
      }
    } else {
      score = alphaBeta(state, nextDepth, alpha, beta, ply + 1, ctx, childExt);
    }
    state.unmake();
    if (ctx.budget.aborted) break;

    if (maximizing) {
      if (score > best) {
        best = score;
        bestCode = code;
      }
      if (score > alpha) alpha = score;
    } else {
      if (score < best) {
        best = score;
        bestCode = code;
      }
      if (score < beta) beta = score;
    }

    if (alpha >= beta) {
      storeKiller(ctx, plyIdx, code);
      ctx.history[code] = ctx.history[code]! + depth * depth;
      if (prevCode !== NO_CODE) ctx.counterMoves[prevCode] = code;
      break;
    }
  }

  if (best === -Infinity || best === Infinity) {
    return evaluate(state, ctx.rootSide);
  }

  if (ctx.tt && !ctx.budget.aborted) {
    let flag: 0 | 1 | 2 = TT_EXACT;
    if (best <= alphaOrig) flag = TT_UPPER;
    else if (best >= betaOrig) flag = TT_LOWER;
    ctx.tt.storeAt(hashLo, hashHi, depth, best, flag, bestCode, ply);
  }

  return best;
}

function forcingSearch(
  state: SearchState,
  alpha: number,
  beta: number,
  qPly: number,
  ply: number,
  ctx: SearchContext,
): number {
  ctx.qNodes += 1;
  ctx.budget.nodes += 1;
  if (budgetExhausted(ctx.budget)) {
    return evaluate(state, ctx.rootSide);
  }

  if (state.status !== 0) {
    const score = evaluate(state, ctx.rootSide);
    if (score >= MATE - 1000) return score - ply;
    if (score <= -MATE + 1000) return score + ply;
    return score;
  }

  const maximizing = state.side === ctx.rootSide;
  const standPat = evaluate(state, ctx.rootSide);

  if (qPly <= 0) return standPat;

  const moves = qPool[ply < MAX_PLY ? ply : MAX_PLY - 1]!;
  state.collectMoves(moves);

  // Near the horizon only meta-decisive moves are worth expanding; higher up we
  // also follow local wins and blocks, which drive most UTTT tactics.
  const metaOnly = qPly <= 2;
  const keepMask = metaOnly
    ? F_META_WIN | F_META_BLOCK | F_META_THREAT
    : F_META_WIN | F_META_BLOCK | F_META_THREAT | F_LOCAL_WIN | F_LOCAL_BLOCK;
  let write = 0;
  for (let i = 0; i < moves.length; i++) {
    const move = moves[i]!;
    const f = classifyInto(state, move, orderFeatures);
    if (f.flags & keepMask) {
      moves[write] = move;
      orderScratch[write] = f.orderBonus;
      write += 1;
    }
  }
  moves.length = write;
  if (write === 0) return standPat;

  if (maximizing) {
    if (standPat >= beta) return standPat;
    alpha = Math.max(alpha, standPat);
  } else {
    if (standPat <= alpha) return standPat;
    beta = Math.min(beta, standPat);
  }

  for (let i = 1; i < write; i++) {
    const move = moves[i]!;
    const score = orderScratch[i]!;
    let j = i - 1;
    while (j >= 0 && orderScratch[j]! < score) {
      moves[j + 1] = moves[j]!;
      orderScratch[j + 1] = orderScratch[j]!;
      j -= 1;
    }
    moves[j + 1] = move;
    orderScratch[j + 1] = score;
  }

  // Keep the horizon search narrow so it cannot blow up the node budget.
  const limit = Math.min(write, metaOnly ? 4 : 6);
  let best = standPat;

  for (let i = 0; i < limit; i++) {
    const move = moves[i]!;
    if (budgetExhausted(ctx.budget)) break;
    state.make(move);
    const score = forcingSearch(state, alpha, beta, qPly - 1, ply + 1, ctx);
    state.unmake();
    if (ctx.budget.aborted) break;

    if (maximizing) {
      best = Math.max(best, score);
      alpha = Math.max(alpha, score);
    } else {
      best = Math.min(best, score);
      beta = Math.min(beta, score);
    }
    if (alpha >= beta) break;
  }

  return best;
}

/**
 * Score each move once and insertion-sort descending, carrying the classification
 * flags along so the move loop never has to classify again. Move lists are small,
 * and this avoids re-running classification inside a comparator.
 */
function orderMoves(
  state: SearchState,
  moves: Move[],
  ttCode: number,
  counter: number,
  plyIdx: number,
  ctx: SearchContext,
  flags: Int32Array,
): void {
  const killer0 = ctx.killers[plyIdx * 2]!;
  const killer1 = ctx.killers[plyIdx * 2 + 1]!;
  const n = moves.length;

  for (let i = 0; i < n; i++) {
    const move = moves[i]!;
    const f = classifyInto(state, move, orderFeatures);
    flags[i] = f.flags;
    const code = move.board * 9 + move.cell;
    if (code === ttCode) orderScratch[i] = 1_000_000;
    else if (code === killer0) orderScratch[i] = 900_000;
    else if (code === killer1) orderScratch[i] = 890_000;
    else if (code === counter) orderScratch[i] = 880_000;
    else orderScratch[i] = f.orderBonus + ctx.history[code]!;
  }

  for (let i = 1; i < n; i++) {
    const move = moves[i]!;
    const score = orderScratch[i]!;
    const flag = flags[i]!;
    let j = i - 1;
    while (j >= 0 && orderScratch[j]! < score) {
      moves[j + 1] = moves[j]!;
      orderScratch[j + 1] = orderScratch[j]!;
      flags[j + 1] = flags[j]!;
      j -= 1;
    }
    moves[j + 1] = move;
    orderScratch[j + 1] = score;
    flags[j + 1] = flag;
  }
}

/**
 * Late-move reductions grow with both remaining depth and how late the move is,
 * so a depth-18 search can skim its tail without blunting shallow searches.
 */
const LMR_DIM = 64;
const LMR_TABLE = buildLmrTable();

function buildLmrTable(): Int8Array {
  const table = new Int8Array(LMR_DIM * LMR_DIM);
  for (let d = 1; d < LMR_DIM; d++) {
    for (let i = 1; i < LMR_DIM; i++) {
      table[d * LMR_DIM + i] = Math.floor(
        0.6 + (Math.log(d) * Math.log(i)) / 2.4,
      );
    }
  }
  return table;
}

function lmrReduction(depth: number, moveIndex: number): number {
  const d = depth < LMR_DIM ? depth : LMR_DIM - 1;
  const i = moveIndex < LMR_DIM ? moveIndex : LMR_DIM - 1;
  return LMR_TABLE[d * LMR_DIM + i]!;
}

const orderScratch = new Int32Array(81);
const orderFeatures = emptyFeatures();
/** Per-ply move-list pools; each ply holds at most one active list. */
const abPool: Move[][] = Array.from({ length: MAX_PLY }, () => []);
const qPool: Move[][] = Array.from({ length: MAX_PLY }, () => []);
/** Per-ply classification flags, kept alive across child recursion. */
const flagPool: Int32Array[] = Array.from(
  { length: MAX_PLY },
  () => new Int32Array(81),
);

function orderedRootMoves(state: SearchState, pv: Move | null): Move[] {
  const moves: Move[] = [];
  state.collectMoves(moves);
  const scores = new Float64Array(moves.length);
  for (let i = 0; i < moves.length; i++) {
    const move = moves[i]!;
    scores[i] = orderScore(state, move) + (pv && sameMove(move, pv) ? 100_000 : 0);
  }
  for (let i = 1; i < moves.length; i++) {
    const move = moves[i]!;
    const score = scores[i]!;
    let j = i - 1;
    while (j >= 0 && scores[j]! < score) {
      moves[j + 1] = moves[j]!;
      scores[j + 1] = scores[j]!;
      j -= 1;
    }
    moves[j + 1] = move;
    scores[j + 1] = score;
  }
  return moves;
}

/** A move that ends the game immediately; always optimal, so never search it. */
function findInstantMetaWin(state: SearchState, rootSide: 0 | 1): Move | null {
  const moves: Move[] = [];
  state.collectMoves(moves);
  for (const move of moves) {
    state.make(move);
    const isMeta = state.status === 1 && state.winner === rootSide + 1;
    state.unmake();
    if (isMeta) return move;
  }
  return null;
}

/**
 * A move that denies the opponent an immediate meta win, or the single move
 * that does not hand one over. Usually best but not provably so, which is why
 * deep profiles treat it as an ordering hint rather than an answer.
 */
function findDefensiveMove(state: SearchState, rootSide: 0 | 1): Move | null {
  const moves: Move[] = [];
  state.collectMoves(moves);

  const opp = (1 - rootSide) as 0 | 1;
  for (const move of moves) {
    if (cellIsOpponentMetaThreat(state, move.board, move.cell, opp)) return move;
  }

  const safe: Move[] = [];
  let anyUnsafe = false;
  for (const move of moves) {
    if (allowsOpponentMetaWin(state, move, rootSide)) anyUnsafe = true;
    else safe.push(move);
  }

  if (anyUnsafe && safe.length === 1) return safe[0]!;
  return null;
}

function cellIsOpponentMetaThreat(
  state: SearchState,
  board: number,
  cell: number,
  opp: 0 | 1,
): boolean {
  if (state.winners[board] !== 0) return false;
  const base = board * 9;
  if (state.cells[base + cell] !== 0) return false;

  const meMark = (opp + 1) as 1 | 2;
  const cells = new Uint8Array(9);
  for (let c = 0; c < 9; c++) cells[c] = state.cells[base + c]!;
  cells[cell] = meMark;

  let localWin = false;
  for (const [a, b, c] of WIN_LINES) {
    if (cells[a] === meMark && cells[b] === meMark && cells[c] === meMark) {
      localWin = true;
      break;
    }
  }
  if (!localWin) return false;

  const winners = state.winners.slice();
  winners[board] = meMark;
  for (const [a, b, c] of WIN_LINES) {
    if (winners[a] === meMark && winners[b] === meMark && winners[c] === meMark) {
      return true;
    }
  }
  return false;
}

function allowsOpponentMetaWin(
  state: SearchState,
  move: Move,
  rootSide: 0 | 1,
): boolean {
  state.make(move);
  let oppCanMate = false;
  const oppWinner = rootSide === 0 ? 2 : 1;
  const statusAfter = state.status;
  const winnerAfter = state.winner;
  if (statusAfter === 0) {
    const oppMoves: Move[] = [];
    state.collectMoves(oppMoves);
    for (const om of oppMoves) {
      state.make(om);
      const replyStatus = state.status;
      const replyWinner = state.winner;
      state.unmake();
      if (replyStatus === 1 && replyWinner === oppWinner) {
        oppCanMate = true;
        break;
      }
    }
  } else if (statusAfter === 1 && winnerAfter === oppWinner) {
    oppCanMate = true;
  }
  state.unmake();
  return oppCanMate;
}

function pickEmergencyFromState(state: SearchState, rng: () => number): Move {
  const moves: Move[] = [];
  state.collectMoves(moves);
  if (moves.length === 0) throw new Error("No legal moves");

  const forced =
    findInstantMetaWin(state, state.side) ?? findDefensiveMove(state, state.side);
  if (forced) return forced;

  moves.sort((a, b) => orderScore(state, b) - orderScore(state, a));
  if (moves.length > 1 && rng() < 0.08) return moves[1]!;
  return moves[0]!;
}

function storeKiller(ctx: SearchContext, plyIdx: number, code: number): void {
  const slot = plyIdx * 2;
  if (ctx.killers[slot] === code) return;
  ctx.killers[slot + 1] = ctx.killers[slot]!;
  ctx.killers[slot] = code;
}

function sameMove(a: Move, b: Move): boolean {
  return a.board === b.board && a.cell === b.cell;
}

function performanceNow(): number {
  return typeof performance !== "undefined" && performance.now
    ? performance.now()
    : Date.now();
}
