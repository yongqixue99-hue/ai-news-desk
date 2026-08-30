# Appica UI 与 Remocn 的适配判断

**调研日期：** 2026-08-11  
**范围：** 用户截图中最后两项。只采用官网、官方文档、官方仓库及官方包清单。

## 身份确认

1. **[Appica UI](https://appica.dev/ui)** 是通用的 React Web UI 组件库，官方包为 [`@appica/ui-react`](https://www.npmjs.com/package/@appica/ui-react)。
2. **[Typography · remocn](https://www.remocn.dev/docs/typography)** 不是名为“Typography”的独立组件库，而是 **Remocn** 的文字动画分类；Remocn 面向 Remotion 视频，而非普通交互网页。

## 结论

| 项目 | 能否接入当前 React + Vite + Tiptap 系统 | 建议 |
| --- | --- | --- |
| Appica UI | **可以，但有 Tailwind v4 接入成本** | 小范围试点，先用 `Drawer`、`Tooltip`、`Toast`，不整站替换 |
| Remocn Typography | React 语法兼容，但运行模型不匹配普通网页 UI | 当前不引入；只借鉴动效，未来用于“文章转短视频” |

“更丝滑”主要来自一致的状态过渡、及时反馈和减少无效重渲染，并不由组件库名称本身保证。Appica 能改善抽屉、浮层和反馈的手感；Remocn 直接加入反而会引入不必要的视频时间轴运行时。

## 1. Appica UI

### 技术与分发方式

- 官方安装条件是 React / React DOM `>=19`、Tailwind CSS `>=4`；Vite 使用 `@tailwindcss/vite`。[安装文档](https://appica.dev/ui/docs/react/installation)
- 组件基于 Base UI；包依赖还包括 `motion`、CVA、`clsx`、`tailwind-merge`、日期和 Embla Carousel 等，未使用 GSAP。精确依赖见[官方 package.json](https://github.com/appica-dev/appica-ui/blob/main/packages/react/package.json#L433-L475)。
- 它是普通 npm 包，不是复制源码的 shadcn registry。官方要求安装 `@appica/ui-react`、导入 `styles.css`、让 Tailwind 扫描包的 `dist`，并通过组件子路径导入以便 tree-shaking。[安装文档](https://appica.dev/ui/docs/react/installation)
- 动效以 CSS 状态过渡为主，少数组件使用 Motion；组件会尊重 `prefers-reduced-motion`。[动画文档](https://appica.dev/ui/docs/react/animation)

### 与当前项目的兼容性

当前项目已是 React `19.2.8` + Vite，但仍使用手写 CSS，尚未安装 Tailwind。因此 React 层面直接兼容，样式管线需要新增 Tailwind v4。Appica 的 token 样式与 Tailwind preflight 都是全局的，接入后应做一次编辑器、按钮、标题和图片工具栏的视觉回归。

这是基于官方安装要求和当前 [`package.json`](../../package.json) / [`package-lock.json`](../../package-lock.json) 的适配推断。

### 最值得接入的组件

- [`Drawer`](https://appica.dev/ui/components/react/drawer)：支持 `left/right/top/bottom`，适合右侧滑出的发布栏；移动端还可保留手势关闭。
- [`Tooltip`](https://appica.dev/ui/components/react/tooltip)：给收起后的 52px 图标侧栏补足名称和快捷键提示。
- [`Toast`](https://appica.dev/ui/components/react/toast)：用于自动保存、采集完成、图片上传和发布结果，替代页面内跳动的提示条。
- [`Toolbar`](https://appica.dev/ui/components/react/toolbar) + [`Toggle Group`](https://appica.dev/ui/components/react/toggle-group)：可逐步统一 Tiptap 的格式工具栏；需要手动绑定 `editor.isActive()` 与编辑命令，Appica 没有 Tiptap 专用适配器。
- [`Dropdown Menu`](https://appica.dev/ui/components/react/dropdown-menu)、[`Popover`](https://appica.dev/ui/components/react/popover)、[`Scroll Area`](https://appica.dev/ui/components/react/scroll-area)：适合更多发布选项、图片设置、草稿及版本列表。
- [`Slider`](https://appica.dev/ui/components/react/slider)、`Select`、`Switch`：适合 12–24 小时采集窗口、来源选择和定时开关；其中 Slider 会用到 Motion。

不要替换 Tiptap 和现有 `react-resizable-panels`；它们承担的是编辑器内核和分栏尺寸，不是 Appica 的优势范围。

### 性能判断

采用子路径导入时，官网声明只会打包实际使用的组件和工具类。首轮只接入 `Drawer`、`Tooltip`、`Toast`，运行时增量应明显小于整库根入口导入；发布抽屉还可以继续按需懒加载。避免首轮加入 Carousel、Date Picker、Text Animate 等与编辑流程无关的模块。

以上是基于[官方 tree-shaking 说明](https://appica.dev/ui/docs/react/installation)和[包的子路径 exports](https://github.com/appica-dev/appica-ui/blob/main/packages/react/package.json)作出的性能推断，仍应以 Vite 构建产物和浏览器 Performance 面板实测为准。

### 成熟度与许可

Appica UI 是 MIT 许可。[LICENSE](https://github.com/appica-dev/appica-ui/blob/main/LICENSE)  
当前公开仓库只有 2026-07-09 的[首次公开发布提交](https://github.com/appica-dev/appica-ui/commit/26de9b1e02d2fb48694ae52d2371b1bbd71ee9d6)，npm 版本为 `1.0.0`。它很新，尚没有足够长的维护记录，因此适合可回滚的小范围试点，不宜一次性重写全站。

## 2. Remocn Typography

### 它实际上是什么

Remocn 是一个给 **Remotion 视频项目**使用的 copy-paste registry。官方要求先有 Remotion 项目，再用 shadcn CLI 把组件源码复制进项目；组件依赖 `useCurrentFrame()`、`interpolate()`、`spring()` 等视频帧 API。[官方介绍](https://www.remocn.dev/docs/getting-started/introduction) · [官方 README](https://github.com/Remocn/remocn)

以 [`TrackingIn`](https://www.remocn.dev/docs/typography/tracking-in) 为例，registry 声明依赖 `remotion`，源码每帧读取视频时间并计算字距、模糊和透明度；该类 Typography 组件没有 Tailwind、Framer Motion 或 GSAP 依赖。[registry](https://github.com/Remocn/remocn/blob/main/registry/remocn/registry.json) · [源码](https://github.com/Remocn/remocn/blob/main/registry/remocn/tracking-in/index.tsx)

### 对当前系统的判断

它不适合作为编辑器 UI 依赖：普通网页没有 Remotion 的视频帧上下文，引入它还会为标题、菜单或抽屉增加视频运行时和逐帧计算。即使视觉效果漂亮，也不会让 Tiptap 输入、分栏拖动或发布面板变快。

可借鉴但不直接安装的部分：

- 图片选中后工具条的短距离上移 + 淡入；
- 发布抽屉 180–240ms 的位移与遮罩渐变；
- 采集或生成状态中的轻量 shimmer；
- 将来生成文章宣传视频时，再独立建立 Remotion 渲染模块使用 Typography、转场和设备演示组件。

Remocn 为 MIT 许可。[LICENSE](https://github.com/Remocn/remocn/blob/main/LICENSE)  
仓库在 2026-08-08 仍有[合并更新](https://github.com/Remocn/remocn/commit/0797bfe319bd2dae06eea5a9f67591e1b31392e5)，维护活跃，但产品方向仍明确是视频组件。

## 建议实施顺序

1. 先保持当前草稿编辑结构，只完成自动保存与版本历史。
2. 建一个 Appica 小试点：右侧发布 `Drawer` + 左栏 `Tooltip` + 全局 `Toast`。
3. 对比接入前后的主包 gzip、抽屉首次打开耗时、输入时长任务和键盘可访问性；通过后再考虑 Toolbar、Slider、Select。
4. Remocn 不加入主 Web 包；等做“文章自动转视频”时作为独立模块评估。

