<script setup>
import { bitable, FieldType } from "@lark-base-open/js-sdk";
import { ElNotification } from "element-plus";
import { ref, onMounted, onUnmounted, watch } from "vue";
import request from '@/utils/request'
import { useSocialData, showErrorMsg, PROFILE_FIELD_MAPPING, getDefaultSelectedFieldKeys } from '@/composables/useSocialData'

const props = defineProps({
  api_key: String,
})

const TASK_PLUGIN_TYPE = 'profile_fetch';
const TASK_API_PATH = '/social/api/v1/feishu/schedule/tasks';
const MANUAL_TABLE_BASE_NAME = '社媒数据助手';
const STREAM_TASK_STORAGE_KEY = 'profile_fetch_stream_task_v1';
const STREAM_RESULT_LIMIT = 20;
const STREAM_ACTIVE_INTERVAL = 2000;
const STREAM_MAX_INTERVAL = 30000;
const STREAM_STALL_TIMEOUT = 10 * 60 * 1000;

const formData = ref({
  mode: 'table',
  targetType: 'new',
  manualUrls: "",
  pages: 1,
  profileLinkFieldId: '',
  scope: 'n',
  rowCount: 5,
  targetTableId: '',
  executionMode: 'immediate',
});
const table_options = ref([]);
const fieldOptions = ref([]);
const FIELD_SELECTION_STORAGE_KEY = 'profile_batch_selected_fields_v1';
const selectedFieldKeys = ref([]);
const fieldSelectionReady = ref(false);
const toastVisible = ref(false);
const toastText = ref('');
const toastLoading = ref(false);
let toastTimer = null;

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
  return { value, label: `每 ${value}` };
});

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
  targetType: 'new',
  profileLinkFieldId: '',
  scope: 'n',
  rowCount: 5,
  manualUrls: '',
  pages: 1,
  targetTableId: '',
  selectedFieldKeys: getDefaultSelectedFieldKeys(PROFILE_FIELD_MAPPING),
  sourceTableId: '',
  sourceTableName: '',
  sourceViewId: '',
  sourceViewName: '',
  resolvedTargetTableId: '',
  resolvedTargetTableName: '',
  profileLinkFieldName: '',
  baseId: '',
});

const taskDialogVisible = ref(false);
const taskDialogMode = ref('create');
const taskDialogLoading = ref(false);
const editingTaskId = ref(null);
const taskDialogForm = ref(getDefaultTaskDialogForm());
const taskList = ref([]);
const taskListLoading = ref(false);
const taskManagerExpanded = ref(false);

const pages_options = [
  { value: 0, label: "全量获取" },
  { value: 1, label: "仅获取首页" },
  { value: 5, label: "获取前5页" },
  { value: 10, label: "获取前10页" },
  { value: 20, label: "获取前20页" },
  { value: 30, label: "获取前30页" },
  { value: 50, label: "获取前50页" },
];

const scopeOptions = [
  { value: 'all', label: '执行所有行' },
  { value: 'selected', label: '执行选中行' },
  { value: 'n', label: '执行前N行' },
];

const getTableName = (list) => {
  const firstItem = list[0];
  return firstItem?.nickname || '社媒数据助手';
};

const normalizeTargetType = (value) => (value === 'existing' ? 'existing' : 'new');

const getRepeatTypeLabel = (value) => {
  const normalizedValue = value === 'once' ? 'none' : value;
  return REPEAT_TYPE_OPTIONS.find(item => item.value === normalizedValue)?.label || value || '-';
};

const normalizeRepeatType = (value) => (value === 'once' ? 'none' : (value || 'none'));

const getFreqUnitLabel = (value) => FREQ_UNIT_OPTIONS.find(item => item.value === value)?.label || value || '';

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

const {
  loading,
  createAndWriteData,
  validateTableFields,
} = useSocialData(getTableName, props.api_key, PROFILE_FIELD_MAPPING);

const streamTimer = ref(null);
let activeStreamTask = null;
let streamRequestInFlight = false;

const ensureOption = (optionsRef, option) => {
  if (!option?.id) {
    return;
  }

  if (!optionsRef.value.some(item => item.id === option.id)) {
    optionsRef.value = [...optionsRef.value, option];
  }
};

