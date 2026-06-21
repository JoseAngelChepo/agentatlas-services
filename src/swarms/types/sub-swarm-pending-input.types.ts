import type { Types } from 'mongoose';
import type { AgentWorker } from '../schemas/agent-worker.schema';
import type { SwarmGraph } from '../schemas/swarm-graph.schema';
import type { SwarmDocument } from '../schemas/swarm.schema';
import type { SwarmContext } from '../context/swarm-context';
import type { GraphIndex } from '../utils/graph-index';
import type { SwarmRunCheckpoint } from './swarm-run-checkpoint.types';

/** Live parent state while a sub-swarm child run is in flight. */
export type SubSwarmParentPauseContext = {
  swarm: SwarmDocument;
  graph: SwarmGraph;
  graphIndex: GraphIndex;
  context: SwarmContext;
  swarmRunId: Types.ObjectId;
  subSwarmNodeId: string;
  workers: Map<string, AgentWorker>;
  maxVisits: number;
  visitCount: Map<string, number>;
  completed: Set<string>;
  skipped: Set<string>;
  waveMaxDurationsMs: number[];
  bubbleFrames?: SubSwarmResumeFrame[];
};

/** One orchestrator frame waiting on a nested sub-swarm to finish. */
export type SubSwarmResumeFrame = {
  swarmId: string;
  swarmRunId: string;
  /** Sub-swarm graph node id in this frame's swarm. */
  subSwarmNodeId: string;
  checkpoint: SwarmRunCheckpoint;
};

export type SubSwarmPendingInput = {
  rootSubSwarmNodeId: string;
  frames: SubSwarmResumeFrame[];
  childSwarmId: string;
  childSwarmRunId: string;
  childNodeId: string;
  childCheckpoint: SwarmRunCheckpoint;
  question: string;
  suggestedAnswers: string[];
  passthrough: Record<string, unknown>;
};
