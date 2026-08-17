<script setup>
import { bitable, DateFormatter, FieldType, NumberFormatter } from "@lark-base-open/js-sdk";
import { ElMessage, ElNotification } from "element-plus";
import { ref, onMounted, onUnmounted, watch } from "vue";
import request from '@/utils/request'
import { useIncrementalTask } from '@/composables/useIncrementalTask'

const props = defineProps({
  api_key: String,
})

let note_timer = null;
const formData = ref({
  mode: 'table',
  radio: 1,
  manualUrls: "",
  noteLinkFieldId: '',
  scope: 'n',
  rowCount: 5,
  pages: 1,
  reply_pages: -1,
  sortType: 'default',
  table_id: "",
});
const table_options = ref([]);
const fieldOptions = ref([]);
const loading = ref(false);
const profileProgress = ref({ text: "", done: false });
let page = 1;
const page_size = 20;
let total = 0;
const FIELD_SELECTION_STORAGE_KEY = 'comment_fetch_selected_fields_v1';
const STREAM_TASK_STORAGE_KEY = 'comment_fetch_stream_task_v1';
const selectedFieldKeys = ref([]);
const fieldSelectionReady = ref(false);
const toastVisible = ref(false);
const toastText = ref('');
const toastLoading = ref(false);
let toastTimer = null;

const FIELD_CONFIG = [
  { key: "cid", name: "评论ID", type: FieldType.Text, defaultSelected: true, required: true, getValue: (item) => item?.cid ?? "" },
  { key: "reply_id", name: "上级评论ID", type: FieldType.Text, defaultSelected: true, getValue: (item) => item?.reply_id ?? "" },
  { key: "note_id", name: "作品ID", type: FieldType.Text, defaultSelected: true, getValue: (item) => item?.note_id ?? "" },
  { key: "note_url", name: "作品链接", legacyNames: ["视频链接"], type: FieldType.Url, defaultSelected: true, getValue: (item) => item?.note_url ?? "" },
  { key: "social_type", name: "平台", type: FieldType.Text, defaultSelected: true, getValue: (item) => item?.social_type ?? "" },
  { key: "text", name: "评论内容", type: FieldType.Text, defaultSelected: true, getValue: (item) => item?.text ?? "" },
  { key: "nickname", name: "评论者名称", legacyNames: ["作者名称"], type: FieldType.Text, defaultSelected: true, getValue: (item) => item?.nickname ?? "" },
  { key: "social_user_number", name: "评论者账号", legacyNames: ["小红书ID"], type: FieldType.Text, defaultSelected: true, getValue: (item) => item?.social_user_number ?? "" },
  { key: "uid", name: "评论者ID", legacyNames: ["作者ID"], type: FieldType.Text, defaultSelected: true, getValue: (item) => item?.uid ?? "" },
  { key: "profile_url", name: "评论者主页链接", legacyNames: ["作者主页链接"], type: FieldType.Url, defaultSelected: true, getValue: (item) => item?.profile_url ?? "" },
  { key: "avatar", name: "评论者头像", type: FieldType.Text, defaultSelected: true, getValue: (item) => item?.avatar ?? "" },
  { key: "ip_label", name: "IP属地", type: FieldType.Text, defaultSelected: true, getValue: (item) => item?.ip_label ?? "" },
  { key: "digg_count", name: "点赞数", type: FieldType.Number, defaultSelected: true, formatter: NumberFormatter.INTEGER, getValue: (item) => Number(item?.digg_count) || 0 },
  { key: "reply_comment_total", name: "回复数", type: FieldType.Number, defaultSelected: true, formatter: NumberFormatter.INTEGER, getValue: (item) => Number(item?.reply_comment_total) || 0 },
  { key: "t_create", name: "评论时间", type: FieldType.DateTime, defaultSelected: true, dateFormat: DateFormatter.DATE_TIME, getValue: (item) => (item?.t_create ? item.t_create * 1000 : "") },
];
const FIELD_TYPE_NAME = {
  [FieldType.Text]: '文本',
  [FieldType.Number]: '数字',
  [FieldType.SingleSelect]: '单选',
  [FieldType.DateTime]: '日期时间',
  [FieldType.Url]: '链接',
  [FieldType.Attachment]: '附件',
};

