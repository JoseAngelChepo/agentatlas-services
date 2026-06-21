import { PLATFORM_TOOL_DEFINITIONS } from '../platform-tool.registry';
import {
  ToolConnectionStatus,
  type PlatformToolDescriptor,
  type PlatformToolKey,
} from '../types/platform-tool.types';

export function buildPlatformToolDescriptors(
  connectedKeys: ReadonlySet<PlatformToolKey>,
): PlatformToolDescriptor[] {
  return PLATFORM_TOOL_DEFINITIONS.map((definition) => ({
    id: definition.catalogId,
    name: definition.name,
    covers: [...definition.covers],
    status: connectedKeys.has(definition.key)
      ? ToolConnectionStatus.CONNECTED
      : ToolConnectionStatus.MISSING,
  }));
}

/** Pretty JSON for `{{runInput.toolsAvailables}}` in agent instructions. */
export function formatToolsAvailablesText(
  descriptors: ReadonlyArray<PlatformToolDescriptor>,
): string {
  if (descriptors.length === 0) {
    return '';
  }
  return JSON.stringify(descriptors, null, 2);
}
