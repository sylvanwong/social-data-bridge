<script setup>
import { bitable, FieldType } from "@lark-base-open/js-sdk";
import { ref, onMounted, onUnmounted } from "vue";
import { ElNotification } from "element-plus";
import request from "@/utils/request";

const emit = defineEmits(["back"]);

const props = defineProps({
  api_key: String,
});

const formData = ref({
  videoLinkFieldId: "",
  scope: "n",
  rowCount: 5,
});

const FIELD_CONFIG = [
  { name: "摘要", type: FieldType.Text, getValue: (item) => getSummary(item) },
  { name: "文案", type: FieldType.Text, getValue: (item) => getVideoCopy(item) },
  { name: "平台", type: FieldType.Text, getValue: (item) => item?.platform ?? "" },
  // { name: "任务状态", type: FieldType.Text, getValue: (item) => item?.status ?? "" },
  // { name: "失败原因", type: FieldType.Text, getValue: (item) => item?.error || item?.summary_error || "" },
  // { name: "更新时间", type: FieldType.DateTime, getValue: (item) => (item?.updated_at ? item.updated_at * 1000 : Date.now()) },
];

const fieldOptions = ref([]);
const loading = ref(false);
const toastVisible = ref(false);
const toastText = ref("");
const toastLoading = ref(false);
let isUnmounted = false;

function getFirstValidValue(values = []) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function getVideoCopy(item) {
  if (typeof item === "string") {
    return item.trim();
  }
  return getFirstValidValue([
    item?.transcript?.text,
    item?.copywriting,
    item?.script,
    item?.content,
    item?.caption,
    item?.transcript,
    item?.text,
    item?.desc,
    item?.description,
  ]);
}

function getSummary(item) {
  if (typeof item === "string") {
    return item.trim();
  }
  if (item?.status === "succeeded" && !item?.summary && item?.summary_error) {
    return item.summary_error.trim();
  }
  return getFirstValidValue([
    item?.summary,
    item?.abstract,
    item?.digest,
    item?.result,
    item?.brief,
    item?.outline,
    item?.content_summary,
  ]);
}

const getFieldListByType = async () => {
  try {
    const table = await bitable.base.getActiveTable();
    const fieldList = await table.getFieldList();

    const urlFieldList = fieldList.filter(
      (item) => item.type === FieldType.Url || item.type === FieldType.Text
    );

    fieldOptions.value = await Promise.all(
      urlFieldList.map(async (field) => ({
        id: field.id,
        name: await field.getName(),
      }))
    );
  } catch (error) {
    console.error("获取字段列表失败:", error);
    fieldOptions.value = [{ id: "nodata", name: "获取字段列表失败" }];
    ElNotification({
      message: "当前未在数据表页面，无法读取字段信息。请先打开目标数据表，再重试操作。",
      type: "error",
      duration: 0,
    });
  }
};

const getAllVisibleRecordIdList = async (view) => {
  const pageSize = 200;
  let pageToken = undefined;
  let allRecordIdList = [];
  let loopCount = 0;
  const maxLoops = 100;

  while (loopCount < maxLoops) {
    loopCount++;
    const result = await view.getVisibleRecordIdListByPage({
      pageSize,
      pageToken,
    });

    let recordIds = [];
    let hasMore = false;

    if (Array.isArray(result)) {
      recordIds = result;
      hasMore = result.length === pageSize;
    } else if (result && typeof result === "object") {
      recordIds = result.recordIds || result.records || result.data || result.list || [];
      hasMore = result.hasMore || result.hasNext || result.has_next || false;
      pageToken = result.pageToken || result.nextPageToken || result.next_token;
    }

    if (recordIds.length > 0) {
      allRecordIdList = allRecordIdList.concat(recordIds);
    }

    if (!hasMore || recordIds.length === 0) {
      break;
    }
  }

  return allRecordIdList;
};

