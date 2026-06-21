import type { OpenAiFunctionToolDefinition } from '../../inference/types/openai-worker-tools.types';
import type { AgentToolPromptHints } from '../../tools/types/agent-tool.interface';
import { PARENT_RUN_INPUT_TEXT_KEYS } from '../orchestrator/evaluate-swarm-node';

export type SwarmToolPromptSpec = {
  functionName: string;
  swarmId: string;
  swarmName: string;
  description: string;
  inputNames: string[];
};

export function buildSwarmToolOpenAiParameters(
  inputNames: string[],
): OpenAiFunctionToolDefinition['parameters'] {
  if (inputNames.length === 0) {
    return {
      type: 'object',
      description: 'Fields passed as the child swarm run input object',
      additionalProperties: true,
    };
  }

  const properties = Object.fromEntries(
    inputNames.map((name) => [
      name,
      {
        type: 'string',
        description: `Child swarm run input field "${name}" (Start node contract)`,
      },
    ]),
  );

  return {
    type: 'object',
    description: `Child swarm run input — fields from Start node: ${inputNames.join(', ')}`,
    properties,
    required: [...inputNames],
    additionalProperties: true,
  };
}

export function buildSwarmToolPromptHints(
  spec: Pick<SwarmToolPromptSpec, 'swarmName' | 'inputNames'>,
  parentRunInput?: Record<string, unknown>,
): AgentToolPromptHints {
  const { swarmName, inputNames } = spec;

  if (inputNames.length === 0) {
    return {
      whenToUse: `When the user request should be handled by swarm "${swarmName}" instead of answering from memory.`,
      inputGuide:
        'Call with a JSON object for the child swarm run input. Include the user request using the field names declared on the child swarm Start node.',
      outputGuide:
        'JSON with `status`, `output`, `swarmRunId`, and optional `error`. When `status` is `done`, use `output` in your reply.',
    };
  }

  const primaryField = inputNames[0];
  const examplePayload = buildExamplePayload(inputNames, parentRunInput);
  const exampleJson = JSON.stringify(examplePayload);

  const whenFields = inputNames.map((name) => `"${name}"`).join(', ');
  const passthroughNote = buildPassthroughNote(inputNames, parentRunInput);

  const inputGuideParts = [
    `This swarm expects run input fields: ${whenFields}.`,
    `Call with \`${exampleJson}\`.`,
    inputNames.length === 1
      ? `Use \`${primaryField}\` for the user's request — do not substitute \`message\` unless that is the declared field.`
      : `Put the user's main request in \`${primaryField}\`.`,
  ];

  if (passthroughNote) {
    inputGuideParts.push(passthroughNote);
  }

  return {
    whenToUse: `When the user request should be handled by swarm "${swarmName}" (fields: ${whenFields}).`,
    inputGuide: inputGuideParts.join(' '),
    outputGuide:
      'JSON with `status`, `output`, `swarmRunId`, and optional `error`. When `status` is `done`, your reply must come from `output` only.',
  };
}

function buildExamplePayload(
  inputNames: string[],
  parentRunInput?: Record<string, unknown>,
): Record<string, string> {
  const payload: Record<string, string> = {};
  const parentText = pickParentUserText(parentRunInput);

  for (const name of inputNames) {
    const direct = parentRunInput?.[name];
    if (typeof direct === 'string' && direct.trim().length > 0) {
      payload[name] = direct.trim();
      continue;
    }
    if (name === inputNames[0] && parentText) {
      payload[name] = parentText;
      continue;
    }
    payload[name] = `<${name}>`;
  }

  return payload;
}

function buildPassthroughNote(
  inputNames: string[],
  parentRunInput?: Record<string, unknown>,
): string | null {
  if (!parentRunInput) {
    return 'If you send `{}`, matching keys from the parent run input are forwarded; the primary user text fills the first declared field when missing.';
  }

  const filledFromParent = inputNames.filter((name) => {
    const value = parentRunInput[name];
    return typeof value === 'string' ? value.trim().length > 0 : value != null && value !== '';
  });

  if (filledFromParent.length > 0) {
    return `Parent run already has: ${filledFromParent.map((name) => `"${name}"`).join(', ')} — reuse those values in the tool call.`;
  }

  const parentText = pickParentUserText(parentRunInput);
  if (parentText && inputNames.length > 0) {
    return `Parent run user text will map to \`${inputNames[0]}\` when the tool args omit it.`;
  }

  return 'If you send `{}`, matching keys from the parent run input are forwarded; the primary user text fills the first declared field when missing.';
}

function pickParentUserText(parentRunInput?: Record<string, unknown>): string | undefined {
  if (!parentRunInput) {
    return undefined;
  }

  for (const key of PARENT_RUN_INPUT_TEXT_KEYS) {
    const value = parentRunInput[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return undefined;
}
