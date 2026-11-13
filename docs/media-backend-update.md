# 视频文案媒体任务迁移说明

2026-11-13：聚合插件 `VideoCopySummary.vue` 的媒体任务创建和查询已在前端源码切换到 social-service。
组件复用现有 `feishuRequest`、`buildFeishuApiPath` 和 `VITE_FEISHU_API_BASE_URL`，不自行配置主机。
本轮未构建、未更新 `dist/`、未部署，也未进行真实飞书或新后端网络联调。

## 请求契约

两个接口继续使用 POST，并通过现有请求层携带 `Authorization: Bearer <api_key>` 与插件 `version`：

| 用途 | 新路径 | 业务请求体 |
| --- | --- | --- |
| 创建 | `/socialdatax/api/v1/feishu/media/task` | `{ "url": "<作品链接>", "force_refresh": false }` |
| 查询 | `/socialdatax/api/v1/feishu/media/task/get` | `{ "task_id": "<创建返回的任务ID>" }` |

创建仍要求业务成功 `sta=0` 且存在 `data.task_id`，保留 `next_poll_after_seconds` 等原响应字段。
查询继续处理 `queued`、`running`、`succeeded`、`failed`，沿用下次轮询间隔及最多 120 次的限制。
普通业务错误保留后端原因；鉴权错误立即中断整批，不继续提交下一条。其他单条失败继续记录原原因并处理后续行。

## 每条任务的来源

`createMediaTask` 返回原创建数据，并添加创建时的 `apiBaseUrl`、`apiPathPrefix`。
逐行处理将完整创建对象传给 `pollMediaTask`，轮询始终按该对象的来源查询；来源字段不进入后端请求体。
即使调用方保留或序列化该对象后再查询，也不按当前新服务地址重新选择来源。

`pollMediaTask` 兼容原来的任务 ID 字符串和没有来源字段的旧对象：这两种输入继续使用
`API_BASE_URL` 与旧 `/social/api` 前缀。显式空主机表示同源，显式空前缀表示无前缀，均使用空值回退保留。

当前页面原本没有媒体任务持久化或跨刷新恢复功能，本轮也没有新增该机制。
任务来源仅随当前处理链中的创建对象保留；页面卸载后不再发起后续轮询或写入。
停止操作继续等待当前视频完成，并在停止后不再提交下一条。

## 输出与入口边界

手动链接、表格链接来源，以及更新当前行、新建表格、追加到已有表格，均复用同一创建与轮询链。
摘要、转写文案、平台字段的取值和 SDK 写入不变，输出映射不发送给媒体任务接口。
`succeeded` 但摘要为空且存在 `summary_error` 时，摘要列继续使用该错误文本，已有转写结果仍正常写入。

独立 `social-video-summary` 工作流继续调用旧服务，本轮未切换。
表格输出配置属于独立接口，后续同日已统一切换到新服务；见 `config-schedule-backend-update.md`。

## 本地回归

使用支持现有测试入口的 Node 运行：

```sh
node --test tests/mediaFeishuRoutes.test.mjs tests/localTaskFeedback.test.mjs tests/requestAuth.test.mjs
node --test --test-name-pattern='VideoCopySummary|视频文案' tests/rowTaskFeedback.test.mjs tests/targetFieldOwnership.test.mjs tests/fieldWriteRules.test.mjs tests/configLockInteraction.test.mjs tests/tableConfigSaveSnapshot.test.mjs
```

路由回归执行真实请求层并替换 HTTP 适配器，覆盖三个环境、任务来源快照、旧 ID/旧对象、空主机/空前缀、
状态轮询、逐行摘要/转写、失败与鉴权中断。SDK 和完整 Vue 生命周期回归使用本地宿主替身，不能替代真实飞书验收。
