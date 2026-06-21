import type { AgentWorkerRunInput } from '../../swarms/context/swarm-context.types';
import {
  evaluateSwarmValueExpression,
  isPromptExpression,
} from '../../swarms/utils/evaluate-swarm-expression';
import { buildWorkerExpressionContext } from './build-worker-expression-context';

const PROMPT_TOKEN_RE = /\{\{([^}]+)\}\}/g;

function formatValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function slugifyWorkerName(name: string): string {
  const cleaned = name.trim().replace(/[^a-zA-Z0-9_]/g, '_').replace(/_+/g, '_');
  return cleaned.length > 0 ? cleaned : 'worker';
}

export function slugifyNodeId(nodeId: string): string {
  const cleaned = nodeId.trim().replace(/[^a-zA-Z0-9_]/g, '_').replace(/_+/g, '_');
  return cleaned.length > 0 ? cleaned : 'node';
}

function getNested(root: unknown, path: string[]): unknown {
  if (path.length === 0) {
    return root;
  }
  let cur: unknown = root;
  for (const key of path) {
    if (cur == null || typeof cur !== 'object' || Array.isArray(cur)) {
      return undefined;
    }
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/** Flat keys and `compressOutput` wrapper `{ summary: { …fields } }`. */
function readUpstreamField(
  output: Record<string, unknown>,
  key: string,
): unknown {
  if (key in output) {
    return output[key];
  }
  const wrapped = output.summary;
  if (wrapped && typeof wrapped === 'object' && !Array.isArray(wrapped)) {
    return (wrapped as Record<string, unknown>)[key];
  }
  return undefined;
}

function readUpstreamPath(output: Record<string, unknown>, path: string[]): unknown {
  if (path.length === 0) {
    return output;
  }
  const [first, ...rest] = path;
  if (!first) {
    return output;
  }
  if (rest.length === 0) {
    return readUpstreamField(output, first);
  }
  const direct = getNested(output, [first, ...rest]);
  if (direct !== undefined) {
    return direct;
  }
  const wrapped = output.summary;
  if (wrapped && typeof wrapped === 'object' && !Array.isArray(wrapped)) {
    return getNested(wrapped, [first, ...rest]);
  }
  return undefined;
}

function resolveUpstreamIndex(
  selector: string,
  input: AgentWorkerRunInput,
): number {
  const numeric = Number(selector);
  if (
    Number.isInteger(numeric) &&
    numeric >= 0 &&
    numeric < input.upstream.length
  ) {
    return numeric;
  }

  const meta = input.upstreamMeta ?? [];
  for (let i = 0; i < meta.length; i++) {
    const source = meta[i];
    if (!source) {
      continue;
    }
    if (source.ref != null && source.ref === selector) {
      return i;
    }
    if (source.nodeId != null && source.nodeId === selector) {
      return i;
    }
    if (source.workerId === selector) {
      return i;
    }
    if (slugifyWorkerName(source.workerName) === selector) {
      return i;
    }
  }

  return -1;
}

const RESERVED_ROOTS = new Set([
  'goal',
  'runInput',
  'input',
  'shared',
  'upstream',
  'output',
]);

function valuesEqual(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }
  if (left == null || right == null) {
    return false;
  }
  if (typeof left !== typeof right) {
    return false;
  }
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function resolveFlatSwarmFieldPath(
  parts: string[],
  input: AgentWorkerRunInput,
): unknown {
  if (parts.length === 0 || input.upstream.length === 0) {
    return undefined;
  }
  const [root, ...rest] = parts;
  if (!root || RESERVED_ROOTS.has(root)) {
    return undefined;
  }

  let matchCount = 0;
  let value: unknown;
  for (const output of input.upstream) {
    if (!output || typeof output !== 'object' || Array.isArray(output)) {
      continue;
    }
    const record = output as Record<string, unknown>;
    const resolved =
      rest.length === 0
        ? readUpstreamField(record, root)
        : readUpstreamPath(record, parts);
    if (resolved !== undefined) {
      if (matchCount > 0 && !valuesEqual(value, resolved)) {
        return undefined;
      }
      value = resolved;
      matchCount += 1;
    }
  }

  return matchCount >= 1 ? value : undefined;
}

function resolveUpstreamPath(
  path: string[],
  input: AgentWorkerRunInput,
): unknown {
  if (path.length === 0 || input.upstream.length === 0) {
    return undefined;
  }

  if (path.length === 1) {
    if (input.upstream.length !== 1) {
      return undefined;
    }
    const output = input.upstream[0];
    if (!output || typeof output !== 'object' || Array.isArray(output)) {
      return undefined;
    }
    return readUpstreamPath(output as Record<string, unknown>, path);
  }

  const [selector, ...fieldPath] = path;
  if (!selector) {
    return undefined;
  }
  const index = resolveUpstreamIndex(selector, input);
  if (index < 0) {
    return undefined;
  }

  const output = input.upstream[index];
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    return undefined;
  }

  return readUpstreamPath(output as Record<string, unknown>, fieldPath);
}

function resolvePromptPath(path: string, input: AgentWorkerRunInput): unknown {
  const parts = path
    .split('.')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length === 0) {
    return undefined;
  }

  const [root, ...rest] = parts;

  switch (root) {
    case 'goal':
      return rest.length === 0 ? input.goal : undefined;
    case 'runInput':
      return getNested(input.runInput, rest);
    case 'shared':
      return getNested(input.shared, rest);
    case 'upstream':
      if (rest.length === 0) {
        return input.upstream.length > 0 ? input.upstream : undefined;
      }
      return resolveUpstreamPath(rest, input);
    default: {
      const flat = resolveFlatSwarmFieldPath(parts, input);
      if (flat !== undefined) {
        return flat;
      }
      return undefined;
    }
  }
}

/**
 * Replaces `{{…}}` tokens in worker instructions at run time.
 *
 * Supported roots:
 * - `{{goal}}`
 * - `{{runInput.key}}` (nested paths allowed)
 * - `{{shared.key}}`
 * - `{{field}}` when the output field name is unique in the swarm
 * - `{{upstream}}` — full upstream outputs array as JSON
 * - `{{upstream.field}}` when there is exactly one upstream node
 * - `{{upstream.<selector>.field}}` — by ref, node id, worker id, or name slug
 *
 * JS-like expressions (ternary, comparisons, `+` concat, `.length`) are also supported, e.g.
 * `{{capabilities.length > 0 ? 'capabilities required: ' + capabilities : ''}}`.
 *
 * Unknown or unresolved tokens are replaced with an empty string.
 */
export function substitutePromptVariables(
  template: string,
  input: AgentWorkerRunInput,
): string {
  if (!template.includes('{{')) {
    return template;
  }

  let expressionContext: ReturnType<typeof buildWorkerExpressionContext> | null = null;
  const getExpressionContext = () =>
    expressionContext ?? (expressionContext = buildWorkerExpressionContext(input));

  return template.replace(PROMPT_TOKEN_RE, (_match, rawPath: string) => {
    const path = typeof rawPath === 'string' ? rawPath.trim() : '';
    if (!path) {
      return '';
    }

    if (isPromptExpression(path)) {
      const value = evaluateSwarmValueExpression(path, getExpressionContext());
      return value === undefined ? '' : formatValue(value);
    }

    const value = resolvePromptPath(path, input);
    return value === undefined ? '' : formatValue(value);
  });
}
