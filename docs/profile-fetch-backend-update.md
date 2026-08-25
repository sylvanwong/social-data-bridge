# 获取作者作品改版：后端更新文档

## 1. 目标与范围

页面：`ProfileFetch.vue`，插件类型固定为 `profile_fetch`。

本次按《博主作品.html》更新，涉及以下三项：

1. 新增独立的“作品获取范围”，不能与原来的“数据提取范围”混用。
2. 输出设置新增“数据写入方式”。
3. “使用现有表格”时新增可选“字段映射”，并将每张目标表的设置保存到后端。

已有的定时任务 CRUD、调度时间、来源表、执行范围等协议继续使用
`docs/profile-fetch-schedule-api.md`。本文定义其新增字段、表级配置接口与后端写入规则。

所有接口沿用鉴权：

```http
authorization: Bearer {api_key}
```

所有请求仍由现有 axios 拦截器附加 `version`。

## 2. 术语和兼容约定

| 页面文案 | 机器字段 | 取值 | 说明 |
| --- | --- | --- | --- |
| 作品获取范围 | `work_fetch_range` | `all/pages/days` | 获取全部作品、最新 N 页作品、最近 N 个自然日发布的作品。 |
| 更新或新增 | `write_mode` | `upsert` | 以 `aweme_id` 判定同一作品，命中则更新，未命中则新增。 |
| 始终新增 | `write_mode` | `append` | 每次结果均新建记录，不查重；这是设计稿的默认选项。 |
| 字段映射 | `field_mappings` | array | 抓取结果字段 key 到飞书目标字段 ID 的显式映射。 |

兼容规则：

- 旧表配置未携带 `write_mode` 时，按 `append` 处理，保持现有前端“只新增”的行为。
- 未查询到表配置或表配置未携带 `field_mappings` 时，按空数组处理，继续使用“同名列写入；不存在则创建同名列”的自动匹配规则。
- 原 `scope`/`row_count` 是“从源表取哪些博主链接”的数据范围；`work_fetch_range` 是“每个博主获取哪些作品”，两者必须同时保留、分别执行。
- 旧任务仅有 `pages` 时，按后文的兼容规则转换为 `work_fetch_range`；新前端和新任务不再以 `pages` 作为作品范围协议。
- `upsert` 的唯一键不是用户可配置项，固定使用原始作品 ID，不能依赖映射后的列名。

## 3. 表级配置：必须新增的持久化模型

字段映射和写入方式属于“目标表”的长期偏好，不能只放在浏览器本地存储，也不能只存在某一个定时任务中。每个目标表独立保存一份配置：切换到表 B 时不得覆盖表 A 的配置，也不存在 Base 级或用户级的全局默认映射。

唯一键：

```text
plugin_type + base_id + target_table_id
```

建议表名：`social_table_output_configs`。

| 列 | 类型 | 约束/索引 | 说明 |
| --- | --- | --- | --- |
| `id` | bigint/uuid | PK | 主键。 |
| `plugin_type` | varchar(64) | unique key part | 固定 `profile_fetch`。 |
| `base_id` | varchar(128) | unique key part | 飞书 Base ID。 |
| `target_table_id` | varchar(128) | unique key part | 飞书目标表 ID，必须使用 ID 不能使用表名。 |
| `target_table_name` | varchar(255) |  | 仅用于回显和排查。 |
| `write_mode` | varchar(16) | not null | `append` 或 `upsert`，默认 `append`。 |
| `field_mappings_json` | json/jsonb | not null | 显式映射数组，默认 `[]`。 |
| `created_at` | datetime |  | 创建时间。 |
| `updated_at` | datetime |  | 最近保存时间。 |

建立唯一索引：

```sql
UNIQUE KEY uq_social_table_output_config
  (plugin_type, base_id, target_table_id)
```

不要将授权码写入此表；授权码仍只属于任务顶层的 `personal_base_token`，按现有安全策略加密保存。

## 4. 表级配置 API

### 4.1 页面进入时读取全部配置（必接）

```http
GET /social/api/v1/feishu/profile-fetch/table-output-configs
  ?base_id=base_xxx
```

前端每次进入“获取作者作品”页面、取得当前 `base_id` 后，必须调用此接口。后端按
`plugin_type=profile_fetch + base_id` 返回该 Base 下全部已保存的目标表配置，不能因当前未选择目标表而跳过查询。

成功响应示例：

