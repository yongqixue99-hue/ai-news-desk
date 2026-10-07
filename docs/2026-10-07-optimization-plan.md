# 后续优化实施文档（2026-10-07）

本文交给下一位执行者（Codex）按顺序实施。每个任务都写了依据、要改的位置、先写的测试、验收标准和不能做的事。文中的数字是 2026-10-07 在用户的 Mac 上实测的，动手前请先复测，以当时的结果为准。

先读 `AGENTS.md`、`README.md`、`docs/mature-personal-product.md` 和 `docs/WINDOWS-DEVELOPMENT-HANDOFF.md`。本文与它们冲突时，以产品契约和 `AGENTS.md` 为准，并把冲突告诉用户。

## 1. 当前状态

2026-10-07 这一轮已经完成并上线到 Mac 本机服务：

- 界面改版：旧样式进入 `legacy` 级联层，新设计系统在 `src/design/`。见 [改版记录](design/ui-redesign-2026-10-07/README.md)。
- 今日选题自动补中文标题，原题显示在下一行（`server/today-title-backfill.ts`，`POST /api/today/titles`）。
- 电脑休眠不再被任务看门狗判成「长时间没有实际进展」（`server/job-desk.ts`）。
- Mac 上能找到 ChatGPT 桌面应用新目录里的 Codex CLI（`server/codex-executable.ts`）。

基线：`npm test` 1337/1337，`npm run eval:editorial` 22/22，`npm run test:e2e` 12/12，`npm run build` 通过。Windows 没有验收。

尚未观察到的结果：休眠修复后的第一次计划采集。来源页上此前被连带标成「失败」的来源，要等一次成功采集后才会恢复。

## 2. 工作规则

1. 一个任务一个分支、一个 PR，合并前 `verify` 和 `windows-desktop` 两个 CI 都要通过。不要把多个任务攒成一个大提交。
2. 修缺陷先写会失败的回归测试，再改代码。新功能也要有测试。
3. 不改写、不删除 `.workflow/`。需要真实规模的数据做实验时，用只读方式复制数据库到临时目录（见第 3 节）。
4. **不要用复制出来的真实数据库启动完整服务。** 库里可能有排队中的交付任务，服务一启动就会对真实平台执行。只允许用脚本直接调用存储和采集函数。
5. 仓库是公开的。含本机真实数据的截图不入库；需要入库的截图用隔离示例数据。
6. 新样式只写在 `src/design/`，不要再给旧样式文件追加规则。旧文件里带 `!important` 的声明仍会压过新层。
7. 界面布局改动先给用户看真实渲染的页面，用户同意后再上线。用户否决过合并一级导航和生图效果图，认可红白风格。
8. 任何会新增模型调用的改动，都要写明触发时机和单次上限。会产生额外 API 费用的方案先问用户。
9. 每条 Git 命令执行前，用中文向用户说明作用和预期结果。
10. 不实现自动发布，不调用群发或最终发布接口。

## 3. 环境与常用命令（Mac）

本机默认 `node` 是 v26，项目要求 Node 22。每个终端先执行：

```bash
export PATH=/opt/homebrew/opt/node@22/bin:$PATH
```

交付前的验证，四条都要 0 失败：

```bash
npm test
npm run eval:editorial
npm run build -- --outDir .artifacts/verify/dist --emptyOutDir
AI_NEWS_DESK_DIST_ROOT="$PWD/.artifacts/verify/dist" npm run test:e2e
```

注意两点：

- 本机正式服务（127.0.0.1:4317，LaunchAgent `cn.ai-news-desk`）直接提供仓库根目录的 `dist/`。不带 `--outDir` 的 `npm run build` 等于立刻把前端上线，而后端还是旧进程。验证时一律构建到 `.artifacts/`。
- 端到端测试启动的服务默认也读根目录 `dist/`。上面的写法让它读隔离构建，测到的才是当前代码。

上线（只在用户同意后）：

```bash
npm run build
launchctl kickstart -k gui/$(id -u)/cn.ai-news-desk
curl -s http://127.0.0.1:4317/api/health
```

重启前先确认没有运行中的任务（任务中心为空）。

