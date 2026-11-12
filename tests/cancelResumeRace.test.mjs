import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from '@vue/compiler-sfc';
import { parse as parseJS } from '@babel/parser';
import { computed, createRenderer, nextTick, ref } from 'vue';
import { useTaskFeedback } from '../src/composables/useTaskFeedback.mjs';

const pages = [
  ['BloggerSearch', 'searchTask', 'cancel', 'resumeSavedTask'],
  ['KeywordSearch', 'keywordStreamTask', 'cancelKeywordTask', 'resumeSavedTask'],
  ['ProfileFetch', 'profileStreamTask', 'cancelProfileTask', 'resumeSavedStreamTask'],
  ['CommentFetch', 'commentStreamTask', 'cancelCommentTask', 'resumeCommentTask'],
  ['SeriesFetch', 'seriesStreamTask', 'cancelSeriesTask', 'resumeSeriesTask'],
];
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const stopTextSource = read('../src/utils/taskStopText.js').replace('export const', 'const');
const getTaskStoppingText = new Function(`${stopTextSource}; return getTaskStoppingText;`)();

// Keep the real page state, callbacks, cancel/resume handlers and task engine.
// Substitute only HTTP, SDK writing/storage and the engine's scheduled clock.
function mountTask(t, [page, engineName, cancelName, resumeName], options = {}) {
  const source = parse(read(`../src/components/${page}.vue`)).descriptor.scriptSetup.content;
  const names = new Set([
    'submitting', 'isSubmitting', 'cancelling', 'isCancelling', 'clearing', 'taskId',
    'activeKeywordTaskId', 'activeProfileTaskId', 'activeCommentTaskId', 'activeSeriesTaskId',
    'hasRecoverableTask', 'requiresReopen', 'recoveryRequiresReopen', 'componentUnmounted',
    'activeStreamTask', 'activeSeriesTask', 'feedback', 'storageKey', 'STREAM_TASK_STORAGE_KEY',
    'TASK_TOAST_SUFFIX', 'STREAM_RESULT_LIMIT', 'listPageSize', 'normalizeCommentId',
    'showToast', 'hideToast', 'showCompletionToast', 'finishToast', 'showErrorMsg',
    'showFieldProgress', 'showProfileFieldProgress', 'getStreamProgressText',
    'getStoppingText', 'stoppedCommentProgress', 'unwrapApiData', 'auth',
    'getProfileTaskStatus', 'readAvailablePosts', 'getSeriesTask', 'getSeriesResults',
    'restoreTask', 'restoreProfileTask', 'restoreSeriesTask', 'taskActionState', 'handleTaskAction', engineName, cancelName, resumeName,
  ]);
  const statements = parseJS(source, { sourceType: 'module' }).program.body
    .filter(node => node.type === 'VariableDeclaration')
    .flatMap(node => node.declarations.filter(decl => names.has(decl.id.name))
      .map(decl => `${node.kind} ${source.slice(decl.start, decl.end)};`)).join('\n');
  let saved = { taskId: 'same-task', baseId: 'base', targetTableId: 'target', cursor: '', writtenCount: 0, ...(options.latestStatus ? { latestStatus: options.latestStatus } : {}) };
  let phase = 'initial', timerId = 0;
  let status = { status: 0, processed: 1, total: 10 };
  const timers = new Map(), stops = [], notices = [];
  const writeStarted = deferred(), writePending = deferred();
  const bitable = {
    base: { getSelection: async () => ({ baseId: 'base' }) },
    bridge: { getData: async () => structuredClone(saved), setData: async (_, value) => { saved = structuredClone(value); } },
  };
  const engineSource = read('../src/composables/useIncrementalTask.js')
    .replace(/^import .*;\n/, '').replace('export const useIncrementalTask', 'const useIncrementalTask');
  const useIncrementalTask = new Function('bitable', 'setTimeout', 'clearTimeout', `${engineSource}; return useIncrementalTask;`)(
    bitable, (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; }, id => timers.delete(id));
  const dependencies = {
    computed, ref, nextTick, useTaskFeedback, useIncrementalTask, getTaskStoppingText,
    loading: ref(false), props: { api_key: 'test-key' }, commentSubmission: { pending: null },
    ElMessage: notice => notices.push(notice), showErrorMsg: message => notices.push({ message }),
    console: { error() {}, log() {} },
    request: async config => {
      if (config.url.endsWith('/cancel')) {
        assert.equal(config.data.task_id, 'same-task');
        const pending = deferred(); stops.push(pending); return pending.promise;
      }
      if (config.method === 'get') {
        if (options.authFailure && config.headers.authorization === 'Bearer test-key') throw Object.assign(new Error('API Key 已失效'), { code: 'INVALID_API_KEY' });
        await options.statusReply?.promise; return { data: { sta: 0, data: { ...status } } };
      }
      return { data: { sta: 0, data: {
        count: phase === 'initial' ? 0 : 1,
        items: phase === 'initial' || config.data.after_id ? [] : [{ cid: 'comment-1', user_id: 'author-1', aweme_id: 'post-1', series_id: 'series-1' }],
        next_cursor: 'cursor-1', has_more: false,
      } } };
    },
    createAndWriteData: async (...args) => {
      await args.at(-1).onBeforeWrite?.();
      if (phase === 'fail') throw new Error('本地写入失败');
      if (phase === 'pending') { writeStarted.resolve(); await writePending.promise; }
      return { tableId: 'target' };
    },
  };
  // Some pages import showErrorMsg; others declare it locally.
  if (statements.includes('const showErrorMsg =')) delete dependencies.showErrorMsg;
  const create = new Function(...Object.keys(dependencies), `${statements}
    if (typeof isSubmitting !== 'undefined') isSubmitting.value = false;
    return { feedback, loading, engine: ${engineName}, cancel: ${cancelName}, resume: ${resumeName}, taskActionState, action: handleTaskAction,
      stopping: typeof cancelling !== 'undefined' ? cancelling : isCancelling, hasRecoverableTask,
      requiresReopen: typeof requiresReopen !== 'undefined' ? requiresReopen : recoveryRequiresReopen };`);
  let state;
  const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} });
  const app = renderer.createApp({ setup() { state = create(...Object.values(dependencies)); return () => null; } });
  app.mount({});
  t.after(() => { state.engine.stop(); app.unmount(); });
  return { state, stops, notices, writeStarted, writePending, timers, bitable, props: dependencies.props, setPhase: value => { phase = value; }, setStatus: value => { status = { ...status, ...value }; },
    poll: async () => {
      const entry = [...timers.entries()].find(([, timer]) => timer.delay === 2000);
      assert.ok(entry, '实际任务引擎必须安排下一次轮询');
      timers.delete(entry[0]); await entry[1].fn();
    } };
}