```json
{
  "sta": 0,
  "data": {
    "list": [
      {
        "plugin_type": "profile_fetch",
        "base_id": "base_xxx",
        "target_table_id": "tbl_target_xxx",
        "target_table_name": "作者作品表",
        "write_mode": "upsert",
        "field_mappings": [
          {
            "source_key": "nickname",
            "source_name": "作者名称",
            "target_field_id": "fld_author",
            "target_field_name": "博主账号",
            "target_field_type": 1
          }
        ]
      }
    ]
  }
}
```

没有任何历史配置时，返回空列表，不返回 404：

```json
{
  "sta": 0,
  "data": { "list": [] }
}
```

### 4.2 按目标表精确读取（可选）

```http
GET /social/api/v1/feishu/profile-fetch/table-output-config
  ?base_id=base_xxx
  &target_table_id=tbl_target_xxx
```

此接口可供前端在目标表切换后强制刷新使用，但不能替代页面初始化的列表查询。未配置不是错误，应返回默认配置。

成功响应示例：

```json
{
  "sta": 0,
  "data": {
    "plugin_type": "profile_fetch",
    "base_id": "base_xxx",
    "target_table_id": "tbl_target_xxx",
    "target_table_name": "作者作品表",
    "write_mode": "upsert",
    "field_mappings": [
      {
        "source_key": "nickname",
        "source_name": "作者名称",
        "target_field_id": "fld_author",
        "target_field_name": "博主账号",
        "target_field_type": 1
      },
      {
        "source_key": "title",
        "source_name": "标题",
        "target_field_id": "fld_content",
        "target_field_name": "内容",
        "target_field_type": 1
      }
    ]
  }
}
```

没有历史配置时：

```json
{
  "sta": 0,
  "data": {
    "plugin_type": "profile_fetch",
    "base_id": "base_xxx",
    "target_table_id": "tbl_target_xxx",
    "write_mode": "append",
    "field_mappings": []
  }
}
```

### 4.3 保存配置（全量覆盖）

```http
PUT /social/api/v1/feishu/profile-fetch/table-output-config
```

请求体：

```json
{
  "plugin_type": "profile_fetch",
  "base_id": "base_xxx",
  "target_table_id": "tbl_target_xxx",
  "target_table_name": "作者作品表",
  "write_mode": "upsert",
  "field_mappings": [
    {
      "source_key": "nickname",
      "source_name": "作者名称",
      "target_field_id": "fld_author",
      "target_field_name": "博主账号",
      "target_field_type": 1
    }
  ]
}
```

语义为 upsert 一条表级配置：一次请求只保存请求中 `target_table_id` 对应的一张目标表；提交空数组表示只清空该表的全部自定义映射，不影响同一 Base 的其他表。后端返回保存后的完整配置。

### 4.4 参数校验

- `plugin_type` 必须为 `profile_fetch`。
- `base_id`、`target_table_id` 必填。
- `write_mode` 仅允许 `append`、`upsert`；缺失时落为 `append`。
- 每一项映射的 `source_key` 和 `target_field_id` 必填；同一请求内两者各自不得重复。
- `source_key` 必须属于当前版本支持的作品字段集合，不能接受任意字符串。
- `source_name`、`target_field_name`、`target_field_type` 是回显冗余信息；后端实际执行仅信任 `source_key` 和 `target_field_id`。
- 保存前使用任务授权码或受控的飞书服务凭证校验目标表/字段存在及字段类型兼容。目标表或字段已删除时，返回可定位的错误信息。

字段类型兼容规则应与前端 `PROFILE_FIELD_MAPPING` 一致：

- `nickname`、`note_type`、`social_type`：文本或单选。
- `profile_url`：文本或链接。
- `tags`：文本或多选。
- 其他字段：类型必须与字段定义一致。

### 4.5 前端加载、保存和使用时序

```text
进入页面 -> GET 全部表级配置 -> 选择“使用现有表格”及目标表
        -> 从已加载配置中按 target_table_id 应用 write_mode / field_mappings
        -> 用户修改并保存 -> PUT 表级配置 -> 更新页面内存配置
        -> 立即执行：直接用当前配置写入
        -> 保存定时任务：只保存目标表 ID 等任务参数
        -> 后端定时执行：按目标表 ID 查询最新表级配置后写入
```

