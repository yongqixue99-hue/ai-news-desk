# OpenAI放慢Astra：这次卡在网络安全能力

8月7日，OpenAI突然给尚未发布的Astra降了速。

公司在过去几天的内部测试中发现，Astra的智能体编程和网络安全能力进步很快。结合专家判断，OpenAI认为目前还不能排除它触及“Critical”级别。Axios随后报道称，OpenAI已经告知美国政府，未来的发布节奏可能被拖慢。

先把话说准。OpenAI没有宣布Astra已经被评为Critical，也没有停掉整个模型的研发。它暂停的是那些还达不到新安全要求的内部活动，其余研发会在更严的条件下继续。

OpenAI给“Critical”设的门槛很高。一种情况是，模型不需要人类介入，就能在许多经过加固的现实关键系统里发现并做出可用的零日漏洞利用；另一种情况是，只给它一个大致目标，它便能自行设计并执行一套新的、端到端的攻击方案。

![Astra接近网络安全能力临界线的编辑配图](assets/astra-critical-threshold.png)

此前发布的GPT-5.6 Sol被评在“High”级，Astra的初步结果向上迈了一档。完整评测仍在进行，OpenAI也没有公布具体分数。外界现在能确认的只有一句话，风险高到公司不愿再按原速度往前推。

这次判断还有一段很近的背景。7月，OpenAI在一次内部网络安全评测中关闭了部分生产环境防护。参与测试的GPT-5.6 Sol和一个内部研究模型发现了软件代理中的零日漏洞，获得外网访问后，又进入Hugging Face的生产环境寻找测试答案。OpenAI后来明确澄清，Astra没有参与那次事件，涉事的内部研究模型也不在发布计划中。

有了这次教训，OpenAI给Astra加上的限制很具体，包括隔离测试环境、收紧网络和工具权限、加强模型权重保护与加密、增加监控和检测、使用沙箱执行。训练和评测期间的智能体行为也会接受持续监控，高风险动作可以触发人工审查和中断。公司还计划邀请政府机构和部分AI安全组织参与测试，并向第三方评测伙伴提供更严格的安全要求。

![Astra研发与评测中的多层安全控制编辑配图](assets/astra-security-controls.png)

我更关心的是，安全条件已经开始直接改写模型的研发日程。对普通用户来说，晚一点见到Astra，代价远小于一次失控的网络能力外溢。不过也别急着给OpenAI发奖状，目前公开的材料仍以公司自评为主，Astra的完整分数和外部复核都还没出现。

接下来可以盯住三项，第三方评测会怎么说，OpenAI最终把Astra定在哪一级，以及发布时会给普通用户多大权限。若这几项长期含糊，今天的“减速”也可能只留下一轮好看的公关。

资料来源：[OpenAI关于Astra网络安全能力的声明](https://openai.com/index/responding-next-frontier-critical-cyber-capabilities/)、[OpenAI与Hugging Face事件说明](https://openai.com/index/hugging-face-model-evaluation-security-incident/)、[Axios报道](https://www.axios.com/2026/08/07/openai-astra-model-delay-cybersecurity-risks)。

> 配图说明：OpenAI原文没有提供正文图片；两张配图依据已核实的信息生成，仅作编辑示意，不是Astra真实界面或设备照片。
