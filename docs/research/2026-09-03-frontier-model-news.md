# 前沿模型新闻核查：Claude Fable 5.1 与 OpenAI Astra

> 核查日期：2026-09-03（Asia/Hong_Kong）
> 范围：只把厂商官网、官方文档、官方社交账号，以及公开模型平台自己的排行榜页面/原始页面当作证据。媒体转述与社区爆料不用于确认事实。

## 结论先行

1. 用户口中的“Claude 飞报 5.1”，准确名称是 **Claude Fable 5.1**。Anthropic 于 **2026-09-01** 正式发布了 Claude Fable 5.1，并同时发布共享同一底层模型、但采用不同安全措施和访问边界的 Claude Mythos 5.1。因此在 2026-09-03 核查时，它是“两天前发布”，不是当日刚发布。[Anthropic 官方公告](https://www.anthropic.com/claude-fable-and-mythos-5-1)
2. Fable 5.1 已正式可用，不是预告。官方 API 模型 ID 为 `claude-fable-5-1`，上下文窗口 100 万 token，最大输出 12.8 万 token；基础价格为输入 `$10/MTok`、输出 `$50/MTok`。[官方模型文档](https://platform.claude.com/docs/en/models/fable-5-1/overview) [官方价格页](https://platform.claude.com/docs/en/about-claude/pricing)
3. Anthropic 公告页给出了大量跑分，但这些首先应标为 **厂商报告结果**，不能一概写成“公开排行榜第一”。例如 Anthropic 报告 Terminal-Bench-Science 0.1 得分 52.6%，而该基准当前公开页面尚未列出 Fable 5.1。[Anthropic 官方公告](https://www.anthropic.com/claude-fable-and-mythos-5-1) [Terminal-Bench-Science 官方页面](https://www.terminal-bench-science.ai/)
4. “OpenAI 新模型将要发布”对应的准确模型名是 **Astra**。OpenAI 已正式确认“将很快提供 Astra”，官方 X 也称“正在准备发布 Astra”。因此这不是普通传闻，但截至本次核查，Astra **尚未正式发布**，发布日期、API 模型 ID、价格、上下文长度与完整跑分均未公布。[OpenAI 官方公告](https://openai.com/index/path-to-astra/) [OpenAI 官方 X](https://x.com/openai/status/2094885578173260259)
5. 当前新闻台漏掉 Fable 5.1 的首要原因不是“新闻价值打分不够”，而是 Anthropic 默认源仍依赖 `site:anthropic.com/news` 的 Google News 补充搜索，且被标为 `discoveryOnly`；Fable 5.1 的正式公告位于官网根路径，不在 `/news/`。OpenAI Astra 则已进入 OpenAI 官方 RSS，如果仍未推荐，应逐段检查采集选择、时间窗、候选过滤、Story 聚合、排序和首页名额，而不是先放宽品控。

## 1. “飞报 5.1”到底是什么

### 1.1 准确名称与发布状态

准确产品名为 **Claude Fable 5.1**。Anthropic 的 2026-09-01 官方公告标题为 “Claude Fable 5.1 and Claude Mythos 5.1”，并明确区分：

- **Claude Fable 5.1**：面向一般用途，已广泛提供；
- **Claude Mythos 5.1**：与 Fable 5.1 共享底层模型，但针对网络安全、生命科学等高风险领域采用不同安全措施，仅向受信任用户有限开放。

这两个名称不能混写为一个模型，也不应把 Mythos 的能力或访问条件直接套到普通 Fable 用户身上。[Anthropic 官方公告](https://www.anthropic.com/claude-fable-and-mythos-5-1)

### 1.2 官方定位与能力

Anthropic 将 Fable 5.1 定位为面向自主研究、编码、专业工作与长时程 Agent 任务的高能力模型。其官方规格如下：[官方模型文档](https://platform.claude.com/docs/en/models/fable-5-1/overview) [Fable 产品页](https://www.anthropic.com/claude/fable)

| 项目 | 官方信息 |
| --- | --- |
| API 模型 ID | `claude-fable-5-1` |
| 输入 / 输出 | 文本、图片输入；文本输出 |
| 上下文窗口 | 1,000,000 tokens |
| 最大输出 | 128,000 tokens |
| 推理方式 | Adaptive thinking 始终启用；默认 effort 为 high |
| 相对延迟 | 官方模型表标为 Slower |
| 可靠知识截止 | 2026-06 |
| 训练数据截止 | 2026-06 |
| 官方接入 | Claude API、Amazon Bedrock、Google Cloud、Microsoft Foundry，以及 AWS 上的 Claude Platform |

付费 Claude 套餐也可访问 Fable 系列，但使用额度和限制取决于具体方案，不能把 API 的按 token 价格直接等同为 Claude App 订阅额度。[Anthropic 帮助中心](https://support.claude.com/en/articles/15424964-claude-fable-models-on-your-plan)

### 1.3 价格、缓存与批处理

以下价格来自 Anthropic 官方价格页，单位均为每百万 token：[Anthropic 官方价格页](https://platform.claude.com/docs/en/about-claude/pricing)

| 计费项 | 价格 |
| --- | ---: |
| 输入 | $10 / MTok |
| 输出 | $50 / MTok |
| 5 分钟缓存写入 | $12.50 / MTok |
| 1 小时缓存写入 | $20 / MTok |
| 缓存读取 | $0.25 / MTok |

- Batch API 的输入、输出价格可享 50% 折扣；
- 美国境内推理在产品页标为 1.1 倍价格；
- Fable 5.1 与 Fable 5 的基础输入、输出价格相同，但缓存读取价格下降 75%；
- Anthropic 估计，典型工作负载总成本可降低约 25%，高 Agent 化工作负载最高可降低约 45%。这些比例是厂商估算，应连同来源与适用条件一起呈现，不能当作所有用户的保证。[Fable 产品页](https://www.anthropic.com/claude/fable)

数据治理也属于发布包必填项：官方文档称，除非 Anthropic 明确授权其他安排，Fable 5.1 等所覆盖模型通常要求 30 天数据保留。新闻台在写“企业可用”时应保留这一限制，而不是只展示价格和跑分。[API 与数据保留文档](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention)

### 1.4 API 兼容性变化

Fable 5.1 不是简单替换旧模型 ID。官方发布说明列出了需要开发者确认的兼容性变化：[Anthropic API 发布说明](https://platform.claude.com/docs/en/release-notes/overview)

- `tool_choice` 的 `any` 和 `tool` 选项不受支持，会返回 400；
- 较早模型不能读取 Fable 5.1 生成的 thinking blocks；
- 修改较早轮次内容会使相应 thinking blocks 失效；
- 新增或扩展了逐消息 effort、turn-scoped system messages、进度更新等能力；
- 缓存读取价格变化应独立记录，不能只复制基础输入/输出价格。

## 2. 跑分、排行榜与可用图片

### 2.1 Anthropic 官方发布成绩

Anthropic 公告页“a new performance frontier”部分给出了可直接核对、可页面截图的图表与表格。下表只摘录核心结果；展示时必须标记为 **Anthropic vendor-reported**，并保存具体测试版本和配置。[Anthropic 官方公告](https://www.anthropic.com/claude-fable-and-mythos-5-1)

| 基准 | Fable 5.1 | 同页重要对照 | 证据属性 |
| --- | ---: | --- | --- |
| Terminal-Bench-Science 0.1 | 52.6% | Fable 5：24.7%；Opus 5：29.0%；GPT-5.6 Sol：22.4% | 厂商报告 |
| Terminal-Bench 4.0 | 55.8% | Mythos 5.1：60.9%；Fable 5：42.0%；Opus 5：52.3%；GPT-5.6 Sol：37.3% | 厂商报告 |
| GDPval-AA v2 | 1853 | Fable 5：1723；Opus 5：1824；GPT-5.6 Sol：1711 | 厂商报告 |
| OSWorld 2.0 | partial 77.9；strict 41.7 | 需与公告中对应配置一起展示 | 厂商报告 |
| Humanity's Last Exam | 无工具 60.9；有工具 65.0 | 需保留工具条件 | 厂商报告 |
| AutomationBench | 31.4 | 需保留版本与执行设置 | 厂商报告 |
| CursorBench 3.2 | 73.4 | 需保留版本与执行设置 | 厂商报告 |

方法学注意事项：

- Anthropic 说明 Fable 5.1 的生产安全措施在评测中启用；部分网络安全题目会被路由至 Opus 或记零，这会影响横向可比性；
- Terminal-Bench-Science 当前公开页面仍未列出 Fable 5.1。其页面可作为“公开榜尚未更新”的反证截图，不能拿来证明 Fable 5.1 的 52.6%；
- “厂商公告里的跑分”“第三方平台测量”“公开排行榜结果”必须是三个不同 provenance 值，不能都显示成“权威跑分”。[Terminal-Bench-Science 官方页面](https://www.terminal-bench-science.ai/)

### 2.2 公开模型平台的当前页面

**Artificial Analysis** 已有明确的 Fable 5.1 模型页。在 “Adaptive Reasoning, Max Effort, Default Fallback” 配置下，页面当前显示 Intelligence Index 66、榜单第 1/192、输出速度约 66.4 tokens/s、每个 index task 成本约 $3.69，并列出 `$10/$50` 与 1M 上下文。因为该配置包含 Default Fallback，这个分数不能被简化成“不带条件的模型纯能力”。[Artificial Analysis 模型页](https://artificialanalysis.ai/models/claude-fable-5-1) [发布聚合页](https://artificialanalysis.ai/models/releases/claude-fable-5-1)

**Arena** 的实时总览在核查时显示 `claude-fable-51`：Text overall 1507±5、WebDev 1628±8。由于 Arena 的独立、带日期文本榜页仍可能显示旧别名 `claude-fable-5`，使用实时页面截图时必须保存抓取时间、页面原始模型标签和榜单类别，不可自行把别名归并后宣称固定名次。[Arena 实时排行榜](https://arena.ai/leaderboard)

### 2.3 适合文章包的图片优先级

这条新闻不需要先生成 AI 封面。按项目既定图片原则，建议候选顺序为：

1. Anthropic 官方公告页的首图或发布页截图；
2. 公告页跑分图表/表格的网页截图，保留标题、测试版本和模型配置；
3. Artificial Analysis 或 Arena 对应模型页截图，明确标注为平台数据；
4. 官方科研示例图片，用于解释模型完成的具体工作；
5. 只有以上都不可用且确实需要视觉补位时，再考虑生成图，并明确标为示意图。

可采集的官方图片与页面：

- 官方公告 Open Graph 图：[官方 1200×630 图片](https://cdn.sanity.io/images/4zrzovbb/website/932ca7d6f414ca22fd5a26dcc131410575b9b3e5-1200x630.jpg)
- 公告中的麦哲伦号雷达结果：[官方图片](https://www-cdn.anthropic.com/images/4zrzovbb/website/4d8f06a743ecfc6ec87ccde0b1964e48175a141e-800x800.png)
- 公告中的高度计结果：[官方图片](https://www-cdn.anthropic.com/images/4zrzovbb/website/e374c070fc1a84872dcb1343b5bb0ed540ca3770-800x800.png)
- 公告中的新 DEM 结果：[官方图片](https://www-cdn.anthropic.com/images/4zrzovbb/website/3dd626b47b88feb72082646cdea87944d49a3c7f-800x800.png)
- Fable 5.1 / Mythos 5.1 系统卡：[官方 PDF](https://www-cdn.anthropic.com/0339e6a7c5c7b87f5c07798616dc32c215d14235/Claude%20Fable%205.1%20%26%20Claude%20Mythos%205.1%20System%20Card.pdf)

所有图片和网页截图都应先记为 `rights=check-required`。公开可见不等于允许任意转载；发布前仍需核查授权、合理使用边界与平台要求。至少保存 `sourceUrl`、原始说明、作者/机构、抓取时间、裁剪说明和文件 SHA-256。跑分截图不得裁掉评测版本、模型配置或方法学脚注。

## 3. OpenAI“新模型将要发布”核查

### 3.1 已被官方确认的事实

对应模型是 **Astra**。OpenAI 于 2026-09-01 发布《Path to Astra: critical capabilities and frontier safeguards》，明确写明将“很快”提供 Astra，并称系统卡会在发布时公开；高级网络安全能力会先向小规模测试者开放，随后进入 Daybreak Blue。[OpenAI 官方公告](https://openai.com/index/path-to-astra/)

OpenAI 官方 RSS 同日发布了该文章条目，标题、发布时间和 canonical URL 均可直接用于可靠采集；因此新闻台无需依赖媒体转载或传闻即可抓到这条信号。[OpenAI 官方 RSS](https://openai.com/news/rss.xml)

2026-09-02，OpenAI 官方 X 发文称“正在准备发布 Astra”；Sam Altman 的官方账号称“很快发布我们的下一个模型”。二者都是强补充信号，但公司账号与高管个人账号在来源角色上仍应分开。[OpenAI 官方 X](https://x.com/openai/status/2094885578173260259) [Sam Altman 官方 X](https://x.com/sama/status/2094934592062959832)

更早的两篇 OpenAI 官方安全文章已把 Astra 称为 upcoming model，并说明因能力与安全评测而调整开发节奏。它们应归入同一个 Astra Story 的历史，不应每天生成一个重复选题。[2026-08-07 官方文章](https://openai.com/index/responding-next-frontier-critical-cyber-capabilities/) [2026-08-18 官方文章](https://openai.com/index/pacing-model-development-cyber-capabilities/)

### 3.2 官方确认、官方暗示、未经证实传闻

| 层级 | 当前可写内容 | 不能延伸成什么 |
| --- | --- | --- |
| 官方确认 | 模型名是 Astra；OpenAI 计划很快提供；发布时会公开 system card；部分高级网络安全能力分阶段开放 | 不能写成已经上线、今天必发或所有用户同时可用 |
| 官方强信号 | OpenAI 官方 X 称正在准备发布；Sam Altman 称下一个模型很快发布 | 不能推导准确日期、产品渠道、模型 ID 或价格 |
| 尚无官方证据 | “9 月 3 日/本周四发布”“Astra 就是 GPT-6”“ChatGPT、Codex、API 同时上线”“已有确定价格、上下文和完整榜单” | 应列入 `unknowns`，不能进入冻结事实 |

截至 2026-09-03，OpenAI 官方模型目录、API changelog 与 Model Release Notes 均未出现 Astra 条目，所以它仍应标为 `official_preview`，而不是 `launched`。[官方模型目录](https://developers.openai.com/api/docs/models) [API changelog](https://developers.openai.com/api/docs/changelog) [Model Release Notes](https://help.openai.com/en/articles/9624314)

OpenAI DevDay 2026 官方页面显示活动在 2026-09-29 举行，但页面没有说 Astra 会在 DevDay 发布，不能据此推断发布日期。[DevDay 2026 官方页面](https://openai.com/index/devday-2026/)

### 3.3 Astra 当前应如何出稿

最适合的路由是 **Watch** 或带清晰未决项的 **Brief**：

- 可写：OpenAI 已确认 Astra 正在准备发布、为什么安全能力需要分阶段开放、官方此前有哪些连续信号；
- 不可补写：价格、API 模型 ID、上下文、准确上线时间、未经公布的跑分；
- 后续触发：模型目录出现 Astra、API changelog 更新、system card 上线、正式产品博客发布；
- 触发后应向原 Astra Story 合并新证据并升级状态，而不是创建一条重复新闻。

## 4. 新闻台为什么会漏掉这两条高价值信号

### 4.1 Claude Fable 5.1：源覆盖存在结构性盲区

仓库当前默认配置中，Anthropic 官方源被设置成 Google News 查询 `site:anthropic.com/news Anthropic`，同时带有 `discoveryOnly: true`。但 Fable 5.1 官方公告 URL 是官网根路径 `/claude-fable-and-mythos-5-1`，不是 `/news/...`。因此即使采集任务正常运行，这条正式公告也可能完全不进入候选集。[本地默认源配置](../../server/defaults.ts)

Anthropic 当前没有可直接替代的标准新闻 RSS，但官网 sitemap 可以发现 Fable 5.1 公告，且包含变更时间。因此 SourceDesk 应新增 **官网索引 + sitemap 增量监测**，而不是继续把 Google News 的 `/news` 限定搜索当成官方源。

另一个限制是 Story evidence 补充逻辑会过滤 `discoveryOnly` 来源。当前 Anthropic 配置虽然 `role` 是 official，却因 `discoveryOnly` 无法成为冻结证据；这会导致后续自动补齐官方介绍、价格、文档和系统卡时先天缺一块。[本地 Story evidence 逻辑](../../server/story-evidence-desk.ts)

### 4.2 OpenAI Astra：源已存在，需查下游漏斗

OpenAI 官方 RSS 已在默认源中，且 2026-09-01 的 RSS 条目明确包含 Astra。按照当前价值评分维度，这条新闻同时具备官方证据、模型发布/安全影响、新颖性和 AI 相关性，理论上应获得高分。[本地默认源配置](../../server/defaults.ts) [本地评分逻辑](../../server/scoring.ts)

如果首页仍看不到，应在每次采集运行中显示一条可追溯漏斗：

`官方 RSS 原始条目 → 候选接受/拒绝理由 → Story 合并目标 → 推荐分与解释 → 首页名额/过期理由`

不要先把“没有推荐”归因于品控门槛。可能的具体问题包括：

- OpenAI 源没有被本次运行选中；
- 48 小时时间窗在 9 月 3 日把 9 月 1 日条目排除；
- 候选过滤或去重错误；
- Astra 被错误合并到别的 OpenAI Story；
- 推荐卡名额太少：当前候选首页默认约 1 条主推荐 + 4 条次推荐，而产品成熟方案目标为 3 + 5；
- 官方 X 源默认关闭，使 9 月 2 日的新信号不能刷新 Story 的活跃度。

时间字段也不应只剩一个时间戳。至少区分 `firstPublishedAt`、`officialLaunchAt`、`lastSignalAt`：官方 X 的新补充可以提高 Story 的活跃度，但不应把 9 月 1 日的首次公告改写成 9 月 2 日发生。

## 5. 推荐来源清单

### 5.1 SourceDesk：Anthropic

| 优先级 | 来源 | 作用 |
| --- | --- | --- |
| P0 | [Anthropic News](https://www.anthropic.com/news) | 官方新闻索引解析与链接发现 |
| P0 | [Anthropic sitemap](https://www.anthropic.com/sitemap.xml) | 捕获根路径产品公告和 lastmod 变化 |
| P0 | [Fable 5.1 正式公告](https://www.anthropic.com/claude-fable-and-mythos-5-1) | 发布事实、官方定位、厂商跑分 |
| P0 | [Platform release notes](https://platform.claude.com/docs/en/release-notes/overview) | API 变化与兼容性事实 |
| P0 | [模型文档](https://platform.claude.com/docs/en/models/fable-5-1/overview) | 模型 ID、上下文、输出、知识截止等规格 |
| P0 | [价格页](https://platform.claude.com/docs/en/about-claude/pricing) | 输入、输出、缓存、批处理价格 |
| P0 | [System Cards](https://www.anthropic.com/system-cards) | 安全评测和模型卡更新 |
| P1 | `@AnthropicAI`、`@claudeai` | 快速发现预告、发布和后续补充；需配置 X API |
| P1 | [Artificial Analysis](https://artificialanalysis.ai/models/claude-fable-5-1) | 第三方平台测量，不用于确认官方产品事实 |
| P1 | [Arena](https://arena.ai/leaderboard) | 实时偏好榜；保存快照时间和原始模型标签 |

### 5.2 SourceDesk：OpenAI

| 优先级 | 来源 | 作用 |
| --- | --- | --- |
| P0 | [OpenAI RSS](https://openai.com/news/rss.xml) | 正式公告和预告的稳定增量入口 |
| P0 | [OpenAI News](https://openai.com/news/) | 官网索引回查，发现 RSS 漏项或页面更新 |
| P0 | [官方模型目录](https://developers.openai.com/api/docs/models) | 判断模型是否真正进入 API 产品面 |
| P0 | [API changelog](https://developers.openai.com/api/docs/changelog) | API ID、参数和上线时间 |
| P0 | [Model Release Notes](https://help.openai.com/en/articles/9624314) | ChatGPT 产品上线与范围 |
| P0 | Astra system card（正式上线后发现） | 冻结安全和评测事实 |
| P1 | `@OpenAI` | 公司官方快速信号 |
| P1 | `@sama` | 官方高管信号，`sourceRole` 不得伪装成公司公告 |

X 适配器不应替代官网，也不应把转发、截图或评论自动当成事实。它最有价值的用途是发现“官网文章已发”“正在准备发布”“模型目录刚更新”等高时效信号，然后回到 canonical 官方页面冻结事实。

## 6. 建议的数据字段

### 6.1 SourceDesk Signal

```ts
type FrontierSignal = {
  sourceId: string
  sourceType:
    | 'official_rss'
    | 'official_index'
    | 'official_sitemap'
    | 'official_release_notes'
    | 'official_model_docs'
    | 'official_pricing'
    | 'official_system_card'
    | 'official_social'
    | 'benchmark_platform'
  sourceRole:
    | 'official'
    | 'official_executive'
    | 'benchmark'
    | 'verification'
    | 'discovery'
  canonicalUrl: string
  publisher: string
  authorOrHandle?: string
  publishedAt?: string
  updatedAt?: string
  fetchedAt: string
  firstSeenAt: string
  contentHash: string
  etag?: string
  lastModified?: string
  changeKind?: 'new' | 'updated' | 'removed'
  eventAction:
    | 'previewed'
    | 'announced'
    | 'launched'
    | 'priced'
    | 'benchmarked'
    | 'updated'
  assertionStatus:
    | 'official_confirmed'
    | 'official_hint'
    | 'third_party_measured'
    | 'unverified'
  modelId?: string
  entities: string[]
  evidenceExcerpt?: string
  rawSnapshotRef: string
  imageCandidates: GovernedImageCandidate[]
}
```

这些字段的关键不是类型名称，而是把“来源身份”“事件动作”和“声明强度”拆开。否则一句“next model soon”很容易在下游被错误改写成“模型已经发布”。

### 6.2 StoryDesk

模型发布 Story 至少需要：

- `storyType: 'model_release'`；
- `eventStatus: 'preview' | 'launched' | 'updated'`；
- `canonicalEntities`、`modelFamily`、`version`、API `modelId`；
- `firstPublishedAt`、`officialLaunchAt`、`lastSignalAt`；
- 官方介绍、规格、价格/API、访问范围、安全、跑分、未知项等 claim groups；
- source matrix：来源角色、独立性、给 Story 新增了什么；
- `benchmarkProvenance: 'vendor_reported' | 'platform_measured' | 'public_leaderboard'`；
- `benchmarkConfig`：评测版本、effort、agent harness、fallback、工具、试验次数、页面日期；
- 高价值模型新闻完整度：官方介绍、模型能力、价格/API、跑分/方法、图像证据各自状态；
- 首页决定：最终得分、排序解释、进入/未进入的名额和过期原因。

### 6.3 PackageDesk

正式生成前冻结：

- 每条事实的 `claimId`、`sourceId`、原文快照与抓取时间；
- 官方概览；模型规格与能力；可用渠道/API；价格、缓存与批处理；跑分与方法；安全和数据保留；
- 基准事实必须包含测试版本、分数、单位、模型配置、日期和 provenance；
- 图片包至少区分 hero、官方跑分页截图、独立榜单截图、官方产品/科研图片；
- 每张图保存来源、图注、作者/机构、抓取时间、裁剪说明、SHA-256、`rightsStatus`；
- `unknowns`：例如 Astra 的发布日期、价格、API ID、上下文和广泛跑分；未知值不得由模型补齐；
- 支持发布前的 Watch package，待正式上线证据出现后合并到同一 Story，再生成完整包。

## 7. 建议的下一步顺序

1. **先修 Anthropic 官方发现链路**：官网索引 + sitemap 增量监测，canonical 页面才能进入事实链；
2. **为采集漏斗增加可见解释**：原始条目、过滤原因、Story merge、分数、首页名额与过期原因；
3. **把 X 官方账号作为高时效补充打开**，但仍用官网/文档冻结产品事实；
4. **建立模型发布完整度检查表**，缺价格或跑分时显示“待补”，不要直接过滤整个选题；
5. **区分预告与发布**：Astra 当前应作为 Watch/Brief 存在，不能因信息不全而消失，也不能被强行写成完整评测稿；
6. **扩充首页容量并按 Story 聚合**：避免高价值信号因 1+4 名额被隐藏，同时防止同一 Astra 历史信号重复占位；
7. **图片优先使用可追溯的一手页面和图表**，生成图只作为最后兜底，且不能替代事实图像。

## 8. 本次核查边界

- 未使用媒体文章或社区帖子确认产品事实；
- X 信号只用于发布状态和时效补充，事实仍以厂商官网、模型目录、API 文档和系统卡为准；
- 排行榜数字会变化，本文记录的是 2026-09-03 核查时页面状态，生产系统必须保存抓取时间和快照；
- 本次只完成研究与方案，不修改应用代码、用户数据或运行配置。
