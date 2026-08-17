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
});
const table_options = ref([]);
const FIELD_SELECTION_STORAGE_KEY = 'keyword_search_selected_fields_v1';
const STREAM_TASK_STORAGE_KEY = 'keyword_search_stream_task_v1';
const selectedFieldKeys = ref([]);
const fieldSelectionReady = ref(false);
const toastVisible = ref(false);
const toastText = ref('');
const toastLoading = ref(false);
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

const getTableName = () => formData1.value.keyword || '社媒数据助手';

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
      pages: Number(formData1.value.pages),
      filter_config,
    },
  })
    .then(function (response) {
      let res = response.data;
      if (res.sta == 0) {
        const data = res.data;
        keywordStreamTask.start({ taskId: data.task_id, targetTableId, selectedFieldKeys: [...selectedFieldKeys.value] });
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

const getSearchData = async (targetTableId = "") => {
  loading.value = true;
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

watch(
  () => formData1.value.radio,
  (radio) => {
    if (radio === 2) loadTableOptions();
  }
);

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
  if (!social_type || !social_type.trim()) {
    showErrorMsg("请选择平台");
    return;
  }
  if (!keyword || !keyword.trim()) {
    showErrorMsg("请输入关键词");
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
    validateTableFields(table_id, selectedFieldKeys.value, KEYWORD_SEARCH_FIELD_MAPPING).then(isValid => {
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
        <el-form-item label="" style="margin-top: 12px">
          <el-radio-group v-model="formData1.radio">
            <el-radio :value="1">新建表格</el-radio>
            <el-radio :value="2">使用现有表格</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="formData1.radio === 2" label="">
          <div slot="label" class="c-label">选择现有表格</div>
          <el-select v-model="formData1.table_id" placeholder="请选择" style="width: 100%">
            <el-option v-for="tl in table_options" :key="tl.id" :label="tl.name" :value="tl.id" />
          </el-select>
        </el-form-item>
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
          <el-input v-model="formData1.keyword" class="c-input" placeholder="请输入" />
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
            数据提取范围
            <el-tooltip effect="dark" placement="top">
              <template #content>每页 10 积分，实际扣费会按照<br />提取的页数进行计算</template>
              <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png"
                class="help-icon" />
            </el-tooltip>
          </div>
          <el-select v-model="formData1.pages" placeholder="请选择" style="width: 100%">
            <el-option v-for="tl in (isXhs ? xhs_pages_options : pages_options)" :key="tl.value" :label="tl.label"
              :value="tl.value" />
          </el-select>
        </el-form-item>

        <el-form-item label="" style="margin-top: 12px">
          <div slot="label" class="c-label">选择需要的字段</div>
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
        </el-form-item>
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
