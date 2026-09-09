/** These official update pages use fragments as event identities, not decoration. */
export const hasOfficialUpdateAnchor = (url: URL) => Boolean(url.hash) && url.protocol === "https:"
  && !url.username && !url.password && !url.port
  && ((url.hostname === "api-docs.deepseek.com" && /^\/updates\/?$/u.test(url.pathname))
    || (url.hostname === "ai.google.dev" && /^\/gemini-api\/docs\/changelog\/?$/u.test(url.pathname))
    || (url.hostname === "platform.claude.com" && url.pathname === "/docs/en/release-notes/overview"));

export const areDistinctOfficialUpdates = (left: string, right: string) => {
  try {
    const a = new URL(left);
    const b = new URL(right);
    return hasOfficialUpdateAnchor(a) && hasOfficialUpdateAnchor(b)
      && a.hostname === b.hostname && a.pathname.replace(/\/$/u, "") === b.pathname.replace(/\/$/u, "")
      && a.hash !== b.hash;
  } catch { return false; }
};
