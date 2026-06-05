<script setup>
import { bitable, FieldType, NumberFormatter } from "@lark-base-open/js-sdk";
import { ElNotification } from "element-plus";
import { ref, onMounted, watch } from "vue";
import request from '@/utils/request'

const props = defineProps({
  api_key: String,
})

const emit = defineEmits(['back']);

const formData = ref({
  radio: 1,
  table_id: "",
  profile_url: "",
  pages: 1,
});
const table_options = ref([]);
const loading = ref(false);
const profileProgress = ref({ text: "", done: false });
const timer = ref(null);
const listPageSize = 20;
const toastVisible = ref(false);
const toastText = ref('');
const toastLoading = ref(false);

const pages_options = [
  { value: 1, label: "获取第1页" },
  { value: 5, label: "获取前5页" },
  { value: 10, label: "获取前10页" },
  { value: 20, label: "获取前20页" },
  { value: 50, label: "获取前50页" },
];

const FIELD_MAPPING = [
  { key: 'series_id', name: '短剧ID', type: FieldType.Text },
  { key: 'title', name: '短剧名', type: FieldType.Text },
  { key: 'cover_url', name: '封面', type: FieldType.Text },
  { key: 'play_count', name: '播放数', type: FieldType.Number, formatter: NumberFormatter.INTEGER },
  { key: 'total_episode_count', name: '总集数', type: FieldType.Number, formatter: NumberFormatter.INTEGER },
  { key: 'updated_episode_count', name: '最新集数', type: FieldType.Number, formatter: NumberFormatter.INTEGER },
  { key: 'description', name: '剧情简介', type: FieldType.Text },
  { key: 'nickname', name: '作者名', type: FieldType.Text },
  { key: 'user_id', name: '作者ID', type: FieldType.Text },
  { key: 'social_type', name: '平台', type: FieldType.Text },
  { key: 'share_url', name: '短剧链接', type: FieldType.Text },
  { key: 'create_time', name: '发布时间', type: FieldType.DateTime, isTimestamp: true },
];

const getTableName = (list) => {
  const firstItem = list[0];
  return firstItem?.nickname ? `${firstItem.nickname}的短剧列表` : '主页短剧获取';
};

const resetParams = () => {
  loading.value = false;
  profileProgress.value = { text: "", done: false };
};

const showToast = (text, isLoading = true) => {
  toastText.value = text;
  toastLoading.value = isLoading;
  toastVisible.value = true;
};

const hideToast = () => {
  toastVisible.value = false;
};

const showErrorMsg = (message) => {
  ElNotification({ message, type: "error", duration: 0 });
};

const closeInterval = () => {
  if (timer.value) {
    clearInterval(timer.value);
    timer.value = null;
  }
};

const pollTaskStatus = (task_id, checkFn, onSuccess) => {
  let time = 0;
  closeInterval();
  timer.value = setInterval(() => {
    time += 3;
    if (time >= 600) {
      closeInterval();
      showErrorMsg("获取数据超时，请稍后重试");
      loading.value = false;
    } else {
      checkFn(task_id, onSuccess);
    }
  }, 2000);
};

const getFieldMetaMap = async (table) => {
  const fieldMetaList = await table.getFieldMetaList();
  return new Map(fieldMetaList.map(meta => [meta.name, meta.id]));
};

const setupTableFields = async (tableId, isNewTable = false) => {
  const table = await bitable.base.getTableById(tableId);
  const fieldMetaList = await table.getFieldMetaList();
  const fieldMetaMap = new Map(fieldMetaList.map(meta => [meta.name, meta.id]));

  const defaultFirstField = fieldMetaList[0];
  if (isNewTable && defaultFirstField && defaultFirstField.name === '文本') {
    await table.setField(defaultFirstField.id, {
      type: FIELD_MAPPING[0].type,
      name: FIELD_MAPPING[0].name
    });
    fieldMetaMap.set(FIELD_MAPPING[0].name, defaultFirstField.id);
  }

  for (let index = 0; index < FIELD_MAPPING.length; index++) {
    const config = FIELD_MAPPING[index];
    const fieldId = fieldMetaMap.get(config.name);
    if (fieldId) {
      const field = await table.getFieldById(fieldId);
      const fieldType = await field.getType();
      if (fieldType !== config.type) {
        throw new Error(`字段类型不匹配: ${config.name}`);
      }
      continue;
    }
    if (isNewTable && index === 0 && defaultFirstField && defaultFirstField.name === '文本') {
      continue;
    }
    if (isNewTable) {
      await table.addField({ type: config.type, name: config.name });
      continue;
    }
    throw new Error(`现有表格缺少字段: ${config.name}`);
  }
};

