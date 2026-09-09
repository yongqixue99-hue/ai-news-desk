import type { CollectionRequest, SourceRole } from "../types.js";

export interface DiscoveryFixtureItem {
  title: string;
  url: string;
  /** Source calendar date, represented as UTC midnight for this offline replay. */
  publishedAt?: string;
  excerpt: string;
  /** Adversarial generated translation: it must never upgrade the original event. */
  misleadingTitleZh?: string;
}

export interface NewsDiscoveryGoldenCase {
  id: string;
  label: string;
  kind: "historical-positive" | "synthetic-negative";
  category: string;
  sourceName: string;
  sourceRole: SourceRole;
  now: string;
  windowHours: number;
  filters?: Pick<CollectionRequest, "dateFrom" | "dateTo" | "keywords">;
  items: DiscoveryFixtureItem[];
  expectation: "recommend" | "reject-before-candidate" | "not-important" | "one-story";
  /** Reviewed source date, not a claim about the current availability of this product. */
  verification?: { checkedOn: string; url: string; dateLabel: string; note?: string };
}

type HistoricalInput = [id: string, category: string, sourceName: string, title: string, date: string, url: string, excerpt: string];

// Titles/date/URLs were checked against primary pages on 2026-09-08. Excerpts
// are short human paraphrases, not scraped full text or generated model answers.
// This is an offline relevance replay, not evidence of live source coverage.
const historical: HistoricalInput[] = [
  ["gpt-6-astra-real-miss", "model", "OpenAI", "GPT-6 Astra: A new generation of intelligence", "2026-09-03", "https://openai.com/index/gpt-6-astra", "Introducing GPT-6 Astra, an OpenAI model. The official announcement describes the model's capabilities and limitations."],
  ["fable-5-1-real-miss", "model", "Anthropic", "We've launched Claude Fable 5.1 (claude-fable-5-1).", "2026-09-01", "https://platform.claude.com/docs/en/release-notes/overview#september-1-2026", "Anthropic launched Fable 5.1. The dated official API release notes describe model access, API changes and limitations."],
  ["gpt-4o", "model", "OpenAI 官方", "Hello GPT‑4o", "2024-05-13", "https://openai.com/index/hello-gpt-4o/", "OpenAI announced GPT-4o, a multimodal model. Text and image capabilities began rolling out in ChatGPT, and developers received text and vision API access. Audio output availability was a later rollout."],
  ["gpt-4o-mini", "price-and-access", "OpenAI 官方", "GPT‑4o mini: advancing cost-efficient intelligence", "2024-07-18", "https://openai.com/index/gpt-4o-mini-advancing-cost-efficient-intelligence/", "OpenAI released GPT-4o mini for text and vision in its API. Launch pricing was $0.15 per million input tokens and $0.60 per million output tokens. It also replaced GPT-3.5 in ChatGPT for Free, Plus and Team users."],
  ["o1-preview", "model", "OpenAI 官方", "Introducing OpenAI o1‑preview", "2024-09-12", "https://openai.com/index/introducing-openai-o1-preview/", "OpenAI released the o1-preview reasoning model and o1-mini in ChatGPT and the API. The initial release was a preview, with limits and capabilities distinct from the GPT-4o model."],
  ["gpt-4-1", "model", "OpenAI 官方", "Introducing GPT-4.1 in the API", "2025-04-14", "https://openai.com/index/gpt-4-1/", "OpenAI launched GPT-4.1, GPT-4.1 mini and GPT-4.1 nano in the API. The models supported a context window of up to one million tokens, with changes to coding and instruction following."],
  ["deep-research", "product", "OpenAI 官方", "Introducing deep research", "2025-02-02", "https://openai.com/index/introducing-deep-research/", "OpenAI launched deep research in ChatGPT for multistep web research. The original rollout began with Pro users and usage limits; later availability updates on the page are excluded from this historical replay."],
  ["operator", "product", "OpenAI 官方", "Introducing Operator", "2025-01-23", "https://openai.com/index/introducing-operator/", "OpenAI released Operator as a research preview for US Pro users. The AI agent could interact with webpages using its browser, including typing, clicking and scrolling. The preview had limitations."],
  ["claude-3", "model", "Anthropic 官方", "Introducing the next generation of Claude", "2024-03-04", "https://www.anthropic.com/news/claude-3-family", "Anthropic announced the Claude 3 model family: Haiku, Sonnet and Opus. Sonnet and Opus became available through Claude and the API, while Haiku was announced for later availability."],
  ["claude-3-7", "model", "Anthropic 官方", "Claude 3.7 Sonnet and Claude Code", "2025-02-24", "https://www.anthropic.com/news/claude-3-7-sonnet", "Anthropic released Claude 3.7 Sonnet with normal and extended thinking modes. The model became available on Claude plans and API platforms; Claude Code was introduced as a limited research preview."],
  ["claude-4", "model", "Anthropic 官方", "Introducing Claude 4", "2025-05-22", "https://www.anthropic.com/news/claude-4", "Anthropic introduced Claude Opus 4 and Claude Sonnet 4. The model release focused on coding, reasoning and agent workflows and made both models available through API platforms."],
  ["claude-computer-use", "product", "Anthropic 官方", "Introducing computer use, a new Claude 3.5 Sonnet, and Claude 3.5 Haiku", "2024-10-22", "https://www.anthropic.com/news/3-5-models-and-computer-use", "Anthropic released an upgraded Claude 3.5 Sonnet and a computer use API in public beta. Developers could direct screen, mouse and keyboard interactions. Claude 3.5 Haiku was announced for later release, and the computer use beta remained experimental."],
  ["constitutional-classifiers", "security-research", "Anthropic 官方", "Constitutional Classifiers: Defending against universal jailbreaks", "2025-02-03", "https://www.anthropic.com/research/constitutional-classifiers", "Anthropic published research on input and output classifiers to defend AI models against universal jailbreaks. The reported experiments included human red teaming and measured refusal and compute tradeoffs; the research did not establish that all attacks were prevented."],
  ["responsible-scaling", "policy", "Anthropic 官方", "Announcing our updated Responsible Scaling Policy", "2024-10-15", "https://www.anthropic.com/news/announcing-our-updated-responsible-scaling-policy", "Anthropic published an update to its AI risk governance policy. New capability thresholds, safeguard assessments and governance measures described when stronger model safety and security protections would be required."],
  ["structured-outputs", "product", "OpenAI 官方", "Introducing Structured Outputs in the API", "2024-08-06", "https://openai.com/index/introducing-structured-outputs-in-the-api/", "OpenAI introduced Structured Outputs in the API for responses that follow a developer supplied JSON Schema. The release added strict tool definitions and a JSON Schema response format, with explicit handling for model refusals."],
  ["gemini-1-5", "model", "Gemini 官方", "Our next-generation model: Gemini 1.5", "2024-02-15", "https://blog.google/innovation-and-ai/products/google-gemini-next-generation-model-february-2024/", "Google announced Gemini 1.5 and made Gemini 1.5 Pro available in a limited preview. Selected developers and enterprise customers could test a one million token context window through AI Studio and Vertex AI."],
  ["gemini-2-0", "model", "Gemini 官方", "Introducing Gemini 2.0: our new AI model for the agentic era", "2024-12-11", "https://blog.google/innovation-and-ai/models-and-research/google-deepmind/google-gemini-ai-update-december-2024/", "Google released Gemini 2.0 Flash Experimental. Developers could use multimodal input and text output through the Gemini API, AI Studio and Vertex AI; some output features were limited to early access partners."],
  ["gemini-2-5", "model", "Gemini 官方", "Gemini 2.5: Our most intelligent AI model", "2025-03-25", "https://blog.google/innovation-and-ai/models-and-research/google-deepmind/gemini-model-thinking-updates-march-2025/", "Google introduced Gemini 2.5 Pro Experimental, a thinking model available in AI Studio and for Gemini Advanced users. The initial context window was one million tokens; Vertex AI availability and pricing were planned for later."],
  ["deepseek-r1", "model", "DeepSeek 官方", "DeepSeek-R1 Release", "2025-01-20", "https://www.deepseek.com/en/news/deepseek-r1/", "DeepSeek released the R1 reasoning model with website and API access. Model code and weights were MIT licensed, and the release included six distilled models. The announcement linked a technical report."],
  ["deepseek-v3", "model", "DeepSeek 官方", "Introducing DeepSeek-V3", "2024-12-26", "https://www.deepseek.com/en/news/deepseek-v3/", "DeepSeek released V3 with model weights and a technical report. The model used 671 billion total parameters with 37 billion activated parameters. The announcement also described an upcoming API pricing change."],
  ["qwen-2-5", "model", "Qwen 官方", "Qwen2.5: A Party of Foundation Models!", "2024-09-19", "https://qwenlm.github.io/blog/qwen2.5/", "The Qwen team released the Qwen2.5 language model family, alongside coding and mathematics variants in multiple sizes. The open weight model licenses varied by size, and the announcement linked model repositories."],
  ["model-context-protocol", "protocol", "Anthropic 官方", "Introducing the Model Context Protocol", "2024-11-25", "https://www.anthropic.com/news/model-context-protocol", "Anthropic open sourced Model Context Protocol to connect AI assistants with data and tools. The announcement included a protocol specification, SDKs, local server support in Claude Desktop and a repository of server implementations."],
];

