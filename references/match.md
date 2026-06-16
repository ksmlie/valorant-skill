# 比赛

## 脚本

`node scripts/valorant-match.js`

## 查询目标

回答关于《无畏契约》职业比赛、赛事阶段与比赛结果的问题，数据仅使用 `VLR.gg` 真实页面。

## 数据关联规则

- `event_id` 对应 `events.json.id`
- `team_a.id` / `team_b.id` 对应 `teams.json.id`
- 如果比赛涉及选手，再继续关联 `players.json.id`
- 赛事查询必须先读取赛事总页，再汇总所有子页面链接
- 不得只依据单个子页面下最终结论
- 选手相关数据若涉及统计，必须遵循 `references/vlr-data-refresh.md`

## 命令

```bash
node scripts/valorant-match.js info <matchId>             # 比赛基本信息
node scripts/valorant-match.js maps <matchId>             # 地图与比分
node scripts/valorant-match.js h2h <matchId>              # 交手与近期战绩
node scripts/valorant-match.js detail <matchId>           # 比赛详细信息（逐图 10 名选手数据）
node scripts/valorant-match.js players summary <matchId>  # 所有地图汇总后的选手数据
node scripts/valorant-match.js map1 players <matchId>     # 第 1 张地图 10 名选手数据
node scripts/valorant-match.js map2 players <matchId>     # 第 2 张地图 10 名选手数据
node scripts/valorant-match.js map3 players <matchId>     # 第 3 张地图 10 名选手数据
node scripts/valorant-match.js map4 players <matchId>     # 第 4 张地图 10 名选手数据
node scripts/valorant-match.js map5 players <matchId>     # 第 5 张地图 10 名选手数据
```

## 建议输出字段

### `info` - 单场比赛

| 字段 | 类型 | 说明 |
|------|------|------|
| `match_id` | string \| number | 比赛 ID |
| `event_id` | string | 对应 `events.json.id` |
| `event_name` | string | 赛事名称 |
| `event_url` | string | 赛事 VLR 页面 URL |
| `stage` | string | 比赛阶段，如 `Swiss Stage`、`Playoffs` |
| `match_name` | string | 比赛标题，如 `A vs B` |
| `status` | string | 状态，如 `upcoming`、`live`、`finished` |
| `scheduled_at` | string | 赛前计划开赛时间 |
| `played_at` | string | 实际开赛或已结束时间 |
| `timezone` | string | 时区 |
| `format` | string | 赛制，如 `BO1`、`BO3`、`BO5` |
| `team_a` | object | 主队信息，对应 `teams.json.id` |
| `team_b` | object | 客队信息，对应 `teams.json.id` |
| `winner_team_id` | string \| null | 获胜队伍 ID |
| `winner_team_name` | string \| null | 获胜队伍名称 |
| `score` | string | 比分，如 `2-1` |
| `source` | object | 可追踪来源信息 |

### `maps` - 地图与比分

| 字段 | 类型 | 说明 |
|------|------|------|
| `match_id` | string \| number | 比赛 ID |
| `event_id` | string | 对应 `events.json.id` |
| `stage` | string | 比赛阶段 |
| `maps` | array | 地图数组 |
| `score` | string | 总比分 |
| `winner_team_id` | string \| null | 获胜队伍 ID |
| `source` | object | 可追踪来源信息 |

#### `maps[]` 建议字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `map_name` | string | 地图名 |
| `map_number` | number | 地图序号 |
| `team_a_score` | number | 主队比分 |
| `team_b_score` | number | 客队比分 |
| `winner_team_id` | string \| null | 该图获胜队伍 ID |
| `overtime` | boolean \| null | 是否加时 |
| `source` | object | 可追踪来源信息 |

### `h2h` - 队伍交手

| 字段 | 类型 | 说明 |
|------|------|------|
| `match_id` | string \| number | 比赛 ID |
| `event_id` | string | 对应 `events.json.id` |
| `event_name` | string | 赛事名称 |
| `stage` | string | 比赛阶段 |
| `teams` | array | 双方队伍信息 |
| `winner_team_id` | string \| null | 获胜队伍 ID |
| `winner_team_name` | string \| null | 获胜队伍名称 |
| `score` | string | 比分 |
| `played_at` | string | 比赛时间 |
| `source` | object | 可追踪来源信息 |

### `detail` - 比赛详细信息

用于返回一场比赛的逐图选手数据，适合需要查看每张地图双方 5+5 名选手表现的场景。

| 字段 | 类型 | 说明 |
|------|------|------|
| `match_id` | string \| number | 比赛 ID |
| `event_id` | string | 对应 `events.json.id` |
| `event_name` | string | 赛事名称 |
| `stage` | string | 比赛阶段 |
| `maps` | array | 地图列表 |
| `score` | string | 总比分 |
| `winner_team_id` | string \| null | 获胜队伍 ID |
| `source` | object | 可追踪来源信息 |

#### `maps[]` 建议字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `map_name` | string | 地图名 |
| `map_number` | number | 地图序号 |
| `team_a` | object | 主队 5 名选手数据 |
| `team_b` | object | 客队 5 名选手数据 |
| `source` | object | 可追踪来源信息 |

#### `team_a` / `team_b` 建议字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `team_id` | string | 队伍 ID，对应 `teams.json.id` |
| `team_name` | string | 队伍名称 |
| `players` | array | 该队在该图的 5 名选手数据，顺序建议与比赛阵容一致 |
| `team_summary` | object | 该图团队汇总信息，可选 |

#### `players[]` 建议字段

字段尽量与 `players.json` 保持一致，并补充本场比赛单图统计：

