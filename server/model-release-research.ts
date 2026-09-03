export type ModelResearchVendor = "anthropic" | "openai" | "gemini" | "deepseek" | "qwen";

export interface ModelResearchTarget {
  url: string;
  sourceName: string;
  role: "official" | "research";
  vendor: ModelResearchVendor;
}

const slugifyModelName = (value: string) => value
  .normalize("NFKC")
  .trim()
  .toLocaleLowerCase("en-US")
  .replace(/[_\s]+/gu, "-")
  .replace(/[^a-z0-9.-]+/gu, "-")
  .replace(/-+/gu, "-")
  .replace(/^-|-$/gu, "");

const firstMatch = (title: string, expression: RegExp) => {
  const match = title.match(expression)?.[1];
  return match ? slugifyModelName(match) : undefined;
};

const detectedVendor = (title: string): { vendor: ModelResearchVendor; modelSlug?: string } | undefined => {
  const anthropicModel = firstMatch(
    title,
    /\b((?:claude[\s-]+)?(?:fable|mythos|opus|sonnet|haiku)[\s-]+\d+(?:\.\d+)+)\b/iu,
  );
  if (anthropicModel) {
    return {
      vendor: "anthropic",
      modelSlug: anthropicModel.replace(/^claude-/u, ""),
    };
  }

  const deepSeekModel = firstMatch(
    title,
    /\b(deepseek[\s-]*(?:r|v)\d+(?:\.\d+)*(?:[\s-]+(?:pro|flash|lite|vision|exp|\d+))*)\b/iu,
  );
  if (deepSeekModel || /\bdeepseek\b/iu.test(title)) {
    return { vendor: "deepseek", modelSlug: deepSeekModel };
  }

  const qwenModel = firstMatch(
    title,
    /\b(qwen[\s-]*\d+(?:\.\d+)*(?:[\s-]+(?:max|plus|flash|turbo|coder|vl|omni|image|a\d+b?))*)\b/iu,
  );
  if (qwenModel || /(?:\bqwen\b|通义千问)/iu.test(title)) {
    return { vendor: "qwen", modelSlug: qwenModel };
  }

  const geminiModel = firstMatch(
    title,
    /\b(gemini[\s-]*\d+(?:\.\d+)*(?:[\s-]+(?:pro|flash|ultra|nano|lite|preview))*)\b/iu,
  );
  if (geminiModel || /\bgemini\b/iu.test(title)) {
    return { vendor: "gemini", modelSlug: geminiModel };
  }

  const openAiModel = firstMatch(
    title,
    /\b((?:gpt[\s-]*\d+(?:\.\d+)*(?:[\s-]+(?:sol|terra|luna|mini|nano|pro|turbo|chat|codex))?|o\d+(?:[\s-]+(?:mini|pro))?|astra))\b/iu,
  );
  if (openAiModel || /\bopenai\b/iu.test(title)) {
    return { vendor: "openai", modelSlug: openAiModel };
  }

  return undefined;
};

export const modelResearchVendorFor = (title: string): ModelResearchVendor | undefined =>
  detectedVendor(title)?.vendor;

export const firstPartyModelVendorFor = (identity: {
  sourceName?: string;
  url?: string;
}): ModelResearchVendor | undefined => {
  let hostname = "";
  let pathname = "";
  try {
    const url = new URL(identity.url ?? "");
    hostname = url.hostname.toLocaleLowerCase();
    pathname = url.pathname.toLocaleLowerCase();
  } catch {
    // The caller's URL validation owns malformed URLs. This helper only
    // classifies a source when its first-party identity is unambiguous.
  }
  const sourceName = (identity.sourceName ?? "").toLocaleLowerCase();
  if (hostname === "openai.com" || hostname.endsWith(".openai.com") || /\bopenai\b/u.test(sourceName)) {
    return "openai";
  }
  if (hostname === "anthropic.com" || hostname.endsWith(".anthropic.com")
    || hostname === "claude.com" || hostname.endsWith(".claude.com")
    || /\b(?:anthropic|claude platform)\b/u.test(sourceName)) {
    return "anthropic";
  }
  if (hostname === "deepseek.com" || hostname.endsWith(".deepseek.com") || /\bdeepseek\b/u.test(sourceName)) {
    return "deepseek";
  }
  if (hostname === "qwen.ai" || hostname.endsWith(".qwen.ai")
    || (hostname.endsWith("alibabacloud.com") && pathname.includes("/model-studio"))
    || /(?:\bqwen\b|通义千问|alibaba cloud model studio)/u.test(sourceName)) {
    return "qwen";
  }
  if (hostname === "ai.google.dev" || hostname === "deepmind.google"
    || hostname.endsWith(".deepmind.google")
    || /(?:\bgemini\b|google deepmind model cards)/u.test(sourceName)) {
    return "gemini";
  }
  return undefined;
};

