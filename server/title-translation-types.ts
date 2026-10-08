/** Display-only records. Never pass these into editorial facts or scoring. */
export const TITLE_TRANSLATION_BATCH_LIMIT = 20;
export interface TitleTranslationTarget { entryId: string; title: string; url: string }
export interface TitleTranslationRecord { key: string; titleZh: string; model: string; translatedAt: string }
export interface AggregationTitleTranslation extends TitleTranslationRecord { entryId: string; originalTitle: string; url: string }
export interface TitleTranslationResult { items: AggregationTitleTranslation[]; requested: number; generated: number; cacheHits: number }
export const needsTitleTranslation = (title: string) => /[a-z]/iu.test(title) && !/\p{Script=Han}/u.test(title);
export const validTitleTranslationRecord = (record: TitleTranslationRecord) =>
  /^[0-9a-f]{64}$/u.test(record.key) && typeof record.titleZh === "string" && record.titleZh.trim() === record.titleZh
  && record.titleZh.length >= 2 && record.titleZh.length <= 200 && /\p{Script=Han}/u.test(record.titleZh)
  && !/[\u0000-\u001f<>]/u.test(record.titleZh) && typeof record.model === "string" && record.model.length > 0 && record.model.length <= 200
  && typeof record.translatedAt === "string" && Number.isFinite(Date.parse(record.translatedAt));
