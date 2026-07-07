<script setup>
import { bitable, DateFormatter, FieldType, NumberFormatter } from "@lark-base-open/js-sdk";
import { ref, onMounted, watch } from "vue";
import { ElNotification } from "element-plus";
import request from '@/utils/request';

const emit = defineEmits(['back']);

const props = defineProps({
  api_key: String,
})

const formData = ref({
  mode: 'table',
  targetType: 'current',
  profileLinkFieldId: '',
  scope: 'n',
  rowCount: 5,
  manualUrls: '',
  targetTableId: ''
});
const MANUAL_TABLE_BASE_NAME = '博主信息';

const FIELD_CONFIG = [
  { key: "uid", name: "用户ID", type: FieldType.Text, defaultSelected: true, getValue: (item) => item?.uid ?? "" },
  { key: "nickname", name: "昵称", type: FieldType.Text, defaultSelected: true, getValue: (item) => item?.nickname ?? "" },
  // { name: "头像", type: FieldType.Text, getValue: (item) => item?.avatar ?? "" },
  { key: "signature", name: "个人简介", type: FieldType.Text, defaultSelected: false, getValue: (item) => item?.signature ?? "" },
  { key: "follower_count", name: "粉丝数", type: FieldType.Number, defaultSelected: true, formatter: NumberFormatter.INTEGER, getValue: (item) => Number(item?.follower_count) || 0 },
  { key: "following_count", name: "关注数", type: FieldType.Number, defaultSelected: false, formatter: NumberFormatter.INTEGER, getValue: (item) => Number(item?.following_count) || 0 },
  { key: "total_favorited", name: "获赞数", type: FieldType.Number, defaultSelected: true, formatter: NumberFormatter.INTEGER, getValue: (item) => Number(item?.total_favorited) || 0 },
  { key: "aweme_count", name: "作品数", type: FieldType.Number, defaultSelected: true, formatter: NumberFormatter.INTEGER, getValue: (item) => Number(item?.aweme_count) || 0 },
  { key: "social_type", name: "平台", type: FieldType.Text, defaultSelected: true, getValue: (item) => item?.social_type ?? "" },
  { key: "ctime", name: "更新时间", type: FieldType.DateTime, defaultSelected: true, dateFormat: DateFormatter.DATE_TIME, getValue: (item) => (item?.ctime ? new Date(item.ctime * 1000).getTime() : "") },
];
const FIELD_SELECTION_STORAGE_KEY = 'blogger_info_selected_fields_v1';
const FIELD_TYPE_NAME = {
  [FieldType.Text]: '文本',
  [FieldType.Number]: '数字',
  [FieldType.SingleSelect]: '单选',
  [FieldType.DateTime]: '日期时间',
  [FieldType.Url]: '链接',
  [FieldType.Attachment]: '附件',
};

const getAllowedFieldTypes = (config) => {
  if (config.name === '平台' || config.name === '昵称') {
    return [FieldType.Text, FieldType.SingleSelect];
  }
  return [config.type];
};

const isFieldTypeCompatible = (fieldType, config) => {
  return getAllowedFieldTypes(config).includes(fieldType);
};

const fieldOptions = ref([]);
const tableOptions = ref([]);
const loading = ref(false);
const toastVisible = ref(false);
const toastText = ref('');
const toastLoading = ref(false);
const selectedFieldKeys = ref([]);
const fieldSelectionReady = ref(false);

const getDefaultSelectedFieldKeys = () => FIELD_CONFIG
  .filter(field => field.defaultSelected)
  .map(field => field.key);

const getActiveFieldConfigs = () => FIELD_CONFIG.filter(field =>
  selectedFieldKeys.value.includes(field.key)
);

const loadSelectedFieldKeys = async () => {
  const defaultKeys = getDefaultSelectedFieldKeys();

  try {
    const savedValue = await bitable.bridge.getData(FIELD_SELECTION_STORAGE_KEY);

    if (!Array.isArray(savedValue)) {
      selectedFieldKeys.value = defaultKeys;
      return;
    }

    const validKeys = savedValue.filter(key => FIELD_CONFIG.some(field => field.key === key));
    selectedFieldKeys.value = validKeys.length > 0 ? validKeys : defaultKeys;
  } catch (error) {
    console.error('读取字段勾选状态失败:', error);
    selectedFieldKeys.value = defaultKeys;
  }
};

const saveSelectedFieldKeys = async (keys) => {
  try {
    await bitable.bridge.setData(FIELD_SELECTION_STORAGE_KEY, [...keys]);
  } catch (error) {
    console.error('保存字段勾选状态失败:', error);
  }
};

