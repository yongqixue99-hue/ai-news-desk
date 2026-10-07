# D2 逐文件样式审查

仅处理 `legacy` 层，每个文件独立 PR。扫描 `src/`、`server/`、`chrome-extension/` 中的 TS/JS/HTML 及 SVG/JSON/Markdown 文本资源，不把 CSS 自身当引用。动态前缀、混合全局选择器、未知语法、仍被使用的父级、`layout-*` 与 `preview-article-title` 均保留。

截图使用 `scripts/ui-preview/matrix.mjs` 和 `shot.mjs` 的同一采集函数，固定时钟、软件渲染、sRGB 与固定 Skia/字体参数、字体完成加载、禁用动画与光标，等待500ms及两帧完整绘制。前后版本可通过 AI_NEWS_DESK_PREVIEW_BEFORE_DIST 指向独立旧构建，在同一浏览器进程逐页成对采集，避免跨进程SVG曲线栅格化差异；断言仍为原始像素完全相等。48 张覆盖：10 页面、阅读器、草稿编辑/对照/预览、通知中心、AI 设置 3 标签、自动化 3 标签、连接平台 3 标签，每项在 1440×900 与 390×844 采集。服务只读虚构内存状态，不代理正式服务，不初始化数据库，不访问外部网页。PNG 保存在忽略的 `.artifacts/optimization/D2/`，公开仓库只提交数字结果。

| 文件 | PR | 源文件字节前→后 | 删除规则 | 构建 CSS 字节前→后 | 截图对比 | 验证 |
| --- | --- | --- | --- | --- | --- | --- |
| src/components/social-delivery.css | [#19](https://github.com/yongqixue99-hue/ai-news-desk/pull/19) | 6005→6005 | 0 | 457709→457709 | 48/48，像素差异0 | 单测1364/1364、编辑22/22、构建通过、E2E13/13 |
| src/styles.css | [#20](https://github.com/yongqixue99-hue/ai-news-desk/pull/20) | 293668→265786 | 255 | 457709→433511 | 48/48，像素差异0 | 单测1365/1365、编辑22/22、构建通过、E2E13/13 |
| src/desk-design.css | [#21](https://github.com/yongqixue99-hue/ai-news-desk/pull/21) | 30584→29243 | 19 | 433511→432366 | 48/48，像素差异0 | 单测1365/1365、编辑22/22、构建通过、E2E13/13 |
| src/reader-design.css | [#22](https://github.com/yongqixue99-hue/ai-news-desk/pull/22) | 23991→23745 | 2 | 432366→432146 | 48/48，像素差异0 | 单测1365/1365、编辑22/22、构建通过、E2E13/13 |
| src/strategy-design.css | [#23](https://github.com/yongqixue99-hue/ai-news-desk/pull/23) | 7980→7788 | 2 | 431898→431730 | 48/48，像素差异0 | 单测1365/1365、编辑22/22、构建通过、E2E13/13 |
| src/swiss-design.css | [#24](https://github.com/yongqixue99-hue/ai-news-desk/pull/24) | 34061→33777 | 4 | 432146→431898 | 48/48，像素差异0 | 单测1365/1365、编辑22/22、构建通过、E2E13/13 |
| src/components/source-radar.css | [#25](https://github.com/yongqixue99-hue/ai-news-desk/pull/25) | 4752→4752 | 0 | 431730→431730 | 48/48，像素差异0 | 单测1365/1365、编辑22/22、构建通过、E2E13/13 |
| src/settings-design.css | [#26](https://github.com/yongqixue99-hue/ai-news-desk/pull/26) | 18164→18164 | 0 | 431730→431730 | 48/48，像素差异0 | 单测1365/1365、编辑22/22、构建通过、E2E13/13 |
| src/draft-design.css | [#27](https://github.com/yongqixue99-hue/ai-news-desk/pull/27) | 25927→25927 | 0 | 431730→431730 | 48/48，像素差异0 | 单测1365/1365、编辑22/22、构建通过、E2E13/13 |
| src/xiaoheihe-delivery.css | 待建PR | 6228→6228 | 0 | 431730→431730 | 48/48，像素差异0 | 单测1367/1367、编辑22/22、构建通过、E2E13/13 |

保留所有没有充分证据能删除的规则。零删除同样是完整审查结果。

第5子批PR #23 已同步最新main并通过正常PR合并，原接口阻塞解除。各行体积是在该PR分支的真实构建上测量，未合并分支的数字不代表当前main。

从第10文件开始，前后构建在同源完整加载，额外验证全部非CSS资产逐字一致。视口仍1440/390 CSS像素，使用DPR3（截图4320/1170物理像素），每对比较完整原始像素，零容忍；没有掩码或跳过区域。
