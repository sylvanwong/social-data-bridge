<script setup>
import { createTableConfigSaver, parseTableConfigList } from '@/utils/tableOutputConfig.mjs';
import { getTaskStoppingText } from '@/utils/taskStopText';
import TaskFeedback from './TaskFeedback.vue';
import { useTaskFeedback } from '@/composables/useTaskFeedback.mjs';
import { bitable } from "@lark-base-open/js-sdk";
import { ref, onMounted, onUnmounted, computed, watch, nextTick } from "vue";
import request, { API_BASE_URL, FEISHU_API_BASE_URL, FEISHU_API_PATH_PREFIX, LEGACY_FEISHU_API_PATH_PREFIX, buildFeishuApiPath, feishuRequest } from '@/utils/request'
import { useSocialData, showErrorMsg, KEYWORD_SEARCH_FIELD_MAPPING, getDefaultSelectedFieldKeys } from '@/composables/useSocialData'
import { useIncrementalTask } from '@/composables/useIncrementalTask'

const TASK_TOAST_SUFFIX = '请勿关闭插件，关闭将中断任务';

const props = defineProps({
  api_key: String,
  social_type_options: Array,
})

const formData1 = ref({
  radio: 1,
  writeMode: 'upsert',
  table_id: "",
  social_type: "",
  keyword: "",
  sort_type: 0,
  filter_note_type: 'all',
  filter_note_time: 'all',
  publish_time: 0,
  douyin_content_type: 0,
  content_type: 'all',
  video_type: 'all',
  publish_time_range: 'all',
  publish_time_start_date: '',
  publish_time_end_date: '',
  filter_duration: '0',
  duration_range: 'all',
  pages: 1,
  workFetchRange: { type: 'pages', pages: 1, days: 30, timezone: 'Asia/Shanghai' },
});

const TASK_PLUGIN_TYPE = 'keyword_search';
const TABLE_CONFIG_API_PATH = buildFeishuApiPath('/v1/feishu/profile-fetch/table-output-config');
const TABLE_CONFIGS_API_PATH = buildFeishuApiPath('/v1/feishu/profile-fetch/table-output-configs');
const table_options = ref([]);
const tableFieldOptions = ref([]);
const mappingDraft = ref([]);
const mappingExpanded = ref(false);
const tableOutputConfigs = ref({});
const tableConfigsLoaded = ref(false);
let tableConfigsError = null;
let tableConfigsLoadToken = 0;
const tableConfigSaving = ref(false);
const tableConfigApplying = ref(false);
const outputConfigReady = computed(() => tableConfigsLoaded.value && !!formData1.value.table_id && !tableConfigApplying.value && !tableConfigLoadError.value);
const tableConfigLoadError = ref('');
const tableConfigSaveStatus = ref('');
const tableConfigSaves = new Map();
let tableConfigReadId = 0;
const FIELD_SELECTION_STORAGE_KEY = 'keyword_search_selected_fields_v1';
const STREAM_TASK_STORAGE_KEY = 'keyword_search_stream_task_v1';
const selectedFieldKeys = ref([]);
const fieldSelectionReady = ref(false);
const feedback = useTaskFeedback();
const { toastVisible, toastText, toastLoading, toastType, taskNotice } = feedback;
const currentTableName = ref('');
const isSubmitting = ref(false);
const isCancelling = ref(false);
const activeKeywordTaskId = ref('');

const pages_options = [
  { value: 0, label: "全量获取" },
  { value: 1, label: "仅获取首页" },
  { value: 5, label: "获取前5页" },
  { value: 10, label: "获取前10页" },
  { value: 20, label: "获取前20页" },
  { value: 30, label: "获取前30页" },
  { value: 50, label: "获取前50页" },
];
const xhs_pages_options = pages_options.filter(item => item.value !== 0);
const workRangeTypes = [
  { value: 'all', label: '全部作品' },
  { value: 'pages', label: '前' },
  { value: 'days', label: '最近' },
];
const writeModeOptions = [
  { value: 'upsert', label: '更新或新增' },
  { value: 'append', label: '始终新增' },
];
const allFieldKeys = KEYWORD_SEARCH_FIELD_MAPPING.map(field => field.key);
const isAllFieldsSelected = computed(() => allFieldKeys.every(key => selectedFieldKeys.value.includes(key)));
const isFieldsPartiallySelected = computed(() =>
  !isAllFieldsSelected.value && selectedFieldKeys.value.some(key => allFieldKeys.includes(key))
);
const toggleAllFields = (checked) => {
  selectedFieldKeys.value = checked
    ? [...allFieldKeys]
    : KEYWORD_SEARCH_FIELD_MAPPING.filter(field => field.required).map(field => field.key);
};
const getMappingSourceFields = (index) => {
  const usedSourceKeys = new Set(
    mappingDraft.value
      .filter((item, itemIndex) => itemIndex !== index && item?.source_key)
      .map(item => item.source_key)
  );

  return KEYWORD_SEARCH_FIELD_MAPPING
    .filter(field => selectedFieldKeys.value.includes(field.key))
    .map(field => ({ ...field, disabled: usedSourceKeys.has(field.key) }));
};

const getMappingTargetFields = (index) => {
  const usedTargetFieldIds = new Set(
    mappingDraft.value
      .filter((item, itemIndex) => itemIndex !== index && item?.target_field_id)
      .map(item => item.target_field_id)
  );

  return tableFieldOptions.value.map(field => ({
    ...field,
    disabled: usedTargetFieldIds.has(field.id),
  }));
};
const mappingStatus = computed(() => mappingDraft.value.filter(item => item.source_key && item.target_field_id).length
  ? `已设置 ${mappingDraft.value.filter(item => item.source_key && item.target_field_id).length} 项映射` : '尚未设置自定义映射');

const normalizeWorkFetchRange = (range = formData1.value.workFetchRange) => {
  const type = range?.type === 'all' || range?.type === 'days' ? range.type : 'pages';
  const pages = Math.max(1, Math.min(50, Number(range?.pages) || 1));
  const days = Math.max(1, Math.min(365, Number(range?.days) || 30));
  return {
    type,
    value: type === 'all' ? null : type === 'days' ? days : pages,
    timezone: 'Asia/Shanghai',
  };
};

