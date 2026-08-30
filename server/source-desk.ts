import { collectCommunitySources, type CommunityCollectionResult } from "./community-sources.js";
import type {
  CollectionRequest,
  CollectionTopicId,
  RawHorizonItem,
  SourceConfig,
} from "./types.js";

export interface SignalBatch {
  items: RawHorizonItem[];
  failures: Record<string, string>;
  adapterCounts: Record<string, number>;
  horizonRunId?: string;
}

export interface SourceCollectRequest {
  sources: SourceConfig[];
  topicIds: CollectionTopicId[];
  filters?: Pick<CollectionRequest, "dateFrom" | "dateTo" | "keywords">;
  signal?: AbortSignal;
}

interface StructuredCollectionResult {
  items: RawHorizonItem[];
  horizonRunId?: string;
  failures?: Record<string, string>;
}

interface SourceDeskDependencies {
  collectStructured: (
    sources: SourceConfig[],
    request: SourceCollectRequest,
  ) => Promise<StructuredCollectionResult>;
  collectCommunity?: (
    sources: SourceConfig[],
    topicIds: CollectionTopicId[],
    filters: Pick<CollectionRequest, "keywords">,
    options: { signal?: AbortSignal },
  ) => Promise<CommunityCollectionResult>;
}

const isCommunityAdapter = (source: SourceConfig) =>
  source.kind === "zhihu" || source.kind === "last30days" || source.kind === "github";

/**
 * SourceDesk is the stable collection boundary. Callers do not need to know
 * whether a signal came from the Python RSS/HN collector, a CLI, or a public
 * community API. Adapter failures are returned per source and never execute
 * instructions embedded in remote content.
 */
export const createSourceDesk = (dependencies: SourceDeskDependencies) => ({
  async collect(request: SourceCollectRequest): Promise<SignalBatch> {
    const structuredSources = request.sources.filter((source) => !isCommunityAdapter(source));
    const communitySources = request.sources.filter(isCommunityAdapter);
    const failures: Record<string, string> = {};
    const structuredPromise = structuredSources.length
      ? dependencies.collectStructured(structuredSources, request).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        for (const source of structuredSources) failures[source.id] = message;
        return { items: [], horizonRunId: undefined, failures: {} } satisfies StructuredCollectionResult;
      })
      : Promise.resolve({ items: [], horizonRunId: undefined, failures: {} } satisfies StructuredCollectionResult);
    const communityPromise = communitySources.length
      ? (dependencies.collectCommunity ?? collectCommunitySources)(
        communitySources,
        request.topicIds,
        { keywords: request.filters?.keywords },
        { signal: request.signal },
      ).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        for (const source of communitySources) failures[source.id] = message;
        return { items: [], failures: {} };
      })
      : Promise.resolve({ items: [], failures: {} });
    const [structured, community] = await Promise.all([structuredPromise, communityPromise]);
    Object.assign(failures, structured.failures);
    Object.assign(failures, community.failures);
    const items = [...structured.items, ...community.items];
    const adapterCounts: Record<string, number> = {};
    for (const item of items) adapterCounts[item.source_type] = (adapterCounts[item.source_type] ?? 0) + 1;
    return { items, failures, adapterCounts, horizonRunId: structured.horizonRunId };
  },
});
