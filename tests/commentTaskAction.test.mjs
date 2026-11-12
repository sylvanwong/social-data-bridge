import { nextTick } from 'vue';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from '@vue/compiler-sfc';
import { parse as parseJS } from '@babel/parser';

const { descriptor } = parse(fs.readFileSync(new URL('../src/components/CommentFetch.vue', import.meta.url), 'utf8'));
const source = descriptor.scriptSetup.content;
const declarations = parseJS(source, { sourceType: 'module' }).program.body
  .filter(node => node.type === 'VariableDeclaration').flatMap(node => node.declarations);
function evaluate(node, scope) {
  scope = { nextTick, ...scope };
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
  const scope = { commentSubmission: { pending: null }, componentUnmounted: false,
    clearing: { value: false }, loading: { value: true }, isSubmitting: { value: false }, isCancelling: { value: false },
    activeCommentTaskId: { value: 'old-task' }, hasRecoverableTask: { value: false }, recoveryRequiresReopen: { value: false },
    props: { api_key: '' }, selectedFieldKeys: { value: ['cid'] },
    showCompletionToast: message => messages.push(message), showErrorMsg: message => messages.push(message), showToast() {},
    computed: fn => ({ get value() { return fn(); } }),
    commit: () => { created++; }, cancelCommentTask: () => { cancelled++; },
  };
  const callbacks = declarations.find(node => node.id.name === 'commentStreamTask').init.arguments[0].properties;
  const onError = evaluate(callbacks.find(node => node.key.name === 'onError').value, scope);
  const onFinish = evaluate(callbacks.find(node => node.key.name === 'onFinish').value, scope);
  scope.commentStreamTask = { resume: async restore => { resumed++; await restore({ taskId: 'old-task' }); return true; } };
  scope.taskActionState = load('taskActionState', scope);
  scope.resumeCommentTask = (...args) => load('resumeCommentTask', scope)(...args);
  const action = load('handleTaskAction', scope);
  const labelExpression = descriptor.template.content.match(/\{\{ (taskActionState[^\n]+?) \}\}/)[1];
  return { scope, onError, onFinish, action, messages,
    label: () => new Function('taskActionState', 'recoveryRequiresReopen', `return (${labelExpression});`)(scope.taskActionState.value, scope.recoveryRequiresReopen.value),
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
    let saved = structuredClone(snapshot), release, statusReads = 0, writes = 0;
    const timers = new Map(); let timerId = 0;
    const bitable = { bridge: {
      getData: async () => structuredClone(saved), setData: async (_, value) => { saved = structuredClone(value); },
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
    assert.deepEqual(saved, snapshot);
    assert.equal(engine.getActiveTask(), null);
    assert.equal(timers.size, 0);
    release(blocked === 'getData' ? snapshot : { baseId: 'base' });
    for (let i = 0; i < 30; i++) await Promise.resolve();
    assert.equal(statusReads, 0);
    assert.equal(writes, 0);
    assert.deepEqual(saved, snapshot);
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
  const scope = { loadFieldOptions: () => new Promise(resolve => { release = resolve; }),
    loadSelectedFieldKeys: async () => {}, loadTableOutputConfigs: async () => {},
    fieldSelectionReady: { value: false }, isSubmitting: { value: true },
    commentSubmission: { pending: null }, resumeCommentTask: async () => { resumes++; }, commentStreamTask: { stop: () => { stops++; }, resume: async () => { resumes++; } },
    closeNoteInterval() {}, toastTimer: null,
  };
  const lifecycle = new Function(...Object.keys(scope), `let componentUnmounted = false; return {
    mount: (${source.slice(mounted.start, mounted.end)}), unmount: (${source.slice(unmounted.start, unmounted.end)})
  };`)(...Object.values(scope));
  const pending = lifecycle.mount(); lifecycle.unmount(); release(); await pending;
  assert.equal(stops, 1);
  assert.equal(resumes, 0);
});

test('提交接口在页面卸载后返回，保存任务但不在旧页面启动', async () => {
  const ast = parseJS(source, { sourceType: 'module' }).program.body;
  const unmounted = ast.find(node => node.type === 'ExpressionStatement'
    && node.expression.type === 'CallExpression' && node.expression.callee.name === 'onUnmounted').expression.arguments[0];
  const submit = declarations.find(node => node.id.name === 'postNoteTask').init;
  let release, releaseSave, starts = 0, saved;
  const scope = { request: () => new Promise(resolve => { release = resolve; }), showToast() {},
    props: { api_key: 'test' }, formData: { value: { pages: 1, reply_pages: -1 } },
    selectedFieldKeys: { value: ['cid'] }, mappingDraft: { value: [] }, activeCommentTaskId: { value: '' },
    commentSubmission: { pending: null },
    commentStreamTask: { stop() {}, saveForResume: async task => { await new Promise(resolve => { releaseSave = resolve; }); saved = task; }, resume: async () => { starts++; }, start: () => { starts++; } }, closeNoteInterval() {}, toastTimer: null,
  };
  const page = new Function(...Object.keys(scope), `let componentUnmounted = false; return {
    submit: (${source.slice(submit.start, submit.end)}), unmount: (${source.slice(unmounted.start, unmounted.end)})
  };`)(...Object.values(scope));
  const pending = page.submit('table', 'https://example.test'); page.unmount();
  let resumed = 0;
  const mounted = ast.find(node => node.type === 'ExpressionStatement'
    && node.expression.type === 'CallExpression' && node.expression.callee.name === 'onMounted').expression.arguments[0];
  const nextPage = { componentUnmounted: false, commentSubmission: scope.commentSubmission,
    loadFieldOptions: async () => {}, loadSelectedFieldKeys: async () => {}, loadTableOutputConfigs: async () => {},
    fieldSelectionReady: { value: false }, isSubmitting: { value: true },
    resumeCommentTask: async () => { assert.equal(saved?.taskId, 'late-task'); resumed++; },
  };
  const mounting = evaluate(mounted, nextPage)();
  release({ data: { sta: 0, data: { task_id: 'late-task' } } });
  for (let i = 0; i < 20; i++) await Promise.resolve();
  assert.equal(nextPage.isSubmitting.value, true);
  assert.equal(resumed, 0, '接口已返回但身份未保存时，新页面仍不能恢复或新建');
  releaseSave(); await pending; await mounting;
  assert.equal(resumed, 1);
  assert.equal(starts, 0);
  assert.equal(saved?.taskId, 'late-task');
  assert.equal(saved.targetTableId, 'table');
  assert.equal(saved.pendingCommentWrite, false);
});


test('重新进入页面先等待旧提交保存，再恢复同一任务，等待期间不能新建', async () => {
  const ast = parseJS(source, { sourceType: 'module' }).program.body;
  const mounted = ast.find(node => node.type === 'ExpressionStatement'
    && node.expression.type === 'CallExpression' && node.expression.callee.name === 'onMounted').expression.arguments[0];
  let release, resumes = 0;
  const scope = { componentUnmounted: false,
    commentSubmission: { pending: new Promise(resolve => { release = resolve; }) },
    loadFieldOptions: async () => {}, loadSelectedFieldKeys: async () => {}, loadTableOutputConfigs: async () => {},
    fieldSelectionReady: { value: false }, isSubmitting: { value: true },
    resumeCommentTask: async () => { resumes++; },
  };
  const pending = evaluate(mounted, scope)();
  for (let i = 0; i < 20; i++) await Promise.resolve();
  assert.equal(resumes, 0);
  assert.equal(scope.isSubmitting.value, true);
  release(); await pending;
  assert.equal(resumes, 1);
  assert.equal(scope.isSubmitting.value, false);
});


for (const outcome of ['error', 'missing']) {
  test(`新任务已保存但恢复读取${outcome}时保留恢复入口，不能新建覆盖`, async () => {
    const f = fixture();
    Object.assign(f.scope, {
      commentSubmission: { pending: null },
      request: async () => ({ data: { sta: 0, data: { task_id: 'saved-task' } } }),
      formData: { value: { pages: 1, reply_pages: -1 } }, mappingDraft: { value: [] },
      commentStreamTask: { saveForResume: async () => {}, resume: async () => {
        if (outcome === 'error') throw new Error('读取恢复进度失败');
        return false;
      } },
    });
    await load('postNoteTask', f.scope)('table', 'url');
    assert.equal(f.label(), '恢复任务');
    assert.equal(f.scope.hasRecoverableTask.value, true);
    assert.equal(f.created(), 0);
  });
}


test('保存任务身份超时后保留恢复保护，不能新建任务等待旧写入覆盖', async () => {
  const f = fixture();
  const error = Object.assign(new Error('保存写入进度超时'), { requiresReopen: true });
  Object.assign(f.scope, {
    commentSubmission: { pending: null },
    request: async () => ({ data: { sta: 0, data: { task_id: 'created-task' } } }),
    formData: { value: { pages: 1 } }, mappingDraft: { value: [] },
    commentStreamTask: { saveForResume: async () => { throw error; } },
  });
  await load('postNoteTask', f.scope)('table', 'url');
  assert.equal(f.label(), '请重新进入插件恢复');
  assert.equal(f.scope.recoveryRequiresReopen.value, true);
  assert.ok(f.scope.commentSubmission.pending, '保存失败不能被新页面当成无待处理任务');
  const mounted = parseJS(source, { sourceType: 'module' }).program.body.find(node => node.type === 'ExpressionStatement'
    && node.expression.type === 'CallExpression' && node.expression.callee.name === 'onMounted').expression.arguments[0];
  const reopened = fixture();
  reopened.scope.loading.value = false;
  reopened.scope.isSubmitting.value = true;
  Object.assign(reopened.scope, {
    commentSubmission: f.scope.commentSubmission,
    loadFieldOptions: async () => {}, loadSelectedFieldKeys: async () => {}, loadTableOutputConfigs: async () => {},
    fieldSelectionReady: { value: false },
  });
  await evaluate(mounted, reopened.scope)();
  assert.equal(reopened.label(), '请重新进入插件恢复');
  assert.equal(reopened.scope.recoveryRequiresReopen.value, true);
  assert.equal(reopened.resumed(), 0);
  await reopened.action();
  assert.equal(reopened.created(), 0);
  assert.equal(reopened.resumed(), 0);
});

for (const timeout of [false, true]) {
  test(`补存再次失败仍保留原任务信息${timeout ? '并保护未结束的保存' : '，再次恢复可继续'}`, async () => {
    const f = fixture(); f.scope.loading.value = false;
    const task = { taskId: 'created-task', targetTableId: 'table', writeMode: 'append',
      pendingCommentWrite: false, fieldMappings: [{ source_key: 'cid', target_field_id: 'custom-id' }] };
    const initial = Object.assign(new Error('initial save failed'), { taskCreated: true, createdTask: task });
    f.scope.commentSubmission.pending = Promise.reject(initial);
    let saves = 0, resumes = 0;
    f.scope.commentStreamTask = {
      saveForResume: async saved => {
        assert.deepEqual(saved, task); saves++;
        if (saves === 1) throw Object.assign(new Error('save failed again'), { requiresReopen: timeout });
      },
      resume: async () => { resumes++; return true; },
    };
    await f.scope.resumeCommentTask();
    assert.equal(resumes, 0);
    assert.equal(f.label(), timeout ? '请重新进入插件恢复' : '恢复任务');
    assert.equal(f.scope.recoveryRequiresReopen.value, timeout);
    const error = await f.scope.commentSubmission.pending.catch(error => error);
    assert.deepEqual(error.createdTask, task);
    await f.action();
    assert.equal(saves, timeout ? 1 : 2);
    assert.equal(resumes, timeout ? 0 : 1);
    if (!timeout) assert.equal(f.scope.commentSubmission.pending, null);
    assert.equal(f.created(), 0);
  });
}

test('后台创建失败不保存任务、不显示恢复入口，仍可重新提交', async () => {
  const f = fixture();
  Object.assign(f.scope, {
    request: async () => ({ data: { sta: 1, msg: '创建失败' } }),
    formData: { value: { pages: 1 } }, mappingDraft: { value: [] },
    commentStreamTask: { saveForResume: async () => assert.fail('未创建任务不能保存') },
  });
  await load('postNoteTask', f.scope)('table', 'url');
  assert.equal(f.label(), '立即执行');
  assert.equal(f.scope.commentSubmission.pending, null);
  assert.equal(f.scope.hasRecoverableTask.value, false);
});

test('真实任务清理超时后不能新建，旧清理晚返回仍保持保护', async () => {
  const f = fixture(); let saved = { taskId: 'old-task', cursor: 'last', writtenCount: 4 }, release;
  const timers = new Map(); let timerId = 0;
  const bitable = { base: { getSelection: async () => ({ baseId: 'base' }) }, bridge: {
    getData: async () => structuredClone(saved),
    setData: async (_, value) => { if (!value.taskId) await new Promise(resolve => { release = resolve; }); saved = structuredClone(value); },
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
