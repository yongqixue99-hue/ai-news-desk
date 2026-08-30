# All Things Agentic Hackathon × AI 新闻台参赛适配调研

> 调研日期：2026-08-17（Asia/Shanghai）  
> 事实来源范围：仅使用 [Devpost 比赛主页](https://allthingsagentichackathon.devpost.com/)、[Official Rules](https://allthingsagentichackathon.devpost.com/rules)、[FAQ](https://allthingsagentichackathon.devpost.com/details/faqs)、[Resources](https://allthingsagentichackathon.devpost.com/resources)，以及 Resources 直接链接的 Google 官方文档。规则页是约束性来源；其余页面用于补充说明。  
> 本地项目依据：[README.md](../../README.md)、[package.json](../../package.json)、[2026-08-13 全量优化交付记录](../audits/2026-08-13-full-optimization-handoff.md)。

## 结论先行

**建议参赛，但属于“有条件 Go”：选 The Taskmaster，把 AI 新闻台做成一个在提交期内新建的、Google Cloud 上真实运行的竞赛版工作流；不要把当前本地版原样提交。**

原因分成两类：

- **题目匹配度高。** 当前系统已经在解决真实且繁琐的多步骤新闻生产：定时采集、筛选、证据复核、成稿、图片权利检查、版本管理、填入编辑器与发布前回执。它比普通聊天机器人更接近 Taskmaster 所要求的“事件驱动、自动路由、完整工作流”。
- **当前提交合规度不够。** 从指定的本地文件看，目前没有证据表明项目使用了 Gemini 3.5+、Google Agent Framework 或 Google Cloud 服务，即三项强制技术要求目前是 **0/3**；同时，现有项目是否在 2026-08-03 之后才新建尚未被证明，“New Projects Only” 是最大资格风险。

因此，正确参赛方式不是临时把 Gemini 接到现有成稿按钮，而是新建一个可清楚界定、可复现、可在云上演示的 agentic 核心：由事件触发，自动完成“发现 → 核验 → 决策 → 产出发布包 → 写入目标系统”，把人工审批保留为新闻安全边界。

---

## 一、已核实事实：时间线

[Official Rules §4](https://allthingsagentichackathon.devpost.com/rules) 给出了约束性时间。下表按 `America/Los_Angeles` 在相应日期的 UTC−7 偏移机械换算为 Asia/Shanghai（UTC+8）：

| 事项 | 官方 PT 时间 | Asia/Shanghai 时间 |
| --- | --- | --- |
| 比赛 / 提交期开始 | 2026-08-03 09:00 PT | **2026-08-04 00:00** |
| $150 Cloud credits 申请截止 | 2026-08-28 12:00 PT，或额度发完为止 | **2026-08-29 03:00** |
| 比赛 / 提交截止 | 2026-08-31 17:00 PT | **2026-09-01 08:00** |
| 评审期 | 2026-09-01 09:00 PT 至 2026-10-01 23:45 PT | **2026-09-02 00:00 至 2026-10-02 14:45** |
| 获奖公布 | 约 2026-10-08 10:00 PT | **约 2026-10-09 01:00** |

另据 [Official Rules §5](https://allthingsagentichackathon.devpost.com/rules) 与 [FAQ](https://allthingsagentichackathon.devpost.com/details/faqs)：每名参赛者可申请一个 $150 Google Cloud credit code，审核可能需要 72 个工作小时，且不保证发放。应立即申请，不要把它当成能否部署的前置条件。

---

## 二、已核实事实：资格与 “New Projects Only”

### 2.1 参赛资格

根据 [Official Rules §3](https://allthingsagentichackathon.devpost.com/rules) 与 [FAQ](https://allthingsagentichackathon.devpost.com/details/faqs)：

- 可由个人、团队或组织参赛；规则没有团队人数上限。团队所有成员都必须符合资格、加入 Devpost 项目，并指定一名 Representative。
- 参赛者须在 2026-08-03 时达到居住地法定成年年龄；台湾地区至少 20 岁；并在该日可访问互联网。
- 意大利、魁北克、克里米亚、古巴、伊朗、叙利亚、朝鲜、苏丹、白俄罗斯、俄罗斯及美国制裁覆盖的其他地区居民不符合资格；受美国出口管制或制裁的个人 / 实体也不符合资格。
- Google、Devpost 及赛事执行相关机构的员工、实习生、承包商、相关家庭 / 同住人员不符合资格；政府机构雇员或会造成真实 / 表面利益冲突的个人或组织也可能不符合资格。
- 代表雇主或公司参赛时，须确保雇主知情同意且不违反内部政策。
- 中国大陆不在规则逐一列出的排除地区中，但这不能替代对个人制裁状态、雇主 / 政府关联、当地法律及其他资格条件的核验。
- Startup Excellence 只面向以**已注册成立的组织**名义提交者，并要求 corporate email；个人或未注册团队不应勾选该专项。

### 2.2 New Projects Only

[Official Rules §6](https://allthingsagentichackathon.devpost.com/rules) 和 [FAQ「Can I submit an existing project?」](https://allthingsagentichackathon.devpost.com/details/faqs) 的要求是：

1. 项目必须在 Submission Period 内新建；不能把现成项目原样提交。
2. 可以使用通用框架、库、starter template 和 AI coding assistant。
3. 若整合其他预先存在的代码或工作，必须披露。
4. 提交中描述、评审的工作必须是在 Submission Period 内完成的。

**对当前项目的事实判断：** 本地交付记录日期为 2026-08-13，落在上海时间的提交期内；这只能证明当日有一次全量优化交付，不能证明整个 AI 新闻台是在 2026-08-04 00:00 之后才新建。[README.md](../../README.md) 已称当前状态为 v6，也表明它有积累过程；[package.json](../../package.json) 的 `0.1.0` 版本号同样不能证明创建日期。

**建议 / 推断：** 在确认仓库和原型的真实创建历史前，不能宣称现有系统满足 New Projects Only。最稳妥的处理是：

- 把竞赛提交定义成一个在提交期内新建的“云端自主新闻值班工作流”，核心 agent、Google 技术接入、事件协议、云端状态与演示用动作均在提交期内完成。
- 当前本地 UI、编辑器、来源适配器等如有复用，逐项写入 `PREEXISTING_WORK.md` 或 README 的 disclosure；不要用“新建仓库”掩盖代码来源。新仓库本身不等于新项目。
- 保留能证明时间线的 commit、部署日志、Cloud Build / Cloud Run revision 和演示录像。
- 如果 2026-08-03 之前已经存在相同的核心 agentic 方案，应在投入大量开发前，通过 [官方 Discussion Forum](https://allthingsagentichackathon.devpost.com/forum_topics) 把计划复用的范围写清楚，取得书面答复。

---

## 三、已核实事实：强制技术栈与三个赛道

### 3.1 所有赛道的三项强制技术

[比赛主页 What to Build](https://allthingsagentichackathon.devpost.com/) 与 [Official Rules §6](https://allthingsagentichackathon.devpost.com/rules) 要求每个项目同时使用：

1. **Gemini 3.5 或更新模型**，经 Gemini API 或 Vertex AI 访问；主页具体鼓励 Gemini 3.5 Flash。
2. **至少一个 Google Agent Framework**：Google ADK、GenAI SDK、Antigravity SDK 或 Genkit。
3. **至少一个 Google Cloud 基础设施服务**：例如 Cloud Run、Cloud SQL、Firestore、GKE 或 Pub/Sub。

项目不必在提交或评审的每一刻保持公开在线，但 demo video 必须清楚证明后端曾真实部署、运行在 Google Cloud，例如 Cloud Console、Cloud Run dashboard、Vertex AI logs 或 `.run` URL。[FAQ「Does my project have to be live」](https://allthingsagentichackathon.devpost.com/details/faqs)

### 3.2 三个赛道

| 赛道 | 官方核心要求 | 对 AI 新闻台的匹配判断（推断） |
| --- | --- | --- |
| **The Taskmaster** | 做完整工作流而非聊天 / 纯写作；代理主动执行多步任务、把信息送到正确位置。Resources 进一步强调事件驱动、自动路由、跨应用完成任务。 | **最佳选择。** 定时新闻触发、来源路由、证据核验、图片合规、草稿与编辑器填入天然是多步动作链。 |
| **The Collaborative Partner** | 主动澄清、逐步引导、记录反馈，并通过有状态对话、RAG 与持久记忆持续适应用户。 | 次选。当前有偏好反馈和版本历史，但缺少以澄清问题为主线的协作式对话与长期个性化记忆。 |
| **The Fortified Enterprise Fleet** | 多个机构代理、企业 Agent Registry / Runtime / Memory / Identity / Gateway / Model Armor / Observability 等规模化、安全、合规能力。 | 当前不合适。现有系统是单机、单用户工作台，没有企业 agent registry、多代理委派和生产数据治理体系。 |

事实来源：[Official Rules §6](https://allthingsagentichackathon.devpost.com/rules) · [Resources「Explore the Tracks」](https://allthingsagentichackathon.devpost.com/resources)

---

## 四、已核实事实：提交物、评分与奖金

### 4.1 必需提交物

根据 [比赛主页 What to Submit](https://allthingsagentichackathon.devpost.com/) 与 [Official Rules §6](https://allthingsagentichackathon.devpost.com/rules)，Stage One 会先做完整性 pass / fail。至少需要：

- 选择**一个**赛道。
- hosted project URL（如有）；官方“强烈鼓励”，但不是绝对强制。
- 英文 text description：功能、所用技术、其他数据源、发现与学习。
- GitHub / GitLab / Bitbucket 代码仓库 URL。私有仓库须授权 `testing@devpost.com` 与 `cloudhackathons@google.com`。
- README 中逐步的本地启动或云端部署说明。
- 清楚的 architecture diagram。
- 最长约 4 分钟 demo video：公开可见地上传至 YouTube 或 Vimeo；说明问题与价值，现场展示应用动作，并展示 Google Cloud 后端运行证据。超过 4 分钟只评前 4 分钟。
- 项目至少支持英文；所有提交材料必须是英文，非英文 demo 必须带英文字幕 / 翻译。
- 供测试的项目（如提供）须在评审期结束前免费、无不合理限制地可用；若需登录，应给出测试凭据。

[FAQ「Can I edit my submission after the deadline?」](https://allthingsagentichackathon.devpost.com/details/faqs) 还要求截止后不要修改提交所指向的视频、仓库和应用；需要继续开发时另开副本。建议在截止前创建不可变 tag / release 并冻结评审分支。

新闻项目还要特别留意 [Official Rules §6 的 Third-Party Integrations / IP](https://allthingsagentichackathon.devpost.com/rules)：必须有权使用第三方 SDK、API、数据、文章与图片，并遵守其条款和许可。当前系统的来源追溯、授权状态、平台范围、有效期与图片指纹是优势；demo 数据仍应优先使用自有、明确授权或许可清晰的内容，并在 description 中列出数据源。

### 4.2 评分权重与 bonus

[Official Rules §8](https://allthingsagentichackathon.devpost.com/rules) 的评审分三阶段：

| 阶段 / 标准 | 权重或分值 | 评审重点 |
| --- | --- | --- |
| Stage One | pass / fail | 提交物完整、能运行、回应赛题并使用强制技术。 |
| Innovation & Operational Utility | **40%** | 消除真实摩擦；高价值自主执行，而非简单聊天。Taskmaster 特别看多步后台工作流和 “Bring Your Own Friction”。 |
| Architectural Discipline & Tech Stack | **30%** | 解耦、状态、记忆、安全隔离、失败处理、可维护性。 |
| Demo & Production Readiness | **30%** | 4 分钟内有不可否认的真实运行证据、清楚文档、架构图、可复现启动和 Google Cloud 证明。 |

Stage Two 的每项按 1–5 计分。Stage Three 可追加：

- 公开发布一篇制作内容（blog / podcast / video），明确写明“为参加该 hackathon 而制作”：最多 **+0.2**。
- 在 X、LinkedIn、Instagram 或 Facebook 发布项目内容；X / LinkedIn 使用 `#AllThingsAgenticHackathon`：最多 **+0.2**。
- 每成功集成一个额外 Google AI model（如 Gemma、Veo、Lyria）：**每个 +0.2**，此项最多 **+0.6**。

因此 bonus 合计最多 +1.0，最终最高 6 分。低成本优先级应是公开制作文章 + 社交帖；额外模型只有在能改善产品而不是“为了加分硬接”时再做。

### 4.3 奖金与专项奖

[比赛主页 Prizes](https://allthingsagentichackathon.devpost.com/) 与 [Official Rules §9](https://allthingsagentichackathon.devpost.com/rules) 列出的现金总额为 **$180,000**：

| 奖项 | 数量 | 每名现金 | 每名 Cloud credits | 额外权益 / 条件 |
| --- | ---: | ---: | ---: | --- |
| Grand Prize | 1 | $50,000 | $5,000 | Google team virtual coffee、social promo；所有合格项目 |
| The Taskmaster | 1 | $20,000 | $2,000 | virtual coffee、social promo |
| The Collaborative Partner | 1 | $20,000 | $2,000 | virtual coffee、social promo |
| The Fortified Enterprise Fleet | 1 | $20,000 | $2,000 | virtual coffee、social promo |
| Startup Excellence | 1 | $20,000 | $5,000 | virtual coffee、social promo；须以 incorporated organization 提交并提供 corporate email |
| Individual / Hobbyist | 2 | $10,000 | $1,000 | virtual coffee、social promo；个人或团队 |
| Best Architectural Design | 2 | $5,000 | $1,000 | 对应标准的高分项目 |
| Best Multimodal UX | 2 | $5,000 | $1,000 | 对应标准的高分项目 |
| Honorable Mentions | 5 | $2,000 | $500 | 所有合格提交中的 runners-up |

每个项目最多获得一个奖项。奖金税费、汇兑及领取费用由获奖者承担。

---

## 五、本地项目对照：已有优势与硬缺口

以下是对三个指定本地文件的事实提取，不代表赛事官方判断。

### 5.1 已有能力

| 当前能力 | 本地证据 | 对评分的潜在价值（推断） |
| --- | --- | --- |
| 完整、多步骤工作流 | README 描述“采集 → 评分 → 证据预读 → 成稿 → 编辑 → 发布前检查 → 填入”；定时任务可在 Mac 恢复后补跑。 | 对 Taskmaster 的 40% 运营效用高度相关。 |
| 真实证据与失败边界 | Evidence Review、事实状态、弱证据阻断、来源图与授权状态、截图日志。 | 可以把“可信、不会静默越权”作为差异化，而不是只展示生成文本。 |
| 可恢复状态与审计 | 版本历史、运行快照、Provider / Skill、耗时、错误类别、重放 ID、结构化回执。 | 有利于 30% 架构纪律；可迁移为 Firestore 中的 run / evidence / approval state。 |
| 明确的人机边界 | 系统只填入编辑器，最终发布由用户点击；验证码、登录和网站改版会停止。 | 可解释为高风险动作的 approval gate，但 demo 必须证明审批前的完整任务是自动完成的。 |
| 可运行和经过验证 | 交付记录给出 120/120 后端与领域测试、11/11 前端测试、TypeScript / Vite build 和真实浏览器回归。 | 是 production readiness 的好底稿；赛事仍需要公开 repo、英文说明、云端部署证据和 4 分钟 demo。 |
| 技术迁移基础 | TypeScript、React、Express、Vite、持久化工作流，package scripts 已有 dev / build / start / test。 | 适合在不重写 UI 的前提下增加 Genkit / Vertex AI / Cloud Run 竞赛核心。 |

### 5.2 当前硬缺口

| 官方要求 | 指定文件中当前状态 | 结论 |
| --- | --- | --- |
| Gemini 3.5+ | README 只列 Codex、千问、DeepSeek、OpenAI API / compatible；package.json 无 Google AI 依赖。 | **未满足 / 至少没有证据。** |
| Google Agent Framework | package.json 未见 Google ADK、GenAI SDK、Antigravity SDK 或 Genkit。 | **未满足。** |
| Google Cloud infra | README 定位为 Mac 本地，数据保存在 `.workflow/`；无 Cloud Run / Firestore / Pub/Sub 部署说明。 | **未满足。** |
| New Projects Only | 只有 2026-08-13 交付日期，无法证明项目创建时间和 pre-existing 范围。 | **待核验，高风险。** |
| 英文产品 / 材料 | README 与交付记录为中文；指定文件没有英文 UI、英文 README 或字幕证据。 | **待补。** |
| Architecture diagram | 指定文件没有架构图。 | **缺失。** |
| 4 分钟公开 demo + GCP proof | 指定文件没有。 | **缺失。** |
| 可复现 cloud spin-up | README 仅有 `npm install` / `npm run dev` 和 Mac service；没有云端步骤。 | **不完整。** |

**Stage One 判断（推断）：当前版本原样提交会因三项强制技术缺失而不通过。** 但底层产品问题、工作流与可靠性基础足够好，做竞赛版比从零构思一个 agent 更有胜算。

---

## 六、建议方案：把它包装成真正的 Taskmaster

### 6.1 一句话定位

> An autonomous newsroom duty desk that turns a scheduled brief into a sourced, rights-aware, ready-to-publish story package — with evidence and approval gates built in.

不要把项目讲成“Gemini 写新闻”。真正的动作链应是：监听事件、抓取多源信息、判断是否值得跟进、把事实分级、过滤版权不明图片、生成可审计发布包、写入编辑器并通知用户；最终发布按钮仍由人掌控。

### 6.2 最小而有竞争力的云端架构

这是建议，不是已实现事实：

```text
Cloud Scheduler / Pub/Sub event
            ↓
Cloud Run: Taskmaster controller (TypeScript + Genkit)
            ↓
Gemini 3.5 Flash via Vertex AI
  ├─ source discovery / routing tool
  ├─ evidence extraction + cross-check tool
  ├─ news-value decision tool
  ├─ rights-aware media selection tool
  └─ publishing-package / editor action tool
            ↓
Firestore: run, evidence, approval, feedback, retry state
            ↓
React newsroom UI / Chrome fill helper
            ↓
Human approval for final publication
```

为什么这样选：

- **Genkit** 是赛事列出的合格框架，且 Resources 明确提供 JS 路径，和当前 TypeScript / Express 栈接近。[官方 Genkit 文档](https://firebase.google.com/docs/genkit)
- **Cloud Run** 能直接承载 Node 服务并提供可演示的 `.run` URL；**Firestore** 适合保存 run / evidence / approval 状态；**Pub/Sub** 让“定时或新来源事件 → 自主路由”有清楚的动作证据。[Cloud Run](https://cloud.google.com/run) · [Firestore](https://cloud.google.com/firestore) · [Resources](https://allthingsagentichackathon.devpost.com/resources)
- 用 **Vertex AI 上的 Gemini 3.5 Flash** 可同时满足模型要求并在 Cloud Console / logs 中展示真实调用证据。[Gemini API / AI Studio](https://ai.google.dev/) · [Resources](https://allthingsagentichackathon.devpost.com/resources)

### 6.3 4 分钟 demo 应展示的唯一主线

1. **0:00–0:30：真实摩擦。** 每天编辑要盯多个源、辨真假、找图、起稿、复制到编辑器；漏掉证据或版权会造成真实风险。
2. **0:30–0:50：一张架构图。** 点明 Gemini 3.5 Flash、Genkit、Cloud Run、Pub/Sub、Firestore。
3. **0:50–2:40：一次未剪切的 live run。** 触发 Pub/Sub 事件；agent 自动采集、路由、生成 Evidence Review、拒绝一条弱证据或版权不明素材、把合格内容写入草稿 / 编辑器。全程不靠聊天逐步指挥。
4. **2:40–3:25：可信与失败恢复。** 展示事实状态、Provider / Skill snapshot、重试或被阻断原因、最终人工 approval gate。
5. **3:25–3:50：GCP proof。** 打开 Cloud Run revision / URL、Vertex AI 或 Cloud logs、Firestore 中的 run state。
6. **3:50–4:00：价值结果。** 用一组真实但可验证的指标收尾，例如从触发到可审稿包的时间、自动完成的步骤数、阻止的风险项；没有测量的数据不要口头夸大。

### 6.4 竞争策略

- **主攻 Taskmaster + Individual/Hobbyist。** 如果以已注册公司参赛，才同时满足 Startup Excellence 条件；每个项目最终最多获一个奖。
- **把 Best Architectural Design 当自然副目标。** 现有证据等级、授权记录、状态机、失败回执、密钥边界和日志比一般周末 demo 扎实，迁移到云端后可形成可信故事。
- **Best Multimodal UX 可争取但不是主线。** 截图 / 链接 Evidence Review、真实裁图和图像授权状态是现成差异点；不要为了多模态奖临时堆一个无关的图像生成器。
- **bonus 先拿容易的 0.4。** 公开发布一篇 build log 和一条带正确 hashtag 的社交帖。Gemma / Veo / Lyria 只有能承担真实工具职责时再接；无意义集成可能损害 30% 架构评分。

---

## 七、从 2026-08-17 到截止的执行顺序（建议）

| 上海日期 | 必须完成的交付 |
| --- | --- |
| 8/17–8/18 | 核验个人 / 团队资格与项目创建历史；注册 Devpost；立即申请 Cloud credits；确定 Taskmaster；写 pre-existing disclosure。 |
| 8/18–8/21 | 冻结竞赛范围；完成 Genkit + Gemini 3.5 Flash 的最小 agent；让 Cloud Run 接受一次真实事件并产出结构化 run。 |
| 8/21–8/24 | 接 Firestore 状态和 Pub/Sub / Scheduler；把现有证据、图片权利与发布包动作接到云端编排。 |
| 8/24–8/26 | 做英文 UI / English README、架构图、一键或逐步部署；准备不依赖第三方账号的 judge demo mode。 |
| 8/26–8/28 | 端到端压力 / 失败测试；录制一次不剪切的 4 分钟以内 demo，并包含 Cloud Run / Vertex / Firestore 证据。 |
| 8/28–8/30 | 公开 build article + social post；完成 Devpost 英文 description、数据源与 pre-existing disclosure；让外部人员照 README spin up。 |
| 8/30–8/31 | 冻结 tag / release，检查私有仓库授权、视频公开性、字幕、所有链接和测试凭据；至少提前 12 小时提交，不把 2026-09-01 08:00 当操作时间。 |

### 最终 go / no-go 门槛

在录制 demo 前必须同时满足：

- [ ] 能证明竞赛核心是在 Submission Period 内新建，所有 pre-existing work 已披露；若范围有争议，已有官方书面答复。
- [ ] Gemini 3.5+、一个合格 Google Agent Framework、一个 Google Cloud infra service 三项都在代码、部署和视频中可验证。
- [ ] 单次无剪切运行能完成至少三个真实动作，而不是只返回文本。
- [ ] Google Cloud 运行证据、architecture diagram、英文 README / UI / 字幕齐全。
- [ ] repo、demo 数据、新闻图片与第三方服务均有合法使用依据。
- [ ] Devpost 提交表、公开视频、仓库权限和所有 URL 经非作者实际打开验证。

若第一项无法确认，或三项强制技术在 8/24 前仍没有端到端运行，建议不拿当前项目冒资格风险；其余缺口则都属于可在剩余时间内收敛的工程与提交工作。

---

## 官方来源索引

- [All Things Agentic Hackathon — Contest homepage](https://allthingsagentichackathon.devpost.com/)
- [All Things Agentic Hackathon — Official Rules](https://allthingsagentichackathon.devpost.com/rules)
- [All Things Agentic Hackathon — FAQ](https://allthingsagentichackathon.devpost.com/details/faqs)
- [All Things Agentic Hackathon — Resources](https://allthingsagentichackathon.devpost.com/resources)
- [Google Genkit](https://firebase.google.com/docs/genkit)
- [Google Cloud Run](https://cloud.google.com/run)
- [Google Cloud Firestore](https://cloud.google.com/firestore)
- [Google Gemini API / AI Studio](https://ai.google.dev/)
