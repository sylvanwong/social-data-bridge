<script setup>
import axios from 'axios';
import { bitable, DateFormatter, FieldType } from '@lark-base-open/js-sdk';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import request, { buildApiUrl } from '@/utils/request';
import { getDefaultSelectedFieldKeys, useSocialData } from '@/composables/useSocialData';

const props = defineProps({ api_key: String });
const TASK_PLUGIN_TYPE = 'search_suggestions';
const TABLE_CONFIG_API_PATH = '/social/api/v1/feishu/profile-fetch/table-output-config';
const TABLE_CONFIGS_API_PATH = '/social/api/v1/feishu/profile-fetch/table-output-configs';
const FIELD_SELECTION_STORAGE_KEY = 'search_suggestions_selected_fields_v1';

const PLATFORM_OPTIONS = [
  { value: 'xhs', label: '小红书' },
  { value: 'douyin', label: '抖音' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'kuaishou', label: '快手' },
  { value: 'bilibili', label: '哔哩哔哩' },
  { value: 'weibo', label: '微博' },
  { value: 'haokan', label: '好看视频' },
  { value: 'toutiao', label: '今日头条' },
  { value: 'baidu-tieba', label: '百度贴吧' },
  { value: 'zhihu', label: '知乎' },
  { value: 'x', label: 'X' },
  { value: 'youtube', label: 'YouTube' },
];

const FIELD_MAPPING = [
  { key: 'keyword', name: '搜索关键词', type: FieldType.Text, defaultSelected: true, required: true },
  { key: 'recommendation', name: '推荐词', type: FieldType.Text, defaultSelected: true, required: true },
  { key: 'suggestion_type', name: '建议类型', type: FieldType.Text, defaultSelected: true },
  { key: 'suggestion_label', name: '建议标记', type: FieldType.Text, defaultSelected: true },
  { key: 'description', name: '补充说明', type: FieldType.Text, defaultSelected: true },
  { key: 'social_type', name: '平台', type: FieldType.Text, defaultSelected: true },
  { key: 'ctime', name: '提取时间', type: FieldType.DateTime, defaultSelected: true, isTimestamp: true, dateFormat: DateFormatter.DATE_TIME },
];

const form = ref({ social_type: 'xhs', keyword: '', outputType: 1, table_id: '' });
const tableOptions = ref([]);
const tableFieldOptions = ref([]);
const selectedFieldKeys = ref(getDefaultSelectedFieldKeys(FIELD_MAPPING));
const fieldSelectionReady = ref(false);
const mappingDraft = ref([]);
const mappingExpanded = ref(false);
const mappingLoading = ref(false);
const loading = ref(false);
const toastVisible = ref(false);
const toastText = ref('');
const toastLoading = ref(false);
let toastTimer = null;
const tableOutputConfigs = ref({});
const tableConfigSaving = ref(false);
const tableConfigApplying = ref(false);
let tableConfigSaveQueued = false;

const allKeys = FIELD_MAPPING.map(field => field.key);
const allSelected = computed(() => allKeys.every(key => selectedFieldKeys.value.includes(key)));
const mappingStatus = computed(() => {
  if (form.value.outputType === 2 && !form.value.table_id) return '选择目标表格后可设置';
  const count = mappingDraft.value.filter(item => item.source_key && item.target_field_id).length;
  return count ? `已设置 ${count} 项映射` : '尚未设置自定义映射';
});
const { createAndWriteData, validateTableFields } = useSocialData(() => '搜索推荐词', props.api_key, FIELD_MAPPING);

const showToast = (text, isLoading = true) => {
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = null;
  toastText.value = text;
  toastLoading.value = isLoading;
  toastVisible.value = true;
};
const hideToast = () => { toastVisible.value = false; };
const showError = message => ElMessage({ message, type: 'error', plain: true });
const parseKeywords = text => [...new Set(String(text || '').split(/[\n,，]+/).map(item => item.trim()).filter(Boolean))];
const toggleAll = checked => {
  selectedFieldKeys.value = checked ? [...allKeys] : FIELD_MAPPING.filter(field => field.required).map(field => field.key);
};
const loadSelectedFieldKeys = async () => {
  const defaultKeys = getDefaultSelectedFieldKeys(FIELD_MAPPING);
  try {
    const savedValue = await bitable.bridge.getData(FIELD_SELECTION_STORAGE_KEY);
    if (!Array.isArray(savedValue)) {
      selectedFieldKeys.value = defaultKeys;
      return;
    }
    const validKeys = savedValue.filter(key => FIELD_MAPPING.some(field => field.key === key));
    const requiredKeys = FIELD_MAPPING.filter(field => field.required).map(field => field.key);
    selectedFieldKeys.value = Array.from(new Set([...validKeys, ...requiredKeys]));
  } catch (error) {
    console.error('读取推荐词输出字段失败:', error);
    selectedFieldKeys.value = defaultKeys;
  }
};
const saveSelectedFieldKeys = async keys => {
  try {
    const requiredKeys = FIELD_MAPPING.filter(field => field.required).map(field => field.key);
    await bitable.bridge.setData(FIELD_SELECTION_STORAGE_KEY, Array.from(new Set([...keys, ...requiredKeys])));
  } catch (error) {
    console.error('保存推荐词输出字段失败:', error);
  }
};

