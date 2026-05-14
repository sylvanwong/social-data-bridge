<script setup>
import { bitable, FieldType } from "@lark-base-open/js-sdk";
import { ref, onMounted } from "vue";
import { ElNotification } from "element-plus";
import request from '@/utils/request';

const emit = defineEmits(['back']);

const props = defineProps({
  api_key: String,
})

const formData = ref({
  videoLinkFieldId: '',
  scope: 'n', // 'all' | 'selected' | 'n'
  rowCount: 5
});

const FIELD_CONFIG = [
  { name: "作品ID", type: FieldType.Text, getValue: (item) => item?.social_id ?? "" },
  { name: "作者名称", type: FieldType.Text, getValue: (item) => item?.nickname ?? "" },
  { name: "平台", type: FieldType.Text, getValue: (item) => item?.social_type ?? "" },
  { name: "标题", type: FieldType.Text, getValue: (item) => item?.title ?? "" },
  { name: "标签文本", type: FieldType.Text, getValue: (item) => item?.caption ?? "" },
  // { name: "播放数", type: FieldType.Number, getValue: (item) => Number(item?.digg_count) || 0 },
  { name: "点赞数", type: FieldType.Number, getValue: (item) => Number(item?.digg_count) || 0 },
  { name: "评论数", type: FieldType.Number, getValue: (item) => Number(item?.comment_count) || 0 },
  { name: "收藏数", type: FieldType.Number, getValue: (item) => Number(item?.collect_count) || 0 },
  { name: "分享数", type: FieldType.Number, getValue: (item) => Number(item?.share_count) || 0 },
  { name: "下载链接", type: FieldType.Text, getValue: (item) => item?.download_addr ?? "" },
  { name: "封面", type: FieldType.Text, getValue: (item) => item?.origin_cover ?? "" },
  { name: "时长", type: FieldType.Number, getValue: (item) => Number(item?.duration) || 0 },
  { name: "发布时间", type: FieldType.DateTime, getValue: (item) => (item?.t_create ? new Date(item.t_create).getTime() : "") },
  { name: "更新时间", type: FieldType.DateTime, getValue: (item) => (item?.ctime ? new Date(item.ctime).getTime() : "") },
];

const fieldOptions = ref([]);
const fieldListLoading = ref(false);
const loading = ref(false);
const toastVisible = ref(false);
const toastText = ref('');
const toastLoading = ref(false);