只读预览，用工作区前端看真实数据且不会写入：

```bash
npm run preview:readonly
node scripts/ui-preview/shot.mjs today today-1440 1440 900
```

预览在 4399 端口，只转发 GET，其他请求返回 405。截图输出到 `.artifacts/ui-preview/shots/`。

复制数据库做实验（只读源库，写到临时目录）：

```bash
mkdir -p /tmp/newsdesk-copy && sqlite3 -readonly .workflow/newsdesk.db ".backup '/tmp/newsdesk-copy/newsdesk.db'"
```

然后用 `AI_NEWS_DESK_WORKFLOW_ROOT=/tmp/newsdesk-copy node --import tsx <脚本>` 调用 `server/storage.ts` 等模块。

## 4. 任务总览

| 编号 | 任务 | 规模 | 需要用户先确认 |
| --- | --- | --- | --- |
| A1 | Codex 健康检查能发现「登录正常但生成必败」 | 小 | 否 |
| A2 | 任务级中止不再把来源标成失败；观察休眠后的采集 | 小 | 否 |
| A3 | 交付超时的休眠误判 | 小 | 否 |
| B1 | 启动数据瘦身第一步：接口不再返回运行诊断明细 | 小 | 否 |
| B2 | 选题行显示真实摘要，去掉模板句和「热度未知」 | 中 | 看过效果再上线 |
| B3 | 中文标题在采集后预先生成 | 中 | 否（不换模型的前提下） |
| B4 | 手机端任务胶囊遮挡内容 | 小 | 看过效果再上线 |
| C1 | 今日接口提速 | 中 | 否 |
| C2 | 新闻工作台重排 | 中 | 是 |
| C3 | 社区广场重排 | 中 | 是 |
| C4 | 聚合资讯标题翻译 | 中 | 是（涉及产品规则） |
| D1 | 运行诊断明细移出主状态 | 大 | 是（动存储结构） |
| D2 | 清理旧样式 | 中 | 否 |
| D3 | 文档整理 | 小 | 否 |
| D4 | 拆分大文件 | 大 | 否 |

建议顺序：A1 → A2 → A3 → B1 → B2 → B3 → B4 → C1，然后把 C2–C4 和 D1 的方案拿给用户确认，再做 D2–D4。

## 5. 任务详述

### A1. Codex 健康检查的盲区

**依据。** 10 月 7 日所有 Codex 生成都失败，报错是 `Unknown feature flag: skip_host_skill_discovery`，而 `/api/health` 一直返回 Codex 正常。原因是 `server/provider-health.ts` 的 `codexHealth` 只检查登录状态，实际生成用的参数在 `server/provider-runtime.ts` 的 `buildCodexExecRequest` 里。失败记录的 `errorCategory` 是 `unknown`，界面给不出可操作的提示。

**目标。** 健康检查与真实调用使用同一个可执行文件和同一组功能开关；CLI 过旧时明确说出版本和处理办法。

**实施。**

1. 把 `buildCodexExecRequest` 里通过 `--enable` / `--disable` 传入的功能开关提成一个导出的常量，健康检查和生成共用。
2. `codexHealth` 增加两步：`codex --version` 记录版本；`codex features list` 确认上述开关都存在。任何一个缺失就返回错误，文案写明当前版本、缺少的开关，以及「请更新 ChatGPT 或 Codex 桌面应用」。
3. 健康结果的说明里带上 `resolveCodexExecutable()` 解析出的路径，方便判断用的是哪一个 CLI。
4. 生成失败时，把 stderr 里的 `Unknown feature flag` 归到一个明确的错误类别（沿用现有类别枚举，不新造含义重叠的类别），并在候选速读、正文讲解的失败提示里显示同一句处理办法。

**先写的测试。** 在健康检查测试里注入一个假的命令执行器：登录成功但 `features list` 缺少开关时，结果必须是错误且包含版本号。再加一条：`buildCodexExecRequest` 用到的每个开关都在共享常量里。

**验收。** 把 PATH 上旧版 CLI（0.134）临时作为解析结果时，健康检查报错并给出处理办法；用桌面应用内置的新版时通过。

