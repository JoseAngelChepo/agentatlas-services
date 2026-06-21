import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { UsersService } from '../../users/users.service';
import type { DuplicateSwarmDto } from '../dto/duplicate-swarm.dto';
import { AgentWorker, AgentWorkerDocument } from '../schemas/agent-worker.schema';
import {
  SwarmGraph,
  SwarmGraphDocument,
  SwarmGraphNode,
} from '../schemas/swarm-graph.schema';
import { SwarmDocument } from '../schemas/swarm.schema';
import { GraphNodeKind } from '../types/graph-node-kind.enum';
import { dedupeSwarmGraphEdges } from '../utils/dedupe-swarm-graph-edges';
import { graphNodeId, resolveNodeKind } from '../utils/graph-index';
import { AgentWorkersService } from './agent-workers.service';
import { SwarmGraphsService } from './swarm-graphs.service';
import { SwarmsService } from './swarms.service';

export type DuplicateSwarmResult = {
  swarm: SwarmDocument;
  graph: SwarmGraphDocument | null;
};

@Injectable()
export class SwarmDuplicationService {
  constructor(
    @InjectModel(SwarmGraph.name)
    private readonly swarmGraphModel: Model<SwarmGraphDocument>,
    @InjectModel(AgentWorker.name)
    private readonly agentWorkerModel: Model<AgentWorkerDocument>,
    private readonly swarmsService: SwarmsService,
    private readonly swarmGraphsService: SwarmGraphsService,
    private readonly agentWorkersService: AgentWorkersService,
    private readonly usersService: UsersService,
  ) {}

  async duplicateForUser(
    userId: string,
    sourceSwarmId: string,
    dto: DuplicateSwarmDto = {},
  ): Promise<DuplicateSwarmResult> {
    await this.usersService.assertCanCreateSwarms(userId);

    const source = await this.swarmsService.findByIdForUser(userId, sourceSwarmId);
    const sourceGraph = await this.findOptionalGraph(sourceSwarmId);

    const workerIdMap = await this.duplicateWorkers(userId, source, sourceGraph);
    const nodeIdMap = sourceGraph
      ? this.buildNodeIdMap(sourceGraph, workerIdMap)
      : new Map<string, string>();

    const newWorkers = source.workers.map((workerId) => {
      const key = workerId.toString();
      return new Types.ObjectId(workerIdMap.get(key) ?? key);
    });

    const swarm = await this.swarmsService.create(userId, {
      name: dto.name?.trim() || `Copy of ${source.name}`,
      description: source.description,
      goal: source.goal,
      topology: source.topology,
      workers: newWorkers.map((id) => id.toString()),
      version: source.version,
      isPublic: false,
      triggers: source.triggers ?? [],
    });

    const graph = sourceGraph
      ? await this.copyGraph(sourceGraph, swarm.id, workerIdMap, nodeIdMap)
      : null;

    return { swarm, graph };
  }

  private async findOptionalGraph(swarmId: string): Promise<SwarmGraphDocument | null> {
    try {
      return await this.swarmGraphsService.findBySwarmId(swarmId);
    } catch (err) {
      if (err instanceof NotFoundException) {
        return null;
      }
      throw err;
    }
  }

  private async duplicateWorkers(
    userId: string,
    source: SwarmDocument,
    sourceGraph: SwarmGraphDocument | null,
  ): Promise<Map<string, string>> {
    const workerKeys = new Set<string>(source.workers.map((id) => id.toString()));

    if (sourceGraph) {
      for (const node of sourceGraph.nodes) {
        if (resolveNodeKind(node) === GraphNodeKind.WORKER && node.workerId) {
          workerKeys.add(node.workerId.toString());
        }
      }
    }

    const workerIdMap = new Map<string, string>();
    if (workerKeys.size === 0) {
      return workerIdMap;
    }

    const workers = await this.agentWorkersService.findByIds(
      [...workerKeys].map((id) => new Types.ObjectId(id)),
    );

    for (const oldKey of workerKeys) {
      const worker = workers.get(oldKey);
      if (!worker || worker.createdBy.toString() !== userId) {
        continue;
      }

      const copy = await this.agentWorkerModel.create(this.cloneWorkerPayload(worker, userId));
      workerIdMap.set(oldKey, copy.id);
    }

    return workerIdMap;
  }

