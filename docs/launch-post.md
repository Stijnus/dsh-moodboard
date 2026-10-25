# Launch post — dsh-moodboard

## Title (EN)
Moodboard: give your coding agent your visual references before it designs UI

## Title (ZH)
情绪板：在智能体动手设计界面之前，先给它一份视觉参考

## Body (EN)

Every agent-built UI problem starts the same way: the agent has never seen the
app you are designing for. It guesses the palette, the radius, the density, and
you spend the next three turns correcting it in prose.

**Moodboard** gives it something to look at. Drop screenshots into a panel, tag
and annotate them, pin the handful that define your visual language — and the
agent reads that pinned set *before* it writes UI.

- **Collect** — drag in screenshots and inspiration; each becomes a normalized,
  reusable reference image with tags, notes and a source URL.
- **Pin a style guide** — pinned references are "active"; unpinned ones are just
  gallery. The agent gets the pinned set, so your intent stays explicit.
- **Agent tool `moodboard`** — `active` returns the style guide *with the images*,
  `query` filters by tag, `list` gives ids and metadata, `get` returns one
  reference with full notes, `brief` returns text only.
- **HTTP API** — `/moodboard/api/*` for the panel and for scripted reads; image
  bytes are served per attachment revision.

Install:

```sh
dsh plugin --profile web add dsh-moodboard
```

Requires DeepSeek Harness `>=0.2.1-rc.3 <0.3.0-0` on the Web profile (desktop app
or web UI). MIT, published to npm with SLSA provenance.

**Limits, honestly:** there is no semantic search or OCR — you organize with tags
and notes, and the agent reads what you pinned. Image blocks are capped per tool
call, so a large board is meant to be filtered, not dumped.

Repo: https://github.com/Stijnus/dsh-moodboard · npm:
https://www.npmjs.com/package/dsh-moodboard

## Body (ZH)

用智能体做界面的问题通常一样：它从没见过你在做的那个应用。它会猜配色、圆角、
疏密，然后你花三轮对话用文字把它纠回来。

**情绪板**给它一份可以「看」的东西：把截图拖进面板、打标签写备注、固定真正定义
视觉语言的那几张——智能体在写界面之前会先读这份固定清单。

- **收集**：拖入截图与灵感图，自动成为可复用的参考图，带标签、备注和来源链接。
- **固定风格指南**：被固定的参考才是「生效」的，其余只是图库；交给智能体的是你
  明确指定的那一组。
- **智能体工具 `moodboard`**：`active` 连图一起返回风格指南，`query` 按标签查，
  `list` 列出 id 与元数据，`get` 取单张完整备注，`brief` 只给文字版描述。
- **HTTP 接口**：`/moodboard/api/*` 供面板与脚本读取；图片按附件版本号提供。

安装：

```sh
dsh plugin --profile web add dsh-moodboard
```

要求 DeepSeek Harness `>=0.2.1-rc.3 <0.3.0-0`，Web profile（桌面版或 Web 界面）。
MIT 许可，npm 发布并带 SLSA provenance。

**老实说限制：** 没有语义搜索、没有 OCR——靠标签和备注组织，智能体读的是你固定的
那些。单次工具调用的图片数量有上限，大图库适合先筛选再给。

## Short version (X / 微博)

EN: Your agent has never seen the app you're building. Moodboard lets you drop in
screenshots, pin a style guide, and have the agent read it before writing UI.
`dsh plugin --profile web add dsh-moodboard` · https://github.com/Stijnus/dsh-moodboard

ZH: 智能体没见过你在做的应用。情绪板让你拖入截图、固定风格指南，让它在写界面前
先读一遍。`dsh plugin --profile web add dsh-moodboard` · https://github.com/Stijnus/dsh-moodboard
