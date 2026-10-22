<script setup>
import { bitable } from '@lark-base-open/js-sdk';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import request from '@/utils/request';
import { BLOGGER_FIELD_MAPPING, getDefaultSelectedFieldKeys, showErrorMsg, useSocialData } from '@/composables/useSocialData';
import { useIncrementalTask } from '@/composables/useIncrementalTask';

const props = defineProps({ api_key: String, social_type_options: Array });
const TASK_PLUGIN_TYPE = 'blogger_search';
const TABLE_CONFIG_API_PATH = '/social/api/v1/feishu/profile-fetch/table-output-config';
const TABLE_CONFIGS_API_PATH = '/social/api/v1/feishu/profile-fetch/table-output-configs';
const form = ref({ social_type: '', keyword: '', rangeType: 'pages', pages: 1, radio: 1, table_id: '', writeMode: 'upsert', follower_count_range: 'all', user_type: 'all' });
const tableOptions = ref([]);
const tableFieldOptions = ref([]);
const selectedFieldKeys = ref([]);
const mappingDraft = ref([]);
const mappingExpanded = ref(false);
const mappingLoading = ref(false);
const loading = ref(false);
const submitting = ref(false);
const cancelling = ref(false);
const taskId = ref('');
const toastVisible = ref(false);
const toastText = ref('');
const toastLoading = ref(false);
let toastTimer = null;
const fieldReady = ref(false);
const storageKey = 'blogger_search_stream_task_v1';
const fieldStorageKey = 'blogger_search_selected_fields_v1';
const tableOutputConfigs = ref({});
const tableConfigSaving = ref(false);
const tableConfigApplying = ref(false);
let tableConfigSaveQueued = false;
const allKeys = BLOGGER_FIELD_MAPPING.map(field => field.key);
const allSelected = computed(() => allKeys.every(key => selectedFieldKeys.value.includes(key)));
const socialOptions = computed(() => [
  { value: 'xhs', label: '小红书' }, { value: 'douyin', label: '抖音' },
  { value: 'tiktok', label: 'TikTok' }, { value: 'kuaishou', label: '快手' },
  { value: 'bilibili', label: '哔哩哔哩' }, { value: 'weibo', label: '微博' },
  { value: 'haokan', label: '好看视频' }, { value: 'toutiao', label: '今日头条' },
  { value: 'wechat', label: '视频号' }, { value: 'zhihu', label: '知乎' },
  { value: 'instagram', label: 'Instagram' }, { value: 'x', label: 'X' },
]);
const isDouyin = computed(() => form.value.social_type === 'douyin');

const getTableName = () => form.value.keyword.split(/[\n,，]+/).map(item => item.trim()).find(Boolean) || '作者搜索';
const { createAndWriteData, validateTableFields } = useSocialData(getTableName, props.api_key, BLOGGER_FIELD_MAPPING);
const auth = () => ({ authorization: `Bearer ${props.api_key}` });

const showToast = (text, isLoading = true) => {
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
  toastText.value = text;
  toastLoading.value = isLoading;
  toastVisible.value = true;
};

const hideToast = () => {
  toastVisible.value = false;
};

const showCompletionToast = text => {
  showToast(text, false);
  toastTimer = setTimeout(hideToast, 3000);
};

const getStoppingText = task => {
  const total = Number(task.totalPages) || 0;
  const processed = Number(task.processedPages) || 0;
  if (!total) {
    return '正在停止任务，等待剩余作者写入完成后停止，避免已获取数据丢失';
  }
  const remaining = Math.max(0, total - processed);
  return `正在停止任务，剩余${remaining}页作者未写入，等待写入完成后停止，避免已获取数据丢失`;
};