**不要做。** 不要在开关不被支持时悄悄去掉它继续运行。这些开关是用来关闭工具和收紧权限的，降权失败必须停下。

### A2. 任务级中止不应算作来源故障，并观察休眠后的采集

**依据。** `server/horizon.ts` 的 `executeCollection` 在 catch 里对所有选中来源调用 `applySourceCollectionFailure`。当失败原因是任务被看门狗或超时中止（`options.signal.aborted`），而来源根本还没读完时，全部来源都会被记一次失败。10 月 4 日到 7 日的 24 次休眠误判就是这样把来源页刷成一片红的。

**实施。**

1. `applySourceCollectionFailure`（`server/source-health.ts`）增加输入 `jobAborted`，为真时不改来源健康。`executeCollection` 传入 `Boolean(options.signal?.aborted)`。
2. `server/job-desk.ts` 在检测到挂起时记录一条 `job.suspended` 工作流事件，带上挂起时长和当时的阶段，便于事后核对。
3. 观察两次跨休眠的计划采集，把结果写进交接文档：任务是否完成、多少来源成功、有没有新的误判。
4. 如果观察到「唤醒后所有来源一起超时、得到 0 条」的情况，再补一层：读取阶段发生过挂起且所有来源失败时，抛出 `ClassifiedJobError(..., "transient")`，走现有的退避重试，不写来源故障。没有观察到就不要加。

**先写的测试。** `server/source-health.test.ts`：任务中止时来源健康不变。`server/job-desk.test.ts`：时钟跳变后出现一条 `job.suspended` 事件。

**不要做。** 不要手工修改 `.workflow` 里的来源健康。等成功采集自然恢复。

### A3. 交付超时的休眠误判

**依据。** `server/delivery-batch-desk.ts` 用墙上时钟做三个期限：连接 30 秒、交付 10 分钟、等待登录 10 分钟（`batch.expiresAt`）。`server/index.ts` 每 5 秒调用一次 `deliveryBatchDesk.tick()`。这与看门狗修复前是同一类写法，但**尚未复现**出问题。

**实施。** 先在 `server/delivery-batch-desk.test.ts` 写测试：交付进行中时钟跳 20 分钟，随后的 `tick` 不应把它判为超时。测试失败再改：记录上一次 `tick` 的时间，间隔超过 30 秒时把进行中操作的 `deadline` 顺延相同时长。测试本来就通过的话，只保留测试。

等待登录的 10 分钟期限保持原样：合上电脑后回来看到「登录等待已过期，可重新开始」是可以接受的行为，除非用户提出异议。

### B1. 启动数据瘦身第一步

**依据。** `GET /api/bootstrap` 返回 16.1 MB。状态总共 18.3 MB，其中 `runs` 占 17.4 MB；单次运行最大 1.9 MB，主要是 `discoveryTrace`（约 0.8 MB）、`evidenceCandidates`（约 0.45 MB）和 `aggregationItems`（约 0.37 MB）。`src/` 里没有任何代码引用这三个字段（2026-10-07 用全文搜索确认，动手前再搜一次）。`src/App.tsx` 的 `refresh()` 每次都重新拉取整个状态，文件里有 26 处调用。

**实施。**

1. 新增纯函数 `bootstrapView(state)`，返回值与现在相同，但每个 run 去掉上述三个字段。接口改用 `readStateProjection`，避免先克隆 18 MB 再丢弃。
2. 运行记录页的诊断如果需要这些字段，确认它已经走单独的接口；没有的话加 `GET /api/runs/:runId/diagnostics` 按需读取。
3. `src/types.ts` 里对应字段标为可选，类型检查会指出遗漏的使用处。

**先写的测试。** `bootstrapView` 不含三个字段、其余字段逐项相等；磁盘上的状态没有被改动。

**验收。** 复测 `/api/bootstrap` 体积并写进 PR。运行记录、工作台、今日页功能不变，端到端测试通过。

**不要做。** 这一步不动存储结构，不删任何历史数据。

### B2. 选题行的信息质量

