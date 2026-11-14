<script setup>
import { useToolOutputConfig } from '../composables/useToolOutputConfig.js';
import { extractHttpUrls } from '../utils/sourceLinks.mjs';
import { nextTableName } from '../utils/tableNames.mjs';
import { readRecordIds, readSourceRows } from '../utils/sourceTableRows.mjs';
import { resolveWritableField } from "../utils/tableFields.js";
import { createTableConfigSaver } from '@/utils/tableOutputConfig.mjs';
import TaskFeedback from "./TaskFeedback.vue";
import { useTaskFeedback } from "../composables/useTaskFeedback.mjs";
import { bitable, FieldType } from "@lark-base-open/js-sdk";
import { computed, ref, onMounted, onUnmounted, watch, nextTick } from "vue";
import { ElMessage } from "element-plus";
import request, { feishuRequest, buildFeishuApiPath } from '@/utils/request';

let componentUnmounted = false;
// 异步结果返回后核对实例，卸载后不再发起后续请求或写入。
const assertMounted = value => {
  if (componentUnmounted) throw new Error('页面已关闭，任务已停止');
  return value;
};
onUnmounted(() => { componentUnmounted = true; });

const emit = defineEmits(['back']);

const props = defineProps({
  api_key: String,
});

const formData = ref({
  mode: 'table',
  targetType: 'current',
  urlFieldId: '',
  scope: 'n',
  rowCount: 5,
  manualUrls: '',
  targetTableId: '',
});
const MANUAL_TABLE_BASE_NAME = '链接转附件';
const ATTACHMENT_BATCH_SIZE = 5;

const MANUAL_FIELD_CONFIGS = [
  {
    key: 'attachment',
    name: '附件',
    type: FieldType.Attachment,
    defaultSelected: true,
  },
];

const FIELD_TYPE_NAME = {
  [FieldType.Attachment]: '附件',
};

const tableOptions = ref([]);
const loading = ref(false);
const stopRequested = ref(false);
const taskFeedback = useTaskFeedback();
const { toastVisible, toastText, toastType, taskNotice, noticeRequiresReopen } = taskFeedback;
const mappingExpanded = ref(false);
const TASK_PLUGIN_TYPE = 'url_to_attachment';
const TABLE_CONFIG_API_PATH = buildFeishuApiPath('/v1/feishu/profile-fetch/table-output-config');
const {
  fieldOptions, sourceFieldLoading, sourceFieldLoadError, loadFieldOptions, retrySourceFields, handleLinkFieldDropdownVisibleChange,
  tableConfigSaveError, tableConfigSaving, trackMappingSave, mappingDraft, targetFieldOptions, mainOutputTableId, targetFieldTableId, tableConfigLoadError,
  tableOutputConfigs, tableConfigsLoaded, tableConfigsLoading, tableConfigsError, tableConfigApplying,
  outputConfigReady, loadTargetFieldOptions, retryTargetFields, getBaseId, loadTableOutputConfigs,
  applyTableOutputConfig, loadCurrentTableOutputConfig, ensureOutputConfigReady, changeTargetType
} = useToolOutputConfig({
  props, formData, pluginType: TASK_PLUGIN_TYPE, sourceFieldKey: 'urlFieldId', loading, stopRequested, taskFeedback,
  isUnmounted: () => componentUnmounted,
  selectSavedMappings: rows => {
    const first = rows.find(row => row?.source_key === 'attachment' && row.target_field_id);
    return first ? [first] : [];
  },
});
const mappingStatus = computed(() => { const count = mappingDraft.value.filter(item => item?.source_key && item?.target_field_id).length; return count ? `已设置 ${count} 项映射` : '尚未设置自定义映射'; });
const selectedUrlFieldName = computed(() => (
  fieldOptions.value.find(field => field.id === formData.value.urlFieldId)?.name || ''
));

const loadTableOptions = async () => {
  try {
    const tableList = assertMounted(await bitable.base.getTableList());
    tableOptions.value = assertMounted(await Promise.all(
      tableList.map(async (table) => ({
        id: table.id,
        name: await table.getName(),
      }))
    ));
  } catch (error) {
    if (componentUnmounted) return;
    console.error('获取表格列表失败:', error);
    tableOptions.value = [];
    ElMessage({ plain: true, message: '获取表格列表失败，请稍后重试', type: 'error', duration: 5000 });
  }
};
const persistTableOutputConfig = createTableConfigSaver(async ({ targetTableId, writeMode, fieldMappings }) => {
  if (componentUnmounted) return;
  const table = await bitable.base.getTableById(targetTableId);
  const payload = {
    plugin_type: TASK_PLUGIN_TYPE,
    base_id: await getBaseId(),
    target_table_id: targetTableId,
    target_table_name: await table.getName(),
    write_mode: writeMode,
    field_mappings: fieldMappings,
  };
  if (componentUnmounted) return;
  const response = await feishuRequest({ url: TABLE_CONFIG_API_PATH, method: 'put', headers: { authorization: `Bearer ${props.api_key}` }, data: payload });
  if (componentUnmounted) return;
  if (response.data?.sta !== 0) throw new Error(response.data?.msg || '保存链接转附件表格配置失败');
  const saved = response.data?.data || response.data || payload;
  tableOutputConfigs.value = { ...tableOutputConfigs.value, [targetTableId]: saved };
});
const saveTableOutputConfig = async () => {
  if (componentUnmounted || !props.api_key || !outputConfigReady.value) return;
  const targetTableId = formData.value.targetType === 'current'
    ? mainOutputTableId.value : formData.value.targetTableId;
  if (!targetTableId) return;
  const fieldMappings = mappingDraft.value.filter(i => i.source_key && i.target_field_id).map(i => ({
    ...i,
    source_name: '附件',
    target_field_name: targetFieldOptions.value.find(f => f.id === i.target_field_id)?.name || '',
  }));
  const saving = persistTableOutputConfig({ targetTableId, writeMode: 'append', fieldMappings });
  await trackMappingSave(targetTableId, saving);
};
const resolveAttachmentFieldId = (fieldNameToId, config = MANUAL_FIELD_CONFIGS[0]) => {
  const mapping = mappingDraft.value.find(item => item?.source_key === config.key && item?.target_field_id);
  return mapping?.target_field_id || fieldNameToId[config.name];
};