| 字段 | 类型 | 说明 |
|------|------|------|
| `player_id` | string | 对应 `players.json.id` |
| `player_name` | string | 选手名称 |
| `team_id` | string | 队伍 ID |
| `team_name` | string | 队伍名称 |
| `vlr_player_id` | number \| null | VLR 选手 ID |
| `agent` | string \| null | 本图使用特工 |
| `rating` | number \| null | 本图 Rating |
| `acs` | number \| null | 本图 ACS |
| `k_d` | number \| null | 本图 K/D |
| `adr` | number \| null | 本图 ADR |
| `kast` | string \| null | 本图 KAST |
| `kpr` | number \| null | 本图 KPR |
| `apr` | number \| null | 本图 APR |
| `fkpr` | number \| null | 本图 FKPR |
| `fdpr` | number \| null | 本图 FDPR |
| `kills` | number \| null | 击杀 |
| `deaths` | number \| null | 死亡 |
| `assists` | number \| null | 助攻 |
| `fk` | number \| null | 首杀 |
| `fd` | number \| null | 首死 |
| `source` | object | 可追踪来源信息 |

#### 输出分隔建议

- 每张地图按 `team_a` / `team_b` 分组输出，并在两队之间使用明显分隔
- 每队固定 5 名选手，若阵容不足可使用 `null` 占位或明确标注 `bench` / `unknown`
- 字段优先参考 `players.json`，如无单图数据则保持同名结构并填 `null`

### `players summary` - 选手汇总数据

用于返回一场比赛中每位选手跨所有地图的汇总表现，按队伍结构化输出。

| 字段 | 类型 | 说明 |
|------|------|------|
| `match_id` | string \| number | 比赛 ID |
| `event_id` | string | 对应 `events.json.id` |
| `event_name` | string | 赛事名称 |
| `stage` | string | 比赛阶段 |
| `score` | string | 总比分 |
| `winner_team_id` | string \| null | 获胜队伍 ID |
| `total_rounds` | number \| null | 所有已解析地图总回合数 |
| `team_a` | object | 主队汇总数据 |
| `separator` | string | 分隔标识 |
| `team_b` | object | 客队汇总数据 |
| `source` | object | 可追踪来源信息 |

#### `team_a` / `team_b` 建议字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `team_id` | string | 队伍 ID |
| `team_name` | string | 队伍名称 |
| `players` | array | 该队 5 名选手的汇总数据 |
| `team_summary` | object | 该队汇总统计 |

#### `players[]` 建议字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `player_id` | string | 对应 `players.json.id` |
| `player_name` | string | 选手名称 |
| `team_id` | string | 队伍 ID |
| `team_name` | string | 队伍名称 |
| `maps_played` | number | 出场地图数 |
| `agents` | array | 所有地图使用过的特工去重集合 |
| `rating` | number \| null | 平均 Rating |
| `acs` | number \| null | 平均 ACS |
| `k_d` | number \| null | 汇总 K/D |
| `adr` | number \| null | 平均 ADR |
| `kast` | string \| null | 平均 KAST |
| `kpr` | number \| null | 汇总 KPR |
| `apr` | number \| null | 汇总 APR |
| `fkpr` | number \| null | 汇总 FKPR |
| `fdpr` | number \| null | 汇总 FDPR |
| `kills` | number \| null | 总击杀 |
| `deaths` | number \| null | 总死亡 |
| `assists` | number \| null | 总助攻 |
| `fk` | number \| null | 总首杀 |
| `fd` | number \| null | 总首死 |
| `hs_percent` | string \| null | 平均爆头率 |
| `plus_minus` | number \| null | 总正负值 |
| `source` | object | 可追踪来源信息 |

### `map1/2/3/4/5 players` - 单图选手数据

用于按地图序号返回某一张地图的 10 名选手数据，输出结构与 `detail.maps[n]` 对应；如果该场比赛不存在对应地图，则 `map` 返回 `null`。

| 字段 | 类型 | 说明 |
|------|------|------|
| `match_id` | string \| number | 比赛 ID |
| `event_id` | string | 对应 `events.json.id` |
| `event_name` | string | 赛事名称 |
| `stage` | string | 比赛阶段 |
| `score` | string | 总比分 |
| `winner_team_id` | string \| null | 获胜队伍 ID |
| `requested_map` | number | 请求的地图序号 |
| `found` | boolean | 是否找到该地图 |
| `map` | object \| null | 单图详细数据 |
| `source` | object | 可追踪来源信息 |

## 查询类型

### 1. 单场比赛结果

回答某场比赛谁赢了、比分是多少、什么时候打的。

### 2. 赛事汇总

回答某个赛事有哪些队伍、有哪些阶段、最终排名如何。

### 3. 队伍交手

回答某两支队伍的历史交手结果。

## 单场比赛匹配建议

- 优先使用明确的战队名、赛事名、阶段名或日期。
- 如果存在多场相近比赛，返回最接近的一场并附带 `confidence`。
- 如果无法精确匹配，返回结构化 `not_found`。

## 赛事汇总规则

1. 先读取赛事总页，确认赛事基本信息。
2. 查找总页中的所有可用子页面链接，例如 `swiss-stage`、`playoffs`、`group-stage`。
3. 逐个读取每个子页面，汇总其中展示的队伍、阶段、排名或其他可见信息。
4. 对于已经结束的赛事：
   - 合并所有子页面结果后再统计参赛队伍。
   - 子页面中的排名标号视为最终排名信息。
5. 对于未开始或进行中的赛事：
   - 只汇总所有子页面合并后的参赛队伍集合。
   - 未确认名次可留空。
6. 任何情况下都不要只根据单个子页面做完整汇总。

## 返回建议

- 优先使用稳定的结构化 JSON 风格
- 使用标准 `id`、别名和 `source` 字段
- 找不到精确结果时返回 `not_found`
- 字段尽量保持稳定，不做无谓扩张
