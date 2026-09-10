# 2026-09-10：A0 审计与 A1 发现、阅读流程

本轮完成 Pro 提示词限定的 A0 + A1：核对当前版本，改进首页与阅读器，打通“浏览—核对—保留—返回”。生成边界、完整编辑器重构和真实平台交付留在后续阶段，不能据本轮 UI 验收宣称它们已解决。剩余工作见 [后续任务与完成标准](2026-09-10-pro-roadmap.md)。

## 1. 基线与范围

- 仓库基线：分支 `codex/reliability-news-audit`，HEAD `7aa0a03a31230bcd8d9ec53eaaafe74e7cf50f20`；开始时工作区干净。本轮没有提交或推送。
- 已读取 AGENTS、README、成熟个人产品合同、Windows 交接，以及 9 月 9 日产品决定、首页分类、布局恢复、设计规格、正文证据第三阶段、新闻可靠性第四阶段。用户提供的方向报告是待核对的任务池，执行提示词决定本轮范围。旧设计中“小黑盒唯一目标”等描述由较新产品合同覆盖。
- 运行环境：macOS，Node **22.23.2**、npm **10.9.8**。使用 Node 22 的 PATH，已执行 `npm ci`，没有升级依赖。
- 改前基线：`npm test` **979/979**，类型检查与生产构建通过。首页、阅读器、编辑器使用原创隔离素材截图；不是实时抓取，也不是用户原稿。
- 路由仍为 `#today`、`#workbench`、`#community`、`#drafts`、`#sources`、`#editorial-system`、`#schedule`、`#runs`、`#ai-settings`，定义见 `src/navigation.ts:3`。本轮没有重命名路由。

现有职责：AppShell 负责导航；TodayPage 组合 StoryDesk TodayView、草稿概览与 HomeLayout；TopicCategoryPanel 使用平台发现视图；DraftWorkspace/RichArticleEditor 管理编辑。事实、素材与任务继续由 PackageDesk、DraftDesk、JobDesk 管理，界面不另建事实规则或收藏库。

样式入口依次是 `styles.css → desk-design.css → reader-design.css → strategy-design.css → swiss-design.css`。保留这个系统；在末层复用 `--accent`、`--text`、`--muted`、`--line`、`--paper`、`--desk-sans`，增加正文、标题、列表、控件、圆角和阅读宽度令牌。编辑正文实际继承 17px / 1.85；预览主题继续使用已有排版规则。

## 2. Pro 问题池复核

“仍存在”表示当前代码的可达路径或限制仍在，不表示本轮调用模型复现了坏稿；“需实机验证”表示真实样本和外部环境尚未重新验收。没有把旧报告直接当成当前运行结果。