const searchTask = useIncrementalTask({
  storageKey,
  isTerminal: status => [1, 2, 3].includes(Number(status.status)),
  getStatus: async task => (await request({ url: `/social/api/v1/feishu/blogger/search/task?task_id=${encodeURIComponent(task.taskId)}`, method: 'get', headers: auth() })).data,
  getResults: async task => (await request({ url: '/social/api/v1/feishu/blogger/search/list', method: 'post', headers: auth(), data: { task_id: task.taskId, after_id: task.cursor || '', limit: 40 } })).data,
  writeBatch: async (items, task) => {
    // 搜索允许作者ID为空；这些作者保留为新增记录，避免被唯一键写入逻辑跳过。
    const groups = task.writeMode === 'upsert'
      ? [{ items: items.filter(item => item.user_id), mode: 'upsert' }, { items: items.filter(item => !item.user_id), mode: 'append' }]
      : [{ items, mode: 'append' }];
    for (const group of groups) {
      if (!group.items.length) continue;
      const result = await createAndWriteData(group.items, task.targetTableId ? 'stream' : '', task.taskId, task.targetTableId || '', task.selectedFieldKeys, {
      writeMode: group.mode,
      uniqueKey: 'user_id',
      fieldMappings: task.fieldMappings || [],
      upsertCacheKey: task.taskId,
      stopAfterCurrentBatch: true,
      onTargetTableReady: async tableId => { task.targetTableId = tableId; },
    });
    task.targetTableId = result?.tableId || task.targetTableId;
    }
  },
  onProgress: (status, task) => {
    if (status.status_text === 'cancel_requested' || status.cancel_requested) cancelling.value = true;
    const processed = Number(status.processed) || 0;
    const total = Number(status.total) || 0;
    task.processedPages = processed;
    task.totalPages = total;
    showToast(cancelling.value
      ? getStoppingText(task)
      : `正在获取作者，已处理 ${total ? `${processed}/${total}` : processed} 页，已写入 ${task.writtenCount || 0} 条`);
  },
  onWriting: (items, task) => { showToast(cancelling.value ? getStoppingText(task) : `正在写入 ${items.length} 条作者数据…`); },
  onFinish: (status, task) => {
    loading.value = false; cancelling.value = false; taskId.value = '';
    if (Number(status.status) === 2) {
      showCompletionToast(status.reason || '任务失败');
      showErrorMsg(status.reason || '获取数据失败');
      return;
    }
    if (Number(status.status) === 3) {
      showCompletionToast(`任务已停止，已写入 ${task.writtenCount || 0} 条作者`);
      return;
    }
    showCompletionToast(`处理完成，已写入 ${task.writtenCount || 0} 条作者`);
  },
  onError: error => {
    loading.value = false; cancelling.value = false; taskId.value = '';
    const message = error.message || '任务长时间没有进度';
    showCompletionToast(message);
    showErrorMsg(message);
  },
});

