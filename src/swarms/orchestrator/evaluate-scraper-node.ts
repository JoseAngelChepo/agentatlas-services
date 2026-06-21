import { BadRequestException } from '@nestjs/common';
import type { AgentWorker } from '../schemas/agent-worker.schema';
import type { SwarmGraph } from '../schemas/swarm-graph.schema';
import type { SwarmContext } from '../context/swarm-context';
import type { ScraperService } from '../../scraper/scraper.service';
import { ScrapeRequestSource } from '../../scraper/types/scrape-request-source.enum';
import type { ScraperNodeData, ScraperNodeOutput } from '../../scraper/types/scraper-node.types';
import {
  SCRAPER_FAILED_HANDLE,
  SCRAPER_SUCCESS_HANDLE,
} from '../../scraper/types/scraper-node.types';
import { buildSwarmExpressionContext } from '../utils/build-swarm-expression-context';
import type { GraphIndex } from '../utils/graph-index';

function parseUrlSource(data: Record<string, unknown> | undefined): ScraperNodeData['urlSource'] {
  if (data?.urlSource === 'static') return 'static';
  if (data?.urlSource === 'upstream') return 'upstream';
  return 'runInput';
}

export function parseScraperNodeData(data: Record<string, unknown> | undefined): ScraperNodeData {
  return {
    label: typeof data?.label === 'string' ? data.label : undefined,
    urlSource: parseUrlSource(data),
    urlPath: typeof data?.urlPath === 'string' ? data.urlPath : 'website',
    url: typeof data?.url === 'string' ? data.url : undefined,
    waitUntil:
      data?.waitUntil === 'load' ||
      data?.waitUntil === 'domcontentloaded' ||
      data?.waitUntil === 'networkidle0' ||
      data?.waitUntil === 'networkidle2'
        ? data.waitUntil
        : undefined,
  };
}

function readStringField(payload: Record<string, unknown> | undefined, key: string): string | null {
  const value = payload?.[key];
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  return null;
}

function resolveUpstreamUrlPath(
  urlPath: string,
  graph: SwarmGraph,
  graphIndex: GraphIndex,
  context: SwarmContext,
  nodeId: string,
  workers: Map<string, AgentWorker>,
): string {
  const path = urlPath.trim();
  if (!path) {
    throw new BadRequestException('Scraper node: upstream path is not configured');
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
    throw new BadRequestException(`Scraper node: missing URL in upstream.${path}`);
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

  throw new BadRequestException(`Scraper node: missing URL in upstream.${path}`);
}

export function resolveScraperUrl(
  data: ScraperNodeData,
  context: SwarmContext,
  options?: {
    graph?: SwarmGraph;
    graphIndex?: GraphIndex;
    nodeId?: string;
    workers?: Map<string, AgentWorker>;
  },
): string {
  if (data.urlSource === 'static') {
    const url = data.url?.trim();
    if (!url) {
      throw new BadRequestException('Scraper node: static URL is not configured');
    }
    return url;
  }

  if (data.urlSource === 'upstream') {
    const { graph, graphIndex, nodeId, workers } = options ?? {};
    if (!graph || !graphIndex || !nodeId || !workers) {
      throw new BadRequestException('Scraper node: upstream URL requires graph context');
    }
    return resolveUpstreamUrlPath(data.urlPath ?? '', graph, graphIndex, context, nodeId, workers);
  }

  const key = data.urlPath?.trim() || 'website';
  const value = context.runInput[key];
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  throw new BadRequestException(`Scraper node: missing URL in runInput.${key}`);
}

export async function executeScraperNode(params: {
  scraperService: ScraperService;
  data: ScraperNodeData;
  context: SwarmContext;
  userId: string;
  swarmRunId: string;
  graph?: SwarmGraph;
  graphIndex?: GraphIndex;
  nodeId?: string;
  workers?: Map<string, AgentWorker>;
}): Promise<ScraperNodeOutput> {
  const { scraperService, data, context, userId, swarmRunId, graph, graphIndex, nodeId, workers } =
    params;
  const url = resolveScraperUrl(data, context, { graph, graphIndex, nodeId, workers });
  const started = Date.now();

  try {
    const result = await scraperService.scrapeWebpage(
      { url, waitUntil: data.waitUntil },
      {
        userId,
        source: ScrapeRequestSource.AGENT,
        swarmRunId,
      },
    );

    return {
      kind: 'scraper',
      branchHandle: SCRAPER_SUCCESS_HANDLE,
      scrapeRequestId: result.scrapeRequestId,
      url: result.url,
      status: 'completed',
      content: result.content,
      error: null,
      format: 'markdown',
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Scrape failed';
    return {
      kind: 'scraper',
      branchHandle: SCRAPER_FAILED_HANDLE,
      scrapeRequestId: null,
      url,
      status: 'failed',
      content: null,
      error: message,
      format: 'markdown',
      latencyMs: Date.now() - started,
    };
  }
}