**依据。** 今日选题每行标题下面的那句话是固定文案：实践类选题取 `server/practice-opportunity.ts` 里的 `angles`（例如「从适用任务和使用门槛介绍这个工具」），其余取 `server/newsworthiness.ts` 的 `reason`。不同新闻会显示同一句。`server/topic-radar.ts` 里 `heat` 在没有信号时一律是「热度未知」，8 行全是。部分来源的摘要只是把标题重复一遍。用户的原话是「想快速看一眼标题，就知道大概讲什么东西」。

**目标的行结构。**

```text
序号 · 来源 · 发布时间                         [可进入成稿 / 待核对线索]
中文标题
原题（与中文标题不同才显示）
一句话中文摘要（有速读且不是标题的重复才显示）
[重要进展 / 官方进展 / 有趣有用 等标签]  ▸ 摘要与来源
```

**实施。**

1. `TopicRadarRow` 增加 `label`（取 `opportunity.label`）和 `brief`（取 Story 的中文摘要；与标题归一化后相同或互相包含时留空）。
2. `src/components/TopicRadar.tsx` 用标签替换模板句；模板句移到「摘要与来源」展开区里保留。`heat` 只在有信号时显示。
3. 样式写在 `src/design/today.css`。

**先写的测试。** `server/topic-radar` 的测试：摘要等于标题时 `brief` 为空；有速读时 `brief` 为中文摘要；排序与入选结果和改动前逐项相同。

**验收。** 在 1440 和 390 宽度截图给用户看，同意后上线。`tests/e2e/aggregations.test.ts` 依赖 `.radar-row`，保持类名。

**不要做。** 不改评分、排序、入选规则和证据状态。这只是显示层。

### B3. 中文标题在采集后预先生成

**依据。** 现在由页面触发补标题，实测 7 条约 81 秒，这段时间用户看到的是英文。原因是官方增量采集（`collectionPurpose` 为 `official-monitor`）在 `executeCollection` 里跳过了「生成中文速读」，而今日页的内容大多来自这类采集。

**实施。**

1. 把 `server/index.ts` 里 `/api/today/titles` 的主体提成 `today-title-backfill` 模块的一个函数，接口和后台任务共用。
2. 增量采集和每日采集成功结束后，入队一个 `background` 通道的持久任务（幂等键含运行 ID），执行同一个函数。它不能阻塞采集任务，失败只记日志。
3. 页面触发保留作兜底。两条路径都要遵守 `AI_NEWS_DESK_AUTO_TITLES=0`。
4. 上限维持每次 12 条。在 PR 里写明最坏情况下的调用量（每小时一次增量采集，每次最多 12 条）。

**先写的测试。** 采集完成后恰好入队一个任务；重复完成不重复入队；开关关闭时不入队。

**验收。** 采集结束后不打开页面，等任务跑完，今日接口返回的标题已经是中文。

**需要先问用户的部分。** 想更快可以用「只翻标题」的短提示词配更快的模型（例如已配置为补全用的 DeepSeek）。这会产生 API 费用，并且绕开了目前免费的 ChatGPT 登录通道，必须先得到用户同意，不能默认切换。

### B4. 手机端任务胶囊遮挡

**依据。** 宽度 720 以下时，右下角的任务中心胶囊（`src/components/ProductJobCenter.tsx`，类名 `product-job-center`）固定压在内容和底部导航上方，会盖住选题行的操作按钮。

**实施。** 窄屏下改成不占内容区的形态，例如缩成贴在底部导航上沿的一条细提示，或并入「更多」菜单并显示数量角标。保留现有的展开面板、可访问名称和测试依赖的结构。样式写在 `src/design/`。截图给用户确认后上线。

### C1. 今日接口提速

**依据。** `GET /api/today?readOnly=1` 实测 1.5–2.3 秒，返回 0.74 MB。每次请求都从全部 64 次运行重新聚合 Story 并重建聚合资讯视图（`server/story-desk.ts` 的 `buildTodayView`）。

**实施。**

1. 先量再改：用数据库副本写脚本调用 `buildTodayView`，配合 `node --cpu-prof` 找出耗时最多的两三处，把结果写进 PR。
2. 给存储加一个只增不减的修订号（每次 `persistState` 加一）。`buildTodayView` 的结果按「修订号 + 当前分钟」缓存，状态一变就失效。时间相关的字段（如 `ageHours`）靠分钟粒度保证不过期太久。
3. 如果剖析显示某个纯计算被重复执行，直接修那一处，优先于加缓存。

