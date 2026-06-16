# 跨脚本组合使用

各脚本通过 `teamId`、`matchId`、`playerId`、`event_id` 等字段互相连接，下面是《无畏契约》职业数据的常用组合方式。

## 常用工作流

### 1. 战队名 → 战队资料 → 当前阵容 → 选手详情

```js
const { /* 战队查询函数，按脚本实际导出使用 */ } = require('./scripts/valorant-team.js');
const { /* 选手查询函数，按脚本实际导出使用 */ } = require('./scripts/valorant-player.js');

(async () => {
  // 1. 先查战队
  const teamResult = await fetchTeamData('FNATIC');
  const team = teamResult?.result?.team;

  // 2. 读取当前阵容
  const roster = team?.roster || [];
  console.log(team?.name, roster.map(p => p.name || p.player_name));

  // 3. 再挑某个选手继续查详情
  const firstPlayer = roster[0];
  if (firstPlayer?.vlr_player_id) {
    const playerResult = await fetchPlayerData(firstPlayer.vlr_player_id, 'info');
    console.log(playerResult?.result?.data?.player_profile);
  }
})();
```

适合问题：

- `FNATIC 现在阵容是谁？`
- `SEN 的一号位是谁？`
- `某战队选手资料`

### 2. 今天比赛 → 找 live / finished → 查比赛详情

```js
const { /* 赛程查询函数，按脚本实际导出使用 */ } = require('./scripts/valorant-schedule.js');
const { /* 比赛查询函数，按脚本实际导出使用 */ } = require('./scripts/valorant-match.js');

(async () => {
  // 1. 查今天赛程
  const today = await fetchScheduleByTime('today');
  const matches = today?.matches || [];

  // 2. 过滤 live 或 finished
  const targetMatches = matches.filter(m => ['live', 'finished'].includes(m.status));

  // 3. 逐场查详情
  for (const m of targetMatches) {
    const detail = await fetchMatchDetail('info', m.match_id);
    console.log(`${m.team_a?.name} vs ${m.team_b?.name} - ${detail?.score}`);
  }
})();
```

适合问题：

- `今天有哪些比赛？`
- `现在有哪些正在打的比赛？`
- `刚结束那场比分是多少？`

### 3. 赛事赛程 → 指定比赛 → 地图数据 / 单图选手数据

```js
const { /* 赛程查询函数 */ } = require('./scripts/valorant-schedule.js');
const { /* 比赛查询函数 */ } = require('./scripts/valorant-match.js');

(async () => {
  // 1. 先拉某赛事全部赛程
  const schedule = await fetchEventSchedule('masters-toronto-2026');
  const firstMatch = schedule?.matches?.[0];

  // 2. 查整场地图比分
  const maps = await fetchMatchDetail('maps', firstMatch.match_id);
  console.log(maps.maps);

  // 3. 查第一张地图 10 名选手数据
  const map1Players = await fetchMatchDetail('map1 players', firstMatch.match_id);
  console.log(map1Players.map);
})();
```

适合问题：

- `这个赛事第一天都打了什么？`
- `这场 BO3 每张图比分是多少？`
- `某场比赛第一张图谁数据最好？`

### 4. 比赛详情 → 双方选手 → 继续查选手近 90 天 stats

```js
const { /* 比赛查询函数 */ } = require('./scripts/valorant-match.js');
const { /* 选手查询函数 */ } = require('./scripts/valorant-player.js');

(async () => {
  // 1. 先查某场比赛汇总选手数据
  const summary = await fetchMatchDetail('players summary', '123456');
  const allPlayers = [
    ...(summary?.team_a?.players || []),
    ...(summary?.team_b?.players || []),
  ];

  // 2. 继续查某个选手近 90 天 stats
  const target = allPlayers[0];
  if (target?.vlr_player_id) {
    const stats = await fetchPlayerData(target.vlr_player_id, 'stats', '90d');
    console.log(target.player_name, stats?.by_agent);
  }
})();
```