- 选择“新建表格”时不读取、不保存该表的映射，使用默认 `append + []`。
- 选择的现有表在列表中无配置时，前端使用默认 `append + []`；用户执行或保存定时任务前如未改动，可不创建空配置记录。
- 用户从表 A 切换到表 B 时，应先按 B 的 `target_table_id` 从已加载列表取配置；B 未配置则显示默认值，不能沿用 A 的映射或写入方式。
- 字段映射、写入方式一经用户确认保存，必须先成功完成 `PUT table-output-config`，立即执行和保存定时任务才能继续，避免这两条路径使用不一致的配置。
- 立即执行时，抓取/结果接口可以不携带配置；前端使用已加载的 `write_mode`、`field_mappings` 调用飞书 Base 写入逻辑。后端只负责存储和读取配置，不应假定即时写入会从任务快照获取配置。

## 5. 定时任务请求的新增快照字段

定时任务创建、更新接口路径不变：

```http
POST /social/api/v1/feishu/schedule/tasks
PUT  /social/api/v1/feishu/schedule/tasks/{id}
```

在 `snapshot` 中只新增任务执行参数。`field_mappings` 和 `write_mode` 不写入快照：它们以表级配置为唯一来源，调度执行时必须实时查询。

```json
{
  "snapshot": {
    "target_type": "existing",
    "target_table_id": "tbl_target_xxx",
    "resolved_target_table_id": "tbl_target_xxx",
    "work_fetch_range": {
      "type": "days",
      "value": 30,
      "timezone": "Asia/Shanghai"
    }
  }
}
```

| 字段 | 类型 | 条件 | 说明 |
| --- | --- | --- | --- |
| `work_fetch_range` | object | 必填 | 作品获取范围，结构见下文。 |

`work_fetch_range` 的完整约定：

| `type` | `value` | 语义 |
| --- | --- | --- |
| `all` | 可省略或 `null` | 获取该博主全部作品。 |
| `pages` | 整数 `1-50` | 获取最新 N 页作品。 |
| `days` | 整数 `1-365` | 获取最近 N 个自然日发布的作品，使用 `timezone=Asia/Shanghai`。 |

`days` 的时间边界为北京时间自然日：N=1 表示执行当日 `00:00:00` 至 `23:59:59`；N=30 表示从执行当日向前包含 30 个自然日。即时执行时按请求发起时计算，定时任务每次触发时重新计算，不能在保存任务时固化绝对日期。

定时任务只保存目标表标识与抓取参数。每次触发时，后端以 `snapshot.base_id + resolved_target_table_id（或 target_table_id）+ profile_fetch` 查询 `social_table_output_configs`，使用查询到的最新 `field_mappings` 和 `write_mode`。这样用户更新某张表的映射后，下一次立即执行和下一次定时执行会使用同一配置。

## 6. 后端定时写入规则

后端在调度执行 `profile_fetch` 时按以下顺序处理：

1. 读取任务、校验启用状态和 `plugin_type`，取得 `personal_base_token` 与 `snapshot`。
2. 根据 `mode` 从源表读取主页链接，或解析 `manual_urls`；按 `scope`、`row_count` 筛选。
3. 按 `snapshot.work_fetch_range` 抓取作品：`all` 获取全量，`pages` 限制最新页数，`days` 按北京时间过滤发布时间。
4. 确定目标表：优先 `resolved_target_table_id`，其次 `target_table_id`。`target_type=new` 首次执行时创建表，并将最终表 ID/名称回写到任务快照。
5. 以任务快照中的 `base_id`、目标表 ID 和 `plugin_type=profile_fetch` 查询表级配置；未查到时使用 `append + []` 默认值。
6. 读取目标表字段元数据，先按查询到的 `field_mappings[].target_field_id` 建立显式写入映射。
7. 对未显式映射的已选择输出字段，按标准字段名称匹配目标列；仍未匹配时创建同名、兼容类型的新列，并可将新 field ID 更新回表级配置。
8. 根据查询到的 `write_mode` 写入记录。

当上游抓取接口本身不支持按自然日过滤时，后端可以先按时间倒序分页抓取，再以作品的 `create_time`（秒级 Unix 时间戳）按 `Asia/Shanghai` 转换后的自然日边界过滤；一旦结果已早于开始日期即可停止继续翻页。若平台无法提供可靠发布时间，任务必须明确报出该平台不支持 `days` 范围，不能返回超范围数据。

### 6.1 `append`

