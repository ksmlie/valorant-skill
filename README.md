# valorant-pro-skill

`valorant-pro-skill` 是一个面向《无畏契约》（VALORANT）职业赛事的查询型 Skill。

## 项目定位

这个 Skill 主要服务四类高频需求：

1. 选手查询
2. 战队查询
3. 比赛查询
4. 赛程与赛事查询

同时提供战队目录、静态赛事/战队数据、以及跨脚本联动的工作流参考，方便下游自动化或 AI 继续串联查询。

## 主要功能

### 1. 战队目录与别名检索

- 查看全部战队
- 按赛区筛选战队
- 按名称、简称、别名查找战队
- 返回标准化战队 ID、VLR ID、VLR URL、当前阵容等字段

对应脚本：`scripts/valorant-teams.js`

### 2. 赛程查询

- 查询今天、明天、未来比赛
- 按赛事、时间、阶段、状态过滤赛程
- 输出标准化比赛列表，便于继续追踪 `match_id`

对应脚本：`scripts/valorant-schedule.js`

### 3. 比赛查询

- 查询比赛结果、比分、地图信息
- 查询双方交手记录
- 查询逐图选手数据与整场汇总数据
- 支持继续联动到战队或选手维度

对应脚本：`scripts/valorant-match.js`

### 4. 战队查询

- 查询战队资料
- 查询当前阵容
- 查询近期战绩与状态
- 查询战队相关统计

对应脚本：`scripts/valorant-team.js`

### 5. 选手查询

- 查询选手资料
- 查询所属战队与当前信息
- 查询近 90 天战绩与逐英雄统计
- 支持从 `VLR URL`、`playerId` 或本地索引做更稳定的解析

对应脚本：`scripts/valorant-player.js`

### 6. 赛事概览与汇总

- 查询赛事总页信息
- 汇总所有子页面中的参赛队伍、阶段、排名等可见信息
- 支持对已结束、进行中、未开始赛事进行不同粒度的整理

相关参考：`references/overview.md`、`references/teams.md`、`references/workflows.md`

## 数据源原则

- 仅使用 `VLR.gg` 真实页面数据
- 不再使用 `Liquipedia` 或其他外部来源
- 选手数据必须严格遵循 `references/vlr-data-refresh.md`
- 赛事数据必须先读取总页，再查找并汇总所有子页面
- 不能基于单个子页面直接得出完整赛事结论
- 只返回页面中明确可见的字段，不猜测、不补全、不虚构

## 目录结构

- `scripts/`
  - 负责不同查询类型的核心脚本
- `data/`
  - 存放静态 JSON 数据，如战队、选手、赛事信息
- `references/`
  - 存放查询规范、刷新流程、组合工作流、专题说明
- `SKILL.md`
  - 该 Skill 的总说明与路由入口

## 静态数据约定

- `data/teams.json`
  - 战队身份、赛区、别名、状态、VLR 信息、当前阵容
- `data/players.json`
  - 选手身份、所属战队、基础信息、近 90 天逐英雄统计
- `data/events.json`
  - 赛事信息、子页面、参赛队伍、阶段与排名

## 推荐查询顺序

### 选手查询

1. 先查队伍页 `Current Roster`
2. 再查选手主页
3. 最后查 `?timespan=90d`
4. 只写页面明确可见字段
5. 统计按英雄逐行保存，英雄名缺失时可留空

### 赛事查询

1. 先读取赛事总页
2. 找出总页中所有子页面链接，例如 `swiss-stage`、`playoffs`、`group-stage`
3. 逐个打开子页面并读取其中可见队伍、阶段、排名
4. 若赛事已结束，再合并所有子页面后判断最终结果
5. 若赛事未开始或进行中，只汇总参赛队伍，不强行补名次

## 输出要求

所有脚本都尽量返回稳定的结构化结果，建议沿用以下顶层字段：

- `query_type`
- `matched_script`
- `normalized_query`
- `filters`
- `result`
- `source`
- `notes`

通用约定：

- 使用标准 `id`、别名和可追踪的 `source` 字段
- 找不到精确结果时返回结构化 `not_found`
- 字段命名保持稳定、紧凑，避免无意义扩张
- 优先返回 JSON 风格数据，便于机器继续处理

## 常见示例问题

- 今天有哪些比赛
- 某战队最近状态怎么样
- 某选手的资料和近 90 天战绩
- 某场比赛谁赢了
- 某战队的赛程
- 某战队有哪些选手
- 某个赛事有哪些参赛队伍
- 某赛事的阶段、子页面和排名如何汇总

## 参考文档

- `references/overview.md`
- `references/usage.md`
- `references/workflows.md`
- `references/teams.md`
- `references/schedule.md`
- `references/match.md`
- `references/team.md`
- `references/player.md`
- `references/vlr-data-refresh.md`

## 设计原则

- 先查询，后分析
- 优先精确匹配和确定性兜底逻辑
- 统一规范战队与选手别名
- 不做过度解读，不补不存在的数据
- 找不到就返回 `not_found`，不要猜

## 适用范围

当前 Skill 已覆盖的核心场景包括：

- 职业战队目录与检索
- 赛程与比赛结果查询
- 战队资料与近期状态查询
- 选手资料与近 90 天统计查询
- 赛事总页 + 子页面汇总查询

如果后续需要扩展，可以继续增加更多静态数据或更细粒度的比赛/选手/赛事维度字段。