export const historicalNewsDiscoveryCases: NewsDiscoveryGoldenCase[] = historical.map(([id, category, sourceName, title, date, url, excerpt]) => ({
  id, label: title, category, kind: "historical-positive", sourceName, sourceRole: "official",
  now: `${date}T18:00:00.000Z`, windowHours: 7 * 24,
  items: [{ title, url, publishedAt: `${date}T00:00:00.000Z`, excerpt }],
  expectation: "recommend",
  verification: { checkedOn: id.endsWith("-real-miss") ? "2026-09-09" : "2026-09-08", url, dateLabel: date,
    note: "仅日期精度；UTC 零点用于固定回放，不声称原网页提供精确发布时间。摘录为核实后短改述，排除晚于事件的页面更新。" },
}));

const syntheticNow = "2025-03-26T12:00:00.000Z";
const fresh = "2025-03-26T00:00:00.000Z";
const oldWithinCatchup = "2025-03-22T00:00:00.000Z";
const negative = (id: string, category: string, title: string, excerpt: string,
  options: Partial<Pick<NewsDiscoveryGoldenCase, "expectation" | "filters" | "sourceName" | "sourceRole">> & Partial<Pick<DiscoveryFixtureItem, "publishedAt" | "misleadingTitleZh">> = {},
): NewsDiscoveryGoldenCase => ({
  id, label: `[合成反例] ${title}`, kind: "synthetic-negative", category,
  sourceName: options.sourceName ?? "Gemini 官方", sourceRole: options.sourceRole ?? "official",
  now: syntheticNow, windowHours: 7 * 24, filters: options.filters,
  expectation: options.expectation ?? "not-important",
  // These reserved fixture paths are deliberately never requested. A known
  // first-party host exercises vendor recognition without inventing real news.
  items: [{ title, excerpt, url: `https://blog.google/__synthetic-eval__/${id}/`,
    publishedAt: Object.hasOwn(options, "publishedAt") ? options.publishedAt : fresh,
    misleadingTitleZh: options.misleadingTitleZh }],
});

