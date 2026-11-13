# 作者搜索与搜索推荐词后端接入说明

2026-11-13：聚合插件的 `BloggerSearch.vue`、`SearchSuggestions.vue` 改用统一的 `feishuRequest` 请求层和 `/socialdatax/api` 前缀。请求体和业务响应结构沿用既有接口。本轮没有修改独立作者搜索、独立推荐词或工作流插件，没有构建、更新 `dist/`、提交或发布。

## 配置与入口

- 新请求读取 `VITE_FEISHU_API_BASE_URL`：生产配置为 `https://api.socialdatax.com`，测试配置为 `https://test-lotto.weiyoubot.cn`，开发配置 `/` 表示同源代理。组件不硬编码域名。
- 作者历史任务仍需旧服务配置 `VITE_API_BASE_URL`；当前生产旧服务为 `https://api.52choujiang.cn`。
- 两页原有表级输出配置已统一使用新服务，插件类型分别为 `blogger_search`、`search_suggestions`。详情见 [配置与定时任务迁移说明](config-schedule-backend-update.md)。
- 本次业务调用仅影响聚合插件。独立作者搜索、独立推荐词及工作流继续沿用各自现有实现，不共享聚合插件的恢复记录。

## 作者搜索

| 操作 | 新请求 |
| --- | --- |
| 创建 | `POST /socialdatax/api/v1/feishu/blogger/search/task` |
| 状态 | `GET /socialdatax/api/v1/feishu/blogger/search/task?task_id=...` |
| 结果 | `POST /socialdatax/api/v1/feishu/blogger/search/list` |
| 停止 | `POST /socialdatax/api/v1/feishu/blogger/search/task/cancel` |

创建仍发送 `social_type`、去重后的关键词数组 `keyword`、页数 `pages` 及 `filter_config`。全部范围继续使用 `pages=0`；抖音筛选继续传粉丝范围与用户类型，其他平台维持原参数。统一请求层沿用插件版本注入和 Bearer 鉴权。

创建成功仍要求 `{ sta: 0, data: { task_id } }`。状态和列表响应保留原 `{ sta, msg, data }` 业务包络，继续交由既有增量引擎处理。列表仍传 `task_id`、`after_id`、`limit=40`，按 `next_cursor`、`has_more` 分批写入；没有新增写入确认接口。

新任务在原 `blogger_search_stream_task_v1` 恢复记录中保存 `apiBaseUrl`、`apiPathPrefix`，与原任务 ID、游标、目标表、字段选择、写入方式、映射和 `pendingWrite` 一起持久化。查询、结果读取和取消均使用该任务记录的来源，重开后不会随新任务的全局地址切换服务。缺少来源的历史任务回退 `VITE_API_BASE_URL` 与 `/social/api`；显式保存的空 `apiBaseUrl` 继续表示开发同源，不用真假判断覆盖它。原存储键和历史记录不搬迁。

输出配置仍在创建请求前固定为原 `outputSnapshot`，写入和恢复继续使用任务快照。取消请求成功仅进入停止等待；`cancel_requested` 继续轮询，确认终态后仍写完已保存结果，排空后才清理恢复记录。

## 搜索推荐词

聚合推荐词统一调用 `POST /socialdatax/api/v1/feishu/search/suggestions`，保留 `{ social_type, keyword }` 请求和 60 秒超时。统一请求层附加既有 `version`，返回值仍为 Axios response；页面从 `response.data` 读取 `{ sta, msg, data: { items } }`，不按已解包响应处理。

普通单关键词失败保留原原因并继续后续关键词，最终汇总失败数；业务 `sta=4001` 与 HTTP 401/403 由请求层标记为 `INVALID_API_KEY`，页面中止后续关键词并写完此前已获取结果。没有结果时显示原错误，已有结果时保留实际写入条数与中止原因。

推荐词仍是页面内的逐关键词获取和原写入流程。获取期间停止等待当前请求后写完已获取结果；卸载后不继续请求、补列、写入或切表。本轮没有新增后台任务、持久化恢复或“继续写入”能力。

## 验证范围

- 新增 `tests/bloggerFeishuRoutes.test.mjs`：生产、测试及开发同源创建；新来源、历史来源和显式同源来源的状态/列表/取消；通过真实增量引擎保存、重开、继续游标和确认停止后清理。保留原输出快照和请求体。
- 新增 `tests/suggestionFeishuRoutes.test.mjs`：真实请求层与 Axios 拦截器，HTTP adapter 替代外部网络；验证三种环境、新前缀、原响应读取、普通失败继续，以及业务/HTTP 鉴权失败中止并保留已获取结果。
- 相关既有回归继续覆盖字段映射、初始化锁定、停止等待、任务恢复、卸载迟到响应和写入失败；测试替身仅调整为当前命名请求导出与路由 helper。
- 上述属于源码及本地自动化验证，不代表真实飞书侧栏或新旧后端网络联调已验收。真实飞书界面、真实 API 联调和部署未验证；未执行构建或发布。

使用支持 `--test` 的 Node 20，安装相关项目依赖后，在聚合插件根目录执行。

以下命令仅适用于完整内部仓库，需同时包含兄弟插件 `social-comment-assistant` 及其测试辅助文件：

```sh
node --test tests/bloggerFeishuRoutes.test.mjs tests/suggestionFeishuRoutes.test.mjs
```

公开仓库不包含 `tests/suggestionFeishuRoutes.test.mjs`，使用以下命令运行已导出的测试：

```sh
node --test tests/*.test.mjs
```
