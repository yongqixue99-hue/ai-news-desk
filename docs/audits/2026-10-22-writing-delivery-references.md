# 写作与多平台交付：外部项目参考审计

研究日期：2026-10-22（Asia/Shanghai）。范围：7 个项目或产品的公开仓库、源代码和官方帮助文档。没有登录或操作真实平台账号，没有调用模型，没有提交外部内容。

## 结论与证据边界

最值得吸收的是三种具体工作方式：**打开就写；一篇母稿配少量平台差异；交付自动完成常规步骤并给出可恢复的逐平台结果**。聚合和更多 AI 功能不应继续占据核心入口。

这是基于外部案例的产品建议，不代表已对本项目做出功能缺失判断，也不是案例产品的真人使用测评。仓库代码、官方文档能证明设计或实现存在，不能证明它们在我们的账号上能稳定完成交付。下面的验收数字都是建议目标，尚未在本项目测量；不能当作优化后的成绩。

六个目标平台保持平等：小黑盒、微信公众号、今日头条、知乎、百家号、小红书。任何外部项目的支持列表都不能替代本项目的真实账号验收。验收必须覆盖正文和每个适用的平台设置；完成前仍标注“未验证”。本文只建议送入草稿箱或编辑器，最终发布由用户完成。

## 1. Wechatsync：最接近交付需求，但不能把支持列表当作现成可用代码

