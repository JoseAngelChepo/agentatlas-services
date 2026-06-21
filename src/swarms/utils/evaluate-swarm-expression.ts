import { readTopLevelOutputField } from './swarm-output-fields';

export type SwarmExpressionContext = {
  goal: string;
  runInput: Record<string, unknown>;
  shared: Record<string, unknown>;
  /** Primary predecessor output (`upstream[0]`). */
  output: Record<string, unknown>;
  /** All direct predecessor outputs (worker payloads). */
  upstream: Record<string, unknown>[];
  /** Legacy `upstream.<slug>.<field>`. */
  upstreamBySlug: Record<string, Record<string, unknown>>;
  /** Flat swarm-unique fields → full upstream output (`summary`, `icp`, …). */
  upstreamByField: Record<string, Record<string, unknown>>;
};

const COMPARE_PATTERN = /^(.+?)\s*(===|!==|==|!=|>=|<=|>|<)\s*(.+)$/;

function normalizeExpression(expression: string): string {
  return expression
    .trim()
    .replace(/^\{\{\s*/, '')
    .replace(/\s*\}\}$/, '')
    .trim();
}

function decodePathSegment(segment: string): string {
  const trimmed = segment.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** Dot/bracket path segments: `companyMemory.summary`, `items[0].name`. */
function tokenizePropertyPath(path: string): string[] {
  const tokens: string[] = [];
  let i = 0;

  while (i < path.length) {
    if (path[i] === '.') {
      i += 1;
      continue;
    }

    if (path[i] === '[') {
      const close = path.indexOf(']', i);
      if (close === -1) {
        break;
      }
      tokens.push(decodePathSegment(path.slice(i + 1, close)));
      i = close + 1;
      continue;
    }

    const nextDot = path.indexOf('.', i);
    const nextBracket = path.indexOf('[', i);
    let end = path.length;
    if (nextDot !== -1) {
      end = Math.min(end, nextDot);
    }
    if (nextBracket !== -1) {
      end = Math.min(end, nextBracket);
    }
    tokens.push(path.slice(i, end));
    i = end;
  }

  return tokens.filter(Boolean);
}

/**
 * JS-like property walk: objects, arrays, strings (`.length`), numeric indices.
 */
function resolvePathValue(root: unknown, path: string): unknown {
  const parts = tokenizePropertyPath(path);
  let current: unknown = root;

  for (const part of parts) {
    if (current == null) {
      return undefined;
    }

    if (part === 'length') {
      if (typeof current === 'string' || Array.isArray(current)) {
        current = current.length;
        continue;
      }
      return undefined;
    }

    if (Array.isArray(current)) {
      const index = Number(part);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return undefined;
      }
      current = current[index];
      continue;
    }

    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[part];
      continue;
    }

    return undefined;
  }

  return current;
}

function isTruthy(value: unknown): boolean {
  if (value === false || value === 0 || value === '') {
    return false;
  }
  return value != null;
}

function parseLiteral(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === 'true') {
    return true;
  }
  if (trimmed === 'false') {
    return false;
  }
  if (trimmed === 'null') {
    return null;
  }
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  const num = Number(trimmed);
  if (!Number.isNaN(num) && trimmed !== '') {
    return num;
  }
  return trimmed;
}

function resolveFlatFieldPath(path: string, ctx: SwarmExpressionContext): unknown {
  const parts = tokenizePropertyPath(path);
  if (parts.length === 0) {
    return undefined;
  }
  const [head, ...rest] = parts;
  if (!head || ctx.upstreamByField[head] == null) {
    return undefined;
  }
  const payload = ctx.upstreamByField[head];
  const fieldValue = readTopLevelOutputField(payload, head);
  const root = fieldValue !== undefined ? fieldValue : payload;
  if (rest.length === 0) {
    return root;
  }
  // Subpaths (e.g. rescued.length, capabilities.length) apply to the field value,
  // not the full upstream output object that owns the field.
  return resolvePathValue(root, rest.join('.'));
}

function resolveUpstreamPath(path: string, ctx: SwarmExpressionContext): unknown {
  const parts = tokenizePropertyPath(path);
  if (parts.length === 0) {
    return ctx.output;
  }

  const flat = resolveFlatFieldPath(path, ctx);
  if (flat !== undefined) {
    return flat;
  }

  const [head, ...rest] = parts;
  if (head && ctx.upstreamBySlug[head] != null) {
    const base = ctx.upstreamBySlug[head];
    return rest.length > 0 ? resolvePathValue(base, rest.join('.')) : base;
  }

  return resolvePathValue(ctx.output, path);
}

/** Resolves a single value reference against the swarm expression context. */
export function resolveSwarmOperand(operand: string, ctx: SwarmExpressionContext): unknown {
  return resolveOperand(operand, ctx);
}

