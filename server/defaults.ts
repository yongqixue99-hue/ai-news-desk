import { homedir } from "node:os";
import path from "node:path";
import type {
  AiProviderConfig,
  AiSettings,
  ArticleSkillConfig,
  CollectionTopicId,
  ProviderHealthErrorCategory,
  ProviderHealthResult,
  ProviderHealthStatus,
  Settings,
  SourceConfig,
  SourcePreset,
  WorkflowState,
} from "./types.js";
import { normalizeOptionalTopicIds, normalizeTopicIds, topicLabels } from "./topics.js";
import {
  allCollectionTopicIds,
  sourceRoleFor,
  sourceSupportsTopics,
  sourceTopicIds,
} from "./source-routing.js";
import { sortCandidates } from "./scoring.js";
import { normalizeWorkflowNotifications } from "./notifications.js";

const configuredDefaultSources: SourceConfig[] = [
  {
    id: "openai-official",
    name: "OpenAI",
    kind: "rss",
    homepageUrl: "https://openai.com/",
    topicIds: ["ai"],
    routes: [{
      topicId: "ai",
      label: "News",
      homepageUrl: "https://openai.com/news/",
      url: "https://openai.com/news/rss.xml",
      category: "ai-official",
    }],
    enabled: true,
    selected: true,
    category: "ai-official",
    discoveryOnly: false,
    note: "官方网站 · News",
  },
  {
    id: "anthropic-official",
    name: "Anthropic",
    kind: "rss",
    homepageUrl: "https://www.anthropic.com/",
    topicIds: ["ai"],
    routes: [{
      topicId: "ai",
      label: "Newsroom",
      homepageUrl: "https://www.anthropic.com/news",
      query: "site:anthropic.com/news Anthropic",
      category: "ai-official",
    }],
    enabled: true,
    selected: true,
    category: "ai-official",
    role: "official",
    discoveryOnly: true,
    note: "官方网站 · Newsroom（经新闻索引发现）",
  },
  {
    id: "deepmind-official",
    name: "Google DeepMind",
    kind: "rss",
    homepageUrl: "https://deepmind.google/",
    topicIds: ["ai", "science"],
    routes: [
      {
        topicId: "ai",
        label: "AI News",
        homepageUrl: "https://deepmind.google/blog/",
        url: "https://deepmind.google/blog/rss.xml",
        category: "ai-official",
      },
      {
        topicId: "science",
        label: "Research News",
        homepageUrl: "https://deepmind.google/blog/",
        url: "https://deepmind.google/blog/rss.xml",
        category: "science",
      },
    ],
    enabled: true,
    selected: true,
    category: "ai-official",
    discoveryOnly: false,
    note: "官方网站 · News",
  },
  {
    id: "bbc-technology",
    name: "BBC",
    kind: "rss",
    homepageUrl: "https://www.bbc.com/",
    topicIds: ["ai", "technology", "politics", "business", "science"],
    routes: [
      {
        topicId: "ai",
        label: "Artificial Intelligence",
        homepageUrl: "https://www.bbc.com/technology/artificial-intelligence",
        query: "site:bbc.com/technology/artificial-intelligence",
        category: "ai-news",
      },
      {
        topicId: "technology",
        label: "Technology",
        homepageUrl: "https://www.bbc.com/news/technology",
        url: "https://feeds.bbci.co.uk/news/technology/rss.xml",
        category: "technology",
      },
      {
        topicId: "politics",
        label: "Politics",
        homepageUrl: "https://www.bbc.com/news/politics",
        url: "https://feeds.bbci.co.uk/news/politics/rss.xml",
        category: "politics",
      },
      {
        topicId: "business",
        label: "Business",
        homepageUrl: "https://www.bbc.com/news/business",
        url: "https://feeds.bbci.co.uk/news/business/rss.xml",
        category: "business",
      },
      {
        topicId: "science",
        label: "Science & Environment",
        homepageUrl: "https://www.bbc.com/news/science_and_environment",
        url: "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml",
        category: "science",
      },
    ],
    enabled: true,
    selected: true,
    category: "technology",
    discoveryOnly: false,
    note: "官方网站 · 按频道进入对应栏目",
  },
  {
    id: "techcrunch-ai",
    name: "TechCrunch",
    kind: "rss",
    homepageUrl: "https://techcrunch.com/",
    topicIds: ["ai", "technology", "gaming", "business"],
    routes: [
      {
        topicId: "ai",
        label: "Artificial Intelligence",
        homepageUrl: "https://techcrunch.com/category/artificial-intelligence/",
        url: "https://techcrunch.com/category/artificial-intelligence/feed/",
        category: "ai-news",
      },
      {
        topicId: "technology",
        label: "Technology",
        homepageUrl: "https://techcrunch.com/",
        url: "https://techcrunch.com/feed/",
        category: "technology",
      },
      {
        topicId: "gaming",
        label: "Gaming",
        homepageUrl: "https://techcrunch.com/tag/gaming/",
        query: "site:techcrunch.com gaming videogame",
        category: "gaming",
      },
      {
        topicId: "business",
        label: "Startups & Business",
        homepageUrl: "https://techcrunch.com/category/startups/",
        query: "site:techcrunch.com (startup OR funding OR acquisition OR business)",
        category: "business",
      },
    ],
    enabled: true,
    selected: true,
    category: "ai-news",
    discoveryOnly: false,
    note: "官方网站 · AI / 科技 / 游戏 / 商业",
  },
  {
    id: "ars-ai",
    name: "Ars Technica",
    kind: "rss",
    homepageUrl: "https://arstechnica.com/",
    topicIds: ["ai", "technology", "science"],
    routes: [
      {
        topicId: "ai",
        label: "AI",
        homepageUrl: "https://arstechnica.com/ai/",
        url: "https://arstechnica.com/ai/feed/",
        category: "ai-news",
      },
      {
        topicId: "technology",
        label: "Technology",
        homepageUrl: "https://arstechnica.com/",
        url: "https://feeds.arstechnica.com/arstechnica/index",
        category: "technology",
      },
      {
        topicId: "science",
        label: "Science",
        homepageUrl: "https://arstechnica.com/science/",
        url: "https://arstechnica.com/science/feed/",
        category: "science",
      },
    ],
    enabled: true,
    selected: true,
    category: "ai-news",
    discoveryOnly: false,
    note: "官方网站 · AI / 科技 / 科学",
  },
  {
    id: "reuters-ai",
    name: "Reuters",
    kind: "rss",
    homepageUrl: "https://www.reuters.com/",
    topicIds: ["ai", "technology", "politics", "business", "science"],
    routes: [
      {
        topicId: "ai",
        label: "Artificial Intelligence",
        homepageUrl: "https://www.reuters.com/technology/artificial-intelligence/",
        query: "site:reuters.com/technology/artificial-intelligence (AI OR artificial intelligence OR OpenAI OR Anthropic)",
        category: "ai-news",
      },
      {
        topicId: "technology",
        label: "Technology",
        homepageUrl: "https://www.reuters.com/technology/",
        query: "site:reuters.com/technology",
        category: "technology",
      },
      {
        topicId: "politics",
        label: "World & Politics",
        homepageUrl: "https://www.reuters.com/world/",
        query: "site:reuters.com/world (politics OR government OR election OR policy)",
        category: "politics",
      },
      {
        topicId: "business",
        label: "Business",
        homepageUrl: "https://www.reuters.com/business/",
        query: "site:reuters.com/business",
        category: "business",
      },
      {
        topicId: "science",
        label: "Science",
        homepageUrl: "https://www.reuters.com/science/",
        query: "site:reuters.com/science (science OR research OR space OR climate)",
        category: "science",
      },
    ],
    enabled: true,
    selected: true,
    category: "ai-news",
    discoveryOnly: false,
    note: "官方网站 · 新闻索引只负责进入对应栏目",
  },
  {
    id: "bloomberg-ai",
    name: "Bloomberg",
    kind: "rss",
    homepageUrl: "https://www.bloomberg.com/",
    topicIds: ["ai", "technology", "politics", "business"],
    routes: [
      {
        topicId: "ai",
        label: "AI",
        homepageUrl: "https://www.bloomberg.com/ai",
        query: "site:bloomberg.com (AI OR artificial intelligence OR OpenAI OR Anthropic)",
        category: "ai-business",
      },
      {
        topicId: "technology",
        label: "Technology",
        homepageUrl: "https://www.bloomberg.com/technology",
        query: "site:bloomberg.com/technology",
        category: "technology",
      },
      {
        topicId: "politics",
        label: "Politics",
        homepageUrl: "https://www.bloomberg.com/politics",
        query: "site:bloomberg.com/politics",
        category: "politics",
      },
      {
        topicId: "business",
        label: "Business & Markets",
        homepageUrl: "https://www.bloomberg.com/markets",
        query: "site:bloomberg.com (business OR markets OR company OR earnings)",
        category: "business",
      },
    ],
    enabled: true,
    selected: true,
    category: "ai-business",
    discoveryOnly: false,
    note: "官方网站 · AI / 科技 / 政治 / 商业",
  },
  {
    id: "ap-ai",
    name: "Associated Press",
    kind: "rss",
    homepageUrl: "https://apnews.com/",
    topicIds: ["ai", "politics", "business", "science"],
    routes: [
      {
        topicId: "ai",
        label: "Artificial Intelligence",
        homepageUrl: "https://apnews.com/hub/artificial-intelligence",
        query: "site:apnews.com/hub/artificial-intelligence",
        category: "ai-news",
      },
      {
        topicId: "politics",
        label: "Politics",
        homepageUrl: "https://apnews.com/politics",
        query: "site:apnews.com/politics",
        category: "politics",
      },
      {
        topicId: "business",
        label: "Business",
        homepageUrl: "https://apnews.com/hub/business",
        query: "site:apnews.com (business OR markets OR company)",
        category: "business",
      },
      {
        topicId: "science",
        label: "Science",
        homepageUrl: "https://apnews.com/science",
        query: "site:apnews.com (science OR research OR space OR climate)",
        category: "science",
      },
    ],
    enabled: true,
    selected: true,
    category: "ai-news",
    discoveryOnly: false,
    note: "官方网站 · 按频道进入专题页",
  },
  {
    id: "washington-post-tech",
    name: "The Washington Post",
    kind: "rss",
    homepageUrl: "https://www.washingtonpost.com/",
    topicIds: ["ai", "technology", "politics", "business", "science"],
    routes: [
      {
        topicId: "ai",
        label: "Artificial Intelligence",
        homepageUrl: "https://www.washingtonpost.com/technology/innovations/",
        query: "site:washingtonpost.com/technology/innovations (AI OR artificial intelligence)",
        category: "ai-news",
      },
      {
        topicId: "technology",
        label: "Technology",
        homepageUrl: "https://www.washingtonpost.com/business/technology/",
        query: "site:washingtonpost.com/business/technology",
        category: "technology",
      },
      {
        topicId: "politics",
        label: "Politics",
        homepageUrl: "https://www.washingtonpost.com/politics/",
        query: "site:washingtonpost.com/politics",
        category: "politics",
      },
      {
        topicId: "business",
        label: "Business",
        homepageUrl: "https://www.washingtonpost.com/business/",
        query: "site:washingtonpost.com/business",
        category: "business",
      },
      {
        topicId: "science",
        label: "Climate & Environment",
        homepageUrl: "https://www.washingtonpost.com/climate-environment/",
        query: "site:washingtonpost.com/climate-environment",
        category: "science",
      },
    ],
    enabled: true,
    selected: true,
    category: "technology",
    discoveryOnly: false,
    note: "官方网站 · 按频道进入对应栏目",
  },
  {
    id: "cnn-ai",
    name: "CNN",
    kind: "rss",
    homepageUrl: "https://www.cnn.com/",
    topicIds: ["ai", "technology", "politics", "business", "science"],
    routes: [
      {
        topicId: "ai",
        label: "AI & Tech",
        homepageUrl: "https://www.cnn.com/business/tech",
        query: "site:cnn.com (AI OR artificial intelligence OR OpenAI OR Anthropic)",
        category: "ai-news",
      },
      {
        topicId: "technology",
        label: "Tech",
        homepageUrl: "https://www.cnn.com/business/tech",
        query: "site:cnn.com/business/tech",
        category: "technology",
      },
      {
        topicId: "politics",
        label: "Politics",
        homepageUrl: "https://www.cnn.com/politics",
        query: "site:cnn.com/politics",
        category: "politics",
      },
      {
        topicId: "business",
        label: "Business",
        homepageUrl: "https://www.cnn.com/business",
        query: "site:cnn.com/business",
        category: "business",
      },
      {
        topicId: "science",
        label: "Science",
        homepageUrl: "https://www.cnn.com/science",
        query: "site:cnn.com/science",
        category: "science",
      },
    ],
    enabled: true,
    selected: true,
    category: "technology",
    discoveryOnly: false,
    note: "官方网站 · 按频道进入对应栏目",
  },
  {
    id: "hackernews",
    name: "Hacker News",
    kind: "hackernews",
    homepageUrl: "https://news.ycombinator.com/",
    topicIds: ["ai", "technology", "science"],
    enabled: true,
    selected: true,
    category: "technology",
    role: "community",
    discoveryOnly: true,
    note: "用于发现开发者关注点，不作为最终事实来源",
  },
  {
    id: "v2ex-community",
    name: "V2EX 技术讨论",
    kind: "rss",
    homepageUrl: "https://www.v2ex.com/",
    url: "https://www.v2ex.com/index.xml",
    topicIds: ["ai", "technology"],
    enabled: true,
    selected: true,
    category: "community",
    role: "community",
    discoveryOnly: true,
    note: "中文开发者实际体验 · 只作观点与问题线索，事实需回到官方来源核验",
  },
  {
    id: "github-project-community",
    name: "GitHub AI 项目动态",
    kind: "github",
    homepageUrl: "https://github.com/",
    query: "openai/codex anthropics/claude-code google-gemini/gemini-cli ollama/ollama",
    topicIds: ["ai", "technology"],
    enabled: true,
    selected: true,
    category: "community",
    role: "community",
    discoveryOnly: true,
    note: "读取公开 Release、热门 Issue 与 Discussion；Release 可作官方项目证据，其余只作社区样本",
  },
  {
    id: "google-news-ai",
    name: "Google News 综合检索",
    kind: "google_news",
    homepageUrl: "https://news.google.com/",
    topicIds: [...allCollectionTopicIds],
    enabled: true,
    selected: true,
    category: "ai-news",
    discoveryOnly: true,
    role: "discovery",
    note: "中英双语动态检索 · 查询词由频道、日期和关键词共同生成",
  },
  {
    id: "microsoft-official",
    name: "Microsoft 官方博客",
    kind: "rss",
    homepageUrl: "https://blogs.microsoft.com/",
    topicIds: ["ai", "technology", "business"],
    routes: [
      {
        topicId: "ai",
        label: "AI & Company News",
        homepageUrl: "https://blogs.microsoft.com/",
        url: "https://blogs.microsoft.com/feed/",
        category: "ai-official",
      },
      {
        topicId: "technology",
        label: "Technology",
        homepageUrl: "https://blogs.microsoft.com/",
        url: "https://blogs.microsoft.com/feed/",
        category: "technology",
      },
      {
        topicId: "business",
        label: "Company News",
        homepageUrl: "https://blogs.microsoft.com/",
        url: "https://blogs.microsoft.com/feed/",
        category: "business",
      },
    ],
    enabled: true,
    selected: true,
    category: "ai-official",
    role: "official",
    discoveryOnly: false,
    note: "一级信源 · Microsoft 官方发布",
  },
  {
    id: "nvidia-official",
    name: "NVIDIA 官方博客",
    kind: "rss",
    homepageUrl: "https://www.nvidia.com/en-us/about-nvidia/rss/",
    topicIds: ["ai", "technology", "business"],
    routes: [
      {
        topicId: "ai",
        label: "AI",
        homepageUrl: "https://blogs.nvidia.com/blog/category/ai-data-science/",
        query: "site:blogs.nvidia.com (AI OR artificial intelligence OR GPU OR model)",
        category: "ai-official",
      },
      {
        topicId: "technology",
        label: "Technology",
        homepageUrl: "https://blogs.nvidia.com/",
        query: "site:blogs.nvidia.com (technology OR GPU OR chip OR software)",
        category: "technology",
      },
      {
        topicId: "business",
        label: "Company News",
        homepageUrl: "https://blogs.nvidia.com/",
        query: "site:blogs.nvidia.com (company OR partnership OR business OR earnings)",
        category: "business",
      },
    ],
    enabled: true,
    selected: true,
    category: "ai-official",
    role: "official",
    discoveryOnly: false,
    note: "一级信源 · NVIDIA 官方发布（RSS 不稳定时经新闻索引发现）",
  },
  {
    id: "aws-ml-official",
    name: "AWS Machine Learning 官方博客",
    kind: "rss",
    homepageUrl: "https://aws.amazon.com/blogs/machine-learning/",
    topicIds: ["ai", "technology"],
    routes: [
      {
        topicId: "ai",
        label: "Machine Learning Blog",
        homepageUrl: "https://aws.amazon.com/blogs/machine-learning/",
        url: "https://aws.amazon.com/blogs/machine-learning/feed/",
        category: "ai-official",
      },
      {
        topicId: "technology",
        label: "Cloud & Developer",
        homepageUrl: "https://aws.amazon.com/blogs/machine-learning/",
        url: "https://aws.amazon.com/blogs/machine-learning/feed/",
        category: "technology",
      },
    ],
    enabled: true,
    selected: true,
    category: "ai-official",
    role: "official",
    discoveryOnly: false,
    note: "一级信源 · AWS AI 与机器学习产品",
  },
  {
    id: "github-official",
    name: "GitHub 官方博客",
    kind: "rss",
    homepageUrl: "https://github.blog/",
    topicIds: ["ai", "technology"],
    routes: [
      {
        topicId: "ai",
        label: "AI & Copilot",
        homepageUrl: "https://github.blog/ai-and-ml/",
        url: "https://github.blog/feed/",
        category: "ai-official",
      },
      {
        topicId: "technology",
        label: "Engineering",
        homepageUrl: "https://github.blog/engineering/",
        url: "https://github.blog/feed/",
        category: "technology",
      },
    ],
    enabled: true,
    selected: true,
    category: "ai-official",
    role: "official",
    discoveryOnly: false,
    note: "一级信源 · 开发者生态与 Copilot",
  },
  {
    id: "qwen-official",
    name: "通义千问 Qwen 官方",
    kind: "rss",
    homepageUrl: "https://qwen.ai/blog",
    topicIds: ["ai"],
    routes: [{
      topicId: "ai",
      label: "Official Blog",
      homepageUrl: "https://qwen.ai/blog",
      query: "site:qwen.ai/blog (Qwen OR 通义千问 OR model)",
      category: "ai-official",
    }],
    enabled: true,
    selected: true,
    category: "ai-official",
    role: "official",
    discoveryOnly: false,
    note: "一级信源 · 中文模型官方博客（经新闻索引发现）",
  },
  {
    id: "deepseek-official",
    name: "DeepSeek 官方更新",
    kind: "rss",
    homepageUrl: "https://api-docs.deepseek.com/updates/",
    topicIds: ["ai"],
    routes: [{
      topicId: "ai",
      label: "News & Updates",
      homepageUrl: "https://api-docs.deepseek.com/updates/",
      query: "site:api-docs.deepseek.com (DeepSeek OR release OR update)",
      category: "ai-official",
    }],
    enabled: true,
    selected: true,
    category: "ai-official",
    role: "official",
    discoveryOnly: false,
    note: "一级信源 · 官方新闻与更新记录",
  },
  {
    id: "zhipu-official",
    name: "智谱 Z.ai 发布记录",
    kind: "rss",
    homepageUrl: "https://docs.z.ai/release-notes/new-released",
    topicIds: ["ai"],
    routes: [{
      topicId: "ai",
      label: "Release Notes",
      homepageUrl: "https://docs.z.ai/release-notes/new-released",
      query: "site:docs.z.ai/release-notes (GLM OR Z.ai OR release OR model)",
      category: "ai-official",
    }],
    enabled: true,
    selected: true,
    category: "ai-official",
    role: "official",
    discoveryOnly: false,
    note: "一级信源 · 智谱官方博客与发布记录",
  },
  {
    id: "kimi-official",
    name: "Kimi / Moonshot 官方公告",
    kind: "rss",
    homepageUrl: "https://forum.moonshot.ai/c/announcement/",
    topicIds: ["ai"],
    routes: [{
      topicId: "ai",
      label: "Announcements",
      homepageUrl: "https://forum.moonshot.ai/c/announcement/",
      query: "site:forum.moonshot.ai/c/announcement (Kimi OR Moonshot OR 月之暗面)",
      category: "ai-official",
    }],
    enabled: true,
    selected: true,
    category: "ai-official",
    role: "official",
    discoveryOnly: false,
    note: "一级信源 · Kimi 官方公告",
  },
  {
    id: "mit-technology-review",
    name: "MIT Technology Review",
    kind: "rss",
    homepageUrl: "https://www.technologyreview.com/",
    url: "https://www.technologyreview.com/feed/",
    topicIds: ["ai", "technology", "business", "science"],
    enabled: true,
    selected: true,
    category: "ai-news",
    role: "verification",
    discoveryOnly: false,
    note: "二级信源 · 技术影响与行业核验",
  },
  {
    id: "venturebeat-ai",
    name: "VentureBeat AI",
    kind: "rss",
    homepageUrl: "https://venturebeat.com/category/ai/",
    url: "https://venturebeat.com/category/ai/feed/",
    topicIds: ["ai", "technology", "business"],
    enabled: true,
    selected: false,
    category: "ai-news",
    role: "verification",
    discoveryOnly: false,
    note: "专业媒体 · AI 产品与企业动态",
  },
  {
    id: "the-verge",
    name: "The Verge",
    kind: "rss",
    homepageUrl: "https://www.theverge.com/",
    url: "https://www.theverge.com/rss/index.xml",
    topicIds: ["ai", "technology", "gaming", "business"],
    enabled: true,
    selected: false,
    category: "technology",
    role: "verification",
    discoveryOnly: false,
    note: "综合科技媒体 · 默认不加入日常包以控制噪声",
  },
  {
    id: "wired",
    name: "WIRED",
    kind: "rss",
    homepageUrl: "https://www.wired.com/",
    url: "https://www.wired.com/feed/rss",
    topicIds: ["ai", "technology", "business", "science"],
    enabled: true,
    selected: false,
    category: "technology",
    role: "verification",
    discoveryOnly: false,
    note: "综合科技媒体 · 默认不加入日常包以控制噪声",
  },
  {
    id: "microsoft-research",
    name: "Microsoft Research",
    kind: "rss",
    homepageUrl: "https://www.microsoft.com/en-us/research/",
    url: "https://www.microsoft.com/en-us/research/feed/",
    topicIds: ["ai", "technology", "science"],
    enabled: true,
    selected: false,
    category: "science",
    role: "research",
    discoveryOnly: false,
    note: "研究信源 · 论文、项目与研究进展",
  },
  {
    id: "mit-news-ai",
    name: "MIT News AI",
    kind: "rss",
    homepageUrl: "https://news.mit.edu/topic/artificial-intelligence2",
    url: "https://news.mit.edu/rss/topic/artificial-intelligence2",
    topicIds: ["ai", "science"],
    enabled: true,
    selected: false,
    category: "science",
    role: "research",
    discoveryOnly: false,
    note: "研究信源 · MIT 人工智能研究新闻",
  },
  {
    id: "nist-news",
    name: "NIST 新闻",
    kind: "rss",
    homepageUrl: "https://www.nist.gov/news-events/news",
    url: "https://www.nist.gov/news-events/news/rss.xml",
    topicIds: ["ai", "technology", "politics", "business", "science"],
    enabled: true,
    selected: false,
    category: "science",
    role: "research",
    discoveryOnly: false,
    note: "政策与标准 · AI、安全和技术标准",
  },
  {
    id: "ftc-press",
    name: "FTC 新闻稿",
    kind: "rss",
    homepageUrl: "https://www.ftc.gov/news-events/news/press-releases",
    url: "https://www.ftc.gov/feeds/press-release.xml",
    topicIds: ["ai", "technology", "politics", "business"],
    enabled: true,
    selected: false,
    category: "politics",
    role: "research",
    discoveryOnly: false,
    note: "监管信源 · 竞争、消费者保护与 AI 执法",
  },
  {
    id: "cisa-advisories",
    name: "CISA 安全公告",
    kind: "rss",
    homepageUrl: "https://www.cisa.gov/news-events/cybersecurity-advisories",
    url: "https://www.cisa.gov/cybersecurity-advisories/all.xml",
    topicIds: ["ai", "technology", "politics"],
    enabled: true,
    selected: false,
    category: "technology",
    role: "research",
    discoveryOnly: false,
    note: "安全信源 · 只在安全与政策选题中启用",
  },
  {
    id: "cloudflare-blog",
    name: "Cloudflare 官方博客",
    kind: "rss",
    homepageUrl: "https://blog.cloudflare.com/",
    url: "https://blog.cloudflare.com/rss/",
    topicIds: ["ai", "technology", "business"],
    enabled: true,
    selected: false,
    category: "technology",
    role: "official",
    discoveryOnly: false,
    note: "一级信源 · 网络、安全与开发者平台",
  },
  {
    id: "qbitai",
    name: "量子位",
    kind: "rss",
    homepageUrl: "https://www.qbitai.com/",
    url: "https://www.qbitai.com/feed",
    topicIds: ["ai", "technology", "business"],
    enabled: true,
    selected: false,
    category: "ai-news",
    role: "discovery",
    discoveryOnly: true,
    note: "中文线索发现 · 需回到官方或独立媒体交叉核验",
  },
  {
    id: "jiqizhixin",
    name: "机器之心",
    kind: "rss",
    homepageUrl: "https://www.jiqizhixin.com/",
    topicIds: ["ai", "technology", "business", "science"],
    routes: [
      {
        topicId: "ai",
        label: "AI 新闻",
        homepageUrl: "https://www.jiqizhixin.com/",
        query: "site:jiqizhixin.com (人工智能 OR 大模型 OR AI)",
        category: "ai-news",
      },
      {
        topicId: "technology",
        label: "科技",
        homepageUrl: "https://www.jiqizhixin.com/",
        query: "site:jiqizhixin.com (科技 OR 芯片 OR 软件)",
        category: "technology",
      },
      {
        topicId: "business",
        label: "产业",
        homepageUrl: "https://www.jiqizhixin.com/",
        query: "site:jiqizhixin.com (公司 OR 融资 OR 收购 OR 商业)",
        category: "business",
      },
      {
        topicId: "science",
        label: "研究",
        homepageUrl: "https://www.jiqizhixin.com/",
        query: "site:jiqizhixin.com (论文 OR 研究 OR 科学)",
        category: "science",
      },
    ],
    enabled: true,
    selected: false,
    category: "ai-news",
    role: "discovery",
    discoveryOnly: true,
    note: "中文线索发现 · 经新闻索引采集",
  },
  {
    id: "36kr-technology",
    name: "36氪科技",
    kind: "rss",
    homepageUrl: "https://www.36kr.com/information/technology/",
    topicIds: ["ai", "technology", "business"],
    routes: [
      {
        topicId: "ai",
        label: "AI 与科技",
        homepageUrl: "https://www.36kr.com/information/technology/",
        query: "site:36kr.com (人工智能 OR 大模型 OR AI OR 科技)",
        category: "ai-news",
      },
      {
        topicId: "technology",
        label: "科技",
        homepageUrl: "https://www.36kr.com/information/technology/",
        query: "site:36kr.com/information/technology (科技 OR 芯片 OR 软件)",
        category: "technology",
      },
      {
        topicId: "business",
        label: "商业",
        homepageUrl: "https://www.36kr.com/",
        query: "site:36kr.com (公司 OR 融资 OR 收购 OR 财报)",
        category: "business",
      },
    ],
    enabled: true,
    selected: false,
    category: "ai-news",
    role: "discovery",
    discoveryOnly: true,
    note: "中文综合发现 · 无稳定 RSS，使用站点定向检索",
  },
  {
    id: "last30days-community",
    name: "Last30days 社区趋势",
    kind: "last30days",
    homepageUrl: "https://github.com/mvanhorn/last30days-skill",
    topicIds: [...allCollectionTopicIds],
    enabled: true,
    selected: false,
    category: "community",
    role: "community",
    discoveryOnly: true,
    note: "近 30 天社区趋势 · 首次使用需在 Codex 中完成初始化；未授权时不会读取浏览器 Cookie",
  },
  {
    id: "zhihu-community",
    name: "知乎科技讨论",
    kind: "zhihu",
    homepageUrl: "https://www.zhihu.com/hot",
    query: "人工智能 大模型 科技",
    topicIds: [...allCollectionTopicIds],
    enabled: false,
    selected: false,
    category: "community",
    role: "community",
    discoveryOnly: true,
    note: "社区热点 · 需先完成 opencli zhihu 登录；只能发现选题，不能独立证明事实",
  },
  {
    id: "lpl-official",
    name: "LPL 官方",
    kind: "rss",
    homepageUrl: "https://lpl.qq.com/",
    topicIds: ["esports"],
    routes: [{
      topicId: "esports",
      label: "LPL 赛事资讯",
      homepageUrl: "https://lpl.qq.com/web202301/officalnews.shtml",
      query: "site:lpl.qq.com (LPL OR 英雄联盟赛事 OR 全球总决赛 OR MSI)",
      category: "esports",
    }],
    enabled: true,
    selected: true,
    category: "esports",
    discoveryOnly: false,
    note: "英雄联盟 · LPL 国服 · 官方赛事",
  },
  {
    id: "lolesports-official",
    name: "LoL Esports / LCK",
    kind: "rss",
    homepageUrl: "https://lolesports.com/",
    topicIds: ["esports"],
    routes: [{
      topicId: "esports",
      label: "LCK / 全球赛事",
      homepageUrl: "https://lolesports.com/ko-KR/leagues/lck",
      query: "site:lolesports.com (LCK OR T1 OR Gen.G OR HLE OR Worlds OR MSI)",
      category: "esports",
    }],
    enabled: true,
    selected: true,
    category: "esports",
    discoveryOnly: false,
    note: "英雄联盟 · LCK 韩服 · Riot 官方",
  },
  {
    id: "dota2-official",
    name: "DOTA2 官方",
    kind: "rss",
    homepageUrl: "https://www.dota2.com/news",
    topicIds: ["esports"],
    routes: [{
      topicId: "esports",
      label: "DOTA2 / TI",
      homepageUrl: "https://www.dota2.com/news",
      url: "https://store.steampowered.com/feeds/news/app/570/?cc=US&l=english",
      category: "esports",
    }],
    enabled: true,
    selected: true,
    category: "esports",
    discoveryOnly: false,
    note: "DOTA2 · 全球赛事 · Valve 官方",
  },
  {
    id: "dota2-cn-official",
    name: "DOTA2 国服",
    kind: "rss",
    homepageUrl: "https://www.dota2.com.cn/",
    topicIds: ["esports"],
    routes: [{
      topicId: "esports",
      label: "国服赛事新闻",
      homepageUrl: "https://www.dota2.com.cn/news/gamenews/",
      query: "site:dota2.com.cn (DOTA2 OR 刀塔 OR 国际邀请赛 OR TI OR 赛事)",
      category: "esports",
    }],
    enabled: true,
    selected: false,
    category: "esports",
    discoveryOnly: false,
    note: "DOTA2 · 国服赛事 · 完美世界官方",
  },
  {
    id: "counter-strike-official",
    name: "Counter-Strike 官方",
    kind: "rss",
    homepageUrl: "https://www.counter-strike.net/news",
    topicIds: ["esports"],
    routes: [{
      topicId: "esports",
      label: "CS2 / Major",
      homepageUrl: "https://www.counter-strike.net/news",
      url: "https://store.steampowered.com/feeds/news/app/730/?cc=US&l=english",
      category: "esports",
    }],
    enabled: true,
    selected: true,
    category: "esports",
    discoveryOnly: false,
    note: "CS2 · 全球赛事 · Valve 官方",
  },
  {
    id: "cs2-cn-official",
    name: "CS2 国服",
    kind: "rss",
    homepageUrl: "https://www.csgo.com.cn/",
    topicIds: ["esports"],
    routes: [{
      topicId: "esports",
      label: "国服赛事新闻",
      homepageUrl: "https://www.csgo.com.cn/news",
      query: "site:csgo.com.cn (CS2 OR 反恐精英 OR CAC OR 战队 OR 赛事)",
      category: "esports",
    }],
    enabled: true,
    selected: false,
    category: "esports",
    discoveryOnly: false,
    note: "CS2 · 国服赛事 · 完美世界官方",
  },
  {
    id: "hltv",
    name: "HLTV",
    kind: "rss",
    homepageUrl: "https://www.hltv.org/",
    topicIds: ["esports"],
    routes: [{
      topicId: "esports",
      label: "Counter-Strike 赛事",
      homepageUrl: "https://www.hltv.org/",
      query: "site:hltv.org/news (Counter-Strike OR CS2 OR Major)",
      category: "esports",
    }],
    enabled: true,
    selected: false,
    category: "esports",
    discoveryOnly: false,
    note: "CS2 · 专业赛事媒体 · 经新闻索引采集",
  },
  {
    id: "inven-global-lol",
    name: "Inven Global",
    kind: "rss",
    homepageUrl: "https://www.invenglobal.com/lol",
    topicIds: ["esports"],
    routes: [{
      topicId: "esports",
      label: "LCK / League of Legends",
      homepageUrl: "https://www.invenglobal.com/lol",
      query: "site:invenglobal.com/lol (LCK OR T1 OR Gen.G OR League of Legends)",
      category: "esports",
    }],
    enabled: true,
    selected: false,
    category: "esports",
    discoveryOnly: false,
    note: "英雄联盟 · LCK 韩服媒体 · 英文",
  },
  {
    id: "ign-games",
    name: "IGN",
    kind: "rss",
    homepageUrl: "https://www.ign.com/",
    topicIds: ["gaming", "esports"],
    routes: [
      {
        topicId: "gaming",
        label: "Games",
        homepageUrl: "https://www.ign.com/games",
        query: "site:ign.com (game OR gaming OR PlayStation OR Xbox OR Nintendo OR Steam)",
        category: "gaming",
      },
      {
        topicId: "esports",
        label: "Esports",
        homepageUrl: "https://www.ign.com/esports",
        query: "site:ign.com (esports OR tournament OR Valorant OR League of Legends)",
        category: "esports",
      },
    ],
    enabled: true,
    selected: false,
    category: "gaming",
    discoveryOnly: false,
    note: "官方网站 · 游戏 / 电竞",
  },
  {
    id: "dot-esports",
    name: "Dot Esports",
    kind: "rss",
    homepageUrl: "https://dotesports.com/",
    topicIds: ["gaming", "esports"],
    routes: [
      {
        topicId: "gaming",
        label: "Gaming",
        homepageUrl: "https://dotesports.com/gaming",
        query: "site:dotesports.com (gaming OR videogame)",
        category: "gaming",
      },
      {
        topicId: "esports",
        label: "Esports",
        homepageUrl: "https://dotesports.com/esports",
        query: "site:dotesports.com (esports OR tournament OR team OR player)",
        category: "esports",
      },
    ],
    enabled: true,
    selected: false,
    category: "esports",
    discoveryOnly: false,
    note: "官方网站 · 游戏 / 电竞",
  },
  {
    id: "x-ai-official",
    name: "AI 官方账号（X）",
    kind: "x",
    homepageUrl: "https://x.com/",
    query: "OpenAI, AnthropicAI, GoogleDeepMind",
    topicIds: ["ai", "technology", "science"],
    enabled: false,
    selected: false,
    category: "ai-official",
    role: "official",
    discoveryOnly: false,
    note: "X API v2 · 官方账号原帖 · 需配置 Bearer Token",
  },
];

