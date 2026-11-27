import { useTaskExecutionResult } from '../src/composables/useTaskExecutionResult.mjs';
import { buildTaskExecutionResult } from '../src/utils/taskExecutionResult.mjs';
import { createTaskStorage } from './helpers/taskStorage.mjs';
import { nextTick } from 'vue';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from '@vue/compiler-sfc';
import { parse as parseJS } from '@babel/parser';
import { loadRequestModule } from './helpers/requestService.mjs';

const { descriptor } = parse(fs.readFileSync(new URL('../src/components/CommentFetch.vue', import.meta.url), 'utf8'));
const source = descriptor.scriptSetup.content;
const declarations = parseJS(source, { sourceType: 'module' }).program.body
  .filter(node => node.type === 'VariableDeclaration').flatMap(node => node.declarations);
function evaluate(node, scope) {
  scope = { ...loadRequestModule(), nextTick, ...scope };
  if (scope.request) scope.feishuRequest = config => scope.request(config);
  scope.feedback ??= { begin() {}, progress() {}, finish: (text, options) => scope.showCompletionToast?.(text, options), fail: error => scope.showErrorMsg?.(error?.message || error), hide() {} };
  return new Function(...Object.keys(scope), `return (${source.slice(node.start, node.end)});`)(...Object.values(scope));
}
function load(name, scope) {
  const node = declarations.find(node => node.id.name === name)?.init;
  assert.ok(node, `${name} 必须存在`);
  return evaluate(node, scope);
}
function fixture() {
  const messages = []; let created = 0, resumed = 0, cancelled = 0;
  const scope = { executionResult: useTaskExecutionResult(), latestExecutionResult: { value: null }, buildTaskExecutionResult, componentUnmounted: false,
    clearing: { value: false }, loading: { value: true }, isSubmitting: { value: false }, isCancelling: { value: false },
    activeCommentTaskId: { value: 'old-task' }, hasRecoverableTask: { value: false }, recoveryRequiresReopen: { value: false },
    props: { api_key: '' }, selectedFieldKeys: { value: ['cid'] },
    showCompletionToast: message => messages.push(message), showErrorMsg: message => messages.push(message), showToast() {},
    computed: fn => ({ get value() { return fn(); } }),
    commit: () => { created++; }, cancelCommentTask: () => { cancelled++; },
  };
  const callbacks = declarations.find(node => node.id.name === 'commentStreamTask').init.arguments[0].properties;
  const reportError = evaluate(callbacks.find(node => node.key.name === 'onError').value, scope);
  const onError = (error, task = { taskId: 'old-task' }) => reportError(error, task);
  const onFinish = evaluate(callbacks.find(node => node.key.name === 'onFinish').value, scope);
  scope.commentStreamTask = { resume: async restore => { resumed++; await restore({ taskId: 'old-task' }); return true; } };
  scope.taskActionState = load('taskActionState', scope);
  scope.resumeCommentTask = (...args) => load('resumeCommentTask', scope)(...args);
  const action = load('handleTaskAction', scope);
  const labelExpression = descriptor.template.content.match(/\{\{ (feedback\.endingMissingTarget[^\n]+?) \}\}/)[1];
  return { scope, onError, onFinish, action, messages,
    label: () => new Function('taskActionState', 'recoveryRequiresReopen', 'feedback', `return (${labelExpression});`)(
      scope.taskActionState.value, scope.recoveryRequiresReopen.value, scope.feedback ?? {}),
    created: () => created, resumed: () => resumed, cancelled: () => cancelled,
  };
}

test('异常暂停后按钮为恢复任务，点击继续原任务而不是创建新任务', async () => {
  const f = fixture(); await f.onError(new Error('write failed'));
  assert.equal(f.label(), '恢复任务');
  await f.action();
  assert.equal(f.resumed(), 1);
  assert.equal(f.created(), 0);
  assert.equal(f.scope.activeCommentTaskId.value, 'old-task');
  assert.equal(f.scope.taskActionState.value, 'running');
});