const getRecordIdListByScope = (table, scope, rowCount) =>
  readRecordIds(table, scope, rowCount, ElMessage, assertMounted);

const validateAndAddFields = async (tableId = '', activeFieldConfigs = MANUAL_FIELD_CONFIGS) => {
  try {
    const table = tableId
      ? assertMounted(await bitable.base.getTableById(tableId))
      : assertMounted(await bitable.base.getActiveTable());
    const fieldList = assertMounted(await table.getFieldList());
    const fieldMetaMap = new Map();

    for (const field of fieldList) {
      const name = assertMounted(await field.getName());
      fieldMetaMap.set(name, { id: field.id, type: assertMounted(await field.getType()) });
    }

    const missingFields = [];
    const typeMismatchFields = [];

    for (const config of activeFieldConfigs) {
      const mappedFieldId = mappingDraft.value.find(mapping => mapping?.source_key === config.key && mapping?.target_field_id)?.target_field_id;
      if (mappedFieldId) {
        const mappedField = fieldList.find(field => field.id === mappedFieldId);
        if (!mappedField) {
          if (loading.value) throw new Error(`映射目标字段不存在: ${config.name}`);
          ElMessage({ plain: true, message: `映射目标字段不存在: ${config.name}`, type: 'error', duration: 5000 });
          return null;
        }
        const mappedFieldType = assertMounted(await mappedField.getType());
        if (mappedFieldType !== config.type) {
          typeMismatchFields.push({ name: `${config.name} → ${assertMounted(await mappedField.getName())}`, expected: FIELD_TYPE_NAME[config.type] || config.type, actual: mappedFieldType });
        }
        continue;
      }
      const fieldMeta = fieldMetaMap.get(config.name);
      if (!fieldMeta) {
        missingFields.push(config);
      } else if (fieldMeta.type !== config.type) {
        typeMismatchFields.push({
          name: config.name,
          expected: FIELD_TYPE_NAME[config.type] || config.type,
          actual: fieldMeta.type,
        });
      }
    }

    if (typeMismatchFields.length > 0) {
      const errorMsg = typeMismatchFields
        .map((field) => `"${field.name}" 类型不匹配，仅支持${field.expected}`)
        .join(', ');
      if (loading.value) throw new Error(`字段类型错误: ${errorMsg}`);
      ElMessage({ plain: true, message: `字段类型错误: ${errorMsg}`, type: 'error', duration: 8000 });
      return null;
    }

    for (const fieldConfig of missingFields) {
      try {
        const addFieldResult = assertMounted(await table.addField({
          type: fieldConfig.type,
          name: fieldConfig.name,
        }));
        const newFieldId = typeof addFieldResult === 'string'
          ? addFieldResult
          : addFieldResult?.fieldId || addFieldResult?.id || addFieldResult?.field_id;

        if (newFieldId) {
          fieldMetaMap.set(fieldConfig.name, { id: newFieldId, type: fieldConfig.type });
        } else {
          const latestFieldList = assertMounted(await table.getFieldList());
          for (const field of latestFieldList) {
            const name = assertMounted(await field.getName());
            if (name === fieldConfig.name) {
              fieldMetaMap.set(fieldConfig.name, { id: field.id, type: fieldConfig.type });
              break;
            }
          }
        }
      } catch (error) {
        assertMounted();
        if (loading.value) throw error;
        ElMessage({ plain: true, message: `添加字段 "${fieldConfig.name}" 失败`, type: 'error', duration: 5000 });
        return null;
      }
    }

    const fieldNameToId = {};
    for (const [name, meta] of fieldMetaMap.entries()) {
      fieldNameToId[name] = meta.id;
    }

    return fieldNameToId;
  } catch (error) {
    assertMounted();
    if (loading.value) throw error;
    ElMessage({ plain: true, message: `字段操作失败: ${error.message || error}`, type: 'error', duration: 5000 });
    return null;
  }
};

const createSequentialTable = async (baseTableName) => {
  const tables = assertMounted(await bitable.base.getTableMetaList());
  const name = nextTableName(baseTableName, tables.map(table => table.name));
  return assertMounted(await bitable.base.addTable({ name }));
};

