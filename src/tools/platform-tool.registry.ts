import { PlatformToolKey, ToolCover, type PlatformToolDefinition } from './types/platform-tool.types';

export const PLATFORM_TOOL_DEFINITIONS: readonly PlatformToolDefinition[] = [
  {
    catalogId: 't_01',
    key: PlatformToolKey.GMAIL,
    name: 'Gmail',
    covers: [ToolCover.SEND_MESSAGE],
    viaOpenClaw: true,
  },
  {
    catalogId: 't_02',
    key: PlatformToolKey.OUTLOOK,
    name: 'Outlook',
    covers: [ToolCover.SEND_MESSAGE],
    viaOpenClaw: true,
  },
  {
    catalogId: 't_03',
    key: PlatformToolKey.SLACK,
    name: 'Slack',
    covers: [ToolCover.SEND_MESSAGE],
    viaOpenClaw: true,
  },
  {
    catalogId: 't_04',
    key: PlatformToolKey.APOLLO,
    name: 'Apollo',
    covers: [ToolCover.CONTACT_LOOKUP, ToolCover.ENRICHMENT, ToolCover.CRM_LOOKUP],
    viaOpenClaw: true,
  },
  {
    catalogId: 't_05',
    key: PlatformToolKey.HUBSPOT,
    name: 'HubSpot CRM',
    covers: [ToolCover.CONTACT_LOOKUP, ToolCover.CRM_LOOKUP],
    viaOpenClaw: true,
  },
  {
    catalogId: 't_06',
    key: PlatformToolKey.CLEARBIT,
    name: 'Clearbit',
    covers: [ToolCover.ENRICHMENT],
    viaOpenClaw: true,
  },
  {
    catalogId: 't_07',
    key: PlatformToolKey.WEB_SEARCH,
    name: 'Web Search',
    covers: [ToolCover.WEB_SEARCH],
    viaOpenClaw: false,
  },
  {
    catalogId: 't_08',
    key: PlatformToolKey.X_TWITTER,
    name: 'X / Twitter API',
    covers: [ToolCover.X_SEARCH],
    viaOpenClaw: true,
  },
  {
    catalogId: 't_09',
    key: PlatformToolKey.GOOGLE_NEWS,
    name: 'Google News API',
    covers: [ToolCover.MONITORING, ToolCover.WEB_SEARCH],
    viaOpenClaw: true,
  },
  {
    catalogId: 't_10',
    key: PlatformToolKey.GOOGLE_SHEETS,
    name: 'Google Sheets',
    covers: [ToolCover.DATA_ANALYSIS],
    viaOpenClaw: true,
  },
  {
    catalogId: 't_11',
    key: PlatformToolKey.GOOGLE_CALENDAR,
    name: 'Google Calendar',
    covers: [ToolCover.SCHEDULING],
    viaOpenClaw: true,
  },
  {
    catalogId: 't_12',
    key: PlatformToolKey.LLM_WRITER,
    name: 'LLM Writer',
    covers: [ToolCover.CONTENT_GENERATION],
    viaOpenClaw: false,
  },
] as const;

export function isPlatformToolKey(value: string): value is PlatformToolKey {
  return Object.values(PlatformToolKey).includes(value as PlatformToolKey);
}

export function getPlatformToolDefinition(
  key: PlatformToolKey,
): PlatformToolDefinition | undefined {
  return PLATFORM_TOOL_DEFINITIONS.find((definition) => definition.key === key);
}

export function getPlatformToolDefinitionByCatalogId(
  catalogId: string,
): PlatformToolDefinition | undefined {
  return PLATFORM_TOOL_DEFINITIONS.find((definition) => definition.catalogId === catalogId);
}

/** Whether a connected tool should be dispatched via the user's Open Claw. */
export function shouldDispatchViaOpenClaw(key: PlatformToolKey): boolean {
  return getPlatformToolDefinition(key)?.viaOpenClaw ?? false;
}
