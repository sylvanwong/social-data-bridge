# 链接转附件后端切换

2026-11-12，聚合插件 `UrlToAttachment.vue` 的转换请求已切换到：

```text
POST /socialdatax/api/v1/feishu/attch
Authorization: Bearer <apikey>
```

通过 `feishuRequest` 和 `buildFeishuApiPath` 读取现有 `VITE_FEISHU_API_BASE_URL`：
测试 `https://test-lotto.weiyoubot.cn`，生产 `https://api.socialdatax.com`。
开发环境使用同源路径，由现有 Vite `/socialdatax/api` 代理到测试服。
2026-11-13：表级输出配置也统一使用新服务，读取原共享配置；见 `config-schedule-backend-update.md`。

请求仍为 `{links:[...],version:...}`，每批最多 5 条，`version` 由现有请求拦截器附加。
响应保持 `sta/msg/data`，成功 `data` 为附件数组；后续按 `content` 下载文件并交给 SDK 写入。
业务及认证错误继续阻止下载和写入。不修改字段选择、映射、已有表、新建表及恢复逻辑。

后端复用已有附件转换及专属计费：免费额度优先，额度耗尽后每批请求 1 积分，失败或取消释放预占。
这是同步接口，不涉及历史任务 ID 或任务来源分流。不增加失败后跨服务重试，避免重复扣费。

新增回归执行真实组件转换函数和 Axios 拦截器，覆盖三环境地址、5 条分批、鉴权与版本、
附件下载、业务/认证失败、后批失败及空结果。并运行已有附件字段写入和请求认证回归：

```sh
node --test tests/attachmentFeishuRoutes.test.mjs tests/fieldWriteRules.test.mjs tests/targetFieldOwnership.test.mjs tests/requestAuth.test.mjs
```

本次仅修改源码，未构建、未更新 `dist/`、未部署或发布。
需先部署后端公开路由，再联调前端；真实飞书宿主、媒体下载和 SDK 附件上传尚未端到端验收。
