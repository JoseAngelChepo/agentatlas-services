import { plainSubdocument, plainSubdocumentArray } from '../../common/utils/plain-mongoose';
import { hasStructuredOutputSchema } from '../../inference/utils/build-openai-json-schema-format';
import { parseEndNodeData } from '../orchestrator/evaluate-end-node';
import type { SwarmGraph } from '../schemas/swarm-graph.schema';
import type { SwarmGraphNode } from '../schemas/swarm-graph.schema';
import type { AgentWorker } from '../schemas/agent-worker.schema';
import { GraphNodeKind } from '../types/graph-node-kind.enum';
import { buildGraphIndex, resolveNodeKind } from './graph-index';
import { findSinkEndNodeIds, pickPreferredEndNodeId } from './resolve-run-completion';
import { resolveExitWorkerKey } from './resolve-graph-terminals';
import { findStartGraphNode } from './start-node';

const DEFAULT_START_INPUTS = ['message'];

const RUN_INPUT_FIELD_RE = /\{\{runInput\.([a-zA-Z0-9_]+)(?:\.[^}]*)?\}\}/g;

function collectRunInputFieldsFromText(text: string | undefined, acc: string[]): void {
  if (!text) {
    return;
  }

  for (const match of text.matchAll(RUN_INPUT_FIELD_RE)) {
    const name = match[1]?.trim();
    if (name && !acc.includes(name)) {
      acc.push(name);
    }
  }
}

/** Fields referenced in worker Instructions / promptMessages (`{{runInput.*}}`). */
export function extractRunInputFieldsFromWorkerPrompts(
  workers?: Iterable<Pick<AgentWorker, 'systemPrompt' | 'promptMessages'>>,
): string[] {
  const names: string[] = [];

  if (!workers) {
    return names;
  }

  for (const worker of workers) {
    collectRunInputFieldsFromText(worker.systemPrompt, names);
    for (const message of worker.promptMessages ?? []) {
      collectRunInputFieldsFromText(message.content, names);
    }
  }

  return names;
}

/**
 * Effective child-swarm run input field names for tool prompts and passthrough.
 * Prefer Start node `inputVariables`; fall back to worker `{{runInput.*}}` tokens.
 */
export function extractSwarmRunInputFieldNames(
  graph: SwarmGraph | null | undefined,
  workers?: Iterable<Pick<AgentWorker, 'systemPrompt' | 'promptMessages'>>,
): string[] {
  const fromStart = extractStartInputNames(graph);
  const fromPrompts = extractRunInputFieldsFromWorkerPrompts(workers);

  const startIsDefaultOnly =
    fromStart.length === 1 && fromStart[0] === 'message' && fromPrompts.length > 0;

  if (startIsDefaultOnly) {
    return fromPrompts;
  }

  const merged = [...fromStart];
  for (const name of fromPrompts) {
    if (!merged.includes(name)) {
      merged.push(name);
    }
  }

  return merged.length > 0 ? merged : [...DEFAULT_START_INPUTS];
}

function plainGraphNode(node: SwarmGraphNode): SwarmGraphNode {
  const plain = plainSubdocument<SwarmGraphNode>(node) ?? node;
  const data = plainSubdocument<Record<string, unknown>>(plain.data);
  return data ? { ...plain, data } : plain;
}

function plainGraph(graph: SwarmGraph | null | undefined): SwarmGraph | null {
  if (!graph) {
    return null;
  }
  const maybeDoc = graph as SwarmGraph & { toObject?: () => SwarmGraph };
  const plain =
    plainSubdocument<SwarmGraph>(graph) ??
    (typeof maybeDoc.toObject === 'function' ? maybeDoc.toObject() : graph);
  const nodes = plainSubdocumentArray<SwarmGraphNode>(plain.nodes).map(plainGraphNode);
  return { ...plain, nodes };
}

/** Mirrors platform `defaultOutputKeyFromValuePath`. */
function defaultOutputKeyFromValuePath(valuePath: string): string {
  const trimmed = valuePath.trim();
  if (!trimmed) {
    return '';
  }
  if (trimmed.startsWith('runInput.')) {
    return trimmed.slice('runInput.'.length);
  }
  const lastDot = trimmed.lastIndexOf('.');
  if (lastDot >= 0) {
    return trimmed.slice(lastDot + 1);
  }
  return trimmed;
}

function extractEndFieldKeys(data: Record<string, unknown> | undefined): string[] {
  const parsed = parseEndNodeData(data);
  const keys: string[] = [];

  for (const field of parsed.fields ?? []) {
    let key = typeof field.key === 'string' ? field.key.trim() : '';
    if (!key) {
      key = defaultOutputKeyFromValuePath(
        typeof field.valuePath === 'string' ? field.valuePath : '',
      );
    }
    if (key && !keys.includes(key)) {
      keys.push(key);
    }
  }

  return keys;
}

function extractOutputSchemaPropertyKeys(
  schema: Record<string, unknown> | undefined,
): string[] {
  if (!hasStructuredOutputSchema(schema)) {
    return [];
  }
  const props = schema!.properties;
  if (!props || typeof props !== 'object' || Array.isArray(props)) {
    return [];
  }
  return Object.keys(props as Record<string, unknown>);
}

/** Caller-facing input names declared on the Start node (`runInput.*`). */
export function extractStartInputNames(graph: SwarmGraph | null | undefined): string[] {
  const plain = plainGraph(graph);
  if (!plain) {
    return [...DEFAULT_START_INPUTS];
  }

  const start = findStartGraphNode(plain);
  const data = start?.raw.data;
  if (!data || typeof data !== 'object') {
    return [...DEFAULT_START_INPUTS];
  }

  const raw = (data as { inputVariables?: unknown }).inputVariables;
  if (!Array.isArray(raw)) {
    return [...DEFAULT_START_INPUTS];
  }

  const names: string[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') {
      continue;
    }
    const name =
      typeof (row as { name?: string }).name === 'string'
        ? (row as { name: string }).name.trim()
        : '';
    if (name && !names.includes(name)) {
      names.push(name);
    }
  }

  return names.length > 0 ? names : [...DEFAULT_START_INPUTS];
}

/** Output keys from the workflow sink End node, else exit worker `outputSchema`. */
export function extractEndOutputKeys(
  graph: SwarmGraph | null | undefined,
  workersById?: Map<string, AgentWorker>,
): string[] {
  const plain = plainGraph(graph);
  if (!plain) {
    return [];
  }

  const graphIndex = buildGraphIndex(plain);
  const sinkId = pickPreferredEndNodeId(
    findSinkEndNodeIds(plain, graphIndex),
    graphIndex,
  );

  if (sinkId) {
    const sinkNode = graphIndex.nodesById.get(sinkId)?.raw;
    const sinkKeys = extractEndFieldKeys(sinkNode?.data);
    if (sinkKeys.length > 0) {
      return sinkKeys;
    }
  }

  for (const node of plain.nodes) {
    if (resolveNodeKind(node) !== GraphNodeKind.END) {
      continue;
    }
    const keys = extractEndFieldKeys(node.data);
    if (keys.length > 0) {
      return keys;
    }
  }

  if (workersById && workersById.size > 0) {
    const exitWorkerKey = resolveExitWorkerKey(plain, graphIndex);
    const worker = workersById.get(exitWorkerKey);
    const schemaKeys = extractOutputSchemaPropertyKeys(worker?.outputSchema);
    if (schemaKeys.length > 0) {
      return schemaKeys;
    }
  }

  return [];
}
