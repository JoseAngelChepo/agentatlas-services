import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { Types } from 'mongoose';
import { endSseResponse, initSseResponse, writeSseEvent } from '../../inference/utils/sse.util';
import { UserRole } from '../../users/schemas/user.schema';
import { SwarmContext } from '../context/swarm-context';
import { evaluateIfElseNode, type IfElseEvaluationDebug } from './evaluate-if-else-node';
import { evaluateWhileNode } from './evaluate-while-node';
import { buildPreviewWorkerInput, resolveWorkerInput } from './resolve-input';
import { GraphNodeKind } from '../types/graph-node-kind.enum';
import type { IfElseNodeOutput } from '../types/if-else-node.types';
import type { WhileNodeOutput } from '../types/while-node.types';
import type { UserApprovalNodeOutput } from '../types/user-approval-node.types';
import {
  IF_ELSE_ELSE_HANDLE,
  ifElseBranchHandlesMatch,
  ifElseCaseHandle,
} from '../types/if-else-node.types';
import {
  WHILE_DONE_HANDLE,
  WHILE_LOOP_HANDLE,
  DEFAULT_WHILE_MAX_ITERATIONS,
  whileBranchHandlesMatch,
} from '../types/while-node.types';
import { USER_APPROVAL_APPROVE_HANDLE } from '../types/user-approval-node.types';
import type { SwarmRunCheckpoint } from '../types/swarm-run-checkpoint.types';
import { SwarmRunPausedForApprovalError } from '../errors/swarm-run-paused-for-approval.error';
import { SwarmRunPausedForInputError } from '../errors/swarm-run-paused-for-input.error';
import { SwarmRunNeedsInputBubbleUpError } from '../errors/swarm-run-needs-input-bubble-up.error';
import {
  buildUserApprovalNodeOutput,
  resolveUserApprovalPassthrough,
} from './evaluate-user-approval-node';
import {
  buildUserInputNodeOutput,
  resolveUserInputPassthrough,
} from './evaluate-user-input-node';
import { parseUserApprovalNodeData, parseUserInputNodeData } from '../utils/graph-index';
import { SwarmRunApprovalsService } from '../services/swarm-run-approvals.service';
import { SwarmRunInputEnrichmentService } from '../services/swarm-run-input-enrichment.service';
import type { SwarmDocument } from '../schemas/swarm.schema';
import { ScraperService } from '../../scraper/scraper.service';
import { parseScraperNodeData, executeScraperNode } from './evaluate-scraper-node';
import type { ScraperNodeOutput } from '../../scraper/types/scraper-node.types';
import { SCRAPER_SUCCESS_HANDLE } from '../../scraper/types/scraper-node.types';
import {
  executeSwarmNode,
  parseSwarmNodeData,
  type ExecuteSubSwarmParams,
  type ExecuteSubSwarmResult,
} from './evaluate-swarm-node';
import type { SwarmNodeOutput } from '../types/swarm-node.types';
import { SUB_SWARM_SUCCESS_HANDLE } from '../types/swarm-node.types';
import type {
  SubSwarmParentPauseContext,
  SubSwarmPendingInput,
  SubSwarmResumeFrame,
} from '../types/sub-swarm-pending-input.types';
import { MAX_SWARM_NESTING_DEPTH } from '../utils/validate-swarm-graph-references';
import type { SwarmRunDocument } from '../schemas/swarm-run.schema';
import {
  buildGraphIndex,
  collectAllNodeIds,
  collectWorkerIdsFromGraph,
  parseIfElseNodeData,
  parseWhileNodeData,
  workerNodeIdForWorkerKey,
  type GraphIndex,
} from '../utils/graph-index';
import {
  edgeEndpointNodeId,
  normalizeGraphEdgeEndpoints,
  resolveEntryWorkerKey,
  resolveExitWorkerKey,
} from '../utils/resolve-graph-terminals';
import { resolveRunCompletion } from '../utils/resolve-run-completion';
import { evaluateEndNode, parseEndNodeData } from './evaluate-end-node';
import type { EndNodeOutput } from '../types/end-node.types';
import { dedupeSwarmGraphEdges } from '../utils/dedupe-swarm-graph-edges';
import { collectWhileLoopBodyNodeIds } from '../utils/collect-while-loop-body';
import { findStartGraphNode, listStartDownstreamNodeIds } from '../utils/start-node';
import { AgentRunsService } from '../services/agent-runs.service';
import { AgentWorkersService } from '../services/agent-workers.service';
import { SwarmAccessService } from '../services/swarm-access.service';
import { SwarmGraphsService } from '../services/swarm-graphs.service';
import { SwarmRunsService } from '../services/swarm-runs.service';
import { SwarmsService } from '../services/swarms.service';
import { GraphEdgeType } from '../types/graph-edge-type.enum';
import { RunStatus } from '../types/run-status.enum';
import { SwarmRunKind } from '../types/swarm-run-kind.enum';
import type { SwarmGraph } from '../schemas/swarm-graph.schema';
import type { AgentWorkerDocument } from '../schemas/agent-worker.schema';
import { aggregateSwarmRunStats } from '../stats/aggregate-swarm-run-stats';
import { maxWaveDurationMs } from '../stats/compute-layered-duration-ms';
import { serializeSwarmRun } from '../utils/swarm-serializers';
import type { SwarmSseEvent, SwarmTraversalStreaming } from '../types/swarm-sse-event.types';
import {
  emitNodeSkipped,
  emitWorkerStreamDone,
  emitWorkerStreamStart,
} from '../utils/swarm-sse-emit';
import {
  AGENT_WORKER_EXECUTOR,
  type AgentWorkerExecutor,
  type WorkerExecutionStreamHooks,
} from './worker-executor.interface';

const DEFAULT_MAX_NODE_VISITS = 50;

type SwarmExecutionContext = {
  depth: number;
  swarmStack: string[];
  bubbleFrames?: SubSwarmResumeFrame[];
  activeParentPause?: SubSwarmParentPauseContext;
};

type GraphScheduleState = 'done' | 'ready' | 'pending' | 'skipped';

type IncomingEdgeResolution = 'pending' | 'satisfied' | 'blocked';

export interface RunSwarmOptions {
  userId: string;
  role?: UserRole;
  input?: Record<string, unknown>;
  maxNodeVisits?: number;
}

/** When true, skips swarm access check (caller already validated or admin). */
export type RunSwarmStreamOptions = {
  skipAccessCheck?: boolean;
  /** Called after the run is finalized, before `swarm_done` is emitted. */
  onSwarmDone?: (result: {
    output: Record<string, unknown> | null;
    swarmRun: Awaited<ReturnType<SwarmRunsService['findById']>>;
  }) => Promise<void>;
};

export interface RunWorkerPreviewOptions {
  userId: string;
  role?: UserRole;
  swarmId: string;
  workerId: string;
  input?: Record<string, unknown>;
  /** Simulated predecessor outputs; defaults to `[]`. */
  upstream?: Record<string, unknown>[];
}

@Injectable()
export class SwarmOrchestratorService {
  private readonly logger = new Logger(SwarmOrchestratorService.name);

  constructor(
    private readonly swarmsService: SwarmsService,
    private readonly swarmAccessService: SwarmAccessService,
    private readonly swarmGraphsService: SwarmGraphsService,
    private readonly swarmRunsService: SwarmRunsService,
    private readonly agentRunsService: AgentRunsService,
    private readonly agentWorkersService: AgentWorkersService,
    private readonly scraperService: ScraperService,
    private readonly swarmRunApprovalsService: SwarmRunApprovalsService,
    private readonly runInputEnrichment: SwarmRunInputEnrichmentService,
    @Inject(AGENT_WORKER_EXECUTOR)
    private readonly workerExecutor: AgentWorkerExecutor,
  ) {}

  private async prepareRunInput(
    options: Pick<RunSwarmOptions, 'userId' | 'role'>,
    input?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.runInputEnrichment.enrich(
      { userId: options.userId, role: options.role },
      input ?? {},
    );
  }

  async runSwarm(swarmId: string, options: RunSwarmOptions) {
    const swarm = await this.swarmsService.findById(swarmId);
    const graph = await this.swarmGraphsService.findBySwarmId(swarmId);
    const runInput = await this.prepareRunInput(options, options.input);

    const swarmRun = await this.swarmRunsService.createRunning(
      swarm._id,
      options.userId,
      runInput,
      SwarmRunKind.SWARM,
    );

    return this.executeCreatedSwarmRun(swarm, graph, swarmRun, options);
  }

  /** Run a child swarm from an agent tool call (graph sub-swarm or standalone API). */
  async runSwarmAsAgentTool(params: {
    childSwarmId: string;
    childInput: Record<string, unknown>;
    userId: string;
    parentSwarmRunId?: string;
  }): Promise<ExecuteSubSwarmResult> {
    if (params.parentSwarmRunId) {
      const parentRun = await this.swarmRunsService.findById(params.parentSwarmRunId);
      const parentSwarm = await this.swarmsService.findById(parentRun.swarmId.toString());
      const parentExecutionContext = await this.resolveExecutionContextForRun(
        parentSwarm,
        parentRun,
      );

      return this.executeSubSwarm(
        {
          childSwarmId: params.childSwarmId,
          childInput: params.childInput,
          userId: params.userId,
          parentSwarmRunId: parentRun._id,
          parentNodeId: `agent-tool:swarm:${params.childSwarmId}`,
        },
        parentExecutionContext,
      );
    }

    await this.swarmAccessService.assertCanRun(params.userId, params.childSwarmId);

    try {
      const result = await this.runSwarm(params.childSwarmId, {
        userId: params.userId,
        input: params.childInput,
      });

      if (result.paused) {
        return {
          swarmRunId: result.swarmRun._id.toString(),
          output: null,
          status: 'paused',
          error: 'Swarm paused for human input',
        };
      }

      return {
        swarmRunId: result.swarmRun._id.toString(),
        output: result.output,
        status: 'done',
        error: null,
      };
    } catch (err) {
      return {
        swarmRunId: '',
        output: null,
        status: 'failed',
        error: err instanceof Error ? err.message : 'Swarm run failed',
      };
    }
  }

  /**
   * Creates a swarm run and executes it in the background.
   * Returns the in-flight run immediately while traversal continues asynchronously.
   */
  async startSwarmRunDetached(swarmId: string, options: RunSwarmOptions) {
    const swarm = await this.swarmsService.findById(swarmId);
    const graph = await this.swarmGraphsService.findBySwarmId(swarmId);
    const runInput = await this.prepareRunInput(options, options.input);

    const swarmRun = await this.swarmRunsService.createRunning(
      swarm._id,
      options.userId,
      runInput,
      SwarmRunKind.SWARM,
    );

    void this.executeCreatedSwarmRun(swarm, graph, swarmRun, options).catch((err) => {
      if (err instanceof SwarmRunPausedForApprovalError || err instanceof SwarmRunPausedForInputError) {
        return;
      }
      const message = err instanceof Error ? err.message : 'Detached swarm run failed';
      this.logger.error(message);
    });

    return swarmRun;
  }

  private async resolveExecutionContextForRun(
    swarm: SwarmDocument,
    swarmRun: SwarmRunDocument,
    override?: SwarmExecutionContext,
  ): Promise<SwarmExecutionContext> {
    if (override) {
      return override;
    }

    const stack: string[] = [swarm._id.toString()];
    let parentId = swarmRun.parentSwarmRunId;
    while (parentId) {
      const parentRun = await this.swarmRunsService.findById(parentId.toString());
      stack.unshift(parentRun.swarmId.toString());
      parentId = parentRun.parentSwarmRunId;
    }

    return {
      depth: swarmRun.depth ?? 0,
      swarmStack: stack,
    };
  }

  private async executeSubSwarm(
    params: ExecuteSubSwarmParams,
    parentExecutionContext: SwarmExecutionContext,
    maxNodeVisits?: number,
  ): Promise<ExecuteSubSwarmResult> {
    const childDepth = parentExecutionContext.depth + 1;
    if (childDepth > MAX_SWARM_NESTING_DEPTH) {
      return {
        swarmRunId: '',
        output: null,
        status: 'failed',
        error: `Sub-swarm nesting exceeds maximum depth of ${MAX_SWARM_NESTING_DEPTH}`,
      };
    }
    if (parentExecutionContext.swarmStack.includes(params.childSwarmId)) {
      return {
        swarmRunId: '',
        output: null,
        status: 'failed',
        error: 'Circular sub-swarm reference',
      };
    }

    await this.swarmAccessService.assertCanRun(params.userId, params.childSwarmId);
    const childSwarm = await this.swarmsService.findById(params.childSwarmId);
    const childGraph = await this.swarmGraphsService.findBySwarmId(params.childSwarmId);

    let childInput = params.childInput;
    if (params.parentNodeId.startsWith('agent-tool:')) {
      childInput = await this.prepareRunInput({ userId: params.userId }, childInput);
    }

    const childRun = await this.swarmRunsService.createRunning(
      childSwarm._id,
      params.userId,
      childInput,
      SwarmRunKind.SUB_SWARM,
      {
        parentSwarmRunId: params.parentSwarmRunId,
        parentNodeId: params.parentNodeId,
        depth: childDepth,
      },
    );

    try {
      const result = await this.executeCreatedSwarmRun(childSwarm, childGraph, childRun, {
        userId: params.userId,
        maxNodeVisits: params.maxNodeVisits ?? maxNodeVisits,
        executionContext: {
          depth: childDepth,
          swarmStack: [...parentExecutionContext.swarmStack, params.childSwarmId],
          bubbleFrames: params.parentPauseContext?.bubbleFrames,
          activeParentPause: params.parentPauseContext,
        },
      });

      if (result.paused) {
        return {
          swarmRunId: childRun._id.toString(),
          output: null,
          status: 'paused',
          error: 'Nested swarm paused for human input',
        };
      }

      return {
        swarmRunId: childRun._id.toString(),
        output: result.output,
        status: 'done',
        error: null,
      };
    } catch (err) {
      if (err instanceof SwarmRunNeedsInputBubbleUpError) {
        const parentRun = await this.swarmRunsService.findById(params.parentSwarmRunId.toString());
        if (parentRun.parentSwarmRunId) {
          throw err;
        }
        if (!params.parentPauseContext) {
          throw new BadRequestException('Sub-swarm bubble missing parent pause context');
        }
        await this.handleSubSwarmInputBubble(err, params.parentPauseContext);
      }
      if (err instanceof SwarmRunPausedForInputError) {
        throw err;
      }
      return {
        swarmRunId: childRun._id.toString(),
        output: null,
        status: 'failed',
        error: err instanceof Error ? err.message : 'Sub-swarm run failed',
      };
    }
  }

