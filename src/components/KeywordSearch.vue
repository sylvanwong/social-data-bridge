<script setup>
import { bitable } from "@lark-base-open/js-sdk";
import { ElNotification } from "element-plus";
import { ref, onMounted, onUnmounted, computed, watch } from "vue";
import request from '@/utils/request'
import { useSocialData, showErrorMsg } from '@/composables/useSocialData'

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
  filter_note_type: 0,
  filter_note_time: 0,
  publish_time: 0,
  filter_duration: 0,
  pages: 1,
});
const table_options = ref([]);

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
  { value: 2, label: "最多发布" },
];
const xhs_sort_type_options = [
  { value: 0, label: "综合" },
  { value: 1, label: "最多点赞" },
  { value: 2, label: "最新" },
  { value: 3, label: "最多评论" },
  { value: 4, label: "最多收藏" },
];
const filter_note_type_options = [
  { value: 0, label: "综合笔记" },
  { value: 1, label: "视频笔记" },
  { value: 2, label: "图文笔记" },
];
const time_options = [
  { value: 0, label: "不限" },
  { value: 1, label: "一天之内" },
  { value: 2, label: "一周之内" },
  { value: 3, label: "半年之内" },
];
const filter_duration_options = [
  { value: 0, label: "不限" },
  { value: 1, label: "1分钟以下" },
  { value: 2, label: "1-5分钟" },
  { value: 3, label: "5分钟以上" },
];

const isXhs = computed(() => formData1.value.social_type === 'xhs');
const isDouyin = computed(() => formData1.value.social_type === 'douyin');

const getTableName = () => formData1.value.keyword || '社媒数据助手';

const {
  loading,
  profileProgress,
  resetParams,
  pollTaskStatus,
  closeInterval,
  getList,
  createAndWriteData,
  validateTableFields,
} = useSocialData(getTableName, props.api_key);

const timer = ref(null);

const getSearchTask = async (task_id, onSuccess) => {
  await request({
    url: "/social/api/v1/feishu/keyword/task?task_id=" + task_id,
    method: "get",
    headers: { 'authorization': `Bearer ${props.api_key}` },
  })
    .then(function (response) {
      let res = response.data;
      if (res.sta == 0) {
        const { status, current_page } = res.data;
        if (status == 1) {
          profileProgress.value = { text: current_page ? `已获取第${current_page}页` : '获取完成', done: true };
          closeInterval();
          onSuccess();
        } else if (status == 2) {
          closeInterval();
          showErrorMsg("获取数据失败，请稍后重试");
          loading.value = false;
        } else {
          profileProgress.value = { text: current_page ? `已获取第${current_page}页` : '获取中', done: false };
        }
      }
    })
    .catch(function (error) {
      console.log(error);
    });
};

const getSearchTaskInterval = (task_id, targetTableId = "") => {
  pollTaskStatus(task_id, getSearchTask, () => {
    getList(task_id, "", targetTableId);
  });
};

const postSearchTask = async (targetTableId = "") => {
  let filter_config = {};
  if (formData1.value.social_type == 'xhs') {
    filter_config = {
      sort_type: formData1.value.sort_type,
      filter_note_type: formData1.value.filter_note_type,
      filter_note_time: formData1.value.filter_note_time,
    }
  } else if (formData1.value.social_type == 'douyin') {
    filter_config = {
      sort_type: formData1.value.sort_type,
      publish_time: formData1.value.publish_time,
      filter_duration: formData1.value.filter_duration,
    }
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
        getSearchTaskInterval(data.task_id, targetTableId);
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
  if (radio === 2 && !table_id) {
    showErrorMsg("请选择现有表格");
    return;
  }

  if (radio === 2) {
    validateTableFields(table_id).then(isValid => {
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
        <el-form-item label="">
          <div slot="label" class="c-label">
            排序方式
            <el-tooltip effect="dark" placement="top">
              <template #content>排序方式</template>
              <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png"
                class="help-icon" />
            </el-tooltip>
          </div>
          <el-select v-model="formData1.sort_type" placeholder="请选择" style="width: 100%">
            <el-option v-if="isDouyin" v-for="tl in douyin_sort_type_options" :key="tl.value" :label="tl.label"
              :value="tl.value" />
            <el-option v-if="isXhs" v-for="tl in xhs_sort_type_options" :key="tl.value" :label="tl.label"
              :value="tl.value" />
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
            <el-option v-for="tl in time_options" :key="tl.value" :label="tl.label" :value="tl.value" />
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
            <el-option v-for="tl in time_options" :key="tl.value" :label="tl.label" :value="tl.value" />
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
            <el-option v-for="tl in filter_duration_options" :key="tl.value" :label="tl.label" :value="tl.value" />
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
      </el-form>

      <el-button color="#a8071a" class="commit-btn" :loading="loading" @click="commit">提交</el-button>
      <div v-if="profileProgress.text" class="profile-progress" :class="{ 'profile-progress--done': profileProgress.done }">
        <span v-if="profileProgress.done" class="profile-progress-check">✓</span>
        {{ profileProgress.text }}
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
</style>
