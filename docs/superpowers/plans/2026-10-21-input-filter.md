# 输入行筛选实施计划

> 按已确认的会话设计和 `feishu-input-filter-collapsed.html` 原型，由当前会话直接实施。

**目标：** 在作品详情、作者信息、作者作品中，按源表字段过滤参与执行的行。

**设计：** 共用条件编辑器与匹配工具；条件组内 AND、组间 OR。输入范围保持纵向；筛选默认收起，标题整行点击与字段映射一致，右侧 CSS 箭头，显示条件数，无重复下边框或预览区域；展开后显示说明“在所选输入行范围内，仅获取符合筛选条件的数据。”，有条件时右侧显示“清除条件”。每条条件有可见的 × 删除按钮；空组自动移除。

**技术：** Vue 3、Element Plus、飞书 JS SDK；定时后端 Python。

## 契约与兼容

- 新增可选 `snapshot.input_filter = { version: 1, table_id, groups: [[{ field_id, field_name, field_type, operator, value }]] }`。无规则不传该字段，旧任务保持原行为。
- 仅表格来源使用。支持文本(1)、单选(3)、复选框(7)。单选保存选项 ID；运行时按最新元数据解析。字段名称只展示。
- 文本支持 eq/ne/contains/not_contains/empty/not_empty；单选支持 eq/ne/empty/not_empty；复选框支持 eq/ne，值为布尔。
- 有筛选时先取范围再匹配，不为了凑满 N 行向后补齐；无筛选的旧定时前 N 有效链接语义保留。
- 规则不完整、字段删除、字段类型变化、选项删除、读取失败均阻止执行，不能回退到全量。0 匹配不调用社媒 API、不创建输出字段/表。
- 主页面选中行仍可选；沿用现有定时保存校验。不构建 dist，不部署；代码提交按用户明确授权执行。

## 实施步骤

- [x] 用 Node 内置测试覆盖 AND/OR、空值与 false、单条删除、无规则兼容、源表及字段/选项失效、读取失败。
- [x] 实现 `src/utils/inputFilter.mjs` 和 `src/components/InputFilterEditor.vue`。
- [x] 三页面接入主表单、编辑草稿、深拷贝、snapshot、立即执行；按源表校验字段，编辑旧任务时防止误绑定其他表。
- [x] 后端增加规则验证与源行匹配，读取链接列及条件列；用隔离测试覆盖前 N 不补齐与旧任务兼容。
- [x] 运行 Node/Python 隔离测试、Vue SFC 编译检查与本地组件交互检查；记录无法验证的真实飞书上下文。

## 审查重点

1. 单选选项改名沿用 ID，删除后明确失败。
2. 复选框 false 不是缺失值，空文本与读取失败分开。
3. 前 N 范围包含空链接，不因筛选而补齐。
4. 作者作品在链接去重前筛选。
5. 主页面与任务编辑不共享条件数组，条件不能被主表单 watcher 覆盖。

## 执行记录

- 前端使用现有 `codex/scheduled-update-conditions-design`，后端新建 `codex/feishu-input-filter`，保留已有未跟踪文件。
- 前端依赖通过 `npm ci --ignore-scripts` 安装，未执行构建。
- 本机无 conda，后端使用已有 pyenv sociallotto Python 的标准库 unittest 运行无外部依赖测试。

- 验证结果：`node --test tests/*.test.mjs` 9 项通过；四个 Vue 文件通过 SFC 脚本/模板编译检查；前后端 `git diff --check` 通过。
- 后端验证：`/Users/devin/.pyenv/versions/sociallotto/bin/python -m unittest scripts.tests.test_feishu_input_filter -v` 8 项通过，包含实际 snapshot 校验及源行读取函数的隔离测试。
- 实际组件交互：使用真实 InputFilterEditor + Element Plus，在隔离 SDK 元数据下验证默认收起、展开、状态选项、AND/OR 添加、单条删除、空组移除、删末条恢复 null。
- 尚未验证：真实飞书 SDK/API 联调、实际任务创建及定时 Worker 执行；本地无 baseopensdk，隔离测试不代表线上 SDK 验收。未构建、提交或部署。

## 发布顺序

先部署包含 input_filter 校验和匹配的后端 API 与定时 Worker，再发布前端；旧后端不会执行新增条件，不能单独上线前端。验收时用少量测试行分别验证立即执行与定时任务：状态切换后只更新当前满足条件的行、无匹配不写入、选项改名继续生效、删除字段或选项明确失败。无条件的旧任务继续使用原有执行语义。

## 2026-10-22 提交前验证

- 前端 `node --test tests/*.test.mjs`：179 项通过。
- 后端使用已有 pyenv sociallotto 环境运行 `python -m unittest scripts.tests.test_feishu_input_filter scripts.tests.test_feishu_schedule_concurrency scripts.tests.test_feishu_schedule_target -q`：28 项通过。
- 以上为本地隔离验证，不代表真实飞书或定时 Worker 联调通过；未构建或部署。
