<script setup>
import { createTableConfigSaver } from '@/utils/tableOutputConfig.mjs';
import InputFilterEditor from './InputFilterEditor.vue';
import { cloneInputFilter, prepareInputFilter, filterRecordIds } from '@/utils/inputFilter.mjs';
import { bitable, DateFormatter, FieldType, NumberFormatter } from "@lark-base-open/js-sdk";
import { computed, ref, onMounted, watch } from "vue";
import { ElNotification } from "element-plus";
import request from '@/utils/request';

const emit = defineEmits(['back']);

const props = defineProps({
  api_key: String,
});

const TASK_PLUGIN_TYPE = 'blogger_info';
const TASK_API_PATH = '/social/api/v1/feishu/schedule/tasks';
const TABLE_CONFIG_API_PATH = '/social/api/v1/feishu/profile-fetch/table-output-config';
const TABLE_CONFIGS_API_PATH = '/social/api/v1/feishu/profile-fetch/table-output-configs';
const MANUAL_TABLE_BASE_NAME = '博主信息';
const FIELD_SELECTION_STORAGE_KEY = 'blogger_info_selected_fields_v2';
const writeModeOptions = [
  { value: 'upsert', label: '更新或新增' },
  { value: 'append', label: '始终新增' },
];

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

const formatVerificationStatus = (value) => {
  if (value === true) return '已认证';
  if (value === false) return '未认证';
  return value ?? '';
};

const FIELD_CONFIG = [
  { key: "nickname", name: "作者名称", type: FieldType.Text, defaultSelected: true, getValue: (item) => item?.nickname ?? "" },
  { key: "uid", name: "作者账号", type: FieldType.Text, defaultSelected: true, getValue: (item) => item?.uid ?? "" },
  { key: "user_id", name: "作者ID", type: FieldType.Text, defaultSelected: true, getValue: (item) => item?.user_id ?? "" },
  { key: "profile_url", name: "作者主页链接", type: FieldType.Url, defaultSelected: true, getValue: (item) => item?.profile_url ?? "" },
  { key: "avatar", name: "作者头像", type: FieldType.Text, defaultSelected: true, getValue: (item) => item?.avatar ?? "" },
  { key: "signature", name: "个人简介", type: FieldType.Text, defaultSelected: true, getValue: (item) => item?.signature ?? "" },
  { key: "follower_count", name: "粉丝数", type: FieldType.Number, defaultSelected: true, formatter: NumberFormatter.INTEGER, getValue: (item) => Number(item?.follower_count) || 0 },
  { key: "following_count", name: "关注数", type: FieldType.Number, defaultSelected: true, formatter: NumberFormatter.INTEGER, getValue: (item) => Number(item?.following_count) || 0 },
  { key: "total_favorited", name: "获赞数", type: FieldType.Number, defaultSelected: true, formatter: NumberFormatter.INTEGER, getValue: (item) => Number(item?.total_favorited) || 0 },
  { key: "aweme_count", name: "作品数", type: FieldType.Number, defaultSelected: true, formatter: NumberFormatter.INTEGER, getValue: (item) => Number(item?.aweme_count) || 0 },
  { key: "verified", name: "认证状态", type: FieldType.Text, defaultSelected: true, getValue: (item) => formatVerificationStatus(item?.verified)},
  { key: "verification_category", name: "认证类型", type: FieldType.Text, defaultSelected: true, getValue: (item) => item?.verification_category ?? "" },
  { key: "social_type", name: "平台", type: FieldType.Text, defaultSelected: true, getValue: (item) => item?.social_type ?? "" },
  { key: "ip_location", name: "IP属地", type: FieldType.Text, defaultSelected: true, getValue: (item) => item?.ip_location ?? "" },
  { key: "ctime", name: "提取时间", type: FieldType.DateTime, defaultSelected: true, dateFormat: DateFormatter.DATE_TIME, getValue: (item) => (item?.ctime ? new Date(item.ctime * 1000).getTime() : "") },
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
  inputFilter: null,
  scope: 'n',
  rowCount: 5,
  manualUrls: '',
  targetTableId: '',
  writeMode: 'upsert',
  fieldMappings: [],
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
  inputFilter: null,
  scope: 'n',
  rowCount: 5,
  manualUrls: '',
  targetTableId: '',
  writeMode: 'upsert',
  fieldMappings: [],
  executionMode: 'immediate'
});

const fieldOptions = ref([]);
const tableOptions = ref([]);
const loading = ref(false);
const stopRequested = ref(false);
const toastVisible = ref(false);
const toastText = ref('');
const toastLoading = ref(false);
const selectedFieldKeys = ref([]);
const writeMode = ref('upsert');
const mappingDraft = ref([]);
const taskMappingDraft = ref([]);
const tableFieldOptions = ref([]);
const taskTableFieldOptions = ref([]);
const mainOutputTableId = ref('');
const mainConfigReadId = ref(0);
const taskConfigReadId = ref(0);
const taskOutputTableId = ref('');
const taskOutputLoading = ref(false);
const taskOutputError = ref('');
const taskOutputConfigReady = computed(() => {
  const config = taskDialogForm.value;
  if (config.targetType !== 'existing') return true;
  return !!config.targetTableId && taskOutputTableId.value === config.targetTableId;
});
const fieldReadRequests = new WeakMap();
const tableOutputConfigs = ref({});
const mappingExpanded = ref(false);
const tableConfigLoading = ref(false);
const loadedTableConfigs = ref(new Set());
const tableConfigSaving = ref(false);
const tableConfigApplying = ref(false);
const tableConfigSaveStatus = ref('');
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
  if (taskDialogVisible.value) return;
  taskDialogForm.value = {
    ...taskDialogForm.value,
    mode: formData.value.mode,
    targetType: formData.value.targetType,
    profileLinkFieldId: formData.value.profileLinkFieldId,
    inputFilter: cloneInputFilter(formData.value.inputFilter),
    scope: formData.value.scope,
    rowCount: formData.value.rowCount,
    manualUrls: formData.value.manualUrls,
    targetTableId: formData.value.targetTableId,
    writeMode: writeMode.value,
    fieldMappings: mappingDraft.value.map(item => ({ ...item })),
    selectedFieldKeys: [...selectedFieldKeys.value],
  };
};

const getActiveFieldConfigs = (keys = selectedFieldKeys.value) => FIELD_CONFIG.filter(field =>
  keys.includes(field.key)
);

const getWriteFieldConfigs = (keys = selectedFieldKeys.value, mode = writeMode.value) => {
  const fields = getActiveFieldConfigs(keys);
  if (mode === 'upsert') {
    for (const key of ['social_type', 'user_id']) {
      const config = FIELD_CONFIG.find(field => field.key === key);
      if (config && !fields.some(field => field.key === key)) fields.push(config);
    }
  }
  return fields;
};

const getAllowedFieldTypes = (config) => {
  if (config.type === FieldType.Number) {
    return [FieldType.Number, FieldType.Text];
  }
  if (config.name === '平台' || config.name === '作者名称') {
    return [FieldType.Text, FieldType.SingleSelect];
  }
  return [config.type];
};

const isFieldTypeCompatible = (fieldType, config) => {
  return getAllowedFieldTypes(config).includes(fieldType);
};

const normalizeFieldValue = (value, config, fieldType) => {
  if (config.type === FieldType.Number && fieldType === FieldType.Text) {
    return String(value ?? '');
  }

  if ((config.name === '平台' || config.name === '作者名称') && fieldType === FieldType.SingleSelect) {
    return value || null;
  }

  return value;
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
    const savedSource = taskDialogVisible.value && taskDialogMode.value === 'edit'
      ? taskDialogForm.value : null;
    const table = savedSource?.sourceTableId
      ? await bitable.base.getTableById(savedSource.sourceTableId)
      : await bitable.base.getActiveTable();
    const view = savedSource?.sourceViewId
      ? await table.getViewById(savedSource.sourceViewId)
      : await table.getActiveView();
    // 视图字段元数据按列顺序返回，数据表字段列表不保证与视图顺序一致。
    const fieldList = await view.getFieldMetaList();
    const urlFieldList = fieldList.filter(item =>
      item.type === FieldType.Url || item.type === FieldType.Text
    );

    fieldOptions.value = urlFieldList.map(field => ({
      id: field.id,
      name: field.name
    }));
  } catch (error) {
    console.error('获取字段列表失败:', error);
    fieldOptions.value = [{ id: 'nodata', name: '获取字段列表失败' }];
    if (!silent) {
      ElNotification({ message: '当前未在数据表页面，无法读取字段信息。请先打开目标数据表，再重试操作。', type: 'error', duration: 0 });
    }
  }
};