const douyin_sort_type_options = [
  { value: 0, label: "综合" },
  { value: 1, label: "最多点赞" },
  { value: 2, label: "最新发布" },
];
const xhs_sort_type_options = [
  { value: 'general', label: "综合" },
  { value: 'time_descending', label: "最新" },
  { value: 'like_count_descending', label: "最多点赞" },
  { value: 'comment_count_descending', label: "最多评论" },
  { value: 'collect_count_descending', label: "最多收藏" },
];
const bilibili_sort_type_options = [
  { value: 'general', label: '综合排序' },
  { value: 'view_count_descending', label: '最多播放' },
  { value: 'time_descending', label: '最新发布' },
  { value: 'danmaku_count_descending', label: '最多弹幕' },
  { value: 'collect_count_descending', label: '最多收藏' },
];
const filter_note_type_options = [
  { value: 'all', label: "不限" },
  { value: 'image', label: "图文笔记" },
  { value: 'video', label: "视频笔记" },
];
const xhs_time_options = [
  { value: 'all', label: "不限" },
  { value: 'day', label: "一天之内" },
  { value: 'week', label: "一周之内" },
  { value: 'half_year', label: "半年之内" },
];
const douyin_publish_time_options = [
  { value: 0, label: "不限" },
  { value: 1, label: "一天之内" },
  { value: 7, label: "一周之内" },
  { value: 180, label: "半年之内" },
];
const douyin_duration_options = [
  { value: '0', label: "不限" },
  { value: '0-1', label: "1分钟以下" },
  { value: '1-5', label: "1-5分钟" },
  { value: '5-10000', label: "5分钟以上" },
];
const bilibili_publish_time_range_options = [
  { value: 'all', label: '全部日期' },
  { value: 'day', label: '最近一天' },
  { value: 'week', label: '最近一周' },
  { value: 'half_year', label: '最近半年' },
  { value: 'custom', label: '自定义日期范围' },
];
const bilibili_duration_range_options = [
  { value: 'all', label: '全部时长' },
  { value: 'under_10_minutes', label: '10 分钟以下' },
  { value: 'between_10_and_30_minutes', label: '10-30 分钟' },
  { value: 'between_30_and_60_minutes', label: '30-60 分钟' },
  { value: 'over_60_minutes', label: '60 分钟以上' },
];
const wechat_sort_type_options = [
  { value: 'all', label: '默认排序' },
  { value: 'time_descending', label: '最新发布' },
  { value: 'collect_count_descending', label: '最多收藏' },
];
const wechat_duration_options = [
  { value: 'all', label: '不限' },
  { value: 'under_5_min', label: '5分钟以下' },
  { value: 'between_5_and_20_min', label: '5-20分钟' },
  { value: 'over_20_min', label: '20分钟以上' },
];
const zhihu_content_type_options = [
  { value: 'all', label: '全部' },
  { value: 'answer', label: '回答' },
  { value: 'article', label: '文章' },
  { value: 'video', label: '视频' },
];
const zhihu_sort_type_options = [
  { value: 'general', label: '综合' },
  { value: 'time_descending', label: '最新发布' },
  { value: 'upvote_count_descending', label: '最多赞同' },
];
const zhihu_time_options = [
  { value: 'all', label: '不限' },
  { value: 'day', label: '一天内' },
  { value: 'week', label: '一周内' },
  { value: 'month', label: '一个月内' },
  { value: 'three_months', label: '三个月内' },
  { value: 'half_year', label: '半年内' },
  { value: 'year', label: '一年内' },
];
const youtube_sort_type_options = [
  { value: 'general', label: '综合' },
  { value: 'time_descending', label: '最新发布' },
  { value: 'view_count_descending', label: '最多观看' },
  { value: 'rating', label: '评分最高' },
];
const youtube_video_type_options = [
  { value: 'all', label: '全部' },
  { value: 'video', label: '视频' },
  { value: 'movie', label: '电影' },
];
const youtube_time_options = [
  { value: 'all', label: '不限' },
  { value: 'last_hour', label: '最近一小时' },
  { value: 'today', label: '今天' },
  { value: 'this_week', label: '本周' },
  { value: 'this_month', label: '本月' },
  { value: 'this_year', label: '今年' },
];
const youtube_duration_options = [
  { value: 'all', label: '不限' },
  { value: 'under_4_min', label: '4分钟以下' },
  { value: 'between_4_and_20_min', label: '4-20分钟' },
  { value: 'over_20_min', label: '20分钟以上' },
];
const x_sort_type_options = [
  { value: 'hot', label: '默认排序' },
  { value: 'time_descending', label: '最新' },
];
const tiktok_content_type_options = [
  { value: 'all', label: '全部' },
  { value: 'video', label: '视频' },
  { value: 'image', label: '图片' },
];

const isXhs = computed(() => formData1.value.social_type === 'xhs');
const isDouyin = computed(() => formData1.value.social_type === 'douyin');
const isKuaishou = computed(() => formData1.value.social_type === 'kuaishou');
const isBilibili = computed(() => formData1.value.social_type === 'bilibili');
const isWechat = computed(() => formData1.value.social_type === 'wechat');
const isZhihu = computed(() => formData1.value.social_type === 'zhihu');
const isYoutube = computed(() => formData1.value.social_type === 'youtube');
const supportsDayRange = computed(() => !['haokan', 'youtube'].includes(formData1.value.social_type));
const isX = computed(() => formData1.value.social_type === 'x');
const isTiktok = computed(() => formData1.value.social_type === 'tiktok');
const showSortType = computed(() => isDouyin.value || isXhs.value || isBilibili.value || isWechat.value || isZhihu.value || isYoutube.value || isX.value);
const isBilibiliCustomDate = computed(() => isBilibili.value && formData1.value.publish_time_range === 'custom');
const getDefaultSortType = (socialType) => {
  if (socialType === 'douyin') return 0;
  if (socialType === 'wechat') return 'all';
  if (socialType === 'x') return 'hot';
  return 'general';
};

const getFirstKeyword = (text) => parseKeywords(text)[0] || '';

const parseKeywords = (text) => {
  if (!text || typeof text !== 'string') return [];

  return Array.from(
    new Set(
      text
        .split(/[\n,，]+/)
        .map(item => item.trim())
        .filter(Boolean)
    )
  );
};

const getTableName = () => currentTableName.value || formData1.value.keyword || '社媒数据助手';

const {
  loading,
  createAndWriteData,
  validateTableFields,
} = useSocialData(getTableName, props.api_key, KEYWORD_SEARCH_FIELD_MAPPING);

const showToast = (text, isLoading = true, options = {}) => {
  if (isLoading) feedback.progress(text, { stopping: isCancelling.value });
  else feedback.finish(text, options);
};
const hideToast = () => feedback.hide();
const showCompletionToast = (text, options = {}) => feedback.finish(text, options);

const showFieldProgress = (message) => {
  showToast(isCancelling.value
    ? getStoppingText(keywordStreamTask.getActiveTask() || { writtenCount: 0 })
    : `${message}${TASK_TOAST_SUFFIX}`, true);
};

const loadSelectedFieldKeys = async () => {
  const defaultKeys = getDefaultSelectedFieldKeys(KEYWORD_SEARCH_FIELD_MAPPING);

  try {
    const savedValue = await bitable.bridge.getData(FIELD_SELECTION_STORAGE_KEY);

    if (!Array.isArray(savedValue)) {
      selectedFieldKeys.value = defaultKeys;
      return;
    }

    const validKeys = savedValue.filter(key => KEYWORD_SEARCH_FIELD_MAPPING.some(field => field.key === key));
    const requiredKeys = KEYWORD_SEARCH_FIELD_MAPPING.filter(field => field.required).map(field => field.key);
    const mergedKeys = Array.from(new Set([...validKeys, ...requiredKeys]));
    selectedFieldKeys.value = mergedKeys.length > 0 ? mergedKeys : defaultKeys;
  } catch (error) {
    console.error('读取字段勾选状态失败:', error);
    selectedFieldKeys.value = defaultKeys;
  }
};

const saveSelectedFieldKeys = async (keys) => {
  try {
    const requiredKeys = KEYWORD_SEARCH_FIELD_MAPPING.filter(field => field.required).map(field => field.key);
    const nextKeys = Array.from(new Set([...keys, ...requiredKeys]));
    await bitable.bridge.setData(FIELD_SELECTION_STORAGE_KEY, [...nextKeys]);
  } catch (error) {
    console.error('保存字段勾选状态失败:', error);
  }
};

const getStoppingText = task => getTaskStoppingText(task, '作品');

const hasRecoverableTask = ref(false);
const clearing = ref(false);
const requiresReopen = ref(false);
let componentUnmounted = false;
const restoreTask = async (task, progressText = '正在恢复未完成的数据获取任务…', restoring = false) => {
  const restoreForm = restoring && activeKeywordTaskId.value !== task.taskId && task.formData;
  hasRecoverableTask.value = true;
  loading.value = true;
  activeKeywordTaskId.value = task.taskId;
  const status = task.latestStatus;
  isCancelling.value = Number(status?.status) === 3 || status?.status_text === 'cancel_requested' || !!status?.cancel_requested;
  showToast(isCancelling.value ? getStoppingText(task) : progressText);
  if (restoreForm) {
    Object.assign(formData1.value, JSON.parse(JSON.stringify(task.formData)));
    currentTableName.value = getFirstKeyword(task.formData.keyword) || '社媒数据助手';
    if (Array.isArray(task.selectedFieldKeys)) selectedFieldKeys.value = [...task.selectedFieldKeys];
    await nextTick();
    if (componentUnmounted || keywordStreamTask.getActiveTask() !== task) return;
    // 平台切换的既有 watcher 会重置筛选项，等它完成后再恢复原任务筛选。
    Object.assign(formData1.value, JSON.parse(JSON.stringify(task.formData)));
    // 字段仅用于回显，不能阻塞原任务轮询和停止确认。
    loadMappingFields(formData1.value.radio === 2 ? formData1.value.table_id : '', task);
  }
};
const resumeSavedTask = async () => {
  if (requiresReopen.value || componentUnmounted || loading.value) return;
  loading.value = true;
  feedback.begin('正在检查未完成任务…');
  try {
    await nextTick();
    const resumed = await keywordStreamTask.resume(task => restoreTask(task, undefined, true));
    if (!resumed) {
      loading.value = false;
      if (hasRecoverableTask.value) feedback.fail('未读取到当前表格的恢复进度，请核对当前多维表格和已写入结果后重试恢复', { persist: true });
      else hideToast();
    }
  } catch (error) {
    hasRecoverableTask.value = true;
    requiresReopen.value = !!error.requiresReopen;
    loading.value = false;
    feedback.fail(error, { persist: true, requiresReopen: requiresReopen.value });
  }
};