const createManualTargetTable = async () => {
  const tableMeta = assertMounted(await createSequentialTable(MANUAL_TABLE_BASE_NAME));
  const tableId = tableMeta.tableId || tableMeta.id;
  if (!tableId) {
    throw new Error('创建新表格失败');
  }
  assertMounted(await loadTableOptions());
  return tableId;
};

const setupNewTableFields = async (tableId) => {
  const table = assertMounted(await bitable.base.getTableById(tableId));
  const fieldMetaList = assertMounted(await table.getFieldMetaList());
  const defaultFirstField = fieldMetaList[0];

  if (defaultFirstField && defaultFirstField.name === '文本') {
    assertMounted(await table.setField(defaultFirstField.id, {
      type: MANUAL_FIELD_CONFIGS[0].type,
      name: MANUAL_FIELD_CONFIGS[0].name,
    }));
  }
};

const isAttachmentUrl = (url) => {
  if (!/^https?:\/\//i.test(url)) return false;
  try {
    return Boolean(new URL(url).hostname);
  } catch {
    return false;
  }
};

const convertUrlsToAttachments = async (urls) => {
  const links = (Array.isArray(urls) ? urls : [urls])
    .filter((url) => typeof url === 'string')
    .map((url) => url.trim())
    .filter(isAttachmentUrl);

  if (links.length === 0) {
    throw new Error('没有可转换的有效链接');
  }

  const attachmentSources = [];
  for (let index = 0; index < links.length; index += ATTACHMENT_BATCH_SIZE) {
    const response = assertMounted(await feishuRequest({
      url: buildFeishuApiPath('/v1/feishu/attch'),
      method: 'post',
      headers: { authorization: `Bearer ${props.api_key}` },
      data: { links: links.slice(index, index + ATTACHMENT_BATCH_SIZE) },
    }));
    const result = response.data;
    if (Number(result?.sta) !== 0) {
      throw new Error(result?.msg || '附件转换失败');
    }

    const batchAttachments = Array.isArray(result?.data)
      ? result.data.filter((item) => item?.content)
      : [];
    attachmentSources.push(...batchAttachments);
  }

  if (attachmentSources.length === 0) {
    throw new Error('未解析到可用附件');
  }

  return assertMounted(await Promise.all(attachmentSources.map(async ({ name, content }) => {
    // 小红书 CDN 会拒绝站外 Referer；仍直接下载，避免强制转存触发文件大小限制。
    const hostname = isAttachmentUrl(content) ? new URL(content).hostname : '';
    const downloadOptions = hostname === 'xhscdn.com' || hostname.endsWith('.xhscdn.com')
      ? { referrerPolicy: 'no-referrer' }
      : undefined;
    const response = assertMounted(await fetch(content, downloadOptions));
    if (!response.ok) {
      throw new Error(`读取附件失败: HTTP ${response.status}`);
    }
    const blob = assertMounted(await response.blob());
    return new File([blob], name || 'attachment', {
      type: blob.type || 'application/octet-stream',
    });
  })));
};

const writeDataToRecord = async (table, recordId, urls, fieldNameToId, activeFieldConfigs) => {

  for (const config of activeFieldConfigs) {
    const fieldId = resolveAttachmentFieldId(fieldNameToId, config);
    if (!fieldId) continue;

    const sourceField = assertMounted(await table.getField(fieldId));
    const { field } = assertMounted(await resolveWritableField(table, sourceField));
    const attachments = assertMounted(await convertUrlsToAttachments(urls));
    assertMounted(await field.setValue(recordId, attachments));
  }
};

const getTableAttachmentFieldConfigs = async (table, urlFieldId) => {
  const urlField = assertMounted(await table.getFieldById(urlFieldId));
  const urlFieldName = assertMounted(await urlField.getName());
  return [{
    key: 'attachment',
    name: `${urlFieldName}附件`,
    type: FieldType.Attachment,
  }];
};

const createAttachmentCell = async (table, fieldId, urls) => {
  const sourceField = assertMounted(await table.getFieldById(fieldId));
  const { field } = assertMounted(await resolveWritableField(table, sourceField));
  const attachments = assertMounted(await convertUrlsToAttachments(urls));
  return assertMounted(await field.createCell(attachments));
};

const appendRecordsToTable = async (tableId, rows) => {
  const table = assertMounted(await bitable.base.getTableById(tableId));
  const fieldMetaMap = new Map();
  const fieldList = assertMounted(await table.getFieldList());

  for (const field of fieldList) {
    const name = assertMounted(await field.getName());
    fieldMetaMap.set(name, field.id);
  }

  const attachmentFieldId = resolveAttachmentFieldId(Object.fromEntries(fieldMetaMap));
  if (!attachmentFieldId) {
    throw new Error('目标表缺少附件字段');
  }

  let writtenCount = 0;
  let processedCount = 0;
  const failures = [];
  let interruption = null;
  for (let index = 0; index < rows.length; index += 1) {
    if (stopRequested.value) break;

    const { urls } = rows[index];
    processedCount = index + 1;
    showToast(`正在处理第 ${processedCount}/${rows.length} 条...`, true);
    let record;
    try {
      record = [assertMounted(await createAttachmentCell(table, attachmentFieldId, urls))];
    } catch (error) {
      assertMounted();
      const failure = { index: index + 1, url: urls.join('、'), reason: error?.response?.data?.msg || error?.message || String(error) };
      failures.push(failure);
      if (error?.code === 'INVALID_API_KEY') {
        interruption = { ...failure, writeUncertain: false };
        break;
      }
      taskFeedback.recordFailure(error, { index: index + 1 });
      continue;
    }

    try {
      assertMounted(await table.addRecords([record]));
    } catch (error) {
      assertMounted();
      // 写入请求可能已经生效；不计为确定失败，也不自动重试或继续追加。
      interruption = { index: index + 1, url: urls.join('、'), reason: error?.message || String(error), writeUncertain: true };
      break;
    }
    writtenCount += 1;
  }

  return { writtenCount, failCount: failures.length, failures, interruption, unprocessedCount: rows.length - processedCount, stopped: stopRequested.value };
};

const extractUrlsFromText = (text) => {
  if (typeof text !== 'string' || !text.trim()) return [];

  const urls = extractHttpUrls(text);
  if (urls.length) return urls;
  return text.split(/[\s,，]+/).filter(Boolean);
};

const extractUrls = (value) => {
  if (!value) return [];

  if (typeof value === 'string') {
    return extractUrlsFromText(value);
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => extractUrls(item));
  }

  if (typeof value === 'object') {
    const keys = ['link', 'url', 'text', 'content', 'value', 'displayText'];
    for (const key of keys) {
      const urls = extractUrls(value[key]);
      if (urls.length > 0) {
        return urls;
      }
    }
  }

  return [];
};

