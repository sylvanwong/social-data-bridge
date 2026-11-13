# 关键词搜索获取后端更新说明

本文对应前端 `KeywordSearch.vue` 的作品范围、数据写入方式和字段映射改版。

2026-11-12：聚合插件的关键词任务已在前端源码接入 social-service。新任务的创建、查询、取消和结果读取
使用 `VITE_FEISHU_API_BASE_URL` 与 `/socialdatax/api`；2026-11-13 表级输出配置也统一切换到新服务，见 `config-schedule-backend-update.md`。
本轮未构建、未更新 `dist/`、未发布；关键词新后端也尚未部署，联调前需同时发布后端 Web 和应用 Worker。
独立 `workflow-keyword-fetch` 本轮未切换，继续使用旧接口。

生产环境的新服务域名为 `https://api.socialdatax.com`，测试环境为 `https://test-lotto.weiyoubot.cn`；
开发环境沿用同源 `/socialdatax/api` 代理。组件从既有请求配置读取地址，不自行写死域名。

## 一、参数归属

| 配置 | 前端字段 | 所属接口 | 是否进入抓取任务 |
| --- | --- | --- | --- |
| 作品获取范围 | `work_fetch_range` | 关键词任务接口 | 是 |
| 数据写入方式 | `write_mode` | 表级输出配置接口 | 否 |
| 字段映射 | `field_mappings` | 表级输出配置接口 | 否 |

作品范围决定后端抓取多少作品；写入方式和字段映射决定结果写入飞书表格的方式。三者不能混用。

## 二、关键词任务接口

### 创建任务

```http
POST /socialdatax/api/v1/feishu/keyword/task
Authorization: Bearer {api_key}
Content-Type: application/json
```

请求示例：

```json
{
  "social_type": "douyin",
  "keyword": "咖啡",
  "pages": 1,
  "work_fetch_range": {
    "type": "pages",
    "value": 1,
    "timezone": "Asia/Shanghai"
  },
  "filter_config": {}
}
```

`work_fetch_range` 约定：

| `type` | `value` | 含义 |
| --- | --- | --- |
| `all` | `null` | 全部作品 |
| `pages` | 1-50 | 最新 N 页 |
| `days` | 1-365 | 最近 N 个自然日发布的作品 |

YouTube 与好看视频搜索不支持精确按自然日过滤，页面禁用“最近”，并在从其他平台的按天范围切入时
改用按页获取；页数和全部范围仍可选。YouTube 自身的发布时间筛选继续可用。
费用按底层搜索接口的实际请求页数计算，不再提示所有平台固定每页 10 积分。

后端应以 `work_fetch_range` 为新协议。`pages` 仅用于兼容旧客户端：

- `pages = 0` 转换为 `{ "type": "all", "value": null }`
- `pages > 0` 转换为 `{ "type": "pages", "value": pages }`
- 新任务优先使用 `work_fetch_range`，不要用 `pages` 覆盖新配置

任务快照应保存 `work_fetch_range`。关键词搜索目前没有定时任务流程，抓取结果由结果接口返回后由前端写入飞书 Base。

### 查询任务

```http
GET /socialdatax/api/v1/feishu/keyword/task?task_id={task_id}
```

任务状态接口无需返回 `write_mode` 或 `field_mappings`。这两个字段属于目标表配置，不属于关键词抓取任务。

### 取消与结果读取

```http
POST /socialdatax/api/v1/feishu/keyword/task/cancel
POST /socialdatax/api/v1/feishu/post/list
```

取消传 `{ "task_id": "..." }`。`status=0,status_text=cancel_requested` 只表示已请求停止，
继续轮询直至 Worker 确认终态；确认停止或失败后仍读完已保存结果，再清理前端进度。
结果沿用 `after_id`、`limit=40`、`next_cursor`、`has_more` 逐批读取和写入。

### 任务来源与恢复

新任务在原恢复记录中增加 `apiBaseUrl`、`apiPathPrefix`，与 `taskId`、游标、目标表和写入配置一并保存。
查询、取消及结果读取使用该任务保存的来源，重开插件或全局配置变化后也不切换服务。
没有来源字段的历史任务继续使用 `VITE_API_BASE_URL` 与 `/social/api`，
已保存的空 `apiBaseUrl` 保留开发同源语义。沿用原存储键，不搬运旧任务。