const getFieldListByType = async ({ silent = false } = {}) => {
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
    if (!silent) {
      ElNotification({ message: '当前未在数据表页面，无法读取字段信息。请先打开目标数据表，再重试操作。', type: 'error', duration: 0 });
    }
  }
};

const loadTableOptions = async () => {
  try {
    const tableList = await bitable.base.getTableList();
    tableOptions.value = await Promise.all(
      tableList.map(async (table) => ({
        id: table.id,
        name: await table.getName()
      }))
    );
  } catch (error) {
    console.error('获取表格列表失败:', error);
    tableOptions.value = [];
    ElNotification({ message: '获取表格列表失败，请稍后重试', type: 'error', duration: 0 });
  }
};

const parseManualUrls = (text) => {
  if (!text || typeof text !== 'string') {
    return [];
  }

  return [...new Set(
    text
      .split(/[\n,，]+/)
      .map(item => item.trim())
      .filter(Boolean)
  )];
};

const createSequentialTable = async (baseTableName) => {
  try {
    const existingTables = await bitable.base.getTableMetaList();
    const tableNames = existingTables.map(table => table.name);

    const existsBaseTable = tableNames.includes(baseTableName);
    const existsSequentialTable = tableNames.some(name => name.startsWith(`${baseTableName}`) && /\d+$/.test(name.slice(baseTableName.length)));
    if (!existsBaseTable && !existsSequentialTable) {
      return await bitable.base.addTable({ name: baseTableName });
    }

    const reg = new RegExp(`^${baseTableName}(\\d+)$`);
    let maxIndex = 0;
    tableNames.forEach(name => {
      const match = name.match(reg);
      if (match) {
        const index = parseInt(match[1], 10);
        if (index > maxIndex) {
          maxIndex = index;
        }
      }
    });

    return await bitable.base.addTable({ name: `${baseTableName}${maxIndex + 1}` });
  } catch (error) {
    console.error('创建表格失败:', error);
    throw error;
  }
};

const createManualTargetTable = async () => {
  const tableMeta = await createSequentialTable(MANUAL_TABLE_BASE_NAME);
  const tableId = tableMeta.tableId || tableMeta.id;
  if (!tableId) {
    throw new Error('创建新表格失败');
  }
  return tableId;
};

const resolveTargetTableId = async (targetType, activeFieldConfigs) => {
  if (targetType === 'new') {
    const tableId = await createManualTargetTable();
    await setupNewTableFields(tableId, activeFieldConfigs);
    await bitable.ui.switchToTable(tableId);
    return tableId;
  }

  if (targetType === 'existing') {
    const tableId = formData.value.targetTableId;
    const fieldNameToId = await validateAndAddFields(tableId, activeFieldConfigs);
    if (!fieldNameToId) {
      return null;
    }
    return tableId;
  }

  return null;
};

const setupNewTableFields = async (tableId, activeFieldConfigs) => {
  const table = await bitable.base.getTableById(tableId);
  const fieldMetaList = await table.getFieldMetaList();
  const defaultFirstField = fieldMetaList[0];

  if (activeFieldConfigs.length === 0) {
    throw new Error('请至少选择一个需要更新的字段');
  }

  if (defaultFirstField && defaultFirstField.name === '文本') {
    await table.setField(defaultFirstField.id, {
      type: activeFieldConfigs[0].type,
      name: activeFieldConfigs[0].name
    });
  }

  for (let index = 1; index < activeFieldConfigs.length; index++) {
    const config = activeFieldConfigs[index];
    await table.addField({ type: config.type, name: config.name });
  }

  const latestFieldList = await table.getFieldList();
  for (const field of latestFieldList) {
    const name = await field.getName();
    const config = activeFieldConfigs.find(item => item.name === name);
    if (!config) {
      continue;
    }
    if (config.formatter) {
      await field.setFormatter(config.formatter);
    }
    if (config.dateFormat) {
      await field.setDateFormat(config.dateFormat);
    }
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
      pageToken
    });

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
  if (scope === 'all') {
    recordIdList = await getAllVisibleRecordIdList(view);
  } else if (scope === 'selected') {
    recordIdList = await view.getSelectedRecordIdList();
    if (recordIdList.length === 0) {
      ElNotification({ message: '请先在表格中选择至少一行数据', type: 'warning', duration: 0 });
      return null;
    }
  } else {
    const allRecordIdList = await getAllVisibleRecordIdList(view);
    recordIdList = allRecordIdList.slice(0, rowCount);
  }
  return recordIdList;
};