适合问题：

- `这场比赛 MVP 平时玩什么英雄？`
- `这名选手最近 90 天的数据怎么样？`
- `某场比赛发挥最好的选手近况如何？`

### 5. 战队名 → 查最近结果 → 再追具体某场比赛

```js
const { /* 战队查询函数 */ } = require('./scripts/valorant-team.js');
const { /* 比赛查询函数 */ } = require('./scripts/valorant-match.js');

(async () => {
  // 1. 查战队页上的 recent results
  const teamResult = await fetchTeamData('Sentinels');
  const recent = teamResult?.result?.recent_results || [];

  // 2. 选择一场最近比赛
  const latest = recent[0];
  if (latest?.match_id) {
    const matchInfo = await fetchMatchDetail('info', latest.match_id);
    console.log(matchInfo);
  }
})();
```

适合问题：

- `SEN 最近状态怎么样？`
- `他们上一场打谁？`
- `那场比赛详细比分是什么？`

## 赛程 vs 战队 recent results

两者都能看到比赛，但语义不同：

- **赛程**（`valorant-schedule.js`）
  - 以赛事维度组织
  - 适合查 `今天比赛`、`某赛事赛程`、`某阶段比赛`
  - 返回的是标准化 `matches[]`

- **战队 recent results**（`valorant-team.js`）
  - 以战队维度组织
  - 适合查 `某战队最近状态`、`最近战绩`
  - 返回的是战队页上能直接看到的近期结果摘要

```js
// 赛事视角：看整个 event 的比赛
const eventSchedule = await fetchEventSchedule('masters-toronto-2026');

// 战队视角：看 FNATIC 最近结果
const teamResult = await fetchTeamData('FNATIC');
const recent = teamResult?.result?.recent_results;
```

## 选手输入建议

`valorant-player.js` 当前最稳的输入方式不是纯名字，而是：

1. `VLR 选手 URL`
2. `VLR playerId`
3. 本地 `players.json` 中已经存在的关键词

```js
// 最稳：直接用 VLR URL
await fetchPlayerData('https://www.vlr.gg/player/37927/happywei', 'info');

// 次稳：直接用 playerId
await fetchPlayerData(37927, 'stats', '90d');

// 可用：本地已有关键词
await fetchPlayerData('aspas', 'info');
```

这意味着如果你是从比赛详情或战队阵容里拿到 `vlr_player_id`，就应该直接继续往下查，不要再退回模糊名字匹配。

## 比赛查询常见分层

`valorant-match.js` 适合按查询深度逐层展开：

### 第 1 层：只看结果

```js
await fetchMatchDetail('info', matchId);
```

适合：

- `谁赢了`
- `比分多少`
- `什么时候打的`

### 第 2 层：看地图

```js
await fetchMatchDetail('maps', matchId);
```

适合：

- `每张图比分`
- `哪张图加时`
- `总比分`

### 第 3 层：看逐图选手数据

```js
await fetchMatchDetail('detail', matchId);
await fetchMatchDetail('map1 players', matchId);
```

适合：

- `某图谁打得最好`
- `Jett 是谁玩的`
- `第一张图十个人数据`

### 第 4 层：看整场汇总选手数据

```js
await fetchMatchDetail('players summary', matchId);
```

适合：

- `整场 MVP`
- `两边五个人总数据`
- `谁的 ACS 最高`

## 数据流概览

```text
VLR event page / schedule page
   │
   ▼ event_id / stage / date
valorant-schedule.js ────→ 赛事赛程 / 时间筛选 / 阶段筛选 / 状态统计
   │
   │ match_id
   ▼
valorant-match.js ───────→ 比赛信息 / 地图比分 / 对阵详情 / 逐图选手 / 汇总选手
   │                           │
   │ team_id                   │ vlr_player_id / player_id
   ▼                           ▼
valorant-team.js ────────→ 战队资料 / 阵容 / recent_results / recent_form / stats
   │
   │ roster / current_roster
   ▼
valorant-player.js ──────→ 选手资料 / 近 90 天 stats / by_agent
```

