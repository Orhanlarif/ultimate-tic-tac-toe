import type { GameState, Move } from "@uttt/game-engine";
import { evaluate, orderScore } from "./evaluation.js";
import { SearchState } from "./searchState.js";
import type { ChooseMoveResult, SearchInfo } from "./types.js";

interface MctsNode {
  move: Move | null;
  parent: MctsNode | null;
  children: MctsNode[];
  untried: Move[];
  visits: number;
  value: number; // from root side perspective, average
  sideBefore: 0 | 1;
}

export interface MctsOptions {
  timeMs?: number;
  simulations?: number;
  c?: number;
  seedRng: () => number;
  shouldAbort?: () => boolean;
}

/**
 * Lightweight UCT + heuristic playout MCTS for benchmarking against alpha-beta.
 * Not wired into production chooseMove unless tournaments prove superiority.
 */
export function mctsBestMove(game: GameState, opts: MctsOptions): ChooseMoveResult {
  const start = now();
  const timeMs = opts.timeMs ?? 2_000;
  const deadline = start + timeMs;
  const c = opts.c ?? 1.35;
  const rootState = new SearchState(game);
  const rootSide = rootState.side;
  const rootMoves: Move[] = [];
  rootState.collectMoves(rootMoves);
  if (rootMoves.length === 0) throw new Error("No legal moves");

  const root: MctsNode = {
    move: null,
    parent: null,
    children: [],
    untried: rootMoves.slice(),
    visits: 0,
    value: 0,
    sideBefore: rootSide,
  };

  let sims = 0;
  const maxSims = opts.simulations ?? 50_000;

  while (sims < maxSims && now() < deadline && !opts.shouldAbort?.()) {
    const state = rootState.clone();
    let node = root;

    // Selection
    while (node.untried.length === 0 && node.children.length > 0) {
      node = selectUct(node, c, rootSide);
      if (node.move) state.make(node.move);
      if (state.status !== 0) break;
    }

    // Expansion
    if (state.status === 0 && node.untried.length > 0) {
      const idx = Math.floor(opts.seedRng() * node.untried.length);
      const move = node.untried.splice(idx, 1)[0]!;
      state.make(move);
      const child: MctsNode = {
        move,
        parent: node,
        children: [],
        untried: [],
        visits: 0,
        value: 0,
        sideBefore: (1 - node.sideBefore) as 0 | 1,
      };
      if (state.status === 0) {
        const legal: Move[] = [];
        state.collectMoves(legal);
        child.untried = legal;
      }
      node.children.push(child);
      node = child;
    }

    // Simulation (heuristic-biased playout)
    const reward = playout(state, rootSide, opts.seedRng, 48);
    backprop(node, reward);
    sims += 1;
  }

  let best = root.children[0];
  if (!best) {
    return {
      move: rootMoves[0]!,
      info: info(0, sims, start, false, 0),
    };
  }
  for (const child of root.children) {
    if (child.visits > (best?.visits ?? 0)) best = child;
  }

  return {
    move: best!.move!,
    info: info(
      0,
      sims,
      start,
      false,
      best!.visits > 0 ? best!.value / best!.visits : 0,
    ),
  };
}

function selectUct(node: MctsNode, c: number, rootSide: 0 | 1): MctsNode {
  let best = node.children[0]!;
  let bestScore = -Infinity;
  // Player to move at this node; value is stored from root's perspective.
  const forRoot = node.sideBefore === rootSide;
  for (const child of node.children) {
    if (child.visits === 0) return child;
    const exploit = child.value / child.visits;
    const oriented = forRoot ? exploit : 1 - exploit;
    const explore = c * Math.sqrt(Math.log(node.visits + 1) / child.visits);
    const score = oriented + explore;
    if (score > bestScore) {
      bestScore = score;
      best = child;
    }
  }
  return best;
}

function playout(
  state: SearchState,
  rootSide: 0 | 1,
  rng: () => number,
  maxPlies: number,
): number {
  let plies = 0;
  const moves: Move[] = [];
  while (state.status === 0 && plies < maxPlies) {
    state.collectMoves(moves);
    if (moves.length === 0) break;
    // Heuristic-biased random: pick among top-3 ordered moves.
    moves.sort((a, b) => orderScore(state, b) - orderScore(state, a));
    const top = moves.slice(0, Math.min(3, moves.length));
    const move = top[Math.floor(rng() * top.length)]!;
    state.make(move);
    plies += 1;
  }
  if (state.status !== 0) {
    const score = evaluate(state, rootSide);
    if (score > 50_000) return 1;
    if (score < -50_000) return 0;
    return 0.5;
  }
  // Soft eval terminal for truncated playouts.
  const evalScore = evaluate(state, rootSide);
  return 1 / (1 + Math.exp(-evalScore / 80));
}

function backprop(node: MctsNode, reward: number): void {
  let cur: MctsNode | null = node;
  while (cur) {
    cur.visits += 1;
    cur.value += reward;
    cur = cur.parent;
  }
}

function info(
  depth: number,
  nodes: number,
  start: number,
  aborted: boolean,
  score: number,
): SearchInfo {
  return {
    depth,
    nodes,
    timeMs: now() - start,
    ttHits: 0,
    aborted,
    score,
  };
}

function now(): number {
  return typeof performance !== "undefined" && performance.now
    ? performance.now()
    : Date.now();
}
