# Appica UI 试点结论（已撤回）

日期：2026-08-11

## 试点范围

- `@appica/ui-react/drawer`：草稿资料、图片、版本和发布面板。
- `@appica/ui-react/tooltip`：折叠侧栏图标说明。
- `@appica/ui-react/toast`：全局成功、提示和错误反馈。

未试点：Tiptap 连续编辑器、`react-resizable-panels` 分栏、表格、表单和业务按钮。

## 为什么最终撤回

试点证明组件功能本身可用，但 Drawer、Tooltip 和 Toast 改变了原工作台熟悉的层级与视觉手感，用户明确更喜欢原来的版本；同时组件库引入了远高于实际收益的 CSS 与 JavaScript 体积。因此恢复原布局并移除全部 Appica/Tailwind 依赖。

保留下来的不是组件代码，而是交互原则：按下要有位移、缩放与阴影反馈，键盘要有焦点环，动画要短，并尊重 `prefers-reduced-motion`。这些现在由项目原有 CSS 轻量实现。

## 构建对比（gzip）

| 资源 | 迁移前 | 迁移后 | 变化 |
| --- | ---: | ---: | ---: |
| 主 CSS | 11.02 kB | 37.70 kB | +26.68 kB |
| 主 JS | 72.52 kB | 88.86 kB | +16.34 kB |
| 共享交互块 | — | 39.11 kB | +39.11 kB |
| 草稿懒加载 JS | 161.69 kB | 171.86 kB | +10.17 kB |

结论：Appica 1.0.0 依赖 Base UI、Motion 与 Tailwind 4，不适合这个以手写 CSS 为主、强调编辑空间的本地工具。当前生产构建已恢复到约 12.00 kB gzip 主 CSS、74.27 kB gzip 主 JS，且没有 Appica/Tailwind 依赖。

## 验证

- `npm run build` 通过。
- `npm test`：14/14 通过。
- Appica/Tailwind 包和样式入口均已移除。
- 原草稿侧栏、右侧工具面板和自定义通知均已恢复。
- 按钮按压、键盘焦点和减少动态效果改由轻量 CSS 提供。
