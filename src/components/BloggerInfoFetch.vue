<script setup>
import { bitable, DateFormatter, FieldType, NumberFormatter } from "@lark-base-open/js-sdk";
import { ref, onMounted, watch } from "vue";
import { ElNotification } from "element-plus";
import request from '@/utils/request';

const emit = defineEmits(['back']);

const props = defineProps({
  api_key: String,
});

const TASK_PLUGIN_TYPE = 'blogger_info';
const TASK_API_PATH = '/social/api/v1/feishu/schedule/tasks';
const MANUAL_TABLE_BASE_NAME = '博主信息';
const FIELD_SELECTION_STORAGE_KEY = 'blogger_info_selected_fields_v1';

const REPEAT_TYPE_OPTIONS = [
  { value: 'none', label: '不重复' },
  { value: 'hourly', label: '每小时重复' },
  { value: 'daily', label: '每天重复' },
  { value: 'weekly', label: '每周重复' },
  { value: 'monthly', label: '每月重复' },
  { value: 'yearly', label: '每年重复' },
  { value: 'workday', label: '周一到周五重复' },
  { value: 'custom', label: '自定义' },
];

const FREQ_UNIT_OPTIONS = [
  { value: 'hour', label: '小时' },
  { value: 'day', label: '天' },
  { value: 'week', label: '周' },
  { value: 'month', label: '月' },
  { value: 'year', label: '年' },
];

const FREQ_NUM_OPTIONS = Array.from({ length: 30 }, (_, index) => {
  const value = index + 1;
  return {
    value,
    label: `每 ${value}`,
  };
});

const FIELD_CONFIG = [
  { key: "uid", name: "用户ID", type: FieldType.Text, defaultSelected: true, getValue: (item) => item?.uid ?? "" },
  { key: "nickname", name: "昵称", type: FieldType.Text, defaultSelected: true, getValue: (item) => item?.nickname ?? "" },
  { key: "signature", name: "个人简介", type: FieldType.Text, defaultSelected: false, getValue: (item) => item?.signature ?? "" },
  { key: "follower_count", name: "粉丝数", type: FieldType.Number, defaultSelected: true, formatter: NumberFormatter.INTEGER, getValue: (item) => Number(item?.follower_count) || 0 },
  { key: "following_count", name: "关注数", type: FieldType.Number, defaultSelected: false, formatter: NumberFormatter.INTEGER, getValue: (item) => Number(item?.following_count) || 0 },
  { key: "total_favorited", name: "获赞数", type: FieldType.Number, defaultSelected: true, formatter: NumberFormatter.INTEGER, getValue: (item) => Number(item?.total_favorited) || 0 },
  { key: "aweme_count", name: "作品数", type: FieldType.Number, defaultSelected: true, formatter: NumberFormatter.INTEGER, getValue: (item) => Number(item?.aweme_count) || 0 },
  { key: "social_type", name: "平台", type: FieldType.Text, defaultSelected: true, getValue: (item) => item?.social_type ?? "" },
  { key: "ctime", name: "更新时间", type: FieldType.DateTime, defaultSelected: true, dateFormat: DateFormatter.DATE_TIME, getValue: (item) => (item?.ctime ? new Date(item.ctime * 1000).getTime() : "") },
];

const FIELD_TYPE_NAME = {
  [FieldType.Text]: '文本',
  [FieldType.Number]: '数字',
  [FieldType.SingleSelect]: '单选',
  [FieldType.DateTime]: '日期时间',
  [FieldType.Url]: '链接',
  [FieldType.Attachment]: '附件',
};

const getDefaultSelectedFieldKeys = () => FIELD_CONFIG
  .filter(field => field.defaultSelected)
  .map(field => field.key);

