/** Thrown when traversal stops at a user-input node (not a failure). */
export class SwarmRunPausedForInputError extends Error {
  readonly needsInputId: string;

  constructor(needsInputId: string) {
    super('Swarm run paused for user input');
    this.name = 'SwarmRunPausedForInputError';
    this.needsInputId = needsInputId;
  }
}
