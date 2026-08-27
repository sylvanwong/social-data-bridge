# 博主信息获取改版：后端更新文档

## 1. 变更范围

页面：`BloggerInfoFetch.vue`，插件类型固定为 `blogger_info`。

本次只涉及三项后端变更：

1. 手动输入模式新增“新建表格 / 使用现有表格”。
2. 手动输入写入现有表时新增“始终新增 / 更新或新增”和字段映射。
3. 定时任务的手动输入模式需要保存并执行上述输出配置。

“从表格选取”保持原有行为：抓取结果回写源表的对应原始行，只配置输出字段；不使用目标表、写入方式或字段映射。

作者信息接口、定时任务 CRUD、调度时间和源表读取协议继续沿用现有协议。

## 2. 新增表级配置

复用作者作品的表配置接口，但使用不同的插件类型隔离：

```text
plugin_type = blogger_info
```

唯一键：

```text
plugin_type + base_id + target_table_id
```

配置字段：

| 字段 | 取值/类型 | 说明 |
| --- | --- | --- |
| `plugin_type` | `blogger_info` | 固定值 |
| `base_id` | string | 飞书 Base ID |
| `target_table_id` | string | 目标表 ID |
| `target_table_name` | string | 仅用于回显 |
| `write_mode` | `append` / `upsert` | 缺省为 `append` |
| `field_mappings` | array | 缺省为 `[]` |

### 2.1 查询

```http
GET /social/api/v1/feishu/profile-fetch/table-output-configs
  ?plugin_type=blogger_info&base_id={base_id}
```

返回结构沿用作者作品接口，`data` 可为数组，也可为 `{ list: [] }` 或 `{ items: [] }`。

无配置时返回空列表，不返回 404。

### 2.2 保存

```http
PUT /social/api/v1/feishu/profile-fetch/table-output-config
```

请求示例：

```json
{
  "plugin_type": "blogger_info",
  "base_id": "base_xxx",
  "target_table_id": "tbl_xxx",
  "target_table_name": "博主信息",
  "write_mode": "upsert",
  "field_mappings": [
    {
      "source_key": "nickname",
      "source_name": "作者名称",
      "target_field_id": "fld_xxx",
      "target_field_name": "作者",
      "target_field_type": 1
    }
  ]
}
```

保存语义为按 `plugin_type + base_id + target_table_id` 全量覆盖一条配置。

校验要求：

- `write_mode` 仅允许 `append`、`upsert`。
- `field_mappings` 中 `source_key`、`target_field_id` 必填且不得重复。
- 后端实际写入只信任 `source_key` 和 `target_field_id`，名称和类型字段仅用于回显。
- `source_key` 必须属于博主信息字段集合。

## 3. 定时任务快照新增字段

定时任务接口路径不变：

```http
POST /social/api/v1/feishu/schedule/tasks
PUT  /social/api/v1/feishu/schedule/tasks/{id}
```

在 `snapshot` 中只保存目标表标识：

```json
{
  "target_type": "existing",
  "target_table_id": "tbl_xxx",
  "target_table_name": "博主信息",
  "resolved_target_table_id": "tbl_xxx",
  "resolved_target_table_name": "博主信息"
}
```

其余已有快照字段保持不变，包括 `mode`、`source_table_id`、`source_view_id`、`profile_link_field_id`、`scope`、`row_count`、`manual_urls` 和 `selected_field_keys`。

兼容规则：

- `mode=table` 的任务保持 `target_type=current`，并优先使用 `resolved_target_table_id` 回写源表。
- 定时任务不会出现 `scope=selected`。
- `write_mode` 和 `field_mappings` 不写入任务快照；每次调度执行时，按 `plugin_type + base_id + resolved_target_table_id`（或 `target_table_id`）查询表级配置。未查询到时按 `append + []` 处理。

编辑任务时，前端先从任务快照取得目标表 ID，再查询同一条表级配置作为“数据写入方式”和“字段映射”的回显来源；不得读取旧快照中的这两个字段。查询无结果或失败时，界面回显默认 `append + []`，避免沿用其他目标表的配置。

## 4. 后端写入规则

### 4.1 手动输入的输出目标

- `target_type=existing`：写入 `target_table_id`。
- `target_type=new`：首次执行创建目标表，建议使用 `resolved_target_table_name` 或“博主信息”作为表名，并持久化创建后的表 ID，后续执行不得重复创建。

### 4.2 手动输入的字段匹配

- 有 `field_mappings` 时，按 `source_key -> target_field_id` 写入。
- 无显式映射时，按源字段名称匹配目标列。
- 没有同名列时，按现有作者作品逻辑自动创建字段。
- `upsert` 时，即使用户未勾选，也必须确保 `social_type` 和 `user_id` 两个字段可写入。

### 4.3 手动输入的更新或新增

`write_mode=upsert` 的固定唯一键为：

```text
social_type + user_id
```

- 两个字段都存在且命中：更新该记录。
- 两个字段都存在但未命中：新增记录。
- 任一字段为空：无法构成唯一键，按新增处理并记录 warning。
- 不允许使用映射后的列名替代源字段 key 参与查重。

## 5. 博主信息字段 key

本次 upsert 和映射会用到的字段 key：

```text
nickname
uid
user_id
profile_url
avatar
signature
follower_count
following_count
total_favorited
aweme_count
verified
verification_category
social_type
ip_location
ctime
```

## 6. 验收重点

- 现有表 + 字段映射能正确写入不同名称的目标列。
- `social_type + user_id` 相同的作者重复执行只更新，不新增重复记录。
- 同一作者在不同平台可生成不同记录。
- 手动输入的新建表定时任务后续执行不会反复创建新表。
- 从表格选取按源记录 ID 更新，且不新增记录。
