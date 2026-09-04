<script setup>
import { bitable } from "@lark-base-open/js-sdk";
import { ElNotification } from "element-plus";
import { ref, onMounted, onUnmounted, computed, watch } from "vue";
import request from '@/utils/request'
import { useSocialData, showErrorMsg, KEYWORD_SEARCH_FIELD_MAPPING, getDefaultSelectedFieldKeys } from '@/composables/useSocialData'
import { useIncrementalTask } from '@/composables/useIncrementalTask'

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
const TABLE_CONFIG_API_PATH = '/social/api/v1/feishu/profile-fetch/table-output-config';
const TABLE_CONFIGS_API_PATH = '/social/api/v1/feishu/profile-fetch/table-output-configs';
const table_options = ref([]);
const tableFieldOptions = ref([]);
const mappingDraft = ref([]);
const mappingExpanded = ref(false);
const tableOutputConfigs = ref({});
const tableConfigSaving = ref(false);
const tableConfigApplying = ref(false);
const tableConfigSaveStatus = ref('');
const FIELD_SELECTION_STORAGE_KEY = 'keyword_search_selected_fields_v1';
const STREAM_TASK_STORAGE_KEY = 'keyword_search_stream_task_v1';
const selectedFieldKeys = ref([]);
const fieldSelectionReady = ref(false);
const toastVisible = ref(false);
const toastText = ref('');
const toastLoading = ref(false);
const currentTableName = ref('');
let toastTimer = null;

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
const mappingSourceFields = computed(() => KEYWORD_SEARCH_FIELD_MAPPING.filter(field => selectedFieldKeys.value.includes(field.key)));
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

const keywordStreamTask = useIncrementalTask({
  storageKey: STREAM_TASK_STORAGE_KEY,
  getStatus: async (task) => (await request({ url: `/social/api/v1/feishu/keyword/task?task_id=${encodeURIComponent(task.taskId)}`, method: 'get', headers: { authorization: `Bearer ${props.api_key}` } })).data,
  getResults: async (task) => (await request({ url: '/social/api/v1/feishu/post/list', method: 'post', headers: { authorization: `Bearer ${props.api_key}` }, data: { task_id: task.taskId, after_id: task.cursor || '', limit: 20 } })).data,
  writeBatch: async (items, task) => {
    const result = await createAndWriteData(items, task.targetTableId ? 'stream' : '', task.taskId, task.targetTableId || '', task.selectedFieldKeys, {
      stopAfterCurrentBatch: true,
      writeMode: task.writeMode || 'upsert',
      upsertCacheKey: task.taskId,
      fieldMappings: task.fieldMappings || [],
      onTargetTableReady: async (tableId) => { task.targetTableId = tableId; },
    });
    task.targetTableId = result?.tableId || task.targetTableId;
  },
  onProgress: (status, task) => {
    const processed = Number(status.processed) || 0;
    const total = Number(status.total) || 0;
    showToast(`已处理 ${total ? `${processed}/${total}` : processed} 个搜索页，已写入 ${task.writtenCount || 0} 条作品`, true);
  },
  onWriting: (items) => showToast(`正在写入 ${items.length} 条作品...`, true),
  onFinish: async (status, task) => {
    loading.value = false;
    showCompletionToast(Number(status.status) === 2 ? (status.reason || '任务失败') : `处理完成，已写入 ${task.writtenCount || 0} 条作品`);
    if (Number(status.status) === 2) showErrorMsg(status.reason || '获取数据失败，请稍后重试');
  },
  onError: async (error) => {
    loading.value = false;
    showCompletionToast(error.message || '任务长时间没有进度');
    showErrorMsg(error.message || '任务长时间没有进度');
  },
});

const postSearchTask = async (targetTableId = "") => {
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
  await request({
    url: "/social/api/v1/feishu/keyword/task",
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
  })
    .then(function (response) {
      let res = response.data;
      if (res.sta == 0) {
        const data = res.data;
        keywordStreamTask.start({
          taskId: data.task_id,
          targetTableId,
          selectedFieldKeys: [...selectedFieldKeys.value],
          writeMode: formData1.value.writeMode,
          fieldMappings: mappingDraft.value.map(item => ({ ...item })),
        });
      } else {
        loading.value = false;
        showErrorMsg(res.msg);
      }
    })
    .catch(function (error) {
      loading.value = false;
      console.log(error);
      showErrorMsg(error.message || '请求失败');
    });
};