const getRecordIdListByScope = async (scope, rowCount) => {
  const table = await bitable.base.getActiveTable();
  const view = await table.getActiveView();

  let recordIdList = [];
  if (scope === "all") {
    recordIdList = await getAllVisibleRecordIdList(view);
  } else if (scope === "selected") {
    recordIdList = await view.getSelectedRecordIdList();
    if (recordIdList.length === 0) {
      ElNotification({ message: "请先在表格中选择至少一行数据", type: "warning", duration: 0 });
      return null;
    }
  } else {
    const allRecordIdList = await getAllVisibleRecordIdList(view);
    recordIdList = allRecordIdList.slice(0, rowCount);
  }
  return recordIdList;
};

const validateAndAddFields = async () => {
  try {
    const table = await bitable.base.getActiveTable();
    const fieldList = await table.getFieldList();
    const fieldMetaMap = new Map();

    for (const field of fieldList) {
      const name = await field.getName();
      fieldMetaMap.set(name, { id: field.id, type: field.type });
    }

    const missingFields = [];
    const typeMismatchFields = [];

    for (const config of FIELD_CONFIG) {
      const fieldMeta = fieldMetaMap.get(config.name);
      if (!fieldMeta) {
        missingFields.push(config);
      } else if (fieldMeta.type !== config.type) {
        typeMismatchFields.push({
          name: config.name,
          expected: config.type,
          actual: fieldMeta.type,
        });
      }
    }

    if (typeMismatchFields.length > 0) {
      const errorMsg = typeMismatchFields.map((field) => `"${field.name}" 类型不匹配`).join(", ");
      ElNotification({ message: `字段类型错误: ${errorMsg}`, type: "error", duration: 0 });
      return null;
    }

    for (const fieldConfig of missingFields) {
      try {
        const newFieldId = await table.addField({
          type: fieldConfig.type,
          name: fieldConfig.name,
        });
        fieldMetaMap.set(fieldConfig.name, { id: newFieldId, type: fieldConfig.type });
      } catch (error) {
        ElNotification({ message: `添加字段 "${fieldConfig.name}" 失败`, type: "error", duration: 0 });
        return null;
      }
    }

    const fieldNameToId = {};
    for (const [name, meta] of fieldMetaMap.entries()) {
      fieldNameToId[name] = meta.id;
    }

    if (missingFields.length > 0) {
      ElNotification({ message: `已自动添加 ${missingFields.length} 个字段`, type: "success" });
    }

    return fieldNameToId;
  } catch (error) {
    ElNotification({ message: `字段操作失败: ${error.message || error}`, type: "error", duration: 0 });
    return null;
  }
};

const writeDataToRecord = async (recordId, item, fieldNameToId) => {
  try {
    const table = await bitable.base.getActiveTable();

    for (const config of FIELD_CONFIG) {
      const fieldId = fieldNameToId[config.name];
      if (!fieldId) continue;

      try {
        const field = await table.getFieldById(fieldId);
        await field.setValue(recordId, config.getValue(item));
      } catch (error) {
        console.error(`写入字段 ${config.name} 失败:`, error);
      }
    }
  } catch (error) {
    console.error("写入记录失败:", error);
    throw error;
  }
};

const extractVideoLink = (value) => {
  if (!value) return null;

  if (typeof value === "string") {
    return value.trim() || null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      if (item.type === "url" && item.link) {
        return item.link.trim() || null;
      }
    }
  }

  return null;
};

const getRecordEntriesByFieldId = async (recordIdList, fieldId) => {
  const table = await bitable.base.getActiveTable();
  const field = await table.getFieldById(fieldId);

  const entries = await Promise.all(
    recordIdList.map(async (recordId) => {
      try {
        const cell = await field.getCell(recordId);
        const value = await cell.getValue();
        const url = extractVideoLink(value);
        return url ? { recordId, url } : null;
      } catch (error) {
        return null;
      }
    })
  );

  return entries.filter(Boolean);
};

const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const createMediaTask = async (url) => {
  const response = await request({
    url: "/social/api/v1/feishu/media/task",
    method: "post",
    headers: { authorization: `Bearer ${props.api_key}` },
    data: { url, force_refresh: false },
  });

  const res = response.data;
  if (res.sta !== 0 || !res.data?.task_id) {
    throw new Error(res.msg || "创建提取任务失败");
  }
  return res.data;
};