直接批量新增记录。允许相同的 `aweme_id` 重复出现。

### 6.2 `upsert`

唯一作品键固定为：

```text
normalized(aweme_id)
```

要求：

- `aweme_id` 缺失、空白或无法读取时，该条记录不能参与更新匹配；建议记录为失败并跳过，避免错误合并。
- “作品 ID”为必选输出字段；后端仍必须读取原始作品 ID 完成去重。
- 若同一批抓取结果存在重复唯一键，保留最后一条或先在内存合并，禁止对同一记录产生不确定的并发更新。
- 读取目标表已有记录时，应使用实际映射后的“作品 ID”目标 field ID；映射到自定义列时也必须通过该映射读取。
- 没有显式映射时，按标准列名（含项目现有 legacy 名称）定位；找不到唯一键列时创建标准列后再写入，或明确失败。不得在没有可靠唯一键时悄悄退化为新增。
- 查询、创建、更新应按飞书 API 批量限制分批，并重试可恢复错误；任务级日志记录新增数、更新数、跳过数和失败原因。

推荐写入流程：

```text
抓取结果 -> 规范化 work_id -> 查询目标表已有唯一键
        -> 命中 record_id：更新映射后的字段
        -> 未命中：创建映射后的字段记录
```

## 7. 映射与自动建列的优先级

对每个 `selected_field_keys` 内的字段，按以下优先级解析目标列：

1. `field_mappings` 中相同 `source_key` 的 `target_field_id`。
2. 目标表中与标准字段名或 `legacyNames` 同名的兼容字段。
3. 新建名称为标准字段名的兼容字段。

显式映射的优先级最高。映射为空并不代表不写字段，只代表采用同名自动匹配。只有用户未选择的输出字段不参与正常写入；但 `upsert` 的唯一键字段例外，仍须读取或补齐。

`target_type = new` 不展示也不保存字段映射；创建新表时根据 `selected_field_keys` 建列，后续该表被选择为现有表时才允许保存表级配置。

## 8. 数据迁移与发布顺序

1. 执行 `social_table_output_configs` 建表迁移，`write_mode` 默认 `append`、映射默认 `[]`。
2. 扩展任务 `snapshot_json` 的反序列化兼容：旧任务仅有 `pages` 时转换为 `work_fetch_range`：`pages=0 -> {type:"all"}`，`pages>0 -> {type:"pages", value: pages}`。不必回写旧任务；旧快照中即使带有 `write_mode`/`field_mappings` 也忽略，统一以表级配置查询结果为准。
3. 发布表级配置 GET/PUT 接口和任务执行端的 `append`/`upsert`、映射解析能力。
4. 前端改版后，每次进入页面读取全部表级配置；选择现有表时应用对应配置并保存修改。创建、更新定时任务时只保存目标表 ID 和任务执行参数。
5. 灰度验证：新表、已存在同名列的表、映射到异名列的表、`append`、`upsert`、全部作品、最新 N 页、最近 N 个自然日、编辑旧任务。

推荐增加两类执行日志：

- 配置错误：目标表/字段不存在、字段类型不兼容、唯一键字段不可读。
- 写入统计：目标表、写入方式、新增数、更新数、跳过数、失败数。

## 9. 后端验收清单

- `scope`/`row_count` 与 `work_fetch_range` 分别生效：前者限制源表博主行，后者限制每个博主的作品。
- `work_fetch_range` 的 `all`、`pages(1-50)`、`days(1-365)` 三种模式均可执行；`days` 使用北京时间动态计算时间范围。
- 仅带旧 `pages` 的历史任务可兼容运行：`0` 转换为 `all`，正整数转换为 `pages`。
- 未配置表级设置时，GET 返回 `append + []`，不返回 404。
- 同一个 Base 的不同目标表有独立配置；不同 Base 的同一表名不会串配置。
- GET/PUT 使用 `target_table_id` 定位配置，表改名后仍能命中。
- 同一映射请求中重复来源字段或重复目标字段会被拒绝。
- 定时任务快照不保存 `write_mode`、`field_mappings`；执行时必定以 `plugin_type + base_id + target_table_id` 查询表级配置。
- `append` 始终新增；`upsert` 能在相同作品 ID 时更新而非新增。
- 显式映射优先于同名字段；空映射仍能自动同名写入或自动建列。
- 已删除的目标字段不会静默写错列，任务状态和日志能显示明确错误。