const loadTables = async () => {
  try {
    const tables = await bitable.base.getTableList();
    tableOptions.value = await Promise.all(tables.map(async table => ({ id: table.id, name: await table.getName() })));
  } catch (error) {
    showError('获取表格列表失败，请稍后重试');
  }
};
const getBaseId = async () => (await bitable.base.getSelection()).baseId || '';
const loadTableOutputConfigs = async () => {
  if (!props.api_key) return;
  try {
    const response = await request({
      url: TABLE_CONFIGS_API_PATH,
      method: 'get',
      headers: { authorization: `Bearer ${props.api_key}` },
      params: { plugin_type: TASK_PLUGIN_TYPE, base_id: await getBaseId() },
    });
    const data = response.data?.data || response.data;
    const list = Array.isArray(data) ? data : (data?.list || data?.items || []);
    tableOutputConfigs.value = Object.fromEntries(list.filter(item => item?.target_table_id).map(item => [item.target_table_id, item]));
  } catch (error) {
    console.error('读取推荐词表格配置失败:', error);
  }
};
const loadTableFields = async tableId => {
  tableConfigApplying.value = true;
  tableFieldOptions.value = [];
  mappingDraft.value = [];
  if (!tableId) {
    mappingLoading.value = false;
    tableConfigApplying.value = false;
    return;
  }
  mappingLoading.value = true;
  try {
    const table = await bitable.base.getTableById(tableId);
    const fields = await table.getFieldMetaList();
    tableFieldOptions.value = fields.map(field => ({ id: field.id, name: field.name, type: field.type }));
    const config = tableOutputConfigs.value[tableId];
    mappingDraft.value = Array.isArray(config?.field_mappings) ? config.field_mappings.map(item => ({ ...item })) : [];
  } catch (error) {
    showError('读取目标表字段失败，请稍后重试');
  } finally {
    mappingLoading.value = false;
    tableConfigApplying.value = false;
  }
};
const saveTableOutputConfig = async () => {
  if (form.value.outputType !== 2 || !form.value.table_id || tableConfigApplying.value) return;
  if (tableConfigSaving.value) {
    tableConfigSaveQueued = true;
    return;
  }
  if (!props.api_key || !tableFieldOptions.value.length) return;
  tableConfigSaving.value = true;
  try {
    const targetTableId = form.value.table_id;
    const table = await bitable.base.getTableById(targetTableId);
    const fieldMappings = mappingDraft.value
      .filter(item => item.source_key && item.target_field_id)
      .map(item => {
        const source = FIELD_MAPPING.find(field => field.key === item.source_key);
        const target = tableFieldOptions.value.find(field => field.id === item.target_field_id);
        return {
          ...item,
          source_name: source?.name || item.source_name || '',
          target_field_name: target?.name || item.target_field_name || '',
          target_field_type: target?.type ?? item.target_field_type,
        };
      });
    const response = await request({
      url: TABLE_CONFIG_API_PATH,
      method: 'put',
      headers: { authorization: `Bearer ${props.api_key}` },
      data: {
        plugin_type: TASK_PLUGIN_TYPE,
        base_id: await getBaseId(),
        target_table_id: targetTableId,
        target_table_name: await table.getName(),
        write_mode: 'append',
        field_mappings: fieldMappings,
      },
    });
    const saved = response.data?.data || response.data;
    tableOutputConfigs.value = { ...tableOutputConfigs.value, [targetTableId]: saved };
  } catch (error) {
    console.error('保存推荐词表格配置失败:', error);
  } finally {
    tableConfigSaving.value = false;
    if (tableConfigSaveQueued) {
      tableConfigSaveQueued = false;
      saveTableOutputConfig();
    }
  }
};
const getMappingSourceFields = index => {
  const usedKeys = new Set(mappingDraft.value.filter((item, itemIndex) => itemIndex !== index).map(item => item.source_key).filter(Boolean));
  return FIELD_MAPPING.filter(field => field.required || selectedFieldKeys.value.includes(field.key))
    .map(field => ({ ...field, disabled: usedKeys.has(field.key) }));
};
const getMappingTargetFields = index => {
  const usedIds = new Set(mappingDraft.value.filter((item, itemIndex) => itemIndex !== index).map(item => item.target_field_id).filter(Boolean));
  return tableFieldOptions.value.map(field => ({ ...field, disabled: usedIds.has(field.id) }));
};

