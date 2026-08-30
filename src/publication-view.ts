import type { ArticleDraft, PlatformPublicationConfirmation, PublicationPlatform } from "./types";

export const currentPlatformPublicationConfirmation = (
  draft: Pick<ArticleDraft, "publicationConfirmations">,
  platform: PublicationPlatform,
): PlatformPublicationConfirmation | undefined => {
  const confirmation = draft.publicationConfirmations?.[platform];
  return confirmation && !confirmation.staleAt ? confirmation : undefined;
};

export const withoutPlatformPublicationConfirmation = (
  draft: Pick<ArticleDraft, "publicationConfirmations">,
  platform: PublicationPlatform,
) => {
  if (!draft.publicationConfirmations?.[platform]) return draft.publicationConfirmations;
  const next = { ...draft.publicationConfirmations };
  delete next[platform];
  return Object.keys(next).length ? next : undefined;
};
