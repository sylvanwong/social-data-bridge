<script setup>
import TaskExecutionResult from './TaskExecutionResult.vue';
import { buildTaskExecutionResult } from '../utils/taskExecutionResult.mjs';
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { bitable, DateFormatter, FieldType, NumberFormatter } from '@lark-base-open/js-sdk';
import { ElMessage } from 'element-plus';
import { feishuRequest, buildFeishuApiPath, FEISHU_API_BASE_URL, FEISHU_API_PATH_PREFIX } from '@/utils/request';
import { useSocialData } from '../composables/useSocialData';
import { useTaskFeedback } from '../composables/useTaskFeedback.mjs';
import { createTableConfigSaver, parseTableConfigList } from '../utils/tableOutputConfig.mjs';
import { buildProductSearchRequest, createProductSearchFields, normalizeProductSearchItem, PRODUCT_SEARCH_SORTS, PRODUCT_SEARCH_SERVICES } from '../utils/productSearch.mjs';
import { useIncrementalTask } from '../composables/useIncrementalTask';
import { getPendingWriteLimit } from '../utils/taskWriteState.mjs';
import { getTaskStoppingText } from '../utils/taskStopText';
import TaskFeedback from './TaskFeedback.vue';
import PageStepper from './PageStepper.vue';

const latestExecutionResult = ref(null);

const props = defineProps({ api_key: String });
const emit = defineEmits(['back']);
const FIELD_CONFIG = createProductSearchFields({ FieldType, DateFormatter, NumberFormatter });
const selectedKeys = ref(FIELD_CONFIG.filter(field => field.defaultSelected).map(field => field.key));
const form = ref({ platform: 'douyin', keyword: '', sortType: 'general', minPrice: '', maxPrice: '', sellingPoint: 'all',
  range: 'pages', pages: 1, targetType: 'new', targetTableId: '', writeMode: 'upsert' });
const loading = ref(false), stopping = ref(false), ready = ref(false);
const submitting = ref(false), clearing = ref(false), hasRecoverableTask = ref(false), requiresReopen = ref(false);
const activeTaskId = ref('');
const tableOptions = ref([]), targetFields = ref([]), mappings = ref([]), mappingExpanded = ref(false);
const targetLoading = ref(false), targetError = ref(''), loadedTableId = ref('');
const configSaveErrors = ref({});
const saveError = computed(() => form.value.targetType === 'existing' ? configSaveErrors.value[form.value.targetTableId] || '' : '');
const pendingConfigSaves = ref({});
const configSaving = computed(() => form.value.targetType === 'existing' && !!pendingConfigSaves.value[form.value.targetTableId]);
const configSavingMessage = '正在保存字段映射…';
const hasPendingConfigSave = computed(() => Object.values(pendingConfigSaves.value).some(count => count > 0));
const backDisabled = computed(() => loading.value || submitting.value || hasPendingConfigSave.value);
let backSaveNotice;
const clearBackSaveNotice = () => {
  const notice = backSaveNotice;
  backSaveNotice = undefined;
  notice?.close();
};
const handleBack = event => {
  if (loading.value || submitting.value) return;
  if (hasPendingConfigSave.value) {
    if (!backSaveNotice) {
      const headerBottom = event.currentTarget.parentElement.getBoundingClientRect().bottom;
      const notice = ElMessage({
        message: configSavingMessage, type: 'info', plain: true, duration: 0,
        offset: headerBottom + 8,
        customClass: 'product-search-back-save-notice',
        onClose: () => { if (backSaveNotice === notice) backSaveNotice = undefined; },
      });
      backSaveNotice = notice;
    }
    return;
  }
  emit('back');
};
const feedback = useTaskFeedback();
const { toastVisible, toastText, toastType, taskNotice } = feedback;
const { createAndWriteData, validateTableFields } = useSocialData(() => '商品搜索', '', FIELD_CONFIG);
let disposed = false, readId = 0, applying = false;
let selectedKeysBeforeRecovery;
const drafts = new Map();
const latestConfigSaves = new Map();
const headers = () => ({ authorization: `Bearer ${props.api_key}` });
const platformFields = computed(() => FIELD_CONFIG.filter(field => !field.platform || field.platform === form.value.platform));
const activeKeys = computed(() => platformFields.value.filter(field => selectedKeys.value.includes(field.key)).map(field => field.key));
const isCompleteMapping = row => Boolean(row.source_key && row.target_field_id);
const isMappingVisible = row => {
  if (row.draftPlatform && !isCompleteMapping(row)) return row.draftPlatform === form.value.platform;
  return !row.source_key || activeKeys.value.includes(row.source_key);
};
const visibleMappings = computed(() => mappings.value.map((row, index) => ({ row, index }))
  .filter(({ row }) => isMappingVisible(row)));