**先写的测试。** 状态变化后缓存必须失效；同一修订号下两次结果相同；现有 `buildTodayView` 测试全部通过。

**验收。** 预热后的请求低于 300 毫秒；首次请求不比现在慢。

### C2. 新闻工作台重排（先确认）

**现状。** 这一页目前只是跟着换了色板。用户此前认为 Codex 第三轮的工作台方案不满意，原因没有逐条记录，所以动手前要先问清他想解决什么。

**建议方向（供与用户讨论，不是定稿）。**

- 采集条件收成一行，日期和高级设置按需展开。
- 候选列表沿用今日页的行样式：中文标题为主、原题在下、状态用胶囊，替换现在的宽表格。
- 右侧「待写选题」保持常驻，底部主动作始终在视口内。

**必须保留。** 原始标题、链接、证据快照、筛选、偏好标记、清理、失败重试、运行追溯等全部现有操作；候选（单条来源）和 Story（聚合事件）的语义不能混。`src/components/Workbench.test.tsx` 和端到端测试依赖的可访问名称不变。

**流程。** 用隔离示例数据做出真实页面，在 1440×900、1280×720、390×844 截图，用户同意后再合并上线。

### C3. 社区广场重排（先确认）

与 C2 相同的流程。现状是概览数字、来源状态和排序占了首屏上半部分，列表和阅读区从下半部分开始。建议把来源状态收成一行可展开的提示，让列表更早出现。事实与讨论分开展示、社区门槛（少于 5 条写「有限样本」，15 条且 5 个独立分支才谈反复主题）是产品契约，不能在重排时弱化。

### C4. 聚合资讯标题翻译（先确认）

**依据。** 聚合资讯 374 条里有 220 条标题没有中文。这些条目不是候选，没有速读可复用。产品文档写明聚合资讯「浏览不调用模型改写」，所以这是一次规则变更，需要用户明确同意。

**建议方案。**

- 默认不自动翻译。页面提供「翻译本页标题」按钮，由用户触发，每次只处理当前可见的最多 20 条。
- 译文存进新表 `title_translations`（键为原题与链接的 SHA-256，另存中文标题、模型、时间），仅用于显示。
- 界面上中文在上、原题在下，并标明是机器翻译。

**不能做。** 不把译文写回聚合条目或原始记录；译文不是证据，不参与评分、事件合并和事实核验。数据库迁移必须是新增表，并在 `server/local-database.test.ts` 里覆盖旧库升级。

### D1. 运行诊断明细移出主状态（先确认）

**依据。** 每次 `updateState`（`server/storage.ts`）都会克隆并写回整份状态。在当前 18.3 MB 的数据上，空操作一次要 140–240 毫秒，首次读取 430 毫秒，而且是同步占用事件循环的。数据库旁边的 WAL 文件有 30 MB。B1 只解决了接口体积，这里解决写入成本。

**方案。**

1. 新增表 `run_artifacts(run_id, kind, json, checksum, updated_at)`，存放 `discoveryTrace`、`evidenceCandidates`、`aggregationItems`。
2. 读路径：需要这些数据的代码（目前在 `server/story-desk.ts`、`server/aggregation-desk.ts`、`server/community-feed.ts`、`server/candidate-pool.ts`、`server/discovery-funnel.ts`、`server/discovery-trace.ts` 等处）改为通过一个带内存缓存的读取函数获取。先全文搜索三个字段的全部读写点并列在 PR 里。
3. 写路径：采集结束时写入新表，不再放进 `runs` 片段。
4. 迁移：启动时把旧数据搬到新表，搬之前用现有机制创建检查点；迁移可重入，中途失败能从检查点恢复。
5. 确认完整归档导出与导入、轻量 JSON 备份都带上了新表的数据。轻量备份如果依赖状态对象本身，需要显式补上。

**先写的测试。** 旧结构数据库升级后，今日视图、聚合视图、运行诊断与升级前逐项相等；迁移执行两次结果相同；归档导出再导入后新表数据完整。

