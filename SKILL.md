# Valorant 职业赛事实况查询技能

## 目标

这个技能用于回答关于《无畏契约》职业赛事的自然语言问题，当前稳定支持四类核心查询：

1. 选手信息与战绩
2. 战队信息与战绩
3. 比赛结果
4. 赛程查询

这个技能以“查询型”为核心设计目标：将用户问题映射到最合适的脚本，返回结构化结果，并保持易扩展。

## 数据源策略

- 主要数据源：`VLR.gg`
- 选手数据、比赛结果、战队阵容和赛程记录优先使用 `VLR.gg`
- 只使用 `VLR.gg` 的真实页面数据，不再采用其他外部数据源
- 如果查询涉及选手数据，必须遵循 `references/vlr-data-refresh.md` 的读取规则

## 查询优先级

- 优先做直接事实查询，不做过度解读。
- 如果一个问题同时符合多种查询类型，优先选择最具体的脚本。
- 如果用户问题比较宽泛，返回简洁、结构化的摘要；只有在必要时才建议缩小范围。
- 保持 MVP 输出简单、可靠、便于机器解析。

## 核心路由

- 战队列表与战队概览 -> `scripts/valorant-teams.js`
- 赛程与今日/未来比赛 -> `scripts/valorant-schedule.js`
- 比赛结果与交手记录 -> `scripts/valorant-match.js`
- 战队详情与近期状态 -> `scripts/valorant-team.js`
- 选手详情与近期结果 -> `scripts/valorant-player.js`

## 输出格式

返回结果时建议使用结构化块，并保持清晰的键名，方便下游 AI 解析。

推荐顶层结构：

- `query_type`
- `matched_script`
- `normalized_query`
- `filters`
- `result`
- `source`
- `notes`

## 参考文档

- `references/overview.md`
- `references/usage.md`
- `references/workflows.md`
- `references/teams.md`
- `references/schedule.md`
- `references/match.md`
- `references/team.md`
- `references/player.md`

## MVP 范围

支持的示例问题：

- 今天有哪些比赛
- 某战队最近状态怎么样
- 某选手的资料和战绩
- 某场比赛谁赢了
- 某战队的赛程
- 某战队有哪些选手
- 某选手最近几场表现

## 数据设计

- `data/teams.json` 存储静态战队身份与别名
- `data/events.json` 存储赛事身份与战队参赛映射
- 后续如有需要，可以再增加选手、比赛和赛程相关的 JSON 文件
- 脚本应先基于静态数据工作，再逐步叠加实时或更新后的数据源

## 实现说明

- 保持脚本小而可组合。
- 尽早完成战队和选手别名归一化。
- 优先使用确定性匹配和明确的兜底逻辑。
- 当找不到精确匹配时，返回结构化的 `not_found` 结果，不要猜测。
