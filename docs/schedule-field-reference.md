# schedule 字段说明

## 目的

本文档用于给后端对接 `博主信息定时任务` 的 `schedule` 参数。

当前日期为 `2026-07-16`。以下示例日期均以当前前端实现为准。

## 结构示例

```json
{
  "trigger_date": "2026-07-20",
  "trigger_time": "09:30",
  "repeat_type": "custom",
  "freq_num": 2,
  "freq_unit": "week",
  "deadline_type": "date",
  "deadline_date": "2026-12-31",
  "enabled": true
}
```

## 字段说明

### `trigger_date`

- 类型：`string`
- 含义：首次触发日期
- 格式：`YYYY-MM-DD`
- 示例：`2026-07-20`
- 备注：
  - `repeat_type = hourly` 时，当前前端会传空字符串 `""`
  - 其他类型通常传具体日期

### `trigger_time`

- 类型：`string`
- 含义：触发时分
- 格式：`HH:mm`
- 示例：`09:30`

### `repeat_type`

- 类型：`string`
- 含义：重复类型
- 当前前端可传值：
  - `none`：不重复
  - `hourly`：每小时重复
  - `daily`：每天重复
  - `weekly`：每周重复
  - `monthly`：每月重复
  - `yearly`：每年重复
  - `workday`：周一到周五重复
  - `custom`：自定义

### `freq_num`

- 类型：`number`
- 含义：自定义重复频率的数值部分
- 示例：`1`、`2`、`7`
- 备注：
  - 只有 `repeat_type = custom` 时有实际意义
  - 非 `custom` 时，当前前端会传 `1`

### `freq_unit`

- 类型：`string`
- 含义：自定义重复频率的单位部分
- 当前前端可传值：
  - `hour`：小时
  - `day`：天
  - `week`：周
  - `month`：个月
  - `year`：年
- 备注：
  - 只有 `repeat_type = custom` 时有实际意义
  - 非 `custom` 时，当前前端会传空字符串 `""`

### `deadline_type`

- 类型：`string`
- 含义：自定义重复的结束方式
- 当前前端可传值：
  - `never`：永不结束
  - `date`：截止到指定日期
- 备注：
  - 只有 `repeat_type = custom` 时有实际意义
  - 非 `custom` 时，当前前端会传空字符串 `""`

### `deadline_date`

- 类型：`string`
- 含义：自定义重复的截止日期
- 格式：`YYYY-MM-DD`
- 示例：`2026-12-31`
- 备注：
  - 只有 `repeat_type = custom` 且 `deadline_type = date` 时有值
  - 其他情况下当前前端会传空字符串 `""`

### `enabled`

- 类型：`boolean`
- 含义：任务是否启用
- 可选值：
  - `true`：启用
  - `false`：禁用

## 组合说明

### 1. 不重复

```json
{
  "trigger_date": "2026-07-20",
  "trigger_time": "09:30",
  "repeat_type": "none",
  "freq_num": 1,
  "freq_unit": "",
  "deadline_type": "",
  "deadline_date": "",
  "enabled": true
}
```

后端建议：

- 按单次任务处理
- 执行后可直接标记完成，或由业务决定是否保留任务记录

### 2. 每小时重复

```json
{
  "trigger_date": "",
  "trigger_time": "09:30",
  "repeat_type": "hourly",
  "freq_num": 1,
  "freq_unit": "",
  "deadline_type": "",
  "deadline_date": "",
  "enabled": true
}
```

后端建议：

- 忽略 `trigger_date`
- 仅基于 `trigger_time` 的分钟部分处理

### 3. 固定周期重复

以“每天重复”为例：

```json
{
  "trigger_date": "2026-07-20",
  "trigger_time": "09:30",
  "repeat_type": "daily",
  "freq_num": 1,
  "freq_unit": "",
  "deadline_type": "",
  "deadline_date": "",
  "enabled": true
}
```

同类还包括：

- `weekly`
- `monthly`
- `yearly`
- `workday`

后端建议：

- 非 `custom` 时忽略 `freq_num/freq_unit/deadline_type/deadline_date`

### 4. 自定义重复

#### 永不结束

```json
{
  "trigger_date": "2026-07-20",
  "trigger_time": "09:30",
  "repeat_type": "custom",
  "freq_num": 2,
  "freq_unit": "week",
  "deadline_type": "never",
  "deadline_date": "",
  "enabled": true
}
```

#### 指定截止日期

```json
{
  "trigger_date": "2026-07-20",
  "trigger_time": "09:30",
  "repeat_type": "custom",
  "freq_num": 2,
  "freq_unit": "week",
  "deadline_type": "date",
  "deadline_date": "2026-12-31",
  "enabled": true
}
```

后端建议：

- `custom` 时使用：
  - `freq_num`
  - `freq_unit`
  - `deadline_type`
  - `deadline_date`

## 后端处理建议

- `repeat_type = hourly` 时，忽略 `trigger_date`
- `repeat_type != custom` 时，忽略：
  - `freq_num`
  - `freq_unit`
  - `deadline_type`
  - `deadline_date`
- `deadline_type = never` 时，忽略 `deadline_date`
- `deadline_type = date` 时，应校验 `deadline_date` 非空且格式合法
- `enabled = false` 时，不应进入调度执行

## 文件位置

当前文档路径：

- [schedule-field-reference.md](/usr/local/var/www/social-data-bridge/docs/schedule-field-reference.md:1)
