# 战队配置（静态数据）

48 支 VCT 2026 联赛战队配置保存在 `data/teams.json`，覆盖四大赛区：`AMERICAS`、`EMEA`、`PACIFIC`、`CHINA`。

这些静态数据是战队目录查询、按赛区过滤、按名称映射 `team_id` 的基础。

## 脚本：`scripts/valorant-teams.js`

### 列出全部 48 支战队

```bash
node scripts/valorant-teams.js
node scripts/valorant-teams.js list
```

说明：
- 不传参数时返回全部战队
- 结果应包含 48 支战队
- 推荐按 `region + name` 或原始数据顺序输出

### 查询指定赛区战队

```bash
node scripts/valorant-teams.js region AMERICAS
node scripts/valorant-teams.js region EMEA
node scripts/valorant-teams.js region PACIFIC
node scripts/valorant-teams.js region CHINA
```

说明：
- 赛区值建议大小写不敏感
- 也可兼容 `Americas`、`Pacific`、`China` 这类标签写法
- 返回该赛区下全部战队列表

### 按名称查询 `team_id`

```bash
node scripts/valorant-teams.js find Sentinels
node scripts/valorant-teams.js find EDG
node scripts/valorant-teams.js find "Team Liquid"
```

说明：
- 优先精确匹配标准名称 `name`
- 再匹配简称 `short_name`
- 最后匹配别名 `aliases`
- 返回结构中应明确给出 `team_id`

### 关键词搜索战队

```bash
node scripts/valorant-teams.js search liquid
node scripts/valorant-teams.js search geng
node scripts/valorant-teams.js search heretics
```

说明：
- 用于模糊匹配战队名称、简称、别名
- 若命中多个结果，返回候选列表
- 若未命中，返回 `null` 或空结果，并带 `no_teams_matched` 提示

### 查看战队数据基本信息

```bash
node scripts/valorant-teams.js info
```

说明：
- 返回版本号、更新时间、赛区列表、总战队数等摘要信息

## 数据结构

**teams.json 顶层字段：**

| 字段 | 类型 | 说明 |
|------|------|------|
| version | string | 数据版本 |
| updated_at | string | 数据更新时间 |
| source_strategy | object | 数据来源策略 |
| scope | string | 数据覆盖范围 |
| regions | object | 四大赛区战队配置 |

**赛区对象字段（regions.<REGION>）：**

| 字段 | 类型 | 说明 |
|------|------|------|
| label | string | 赛区展示名 |
| teams | array | 该赛区全部战队 |

**战队对象字段（regions.<REGION>.teams[]）：**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 战队唯一标识，推荐作为 `team_id` 使用 |
| name | string | 战队标准名称 |
| short_name | string | 战队简称 |
| region | string | 所属赛区 |
| aliases | array | 别名列表 |
| status | string | 当前状态，如 `active` |
| vlr_url | string | VLR 战队主页链接 |
| vlr_team_id | number | VLR 战队 ID |
| current_roster | array | 当前阵容 |

## 推荐返回字段

- `team_id`
- `team_name`
- `short_name`
- `region`
- `aliases`
- `status`
- `vlr_url`
- `vlr_team_id`
- `current_roster`
- `match_count`
- `teams`

## 推荐返回规则

### 1. 列出全部战队

- 返回全部 48 支战队
- 建议附带：
  - `total = 48`
  - `regions = ["AMERICAS", "EMEA", "PACIFIC", "CHINA"]`
- 若脚本内部按赛区存储，输出前可拍平成单一数组

### 2. 按赛区过滤

- 支持 `region <region>`
- 赛区名建议先标准化：
  - `americas` -> `AMERICAS`
  - `emea` -> `EMEA`
  - `pacific` -> `PACIFIC`
  - `china` -> `CHINA`
- 返回该赛区下全部战队
- 如果赛区不存在，返回 `null`

### 3. 按名称查 `team_id`

- 优先顺序建议：
  1. `name` 精确匹配
  2. `short_name` 精确匹配
  3. `aliases` 精确匹配
  4. 名称模糊匹配
- 单一命中时直接返回该战队完整信息
- 多个命中时返回候选列表，要求进一步确认
- 必须显式返回 `team_id`

### 4. 模糊搜索

- 对 `name`、`short_name`、`aliases` 做统一规范化后搜索
- 建议忽略大小写
- 对带空格、点号、重音字符的名称做兼容，例如：
  - `LEVIATÁN` -> `leviatan`
  - `Gen.G` -> `geng`
  - `KRÜ` -> `kru`
- 无结果时返回空列表或 `null`

## 示例问题

- 所有战队有哪些
- 48 支战队分别是谁
- EMEA 有哪些队伍
- Pacific 赛区有哪些队伍
- Sentinels 的 team_id 是什么
- EDG 的 id 是什么
- Team Liquid 属于哪个赛区
- 有没有叫 Heretics 的队伍

## 匹配建议

- 优先使用静态 `data/teams.json`，不要实时抓取。
- 查询全量列表时，先把四个赛区的 `teams` 拍平。
- 名称匹配建议做大小写、重音符号、标点统一。
- 若用户输入简称，例如 `EDG`、`PRX`、`TL`，应直接命中对应战队。
- 若用户输入存在歧义，返回候选战队而不是强行猜测。
- `team_id` 默认指本地静态数据中的 `id`，不是 `vlr_team_id`。
