/** Mirrors the workspace While node `data` shape. */
export type WhileNodeData = {
  /** Evaluated before each iteration; loop continues while truthy. */
  condition: string;
  /** UI-only on the platform; backend uses `condition` as-is. */
  useCode?: boolean;
  /** Safety cap (default {@link DEFAULT_WHILE_MAX_ITERATIONS}). */
  maxIterations?: number;
};

export type WhileNodeOutput = {
  kind: 'while';
  /** `loop` or `done` — matches React Flow `sourceHandle` ids. */
  branchHandle: string;
  /** 1-based iteration index for this evaluation. */
  iteration: number;
  conditionResult: boolean;
  matchedCondition?: string;
  /** Worker output from the node immediately before this loop (for downstream agents). */
  passthrough: Record<string, unknown>;
  routingWarning?: string;
};

export const WHILE_LOOP_HANDLE = 'loop';
export const WHILE_DONE_HANDLE = 'done';
export const DEFAULT_WHILE_MAX_ITERATIONS = 50;

export function whileBranchHandlesMatch(expected: string, wire: string): boolean {
  const a = expected.trim().toLowerCase();
  const b = wire.trim().toLowerCase();
  if (!a || !b) return false;
  return a === b;
}
