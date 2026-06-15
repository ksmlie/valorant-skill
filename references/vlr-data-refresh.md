# VLR 数据刷新与准确查询指南

本文档总结了当前 skill 在 `VLR.gg` 上查询队伍、选手与统计数据的可靠方法，用于在静态数据过期后快速重新获取最新数据。

## 核心原则

- 只写入 `VLR.gg` 页面上**真实可见**的数据。
- 禁止猜测、补全、推断页面未明确给出的值。
- 如果某个字段当前页面无法稳定确认，宁可留空，也不要乱填。
- 统计数据优先使用**固定 timespan**，当前建议统一使用 `90d`。
- 选手统计按**每个英雄一行**保存；若抓取文本中缺失英雄名，可先将 `agent` 留空。

## 当前数据文件约定

### `data/teams.json`

- 顶层按四大赛区分组：
  - `AMERICAS`
  - `EMEA`
  - `PACIFIC`
  - `CHINA`
- 每支队伍包含：
  - `id`
  - `name`
  - `short_name`
  - `region`
  - `aliases`
  - `status`
  - `vlr_url`
  - `vlr_team_id`
  - `current_roster`
- `current_roster` 应存放**真实选手 id 列表**。

### `data/players.json`

每名选手包含：

- `id`
- `name`
- `short_name`
- `aliases`
- `nationality`
- `age`
- `team_id`
- `team_name`
- `region`
- `vlr_url`
- `vlr_player_id`
- `status`
- `stats`

当前 `stats` 结构：

- `timespan`: 建议固定为 `90d`
- `by_agent`: 英雄维度统计数组

每个 `by_agent` 元素当前使用：

- `agent`
- `use`
- `rnd`
- `rating`
- `acs`
- `k_d`
- `adr`
- `kast`
- `kpr`
- `apr`
- `fkpr`
- `fdpr`
- `kills`
- `deaths`
- `assists`
- `fk`
- `fd`

## 一、查询战队当前阵容

### 页面格式

队伍主页：

```text
https://www.vlr.gg/team/<team_id>/<team-slug>
```

例如：

```text
https://www.vlr.gg/team/13581/xi-lai-gaming
```

### 正确读取方法

进入队伍主页后，只读取页面中 `Current Roster` 区块的 `players` 列表。

例如 `Xi Lai Gaming` 页可直接读取到：

- `WsLeo`
- `Lysoar`
- `NoMan`
- `Rarga`
- `happywei`

同时通常可以直接读到：

- 选手显示名
- 真实姓名
- 选手页链接
- 选手 id

### 写入规则

1. 先更新 `teams.json` 中该队的 `current_roster`
2. 再逐个进入 player 页补 `players.json`
3. `current_roster` 只写选手 `id`，不要写整块冗余对象

## 二、查询选手基础信息

### 页面格式

选手主页：

```text
https://www.vlr.gg/player/<player_id>/<player-slug>
```

例如：

```text
https://www.vlr.gg/player/37927/happywei
```

### 正确读取字段

从选手页顶部只读取页面明确展示的信息，例如：

- 选手名
- 真实姓名
- 国籍
- 当前队伍
- 选手页 URL
- `vlr_player_id`

### 注意事项

- `age` 若页面没有明确显示，则写 `null`
- `status` 只有在当前仍在队伍页 `Current Roster` 中时写 `active`
- `aliases` 可用：
  - 页面昵称
  - 英文真实名
  - 中文名（若页面显示）

## 三、查询选手 90 天统计

### 推荐页面

统一使用：

```text
https://www.vlr.gg/player/<player_id>/<player-slug>/?timespan=90d
```

例如：

```text
https://www.vlr.gg/player/37927/happywei/?timespan=90d
```

### 关键原则

- 只读取该页面 `Agents` 统计区块
- 该区块是**逐英雄分行**数据
- 当前抓取文本可能拿不到英雄名；此时 `agent` 留空字符串 `""`
- 不要把某一行英雄数据误当成整名选手总数据

