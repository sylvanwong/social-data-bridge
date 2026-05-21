<script setup>
import { bitable, FieldType, NumberFormatter } from "@lark-base-open/js-sdk";
import { ref, onMounted, watch } from "vue";
import { ElNotification } from "element-plus";
import request from '@/utils/request'
import { fetchPlatformConfigOptions } from '@/utils/platformConfig'

const EXISTING_TABLE_REQUIRED_FIELD = "排名";
const FIELD_MAPPING = [
  { key: 'rank', name: '排名', type: FieldType.Number, formatter: NumberFormatter.INTEGER },
  { key: 'keyword', name: '热搜标题', type: FieldType.Text },
  { key: 'hot_value', name: '热度值', type: FieldType.Number, formatter: NumberFormatter.INTEGER },
  { key: 'tag', name: '标签', type: FieldType.Text },
];

const props = defineProps({
  api_key: String,
  config_name: {
    type: String,
    default: 'feishu_hot_type',
  },
})

const emit = defineEmits(['back']);

const formData = ref({
  radio: 1,
  table_id: "",
  platform: "",
});
const platformOptions = ref([]);
const table_options = ref([]);
const loading = ref(false);
const toastVisible = ref(false);
const toastText = ref('');
const toastLoading = ref(false);

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

const loadPlatformOptions = async () => {
  if (!props.api_key) {
    platformOptions.value = [];
    formData.value.platform = "";
    return;
  }

  try {
    const options = await fetchPlatformConfigOptions(props.api_key, props.config_name, []);
    platformOptions.value = options;
    if (!options.some(option => option.value === formData.value.platform)) {
      formData.value.platform = options[0]?.value || "";
    }
  } catch (error) {
    console.error("获取平台配置失败:", error);
    platformOptions.value = [];
    formData.value.platform = "";
    showErrorMsg("获取平台配置失败，请稍后重试");
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

const normalizeValue = (value) => {
  if (value === undefined || value === null) {
    return "";
  }
  return value;
};

const extractList = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.hot_items)) return payload.hot_items;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.list)) return payload.list;
  if (Array.isArray(payload?.value)) return payload.value;
  if (Array.isArray(payload?.records)) return payload.records;
  return [];
};

const writeDataToTable = async (table, list, isExistingTable = false) => {
  const fieldMetaList = await table.getFieldMetaList();
  const fieldMetaMap = new Map(fieldMetaList.map(meta => [meta.name, meta.id]));
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

  if (!fieldMetaMap.has(EXISTING_TABLE_REQUIRED_FIELD)) {
    throw new Error(`主字段"${EXISTING_TABLE_REQUIRED_FIELD}"不存在于现有表格中，无法写入数据。`);
  }

  if (fieldList.length === 0) {
    throw new Error("所选表格没有可写入字段");
  }

  const records = [];
  for (const item of list) {
    const record = [];
    for (const { field, config } of fieldList) {
      record.push(await field.createCell(normalizeValue(item[config.key])));
    }
    records.push(record);
    showToast(`正在写入第 ${records.length}/${list.length} 条...`, true);
  }
  await table.addRecords(records);
};

const submit = async (targetTableId = "") => {
  if (!props.api_key) {
    showErrorMsg("请输入API key");
    return;
  }
  if (!formData.value.platform) {
    showErrorMsg("请选择平台");
    return;
  }

  loading.value = true;
  showToast("正在获取热榜数据...", true);

  try {
    const response = await request({
      url: "/social/api/v1/feishu/hot/list",
      method: "get",
      headers: { authorization: `Bearer ${props.api_key}` },
      params: {
        social_type: formData.value.platform,
      },
    });
    const res = response.data;
    if (res.sta !== 0) {
      throw new Error(res.msg || "获取热榜数据失败，请稍后重试");
    }

    const list = extractList(res.data);
    if (!list.length) {
      throw new Error("未获取到热榜数据");
    }

    let currentTableId = targetTableId;
    if (!currentTableId) {
      const tableName = '热榜获取';
      const { tableId } = await createSequentialTable(tableName);
      await setupTableFields(tableId, true);
      await bitable.ui.switchToTable(tableId);
      currentTableId = tableId;
    }

    const table = await bitable.base.getTableById(currentTableId);
    await writeDataToTable(table, list, Boolean(targetTableId));

    showToast(`处理完成：成功 ${list.length} 条，失败 0 条`, false);
    setTimeout(() => {
      hideToast();
    }, 3000);
  } catch (error) {
    console.error("提交热榜获取失败:", error);
    hideToast();
    showErrorMsg(error?.message || "提交失败，请稍后重试");
  } finally {
    loading.value = false;
  }
};

const commit = () => {
  if (formData.value.radio === 2) {
    if (!formData.value.table_id) {
      showErrorMsg("请选择现有表格");
      return;
    }
    validateTableFields(formData.value.table_id).then((isValid) => {
      if (isValid) submit(formData.value.table_id);
    });
    return;
  }

  submit("");
};

onMounted(async () => {
  await loadPlatformOptions();
});
</script>

<template>
  <div class="sub-page">
    <div class="sub-page-header">
      <span class="sub-page-back" @click="emit('back')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16">
          <polyline points="15 18 9 12 15 6"></polyline>
        </svg>
      </span>
      <span class="sub-page-title">热榜获取</span>
    </div>
    <div class="form-card">
      <el-form class="form" :model="formData" label-position="top">
        <el-form-item label="">
          <div class="field-stack">
            <div class="c-label">目标表格</div>
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
            平台
          </div>
          <el-select v-model="formData.platform" placeholder="请选择" style="width: 100%">
            <el-option v-for="option in platformOptions" :key="option.value" :label="option.label" :value="option.value" />
          </el-select>
        </el-form-item>
      </el-form>

      <el-button color="#a8071a" class="commit-btn" :loading="loading" @click="commit">提交</el-button>
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
.field-stack {
  width: 100%;
}
.c-label {
  font-size: 14px;
  font-weight: 500;
  color: #1D2129;
  margin-bottom: 8px;
}
.radio-block {
  width: 100%;
}
.required {
  color: #F53F3F;
  margin-right: 4px;
}
.commit-btn {
  width: 100%;
  margin-top: 8px;
  height: 40px;
  font-size: 15px;
  font-weight: 600;
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
.toast-icon {
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