const syncMainFormToTaskForm = () => {
  taskDialogForm.value = {
    ...taskDialogForm.value,
    mode: formData.value.mode,
    targetType: formData.value.targetType,
    profileLinkFieldId: formData.value.profileLinkFieldId,
    scope: formData.value.scope,
    rowCount: formData.value.rowCount,
    manualUrls: formData.value.manualUrls,
    pages: formData.value.pages,
    targetTableId: formData.value.targetTableId,
    selectedFieldKeys: [...selectedFieldKeys.value],
  };
};

const getActiveFieldConfigs = (keys = selectedFieldKeys.value) => PROFILE_FIELD_MAPPING.filter(field =>
  keys.includes(field.key)
);

const loadSelectedFieldKeys = async () => {
  const defaultKeys = getDefaultSelectedFieldKeys(PROFILE_FIELD_MAPPING);

  try {
    const savedValue = await bitable.bridge.getData(FIELD_SELECTION_STORAGE_KEY);

    if (!Array.isArray(savedValue)) {
      selectedFieldKeys.value = defaultKeys;
      return;
    }

    const validKeys = savedValue.filter(key => PROFILE_FIELD_MAPPING.some(field => field.key === key));
    const requiredKeys = PROFILE_FIELD_MAPPING.filter(field => field.required).map(field => field.key);
    const mergedKeys = Array.from(new Set([...validKeys, ...requiredKeys]));
    selectedFieldKeys.value = mergedKeys.length > 0 ? mergedKeys : defaultKeys;
  } catch (error) {
    console.error('读取字段勾选状态失败:', error);
    selectedFieldKeys.value = defaultKeys;
  }
};

const saveSelectedFieldKeys = async (keys) => {
  try {
    const requiredKeys = PROFILE_FIELD_MAPPING.filter(field => field.required).map(field => field.key);
    const nextKeys = Array.from(new Set([...keys, ...requiredKeys]));
    await bitable.bridge.setData(FIELD_SELECTION_STORAGE_KEY, [...nextKeys]);
  } catch (error) {
    console.error('保存字段勾选状态失败:', error);
  }
};

const unwrapApiData = (responseData) => {
  if (responseData?.sta !== undefined) {
    if (responseData.sta !== 0) {
      throw new Error(responseData.msg || '请求失败');
    }
    return responseData.data || {};
  }
  return responseData || {};
};

const clearStreamTimer = () => {
  if (streamTimer.value) {
    clearTimeout(streamTimer.value);
    streamTimer.value = null;
  }
};

const showToast = (text, isLoading = true) => {
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
  toastText.value = text;
  toastLoading.value = isLoading;
  toastVisible.value = true;
};

const hideToast = () => {
  toastVisible.value = false;
};

const showCompletionToast = (text) => {
  showToast(text, false);
  toastTimer = setTimeout(hideToast, 3000);
};

const saveStreamTask = async (task) => {
  await bitable.bridge.setData(STREAM_TASK_STORAGE_KEY, task);
};

const clearSavedStreamTask = async () => {
  try {
    await bitable.bridge.setData(STREAM_TASK_STORAGE_KEY, {});
  } catch (error) {
    console.error('清除博主作品采集恢复状态失败:', error);
  }
};

const stopStreamTask = () => {
  clearStreamTimer();
  activeStreamTask = null;
};

const getStreamProgressText = (taskStatus, streamTask) => {
  const processed = Number(taskStatus.processed) || 0;
  const total = Number(taskStatus.total) || 0;
  const progress = total > 0 ? `${processed}/${total}` : `${processed}`;
  return `已处理 ${progress} 个主页，已写入 ${streamTask.writtenCount || 0} 条作品`;
};

const getProfileTaskStatus = async (taskId) => {
  const response = await request({
    url: `/social/api/v1/feishu/social/task?task_id=${encodeURIComponent(taskId)}`,
    method: 'get',
    headers: { authorization: `Bearer ${props.api_key}` },
  });
  return unwrapApiData(response.data);
};

const readAvailablePosts = async (streamTask) => {
  const response = await request({
    url: '/social/api/v1/feishu/post/list',
    method: 'post',
    headers: { authorization: `Bearer ${props.api_key}` },
    data: {
      task_id: streamTask.taskId,
      after_id: streamTask.cursor || '',
      limit: STREAM_RESULT_LIMIT,
    },
  });
  const data = unwrapApiData(response.data);
  return {
    items: Array.isArray(data.data) ? data.data : (Array.isArray(data.items) ? data.items : []),
    nextCursor: data.next_cursor || streamTask.cursor || '',
    hasMore: !!data.has_more,
  };
};

