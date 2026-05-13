<script setup>
import { bitable, FieldType, NumberFormatter } from "@lark-base-open/js-sdk";
import { ElMessage, ElNotification } from "element-plus";
import { ref, onMounted, onUnmounted, watch } from "vue";
import request from '@/utils/request'

const props = defineProps({
  api_key: String,
})

let note_timer = null;
const formData = ref({
  radio: 1,
  url: "",
  pages: 1,
  reply_pages: -1,
  table_id: "",
});
const table_options = ref([]);
const loading = ref(false);
const profileProgress = ref({ text: "", done: false });
let page = 1;
const page_size = 20;
let total = 0;

const EXISTING_TABLE_REQUIRED_FIELD = "评论ID";
const FIELD_CONFIG = [
  { name: "评论ID", type: FieldType.Text, getValue: (item) => item?.cid ?? "" },
  { name: "上级评论ID", type: FieldType.Text, getValue: (item) => item?.reply_id ?? "" },
  { name: "作品ID", type: FieldType.Text, getValue: (item) => item?.note_id ?? "" },
  { name: "评论内容", type: FieldType.Text, getValue: (item) => item?.text ?? "" },
  { name: "作者名称", type: FieldType.Text, getValue: (item) => item?.nickname ?? "" },
  { name: "作者ID", type: FieldType.Text, getValue: (item) => item?.uid ?? "" },
  { name: "小红书ID", type: FieldType.Text, getValue: (item) => item?.social_user_number ?? "" },
  { name: "点赞数", type: FieldType.Number, formatter: NumberFormatter.INTEGER, getValue: (item) => Number(item?.digg_count) || 0 },
  { name: "回复数", type: FieldType.Number, formatter: NumberFormatter.INTEGER, getValue: (item) => Number(item?.reply_comment_total) || 0 },
  { name: "评论时间", type: FieldType.DateTime, getValue: (item) => (item?.t_create ? item.t_create * 1000 : "") },
];
const FIELD_TYPE_NAME = {
  [FieldType.Text]: 'Text',
  [FieldType.Number]: 'Number',
  [FieldType.DateTime]: 'DateTime',
  [FieldType.Url]: 'Url',
  [FieldType.Attachment]: 'Attachment',
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

const showErrorMsg = (message) => {
  ElMessage({ message, type: "error", plain: true });
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
  const note_url = await bitable.bridge.getData("note_url");
  if (note_url && typeof note_url == "string") {
    formData.value.url = note_url;
  }
});

