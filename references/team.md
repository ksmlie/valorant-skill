# 战队详情

## 脚本：`scripts/valorant-team.js`

## 命令

```bash
node scripts/valorant-team.js <teamKeyword>                     # 通过关键词查询战队；用于按名称或别名搜索
node scripts/valorant-team.js <vlrTeamId>                       # 通过 VLR 战队 ID 查询；直接定位到战队页面
node scripts/valorant-team.js <vlrTeamUrl>                      # 通过 VLR 战队链接查询；最精确的输入方式
node scripts/valorant-team.js https://www.vlr.gg/team/2593/fnatic # 示例：VLR URL；直接打开战队链接
```

支持三种输入：

- 战队关键词：如 `Sentinels`、`TL`、`LEV`
- VLR 战队 ID：如 `2`
- VLR 战队链接：如 `https://www.vlr.gg/team/2/sentinels`

当前脚本已经改成 **VLR 优先、静态数据兜底** 的模式。

查询顺序现在是：

1. 先尝试从 `VLR.gg` 抓取战队页数据
2. 如果抓取失败或无法定位，再回退到本地静态数据：
   - `data/teams.json`
   - `data/players.json`
3. 如果 VLR 和本地静态数据都找不到，则返回 `null`

同时，当：

- VLR 抓到了数据
- 本地静态数据也有对应战队

脚本会自动做一次字段比对：

- 相同字段：正常返回
- 不同字段：**优先返回 VLR 抓到的数据**
- 并额外给出“不一致提示字段”，方便上层知道静态数据已过期或存在偏差

## 调用示例

```bash
node scripts/valorant-team.js FNATIC                               # 通过战队关键词查询

node scripts/valorant-team.js 2593                                 # 通过 VLR 战队 ID 查询

node scripts/valorant-team.js https://www.vlr.gg/team/2593/fnatic  # 通过 VLR 战队 URL 查询
```

- 依次表示：关键词、VLR 战队 ID、VLR 战队 URL

## 查询优先级

### 1. 直接传 VLR 战队链接

这是最直接的方式：

```bash
node scripts/valorant-team.js https://www.vlr.gg/team/2/sentinels
```

### 2. 直接传 VLR team id

```bash
node scripts/valorant-team.js 2
```

脚本会自动拼成：

```text
https://www.vlr.gg/team/2
```

并跟随跳转到正式页面。

### 3. 传普通战队关键词

```bash
node scripts/valorant-team.js Sentinels
node scripts/valorant-team.js SEN
node scripts/valorant-team.js "Team Liquid"
```

脚本会先尝试：

- 使用 VLR 搜索页定位战队
- 如果搜索失败，再尝试本地静态数据匹配

## 当前能力

当前脚本已经能直接从 VLR 战队页提取这些信息：

- `id`
- `name`
- `short_name`
- `region`
- `country`
- `vlr_url`
- `vlr_team_id`
- `website_url`
- `social_url`
- `roster`
- `recent_results`
- `recent_form`
- `stats`

同时也会结合本地静态数据：

- 作为 VLR 抓取失败时的兜底
- 作为与 VLR 数据的对照源
- 保留本地 `id / aliases / current_roster` 等结构化配置能力

## 返回原则

### 情况 1：VLR 抓到了，本地也有，而且字段一致

返回：

- 直接使用 VLR 结果
- `consistency.status = "matched"`
- 不额外提示冲突

### 情况 2：VLR 抓到了，本地也有，但字段不一致

返回：

- 仍然优先使用 VLR 数据
- `consistency.status = "mismatch"`
- `consistency.mismatch_fields` 列出不一致字段
- `result.consistency_notice = "vlr_data_differs_from_local_static_data"`
- `notes` 中包含 `vlr_static_data_mismatch`

### 情况 3：VLR 抓不到，但本地静态数据有

返回：

- 使用本地静态数据兜底
- `consistency.status = "static_only"`
- `result.consistency_notice = "vlr_unavailable_used_static_fallback"`
- `notes` 中包含 `static_fallback_used`

### 情况 4：VLR 和本地都没有

返回：

- `result.team = null`
- `result.status = "not_found"`
- `notes` 中包含 `team_not_found`

## 返回结构概览

输出顶层结构：

- `query_type`
- `matched_script`
- `normalized_query`
- `filters`
- `result`
- `source`
- `notes`

## `result` 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| found | boolean | 是否找到战队 |
| matched_count | number | VLR / 本地匹配到的数量摘要 |
| status | string | `resolved` / `not_found` / `error` |
| team | object \| null | 最终返回的战队对象 |
| recent_results | array | 最近比赛结果 |
| recent_form | object \| null | 最近状态摘要 |
| stats | object \| null | 当前抓到的战队统计摘要 |
| consistency_notice | string \| null | 数据一致性提示 |

## `team` 结构说明

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string \| null | 战队内部 ID；若本地有则优先保留本地稳定 ID |
| name | string \| null | 战队标准名称，优先取 VLR |
| short_name | string \| null | 战队简称 |
| aliases | array | 别名合集，合并 VLR 与本地别名 |
| status | string \| null | 状态，通常为 `active` |
| region | string \| null | 所属赛区 |
| country | string \| null | VLR 页面上的国家/地区 |
| vlr_url | string \| null | VLR 战队页链接 |
| vlr_team_id | number \| null | VLR 战队 ID |
| website_url | string \| null | 战队官网 |
| social_url | string \| null | 战队社媒链接 |
| current_roster | array | 当前阵容摘要；优先取 VLR 页面阵容名 |
| roster | array | 阵容详情 |
| stats | object \| null | 当前战队统计摘要 |
| recent_results | array | 近期比赛 |
| recent_form | object \| null | 近 5 场状态 |
| resolution_source | string | `vlr_primary` / `static_fallback` |
| consistency | object | 与静态数据的比对结果 |
| static_snapshot | object \| null | 本地静态数据快照，便于对比 |