  private cloneWorkerPayload(worker: AgentWorkerDocument, userId: string) {
    return {
      name: worker.name,
      model: worker.model,
      systemPrompt: worker.systemPrompt,
      promptMessages: worker.promptMessages ?? [],
      upstreamFields: worker.upstreamFields ?? [],
      inputSchema: worker.inputSchema ?? {},
      outputSchema: worker.outputSchema ?? {},
      openaiTools: worker.openaiTools ?? {},
      grokTools: worker.grokTools ?? {},
      agentTools: worker.agentTools ?? [],
      swarmTools: worker.swarmTools ?? [],
      compressOutput: worker.compressOutput ?? false,
      maxRetries: worker.maxRetries ?? 3,
      timeoutMs: worker.timeoutMs ?? 60_000,
      createdBy: new Types.ObjectId(userId),
    };
  }

  private buildNodeIdMap(
    sourceGraph: SwarmGraphDocument,
    workerIdMap: Map<string, string>,
  ): Map<string, string> {
    const nodeIdMap = new Map<string, string>();

    for (const node of sourceGraph.nodes) {
      const oldNodeId = graphNodeId(node);
      if (nodeIdMap.has(oldNodeId)) {
        continue;
      }

      const kind = resolveNodeKind(node);
      if (kind === GraphNodeKind.WORKER && node.workerId) {
        const oldWorkerKey = node.workerId.toString();
        const newWorkerKey = workerIdMap.get(oldWorkerKey) ?? oldWorkerKey;
        const hadCustomId = Boolean(node.id?.trim() && node.id.trim() !== oldWorkerKey);
        nodeIdMap.set(oldNodeId, hadCustomId ? `agent-${newWorkerKey}` : newWorkerKey);
        continue;
      }

      nodeIdMap.set(oldNodeId, new Types.ObjectId().toString());
    }

    return nodeIdMap;
  }

  private remapTerminalNodeId(
    storedId: string | Types.ObjectId,
    nodeIdMap: Map<string, string>,
    workerIdMap: Map<string, string>,
  ): string {
    const key = storedId.toString();
    return nodeIdMap.get(key) ?? workerIdMap.get(key) ?? key;
  }

  private remapNodeData(
    data: Record<string, unknown> | undefined,
    nodeIdMap: Map<string, string>,
  ): Record<string, unknown> | undefined {
    if (!data) {
      return undefined;
    }

    const copy = structuredClone(data);
    const downstream = copy.downstreamNodeIds;
    if (Array.isArray(downstream)) {
      copy.downstreamNodeIds = downstream.map((id) =>
        typeof id === 'string' ? (nodeIdMap.get(id) ?? id) : id,
      );
    }
    return copy;
  }

  private copyGraphNode(
    node: SwarmGraphNode,
    nodeIdMap: Map<string, string>,
    workerIdMap: Map<string, string>,
  ) {
    const oldNodeId = graphNodeId(node);
    const newNodeId = nodeIdMap.get(oldNodeId) ?? oldNodeId;
    const kind = resolveNodeKind(node);

    let workerId: Types.ObjectId | undefined;
    if (kind === GraphNodeKind.WORKER && node.workerId) {
      const oldWorkerKey = node.workerId.toString();
      const newWorkerKey = workerIdMap.get(oldWorkerKey) ?? oldWorkerKey;
      workerId = new Types.ObjectId(newWorkerKey);
    }

    return {
      id: newNodeId,
      kind: node.kind,
      workerId,
      type: node.type,
      position: {
        x: node.position?.x ?? 0,
        y: node.position?.y ?? 0,
      },
      data: this.remapNodeData(node.data, nodeIdMap),
    };
  }

  private async copyGraph(
    sourceGraph: SwarmGraphDocument,
    targetSwarmId: string,
    workerIdMap: Map<string, string>,
    nodeIdMap: Map<string, string>,
  ): Promise<SwarmGraphDocument> {
    const nodes = sourceGraph.nodes.map((node) =>
      this.copyGraphNode(node, nodeIdMap, workerIdMap),
    );

    const edges = dedupeSwarmGraphEdges(
      sourceGraph.edges.map((edge) => ({
        from: nodeIdMap.get(edge.from.toString()) ?? edge.from.toString(),
        to: nodeIdMap.get(edge.to.toString()) ?? edge.to.toString(),
        type: edge.type,
        condition: edge.condition ?? null,
        sourceHandle: edge.sourceHandle ?? null,
      })),
    );

    const entryNode = this.remapTerminalNodeId(
      sourceGraph.entryNode,
      nodeIdMap,
      workerIdMap,
    );
    const exitNode = this.remapTerminalNodeId(sourceGraph.exitNode, nodeIdMap, workerIdMap);

    return this.swarmGraphModel.create({
      swarmId: new Types.ObjectId(targetSwarmId),
      nodes,
      edges,
      entryNode,
      exitNode,
    });
  }
}