const hasIncompleteMappings = computed(() => visibleMappings.value.some(({ row }) => !isCompleteMapping(row)));
const incompleteMappingMessage = '请完成字段映射，或删除未完成的映射';
const toFieldMapping = ({ source_key, target_field_id }) => ({ source_key, target_field_id });
const addMapping = () => {
  mappings.value.push({ source_key: '', target_field_id: '', draftPlatform: form.value.platform });
};
const allSelected = computed(() => platformFields.value.every(field => selectedKeys.value.includes(field.key)));
const partlySelected = computed(() => !allSelected.value && activeKeys.value.length > 1);
const outputReady = computed(() => !loading.value && !targetLoading.value && !targetError.value && loadedTableId.value === form.value.targetTableId && !!loadedTableId.value);
const fieldSelectionLocked = computed(() => {
  const { targetType, targetTableId } = form.value;
  return targetType === 'existing' && !!targetTableId && !outputReady.value && !drafts.has(targetTableId);
});
const updateSelectedKeys = keys => {
  if (!fieldSelectionLocked.value) selectedKeys.value = keys;
};
const toggleAll = checked => {
  updateSelectedKeys(FIELD_CONFIG.filter(field => platformFields.value.includes(field)
    ? checked || field.required : selectedKeys.value.includes(field.key)).map(field => field.key));
};
const mappingFieldUsed = (index, key, value) => mappings.value.some((row, i) =>
  i !== index && row[key] === value && (isCompleteMapping(row) || isMappingVisible(row)));
const sourceOptions = index => platformFields.value.filter(field => selectedKeys.value.includes(field.key)).map(field => ({ ...field,
  disabled: mappingFieldUsed(index, 'source_key', field.key) }));
const targetOptions = index => targetFields.value.map(field => ({ ...field,
  disabled: mappingFieldUsed(index, 'target_field_id', field.id) }));
const updateMapping = (index, key, value) => {
  const row = mappings.value[index];
  const next = { ...row, [key]: value };
  if (isCompleteMapping(next)) {
    const duplicateSource = mappingFieldUsed(index, 'source_key', next.source_key);
    const duplicateTarget = mappingFieldUsed(index, 'target_field_id', next.target_field_id);
    if (duplicateSource || duplicateTarget) {
      const field = duplicateSource ? '源字段' : '目标字段';
      ElMessage({ type: 'warning', plain: true, message: `该${field}已被其他映射使用，请更换${field}` });
      return;
    }
  }
  row[key] = value;
};
const assertMounted = value => { if (disposed) { const error = new Error('页面已离开'); error.stopPolling = true; throw error; } return value; };

