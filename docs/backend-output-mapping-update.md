# 热榜、视频文案、小红书下载、链接转附件：后端对接说明

## 结论

四个页面新增了“字段映射”配置，并复用既有表格输出配置接口持久化。业务数据获取、下载和附件转换接口均不需要增加参数或修改响应结构。

四页不提供“更新或新增”能力：当前输出数据没有稳定唯一键，前端对目标表始终执行新增记录。因此后端保存配置时，`write_mode` 固定为 `append`，该字段仅为复用统一配置表结构而保留。

## 涉及页面与配置标识

| 页面 | `plugin_type` | 可映射来源字段 |
| --- | --- | --- |
| 热榜获取 | `hot_list` | `rank`、`keyword`、`hot_value`、`tag`、`social_type` |
| 提取视频文案 | `video_copy_summary` | `summary`、`copywriting`、`platform` |
| 小红书下载 | `xhs_download` | `social_type`、`origin_cover_text`、`download_addr_text`、`origin_cover_attachment`、`download_addr_attachment` |
| 链接转附件 | `url_to_attachment` | `attachment` |

同一 `base_id`、同一 `plugin_type`、同一 `target_table_id` 对应一份配置。

## 配置读取

接口：

```http
GET /social/api/v1/feishu/profile-fetch/table-output-configs?plugin_type=<plugin_type>&base_id=<base_id>
Authorization: Bearer <api_key>
```

接口应返回该 Base 下对应插件的全部目标表配置。前端兼容以下响应格式：

```json
{
  "sta": 0,
  "data": [
    {
      "plugin_type": "hot_list",
      "base_id": "appxxxx",
      "target_table_id": "tblxxxx",
      "target_table_name": "热榜数据",
      "write_mode": "append",
      "field_mappings": []
    }
  ]
}
```

也可将数组放在 `data.list` 或 `data.items`。读取时至少应返回 `target_table_id`、`write_mode` 和 `field_mappings`。

## 配置保存

接口：

```http
PUT /social/api/v1/feishu/profile-fetch/table-output-config
Authorization: Bearer <api_key>
Content-Type: application/json
```

请求体示例：

```json
{
  "plugin_type": "video_copy_summary",
  "base_id": "appxxxx",
  "target_table_id": "tblxxxx",
  "target_table_name": "视频文案结果",
  "write_mode": "append",
  "field_mappings": [
    {
      "source_key": "copywriting",
      "source_name": "文案",
      "target_field_id": "fldxxxx",
      "target_field_name": "正文"
    }
  ]
}
```

字段说明：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `plugin_type` | 是 | 必须是上表列出的四个值之一。 |
| `base_id` | 是 | 多维表格 Base ID。 |
| `target_table_id` | 是 | 用户选择的现有目标表 ID。 |
| `target_table_name` | 是 | 保存时的目标表名称，用于后台展示和排查。 |
| `write_mode` | 是 | 固定接收 `append`。建议保留兼容字段，勿擅自转为 `upsert`。 |
| `field_mappings` | 是 | 映射数组；无自定义映射时传空数组。 |
| `field_mappings[].source_key` | 是 | 上表中该页面允许的来源字段键。 |
| `field_mappings[].source_name` | 是 | 前端展示名称，仅用于可读性和兼容。 |
| `field_mappings[].target_field_id` | 是 | 飞书目标字段 ID，前端写入时实际使用该值。 |
| `field_mappings[].target_field_name` | 是 | 保存时的目标字段名称，用于展示和排查。 |

保存应按 `(plugin_type, base_id, target_table_id)` 做 upsert：已有配置覆盖 `write_mode` 与 `field_mappings`，不存在则新建。重复保存同一请求应幂等。

## 后端校验与存储建议

1. 校验 `plugin_type` 白名单，避免任意插件类型写入配置表。
2. 校验 `write_mode` 为 `append`；可暂时兼容历史 `upsert` 数据，但返回和后续保存不应影响前端的新增写入行为。
3. `field_mappings` 必须为数组；过滤或拒绝缺少 `source_key`、`target_field_id` 的条目。
4. 依据 `plugin_type` 校验 `source_key` 属于对应页面的允许集合。
5. 建议对 `(plugin_type, base_id, target_table_id)` 建立唯一索引。
6. 不需要由后端校验 `target_field_id` 是否仍存在。前端在用户选择目标表时从飞书 SDK 读取实时字段；字段被删除时前端会按现有异常处理提示用户。

## 业务接口不变

以下接口不需要接收 `field_mappings` 或 `write_mode`：

- `GET /social/api/v1/feishu/hot/list`
- `POST /social/api/v1/feishu/media/task`
- `POST /social/api/v1/feishu/media/task/get`
- 小红书下载相关任务和下载代理接口
- `POST /social/api/v1/feishu/attch`

字段映射由前端使用飞书多维表格 SDK 完成：映射字段优先写入指定 `target_field_id`；未映射时按同名字段写入或创建同名字段。

## 验收清单

- 四个 `plugin_type` 均可按 Base 和目标表读取各自配置，互不串扰。
- 首次保存能创建配置；再次保存相同三元组能覆盖旧映射。
- `field_mappings: []` 能清空自定义映射。
- 不同目标表的配置可分别保存和回填。
- 返回的映射中的 `source_key`、`target_field_id` 能原样回传给前端。
- 四个页面业务接口在未传映射配置时行为不变。
