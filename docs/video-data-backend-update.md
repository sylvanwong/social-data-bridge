# 作品详情获取：后端对接文档

## 1. 变更范围

页面：`VideoDataFetch.vue`，插件类型固定为 `video_data`。

作品详情获取支持两种输入模式：

1. `mode=table`：从当前表格读取视频链接，结果默认回写当前表格原记录。
2. `mode=manual`：手动输入一个或多个视频链接，结果写入新建表格或指定现有表格。

两种模式均支持选择输出字段。手动输入模式支持选择目标表、写入方式和字段映射；从表格选取模式也支持对当前表格配置字段映射。

所有接口沿用鉴权：

```http
authorization: Bearer {api_key}
```

请求由现有 axios 拦截器附加 `version` 参数。

## 2. 作品详情接口

前端逐条调用：

```http
POST /social/api/v1/feishu/social_info
```

请求体：

```json
{
  "url": "https://example.com/video/xxx",
  "raw_value": "https://example.com/video/xxx",
  "source": "feishu_bitable_video_fetch"
}
```

成功响应必须使用统一结构：

```json
{
  "sta": 0,
  "data": {
    "social_type": "douyin",
    "social_id": "作品ID",
    "title": "作品标题"
  }
}
```

失败时返回 `sta != 0` 以及 `msg` 或 `message`。失败信息在 `mode=table` 时会写入当前记录的第一个输出字段，因此错误信息应面向用户且避免泄露密钥。

## 3. 表级输出配置

字段映射和写入方式按目标表保存，唯一键为：

```text
plugin_type + base_id + target_table_id
```

接口路径复用作者详情配置接口，但 `plugin_type` 必须为 `video_data`，不能使用 `profile_fetch` 或 `blogger_info`。

### 3.1 查询全部配置

```http
GET /social/api/v1/feishu/profile-fetch/table-output-configs
  ?plugin_type=video_data&base_id={base_id}
```

返回 `data` 数组，或 `{ "list": [] }` / `{ "items": [] }`。无配置返回空列表，不返回 404：

```json
{
  "sta": 0,
  "data": {
    "list": [
      {
        "plugin_type": "video_data",
        "base_id": "base_xxx",
        "target_table_id": "tbl_xxx",
        "target_table_name": "作品详情",
        "write_mode": "upsert",
        "field_mappings": [
          {
            "source_key": "title",
            "source_name": "标题",
            "target_field_id": "fld_xxx",
            "target_field_name": "作品标题",
            "target_field_type": 1
          }
        ]
      }
    ]
  }
}
```

### 3.2 保存配置

```http
PUT /social/api/v1/feishu/profile-fetch/table-output-config
```

请求体：

```json
{
  "plugin_type": "video_data",
  "base_id": "base_xxx",
  "target_table_id": "tbl_xxx",
  "target_table_name": "作品详情",
  "write_mode": "upsert",
  "field_mappings": [
    {
      "source_key": "social_id",
      "source_name": "作品ID",
      "target_field_id": "fld_xxx",
      "target_field_name": "视频编号",
      "target_field_type": 1
    }
  ]
}
```

保存为指定目标表的一条配置，全量覆盖该表原配置。`write_mode` 仅允许 `append`、`upsert`，缺省为 `append`；`field_mappings` 缺省为 `[]`。名称和类型字段仅用于回显，执行时以后端校验后的 `source_key`、`target_field_id` 为准。

### 3.3 校验要求

- `plugin_type` 必须为 `video_data`。
- `base_id`、`target_table_id` 必填。
- 映射项的 `source_key`、`target_field_id` 必填，且不得重复。
- `target_field_id` 必须属于目标表；字段被删除时应返回明确错误。
- 映射后的目标字段类型必须兼容作品字段类型。`作者名称`、`平台`允许文本或单选；`标签`允许文本或多选；其余字段按字段定义校验。

## 4. 定时任务协议

任务接口路径不变：

```http
GET    /social/api/v1/feishu/schedule/tasks?plugin_type=video_data&base_id={base_id}
POST   /social/api/v1/feishu/schedule/tasks
PUT    /social/api/v1/feishu/schedule/tasks/{id}
DELETE /social/api/v1/feishu/schedule/tasks/{id}
POST   /social/api/v1/feishu/schedule/tasks/{id}/toggle
```

创建/更新请求的 `snapshot` 至少包含：

```json
{
  "plugin_type": "video_data",
  "base_id": "base_xxx",
  "mode": "table",
  "target_type": "current",
  "target_table_id": "",
  "target_table_name": "",
  "resolved_target_table_id": "tbl_source_xxx",
  "resolved_target_table_name": "视频链接表",
  "source_table_id": "tbl_source_xxx",
  "source_table_name": "视频链接表",
  "source_view_id": "vew_xxx",
  "source_view_name": "默认视图",
  "video_link_field_id": "fld_url",
  "video_link_field_name": "视频链接",
  "scope": "all",
  "row_count": 5,
  "manual_urls": "",
  "selected_field_keys": ["social_id", "title"]
}
```

`mode=manual` 时，`manual_urls` 保存输入文本；`target_type` 为 `new` 或 `existing`。使用现有表格时必须保存 `target_table_id`；新建表格时 `resolved_target_table_id` 初始可为空，首次执行创建后应持久化实际表 ID，避免每次调度重复建表。

`write_mode`、`field_mappings` 不属于任务快照。创建或更新任务时，前端先将现有目标表的最新输出配置保存到表级配置接口；编辑任务时根据 `target_table_id`（`target_type=current` 使用 `resolved_target_table_id`）重新读取配置并回显。调度执行也必须按目标表读取最新配置，未配置时使用 `append + []`。

## 5. 后端写入规则

### 5.1 从表格选取

- 按 `scope` 读取所有行、选中行或前 N 行。
- 每个视频详情成功后，按原 `recordId` 更新源表，不新增记录。
- 显式映射优先于同名字段；无映射时按字段名称匹配，不存在时创建同名字段。

### 5.2 手动输入

- `target_type=existing` 写入 `target_table_id`。
- `target_type=new` 创建“作品详情获取”目标表，并保存创建后的表 ID。
- `append` 始终新增记录。
- `upsert` 使用 `social_type + social_id` 作为固定唯一键；命中则更新，未命中则新增。任一键字段为空时按新增处理并记录 warning。
- 查重必须使用原始字段 key，不得使用映射后的列名替代 `social_type` 或 `social_id`。

## 6. 作品字段 key

```text
nickname, uid, user_id, profile_url, avatar, social_type, ip_location,
social_id, note_type, title, content, caption, duration, view_count,
digg_count, comment_count, collect_count, share_count, note_url,
origin_cover, origin_cover_attachment, download_addr, t_create,
update_time, ctime
```

字段类型以 `VideoDataFetch.vue` 的 `FIELD_CONFIG` 为准：文本、数字、多选、日期时间、链接和附件。`origin_cover_attachment` 由 `origin_cover` 下载后写入附件字段。

## 7. 验收重点

- `plugin_type=video_data` 的配置与作者信息、作者作品配置相互隔离。
- 切换目标表后能读取对应的 `write_mode` 和 `field_mappings`，不会沿用其他表配置。
- 从表格选取映射后更新原记录，不新增记录。
- 手动输入现有表格可按映射写入不同名称的目标列。
- `social_type + social_id` 相同的作品重复执行只更新，不产生重复记录。
- 定时任务编辑后映射和写入方式仍能正确回显。
- 手动输入新建表的定时任务不会反复创建新表。
