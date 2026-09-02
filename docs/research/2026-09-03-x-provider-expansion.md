# X 官方信号、四厂商发布档案与 Tab 补全扩展调研

> 核查日期：2026-09-03（Asia/Hong_Kong）
> 证据范围：只使用 X、厂商官网与官方文档、厂商官方 GitHub，以及相关开源项目自己的仓库/文档。媒体转述、聚合站和社区传言不用于确认实现能力或产品事实。
> 本文只做研究与实施设计，不修改生产代码、运行配置或 `.workflow/` 用户数据。

## 结论先行

1. **X 可以合规地做到接近实时监控，而且现在有比轮询更适合“重点账号白名单”的官方能力。** 对几十个固定官方账号，首选 [X Activity API](https://docs.x.com/x-api/activity/introduction) 的 `post.create` / `post.delete` 订阅：它按稳定 `user_id` 过滤，官方称公开事件可用 App-only Bearer Token，延迟可到亚秒级。应用在 Windows 本地运行时可保持 persistent HTTP stream，不必为了接收事件先暴露公网 webhook。
2. **现有 Recent Search 适配器仍然值得保留，但应降级为断线补偿与低成本模式。** 官方 Recent Search 覆盖最近 7 天、每页最多 100 条，支持 `from:`、`since_id`、排除回复和转帖；它非常适合启动补抓、掉线修复和用户暂时不启用长连接时每 3–5 分钟轮询。[Search Posts](https://docs.x.com/x-api/posts/search/introduction)
3. **Filtered Stream 不是必须替代 X Activity。** 它更适合“账号 + 关键词 + 语言 + 媒体”等布尔规则；官方标注 P99 延迟约 6–7 秒。只监控固定账号时，X Activity 更直接；需要按产品名降噪或扩展到非白名单话题时，再启用 Filtered Stream。[Filtered Stream](https://docs.x.com/x-api/posts/filtered-stream/introduction)
4. **X 帖子不能一进入系统就变成事实。** 公司官方帖、产品官方帖、高管个人帖和第三方榜单帖必须分别建模。默认先进入 `discovery_only`；帖子链接官方公告时，抓取 canonical 页面作为事实主源；自包含的经核验公司帖，最多直接支持“该账号在该时间公开说了什么”。性能、价格、安全范围和第三方结果仍应回到正式文档冻结。
5. **OpenAI、Gemini/DeepMind、DeepSeek、Qwen 都能建立稳定的“厂商发布档案”，不应只靠新闻 RSS。** 发布页、API changelog、模型目录、价格、模型卡/系统卡、官方 GitHub 和图表必须作为不同 facet 汇入同一个 Story；缺一项时显示“待补齐”，而不是把整个高价值选题过滤掉。
6. **Tab 补全不必锁定 OpenAI。** 当前 OpenAI-compatible Chat Completions 流式路径可继续作为通用底座；DeepSeek 已有低价、非思考模式，并另有官方 FIM Beta。跨段落补全仍应优先走带系统提示和证据约束的 chat 流，而不是直接把 FIM 当作整篇文章续写器。
7. **编辑器无需换底座。** 保留现有 Tiptap/ProseMirror，实现 VS Code 的 forward stability、显式/自动两类触发、分段接受和完整生命周期统计；借鉴 Continue 的 prefix/suffix、低延迟模型、缓存和 debounce 思路，但不要把已只读维护的 Continue 仓库或 Tiptap 的付费 AI 服务引入为运行时依赖。

## 1. X 重点账号监控：推荐拓扑

### 1.1 四层通道，而不是押注一个接口

| 层级 | 官方能力 | 本项目用途 | 当前官方约束 |
| --- | --- | --- | --- |
| 实时主通道 | [X Activity API](https://docs.x.com/x-api/activity/introduction) | 对经过人工核验的重点 `user_id` 订阅 `post.create`、`post.delete` 和必要的 profile update | 公开事件支持 App-only；Self-serve 最多 1,500 个订阅；`/2/activity/stream` 允许 2 个连接、250 Posts/s；官方称亚秒级交付 |
| 规则降噪 | [Filtered Stream](https://docs.x.com/x-api/posts/filtered-stream/introduction) | 账号很多、回复噪声大，或需叠加产品名、语言、链接/图片条件时使用 | 1 个连接、1,000 条规则、单规则 1,024 字符、250 Posts/s；官方称 P99 约 6–7 秒 |
| 断线补偿 | [Recent Search](https://docs.x.com/x-api/posts/search/introduction) | 应用重启、网络中断或余额中断后，以 `since_id` 补齐 | 最近 7 天；100 条/页；Self-serve 查询 512 字符 |
| 单号核对 | [User Posts Timeline](https://docs.x.com/x-api/posts/timelines/introduction) | 对某个高价值账号做完整性审计，或处理超长组合查询 | 最近最多约 3,200 条；可排除 replies/retweets；按稳定用户 ID 查询 |

推荐运行方式：

```text
X Activity post.create
        │
        ├─ 去重、身份核验、类型分类 ──> Signal / Story
        │
        └─ post.delete / profile.update ──> 撤回证据或重新核验身份

应用启动 / 流断开 / 余额恢复
        └─ Recent Search since_id 分页补抓 ──> 同一去重入口

需要关键词、语言或媒体降噪
        └─ 可选 Filtered Stream ──> 同一去重入口
```

这套组合的关键不是追求“永不掉线”，而是允许实时流失败后可恢复、可说明、不会漏掉已经公开的高价值信号。

### 1.2 认证、账号 ID 与本地运行

- 需要 X Developer Account、Project、App 和 Bearer Token；公开 Post 读取以及 X Activity 的公开事件不要求被监控账号逐一 OAuth 授权。[Getting Access](https://docs.x.com/x-api/getting-started/getting-access) [X Activity public events](https://docs.x.com/x-api/activity/introduction#event-privacy-and-authentication)
- 第一次配置账号时，调用 `/2/users/by` 或 `/2/users/by/username/:username`，保存 **稳定数字 `user_id`**。handle 只作为显示名和复核字段；改名后不应让监控静默失效。[User Lookup](https://docs.x.com/x-api/users/lookup/introduction)
- 本地桌面服务优先使用 persistent HTTP stream。若未来有可靠公网 HTTPS 接收端，再选 X Activity webhook；webhook 需要签名校验、重放和幂等处理。[X Activity quickstart](https://docs.x.com/x-api/activity/quickstart) [Webhooks](https://docs.x.com/x-api/webhooks/introduction)
- Bearer Token 只存 Windows DPAPI；不得进入日志、导出包、Git 或前端状态。

### 1.3 速率、成本与预算边界

截至核查日，X 官方给出的相关限制如下：[Rate Limits](https://docs.x.com/x-api/fundamentals/rate-limits)

| 接口 | Per App 限制 | 额外限制 |
| --- | ---: | --- |
| `/2/activity/stream` | 450 次连接尝试 / 15 分钟 | 2 个并发连接；250 Posts/s |
| Activity subscriptions | 500 次操作 / 15 分钟 | Self-serve 1,500 个订阅 |
| Recent Search | 450 次请求 / 15 分钟 | 100 条/页；512 字符查询 |
| Filtered Stream | 50 次连接 / 15 分钟 | 1 个连接；1,000 条规则；250 Posts/s |
| Filtered Stream rules GET / POST | 450 / 100 次 / 15 分钟 | 单规则 1,024 字符 |
| User Posts Timeline | 10,000 次 / 15 分钟 | 按账号核对，不应用于无意义高频轮询 |

[X 当前按量定价页](https://docs.x.com/x-api/getting-started/pricing)列出的 Post read 和 X Activity `post.create` 都是 `$0.005/条`；`post.delete` webhook event 当前不计费。相同资源在同一 UTC 日内通常只计一次，但官方把这种 24 小时去重称为 soft guarantee。Self-serve 每月最多 300 万 Post reads，价格可能变化，控制台才是最终值。

因此成本模型应写成：

```text
月 X 成本 ≈ 当月唯一可计费 Post 数 × 当期 Post 单价
           + User lookup 等其他资源
```

不要把“每 3 分钟轮询 14,400 次/月”错误地直接乘 Post 单价；读取收费按返回资源，空响应不等于读取一条 Post。实现上仍应：

- 默认设置低额 spending limit，关闭或严格限制自动充值；
- 每日记录 `/2/usage`、余额、唯一 Post 数和预估成本；
- 同一 Post ID 全局去重，而不是每个来源各自计一次；
- 429 按 `x-rate-limit-reset` 等待，并使用指数退避；
- 长连接缺少 keepalive、网络切换或服务重启后，先补抓再恢复实时流。

### 1.4 现有适配器成熟度

[现有 `server/x-official.ts`](../../server/x-official.ts) 已经做对了几件重要的事：使用官方 Recent Search、`since_id`、排除回复/转帖、精确作者白名单、媒体 expansions、20 秒超时和 429 reset 提示。因此它不是废代码，应保留为恢复通道。

仍有六个结构性缺口：

1. 只保存 handle，没有稳定 `user_id` 账号注册表；
2. 一次只读首个最多 100 条结果，恢复窗口内如果溢出便可能漏项，需完整处理 `next_token`；
3. 所有帖子都写成 `source_role: "official"`，没有公司、产品、开发者、高管等身份层级；
4. 没有 `post.delete`、编辑/重抓状态和证据撤回流程；
5. 没有实时长连接、连接健康、最后事件时间、补抓范围和月度费用可见性；
6. 链接到外部网页后虽记录 `canonical_url`，但没有强制执行“网页为事实主源、X 为发现入口”的升级规则。

## 2. X 账号白名单与证据边界

### 2.1 首批精确账号

以下是适合本项目的首批候选。**写进默认配置前仍必须通过官方 API 解析数字 ID，并由人工核验官网反向链接、组织身份或 affiliation；蓝色订阅标记本身不是官方身份证明。** X 提供组织与账号标签，账号也可能改名或被接管，因此应定期复核。[X profile labels](https://help.x.com/en/rules-and-policies/profile-labels)

#### P0：本轮四家厂商

| 厂商 | 账号 | 账号类别 | 默认用途 |
| --- | --- | --- | --- |
| OpenAI | [@OpenAI](https://x.com/OpenAI) | `vendor_official` | 模型/产品预告、正式公告链接、安全声明 |
| OpenAI | [@OpenAIDevs](https://x.com/OpenAIDevs) | `developer_official` | API、Codex、开发者能力和迁移提醒 |
| Google | [@GoogleDeepMind](https://x.com/GoogleDeepMind) | `research_vendor_official` | 模型、研究、模型卡和论文发布 |
| Google | [@GeminiApp](https://x.com/GeminiApp) | `product_official` | Gemini 用户产品能力与上线范围 |
| Google | [@GoogleAIStudio](https://x.com/GoogleAIStudio) | `developer_official` | Gemini API / AI Studio 开发者变化 |
| DeepSeek | [@deepseek_ai](https://x.com/deepseek_ai) | `vendor_official` | 官方发布、API 更新和安全提醒；DeepSeek 官方文档页脚链接到此账号 |
| Qwen | [@Alibaba_Qwen](https://x.com/Alibaba_Qwen) | `vendor_official` | Qwen 模型、开源权重、博客和技术报告；Qwen 官方 GitHub 组织反向链接到此账号 |
| Qwen / 阿里云 | [@alibaba_cloud](https://x.com/alibaba_cloud) | `platform_official` | Model Studio 上线、地域和服务可用性 |

#### P1：相邻高价值厂商

[@AnthropicAI](https://x.com/AnthropicAI)、[@claudeai](https://x.com/claudeai)、[@xai](https://x.com/xai)、[@AIatMeta](https://x.com/AIatMeta)、[@MicrosoftAI](https://x.com/MicrosoftAI)、[@NVIDIAAI](https://x.com/NVIDIAAI)、[@MistralAI](https://x.com/MistralAI)、[@cohere](https://x.com/cohere)、[@huggingface](https://x.com/huggingface)、[@perplexity_ai](https://x.com/perplexity_ai)。

其中 Hugging Face 属于模型分发/研究平台，不应被标为每个模型厂商的官方发布源；它只证明该平台公开了什么。

#### P2：高管和创始人，默认关闭、用户可选

[@sama](https://x.com/sama)、[@gdb](https://x.com/gdb)、[@demishassabis](https://x.com/demishassabis)、[@sundarpichai](https://x.com/sundarpichai)、[@satyanadella](https://x.com/satyanadella)、[@mustafasuleyman](https://x.com/mustafasuleyman)、[@elonmusk](https://x.com/elonmusk)、[@AravSrinivas](https://x.com/AravSrinivas)、[@ClementDelangue](https://x.com/ClementDelangue)。

高管账号适合发现预告、方向和评论，不自动等同公司法律/产品公告。DeepSeek 和 Qwen 暂不应靠同名个人账号猜测高管身份；没有足够的一方反向认证就不要加入。

### 2.2 从 Signal 到事实的升级规则

| X 内容 | 入库身份 | 能否直接进入冻结事实 | 正确动作 |
| --- | --- | --- | --- |
| 公司官方帖链接官网公告/文档/仓库 | `official_social`, `discovery_only` | 链接目标抓取成功前不进入 | 展开 t.co，抓 canonical 页面；帖子保留发布时间与传播上下文 |
| 经核验公司官方账号的自包含声明 | `official_social`, `first_party_statement` | 只能支持“该账号公开表示……”这条精确声明 | 保存 Post ID、user ID、原文、时间、编辑状态、快照；重要产品事实仍寻正式文档 |
| 产品/开发者账号 | `product_official` / `developer_official` | 只支持其职责范围内的上线与 API 陈述 | 与模型目录、changelog、release notes 交叉归档 |
| 高管个人账号 | `official_executive`, `discovery_only` | 默认不能独立支持价格、发布日期、性能和可用范围 | 路由到 Watch；等待公司公告或文档；需要引用时明确是个人表态 |
| 转帖、回复、引用评论 | `social_context` | 否 | 默认不采；用户明确要求社区声音时另走抽样规则 |
| 榜单/研究平台账号 | `benchmark_platform` | 不能证明厂商发布事实 | 回到平台原始排行榜/模型页并保存抓取时间与配置 |
| X Trends、Grok 摘要、自动回复 | `aggregated_discovery` | 否 | 只可触发检索，不得写入 ContentPackage 事实 |

最重要的数据拆分是：

```ts
type XAccountClass =
  | 'vendor_official'
  | 'product_official'
  | 'developer_official'
  | 'official_executive'
  | 'research_or_distribution_platform'

type XEvidenceRole =
  | 'discovery_only'
  | 'first_party_statement'
  | 'canonical_link_pointer'
  | 'commentary_only'

type XPostKind =
  | 'announcement'
  | 'preview'
  | 'release_link'
  | 'api_update'
  | 'correction'
  | 'commentary'
```

`verified`、`accountClass`、`evidenceRole` 和 `postKind` 是四件不同的事，不得互相替代。

### 2.3 合规 fallback

X 的现行服务条款明确禁止未经书面许可的爬取或浏览器自动化，因此不能用 Playwright 登录、复用浏览器 Cookie、抓 `x.com` HTML 或第三方镜像作为“免费 X 适配器”。[X Terms of Service](https://x.com/en/tos) [Developer Guidelines](https://docs.x.com/developer-guidelines)

没有 X API 余额或密钥时，按以下顺序兜底：

1. 厂商官方 RSS、changelog、sitemap、模型目录 API 和 GitHub release/commit feed；
2. 厂商官方 newsletter 邮件只做人类预警，正文仍回到其 canonical 网页；
3. 用户自己维护 [private X List](https://help.x.com/en/using-x/x-lists)，并为极少数账号打开 [“所有帖子”通知](https://help.x.com/en/managing-your-account/notifications-on-mobile-devices)；这是人工提醒，不伪装成自动采集；
4. X 恢复后由 Recent Search 在 7 天窗口内补抓。

显示 X 内容时保留原文、作者、时间、永久链接和平台标识，并处理删除/修改。[X Display Requirements](https://docs.x.com/developer-terms/display-requirements)

## 3. 四厂商“发布档案”稳定来源

### 3.1 共同模型：一个发布不是一条 RSS，而是一组 facet

每个模型/产品 Story 应维护以下状态，而不是等所有内容齐全后才允许推荐：

```ts
type VendorReleaseDossier = {
  vendor: 'openai' | 'google' | 'deepseek' | 'qwen'
  canonicalEntity: string
  eventStatus: 'rumored' | 'official_preview' | 'launched' | 'updated' | 'deprecated'
  firstSignalAt?: string
  officialLaunchAt?: string
  lastSignalAt: string
  announcement: FacetState
  modelIdentityAndLifecycle: FacetState
  accessAndAvailability: FacetState
  specifications: FacetState
  pricing: FacetState
  benchmarks: FacetState
  safetyOrModelCard: FacetState
  images: FacetState
  unknowns: FrozenUnknown[]
}

type FacetState = {
  status: 'missing' | 'found' | 'changed' | 'not_applicable'
  sources: SourceSnapshotRef[]
  checkedAt: string
}
```

首页推荐规则应是：**高价值 + 官方预告可以先进入 Watch/Brief；缺价格、跑分或系统卡显示“尚未公布”，不能因此被过滤掉。** 正式发布后再增量补齐同一 Story，避免一条发布被拆成多条重复新闻。

### 3.2 OpenAI

| Facet | 稳定入口 | 用途 |
| --- | --- | --- |
| 公告发现 | [OpenAI News RSS](https://openai.com/news/rss.xml)、[sitemap](https://openai.com/sitemap.xml)、[News](https://openai.com/news/) | 新公告、预告和 canonical URL；RSS 是增量主入口，sitemap 作漏项回查 |
| API 产品状态 | [Models](https://developers.openai.com/api/docs/models)、[All models](https://developers.openai.com/api/docs/models/all) | 模型 ID、输入输出、上下文、产品定位与可用 endpoint |
| API 变更 | [API Changelog](https://developers.openai.com/api/docs/changelog) | 上线、参数、弃用和迁移变化 |
| ChatGPT 产品状态 | [Model Release Notes](https://help.openai.com/en/articles/9624314-model-release-notes) | ChatGPT 侧是否上线、用户范围和回滚 |
| 价格 | [API Pricing](https://developers.openai.com/api/docs/pricing) | 以实时页面为准，记录单位、缓存/批处理/工具费和抓取时间 |
| 安全/系统卡 | 发布页中的 system card 链接、[Safety](https://openai.com/safety/) 与 sitemap | 不猜测 slug；跟随公告页或 sitemap 的官方链接 |
| 图像 | 公告页 `og:image`、正文图表、系统卡图表 | 原图优先，其次带上下文的网页截图；保存图注、来源和权利状态 |

OpenAI 开发者文档支持在页面 URL 后追加 `.md`，适合稳定提取正文；仍需保存最终 canonical URL、ETag/Last-Modified 或内容哈希，而不是把文档 URL 当成永不变化的快照。[OpenAI API docs](https://developers.openai.com/api/docs/models)

### 3.3 Google Gemini / DeepMind

| Facet | 稳定入口 | 用途 |
| --- | --- | --- |
| 公告发现 | [Google Blog RSS](https://blog.google/rss/)、[Gemini collection](https://blog.google/products-and-platforms/products/gemini/)、[DeepMind Blog](https://deepmind.google/blog/) | 产品公告、研究公告和发布图片 |
| API 变更 | [Gemini API release notes](https://ai.google.dev/gemini-api/docs/changelog) | 精确发布日期、模型 ID、GA/Preview、弃用与迁移 |
| 模型规格 | [Gemini models](https://ai.google.dev/gemini-api/docs/models) | 输入输出模态、token 限制、功能和生命周期 |
| 结构化模型目录 | [Models API](https://ai.google.dev/api/models) | `GET /v1beta/models` 程序化枚举可用模型及元数据 |
| 价格 | [Gemini API Pricing](https://ai.google.dev/gemini-api/docs/pricing) | 不同模型、上下文档位、Batch/Flex/Priority 与工具价格 |
| 模型卡 | [Google DeepMind model cards](https://deepmind.google/models/model-cards/) | 模型能力、安全、限制和评测方法 |

Gemini 的 `stable`、`preview`、`latest`/热切换别名和 `experimental` 不是同一种发布状态。档案必须保存当时的具体 snapshot/model ID；不能用今天的 `*-latest` 结果覆盖旧稿的模型身份。[Gemini models](https://ai.google.dev/gemini-api/docs/models)

### 3.4 DeepSeek

| Facet | 稳定入口 | 用途 |
| --- | --- | --- |
| 正式变更 | [DeepSeek API Change Log](https://api-docs.deepseek.com/updates/) | 发布日期、模型版本、接口变化和厂商报告跑分 |
| 漏项发现 | [DeepSeek sitemap](https://api-docs.deepseek.com/sitemap.xml)、官方 News 导航 | 发现 `/news/newsYYMMDD/` 等正式发布页；不要依赖 Google News 转述 |
| 模型与价格 | [Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing/) | 当前模型映射、上下文、最大输出、能力、峰谷价格和并发 |
| 兼容性/能力 | [API Docs](https://api-docs.deepseek.com/) | OpenAI/Anthropic 兼容、Responses、thinking、缓存等 |
| 开源权重/技术 | [deepseek-ai GitHub](https://github.com/deepseek-ai) | 只把官方组织自己的 repo、model card、README 和 release 作为一方材料 |
| 社交快讯 | [@deepseek_ai](https://x.com/deepseek_ai) | 发现入口；官方文档页脚反向链接到该账号 |

DeepSeek 价格页明确提醒价格可调整，所以每篇涉及费用的稿件都应在生成 ContentPackage 和交付前各抓一次，保存货币、峰谷时段、缓存命中/未命中和时间戳。[DeepSeek pricing](https://api-docs.deepseek.com/quick_start/pricing/)

### 3.5 Alibaba Qwen

| Facet | 稳定入口 | 用途 |
| --- | --- | --- |
| 正式公告 | [Qwen Blog](https://qwen.ai/blog) | 发布文章、厂商跑分、图表和模型定位；文章常用 `?id=<slug>`，应从索引发现，不猜 slug |
| 结构化模型目录 | [Model Studio 查询模型列表](https://help.aliyun.com/zh/model-studio/list-models) | `GET /api/v1/models`；支持 `providers=qwen`，返回 published time、context、最大输入/输出、features 和 prices |
| 模型总览 | [Model Studio models](https://help.aliyun.com/zh/model-studio/models)、[文本生成模型](https://help.aliyun.com/zh/model-studio/text-generation-model) | 在售/可用模型、区域和能力导航 |
| 价格 | [Model Studio pricing](https://help.aliyun.com/zh/model-studio/model-pricing) | 中国内地、香港、新加坡、美国、欧盟等区域不可混成一个数字；保存币种、地域、档位和促销期 |
| API 兼容 | [OpenAI-compatible Chat Completions](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions) | 通用 Provider 接入和模型参数差异 |
| 开源权重/技术 | [QwenLM GitHub](https://github.com/QwenLM) | 官方 repo、README、model card；组织页同时反向链接 `qwen.ai` 与 `@Alibaba_Qwen` |

本次核查没有发现可依赖的标准 Qwen RSS，[`qwen.ai/sitemap.xml`](https://qwen.ai/sitemap.xml) 返回的也不是可直接消费的规范 XML sitemap。因此 Qwen 的自动发现应组合：Blog index 内容哈希、Model Studio 结构化模型 API、QwenLM GitHub 新 repo/README/release feed 和 X 官方账号，而不是伪造一个 sitemap 适配器。

### 3.6 采集节奏与变更检测

| 来源类型 | 平时建议 | 活跃 Story 期间 | 检测方式 |
| --- | ---: | ---: | --- |
| RSS / X 实时信号 | 5 分钟或流式 | 实时 | GUID/Post ID + canonical URL |
| changelog / release notes | 15 分钟 | 5–10 分钟 | 条目日期 + 内容哈希 |
| sitemap / 官网索引 | 30 分钟 | 10–15 分钟 | lastmod + URL 集合 + 页面哈希 |
| 模型目录 API | 30 分钟 | 10 分钟 | model ID + 结构化字段 diff |
| 价格页 / 模型卡 | 每日 | 30–60 分钟 | 分区 DOM/Markdown 哈希；保存前后快照 |
| 官方 GitHub | 15–30 分钟 | 5–10 分钟 | repo/release/tag/README commit SHA |

频率是本地产品默认值，不是厂商 SLA。SourceDesk 应根据 ETag、Last-Modified、429、预算和失败率自动退避；每个来源独立失败，不能让某一家超时拖死整轮采集。

### 3.7 发布档案必须保留的细节

- `eventStatus`：预告、正式上线、更新、弃用；
- `modelId` 与具体 snapshot，不能只存营销名称；
- access：Chat/App/API/云平台、地域、灰度范围、账号门槛；
- spec：上下文、最大输出、模态、工具、thinking/FIM 等；
- pricing：币种、地域、输入/输出、上下文档位、缓存、批处理、促销结束时间；
- benchmark：名称、版本、分数、单位、模型 snapshot、effort、工具、harness、采样数、页面日期；
- `benchmarkProvenance`：`vendor_reported`、`platform_measured`、`public_leaderboard` 分开；
- safety/model card：发布日期、版本和适用模型；
- images：原图 URL、页面 URL、图注、作者/机构、抓取时间、裁剪说明、SHA-256、rights status；
- `unknowns`：尚未公布的价格、发布日期、API ID、榜单等，必须作为显式字段保留。

图片选择仍遵守既定顺序：发布页原图 > 发布/文档页截图 > 相关公司/人物官方素材 > 相关联的可追溯图片 > 明确标注的生成示意图。跑分截图不得裁掉评测版本、配置和脚注。

## 4. Tab 补全：可借鉴什么，不应搬什么

### 4.1 当前实现的真实位置

当前项目已经有正确的基本边界：

- [RichArticleEditor](../../src/components/RichArticleEditor.tsx) 在 Tiptap 上触发和展示建议；
- [inline completion state](../../src/inline-completion-state.ts) 管理 idle/loading/visible；
- [Tiptap decoration](../../src/tiptap-inline-completion.ts) 负责 ghost text；
- [server/inline-completion.ts](../../server/inline-completion.ts) 只允许使用冻结事实和 source material，并做数值/实体锚点检查；
- [provider runtime](../../server/provider-runtime.ts) 已支持可取消的 OpenAI-compatible SSE，DeepSeek 主机下显式关闭 thinking；解析器会忽略没有 `data:` 的 SSE frame，符合 DeepSeek 可能发送 `: keep-alive` 注释的行为。[DeepSeek rate-limit docs](https://api-docs.deepseek.com/quick_start/rate_limit/)

不成熟处不在“有没有 Tab”，而在交互稳定性、跨段落上下文、部分接受、缓存和 provider capabilities 还没有被完整建模。

### 4.2 Continue：学模式，不接运行时

[Continue](https://github.com/continuedev/continue) 是 Apache-2.0 开源代码，包含很完整的 autocomplete 思路：prefix/suffix/FIM 模板、低延迟非思考模型、多行 `auto/always/never`、缓存、可配置 debounce、超时和局部接受。其官方配置示例给出 250ms debounce、prompt token 上限、prefix/suffix 比例，并明确提示 thinking 模型通常不适合低延迟补全。[Continue autocomplete guide](https://github.com/continuedev/continue/blob/main/docs/customize/deep-dives/autocomplete.mdx) [FIM templates](https://github.com/continuedev/continue/blob/main/core/autocomplete/templating/AutocompleteTemplate.ts)

但该仓库目前已标明 read-only / no longer actively maintained。因此建议只借鉴算法和测试场景，不复制整个 IDE 架构，也不新增它作为依赖。

### 4.3 VS Code：应直接借鉴的交互契约

[VS Code 的 inline completion 接口](https://github.com/microsoft/vscode/blob/main/src/vs/editor/common/languages.ts) 有四个对本文编辑器非常重要的设计：

1. `Automatic` 与 `Explicit` 两类触发，显式触发可以返回/切换更多结果；
2. `CancellationToken` 贯穿 provider 请求；
3. `enableForwardStability`：用户沿着建议继续输入时，不重新请求，而是保留并裁掉已输入前缀；
4. partial accept 分为 Word、Line、Suggest，并有 shown / partial / rejection / end-of-lifetime 等生命周期回调。

这些能力比单纯把 debounce 从 650ms 改成 300ms 更重要，因为它们能显著减少闪烁、重复调用和“刚看到建议就消失”。Monaco 本身不适合作为富文本与移动端文章编辑器底座；应复制交互契约，不替换 Tiptap。

### 4.4 Tiptap：保留 Core，避免被 Basic AI 锁定

[Tiptap Core](https://github.com/ueberdosis/tiptap) 是 MIT、headless、基于 ProseMirror，现有自定义 Extension/Decoration 方向正确。[Tiptap Basic AI](https://tiptap.dev/docs/ai/basic/configure) 虽有 Tab、streaming callbacks 和 decorations，但它要求签名 token，默认使用 OpenAI 构建补全，AI Pro 扩展还需要订阅。因此它不适合作为本地优先、模型可切换产品的底座。

结论是：继续使用 Tiptap Core，自行维护一个很薄但明确的 `InlineCompletionController`。

## 5. DeepSeek、跨段落与模型无关 Provider

### 5.1 DeepSeek 有两条能力，不应混为一谈

1. **Chat Completions streaming**：适合当前证据约束的句子/跨段落续写；可以携带 system prompt，增量响应，并由 AbortSignal 取消。
2. **FIM Completion Beta**：允许 `prefix` + 可选 `suffix`，完成中间内容，官方明确说可用于 content/code completion；需使用 `/beta`，最大输出 4K。[DeepSeek FIM](https://api-docs.deepseek.com/guides/fim_completion/)

DeepSeek 当前价格页显示 FIM 只支持相关模型的非思考模式，且官方 FIM 示例是 `/completions` 非流式调用；不能因为 Chat API 支持流式就假定 FIM 的所有模型/路径也支持相同 streaming 行为。[DeepSeek Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing/)

推荐路由：

| 编辑场景 | 默认 transport | 原因 |
| --- | --- | --- |
| 段末补一句 | Chat SSE、thinking off | 可带事实白名单和风格约束；首 token 快 |
| 生成下一自然段 | Chat SSE、thinking off | 需要段落目的、全文结构和未覆盖事实，FIM 约束不足 |
| 光标位于句中且右侧有正文 | Provider 支持时用 FIM，否则 suffix-aware Chat | FIM 天然考虑左右文；仍需最终事实 gate |
| 用户显式要求多个候选 | Chat SSE 或并行小请求 | 显式触发与自动触发分开预算 |
| 改写选区 | 文章 Agent exact patch | 不是 Tab completion，不应借补全路径整段覆盖 |

### 5.2 Provider capability，而不是 hostname 特判堆积

当前 `api.deepseek.com` hostname 特判可以保留作为兼容，但下一步应把差异变成配置能力：

```ts
type InlineCompletionCapabilities = {
  transport: 'chat-completions-sse' | 'fim-completions'
  supportsStreaming: boolean
  supportsSuffix: boolean
  supportsSystemEvidence: boolean
  disableThinking?: { body: Record<string, unknown> }
  maxOutputTokens: number
  timeoutMs: number
  stopSequences?: string[]
}
```

Qwen 的 Model Studio 模型目录 API 已提供 `features=prefix-completion` 过滤能力，可以用来判定候选模型是否具备前缀续写，而不是根据模型名猜。[Qwen model list API](https://help.aliyun.com/zh/model-studio/list-models)

不建议现在引入大型 provider SDK。现有通用 `baseUrl + model + OpenAI-compatible` 已能覆盖 DeepSeek、Qwen 和大多数兼容服务；只需在 DraftDesk 的 provider boundary 增加 capability profile 与 transport adapter。长文成稿模型与补全模型继续分开配置。

### 5.3 跨段落补全的上下文包

不要只把光标前 1,600 字符交给模型。新的 completion context 应包含：

```ts
type CompletionContextPackage = {
  title: string
  articleRoute: 'Brief' | 'Synthesis' | 'Curate' | 'Watch' | string
  currentSectionHeading?: string
  outline: Array<{ heading: string; purpose: string }>
  previousParagraph?: string
  currentParagraphPrefix: string
  cursorSuffix?: string
  nextParagraph?: string
  supportedFactsNotYetCovered: FrozenFact[]
  nearbySourceMaterial: SourceMaterialRef[]
  forbiddenOrUnknownClaims: FrozenUnknown[]
  styleHints: string[]
}
```

生成策略：

- 当前句未闭合：最多补完这一句；
- 当前句已闭合但段落尚短：补一条解释、影响或限定，不重复上一句；
- 段落已完整：只有在“未覆盖事实 + 章节目的”支持时才建议下一段；
- 下一段最多先显示一个句子，用户接受后再请求后续，不一次塞两大段；
- 没有可用事实时返回 no-suggestion，而不是用空话填满文章。

### 5.4 请求生命周期与用户体验

建议按优先级实现：

1. **IME 安全**：中文输入法 composition 期间不请求、不接受 Tab；paste、undo/redo、格式操作、选区非折叠时也不自动触发；
2. **forward stability**：用户输入与 suggestion 前缀一致时，本地裁掉相同字符，不取消/重发；只有偏离建议才 abort；
3. **自适应 debounce**：句号/问号/换段后 350–450ms，句中停顿 650–900ms；保留 `Ctrl+Space` 显式触发；
4. **单飞与代际编号**：每个 editor 仅一个可生效请求，旧请求即便晚到也不能覆盖新 suggestion；
5. **缓存**：成功与 no-suggestion 都缓存短 TTL；按 normalized context hash 去重 in-flight；允许 prefix lineage 复用；
6. **部分接受**：Tab 接受下一句/下一段，另设快捷键接受全部；Esc 只关闭当前 suggestion；
7. **流式展示**：只展示标点闭合、通过增量安全检查的稳定前缀；最终全文通过 deterministic evidence gate 后才可插入；
8. **离线指标**：本地记录 TTFT、总延迟、取消原因、gate 拒绝理由、显示/接受/部分接受/放弃、节省字符数。LearningDesk 可学习偏好，但不得改变事实分数。

## 6. 实施优先级与验收标准

### P0：先修结构，避免越快越错

1. 建立 `XAccountRegistry`：保存数字 user ID、handle history、账号类别、启用级别、身份核验依据与复核时间；
2. 把当前 X 适配器的统一 `official` 改成 `accountClass + evidenceRole + postKind`；
3. Recent Search 加 `next_token` 分页、跨来源 Post ID 全局去重和可见补抓日志；
4. 建立 `VendorReleaseDossier` 与四厂商 source registry；
5. 推荐质量门改为 facet completeness：信息不足进入 Watch/Brief 并显示缺项，不直接消失；
6. 为 completion provider 增加 capability profile，并保留现有证据 gate。

### P1：补实时与高价值资料包

1. 新增 X Activity persistent stream adapter，仅订阅 P0 账号的 `post.create`、`post.delete` 和 handle/profile 更新；
2. 流断开后自动 Recent Search 补抓，再切回实时；
3. 接入 OpenAI RSS/changelog/models/pricing、Gemini RSS/changelog/models API/model cards、DeepSeek changelog/pricing/sitemap、Qwen Model Studio list API/blog/GitHub；
4. 同一模型预告、发布、价格、跑分和系统卡合并成一个 Story；
5. 为编辑器实现 IME guard、forward stability、部分接受和自适应 debounce；
6. DeepSeek Chat SSE 做默认补全；FIM 只在句中 suffix 场景做显式实验开关。

### P2：可选增强

1. 需要复杂降噪时再开 Filtered Stream；
2. 提供 X 月度预算、流健康、最后事件、恢复窗口和漏项原因面板；
3. 为每家厂商提供“发布档案模板”和图片候选槽位；
4. 用本地接受率和延迟数据自动选择补全模型，但绝不影响事实 gate；
5. 无 X API 时显示清晰降级状态，并引导 private List / 官方 feeds，而不是静默假装已监控。

### 验收用例

- 模拟实时流断开 20 分钟后恢复：Recent Search 能补齐全部 Post、无重复、cursor 正确推进；
- 一个账号改 handle：数字 ID 继续收到事件，UI 提醒重新核验，而不是创建“新官方账号”；
- 官方帖被删除：相关 evidence support 变为 revoked，交付前 gate 阻止继续引用；
- 高管发“很快发布”：进入 Watch，不自动写成“今天正式发布”；
- 正式模型公告只有介绍、没有价格：仍进入推荐，并显示价格/模型卡待补；
- 厂商跑分与独立榜单并存：分别显示 provenance 与配置，不能合并成一个“权威分数”；
- 中文 IME 组合输入期间 Tab 不误接受；
- 用户沿 suggestion 输入时不重发请求；偏离时旧请求被取消且晚到结果不会覆盖；
- DeepSeek SSE 插入 `: keep-alive` 帧时解析不报错；
- 无支持事实时跨段落补全返回 no-suggestion，不生成空泛总结。

## 7. 不建议做的事

- 不用网页爬虫、浏览器 Cookie 或第三方 X 镜像规避 API；
- 不把蓝标、热度或“官方风格头像”当成身份核验；
- 不把 X 趋势摘要、Grok 摘要、转帖或高管评论自动变成新闻事实；
- 不把四家厂商都压成一个通用 RSS 模板；模型目录、价格和生命周期差异必须由 vendor adapter 解释；
- 不因 dossier 缺一项就拒绝整个选题；缺项应变成 UI 上的未知项和后续监控触发器；
- 不把 FIM Beta 当成长文事实生成器；
- 不为补全引入 Monaco、整套 Continue 或 Tiptap 付费 AI 运行时；
- 不用更快的流式文字绕过最终 deterministic evidence gate；
- 不让 LearningDesk 的接受率反向提高任何事实可信度；
- 不改变项目的人工选择、人工编辑和微信公众号草稿箱后手动发布边界。

## 8. 本次调研边界

- X 价格、产品层级、速率和厂商模型信息均会变化；本文记录 2026-09-03 可见的官方页面，生产系统应在使用时重新读取并保存快照；
- 账号列表是人工审核起点，不是永恒身份声明；上线时必须解析数字 ID 并留存身份依据；
- 本文没有调用用户的 X 或模型 API Key，没有修改密钥、默认源、生产代码、用户草稿或 `.workflow/`；
- 本文没有使用媒体报道或社区帖子确认厂商事实。
