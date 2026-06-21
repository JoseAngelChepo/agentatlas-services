import { BadRequestException } from '@nestjs/common';
import type { AgentWorker } from '../schemas/agent-worker.schema';
import type { SwarmGraph } from '../schemas/swarm-graph.schema';
import type { SwarmContext } from '../context/swarm-context';
import type { ResearchService } from '../../research/research.service';
import type {
  ResearchPapersNodeData,
  ResearchPapersNodeOutput,
} from '../../research/types/research-papers-node.types';
import {
  RESEARCH_PAPERS_FAILED_HANDLE,
  RESEARCH_PAPERS_SUCCESS_HANDLE,
} from '../../research/types/research-papers-node.types';
import { buildSwarmExpressionContext } from '../utils/build-swarm-expression-context';
import type { GraphIndex } from '../utils/graph-index';

function parseQuerySource(
  data: Record<string, unknown> | undefined,
): ResearchPapersNodeData['querySource'] {
  if (data?.querySource === 'static') return 'static';
  if (data?.querySource === 'upstream') return 'upstream';
  return 'runInput';
}

export function parseResearchPapersNodeData(
  data: Record<string, unknown> | undefined,
): ResearchPapersNodeData {
  const limitRaw = data?.limit;
  const limit =
    typeof limitRaw === 'number' && Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.min(Math.floor(limitRaw), 50)
      : undefined;

  return {
    label: typeof data?.label === 'string' ? data.label : undefined,
    querySource: parseQuerySource(data),
    queryPath: typeof data?.queryPath === 'string' ? data.queryPath : 'query',
    query: typeof data?.query === 'string' ? data.query : undefined,
    limit,
  };
}

function readStringField(payload: Record<string, unknown> | undefined, key: string): string | null {
  const value = payload?.[key];
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  return null;
}

function resolveUpstreamQueryPath(
  queryPath: string,
  graph: SwarmGraph,
  graphIndex: GraphIndex,
  context: SwarmContext,
  nodeId: string,
  workers: Map<string, AgentWorker>,
): string {
  const path = queryPath.trim();
  if (!path) {
    throw new BadRequestException('Research papers node: upstream path is not configured');
  }

  const exprCtx = buildSwarmExpressionContext(graph, graphIndex, context, nodeId, workers);

  if (path.includes('.')) {
    const dot = path.indexOf('.');
    const slug = path.slice(0, dot);
    const field = path.slice(dot + 1);
    const fromSlug = readStringField(exprCtx.upstreamBySlug[slug], field);
    if (fromSlug) {
      return fromSlug;
    }
    throw new BadRequestException(`Research papers node: missing query in upstream.${path}`);
  }

  const fromOutput = readStringField(exprCtx.output as Record<string, unknown>, path);
  if (fromOutput) {
    return fromOutput;
  }

  for (const payload of exprCtx.upstream) {
    const fromUpstream = readStringField(payload, path);
    if (fromUpstream) {
      return fromUpstream;
    }
  }

  throw new BadRequestException(`Research papers node: missing query in upstream.${path}`);
}

export function resolveResearchPapersQuery(
  data: ResearchPapersNodeData,
  context: SwarmContext,
  options?: {
    graph?: SwarmGraph;
    graphIndex?: GraphIndex;
    nodeId?: string;
    workers?: Map<string, AgentWorker>;
  },
): string {
  if (data.querySource === 'static') {
    const query = data.query?.trim();
    if (!query) {
      throw new BadRequestException('Research papers node: static query is not configured');
    }
    return query;
  }

  if (data.querySource === 'upstream') {
    const { graph, graphIndex, nodeId, workers } = options ?? {};
    if (!graph || !graphIndex || !nodeId || !workers) {
      throw new BadRequestException('Research papers node: upstream query requires graph context');
    }
    return resolveUpstreamQueryPath(
      data.queryPath ?? '',
      graph,
      graphIndex,
      context,
      nodeId,
      workers,
    );
  }

  const key = data.queryPath?.trim() || 'query';
  const value = context.runInput[key];
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  throw new BadRequestException(`Research papers node: missing query in runInput.${key}`);
}

export async function executeResearchPapersNode(params: {
  researchService: ResearchService;
  data: ResearchPapersNodeData;
  context: SwarmContext;
  graph?: SwarmGraph;
  graphIndex?: GraphIndex;
  nodeId?: string;
  workers?: Map<string, AgentWorker>;
}): Promise<ResearchPapersNodeOutput> {
  const { researchService, data, context, graph, graphIndex, nodeId, workers } = params;
  const query = resolveResearchPapersQuery(data, context, { graph, graphIndex, nodeId, workers });
  const started = Date.now();

  try {
    const papers = await researchService.searchPapers(query, { limit: data.limit ?? 10 });

    return {
      kind: 'research_papers',
      branchHandle: RESEARCH_PAPERS_SUCCESS_HANDLE,
      query,
      status: 'completed',
      papers,
      paperCount: papers.length,
      error: null,
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Research search failed';
    return {
      kind: 'research_papers',
      branchHandle: RESEARCH_PAPERS_FAILED_HANDLE,
      query,
      status: 'failed',
      papers: [],
      paperCount: 0,
      error: message,
      latencyMs: Date.now() - started,
    };
  }
}
