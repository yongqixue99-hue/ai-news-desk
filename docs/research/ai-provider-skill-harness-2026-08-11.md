# AI 新闻工作台的 Provider、Skill 与 Harness 方案

> 调研日期：2026-08-11。结论以 OpenAI、阿里云 Model Studio、DeepSeek、Vercel、LangChain、MCP 和项目官方仓库为主。

## 结论先行

1. **截图里的“正在成稿”确实在生成。** 运行 `run_20260811121013_d16095` 最终在 20:14 和 20:15 写入了两篇草稿。当前后端不是假按钮：`server/generator.ts` 会启动 `codex exec`，要求 Codex 按 JSON Schema 返回文章，再把结果写入草稿。这次的真实问题是生成耗时几分钟却没有细粒度进度，而且接口缺少生成锁，同一候选被重复启动了两次。
2. **ChatGPT 登录可以让本机 Codex CLI 在没有 API Key 的情况下非交互运行。** `codex exec` 默认复用已保存的 CLI 登录态，也支持 JSONL、JSON Schema、最终结果文件和图片输入。不过 OpenAI 把 ChatGPT-managed 自动化列为高级路径；正式自动化仍建议 API Key，而且 `auth.json` 只能当密码一样保护。[Codex 非交互模式](https://developers.openai.com/codex/noninteractive/) · [CLI 参数](https://developers.openai.com/codex/cli/reference/)
3. **ChatGPT 订阅不是 OpenAI 通用 API 额度。** 它只能通过 Codex 客户端使用对应计划额度；任意 OpenAI REST API 仍需 Platform API Key，且 ChatGPT 与 API 平台分别计费。[OpenAI 账单说明](https://help.openai.com/en/articles/9039756-billing-settings-in-chatgpt-vs-platform) · [ChatGPT Plus 说明](https://help.openai.com/en/articles/6950777)
4. **若只新增一个正式 API，优先千问而非 DeepSeek。** 千问视觉模型支持图片 URL、Base64、本地截图和 JSON 输出，既能做“截图提取”，也能写文章；DeepSeek 当前公开 API 的用户消息仍是文本字符串，适合文本成稿/改写，不应在 UI 中宣称支持截图。[千问视觉 OpenAI 兼容接口](https://www.alibabacloud.com/help/en/model-studio/qwen-vl-compatible-with-openai) · [千问结构化输出](https://www.alibabacloud.com/help/en/model-studio/qwen-structured-output) · [DeepSeek Chat API](https://api-docs.deepseek.com/api/create-chat-completion/)
5. 当前产品已经是一个**工作流外壳**；补齐 Provider 路由、Skill 注册表、工具权限、结构化状态、密钥管理和可观测性后，才是完整的本地 AI harness。没有必要把 Dify、n8n 等整套平台嵌进现有网页。

## 一、这次实际发生了什么

项目当前的真实调用链是：

```text
选中候选 → Express 后端 → spawn("codex", ["exec", ...])
         → Codex 读取 news-desk / agent-reach / ra-人话
         → 按 article-output-schema.json 返回 JSON
         → 保存 ArticleDraft → 进入编辑器
```

真实运行记录显示：

```text
20:10:40 第一次启动成稿
20:10:53 第二次启动同一候选
20:14:13 第一篇草稿写入
20:15:20 第二篇草稿写入
```

生成接口在后台任务真正取得锁之前就返回 `202`，而服务端也没有拒绝一个已经处于 `generating` 的运行。前端轮询或再次点击都可能再次启动同一候选。修复应同时包含：原子领取生成任务、幂等键、`runId + candidateId + recipe` 唯一约束，以及明确的“生成新版本”动作。

本机还发现一个独立的潜在配置问题：

```text
/opt/homebrew/bin/codex
codex-cli 0.134.0
Error loading configuration: ... unknown variant `max`, expected ... `xhigh`
```

直接执行不带覆盖项的 `codex login status` 会因为旧版不认识 `max` 而失败；但当前生成器与健康检查都显式传入 `model_reasoning_effort=xhigh`，实测 `codex -c model_reasoning_effort=xhigh login status` 能正常返回 `Logged in using ChatGPT`，本次成稿也已经成功。因此它是需要清理的潜在故障，而不是这次“看起来没生成”的根因。官方 CLI 还提供 `--ignore-user-config`；`--image/-i`、`--json`、`--output-schema` 和 `--output-last-message` 也都是稳定参数。[Codex CLI 参数表](https://developers.openai.com/codex/cli/reference/)

建议按这个顺序修：

- 服务端先原子领取生成任务；重复请求返回同一个 job，不再次启动 Codex。
- 把生成任务单独建模，保存 provider、skills、开始时间、心跳、当前阶段、尝试次数和错误。
- 首选更新 Codex CLI，并在启动时检查“CLI 版本 + 配置能否解析 + 登录状态 + 模型可用性”。
- 后端增加隔离运行模式：必要时用 `--ignore-user-config`，避免个人配置把定时任务拖死；是否仍能发现目标 skills 要加入启动自检。
- 用 `--json` 解析 JSONL 事件，把“排队、调用模型、工具运行、校验结果、失败原因”显示到界面，而不是只显示无限转圈。
- 进程退出、超时或额度不足时立即把任务标成失败，并显示 stderr、退出码、“重新登录/重试”按钮。
- 当前 prompt 只是写出 skill 名称。官方支持用 `$skill-name` 显式调用；对于固定生产流水线，应显式选定 `$news-desk`、`$agent-reach`、`$ra-人话`，不要完全依赖描述匹配。[OpenAI Skills 文档](https://developers.openai.com/codex/skills)

### Codex 无 Key 路径的边界

可以把它保留为 `CodexCliProvider`，特别适合现在的单用户 Mac 快速验证：

- 一次性 `codex login` 后，`codex exec` 会复用本机 ChatGPT 登录态；无浏览器机器还可用设备登录。[认证与自动化](https://developers.openai.com/codex/noninteractive/)
- 官方允许在可信私有 runner 上使用 ChatGPT-managed auth，但说明 API Key 才是更容易配置、轮换的自动化默认方案；`~/.codex/auth.json` 不得提交或共享。[同一官方说明](https://developers.openai.com/codex/noninteractive/)
- 多个后台任务不要共享同一认证文件并行刷新；本机成稿队列应串行。
- 它是“启动 Codex 客户端”的桥，不是可把 ChatGPT token 拿出来当 REST API Key 的捷径。
- 以后迁移服务器或多人使用时，把默认 Provider 换成正式 API；Codex CLI 仍可作为“仅本机可用”的高级 Provider。

## 二、推荐的 Provider 组合

| Provider | 是否另需 Key | 文本成稿 | 截图/图片 | 原生读取 Codex Skills | 推荐定位 |
| --- | --- | --- | --- | --- | --- |
| Codex CLI（ChatGPT 登录） | 否 | 是 | 是，`--image/-i` | 是 | 现在的本机快速验证、带工具核验 |
| Qwen / DashScope | 是 | 是 | 是，Qwen3-VL 系列 | 否，需 harness 编译指令 | 正式默认 Provider；截图提取 + 成稿可一体完成 |
| DeepSeek API | 是 | 是 | 当前公开 Chat API 不支持图片输入 | 否，需 harness 编译指令 | 低成本文本成稿、改写或第二遍润色 |

阿里云 Model Studio 的视觉接口兼容 OpenAI Chat Completions，示例模型为 `qwen3-vl-plus`，消息中可以混合 `text` 与 `image_url`；不同地域的 API Key 与 base URL 不能混用。官方也支持 `response_format: {"type":"json_object"}`，视觉模型可直接从图片抽取结构化 JSON。[视觉接口与地域端点](https://www.alibabacloud.com/help/en/model-studio/qwen-vl-compatible-with-openai) · [结构化输出](https://www.alibabacloud.com/help/en/model-studio/qwen-structured-output)

DeepSeek API 同样兼容 OpenAI 风格，当前 base URL 为 `https://api.deepseek.com`，并支持 JSON Output；但其公开 Chat Completion Schema 把 user `content` 定义为文本字符串，文档没有 `image_url` 输入。因此应在能力表中标记 `vision: false`，不能因为 DeepSeek 有开源 OCR/VL 仓库就推断云 API 也支持图片。[DeepSeek 快速开始](https://api-docs.deepseek.com/) · [JSON Output](https://api-docs.deepseek.com/guides/json_mode/)

建议先只接入一个千问 Key。这样截图和文章共用一个 Provider，故障面最小；以后再让用户选择“千问看图 → DeepSeek 写作”这样的两段流水线。

### 密钥设置必须在后端

设置页可以让用户粘贴 API Key，但浏览器只负责提交：

- 不写入 `localStorage`、前端 bundle、日志或普通 `state.json`。
- Mac 本地版存入系统钥匙串；状态文件只保存 `keyRef`、末四位和连接状态。
- 服务器版改用环境变量或 secret manager。
- UI 提供“测试连接、最后成功时间、余额/限流错误、删除密钥”，绝不再回显完整 Key。
- 自定义 base URL 要做 HTTPS/主机校验；若允许 Ollama/LM Studio 等本机端点，应使用单独的“允许本地 Provider”开关。

## 三、“附一张截图，自动生成文章”应如何做

无需先集成专门的 GitHub 成品。可靠方案是把截图作为一种输入，仍复用同一份文章 Schema：

1. **上传与预处理**：限制 MIME、文件体积和像素；允许裁剪；去除 EXIF；保留原文件哈希。
2. **视觉取证**：Qwen3-VL 或 Codex `-i` 先输出 `EvidenceBundle`，至少包含可见文字、主体、日期、数字、产品名、截图中看不到但需要核实的事项，以及置信度。
3. **补充来源**：若用户同时提供网页 URL，以网页/官方来源为事实主体；只有截图时，文章必须标记“仅根据截图可见内容”，不得补写发布日期和性能数据。
4. **Skill 组装**：把用户选定的写作、核验、平台格式 skills 与 `EvidenceBundle` 一起送给成稿 Provider。
5. **结构化成稿**：返回统一的 `ArticleDraftPayload`，由 Zod/JSON Schema 校验；失败则修复或重试，不能把半截文本当成功。
6. **人工确认**：生成草稿、预览、来源与不确定项，仍由用户点击发布。

Vercel AI SDK 的消息格式原生支持 `Buffer`、Base64 data URL、HTTP URL 等图片输入，并可用 `Output.object()` 校验结构化结果；其 OpenAI-compatible Provider 能统一接入不同 base URL，能力仍需按具体服务商声明。[图片输入](https://ai-sdk.dev/docs/foundations/prompts) · [结构化 Output](https://ai-sdk.dev/docs/reference/ai-sdk-core/output) · [OpenAI Compatible Provider](https://ai-sdk.dev/providers/openai-compatible-providers)

注意：新闻网页截图默认应当作为**证据输入**，不自动成为发布配图。整页截图可能包含受版权保护的正文、图片和界面；配图仍优先使用官方发布图、来源原图或用户明确授权的图片。

## 四、Skill 不等于把 Markdown 全塞进 prompt

Open Agent Skills 标准把一个 skill 定义为含 `SKILL.md` 的目录，可选带 `scripts/`、`references/`、`assets/`；OpenAI 与 Anthropic 都采用这种结构和渐进式加载。[Agent Skills 规范](https://agentskills.io/specification) · [OpenAI Skills](https://developers.openai.com/codex/skills) · [Anthropic 示例仓库](https://github.com/anthropics/skills)

普通的千问/DeepSeek Chat API 不会自动扫描本机 skills，也不会自己执行脚本。因此工作台要实现一个受控的 `SkillRegistry`：

- 扫描用户明确导入的目录，解析 `name`、`description`、兼容 Provider、所需能力和版本。
- 分成三类：`prompt-only`（可用于任意模型）、`tool-assisted`（需要网页/文件等受控工具）、`codex-native`（依赖 Codex CLI 的脚本与运行环境）。
- 用户创建“技能配方”，例如：`新闻核验 + 人话改写 + 小黑盒格式`；每个任务把配方快照写进运行记录，保证以后可复现。
- 只在触发时加载完整说明，引用资料按需加载；不要把所有 skill 全部拼接，既浪费 token，也容易发生指令冲突。
- 导入 skill 前展示来源、文件清单与权限。带脚本的 skill 等同导入代码，默认禁用 shell、网络和工作区写入，只有经过允许的能力才能执行。
- 新闻正文、网页和截图都是不可信数据，必须与系统/skill 指令隔离，防止来源文章中的提示注入获得工具权限。

建议的设置结构：

```text
AI 设置
├── 模型供应商：Codex CLI / 千问 / DeepSeek / 自定义 OpenAI-compatible
├── 模型与能力：text / vision / structured-output / tools
├── Skill 库：导入、启用、权限、版本、测试
├── 技能配方：核验配方 / 快讯配方 / 小黑盒配方
└── 运行策略：超时、重试、并发、预算、人工确认
```

## 五、GitHub 模块：哪些接，哪些不接

| 项目 | 能解决什么 | 决策 |
| --- | --- | --- |
| [vercel/ai](https://github.com/vercel/ai) | TypeScript 多 Provider、流式输出、图片输入、工具调用、结构化输出；`createProviderRegistry` 可用 `provider:model` 管理模型 | **现在集成**。用 `ai` + `@ai-sdk/openai-compatible` + Zod 作为 API Provider 层；Codex CLI 保持独立 Adapter。[Provider Registry](https://ai-sdk.dev/docs/reference/ai-sdk-core/provider-registry) |
| [Agent Skills 标准](https://agentskills.io/specification) / [anthropics/skills](https://github.com/anthropics/skills) | Skill 包结构、渐进式加载和实例 | **采用格式，自己实现注册表与权限层**。不要直接把仓库中全部 skills 装入生产环境，也要逐项检查许可。 |
| [modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk) | 把网页搜索、抓取、发布等能力做成标准 tools/resources/prompts | **后续接入**。仅当要连接外部工具时使用；官方仓库当前提示 v2 仍在开发，生产环境采用推荐的 v1.x，不用 MCP 代替简单的内部函数。 |
| [langchain-ai/langgraphjs](https://github.com/langchain-ai/langgraphjs) | 检查点、故障恢复、暂停/继续、human-in-the-loop、长时间状态图 | **暂缓**。现有流水线仍是确定性的“采集→筛选→成稿→编辑”，先完善自己的持久化状态机；出现复杂分支、多人审批和长时间恢复后再迁移。[LangGraph 概览](https://docs.langchain.com/oss/javascript/langgraph/overview) |
| [BerriAI/litellm](https://github.com/BerriAI/litellm) | 独立 AI Gateway、多 Provider、成本、限流、负载均衡 | **暂缓**。只有 2–3 个 Provider 时会额外引入 Python 服务；多人、多个 Key、统一额度治理时再作为外部网关。 |
| [PaddlePaddle/PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) | 本地 OCR 与版面结构化，支持大量语言 | **可选离线 fallback**。适合“不能把截图上传云端”的场景；它只提取文字，不负责新闻核验和写作。 |
| [deepseek-ai/DeepSeek-OCR](https://github.com/deepseek-ai/DeepSeek-OCR) | 开源图片/PDF OCR 与 Markdown 转换 | **不作为 Mac 首选**。官方示例依赖 Python、CUDA、PyTorch/vLLM，更像 GPU 服务组件；也不代表 DeepSeek 公有 API 已支持图片。 |
| [langgenius/dify](https://github.com/langgenius/dify) / [n8n-io/n8n](https://github.com/n8n-io/n8n) | 完整的可视化 AI/自动化平台 | **不嵌入**。它们会重复现有控制台、草稿编辑器、调度和发布链。可用于对比产品能力，或在放弃自研 UI 时作为替代，而不是组件库。 |

## 六、什么才算完整 Harness

建议把系统明确拆成五层：

```text
输入层：新闻 URL / RSS / 用户截图 / 手工材料
证据层：采集、去重、正文与图片提取、来源追溯、不确定项
AI Harness：Provider Registry + Skill Registry + Tools + Schema + Guardrails
工作流层：任务队列、状态、重试、取消、定时、日志、成本
人机层：草稿编辑、预览、来源核对、手动点击发布
```

因此，当前系统加上“可选模型 + 可组装 skills + 截图输入”后，**可以称为 AI 内容 harness**，但还必须有密钥安全、能力声明、错误状态、可复现配方和权限边界。仅有模型下拉框与 prompt 拼接还不够。

## 七、建议实施顺序

### P0：先让现有 Codex 成稿可验证且幂等

- 增加生成锁、幂等键和草稿 upsert；默认禁止同一候选静默生成两份，另设“生成新版本”。
- 清理 CLI 版本/配置冲突；启动页展示版本、登录、配置和一次最小结构化生成测试。
- 解析 `codex exec --json`，显示实时阶段；失败立即结束转圈。
- 显式调用固定 skills；限制串行、超时、重试和取消。
- 截图入口先直接走 `codex exec -i screenshot.png --output-schema ...`，可在不买 Key 的情况下验证完整体验。

### P1：增加正式 Provider 设置

- 接入 Vercel AI SDK Provider Registry。
- 首先实现 Qwen；配置 region、workspace、base URL、模型与 Keychain 引用。
- 再接 DeepSeek，仅声明文本/JSON 能力。
- 每个 Provider 提供“测试连接、能力探测、最近错误、用量”。

### P2：增加 Screenshot → Evidence → Draft

- 上传/裁剪截图，先抽取结构化证据，再成稿。
- 支持“只看截图”和“截图 + 原始 URL”两种模式，后者默认优先。
- 编辑器中保留截图来源和不确定项；不自动把网页截图作为发布图。

### P3：实现 Skill 工作台

- 导入符合 Agent Skills 结构的目录。
- 先只支持 `prompt-only`，再逐步开放受控工具；脚本 skill 最后做。
- 提供配方、版本快照、冲突排序、token 预估和测试样例。

### P4：复杂度真正出现后再上编排框架

当出现多模型分支、并行核验、暂停审批、跨机器恢复时，再引入 LangGraphJS 或独立 Gateway。现在先保留轻量、自有、可观察的状态机更合适。