const getAllowedFieldTypes = (config) => {
  if (config.name === '评论者名称' || config.name === '平台') {
    return [FieldType.Text, FieldType.SingleSelect];
  }
  return [config.type];
};

const isFieldTypeCompatible = (fieldType, config) => {
  return getAllowedFieldTypes(config).includes(fieldType);
};

const buildFieldPayload = (config) => {
  const fieldConfig = { name: config.name, type: config.type };
  if (config.formatter) {
    fieldConfig.formatter = config.formatter;
  }
  if (config.dateFormat) {
    fieldConfig.dateFormat = config.dateFormat;
  }
  return fieldConfig;
};

const getFieldInstanceMapByConfigs = async (table, configs) => {
  const fieldMetaList = await table.getFieldMetaList();
  const fieldMetaByName = new Map(fieldMetaList.map(meta => [meta.name, meta]));
  const fieldMap = new Map();

  for (const config of configs) {
    const fieldMeta = [config.name, ...(config.legacyNames || [])]
      .map(name => fieldMetaByName.get(name))
      .find(Boolean);
    if (!fieldMeta?.id) {
      continue;
    }
    const field = await table.getFieldById(fieldMeta.id);
    fieldMap.set(config.name, field);
  }

  return fieldMap;
};

const reply_pages_options = [
  { value: -1, label: "不获取" },
  { value: 0, label: "获取全部" },
  { value: 1, label: "仅获取首页" },
  { value: 5, label: "获取前5页" },
  { value: 10, label: "获取前10页" },
  { value: 20, label: "获取前20页" },
  { value: 30, label: "获取前30页" },
  { value: 50, label: "获取前50页" },
];
const pages_options = [
  { value: 0, label: "获取全部" },
  { value: 1, label: "仅获取首页" },
  { value: 5, label: "获取前5页" },
  { value: 10, label: "获取前10页" },
  { value: 20, label: "获取前20页" },
  { value: 30, label: "获取前30页" },
  { value: 50, label: "获取前50页" },
];
const xhsCommentSortOptions = [
  { value: 'default', label: '默认排序' },
  { value: 'time_descending', label: '最新评论优先' },
  { value: 'like_count_descending', label: '点赞最多优先' },
];

const scopeOptions = [
  { value: 'all', label: '执行所有行' },
  { value: 'selected', label: '执行选中行' },
  { value: 'n', label: '执行前N行' },
];

const showErrorMsg = (message) => {
  ElMessage({ message, type: "error", plain: true });
};

const showToast = (text, isLoading = true) => {
  if (toastTimer) clearTimeout(toastTimer);
  toastText.value = text;
  toastLoading.value = isLoading;
  toastVisible.value = true;
};

const showCompletionToast = (text) => {
  showToast(text, false);
  toastTimer = setTimeout(() => { toastVisible.value = false; }, 3000);
};

const getDefaultSelectedFieldKeys = () => FIELD_CONFIG
  .filter(field => field.defaultSelected || field.required)
  .map(field => field.key);

const getActiveFieldConfigs = () => {
  const selectedKeySet = new Set(selectedFieldKeys.value);
  return FIELD_CONFIG.filter(field => field.required || selectedKeySet.has(field.key));
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
    const requiredKeys = FIELD_CONFIG.filter(field => field.required).map(field => field.key);
    const mergedKeys = Array.from(new Set([...validKeys, ...requiredKeys]));
    selectedFieldKeys.value = mergedKeys.length > 0 ? mergedKeys : defaultKeys;
  } catch (error) {
    console.error('读取字段勾选状态失败:', error);
    selectedFieldKeys.value = defaultKeys;
  }
};

const saveSelectedFieldKeys = async (keys) => {
  try {
    const requiredKeys = FIELD_CONFIG.filter(field => field.required).map(field => field.key);
    const nextKeys = Array.from(new Set([...keys, ...requiredKeys]));
    await bitable.bridge.setData(FIELD_SELECTION_STORAGE_KEY, [...nextKeys]);
  } catch (error) {
    console.error('保存字段勾选状态失败:', error);
  }
};

