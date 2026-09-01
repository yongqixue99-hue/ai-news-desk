# AI 新闻台 Windows 开发接续文档

更新时间：2026-09-01

代码仓库：<https://github.com/yongqixue99-hue/ai-news-desk>

默认分支：`main`

## 1. 先说项目现在处于什么阶段

这不是一个只有概念的新闻摘要 Demo。采集、Story 聚合、中文速读、稿型路由、事实素材包、图文草稿、版本、图片治理、微信公众号草稿同步和本地任务恢复都有真实代码与测试。

但它也还不是“已经成熟、可以完全放着不管”的正式产品。准确定位是：

> 可真实试用的本地个人版，核心生产链路已经建立，接下来需要在 Windows 上继续做跨系统数据迁移和真实公众号试用。

2026-09-01 的代码基线：

- `npm test`：448/448 通过。
- `npm run eval:editorial`：人工编辑黄金集 20/20 通过。
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

## 4. 2026-09-01 最新修复：降低用户决策压力

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

如果只是继续开发，建议在 Windows 使用全新的 `.workflow`，这是最稳妥的默认方案。

如果需要带走文字状态：

1. 在 Mac 的“自动化 → 本地数据与迁移”导出轻量 JSON。
2. 把 JSON 复制到 Windows。
3. Windows 启动工作台后使用“恢复备份”。

这会恢复来源、运行、草稿和素材元数据，但 Mac 图片的绝对路径在 Windows 会安全失效，需要重新下载或重新导入。

“导出完整归档”会包含 SQLite、媒体、素材和 SHA-256 manifest，适合作为完整备份；当前版本还没有把 `.tar.gz` 一键导入并自动把 macOS 路径改写为 Windows 路径的界面。不要为了省事关闭路径、指纹或权限检查，也不要在服务运行时手工覆盖 `.workflow`。

Windows 端第一项跨平台开发任务应是：实现完整归档导入、manifest 校验、停机检查、媒体落位和本地路径重定位，并为失败回滚增加测试。

## 9. Windows 端默认开发顺序

无需重新讨论方向，按以下顺序继续：

### P0：跨系统接续真正闭环

1. 完整归档导入与 macOS → Windows 路径重定位。
2. 导入前检查点、失败回滚和重复导入幂等。
3. 导入后核对草稿、素材、媒体数量和 SHA-256。
4. 密钥继续排除，要求用户在 Windows 重新配置。

### P1：真实内容试用

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
- 有两张相关原图时没有退化成纯文字或单图。
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

> 先完整阅读 AGENTS.md、README.md、docs/mature-personal-product.md 和 docs/WINDOWS-DEVELOPMENT-HANDOFF.md。运行 npm test、npm run eval:editorial、npm run build，确认基线。不要改写产品方向，不要触碰或提交 .workflow。默认从 P0“完整归档导入和跨系统路径重定位”开始，先写失败测试，再实现，再做 Windows 浏览器验收。每次使用 Git 命令前，用中文说明命令作用和预期结果。

这样下一次对话不需要重新解释本项目为什么重新闻事实、社区边界、原图和人工最终发布。