| 项 | 复核状态 | 当前证据与边界 | 后续 |
| --- | --- | --- | --- |
| E01 · P0 | 仍存在 | `server/index.ts:2224` 的旧 generate 路由仍调用 `requestSelectedDraftGeneration`；`server/generator.ts:1201` 的执行链直接到 `generateCandidateDraft`，未统一经 ContentPackage/DraftDesk。本轮新阅读器继续使用现有素材包路径，没有解锁旧路径。 | B1 |
| E02 · P0 | 仍存在，已有部分校验 | `server/generator.ts:401` 有共用解析和局部结构检查；不能说“完全没有校验”。它仍未对各 Provider 的全部嵌套输出统一执行完整运行时 Schema，部分非法子项被过滤。 | B1 |
| E03 · P1 | 仍存在 | `server/generator.ts:99` 段落上限 8；128、144、162、177 行附近的正文/配图索引最大为 7。 | D1 |
| E04 · P0 | 仍存在，已有部分防护 | `server/frozen-fact-integrity.ts:184` 的数字、单位、日期与明确条件检查已存在，40 项固定评测通过；对象—动作—比较基线—否定—条件的完整关系验证仍不具备。 | D1 |
| E05 · P1 | 仍存在 | `server/inline-completion.ts:59` 取光标前 2400 字，64 行附近规范化后用原句包含判断，最多 12 条未覆盖事实。较早段落与改写覆盖仍可能漏算。 | B3 |
| E06 · P0 | 仍存在 | `server/provider-runtime.ts:399` 识别 `[DONE]`，但 EOF 仍可返回已有文本，未统一检查 `finish_reason`。`server/inline-completion.ts:121` 后处理还可能裁切句子，不能证明保留所有限定条件。 | B1 |
| E07 · P1 | 仍存在 | `src/App.tsx:703` 最多轮询 150 次；`TodayPage.tsx:305` 速读最多 160 次。等待结束会进入未完成提示，后台可能仍在运行。A1 改为显式触发并提供任务中心去向，没有完成持久任务恢复协议。 | B2 |
| E08 · P1 | 仍存在，减少了浏览引发的排队 | `server/index.ts:3258` 共享并发为 2，`server/job-desk.ts:58` 封顶 4；`local-database.ts:549` 按创建时间取任务，没有前台优先级。新首页只读查询不再主动排维护任务，但队列机制未改。 | B2 |
| E09 · P0 | 仍存在，实际权限需实机核验 | `server/provider-runtime.ts:65` 为 `workspace-write`，cwd 为项目，104–105 行继承当前 cwd 与环境。没有本轮越权写入或泄漏证据；网络限制不能只凭这些参数确认。 | B1 |
| E10 · P1 | 仍存在，已有日期/回补/漏斗基础 | `server/story-desk.ts:890` 等包含发布回补；发现评测 72/72。仍缺贯穿采到、日期、聚类、排序、材料与首次推荐时间的事件级真实漏报账本。 | C1 |
| E11 · P1 | 仍存在 | `server/community-feed.ts:185` 等将缺失互动回退为 0；345 行附近共享对数权重和阈值，尚非同平台、同帖龄校准。A1 仅将可见缺失标成未知。 | C1 |
| E12 · P1 | 仍存在 | `server/topic-feeds.ts` 在 `composeCommunityFeed` 前按平台裁候选；`community-feed.ts:421` 从传入 runs 找 supportingSources。平台流的关联证据池会缩小；Story 详情仍从完整状态取，不应泛称所有证据都被截掉。 | C1 |
| E13 · P1 | 仍存在，已有部分能力 | `server/story-desk.ts:899` 有技术待选库、930 行附近保留最多两条有趣实践。独立发现标准、供给评价、作者多样性和保留后的用途仍待完善。 | C2 |
| E14 · P0 | 需实机验证 | 9 月 8 日阶段三记录中，9 张正文图有 3 张涉及图注、条件或案例问题。本轮未重做真实试稿；放大、来源与权利展示解决审阅入口，不证明图文语义正确。 | D2 |
| E15 · P1 | 仍存在，已有部分版本防护 | 不可变 ContentPackage、稿件版本、编辑时重算质量与交付指纹已存在；`server/index.ts:2319` 附近可见保存重审。全部 AI 建议/检查绑定当前修订、来源更正影响链仍不统一。 | B3 / D1 |
| E16 · P1 | 仍存在 | `server/index.ts:2303` 取当前保存前快照；`server/learning-desk.ts:140` 只记有效 manual 差异。先自动保存再手动确认时可能没有可学习差异；尚无独立的初稿—用户确认稿基线。 | B3 |

本轮直接修复了三个读 UI 问题：打开阅读器隐式调用速读模型；新首页查询顺带排入补图/补证；空列表未区分未读、成功无结果与来源失败。前两项有隔离 HTTP/浏览器验证；来源状态有先失败后通过的回归。E01–E16 没有因此被笼统标记为完成。

## 3. 本轮实现

首页保留五个平台与既有栏目。前五项作为常用项，更多栏目由“更多”与横向滚动承接；“＋”持续可见。新增、非拖拽排序、移除、恢复默认与至少一栏的原有持久化接口保留。删除当前栏目后选择相邻栏目并恢复焦点；添加文案明确只是保存已有来源的筛选条件。

新闻由多个重复大区块归并为连续列表，最多突出第一条；二级控件提供当前列表筛选、已有视图、排序与时间。它们只消费已有结果，不改推荐评分。联网搜索仍是原来的七个香港自然日搜索，并明示可能调用速读模型。无图不放空图框；热度、编辑价值、材料范围分别显示。

桌面保留右侧待选题和最近草稿；较窄视口用队列抽屉承接，仍是同一份 selected 数据。后台 SSE 新内容只显示更新入口，不立即重排当前列表。用户点“显示更新”才替换内容。

StoryReader 提供编辑速读、原始正文、事实依据、社区观点、图片与图表五个视图，正文最大 740px，来源栏按需打开，手机全屏。原文优先读冻结素材，补充同一来源身份的已有缓存，不联网；保留来源、作者、快照时间、逐字引用、缺失与截断。没有记录段落坐标或条件时如实提示，不编造定位。社区只数实际样本，少于 5 条明确写有限样本。只有热榜标题时用同一阅读样式展示线索，已读回答为 0，写作禁用。