const localSkillPath = (skillDirectory: string) =>
  path.join(homedir(), ".codex", "skills", skillDirectory, "SKILL.md");

export const defaultSources: SourceConfig[] = configuredDefaultSources.map((source) => ({
  ...source,
  role: sourceRoleFor(source),
}));

const presetTimestamp = "2026-08-18T00:00:00.000Z";

export const defaultSourcePresets: SourcePreset[] = [
  {
    id: "preset_ai_daily",
    name: "AI 日常完整包",
    sourceIds: [
      "openai-official",
      "x-ai-official",
      "anthropic-official",
      "deepmind-official",
      "microsoft-official",
      "nvidia-official",
      "aws-ml-official",
      "github-official",
      "qwen-official",
      "deepseek-official",
      "zhipu-official",
      "kimi-official",
      "reuters-ai",
      "ap-ai",
      "bbc-technology",
      "techcrunch-ai",
      "ars-ai",
      "mit-technology-review",
      "hackernews",
      "v2ex-community",
      "github-project-community",
      "google-news-ai",
    ],
    createdAt: presetTimestamp,
    updatedAt: presetTimestamp,
  },
  {
    id: "preset_discovery",
    name: "综合检索与社区热点",
    sourceIds: [
      "google-news-ai",
      "hackernews",
      "v2ex-community",
      "github-project-community",
      "qbitai",
      "jiqizhixin",
      "36kr-technology",
      "last30days-community",
      "zhihu-community",
    ],
    createdAt: presetTimestamp,
    updatedAt: presetTimestamp,
  },
  {
    id: "preset_research_policy",
    name: "研究、政策与安全",
    sourceIds: [
      "microsoft-research",
      "mit-news-ai",
      "nist-news",
      "ftc-press",
      "cisa-advisories",
      "cloudflare-blog",
    ],
    createdAt: presetTimestamp,
    updatedAt: presetTimestamp,
  },
  {
    id: "preset_esports",
    name: "电竞与游戏",
    sourceIds: [
      "lpl-official",
      "lolesports-official",
      "dota2-official",
      "dota2-cn-official",
      "counter-strike-official",
      "cs2-cn-official",
      "hltv",
      "inven-global-lol",
      "ign-games",
      "dot-esports",
    ],
    createdAt: presetTimestamp,
    updatedAt: presetTimestamp,
  },
];

