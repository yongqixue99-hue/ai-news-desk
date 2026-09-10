# 阶段 B：成稿边界、任务恢复与确认稿

2026-09-10，按用户“执行阶段 B”实施 **B1、B2、B3**。三批的代码与隔离验收已完成；正式服务未部署，未调用真实模型、同步平台、推送仓库或改动正式 `.workflow`。A0/A1 的未提交修改继续保留。

## 实现结果

| 范围 | 结果 | 主要代码 |
| --- | --- | --- |
| B1 · E01 | 批量候选与社区兼容 HTTP 入口使用同一持久任务；导入复核先冻结文字与图片，再经 DraftDesk 质量门保存。移除旧链接/截图直接成稿及社区独立生成实现。低层生成函数拒绝缺少或未通过预检的素材包。 | `editorial-jobs.ts`、`editorial-intake.ts`、`intake-review-service.ts`、`draft-desk.ts` |
| B1 · E02/E06 | Codex 与兼容 API 的结构化输出统一经过本地 JSON Schema 校验，不做类型强转或删除非法字段。兼容 API 必须明确 `finish_reason=stop`；流式补全还必须收到结束帧。长度截断、缺少完成原因、异常 EOF 均拒绝。补全后处理保留完整句子和限定条件，超长结果不再裁短后采用。 | `provider-schema.ts`、`provider-runtime.ts`、`inline-completion.ts` |
| B1 · E09 | Codex 在临时目录运行，只复制显式 schema 和可选来源图片；任务正文随标准输入提供。改为只读沙箱，忽略用户配置和规则，关闭 shell、浏览器、网页搜索、插件、MCP 配置继承、子 Agent 等能力；子进程只继承必要环境。原生身份凭据不复制、不导出。 | `provider-runtime.ts` |
| B2 · E07 | 前端等待结束返回“仍在后台处理”，不取消、不重试、不把任务标为失败。任务中心保留 ID、状态、结果与恢复入口，刷新继续读取数据库里的任务。明确失败的准备/成稿任务支持用户重试，失败记录保留。 | `product-job-wait.ts`、`ProductJobCenter.tsx`、`job-recovery.ts` |
| B2 · E08 | SQLite 新增前台/后台队列字段，兼容迁移已有任务。主动任务优先于待执行维护任务；应用并发为 2 时，后台任务最多占 1 个位置。排队阶段显示等待原因，不显示虚构的运行进度或失联告警。 | `local-database.ts`、`job-desk.ts` |
| B3 · E05 | 补全覆盖检查使用光标前后的全文，并使用正文中仍实际存在的事实映射辅助识别改写。区分关闭、缺素材、等待、流式预览、可接受、过期、拒绝与重试；流式预览不能直接插入。 | `inline-completion.ts`、`RichArticleEditor.tsx` |
| B3 · E15/E16 | 默认单正文画布，保留资料、图片、版本侧栏及显式对照/预览。顶部显示保存状态与修订。AI 修改绑定正文及素材包身份，提供逐项/批量采用和撤销；正文变化后旧建议失效。新增独立“确认定稿”事件，保留初稿、确认稿和差异；自动保存不再消耗学习基线。 | `DraftWorkspace.tsx`、`draft-document.ts`、`draft-confirmation.ts`、`draft-revisions.ts` |

原文模式是逐字保留冻结材料的私人工作副本，不调用模型；翻译/整理仍保留各自模式。通用 AI 优化也必须有冻结素材包，不能通过重读网页引入新事实。来源图片继续校验本机路径与 SHA-256；核权状态仍在交付时重查。

## 确认与学习的具体边界

- “保存”只保存编辑内容。“确认定稿”另存确认快照和事件，不触发平台写入，也不把内容自动标为可发布。
- 新稿的初稿基线不会被自动快照合并或 30 条日常版本上限删除；确认稿也保留。旧稿缺少可靠初始记录时明确标为“最早可用稿”，第一次确认只建立基线。
- 用户先自动保存，再确认，仍比较上一确认稿或初稿与本次确认稿。重复确认相同内容不会重复学习。
- 本轮采用保守的来源判定：一个确认周期只要采用过 AI 补全、AI 修改或恢复旧版本，整个周期都不自动提取偏好；差异仍可查看。下一周期可从已确认版本开始记录新的人工差异。这避免混入 AI 自改，但暂时也会跳过混合周期内的人工编辑样本；细粒度归因属于 E1 的后续完善。
- 撤销只在采用后的正文仍匹配时执行；发生后续编辑时停止撤销，保留版本供用户核对。未通过事实保护的 AI 项不能一键采用。
- 全文匹配和事实 ID 只辅助识别已覆盖内容，不是完整语义证明。对象、动作、比较方向、否定与条件的全面关系验证仍在 D1。

## 验收证据

使用 Node **22.23.2**、npm **10.9.8**；`npm ci` 可重现安装。产物全部放 `.artifacts/phase-b/`，构建没有写入正式服务使用的根目录 `dist`。

| 检查 | 结果 | 日志 |
| --- | --- | --- |
| `npm test` | 1003/1003，零失败 | `.artifacts/phase-b/npm-test.log` |
| `node --test --import tsx src/*.test.ts` | 48/48，零失败；补充 shell 未展开的根目录前端测试 | `.artifacts/phase-b/frontend-root.log` |
| `npm run eval:editorial` | 22/22 | `.artifacts/phase-b/editorial.log` |
| `npm run build -- --outDir .artifacts/phase-b/dist` | TypeScript 与生产构建通过 | `.artifacts/phase-b/build.log` |
| 隔离 `npm run test:e2e` | 4/4 | `.artifacts/phase-b/e2e.log` |

失败回归分别保存在 `provider-red.log`、`article-red.log`、`queue-red.log`、`completion-red.log`。覆盖非法嵌套输出、错误完成原因、限定条件前断流、旧入口无素材包、长正文事实重复、排队优先级、保留主动任务容量、确认基线与 AI 样本排除等。

浏览器测试使用临时数据库与模拟 Agent 回复，真实保存/确认接口运行在隔离后端。验证自动保存后确认、刷新恢复、旧建议失效、逐项采用、撤销与确认差异。320、390、820、1440px 没有横向溢出，并检查标题未被顶栏裁切。截图和机器可读检查结果见 `.artifacts/phase-b/browser/`；可打开 [本地验收画廊](../.artifacts/phase-b/review.html)。

Codex 权限验证分为两层：单元测试启动一个本地替身进程，核对实际 cwd、目录内容、环境变量过滤和完成后清理；本机真实 CLI 用 `--help` 验证整组参数可解析，退出码为 0。记录在 `.artifacts/phase-b/codex-permission-probe.json`。**这没有执行真实模型，也不等于完成操作系统沙箱越权/网络探测；Windows CLI 兼容性与真实运行仍需单独验收。** 不支持这些参数的旧 CLI 会失败，不会退回宽权限配置。

实现参考：[Ajv 运行时校验文档](https://ajv.js.org/guide/getting-started.html)、[OpenAI Chat Completions 返回协议](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)。

## 接续工作

Pro 的剩余主线是 **C、D、E 三阶段，5 批实现**：C1 发现准确性与证据池、C2 有趣实践与来源健康、D1 稿型与事实关系、D2 图文质量与真实试用、E1 个人表达偏好检索。下一批为 C1。

上述 5 批之外，仍有真实模型/CLI、Windows、真实手机、实时来源及公众号草稿新建/更新验收。B 的隔离通过不能替代这些实机结果，也不能视作整个项目建议已经完成。完整次序见 [Pro 剩余路线](2026-09-10-pro-roadmap.md)。
