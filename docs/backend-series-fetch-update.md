# 博主短剧获取：后端对接更新说明

## 1. 结论

本次 `SeriesFetch.vue` 改版涉及以下后端对接项：

1. 短剧采集任务接口只需支持现有的博主链接和作品页数参数。
2. 表级输出配置接口需要支持 `plugin_type=series_fetch`，用于保存每张目标表的写入方式和字段映射。
3. 后端任务结果接口、任务状态接口需要保持现有返回结构不变。
4. 如果写入逻辑由后端定时任务执行，则需要实现短剧 ID 的更新或新增（upsert）以及字段映射；即时执行当前由前端直接写入飞书表格。

页面仍使用现有鉴权方式：

```http
Authorization: Bearer <api_key>
```

## 2. 短剧采集任务接口

### 2.1 创建任务

```http
POST /social/api/v1/feishu/series/list
```

当前前端请求体：

```json
{
  "profile_url": "https://www.douyin.com/user/xxx",
  "pages": 5
}
```

字段说明：

| 字段 | 类型 | 取值 | 说明 |
| --- | --- | --- | --- |
| `profile_url` | string | 一个或多个链接，以换行分隔 | 待采集的博主主页链接。 |
| `pages` | integer | `0` 或 `1-50` | `0` 表示全部作品；正整数表示获取前 N 页。 |

`pages` 是当前页面实际使用的作品范围协议，不要与“输入行范围”混淆：输入行范围只决定从源表读取哪些博主链接。

### 2.2 兼容要求

- 旧请求只带 `profile_url`、`pages` 时必须继续可用。
- `pages=0` 必须表示全部作品，不能误处理成 0 页或 1 页。
- 服务端仍需校验 `pages`，建议只允许 `0` 或 `1 <= pages <= 50`，非法值返回 HTTP 400。
- `write_mode`、`field_mappings` 不传入此采集接口；它们通过表级输出配置接口保存，并由前端结果写入逻辑使用。

## 3. 任务状态和结果接口

页面轮询：

```http
GET /social/api/v1/feishu/series/list?task_id=<task_id>
```

状态响应需继续提供：

```json
{
  "sta": 0,
  "data": {
    "status": 0,
    "current_page": 2
  }
}
```

页面完成后分页读取结果：

```http
POST /social/api/v1/feishu/post/list
```

请求体：

```json
{
  "task_id": "task_xxx",
  "page": 1,
  "page_size": 20
}
```

结果响应需继续提供 `count` 和 `data`：

```json
{
  "sta": 0,
  "data": {
    "count": 120,
    "data": [
      {
        "series_id": "123",
        "title": "短剧标题",
        "cover_url": "https://example.com/cover.jpg",
        "play_count": 1000,
        "total_episode_count": 24,
        "updated_episode_count": 12,
        "description": "剧情简介",
        "nickname": "作者名",
        "user_id": "author_xxx",
        "social_type": "抖音",
        "share_url": "https://example.com/series/123",
        "create_time": 1710000000
      }
    ]
  }
}
```

后端至少应稳定返回前端字段配置中使用的字段，尤其是 `series_id`。`create_time` 当前按秒级 Unix 时间戳返回，前端会转换为飞书日期时间。

## 4. 表级输出配置（必须支持）

短剧页面复用表格输出配置接口，但插件类型固定为：

```text
plugin_type = series_fetch
```

唯一键：

```text
plugin_type + base_id + target_table_id
```

### 4.1 查询配置

```http
GET /social/api/v1/feishu/profile-fetch/table-output-configs
  ?plugin_type=series_fetch&base_id=<base_id>
```

无配置时返回空列表，不返回 404：

```json
{
  "sta": 0,
  "data": { "list": [] }
}
```

### 4.2 保存配置

```http
PUT /social/api/v1/feishu/profile-fetch/table-output-config
```

请求示例：

```json
{
  "plugin_type": "series_fetch",
  "base_id": "base_xxx",
  "target_table_id": "tbl_xxx",
  "target_table_name": "博主短剧获取",
  "write_mode": "upsert",
  "field_mappings": [
    {
      "source_key": "title",
      "source_name": "短剧名",
      "target_field_id": "fld_title",
      "target_field_name": "作品标题",
      "target_field_type": 1
    }
  ]
}
```

