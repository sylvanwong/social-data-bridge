<script setup>
import { bitable, DateFormatter, FieldType, NumberFormatter } from "@lark-base-open/js-sdk";
import { ElNotification } from "element-plus";
import { ref, onMounted, watch } from "vue";
import request from '@/utils/request'

const props = defineProps({
  api_key: String,
})

const emit = defineEmits(['back']);

const formData = ref({
  mode: 'table',
  radio: 1,
  table_id: "",
  manualUrls: "",
  profileLinkFieldId: '',
  scope: 'n',
  rowCount: 5,
  pages: 1,
});
const table_options = ref([]);
const fieldOptions = ref([]);
const loading = ref(false);
const profileProgress = ref({ text: "", done: false });
const timer = ref(null);
const listPageSize = 20;
const toastVisible = ref(false);
const toastText = ref('');
const toastLoading = ref(false);
const FIELD_SELECTION_STORAGE_KEY = 'series_fetch_selected_fields_v1';
const selectedFieldKeys = ref([]);
const fieldSelectionReady = ref(false);

const pages_options = [
  { value: 1, label: "获取第1页" },
  { value: 5, label: "获取前5页" },
  { value: 10, label: "获取前10页" },
  { value: 20, label: "获取前20页" },
  { value: 50, label: "获取前50页" },
];

const scopeOptions = [
  { value: 'all', label: '执行所有行' },
  { value: 'selected', label: '执行选中行' },
  { value: 'n', label: '执行前N行' },
];

const FIELD_MAPPING = [
  { key: 'series_id', name: '短剧ID', type: FieldType.Text, defaultSelected: true, required: true },
  { key: 'title', name: '短剧名', type: FieldType.Text, defaultSelected: true },
  { key: 'cover_url', name: '封面', type: FieldType.Text, defaultSelected: true },
  { key: 'play_count', name: '播放数', type: FieldType.Number, defaultSelected: true, formatter: NumberFormatter.INTEGER },
  { key: 'total_episode_count', name: '总集数', type: FieldType.Number, defaultSelected: true, formatter: NumberFormatter.INTEGER },
  { key: 'updated_episode_count', name: '最新集数', type: FieldType.Number, defaultSelected: true, formatter: NumberFormatter.INTEGER },
  { key: 'description', name: '剧情简介', type: FieldType.Text, defaultSelected: true },
  { key: 'nickname', name: '作者名', type: FieldType.Text, defaultSelected: true },
  { key: 'user_id', name: '作者ID', type: FieldType.Text, defaultSelected: true },
  { key: 'social_type', name: '平台', type: FieldType.Text, defaultSelected: true },
  { key: 'share_url', name: '短剧链接', type: FieldType.Text, defaultSelected: true },
  { key: 'create_time', name: '发布时间', type: FieldType.DateTime, defaultSelected: true, isTimestamp: true, dateFormat: DateFormatter.DATE_TIME },
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
  if (config.key === 'nickname' || config.key === 'social_type') {
    return [FieldType.Text, FieldType.SingleSelect];
  }
  return [config.type];
};

const isFieldTypeCompatible = (fieldType, config) => {
  return getAllowedFieldTypes(config).includes(fieldType);
};

const getExpectedFieldTypeName = (config) => {
  return getAllowedFieldTypes(config)
    .map(type => FIELD_TYPE_NAME[type] || type)
    .join(' / ');
};

const getTableName = (list) => {
  const firstItem = list[0];
  return firstItem?.nickname ? `${firstItem.nickname}的短剧列表` : '博主短剧获取';
};

const getDefaultSelectedFieldKeys = () => FIELD_MAPPING
  .filter(field => field.defaultSelected || field.required)
  .map(field => field.key);

const getActiveFieldMapping = () => {
  const selectedKeySet = new Set(selectedFieldKeys.value);
  return FIELD_MAPPING.filter(field => field.required || selectedKeySet.has(field.key));
};

