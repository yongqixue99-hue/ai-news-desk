---
title: "Anthropic开始做芯片，Claude也要自研硬件"
status: prototype-draft
date: 2026-08-07
collection_window: 24h
horizon_run_id: run-20260807T015623Z-3bd00bb4
editorial_score: 15/15
source_image_count: 1
used_image_count: 2
---

# Anthropic开始做芯片，Claude也要自研硬件

Anthropic 最近挂出了几份很不“模型公司”的招聘。Silicon Engineer、Hardware Systems Architect，还有 GPU/TPU 相关岗位。其中硅工程师职位写得很直白，公司正在组建 custom silicon team，要从芯片层往上参与 Claude 的训练和推理。岗位要求候选人实际做过流片和量产，年薪区间是 32 万到 48.5 万美元。

![Anthropic Silicon Engineer 官方招聘页](/Users/xueyongqi/Documents/ChatGPT/project-10/docs/prototype/anthropic-custom-silicon/assets/01-silicon-engineer-job.jpg)

*图：Anthropic 官方招聘页明确写出正在组建 custom silicon team。*

Anthropic 还没打算把 Nvidia、AWS 或 Google 的硬件全换掉。公司对外确认仍会走 multi-chip 路线，自研设计会和现有供应商并行。招聘页把 build / buy / co-design 并列在一起，现阶段保留了自建、采购和合作设计三种做法。

Claude 用户短期不会因此多出一档套餐。芯片团队从招人到流片、量产要很久。但大模型每天都在烧推理成本，硬件效率最后会落到 API 单价、套餐额度和高峰期可用性上。OpenAI 6 月已经公开了与 Broadcom 合作的 Jalapeño 推理芯片，Google 和 Meta 也早早开始做自研加速器。

![Anthropic 招聘页中的 Claude 辅助硬件设计说明](/Users/xueyongqi/Documents/ChatGPT/project-10/docs/prototype/anthropic-custom-silicon/assets/02-claude-assisted-chip-design.jpg)

*图：岗位职责提到让 Claude 参与芯片设计与检查流程。*

招聘页还有一处挺有意思。团队准备让 Claude 参与 RTL 审查、覆盖率分析和规格一致性检查。Claude 可能一边服务用户，一边帮工程师设计下一代运行自己的硬件。第一颗芯片什么时候流片、能省下多少成本，目前都没有答案。

## 来源

- [Anthropic 官方招聘：Silicon Engineer](https://job-boards.greenhouse.io/anthropic/jobs/5286348008)
- [Anthropic 官方招聘：Hardware Systems Architect](https://job-boards.greenhouse.io/anthropic/jobs/5286362008)
- [Ars Technica：Anthropic will design its own hardware to power Claude](https://arstechnica.com/ai/2026/08/anthropic-confirms-plans-to-build-an-in-house-silicon-team/)
- [TechCrunch：Anthropic is hiring an AI chip design team](https://techcrunch.com/2026/08/05/anthropic-is-hiring-an-ai-chip-design-team/)

## 图片核对

- Ars Technica 和 TechCrunch 的题图均来自 Getty Images，未直接转载。
- 本文使用 2 张 Anthropic 官方招聘页截图，用于说明招聘岗位和岗位职责。
- 正式发布时保留来源说明，不把截图描述为已经量产的产品图。

## 待确认

- Anthropic 尚未公布首颗芯片的名称、流片时间、制造伙伴、性能或成本数据。
- 自研芯片不会立即替代 Anthropic 当前使用的第三方硬件。
