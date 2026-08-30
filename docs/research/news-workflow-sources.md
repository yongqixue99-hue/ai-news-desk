# 科技 / AI 日报工作流：新闻源与小黑盒发布能力研究

研究日期：2026-08-06（Asia/Shanghai）

范围：只使用各平台官方页面、官方开发者文档、官方条款和实际官方 Feed/API 端点。本文重点回答“能否机器采集、是否需要授权、是否受付费墙影响，以及小黑盒能否官方自动发文”。这是一份产品与合规调研，不构成法律意见。

## 结论先行

1. **机器采集的技术条件不等于可拿去生成并发布文章。** 华盛顿邮报和 BBC 都有仍在更新的科技 RSS；Polymarket 有公开 API。但华邮条款明确限制自动抓取及用其内容生成 AI 输出，BBC 对商业 RSS 使用要求另行获准，且公开 RSS 内容不可随意改写。
2. **适合正式自动化出版的路线基本都是付费授权产品：** Bloomberg Media Distribution、Reuters Connect / Reuters Ready、AP Media API、BBC NEWSHUB Content API、CNN Newsource。它们面向新闻机构或企业，权限、可发布范围、地区、图片和 AI 派生使用需写入合同。
3. **小黑盒公开资料中未发现面向第三方的公开发文 API、OAuth、Webhook 或 RSS 导入机制。** 官方公开的是 App 投稿和登录后的“鉴赏家/运营管理平台”网页编辑器，而且部分账号需要“投稿功能权限”。因此，当前可支持的稳妥版本应是“自动采集 → 自动草稿/配图 → 人工审核 → 官方网页或 App 发布”。在取得小黑盒书面许可前，不应把未公开接口或模拟登录做成无人值守生产链路。
4. **图片是独立的版权层。** Reuters、AP、Bloomberg、CNN 的授权产品均可包含图片，但必须按合同和单条素材限制使用；华邮公开 RSS 图片最多只能以 60×60 低清形式展示；BBC 的商业元数据（包括图片）需要许可。若预算有限，日报封面优先使用自制图表或有明确商用许可的原创/生成式视觉，而不是复制新闻站配图。

## 来源逐项评估

### 1. The Washington Post（华盛顿邮报）

**官方采集入口**

