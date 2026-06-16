# 选手详情

## 脚本：`scripts/valorant-player.js`

当前脚本已经改成 **优先直连 VLR.gg 选手页**，不再强依赖本地 `data/players.json`。

查询优先级现在是：

1. 直接传 `VLR 选手 URL`
2. 直接传 `VLR playerId`
3. 如果你传的是普通关键词，并且它刚好存在于本地 `data/players.json`，才会把本地索引当作可选辅助

所以它现在的核心设计是：

- **直查优先**
- **本地静态数据只是辅助，不是前提**
- 最终返回内容仍然只以 `VLR.gg` 页面真实可见数据为准

## 命令

```bash
node scripts/valorant-player.js info <playerKeyword|vlrPlayerId|vlrPlayerUrl>      # 查询选手基础信息；优先直连 VLR
node scripts/valorant-player.js stats <playerKeyword|vlrPlayerId|vlrPlayerUrl> [timespan] # 查询选手统计数据；默认 90 天
node scripts/valorant-player.js detail <playerKeyword|vlrPlayerId|vlrPlayerUrl> [tab] # 查询选手详情；默认 info + stats
node scripts/valorant-player.js <playerKeyword|vlrPlayerId|vlrPlayerUrl>            # 默认等价于 info
```

其中：

- 不写子命令时，默认等价于 `info`
- `stats` 默认 `timespan=90d`
- `detail` 默认返回 `info + stats`
- `detail <query> info` 表示只返回 `info`
- `detail <query> stats` 表示只返回 `stats`

## 最推荐的用法

### 1. 直接传 VLR 选手链接

这是最稳的方式：

```bash
node scripts/valorant-player.js info https://www.vlr.gg/player/37927/happywei
node scripts/valorant-player.js stats https://www.vlr.gg/player/37927/happywei
node scripts/valorant-player.js detail https://www.vlr.gg/player/37927/happywei
```

适合：

- 你已经知道 VLR 选手页链接
- 不想依赖本地索引
- 想查 `s0pp` 这类本地还没收录的人

### 2. 直接传 VLR playerId

```bash
node scripts/valorant-player.js info 37927
node scripts/valorant-player.js stats 37927
node scripts/valorant-player.js detail 37927
```

这会自动拼成：

```text
https://www.vlr.gg/player/37927
```

如果 VLR 会自动跳到带 slug 的正式地址，脚本会跟随跳转。

### 3. 传本地已有的关键词

```bash
node scripts/valorant-player.js info happywei
node scripts/valorant-player.js stats aspas
node scripts/valorant-player.js detail zekken
```

说明：

- 这种用法仍可用
- 但前提是该选手已经存在于本地 `data/players.json`
- 如果本地没有，就不能只靠名字全站搜索

## 为什么 `s0pp` 现在应该怎么查

如果 `s0pp` 不在本地 `players.json` 中，不要再这样查：

```bash
node scripts/valorant-player.js info s0pp
```

更合理的是：

```bash
node scripts/valorant-player.js info <s0pp的vlr链接>
```

或者：

```bash
node scripts/valorant-player.js info <s0pp的vlr_player_id>
```

因为当前脚本已经支持 **不靠本地索引的直查模式**。

## 查询目标

回答关于单个选手以下类型的问题：

- 基础资料
- 当前队伍
- 国籍 / 真实姓名
- 近 90 天英雄统计
- 这个 VLR 选手页当前能看到什么

## 解析原则

严格遵循 `references/vlr-data-refresh.md`：

- 只返回 **VLR 页面真实可见** 的数据
- 页面没有的字段不猜
- 如果值当前无法稳定提取，宁可返回空值
- 统计优先使用 `timespan=90d`
- 英雄统计按 `by_agent` 多行返回
- 如果英雄名抓不到，允许 `agent` 为空字符串

## `info` 返回结构

`info` 命令返回的数据位于：

- `result.data.player_profile`
- `result.data.team`
- `result.data.role`
- `result.data.recent_results`
- `result.data.recent_form`
- `result.data.notes`

