import { extractPage } from "./extractor.js";
import { getLocalDatabase } from "./storage.js";
import type { LocalDatabase } from "./local-database.js";
import type { ExtractedPage } from "./types.js";

const sevenDaysMs = 7 * 24 * 60 * 60 * 1_000;

export const sourceSnapshotKey = (value: string) => {
  try {
    const url = new URL(value);
    url.hash = "";
    url.pathname = url.pathname.replace(/\/+$/u, "") || "/";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_.+|ref|source|spm|from)$/iu.test(key)) url.searchParams.delete(key);
    }
    return url.toString().toLocaleLowerCase();
  } catch {
    return value.trim().toLocaleLowerCase();
  }
};

export interface SourceSnapshotReadResult {
  page: ExtractedPage;
  capturedAt: string;
  fromCache: boolean;
  liveError?: string;
}

export const readSourceWithSnapshot = async ({
  url,
  imageLimit,
  extractor = extractPage,
  database,
  now = () => new Date(),
  maximumCacheAgeMs = sevenDaysMs,
}: {
  url: string;
  imageLimit: number;
  extractor?: (url: string, imageLimit: number) => Promise<ExtractedPage>;
  database?: LocalDatabase;
  now?: () => Date;
  maximumCacheAgeMs?: number;
}): Promise<SourceSnapshotReadResult> => {
  const store = database ?? await getLocalDatabase();
  const urlKey = sourceSnapshotKey(url);
  try {
    const page = await extractor(url, imageLimit);
    if (page.text.trim().length < 80) throw new Error("来源正文过短，未写入快照");
    const capturedAt = now().toISOString();
    store.saveSourceSnapshot({
      urlKey,
      requestedUrl: url,
      canonicalUrl: page.canonicalUrl || page.url || url,
      page,
      capturedAt,
    });
    return { page, capturedAt, fromCache: false };
  } catch (error) {
    const cached = store.getSourceSnapshot<ExtractedPage>(urlKey);
    const cacheAge = cached ? now().getTime() - Date.parse(cached.capturedAt) : Number.POSITIVE_INFINITY;
    if (cached && Number.isFinite(cacheAge) && cacheAge >= 0 && cacheAge <= maximumCacheAgeMs) {
      return {
        page: cached.page,
        capturedAt: cached.capturedAt,
        fromCache: true,
        liveError: error instanceof Error ? error.message : String(error),
      };
    }
    throw error;
  }
};