const configPath = buildFeishuApiPath('/v1/feishu/profile-fetch/table-output-config');
const saveConfig = createTableConfigSaver(async config => {
  assertMounted();
  const baseId = (await bitable.base.getSelection()).baseId; assertMounted();
  const response = await feishuRequest({ url: configPath, method: 'put', headers: headers(), data: { ...config, base_id: baseId } });
  if (response.data?.sta !== 0) throw new Error(response.data?.msg || '保存表格配置失败');
});
const loadTarget = async () => {
  if (loading.value || hasRecoverableTask.value) return;
  const id = ++readId, tableId = form.value.targetTableId;
  loadedTableId.value = ''; targetFields.value = []; targetError.value = '';
  targetLoading.value = true;
  const owns = () => !disposed && id === readId && form.value.targetType === 'existing' && tableId === form.value.targetTableId;
  try {
    if (!tableId || form.value.targetType !== 'existing') return;
    const table = await bitable.base.getTableById(tableId); if (!owns()) return;
    const fields = await table.getFieldMetaList(); if (!owns()) return;
    const baseId = (await bitable.base.getSelection()).baseId; if (!owns()) return;
    const response = await feishuRequest({ url: `${configPath}s`, method: 'get', headers: headers(), params: { base_id: baseId, plugin_type: 'product_search' } });
    if (!owns()) return;
    if (response.data?.sta !== 0) throw new Error(response.data?.msg || '读取表格配置失败');
    const cloud = parseTableConfigList(response.data.data).find(row => row.target_table_id === tableId);
    const config = drafts.get(tableId) || cloud || { write_mode: 'upsert', field_mappings: [] };
    applying = true;
    form.value.writeMode = config.write_mode === 'append' ? 'append' : 'upsert';
    mappings.value = (config.field_mappings || []).filter(row => !row.source_key || selectedKeys.value.includes(row.source_key)).map(row => ({ ...row }));
    applying = false;
    // 配置回显不能替换已有草稿，否则在途保存会丢失归属。
    if (!drafts.has(tableId)) drafts.set(tableId, { write_mode: form.value.writeMode, field_mappings: mappings.value.map(row => ({ ...row })) });
    targetFields.value = fields; loadedTableId.value = tableId;
  } catch (error) { if (owns()) targetError.value = error?.message || '读取表格配置失败'; }
  finally { if (!disposed && id === readId) targetLoading.value = false; }
};
const persistOutput = async () => {
  if (disposed || applying || !outputReady.value) return;
  const tableId = loadedTableId.value;
  const draft = { write_mode: form.value.writeMode, field_mappings: mappings.value.map(row => ({ ...row })) };
  drafts.set(tableId, draft);
  if (hasIncompleteMappings.value) return;
  const request = {
    targetTableId: tableId, target_table_id: tableId, plugin_type: 'product_search',
    write_mode: draft.write_mode, field_mappings: draft.field_mappings.filter(isCompleteMapping).map(toFieldMapping),
  };
  latestConfigSaves.set(tableId, request);
  configSaveErrors.value[tableId] = '';
  pendingConfigSaves.value[tableId] = (pendingConfigSaves.value[tableId] || 0) + 1;
  try {
    await saveConfig(request);
  } catch (error) {
    if (!disposed && latestConfigSaves.get(tableId) === request) configSaveErrors.value[tableId] = error.message;
  } finally {
    if (latestConfigSaves.get(tableId) === request) latestConfigSaves.delete(tableId);
    if (!disposed) {
      pendingConfigSaves.value[tableId]--;
      if (!hasPendingConfigSave.value) clearBackSaveNotice();
    }
  }
};
const retrySave = () => {
  if (hasIncompleteMappings.value) {
    ElMessage({ message: incompleteMappingMessage, type: 'error', plain: true, duration: 3000 });
    return;
  }
  return persistOutput();
};
watch([() => form.value.writeMode, mappings], persistOutput, { deep: true, flush: 'sync' });
watch([() => form.value.targetType, () => form.value.targetTableId], loadTarget);
watch(selectedKeys, keys => {
  if (!ready.value || loading.value) return;
  mappings.value = mappings.value.filter(row => !row.source_key || keys.includes(row.source_key));
  // 配置重读期间也保留已加载草稿的删减；云端保存仍等待 outputReady。
  const draft = form.value.targetType === 'existing' && drafts.get(form.value.targetTableId);
  if (draft && !applying && !submitting.value && !hasRecoverableTask.value) {
    draft.field_mappings = draft.field_mappings.filter(row => !row.source_key || keys.includes(row.source_key));
  }
  void bitable.bridge.setData('product_search_fields_v1', [...keys]).catch(error => { if (!disposed) ElMessage({ type: 'error', message: error.message }); });
}, { deep: true });
const loadTables = async () => {
  try { const tables = await bitable.base.getTableMetaList(); if (!disposed) tableOptions.value = tables; }
  catch (error) { if (!disposed) ElMessage({ type: 'error', message: error.message || '读取表格列表失败' }); }
};
onMounted(async () => {
  await loadTables();
  try {
    const keys = await bitable.bridge.getData('product_search_fields_v1'); if (disposed) return;
    if (Array.isArray(keys)) selectedKeys.value = FIELD_CONFIG.filter(field => field.required || keys.includes(field.key)).map(field => field.key);
    ready.value = true;
  } catch (error) { if (!disposed) { ready.value = true; ElMessage({ type: 'error', message: '读取字段选择失败，已使用默认字段' }); } }
  if (!disposed && props.api_key) await resumeSavedTask();
});
onUnmounted(() => { disposed = true; readId++; clearBackSaveNotice(); searchTask.stop(); });
const path = (task, endpoint) => buildFeishuApiPath('/v1/feishu/product/search' + endpoint, task.apiPathPrefix ?? FEISHU_API_PATH_PREFIX);
const stopText = task => getTaskStoppingText(task, '商品');
const restoreTask = async (task, restoring = false) => {
  if (disposed) return;
  hasRecoverableTask.value = true; loading.value = true; activeTaskId.value = task.taskId;
  stopping.value = Number(task.latestStatus?.status) === 3 || !!task.latestStatus?.cancel_requested;
  if (restoring && task.formData) {
    selectedKeysBeforeRecovery ??= [...selectedKeys.value];
    applying = true;
    form.value = JSON.parse(JSON.stringify(task.formData));
    selectedKeys.value = [...task.selectedFieldKeys];
    mappings.value = (task.fieldMappings || []).map(row => ({ ...row }));
    await nextTick(); applying = false;
  }
  if (!disposed) feedback.progress(stopping.value ? stopText(task) : restoring ? '正在恢复未完成的商品搜索任务…' : '任务已创建，正在准备获取商品…');
};
const searchTask = useIncrementalTask({
  storageKey: 'product_search_stream_task_v1', operationTimeoutMs: 180000,
  isTerminal: status => [1, 2, 3].includes(Number(status.status)),
  getStatus: async task => (await feishuRequest({ url: path(task, `/task?task_id=${encodeURIComponent(task.taskId)}`), method: 'get', baseURL: task.apiBaseUrl ?? FEISHU_API_BASE_URL, headers: headers() })).data,
  getResults: async task => (await feishuRequest({ url: path(task, '/list'), method: 'post', baseURL: task.apiBaseUrl ?? FEISHU_API_BASE_URL, headers: headers(), data: { task_id: task.taskId, after_id: task.cursor || '', limit: getPendingWriteLimit(task, 40) ?? 40 } })).data,
  writeBatch: async (items, task, controls) => {
    const reconcile = task.pendingWrite ?? !!task.targetTableId;
    task.pendingWrite = reconcile;
    const resumingInitialization = !!task.targetTableId && task.initializingTableId === task.targetTableId && !reconcile;
    const appendState = task.writeMode === 'append' ? (task.appendState ||= {}) : undefined;
    const rows = items.map(item => normalizeProductSearchItem(task.formData.platform, item));
    const result = await createAndWriteData(rows, task.targetTableId ? 'stream' : '', task.taskId, task.targetTableId || '', task.selectedFieldKeys, {
      stopAfterCurrentBatch: true, uniqueKey: 'product_id', writeMode: task.writeMode || 'upsert',
      initializingTableId: task.initializingTableId, reconcile, skipFieldDisplayConfig: !resumingInitialization,
      ...(appendState ? { appendState, fieldOrder: task.selectedFieldKeys } : {}),
      assertActive: controls.assertActive, fieldMappings: task.fieldMappings || [], upsertCacheKey: task.taskId,
      onProgress: message => { if (!disposed) feedback.progress(stopping.value ? stopText(task) : message, { stopping: stopping.value }); },
      onTableInitialized: async () => { controls.assertActive(); task.initializingTableId = ''; await controls.saveProgress(); },
      onBeforeWrite: async () => { controls.assertActive(); task.pendingWrite = true; task.pendingWriteCount = rows.length; await controls.saveProgress(); },
      onTargetTableReady: async id => { controls.assertActive(); task.targetTableId = id; task.initializingTableId = id; await controls.saveProgress(); },
    });
    controls.assertActive(); task.targetTableId = result?.tableId || task.targetTableId;
    task.pendingWrite = false; delete task.pendingWriteCount;
  },
  onProgress: (status, task, phase) => {
    if (disposed) return;
    clearing.value = phase === 'clearing';
    if (clearing.value) { feedback.progress('正在清理任务进度…'); return; }
    if (Number(status.status) === 3 || status.cancel_requested) stopping.value = true;
    const processed = Number(status.processed) || 0, total = Number(status.total) || 0;
    feedback.progress(stopping.value ? stopText(task) : `已处理 ${total ? `${processed}/${total}` : processed} 个搜索页，已写入 ${task.writtenCount || 0} 条商品，请勿关闭插件，关闭将中断数据写入`, { stopping: stopping.value });
  },
  onWriting: (items, task) => { if (!disposed) feedback.progress(stopping.value ? stopText(task) : `正在写入 ${items.length} 条商品，已写入 ${task.writtenCount || 0} 条商品，请勿关闭插件，关闭将中断数据写入`, { stopping: stopping.value }); },
  onFinish: async (status, task) => {
    if (disposed) return;
    latestExecutionResult.value = buildTaskExecutionResult(status, task, { kind: 'productSearch' });
    if (selectedKeysBeforeRecovery) {
      selectedKeys.value = selectedKeysBeforeRecovery;
      selectedKeysBeforeRecovery = undefined;
      // 先恢复勾选再解锁，避免把任务回显或收尾当成用户编辑。
      await nextTick();
      if (disposed) return;
    }
    clearing.value = false; loading.value = false; stopping.value = false; activeTaskId.value = ''; hasRecoverableTask.value = false;
    if (form.value.targetType === 'existing') void loadTarget();
    if (Number(status.status) === 2) feedback.fail(`商品搜索失败，已写入 ${task.writtenCount || 0} 条商品：${status.reason || '获取失败'}`);
    else feedback.finish(`${Number(status.status) === 3 ? '任务已停止' : '处理完成'}，已写入 ${task.writtenCount || 0} 条商品${status.scope_warning ? '。' + status.scope_warning : ''}`, { stopped: Number(status.status) === 3, empty: !task.writtenCount, successCount: task.writtenCount });
  },
  onError: (error, task) => {
    if (disposed) return;
    latestExecutionResult.value = { ...buildTaskExecutionResult(task?.latestStatus, task || {}, { kind: 'productSearch' }), status: task?.taskId || error.taskCreated || error.requiresReopen ? 'paused' : 'interrupted', reason: error?.response?.data?.msg || error.message || '任务已暂停' };
    clearing.value = false; loading.value = false; stopping.value = false; activeTaskId.value = '';
    hasRecoverableTask.value = !!task?.taskId || !!error.taskCreated; requiresReopen.value = !!error.requiresReopen;
    feedback.fail(error, { persist: hasRecoverableTask.value, requiresReopen: requiresReopen.value });
  },
});
const resumeSavedTask = async () => {
  if (disposed || loading.value || requiresReopen.value) return;
  loading.value = true;
  latestExecutionResult.value = null;
  feedback.begin('正在检查未完成任务…');
  try {
    const resumed = await searchTask.resume(task => restoreTask(task, true));
    if (!resumed && !disposed) {
      loading.value = false;
      if (hasRecoverableTask.value) feedback.fail('未读取到当前表格的恢复进度，请核对当前多维表格和已写入结果后重试恢复', { persist: true });
      else feedback.hide();
    }
  } catch (error) {
    if (disposed) return;
    loading.value = false; hasRecoverableTask.value = true; requiresReopen.value = !!error.requiresReopen;
    feedback.fail(error, { persist: true, requiresReopen: requiresReopen.value });
  }
};
const handleSubmit = async () => {
  if (disposed || requiresReopen.value || loading.value || submitting.value || !ready.value) return;
  if (hasRecoverableTask.value) return resumeSavedTask();
  const input = JSON.parse(JSON.stringify(form.value));
  const keys = [...activeKeys.value], fieldMappings = input.targetType === 'existing' ? visibleMappings.value.map(({ row }) => toFieldMapping(row)) : [];
  submitting.value = true;
  try {
    if (!props.api_key) throw new Error('请先在首页配置 API Key');
    const { keyword, page_token, ...filter_config } = buildProductSearchRequest(input);
    if (input.range !== 'all' && (!Number.isInteger(input.pages) || input.pages < 1 || input.pages > 50)) throw new Error('商品获取页数须为1到50的整数');
    if (input.targetType === 'existing' && (!input.targetTableId || !outputReady.value)) throw new Error(targetError.value || '请等待目标表配置就绪，或重新读取配置');
    if (!fieldMappings.every(isCompleteMapping)) throw new Error(incompleteMappingMessage);
    const targetId = input.targetType === 'existing' ? input.targetTableId : '';
    latestExecutionResult.value = null;
    feedback.begin('正在启动商品搜索…');
    loading.value = true; stopping.value = false;
    if (targetId) await validateTableFields(targetId, keys, {
      uniqueKey: 'product_id', writeMode: input.writeMode, fieldMappings, formatFieldsOnCreate: true,
      assertActive: assertMounted, throwOnError: true, onProgress: feedback.progress,
    });
    assertMounted();
    await searchTask.submit(async () => {
      const response = await feishuRequest({ url: buildFeishuApiPath('/v1/feishu/product/search/task'), method: 'post', headers: headers(),
        data: { social_type: input.platform, keyword, pages: input.range === 'all' ? 0 : input.pages, filter_config, selected_field_keys: keys } });
      if (response.data?.sta !== 0 || !response.data.data?.task_id) throw new Error(response.data?.msg || '创建任务未返回任务ID');
      return { taskId: response.data.data.task_id, pendingWrite: false, apiBaseUrl: FEISHU_API_BASE_URL, apiPathPrefix: FEISHU_API_PATH_PREFIX,
        formData: input, selectedFieldKeys: keys, fieldMappings, writeMode: input.writeMode, targetTableId: targetId };
    }, task => restoreTask(task));
  } catch (error) {
    if (!disposed) {
      if (loading.value) feedback.fail(error);
      else {
        feedback.hide();
        ElMessage({ message: error?.response?.data?.msg || error?.message || String(error), type: 'error', plain: true, duration: 3000 });
      }
      loading.value = false;
    }
  }
  finally { if (!disposed) submitting.value = false; }
};
const cancelTask = async () => {
  const task = searchTask.getActiveTask();
  if (!task?.taskId || stopping.value || clearing.value) return;
  stopping.value = true; feedback.progress(stopText(task), { stopping: true });
  try {
    const response = await feishuRequest({ url: path(task, '/task/cancel'), method: 'post', baseURL: task.apiBaseUrl ?? FEISHU_API_BASE_URL, headers: headers(), data: { task_id: task.taskId } });
    if (response.data?.sta !== 0) throw new Error(response.data?.msg || '停止任务失败');
  } catch (error) {
    if (disposed || searchTask.getActiveTask() !== task || clearing.value) return;
    stopping.value = Number(task.latestStatus?.status) === 3 || !!task.latestStatus?.cancel_requested;
    ElMessage({ type: 'error', message: error.message || '停止任务失败' });
    feedback.progress(stopping.value ? stopText(task) : `任务继续执行，已写入 ${task.writtenCount || 0} 条商品`);
  }
};
const actionState = computed(() => requiresReopen.value ? 'reopen' : clearing.value ? 'clearing' : stopping.value ? 'stopping' : loading.value && activeTaskId.value ? 'running' : loading.value || submitting.value || !ready.value ? 'submitting' : hasRecoverableTask.value ? 'recoverable' : 'idle');
const actionText = computed(() => ({ reopen: '请重新进入插件恢复', clearing: '执行中…', stopping: '正在停止…', running: '停止任务', submitting: '准备中…', recoverable: '恢复任务', idle: '立即执行' })[actionState.value]);
const handleAction = () => actionState.value === 'running' ? cancelTask() : actionState.value === 'recoverable' ? resumeSavedTask() : actionState.value === 'idle' ? handleSubmit() : undefined;
</script>