  private buildSubSwarmResumeFrame(
    pause: SubSwarmParentPauseContext,
  ): SubSwarmResumeFrame {
    return {
      swarmId: pause.swarm._id.toString(),
      swarmRunId: pause.swarmRunId.toString(),
      subSwarmNodeId: pause.subSwarmNodeId,
      checkpoint: pause.context.toCheckpoint({
        completedNodeIds: [...pause.completed],
        skippedNodeIds: [...pause.skipped],
        visitCount: pause.visitCount,
        waveMaxDurationsMs: pause.waveMaxDurationsMs,
        pendingApprovalNodeId: pause.subSwarmNodeId,
        maxVisits: pause.maxVisits,
      }),
    };
  }

  private async handleSubSwarmInputBubble(
    bubble: SwarmRunNeedsInputBubbleUpError,
    parentPause: SubSwarmParentPauseContext,
  ): Promise<never> {
    const { payload } = bubble;
    const rootSubSwarmNodeId = parentPause.subSwarmNodeId;
    const needsInputId = new Types.ObjectId().toString();

    const pendingSubSwarm: SubSwarmPendingInput = {
      rootSubSwarmNodeId,
      frames: payload.frames,
      childSwarmId: payload.childSwarmId,
      childSwarmRunId: payload.childSwarmRunId,
      childNodeId: payload.childNodeId,
      childCheckpoint: payload.childCheckpoint,
      question: payload.question,
      suggestedAnswers: payload.suggestedAnswers,
      passthrough: payload.passthrough,
    };

    const parentCheckpoint = parentPause.context.toCheckpoint({
      completedNodeIds: [...parentPause.completed],
      skippedNodeIds: [...parentPause.skipped],
      visitCount: parentPause.visitCount,
      waveMaxDurationsMs: parentPause.waveMaxDurationsMs,
      pendingApprovalNodeId: rootSubSwarmNodeId,
      pendingNeedsInputNodeId: rootSubSwarmNodeId,
      pendingSubSwarm,
      maxVisits: parentPause.maxVisits,
    });

    await this.swarmRunsService.pauseForInput(
      parentPause.swarmRunId,
      parentCheckpoint,
      needsInputId,
    );

    await this.swarmRunsService.pauseForInput(
      new Types.ObjectId(payload.childSwarmRunId),
      payload.childCheckpoint,
      `bubble:${needsInputId}`,
    );

    throw new SwarmRunPausedForInputError(needsInputId);
  }

  private async executeCreatedSwarmRun(
    swarm: Awaited<ReturnType<SwarmsService['findById']>>,
    graph: Awaited<ReturnType<SwarmGraphsService['findBySwarmId']>>,
    swarmRun: Awaited<ReturnType<SwarmRunsService['createRunning']>>,
    options: {
      userId: string;
      maxNodeVisits?: number;
      executionContext?: SwarmExecutionContext;
    },
  ) {
    const context = new SwarmContext({
      goal: swarm.goal,
      swarmRunId: swarmRun._id,
      runInput: (swarmRun.input as Record<string, unknown>) ?? {},
    });

    const maxVisits = options.maxNodeVisits ?? DEFAULT_MAX_NODE_VISITS;
    const visitCount = new Map<string, number>();
    const waveMaxDurationsMs: number[] = [];
    const executionContext = await this.resolveExecutionContextForRun(
      swarm,
      swarmRun,
      options.executionContext,
    );

    try {
      const graphIndex = buildGraphIndex(graph);
      const workers = await this.agentWorkersService.findByIds(collectWorkerIdsFromGraph(graph));

      const finalOutput = await this.traverseGraph({
        swarm,
        graph,
        graphIndex,
        context,
        swarmRunId: swarmRun._id,
        userId: options.userId,
        workers,
        maxVisits,
        visitCount,
        waveMaxDurationsMs,
        executionContext,
      });

      const finished = await this.finalizeSwarmRun(
        swarmRun._id,
        finalOutput,
        waveMaxDurationsMs,
        RunStatus.DONE,
      );
      await this.swarmRunsService.clearCheckpoint(swarmRun._id);

      return { swarmRun: finished, output: finalOutput, paused: false as const };
    } catch (err) {
      if (err instanceof SwarmRunNeedsInputBubbleUpError) {
        throw err;
      }
      if (err instanceof SwarmRunPausedForApprovalError) {
        const pausedRun = await this.swarmRunsService.findById(swarmRun._id.toString());
        return {
          swarmRun: pausedRun,
          output: null,
          paused: true as const,
          approval: err.approval,
        };
      }
      if (err instanceof SwarmRunPausedForInputError) {
        const pausedRun = await this.swarmRunsService.findById(swarmRun._id.toString());
        return {
          swarmRun: pausedRun,
          output: null,
          paused: true as const,
          needsInputId: err.needsInputId,
        };
      }
      const message = err instanceof Error ? err.message : 'Swarm run failed';
      this.logger.error(message);
      await this.finalizeSwarmRun(
        swarmRun._id,
        null,
        waveMaxDurationsMs,
        RunStatus.FAILED,
        message,
      );
      throw err;
    }
  }

  /**
   * Continues a run paused at a user-approval node after `SwarmRunApprovalsService.decide`.
   */
  async resumeAfterApproval(
    approvalId: string,
    userId: string,
    options?: { skipAccessCheck?: boolean },
  ) {
    const approval = await this.swarmRunApprovalsService.findById(approvalId);
    if (!approval.decision) {
      throw new BadRequestException('Approval must be decided before resume');
    }

    const swarmRun = await this.swarmRunsService.findById(approval.swarmRunId.toString());
    if (swarmRun.status !== RunStatus.AWAITING_APPROVAL || !swarmRun.checkpoint) {
      throw new BadRequestException('Swarm run is not awaiting approval');
    }

    if (!options?.skipAccessCheck) {
      await this.swarmAccessService.assertCanRun(userId, swarmRun.swarmId.toString());
    }

    const swarm = await this.swarmsService.findById(swarmRun.swarmId.toString());
    const graph = await this.swarmGraphsService.findBySwarmId(swarmRun.swarmId.toString());
    const checkpoint = swarmRun.checkpoint as unknown as SwarmRunCheckpoint;
    const context = SwarmContext.fromCheckpoint(checkpoint, swarmRun._id);
    const graphIndex = buildGraphIndex(graph);
    const workers = await this.agentWorkersService.findByIds(collectWorkerIdsFromGraph(graph));

    const nodeOutput = buildUserApprovalNodeOutput({
      decision: approval.decision,
      approvalId: approval.id,
      name: approval.name,
      message: approval.message,
      comment: approval.comment,
      passthrough: approval.passthrough ?? {},
    });

    const completed = new Set(checkpoint.completedNodeIds);
    const skipped = new Set(checkpoint.skippedNodeIds);
    const visitCount = new Map<string, number>(Object.entries(checkpoint.visitCount));
    const waveMaxDurationsMs = [...checkpoint.waveMaxDurationsMs];

    context.setNodeOutput(checkpoint.pendingApprovalNodeId, nodeOutput);
    completed.add(checkpoint.pendingApprovalNodeId);

    const normalizedEdges = normalizeGraphEdgeEndpoints(graph, graphIndex);
    this.finalizeBranchRouting(
      checkpoint.pendingApprovalNodeId,
      nodeOutput.branchHandle,
      normalizedEdges,
      skipped,
      graphIndex,
    );

    await this.swarmRunsService.markRunningAfterApproval(swarmRun._id);

    const executionContext = await this.resolveExecutionContextForRun(swarm, swarmRun);

    try {
      const finalOutput = await this.traverseGraph({
        swarm,
        graph,
        graphIndex,
        context,
        swarmRunId: swarmRun._id,
        userId,
        workers,
        maxVisits: checkpoint.maxVisits,
        visitCount,
        waveMaxDurationsMs,
        executionContext,
        resume: { completed, skipped },
      });

      const finished = await this.finalizeSwarmRun(
        swarmRun._id,
        finalOutput,
        waveMaxDurationsMs,
        RunStatus.DONE,
      );
      await this.swarmRunsService.clearCheckpoint(swarmRun._id);

      return { swarmRun: finished, output: finalOutput, paused: false as const };
    } catch (err) {
      if (err instanceof SwarmRunPausedForApprovalError) {
        const pausedRun = await this.swarmRunsService.findById(swarmRun._id.toString());
        return {
          swarmRun: pausedRun,
          output: null,
          paused: true as const,
          approval: err.approval,
        };
      }
      if (err instanceof SwarmRunPausedForInputError) {
        const pausedRun = await this.swarmRunsService.findById(swarmRun._id.toString());
        return {
          swarmRun: pausedRun,
          output: null,
          paused: true as const,
          needsInputId: err.needsInputId,
        };
      }
      const message = err instanceof Error ? err.message : 'Swarm run failed';
      this.logger.error(message);
      await this.finalizeSwarmRun(
        swarmRun._id,
        null,
        waveMaxDurationsMs,
        RunStatus.FAILED,
        message,
      );
      throw err;
    }
  }

  /**
   * Continues a run paused at a user-input node after `POST /needs-input/:id/answer|skip`.
   */
  async resumeAfterNeedsInput(
    needsInputId: string,
    userId: string,
    params: {
      question: string;
      answer: string | null;
      skipped: boolean;
      passthrough: Record<string, unknown>;
      nodeId: string;
    },
    options?: { skipAccessCheck?: boolean },
  ) {
    const swarmRun = await this.swarmRunsService.findByPendingNeedsInputId(needsInputId);
    if (swarmRun.pendingNeedsInputId !== needsInputId) {
      throw new BadRequestException('Needs input does not match the paused swarm run');
    }
    if (swarmRun.status !== RunStatus.AWAITING_INPUT || !swarmRun.checkpoint) {
      throw new BadRequestException('Swarm run is not awaiting input');
    }

    if (!options?.skipAccessCheck) {
      await this.swarmAccessService.assertCanRun(userId, swarmRun.swarmId.toString());
    }

    const swarm = await this.swarmsService.findById(swarmRun.swarmId.toString());
    const graph = await this.swarmGraphsService.findBySwarmId(swarmRun.swarmId.toString());
    const checkpoint = swarmRun.checkpoint as unknown as SwarmRunCheckpoint;

    if (checkpoint.pendingSubSwarm) {
      return this.resumeAfterSubSwarmBubbledInput(
        needsInputId,
        userId,
        params,
        swarmRun,
        swarm,
        graph,
        checkpoint,
        options,
      );
    }

    const nodeId = params.nodeId || checkpoint.pendingNeedsInputNodeId || checkpoint.pendingApprovalNodeId;
    const context = SwarmContext.fromCheckpoint(checkpoint, swarmRun._id);
    const graphIndex = buildGraphIndex(graph);
    const workers = await this.agentWorkersService.findByIds(collectWorkerIdsFromGraph(graph));

    const nodeOutput = buildUserInputNodeOutput({
      needsInputId,
      question: params.question,
      answer: params.answer,
      skipped: params.skipped,
      passthrough: params.passthrough,
    });

    const completed = new Set(checkpoint.completedNodeIds);
    const skippedNodes = new Set(checkpoint.skippedNodeIds);
    const visitCount = new Map<string, number>(Object.entries(checkpoint.visitCount));
    const waveMaxDurationsMs = [...checkpoint.waveMaxDurationsMs];

    context.setNodeOutput(nodeId, nodeOutput);
    completed.add(nodeId);

    await this.swarmRunsService.markRunningAfterInput(swarmRun._id);

    const executionContext = await this.resolveExecutionContextForRun(swarm, swarmRun);

    try {
      const finalOutput = await this.traverseGraph({
        swarm,
        graph,
        graphIndex,
        context,
        swarmRunId: swarmRun._id,
        userId,
        workers,
        maxVisits: checkpoint.maxVisits,
        visitCount,
        waveMaxDurationsMs,
        executionContext,
        resume: { completed, skipped: skippedNodes },
      });

      const finished = await this.finalizeSwarmRun(
        swarmRun._id,
        finalOutput,
        waveMaxDurationsMs,
        RunStatus.DONE,
      );
      await this.swarmRunsService.clearCheckpoint(swarmRun._id);

      return { swarmRun: finished, output: finalOutput, paused: false as const };
    } catch (err) {
      if (err instanceof SwarmRunPausedForApprovalError) {
        const pausedRun = await this.swarmRunsService.findById(swarmRun._id.toString());
        return {
          swarmRun: pausedRun,
          output: null,
          paused: true as const,
          approval: err.approval,
        };
      }
      if (err instanceof SwarmRunPausedForInputError) {
        const pausedRun = await this.swarmRunsService.findById(swarmRun._id.toString());
        return {
          swarmRun: pausedRun,
          output: null,
          paused: true as const,
          needsInputId: err.needsInputId,
        };
      }
      const message = err instanceof Error ? err.message : 'Swarm run failed';
      this.logger.error(message);
      await this.finalizeSwarmRun(
        swarmRun._id,
        null,
        waveMaxDurationsMs,
        RunStatus.FAILED,
        message,
      );
      throw err;
    }
  }