onUnmounted(() => {
  closeNoteInterval();
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

const createAndWriteData = async (list, type, task_id, targetTableId = "") => {
  if (!list || list.length == 0) {
    ElMessage({ message: list ? "获取数据为空" : "获取数据异常，请稍后重试", type: "warning", plain: true });
    resetParams();
    return;
  }
  try {
    const fields = FIELD_CONFIG.map(({ name, type, formatter }) => formatter ? { name, type, formatter } : { name, type });

    if (!type && !targetTableId) {
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
    }

    const activeTable = targetTableId
      ? await bitable.base.getTableById(targetTableId)
      : await bitable.base.getActiveTable();

    if (targetTableId) {
      const existingFieldMap = new Map();
      for (const config of FIELD_CONFIG) {
        try {
          const field = await activeTable.getField(config.name);
          if (field) existingFieldMap.set(config.name, field);
        } catch (error) {
          console.warn(`现有表格缺少字段：${config.name}`);
        }
      }
      if (!existingFieldMap.has(EXISTING_TABLE_REQUIRED_FIELD)) {
        ElNotification({ title: '出错', message: `主字段"评论ID"不存在于现有表格中，无法写入数据。请确保表格中包含该字段。`, type: 'error', duration: 0 });
        resetParams();
        return;
      }
      const availableMappings = FIELD_CONFIG.filter(config => existingFieldMap.has(config.name));
      if (availableMappings.length === 0) {
        showErrorMsg("所选表格没有可写入字段");
        resetParams();
        return;
      }
      const records = [];
      for (const item of list) {
        const record = [];
        for (const config of availableMappings) {
          const field = existingFieldMap.get(config.name);
          record.push(await field.createCell(config.getValue(item)));
        }
        records.push(record);
      }
      await activeTable.addRecords(records);
      if (total > page) {
        page += 1;
        getList(task_id, 'next', targetTableId);
      } else {
        resetParams();
      }
      return;
    }

    const fieldList = [];
    for (const config of fields) {
      const field = await activeTable.getField(config.name);
      fieldList.push(field);
    }
    let records = [];
    for (const item of list) {
      let record = [];
      for (let i = 0; i < fields.length; i++) {
        const mapping = FIELD_CONFIG[i];
        record.push(await fieldList[i].createCell(mapping.getValue(item)));
      }
      records.push(record);
    }
    await activeTable.addRecords(records);
    if (total > page) {
      page += 1;
      getList(task_id, 'next', targetTableId);
    } else {
      resetParams();
    }
  } catch (error) {
    console.error("🚀 ~ createAndWriteData ~ error:", error)
    resetParams();
  }
};

const getNoteTaskInterval = (task_id, targetTableId = "") => {
  let time = 0;
  closeNoteInterval();
  note_timer = setInterval(() => {
    time += 3;
    if (time >= 600) {
      closeNoteInterval();
      showErrorMsg("获取数据超时，请稍后重试");
      loading.value = false;
    } else {
      getNoteTask(task_id, targetTableId);
    }
  }, 3000);
};

const getNoteTask = async (task_id, targetTableId = "") => {
  await request({
    url: "/social/api/v1/feishu/comment/task?task_id=" + task_id,
    method: "get",
    headers: { 'authorization': `Bearer ${props.api_key}` },
  })
    .then(function (response) {
      let res = response.data;
      if (res.sta == 0) {
        const { status, current_page } = res.data;
        if (status == 1) {
          profileProgress.value = { text: current_page ? `已获取第${current_page}页` : '获取完成', done: true };
          closeNoteInterval();
          page = 1;
          getList(task_id, "", targetTableId);
        } else if (status == 2) {
          closeNoteInterval();
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

const getList = async (task_id, type, targetTableId = "") => {
  await request({
    url: "/social/api/v1/feishu/comment/list",
    method: "post",
    headers: { 'authorization': `Bearer ${props.api_key}` },
    data: { task_id, page, page_size },
  })
    .then(function (response) {
      let res = response.data;
      if (res.sta == 0) {
        const { count, data } = res.data;
        if (!type) {
          total = Math.ceil(count / page_size);
          createAndWriteData(data, '', task_id, targetTableId);
        } else if (type == 'next') {
          createAndWriteData(data, type, task_id, targetTableId);
        }
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

const postNoteTask = async (targetTableId = "") => {
  await request({
    url: "/social/api/v1/feishu/comment/task",
    method: "post",
    headers: { 'authorization': `Bearer ${props.api_key}` },
    data: {
      url: formData.value.url,
      pages: Number(formData.value.pages),
      reply_pages: Number(formData.value.reply_pages),
    },
  })
    .then(function (response) {
      let res = response.data;
      if (res.sta == 0) {
        const data = res.data;
        getNoteTaskInterval(data.task_id, targetTableId);
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

const getNoteData = async (targetTableId = "") => {
  loading.value = true;
  await postNoteTask(targetTableId);
};

const validateTableFields = async (tableId) => {
  try {
    const activeTable = await bitable.base.getTableById(tableId);
    const fieldMetaList = await activeTable.getFieldMetaList();
    const fieldIdByName = new Map(fieldMetaList.map(meta => [meta.name, meta.id]));
    if (!fieldIdByName.has(EXISTING_TABLE_REQUIRED_FIELD)) {
      ElNotification({ title: '出错', message: `主字段"评论ID"不存在于现有表格中，无法写入数据。请确保表格中包含该字段。`, type: 'error', duration: 0 });
      return false;
    }
    for (const config of FIELD_CONFIG) {
      const fieldId = fieldIdByName.get(config.name);
      if (!fieldId) continue;
      const fieldMeta = fieldMetaList.find(meta => meta.id === fieldId);
      if (config.type && fieldMeta.type !== config.type) {
        ElNotification({ title: '出错', message: `字段类型不匹配:字段"${config.name}" 的类型是 ${FIELD_TYPE_NAME[fieldMeta.type] || fieldMeta.type}，但Schema定义为 ${FIELD_TYPE_NAME[config.type] || config.type}，无法写入数据`, type: 'error', duration: 0 });
        return false;
      }
    }
    const availableMappings = FIELD_CONFIG.filter(config => fieldIdByName.has(config.name));
    if (availableMappings.length === 0) {
      showErrorMsg("所选表格没有可写入字段");
      return false;
    }
    return true;
  } catch (error) {
    console.error("验证表格字段时出错:", error);
    showErrorMsg("验证表格字段失败，请稍后重试");
    return false;
  }
};

const commit = () => {
  if (loading.value) return;
  if (!props.api_key) {
    showErrorMsg("请输入API key");
    return;
  }
  const { url, radio, table_id } = formData.value;
  if (!url || !url.trim()) {
    showErrorMsg("请输入帖子链接");
    return;
  }
  if (radio === 2 && !table_id) {
    showErrorMsg("请选择现有表格");
    return;
  }
  if (radio === 2) {
    validateTableFields(table_id).then(isValid => {
      if (isValid) getNoteData(table_id);
    }).catch(error => {
      console.error("验证表格字段时出错:", error);
      showErrorMsg("验证表格字段失败，请稍后重试");
    });
    return;
  }
  getNoteData();
  bitable.bridge.setData("note_url", formData.value.url);
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
      <span class="sub-page-title">评论列表获取</span>
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
            帖子链接
            <el-tooltip effect="dark" placement="top">
              <template #content>帖子链接</template>
              <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png"
                class="help-icon" />
            </el-tooltip>
          </div>
          <el-input v-model="formData.url" class="c-input" placeholder="请输入" />
        </el-form-item>
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
