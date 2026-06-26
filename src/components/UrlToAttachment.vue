<script setup>
import { bitable, FieldType } from "@lark-base-open/js-sdk";
import { ref, onMounted } from "vue";
import { ElNotification } from "element-plus";

const emit = defineEmits(['back']);

const props = defineProps({
  api_key: String,
});

const formData = ref({
  urlFieldId: '',
  scope: 'n',
  rowCount: 5,
});

const FIELD_CONFIG = [
  {
    key: 'attachment',
    name: '附件',
    type: FieldType.Attachment,
    defaultSelected: true,
    getUrls: (item) => {
      const value = item?.download_addr || item?.url || item?.link;
      if (typeof value === 'string') {
        return value
          .split(/\s+/)
          .map((url) => httpToHttps(url))
          .filter(Boolean);
      }
      return [];
    },
    getFileName: () => 'attachment',
  },
];

const FIELD_TYPE_NAME = {
  [FieldType.Attachment]: '附件',
};

const httpToHttps = (url) => {
  if (typeof url === 'string') {
    return url.replace(/^http:\/\//i, 'https://');
  }
  return url;
};

const getFileExtension = (url) => {
  if (typeof url !== 'string') return '.jpg';

  const cleanUrl = url.split('?')[0].split('#')[0];
  const extMatch = cleanUrl.match(/\.([a-zA-Z0-9]{2,5})$/);
  if (extMatch) {
    return `.${extMatch[1].toLowerCase()}`;
  }

  if (cleanUrl.includes('video')) {
    return '.mp4';
  }

  return '.jpg';
};

const getFinalFileName = (url, baseName, index, total) => {
  const ext = getFileExtension(url);
  const name = total > 1 ? `${index + 1}_${baseName}` : baseName;
  return `${name}${ext}`;
};

const fieldOptions = ref([]);
const loading = ref(false);
const toastVisible = ref(false);
const toastText = ref('');
const toastLoading = ref(false);
const ACTIVE_FIELD_CONFIGS = FIELD_CONFIG;

const getFieldListByType = async () => {
  try {
    const table = await bitable.base.getActiveTable();
    const fieldList = await table.getFieldList();
    const urlFieldList = fieldList.filter((item) =>
      item.type === FieldType.Url || item.type === FieldType.Text
    );

    fieldOptions.value = await Promise.all(
      urlFieldList.map(async (field) => ({
        id: field.id,
        name: await field.getName(),
      }))
    );
  } catch (error) {
    console.error('获取字段列表失败:', error);
    fieldOptions.value = [{ id: 'nodata', name: '获取字段列表失败' }];
    ElNotification({ message: '当前未在数据表页面，无法读取字段信息。请先打开目标数据表，再重试操作。', type: 'error', duration: 0 });
  }
};

const getAllVisibleRecordIdList = async (view) => {
  const pageSize = 200;
  let pageToken;
  const allRecordIdList = [];
  let loopCount = 0;
  const maxLoops = 100;

  while (loopCount < maxLoops) {
    loopCount += 1;
    const result = await view.getVisibleRecordIdListByPage({ pageSize, pageToken });

    let recordIds = [];
    let hasMore = false;

    if (Array.isArray(result)) {
      recordIds = result;
      hasMore = result.length === pageSize;
    } else if (result && typeof result === 'object') {
      recordIds = result.recordIds || result.records || result.data || result.list || [];
      hasMore = result.hasMore || result.hasNext || result.has_next || false;
      pageToken = result.pageToken || result.nextPageToken || result.next_token;
    }

    if (recordIds.length > 0) {
      allRecordIdList.push(...recordIds);
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

  if (scope === 'all') {
    return await getAllVisibleRecordIdList(view);
  }

  if (scope === 'selected') {
    const recordIdList = await view.getSelectedRecordIdList();
    if (recordIdList.length === 0) {
      ElNotification({ message: '请先在表格中选择至少一行数据', type: 'warning', duration: 0 });
      return null;
    }
    return recordIdList;
  }

  const allRecordIdList = await getAllVisibleRecordIdList(view);
  return allRecordIdList.slice(0, rowCount);
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

    for (const config of ACTIVE_FIELD_CONFIGS) {
      const fieldMeta = fieldMetaMap.get(config.name);
      if (!fieldMeta) {
        missingFields.push(config);
      } else if (fieldMeta.type !== config.type) {
        typeMismatchFields.push({
          name: config.name,
          expected: FIELD_TYPE_NAME[config.type] || config.type,
          actual: fieldMeta.type,
        });
      }
    }

    if (typeMismatchFields.length > 0) {
      const errorMsg = typeMismatchFields
        .map((field) => `"${field.name}" 类型不匹配，仅支持${field.expected}`)
        .join(', ');
      ElNotification({ message: `字段类型错误: ${errorMsg}`, type: 'error', duration: 0 });
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
        ElNotification({ message: `添加字段 "${fieldConfig.name}" 失败`, type: 'error', duration: 0 });
        return null;
      }
    }

    const fieldNameToId = {};
    for (const [name, meta] of fieldMetaMap.entries()) {
      fieldNameToId[name] = meta.id;
    }

    return fieldNameToId;
  } catch (error) {
    ElNotification({ message: `字段操作失败: ${error.message || error}`, type: 'error', duration: 0 });
    return null;
  }
};

const buildProxyDownloadUrl = (url, fileName) => {
  const params = new URLSearchParams({
    url,
    file_name: fileName,
  });
  return `/social/api/v1/feishu/xhs_download_proxy?${params.toString()}`;
};

const downloadAttachmentAsFile = async (url, finalName) => {
  const response = await fetch(buildProxyDownloadUrl(url, finalName), {
    headers: { authorization: `Bearer ${props.api_key}` },
  });

  if (!response.ok) {
    throw new Error(`下载失败: HTTP ${response.status}`);
  }

  const blob = await response.blob();
  return new File([blob], finalName, { type: blob.type || 'application/octet-stream' });
};

const writeDataToRecord = async (recordId, urls, fieldNameToId, activeFieldConfigs) => {
  const table = await bitable.base.getActiveTable();

  for (const config of activeFieldConfigs) {
    const fieldId = fieldNameToId[config.name];
    if (!fieldId) continue;

    try {
      const field = await table.getField(fieldId);
      const normalizedUrls = (Array.isArray(urls) ? urls : [urls])
        .filter((url) => url && typeof url === 'string')
        .map((url) => url.replace(/^http:\/\//i, 'https://'));

      if (normalizedUrls.length > 0) {
        try {
          const files = await Promise.all(
            normalizedUrls.map(async (url, index) => {
              const baseName = config.getFileName();
              const finalName = getFinalFileName(url, baseName, index, normalizedUrls.length);
              return downloadAttachmentAsFile(url, finalName);
            })
          );
          await field.setValue(recordId, files.length === 1 ? files[0] : files);
        } catch (error) {
          console.log('附件下载失败，跳过附件写入:', error);
        }
      }
    } catch (error) {
      console.error(`写入字段 ${config.name} 失败:`, error);
    }
  }
};

const extractUrl = (value) => {
  if (!value) return null;

  if (typeof value === 'string') {
    return value.trim() || null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      if (item?.type === 'url' && item?.link) {
        return item.link;
      }
    }
  }

  return null;
};

const extractUrls = (value) => {
  if (!value) return [];

  if (typeof value === 'string') {
    return value
      .split(/\s+/)
      .map((url) => url.trim())
      .filter(Boolean);
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') {
          return item.trim();
        }
        if (item?.type === 'url' && item?.link) {
          return item.link.trim();
        }
        return '';
      })
      .filter(Boolean);
  }

  return [];
};

