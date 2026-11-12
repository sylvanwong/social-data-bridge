import { bitable } from '@lark-base-open/js-sdk';

const ACTIVE_INTERVAL = 2000;
const MAX_INTERVAL = 30000;
const STALL_TIMEOUT = 10 * 60 * 1000;
// SDK 清理不会随页面卸载或超时取消；同一存储键的其他实例也必须等待它结束。
const pendingClears = new Map();
const pendingMutations = new Map();
const submissions = new Map();

const unwrapApiData = (responseData) => {
  if (responseData?.sta !== undefined) {
    if (responseData.sta !== 0) throw new Error(responseData.msg || '请求失败');
    return responseData.data || {};
  }
  return responseData || {};
};

export const useIncrementalTask = ({ storageKey, getStatus, getResults, writeBatch, operationTimeoutMs = 0, onProgress, onWriting, onFinish, onError, isTerminal }) => {
  let activeTask = null;
  let timer = null;
  let inFlightTask = null;
  let lifecycleVersion = 0;
  let finishingTask = null;

  const bounded = async (operation, label, { readOnly = false } = {}) => {
    if (!operationTimeoutMs) return operation();
    let timeout;
    try {
      return await Promise.race([operation(), new Promise((_, reject) => {
        timeout = setTimeout(() => {
          const error = new Error(readOnly
            ? `${label}超时，请稍后恢复任务`
            : `${label}超时，请关闭当前插件后重新打开并核对写入结果，勿重复启动任务`);
          error.stopPolling = true;
          error.requiresReopen = !readOnly;
          reject(error);
        }, operationTimeoutMs);
      })]);
    } finally {
      clearTimeout(timeout);
    }
  };
  const assertNoPendingClear = () => {
    const error = pendingClears.get(storageKey);
    if (error) throw error;
  };
  const assertNoPendingMutation = () => {
    assertNoPendingClear();
    if (pendingMutations.get(storageKey)?.size) {
      const error = new Error('上次写入或保存尚未结束，请稍后重新进入页面，或关闭插件后重新打开');
      error.stopPolling = true;
      error.requiresReopen = true;
      error.pendingMutation = true;
      throw error;
    }
  };
  const trackMutation = async (operation) => {
    const pending = pendingMutations.get(storageKey) || new Set();
    const token = {};
    pending.add(token);
    pendingMutations.set(storageKey, pending);
    try { return await operation(); }
    finally {
      pending.delete(token);
      if (!pending.size) pendingMutations.delete(storageKey);
    }
  };
  const save = async (task) => {
    assertNoPendingClear();
    return bounded(() => trackMutation(() => bitable.bridge.setData(storageKey, task)), '保存写入进度');
  };
  const clear = async () => {
    assertNoPendingClear();
    const pendingError = new Error('上次清理任务进度尚未结束，请稍后重新进入页面，或关闭插件后重新打开');
    pendingError.stopPolling = true;
    pendingError.requiresReopen = true;
    pendingError.pendingClear = true;
    pendingClears.set(storageKey, pendingError);
    try {
      await bounded(async () => {
        try {
          await bitable.bridge.setData(storageKey, {});
        } finally {
          pendingClears.delete(storageKey);
        }
      }, '清除任务进度');
    } catch (error) {
      error.stopPolling = true;
      throw error;
    }
  };
  const stop = () => {
    lifecycleVersion++;
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
      const response = await bounded(() => getResults(task), '读取获取结果', { readOnly: true });
      if (activeTask !== task) return wroteData;
      const data = unwrapApiData(response);
      if (Number(task.latestStatus?.status) === 3 && Number.isSafeInteger(data.count) && data.count >= 0) task.resultCount = data.count;
      else delete task.resultCount;
      const items = Array.isArray(data.data) ? data.data : (Array.isArray(data.items) ? data.items : []);
      if (items.length === 0) return wroteData;
      const nextCursor = data.next_cursor || '';
      if (!nextCursor || nextCursor === task.cursor) throw new Error('结果接口未返回有效的 next_cursor');

      onWriting?.(items, task);
      let writeActive = true;
      const assertActive = () => {
        if (!writeActive || activeTask !== task) {
          const error = new Error('写入操作已结束，请核对结果后恢复任务');
          error.stopPolling = true;
          throw error;
        }
      };
      try {
        await bounded(() => trackMutation(() => writeBatch(items, task, {
          assertActive,
          saveProgress: async () => { assertActive(); await save(task); assertActive(); },
        })), '写入表格');
      } catch (error) {
        if (error?.stopPolling) throw error;
        // SDK 报错时写入结果可能未知，不能自动重发同一批数据。
        const writeError = new Error(`${error?.message || '写入表格失败'}；已暂停写入，请核对表格结果后再恢复任务`);
        writeError.stopPolling = true;
        throw writeError;
      } finally {
        writeActive = false;
      }
      if (activeTask !== task) return wroteData;
      task.cursor = nextCursor;
      task.writtenCount = (task.writtenCount || 0) + items.length;
      task.lastActivityAt = Date.now();
      await save(task);
      if (activeTask !== task) return wroteData;
      wroteData = true;
      if (!data.has_more) return wroteData;
    }
    return wroteData;
  };

  const finishTask = async (task) => {
    // 已确认终态且结果排空；清理响应失败后只重试清理，不重新获取或写入。
    finishingTask = task;
    onProgress?.(task.latestStatus, task, 'clearing');
    await clear();
    if (activeTask !== task) return;
    finishingTask = null;
    stop();
    await onFinish?.(task.latestStatus, task);
  };

  const poll = async (task) => {
    if (activeTask !== task || inFlightTask === task) return;
    inFlightTask = task;
    try {
      if (finishingTask === task) {
        await finishTask(task);
        return;
      }
      const status = unwrapApiData(await bounded(() => getStatus(task), '读取任务进度', { readOnly: true }));
      if (activeTask !== task) return;
      if (Number(task.latestStatus?.status) !== 3 || Number(status.status) !== 3) delete task.resultCount;
      task.latestStatus = status;
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
      if (activeTask !== task) return;
      if (wroteData) {
        task.pollInterval = ACTIVE_INTERVAL;
        onProgress?.(status, task, 'written');
      }

      const terminal = isTerminal
        ? isTerminal(status)
        : Number(status.status) === 1 || Number(status.status) === 2;
      if (terminal && !wroteData) {
        await finishTask(task);
        return;
      }
      if (Date.now() - (task.lastActivityAt || Date.now()) >= STALL_TIMEOUT) {
        throw new Error('任务超过 10 分钟没有进度更新，请稍后重试');
      }
      await save(task);
      schedule(task, task.pollInterval || ACTIVE_INTERVAL);
    } catch (error) {
      if (activeTask !== task) return;
      task.pollInterval = Math.min(Math.max(task.pollInterval || ACTIVE_INTERVAL, ACTIVE_INTERVAL) * 2, MAX_INTERVAL);
      const invalidAuth = error.code === 'INVALID_API_KEY' || [401, 403].includes(error.response?.status);
      if (error.stopPolling || invalidAuth || Date.now() - (task.lastActivityAt || Date.now()) >= STALL_TIMEOUT) {
        stop();
        await onError?.(error, task);
      } else {
        try {
          await save(task);
          if (activeTask === task) schedule(task, task.pollInterval);
        } catch (saveError) {
          if (activeTask === task) {
            stop();
            await onError?.(saveError, task);
          }
        }
      }
    } finally {
      if (inFlightTask === task) inFlightTask = null;
    }
  };

  // 提交成功后先保留恢复入口；页面是否仍在运行不影响这一步。
  const saveForResume = async (task) => {
    assertNoPendingMutation();
    const selection = await bounded(() => bitable.base.getSelection(), '读取当前表格', { readOnly: true });
    assertNoPendingMutation();
    await save({
      cursor: '', writtenCount: 0, lastProcessed: -1, lastHeartbeatAt: 0,
      lastActivityAt: Date.now(), pollInterval: ACTIVE_INTERVAL, baseId: selection.baseId || '', ...task,
    });
  };

  const start = async (task) => {
    stop();
    const version = lifecycleVersion;
    let taskToStart;
    try {
      assertNoPendingMutation();
      const selection = await bounded(() => bitable.base.getSelection(), '读取当前表格', { readOnly: true });
      if (version !== lifecycleVersion) return;
      assertNoPendingMutation();
      activeTask = {
        cursor: '', writtenCount: 0, lastProcessed: -1, lastHeartbeatAt: 0,
        lastActivityAt: Date.now(), pollInterval: ACTIVE_INTERVAL, baseId: selection.baseId || '', ...task,
      };
      taskToStart = activeTask;
      finishingTask = null;
      await save(taskToStart);
      await poll(taskToStart);
    } catch (error) {
      if (version === lifecycleVersion) {
        stop();
        await onError?.(error, taskToStart || task);
      }
    }
  };

  // 保存创建成功的身份与页面执行分开；新实例先等待或补存，不再创建任务。
  const submit = async (createTask, onRestore) => {
    const version = lifecycleVersion;
    const entry = { task: null, promise: null };
    try {
      assertNoPendingMutation();
      if (submissions.has(storageKey)) throw new Error('上次提交尚未处理，请先恢复任务');
      entry.promise = (async () => {
        entry.task = await createTask();
        if (!entry.task?.taskId) throw new Error('创建任务未返回任务 ID');
        try { await saveForResume(entry.task); }
        catch (error) { error.taskCreated = true; throw error; }
      })();
      submissions.set(storageKey, entry);
      await entry.promise;
      if (submissions.get(storageKey) === entry) submissions.delete(storageKey);
      if (version === lifecycleVersion) await resume(onRestore);
    } catch (error) {
      if (!entry.task?.taskId && submissions.get(storageKey) === entry) submissions.delete(storageKey);
      if (version === lifecycleVersion) {
        stop();
        await onError?.(error, entry.task);
      }
    }
  };

  const resume = async (onRestore) => {
    const version = lifecycleVersion;
    try {
      const entry = submissions.get(storageKey);
      if (entry) {
        try { await entry.promise; }
        catch (error) {
          if (entry.task?.taskId) {
            if (error.requiresReopen) throw error;
            entry.promise = saveForResume(entry.task).catch(error => { error.taskCreated = true; throw error; });
            await entry.promise;
          }
        }
        if (submissions.get(storageKey) === entry) submissions.delete(storageKey);
      }
      if (version !== lifecycleVersion) return false;
      assertNoPendingMutation();
      const saved = await bounded(() => bitable.bridge.getData(storageKey), '读取恢复进度', { readOnly: true });
      if (version !== lifecycleVersion || activeTask) return false;
      const pendingFinish = finishingTask && (!saved?.taskId || saved.taskId === finishingTask.taskId) ? finishingTask : null;
      const taskData = pendingFinish || saved;
      if (!taskData?.taskId) return false;
      const selection = await bounded(() => bitable.base.getSelection(), '读取当前表格', { readOnly: true });
      if (version !== lifecycleVersion || activeTask) return false;
      if (taskData.baseId && selection.baseId && taskData.baseId !== selection.baseId) return false;
      assertNoPendingMutation();
      const taskToResume = { ...taskData, lastActivityAt: taskData.lastActivityAt || Date.now(), pollInterval: taskData.pollInterval || ACTIVE_INTERVAL };
      activeTask = taskToResume;
      finishingTask = pendingFinish ? taskToResume : null;
      await onRestore?.(taskToResume);
      if (version !== lifecycleVersion || activeTask !== taskToResume) return false;
      await poll(taskToResume);
      return true;
    } catch (error) {
      if (version !== lifecycleVersion) return false;
      throw error;
    }
  };

  return { start, submit, resume, stop, saveForResume, getActiveTask: () => activeTask };
};