const defaultDailyAiSourceIds = new Set(
  defaultSourcePresets.find((preset) => preset.id === "preset_ai_daily")?.sourceIds ?? [],
);

export const defaultSettings: Settings = {
  windowHours: 24,
  collectionTopics: ["ai"],
  personalizationEnabled: true,
  notificationsMuted: true,
  scheduleEnabled: true,
  scheduleTime: "22:30",
  draftMode: "separate",
  imagePolicy: "source",
  imageLimit: 8,
  autoGenerate: false,
  autoGenerateCount: 3,
  community: "盒友杂谈",
  defaultTopics: [],
  recentTopics: [],
  recentCommunities: [],
  publisherMode: "chrome-extension",
  xiaoheiheEditorUrl: "https://xiaoheihe.cn/community/user/post_list",
  chromeDebugPort: 9222,
  wechat: {
    accountName: "",
    appId: "",
    defaultAuthor: "",
    appSecretConfigured: false,
  },
};

export const defaultEditorialProfile = () => ({
  positioning: "",
  audience: "",
  goals: [],
  preferredTopicIds: [] as CollectionTopicId[],
  voiceGuidelines: [],
  redLines: [],
});

const legacyCandidateSourceNames: Record<string, string> = {
  "OpenAI 官方": "OpenAI",
  "Anthropic 官方": "Anthropic",
  "BBC Technology": "BBC",
  "TechCrunch AI": "TechCrunch",
  "Ars Technica AI": "Ars Technica",
  "Reuters AI（发现）": "Reuters",
  "Bloomberg AI（发现）": "Bloomberg",
  "AP AI（发现）": "Associated Press",
  "华盛顿邮报（发现）": "The Washington Post",
  "CNN AI（发现）": "CNN",
  "Google News 话题检索": "Google News",
};

