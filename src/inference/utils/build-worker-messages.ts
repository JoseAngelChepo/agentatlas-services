import type { AgentWorkerRunInput } from '../../swarms/context/swarm-context.types';
import type { ChatMessage } from '../types/chat-completion.types';
import { substitutePromptVariables } from './substitute-prompt-variables';

export type BuildWorkerChatMessagesOptions = {
  /** Appended to the Instructions system message when worker tools are connected. */
  toolsPromptBlock?: string | null;
};

function pushResolvedPromptMessages(
  messages: ChatMessage[],
  templates: AgentWorkerRunInput['promptMessages'],
  input: AgentWorkerRunInput,
): void {
  for (const template of templates ?? []) {
    const content = substitutePromptVariables(template.content, input).trim();
    if (content.length === 0) {
      continue;
    }
    messages.push({ role: template.role, content });
  }
}

function appendToolsPromptBlock(systemPrompt: string, toolsPromptBlock?: string | null): string {
  const appendix = toolsPromptBlock?.trim();
  if (!appendix) {
    return systemPrompt;
  }

  if (systemPrompt.trim().length === 0) {
    return appendix;
  }

  return `${systemPrompt.trimEnd()}\n\n${appendix}`;
}

/**
 * Builds chat messages for one worker run.
 *
 * 1. `systemPrompt` (Instructions) — first `system` message; optional connected-tools block appended.
 * 2. `promptMessages` — optional extra `system` / `user` entries (`{{…}}` resolved at run time).
 *
 * Use `{{goal}}`, `{{runInput.*}}`, `{{shared.*}}`, `{{upstream}}`, `{{upstream.<ref>.<field>}}`,
 * or flat `{{<field>}}` tokens where needed.
 */
export function buildWorkerChatMessages(
  input: AgentWorkerRunInput,
  options?: BuildWorkerChatMessagesOptions,
): ChatMessage[] {
  const resolvedPrompt = substitutePromptVariables(input.systemPrompt, input);
  const systemContent = appendToolsPromptBlock(resolvedPrompt, options?.toolsPromptBlock);
  const messages: ChatMessage[] = [{ role: 'system', content: systemContent }];

  pushResolvedPromptMessages(messages, input.promptMessages, input);

  return messages;
}
