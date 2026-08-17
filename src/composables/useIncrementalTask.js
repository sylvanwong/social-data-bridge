import { bitable } from '@lark-base-open/js-sdk';

const ACTIVE_INTERVAL = 2000;
const MAX_INTERVAL = 30000;
const STALL_TIMEOUT = 10 * 60 * 1000;

const unwrapApiData = (responseData) => {
  if (responseData?.sta !== undefined) {
    if (responseData.sta !== 0) throw new Error(responseData.msg || '请求失败');
    return responseData.data || {};
  }
  return responseData || {};
};

export const useIncrementalTask = ({ storageKey, getStatus, getResults, writeBatch, onProgress, onWriting, onFinish, onError }) => {
  let activeTask = null;
  let timer = null;
  let inFlight = false;

  const save = async (task) => bitable.bridge.setData(storageKey, task);
  const clear = async () => {
    try {
      await bitable.bridge.setData(storageKey, {});
    } catch (error) {
      console.error('清除增量任务恢复状态失败:', error);
    }
  };
  const stop = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    activeTask = null;
  };
  const schedule = (task, delay) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => poll(task), delay);
  };

  const drain = async (task) => {
    let wroteData = false;
    while (activeTask === task) {
      const response = await getResults(task);
      const data = unwrapApiData(response);
      const items = Array.isArray(data.data) ? data.data : (Array.isArray(data.items) ? data.items : []);
      if (items.length === 0) return wroteData;
      const nextCursor = data.next_cursor || '';
      if (!nextCursor || nextCursor === task.cursor) throw new Error('结果接口未返回有效的 next_cursor');

      onWriting?.(items, task);
      await writeBatch(items, task);
      task.cursor = nextCursor;
      task.writtenCount = (task.writtenCount || 0) + items.length;
      task.lastActivityAt = Date.now();
      await save(task);
      wroteData = true;
      if (!data.has_more) return wroteData;
    }
    return wroteData;
  };

  const poll = async (task) => {
    if (activeTask !== task || inFlight) return;
    inFlight = true;
    try {
      const status = unwrapApiData(await getStatus(task));
      const processed = Number(status.processed) || 0;
      const heartbeatAt = Number(status.heartbeat_at) || 0;
      const progressed = processed !== task.lastProcessed || heartbeatAt !== task.lastHeartbeatAt;
      if (progressed) {
        task.lastProcessed = processed;
        task.lastHeartbeatAt = heartbeatAt;
        task.lastActivityAt = Date.now();
        task.pollInterval = ACTIVE_INTERVAL;
      } else {
        task.pollInterval = Math.min(Math.max(task.pollInterval || ACTIVE_INTERVAL, ACTIVE_INTERVAL) * 2, MAX_INTERVAL);
      }

      onProgress?.(status, task, 'collecting');
      const wroteData = await drain(task);
      if (wroteData) {
        task.pollInterval = ACTIVE_INTERVAL;
        onProgress?.(status, task, 'written');
      }

      const terminal = Number(status.status) === 1 || Number(status.status) === 2;
      if (terminal && !wroteData) {
        stop();
        await clear();
        await onFinish?.(status, task);
        return;
      }
      if (Date.now() - (task.lastActivityAt || Date.now()) >= STALL_TIMEOUT) {
        throw new Error('任务超过 10 分钟没有进度更新，请稍后重试');
      }
      await save(task);
      schedule(task, task.pollInterval || ACTIVE_INTERVAL);
    } catch (error) {
      task.pollInterval = Math.min(Math.max(task.pollInterval || ACTIVE_INTERVAL, ACTIVE_INTERVAL) * 2, MAX_INTERVAL);
      if (Date.now() - (task.lastActivityAt || Date.now()) >= STALL_TIMEOUT) {
        stop();
        await onError?.(error, task);
      } else {
        await save(task);
        schedule(task, task.pollInterval);
      }
    } finally {
      inFlight = false;
    }
  };

  const start = async (task) => {
    stop();
    const selection = await bitable.base.getSelection();
    activeTask = {
      cursor: '', writtenCount: 0, lastProcessed: -1, lastHeartbeatAt: 0,
      lastActivityAt: Date.now(), pollInterval: ACTIVE_INTERVAL, baseId: selection.baseId || '', ...task,
    };
    await save(activeTask);
    await poll(activeTask);
  };

  const resume = async (onRestore) => {
    const saved = await bitable.bridge.getData(storageKey);
    if (!saved?.taskId || activeTask) return false;
    const selection = await bitable.base.getSelection();
    if (saved.baseId && selection.baseId && saved.baseId !== selection.baseId) return false;
    activeTask = { ...saved, lastActivityAt: saved.lastActivityAt || Date.now(), pollInterval: saved.pollInterval || ACTIVE_INTERVAL };
    await onRestore?.(activeTask);
    await poll(activeTask);
    return true;
  };

  return { start, resume, stop };
};
