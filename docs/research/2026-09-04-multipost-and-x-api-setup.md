# MultiPost Extension 源码审查与 X API 开通清单

> 调研截止：2026-09-04（Asia/Hong_Kong）
> 证据边界：MultiPost 只引用其 GitHub 原仓库的 README、LICENSE、manifest 配置和源码；X 只引用 X 官方文档与 Developer Console。没有用第三方教程推断价格或权限。
> 复核基线：MultiPost `main` 分支截至本日最新提交为 [`fdbc6c3`](https://github.com/leaperone/MultiPost-Extension/commit/fdbc6c3b2f3c03f57be8a59b46e33860689ba509)（2026-09-01）。X 的控制台界面、单价、限额会动态变化，实际开通时以 [Developer Console](https://console.x.com/) 当页为准。

## 结论先行

1. **MultiPost 值得借鉴的是“统一内容包 → 平台适配器 → 打开各平台编辑页 → 注入内容 → 人工检查”的结构，不适合整包接入。** 当前源码同时存在“只填编辑器”“按开关自动点击发布”“绕过公开 OpenAPI、直接调用网页后台内部接口创建内容”三种行为，不能把它当成统一、安全的草稿投递层。[统一数据结构](https://github.com/leaperone/MultiPost-Extension/blob/fdbc6c3b2f3c03f57be8a59b46e33860689ba509/src/sync/common.ts)明确包含 `isAutoPublish`，而 [X 动态适配器](https://github.com/leaperone/MultiPost-Extension/blob/fdbc6c3b2f3c03f57be8a59b46e33860689ba509/src/sync/dynamic/x.ts)会在该值为真时点击发布按钮或发送快捷键。
2. **对本项目应当 adopt 架构思想、adapt 少量适配器模式、avoid 自动发布和广域权限。** 本项目只允许送入草稿箱或编辑器，最终发布必须由用户手动完成；因此不得暴露 `isAutoPublish=true`，不得复制自动点击“发布”的分支，也不应采用 `<all_urls>` 与 `https://*/*` 这种全网访问面。[manifest 配置](https://github.com/leaperone/MultiPost-Extension/blob/fdbc6c3b2f3c03f57be8a59b46e33860689ba509/package.json#L70-L82)显示原扩展拥有全 HTTPS 主机权限以及 tabs、scripting、剪贴板读写等权限。
3. **X 监控不需要网页登录自动化，也不需要用户态写权限。** Recent Search、按用户 ID 读取公开用户时间线均支持 App-only Bearer Token；只有首页时间线和替用户发帖才需要 User Context。[X 时间线认证矩阵](https://docs.x.com/x-api/posts/timelines/integrate)明确区分了这三类端点。
4. **开通路线是：Developer Console 注册开发者 → 新建 Project/App（控制台可能合并为 New App 流程）→ 保存 Bearer Token → 购买少量预付 credits → 设置 spending limit → 用公开账号完成三次只读测试。** X 官方的[开通文档](https://docs.x.com/x-api/getting-started/getting-access)和[控制台说明](https://docs.x.com/fundamentals/developer-portal)均给出这一路径。
5. **第一版建议用“白名单账号的 User Posts timeline”为主，Recent Search 为合并查询/七日补漏。** 时间线使用稳定的数值 `user_id`，支持 `since_id`、排除回复和转帖；Recent Search 只覆盖最近 7 天，但可用 `from:` 把多个账号合并进查询。[Recent Search 快速开始](https://docs.x.com/x-api/posts/search/quickstart/recent-search)与[时间线集成指南](https://docs.x.com/x-api/posts/timelines/integrate)均支持 Bearer Token、分页和增量参数。

## 一、MultiPost Extension：README 说了什么，源码实际做了什么

### 1. 仓库状态与版本边界

- 原仓库为 [leaperone/MultiPost-Extension](https://github.com/leaperone/MultiPost-Extension)。截至 2026-09-04 未归档，最新审查提交为 [`fdbc6c3`](https://github.com/leaperone/MultiPost-Extension/commit/fdbc6c3b2f3c03f57be8a59b46e33860689ba509)。
- `main` 分支的 [`package.json`](https://github.com/leaperone/MultiPost-Extension/blob/fdbc6c3b2f3c03f57be8a59b46e33860689ba509/package.json#L1-L14)标记版本 `1.4.7`，但 GitHub 当日最新正式 Release 仍是 [`v1.4.4`](https://github.com/leaperone/MultiPost-Extension/releases/tag/v1.4.4)。所以“源码现状”“商店安装包”“最新 Release”不能默认等价；复用前必须固定到一个经过实测的 commit/tag。
- 仓库没有单独维护手写的 `manifest.json`；它使用 Plasmo，并把 manifest 字段放在 [`package.json` 的 `manifest` 节](https://github.com/leaperone/MultiPost-Extension/blob/fdbc6c3b2f3c03f57be8a59b46e33860689ba509/package.json#L70-L83)，打包时再生成浏览器扩展清单。因此权限审查应同时固定源码 commit 与实际商店/构建产物版本。
- README 宣称支持多平台同步、无需注册/API Key，并提供扩展 API 与 RESTful API；这些是产品声明，不等于每个适配器都经过线上验证。[README](https://github.com/leaperone/MultiPost-Extension/blob/fdbc6c3b2f3c03f57be8a59b46e33860689ba509/README.md#L11-L25)只给出功能概览，而多个源码注册项被明确标为 `experimental` 或“待线上验证”。
- 源码许可证为 [Apache License 2.0](https://github.com/leaperone/MultiPost-Extension/blob/fdbc6c3b2f3c03f57be8a59b46e33860689ba509/LICENSE)，不是 MIT。

### 2. 真实用户交互链路

从当前源码还原出来的主链路如下：

1. 用户点击扩展弹窗或打开选项页时，扩展并不在小弹窗中直接编辑，而是打开 `https://multipost.app/dashboard/publish`。[popup](https://github.com/leaperone/MultiPost-Extension/blob/fdbc6c3b2f3c03f57be8a59b46e33860689ba509/src/popup/index.tsx#L15-L28)与[options](https://github.com/leaperone/MultiPost-Extension/blob/fdbc6c3b2f3c03f57be8a59b46e33860689ba509/src/options/index.tsx#L15-L33)均如此。
2. 任意网页上的 content script 在 `document_start` 注入，监听 `window.postMessage`；只有被加入本地 trusted domains 的来源才能把 `MULTIPOST_*` 消息转给扩展后台。[消息桥](https://github.com/leaperone/MultiPost-Extension/blob/fdbc6c3b2f3c03f57be8a59b46e33860689ba509/src/contents/extension.ts#L4-L63)会校验来源域名，[信任域名服务](https://github.com/leaperone/MultiPost-Extension/blob/fdbc6c3b2f3c03f57be8a59b46e33860689ba509/src/background/services/trust-domain.ts#L39-L97)通过确认窗口新增来源，并允许 `*.example.com` 形式的通配域名。
3. 收到 `MULTIPOST_EXTENSION_PUBLISH` 后，后台保存本次 `SyncData` 并打开一个 800×600 的发布进度窗口；随后 `MULTIPOST_EXTENSION_PUBLISH_NOW` 才创建各平台标签页。[后台消息处理器](https://github.com/leaperone/MultiPost-Extension/blob/fdbc6c3b2f3c03f57be8a59b46e33860689ba509/src/background/index.ts#L57-L158)可见这两个阶段。
4. 发布窗口先下载正文图片、封面、音视频并转换为 blob URL，再把内容交给各平台适配器；处理完成一秒后自动触发 `PUBLISH_NOW`，不是等用户在进度窗再次确认。[发布窗口流程](https://github.com/leaperone/MultiPost-Extension/blob/fdbc6c3b2f3c03f57be8a59b46e33860689ba509/src/tabs/publish.tsx#L484-L527)展示了自动衔接过程。
5. 通用调度器按平台逐个打开创作页、注入平台函数、激活标签页并建立浏览器 tab group；适配器通过 DOM 选择器、粘贴事件、`DataTransfer` 和同源 `fetch` 写入内容。[通用调度器](https://github.com/leaperone/MultiPost-Extension/blob/fdbc6c3b2f3c03f57be8a59b46e33860689ba509/src/sync/common.ts#L124-L214)每个平台之间还固定等待约 3 秒。
6. 侧边栏每秒查询后台维护的 tab group，用于切换、关闭或重新注入失败标签页；它是标签页管理器，不是平台回执系统。[TabsManager](https://github.com/leaperone/MultiPost-Extension/blob/fdbc6c3b2f3c03f57be8a59b46e33860689ba509/src/components/Sidepanel/Tabs/TabsManager.tsx#L6-L109)没有验证“平台草稿已保存”或“内容已发布”的结构化回执。

因此，README 中的“无需登录”不能理解为“不需要登录目标平台”。适配器依赖当前浏览器已有的目标平台会话：例如 X 账号检测显式用 `credentials: "include"` 请求 `x.com/home` 并解析登录态页面。[X 账号检测源码](https://github.com/leaperone/MultiPost-Extension/blob/fdbc6c3b2f3c03f57be8a59b46e33860689ba509/src/sync/account/x.ts#L2-L65)证明它复用 Cookie 会话，而不是调用正式 X API。

### 3. README 所称“扩展 API / RESTful API”的真实边界

- **扩展 API 可在仓库内验证。** 网页发送带 `type`、`traceId`、`action`、`data` 的消息，content script 校验来源后转发给 runtime，再将响应发回网页；类型定义见 [`src/types/external.ts`](https://github.com/leaperone/MultiPost-Extension/blob/fdbc6c3b2f3c03f57be8a59b46e33860689ba509/src/types/external.ts)。
- **所谓 RESTful API 并不是一个完全自包含的本地发布服务器。** 当前扩展若本地保存了 `apiKey`，会向 `multipost.app/api/extension/ping` 上报扩展版本、client ID 和平台信息；服务返回 `NEW_TASK` 时，扩展只是打开服务给出的任务 URL。[远程桥接代码](https://github.com/leaperone/MultiPost-Extension/blob/fdbc6c3b2f3c03f57be8a59b46e33860689ba509/src/background/services/api.ts#L3-L49)还显示后台每 30 秒调用一次 `ping`。[后台启动代码](https://github.com/leaperone/MultiPost-Extension/blob/fdbc6c3b2f3c03f57be8a59b46e33860689ba509/src/background/index.ts#L161-L165)确认了轮询频率。
- 上报前会删除适配器函数以及 `accountInfo.extraData`，但仍可能发送平台列表和账号摘要；完整账号信息及 `extraData` 被保存在扩展本地 storage。[账号存储代码](https://github.com/leaperone/MultiPost-Extension/blob/fdbc6c3b2f3c03f57be8a59b46e33860689ba509/src/sync/account.ts#L180-L221)与[上报裁剪逻辑](https://github.com/leaperone/MultiPost-Extension/blob/fdbc6c3b2f3c03f57be8a59b46e33860689ba509/src/background/services/api.ts#L17-L35)给出了准确边界。
- 这意味着仓库可以证明“扩展与托管服务之间有任务桥”，却不能仅凭该仓库审计托管 REST 服务的鉴权、留存、队列和 SLA。本地优先项目不应把这一外部服务设为硬依赖。

### 4. 源码登记的平台范围

以下是 `fdbc6c3` 注册表里的**适配器条目**，不是对每个平台可用性的承诺，也不是 108 个互不重复的平台。同一平台可能同时出现在文章、动态、视频等多个模式中。

| 模式 | 注册条目 | 源码登记的平台 |
| --- | ---: | --- |
| 文章 | 42 | 博客园、CSDN、知乎、掘金、简书、SegmentFault、阿里云、腾讯云、火山引擎、百家号、头条、企鹅号/腾讯内容开放平台、豆瓣、微信公众号、WordPress、哔哩哔哩、少数派、51CTO、雪球、微博、东方财富、Substack、Medium、OSChina、InfoQ、什么值得买、人人都是产品经理、格隆汇、健康界、凯迪网、汽车之家、简篇、同花顺、懂车帝、知识星球、网易、搜狐、大鱼号、顶端号、快传号、一点资讯、X Articles；见[文章注册表](https://github.com/leaperone/MultiPost-Extension/blob/fdbc6c3b2f3c03f57be8a59b46e33860689ba509/src/sync/article.ts)。 |
| 动态/短帖 | 30 | 哔哩哔哩、抖音、X、小红书、微博、雪球、知乎、Instagram、Facebook、LinkedIn、即刻、Reddit、Pinterest、快手、百家号、头条、Threads、微信视频号、Bluesky、V2EX、豆瓣、得到、微信公众号、Webhook、知识星球、小黑盒、头条号、Substack、脉脉、掘金；见[动态注册表](https://github.com/leaperone/MultiPost-Extension/blob/fdbc6c3b2f3c03f57be8a59b46e33860689ba509/src/sync/dynamic.ts)。 |
| 视频 | 29 | 哔哩哔哩、抖音、YouTube、小红书、TikTok、微信视频号、快手、百家号、微博、即刻、Bluesky、知乎、东方财富、小黑盒、头条号、企鹅号、车家号、得物、易车、搜狐、网易、大鱼号、支付宝、一点资讯、拼多多、vivo、爱奇艺、优酷、腾讯视频；见[视频注册表](https://github.com/leaperone/MultiPost-Extension/blob/fdbc6c3b2f3c03f57be8a59b46e33860689ba509/src/sync/video.ts)。 |
| 播客 | 7 | QQ 音乐、荔枝、喜马拉雅、小宇宙、蜻蜓 FM、网易云音乐、Spotify；见[播客注册表](https://github.com/leaperone/MultiPost-Extension/blob/fdbc6c3b2f3c03f57be8a59b46e33860689ba509/src/sync/podcast.ts)。 |

可用性必须逐项实测。文章注册表直接把 X Articles 标为“experimental/待线上验证”，其适配器自身也声明选择器和流程需要线上回归。[X Articles 注册项](https://github.com/leaperone/MultiPost-Extension/blob/fdbc6c3b2f3c03f57be8a59b46e33860689ba509/src/sync/article.ts#L512-L523)与[适配器文件头](https://github.com/leaperone/MultiPost-Extension/blob/fdbc6c3b2f3c03f57be8a59b46e33860689ba509/src/sync/article/xarticle.ts#L1-L7)都明确标注了这一点。

### 5. 它到底是直接发布，还是只填入？

答案是“取决于内容模式和具体适配器”，不能统一回答。

| 路径 | 源码行为 | 对本项目的意义 |
| --- | --- | --- |
| 扩展内“文章”表单 | 构造 `SyncData` 时强制 `isAutoPublish: false`；见[ArticleTab](https://github.com/leaperone/MultiPost-Extension/blob/fdbc6c3b2f3c03f57be8a59b46e33860689ba509/src/components/Sync/ArticleTab.tsx#L122-L161)。知乎、掘金等代表性 DOM 适配器在该值为假时只填内容，不点击发布；见[知乎](https://github.com/leaperone/MultiPost-Extension/blob/fdbc6c3b2f3c03f57be8a59b46e33860689ba509/src/sync/article/zhihu.ts#L114-L145)和[掘金](https://github.com/leaperone/MultiPost-Extension/blob/fdbc6c3b2f3c03f57be8a59b46e33860689ba509/src/sync/article/juejin.ts#L67-L80)。 | 这是最接近“送编辑器、人工发布”的行为，可借鉴，但仍需对每个适配器做契约测试。 |
| 扩展内“动态”表单 | UI 暴露“自动发布”开关，并把值写入 `isAutoPublish`；见[DynamicTab](https://github.com/leaperone/MultiPost-Extension/blob/fdbc6c3b2f3c03f57be8a59b46e33860689ba509/src/components/Sync/DynamicTab.tsx#L222-L269)及[开关 UI](https://github.com/leaperone/MultiPost-Extension/blob/fdbc6c3b2f3c03f57be8a59b46e33860689ba509/src/components/Sync/DynamicTab.tsx#L415-L424)。 | 不符合本项目不无人值守最终发布的硬约束，必须删除整个能力，而不是只把默认值设为 false。 |
| X 动态 | 先粘贴文本与媒体；`isAutoPublish=false` 时返回，true 时等待按钮可用并点击，找不到按钮还会尝试 Cmd/Ctrl+Enter；见[X 动态适配器](https://github.com/leaperone/MultiPost-Extension/blob/fdbc6c3b2f3c03f57be8a59b46e33860689ba509/src/sync/dynamic/x.ts#L31-L148)。 | 只能保留“打开编辑页并填入”部分，自动点击和快捷键必须禁止。 |
| X 长文 | 实验性 DOM 填充；`isAutoPublish=true` 时寻找 Post/Publish/发布按钮，找不到则发快捷键；见[X Articles 适配器](https://github.com/leaperone/MultiPost-Extension/blob/fdbc6c3b2f3c03f57be8a59b46e33860689ba509/src/sync/article/xarticle.ts#L98-L157)。 | 不应作为当前交付目标；若将来保留，只能是显式实验功能且永远停在编辑器。 |
| 微信公众号文章 | 不走公开 OpenAPI，而是从登录页面解析 token/ticket，调用 `filetransfer`、`cropimage`、`operate_appmsg?sub=create` 上传图片并创建 `appMsgId`，最后跳转到公众号编辑页；见[上传/裁剪](https://github.com/leaperone/MultiPost-Extension/blob/fdbc6c3b2f3c03f57be8a59b46e33860689ba509/src/sync/article/weixin.ts#L151-L255)、[创建文章](https://github.com/leaperone/MultiPost-Extension/blob/fdbc6c3b2f3c03f57be8a59b46e33860689ba509/src/sync/article/weixin.ts#L257-L418)与[跳转编辑页](https://github.com/leaperone/MultiPost-Extension/blob/fdbc6c3b2f3c03f57be8a59b46e33860689ba509/src/sync/article/weixin.ts#L446-L568)。 | 结果是“创建草稿并进入编辑器”，没有群发/最终发布；产品方向相符，但技术依赖网页内部接口和会话字段，容易随后台改版失效。生产实现应优先使用本项目既定的正式草稿箱接口。 |
| 微信公众号动态 | 同样解析页面会话并调用私有 `operate_appmsg?sub=create&type=77` 创建内容，然后跳到编辑页；函数没有读取 `isAutoPublish`，因此即使统一数据写的是 false，也已经产生了平台侧草稿写入。见[动态适配器](https://github.com/leaperone/MultiPost-Extension/blob/fdbc6c3b2f3c03f57be8a59b46e33860689ba509/src/sync/dynamic/weixin.ts#L9-L49)与[创建/跳转流程](https://github.com/leaperone/MultiPost-Extension/blob/fdbc6c3b2f3c03f57be8a59b46e33860689ba509/src/sync/dynamic/weixin.ts#L203-L305)。 | “autoPublish=false”不等于“无外部写操作”；DeliveryDesk 必须按平台动作建模，区分本地填充、远端建草稿、最终发布。 |
| Webhook 动态 | 遍历配置 URL 并立即执行 `POST`，不检查 `isAutoPublish`，响应成功就显示“发布成功”；见[Webhook 适配器](https://github.com/leaperone/MultiPost-Extension/blob/fdbc6c3b2f3c03f57be8a59b46e33860689ba509/src/sync/dynamic/webhook.ts#L66-L125)。 | 这是直接外发，不是“只填编辑器”。不能纳入默认投递，也不能把任意 webhook URL 当作无害草稿目标。 |

还有一个关键陷阱：`SyncData` 是外部可传入的，类型本身没有禁止 `isAutoPublish=true`。[数据接口](https://github.com/leaperone/MultiPost-Extension/blob/fdbc6c3b2f3c03f57be8a59b46e33860689ba509/src/sync/common.ts#L16-L21)加上外部消息桥，意味着仅在自带文章 UI 里写死 false 不能构成系统级安全保证。若借鉴该设计，本项目的 DeliveryDesk 接口应当根本不存在“最终发布”枚举值。

### 6. 权限、会话与隐私面

| 项目 | 当前源码 | 风险判断 |
| --- | --- | --- |
| 主机权限 | `host_permissions: ["https://*/*"]`；见[manifest](https://github.com/leaperone/MultiPost-Extension/blob/fdbc6c3b2f3c03f57be8a59b46e33860689ba509/package.json#L70-L82)。 | 可在几乎所有 HTTPS 页面运行平台注入或发同源请求，权限面远大于本项目单一交付目标。 |
| 扩展权限 | `activeTab`、`tabs`、`scripting`、`tabGroups`、`sidePanel`、`clipboardWrite`、`clipboardRead`；同见[manifest](https://github.com/leaperone/MultiPost-Extension/blob/fdbc6c3b2f3c03f57be8a59b46e33860689ba509/package.json#L70-L82)。 | tabs/scripting 是其调度基础；剪贴板读取对“送草稿”不是必需，应避免。 |
| 外部连接声明 | `externally_connectable.matches` 包含 `https://paiban.md/*` 与 `http://localhost:2663/*`；见[manifest](https://github.com/leaperone/MultiPost-Extension/blob/fdbc6c3b2f3c03f57be8a59b46e33860689ba509/package.json#L70-L76)。 | 这是额外的扩展调用面；若自行实现，只应允许本产品固定本地 origin，且仍须校验消息 schema、nonce 与当次人工意图。 |
| 全网页 content script | 消息桥与抓取脚本均匹配 `<all_urls>`，抓取脚本只排除小红书；见[消息桥](https://github.com/leaperone/MultiPost-Extension/blob/fdbc6c3b2f3c03f57be8a59b46e33860689ba509/src/contents/extension.ts#L4-L7)及[抓取脚本](https://github.com/leaperone/MultiPost-Extension/blob/fdbc6c3b2f3c03f57be8a59b46e33860689ba509/src/contents/scraper.ts#L3-L7)。 | 增加对任意网页内容和消息的接触面；本项目应按目标域名声明最小 host allowlist。 |
| 网页调用信任 | 默认信任 `multipost.app`，用户可确认新增域名，源码还支持通配子域名；见[初始化](https://github.com/leaperone/MultiPost-Extension/blob/fdbc6c3b2f3c03f57be8a59b46e33860689ba509/src/background/index.ts#L18-L37)与[域名匹配](https://github.com/leaperone/MultiPost-Extension/blob/fdbc6c3b2f3c03f57be8a59b46e33860689ba509/src/contents/extension.ts#L21-L40)。 | 可信来源一旦被 XSS/供应链攻击，即可请求扩展打开发布流程；应改成固定本地 origin、精确 scheme/host/port、一次一确认。 |
| 登录态 | 依赖目标网站已经登录；X 读取页面时携带 Cookie，微信公众号从页面解析 token/ticket 并调用内部 CGI。 | 无需目标平台 API Key 不等于无需凭据；浏览器 Cookie 与内部 token 是高价值凭据。 |
| 账号信息 | X 账号模块把整个 `__INITIAL_STATE__` 放入 `extraData`，通用账号模块存到扩展 local storage；见[X 账号模块](https://github.com/leaperone/MultiPost-Extension/blob/fdbc6c3b2f3c03f57be8a59b46e33860689ba509/src/sync/account/x.ts#L17-L65)与[存储](https://github.com/leaperone/MultiPost-Extension/blob/fdbc6c3b2f3c03f57be8a59b46e33860689ba509/src/sync/account.ts#L180-L213)。 | 数据量和敏感度均超过“显示当前账号”所需；不应复用整块状态缓存。 |
| 托管轮询 | 有 `apiKey` 时每 30 秒访问 `multipost.app`，可接收 `NEW_TASK` URL；见[远程桥](https://github.com/leaperone/MultiPost-Extension/blob/fdbc6c3b2f3c03f57be8a59b46e33860689ba509/src/background/services/api.ts)。 | 与单用户、本地优先边界冲突；应避免后台常驻外联和远程任务注入。 |

### 7. 可复用模块与 adopt / adapt / avoid

| 决策 | 内容 | 理由与边界 |
| --- | --- | --- |
| **Adopt（采用思想）** | `SyncData`/`PlatformInfo` 的统一内容包与平台注册表；文章/动态/视频/播客分型；为每个平台保留 `homeUrl`、`injectUrl`、账号标识和单独适配器；见[common.ts](https://github.com/leaperone/MultiPost-Extension/blob/fdbc6c3b2f3c03f57be8a59b46e33860689ba509/src/sync/common.ts#L6-L103)。 | 适合映射到本项目 `ContentPackage` → `DeliveryDesk`；复杂 DOM 逻辑保持在平台模块内，不散落到 React 路由。 |
| **Adopt（采用思想）** | 发布标签页分组、单个平台失败可重载、人工切换检查；见[tab manager](https://github.com/leaperone/MultiPost-Extension/blob/fdbc6c3b2f3c03f57be8a59b46e33860689ba509/src/background/services/tabs.ts)。 | 有利于明确展示“已准备”“等待人工检查”“失败”，但必须增加真实回执，不能把创建标签页当成功。 |
| **Adapt（改造后采用）** | 内容和媒体预处理、HTML/Markdown 双轨、图片 blob 化；见[发布预处理](https://github.com/leaperone/MultiPost-Extension/blob/fdbc6c3b2f3c03f57be8a59b46e33860689ba509/src/tabs/publish.tsx#L76-L188)。 | 需保留图片来源、版权状态和原 URL；失败时不能静默跳过导致证据或版式缺失。 |
| **Adapt（改造后采用）** | DOM 填充作为官方接口不可用时的兼容层。 | 每个适配器必须限定域名、固定 `isAutoPublish=false`、注入后停在编辑器、由用户点击最终发布；每次平台改版后需回归测试。 |
| **Adapt（只借方向）** | 微信公众号“创建草稿后打开编辑页”的体验。 | 体验与产品契约一致，但应接入正式草稿箱 API、幂等键和结构化 receipt；不复制网页内部 CGI、页面 token 解析与硬编码裁剪参数。 |
| **Avoid（避免）** | 自动点击发布按钮、Cmd/Ctrl+Enter 兜底、定时无人值守发布，以及任何把 `isAutoPublish` 暴露给前端或外部调用方的接口。 | 与本项目“绝不无人值守最终发布”直接冲突。 |
| **Avoid（避免）** | `<all_urls>`、`https://*/*`、`clipboardRead`、通配 trusted domain、保存完整页面状态。 | 不符合最小权限和本地敏感数据边界。 |
| **Avoid（避免）** | 把 `multipost.app` ping/remote task 机制设为 DeliveryDesk 依赖。 | 该托管服务不在此源码审查范围内，且会把本地工作流变成外部控制面。 |
| **Avoid（避免）** | 直接复制一百多个选择器适配器并宣称“支持”。 | 注册表中有大量实验项；平台 DOM 与私有 CGI 没有兼容性承诺，维护成本和误发布风险过高。 |

### 8. Apache-2.0 复用义务

如果只借鉴架构思想、独立实现，不复制表达性源码，通常不产生代码再分发义务；如果复制或修改源码并分发，则按仓库的 [Apache-2.0 LICENSE](https://github.com/leaperone/MultiPost-Extension/blob/fdbc6c3b2f3c03f57be8a59b46e33860689ba509/LICENSE#L58-L126)至少需要：

- 向接收者提供许可证副本；
- 对修改过的文件作显著修改声明；
- 保留相关版权、专利、商标和归属声明；
- 若上游分发物包含 `NOTICE`，衍生分发物也须按许可证要求携带其中归属内容；本次审查的仓库根目录未见 `NOTICE`，但固定版本/打包前仍应再检查；
- Apache-2.0 包含贡献者专利授权及专利诉讼触发的终止条款，且不授予上游商标使用权。

这不是法律意见；若最终将源码打包进商业产品，应再做依赖级许可证扫描。许可证允许使用代码，不代表目标平台允许依赖其网页私有接口，也不保证这些选择器长期可用。

## 二、X API：只读监控所需的最小开通方案

先设一个政策硬边界：X 的[官方 Developer Guidelines](https://docs.x.com/developer-guidelines#quick-check-is-my-app-allowed)要求只使用官方 API，并把 scraping/browser automation 明确列为可导致永久停用的非 API 自动化；同页还禁止把 X 数据用于未经授权的 AI/ML 模型训练。因此 MultiPost 的 X DOM 注入只能用于理解交互设计，不能成为本项目的 X 采集或投递实现。这里的 X 内容只作为编辑选题与证据材料，不进入模型训练数据集。

这里有一个合规且免费的单条导入例外：X 官方提供 [oEmbed](https://docs.x.com/x-for-websites/oembed-api)，已知公开帖子 URL 可以在无需认证的情况下取得嵌入 HTML；官方文档写明该接口目前没有限速。它只解决“用户已经发现一条帖子，如何少复制一次正文”，不能列举账号时间线、发现新帖或替代自动监控。因此本项目浏览器助手只把用户当次点击的规范 URL 交给工作台，再由服务端调用 oEmbed；扩展不注入 X 页面、不读取 DOM 或 Cookie。串文、媒体原图、已删除或受限帖仍需要人工补充并复核。

### 1. 本项目应申请什么，不应申请什么

本项目当前用途是“读取公开 X 帖子作为新闻发现信号”，不是代表用户发帖。因此最小方案是一个 X Developer Project/App 和一个 **App-only Bearer Token**。

| 能力 | 端点 | App-only Bearer Token | 是否需要 User Context | 本项目决策 |
| --- | --- | --- | --- | --- |
| 用户名解析为稳定 ID | `GET /2/users/by/username/:username` | 支持；[官方端点](https://docs.x.com/x-api/users/get-user-by-username)示例直接使用 Bearer Token | 否 | 使用；首次入库和账号改名复核时调用。 |
| Recent Search | `GET /2/tweets/search/recent` | 支持；[官方快速开始](https://docs.x.com/x-api/posts/search/quickstart/recent-search)要求 App Bearer Token | 否 | 使用；覆盖最近 7 天，适合多个 `from:` 账号合并搜索和短期补漏。 |
| 公开用户发帖时间线 | `GET /2/users/:id/tweets` | 支持 | 可选 | 作为白名单主通道；[认证矩阵](https://docs.x.com/x-api/posts/timelines/integrate#authentication)列明 App-only 与 User Context 都可用。 |
| 用户首页时间线 | `GET /2/users/:id/timelines/reverse_chronological` | 不支持 | 必须，且 ID 必须是已认证用户 | 不使用；它会引入用户授权、关注关系和更大数据面。[时间线说明](https://docs.x.com/x-api/posts/timelines/introduction)明确要求 User Context。 |
| 创建/删除 X 帖子 | `POST /2/tweets`、`DELETE /2/tweets/:id` | 不支持 | 必须，需要用户 Access Token 与写 scope | 不开通；[发帖快速开始](https://docs.x.com/x-api/posts/manage-tweets/quickstart)明确需要 OAuth 1.0a 或 OAuth 2.0 PKCE 用户令牌。 |

[X 的 App-only 认证说明](https://docs.x.com/fundamentals/authentication/oauth-2-0/application-only)把 Bearer Token 定义为应用自身身份，适合搜索和读取公开信息，并强调它不包含“当前用户”。因此：

- 只监控公开账号时，不需要让个人 X 账号走 OAuth 同意页；
- 不生成、不保存 Access Token & Secret 或 OAuth 2.0 refresh token；
- 不开启写权限、DM 权限和回调 URL；
- Bearer Token 仍等同密码，必须只放后端/本机秘密存储，不能进入前端包、日志、截图或仓库。

### 2. Recent Search 与用户时间线如何分工

#### User Posts timeline：白名单主通道

1. 用 `GET /2/users/by/username/{username}` 把 handle 解析成数值 `user_id`，保存原 handle、当前 handle 和 ID；官方[用户查询端点](https://docs.x.com/x-api/users/get-user-by-username)使用 Bearer Token。
2. 每个账号调用 `GET /2/users/{id}/tweets`，设置 `max_results=100`、`since_id`，按需 `exclude=retweets,replies`，并请求 `created_at,author_id,conversation_id,entities,attachments,edit_history_tweet_ids` 等字段。[时间线集成指南](https://docs.x.com/x-api/posts/timelines/integrate)给出 `since_id`、排除项、字段扩展和分页方式。
3. 若返回 `next_token`，用 `pagination_token` 继续直到没有下一页，再推进该账号的 checkpoint；不要先更新 checkpoint 后补页。
4. 该端点最多回取最近 3,200 条；排除 replies 时官方列出的上限为最近 800 条。因此它适合持续增量监控，不是无限历史归档。[官方 volume limits](https://docs.x.com/x-api/posts/timelines/integrate#volume-limits)给出了边界。

优势是账号 ID 稳定、误匹配少、每个账号有独立 checkpoint。代价是白名单越大，请求次数越多；不过当前官方限速表对 app-only 的用户发帖时间线给出 10,000 次/15 分钟，而计费按返回资源而不是按轮询次数。[X API rate limits](https://docs.x.com/x-api/fundamentals/rate-limits)与[按量价格](https://docs.x.com/x-api/getting-started/pricing)分别说明了请求限速和资源计费。

#### Recent Search：合并查询与七日补漏

- 只覆盖最近 7 天，所有开发者可用；单次默认 10 条、最多 100 条。[Recent Search 说明](https://docs.x.com/x-api/posts/search/introduction)与[快速开始](https://docs.x.com/x-api/posts/search/quickstart/recent-search)给出时间窗和 `from:XDevelopers` 示例。
- 可以把小批账号组合成查询，例如 `(from:account_a OR from:account_b) -is:retweet -is:reply`；查询字符串上限和每 App 限速截至本日分别为 512 字符、450 次/15 分钟。[官方限速表](https://docs.x.com/x-api/fundamentals/rate-limits#recent-search)是动态上限的第一来源。
- 返回 `next_token` 时必须持续翻页到结束；官方[分页文档](https://docs.x.com/x-api/posts/search/integrate/paginate)说明结果为倒序、每页最多 100 条，`next_token` 可重复取得同一页。
- 建议每 2–5 分钟轮询，持久化 `since_id`，同时按 Post ID 做幂等去重。服务恢复后可用 7 日窗口补洞；超过 7 日不能依赖 Recent Search 找回。

推荐拓扑是“每个白名单账号的时间线主轮询 + 一个按主题/多账号组合的 Recent Search 校验任务”。二者返回同一 Post 时，按 Post ID 合并为一个 signal；X 帖子只作为发现或作者自述来源，若帖子链接到新闻稿、博客或 GitHub 仓库，应继续抓取原始链接，把原始页面作为事件事实来源。

### 3. 截至 2026-09-04 的按量计费、余额与限额

X 当前采用 credit-based pay-per-use：无固定订阅和最低消费，先在 Developer Console 购买 credits，再按端点扣费；官方明确要求以控制台显示的当前单价为准。[官方价格页](https://docs.x.com/x-api/getting-started/pricing)当前列出的基准价包括：

- Post read：`$0.005 / returned resource`；
- User read：`$0.010 / returned resource`；
- 自有账号的 eligible owned reads：`$0.001 / resource`，仅当 `{id}` 是已认证用户且该用户是 developer app owner 时适用，不应把监控其他博主误算成 owned read；
- 同一资源在 UTC 24 小时窗口内重复读取通常只计费一次，但官方称这是 soft guarantee；
- 余额实时扣减，可能轻微变成负数；余额不足时请求被阻断，补足后恢复；
- 可设置 auto-recharge 的金额和触发阈值，也可设置每个 billing cycle 的 spending limit；达到 spending limit 后阻断请求直到下一个周期。

成本粗算只应用于预算，不应写死到代码：若一天实际返回 100 条互不重复的新 Post，按当前单价约为 `100 × 30 × $0.005 = $15/月`，另加用户名解析等 User reads。空轮询不返回 Post 资源时通常不产生 Post read 费用，但仍消耗请求 rate limit；最终账单以控制台 usage/cost 为准。[Usage & Billing](https://docs.x.com/x-api/fundamentals/post-cap)还明确说失败请求及没有返回数据的请求不计资源费用。

截至本次复核，[价格页](https://docs.x.com/x-api/getting-started/pricing)、[Usage 页面](https://docs.x.com/x-api/usage/introduction)和[Usage & Billing 页面](https://docs.x.com/x-api/fundamentals/post-cap)均写明 PPU 每个 billing cycle 的 Post read cap 为 **3 million**。这仍不是永久常量：实施时应以 Developer Console 和 `GET /2/usage/tweets` 返回的账号级 `project_cap` 为最终真值，并将限额与告警阈值做成可配置项。

首月建议关闭 auto-recharge，只购买最小可接受测试余额，并设置低 spending limit。稳定运行一周、确认日均资源量后再决定是否启用自动充值。可用 `GET /2/usage/tweets` 查看 Post 用量、`GET /2/usage/credits` 查看 PPU 余额；[Usage API](https://docs.x.com/x-api/usage/introduction)列出了这两个官方端点。

### 4. Developer Console 逐步点击/填写清单

X 会调整界面文案；下面把官方文档中的必需步骤和本项目应填写的真实用途合并成一份操作单。若当页把 Project 和 App 合并为一个 `New App` 向导，以当页为准，不要为了照旧截图而创建重复项目。[官方 Getting Access](https://docs.x.com/x-api/getting-started/getting-access)当前简化为“注册 → New App → 保存凭据”，而[官方时间线教程](https://docs.x.com/tutorials/explore-a-users-posts)仍展示“Project → 连接/创建 App”的分步界面。

#### A. 创建开发者身份与 App

- [ ] 打开 [console.x.com](https://console.x.com/)，用准备长期持有的 X 账号登录。
- [ ] 阅读并接受 Developer Agreement 与 Policy；完成开发者 profile。官方流程要求填写如何使用 API 的基本信息。[Getting Access](https://docs.x.com/x-api/getting-started/getting-access#step-1-create-a-developer-account)
- [ ] 用途说明如实填写，可用以下文本再按输入框长度缩短：

  > Single-user, local-first AI and technology editorial desk. The app reads public Posts from a user-maintained whitelist for news discovery, stores source URLs and evidence snapshots, and routes selected items into a human-reviewed draft workflow. It does not resell X data, send DMs, automate engagement, or publish Posts.

- [ ] 点击 `New App`。如向导要求 Project，建议填写：
  - Project name：`AI News Desk`
  - Project description：`Local-first public X monitoring for an AI/technology editorial workflow.`
  - Use case：选择最接近“分析/监控公开内容”或“其他”的真实选项，不要选择广告、机器人发帖或 DM。
- [ ] App name：`AI News Desk X Monitor`（若重名，追加个人缩写或日期）。
- [ ] App description：`Read-only ingestion of public Posts from a curated whitelist; no posting or user actions.`
- [ ] 若控制台展示分开的 Project/App 流程，点击 `Complete/Create` 并把 App 连接到该 Project；若 `New App` 向导已自动完成关联，则不要再创建重复 Project。官方[当前 Getting Access](https://docs.x.com/x-api/getting-started/getting-access#step-2-create-an-app)采用简化向导，而[时间线教程](https://docs.x.com/tutorials/explore-a-users-posts#create-a-project-and-connect-an-app)仍展示显式关联流程。

#### B. 保存最小凭据

- [ ] 完成向导后立即复制 API Key、API Key Secret 和 Bearer Token；若首次页面已关闭，进入该 App 的 `Keys and tokens` 页面生成/重置 Bearer Token。[官方文档](https://docs.x.com/x-api/getting-started/getting-access#step-3-save-your-credentials)提醒凭据只显示一次，重新生成会使旧值失效。
- [ ] 本项目实际运行只配置 Bearer Token。API Key/Secret 可离线保存用于恢复/重新生成，但不要加载到日常进程。
- [ ] 若界面提供 App permissions，选择只读；不要启用 write、DM、OAuth callback，也不要生成用户 Access Token & Secret。本项目使用的三个读取端点都支持 App-only；[OAuth 2.0 概览](https://docs.x.com/fundamentals/authentication/oauth-2-0/overview)说明 Bearer Token 可直接在 App 的 Keys and tokens 中生成。
- [ ] 将令牌存入 Windows Credential Manager/DPAPI 或应用的本地 secret store；配置名可用 `AI_NEWS_X_BEARER_TOKEN`。不要写进 `.env.example`、数据库明文字段、前端 JavaScript、错误日志或研究文档。

#### C. 购买 credits 并封顶

- [ ] 打开 Developer Console 的 Billing/Credits 区域，先查看 Recent Search、User lookup、User Posts timeline 当日实际单价；X 官方明确说不同端点价格以控制台为准。[Pricing](https://docs.x.com/x-api/getting-started/pricing)
- [ ] 添加默认支付方式，购买一笔小额预付 credits。
- [ ] 设置 spending limit。测试期上限应只覆盖预期一周用量与少量重试余量；达到上限宁可进入 `degraded` 并通知用户，也不要无界扣费。
- [ ] 初期关闭 auto-recharge。若以后启用，同时设置较低 recharge amount 与 trigger threshold；官方说明自动充值每 5 分钟最多一次，余额已经为零/负数时不会自动触发。[自动充值保障](https://docs.x.com/x-api/getting-started/pricing#auto-recharge-safeguards)
- [ ] 打开余额/用量提醒；记录控制台当日价格、cap 和 billing cycle 起止时间到本地配置审计记录。

#### D. 三次只读验收

以下命令假设 Bearer Token 已由本机 secret loader 注入当前 PowerShell 的 `$env:AI_NEWS_X_BEARER_TOKEN`；不要把真实值粘贴进命令历史。Windows 下使用 `curl.exe`，避免 PowerShell 的 `curl` 别名差异。

1. 用户名解析为 ID：

   ```powershell
   curl.exe -sS -D - --get "https://api.x.com/2/users/by/username/XDevelopers" `
     --header "Authorization: Bearer $env:AI_NEWS_X_BEARER_TOKEN" `
     --data-urlencode "user.fields=id,name,username,protected"
   ```

   预期：HTTP 200，响应有 `data.id`；并检查 `x-rate-limit-limit`、`x-rate-limit-remaining`、`x-rate-limit-reset`。端点定义见[官方 User Lookup](https://docs.x.com/x-api/users/get-user-by-username)。

2. Recent Search：

   ```powershell
   curl.exe -sS -D - --get "https://api.x.com/2/tweets/search/recent" `
     --header "Authorization: Bearer $env:AI_NEWS_X_BEARER_TOKEN" `
     --data-urlencode "query=from:XDevelopers -is:retweet -is:reply" `
     --data-urlencode "max_results=10" `
     --data-urlencode "tweet.fields=created_at,author_id,conversation_id,entities,edit_history_tweet_ids"
   ```

   预期：HTTP 200；无新帖时允许没有 `data`，有结果时保存 `meta.newest_id` 和 Post ID。请求格式与 `from:` 操作符见[Recent Search Quickstart](https://docs.x.com/x-api/posts/search/quickstart/recent-search)。

3. 用户时间线：把上一步用户查询得到的 ID 代入：

   ```powershell
   curl.exe -sS -D - --get "https://api.x.com/2/users/USER_ID/tweets" `
     --header "Authorization: Bearer $env:AI_NEWS_X_BEARER_TOKEN" `
     --data-urlencode "max_results=10" `
     --data-urlencode "exclude=retweets,replies" `
     --data-urlencode "tweet.fields=created_at,author_id,conversation_id,entities,attachments,edit_history_tweet_ids"
   ```

   预期：HTTP 200；确认它只返回该 `USER_ID` 的公开帖子。认证和参数见[时间线集成指南](https://docs.x.com/x-api/posts/timelines/integrate)。

验收后再调用一次 `GET /2/usage/tweets` 与 `GET /2/usage/credits`，确认控制台和 API 两侧都能看到用量/余额；端点见[Usage API](https://docs.x.com/x-api/usage/introduction)。出现 401 时检查 Bearer Token，403 时检查 App/Project/credits 与端点权限，429 时读取响应头并等待 `x-rate-limit-reset`，不要高速重试。[官方 rate-limit 文档](https://docs.x.com/x-api/fundamentals/rate-limits)定义了这些响应头。

## 三、落到 AI News Desk 的推荐边界

### Adopt

- 在 `SourceDesk` 增加正式 X API 只读适配器，输入是用户维护的白名单，内部把 handle 解析为稳定 user ID。
- 借鉴 MultiPost 的“统一内容包 + 平台注册表 + 独立适配器 + 标签页检查”思想，但由现有 `ContentPackage`、`DeliveryDesk` 接口承载，不引入第二套领域模型。
- X 入库保留原始 Post ID、作者 ID/handle、原 URL、抓取时间、原始 JSON 快照、编辑历史 ID、外链及媒体 provenance；同一 Post ID 幂等。
- 对每个账号持久化 `since_id`，分页完成后再提交 checkpoint；429、余额不足、凭据失效分别进入可解释的 `throttled`、`out_of_credit`、`auth_failed` 状态。
- 发布侧只允许 `create_draft` 或 `open_editor`，成功必须返回平台草稿 ID/编辑 URL/时间戳等结构化 receipt；“打开了标签页”不算成功。

### Adapt

- MultiPost 的 DOM 注入只作为兼容方案：固定目标域名、按平台最小权限、人工确认后才启动、永远不点击最终发布。
- 微信公众号可以保留“同步草稿后打开编辑器”的体验，但底层优先正式接口；只有在用户显式选择兼容模式时才考虑网页注入，并清楚显示脆弱性和失败原因。
- Recent Search 用于多账号合并和七日补漏；User Posts timeline 用于稳定白名单。两路数据合并后仍只是 `Signal`，不能把“X 上有人发了/在讨论”自动写成事件事实。
- 价格、rate limit、月 cap 做运行时配置和控制台审计，不写死成永久常量；截至 2026-09-04 三个相关官方页面均显示 3M/月，但运行时仍以控制台和 Usage API 返回的 `project_cap` 为准。

### Avoid

- 不把 MultiPost 整个扩展作为运行时依赖，不接入其 `multipost.app` 30 秒 ping 或远程任务 URL。
- 不申请 X 写权限，不保存用户 Access Token，不调用 `POST /2/tweets`，不做无人值守发帖。
- 不复制 X/其他平台的自动点击“发布”、快捷键提交或定时发布代码。
- 不用 MultiPost 的 X DOM 注入、浏览器自动化或抓取代替 X API；X 的[官方 Developer Guidelines](https://docs.x.com/developer-guidelines#prohibited-activities)明确禁止 non-API automation，并说明可能导致永久停用。
- 不使用 `<all_urls>`、`https://*/*`、剪贴板读取、通配 trusted domains，也不保存整份页面 `__INITIAL_STATE__`。
- 不把网页 Cookie、内部 CGI token 或 DOM 选择器当成稳定 API；不因 Apache-2.0 允许复制代码，就推定平台条款允许自动操作。

## 四、建议的实施顺序与完成标准

1. **先开通 X 只读 API。** 完成上面的账号、App、credits、spending limit 和三次只读验收；不产生任何 X 写凭据。
2. **实现最小 SourceDesk 适配器。** 首批只接 5–20 个白名单账号的 User Posts timeline，2–5 分钟增量轮询；Recent Search 做七日补漏。
3. **跑一周成本与漏报观测。** 每日记录返回新 Post 数、重复率、429、端到端延迟、credits 消耗；以真实控制台账单决定轮询频率和额度。
4. **再做投递侧适配。** 优先 WeChat 正式草稿箱；DOM 注入只作为有显式开关的兼容层，停在编辑器。
5. **把 MultiPost 当设计参考而非“现成发布 SDK”。** 若确需复制某个通用模块，固定 commit、保留 Apache-2.0 归属、标记修改，并为该模块写“不可能触发最终发布”的契约测试。

完成标准：监控链路只有 App-only Bearer Token；余额和 spending limit 可见；白名单增量可重放且去重；任何交付动作最多到草稿/编辑器；代码和 UI 中不存在自动最终发布入口；失败不会被“标签页已打开”伪装为成功。
