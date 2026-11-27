import { bitable } from '@lark-base-open/js-sdk';

const ACTIVE_INTERVAL = 2000;
const MAX_INTERVAL = 30000;
// SDK 清理不会随页面卸载或超时取消；同一存储键的其他实例也必须等待它结束。
const pendingClears = new Map();
const pendingMutations = new Map();
const submissions = new Map();

const unwrapApiData = (responseData) => {
  if (responseData?.sta !== undefined) {
    if (responseData.sta !== 0) {
      throw Object.assign(new Error(responseData.msg || '请求失败'), { apiStatus: Number(responseData.sta) });
    }
    return responseData.data || {};
  }
  return responseData || {};
};

const isTaskNotFound = error => error?.apiStatus === -1 && error.message === '任务不存在';
const isSameTask = (saved, expected) => saved?.taskId === expected.taskId
  && saved.baseId === expected.baseId && saved.targetTableId === expected.targetTableId
  && (saved.retryGeneration ?? 0) === (expected.retryGeneration ?? 0);

export const useIncrementalTask = ({
  storageKey, getStatus, getResults, writeBatch,
  operationTimeoutMs = 0, stallTimeoutMinutes = 10, shouldRetryStalledStatusRead,
  onProgress, onWriting, onFinish, onError, isTerminal, requestStop,
}) => {
  const stallTimeoutMs = stallTimeoutMinutes * 60 * 1000;
  const hasFinished = isTerminal || (status => [1, 2].includes(Number(status.status)));
  let activeTask = null;
  let timer = null;
  let inFlightTask = null;
  let lifecycleVersion = 0;
  let finishingTask = null;

  const bounded = async (operation, label, { readOnly = false, retryable = false } = {}) => {
    if (!operationTimeoutMs) return operation();
    let timeout;
    try {
      return await Promise.race([operation(), new Promise((_, reject) => {
        timeout = setTimeout(() => {
          const error = new Error(readOnly
            ? `${label}超时，请稍后恢复任务`
            : `${label}超时，请关闭当前插件后重新打开并核对写入结果，勿重复启动任务`);
          error.stopPolling = !retryable;
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
  const save = async (task, { initial = false } = {}) => {
    assertNoPendingClear();
    const version = lifecycleVersion;
    const owner = activeTask;
    const snapshot = JSON.parse(JSON.stringify(task));
    // 逐项明细由终态查询返回，恢复写入只需要状态、计数和游标。
    if (snapshot.latestStatus) {
      delete snapshot.latestStatus.failed_items;
      delete snapshot.latestStatus.invalid_items;
    }
    let saving = true;
    const persistSnapshot = async () => {
      if (!initial) {
        await assertTaskNotEnded(snapshot);
        if (!saving || version !== lifecycleVersion || activeTask !== owner) return;
      }
      // 只有发起新任务才发布初始快照，后续进度由任务自己保存。
      return bitable.bridge.setData(initial ? storageKey : taskProgressKey(snapshot), snapshot);
    };
    try {
      return await bounded(() => trackMutation(async () => {
        try {
          return await persistSnapshot();
        } catch (error) {
          // 只补存已识别的宿主存储错误；超时或未知错误仍按原保护暂停。
          const invalidAuth = error.code === 'INVALID_API_KEY' || [400, 401, 403].includes(error.response?.status);
          if (error.message !== 'set data error, msg: set block entity error' || invalidAuth || error.stopPolling || error.requiresReopen
            || !saving || version !== lifecycleVersion || activeTask !== owner) throw error;
          await new Promise(resolve => setTimeout(resolve, 1000));
          if (!saving || version !== lifecycleVersion || activeTask !== owner) throw error;
          assertNoPendingClear();
          return await persistSnapshot();
        }
      }), '保存写入进度');
    } catch (error) {
      // 保存自身已经决定是否重试，外层不能再次补存或自动重发批次。
      if (!error.stopPolling && !error.requiresReopen) {
        const saveError = new Error(`保存任务进度失败：${error.message || '未知错误'}。已暂停，已写入的数据会保留，请点击「恢复任务」继续。`, { cause: error });
        saveError.stopPolling = true;
        throw saveError;
      }
      error.stopPolling = true;
      throw error;
    } finally {
      saving = false;
    }
  };
  const clear = async task => {
    assertNoPendingClear();
    const pendingError = new Error('上次清理任务进度尚未结束，请稍后重新进入页面，或关闭插件后重新打开');
    pendingError.stopPolling = true;
    pendingError.requiresReopen = true;
    pendingError.pendingClear = true;
    pendingClears.set(storageKey, pendingError);
    try {
      await bounded(async () => {
        try {
          await assertTaskNotEnded(task);
          if (activeTask === task) {
            // 另一窗口已发出的旧进度保存可能更晚生效，完成状态必须独立保存。
            await bitable.bridge.setData(taskFinishedKey(task), { finished: true });
            await bitable.bridge.setData(taskProgressKey(task), { finished: true });
          }
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
  const schedule = (task, delay, retryingStatusRead = false) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => poll(task, retryingStatusRead), delay);
  };

  const checkTargetExists = task => bounded(async () => bitable.base.isTableExist(task.targetTableId), '核对原输出表', { readOnly: true });
  const taskProgressKey = task => `${storageKey}:progress:${[task.baseId || '', task.taskId, task.retryGeneration ?? 0].map(encodeURIComponent).join(':')}`;
  const taskFinishedKey = task => `${taskProgressKey(task)}:finished`;
  const wasFinished = async task => (await bounded(() => bitable.bridge.getData(taskFinishedKey(task)), '读取任务完成状态', { readOnly: true }))?.finished === true;
  const readSavedTask = async isCurrent => {
    const read = key => bounded(() => bitable.bridge.getData(key), '读取恢复进度', { readOnly: true });
    const initial = await read(storageKey);
    if (!isCurrent() || !initial?.taskId) return initial;
    const key = taskProgressKey(initial);
    const progress = await read(key);
    if (progress?.finished === true || await wasFinished(initial)) return {};
    // 首次读取旧版快照时，还没有按任务保存的进度。
    return progress?.taskId && taskProgressKey(progress) === key ? progress : initial;
  };
  const endedTaskKey = task => `${storageKey}:ended:${[task.baseId, task.targetTableId, task.taskId, task.retryGeneration ?? 0].map(encodeURIComponent).join(':')}`;
  const wasEnded = async task => !!(task.baseId && task.targetTableId
    && await bounded(() => bitable.bridge.getData(endedTaskKey(task)), '读取任务结束状态', { readOnly: true }) === true);
  const assertTaskNotEnded = async (task, checkFinished = false) => {
    if (await wasEnded(task) || (checkFinished && await wasFinished(task))) {
      throw Object.assign(new Error('本次任务已在其他窗口结束，请重新进入插件'), {
        taskEnded: true, stopPolling: true, requiresReopen: true,
      });
    }
  };
  const missingTargetError = (task, cause, taskMissing = false) => {
    const message = taskMissing
      ? '原输出表已删除。当前授权查不到原任务，无法确认后台是否已停止。结束只会清除恢复进度。'
      : '原输出表已删除。结束本次任务后可重新执行，未写入的结果将无法继续写入。';
    const error = new Error(message, { cause });
    error.stopPolling = true;
    error.endMissingTarget = Object.assign(() => endSavedTask(task, taskMissing), { notice: message });
    return error;
  };

  const drain = async (task) => {
    let wroteData = false;
    while (activeTask === task) {
      const response = await bounded(() => getResults(task), '读取获取结果', { readOnly: true, retryable: true });
      if (activeTask !== task) return wroteData;
      const data = unwrapApiData(response);
      if (Number(task.latestStatus?.status) === 3 && Number.isSafeInteger(data.count) && data.count >= 0) task.resultCount = data.count;
      else delete task.resultCount;
      const items = Array.isArray(data.data) ? data.data : (Array.isArray(data.items) ? data.items : []);
      if (items.length === 0) return wroteData;
      const nextCursor = data.next_cursor || '';
      if (!nextCursor || nextCursor === task.cursor) throw new Error('结果接口未返回有效的 next_cursor');

      await assertTaskNotEnded(task, true);
      if (activeTask !== task) return wroteData;
      onWriting?.(items, task);
      let writeActive = true;
      const assertActive = () => {
        if (!writeActive || activeTask !== task) {
          const error = new Error('写入操作已结束，请核对结果后恢复任务');
          error.stopPolling = true;
          throw error;
        }
      };
      const assertCanWrite = async () => {
        assertActive();
        await assertTaskNotEnded(task, true);
        assertActive();
      };
      try {
        await bounded(() => trackMutation(() => writeBatch(items, task, {
          assertActive, assertCanWrite,
          saveProgress: async () => {
            assertActive();
            await save(task);
            await assertCanWrite();
          },
        })), '写入表格');
      } catch (error) {
        const cause = error?.cause?.cause ?? error?.cause ?? error;
        if (requestStop && task.targetTableId && !error?.requiresReopen &&
          (cause?.message === 'table not found error' || cause?.code === 10212998)) {
          // SDK OpenErrorCode.TableNotFoundError 也可能出现在刚建表尚未就绪时。
          const exists = await checkTargetExists(task).catch(() => undefined);
          if (activeTask !== task) return wroteData;
          if (exists === false) throw missingTargetError(task, error);
        }
        if (error?.stopPolling) throw error;
        // SDK 报错时写入结果可能未知，不能自动重发同一批数据。
        const writeError = new Error(`${error?.message || '写入表格失败'}；已暂停写入，已写入的数据会保留，请点击「恢复任务」继续。`, { cause: error });
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
    await clear(task);
    if (activeTask !== task) return;
    finishingTask = null;
    stop();
    await onFinish?.(task.latestStatus, task);
  };

  const poll = async (task, retryingStatusRead = false) => {
    if (activeTask !== task || inFlightTask === task) return;
    inFlightTask = task;
    let readingStatus = false;
    try {
      if (finishingTask === task) {
        await finishTask(task);
        return;
      }
      readingStatus = true;
      const status = unwrapApiData(await bounded(() => getStatus(task), '读取任务进度', { readOnly: true }));
      readingStatus = false;
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

      if (hasFinished(status) && !wroteData) {
        await finishTask(task);
        return;
      }
      if (Date.now() - (task.lastActivityAt || Date.now()) >= stallTimeoutMs) {
        throw new Error(`任务超过 ${stallTimeoutMinutes} 分钟没有进度更新，请稍后重试`);
      }
      await save(task);
      schedule(task, task.pollInterval || ACTIVE_INTERVAL);
    } catch (error) {
      if (activeTask !== task) return;
      if (error.taskEnded) finishingTask = null;
      task.pollInterval = Math.min(Math.max(task.pollInterval || ACTIVE_INTERVAL, ACTIVE_INTERVAL) * 2, MAX_INTERVAL);
      const invalidAuth = error.code === 'INVALID_API_KEY' || [401, 403].includes(error.response?.status);
      const taskMissing = isTaskNotFound(error);
      if (requestStop && task.targetTableId && !invalidAuth && (taskMissing || error.checkMissingOutputTable)) {
        const exists = await checkTargetExists(task).catch(() => undefined);
        if (activeTask !== task) return;
        if (exists === false) error = missingTargetError(task, error, taskMissing);
      }
      const stalled = Date.now() - (task.lastActivityAt || Date.now()) >= stallTimeoutMs;
      const canRetryStatus = stalled && readingStatus && !retryingStatusRead && shouldRetryStalledStatusRead?.(error);
      if (error.stopPolling || invalidAuth || (stalled && !canRetryStatus)) {
        stop();
        await onError?.(error, task);
      } else {
        try {
          await save(task);
          if (activeTask === task) schedule(task, task.pollInterval, readingStatus);
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
    }, { initial: true });
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
      await save(taskToStart, { initial: true });
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

  const resume = async (onRestore, expected) => {
    const version = lifecycleVersion;
    try {
      const entry = submissions.get(storageKey);
      if (expected && entry) throw new Error('任务进度已变化，请重新进入插件');
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
      if (expected && await wasEnded(expected)) return false;
      if (version !== lifecycleVersion || activeTask) return false;
      const expectedSelection = expected ? await bounded(() => bitable.base.getSelection(), '读取当前表格', { readOnly: true }) : null;
      if (version !== lifecycleVersion || activeTask) return false;
      const saved = await readSavedTask(() => version === lifecycleVersion && !activeTask);
      if (version !== lifecycleVersion || activeTask) return false;
      if (expected && (submissions.has(storageKey) || !isSameTask(saved, expected))) {
        throw new Error('任务进度已变化，请重新进入插件');
      }
      const pendingFinish = finishingTask && (!saved?.taskId || saved.taskId === finishingTask.taskId) ? finishingTask : null;
      const taskData = pendingFinish || saved;
      if (!taskData?.taskId) return false;
      if (!expected && await wasEnded(taskData)) return false;
      if (version !== lifecycleVersion || activeTask) return false;
      const selection = expected ? expectedSelection : await bounded(() => bitable.base.getSelection(), '读取当前表格', { readOnly: true });
      if (version !== lifecycleVersion || activeTask) return false;
      if (taskData.baseId && (expected || selection.baseId) && taskData.baseId !== selection.baseId) return false;
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

  const endSavedTask = async (expected, allowMissingTask) => {
    const version = lifecycleVersion;
    const assertCanEndSavedTask = () => {
      assertNoPendingMutation();
      if (activeTask || submissions.has(storageKey)) throw new Error('任务进度已变化，请重新进入插件');
    };
    const readOwnedTask = async () => {
      const saved = await readSavedTask(() => version === lifecycleVersion);
      if (version !== lifecycleVersion) return null;
      assertCanEndSavedTask();
      if (saved?.taskId && !isSameTask(saved, expected)) {
        throw new Error('任务进度已变化，请重新进入插件');
      }
      return saved?.taskId ? saved : {};
    };

    const selection = await bounded(() => bitable.base.getSelection(), '读取当前表格', { readOnly: true });
    if (version !== lifecycleVersion) return false;
    if (!expected.baseId || selection.baseId !== expected.baseId) throw new Error('请回到原多维表格后结束任务');
    const task = await readOwnedTask();
    if (!task?.taskId) return !!task;
    if (await wasEnded(task)) return version === lifecycleVersion;
    if (version !== lifecycleVersion) return false;

    const continueIfRestored = () => version === lifecycleVersion ? { restoredTask: task } : false;
    const canEnd = async () => {
      const exists = await checkTargetExists(task);
      if (version !== lifecycleVersion || exists === true) return false;
      if (exists !== false) throw new Error('无法确认原输出表已删除，请稍后重试');
      return true;
    };
    if (!await canEnd()) return continueIfRestored();

    const recheckBeforeEnding = async () => {
      // 原表可能在进度读取期间恢复，进度也可能在查表期间被替换。
      const saved = await readOwnedTask();
      if (!saved?.taskId) return { result: !!saved };
      if (!await canEnd()) return { result: continueIfRestored() };
      const current = await readOwnedTask();
      if (!current?.taskId) return { result: !!current };
      // 最后一次进度读取也可能等待宿主响应。
      if (!await canEnd()) return { result: continueIfRestored() };
      assertCanEndSavedTask();
      return { current };
    };

    let status, statusError, stopError, waitingForStop = false;
    try {
      status = unwrapApiData(await bounded(() => getStatus(task), '读取任务进度', { readOnly: true }));
    } catch (error) {
      statusError = error;
    }
    if (version !== lifecycleVersion) return false;
    if (status && !hasFinished(status)) {
      const { current, result } = await recheckBeforeEnding();
      if (version !== lifecycleVersion) return false;
      if (!current) return result;
      if (status.status !== 0 && status.status !== '0') throw new Error('暂未确认任务已结束，请稍后重试');
      // 上一次说明只清理进度，当前已能查到运行中的任务，先重新说明结束操作。
      if (allowMissingTask) throw missingTargetError(task);
      if (status.cancel_requested || status.status_text === 'cancel_requested') {
        throw new Error('任务正在停止，请稍后再点击「结束本次任务」');
      }
      try {
        const afterStop = await bounded(() => requestStop(current), '停止任务', { readOnly: true });
        waitingForStop = !hasFinished(afterStop || {});
      } catch (error) {
        stopError = error;
      }
      if (version !== lifecycleVersion) return false;
    }

    const { current, result } = await recheckBeforeEnding();
    if (version !== lifecycleVersion) return false;
    if (!current) return result;
    if (stopError) throw stopError;
    if (statusError) {
      if (!isTaskNotFound(statusError)) throw statusError;
      if (!allowMissingTask) throw missingTargetError(task, statusError, true);
    }
    if (waitingForStop) throw new Error('任务正在停止，请稍后再点击「结束本次任务」');
    // 单独记录旧任务，结束操作不能清空其他窗口刚保存的恢复进度。
    if (await bounded(() => bitable.bridge.setData(endedTaskKey(current), true), '保存任务结束状态') === false) {
      throw new Error('保存任务结束状态失败，请重试');
    }
    return version === lifecycleVersion;
  };

  return { start, submit, resume, stop, saveForResume, getActiveTask: () => activeTask };
};