const getCellValuesByFieldId = (table, recordIds, fieldId) =>
  readSourceRows(table, recordIds, fieldId, (recordId, value) => {
    const urls = extractUrls(value);
    return urls.length ? { recordId, urls } : null;
  }, assertMounted);

const resolveTargetTableId = async (targetType) => {
  if (targetType === 'new') {
    const tableId = assertMounted(await createManualTargetTable());
    assertMounted(await setupNewTableFields(tableId));
    assertMounted(await bitable.ui.switchToTable(tableId));
    return tableId;
  }

  if (targetType === 'existing') {
    const tableId = formData.value.targetTableId;
    const fieldNameToId = assertMounted(await validateAndAddFields(tableId, MANUAL_FIELD_CONFIGS));
    if (!fieldNameToId) {
      return null;
    }
    return tableId;
  }

  return null;
};

const showToast = (text, isLoading = true, options = {}) => {
  if (isLoading) {
    const progressOptions = { stopping: stopRequested.value, ...options };
    if (options.begin) taskFeedback.begin(text, progressOptions);
    else taskFeedback.progress(text, progressOptions);
  } else {
    taskFeedback.finish(text, options);
  }
};

const finishToast = (text, options = {}) => {
  showToast(text, false, options);
};

const hideToast = () => { taskFeedback.hide(); };

const stepNumber = (delta) => {
  const nextValue = Math.max(1, Math.min(100, (formData.value.rowCount || 5) + delta));
  formData.value.rowCount = nextValue;
};

const requestStop = () => {
  if (!loading.value || stopRequested.value) return;
  stopRequested.value = true;
  showToast('正在停止，等待当前记录处理完成...', true);
};

const handleTableModeSubmit = async () => {
  if (loading.value || sourceFieldLoading.value) return;
  if (!props.api_key) {
    ElMessage({ plain: true, message: '请先设置 API Key', type: 'warning', duration: 3000 });
    return;
  }

  if (!formData.value.urlFieldId) {
    ElMessage({ plain: true, message: sourceFieldLoadError.value || '请选择URL字段', type: sourceFieldLoadError.value ? 'error' : 'warning', duration: sourceFieldLoadError.value ? 5000 : 3000 });
    return;
  }

  if (formData.value.urlFieldId === 'nodata') {
    ElMessage({ plain: true, message: '当前未在数据表页面，无法读取字段信息。请先打开目标数据表，再重试操作。', type: 'error', duration: 3000 });
    return;
  }

  stopRequested.value = false;
  loading.value = true;
  showToast("正在启动链接转附件...", true, { begin: true });
  await nextTick();

  try {
    assertMounted();
    const sourceTable = assertMounted(await bitable.base.getActiveTable());
    if (!assertMounted(await ensureOutputConfigReady(sourceTable))) return;
    const recordIdList = assertMounted(await getRecordIdListByScope(sourceTable, formData.value.scope, formData.value.rowCount));
    if (!recordIdList) { finishToast('任务未开始', { type: 'info' }); return; }

    const activeFieldConfigs = assertMounted(await getTableAttachmentFieldConfigs(sourceTable, formData.value.urlFieldId));
    const fieldNameToId = assertMounted(await validateAndAddFields(sourceTable.id, activeFieldConfigs));
    if (!fieldNameToId) {
      if (taskFeedback.toastLoading.value) finishToast('目标字段校验未通过，任务未开始', { type: 'info' });
      return;
    }

    const rowList = assertMounted(await getCellValuesByFieldId(sourceTable, recordIdList, formData.value.urlFieldId));
    if (rowList.length === 0) {
      finishToast('所选范围内没有可转换的链接，请检查URL字段和数据范围', { empty: true });
      return;
    }

    let successCount = 0;
    let failCount = 0;
    showToast(`准备处理 ${rowList.length} 条数据...`, true);

    for (let i = 0; i < rowList.length; i += 1) {
      if (stopRequested.value) break;

      const { urls, recordId } = rowList[i];
      try {
        showToast(`正在处理第 ${i + 1}/${rowList.length} 条...`, true);
        assertMounted(await writeDataToRecord(sourceTable, recordId, urls, fieldNameToId, activeFieldConfigs));
        successCount += 1;
      } catch (error) {
        assertMounted();
        if (error?.code === 'INVALID_API_KEY') throw error;
        taskFeedback.recordFailure(error, { index: i + 1 });
        failCount += 1;
      }
    }

    finishToast(
      stopRequested.value
        ? `任务已停止：成功 ${successCount} 条，失败 ${failCount} 条`
        : `处理完成：成功 ${successCount} 条，失败 ${failCount} 条`,
      { stopped: stopRequested.value, successCount, failCount, empty: successCount === 0 && failCount === 0 }
    );
  } catch (error) {
    if (componentUnmounted) return;
    taskFeedback.fail(error, { persist: /核对|重新(?:打开|进入)|暂停写入/.test(error.message || '') });
  } finally {
    loading.value = false;
    stopRequested.value = false;
  }
};