const resetParams = () => {
  loading.value = false;
  profileProgress.value = { text: "", done: false };
  page = 1;
  total = 0;
};

const closeNoteInterval = () => {
  note_timer && clearInterval(note_timer);
  note_timer = null;
};

onMounted(async () => {
  await loadFieldOptions({ silent: true });
  await loadSelectedFieldKeys();
  fieldSelectionReady.value = true;
  await commentStreamTask.resume(() => {
    loading.value = true;
    showToast('正在恢复未完成的评论采集任务...', true);
  });
});

onUnmounted(() => {
  closeNoteInterval();
  commentStreamTask.stop();
  if (toastTimer) clearTimeout(toastTimer);
});

const loadTableOptions = async () => {
  try {
    const tableList = await bitable.base.getTableList();
    const options = await Promise.all(
      tableList.map(async (table) => ({
        id: table.id,
        name: await table.getName(),
      }))
    );
    table_options.value = options.filter(item => !!item.id);
  } catch (error) {
    console.error("获取表格列表失败:", error);
    showErrorMsg("获取表格列表失败，请稍后重试");
  }
};

const loadFieldOptions = async ({ silent = false } = {}) => {
  try {
    const table = await bitable.base.getActiveTable();
    const fieldList = await table.getFieldList();
    const urlFieldList = fieldList.filter(item =>
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
    if (!silent) {
      showErrorMsg('当前未在数据表页面，无法读取字段信息。请先打开目标数据表，再重试操作。');
    }
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

const extractNoteLink = (value) => {
  if (!value) return null;

  if (typeof value === 'string') {
    return value.trim() || null;
  }

  if (typeof value === 'object') {
    const keys = ['link', 'url', 'text', 'content', 'value', 'displayText'];
    for (const key of keys) {
      const nested = extractNoteLink(value[key]);
      if (nested) return nested;
    }
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = extractNoteLink(item);
      if (nested) return nested;
    }
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

const getNoteUrlsByFieldId = async (recordIdList, fieldId) => {
  const table = await bitable.base.getActiveTable();
  const field = await table.getFieldById(fieldId);

  const rows = await Promise.all(
    recordIdList.map(async (recordId) => {
      try {
        const cell = await field.getCell(recordId);
        const value = await cell.getValue();
        return extractNoteLink(value);
      } catch (error) {
        return null;
      }
    })
  );

  return [...new Set(rows.filter(item => typeof item === 'string' && item.trim()))];
};

watch(
  () => formData.value.radio,
  (radio) => {
    if (radio === 2) {
      loadTableOptions();
    } else {
      formData.value.table_id = "";
    }
  }
);

watch(
  () => formData.value.mode,
  (mode) => {
    if (mode === 'table') {
      loadFieldOptions({ silent: false });
    }
  }
);

const createSequentialTable = async (baseTableName) => {
  try {
    const existingTables = await bitable.base.getTableMetaList();
    const tableNames = existingTables.map(table => table.name);
    const existsBaseTable = tableNames.includes(baseTableName);
    const existsSequentialTable = tableNames.some(name => name.startsWith(`${baseTableName}`) && /\d+$/.test(name.slice(baseTableName.length)));
    if (!existsBaseTable && !existsSequentialTable) {
      const newTable = await bitable.base.addTable({ name: baseTableName });
      return newTable;
    }
    const reg = new RegExp(`^${baseTableName}(\\d+)$`);
    let maxIndex = 0;
    tableNames.forEach(name => {
      const match = name.match(reg);
      if (match) {
        const index = parseInt(match[1], 10);
        if (index > maxIndex) maxIndex = index;
      }
    });
    const newTableName = `${baseTableName}${maxIndex + 1}`;
    const newTable = await bitable.base.addTable({ name: newTableName });
    return newTable;
  } catch (error) {
    console.error("获取表格序号失败：", error);
    throw error;
  }
};

const createAndWriteData = async (list, type, task_id, targetTableId = "", options = {}) => {
  if (!list || list.length == 0) {
    ElMessage({ message: list ? "获取数据为空" : "获取数据异常，请稍后重试", type: "warning", plain: true });
    resetParams();
    return;
  }
  try {
    const activeFieldConfigs = getActiveFieldConfigs();
    const fields = activeFieldConfigs.map(buildFieldPayload);
    const ensureFieldDisplayConfig = async (field, config) => {
      if (config.formatter) {
        await field.setFormatter(config.formatter);
      }
      if (config.dateFormat) {
        await field.setDateFormat(config.dateFormat);
      }
    };

    let resolvedTargetTableId = targetTableId;
    if (!type && !resolvedTargetTableId) {
      const tableName = '社媒评论加载工具';
      const { tableId } = await createSequentialTable(tableName);
      const newTable = await bitable.base.getTable(tableId);
      await bitable.ui.switchToTable(tableId);
      const fieldMetaList = await newTable.getFieldMetaList();
      const firstFieldId = fieldMetaList[0]?.id;
      if (firstFieldId) {
        await newTable.setField(firstFieldId, { ...fields[0] });
      }
      for (let i = 1; i < fields.length; i++) {
        await newTable.addField({ ...fields[i] });
      }
      resolvedTargetTableId = tableId;
      await options.onTargetTableReady?.(tableId);
    }

    const activeTable = resolvedTargetTableId
      ? await bitable.base.getTableById(resolvedTargetTableId)
      : await bitable.base.getActiveTable();

    if (resolvedTargetTableId) {
      let existingFieldMap = await getFieldInstanceMapByConfigs(activeTable, activeFieldConfigs);

      for (const config of activeFieldConfigs) {
        if (!existingFieldMap.has(config.name)) {
          await activeTable.addField(buildFieldPayload(config));
        }
      }

      existingFieldMap = await getFieldInstanceMapByConfigs(activeTable, activeFieldConfigs);

      for (const config of activeFieldConfigs) {
        const field = existingFieldMap.get(config.name);
        if (!field) {
          throw new Error(`字段 ${config.name} 创建后读取失败`);
        }
        try {
          await ensureFieldDisplayConfig(field, config);
        } catch (error) {
          console.error(`设置字段 ${config.name} 格式失败:`, error);
        }
      }
      const records = [];
      for (const item of list) {
        const record = [];
        for (const config of activeFieldConfigs) {
          const field = existingFieldMap.get(config.name);
          const fieldType = await field.getType();
          const value = (config.name === '评论者名称' || config.name === '平台') && fieldType === FieldType.SingleSelect
            ? (config.getValue(item) || null)
            : config.getValue(item);
          record.push(await field.createCell(value));
        }
        records.push(record);
      }
      await activeTable.addRecords(records);
      if (options.stopAfterCurrentBatch) return { tableId: activeTable.id };
      resetParams();
      return;
    }

    const fieldList = [];
    for (const config of fields) {
      const field = await activeTable.getField(config.name);
      await ensureFieldDisplayConfig(field, config);
      fieldList.push(field);
    }
    let records = [];
    for (const item of list) {
      let record = [];
      for (let i = 0; i < fields.length; i++) {
        const mapping = activeFieldConfigs[i];
        const fieldType = await fieldList[i].getType();
        const value = (mapping.name === '评论者名称' || mapping.name === '平台') && fieldType === FieldType.SingleSelect
          ? (mapping.getValue(item) || null)
          : mapping.getValue(item);
        record.push(await fieldList[i].createCell(value));
      }
      records.push(record);
    }
    await activeTable.addRecords(records);
    if (options.stopAfterCurrentBatch) return { tableId: activeTable.id };
    resetParams();
  } catch (error) {
    console.error("🚀 ~ createAndWriteData ~ error:", error)
    if (options.stopAfterCurrentBatch) {
      throw error;
    }
    resetParams();
  }
};

const commentStreamTask = useIncrementalTask({
  storageKey: STREAM_TASK_STORAGE_KEY,
  getStatus: async (task) => (await request({ url: `/social/api/v1/feishu/comment/task?task_id=${encodeURIComponent(task.taskId)}`, method: 'get', headers: { authorization: `Bearer ${props.api_key}` } })).data,
  getResults: async (task) => (await request({ url: '/social/api/v1/feishu/comment/list', method: 'post', headers: { authorization: `Bearer ${props.api_key}` }, data: { task_id: task.taskId, after_id: task.cursor || '', limit: 20 } })).data,
  writeBatch: async (items, task) => {
    const result = await createAndWriteData(items, task.targetTableId ? 'stream' : '', task.taskId, task.targetTableId || '', {
      stopAfterCurrentBatch: true,
      onTargetTableReady: async (tableId) => { task.targetTableId = tableId; },
    });
    task.targetTableId = result?.tableId || task.targetTableId;
  },
  onProgress: (status, task) => {
    const processed = Number(status.processed) || 0;
    const totalCount = Number(status.total) || 0;
    showToast(`已处理 ${totalCount ? `${processed}/${totalCount}` : processed} 个作品，已写入 ${task.writtenCount || 0} 条评论`, true);
  },
  onWriting: (items) => showToast(`正在写入 ${items.length} 条评论...`, true),
  onFinish: async (status, task) => {
    loading.value = false;
    showCompletionToast(Number(status.status) === 2 ? (status.reason || '任务失败') : `处理完成，已写入 ${task.writtenCount || 0} 条评论`);
    if (Number(status.status) === 2) showErrorMsg(status.reason || '获取数据失败，请稍后重试');
  },
  onError: async (error) => {
    loading.value = false;
    showCompletionToast(error.message || '任务长时间没有进度');
    showErrorMsg(error.message || '任务长时间没有进度');
  },
});

const postNoteTask = async (targetTableId = "", urlText = "", extraPayload = {}) => {
  await request({
    url: "/social/api/v1/feishu/comment/task",
    method: "post",
    headers: { 'authorization': `Bearer ${props.api_key}` },
    data: {
      url: urlText,
      pages: Number(formData.value.pages),
      reply_pages: Number(formData.value.reply_pages),
      ...extraPayload,
    },
  })
    .then(function (response) {
      let res = response.data;
      if (res.sta == 0) {
        const data = res.data;
        commentStreamTask.start({ taskId: data.task_id, targetTableId });
      } else {
        loading.value = false;
        showErrorMsg(res.msg);
      }
    })
    .catch(function (error) {
      loading.value = false;
      console.log(error);
      showErrorMsg(error);
    });
};

const getNoteData = async (targetTableId = "", urlList = []) => {
  if (urlList.length === 0) {
    showErrorMsg("请至少输入一个有效的帖子链接");
    return;
  }

  loading.value = true;
  await postNoteTask(targetTableId, urlList.join('\n'), { sort_type: formData.value.sortType });
};

const validateTableFields = async (tableId) => {
  try {
    const activeTable = await bitable.base.getTableById(tableId);
    const fieldMetaList = await activeTable.getFieldMetaList();
    const fieldIdByName = new Map(fieldMetaList.map(meta => [meta.name, meta.id]));
    for (const config of getActiveFieldConfigs()) {
      const fieldId = [config.name, ...(config.legacyNames || [])]
        .map(name => fieldIdByName.get(name))
        .find(Boolean);
      if (!fieldId) continue;
      const fieldMeta = fieldMetaList.find(meta => meta.id === fieldId);
      if (config.type && !isFieldTypeCompatible(fieldMeta.type, config)) {
        ElNotification({ title: '出错', message: `字段类型不匹配:字段"${config.name}" 的类型是 ${FIELD_TYPE_NAME[fieldMeta.type] || fieldMeta.type}，仅支持 ${getAllowedFieldTypes(config).map(type => FIELD_TYPE_NAME[type] || type).join(' / ')}`, type: 'error', duration: 0 });
        return false;
      }
    }
    return true;
  } catch (error) {
    console.error("验证表格字段时出错:", error);
    showErrorMsg("验证表格字段失败，请稍后重试");
    return false;
  }
};

const commit = async () => {
  if (loading.value) return;
  if (!props.api_key) {
    showErrorMsg("请输入API key");
    return;
  }
  const { radio, table_id, mode, manualUrls, noteLinkFieldId, scope, rowCount } = formData.value;
  if (radio === 2 && !table_id) {
    showErrorMsg("请选择现有表格");
    return;
  }

  let urlList = [];
  if (mode === 'manual') {
    if (!manualUrls || !manualUrls.trim()) {
      showErrorMsg("请输入帖子链接");
      return;
    }
    urlList = parseManualUrls(manualUrls);
  } else {
    if (!noteLinkFieldId) {
      showErrorMsg("请选择帖子链接字段");
      return;
    }
    if (noteLinkFieldId === 'nodata') {
      showErrorMsg("未在数据表页面，无法读取字段信息。请先打开目标数据表，再重试操作。");
      return;
    }
    const recordIdList = await getRecordIdListByScope(scope, rowCount);
    if (!recordIdList) {
      return;
    }
    urlList = await getNoteUrlsByFieldId(recordIdList, noteLinkFieldId);
  }

  if (radio === 2) {
    validateTableFields(table_id).then(async isValid => {
      if (isValid) {
        await getNoteData(table_id, urlList);
      }
    }).catch(error => {
      console.error("验证表格字段时出错:", error);
      showErrorMsg("验证表格字段失败，请稍后重试");
    });
    return;
  }
  await getNoteData("", urlList);
};

watch(selectedFieldKeys, (keys) => {
  if (!fieldSelectionReady.value) {
    return;
  }

  const requiredKeys = FIELD_CONFIG.filter(field => field.required).map(field => field.key);
  const mergedKeys = Array.from(new Set([...keys, ...requiredKeys]));

  if (mergedKeys.length !== keys.length) {
    selectedFieldKeys.value = mergedKeys;
    return;
  }

  saveSelectedFieldKeys(mergedKeys);
}, { deep: true });
</script>

<template>
  <div class="sub-page">
    <div class="sub-page-header">
      <span class="sub-page-back" @click="$emit('back')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16">
          <polyline points="15 18 9 12 15 6"></polyline>
        </svg>
      </span>
      <span class="sub-page-title">评论列表获取</span>
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
        <el-form-item label="" style="margin-top: 12px">
          <div class="field-stack">
            <div class="c-label">目标表格</div>
            <el-radio-group v-model="formData.radio" class="radio-block">
              <el-radio :value="1">新建表格</el-radio>
              <el-radio :value="2">使用现有表格</el-radio>
            </el-radio-group>
          </div>
        </el-form-item>
        <el-form-item v-if="formData.radio === 2" label="">
          <div slot="label" class="c-label">选择现有表格</div>
          <el-select v-model="formData.table_id" placeholder="请选择" style="width: 100%">
            <el-option v-for="tl in table_options" :key="tl.id" :label="tl.name" :value="tl.id" />
          </el-select>
        </el-form-item>

        <template v-if="formData.mode === 'table'">
          <el-form-item>
            <div slot="label" class="c-label">
              帖子链接
              <el-tooltip effect="dark" placement="top">
                <template #content>支持多条帖子链接，<br />可换行或逗号分隔</template>
                <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png"
                  class="help-icon" />
              </el-tooltip>
            </div>
            <el-select
              v-model="formData.noteLinkFieldId"
              placeholder="选择包含帖子链接的字段"
              style="width: 100%"
            >
              <el-option v-for="field in fieldOptions" :key="field.id" :label="field.name" :value="field.id" />
            </el-select>
          </el-form-item>

          <el-form-item>
            <div slot="label" class="c-label">
              数据范围
              <el-tooltip effect="dark" placement="top">
                <template #content>选择要执行的数据范围</template>
                <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png"
                  class="help-icon" />
              </el-tooltip>
            </div>
            <el-radio-group v-model="formData.scope" class="custom-radio-group">
              <el-radio v-for="option in scopeOptions" :key="option.value" :value="option.value" class="custom-radio-item">
                <span class="radio-label-text">{{ option.label }}</span>
                <div v-if="option.value === 'n'" class="custom-stepper-input">
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
                      @click.stop="formData.rowCount = Math.min(100, (formData.rowCount || 5) + 1)"
                      :disabled="formData.rowCount >= 100"
                      class="stepper-btn stepper-btn-up"
                    ></button>
                    <button
                      type="button"
                      @click.stop="formData.rowCount = Math.max(1, (formData.rowCount || 5) - 1)"
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
              帖子链接
              <el-tooltip effect="dark" placement="top">
                <template #content>支持多条帖子链接，<br />可换行或逗号分隔</template>
                <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png"
                  class="help-icon" />
              </el-tooltip>
            </div>
            <el-input
              v-model="formData.manualUrls"
              type="textarea"
              :rows="4"
              class="c-input"
              placeholder="请输入正确的帖子链接，支持批量添加，多个链接可换行或用逗号分隔"
            />
          </el-form-item>
        </template>

        <el-form-item label="">
          <div slot="label" class="c-label">
            主评论数据提取范围
            <el-tooltip effect="dark" placement="top">
              <template #content>每页 10 积分，实际扣费会按照<br />提取的页数进行计算</template>
              <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png"
                class="help-icon" />
            </el-tooltip>
          </div>
          <el-select v-model="formData.pages" placeholder="请选择" style="width: 100%">
            <el-option v-for="tl in pages_options" :key="tl.value" :label="tl.label" :value="tl.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="">
          <div slot="label" class="c-label">子评论提取范围</div>
          <el-select v-model="formData.reply_pages" placeholder="请选择" style="width: 100%">
            <el-option v-for="tl in reply_pages_options" :key="tl.value" :label="tl.label" :value="tl.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="">
          <div slot="label" class="c-label">评论排序（仅小红书）</div>
          <el-select v-model="formData.sortType" placeholder="请选择" style="width: 100%">
            <el-option v-for="option in xhsCommentSortOptions" :key="option.value" :label="option.label" :value="option.value" />
          </el-select>
        </el-form-item>

        <el-form-item label="" style="margin-top: 12px">
          <div slot="label" class="c-label">选择需要的字段</div>
          <el-checkbox-group v-model="selectedFieldKeys" class="field-checkbox-group">
            <el-checkbox
              v-for="field in FIELD_CONFIG"
              :key="field.key"
              :label="field.key"
              :disabled="field.required"
              class="field-checkbox-item"
            >
              {{ field.name }}
            </el-checkbox>
          </el-checkbox-group>
        </el-form-item>
      </el-form>

      <el-button color="#a8071a" class="commit-btn" :loading="loading" @click="commit">提交</el-button>
    </div>

    <div class="toast-wrap" :class="{ show: toastVisible }">
      <div class="toast" :class="{ 'toast-loading': toastLoading }">
        <div class="toast-icon" v-if="toastLoading"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 2a10 10 0 0 1 10 10" /></svg></div>
        <div class="toast-icon" v-else><svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="#00B42A" /><path d="M8 12l2.5 2.5L16 9" stroke="#FFFFFF" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" /></svg></div>
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
.toast-wrap { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) scale(0.95); z-index: 9999; pointer-events: none; opacity: 0; transition: opacity 0.3s ease, transform 0.3s ease; }
.toast-wrap.show { opacity: 1; transform: translate(-50%, -50%) scale(1); }
.toast { display: inline-flex; align-items: center; gap: 8px; padding: 10px 18px; background: #FFFFFF; border: 1px solid #E5E6EB; border-radius: 8px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12); font-size: 14px; font-weight: 500; color: #1D2129; white-space: nowrap; }
.toast-icon { width: 18px; height: 18px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
.toast-icon svg { width: 100%; height: 100%; }
.toast-loading .toast-icon { animation: spin 0.8s linear infinite; color: #A8071A; }
@keyframes spin { to { transform: rotate(360deg); } }
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

.field-checkbox-group :deep(.el-checkbox__input.is-disabled.is-checked .el-checkbox__inner) {
  background: #F7F8FA;
  border-color: #E5E6EB;
}

.field-checkbox-group :deep(.el-checkbox__input.is-disabled.is-checked .el-checkbox__inner::after) {
  border-color: #C9CDD4;
}

.field-checkbox-group :deep(.el-checkbox__input.is-disabled + .el-checkbox__label) {
  color: #C9CDD4;
}

.field-checkbox-group :deep(.el-checkbox__input.is-checked + .el-checkbox__label) {
  color: #1D2129;
}
</style>
