# 概览

这个技能是一个《无畏契约》职业赛事查询技能。

## 目标

- 以结构化、稳定的输出回答用户问题。
- 支持四类 MVP 查询：
  - 选手信息与战绩
  - 战队信息与战绩
  - 比赛结果
  - 赛程查询
- 保持结构便于后续扩展更多数据源。

## 设计原则

- 先查询，后分析。
- 优先使用精确匹配和确定性的兜底逻辑。
- 统一规范战队与选手别名。
- 返回可被 AI 系统可靠解析的结构化数据。

## 推荐响应结构

- `query_type`
- `matched_script`
- `normalized_query`
- `filters`
- `result`
- `source`
- `notes`

## 脚本

- `scripts/valorant-teams.js`
- `scripts/valorant-schedule.js`
- `scripts/valorant-match.js`
- `scripts/valorant-team.js`
- `scripts/valorant-player.js`

## 静态数据

- `data/teams.json`
- `data/events.json`

## 数据源策略

- 主要来源：`VLR.gg`
- 选手数据读取必须遵循 `references/vlr-data-refresh.md`
- 不再使用其他外部数据源

## 后续扩展

后续版本可以增加选手、比赛和赛事数据集，以及更丰富的排名和历史趋势逻辑。

## 赛事汇总规则

- 对已结束赛事，`Swiss Stage` / `Group Stage` / `Playoffs` 页面中的名次可视为最终排名信息的一部分。
- 对未开始或进行中的赛事，只汇总所有子页面的参赛队伍，不依赖排名。
