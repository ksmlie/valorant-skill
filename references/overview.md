# 赛事概览

这个技能用于查询《无畏契约》职业赛事的基础信息、赛制、参赛队伍与主办城市等内容，重点覆盖 VCT 2026 体系。

## 基本信息

- **赛事阶段**：`kickoff`、`masters 1`、`stage 1`、`masters 2`、`stage 2`、`champions`
- **四大赛区**：Americas、EMEA、Pacific、China
- **参赛队伍数量**：
  - 赛区联赛：共 4 * 12 = 48 支
  - 大师赛：共 4 * 3 = 12 支
  - 冠军赛：共 4 * 4 = 16 支
- **主办城市**：待定

## 晋级规则

### 赛区联赛

- 赛区内联赛小组赛分为两组。
- 每组 6 支队伍中，前 4 名晋级。
- 晋级后的 8 支队伍进行双败淘汰赛，争夺赛区冠军与后续国际赛事席位。

### 大师赛

- 4 支一号种子直接晋级淘汰赛阶段。
- 剩余 8 支队伍先打瑞士轮，决出 4 个晋级名额。
- 最终 8 支队伍进入双败淘汰赛，争夺大师赛冠军。

### 冠军赛

- 具体赛制待定。  
- 后续以官方公布为准。

## 四大赛区队伍一览

> 说明：以下队伍列表按 `data/teams.json` 当前内容整理，并与 `references/teams.md` 的战队检索规则配合使用。

### Americas

- G2 Esports
- NRG
- FURIA
- LEVIATÁN
- 100 Thieves
- MIBR
- KRÜ Esports
- LOUD
- ENVY
- Sentinels
- Cloud9
- Evil Geniuses

### EMEA

- BBL Esports
- FUT Esports
- Team Liquid
- FNATIC
- Eternal Fire
- Gentle Mates
- PCIFIC Esports
- Karmine Corp
- Natus Vincere
- GIANTX
- Team Heretics
- Team Vitality

### Pacific

- Nongshim RedForce
- T1
- FULL SENSE
- Paper Rex
- Global Esports
- Rex Regum Qeon
- Kiwoom DRX
- DetonatioN FocusMe
- Team Secret
- ZETA DIVISION
- VARREL
- Gen.G

### China

- Xi Lai Gaming
- All Gamers
- Dragon Ranger Gaming
- Bilibili Gaming
- TYLOO
- JDG Esports
- EDward Gaming
- FunPlus Phoenix
- Titan Esports Club
- Trace Esports
- Nova Esports
- Wolves Esports

> 备注：当前配置以静态数据为准；如与官方最新名单不一致，请以最新数据源为准。

## 数据来源

- 主要来源：`VLR.gg`
- 队伍配置数据：`data/teams.json`
- 赛事说明与查询规范：`references/teams.md`
- 赛事数据读取必须遵循“先总页、后子页面、再汇总”的原则

## 注意事项

- 当前冠军赛主办城市与赛制均为待定信息，后续以官方公告更新为准。
- `data/teams.json` 属于静态配置，可能与即时赛季名单存在差异。
- 如果同一名称存在简称、旧名或别名，优先按 `teams.md` 中的匹配规则做标准化处理。
- 当用户查询具体赛区队伍时，优先返回标准名称，再补充别名与赛区标识。

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

## 后续扩展

后续版本可以增加选手、比赛和赛事数据集，以及更丰富的排名和历史趋势逻辑。

## 赛事汇总规则

- 对已结束赛事，`Swiss Stage` / `Group Stage` / `Playoffs` 页面中的名次可视为最终排名信息的一部分。
- 对未开始或进行中的赛事，只汇总所有子页面的参赛队伍，不依赖排名。