test('恢复读取尚未完成时重复点击，不重复恢复也不创建新任务', async () => {
  const f = fixture(); await f.onError(new Error('write failed'));
  let release, reads = 0;
  f.scope.commentStreamTask.resume = async restore => {
    reads++; await new Promise(resolve => { release = resolve; }); await restore({ taskId: 'old-task' }); return true;
  };
  const first = f.action();
  await f.action();
  await nextTick();
  assert.equal(reads, 1);
  assert.equal(f.created(), 0);
  release(); await first;
});

for (const result of ['read-error', 'missing']) {
  test(`恢复进度 ${result} 时保留恢复入口，不允许覆盖旧任务`, async () => {
    const f = fixture(); await f.onError(new Error('write failed'));
    f.scope.commentStreamTask.resume = async () => {
      if (result === 'read-error') throw new Error('storage unavailable');
      return false;
    };
    await f.action();
    assert.equal(f.label(), '恢复任务');
    assert.equal(f.created(), 0);
    assert.equal(f.scope.loading.value, false);
    assert.equal(f.scope.isSubmitting.value, false);
    assert.equal(f.messages.length, 2, '每次异常仅一个浮动出口');
    assert.match(f.messages.at(-1), result === 'read-error' ? /storage unavailable/ : /未读取到/);
  });
}

test('直接调用提交入口也优先恢复旧任务，不能绕过按钮保护', async () => {
  const f = fixture(); await f.onError(new Error('write failed'));
  await load('commit', f.scope)();
  assert.equal(f.resumed(), 1);
  assert.equal(f.scope.activeCommentTaskId.value, 'old-task');
});

test('恢复完成才回到立即执行；正常运行仍可停止', async () => {
  const f = fixture();
  await f.action(); assert.equal(f.cancelled(), 1);
  await f.onError(new Error('write failed'));
  await f.onFinish({ status: 3 }, { writtenCount: 4 });
  assert.equal(f.label(), '立即执行');
  await f.action(); assert.equal(f.created(), 1);
});

test('超时且旧请求可能仍在执行时，恢复按钮要求重新打开，不在原实例重写', async () => {
  const f = fixture(); await f.onError(Object.assign(new Error('timeout'), { requiresReopen: true }));
  await f.action();
  assert.equal(f.resumed(), 0);
  assert.equal(f.created(), 0);
  assert.equal(f.label(), '请重新进入插件恢复');
  assert.equal(f.messages.at(-1), 'timeout');
});


test('初始化未读取恢复进度时禁止点击创建任务', async () => {
  const f = fixture(); f.scope.loading.value = false;
  f.scope.isSubmitting.value = load('isSubmitting', { ref: value => ({ value }) }).value;
  await f.action();
  assert.equal(f.created(), 0);
  assert.equal(f.scope.taskActionState.value, 'submitting');
});

