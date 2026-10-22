import { extractPage } from "./extractor.js";
import { referenceUrl } from "./draft-references.js";
import type { DraftReference, ExtractedPage } from "./types.js";

/** Source text is private reading material, never a fact ledger or an AI prompt. */
export const readDraftReference = async (
  input: string,
  readPage: (url: string) => Promise<ExtractedPage> = url => extractPage(url, 0),
): Promise<Pick<DraftReference, "title" | "text" | "author" | "readStatus">> => {
  const url = referenceUrl(input);
  try {
    const page = await readPage(url);
    if (!page.text.trim()) throw new Error("empty source");
    return { title: page.title.slice(0, 500) || new URL(url).hostname, text: page.text.slice(0, 100_000), author: page.author?.slice(0, 500), readStatus: "read" };
  } catch {
    throw new Error("暂时读不到原文，链接已保留；可以打开原文或粘贴需要的段落，继续写作");
  }
};