const handleManualModeSubmit = async () => {
  if (loading.value) return;
  if (!props.api_key) {
    ElMessage({ plain: true, message: '请先设置 API Key', type: 'warning', duration: 3000 });
    return;
  }

  if (!formData.value.manualUrls || !formData.value.manualUrls.trim()) {
    ElMessage({ plain: true, message: '请输入URL', type: 'warning', duration: 3000 });
    return;
  }

  if (formData.value.targetType === 'existing' && !formData.value.targetTableId) {
    ElMessage({ plain: true, message: '请选择现有表格', type: 'warning', duration: 3000 });
    return;
  }

  const urls = extractHttpUrls(formData.value.manualUrls).filter(isAttachmentUrl);
  if (urls.length === 0) {
    ElMessage({ plain: true, message: '请至少输入一个有效的URL', type: 'warning', duration: 3000 });
    return;
  }

  stopRequested.value = false;
  loading.value = true;
  showToast("正在启动链接转附件...", true, { begin: true });
  await nextTick();

  try {
    if (!assertMounted(await ensureOutputConfigReady())) return;
    const targetTableId = assertMounted(await resolveTargetTableId(formData.value.targetType));
    if (!targetTableId) {
      if (taskFeedback.toastLoading.value) finishToast('目标表字段校验未通过，任务未开始', { type: 'info' });
      return;
    }

    const rows = urls.map((url) => ({ urls: [url] }));
    showToast(`准备处理 ${rows.length} 条数据...`, true);
    const { writtenCount, failCount = 0, failures = [], interruption, unprocessedCount = 0, stopped } = assertMounted(await appendRecordsToTable(targetTableId, rows));
    let summary = interruption?.writeUncertain
      ? `已停止写入：已确认成功 ${writtenCount} 条，失败 ${failCount} 条，第 ${interruption.index} 条写入结果待核对`
      : `${interruption ? '任务已中断' : stopped ? '任务已停止' : '处理完成'}：成功 ${writtenCount} 条，失败 ${failCount} 条`;
    if (unprocessedCount) summary += `，未处理 ${unprocessedCount} 条`;
    finishToast(summary, {
      stopped: stopped && !interruption?.writeUncertain, successCount: writtenCount, failCount,
      type: interruption?.writeUncertain ? 'warning' : undefined,
      empty: writtenCount === 0 && failCount === 0 && !interruption,
    });
    if (failures.length || interruption || unprocessedCount > 0) {
      const details = failures.map(item => `第 ${item.index} 条处理失败：${item.reason}\n链接：${item.url}`);
      if (interruption?.writeUncertain) {
        details.push(`第 ${interruption.index} 条写入结果无法确认：${interruption.reason}\n链接：${interruption.url}`);
      }
      if (unprocessedCount) details.push(`未处理链接：\n${urls.slice(urls.length - unprocessedCount).join('\n')}`);
      details.push(interruption?.writeUncertain
        ? '请先核对目标表，确认待核对链接是否已写入，再处理尚未写入的链接；已确认成功的链接无需重复执行。'
        : failures.length
          ? `请仅重试失败链接${unprocessedCount ? '及未处理链接' : ''}，已成功写入的链接无需重复执行。`
          : '请仅处理未处理链接，已成功写入的链接无需重复执行。');
      taskNotice.value = details.join('\n');
    }
  } catch (error) {
    if (componentUnmounted) return;
    taskFeedback.fail(error, { persist: /核对|重新(?:打开|进入)|暂停写入/.test(error.message || '') });
  } finally {
    loading.value = false;
    stopRequested.value = false;
  }
};

const handleTaskAction = () => {
  if (stopRequested.value || noticeRequiresReopen.value) return;
  if (loading.value) {
    requestStop();
    return;
  }
  return handleSubmit();
};