后端保存时应按唯一键全量覆盖一条配置，并返回保存后的完整配置。`source_name`、`target_field_name`、`target_field_type` 仅用于回显，实际执行应信任 `source_key` 和 `target_field_id`。

### 4.3 参数校验

- `plugin_type` 必须为 `series_fetch`。
- `base_id`、`target_table_id` 必填。
- `write_mode` 仅允许 `append`、`upsert`，缺省按 `append`。
- 映射项的 `source_key`、`target_field_id` 必填，来源字段和目标字段均不得重复。
- `source_key` 必须属于本文第 5 节的短剧字段集合。
- 目标表或目标字段不存在、字段类型不兼容时，应返回明确错误；不能静默写入其他字段。

## 5. 短剧字段 key

当前前端 `FIELD_MAPPING`：

| key | 默认名称 | 类型 | 备注 |
| --- | --- | --- | --- |
| `series_id` | 短剧ID | 文本 | 必选；upsert 唯一键。 |
| `title` | 短剧名 | 文本 |  |
| `cover_url` | 封面 | 文本 |  |
| `play_count` | 播放数 | 数字 | 整数格式。 |
| `total_episode_count` | 总集数 | 数字 | 整数格式。 |
| `updated_episode_count` | 最新集数 | 数字 | 整数格式。 |
| `description` | 剧情简介 | 文本 |  |
| `nickname` | 作者名 | 文本/单选 | 允许文本或单选目标列。 |
| `user_id` | 作者ID | 文本 |  |
| `social_type` | 平台 | 文本/单选 | 允许文本或单选目标列。 |
| `share_url` | 短剧链接 | 文本 |  |
| `create_time` | 发布时间 | 日期时间 | 秒级时间戳。 |

## 6. 写入方式与字段映射规则

### 6.1 `append`

所有抓取结果直接新增记录，允许同一个 `series_id` 重复出现。

### 6.2 `upsert`

唯一键固定为：

```text
normalized(series_id)
```

- `series_id` 非空且命中已有记录：更新该记录。
- `series_id` 非空但未命中：新增记录。
- `series_id` 为空或无法读取：不能参与匹配，建议跳过并记录失败原因，不得随机合并。
- 同一批结果出现重复 ID 时，需先去重或明确采用最后一条，不能对同一记录产生不确定更新。
- 即使用户取消勾选，upsert 仍必须确保能读取“短剧ID”作为唯一键。

字段解析优先级：

1. `field_mappings` 中同一 `source_key` 指定的 `target_field_id`。
2. 目标表中与标准字段名同名且类型兼容的字段。
3. 创建标准名称的新字段（如使用现有表且当前逻辑允许自动补列）。

## 7. 即时执行与定时任务边界

当前即时执行流程由前端完成飞书表格写入：

```text
后端抓取任务 -> 前端读取分页结果 -> 前端按 write_mode / field_mappings 写入飞书表格
```

因此后端不需要在即时任务接口中执行表格写入，但必须保证任务结果字段完整。

如果后续将短剧获取接入定时任务，建议：

- 任务快照保存 `profile_url` 来源、`scope`、`row_count`、`pages`、目标表 ID 等执行参数。
- `write_mode`、`field_mappings` 以表级配置为准，调度执行时按 `series_fetch + base_id + target_table_id` 查询最新配置。
- 历史任务缺少写入配置时，默认 `append + []`。

## 8. 后端验收清单

- `pages=0` 获取全部作品；`pages=1`、`pages=5` 按页数限制结果。
- 任务创建接口仅接收 `profile_url`、`pages`，输出配置变化不影响采集任务契约。
- 结果分页接口持续返回 `count`、`data`，且字段 key 与第 5 节一致。
- `plugin_type=series_fetch` 的表级配置可以按 Base 和目标表独立保存、读取。
- 配置不存在时返回空列表或默认 `append + []`，不返回 404。
- 显式字段映射优先于同名字段；重复来源或目标字段映射被拒绝。
- `upsert` 使用 `series_id` 查重，不能使用映射后的字段名称替代原始 key。
- 目标表、目标字段或字段类型错误时返回可定位的错误信息。
