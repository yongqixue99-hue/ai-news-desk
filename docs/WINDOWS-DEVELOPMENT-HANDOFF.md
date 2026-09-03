# AI 新闻台 Windows 开发接续文档

更新时间：2026-09-02

代码仓库：<https://github.com/yongqixue99-hue/ai-news-desk>

默认分支：`main`

## 1. 先说项目现在处于什么阶段

这不是一个只有概念的新闻摘要 Demo。采集、Story 聚合、中文速读、稿型路由、事实素材包、图文草稿、版本、图片治理、微信公众号草稿同步和本地任务恢复都有真实代码与测试。

但它也还不是“已经成熟、可以完全放着不管”的正式产品。准确定位是：

> 可真实试用的本地个人版，核心生产链路和跨系统数据迁移已经建立，接下来应停止堆基础功能，进入真实公众号内容试用。

2026-09-02 的代码基线：

- `npm test`：Windows 当前为 524/524 通过；不同 shell 或平台发现数量可能不同，交付门槛始终是 0 fail。
- `npm run eval:editorial`：人工编辑黄金集 22/22 通过。
- `npm run build`：通过。
- 桌面端与 390×844 手机端草稿页已做真实浏览器检查。
- 浏览器控制台无 error。

本地 Mac 数据当时有 10 篇当前草稿和 10 篇历史旧稿。这个数字属于 Mac 的 `.workflow`，不会出现在 GitHub 克隆中。

## 2. 产品最终服务谁

产品用户是公众号创作者本人；文章读者是对 AI 和科技感兴趣的普通读者，不只面向小黑盒用户或开发者。

默认工作流：

```text
自动读源
→ 跨来源聚合为 Story
→ 今日推荐
→ 用户选择值得写的题目
→ 冻结事实、社区和图片素材包
→ 生成图文草稿
→ 用户编辑
→ 同步微信公众号草稿箱
→ 用户在微信后台手动发布
→ 发布结果与修改偏好回流
```

已经锁定不做：

- 不做公开 SaaS、多租户、团队权限和计费。
- 不扩成全品类新闻平台，主线仍是 AI 与科技。
- 不自动群发，不替用户点击最终发布。
- 不默认整篇转载或翻译他人文章。
- 不用无关 AI 生图填补素材不足。
- 微信成熟前不继续扩张更多发布平台。
- 比赛展示已经降为次要，个人实际使用体验优先。

## 3. 我们讨论后确定的内容方法

### 3.1 新闻和社区分开浏览，底层汇入同一个 Story

新闻工作台展示官方、媒体和研究内容；社区广场展示 Hacker News、GitHub、V2EX、知乎和 Last30days 等社区信号。用户可以分别浏览，但同一事件在底层会聚合成同一个 Story。

社区不是一种固定稿型，而是三种不同材料：

1. **社区帖子链接了外部文章或项目**

   默认回到外部页面写新闻。社区只负责发现选题和补充讨论。Open Executive 就属于这一类：GitHub 仓库是新闻事实主体，Hacker News 不是事件主体。

2. **作者在社区发布了完整自述或方案**

   可以建立私人原文工作副本，保留作者、原文、链接与图片，供用户专项修改。进入草稿箱不等于取得转载或翻译权。

3. **讨论本身值得观察**

   只有用户选择社区稿，且样本数量达到要求时，才写社区观察。热评不能冒充新闻，也不能用一条高赞评论代表整个社区。

社区门槛：

- 少于 5 条有效评论：只能说“有限样本中有人提出”。
- 5–14 条：可以列出观点，不能宣称多数或共识。
- 至少 15 条且覆盖 5 个独立讨论分支：才允许提炼反复主题。
- 同一观点至少 3 名独立作者支持，才能标记为多次出现。
- 主要分歧的两侧各至少有 2 条独立样本。
- 原句与中文翻译分开保存，引用必须能回到永久链接。

### 3.2 不是所有文章都应该被重写

稿型由 `EditorialDesk` 在以下模式中选择：