const validateTableFields = async (tableId) => {
  try {
    await setupTableFields(tableId);
    return true;
  } catch (error) {
    console.error("验证表格字段时出错:", error);
    showErrorMsg(error.message || "验证表格字段失败，请稍后重试");
    return false;
  }
};

const createSequentialTable = async (baseTableName) => {
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
      if (index > maxIndex) maxIndex = index;
    }
  });
  return await bitable.base.addTable({ name: `${baseTableName}${maxIndex + 1}` });
};

const normalizeValue = (value, config) => {
  if (config.isTimestamp && value) {
    return value * 1000;
  }
  if (value === undefined || value === null) {
    return "";
  }
  return value;
};

const writeDataToTable = async (table, list, isExistingTable = false, offset = 0, totalCount = list.length) => {
  const fieldMetaMap = await getFieldMetaMap(table);
  const fieldList = [];

  for (const config of FIELD_MAPPING) {
    const fieldId = fieldMetaMap.get(config.name);
    if (!fieldId) continue;
    const field = await table.getFieldById(fieldId);
    if (config.formatter && !isExistingTable) {
      await field.setFormatter(config.formatter);
    }
    fieldList.push({ field, config });
  }

  const records = [];
  for (const item of list) {
    const record = [];
    for (const { field, config } of fieldList) {
      record.push(await field.createCell(normalizeValue(item[config.key], config)));
    }
    records.push(record);
    showToast(`正在写入第 ${offset + records.length}/${totalCount} 条...`, true);
  }
  await table.addRecords(records);
};

