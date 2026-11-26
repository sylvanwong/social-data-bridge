<script setup>
import TaskExecutionResult from './TaskExecutionResult.vue';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { bitable, FieldType, NumberFormatter } from '@lark-base-open/js-sdk';

import { ElMessage } from 'element-plus';
import { feishuRequest, buildFeishuApiPath } from '@/utils/request';
import { createTableConfigSaver, parseTableConfigList } from '../utils/tableOutputConfig.mjs';
import { readSourceRows } from '../utils/sourceTableRows.mjs';
import { extractCellLink, extractHttpUrls } from '../utils/sourceLinks.mjs';
import { useSocialData } from '../composables/useSocialData';
import { useProductReviewTask } from '../composables/useProductReviewTask';
import TaskFeedback from './TaskFeedback.vue';
import PageStepper from './PageStepper.vue';

const props = defineProps({ api_key: String });
defineEmits(['back']);

const formData = ref({
  mode: 'table',
  productLinkFieldId: '',
  manualUrls: '',
  scope: 'n',
  rowCount: 5,
  pages: 1,
  replyPages: 1,
  sortType: 'general',
  radio: 1,
  table_id: '',
  writeMode: 'upsert',
});
const reviewPagesType = ref('pages');
const replyPagesType = ref('none');
const sortOptions = [
  { value: 'general', label: '综合排序' },
  { value: 'time_descending', label: '最新评价优先' },
];

// 14个输出字段按阅读顺序排列；两平台的有用数合并为一列。
const FIELD_CONFIG = [
  { key: 'review_id', name: '评价ID', required: true },
  { key: 'social_type', name: '平台' },
  { key: 'product_url', name: '商品链接', type: FieldType.Url, allowedTypes: [FieldType.Url, FieldType.Text] },
  { key: 'user_name', name: '评价者名称', allowedTypes: [FieldType.Text, FieldType.SingleSelect] },
  { key: 'sku_text', name: '购买规格' },
  { key: 'review_type', name: '评价类型', hint: '仅抖音' },
  { key: 'review_time', name: '初评时间' },
  { key: 'content', name: '初评' },
  { key: 'media_urls', name: '晒图/视频' },
  { key: 'helpful_count', name: '有用', type: FieldType.Number, formatter: NumberFormatter.INTEGER },
  { key: 'additional_time', name: '追评时间', hint: '仅抖音' },
  { key: 'additional_content', name: '追评', hint: '仅抖音' },
  { key: 'additional_media_urls', name: '追评晒图/视频', hint: '仅抖音' },
  { key: 'replies', name: '评价回复' },
].map(field => ({ type: FieldType.Text, ...field }));
const selectedKeys = ref(FIELD_CONFIG.map(field => field.key));
const selectedFieldKeys = computed({
  get: () => selectedKeys.value,
  set: keys => {
    const selected = new Set(keys);
    selectedKeys.value = FIELD_CONFIG.filter(field => field.required || selected.has(field.key)).map(field => field.key);
  },
});
const isAllFieldsSelected = computed(() => selectedFieldKeys.value.length === FIELD_CONFIG.length);
const isFieldsPartiallySelected = computed(() => selectedFieldKeys.value.length > 1 && !isAllFieldsSelected.value);
const toggleAllFields = checked => {
  selectedFieldKeys.value = checked ? FIELD_CONFIG.map(field => field.key) : [];
};

const fieldOptions = ref([]);
const sourceFieldLoading = ref(false);
const sourceFieldError = ref('');
const tableOptions = ref([]);
const tableOptionsLoading = ref(false);
const tableOptionsError = ref('');
const tableFieldOptions = ref([]);
const targetFieldLoading = ref(false);
const targetFieldError = ref('');
const loadedTargetTableId = ref('');
const mappingDraft = ref([]);
const mappingExpanded = ref(false);
const outputConfigReady = computed(() => !loading.value && tableConfigsLoaded.value && !tableConfigsLoading.value && !tableConfigsError.value && formData.value.radio === 2 && !!formData.value.table_id
  && loadedTargetTableId.value === formData.value.table_id && !targetFieldLoading.value
  && !targetFieldError.value && !tableOptionsLoading.value && !tableOptionsError.value);
const mappingStatus = computed(() => {
  if (!formData.value.table_id) return '选择目标表格后可设置';
  const count = mappingDraft.value.filter(row => row.source_key && row.target_field_id).length;
  return count ? `已设置 ${count} 项映射` : '尚未设置自定义映射';
});
// 表级草稿优先于迟到的云配置；不同表按各自队列保存。
const targetDrafts = new Map();
let draftTableId = '';
let disposed = false;
let sourceReadId = 0;
let tableReadId = 0;
let targetFieldReadId = 0;
let sourceContext = { tableId: '', viewId: '' };
let sourceFieldName = '';
let unsubscribeSelectionChange;
let pendingSelection = null;
const tableConfigsLoaded = ref(false), tableConfigsLoading = ref(false), tableConfigsError = ref('');
const tableConfigSaveErrors = ref({});
const tableConfigSaveError = computed(() => formData.value.radio === 2
  ? tableConfigSaveErrors.value[formData.value.table_id] || '' : '');