const getDefaultDeadlineDate = () => {
  const date = new Date();
  date.setFullYear(date.getFullYear() + 2);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getTodayDate = () => {
  const date = new Date();
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getCurrentTime = () => {
  const date = new Date();
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  return `${hours}:${minutes}`;
};

const getDefaultTaskDialogForm = () => ({
  personalBaseToken: '',
  enabled: true,
  triggerDate: getTodayDate(),
  triggerTime: getCurrentTime(),
  repeatType: 'none',
  freqNum: 1,
  freqUnit: 'day',
  deadlineType: 'date',
  deadlineDate: getDefaultDeadlineDate(),
  mode: 'table',
  targetType: 'current',
  profileLinkFieldId: '',
  scope: 'n',
  rowCount: 5,
  manualUrls: '',
  targetTableId: '',
  selectedFieldKeys: getDefaultSelectedFieldKeys(),
  sourceTableId: '',
  sourceTableName: '',
  sourceViewId: '',
  sourceViewName: '',
  resolvedTargetTableId: '',
  resolvedTargetTableName: '',
  profileLinkFieldName: '',
  baseId: '',
});

const formData = ref({
  mode: 'table',
  targetType: 'current',
  profileLinkFieldId: '',
  scope: 'n',
  rowCount: 5,
  manualUrls: '',
  targetTableId: '',
  executionMode: 'immediate'
});

const fieldOptions = ref([]);
const tableOptions = ref([]);
const loading = ref(false);
const toastVisible = ref(false);
const toastText = ref('');
const toastLoading = ref(false);
const selectedFieldKeys = ref([]);
const fieldSelectionReady = ref(false);

const taskDialogVisible = ref(false);
const taskDialogMode = ref('create');
const taskDialogLoading = ref(false);
const editingTaskId = ref(null);
const taskDialogForm = ref(getDefaultTaskDialogForm());
const taskList = ref([]);
const taskListLoading = ref(false);
const taskManagerExpanded = ref(false);

const syncMainFormToTaskForm = () => {
  taskDialogForm.value = {
    ...taskDialogForm.value,
    mode: formData.value.mode,
    targetType: formData.value.targetType,
    profileLinkFieldId: formData.value.profileLinkFieldId,
    scope: formData.value.scope,
    rowCount: formData.value.rowCount,
    manualUrls: formData.value.manualUrls,
    targetTableId: formData.value.targetTableId,
    selectedFieldKeys: [...selectedFieldKeys.value],
  };
};

const getActiveFieldConfigs = (keys = selectedFieldKeys.value) => FIELD_CONFIG.filter(field =>
  keys.includes(field.key)
);

const getAllowedFieldTypes = (config) => {
  if (config.name === '平台' || config.name === '昵称') {
    return [FieldType.Text, FieldType.SingleSelect];
  }
  return [config.type];
};

const isFieldTypeCompatible = (fieldType, config) => {
  return getAllowedFieldTypes(config).includes(fieldType);
};

const ensureOption = (optionsRef, option) => {
  if (!option?.id) {
    return;
  }

  if (!optionsRef.value.some(item => item.id === option.id)) {
    optionsRef.value = [...optionsRef.value, option];
  }
};

const getRepeatTypeLabel = (value) => {
  const normalizedValue = value === 'once' ? 'none' : value;
  return REPEAT_TYPE_OPTIONS.find(item => item.value === normalizedValue)?.label || value || '-';
};

const normalizeRepeatType = (value) => {
  return value === 'once' ? 'none' : (value || 'none');
};

const getFreqUnitLabel = (value) => {
  return FREQ_UNIT_OPTIONS.find(item => item.value === value)?.label || value || '';
};

const formatDateValue = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const normalizeTimeValue = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value.slice(0, 5);

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  return `${hours}:${minutes}`;
};

const getTableNameById = async (tableId) => {
  if (!tableId) return '';

  const matched = tableOptions.value.find(item => item.id === tableId);
  if (matched) {
    return matched.name;
  }

  const table = await bitable.base.getTableById(tableId);
  return await table.getName();
};

const getFieldNameById = async (tableId, fieldId) => {
  if (!tableId || !fieldId) return '';

  const matched = fieldOptions.value.find(item => item.id === fieldId);
  if (matched) {
    return matched.name;
  }

  const table = await bitable.base.getTableById(tableId);
  const field = await table.getFieldById(fieldId);
  return await field.getName();
};

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

const showToast = (text, isLoading = true) => {
  toastText.value = text;
  toastLoading.value = isLoading;
  toastVisible.value = true;
};

const hideToast = () => {
  toastVisible.value = false;
};

const validateBaseForm = (config) => {
  if (!props.api_key) {
    ElNotification({ message: '请先设置API Key', type: 'warning', duration: 0 });
    return false;
  }

  if (config.mode === 'table') {
    if (!config.profileLinkFieldId) {
      ElNotification({ message: '请选择博主主页链接字段', type: 'warning', duration: 0 });
      return false;
    }

    if (config.profileLinkFieldId === 'nodata') {
      ElNotification({ message: '未在数据表页面，无法读取字段信息。请先打开目标数据表，再重试操作。', type: 'error', duration: 0 });
      return false;
    }
  } else {
    if (!config.manualUrls || !config.manualUrls.trim()) {
      ElNotification({ message: '请输入博主主页链接', type: 'warning', duration: 0 });
      return false;
    }

    const urls = parseManualUrls(config.manualUrls);
    if (urls.length === 0) {
      ElNotification({ message: '请至少输入一个有效的博主主页链接', type: 'warning', duration: 0 });
      return false;
    }
  }

  if (config.targetType === 'existing' && !config.targetTableId) {
    ElNotification({ message: '请选择现有表格', type: 'warning', duration: 0 });
    return false;
  }

  if (getActiveFieldConfigs(config.selectedFieldKeys || selectedFieldKeys.value).length === 0) {
    ElNotification({ message: '请至少选择一个需要更新的字段', type: 'warning', duration: 0 });
    return false;
  }

  return true;
};

const ensureScheduleTableContext = async (config) => {
  if (config.mode !== 'table') {
    return true;
  }

  try {
    await bitable.base.getActiveTable();
    return true;
  } catch (error) {
    console.error('读取定时任务表格上下文失败:', error);
    ElNotification({
      message: '请先打开目标数据表，再保存定时任务。',
      type: 'error',
      duration: 0,
    });
    return false;
  }
};

const getCurrentSourceContext = async (profileLinkFieldId) => {
  const selection = await bitable.base.getSelection();
  const activeTable = await bitable.base.getActiveTable();
  const activeView = await activeTable.getActiveView();
  const sourceTableName = await activeTable.getName();
  const sourceViewName = typeof activeView.getName === 'function'
    ? await activeView.getName()
    : '';
  const profileLinkFieldName = await getFieldNameById(activeTable.id, profileLinkFieldId);

  return {
    baseId: selection.baseId || '',
    sourceTableId: activeTable.id || selection.tableId || '',
    sourceTableName,
    sourceViewId: activeView.id || selection.viewId || '',
    sourceViewName,
    profileLinkFieldName,
  };
};

const buildTaskPayload = async () => {
  const config = taskDialogForm.value;

  if (!validateBaseForm(config)) {
    return null;
  }

  if (!(await ensureScheduleTableContext(config))) {
    return null;
  }

  if (!config.personalBaseToken.trim()) {
    ElNotification({ message: '请输入授权码', type: 'warning', duration: 0 });
    return null;
  }

  if (!config.triggerTime) {
    ElNotification({ message: '请选择触发时间', type: 'warning', duration: 0 });
    return null;
  }

  if (config.repeatType !== 'hourly' && !config.triggerDate) {
    ElNotification({ message: '请选择触发日期', type: 'warning', duration: 0 });
    return null;
  }

  if (config.repeatType === 'custom' && config.deadlineType === 'date' && !config.deadlineDate) {
    ElNotification({ message: '请选择截止日期', type: 'warning', duration: 0 });
    return null;
  }

  if (config.mode === 'table' && config.scope === 'selected') {
    ElNotification({ message: '定时任务不支持“执行选中行”，请改为“执行所有行”或“执行前N行”', type: 'warning', duration: 0 });
    return null;
  }

  const activeFieldConfigs = getActiveFieldConfigs(config.selectedFieldKeys);
  let sourceContext = {
    baseId: '',
    sourceTableId: '',
    sourceTableName: '',
    sourceViewId: '',
    sourceViewName: '',
    profileLinkFieldName: '',
  };
  let resolvedTargetTableId = '';
  let resolvedTargetTableName = '';

  if (config.mode === 'table') {
    sourceContext = await getCurrentSourceContext(config.profileLinkFieldId);
    resolvedTargetTableId = config.targetType === 'current'
      ? sourceContext.sourceTableId
      : config.targetTableId;
    resolvedTargetTableName = config.targetType === 'current'
      ? sourceContext.sourceTableName
      : await getTableNameById(config.targetTableId);
  } else if (config.targetType === 'existing') {
    const selection = await bitable.base.getSelection();
    sourceContext.baseId = selection.baseId || '';
    resolvedTargetTableId = config.targetTableId;
    resolvedTargetTableName = await getTableNameById(config.targetTableId);
  } else {
    const selection = await bitable.base.getSelection();
    sourceContext.baseId = selection.baseId || '';
    resolvedTargetTableId = '';
    resolvedTargetTableName = MANUAL_TABLE_BASE_NAME;
  }

  const snapshot = {
    plugin_type: TASK_PLUGIN_TYPE,
    base_id: sourceContext.baseId,
    mode: config.mode,
    target_type: config.targetType,
    target_table_id: config.targetTableId || '',
    target_table_name: config.targetType === 'existing' ? resolvedTargetTableName : '',
    resolved_target_table_id: resolvedTargetTableId,
    resolved_target_table_name: resolvedTargetTableName,
    source_table_id: sourceContext.sourceTableId,
    source_table_name: sourceContext.sourceTableName,
    source_view_id: sourceContext.sourceViewId,
    source_view_name: sourceContext.sourceViewName,
    profile_link_field_id: config.profileLinkFieldId || '',
    profile_link_field_name: sourceContext.profileLinkFieldName,
    scope: config.scope,
    row_count: Number(config.rowCount) || 5,
    manual_urls: config.manualUrls || '',
    selected_field_keys: [...config.selectedFieldKeys],
    output_fields: activeFieldConfigs.map(item => ({
      key: item.key,
      name: item.name,
      type: item.type,
    })),
  };

  const schedule = {
    trigger_date: config.repeatType === 'hourly' ? '' : formatDateValue(config.triggerDate),
    trigger_time: normalizeTimeValue(config.triggerTime),
    repeat_type: config.repeatType,
    freq_num: config.repeatType === 'custom' ? Number(config.freqNum) || 1 : 1,
    freq_unit: config.repeatType === 'custom' ? config.freqUnit : '',
    deadline_type: config.repeatType === 'custom' ? config.deadlineType : '',
    deadline_date: config.repeatType === 'custom' && config.deadlineType === 'date'
      ? formatDateValue(config.deadlineDate)
      : '',
    enabled: !!config.enabled,
  };

  return {
    plugin_type: TASK_PLUGIN_TYPE,
    name: resolvedTargetTableName || MANUAL_TABLE_BASE_NAME,
    personal_base_token: config.personalBaseToken.trim(),
    base_id: sourceContext.baseId,
    schedule,
    snapshot,
  };
};

const buildTaskSummary = (task) => {
  const snapshot = task.snapshot || {};
  const modeLabel = snapshot.mode === 'manual' ? '手动输入' : '从表格选取';
  const scopeLabel = snapshot.mode === 'manual'
    ? `${parseManualUrls(snapshot.manual_urls || '').length || 0} 个链接`
    : snapshot.scope === 'all'
      ? '执行所有行'
      : snapshot.scope === 'selected'
        ? '执行选中行'
        : `执行前 ${snapshot.row_count || 0} 行`;
  const fieldCount = Array.isArray(snapshot.selected_field_keys) ? snapshot.selected_field_keys.length : 0;
  return `${modeLabel} · ${scopeLabel} · 输出字段 ${fieldCount} 个`;
};

const getTaskDisplayName = (task) => {
  return task.name
    || task.snapshot?.resolved_target_table_name
    || task.snapshot?.target_table_name
    || task.snapshot?.source_table_name
    || '未命名任务';
};

const getTaskDisplayTitle = (task, maxLength = 18) => {
  const name = getTaskDisplayName(task);
  if (!name || name.length <= maxLength) {
    return name;
  }
  return `${name.slice(0, maxLength)}...`;
};

const toggleTaskManager = () => {
  taskManagerExpanded.value = !taskManagerExpanded.value;
};

const updateTaskInList = (taskId, patch = {}) => {
  taskList.value = taskList.value.map(item => {
    if (item.id !== taskId) {
      return item;
    }

    const nextTask = {
      ...item,
      ...patch,
    };

    if (patch.schedule) {
      nextTask.schedule = {
        ...(item.schedule || {}),
        ...patch.schedule,
      };
    }

    return nextTask;
  });
};

const buildTaskTimeText = (task) => {
  const schedule = task.schedule || {};
  if (schedule.repeat_type === 'custom') {
    const deadlineText = schedule.deadline_type === 'date' && schedule.deadline_date
      ? `，截止 ${schedule.deadline_date}`
      : '，永不结束';
    return `${schedule.trigger_date || '-'} ${schedule.trigger_time || '-'} · 每 ${schedule.freq_num || 1}${getFreqUnitLabel(schedule.freq_unit)}${deadlineText}`;
  }

  if (schedule.repeat_type === 'hourly') {
    return `${schedule.trigger_time || '-'} · ${getRepeatTypeLabel(schedule.repeat_type)}`;
  }

  return `${schedule.trigger_date || '-'} ${schedule.trigger_time || '-'} · ${getRepeatTypeLabel(schedule.repeat_type)}`;
};

const parseTaskList = (data) => {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.list)) return data.list;
  if (Array.isArray(data?.items)) return data.items;
  return [];
};