const handleSubmit = async () => {
  if (loading.value) return;
  stopRequested.value = false;
  if (formData.value.mode === 'manual') {
    await handleManualModeSubmit();
    return;
  }

  await handleTableModeSubmit();
};

onMounted(async () => {
  if (formData.value.mode === 'table') loadFieldOptions();
  await loadTableOutputConfigs();
  if (componentUnmounted) return;
  if (formData.value.mode === 'table' && !targetFieldTableId.value) {
    loadCurrentTableOutputConfig();
  }
});

watch(
  () => formData.value.mode,
  (mode) => {
    if (mode === 'table') {
      formData.value.targetType = 'current';
      loadFieldOptions();
      loadCurrentTableOutputConfig();
    }

    if (mode === 'manual' && formData.value.targetType === 'current') {
      formData.value.targetType = 'new';
    }

    if (formData.value.targetType === 'existing' && tableOptions.value.length === 0) {
      loadTableOptions();
      return;
    }

    if (mode !== 'manual' && formData.value.targetType !== 'existing') {
      formData.value.targetTableId = '';
    }
  }
);

watch(
  () => formData.value.targetType,
  (targetType) => {
    if (targetType === 'existing' && tableOptions.value.length === 0) {
      loadTableOptions();
      return;
    }

    if (targetType !== 'existing') {
      formData.value.targetTableId = '';
    }
  }
);
watch(() => formData.value.targetTableId, async id => {
  if (formData.value.targetType !== 'existing') return;
  await applyTableOutputConfig(id);
});
watch(mappingDraft, saveTableOutputConfig, { deep: true });
watch(() => formData.value.targetType, changeTargetType);
</script>

