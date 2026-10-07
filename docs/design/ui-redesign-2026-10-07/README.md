# 2026-10-07 界面改版与休眠误判修复

## 样式架构

- 入口改为 `src/design/index.css`。此前的 16 个样式文件按原顺序收进 `legacy` 级联层，行为不变。
- 新设计系统不分层，位于其上：`tokens.css`（色彩、圆角、阴影、字体）、`shell.css`（侧栏与框架）、`controls.css`（按钮、输入、滚动条）、`today.css`、`pages.css`。新规则无需拼选择器权重即可覆盖旧规则；旧文件可以逐个选择器退役。
- 新样式只写在 `src/design/`。旧文件中带 `!important` 的声明仍然优先于新层。

## 视觉

保留红白风格、一级入口和全部交互。暖纸色侧栏配白色工作区；页面标题使用本机宋体（Windows 回退到系统黑体）；Latin 文字改用系统 UI 字体。今日页：报头、胶囊栏目、红色序号、材料状态胶囊、行内主次动作、右侧工作卡片。选题行不再重复显示同名来源。

未引入远程字体或新依赖，未改领域规则、接口或数据。

## 采集「长时间没有实际进展」

10 月 4 日起 24 次采集失败的原因是电脑休眠：任务在短暂的后台唤醒中启动，休眠时间被看门狗计入空闲时长。`server/job-desk.ts` 现在把迟到超过 30 秒的看门狗间隔视为进程挂起，不计入进度与总时限；回归测试见 `server/job-desk.test.ts`。采集器本身用同样 18 个来源隔离实测 3.6 秒读回 1676 条。

## 验证

Node 22.23 / npm 10.9：`npm test` 1334/1334，`npm run eval:editorial` 22/22，`npm run test:e2e` 12/12（修正 `phase-cd` 一处随文案改名而过期的断言），隔离构建 `npm run build -- --outDir .artifacts/ui-redesign/dist` 通过。10 个页面在 1440 与 390 宽度无横向溢出、无脚本错误。

## 中文标题

今日选题和待选题里仍是原文语言的标题会自动补中文：页面调用 `POST /api/today/titles`，服务端最多取 12 条，复用候选速读生成中文标题与一句话摘要。中文为主标题，原题显示在下一行；原标题、链接和证据不变。同一组选题只请求一次，失败时保留原题。设置环境变量 `AI_NEWS_DESK_AUTO_TITLES=0` 可关闭，`npm run test:e2e` 默认关闭，避免隔离测试调用真实模型。这是「浏览不调用模型」的一处明确例外，仅限首屏选题标题。实现见 `server/today-title-backfill.ts`。

## Codex CLI 路径

ChatGPT 桌面应用把内置 CLI 移到 `Contents/Resources/codex-cli/bin/codex`。旧解析只认 `Resources/codex`，于是退回 PATH 上的 0.134，后者不识别 `skip_host_skill_discovery`，速读与正文讲解全部失败。`server/codex-executable.ts` 现在同时识别两种布局，带回归测试。

## 上线

2026-10-07 已执行正式 `npm run build` 并重启 `cn.ai-news-desk`。正式服务实测：7 条英文标题全部补出中文，用时约 81 秒（Codex 0.159，`gpt-5.6-sol`）。最终 `npm test` 1337/1337。休眠后的自动采集需等下一次计划触发才能观察。Windows 未验收。

## 只读预览与截图

`npm run preview:readonly` 在 4399 端口提供工作区前端，只把 GET 请求转给本机 4317 服务，其余请求一律返回 405，因此看界面不会改动稿件、运行、设置或交付。`node scripts/ui-preview/shot.mjs <页面> <名称> [宽] [高]` 输出整页截图到 `.artifacts/ui-preview/shots/`，并报告横向溢出与脚本错误。

截图会包含本机真实数据，仓库是公开的，所以不随代码提交。需要入库的截图请使用隔离示例数据。
