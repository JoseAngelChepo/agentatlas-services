/** Capability tags for swarm routing and agent instructions. */
export enum ToolCover {
  SEND_MESSAGE = 'send_message',
  CONTACT_LOOKUP = 'contact_lookup',
  ENRICHMENT = 'enrichment',
  CRM_LOOKUP = 'crm_lookup',
  WEB_SEARCH = 'web_search',
  X_SEARCH = 'x_search',
  MONITORING = 'monitoring',
  DATA_ANALYSIS = 'data_analysis',
  SCHEDULING = 'scheduling',
  CONTENT_GENERATION = 'content_generation',
}

export enum ToolConnectionStatus {
  MISSING = 'missing',
  CONNECTED = 'connected',
}

/** Stable internal key for a platform integration tool. */
export enum PlatformToolKey {
  GMAIL = 'gmail',
  OUTLOOK = 'outlook',
  SLACK = 'slack',
  APOLLO = 'apollo',
  HUBSPOT = 'hubspot',
  CLEARBIT = 'clearbit',
  WEB_SEARCH = 'web_search',
  X_TWITTER = 'x_twitter',
  GOOGLE_NEWS = 'google_news',
  GOOGLE_SHEETS = 'google_sheets',
  GOOGLE_CALENDAR = 'google_calendar',
  LLM_WRITER = 'llm_writer',
}

export type PlatformToolDefinition = {
  /** Short catalog id for prompts (`t_01`, `t_02`, …). */
  catalogId: string;
  key: PlatformToolKey;
  name: string;
  covers: ToolCover[];
  /**
   * Internal dispatch only — not exposed in `toolsAvailable` / catalog API responses.
   * When true, the platform routes execution through the user's Open Claw; otherwise direct.
   */
  viaOpenClaw: boolean;
};

/** Public catalog row for prompts and `runInput.toolsAvailable`. */
export type PlatformToolDescriptor = {
  id: string;
  name: string;
  covers: ToolCover[];
  status: ToolConnectionStatus;
};