### 当前可稳定读取的列

统计区列顺序通常为：

- `Use`
- `RND`
- `Rating`
- `ACS`
- `K:D`
- `ADR`
- `KAST`
- `KPR`
- `APR`
- `FKPR`
- `FDPR`
- `K`
- `D`
- `A`
- `FK`
- `FD`

### 正确写法

每一行统计写成 `by_agent` 中一个对象，例如：

```json
{
  "agent": "",
  "use": "(27) 64%",
  "rnd": 583,
  "rating": 1.19,
  "acs": 235.4,
  "k_d": 1.23,
  "adr": 161.3,
  "kast": "76%",
  "kpr": 0.83,
  "apr": 0.28,
  "fkpr": 0.11,
  "fdpr": 0.09,
  "kills": 482,
  "deaths": 393,
  "assists": 161,
  "fk": 64,
  "fd": 51
}
```

## 四、哪些字段不要乱填

以下字段如果页面没有明确给出，就不要猜：

- `age`
- `matches_played`
- `maps_played`
- `wins`
- `losses`
- 英雄名（如果当前抓取文本没有）

如果后续需要这些字段，应该：

- 单独设计一套聚合逻辑
- 或改用能稳定提供这些字段的页面/接口

## 五、赛事刷新规则

### 刷新单支队伍

1. 打开队伍主页
2. 读取 `Current Roster`
3. 更新 `teams.json` 中该队 `current_roster`
4. 逐个打开选手主页
5. 读取选手基础信息
6. 打开 `?timespan=90d` 页面
7. 将 `Agents` 区块逐行写入 `players.json`

### 刷新整个赛区

1. 先从 `teams.json` 中定位赛区
2. 逐队进入 `vlr_url`
3. 按上面的单队刷新流程执行
4. 最后检查是否有队员变动、转会或 inactive 情况

### 刷新赛事数据

1. 先读取赛事总页，确认赛事基本信息。
2. 查找赛事总页中所有可用的子页面链接，例如 `swiss-stage`、`playoffs`、`group-stage`。
3. 依次打开每个子页面，分别读取其中展示的参赛队伍、阶段结果、排名或其他可见信息。
4. 对于**已经结束的赛事**：
   - 需要把所有子页面的信息合并后再统计参赛队伍。
   - `Swiss Stage` / `Group Stage` / `Playoffs` 等页面中的排名标号，应视为该赛事的最终排名信息。
5. 对于**未开始或进行中的赛事**：
   - 不关注最终排名。
   - 只统计所有子页面合并后的参赛队伍集合。
   - 统计时必须先合并所有子页面，再去重输出最终队伍列表。
6. 任何情况下都不要只根据单个子页面做最终汇总，避免遗漏其他子页面中的队伍。

## 六、建议校验方法

每次更新后，建议至少检查：

- `teams.json.current_roster` 中的每个 player id 是否都存在于 `players.json`
- `players.json.team_id` 与所属队伍是否一致
- `players.json.team_name` 与 `teams.json.name` 是否一致
- `region` 是否一致
- `vlr_player_id` 与 URL 中的 id 是否一致

## 七、当前已验证的实践结论

- 队伍页的 `Current Roster` 是更新 roster 的最佳入口
- 选手页 `?timespan=90d` 是更新近 90 天英雄统计的最佳入口
- 当前抓取结果中，英雄名有时缺失，但数值行可用
- 因此当前最稳的数据结构是：
  - `timespan = 90d`
  - `by_agent = 多行统计`
  - `agent` 可暂时留空

## 八、后续可扩展方向

以后如果需要更完整的数据，可以考虑继续扩展：

- 为 `by_agent` 补 `agent`
- 增加 `overview` 总计统计
- 增加 `recent_matches`
- 增加 `match_history`
- 增加 `transactions` / `past_teams`

但在当前阶段，优先保持：

- 数据真实
- 结构稳定
- 查询可用
