# 博主作品获取 定时任务/即时执行 后端对接文档

## 1. 范围说明

本文档对应前端页面：`ProfileFetch.vue`
插件类型固定值：`profile_fetch`

覆盖能力：

- 即时执行博主作品获取
- 定时任务创建、编辑、删除、启停
- 定时任务列表查询
- 定时任务编辑回显所需字段

注意：
本页面和另外两个定时任务页的主要差异是 `pages` 字段，后端执行时不能漏用。

## 2. 鉴权

所有接口统一要求请求头：

```http
authorization: Bearer {api_key}
```

## 3. 即时执行接口

### 3.1 创建抓取任务

接口：

```http
POST /social/api/v1/feishu/social/task
```

请求体：

```json
{
  "url": "https://example.com/a\nhttps://example.com/b",
  "pages": 1
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `url` | string | 是 | 前端会把多个博主主页链接拼成换行分隔字符串，不传数组 |
| `pages` | number | 是 | 抓取页数，固定枚举：`0/1/5/10/20/30/50`，其中 `0` 表示全量获取 |

成功响应：

```json
{
  "sta": 0,
  "data": {
    "task_id": "task_xxx"
  }
}
```

失败响应：

```json
{
  "sta": 1,
  "msg": "错误信息"
}
```

注意点：

- 后端只需创建抓取任务并返回 `task_id`
- `targetTableId` 不会传给后端，写入哪个飞书表由前端完成
- 虽然前端已经做了链接非空校验，后端仍建议兜底校验
- `pages = 0` 不能当非法值

### 3.2 查询抓取任务状态

接口：

```http
GET /social/api/v1/feishu/social/task?task_id={task_id}
```

成功响应：

```json
{
  "sta": 0,
  "data": {
    "status": 0,
    "current_page": 3
  }
}
```

字段说明：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `status` | number | 前端当前只识别 `1=完成`、`2=失败`、其他值=执行中 |
| `current_page` | number | 可选，前端存在时显示“已获取第X页” |

注意点：

- 前端成功条件只有 `status == 1`
- 前端失败条件只有 `status == 2`
- 如果后端有更多状态码，至少兼容这套语义

### 3.3 获取抓取结果列表

接口：

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

成功响应：

```json
{
  "sta": 0,
  "data": {
    "count": 123,
    "data": [
      {
        "aweme_id": "xxx",
        "title": "标题",
        "tags": ["a", "b"],
        "user_id": "u1",
        "nickname": "作者",
        "profile_url": "https://...",
        "avatar": "https://...",
        "note_type": "video",
        "digg_count": 100,
        "comment_count": 2,
        "collect_count": 3,
        "share_count": 1,
        "social_type": "douyin",
        "share_url": "https://...",
        "play_url": "https://...",
        "cover_url": "https://...",
        "duration": 15,
        "create_time": 1720000000,
        "last_update_time": 1720000000,
        "ctime": 1720000000
      }
    ]
  }
}
```

字段说明：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `count` | number | 总记录数，前端据此继续翻页 |
| `data` | array | 当前页数据列表 |

注意点：

- 返回空数组时，前端会提示“获取数据异常”
- 字段名需和前端 `FIELD_MAPPING` 对齐
- 时间字段按秒级时间戳返回即可，前端会自行乘 `1000`

## 4. 定时任务接口总览

基础路径：

```http
/social/api/v1/feishu/schedule/tasks
```

当前前端用到的接口：

- `GET /social/api/v1/feishu/schedule/tasks`
- `POST /social/api/v1/feishu/schedule/tasks`
- `PUT /social/api/v1/feishu/schedule/tasks/{id}`
- `DELETE /social/api/v1/feishu/schedule/tasks/{id}`
- `POST /social/api/v1/feishu/schedule/tasks/{id}/toggle`

## 5. 定时任务创建/更新

### 5.1 创建任务

接口：

```http
POST /social/api/v1/feishu/schedule/tasks
```

### 5.2 更新任务

接口：

```http
PUT /social/api/v1/feishu/schedule/tasks/{id}
```

### 5.3 请求体结构

```json
{
  "plugin_type": "profile_fetch",
  "name": "社媒数据助手",
  "personal_base_token": "xxx",
  "base_id": "base_xxx",
  "schedule": {
    "trigger_date": "2026-07-30",
    "trigger_time": "19:00",
    "repeat_type": "custom",
    "freq_num": 1,
    "freq_unit": "day",
    "deadline_type": "date",
    "deadline_date": "2028-07-29",
    "enabled": true
  },
  "snapshot": {
    "plugin_type": "profile_fetch",
    "base_id": "base_xxx",
    "mode": "table",
    "target_type": "existing",
    "target_table_id": "tbl_xxx",
    "target_table_name": "结果表",
    "resolved_target_table_id": "tbl_xxx",
    "resolved_target_table_name": "结果表",
    "source_table_id": "tbl_src",
    "source_table_name": "源表",
    "source_view_id": "vew_xxx",
    "source_view_name": "默认视图",
    "profile_link_field_id": "fld_xxx",
    "profile_link_field_name": "主页链接",
    "scope": "n",
    "row_count": 5,
    "manual_urls": "",
    "pages": 1,
    "selected_field_keys": [
      "aweme_id",
      "title",
      "profile_url"
    ],
    "output_fields": [
      {
        "key": "aweme_id",
        "name": "视频编号",
        "type": 1
      }
    ]
  }
}
```

## 6. 请求字段说明

### 6.1 顶层字段

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `plugin_type` | string | 是 | 固定值：`profile_fetch` |
| `name` | string | 是 | 任务名称，前端当前传目标表名或默认名 |
| `personal_base_token` | string | 是 | 授权码 |
| `base_id` | string | 是 | 当前飞书 Base ID |
| `schedule` | object | 是 | 调度配置 |
| `snapshot` | object | 是 | 任务执行快照 |

### 6.2 `schedule` 字段

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `trigger_date` | string | 条件必填 | 触发日期，格式 `YYYY-MM-DD` |
| `trigger_time` | string | 是 | 触发时间，格式 `HH:mm` |
| `repeat_type` | string | 是 | 重复类型 |
| `freq_num` | number | 条件必填 | 自定义重复次数 |
| `freq_unit` | string | 条件必填 | 自定义重复单位 |
| `deadline_type` | string | 条件必填 | 自定义截止方式 |
| `deadline_date` | string | 条件必填 | 截止日期，格式 `YYYY-MM-DD` |
| `enabled` | boolean | 是 | 是否启用 |

`repeat_type` 可选值：

- `none`
- `hourly`
- `daily`
- `weekly`
- `monthly`
- `yearly`
- `workday`
- `custom`

兼容要求：

- 前端编辑回显时兼容 `once`，会自动映射成 `none`
- 建议后端统一落库为 `none`

特殊规则：

- 当 `repeat_type = hourly` 时，前端传 `trigger_date = ""`
- 当 `repeat_type != custom` 时，`freq_num/freq_unit/deadline_type/deadline_date` 可以为空或默认值
- 当 `repeat_type = custom` 且 `deadline_type = date` 时，`deadline_date` 必须有值

### 6.3 `snapshot` 字段

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `plugin_type` | string | 是 | 固定值 `profile_fetch` |
| `base_id` | string | 是 | Base ID |
| `mode` | string | 是 | 数据来源模式 |
| `target_type` | string | 是 | 目标表类型 |
| `target_table_id` | string | 否 | 现有目标表 ID |
| `target_table_name` | string | 否 | 现有目标表名称 |
| `resolved_target_table_id` | string | 否 | 解析后的最终目标表 ID |
| `resolved_target_table_name` | string | 是 | 解析后的最终目标表名称 |
| `source_table_id` | string | 否 | 源表 ID |
| `source_table_name` | string | 否 | 源表名称 |
| `source_view_id` | string | 否 | 源视图 ID |
| `source_view_name` | string | 否 | 源视图名称 |
| `profile_link_field_id` | string | 否 | 博主主页链接字段 ID |
| `profile_link_field_name` | string | 否 | 博主主页链接字段名称 |
| `scope` | string | 是 | 执行范围 |
| `row_count` | number | 否 | 当 `scope = n` 时使用 |
| `manual_urls` | string | 否 | 手动输入链接原文 |
| `pages` | number | 是 | 抓取页数 |
| `selected_field_keys` | string[] | 是 | 用户选择输出的字段 key |
| `output_fields` | object[] | 是 | 输出字段定义 |

`mode` 可选值：

- `table`
- `manual`

`target_type` 可选值：

- `new`
- `existing`

注意：
当前页面已经统一为这两个值，不再使用 `current`。

`scope` 可选值：

- `all`
- `selected`
- `n`

注意：
前端保存定时任务时禁止 `selected`，所以后端真正收到的定时任务快照通常只有：

- `all`
- `n`

## 7. 定时任务列表查询

接口：

```http
GET /social/api/v1/feishu/schedule/tasks?plugin_type=profile_fetch&base_id=base_xxx
```

查询参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `plugin_type` | string | 是 | 固定值 `profile_fetch` |
| `base_id` | string | 是 | 当前 Base ID |

前端兼容的成功响应结构：

形式 1：

```json
{
  "sta": 0,
  "data": [
    { "id": "task_1" }
  ]
}
```

形式 2：

```json
{
  "sta": 0,
  "data": {
    "list": [
      { "id": "task_1" }
    ]
  }
}
```

形式 3：

```json
{
  "sta": 0,
  "data": {
    "items": [
      { "id": "task_1" }
    ]
  }
}
```

## 8. 任务对象返回字段要求

前端编辑回显、列表展示依赖以下字段：

| 字段 | 类型 | 必需程度 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 必需 | 任务 ID |
| `name` | string | 建议 | 任务名称 |
| `plugin_type` | string | 建议 | 插件类型 |
| `base_id` | string | 建议 | Base ID |
| `personal_base_token` | string | 强烈建议 | 编辑回显直接用这个字段 |
| `enabled` | boolean | 建议 | 顶层启用状态 |
| `schedule` | object | 必需 | 调度配置 |
| `snapshot` | object | 强烈建议 | 编辑回显依赖完整快照 |

特别说明：

- 如果没有顶层 `enabled`，前端会回退读 `schedule.enabled`
- 如果 `snapshot` 不完整，编辑弹窗会丢字段或回退默认值
- 建议后端原样保存、原样返回前端提交的 `snapshot`

## 9. 删除任务

接口：

```http
DELETE /social/api/v1/feishu/schedule/tasks/{id}
```

请求体：

```json
{}
```

成功响应建议：

```json
{
  "sta": 0,
  "msg": "success",
  "data": {}
}
```

## 10. 启停任务

接口：

```http
POST /social/api/v1/feishu/schedule/tasks/{id}/toggle
```

请求体：

```json
{
  "enabled": true
}
```

推荐成功响应：

形式 1：

```json
{
  "sta": 0,
  "data": {
    "task": {
      "id": "task_xxx",
      "enabled": true,
      "schedule": {
        "enabled": true
      }
    }
  }
}
```

形式 2：

```json
{
  "sta": 0,
  "data": {
    "item": {
      "id": "task_xxx",
      "enabled": true,
      "schedule": {
        "enabled": true
      }
    }
  }
}
```

形式 3：

```json
{
  "sta": 0,
  "data": {
    "id": "task_xxx",
    "enabled": true,
    "schedule": {
      "enabled": true
    }
  }
}
```

注意点：

- 如果后端不返回任务对象，前端会只在本地补丁更新 `enabled` 和 `schedule.enabled`
- 最稳妥做法是返回完整任务对象

## 11. 后端执行任务时的业务还原规则

### 11.1 `mode = table`

后端应基于以下字段恢复抓取上下文：

- `source_table_id`
- `source_view_id`
- `profile_link_field_id`
- `scope`
- `row_count`

其中：

- `scope = all`：执行当前视图全部可见行
- `scope = n`：执行当前视图前 N 行

### 11.2 `mode = manual`

后端应直接解析：

- `manual_urls`

格式为多链接文本，可能包含：

- 换行
- 英文逗号 `,`
- 中文逗号 `，`

前端语义是拆分、去空、去重。

### 11.3 `target_type = new`

语义是“新建表格”。

注意：
当前即时执行场景里，真正建表和写表是前端完成的。
如果后端未来要真正执行定时任务并写表，需要自己定义：

- 是由后端直接建表并写入
- 还是只负责抓取数据，由其他写入层消费

### 11.4 `target_type = existing`

后端应使用：

- `target_table_id`
- 或 `resolved_target_table_id`

当前在 `existing` 场景下两者通常一致。

### 11.5 `pages`

这是本页面最关键的特殊字段，后端定时执行必须使用：

- `0` = 全量获取
- `1/5/10/20/30/50` = 获取前 N 页

## 12. 前端已做的校验，后端仍建议兜底

前端当前会拦截：

- `api_key` 为空
- `manual` 模式下链接为空
- `manual` 模式下拆分后无有效链接
- `table` 模式下未选字段
- `table` 模式下字段读取失败（`nodata`）
- `target_type = existing` 但未选表
- 未选择任何输出字段
- 定时任务未填授权码
- 定时任务未填触发时间
- 非 `hourly` 未填触发日期
- `custom + deadline_type = date` 未填截止日期
- 定时任务下 `scope = selected`

但后端仍建议全部兜底校验，避免脏数据入库。

## 13. 容易踩坑的点

### 13.1 即时执行接口传的是 `url` 字符串，不是数组

不要按 `urls` 数组解析。

### 13.2 `pages` 一定要参与执行逻辑

这是和另外两个页面最大的区别，容易漏。

### 13.3 定时任务编辑回显依赖完整 `snapshot`

尤其是这些字段：

- `mode`
- `target_type`
- `target_table_id`
- `profile_link_field_id`
- `scope`
- `row_count`
- `manual_urls`
- `pages`
- `selected_field_keys`
- `source_table_id`
- `source_view_id`

### 13.4 `personal_base_token` 在任务对象顶层

前端编辑任务时直接读取：

- `task.personal_base_token`

不要只把它放进 `snapshot`。

### 13.5 `repeat_type = hourly` 时没有 `trigger_date`

前端会传空字符串。

### 13.6 `selected_field_keys` 和 `output_fields` 都要保留

后端即使只执行时使用其中一份，也建议两份都原样保存并回传。

### 13.7 列表查询按 `plugin_type + base_id` 过滤

不要只按 `plugin_type` 返回全部任务。

## 14. 推荐统一响应格式

### 成功

```json
{
  "sta": 0,
  "msg": "success",
  "data": {}
}
```

### 失败

```json
{
  "sta": 1,
  "msg": "错误信息"
}
```

## 15. 推荐任务对象完整示例

```json
{
  "id": "task_profile_001",
  "name": "社媒数据助手",
  "plugin_type": "profile_fetch",
  "base_id": "base_xxx",
  "personal_base_token": "token_xxx",
  "enabled": true,
  "schedule": {
    "trigger_date": "2026-07-30",
    "trigger_time": "19:00",
    "repeat_type": "custom",
    "freq_num": 1,
    "freq_unit": "day",
    "deadline_type": "date",
    "deadline_date": "2028-07-29",
    "enabled": true
  },
  "snapshot": {
    "plugin_type": "profile_fetch",
    "base_id": "base_xxx",
    "mode": "table",
    "target_type": "existing",
    "target_table_id": "tbl_target_xxx",
    "target_table_name": "结果表",
    "resolved_target_table_id": "tbl_target_xxx",
    "resolved_target_table_name": "结果表",
    "source_table_id": "tbl_source_xxx",
    "source_table_name": "源表",
    "source_view_id": "vew_xxx",
    "source_view_name": "默认视图",
    "profile_link_field_id": "fld_xxx",
    "profile_link_field_name": "主页链接",
    "scope": "n",
    "row_count": 5,
    "manual_urls": "",
    "pages": 1,
    "selected_field_keys": [
      "aweme_id",
      "title",
      "profile_url"
    ],
    "output_fields": [
      {
        "key": "aweme_id",
        "name": "视频编号",
        "type": 1
      },
      {
        "key": "title",
        "name": "视频标题",
        "type": 1
      }
    ]
  }
}
```

## 16. 前端文件参考

- `src/components/ProfileFetch.vue`
- `src/composables/useSocialData.js`