const repeatedRelease = "The article discusses the Gemini 2.5 Pro model release, API availability, pricing and the one million token context window. It is not a new model announcement.";
const promotionTitles = ["Join us: Gemini 2.5 API workshop", "Register now for the Gemini model launch webinar", "Gemini 2.5 发布体验活动报名", "[推广] Gemini 2.5 API 开发课程限时优惠", "Gemini 2.5 model launch sponsorship opportunities"];
const digestTitles = ["Gemini monthly recap: March model releases", "Gemini 2.5: this month in AI", "A look back at this month's Gemini 2.5 launches", "Gemini 2.5 本月更新汇总", "Gemini weekly roundup: model and API releases"];
const minorTitles = ["Gemini CLI v0.1.2 release notes", "Gemini 2.5 SDK patch release fixes log formatting", "Gemini API client 1.2.3: documentation typo fixes", "Gemini 2.5 CLI 小版本更新：终端颜色修正", "Gemini 2.5 canary build released for internal testing"];
const rumorTitles = ["Rumor: Gemini 2.5 Ultra model released", "Gemini 2.5 Ultra reportedly launches today", "Gemini 2.5 Ultra may launch next week", "据传 Gemini 2.5 Ultra 模型正式发布", "Leaked Gemini 2.5 Ultra release date"];
const syntheticNegativeCases = [
  ...Array.from({ length: 5 }, (_, index) => negative(`stale-${index + 1}`, "stale", `Gemini ${index + 1}.0 model release`, repeatedRelease,
    { publishedAt: `2025-03-${String(15 + index).padStart(2, "0")}T00:00:00.000Z`, expectation: "reject-before-candidate" })),
  ...Array.from({ length: 5 }, (_, index) => negative(`future-${index + 1}`, "future", `Gemini ${index + 1}.0 model release`, repeatedRelease,
    { publishedAt: `2025-03-${String(27 + index).padStart(2, "0")}T00:00:00.000Z`, expectation: "reject-before-candidate" })),
  ...Array.from({ length: 5 }, (_, index) => negative(`undated-${index + 1}`, "missing-date", `Gemini ${index + 1}.0 model release`, repeatedRelease,
    { publishedAt: undefined, expectation: "reject-before-candidate" })),
  ...["not-a-date", "2025-99-99", "yesterday", "unknown", "NaN"].map((publishedAt, index) => negative(`invalid-date-${index + 1}`, "invalid-date", `Gemini ${index + 1}.0 model release`, repeatedRelease,
    { publishedAt, expectation: "reject-before-candidate" })),
  ...promotionTitles.map((title, index) => negative(`promotion-${index + 1}`, "promotion", title, repeatedRelease,
    { misleadingTitleZh: index === 4 ? "Google 正式发布 Gemini 2.5" : undefined })),
  ...digestTitles.map((title, index) => negative(`digest-${index + 1}`, "digest", title, repeatedRelease,
    { publishedAt: oldWithinCatchup, misleadingTitleZh: index === 2 ? "Google 发布 Gemini 2.5 Pro" : undefined })),
  ...minorTitles.map((title, index) => negative(`minor-${index + 1}`, "minor-update", title, repeatedRelease,
    { publishedAt: oldWithinCatchup, misleadingTitleZh: index === 2 ? "Google 正式发布 Gemini 2.5" : undefined })),
  ...rumorTitles.map((title, index) => negative(`rumor-${index + 1}`, "rumor", title, repeatedRelease,
    { misleadingTitleZh: "Google 正式发布 Gemini 2.5 Ultra" })),
  ...Array.from({ length: 5 }, (_, index): NewsDiscoveryGoldenCase => {
    const original = historicalNewsDiscoveryCases.find((item) => item.id === "gemini-2-5")!;
    const item = original.items[0];
    const suffix = ["?utm_source=newsletter", "?gclid=tracking", "#pricing", "?fbclid=tracking", "?utm_medium=rss&utm_campaign=model"][index];
    return { ...original, id: `duplicate-${index + 1}`, label: `[合成反例] 同一新闻重复入口 ${index + 1}`,
      kind: "synthetic-negative", category: "duplicate", expectation: "one-story", verification: undefined,
      items: [item, { ...item, url: `${item.url}${suffix}` }] };
  }),
  ...["DeepSeek-R1", "GPT-4.1", "Claude 3.7", "Qwen 2.5", "Llama 3"].map((keywords, index) => negative(`irrelevant-query-${index + 1}`, "keyword-mismatch", "Gemini 2.5 Pro model release", repeatedRelease,
    { filters: { keywords }, expectation: "reject-before-candidate" })),
];

export const newsDiscoveryGoldenCases: NewsDiscoveryGoldenCase[] = [...historicalNewsDiscoveryCases, ...syntheticNegativeCases];