const handleLinkFieldDropdownVisibleChange = (visible) => {
  if (visible) {
    getFieldListByType({ silent: true });
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

const getTableFields = async (tableId, targetFields = tableFieldOptions) => {
  const requestId = Symbol();
  fieldReadRequests.set(targetFields, requestId);
  if (!tableId) { targetFields.value = []; return; }
  try {
    const table = await bitable.base.getTableById(tableId);
    const fields = await table.getFieldMetaList();
    if (fieldReadRequests.get(targetFields) !== requestId) return;
    targetFields.value = fields.map(field => ({ id: field.id, name: field.name, type: field.type }));
    return true;
  } catch (error) {
    if (fieldReadRequests.get(targetFields) !== requestId) return;
    targetFields.value = [];
    console.error('读取目标表字段失败:', error);
    return false;
  }
};

const loadCurrentTableFields = async () => {
  try {
    const table = await bitable.base.getActiveTable();
    await getTableFields(table.id);
  } catch (error) {
    tableFieldOptions.value = [];
    console.error('读取当前表格字段失败:', error);
  }
};

const loadCurrentTableOutputConfig = async () => {
  try {
    const table = await bitable.base.getActiveTable();
    await loadTableOutputConfig(table.id);
  } catch (error) {
    console.error('读取当前表格映射配置失败:', error);
  }
};

const loadTableOutputConfig = async (tableId) => {
  const requestId = ++mainConfigReadId.value;
  mainOutputTableId.value = '';
  loadedTableConfigs.value.delete(tableId);
  if (!props.api_key || !tableId) return;
  tableConfigLoading.value = true;
  tableConfigApplying.value = true;
  try {
    const selection = await bitable.base.getSelection();
    const response = await request({
      url: TABLE_CONFIGS_API_PATH,
      method: 'get',
      headers: { authorization: `Bearer ${props.api_key}` },
      params: { plugin_type: TASK_PLUGIN_TYPE, base_id: selection.baseId || '' },
    });
    if (requestId !== mainConfigReadId.value) return;
    if (response.data?.sta !== 0) throw new Error(response.data?.msg || '读取输出表配置失败');
    const data = response.data?.data;
    const list = Array.isArray(data) ? data : (data?.list || data?.items || []);
    tableOutputConfigs.value = Object.fromEntries(list.filter(item => item?.target_table_id).map(item => [item.target_table_id, item]));
    const config = tableOutputConfigs.value[tableId];
    writeMode.value = config?.write_mode || 'upsert';
    mappingDraft.value = Array.isArray(config?.field_mappings) ? config.field_mappings.map(item => ({ ...item })) : [];
    loadedTableConfigs.value.add(tableId);
    mainOutputTableId.value = tableId;
  } catch (error) {
    if (requestId !== mainConfigReadId.value) return;
    console.error('读取目标表配置失败:', error);
    ElNotification({ message: error.message || '读取输出表配置失败', type: 'error', duration: 0 });
  } finally {
    if (requestId === mainConfigReadId.value) {
      tableConfigLoading.value = false;
      tableConfigApplying.value = false;
    }
  }
};

const applyTaskTableOutputConfig = async (tableId) => {
  const requestId = ++taskConfigReadId.value;
  taskOutputTableId.value = '';
  taskOutputLoading.value = false;
  taskOutputError.value = '';
  loadedTableConfigs.value.delete(tableId);
  if (!tableId) {
    taskDialogForm.value.writeMode = 'upsert';
    taskMappingDraft.value = [];
    taskDialogForm.value.fieldMappings = [];
    await getTableFields('', taskTableFieldOptions);
    return;
  }
  taskOutputLoading.value = true;
  try {
    const fieldsLoaded = await getTableFields(tableId, taskTableFieldOptions);
    if (requestId !== taskConfigReadId.value) return;
    if (fieldsLoaded === false) throw new Error('读取目标表字段失败');
    if (!props.api_key) throw new Error('请先设置 API Key');
    const selection = await bitable.base.getSelection();
    const response = await request({
      url: TABLE_CONFIGS_API_PATH,
      method: 'get',
      headers: { authorization: `Bearer ${props.api_key}` },
      params: { plugin_type: TASK_PLUGIN_TYPE, base_id: selection.baseId || '' },
    });
    if (requestId !== taskConfigReadId.value) return;
    if (response.data?.sta !== 0) throw new Error(response.data?.msg || '读取输出表配置失败');
    const data = response.data?.data;
    const list = Array.isArray(data) ? data : (data?.list || data?.items || []);
    const config = list.find(item => item?.target_table_id === tableId);
    taskDialogForm.value.writeMode = config?.write_mode || 'upsert';
    taskMappingDraft.value = Array.isArray(config?.field_mappings) ? config.field_mappings.map(item => ({ ...item })) : [];
    taskDialogForm.value.fieldMappings = taskMappingDraft.value.map(item => ({ ...item }));
    loadedTableConfigs.value.add(tableId);
    taskOutputTableId.value = tableId;
  } catch (error) {
    if (requestId !== taskConfigReadId.value) return;
    taskOutputError.value = error.message || '读取输出表配置失败';
  } finally {
    if (requestId === taskConfigReadId.value) taskOutputLoading.value = false;
  }
};

const persistTableOutputConfig = createTableConfigSaver(async (config) => {
  tableConfigSaving.value = true;
  tableConfigSaveStatus.value = '保存中';
  try {
    const payload = {
      plugin_type: TASK_PLUGIN_TYPE,
      base_id: (await bitable.base.getSelection()).baseId || '',
      target_table_id: config.targetTableId,
      target_table_name: await getTableNameById(config.targetTableId),
      write_mode: config.writeMode,
      field_mappings: config.fieldMappings,
    };
    const response = await request({
      url: TABLE_CONFIG_API_PATH, method: 'put',
      headers: { authorization: `Bearer ${props.api_key}` }, data: payload,
    });
    if (response.data?.sta !== 0) throw new Error(response.data?.msg || '保存输出表配置失败');
    const saved = response.data.data || payload;
    tableOutputConfigs.value = { ...tableOutputConfigs.value, [config.targetTableId]: saved };
    tableConfigSaveStatus.value = '已保存';
    return true;
  } catch (error) {
    tableConfigSaveStatus.value = '保存失败';
    throw error;
  } finally {
    tableConfigSaving.value = false;
  }
});

const saveTableOutputConfig = async (outputConfig = null) => {
  const source = outputConfig || {
    targetType: formData.value.targetType,
    targetTableId: mainOutputTableId.value,
    writeMode: writeMode.value,
    fieldMappings: mappingDraft.value,
    targetFieldOptions: tableFieldOptions.value,
  };
  const targetTableId = source.targetType === 'current'
    ? source.resolvedTargetTableId || mainOutputTableId.value : source.targetTableId;
  if (source.targetType !== 'existing') return true;
  if (outputConfig && taskDialogVisible.value && taskOutputTableId.value !== targetTableId) {
    throw new Error('输出表配置尚未加载完成，请加载完成后再保存');
  }
  if (!targetTableId || (!outputConfig && source.targetType === 'existing' && targetTableId !== formData.value.targetTableId)) {
    throw new Error('输出表配置尚未成功读取，请重新选择目标表后再保存');
  }
  if (!loadedTableConfigs.value.has(targetTableId)) throw new Error('输出表配置尚未成功读取，请重新打开页面后再保存');
  const targetFields = source.targetFieldOptions || tableFieldOptions.value;
  const fieldMappings = (source.fieldMappings || []).map(item => ({ ...item }));
  if (fieldMappings.some(item => !item.source_key || !item.target_field_id)) {
    throw new Error('请完成字段映射后再保存');
  }
  return persistTableOutputConfig({
    targetTableId,
    writeMode: source.writeMode || 'upsert',
    fieldMappings: fieldMappings.map(item => ({
      ...item,
      source_name: FIELD_CONFIG.find(field => field.key === item.source_key)?.name || item.source_name || '',
      target_field_name: targetFields.find(field => field.id === item.target_field_id)?.name || item.target_field_name || '',
    })),
  });
};

const saveMainTableOutputConfig = () => {
  if (!loadedTableConfigs.value.has(mainOutputTableId.value) || tableConfigApplying.value || taskDialogVisible.value || !mainOutputTableId.value) return;
  if (formData.value.targetType !== 'existing' || mainOutputTableId.value !== formData.value.targetTableId) return;
  if (mappingDraft.value.some(item => !item.source_key || !item.target_field_id)) return;
  void saveTableOutputConfig().catch(error => console.error('保存输出表配置失败:', error));
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
    if (config.formatter && field.type === FieldType.Number) {
      await field.setFormatter(config.formatter);
    }
    if (config.dateFormat && field.type === FieldType.DateTime) {
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
    const mappedKeys = new Set(mappingDraft.value
      .filter(item => item?.source_key && item?.target_field_id)
      .map(item => item.source_key));
    const fieldNameToId = await validateAndAddFields(
      tableId,
      activeFieldConfigs.filter(field => !mappedKeys.has(field.key))
    );
    if (!fieldNameToId) {
      return null;
    }
    return tableId;
  }

  return null;
};

const getAllVisibleRecordIdList = async (view, limit = Infinity) => {
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

    if (allRecordIdList.length >= limit || !hasMore || recordIds.length === 0) {
      break;
    }
  }

  return allRecordIdList;
};

const getRecordIdListByScope = async (table, scope, rowCount) => {
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
    const allRecordIdList = await getAllVisibleRecordIdList(view, rowCount);
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
      if (fieldConfig.formatter && field.type === FieldType.Number) {
        await field.setFormatter(fieldConfig.formatter);
      }
      if (fieldConfig.dateFormat && field.type === FieldType.DateTime) {
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

const writeDataToRecord = async (table, recordId, item, fieldNameToId, activeFieldConfigs, fieldMappings = []) => {
  try {
    const fields = {};
    const explicitMappings = new Map(
      fieldMappings
        .filter(mapping => mapping?.source_key && mapping?.target_field_id)
        .map(mapping => [mapping.source_key, mapping.target_field_id])
    );

    for (const config of activeFieldConfigs) {
      const fieldId = explicitMappings.get(config.key) || fieldNameToId[config.name];
      if (!fieldId) throw new Error(`未找到输出字段「${config.name}」`);

      try {
        const field = await table.getFieldById(fieldId);
        const fieldType = await field.getType();
        const value = normalizeFieldValue(config.getValue(item), config, fieldType);
        const cell = await field.createCell(value);
        fields[fieldId] = await cell.getValue();
      } catch (e) {
        console.error(`准备字段 ${config.name} 失败:`, e);
        throw e;
      }
    }

    if (!Object.keys(fields).length) throw new Error('没有可写入的字段');
    await table.setRecord(recordId, { fields });
  } catch (error) {
    console.error('写入记录失败:', error);
    throw error;
  }
};

const createCellValue = async (table, fieldId, item, config) => {
  const field = await table.getFieldById(fieldId);
  const fieldType = await field.getType();
  const value = normalizeFieldValue(config.getValue(item), config, fieldType);
  return await field.createCell(value);
};

const normalizeUniqueKeyPart = (value) => {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(normalizeUniqueKeyPart).filter(Boolean).join(',');
  if (typeof value === 'object') return normalizeUniqueKeyPart(value.text ?? value.name ?? value.value ?? '');
  return String(value).trim().toLowerCase();
};

const buildBloggerUniqueKey = (item) => {
  const socialType = normalizeUniqueKeyPart(item?.social_type);
  const userId = normalizeUniqueKeyPart(item?.user_id);
  return socialType && userId ? `${socialType}::${userId}` : '';
};

const appendRecordsToTable = async (tableId, list, activeFieldConfigs, options = {}) => {
  const table = await bitable.base.getTableById(tableId);
  const fieldList = await table.getFieldList();
  const fieldMetaMap = new Map();

  for (const field of fieldList) {
    const name = await field.getName();
    fieldMetaMap.set(name, field.id);
  }

  const explicitMappings = new Map((options.fieldMappings || []).filter(item => item?.source_key && item?.target_field_id).map(item => [item.source_key, item]));
  const fieldEntries = activeFieldConfigs.map(config => {
    const mapping = explicitMappings.get(config.key);
    const fieldId = mapping?.target_field_id || fieldMetaMap.get(config.name);
    return { config, fieldId };
  }).filter(item => item.fieldId);
  const records = [];
  const normalizedRecords = [];
  for (const item of list) {
    const cells = [];
    const fields = {};
    for (const { config, fieldId } of fieldEntries) {
      const cell = await createCellValue(table, fieldId, item, config);
      cells.push(cell);
      fields[fieldId] = await cell.getValue();
    }
    if (cells.length > 0) {
      records.push(cells);
      normalizedRecords.push(fields);
    }
  }

  if (records.length === 0) return;
  if (options.writeMode !== 'upsert') {
    await table.addRecords(records);
    return;
  }

  const keyEntries = ['social_type', 'user_id'].map(key => fieldEntries.find(item => item.config.key === key));
  if (keyEntries.some(item => !item?.fieldId)) {
    throw new Error('更新或新增需要“平台”和“作者ID”字段');
  }
  const existingByKey = new Map();
  let pageToken;
  do {
    const result = await table.getRecordsByPage({ pageSize: 200, pageToken });
    for (const record of result.records || []) {
      const key = buildBloggerUniqueKey({
        social_type: record.fields?.[keyEntries[0].fieldId],
        user_id: record.fields?.[keyEntries[1].fieldId],
      });
      if (key) existingByKey.set(key, record.recordId);
    }
    pageToken = result.hasMore ? result.pageToken : undefined;
  } while (pageToken !== undefined);

  const updates = [];
  const creates = [];
  list.forEach((item, index) => {
    const key = buildBloggerUniqueKey(item);
    if (!key) {
      creates.push(records[index]);
      return;
    }
    const recordId = existingByKey.get(key);
    if (recordId) updates.push({ recordId, fields: normalizedRecords[index] });
    else creates.push(records[index]);
  });
  if (updates.length) await table.setRecords(updates);
  if (creates.length) await table.addRecords(creates);
};

const fetchBloggerInfoByRows = async (rowList, { onSuccess = null } = {}) => {
  let successCount = 0;
  let failCount = 0;

  showToast(`准备处理 ${rowList.length} 条数据...`, true);

  for (let i = 0; i < rowList.length; i++) {
    if (stopRequested.value) {
      break;
    }

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
        const item = { ...res.data, __recordId: recordId };
        if (onSuccess) {
          await onSuccess(item, i);
        }
        successCount++;
      } else {
        ElNotification({ message: res.msg || '获取博主信息失败', type: 'error', duration: 0 });
        failCount++;
      }
    } catch (error) {
      if (error?.code === 'INVALID_API_KEY') {
        throw error;
      }
      ElNotification({ message: error.message || '请求失败', type: 'error', duration: 0 });
      failCount++;
    }
  }

  return { successCount, failCount, stopped: stopRequested.value };
};

const requestStop = () => {
  if (!loading.value) {
    return;
  }

  stopRequested.value = true;
  showToast('正在停止，等待当前请求完成...', true);
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

const getCellValuesByFieldId = async (table, recordIdList, fieldId) => {
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
      ElNotification({ message: '请选择作者主页链接字段', type: 'warning', duration: 0 });
      return false;
    }

    if (config.profileLinkFieldId === 'nodata') {
      ElNotification({ message: '未在数据表页面，无法读取字段信息。请先打开目标数据表，再重试操作。', type: 'error', duration: 0 });
      return false;
    }
  } else {
    if (!config.manualUrls || !config.manualUrls.trim()) {
      ElNotification({ message: '请输入作者主页链接', type: 'warning', duration: 0 });
      return false;
    }

    const urls = parseManualUrls(config.manualUrls);
    if (urls.length === 0) {
      ElNotification({ message: '请至少输入一个有效的作者主页链接', type: 'warning', duration: 0 });
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
    if (config.sourceTableId && taskDialogMode.value === 'edit') {
      await bitable.base.getTableById(config.sourceTableId);
    } else {
      await bitable.base.getActiveTable();
    }
    return true;
  } catch (error) {
    console.error('读取定时任务表格上下文失败:', error);
    ElNotification({
      message: config.sourceTableId && taskDialogMode.value === 'edit'
        ? `无法访问任务来源表「${config.sourceTableName || config.sourceTableId}」，请检查该表是否存在及访问权限。`
        : '请先打开目标数据表，再保存定时任务。',
      type: 'error',
      duration: 0,
    });
    return false;
  }
};

const getCurrentSourceContext = async (profileLinkFieldId, config = {}) => {
  const selection = await bitable.base.getSelection();
  const savedSource = config.sourceTableId && taskDialogMode.value === 'edit' ? config : null;
  const activeTable = savedSource
    ? await bitable.base.getTableById(savedSource.sourceTableId)
    : await bitable.base.getActiveTable();
  const activeView = savedSource?.sourceViewId
    ? await activeTable.getViewById(savedSource.sourceViewId)
    : await activeTable.getActiveView();
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

const inputFilterEditor = ref(null);
const taskInputFilterEditor = ref(null);
const validateConfiguredInputFilter = async (config, sourceTable = null, isTaskConfig = false) => {
  if (config.mode !== 'table' || !config.inputFilter) return null;
  const taskConfig = isTaskConfig || config === taskDialogForm.value;
  const editor = taskDialogVisible.value && taskConfig
    ? taskInputFilterEditor.value : inputFilterEditor.value;
  const savedSource = taskConfig && config.sourceTableId
    && taskDialogMode.value === 'edit';
  const table = sourceTable || (savedSource
    ? await bitable.base.getTableById(config.sourceTableId)
    : await bitable.base.getActiveTable());
  if (editor) return editor.validate(table, config.inputFilter);
  return prepareInputFilter(config.inputFilter, await table.getFieldMetaList(), table.id);
};

const buildTaskPayload = async (inputFilter, config = taskDialogForm.value) => {

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
    ElNotification({ message: '定时任务不支持“选中行”，请改为“全部行”或“前 N 行”', type: 'warning', duration: 0 });
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
    sourceContext = await getCurrentSourceContext(config.profileLinkFieldId, config);
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
    ...(config.mode === 'table' && inputFilter ? { input_filter: inputFilter } : {}),
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
      ? '全部行'
      : snapshot.scope === 'selected'
        ? '选中行'
        : `前 ${snapshot.row_count || 0} 行`;
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
  taskConfigReadId.value++;
  taskOutputTableId.value = '';
  taskOutputLoading.value = false;
  taskOutputError.value = '';
  fieldReadRequests.delete(taskTableFieldOptions);
  taskDialogForm.value = {
    ...getDefaultTaskDialogForm(),
    mode: formData.value.mode,
    targetType: formData.value.targetType,
    profileLinkFieldId: formData.value.profileLinkFieldId,
    inputFilter: cloneInputFilter(formData.value.inputFilter),
    scope: formData.value.scope,
    rowCount: formData.value.rowCount,
    manualUrls: formData.value.manualUrls,
    targetTableId: formData.value.targetTableId,
    writeMode: writeMode.value,
    fieldMappings: mappingDraft.value.map(item => ({ ...item })),
    selectedFieldKeys: [...selectedFieldKeys.value],
  };
  taskMappingDraft.value = mappingDraft.value.map(item => ({ ...item }));
  taskTableFieldOptions.value = tableFieldOptions.value.map(field => ({ ...field }));
  taskOutputTableId.value = tableConfigApplying.value ? '' : mainOutputTableId.value;

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
  taskConfigReadId.value++;
  taskOutputTableId.value = '';
  taskOutputLoading.value = false;
  taskOutputError.value = '';
  fieldReadRequests.delete(taskTableFieldOptions);
  const shouldLoadTables = tableOptions.value.length === 0;

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
    inputFilter: cloneInputFilter(snapshot.input_filter),
    scope: snapshot.scope || 'n',
    rowCount: snapshot.row_count || 5,
    manualUrls: snapshot.manual_urls || '',
    targetTableId: snapshot.target_table_id || '',
    writeMode: 'upsert',
    fieldMappings: [],
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

  const dialogForm = taskDialogForm.value;
  taskDialogVisible.value = true;
  if (shouldLoadTables) void loadTableOptions();

  if (taskDialogForm.value.targetType === 'existing' && taskDialogForm.value.targetTableId) {
    await applyTaskTableOutputConfig(taskDialogForm.value.targetTableId);
  }

  if (!taskDialogVisible.value || taskDialogForm.value !== dialogForm) return;
  if (dialogForm.mode === 'table') {
    await getFieldListByType({ silent: true });
  }
};

const saveTask = async () => {
  if (taskDialogLoading.value) return;
  const taskId = editingTaskId.value;
  const form = taskDialogForm.value;
  const inDialog = taskDialogVisible.value;
  taskDialogLoading.value = true;

  try {
    const config = JSON.parse(JSON.stringify(form));
    const targetFieldOptions = JSON.parse(JSON.stringify(inDialog ? taskTableFieldOptions.value : tableFieldOptions.value));
    config.fieldMappings = JSON.parse(JSON.stringify(inDialog ? taskMappingDraft.value : mappingDraft.value));
    if (taskDialogVisible.value && !taskOutputConfigReady.value) {
      throw new Error('输出表配置尚未加载完成，请等待加载完成或点击重试');
    }
    const inputFilter = await validateConfiguredInputFilter(config, null, true);
    const payload = await buildTaskPayload(inputFilter, config);
    if (!payload) {
      return;
    }
    if (taskDialogVisible.value && !taskOutputConfigReady.value) {
      throw new Error('输出表配置尚未加载完成，请等待加载完成或点击重试');
    }
    if (config.targetType === 'existing') {
      const fieldMappings = config.fieldMappings
        .map(item => ({ ...item }));
      const hasIncompleteMapping = fieldMappings.some(item => !item.source_key || !item.target_field_id);
      if (hasIncompleteMapping) {
        ElNotification({ message: '请完成字段映射后再保存任务', type: 'warning', duration: 0 });
        return;
      }
      config.fieldMappings = fieldMappings;
      await saveTableOutputConfig({
        targetType: config.targetType,
        targetTableId: config.targetTableId,
        writeMode: config.writeMode,
        fieldMappings,
        targetFieldOptions,
      });
    }

    const response = await request({
      url: taskId ? `${TASK_API_PATH}/${taskId}` : TASK_API_PATH,
      method: taskId ? 'put' : 'post',
      headers: { 'authorization': `Bearer ${props.api_key}` },
      data: payload,
    });

    const res = response.data;
    if (res.sta !== 0) {
      throw new Error(res.msg || '保存定时任务失败');
    }

    ElNotification({
      message: taskId ? '定时任务已更新' : '定时任务已创建',
      type: 'success',
    });

    if (taskDialogForm.value === form) {
      taskDialogVisible.value = false;
      taskDialogForm.value = getDefaultTaskDialogForm();
    }
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

  const executionMappings = JSON.parse(JSON.stringify(mappingDraft.value));
  const executionWriteMode = writeMode.value;
  stopRequested.value = false;
  loading.value = true;

  try {
    const sourceTable = await bitable.base.getActiveTable();
    const inputFilter = await validateConfiguredInputFilter(formData.value, sourceTable);
    const activeFieldConfigs = getActiveFieldConfigs();
    let recordIdList = await getRecordIdListByScope(
      sourceTable,
      formData.value.scope,
      formData.value.rowCount
    );

    if (!recordIdList) {
      loading.value = false;
      return;
    }

    if (inputFilter) {
      recordIdList = await filterRecordIds(sourceTable, recordIdList, inputFilter);
      if (stopRequested.value) {
        showToast('任务已停止', false);
        setTimeout(() => hideToast(), 3000);
        return;
      }
      if (!recordIdList.length) {
        ElNotification({ message: '没有符合筛选条件的数据', type: 'info' });
        return;
      }
    }

    const rowList = await getCellValuesByFieldId(sourceTable, recordIdList, formData.value.profileLinkFieldId);
    if (stopRequested.value) {
      showToast('任务已停止', false);
      setTimeout(() => hideToast(), 3000);
      return;
    }
    if (inputFilter && !rowList.length) {
      ElNotification({ message: '符合条件的行中没有可用链接', type: 'info' });
      return;
    }
    if (formData.value.targetType === 'current') {
      const fieldNameToId = await validateAndAddFields(sourceTable.id, activeFieldConfigs);
      if (!fieldNameToId) return;
      const { successCount, failCount, stopped } = await fetchBloggerInfoByRows(rowList, {
        onSuccess: (item) => writeDataToRecord(sourceTable, item.__recordId, item, fieldNameToId, activeFieldConfigs, executionMappings),
      });

      showToast(
        stopped
          ? `任务已停止：成功 ${successCount} 条，失败 ${failCount} 条`
          : `处理完成：成功 ${successCount} 条，失败 ${failCount} 条`,
        false
      );
      setTimeout(() => {
        hideToast();
      }, 3000);
      return;
    }

    const targetTableId = await resolveTargetTableId(formData.value.targetType, activeFieldConfigs);
    if (!targetTableId) {
      return;
    }

    const { successCount, failCount, stopped } = await fetchBloggerInfoByRows(rowList, {
      onSuccess: (item) => appendRecordsToTable(targetTableId, [item], activeFieldConfigs, {
        writeMode: executionWriteMode,
        fieldMappings: executionMappings,
      }),
    });

    showToast(
      stopped
        ? `任务已停止：成功 ${successCount} 条，失败 ${failCount} 条`
        : `处理完成：成功 ${successCount} 条，失败 ${failCount} 条`,
      false
    );
    setTimeout(() => {
      hideToast();
    }, 3000);
  } catch (error) {
    const errorMessage = error.message || '获取数据失败';
    showToast(`处理失败：${errorMessage}`, false);
    setTimeout(() => hideToast(), 3000);
    ElNotification({ message: errorMessage, type: 'error', duration: 0 });
  } finally {
    loading.value = false;
    stopRequested.value = false;
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
  const activeFieldConfigs = getWriteFieldConfigs();
  const executionMappings = JSON.parse(JSON.stringify(mappingDraft.value));
  const executionWriteMode = writeMode.value;
  stopRequested.value = false;
  loading.value = true;

  try {
    const rowList = urls.map(url => ({ url }));
    const targetTableId = await resolveTargetTableId(formData.value.targetType, activeFieldConfigs);
    if (!targetTableId) {
      return;
    }

    const { successCount, failCount, stopped } = await fetchBloggerInfoByRows(rowList, {
      onSuccess: (item) => appendRecordsToTable(targetTableId, [item], activeFieldConfigs, {
        writeMode: executionWriteMode,
        fieldMappings: executionMappings,
      }),
    });

    showToast(
      stopped
        ? `任务已停止：成功 ${successCount} 条，失败 ${failCount} 条`
        : `处理完成：成功 ${successCount} 条，失败 ${failCount} 条`,
      false
    );
    setTimeout(() => {
      hideToast();
    }, 3000);
  } catch (error) {
    const errorMessage = error.message || '获取数据失败';
    showToast(`处理失败：${errorMessage}`, false);
    setTimeout(() => hideToast(), 3000);
    ElNotification({ message: errorMessage, type: 'error', duration: 0 });
  } finally {
    loading.value = false;
    stopRequested.value = false;
  }
};

const handleSubmit = async () => {
  stopRequested.value = false;
  if (formData.value.mode === 'manual') {
    await handleManualModeSubmit();
    return;
  }

  await handleTableModeSubmit();
};

const handleTaskAction = () => {
  if (stopRequested.value) return;
  if (loading.value) {
    requestStop();
    return;
  }
  return handleSubmit();
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

const handleTaskModeChange = (mode) => {
  taskDialogForm.value.targetType = mode === 'table' ? 'current' : 'new';
  taskDialogForm.value.targetTableId = '';
  taskMappingDraft.value = [];
};

onMounted(() => {
  if (formData.value.mode === 'table') {
    getFieldListByType({ silent: true });
    loadCurrentTableFields();
    loadCurrentTableOutputConfig();
  }

  Promise.all([
    loadSelectedFieldKeys(),
    loadTaskList(),
  ]).finally(() => {
    fieldSelectionReady.value = true;
  });
});

const getMappingSourceFields = (mappings, index, selectedKeys) => {
  const usedSourceKeys = new Set(
    mappings
      .filter((item, itemIndex) => itemIndex !== index && item?.source_key)
      .map(item => item.source_key)
  );

  return FIELD_CONFIG
    .filter(field => selectedKeys.includes(field.key))
    .map(field => ({ ...field, disabled: usedSourceKeys.has(field.key) }));
};

const getMappingTargetFields = (mappings, index, fields = tableFieldOptions.value) => {
  const usedTargetFieldIds = new Set(
    mappings
      .filter((item, itemIndex) => itemIndex !== index && item?.target_field_id)
      .map(item => item.target_field_id)
  );

  return fields.map(field => ({
    ...field,
    disabled: usedTargetFieldIds.has(field.id),
  }));
};

const mappingSourceFields = (index) => getMappingSourceFields(
  mappingDraft.value,
  index,
  selectedFieldKeys.value
);

const taskMappingSourceFields = (index) => getMappingSourceFields(
  taskMappingDraft.value,
  index,
  taskDialogForm.value.selectedFieldKeys
);
const allFieldKeys = FIELD_CONFIG.map(field => field.key);
const isAllFieldsSelected = computed(() => allFieldKeys.every(key => selectedFieldKeys.value.includes(key)));
const isFieldsPartiallySelected = computed(() =>
  !isAllFieldsSelected.value && selectedFieldKeys.value.some(key => allFieldKeys.includes(key))
);
const isTaskAllFieldsSelected = computed(() =>
  allFieldKeys.every(key => taskDialogForm.value.selectedFieldKeys.includes(key))
);
const isTaskFieldsPartiallySelected = computed(() =>
  !isTaskAllFieldsSelected.value && taskDialogForm.value.selectedFieldKeys.some(key => allFieldKeys.includes(key))
);
const toggleAllFields = (checked) => {
  selectedFieldKeys.value = checked
    ? [...allFieldKeys]
    : FIELD_CONFIG.filter(field => field.required).map(field => field.key);
};
const toggleAllTaskFields = (checked) => {
  taskDialogForm.value.selectedFieldKeys = checked
    ? [...allFieldKeys]
    : FIELD_CONFIG.filter(field => field.required).map(field => field.key);
};
const mappingStatus = () => {
  if (formData.value.mode === 'table') {
    const count = mappingDraft.value.filter(item => item.source_key && item.target_field_id).length;
    return count ? `已设置 ${count} 项映射` : '尚未设置自定义映射';
  }
  if (!formData.value.targetTableId) return '选择目标表格后可设置';
  const count = mappingDraft.value.filter(item => item.source_key && item.target_field_id).length;
  return count ? `已设置 ${count} 项映射` : '尚未设置自定义映射';
};

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
      loadCurrentTableFields();
      loadCurrentTableOutputConfig();
    } else if (formData.value.targetType === 'current') {
      formData.value.targetType = 'new';
    }

    if (formData.value.targetType === 'existing' && tableOptions.value.length === 0) {
      loadTableOptions();
      return;
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
      tableFieldOptions.value = [];
      mappingDraft.value = [];
      writeMode.value = 'upsert';
    } else if (formData.value.targetTableId) {
      getTableFields(formData.value.targetTableId);
      loadTableOutputConfig(formData.value.targetTableId);
    }

    syncMainFormToTaskForm();
  }
);

watch([writeMode, mappingDraft], () => {
  syncMainFormToTaskForm();
  saveMainTableOutputConfig();
}, { deep: true, flush: 'sync' });

watch(
  () => [
    formData.value.profileLinkFieldId,
    formData.value.scope,
    formData.value.inputFilter,
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
      taskConfigReadId.value++;
      taskOutputTableId.value = '';
      taskOutputLoading.value = false;
      taskOutputError.value = '';
      fieldReadRequests.delete(taskTableFieldOptions);
      taskDialogForm.value = getDefaultTaskDialogForm();
      taskMappingDraft.value = [];
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
  <div class="sub-page" :inert="taskDialogLoading ? '' : null">
    <div class="sub-page-header">
      <span class="sub-page-back" :aria-disabled="loading" :title="(loading) ? '请等待任务结束后返回' : '返回'" @click="!(loading) && emit('back')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16">
          <polyline points="15 18 9 12 15 6"></polyline>
        </svg>
      </span>
      <span class="sub-page-title">获取作者信息</span>
    </div>

    <div class="form-card">
      <div class="execution-config" :inert="loading ? '' : null" :aria-busy="loading">
      <div class="section-heading"><span class="section-step">1</span><span>获取设置</span></div>
      <div class="group-label">作者主页链接来源</div>
      <el-radio-group v-model="formData.mode" class="source-mode-radio">
        <el-radio value="table">从表格选取</el-radio>
        <el-radio value="manual">手动输入</el-radio>
      </el-radio-group>

      <el-form class="form" :model="formData" label-position="top">
        <template v-if="formData.mode === 'table'">
          <el-form-item label="">
            <div class="c-label">
              作者主页链接所在字段
            </div>
            <el-select
              v-model="formData.profileLinkFieldId"
              filterable
              placeholder="输入字段名称搜索或选择"
              no-match-text="未找到匹配字段"
              style="width: 100%"
              @visible-change="handleLinkFieldDropdownVisibleChange"
            >
              <el-option v-for="field in fieldOptions" :key="field.id" :label="field.name" :value="field.id" />
            </el-select>
          </el-form-item>

          <el-form-item label="" style="margin-top: 12px">
            <div class="c-label">
              输入行范围
              <el-tooltip effect="dark" placement="top">
                <template #content>选择要执行的输入行范围</template>
                <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png" class="help-icon" />
              </el-tooltip>
            </div>
            <el-radio-group v-model="formData.scope" class="custom-radio-group">
              <el-radio value="all" class="custom-radio-item">全部行</el-radio>
              <el-radio value="selected" class="custom-radio-item">选中行</el-radio>
              <el-radio value="n" class="custom-radio-item">
                <span class="radio-label-text">前</span>
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
                  <span class="range-unit">行</span>
              </el-radio>
            </el-radio-group>
          </el-form-item>
          <InputFilterEditor ref="inputFilterEditor" v-model="formData.inputFilter" />
        </template>

        <template v-else>
          <el-form-item>
            <div class="c-label">
              作者主页链接
            </div>
            <el-input
              v-model="formData.manualUrls"
              type="textarea"
              :rows="4"
              class="c-input"
              placeholder="请输入作者主页链接，支持批量输入（多个链接请换行或用逗号分隔）"
            />
          </el-form-item>
        </template>

        <div class="output-config">
          <div class="section-heading output-heading"><span class="section-step">2</span><span>输出设置</span></div>
          <el-form-item v-if="formData.mode === 'manual'" label="">
            <div class="c-label">输出到表格</div>
            <el-radio-group v-model="formData.targetType" class="radio-block">
              <el-radio value="new">新建表格</el-radio>
              <el-radio value="existing">使用现有表格</el-radio>
            </el-radio-group>
          </el-form-item>

          <el-form-item v-if="formData.mode === 'manual' && formData.targetType === 'existing'" label="">
            <div class="c-label">选择现有表格</div>
            <el-select v-model="formData.targetTableId" placeholder="请选择" style="width: 100%" @change="loadTableOutputConfig(formData.targetTableId); getTableFields(formData.targetTableId)">
              <el-option v-for="table in tableOptions" :key="table.id" :label="table.name" :value="table.id" />
            </el-select>
          </el-form-item>

          <el-form-item v-if="formData.mode === 'manual' && formData.targetType === 'existing'" label="">
            <div class="c-label">数据写入方式</div>
            <el-radio-group v-model="writeMode" class="radio-block">
              <el-radio v-for="item in writeModeOptions" :key="item.value" :value="item.value">
                {{ item.label }}
                <el-tooltip v-if="item.value === 'upsert'" effect="dark" placement="top">
                </el-tooltip>
              </el-radio>
            </el-radio-group>
          </el-form-item>

          <el-form-item label="">
            <div class="field-selection-content">
              <div class="field-selection-title"><div class="c-label">输出字段</div></div>
              <el-checkbox
                :model-value="isAllFieldsSelected"
                :indeterminate="isFieldsPartiallySelected"
                class="select-all-fields"
                @change="toggleAllFields"
              >
                全选
              </el-checkbox>
              <el-checkbox-group v-model="selectedFieldKeys" class="field-checkbox-group">
                <el-checkbox v-for="field in FIELD_CONFIG" :key="field.key" :label="field.key" class="field-checkbox-item">{{ field.name }}</el-checkbox>
              </el-checkbox-group>
            </div>
          </el-form-item>

          <div v-if="formData.mode === 'table' || (formData.mode === 'manual' && formData.targetType === 'existing')" class="mapping-accordion">
            <button type="button" class="mapping-accordion-trigger" :aria-expanded="mappingExpanded" @click="mappingExpanded = !mappingExpanded">
              <span class="ui-disclosure-label">字段映射 <span class="mapping-optional ui-disclosure-meta">（可选）</span> <span class="mapping-status ui-disclosure-meta">{{ mappingStatus() }}</span></span>
              <span class="mapping-chevron" :class="{ 'is-expanded': mappingExpanded }"></span>
            </button>
            <div v-show="mappingExpanded" class="mapping-accordion-panel">
              <div v-if="tableConfigLoading" class="sub-hint">正在加载表格配置...</div>
              <template v-else>
                <p class="mapping-note">同名字段将自动写入；不同名时请在下方指定目标列。未映射且没有同名列时，将自动新建同名列。</p>
                <div v-for="(mapping, index) in mappingDraft" :key="`${mapping.source_key}-${index}`" class="mapping-row">
                  <el-select v-model="mapping.source_key" placeholder="选择输出字段" size="small">
                    <el-option v-for="field in mappingSourceFields(index)" :key="field.key" :label="field.name" :value="field.key" :disabled="field.disabled" />
                  </el-select>
                  <span class="mapping-arrow">→</span>
                  <el-select v-model="mapping.target_field_id" placeholder="选择目标字段" size="small">
                    <el-option v-for="field in getMappingTargetFields(mappingDraft, index)" :key="field.id" :label="field.name" :value="field.id" :disabled="field.disabled" />
                  </el-select>
                  <el-button link type="danger" class="mapping-delete" @click="mappingDraft.splice(index, 1)">删除</el-button>
                </div>
                <div class="mapping-actions"><el-button link type="primary" @click="mappingDraft.push({ source_key: '', target_field_id: '' })">+ 添加字段映射</el-button></div>
              </template>
            </div>
          </div>

          <el-form-item label="">
            <div class="c-label">执行方式</div>
            <el-radio-group v-model="formData.executionMode" class="radio-block">
              <el-radio value="immediate">立即执行</el-radio>
              <el-radio value="schedule">定时任务</el-radio>
            </el-radio-group>
          </el-form-item>

          <!-- 保留旧结构的字段节点仅用于兼容已有样式 -->
          <el-form-item v-if="false" label="">
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

        </div>
      </el-form>

      </div>

      <div v-if="formData.executionMode === 'immediate'" class="action-group">
        <el-button
          class="commit-btn"
          :class="{ 'is-running': loading }"
          :loading="stopRequested"
          :disabled="stopRequested"
          @click="handleTaskAction"
        >{{ stopRequested ? '正在停止…' : loading ? '停止任务' : '立即执行' }}</el-button>
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

          <el-form-item class="status-switch-item">
            <div class="c-label">任务状态</div>
            <el-switch v-model="taskDialogForm.enabled" active-text="开启" inactive-text="" />
          </el-form-item>
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
      :before-close="done => { if (!taskDialogLoading) done(); }"
      :close-on-click-modal="!taskDialogLoading"
      :close-on-press-escape="!taskDialogLoading"
      :show-close="!taskDialogLoading"
      destroy-on-close
    >
      <div class="task-dialog-scroll" :inert="taskDialogLoading ? '' : null" :aria-busy="taskDialogLoading">
        <div class="task-dialog-section task-dialog-card">
          <div class="c-label">作者主页链接来源</div>
          <el-radio-group v-model="taskDialogForm.mode" class="source-mode-radio" @change="handleTaskModeChange">
            <el-radio value="table">从表格选取</el-radio>
            <el-radio value="manual">手动输入</el-radio>
          </el-radio-group>

          <el-form label-position="top">
            <template v-if="taskDialogForm.mode === 'table'">
              <el-form-item>
                <div class="c-label">作者主页链接字段</div>
                <el-select
                  v-model="taskDialogForm.profileLinkFieldId"
                  filterable
                  placeholder="输入字段名称搜索或选择"
                  no-match-text="未找到匹配字段"
                  style="width: 100%"
                  @visible-change="handleLinkFieldDropdownVisibleChange"
                >
                  <el-option v-for="field in fieldOptions" :key="field.id" :label="field.name" :value="field.id" />
                </el-select>
                <div v-if="taskDialogMode === 'edit' && taskDialogForm.sourceTableId" class="sub-hint">
                  来源表：{{ taskDialogForm.sourceTableName || taskDialogForm.sourceTableId }}<template v-if="taskDialogForm.sourceViewId"> · 视图：{{ taskDialogForm.sourceViewName || taskDialogForm.sourceViewId }}</template>
                </div>
                <div v-else class="sub-hint">创建任务时使用当前表和视图。</div>
              </el-form-item>

              <el-form-item>
                <div class="c-label">输入行范围</div>
                <el-radio-group v-model="taskDialogForm.scope" class="custom-radio-group">
                  <el-radio value="all" class="custom-radio-item">全部行</el-radio>
                  <el-radio value="n" class="custom-radio-item">
                    <span class="radio-label-text">前</span>
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
                    <span class="range-unit">行</span>
                  </el-radio>
                </el-radio-group>
                <div class="sub-hint warning-text">定时任务不支持“选中行”。</div>
              </el-form-item>
              <InputFilterEditor ref="taskInputFilterEditor" v-model="taskDialogForm.inputFilter" :source-table-id="taskDialogForm.sourceTableId" />
            </template>

            <template v-else>
              <el-form-item>
                <div class="c-label">作者主页链接</div>
                <el-input
                  v-model="taskDialogForm.manualUrls"
                  type="textarea"
                  :rows="4"
                  placeholder="请输入作者主页链接，支持批量输入（多个链接请换行或用逗号分隔）"
                />
              </el-form-item>
            </template>

            <el-form-item v-if="taskDialogForm.mode === 'manual'">
              <div class="c-label">输出到表格</div>
              <el-radio-group v-model="taskDialogForm.targetType" class="radio-block">
                <el-radio value="new">新建表格</el-radio>
                <el-radio value="existing">使用现有表格</el-radio>
              </el-radio-group>
            </el-form-item>
            <el-form-item v-if="taskDialogForm.mode === 'manual' && taskDialogForm.targetType === 'existing'">
              <div class="c-label">选择现有表格</div>
              <el-select v-model="taskDialogForm.targetTableId" placeholder="请选择" style="width: 100%" @change="applyTaskTableOutputConfig(taskDialogForm.targetTableId)">
                <el-option v-for="table in tableOptions" :key="table.id" :label="table.name" :value="table.id" />
              </el-select>
            </el-form-item>
            <div v-if="taskDialogForm.targetType === 'existing' && (taskOutputLoading || taskOutputError)" class="table-config-feedback sub-hint" role="status" aria-live="polite">
              <template v-if="taskOutputLoading">
                <svg class="table-config-spinner" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="42 16" /></svg>
                <span>正在加载表格配置…</span>
              </template>
              <template v-else>
                <span>表格配置加载失败，请重试</span>
                <el-button link type="primary" size="small" @click="applyTaskTableOutputConfig(taskDialogForm.targetTableId)">重试</el-button>
              </template>
            </div>

            <el-form-item v-if="taskDialogForm.mode === 'manual' && taskDialogForm.targetType === 'existing'">
              <div class="c-label">数据写入方式</div>
              <el-radio-group :disabled="!taskOutputConfigReady" v-model="taskDialogForm.writeMode" class="radio-block">
                <el-radio v-for="item in writeModeOptions" :key="item.value" :value="item.value">{{ item.label }}</el-radio>
              </el-radio-group>
            </el-form-item>

            <el-form-item>
              <div class="field-selection-content">
                <div class="c-label">选择需要的字段</div>
                <el-checkbox
                  :model-value="isTaskAllFieldsSelected"
                  :indeterminate="isTaskFieldsPartiallySelected"
                  class="select-all-fields"
                  @change="toggleAllTaskFields"
                >
                  全选
                </el-checkbox>
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
              </div>
            </el-form-item>

            <div v-if="taskDialogForm.mode === 'manual' && taskDialogForm.targetType === 'existing'" class="mapping-accordion">
              <button type="button" class="mapping-accordion-trigger" @click="mappingExpanded = !mappingExpanded">
                <span class="ui-disclosure-label">字段映射 <span class="mapping-optional ui-disclosure-meta">（可选）</span></span>
                <span class="mapping-chevron" :class="{ 'is-expanded': mappingExpanded }"></span>
              </button>
              <div v-show="mappingExpanded" class="mapping-accordion-panel">
                <p class="mapping-note">同名字段将自动写入；不同名时请在下方指定目标列。未映射且没有同名列时，将自动新建同名列。</p>
                <div v-for="(mapping, index) in taskMappingDraft" :key="`${mapping.source_key}-${index}`" class="mapping-row">
                  <el-select :disabled="!taskOutputConfigReady" v-model="mapping.source_key" placeholder="选择输出字段" size="small">
                    <el-option v-for="field in taskMappingSourceFields(index)" :key="field.key" :label="field.name" :value="field.key" :disabled="field.disabled" />
                  </el-select>
                  <span class="mapping-arrow">→</span>
                  <el-select :disabled="!taskOutputConfigReady" v-model="mapping.target_field_id" placeholder="选择目标字段" size="small">
                    <el-option v-for="field in getMappingTargetFields(taskMappingDraft, index, taskTableFieldOptions)" :key="field.id" :label="field.name" :value="field.id" :disabled="field.disabled" />
                  </el-select>
                  <el-button :disabled="!taskOutputConfigReady" link type="danger" class="mapping-delete" @click="taskMappingDraft.splice(index, 1)">删除</el-button>
                </div>
                <div class="mapping-actions"><el-button :disabled="!taskOutputConfigReady" link type="primary" @click="taskMappingDraft.push({ source_key: '', target_field_id: '' })">+ 添加字段映射</el-button></div>
              </div>
            </div>
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

            <el-form-item class="status-switch-item">
              <div class="c-label">任务状态</div>
              <el-switch v-model="taskDialogForm.enabled" active-text="开启" inactive-text="" />
            </el-form-item>
          </el-form>
        </div>
      </div>

      <template #footer>
        <div class="dialog-footer">
          <el-button :disabled="taskDialogLoading" @click="taskDialogVisible = false">取消</el-button>
          <el-button color="#a8071a" :loading="taskDialogLoading" :disabled="!taskOutputConfigReady" @click="saveTask">
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
  background: #F2F3F5;
  color: #1D2129;
}

.sub-page-header {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  gap: 8px;
  align-items: center;
  min-height: 48px;
  padding: 0 8px;
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
  margin-right: 0;
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
  overflow: hidden;
  font-size: var(--app-font-size-page);
  font-weight: var(--app-font-weight-semibold);
  color: #1D2129;
  line-height: 24px;
}

.form-card,
.task-manager {
  margin: 16px;
  padding: 20px;
  background: #FFFFFF;
  border: 0;
  border-radius: 8px;
  box-sizing: border-box;
}

.source-mode-radio {
  display: flex;
  align-items: center;
  gap: 16px;
  margin: 0 0 12px;
  /* padding-bottom: 12px; */
}
.source-mode-radio :deep(.el-radio) {
  margin-right: 0;
}
.source-mode-radio :deep(.el-radio__label) {
  padding-left: 8px;
  color: #1D2129;
  font-size: var(--app-font-size-body);
}
.source-mode-radio :deep(.el-radio__input.is-checked .el-radio__inner) {
  border-color: #A8071A;
  background: #A8071A;
}
.source-mode-radio :deep(.el-radio__input.is-checked + .el-radio__label) {
  color: #1D2129;
}

.group-label {
  margin-bottom: 8px;
  color: #4E5969;
  font-size: var(--app-font-size-body);
  line-height: 20px
  }

.section-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 12px;
  color: #1D2129;
  font-size: var(--app-font-size-section);
  font-weight: var(--app-font-weight-medium);
  line-height: 22px;
}
.section-step {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  color: #A8071A;
  background: #FFF1F2;
  font-size: var(--app-font-size-caption);
  font-weight: var(--app-font-weight-semibold);
}
.output-heading {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid #F0F1F3;
}

.form :deep(.el-form-item__label) {
  font-size: var(--app-font-size-body);
  color: #1d2129;
  margin-bottom: 8px;
}

.form :deep(.el-form-item__content) {
  font-size: var(--app-font-size-body);
}

.action-group {
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
  height: 36px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: var(--app-font-size-body);
  font-weight: var(--app-font-weight-medium);
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

.commit-btn.is-running {
  background: #fff;
  border: 1px solid #d5495c;
  color: #a8071a;
}
.commit-btn.is-running:hover { background: #fff1f2; }
.commit-btn.is-running:active { background: #ffe4e6; }
.commit-btn.is-running.is-disabled {
  background: #fafafa;
  border-color: #e5e6eb;
  color: #86909c;
  cursor: not-allowed;
}

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
  font-size: var(--app-font-size-caption);
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
  font-size: var(--app-font-size-body);
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

.range-unit {
  margin-left: 8px;
  color: #4E5969;
  font-size: var(--app-font-size-body);
  white-space: nowrap;
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

.custom-radio-group .custom-stepper-input {
  margin-left: 8px;
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
  font-size: var(--app-font-size-body);
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

.field-selection-content {
  width: 100%;
}
.field-selection-title {
  margin-bottom: 8px;
}
.field-selection-title .c-label {
  margin-bottom: 0;
}
.select-all-fields {
  margin-right: 0;
  margin-bottom: 8px;
}
.mapping-accordion {
  margin: 12px 0 16px;
  border-top: 1px solid #F0F1F3;
  border-bottom: 1px solid #F0F1F3;
}
.mapping-accordion-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  min-height: 48px;
  padding: 12px 0;
  color: #1D2129;
  background: transparent;
  border: 0;
  cursor: pointer;
  font: inherit;
  text-align: left;
}
.mapping-optional,
.mapping-status,
.mapping-note {
  color: #86909C;
  font-size: var(--app-font-size-caption);
  font-weight: var(--app-font-weight-regular);
}
.mapping-chevron {
  width: 8px;
  height: 8px;
  border-right: 1px solid #86909C;
  border-bottom: 1px solid #86909C;
  transform: rotate(45deg);
  transition: transform .2s ease;
}
.mapping-chevron.is-expanded { transform: rotate(225deg); }
.mapping-accordion-panel { padding: 0 0 12px; }
.mapping-note { margin: 0 0 12px; line-height: 18px; }
.mapping-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 12px minmax(0, 1fr) auto;
  align-items: center;
  gap: 4px;
  min-height: 44px;
  border-top: 1px solid #F0F1F3;
}
.mapping-row :deep(.el-select__wrapper) {
  min-height: 36px;
  height: 36px;
  padding: 0 12px;
  border-radius: 6px;
  box-shadow: 0 0 0 1px #E5E6EB inset;
}
.mapping-arrow { color: #86909C; }
.mapping-delete { min-width: 28px; padding: 4px; }
.mapping-actions { display: flex; align-items: center; gap: 12px; margin-top: 8px; }
.mapping-actions :deep(.el-button) { margin-left: 0; }

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
  padding: 16px;
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
  font-size: var(--app-font-size-body);
  font-weight: var(--app-font-weight-medium);
  color: #1D2129;
  line-height: 22px;
}

.task-count {
  font-size: var(--app-font-size-caption);
  color: #86909C;
  background: #F7F8FA;
  padding: 4px 8px;
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
  padding: 16px;
  margin-bottom: 8px;
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
  margin-bottom: 8px;
}

.task-card-title {
  font-size: var(--app-font-size-body);
  font-weight: var(--app-font-weight-medium);
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
  font-size: var(--app-font-size-small);
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
  padding-top: 8px;
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
  font-size: var(--app-font-size-caption);
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
  padding: 16px;
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
  font-size: var(--app-font-size-emphasis);
  font-weight: var(--app-font-weight-semibold);
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
  gap: 8px;
  width: 100%;
}

.deadline-radio-option {
  display: flex;
  align-items: center;
  gap: 8px;
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
  column-gap: 8px;
  min-width: 0;
}

:deep(.schedule-edit-dialog .el-dialog) {
  width: min(370px, calc(100vw - 24px)) !important;
  max-width: calc(100vw - 24px);
  border-radius: 10px;
  overflow: hidden;
}

:deep(.schedule-edit-dialog .el-dialog__header) {
  padding: 16px;
  margin-right: 0;
  border-bottom: 1px solid #E5E6EB;
}

:deep(.schedule-edit-dialog .el-dialog__title) {
  font-size: var(--app-font-size-emphasis);
  font-weight: var(--app-font-weight-semibold);
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
  padding: 8px 16px;
  background: #FFFFFF;
  border: 1px solid #E5E6EB;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  font-size: var(--app-font-size-body);
  font-weight: var(--app-font-weight-medium);
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
.sub-page { font-family: var(--app-font-family); }
.section-heading { font-size: var(--app-font-size-section); font-weight: var(--app-font-weight-medium); line-height: 22px; }
.group-label, .c-label { margin-bottom: 8px; font-size: var(--app-font-size-body); font-weight: var(--app-font-weight-medium); line-height: 20px; }
.source-mode-radio, .radio-block { display: flex; flex-wrap: wrap; gap: 16px; }
.source-mode-radio :deep(.el-radio), .radio-block :deep(.el-radio) { min-height: 28px; margin-right: 0; }
.custom-radio-group { gap: 8px; }
.sub-page :deep(.el-radio__label), .sub-page :deep(.el-checkbox__label) { font-family: inherit; font-size: var(--app-font-size-body); font-weight: var(--app-font-weight-regular); line-height: 20px; }
</style>

<style scoped src="../assets/output-layout.css"></style>
