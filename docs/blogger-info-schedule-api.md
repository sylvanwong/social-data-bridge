# 博主信息定时任务对接说明

## 目标

前端“博主信息获取”页面已接入定时任务管理：

- 新建任务
- 编辑任务
- 删除任务
- 启用/停用任务
- 按 `base_id + plugin_type` 拉取任务列表

前端不执行定时任务。实际调度和执行由后端 API + Celery 完成。

## 任务范围

当前文档仅对应：

- `plugin_type = "blogger_info"`

## 关键约定

### 1. `target_type = current` 的处理

前端保存任务时，若当前配置是“写回当前表格”，不会把 `current` 这个抽象概念直接丢给后端，而是先解析成明确表格 ID：

- `snapshot.target_type` 仍保留原始值 `current`
- 同时额外传：
  - `snapshot.resolved_target_table_id`
  - `snapshot.resolved_target_table_name`

后端执行任务时，应优先使用：

- `snapshot.resolved_target_table_id`

不要依赖 `target_type=current` 去推断“当前表格”，因为 Celery 执行时没有前端页面上下文。

### 2. 表格模式的源表信息

当任务来源于“从表格选取”模式时，前端会一并上传：

- `snapshot.source_table_id`
- `snapshot.source_table_name`
- `snapshot.source_view_id`
- `snapshot.source_view_name`
- `snapshot.profile_link_field_id`
- `snapshot.profile_link_field_name`

后端执行时应基于这些字段读取源数据。

### 3. 不支持“执行选中行”

前端已限制定时任务不允许保存 `scope = selected`。

原因：

- 选中行是前端交互态
- Celery 执行时没有“当前选中行”的概念

后端可以默认认为：

- 定时任务表格模式只会出现 `scope = all` 或 `scope = n`

## API 约定

统一前缀：

- `/social/api/v1/feishu/schedule/tasks`

统一鉴权：

- `Authorization: Bearer {api_key}`

统一成功结构建议：

```json
{
  "sta": 0,
  "msg": "ok",
  "data": {}
}
```

统一失败结构建议：

```json
{
  "sta": 1,
  "msg": "错误信息"
}
```

## 1. 获取任务列表

### 请求

`GET /social/api/v1/feishu/schedule/tasks`

### Query

```json
{
  "plugin_type": "blogger_info",
  "base_id": "bascnxxxx"
}
```

### 返回

`data` 支持两种格式，前端都兼容：

```json
{
  "sta": 0,
  "data": [
    {
      "id": 101,
      "name": "博主信息-每日同步",
      "plugin_type": "blogger_info",
      "base_id": "bascnxxxx",
      "personal_base_token": "pt-xxxx",
      "enabled": true,
      "schedule": {
        "trigger_date": "2026-07-15",
        "trigger_time": "09:00",
        "repeat_type": "daily",
        "freq_num": 1,
        "freq_unit": "",
        "deadline_type": "",
        "deadline_date": "",
        "enabled": true
      },
      "snapshot": {
        "plugin_type": "blogger_info",
        "base_id": "bascnxxxx",
        "mode": "table",
        "target_type": "current",
        "target_table_id": "",
        "target_table_name": "",
        "resolved_target_table_id": "tblxxxx",
        "resolved_target_table_name": "博主信息汇总",
        "source_table_id": "tblxxxx",
        "source_table_name": "博主信息汇总",
        "source_view_id": "vewxxxx",
        "source_view_name": "默认视图",
        "profile_link_field_id": "fldxxxx",
        "profile_link_field_name": "博主主页链接",
        "scope": "n",
        "row_count": 5,
        "manual_urls": "",
        "selected_field_keys": ["uid", "nickname", "follower_count"],
        "output_fields": [
          { "key": "uid", "name": "用户ID", "type": 1 }
        ]
      }
    }
  ]
}
```

或者：

```json
{
  "sta": 0,
  "data": {
    "list": []
  }
}
```

## 2. 创建任务

### 请求

`POST /social/api/v1/feishu/schedule/tasks`

### Body

