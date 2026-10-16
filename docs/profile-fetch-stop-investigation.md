# 作者作品停止任务排查

## 本次事件的证据边界

任务 ID：`6acdad2d2df243fa9fe87c18`。

用户提供的后端记录为 `status=1`、`fetched_count=1059`、`current_page=54`。按用户提供的时间，采集在 12:04:42 完成，用户在 13:43:29 点击停止。这只能证明点击时后端已完成采集，不能证明当时前端已写完表格。

仓库没有该客户端的网络抓包、取消接口响应正文或写表批次日志，以下是代码核查结论，不是本次客户操作的实际请求时间线。历史事实仍需客户当时留存的 HAR、浏览器日志或服务端访问日志佐证，不能用 Mongo 任务记录代替取消响应。

## 现有代码结论

1. `ProfileFetch.vue/cancelProfileTask` 只检查取消接口响应的 `sta === 0`，忽略 `data.status`、`data.status_text` 和 `data.cancel_requested`。返回 `status=1/completed` 不会终止前端流程。
2. `pollStreamTask` 先获取后端状态，再执行 `drainAvailablePosts`。包括 `status=1/2/3` 在内，都继续拉取已保存的结果；仅在终态且本轮未写入数据时结束。
3. `drainAvailablePosts` 用 `after_id` 拉取每页最多 20 条，等待该页写表完成，再保存 `next_cursor`；`has_more=true` 时直接进入下一页，没有等待下一次轮询。点击停止不清理定时器，也不改变循环条件 `activeStreamTask === streamTask`。
4. 没有独立的前端写表队列，分页和写表串行进行。但是当前页会在内存中进行字段准备、附件处理、记录转换和写入。同一页的更新与新增还可能分成不同 SDK 请求。
5. `useSocialData.js/createAndWriteData` 的 `stopAfterCurrentBatch` 表示“不调用旧的 getList 自动分页”，并非用户停止标记。此函数不检查 `isCancelling`；写入失败后会尝试创建新表并递归重试。已完成写入的回调继续推进游标和下一页。
6. 停止前发出的结果请求返回后，仍会进入写表。停止按钮不设置拉取和写表共用的停止标记。关闭页面会清理定时器和活动任务，但原代码缺少请求返回后的活动任务检查，已发出的异步工作仍可能继续。
7. 轮询异常时会退避并重试，最长间隔 30 秒；超过 10 分钟无进度才显示异常。本地恢复状态只在任务最终排空时清除，点击停止不清除。重新打开插件会恢复该任务的游标并继续导入。
8. 恢复状态经 `bitable.bridge` 保存，前端没有实例互斥或跨实例广播机制。多个实例是否实际打开、是否同时导入同一任务，无法从仓库代码确认。

## 客户截图补充

截图同时显示“立即执行”和“停止任务”处于 loading，浮层为“正在写入 20 条作品...”。

- “立即执行”绑定 `loading || isSubmitting`，其中 `loading` 表示整个前端导入生命周期，不代表后端仍在采集。
- “停止任务”绑定 `isCancelling`。点击时立即设置为 true；取消成功后没有清除。它会持续到结果排空、任务最终结束或轮询异常超时，因此不能把这个 loading 解读为取消 HTTP 请求一直没有返回。
- 写表前的提示覆盖了点击时的“正在停止任务”，所以界面仍显示“正在写入 20 条作品...”。该提示在字段准备、附件处理和 SDK 写入之前显示，不能据此断言某个 addRecords 请求正在执行，也不能判断后续批次是否持续推进。
- 10 分钟无进度检查在 `await drainAvailablePosts` 返回后才执行，不是独立看门狗。若字段/附件处理或飞书 SDK Promise 长时间不返回，检查也不会运行，两个按钮可能一直 loading。写入异常后的建表递归重试没有明确次数上限，也可能长时间无法退出。截图不足以确认本次是否命中了这些路径。

## 相关代码入口

| 检查项 | 代码位置 |
| --- | --- |
| 两个按钮的 loading | `src/components/ProfileFetch.vue:2019` |
| 取消请求及 sta 检查 | `src/components/ProfileFetch.vue:852` |
| 结果请求与 after_id | `src/components/ProfileFetch.vue:600` |
| 分页、写表、游标持久化 | `src/components/ProfileFetch.vue:619` |
| 终态排空后结束、清除 loading | `src/components/ProfileFetch.vue:666` |
| 轮询、重试和无进度检查 | `src/components/ProfileFetch.vue:694` |
| 插件恢复 | `src/components/ProfileFetch.vue:795` |
| 字段转换、附件单元格处理 | `src/composables/useSocialData.js:687` |
| 飞书更新/新增批次 | `src/composables/useSocialData.js:752` |
| 写入异常后新建表递归重试 | `src/composables/useSocialData.js:776` |

## 当前产品语义

`docs/monthly-meeting-project-sharing.md` 的停止任务章节明确：作者作品、关键词和评论等后台采集任务停止新增采集，但继续读取并写入已持久化结果。`docs/profile-fetch-streaming-task-proposal.md` 也要求后端完成后等游标追平、写表完成才结束。

因此，在当前语义下，停止后继续分页和写表属于结果收尾；后端已经完成时，取消接口也无法撤销采集。若要改成“停止整个导入流程”，需要另行改变前端控制逻辑，在分页、异步返回、写表批次、自动建表重试和恢复入口统一检查停止状态，且不能只依赖后端 status。

