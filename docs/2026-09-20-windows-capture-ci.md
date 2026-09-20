# Windows 图表截图 CI 失败修复

截图中的四封 GitHub 失败邮件均指向同一个浏览器测试：`rendered article capture keeps SVG legends and HTML benchmark tables, excluding site chrome`。期望两张原文图表，实际返回零或一张。

| 运行 | 提交 | 失败位置 |
| --- | --- | --- |
| 35460508842、35460511308 | 0af9407 | Windows 图表截图 |
| 35462326531 | 64119a7（main） | Windows 图表截图 |
| 35463722229 | f3caba0 | Windows 图表截图 |

诊断运行 35480230780 在同一 Windows 环境复现，具体异常为 `locator.scrollIntoViewIfNeeded: Timeout ... waiting for element to be stable`。原代码在截图前额外等待稳定并滚动，只有三秒预算；浏览器渲染帧延迟时提前放弃，单图异常又被吞掉。后续提交偶尔通过并不代表这个问题已修复。

现在由 `locator.screenshot` 在同一次操作中关闭动画、等待稳定、滚动并截图，移除重复的前置滚动与固定休眠，统一使用十秒上限。保留单图故障隔离，增加可选失败诊断回调；不放宽图片数量、尺寸、图注或正文区域断言。

回归测试用真实 Chromium CDP 暂停渲染时钟四秒：修复前稳定复现丢图，修复后保留图表和图注。CI 另连续执行五次原有图表检查，每次都必须通过；不是失败重试。CI 缺少浏览器时直接失败，避免静默跳过。

本地验证：1075 项主测试、编辑黄金集 22/22、TypeScript/Vite 构建通过。合并前检查修复提交的 Linux/Windows CI；合并后另检查 main 的完整 CI，不以 PR 通过代替 main 验收。旧提交的失败记录与已发送邮件保留历史状态，不删除、不重新标为成功。
