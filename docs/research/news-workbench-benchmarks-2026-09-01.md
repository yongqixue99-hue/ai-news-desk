# 新闻工作台、正文提取与编辑质量门调研

**调研日期：** 2026-09-01

**范围：** 新闻采集与检索、正文提取、事件聚合、多来源观点、来源约束总结、编辑发布、质量门。
**方法：** 仅使用产品官方文档、官方 GitHub 仓库、官方数据/API 文档。本文关注可以落到本项目的能力边界，不用 GitHub 星数代替产品判断，也不建议把现有本地单用户工作台整体换成外部平台。

## 结论先行

本项目不缺一个新的“大而全新闻系统”，最需要的是把现有链路中的三个断点补成熟：

1. **草稿质量门要分层，而不是整单成败。** 事实越界、来源错位、版权或发布资格问题继续硬阻断；篇幅短、解释不足、图片少属于可修复缺口，应保存为“待完善草稿”，并允许一次有目标的补写。
2. **从“单次正文提取”升级为“可解释的提取组合”。** 保存原始 HTML / DOM 快照和提取器结果；主提取失败、正文过短或结构异常时再走后备提取，不要让生成模型替抓取器猜正文。
3. **把 Story 做成来源矩阵。** 同一事件不是只展示一篇主来源，而是显示首次出现、官方来源、独立核验、增量事实、标题差异和时间线；观点总结必须回到具体来源和具体主张。

当前代码恰好把第一个问题暴露得很清楚：[`editorial-quality-desk.ts`](../../server/editorial-quality-desk.ts) 将“素材包有至少 5 条支持事实，但 Brief 正文少于 500 字”记为 `brief-underdeveloped` blocker；[`draft-desk.ts`](../../server/draft-desk.ts) 随后抛错，模型已经生成的内容不会成为当前草稿。这个规则能发现问题，却把**编辑完整度**误当成了**事实安全性**。

不过，2026-09-01 对用户刚刚失败的两次任务做 SQLite、素材包和模型输出复现后，发现它们并不是由 `brief-underdeveloped` 触发，而是两个更基础的**跨阶段不变量失配**：一个违规事实包和一个重复图片包都被错误标成了 `ready`，草稿阶段再用正确但无法满足的规则拦截。两篇文章连续“生成后被拒绝”，既有质量门严重度和恢复路径的问题，也有 PackageDesk 预检失效的问题。

## 两次真实失败的现场复现

### 失败一：社区发现措辞已经进入事实包，模型无论怎么重写都过不了门

- Apple / Mac mini 选题的 ContentPackage 含有“被转到 Hacker News 的报道称……”这一条 supported fact，包状态却是 `ready`。
- [`editorial-source-policy.ts`](../../server/editorial-source-policy.ts) 的过滤条件要求同时出现社区平台名和“线索/发现/指向/讨论/关注”；“被转到”没有命中动作词，因此漏进事实账本。
- 实际模型输出是 4 段、323 个非空白字符，标题、导语和逐段来源都已经直接写 MacRumors，没有把 Hacker News 当新闻主题。
- 但 [`generator.ts`](../../server/generator.ts) 在存在 ContentPackage facts 时直接用包内 facts 构造 `draft.factClaims`，所以质量门仍然看见那条违规事实并硬拦。三次重试使用同一个不可变事实包，理论上不可能成功。

这里的“社区发现过程不能成为事件事实”仍应是 **error**；不能把它降成 warning。正确修复位置是 PackageDesk：在标记 `ready` 前使用与 DraftDesk 相同的来源角色规则验证事实账本，并把“转到/转发/转载/提交到”等措辞纳入统一判定。

### 失败二：同一张截图被素材包算成两张，生成器去重后反被要求插满两张