const drainAvailablePosts = async (streamTask) => {
  let wroteData = false;

  while (activeStreamTask === streamTask) {
    const { items, nextCursor, hasMore } = await readAvailablePosts(streamTask);
    if (items.length === 0) {
      return wroteData;
    }

    if (!nextCursor || nextCursor === streamTask.cursor) {
      throw new Error('结果接口未返回有效的 next_cursor');
    }

    showToast(`正在写入 ${items.length} 条作品...`, true);
    const result = await createAndWriteData(
      items,
      streamTask.targetTableId ? 'stream' : '',
      streamTask.taskId,
      streamTask.targetTableId || '',
      streamTask.selectedFieldKeys,
      {
        stopAfterCurrentBatch: true,
        onTargetTableReady: async (tableId) => {
          streamTask.targetTableId = tableId;
          await saveStreamTask(streamTask);
        },
      }
    );

    streamTask.targetTableId = result?.tableId || streamTask.targetTableId;
    streamTask.cursor = nextCursor;
    streamTask.writtenCount = (streamTask.writtenCount || 0) + items.length;
    streamTask.lastActivityAt = Date.now();
    await saveStreamTask(streamTask);
    wroteData = true;

    if (!hasMore) {
      return wroteData;
    }
  }

  return wroteData;
};

const finishStreamTask = async (streamTask, taskStatus) => {
  stopStreamTask();
  loading.value = false;
  await clearSavedStreamTask();

  if (Number(taskStatus.status) === 2) {
    showCompletionToast(taskStatus.reason || '任务失败，已写入任务完成前获取的数据');
    showErrorMsg(taskStatus.reason || '获取数据失败，请稍后重试');
    return;
  }

  showCompletionToast(`处理完成，已写入 ${streamTask.writtenCount || 0} 条作品`);
};

const scheduleStreamPoll = (streamTask, delay) => {
  clearStreamTimer();
  streamTimer.value = setTimeout(() => {
    pollStreamTask(streamTask);
  }, delay);
};

const pollStreamTask = async (streamTask) => {
  if (activeStreamTask !== streamTask || streamRequestInFlight) {
    return;
  }

  streamRequestInFlight = true;
  try {
    const taskStatus = await getProfileTaskStatus(streamTask.taskId);
    const processed = Number(taskStatus.processed) || 0;
    const heartbeatAt = Number(taskStatus.heartbeat_at) || 0;
    const progressed = processed !== streamTask.lastProcessed || heartbeatAt !== streamTask.lastHeartbeatAt;

    if (progressed) {
      streamTask.lastProcessed = processed;
      streamTask.lastHeartbeatAt = heartbeatAt;
      streamTask.lastActivityAt = Date.now();
      streamTask.pollInterval = STREAM_ACTIVE_INTERVAL;
    } else {
      streamTask.pollInterval = Math.min(
        Math.max(streamTask.pollInterval || STREAM_ACTIVE_INTERVAL, STREAM_ACTIVE_INTERVAL) * 2,
        STREAM_MAX_INTERVAL
      );
    }

    showToast(getStreamProgressText(taskStatus, streamTask), true);
    const wroteData = await drainAvailablePosts(streamTask);
    if (wroteData) {
      streamTask.pollInterval = STREAM_ACTIVE_INTERVAL;
      showToast(getStreamProgressText(taskStatus, streamTask), true);
    }

    const isTerminal = Number(taskStatus.status) === 1 || Number(taskStatus.status) === 2;
    if (isTerminal && !wroteData) {
      await finishStreamTask(streamTask, taskStatus);
      return;
    }

    if (Date.now() - (streamTask.lastActivityAt || Date.now()) >= STREAM_STALL_TIMEOUT) {
      throw new Error('任务超过 10 分钟没有进度更新，请稍后重试');
    }

    await saveStreamTask(streamTask);
    scheduleStreamPoll(streamTask, streamTask.pollInterval || STREAM_ACTIVE_INTERVAL);
  } catch (error) {
    console.error('轮询博主作品采集任务失败:', error);
    streamTask.pollInterval = Math.min(
      Math.max(streamTask.pollInterval || STREAM_ACTIVE_INTERVAL, STREAM_ACTIVE_INTERVAL) * 2,
      STREAM_MAX_INTERVAL
    );

    if (Date.now() - (streamTask.lastActivityAt || Date.now()) >= STREAM_STALL_TIMEOUT) {
      loading.value = false;
      showCompletionToast(error.message || '任务长时间没有进度');
      showErrorMsg(error.message || '任务长时间没有进度');
      return;
    }

    await saveStreamTask(streamTask);
    scheduleStreamPoll(streamTask, streamTask.pollInterval);
  } finally {
    streamRequestInFlight = false;
  }
};