const loadTaskList = async () => {
  if (!props.api_key) {
    taskList.value = [];
    return;
  }

  taskListLoading.value = true;

  try {
    const selection = await bitable.base.getSelection();
    const response = await request({
      url: TASK_API_PATH,
      method: 'get',
      headers: { 'authorization': `Bearer ${props.api_key}` },
      params: {
        plugin_type: TASK_PLUGIN_TYPE,
        base_id: selection.baseId || '',
      },
    });

    const res = response.data;
    if (res.sta !== 0) {
      throw new Error(res.msg || '获取定时任务失败');
    }

    taskList.value = parseTaskList(res.data);
  } catch (error) {
    console.error('获取定时任务失败:', error);
    ElNotification({ message: error.message || '获取定时任务失败', type: 'error', duration: 0 });
    taskList.value = [];
  } finally {
    taskListLoading.value = false;
  }
};

const copyCurrentFormToTaskDialog = async () => {
  taskDialogForm.value = {
    ...getDefaultTaskDialogForm(),
    mode: formData.value.mode,
    targetType: formData.value.targetType,
    profileLinkFieldId: formData.value.profileLinkFieldId,
    scope: formData.value.scope,
    rowCount: formData.value.rowCount,
    manualUrls: formData.value.manualUrls,
    targetTableId: formData.value.targetTableId,
    selectedFieldKeys: [...selectedFieldKeys.value],
  };

  if (formData.value.mode === 'table' && formData.value.profileLinkFieldId) {
    try {
      const activeTable = await bitable.base.getActiveTable();
      taskDialogForm.value.sourceTableId = activeTable.id;
      taskDialogForm.value.sourceTableName = await activeTable.getName();
      ensureOption(fieldOptions, {
        id: formData.value.profileLinkFieldId,
        name: await getFieldNameById(activeTable.id, formData.value.profileLinkFieldId),
      });
    } catch (error) {
      console.error('同步当前表格配置失败:', error);
    }
  }

  if (formData.value.targetType === 'existing' && formData.value.targetTableId) {
    ensureOption(tableOptions, {
      id: formData.value.targetTableId,
      name: await getTableNameById(formData.value.targetTableId),
    });
  }
};

