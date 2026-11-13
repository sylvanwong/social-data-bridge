# 评论列表获取：后端更新说明

## 结论

2026-11-13：聚合插件 `CommentFetch.vue` 新建评论任务已在前端源码接入 social-service，
复用既有 `feishuRequest`、`buildFeishuApiPath` 与 `VITE_FEISHU_API_BASE_URL`。
本轮未构建、未更新 `dist/`、未部署或进行真实飞书联调；独立评论助手、评论工作流仍使用旧接口。

新任务使用以下路径，主机地址从现有请求配置读取：

- `POST /socialdatax/api/v1/feishu/comment/task`：创建。
- `GET /socialdatax/api/v1/feishu/comment/task?task_id=<task_id>`：查询，携带 `supports_partial_results=1`。
- `POST /socialdatax/api/v1/feishu/comment/task/cancel`：请求停止。
- `POST /socialdatax/api/v1/feishu/comment/list`：按 `after_id` 游标读取，每批 20 条；只有确认 `status=3` 后才请求总数。

创建后将 `apiBaseUrl`、`apiPathPrefix` 与任务 ID、目标表、原输出字段、写入方式、映射一起持久化。
查询、取消和恢复写入均使用已存任务来源；没有来源字段的历史任务继续使用 `API_BASE_URL` 与 `/social/api`。
显式空主机表示同源、显式空前缀表示无前缀，不能用真值回退覆盖。提交成功后的本地保存失败仍补存同一任务，
不会重新创建。停止请求返回后继续等待终态并写完已有结果，失败或写入中断仍保留恢复进度。

采集参数和飞书写入契约保持兼容：

- 页面布局、单选框和输入框均为前端交互调整。
- 主评论范围仍通过 `pages` 传递。
- 子评论范围仍通过 `reply_pages` 传递。
- 评论排序仍通过 `sort_type` 传递。
- 输出字段选择由前端在飞书多维表格侧完成，当前不会发送到后端。
- 数据写入方式和字段映射会通过表格输出配置接口持久化，不随评论采集任务请求传递。

## 现有请求契约

接口：`POST /socialdatax/api/v1/feishu/comment/task`；无来源历史任务沿用旧服务 `/social/api` 前缀。

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
| `sort_type` | string | `default`、`time_descending`、`like_count_descending`、`oldest` | 沿用各平台排序支持范围；`oldest` 用于百度贴吧，不支持的排序由后端降级并返回 `sort_fallback_count` |

## 建议后端校验

虽然前端已限制输入范围，服务端仍建议进行参数校验，避免绕过页面调用导致异常任务：

```text
pages: 0 或 1 <= pages <= 50
reply_pages: -1、0 或 1 <= reply_pages <= 50
sort_type: default、time_descending、like_count_descending、oldest
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

- `GET /socialdatax/api/v1/feishu/profile-fetch/table-output-configs?plugin_type=comment_fetch&base_id=<base_id>`：读取配置。
- `PUT /socialdatax/api/v1/feishu/profile-fetch/table-output-config`：保存配置。

2026-11-13 起配置读写统一使用新服务，历史配置共用原三元键直接读取；这不改变旧评论任务按原来源恢复的规则。

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
