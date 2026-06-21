import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { AgentWorker } from '../schemas/agent-worker.schema';
import type { SwarmGraph } from '../schemas/swarm-graph.schema';
import type { SwarmContext } from '../context/swarm-context';
import { buildSwarmExpressionContext } from '../utils/build-swarm-expression-context';
import { resolveUpstreamPayloadForNode } from '../utils/build-swarm-expression-context';
import type { GraphIndex } from '../utils/graph-index';
import {
  resolveSwarmOperand,
  type SwarmExpressionContext,
} from '../utils/evaluate-swarm-expression';
import type {
  SwarmNodeData,
  SwarmNodeInputField,
  SwarmNodeOutput,
} from '../types/swarm-node.types';
import {
  SUB_SWARM_FAILED_HANDLE,
  SUB_SWARM_SUCCESS_HANDLE,
} from '../types/swarm-node.types';
import type { SubSwarmParentPauseContext } from '../types/sub-swarm-pending-input.types';

/** Copied into child run input when missing from tool args (agent-tool sub-swarm). */
export const PARENT_RUN_INPUT_PASSTHROUGH_KEYS = [
  'message',
  'topic',
  'query',
  'text',
  'prompt',
  'summary',
  'task',
] as const;

/** Keys scanned for primary user text when mapping into child run input fields. */
export const PARENT_RUN_INPUT_TEXT_KEYS = [
  ...PARENT_RUN_INPUT_PASSTHROUGH_KEYS,
  'input',
  'request',
  'goal',
] as const;

export type ExecuteSubSwarmParams = {
  childSwarmId: string;
  childInput: Record<string, unknown>;
  userId: string;
  parentSwarmRunId: Types.ObjectId;
  parentNodeId: string;
  maxNodeVisits?: number;
  parentPauseContext?: SubSwarmParentPauseContext;
};

export type ExecuteSubSwarmResult = {
  swarmRunId: string;
  output: Record<string, unknown> | null;
  status: 'done' | 'failed' | 'paused';
  error: string | null;
};

export type ExecuteSubSwarmFn = (params: ExecuteSubSwarmParams) => Promise<ExecuteSubSwarmResult>;

export function parseSwarmNodeData(data: Record<string, unknown> | undefined): SwarmNodeData {
  const label = typeof data?.label === 'string' ? data.label : undefined;
  const swarmId = typeof data?.swarmId === 'string' ? data.swarmId.trim() : undefined;
  const passShared = data?.passShared === true;
  const inputFields = Array.isArray(data?.inputFields)
    ? (data.inputFields as SwarmNodeInputField[]).filter((row) => row && typeof row === 'object')
    : undefined;
  return { label, swarmId, inputFields, passShared };
}

function parseStaticValue(raw: string | undefined): unknown {
  const trimmed = raw?.trim() ?? '';
  if (!trimmed) {
    return undefined;
  }
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return trimmed;
    }
  }
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  const num = Number(trimmed);
  if (!Number.isNaN(num) && trimmed !== '') {
    return num;
  }
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function resolveInputFieldValue(field: SwarmNodeInputField, ctx: SwarmExpressionContext): unknown {
  const source = field.source ?? 'field';
  if (source === 'static') {
    return parseStaticValue(field.staticValue);
  }

  let path = field.valuePath?.trim() ?? '';
  if (!path) {
    return undefined;
  }

  if (source === 'runInput' && !path.startsWith('runInput.')) {
    path = `runInput.${path}`;
  }
  if (source === 'shared' && !path.startsWith('shared.')) {
    path = `shared.${path}`;
  }
  if (source === 'upstream' && !path.startsWith('upstream.') && !path.startsWith('output.')) {
    path = `upstream.${path}`;
  }

  return resolveSwarmOperand(path, ctx);
}

/** Fill common user-intent keys from the parent run when the tool call omits them. */
export function forwardParentRunInputDefaults(
  parentRunInput: Record<string, unknown>,
  toolPayload: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...toolPayload };
  for (const key of PARENT_RUN_INPUT_PASSTHROUGH_KEYS) {
    const parentValue = parentRunInput[key];
    const currentValue = merged[key];
    const parentUsable =
      typeof parentValue === 'string'
        ? parentValue.trim().length > 0
        : parentValue != null && parentValue !== '';
    const currentMissing =
      currentValue == null ||
      (typeof currentValue === 'string' && currentValue.trim().length === 0);
    if (parentUsable && currentMissing) {
      merged[key] = parentValue;
    }
  }
  return merged;
}

/**
 * Merge tool args with the parent swarm run input using the child swarm Start-node contract.
 */