for (const page of pages) {
  for (const status of [1, 2, 3]) {
    test(`${page[0]}：终态${status}清理等待期间保持忙碌，停止入口不可用`, async t => {
      const gate = deferred();
      const { state: s, bitable, setStatus, stops } = mountTask(t, page);
      setStatus({ status, reason: '任务原始失败原因' });
      const save = bitable.bridge.setData;
      bitable.bridge.setData = async (key, value) => { if (!value.taskId) await gate.promise; return save(key, value); };
      const pending = s.resume();
      for (let i = 0; i < 100; i++) await Promise.resolve();
      try {
        assert.equal(s.taskActionState.value, 'clearing');
        assert.equal(s.loading.value, true);
        assert.match(s.feedback.toastText.value, /正在清理任务进度/);
        await s.action(); await s.cancel();
        assert.equal(stops.length, 0);
      } finally { gate.resolve(); for (const stop of stops) stop.resolve({ data: { sta: 0 } }); await pending; }
      assert.equal(s.taskActionState.value, 'idle');
      assert.equal(s.loading.value, false);
      assert.equal(s.feedback.toastType.value, status === 2 ? 'error' : 'info');
    });
  }

  test(`${page[0]}：已进入清理时旧停止请求失败，不覆盖清理进度`, async t => {
    const gate = deferred();
    const { state: s, bitable, setStatus, stops, notices, poll } = mountTask(t, page);
    await s.resume();
    const stopping = s.cancel();
    setStatus({ status: 1 });
    const save = bitable.bridge.setData;
    bitable.bridge.setData = async (key, value) => { if (!value.taskId) await gate.promise; return save(key, value); };
    const pending = poll();
    for (let i = 0; i < 100; i++) await Promise.resolve();
    try {
      stops[0].reject(new Error('旧停止请求失败')); await stopping;
      assert.equal(s.taskActionState.value, 'clearing');
      assert.match(s.feedback.toastText.value, /正在清理任务进度/);
      assert.doesNotMatch(s.feedback.toastText.value, /任务继续执行/);
      assert.equal(notices.length, 0);
    } finally { gate.resolve(); await pending; }
  });

  test(`${page[0]}：清理等待后失败退出忙碌，同页恢复清理仍能正常收尾`, async t => {
    const gate = deferred();
    const { state: s, bitable, setStatus } = mountTask(t, page);
    setStatus({ status: 1 });
    const save = bitable.bridge.setData; let clears = 0;
    bitable.bridge.setData = async (key, value) => {
      if (!value.taskId && ++clears === 1) { await gate.promise; throw new Error('清理失败'); }
      return save(key, value);
    };
    const pending = s.resume();
    for (let i = 0; i < 100; i++) await Promise.resolve();
    try { assert.equal(s.taskActionState.value, 'clearing'); }
    finally { gate.resolve(); await pending; }
    assert.equal(s.taskActionState.value, 'recoverable');
    assert.equal(s.loading.value, false);
    await s.action();
    assert.equal(s.taskActionState.value, 'idle');
  });

  for (const applied of [false, true]) {
    test(`${page[0]}：终态清理响应失败（已生效=${applied}）同页只重试清理，不卡在缺失进度`, async t => {
      const { state: s, bitable, setStatus } = mountTask(t, page);
      setStatus({ status: 1 });
      let clears = 0;
      const save = bitable.bridge.setData;
      bitable.bridge.setData = async (key, value) => {
        if (!value.taskId && ++clears === 1) {
          if (applied) await save(key, value);
          throw new Error('清理进度响应失败');
        }
        return save(key, value);
      };
      await s.resume();
      assert.equal(s.taskActionState.value, 'recoverable');
      assert.equal(s.requiresReopen.value, false);
      assert.match(s.feedback.taskNotice.value, /清理进度响应失败/);
      // 重试清理时后端不再可用，也不得重新获取或写入终态任务。
      setStatus({ status: 0 });
      await s.action();
      assert.equal(clears, 2);
      assert.deepEqual(await bitable.bridge.getData(), {});
      assert.equal(s.taskActionState.value, 'idle');
      assert.equal(s.hasRecoverableTask.value, false);
      assert.equal(s.feedback.taskNotice.value, '');
      assert.equal(s.loading.value, false);
    });
  }

  test(`${page[0]}：清理失败后切到其他多维表格，不清理也不结束原任务`, async t => {
    const { state: s, bitable, setStatus } = mountTask(t, page);
    setStatus({ status: 1 });
    let clears = 0;
    const save = bitable.bridge.setData;
    bitable.bridge.setData = async (key, value) => {
      if (!value.taskId && ++clears === 1) { await save(key, value); throw new Error('清理响应失败'); }
      return save(key, value);
    };
    await s.resume();
    bitable.base.getSelection = async () => ({ baseId: 'other-base' });
    await s.action();
    assert.equal(clears, 1);
    assert.equal(s.taskActionState.value, 'recoverable');
    bitable.base.getSelection = async () => ({ baseId: 'base' });
    await s.action();
    assert.equal(clears, 2);
    assert.equal(s.taskActionState.value, 'idle');
  });

  test(`${page[0]}：密钥失效立即退出忙碌并提示恢复，更新密钥后恢复原任务`, async t => {
    const { state: s, timers, bitable, props } = mountTask(t, page, { authFailure: true });
    await s.resume();
    assert.equal(s.engine.getActiveTask(), null);
    assert.equal(s.loading.value, false);
    assert.equal(s.stopping.value, false);
    assert.equal(s.taskActionState.value, 'recoverable');
    assert.equal(s.requiresReopen.value, false);
    assert.match(s.feedback.taskNotice.value, /API Key 已失效/);
    assert.doesNotMatch(s.feedback.taskNotice.value, /关闭|重新进入/);
    assert.equal([...timers.values()].filter(timer => timer.delay < 60000).length, 0);
    assert.equal((await bitable.bridge.getData()).taskId, 'same-task');
    props.api_key = 'updated-key';
    await s.action();
    assert.equal(s.engine.getActiveTask().taskId, 'same-task');
    assert.equal(s.taskActionState.value, 'running');
  });

  test(`${page[0]}：只读状态超时显示恢复入口，同页恢复保持原任务身份`, async t => {
    const reply = deferred();
    const { state: s, timers } = mountTask(t, page, { statusReply: reply });
    const pending = s.resume();
    for (let i = 0; i < 100; i++) await Promise.resolve();
    const timer = [...timers.values()].find(timer => timer.delay === 180000);
    assert.ok(timer);
    timer.fn(); await pending;
    assert.equal(s.requiresReopen.value, false);
    assert.equal(s.taskActionState.value, 'recoverable');
    assert.equal(s.loading.value, false);
    assert.match(s.feedback.taskNotice.value, /读取任务进度超时.*恢复任务/);
    assert.doesNotMatch(s.feedback.taskNotice.value, /关闭|重新(?:打开|进入)/);
    reply.resolve();
    for (let i = 0; i < 30; i++) await Promise.resolve();
    assert.equal(s.engine.getActiveTask(), null);
    await s.action();
    assert.equal(s.engine.getActiveTask().taskId, 'same-task');
    assert.equal(s.taskActionState.value, 'running');
  });

  for (const reason of ['missing', 'different-base']) {
    test(`${page[0]}：恢复进度${reason}时提示核对而非重开，并允许同页重试`, async t => {
      const { state: s, bitable } = mountTask(t, page);
      const getData = bitable.bridge.getData, getSelection = bitable.base.getSelection;
      const saved = await getData();
      if (reason === 'missing') bitable.bridge.getData = async () => ({});
      else bitable.base.getSelection = async () => ({ baseId: 'other' });
      s.hasRecoverableTask.value = true;
      await s.resume();
      assert.equal(s.taskActionState.value, 'recoverable');
      assert.equal(s.requiresReopen.value, false);
      assert.match(s.feedback.taskNotice.value, /核对.*表格.*已写入结果.*重试/);
      assert.doesNotMatch(s.feedback.taskNotice.value, /关闭|重新(?:打开|进入)/);
      assert.deepEqual(await getData(), saved);
      bitable.bridge.getData = getData; bitable.base.getSelection = getSelection;
      await s.action();
      assert.equal(s.engine.getActiveTask().taskId, 'same-task');
      assert.equal(s.taskActionState.value, 'running');
    });
  }

  for (const confirmed of [
    { label: 'status=3', status: 3 },
    { label: 'cancel_requested', status: 0, cancel_requested: true },
    { label: 'status_text', status: 0, status_text: 'cancel_requested' },
  ]) {
    test(`${page[0]}：轮询确认${confirmed.label}→写入未完成→停止请求失败仍保持停止收尾`, async t => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const { state: s, stops, notices, writeStarted, writePending, setPhase, setStatus, poll } = mountTask(t, page);
      await s.resume();
      const active = s.engine.getActiveTask();
      const stopping = s.cancel();
      setStatus(confirmed); setPhase('pending');
      const writing = poll(); await writeStarted.promise;
      try {
        assert.equal(s.stopping.value, true);
        assert.equal(s.taskActionState.value, 'stopping');
        stops[0].reject(new Error('迟到的停止请求失败')); await stopping;
        assert.equal(s.engine.getActiveTask(), active);
        assert.equal(s.stopping.value, true, '迟到的停止错误不得撤销已确认的停止状态');
        assert.equal(s.taskActionState.value, 'stopping');
        assert.equal(s.loading.value, true);
        assert.equal(s.feedback.toastType.value, 'loading');
        assert.match(s.feedback.toastText.value, confirmed.status === 3 ? /获取数据已停止，剩余 1 条待写入/ : /正在停止获取数据/);
        assert.match(s.feedback.toastText.value, /请勿关闭插件，关闭会中断数据写入/);
        assert.doesNotMatch(s.feedback.toastText.value, /任务继续执行/);
        assert.equal(notices.length, 1);
        assert.equal(notices[0].message, '迟到的停止请求失败');
        await s.action();
        assert.equal(stops.length, 1, '停止收尾期间不得再次发起停止请求');
        t.mock.timers.tick(5000);
        assert.equal(s.feedback.toastVisible.value, true);
        assert.equal(s.stopping.value, true);
      } finally {
        for (const pending of stops) pending.resolve({ data: { sta: 0 } });
        await stopping; writePending.resolve(); await writing;
      }
      assert.equal(active.writtenCount, 1);
      assert.equal(s.loading.value, true, '写入后仍需等待真实终态收尾');
      setStatus({ status: 3 }); await poll();
      assert.equal(s.loading.value, false);
      assert.equal(s.stopping.value, false);
      assert.equal(s.feedback.toastType.value, 'info');
      assert.match(s.feedback.toastText.value, /任务已停止，已写入 1 条/);
      assert.doesNotMatch(s.feedback.toastText.value, /请勿关闭插件/);
    });
  }

  test(`${page[0]}：停止失败只报告操作错误，SDK写入未结束时保持执行进度`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { state: s, stops, notices, writeStarted, writePending, setPhase, poll } = mountTask(t, page);
    await s.resume();
    const active = s.engine.getActiveTask();
    setPhase('pending');
    const writing = poll();
    await writeStarted.promise;
    try {
      const stopping = s.cancel();
      stops[0].reject(new Error('停止请求连接失败')); await stopping;
      assert.equal(s.loading.value, true);
      assert.equal(s.stopping.value, false);
      assert.equal(s.engine.getActiveTask(), active);
      assert.equal(s.feedback.toastType.value, 'loading');
      assert.match(s.feedback.toastText.value, /任务继续执行/);
      assert.doesNotMatch(s.feedback.toastText.value, /正在停止/);
      assert.match(s.feedback.toastText.value, /请勿关闭插件/);
      assert.equal(notices.length, 1);
      assert.equal(notices[0].message, '停止请求连接失败');
      t.mock.timers.tick(5000);
      assert.equal(s.feedback.toastVisible.value, true);
      assert.equal(s.feedback.toastLoading.value, true);
      assert.equal(active.writtenCount, 0);
    } finally {
      writePending.resolve(); await writing;
    }
    assert.equal(active.writtenCount, 1, '停止请求失败不得中断或重发在途写入');
    assert.equal(notices.length, 1);
  });

  test(`${page[0]}：暂停→恢复同一任务→再次停止→旧请求失败不覆盖当前执行`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { state: s, stops, notices, setPhase, poll } = mountTask(t, page);
    await s.resume();
    const before = s.engine.getActiveTask();
    const oldStop = s.cancel();
    assert.equal(stops.length, 1);
    let currentStop;
    try {
      setPhase('fail'); await poll();
      assert.equal(s.engine.getActiveTask(), null);
      assert.equal(s.hasRecoverableTask.value, true);
      assert.equal(s.requiresReopen.value, false);
      assert.equal(s.loading.value, false);
      assert.match(s.feedback.taskNotice.value, /本地写入失败/);

      setPhase('recover'); await s.resume();
      const restored = s.engine.getActiveTask();
      assert.notEqual(restored, before, '真实恢复必须创建新的执行对象');
      assert.equal(restored.taskId, 'same-task');
      assert.equal(restored.writtenCount, 1);
      currentStop = s.cancel();
      assert.equal(stops.length, 2);
      stops[0].reject(new Error('恢复前的停止请求失败')); await oldStop;
      assert.equal(s.stopping.value, true, '旧请求不得清除恢复后的停止状态');
      assert.equal(s.loading.value, true);
      assert.equal(s.feedback.toastType.value, 'loading');
      assert.match(s.feedback.toastText.value, /已写入 1 条/);
      assert.match(s.feedback.toastText.value, /请勿关闭插件，关闭会中断数据写入/);
      assert.deepEqual(notices, []);
      t.mock.timers.tick(5000);
      assert.equal(s.feedback.toastVisible.value, true, '旧错误不得安排隐藏当前提示');

      stops[1].reject(new Error('恢复后的停止请求失败')); await currentStop;
      assert.equal(s.stopping.value, false, '当前执行的停止失败仍必须报告');
      assert.equal(notices.length, 1);
      assert.equal(notices[0].message, '恢复后的停止请求失败');
      assert.equal(s.feedback.toastType.value, 'loading');
    } finally {
      for (const pending of stops) pending.resolve({ data: { sta: 0 } });
      await oldStop; await currentStop;
    }
  });
}


for (const page of pages) {
  for (const confirmed of [{ status: 3 }, { status: 0, cancel_requested: true }, { status: 0, status_text: 'cancel_requested' }]) {
    test(`${page[0]}：缓存停止标记${JSON.stringify(confirmed)}，恢复首轮查询等待保持停止收尾`, async t => {
      const statusReply = deferred();
      const { state: s, stops } = mountTask(t, page, { latestStatus: confirmed, statusReply });
      const restoring = s.resume();
      try {
        await new Promise(setImmediate);
        assert.equal(s.loading.value, true);
        assert.equal(s.taskActionState.value, 'stopping');
        assert.equal(s.stopping.value, true);
        assert.match(s.feedback.toastText.value, confirmed.status === 3 ? /获取数据已停止/ : /正在停止获取数据/);
        assert.match(s.feedback.toastText.value, /请勿关闭插件，关闭会中断数据写入/);
        await s.action(); await s.cancel();
        assert.equal(stops.length, 0);
      } finally {
        for (const pending of stops) pending.resolve({ data: { sta: 0 } });
        statusReply.resolve(); await restoring;
      }
    });
  }
}