const startStreamTask = async (taskId, targetTableId = '', taskConfig = {}) => {
  stopStreamTask();
  const selection = await bitable.base.getSelection();
  const streamTask = {
    taskId,
    cursor: '',
    targetTableId,
    selectedFieldKeys: [...(taskConfig.selectedFieldKeys || selectedFieldKeys.value)],
    writtenCount: 0,
    lastProcessed: -1,
    lastHeartbeatAt: 0,
    lastActivityAt: Date.now(),
    pollInterval: STREAM_ACTIVE_INTERVAL,
    baseId: selection.baseId || '',
  };

  activeStreamTask = streamTask;
  loading.value = true;
  await saveStreamTask(streamTask);
  await pollStreamTask(streamTask);
};

const resumeSavedStreamTask = async () => {
  try {
    const savedTask = await bitable.bridge.getData(STREAM_TASK_STORAGE_KEY);
    if (!savedTask?.taskId || activeStreamTask) {
      return;
    }

    const selection = await bitable.base.getSelection();
    if (savedTask.baseId && selection.baseId && savedTask.baseId !== selection.baseId) {
      return;
    }

    activeStreamTask = {
      ...savedTask,
      selectedFieldKeys: Array.isArray(savedTask.selectedFieldKeys)
        ? savedTask.selectedFieldKeys
        : [...selectedFieldKeys.value],
      lastActivityAt: savedTask.lastActivityAt || Date.now(),
      pollInterval: savedTask.pollInterval || STREAM_ACTIVE_INTERVAL,
    };
    loading.value = true;
    showToast('正在恢复未完成的博主作品采集任务...', true);
    await pollStreamTask(activeStreamTask);
  } catch (error) {
    console.error('恢复博主作品采集任务失败:', error);
  }
};

const postProfileTask = async (targetTableId = "", urlText = "") => {
  try {
    const response = await request({
    url: "/social/api/v1/feishu/social/task",
    method: "post",
    headers: { 'authorization': `Bearer ${props.api_key}` },
    data: {
      url: urlText,
      pages: Number(formData.value.pages),
    },
    });
    const data = unwrapApiData(response.data);
    if (!data.task_id) {
      throw new Error('创建采集任务失败，未返回任务 ID');
    }
    await startStreamTask(data.task_id, targetTableId);
  } catch (error) {
    loading.value = false;
    console.error('创建博主作品采集任务失败:', error);
    showErrorMsg(error.message || '创建采集任务失败');
  }
};