const getCellValuesByFieldId = async (recordIdList, fieldId) => {
  const table = await bitable.base.getActiveTable();
  const field = await table.getFieldById(fieldId);

  const rows = await Promise.all(
    recordIdList.map(async (recordId) => {
      try {
        const cell = await field.getCell(recordId);
        const value = await cell.getValue();
        const urls = extractUrls(value);
        return urls.length > 0 ? { recordId, urls } : null;
      } catch (error) {
        return null;
      }
    })
  );

  return rows.filter((item) => item && Array.isArray(item.urls) && item.urls.length > 0);
};

const showToast = (text, isLoading = true) => {
  toastText.value = text;
  toastLoading.value = isLoading;
  toastVisible.value = true;
};

const hideToast = () => {
  toastVisible.value = false;
};

const stepNumber = (delta) => {
  const nextValue = Math.max(1, Math.min(100, (formData.value.rowCount || 5) + delta));
  formData.value.rowCount = nextValue;
};

const handleSubmit = async () => {
  if (!props.api_key) {
    ElNotification({ message: '请先设置API Key', type: 'warning', duration: 0 });
    return;
  }

  if (!formData.value.urlFieldId) {
    ElNotification({ message: '请选择URL字段', type: 'warning', duration: 0 });
    return;
  }

  if (formData.value.urlFieldId === 'nodata') {
    ElNotification({ message: '当前未在数据表页面，无法读取字段信息。请先打开目标数据表，再重试操作。', type: 'error', duration: 0 });
    return;
  }

  loading.value = true;

  try {
    const recordIdList = await getRecordIdListByScope(formData.value.scope, formData.value.rowCount);
    if (!recordIdList) return;

    const fieldNameToId = await validateAndAddFields();
    if (!fieldNameToId) return;

    const rowList = await getCellValuesByFieldId(recordIdList, formData.value.urlFieldId);
    let successCount = 0;
    let failCount = 0;
    showToast(`准备处理 ${rowList.length} 条数据...`, true);

    for (let i = 0; i < rowList.length; i += 1) {
      const { urls, recordId } = rowList[i];
      try {
        showToast(`正在处理第 ${i + 1}/${rowList.length} 条...`, true);
        await writeDataToRecord(recordId, urls, fieldNameToId, ACTIVE_FIELD_CONFIGS);
        successCount += 1;
      } catch (error) {
        ElNotification({ message: error.message || '请求失败', type: 'error', duration: 0 });
        failCount += 1;
      }
    }

    showToast(`处理完成：成功 ${successCount} 条，失败 ${failCount} 条`, false);
    setTimeout(() => hideToast(), 3000);
  } catch (error) {
    ElNotification({ message: error.message || '获取数据失败', type: 'error', duration: 0 });
  } finally {
    loading.value = false;
  }
};

