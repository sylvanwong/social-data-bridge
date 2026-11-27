import { computed, onUnmounted, ref } from 'vue';

const RUNNING_REMINDER = '请勿关闭插件，关闭将中断任务';
const WRITING_REMINDER = '请勿关闭插件，关闭会中断数据写入';
const errorText = error => String(error?.response?.data?.msg || error?.message || error || '执行失败，请稍后重试');
const resultText = text => String(text || '').replace(/[，。]?\s*请勿关闭插件，关闭(?:将中断任务|会中断数据写入)[。！!]?$/, '');

// 只管理页面反馈；任务、写入进度、恢复和互斥仍由调用方拥有。
export function useTaskFeedback({ executionResult } = {}) {
  const toastVisible = ref(false);
  const toastText = ref('');
  const toastType = ref('loading');
  const toastLoading = computed(() => toastType.value === 'loading');
  const taskNotice = ref('');
  const missingTargetAction = ref(null);
  const endPausedAction = ref(null);
  const endingMissingTarget = ref(false);
  let disposed = false;
  const noticeRequiresReopen = ref(false);
  let timer = null;

  const cancelTimer = () => { if (timer !== null) clearTimeout(timer); timer = null; };
  const clearNotice = () => { missingTargetAction.value = null; endPausedAction.value = null; taskNotice.value = ''; noticeRequiresReopen.value = false; };
  const hide = () => { cancelTimer(); toastVisible.value = false; };
  const progress = (text, { stopping = false } = {}) => {
    cancelTimer();
    const message = String(text || '正在处理…');
    toastText.value = message.includes('请勿关闭插件') ? message
      : `${message}${/[.…]$/.test(message) ? '' : '，'}${stopping ? WRITING_REMINDER : RUNNING_REMINDER}`;
    toastType.value = 'loading';
    toastVisible.value = true;
  };
  const begin = (text, options) => { clearNotice(); progress(text, options); };
  const finish = (text, { type, stopped = false, successCount, failCount = 0, empty = false } = {}) => {
    cancelTimer();
    clearNotice();
    const kind = stopped ? (failCount > 0 ? 'warning' : 'info')
      : type || (failCount > 0 ? (successCount > 0 ? 'warning' : 'error') : empty ? 'info' : 'success');
    toastText.value = resultText(text);
    toastType.value = kind;
    toastVisible.value = true;
    const duration = kind === 'error' && /字段[\s\S]*类型(?:不匹配|错误)/.test(toastText.value)
      ? 8000 : kind === 'success' || (stopped && !failCount) ? 3000 : 5000;
    timer = setTimeout(() => { timer = null; toastVisible.value = false; }, duration);
  };
  const fail = (error, { persist = false, requiresReopen = !!error?.requiresReopen, fallbackEndAction = null } = {}) => {
    const text = errorText(error);
    finish(text, { type: 'error' });
    missingTargetAction.value = error?.endMissingTarget || null;
    if (!requiresReopen && !error?.cause?.requiresReopen && !error?.taskEnded && !missingTargetAction.value) {
      endPausedAction.value = error?.endPausedTask || fallbackEndAction;
    }
    if (persist || requiresReopen || error?.stopPolling) {
      taskNotice.value = text;
      noticeRequiresReopen.value = requiresReopen;
    }
  };
  const recordFailure = (error, { index } = {}) => {
    taskNotice.value = `${index ? `第 ${index} 条处理失败` : '单条处理失败'}：${errorText(error)}，整批任务继续执行。`;
    noticeRequiresReopen.value = false;
  };

  const endMissingTargetTask = async (loading, recoverable, requiresReopen, onRestored, onEnded, action = missingTargetAction) => {
    const end = action.value;
    if (!end || loading.value) return;
    const pausedResult = executionResult?.value?.status === 'paused' ? executionResult.value : null;
    const pausedReason = pausedResult?.reason;
    endingMissingTarget.value = true;
    loading.value = true;
    begin('正在结束任务…');
    if (pausedResult) pausedResult.reason = '';
    let restoredTask;
    try {
      const result = await end();
      if (disposed) return;
      restoredTask = result?.restoredTask;
      if (result === true) {
        recoverable.value = false;
        hide();
        if (pausedResult && executionResult.value === pausedResult) executionResult.value = null;
        await onEnded?.();
      } else if (!restoredTask && pausedResult && executionResult.value === pausedResult) {
        pausedResult.reason = pausedReason;
      }
    } catch (error) {
      if (disposed) return;
      if (requiresReopen) requiresReopen.value = !!error.requiresReopen;
      fail(error, { persist: true });
      if (!action.value && (action === missingTargetAction || !error.requiresReopen)) {
        action.value = end;
        if (end.notice) taskNotice.value = `${taskNotice.value} ${end.notice}`;
      }
      if (pausedResult && executionResult.value === pausedResult) pausedResult.reason = taskNotice.value;
    } finally {
      if (!disposed) {
        endingMissingTarget.value = false;
        loading.value = false;
      }
    }
    if (!disposed && restoredTask) return onRestored(restoredTask);
  };

  onUnmounted(() => { disposed = true; hide(); clearNotice(); });
  return { endPausedAction, missingTargetAction, endingMissingTarget, endMissingTargetTask, toastVisible, toastText, toastType, toastLoading, taskNotice, noticeRequiresReopen, begin, progress, finish, fail, recordFailure, hide, clearNotice };
}