- `Brief`：事实单一、明确，写短快讯。
- `Synthesis`：两个以上独立来源有信息增量，写多源综合。
- `Community`：事实清楚、讨论样本充分，写社区观察。
- `Playbook`：存在可验证步骤和多个真实经验，写方案或教程。
- `Curate`：原文已经很好，只写导读、价值、有限引用和链接。
- `Watch`：值得关注但证据还不完整，不生成文章。
- `Skip`：重复、过期、无关、证据弱或风险高。

用户可以切换稿型，但不能绕过事实和版权阻断。

### 3.3 首页必须让人不用打开英文原文就能判断

首页和 Story 阅读器需要直接给出：

- 中文标题与原标题。
- 发生了什么。
- 为什么现在值得看。
- 具体事实与未知项。
- 社区在讨论什么。
- 热度变化。
- 原图数量和证据强弱。

双栏阅读器的目标是：左侧看来源、证据与图片，右侧像编辑同事一样自然讲清事件。不要再堆“实际影响、影响对象、来源贡献”这种报告式固定栏目。

今日页默认准备 3 条必看、5 条次级候选。超过 48 小时且未进入编辑流程的内容退出首屏，但历史记录不删除。

### 3.4 文字是弱项时，图片必须成为优势

图片优先级已经确定：

1. 原文合格图片。
2. 同一 Story 历史快照中的图片。
3. 官方或其他核验来源的相关图片。
4. 原网页中的图表、产品界面和代码区域截图。
5. 社区原句局部截图。
6. 根据已核验事实确定性生成的引用卡、时间线或对比卡。
7. 没有合格素材就明确无图，不生成无关 AI 图片。

来源有多张相关图片时，私人草稿应优先插入至少 2 张，而不是只把图片放进托盘。每张图保存来源、署名、原链接、指纹、权利状态、适用平台、视觉角色、正文位置和图注。

`blocked` 不能同步，`warning` 在发布阶段集中提示，`allowed` 才可直接使用。

### 3.5 去 AI 味不是把全文再洗一遍

写作质量的核心顺序：事实准确 → 原文理解 → 信息取舍 → 自然表达 → 表面句式。

- 默认执行 lieflat 明确白名单审校。
- `ra-人话` 只用于评论稿或用户明确要求加强人话表达。
- 原稿已经自然、具体、准确时返回“保留”，不强行改写。
- 修改只能用精确文本补丁，不能覆盖用户已经修改的整篇正文。
- 避免聊天残留、宣传词、抽象套话、二元翻案、伪洞察、机械小标题和无来源权威。
- 不为追求所谓 AI 检测器低分而破坏事实或正常中文。

当前 AI 引擎是可替换的。默认可使用 Codex 的 ChatGPT 登录状态，也支持兼容 API；项目没有把文章质量押在 Gemini 或某一个模型上。确定性质量门独立于模型。

### 3.6 来源数量不是唯一目标

来源系统已经覆盖 RSS、站内频道、Google News 检索、Hacker News、GitHub、V2EX、知乎、Last30days 和 X 官方账号等路线。后续不要只追求继续加来源；更重要的是：

- 来源角色清楚：官方、研究、独立核验、发现、社区。
- 单个来源失败不影响其他来源。
- 同一事件去重并保留增量。
- 社区热度不直接跨平台相加。
- 过期候选自动退出首页。
- 用户不用打开英文网页也能先判断价值。

Last30days 很重要，但它负责最近 30 天社区趋势和直接证据入口，不替代事实来源。首次使用涉及 Cookie 或登录授权时，后台不能越权初始化。

### 3.7 微信只同步草稿，不替用户发布

微信公众号是第一交付通道：

- 首次同步创建草稿。
- 再次同步更新同一个 `media_id`。
- 内容没有变化时跳过重复上传。
- 同步前检查事实、封面、正文图片和微信使用许可。
- 接口不可用时提供“复制公众号排版”。
- 系统不实现群发或最终发布调用。
- 用户在微信后台发布后，回到系统确认，才进入学习和素材沉淀。

## 4. 近期关键修复

### 4.1 2026-09-01：降低用户决策压力

问题来自真实案例：社区里一条高热度 Open Executive 选题，旧流程生成了围绕一条 Hacker News 热评的文章，正文不像新闻，也把评论错误放进事实核验。