const fetchSuggestions = async keyword => {
  const response = await axios.post(
    buildApiUrl('/social/api/v1/feishu/search/suggestions'),
    { social_type: form.value.social_type, keyword },
    { timeout: 60000, headers: { authorization: `Bearer ${props.api_key}` } },
  );
  const result = response.data;
  if (result?.sta !== 0) throw new Error(result?.msg || '获取推荐词失败');
  return Array.isArray(result.data?.items) ? result.data.items : [];
};

const execute = async keywords => {
  loading.value = true;
  const rows = [];
  const emptyKeywords = [];
  const failedKeywords = [];
  try {
    for (let index = 0; index < keywords.length; index += 1) {
      const keyword = keywords[index];
      showToast(`正在获取「${keyword}」（${index + 1}/${keywords.length}）…`);
      try {
        const items = await fetchSuggestions(keyword);
        if (!items.length) {
          emptyKeywords.push(keyword);
          continue;
        }
        rows.push(...items.map(item => ({
          keyword: item.keyword || keyword,
          recommendation: item.recommendation || '',
          suggestion_type: item.suggestion_type || '',
          suggestion_label: item.suggestion_label || '',
          description: item.description || '',
          social_type: item.social_type || form.value.social_type,
          ctime: item.ctime || '',
        })));
      } catch (error) {
        failedKeywords.push(keyword);
        console.error(`获取关键词「${keyword}」的推荐词失败:`, error);
      }
    }

    if (!rows.length) {
      const reason = failedKeywords.length === keywords.length
        ? '所有关键词均获取失败，请检查 API Key 或稍后重试'
        : '未获取到推荐词，请更换关键词后重试';
      throw new Error(reason);
    }

    const targetTableId = form.value.outputType === 2 ? form.value.table_id : '';
    if (targetTableId) {
      const valid = await validateTableFields(targetTableId, selectedFieldKeys.value, { fieldMappings: mappingDraft.value });
      if (!valid) throw new Error('目标表字段校验失败，请检查表格字段类型');
    }
    showToast('正在写入多维表格…');
    const result = await createAndWriteData(rows, targetTableId ? 'stream' : '', '', targetTableId, selectedFieldKeys.value, {
      stopAfterCurrentBatch: true,
      writeMode: 'append',
      parallelCellCreation: true,
      cellCreationBatchSize: 20,
      skipFieldDisplayConfig: true,
      fieldMappings: targetTableId ? mappingDraft.value.filter(item => item.source_key && item.target_field_id).map(item => ({ ...item })) : [],
    });
    if (!targetTableId && result?.tableId) await bitable.ui.switchToTable(result.tableId);

    const notes = [];
    if (emptyKeywords.length) notes.push(`${emptyKeywords.length} 个关键词无结果`);
    if (failedKeywords.length) notes.push(`${failedKeywords.length} 个关键词获取失败`);
    showToast(`处理完成，已写入 ${rows.length} 条${notes.length ? `（${notes.join('，')}）` : ''}`, false);
    toastTimer = setTimeout(hideToast, 3500);
  } catch (error) {
    hideToast();
    showError(error?.response?.data?.msg || error.message || '执行失败，请稍后重试');
  } finally {
    loading.value = false;
  }
};

const submit = () => {
  if (loading.value) return;
  if (!props.api_key) return showError('请先在首页配置 API Key');
  if (!form.value.social_type) return showError('请选择平台');
  const keywords = parseKeywords(form.value.keyword);
  if (!keywords.length) return showError('请输入至少一个关键词');
  if (form.value.outputType === 2 && !form.value.table_id) return showError('请选择现有表格');
  if (form.value.outputType === 2 && mappingLoading.value) return showError('正在读取目标表字段，请稍后重试');
  if (form.value.outputType === 2 && mappingDraft.value.some(item => !item.source_key || !item.target_field_id)) return showError('请完成字段映射，或删除未完成的映射');
  execute(keywords);
};