const loadTables = async () => {
  try {
    const tables = await bitable.base.getTableList();
    tableOptions.value = await Promise.all(tables.map(async table => ({ id: table.id, name: await table.getName() })));
  } catch (error) { showErrorMsg('获取表格列表失败，请稍后重试'); }
};
const getBaseId = async () => (await bitable.base.getSelection()).baseId || '';
const loadTableOutputConfigs = async () => {
  if (!props.api_key) return;
  try {
    const response = await request({ url: TABLE_CONFIGS_API_PATH, method: 'get', headers: auth(), params: { plugin_type: TASK_PLUGIN_TYPE, base_id: await getBaseId() } });
    const data = response.data?.data || response.data;
    const list = Array.isArray(data) ? data : (data?.list || data?.items || []);
    tableOutputConfigs.value = Object.fromEntries(list.filter(item => item?.target_table_id).map(item => [item.target_table_id, item]));
  } catch (error) { console.error('读取作者搜索表格配置失败:', error); }
};
const loadTableFields = async tableId => {
  tableConfigApplying.value = true;
  tableFieldOptions.value = [];
  mappingDraft.value = [];
  if (!tableId) { mappingLoading.value = false; tableConfigApplying.value = false; return; }
  mappingLoading.value = true;
  try {
    const table = await bitable.base.getTableById(tableId);
    const fields = await table.getFieldMetaList();
    tableFieldOptions.value = fields.map(field => ({ id: field.id, name: field.name, type: field.type }));
    const config = tableOutputConfigs.value[tableId];
    mappingDraft.value = Array.isArray(config?.field_mappings) ? config.field_mappings.map(item => ({ ...item })) : [];
    if (config?.write_mode === 'append' || config?.write_mode === 'upsert') form.value.writeMode = config.write_mode;
  } catch (error) {
    showErrorMsg('读取目标表字段失败，请稍后重试');
  } finally {
    mappingLoading.value = false;
    tableConfigApplying.value = false;
  }
};
const saveTableOutputConfig = async () => {
  if (form.value.radio !== 2 || !form.value.table_id || tableConfigApplying.value) return;
  if (tableConfigSaving.value) { tableConfigSaveQueued = true; return; }
  if (!props.api_key || !tableFieldOptions.value.length) return;
  tableConfigSaving.value = true;
  try {
    const targetTableId = form.value.table_id;
    const table = await bitable.base.getTableById(targetTableId);
    const fieldMappings = mappingDraft.value.filter(item => item.source_key && item.target_field_id).map(item => {
      const source = BLOGGER_FIELD_MAPPING.find(field => field.key === item.source_key);
      const target = tableFieldOptions.value.find(field => field.id === item.target_field_id);
      return { ...item, source_name: source?.name || item.source_name || '', target_field_name: target?.name || item.target_field_name || '', target_field_type: target?.type ?? item.target_field_type };
    });
    const response = await request({
      url: TABLE_CONFIG_API_PATH,
      method: 'put',
      headers: auth(),
      data: { plugin_type: TASK_PLUGIN_TYPE, base_id: await getBaseId(), target_table_id: targetTableId, target_table_name: await table.getName(), write_mode: form.value.writeMode, field_mappings: fieldMappings },
    });
    tableOutputConfigs.value = { ...tableOutputConfigs.value, [targetTableId]: response.data?.data || response.data };
  } catch (error) {
    console.error('保存作者搜索表格配置失败:', error);
  } finally {
    tableConfigSaving.value = false;
    if (tableConfigSaveQueued) { tableConfigSaveQueued = false; saveTableOutputConfig(); }
  }
};
const getMappingSourceFields = index => {
  const usedKeys = new Set(mappingDraft.value.filter((item, itemIndex) => itemIndex !== index).map(item => item.source_key).filter(Boolean));
  return BLOGGER_FIELD_MAPPING.filter(field => selectedFieldKeys.value.includes(field.key)).map(field => ({ ...field, disabled: usedKeys.has(field.key) }));
};
const getMappingTargetFields = index => {
  const usedIds = new Set(mappingDraft.value.filter((item, itemIndex) => itemIndex !== index).map(item => item.target_field_id).filter(Boolean));
  return tableFieldOptions.value.map(field => ({ ...field, disabled: usedIds.has(field.id) }));
};
const mappingStatus = computed(() => {
  if (form.value.radio === 2 && !form.value.table_id) return '选择目标表格后可设置';
  const count = mappingDraft.value.filter(item => item.source_key && item.target_field_id).length;
  return count ? `已设置 ${count} 项映射` : '尚未设置自定义映射';
});
const loadFields = async () => {
  try {
    const saved = await bitable.bridge.getData(fieldStorageKey);
    selectedFieldKeys.value = Array.isArray(saved) ? [...new Set([...saved, 'user_id'])].filter(key => allKeys.includes(key)) : getDefaultSelectedFieldKeys(BLOGGER_FIELD_MAPPING);
  } catch { selectedFieldKeys.value = getDefaultSelectedFieldKeys(BLOGGER_FIELD_MAPPING); }
  fieldReady.value = true;
};
watch(selectedFieldKeys, keys => { if (fieldReady.value) bitable.bridge.setData(fieldStorageKey, keys); }, { deep: true });
watch([mappingDraft, () => form.value.writeMode], saveTableOutputConfig, { deep: true });
watch(() => form.value.radio, value => {
  if (value === 2) loadTables();
  else { tableFieldOptions.value = []; mappingDraft.value = []; }
});
watch(() => form.value.table_id, loadTableFields);