已经修复：

- 社区发现过程在素材包阶段就从新闻事实中剔除，不只是前端隐藏。
- Open Executive 的新闻素材包只保留 GitHub 正文支持的许可证、Agent 组成和技术栈三类事实。
- 新闻模式的社区评论样本默认为 0；HN 仍保留为发现线索。
- 社区渠道不能成为新闻标题、导语或错误映射到项目来源的事实。
- 可以在事实之后有限说明发现路径，但必须回指社区链接，不能冒充事件事实。
- 资料栏把“事件来源、发现线索、正文事实、已知边界、发布期权利”分开。
- 自动支持的事实不再要求用户逐条勾选；只有真正的弱事实才要求决定。
- 老生成器草稿和同源重复尝试自动移入“历史旧稿”，不删除内容。
- 草稿默认打开当前最高安全版本，顶部直接提示“草稿已生成，先看正文即可”。

相关核心文件：

- `server/package-desk.ts`
- `server/editorial-source-policy.ts`
- `server/editorial-quality-desk.ts`
- `server/draft-evidence-view.ts`
- `server/draft-catalog.ts`
- `src/components/DraftEvidencePanel.tsx`
- `src/components/DraftWorkspace.tsx`

### 4.2 2026-09-02：让可修复草稿不再被整单丢弃

问题来自两次真实成稿失败：素材包已经带入不可用事实或重复图片，任务仍对同一输入重试三次；即使正文事实安全，只要篇幅或图片数量不足，生成结果也会在末尾被丢弃。

已经修复：

- 事实越界、来源错位、评论污染和图片权利问题继续硬阻断；内容覆盖与图片数量不足改为警告并保留草稿。
- 草稿页直接展示“事实安全、内容完整、图片与权利、表达质量”四个维度，并把下一动作指向证据、图片或定向补写。
- 每次生成保存候选草稿、质量报告、状态和追踪 ID；即使被硬阻断也可复现，不再只剩笼统失败消息。
- 任务失败分成瞬时、可修复、确定性三类；只有网络、限流等瞬时故障自动重试。
- 图片发现、素材包和成稿按 SHA-256 统一去重；同一文件换 URL 或换资源 ID 仍只算一张。
- 人物、公司图等身份素材必须与 Story 实体匹配；产品名不会再被误当成人物或公司搜索词。
- “被转到 Hacker News”等被动发现语句会从新闻事实中剔除，裸露的平台名称不再被误判为社区发现过程。

相关核心文件：

- `server/editorial-quality-desk.ts`
- `server/draft-generation-attempt.ts`
- `server/job-desk.ts`
- `server/editorial-image-policy.ts`
- `server/online-image-search.ts`
- `server/package-desk.ts`
- `src/draft-quality-view.ts`
- `src/components/DraftWorkspace.tsx`

### 4.3 2026-09-02：用事实覆盖替代字数门槛，并接通一次定向补写

用户真实试稿暴露出两个相反误判：三四行但已讲完全部事实的简讯可能被嫌短；看起来很长、实际只重复少数事实的稿件又可能被当成完整。旧生成器还把整个 ContentPackage 事实列表直接挂到草稿上，质量门无法知道每个段落究竟使用了哪些事实。

已经修复：

- 生成结构新增 `paragraphFactIds`；每个正文段落必须登记实际使用的包内事实 ID，并同时回指支持这些事实的来源 URL。包外 ID 或事实与来源错配会停止保存。
- 完整度按受支持事实的覆盖率以及“事件、机制、影响、限制”维度检查，不再用固定 500 字阈值。
- 草稿页明确显示“已覆盖 n/m 条事实”和缺失维度；短但完整的稿件直接通过，长但欠覆盖的稿件继续提示。
- “定向补写”只读取冻结 ContentPackage 中尚未覆盖且已支持的事实，不重新抓网页、不引入模型记忆，只能返回现有正文段落的精确补丁。
- 同一草稿修订最多生成一次定向补写建议；应用补丁时把新增事实 ID 绑定回冻结来源，保存后重跑全部质量门。标题、结语或事实编号不合法的补丁不会自动应用。
- v11 及更早的旧稿没有逐段事实映射，界面会明确要求用当前生成器重建，不会把“缺少元数据”误判成“正文一条事实都没写”并自动重复补写。
- 黄金集扩至 22 条，新增“短而完整”和“长而重复”两条人工标注反例。

