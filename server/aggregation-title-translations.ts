import { createHash } from "node:crypto";
import type { AggregationEntry, AggregationView } from "./aggregation-desk.js";
import type { AiProviderConfig } from "./types.js";
import { TITLE_TRANSLATION_BATCH_LIMIT, needsTitleTranslation, validTitleTranslationRecord, type AggregationTitleTranslation, type TitleTranslationRecord, type TitleTranslationResult, type TitleTranslationTarget } from "./title-translation-types.js";

export const titleTranslationKey = (title: string, url: string) => createHash("sha256").update(JSON.stringify([title, url])).digest("hex");
export class TitleTranslationError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
export interface TitleTranslationDependencies {
  readView: () => Promise<AggregationView>;
  readCache: (keys: string[]) => Promise<TitleTranslationRecord[]>;
  writeCache: (records: TitleTranslationRecord[]) => Promise<void>;
  provider: () => Promise<AiProviderConfig>;
  generate: (input: { provider: AiProviderConfig; items: Array<{ key: string; title: string }> }) => Promise<{ output: unknown; model: string; translatedAt: string }>;
}
const allEntries = (view: AggregationView) => [...view.entries, ...Object.values(view.platformEntries).flat()];
const tuple = (entry: Pick<AggregationEntry, "id" | "title" | "url">) => JSON.stringify([entry.id, entry.title, entry.url]);
const requestTuple = (item: TitleTranslationTarget) => tuple({ id: item.entryId, title: item.title, url: item.url });
const decorate = (entry: Pick<AggregationEntry, "id" | "title" | "url">, record: TitleTranslationRecord): AggregationTitleTranslation => ({ ...record, entryId: entry.id, originalTitle: entry.title, url: entry.url });

function parseTargets(input: unknown): TitleTranslationTarget[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > TITLE_TRANSLATION_BATCH_LIMIT) throw new TitleTranslationError("每次只能翻译当前列表的 1–20 条标题");
  const ids = new Set<string>(), keys = new Set<string>();
  return input.map((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item) || Object.keys(item).sort().join(",") !== "entryId,title,url") throw new TitleTranslationError("标题翻译请求格式不正确");
    const value = item as TitleTranslationTarget;
    if (typeof value.entryId !== "string" || !value.entryId || value.entryId.length > 200 || typeof value.title !== "string" || !value.title || value.title.length > 2000
      || typeof value.url !== "string" || !value.url || value.url.length > 4000 || !needsTitleTranslation(value.title)) throw new TitleTranslationError("只能翻译列表中尚未有中文的原标题");
    const key = titleTranslationKey(value.title, value.url);
    if (ids.has(value.entryId) || keys.has(key)) throw new TitleTranslationError("标题翻译请求含重复条目");
    ids.add(value.entryId); keys.add(key); return { entryId: value.entryId, title: value.title, url: value.url };
  });
}
function assertCurrent(items: TitleTranslationTarget[], view: AggregationView) {
  const identities = new Set(allEntries(view).map(tuple));
  if (items.some(item => !identities.has(requestTuple(item)))) throw new TitleTranslationError("条目或原标题已不在当前快照，请刷新列表", 409);
}
function parseGenerated(result: Awaited<ReturnType<TitleTranslationDependencies["generate"]>>, requested: Array<{ key: string; title: string }>, provider: AiProviderConfig) {
  let value: unknown = result.output;
  try { if (typeof value === "string") value = JSON.parse(value); } catch { throw new TitleTranslationError("模型没有返回有效的标题翻译", 502); }
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).join(",") !== "items" || !Array.isArray((value as { items?: unknown }).items)) throw new TitleTranslationError("模型标题翻译格式不正确", 502);
  const items = (value as { items: unknown[] }).items, expected = new Set(requested.map(item => item.key)), seen = new Set<string>();
  if (items.length !== expected.size || result.model !== provider.model) throw new TitleTranslationError("模型返回的标题或模型身份不完整", 502);
  const records = items.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item) || Object.keys(item).sort().join(",") !== "key,titleZh") throw new TitleTranslationError("模型标题含未知字段", 502);
    const candidate = item as { key: string; titleZh: string };
    const record = { ...candidate, model: result.model, translatedAt: result.translatedAt };
    if (!expected.has(record.key) || seen.has(record.key) || !validTitleTranslationRecord(record)) throw new TitleTranslationError("模型返回的中文标题无法对应原标题", 502);
    seen.add(record.key); return record;
  });
  return records;
}

/** One manual batch, with immutable identity and shared work per missing key. */
export function createAggregationTitleTranslationDesk(deps: TitleTranslationDependencies) {
  const inFlight = new Map<string, Promise<TitleTranslationRecord>>();
  return {
    async cached(): Promise<AggregationTitleTranslation[]> {
      const entries = allEntries(await deps.readView()), keys = [...new Set(entries.map(entry => titleTranslationKey(entry.title, entry.url)))];
      const cache = new Map((await deps.readCache(keys)).filter(validTitleTranslationRecord).map(record => [record.key, record]));
      const seen = new Set<string>();
      return entries.flatMap(entry => {
        const identity = tuple(entry), record = cache.get(titleTranslationKey(entry.title, entry.url));
        if (!record || seen.has(identity)) return []; seen.add(identity); return [decorate(entry, record)];
      });
    },
    async translate(input: unknown): Promise<TitleTranslationResult> {
      const requested = parseTargets(input); assertCurrent(requested, await deps.readView());
      const keyed = requested.map(item => ({ ...item, key: titleTranslationKey(item.title, item.url) }));
      const cache = new Map((await deps.readCache(keyed.map(item => item.key))).filter(validTitleTranslationRecord).map(record => [record.key, record]));
      const fresh = keyed.filter(item => !cache.has(item.key) && !inFlight.has(item.key));
      if (fresh.length) {
        // Claim synchronously before provider/config IO so overlapping requests
        // cannot start a second call for the same immutable title and URL.
        const batch = (async () => {
          const provider = await deps.provider();
          const result = await deps.generate({ provider, items: fresh.map(item => ({ key: item.key, title: item.title })) });
          const records = parseGenerated(result, fresh, provider);
          assertCurrent(fresh, await deps.readView());
          await deps.writeCache(records); return new Map(records.map(record => [record.key, record]));
        })();
        for (const item of fresh) {
          const pending = batch.then(records => records.get(item.key)!); inFlight.set(item.key, pending);
          const clear = () => { if (inFlight.get(item.key) === pending) inFlight.delete(item.key); };
          void pending.then(clear, clear);
        }
      }
      const records = await Promise.all(keyed.map(item => cache.get(item.key) ?? inFlight.get(item.key)!));
      assertCurrent(requested, await deps.readView());
      return { items: keyed.map((item, index) => decorate({ id: item.entryId, title: item.title, url: item.url }, records[index]!)), requested: keyed.length, generated: fresh.length, cacheHits: keyed.filter(item => cache.has(item.key)).length };
    },
  };
}