图片可在阅读器内放大或恢复适应窗口，保留完整图片与来源页入口，显示案例关系、使用权、允许平台。没有记录案例关联就提示需核对；下载与公开使用资格仍分开。

保留使用已有候选选择/知乎留题接口；准备写作复用冻结素材与服务端门槛。失败保留选题，显式提供重试或任务中心；退出恢复列表滚动、原触发按钮焦点和筛选。浏览器后退先关闭阅读器。打开列表、切平台、方向键经过 Tab、阅读快照均不新建模型任务。原有 opened 反馈仍可能记录，不将其称为数据库绝对零写入。

编辑器只继承共享字体/按钮令牌；没有改变 Tiptap、保存、Tab 接受、版本恢复或交付行为。

### API 与实现文件

| 文件 | 变化 |
| --- | --- |
| `src/components/TodayPage.tsx` | 连续列表、二级筛选、稳定更新、阅读入口与位置恢复 |
| `src/components/StoryReader.tsx`（新增） | 阅读视图、冻结事实与快照、来源、显式写作动作 |
| `src/components/TopicCategoryPanel.tsx` | Tab 溢出、手动键盘激活、平台状态、标题线索阅读 |
| `src/components/TodayWorkspaceRail.tsx` | 窄屏同源队列抽屉 |
| `src/components/HomeLayoutDialog.tsx` | 保存筛选条件的准确文案与常用项说明 |
| `src/components/StoryAssetGallery.tsx` | 放大、案例关系与平台权利展示 |
| `src/components/AppShell.tsx` | 日常入口与管理配置分组 |
| `src/hooks/useReaderHistory.ts`（新增）、`useDialogA11y.ts` | 后退关闭、焦点圈定与恢复，过滤不可见/非 Tab 项 |
| `src/reader-design.css`、`src/swiss-design.css` | 共享令牌、阅读样式和响应式规则 |
| `src/api.ts`、`server/index.ts` | Today 使用 `?readOnly=1`；新增 GET `/api/stories/:id/reading`；支持隔离静态构建目录 |
| `server/source-desk.ts`、`server/story-reading.ts`（新增） | 封装只读来源模型；冻结材料优先；请求与 canonical URL 身份匹配；每篇展示上限 30000 字并标截断，最多 12 篇 |
| `server/topic-feeds.ts` | 读取范围、平台来源身份及失败/未读/无结果区分 |
| `server/story-desk.ts` | 去除“打开即补读”的旧提示 |
| `server/story-reading.test.ts`（新增）、`server/topic-feeds.test.ts` | 原文身份/截断、冻结优先和平台状态回归 |
| `tests/fixtures/discovery.ts`（新增）、`tests/e2e/discovery.test.ts`（新增） | 原创隔离素材、完整发现旅程、状态与缩放验收 |
| `tests/e2e/smoke.test.ts` | 适配手动 Tab、移动队列、阅读器和图片放大回归 |
| README、Windows 交接、设计规格、本报告与路线图 | 范围、实测和接续说明 |

兼容边界：旧的无查询参数 GET `/api/today` 仍保留维护入队行为；本轮前端只用显式只读变体。GET `/reading` 的来源不够时返回空/已有内容，不替代冻结包或通过事实门槛。服务端新增 `AI_NEWS_DESK_DIST_ROOT` 仅选择静态资源目录，不迁移数据库。

## 4. 验收证据

所有新增样本标为“隔离示例”。测试使用临时 workflow 目录、关闭定时采集并拦截可能调用外部服务的浏览器 POST。真实本地 API 验证了原文读取、重复保留、栏目持久化；列表和失败状态使用确定性响应。模型、公众号同步、小黑盒填入、真实知乎连接、Windows 实机未验收。

| 命令 | 本次最终结果 |
| --- | --- |
| `npm ci` | 通过 |
| `npm test` | **982/982，0 失败** |
| `node --test --import tsx src/*.test.ts` | **46/46**，补充根目录前端发现范围 |
| `npm run eval:editorial` | **22/22** |
| `npm run eval:discovery` | **72/72** |
| `npm run eval:extraction` | **12/12** |
| `npm run eval:integrity` | **40/40** |
| `npm run build -- --outDir .artifacts/ui-a1/dist` | TypeScript 与生产构建通过 |
| `AI_NEWS_DESK_DIST_ROOT="$PWD/.artifacts/ui-a1/dist" npm run test:e2e` | **3/3**；发现旅程、既有编辑/导航、隔离图集上传检查 |

