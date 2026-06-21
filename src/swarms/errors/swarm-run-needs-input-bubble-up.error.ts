import type { SwarmRunCheckpoint } from '../types/swarm-run-checkpoint.types';
import type { SubSwarmResumeFrame } from '../types/sub-swarm-pending-input.types';

export type SwarmRunNeedsInputBubbleUpPayload = {
  question: string;
  suggestedAnswers: string[];
  passthrough: Record<string, unknown>;
  childCheckpoint: SwarmRunCheckpoint;
  childNodeId: string;
  childSwarmRunId: string;
  childSwarmId: string;
  frames: SubSwarmResumeFrame[];
};

/** Child sub-swarm hit `user_input` — pause/resume is delegated to the root parent run. */
export class SwarmRunNeedsInputBubbleUpError extends Error {
  readonly payload: SwarmRunNeedsInputBubbleUpPayload;

  constructor(payload: SwarmRunNeedsInputBubbleUpPayload) {
    super('Sub-swarm needs user input (bubble to parent)');
    this.name = 'SwarmRunNeedsInputBubbleUpError';
    this.payload = payload;
  }
}