const toggleAll = checked => { selectedFieldKeys.value = checked ? [...allKeys] : ['user_id']; };
const parseKeywords = value => [...new Set(String(value || '').split(/[\n,，]+/).map(item => item.trim()).filter(Boolean))];
const cancel = async () => {
  const task = searchTask.getActiveTask();
  if (!task?.taskId || cancelling.value) return;
  cancelling.value = true; showToast(getStoppingText(task));
  try {
    const response = await request({ url: '/social/api/v1/feishu/blogger/search/task/cancel', method: 'post', headers: auth(), data: { task_id: task.taskId } });
    if (response.data?.sta !== 0) throw new Error(response.data?.msg || '停止任务失败');
  } catch (error) { cancelling.value = false; showErrorMsg(error.message || '停止任务失败'); }
};
const submit = async () => {
  if (submitting.value || loading.value) return;
  submitting.value = true;
  try {
    const keywords = parseKeywords(form.value.keyword);
    if (!props.api_key) throw new Error('请输入API key');
    if (!form.value.social_type) throw new Error('请选择平台');
    if (!keywords.length) throw new Error('请输入至少一个作者关键词');
    if (keywords.length > 100) throw new Error('最多支持 100 个关键词');
    if (form.value.social_type === 'instagram' && keywords.some(keyword => [...keyword].length > 256)) throw new Error('Instagram 每个关键词最多 256 个字符');
    if (form.value.rangeType === 'pages' && (!Number.isInteger(form.value.pages) || form.value.pages < 1 || form.value.pages > 100)) throw new Error('搜索页数必须为 1～100 的整数');
    if (form.value.radio === 2 && !form.value.table_id) throw new Error('请选择现有表格');
    if (form.value.radio === 2 && mappingLoading.value) throw new Error('正在读取目标表字段，请稍后重试');
    if (form.value.radio === 2 && mappingDraft.value.some(item => !item.source_key || !item.target_field_id)) throw new Error('请完成字段映射，或删除未完成的映射');
    if (form.value.radio === 2 && !(await validateTableFields(form.value.table_id, selectedFieldKeys.value, BLOGGER_FIELD_MAPPING, { writeMode: form.value.writeMode, uniqueKey: 'user_id', fieldMappings: mappingDraft.value }))) return;
    const filter_config = isDouyin.value ? { follower_count_range: form.value.follower_count_range, user_type: form.value.user_type } : {};
    const response = await request({ url: '/social/api/v1/feishu/blogger/search/task', method: 'post', headers: auth(), data: { social_type: form.value.social_type, keyword: keywords, pages: form.value.rangeType === 'all' ? 0 : Number(form.value.pages), filter_config } });
    if (response.data?.sta !== 0) throw new Error(response.data?.msg || '创建任务失败');
    const task = response.data.data;
    const id = task?.task_id;
    if (!id) throw new Error('创建任务未返回任务ID');
    taskId.value = id; loading.value = true; showToast('任务已创建，正在获取作者…');
    await searchTask.start({ taskId: id, totalPages: Number(task.total) || 0, targetTableId: form.value.radio === 2 ? form.value.table_id : '', selectedFieldKeys: [...selectedFieldKeys.value], writeMode: form.value.writeMode, fieldMappings: form.value.radio === 2 ? mappingDraft.value.filter(item => item.source_key && item.target_field_id).map(item => ({ ...item })) : [] });
  } catch (error) {
    loading.value = false;
    showErrorMsg(error.message || '提交失败，请稍后重试');
  } finally { submitting.value = false; }
};
const taskActionState = computed(() => {
  if (cancelling.value) return 'stopping';
  if (loading.value && taskId.value) return 'running';
  if (loading.value || submitting.value) return 'submitting';
  return 'idle';
});
const handleTaskAction = () => {
  if (taskActionState.value === 'running') return cancel();
  if (taskActionState.value === 'idle') return submit();
};
onMounted(async () => { form.value.social_type = socialOptions.value[0]?.value || ''; await Promise.all([loadFields(), loadTableOutputConfigs()]); const saved = await searchTask.resume(task => { taskId.value = task.taskId; loading.value = true; showToast('正在恢复未完成的作者搜索任务…'); }); if (saved === false) taskId.value = ''; });
onUnmounted(() => {
  searchTask.stop();
  if (toastTimer) clearTimeout(toastTimer);
});
</script>

