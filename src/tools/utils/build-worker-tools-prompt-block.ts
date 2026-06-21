import type { OpenAiFunctionToolDefinition } from '../../inference/types/openai-worker-tools.types';
import type { AgentToolPromptHints, ToolCatalogEntry } from '../types/agent-tool.interface';
import type { ToolId } from '../types/tool-id.enum';
import type { SwarmToolPromptSpec } from '../../swarms/utils/build-swarm-tool-input-contract';
import { buildSwarmToolPromptHints } from '../../swarms/utils/build-swarm-tool-input-contract';
import { parseSwarmIdFromToolFunctionName } from '../../swarms/utils/swarm-tool-function-name';

export type WorkerToolPromptEntry = {
  functionName: string;
  label: string;
  description: string;
  hints: AgentToolPromptHints;
};

const SWARM_TOOL_DEFAULT_HINTS: AgentToolPromptHints = {
  whenToUse:
    'When the user request should be handled by this specialized swarm instead of answering from memory.',
  inputGuide:
    'Call with a JSON object using the child swarm Start-node field names (see swarm graph).',
  outputGuide:
    'JSON with `status`, `output`, `swarmRunId`, and optional `error`. When `status` is `done`, use `output` in your reply; do not ignore a successful tool result.',
};

export type CollectWorkerToolPromptEntriesParams = {
  registryToolIds: ToolId[];
  includesRunSwarm: boolean;
  swarmToolFunctions: OpenAiFunctionToolDefinition[];
  swarmToolPromptSpecs?: SwarmToolPromptSpec[];
  parentRunInput?: Record<string, unknown>;
  registryCatalog: ToolCatalogEntry[];
  runSwarmCatalog: ToolCatalogEntry;
};

export function collectWorkerToolPromptEntries(
  params: CollectWorkerToolPromptEntriesParams,
): WorkerToolPromptEntry[] {
  const entries: WorkerToolPromptEntry[] = [];
  const catalogById = new Map(params.registryCatalog.map((entry) => [entry.id, entry]));

  for (const toolId of params.registryToolIds) {
    const catalog = catalogById.get(toolId);
    if (!catalog) {
      continue;
    }

    entries.push(buildRegistryToolPromptEntry(catalog));
  }

  if (params.includesRunSwarm) {
    entries.push(buildCatalogPromptEntry(params.runSwarmCatalog));
  }

  const swarmSpecsByFunction = new Map(
    (params.swarmToolPromptSpecs ?? []).map((spec) => [spec.functionName, spec]),
  );

  for (const fn of params.swarmToolFunctions) {
    const spec = swarmSpecsByFunction.get(fn.name);
    entries.push(buildSwarmFunctionPromptEntry(fn, spec, params.parentRunInput));
  }

  return entries;
}

export function buildWorkerToolsPromptBlock(
  entries: WorkerToolPromptEntry[],
  options?: { hasSwarmTools?: boolean; hasRegistryTools?: boolean },
): string | null {
  if (entries.length === 0) {
    return null;
  }

  const sections = entries.map(formatWorkerToolPromptSection);
  const hasSwarmTools = options?.hasSwarmTools === true;
  const hasRegistryTools = options?.hasRegistryTools === true;

  let intro: string;
  if (hasSwarmTools) {
    intro = [
      'You MUST call the matching sub-swarm function below before answering the user.',
      'Do not reply from your own knowledge when a sub-swarm tool applies.',
      'After the tool returns `status: done`, base your entire answer on `output` — never ignore or override it.',
    ].join(' ');
  } else if (hasRegistryTools) {
    intro = [
      'You MUST call a connected platform tool below when the user request can be fulfilled by one (e.g. search arXiv papers, web search, scrape a URL).',
      'Do not tell the user to search manually or visit websites yourself — call the tool first, then answer from its JSON result.',
    ].join(' ');
  } else {
    intro =
      'When a user request matches a tool below, call that function first — do not guess or refuse without trying the tool.';
  }

  return ['## Connected tools', '', intro, '', ...sections].join('\n');
}

function buildRegistryToolPromptEntry(catalog: ToolCatalogEntry): WorkerToolPromptEntry {
  return {
    functionName: catalog.id,
    label: catalog.name,
    description: catalog.description,
    hints: catalog.promptHints ?? fallbackHintsFromInputSchema(catalog),
  };
}

function buildCatalogPromptEntry(catalog: ToolCatalogEntry): WorkerToolPromptEntry {
  return {
    functionName: catalog.id,
    label: catalog.name,
    description: catalog.description,
    hints: catalog.promptHints ?? fallbackHintsFromInputSchema(catalog),
  };
}

function buildSwarmFunctionPromptEntry(
  fn: OpenAiFunctionToolDefinition,
  spec?: SwarmToolPromptSpec,
  parentRunInput?: Record<string, unknown>,
): WorkerToolPromptEntry {
  if (spec) {
    return {
      functionName: spec.functionName,
      label: spec.swarmName,
      description: spec.description,
      hints: buildSwarmToolPromptHints(spec, parentRunInput),
    };
  }

  const swarmId = parseSwarmIdFromToolFunctionName(fn.name);
  const label = swarmId != null ? `Swarm tool (${swarmId})` : fn.name;

  return {
    functionName: fn.name,
    label,
    description: fn.description ?? 'No description',
    hints: SWARM_TOOL_DEFAULT_HINTS,
  };
}

function fallbackHintsFromInputSchema(catalog: ToolCatalogEntry): AgentToolPromptHints {
  const required = catalog.inputSchema.required ?? [];
  const requiredSummary =
    required.length > 0
      ? `Required fields: ${required.map((field) => `"${field}"`).join(', ')}.`
      : 'Pass a JSON object matching the function schema.';

  return {
    whenToUse: `When the user request requires "${catalog.name}".`,
    inputGuide: `Call \`${catalog.id}\` with JSON args. ${requiredSummary}`,
    outputGuide: 'JSON tool result — use it directly in your answer when the call succeeds.',
  };
}

function formatWorkerToolPromptSection(entry: WorkerToolPromptEntry): string {
  return [
    `### \`${entry.functionName}\` — ${entry.label}`,
    '',
    `**What it does:** ${entry.description}`,
    '',
    `**When to call:** ${entry.hints.whenToUse}`,
    '',
    `**What to send:** ${entry.hints.inputGuide}`,
    '',
    `**Response:** ${entry.hints.outputGuide}`,
    '',
  ].join('\n');
}
