# 微信配置与多平台图文投递调研

核查日期：2026-09-20。范围：保存公众号身份信息；核查一键发送和最终发布能力；选择后续接入路线。本次没有向任何平台发布文章，也没有安装第三方发布工具。真实账号端到端成功率尚未验证。

## 本次配置

公众号设置增加可选 `originalId`（gh_ 原始 ID），可保存、显示和校验；旧配置仍兼容。它只用于账号识别，不能替代 AppSecret，也不证明它与 AppID 的所属关系。具体账号值仅保存在本机 `.workflow`，不写入源代码。AppSecret 仍只进入 Keychain/DPAPI。

现有微信接入已实现图片上传、草稿新增、原位更新与回执。连接测试只读取草稿数量，不发布文章。尚需用户在设置中保存 AppSecret，并检查实际出口 IP 白名单、账号接口权限。Mac 的密钥不会随代码同步到 Windows。

## 微信“一键发布”的边界

官方 [发布草稿文档](https://developers.weixin.qq.com/doc/service/api/public/api_freepublish_submit) 明确说明：先保存草稿，再提交 media_id。返回任务 ID 仅代表受理，必须等待结果；审核或原创声明仍可能失败。官方当前适用范围表将公众号标为“仅认证”，解释为企业主体已认证；服务号列为可调用。账号实际接口权限还需以后台和测试结果确认。

因此要分别显示草稿已保存、已提交、审核中、已公开发布、失败和待人工处理。公开成功需核对 [发布状态](https://developers.weixin.qq.com/doc/service/api/public/api_freepublish_get) 返回的状态及文章链接。发布与群发是不同功能，不应将草稿上传、任务受理、粉丝推送混用一个“成功”。

本项目当前约定仍是同步草稿后由用户在微信后台发布。本轮未修改这一约定。若后续增加用户点击触发的最终发布，应先完成账号资格确认、固定稿件版本和目标账号、回执核对；不做无人确认的定时公开发布。

## GitHub 案例核查

| 项目 | 直接核查到的能力 | 对本项目的价值与限制 |
| --- | --- | --- |
| [Wechatsync](https://github.com/wechatsync/Wechatsync) | 浏览器扩展、CLI/MCP、本地登录态、多平台文章和图片同步；主 README 明确草稿优先 | 图文投递首选参考。公开适配器中知乎、B站、掘金、CSDN等主要保存草稿；函数名 publish 不代表公开发布。头条列在产品名单，但当前公开树中未找到完整适配器，需实际安装包验证或独立适配。仓库整体 GPL-3.0，不能因为 CLI 子包标 MIT 就将全部代码按 MIT 复制 |
| [ArtiPub](https://github.com/crawlab-team/artipub) | 多平台发布管理、工作流、状态面板；当前 README 已转向 AI 工作流版本 | 参考发布队列和后台组织。不同版本能力差异大，本次未验证其宣称的自动适配和发布成功率，不建议整体替换现有工作台 |
| [social-auto-upload](https://github.com/dreammis/social-auto-upload) | 主要面向视频分发，部分平台有图文上传，提供 CLI 和浏览器登录流程 | 适合以后扩展抖音、小红书、视频号等；不作为当前长文章多平台分发的首选底座 |
| [toutiaohao-mcp-server](https://github.com/SuperWangYuan/toutiaohao-mcp-server) | Go/浏览器自动化，声明支持头条图文与草稿 | 可研究交互路径；核查时社区样本很少，未看到足够证据称为成熟可靠方案，不能直接承诺生产成功率 |

关键源码：[Wechatsync 平台导出及私有适配器说明](https://github.com/wechatsync/Wechatsync/blob/v2/packages/core/src/adapters/platforms/index.ts)、[知乎草稿实现](https://github.com/wechatsync/Wechatsync/blob/v2/packages/core/src/adapters/platforms/zhihu.ts)、[B站草稿实现](https://github.com/wechatsync/Wechatsync/blob/v2/packages/core/src/adapters/platforms/bilibili.ts)。本次没有找到可直接证明适用于用户头条账号的官方开放发文接口；这不等于断言所有机构合作接口都不存在。

## 建议接入顺序

1. **微信、小黑盒**：先验证现有单篇完整投递，明确草稿保存与最终发布状态。微信走已有官方 API；小黑盒沿用本地 Chrome 扩展。
2. **今日头条、知乎、百家号**：适合 AI 科技长图文，作为首批新渠道。先落实登录识别、标题/封面/正文图迁移、草稿回读，再逐账号验证最终公开发布的条件。
3. **掘金、CSDN、B站专栏**：按技术教程和长文的适配性选择，避免所有稿件无差别全选。
4. **小红书、抖音图文、微博**：先生成适配后的卡片或短文供用户审定，不把长文原样推过去。
5. 可选 **WordPress**：有自建博客时，官方 [Posts REST API](https://developer.wordpress.org/rest-api/reference/posts/) 可直接区分 draft/publish，适合做可控的正式发布渠道。

## 工作台实现建议

保留现有 DraftDesk / DeliveryDesk，新增平台适配器和独立的账号连接信息。界面让用户选择已核对账号和平台，一次触发投递；每个平台保留独立任务、状态、稿件版本、回执和文章链接。

成功判据：草稿回读匹配才显示已保存；平台确认公开且有正确链接才显示已发布；审核中继续只读查询；验证码或登录失效提示处理。网络中断导致结果未知时先核对平台记录，不盲目重发。某个平台失败不覆盖其他平台的成功回执。

初期优先独立进程/扩展桥接已有工具，通过结果协议接入，不将第三方整套编辑器和自动改写带入工作台。先选一篇审定稿、一个平台实测，再扩到多个平台；不得把 README 的平台数量当作全部平台已验收。

## 本次工程验证

1075 项主测试、编辑黄金集 22/22、构建通过。隔离环境检查了原始 ID 的 API 保存、部分更新保留、错误格式拒绝、界面保存后重载，以及 1440/390 像素布局。测试使用虚构账号，不调用微信接口。
