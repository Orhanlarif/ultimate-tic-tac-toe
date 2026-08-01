export interface SearchBudget {
  deadline: number;
  nodeBudget: number;
  nodes: number;
  aborted: boolean;
  shouldAbort?: () => boolean;
  /** Check wall-clock every N nodes for throughput. */
  checkEvery: number;
}

export function createBudget(opts: {
  timeMs: number;
  nodeBudget: number;
  shouldAbort?: () => boolean;
  checkEvery?: number;
}): SearchBudget {
  const start = now();
  return {
    deadline: start + Math.max(1, opts.timeMs),
    nodeBudget: Math.max(1, opts.nodeBudget),
    nodes: 0,
    aborted: false,
    shouldAbort: opts.shouldAbort,
    checkEvery: opts.checkEvery ?? 128,
  };
}

export function budgetExhausted(budget: SearchBudget): boolean {
  if (budget.aborted) return true;
  if (budget.nodes >= budget.nodeBudget) {
    budget.aborted = true;
    return true;
  }
  if (budget.nodes % budget.checkEvery === 0) {
    if (budget.shouldAbort?.() || now() >= budget.deadline) {
      budget.aborted = true;
      return true;
    }
  }
  return false;
}

export function remainingNodes(budget: SearchBudget): number {
  return Math.max(0, budget.nodeBudget - budget.nodes);
}

export function remainingTimeMs(budget: SearchBudget): number {
  return Math.max(0, budget.deadline - now());
}

export function now(): number {
  return typeof performance !== "undefined" && performance.now
    ? performance.now()
    : Date.now();
}