const cloudConfigs = new Map();
const configPath = buildFeishuApiPath('/v1/feishu/profile-fetch/table-output-config');
const configListPath = `${configPath}s`;
let configRequest = null, configApplying = false;
const { latestExecutionResult, loading, hasRecoverableTask, isCancelling, clearing, feedback, assertMounted, resumeTask, submitTask, cancelTask } = useProductReviewTask({ props, fields: FIELD_CONFIG, onCancelError: error => showError(error), onIdle: () => {
  if (disposed) return;
  if (pendingSelection) { const selection = pendingSelection; pendingSelection = null; void loadSourceFields(selection); }
  if (!hasRecoverableTask.value && formData.value.radio === 2 && formData.value.table_id) {
    if (loadedTargetTableId.value !== formData.value.table_id && !targetFieldLoading.value) void loadTargetFields();
    if (!tableConfigsLoaded.value && !tableConfigsLoading.value) void loadTableOutputConfigs();
  }
}, onRestore: task => {
  if (!task.sourceSnapshot) return;
  configApplying = true;
  Object.assign(formData.value, task.sourceSnapshot);
  selectedFieldKeys.value = [...task.selectedFieldKeys];
  mappingDraft.value = task.fieldMappings.map(row => ({ ...row }));
  formData.value.writeMode = task.writeMode;
  if (formData.value.radio === 2 && formData.value.table_id) {
    // 恢复期间跳过了目标表 watcher；结束后补加载时仍以原任务草稿为准。
    draftTableId = formData.value.table_id;
    targetDrafts.set(draftTableId, { mappings: mappingDraft.value.map(row => ({ ...row })), writeMode: task.writeMode });
  }
  reviewPagesType.value = task.requestSnapshot.pages === 0 ? 'all' : 'pages';
  replyPagesType.value = task.requestSnapshot.reply_pages === -1 ? 'none' : task.requestSnapshot.reply_pages === 0 ? 'all' : 'pages';
  configApplying = false;
} });
const { toastVisible, toastText, toastType, taskNotice, noticeRequiresReopen } = feedback;
const { validateTableFields } = useSocialData(() => '商品评价', '', FIELD_CONFIG);
const initialReady = ref(false);
const busy = computed(() => loading.value || hasRecoverableTask.value || !initialReady.value);
const saver = createTableConfigSaver(async config => {
  if (disposed) return;
  const response = await feishuRequest({ url: configPath, method: 'put', headers: { authorization: `Bearer ${props.api_key}` }, data: { plugin_type: 'product_review_fetch', base_id: config.baseId, target_table_id: config.targetTableId, write_mode: config.writeMode, field_mappings: config.mappings } });
  if (response.data?.sta !== 0) throw new Error(response.data?.msg || '保存表格配置失败，请重试');
});
let configBaseId = '';
const loadTableOutputConfigs = async () => {
  if (disposed) return false;
  if (configRequest) return configRequest;
  tableConfigsLoaded.value = false; tableConfigsLoading.value = true; tableConfigsError.value = '';
  configRequest = (async () => {
    try {
      const selection = await bitable.base.getSelection(); if (disposed) return false;
      const response = await feishuRequest({ url: configListPath, method: 'get', headers: { authorization: `Bearer ${props.api_key}` }, params: { plugin_type: 'product_review_fetch', base_id: selection.baseId || '' } });
      if (disposed) return false;
      if (response.data?.sta !== 0) throw new Error(response.data?.msg || '读取表格输出配置失败');
      const list = parseTableConfigList(response.data.data);
      configBaseId = selection.baseId || ''; cloudConfigs.clear();
      list.forEach(config => { if (config?.target_table_id) cloudConfigs.set(config.target_table_id, config); });
      tableConfigsLoaded.value = true;
      if (!loading.value && formData.value.radio === 2) applyCloudDraft(formData.value.table_id);
      return true;
    } catch (error) { if (!disposed) tableConfigsError.value = error?.response?.data?.msg || error?.message || '读取表格输出配置失败'; return false; }
    finally { if (!disposed) tableConfigsLoading.value = false; configRequest = null; }
  })();
  return configRequest;
};
const applyCloudDraft = tableId => {
  if (disposed || !tableId || targetDrafts.has(tableId) || !tableConfigsLoaded.value) return;
  const config = cloudConfigs.get(tableId);
  configApplying = true;
  mappingDraft.value = (config?.field_mappings || []).filter(row => selectedFieldKeys.value.includes(row.source_key)).map(row => ({ ...row }));
  formData.value.writeMode = config?.write_mode === 'append' ? 'append' : 'upsert';
  configApplying = false;
};
const rememberDraft = () => {
  if (disposed || configApplying || !outputConfigReady.value || busy.value || draftTableId !== formData.value.table_id) return;
  const tableId = draftTableId;
  const draft = { mappings: mappingDraft.value.map(row => ({ ...row })), writeMode: formData.value.writeMode };
  targetDrafts.set(tableId, draft);
  if (draft.mappings.some(row => !row.source_key || !row.target_field_id)) return;
  const token = {}; draft.token = token; tableConfigSaveErrors.value[tableId] = '';
  void saver({ ...draft, baseId: configBaseId, targetTableId: tableId }).then(() => {
    if (!disposed && targetDrafts.get(tableId)?.token === token) tableConfigSaveErrors.value[tableId] = '';
  }, error => { if (!disposed && targetDrafts.get(tableId)?.token === token) tableConfigSaveErrors.value[tableId] = error?.message || '保存表格配置失败，请重试'; });
};
const showError = error => ElMessage({ message: error?.response?.data?.msg || error?.message || String(error), type: 'error', plain: true, duration: /类型/.test(error?.message || '') ? 8000 : 3000 });
const assertPreparing = value => {
  assertMounted();
  if (isCancelling.value) { const error = new Error('任务已停止'); error.cancelled = true; throw error; }
  return value;
};
// 与商品评价接口支持的商品链接域名一致。
const productReviewHosts = new Set([
  'haohuo.jinritemai.com', 'ecom.douyin.com', 'v.douyin.com',
  'xiaohongshu.com', 'www.xiaohongshu.com', 'xhslink.com', 'www.xhslink.com',
]);
const bareXhsProductLink = /^\s*(?:www\.)?(?:xiaohongshu\.com|xhslink\.com)\//i;
const productReviewLinkWrappers = {
  '(': ')', '[': ']', '{': '}', '（': '）', '【': '】', '<': '>',
  '《': '》', '「': '」', '『': '』', '"': '"', "'": "'", '“': '”', '‘': '’',
};
const hasBareXhsProductLink = line => {
  if (bareXhsProductLink.test(line)) return true;
  const text = line.trimStart();
  const opening = text[0];
  const closing = productReviewLinkWrappers[opening];
  const afterOpening = text.slice(1);
  if (!closing || !bareXhsProductLink.test(afterOpening)) return false;
  if (opening !== '(' && opening !== '[') return afterOpening.includes(closing);

  // 参数内成对的括号不能作为外层闭合符号。
  let depth = 1;
  for (const char of afterOpening) {
    if (char === opening) depth++;
    if (char === closing && --depth === 0) return true;
  }
  return false;
};
const parseManualProductReviewUrls = text => {
  if (typeof text !== 'string') return [];
  const tokens = /(?:^|([^a-z0-9@._:/-]))(?:https?:\/\/)?(?:www\.)?(?:xiaohongshu\.com|xhslink\.com)\/[^\s,，。！？；：、?#]*[?#]|([,，\r\n\u2028\u2029])/gi;
  const urls = new Set();
  let start = 0;
  for (let match; (match = tokens.exec(text));) {
    const separator = match[2] || match[1];
    if (separator && /[,，\r\n\u2028\u2029]/.test(separator)) {
      urls.add(text.slice(start, match.index).trim());
      start = match.index + 1;
    }
    if (match[2]) continue;

    // 跳过链接参数里的逗号，遇到链接外的闭合符号后恢复分隔。
    const closingBrackets = [];
    let end = match.index + (match[1]?.length ?? 0);
    for (; end < text.length; end++) {
      const char = text[end];
      if (/[\s，。！？；：、}】）>》」』"'”’]/.test(char)) break;
      if (char === ',' && /\s/.test(text[end + 1] ?? '')) break;
      if (char === '(' || char === '[') closingBrackets.push(char === '(' ? ')' : ']');
      else if ((char === ')' || char === ']') && char !== closingBrackets.pop()) break;
    }
    tokens.lastIndex = end;
  }
  urls.add(text.slice(start).trim());
  urls.delete('');
  return [...urls];
};
const hasProductReviewHost = url => {
  try {
    return productReviewHosts.has(new URL(url).hostname);
  } catch {
    return false;
  }
};
const extractProductReviewSegmentLink = segment => {
  const link = extractCellLink(segment);
  const label = segment?.text;
  // 飞书带格式粘贴可能把整段【链接】当作地址，并自动加上 http://。
  if (segment?.type !== 'url' || typeof label !== 'string' ||
    !label.startsWith('【') || !label.endsWith('】') || link !== `http://${label}`) return link;

  const bareLink = label.slice(1, -1);
  return bareXhsProductLink.test(bareLink) ? `https://${bareLink}` : link;
};
const extractProductReviewLink = value => {
  const isRichText = Array.isArray(value);
  const text = isRichText
    ? value.map(extractProductReviewSegmentLink).filter(Boolean).join('\n')
    : extractCellLink(value);
  if (!text) return null;
  const lines = text.split(/\r\n|[\r\n\u2028\u2029]/);
  let hasLink = false;
  const keptLines = lines.filter(line => {
    const httpUrls = extractHttpUrls(line);
    const hasHttpLink = httpUrls.some(url => /^https?:\/\/[a-z0-9]/i.test(url) && (!isRichText || hasProductReviewHost(url)));
    const hasBareXhsLink = hasBareXhsProductLink(line);
    hasLink ||= hasHttpLink || hasBareXhsLink;
    return hasHttpLink || hasBareXhsLink || httpUrls.length === 0;
  });
  if (!hasLink) return null;
  return keptLines.length === lines.length ? text : keptLines.join('\n');
};
const handleSubmit = async () => {
  if (disposed || loading.value || !initialReady.value) return;
  if (hasRecoverableTask.value) return resumeTask();
  const input = JSON.parse(JSON.stringify(formData.value));
  const source = { ...sourceContext };
  const output = { selectedFieldKeys: [...selectedFieldKeys.value], fieldMappings: mappingDraft.value.map(row => ({ ...row })), writeMode: input.radio === 1 ? 'append' : input.writeMode, targetTableId: input.radio === 2 ? input.table_id : '', initializingTableId: '' };
  const pages = reviewPagesType.value === 'all' ? 0 : input.pages;
  const replies = replyPagesType.value === 'none' ? -1 : replyPagesType.value === 'all' ? 0 : input.replyPages;
  let urls = input.mode === 'manual' ? parseManualProductReviewUrls(input.manualUrls) : [];
  try {
    if (!props.api_key) throw new Error('请先在首页配置 API Key');
    if (!Number.isInteger(pages) || pages < (reviewPagesType.value === 'all' ? 0 : 1) || pages > 50 || !Number.isInteger(replies) || replies < -1 || replies > 50 || (replyPagesType.value === 'pages' && replies < 1)) throw new Error('评价和回复页数须为1到50的整数');
    if (!['general', 'time_descending'].includes(input.sortType)) throw new Error('请选择评论排序');
    if (input.mode === 'manual' && !urls.length) throw new Error('请输入至少一个商品链接');
    if (input.radio === 2 && !input.table_id) throw new Error('请选择现有表格');
    if (output.fieldMappings.some(row => !row.source_key || !row.target_field_id)) throw new Error('请完成字段映射，或删除未完成的映射');
    if (input.mode === 'table' && (sourceFieldLoading.value || sourceFieldError.value || !input.productLinkFieldId || !source.tableId || !source.viewId)) throw new Error(sourceFieldError.value || '请选择商品链接字段');
    if (input.mode === 'table' && input.scope === 'n' && (!Number.isInteger(input.rowCount) || input.rowCount < 1 || input.rowCount > 100)) throw new Error('输入行数须为1到100的整数');
  } catch (error) { showError(error); return; }
  isCancelling.value = false;
  loading.value = true; feedback.begin('正在准备获取商品评价…');
  let preparing = true;
  try {
    if (input.mode === 'table') {
      const table = assertPreparing(await bitable.base.getTableById(source.tableId));
      const view = assertPreparing(await table.getViewById(source.viewId));
      let ids = [];
      if (input.scope === 'selected') ids = assertPreparing(await view.getSelectedRecordIdList());
      else {
        let pageToken; const seen = new Set(); const limit = input.scope === 'all' ? Infinity : input.rowCount;
        do {
          const page = assertPreparing(await view.getVisibleRecordIdListByPage({ pageSize: 200, pageToken }));
          const batch = Array.isArray(page) ? page : page.recordIds || [];
          ids.push(...batch); if (!page.hasMore || ids.length >= limit) break;
          if (!page.pageToken || seen.has(page.pageToken)) throw new Error('来源表未返回有效分页游标');
          seen.add(page.pageToken); pageToken = page.pageToken;
        } while (true);
        ids = ids.slice(0, limit);
      }
      if (!ids.length) throw new Error(input.scope === 'selected' ? '请先在表格中选择至少一行数据' : '未找到可读取的商品链接');
      const links = await readSourceRows(
        table, ids, input.productLinkFieldId, (_, value) => extractProductReviewLink(value), assertPreparing, { throwOnEmptyWithReadError: true },
      );
      urls = [...new Set(assertPreparing(links))];
    }
    assertPreparing(); if (!urls.length) throw new Error('请输入至少一个商品链接');
    if (input.radio === 2) {
      if (!tableConfigsLoaded.value || tableConfigsError.value) {
        feedback.progress('正在读取输出表配置…');
        const loaded = await loadTableOutputConfigs(); assertPreparing();
        if (!loaded) throw new Error(tableConfigsError.value || '读取表格输出配置失败');
        // 执行前固定的本表草稿优先；尚无草稿时仅采用本次读取的云配置。
        if (!targetDrafts.has(input.table_id)) {
          const cloud = cloudConfigs.get(input.table_id);
          output.fieldMappings = (cloud?.field_mappings || []).filter(row => output.selectedFieldKeys.includes(row.source_key)).map(row => ({ ...row }));
          output.writeMode = cloud?.write_mode === 'append' ? 'append' : 'upsert';
        }
      }
      assertPreparing();
      if (output.fieldMappings.some(row => !row.source_key || !row.target_field_id)) throw new Error('请完成字段映射，或删除未完成的映射');
      await validateTableFields(input.table_id, output.selectedFieldKeys, { fieldMappings: output.fieldMappings, writeMode: output.writeMode, uniqueKey: 'review_id', formatFieldsOnCreate: true, throwOnError: true, assertActive: assertPreparing, onProgress: feedback.progress }); assertPreparing();
    }
    preparing = false;
    await submitTask({
      ...output,
      sourceSnapshot: { ...source, ...input },
      requestSnapshot: {
        url: urls.join('\n'), pages, reply_pages: replies, sort_type: input.sortType,
        selected_field_keys: output.selectedFieldKeys,
      },
    });
  } catch (error) {
    if (disposed) return;
    const stopped = error?.cancelled || (preparing && isCancelling.value);
    loading.value = false;
    isCancelling.value = false;
    if (stopped) feedback.finish('任务已停止，已写入 0 条商品评价', { stopped: true });
    else feedback.fail(error);
  }
};
const handleCancel = async () => { try { await cancelTask(); } catch (error) { showError(error); } };
watch([() => formData.value.writeMode, mappingDraft], rememberDraft, { deep: true, flush: 'sync' });


const loadSourceFields = async (selection) => {
  if (disposed || loading.value || formData.value.mode !== 'table') return;
  const readId = ++sourceReadId;
  const isCurrent = () => !disposed && readId === sourceReadId && formData.value.mode === 'table';
  const previousId = formData.value.productLinkFieldId;
  const previousName = fieldOptions.value.find(field => field.id === previousId)?.name || sourceFieldName;
  sourceFieldLoading.value = true;
  sourceFieldError.value = '';
  try {
    const current = selection || await bitable.base.getSelection();
    if (!isCurrent()) return;
    if (!current?.tableId || !current?.viewId) throw new Error('请先打开需要读取商品链接的数据表视图');
    const sameTable = current.tableId === sourceContext.tableId;
    sourceContext = { tableId: current.tableId, viewId: current.viewId };
    if (!sameTable) formData.value.productLinkFieldId = '';
    const table = await bitable.base.getTableById(current.tableId);
    if (!isCurrent()) return;
    const view = await table.getViewById(current.viewId);
    if (!isCurrent()) return;
    const fields = await view.getFieldMetaList();
    if (!isCurrent()) return;
    fieldOptions.value = fields.filter(field => field.type === FieldType.Text || field.type === FieldType.Url);
    const sameName = fieldOptions.value.filter(field => field.name === previousName);
    formData.value.productLinkFieldId = sameTable && fieldOptions.value.some(field => field.id === previousId)
      ? previousId : sameName.length === 1 ? sameName[0].id : '';
    sourceFieldName = fieldOptions.value.find(field => field.id === formData.value.productLinkFieldId)?.name || '';
  } catch (error) {
    if (!isCurrent()) return;
    fieldOptions.value = [];
    formData.value.productLinkFieldId = '';
    sourceFieldName = previousName;
    sourceFieldError.value = error?.message || '读取商品链接字段失败，请重试';
  } finally {
    if (isCurrent()) sourceFieldLoading.value = false;
  }
};

const loadTableOptions = async () => {
  if (disposed || formData.value.radio !== 2) return;
  const readId = ++tableReadId;
  const isCurrent = () => !disposed && readId === tableReadId && formData.value.radio === 2;
  tableOptionsLoading.value = true;
  tableOptionsError.value = '';
  try {
    const tables = await bitable.base.getTableMetaList();
    if (isCurrent()) tableOptions.value = tables;
  } catch (error) {
    if (isCurrent()) {
      tableOptions.value = [];
      tableOptionsError.value = error?.message || '读取表格列表失败，请重试';
    }
  } finally {
    if (isCurrent()) tableOptionsLoading.value = false;
  }
};

const loadTargetFields = async () => {
  const tableId = formData.value.table_id;
  if (disposed || formData.value.radio !== 2 || !tableId) return;
  const readId = ++targetFieldReadId;
  const isCurrent = () => !disposed && readId === targetFieldReadId
    && formData.value.radio === 2 && formData.value.table_id === tableId;
  targetFieldLoading.value = true;
  targetFieldError.value = '';
  loadedTargetTableId.value = '';
  try {
    const table = await bitable.base.getTableById(tableId);
    if (!isCurrent()) return;
    const fields = await table.getFieldMetaList();
    if (!isCurrent()) return;
    tableFieldOptions.value = fields;
    loadedTargetTableId.value = tableId;
  } catch (error) {
    if (!isCurrent()) return;
    tableFieldOptions.value = [];
    targetFieldError.value = error?.message || '读取目标字段失败，请重试';
  } finally {
    if (isCurrent()) targetFieldLoading.value = false;
  }
};
const getMappingSourceFields = index => {
  const used = new Set(mappingDraft.value.filter((_, i) => i !== index).map(row => row.source_key));
  return FIELD_CONFIG.filter(field => selectedFieldKeys.value.includes(field.key))
    .map(field => ({ ...field, disabled: used.has(field.key) }));
};
const getMappingTargetFields = index => {
  const used = new Set(mappingDraft.value.filter((_, i) => i !== index).map(row => row.target_field_id));
  return tableFieldOptions.value.map(field => ({ ...field, disabled: used.has(field.id) }));
};
const addMapping = () => {
  if (outputConfigReady.value) mappingDraft.value.push({ source_key: '', target_field_id: '' });
};
const removeMapping = index => {
  if (outputConfigReady.value) mappingDraft.value.splice(index, 1);
};

watch([() => formData.value.radio, () => formData.value.table_id], ([radio, tableId]) => {
  if (loading.value || disposed) return;
  if (draftTableId && tableConfigsLoaded.value && loadedTargetTableId.value === draftTableId) targetDrafts.set(draftTableId, {
    ...targetDrafts.get(draftTableId),
    mappings: mappingDraft.value.map(row => ({ ...row })), writeMode: formData.value.writeMode,
  });
  ++targetFieldReadId;
  tableFieldOptions.value = [];
  targetFieldLoading.value = false;
  targetFieldError.value = '';
  loadedTargetTableId.value = '';
  mappingExpanded.value = false;
  draftTableId = radio === 2 ? tableId : '';
  const draft = targetDrafts.get(draftTableId);
  mappingDraft.value = (draft?.mappings || []).filter(row => !row.source_key || selectedFieldKeys.value.includes(row.source_key)).map(row => ({ ...row }));
  formData.value.writeMode = draft?.writeMode || 'upsert';
  if (draftTableId) { applyCloudDraft(draftTableId); void loadTargetFields(); if (!tableConfigsLoaded.value) void loadTableOutputConfigs(); }
}, { flush: 'sync' });
watch(selectedFieldKeys, keys => {
  mappingDraft.value = mappingDraft.value.filter(row => !row.source_key || keys.includes(row.source_key));
  // 配置等待期间也保留本地删减；云端保存仍由 rememberDraft 的就绪判断控制。
  const draft = targetDrafts.get(draftTableId);
  if (draft && !busy.value && !configApplying && draftTableId === formData.value.table_id) {
    draft.mappings = mappingDraft.value.map(row => ({ ...row }));
  }
});

watch(() => formData.value.mode, mode => {
  if (mode === 'table') void loadSourceFields();
  else { ++sourceReadId; sourceFieldLoading.value = false; }
});
watch(() => formData.value.radio, radio => {
  if (radio === 2) void loadTableOptions();
  else { ++tableReadId; tableOptionsLoading.value = false; }
});
onMounted(async () => {
  unsubscribeSelectionChange = bitable.base.onSelectionChange(({ data: selection }) => {
    if (disposed || formData.value.mode !== 'table' || !selection?.tableId || !selection?.viewId) return;
    if (loading.value) { pendingSelection = selection; return; }
    if (selection.tableId !== sourceContext.tableId || selection.viewId !== sourceContext.viewId) void loadSourceFields(selection);
  });
  void loadSourceFields();
  await resumeTask();
  if (!disposed) initialReady.value = true;
});
onUnmounted(() => {
  disposed = true;
  ++sourceReadId;
  ++tableReadId;
  ++targetFieldReadId;
  unsubscribeSelectionChange?.();
});
</script>

<template>
  <div class="sub-page">
    <div class="sub-page-header">
      <button type="button" class="sub-page-back" :disabled="loading" aria-label="返回首页" @click="$emit('back')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
          <polyline points="15 18 9 12 15 6"></polyline>
        </svg>
      </button>
      <span class="sub-page-title">商品评价</span>
    </div>
    <div class="form-card">
      <el-form class="form" :model="formData" label-position="top" :disabled="busy">
        <div class="section-heading"><span class="section-step">1</span><span>获取设置</span></div>
        <el-form-item>
          <div class="c-label">商品链接来源</div>
          <el-radio-group v-model="formData.mode" class="radio-block source-mode-radio" aria-label="商品链接来源">
            <el-radio value="table">从表格选取</el-radio>
            <el-radio value="manual">手动输入</el-radio>
          </el-radio-group>
        </el-form-item>

        <template v-if="formData.mode === 'table'">
          <el-form-item>
            <div class="c-label">商品链接</div>
            <el-select v-model="formData.productLinkFieldId" filterable aria-label="商品链接字段"
              placeholder="输入字段名称搜索或选择" no-match-text="未找到匹配字段" :loading="sourceFieldLoading"
              :disabled="busy || sourceFieldLoading || !!sourceFieldError">
              <el-option v-for="field in fieldOptions" :key="field.id" :label="field.name" :value="field.id" />
            </el-select>
            <div v-if="sourceFieldLoading" class="sub-hint" role="status">正在读取商品链接字段…</div>
            <div v-else-if="sourceFieldError" class="table-config-feedback sub-hint" role="status">
              <span>{{ sourceFieldError }}</span><el-button link type="primary" @click="loadSourceFields()">重试</el-button>
            </div>
          </el-form-item>
          <el-form-item>
            <div class="c-label">输入行范围</div>
            <el-radio-group v-model="formData.scope" class="custom-radio-group" aria-label="输入行范围">
              <el-radio value="all">所有行</el-radio>
              <el-radio value="selected">选中行</el-radio>
              <el-radio value="n">
                <span>前</span>
                <div class="custom-stepper-input">
                  <input v-model.number="formData.rowCount" type="number" min="1" max="100" aria-label="输入行数" :disabled="busy || formData.scope !== 'n'" @click.stop />
                  <div class="stepper-buttons">
                    <button type="button" class="stepper-btn stepper-btn-up" aria-label="增加输入行数" :disabled="busy || formData.scope !== 'n' || formData.rowCount >= 100" @click.stop="formData.rowCount = Math.min(100, (formData.rowCount || 1) + 1)"></button>
                    <button type="button" class="stepper-btn stepper-btn-down" aria-label="减少输入行数" :disabled="busy || formData.scope !== 'n' || formData.rowCount <= 1" @click.stop="formData.rowCount = Math.max(1, (formData.rowCount || 1) - 1)"></button>
                  </div>
                </div>
                <span class="range-unit">行</span>
              </el-radio>
            </el-radio-group>
          </el-form-item>
        </template>
        <el-form-item v-else>
          <div class="c-label">商品链接</div>
          <el-input v-model="formData.manualUrls" type="textarea" :rows="4" aria-label="商品链接"
            placeholder="请输入商品链接，多个链接请换行或用逗号加空格分隔" />
        </el-form-item>

        <el-form-item>
          <div class="c-label">商品评价</div>
          <el-radio-group v-model="reviewPagesType" class="custom-radio-group" aria-label="商品评价提取范围">
            <el-radio value="all">全部评价</el-radio>
            <el-radio value="pages">
              <span>前</span>
              <PageStepper v-model="formData.pages" label="商品评价页数" :disabled="busy || reviewPagesType !== 'pages'" />
              <span class="range-unit">页</span>
            </el-radio>
          </el-radio-group>
        </el-form-item>

        <el-form-item>
          <div class="c-label">商品评价回复</div>
          <el-radio-group v-model="replyPagesType" class="custom-radio-group" aria-label="商品评价回复提取范围">
            <el-radio value="none">不获取</el-radio>
            <el-radio value="all">全部回复</el-radio>
            <el-radio value="pages">
              <span>前</span>
              <PageStepper v-model="formData.replyPages" label="商品评价回复页数" :disabled="busy || replyPagesType !== 'pages'" />
              <span class="range-unit">页</span>
            </el-radio>
          </el-radio-group>
        </el-form-item>

        <el-form-item>
          <div class="c-label">评论排序</div>
          <el-select v-model="formData.sortType" aria-label="评论排序">
            <el-option v-for="option in sortOptions" :key="option.value" :label="option.label" :value="option.value" />
          </el-select>
        </el-form-item>

        <div class="output-config">
          <div class="section-heading"><span class="section-step">2</span><span>输出设置</span></div>
          <el-form-item>
            <div class="c-label">输出到表格</div>
            <el-radio-group v-model="formData.radio" class="radio-block" aria-label="输出到表格">
              <el-radio :value="1">新建表格</el-radio>
              <el-radio :value="2">使用现有表格</el-radio>
            </el-radio-group>
          </el-form-item>
          <template v-if="formData.radio === 2">
            <el-form-item>
              <div class="c-label">选择现有表格</div>
              <el-select v-model="formData.table_id" aria-label="选择现有表格" placeholder="请选择" :loading="tableOptionsLoading" :disabled="busy || tableOptionsLoading || !!tableOptionsError">
                <el-option v-for="table in tableOptions" :key="table.id" :label="table.name" :value="table.id" />
              </el-select>
              <div v-if="tableOptionsLoading" class="sub-hint" role="status">正在读取表格列表…</div>
              <div v-else-if="tableOptionsError" class="table-config-feedback sub-hint" role="status">
                <span>{{ tableOptionsError }}</span><el-button link type="primary" @click="loadTableOptions">重试</el-button>
              </div>
            </el-form-item>
            <el-form-item>
              <div class="c-label">数据写入方式</div>
              <el-radio-group v-model="formData.writeMode" class="radio-block" aria-label="数据写入方式" :disabled="busy || !outputConfigReady">
                <el-radio value="upsert">更新或新增</el-radio>
                <el-radio value="append">始终新增</el-radio>
              </el-radio-group>
            </el-form-item>
          </template>
          <el-form-item class="output-fields">
            <div class="field-selection-title">
              <span class="c-label">输出字段</span>
              <el-checkbox :model-value="isAllFieldsSelected" :indeterminate="isFieldsPartiallySelected" class="select-all-fields" :disabled="busy" @change="toggleAllFields">全选</el-checkbox>
            </div>
            <el-checkbox-group v-model="selectedFieldKeys" class="field-checkbox-group" aria-label="输出字段">
              <el-checkbox v-for="field in FIELD_CONFIG" :key="field.key" :value="field.key" :disabled="busy || field.required" class="field-checkbox-item">
                <span class="field-name" :title="field.name">{{ field.name }}</span><span v-if="field.hint" class="field-platform-hint">{{ field.hint }}</span>
              </el-checkbox>
            </el-checkbox-group>
          </el-form-item>
          <div v-if="formData.radio === 2" class="mapping-accordion">
            <button type="button" class="mapping-accordion-trigger" :aria-expanded="mappingExpanded"
              aria-controls="product-review-mapping" @click="mappingExpanded = !mappingExpanded">
              <span class="ui-disclosure-label">字段映射 <span class="ui-disclosure-meta">（可选）</span><span class="ui-disclosure-meta">{{ mappingStatus }}</span></span>
              <span class="mapping-chevron" :class="{ 'is-expanded': mappingExpanded }" aria-hidden="true"></span>
            </button>
            <div v-if="tableConfigsLoading" class="sub-hint" role="status">正在加载表格配置…</div>
            <div v-if="tableConfigsError" class="table-config-feedback sub-hint" role="status"><span>{{ tableConfigsError }}</span><el-button link type="primary" :disabled="busy" @click="loadTableOutputConfigs">重试</el-button></div>
            <div v-if="tableConfigSaveError" class="table-config-feedback sub-hint" role="status"><span>{{ tableConfigSaveError }}</span><el-button link type="primary" :disabled="busy" @click="rememberDraft">重试</el-button></div>
            <div v-if="targetFieldError" class="table-config-feedback sub-hint" role="status">
              <span>{{ targetFieldError }}</span><el-button link type="primary" @click="loadTargetFields">重试</el-button>
            </div>
            <div id="product-review-mapping" v-show="mappingExpanded" class="mapping-accordion-panel">
              <p v-if="targetFieldLoading" class="sub-hint" role="status">正在读取目标字段…</p>
              <template v-if="formData.table_id">
                <p class="mapping-note sub-hint">同名字段自动匹配；名称不同时可指定目标列。未指定映射的字段按同名列匹配，缺列时按默认类型创建。</p>
                <div v-for="(mapping, index) in mappingDraft" :key="index" class="mapping-row">
                  <el-select v-model="mapping.source_key" :aria-label="`映射输出字段 ${index + 1}`" :disabled="busy || !outputConfigReady" placeholder="选择输出字段" size="small">
                    <el-option v-for="field in getMappingSourceFields(index)" :key="field.key" :label="field.name" :value="field.key" :disabled="field.disabled" />
                  </el-select>
                  <span class="mapping-arrow" aria-hidden="true">→</span>
                  <el-select v-model="mapping.target_field_id" :aria-label="`映射目标字段 ${index + 1}`" :disabled="busy || !outputConfigReady" placeholder="选择目标字段" size="small">
                    <el-option v-for="field in getMappingTargetFields(index)" :key="field.id" :label="field.name" :value="field.id" :disabled="field.disabled" />
                  </el-select>
                  <el-button link type="danger" :aria-label="`删除字段映射 ${index + 1}`" :disabled="busy || !outputConfigReady" @click="removeMapping(index)">删除</el-button>
                </div>
                <div class="mapping-actions"><el-button link type="primary" :disabled="busy || !outputConfigReady" @click="addMapping">+ 添加字段映射</el-button></div>
              </template>
              <p v-else class="sub-hint">选择目标表格后配置字段映射</p>
            </div>
          </div>
        </div>
      </el-form>
      <div class="action-group">
        <p v-if="taskNotice" class="sub-hint" role="status">{{ taskNotice }}{{ noticeRequiresReopen ? ' 请重新进入插件恢复。' : '' }}</p>
        <el-button v-if="loading && !clearing" class="commit-btn" :loading="isCancelling" :disabled="isCancelling" @click="handleCancel">{{ isCancelling ? '正在停止…' : '停止任务' }}</el-button>
        <el-button v-else class="commit-btn" :loading="loading || !initialReady" :disabled="loading || !initialReady || noticeRequiresReopen" @click="handleSubmit">{{ hasRecoverableTask ? '恢复任务' : !initialReady ? '准备中…' : '立即执行' }}</el-button>
      </div>
    </div>
    <TaskExecutionResult :result="latestExecutionResult" />
    <TaskFeedback :visible="toastVisible" :text="toastText" :kind="toastType" />
  </div>
</template>

<style scoped>
.sub-page { min-height: 100vh; background: #fffcfc; font-family: var(--app-font-family); }
.sub-page-header { display: flex; align-items: center; padding: 12px 16px; background: #fff; border-bottom: 1px solid #e5e6eb; position: sticky; top: 0; z-index: 100; }
.sub-page-back { display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; margin-right: 12px; padding: 0; border: 0; background: transparent; color: #4e5969; cursor: pointer; }
.sub-page-back:hover { color: #a8071a; }
.sub-page-back:focus-visible { outline: 2px solid #a8071a; outline-offset: 2px; }
.sub-page-back svg { width: 16px; height: 16px; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.sub-page-title { color: #1d2129; font-size: var(--app-font-size-emphasis); font-weight: var(--app-font-weight-semibold); line-height: 24px; }
.form-card { margin: 16px; padding: 20px; background: #fff; border: 1px solid #e5e6eb; border-radius: 8px; box-sizing: border-box; }
.form, .output-config { display: flex; flex-direction: column; gap: var(--app-space-group); }
.form :deep(.el-form-item) { margin: 0; }
.form :deep(.el-form-item__content) { min-width: 0; display: flex; flex-direction: column; align-items: stretch; gap: var(--app-space-control); line-height: 22px; }
.form :deep(.el-select) { width: 100%; }
.section-heading { display: flex; align-items: center; gap: 8px; color: #1d2129; font-size: var(--app-font-size-section); font-weight: var(--app-font-weight-medium); line-height: 22px; }
.section-step { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 50%; color: #a8071a; background: #fff1f2; font-size: var(--app-font-size-caption); font-weight: var(--app-font-weight-semibold); }
.c-label { color: #4e5969; font-size: var(--app-font-size-body); font-weight: var(--app-font-weight-medium); line-height: 22px; }
.radio-block { display: flex; flex-wrap: wrap; gap: 8px 16px; }
.radio-block :deep(.el-radio) { margin-right: 0; min-height: 28px; }
.custom-radio-group { display: flex; flex-direction: column; align-items: stretch; gap: 8px; }
.custom-radio-group :deep(.el-radio) { display: flex; align-items: center; flex-wrap: nowrap; height: 32px; margin-right: 0; }
.custom-radio-group :deep(.el-radio__input) { flex-shrink: 0; margin-right: 8px; }
.custom-radio-group :deep(.el-radio__inner) { width: 16px; height: 16px; border-color: #e5e6eb; }
.custom-radio-group :deep(.el-radio__input.is-checked .el-radio__inner) { border: 4px solid #a8071a; background: #fff; }
.custom-radio-group :deep(.el-radio__inner::after) { display: none; }
.custom-radio-group :deep(.el-radio__label) { display: flex; align-items: center; padding-left: 0; min-width: 0; }
.sub-page :deep(.el-radio__label), .sub-page :deep(.el-checkbox__label) { font-family: inherit; font-size: var(--app-font-size-body); font-weight: var(--app-font-weight-regular); line-height: 22px; }
.custom-stepper-input { display: flex; width: 80px; height: 32px; margin-left: 8px; background: #fff; border: 1px solid #e5e6eb; border-radius: 6px; box-sizing: border-box; overflow: hidden; }
.custom-stepper-input:focus-within { border-color: #a8071a; }
.custom-stepper-input input { flex: 1; min-width: 0; width: 44px; padding: 0 8px; border: 0; outline: none; background: transparent; color: #1d2129; text-align: center; font: inherit; appearance: textfield; }
.custom-stepper-input input:disabled { color: #86909c; background: #fafafa; }
.custom-stepper-input input::-webkit-inner-spin-button, .custom-stepper-input input::-webkit-outer-spin-button { appearance: none; margin: 0; }
.stepper-buttons { display: flex; flex-direction: column; width: 28px; border-left: 1px solid #e5e6eb; background: #f2f3f5; flex-shrink: 0; }
.stepper-btn { display: flex; align-items: center; justify-content: center; flex: 1; width: 100%; padding: 0; border: 0; background: transparent; cursor: pointer; }
.stepper-btn-up { border-bottom: 1px solid #e5e6eb; }
.stepper-btn::before { content: ''; width: 0; height: 0; border-left: 4px solid transparent; border-right: 4px solid transparent; }
.stepper-btn-up::before { border-bottom: 4px solid #86909c; }
.stepper-btn-down::before { border-top: 4px solid #86909c; }
.stepper-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.stepper-btn:not(:disabled):hover { background: #fff0f2; }
.range-unit { margin-left: 8px; color: #4e5969; }
.output-config { margin-top: calc(var(--app-space-section) - var(--app-space-group)); }
.field-selection-title { display: flex; flex-direction: column; align-items: flex-start; gap: var(--app-space-control); }
.field-selection-title .c-label { margin-bottom: 0; }
.select-all-fields { height: 22px; margin: 0; }
.output-fields :deep(.el-checkbox__label) { padding-left: 8px; color: #1d2129; }
.output-fields :deep(.el-checkbox__input.is-checked + .el-checkbox__label) { color: #1d2129; }
.output-fields :deep(.el-checkbox__inner) { width: 16px; height: 16px; border-radius: 4px; border-color: #e5e6eb; }
.output-fields :deep(.el-checkbox:hover .el-checkbox__inner) { border-color: #86909c; }
.output-fields :deep(.el-checkbox__input.is-checked .el-checkbox__inner),
.output-fields :deep(.el-checkbox__input.is-indeterminate .el-checkbox__inner) { background: #a8071a; border-color: #a8071a; }
.output-fields :deep(.is-disabled.is-checked .el-checkbox__inner) { background: #f7f8fa; border-color: #e5e6eb; }
.output-fields :deep(.is-disabled.is-checked .el-checkbox__inner::after) { border-color: #c9cdd4; }
.field-checkbox-group { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 12px 16px; }
.field-checkbox-group :deep(.el-checkbox) { height: auto; min-height: 22px; min-width: 0; margin: 0; align-items: center; }
.field-checkbox-group :deep(.el-checkbox__label) { display: flex; align-items: baseline; min-width: 0; white-space: nowrap; }
.field-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.field-platform-hint { flex-shrink: 0; margin-left: 6px; color: #86909c; font-size: var(--app-font-size-caption); font-weight: var(--app-font-weight-regular); }
.sub-hint { margin: 0; color: #86909c; font-size: var(--app-font-size-caption); line-height: 20px; overflow-wrap: anywhere; }
.table-config-feedback { margin: 0; }
.mapping-accordion-trigger { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; min-height: 32px; padding: 0; border: 0; background: transparent; color: #1d2129; text-align: left; cursor: pointer; }
.mapping-accordion-trigger .ui-disclosure-label { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px; }
.mapping-accordion-trigger:focus-visible { outline: 2px solid #a8071a; outline-offset: 2px; }
.mapping-chevron { flex-shrink: 0; width: 8px; height: 8px; margin-right: 4px; border-right: 1.5px solid #86909c; border-bottom: 1.5px solid #86909c; transform: rotate(45deg) translateY(-2px); }
.mapping-chevron.is-expanded { transform: rotate(225deg) translateY(-2px); }
.mapping-accordion-panel { padding-top: var(--app-space-control); }
.mapping-note { margin-bottom: var(--app-space-control); }
.mapping-row { display: grid; grid-template-columns: minmax(0, 1fr) 12px minmax(0, 1fr) auto; align-items: center; gap: 4px; min-height: 44px; }
.mapping-row :deep(.el-select__wrapper) { min-height: 36px; padding: 0 8px; border-radius: 6px; }
.mapping-row :deep(.el-button) { min-width: 28px; padding: 4px; }
.mapping-arrow { color: #86909c; text-align: center; }
.mapping-actions { display: flex; margin-top: var(--app-space-control); }
.action-group { display: flex; flex-direction: column; gap: var(--app-space-control); margin-top: var(--app-space-group); }
</style>