## 典型联动路径

### 1. 从赛程到比赛

- `valorant-schedule.js` 提供 `match_id`
- 再用 `valorant-match.js` 查 `info`、`maps`、`detail`

### 2. 从比赛到战队

- `valorant-match.js` 的 `team_a.id` / `team_b.id`
- 可以继续对应到 `teams.json.id`
- 适合再调用 `valorant-team.js` 做战队补充说明

### 3. 从比赛到选手

- `valorant-match.js detail` 或 `players summary`
- 可拿到 `player_id` / `vlr_player_id`
- 再联动 `valorant-player.js` 查询该人的长期 stats

### 4. 从战队到选手

- `valorant-team.js` 的 `roster`
- 可以逐个拿选手的 `vlr_player_id` 或名字
- 再调用 `valorant-player.js`

## 推荐回答策略

当用户提问时，建议按以下路径判断：

### 1. 赛程类

典型问法：

- `今天有哪些比赛`
- `明天赛程`
- `masters-toronto-2026 的赛程`
- `playoff 有哪些比赛`

建议脚本：

- `scripts/valorant-schedule.js`

重点字段：

- `event`
- `date`
- `time`
- `stage`
- `status`
- `match_id`
- `team_a`
- `team_b`
- `matches`

### 2. 战队类

典型问法：

- `FNATIC 资料`
- `SEN 现在阵容`
- `TL 最近状态`

建议脚本：

- `scripts/valorant-team.js`

重点字段：

- `result.team`
- `result.recent_results`
- `result.recent_form`
- `result.stats`
- `source`

### 3. 选手类

典型问法：

- `aspas 的资料`
- `这个 playerId 是谁`
- `某选手近 90 天英雄数据`

建议脚本：

- `scripts/valorant-player.js`

重点字段：

- `result.data.player_profile`
- `result.data.team`
- `result.data.recent_results`
- `by_agent`
- `source.resolve_mode`

### 4. 比赛类

典型问法：

- `这场比赛谁赢了`
- `每张图比分`
- `第一张图十个人数据`
- `整场 MVP`

建议脚本：

- `scripts/valorant-match.js`

重点字段：

- `match_id`
- `event_id`
- `stage`
- `score`
- `winner_team_id`
- `maps`
- `team_a`
- `team_b`
- `players`

## 输出建议

尽量使用稳定、可追踪的 JSON 风格分段：

- `query_type`
- `matched_script`
- `normalized_query`
- `filters`
- `result`
- `source`
- `notes`

如果是比赛或赛程结果，尽量保留这些关键连接键：

- `match_id`
- `event_id`
- `team_id`
- `player_id`
- `vlr_player_id`
- `vlr_team_id`
- `vlr_url`

## 数据源策略

- 使用 `VLR.gg` 作为主要查询来源。
- 不再使用 `Liquipedia` 或其他外部来源。
- 选手数据只返回 VLR 页面真实可见内容。
- 赛事数据必须先读取赛事总页，再汇总所有子页面。
- 战队数据优先使用 VLR，静态数据仅作为兜底与对照。
- 如果涉及选手统计，必须遵循 `references/vlr-data-refresh.md`。

## 兜底行为

- 如果实体有歧义，要求用户进一步说明。
- 如果没有精确匹配，返回 `not_found`。
- 如果查询超出当前技能支持范围，说明限制并建议改成：
  - 战队查询
  - 选手查询
  - 比赛查询
  - 赛程查询
- 如果是纯选手名字且本地索引没有，不要强行猜测，应要求提供 `VLR URL` 或 `playerId`。
- 如果 VLR 页面临时不可用，可返回 `vlr_unavailable` / `not_found` 类结构，并说明是页面不可访问而不是数据不存在。