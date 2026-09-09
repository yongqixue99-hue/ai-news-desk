import { collectCommunitySources, type CommunityCollectionResult } from "./community-sources.js";
import type {
  CollectionRequest,
  CollectionTopicId,
  RawHorizonItem,
  SourceConfig,
  SourceRouteResult,
} from "./types.js";
import { sourceRoleFor, sourceSupportsTopics } from "./source-routing.js";
import { hasOfficialUpdateAnchor } from "./official-update-url.js";
import type { XAccountObservation } from "./x-official.js";
export { createZhihuHotlist } from "./zhihu-hotlist.js";
export { buildTopicFeed, communityPlatforms, retainZhihuTopic } from "./topic-feeds.js";

export interface SignalBatch {
  items: RawHorizonItem[];
  failures: Record<string, string>;
  adapterCounts: Record<string, number>;
  horizonRunId?: string;
  sourceCursors?: Record<string, string>;
  xAccountObservations?: Record<string, XAccountObservation[]>;
  routeResults?: SourceRouteResult[];
}

export interface SourceCollectRequest {
  sources: SourceConfig[];
  topicIds: CollectionTopicId[];
  filters?: Pick<CollectionRequest, "dateFrom" | "dateTo" | "keywords">;
  signal?: AbortSignal;
}

export const deduplicateDiscoveryItems = (items: RawHorizonItem[]) => {
  const seen = new Set<string>();
  return items.filter((item) => {
    let key = item.url;
    try {
      const url = new URL(item.url);
      if (!hasOfficialUpdateAnchor(url)) url.hash = "";
      for (const parameter of [...url.searchParams.keys()]) {
        if (/^(?:utm_.+|fbclid|gclid)$/iu.test(parameter)) url.searchParams.delete(parameter);
      }
      url.searchParams.sort();
      key = url.href;
    } catch { /* Preserve unrecognized identities; validation belongs to the adapter. */ }
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

interface StructuredCollectionResult {
  items: RawHorizonItem[];
  horizonRunId?: string;
  failures?: Record<string, string>;
  routeResults?: SourceRouteResult[];
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
  collectXOfficial?: (
    sources: SourceConfig[],
    options: { signal?: AbortSignal },
  ) => Promise<{
    items: RawHorizonItem[];
    failures: Record<string, string>;
    cursors: Record<string, string>;
    accountObservations?: Record<string, XAccountObservation[]>;
  }>;
}

const isCommunityAdapter = (source: SourceConfig) =>
  source.kind === "zhihu" || source.kind === "last30days" || source.kind === "github";

const hongKongDate = (value: Date) => {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
};

/**
 * Build the narrow, predictable collection request used by the Today search.
 * It deliberately excludes community and X adapters: this path is for factual
 * source discovery, while community discussion remains an explicit later step.
 */
export const buildFocusedNewsSearchRequest = (
  sources: SourceConfig[],
  query: string,
  topicIds: CollectionTopicId[] = ["ai"],
  now = new Date(),
): CollectionRequest => ({
  sourceIds: sources
    .filter((source) => source.enabled
      && source.kind !== "x"
      && sourceRoleFor(source) !== "community"
      && sourceSupportsTopics(source, topicIds))
    .slice(0, 50)
    .map((source) => source.id),
  topicIds,
  dateFrom: hongKongDate(new Date(now.getTime() - 6 * 86_400_000)),
  dateTo: hongKongDate(now),
  keywords: query.trim(),
});

/**
 * SourceDesk is the stable collection boundary. Callers do not need to know
 * whether a signal came from the Python RSS/HN collector, a CLI, or a public
 * community API. Adapter failures are returned per source and never execute
 * instructions embedded in remote content.
 */
export const createSourceDesk = (dependencies: SourceDeskDependencies) => ({
  async collect(request: SourceCollectRequest): Promise<SignalBatch> {
    const structuredSources = request.sources.filter((source) => !isCommunityAdapter(source) && source.kind !== "x");
    const communitySources = request.sources.filter(isCommunityAdapter);
    const xSources = request.sources.filter((source) => source.kind === "x");
    const failures: Record<string, string> = {};
    const structuredPromise: Promise<StructuredCollectionResult> = structuredSources.length
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
    const xPromise = xSources.length
      ? dependencies.collectXOfficial
        ? dependencies.collectXOfficial(xSources, { signal: request.signal }).catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          for (const source of xSources) failures[source.id] = message;
          return { items: [], failures: {}, cursors: {}, accountObservations: {} };
        })
        : Promise.resolve({
          items: [],
          failures: Object.fromEntries(xSources.map((source) => [source.id, "X 官方来源适配器尚未配置"])),
          cursors: {},
          accountObservations: {},
        })
      : Promise.resolve({ items: [], failures: {}, cursors: {}, accountObservations: {} });
    const [structured, community, xOfficial] = await Promise.all([structuredPromise, communityPromise, xPromise]);
    Object.assign(failures, structured.failures);
    Object.assign(failures, community.failures);
    Object.assign(failures, xOfficial.failures);
    const items = [...structured.items, ...community.items, ...xOfficial.items];
    const adapterCounts: Record<string, number> = {};
    for (const item of items) adapterCounts[item.source_type] = (adapterCounts[item.source_type] ?? 0) + 1;
    return {
      items,
      failures,
      adapterCounts,
      horizonRunId: structured.horizonRunId,
      routeResults: structured.routeResults ?? [],
      sourceCursors: xOfficial.cursors,
      xAccountObservations: xOfficial.accountObservations,
    };
  },
});