const importedAt = "2026-08-11T00:00:00.000Z";

export const defaultProviders: AiProviderConfig[] = [
  {
    id: "codex-cli",
    name: "Codex（ChatGPT 登录）",
    vendor: "OpenAI",
    description: "使用这台电脑上的 ChatGPT 登录态，无需另填 API Key。",
    kind: "codex-cli",
    model: "gpt-5.4",
    supportsVision: true,
    apiKeyConfigured: true,
  },
  {
    id: "qwen",
    name: "通义千问",
    vendor: "阿里云百炼",
    description: "适合中文成稿；可预先配置视觉模型，为截图成稿入口做准备。",
    kind: "openai-compatible",
    model: "qwen-plus",
    visionModel: "qwen3-vl-plus",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    supportsVision: true,
    apiKeyConfigured: false,
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    vendor: "DeepSeek",
    description: "适合文本成稿、改写与观点润色。",
    kind: "openai-compatible",
    model: "deepseek-chat",
    baseUrl: "https://api.deepseek.com",
    supportsVision: false,
    apiKeyConfigured: false,
  },
  {
    id: "openai-api",
    name: "OpenAI API",
    vendor: "OpenAI",
    description: "使用独立 OpenAI API Key，与 ChatGPT 订阅分开计费。",
    kind: "openai-compatible",
    model: "gpt-5-mini",
    baseUrl: "https://api.openai.com/v1",
    supportsVision: true,
    apiKeyConfigured: false,
  },
  {
    id: "custom-compatible",
    name: "自定义兼容接口",
    vendor: "OpenAI-compatible",
    description: "接入其他兼容 Chat Completions 的模型服务。",
    kind: "openai-compatible",
    model: "",
    baseUrl: "",
    supportsVision: false,
    apiKeyConfigured: false,
  },
];