const keywordTaskApiPath = (task, path) => buildFeishuApiPath(path,
  task.apiPathPrefix ?? LEGACY_FEISHU_API_PATH_PREFIX);

const keywordStreamTask = useIncrementalTask({
  storageKey: STREAM_TASK_STORAGE_KEY,
  operationTimeoutMs: 180000,
  isTerminal: (status) => [1, 2, 3].includes(Number(status.status)),
  getStatus: async (task) => (await feishuRequest({
    url: keywordTaskApiPath(task, `/v1/feishu/keyword/task?task_id=${encodeURIComponent(task.taskId)}`),
    method: 'get', baseURL: task.apiBaseUrl ?? API_BASE_URL,
    headers: { authorization: `Bearer ${props.api_key}` },
  })).data,
  getResults: async (task) => (await feishuRequest({
    url: keywordTaskApiPath(task, '/v1/feishu/post/list'),
    method: 'post', baseURL: task.apiBaseUrl ?? API_BASE_URL,
    headers: { authorization: `Bearer ${props.api_key}` },
    data: { task_id: task.taskId, after_id: task.cursor || '', limit: 40 },
  })).data,
  writeBatch: async (items, task, controls) => {
    const reconcile = task.pendingWrite ?? !!task.targetTableId;
    task.pendingWrite = reconcile;
    const result = await createAndWriteData(items, task.targetTableId ? 'stream' : '', task.taskId, task.targetTableId || '', task.selectedFieldKeys, {
      stopAfterCurrentBatch: true,
      initializingTableId: task.initializingTableId,
      onTableInitialized: async () => {
        controls.assertActive();
        task.initializingTableId = '';
        await controls.saveProgress();
      },
      attachmentPipeline: true,
      uploadBatchSize: 5,
      writeMode: task.writeMode || 'upsert',
      uniqueKey: 'aweme_id',
      reconcile,
      assertActive: controls.assertActive,
      onBeforeWrite: async () => {
        controls.assertActive();
        task.pendingWrite = true;
        await controls.saveProgress();
      },
      upsertCacheKey: task.taskId,
      fieldMappings: task.fieldMappings || [],
      onTargetTableReady: async (tableId) => {
        controls.assertActive();
        task.targetTableId = tableId;
        task.initializingTableId = tableId;
        await controls.saveProgress();
      },
    });
    controls.assertActive();
    task.targetTableId = result?.tableId || task.targetTableId;
    task.pendingWrite = false;
  },
  onProgress: (status, task, phase) => {
    clearing.value = phase === 'clearing';
    if (clearing.value) {
      feedback.progress('正在清理任务进度…');
      return;
    }
    const processed = Number(status.processed) || 0;
    const total = Number(status.total) || 0;
    if (Number(status.status) === 3 || status.status_text === 'cancel_requested' || status.cancel_requested) {
      isCancelling.value = true;
    }
    showToast(
      isCancelling.value
        ? getStoppingText(task)
        : `已处理 ${total ? `${processed}/${total}` : processed} 个搜索页，已写入 ${task.writtenCount || 0} 条作品，${TASK_TOAST_SUFFIX}`,
      true
    );
  },
  onWriting: (items, task) => showToast(isCancelling.value
    ? getStoppingText(task)
    : `正在写入 ${items.length} 条作品，已写入 ${task.writtenCount || 0} 条作品，${TASK_TOAST_SUFFIX}`, true),
  onFinish: async (status, task) => {
    clearing.value = false;
    hasRecoverableTask.value = false;
    loading.value = false;
    isCancelling.value = false;
    activeKeywordTaskId.value = '';
    if (Number(status.status) === 3) {
      showCompletionToast(`任务已停止，已写入 ${task.writtenCount || 0} 条作品`, { stopped: true });
      return;
    }
    if (Number(status.status) === 2) feedback.fail(status.reason || '获取数据失败，请稍后重试');
    else showCompletionToast(`处理完成，已写入 ${task.writtenCount || 0} 条作品`, { empty: !task.writtenCount });
  },
  onError: async (error, task) => {
    clearing.value = false;
    hasRecoverableTask.value = !!task?.taskId || !!error.taskCreated;
    requiresReopen.value = !!error.requiresReopen;
    loading.value = false;
    isCancelling.value = false;
    activeKeywordTaskId.value = '';
    feedback.fail(error, { persist: hasRecoverableTask.value, requiresReopen: requiresReopen.value });
  },
});

const cancelKeywordTask = async () => {
  const task = keywordStreamTask.getActiveTask();
  if (!task?.taskId || isCancelling.value || clearing.value) return;

  isCancelling.value = true;
  showToast(getStoppingText(task), true);
  try {
    const response = await feishuRequest({
      url: keywordTaskApiPath(task, '/v1/feishu/keyword/task/cancel'),
      method: 'post',
      baseURL: task.apiBaseUrl ?? API_BASE_URL,
      headers: { authorization: `Bearer ${props.api_key}` },
      data: { task_id: task.taskId },
    });
    const res = response.data;
    if (res?.sta !== 0) throw new Error(res?.msg || '停止任务失败');
  } catch (error) {
    if (keywordStreamTask.getActiveTask() !== task || clearing.value) return;
    const status = task.latestStatus;
    isCancelling.value = Number(status?.status) === 3 || status?.status_text === 'cancel_requested' || !!status?.cancel_requested;
    console.error('停止关键词搜索任务失败:', error);
    showToast(isCancelling.value ? getStoppingText(task) : `任务继续执行，已写入 ${task.writtenCount || 0} 条作品`);
    showErrorMsg(error?.response?.data?.msg || error.message || '停止任务失败');
  }
};