const getSeriesTask = async (task_id, onSuccess) => {
  await request({
    url: "/social/api/v1/feishu/series/list?task_id=" + task_id,
    method: "get",
    headers: { 'authorization': `Bearer ${props.api_key}` },
  })
    .then(function (response) {
      const res = response.data;
      if (res.sta === 0) {
        const { status, current_page } = res.data;
        if (status === 1) {
          profileProgress.value = { text: current_page ? `已获取第${current_page}页` : '获取完成', done: true };
          closeInterval();
          onSuccess();
        } else if (status === 2) {
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

const getList = async (task_id, targetTableId = "", page = 1, writeTableId = "") => {
  await request({
    url: "/social/api/v1/feishu/post/list",
    method: "post",
    headers: { 'authorization': `Bearer ${props.api_key}` },
    data: { task_id, page, page_size: listPageSize },
  })
    .then(async function (response) {
      const res = response.data;
      if (res.sta === 0) {
        const { count, data } = res.data;
        if (!data || data.length === 0) {
          if (page === 1) {
            showErrorMsg("获取数据异常，请稍后重试");
            resetParams();
          }
          return;
        }

        const totalCount = Number(count) || data.length;
        let currentTableId = writeTableId || targetTableId;

        if (!currentTableId) {
          const tableName = '主页短剧获取';
          const { tableId } = await createSequentialTable(tableName);
          await setupTableFields(tableId, true);
          await bitable.ui.switchToTable(tableId);
          currentTableId = tableId;
        }

        const table = await bitable.base.getTableById(currentTableId);
        if (page === 1) {
          showToast(`准备处理 ${totalCount} 条数据...`, true);
        }
        await writeDataToTable(table, data, Boolean(targetTableId), (page - 1) * listPageSize, totalCount);

        if (page * listPageSize < totalCount) {
          await getList(task_id, targetTableId, page + 1, currentTableId);
          return;
        }

        showToast(`处理完成：成功 ${totalCount} 条，失败 0 条`, false);
        setTimeout(() => {
          hideToast();
        }, 3000);
        resetParams();
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

const getSeriesTaskInterval = (task_id, targetTableId = "") => {
  pollTaskStatus(task_id, getSeriesTask, () => {
    getList(task_id, targetTableId);
  });
};

const postSeriesTask = async (targetTableId = "") => {
  await request({
    url: "/social/api/v1/feishu/series/list",
    method: "post",
    headers: { 'authorization': `Bearer ${props.api_key}` },
    data: {
      profile_url: formData.value.profile_url,
      pages: Number(formData.value.pages),
    },
  })
    .then(function (response) {
      const res = response.data;
      if (res.sta === 0) {
        getSeriesTaskInterval(res.data.task_id, targetTableId);
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

const getSeriesData = async (targetTableId = "") => {
  loading.value = true;
  await postSeriesTask(targetTableId);
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
  const series_profile_url = await bitable.bridge.getData("series_profile_url");
  if (series_profile_url && typeof series_profile_url === "string") {
    formData.value.profile_url = series_profile_url;
  }
});

const commit = () => {
  if (!props.api_key) {
    showErrorMsg("请输入API key");
    return;
  }

  const { profile_url, radio, table_id } = formData.value;
  if (!profile_url || !profile_url.trim()) {
    showErrorMsg("请输入博主主页链接");
    return;
  }
  if (radio === 2 && !table_id) {
    showErrorMsg("请选择现有表格");
    return;
  }

  if (radio === 2) {
    validateTableFields(table_id).then(isValid => {
      if (isValid) getSeriesData(table_id);
    });
    return;
  }

  getSeriesData("");
  bitable.bridge.setData("series_profile_url", profile_url);
};
</script>

<template>
  <div class="sub-page">
    <div class="sub-page-header">
      <span class="sub-page-back" @click="emit('back')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16">
          <polyline points="15 18 9 12 15 6"></polyline>
        </svg>
      </span>
      <span class="sub-page-title">主页短剧获取</span>
    </div>
    <div class="form-card">
      <el-form ref="form" class="form" :model="formData" label-position="top">
        <el-form-item label="">
          <div class="field-stack">
            <div class="c-label">
              目标表格
              <el-tooltip effect="dark" placement="top">
                <template #content>新建表格或使用现有表格来保存数据</template>
                <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png" class="help-icon" />
              </el-tooltip>
            </div>
            <el-radio-group v-model="formData.radio" class="radio-block">
              <el-radio :value="1">新建表格</el-radio>
              <el-radio :value="2">使用现有表格</el-radio>
            </el-radio-group>
          </div>
        </el-form-item>
        <el-form-item v-if="formData.radio === 2" label="">
          <div class="c-label">选择现有表格</div>
          <el-select v-model="formData.table_id" placeholder="请选择" style="width: 100%">
            <el-option v-for="table in table_options" :key="table.id" :label="table.name" :value="table.id" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <div class="c-label">
            <span class="required">*</span>
            博主主页链接
            <el-tooltip effect="dark" placement="top">
              <template #content>仅支持抖音博主主页链接，<br />不支持其他链接</template>
              <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png" class="help-icon" />
            </el-tooltip>
          </div>
          <el-input
            v-model="formData.profile_url"
            type="textarea"
            :rows="4"
            class="c-input"
            placeholder="请输入正确的博主主页链接，支持批量添加，多个链接可换行或用逗号分隔"
          />
        </el-form-item>
        <el-form-item>
          <div class="c-label">
            数据提取范围
            <el-tooltip effect="dark" placement="top">
              <template #content>实际扣费会按照提取的页数进行计算</template>
              <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png" class="help-icon" />
            </el-tooltip>
          </div>
          <el-select v-model="formData.pages" placeholder="请选择" style="width: 100%">
            <el-option v-for="option in pages_options" :key="option.value" :label="option.label" :value="option.value" />
          </el-select>
        </el-form-item>
      </el-form>

      <el-button color="#a8071a" class="commit-btn" :loading="loading" @click="commit">提交</el-button>
      <div v-if="profileProgress.text" class="profile-progress" :class="{ 'profile-progress--done': profileProgress.done }">
        <span v-if="profileProgress.done" class="profile-progress-check">✓</span>
        {{ profileProgress.text }}
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
.field-stack {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  width: 100%;
}
.radio-block {
  margin-top: 8px;
  width: 100%;
}
.required {
  color: #A8071A;
  margin-right: 2px;
}
.help-icon {
  width: 16px;
  height: 16px;
  margin-left: 4px;
}

.toast-wrap {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 500;
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
.toast .toast-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.toast .toast-icon svg {
  width: 100%;
  height: 100%;
}
.toast-loading .toast-icon {
  animation: spin 0.8s linear infinite;
  color: #A8071A;
}
.toast-success .toast-icon {
  color: #00B42A;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