export const defaultSkills: ArticleSkillConfig[] = [
  {
    id: "news-desk",
    name: "news-desk",
    description: "核验新闻时间窗、一手来源、证据与图片。",
    sourcePath: localSkillPath("news-desk"),
    enabled: true,
    builtIn: true,
    compatibility: "codex-native",
    scopes: ["generation", "analysis"],
    importedAt,
  },
  {
    id: "agent-reach",
    name: "agent-reach",
    description: "跨站搜索并回到原始来源核验。",
    sourcePath: localSkillPath("agent-reach"),
    enabled: true,
    builtIn: true,
    compatibility: "codex-native",
    scopes: ["generation", "analysis"],
    importedAt,
  },
  {
    id: "lieflat-less-ai-tone",
    name: "lieflat-less-ai-tone",
    description: "默认白名单式去 AI 味审计：只改明确命中的句式，保留结构、事实与未命中文字。",
    sourcePath: localSkillPath("lieflat-less-ai-tone"),
    enabled: true,
    builtIn: true,
    compatibility: "prompt-compatible",
    scopes: ["optimization"],
    importedAt,
  },
  {
    id: "ra-renhua",
    name: "ra-人话",
    description: "需要更强个人表达时才启用；自动模式仅在评论稿中叠加。",
    sourcePath: localSkillPath("ra-人话"),
    enabled: true,
    builtIn: true,
    compatibility: "prompt-compatible",
    scopes: ["optimization"],
    importedAt,
  },
];