const pollMediaTask = async (taskId, initialNextPollSeconds = 3) => {
  const maxPollCount = 120;
  let nextPollSeconds = initialNextPollSeconds || 3;

  for (let pollCount = 0; pollCount < maxPollCount; pollCount++) {
    if (isUnmounted) {
      throw new Error("页面已关闭，任务已停止");
    }

    await sleep(Math.max(nextPollSeconds, 1) * 1000);

    const response = await request({
      url: "/social/api/v1/feishu/media/task/get",
      method: "post",
      headers: { authorization: `Bearer ${props.api_key}` },
      data: { task_id: taskId },
    });

    const res = response.data;
    if (res.sta !== 0 || !res.data) {
      throw new Error(res.msg || "查询任务状态失败");
    }

    const taskData = res.data;
    if (taskData.status === "succeeded") {
      return taskData;
    }

    if (taskData.status === "queued" || taskData.status === "running") {
      nextPollSeconds = taskData.next_poll_after_seconds || 3;
      continue;
    }

    if (taskData.status === "failed") {
      throw new Error(taskData.error || taskData.summary_error || "视频文案摘要提取失败");
    }

    throw new Error(`任务状态异常: ${taskData.status || "unknown"}`);
  }

  throw new Error("任务处理超时，请稍后重试");
};

const handleSubmit = async () => {
  if (!props.api_key) {
    ElNotification({ message: "请先设置API Key", type: "warning", duration: 0 });
    return;
  }

  if (!formData.value.videoLinkFieldId) {
    ElNotification({ message: "请选择视频链接字段", type: "warning", duration: 0 });
    return;
  }

  if (formData.value.videoLinkFieldId === "nodata") {
    ElNotification({
      message: "未在数据表页面，无法读取字段信息。请先打开目标数据表，再重试操作。",
      type: "error",
      duration: 0,
    });
    return;
  }

  loading.value = true;

  try {
    const recordIdList = await getRecordIdListByScope(formData.value.scope, formData.value.rowCount);
    if (!recordIdList) {
      loading.value = false;
      return;
    }

    const fieldNameToId = await validateAndAddFields();
    if (!fieldNameToId) {
      loading.value = false;
      return;
    }

    const recordEntries = await getRecordEntriesByFieldId(recordIdList, formData.value.videoLinkFieldId);
    if (recordEntries.length === 0) {
      ElNotification({ message: "未读取到有效的视频链接", type: "warning", duration: 0 });
      loading.value = false;
      return;
    }

    let successCount = 0;
    let failCount = 0;

    showToast(`准备处理 ${recordEntries.length} 条数据...`, true);

    for (let i = 0; i < recordEntries.length; i++) {
      const { url, recordId } = recordEntries[i];

      try {
        showToast(`正在提交第 ${i + 1}/${recordEntries.length} 条任务...`, true);
        const task = await createMediaTask(url);

        showToast(`第 ${i + 1}/${recordEntries.length} 条任务处理中...`, true);
        const result = await pollMediaTask(task.task_id, task.next_poll_after_seconds);

        await writeDataToRecord(recordId, result, fieldNameToId);
        successCount++;
      } catch (error) {
        ElNotification({ message: error.message || "请求失败", type: "error", duration: 0 });
        failCount++;
      }
    }

    showToast(`处理完成：成功 ${successCount} 条，失败 ${failCount} 条`, false);
    setTimeout(() => {
      hideToast();
    }, 3000);
  } catch (error) {
    ElNotification({ message: error.message || "获取数据失败", type: "error", duration: 0 });
  } finally {
    loading.value = false;
  }
};

const stepNumber = (delta) => {
  let val = formData.value.rowCount || 5;
  val = Math.max(1, Math.min(100, val + delta));
  formData.value.rowCount = val;
};

const showToast = (text, isLoading = true) => {
  toastText.value = text;
  toastLoading.value = isLoading;
  toastVisible.value = true;
};

const hideToast = () => {
  toastVisible.value = false;
};

onMounted(() => {
  getFieldListByType();
});

onUnmounted(() => {
  isUnmounted = true;
});
</script>

