<script setup>
import { bitable } from "@lark-base-open/js-sdk";
import { ElNotification } from "element-plus";
import { ref, onMounted, onUnmounted, watch } from "vue";
import request from '@/utils/request'
import { useSocialData, showErrorMsg } from '@/composables/useSocialData'

const props = defineProps({
  api_key: String,
})

const formData = ref({ radio: 1, url: "", pages: 1, table_id: "" });
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

const getTableName = (list) => {
  const firstItem = list[0];
  return firstItem?.nickname || '社媒数据助手';
};

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

const getProfileTask = async (task_id, onSuccess) => {
  await request({
    url: "/social/api/v1/feishu/social/task?task_id=" + task_id,
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

const getProfileTaskInterval = (task_id, targetTableId = "") => {
  pollTaskStatus(task_id, getProfileTask, () => {
    getList(task_id, "", targetTableId);
  });
};

const postProfileTask = async (targetTableId = "") => {
  await request({
    url: "/social/api/v1/feishu/social/task",
    method: "post",
    headers: { 'authorization': `Bearer ${props.api_key}` },
    data: {
      url: formData.value.url,
      pages: Number(formData.value.pages),
    },
  })
    .then(function (response) {
      let res = response.data;
      if (res.sta == 0) {
        const data = res.data;
        getProfileTaskInterval(data.task_id, targetTableId);
      } else {
        loading.value = false;
        ElNotification({ title: '错误', message: res.msg, type: 'error', duration: 0 });
      }
    })
    .catch(function (error) {
      loading.value = false;
      console.log(error);
      showErrorMsg(error);
    });
};

const getProfileData = async (targetTableId = "") => {
  loading.value = true;
  await postProfileTask(targetTableId);
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
  () => formData.value.radio,
  (radio) => {
    if (radio === 2) loadTableOptions();
  }
);

onMounted(async () => {
  const profile_url = await bitable.bridge.getData("profile_url");
  if (profile_url && typeof profile_url == "string") {
    formData.value.url = profile_url;
  }
});

const commit = () => {
  if (!props.api_key) {
    showErrorMsg("请输入API key");
    return;
  }
  const { url, radio, table_id } = formData.value;
  if (!url || !url.trim()) {
    showErrorMsg("请输入博主主页链接");
    return;
  }
  if (radio === 2 && !table_id) {
    showErrorMsg("请选择现有表格");
    return;
  }

  if (radio === 2) {
    validateTableFields(table_id).then(isValid => {
      if (isValid) getProfileData(table_id);
    }).catch(error => {
      console.error("验证表格字段时出错:", error);
      showErrorMsg("验证表格字段失败，请稍后重试");
    });
    return;
  }

  getProfileData("");
  bitable.bridge.setData("profile_url", formData.value.url);
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
      <span class="sub-page-title">主页批量获取</span>
    </div>
    <div class="form-card">
      <el-form ref="form" class="form" :model="formData" label-position="top">
        <el-form-item label="" style="margin-top: 12px">
          <el-radio-group v-model="formData.radio">
            <el-radio :value="1">新建表格</el-radio>
            <el-radio :value="2">使用现有表格</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="formData.radio === 2" label="">
          <div slot="label" class="c-label">选择现有表格</div>
          <el-select v-model="formData.table_id" placeholder="请选择" style="width: 100%">
            <el-option v-for="tl in table_options" :key="tl.id" :label="tl.name" :value="tl.id" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <div slot="label" class="c-label">
            博主主页链接
            <el-tooltip effect="dark" placement="top">
              <template #content>仅支持博主主页链接，<br />不支持其他链接</template>
              <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png"
                class="help-icon" />
            </el-tooltip>
          </div>
          <el-input v-model="formData.url" type="textarea" :rows="4" class="c-input" placeholder="请输入正确博主笔记链接（换行或逗号分隔）" />
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
          <el-select v-model="formData.pages" placeholder="请选择" style="width: 100%">
            <el-option v-for="tl in pages_options" :key="tl.value" :label="tl.label" :value="tl.value" />
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