上述命令在 Node 22 / npm 10.9 的 PATH 下运行。主测试的新增 3 项为 2 项缓存阅读测试和 1 项平台状态回归。测试数量是工程检查范围，不是文章质量指标。

浏览器检查 320、390、820、1280、1440、1920px：首页与阅读器无整页横向溢出；Tab 可以横滚，图片仅在放大容器内滚动。200% 使用独立 Chrome 配置的真实浏览器缩放，记录 `outerWidth=1440 / innerWidth=720 / devicePixelRatio=2`，检查首页、阅读器与编辑器。不是拿 720px 截图冒充缩放。

检查内容包括长中文标题、连续英文型号、无图、九栏目溢出、原句展开、单条真实样本范围、部分缺失、未读、连接故障、成功无结果、筛选无结果、加载、旧快照、刷新失败、读取重试、保留、准备失败、后台更新不重排，以及返回焦点/精确滚动。重复保留经真实本地 API 验证仍为一个待选题。

代表性颜色实测：深色文字/白 **16.29:1**，辅助文字/白 **5.33:1**，品牌红/白（亦即实心按钮的白字/红底）**5.44:1**，警告文字/白 **6.38:1**。禁用控件另有禁用外观，以上不表示整个旧产品已经完成可访问性认证。主要阅读、保留、关闭、加栏目目标按 44px 设计；仍有 36–40px 的次级控件，不能笼统声称所有按钮均达 44px。

键盘采用手动激活 Tab：方向键/Home/End 只移动焦点，Enter/Space 才切换；Tab 离开标签组。抽屉检查 Escape、焦点恢复与边界圈定；开启 reduced-motion 执行新增截图验收。标准依据：[WAI-ARIA Tabs](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)、[WCAG 2.2 最小目标及例外](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)、[普通文字对比度](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)。44px 是本项目的舒适目标，WCAG AA 的目标大小条款是 24px 加相应间距/例外。缩放配置参考 [Chromium ZoomLevelPrefs](https://chromium.googlesource.com/chromium/src/+/lkgr/chrome/browser/ui/zoom/chrome_zoom_level_prefs.cc)。

### 前后图与演示

本地交付位于 `.artifacts/ui-a1/`，不随 Git 提交：[review.html 图册](../.artifacts/ui-a1/review.html) 为前后图与状态索引，`before/` 为改前基线，`after/` 为本轮关键截图，`logs/` 为实际命令输出。已逐张复查交付索引所列图片，包括首页、更多栏目、阅读器、移动端、故障、旧快照与编辑器对照；检查了标题/正文换行、边界、控件、遮挡、字体和材料标签，未仅用控制台无错作结论。

演示顺序：今日 → 选择平台/列表范围 → 阅读并核对 → 原始正文/事实依据/原图 → 留作选题 → 关闭或浏览器后退 → 原条目焦点、滚动和筛选保留，右侧同一队列可继续。缺材料时准备按钮保持受限。执行以上 E2E 命令可重放隔离旅程；默认截图输出 `/tmp/newsdesk-a1-after`，也可设置 `NEWSDESK_UI_SCREENSHOTS`。

## 5. 数据保护、运行状态与回滚

没有主动导入、修改、清空正式 `.workflow`，没有修改用户模型、凭据、来源开关、登录态或平台回执。没有模型调用、正式外部同步/发布或服务安装。没有做正式数据的前后全量指纹审计，不能把“不主动写正式数据”表述成已验证其后台运行期间字节不变。

发现正式服务（4317）与开发工作目录共享 `dist`：最初标准构建曾覆盖该静态目录。发现后没有重启或升级正式后台；从 HEAD 只读导出基线到临时目录，重建并先复制基线 assets、最后恢复基线 index，`cmp` 确认 index 一致。新构建此后全部写入 `.artifacts/ui-a1/dist`，E2E 显式使用该目录。正式服务没有部署本轮版本；这一共享构建风险已作为接续注意事项保留。

源码仍是工作区修改。回滚时只回退本报告列出的源码/测试/文档，不执行 `reset --hard`、全目录清理或数据库恢复；先保存届时新增的用户修改。正式启用需要另行授权，并先验证新后端与新静态资源成对运行。此次没有数据库迁移，因此无需用覆盖用户数据来回滚 UI。

已知限制：缓存阅读是纯文本展示，最多 12 篇/每篇 30000 字；全文不足会明示。更完整的表格、代码、图文结构阅读由后续 D1 处理。平台全局证据与热度评分仍有上表记录的限制；任务等待结束的统一恢复、真实知乎连接、Windows/真实手机和平台交付均待后续验证。
