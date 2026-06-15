# 战队

## 查询目标

回答关于《无畏契约》战队的问题，包括身份、别名、赛区和近期结果。

## 建议输出字段

- `team_id`
- `team_name`
- `short_name`
- `region`
- `aliases`
- `recent_matches`
- `recent_form`
- `summary`
- `vlr_url`
- `vlr_team_id`
- `current_roster`

## 示例问题

- 这个战队是谁
- 某战队最近状态怎么样
- 某战队有哪些别名
- 某战队最近赢了几场

## 匹配建议

- 先匹配标准名称。
- 再尝试别名和简称。
- 如果有多个战队都符合，要求用户进一步确认。