const postSearchTask = async (targetTableId = "") => {
  const outputSnapshot = {
    formData: JSON.parse(JSON.stringify(formData1.value)),
    targetTableId, selectedFieldKeys: [...selectedFieldKeys.value],
    writeMode: formData1.value.writeMode,
    fieldMappings: formData1.value.radio === 2 ? mappingDraft.value.map(item => ({ ...item })) : [],
  };
  let filter_config = {};
  const socialType = formData1.value.social_type;
  if (socialType === 'xhs') {
    filter_config = {
      sort_type: formData1.value.sort_type,
      filter_note_type: formData1.value.filter_note_type,
      filter_note_time: formData1.value.filter_note_time,
    };
  } else if (socialType === 'douyin') {
    filter_config = {
      sort_type: formData1.value.sort_type,
      publish_time: formData1.value.publish_time,
      filter_duration: formData1.value.filter_duration,
      content_type: formData1.value.douyin_content_type,
    };
  } else if (socialType === 'wechat') {
    filter_config = {
      sort_type: formData1.value.sort_type,
      duration_range: formData1.value.duration_range,
    };
  } else if (socialType === 'bilibili') {
    filter_config = {
      sort_type: formData1.value.sort_type,
      publish_time_range: isBilibiliCustomDate.value ? 'all' : formData1.value.publish_time_range,
      duration_range: formData1.value.duration_range,
    };
    if (isBilibiliCustomDate.value) {
      filter_config.publish_time_start_date = formData1.value.publish_time_start_date;
      filter_config.publish_time_end_date = formData1.value.publish_time_end_date;
    }
  } else if (socialType === 'zhihu') {
    filter_config = {
      content_type: formData1.value.content_type,
      sort_type: formData1.value.sort_type,
      publish_time_range: formData1.value.publish_time_range,
    };
  } else if (socialType === 'youtube') {
    filter_config = {
      sort_type: formData1.value.sort_type,
      video_type: formData1.value.video_type,
      publish_time_range: formData1.value.publish_time_range,
      duration_range: formData1.value.duration_range,
    };
  } else if (socialType === 'x') {
    filter_config = { sort_type: formData1.value.sort_type };
  } else if (socialType === 'tiktok') {
    filter_config = { content_type: formData1.value.content_type };
  }
  showToast(`正在提交关键词搜索任务...${TASK_TOAST_SUFFIX}`, true);
  await keywordStreamTask.submit(async () => {
    const response = await feishuRequest({
    url: buildFeishuApiPath('/v1/feishu/keyword/task'),
    method: "post",
    headers: { 'authorization': `Bearer ${props.api_key}` },
    data: {
      social_type: formData1.value.social_type,
      keyword: formData1.value.keyword,
      pages: formData1.value.workFetchRange.type === 'all'
        ? 0
        : Number(formData1.value.workFetchRange.pages),
      work_fetch_range: normalizeWorkFetchRange(),
      filter_config,
    },
  });
    const res = response.data;
    if (res?.sta !== 0 || !res.data?.task_id) throw new Error(res?.msg || '创建任务未返回任务ID');
    return {
      taskId: res.data.task_id, pendingWrite: false,
      apiBaseUrl: FEISHU_API_BASE_URL, apiPathPrefix: FEISHU_API_PATH_PREFIX,
      ...outputSnapshot,
    };
  }, task => restoreTask(task, '任务已创建，正在准备获取作品…'));
};

