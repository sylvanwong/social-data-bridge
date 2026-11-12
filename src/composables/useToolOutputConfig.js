import { computed, ref, shallowReactive, onMounted, onUnmounted, watch } from 'vue';
import { bitable, FieldType } from '@lark-base-open/js-sdk';
import request from '@/utils/request';
import { parseTableConfigList } from '../utils/tableOutputConfig.mjs';

const TABLE_CONFIGS_API_PATH = '/social/api/v1/feishu/profile-fetch/table-output-configs';

export function useToolOutputConfig({ props, formData, pluginType, sourceFieldKey, loading, stopRequested, taskFeedback, isUnmounted, selectSavedMappings = rows => rows }) {
  const fieldOptions = ref([]);
  const sourceFieldLoading = ref(false);
  const sourceFieldLoadError = ref('');
  let sourceFieldReadId = 0;
  const sourceContext = { tableId: '', viewId: '', fieldName: '' };
  const mappingDraft = ref([]);
  const targetFieldOptions = ref([]);
  const mainOutputTableId = ref('');
  let targetFieldReadId = 0;
  const targetFieldTableId = ref('');
  const tableConfigLoadError = ref('');
  const tableConfigSaves = shallowReactive(new Map());
  const tableConfigSaveError = computed(() => tableConfigSaves.get(targetFieldTableId.value)?.error || '');
  const tableConfigSaving = computed(() => !!tableConfigSaves.get(targetFieldTableId.value)?.retrying);
  const tableOutputConfigs = ref({});
  const tableConfigsLoaded = ref(false);
  const tableConfigsLoading = ref(false);
  const tableConfigsError = ref('');
  let tableConfigsRequest = null;
  const tableConfigApplying = ref(false);
  const outputConfigReady = computed(() => tableConfigsLoaded.value && !tableConfigsLoading.value && !!mainOutputTableId.value && !tableConfigApplying.value && !tableConfigLoadError.value && (formData.value.targetType === 'current' || (formData.value.targetType === 'existing' && mainOutputTableId.value === formData.value.targetTableId)));

  const loadTargetFieldOptions = async (tableId) => {
    const readId = ++targetFieldReadId;
    targetFieldTableId.value = tableId;
    tableConfigLoadError.value = '';
    tableConfigApplying.value = true;
    mainOutputTableId.value = '';
    targetFieldOptions.value = [];
    if (!tableId) { tableConfigApplying.value = false; return; }
    try {
      const table = await bitable.base.getTableById(tableId);
      if (isUnmounted() || readId !== targetFieldReadId) return;
      const fields = await table.getFieldMetaList();
      if (isUnmounted() || readId !== targetFieldReadId) return;
      targetFieldOptions.value = fields;
      mainOutputTableId.value = tableId;
    } catch (error) {
      if (isUnmounted() || readId !== targetFieldReadId) return;
      targetFieldOptions.value = [];
      tableConfigLoadError.value = error?.message || '读取目标表字段失败，请重试';
    } finally {
      if (!isUnmounted() && readId === targetFieldReadId) tableConfigApplying.value = false;
    }
  };
  const retryTargetFields = () => targetFieldTableId.value ? loadTargetFieldOptions(targetFieldTableId.value) : loadCurrentTableOutputConfig();
  const getBaseId = async () => (await bitable.base.getSelection()).baseId || '';
  const loadTableOutputConfigs = async () => {
    if (tableConfigsRequest) return tableConfigsRequest;
    tableConfigsRequest = (async () => {
      tableConfigsLoaded.value = false;
      tableConfigsError.value = '';
      tableConfigsLoading.value = !!props.api_key;
      if (!props.api_key) return false;
      try {
        const baseId = await getBaseId();
        if (isUnmounted()) return false;
        const response = await request({ url: TABLE_CONFIGS_API_PATH, method: 'get', headers: { authorization: `Bearer ${props.api_key}` }, params: { plugin_type: pluginType, base_id: baseId } });
        if (isUnmounted()) return false;
        if (response.data?.sta !== undefined && Number(response.data.sta) !== 0) throw new Error(response.data.msg || '读取表格输出配置失败');
        const data = response.data?.data || response.data;
        const list = parseTableConfigList(data);
        tableOutputConfigs.value = Object.fromEntries(list.filter(item => item?.target_table_id).map(item => [item.target_table_id, item]));
        tableConfigsLoaded.value = true;
        const tableId = formData.value.targetType === 'existing' ? formData.value.targetTableId
          : formData.value.targetType === 'current' ? targetFieldTableId.value : '';
        if (tableId) await applyTableOutputConfig(tableId);
        return !isUnmounted();
      } catch (error) {
        if (isUnmounted()) return false;
        tableConfigsError.value = error?.response?.data?.msg || error?.message || '读取表格输出配置失败';
        return false;
      } finally {
        if (!isUnmounted()) tableConfigsLoading.value = false;
      }
    })();
    try { return await tableConfigsRequest; } finally { tableConfigsRequest = null; }
  };
  const applyTableOutputConfig = async (id) => {
    tableConfigApplying.value = true;
    const saved = tableConfigsLoaded.value ? tableOutputConfigs.value[id]?.field_mappings : null;
    const mappings = tableConfigSaves.get(id)?.draft ?? (Array.isArray(saved) ? selectSavedMappings(saved) : []);
    mappingDraft.value = mappings.map(item => ({ ...item }));
    await loadTargetFieldOptions(id);
  };
  const loadCurrentTableOutputConfig = async () => {
    const readId = ++targetFieldReadId;
    try {
      const table = await bitable.base.getActiveTable();
      if (isUnmounted() || readId !== targetFieldReadId || formData.value.targetType !== 'current') return;
      await applyTableOutputConfig(table.id);
    } catch (error) {
      if (isUnmounted() || readId !== targetFieldReadId || formData.value.targetType !== 'current') return;
      tableConfigLoadError.value = error?.message || '读取当前表格失败，请重试';
      mappingDraft.value = [];
      targetFieldOptions.value = [];
    }
  };
  const loadFieldOptions = async ({ selection = null, matchName } = {}) => {
    const readId = ++sourceFieldReadId;
    const config = formData.value;
    const ownsRead = () => !isUnmounted() && readId === sourceFieldReadId
      && formData.value === config && config.mode === 'table';
    const isCurrent = () => ownsRead() && !loading.value;
    if (!isCurrent()) return;
    const fieldName = matchName ?? fieldOptions.value.find(field => field.id === config[sourceFieldKey])?.name ?? sourceContext.fieldName;
    sourceFieldLoading.value = true;
    sourceFieldLoadError.value = '';
    try {
      const table = selection?.tableId
        ? await bitable.base.getTableById(selection.tableId)
        : await bitable.base.getActiveTable();
      if (!isCurrent()) return;
      const view = selection?.viewId ? await table.getViewById(selection.viewId) : await table.getActiveView();
      if (!isCurrent()) return;
      const fields = await view.getFieldMetaList();
      if (!isCurrent()) return;
      fieldOptions.value = fields.filter(field => field.type === FieldType.Url || field.type === FieldType.Text)
        .map(field => ({ id: field.id, name: field.name }));
      if (matchName !== undefined) {
        const matches = fieldOptions.value.filter(field => field.name === matchName);
        config[sourceFieldKey] = matches.length === 1 ? matches[0].id : '';
      } else if (!fieldOptions.value.some(field => field.id === config[sourceFieldKey])) {
        config[sourceFieldKey] = '';
      }
      sourceContext.tableId = table.id;
      sourceContext.viewId = view.id || selection?.viewId || '';
      sourceContext.fieldName = fieldOptions.value.find(field => field.id === config[sourceFieldKey])?.name || '';
    } catch (error) {
      if (!isCurrent()) return;
      console.error('获取字段列表失败:', error);
      sourceFieldLoadError.value = error?.message || '读取来源字段失败，请重试';
      sourceContext.fieldName = fieldName;
      fieldOptions.value = [];
      config[sourceFieldKey] = '';
    } finally {
      if (ownsRead()) sourceFieldLoading.value = false;
    }
  };
  const retrySourceFields = () => loadFieldOptions({ matchName: sourceContext.fieldName || undefined });
  const handleLinkFieldDropdownVisibleChange = visible => {
    if (visible && !loading.value) void loadFieldOptions();
  };
  let pendingSelection = null;
  let unsubscribeSelectionChange;
  const handleSelectionChange = ({ data: selection }) => {
    if (isUnmounted() || formData.value.mode !== 'table' || !selection?.tableId) return;
    // 在途任务继续使用原配置，收尾后再跟随飞书当前表。
    if (loading.value) {
      pendingSelection = selection;
      return;
    }
    pendingSelection = null;
    if (selection.tableId !== sourceContext.tableId || selection.viewId !== sourceContext.viewId) {
      const fieldName = fieldOptions.value.find(field => field.id === formData.value[sourceFieldKey])?.name || sourceContext.fieldName;
      Object.assign(sourceContext, { tableId: selection.tableId, viewId: selection.viewId, fieldName });
      formData.value[sourceFieldKey] = '';
      fieldOptions.value = [];
      void loadFieldOptions({ selection, matchName: fieldName });
    }
    if (formData.value.targetType === 'current' && selection.tableId !== targetFieldTableId.value) void applyTableOutputConfig(selection.tableId);
  };
  onMounted(() => {
    unsubscribeSelectionChange = bitable.base.onSelectionChange(handleSelectionChange);
  });
  onUnmounted(() => {
    ++targetFieldReadId;
    ++sourceFieldReadId;
    unsubscribeSelectionChange?.();
  });
  watch(loading, busy => {
    if (!busy && pendingSelection) {
      const selection = pendingSelection;
      pendingSelection = null;
      handleSelectionChange({ data: selection });
    }
  });
  watch(() => formData.value.mode, () => {
    ++sourceFieldReadId;
    sourceFieldLoading.value = false;
    sourceFieldLoadError.value = '';
  });
  const ensureOutputConfigReady = async (sourceTable) => {
    if (isUnmounted()) return false;
    const currentTableId = formData.value.targetType === 'current' ? sourceTable?.id : '';
    const requiresConfig = formData.value.targetType !== 'new';
    if (requiresConfig) {
      if (!tableConfigsLoaded.value) {
        taskFeedback.progress('正在读取输出表配置…', { stopping: stopRequested.value });
        await loadTableOutputConfigs();
        if (isUnmounted()) return false;
        if (!stopRequested.value && !tableConfigsLoaded.value) throw new Error(tableConfigsError.value || '读取输出表配置失败');
        if (!stopRequested.value && targetFieldTableId.value && (!currentTableId || currentTableId === targetFieldTableId.value) && tableConfigLoadError.value) throw new Error(tableConfigLoadError.value);
      }
      if (!stopRequested.value && currentTableId && currentTableId !== targetFieldTableId.value) {
        taskFeedback.progress('正在读取目标表字段…', { stopping: stopRequested.value });
        await applyTableOutputConfig(currentTableId);
      } else if (!stopRequested.value && !outputConfigReady.value) {
        taskFeedback.progress('正在读取目标表字段…', { stopping: stopRequested.value });
        await retryTargetFields();
      }
    }
    if (isUnmounted()) return false;
    if (stopRequested.value) {
      taskFeedback.finish('任务已停止：成功 0 条，失败 0 条', { stopped: true, successCount: 0, failCount: 0 });
      return false;
    }
    if (requiresConfig && !outputConfigReady.value) throw new Error(tableConfigLoadError.value || tableConfigsError.value || '输出表配置尚未加载完成，请重试');
    if (requiresConfig && mappingDraft.value.some(item => !item.source_key || !item.target_field_id)) throw new Error('请完成字段映射，或删除未完成的映射');
    return true;
  };
  const changeTargetType = async (type) => {
    ++targetFieldReadId;
    targetFieldTableId.value = '';
    tableConfigLoadError.value = '';
    mainOutputTableId.value = '';
    targetFieldOptions.value = [];
    tableConfigApplying.value = false;
    if (type === 'current') await loadCurrentTableOutputConfig();
    else if (type === 'new') mappingDraft.value = [];
  };

  const trackMappingSave = async (tableId, saving) => {
    const draft = mappingDraft.value.map(row => ({ ...row }));
    const previous = tableConfigSaves.get(tableId);
    const retrying = !!(previous?.error || previous?.retrying);
    tableConfigSaves.set(tableId, { saving, draft, retrying });
    try {
      await saving;
      if (tableConfigSaves.get(tableId)?.saving !== saving) return;
      if (draft.some(row => !row.source_key || !row.target_field_id)) tableConfigSaves.set(tableId, { draft });
      else tableConfigSaves.delete(tableId);
    } catch (error) {
      if (!isUnmounted() && tableConfigSaves.get(tableId)?.saving === saving) {
        tableConfigSaves.set(tableId, { draft, error: error?.response?.data?.msg || error?.message || '请稍后再试' });
      }
    }
  };

  return {
    fieldOptions, sourceFieldLoading, sourceFieldLoadError, loadFieldOptions, retrySourceFields, handleLinkFieldDropdownVisibleChange,
    tableConfigSaveError, tableConfigSaving, trackMappingSave, mappingDraft, targetFieldOptions, mainOutputTableId, targetFieldTableId, tableConfigLoadError,
    tableOutputConfigs, tableConfigsLoaded, tableConfigsLoading, tableConfigsError, tableConfigApplying,
    outputConfigReady, loadTargetFieldOptions, retryTargetFields, getBaseId, loadTableOutputConfigs,
    applyTableOutputConfig, loadCurrentTableOutputConfig, ensureOutputConfigReady, changeTargetType
  };
}