const loadSelectedFieldKeys = async () => {
  const defaultKeys = getDefaultSelectedFieldKeys();

  try {
    const savedValue = await bitable.bridge.getData(FIELD_SELECTION_STORAGE_KEY);

    if (!Array.isArray(savedValue)) {
      selectedFieldKeys.value = defaultKeys;
      return;
    }

    const validKeys = savedValue.filter(key => FIELD_MAPPING.some(field => field.key === key));
    const requiredKeys = FIELD_MAPPING.filter(field => field.required).map(field => field.key);
    const mergedKeys = Array.from(new Set([...validKeys, ...requiredKeys]));
    selectedFieldKeys.value = mergedKeys.length > 0 ? mergedKeys : defaultKeys;
  } catch (error) {
    console.error('读取字段勾选状态失败:', error);
    selectedFieldKeys.value = defaultKeys;
  }
};

const saveSelectedFieldKeys = async (keys) => {
  try {
    const requiredKeys = FIELD_MAPPING.filter(field => field.required).map(field => field.key);
    const nextKeys = Array.from(new Set([...keys, ...requiredKeys]));
    await bitable.bridge.setData(FIELD_SELECTION_STORAGE_KEY, [...nextKeys]);
  } catch (error) {
    console.error('保存字段勾选状态失败:', error);
  }
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
  const activeFieldMapping = getActiveFieldMapping();
  const table = await bitable.base.getTableById(tableId);
  const fieldMetaList = await table.getFieldMetaList();
  const fieldMetaMap = new Map(fieldMetaList.map(meta => [meta.name, meta.id]));
  const missingFields = [];

  const defaultFirstField = fieldMetaList[0];
  if (isNewTable && defaultFirstField && defaultFirstField.name === '文本') {
    await table.setField(defaultFirstField.id, {
      type: activeFieldMapping[0].type,
      name: activeFieldMapping[0].name
    });
    fieldMetaMap.set(activeFieldMapping[0].name, defaultFirstField.id);
  }

  for (let index = 0; index < activeFieldMapping.length; index++) {
    const config = activeFieldMapping[index];
    const fieldId = fieldMetaMap.get(config.name);
    if (fieldId) {
      const field = await table.getFieldById(fieldId);
      const fieldType = await field.getType();
      if (!isFieldTypeCompatible(fieldType, config)) {
        throw new Error(`字段类型不匹配: ${config.name}，仅支持${getExpectedFieldTypeName(config)}`);
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
    missingFields.push(config);
  }

  for (const config of missingFields) {
    try {
      await table.addField({ type: config.type, name: config.name });
    } catch (error) {
      ElNotification({ message: `添加字段 "${config.name}" 失败`, type: 'error', duration: 0 });
      throw error;
    }
  }

  if (!isNewTable && missingFields.length > 0) {
    ElNotification({ message: `已自动添加 ${missingFields.length} 个字段`, type: 'success' });
  }

  const latestFieldMetaList = await table.getFieldMetaList();
  const latestFieldMetaMap = new Map(latestFieldMetaList.map(meta => [meta.name, meta.id]));
  for (const config of activeFieldMapping) {
    const fieldId = latestFieldMetaMap.get(config.name);
    if (!fieldId) continue;
    try {
      const field = await table.getFieldById(fieldId);
      if (config.formatter) {
        await field.setFormatter(config.formatter);
      }
      if (config.dateFormat) {
        await field.setDateFormat(config.dateFormat);
      }
    } catch (error) {
      console.error(`设置字段 ${config.name} 格式失败:`, error);
    }
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

const normalizeValue = (value, config, fieldType) => {
  if (config.isTimestamp && value) {
    return value * 1000;
  }
  if ((config.key === 'nickname' || config.key === 'social_type') && fieldType === FieldType.SingleSelect) {
    return value ? value : null;
  }
  if ((config.key === 'nickname' || config.key === 'social_type') && value && typeof value === 'string') {
    return value;
  }
  if ((config.key === 'nickname' || config.key === 'social_type') && value !== undefined && value !== null) {
    return value;
  }
  if (value === undefined || value === null) {
    return null;
  }
  return value;
};

const writeDataToTable = async (table, list, isExistingTable = false, offset = 0, totalCount = list.length) => {
  const fieldMetaMap = await getFieldMetaMap(table);
  const fieldList = [];
  const activeFieldMapping = getActiveFieldMapping();

  for (const config of activeFieldMapping) {
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
      const fieldType = await field.getType();
      record.push(await field.createCell(normalizeValue(item[config.key], config, fieldType)));
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
          const tableName = '博主短剧获取';
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

const postSeriesTask = async (targetTableId = "", profileUrlText = "") => {
  await request({
    url: "/social/api/v1/feishu/series/list",
    method: "post",
    headers: { 'authorization': `Bearer ${props.api_key}` },
    data: {
      profile_url: profileUrlText,
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

const submitSeriesUrls = async (urlList, targetTableId = "") => {
  if (urlList.length === 0) {
    showErrorMsg("请至少输入一个有效的博主主页链接");
    return;
  }

  loading.value = true;
  const profileUrlText = urlList.join('\n');
  await postSeriesTask(targetTableId, profileUrlText);
};

watch(
  () => formData.value.radio,
  (radio) => {
    if (radio === 2) loadTableOptions();
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

onMounted(async () => {
  await loadFieldOptions({ silent: true });
  await loadSelectedFieldKeys();
  fieldSelectionReady.value = true;
});

const commit = async () => {
  if (!props.api_key) {
    showErrorMsg("请输入API key");
    return;
  }

  const { radio, table_id, mode, profileLinkFieldId, scope, rowCount, manualUrls } = formData.value;
  if (radio === 2 && !table_id) {
    showErrorMsg("请选择现有表格");
    return;
  }

  let urlList = [];
  if (mode === 'manual') {
    if (!manualUrls || !manualUrls.trim()) {
      showErrorMsg("请输入博主主页链接");
      return;
    }
    urlList = parseManualUrls(manualUrls);
  } else {
    if (!profileLinkFieldId) {
      showErrorMsg("请选择博主主页链接字段");
      return;
    }
    if (profileLinkFieldId === 'nodata') {
      showErrorMsg("未在数据表页面，无法读取字段信息。请先打开目标数据表，再重试操作。");
      return;
    }
    const recordIdList = await getRecordIdListByScope(scope, rowCount);
    if (!recordIdList) {
      return;
    }
    urlList = await getProfileUrlsByFieldId(recordIdList, profileLinkFieldId);
  }

  if (radio === 2) {
    validateTableFields(table_id).then(async isValid => {
      if (isValid) {
        await submitSeriesUrls(urlList, table_id);
      }
    });
    return;
  }

  await submitSeriesUrls(urlList, "");
};

watch(selectedFieldKeys, (keys) => {
  if (!fieldSelectionReady.value) {
    return;
  }

  const requiredKeys = FIELD_MAPPING.filter(field => field.required).map(field => field.key);
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
      <span class="sub-page-back" @click="emit('back')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16">
          <polyline points="15 18 9 12 15 6"></polyline>
        </svg>
      </span>
      <span class="sub-page-title">博主短剧获取</span>
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

        <template v-if="formData.mode === 'table'">
          <el-form-item>
            <div class="c-label">
              <span class="required">*</span>
              博主主页链接
              <el-tooltip effect="dark" placement="top">
                <template #content>仅支持抖音博主主页链接，<br />不支持其他链接</template>
                <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png" class="help-icon" />
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

          <el-form-item>
            <div class="c-label">
              数据范围
              <el-tooltip effect="dark" placement="top">
                <template #content>选择要执行的数据范围</template>
                <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png" class="help-icon" />
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
            <div class="c-label">
              <span class="required">*</span>
              博主主页链接
              <el-tooltip effect="dark" placement="top">
                <template #content>仅支持抖音博主主页链接，<br />不支持其他链接</template>
                <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png" class="help-icon" />
              </el-tooltip>
            </div>
            <el-input
              v-model="formData.manualUrls"
              type="textarea"
              :rows="4"
              class="c-input"
              placeholder="请输入正确的博主主页链接，支持批量添加，多个链接可换行或用逗号分隔"
            />
          </el-form-item>
        </template>

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

        <el-form-item label="" style="margin-top: 12px">
          <div class="c-label">选择需要的字段</div>
          <el-checkbox-group v-model="selectedFieldKeys" class="field-checkbox-group">
            <el-checkbox
              v-for="field in FIELD_MAPPING"
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
