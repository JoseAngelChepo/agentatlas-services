import type { ScrapeRequestDocument } from '../schemas/scrape-request.schema';

type WithTimestamps = { createdAt?: Date; updatedAt?: Date };

export function serializeScrapeRequest(doc: ScrapeRequestDocument) {
  const { createdAt, updatedAt } = doc.toObject() as WithTimestamps;

  return {
    id: doc.id,
    userId: doc.userId.toString(),
    url: doc.url,
    status: doc.status,
    rawContent: doc.rawContent,
    compressedContent: doc.compressedContent,
    links: doc.links ?? [],
    format: doc.format,
    error: doc.error,
    source: doc.source,
    waitUntil: doc.waitUntil,
    swarmRunId: doc.swarmRunId?.toString() ?? null,
    agentRunId: doc.agentRunId?.toString() ?? null,
    latencyMs: doc.latencyMs,
    createdAt,
    updatedAt,
  };
}