const openCreateTaskDialog = async () => {
  if (!props.api_key) {
    ElNotification({ message: '请先设置API Key', type: 'warning', duration: 0 });
    return;
  }

  if (formData.value.mode === 'table') {
    await getFieldListByType({ silent: true });
  }

  if (tableOptions.value.length === 0) {
    await loadTableOptions();
  }

  taskDialogMode.value = 'create';
  editingTaskId.value = null;
  await copyCurrentFormToTaskDialog();
  taskDialogVisible.value = true;
};

const prepareInlineScheduleForm = async () => {
  if (formData.value.mode === 'table') {
    await getFieldListByType({ silent: true });
  }

  if (tableOptions.value.length === 0) {
    await loadTableOptions();
  }

  if (!taskDialogForm.value.name && !taskDialogForm.value.personalBaseToken) {
    await copyCurrentFormToTaskDialog();
  } else {
    syncMainFormToTaskForm();
  }
};

const openEditTaskDialog = async (task) => {
  if (tableOptions.value.length === 0) {
    await loadTableOptions();
  }

  if (fieldOptions.value.length === 0 && (task.snapshot?.mode || 'table') === 'table') {
    await getFieldListByType({ silent: true });
  }

  const snapshot = task.snapshot || {};
  const schedule = task.schedule || {};

  taskDialogMode.value = 'edit';
  editingTaskId.value = task.id;
  taskDialogForm.value = {
    ...getDefaultTaskDialogForm(),
    personalBaseToken: task.personal_base_token || '',
    enabled: task.enabled ?? schedule.enabled ?? true,
    triggerDate: schedule.trigger_date || '',
    triggerTime: schedule.trigger_time || '09:00',
    repeatType: normalizeRepeatType(schedule.repeat_type),
    freqNum: schedule.freq_num || 1,
    freqUnit: schedule.freq_unit || 'day',
    deadlineType: schedule.deadline_type || 'never',
    deadlineDate: schedule.deadline_date || '',
    mode: snapshot.mode || 'table',
    targetType: snapshot.target_type || 'current',
    profileLinkFieldId: snapshot.profile_link_field_id || '',
    scope: snapshot.scope || 'n',
    rowCount: snapshot.row_count || 5,
    manualUrls: snapshot.manual_urls || '',
    targetTableId: snapshot.target_table_id || '',
    selectedFieldKeys: Array.isArray(snapshot.selected_field_keys) && snapshot.selected_field_keys.length > 0
      ? snapshot.selected_field_keys
      : getDefaultSelectedFieldKeys(),
    sourceTableId: snapshot.source_table_id || '',
    sourceTableName: snapshot.source_table_name || '',
    sourceViewId: snapshot.source_view_id || '',
    sourceViewName: snapshot.source_view_name || '',
    resolvedTargetTableId: snapshot.resolved_target_table_id || '',
    resolvedTargetTableName: snapshot.resolved_target_table_name || '',
    profileLinkFieldName: snapshot.profile_link_field_name || '',
    baseId: task.base_id || snapshot.base_id || '',
  };

  ensureOption(fieldOptions, {
    id: snapshot.profile_link_field_id || '',
    name: snapshot.profile_link_field_name || '原字段',
  });
  ensureOption(tableOptions, {
    id: snapshot.target_table_id || '',
    name: snapshot.target_table_name || snapshot.resolved_target_table_name || '原目标表',
  });

  taskDialogVisible.value = true;
};

const saveTask = async () => {
  taskDialogLoading.value = true;

  try {
    const payload = await buildTaskPayload();
    if (!payload) {
      return;
    }

    const response = await request({
      url: editingTaskId.value ? `${TASK_API_PATH}/${editingTaskId.value}` : TASK_API_PATH,
      method: editingTaskId.value ? 'put' : 'post',
      headers: { 'authorization': `Bearer ${props.api_key}` },
      data: payload,
    });

    const res = response.data;
    if (res.sta !== 0) {
      throw new Error(res.msg || '保存定时任务失败');
    }

    ElNotification({
      message: editingTaskId.value ? '定时任务已更新' : '定时任务已创建',
      type: 'success',
    });

    taskDialogVisible.value = false;
    taskDialogForm.value = getDefaultTaskDialogForm();
    await loadTaskList();
  } catch (error) {
    console.error('保存定时任务失败:', error);
    ElNotification({ message: error.message || '保存定时任务失败', type: 'error', duration: 0 });
  } finally {
    taskDialogLoading.value = false;
  }
};

const deleteTask = async (task) => {
  if (!confirm(`确定删除任务「${getTaskDisplayName(task)}」吗？`)) {
    return;
  }

  try {
    const response = await request({
      url: `${TASK_API_PATH}/${task.id}`,
      method: 'delete',
      headers: { 'authorization': `Bearer ${props.api_key}` },
      data: {},
    });

    const res = response.data;
    if (res.sta !== 0) {
      throw new Error(res.msg || '删除定时任务失败');
    }

    ElNotification({ message: '定时任务已删除', type: 'success' });
    await loadTaskList();
  } catch (error) {
    console.error('删除定时任务失败:', error);
    ElNotification({ message: error.message || '删除定时任务失败', type: 'error', duration: 0 });
  }
};

