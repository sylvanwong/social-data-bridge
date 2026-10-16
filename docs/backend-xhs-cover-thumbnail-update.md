# 小红书封面附件下载：后端更新说明

## 目标与职责

作者作品导入时，小红书封面附件由前端直接请求现有后端下载代理。后端向小红书 CDN 请求 1080p 边界的 JPEG 缩略图，避免下载原尺寸 PNG。

前端负责下载队列，默认最多 3 个封面下载请求同时进行；后端每个请求处理一张图片，不新增批量接口或任务队列。附件单元格处理和飞书写表属于前端后续步骤。

本文件是待实现的接口契约，不代表前后端已更新或部署。

## 问题及实测依据

客户任务采集 1059 条作品，后端于 12:04:42 完成，前端到 15 点多才完成导入。截图勾选“封面附件”。现有前端按作品串行下载封面，先直连，失败后请求代理；小红书 Referer 下可下载，而模拟插件 Referer 的三个地址均返回 403。

原封面 URL 含 `imageView2/2/format/png`，没有明确尺寸限制。客户代理访问日志中的两张图片约为 17.1 MB 和 5.5 MB，请求总耗时分别为 8.864 秒、2.525 秒。此线索支持优化附件路径，但尚未证明三小时延迟全部来自下载。

服务器测试使用 `scripts/test-xhs-download.py`，Python 标准库直接请求 CDN，带 `Referer: https://www.xiaohongshu.com/`，三路并发，参数为：

```text
imageView2/2/w/1920/h/1080/format/jpg
```

| 样本 | 缩略图大小（字节） | 第 1 轮下载耗时 |
| --- | ---: | ---: |
| 1 | 206437 | 0.2103 秒 |
| 2 | 184518 | 0.2271 秒 |
| 3 | 214912 | 0.2331 秒 |

三轮所有 9 次请求均为 HTTP 200、Content-Type=image/jpeg。每轮三张并发完成耗时依次为 0.2388、0.1546、0.1617 秒，平均约 0.185 秒。这是服务器到 CDN 的下载结果，不含代理向客户端转发、浏览器处理、飞书上传与写表；重复样本可能受 CDN 缓存影响，不能作为整批任务耗时保证。

## 接口契约

复用：

```http
GET /social/api/v1/feishu/xhs_download_proxy?url=<encoded_cover_url>&file_name=cover.jpg&image_mode=xhs_cover
Authorization: Bearer <api_key>
```

新增参数 `image_mode=xhs_cover`，显式表示下载小红书封面缩略图。未携带该参数的请求保留现有行为，避免改变通用下载代理中的视频、其他平台及原图下载用途。携带未知非空模式返回 HTTP 400。

| 参数 | 规则 |
| --- | --- |
| `url` | 原始 cover_url，沿用现有 URL 编码方式与公开地址校验 |
| `file_name` | 前端发送 cover.jpg；后端规范化为 .jpg 扩展名，并沿用文件名清洗 |
| `image_mode` | 新增可选枚举 xhs_cover；本次只定义此模式 |

成功返回 JPEG 文件字节，沿用二进制下载响应，不能改为 sta/msg/data JSON。失败返回非 2xx 状态，前端跳过该附件并记录失败，继续导入其他字段。

不新增由客户端指定的 width、height、format 参数，缩略图规则由后端固定控制。作品结果中的原始 cover_url 保留，前端“封面链接”仍指向原始链接；仅附件下载时转换 URL。

## 后端实现要求

修改入口：sociallotto 的 `lottowebservice/lottowebservice/handlers/feishu_social_handler.py`，`FeishuXhsDownloadProxyHandler.get` 及相关 URL 转换辅助函数。

1. 对 xhs_cover 模式验证 CDN 主机为 `xhscdn.com` 或其子域（使用域名边界匹配）；继续沿用公开主机/IP 和重定向目标校验。该模式不接受其他平台 URL。
2. 将旧 imageView2 转换指令替换为固定指令，不得追加多个互相冲突的尺寸/格式转换：

   ```text
   输入： https://sns-img-qc.xhscdn.com/<image_id>?imageView2/2/format/png
   上游： https://sns-img-qc.xhscdn.com/<image_id>?imageView2/2/w/1920/h/1080/format/jpg
   ```

   不带转换参数的已支持 CDN 图片 URL 也使用上述固定指令。样本采用无键 query 形式，不能假设它是普通的 key=value 参数。带额外签名或其他转换形式的 URL 需明确解析并验证；无法兼容时返回错误，不静默下载原图兜底。
