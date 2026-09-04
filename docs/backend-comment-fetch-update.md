# 评论列表获取：后端更新说明

## 结论

本次评论列表页面改版没有引入必须的后端接口变更。现有评论采集任务接口仍可直接兼容，原因如下：

- 页面布局、单选框和输入框均为前端交互调整。
- 主评论范围仍通过 `pages` 传递。
- 子评论范围仍通过 `reply_pages` 传递。
- 评论排序仍通过 `sort_type` 传递。
- 输出字段选择由前端在飞书多维表格侧完成，当前不会发送到后端。
- 数据写入方式和字段映射会通过表格输出配置接口持久化，不随评论采集任务请求传递。

## 现有请求契约

接口：`POST /social/api/v1/feishu/comment/task`

请求头：

```http
Authorization: Bearer <api_key>
Content-Type: application/json
```

请求体示例：

```json
{
  "url": "https://example.com/note/xxx",
  "pages": 5,
  "reply_pages": -1,
  "sort_type": "default"
}
```

字段说明：

| 字段 | 类型 | 取值 | 说明 |
| --- | --- | --- | --- |
| `url` | string | 一个或多个链接，以换行分隔 | 待采集作品链接 |
| `pages` | integer | `0` 或 `1-50` | `0` 表示全部主评论；正整数表示前 N 页 |
| `reply_pages` | integer | `-1`、`0` 或 `1-50` | `-1` 不获取子评论；`0` 获取全部子评论；正整数表示前 N 页 |
| `sort_type` | string | `default`、`time_descending`、`like_count_descending` | 小红书评论排序；其他平台按现有逻辑处理 |

## 建议后端校验

虽然前端已限制输入范围，服务端仍建议进行参数校验，避免绕过页面调用导致异常任务：

```text
pages: 0 或 1 <= pages <= 50
reply_pages: -1、0 或 1 <= reply_pages <= 50
sort_type: default、time_descending、like_count_descending
```

非法值建议返回 HTTP 400，并提供可读错误信息；不要将 `reply_pages = -1` 误处理为前 1 页。

## 字段映射说明

当前字段映射不需要后端改动：

1. 前端读取用户选择的目标表字段。
2. 前端根据“来源字段 → 目标字段”直接创建飞书单元格并写入。
3. 未配置映射时沿用同名字段匹配；目标字段不存在时按现有逻辑自动创建。

因此，后端评论任务结果只需继续返回原有评论字段，至少包括前端字段配置中使用的字段（如 `cid`、`reply_id`、`note_id`、`text`、`nickname` 等）。

## 数据写入方式说明

“更新或新增”与“始终新增”仅影响前端写入已存在表格的动作：

- `upsert`：以前端字段“评论ID”（`cid`）为唯一键，已有评论更新，未找到的评论新增。
- `append`：所有结果直接新增为记录。

新建表格时会创建全新表，不存在历史记录，两个选项的结果一致。该逻辑不改变评论任务接口，也不要求后端新增参数。

## 表格输出配置持久化

评论页复用“获取作者作品”的表格输出配置接口：

- `GET /social/api/v1/feishu/profile-fetch/table-output-configs?plugin_type=comment_fetch&base_id=<base_id>`：读取配置。
- `PUT /social/api/v1/feishu/profile-fetch/table-output-config`：保存配置。

请求体字段结构如下：

```json
{
  "plugin_type": "comment_fetch",
  "base_id": "<base_id>",
  "target_table_id": "<table_id>",
  "write_mode": "append",
  "field_mappings": [
    {
      "source_key": "text",
      "source_name": "评论内容",
      "target_field_id": "fldxxxx",
      "target_field_name": "正文"
    }
  ]
}
```

评论任务接口不需要增加 `write_mode` 或 `field_mappings` 参数；后端只需保证上述配置接口支持 `plugin_type=comment_fetch`。

## 验收清单

- `pages=0` 能获取全部主评论。
- `pages=1`、`pages=5` 等正整数能按页数限制主评论。
- `reply_pages=-1` 不请求或不返回子评论。
- `reply_pages=0` 能获取全部子评论。
- `reply_pages=1`、`reply_pages=5` 等正整数能按页数限制子评论。
- `sort_type` 三种现有值行为不变。
- 任务状态查询 `GET /social/api/v1/feishu/comment/task?task_id=...` 和结果分页接口保持兼容。