const loadTableOptions = async () => {
  try {
    const tableList = await bitable.base.getTableList();
    table_options.value = await Promise.all(
      tableList.map(async (table) => ({
        id: table.id,
        name: await table.getName(),
      }))
    );
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

const getTableNameById = async (tableId) => {
  if (!tableId) return '';

  const matched = table_options.value.find(item => item.id === tableId);
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

const validateBaseForm = (config) => {
  if (!props.api_key) {
    showErrorMsg('请输入API key');
    return false;
  }

  if (config.mode === 'manual') {
    if (!config.manualUrls || !config.manualUrls.trim()) {
      ElNotification({ message: '请输入博主主页链接', type: 'warning', duration: 0 });
      return false;
    }

    const urlList = parseManualUrls(config.manualUrls);
    if (urlList.length === 0) {
      ElNotification({ message: '请至少输入一个有效的博主主页链接', type: 'warning', duration: 0 });
      return false;
    }
  } else {
    if (!config.profileLinkFieldId) {
      ElNotification({ message: '请选择博主主页链接字段', type: 'warning', duration: 0 });
      return false;
    }

    if (config.profileLinkFieldId === 'nodata') {
      ElNotification({ message: '未在数据表页面，无法读取字段信息。请先打开目标数据表，再重试操作。', type: 'error', duration: 0 });
      return false;
    }
  }

  if (normalizeTargetType(config.targetType) === 'existing' && !config.targetTableId) {
    ElNotification({ message: '请选择现有表格', type: 'warning', duration: 0 });
    return false;
  }

  if (getActiveFieldConfigs(config.selectedFieldKeys || selectedFieldKeys.value).length === 0) {
    ElNotification({ message: '请至少选择一个需要的字段', type: 'warning', duration: 0 });
    return false;
  }

  return true;
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

const getProfileUrlsByFieldId = async (recordIdList, fieldId) => {
  const table = await bitable.base.getActiveTable();
  const field = await table.getFieldById(fieldId);

  const rows = await Promise.all(
    recordIdList.map(async (recordId) => {
      try {
        const cell = await field.getCell(recordId);
        const value = await cell.getValue();
        return extractProfileLink(value);
      } catch (error) {
        return null;
      }
    })
  );

  return [...new Set(rows.filter(item => typeof item === 'string' && item.trim()))];
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
    if (normalizeTargetType(config.targetType) === 'existing') {
      resolvedTargetTableId = config.targetTableId;
      resolvedTargetTableName = await getTableNameById(config.targetTableId);
    } else {
      resolvedTargetTableName = getTableName([{ nickname: MANUAL_TABLE_BASE_NAME }]);
    }
  } else if (normalizeTargetType(config.targetType) === 'existing') {
    const selection = await bitable.base.getSelection();
    sourceContext.baseId = selection.baseId || '';
    resolvedTargetTableId = config.targetTableId;
    resolvedTargetTableName = await getTableNameById(config.targetTableId);
  } else {
    const selection = await bitable.base.getSelection();
    sourceContext.baseId = selection.baseId || '';
    resolvedTargetTableName = MANUAL_TABLE_BASE_NAME;
  }

  const snapshot = {
    plugin_type: TASK_PLUGIN_TYPE,
    base_id: sourceContext.baseId,
    mode: config.mode,
    target_type: normalizeTargetType(config.targetType),
    target_table_id: config.targetTableId || '',
    target_table_name: normalizeTargetType(config.targetType) === 'existing' ? resolvedTargetTableName : '',
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
    pages: Number(config.pages),
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

const submitProfileUrls = async (urlList, targetTableId = "") => {
  if (urlList.length === 0) {
    showErrorMsg("请至少输入一个有效的博主主页链接");
    return;
  }

  loading.value = true;
  const urlText = urlList.join('\n');

  try {
    await postProfileTask(targetTableId, urlText);
  } catch (error) {
    loading.value = false;
    throw error;
  }
};

const handleImmediateSubmit = async () => {
  if (!validateBaseForm({
    ...formData.value,
    selectedFieldKeys: selectedFieldKeys.value,
  })) {
    return;
  }

  let urlList = [];
  if (formData.value.mode === 'manual') {
    urlList = parseManualUrls(formData.value.manualUrls);
  } else {
    const recordIdList = await getRecordIdListByScope(formData.value.scope, formData.value.rowCount);
    if (!recordIdList) {
      return;
    }
    urlList = await getProfileUrlsByFieldId(recordIdList, formData.value.profileLinkFieldId);
  }

  if (normalizeTargetType(formData.value.targetType) === 'existing') {
    validateTableFields(formData.value.targetTableId, selectedFieldKeys.value).then(async isValid => {
      if (isValid) {
        await submitProfileUrls(urlList, formData.value.targetTableId);
      }
    }).catch(error => {
      console.error('验证表格字段时出错:', error);
      showErrorMsg('验证表格字段失败，请稍后重试');
    });
    return;
  }

  await submitProfileUrls(urlList, '');
};

const getTaskDisplayName = (task) => {
  const snapshot = task.snapshot || {};
  return task.name || snapshot.resolved_target_table_name || snapshot.target_table_name || '未命名任务';
};

const getTaskDisplayTitle = (task) => getTaskDisplayName(task);

const buildTaskSummary = (task) => {
  const snapshot = task.snapshot || {};
  const modeText = snapshot.mode === 'manual' ? '手动链接' : '表格字段';
  const targetText = snapshot.target_type === 'existing' ? '写入现有表' : '新建表格';
  const pageText = typeof snapshot.pages === 'number' ? `抓取范围 ${snapshot.pages === 0 ? '全量获取' : `前${snapshot.pages}页`}` : '';
  return [modeText, targetText, pageText].filter(Boolean).join(' · ');
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
    pages: formData.value.pages,
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

  if (normalizeTargetType(formData.value.targetType) === 'existing' && formData.value.targetTableId) {
    ensureOption(table_options, {
      id: formData.value.targetTableId,
      name: await getTableNameById(formData.value.targetTableId),
    });
  }
};

const prepareInlineScheduleForm = async () => {
  if (formData.value.mode === 'table') {
    await loadFieldOptions({ silent: true });
  }

  if (table_options.value.length === 0) {
    await loadTableOptions();
  }

  if (!taskDialogForm.value.personalBaseToken) {
    await copyCurrentFormToTaskDialog();
  } else {
    syncMainFormToTaskForm();
  }
};

const openEditTaskDialog = async (task) => {
  if (table_options.value.length === 0) {
    await loadTableOptions();
  }

  if (fieldOptions.value.length === 0 && (task.snapshot?.mode || 'table') === 'table') {
    await loadFieldOptions({ silent: true });
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
    targetType: normalizeTargetType(snapshot.target_type),
    profileLinkFieldId: snapshot.profile_link_field_id || '',
    scope: snapshot.scope || 'n',
    rowCount: snapshot.row_count || 5,
    manualUrls: snapshot.manual_urls || '',
    pages: typeof snapshot.pages === 'number' ? snapshot.pages : 1,
    targetTableId: snapshot.target_table_id || '',
    selectedFieldKeys: Array.isArray(snapshot.selected_field_keys) && snapshot.selected_field_keys.length > 0
      ? snapshot.selected_field_keys
      : getDefaultSelectedFieldKeys(PROFILE_FIELD_MAPPING),
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
  ensureOption(table_options, {
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
      data: { enabled: nextEnabled },
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
        schedule: { enabled: nextEnabled },
      });
    }

    ElNotification({ message: '任务状态已更新', type: 'success' });
  } catch (error) {
    console.error('更新任务状态失败:', error);
    ElNotification({ message: error.message || '更新任务状态失败', type: 'error', duration: 0 });
  }
};

const stepTaskNumber = (delta) => {
  let val = taskDialogForm.value.rowCount || 5;
  val = Math.max(1, Math.min(100, val + delta));
  taskDialogForm.value.rowCount = val;
};

watch(
  () => formData.value.mode,
  (mode) => {
    if (mode === 'table') {
      loadFieldOptions({ silent: false });
    }

    if (normalizeTargetType(formData.value.targetType) === 'existing' && table_options.value.length === 0) {
      loadTableOptions();
    }

    if (formData.value.executionMode === 'schedule') {
      prepareInlineScheduleForm();
    }
  }
);

onMounted(async () => {
  await loadFieldOptions({ silent: true });
  await Promise.all([
    loadSelectedFieldKeys(),
    loadTaskList(),
  ]);
  fieldSelectionReady.value = true;
  await resumeSavedStreamTask();
});

onUnmounted(() => {
  stopStreamTask();
  if (toastTimer) {
    clearTimeout(toastTimer);
  }
});

watch(selectedFieldKeys, (keys) => {
  if (!fieldSelectionReady.value) {
    return;
  }

  const requiredKeys = PROFILE_FIELD_MAPPING.filter(field => field.required).map(field => field.key);
  const mergedKeys = Array.from(new Set([...keys, ...requiredKeys]));

  if (mergedKeys.length !== keys.length) {
    selectedFieldKeys.value = mergedKeys;
    return;
  }

  saveSelectedFieldKeys(mergedKeys);
}, { deep: true });

watch(
  () => formData.value.targetType,
  (targetType) => {
    if (normalizeTargetType(targetType) === 'existing' && table_options.value.length === 0) {
      loadTableOptions();
      return;
    }

    if (normalizeTargetType(targetType) !== 'existing') {
      formData.value.targetTableId = '';
    }

    if (formData.value.executionMode === 'schedule') {
      syncMainFormToTaskForm();
    }
  }
);

watch(
  () => [
    formData.value.profileLinkFieldId,
    formData.value.scope,
    formData.value.rowCount,
    formData.value.manualUrls,
    formData.value.pages,
    formData.value.targetTableId,
    formData.value.executionMode,
  ],
  () => {
    if (formData.value.executionMode === 'schedule') {
      syncMainFormToTaskForm();
    }
  }
);

watch(
  () => formData.value.executionMode,
  async (mode) => {
    if (mode === 'schedule') {
      await prepareInlineScheduleForm();
      await loadTaskList();
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
    if (repeatType !== 'custom') {
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
      <span class="sub-page-back" @click="$emit('back')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16">
          <polyline points="15 18 9 12 15 6"></polyline>
        </svg>
      </span>
      <span class="sub-page-title">博主作品获取</span>
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
            <el-radio-group v-model="formData.targetType" class="radio-block">
              <el-radio value="new">新建表格</el-radio>
              <el-radio value="existing">使用现有表格</el-radio>
            </el-radio-group>
          </div>
        </el-form-item>
        <el-form-item v-if="formData.targetType === 'existing'" label="">
          <div slot="label" class="c-label">选择现有表格</div>
          <el-select v-model="formData.targetTableId" placeholder="请选择" style="width: 100%">
            <el-option v-for="tl in table_options" :key="tl.id" :label="tl.name" :value="tl.id" />
          </el-select>
        </el-form-item>

        <template v-if="formData.mode === 'table'">
          <el-form-item>
            <div slot="label" class="c-label">
              博主主页链接
              <el-tooltip effect="dark" placement="top">
                <template #content>仅支持博主主页链接，<br />不支持其他链接</template>
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

          <el-form-item label="">
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
              博主主页链接
              <el-tooltip effect="dark" placement="top">
                <template #content>仅支持博主主页链接，<br />不支持其他链接</template>
                <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png"
                  class="help-icon" />
              </el-tooltip>
            </div>
            <el-input v-model="formData.manualUrls" type="textarea" :rows="4" class="c-input" placeholder="请输入正确的博主主页链接，支持批量添加，多个链接可换行或用逗号分隔" />
          </el-form-item>
        </template>

        <el-form-item label="">
          <div slot="label" class="c-label">
            数据提取范围
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

        <el-form-item label="" style="margin-top: 12px">
          <div slot="label" class="c-label">选择需要的字段</div>
          <el-checkbox-group v-model="selectedFieldKeys" class="field-checkbox-group">
            <el-checkbox
              v-for="field in PROFILE_FIELD_MAPPING"
              :key="field.key"
              :label="field.key"
              :value="field.key"
              :disabled="field.required"
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
        <el-button color="#a8071a" class="commit-btn" :loading="loading" @click="handleImmediateSubmit">立即执行</el-button>
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

          <div class="schedule-field-row">
            <el-form-item>
              <div class="c-label">重复类型</div>
              <el-select v-model="taskDialogForm.repeatType" style="width: 100%">
                <el-option v-for="item in REPEAT_TYPE_OPTIONS" :key="item.value" :label="item.label" :value="item.value" />
              </el-select>
            </el-form-item>
          </div>

          <template v-if="taskDialogForm.repeatType === 'custom'">
            <div class="schedule-custom-grid">
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
                  :class="{ active: task.enabled ?? task.schedule?.enabled }"
                  @click.stop="toggleTaskStatus(task)"
                ></div>
                <span class="task-card-switch-label">{{ (task.enabled ?? task.schedule?.enabled) ? '开启' : '关闭' }}</span>
              </div>
            </div>
          </div>
        </div>
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
              @click="taskDialogForm.mode = 'table'"
            >
              从表格选取
            </button>
            <button
              type="button"
              class="mode-tab"
              :class="{ active: taskDialogForm.mode === 'manual' }"
              @click="taskDialogForm.mode = 'manual'"
            >
              手动输入
            </button>
          </div>

          <el-form label-position="top">
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
                <el-option v-for="table in table_options" :key="table.id" :label="table.name" :value="table.id" />
              </el-select>
            </el-form-item>

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
              <div class="c-label">数据提取范围</div>
              <el-select v-model="taskDialogForm.pages" placeholder="请选择" style="width: 100%">
                <el-option v-for="tl in pages_options" :key="tl.value" :label="tl.label" :value="tl.value" />
              </el-select>
            </el-form-item>

            <el-form-item>
              <div class="c-label">选择需要的字段</div>
              <el-checkbox-group v-model="taskDialogForm.selectedFieldKeys" class="field-checkbox-group">
                <el-checkbox
                  v-for="field in PROFILE_FIELD_MAPPING"
                  :key="field.key"
                  :label="field.key"
                  :value="field.key"
                  :disabled="field.required"
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

            <div class="schedule-field-row">
              <el-form-item>
                <div class="c-label">重复类型</div>
                <el-select v-model="taskDialogForm.repeatType" style="width: 100%">
                  <el-option v-for="item in REPEAT_TYPE_OPTIONS" :key="item.value" :label="item.label" :value="item.value" />
                </el-select>
              </el-form-item>
            </div>

            <template v-if="taskDialogForm.repeatType === 'custom'">
              <div class="schedule-custom-grid">
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
          <el-button @click="taskDialogVisible = false">取消</el-button>
          <el-button color="#a8071a" :loading="taskDialogLoading" @click="saveTask">
            {{ taskDialogMode === 'edit' ? '保存修改' : '创建任务' }}
          </el-button>
        </div>
      </template>
    </el-dialog>

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
.action-group {
  margin-top: 8px;
}
.profile-progress {
  text-align: center;
  font-size: 14px;
  color: #1D2129;
  margin-top: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}
.profile-progress-check {
  color: #67c23a;
  font-weight: bold;
  font-size: 16px;
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

.schedule-inline-panel {
  margin-top: 12px;
  padding-top: 16px;
  border-top: 1px solid #E5E6EB;
}

.task-dialog-title {
  font-size: 15px;
  font-weight: 600;
  color: #1D2129;
  margin-bottom: 12px;
}

.label-help-link {
  margin-left: auto;
  font-size: 12px;
  color: #A8071A;
  text-decoration: none;
}

.time-setting-block {
  width: 100%;
}

.time-setting-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  width: 100%;
}

.deadline-setting-grid {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: nowrap;
  width: 100%;
}

.schedule-field-row,
.schedule-custom-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 12px;
}

.schedule-field-row :deep(.el-form-item),
.schedule-custom-grid :deep(.el-form-item) {
  margin-bottom: 18px;
}

.schedule-custom-grid .time-setting-grid,
.schedule-custom-grid .deadline-setting-grid {
  margin-top: 0;
}

.deadline-radio-option {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  width: auto;
  flex: 0 0 auto;
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
  flex: 1 1 auto;
}

.deadline-radio-option--date :deep(.el-date-editor) {
  width: 100%;
}

.status-switch-item :deep(.el-form-item__content) {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.task-manager {
  margin: 0 16px 16px;
  border: 1px solid #E5E6EB;
  border-radius: 8px;
  background: #FFFFFF;
  overflow: hidden;
}

.task-manager-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  cursor: pointer;
}

.task-manager-header-left {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #1D2129;
  font-size: 14px;
  font-weight: 500;
}

.task-manager-header-left svg,
.expand-arrow svg {
  width: 16px;
  height: 16px;
}

.task-count {
  font-size: 12px;
  color: #86909C;
  font-weight: 400;
}

.expand-arrow {
  color: #86909C;
  transition: transform 0.2s ease;
}

.task-manager-header.expanded .expand-arrow {
  transform: rotate(180deg);
}

.task-list {
  max-height: 0;
  overflow: hidden;
  transition: max-height 0.25s ease;
  border-top: 1px solid transparent;
}

.task-list.active {
  max-height: 1200px;
  border-top-color: #E5E6EB;
}

.task-list > div {
  padding: 16px;
}

.empty-state {
  color: #86909C;
  font-size: 13px;
  text-align: center;
}

.task-card {
  padding: 14px;
  border: 1px solid #E5E6EB;
  border-radius: 8px;
}

.task-card + .task-card {
  margin-top: 12px;
}

.task-card-title {
  font-size: 14px;
  font-weight: 600;
  color: #1D2129;
}

.task-card-desc,
.task-card-meta {
  margin-top: 6px;
  font-size: 12px;
  color: #86909C;
  line-height: 1.5;
}

.task-card-actions {
  margin-top: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.task-card-switch-wrap {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}

.task-card-switch {
  width: 36px;
  height: 20px;
  border-radius: 999px;
  background: #C9CDD4;
  position: relative;
  cursor: pointer;
  transition: background 0.2s ease;
}

.task-card-switch::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #FFFFFF;
  transition: transform 0.2s ease;
}

.task-card-switch.active {
  background: #A8071A;
}

.task-card-switch.active::after {
  transform: translateX(16px);
}

.task-card-switch-label {
  font-size: 12px;
  color: #4E5969;
}

.task-dialog-scroll {
  max-height: 70vh;
  overflow-y: auto;
}

.task-dialog-section + .task-dialog-section {
  margin-top: 12px;
}

.task-dialog-card {
  padding: 2px;
}

.dialog-mode-switch {
  margin-bottom: 16px;
}

.sub-hint {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.5;
  color: #86909C;
}

.warning-text {
  color: #A8071A;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
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

.toast-icon svg {
  width: 100%;
  height: 100%;
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

@media (max-width: 640px) {
  .deadline-setting-grid {
    flex-wrap: wrap;
  }

  .task-card-switch-wrap {
    margin-left: 0;
  }
}
</style>
