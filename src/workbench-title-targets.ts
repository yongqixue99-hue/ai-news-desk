import type { Candidate } from "./types";

export const WORKBENCH_TITLE_BATCH = 20;

/**
 * Candidates on the workbench that still show only the source-language title,
 * in the order the page displays them. One manual request stays bounded.
 */
export const workbenchTitleTargets = (
  displayed: Array<Candidate | undefined>,
  limit = WORKBENCH_TITLE_BATCH,
): string[] => {
  const ids: string[] = [];
  for (const candidate of displayed) {
    if (!candidate || candidate.briefing || ids.includes(candidate.id)) continue;
    ids.push(candidate.id);
    if (ids.length >= limit) break;
  }
  return ids;
};