const validateAndAddFields = async (tableId, activeFieldConfigs) => {
  try {
    const table = tableId
      ? await bitable.base.getTableById(tableId)
      : await bitable.base.getActiveTable();
    const fieldList = await table.getFieldList();
    const fieldMetaMap = new Map();

    for (const field of fieldList) {
      const name = await field.getName();
      fieldMetaMap.set(name, { id: field.id, type: field.type });
    }

    const missingFields = [];
    const typeMismatchFields = [];

    for (const config of activeFieldConfigs) {
      const fieldMeta = fieldMetaMap.get(config.name);
      if (!fieldMeta) {
        missingFields.push(config);
      } else if (!isFieldTypeCompatible(fieldMeta.type, config)) {
        typeMismatchFields.push({
          name: config.name,
          expected: getAllowedFieldTypes(config).map(type => FIELD_TYPE_NAME[type] || type).join(' / '),
          actual: fieldMeta.type
        });
      }
    }

    if (typeMismatchFields.length > 0) {
      const errorMsg = typeMismatchFields.map(f => `"${f.name}" 类型不匹配，仅支持${f.expected}`).join(', ');
      ElNotification({ message: `字段类型错误: ${errorMsg}`, type: 'error', duration: 0 });
      return null;
    }

    const ensureFieldDisplayConfig = async (fieldId, fieldConfig) => {
      if (!fieldId) return;
      const field = await table.getFieldById(fieldId);
      if (fieldConfig.formatter) {
        await field.setFormatter(fieldConfig.formatter);
      }
      if (fieldConfig.dateFormat) {
        await field.setDateFormat(fieldConfig.dateFormat);
      }
    };

    for (const config of activeFieldConfigs) {
      const fieldMeta = fieldMetaMap.get(config.name);
      if (!fieldMeta) continue;
      try {
        await ensureFieldDisplayConfig(fieldMeta.id, config);
      } catch (error) {
        console.error(`设置字段 ${config.name} 格式失败:`, error);
      }
    }

    for (const fieldConfig of missingFields) {
      try {
        const addFieldResult = await table.addField({
          type: fieldConfig.type,
          name: fieldConfig.name
        });
        const newFieldId = typeof addFieldResult === 'string'
          ? addFieldResult
          : addFieldResult?.fieldId || addFieldResult?.id || addFieldResult?.field_id;
        if (newFieldId) {
          fieldMetaMap.set(fieldConfig.name, { id: newFieldId, type: fieldConfig.type });
        } else {
          const latestFieldList = await table.getFieldList();
          for (const field of latestFieldList) {
            const name = await field.getName();
            if (name === fieldConfig.name) {
              fieldMetaMap.set(fieldConfig.name, { id: field.id, type: fieldConfig.type });
              break;
            }
          }
        }
        await ensureFieldDisplayConfig(fieldMetaMap.get(fieldConfig.name)?.id, fieldConfig);
      } catch (e) {
        ElNotification({ message: `添加字段 "${fieldConfig.name}" 失败`, type: 'error', duration: 0 });
        return null;
      }
    }

    const fieldNameToId = {};
    for (const [name, meta] of fieldMetaMap.entries()) {
      fieldNameToId[name] = meta.id;
    }

    if (missingFields.length > 0) {
      ElNotification({ message: `已自动添加 ${missingFields.length} 个字段`, type: 'success' });
    }

    return fieldNameToId;
  } catch (error) {
    ElNotification({ message: `字段操作失败: ${error.message || error}`, type: 'error', duration: 0});
    return null;
  }
};

