/**
 * Swarm graph duration across parallel waves: each wave contributes its slowest node,
 * sequential waves add up (parallel nodes do not).
 */
export function computeLayeredDurationMs(waveMaxDurationsMs: number[]): number {
  if (!waveMaxDurationsMs.length) {
    return 0;
  }
  return waveMaxDurationsMs.reduce((sum, waveMs) => sum + Math.max(0, waveMs), 0);
}

export function maxWaveDurationMs(nodeDurationsMs: number[]): number {
  if (!nodeDurationsMs.length) {
    return 0;
  }
  return Math.max(...nodeDurationsMs.map((ms) => Math.max(0, ms)));
}
