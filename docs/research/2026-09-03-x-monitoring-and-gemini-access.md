# X 重点账号监控与 Gemini 直接接入调研

> 初始调研：2026-09-03；最终复核：2026-09-04（Asia/Hong_Kong）
> 范围：X 官方 API、可借鉴的 GitHub 项目、Google AI Pro 与 Gemini API 的授权/计费边界，以及浏览器自动化和非官方反代的风险。
> 证据口径：能力、价格和条款优先采用厂商官方文档；开源项目只采用其 GitHub 仓库、源码、许可证和 issue。本文只做调研，不修改代码或运行配置。

## 结论先行

1. **重点账号可以被正式监控，不需要抓网页。** 对一组已经核验的公开账号，首选 [X Activity API](https://docs.x.com/x-api/activity/introduction) 按稳定 `user_id` 订阅 `post.create` / `post.delete`；本地应用可直接保持 persistent HTTP stream。用 [Recent Search](https://docs.x.com/x-api/posts/search/introduction) 的 `since_id` 分页做首次补抓、断线恢复和低成本轮询。只有需要“账号 + 关键词 + 语言 + 媒体”等复合规则时，才增加 [Filtered Stream](https://docs.x.com/x-api/posts/filtered-stream/introduction)。
2. **今晚若已有 X Developer App、Bearer Token 和余额，最实际的上线顺序是 Recent Search 轮询 → 补齐分页和游标 → 再接 X Activity 长连接。** Recent Search 覆盖最近 7 天，每页最多 100 条；每 3–5 分钟轮询一组 `from:` 查询已经足够接近实时，同时保留可恢复性。若没有官方凭证，今晚只能把 X 当人工发现渠道，并继续监控厂商官网、GitHub Releases、博客/RSS；不要临时上 cookie 抓取器冒充可靠监控。
3. **GitHub 上没有“免费、长期稳定、低风险”的 X 抓取捷径。** [RSSHub](https://github.com/DIYgod/RSSHub) 很适合借鉴路由、缓存和 RSS 输出，也能配置官方 X API；但它的 X Web 模式、[twscrape](https://github.com/vladkens/twscrape)、[Nitter](https://github.com/zedeus/nitter) 和其他内部 GraphQL 抓取器都依赖账号 cookie、访客令牌或未公开接口，会受到接口哈希变化、Cloudflare、验证码和封号影响。它们最多是研究/应急参考，不能作为本产品的生产事实通道。
4. **Google AI Pro 会员与 Gemini API 不是同一份配额。** Google AI Pro 提供 Gemini 网页/App、AI Studio 的更高交互限额，以及 Google Developer Program Premium 等会员权益；程序化 Gemini API 则由 API key 所属的 Google Cloud project、Cloud Billing 和 API usage tier 单独管理。[Google AI plans](https://one.google.com/about/google-ai-plans/) [Gemini API billing](https://ai.google.dev/gemini-api/docs/billing)
5. **文章无需等浏览器页面“回复完”再抓取。** `gemini-3.8-flash` 有正式 [Gemini API 模型页](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash)，可以通过 SDK 或 `generateContent` / 流式接口直接返回文章。[官方 REST 示例](https://ai.google.dev/gemini-api/docs/generate-content/latest-model) 只需服务端持有合法 API key。Google AI Pro 自带的每月 Cloud credit 可能抵扣符合条件的 Cloud 用量，但必须领取并绑定 billing account，不能理解成“Pro 会员自动包含不限量 Gemini API”。
6. **“反代”要分清两件事。** 在自己的后端保存官方 `GEMINI_API_KEY`、由后端调用正式 Gemini API，是正常而且推荐的密钥隔离；反代 Gemini 消费者网页、复用登录 cookie 或自动化网页取答案，则依赖未承诺的页面协议，带来凭证泄露、条款、模型版本和可审计性风险，不应进入产品主链路。

## 1. X 官方能力：白名单账号怎么监控

### 1.1 推荐的三层通道

| 通道 | 最适合的场景 | Self-serve 主要边界 | 在本项目中的位置 |
| --- | --- | --- | --- |
| [X Activity API](https://docs.x.com/x-api/activity/introduction) | 固定的一组重点公开账号，需要尽可能快地收到发帖、删帖和资料更新 | 公开事件可用 App-only Bearer；最多 1,500 个订阅；可用 persistent HTTP stream 或 webhook | **实时主通道** |
| [Recent Search](https://docs.x.com/x-api/posts/search/introduction) | 首次回填、断线补漏、小规模低复杂度轮询 | 最近 7 天；100 条/页；self-serve 查询最长 512 字符；支持 `from:`、`since_id` 和分页 | **恢复与保底通道** |
| [Filtered Stream](https://docs.x.com/x-api/posts/filtered-stream/introduction) | 账号之外还要叠加关键词、链接、语言、媒体等规则 | 1 个连接、最多 1,000 条规则、每条 1,024 字符、250 Posts/s；官方当前标注约 4–5 秒 P99 | **可选的规则降噪通道** |

[X 当前速率表](https://docs.x.com/x-api/fundamentals/rate-limits)还给出：Recent Search 每 App 450 次/15 分钟；Filtered Stream 50 次连接尝试/15 分钟；X Activity stream 450 次连接尝试/15 分钟、最多 2 个连接；Activity subscription 管理为 500 次/15 分钟。这些是连接或请求边界，不等于免费读取配额。

推荐拓扑：

```text
X Activity: post.create / post.delete
              │
              ├─ 身份核验、去重、类型分类 ──> Signal / Story
              └─ 删帖事件 ──> 证据撤回或重新核验

启动 / 断线 / 余额恢复
              └─ Recent Search since_id + next_token 补抓

需要关键词或媒体过滤
              └─ 可选 Filtered Stream ──> 同一去重入口
```

这比“定时打开每个博主主页”更可靠：账号用稳定数字 `user_id` 保存，handle 只做显示；所有通道最后都按 Post ID 去重；流中断后明确记录缺口，再由 Recent Search 补齐。

### 1.2 Recent Search 轮询怎样做才不会漏

[官方分页指南](https://docs.x.com/x-api/posts/search/integrate/paginate)明确把 `since_id` 作为持续轮询方法。每轮应：

1. 用上一轮成功提交的 `since_id` 查询，不要只按本机时间判断；
2. 保存第一页返回的 `newest_id`，但先沿 `next_token` 把本轮所有页面读完；
3. 全部入库成功后才提交新的 `since_id`；
4. 查询形如 `(from:user_a OR from:user_b) -is:retweet -is:reply`，账号较多时分组，避免超过 512 字符；
5. 429 按响应的 reset 时间退避，服务重启后从持久化游标恢复。

若只需要审计某一个账号，可以使用 [User Posts Timeline](https://docs.x.com/x-api/posts/timelines/introduction)：它最多返回约 3,200 条近期帖子，支持 `since_id` 和排除 replies/retweets。它适合核对完整性，不必对所有账号无意义地高频扫全量 timeline。

### 1.3 Webhook、Activity 与 Enterprise 不要混为一谈

- X Activity 可以通过长连接或 webhook 交付。对单机 Windows 应用，长连接不要求公网入口，部署最简单。[X Activity quickstart](https://docs.x.com/x-api/activity/quickstart)
- 若使用 webhook，需要公开 HTTPS、CRC 校验、验证 `x-twitter-webhooks-signature`，并在 10 秒内返回 200；这意味着要有可靠公网接收端、重放保护和幂等处理。[X Webhooks](https://docs.x.com/x-api/webhooks/introduction)
- [Filtered Stream Webhook](https://docs.x.com/x-api/webhooks/stream/introduction) 属于 Enterprise 能力，不应为了几十个重点账号提前采购。
- 旧的 [Account Activity API](https://docs.x.com/x-api/account-activity/introduction) 面向“用户授权自己的账号活动”，订阅用户需走 OAuth 1.0a 三方授权；它不适合在没有对方授权的情况下监控任意白名单博主。[Account Activity quickstart](https://docs.x.com/x-api/account-activity/quickstart)
- [Enterprise API](https://docs.x.com/enterprise-api/introduction) 面向 Firehose、Powerstream、大规模过滤和定制支持，价格与限制由合同确定。当前个人新闻工作台没有必要从这里起步。

### 1.4 当前价格边界

截至复核日，[X 按量价格页](https://docs.x.com/x-api/getting-started/pricing)列出的 Post read 和 X Activity `post.create` 都是 **$0.005/条**；`post.delete` 当前不计费。相同资源在同一个 UTC 日内通常只计一次，但官方把它称为 soft guarantee；价格以 Developer Console 为最终值并可能变化。

[Post cap 文档](https://docs.x.com/x-api/fundamentals/post-cap)当前给出的 self-serve 月上限是 300 万次 Post reads，Recent Search、Full-archive Search、Filtered Stream 和 timeline 等都会计入。成本因此主要取决于实际返回的唯一帖子数，而不是空轮询次数：

```text
估算月成本 ≈ 当月计费的唯一 Post 数 × $0.005
             + User 等其他资源读取费用
```

例如 30 个账号、平均每天各 5 条可计费帖子，粗略是 4,500 条/月，即约 $22.50；实际值还会受回复/转帖过滤、重复读取、资料查询和价格变化影响。应在 Console 设低额 spending limit，记录每日 usage 和余额，并在余额耗尽时自动降级到非 X 官方源，而不是偷偷切换到抓取器。

### 1.5 新闻事实边界

X 的价值是“快”，不是天然“真”。接入后仍需遵守本项目的 source-first 原则：

- 厂商官方帖链接了博客、文档、论文或仓库：X 是发现入口，链接目标是事实主源；
- 高管或研究者自包含发言：只能证明“该账号在该时间公开表达了什么”，不能自动升级为公司正式政策；
- 第三方博主、榜单和爆料账号：默认 `discovery_only`，等待一手来源交叉确认；
- 永久保存原始标题、URL、作者、Post ID、发布时间、抓取快照和删除状态；任何文章事实最终只能来自冻结后的 `ContentPackage`。

## 2. GitHub 项目：哪些能复用，哪些只能借鉴

活跃度是 2026-09-04 复核时的仓库状态；它只表示维护迹象，不代表 X 官方认可或接口稳定。

| 项目 | 活跃度与许可证 | 认证/实现 | 主要风险 | 建议 |
| --- | --- | --- | --- | --- |
| [X 官方 XDK](https://github.com/xdevplatform/xdk) | 官方维护；[MIT](https://github.com/xdevplatform/xdk/blob/main/LICENSE) | X Developer App 与官方 Bearer/OAuth | 仍受官方费用、配额和字段变化约束 | **生产首选客户端**；能用 SDK 就不自造签名/重连逻辑 |
| [RSSHub](https://github.com/DIYgod/RSSHub) | 活跃；[AGPL-3.0](https://github.com/DIYgod/RSSHub/blob/master/LICENSE) | 可走官方 X API，也可用 `TWITTER_AUTH_TOKEN` 调 X Web 内部接口 | Web 模式依赖 cookie 和 GraphQL；X 前端变化会导致路由失效；AGPL 影响修改后网络部署 | 借鉴路由、缓存、规范化和 RSS 输出；若复用 X 路由，只采用**官方 API 模式**并做许可证评估 |
| [twscrape](https://github.com/vladkens/twscrape) | 活跃；[MIT](https://github.com/vladkens/twscrape/blob/main/LICENSE) | 内部 Search/GraphQL，多账号池；通常需要真实账号 cookie、`auth_token` / `ct0` | 接口哈希、Cloudflare、登录挑战、IP/账号封禁；维护者也不保证官方兼容 | 仅研究其队列、账号池和解析方式；**不得作为生产兜底** |
| [Nitter](https://github.com/zedeus/nitter) | 已归档；[AGPL-3.0](https://github.com/zedeus/nitter/blob/master/LICENSE) | 非官方接口与代理实例 | 仓库 README 记录 2026-08 收到 X 停止侵权通知并下线；公共实例与 RSS 都不可依赖 | **排除** |
| [twitter-scraper](https://github.com/the-convocation/twitter-scraper) | 2026 年仍有提交；[MIT](https://github.com/the-convocation/twitter-scraper/blob/main/LICENSE) | cookie 登录、前端接口、TLS/Cloudflare 适配 | README 明示真实账号可能被封、端点经常变化且修复可能耗时数天 | 仅做故障模式和测试夹具参考 |
| [twitter-api-client](https://github.com/trevorhobenshield/twitter-api-client) | MIT；最近维护明显弱于上述项目 | Web 内部接口与账号认证 | 陈旧端点、账号风险、无官方稳定性承诺 | 不纳入主方案 |

关键证据并不只在 README：

- RSSHub 的 [Twitter namespace 配置](https://github.com/DIYgod/RSSHub/blob/master/lib/routes/twitter/namespace.ts)说明 Web 模式使用 `TWITTER_AUTH_TOKEN` cookie，用户名/密码移动端登录已因 client attestation 失效；同一配置也支持官方 consumer key/secret。
- RSSHub 的 [API 选择代码](https://github.com/DIYgod/RSSHub/blob/master/lib/routes/twitter/api/index.ts)会在 auth token 存在时选择 Web API，否则选择 developer API；[developer API 实现](https://github.com/DIYgod/RSSHub/blob/master/lib/routes/twitter/api/developer-api/api.ts)使用正式 timeline/search，而 [Web API 实现](https://github.com/DIYgod/RSSHub/blob/master/lib/routes/twitter/api/web-api/api.ts)依赖前端 GraphQL。
- [RSSHub issue #22136](https://github.com/DIYgod/RSSHub/issues/22136)记录了 X JS bundle/GraphQL 变化导致路由回归；这类失败不是偶发网络错误，而是非官方接口的结构性成本。
- [twscrape issue #327](https://github.com/vladkens/twscrape/issues/327)记录 2026-08 因 GraphQL hash 变化导致调用普遍失败；[issue #330](https://github.com/vladkens/twscrape/issues/330)记录 Cloudflare 挑战破坏已认证会话；[issue #214](https://github.com/vladkens/twscrape/issues/214)则展示 IP ban / token 失效问题。
- twitter-scraper 的 [README 风险说明](https://github.com/the-convocation/twitter-scraper#readme)直接警告真实登录账号可能被封，以及动态 rate limit 和前端端点频繁变化。

此外，[X Developer Guidelines](https://docs.x.com/developer-guidelines)明确禁止通过 scraping、browser automation 或非公开 API 接入数据，并说明可能永久暂停访问；[X Terms of Service](https://x.com/en/tos)也禁止未经书面许可抓取、使用未发布接口和规避访问控制。因此，“开源可用”不等于“条款允许”，更不等于“可作为新闻事实生产通道”。

## 3. Google AI Pro 与 Gemini API 到底是什么关系

### 3.1 会员权益与 API 权益分开

[Google AI Pro 计划页](https://one.google.com/about/google-ai-plans/)与 [Google One 帮助页](https://support.google.com/googleone/answer/14534406?hl=en)列出的主要权益包括 Gemini App/网页能力、AI Studio 的更高交互限额、存储和 Google Developer Program Premium；Pro 还列出每月 $10 Google Cloud credit。

但程序化调用遵循另一套控制面：

- 每个 [Gemini API key](https://ai.google.dev/gemini-api/docs/api-key)都属于某个 Google Cloud project；
- [Gemini API billing](https://ai.google.dev/gemini-api/docs/billing)由该 project 关联的 Cloud Billing account、预付/后付状态和 usage tier 决定；新付费账户可能需要至少 $10 预付；
- [Rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)随 project/tier 和系统容量变化，以 AI Studio 显示为准；
- [Google Developer Program benefits](https://developers.google.com/profile/help/benefits)中的每月 $10 Cloud credit 需要在开发者计划面板领取并关联 billing account，是否可抵扣具体 SKU 仍以 credit 条款和 Billing 抵扣记录为准。

因此，准确说法是：**Pro 会改善用户在 AI Studio 里的交互体验，并可能用 Cloud credit 抵掉一小部分符合条件的 API 账单；它不会把消费者订阅自动转换成一个不限量或已付费的 Gemini API key。**

### 3.2 可以合法直接调用 Gemini 3.8 Flash

[Gemini 3.8 Flash 模型页](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash)给出稳定模型 ID `gemini-3.8-flash`。根据 [官方定价页](https://ai.google.dev/gemini-api/docs/pricing)，截至 2026-12-31 的标准付费价为输入 $0.75/百万 token、输出（含 thinking）$3.75/百万 token；页面同时公布 2027-01-01 起的价格变化。价格会变，落地前应读取控制台和当期价格页。

标准接入不需要浏览器：

```text
本地新闻工作台
  └─ 服务端保存 GEMINI_API_KEY
       └─ Gemini API generateContent / streamGenerateContent
            └─ 返回草稿、分段流或结构化 JSON
```

[官方入门文档](https://ai.google.dev/gemini-api/docs/get-started)与 [REST 生成示例](https://ai.google.dev/gemini-api/docs/generate-content/latest-model)都展示了使用 SDK 或 HTTPS 调用模型。文章生成时，把已经冻结的 `ContentPackage`、写作要求和引用映射作为输入，让模型返回完整稿件或流式段落即可；随后仍由本地质量门禁检查未支持事实、引用和图片权利。

密钥必须只存在后端/系统凭证存储中。[API key 安全文档](https://ai.google.dev/gemini-api/docs/api-key)明确不应把 key 暴露在浏览器前端或客户端代码中，并把服务端代理列为可行方式。这种“官方 API 的后端代理”与“代理 Gemini 网页会话”不是一回事。

隐私上，[Gemini API 定价页](https://ai.google.dev/gemini-api/docs/pricing)区分 free tier 与 paid tier 的数据使用：页面当前注明 free tier 内容可能用于改进产品，而 paid tier 内容不用于改进产品。若输入含未发布文章、私人素材或内部判断，应使用合适的付费项目并再次核对最新条款。[Gemini API Additional Terms](https://ai.google.dev/gemini-api/terms)是正式授权边界。

## 4. 正式 API、浏览器自动化和非官方反代的差异

| 方式 | 凭证 | 稳定性与审计 | 条款/安全风险 | 结论 |
| --- | --- | --- | --- | --- |
| X / Gemini 正式 API | Developer App、API key、OAuth/Bearer | 有版本化 schema、状态码、配额、价格和可记录的请求 ID | 需付费并遵守开发者条款 | **生产主通道** |
| 自有后端代理正式 API | key 只保存在本机服务端，后端代前端请求官方端点 | 与正式 API 相同，还能统一限流、缓存和脱敏 | 必须防止 key 泄露、越权和日志落密钥 | **推荐的产品形态** |
| 浏览器自动化操作 X/Gemini 网页 | 用户名、密码、登录 cookie、浏览器 profile | DOM/前端协议随时变化；验证码、超时、登录挑战不可预测；难以固定模型和重试语义 | X 明确禁止；Google 也禁止规避保护措施；凭证和账号风险高 | **不用于自动监控或文章生产** |
| 反代消费者网页/复用会话 cookie | 消费者会员 cookie 或第三方中转凭证 | 无官方 SLA，无法证明实际模型、计费、上下文隔离和数据去向 | 可能违反产品条款；第三方可取得会话；账号封禁与数据泄露风险 | **排除** |
| 开源 X 内部 GraphQL 抓取器 | 真实/批量 X 账号 cookie、guest token | 需要追随前端 hash、反爬和 CF 变化；可能突然全量失效 | 抓取、规避控制、账号/IP 封禁风险 | **只做研究参考** |

[Google Terms](https://policies.google.com/terms)禁止绕过服务保护措施或以违反机器可读指令的自动方式访问；结合 Gemini API 已提供正式生成接口，没有充分理由让产品保存 Google 消费者账号 cookie 或遥控网页。

## 5. 建议的下一步

### 今晚：先拿到高时效信号

1. 在 X Developer Console 确认 App、Bearer Token、按量余额与 spending limit；先选 20–50 个经过人工核验的 P0/P1 账号，并解析/保存稳定 `user_id`。
2. 先启用 Recent Search 每 3–5 分钟轮询，按账号分组，完整处理 `next_token` 与 `since_id`；同时在界面标出最后成功时间、漏抓窗口、429、余额和预估成本。
3. 没有 X 官方凭证时，继续使用厂商官网、官方博客/RSS、GitHub Releases 和人工 X Lists 通知发现热点。不要为了“今晚不断更”引入 cookie 抓取。
4. Google 侧在 AI Studio 创建/选择 Cloud project 和 API key；若要 paid tier，单独关联 Cloud Billing，并在 Developer Program 面板领取 Pro 的 Cloud credit。用 `gemini-3.8-flash` 官方 API 做一篇小样，核对 token、成本、引用和数据使用设置。

### 下一迭代：把监控做成可恢复系统

1. 接入 X Activity persistent stream 作为实时主通道，Recent Search 降为启动/断线补漏；有复杂过滤需求时再加 Filtered Stream。
2. 建立 `account registry`：`user_id`、handle、账号角色、官网反向验证、最后复核时间、允许作为何种证据。
3. 把监控健康分成“连接正常”“补抓中”“余额不足”“凭证失效”“来源暂不可用”，且绝不能在失败时静默切换到非官方抓取。
4. 文章生成调用 Gemini 官方 API，只允许读取冻结 `ContentPackage`；保留模型 ID、请求参数、输入证据版本、输出和成本。模型写得再好也不能越过 unsupported-fact gate。
5. RSSHub 如需采用，优先当作 RSS 输出/适配层参考；若实际部署或修改，先评估 AGPL-3.0 义务，并强制走官方 X API 模式。

最终推荐是：**X 负责最快发现，官方网页/文档/仓库负责事实；Gemini API 负责基于证据写稿，浏览器只留给用户人工查看与最终确认。** 这样才能同时得到时效、可恢复性和可审计性。
