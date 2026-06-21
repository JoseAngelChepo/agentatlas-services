import type { AgentWorker } from '../schemas/agent-worker.schema';
import type { SwarmContext } from '../context/swarm-context';
import type { SwarmGraph } from '../schemas/swarm-graph.schema';
import {
  IF_ELSE_ELSE_HANDLE,
  defaultIfElseCaseLabel,
  type IfElseNodeOutput,
  ifElseCaseHandle,
} from '../types/if-else-node.types';
import { buildSwarmExpressionContext } from '../utils/build-swarm-expression-context';
import { evaluateSwarmExpression, resolveSwarmOperand } from '../utils/evaluate-swarm-expression';
import { buildGraphIndex, parseIfElseNodeData, type GraphIndex } from '../utils/graph-index';

export type IfElseCaseEvaluation = {
  caseId: string;
  caseName: string;
  condition: string;
  /** Empty conditions are skipped during evaluation. */
  skipped: boolean;
  result: boolean;
};

export type IfElseRunInputHint = {
  companyId?: string;
  hasCompanyMemory: boolean;
  summaryLength?: number;
  companyMemoryTextLength?: number;
};

export type IfElseEvaluationDebug = {
  cases: IfElseCaseEvaluation[];
  runInput: IfElseRunInputHint;
};

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function buildRunInputHint(runInput: Record<string, unknown>): IfElseRunInputHint {
  const companyMemory = runInput.companyMemory;
  let summaryLength: number | undefined;
  if (typeof companyMemory === 'object' && companyMemory != null && !Array.isArray(companyMemory)) {
    const summary = (companyMemory as Record<string, unknown>).summary;
    if (typeof summary === 'string') {
      summaryLength = summary.length;
    }
  }

  const companyMemoryText = runInput.companyMemoryText;
  return {
    companyId: readString(runInput.companyId),
    hasCompanyMemory: companyMemory != null && typeof companyMemory === 'object',
    summaryLength,
    companyMemoryTextLength:
      typeof companyMemoryText === 'string' ? companyMemoryText.length : undefined,
  };
}

function evaluateCases(
  data: ReturnType<typeof parseIfElseNodeData>,
  exprCtx: ReturnType<typeof buildSwarmExpressionContext>,
): { cases: IfElseCaseEvaluation[]; matchedIndex: number | null } {
  const cases: IfElseCaseEvaluation[] = [];

  for (let index = 0; index < data.cases.length; index += 1) {
    const caseRow = data.cases[index]!;
    const condition = caseRow.condition?.trim() ?? '';
    if (!condition) {
      cases.push({
        caseId: caseRow.id,
        caseName: defaultIfElseCaseLabel(caseRow.name, index),
        condition: '',
        skipped: true,
        result: false,
      });
      continue;
    }

    const result = evaluateSwarmExpression(condition, exprCtx);
    cases.push({
      caseId: caseRow.id,
      caseName: defaultIfElseCaseLabel(caseRow.name, index),
      condition,
      skipped: false,
      result,
    });

    if (result) {
      return { cases, matchedIndex: index };
    }
  }

  return { cases, matchedIndex: null };
}

export function evaluateIfElseNode(
  graph: SwarmGraph,
  index: GraphIndex,
  context: SwarmContext,
  nodeId: string,
  workers: Map<string, AgentWorker>,
  debug?: IfElseEvaluationDebug,
): IfElseNodeOutput {
  const node = index.nodesById.get(nodeId);
  const data = parseIfElseNodeData(node?.data);
  const exprCtx = buildSwarmExpressionContext(graph, index, context, nodeId, workers);

  if (debug) {
    debug.runInput = buildRunInputHint(context.runInput);
  }

  const { cases, matchedIndex } = evaluateCases(data, exprCtx);
  if (debug) {
    debug.cases = cases;
  }

  if (matchedIndex != null) {
    const caseRow = data.cases[matchedIndex]!;
    const condition = caseRow.condition?.trim() ?? '';
    return {
      kind: 'ifelse',
      branchHandle: ifElseCaseHandle(caseRow.id),
      caseId: caseRow.id,
      caseName: defaultIfElseCaseLabel(caseRow.name, matchedIndex),
      matchedCondition: condition,
      passthrough: exprCtx.output,
    };
  }

  return {
    kind: 'ifelse',
    branchHandle: IF_ELSE_ELSE_HANDLE,
    caseName: 'Else',
    passthrough: exprCtx.output,
  };
}

/** Resolves a condition operand for debug logs (e.g. left side of a comparison). */
export function resolveIfElseConditionPreview(
  condition: string,
  graph: SwarmGraph,
  index: GraphIndex,
  context: SwarmContext,
  nodeId: string,
  workers: Map<string, AgentWorker>,
): unknown {
  const exprCtx = buildSwarmExpressionContext(graph, index, context, nodeId, workers);
  const trimmed = condition.trim();
  const compareMatch = trimmed.match(/^(.+?)\s*(===|!==|==|!=|>=|<=|>|<)\s*(.+)$/);
  if (compareMatch?.[1]) {
    return resolveSwarmOperand(compareMatch[1], exprCtx);
  }
  return resolveSwarmOperand(trimmed, exprCtx);
}
