# 聚合插件输出配置与定时任务管理迁移

2026-11-13：以下聚合页面和共享 composable 的输出配置，以及三个页面的定时任务管理，
已在前端源码统一使用现有 `feishuRequest`、`buildFeishuApiPath` 和 `VITE_FEISHU_API_BASE_URL`。
本轮未构建、未更新 `dist/`、未部署或进行真实飞书／新后端网络联调。独立插件和工作流不在本轮切换范围。

## 输出配置入口

| 页面 | `plugin_type` | 读取入口 |
| --- | --- | --- |
| 作者作品 `ProfileFetch.vue` | `profile_fetch` | 页面 |
| 作者信息 `BloggerInfoFetch.vue` | `blogger_info` | 页面及定时任务弹窗 |
| 作品详情 `VideoDataFetch.vue` | `video_data` | 页面 |
| 作者搜索 `BloggerSearch.vue` | `blogger_search` | 页面 |
| 关键词搜索 `KeywordSearch.vue` | `keyword_search` | 页面 |
| 评论 `CommentFetch.vue` | `comment_fetch` | 页面 |
| 短剧 `SeriesFetch.vue` | `series_fetch` | 页面 |
| 搜索推荐词 `SearchSuggestions.vue` | `search_suggestions` | 页面 |
| 热榜 `HotListFetch.vue` | `hot_list` | 页面 |
| 提取视频文案 `VideoCopySummary.vue` | `video_copy_summary` | `useToolOutputConfig.js` |
| 小红书下载 `XhsDownload.vue` | `xhs_download` | `useToolOutputConfig.js` |
| 链接转附件 `UrlToAttachment.vue` | `url_to_attachment` | `useToolOutputConfig.js` |

12 个页面的保存函数及上述读取入口全部使用：

```http
GET /socialdatax/api/v1/feishu/profile-fetch/table-output-configs?plugin_type=<type>&base_id=<base_id>
PUT /socialdatax/api/v1/feishu/profile-fetch/table-output-config
Authorization: Bearer <api_key>
```

请求体仍为 `plugin_type`、`base_id`、`target_table_id`、`target_table_name`、`write_mode`、`field_mappings`；
请求拦截器继续附加插件 `version`。响应、读回错误、按表保存队列和映射快照处理不变。
后端共用原 `social_table_output_configs`，唯一键仍为 `plugin_type + base_id + target_table_id`，
不加入 executor／owner 来源维度，也不需要搬运旧配置。已有配置统一由新接口读取，不按抓取任务来源回退。

## 定时任务管理入口

`ProfileFetch.vue`、`BloggerInfoFetch.vue`、`VideoDataFetch.vue` 的管理请求统一使用：

```http
GET    /socialdatax/api/v1/feishu/schedule/tasks?plugin_type=<type>&base_id=<base_id>
POST   /socialdatax/api/v1/feishu/schedule/tasks
PUT    /socialdatax/api/v1/feishu/schedule/tasks/<id>
DELETE /socialdatax/api/v1/feishu/schedule/tasks/<id>
POST   /socialdatax/api/v1/feishu/schedule/tasks/<id>/toggle
```

创建和编辑继续发送原任务载荷；切换启用状态仍发送 `{ "enabled": <boolean> }`，删除仍保留原空业务请求体。
路径常量先经过 `buildFeishuApiPath` 再追加任务 ID／`toggle` 后缀，动态路径不会丢失新前缀。
已有映射保存顺序、任务弹窗快照、加载归属、重复提交保护及原错误提示均不调整。

列表和管理按当前用户读取共享任务表，历史及新 executor 的任务都通过新 API 管理；
不依照某条任务的 `apiBaseUrl/apiPathPrefix` 改选旧服务。旧任务继续由旧 Worker 执行，
新建任务由后端标记交给新 Worker，这些执行器语义由后端负责。

本轮没有改变即时抓取任务的生命周期来源：作者作品、关键词、评论等已有任务仍使用各自保存的来源；
媒体任务的来源快照和原有卸载边界见 `media-backend-update.md`。

## 本地回归入口

```sh
node --test tests/configScheduleFeishuRoutes.test.mjs
node --test tests/tableOutputConfig.test.mjs tests/tableConfigSaveSnapshot.test.mjs tests/hotListFields.test.mjs
node --test tests/cloudConfigReadiness.test.mjs tests/cloudConfigDetails.test.mjs tests/keywordConfigReadyInteraction.test.mjs tests/configLockInteraction.test.mjs tests/targetFieldOwnership.test.mjs tests/tableFieldsOwnership.test.mjs
```

路由测试执行所有 23 个配置调用点和 12 个定时管理调用点的实际请求表达式，使用真实请求层及本地 HTTP 适配器，
覆盖生产、测试、同源环境、动态任务 ID、历史任务来源和新旧 executor 列表。
配置快照、SDK 与完整 Vue 回归使用本地宿主替身；自动化结果不代表真实飞书验收。