const writeDataToRecord = async (recordId, item, fieldNameToId, activeFieldConfigs) => {
  try {
    const table = await bitable.base.getActiveTable();

    for (const config of activeFieldConfigs) {
      const fieldId = fieldNameToId[config.name];
      if (!fieldId) continue;

      try {
        const field = await table.getFieldById(fieldId);
        const fieldType = await field.getType();
        const value = (config.name === '平台' || config.name === '昵称') && fieldType === FieldType.SingleSelect
          ? (config.getValue(item) || null)
          : config.getValue(item);
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

const createCellValue = async (table, fieldId, item, config) => {
  const field = await table.getFieldById(fieldId);
  const fieldType = await field.getType();
  const value = (config.name === '平台' || config.name === '昵称') && fieldType === FieldType.SingleSelect
    ? (config.getValue(item) || null)
    : config.getValue(item);
  return await field.createCell(value);
};

const appendRecordsToTable = async (tableId, list, activeFieldConfigs) => {
  const table = await bitable.base.getTableById(tableId);
  const fieldList = await table.getFieldList();
  const fieldMetaMap = new Map();

  for (const field of fieldList) {
    const name = await field.getName();
    fieldMetaMap.set(name, field.id);
  }

  const records = [];
  for (const item of list) {
    const cells = [];
    for (const config of activeFieldConfigs) {
      const fieldId = fieldMetaMap.get(config.name);
      if (!fieldId) {
        continue;
      }
      cells.push(await createCellValue(table, fieldId, item, config));
    }
    if (cells.length > 0) {
      records.push(cells);
    }
  }

  if (records.length > 0) {
    await table.addRecords(records);
  }
};

const fetchBloggerInfoByRows = async (rowList) => {
  let successCount = 0;
  let failCount = 0;
  const successList = [];

  showToast(`准备处理 ${rowList.length} 条数据...`, true);

  for (let i = 0; i < rowList.length; i++) {
    const { url, recordId } = rowList[i];

    try {
      showToast(`正在处理第 ${i + 1}/${rowList.length} 条...`, true);

      const response = await request({
        url: '/social/api/v1/feishu/blogger_info',
        method: 'post',
        headers: { 'authorization': `Bearer ${props.api_key}` },
        data: { url }
      });

      const res = response.data;

      if (res.sta === 0 && res.data) {
        successList.push({ ...res.data, __recordId: recordId });
        successCount++;
      } else {
        ElNotification({ message: res.msg || '获取博主信息失败', type: 'error', duration: 0 });
        failCount++;
      }
    } catch (error) {
      ElNotification({ message: error.message || '请求失败', type: 'error', duration: 0 });
      failCount++;
    }
  }

  return { successList, successCount, failCount };
};

const extractProfileLink = (value) => {
  if (!value) return null;

  if (typeof value === 'string') {
    return value.trim() || null;
  }

  if (typeof value === 'object') {
    const keys = ['link', 'url', 'text', 'content', 'value', 'displayText'];
    for (const key of keys) {
      const nested = extractProfileLink(value[key]);
      if (nested) return nested;
    }
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = extractProfileLink(item);
      if (nested) return nested;
    }
  }

  return null;
};

const getCellValuesByFieldId = async (recordIdList, fieldId) => {
  const table = await bitable.base.getActiveTable();
  const field = await table.getFieldById(fieldId);

  const rows = await Promise.all(
    recordIdList.map(async (recordId) => {
      try {
        const cell = await field.getCell(recordId);
        const value = await cell.getValue();
        const url = extractProfileLink(value);
        if (!url) {
          return null;
        }

        return { recordId, url };
      } catch (e) {
        return null;
      }
    })
  );

  return rows.filter(item => item && typeof item.url === 'string' && item.url.trim());
};

const handleTableModeSubmit = async () => {
  if (!props.api_key) {
    ElNotification({ message: '请先设置API Key', type: 'warning', duration: 0 });
    return;
  }

  if (!formData.value.profileLinkFieldId) {
    ElNotification({ message: '请选择博主主页链接字段', type: 'warning', duration: 0 });
    return;
  }

  if (formData.value.profileLinkFieldId === 'nodata') {
    ElNotification({ message: '未在数据表页面，无法读取字段信息。请先打开目标数据表，再重试操作。', type: 'error', duration: 0 });
    return;
  }

  const activeFieldConfigs = getActiveFieldConfigs();
  if (activeFieldConfigs.length === 0) {
    ElNotification({ message: '请至少选择一个需要更新的字段', type: 'warning', duration: 0 });
    return;
  }

  if (formData.value.targetType === 'existing' && !formData.value.targetTableId) {
    ElNotification({ message: '请选择现有表格', type: 'warning', duration: 0 });
    return;
  }

  loading.value = true;

  try {
    const recordIdList = await getRecordIdListByScope(
      formData.value.scope,
      formData.value.rowCount
    );

    if (!recordIdList) {
      loading.value = false;
      return;
    }

    const rowList = await getCellValuesByFieldId(recordIdList, formData.value.profileLinkFieldId);
    if (formData.value.targetType === 'current') {
      const activeTable = await bitable.base.getActiveTable();
      const fieldNameToId = await validateAndAddFields(activeTable.id, activeFieldConfigs);

      if (!fieldNameToId) {
        loading.value = false;
        return;
      }

      const { successList, successCount, failCount } = await fetchBloggerInfoByRows(rowList);
      for (const item of successList) {
        await writeDataToRecord(item.__recordId, item, fieldNameToId, activeFieldConfigs);
      }

      showToast(`处理完成：成功 ${successCount} 条，失败 ${failCount} 条`, false);
      setTimeout(() => {
        hideToast();
      }, 3000);
      return;
    }

    const { successList, successCount, failCount } = await fetchBloggerInfoByRows(rowList);
    if (successList.length === 0) {
      throw new Error('未获取到有效的博主信息');
    }

    const targetTableId = await resolveTargetTableId(formData.value.targetType, activeFieldConfigs);
    if (!targetTableId) {
      return;
    }

    await appendRecordsToTable(targetTableId, successList, activeFieldConfigs);

    showToast(`处理完成：成功 ${successCount} 条，失败 ${failCount} 条`, false);
    setTimeout(() => {
      hideToast();
    }, 3000);

  } catch (error) {
    ElNotification({ message: error.message || '获取数据失败', type: 'error', duration: 0 });
  } finally {
    loading.value = false;
  }
};

const handleManualModeSubmit = async () => {
  if (!props.api_key) {
    ElNotification({ message: '请先设置API Key', type: 'warning', duration: 0 });
    return;
  }

  if (!formData.value.manualUrls || !formData.value.manualUrls.trim()) {
    ElNotification({ message: '请输入博主主页链接', type: 'warning', duration: 0 });
    return;
  }

  if (formData.value.targetType === 'existing' && !formData.value.targetTableId) {
    ElNotification({ message: '请选择现有表格', type: 'warning', duration: 0 });
    return;
  }

  const urls = parseManualUrls(formData.value.manualUrls);
  if (urls.length === 0) {
    ElNotification({ message: '请至少输入一个有效的博主主页链接', type: 'warning', duration: 0 });
    return;
  }

  const activeFieldConfigs = getActiveFieldConfigs();
  if (activeFieldConfigs.length === 0) {
    ElNotification({ message: '请至少选择一个需要更新的字段', type: 'warning', duration: 0 });
    return;
  }

  loading.value = true;

  try {
    const rowList = urls.map(url => ({ url }));
    const { successList, successCount, failCount } = await fetchBloggerInfoByRows(rowList);
    if (successList.length === 0) {
      throw new Error('未获取到有效的博主信息');
    }

    const targetTableId = await resolveTargetTableId(formData.value.targetType, activeFieldConfigs);
    if (!targetTableId) {
      return;
    }

    await appendRecordsToTable(targetTableId, successList, activeFieldConfigs);

    showToast(`处理完成：成功 ${successCount} 条，失败 ${failCount} 条`, false);
    setTimeout(() => {
      hideToast();
    }, 3000);
  } catch (error) {
    ElNotification({ message: error.message || '获取数据失败', type: 'error', duration: 0 });
  } finally {
    loading.value = false;
  }
};

const handleSubmit = async () => {
  if (formData.value.mode === 'manual') {
    await handleManualModeSubmit();
    return;
  }

  await handleTableModeSubmit();
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
  if (formData.value.mode === 'table') {
    getFieldListByType({ silent: true });
  }

  Promise.all([
    loadSelectedFieldKeys()
  ]).finally(() => {
    fieldSelectionReady.value = true;
  });
});

watch(selectedFieldKeys, (keys) => {
  if (!fieldSelectionReady.value) {
    return;
  }

  saveSelectedFieldKeys(keys);
}, { deep: true });

watch(
  () => formData.value.mode,
  (mode) => {
    if (mode === 'table') {
      formData.value.targetType = 'current';
    }

    if (mode === 'table') {
      getFieldListByType({ silent: false });
    }

    if (mode === 'manual' && formData.value.targetType === 'current') {
      formData.value.targetType = 'new';
    }

    if (formData.value.targetType === 'existing' && tableOptions.value.length === 0) {
      loadTableOptions();
      return;
    }

    if (mode !== 'manual' && formData.value.targetType !== 'existing') {
      formData.value.targetTableId = '';
    }
  }
);

watch(
  () => formData.value.targetType,
  (targetType) => {
    if (targetType === 'existing' && tableOptions.value.length === 0) {
      loadTableOptions();
      return;
    }

    if (targetType !== 'existing') {
      formData.value.targetTableId = '';
    }
  }
);
</script>

<template>
  <div class="sub-page">
    <div class="sub-page-header">
      <span class="sub-page-back" @click="emit('back')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16">
          <polyline points="15 18 9 12 15 6"></polyline>
        </svg>
      </span>
      <span class="sub-page-title">博主信息获取</span>
    </div>
    <div class="form-card">
      <div class="mode-switch">
        <button
          type="button"
          class="mode-tab"
          :class="{ active: formData.mode === 'table' }"
          @click="formData.mode = 'table'"
        >
          从表格选取
        </button>
        <button
          type="button"
          class="mode-tab"
          :class="{ active: formData.mode === 'manual' }"
          @click="formData.mode = 'manual'"
        >
          手动输入
        </button>
      </div>
      <el-form ref="form" class="form" :model="formData" label-position="top">
        <el-form-item v-if="formData.mode === 'manual'" label="" style="margin-top: 12px">
          <div class="field-stack">
            <div class="c-label">目标表格</div>
            <el-radio-group v-model="formData.targetType" class="radio-block">
              <el-radio value="new">新建表格</el-radio>
              <el-radio value="existing">使用现有表格</el-radio>
            </el-radio-group>
          </div>
        </el-form-item>

        <el-form-item v-if="formData.mode === 'manual' && formData.targetType === 'existing'" label="">
          <div slot="label" class="c-label">选择现有表格</div>
          <el-select v-model="formData.targetTableId" placeholder="请选择" style="width: 100%">
            <el-option v-for="table in tableOptions" :key="table.id" :label="table.name" :value="table.id" />
          </el-select>
        </el-form-item>

        <template v-if="formData.mode === 'table'">
        <el-form-item label="">
          <div slot="label" class="c-label">
            博主主页链接
            <el-tooltip effect="dark" placement="top">
              <template #content>支持抖音、小红书、快手、微博、微信平台的博主主页链接</template>
              <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png"
                class="help-icon" />
            </el-tooltip>
          </div>
          <el-select
            v-model="formData.profileLinkFieldId"
            placeholder="选择包含博主主页链接的字段"
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
        </template>

        <template v-else>
          <el-form-item>
            <div slot="label" class="c-label">
              博主主页链接
              <el-tooltip effect="dark" placement="top">
                <template #content>仅支持博主主页链接，<br />不支持其他链接</template>
                <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png"
                  class="help-icon" />
              </el-tooltip>
            </div>
            <el-input
              v-model="formData.manualUrls"
              type="textarea"
              :rows="4"
              class="c-input"
              placeholder="请输入正确的博主主页链接，支持批量添加，多个链接可换行或用逗号分隔"
            />
          </el-form-item>
        </template>

        <el-form-item label="" style="margin-top: 12px">
          <div slot="label" class="c-label">选择需要的字段</div>
          <el-checkbox-group v-model="selectedFieldKeys" class="field-checkbox-group">
            <el-checkbox
              v-for="field in FIELD_CONFIG"
              :key="field.key"
              :label="field.key"
              class="field-checkbox-item"
            >
              {{ field.name }}
            </el-checkbox>
          </el-checkbox-group>
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
.mode-switch {
  display: flex;
  gap: 0;
  margin-bottom: 20px;
  background: #F7F8FA;
  border-radius: 6px;
  padding: 3px;
  border: 1px solid #E5E6EB;
}
.mode-tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px 0;
  font-size: 13px;
  font-weight: 500;
  color: #4E5969;
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s ease;
  line-height: 20px;
}
.mode-tab:hover {
  color: #1D2129;
}
.mode-tab.active {
  background: #FFFFFF;
  color: #A8071A;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
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
.field-stack {
  width: 100%;
}
.radio-block {
  width: 100%;
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

.field-checkbox-group {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 16px;
  width: 100%;
}

.field-checkbox-item {
  margin-right: 0;
}

.field-checkbox-group :deep(.el-checkbox) {
  margin-right: 0;
  align-items: center;
}

.field-checkbox-group :deep(.el-checkbox__label) {
  padding-left: 8px;
  color: #1D2129;
  line-height: 22px;
}

.field-checkbox-group :deep(.el-checkbox__inner) {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  border-color: #E5E6EB;
}

.field-checkbox-group :deep(.el-checkbox:hover .el-checkbox__inner) {
  border-color: #86909C;
}

.field-checkbox-group :deep(.el-checkbox__input.is-checked .el-checkbox__inner) {
  background: #A8071A;
  border-color: #A8071A;
}

.field-checkbox-group :deep(.el-checkbox__input.is-checked + .el-checkbox__label) {
  color: #1D2129;
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
