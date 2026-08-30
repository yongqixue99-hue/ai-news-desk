import type { CollectionTopicDefinition, CollectionTopicId } from "./types.js";

export const collectionTopics: CollectionTopicDefinition[] = [
  {
    id: "ai",
    label: "AI",
    description: "模型、产品、算力与人工智能公司",
    query: '("artificial intelligence" OR AI OR OpenAI OR Anthropic OR ChatGPT OR Claude OR Gemini OR 人工智能 OR 大模型)',
    keywords: ["ai", "artificial intelligence", "openai", "chatgpt", "anthropic", "claude", "gemini", "deepmind", "llm", "大模型", "人工智能", "生成式 ai"],
  },
  {
    id: "technology",
    label: "科技",
    description: "芯片、软件、硬件、网络与开发者生态",
    query: "(technology OR software OR chip OR semiconductor OR cybersecurity OR developer OR 科技 OR 芯片 OR 软件 OR 网络安全)",
    keywords: ["technology", "software", "chip", "gpu", "cpu", "semiconductor", "cybersecurity", "developer", "open source", "github", "hardware", "科技", "芯片", "软件", "网络安全"],
  },
  {
    id: "gaming",
    label: "游戏",
    description: "新游、主机、工作室与游戏产业",
    query: "(gaming OR videogame OR PlayStation OR Xbox OR Nintendo OR Steam OR 游戏 OR 主机 OR 新游)",
    keywords: ["gaming", "video game", "videogame", "playstation", "xbox", "nintendo", "steam", "game studio", "游戏", "主机", "新游", "游戏工作室"],
  },
  {
    id: "esports",
    label: "电竞",
    description: "赛事、战队、选手与电竞商业",
    query: '(esports OR "e-sports" OR tournament OR "League of Legends" OR LPL OR LCK OR "Dota 2" OR CS2 OR "Counter-Strike" OR 电竞 OR 赛事 OR 战队)',
    keywords: ["esports", "e-sports", "tournament", "league of legends", "lpl", "lck", "worlds", "msi", "dota 2", "dota2", "the international", "counter-strike", "cs2", "major", "电竞", "赛事", "战队", "选手", "英雄联盟", "刀塔", "反恐精英"],
  },
  {
    id: "politics",
    label: "政治",
    description: "政策、选举、外交与公共治理",
    query: "(politics OR election OR government OR policy OR congress OR parliament OR diplomacy OR 政治 OR 政策 OR 外交)",
    keywords: ["politics", "election", "government", "policy", "congress", "parliament", "diplomacy", "president", "minister", "政治", "选举", "政府", "政策", "外交", "议会"],
  },
  {
    id: "business",
    label: "商业",
    description: "公司、交易、市场与产业变化",
    query: "(business OR company OR market OR acquisition OR funding OR earnings OR 商业 OR 公司 OR 收购 OR 融资 OR 财报)",
    keywords: ["business", "company", "market", "acquisition", "funding", "earnings", "revenue", "startup", "商业", "公司", "收购", "融资", "财报", "市场"],
  },
  {
    id: "science",
    label: "科学",
    description: "科研发现、航天、生命科学与环境",
    query: "(science OR research OR space OR biology OR climate OR physics OR 科学 OR 科研 OR 航天 OR 生物 OR 气候)",
    keywords: ["science", "research", "space", "biology", "climate", "physics", "astronomy", "scientist", "科学", "科研", "航天", "生物", "气候", "物理"],
  },
];

const validTopicIds = new Set(collectionTopics.map((topic) => topic.id));

export const normalizeOptionalTopicIds = (value: unknown): CollectionTopicId[] => {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is CollectionTopicId =>
    typeof id === "string" && validTopicIds.has(id as CollectionTopicId)))];
};

export const normalizeTopicIds = (value: unknown): CollectionTopicId[] => {
  const unique = normalizeOptionalTopicIds(value);
  return unique.length ? unique : ["ai"];
};

export const topicDefinitionsFor = (ids: CollectionTopicId[]) => {
  const selected = new Set(normalizeTopicIds(ids));
  return collectionTopics.filter((topic) => selected.has(topic.id));
};

export const queryForTopics = (ids: CollectionTopicId[]) =>
  topicDefinitionsFor(ids).map((topic) => `(${topic.query})`).join(" OR ");

export const topicLabels = (ids: CollectionTopicId[]) =>
  topicDefinitionsFor(ids).map((topic) => topic.label);