const getFieldListByType = async () => {
  try {
    const table = await bitable.base.getActiveTable();
    const fieldList = await table.getFieldList();

    const urlFieldList = fieldList.filter(item =>
      item.type === FieldType.Url || item.type === FieldType.Text
    );

    fieldOptions.value = await Promise.all(
      urlFieldList.map(async field => ({
        id: field.id,
        name: await field.getName()
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
  let pageToken = undefined;
  let allRecordIdList = [];
  let loopCount = 0;
  const maxLoops = 100; // 防止死循环的最大保护

  while (loopCount < maxLoops) {
    loopCount++;
    const result = await view.getVisibleRecordIdListByPage({
      pageSize,
      pageToken
    });
    console.log(`第 ${loopCount} 页原始结果:`, result);

    // 兼容不同的返回格式
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

    console.log(`解析后: ${recordIds.length} 条记录, hasMore: ${hasMore}, pageToken: ${pageToken}`);

    if (recordIds.length > 0) {
      allRecordIdList = allRecordIdList.concat(recordIds);
    }

    if (!hasMore || recordIds.length === 0) {
      break;
    }
  }

  if (loopCount >= maxLoops) {
    console.warn('达到最大循环次数，停止获取');
  }

  console.log('总共获取到:', allRecordIdList.length, '条记录');
  return allRecordIdList;
};

const getRecordIdListByScope = async (scope, rowCount) => {
  console.log('getRecordIdListByScope - scope:', scope, 'rowCount:', rowCount);
  const table = await bitable.base.getActiveTable();
  const view = await table.getActiveView();

  let recordIdList = [];
  if (scope === 'all') {
    recordIdList = await getAllVisibleRecordIdList(view);
    console.log('执行所有行 - recordIdList总数:', recordIdList.length);
  } else if (scope === 'selected') {
    recordIdList = await view.getSelectedRecordIdList();
    console.log('执行选中行 - recordIdList:', recordIdList);
    if (recordIdList.length === 0) {
      ElNotification({ message: '请先在表格中选择至少一行数据', type: 'warning', duration: 0 });
      return null;
    }
  } else {
    const allRecordIdList = await getAllVisibleRecordIdList(view);
    recordIdList = allRecordIdList.slice(0, rowCount);
    console.log('执行前N行 - 总记录数:', allRecordIdList.length, '取前:', recordIdList.length);
  }
  return recordIdList;
};

const validateAndAddFields = async () => {
  try {
    console.log('开始验证和添加字段...');
    const table = await bitable.base.getActiveTable();
    console.log('获取到table对象:', table);
    const fieldList = await table.getFieldList();
    console.log('获取到fieldList:', fieldList.length);
    const fieldMetaMap = new Map();

  for (const field of fieldList) {
    const name = await field.getName();
    fieldMetaMap.set(name, { id: field.id, type: field.type });
  }

  console.log('当前表格字段:', Object.fromEntries(fieldMetaMap));

  const missingFields = [];
  const typeMismatchFields = [];

  // 先验证所有字段
  for (const config of FIELD_CONFIG) {
    const fieldMeta = fieldMetaMap.get(config.name);

    if (!fieldMeta) {
      missingFields.push(config);
    } else if (fieldMeta.type !== config.type) {
      typeMismatchFields.push({
        name: config.name,
        expected: config.type,
        actual: fieldMeta.type
      });
    }
  }

  console.log('缺失字段:', missingFields.map(f => f.name));
  console.log('类型不匹配字段:', typeMismatchFields);

  // 如果有类型不匹配的字段，提示错误并返回 null
  if (typeMismatchFields.length > 0) {
    const errorMsg = typeMismatchFields.map(f => `"${f.name}" 类型不匹配`).join(', ');
    ElNotification({ message: `字段类型错误: ${errorMsg}`, type: 'error', duration: 0 });
    return null;
  }

  // 添加缺失字段
  for (const fieldConfig of missingFields) {
    try {
      console.log(`正在添加字段: ${fieldConfig.name}, 类型: ${fieldConfig.type}`);
      const newFieldId = await table.addField({
        type: fieldConfig.type,
        name: fieldConfig.name
      });
      fieldMetaMap.set(fieldConfig.name, { id: newFieldId, type: fieldConfig.type });
      console.log(`字段 ${fieldConfig.name} 添加成功，ID: ${newFieldId}`);
    } catch (e) {
      console.error(`添加字段 ${fieldConfig.name} 失败:`, e);
      ElNotification({ message: `添加字段 "${fieldConfig.name}" 失败`, type: 'error', duration: 0 });
      return null;
    }
  }

  // 构建字段名到ID的映射
  const fieldNameToId = {};
  for (const [name, meta] of fieldMetaMap.entries()) {
    fieldNameToId[name] = meta.id;
  }
  console.log('字段名到ID的映射:', fieldNameToId);

  if (missingFields.length > 0) {
    ElNotification({ message: `已自动添加 ${missingFields.length} 个字段`, type: 'success' });
  }

  return fieldNameToId;
  } catch (error) {
    console.error('验证/添加字段时出错:', error);
    ElNotification({ message: `字段操作失败: ${error.message || error}`, type: 'error', duration: 0});
    return null;
  }
};

const writeDataToRecord = async (recordId, item, fieldNameToId) => {
  try {
    console.log(`开始写入记录 ${recordId}`);
    const table = await bitable.base.getActiveTable();

    for (const config of FIELD_CONFIG) {
      const fieldId = fieldNameToId[config.name];
      if (!fieldId) {
        console.warn(`字段 "${config.name}" 未找到ID，跳过`);
        continue;
      }

      try {
        const field = await table.getFieldById(fieldId);
        const value = config.getValue(item);
        console.log(`写入字段 ${config.name} (${fieldId}):`, value);
        await field.setValue(recordId, value);
      } catch (e) {
        console.error(`写入字段 ${config.name} 失败:`, e);
      }
    }
  } catch (error) {
    console.error('写入记录失败:', error);
    throw error;
  }
};

const getCellValuesByFieldId = async (recordIdList, fieldId) => {
  console.log('getCellValuesByFieldId - recordIdList:', recordIdList, 'fieldId:', fieldId);
  const table = await bitable.base.getActiveTable();
  const field = await table.getFieldById(fieldId);
  console.log('field对象:', field, 'type:', field.type);

  const cellValues = await Promise.all(
    recordIdList.map(async (recordId) => {
      try {
        const cell = await field.getCell(recordId);
        console.log(`record ${recordId} 的cell:`, cell);
        const value = await cell.getValue();
        console.log(`record ${recordId} 的value:`, value, '类型:', Array.isArray(value) ? 'array' : typeof value);

        // value 可能是 null，也可能是 [{type: 'url', link: 'xxx', text: 'xxx'}] 格式
        if (value && Array.isArray(value) && value.length > 0) {
          return value[0].link;
        }
        // 如果是文本字段，直接返回字符串
        if (value && typeof value === 'string') {
          return value;
        }
        return null;
      } catch (e) {
        console.error(`获取record ${recordId} 的cell值失败:`, e);
        return null;
      }
    })
  );

  console.log('所有cellValues:', cellValues);
  const filtered = cellValues.filter(value => {
    const isValid = value && typeof value === 'string' && value.trim();
    console.log('过滤:', value, '->', isValid);
    return isValid;
  });
  console.log('过滤后的结果:', filtered);
  return filtered;
};

const handleSubmit = async () => {
  console.log('=== 提交调试信息 ===');
  console.log('当前选中的数据范围:', formData.value.scope);
  console.log('选中的字段ID:', formData.value.videoLinkFieldId);
  console.log('行数:', formData.value.rowCount);
  console.log('api_key:', props.api_key);

  if (!props.api_key) {
    ElNotification({ message: '请先设置API Key', type: 'warning', duration: 0 });
    return;
  }

  if (!formData.value.videoLinkFieldId) {
    ElNotification({ message: '请选择视频链接字段', type: 'warning', duration: 0 });
    return;
  }

  if (formData.value.videoLinkFieldId === 'nodata') {
    ElNotification({ message: '未在数据表页面，无法读取字段信息。请先打开目标数据表，再重试操作。', type: 'error', duration: 0 });
    return;
  }

  loading.value = true;

  try {
    const recordIdList = await getRecordIdListByScope(
      formData.value.scope,
      formData.value.rowCount
    );

    console.log('获取到的记录ID列表:', recordIdList);

    if (!recordIdList) {
      loading.value = false;
      return;
    }

    // 验证字段类型，自动添加缺失字段
    const fieldNameToId = await validateAndAddFields();

    if (!fieldNameToId) {
      loading.value = false;
      return;
    }

    const linkList = await getCellValuesByFieldId(recordIdList, formData.value.videoLinkFieldId);

    console.log('提取的视频链接:', linkList, '对应的recordIdList:', recordIdList);

    // 逐个处理每个链接，获取数据并写回表格
    let successCount = 0;
    let failCount = 0;

    showToast(`准备处理 ${linkList.length} 条数据...`, true);

    for (let i = 0; i < linkList.length; i++) {
      const url = linkList[i];
      const recordId = recordIdList[i];

      try {
        showToast(`正在处理第 ${i + 1}/${linkList.length} 条...`, true);
        console.log(`正在处理第 ${i + 1}/${linkList.length} 条:`, url);

        const response = await request({
          url: '/social/api/v1/feishu/social_info',
          method: 'post',
          headers: { 'authorization': `Bearer ${props.api_key}` },
          data: { url }
        });

        const res = response.data;
        console.log(`接口返回数据:`, res);

        if (res.sta === 0 && res.data) {
          // 将数据写入当前记录
          await writeDataToRecord(recordId, res.data, fieldNameToId);
          successCount++;
          console.log(`第 ${i + 1} 条处理成功`);
        } else {
          console.error(`接口返回错误:`, res.msg);
          failCount++;
        }
      } catch (error) {
        console.error(`处理第 ${i + 1} 条失败:`, error);
        failCount++;
      }
    }

    showToast(`处理完成：成功 ${successCount} 条，失败 ${failCount} 条`, false);

    // 3秒后隐藏toast
    setTimeout(() => {
      hideToast();
    }, 3000);

  } catch (error) {
    console.error('获取数据失败:', error);
    ElNotification({ message: res.msg, type: 'error', duration: 0 });
  } finally {
    loading.value = false;
  }
};

const stepNumber = (delta) => {
  let val = formData.value.rowCount || 5;
  val = Math.max(1, Math.min(100, val + delta));
  formData.value.rowCount = val;
};

const clampNumber = () => {
  let val = formData.value.rowCount || 5;
  val = Math.max(1, Math.min(100, val));
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
</script>

<template>
  <div class="sub-page">
    <div class="sub-page-header">
      <span class="sub-page-back" @click="emit('back')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16">
          <polyline points="15 18 9 12 15 6"></polyline>
        </svg>
      </span>
      <span class="sub-page-title">音视频数据获取</span>
    </div>
    <div class="form-card">
      <el-form ref="form" class="form" :model="formData" label-position="top">
        <el-form-item label="">
          <div slot="label" class="c-label">
            视频链接
            <el-tooltip effect="dark" placement="top">
              <template #content>支持抖音、小红书平台的视频链接</template>
              <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png"
                class="help-icon" />
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
              <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png"
                class="help-icon" />
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
                    @click.stop="stepNumber(1)"
                    :disabled="formData.rowCount >= 100"
                    class="stepper-btn stepper-btn-up"
                  ></button>
                  <button
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

    <!-- Toast 提示 -->
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
  background: #F2F3F5;
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
  gap: 6px;
  color: #fff;
  font-size: 14px;
  font-weight: 500;
  margin-top: 0;
  cursor: pointer;
  border: none;
  transition: background 0.2s ease;
}
.commit-btn:hover { background: #C11126; }
.commit-btn:active { background: #8A0515; }
.c-label {
  display: flex;
  align-items: center;
}
.help-icon {
  width: 16px;
  height: 16px;
  margin-left: 4px;
}

/* 自定义单选框组样式 */
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

/* 自定义步进输入框 */
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

/* Toast 样式 */
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

.toast-loading .toast-icon {
  animation: spin 0.8s linear infinite;
  color: #A8071A;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