```json
{
  "plugin_type": "blogger_info",
  "name": "博主信息-每日同步",
  "personal_base_token": "pt-xxxx",
  "base_id": "bascnxxxx",
  "schedule": {
    "trigger_date": "2026-07-15",
    "trigger_time": "09:00",
    "repeat_type": "daily",
    "freq_num": 1,
    "freq_unit": "",
    "deadline_type": "",
    "deadline_date": "",
    "enabled": true
  },
  "snapshot": {
    "plugin_type": "blogger_info",
    "base_id": "bascnxxxx",
    "mode": "table",
    "target_type": "current",
    "target_table_id": "",
    "target_table_name": "",
    "resolved_target_table_id": "tblxxxx",
    "resolved_target_table_name": "博主信息汇总",
    "source_table_id": "tblxxxx",
    "source_table_name": "博主信息汇总",
    "source_view_id": "vewxxxx",
    "source_view_name": "默认视图",
    "profile_link_field_id": "fldxxxx",
    "profile_link_field_name": "博主主页链接",
    "scope": "n",
    "row_count": 5,
    "manual_urls": "",
    "selected_field_keys": ["uid", "nickname", "follower_count"],
    "output_fields": [
      { "key": "uid", "name": "用户ID", "type": 1 }
    ]
  }
}
```

### 说明

- `personal_base_token` 由前端录入并传给后端
- `base_id` 与 `snapshot.base_id` 一致
- 后端落库时建议单独保存：
  - `plugin_type`
  - `base_id`
  - `enabled`
  - `personal_base_token`
  - `schedule_json`
  - `snapshot_json`

## 3. 更新任务

### 请求

`PUT /social/api/v1/feishu/schedule/tasks/{id}`

### Body

与创建任务一致。

## 4. 删除任务

### 请求

`DELETE /social/api/v1/feishu/schedule/tasks/{id}`

### Body

前端会带一个空对象：

```json
{}
```

## 5. 启用/停用任务

### 请求

`POST /social/api/v1/feishu/schedule/tasks/{id}/toggle`

### Body

```json
{
  "enabled": true
}
```

## 后端执行建议

## 1. 执行入口

Celery 到点后：

1. 读取任务
2. 校验 `plugin_type == "blogger_info"`
3. 读取 `personal_base_token`
4. 读取 `snapshot`
5. 读取源表 / 目标表配置
6. 调业务接口获取博主信息
7. 使用飞书 SDK 写入 Base

## 2. 写入目标表

优先使用：

- `snapshot.resolved_target_table_id`

场景说明：

- `target_type = current`
  - 实际写入 `resolved_target_table_id`
- `target_type = existing`
  - `resolved_target_table_id` 与 `target_table_id` 应一致
- `target_type = new`
  - 前端不会提前创建表
  - 后端首次执行时负责创建表
  - 建议创建成功后把最终 `resolved_target_table_id` 回写任务

## 3. 读取源数据

当 `snapshot.mode = table` 时：

- 从 `snapshot.source_table_id` 读数据
- 如果后端支持“按视图取可见记录”，则结合 `snapshot.source_view_id`
- `scope = all`
  - 读取视图内全部可见记录
- `scope = n`
  - 读取前 `snapshot.row_count` 条

当 `snapshot.mode = manual` 时：

- 从 `snapshot.manual_urls` 解析链接

## 4. 字段映射

前端会传：

- `snapshot.selected_field_keys`
- `snapshot.output_fields`

后端可以据此决定需要写哪些字段。

如果后端要做字段自动补齐，建议用 `output_fields[].name` 作为表头名。

## 飞书 SDK 参考

后端可参考下面的调用方式：

```python
from baseopensdk import BaseClient

client = (
    BaseClient.builder()
    .app_token(APP_TOKEN)
    .personal_base_token(PERSONAL_BASE_TOKEN)
    .build()
)
```

批量写记录时：

```python
request = (
    BatchCreateAppTableRecordRequest.builder()
    .app_token(APP_TOKEN)
    .table_id(TABLE_ID)
    .request_body(
        BatchCreateAppTableRecordRequestBody.builder()
        .records(records)
        .build()
    )
    .build()
)
```

## 建议的数据库字段

- `id`
- `plugin_type`
- `name`
- `base_id`
- `personal_base_token`
- `enabled`
- `schedule_json`
- `snapshot_json`
- `last_run_at`
- `last_run_status`
- `last_run_message`
- `created_at`
- `updated_at`

## 前端文件位置

当前前端实现位于：

- [BloggerInfoFetch.vue](/usr/local/var/www/social-data-bridge/src/components/BloggerInfoFetch.vue:1)