- OpenAI / ChatGPT Ads 选题的 ContentPackage 有两个不同截图 ID，但两者 SHA-256 都是 `5ae558cb...d882`，实际像素完全相同。
- [`editorial-image-policy.ts`](../../server/editorial-image-policy.ts) 的 `uniqueEligibleEditorialImages()` 只按规范化 URL 和较长图注语义去重，没有使用已经存在的 SHA-256；“来源网页首屏截图”图注又短于语义去重门槛，因此素材包仍计为 2 张。
- [`generator.ts`](../../server/generator.ts) 下载/复制后会按指纹去重，只保留 1 张；质量门却仍依据素材包的错误计数要求至少插 2 张，于是三次生成全部在 94% 失败。

这也不是“图片少就应放行”的问题。正确做法是让发现、冻结、插入和质量门共用同一个图片身份函数，优先按有效 SHA-256 去重；只有确有两张不同且相关的图片时，少插图才作为完整度 warning 或发布前检查。

### 同时暴露出的第三个问题：确定性失败被当成临时故障重试

两个任务都各重试 3 次，错误没有发生性质变化。JobDesk 当前对模型网络错误、租约中断和确定性质量错误使用同一退避重试路径。应给错误增加 `transient / repairable / deterministic` 分类：网络或进程中断可重试；可修复内容最多定向修一次；相同包不变量失败应立即停止并回到素材包修复。

现场还发现 Apple 素材包误入了一张与 Apple 无关的 Faerabella 乐队 Wikimedia 图片，并被标为三级“身份图”。这说明在线图片搜索/实体匹配还需要主体实体一致性检查，不能只靠弱关键词把许可正确但语义无关的图片升级为公司或人物素材。

## 十二个可借鉴对象

