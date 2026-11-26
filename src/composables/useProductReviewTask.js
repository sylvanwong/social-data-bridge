import { buildTaskExecutionResult } from '../utils/taskExecutionResult.mjs';
import { onUnmounted, ref } from 'vue';
import { bitable } from '@lark-base-open/js-sdk';
import { feishuRequest, FEISHU_API_BASE_URL, FEISHU_API_PATH_PREFIX, buildFeishuApiPath } from '@/utils/request';
import { applyFieldDisplayConfig, createSequentialTable, useSocialData } from './useSocialData';
import { useIncrementalTask } from './useIncrementalTask';
import { useTaskFeedback } from './useTaskFeedback.mjs';
import { getTaskStoppingText } from '../utils/taskStopText';

export const PRODUCT_REVIEW_TASK_KEY = 'product_review_incremental_task_v1';
const clone = value => JSON.parse(JSON.stringify(value));
export const unwrapProductResponse = response => {
  const envelope = response?.data;
  if (envelope?.sta !== 0) throw new Error(envelope?.msg || '商品评价请求失败');
  return envelope.data;
};
export function useProductReviewTask({ props, fields, onIdle, onRestore, onCancelError }) {
  const loading = ref(false), hasRecoverableTask = ref(false), isCancelling = ref(false), clearing = ref(false);
  const feedback = useTaskFeedback();
  const latestExecutionResult = ref(null);
  const { createAndWriteData } = useSocialData(() => '商品评价', '', fields);
  let disposed = false;
  const assertMounted = value => { if (disposed) { const error = new Error('页面已离开'); error.stopPolling = true; throw error; } return value; };
  const api = async (task, method, suffix, data) => {
    assertMounted();
    return feishuRequest({ baseURL: task.apiBaseURL, url: buildFeishuApiPath(`/v1/feishu/product/review/${suffix}`, task.apiPrefix), method, headers: { authorization: `Bearer ${props.api_key}` }, ...(method === 'get' ? { params: data } : { data }) });
  };
  const idle = () => { loading.value = false; isCancelling.value = false; clearing.value = false; onIdle?.(); };
  const taskEngine = useIncrementalTask({
    storageKey: PRODUCT_REVIEW_TASK_KEY, operationTimeoutMs: 60000,
    isTerminal: status => [1, 2, 3].includes(Number(status.status)),
    getStatus: async task => unwrapProductResponse(await api(task, 'get', 'task', { task_id: task.taskId })),
    getResults: async task => {
      const pendingCount = task.writeMode === 'append' ? task.appendState?.pendingCount : 0;
      // 后台仍可能追加结果，先核对原失败批次，成功后再恢复正常批量。
      const limit = Number.isInteger(pendingCount) && pendingCount > 0 && pendingCount <= 20 ? pendingCount : 20;
      return unwrapProductResponse(await api(task, 'post', 'list', { task_id: task.taskId, after_id: task.cursor || '', limit, ...(Number(task.latestStatus?.status) === 3 ? { include_count: true } : {}) }));
    },
    writeBatch: async (items, task, { assertActive, saveProgress }) => {
      const active = value => { assertMounted(); assertActive(); return value; };
      active();
      if (!task.targetTableId) {
        const created = active(await createSequentialTable('商品评价', active));
        task.targetTableId = created.tableId; task.initializingTableId = created.tableId;
        await saveProgress(); active();
      }
      if (task.initializingTableId) {
        const table = active(await bitable.base.getTableById(task.targetTableId));
        let meta = active(await table.getFieldMetaList());
        const selected = fields.filter(field => task.selectedFieldKeys.includes(field.key) || field.required);
        // 仅初始化本任务刚创建的表；恢复时跳过已存在字段，保留实际主字段ID。
        for (const [index, config] of selected.entries()) {
          if (meta.some(field => field.name === config.name)) continue;
          active();
          if (index === 0 && meta[0]) await table.setField(meta[0].id, { name: config.name, type: config.type });
          else await table.addField({ name: config.name, type: config.type });
          active(); meta = active(await table.getFieldMetaList());
          if (config.formatter || config.dateFormat) {
            const field = active(await table.getFieldById(meta.find(field => field.name === config.name).id));
            try {
              await applyFieldDisplayConfig(field, config, active);
            } catch (error) {
              active();
              if (error?.stopPolling || error?.cancelled) throw error;
              console.error(`设置字段 ${config.name} 格式失败:`, error);
            }
            active();
          }
        }
        task.initializingTableId = ''; await saveProgress(); active();
      }
      const append = task.writeMode === 'append';
      const appendState = append ? { ...task.appendState, ...(task.appendState?.knownRecordIds ? { knownRecordIds: new Set(task.appendState.knownRecordIds) } : {}) } : null;
      const syncAppend = () => { task.appendState = { ...appendState, knownRecordIds: [...(appendState.knownRecordIds || [])] }; };
      const normalized = items.map(item => ({ ...item,
        social_type: ({ douyin: '抖音', xhs: '小红书' })[item.social_type] || item.social_type || '',
        helpful_count: item.helpful_count ?? (item.social_type === 'xhs' ? item.like_count : undefined),
        review_type: ({ positive: '好评', negative: '差评', neutral: '中评' })[item.review_type] || item.review_type || '',
      }));
      await createAndWriteData(normalized, 'stream', task.taskId, task.targetTableId, task.selectedFieldKeys, {
        stopAfterCurrentBatch: true, uniqueKey: 'review_id', writeMode: task.writeMode, fieldMappings: task.fieldMappings,
        reconcile: !append && !!task.pendingWrite, skipFieldDisplayConfig: true, assertActive: active,
        // 原任务的字段key顺序与追加批次的fieldIds配套，不随界面排序变化。
        ...(append ? { appendState, fieldOrder: task.selectedFieldKeys } : {}),
        onBeforeWrite: async () => { if (append) syncAppend(); else task.pendingWrite = true; await saveProgress(); active(); },
      });
      active();
      // 不单独保存清除标记；由任务引擎和新cursor／writtenCount一起提交。
      if (append) syncAppend(); else task.pendingWrite = false;
    },
    onProgress: (status, task, phase) => {
      if (disposed) return;
      if (status?.cancel_requested || Number(status?.status) === 3) isCancelling.value = true;
      clearing.value = phase === 'clearing';
      if (clearing.value) feedback.progress('正在清理商品评价任务进度…', { stopping: isCancelling.value });
      else if (isCancelling.value || status?.cancel_requested || Number(status?.status) === 3) feedback.progress(getTaskStoppingText(task, '商品评价'), { stopping: true });
      else feedback.progress(`已处理 ${Number(status?.processed) || 0}${status?.total ? `/${status.total}` : ''} 个商品，已写入 ${task.writtenCount || 0} 条商品评价`);
    },
    onWriting: (items, task) => { if (!disposed) feedback.progress(isCancelling.value || Number(task.latestStatus?.status) === 3 ? getTaskStoppingText(task, '商品评价') : `正在写入 ${items.length} 条商品评价，已写入 ${task.writtenCount || 0} 条`, { stopping: isCancelling.value || Number(task.latestStatus?.status) === 3 }); },
    onFinish: (status, task) => {
      if (disposed) return;
      latestExecutionResult.value = buildTaskExecutionResult(status, task, { kind: 'productReview' });
      hasRecoverableTask.value = false; idle();
      const count = task.writtenCount || 0, failed = Number(status?.failed) || (Number(status?.status) === 2 ? 1 : 0);
      const stopped = Number(status?.status) === 3;
      const reason = status?.reason || status?.message || '';
      feedback.finish(`${stopped ? '任务已停止' : Number(status?.status) === 2 ? '商品评价获取失败' : '处理完成'}，已写入 ${count} 条商品评价${failed ? `，${failed} 个商品获取失败` : ''}${reason ? `：${reason}` : ''}`, { stopped, failCount: failed, successCount: count, empty: !count });
    },
    onError: (error, task) => { if (!disposed) { latestExecutionResult.value = { ...buildTaskExecutionResult(task?.latestStatus, task || {}, { kind: 'productReview' }), status: 'paused', reason: error.message }; hasRecoverableTask.value = true; idle(); feedback.fail(error, { persist: true }); } },
  });
  const resumeTask = async () => {
    if (disposed || loading.value || feedback.noticeRequiresReopen.value) return false;
    loading.value = true;
    latestExecutionResult.value = null;
    try {
      const found = await taskEngine.resume(task => {
        assertMounted();
        const pendingCancel = isCancelling.value;
        const confirmedStop = !!(task.latestStatus?.cancel_requested || Number(task.latestStatus?.status) === 3);
        isCancelling.value = pendingCancel || confirmedStop;
        feedback.begin(isCancelling.value ? getTaskStoppingText(task, '商品评价') : '正在恢复未完成的商品评价任务…', { stopping: isCancelling.value });
        hasRecoverableTask.value = true;
        if (!task.apiPrefix) task.apiPrefix = FEISHU_API_PATH_PREFIX;
        onRestore?.(task);
        if (pendingCancel && !confirmedStop) {
          // 交回原取消入口，复用请求与失败归属判断，不阻塞轮询。
          isCancelling.value = false;
          void cancelTask().catch(error => onCancelError?.(error));
        }
      });
      if (!found && !disposed) { hasRecoverableTask.value = false; idle(); feedback.hide(); }
      return found;
    } catch (error) { if (!disposed) { hasRecoverableTask.value = true; idle(); feedback.fail(error, { persist: true }); } return false; }
  };
  const submitTask = async snapshot => {
    latestExecutionResult.value = null;
    await taskEngine.submit(async () => {
      const task = { ...clone(snapshot), apiBaseURL: FEISHU_API_BASE_URL || '', apiPrefix: FEISHU_API_PATH_PREFIX, pendingWrite: false };
      const data = unwrapProductResponse(await api(task, 'post', 'task', clone(task.requestSnapshot)));
      return { ...task, taskId: data?.task_id };
    }, async task => {
      if (isCancelling.value) {
        try { unwrapProductResponse(await api(task, 'post', 'task/cancel', { task_id: task.taskId })); }
        catch (error) { isCancelling.value = false; throw error; }
      }
    });
  };
  const cancelTask = async () => {
    const task = taskEngine.getActiveTask();
    if (disposed || isCancelling.value || clearing.value) return;
    isCancelling.value = true; feedback.progress(getTaskStoppingText(task || {}, '商品评价'), { stopping: true });
    if (!task) return;
    try { unwrapProductResponse(await api(task, 'post', 'task/cancel', { task_id: task.taskId })); }
    catch (error) {
      if (disposed || taskEngine.getActiveTask() !== task) return;
      if (task.latestStatus?.cancel_requested || Number(task.latestStatus?.status) === 3) return;
      isCancelling.value = false;
      feedback.progress(`任务继续执行，已写入 ${task.writtenCount || 0} 条商品评价`);
      throw error;
    }
  };
  onUnmounted(() => { disposed = true; taskEngine.stop(); });
  return { latestExecutionResult, loading, hasRecoverableTask, isCancelling, clearing, feedback, assertMounted, resumeTask, submitTask, cancelTask };
}
