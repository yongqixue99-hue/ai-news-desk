const communityPlatformPattern = /Hacker News|Reddit|V2EX|知乎|社区|讨论串/u;
const discoveryActionPattern = /线索|发现|指向|讨论|关注|(?:被)?(?:转发|转载|提交|贴|发布|转)到/u;

/**
 * Community platforms can discover an event, but that discovery path is not
 * itself an event fact. This predicate is shared by package construction and
 * draft presentation so the wording cannot silently re-enter the fact ledger.
 */
export const isCommunityDiscoveryFraming = (value: string) => {
  const text = value.trim();
  return communityPlatformPattern.test(text) && discoveryActionPattern.test(text);
};