| 对象 | 成熟能力与一手证据 | 对本项目最值得借鉴的部分 | 复用与风险判断 |
| --- | --- | --- | --- |
| [NewsBlur](https://github.com/samuelclay/NewsBlur) | RSS 实时读取、全文搜索、Saved Search、全文补齐、文章修订追踪、按作者/标签/标题训练喜欢与不喜欢；仓库为 [MIT](https://github.com/samuelclay/NewsBlur/blob/main/LICENSE.md)。 | 让用户的显式“喜欢/不喜欢”变成可查看的规则；保存搜索成为持续更新的入口；同一文章保留变化历史。 | **借鉴交互，不整体集成。** 自托管依赖 Django、PostgreSQL、MongoDB、Redis、Elasticsearch、Celery 和 Node 服务，对本地 SQLite 单用户产品过重。其训练规则不能改写事实分。 |
| [Miniflux](https://github.com/miniflux/v2) | 轻量 RSS 阅读器，支持 ETag/Last-Modified、后台调度、全文搜索和 API；[Filter / Rewrite / Scraper Rules](https://miniflux.app/docs/rules.html) 把保留、屏蔽、URL 改写、正文抓取分别建模；Apache-2.0。 | 为每个来源保存“抓取策略”：正文 CSS、URL 改写、动态图片修复、失败回退；全局规则与来源规则按明确顺序执行。 | **规则设计可直接借鉴，服务不必引入。** Miniflux 需要 Go/PostgreSQL，替换 SourceDesk 会增加运维；适合把规则模型移植到现有 SourceDesk。 |
| [Feedly AI](https://docs.feedly.com/) | AI Feeds、Mute Filters、摘要、去重和来源组合是完整的信息降噪链。其[内容去重](https://docs.feedly.com/article/218-how-does-deduplication-work)按正文重合度工作，并明确只跨来源去重、保留一个代表版本和 31 天窗口。 | 区分“同 URL”“近重复文章”“同一事件但有信息增量”；筛选规则可暂停、可查看、可恢复，而不是删掉数据。 | **仅借鉴算法边界和 UI。** 闭源 SaaS，不能直接复用代码；其 85% 重合阈值只适合近重复，不应拿来判断两个报道是否属于同一 Story。 |
| [Inoreader](https://www.inoreader.com/pricing/feature/duplicate_filters) | Rules、内容过滤、重复过滤、标签和文章总结组成自动分拣链；官方说明[内容过滤与重复过滤用途不同](https://www.inoreader.com/blog/2026/04/new-combined-filter-quotas.html)。 | 在新闻源页提供“命中规则预览”和“过去 7 天如果启用将隐藏多少条”；把重复过滤与主题过滤分开解释。 | **仅借鉴交互。** 商业功能有套餐限制；不要依赖远端账户作为本地产品的数据真源。 |
| [Mozilla Readability](https://github.com/mozilla/readability/blob/main/README.md) | Firefox Reader View 使用的独立提取器；返回 title、HTML、纯文本、byline、站点名、语言、发布时间等；Apache-2.0，并明确输出仍需 DOMPurify/CSP 防护。 | Node 侧作为第一层通用正文抽取；保留 `isProbablyReaderable`、正文长度、标题/作者/时间元数据和提取诊断。 | **可直接复用。** 但它是启发式提取器，会有误判；不能只有一个布尔成功值，更不能把未清洗 HTML直接放进编辑器。 |
| [Trafilatura](https://github.com/adbar/trafilatura) | Apache-2.0、生产稳定的 Python/CLI 提取器；支持正文、元数据、评论、链接、图片、表格及 JSON/Markdown/XML，并提供 precision / recall / fallback 选项，详见[官方 Python 用法](https://github.com/adbar/trafilatura/blob/master/docs/usage-python.rst)。 | 把“高精度”和“高召回”作为两次独立候选提取；比较段落数、文本长度、导航噪声、图片数后选结果，并保留未选版本供核对。 | **适合做评测 oracle 或可选后备，不建议马上变成必装依赖。** Python sidecar 会扩大 Windows 安装、升级和故障面；先用真实站点 fixtures 验证增益。 |
| [GDELT](https://www.gdelt.org/) | 面向全球新闻的事件库与知识图谱；[DOC 2.0 API](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/)提供文章列表、报道量、语调、语言和来源国家时间线。 | 对“这条新闻是不是只被一个来源提到”“报道是否正在升温”“不同国家来源是否出现”做外部召回和趋势旁证。 | **仅作发现和覆盖检查。** 规模大、噪声高，语调/自动实体不是事实证据；结果必须回到原网页核验，不能进入 ContentPackage 的 supported facts。 |
| [Media Cloud](https://www.mediacloud.org/documentation) | 面向媒体研究的新闻档案与来源目录；官方 [API client](https://github.com/mediacloud/api-client)可按查询、日期和来源集合列故事、词频、来源和语言，客户端 Apache-2.0。 | 为专题搜索提供“来源集合 + 时间范围 + 词频/报道量”；适合离线评估本项目是否漏掉重要来源。 | **暂作研究工具，不进入核心实时链。** 需要 API Key且有调用限制；其档案覆盖与当前 AI 科技源不一定一致。 |
| [Ground News](https://ground.news/about) | 把多个来源对同一事件的文章合并，并在一个页面比较来源；[评级方法](https://ground.news/rating-system)明确偏向和 factuality 多为**媒体级**指标，不是单篇事实判定。 | Story 页做“完整报道矩阵”：来源角色、发布时间、标题措辞、遗漏/新增事实、所有权或来源背景；让用户自己看差异。 | **借鉴信息架构，不复制偏见分。** 它的政治偏向体系主要按美国语境且是出版物级；本项目应比较具体 claim，不给 AI 科技新闻硬贴政治标签。 |
| [NotebookLM](https://support.google.com/notebooklm/answer/16164461?hl=en) | 只基于选定来源回答，提供行内引用；支持选择特定来源、来源摘要和针对主题提问，详见[来源管理说明](https://support.google.com/notebooklm/answer/16215270?hl=en-GB)。 | 在 Story 阅读器中加入“只问这些来源”，回答按 claim 贴回证据；“总结全部”之外提供“哪些来源支持/反对”“各自新增了什么”“还有什么未知”。 | **借鉴来源约束交互，不上传本地草稿。** 闭源云产品；官方也提醒模型会不准确。项目仍应在本地 PackageDesk 冻结证据并做确定性检查。 |
| [Tiptap](https://github.com/ueberdosis/tiptap) | 项目已经使用其 MIT 开源核心；官方 [Tracked Changes](https://tiptap.dev/docs/tracked-changes/getting-started/overview)将新增、删除、替换和格式变化保存为可接受/拒绝的建议，AI 改动也不静默覆盖。 | 把“补充背景”“缩短导语”“修正表述”作为精确范围 suggestion；用户逐项接受，保持当前草稿、事实锚点和版本可恢复。 | **核心可直接继续用，付费扩展只参考。** Tracked Changes/部分 AI 能力是付费项；本项目已有精确 patch 契约，宜在现有 Tiptap schema 上实现最小 suggestion 层。 |
| [Sanity Studio validation](https://www.sanity.io/docs/studio/validation) | 验证规则区分 error 和 warning：error 阻止发布，warning 不阻止；[Block 文档](https://www.sanity.io/docs/studio/block-type)还定义 info，纯提示且不阻止。 | 质量门采用 `error / warning / info`，并将“能否保存草稿”和“能否同步/发布”分开；每条问题指向具体段落和下一动作。 | **直接借鉴语义，不引入 Sanity。** 本项目无需 CMS 云服务；关键是复制严重度模型和发布边界。 |

## 对质量门本身的进一步判断

### 为什么现在会让人觉得品控有问题

除了上面两个 PackageDesk 不变量错误外，现有 `brief-underdeveloped` 的出发点是对的：当素材包已有 5 条以上正文级事实，三段摘要通常没有把信息价值发挥出来。但目前的实现有四个问题：

1. **500 字是代理指标，不是事实安全指标。** 480 字可能已覆盖全部事实，800 字也可能只是重复和套话。
2. **没有按稿型和事实密度自适应。** 单一事件 Brief、政策解释、Synthesis、Curate 不该共用同一种完整度判断。
3. **已经生成的候选没有成为可见资产。** 抛错后用户只能看到“失败”，无法判断是差 30 字、少解释一个规则，还是正文真的不可用。
4. **缺少有目标的修复回路。** 系统知道“需要讲清事件、规则、影响与限制”，却没有把缺失维度交给模型做一次局部补写。

因此，不建议简单删除 `brief-underdeveloped`，也不建议把阈值从 500 改成 300。正确方向是把它从 blocker 改造成**覆盖度诊断 + 一次定向修复 + 待编辑状态**。同时，社区事实污染、来源错配和图片身份冲突仍保持 error，但必须尽量在生成前发现。

## 建议的质量门状态机

```text
ContentPackage 预检
  ├─ 硬阻断：事实来源不足 / 来源角色错位 / 权利或安全问题
  └─ 可生成
       ↓
先保存 generation_attempt（正文、图片、模型快照、质量报告）
       ↓
确定性审计
  ├─ error   → 不设为当前可交付稿；保留在历史并显示修复原因
  ├─ warning → 保存为“待完善草稿”；可以编辑，但发布前须处理或确认
  └─ info    → 保存为普通编辑建议
       ↓
若只有可修复 warning：最多一次定向补写
       ↓
重新检查事实引用和权利边界
       ↓
当前草稿 / 待核验 / 待配图 / 可填入
```

### 继续硬阻断的项目

- 新增了 ContentPackage 外事实或事实段落无法回指证据。
- 把社区发现渠道、评论或热度冒充事件事实。
- 伪造共识、作者、数字、日期、引用或来源关系。
- 图片、版权、平台资格或敏感凭据不满足交付要求。
- Synthesis 声称多源确认，但实际没有独立来源。

这些问题影响真实性或可发布性，应该像 Sanity 的 error 一样阻止进入“可填入”，必要时也阻止成为当前有效稿。

### 改成 warning 的项目

- Brief 解释不足、正文偏短、段落结构单薄。
- 已支持事实没有被充分使用，但没有出现包外事实。
- 图片数量不足、图注不完整、视觉节奏一般。
- 标题普通、开头不够直接、句式机械或信息重复。

这些问题应该像 Sanity 的 warning 一样保留草稿并给出明确修复按钮，不应整单失败。

### 建议的完整度指标

不要再只看字符数。可以用四个确定性维度：

- `factCoverage`：本稿引用到的 supported / partially-supported fact IDs ÷ 本稿型计划使用的 fact IDs。
- `supportedParagraphRatio`：事实性段落中，有证据回指的段落比例；必须保持 100%。
- `requiredDimensionCoverage`：按稿型检查事件、规则/机制、影响对象、限制/未知是否有证据且被正文使用；不是要求机械小标题。
- `redundancyRatio`：近似重复句或同一事实重复表达占比，避免用灌水通过字数。

字符数只保留为 warning 触发器。第一轮可把 Brief 的目标区间设为约 300–800 个中文字符做真实试用，但最终判断以事实覆盖和表达需要为准；Curate 可以更短，Synthesis 则应要求独立来源增量而不是单纯更长。

### 用户看到的恢复动作

当生成结果偏短时，不显示“生成失败”，而显示：

> 已生成 346 字快讯，事实安全检查通过；5 条支持事实中用了 3 条，缺少“适用规则”和“限制条件”的解释。

提供四个动作：

1. **补充现有证据**：只使用尚未覆盖的 fact IDs，补写缺失段落。
2. **重新读取原文**：提取结果可能过短或漏段时，走第二提取器并展示差异。
3. **搜索第二来源**：只有一个来源、无法支持综合解释时，回到 StoryDesk 增加核验来源。
4. **保留为快讯**：事实已完整时允许用户接受短稿，状态保持“待编辑/待核验”，而不是伪装成发布就绪。

自动补写最多一次；如果仍短，不要无限重跑或靠套话凑字数。

## 从调研落到本项目的优先级

### P0：先修“生成后整单失败”

1. 给 ContentPackage 增加生成前不变量检查：事实来源角色、图片 SHA-256 唯一性、实体图片与 Story 主体一致性；违规包不能标 `ready`。
2. 将质量报告持久化到每次 generation attempt；模型返回后先保留，再决定是否成为当前稿。
3. 给失败分类：`transient / repairable / deterministic`，相同素材包的确定性错误不再机械重试 3 次。
4. 把 `brief-underdeveloped` 从 blocker 拆为 `coverage-warning`；输出未使用 fact IDs 和缺失维度。
5. 对纯 warning 运行一次 targeted repair，补丁只能使用 ContentPackage 内事实；修复后重跑全部事实硬门。
6. 前端显示“事实安全 / 内容完整 / 图片与权利 / 表达质量”四栏，不再只显示一个红色失败。
7. 黄金集增加：社区发现措辞漏入事实包、同指纹截图重复计数、错误实体图片、短但完整快讯、长但重复空泛稿、修复后合格稿、修复仍不足但可保存稿。

### P1：把正文提取变成可解释组合

1. Readability 作为 Node 主提取器；保存原始快照、解析元数据和诊断。
2. 建立真实站点 fixture 集：官方博客、媒体文章、JS 页面、分页文章、GitHub、社区自述。
3. 主结果正文过短、段落异常或图片为空时才跑后备策略；Trafilatura 先作为离线对照，不立即成为 Windows 必装 Python 服务。
4. 两个结果不一致时展示“正文差异/新增段落”，不要自动把高召回结果全部塞进素材包。

### P1：让搜索和 Story 聚合更像工作台

1. 近重复层采用正文指纹/相似度；Story 层再用实体、时间、动作和来源关系聚合，两层不能混成一个阈值。
2. 搜索范围覆盖原始标题、中文标题、冻结正文、EvidenceClaim、草稿和用户备注；提供日期、来源角色、稿型、状态和权利筛选。
3. 允许保存搜索与规则，但每条自动规则可暂停、可预览影响、可解释命中原因。
4. Story 详情增加来源矩阵：谁最早、谁是官方、谁独立核验、谁带来新事实、哪些只转载。

### P2：多来源观点不是“让模型总结一下”

1. 先形成 claim-source matrix，再生成“共同事实 / 独有信息 / 直接分歧 / 尚未核验”。
2. 每条观点和差异都可点击回到原句；媒体级标签不能替代文章级证据。
3. 对社区观点继续遵守现有样本门槛；对媒体报道则按独立来源和 claim 增量判断，不用点赞数或语调分数代表真实性。
4. 阅读器支持“只问选中来源”，回答使用行内证据链接，回答本身不能直接变成 supported fact。

### P2：把 AI 变成编辑建议，而不是整篇重写器

1. 继续使用现有 Tiptap，不换编辑器。
2. “补背景、精简、改标题、修句子”全部返回精确 range patch，并显示 diff。
3. 建议可逐项接受/拒绝；用户已修改的事实锚点不匹配时停止应用。
4. 原草稿、生成尝试、修复尝试和人工版本分别记录，不把失败尝试摆在当前草稿旁边。

## 可直接复用、只借鉴、暂不建议

### 可直接复用或在现栈内实现

- Mozilla Readability（Apache-2.0）作为主正文提取器，并配合 DOMPurify/CSP。
- 现有 Tiptap MIT 核心上实现轻量 suggestion/diff，不需要购买或迁移编辑器。
- Sanity 的 `error / warning / info` 语义，移植到 DraftDesk 与 DeliveryDesk 的状态模型。
- Miniflux 的 source-specific scraper/rewrite rule 思路，落到 SourceDesk 配置与诊断。

### 只借鉴交互与数据模型

- Feedly/Inoreader：可暂停规则、命中预览、内容过滤与去重分离。
- Ground News：同一事件来源矩阵，但不复制媒体偏见分。
- NotebookLM：来源选择、行内引用、针对来源提问。
- NewsBlur：Saved Search、全文补齐、文章变更历史和透明训练规则。

### 暂不建议进入核心依赖

- 整体部署 NewsBlur 或 Miniflux：与本项目本地 SQLite 单用户边界重复且运维更重。
- 把 Trafilatura 设为 Windows 强制 Python sidecar：先用 fixtures 证明增益。
- 把 GDELT/Media Cloud 当事实来源或实时主采集器：只适合外部召回、覆盖评估和趋势旁证。
- 购买 Tiptap Pro/Sanity 或上传私人草稿到 NotebookLM：目前没有必要，也会引入云端、许可或隐私依赖。

## 下一轮最小可验证交付

如果下一轮开始实施，建议只做一个闭环，不同时扩来源：

1. 把这两次真实失败抽成两个去隐私 regression fixtures：`ready` 包不得含社区发现过程事实；相同 SHA-256 的截图只能计一张。
2. 证明旧逻辑会生成三次却永远无法通过，并证明错误实体图片不会再进入素材包。
3. 在 PackageDesk 建立统一预检，并让图片发现、冻结、生成和质量门复用同一身份函数。
4. 实现三层严重度、失败可重试分类和 generation attempt 保留。
5. 再把 `brief-underdeveloped` 改为 warning，并增加一次基于未使用事实的定向补写。
6. 浏览器验收：用户能看到是“素材包需修复”还是“草稿待完善”，可以重新建包、补写或保留快讯。
7. 运行 `npm test`、`npm run eval:editorial`、`npm run build`；黄金集必须覆盖“事实硬阻断不被放松”。

这个闭环比继续增加来源或继续加提示词更重要：它既不降低事实标准，也不会再把一篇可救的草稿变成看不见的失败任务。
