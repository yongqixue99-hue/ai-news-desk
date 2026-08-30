# AI 新闻台参赛竞争力 Go / Pivot 评估

> 日期：2026-08-17（Asia/Shanghai）  
> 结论性质：独立、苛刻的赛前投资判断，不是宣传稿。  
> 资料边界：赛事官网/规则/FAQ、官方产品页、Devpost 具体项目页和本地代码。All Things Agentic 当前项目画廊尚未公开，因此无法知道真实提交数量或直接对手；任何“获奖概率”都会是假精确。  
> 评分口径：按官方 Stage Two 的 1–5 分制，以 Innovation & Operational Utility 40%、Architectural Discipline 30%、Demo & Production Readiness 30% 加权。估计误差至少 ±0.3 分，不代表评委承诺。

## 一、结论先行

### 最终判断：**Conditional Go；泛化版 No-Go**

不建议继续把它做成“面向所有读者的 AI 新闻聚合与写作平台”，也不建议只把现有本地产品换成 Gemini、搬上 Google Cloud 就提交。新闻聚合、热点发现、摘要、事实核查、品牌语气、多平台生成、创作者记忆和审批发布都已有成熟产品或高度相似的 Devpost 项目；泛化版本即使合规，也很可能只是一个完成度尚可的同类项。

值得继续的唯一版本是把范围进一步锁死为：

> **An evidence- and rights-aware assignment desk for independent publishers. It decides whether a signal should be curated, briefed, synthesized, analyzed, or skipped, then delivers a defensible approval package where every claim and every visual asset remains traceable.**

中文可理解为：**给独立创作者和小型编辑团队使用的“可举证选题台”**。它不只写稿，而是决定“是否值得做、该用什么内容形态、哪些事实能写、哪些图片能用”，最后交付可审核、可复制、可下载、可由平台适配器填入的发布包；最终发布仍由人确认。

这个组合并非没有竞争者，但比“Gemini 写新闻”明显更难复制，也更贴合 Taskmaster 的“完整工作流、真实动作和低人工干预”。建议只批准一个 **48 小时竞争力 spike**，通过硬门槛后再投入剩余开发时间；不要现在就授权两周全量改造。

### 为什么不是直接 No-Go

本地代码不是一个空壳：有约 23,396 行 TypeScript/React/JavaScript，2026-08-17 实测 `npm test` 为 **133/133 通过**，`npm run build` 通过。事实阻断、素材权利、发布前检查、结构化回执、生成锁、版本历史和失败处理都是真实代码，而不是赛前概念。这些是多数“新闻总结器”没有的可复用资产。

### 为什么也不是直接 Go