watch(() => form.value.outputType, value => {
  if (value === 2) loadTables();
  else {
    form.value.table_id = '';
    tableFieldOptions.value = [];
    mappingDraft.value = [];
  }
});
watch(() => form.value.table_id, loadTableFields);
watch(mappingDraft, saveTableOutputConfig, { deep: true });
watch(selectedFieldKeys, keys => {
  if (!fieldSelectionReady.value) return;
  const requiredKeys = FIELD_MAPPING.filter(field => field.required).map(field => field.key);
  const mergedKeys = Array.from(new Set([...keys, ...requiredKeys]));
  if (mergedKeys.length !== keys.length) {
    selectedFieldKeys.value = mergedKeys;
    return;
  }
  saveSelectedFieldKeys(mergedKeys);
}, { deep: true });
onMounted(async () => {
  await Promise.all([loadSelectedFieldKeys(), loadTableOutputConfigs()]);
  fieldSelectionReady.value = true;
});
onUnmounted(() => { if (toastTimer) clearTimeout(toastTimer); });
</script>

<template>
  <div class="suggestions-page">
    <div class="sub-page-header">
      <span class="sub-page-back" @click="$emit('back')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16"><polyline points="15 18 9 12 15 6"></polyline></svg>
      </span>
      <span class="sub-page-title">搜索推荐词</span>
    </div>
    <div class="form-card">
      <el-form class="form" :model="form" label-position="top">
        <section class="settings-section" aria-labelledby="suggestions-settings-title">
          <h2 id="suggestions-settings-title" class="settings-section-heading"><span class="settings-step">1</span><span>获取设置</span></h2>
          <el-form-item label="">
            <div class="c-label">平台</div>
            <el-select v-model="form.social_type" placeholder="请选择" style="width:100%">
              <el-option v-for="platform in PLATFORM_OPTIONS" :key="platform.value" :label="platform.label" :value="platform.value" />
            </el-select>
          </el-form-item>
          <el-form-item label="">
            <div class="c-label">关键词</div>
            <el-input v-model="form.keyword" type="textarea" :rows="4" placeholder="请输入搜索词或短语，多个关键词可换行或用逗号分隔" />
          </el-form-item>
        </section>

        <section class="settings-section settings-section-output" aria-labelledby="suggestions-output-title">
          <h2 id="suggestions-output-title" class="settings-section-heading"><span class="settings-step">2</span><span>输出设置</span></h2>
          <el-form-item label="">
            <div class="field-stack">
              <div class="c-label">输出到表格</div>
              <el-radio-group v-model="form.outputType" class="radio-block">
                <el-radio :value="1">新建表格</el-radio>
                <el-radio :value="2">使用现有表格</el-radio>
              </el-radio-group>
            </div>
          </el-form-item>
          <el-form-item v-if="form.outputType === 2" label="">
            <div class="c-label">选择现有表格</div>
            <el-select v-model="form.table_id" placeholder="请选择" style="width:100%">
              <el-option v-for="table in tableOptions" :key="table.id" :label="table.name" :value="table.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="">
            <div class="field-selection-content">
              <div class="field-selection-title"><div class="c-label">选择需要的字段</div></div>
              <el-checkbox :model-value="allSelected" class="select-all-fields" @change="toggleAll">全选</el-checkbox>
              <el-checkbox-group v-model="selectedFieldKeys" class="field-checkbox-group">
                <el-checkbox v-for="field in FIELD_MAPPING" :key="field.key" :label="field.key" :disabled="field.required" class="field-checkbox-item">{{ field.name }}</el-checkbox>
              </el-checkbox-group>
            </div>
          </el-form-item>
          <div v-if="form.outputType === 2" class="mapping-accordion">
            <button type="button" class="mapping-accordion-trigger" :aria-expanded="mappingExpanded" @click="mappingExpanded = !mappingExpanded">
              <span>字段映射 <span class="mapping-optional">（可选）</span> <span class="mapping-status">{{ mappingStatus }}</span></span>
              <span class="mapping-chevron" :class="{ 'is-expanded': mappingExpanded }"></span>
            </button>
            <div v-show="mappingExpanded" class="mapping-accordion-panel">
              <div v-if="mappingLoading" class="sub-hint">正在读取目标表字段...</div>
              <div v-else-if="!form.table_id" class="sub-hint">请先选择现有表格，再配置字段映射。</div>
              <template v-else>
                <p class="mapping-note">同名字段会自动匹配；不同名时可指定目标列。未映射且没有同名列时，将自动新建同名列。</p>
                <div v-for="(mapping, index) in mappingDraft" :key="`${mapping.source_key}-${index}`" class="mapping-row">
                  <el-select v-model="mapping.source_key" placeholder="选择输出字段" size="small">
                    <el-option v-for="field in getMappingSourceFields(index)" :key="field.key" :label="field.name" :value="field.key" :disabled="field.disabled" />
                  </el-select>
                  <span class="mapping-arrow">→</span>
                  <el-select v-model="mapping.target_field_id" placeholder="选择目标字段" size="small">
                    <el-option v-for="field in getMappingTargetFields(index)" :key="field.id" :label="field.name" :value="field.id" :disabled="field.disabled" />
                  </el-select>
                  <el-button link type="danger" class="mapping-delete" @click="mappingDraft.splice(index, 1)">删除</el-button>
                </div>
                <div class="mapping-actions"><el-button link type="primary" @click="mappingDraft.push({ source_key: '', target_field_id: '' })">+ 添加字段映射</el-button></div>
              </template>
            </div>
          </div>
        </section>
        <el-button class="commit-btn" :loading="loading" :disabled="loading" @click="submit">{{ loading ? '执行中…' : '立即执行' }}</el-button>
      </el-form>
    </div>
    <div class="toast-wrap" :class="{ show: toastVisible }">
      <div class="toast" :class="{ 'toast-loading': toastLoading }">
        <div class="toast-icon" v-if="toastLoading"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 2a10 10 0 0 1 10 10"></path></svg></div>
        <div class="toast-icon" v-else><svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="#00B42A"></circle><path d="M8 12l2.5 2.5L16 9" stroke="#FFFFFF" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path></svg></div>
        <span>{{ toastText }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.suggestions-page { min-height:100vh; background:#fffcfc; font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif; }
.sub-page-header { display:grid; grid-template-columns:32px minmax(0,1fr); align-items:center; gap:8px; min-height:48px; padding:0 8px; position:sticky; top:0; z-index:100; background:#fff; border-bottom:1px solid #e5e6eb; }
.sub-page-back { display:flex; align-items:center; justify-content:center; width:32px; height:32px; color:#4e5969; cursor:pointer; }
.sub-page-back:hover { color:#a8071a; }
.sub-page-back svg { width:100%; height:100%; stroke-width:1.6; stroke-linecap:round; stroke-linejoin:round; }
.sub-page-title { overflow:hidden; color:#1d2129; font-size:18px; font-weight:600; line-height:24px; text-overflow:ellipsis; white-space:nowrap; }
.form-card { box-sizing:border-box; margin:16px; padding:20px; background:#fff; border:1px solid #e5e6eb; border-radius:8px; }
.settings-section { min-width:0; }
.settings-section-output { margin-top:20px; padding-top:20px; border-top:1px solid #f0f1f3; }
.settings-section-heading { display:flex; align-items:center; gap:8px; margin:0 0 12px; color:#1d2129; font-size:16px; font-weight:500; line-height:22px; }
.settings-step { display:inline-flex; align-items:center; justify-content:center; width:20px; height:20px; color:#a8071a; background:#fff1f2; border-radius:50%; font-size:12px; font-weight:600; line-height:20px; }
.c-label { display:flex; align-items:center; margin-bottom:8px; color:#1d2129; font-size:14px; font-weight:500; line-height:20px; }
.form :deep(.el-form-item__label) { margin-bottom:8px; color:#1d2129; font-size:14px; }
.form :deep(.el-form-item) { margin-bottom:16px; }
.form :deep(.el-form-item__content) { font-size:14px; }
.form :deep(.el-select__wrapper) { min-height:36px; height:36px; padding:0 12px; }
.form :deep(.el-input__wrapper) { min-height:36px; padding:0 12px; }
.form :deep(.el-textarea__inner) { min-height:80px; padding:8px 12px; }
.field-stack,.field-selection-content { width:100%; }
.radio-block { display:flex; flex-wrap:wrap; gap:16px; width:100%; }
.radio-block :deep(.el-radio) { min-height:28px; margin-right:0; }
.field-selection-title { margin-bottom:8px; }
.select-all-fields { margin-right:0; margin-bottom:8px; }
.field-checkbox-group { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px 16px; width:100%; }
.field-checkbox-item,.field-checkbox-group :deep(.el-checkbox) { margin-right:0; align-items:center; }
.field-checkbox-group :deep(.el-checkbox__label) { padding-left:8px; color:#1d2129; line-height:22px; }
.field-checkbox-group :deep(.el-checkbox__inner) { width:16px; height:16px; border:1px solid #e5e6eb; border-radius:4px; }
.field-checkbox-group :deep(.el-checkbox:hover .el-checkbox__inner) { border-color:#86909c; }
.field-checkbox-group :deep(.el-checkbox__input.is-checked .el-checkbox__inner) { background:#a8071a; border-color:#a8071a; }
.field-checkbox-group :deep(.el-checkbox__input.is-disabled.is-checked .el-checkbox__inner) { background:#f7f8fa; border-color:#e5e6eb; }
.field-checkbox-group :deep(.el-checkbox__input.is-disabled.is-checked .el-checkbox__inner::after) { border-color:#c9cdd4; }
.field-checkbox-group :deep(.el-checkbox__input.is-disabled + .el-checkbox__label) { color:#c9cdd4; }
.field-checkbox-group :deep(.el-checkbox__input.is-checked + .el-checkbox__label) { color:#1d2129; }
.mapping-accordion { margin:12px 0 16px; border-top:1px solid #f0f1f3; border-bottom:1px solid #f0f1f3; }
.mapping-accordion-trigger { display:flex; align-items:center; justify-content:space-between; width:100%; min-height:48px; padding:12px 0; border:0; background:transparent; color:#1d2129; font:inherit; text-align:left; cursor:pointer; }
.mapping-optional,.mapping-status,.mapping-note { color:#86909c; font-size:12px; font-weight:400; }
.mapping-chevron { width:8px; height:8px; border-right:1px solid #86909c; border-bottom:1px solid #86909c; transform:rotate(45deg); transition:transform .2s ease; }
.mapping-chevron.is-expanded { transform:rotate(225deg); }
.mapping-accordion-panel { padding:0 0 12px; }
.mapping-note { margin:0 0 12px; line-height:18px; }
.mapping-row { display:grid; grid-template-columns:minmax(0,1fr) 12px minmax(0,1fr) auto; align-items:center; gap:4px; min-height:44px; border-top:1px solid #f0f1f3; }
.mapping-row :deep(.el-select__wrapper) { min-height:36px; height:36px; padding:0 12px; border-radius:6px; box-shadow:0 0 0 1px #e5e6eb inset; }
.mapping-arrow { color:#86909c; }
.mapping-delete { min-width:28px; padding:4px; }
.mapping-actions { display:flex; align-items:center; gap:12px; margin-top:8px; }
.mapping-actions :deep(.el-button) { margin-left:0; }
.sub-hint { margin:0 0 10px; color:#86909c; font-size:12px; line-height:18px; }
@media (max-width:420px) {
  .mapping-row { grid-template-columns:minmax(0,1fr) 12px minmax(0,1fr); }
  .mapping-delete { grid-column:3; justify-self:end; }
}
.commit-btn { width:100%; height:36px; margin-top:0; border:0; border-radius:6px; background:#a8071a; color:#fff; font-size:14px; font-weight:500; }
.commit-btn:hover { background:#c11126; }
.commit-btn:active { background:#8a0515; }
.toast-wrap { position:fixed; top:50%; left:50%; z-index:9999; width:max-content; max-width:calc(100vw - 32px); pointer-events:none; opacity:0; transform:translate(-50%,-50%) scale(.95); transition:opacity .3s ease,transform .3s ease; }
.toast-wrap.show { opacity:1; transform:translate(-50%,-50%) scale(1); }
.toast { display:inline-flex; align-items:center; gap:8px; box-sizing:border-box; max-width:calc(100vw - 32px); padding:8px 16px; border:1px solid #e5e6eb; border-radius:8px; background:#fff; box-shadow:0 8px 24px rgba(0,0,0,.12); color:#1d2129; font-size:14px; font-weight:500; line-height:22px; white-space:normal; overflow-wrap:anywhere; }
.toast-icon { display:flex; align-items:center; justify-content:center; flex-shrink:0; width:18px; height:18px; }
.toast-icon svg { width:100%; height:100%; }
.toast-loading .toast-icon { color:#a8071a; animation:spin .8s linear infinite; }
@keyframes spin { to { transform:rotate(360deg); } }
</style>