3. 1080p 定义为 **宽不超过 1920、高不超过 1080，保持比例**，不裁剪、不拉伸，不要求输出恰好 1920×1080。竖图可能约为 810×1080；不是长边 1920 的定义。上线前验证小图不被放大。
4. 上游请求添加 `Referer: https://www.xiaohongshu.com/`，继续采用异步请求和流式转发，沿用现有 30 秒上游超时。客户端断开后释放上游连接。
5. xhs_cover 模式固定 JPEG 输出，确认上游成功响应的 Content-Type 为 image/jpeg。异常格式或转换失败返回错误，不回退到未限制尺寸的 PNG。Content-Disposition 的扩展名与 MIME 类型一致。
6. 沿用现有私有缓存响应策略。仅在 CDN 侧缩放，后端不自行解码、压缩或缓存整张原图到内存。

## 前端配合与并发分工

- 仅小红书封面附件使用 image_mode=xhs_cover 并直接走代理，省略浏览器直连尝试。平台识别来自作品 social_type，不仅依赖 URL 字符串猜测。
- 同一导入实例共享最多 3 个下载槽位，完成一个再补下一个，不一次发出全部作品请求。后端不为单个实例另建并发队列；前端上限也不代表服务总并发上限。
- 下载并发不等于飞书 SDK 调用并发。先下载本页封面，再按既有逻辑创建附件单元格、批量写表；整页写入成功后才推进分页 cursor。
- 前端下载超时与取消沿用 AbortController；失败保留原始封面链接，跳过附件，不重新下载原图。停止行为仍按单独确定的产品语义实施，本次后端更新不改变 task/cancel 状态契约。

## 日志与验证

后端为封面模式记录 request_id、模式、上游主机、HTTP 状态、上游请求/传输耗时、转发字节数及异常类型。区分客户端断开、上游超时和上游 HTTP 错误；不要记录 API key。代理请求当前不含 task_id，不能仅按 request_id 将下载自动关联到采集任务。

服务器 CDN 基线测试（脚本可单独复制到服务器，无额外依赖）：

```bash
python3 scripts/test-xhs-download.py --rounds 3 --json-out results.json
python3 scripts/test-xhs-download.py --concurrency 1 --rounds 3
python3 scripts/test-xhs-download.py --save-dir /tmp/xhs-cover-1080p
```

脚本默认 width=1920、height=1080、concurrency=3。它不请求后端代理，不能替代接口集成测试。实现完成后需用相同三张原始 URL 请求实际代理并携带 image_mode=xhs_cover，核对以下项目：

1. 三个样本均返回 HTTP 200、image/jpeg、正确文件扩展名；实际解码尺寸满足 1920×1080 边界。上述样本应约为 185～215 KB，大小以 CDN 实际输出为准。
2. 原 png/heif 转换参数被替换，无参数的兼容 URL 转换正确；相同 URL 已含尺寸/格式时不会形成冲突。异常 URL、未知模式和非小红书 CDN 均有明确错误。
3. 小图不放大，竖图不拉伸；上游 403/404、超时、非 JPEG 响应和客户端断开时按预期释放连接和返回失败。
4. 不传 image_mode 的原有图片、视频下载行为通过回归验证。
5. 从插件实际导入新建表格与现有表格，确认小红书封面只走代理、最多三路下载，附件显示正常、原始封面链接保留，成功写表后 cursor 才推进。
6. 对比新样本的单张大小、冷/热请求耗时、整页完成耗时及失败率；分开统计下载、附件 SDK 处理和写表，避免将 CDN 基线当成端到端耗时。

部署顺序：先部署支持新模式的后端并验证缩略图响应，再发布直接走代理和有限并发的前端。旧后端可能忽略新参数并仍返回大图，因此前端发布前必须确认实际线上代理已执行尺寸转换。
