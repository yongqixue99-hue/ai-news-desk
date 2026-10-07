# D4 HTTP路由拆分

只移动HTTP适配层，既有领域服务与编辑规则不变。原126个API路由及5个既有注册器的顺序保存在 [基线](http-route-baseline.json)，逐段反向还原处理器后与原文完全相等。存储函数与已初始化/稍后初始化的服务通过只在原使用点读取的类型化getter接入；注册阶段没有IO。

| 领域 | 状态 | PR | 路由数 | index字节前→后 | 验证 |
| --- | --- | --- | --- | --- | --- |
| source | 已合并 | [#35](https://github.com/yongqixue99-hue/ai-news-desk/pull/35) | 15 | 149583→132010 | 原文15/15完全一致；单测1374、编辑22/22、构建、E2E13全过 |
| story | 已合并 | [#36](https://github.com/yongqixue99-hue/ai-news-desk/pull/36) | 15 | 132010→121261 | 原文15/15完全一致；单测1376、编辑22/22、构建、E2E13全过 |
| package | 已合并 | [#37](https://github.com/yongqixue99-hue/ai-news-desk/pull/37) | 6 | 121261→115083 | 原文6/6完全一致；单测1378、编辑22/22、构建、E2E13全过 |
| editorial | 已合并 | [#38](https://github.com/yongqixue99-hue/ai-news-desk/pull/38) | 7 | 115083→110655 | 原文7/7完全一致；单测1380、编辑22/22、构建、E2E13全过 |
| draft | 已合并 | [#39](https://github.com/yongqixue99-hue/ai-news-desk/pull/39) | 13 | 110655→94156 | 原文13/13完全一致；单测1382、编辑22/22、构建、E2E13全过 |
| delivery | 已合并 | [#40](https://github.com/yongqixue99-hue/ai-news-desk/pull/40) | 14 | 94156→79607 | 原文14/14完全一致；单测1384、编辑22/22、构建、E2E13全过 |
| learning | 已合并 | [#41](https://github.com/yongqixue99-hue/ai-news-desk/pull/41) | 18 | 79607→68690 | 原文18/18完全一致；单测1386、编辑22/22、构建、E2E13全过 |
| workflow | 已合并 | [#42](https://github.com/yongqixue99-hue/ai-news-desk/pull/42) | 15 | 68690→58729 | 原文15/15完全一致；单测1388、编辑22/22、构建、E2E13全过 |
| data | 已合并 | [#43](https://github.com/yongqixue99-hue/ai-news-desk/pull/43) | 6 | 58729→53381 | 原文6/6完全一致；单测1390、编辑22/22、构建、E2E13全过 |
| settings | 进行中 | 待建PR | 8 | 53381→42337 | 原文8/8完全一致；单测1392、编辑22/22、构建、E2E13全过 |
| media | 未开始 | — | 9 | — | — |

公共HTTP辅助函数的原文移到http-route-support.ts；入口保留中间件、服务创建、持久任务与启动顺序。测试用内存状态和随机本机临时端口，不读取真实数据库、不调用平台或模型。