const getSearchData = async (targetTableId = "") => {
  if (componentUnmounted) return;
  loading.value = true;
  currentTableName.value = getFirstKeyword(formData1.value.keyword) || '社媒数据助手';
  await postSearchTask(targetTableId);
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

const loadMappingFields = async (tableId, restoredTask = null) => {
  const readId = ++tableConfigReadId;
  const pendingConfig = tableConfigSaves.get(tableId)?.config;
  tableConfigApplying.value = true;
  tableConfigLoadError.value = '';
  try {
    // 切换新建时使旧读取失效，保留已有表草稿；新任务仍不携带旧映射。
    if (!tableId) return;
    tableFieldOptions.value = [];
    mappingDraft.value = (restoredTask?.fieldMappings || []).map(item => ({ ...item }));
    const table = await bitable.base.getTableById(tableId);
    if (componentUnmounted || readId !== tableConfigReadId) return;
    const fields = await table.getFieldMetaList();
    if (componentUnmounted || readId !== tableConfigReadId) return;
    tableFieldOptions.value = fields;
    if (!restoredTask && !tableConfigsLoaded.value) return;
    const pending = tableConfigSaves.get(tableId);
    const config = restoredTask ? { write_mode: restoredTask.writeMode, field_mappings: restoredTask.fieldMappings } : pending?.config || pendingConfig || tableOutputConfigs.value[tableId];
    formData1.value.writeMode = config?.write_mode || 'upsert';
    mappingDraft.value = Array.isArray(config?.field_mappings) ? config.field_mappings.map(item => ({ ...item })) : [];
    if (pending) tableConfigSaveStatus.value = '保存中';
    else if (!pendingConfig) tableConfigSaveStatus.value = '';
  } catch (error) {
    if (componentUnmounted || readId !== tableConfigReadId) return;
    console.error('获取目标表格字段失败:', error);
    tableConfigLoadError.value = `读取目标表配置失败：${error?.message || '请稍后重试'}`;
    showErrorMsg(tableConfigLoadError.value);
  } finally {
    // 缓存应用触发的保存watcher执行完后，再允许用户编辑触发保存。
    await nextTick();
    if (!componentUnmounted && readId === tableConfigReadId) tableConfigApplying.value = false;
  }
};

const getBaseId = async () => (await bitable.base.getSelection()).baseId || '';
const loadTableOutputConfigs = async () => {
  const token = ++tableConfigsLoadToken;
  tableConfigsLoaded.value = false;
  tableConfigsError = null;
  if (!props.api_key) return false;
  try {
    const baseId = await getBaseId();
    if (componentUnmounted || token !== tableConfigsLoadToken) return false;
    const response = await feishuRequest({ url: TABLE_CONFIGS_API_PATH, method: 'get', headers: { authorization: `Bearer ${props.api_key}` }, params: { plugin_type: TASK_PLUGIN_TYPE, base_id: baseId } });
    if (componentUnmounted || token !== tableConfigsLoadToken) return false;
    if (response.data?.sta !== undefined && Number(response.data.sta) !== 0) throw new Error(response.data.msg || '读取输出表配置失败');
    const data = response.data?.data || response.data;
    const list = parseTableConfigList(data);
    tableOutputConfigs.value = Object.fromEntries(list.filter(item => item?.target_table_id).map(item => [item.target_table_id, item]));
    tableConfigsLoaded.value = true;
    return true;
  } catch (error) {
    if (componentUnmounted || token !== tableConfigsLoadToken) return false;
    tableConfigsError = error;
    console.error('读取关键词搜索表格配置失败:', error);
    return false;
  }
};
const persistTableOutputConfig = createTableConfigSaver(async ({ targetTableId, writeMode, fieldMappings }) => {
  if (componentUnmounted) return;
  tableConfigSaving.value = true;
  if (formData1.value.table_id === targetTableId) tableConfigSaveStatus.value = '保存中';
  try {
    const table = await bitable.base.getTableById(targetTableId);
    const payload = {
      plugin_type: TASK_PLUGIN_TYPE,
      base_id: await getBaseId(),
      target_table_id: targetTableId,
      target_table_name: await table.getName(),
      write_mode: writeMode,
      field_mappings: fieldMappings,
    };
    if (componentUnmounted) return;
    const response = await feishuRequest({ url: TABLE_CONFIG_API_PATH, method: 'put', headers: { authorization: `Bearer ${props.api_key}` }, data: payload });
    if (componentUnmounted) return;
    if (response.data?.sta !== 0) throw new Error(response.data?.msg || '保存关键词搜索表格配置失败');
    const saved = response.data?.data || response.data;
    tableOutputConfigs.value = { ...tableOutputConfigs.value, [targetTableId]: saved };
    if (formData1.value.table_id === targetTableId) tableConfigSaveStatus.value = '已保存';
  } catch (error) {
    if (!componentUnmounted && formData1.value.table_id === targetTableId) tableConfigSaveStatus.value = '保存失败';
    throw error;
  } finally {
    tableConfigSaving.value = false;
  }
});
const saveTableOutputConfig = async () => {
  if (!tableConfigsLoaded.value) return;
  const targetTableId = formData1.value.table_id;
  if (componentUnmounted || loading.value || isSubmitting.value || formData1.value.radio !== 2 || !targetTableId || tableConfigApplying.value || tableConfigLoadError.value) return;
  const writeMode = formData1.value.writeMode;
  const fields = tableFieldOptions.value;
  const fieldMappings = mappingDraft.value.filter(item => item.source_key && item.target_field_id).map(item => ({
    ...item,
    source_name: KEYWORD_SEARCH_FIELD_MAPPING.find(field => field.key === item.source_key)?.name || '',
    target_field_name: fields.find(field => field.id === item.target_field_id)?.name || '',
    target_field_type: fields.find(field => field.id === item.target_field_id)?.type,
  }));
  const saving = persistTableOutputConfig({ targetTableId, writeMode, fieldMappings });
  tableConfigSaves.set(targetTableId, { saving, config: { write_mode: writeMode, field_mappings: fieldMappings } });
  try {
    await saving;
  } catch (error) {
    if (!componentUnmounted) console.error('保存关键词搜索表格配置失败:', error);
  } finally {
    if (tableConfigSaves.get(targetTableId)?.saving === saving) tableConfigSaves.delete(targetTableId);
  }
};
watch([() => formData1.value.radio, () => formData1.value.table_id], ([radio, tableId], [previousRadio, previousTableId]) => {
  if (radio === 2) {
    if (radio !== previousRadio) loadTableOptions();
    // 同表已加载时保留草稿；未读完、读取失败或换表后才重新加载。
    if (radio === previousRadio || tableId !== previousTableId || !tableFieldOptions.value.length) loadMappingFields(tableId);
  } else {
    if (tableId !== previousTableId) tableFieldOptions.value = [];
    loadMappingFields('');
  }
});
watch([() => formData1.value.writeMode, mappingDraft], saveTableOutputConfig, { deep: true });

watch(
  () => formData1.value.social_type,
  (socialType) => {
    if (!supportsDayRange.value && formData1.value.workFetchRange.type === 'days') {
      formData1.value.workFetchRange.type = 'pages';
    }
    formData1.value.sort_type = getDefaultSortType(socialType);
    formData1.value.filter_note_type = 'all';
    formData1.value.filter_note_time = 'all';
    formData1.value.publish_time = 0;
    formData1.value.douyin_content_type = 0;
    formData1.value.content_type = 'all';
    formData1.value.video_type = 'all';
    formData1.value.publish_time_range = 'all';
    formData1.value.publish_time_start_date = '';
    formData1.value.publish_time_end_date = '';
    formData1.value.filter_duration = '0';
    formData1.value.duration_range = 'all';
  }
);

watch(
  () => formData1.value.publish_time_range,
  (publishTimeRange) => {
    if (publishTimeRange !== 'custom') {
      formData1.value.publish_time_start_date = '';
      formData1.value.publish_time_end_date = '';
    }
  }
);

onMounted(async () => {
  isSubmitting.value = true;
  try {
    const search_platform = await bitable.bridge.getData("search_platform");
    const search_keyword = await bitable.bridge.getData("search_keyword");
    if (search_keyword && typeof search_keyword == "string") {
      formData1.value.keyword = search_keyword;
    }
    if (search_platform && typeof search_platform == "string" && props.social_type_options.some(opt => opt.value === search_platform)) {
      formData1.value.social_type = search_platform;
    } else {
      formData1.value.social_type = props.social_type_options[0]?.value || "";
    }
    await loadSelectedFieldKeys();
    await loadTableOutputConfigs();
    fieldSelectionReady.value = true;
    await resumeSavedTask();
  } catch (error) {
    hasRecoverableTask.value = true;
    loading.value = false;
    requiresReopen.value = !!error.requiresReopen;
    feedback.fail(error, { persist: true });
  } finally { isSubmitting.value = false; }
});

onUnmounted(() => {
  componentUnmounted = true;
  keywordStreamTask.stop();
});

const commit = async () => {
  if (requiresReopen.value || componentUnmounted) return;
  if (hasRecoverableTask.value) return resumeSavedTask();
  if (isSubmitting.value || loading.value) {
    return;
  }

  isSubmitting.value = true;
  try {
    if (!props.api_key) {
      showErrorMsg("请输入 API Key");
      return;
    }
    const { social_type, keyword, radio, table_id } = formData1.value;
    const keywords = parseKeywords(keyword);
    if (!social_type || !social_type.trim()) {
      showErrorMsg("请选择平台");
      return;
    }
    if (keywords.length === 0) {
      showErrorMsg("请输入至少一个关键词");
      return;
    }
    if (social_type === 'bilibili' && formData1.value.publish_time_range === 'custom') {
      const { publish_time_start_date, publish_time_end_date } = formData1.value;
      if (!publish_time_start_date || !publish_time_end_date) {
        showErrorMsg("请选择完整的自定义发布时间范围");
        return;
      }
      if (publish_time_start_date > publish_time_end_date) {
        showErrorMsg("发布时间开始日期不能晚于结束日期");
        return;
      }
    }
    if (radio === 2 && !table_id) {
      showErrorMsg("请选择现有表格");
      return;
    }
    if (radio === 2 && !tableConfigsLoaded.value) {
      loading.value = true;
      feedback.begin('正在读取输出表配置…');
      const loaded = await loadTableOutputConfigs();
      if (componentUnmounted) return;
      if (!loaded) throw tableConfigsError || new Error('读取输出表配置失败');
      await loadMappingFields(table_id);
    }
    if (radio === 2 && tableConfigApplying.value) {
      showErrorMsg('正在读取目标表配置，请稍后重试');
      return;
    }
    if (radio === 2 && tableConfigLoadError.value) {
      showErrorMsg(tableConfigLoadError.value);
      return;
    }

    loading.value = true;
    feedback.begin('正在启动关键词搜索...');
    await nextTick();
    if (radio === 2) {
      showToast(`正在检查目标表字段...${TASK_TOAST_SUFFIX}`, true);
      const isValid = await validateTableFields(table_id, selectedFieldKeys.value, {
        throwOnError: true,
        writeMode: formData1.value.writeMode,
        fieldMappings: mappingDraft.value,
        onProgress: showFieldProgress,
      });
      if (isValid) {
        await getSearchData(table_id);
      } else {
        loading.value = false;
        showCompletionToast('目标字段校验未通过，任务未开始', { type: 'error' });
      }
      return;
    }

    await getSearchData("");
    bitable.bridge.setData("search_platform", formData1.value.social_type);
    bitable.bridge.setData("search_keyword", formData1.value.keyword);
  } catch (error) {
    loading.value = false;
    requiresReopen.value = !!error.requiresReopen;
    feedback.fail(error, { persist: requiresReopen.value });
  } finally {
    isSubmitting.value = false;
  }
};

const taskActionState = computed(() => {
  if (clearing.value) return 'clearing';
  if (isCancelling.value) return 'stopping';
  if (loading.value && activeKeywordTaskId.value) return 'running';
  if (loading.value || isSubmitting.value) return 'submitting';
  if (requiresReopen.value) return 'reopen';
  if (hasRecoverableTask.value) return 'recoverable';
  return 'idle';
});

const handleTaskAction = () => {
  if (taskActionState.value === 'recoverable') return resumeSavedTask();
  if (taskActionState.value === 'running') {
    return cancelKeywordTask();
  }
  if (taskActionState.value === 'idle') {
    return commit();
  }
};

watch(selectedFieldKeys, (keys) => {
  if (!fieldSelectionReady.value) {
    return;
  }

  const requiredKeys = KEYWORD_SEARCH_FIELD_MAPPING.filter(field => field.required).map(field => field.key);
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
      <span class="sub-page-title">关键词搜索获取</span>
    </div>
    <div class="form-card">
      <el-form ref="form" class="form" :model="formData1" label-position="top" :disabled="loading || isSubmitting" :inert="(loading || isSubmitting) ? '' : null" :aria-busy="loading || isSubmitting">
        <section class="settings-section" aria-labelledby="keyword-fetch-settings-title">
          <h2 id="keyword-fetch-settings-title" class="settings-section-heading">
            <span class="settings-step">1</span>
            <span>获取设置</span>
          </h2>
        <el-form-item label="">
          <div slot="label" class="c-label">
            平台
            <el-tooltip effect="dark" placement="top">
              <template #content>平台</template>
              <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png"
                class="help-icon" />
            </el-tooltip>
          </div>
          <el-select v-model="formData1.social_type" placeholder="请选择" style="width: 100%">
            <el-option v-for="tl in social_type_options" :key="tl.value" :label="tl.label" :value="tl.value" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <div slot="label" class="c-label">
            关键词
            <el-tooltip effect="dark" placement="top">
              <template #content>关键词搜索</template>
              <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png"
                class="help-icon" />
            </el-tooltip>
          </div>
          <el-input
            v-model="formData1.keyword"
            type="textarea"
            :rows="4"
            class="c-input"
            placeholder="请输入关键词，支持批量添加，多个关键词可换行或用逗号分隔"
          />
        </el-form-item>
        <el-form-item label="" v-if="showSortType">
          <div slot="label" class="c-label">
            排序方式
            <el-tooltip effect="dark" placement="top">
              <template #content>排序方式</template>
              <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png"
                class="help-icon" />
            </el-tooltip>
          </div>
          <el-select v-if="isDouyin" v-model="formData1.sort_type" placeholder="请选择" style="width: 100%">
            <el-option v-for="tl in douyin_sort_type_options" :key="tl.value" :label="tl.label" :value="tl.value" />
          </el-select>
          <el-select v-else-if="isXhs" v-model="formData1.sort_type" placeholder="请选择" style="width: 100%">
            <el-option v-for="tl in xhs_sort_type_options" :key="tl.value" :label="tl.label" :value="tl.value" />
          </el-select>
          <el-select v-else-if="isBilibili" v-model="formData1.sort_type" placeholder="请选择" style="width: 100%">
            <el-option v-for="tl in bilibili_sort_type_options" :key="tl.value" :label="tl.label" :value="tl.value" />
          </el-select>
          <el-select v-else-if="isWechat" v-model="formData1.sort_type" placeholder="请选择" style="width: 100%">
            <el-option v-for="tl in wechat_sort_type_options" :key="tl.value" :label="tl.label" :value="tl.value" />
          </el-select>
          <el-select v-else-if="isZhihu" v-model="formData1.sort_type" placeholder="请选择" style="width: 100%">
            <el-option v-for="tl in zhihu_sort_type_options" :key="tl.value" :label="tl.label" :value="tl.value" />
          </el-select>
          <el-select v-else-if="isYoutube" v-model="formData1.sort_type" placeholder="请选择" style="width: 100%">
            <el-option v-for="tl in youtube_sort_type_options" :key="tl.value" :label="tl.label" :value="tl.value" />
          </el-select>
          <el-select v-else-if="isX" v-model="formData1.sort_type" placeholder="请选择" style="width: 100%">
            <el-option v-for="tl in x_sort_type_options" :key="tl.value" :label="tl.label" :value="tl.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="" v-if="isXhs">
          <div slot="label" class="c-label">
            笔记类型
            <el-tooltip effect="dark" placement="top">
              <template #content>笔记类型</template>
              <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png"
                class="help-icon" />
            </el-tooltip>
          </div>
          <el-select v-model="formData1.filter_note_type" placeholder="请选择" style="width: 100%">
            <el-option v-for="tl in filter_note_type_options" :key="tl.value" :label="tl.label" :value="tl.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="" v-if="isXhs">
          <div slot="label" class="c-label">
            发布时间
            <el-tooltip effect="dark" placement="top">
              <template #content>发布时间</template>
              <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png"
                class="help-icon" />
            </el-tooltip>
          </div>
          <el-select v-model="formData1.filter_note_time" placeholder="请选择" style="width: 100%">
            <el-option v-for="tl in xhs_time_options" :key="tl.value" :label="tl.label" :value="tl.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="" v-if="isDouyin">
          <div slot="label" class="c-label">
            发布时间
            <el-tooltip effect="dark" placement="top">
              <template #content>发布时间</template>
              <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png"
                class="help-icon" />
            </el-tooltip>
          </div>
          <el-select v-model="formData1.publish_time" placeholder="请选择" style="width: 100%">
            <el-option v-for="tl in douyin_publish_time_options" :key="tl.value" :label="tl.label" :value="tl.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="" v-if="isDouyin">
          <div slot="label" class="c-label">
            筛选时长
            <el-tooltip effect="dark" placement="top">
              <template #content>筛选时长</template>
              <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png"
                class="help-icon" />
            </el-tooltip>
          </div>
          <el-select v-model="formData1.filter_duration" placeholder="请选择" style="width: 100%">
            <el-option v-for="tl in douyin_duration_options" :key="tl.value" :label="tl.label" :value="tl.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="" v-if="isDouyin">
          <div slot="label" class="c-label">内容类型</div>
          <el-select v-model="formData1.douyin_content_type" placeholder="请选择" style="width: 100%">
            <el-option :value="0" label="不限" />
            <el-option :value="1" label="视频" />
            <el-option :value="2" label="图文" />
          </el-select>
        </el-form-item>
        <el-form-item label="" v-if="isBilibili">
          <div slot="label" class="c-label">
            发布时间
            <el-tooltip effect="dark" placement="top">
              <template #content>可按发布时间范围筛选，也可自定义起止日期</template>
              <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png"
                class="help-icon" />
            </el-tooltip>
          </div>
          <el-select v-model="formData1.publish_time_range" placeholder="请选择" style="width: 100%">
            <el-option v-for="tl in bilibili_publish_time_range_options" :key="tl.value" :label="tl.label" :value="tl.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="" v-if="isBilibiliCustomDate">
          <div slot="label" class="c-label">自定义发布时间范围</div>
          <div class="date-range-row">
            <el-date-picker
              v-model="formData1.publish_time_start_date"
              type="date"
              value-format="YYYY-MM-DD"
              placeholder="开始日期"
              style="width: 100%"
            />
            <span class="date-range-separator">至</span>
            <el-date-picker
              v-model="formData1.publish_time_end_date"
              type="date"
              value-format="YYYY-MM-DD"
              placeholder="结束日期"
              style="width: 100%"
            />
          </div>
        </el-form-item>
        <el-form-item label="" v-if="isBilibili">
          <div slot="label" class="c-label">
            视频时长
            <el-tooltip effect="dark" placement="top">
              <template #content>按视频时长筛选</template>
              <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png"
                class="help-icon" />
            </el-tooltip>
          </div>
          <el-select v-model="formData1.duration_range" placeholder="请选择" style="width: 100%">
            <el-option v-for="tl in bilibili_duration_range_options" :key="tl.value" :label="tl.label" :value="tl.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="" v-if="isWechat">
          <div slot="label" class="c-label">视频时长</div>
          <el-select v-model="formData1.duration_range" placeholder="请选择" style="width: 100%">
            <el-option v-for="tl in wechat_duration_options" :key="tl.value" :label="tl.label" :value="tl.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="" v-if="isZhihu">
          <div slot="label" class="c-label">内容类型</div>
          <el-select v-model="formData1.content_type" placeholder="请选择" style="width: 100%">
            <el-option v-for="tl in zhihu_content_type_options" :key="tl.value" :label="tl.label" :value="tl.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="" v-if="isZhihu">
          <div slot="label" class="c-label">发布时间</div>
          <el-select v-model="formData1.publish_time_range" placeholder="请选择" style="width: 100%">
            <el-option v-for="tl in zhihu_time_options" :key="tl.value" :label="tl.label" :value="tl.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="" v-if="isYoutube">
          <div slot="label" class="c-label">视频类型</div>
          <el-select v-model="formData1.video_type" placeholder="请选择" style="width: 100%">
            <el-option v-for="tl in youtube_video_type_options" :key="tl.value" :label="tl.label" :value="tl.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="" v-if="isYoutube">
          <div slot="label" class="c-label">发布时间</div>
          <el-select v-model="formData1.publish_time_range" placeholder="请选择" style="width: 100%">
            <el-option v-for="tl in youtube_time_options" :key="tl.value" :label="tl.label" :value="tl.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="" v-if="isYoutube">
          <div slot="label" class="c-label">视频时长</div>
          <el-select v-model="formData1.duration_range" placeholder="请选择" style="width: 100%">
            <el-option v-for="tl in youtube_duration_options" :key="tl.value" :label="tl.label" :value="tl.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="" v-if="isTiktok">
          <div slot="label" class="c-label">内容类型</div>
          <el-select v-model="formData1.content_type" placeholder="请选择" style="width: 100%">
            <el-option v-for="tl in tiktok_content_type_options" :key="tl.value" :label="tl.label" :value="tl.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="">
          <div slot="label" class="c-label">
            作品获取范围
            <el-tooltip effect="dark" placement="top">
              <template #content>按搜索接口实际请求的页数计费，<br />不同平台每页积分可能不同</template>
              <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png"
                class="help-icon" />
            </el-tooltip>
          </div>
          <el-radio-group v-model="formData1.workFetchRange.type" class="custom-radio-group">
            <el-radio v-for="item in workRangeTypes" :key="item.value" :value="item.value" :disabled="item.value === 'days' && !supportsDayRange ? true : undefined" class="custom-radio-item">
              <span class="radio-label-text">{{ item.label }}</span>
              <div v-if="item.value === 'pages'" class="custom-stepper-input range-stepper" :class="{ 'is-disabled': formData1.workFetchRange.type !== 'pages' }">
                <input v-model.number="formData1.workFetchRange.pages" type="number" min="1" max="50" :disabled="formData1.workFetchRange.type !== 'pages'" @click.stop />
                <div class="stepper-buttons">
                  <button type="button" class="stepper-btn stepper-btn-up" :disabled="formData1.workFetchRange.type !== 'pages'" aria-label="增加页数" @click.stop="formData1.workFetchRange.pages = Math.min(50, (formData1.workFetchRange.pages || 1) + 1)"></button>
                  <button type="button" class="stepper-btn stepper-btn-down" :disabled="formData1.workFetchRange.type !== 'pages'" aria-label="减少页数" @click.stop="formData1.workFetchRange.pages = Math.max(1, (formData1.workFetchRange.pages || 1) - 1)"></button>
                </div>
              </div>
              <span v-if="item.value === 'pages'" class="range-unit">页</span>
              <div v-if="item.value === 'days'" class="custom-stepper-input range-stepper" :class="{ 'is-disabled': formData1.workFetchRange.type !== 'days' }">
                <input v-model.number="formData1.workFetchRange.days" type="number" min="1" max="365" :disabled="formData1.workFetchRange.type !== 'days'" @click.stop />
                <div class="stepper-buttons">
                  <button type="button" class="stepper-btn stepper-btn-up" :disabled="formData1.workFetchRange.type !== 'days'" aria-label="增加天数" @click.stop="formData1.workFetchRange.days = Math.min(365, (formData1.workFetchRange.days || 1) + 1)"></button>
                  <button type="button" class="stepper-btn stepper-btn-down" :disabled="formData1.workFetchRange.type !== 'days'" aria-label="减少天数" @click.stop="formData1.workFetchRange.days = Math.max(1, (formData1.workFetchRange.days || 1) - 1)"></button>
                </div>
              </div>
              <span v-if="item.value === 'days'" class="range-unit">个自然日发布的作品</span>
            </el-radio>
          </el-radio-group>
          <div v-if="!supportsDayRange" class="range-cost">{{ isYoutube ? 'YouTube' : '好看视频' }}搜索暂不支持按天获取，请按页获取或获取全部作品</div>
          <div class="range-cost">积分消耗取决于请求页数，各平台可能不同</div>
        </el-form-item>

        </section>

        <section class="settings-section settings-section-output" aria-labelledby="keyword-output-settings-title">
          <h2 id="keyword-output-settings-title" class="settings-section-heading">
            <span class="settings-step">2</span>
            <span>输出设置</span>
          </h2>
        <el-form-item label="" style="margin-top: 0">
          <div class="field-stack">
            <div class="c-label">输出到表格</div>
            <el-radio-group v-model="formData1.radio" class="radio-block">
              <el-radio :value="1">新建表格</el-radio>
              <el-radio :value="2">使用现有表格</el-radio>
            </el-radio-group>
          </div>
        </el-form-item>
        <el-form-item v-if="formData1.radio === 2" label="">
          <div slot="label" class="c-label">选择现有表格</div>
          <el-select v-model="formData1.table_id" placeholder="请选择" style="width: 100%">
            <el-option v-for="tl in table_options" :key="tl.id" :label="tl.name" :value="tl.id" />
          </el-select>
          <p v-if="tableConfigApplying" class="sub-hint">正在读取目标表配置…</p>
          <div v-else-if="tableConfigLoadError" class="sub-hint" role="alert">
            {{ tableConfigLoadError }}
            <el-button link type="primary" :disabled="loading || isSubmitting" @click="loadMappingFields(formData1.table_id)">重新读取配置</el-button>
          </div>
        </el-form-item>
        <el-form-item v-if="formData1.radio === 2" label="" style="margin-top: 0">
          <div class="c-label">数据写入方式</div>
          <el-radio-group v-model="formData1.writeMode" class="radio-block" :disabled="!outputConfigReady">
            <el-radio v-for="item in writeModeOptions" :key="item.value" :value="item.value">
              {{ item.label }}
              <el-tooltip v-if="item.value === 'upsert'" effect="dark" placement="top">
                <template #content>按作品ID判断是否为同一作品；已存在则更新，不存在则新增。</template>
                <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png" class="help-icon" />
              </el-tooltip>
            </el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="" style="margin-top: 0">
          <div class="field-selection-content">
            <div class="field-selection-title">
              <div class="c-label">选择需要的字段</div>
            </div>
            <el-checkbox
              :model-value="isAllFieldsSelected"
              :indeterminate="isFieldsPartiallySelected"
              class="select-all-fields"
              @change="toggleAllFields"
            >
              全选
            </el-checkbox>
            <el-checkbox-group v-model="selectedFieldKeys" class="field-checkbox-group">
              <el-checkbox
                v-for="field in KEYWORD_SEARCH_FIELD_MAPPING"
                :key="field.key"
                :label="field.key"
                :disabled="field.required"
                class="field-checkbox-item"
              >
                {{ field.name }}
              </el-checkbox>
            </el-checkbox-group>
          </div>
        </el-form-item>
        <div v-if="formData1.radio === 2" class="mapping-accordion">
          <button type="button" class="mapping-accordion-trigger" :aria-expanded="mappingExpanded" @click="mappingExpanded = !mappingExpanded">
            <span class="mapping-accordion-label">字段映射 <span class="mapping-optional">（可选）</span><span class="mapping-status">{{ mappingStatus }}</span></span>
            <span class="mapping-chevron" :class="{ 'is-expanded': mappingExpanded }" aria-hidden="true"></span>
          </button>
          <div v-show="mappingExpanded" class="mapping-accordion-panel">
            <p class="mapping-note">同名字段将自动写入；不同名时请在下方指定目标列。未映射且没有同名列时，将自动新建同名列。</p>
            <div v-for="(mapping, index) in mappingDraft" :key="`${mapping.source_key}-${index}`" class="mapping-row">
              <el-select v-model="mapping.source_key" :disabled="!outputConfigReady" placeholder="选择输出字段" size="small">
                <el-option v-for="field in getMappingSourceFields(index)" :key="field.key" :label="field.name" :value="field.key" :disabled="field.disabled" />
              </el-select>
              <span class="mapping-arrow">→</span>
              <el-select v-model="mapping.target_field_id" :disabled="!outputConfigReady" placeholder="选择目标字段" size="small">
                <el-option v-for="field in getMappingTargetFields(index)" :key="field.id" :label="field.name" :value="field.id" :disabled="field.disabled" />
              </el-select>
              <el-button link type="danger" class="mapping-delete" @click="mappingDraft.splice(index, 1)" :disabled="!outputConfigReady">删除</el-button>
            </div>
            <div class="mapping-actions">
              <el-button link type="primary" @click="mappingDraft.push({ source_key: '', target_field_id: '' })" :disabled="!outputConfigReady">+ 添加字段映射</el-button>
            </div>
          </div>
        </div>
        </section>
      </el-form>
      <p v-if="taskNotice" class="sub-hint" role="status">{{ taskNotice }}</p>

      <el-button
        class="commit-btn"
        :class="{ 'is-running': taskActionState === 'running' || taskActionState === 'stopping' }"
        :loading="taskActionState === 'submitting' || taskActionState === 'stopping' || taskActionState === 'clearing'"
        :disabled="taskActionState === 'submitting' || taskActionState === 'stopping' || taskActionState === 'clearing' || taskActionState === 'reopen' || (taskActionState === 'idle' && formData1.radio === 2 && (tableConfigApplying || !!tableConfigLoadError))"
        @click="handleTaskAction"
      >{{ taskActionState === 'clearing' ? '执行中…' : taskActionState === 'submitting' ? '准备中…' : taskActionState === 'stopping' ? '正在停止…' : taskActionState === 'running' ? '停止任务' : taskActionState === 'reopen' ? '请重新进入插件恢复' : taskActionState === 'recoverable' ? '恢复任务' : '立即执行' }}</el-button>
    </div>

    <TaskFeedback :visible="toastVisible" :text="toastText" :kind="toastType" />
  </div>
</template>

<style scoped>
.sub-page {
  min-height: 100vh;
  background: #fffcfc;
}
.sub-page-header {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  min-height: 48px;
  padding: 0 8px;
  background: #FFFFFF;
  border-bottom: 1px solid #E5E6EB;
  position: sticky;
  top: 0;
  z-index: 100;
}
.sub-page-back {
  width: 32px;
  height: 32px;
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
  font-size: 18px;
  font-weight: 600;
  color: #1D2129;
  line-height: 24px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.form-card {
  margin: 16px;
  padding: 20px;
  background: #FFFFFF;
  border: 1px solid #E5E6EB;
  border-radius: 8px;
  box-sizing: border-box;
}
.settings-section {
  min-width: 0;
}
.settings-section-output {
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid #F0F1F3;
}
.settings-section-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 12px;
  color: #1D2129;
  font-size: 16px;
  font-weight: 500;
  line-height: 22px;
}
.field-stack {
  width: 100%;
}
.radio-block {
  width: 100%;
}
.settings-step {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  color: #A8071A;
  background: #FFF1F2;
  border-radius: 50%;
  font-size: 12px;
  font-weight: 600;
  line-height: 20px;
}
.form :deep(.el-form-item__label) {
  font-size: 14px;
  color: #1d2129;
  margin-bottom: 8px;
}
.form :deep(.el-form-item) {
  margin-bottom: 16px;
}
.form :deep(.el-form-item__content) {
  font-size: 14px;
}
.form :deep(.el-select__wrapper) {
  min-height: 36px;
  height: 36px;
  padding: 0 12px;
}
.form :deep(.el-input__wrapper) {
  min-height: 36px;
  padding: 0 12px;
}
.form :deep(.el-textarea__inner) {
  min-height: 80px;
  padding: 8px 12px;
}

.commit-btn { margin-top: 0; }
.sub-hint { margin:0 0 16px; color:#86909c; font-size:12px; line-height:18px; overflow-wrap:anywhere; }

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
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  width: 100%;
  margin-right: 0;
}
.custom-radio-group :deep(.el-radio__input) {
  flex-shrink: 0;
  margin-right: 8px;
}
.custom-radio-group :deep(.el-radio__inner) {
  width: 16px;
  height: 16px;
  border-color: #E5E6EB;
  background: #FFFFFF;
}
.custom-radio-group :deep(.el-radio__input.is-checked .el-radio__inner) {
  border-color: #A8071A;
  background: #FFFFFF;
  border-width: 4px;
}
.custom-radio-group :deep(.el-radio__inner::after) { display: none; }
.custom-radio-group :deep(.el-radio__label) {
  display: flex;
  align-items: center;
  width: 100%;
  padding-left: 0;
  color: #1D2129;
  font-size: 14px;
  line-height: 22px;
}
.radio-label-text { flex-shrink: 0; }
.range-stepper { margin-left: 8px; }
.custom-stepper-input {
  display: flex;
  align-items: center;
  width: 80px;
  height: 32px;
  margin-left: 8px;
  overflow: hidden;
  border: 1px solid #E5E6EB;
  border-radius: 6px;
  background: #FFFFFF;
}
.custom-stepper-input.is-disabled { background: #F2F3F5; }
.stepper-buttons {
  display: flex;
  flex-direction: column;
  width: 28px;
  height: 100%;
  flex-shrink: 0;
  border-left: 1px solid #E5E6EB;
  background: #F2F3F5;
}
.stepper-btn {
  flex: 1;
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}
.stepper-btn-up { border-bottom: 1px solid #E5E6EB; }
.stepper-btn::before {
  display: block;
  width: 0;
  height: 0;
  margin: auto;
  border-right: 4px solid transparent;
  border-left: 4px solid transparent;
  content: '';
}
.stepper-btn-up::before { border-bottom: 4px solid #86909C; }
.stepper-btn-down::before { border-top: 4px solid #86909C; }
.stepper-btn:not(:disabled):hover { background: #FFF0F2; }
.stepper-btn:disabled { cursor: not-allowed; }
.custom-stepper-input input {
  width: 100%;
  height: 100%;
  padding: 0 8px;
  border: 0;
  outline: 0;
  background: transparent;
  color: #1D2129;
  font: inherit;
  text-align: center;
  -moz-appearance: textfield;
}
.custom-stepper-input input::-webkit-outer-spin-button,
.custom-stepper-input input::-webkit-inner-spin-button {
  margin: 0;
  -webkit-appearance: none;
}
.range-unit {
  flex-shrink: 0;
  margin-left: 8px;
  color: #4E5969;
  font-size: 14px;
  white-space: nowrap;
}
.range-cost {
  margin-top: 8px;
  color: #86909C;
  font-size: 12px;
  line-height: 20px;
}
.select-all-fields {
  margin-right: 0;
  margin-bottom: 8px;
}
.field-selection-content {
  display: block;
  width: 100%;
}
.field-selection-title {
  margin-bottom: 8px;
}
.field-selection-title .c-label {
  margin-bottom: 0;
}
.mapping-accordion { margin: 12px 0 16px; border-top: 1px solid #F0F1F3; border-bottom: 1px solid #F0F1F3; }
.mapping-accordion-trigger { display: flex; align-items: center; justify-content: space-between; width: 100%; min-height: 48px; padding: 12px 0; color: #1D2129; background: transparent; border: 0; cursor: pointer; font: inherit; text-align: left; }
.mapping-accordion-label { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px; font-size: 14px; font-weight: 500; line-height: 22px; }
.mapping-optional, .mapping-status, .mapping-note { color: #86909C; font-size: 12px; font-weight: 400; }
.mapping-chevron { width: 8px; height: 8px; margin-right: 4px; border-right: 1.5px solid #86909C; border-bottom: 1.5px solid #86909C; transform: rotate(45deg) translateY(-2px); }
.mapping-chevron.is-expanded { transform: rotate(225deg) translateY(-2px); }
.mapping-accordion-panel { padding: 0 0 12px; }
.mapping-note { margin: 0 0 12px; line-height: 18px; }
.mapping-row { display: grid; grid-template-columns: minmax(0, 1fr) 12px minmax(0, 1fr) auto; gap: 4px; align-items: center; min-height: 44px; border-top: 1px solid #F0F1F3; }
.mapping-arrow { color: #86909C; text-align: center; }
.mapping-delete { padding: 0 4px; }
.mapping-actions { padding-top: 8px; }

.date-range-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.date-range-separator {
  color: #4E5969;
  flex: 0 0 auto;
}

.field-checkbox-group {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 16px;
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
.sub-page { font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
.section-heading { font-size: 16px; font-weight: 500; line-height: 22px; }
.group-label, .c-label { margin-bottom: 8px; font-size: 14px; font-weight: 500; line-height: 20px; }
.source-mode-radio, .radio-block { display: flex; flex-wrap: wrap; gap: 16px; }
.source-mode-radio :deep(.el-radio), .radio-block :deep(.el-radio) { min-height: 28px; margin-right: 0; }
.custom-radio-group { gap: 8px; }
.sub-page :deep(.el-radio__label), .sub-page :deep(.el-checkbox__label) { font-family: inherit; font-size: 14px; font-weight: 400; line-height: 20px; }

</style>
