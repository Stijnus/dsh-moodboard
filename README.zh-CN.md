# dsh-moodboard · 视觉参考情绪板

[English](./README.md) · [中文](./README.zh-CN.md)

给智能体一份**视觉参考**：把截图和灵感图收进情绪板，打标签、写备注，固定出风格指南——智能体在生成或改版界面之前会先读这份指南。

## 快速开始

```sh
dsh plugin --profile web add dsh-moodboard
```

重启 Harness（或刷新 Web 界面）。侧边栏会出现 **Moodboard** 入口。

## 功能

- **拖拽上传**截图，自动归一化为可直接引用的图片资源。
- **标签、备注、来源链接**：每条参考都能写清楚「为什么用它」。
- **固定（pinned）风格指南**：只把定义产品视觉语言的那几张交给智能体。
- **图库过滤与搜索**，以及带元数据的检查器面板。
- **自动同步**：智能体通过 HTTP 接口新增、修改或删除参考后，面板会在几秒内自动更新，无需刷新页面或重启桌面应用。
- **智能体工具 `moodboard`**：`active` 取风格指南、`query` 按标签查、`list` 列全部、`get` 取单张完整备注、`brief` 只取文字版风格描述。
- **HTTP 接口**：`/moodboard/api/*` 供面板与程序化读取，图片按附件版本号缓存。

## 要求

DeepSeek Harness `>=0.2.1-rc.3 <0.3.0-0`，Web profile（桌面版或 Web 界面）

## 相关链接

- 英文说明（完整细节）：[README.md](./README.md)
- npm：<https://www.npmjs.com/package/dsh-moodboard>
- 更新记录：[CHANGELOG.md](./CHANGELOG.md)

<sub>同系列插件：[情绪板](https://github.com/Stijnus/dsh-moodboard) · [输入补全](https://github.com/Stijnus/dsh-composer-predictions) · [移动到工作区](https://github.com/Stijnus/dsh-move-to-workspace) · [工作区状态](https://github.com/Stijnus/dsh-workspace-status) · [提示词改写](https://github.com/Stijnus/dsh-prompt-optimizer)</sub>

<sub>⭐ 如果它帮你省了一步，点个 star 能让更多 DSH 用户发现它。</sub>