相关核心文件：

- `server/generator.ts`
- `server/editorial-quality-desk.ts`
- `server/article-agent.ts`
- `server/index.ts`
- `src/draft-quality-view.ts`
- `src/components/DraftWorkspace.tsx`

## 5. 代码架构和入口

七个领域边界：

```text
SourceDesk     采集、限流、缓存、健康和失败隔离
StoryDesk      去重、聚合、历史、趋势和过期
EditorialDesk  稿型、受众价值、证据与阻断
PackageDesk    冻结事实、社区样本、原文与图片
DraftDesk      成稿、质量门、编辑、版本和生命周期
DeliveryDesk   微信/小黑盒适配、幂等同步和回执
LearningDesk   显式反馈和可解释编辑记忆
```

常用代码位置：

- 后端入口：`server/index.ts`
- 类型：`server/types.ts`、`server/product-types.ts`
- 本地 SQLite：`server/local-database.ts`、`server/storage.ts`
- 任务队列：`server/job-desk.ts`
- 来源与 Story：`server/source-desk.ts`、`server/story-desk.ts`
- 素材包与草稿：`server/package-desk.ts`、`server/draft-desk.ts`
- 视觉：`server/visual-desk.ts`
- 微信：`server/wechat-draft.ts`、`server/wechat-sync-coordinator.ts`
- 前端入口：`src/App.tsx`
- 今日页：`src/components/TodayPage.tsx`
- 社区：`src/components/CommunityWorkspace.tsx`
- 草稿：`src/components/DraftWorkspace.tsx`
- Windows 脚本：`scripts/*.ps1`

不要把领域判断重新塞回 React 页面或 HTTP 路由。页面应读取这些模块给出的明确状态。

## 6. Windows 上第一次接续

在 PowerShell 中执行：

```powershell
git clone https://github.com/yongqixue99-hue/ai-news-desk.git
Set-Location .\ai-news-desk

node --version
npm --version
npm ci
npm test
npm run eval:editorial
npm run build
npm run dev
```

要求：

- Node.js 使用 22.x，最低 22.16.0，不要直接用 23/24/更高主版本。
- npm 使用 10.9.x。
- `.node-version` 已固定为 `22.16.0`。
- 打开 <http://127.0.0.1:4317>。