### `player_profile` 常见字段

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string \| null | 本地 id；若无本地记录则根据显示名生成近似 id |
| name | string \| null | VLR 页显示名 |
| short_name | string \| null | 简称，默认与显示名一致 |
| aliases | array | 显示名、真实姓名和本地别名合并结果 |
| nationality | string \| null | 页面展示国籍 |
| age | number \| null | 页面能明确识别时返回，否则为空 |
| team_id | string \| null | 若本地索引存在则可带出，否则为空 |
| team_name | string \| null | 当前队伍名称 |
| region | string \| null | 若本地索引存在则可带出，否则为空 |
| vlr_url | string \| null | VLR 选手页面 |
| vlr_player_id | number \| null | VLR 选手 ID |
| status | string \| null | 本地状态字段，直查模式下通常为空 |
| real_name | string \| null | 页面展示真实姓名 |
| team_url | string \| null | 当前队伍 VLR 页面 |
| source_page_title | string \| null | 当前抓取页面标题 |

## `stats` 返回结构

`stats` 命令返回：

| 字段 | 类型 | 说明 |
|------|------|------|
| player_id | string \| null | 选手 ID |
| player_name | string \| null | 选手名称 |
| vlr_player_id | number \| null | VLR 选手 ID |
| timespan | string | 当前统计周期 |
| by_agent | array | 英雄维度统计 |

### `by_agent[]` 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| agent | string | 英雄名；抓不到时允许为空字符串 |
| use | string \| null | 使用率 / 场次文本，如 `(17) 53%` |
| rnd | number \| null | 回合数 |
| rating | number \| null | Rating |
| acs | number \| null | ACS |
| k_d | number \| null | K:D |
| adr | number \| null | ADR |
| kast | string \| null | KAST |
| kpr | number \| null | KPR |
| apr | number \| null | APR |
| fkpr | number \| null | FKPR |
| fdpr | number \| null | FDPR |
| kills | number \| null | 击杀 |
| deaths | number \| null | 死亡 |
| assists | number \| null | 助攻 |
| fk | number \| null | First Kill |
| fd | number \| null | First Death |

## 结果中的解析来源

你可以通过 `source.resolve_mode` 判断这次查询是怎么定位到选手的：

- `direct_url`：你直接传了 VLR 选手链接
- `direct_id`：你直接传了 VLR 数字 playerId
- `local_index`：你传的是关键词，脚本通过本地索引辅助定位

## 状态说明

### 成功

当 VLR 页面可访问且可解析时：

- `result.found = true`
- `result.status = "resolved"`

### 关键词无法定位

如果你输入的是普通名字，但它不在本地 `players.json` 中：

- `result.found = false`
- `result.status = "not_found"`
- `reason = "player_keyword_requires_vlr_player_id_or_url_when_not_in_local_index"`

也就是说：

- 脚本现在不再强依赖本地静态数据
- 但如果你只给一个纯名字，它也不会替你做 VLR 全站搜索
- 因此这时应改用 `playerId` 或 `VLR URL`

### VLR 页面不可访问

如果传入的 `playerId` / `URL` 对应页面无效，或者页面临时不可访问：

- `result.found = false`
- `result.status = "not_found"`
- `reason = "vlr_player_page_unavailable_or_not_found"`

## 推荐问题

- 这个选手是谁
- 这个 VLR 链接对应谁
- 某个 playerId 对应哪个选手
- 某选手最近 90 天英雄数据如何
- 这个选手当前队伍是什么

## 工作流

1. 判断输入是关键词、VLR URL 还是数字 playerId。
2. 如果是 URL / playerId，直接构造 VLR 选手页。
3. 如果是关键词，尝试用本地索引辅助定位。
4. 请求选手页与 `?timespan=90d` 页面。
5. 只提取当前页面明确可见的数据。
6. 返回结构化摘要。

## 当前限制

- 已经不再强依赖本地静态数据
- 但**纯关键词仍然不能做 VLR 全站搜索**
- 若关键词不在本地索引中，必须改用 `playerId` 或 `VLR URL`
- `role`、`recent_results`、`recent_form` 目前仍然较保守
- 统计解析依赖 VLR 页面文本结构，若页面改版可能需要调整
- 不会猜测页面未明确给出的信息

## 最实用的建议

如果你的目标是尽量摆脱本地静态数据依赖，实际使用时请优先采用这两种命令：

```bash
node scripts/valorant-player.js info <vlrPlayerUrl>
node scripts/valorant-player.js info <vlrPlayerId>
```

例如：

```bash
node scripts/valorant-player.js info https://www.vlr.gg/player/37927/happywei
node scripts/valorant-player.js stats 37927
```