<template>
  <div class="sub-page">
    <div class="sub-page-header">
      <span class="sub-page-back" :aria-disabled="loading" :title="(loading) ? '请等待任务结束后返回' : '返回'" @click="!(loading) && emit('back')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16">
          <polyline points="15 18 9 12 15 6"></polyline>
        </svg>
      </span>
      <span class="sub-page-title">链接转附件</span>
    </div>
    <div class="form-card">
      <div class="section-heading"><span class="section-step">1</span><span>获取设置</span></div>
      <div class="group-label">URL来源</div>
      <el-radio-group v-model="formData.mode" class="source-mode-radio radio-block" :disabled="loading">
        <el-radio value="table">从表格选取</el-radio>
        <el-radio value="manual">手动输入</el-radio>
      </el-radio-group>
      <el-form class="form" :model="formData" label-position="top" :disabled="loading" :inert="(loading) ? '' : null" :aria-busy="loading">
        <template v-if="formData.mode === 'table'">
          <el-form-item label="">
            <div class="c-label">
              URL字段
              <el-tooltip effect="dark" placement="top">
                <template #content>支持文本或链接类型字段</template>
                <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png" class="help-icon" />
              </el-tooltip>
            </div>
            <el-select
              v-model="formData.urlFieldId"
              filterable
              placeholder="输入字段名称搜索或选择"
              no-match-text="未找到匹配字段"
              style="width: 100%"
              @visible-change="handleLinkFieldDropdownVisibleChange"
            >
              <el-option v-for="field in fieldOptions" :key="field.id" :label="field.name" :value="field.id" />
            </el-select>
            <div v-if="sourceFieldLoading" class="sub-hint" role="status">正在读取来源字段…</div>
            <div v-else-if="sourceFieldLoadError" class="table-config-feedback sub-hint" role="status" aria-live="polite">
              <span>{{ sourceFieldLoadError }}</span>
              <el-button link type="primary" @click="retrySourceFields">重试</el-button>
            </div>
          </el-form-item>

          <el-form-item label="" style="margin-top: 12px">
            <div class="c-label">
              数据范围
              <el-tooltip effect="dark" placement="top">
                <template #content>选择要执行的数据范围</template>
                <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png" class="help-icon" />
              </el-tooltip>
            </div>
            <el-radio-group v-model="formData.scope" class="custom-radio-group">
              <el-radio value="all" class="custom-radio-item">所有行</el-radio>
              <el-radio value="selected" class="custom-radio-item">选中行</el-radio>
              <el-radio value="n" class="custom-radio-item">
                <span class="radio-label-text">前</span>
                <div class="custom-stepper-input">
                  <input
                    type="number"
                    :value="formData.rowCount"
                    @input.stop="formData.rowCount = Math.max(1, Math.min(100, parseInt($event.target.value) || 5))"
                    @click.stop
                    min="1"
                    max="100"
                  />
                  <div class="stepper-buttons">
                    <button @click.stop="stepNumber(1)" :disabled="formData.rowCount >= 100" class="stepper-btn stepper-btn-up"></button>
                    <button @click.stop="stepNumber(-1)" :disabled="formData.rowCount <= 1" class="stepper-btn stepper-btn-down"></button>
                  </div>
                </div>
                <span class="range-unit">行</span>
              </el-radio>
            </el-radio-group>
          </el-form-item>
        </template>

        <template v-else>
          <el-form-item label="">
            <div class="c-label">
              URL
              <el-tooltip effect="dark" placement="top">
                <template #content>支持多个URL，<br />可换行或逗号分隔</template>
                <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png" class="help-icon" />
              </el-tooltip>
            </div>
            <el-input
              v-model="formData.manualUrls"
              type="textarea"
              :rows="4"
              class="c-input"
              placeholder="请输入链接，支持批量输入（多个链接请换行或用逗号分隔）"
            />
          </el-form-item>
          <el-form-item label="">
            <div class="field-stack">
              <div class="c-label">输出到表格</div>
              <el-radio-group v-model="formData.targetType" class="radio-block">
                <el-radio value="new">新建表格</el-radio>
                <el-radio value="existing">使用现有表格</el-radio>
              </el-radio-group>
            </div>
          </el-form-item>
          <el-form-item v-if="formData.targetType === 'existing'" label="">
            <div class="c-label">选择现有表格</div>
            <el-select v-model="formData.targetTableId" placeholder="请选择" style="width: 100%">
              <el-option v-for="table in tableOptions" :key="table.id" :label="table.name" :value="table.id" />
            </el-select>
          </el-form-item>
        </template>

        <div class="section-heading output-heading"><span class="section-step">2</span><span>输出设置</span></div>
        <el-form-item label="">
          <div class="output-field-group">
            <div class="c-label">输出字段</div>
            <el-checkbox :model-value="true" disabled class="output-field-preview">
              {{ formData.mode === 'table' ? (selectedUrlFieldName ? `${selectedUrlFieldName}附件` : '请先选择 URL 字段') : '附件' }}
            </el-checkbox>
          </div>
        </el-form-item>
        <div v-if="formData.mode === 'table' || formData.targetType === 'existing'" class="mapping-accordion">
          <button type="button" class="mapping-accordion-trigger" :aria-expanded="mappingExpanded" @click="mappingExpanded = !mappingExpanded"><span class="mapping-accordion-label">字段映射 <span class="mapping-optional">（可选）</span><span class="mapping-status">{{ mappingStatus }}</span></span><span class="mapping-chevron" :class="{ 'is-expanded': mappingExpanded }"></span></button>
          <div v-if="tableConfigsLoading" class="sub-hint" role="status">正在读取表格输出配置…</div>
          <div v-else-if="tableConfigsError" class="table-config-feedback sub-hint" role="status" aria-live="polite">
            <span>{{ tableConfigsError }}</span>
            <el-button link type="primary" @click="loadTableOutputConfigs">重试</el-button>
          </div>
          <div v-else-if="tableConfigApplying" class="sub-hint" role="status">正在读取目标表字段…</div>
          <div v-else-if="tableConfigLoadError" class="table-config-feedback sub-hint" role="status" aria-live="polite">
            <span>{{ tableConfigLoadError }}</span>
            <el-button link type="primary" @click="retryTargetFields">重试</el-button>
          </div>
          <div v-if="tableConfigSaving" class="table-config-feedback sub-hint" role="status">正在保存字段映射…</div>
          <div v-else-if="tableConfigSaveError" class="table-config-feedback sub-hint" role="status" aria-live="polite">
            <span>字段映射未保存：{{ tableConfigSaveError }}</span>
            <el-button link type="primary" :disabled="!outputConfigReady" @click="saveTableOutputConfig">重试保存</el-button>
          </div>
          <div v-show="mappingExpanded" class="mapping-accordion-panel" :inert="!outputConfigReady ? '' : null" :aria-disabled="!outputConfigReady"><p class="mapping-note">可将“附件”写入现有表格的指定字段。</p>
            <div v-for="(mapping,index) in mappingDraft" :key="index" class="mapping-row"><el-select v-model="mapping.source_key" placeholder="选择输出字段" size="small"><el-option value="attachment" :label="formData.mode === 'table' && selectedUrlFieldName ? `${selectedUrlFieldName}附件` : '附件'" /></el-select><span class="mapping-arrow">→</span><el-select v-model="mapping.target_field_id" placeholder="选择目标字段" size="small"><el-option v-for="field in targetFieldOptions" :key="field.id" :label="field.name" :value="field.id" /></el-select><el-button link type="danger" @click="mappingDraft.splice(index,1)">删除</el-button></div>
            <div class="mapping-actions"><el-button link type="primary" :disabled="mappingDraft.length > 0" @click="mappingDraft.push({source_key:'attachment',target_field_id:''})">+ 添加字段映射</el-button></div>
          </div>
        </div>

      </el-form>

      <div class="task-actions">
        <el-button
          class="commit-btn"
          :class="{ 'is-running': loading }"
          :loading="stopRequested"
          :disabled="stopRequested || noticeRequiresReopen || (!loading && formData.mode === 'table' && sourceFieldLoading)"
          @click="handleTaskAction"
        >{{ stopRequested ? '正在停止…' : loading ? '停止任务' : noticeRequiresReopen ? '请重新进入插件' : '立即执行' }}</el-button>
      </div>
      <p v-if="taskNotice" class="sub-hint task-failure-details">{{ taskNotice }}</p>
    </div>

    <TaskFeedback :visible="toastVisible" :text="toastText" :kind="toastType" />
  </div>
</template>

<style scoped>
.task-failure-details {
  white-space: pre-wrap;
}