export const defaultAiSettings = (): AiSettings => ({
  activeProviderId: "codex-cli",
  analysisProviderId: "codex-cli",
  optimizationProviderId: "codex-cli",
  writingReviewMode: "auto",
  providers: defaultProviders.map((provider) => ({ ...provider })),
  latestProviderHealth: {},
  skills: defaultSkills.map((skill) => ({ ...skill, scopes: skill.scopes ? [...skill.scopes] : undefined })),
});

const providerHealthStatuses = new Set<ProviderHealthStatus>(["healthy", "warning", "error"]);
const providerHealthErrorCategories = new Set<ProviderHealthErrorCategory>([
  "none",
  "not-configured",
  "auth",
  "config",
  "network",
  "timeout",
  "rate-limit",
  "model",
  "server",
  "invalid-response",
  "unknown",
]);

const normalizeProviderHealth = (
  value: unknown,
  providerId: string,
): ProviderHealthResult | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Partial<ProviderHealthResult>;
  if (record.providerId !== providerId) return undefined;
  if (typeof record.lastCheckedAt !== "string" || !Number.isFinite(Date.parse(record.lastCheckedAt))) return undefined;
  if (!providerHealthStatuses.has(record.status as ProviderHealthStatus)) return undefined;
  if (!Number.isFinite(record.latencyMs) || Number(record.latencyMs) < 0) return undefined;
  if (typeof record.model !== "string" || typeof record.safeMessage !== "string") return undefined;
  if (!providerHealthErrorCategories.has(record.errorCategory as ProviderHealthErrorCategory)) return undefined;
  return {
    providerId,
    lastCheckedAt: new Date(record.lastCheckedAt).toISOString(),
    status: record.status as ProviderHealthStatus,
    latencyMs: Math.round(Number(record.latencyMs)),
    model: record.model.trim().slice(0, 120),
    errorCategory: record.errorCategory as ProviderHealthErrorCategory,
    safeMessage: record.safeMessage.trim().slice(0, 300),
  };
};