## 三、表级输出配置接口

关键词搜索前端使用现有表格配置接口，插件类型固定为 `keyword_search`，不能与 `profile_fetch`、`blogger_info`、`video_data` 共用同一配置记录。

### 配置唯一键

```text
plugin_type + base_id + target_table_id
```

### 查询配置列表

```http
GET /socialdatax/api/v1/feishu/profile-fetch/table-output-configs
  ?plugin_type=keyword_search&base_id={base_id}
```

### 保存配置

```http
PUT /socialdatax/api/v1/feishu/profile-fetch/table-output-config
Authorization: Bearer {api_key}
Content-Type: application/json
```

请求示例：

```json
{
  "plugin_type": "keyword_search",
  "base_id": "base_xxx",
  "target_table_id": "tbl_xxx",
  "target_table_name": "关键词搜索结果",
  "write_mode": "upsert",
  "field_mappings": [
    {
      "source_key": "title",
      "source_name": "标题",
      "target_field_id": "fld_xxx",
      "target_field_name": "内容标题",
      "target_field_type": 1
    }
  ]
}
```

约定：

- `write_mode` 仅允许 `append`、`upsert`，缺失时默认 `append`
- `field_mappings` 缺失时默认 `[]`
- 映射项必须包含 `source_key`、`target_field_id`，同一 `source_key` 不得重复
- `source_name`、`target_field_name`、`target_field_type` 用于回显和校验，执行时以 key 和字段 ID 为准
- PUT 按唯一键全量覆盖原配置

建议表结构：

```text
social_table_output_configs
  plugin_type
  base_id
  target_table_id
  target_table_name
  write_mode
  field_mappings_json
```

## 四、前端写入行为

关键词任务返回结果后，前端按当前目标表配置执行写入：

1. 使用 `field_mappings` 建立 `source_key -> target_field_id` 显式映射。
2. 没有显式映射的字段按同名字段匹配。
3. `write_mode=upsert` 时使用 `aweme_id`（作品 ID）作为唯一键：命中则更新，未命中则新增。
4. `write_mode=append` 时每条结果均新增记录，不查重。
5. 映射目标字段不存在或类型不兼容时，应返回明确错误，阻止继续写入。

后端不应假设即时关键词任务会从任务快照读取 `write_mode`、`field_mappings`；前端已经在写入阶段使用表级配置。

## 五、兼容与验收

- 新建任务使用新服务的四类接口，表级配置和历史任务继续使用原来源。
- 旧请求只携带 `pages` 时仍可正常创建任务。
- 新请求携带 `work_fetch_range` 时，后端按新范围执行，不能错误地按默认首页处理。
- `plugin_type=keyword_search` 的配置与其他插件隔离。
- 同一目标表保存配置后，刷新关键词页面仍能读取并恢复写入方式和字段映射。
- `upsert` 能更新相同 `aweme_id` 的记录，`append` 不执行去重。
- 显式映射后，作品字段写入指定目标列，而不是仅按名称匹配。

### 本次源码验证（2026-11-12）

使用 Node 20.20.2 完成定向回归，任务及路由集 247 项通过；按关键词场景筛选的云配置、
目标映射与恢复测试另有 20 项通过（其他 364 项不在该筛选范围）。
日志分别为 `/tmp/feishu-keyword-frontend-final.log`、`/tmp/feishu-keyword-frontend-integration.log`。

覆盖新旧任务来源、开发空地址、鉴权及版本参数、游标持久化恢复、取消等待、终态剩余结果写入、
原目标表配置和写入恢复，以及完整 Vue / Element Plus 的按天范围与忙碌禁用。
新增禁用条件曾覆盖父表单的忙碌状态，失败回归复现后改为仅在平台不支持时显式禁用，其他情况继承原表单。
组件脚本和模板检查、`git diff --check` 通过，代码审查未发现剩余具体问题。

以上均为本地自动化检查，尚未在真实飞书侧栏与新关键词后端完成联调。
本轮未执行构建、未更新 `dist/`、未提交或发布。