/**
 * Stable, vendor-owned pages used to fill a model-release dossier. Exact
 * announcement URLs still come from SourceDesk/X; these targets fill only
 * details that actually repeat the detected model anchors.
 */
export const modelResearchTargetsFor = (storyTitle: string): ModelResearchTarget[] => {
  const detected = detectedVendor(storyTitle);
  if (!detected) return [];
  const targets: ModelResearchTarget[] = [];
  const seen = new Set<string>();
  const add = (target: Omit<ModelResearchTarget, "vendor">) => {
    if (seen.has(target.url)) return;
    seen.add(target.url);
    targets.push({ ...target, vendor: detected.vendor });
  };
  const vendorModelSlug = detected.vendor === "anthropic"
    ? detected.modelSlug?.replace(/\./gu, "-")
    : detected.modelSlug;
  const benchmarkSlug = vendorModelSlug
    ? vendorModelSlug.startsWith("claude-")
      ? vendorModelSlug
      : detected.vendor === "anthropic"
        ? `claude-${vendorModelSlug}`
        : vendorModelSlug
    : undefined;

  if (detected.vendor === "anthropic") {
    if (vendorModelSlug) add({
      url: `https://platform.claude.com/docs/en/models/${vendorModelSlug}/overview`,
      sourceName: "Claude Platform Docs",
      role: "official",
    });
    add({
      url: "https://platform.claude.com/docs/en/about-claude/pricing",
      sourceName: "Claude Platform Docs",
      role: "official",
    });
  }

  if (detected.vendor === "openai") {
    if (detected.modelSlug) add({
      url: `https://developers.openai.com/api/docs/models/${detected.modelSlug}`,
      sourceName: "OpenAI API Docs",
      role: "official",
    });
    add({
      url: "https://developers.openai.com/api/docs/models",
      sourceName: "OpenAI API Docs",
      role: "official",
    });
    add({
      url: "https://developers.openai.com/api/docs/changelog",
      sourceName: "OpenAI API Changelog",
      role: "official",
    });
    add({
      url: "https://developers.openai.com/api/docs/pricing",
      sourceName: "OpenAI API Docs",
      role: "official",
    });
    add({
      url: "https://help.openai.com/en/articles/9624314-model-release-notes",
      sourceName: "OpenAI Model Release Notes",
      role: "official",
    });
  }

  if (detected.vendor === "gemini") {
    add({
      url: "https://ai.google.dev/gemini-api/docs/models",
      sourceName: "Gemini API Docs",
      role: "official",
    });
    add({
      url: "https://ai.google.dev/gemini-api/docs/changelog",
      sourceName: "Gemini API Changelog",
      role: "official",
    });
    add({
      url: "https://ai.google.dev/gemini-api/docs/pricing",
      sourceName: "Gemini API Docs",
      role: "official",
    });
    add({
      url: "https://deepmind.google/models/model-cards/",
      sourceName: "Google DeepMind Model Cards",
      role: "official",
    });
  }

  if (detected.vendor === "deepseek") {
    add({ url: "https://www.deepseek.com/", sourceName: "DeepSeek", role: "official" });
    add({
      url: "https://api-docs.deepseek.com/updates/",
      sourceName: "DeepSeek API Change Log",
      role: "official",
    });
    add({
      url: "https://api-docs.deepseek.com/quick_start/pricing/",
      sourceName: "DeepSeek API Docs",
      role: "official",
    });
  }

  if (detected.vendor === "qwen") {
    add({ url: "https://qwen.ai/research", sourceName: "Qwen", role: "official" });
    add({
      url: "https://www.alibabacloud.com/help/en/model-studio/model-release-notes",
      sourceName: "Alibaba Cloud Model Studio",
      role: "official",
    });
    add({
      url: "https://www.alibabacloud.com/help/en/model-studio/model-pricing",
      sourceName: "Alibaba Cloud Model Studio",
      role: "official",
    });
    add({
      url: "https://www.alibabacloud.com/help/en/model-studio/models",
      sourceName: "Alibaba Cloud Model Studio",
      role: "official",
    });
  }

  if (benchmarkSlug) add({
    url: `https://artificialanalysis.ai/models/${benchmarkSlug}`,
    sourceName: "Artificial Analysis",
    role: "research",
  });

  return targets;
};