- **准确项目及现状**：[wechatsync/Wechatsync](https://github.com/wechatsync/Wechatsync)，默认分支 `v2`。本次读取分支头为 `a98e42865387285afcc027c61836488748f3b30f`，该提交日期为 2026-05-27；仓库整体最后推送时间更晚，不应把它误读为默认分支最新变更日期。[分支信息](https://api.github.com/repos/wechatsync/Wechatsync/branches/v2)
- **许可证**：公开仓库明确采用 GPL-3.0。[LICENSE](https://github.com/wechatsync/Wechatsync/blob/a98e42865387285afcc027c61836488748f3b30f/LICENSE) 本轮只研究模式，未复制代码。
- **可核实的行为**：README 描述复用浏览器已有登录态、转存图片、默认存草稿。扩展实现确有 `checkAuth`、逐平台 `SyncResult`、图片上传进度、`starting / uploading_images / saving / completed / failed` 阶段；多平台按最多 3 个并发执行，认证检查也有缓存和超时。[README](https://github.com/wechatsync/Wechatsync/blob/a98e42865387285afcc027c61836488748f3b30f/README.md)、[扩展实现](https://github.com/wechatsync/Wechatsync/blob/a98e42865387285afcc027c61836488748f3b30f/packages/extension/src/adapters/index.ts)
- **重要限制**：`.gitmodules` 把 `packages/core/src/adapters/platforms/private` 指向私有适配器仓库；扩展通过 glob 加载它。公开默认分支可见知乎、百家号和微信适配器，但本次公开树未找到头条、小红书、小黑盒的独立适配器。因而不能据 README 的“29+ 平台”推断这些代码均可直接取得，更不能承诺六个平台完整适配。[私有子模块声明](https://github.com/wechatsync/Wechatsync/blob/a98e42865387285afcc027c61836488748f3b30f/.gitmodules)、[公开适配器目录](https://github.com/wechatsync/Wechatsync/tree/a98e42865387285afcc027c61836488748f3b30f/packages/core/src/adapters/platforms)
- **可借用**：把扩展连接、账号识别、图片转存和草稿保存藏在一次交付操作内；只在确实需要重新登录时出现恢复入口。每个平台都返回草稿 ID、编辑器地址、阶段和具体错误。
- **不宜照搬**：它的公共 `Article` 主要包含标题、正文、摘要、封面、标签、分类；`SyncResult.success` 不是“平台所有字段已读回一致”的证明。社区组合、创作计划、权限等需我们自己的逐平台设置模型与验收记录。[内容与结果类型](https://github.com/wechatsync/Wechatsync/blob/a98e42865387285afcc027c61836488748f3b30f/packages/core/src/types.ts) 公开实现还含统计上报调用，因此不能只凭 README 的本地化描述就整包引入。[扩展实现](https://github.com/wechatsync/Wechatsync/blob/a98e42865387285afcc027c61836488748f3b30f/packages/extension/src/adapters/index.ts)
- **最小可验证改变**：先用两个假平台适配器做“一个成功、一个登录过期”。成功项保留草稿回执；登录完成后只续跑失败项；同一稿件同一版本再次交付不新建重复草稿。真实账号验收另行进行。

## 2. doocs/md：排版应该成为稳定结果，而不是每篇文章的额外工程

- **准确项目及现状**：[doocs/md](https://github.com/doocs/md)，默认 `main`；读取头 `0bbfe56b67d7683ad4503e7a7690af277c99c5fe`，提交日期 2026-10-21。[分支信息](https://api.github.com/repos/doocs/md/branches/main)
- **许可证**：仓库明示 WTFPL Version 2。[LICENSE](https://github.com/doocs/md/blob/0bbfe56b67d7683ad4503e7a7690af277c99c5fe/LICENSE)
- **可核实的行为**：Markdown 即时渲染为微信图文，支持主题、自定义样式、本地草稿自动保存、文件导入导出和多种图片存储方式。其核心价值是写作到可用排版的转换。[README](https://github.com/doocs/md/blob/0bbfe56b67d7683ad4503e7a7690af277c99c5fe/README.md)、[官方编辑器](https://md.doocs.org)
- **可借用**：一个稳定的默认文章样式；平台预览使用实际交付转换后的内容；常用样式只设置一次。图片在编辑器内就显示上传状态和最终尺寸，避免去平台重新排版。
- **不宜照搬**：不应把用户必须学习 Markdown 当成前提；也不应把多图床、主题库、模型配置全部露在写作页。微信排版规则不等于六平台通用渲染规则。
- **最小可验证改变**：准备同一篇固定测试稿，包含中英文标题、列表、引用、链接、横竖图片和图注；逐平台保存转换结果的结构快照。编辑页预览与交付使用同一转换函数，常用样式下不需要用户再点一次“排版”。

## 3. Ghost：写作是主页面，格式与设置在需要时出现

- **准确项目及现状**：[TryGhost/Ghost](https://github.com/TryGhost/Ghost)，`main` 读取头 `c6cebcd2221e7492c5c84aa1c90411a421977118`，提交日期 2026-10-21。官方帮助仍提供编辑器、文章设置和多设备预览说明。[分支信息](https://api.github.com/repos/TryGhost/Ghost/branches/main)
- **许可证**：Ghost 仓库 MIT；这不自动涵盖文档提及的第三方图片编辑组件及品牌资产。[LICENSE](https://github.com/TryGhost/Ghost/blob/c6cebcd2221e7492c5c84aa1c90411a421977118/LICENSE)
- **可核实的行为**：选中文本出现上下文工具栏；新段落通过 `+` 或 `/` 插入内容卡片；标签、访问权限等放在文章设置菜单；编辑历史可恢复；预览从编辑器顶部打开，能切换桌面和手机呈现。[编辑器](https://ghost.org/help/using-the-editor/)、[文章设置和历史](https://ghost.org/help/post-settings/)、[预览](https://ghost.org/help/publishing-content/)
- **可借用**：默认只显示标题、正文、保存状态和交付入口；素材、AI 建议、历史、平台设置按需打开。恢复编辑位置，重进应用优先继续最近一篇未完成稿。
- **不宜照搬**：会员、付费墙、邮件群发和团队设置都不属于我们的核心；Ghost 的删除语义也不能替代本项目可恢复的草稿历史。平台预览不必强制持续占半屏。
- **最小可验证改变**：增加一个不必先选题的“开始写作”入口，并用空白、链接、截图、选题四种来源进入同一编辑器。桌面和手机都能在一次操作内进入可输入正文；切换资料抽屉后光标、滚动和已输入内容保持不变。

## 4. Obsidian Web Clipper：捕获输入直接成为写作素材，不另开一套采集流程

- **准确项目及现状**：[obsidianmd/obsidian-clipper](https://github.com/obsidianmd/obsidian-clipper)，`main` 读取头 `6d56d618b00bd970aa738d6a7a61edee27783e81`，提交日期 2026-09-22。官方提供多个浏览器入口，内容保存为本地 Markdown。[分支信息](https://api.github.com/repos/obsidianmd/obsidian-clipper/branches/main)、[README](https://github.com/obsidianmd/obsidian-clipper/blob/6d56d618b00bd970aa738d6a7a61edee27783e81/README.md)
- **许可证**：源码 MIT；README 明确排除商标、图标、营销文案和其他营销资产。[LICENSE](https://github.com/obsidianmd/obsidian-clipper/blob/6d56d618b00bd970aa738d6a7a61edee27783e81/LICENSE)、[范围说明](https://github.com/obsidianmd/obsidian-clipper/blob/6d56d618b00bd970aa738d6a7a61edee27783e81/README.md)
- **可核实的行为**：模板可按 URL 或 schema.org 信息自动匹配，并自动填入元数据；剪藏既可新建笔记也可追加到已有笔记。高亮可保存选中文字、图片和元素，可只带入高亮而非整篇网页。[模板](https://obsidian.md/help/web-clipper/templates)、[高亮](https://obsidian.md/help/web-clipper/highlight)
- **可借用**：在现有稿件粘贴链接或截图后，直接出现“作为资料”卡片；来源、时间、作者等能确定的字段自动填入；用户需要的是继续写，而不是先学习来源管理。
- **不宜照搬**：不把网页正文、社区评论或 OCR 文本直接当成核实过的事实；不要求用户维护模板语言或笔记目录。自动识别失败时仍保留原始输入和捕获状态，不能悄悄换成推测内容。
- **最小可验证改变**：同一个链接重复粘贴不会产生两份来源；截图原图可追溯，OCR 与事实字段分离；捕获失败仍能继续写手稿，生成或交付涉及的事实校验遵循现有 ContentPackage 契约。

## 5. Postiz：共用正文、逐平台差异和设置预设值得借用；全局阻断不值得

- **准确项目及现状**：[gitroomhq/postiz-app](https://github.com/gitroomhq/postiz-app)，`main` 读取头 `c06abc3d786b8f719ced5716ccc70dd8a7251a05`，提交日期 2026-10-21。[分支信息](https://api.github.com/repos/gitroomhq/postiz-app/branches/main)
- **许可证**：AGPL-3.0。[LICENSE](https://github.com/gitroomhq/postiz-app/blob/c06abc3d786b8f719ced5716ccc70dd8a7251a05/LICENSE) 本轮仅借鉴交互及边界，不建议整包嵌入。
- **可核实的行为**：Global 内容默认共用；可把一个渠道分离为独立版本，后续全局修改不再覆盖它。Sets 保存所选渠道及其设置，不保存正文。平台的必填项、字数和媒体规则会校验。[共用与独立内容](https://docs.postiz.com/general/composer/global-vs-per-channel)、[设置组合](https://docs.postiz.com/general/settings/reusables)、[校验](https://docs.postiz.com/general/composer/links-and-validation)
- **可借用**：母稿保持唯一；标题、封面、标签、可见性等作为逐平台覆盖项。默认配置自动带入，折叠摘要可直接看出“关联哪些社区、是否参与计划、是否有封面”。只有用户主动改单个平台正文时才产生分支，并保存它的历史。
- **不宜照搬**：官方文档说明任一所选渠道验证失败会使本次全部不保存；这对我们希望减少反复操作的流程并不理想，应把故障限定在相关平台。也不照搬日历优先、团队、账单或自动发布。Postiz 的公开平台与提供者目录不能证明覆盖我们的中国平台组合。[校验语义](https://docs.postiz.com/general/composer/links-and-validation)、[提供者目录](https://github.com/gitroomhq/postiz-app/tree/c06abc3d786b8f719ced5716ccc70dd8a7251a05/libraries/nestjs-libraries/src/integrations/social)
- **最小可验证改变**：把一次已确认的配置保存为默认预设；之后 10 篇合成稿无需重复填常用字段。改变知乎标题不改变母稿及其他五平台；其中一个平台缺封面时仅该平台待处理，其余已交付结果不撤回、不重复。

## 6. Typefully：把草稿与其工作记录放在一起，减少“我上次写到哪里了”

- **准确产品及现状**：[Typefully](https://typefully.com)。本次依据官方帮助文档的 2026-08-07 和 2026-08-11 页面；没有操作付费账户、测量其界面或核实全部功能实际可用性。
- **许可证**：本次没有取得其编辑器应用的公开源码许可；仅作为交互参考，不能称可直接移植的开源模块。
- **可核实的行为**：平台可以在每篇草稿中开关，内容可先共用再分离；草稿属性把内部名称、标签、临时笔记、字数和活动记录放在正文旁。内部名称不会进入发布内容；在带标签过滤条件下新建草稿，会继承这些标签。[账号与跨平台草稿](https://support.typefully.com/en/articles/8717684-social-sets-and-accounts)、[草稿属性](https://support.typefully.com/en/articles/8717753-tags-metadata)
- **可借用**：在同一稿件里保留资料笔记、最后修改时间、保存状态、平台交付结果；草稿列表用“继续写”和“继续交付”区分下一步，减少用户回忆成本。项目内标签与平台公开话题必须分开。
- **不宜照搬**：它的“主平台”概念与本项目六平台平等的契约不同；不移植团队/多客户 Social Set 体系。它对海外短帖的支持不能据此推断中文长文和小黑盒等设置适配。
- **最小可验证改变**：从草稿列表一次点击回到上次编辑位置；同一页显示各平台最后交付的稿件版本和时间。用户编辑正文后，只有受影响的平台显示“有更新待同步”；工作笔记永不出现在交付正文中。

## 7. AIHOT：继续做后台供稿参考，不把聚合站变成写作产品的主骨架

- **准确项目及现状**：[KKKKhazix/AIHOT](https://github.com/KKKKhazix/AIHOT)，`main` 读取头 `47531faa635c7f4313e526dd0b56312c1a23ba30`，提交日期 2026-10-21。作者明确说公开库是线上引擎的框架导出，但不保证每次线上变更同步，且不包含实际运营信源与数据。[README](https://github.com/KKKKhazix/AIHOT/blob/47531faa635c7f4313e526dd0b56312c1a23ba30/README.md)
- **许可证**：代码 MIT；名称、Logo 不在许可范围，字体另有许可。[LICENSE](https://github.com/KKKKhazix/AIHOT/blob/47531faa635c7f4313e526dd0b56312c1a23ba30/LICENSE)、[README 范围](https://github.com/KKKKhazix/AIHOT/blob/47531faa635c7f4313e526dd0b56312c1a23ba30/README.md)
- **可核实的行为**：按事件而非单篇来源组织报道，热度按独立来源与时间衰减计算；人工改过的事件归属不覆盖；提示词和门槛分开配置，有用户标注样本评测路径。这些是仓库说明的设计，不是本次对算法质量或速度的实测。[README](https://github.com/KKKKhazix/AIHOT/blob/47531faa635c7f4313e526dd0b56312c1a23ba30/README.md)
- **可借用**：选题卡给出事件增量、可靠原始来源、为什么值得写；同一件事合为一条，写过的只在有进展时回来。现有聚合和精选模块可按这些目标验收。
- **不宜照搬**：公开热点网站、日报站的浏览结构不能作为写作首页；增加多轮模型评分也不能直接解决“写完后还要去平台修”。不引入其完整部署栈，不在本轮增加模型调用或费用。
- **最小可验证改变**：构造“官网原文 + 4 次转载 + 1 条后续进展”的固定样本：只出现 1 个主事件，来源可展开，后续进展明确标识；点“开始写”直接带入来源材料与可追溯证据，不先经过新的配置页。

## 最值得吸收的三个模式及验收建议

以下是本项目的建议实验，不是外部项目已证明的性能。先用隔离示例数据和假平台验证交互、故障恢复；平台字段的最终验收必须由真实账号确认。

| 优先级 / 模式 | 建议最小改动 | 可度量验收 |
| --- | --- | --- |
| P0：文章是唯一工作单元（Ghost + Obsidian + Typefully） | “写文章 / 继续写”成为直接入口；空白、链接、截图、选题汇入同一编辑器；素材和检查收在稿件旁 | 从首页进入可输入正文 ≤ 1 次点击；四种起稿方式都不要求先完成采集；恢复同一稿件的光标和滚动位置；切换素材/平台面板 20 次，正文和撤销记录不丢失；内部笔记交付泄漏 0 |
| P0：一篇母稿 + 自动平台配置（Postiz + doocs/md） | 平台选择、社区/话题、可见性、计划与封面绑定预设；需要时展开修改；预览与交付共用转换器 | 已登录、稿件完整且默认配置适用时，“交付”仅 1 次点击；连续 10 篇合成稿重复填写默认字段 0 次；每平台适用必填项读回一致率 100%；预览与交付正文结构一致；改单个平台覆盖项不改其余平台 |
| P0：每平台完成并可恢复的交付（Wechatsync 的分阶段结果 + 本项目幂等要求） | 自动发现连接；过期账号就地恢复；保留成功项；提供编辑器直达链接；异常显示具体下一步 | 6 平台合成测试中注入 1 项失败，其他 5 项不受影响；点击重试后只重跑失败项；同一版本重试 10 次新增重复草稿 0；刷新/断网/休眠后能找回结果；真实验收每平台逐字段通过后才从“未验证”改为已验收；最终发布请求 0 |

另外保留一个衡量产品是否值得使用的总指标：**同一篇固定文章、同一组目标平台，分别记录在原生平台手工处理和在新闻工作台交付时的操作次数、重复输入字段数、平台内修补次数、交付完成时间**。新闻工作台的常规路径必须更少；若仍需要到平台补社区、话题、封面或重排正文，就应把这次交付记为未完成验收，而不是仅因为正文填上了就显示“成功”。

不建议当前优先增加：更多资讯来源、复杂看板、主题皮肤库、更多 AI 助手入口、团队与账号体系、自动最终发布。先用一篇用户愿意真正发出的文章，把现有平台的常用配置和恢复流程做实，再扩能力。

## 本次研究的限制

- 仅做第一方公开资料与部分实现核查，没有下载或运行这些项目，没有对比它们的真人任务耗时，没有把 README 中的性能、覆盖平台数和营销数字当成实测。
- Wechatsync 私有子模块不可凭公开仓库审计，无法保证其中平台适配器可获取或符合我们的字段要求。
- Obsidian 旧路径 `help.obsidian.md/web-clipper/clip` 本次访问失败；引用使用已成功读取的官方模板、高亮及仓库页面。
- 许可证信息仅记录项目明示内容；任何后续代码移植应逐个文件核对许可、依赖与来源记录。本报告没有复制实现或品牌资产。
- 当前账号的真实登录状态、原生页面字段及交付成功率，需要本项目另行验收；本次研究没有替代或执行它们。
