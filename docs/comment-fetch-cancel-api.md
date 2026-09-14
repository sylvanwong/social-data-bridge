# 评论列表获取：停止任务接口对接说明

## 目标

用户停止评论采集后，后端不再发起新的评论抓取；已经成功采集并持久化的结果仍可由前端通过现有结果分页接口读取，并继续写入飞书多维表格。

本说明是对现有评论任务接口的增量约定，不改变创建任务、查询状态、读取结果的现有路径与请求字段。

## 现有接口

### 创建任务

```http
POST /social/api/v1/feishu/comment/task
Authorization: Bearer <api_key>
Content-Type: application/json
```

```json
{
  "url": "https://example.com/note/xxx",
  "pages": 5,
  "reply_pages": -1,
  "sort_type": "default"
}
```

成功响应至少包含任务 ID：

```json
{
  "sta": 0,
  "data": {
    "task_id": "comment_task_xxx"
  }
}
```

### 查询状态

```http
GET /social/api/v1/feishu/comment/task?task_id=comment_task_xxx
Authorization: Bearer <api_key>
```

现有前端已读取 `status`、`processed`、`total`、`heartbeat_at`、`reason`。本次在兼容原字段的前提下补充取消状态语义。

### 分页读取结果

```http
POST /social/api/v1/feishu/comment/list
Authorization: Bearer <api_key>
Content-Type: application/json
```

```json
{
  "task_id": "comment_task_xxx",
  "after_id": "<上次响应的 next_cursor；首次为空字符串>",
  "limit": 20
}
```

响应中的评论数组可继续沿用 `data` 或 `items`，分页控制字段为 `next_cursor`、`has_more`：

```json
{
  "sta": 0,
  "data": {
    "data": [
      {
        "cid": "comment_001",
        "text": "评论内容"
      }
    ],
    "next_cursor": "comment_001",
    "has_more": true
  }
}
```

当本次返回有数据时，`next_cursor` 必须非空且不同于请求中的 `after_id`。

## 新增接口：请求停止采集

```http
POST /social/api/v1/feishu/comment/task/cancel
Authorization: Bearer <api_key>
Content-Type: application/json
```

请求体：

```json
{
  "task_id": "comment_task_xxx"
}
```

成功响应：

```json
{
  "sta": 0,
  "data": {
    "task_id": "comment_task_xxx",
    "status": 0,
    "status_text": "cancel_requested",
    "cancel_requested": true
  }
}
```

接口必须幂等。同一任务重复调用取消接口，均返回成功与当前任务状态；不得重复投递取消事件或删除已采集结果。

建议错误响应：

```json
{
  "sta": 1,
  "msg": "任务不存在或无访问权限"
}
```

## 状态约定

保持原有数字状态兼容，并新增 `3`：

| `status` | `status_text` | 含义 | 前端行为 |
| --- | --- | --- | --- |
| `0` | `queued` / `running` | 正在采集 | 继续轮询状态与结果 |
| `0` | `cancel_requested` | 已收到停止请求，Worker 正在停止 | 继续轮询状态与结果，不可立即停止前端写入 |
| `1` | `succeeded` | 正常完成 | 继续读取结果，直到结果接口为空后结束 |
| `2` | `failed` | 任务失败 | 继续读取失败前已持久化的结果，结果排空后提示失败 |
| `3` | `cancelled` | 已停止，不会再产生新结果 | 继续读取已持久化结果，结果排空后提示已停止 |

推荐状态响应：

```json
{
  "sta": 0,
  "data": {
    "task_id": "comment_task_xxx",
    "status": 3,
    "status_text": "cancelled",
    "cancel_requested": true,
    "processed": 42,
    "total": 100,
    "heartbeat_at": 1760000000,
    "reason": "用户主动停止"
  }
}
```

`status_text` 与 `cancel_requested` 为推荐新增字段，便于前端展示；前端终态判断仍以 `status` 为准。

## 后端处理要求

1. 取消接口只将活动任务标记为 `cancel_requested`。不要同步等待 Worker 完全退出，也不要直接删除任务或结果。
2. Worker 在每个可中断边界检查取消标记：下一个作品、下一页主评论、下一页子评论、下一次外部平台请求之前。
3. 发现取消标记后，不再创建新的外部采集请求；已在执行中的请求可完成，但其结果必须先持久化后再结束任务。
4. 结果必须在更新任务进度或游标前可靠写入任务结果存储。建议对 `(task_id, cid)` 建唯一约束，保证重试不会产生重复评论结果。
5. Worker 确认不再生产新结果后，将任务从 `cancel_requested` 更新为 `cancelled`（`status=3`）。
6. `cancelled`、`succeeded`、`failed` 后，`POST /comment/list` 必须仍可读取所有已持久化结果；不得因取消清理结果。
7. 任务结果至少保留 24 小时，支持插件关闭、网络中断后恢复写入；到期后再按现有清理策略删除。

## 前端对接规则

1. 点击“停止任务”时仅调用 `POST /comment/task/cancel`，页面进入“正在停止”状态。
2. 收到 `cancel_requested` 后，前端不得调用本地 `stop()` 终止轮询。
3. 前端继续调用现有状态接口和 `/comment/list`，按照 `after_id -> next_cursor` 写入所有结果。
4. 当前端收到 `status=1`、`2` 或 `3` 后，仍需至少再拉取一次结果接口；仅在结果为空时才清除本地任务恢复状态并停止轮询。
5. `status=3` 是正常停止，提示“任务已停止，已写入 N 条评论”；不要作为采集失败提示。

## 验收场景

1. 任务采集过程中点击停止：后端最终状态为 `cancelled`，且外部采集请求不再继续增长。
2. 停止前已抓到但前端尚未写入的评论，仍全部写入目标表。
3. 连续点击停止两次，只产生一次取消标记，接口均返回成功。
4. 在 `cancel_requested` 或 `cancelled` 时关闭并重新打开插件，前端可按保存的 cursor 继续写入剩余结果。
5. `cancelled` 后重复请求 `/comment/list`，同一 cursor 的返回顺序稳定，不丢失、不重复结果。
