import type { ContentPackage } from "./product-types.js";

export const pendingSourceReadingNotice = "原文待读取；资料核对完成后才能生成文章";

/** A preflight notice is resolved by quoted body evidence; factual limits remain. */
export const packageUncertaintiesFor = (contentPackage: Pick<ContentPackage, "facts" | "sources" | "uncertainties">) => {
  const verifiedBody = contentPackage.sources.some((source) => source.basis === "full-source" && !source.isCommunity)
    && contentPackage.facts.some((fact) => ["supported", "partially-supported"].includes(fact.status) && fact.quotations?.length);
  return contentPackage.uncertainties.filter((notice) => !verifiedBody || notice !== pendingSourceReadingNotice);
};