const toggleTaskStatus = async (task) => {
  try {
    const nextEnabled = !(task.enabled ?? task.schedule?.enabled);
    const response = await request({
      url: `${TASK_API_PATH}/${task.id}/toggle`,
      method: 'post',
      headers: { 'authorization': `Bearer ${props.api_key}` },
      data: {
        enabled: nextEnabled,
      },
    });

    const res = response.data;
    if (res.sta !== 0) {
      throw new Error(res.msg || '更新任务状态失败');
    }

    const returnedTask = res.data?.task || res.data?.item || res.data;
    if (returnedTask && typeof returnedTask === 'object') {
      updateTaskInList(task.id, returnedTask);
    } else {
      updateTaskInList(task.id, {
        enabled: nextEnabled,
        schedule: {
          enabled: nextEnabled,
        },
      });
    }

    ElNotification({ message: '任务状态已更新', type: 'success' });
  } catch (error) {
    console.error('更新任务状态失败:', error);
    ElNotification({ message: error.message || '更新任务状态失败', type: 'error', duration: 0 });
  }
};

const handleTableModeSubmit = async () => {
  if (!validateBaseForm({
    ...formData.value,
    selectedFieldKeys: selectedFieldKeys.value,
  })) {
    return;
  }

  loading.value = true;

  try {
    const activeFieldConfigs = getActiveFieldConfigs();
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
  if (!validateBaseForm({
    ...formData.value,
    selectedFieldKeys: selectedFieldKeys.value,
  })) {
    return;
  }

  const urls = parseManualUrls(formData.value.manualUrls);
  const activeFieldConfigs = getActiveFieldConfigs();
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

const stepTaskNumber = (delta) => {
  let val = taskDialogForm.value.rowCount || 5;
  val = Math.max(1, Math.min(100, val + delta));
  taskDialogForm.value.rowCount = val;
};

onMounted(() => {
  if (formData.value.mode === 'table') {
    getFieldListByType({ silent: true });
  }

  Promise.all([
    loadSelectedFieldKeys(),
    loadTaskList(),
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
      getFieldListByType({ silent: true });
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

    syncMainFormToTaskForm();
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

    syncMainFormToTaskForm();
  }
);

watch(
  () => [
    formData.value.profileLinkFieldId,
    formData.value.scope,
    formData.value.rowCount,
    formData.value.manualUrls,
    formData.value.executionMode,
  ],
  async () => {
    syncMainFormToTaskForm();

    if (formData.value.executionMode === 'schedule') {
      await prepareInlineScheduleForm();
    }
  },
  { deep: true }
);

watch(selectedFieldKeys, () => {
  syncMainFormToTaskForm();
}, { deep: true });

watch(
  () => formData.value.executionMode,
  async (mode) => {
    if (mode === 'schedule') {
      await prepareInlineScheduleForm();
    }
  }
);

watch(
  () => taskDialogVisible.value,
  (visible) => {
    if (!visible) {
      taskDialogForm.value = getDefaultTaskDialogForm();
      taskDialogMode.value = 'create';
      editingTaskId.value = null;
    }
  }
);

watch(
  () => taskDialogForm.value.repeatType,
  (repeatType) => {
    if (repeatType === 'custom') {
      taskDialogForm.value.deadlineType = 'date';
      if (!taskDialogForm.value.deadlineDate) {
        taskDialogForm.value.deadlineDate = getDefaultDeadlineDate();
      }
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

      <el-form class="form" :model="formData" label-position="top">
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
          <div class="c-label">选择现有表格</div>
          <el-select v-model="formData.targetTableId" placeholder="请选择" style="width: 100%">
            <el-option v-for="table in tableOptions" :key="table.id" :label="table.name" :value="table.id" />
          </el-select>
        </el-form-item>

        <template v-if="formData.mode === 'table'">
          <el-form-item label="">
            <div class="c-label">
              博主主页链接
              <el-tooltip effect="dark" placement="top">
                <template #content>支持抖音、小红书、快手、微博、微信、哔哩哔哩平台的博主主页链接</template>
                <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png" class="help-icon" />
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
            <div class="c-label">
              博主主页链接
              <el-tooltip effect="dark" placement="top">
                <template #content>仅支持博主主页链接，不支持其他链接</template>
                <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png" class="help-icon" />
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
          <div class="c-label">选择需要的字段</div>
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

        <el-form-item label="" style="margin-top: 12px">
          <div class="c-label">执行方式</div>
          <el-radio-group v-model="formData.executionMode" class="radio-block">
            <el-radio value="immediate">立即执行</el-radio>
            <el-radio value="schedule">定时任务</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>

      <div v-if="formData.executionMode === 'immediate'" class="action-group">
        <el-button color="#a8071a" class="commit-btn" :loading="loading" @click="handleSubmit">立即执行</el-button>
      </div>

      <div v-else class="schedule-inline-panel">
        <div class="task-dialog-title">定时配置</div>

        <el-form label-position="top">
          <el-form-item>
            <div class="c-label">
              授权码
              <a
                class="label-help-link"
                href="https://congxin.feishu.cn/wiki/IXOJwHG3ZiJLr1knFl7cYbFnntb?from=from_copylink"
                target="_blank"
                rel="noopener noreferrer"
              >
                点击获取授权码
              </a>
            </div>
            <el-input
              v-model="taskDialogForm.personalBaseToken"
              type="password"
              show-password
              placeholder="输入授权码"
            />
          </el-form-item>

          <el-form-item>
            <div class="time-setting-block">
              <div class="c-label">设置触发时间</div>
              <div class="time-setting-grid">
                <el-date-picker
                  v-model="taskDialogForm.triggerDate"
                  type="date"
                  value-format="YYYY-MM-DD"
                  placeholder="选择日期"
                  style="width: 100%"
                  :disabled="taskDialogForm.repeatType === 'hourly'"
                />

                <el-time-picker
                  v-model="taskDialogForm.triggerTime"
                  value-format="HH:mm"
                  format="HH:mm"
                  placeholder="选择时间"
                  style="width: 100%"
                />
              </div>
            </div>
          </el-form-item>

          <div class="grid-two">
            <el-form-item>
              <div class="c-label">重复类型</div>
              <el-select v-model="taskDialogForm.repeatType" style="width: 100%">
                <el-option v-for="item in REPEAT_TYPE_OPTIONS" :key="item.value" :label="item.label" :value="item.value" />
              </el-select>
            </el-form-item>

            <el-form-item class="status-switch-item">
              <div class="c-label">任务状态</div>
              <el-switch v-model="taskDialogForm.enabled" active-text="开启" inactive-text="" />
            </el-form-item>
          </div>

          <template v-if="taskDialogForm.repeatType === 'custom'">
            <div class="grid-two">
              <el-form-item>
                <div class="time-setting-block">
                  <div class="c-label">重复频率</div>
                  <div class="time-setting-grid">
                    <el-select v-model="taskDialogForm.freqNum" style="width: 100%">
                      <el-option v-for="item in FREQ_NUM_OPTIONS" :key="item.value" :label="item.label" :value="item.value" />
                    </el-select>
                    <el-select v-model="taskDialogForm.freqUnit" style="width: 100%">
                      <el-option v-for="item in FREQ_UNIT_OPTIONS" :key="item.value" :label="item.label" :value="item.value" />
                    </el-select>
                  </div>
                </div>
              </el-form-item>

              <el-form-item>
                <div class="time-setting-block">
                  <div class="c-label">截止方式</div>
                  <div class="deadline-setting-grid">
                    <label class="deadline-radio-option" :class="{ active: taskDialogForm.deadlineType === 'never' }">
                      <input v-model="taskDialogForm.deadlineType" type="radio" value="never" />
                      <span>永不结束</span>
                    </label>
                    <label class="deadline-radio-option deadline-radio-option--date" :class="{ active: taskDialogForm.deadlineType === 'date' }">
                      <input v-model="taskDialogForm.deadlineType" type="radio" value="date" />
                      <el-date-picker
                        v-model="taskDialogForm.deadlineDate"
                        type="date"
                        value-format="YYYY-MM-DD"
                        placeholder="选择截止日期"
                        style="width: 100%"
                        :disabled="taskDialogForm.deadlineType !== 'date'"
                      />
                    </label>
                  </div>
                </div>
              </el-form-item>
            </div>
          </template>
        </el-form>

        <div class="action-group">
          <el-button color="#a8071a" class="commit-btn" :loading="taskDialogLoading" @click="saveTask">保存定时任务</el-button>
        </div>
      </div>
    </div>

    <div class="task-manager">
      <div
        class="task-manager-header"
        :class="{ expanded: taskManagerExpanded }"
        @click="toggleTaskManager"
      >
        <div class="task-manager-header-left">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <line x1="16" y1="13" x2="8" y2="13"></line>
            <line x1="16" y1="17" x2="8" y2="17"></line>
            <polyline points="10 9 9 9 8 9"></polyline>
          </svg>
          <span>定时任务管理</span>
          <span class="task-count">{{ taskList.length }} 个任务</span>
        </div>
        <div class="expand-arrow">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </div>
      </div>

      <div class="task-list" :class="{ active: taskManagerExpanded }">
        <div v-if="taskListLoading" class="empty-state">正在加载任务...</div>
        <div v-else-if="taskList.length === 0" class="empty-state">暂无定时任务，点击上方“保存定时任务”创建</div>
        <div v-else>
          <div v-for="task in taskList" :key="task.id" class="task-card">
            <div class="task-card-header">
              <div>
                <div class="task-card-title">{{ getTaskDisplayTitle(task) }}</div>
                <div class="task-card-desc">{{ buildTaskSummary(task) }}</div>
              </div>
            </div>

            <div class="task-card-meta">{{ buildTaskTimeText(task) }}</div>

            <div class="task-card-actions">
              <el-button plain size="small" @click.stop="openEditTaskDialog(task)">编辑</el-button>
              <el-button plain size="small" type="danger" @click.stop="deleteTask(task)">删除</el-button>
              <div class="task-card-switch-wrap" @click.stop>
                <div
                  class="task-card-switch"
                  :class="{ active: task.enabled }"
                  @click.stop="toggleTaskStatus(task)"
                ></div>
                <span class="task-card-switch-label">{{ task.enabled ? '开启' : '关闭' }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
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

    <el-dialog
      v-model="taskDialogVisible"
      :title="taskDialogMode === 'edit' ? '编辑定时任务' : '新建定时任务'"
      width="370px"
      class="schedule-edit-dialog"
      destroy-on-close
    >
      <div class="task-dialog-scroll">
        <div class="task-dialog-section task-dialog-card">
          <div class="mode-switch dialog-mode-switch">
            <button
              type="button"
              class="mode-tab"
              :class="{ active: taskDialogForm.mode === 'table' }"
              @click="taskDialogForm.mode = 'table'; taskDialogForm.targetType = 'current'"
            >
              从表格选取
            </button>
            <button
              type="button"
              class="mode-tab"
              :class="{ active: taskDialogForm.mode === 'manual' }"
              @click="taskDialogForm.mode = 'manual'; if (taskDialogForm.targetType === 'current') taskDialogForm.targetType = 'new'"
            >
              手动输入
            </button>
          </div>

          <el-form label-position="top">
            <template v-if="taskDialogForm.mode === 'table'">
              <el-form-item>
                <div class="c-label">博主主页链接字段</div>
                <el-select v-model="taskDialogForm.profileLinkFieldId" placeholder="请选择字段" style="width: 100%">
                  <el-option v-for="field in fieldOptions" :key="field.id" :label="field.name" :value="field.id" />
                </el-select>
                <div class="sub-hint">定时执行时会使用当前页面所属表和视图。编辑前请先打开对应数据表。</div>
              </el-form-item>

              <el-form-item>
                <div class="c-label">数据范围</div>
                <el-radio-group v-model="taskDialogForm.scope" class="custom-radio-group">
                  <el-radio value="all" class="custom-radio-item">执行所有行</el-radio>
                  <el-radio value="n" class="custom-radio-item">
                    <span class="radio-label-text">执行前N行</span>
                    <div class="custom-stepper-input">
                      <input
                        type="number"
                        :value="taskDialogForm.rowCount"
                        @input.stop="taskDialogForm.rowCount = Math.max(1, Math.min(100, parseInt($event.target.value) || 5))"
                        @click.stop
                        min="1"
                        max="100"
                      />
                      <div class="stepper-buttons">
                        <button
                          type="button"
                          @click.stop="stepTaskNumber(1)"
                          :disabled="taskDialogForm.rowCount >= 100"
                          class="stepper-btn stepper-btn-up"
                        ></button>
                        <button
                          type="button"
                          @click.stop="stepTaskNumber(-1)"
                          :disabled="taskDialogForm.rowCount <= 1"
                          class="stepper-btn stepper-btn-down"
                        ></button>
                      </div>
                    </div>
                  </el-radio>
                </el-radio-group>
                <div class="sub-hint warning-text">定时任务不支持“执行选中行”。</div>
              </el-form-item>
            </template>

            <template v-else>
              <el-form-item>
                <div class="c-label">目标表格</div>
                <el-radio-group v-model="taskDialogForm.targetType" class="radio-block">
                  <el-radio value="new">新建表格</el-radio>
                  <el-radio value="existing">使用现有表格</el-radio>
                </el-radio-group>
              </el-form-item>

              <el-form-item v-if="taskDialogForm.targetType === 'existing'">
                <div class="c-label">选择现有表格</div>
                <el-select v-model="taskDialogForm.targetTableId" placeholder="请选择" style="width: 100%">
                  <el-option v-for="table in tableOptions" :key="table.id" :label="table.name" :value="table.id" />
                </el-select>
              </el-form-item>

              <el-form-item>
                <div class="c-label">博主主页链接</div>
                <el-input
                  v-model="taskDialogForm.manualUrls"
                  type="textarea"
                  :rows="4"
                  placeholder="请输入正确的博主主页链接，多个链接可换行或用逗号分隔"
                />
              </el-form-item>
            </template>

            <el-form-item>
              <div class="c-label">选择需要的字段</div>
              <el-checkbox-group v-model="taskDialogForm.selectedFieldKeys" class="field-checkbox-group">
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
        </div>

        <div class="task-dialog-section task-dialog-card">
          <div class="task-dialog-title">定时配置</div>

          <el-form label-position="top">
            <el-form-item>
              <div class="c-label">
                授权码
                <a
                  class="label-help-link"
                  href="https://congxin.feishu.cn/wiki/IXOJwHG3ZiJLr1knFl7cYbFnntb?from=from_copylink"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  点击获取授权码
                </a>
              </div>
              <el-input
                v-model="taskDialogForm.personalBaseToken"
                type="password"
                show-password
                placeholder="请输入授权码"
              />
            </el-form-item>

            <el-form-item>
              <div class="time-setting-block">
                <div class="c-label">设置触发时间</div>
                <div class="time-setting-grid">
                  <el-date-picker
                    v-model="taskDialogForm.triggerDate"
                    type="date"
                    value-format="YYYY-MM-DD"
                    placeholder="选择日期"
                    style="width: 100%"
                    :disabled="taskDialogForm.repeatType === 'hourly'"
                  />

                  <el-time-picker
                    v-model="taskDialogForm.triggerTime"
                    value-format="HH:mm"
                    format="HH:mm"
                    placeholder="选择时间"
                    style="width: 100%"
                  />
                </div>
              </div>
            </el-form-item>

            <div class="grid-two">
              <el-form-item>
                <div class="c-label">重复类型</div>
                <el-select v-model="taskDialogForm.repeatType" style="width: 100%">
                  <el-option v-for="item in REPEAT_TYPE_OPTIONS" :key="item.value" :label="item.label" :value="item.value" />
                </el-select>
              </el-form-item>

              <el-form-item class="status-switch-item">
                <div class="c-label">任务状态</div>
                <el-switch v-model="taskDialogForm.enabled" active-text="开启" inactive-text="" />
              </el-form-item>
            </div>

            <template v-if="taskDialogForm.repeatType === 'custom'">
              <div class="grid-two">
                <el-form-item>
                  <div class="time-setting-block">
                    <div class="c-label">重复频率</div>
                    <div class="time-setting-grid">
                      <el-select v-model="taskDialogForm.freqNum" style="width: 100%">
                        <el-option v-for="item in FREQ_NUM_OPTIONS" :key="item.value" :label="item.label" :value="item.value" />
                      </el-select>
                      <el-select v-model="taskDialogForm.freqUnit" style="width: 100%">
                        <el-option v-for="item in FREQ_UNIT_OPTIONS" :key="item.value" :label="item.label" :value="item.value" />
                      </el-select>
                    </div>
                  </div>
                </el-form-item>

                <el-form-item>
                  <div class="time-setting-block">
                    <div class="c-label">截止方式</div>
                    <div class="deadline-setting-grid">
                      <label class="deadline-radio-option" :class="{ active: taskDialogForm.deadlineType === 'never' }">
                        <input v-model="taskDialogForm.deadlineType" type="radio" value="never" />
                        <span>永不结束</span>
                      </label>
                      <label class="deadline-radio-option deadline-radio-option--date" :class="{ active: taskDialogForm.deadlineType === 'date' }">
                        <input v-model="taskDialogForm.deadlineType" type="radio" value="date" />
                        <el-date-picker
                          v-model="taskDialogForm.deadlineDate"
                          type="date"
                          value-format="YYYY-MM-DD"
                          placeholder="选择截止日期"
                          style="width: 100%"
                          :disabled="taskDialogForm.deadlineType !== 'date'"
                        />
                      </label>
                    </div>
                  </div>
                </el-form-item>
              </div>
            </template>
          </el-form>
        </div>
      </div>

      <template #footer>
        <div class="dialog-footer">
          <el-button @click="taskDialogVisible = false">取消</el-button>
          <el-button color="#a8071a" :loading="taskDialogLoading" @click="saveTask">
            {{ taskDialogMode === 'edit' ? '保存修改' : '创建任务' }}
          </el-button>
        </div>
      </template>
    </el-dialog>
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

.form-card,
.task-manager {
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

.dialog-mode-switch {
  margin-bottom: 16px;
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

.action-group {
  display: flex;
  gap: 12px;
  margin-top: 8px;
}

.schedule-inline-panel {
  margin-top: 16px;
  padding: 16px;
  border: 1px solid #E5E6EB;
  border-radius: 8px;
  background: #FFFFFF;
}

.time-setting-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.time-setting-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  width: 100%;
}

.commit-btn,
.secondary-btn {
  width: 100%;
  height: 40px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 500;
  margin-top: 0;
  cursor: pointer;
}

.commit-btn {
  background: #A8071A;
  color: #fff;
  border: none;
}

.commit-btn:hover { background: #C11126; }
.commit-btn:active { background: #8A0515; }

.secondary-btn {
  border: 1px solid #E5E6EB;
  color: #A8071A;
  background: #FFFFFF;
}

.secondary-btn:hover {
  border-color: #A8071A;
  color: #A8071A;
}

.c-label {
  display: flex;
  align-items: center;
  color: #1D2129;
}

.help-icon {
  width: 16px;
  height: 16px;
  margin-left: 4px;
}

.label-help-link {
  margin-left: 8px;
  font-size: 12px;
  color: #A8071A;
  line-height: 20px;
  text-decoration: none;
}

.label-help-link:hover {
  color: #C41D2C;
  text-decoration: underline;
}

.field-stack {
  width: 100%;
}

.status-switch-item {
  display: flex;
  align-items: center;
  gap: 12px;
}

.status-switch-item :deep(.el-form-item__content) {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: nowrap;
}

.radio-block {
  width: 100%;
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

.task-manager {
  margin-top: 0;
  padding: 0;
  overflow: hidden;
}

.task-manager-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  cursor: pointer;
  transition: background 0.2s ease;
  border-bottom: 1px solid transparent;
}

.task-manager-header:hover {
  background: #F7F8FA;
}

.task-manager-header.expanded {
  border-bottom-color: #E5E6EB;
}

.task-manager-header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.task-manager-header-left svg {
  width: 18px;
  height: 18px;
  color: #86909C;
  transition: color 0.2s ease;
}

.task-manager-header:hover .task-manager-header-left svg {
  color: #4E5969;
}

.task-manager-header-left span {
  font-size: 14px;
  font-weight: 500;
  color: #1D2129;
  line-height: 22px;
}

.task-count {
  font-size: 12px;
  color: #86909C;
  background: #F7F8FA;
  padding: 2px 8px;
  border-radius: 10px;
  border: 1px solid #E5E6EB;
  line-height: 18px;
}

.expand-arrow {
  width: 16px;
  height: 16px;
  color: #86909C;
  transition: transform 0.2s ease, color 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.expand-arrow svg {
  width: 100%;
  height: 100%;
}

.task-manager-header:hover .expand-arrow {
  color: #4E5969;
}

.task-manager-header.expanded .expand-arrow {
  transform: rotate(180deg);
}

.task-list {
  display: none;
  padding: 12px 16px 16px;
}

.task-list.active {
  display: block;
  animation: slideDown 0.2s ease;
}

.task-card {
  background: #FFFFFF;
  border: 1px solid #E5E6EB;
  border-radius: 6px;
  padding: 14px 16px;
  margin-bottom: 10px;
  transition: border-color 0.2s ease;
}

.task-card:last-child {
  margin-bottom: 0;
}

.task-card:hover {
  border-color: #D93648;
}

.task-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 6px;
}

.task-card-title {
  font-size: 14px;
  font-weight: 500;
  color: #1D2129;
  line-height: 22px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.task-card-desc,
.task-card-meta,
.empty-state,
.sub-hint {
  font-size: 13px;
  line-height: 20px;
  color: #86909C;
}

.task-card-desc,
.task-card-meta {
  margin-top: 0;
}

.task-card-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid #E5E6EB;
  flex-wrap: wrap;
}

.task-card-switch-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.task-card-switch {
  position: relative;
  width: 36px;
  height: 20px;
  background: #E5E6EB;
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.2s ease;
}

.task-card-switch.active {
  background: #A8071A;
}

.task-card-switch::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  background: #FFFFFF;
  border-radius: 50%;
  transition: transform 0.2s ease;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
}

.task-card-switch.active::after {
  transform: translateX(16px);
}

.task-card-switch-label {
  font-size: 12px;
  color: #86909C;
  line-height: 18px;
}

.empty-state {
  padding: 32px 0;
  text-align: center;
}

@keyframes slideDown {
  from { opacity: 0; transform: translateY(-8px); }
  to { opacity: 1; transform: translateY(0); }
}

.task-dialog-section + .task-dialog-section {
  margin-top: 12px;
}

.task-dialog-card {
  padding: 14px;
  border: 1px solid #E5E6EB;
  border-radius: 8px;
  background: #FFFFFF;
}

.task-dialog-scroll {
  max-height: min(70vh, 620px);
  overflow-y: auto;
  padding-right: 2px;
}

.task-dialog-title {
  font-size: 15px;
  font-weight: 600;
  color: #1D2129;
  line-height: 24px;
  margin-bottom: 12px;
}

.grid-two,
.grid-three {
  display: grid;
  gap: 12px;
}

.grid-two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.grid-three {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.warning-text {
  color: #A8071A;
}

.deadline-setting-grid {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 6px;
  width: 100%;
}

.deadline-radio-option {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-height: 32px;
  padding: 0;
  border: none;
  border-radius: 0;
  background: transparent;
  cursor: pointer;
  transition: color 0.2s ease;
  color: #1D2129;
}

.deadline-radio-option.active {
  color: #A8071A;
}

.deadline-radio-option input[type="radio"] {
  margin: 0;
  accent-color: #A8071A;
  flex-shrink: 0;
}

.deadline-radio-option--date {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr);
  align-items: center;
  column-gap: 6px;
  min-width: 0;
}

:deep(.schedule-edit-dialog .el-dialog) {
  width: min(370px, calc(100vw - 24px)) !important;
  max-width: calc(100vw - 24px);
  border-radius: 10px;
  overflow: hidden;
}

:deep(.schedule-edit-dialog .el-dialog__header) {
  padding: 14px 16px;
  margin-right: 0;
  border-bottom: 1px solid #E5E6EB;
}

:deep(.schedule-edit-dialog .el-dialog__title) {
  font-size: 15px;
  font-weight: 600;
  color: #1D2129;
}

:deep(.schedule-edit-dialog .el-dialog__body) {
  padding: 12px;
  background: #fffcfc;
}

:deep(.schedule-edit-dialog .el-dialog__footer) {
  padding: 0 12px 12px;
  background: #fffcfc;
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
  display: flex;
  align-items: center;
  justify-content: center;
}

.toast-icon svg {
  width: 100%;
  height: 100%;
}

.toast-loading .toast-icon svg {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@media (max-width: 720px) {
  .grid-two,
  .grid-three {
    grid-template-columns: minmax(0, 1fr);
  }

  .action-group {
    flex-direction: column;
  }
}
</style>