<template>
  <div class="sub-page">
    <div class="sub-page-header">
      <span class="sub-page-back" @click="emit('back')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16">
          <polyline points="15 18 9 12 15 6"></polyline>
        </svg>
      </span>
      <span class="sub-page-title">视频文案摘要</span>
    </div>
    <div class="form-card">
      <el-form ref="form" class="form" :model="formData" label-position="top">
        <el-form-item label="">
          <div slot="label" class="c-label">
            视频链接
            <el-tooltip effect="dark" placement="top">
              <template #content>支持抖音、小红书、快手平台的视频链接</template>
              <img
                src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png"
                class="help-icon"
              />
            </el-tooltip>
          </div>
          <el-select
            v-model="formData.videoLinkFieldId"
            placeholder="选择包含视频链接的字段"
            style="width: 100%"
          >
            <el-option v-for="field in fieldOptions" :key="field.id" :label="field.name" :value="field.id" />
          </el-select>
        </el-form-item>

        <el-form-item label="" style="margin-top: 12px">
          <div slot="label" class="c-label">
            数据范围
            <el-tooltip effect="dark" placement="top">
              <template #content>选择要执行的数据范围</template>
              <img
                src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png"
                class="help-icon"
              />
            </el-tooltip>
          </div>
          <el-radio-group v-model="formData.scope" class="custom-radio-group">
            <el-radio value="all" class="custom-radio-item">执行所有行</el-radio>
            <el-radio value="selected" class="custom-radio-item">执行选中行</el-radio>
            <el-radio value="n" class="custom-radio-item">
              <span class="radio-label-text">执行前N行</span>
              <div class="custom-stepper-input">
                <input
                  type="number"
                  :value="formData.rowCount"
                  @input.stop="formData.rowCount = Math.max(1, Math.min(100, parseInt($event.target.value) || 5))"
                  @click.stop
                  min="1"
                  max="100"
                />
                <div class="stepper-buttons">
                  <button
                    type="button"
                    @click.stop="stepNumber(1)"
                    :disabled="formData.rowCount >= 100"
                    class="stepper-btn stepper-btn-up"
                  ></button>
                  <button
                    type="button"
                    @click.stop="stepNumber(-1)"
                    :disabled="formData.rowCount <= 1"
                    class="stepper-btn stepper-btn-down"
                  ></button>
                </div>
              </div>
            </el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>

      <el-button color="#a8071a" class="commit-btn" :loading="loading" @click="handleSubmit">提交</el-button>
    </div>

    <div class="toast-wrap" :class="{ show: toastVisible }">
      <div class="toast" :class="{ 'toast-loading': toastLoading, 'toast-success': !toastLoading }">
        <div class="toast-icon" v-if="toastLoading">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <path d="M12 2a10 10 0 0 1 10 10"></path>
          </svg>
        </div>
        <div class="toast-icon" v-else>
          <svg viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" fill="#00B42A"></circle>
            <path
              d="M8 12l2.5 2.5L16 9"
              stroke="#FFFFFF"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            ></path>
          </svg>
        </div>
        <span>{{ toastText }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sub-page {
  min-height: 100vh;
  background: #fffcfc;
}
.sub-page-header {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  background: #ffffff;
  border-bottom: 1px solid #e5e6eb;
  position: sticky;
  top: 0;
  z-index: 100;
}
.sub-page-back {
  width: 20px;
  height: 20px;
  cursor: pointer;
  color: #4e5969;
  transition: color 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 12px;
}
.sub-page-back:hover {
  color: #a8071a;
}
.sub-page-back svg {
  width: 100%;
  height: 100%;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.sub-page-title {
  font-size: 15px;
  font-weight: 600;
  color: #1d2129;
  line-height: 24px;
}
.form-card {
  margin: 16px;
  padding: 20px;
  background: #ffffff;
  border: 1px solid #e5e6eb;
  border-radius: 8px;
  box-sizing: border-box;
}
.form :deep(.el-form-item__label) {
  font-size: 14px;
  color: #1d2129;
  margin-bottom: 8px;
}
.form :deep(.el-form-item__content) {
  font-size: 14px;
}
.commit-btn {
  background: #a8071a;
  width: 100%;
  height: 40px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: #fff;
  font-size: 14px;
  font-weight: 500;
  margin-top: 0;
  cursor: pointer;
  border: none;
  transition: background 0.2s ease;
}
.commit-btn:hover {
  background: #c11126;
}
.commit-btn:active {
  background: #8a0515;
}
.c-label {
  display: flex;
  align-items: center;
}
.help-icon {
  width: 16px;
  height: 16px;
  margin-left: 4px;
}
.custom-radio-group {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
}
.custom-radio-group :deep(.el-radio) {
  margin-right: 0;
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  width: 100%;
}
.custom-radio-group :deep(.el-radio__input) {
  margin-right: 8px;
  flex-shrink: 0;
}
.custom-radio-group :deep(.el-radio__inner) {
  width: 16px;
  height: 16px;
  border-color: #e5e6eb;
  background: #ffffff;
  transition: all 0.2s;
}
.custom-radio-group :deep(.el-radio:hover .el-radio__inner) {
  border-color: #86909c;
}
.custom-radio-group :deep(.el-radio__input.is-checked .el-radio__inner) {
  border-color: #a8071a;
  background: #ffffff;
  border-width: 4px;
}
.custom-radio-group :deep(.el-radio__inner::after) {
  display: none;
}
.custom-radio-group :deep(.el-radio__label) {
  font-size: 14px;
  color: #1d2129;
  line-height: 22px;
  padding-left: 0;
  display: flex;
  align-items: center;
  width: 100%;
}
.radio-label-text {
  flex-shrink: 0;
}
.custom-stepper-input {
  display: flex;
  align-items: center;
  height: 32px;
  width: 80px;
  margin-left: auto;
  background: #ffffff;
  border: 1px solid #e5e6eb;
  border-radius: 6px;
  overflow: hidden;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.custom-stepper-input:hover {
  border-color: #86909c;
}
.custom-stepper-input:focus-within {
  border-color: #a8071a;
  box-shadow: 0 0 0 3px rgba(168, 7, 26, 0.2);
}
.custom-stepper-input input {
  flex: 1;
  height: 100%;
  width: 44px;
  padding: 0 8px;
  font-size: 14px;
  color: #1d2129;
  border: none;
  outline: none;
  background: transparent;
  text-align: center;
  font-family: inherit;
  line-height: 30px;
  -moz-appearance: textfield;
}
.custom-stepper-input input::-webkit-outer-spin-button,
.custom-stepper-input input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.stepper-buttons {
  display: flex;
  flex-direction: column;
  width: 28px;
  height: 100%;
  border-left: 1px solid #e5e6eb;
  flex-shrink: 0;
  background: #f2f3f5;
}
.stepper-btn {
  flex: 1;
  width: 100%;
  border: none;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  transition: all 0.15s ease;
  position: relative;
}
.stepper-btn-up {
  border-bottom: 1px solid #e5e6eb;
}
.stepper-btn::before {
  content: "";
  width: 0;
  height: 0;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  transition: border-color 0.15s;
}
.stepper-btn-up::before {
  border-bottom: 4px solid #86909c;
}
.stepper-btn-down::before {
  border-top: 4px solid #86909c;
}
.stepper-btn:not(:disabled):hover {
  background: #fff0f2;
}
.stepper-btn-up:not(:disabled):hover::before {
  border-bottom-color: #a8071a;
}
.stepper-btn-down:not(:disabled):hover::before {
  border-top-color: #a8071a;
}
.stepper-btn:not(:disabled):active {
  background: #ffb3bb;
}
.stepper-btn:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}
.stepper-btn:disabled:hover {
  background: transparent;
}
.toast-wrap {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) scale(0.95);
  z-index: 9999;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.3s ease, transform 0.3s ease;
}
.toast-wrap.show {
  opacity: 1;
  transform: translate(-50%, -50%) scale(1);
}
.toast {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 18px;
  background: #ffffff;
  border: 1px solid #e5e6eb;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  font-size: 14px;
  font-weight: 500;
  color: #1d2129;
  white-space: nowrap;
}
.toast-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.toast-loading .toast-icon {
  animation: spin 0.8s linear infinite;
  color: #a8071a;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