  /**
   * Runs a single worker for the workspace inspector (no graph traversal).
   * Persists a {@link SwarmRunKind.WORKER_PREVIEW} run with one linked agent_run.
   */
  async runWorkerPreview(options: RunWorkerPreviewOptions) {
    const swarm = await this.swarmsService.findByIdForUser(options.userId, options.swarmId);
    const workerObjectId = new Types.ObjectId(options.workerId);
    const worker = await this.agentWorkersService.findByIdForUser(
      options.userId,
      options.workerId,
    );

    const preparedInput = await this.prepareRunInput(options, options.input);

    const swarmRun = await this.swarmRunsService.createRunning(
      swarm._id,
      options.userId,
      preparedInput,
      SwarmRunKind.WORKER_PREVIEW,
    );

    const context = new SwarmContext({
      goal: swarm.goal,
      swarmRunId: swarmRun._id,
      runInput: (swarmRun.input as Record<string, unknown>) ?? preparedInput,
    });

    const runInput = buildPreviewWorkerInput(worker, context, options.upstream ?? []);

    const waveMaxDurationsMs: number[] = [];

    try {
      const workerStarted = Date.now();
      const result = await this.executeWithTimeout(
        workerObjectId,
        swarmRun._id,
        runInput,
        worker.timeoutMs,
      );
      waveMaxDurationsMs.push(Date.now() - workerStarted);
      await this.swarmRunsService.appendAgentRun(swarmRun._id, result.agentRunId);

      const finished = await this.finalizeSwarmRun(
        swarmRun._id,
        result.output,
        waveMaxDurationsMs,
        RunStatus.DONE,
      );

      return {
        swarmRun: finished,
        output: result.output,
        agentRunId: result.agentRunId.toString(),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Worker preview failed';
      this.logger.error(message);
      await this.finalizeSwarmRun(
        swarmRun._id,
        null,
        waveMaxDurationsMs,
        RunStatus.FAILED,
        message,
      );
      throw err;
    }
  }

  /**
   * SSE stream for the workspace test panel (`text/event-stream`).
   * Events: `swarm_start`, `node_start`, `node_done`, `node_skipped`, `worker_start`, `worker_meta`, `delta`, `worker_done`, `approval_required`, `swarm_done`, `error`.
   */
  async runSwarmStream(
    swarmId: string,
    options: RunSwarmOptions,
    res: Response,
    streamOptions?: RunSwarmStreamOptions,
  ): Promise<void> {
    initSseResponse(res);
    let swarmRunId: Types.ObjectId | null = null;
    const waveMaxDurationsMs: number[] = [];

    const emit = (event: SwarmSseEvent) => writeSseEvent(res, event);

    try {
      if (!streamOptions?.skipAccessCheck) {
        await this.swarmAccessService.assertCanRun(options.userId, swarmId);
      }
      const swarm = await this.swarmsService.findById(swarmId);
      const graph = await this.swarmGraphsService.findBySwarmId(swarmId);

      const preparedInput = await this.prepareRunInput(options, options.input);

      const swarmRun = await this.swarmRunsService.createRunning(
        swarm._id,
        options.userId,
        preparedInput,
        SwarmRunKind.SWARM,
      );
      swarmRunId = swarmRun._id;

      emit({
        type: 'swarm_start',
        swarmId,
        swarmRunId: swarmRunId.toString(),
        runKind: 'swarm',
      });

      const context = new SwarmContext({
        goal: swarm.goal,
        swarmRunId: swarmRun._id,
        runInput: (swarmRun.input as Record<string, unknown>) ?? preparedInput,
      });

      const maxVisits = options.maxNodeVisits ?? DEFAULT_MAX_NODE_VISITS;
      const visitCount = new Map<string, number>();
      const graphIndex = buildGraphIndex(graph);
      const workers = await this.agentWorkersService.findByIds(collectWorkerIdsFromGraph(graph));
      let step = 0;
      const nextStep = () => {
        step += 1;
        return step;
      };

      const executionContext = await this.resolveExecutionContextForRun(swarm, swarmRun);

      const finalOutput = await this.traverseGraph({
        swarm,
        graph,
        graphIndex,
        context,
        swarmRunId: swarmRun._id,
        userId: options.userId,
        workers,
        maxVisits,
        visitCount,
        waveMaxDurationsMs,
        executionContext,
        streaming: {
          nextStep,
          emit,
          execute: this.buildStreamingWorkerExecute({
            emit,
            nextStep,
            graph,
            graphIndex,
            context,
            workers,
            swarmRunId: swarmRun._id,
          }),
        },
      });
      const finished = await this.finalizeSwarmRun(
        swarmRun._id,
        finalOutput,
        waveMaxDurationsMs,
        RunStatus.DONE,
      );
      await this.swarmRunsService.clearCheckpoint(swarmRun._id);

      if (streamOptions?.onSwarmDone) {
        await streamOptions.onSwarmDone({ output: finalOutput, swarmRun: finished });
      }

      emit({
        type: 'swarm_done',
        swarmRun: serializeSwarmRun(finished) as Record<string, unknown>,
        output: finalOutput,
        durationMs: finished.durationMs,
        promptTokens: finished.promptTokens,
        completionTokens: finished.completionTokens,
        totalTokens: finished.totalTokens,
        costUsd: finished.costUsd,
        scrapeCostUsd: finished.scrapeCostUsd,
        totalCostUsd: finished.totalCostUsd,
      });
      endSseResponse(res);
    } catch (err) {
      if (err instanceof SwarmRunPausedForApprovalError) {
        emit({
          type: 'approval_required',
          approvalId: err.approval.id,
          swarmRunId: err.approval.swarmRunId,
          swarmId: err.approval.swarmId,
          nodeId: err.approval.nodeId,
          name: err.approval.name,
          message: err.approval.message,
          passthrough: err.approval.passthrough,
          assigneeUserId: err.approval.assigneeUserId,
        });
        endSseResponse(res);
        return;
      }
      const message = err instanceof Error ? err.message : 'Swarm run failed';
      this.logger.error(message);
      if (swarmRunId) {
        await this.finalizeSwarmRun(swarmRunId, null, waveMaxDurationsMs, RunStatus.FAILED, message).catch(
          () => undefined,
        );
      }
      emit({ type: 'error', message });
      endSseResponse(res);
    }
  }

  /**
   * SSE continuation after `SwarmRunApprovalsService.decide` — same events as `runSwarmStream`.
   */
  async resumeAfterApprovalStream(
    approvalId: string,
    userId: string,
    res: Response,
    options?: { skipAccessCheck?: boolean },
  ): Promise<void> {
    initSseResponse(res);
    const emit = (event: SwarmSseEvent) => writeSseEvent(res, event);
    let swarmRunId: Types.ObjectId | null = null;
    const waveMaxDurationsMs: number[] = [];

    try {
      const approval = await this.swarmRunApprovalsService.findById(approvalId);
      if (!approval.decision) {
        throw new BadRequestException('Approval must be decided before resume');
      }

      const swarmRun = await this.swarmRunsService.findById(approval.swarmRunId.toString());
      if (swarmRun.status !== RunStatus.AWAITING_APPROVAL || !swarmRun.checkpoint) {
        throw new BadRequestException('Swarm run is not awaiting approval');
      }
      swarmRunId = swarmRun._id;

      if (!options?.skipAccessCheck) {
        await this.swarmAccessService.assertCanRun(userId, swarmRun.swarmId.toString());
      }

      const swarm = await this.swarmsService.findById(swarmRun.swarmId.toString());
      const graph = await this.swarmGraphsService.findBySwarmId(swarmRun.swarmId.toString());
      const checkpoint = swarmRun.checkpoint as unknown as SwarmRunCheckpoint;
      const context = SwarmContext.fromCheckpoint(checkpoint, swarmRun._id);
      const graphIndex = buildGraphIndex(graph);
      const workers = await this.agentWorkersService.findByIds(collectWorkerIdsFromGraph(graph));

      const nodeOutput = buildUserApprovalNodeOutput({
        decision: approval.decision,
        approvalId: approval.id,
        name: approval.name,
        message: approval.message,
        comment: approval.comment,
        passthrough: approval.passthrough ?? {},
      });

      const completed = new Set(checkpoint.completedNodeIds);
      const skipped = new Set(checkpoint.skippedNodeIds);
      const visitCount = new Map<string, number>(Object.entries(checkpoint.visitCount));
      waveMaxDurationsMs.push(...checkpoint.waveMaxDurationsMs);

      context.setNodeOutput(checkpoint.pendingApprovalNodeId, nodeOutput);
      completed.add(checkpoint.pendingApprovalNodeId);

      const normalizedEdges = normalizeGraphEdgeEndpoints(graph, graphIndex);
      this.finalizeBranchRouting(
        checkpoint.pendingApprovalNodeId,
        nodeOutput.branchHandle,
        normalizedEdges,
        skipped,
        graphIndex,
      );

      await this.swarmRunsService.markRunningAfterApproval(swarmRun._id);

      let step = completed.size;
      const nextStep = () => {
        step += 1;
        return step;
      };

      emit({
        type: 'node_done',
        nodeId: checkpoint.pendingApprovalNodeId,
        nodeKind: 'user_approval',
        nodeName: approval.name,
        step: nextStep(),
        wave: 0,
        output: nodeOutput as unknown as Record<string, unknown>,
        latencyMs: 0,
      });

      const executionContext = await this.resolveExecutionContextForRun(swarm, swarmRun);

      const finalOutput = await this.traverseGraph({
        swarm,
        graph,
        graphIndex,
        context,
        swarmRunId: swarmRun._id,
        userId,
        workers,
        maxVisits: checkpoint.maxVisits,
        visitCount,
        waveMaxDurationsMs,
        executionContext,
        resume: { completed, skipped },
        streaming: {
          nextStep,
          emit,
          execute: this.buildStreamingWorkerExecute({
            emit,
            nextStep,
            graph,
            graphIndex,
            context,
            workers,
            swarmRunId: swarmRun._id,
          }),
        },
      });

      const finished = await this.finalizeSwarmRun(
        swarmRun._id,
        finalOutput,
        waveMaxDurationsMs,
        RunStatus.DONE,
      );
      await this.swarmRunsService.clearCheckpoint(swarmRun._id);

      emit({
        type: 'swarm_done',
        swarmRun: serializeSwarmRun(finished) as Record<string, unknown>,
        output: finalOutput,
        durationMs: finished.durationMs,
        promptTokens: finished.promptTokens,
        completionTokens: finished.completionTokens,
        totalTokens: finished.totalTokens,
        costUsd: finished.costUsd,
        scrapeCostUsd: finished.scrapeCostUsd,
        totalCostUsd: finished.totalCostUsd,
      });
      endSseResponse(res);
    } catch (err) {
      if (err instanceof SwarmRunPausedForApprovalError) {
        emit({
          type: 'approval_required',
          approvalId: err.approval.id,
          swarmRunId: err.approval.swarmRunId,
          swarmId: err.approval.swarmId,
          nodeId: err.approval.nodeId,
          name: err.approval.name,
          message: err.approval.message,
          passthrough: err.approval.passthrough,
          assigneeUserId: err.approval.assigneeUserId,
        });
        endSseResponse(res);
        return;
      }
      const message = err instanceof Error ? err.message : 'Swarm run failed';
      this.logger.error(message);
      if (swarmRunId) {
        await this.finalizeSwarmRun(swarmRunId, null, waveMaxDurationsMs, RunStatus.FAILED, message).catch(
          () => undefined,
        );
      }
      emit({ type: 'error', message });
      endSseResponse(res);
    }
  }

  async runWorkerPreviewStream(
    options: RunWorkerPreviewOptions,
    res: Response,
  ): Promise<void> {
    initSseResponse(res);
    let swarmRunId: Types.ObjectId | null = null;
    const waveMaxDurationsMs: number[] = [];

    const emit = (event: SwarmSseEvent) => writeSseEvent(res, event);

    try {
      const swarm = await this.swarmsService.findByIdForUser(options.userId, options.swarmId);
      const workerObjectId = new Types.ObjectId(options.workerId);
      const worker = await this.agentWorkersService.findByIdForUser(
        options.userId,
        options.workerId,
      );

      const preparedInput = await this.prepareRunInput(options, options.input);

      const swarmRun = await this.swarmRunsService.createRunning(
        swarm._id,
        options.userId,
        preparedInput,
        SwarmRunKind.WORKER_PREVIEW,
      );
      swarmRunId = swarmRun._id;

      emit({
        type: 'swarm_start',
        swarmId: options.swarmId,
        swarmRunId: swarmRunId.toString(),
        runKind: 'worker_preview',
      });

      const previewNodeId = options.workerId;
      const previewWave = 1;
      const previewStep = 1;

      emitWorkerStreamStart(emit, {
        nodeId: previewNodeId,
        workerId: options.workerId,
        workerName: worker.name,
        step: previewStep,
        wave: previewWave,
      });

      const context = new SwarmContext({
        goal: swarm.goal,
        swarmRunId: swarmRun._id,
        runInput: (swarmRun.input as Record<string, unknown>) ?? preparedInput,
      });

      const runInput = buildPreviewWorkerInput(worker, context, options.upstream ?? []);
      const workerStarted = Date.now();

      const result = await this.runWorkerExecutionStreaming(
        workerObjectId,
        swarmRun._id,
        runInput,
        worker.timeoutMs,
        {
          onMeta: (meta) => {
            emit({
              type: 'worker_meta',
              nodeId: previewNodeId,
              workerId: options.workerId,
              provider: meta.provider,
              model: meta.model,
              baseURL: meta.baseURL,
              wave: previewWave,
            });
          },
          onDelta: (delta) => {
            emit({
              type: 'delta',
              nodeId: previewNodeId,
              workerId: options.workerId,
              delta,
              wave: previewWave,
            });
          },
        },
      );

      waveMaxDurationsMs.push(Date.now() - workerStarted);
      await this.swarmRunsService.appendAgentRun(swarmRun._id, result.agentRunId);

      emitWorkerStreamDone(emit, {
        nodeId: previewNodeId,
        workerId: options.workerId,
        workerName: worker.name,
        step: previewStep,
        wave: previewWave,
        agentRunId: result.agentRunId.toString(),
        output: result.output,
        latencyMs: Date.now() - workerStarted,
        inferenceRequest: runInput,
        inference: result.inference,
        messages: result.messages,
      });

      const finished = await this.finalizeSwarmRun(
        swarmRun._id,
        result.output,
        waveMaxDurationsMs,
        RunStatus.DONE,
      );

      emit({
        type: 'swarm_done',
        swarmRun: serializeSwarmRun(finished) as Record<string, unknown>,
        output: result.output,
        durationMs: finished.durationMs,
        promptTokens: finished.promptTokens,
        completionTokens: finished.completionTokens,
        totalTokens: finished.totalTokens,
        costUsd: finished.costUsd,
        scrapeCostUsd: finished.scrapeCostUsd,
        totalCostUsd: finished.totalCostUsd,
      });
      endSseResponse(res);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Worker preview failed';
      this.logger.error(message);
      if (swarmRunId) {
        await this.finalizeSwarmRun(swarmRunId, null, waveMaxDurationsMs, RunStatus.FAILED, message).catch(
          () => undefined,
        );
      }
      emit({ type: 'error', message });
      endSseResponse(res);
    }
  }

  private buildStreamingWorkerExecute(params: {
    emit: (event: SwarmSseEvent) => void;
    nextStep: () => number;
    graph: SwarmGraph;
    graphIndex: GraphIndex;
    context: SwarmContext;
    workers: Map<string, AgentWorkerDocument>;
    swarmRunId: Types.ObjectId;
  }): SwarmTraversalStreaming['execute'] {
    return async (nodeId, workerId, worker, wave) => {
      const workerKey = workerId.toString();
      const step = params.nextStep();

      emitWorkerStreamStart(params.emit, {
        nodeId,
        workerId: workerKey,
        workerName: worker.name,
        step,
        wave,
      });

      const workerStarted = Date.now();
      const runInput = resolveWorkerInput(
        workerId,
        worker,
        params.graph,
        params.context,
        params.workers,
        params.graphIndex,
      );
      const result = await this.runWorkerExecutionStreaming(
        workerId,
        params.swarmRunId,
        runInput,
        worker.timeoutMs,
        {
          onMeta: (meta) => {
            params.emit({
              type: 'worker_meta',
              nodeId,
              workerId: workerKey,
              provider: meta.provider,
              model: meta.model,
              baseURL: meta.baseURL,
              wave,
            });
          },
          onDelta: (delta) => {
            params.emit({
              type: 'delta',
              nodeId,
              workerId: workerKey,
              delta,
              wave,
            });
          },
        },
      );

      await this.swarmRunsService.appendAgentRun(params.swarmRunId, result.agentRunId);

      emitWorkerStreamDone(params.emit, {
        nodeId,
        workerId: workerKey,
        workerName: worker.name,
        step,
        wave,
        agentRunId: result.agentRunId.toString(),
        output: result.output,
        latencyMs: Date.now() - workerStarted,
        inferenceRequest: runInput,
        inference: result.inference,
        messages: result.messages,
      });

      return result.output;
    };
  }

  private async finalizeSwarmRun(
    swarmRunId: Types.ObjectId,
    output: Record<string, unknown> | null,
    waveMaxDurationsMs: number[],
    status: RunStatus.DONE | RunStatus.FAILED,
    failureReason = '',
  ) {
    const [agentRuns, scrapeRequests] = await Promise.all([
      this.agentRunsService.findBySwarmRun(swarmRunId),
      this.scraperService.findBySwarmRun(swarmRunId),
    ]);
    const stats = aggregateSwarmRunStats({ waveMaxDurationsMs, agentRuns, scrapeRequests });
    return this.swarmRunsService.finish(swarmRunId, output, stats, status, failureReason);
  }

  private async runWorkerExecutionStreaming(
    workerId: Types.ObjectId,
    swarmRunId: Types.ObjectId,
    input: ReturnType<typeof resolveWorkerInput>,
    timeoutMs: number,
    hooks: WorkerExecutionStreamHooks,
  ) {
    const executor = this.workerExecutor as AgentWorkerExecutor;
    if (executor.executeStreaming) {
      return this.executeWithTimeoutStreaming(
        workerId,
        swarmRunId,
        input,
        timeoutMs,
        hooks,
        executor,
      );
    }
    return this.executeWithTimeout(workerId, swarmRunId, input, timeoutMs);
  }

  private executeWithTimeoutStreaming(
    workerId: Types.ObjectId,
    swarmRunId: Types.ObjectId,
    input: ReturnType<typeof resolveWorkerInput>,
    timeoutMs: number,
    hooks: WorkerExecutionStreamHooks,
    executor: AgentWorkerExecutor,
  ) {
    return new Promise<Awaited<ReturnType<AgentWorkerExecutor['execute']>>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Worker timeout')), timeoutMs);
      executor
        .executeStreaming!(workerId, swarmRunId, input, hooks)
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  private async runWorkerWithRetries(
    workerId: Types.ObjectId,
    worker: AgentWorkerDocument,
    graph: SwarmGraph,
    graphIndex: GraphIndex,
    context: SwarmContext,
    swarmRunId: Types.ObjectId,
    workers: Map<string, AgentWorkerDocument>,
  ): Promise<Record<string, unknown>> {
    const input = resolveWorkerInput(workerId, worker, graph, context, workers, graphIndex);
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= worker.maxRetries; attempt++) {
      try {
        const result = await this.executeWithTimeout(
          workerId,
          swarmRunId,
          input,
          worker.timeoutMs,
        );
        await this.swarmRunsService.appendAgentRun(swarmRunId, result.agentRunId);
        return result.output;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        this.logger.warn(
          `Worker ${workerId.toString()} attempt ${attempt + 1} failed: ${lastError.message}`,
        );
      }
    }

    throw lastError ?? new Error('Worker execution failed');
  }

  private executeWithTimeout(
    workerId: Types.ObjectId,
    swarmRunId: Types.ObjectId,
    input: ReturnType<typeof resolveWorkerInput>,
    timeoutMs: number,
  ) {
    return new Promise<Awaited<ReturnType<AgentWorkerExecutor['execute']>>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Worker timeout')), timeoutMs);
      this.workerExecutor
        .execute(workerId, swarmRunId, input)
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  /**
   * Walks the graph in waves: a node runs only after every incoming edge is satisfied (join).
   * All ready nodes in a wave run concurrently via Promise.all (fork).
   */
  private async pauseForUserApproval(params: {
    swarm: SwarmDocument;
    graph: SwarmGraph;
    graphIndex: GraphIndex;
    context: SwarmContext;
    swarmRunId: Types.ObjectId;
    userId: string;
    workers: Map<string, AgentWorkerDocument>;
    nodeId: string;
    nodeData: Record<string, unknown> | undefined;
    maxVisits: number;
    visitCount: Map<string, number>;
    completed: Set<string>;
    skipped: Set<string>;
    waveMaxDurationsMs: number[];
  }): Promise<never> {
    const passthrough = resolveUserApprovalPassthrough(
      params.graph,
      params.graphIndex,
      params.context,
      params.nodeId,
      params.workers,
    );
    const data = parseUserApprovalNodeData(params.nodeData);
    const approval = await this.swarmRunApprovalsService.createPending({
      swarmRunId: params.swarmRunId,
      swarm: params.swarm,
      nodeId: params.nodeId,
      nodeData: params.nodeData,
      passthrough,
      triggeredBy: params.userId,
    });
    const checkpoint = params.context.toCheckpoint({
      completedNodeIds: [...params.completed],
      skippedNodeIds: [...params.skipped],
      visitCount: params.visitCount,
      waveMaxDurationsMs: params.waveMaxDurationsMs,
      pendingApprovalNodeId: params.nodeId,
      maxVisits: params.maxVisits,
    });
    await this.swarmRunsService.pauseForApproval(
      params.swarmRunId,
      checkpoint,
      approval._id,
    );
    throw new SwarmRunPausedForApprovalError(
      this.swarmRunApprovalsService.serialize(approval),
    );
  }

  private async resumeAfterSubSwarmBubbledInput(
    needsInputId: string,
    userId: string,
    params: {
      question: string;
      answer: string | null;
      skipped: boolean;
      passthrough: Record<string, unknown>;
      nodeId: string;
    },
    swarmRun: SwarmRunDocument,
    swarm: SwarmDocument,
    graph: SwarmGraph,
    checkpoint: SwarmRunCheckpoint,
    options?: { skipAccessCheck?: boolean },
  ) {
    const pending = checkpoint.pendingSubSwarm!;
    let nestedOutput = await this.resumeChildSwarmAtUserInput(
      pending,
      needsInputId,
      userId,
      params,
    );
    let nestedSwarmId = pending.childSwarmId;
    let nestedRunId = pending.childSwarmRunId;

    for (let index = pending.frames.length - 1; index >= 0; index -= 1) {
      const frame = pending.frames[index];
      if (!frame) {
        continue;
      }
      nestedOutput = await this.finishSubSwarmFrameAndContinue(
        frame,
        nestedOutput,
        userId,
        nestedSwarmId,
        nestedRunId,
      );
      nestedSwarmId = frame.swarmId;
      nestedRunId = frame.swarmRunId;
    }

    const childOutput = nestedOutput;

    const context = SwarmContext.fromCheckpoint(checkpoint, swarmRun._id);
    const graphIndex = buildGraphIndex(graph);
    const workers = await this.agentWorkersService.findByIds(collectWorkerIdsFromGraph(graph));
    const completed = new Set(checkpoint.completedNodeIds);
    const skipped = new Set(checkpoint.skippedNodeIds);
    const visitCount = new Map<string, number>(Object.entries(checkpoint.visitCount));
    const waveMaxDurationsMs = [...checkpoint.waveMaxDurationsMs];

    const subSwarmOutput = {
      kind: 'swarm' as const,
      swarmId: pending.childSwarmId,
      swarmRunId: pending.childSwarmRunId,
      branchHandle: SUB_SWARM_SUCCESS_HANDLE,
      status: 'done' as const,
      output: childOutput,
      error: null,
    };
    context.setNodeOutput(pending.rootSubSwarmNodeId, subSwarmOutput);
    completed.add(pending.rootSubSwarmNodeId);

    const normalizedEdges = normalizeGraphEdgeEndpoints(graph, graphIndex);
    const branchActivated = new Set<string>();
    this.activateBranchDownstream({
      fromNodeId: pending.rootSubSwarmNodeId,
      branchHandle: SUB_SWARM_SUCCESS_HANDLE,
      edges: normalizedEdges,
      graphIndex,
      skipped,
      branchActivated,
    });

    await this.swarmRunsService.markRunningAfterInput(swarmRun._id);

    const executionContext = await this.resolveExecutionContextForRun(swarm, swarmRun);

    try {
      const finalOutput = await this.traverseGraph({
        swarm,
        graph,
        graphIndex,
        context,
        swarmRunId: swarmRun._id,
        userId,
        workers,
        maxVisits: checkpoint.maxVisits,
        visitCount,
        waveMaxDurationsMs,
        executionContext,
        resume: { completed, skipped },
      });

      const finished = await this.finalizeSwarmRun(
        swarmRun._id,
        finalOutput,
        waveMaxDurationsMs,
        RunStatus.DONE,
      );
      await this.swarmRunsService.clearCheckpoint(swarmRun._id);

      return { swarmRun: finished, output: finalOutput, paused: false as const };
    } catch (err) {
      if (err instanceof SwarmRunPausedForApprovalError) {
        const pausedRun = await this.swarmRunsService.findById(swarmRun._id.toString());
        return {
          swarmRun: pausedRun,
          output: null,
          paused: true as const,
          approval: err.approval,
        };
      }
      if (err instanceof SwarmRunPausedForInputError) {
        const pausedRun = await this.swarmRunsService.findById(swarmRun._id.toString());
        return {
          swarmRun: pausedRun,
          output: null,
          paused: true as const,
          needsInputId: err.needsInputId,
        };
      }
      const message = err instanceof Error ? err.message : 'Swarm run failed';
      this.logger.error(message);
      await this.finalizeSwarmRun(
        swarmRun._id,
        null,
        waveMaxDurationsMs,
        RunStatus.FAILED,
        message,
      );
      throw err;
    }
  }

  private async resumeChildSwarmAtUserInput(
    pending: SubSwarmPendingInput,
    needsInputId: string,
    userId: string,
    params: {
      question: string;
      answer: string | null;
      skipped: boolean;
      passthrough: Record<string, unknown>;
    },
  ): Promise<Record<string, unknown>> {
    const childSwarm = await this.swarmsService.findById(pending.childSwarmId);
    const childGraph = await this.swarmGraphsService.findBySwarmId(pending.childSwarmId);
    const childRun = await this.swarmRunsService.findById(pending.childSwarmRunId);
    const childCheckpoint = pending.childCheckpoint;
    const childContext = SwarmContext.fromCheckpoint(childCheckpoint, childRun._id);
    const childGraphIndex = buildGraphIndex(childGraph);
    const childWorkers = await this.agentWorkersService.findByIds(
      collectWorkerIdsFromGraph(childGraph),
    );

    const userInputOutput = buildUserInputNodeOutput({
      needsInputId,
      question: params.question,
      answer: params.answer,
      skipped: params.skipped,
      passthrough: params.passthrough,
    });

    const completed = new Set(childCheckpoint.completedNodeIds);
    const skipped = new Set(childCheckpoint.skippedNodeIds);
    const visitCount = new Map<string, number>(Object.entries(childCheckpoint.visitCount));
    const waveMaxDurationsMs = [...childCheckpoint.waveMaxDurationsMs];

    childContext.setNodeOutput(pending.childNodeId, userInputOutput);
    completed.add(pending.childNodeId);

    await this.swarmRunsService.markRunningAfterInput(childRun._id);

    const executionContext = await this.resolveExecutionContextForRun(childSwarm, childRun);

    const finalOutput = await this.traverseGraph({
      swarm: childSwarm,
      graph: childGraph,
      graphIndex: childGraphIndex,
      context: childContext,
      swarmRunId: childRun._id,
      userId,
      workers: childWorkers,
      maxVisits: childCheckpoint.maxVisits,
      visitCount,
      waveMaxDurationsMs,
      executionContext,
      resume: { completed, skipped },
    });

    await this.finalizeSwarmRun(
      childRun._id,
      finalOutput,
      waveMaxDurationsMs,
      RunStatus.DONE,
    );
    await this.swarmRunsService.clearCheckpoint(childRun._id);

    return finalOutput ?? {};
  }

  private async finishSubSwarmFrameAndContinue(
    frame: SubSwarmResumeFrame,
    childOutput: Record<string, unknown>,
    userId: string,
    childSwarmId: string,
    childSwarmRunId: string,
  ): Promise<Record<string, unknown>> {
    const frameSwarm = await this.swarmsService.findById(frame.swarmId);
    const frameGraph = await this.swarmGraphsService.findBySwarmId(frame.swarmId);
    const frameRun = await this.swarmRunsService.findById(frame.swarmRunId);
    const frameCheckpoint = frame.checkpoint;
    const context = SwarmContext.fromCheckpoint(frameCheckpoint, frameRun._id);
    const graphIndex = buildGraphIndex(frameGraph);
    const workers = await this.agentWorkersService.findByIds(collectWorkerIdsFromGraph(frameGraph));

    const completed = new Set(frameCheckpoint.completedNodeIds);
    const skipped = new Set(frameCheckpoint.skippedNodeIds);
    const visitCount = new Map<string, number>(Object.entries(frameCheckpoint.visitCount));
    const waveMaxDurationsMs = [...frameCheckpoint.waveMaxDurationsMs];

    const subSwarmOutput = {
      kind: 'swarm' as const,
      swarmId: childSwarmId,
      swarmRunId: childSwarmRunId,
      branchHandle: SUB_SWARM_SUCCESS_HANDLE,
      status: 'done' as const,
      output: childOutput,
      error: null,
    };
    context.setNodeOutput(frame.subSwarmNodeId, subSwarmOutput);
    completed.add(frame.subSwarmNodeId);

    const normalizedEdges = normalizeGraphEdgeEndpoints(frameGraph, graphIndex);
    const branchActivated = new Set<string>();
    this.activateBranchDownstream({
      fromNodeId: frame.subSwarmNodeId,
      branchHandle: SUB_SWARM_SUCCESS_HANDLE,
      edges: normalizedEdges,
      graphIndex,
      skipped,
      branchActivated,
    });

    await this.swarmRunsService.markRunningAfterInput(frameRun._id);

    const executionContext = await this.resolveExecutionContextForRun(frameSwarm, frameRun);

    const finalOutput = await this.traverseGraph({
      swarm: frameSwarm,
      graph: frameGraph,
      graphIndex,
      context,
      swarmRunId: frameRun._id,
      userId,
      workers,
      maxVisits: frameCheckpoint.maxVisits,
      visitCount,
      waveMaxDurationsMs,
      executionContext,
      resume: { completed, skipped },
    });

    await this.finalizeSwarmRun(
      frameRun._id,
      finalOutput,
      waveMaxDurationsMs,
      RunStatus.DONE,
    );
    await this.swarmRunsService.clearCheckpoint(frameRun._id);

    return finalOutput ?? childOutput;
  }

  private async pauseForUserInput(params: {
    swarm: SwarmDocument;
    graph: SwarmGraph;
    graphIndex: GraphIndex;
    context: SwarmContext;
    swarmRunId: Types.ObjectId;
    userId: string;
    workers: Map<string, AgentWorkerDocument>;
    nodeId: string;
    nodeData: Record<string, unknown> | undefined;
    maxVisits: number;
    visitCount: Map<string, number>;
    completed: Set<string>;
    skipped: Set<string>;
    waveMaxDurationsMs: number[];
    parentPauseContext?: SubSwarmParentPauseContext;
  }): Promise<never> {
    const data = parseUserInputNodeData(params.nodeData);
    const question =
      data.question?.trim() ||
      'The agent needs your input to continue. Please reply below.';
    const passthrough = resolveUserInputPassthrough(
      params.graph,
      params.graphIndex,
      params.context,
      params.nodeId,
      params.workers,
    );
    const needsInputId = new Types.ObjectId().toString();

    const checkpoint = params.context.toCheckpoint({
      completedNodeIds: [...params.completed],
      skippedNodeIds: [...params.skipped],
      visitCount: params.visitCount,
      waveMaxDurationsMs: params.waveMaxDurationsMs,
      pendingApprovalNodeId: params.nodeId,
      pendingNeedsInputNodeId: params.nodeId,
      maxVisits: params.maxVisits,
    });

    const swarmRun = await this.swarmRunsService.findById(params.swarmRunId.toString());
    if (swarmRun.parentSwarmRunId && params.parentPauseContext) {
      throw new SwarmRunNeedsInputBubbleUpError({
        question,
        suggestedAnswers: data.suggestedAnswers ?? [],
        passthrough,
        childCheckpoint: checkpoint,
        childNodeId: params.nodeId,
        childSwarmRunId: params.swarmRunId.toString(),
        childSwarmId: params.swarm._id.toString(),
        frames: params.parentPauseContext.bubbleFrames ?? [],
      });
    }

    await this.swarmRunsService.pauseForInput(
      params.swarmRunId,
      checkpoint,
      needsInputId,
    );
    throw new SwarmRunPausedForInputError(needsInputId);
  }

  private async traverseGraph(params: {
    swarm: SwarmDocument;
    graph: SwarmGraph;
    graphIndex: GraphIndex;
    context: SwarmContext;
    swarmRunId: Types.ObjectId;
    userId: string;
    workers: Map<string, AgentWorkerDocument>;
    maxVisits: number;
    visitCount: Map<string, number>;
    waveMaxDurationsMs: number[];
    executionContext: SwarmExecutionContext;
    resume?: {
      completed: Set<string>;
      skipped: Set<string>;
    };
    streaming?: SwarmTraversalStreaming;
  }): Promise<Record<string, unknown> | null> {
    const {
      swarm,
      graph,
      graphIndex,
      context,
      swarmRunId,
      userId,
      workers,
      maxVisits,
      visitCount,
      waveMaxDurationsMs,
      executionContext,
      resume,
      streaming,
    } = params;
    const completed = resume?.completed ?? new Set<string>();
    const skipped = resume?.skipped ?? new Set<string>();
    const branchActivated = new Set<string>();
    const whileIterations = new Map<string, number>();
    const schedulingGraph: SwarmGraph = {
      ...graph,
      edges: this.buildSchedulingEdges(graph, graphIndex),
    };
    const exitWorkerKey = resolveExitWorkerKey(schedulingGraph, graphIndex);
    const entryWorkerKey = resolveEntryWorkerKey(schedulingGraph, graphIndex);
    const { completionNodeId, returnsEndOutput } = resolveRunCompletion(
      schedulingGraph,
      graphIndex,
    );
    const entryNodeId = workerNodeIdForWorkerKey(graphIndex, entryWorkerKey);
    let wave = 0;

    const start = findStartGraphNode(schedulingGraph, graphIndex);
    if (start && !completed.has(start.id)) {
      if (streaming) {
        const step = streaming.nextStep();
        const startOutput = { kind: 'start', runInput: { ...context.runInput } };
        streaming.emit({
          type: 'node_start',
          nodeId: start.id,
          nodeKind: 'start',
          nodeName: 'Start',
          step,
          wave,
        });
        streaming.emit({
          type: 'node_done',
          nodeId: start.id,
          nodeKind: 'start',
          nodeName: 'Start',
          step,
          wave,
          output: startOutput,
          latencyMs: 0,
        });
      }
      context.setNodeOutput(start.id, { kind: 'start' });
      completed.add(start.id);
    }

    while (!completed.has(completionNodeId)) {
      wave += 1;

      if (branchActivated.size === 0) {
        this.refreshSkippedNodes(
          schedulingGraph,
          graphIndex,
          context,
          completed,
          skipped,
          entryNodeId,
          workers,
          streaming
            ? {
                emit: streaming.emit,
                wave,
              }
            : undefined,
        );
      }

      const ready = this.getReadyNodeIds(
        schedulingGraph,
        graphIndex,
        completed,
        skipped,
        context,
        entryNodeId,
        branchActivated,
      );
      if (ready.length === 0) {
        if (skipped.has(completionNodeId)) {
          this.logger.warn(
            `Completion node ${completionNodeId} unreachable after branch pruning; finishing with last branch output`,
          );
          this.logger.debug(
            `Branch prune state: skipped=[${[...skipped].join(', ')}], branchActivated=[${[...branchActivated].join(', ')}]`,
          );
          return this.resolveOutputWhenExitUnreachable(
            context,
            graphIndex,
            completed,
            exitWorkerKey,
          );
        }
        throw new Error(
          `Graph deadlock: no runnable nodes (completed=${completed.size}, skipped=${skipped.size}, completion=${completionNodeId})`,
        );
      }

      const waveNodeDurationsMs: number[] = [];

      await Promise.all(
        ready.map(async (nodeId) => {
          const nodeStarted = Date.now();
          const visits = (visitCount.get(nodeId) ?? 0) + 1;
          if (visits > maxVisits) {
            throw new Error(`Loop detected: node ${nodeId} exceeded max visits`);
          }
          visitCount.set(nodeId, visits);

          const indexed = graphIndex.nodesById.get(nodeId);
          if (!indexed) {
            throw new Error(`Graph node ${nodeId} not found`);
          }

          try {
            if (indexed.kind === GraphNodeKind.IF_ELSE) {
              const ifElseStep = streaming?.nextStep();
              const ifElseName = 'If / else';
              if (streaming && ifElseStep != null) {
                streaming.emit({
                  type: 'node_start',
                  nodeId,
                  nodeKind: 'ifelse',
                  nodeName: ifElseName,
                  step: ifElseStep,
                  wave,
                });
              }
              const ifElseDebug: IfElseEvaluationDebug = { cases: [], runInput: { hasCompanyMemory: false } };
              const output = evaluateIfElseNode(
                graph,
                graphIndex,
                context,
                nodeId,
                workers,
                ifElseDebug,
              );
              const activated = this.activateBranchDownstream({
                fromNodeId: nodeId,
                branchHandle: output.branchHandle,
                branchCaseId: output.caseId,
                edges: schedulingGraph.edges,
                graphIndex,
                skipped,
                branchActivated,
                skipEmit: streaming
                  ? {
                      emit: streaming.emit,
                      wave,
                      fromNodeId: nodeId,
                      workers,
                    }
                  : undefined,
              });
              const ifElseOutgoing = this.outgoingFromGraphNode(
                schedulingGraph.edges,
                graphIndex,
                nodeId,
              );
              const finalOutput =
                activated.length === 0 && ifElseOutgoing.length > 0
                  ? {
                      ...output,
                      routingWarning:
                        'Active branch has no matching wire on the canvas; downstream nodes were not scheduled.',
                    }
                  : output;
              context.setNodeOutput(nodeId, finalOutput);
              completed.add(nodeId);
              if (activated.length > 0) {
                this.logger.debug(
                  `[ifelse:${nodeId}] activated downstream [${activated.join(', ')}]`,
                );
              } else if (ifElseOutgoing.length > 0) {
                this.logger.warn(
                  `[ifelse:${nodeId}] branch=${output.branchHandle} but no wire matched (saved handles: ${ifElseOutgoing.map((e) => e.sourceHandle ?? 'null').join(', ')})`,
                );
              }
              this.logIfElseEvaluation({
                nodeId,
                debug: ifElseDebug,
                output,
                outgoing: ifElseOutgoing,
                activated,
              });
              if (streaming && ifElseStep != null) {
                streaming.emit({
                  type: 'node_done',
                  nodeId,
                  nodeKind: 'ifelse',
                  nodeName: ifElseName,
                  step: ifElseStep,
                  wave,
                  output: finalOutput,
                  latencyMs: Date.now() - nodeStarted,
                });
              }
              this.logger.log(
                `[ifelse:${nodeId}] branch=${finalOutput.caseName ?? finalOutput.branchHandle}${finalOutput.matchedCondition ? ` condition=${finalOutput.matchedCondition}` : ''}`,
              );
              return;
            }

            if (indexed.kind === GraphNodeKind.WHILE) {
              const whileData = parseWhileNodeData(indexed.data);
              const maxIterations = whileData.maxIterations ?? DEFAULT_WHILE_MAX_ITERATIONS;
              const iteration = (whileIterations.get(nodeId) ?? 0) + 1;
              whileIterations.set(nodeId, iteration);

              if (iteration > maxIterations) {
                throw new Error(
                  `While node ${nodeId} exceeded max iterations (${maxIterations})`,
                );
              }

              const whileStep = streaming?.nextStep();
              const whileName = 'While';
              if (streaming && whileStep != null) {
                streaming.emit({
                  type: 'node_start',
                  nodeId,
                  nodeKind: 'while',
                  nodeName: whileName,
                  step: whileStep,
                  wave,
                });
              }

              if (iteration > 1) {
                this.resetWhileLoopBody(
                  nodeId,
                  schedulingGraph,
                  graphIndex,
                  context,
                  completed,
                  skipped,
                );
              }

              const output = evaluateWhileNode(
                graph,
                graphIndex,
                context,
                nodeId,
                workers,
                iteration,
              );
              const activated = this.activateBranchDownstream({
                fromNodeId: nodeId,
                branchHandle: output.branchHandle,
                edges: schedulingGraph.edges,
                graphIndex,
                skipped,
                branchActivated,
                skipEmit: streaming
                  ? {
                      emit: streaming.emit,
                      wave,
                      fromNodeId: nodeId,
                      workers,
                    }
                  : undefined,
              });
              const whileOutgoing = this.outgoingFromGraphNode(
                schedulingGraph.edges,
                graphIndex,
                nodeId,
              );
              const finalOutput =
                activated.length === 0 && whileOutgoing.length > 0
                  ? {
                      ...output,
                      routingWarning:
                        'Active branch has no matching wire on the canvas; downstream nodes were not scheduled.',
                    }
                  : output;
              context.setNodeOutput(nodeId, finalOutput);
              if (output.branchHandle === WHILE_DONE_HANDLE) {
                completed.add(nodeId);
              }
              if (activated.length > 0) {
                this.logger.debug(
                  `[while:${nodeId}] activated downstream [${activated.join(', ')}]`,
                );
              } else if (whileOutgoing.length > 0) {
                this.logger.warn(
                  `[while:${nodeId}] branch=${output.branchHandle} but no wire matched (saved handles: ${whileOutgoing.map((e) => e.sourceHandle ?? 'null').join(', ')})`,
                );
              }
              if (streaming && whileStep != null) {
                streaming.emit({
                  type: 'node_done',
                  nodeId,
                  nodeKind: 'while',
                  nodeName: whileName,
                  step: whileStep,
                  wave,
                  output: finalOutput,
                  latencyMs: Date.now() - nodeStarted,
                });
              }
              this.logger.log(
                `[while:${nodeId}] iteration=${iteration} branch=${finalOutput.branchHandle}${finalOutput.matchedCondition ? ` condition=${finalOutput.matchedCondition}` : ''}`,
              );
              return;
            }

            if (indexed.kind === GraphNodeKind.USER_APPROVAL) {
              const data = parseUserApprovalNodeData(indexed.data);
              const approvalName =
                typeof data.name === 'string' && data.name.trim()
                  ? data.name.trim()
                  : 'User approval';
              const approvalStep = streaming?.nextStep();
              if (streaming && approvalStep != null) {
                streaming.emit({
                  type: 'node_start',
                  nodeId,
                  nodeKind: 'user_approval',
                  nodeName: approvalName,
                  step: approvalStep,
                  wave,
                });
              }
              await this.pauseForUserApproval({
                swarm,
                graph: schedulingGraph,
                graphIndex,
                context,
                swarmRunId,
                userId,
                workers,
                nodeId,
                nodeData: indexed.data,
                maxVisits,
                visitCount,
                completed,
                skipped,
                waveMaxDurationsMs,
              });
            }

            if (indexed.kind === GraphNodeKind.USER_INPUT) {
              const data = parseUserInputNodeData(indexed.data);
              const inputName =
                typeof data.name === 'string' && data.name.trim()
                  ? data.name.trim()
                  : 'Needs input';
              const inputStep = streaming?.nextStep();
              if (streaming && inputStep != null) {
                streaming.emit({
                  type: 'node_start',
                  nodeId,
                  nodeKind: 'user_input',
                  nodeName: inputName,
                  step: inputStep,
                  wave,
                });
              }
              await this.pauseForUserInput({
                swarm,
                graph: schedulingGraph,
                graphIndex,
                context,
                swarmRunId,
                userId,
                workers,
                nodeId,
                nodeData: indexed.data,
                maxVisits,
                visitCount,
                completed,
                skipped,
                waveMaxDurationsMs,
                parentPauseContext: executionContext.activeParentPause,
              });
            }

            if (indexed.kind === GraphNodeKind.SCRAPER) {
              const data = parseScraperNodeData(indexed.data);
              const scraperName =
                typeof data.label === 'string' && data.label.trim()
                  ? data.label.trim()
                  : 'Web scrape';
              const scraperStep = streaming?.nextStep();
              if (streaming && scraperStep != null) {
                streaming.emit({
                  type: 'node_start',
                  nodeId,
                  nodeKind: 'scraper',
                  nodeName: scraperName,
                  step: scraperStep,
                  wave,
                });
              }
              const output = await executeScraperNode({
                scraperService: this.scraperService,
                data,
                context,
                userId,
                swarmRunId: swarmRunId.toString(),
                graph: schedulingGraph,
                graphIndex,
                nodeId,
                workers,
              });
              if (streaming && scraperStep != null) {
                streaming.emit({
                  type: 'node_done',
                  nodeId,
                  nodeKind: 'scraper',
                  nodeName: scraperName,
                  step: scraperStep,
                  wave,
                  output,
                  latencyMs: Date.now() - nodeStarted,
                });
              }
              this.logger.log(
                `[scraper:${nodeId}] url=${output.url} status=${output.status} branch=${output.branchHandle}`,
              );
              context.setNodeOutput(nodeId, output);
              completed.add(nodeId);
              this.activateBranchDownstream({
                fromNodeId: nodeId,
                branchHandle: output.branchHandle,
                edges: schedulingGraph.edges,
                graphIndex,
                skipped,
                branchActivated,
                skipEmit: streaming
                  ? {
                      emit: streaming.emit,
                      wave,
                      fromNodeId: nodeId,
                      workers,
                    }
                  : undefined,
              });
              return;
            }

            if (indexed.kind === GraphNodeKind.SWARM) {
              const data = parseSwarmNodeData(indexed.data);
              const swarmName =
                typeof data.label === 'string' && data.label.trim()
                  ? data.label.trim()
                  : 'Sub-swarm';
              const swarmStep = streaming?.nextStep();
              if (streaming && swarmStep != null) {
                streaming.emit({
                  type: 'node_start',
                  nodeId,
                  nodeKind: 'swarm',
                  nodeName: swarmName,
                  step: swarmStep,
                  wave,
                });
              }
              const parentPauseContext: SubSwarmParentPauseContext = {
                swarm,
                graph: schedulingGraph,
                graphIndex,
                context,
                swarmRunId,
                subSwarmNodeId: nodeId,
                workers,
                maxVisits,
                visitCount,
                completed,
                skipped,
                waveMaxDurationsMs,
                bubbleFrames: [
                  ...(executionContext.bubbleFrames ?? []),
                  this.buildSubSwarmResumeFrame({
                    swarm,
                    graph: schedulingGraph,
                    graphIndex,
                    context,
                    swarmRunId,
                    subSwarmNodeId: nodeId,
                    workers,
                    maxVisits,
                    visitCount,
                    completed,
                    skipped,
                    waveMaxDurationsMs,
                  }),
                ],
              };

              const output = await executeSwarmNode({
                data,
                graph: schedulingGraph,
                graphIndex,
                context,
                nodeId,
                workers,
                parentSwarmRunId: swarmRunId,
                userId,
                maxNodeVisits: maxVisits,
                parentPauseContext,
                runSubSwarm: (subParams) =>
                  this.executeSubSwarm(subParams, executionContext, maxVisits),
              });
              if (streaming && swarmStep != null) {
                streaming.emit({
                  type: 'node_done',
                  nodeId,
                  nodeKind: 'swarm',
                  nodeName: swarmName,
                  step: swarmStep,
                  wave,
                  output,
                  latencyMs: Date.now() - nodeStarted,
                });
              }
              this.logger.log(
                `[swarm:${nodeId}] child=${output.swarmId} status=${output.status} branch=${output.branchHandle}`,
              );
              context.setNodeOutput(nodeId, output);
              completed.add(nodeId);
              this.activateBranchDownstream({
                fromNodeId: nodeId,
                branchHandle: output.branchHandle,
                edges: schedulingGraph.edges,
                graphIndex,
                skipped,
                branchActivated,
                skipEmit: streaming
                  ? {
                      emit: streaming.emit,
                      wave,
                      fromNodeId: nodeId,
                      workers,
                    }
                  : undefined,
              });
              return;
            }

            if (indexed.kind === GraphNodeKind.END) {
              const endData = parseEndNodeData(indexed.data);
              const endName =
                typeof endData.label === 'string' && endData.label.trim()
                  ? endData.label.trim()
                  : 'End';
              const endStep = streaming?.nextStep();
              if (streaming && endStep != null) {
                streaming.emit({
                  type: 'node_start',
                  nodeId,
                  nodeKind: 'end',
                  nodeName: endName,
                  step: endStep,
                  wave,
                });
              }
              const output = evaluateEndNode(
                schedulingGraph,
                graphIndex,
                context,
                nodeId,
                workers,
                endData,
              );
              context.setNodeOutput(nodeId, output);
              completed.add(nodeId);
              if (streaming && endStep != null) {
                streaming.emit({
                  type: 'node_done',
                  nodeId,
                  nodeKind: 'end',
                  nodeName: endName,
                  step: endStep,
                  wave,
                  output,
                  latencyMs: Date.now() - nodeStarted,
                });
              }
              this.logger.log(`[end:${nodeId}] keys=${Object.keys(output.output).join(', ') || '(empty)'}`);
              return;
            }

            if (!indexed.workerId) {
              throw new Error(`Worker node ${nodeId} is missing workerId`);
            }

            const workerKey = indexed.workerId.toString();
            const worker = workers.get(workerKey);
            if (!worker) {
              throw new Error(`Worker ${workerKey} not found`);
            }

            const output = await this.executeGraphWorker({
              nodeId,
              workerId: indexed.workerId,
              worker,
              graph: schedulingGraph,
              graphIndex,
              context,
              swarmRunId,
              workers,
              streaming,
              wave,
              isEntry: workerKey === entryWorkerKey,
              isExit: workerKey === exitWorkerKey,
            });

            context.setWorkerOutput(workerKey, output);
            context.setNodeOutput(nodeId, output);
            completed.add(nodeId);
          } finally {
            waveNodeDurationsMs.push(Date.now() - nodeStarted);
          }
        }),
      );

      waveMaxDurationsMs.push(maxWaveDurationMs(waveNodeDurationsMs));
    }

    if (returnsEndOutput) {
      const endOut = context.getNodeOutput(completionNodeId) as EndNodeOutput | undefined;
      return endOut?.output ?? null;
    }
    return context.getWorkerOutput(exitWorkerKey) ?? null;
  }

  /** Normalizes edge endpoints and adds Start → downstream edges stripped on save. */
  private buildSchedulingEdges(graph: SwarmGraph, graphIndex: GraphIndex): SwarmGraph['edges'] {
    const edges = dedupeSwarmGraphEdges(normalizeGraphEdgeEndpoints(graph, graphIndex));
    const start = findStartGraphNode(graph, graphIndex);
    if (!start) {
      return edges;
    }

    const existing = new Set(edges.map((e) => `${e.from.toString()}-${e.to.toString()}`));
    const extra: SwarmGraph['edges'] = [];

    for (const targetId of listStartDownstreamNodeIds(graph, start.id)) {
      const targetKey = edgeEndpointNodeId(targetId, graphIndex);
      const hasNonStartIncoming = edges.some((edge) => {
        const toKey = edgeEndpointNodeId(edge.to.toString(), graphIndex);
        if (toKey !== targetKey) {
          return false;
        }
        const fromKey = edgeEndpointNodeId(edge.from.toString(), graphIndex);
        return fromKey !== start.id;
      });
      if (hasNonStartIncoming) {
        continue;
      }
      const key = `${start.id}-${targetKey}`;
      if (existing.has(key)) {
        continue;
      }
      extra.push({
        from: start.id,
        to: targetKey,
        type: GraphEdgeType.SEQUENTIAL,
        condition: null,
        sourceHandle: null,
      });
      existing.add(key);
    }

    const merged = extra.length > 0 ? [...edges, ...extra] : edges;
    return this.enrichBranchEdgeSourceHandles(merged, graphIndex);
  }

  /**
   * Fills missing `sourceHandle` on single-wire branch nodes (legacy saves / partial exports).
   */
  private enrichBranchEdgeSourceHandles(
    edges: SwarmGraph['edges'],
    graphIndex: GraphIndex,
  ): SwarmGraph['edges'] {
    return edges.map((edge) => {
      if (edge.sourceHandle?.trim()) {
        return edge;
      }
      const fromKey = edgeEndpointNodeId(edge.from.toString(), graphIndex);
      const fromNode = graphIndex.nodesById.get(fromKey);
      if (fromNode?.kind === GraphNodeKind.USER_APPROVAL) {
        const outgoing = this.outgoingFromGraphNode(edges, graphIndex, fromKey);
        if (outgoing.length === 1 && outgoing[0] === edge) {
          return { ...edge, sourceHandle: USER_APPROVAL_APPROVE_HANDLE };
        }
        return edge;
      }
      if (fromNode?.kind === GraphNodeKind.SCRAPER) {
        const toKey = edgeEndpointNodeId(edge.to.toString(), graphIndex);
        const wiresToTarget = edges.filter(
          (candidate) => edgeEndpointNodeId(candidate.to.toString(), graphIndex) === toKey,
        );
        if (wiresToTarget.length === 1 && wiresToTarget[0] === edge) {
          return { ...edge, sourceHandle: SCRAPER_SUCCESS_HANDLE };
        }
      }
      if (fromNode?.kind === GraphNodeKind.SWARM) {
        const toKey = edgeEndpointNodeId(edge.to.toString(), graphIndex);
        const wiresToTarget = edges.filter(
          (candidate) => edgeEndpointNodeId(candidate.to.toString(), graphIndex) === toKey,
        );
        if (wiresToTarget.length === 1 && wiresToTarget[0] === edge) {
          return { ...edge, sourceHandle: SUB_SWARM_SUCCESS_HANDLE };
        }
      }
      if (fromNode?.kind === GraphNodeKind.IF_ELSE) {
        const outgoing = this.outgoingFromGraphNode(edges, graphIndex, fromKey);
        if (outgoing.length === 1 && outgoing[0] === edge) {
          const data = parseIfElseNodeData(fromNode.data);
          const firstCase = data.cases.find((row) => row.condition?.trim());
          if (firstCase) {
            return { ...edge, sourceHandle: ifElseCaseHandle(firstCase.id) };
          }
        }
      }
      if (fromNode?.kind === GraphNodeKind.WHILE) {
        const outgoing = this.outgoingFromGraphNode(edges, graphIndex, fromKey);
        if (outgoing.length === 1 && outgoing[0] === edge) {
          return { ...edge, sourceHandle: WHILE_LOOP_HANDLE };
        }
      }
      return edge;
    });
  }

  private logIfElseEvaluation(params: {
    nodeId: string;
    debug: IfElseEvaluationDebug;
    output: IfElseNodeOutput;
    outgoing: SwarmGraph['edges'];
    activated: string[];
  }): void {
    const { nodeId, debug, output, outgoing, activated } = params;
    const caseSummary = debug.cases
      .map((row) => {
        if (row.skipped) {
          return `${row.caseName}: (empty)`;
        }
        return `${row.caseName}: ${row.result ? 'true' : 'false'} [${row.condition}]`;
      })
      .join('; ');

    const runInput = debug.runInput;
    const runInputSummary = [
      runInput.companyId ? `companyId=${runInput.companyId}` : 'companyId=(missing)',
      `companyMemory=${runInput.hasCompanyMemory ? 'yes' : 'no'}`,
      runInput.summaryLength != null ? `summary.length=${runInput.summaryLength}` : null,
      runInput.companyMemoryTextLength != null
        ? `companyMemoryText.length=${runInput.companyMemoryTextLength}`
        : null,
    ]
      .filter(Boolean)
      .join(', ');

    const wireSummary =
      outgoing.length === 0
        ? '(no outgoing wires)'
        : outgoing
            .map(
              (edge) =>
                `${edge.to.toString()}←handle:${edge.sourceHandle?.trim() || 'null'}`,
            )
            .join('; ');

    this.logger.log(
      `[ifelse:${nodeId}] evaluate cases=[${caseSummary}] runInput={${runInputSummary}} → branch=${output.branchHandle} (${output.caseName ?? 'Else'})`,
    );
    this.logger.log(
      `[ifelse:${nodeId}] wires=[${wireSummary}] activated=[${activated.join(', ') || 'none'}]`,
    );
  }

  private outgoingFromGraphNode(
    edges: SwarmGraph['edges'],
    graphIndex: GraphIndex,
    fromNodeId: string,
  ): SwarmGraph['edges'] {
    return edges.filter(
      (edge) => edgeEndpointNodeId(edge.from.toString(), graphIndex) === fromNodeId,
    );
  }

  /** Prunes inactive branches, unblocks active targets, and queues them for the next scheduler wave. */
  private activateBranchDownstream(params: {
    fromNodeId: string;
    branchHandle: string;
    branchCaseId?: string;
    edges: SwarmGraph['edges'];
    graphIndex: GraphIndex;
    skipped: Set<string>;
    branchActivated: Set<string>;
    skipEmit?: {
      emit: (event: SwarmSseEvent) => void;
      wave: number;
      fromNodeId: string;
      workers: Map<string, AgentWorkerDocument>;
    };
  }): string[] {
    const {
      fromNodeId,
      branchHandle,
      branchCaseId,
      edges,
      graphIndex,
      skipped,
      branchActivated,
      skipEmit,
    } = params;
    this.finalizeBranchRouting(
      fromNodeId,
      branchHandle,
      edges,
      skipped,
      graphIndex,
      branchCaseId,
      skipEmit,
    );
    const activated = this.collectBranchActivatedTargetIds(
      fromNodeId,
      branchHandle,
      branchCaseId,
      edges,
      graphIndex,
    );
    for (const targetId of activated) {
      branchActivated.add(targetId);
    }
    return activated;
  }

  /** Skips inactive branch subtrees, then unblocks targets on the active handle. */
  private finalizeBranchRouting(
    fromNodeId: string,
    branchHandle: string,
    edges: SwarmGraph['edges'],
    skipped: Set<string>,
    graphIndex: GraphIndex,
    branchCaseId?: string,
    skipEmit?: {
      emit: (event: SwarmSseEvent) => void;
      wave: number;
      fromNodeId: string;
      workers: Map<string, AgentWorkerDocument>;
    },
  ): void {
    this.pruneInactiveBranchTargets(
      fromNodeId,
      branchHandle,
      edges,
      graphIndex,
      skipped,
      branchCaseId,
      skipEmit,
    );
    this.unlockActiveBranchTargets(
      fromNodeId,
      branchHandle,
      edges,
      skipped,
      graphIndex,
      branchCaseId,
    );
  }

  /** Marks every node downstream of a non-matching branch wire as skipped. */
  private pruneInactiveBranchTargets(
    fromNodeId: string,
    branchHandle: string,
    edges: SwarmGraph['edges'],
    graphIndex: GraphIndex,
    skipped: Set<string>,
    branchCaseId?: string,
    skipEmit?: {
      emit: (event: SwarmSseEvent) => void;
      wave: number;
      fromNodeId: string;
      workers: Map<string, AgentWorkerDocument>;
    },
  ): void {
    const outgoing = this.outgoingFromGraphNode(edges, graphIndex, fromNodeId);

    for (const edge of outgoing) {
      if (
        this.edgeMatchesActiveBranch(
          edge,
          outgoing,
          branchHandle,
          graphIndex,
          branchCaseId,
        )
      ) {
        continue;
      }
      const targetId = edgeEndpointNodeId(edge.to.toString(), graphIndex);
      this.markBranchSubtreeSkipped(targetId, edges, graphIndex, skipped, skipEmit);
    }
  }

  private markBranchSubtreeSkipped(
    nodeId: string,
    edges: SwarmGraph['edges'],
    graphIndex: GraphIndex,
    skipped: Set<string>,
    skipEmit?: {
      emit: (event: SwarmSseEvent) => void;
      wave: number;
      fromNodeId: string;
      workers: Map<string, AgentWorkerDocument>;
    },
  ): void {
    if (skipped.has(nodeId)) {
      return;
    }
    skipped.add(nodeId);
    if (skipEmit) {
      emitNodeSkipped(skipEmit.emit, {
        graphIndex,
        nodeId,
        wave: skipEmit.wave,
        reason: 'branch_pruned',
        fromNodeId: skipEmit.fromNodeId,
        workers: skipEmit.workers,
      });
    }
    for (const edge of this.outgoingFromGraphNode(edges, graphIndex, nodeId)) {
      const childId = edgeEndpointNodeId(edge.to.toString(), graphIndex);
      this.markBranchSubtreeSkipped(childId, edges, graphIndex, skipped, skipEmit);
    }
  }

  /** Clears `skipped` on the active branch target and everything downstream of it. */
  private unlockActiveBranchTargets(
    fromNodeId: string,
    branchHandle: string,
    edges: SwarmGraph['edges'],
    skipped: Set<string>,
    graphIndex: GraphIndex,
    branchCaseId?: string,
  ): void {
    const outgoing = this.outgoingFromGraphNode(edges, graphIndex, fromNodeId);
    for (const edge of outgoing) {
      if (
        !this.edgeMatchesActiveBranch(
          edge,
          outgoing,
          branchHandle,
          graphIndex,
          branchCaseId,
        )
      ) {
        continue;
      }
      const targetId = edgeEndpointNodeId(edge.to.toString(), graphIndex);
      this.clearBranchSubtreeSkipped(targetId, edges, graphIndex, skipped);
    }
  }

  private clearBranchSubtreeSkipped(
    nodeId: string,
    edges: SwarmGraph['edges'],
    graphIndex: GraphIndex,
    skipped: Set<string>,
  ): void {
    skipped.delete(nodeId);
    for (const edge of this.outgoingFromGraphNode(edges, graphIndex, nodeId)) {
      const childId = edgeEndpointNodeId(edge.to.toString(), graphIndex);
      this.clearBranchSubtreeSkipped(childId, edges, graphIndex, skipped);
    }
  }

  private edgeMatchesActiveBranch(
    edge: SwarmGraph['edges'][number],
    outgoingFromNode: SwarmGraph['edges'],
    branchHandle: string,
    graphIndex: GraphIndex,
    branchCaseId?: string,
  ): boolean {
    const wireHandle = edge.sourceHandle?.trim() ?? '';
    if (wireHandle && this.branchHandlesMatch(branchHandle, wireHandle, branchCaseId)) {
      return true;
    }
    return this.ifElseSingleOutgoingWireIsActiveBranch(
      edge,
      outgoingFromNode,
      graphIndex,
      branchHandle,
    );
  }

  /**
   * Canvas with a single downstream wire from If/else: treat it as the active branch when
   * the run did not take Else (even if `sourceHandle` is missing or mismatched).
   */
  private ifElseSingleOutgoingWireIsActiveBranch(
    edge: SwarmGraph['edges'][number],
    outgoingFromNode: SwarmGraph['edges'],
    graphIndex: GraphIndex,
    branchHandle: string,
  ): boolean {
    if (outgoingFromNode.length !== 1 || outgoingFromNode[0] !== edge) {
      return false;
    }
    const fromKey = edgeEndpointNodeId(edge.from.toString(), graphIndex);
    if (graphIndex.nodesById.get(fromKey)?.kind !== GraphNodeKind.IF_ELSE) {
      return false;
    }
    const active = branchHandle.trim().toLowerCase();
    return active !== IF_ELSE_ELSE_HANDLE && active !== 'else';
  }

  private whileSingleOutgoingWireIsActiveBranch(
    edge: SwarmGraph['edges'][number],
    outgoingFromNode: SwarmGraph['edges'],
    graphIndex: GraphIndex,
    branchHandle: string,
  ): boolean {
    if (outgoingFromNode.length !== 1 || outgoingFromNode[0] !== edge) {
      return false;
    }
    const fromKey = edgeEndpointNodeId(edge.from.toString(), graphIndex);
    if (graphIndex.nodesById.get(fromKey)?.kind !== GraphNodeKind.WHILE) {
      return false;
    }
    const active = branchHandle.trim().toLowerCase();
    return active === WHILE_LOOP_HANDLE;
  }

  private resetWhileLoopBody(
    whileNodeId: string,
    graph: SwarmGraph,
    graphIndex: GraphIndex,
    context: SwarmContext,
    completed: Set<string>,
    skipped: Set<string>,
  ): void {
    const bodyIds = collectWhileLoopBodyNodeIds(whileNodeId, graph.edges, graphIndex);
    for (const nodeId of bodyIds) {
      completed.delete(nodeId);
      skipped.delete(nodeId);
      context.deleteNodeOutput(nodeId);
      const indexed = graphIndex.nodesById.get(nodeId);
      if (indexed?.workerId) {
        context.deleteWorkerOutput(indexed.workerId.toString());
      }
    }
  }

  private branchHandlesMatch(expected: string, wire: string, caseId?: string): boolean {
    const a = expected.trim().toLowerCase();
    const b = wire.trim().toLowerCase();
    if (!a || !b) return false;
    if (a === b) return true;
    if (caseId?.trim()) {
      const cid = caseId.trim().toLowerCase();
      if (b === cid) return true;
      if (b === ifElseCaseHandle(caseId).toLowerCase()) return true;
    }
    if (
      a === 'approve' ||
      a === 'reject' ||
      b === 'approve' ||
      b === 'reject'
    ) {
      return a === b;
    }
    if (
      a === WHILE_LOOP_HANDLE ||
      a === WHILE_DONE_HANDLE ||
      b === WHILE_LOOP_HANDLE ||
      b === WHILE_DONE_HANDLE
    ) {
      return whileBranchHandlesMatch(expected, wire);
    }
    if (a.startsWith('case-') || b.startsWith('case-') || a === 'else' || b === 'else') {
      return ifElseBranchHandlesMatch(expected, wire);
    }
    return false;
  }

  private async executeGraphWorker(params: {
    nodeId: string;
    workerId: Types.ObjectId;
    worker: AgentWorkerDocument;
    graph: SwarmGraph;
    graphIndex: GraphIndex;
    context: SwarmContext;
    swarmRunId: Types.ObjectId;
    workers: Map<string, AgentWorkerDocument>;
    streaming?: SwarmTraversalStreaming;
    wave: number;
    isEntry: boolean;
    isExit: boolean;
  }): Promise<Record<string, unknown>> {
    const {
      nodeId,
      workerId,
      worker,
      graph,
      graphIndex,
      context,
      swarmRunId,
      workers,
      streaming,
      wave,
      isEntry,
      isExit,
    } = params;

    try {
      if (streaming) {
        return await streaming.execute(nodeId, workerId, worker, wave);
      }
      return await this.runWorkerWithRetries(
        workerId,
        worker,
        graph,
        graphIndex,
        context,
        swarmRunId,
        workers,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (isEntry || isExit) {
        throw err;
      }
      this.logger.warn(`Worker ${workerId.toString()} failed (continuing join): ${message}`);
      return { failed: true, error: message, workerId: workerId.toString() };
    }
  }

  private getReadyNodeIds(
    graph: SwarmGraph,
    graphIndex: GraphIndex,
    completed: Set<string>,
    skipped: Set<string>,
    context: SwarmContext,
    entryNodeId: string,
    branchActivated?: Set<string>,
  ): string[] {
    const ready: string[] = [];

    if (branchActivated && branchActivated.size > 0) {
      for (const nodeId of branchActivated) {
        if (completed.has(nodeId)) {
          continue;
        }
        skipped.delete(nodeId);
        ready.push(nodeId);
      }
      branchActivated.clear();
    }

    for (const nodeId of collectAllNodeIds(graphIndex)) {
      if (completed.has(nodeId) || ready.includes(nodeId)) {
        continue;
      }
      if (
        this.resolveScheduleState(nodeId, graph, graphIndex, completed, skipped, context, entryNodeId) ===
        'ready'
      ) {
        ready.push(nodeId);
      }
    }

    return ready;
  }

  private collectBranchActivatedTargetIds(
    fromNodeId: string,
    branchHandle: string,
    branchCaseId: string | undefined,
    edges: SwarmGraph['edges'],
    graphIndex: GraphIndex,
  ): string[] {
    const outgoing = this.outgoingFromGraphNode(edges, graphIndex, fromNodeId);
    const targets: string[] = [];
    for (const edge of outgoing) {
      if (!this.edgeMatchesActiveBranch(edge, outgoing, branchHandle, graphIndex, branchCaseId)) {
        continue;
      }
      targets.push(edgeEndpointNodeId(edge.to.toString(), graphIndex));
    }
    return targets;
  }

  private refreshSkippedNodes(
    graph: SwarmGraph,
    graphIndex: GraphIndex,
    context: SwarmContext,
    completed: Set<string>,
    skipped: Set<string>,
    entryNodeId: string,
    workers: Map<string, AgentWorkerDocument>,
    skipEmit?: {
      emit: (event: SwarmSseEvent) => void;
      wave: number;
    },
  ): void {
    let changed = true;
    while (changed) {
      changed = false;
      for (const nodeId of collectAllNodeIds(graphIndex)) {
        if (completed.has(nodeId)) {
          continue;
        }
        const state = this.resolveScheduleState(
          nodeId,
          graph,
          graphIndex,
          completed,
          skipped,
          context,
          entryNodeId,
        );
        if (state === 'skipped') {
          if (!skipped.has(nodeId)) {
            skipped.add(nodeId);
            if (skipEmit) {
              emitNodeSkipped(skipEmit.emit, {
                graphIndex,
                nodeId,
                wave: skipEmit.wave,
                reason: 'unreachable',
                workers,
              });
            }
            changed = true;
          }
        } else if (skipped.has(nodeId)) {
          skipped.delete(nodeId);
          changed = true;
        }
      }
    }
  }

  private resolveScheduleState(
    nodeId: string,
    graph: SwarmGraph,
    graphIndex: GraphIndex,
    completed: Set<string>,
    skipped: Set<string>,
    context: SwarmContext,
    entryNodeId: string,
  ): GraphScheduleState {
    if (completed.has(nodeId)) {
      return 'done';
    }

    const incoming = graph.edges.filter(
      (e) => edgeEndpointNodeId(e.to.toString(), graphIndex) === nodeId,
    );
    if (incoming.length === 0) {
      if (skipped.has(nodeId)) {
        return 'skipped';
      }
      const indexed = graphIndex.nodesById.get(nodeId);
      if (indexed?.kind === GraphNodeKind.START) {
        return completed.has(nodeId) ? 'done' : 'ready';
      }
      const start = findStartGraphNode(graph, graphIndex);
      if (start && indexed?.kind === GraphNodeKind.WORKER) {
        return 'skipped';
      }
      if (!start && nodeId === entryNodeId) {
        return 'ready';
      }
      return 'pending';
    }

    const resolutions = this.resolveIncomingResolutionsForNode(
      incoming,
      graph,
      graphIndex,
      completed,
      skipped,
      context,
    );

    if (resolutions.some((r) => r === 'pending')) {
      return 'pending';
    }
    const hasSatisfied = resolutions.some((r) => r === 'satisfied');
    const onlySatisfiedOrBlocked = resolutions.every(
      (r) => r === 'satisfied' || r === 'blocked',
    );
    if (hasSatisfied && onlySatisfiedOrBlocked) {
      skipped.delete(nodeId);
      return 'ready';
    }
    if (skipped.has(nodeId)) {
      return 'skipped';
    }
    return 'skipped';
  }

  /**
   * Join resolution for incoming edges. Multiple wires from the same branch node
   * (e.g. both approve + reject → Salida) use OR — only the active handle must match.
   */
  private resolveIncomingResolutionsForNode(
    incoming: SwarmGraph['edges'],
    graph: SwarmGraph,
    graphIndex: GraphIndex,
    completed: Set<string>,
    skipped: Set<string>,
    context: SwarmContext,
  ): IncomingEdgeResolution[] {
    const byFrom = new Map<string, SwarmGraph['edges']>();

    for (const edge of incoming) {
      const from = edgeEndpointNodeId(edge.from.toString(), graphIndex);
      const group = byFrom.get(from) ?? [];
      group.push(edge);
      byFrom.set(from, group);
    }

    const resolutions: IncomingEdgeResolution[] = [];

    for (const [, edges] of byFrom) {
      const fromKey = edgeEndpointNodeId(edges[0]?.from.toString() ?? '', graphIndex);
      const fromNode = graphIndex.nodesById.get(fromKey);
      const fromOutput = context.getNodeOutput(fromKey);
      const isBranchSource =
        fromNode?.kind === GraphNodeKind.IF_ELSE ||
        fromNode?.kind === GraphNodeKind.WHILE ||
        fromNode?.kind === GraphNodeKind.SCRAPER ||
        fromNode?.kind === GraphNodeKind.SWARM ||
        fromNode?.kind === GraphNodeKind.USER_APPROVAL ||
        (fromOutput as IfElseNodeOutput | undefined)?.kind === 'ifelse' ||
        (fromOutput as WhileNodeOutput | undefined)?.kind === 'while' ||
        (fromOutput as ScraperNodeOutput | undefined)?.kind === 'scraper' ||
        (fromOutput as SwarmNodeOutput | undefined)?.kind === 'swarm' ||
        (fromOutput as UserApprovalNodeOutput | undefined)?.kind === 'user_approval';

      if (isBranchSource && edges.length > 1) {
        const edgeRes = edges.map((edge) =>
          this.resolveIncomingEdge(edge, graph, graphIndex, completed, skipped, context),
        );
        if (edgeRes.some((r) => r === 'pending')) {
          resolutions.push('pending');
        } else if (edgeRes.some((r) => r === 'satisfied')) {
          resolutions.push('satisfied');
        } else {
          resolutions.push('blocked');
        }
        continue;
      }

      for (const edge of edges) {
        resolutions.push(
          this.resolveIncomingEdge(edge, graph, graphIndex, completed, skipped, context),
        );
      }
    }

    return resolutions;
  }

  private resolveIncomingEdge(
    edge: SwarmGraph['edges'][number],
    graph: SwarmGraph,
    graphIndex: GraphIndex,
    completed: Set<string>,
    skipped: Set<string>,
    context: SwarmContext,
  ): IncomingEdgeResolution {
    const fromKey = edgeEndpointNodeId(edge.from.toString(), graphIndex);
    if (skipped.has(fromKey)) {
      return 'blocked';
    }
    if (!completed.has(fromKey)) {
      return 'pending';
    }

    const fromNode = graphIndex.nodesById.get(fromKey);
    const fromOutput = context.getNodeOutput(fromKey);

    if (fromNode?.kind === GraphNodeKind.IF_ELSE) {
      if (!completed.has(fromKey)) {
        return 'pending';
      }
      const ifOut = context.getNodeOutput(fromKey) as IfElseNodeOutput | undefined;
      if (!ifOut?.branchHandle) {
        return 'pending';
      }
      return this.resolveBranchIncomingEdge(
        edge,
        graph,
        graphIndex,
        fromKey,
        ifOut.branchHandle,
        ifOut.caseId,
      );
    }

    if (fromNode?.kind === GraphNodeKind.WHILE) {
      const whileOut = context.getNodeOutput(fromKey) as WhileNodeOutput | undefined;
      if (!whileOut?.branchHandle) {
        return 'pending';
      }
      return this.resolveBranchIncomingEdge(
        edge,
        graph,
        graphIndex,
        fromKey,
        whileOut.branchHandle,
      );
    }

    if ((fromOutput as IfElseNodeOutput | undefined)?.kind === 'ifelse') {
      const ifOut = fromOutput as IfElseNodeOutput;
      return this.resolveBranchIncomingEdge(
        edge,
        graph,
        graphIndex,
        fromKey,
        ifOut.branchHandle,
        ifOut.caseId,
      );
    }

    if ((fromOutput as WhileNodeOutput | undefined)?.kind === 'while') {
      const whileOut = fromOutput as WhileNodeOutput;
      return this.resolveBranchIncomingEdge(
        edge,
        graph,
        graphIndex,
        fromKey,
        whileOut.branchHandle,
      );
    }

    if ((fromOutput as ScraperNodeOutput | undefined)?.kind === 'scraper') {
      return this.resolveBranchIncomingEdge(
        edge,
        graph,
        graphIndex,
        fromKey,
        (fromOutput as ScraperNodeOutput).branchHandle,
      );
    }

    if ((fromOutput as SwarmNodeOutput | undefined)?.kind === 'swarm') {
      return this.resolveBranchIncomingEdge(
        edge,
        graph,
        graphIndex,
        fromKey,
        (fromOutput as SwarmNodeOutput).branchHandle,
      );
    }

    if ((fromOutput as UserApprovalNodeOutput | undefined)?.kind === 'user_approval') {
      return this.resolveBranchIncomingEdge(
        edge,
        graph,
        graphIndex,
        fromKey,
        (fromOutput as UserApprovalNodeOutput).branchHandle,
      );
    }

    if (fromNode?.kind === GraphNodeKind.SCRAPER) {
      return this.resolveBranchIncomingEdge(
        edge,
        graph,
        graphIndex,
        fromKey,
        (fromOutput as ScraperNodeOutput | undefined)?.branchHandle ?? '',
      );
    }

    if (fromNode?.kind === GraphNodeKind.SWARM) {
      return this.resolveBranchIncomingEdge(
        edge,
        graph,
        graphIndex,
        fromKey,
        (fromOutput as SwarmNodeOutput | undefined)?.branchHandle ?? '',
      );
    }

    if (fromNode?.kind === GraphNodeKind.USER_APPROVAL) {
      return this.resolveBranchIncomingEdge(
        edge,
        graph,
        graphIndex,
        fromKey,
        (fromOutput as UserApprovalNodeOutput | undefined)?.branchHandle ?? '',
      );
    }

    if (edge.type === GraphEdgeType.CONDITIONAL) {
      const workerKey = fromNode?.workerId?.toString() ?? fromKey;
      const output = context.getWorkerOutput(workerKey) ?? fromOutput ?? {};
      return this.evaluateCondition(edge.condition, output) ? 'satisfied' : 'blocked';
    }

    return 'satisfied';
  }

  /** Routes edges from if/else, scraper, or user-approval nodes by `sourceHandle` (branch id). */
  private resolveBranchIncomingEdge(
    edge: SwarmGraph['edges'][number],
    graph: SwarmGraph,
    graphIndex: GraphIndex,
    fromNodeId: string,
    branchHandle: string,
    branchCaseId?: string,
  ): IncomingEdgeResolution {
    const handle = edge.sourceHandle?.trim() || null;
    if (handle && this.branchHandlesMatch(branchHandle, handle, branchCaseId)) {
      return 'satisfied';
    }

    const fromNode = graphIndex.nodesById.get(fromNodeId);
    if (fromNode?.kind === GraphNodeKind.IF_ELSE) {
      const outgoing = graph.edges.filter(
        (candidate) =>
          edgeEndpointNodeId(candidate.from.toString(), graphIndex) === fromNodeId,
      );
      if (
        this.ifElseSingleOutgoingWireIsActiveBranch(
          edge,
          outgoing,
          graphIndex,
          branchHandle,
        )
      ) {
        return 'satisfied';
      }
      return 'blocked';
    }

    if (fromNode?.kind === GraphNodeKind.WHILE) {
      const outgoing = graph.edges.filter(
        (candidate) =>
          edgeEndpointNodeId(candidate.from.toString(), graphIndex) === fromNodeId,
      );
      if (
        this.whileSingleOutgoingWireIsActiveBranch(
          edge,
          outgoing,
          graphIndex,
          branchHandle,
        )
      ) {
        return 'satisfied';
      }
      return 'blocked';
    }

    if (handle) {
      return 'blocked';
    }

    if (fromNode?.kind === GraphNodeKind.SCRAPER && branchHandle === SCRAPER_SUCCESS_HANDLE) {
      return 'satisfied';
    }

    if (fromNode?.kind === GraphNodeKind.SWARM && branchHandle === SUB_SWARM_SUCCESS_HANDLE) {
      return 'satisfied';
    }

    return 'blocked';
  }

  /**
   * When the active branch (e.g. user-approval reject) has no path to exit, the exit node is
   * skipped — finish the run with the last meaningful output instead of failing.
   */
  private resolveOutputWhenExitUnreachable(
    context: SwarmContext,
    graphIndex: GraphIndex,
    completed: Set<string>,
    exitWorkerKey: string,
  ): Record<string, unknown> | null {
    const exitOutput = context.getWorkerOutput(exitWorkerKey);
    if (exitOutput) {
      return exitOutput;
    }

    const completedIds = [...completed];
    for (let i = completedIds.length - 1; i >= 0; i -= 1) {
      const nodeId = completedIds[i];
      if (!nodeId) {
        continue;
      }
      const indexed = graphIndex.nodesById.get(nodeId);
      if (indexed?.workerId) {
        const workerOut = context.getWorkerOutput(indexed.workerId.toString());
        if (workerOut) {
          return workerOut;
        }
      }
    }

    for (let i = completedIds.length - 1; i >= 0; i -= 1) {
      const nodeId = completedIds[i];
      if (!nodeId) {
        continue;
      }
      const nodeOut = context.getNodeOutput(nodeId);
      if (nodeOut?.kind === 'end') {
        return (nodeOut as EndNodeOutput).output;
      }
      if (nodeOut && (nodeOut.kind === 'user_approval' || nodeOut.kind === 'ifelse' || nodeOut.kind === 'while')) {
        return nodeOut;
      }
    }

    return null;
  }

  private evaluateCondition(condition: string | null, output: Record<string, unknown>): boolean {
    if (!condition?.trim()) {
      return true;
    }
    // Safe default until a dedicated expression engine is added.
    if (condition === 'always') {
      return true;
    }
    if (condition.startsWith('output.')) {
      const path = condition.slice('output.'.length);
      return output[path] != null;
    }
    return Boolean(output[condition]);
  }
}