export function forwardChildSwarmRunInput(
  parentRunInput: Record<string, unknown>,
  toolPayload: Record<string, unknown>,
  childInputNames: string[],
): Record<string, unknown> {
  let merged = forwardParentRunInputDefaults(parentRunInput, toolPayload);

  for (const key of childInputNames) {
    const currentValue = merged[key];
    const currentMissing =
      currentValue == null ||
      (typeof currentValue === 'string' && currentValue.trim().length === 0);
    if (!currentMissing) {
      continue;
    }

    const parentValue = parentRunInput[key];
    const parentUsable =
      typeof parentValue === 'string'
        ? parentValue.trim().length > 0
        : parentValue != null && parentValue !== '';
    if (parentUsable) {
      merged[key] = parentValue;
    }
  }

  const primaryField = childInputNames[0];
  if (!primaryField) {
    return merged;
  }

  const primaryValue = merged[primaryField];
  const primaryMissing =
    primaryValue == null ||
    (typeof primaryValue === 'string' && primaryValue.trim().length === 0);
  if (!primaryMissing) {
    return merged;
  }

  const parentText = pickParentUserText(parentRunInput);
  if (parentText) {
    merged = { ...merged, [primaryField]: parentText };
  }

  return merged;
}

/** Map generic tool args (`message`, …) onto the child swarm's primary input field. */
export function normalizeToolPayloadForChildContract(
  toolPayload: Record<string, unknown>,
  childInputNames: string[],
): Record<string, unknown> {
  if (childInputNames.length === 0) {
    return toolPayload;
  }

  const primaryField = childInputNames[0];
  if (!primaryField) {
    return toolPayload;
  }

  const primaryValue = toolPayload[primaryField];
  const primaryMissing =
    primaryValue == null ||
    (typeof primaryValue === 'string' && primaryValue.trim().length === 0);
  if (!primaryMissing) {
    return toolPayload;
  }

  for (const alias of PARENT_RUN_INPUT_TEXT_KEYS) {
    if (alias === primaryField) {
      continue;
    }
    const value = toolPayload[alias];
    if (typeof value === 'string' && value.trim().length > 0) {
      return { ...toolPayload, [primaryField]: value.trim() };
    }
  }

  return toolPayload;
}

function pickParentUserText(parentRunInput: Record<string, unknown>): string | undefined {
  for (const key of PARENT_RUN_INPUT_TEXT_KEYS) {
    const value = parentRunInput[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

export function buildChildSwarmRunInput(params: {
  data: SwarmNodeData;
  graph: SwarmGraph;
  graphIndex: GraphIndex;
  context: SwarmContext;
  nodeId: string;
  workers: Map<string, AgentWorker>;
}): Record<string, unknown> {
  const { data, graph, graphIndex, context, nodeId, workers } = params;
  const childInput: Record<string, unknown> = {};

  if (data.passShared) {
    Object.assign(childInput, context.getShared());
  }

  const fields = data.inputFields ?? [];
  if (fields.length === 0) {
    const passthrough = resolveUpstreamPayloadForNode(nodeId, graph, graphIndex, context);
    if (passthrough) {
      Object.assign(childInput, passthrough);
    }
    return childInput;
  }

  const exprCtx = buildSwarmExpressionContext(graph, graphIndex, context, nodeId, workers);
  for (const field of fields) {
    const key = typeof field.key === 'string' ? field.key.trim() : '';
    if (!key) {
      continue;
    }
    const value = resolveInputFieldValue(field, exprCtx);
    if (value !== undefined) {
      childInput[key] = value;
    }
  }

  return childInput;
}

function buildSwarmNodeOutput(params: {
  swarmId: string;
  swarmRunId: string;
  status: ExecuteSubSwarmResult['status'];
  output: Record<string, unknown> | null;
  error: string | null;
}): SwarmNodeOutput {
  const success = params.status === 'done' && params.output != null;
  const branchHandle = success ? SUB_SWARM_SUCCESS_HANDLE : SUB_SWARM_FAILED_HANDLE;
  return {
    kind: 'swarm',
    swarmId: params.swarmId,
    swarmRunId: params.swarmRunId,
    branchHandle,
    status: params.status,
    output: params.output,
    error: params.error,
  };
}

export async function executeSwarmNode(params: {
  data: SwarmNodeData;
  graph: SwarmGraph;
  graphIndex: GraphIndex;
  context: SwarmContext;
  nodeId: string;
  workers: Map<string, AgentWorker>;
  parentSwarmRunId: Types.ObjectId;
  userId: string;
  maxNodeVisits?: number;
  parentPauseContext?: SubSwarmParentPauseContext;
  runSubSwarm: ExecuteSubSwarmFn;
}): Promise<SwarmNodeOutput> {
  const swarmId = params.data.swarmId?.trim() ?? '';
  if (!swarmId || !Types.ObjectId.isValid(swarmId)) {
    throw new BadRequestException('Sub-swarm node: swarmId is required');
  }

  const childInput = buildChildSwarmRunInput({
    data: params.data,
    graph: params.graph,
    graphIndex: params.graphIndex,
    context: params.context,
    nodeId: params.nodeId,
    workers: params.workers,
  });

  const result = await params.runSubSwarm({
    childSwarmId: swarmId,
    childInput,
    userId: params.userId,
    parentSwarmRunId: params.parentSwarmRunId,
    parentNodeId: params.nodeId,
    maxNodeVisits: params.maxNodeVisits,
    parentPauseContext: params.parentPauseContext,
  });

  return buildSwarmNodeOutput({
    swarmId,
    swarmRunId: result.swarmRunId,
    status: result.status,
    output: result.output,
    error: result.error,
  });
}
