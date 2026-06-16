# 赛程数据

## 脚本：`scripts/valorant-schedule.js`

用于查询 VCT / VLR 赛事赛程，支持列出某赛事全部赛程、按时间筛选、按阶段筛选，以及统计比赛状态。

## 命令

### 列出赛事全部赛程

```bash
node scripts/valorant-schedule.js event masters-toronto-2026  # 列出指定赛事的全部赛程；按时间排序输出
node scripts/valorant-schedule.js event vct-cn-stage2-2026     # 列出 VCT CN Stage 2 2026 的全部赛程
```

说明：返回指定赛事下的全部比赛，按开赛时间排序。

### 按时间筛选比赛

```bash
node scripts/valorant-schedule.js time today        # 查询今天的比赛；使用本地日期作为基准
node scripts/valorant-schedule.js time tomorrow     # 查询明天的比赛；返回对应日期的赛程
node scripts/valorant-schedule.js time 2026-06-16   # 查询指定日期的比赛；使用完整日期格式
node scripts/valorant-schedule.js time 06-16        # 查询指定月日的比赛；自动补全年份
```

说明：
- 支持 `today`、`tomorrow`、完整日期 `YYYY-MM-DD`、短日期 `MM-DD`
- 如果对应时间没有比赛，直接返回 `null`

### 按阶段筛选比赛

```bash
node scripts/valorant-schedule.js stage swiss-stage    # 查询 Swiss Stage 阶段比赛；阶段名建议使用 slug
node scripts/valorant-schedule.js stage playoff        # 查询 Playoff 阶段比赛；支持阶段 slug 搜索
node scripts/valorant-schedule.js stage group-stage    # 查询 Group Stage 阶段比赛；按阶段过滤结果
```

说明：返回指定阶段下的比赛列表，阶段值建议使用标准 slug。

### 比赛状态统计

```bash
node scripts/valorant-schedule.js stats  # 统计当前赛程状态分布；输出各状态数量
```

说明：统计当前赛程中的比赛状态，例如：
- `upcoming`
- `live`
- `finished`
- `postponed`
- `unknown`

## 建议输出字段

| 字段 | 类型 | 说明 |
|------|------|------|
| event | object | 赛事信息 |
| event.id | string | 赛事唯一标识 |
| event.name | string | 赛事名称 |
| date | string | 比赛日期 `YYYY-MM-DD` |
| time | string | 开赛时间 |
| datetime | string | 完整开赛时间，建议 ISO 8601 |
| stage | string | 比赛阶段，如 `swiss-stage`、`playoff` |
| status | string | 比赛状态，如 `upcoming`、`live`、`finished` |
| match_id | string | 比赛唯一标识 |
| team_a | object | 队伍 A 信息 |
| team_b | object | 队伍 B 信息 |
| bo | string/number | 赛制，如 `bo3` |
| match_count | number | 返回比赛数量 |
| matches | array | 比赛列表 |

## 推荐返回规则

### 1. 列赛事赛程

- 传入 `event <event-id>` 时，返回该赛事全部赛程
- 按 `datetime` 正序排序
- 返回 `match_count`

### 2. 按时间查比赛

- 先规范化时间关键词：`today`、`tomorrow`、`YYYY-MM-DD`、`MM-DD`
- 如果没有任何比赛，返回 `null`
- 如果有比赛，返回该时间下的完整列表

### 3. 按阶段查比赛

- 支持 `stage <stage-slug>`
- 例如：`swiss-stage`、`playoff`
- 阶段匹配建议大小写不敏感，并对空格/中划线做规范化

### 4. 状态统计

- `stats` 返回各状态数量汇总
- 推荐包含总场次、各状态计数，以及可选的状态明细

## 示例问题

- 这个赛事的赛程是什么
- 今天有哪些比赛
- 2026-06-16 有哪些比赛
- 6 月 16 日有比赛吗
- swiss-stage 有哪些比赛
- playoff 有哪些比赛
- 现在有几场 live
- 当前赛程状态统计

## 匹配建议

- 优先识别赛事 ID，再识别时间 / 阶段 / 状态请求。
- 时间结果按开赛时间排序。
- 阶段统一规范为 slug，例如 `Swiss Stage` -> `swiss-stage`。
- 若按时间查询无结果，返回 `null`，不要返回空数组说明文本。
- `stats` 应基于当前已加载赛程计算，不额外修改原始比赛列表。