<template>
  <div class="blogger-search-page">
    <div class="sub-page-header">
      <span class="sub-page-back" @click="$emit('back')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16">
          <polyline points="15 18 9 12 15 6"></polyline>
        </svg>
      </span>
      <span class="sub-page-title">作者搜索获取</span>
    </div>
    <div class="form-card">
      <el-form class="form" :model="form" label-position="top">
        <section class="settings-section" aria-labelledby="blogger-fetch-settings-title">
          <h2 id="blogger-fetch-settings-title" class="settings-section-heading">
            <span class="settings-step">1</span>
            <span>获取设置</span>
          </h2>
        <el-form-item label="">
          <div slot="label" class="c-label">
            平台
            <el-tooltip effect="dark" placement="top">
              <template #content>平台</template>
              <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png" class="help-icon" />
            </el-tooltip>
          </div>
          <el-select v-model="form.social_type" placeholder="请选择" style="width:100%">
            <el-option v-for="item in socialOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="">
          <div slot="label" class="c-label">作者关键词</div>
          <el-input v-model="form.keyword" type="textarea" :rows="4" placeholder="请输入作者关键词，支持批量添加，多个关键词可换行或用逗号分隔" />
        </el-form-item>
        <template v-if="isDouyin">
          <el-form-item label="">
            <div slot="label" class="c-label">粉丝量</div>
            <el-select v-model="form.follower_count_range" placeholder="请选择" style="width:100%">
              <el-option value="all" label="不限" />
              <el-option value="under_1k" label="1000 以下" />
              <el-option value="1k_to_10k" label="1000～1 万" />
              <el-option value="10k_to_100k" label="1 万～10 万" />
              <el-option value="100k_to_1m" label="10 万～100 万" />
              <el-option value="over_1m" label="100 万以上" />
            </el-select>
          </el-form-item>
          <el-form-item label="">
            <div slot="label" class="c-label">用户类型</div>
            <el-select v-model="form.user_type" placeholder="请选择" style="width:100%">
              <el-option value="all" label="不限" />
              <el-option value="regular_user" label="普通用户" />
              <el-option value="enterprise_verified" label="企业认证" />
              <el-option value="individual_verified" label="个人认证" />
            </el-select>
          </el-form-item>
        </template>
        <el-form-item label="">
          <div slot="label" class="c-label">作者获取范围</div>
          <el-radio-group v-model="form.rangeType" class="custom-radio-group">
            <el-radio value="all" class="custom-radio-item"><span class="radio-label-text">全部作者</span></el-radio>
            <el-radio value="pages" class="custom-radio-item">
              <span class="radio-label-text">前</span>
              <div class="custom-stepper-input range-stepper" :class="{ 'is-disabled': form.rangeType !== 'pages' }">
                <input v-model.number="form.pages" type="number" min="1" max="100" :disabled="form.rangeType !== 'pages'" @click.stop />
                <div class="stepper-buttons">
                  <button type="button" class="stepper-btn stepper-btn-up" :disabled="form.rangeType !== 'pages'" aria-label="增加页数" @click.stop="form.pages = Math.min(100, (form.pages || 1) + 1)"></button>
                  <button type="button" class="stepper-btn stepper-btn-down" :disabled="form.rangeType !== 'pages'" aria-label="减少页数" @click.stop="form.pages = Math.max(1, (form.pages || 1) - 1)"></button>
                </div>
              </div>
              <span class="range-unit">页</span>
            </el-radio>
          </el-radio-group>
        </el-form-item>
        </section>

        <section class="settings-section settings-section-output" aria-labelledby="blogger-output-settings-title">
          <h2 id="blogger-output-settings-title" class="settings-section-heading">
            <span class="settings-step">2</span>
            <span>输出设置</span>
          </h2>
        <el-form-item label="" style="margin-top: 0">
          <div class="field-stack">
            <div class="c-label">输出到表格</div>
            <el-radio-group v-model="form.radio" class="radio-block">
              <el-radio :value="1">新建表格</el-radio>
              <el-radio :value="2">使用现有表格</el-radio>
            </el-radio-group>
          </div>
        </el-form-item>
        <el-form-item v-if="form.radio === 2" label="">
          <div class="c-label">选择现有表格</div>
          <el-select v-model="form.table_id" placeholder="请选择" style="width:100%">
            <el-option v-for="table in tableOptions" :key="table.id" :label="table.name" :value="table.id" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="form.radio === 2" label="" style="margin-top: 0">
          <div class="field-stack">
            <div class="c-label">数据写入方式</div>
            <el-radio-group v-model="form.writeMode" class="radio-block">
              <el-radio value="upsert">更新或新增</el-radio>
              <el-radio value="append">始终新增</el-radio>
            </el-radio-group>
          </div>
        </el-form-item>
        <el-form-item label="" style="margin-top: 0">
          <div class="field-selection-content">
            <div class="field-selection-title"><div class="c-label">选择需要的字段</div></div>
            <el-checkbox :model-value="allSelected" class="select-all-fields" @change="toggleAll">全选</el-checkbox>
            <el-checkbox-group v-model="selectedFieldKeys" class="field-checkbox-group">
              <el-checkbox v-for="field in BLOGGER_FIELD_MAPPING" :key="field.key" :label="field.key" :disabled="field.required" class="field-checkbox-item">{{ field.name }}</el-checkbox>
            </el-checkbox-group>
          </div>
        </el-form-item>
        <div v-if="form.radio === 2" class="mapping-accordion">
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
        <el-button
          class="commit-btn"
          :class="{ 'is-running': taskActionState === 'running' || taskActionState === 'stopping' }"
          :loading="taskActionState === 'submitting' || taskActionState === 'stopping'"
          :disabled="taskActionState === 'submitting' || taskActionState === 'stopping'"
          @click="handleTaskAction"
        >{{ taskActionState === 'stopping' ? '正在停止…' : taskActionState === 'running' ? '停止任务' : '立即执行' }}</el-button>
      </el-form>
    </div>

    <div class="toast-wrap" :class="{ show: toastVisible }">
      <div class="toast" :class="{ 'toast-loading': toastLoading }">
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
.search-note { margin: 0 0 16px; color: #86909c; font-size: 12px; line-height: 1.6; }
.settings-section { min-width: 0; }
.settings-section-output { margin-top: 20px; padding-top: 20px; border-top: 1px solid #f0f1f3; }
.settings-section-heading { display:flex; align-items:center; gap:8px; margin:0 0 12px; color:#1d2129; font-size:16px; font-weight:500; line-height:22px; }
.settings-step { display:inline-flex; align-items:center; justify-content:center; width:20px; height:20px; color:#a8071a; background:#fff1f2; border-radius:50%; font-size:12px; font-weight:600; line-height:20px; }
.field-stack,.field-selection-content { width:100%; }
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
@media (max-width: 420px) {
  .mapping-row { grid-template-columns:minmax(0,1fr) 12px minmax(0,1fr); }
  .mapping-delete { grid-column:3; justify-self:end; }
}
.c-label { display:flex; align-items:center; margin-bottom:8px; color:#1d2129; font-size:14px; font-weight:500; line-height:20px; }
.help-icon { width:16px; height:16px; margin-left:4px; }
.radio-block { display:flex; flex-wrap:wrap; gap:16px; width:100%; }
.select-all-fields { margin-right:0; margin-bottom:8px; }
.field-selection-title { margin-bottom:8px; }
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
.form :deep(.el-form-item__label) { margin-bottom:8px; color:#1d2129; font-size:14px; }
.form :deep(.el-form-item) { margin-bottom:16px; }
.form :deep(.el-form-item__content) { font-size:14px; }
.form :deep(.el-select__wrapper) { min-height:36px; height:36px; padding:0 12px; }
.form :deep(.el-input__wrapper) { min-height:36px; padding:0 12px; }
.form :deep(.el-textarea__inner) { min-height:80px; padding:8px 12px; }
.custom-radio-group { display:flex; flex-direction:column; gap:12px; width:100%; }
.custom-radio-group :deep(.el-radio) { display:flex; align-items:center; flex-wrap:nowrap; width:100%; margin-right:0; }
.custom-radio-group :deep(.el-radio__input) { flex-shrink:0; margin-right:8px; }
.custom-radio-group :deep(.el-radio__inner) { width:16px; height:16px; border-color:#e5e6eb; background:#fff; }
.custom-radio-group :deep(.el-radio__input.is-checked .el-radio__inner) { border-color:#a8071a; background:#fff; border-width:4px; }
.custom-radio-group :deep(.el-radio__inner::after) { display:none; }
.custom-radio-group :deep(.el-radio__label) { display:flex; align-items:center; width:100%; padding-left:0; color:#1d2129; font-size:14px; line-height:22px; }
.radio-label-text { flex-shrink:0; }
.custom-stepper-input { display:flex; align-items:center; width:80px; height:32px; margin-left:8px; overflow:hidden; border:1px solid #e5e6eb; border-radius:6px; background:#fff; }
.custom-stepper-input.is-disabled { background:#f2f3f5; }
.custom-stepper-input input { width:100%; height:100%; padding:0 8px; border:0; outline:0; background:transparent; font:inherit; }
.custom-stepper-input input::-webkit-outer-spin-button,.custom-stepper-input input::-webkit-inner-spin-button { margin:0; -webkit-appearance:none; }
.range-unit { flex-shrink:0; margin-left:8px; color:#4e5969; font-size:14px; white-space:nowrap; }
.range-cost { margin-top:8px; color:#86909c; font-size:12px; line-height:20px; }
.stepper-buttons { display:flex; flex-direction:column; width:28px; height:100%; flex-shrink:0; border-left:1px solid #e5e6eb; background:#f2f3f5; }
.stepper-btn { flex:1; width:100%; padding:0; border:0; background:transparent; cursor:pointer; }
.stepper-btn-up { border-bottom:1px solid #e5e6eb; }
.stepper-btn::before { display:block; width:0; height:0; margin:auto; border-right:4px solid transparent; border-left:4px solid transparent; content:''; }
.stepper-btn-up::before { border-bottom:4px solid #86909c; }
.stepper-btn-down::before { border-top:4px solid #86909c; }
.stepper-btn:not(:disabled):hover { background:#fff0f2; }
.stepper-btn:disabled { cursor:not-allowed; }
.blogger-search-page { min-height:100vh; background:#fffcfc; font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif; }
.sub-page-header { display:grid; grid-template-columns:32px minmax(0,1fr); align-items:center; gap:8px; min-height:48px; padding:0 8px; position:sticky; top:0; z-index:100; background:#fff; border-bottom:1px solid #e5e6eb; }
.sub-page-back { display:flex; align-items:center; justify-content:center; width:32px; height:32px; margin-right:0; cursor:pointer; color:#4e5969; transition:color .2s; }
.sub-page-back:hover { color:#a8071a; }
.sub-page-back svg { width:100%; height:100%; stroke-width:1.6; stroke-linecap:round; stroke-linejoin:round; }
.sub-page-title { overflow:hidden; color:#1d2129; font-size:18px; font-weight:600; line-height:24px; text-overflow:ellipsis; white-space:nowrap; }
.form-card { box-sizing:border-box; margin:16px; padding:20px; background:#fff; border:1px solid #e5e6eb; border-radius:8px; }
.commit-btn { width:100%; height:36px; margin-top:0; border:0; border-radius:6px; background:#a8071a; color:#fff; font-size:14px; font-weight:500; }
.commit-btn:hover { background:#c11126; }
.commit-btn:active { background:#8a0515; }
.commit-btn.is-running { border:1px solid #d5495c; background:#fff; color:#a8071a; }
.commit-btn.is-running:hover { background:#fff1f2; }
.commit-btn.is-running:active { background:#ffe4e6; }
.commit-btn.is-running.is-disabled { border-color:#e5e6eb; background:#fafafa; color:#86909c; cursor:not-allowed; }
.toast-wrap { position:fixed; top:50%; left:50%; z-index:9999; width:max-content; max-width:calc(100vw - 32px); pointer-events:none; opacity:0; transform:translate(-50%,-50%) scale(.95); transition:opacity .3s ease,transform .3s ease; }
.toast-wrap.show { opacity:1; transform:translate(-50%,-50%) scale(1); }
.toast { display:inline-flex; align-items:center; gap:8px; box-sizing:border-box; max-width:calc(100vw - 32px); padding:8px 16px; border:1px solid #e5e6eb; border-radius:8px; background:#fff; box-shadow:0 8px 24px rgba(0,0,0,.12); color:#1d2129; font-size:14px; font-weight:500; line-height:22px; white-space:normal; overflow-wrap:anywhere; }
.toast-icon { display:flex; align-items:center; justify-content:center; flex-shrink:0; width:18px; height:18px; }
.toast-icon svg { width:100%; height:100%; }
.toast-loading .toast-icon { color:#a8071a; animation:spin .8s linear infinite; }
@keyframes spin { to { transform:rotate(360deg); } }
</style>