.sub-hint {
  margin: 8px 0 0;
  font-size: var(--app-font-size-small);
  line-height: 20px;
  color: #86909C;
  overflow-wrap: anywhere;
}

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
.section-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 12px;
  color: #1D2129;
  font-size: 16px;
  font-weight: 500;
  line-height: 22px;
}
.section-step {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  color: #A8071A;
  background: #FFF1F2;
  font-size: 12px;
  font-weight: 600;
}
.group-label {
  margin-bottom: 8px;
  color: #4E5969;
  font-size: 14px;
  line-height: 20px;
}
.output-heading {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid #F0F1F3;
}
.form :deep(.el-form-item__label) {
  font-size: 14px;
  color: #1d2129;
  margin-bottom: 8px;
}
.form :deep(.el-form-item__content) {
  font-size: 14px;
}

.commit-btn { margin-top: 0; }
.task-actions {
  display: flex;
  gap: 8px;
}
.task-actions .commit-btn {
  flex: 1;
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
.field-stack {
  width: 100%;
}
.radio-block {
  width: 100%;
}
.source-mode-radio {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 12px;
}
.source-mode-radio :deep(.el-radio) { margin-right: 0; }
.source-mode-radio :deep(.el-radio__label) {
  padding-left: 8px;
  font-size: 14px;
}
.source-mode-radio :deep(.el-radio__input.is-checked:not(.is-disabled) .el-radio__inner) {
  border-color: #A8071A;
  background: #A8071A;
}
.source-mode-radio :deep(.el-radio:not(.is-disabled) .el-radio__label) { color: #1D2129; }
.output-value {
  min-height: 32px;
  padding: 6px 10px;
  box-sizing: border-box;
  color: #1D2129;
  background: #F7F8FA;
  border: 1px solid #E5E6EB;
  border-radius: 6px;
  line-height: 20px;
}
.output-placeholder { color: #86909C; }
.output-field-group {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  width: 100%;
}
.output-field-group .c-label {
  margin-bottom: 8px;
}
.output-field-preview {
  margin-right: 0;
}
.output-field-preview :deep(.el-checkbox__label) {
  padding-left: 8px;
  color: #1D2129;
  line-height: 22px;
}
.output-field-preview :deep(.el-checkbox__inner) {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  border-color: #A8071A;
  background: #A8071A;
}
.output-field-preview :deep(.el-checkbox__inner::after) {
  border-color: #FFFFFF;
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
.range-unit {
  margin-left: 6px;
  flex-shrink: 0;
}

.custom-stepper-input {
  display: flex;
  align-items: center;
  height: 32px;
  width: 80px;
  margin-left: 8px;
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

.stepper-btn:disabled:hover {
  background: transparent;
}
.field-checkbox-group {
  display: grid;
  grid-template-columns: repeat(1, minmax(0, 1fr));
  gap: 12px 16px;
  width: 100%;
}
.field-checkbox-item {
  margin-right: 0;
}
.mapping-accordion { margin: 12px 0 16px; border-top: 1px solid #F0F1F3; border-bottom: 1px solid #F0F1F3; }
.mapping-accordion-trigger { display:flex; align-items:center; justify-content:space-between; width:100%; min-height:48px; padding:12px 0; color:#1D2129; background:transparent; border:0; cursor:pointer; font:inherit; text-align:left; }
.mapping-accordion-label { display:flex; align-items:baseline; gap:4px; font-size:14px; font-weight:500; }
.mapping-optional,.mapping-status,.mapping-note { color:#86909C; font-size:12px; font-weight:400; }
.mapping-chevron { width:8px; height:8px; margin-right:4px; border-right:1.5px solid #86909C; border-bottom:1.5px solid #86909C; transform:rotate(45deg) translateY(-2px); }
.mapping-chevron.is-expanded { transform:rotate(225deg) translateY(-2px); }
.mapping-accordion-panel { padding:0 0 12px; }
.mapping-note { margin:0 0 12px; line-height:18px; }
.mapping-row { display:grid; grid-template-columns:minmax(0,1fr) 12px minmax(0,1fr) auto; gap:4px; align-items:center; min-height:44px; border-top:1px solid #F0F1F3; }
.mapping-row :deep(.el-select__wrapper) { min-height:36px; height:36px; padding:0 12px; border-radius:6px; box-shadow:0 0 0 1px #E5E6EB inset; }
.mapping-arrow { color:#86909C; text-align:center; }
.mapping-delete { min-width:28px; padding:4px; }
.mapping-actions { display:flex; align-items:center; gap:12px; margin-top:8px; }
.mapping-actions :deep(.el-button) { margin-left:0; }
.toast-wrap {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) scale(0.95);
  z-index: 9999;
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
.sub-page { font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
.section-heading { font-size: 16px; font-weight: 500; line-height: 22px; }
.group-label, .c-label { margin-bottom: 8px; font-size: 14px; font-weight: 500; line-height: 20px; }
.source-mode-radio, .radio-block { display: flex; flex-wrap: wrap; gap: 16px; }
.source-mode-radio :deep(.el-radio), .radio-block :deep(.el-radio) { min-height: 28px; margin-right: 0; }
.custom-radio-group { gap: 8px; }
.sub-page :deep(.el-radio__label), .sub-page :deep(.el-checkbox__label) { font-family: inherit; font-size: 14px; font-weight: 400; line-height: 20px; }

</style>