**验收。** 在数据库副本上，空操作 `updateState` 低于 50 毫秒，`runs` 片段低于 3 MB，64 次运行的诊断都能读到。

**不要做。** 不裁剪、不删除任何历史运行数据。「运行记录始终不删除」是既有承诺。

### D2. 清理旧样式

**依据。** 构建出的样式文件 457 KB，旧层里有大量已经被后来的规则覆盖、或对应组件已经不存在的选择器。

**方法。**

1. 一次只处理一个旧样式文件，一个文件一个 PR。
2. 写脚本提取文件里每条规则用到的类名，在 `src/`、`server/`、`chrome-extension/` 里搜索。类名经常用模板字符串拼接（如 `status-${value}`），所以前缀能匹配到拼接写法的一律视为在用。
3. 只删除「规则里所有类名都没有任何引用」的规则。
4. 删除前后各用 `scripts/ui-preview/shot.mjs` 把 10 个页面在 1440 和 390 宽度截一遍，再加上阅读器、草稿三种视图、通知中心、设置各标签页，逐张对比。

**特别小心。** 编辑器的排版主题（`layout-*`、`preview-article-title` 等）不只是界面样式。「复制公众号排版」会把这些规则内联进导出的 HTML，`server/article-html.ts` 也会生成相关标记。这部分规则先不动，除非有测试覆盖导出结果。

**验收。** 截图无差异，端到端通过，在 PR 里写明删除前后的体积。

### D3. 文档整理

README 开头有 25 段按日期堆叠的更新说明，使用说明被压在后面；交接文档 740 行，同样是日期条目在前。

1. 新建 `CHANGELOG.md`，把 README 和交接文档里的日期条目原文移过去，按时间倒序，一字不删。
2. README 开头改为：这是什么、怎么启动、日常流程、文档索引。
3. 交接文档保留当前状态、已锁定的决定、下一步，其余链接到变更日志。
4. `AGENTS.md` 的必读清单路径不变。

这是纯移动，PR 里说明没有删除任何内容。

### D4. 拆分大文件

`server/index.ts` 150 KB，`src/components/DraftWorkspace.tsx` 116 KB，`src/App.tsx` 58 KB。它们各自承担了太多职责，改一处容易影响别处。

- `server/index.ts`：按领域把路由搬到独立模块，沿用仓库里已有的写法（`server/social-delivery-routes.ts`、`server/delivery-batch-routes.ts`、`server/ai-style-score-routes.ts`）。一个领域一个 PR。
- `DraftWorkspace.tsx`：把右侧各工具面板和保存、版本、补全相关的逻辑拆成组件和 hook。
- `App.tsx`：把数据加载和各页面的动作处理拆成 hook。

规则：只移动、不改行为；不顺手重命名或「优化」逻辑；每个 PR 现有测试原样通过。这类工作优先级最低，最好在某个功能任务正好要动那一块时顺带做。

## 6. 需要用户参与的事

这些来自交接文档里一直没完成的下一步，执行者替代不了：

1. 连续写 12 篇真实公众号稿，记录选题到成稿的耗时、删掉了什么、图片用了几张、被什么拦住。
2. 微信公众号草稿箱的真实验收：新建、更新同一篇、内容未变时跳过、手机预览。
3. Windows 实机验收：拉取 `main`、`npm ci`、四条验证命令、手动启动、浏览器检查，然后才安装计划任务。
4. 对 C2、C3、C4、D1 的方案和 B3 里是否换用付费模型做决定。

## 7. 每个任务完成时的汇报

向用户汇报时写清四件事：

1. 改了什么，用户能看到或感觉到的变化是什么。
2. 四条验证命令的结果，以及任务专属的实测数字（改动前后各一个）。
3. 是否已上线；没有上线的话，生效还需要什么。
4. 没做的、没验证的、需要用户决定的事项。

同时在 `README.md`、`docs/mature-personal-product.md`（仅当产品规则有变化）和 `docs/WINDOWS-DEVELOPMENT-HANDOFF.md` 顶部各加一段日期说明，链接到本次的实施记录。
