# Windows：拉取 main 后的验收清单

先读项目根目录 `AGENTS.md` 和 `docs/WINDOWS-DEVELOPMENT-HANDOFF.md`。这次包括 A–E 的工程更新；Mac 隔离验证通过，不代表 Windows 或真实发布流程已经验收。

## 更新与启动

在现有项目目录用 PowerShell 操作。先检查 `git status --short`：有本地改动时先妥善保存，不能执行 reset/clean 或覆盖 `.workflow`。

如果旧后台服务正在运行，先停服；可使用现有脚本卸载计划任务，它不会删除项目数据，验收后再安装：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\uninstall-windows-service.ps1
```

下列 Git 命令切换到 main 并只接受快进更新；发生分叉时停下处理，不能强制覆盖本地提交。

```powershell
git switch main
git pull --ff-only origin main
node --version
npm --version
npm ci
npm test
npm run eval:editorial
npm run build
npm run dev
```

Node 必须为 22.16 或更新的 22.x，npm 为 10.9.x。逐条运行命令，上一条失败先处理；构建前保持旧服务停止。浏览器打开工作台（默认 `http://127.0.0.1:4317`），按 Ctrl+F5 更新前端资源。先手动启动，不要立即恢复后台任务。

若是新克隆：GitHub 不包含 Mac 的 `.workflow` 或钥匙串凭据；原有 Windows 数据也不会自动出现在新目录。需要迁移时使用产品内的归档只读预检和确认导入流程，不能手工覆盖正在运行的工作区；密钥按当前 Windows 用户配置。

## 先验证不调用模型的流程

1. 检查旧草稿、素材、版本、来源设置及回执仍在；不要为测试清库。
2. 今日页的平台/自定义栏目仍可用；打开、保留选题、返回列表能保持位置。
3. 运行记录中查找某个已有原文链接：旧数据可能提示路径未记录，这是兼容行为，不是采集失败。新运行才会有逐条路径和首次记录的推荐时间。
4. 编辑一份测试稿，检查自动保存、确认定稿、版本恢复；列表、代码和表格保存后不应丢失。
5. “资料 → 当前版本核对”：编辑后的正文不能沿用旧事实背书；核对绑定操作应保留正文。来源变化检查只比较已读到的本地快照。
6. “版本 → 记录实际返工”：记录真正发生的原因；没有计时就留空。
7. “内容策略 → 从修改中学习”：查看依据、预览选题、暂停和删除。真实样本不足时应显示等待，不要为达到五次门槛制造无意义修改；单条偏好需要三篇稿件支持。原文工作副本不应用表达偏好。

## 再做已授权的真实流程

使用你实际选中的题目、现有模型和已核对的材料测试生成、编辑、断开后恢复；核查价格/版本/条件和配图，不能仅以“生成成功”作为通过标准。记录失败时的任务 ID、稿件标题、操作和提示即可，不发送密钥。

微信测试需单独明确允许草稿箱写入，先核权，再验证新建、更新原稿、重复操作不重复创建；手机上查看表格、代码、图注和复杂图可读性。最终发布由你手动完成。此次 GitHub 合并本身没有执行微信操作。

手动验证通过后，先 Ctrl+C 退出手动服务，再使用既有安装与验证脚本：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-windows-service.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\verify-windows-service.ps1
```

未验证：真实 Windows 运行效果、12 篇人工编辑、补足 5 篇图文、实际来源与 CLI、微信及手机预览。请把测试结果回传到当前任务，再逐项收尾。