const getSearchData = async (targetTableId = "") => {
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

const loadMappingFields = async (tableId) => {
  tableConfigApplying.value = true;
  try {
    tableFieldOptions.value = [];
    mappingDraft.value = [];
    if (!tableId) return;
    const table = await bitable.base.getTableById(tableId);
    tableFieldOptions.value = await table.getFieldMetaList();
    const config = tableOutputConfigs.value[tableId];
    formData1.value.writeMode = config?.write_mode || 'upsert';
    mappingDraft.value = Array.isArray(config?.field_mappings) ? config.field_mappings.map(item => ({ ...item })) : [];
    tableConfigSaveStatus.value = '';
  } catch (error) {
    console.error('获取目标表格字段失败:', error);
    showErrorMsg('获取目标表格字段失败，请稍后重试');
  } finally {
    tableConfigApplying.value = false;
  }
};

watch(
  () => formData1.value.radio,
  (radio) => {
    if (radio === 2) loadTableOptions();
  }
);
const getBaseId = async () => (await bitable.base.getSelection()).baseId || '';
const loadTableOutputConfigs = async () => {
  if (!props.api_key) return;
  try {
    const response = await request({ url: TABLE_CONFIGS_API_PATH, method: 'get', headers: { authorization: `Bearer ${props.api_key}` }, params: { plugin_type: TASK_PLUGIN_TYPE, base_id: await getBaseId() } });
    const data = response.data?.data || response.data;
    const list = Array.isArray(data) ? data : (data?.list || data?.items || []);
    tableOutputConfigs.value = Object.fromEntries(list.filter(item => item?.target_table_id).map(item => [item.target_table_id, item]));
  } catch (error) { console.error('读取关键词搜索表格配置失败:', error); }
};
const saveTableOutputConfig = async () => {
  const targetTableId = formData1.value.table_id;
  if (formData1.value.radio !== 2 || !targetTableId || tableConfigSaving.value || tableConfigApplying.value) return;
  tableConfigSaving.value = true;
  tableConfigSaveStatus.value = '保存中';
  try {
    const table = await bitable.base.getTableById(targetTableId);
    const fields = tableFieldOptions.value;
    const fieldMappings = mappingDraft.value.filter(item => item.source_key && item.target_field_id).map(item => ({
      ...item,
      source_name: KEYWORD_SEARCH_FIELD_MAPPING.find(field => field.key === item.source_key)?.name || '',
      target_field_name: fields.find(field => field.id === item.target_field_id)?.name || '',
      target_field_type: fields.find(field => field.id === item.target_field_id)?.type,
    }));
    const response = await request({ url: TABLE_CONFIG_API_PATH, method: 'put', headers: { authorization: `Bearer ${props.api_key}` }, data: { plugin_type: TASK_PLUGIN_TYPE, base_id: await getBaseId(), target_table_id: targetTableId, target_table_name: await table.getName(), write_mode: formData1.value.writeMode, field_mappings: fieldMappings } });
    const saved = response.data?.data || response.data;
    tableOutputConfigs.value = { ...tableOutputConfigs.value, [targetTableId]: saved };
    tableConfigSaveStatus.value = '已保存';
  } catch (error) { tableConfigSaveStatus.value = '保存失败'; console.error('保存关键词搜索表格配置失败:', error); }
  finally { tableConfigSaving.value = false; }
};
watch(() => formData1.value.table_id, loadMappingFields);
watch([() => formData1.value.writeMode, mappingDraft], saveTableOutputConfig, { deep: true });

watch(
  () => formData1.value.social_type,
  (socialType) => {
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
  await keywordStreamTask.resume(() => {
    loading.value = true;
    showToast('正在恢复未完成的关键词采集任务...', true);
  });
});

onUnmounted(() => {
  keywordStreamTask.stop();
  if (toastTimer) clearTimeout(toastTimer);
});

const commit = () => {
  if (!props.api_key) {
    showErrorMsg("请输入API key");
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

  if (radio === 2) {
    validateTableFields(table_id, selectedFieldKeys.value, {
      writeMode: formData1.value.writeMode,
      fieldMappings: mappingDraft.value,
    }).then(isValid => {
      if (isValid) getSearchData(table_id);
    }).catch(error => {
      console.error("验证表格字段时出错:", error);
      showErrorMsg("验证表格字段失败，请稍后重试");
    });
    return;
  }

  getSearchData("");
  bitable.bridge.setData("search_platform", formData1.value.social_type);
  bitable.bridge.setData("search_keyword", formData1.value.keyword);
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
      <el-form ref="form" class="form" :model="formData1" label-position="top">
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
              <template #content>每页 10 积分，实际扣费会按照<br />提取的页数进行计算</template>
              <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png"
                class="help-icon" />
            </el-tooltip>
          </div>
          <el-radio-group v-model="formData1.workFetchRange.type" class="custom-radio-group">
            <el-radio v-for="item in workRangeTypes" :key="item.value" :value="item.value" class="custom-radio-item">
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
        </el-form-item>
        <el-form-item v-if="formData1.radio === 2" label="" style="margin-top: 0">
          <div class="c-label">数据写入方式</div>
          <el-radio-group v-model="formData1.writeMode" class="radio-block">
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
              <el-select v-model="mapping.source_key" placeholder="选择输出字段" size="small">
                <el-option v-for="field in mappingSourceFields" :key="field.key" :label="field.name" :value="field.key" />
              </el-select>
              <span class="mapping-arrow">→</span>
              <el-select v-model="mapping.target_field_id" placeholder="选择目标字段" size="small">
                <el-option v-for="field in tableFieldOptions" :key="field.id" :label="field.name" :value="field.id" />
              </el-select>
              <el-button link type="danger" class="mapping-delete" @click="mappingDraft.splice(index, 1)">删除</el-button>
            </div>
            <div class="mapping-actions">
              <el-button link type="primary" @click="mappingDraft.push({ source_key: '', target_field_id: '' })">+ 添加字段映射</el-button>
            </div>
          </div>
        </div>
        </section>
      </el-form>

      <el-button color="#a8071a" class="commit-btn" :loading="loading" @click="commit">提交</el-button>
    </div>

    <div class="toast-wrap" :class="{ show: toastVisible }">
      <div class="toast" :class="{ 'toast-loading': toastLoading }">
        <div class="toast-icon" v-if="toastLoading">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 2a10 10 0 0 1 10 10" /></svg>
        </div>
        <div class="toast-icon" v-else>
          <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="#00B42A" /><path d="M8 12l2.5 2.5L16 9" stroke="#FFFFFF" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
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
.commit-btn {
  background: #A8071A;
  width: 100%;
  height: 36px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
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
.toast { display: inline-flex; align-items: center; gap: 8px; padding: 8px 16px; background: #FFFFFF; border: 1px solid #E5E6EB; border-radius: 8px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12); font-size: 14px; font-weight: 500; color: #1D2129; white-space: nowrap; }
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
</style>