function resolveOperand(operand: string, ctx: SwarmExpressionContext): unknown {
  const trimmed = operand.trim();
  if (!trimmed) {
    return undefined;
  }

  const typeofMatch = trimmed.match(/^typeof\s+(.+)$/s);
  if (typeofMatch?.[1]) {
    const value = resolveOperand(typeofMatch[1].trim(), ctx);
    if (value === undefined) {
      return 'undefined';
    }
    if (value === null) {
      return 'object';
    }
    return typeof value;
  }

  const rootKey = trimmed.split(/[.[]/)[0];
  switch (rootKey) {
    case 'goal':
      return trimmed === 'goal' ? ctx.goal : resolvePathValue(ctx.goal, trimmed.slice('goal.'.length));
    case 'runInput':
    case 'input': {
      const prefix = `${rootKey}.`;
      return trimmed === rootKey
        ? ctx.runInput
        : resolvePathValue(
            ctx.runInput,
            trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : trimmed.slice(rootKey.length + 1),
          );
    }
    case 'shared':
      return trimmed === 'shared'
        ? ctx.shared
        : resolvePathValue(ctx.shared, trimmed.slice('shared.'.length));
    case 'output':
      return trimmed === 'output'
        ? ctx.output
        : resolvePathValue(ctx.output, trimmed.slice('output.'.length));
    case 'upstream':
      if (trimmed === 'upstream') {
        return ctx.upstream;
      }
      return resolveUpstreamPath(trimmed.slice('upstream.'.length), ctx);
    default: {
      const flat = resolveFlatFieldPath(trimmed, ctx);
      if (flat !== undefined) {
        return flat;
      }
      return resolveUpstreamPath(trimmed, ctx);
    }
  }
}

function compareValues(left: unknown, op: string, right: unknown): boolean {
  switch (op) {
    case '===':
      return left === right;
    case '!==':
      return left !== right;
    case '==':
      return left == right;
    case '!=':
      return left != right;
    case '>':
      return Number(left) > Number(right);
    case '>=':
      return Number(left) >= Number(right);
    case '<':
      return Number(left) < Number(right);
    case '<=':
      return Number(left) <= Number(right);
    default:
      return false;
  }
}

function splitTopLevelOperator(expr: string, operator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: '"' | "'" | null = null;
  let start = 0;

  for (let i = 0; i < expr.length; i += 1) {
    const ch = expr[i]!;

    if (quote) {
      if (ch === quote && expr[i - 1] !== '\\') {
        quote = null;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }

    if (ch === '(') {
      depth += 1;
      continue;
    }

    if (ch === ')') {
      depth -= 1;
      continue;
    }

    if (depth === 0 && expr.startsWith(operator, i)) {
      parts.push(expr.slice(start, i).trim());
      start = i + operator.length;
      i += operator.length - 1;
    }
  }

  parts.push(expr.slice(start).trim());
  return parts.filter((part) => part.length > 0);
}

function splitTopLevel(expr: string, operator: '||' | '&&'): string[] {
  return splitTopLevelOperator(expr, operator);
}

function splitTopLevelTernary(expr: string): [string, string, string] | null {
  let depth = 0;
  let quote: '"' | "'" | null = null;
  let questionAt = -1;

  for (let i = 0; i < expr.length; i += 1) {
    const ch = expr[i]!;

    if (quote) {
      if (ch === quote && expr[i - 1] !== '\\') {
        quote = null;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }

    if (ch === '(') {
      depth += 1;
      continue;
    }

    if (ch === ')') {
      depth -= 1;
      continue;
    }

    if (depth === 0 && ch === '?') {
      questionAt = i;
      break;
    }
  }

  if (questionAt < 0) {
    return null;
  }

  depth = 0;
  quote = null;
  for (let i = questionAt + 1; i < expr.length; i += 1) {
    const ch = expr[i]!;

    if (quote) {
      if (ch === quote && expr[i - 1] !== '\\') {
        quote = null;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }

    if (ch === '(') {
      depth += 1;
      continue;
    }

    if (ch === ')') {
      depth -= 1;
      continue;
    }

    if (depth === 0 && ch === ':') {
      return [
        expr.slice(0, questionAt).trim(),
        expr.slice(questionAt + 1, i).trim(),
        expr.slice(i + 1).trim(),
      ];
    }
  }

  return null;
}

function stringifyConcatValue(value: unknown): string {
  if (value == null) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function evaluateValueExpression(expr: string, ctx: SwarmExpressionContext): unknown {
  let trimmed = stripOuterParens(expr.trim());
  if (!trimmed) {
    return undefined;
  }

  const ternary = splitTopLevelTernary(trimmed);
  if (ternary) {
    const [test, consequent, alternate] = ternary;
    return evaluateSwarmExpression(test, ctx)
      ? evaluateValueExpression(consequent, ctx)
      : evaluateValueExpression(alternate, ctx);
  }

  const plusParts = splitTopLevelOperator(trimmed, '+');
  if (plusParts.length > 1) {
    return plusParts
      .map((part) => stringifyConcatValue(evaluateValueExpression(part, ctx)))
      .join('');
  }

  const comparison = evaluateComparison(trimmed, ctx);
  if (comparison != null) {
    return comparison;
  }

  if (
    /^['"\d-]/.test(trimmed) ||
    trimmed === 'true' ||
    trimmed === 'false' ||
    trimmed === 'null'
  ) {
    return parseLiteral(trimmed);
  }

  return resolveOperand(trimmed, ctx);
}

/** True when the token body uses operators (ternary, compare, logic) — not a plain path. */
export function isPromptExpression(path: string): boolean {
  const trimmed = path.trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed.includes('?')) {
    return true;
  }
  if (/\s(===|!==|==|!=|>=|<=|>|<)\s/.test(trimmed)) {
    return true;
  }
  if (/\s&&\s/.test(trimmed) || /\s\|\|\s/.test(trimmed)) {
    return true;
  }
  if (trimmed.startsWith('!')) {
    return true;
  }
  if (splitTopLevelOperator(trimmed, '+').length > 1) {
    return true;
  }
  return false;
}

/**
 * Evaluates a JS-like value expression for prompt `{{…}}` tokens.
 * Supports ternary, `+` string concat, comparisons, `.length`, paths, and literals.
 */
export function evaluateSwarmValueExpression(
  expression: string,
  ctx: SwarmExpressionContext,
): unknown {
  const trimmed = normalizeExpression(expression);
  if (!trimmed) {
    return undefined;
  }
  return evaluateValueExpression(trimmed, ctx);
}

function stripOuterParens(expr: string): string {
  let trimmed = expr.trim();

  while (trimmed.startsWith('(') && trimmed.endsWith(')')) {
    let depth = 0;
    let closedAt = -1;

    for (let i = 0; i < trimmed.length; i += 1) {
      if (trimmed[i] === '(') {
        depth += 1;
      } else if (trimmed[i] === ')') {
        depth -= 1;
        if (depth === 0) {
          closedAt = i;
          break;
        }
      }
    }

    if (closedAt === trimmed.length - 1) {
      trimmed = trimmed.slice(1, -1).trim();
    } else {
      break;
    }
  }

  return trimmed;
}

function evaluateComparison(expr: string, ctx: SwarmExpressionContext): boolean | null {
  const match = expr.match(COMPARE_PATTERN);
  if (!match?.[1] || !match[2] || !match[3]) {
    return null;
  }

  const left = resolveOperand(match[1], ctx);
  const rightRaw = match[3].trim();
  const right =
    /^['"\d-]/.test(rightRaw) ||
    rightRaw === 'true' ||
    rightRaw === 'false' ||
    rightRaw === 'null'
      ? parseLiteral(rightRaw)
      : resolveOperand(rightRaw, ctx);

  return compareValues(left, match[2], right);
}

function evaluateUnary(expr: string, ctx: SwarmExpressionContext): boolean {
  let trimmed = stripOuterParens(expr.trim());

  if (trimmed.startsWith('!')) {
    return !evaluateUnary(trimmed.slice(1).trim(), ctx);
  }

  const comparison = evaluateComparison(trimmed, ctx);
  if (comparison != null) {
    return comparison;
  }

  return isTruthy(resolveOperand(trimmed, ctx));
}

function evaluateAnd(expr: string, ctx: SwarmExpressionContext): boolean {
  const parts = splitTopLevel(expr, '&&');
  return parts.every((part) => evaluateUnary(part, ctx));
}

function evaluateOr(expr: string, ctx: SwarmExpressionContext): boolean {
  const parts = splitTopLevel(expr, '||');
  return parts.some((part) => evaluateAnd(part, ctx));
}

/**
 * Evaluates a JS-like condition for If/else Code mode.
 * Supports property paths, `.length`, `[]` indices, comparisons, `&&`, `||`, `!`, and parentheses.
 */
export function evaluateSwarmExpression(
  expression: string,
  ctx: SwarmExpressionContext,
): boolean {
  const trimmed = normalizeExpression(expression);
  if (!trimmed) {
    return false;
  }
  if (trimmed === 'always') {
    return true;
  }

  if (/\s(===|!==|==|!=|>=|<=|>|<)\s*$/.test(trimmed)) {
    return false;
  }

  return evaluateOr(trimmed, ctx);
}
