# Windows 开发接续

## 当前状态

2026-10-08 D4（未上线）：当前完成editorial领域7个路由的独立拆分，处理器及注册/服务初始化顺序保持原样，详见 [优化进度](2026-10-07-optimization-progress.md)。

项目是单用户、本地优先的 AI 与科技编辑工作台。默认目标是微信公众号草稿箱同步，小黑盒保留兼容。已实现来源采集、Story 聚合、选题与证据包、配图草稿、版本恢复、精确改稿和交付回执。

当前以 [优化进度表](2026-10-07-optimization-progress.md) 为唯一任务状态入口，实施范围与验收见 [优化计划](2026-10-07-optimization-plan.md)。本轮所有已合并代码均未部署；正式本机服务与 `.workflow/` 原样保留。B2/B4 视觉结果等用户看过再上线，C2/C3/C4/D1 需要保持独立 PR 等待决定。

历史日期条目和原文参考完整移到 [变更日志](../CHANGELOG.md)。通过逐块字节数、SHA-256 和原始顺序回归可重建原 README 与本交接文档，未丢弃原文。旧数字不代表当前测试总数，以进度表的本轮实测为准；跨平台零失败是验收不变量。

## 已锁定的决定

- 产品与编辑规则以 [成熟个人产品契约](mature-personal-product.md) 和 [AGENTS.md](../AGENTS.md) 为准，不扩展成团队或多租户服务。
- 来源采集 → Story → 推荐 → 用户选题 → 冻结 ContentPackage → 配图草稿 → 用户编辑 → 微信草稿箱同步 → 用户手动发布。不调用最终发布、群发或无人值守发布接口。
- 社区用于发现与讨论；外链默认读原始来源，评论不冒充事件事实。共识至少15个有效样本和5个独立分支，少于5个标注有限样本。
- 草稿事实只来自冻结证据包；原始标题、URL、作者、证据、图片出处和交付回执保留。相关来源图片优先，禁止无关生成图补空。交付时重新检查权限和平台资格。
- 编辑后仅应用精确补丁；默认去AI味采用确定性 lieflat 白名单。旧草稿及被替代的生成尝试可恢复。
- 复杂行为留在 SourceDesk、StoryDesk、EditorialDesk、PackageDesk、DraftDesk、DeliveryDesk、LearningDesk。路由和组件不重复实现编辑规则，学习反馈不改变事实分数。
- `.workflow/` 不提交、不覆盖、不删除；新克隆不带旧机器的数据与凭据。密钥只在 macOS Keychain / Windows DPAPI，不记录或导出。跨系统图片路径与SHA-256检查保持严格。
- Windows 不把便携归档手工解包覆盖到正在运行的目录；使用只读预览与确认后的事务导入。开发和迁移不以削弱校验换取通过。
- Node.js 必须22.x且至少22.16.0，npm10.9.x，用 `npm ci`；样式新增在 `src/design/` 无层规则，旧样式保留 legacy 层边界。

## 下一步

按 [优化计划](2026-10-07-optimization-plan.md) 和 [进度表](2026-10-07-optimization-progress.md) 从第一个未完成任务继续；不要重做已合并任务。每个领域或旧样式文件保持独立PR，先失败回归、四项验证、verify/windows-desktop最终提交CI，再按用户授权处理合并。所有Git命令执行前用中文说明目的。

本轮禁止正式构建、服务重启、上线、真实平台发送及真实数据修改；需要删除或改写用户数据、新API费用、产品契约冲突时才停下。模型测试使用假实现；真实模型耗时未验证的数字不得声称提速。A2 两次跨休眠采集继续标注待观察。

Windows 首次接续先检查运行时、安装和四项验证：

```powershell
node --version
npm --version
npm ci
npm test
npm run eval:editorial
npm run build -- --outDir .artifacts/verify/dist --emptyOutDir
$env:AI_NEWS_DESK_DIST_ROOT = Join-Path $PWD '.artifacts/verify/dist'
npm run test:e2e
npm run dev
```

浏览器打开 <http://127.0.0.1:4317> 并检查健康接口和日常流程。通过测试、隔离构建及浏览器检查后，批准正式发布时再使用现有脚本安装和检查后台任务；不要在本轮执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-windows-service.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\verify-windows-service.ps1
```

用户参与的验收仍保留：连续12篇真实公众号稿的耗时、修改与图片记录；微信新建/更新同一草稿/内容不变跳过/手机预览；Windows实机四项验证和手动启动后再安装计划任务。不能用假模型或隔离示例替代这些真实验收。知识平台验收不急。