先以 `npm run dev` 手动启动。确认测试、构建、页面和健康接口都正常后，再安装开机任务：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-windows-service.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\verify-windows-service.ps1
```

后台日志位于 `.workflow\logs\windows-service.log`。

## 7. GitHub 不包含哪些东西

`.gitignore` 会排除：

- `node_modules/`
- `dist/`
- `.workflow/`
- 日志、测试报告和临时产物

因此 GitHub 只负责代码和文档，不携带：

- Mac 上的候选、草稿、图片、素材和任务历史。
- macOS 钥匙串中的 API Key、AppSecret 或 X Token。
- 浏览器登录状态和 Chrome 本地配置。
- Mac 用户目录里的个人 Skill。

Windows 上需要重新配置 Codex 登录、第三方 API、微信公众号 AppSecret、IP 白名单以及需要授权的社区来源。

## 8. Mac 数据迁往 Windows 的真实边界

如果只是继续开发，可以在 Windows 使用全新的 `.workflow`；如果需要带走真实草稿和图片，使用完整归档迁移。

如果需要带走文字状态：

1. 在 Mac 的“自动化 → 本地数据与迁移”导出轻量 JSON。
2. 把 JSON 复制到 Windows。
3. Windows 启动工作台后使用“恢复备份”。

这会恢复来源、运行、草稿和素材元数据，但 Mac 图片的绝对路径在 Windows 会安全失效，需要重新下载或重新导入。

完整迁移已经实现：

1. 在 Mac 的“自动化 → 本地数据与迁移”点击“导出完整归档”。
2. 把 `.tar.gz` 复制到 Windows，不要放进 Git 仓库。
3. Windows 启动工作台后点击“预检完整归档”。预检只校验 manifest、SHA-256、SQLite 状态、文件数量和路径方案，不写入数据。
4. 查看可自动重定位、缺失和需重新绑定的路径数量，再点击“确认覆盖并导入”。
5. 系统先创建本机检查点，再事务替换数据库、媒体和素材；失败自动回滚，相同归档重复导入不会再次覆盖。
6. macOS 旧归档中的 AppleDouble `._*` 元数据会在安全限额内丢弃且绝不落盘；新导出会从源头禁止写入这些元数据。
7. 密钥、浏览器登录和个人 Skill 仍不迁移，必须在 Windows 重新配置。

预检标成 missing 或 blocked 的外部路径必须明确重新绑定，不能靠关闭路径或 SHA-256 检查“修好”。不要在服务运行时手工解压或覆盖 `.workflow`，也不要为了迁移关闭路径、指纹、权限或后台任务检查。下一步是拿一份真实 Mac 完整归档做一次受控迁移演练，而不是继续实现一套重复的导入器。

## 9. Windows 端默认开发顺序

无需重新讨论方向，按以下顺序继续：

### P0：真实迁移与内容修复闭环验收（实现已完成）

1. 用真实 Mac `.tar.gz` 先做只读预检，再在用户确认后导入；核对草稿、素材、媒体数量、路径重定位和 SHA-256。
2. 选择至少 3 个有 5 条以上受支持事实的真实新闻包，分别验证“短而完整直接通过”“覆盖不足出现明确缺口”“一次定向补写后警告正确变化”。
3. 对仍有 missing／blocked 路径的素材只做明确重新绑定，不放宽原生路径和指纹检查。
4. Windows 重新配置 Codex、第三方模型和微信公众号密钥；密钥继续排除在归档与日志之外。

### P1：真实内容试用（当前下一步）

1. 连续完成 12 篇真实公众号草稿，而不是继续堆功能。
2. 覆盖官方新闻、媒体综合、社区发现新闻、自述工作副本和社区观察。
3. 记录选题到草稿的耗时、用户实际删除内容、图片使用率和阻断原因。
4. 发现文章不通顺时先修素材包、稿型和事实主干，不先增加“去 AI 味”提示词。

### P2：微信公众号实测

1. 在用户完成 AppID/AppSecret/IP 白名单后，只做只读连接测试。
2. 连续新建并更新 3 篇真实微信草稿，确认不产生重复 `media_id`。
3. 检查手机预览、封面裁切、图片清晰度和图注。
4. 最终发布继续由用户在微信后台完成。

### P3：减少运营噪声

1. 把大量来源故障和旧通知合并为诊断摘要。
2. 首页只展示真正值得处理的 3+5 条内容。
3. 只在用户需要做决定时显示阻断，其余信息折叠。
4. 积累至少 5 次有效人工编辑后，再启用透明写作记忆。

## 10. 每次修改后的验收

```powershell
npm test
npm run eval:editorial
npm run build
```

内容改动还要检查：

- 新闻导语直接说事件，不先说社区热度。
- 新闻稿没有携带评论语料。
- 每个事实段落能回到对应来源。
- 有两张相关原图时优先完整使用；若暂时只有一张，保留草稿并明确显示图片完整度警告，不伪装成可发布。
- 事实不足时停在 Watch/Skip，不勉强成稿。
- 图片权利不足时阻断同步，不伪装可发布。
- 原文已经优秀时允许保留或 Curate。
- 手机端不会把用户困在多层面板里。
- 最终发布永远需要用户操作。

## 11. Windows 上推荐的 Git 工作方式

开始工作前：

```powershell
git status --short --branch
git pull --ff-only
git switch -c codex/windows-next
```

- `git status --short --branch`：查看分支和本地改动。
- `git pull --ff-only`：只允许安全快进，避免 Git 静默生成合并提交。
- `git switch -c codex/windows-next`：新建独立开发分支，不直接在 `main` 上堆未完成工作。

完成一个可验证阶段后：

```powershell
git status --short
git diff --check
git add -A
git commit -m "feat: continue Windows development"
git push -u origin codex/windows-next
```

不要提交 `.workflow`、密钥、导出的完整归档、日志、`node_modules` 或 `dist`。

## 12. 给下一位 Codex 的开场指令

在 Windows 的 Codex 中可以直接发送：

> 先完整阅读 AGENTS.md、README.md、docs/mature-personal-product.md 和 docs/WINDOWS-DEVELOPMENT-HANDOFF.md。运行 npm test、npm run eval:editorial、npm run build，确认 0 fail。不要改写产品方向，不要触碰或提交 .workflow。跨系统完整归档迁移和事实覆盖定向补写已经实现；下一步先预检一份真实 Mac 归档，再用真实 ContentPackage 验证短而完整、覆盖不足和一次定向补写，并进入 P1 连续制作 12 篇公众号草稿，记录耗时、终稿删除内容、图片使用率和阻断原因。发现缺陷时先写失败测试，优先修素材包、稿型和事实主干，不继续叠加去 AI 味提示词。每次使用 Git 命令前，用中文说明命令作用和预期结果。

这样下一次对话不需要重新解释本项目为什么重新闻事实、社区边界、原图和人工最终发布。

## 13. 2026-09-03 Windows 真实采集复验

本轮没有继续堆页面功能，而是用 OpenAI、Anthropic、Google DeepMind、Gemini、DeepSeek、Qwen 六个官方来源完成一次真实采集。运行 `run_20260903140601_1898b1` 在约 56 秒内完成：303 条原始记录进入窗口过滤，形成 5 条候选并生成 5/5 中文速读；Today 最终保持 8 条可写推荐。复验后确认并修复：

- Anthropic sitemap 会把一批页面写成完全相同的构建时间。现在同一 `lastmod` 达到 10 条时只标记为 `shared-batch`，不再伪装成每个页面的发布时间。
- Story 的 `publishedAt` 固定为最早的事实性发布时间，后续重复观察只推进 `lastSeenAt`；历史 sitemap 构建时间因此不能再把旧事件伪装成刚发生。
- Windows 计划任务可能没有 npm shim 所在的 PATH。Provider、健康检查与旧状态接口现在会直接解析最新的 Codex Desktop `codex.exe`，真实中文速读不再报 `spawn codex ENOENT`。
- Workshop、Coworkshop、Webinar、Founder House 等招募活动保留为候选线索，但有明确降权，不能只靠“更新更近”与正式模型发布并列。
- 模型资料补全增加厂商一致性检查；另一模型厂商的第一方文档不能补入当前发布。StoryDesk 同时在读取阶段隔离历史污染记录，因此不删除旧运行也能让当前故事恢复正确来源、图片和资料完整度。

本轮最终基线：`npm test` 580/580、编辑质量黄金集 22/22、`npm run build` 通过。Windows 计划任务已恢复常驻，Codex 与 Horizon 健康；Chrome 填入助手尚未连接，所以发布通道仍显示警告，不影响采集与编辑。

仍需按真实试用推进：

1. Gemini 独立来源、DeepSeek 和 Qwen 在这次 2026-09-02 至 2026-09-03 窗口内没有形成候选；Google DeepMind 路线能发现 Gemini 发布，但应继续观察这些独立路线是“确实无更新”还是路由覆盖不足。
2. X 官方账号路线已经实现，但必须由用户配置 Bearer Token 并显式启用；未配置时不要声称正在监控。
3. 选择本次模型发布 Story 创建一篇人工优先草稿，核对官方介绍、接入、规格、价格、跑分、安全文档和图片是否真正支持正文，再记录缺口。
4. 旧错误信号保留在历史运行中并由 StoryDesk 动态隔离；未经用户确认不要直接改写或清理 `.workflow`。

## 14. 2026-09-04 X / Gemini 零新增支出接力

本轮把“0 成本”的产品边界明确收窄为 **只限制 X API 与 Gemini API**。这不是全局禁用付费 Provider：DeepSeek、通义、OpenAI API 及其他已配置服务保持原配置和原角色。Windows 当前真实运行状态为：长文主写作、分析和优化使用 `codex-cli`，Tab 补全继续使用已配置的 DeepSeek `deepseek-v4-flash`；Gemini 未配置 API Key；X 未配置 Bearer Token，也未进入自动采集。

已落地两条无需新增 API 支出的人工接力：

1. “新闻源”顶部提供 X 免费监控流程：复制重点账号清单，在 X 网页建立私人 List；发现重要原帖后复制链接和正文。
2. “新闻工作台 → 快速起稿 → X 原帖”接收用户复制的原帖证据，不调用 X API，并先进入证据核对。X 内容默认是 discovery，身份和原始上下文未经核对不能自动成为新闻事实。
3. 草稿 Agent 面板提供 Gemini 网页版接力：只复制经过事实边界约束的写作提示词，由用户在 Gemini 网页粘贴和取回答案；系统不接管浏览器 Cookie，不抓取登录态，也不自动覆盖用户正文。
4. 详细操作见 `docs/X-GEMINI-ZERO-COST-WORKFLOW.md`。

费用保护打开时，服务端会同时阻止 UI 和显式接口绕过：X 自动来源不能启用、测试或手工指定采集；Gemini 不能被激活、测试、分配角色或调用。关闭保护只解除限制，不会自动启用来源或发起付费请求，也不会删除已有凭据。

Windows 计划任务在本轮重启并复验。另修复了机器上同时存在项目 Node 与 Codex 内置 Node 时，校验脚本把多个 `node.exe` 路径拼接后误报失败的问题。最终基线：`npm test` 590/590、编辑质量黄金集 22/22、`npm run build` 通过；计划任务、4317 监听进程和健康接口均通过。构建仍提示 `DraftWorkspace` 压缩前约 584 KB，属于后续按需拆包的非阻断性能事项。

## 15. 2026-09-04 MultiPost 调研、分发台与 X 单条免费导入

本轮审计了 `leaperone/MultiPost-Extension` 的固定提交与 Apache-2.0 边界。结论是吸收“统一内容包、平台注册表、独立适配器、按平台展示状态”的结构，不把该扩展整体引入运行时：它使用大范围网页权限、DOM/私有接口、远程任务与可选自动发布，这些都不符合本项目的本地优先、最小权限和人工最终发布边界。详细证据与 X 官方 API 配置见 `docs/research/2026-09-04-multipost-and-x-api-setup.md`。

已经落地：

1. 草稿发布侧栏改为“一稿多投 / 多平台分发台”。同一正文只编辑一份；微信公众号和小黑盒分别显示“可准备、需连接、已送达、正文已改需更新”，并沿用现有正式草稿箱/编辑器交付。知乎、小红书和 X 线程只显示为未接入路线，不伪装成可用；任何渠道最终发布仍由用户完成。
2. X 免费人工接力不再要求复制正文。用户在单条原帖页点击浏览器助手后，扩展只凭 `activeTab` 读取当前 URL，规范化后交给本地工作台；服务端使用 X 官方无需认证的 oEmbed 读取公开正文，10 秒超时，失败时提示手工粘贴。
3. 删除了 X 页面 content script 与 X/Twitter 常驻 host permission。扩展不读取 X DOM、Cookie 或后台时间线，版本提升为 `0.1.20`；用户需要在 `chrome://extensions` 对已加载扩展点击一次“重新加载”。
4. oEmbed 只解决已知单条 URL 的导入，不是监控。免费持续发现仍用 X 私人 List；真正无人值守监控仍需 X 官方付费 API。新闻源页现已内置 Developer Console、Bearer Token、credits、spending limit、关闭自动充值、DPAPI 保存与单源测试的五步说明。

验证结果：X 官方 oEmbed 实网请求返回 HTTP 200；定向测试 12/12 通过；完整 `npm test` 595/595、编辑质量黄金集 22/22、`npm run build` 通过。Windows 计划任务已用项目脚本更新并重启，4317 页面与健康接口均为 200；Codex、Horizon 正常。Publisher 仍显示未连接，直到用户重新加载 `chrome-extension/` 并刷新工作台。构建提示 `DraftWorkspace` 压缩前约 586 KB，仍是后续按需拆包的非阻断性能事项。