export const upgradeState = (state: WorkflowState): WorkflowState => {
  const previousVersion = Number(state.version || 0);
  state.version = 13;
  state.settings = { ...defaultSettings, ...state.settings };
  state.settings.wechat = {
    ...defaultSettings.wechat,
    ...(state.settings.wechat ?? {}),
    accountName: typeof state.settings.wechat?.accountName === "string"
      ? state.settings.wechat.accountName.slice(0, 80)
      : "",
    appId: typeof state.settings.wechat?.appId === "string"
      ? state.settings.wechat.appId.slice(0, 80)
      : "",
    defaultAuthor: typeof state.settings.wechat?.defaultAuthor === "string"
      ? state.settings.wechat.defaultAuthor.slice(0, 16)
      : "",
    appSecretConfigured: state.settings.wechat?.appSecretConfigured === true,
  };
  const storedEditorialProfile = state.editorialSystem?.profile;
  const editorialProfileWasNeverSaved = !storedEditorialProfile?.updatedAt
    && !storedEditorialProfile?.positioning?.trim()
    && !storedEditorialProfile?.audience?.trim()
    && !(storedEditorialProfile?.goals?.length)
    && !(storedEditorialProfile?.voiceGuidelines?.length)
    && !(storedEditorialProfile?.redLines?.length);
  state.editorialSystem = {
    profile: {
      ...defaultEditorialProfile(),
      ...storedEditorialProfile,
      preferredTopicIds: editorialProfileWasNeverSaved
        ? []
        : normalizeOptionalTopicIds(storedEditorialProfile?.preferredTopicIds),
    },
    suggestionDecisions: Array.isArray(state.editorialSystem?.suggestionDecisions)
      ? state.editorialSystem.suggestionDecisions.slice(0, 100)
      : [],
  };
  state.settings.collectionTopics = normalizeTopicIds(state.settings.collectionTopics);
  state.settings.recentTopics = Array.isArray(state.settings.recentTopics)
    ? state.settings.recentTopics.filter((topic): topic is string => typeof topic === "string").slice(0, 20)
    : [];
  state.settings.recentCommunities = Array.isArray(state.settings.recentCommunities)
    ? state.settings.recentCommunities.filter((community): community is string => typeof community === "string").slice(0, 8)
    : [];
  state.draftRevisions ??= [];
  state.articleAgentThreads ??= [];
  state.materials ??= [];
  state.intakeReviews ??= [];
  state.aiRunTraces ??= [];
  state.publisherReceipts ??= [];
  state.notifications = normalizeWorkflowNotifications(state.notifications);
  state.sourcePresets ??= [];
  state.candidateFeedback ??= [];
  state.materials = state.materials.map((material) => ({
    ...material,
    rights: (material.rights as string) === "commentary-screenshot"
      ? "editorial-screenshot"
      : material.rights,
    allowedPlatforms: Array.isArray(material.allowedPlatforms)
      ? material.allowedPlatforms
      : material.rights === "owned" ? ["*"] : [],
    entityTags: Array.isArray(material.entityTags) ? material.entityTags : material.tags ?? [],
    fingerprint: typeof material.fingerprint === "string" ? material.fingerprint : "",
  }));
  const validDraftStatuses = new Set([
    "editing", "reviewing", "needs-images", "ready", "filled", "published", "shelved",
  ]);
  state.drafts = (state.drafts ?? []).map((draft) => ({
    ...draft,
    status: validDraftStatuses.has(draft.status) ? draft.status : "editing",
    contentFormat: draft.contentFormat === "image-post" ? "image-post" : "article",
  }));

  const storedSources = state.sources ?? [];
  const defaultSourceIds = new Set(defaultSources.map((source) => source.id));
  state.sources = [
    ...defaultSources.map((source) => {
      const stored = storedSources.find((entry) => entry.id === source.id);
      if (!stored) {
        return {
          ...source,
          topicIds: [...sourceTopicIds(source)],
          routes: source.routes?.map((route) => ({ ...route })),
        };
      }
      return {
        ...stored,
        ...source,
        enabled: stored.enabled,
        selected: previousVersion < 8 && [
          "lpl-official",
          "lolesports-official",
          "dota2-official",
          "counter-strike-official",
        ].includes(source.id) ? true : stored.selected,
        topicIds: [...sourceTopicIds(source)],
        routes: source.routes?.map((route) => ({ ...route })),
        health: stored.health,
        lastCheckedAt: stored.lastCheckedAt,
        lastRawCount: stored.lastRawCount,
        lastCandidateCount: stored.lastCandidateCount,
        lastHealthDetail: stored.lastHealthDetail,
        lastSuccessfulAt: stored.lastSuccessfulAt
          ?? (stored.health === "healthy" ? stored.lastCheckedAt : undefined),
        consecutiveFailures: stored.consecutiveFailures ?? 0,
      };
    }),
    ...storedSources
      .filter((source) => !defaultSourceIds.has(source.id))
      .map((source) => ({
        ...source,
        topicIds: [...sourceTopicIds(source)],
        role: sourceRoleFor(source),
        lastSuccessfulAt: source.lastSuccessfulAt
          ?? (source.health === "healthy" ? source.lastCheckedAt : undefined),
        consecutiveFailures: source.consecutiveFailures ?? 0,
      })),
  ];
  if (previousVersion < 10 && state.settings.collectionTopics.length === 1 && state.settings.collectionTopics[0] === "ai") {
    for (const source of state.sources) source.selected = source.enabled && defaultDailyAiSourceIds.has(source.id);
  }
  const activeChannelLabel = topicLabels(state.settings.collectionTopics).join("／");
  for (const source of state.sources) {
    const legacyMismatchedEmptyWarning = source.health === "warning"
      && source.lastRawCount === 0
      && source.lastHealthDetail === "本轮没有读取到条目"
      && !sourceSupportsTopics(source, state.settings.collectionTopics);
    if (!legacyMismatchedEmptyWarning) continue;
    source.health = source.lastSuccessfulAt ? "healthy" : "unknown";
    source.consecutiveFailures = 0;
    source.lastHealthDetail = `未参与当前 ${activeChannelLabel} 频道；请在对应频道运行或单独测试`;
  }
  if (previousVersion < 10) {
    const existingPresetIds = new Set(state.sourcePresets.map((preset) => preset.id));
    state.sourcePresets.push(...defaultSourcePresets
      .filter((preset) => !existingPresetIds.has(preset.id))
      .map((preset) => ({ ...preset, sourceIds: [...preset.sourceIds] })));
  }
  if (previousVersion < 12) {
    for (const defaultPreset of defaultSourcePresets) {
      const storedPreset = state.sourcePresets.find((preset) => preset.id === defaultPreset.id);
      if (!storedPreset) {
        state.sourcePresets.push({ ...defaultPreset, sourceIds: [...defaultPreset.sourceIds] });
        continue;
      }
      // v12 adds first-class V2EX and GitHub community adapters. Merge only
      // source ids that did not exist in older builds; later user removals are
      // preserved because this migration runs once.
      const newlyIntroduced = defaultPreset.sourceIds.filter((sourceId) =>
        sourceId === "v2ex-community" || sourceId === "github-project-community");
      storedPreset.sourceIds = [...new Set([...storedPreset.sourceIds, ...newlyIntroduced])];
      storedPreset.updatedAt = presetTimestamp;
    }
  }
  if (previousVersion < 13) {
    const dailyPreset = state.sourcePresets.find((preset) => preset.id === "preset_ai_daily");
    if (dailyPreset) {
      dailyPreset.sourceIds = [...new Set([...dailyPreset.sourceIds, "x-ai-official"])];
      dailyPreset.updatedAt = presetTimestamp;
    }
  }
  const availableSourceIds = new Set(state.sources.map((source) => source.id));
  state.sourcePresets = state.sourcePresets.flatMap((preset) => {
    if (!preset || typeof preset.id !== "string" || typeof preset.name !== "string") return [];
    const sourceIds = Array.isArray(preset.sourceIds)
      ? [...new Set(preset.sourceIds.filter((sourceId): sourceId is string =>
        typeof sourceId === "string" && availableSourceIds.has(sourceId)))]
      : [];
    if (!sourceIds.length) return [];
    return [{ ...preset, name: preset.name.trim(), sourceIds }];
  });

  const storedProviders = state.aiSettings?.providers ?? [];
  const storedSkills = state.aiSettings?.skills ?? [];
  const storedProviderHealth = state.aiSettings?.latestProviderHealth ?? {};
  state.aiSettings = {
    activeProviderId: state.aiSettings?.activeProviderId || "codex-cli",
    analysisProviderId: state.aiSettings?.analysisProviderId || state.aiSettings?.activeProviderId || "codex-cli",
    optimizationProviderId: state.aiSettings?.optimizationProviderId || state.aiSettings?.activeProviderId || "codex-cli",
    writingReviewMode: ["auto", "minimal", "voice", "off"].includes(state.aiSettings?.writingReviewMode)
      ? state.aiSettings.writingReviewMode
      : "auto",
    providers: defaultProviders.map((provider) => ({
      ...provider,
      ...storedProviders.find((stored) => stored.id === provider.id),
      description: provider.description,
    })),
    latestProviderHealth: {},
    skills: [
      ...defaultSkills.map((skill) => {
        const stored = storedSkills.find((entry) => entry.id === skill.id);
        return {
          ...skill,
          ...stored,
          description: skill.description,
          sourcePath: skill.sourcePath,
          scopes: Array.isArray(stored?.scopes) && stored.scopes.length
            ? [...stored.scopes]
            : skill.scopes ? [...skill.scopes] : undefined,
        };
      }),
      ...storedSkills.filter((stored) => !defaultSkills.some((skill) => skill.id === stored.id)),
    ],
  };
  for (const provider of state.aiSettings.providers) {
    const health = normalizeProviderHealth(storedProviderHealth[provider.id], provider.id);
    if (health) state.aiSettings.latestProviderHealth[provider.id] = health;
  }
  if (!state.aiSettings.providers.some((provider) => provider.id === state.aiSettings.activeProviderId)) {
    state.aiSettings.activeProviderId = "codex-cli";
  }
  if (!state.aiSettings.providers.some((provider) => provider.id === state.aiSettings.analysisProviderId)) {
    state.aiSettings.analysisProviderId = "codex-cli";
  }
  if (!state.aiSettings.providers.some((provider) => provider.id === state.aiSettings.optimizationProviderId)) {
    state.aiSettings.optimizationProviderId = "codex-cli";
  }
  for (const run of state.runs) {
    run.topicIds = normalizeTopicIds(run.topicIds ?? ["ai"]);
    run.keywords = run.keywords?.trim() || undefined;
    for (const candidate of run.candidates) {
      candidate.sourceName = legacyCandidateSourceNames[candidate.sourceName] ?? candidate.sourceName;
      if (candidate.sourceType === "hackernews") candidate.sourceName = "Hacker News";
      candidate.heatScore ??= 0;
      candidate.heatBreakdown ??= { engagement: 0, sourceReach: 0, crossSource: 0, freshness: 0 };
      candidate.recommendationScore ??= Math.round((candidate.score / 15) * 60);
      candidate.personalizationScore ??= 0;
      candidate.personalizationReasons ??= [];
      candidate.topicIds = normalizeTopicIds(candidate.topicIds ?? run.topicIds);
      candidate.clusterSize ??= 1;
      candidate.relatedSources ??= [candidate.sourceName];
    }
    if (run.origin !== "link-intake" && run.origin !== "screenshot-intake") {
      run.candidates = sortCandidates(
        run.candidates,
        state.candidateFeedback,
        state.settings.personalizationEnabled,
      );
    }
    for (const result of run.sourceResults ?? []) {
      result.sourceName = legacyCandidateSourceNames[result.sourceName] ?? result.sourceName;
      result.healthImpact ??= result.status === "error"
        ? "failure"
        : result.rawCount > 0
          ? "success"
          : "neutral";
    }
  }
  for (const draft of state.drafts) {
    draft.factClaims ??= [];
  }
  for (const revision of state.draftRevisions) {
    revision.snapshot.factClaims ??= [];
  }
  return state;
};

export const createDefaultState = (): WorkflowState => ({
  version: 13,
  settings: { ...defaultSettings, wechat: { ...defaultSettings.wechat } },
  editorialSystem: { profile: defaultEditorialProfile(), suggestionDecisions: [] },
  aiSettings: defaultAiSettings(),
  materials: [],
  sources: defaultSources.map((source) => ({
    ...source,
    selected: source.enabled && defaultDailyAiSourceIds.has(source.id),
  })),
  sourcePresets: defaultSourcePresets.map((preset) => ({ ...preset, sourceIds: [...preset.sourceIds] })),
  candidateFeedback: [],
  runs: [],
  drafts: [],
  draftRevisions: [],
  articleAgentThreads: [],
  intakeReviews: [],
  aiRunTraces: [],
  publisherReceipts: [],
  notifications: [],
});