## 实际时间线需要的证据

| 时间 | 证据 | 当前可确认内容 |
| --- | --- | --- |
| 12:04:42 | 用户提供的后端排查结论 | 后端已完成采集 |
| 13:43:29 | 用户提供的点击时间 | 用户点击停止 |
| 13:43:29 之后 | cancel 响应正文 | 缺失；需核对 sta、data.status、data.status_text、data.cancel_requested |
| 13:43:29 之后 | post/list 请求和响应 | 缺失；需按 task_id 提取时间、after_id、返回条数、next_cursor、has_more |
| 13:43:29 之后 | 飞书 SDK 写表日志 | 缺失；需区分请求开始/完成、更新/新增、目标表、条数与失败重试 |

判别分页是否正常推进应对比每页的 `after_id` 与上一页成功写入后保存的 `next_cursor`。游标重复可能来自写表失败后重试、恢复状态保存失败或多个实例；不能仅以“重复请求同一 task_id”判断重复读取。

采集完成到点击停止相隔约 99 分钟，而结果共 1059 条。持续写入的具体瓶颈（附件处理、SDK 耗时、写入失败重试、插件关闭后恢复等）缺少实际日志，暂不能确定。

## 对照 sociallotto 后端源码后的发现

核查路径：`/usr/local/var/www/sociallotto`。以下描述的是本地当前源码，不证明客户当时使用的前后端部署版本一致。

### 优先嫌疑：封面附件串行处理

客户截图勾选“封面附件”。前端 `useSocialData.js:221` 对封面先浏览器直连下载，失败后调用 `/social/api/v1/feishu/xhs_download_proxy`；两次尝试共用一个 30 秒 AbortController 计时，不是每次各 30 秒。下载失败最终跳过附件，但等待时间仍已发生。

`useSocialData.js:687` 对作品逐条循环，每条先 await 附件下载，再 await `field.createCell`；对于附件还 await `cell.getValue`。同一作品的多个附件可以并发，作品之间依然串行。整页转换完才调用飞书 addRecords/setRecords，完成后才拉取下一页。“正在写入 20 条作品”涵盖了附件下载、单元格转换和写表，并不只表示记录写入接口。

因此每条作品增加约 10.2 秒累计耗时，就能把 1059 条的导入拖到约 3 小时。1059 次封面下载若每次等满 30 秒，仅下载阶段就约 8.8 小时。这个计算说明附件路径足以产生本次延迟，不证明实际每条耗时。

后端 `FeishuXhsDownloadProxyHandler.get`（`feishu_social_handler.py:683`）接收前端下载失败后的代理请求，带 Referer 请求上游，配置 timeout=30，并流式返回文件；它不接收 task_id，需要按用户、时间窗口及 url 与作品 cover_url 关联。日志里的 `xhs download proxy failed`、`xhs proxy upstream failed` 和 `xhs proxy stream interrupted` 可直接佐证代理错误。浏览器直连失败前的等待、以及飞书 SDK 处理不在此后端日志中。

### 结果接口与采集状态

后端 `FeishuPostListHandler._build_post_list_response`（`feishu_social_handler.py:1440`）在游标模式中查询 `task_id` 和 `_id > after_id`，按 `_id` 升序读取主库的 limit+1 条，返回前 limit 条及真实 has_more。这里没有上游采集、封面下载、主动 sleep、或等任务完成的代码。完成后的结果集如果确实只有 1059 条、游标不回退且读取没有失败，一次从头读到排空应是 53 次有数据加 1 次空响应。

任务 ctime/t_begin=1791864109、t_scrap=1791864282 对应北京时间 2026-10-13 12:01:49 到 12:04:42，采集耗时 173 秒。worker 先保存作品再设置 status=1。因此后续三小时不应归因于这条任务继续采集。

`FeishuSocialTaskCancelHandler` 对已经 status=1 的任务不写 cancel_requested，按当前源码应返回 sta=0、status=1、status_text=completed、cancel_requested=false；这是代码推导的预期响应，不是本次实际响应记录。

### 次级嫌疑与证据限制

- 仓库有 `(task_id, _id)` 复合索引创建脚本，但无法确认线上已执行；数据库 `get_many` 用 find/sort/to_list，没有配置 maxTimeMS。缺索引或数据库负载可使结果查询慢，需要访问耗时或 explain 才能确认。
- 前端写表失败后的自动新建表重试仍没有明确次数上限；传回轮询层的失败会让 cursor 不推进，从而再次读取同一页。但内部重试可能一直发生在同一次 post/list 之后，所以请求次数也不能完整体现重试次数。
- 未发现此次任务的实际本地访问日志。目前只收到“post/list 共 114 次”的汇总，无法确认这些请求集中在哪段时间、是否为空、是否同一游标。114 次与三小时延迟是两个需要分别验证的现象，不能从次数直接推出三小时原因。

基于现有代码与截图，优先排查封面下载和附件 SDK 转换的串行累计耗时，再查写入失败重试；数据库查询慢、页面暂停和多实例仍未排除。最小的后端验证是统计 12:04:42 之后 post/list 的接口耗时和相邻请求间隔，并关联该用户的下载代理请求耗时、错误数。