<template>
  <div class="sub-page product-search">
    <div class="sub-page-header">
      <span class="sub-page-back" :aria-disabled="backDisabled" @click="handleBack"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16"><polyline points="15 18 9 12 15 6" /></svg></span>
      <span class="sub-page-title">商品搜索</span>
    </div>
    <div class="form-card">
      <div :inert="loading || submitting || hasRecoverableTask || requiresReopen || !ready ? '' : null" :aria-busy="loading">
        <el-form class="form" label-position="top">
          <section class="settings-section" aria-labelledby="product-search-settings">
            <h2 id="product-search-settings" class="settings-section-heading"><span class="settings-step">1</span>获取设置</h2>
            <el-form-item><div class="c-label">商品平台</div><el-select v-model="form.platform" style="width:100%"><el-option value="douyin" label="抖音" /><el-option value="xhs" label="小红书" /></el-select></el-form-item>
            <el-form-item><div class="c-label">商品关键词</div><el-input v-model="form.keyword" type="textarea" :rows="3" placeholder="请输入商品名称、品牌或品类，多个关键词用换行、中英文逗号分隔，最多100个" /></el-form-item>
            <template v-if="form.platform === 'douyin'">
              <el-form-item><div class="c-label">商品排序</div><el-select v-model="form.sortType" style="width:100%"><el-option v-for="item in PRODUCT_SEARCH_SORTS" :key="item.value" :value="item.value" :label="item.label" /></el-select></el-form-item>
              <el-form-item><div class="c-label">价格区间</div><div class="price-range"><el-input v-model="form.minPrice" type="number" min="1" step="1" placeholder="最低价格" /><span>至</span><el-input v-model="form.maxPrice" type="number" min="1" step="1" placeholder="最高价格" /></div></el-form-item>
              <el-form-item><div class="c-label">卖点筛选</div><el-select v-model="form.sellingPoint" style="width:100%"><el-option value="all" label="不限" /><el-option value="high_sales" label="月销过万" /><el-option value="high_rating" label="好评多" /></el-select></el-form-item>
              <el-form-item><div class="c-label">商品服务</div><div class="service-options"><el-checkbox v-for="item in PRODUCT_SEARCH_SERVICES" :key="item.key" v-model="form[item.key]">{{ item.label }}</el-checkbox></div></el-form-item>
            </template>
            <el-form-item>
              <div class="c-label">商品获取范围</div>
              <el-radio-group v-model="form.range" class="custom-radio-group" aria-label="商品获取范围">
                <el-radio value="pages">
                  <span>前</span>
                  <PageStepper :model-value="form.pages" label="商品获取页数" :disabled="form.range !== 'pages'" round-to-integer
                    @update:model-value="form.pages = $event === '' ? null : $event" />
                  <span class="range-unit">页</span>
                </el-radio>
                <el-radio value="all">全部商品</el-radio>
              </el-radio-group>
            </el-form-item>
          </section>
          <section class="settings-section settings-section-output" aria-labelledby="product-search-output">
            <h2 id="product-search-output" class="settings-section-heading"><span class="settings-step">2</span>输出设置</h2>
            <el-form-item><div class="c-label">输出到表格</div><el-radio-group v-model="form.targetType"><el-radio value="new">新建表格</el-radio><el-radio value="existing">使用现有表格</el-radio></el-radio-group></el-form-item>
            <template v-if="form.targetType === 'existing'">
              <el-form-item><div class="c-label">选择现有表格</div><el-select v-model="form.targetTableId" style="width:100%" @visible-change="value => value && loadTables()"><el-option v-for="table in tableOptions" :key="table.id" :value="table.id" :label="table.name" /></el-select></el-form-item>
              <p v-if="targetLoading" class="sub-hint">正在读取目标表配置…</p>
              <p v-if="targetError" class="sub-hint" role="alert">{{ targetError }} <el-button link type="primary" @click="loadTarget">重新读取配置</el-button></p>
              <p v-if="configSaving" class="sub-hint" role="status">{{ configSavingMessage }}</p>
              <p v-else-if="saveError" class="sub-hint" role="alert">
                {{ saveError }}
                <el-button v-if="outputReady" link type="primary" @click="retrySave">重试保存</el-button>
                <span v-else-if="targetError">请先重新读取配置</span>
              </p>
              <el-form-item><div class="c-label">数据写入方式</div><el-radio-group v-model="form.writeMode" :disabled="!outputReady"><el-radio value="upsert">更新或新增</el-radio><el-radio value="append">始终新增</el-radio></el-radio-group></el-form-item>
            </template>
            <div class="field-selection-content">
              <div class="c-label">输出字段</div>
              <el-checkbox class="select-all-fields" :model-value="allSelected" :indeterminate="partlySelected" :disabled="fieldSelectionLocked" @change="toggleAll">全选</el-checkbox>
              <el-checkbox-group :model-value="selectedKeys" @update:model-value="updateSelectedKeys" class="field-checkbox-group" aria-label="输出字段">
                <el-checkbox v-for="field in platformFields" :key="field.key" :label="field.key" :disabled="fieldSelectionLocked || field.required" class="field-checkbox-item">
                  {{ field.name }}
                </el-checkbox>
              </el-checkbox-group>
            </div>
            <div v-if="form.targetType === 'existing'" class="mapping-accordion">
              <button type="button" class="mapping-accordion-trigger" :aria-expanded="mappingExpanded" @click="mappingExpanded = !mappingExpanded"><span class="ui-disclosure-label">字段映射 <span class="ui-disclosure-meta">（可选）</span></span><span class="mapping-chevron" :class="{ 'is-expanded': mappingExpanded }" /></button>
              <div v-if="mappingExpanded" class="mapping-accordion-body">
                <p class="mapping-note">同名字段将自动写入；不同名时请在下方指定目标列。未映射且没有同名列时，将自动新建同名列。</p>
                <div v-for="{ row, index } in visibleMappings" :key="index" class="mapping-row">
                  <el-select :model-value="row.source_key" :disabled="!outputReady" placeholder="选择输出字段" size="small"
                    @update:model-value="value => updateMapping(index, 'source_key', value)">
                    <el-option v-for="field in sourceOptions(index)" :key="field.key" :label="field.name" :value="field.key" :disabled="field.disabled" />
                  </el-select>
                  <span>→</span>
                  <el-select :model-value="row.target_field_id" :disabled="!outputReady" placeholder="选择目标字段" size="small"
                    @update:model-value="value => updateMapping(index, 'target_field_id', value)">
                    <el-option v-for="field in targetOptions(index)" :key="field.id" :label="field.name" :value="field.id" :disabled="field.disabled" />
                  </el-select>
                  <el-button link type="danger" :disabled="!outputReady" @click="mappings.splice(index, 1)">删除</el-button>
                </div>
                <div class="mapping-actions">
                  <el-button link type="primary" :disabled="!outputReady" @click="addMapping">+ 添加字段映射</el-button>
                </div>
              </div>
            </div>
          </section>
        </el-form>
      </div>
      <div v-if="taskNotice" class="task-notice" role="status">{{ taskNotice }}</div>
      <div class="action-group"><el-button class="commit-btn" :class="{ 'is-running': actionState === 'running' || actionState === 'stopping' }" :loading="['submitting', 'stopping', 'clearing'].includes(actionState)" :disabled="['submitting', 'stopping', 'clearing', 'reopen'].includes(actionState)" @click="handleAction">{{ actionText }}</el-button></div>
    </div>
    <TaskExecutionResult :result="latestExecutionResult" />

    <TaskFeedback :visible="toastVisible" :text="toastText" :kind="toastType" />
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
.sub-page-back[aria-disabled="true"] { cursor: not-allowed; color: #86909c; }
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
:global(.el-message.is-center.product-search-back-save-notice) { transform: translateX(-50%); }
.form-card {
  margin: 16px;
  padding: 20px;
  background: #FFFFFF;
  border: 1px solid #E5E6EB;
  border-radius: 8px;
  box-sizing: border-box;
}

.form { display:flex; flex-direction:column; gap:var(--app-space-section); }
.settings-section { display:flex; flex-direction:column; gap:var(--app-space-group); }
.settings-section-heading { display:flex; align-items:center; gap:8px; font-size:16px; font-weight:500; margin:0; }
.settings-step { display:inline-flex; align-items:center; justify-content:center; width:20px; height:20px; border-radius:50%; background:#fff1f2; color:#a8071a; font-size:12px; }
.price-range { display:flex; align-items:center; gap:8px; width:100%; }
.service-options { display:flex; flex-wrap:wrap; gap:0 16px; }
.field-checkbox-group { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px 16px; width:100%; }
.service-options :deep(.el-checkbox),.field-checkbox-item { margin-right:0; height:auto; min-height:30px; }
.select-all-fields { display:flex; width:100%; margin:8px 0; }
.field-selection-content :deep(.el-checkbox) {
  --el-checkbox-input-width:16px;
  --el-checkbox-input-height:16px;
  --el-checkbox-border-radius:4px;
  --el-checkbox-disabled-checked-input-fill:var(--el-checkbox-checked-bg-color);
  --el-checkbox-disabled-checked-input-border-color:var(--el-checkbox-checked-input-border-color);
  --el-checkbox-disabled-checked-icon-color:var(--el-checkbox-checked-icon-color);
}
.field-selection-content :deep(.el-checkbox__input + .el-checkbox__label) { color:#1d2129; font-family:inherit; font-size:var(--app-font-size-body); font-weight:var(--app-font-weight-regular); line-height:22px; }
.custom-radio-group { display:flex; flex-direction:column; align-items:stretch; gap:var(--app-space-control); width:100%; }
.custom-radio-group :deep(.el-radio) { display:flex; align-items:center; flex-wrap:nowrap; height:32px; margin-right:0; }
.custom-radio-group :deep(.el-radio__input) { flex-shrink:0; margin-right:var(--app-space-control); }
.custom-radio-group :deep(.el-radio__inner) { width:16px; height:16px; border-color:#e5e6eb; }
.custom-radio-group :deep(.el-radio__input.is-checked .el-radio__inner) { border:4px solid #a8071a; background:#fff; }
.custom-radio-group :deep(.el-radio__inner::after) { display:none; }
.custom-radio-group :deep(.el-radio__label) { display:flex; align-items:center; padding-left:0; min-width:0; color:#1d2129; font-size:var(--app-font-size-body); font-weight:var(--app-font-weight-regular); line-height:22px; }
.range-unit { margin-left:var(--app-space-control); color:#4e5969; }
.mapping-accordion-trigger { display:flex; align-items:center; justify-content:space-between; width:100%; min-height:32px; padding:0; background:transparent; border:0; color:#1d2129; cursor:pointer; text-align:left; }
.mapping-accordion-body { padding-top:var(--app-space-control); }
.mapping-note { margin:0 0 12px; color:#86909c; font-size:12px; font-weight:400; line-height:18px; }
.mapping-chevron { width:8px; height:8px; margin-right:4px; border-right:1.5px solid #86909c; border-bottom:1.5px solid #86909c; transform:rotate(45deg) translateY(-2px); }
.mapping-chevron.is-expanded { transform:rotate(225deg) translateY(-2px); }
.mapping-row { display:flex; gap:8px; align-items:center; }
.mapping-row + .mapping-row { margin-top:var(--app-space-control); }
.mapping-row :deep(.el-select) { flex:1; min-width:0; }
.mapping-actions { padding-top:var(--app-space-control); }
.c-label { display:block; width:100%; margin-bottom:8px; color:#1d2129; font-size:14px; font-weight:500; line-height:20px; }
.form :deep(.el-form-item) { margin:0; }
.form :deep(.el-input__wrapper),.form :deep(.el-select__wrapper) { min-height:36px; }
.field-checkbox-group :deep(.el-checkbox__label) { white-space:normal; line-height:22px; }
.sub-hint { font-size:12px; color:#8f959e; }
.action-group { margin-top:var(--app-space-group); }
.task-notice { margin-top:16px; font-size:13px; white-space:pre-wrap; overflow-wrap:anywhere; }
</style>