for (const blocked of ['getData', 'getSelection']) {
  test(`真实恢复流程 ${blocked} 不返回：超时退出忙碌，保留进度且晚返回不触发写入`, async () => {
    const f = fixture(); f.scope.loading.value = false;
    const snapshot = { taskId: 'old-task', baseId: 'base', targetTableId: 'table', cursor: 'saved-cursor', writtenCount: 20 };
    const storage = createTaskStorage('test', snapshot);
    let release, statusReads = 0, writes = 0;
    const timers = new Map(); let timerId = 0;
    const bitable = { bridge: {
      getData: storage.getData, setData: storage.setData,
    }, base: { getSelection: async () => ({ baseId: 'base' }) } };
    const owner = blocked === 'getData' ? bitable.bridge : bitable.base;
    const original = owner[blocked];
    owner[blocked] = () => new Promise(resolve => { release = resolve; });
    const engineSource = fs.readFileSync(new URL('../src/composables/useIncrementalTask.js', import.meta.url), 'utf8')
      .replace(/^import .*;\n/, '').replace('export const useIncrementalTask', 'const useIncrementalTask');
    const create = new Function('bitable', 'setTimeout', 'clearTimeout', `${engineSource};return useIncrementalTask;`)(bitable,
      (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; }, id => timers.delete(id));
    const engine = create({ storageKey: 'test', operationTimeoutMs: 180000,
      getStatus: async () => { statusReads++; return { status: 3 }; }, isTerminal: () => true,
      getResults: async () => ({ items: [] }), writeBatch: async () => { writes++; },
      onFinish: f.onFinish, onError: f.onError,
    });
    f.scope.commentStreamTask = engine;
    const running = f.scope.resumeCommentTask();
    for (let i = 0; i < 30; i++) await Promise.resolve();
    assert.equal(f.scope.isSubmitting.value, true);
    const timeout = [...timers.values()].find(timer => timer.delay === 180000);
    assert.ok(timeout, '恢复读取必须使用配置的超时保护');
    timeout.fn(); await running;
    assert.equal(f.scope.isSubmitting.value, false);
    assert.equal(f.label(), '恢复任务');
    assert.match(f.messages.at(-1), /超时.*恢复任务/);
    assert.doesNotMatch(f.messages.at(-1), /关闭|重新(?:打开|进入)/);
    assert.deepEqual(storage.current(), snapshot);
    assert.equal(engine.getActiveTask(), null);
    assert.equal(timers.size, 0);
    release(blocked === 'getData' ? snapshot : { baseId: 'base' });
    for (let i = 0; i < 30; i++) await Promise.resolve();
    assert.equal(statusReads, 0);
    assert.equal(writes, 0);
    assert.deepEqual(storage.current(), snapshot);
    owner[blocked] = original;
    await f.action();
    assert.equal(statusReads, 1, '显式恢复后读取原任务，迟到的旧读取不能自行启动');
    assert.equal(f.created(), 0);
    assert.equal(f.label(), '立即执行');
  });
}

test('页面初始化等待期间卸载，晚返回不会再发起任务恢复', async () => {
  const ast = parseJS(source, { sourceType: 'module' }).program.body;
  const callback = name => ast.find(node => node.type === 'ExpressionStatement'
    && node.expression.type === 'CallExpression' && node.expression.callee.name === name).expression.arguments[0];
  const mounted = callback('onMounted'), unmounted = callback('onUnmounted');
  let release, resumes = 0, stops = 0;
  const scope = { executionResult: useTaskExecutionResult(), latestExecutionResult: { value: null }, buildTaskExecutionResult, loadFieldOptions: () => new Promise(resolve => { release = resolve; }),
    loadSelectedFieldKeys: async () => {}, loadTableOutputConfigs: async () => {},
    fieldSelectionReady: { value: false }, isSubmitting: { value: true },
    resumeCommentTask: async () => { resumes++; }, commentStreamTask: { stop: () => { stops++; }, resume: async () => { resumes++; } },
    closeNoteInterval() {}, toastTimer: null,
  };
  const lifecycle = new Function(...Object.keys(scope), `let componentUnmounted = false; return {
    mount: (${source.slice(mounted.start, mounted.end)}), unmount: (${source.slice(unmounted.start, unmounted.end)})
  };`)(...Object.values(scope));
  const pending = lifecycle.mount(); lifecycle.unmount(); release(); await pending;
  assert.equal(stops, 1);
  assert.equal(resumes, 0);
});

