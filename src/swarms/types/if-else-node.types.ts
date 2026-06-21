/** Mirrors the workspace If/else node `data.cases` shape. */
export type IfElseCase = {
  id: string;
  name?: string;
  /** Evaluated by {@link evaluateSwarmExpression} (Simple and Code modes both persist here). */
  condition: string;
  /** UI-only on the platform; backend ignores this flag and uses `condition` as-is. */
  useCode?: boolean;
  /** @deprecated Platform alias for `useCode`. */
  useCustom?: boolean;
};

export type IfElseNodeData = {
  cases: IfElseCase[];
};

export type IfElseNodeOutput = {
  kind: 'ifelse';
  /** `case-<caseId>` or `else` — matches React Flow `sourceHandle` ids. */
  branchHandle: string;
  caseId?: string;
  caseName?: string;
  /** Condition expression that matched (first winning case). */
  matchedCondition?: string;
  /** Worker output from the node immediately before this branch (for downstream agents). */
  passthrough: Record<string, unknown>;
  /** Set when the active branch has no matching outgoing wire on the canvas. */
  routingWarning?: string;
};

export const IF_ELSE_ELSE_HANDLE = 'else';

/**
 * Must match platform `caseHandleId()` in agentatlas-platform:
 * `id` already starting with `case-` → handle is that id; otherwise `case-${id}`.
 */
export function ifElseCaseHandle(caseId: string): string {
  const trimmed = caseId.trim();
  if (!trimmed) {
    return 'case-unknown';
  }
  return trimmed.startsWith('case-') ? trimmed : `case-${trimmed}`;
}

/** True when wire and active branch refer to the same if/else case (tolerates legacy handle shapes). */
export function ifElseBranchHandlesMatch(expected: string, wire: string): boolean {
  const a = expected.trim().toLowerCase();
  const b = wire.trim().toLowerCase();
  if (!a || !b) return false;
  if (a === b) return true;
  if (a === IF_ELSE_ELSE_HANDLE || b === IF_ELSE_ELSE_HANDLE) {
    return a === b;
  }

  const aliases = (handle: string): Set<string> => {
    const set = new Set<string>([handle]);
    if (handle.startsWith('case-case-')) {
      set.add(handle.slice(5));
    } else if (handle.startsWith('case-')) {
      set.add(`case-${handle}`);
    }
    return set;
  };

  const expectedAliases = aliases(a);
  for (const alias of aliases(b)) {
    if (expectedAliases.has(alias)) {
      return true;
    }
  }
  return false;
}

export function defaultIfElseCaseLabel(name: string | undefined, index: number): string {
  const trimmed = name?.trim() ?? '';
  if (trimmed) return trimmed;
  return index === 0 ? 'If' : 'Else if';
}
