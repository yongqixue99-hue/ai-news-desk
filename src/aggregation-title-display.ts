import type { AggregationEntry } from "../server/aggregation-desk.js";
import { TITLE_TRANSLATION_BATCH_LIMIT, needsTitleTranslation, validTitleTranslationRecord, type AggregationTitleTranslation, type TitleTranslationTarget } from "../server/title-translation-types.js";

export const titleTranslationFor = (entry: AggregationEntry, translations: AggregationTitleTranslation[]) => translations.find(record =>
  record.entryId === entry.id && record.originalTitle === entry.title && record.url === entry.url && validTitleTranslationRecord(record));

/** Filter/render first. Translation must never reach a hidden page or channel. */
export function visibleTranslationTargets(filteredEntries: AggregationEntry[], visibleLimit: number, translations: AggregationTitleTranslation[]): TitleTranslationTarget[] {
  return filteredEntries.slice(0, visibleLimit).filter(entry => needsTitleTranslation(entry.title) && !titleTranslationFor(entry, translations))
    .slice(0, TITLE_TRANSLATION_BATCH_LIMIT).map(entry => ({ entryId: entry.id, title: entry.title, url: entry.url }));
}