function commentSubmissionFixture({ status = 3, operationTimeoutMs = 0 } = {}) {
  const storage = createTaskStorage('comment-submit');
  const timers = new Map(); let timerId = 0, write = storage.setData, creates = 0, reads = 0;
  let create = async () => ({ data: { sta: 0, data: { task_id: 'created-task' } } });
  const bitable = { base: { getSelection: async () => ({ baseId: 'base' }) }, bridge: {
    getData: storage.getData, setData: (...args) => write(...args),
  } };
  const source = fs.readFileSync(new URL('../src/composables/useIncrementalTask.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/, '').replace('export const useIncrementalTask', 'const useIncrementalTask');
  const useIncrementalTask = new Function('bitable', 'setTimeout', 'clearTimeout', `${source};return useIncrementalTask;`)(bitable,
    (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; }, id => timers.delete(id));
  const open = () => {
    const f = fixture();
    f.scope.loading.value = false;
    Object.assign(f.scope, {
      request: async () => { creates++; return create(); },
      formData: { value: { pages: 1, reply_pages: -1 } }, mappingDraft: { value: [] },
      commentStreamTask: useIncrementalTask({ storageKey: 'comment-submit', operationTimeoutMs,
        getStatus: async () => { reads++; return { status }; },
        isTerminal: status => status.status === 3,
        getResults: async () => ({ items: [] }), writeBatch: async () => assert.fail('本次夹具没有写入结果'),
        requestStop: async () => ({ status: 3 }), onError: f.onError, onFinish: f.onFinish,
      }),
    });
    return { ...f, submit: load('postNoteTask', f.scope), engine: f.scope.commentStreamTask };
  };
  return { open, storage, timers, setWrite: value => { write = value; }, setCreate: value => { create = value; },
    creates: () => creates, reads: () => reads };
}

test('评论离开后创建响应迟到，新页面等首次保存结束才恢复同一任务', async () => {
  const f = commentSubmissionFixture();
  const first = f.open();
  const created = Promise.withResolvers(), writing = Promise.withResolvers(), ready = Promise.withResolvers();
  f.setCreate(() => created.promise);
  f.setWrite(async (key, value) => {
    if (key === 'comment-submit') {
      ready.resolve(value);
      await writing.promise;
    }
    return f.storage.setData(key, value);
  });
  const pending = first.submit('original', 'url');
  first.engine.stop();
  const next = f.open();
  const resumed = next.scope.resumeCommentTask();
  created.resolve({ data: { sta: 0, data: { task_id: 'created-task' } } });
  const snapshot = await ready.promise;
  assert.equal(snapshot.taskId, 'created-task');
  assert.equal(snapshot.targetTableId, 'original');
  assert.equal(snapshot.pendingCommentWrite, false);
  assert.equal(f.reads(), 0);
  assert.equal(next.scope.isSubmitting.value, true);
  writing.resolve();
  await Promise.all([pending, resumed]);
  assert.equal(f.creates(), 1);
  assert.equal(f.reads(), 1);
  assert.equal(next.label(), '立即执行');
});

for (const outcome of ['error', 'missing']) {
  test(`评论新任务已保存但恢复读取${outcome}时保留恢复入口`, async () => {
    const f = fixture();
    Object.assign(f.scope, {
      formData: { value: { pages: 1, reply_pages: -1 } }, mappingDraft: { value: [] },
      request: async () => ({ data: { sta: 0, data: { task_id: 'saved-task' } } }),
      commentStreamTask: { submit: async create => {
        const task = await create();
        if (outcome === 'error') return f.onError(new Error('读取恢复进度失败'), task);
        return false;
      } },
    });
    await load('postNoteTask', f.scope)('table', 'url');
    assert.equal(f.label(), '恢复任务');
    assert.equal(f.scope.hasRecoverableTask.value, true);
    assert.equal(f.created(), 0);
  });
}

test('评论首次保存持续失败仍可结束原任务，成功后清除提交保护', async () => {
  const f = commentSubmissionFixture();
  f.setWrite(async (key, value) => {
    if (key === 'comment-submit') throw new Error('保存失败');
    return f.storage.setData(key, value);
  });
  const page = f.open();
  const next = f.open();
  await page.submit('table', 'url');
  assert.equal(page.label(), '恢复任务');
  assert.equal(f.reads(), 0);
  const retry = await next.engine.resume().catch(error => error);
  const end = retry.endPausedTask;
  assert.match(retry.message, /保存失败/);
  assert.equal(typeof end, 'function');
  assert.equal(await end(), true);
  assert.equal(await next.engine.resume(), false);
  assert.equal(f.creates(), 1);
  assert.equal(f.reads(), 1);
});

test('评论首次保存超时保持在途保护，迟到成功后重进恢复原任务', async () => {
  const f = commentSubmissionFixture({ operationTimeoutMs: 180000 });
  const ready = Promise.withResolvers(), save = Promise.withResolvers();
  f.setWrite(async (key, value) => {
    ready.resolve();
    await save.promise;
    return f.storage.setData(key, value);
  });
  const first = f.open();
  const pending = first.submit('table', 'url');
  await ready.promise;
  [...f.timers.values()].find(timer => timer.delay === 180000).fn();
  await pending;
  assert.equal(first.label(), '请重新进入插件恢复');
  const next = f.open();
  await next.scope.resumeCommentTask();
  assert.equal(next.label(), '请重新进入插件恢复');
  assert.equal(f.reads(), 0);
  assert.equal(f.creates(), 1);
  save.resolve();
  await new Promise(setImmediate);
  const recovered = f.open();
  await recovered.scope.resumeCommentTask();
  assert.equal(recovered.label(), '立即执行');
  assert.equal(f.reads(), 1);
  assert.equal(f.creates(), 1);
});

test('评论后台创建失败可直接重新执行', async () => {
  const f = commentSubmissionFixture();
  f.setCreate(async () => ({ data: { sta: 1, msg: '创建失败' } }));
  const page = f.open();
  await page.submit('table', 'url');
  assert.equal(page.label(), '立即执行');
  assert.equal(page.scope.hasRecoverableTask.value, false);
  assert.equal(await f.storage.getData('comment-submit'), undefined);
});

test('真实任务清理超时后不能新建，旧清理晚返回仍保持保护', async () => {
  const f = fixture(); let release;
  const storage = createTaskStorage('test', { taskId: 'old-task', cursor: 'last', writtenCount: 4 });
  const timers = new Map(); let timerId = 0;
  const bitable = { base: { getSelection: async () => ({ baseId: 'base' }) }, bridge: {
    getData: storage.getData,
    setData: async (key, value) => { if (value.finished) await new Promise(resolve => { release = resolve; }); await storage.setData(key, value); },
  } };
  const engineSource = fs.readFileSync(new URL('../src/composables/useIncrementalTask.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/, '').replace('export const useIncrementalTask', 'const useIncrementalTask');
  const create = new Function('bitable', 'setTimeout', 'clearTimeout', `${engineSource};return useIncrementalTask;`)(bitable,
    (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; }, id => timers.delete(id));
  const engine = create({ storageKey: 'test', operationTimeoutMs: 180000,
    getStatus: async () => ({ status: 3 }), isTerminal: () => true,
    getResults: async () => ({ items: [] }), writeBatch: async () => assert.fail('结果已排空，不应重写'),
    onError: f.onError, onFinish: f.onFinish,
  });
  f.scope.commentStreamTask = engine;
  const running = engine.resume();
  for (let i = 0; i < 40; i++) await Promise.resolve();
  assert.ok(release);
  [...timers.values()].find(timer => timer.delay === 180000).fn(); await running;
  assert.equal(f.label(), '请重新进入插件恢复');
  assert.equal(f.scope.recoveryRequiresReopen.value, true);
  await f.action(); assert.equal(f.created(), 0);
  engine.stop();
  const next = fixture(); next.scope.loading.value = false;
  next.scope.commentStreamTask = create({ storageKey: 'test',
    getStatus: async () => assert.fail('清理未结束不能轮询'),
    getResults: async () => assert.fail('清理未结束不能读取结果'),
    writeBatch: async () => assert.fail('清理未结束不能写入'),
    onError: next.onError, onFinish: next.onFinish,
  });
  await next.scope.resumeCommentTask();
  assert.equal(next.label(), '请重新进入插件恢复');
  assert.equal(next.scope.recoveryRequiresReopen.value, true);
  await next.action(); assert.equal(next.created(), 0);
  release(); for (let i = 0; i < 20; i++) await Promise.resolve();
  assert.equal(next.label(), '请重新进入插件恢复');
  await next.action(); assert.equal(next.created(), 0);
  assert.equal(f.label(), '请重新进入插件恢复');
  await f.action(); assert.equal(f.created(), 0);
  assert.equal(engine.getActiveTask(), null);
});