## `consistency` 字段说明

这是这次更新里最关键的提示结构。

| 字段 | 类型 | 说明 |
|------|------|------|
| status | string | `matched` / `mismatch` / `static_only` / `vlr_only` |
| mismatch_fields | array | 不一致字段清单 |

### `mismatch_fields[]` 结构

| 字段 | 类型 | 说明 |
|------|------|------|
| field | string | 不一致字段名 |
| vlr_value | any | VLR 抓取到的值 |
| static_value | any | 本地静态值 |

这意味着如果你问：

- `Sentinels 的阵容`
- `TL 的 short_name`
- `某战队当前 region`

只要 VLR 和本地配置不同，最终仍返回 VLR 值，但你可以通过：

- `result.team.consistency.status`
- `result.team.consistency.mismatch_fields`
- `result.consistency_notice`
- `notes`

知道这次返回其实和静态数据不一致。

## `id` / `info` / `stats` 的建议读取方式

### 1. 查战队 id

优先看：

- `result.team.id`
- `result.team.vlr_team_id`
- `result.team.vlr_url`

其中：

- `id` 更适合技能内部使用
- `vlr_team_id` 更适合和 VLR 页面做对应
- `vlr_url` 是最终外部页面标识

### 2. 查战队 info

优先看：

- `result.team.name`
- `result.team.short_name`
- `result.team.region`
- `result.team.country`
- `result.team.aliases`
- `result.team.status`
- `result.team.vlr_team_id`
- `result.team.vlr_url`
- `result.team.website_url`
- `result.team.social_url`

### 3. 查战队 roster

优先看：

- `result.team.roster`
- `result.team.current_roster`

说明：

- 如果 VLR 可用，`roster` 优先取 VLR 页面实时阵容
- 如果只能走静态兜底，则 `roster` 来自 `players.json` 的本地关联

### 4. 查战队 stats

优先看：

- `result.stats`
- `result.team.stats`

当前已支持的 `stats` 摘要主要来自 VLR 页面上的可见信息，例如：

- `current_rank`
- `rating`
- `record`
- `wins`
- `losses`

这不是完整地图池统计，但已经比原先纯占位结构更接近真实战队状态。

## `recent_results` / `recent_form` 说明

当前脚本已经会从 VLR 战队页抓取一部分近期结果：

- `result.recent_results`
- `result.recent_form`

其中：

- `recent_results` 取自页面上的 `Recent Results`
- `recent_form` 是基于最近若干条比分做的轻量总结

如果 VLR 不可用且只能走静态兜底：

- `recent_results = []`
- `recent_form = null`

## `source` 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| type | string | `vlr_with_static_compare` / `static_json` / `none` / `error` |
| resolve_mode | string | 本次查询的定位方式 |
| vlr_available | boolean | 是否成功拿到 VLR 数据 |
| static_available | boolean | 是否有本地静态数据 |
| vlr_error | string \| null | VLR 抓取失败时的错误信息 |
| matched_vlr_candidates | array \| null | VLR 搜索候选项 |
| file | string | 本地静态数据文件说明 |
| team_version | string \| null | `teams.json` 版本 |
| player_version | string \| null | `players.json` 版本 |
| updated_at | string \| null | 本地数据更新时间 |

## `resolve_mode` 常见值

- `direct_url`：直接传了 VLR 战队链接
- `direct_id`：直接传了 VLR 数字 team id
- `search_query`：通过 VLR 搜索页定位
- `local_index_vlr_url`：先由本地静态数据找到对应 VLR URL，再抓 VLR
- `vlr_fetch_failed`：VLR 直连抓取失败
- `vlr_search_failed`：VLR 搜索失败
- `search_not_found`：VLR 搜索无结果
- `empty`：输入为空
- `runtime_error`：脚本执行异常

## 典型问法与字段映射

### 1. 问战队 id

用户问题：

- `Sentinels 的 id 是什么？`
- `TL 的 vlr team id 是多少？`

重点字段：

- `result.team.id`
- `result.team.vlr_team_id`
- `result.team.vlr_url`

### 2. 问战队资料

用户问题：

- `G2 是哪个赛区？`
- `LEV 全名是什么？`
- `FNATIC 的资料`

重点字段：

- `result.team.name`
- `result.team.short_name`
- `result.team.region`
- `result.team.country`
- `result.team.aliases`
- `result.team.status`

### 3. 问战队阵容

用户问题：

- `SEN 现在阵容是谁？`
- `Team Liquid roster`

重点字段：

- `result.team.roster`
- `result.team.current_roster`
- `result.team.consistency`

### 4. 问战队 stats

用户问题：

- `Sentinels stats`
- `TL 数据怎么样？`

重点字段：

- `result.stats`
- `result.team.stats`
- `result.recent_form`
- `result.team.consistency`

## 注意事项

- VLR 是优先数据源，静态数据只作为兜底和对照。
- 如果 VLR 与本地静态数据不一致，最终默认相信 VLR，但必须保留不一致提示。
- 某些字段在 VLR 页面上可能并不总是稳定存在，缺失时允许返回 `null`。
- 如果 VLR 页面结构发生变化，`vlr_error` 或字段缺失概率会上升；这时本地静态数据仍可作为保底。
- `current_roster` 在 VLR 路径下更偏“页面实时阵容摘要”，在静态路径下更偏“本地配置中的选手 ID 列表”，上层使用时要注意语义差异。