- 华邮在 2026-05-21 更新了[官方 RSS 目录](https://www.washingtonpost.com/information/2026/05/21/washington-post-rss-feeds/)，其中明确列出 Technology Feed；实际端点为 [`https://feeds.washingtonpost.com/rss/business/technology`](https://feeds.washingtonpost.com/rss/business/technology)。截至调研日，该 Feed 仍在更新，提供标题、链接、作者、发布时间和简短描述。
- 若需要可再发布的内容流，官方的[Licensing & Syndication 产品](https://www.washingtonpost.com/licensing-syndication/products)提供 News Service / Curated Content Feeds，可按 Technology 等主题交付，交付形式包括 RSS、FTP、下载或接入 CMS。

**限制与付费墙**

- [RSS Terms of Service](https://www.washingtonpost.com/discussions/2021/01/01/rss-terms-service/)要求保留原文链接、署名和归因；不得编辑、翻译或重排 Feed 文本；不得把聚合结果做成原站替代品；不得归档 Feed；图片仅可低清且不大于 60×60。偏离这些规则需要联系 `rsssupport@washpost.com`。
- 华邮的[总站服务条款](https://www.washingtonpost.com/terms-of-service/)禁止使用 crawler、robot、script 等自动方式采集/搜索网站，并明确禁止把站内内容用于机器学习或 AI 工具，包括用其生成文本、图片或其他输出。RSS 条款又明确说明 RSS 使用同时受总站协议约束。因此，**公开 RSS 可做提醒和链接发现，但不应在未获书面许可时把 Feed 摘要或正文送入 LLM 生成小黑盒文章**。
- [订阅说明](https://helpcenter.washingtonpost.com/hc/en-us/articles/115000443968-Compare-subscription-packages)称普通读者每月只能读有限数量文章，订阅后才有无限访问。个人订阅只解决阅读权限，不等于获得自动采集、AI 改写或再发布授权。

**工作流建议**：低成本版本仅保存标题、时间和原链接供人工选题；要把华邮内容纳入自动摘要或再发布，走 Licensing & Syndication 并让合同明确允许中文摘要、AI 辅助和小黑盒分发。

### 2. Bloomberg Asia

**官方采集入口**

- 公开官网未发现面向公众的新闻 RSS 或无需授权的新闻 API。官方可订阅[Morning & Evening Briefing Asia](https://www.bloomberg.com/account/newsletters/)等邮件简报，但邮件订阅是阅读产品，不是第三方自动再发布授权。
- 正式机器化路线是 [Bloomberg Media Distribution](https://www.bloomberg.com/distribution/)；其[News Service](https://www.bloomberg.com/distribution/products/news/)提供可定制新闻流，主题含 Bloomberg Technology（AI、交通、大数据、创业公司等），并覆盖中文在内的八种语言。官方 [FAQ](https://www.bloomberg.com/distribution/faq/)说明新闻可下载为 XML，访问量/下载量由企业与 Bloomberg 销售代表约定，也可单篇购买。

**限制与付费墙**

- [Bloomberg Terms of Service](https://www.bloomberg.com/tos)规定普通网站服务仅限个人、非商业使用；未经书面许可不得复制、发布、制作衍生作品、建立数据库，也不得使用 scraper、robot、bot、spider 或其他自动方式访问、采集或监控内容。
- 同一条款说明 Bloomberg.com 为计量式订阅：匿名或注册用户每月只有有限免费文章/视频，之后需付费；[当前订阅页](https://www.bloomberg.com/subscriptions)提供无限阅读方案。消费级订阅同样不授予抓取或再发布权。

**工作流建议**：把 Bloomberg 设为“有预算后接入”的高价值源；通过 Media Distribution 获取可过滤的 Technology/Asia Feed，并在合同中确认中文改写、摘要、AI 辅助、封面图和第三方社区发布范围。不要抓 Bloomberg.com 或把付费账号 cookie 交给自动化程序。

### 3. Reuters

**官方采集入口**

- [Reuters Connect](https://reutersagency.com/content-delivery-platforms/reuters-connect/)提供文本、图片、图形、音视频等内容及 API，采用订阅、计量和灵活商业模型；不是无需账号的公共新闻 API。
- 官方的[内容交付与集成说明](https://reutersagency.com/content-delivery-platforms/content-delivery)称其 API 基于 GraphQL、支持 JSON、可按相关性过滤并接入 CMS，覆盖研究、编辑工作流和“agentic publishing”等场景。
- 对日报更直接的产品是 [Reuters Ready](https://reutersagency.com/content/content-types/reuters-ready/)：提供可直接发布的多媒体文章 Feed，包含 Science and Technology、Asia 等主题。官方页面称其订阅包含内容访问与发布权，但实际使用仍受客户协议、素材限制和署名规则约束。

**授权与署名**

- 官方[内容许可页面](https://reutersagency.com/license-reuters-content/)要求联系销售团队讨论内容需求；公开页面未给出统一 API 价格。
- [Reuters Connect General Terms](https://www.reutersconnect.com/general-terms)对默认客户使用也保留了严格边界：自动收集/抓取、衍生使用以及 AI/机器学习处理不能仅凭普通访问权推定为获准；具体权利应以订阅或单项交易许可为准。Reuters 另设有面向企业的[AI Training & RAG 授权方案](https://reutersagency.com/solutions/ai-training-rag/)，进一步说明“可阅读新闻”与“可用于模型处理或生成内容”是两类授权。
- [Reuters Brand Attribution Guidelines](https://reutersagency.com/brand-attribution-guidelines/)要求保留版权/商标/个人署名；把 Reuters 的事实、数字、引语或背景与其他材料结合时，应尽力标明 Reuters 来源；不得用包括 AI 工具在内的方式改变或扭曲原文编辑含义。
- Reuters 还专门说明其会处理[未经授权的图片使用](https://reutersagency.com/protection-of-reuters-copyright-rights/)。因此，新闻正文授权与图片授权不能相互替代。

**工作流建议**：若追求稳定、准确和可自动出版，Reuters 是优先谈商务授权的源之一。要求合同明确：Science & Technology/Asia 过滤、中文摘要、AI 处理边界、图片尺寸/平台、署名样式、纠错/撤稿同步和小黑盒发布权。

### 4. CNN

**公开 Feed 的现实状态**

- 旧的官方 Technology RSS 端点 [`http://rss.cnn.com/rss/edition_technology.rss`](http://rss.cnn.com/rss/edition_technology.rss)仍能返回 XML，但频道 `pubDate` 停在 2016-12-08；旧的 Latest Feed [`http://rss.cnn.com/rss/cnn_latest.rss`](http://rss.cnn.com/rss/cnn_latest.rss)在调研日返回的 `lastBuildDate` 停在 2024-08-22。因此这些端点不能作为 2026 年的可靠科技日报输入。
- 官方公开资料中未发现当前、公开、无需授权的 CNN 新闻 API。正式路线是 [CNN Content Sales / Newsource](https://commercial.cnn.com/our-solutions/content-sales/)；CNN 称其向合作出版商许可新闻、节目和档案内容。旧但仍由 CNN 官方托管的 [Newsource MRSS 文档](https://newsource-cdn-static.ns.cnn.com/prd/help/content/FAQ%20for%20VAN%20Nov%202018%20Upgrade.pdf)也表明，Article/Video/Bundle MRSS Feed 需要向 CNN 获取 URL 和凭据。

**付费墙**

- CNN [官方帮助页](https://help.cnn.com/us/Answer/Detail/000001009)说明用户每月只能免费阅读有限文章；Basic / All Access 才提供无限文章。消费订阅不是内容再发布许可。

**工作流建议**：不要依赖旧公共 RSS；若 CNN 必须入选，联系 Newsource/Content Sales 获取带凭据的授权 Feed。预算未确定时，可暂时让 CNN 只作为人工浏览和交叉核验源。

### 5. Associated Press（AP）

**官方采集入口**

- [AP Media API](https://developer.ap.org/ap-media-api/)是正式的机器接入渠道，覆盖文本、图片、图形、视频和音频；API 可取近 30 天内容和多媒体档案。其[总览文档](https://api.ap.org/media/v/docs/Overview.htm)支持连续 Feed、检索、AP Newsroom Saved Search 和自动投递到 CMS。
- [Getting Started](https://api.ap.org/media/v/docs/Getting_Started_API.htm)明确写明 API 只返回客户“已许可”的内容，实际可见产品、媒体类型和价格取决于合同；[安全要求](https://developer.ap.org/ap-media-api/agent/API_Security_Requirements.htm)要求 HTTPS 和 `x-api-key`。
- 官方[内容许可页](https://www.ap.org/content/)提供文本、图片、视频、音频和机器可读数据的商务接洽。

**限制**

- [AP.org Terms and Conditions](https://www.ap.org/terms-and-conditions/)禁止用自动设备/算法 crawl、scrape、搜索、监控或复制网站，也禁止重复自动访问（AP 自己提供的方式除外）。因此应使用 Media API，不应抓 AP.org/AP News 页面代替 API。
- 同一条款要求再发布或保留内容先获授权；API 文档还提示媒体文件和使用限制取决于 entitlement，视频脚本/shotlist 可能含额外限制。

**工作流建议**：AP Media API 很适合建立 `AI OR artificial intelligence OR model OR chip` 等 Saved Search，但需要机构合同。接入时必须同步版本、纠错、kill、embargo 和素材限制，而不是只保存首次抓到的快照。

### 6. BBC

**官方采集入口**

- BBC Developer 的[News Feeds 页面](https://support.bbc.co.uk/platform/feeds/NewsFeeds.htm)列出官方 Feed，并指向完整 OPML。Technology Feed 为 [`https://feeds.bbci.co.uk/news/technology/rss.xml`](https://feeds.bbci.co.uk/news/technology/rss.xml)；截至调研日仍在更新，包含标题、摘要、链接、时间和缩略图。
- 更完整的正式 API 是 [BBC NEWSHUB Content API](https://docs.newshub.bbc.co.uk/)，提供 REST/JSON、全文搜索、主题/时间过滤和分页，但每次请求都需要 API Key，Key 同时决定客户能消费哪些内容，即属于 entitlement 型接入。
- BBC 还提供面向获准客户的[Information Syndication API](https://information-syndication.api.bbc.com/)入口；公开落地页要求凭 API Key 使用。它应被视为商务/授权交付渠道，而不是匿名公共新闻 API，且第三方版权图片可能不包含在交付权利内。

**限制**

- [BBC Terms of Use（官方 PDF）](https://downloads.bbc.co.uk/usingthebbc/bbc_terms_of_use_19September2022english.pdf)第 15 节允许个人把 BBC News RSS 加到网站/社媒，但不得修改 Feed 或移除品牌，并须显著标注 BBC News 与链接。商业使用 RSS 需要 BBC 许可，可能收费；商业使用包括图片、文本和链接在内的元数据也需要 metadata licence。

**工作流建议**：公开 Technology RSS 可低成本做发现/链接源，但面向小黑盒的持续自动发布属于商业/出版用途的可能性很高，应先取得书面许可；需要正文、图片或可改写内容时谈 NEWSHUB/API entitlement。

### 7. Polymarket

**官方采集入口**

- Polymarket [API Introduction](https://docs.polymarket.com/api-reference/introduction)列出三组 API：Gamma（市场、事件、标签、搜索）、Data（交易、持仓、活跃度等）和 CLOB（盘口、价格、价差、历史价格及交易）。Gamma、Data 与 CLOB 读接口无需认证；交易接口需要认证。
- [官方帮助中心](https://help.polymarket.com/en/articles/13364254-does-polymarket-have-an-api)明确确认 API 面向研究者、做市商和独立开发者；[Rate Limits](https://docs.polymarket.com/api-reference/rate-limits)列出 Gamma `/markets`、`/events`、`/public-search` 等端点限额。
- 2026 年接入应优先使用 Changelog 所示的 [`/markets/keyset` 与 `/events/keyset`](https://docs.polymarket.com/changelog)游标分页；旧 offset 接口仍可用但计划弃用。

**内容定位与限制**

- Polymarket 是预测市场数据源，不是新闻采编机构。市场标题、描述和概率可作为“市场正在押注什么”的信号，不能当成事件已发生或事实已证实的证据。
- 公开 API 不自动授予对市场封面、第三方图像、品牌标识或引用新闻材料的再发布权；正式文章应链接市场并从一手公告/文件或授权新闻源独立核实事实。

**工作流建议**：把 Polymarket 作为排序加分项，而不是基础事实源。例如只选择与 AI/科技标签相关、24 小时成交/流动性显著上升的市场，再与至少两个可靠来源交叉核验。

## 小黑盒（HEYBOX）发布能力

### 已确认的官方能力

- 官方提供 App 内的帖子/动态、图文、文章和视频投稿。当前[用户协议及隐私政策](https://api.xiaoheihe.cn/account/privacy_introduce/)写明发布功能会收集并保存用户提交的文字、图片、音视频；部分信息发布服务可能要求实名/实人认证。
- 官方有登录后的[小黑盒运营管理平台](https://c.xiaoheihe.cn/login)。[“鉴赏家平台发帖指南”](https://api.xiaoheihe.cn/maxnews/app/share/detail/12224)说明它用于网页端长文编辑，支持格式、链接、图片、图注、来源和转载声明；图片应小于 3 MB；转载文章要在开头写作者、文末写来源及授权情况；只有具备投稿权限的账号才会看到相应投稿/来源设置。
- 发文后可在网页平台修改“由该平台发布”的帖子；手机端发布的帖子不能通过该网页平台修改。指南还要求发出后在手机端检查最终展示效果。

### 未确认 / 不应假设的能力

- 截至 2026-08-06，在小黑盒公开官方域名、官方指南、用户协议、隐私政策和管理平台公开页中，**未发现第三方发文 API 文档、API Key/OAuth 申请、Webhook、RSS 导入或官方自动发布说明**。
- 隐私政策提到其产品可能使用“SDK 和 API”，这是隐私政策的适用范围，不是向第三方开放发文 API 的承诺。
- 公开条款没有明确写出“允许机器人发文”，也没有在所查官方资料中明确写出普遍的“禁止浏览器自动化”。因此不能把缺少禁止条款解释为授权。调用 App/网页背后的未公开接口、保存账号 cookie 或绕过验证码都属于非官方、易变且可能触发风控的方案，不适合直接上线无人值守生产。

### 发文责任与内容约束

- [用户协议](https://api.xiaoheihe.cn/account/privacy_introduce/)规定账号活动由账号持有人负责；平台可审查、删除内容或暂停/终止使用权。用户必须保证自己是内容著作权人或已经取得合法授权，侵权造成损失由用户承担。
- 用户在小黑盒公开发表内容，会授予小黑盒免费、不可撤销、非独家的平台使用许可。平台同时把自己定位为“游戏信息分享、传播及获取的平台”，所以纯泛科技日报可能存在受众和选题适配问题；将 AI 话题与游戏、显卡、消费硬件、创作工具或玩家生态连接，会更符合平台语境。
- 官方指南对“转载”要求来源与授权。仅列出新闻 URL 并不能替代原媒体许可；自动“洗稿”也不能消除原文和图片的版权问题。

### 对自动发布的产品决策

建议分两阶段：

1. **现在可上线：** 自动抓取合规 Feed/API → 去重/打分 → 生成原创中文草稿与自有图片 → 事实与版权检查 → 人工在小黑盒官方网页/App 审核发布。保留来源、授权状态、生成日志和人工批准记录。
2. **取得小黑盒书面确认后：** 再评估无人值守发布。优先询问是否有合作方 API、创作者后台批量导入或允许的浏览器自动化方式，并明确频率、验证码、账号安全、AI 内容标识、失败重试和撤稿机制。官方指南给出的平台问题反馈渠道是 App/写手社群；也可先通过 App 客服取得可留档的答复。

## 建议的接入优先级

| 级别 | 来源 | 建议用途 | 前置条件 |
|---|---|---|---|
| A | Polymarket API | 趋势信号与排序，不作为事实源 | 遵守限流；事实另行核验 |
| A（仅发现） | BBC Technology RSS | 标题/链接发现 | 商业改写或发布前取得 BBC 许可 |
| A（仅发现） | Washington Post Technology RSS | 标题/链接发现 | 不把内容送入 LLM；AI/再发布需书面许可 |
| A（有预算） | Reuters Connect / Ready | 科技/亚洲新闻、图片、可发布内容 | 商务合同明确 AI、中文与小黑盒渠道 |
| A（有预算） | AP Media API | Saved Search、连续 Feed、多媒体 | API Key 与内容 entitlement |
| B（有预算） | Bloomberg Media Distribution | Bloomberg Technology / Asia 高价值信息 | 商务授权；不可抓 Bloomberg.com |
| B（有预算） | BBC NEWSHUB API | 全文/主题/时间过滤 | API Key 与 entitlement |
| B（有预算） | CNN Newsource | CNN 授权新闻/MRSS | 联系内容销售；旧公开 RSS 不可用 |

## 最低合规数据字段

不论最后采用何种编排工具，每条候选新闻至少保存：`source`、`source_url`、`published_at`、`retrieved_at`、`access_method`（RSS/API/manual）、`license_basis`、`allowed_uses`、`image_license`、`attribution_text`、`correction_or_kill_id`、`human_approved_by`。授权状态未知的内容不得自动进入“发布”节点。

## 关于“没有公开 API”这一负面结论

“未发现”只表示：在本次调研日期前，可公开访问和检索的官方页面中没有找到相关文档；它不证明小黑盒内部或商务合作方一定没有接口。最可靠的下一步仍是让小黑盒书面确认并提供正式接入方式。
