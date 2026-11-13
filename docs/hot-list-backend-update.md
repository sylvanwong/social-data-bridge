# 热榜后端迁移与共用结果接口核对

2026-11-12：`HotListFetch.vue` 已在源码接入当前 social-service 的同步热榜接口：

```text
GET /socialdatax/api/v1/feishu/hot/list?social_type=<platform>
Authorization: Bearer <apikey>
```

使用现有 `feishuRequest` 与 `buildFeishuApiPath`，分别读取 `VITE_FEISHU_API_BASE_URL`：
测试 `https://test-lotto.weiyoubot.cn`，生产 `https://api.socialdatax.com`；
开发环境同源路径由 Vite `/socialdatax/api` 代理转发测试服。
七个平台、鉴权头、`version` 查询参数和 `sta/msg/data.hot_items` 保持原契约。
2026-11-13：表级输出配置也统一使用新服务，读取原共享配置，无需搬运数据；见 `config-schedule-backend-update.md`。

新增路由回归执行实际 `submit` 与 Axios 请求拦截器，核对三环境、七平台、
新建与已有表、业务/认证失败和空结果，并复用已有热榜字段兼容回归。
本地热榜、请求及字段回归 124 项通过，共用结果接口相关回归 28 项通过；
在当前目录使用 Node 20 执行：

```sh
node --test tests/hotListFeishuRoutes.test.mjs tests/feishuApiBase.test.mjs tests/requestAuth.test.mjs tests/hotListFields.test.mjs tests/fieldWriteRules.test.mjs
node --test tests/profileFeishuRoutes.test.mjs tests/keywordFeishuRoutes.test.mjs tests/streamTaskCoverage.test.mjs
```

## 共用 `/feishu/post/list` 检查

聚合插件当前有以下调用：

| 位置 | 状态 |
| --- | --- |
| `ProfileFetch.vue` | 已迁移，结果跟随作品任务保存的 `apiBaseUrl` 和 `apiPathPrefix` |
| `KeywordSearch.vue` | 已迁移，结果跟随关键词任务保存的来源 |
| `SeriesFetch.vue` | 已迁移，结果跟随短剧任务保存的来源 |
| `useSocialData.js` 的旧 `getList` | 保留旧路径；当前页面没有调用该函数，增量写入使用 `stopAfterCurrentBatch` 提前返回 |

不能把旧路径全局替换：历史任务仍需请求其旧域名及旧前缀。
页面读取结果必须与创建、查询、取消使用同一任务来源。

在整个 `FeishuSocialDataWeb` 源码范围还找到两套未迁移工作流：

- `workflow-profile-fetch/src/index.ts`：创建作品任务、查询任务、获取结果均为旧服务。
- `workflow-keyword-fetch/src/index.ts`：创建关键词任务、查询任务、获取结果均为旧服务。

这两套需要整条任务链一并切换，本轮只核对，没有修改工作流。
独立 `social-suggestion-search` 的共用模块也保留旧 `getList`，当前推荐词页面不调用该结果函数。

本轮未构建、未更新 `dist/`、未部署或发布。后端热榜尚未部署，需先发布 Web 路由再联调。
自动化回归不能替代真实飞书侧栏及平台数据的端到端验收。