onMounted(() => {
  getFieldListByType();
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
      <span class="sub-page-title">链接转附件</span>
    </div>
    <div class="form-card">
      <el-form class="form" :model="formData" label-position="top">
        <el-form-item label="">
          <div class="c-label">
            URL字段
            <el-tooltip effect="dark" placement="top">
              <template #content>支持文本或链接类型字段</template>
              <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png" class="help-icon" />
            </el-tooltip>
          </div>
          <el-select v-model="formData.urlFieldId" placeholder="选择包含URL的字段" style="width: 100%">
            <el-option v-for="field in fieldOptions" :key="field.id" :label="field.name" :value="field.id" />
          </el-select>
        </el-form-item>

        <el-form-item label="" style="margin-top: 12px">
          <div class="c-label">
            数据范围
            <el-tooltip effect="dark" placement="top">
              <template #content>选择要执行的数据范围</template>
              <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png" class="help-icon" />
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
                  <button @click.stop="stepNumber(1)" :disabled="formData.rowCount >= 100" class="stepper-btn stepper-btn-up"></button>
                  <button @click.stop="stepNumber(-1)" :disabled="formData.rowCount <= 1" class="stepper-btn stepper-btn-down"></button>
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
            <path d="M8 12l2.5 2.5L16 9" stroke="#FFFFFF" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path>
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
  background: #FFFFFF;
  border-bottom: 1px solid #E5E6EB;
  position: sticky;
  top: 0;
  z-index: 100;
}
.sub-page-back {
  width: 20px;
  height: 20px;
  cursor: pointer;
  color: #4E5969;
  transition: color 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 12px;
}
.sub-page-back:hover { color: #A8071A; }
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
  color: #1D2129;
  line-height: 24px;
}
.form-card {
  margin: 16px;
  padding: 20px;
  background: #FFFFFF;
  border: 1px solid #E5E6EB;
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
  background: #A8071A;
  width: 100%;
  height: 40px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 14px;
  font-weight: 500;
  margin-top: 0;
  cursor: pointer;
  border: none;
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
  border-color: #E5E6EB;
  background: #FFFFFF;
  transition: all 0.2s;
}

.custom-radio-group :deep(.el-radio:hover .el-radio__inner) {
  border-color: #86909C;
}

.custom-radio-group :deep(.el-radio__input.is-checked .el-radio__inner) {
  border-color: #A8071A;
  background: #FFFFFF;
  border-width: 4px;
}

.custom-radio-group :deep(.el-radio__inner::after) {
  display: none;
}

.custom-radio-group :deep(.el-radio__label) {
  font-size: 14px;
  color: #1D2129;
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
  background: #FFFFFF;
  border: 1px solid #E5E6EB;
  border-radius: 6px;
  overflow: hidden;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.custom-stepper-input:hover {
  border-color: #86909C;
}

.custom-stepper-input:focus-within {
  border-color: #A8071A;
  box-shadow: 0 0 0 3px rgba(168, 7, 26, 0.2);
}
.custom-stepper-input input {
  flex: 1;
  height: 100%;
  width: 44px;
  padding: 0 8px;
  font-size: 14px;
  color: #1D2129;
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
  border-left: 1px solid #E5E6EB;
  flex-shrink: 0;
  background: #F2F3F5;
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
  border-bottom: 1px solid #E5E6EB;
}

.stepper-btn::before {
  content: '';
  width: 0;
  height: 0;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  transition: border-color 0.15s;
}

.stepper-btn-up::before {
  border-bottom: 4px solid #86909C;
}

.stepper-btn-down::before {
  border-top: 4px solid #86909C;
}

.stepper-btn:not(:disabled):hover {
  background: #FFF0F2;
}

.stepper-btn-up:not(:disabled):hover::before {
  border-bottom-color: #A8071A;
}

.stepper-btn-down:not(:disabled):hover::before {
  border-top-color: #A8071A;
}

.stepper-btn:not(:disabled):active {
  background: #FFB3BB;
}

.stepper-btn:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.stepper-btn:disabled:hover {
  background: transparent;
}
.field-checkbox-group {
  display: grid;
  grid-template-columns: repeat(1, minmax(0, 1fr));
  gap: 12px 16px;
  width: 100%;
}
.field-checkbox-item {
  margin-right: 0;
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
  background: #FFFFFF;
  border: 1px solid #E5E6EB;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  font-size: 14px;
  font-weight: 500;
  color: #1D2129;
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
</style>
