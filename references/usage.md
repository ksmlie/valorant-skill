# 使用说明

## 自然语言问题

这个技能会把用户问题映射到正确的脚本：

- "今天有哪些比赛" -> `scripts/valorant-schedule.js`
- "某战队最近状态怎么样" -> `scripts/valorant-team.js`
- "某选手的资料和战绩" -> `scripts/valorant-player.js`
- "某场比赛谁赢了" -> `scripts/valorant-match.js`

## 通用流程

1. 判断用户是在问选手、战队、比赛还是赛程。
2. 规范化别名和关键词。
3. 调用匹配的脚本。
4. 返回带有清晰键名的结构化结果。

## 输出建议

尽量使用简洁的 JSON 风格分段：

- `query_type`
- `matched_script`
- `filters`
- `result`
- `source`

## 数据源策略

- 使用 `VLR.gg` 作为主要查询来源。
- 如果查询涉及选手数据，必须按照 `references/vlr-data-refresh.md` 的方法读取。
- 不再使用 `Liquipedia`。
- 如果查询涉及选手数据，必须遵循 `references/vlr-data-refresh.md` 中的读取方法。

## 兜底行为

- 如果实体有歧义，要求用户进一步说明。
- 如果没有精确匹配，返回 `not_found`。
- 如果查询超出 MVP 范围，说明限制并建议使用受支持的查询类型。
