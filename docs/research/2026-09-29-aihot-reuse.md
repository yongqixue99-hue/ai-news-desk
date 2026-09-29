# AIHOT 复用审查：聚合阅读、选题与采集可靠性

实施进展：本研究后的第一批改进已完成，具体变化、验证和剩余范围见 [AIHOT 第一批吸收](../2026-09-29-aihot-adoption.md)。下文保留研究阶段的对照与判断。

审查日期：2026-09-29。外部代码固定为 [`KKKKhazix/AIHOT@589f79eff09470b31ba8a7f1d9eb62d36ff2be6c`](https://github.com/KKKKhazix/AIHOT/tree/589f79eff09470b31ba8a7f1d9eb62d36ff2be6c)。本节依据该提交源码、迁移和测试文件，以及新闻台当前源码；没有安装、启动或执行 AIHOT，也没有修改新闻台产品代码、配置或 `.workflow`。下文“已有测试”指仓库含有测试案例，不代表本轮执行通过。

## 结论与推荐范围

最先值得接入的是现有公开事件接口尚未使用的摘要与最新进展；最先值得借鉴的运行机制是完整请求截止时间与分阶段失败隔离。阅读回位、摘要主体与文章类型检查属于低成本的小模块。自适应轮询、人工选题评测、事件进展关系和健康感知趋势放在第二批。

我们已经接入 AIHOT 精选、热榜、推荐理由和事件报道链接，也已有 Story 去重、证据冻结与编辑质量门，不能把这些包装成开源后才有的新能力。直接复用主要有三种：消费现成公开接口；提取独立函数、规则和回归场景；将依赖它的数据库与队列的机制改写到现有模块。后者不是即插即用。

公开仓库仅有 18 个海外 AI 示范信源，未提供完整运营信源名单；OpenAI、DeepMind、TechCrunch、Ars、Simon Willison、AWS、Microsoft Research 等入口在我们的默认配置中已有覆盖。来源配置可做补漏清单，不能假定克隆就获得线上站点的全部覆盖。X、公众号等采集适配器也可能依赖需另配密钥的第三方服务。[示范来源](https://github.com/KKKKhazix/AIHOT/blob/589f79eff09470b31ba8a7f1d9eb62d36ff2be6c/industry/sources.json)、[开源范围说明](https://github.com/KKKKhazix/AIHOT/blob/589f79eff09470b31ba8a7f1d9eb62d36ff2be6c/README.md)、[本地来源配置](../../server/defaults.ts)

## 采集可靠性专项结论

最值得借鉴的是 **贯穿 DNS、跳转与响应体的请求截止时间，以及按来源、正文提取阶段分开的工作单元**。它们直接对应新闻台已发现的长任务挂起问题。自适应轮询可以随后小范围试验；新闻台现有 RSS 缓存、取消、失败退避和 SQLite 持久任务已有实质实现，不需要因外部项目开源就再造一套。

建议保留新闻台的 Node 22、SQLite、本地单用户和人工最终发布边界，迁移机制或小模块。AIHOT 根配置要求 Node ≥24.11，后端依赖 PostgreSQL、pg-boss 和 undici 8；不能将它的源码文件直接视为兼容当前运行时的可插拔依赖。[AIHOT package.json](https://github.com/KKKKhazix/AIHOT/blob/589f79eff09470b31ba8a7f1d9eb62d36ff2be6c/package.json)、[后端依赖](https://github.com/KKKKhazix/AIHOT/blob/589f79eff09470b31ba8a7f1d9eb62d36ff2be6c/packages/backend/package.json)、[新闻台 package.json](../../package.json)、[产品合同](../mature-personal-product.md)

## 逐项源码核查

| 范围 | AIHOT 实际实现 | 新闻台实际实现 | 复用判断 |
| --- | --- | --- | --- |
| 采集工作单元 | `collectSource` 单独记录 `fetch_runs`，先存材料，再为新增或修订材料排正文提取／分析；普通后续采集每源最多 60 条，首轮回填另外限额；详情页按 `maxFetches` 预算补缺字段 | `SourceDesk.collect` 分结构源、社区、X 三组并行，聚合为一个批次，失败按源返回；`executeCollection` 仍把整批采集、评分、前 18 条提图和速读串在同一个 collect-run 中 | 学“逐源完成、后续可独立失败”，不替换已有事实与素材包模型 |
| 调度 | 每分钟调度到期源，默认批次 40，以来源 ID 作 singleton key；成功后才推进游标；预算耗尽不会增加源失败次数 | `dueOfficialSources`／`dueDiscoverySources` 只读用户已启用且选中的来源；官方 RSS 默认小时级，技术文档 12 小时；失败使间隔扩大至最多 8 倍 | 现有开关、选源与角色边界应保留；可补每源下一次读取和排队状态 |
| 自适应频率 | 每天根据最近 7 天非回填新增文章量调整间隔；普通编辑源 15–60 分钟，付费 X／Jina 上限 120 分钟，热点信号上限 180 分钟；Jina 不快于每小时；X 分片另走固定节奏 | 全局小时级设置加连续失败退避；重点官方源排序优先，未按近期更新频率自动调节 | 可借鉴统计与上下限，不能按发文量降低低频重要官方公告的最低覆盖 |
| 队列与停机 | pg-boss 配不同队列的过期和重试设置：来源 600 秒、正文提取 300 秒、分析 600 秒、翻译 900 秒；正文提取独立排队；关机发共享信号，允许在途调用完成，最长等待 195 秒 | SQLite 租约、幂等 key、退避、前后台并发、重启恢复已有；`JobDesk` 只等 handler，自主心跳不证明业务在推进，stop 仅停轮询 | 学不同工作的截止时间和停机边界，不为此换数据库；配置过期不等于证明所有底层调用都会停止 |
| HTTP 时间界限 | `guardedFetch` 创建一次 deadline，DNS 验证通过 `withinDeadline` 等待；同一信号贯穿所有重定向与响应体；默认 20 秒、8 MB、最多 5 次跳转；每次跳转复查目标 | `fetchRemote` 在 URL／DNS 校验后才把调用者信号交给 fetch；DNS `lookup` 不受该信号约束；`probeImages` 没有把任务取消信号传给 `extractPage`，也没有阶段总时限 | 最高优先级借鉴；应补到现有出站边界，继续保留地址与图片校验 |
| RSS 与缓存 | RSS validator 绑定源配置 hash 和最终响应 URL；目标变化时不接受旧 304，首次有限回填后暂不保存 validator；保存成功才推进 cursor。另有 DB 查询的进程内 stale-while-revalidate 缓存 | `source-route-cache.ts` 已有 ETag／Last-Modified、异常 304 重读、配置维度 key、304 不改事件日期、Retry-After、每域 2 并发、64 条／8 MB 总容量／2 MB 单条、持久退避和取消 | 当前缓存应继续使用；补配置过滤语义和跳转目的地的差分案例即可。两类缓存用途不同，不能直接互换 |
| 付费调用预算 | 每个逻辑请求先存 receipt，每次实发另存 attempt；在事务锁内按服务检查分钟／小时／天次数，恢复可复用已收到的原始响应；未知结果与明确拒绝分开处理 | `provider-runtime.ts` 有超时与有限重试，`ai-run-observability.ts` 有 attempt、错误、token／cost 和 replay 记录；本次核查的这两个模块没有同等的按服务事务预算入口 | 未来新增付费采集时可复用这种记账模型；不需要先复制所有管理界面 |

表格外部依据：[采集与调度 collect.ts](https://github.com/KKKKhazix/AIHOT/blob/589f79eff09470b31ba8a7f1d9eb62d36ff2be6c/packages/backend/src/sources/collect.ts)、[队列定义 queue.ts](https://github.com/KKKKhazix/AIHOT/blob/589f79eff09470b31ba8a7f1d9eb62d36ff2be6c/packages/backend/src/jobs/queue.ts)、[采集 worker](https://github.com/KKKKhazix/AIHOT/blob/589f79eff09470b31ba8a7f1d9eb62d36ff2be6c/packages/backend/src/jobs/sources.ts)、[定时任务](https://github.com/KKKKhazix/AIHOT/blob/589f79eff09470b31ba8a7f1d9eb62d36ff2be6c/apps/worker/src/schedules.ts)、[出站 HTTP](https://github.com/KKKKhazix/AIHOT/blob/589f79eff09470b31ba8a7f1d9eb62d36ff2be6c/packages/backend/src/lib/http-fetch.ts)、[RSS](https://github.com/KKKKhazix/AIHOT/blob/589f79eff09470b31ba8a7f1d9eb62d36ff2be6c/packages/backend/src/sources/rss.ts)、[查询缓存](https://github.com/KKKKhazix/AIHOT/blob/589f79eff09470b31ba8a7f1d9eb62d36ff2be6c/packages/backend/src/lib/cache.ts)、[付费回执](https://github.com/KKKKhazix/AIHOT/blob/589f79eff09470b31ba8a7f1d9eb62d36ff2be6c/packages/backend/src/providers/receipts.ts)。

表格本地依据：[server/source-desk.ts](../../server/source-desk.ts)、[server/official-source-monitor.ts](../../server/official-source-monitor.ts)、[server/horizon.ts](../../server/horizon.ts)、[server/job-desk.ts](../../server/job-desk.ts)、[server/local-database.ts](../../server/local-database.ts)、[server/remote-url.ts](../../server/remote-url.ts)、[server/extractor.ts](../../server/extractor.ts)、[server/source-route-cache.ts](../../server/source-route-cache.ts)、[server/provider-runtime.ts](../../server/provider-runtime.ts)、[server/ai-run-observability.ts](../../server/ai-run-observability.ts)。

### 需要区别对待的实现细节

- **超时应覆盖等待边界。** AIHOT 显式说明 DNS 本身不能取消；`withinDeadline` 保证超时后不再继续 fetch，并不意味着终止操作系统的 DNS 工作。新闻台应同时让失败返回、取消传播和迟到写入守卫生效，不能仅用 `Promise.race` 后让后台任务继续改稿或覆盖候选。[http-fetch.ts](https://github.com/KKKKhazix/AIHOT/blob/589f79eff09470b31ba8a7f1d9eb62d36ff2be6c/packages/backend/src/lib/http-fetch.ts)、[新闻台 remote-url.ts](../../server/remote-url.ts)、[horizon.ts](../../server/horizon.ts)
- **来源队列失败和业务失败不总是同一状态。** AIHOT `collectSource` 捕获异常后写失败的 fetch_run 和下次读取时间，并返回 `status: failed`；来源队列配置 `retryLimit: 0`，后续重试主要由来源调度负责。不能只看队列是否完成来展示“采集成功”。[collect.ts](https://github.com/KKKKhazix/AIHOT/blob/589f79eff09470b31ba8a7f1d9eb62d36ff2be6c/packages/backend/src/sources/collect.ts)、[queue.ts](https://github.com/KKKKhazix/AIHOT/blob/589f79eff09470b31ba8a7f1d9eb62d36ff2be6c/packages/backend/src/jobs/queue.ts)
- **预算是实发次数上限，不是货币金额的绝对上限。** AIHOT 的分钟／小时／天计数按 attempts 累计，重试也算；源码另外记录费用。它会在未知结果超过 30 分钟后自动放行一次，且没有先核对供应商账单。此策略不能直接用于我们的最终发布或结果未知的微信草稿写入。[receipts.ts](https://github.com/KKKKhazix/AIHOT/blob/589f79eff09470b31ba8a7f1d9eb62d36ff2be6c/packages/backend/src/providers/receipts.ts)、[admin/runs.ts](https://github.com/KKKKhazix/AIHOT/blob/589f79eff09470b31ba8a7f1d9eb62d36ff2be6c/packages/backend/src/admin/runs.ts)、[新闻台 primary-delivery.ts](../../server/primary-delivery.ts)
- **读页面的旧缓存不应变成新的事实核验。** AIHOT 的 `cached()` 用于站点统计、栏目、报告、sitemap 等数据库读模型；新闻台可以在同类展示上考虑单次刷新，但素材包、图片有效性和平台交付仍应使用当前版本校验。现有路由缓存已经保存真实最近校验时间并保留原始事件日期。[cache.ts](https://github.com/KKKKhazix/AIHOT/blob/589f79eff09470b31ba8a7f1d9eb62d36ff2be6c/packages/backend/src/lib/cache.ts)、[site/stats.ts](https://github.com/KKKKhazix/AIHOT/blob/589f79eff09470b31ba8a7f1d9eb62d36ff2be6c/packages/backend/src/site/stats.ts)、[新闻台 source-route-cache.ts](../../server/source-route-cache.ts)

## 运行基础设施专项顺序与可验证目标

以下是运行基础设施专项的研究建议，本轮未实施移植；完整产品顺序见文末。

| 优先级 | 建议 | 在新闻台的落点 | 验收标准 |
| --- | --- | --- | --- |
| P0 | 统一请求 deadline，并为提图／整轮采集增加有界退出和取消传播 | `remote-url.ts`、`extractor.ts`、`horizon.ts`、`job-desk.ts` | DNS 永不返回、慢重定向、响应体只发一半、睡眠恢复四种夹具均能结束；单篇图失败不拖住其他候选；超时后的旧工作不能再写当前 run |
| P1 | 将来源读取和正文／原图补齐分开记录进度及恢复位置 | 保留 SQLite JobDesk，在 SourceDesk 或现有补图任务上分步；不新增 PostgreSQL 服务 | 某来源卡住时其他来源完成可见；重启不以当前时间窗覆盖旧 run 的候选快照；界面显示真实卡住阶段，而非常驻 3% |
| P2 | 对少量已启用来源试行自适应轮询 | `official-source-monitor.ts` 增每源统计与下一次读取原因 | 固定回放对比请求次数与新公告发现延迟；低频官方源保持最大等待保证；用户关闭自动读取后不再产生新任务 |
| P3 | 有新增付费采集需求时，引入服务级 attempts 预算和恢复复用 | 复用 `provider-runtime.ts`、`ai-run-observability.ts` 与 SQLite 事务 | 并发请求不超预算，重试也计数；已保存响应重启后不重复收费请求；暂停服务不被计作上游源故障；结果未知保持可解释 |

可借鉴的现成测试场景包括 AIHOT 的完整重定向链单一超时、RSS 首次回填后正常窗口／配置改变／跳转改变、重试也耗预算，以及停机中的付费调用收尾。新闻台已经拥有 RSS 缓存取消、容量、304、退避和重启读取回归，应该在已有测试边界补差异，而非整套重写。[media-performance.test.ts](https://github.com/KKKKhazix/AIHOT/blob/589f79eff09470b31ba8a7f1d9eb62d36ff2be6c/tests/media-performance.test.ts)、[rss-conditional.test.ts](https://github.com/KKKKhazix/AIHOT/blob/589f79eff09470b31ba8a7f1d9eb62d36ff2be6c/tests/rss-conditional.test.ts)、[receipts.test.ts](https://github.com/KKKKhazix/AIHOT/blob/589f79eff09470b31ba8a7f1d9eb62d36ff2be6c/tests/receipts.test.ts)、[analyze-shutdown.test.ts](https://github.com/KKKKhazix/AIHOT/blob/589f79eff09470b31ba8a7f1d9eb62d36ff2be6c/tests/analyze-shutdown.test.ts)、[新闻台 source-route-cache.test.ts](../../server/source-route-cache.test.ts)

## 复制代码、署名与品牌边界

该固定提交的 `LICENSE` 是 MIT，版权行为“2026 数字生命卡兹克”；许可文本要求在软件副本或实质部分中保留版权及许可声明。如果后续直接复制实质源码，具体交付应记录来源提交和所改文件，并随分发保留该许可声明；本轮只有研究文档，没有引入外部源码。[LICENSE](https://github.com/KKKKhazix/AIHOT/blob/589f79eff09470b31ba8a7f1d9eb62d36ff2be6c/LICENSE)

`NOTICE` 另行说明 AIHOT 名称与标志不在 MIT 授权内，要求使用自己的站点名称和标志。Noto Sans SC 字体、模型／厂商标志、评测机构标志另有各自声明；示例来源的文章内容仍属于原发布者。因而代码复用、品牌复用、正文与图片使用是三件独立的事：新闻台继续使用自己的名称与图标，不能从“仓库是 MIT”推断示例文章和配图都能再发布。以上只摘录该提交的文件要求，不作泛化法律结论。[NOTICE](https://github.com/KKKKhazix/AIHOT/blob/589f79eff09470b31ba8a7f1d9eb62d36ff2be6c/NOTICE)

## 本次验证边界

本轮进行了固定提交源码阅读与本地实现对照，未测吞吐、线上覆盖率、真实付费额度或长时间稳定运行。AIHOT 的队列过期、优雅停机、适应间隔和预算代码存在，不等于已经验证迁入新闻台后就能解决全部故障。实施时应先做小范围失败夹具和差分验收。

## 聚合、选题和界面：其余源码对照

以下结论同样基于 `589f79eff09470b31ba8a7f1d9eb62d36ff2be6c`，不依赖 README 的效果宣称。

### A. 第一批：把已经接上的事件接口用完整

本地 `server/aggregation-native.ts` 已用匿名 v1 热榜、最近 7 天精选和事件详情；`parseAihotStoryRelations` 只保存了 reports 的原文 URL。外部事件详情还提供 `digest/latest/digestUpdatedAt/sourceCount/reportCount/firstReportAt`。适配这些字段，可以在现有聚合列表展示“发生了什么 / 最新进展 / 展开其他报道”，不需要新增数据库服务或模型调用。

2026-09-29 实际只读请求确认：热榜返回 schemaVersion=1、10 项；抽查一个事件详情，确有 digest、latest、reports、storyline、related 字段。此验证确认接口形状及样本可用，不代表所有事件都具备完整摘要，也不是内容事实核验。

落点：`server/aggregation-native.ts` → `server/aggregation-desk.ts` → `src/components/AggregationsPage.tsx`。摘要需标明 AIHOT，缺字段时回退现有摘要；来源数量只表示平台收录，不是本地独立事实证实数。related/storyline 不当 reports 强制合并。外部 v1 只公开名次和计数，不返回内部 heat/trendPct 曲线。

来源：[v1 事件返回结构](https://github.com/KKKKhazix/AIHOT/blob/589f79eff09470b31ba8a7f1d9eb62d36ff2be6c/packages/backend/src/publication/stories.ts#L274)、[实时公开接口合同](https://aihot.news/openapi-v1.json)、[本地既有接入说明](../2026-09-20-aggregation-ranking.md)。

### B. 第一批：借阅读回位，不搬整套视觉

外部 `restore.ts` 保存卡片锚点和偏移，`session-cache.ts` 合并写入会话缓存，`ReadingGroup.tsx` 保留展开内容与加载分页，并在筛选变化后丢弃旧请求。我们聚合页的筛选、分页 limit 只存在组件 useState；App 切页会卸载它，所以离开再返回会丢状态。

适配卡片锚点、筛选和已展开条目状态即可。保留本项目红白风格：默认只呈现标题、短摘要、最新进展和“留作选题”，报道来源、时间详情和来源健康信息折叠。刷新应取新数据，浏览返回才恢复阅读位置；不要缓存用户凭据或完整正文。

来源：[restore.ts](https://github.com/KKKKhazix/AIHOT/blob/589f79eff09470b31ba8a7f1d9eb62d36ff2be6c/apps/web/app/features/feed/restore.ts)、[session-cache.ts](https://github.com/KKKKhazix/AIHOT/blob/589f79eff09470b31ba8a7f1d9eb62d36ff2be6c/apps/web/app/features/feed/session-cache.ts)、[ReadingGroup.tsx](https://github.com/KKKKhazix/AIHOT/blob/589f79eff09470b31ba8a7f1d9eb62d36ff2be6c/apps/web/app/features/feed/ReadingGroup.tsx)。本地：`src/components/AggregationsPage.tsx`、`src/App.tsx`。

### C. 第一批：增加摘要主体和文章类型检查

外部 `enforceIdentity` 检测新摘要引入原输入没有的公司主体，失败时回退或舍弃；标题规则要求 How/Guide/Review 不得变成“发布/上线”。可抽取这两类确定性规则和反例，补进本地 `parseCandidateBriefings`。不需要额外模型调用，也不改用户编辑过的稿件。

注意：外部实现的公司词表有限；来源域名不自动等于事件参与者。我们已有冻结事实、数字、日期、阶段和关系校验，不能用这个词表替代。大部分“不要补事实”规则已经存在，新增重点是文章类型保真、虚增主体及“首次/唯一”等范围强化的回归案例。

来源：[writing.ts](https://github.com/KKKKhazix/AIHOT/blob/589f79eff09470b31ba8a7f1d9eb62d36ff2be6c/packages/backend/src/editorial/writing.ts#L188)、[标题保真规则](https://github.com/KKKKhazix/AIHOT/blob/589f79eff09470b31ba8a7f1d9eb62d36ff2be6c/industry/prompts/rules-self-contained-title.md#L8)、[防幻觉规则](https://github.com/KKKKhazix/AIHOT/blob/589f79eff09470b31ba8a7f1d9eb62d36ff2be6c/industry/prompts/rules-anti-hallucination.md#L10)。

### D. 第二批：用真实取舍校准选题

SelectBench 有人工“选/不选”金标、TP/FP/FN/TN、precision/recall/F1、阈值扫描和模型成本统计。可复用纯指标函数、报告结构和错例分类，接本地 `candidateScore → buildStories → buildTodayView`，先做离线评测。

我们已有编辑黄金集和发现回放，不缺通用测试；缺的是针对用户实际选题偏好的标注评测。公开仓库只有两条示例金标，不能拿其示例数据证明对我们有效。建议从历史“留作选题/忽略”中整理候选，经人工确认后形成金标，不自动把没点击视为不喜欢。

AIHOT 的双评分实际是同一个模型、同一个提示词请求两次，并非双模型事实互审；连同预筛、结构化和摘要，正常完整路径约五次模型调用。不建议直接全量复制，最多先旁路抽样比较。外部 T1/T2 阈值不能原封不动成为我们的事实可信度。

来源：[指标与阈值扫描](https://github.com/KKKKhazix/AIHOT/blob/589f79eff09470b31ba8a7f1d9eb62d36ff2be6c/scripts/eval-selection.ts#L96)、[SelectBench](https://github.com/KKKKhazix/AIHOT/blob/589f79eff09470b31ba8a7f1d9eb62d36ff2be6c/packages/backend/src/admin/selectbench.ts#L77)、[runScores](https://github.com/KKKKhazix/AIHOT/blob/589f79eff09470b31ba8a7f1d9eb62d36ff2be6c/packages/backend/src/editorial/analyze.ts#L214)。

### E. 第二批：区分同一事实、后续进展和相关事件

AIHOT 的关系分类区分 SAME_OCCURRENCE、SAME_STORY、UNRELATED、ROUNDUP；有人工纠错优先、事件摘要输入指纹和更正后重写记录。我们已有 URL、版本、时间窗、标题相似度和全组一致性的保守去重，不需要换掉。更值得增加“同一事件线的后续进展”关系，使发布、测评、价格变化能够一起阅读，但不被合成同一个事实。

可复用关系枚举、规则和测试思路；数据库、模型与任务队列适配给本地 StoryDesk。事件摘要及更正记录独立于草稿，已有 ContentPackage 保持冻结。不是所有外部归并都经过双模型复核，不能把开源实现直接当正确性证明。

来源：[关系分类](https://github.com/KKKKhazix/AIHOT/blob/589f79eff09470b31ba8a7f1d9eb62d36ff2be6c/packages/backend/src/events/relate.ts#L125)、[归并实现](https://github.com/KKKKhazix/AIHOT/blob/589f79eff09470b31ba8a7f1d9eb62d36ff2be6c/packages/backend/src/events/group.ts#L660)、[摘要输入指纹与更正](https://github.com/KKKKhazix/AIHOT/blob/589f79eff09470b31ba8a7f1d9eb62d36ff2be6c/packages/backend/src/events/digest.ts#L31)。

### F. 第二批：让热度考虑采集是否完整

外部热度计算结合来源覆盖、独立参与者、时间衰减和缺失采集小时。我们 `story-desk.ts` 的趋势主要来自一个讨论的前后两次互动快照，适合增加“覆盖不足 / 暂无法判断”，避免采集失败被显示成降温。

借思路和纯函数，SQL 与存储要重写。不要直接复制全部公式：源码审查推断，hot.ts 当前 obs 只取最近 48 小时，却同时计算 6 小时前的 48 小时基线；这样可能漏掉当前距今 48–54 小时的基线样本。此为静态源码推断，未运行其数据库复现。来源独立性也依赖人工 signal_group_id，不能直接当事实独立确认。

来源：[hot.ts](https://github.com/KKKKhazix/AIHOT/blob/589f79eff09470b31ba8a7f1d9eb62d36ff2be6c/packages/backend/src/events/hot.ts#L37)。

### G. 有长期精选库需求时，再接增量同步

AIHOT 已提供 selected/snapshot 与 selected/changes，包含新增、修改、移除和游标失效后的重建协议。我们当前最近 7 天、最多 100 条的浏览快照是既有产品范围，不必为了开源而导入完整历史库。以后需要持续跟踪精选修订、撤回和断点同步时，才接这两个接口。

同步应先事务应用一页变化，再提交游标；上游撤回只影响平台收录状态，不删除本地用户草稿、证据快照或编辑记录。我们的热榜/精选已使用 v1，不存在需要从旧 api/public 紧急迁移的问题。

来源：[同步协议源码](https://github.com/KKKKhazix/AIHOT/blob/589f79eff09470b31ba8a7f1d9eb62d36ff2be6c/packages/backend/src/publication/v1.ts#L119)、[实时 OpenAPI](https://aihot.news/openapi-v1.json)。

## 建议落地顺序与验收

1. **先做用户马上能感觉到的变化**：已有事件摘要/最新进展字段 → 阅读回位 → 采集总超时与部分结果返回 → 摘要主体和类型回归。
2. **再提高选择质量与效率**：自适应轮询、真实选题金标、进展关系、采集健康参与趋势。
3. **保持现有写稿与交付体系**：本仓库没有可以直接替代我们小黑盒/头条/百家号草稿交付的成品适配器。本轮结论主要改善发现、阅读和选题，不应包装成已解决发布链路。

验收围绕实际问题：事件缺字段也能读；同一事件后续进展不冒充新发布；返回列表不丢位置；任一源超时不拖死整次采集；旧模型摘要不凭空增加公司；选题改善有人工标注对照。若移植代码，先补回归测试，再运行本项目要求的测试、编辑评测与构建。

本次仅研究、只读请求公开接口并保存此文档。没有安装或执行 AIHOT、没有修改产品代码、没有更改本地用户数据；未宣称已经完成接入或验证了其生产效果。
