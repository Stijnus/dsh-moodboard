# dsh-moodboard · 视觉参考情绪板

[English](./README.md) · [中文](./README-zh-CN.md)

给智能体一份**视觉参考**：把截图和灵感图收进情绪板，打标签、写备注，固定出风格指南——智能体在生成或改版界面之前会先读这份指南。

界面使用 **Warm Sand Studio** 重设计：暖沙色画布、白色卡片、单一珊瑚强调色、柔和的 18–22px 圆角；颜色仍由 Harness 主题令牌派生，浅色与深色模式都能跟随宿主切换。

## 快速开始

最快的方式是在 **Plugins** 页面用 **Add plugin** 安装 `dsh-moodboard`，它会同时启用 **Moodboard** bundle。命令行方式：

```sh
dsh plugin --profile web add dsh-moodboard
```

CLI 只安装包，仍需在 Plugins 页面启用 **Moodboard** bundle。若侧边栏没有出现，重启 Harness（或刷新 Web 界面）。

## 功能

- **Warm Sand Studio 界面**：珊瑚色标记、图片/已钉选数量、Add images / Add from link / Paste image / Copy agent brief 操作，以及可复制给智能体的风格摘要。
- **拖拽上传**截图，自动归一化为可直接引用的图片资源；也支持剪贴板粘贴和文件选择。
- **标签、备注、来源链接**：每条参考都能写清楚「为什么用它」。
- **固定（pinned）风格指南**：只把定义产品视觉语言的那几张交给智能体；顶部 Active style guide 会列出已钉选参考。
- **图库过滤与搜索**，以及带 16:10 预览、Details / Metadata / Style guide / Manage 分区的检查器；窄屏下检查器变为底部抽屉。
- **自动同步**：智能体通过 HTTP 接口新增、修改或删除参考后，面板会在几秒内自动更新，无需刷新页面或重启桌面应用。
- **从链接收录**：**Add from link** 打开 **Add references** 对话框，可在 **From links** 粘贴网页地址，或切到 **Discover** 搜索 Mobbin / Are.na；对话框有实时链接计数、标签输入和「Pin imported references」设置。
- **Mobbin / Are.na 搜索**：用官方 Mobbin REST API（Team/Enterprise 密钥）或公开的 Are.na 搜索直接批量收录参考，并保留应用名与来源链接。
- **浏览器 MCP 桥接**：智能体用 Chrome DevTools MCP / Playwright MCP 截图后，通过 `moodboard` 工具的 `action: "import"` + `paths` 直接导入。
- **从参考到组件的工作流**：`moodboard` 工具新增 `sources` 与 `workflow`，系统提示词也内置「收集 → 筛选 → 提取 → 转译 → 构建 → 校验 → 记录」方法；说明见 [docs/INSPIRATION-WORKFLOW.md](./docs/INSPIRATION-WORKFLOW.md)。
- **智能体工具 `moodboard`**：`active` 取风格指南、`query` 按标签查、`list` 列全部、`get` 取单张完整备注、`brief` 只取文字版风格描述、`import` 收录参考、`sources` 查看已配置来源、`workflow` 取工作流。
- **HTTP 接口**：`/moodboard/api/*` 供面板与程序化读取，图片按附件版本号缓存。

## 要求

DeepSeek Harness `>=0.2.1-rc.3 <0.3.0-0`，Web profile（桌面版或 Web 界面）

## 相关链接

- 英文说明（完整细节）：[README.md](./README.md)
- npm：<https://www.npmjs.com/package/dsh-moodboard>
- 更新记录：[CHANGELOG.md](./CHANGELOG.md)

<sub>同系列插件：[情绪板](https://github.com/Stijnus/dsh-moodboard) · [输入补全](https://github.com/Stijnus/dsh-composer-predictions) · [移动到工作区](https://github.com/Stijnus/dsh-move-to-workspace) · [工作区状态](https://github.com/Stijnus/dsh-workspace-status) · [提示词改写](https://github.com/Stijnus/dsh-prompt-optimizer)</sub>

<sub>⭐ 如果它帮你省了一步，点个 star 能让更多 DSH 用户发现它。</sub>