1. 当前强制 Google 技术仍是 **0/3**：`package.json` 没有 Gemini/Vertex、ADK/GenAI SDK/Genkit 或 Google Cloud SDK；原样提交在 Stage One 就会失败。[Official Rules §6](https://allthingsagentichackathon.devpost.com/rules)
2. 当前所谓“编辑记忆、视觉记忆、Curate/Brief/Synthesis/Analysis/Skip 路由”大部分仍是规划，不是已实现能力。
3. 最接近的公开项目 **CreatorPilot** 已经具有趋势发现、创作者记忆、素材选择、工作流编排、发布检查和 YouTube 发布；**Elon** 已经具有 versioned BrandMemory、主动排期、人工审批、官方 API 发布和效果闭环。只讲“创作者 agent + memory + approval”不够新。[CreatorPilot](https://devpost.com/software/creatorpilot-zoxs7b) · [Elon](https://devpost.com/software/elon-mtkelx)
4. 当前比赛页面显示 **4,377 participants**，但画廊尚未公开；参与者不等于提交者，仍说明不能靠一个常见点子搏低竞争。[当前 Project Gallery](https://allthingsagentichackathon.devpost.com/project-gallery)

---

## 二、比赛真正奖励什么

赛事明确要求项目使用 Gemini 3.5+、至少一个 Google Agent Framework、至少一个 Google Cloud 基础设施服务；Taskmaster 还特别写明“不要只做一个写文本的 agent”，而要完成多步骤工作流和真实动作。[比赛主页](https://allthingsagentichackathon.devpost.com/) · [Official Rules](https://allthingsagentichackathon.devpost.com/rules)

官方评分是：

| 标准 | 权重 | 对本项目的含义 |
| --- | ---: | --- |
| Innovation & Operational Utility | 40% | 不能以“生成了一篇文章”为主价值；必须证明 agent 主动决定、调用工具、阻断风险、减少编辑劳动。 |
| Architectural Discipline & Tech Stack | 30% | 要有真实状态、记忆、失败恢复、权限边界、可审计工具调用和 Google Cloud 部署，不是提示词链。 |
| Demo & Production Readiness | 30% | 4 分钟内必须看见未剪切的真实动作、Google Cloud 证据、可复现仓库和清楚架构。 |

赛事 FAQ 还直接提醒不要把通用聊天 UI 包装成 agent，也不要用含糊 AI 话术夸大实际运行能力。[官方 FAQ](https://allthingsagentichackathon.devpost.com/details/faqs)

这意味着最有竞争力的演示不是“看 Gemini 写得多漂亮”，而是：

1. 一个新信号进入；
2. agent 与历史覆盖、当前热点、受众目标和来源证据比较；
3. 选择 `Curate / Brief / Synthesis / Analysis / Skip`；
4. 建立 claim ledger，过滤证据不足的说法；
5. 从素材库中只选平台、授权、到期日均合格的图片，找不到就明确无图；
6. 生成审批发布包；
7. 展示被拒绝的稿件或图片以及可恢复状态；
8. 人只做最后审批。

---

## 三、本地代码：真正能复用的资产与必须承认的缺口

### 3.1 已实现、具有比赛价值的部分

| 能力 | 本地证据 | 参赛价值 |
| --- | --- | --- |
| 候选评分、聚类和透明拆分 | [`server/scoring.ts`](../../server/scoring.ts#L14) 有价值、证据、时效、传闻惩罚、跨来源和热度拆分。 | 可作为 assignment decision 的确定性底座，避免把一切交给 LLM。 |
| 有界个性化 | [`server/personalization.ts`](../../server/personalization.ts#L11) 把来源、频道、关键词和发布反馈作为独立加减分，不覆盖新闻价值。 | 有明确可解释性，适合作为第一版用户偏好记忆。 |
| 图片权利可执行治理 | [`server/material-governance.ts`](../../server/material-governance.ts#L148) 会检查 rights、授权证据、署名、来源 URL、平台、到期日，并阻断不合格素材。 | 这是当前最稀缺、最可证明的差异化资产。 |
| 事实与图片阻断 | [`server/draft-readiness.ts`](../../server/draft-readiness.ts#L4) 把弱事实和不合格图片合并为 readiness blocker。 | 能演示 agent 的克制和安全边界，而不只是生成。 |
| 发布前能力清单与回执 | [`server/publisher-preflight.ts`](../../server/publisher-preflight.ts#L204) 检查通道、登录、编辑器、标题、正文、图片、图注、分区、话题；只允许 fill-only，永不点击发布。 | 可直接迁移为 cloud approval package 与 platform adapter contract。 |
| 生成观测和原子领取 | [`server/generator.ts`](../../server/generator.ts#L241)、[`server/provider-runtime.ts`](../../server/provider-runtime.ts#L180) 保存 provider/模型/skill 轨迹，避免重复生成并记录失败。 | 有助于架构纪律和 demo 中的运行可见性。 |
| 可运行底盘 | 2026-08-17 实测 133 tests 全过、TypeScript/Vite build 通过。 | 比从零做 hackathon demo 风险低。 |

### 3.2 尚未实现、不能拿来宣传的部分

| 规划能力 | 当前事实 | 必须做的改动 |
| --- | --- | --- |
| 主动发现“值得写什么” | 当前评分主要是关键词正则、标题词 Jaccard、来源和公开互动；没有语义化历史覆盖、趋势速度或机会成本判断。[`server/scoring.ts`](../../server/scoring.ts#L63) | 新增 story/coverage memory、变化量判断和结构化 assignment decision；确定性信号与 Gemini 判断分开。 |
| 编辑记忆 | 当前个性化只从感兴趣/不感兴趣/已发布和来源/频道/关键词学习，不从版本差异、删改原因和最终发布稿学习。[`server/personalization.ts`](../../server/personalization.ts#L55) | 从初稿→人工终稿提取可解释的 edit preferences，并允许用户查看/删除；不要只塞一个“模仿我的语气”提示词。 |
| 视觉记忆与自动选图 | 素材库真实存在，但当前 generator 只收到候选来源页图片；没有把素材库作为视觉候选集，且 job 明确 `noGeneratedImages: true`。[`server/generator.ts`](../../server/generator.ts#L307) | 先由确定性规则过滤权利/平台/过期，再由 Gemini 做语义相关性排序；无合格图片就无图。生成图只作解释图的末级 fallback。 |
| 内容形态路由 | 当前 prompt 硬编码“一篇 400–750 字中文独立快讯”，没有 Curate/Brief/Synthesis/Analysis/Skip。[`server/generator.ts`](../../server/generator.ts#L220) | 路由必须输出理由、证据和置信度，并允许 `Skip`；原文已经很好时，Curate 只生成导语、摘要和出处，不重写全文。 |
| Google runtime | `package.json` 没有任何合格 Google agent/cloud 依赖；provider 只分 Codex CLI 与 OpenAI-compatible 请求。[`package.json`](../../package.json) · [`server/provider-runtime.ts`](../../server/provider-runtime.ts#L200) | 用 Genkit/GenAI SDK/ADK 作为真实控制器，让 Gemini 3.5+ 决定工具调用；Cloud Run + Firestore/Pub/Sub 保存可重放状态。 |
| 云端异步状态 | 当前所有状态写入一个 `.workflow/state.json`，用单进程 Promise queue 串行更新。[`server/storage.ts`](../../server/storage.ts#L11) | Judge Mode 至少把 run、assignment、evidence、asset decision、approval package 放入 Firestore，并为重复事件设 idempotency key。 |
| 可复现采集 | Horizon fetcher 是当前用户目录下的绝对路径，云端无法复现。[`server/horizon.ts`](../../server/horizon.ts#L28) | 竞赛版必须把最小数据采集器封装进仓库/容器；不要在 demo 依赖本机 Skill 路径。 |
| 跨平台交付 | 当前真正的浏览器适配器只有小黑盒，且依赖用户登录的本机 Chrome。 | Judge Mode 只需云端审批页 + copy/download；日常版保留小黑盒 fill adapter。不要在截止前同时做 3–5 个真实平台 API。 |

### 3.3 New Projects Only 仍是资格风险

当前仓库没有 commit，所有文件都处于 untracked 状态，无法用 Git 时间线证明哪些工作在 Submission Period 内完成。现有本地产品如被认定为赛前工作，必须披露复用范围；竞赛核心、Google 编排、云端状态、Judge Mode 和演示动作必须有提交期内的 commits、Cloud Run revisions 和部署日志。[Official Rules §6](https://allthingsagentichackathon.devpost.com/rules) · [FAQ](https://allthingsagentichackathon.devpost.com/details/faqs)

这不是产品竞争力问题，而是 pass/fail 风险。开始大规模开发前应先建立真实 Git 历史，并在 README 中列出 pre-existing modules 与 competition-period work；不能靠“新建仓库”伪装成新项目。

---

## 四、竞争格局：哪些点已经很拥挤

### 4.1 商业产品已经覆盖的能力

| 能力 | 官方对标 | 结论 |
| --- | --- | --- |
| 多源采集、去重、聚类、AI 筛选 | Feedly 已提供 content-based deduplication、同事件 clustering、AI Feeds 和 market intelligence 报告。[Deduplication](https://docs.feedly.com/article/218-how-does-deduplication-work) · [Clustering](https://docs.feedly.com/article/552-what-is-clustering) · [Market Intelligence](https://feedly.com/market-intelligence) | **高度拥挤。** 采集/聚类不能作为主创新。 |
| 主动监控、判断是否值得提醒、变化记忆 | NewsWhip Monitoring Agent 会持续监控、判断变化是否值得注意、给出结构化 brief；Active Memory 只在出现实质变化时再次返回。[Monitoring Agent](https://www.newswhip.com/ai-monitoring-agent/) | **高度拥挤。** “主动推荐热点”本身不新。 |
| 多源事实摘要、个性化、不同观点 | Particle 提供多源 fact-forward summaries、偏见视角、个性化 feed/digest 与带来源问答。[Particle for Android](https://particle.news/android) | **读者端高度拥挤。** 不应以“所有读者”为产品用户定位。 |
| 品牌声音、受众、视觉和批准知识 | Jasper IQ 保存 brand voice、视觉身份、audience personas 和 approved source material，并跨工作流应用；Style Guide 还会标记违规。[Jasper IQ](https://www.jasper.ai/jasper-iq) · [Style Guide](https://www.jasper.ai/style-guide) | **高度拥挤。** “像我写作”或“品牌记忆”不能单独成为亮点。 |

因此要严格区分：**产品用户**应是独立创作者/小型编辑团队；他们写出的文章可以面向任何读者。若把产品本身定义成面向所有读者，就会直接进入 Particle、Feedly、Ground News 一类成熟消费产品的赛场，同时丢掉现有发布工作流优势。

### 4.2 Devpost 公共项目中的直接重复

这些不一定参加当前比赛，但能证明概念供应已经很密集：

| 项目 | 已有能力 | 对我们的警告 |
| --- | --- | --- |
| [CreatorPilot](https://devpost.com/software/creatorpilot-zoxs7b) | RSS 趋势发现、聚类与创作者适配、Profile/Memory Agent、素材选择、storyboard/render/metadata、发布检查、YouTube live/mock publishing。 | **最直接重复。** “趋势＋记忆＋素材＋发布包”不再足够。 |
| [Elon](https://devpost.com/software/elon-mtkelx) | versioned BrandMemory、主动内容日历、媒体生成、operator approval、官方平台 API、效果分析回流。 | “记住品牌、自动写、等批准、再发布、再学习”已有完整实现。 |
| [Content_Studio.ai](https://devpost.com/software/content_studio-ai-rmuwqd) | Google ADK 多 agent，文章研究、竞品/热点、LinkedIn/X/Instagram 内容与视觉、自动 posting。 | 多 agent 与多平台不是创新，反而容易显得堆栈。 |
| [BrandVoice](https://devpost.com/software/brandvoice) | ADK、Vertex、Gemini、Imagen、Veo；生成可发布文本、图片、轮播和视频，支持预览、编辑、排期。 | “Gemini 生成文章和图片”是最拥挤路线。 |
| [curio](https://devpost.com/software/flsh-news-media-generator) | 定时取新闻、RAG 核验与优先级、个性化摘要、文本/音频/视频脚本、自动分发。 | “自主新闻 agent”已有端到端版本。 |
| [The Newsline](https://devpost.com/software/the-newsline) | 多源聚类、Gemini 合成、逐段来源支持、可信度/偏见/情绪指标。 | claim/source 可追溯也不是单独的新点。 |
| [NewsForge](https://devpost.com/software/newsforge) | Gemini 选题、写作、改写、翻译，面向独立写作者。 | 单纯写稿几乎没有获奖区分度。 |

过去一届 Google Cloud ADK Hackathon 有超过 10,000 名注册参与者；获奖项目通常是有完整产品、复杂但清晰的工作流和真实 Google Cloud 部署，而不是一个提示词 demo。[官方 winners update](https://googlecloudmultiagents.devpost.com/updates/35783-and-the-winners-are) · [获奖项目画廊](https://googlecloudmultiagents.devpost.com/project-gallery)

### 4.3 仍可能形成的差异化

没有任何一个单点足够新。真正可以成立的是以下组合：

1. **内容形态决策而非默认改写。** 原文好就 Curate，事件小就 Brief，多源冲突才 Synthesis，需要观点才 Analysis，证据/价值不足就 Skip。
2. **两本可执行账本。** claim ledger 证明每条事实；asset ledger 证明授权、署名、来源、平台与到期日。任何一项不合格都不能进入 ready state。
3. **编辑修改成为记忆。** 学习的是“哪些句子被删、哪些判断被保留、哪些来源/图片最终被接受”，而不只是一个 tone profile。
4. **从信号到审批包。** 不止提醒“这条值得关注”，而是完成来源整理、路线选择、证据映射、视觉选择、平台适配和 approval package。
5. **负能力可见。** demo 中必须展示 agent 拒绝写、拒绝使用某图片或保留原文，而不是每次都输出漂亮长文。

其中第 2 点是现有代码最强的护城河，第 1、3、4 点仍需开发。项目可以竞争，但只能靠这个组合和执行质量，不能靠题目本身。

---

## 五、按 40/30/30 的诚实评分

| 版本 | Utility 40% | Architecture 30% | Demo 30% | 加权分 | Stage One / 获奖判断 |
| --- | ---: | ---: | ---: | ---: | --- |
| **Current：现有本地版原样提交** | 3.1 | 2.7 | 2.6 | **2.83 / 5** | 强制技术 0/3，**Stage One fail**；没有评奖资格。 |
| **Generic Google port：换 Gemini + Genkit + Cloud Run** | 3.2 | 3.5 | 3.4 | **3.35 / 5** | 若三项接好可合格，但与 BrandVoice、Content Studio、CreatorPilot、curio 等高度同质；**可提交，不值得以获奖为目标投入**。 |
| **Focused wedge：可举证选题台，且下列门槛全部完成** | 4.2 | 4.2 | 4.1 | **4.17 / 5** | **有竞争力但没有胜算保证**；可主攻 Taskmaster，同时自然竞争 Best Architectural Design / Individual-Hobbyist。 |

### 评分理由

**Current** 有真实多步工作流和强阻断机制，所以 utility 不是低分；但它仍由用户选候选、生成固定快讯，云端与 Google 架构缺失，Judge Mode/英文 demo/可复现部署也不存在。

**Generic port** 能解决资格和部分架构问题，却没有解决创新密度。把 Provider 换成 Gemini、把 JSON 换成 Firestore不会让评委忽略相似项目。

**Focused wedge** 的 4.17 是“完成态目标分”，不是当前分；它假设：

- 三种可见结果能稳定演示：`Brief`、`Curate`、`Skip/Blocked`；
- 每个客观事实有来源，每张图经过权利决策；
- Firestore 中能重放完整 run，重复事件不会生成重复包；
- 有真实 dogfood 数据证明编辑时间或风险项减少；
- 英文 Judge Mode 不依赖小黑盒登录；
- 4 分钟 live demo 与 Google Cloud 证据完整。

缺少内容质量基准、真实用户修改数据或稳定 demo 时，Focused wedge 应下调至约 3.6–3.8，仍未必能进奖项候选。

---

## 六、截止日前的可行性

从 8 月 17 日到上海时间 9 月 1 日 08:00 约有两周。完成“整个跨平台内容平台”不可行；完成一个比赛纵切面可行。

### 可直接复用

- scoring 的透明信号与候选结构；
- material governance、draft readiness、publisher preflight；
- provider observability、生成锁、失败回执；
- React 编辑/审批界面的大部分组件；
- 133 个测试中的领域规则和安全边界。

### 需要重做或隔离

- Google agent controller 与 Gemini tool calling；
- Firestore/Pub/Sub/Cloud Run 状态与幂等；
- content mode router；
- claim ledger 的真实逐条证据映射（当前是一段一条的粗粒度状态）；
- 素材库进入 Visual Planner；
- 不依赖本机绝对路径、钥匙串和 Chrome 的 Judge Mode；
- 英文 README、架构图、部署脚本与 demo。

### 建议只做一条 demo 主线

三个预置但真实来源包足够，不要追求全网和所有平台：

1. **Case A：新且重要** → `Brief` → 使用一张素材库中 rights-cleared 的官方图 → 生成发布包。
2. **Case B：原文已很好** → `Curate` → 保留原文链接和短导语，不生成 AI 长文，不复制整篇文章。
3. **Case C：热点高但证据弱/图片无权** → `Skip` 或 `Blocked` → 明确理由、保存追踪任务，不产生可发布状态。

这三个 case 比十种内容形态、五个平台和炫酷 AI 生图更能体现判断力。

---

## 七、48 小时止损门槛与后续硬门槛

### Gate 1：2026-08-19 23:59（上海）——决定是否继续主方向

必须同时满足：

- Gemini 3.5+ 通过合格 Google framework 真实调用工具，不是单次 REST completion；
- 一个 Pub/Sub/HTTP 事件触发 Cloud Run，在 Firestore 保存 `received → deciding → packaged/blocked` 状态；
- 至少完成一个 `Brief` 和一个 `Skip/Blocked`；
- demo 页面可查看 assignment reason、claim/source 和 asset decision；
- 重放同一 idempotency key 不生成第二份包。

**任一核心项失败：停止主方向，立即 Pivot 到 ProofDesk，不继续云端搬家。**

### Gate 2：2026-08-22 23:59——验证产品差异化，不只验证技术

- 三个 demo case 连续运行两轮均得到正确 route；
- `Curate` 不复制全文、不做无意义重写；
- 所有 factual claim 都有 source URL 或被明确标为未核验并阻断；
- 所有入选图片都通过平台、权利、证据、署名与到期检查；
- Visual Planner 找不到合格图时返回 no-image，而不是凑图；
- 审批包能 copy/download，且不依赖任何第三方登录。

失败则砍掉“主动选题与写作”，保留 claim/rights/approval 核心，做 ProofDesk。

### Gate 3：2026-08-24 23:59——验证内容质量

用 10 个真实来源包做盲评，预先写下验收阈值：

- **0 个**捏造的人名、数字、日期或产品名；
- 10/10 的客观事实均可回指来源或被阻断；
- route decision 至少 8/10 被用户接受；
- 至少 7/10 审批包只需不超过 5 分钟人工修改；
- 相比当前人工/Codex 基线，记录实际审稿时间和修改量，不只写主观“质量很好”。

未达标就不要把“高质量写作”放进价值主张；改为只生成结构化 brief/evidence pack，让人写最终文章。

### Gate 4：2026-08-26 23:59——决定是否值得提交

- 4 分钟英文或英文字幕 demo 能一次录完；
- Cloud Run、Firestore、Gemini/Vertex 日志有可见证据；
- README 可由未参与开发的人按步骤启动；
- pre-existing work disclosure 与项目时间线完整；
- 强制失败场景可恢复，敏感凭据未进入 repo/log；
- 项目名称、文案、架构图和 Devpost 表单已是英文。

失败时只提交已稳定的窄版本；若三项强制技术、资格证据或 live run 仍不成立，则 **No-Go，不为“有个提交”继续消耗时间与 token**。

---

## 八、若 Pivot，优先做哪些相邻方向

### Pivot A（推荐）：ProofDesk — evidence & rights approval agent

**输入：** 一个来源链接/来源包/已有草稿。  
**动作：** 拆 claim → 找证据 → 标注冲突与不确定性 → 匹配 rights-cleared 素材 → 检查平台约束 → 生成 defensible approval package。  
**为什么更稳：** 最大化复用 `material-governance`、`draft-readiness`、`publisher-preflight`、生成观测与编辑器；砍掉最难证明的新鲜度预测和高质量自动写稿。  
**竞争力：** 不再和 Feedly/NewsWhip 拼数据规模，也不和 Jasper 拼品牌写作；主打“证据与权利是可执行状态，不是角落里的 citation”。  
**风险：** 不要声称给出法律结论，只能执行用户/团队设定的授权政策并提示人工复核。

### Pivot B：Rights-aware Visual Desk

**输入：** 文章 brief + 自有/授权素材库 + 来源页图片。  
**动作：** 实体识别 → 相似素材召回 → 确定性权利过滤 → Gemini 语义匹配与图注 → 生成每个平台的 visual package / refusal。  
**复用：** 素材保存、SHA-256 去重、授权状态、平台、证据、到期日、publisher receipt 几乎可直接复用。  
**优势：** 相比泛化内容生成更稀缺，也更适合多模态和 Best Multimodal UX。  
**劣势：** 运营效用叙事较窄，需要用“素材找错/过期/误用”真实 case 证明价值。

### Pivot C：ChangeDesk — 只报道“真正变化”的更新台

**输入：** 用户长期关注的公司/人物/议题和已发布历史。  
**动作：** 持续监控 → 与 coverage memory 对比 → 只有实质变化才提醒 → 生成 `what changed / evidence / update package`。  
**复用：** scoring、聚类、反馈、来源健康与通知系统。  
**优势：** `Skip` 和历史记忆成为主角，减少重复 AI 内容。  
**劣势：** NewsWhip Active Memory 已经很接近，必须把“直接形成可举证更新包”做出来，否则仍然同质。

### 不建议的 Pivot

- 面向所有读者的新闻 app；
- 通用 AI 写作/去 AI 味工具；
- 多 agent 社交媒体自动发布器；
- 纯事实核查聊天机器人；
- 为拿 bonus 临时堆 Veo/Imagen/Gemma；
- 完全无关、从零开始的新赛题。

这些方向要么更拥挤，要么会丢掉现有代码和真实使用场景带来的唯一时间优势。

---

## 九、最终投资建议

1. **现在不批准完整开发；批准 48 小时、范围固定的竞争力 spike。**
2. 主方向从“AI 新闻工作流”改成“evidence- and rights-aware assignment desk”；新闻只是第一个场景，小黑盒只是第一个 adapter。
3. 产品用户锁定独立创作者/小型编辑团队；文章受众可以是任何读者。
4. 先做 route + claim ledger + asset ledger + approval package；写作润色、AI 生图、多平台真实发布全部后置。
5. Gate 1 通过才继续；Gate 2/3 任一失败就 Pivot A；资格或 Google 强制栈无法证明则直接 No-Go。

**一句话结论：这个题目本身不够新，泛化版本没有值得继续投入的竞争力；但现有代码里“可执行证据/版权阻断＋发布回执”是真资产。若把它收敛成能主动选择 `Curate / Brief / Synthesis / Analysis / Skip` 的可举证选题台，并在 48 小时内证明 Google Cloud 纵切面与三种不同决策，它值得继续；证明不了，就立即转成更窄的 ProofDesk，而不是继续堆功能。**

---

## 来源索引

### 比赛官方

- [All Things Agentic Hackathon](https://allthingsagentichackathon.devpost.com/)
- [Official Rules](https://allthingsagentichackathon.devpost.com/rules)
- [FAQ](https://allthingsagentichackathon.devpost.com/details/faqs)
- [Resources](https://allthingsagentichackathon.devpost.com/resources)
- [Current Project Gallery](https://allthingsagentichackathon.devpost.com/project-gallery)

### 官方产品

- [Feedly Deduplication](https://docs.feedly.com/article/218-how-does-deduplication-work)
- [Feedly Clustering](https://docs.feedly.com/article/552-what-is-clustering)
- [Feedly Market Intelligence](https://feedly.com/market-intelligence)
- [NewsWhip Monitoring Agent](https://www.newswhip.com/ai-monitoring-agent/)
- [Particle for Android](https://particle.news/android)
- [Jasper IQ](https://www.jasper.ai/jasper-iq)
- [Jasper Style Guide](https://www.jasper.ai/style-guide)

### Devpost 具体项目

- [CreatorPilot](https://devpost.com/software/creatorpilot-zoxs7b)
- [Elon](https://devpost.com/software/elon-mtkelx)
- [Content_Studio.ai](https://devpost.com/software/content_studio-ai-rmuwqd)
- [BrandVoice](https://devpost.com/software/brandvoice)
- [curio](https://devpost.com/software/flsh-news-media-generator)
- [The Newsline](https://devpost.com/software/the-newsline)
- [NewsForge](https://devpost.com/software/newsforge)
- [Google Cloud ADK Hackathon winners update](https://googlecloudmultiagents.devpost.com/updates/35783-and-the-winners-are)
- [Google Cloud ADK Hackathon project gallery](https://googlecloudmultiagents.devpost.com/project-gallery)
