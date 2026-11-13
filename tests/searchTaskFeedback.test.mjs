import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from '@vue/compiler-sfc';
import { parse as parseJS } from '@babel/parser';
import { createRenderer, defineComponent, ref, nextTick } from 'vue';
import { useTaskFeedback } from '../src/composables/useTaskFeedback.mjs';
import { loadRequestModule } from './helpers/requestService.mjs';

const pages = [['BloggerSearch', 'searchTask', 'submit', '作者'], ['KeywordSearch', 'keywordStreamTask', 'commit', '作品']];
const defer = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); await nextTick(); };

function fixture(t, page, taskName, overrides = {}) {
  let feedback;
  const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} });
  const app = renderer.createApp(defineComponent({ setup() { feedback = useTaskFeedback(); return () => null; } }));
  app.mount({}); t.after(() => app.unmount());
  const source = parse(fs.readFileSync(new URL(`../src/components/${page}.vue`, import.meta.url), 'utf8')).descriptor.scriptSetup.content;
  const declarations = parseJS(source, { sourceType: 'module' }).program.body.filter(n => n.type === 'VariableDeclaration').flatMap(n => n.declarations);
  const notifications = [];
  const form = ref({ social_type: 'xhs', keyword: '露营', radio: 2, table_id: 'table-1', writeMode: 'upsert', rangeType: 'pages', pages: 1, workFetchRange: { type: 'pages', pages: 1 } });
  const bindings = {
    ...loadRequestModule(),
    feedback, ...feedback, toastLoading: ref(false), nextTick, setTimeout, clearTimeout, toastTimer: null,
    clearing: ref(false), loading: ref(false), submitting: ref(false), isSubmitting: ref(false), cancelling: ref(false), isCancelling: ref(false),
    hasRecoverableTask: ref(false), requiresReopen: ref(false), componentUnmounted: false,
    taskId: ref(''), activeKeywordTaskId: ref(''), currentTableName: ref(''), props: { api_key: 'test-only' },
    form, formData1: form, tableFieldsError: null, tableConfigsLoaded: ref(true), mappingLoading: ref(false), tableConfigApplying: ref(false), tableConfigLoadError: ref(''), mappingDraft: ref([]), selectedFieldKeys: ref(['id']),
    isDouyin: ref(false), isBilibiliCustomDate: ref(false), TASK_TOAST_SUFFIX: '请勿关闭插件，关闭将中断任务',
    parseKeywords: text => String(text).split(',').map(s => s.trim()).filter(Boolean), normalizeWorkFetchRange: () => ({}),
    getFirstKeyword: text => String(text).split(',')[0], auth: () => ({}),
    request: async () => ({ data: { sta: 0, data: { task_id: 'task-1' } } }),
    validateTableFields: async () => true,
    bitable: { bridge: { setData() {} } },
    showErrorMsg: message => notifications.push({ message, type: 'error', plain: true, duration: 3000 }),
    ElMessage: message => notifications.push(message), console: { error() {} },
    getTaskStoppingText: (task, unit) => `正在停止获取数据，已写入 ${task.writtenCount || 0} 条${unit}。请勿关闭插件，关闭会中断数据写入`,
    [taskName]: { submit: async create => { await create(); }, resume: async () => false },
    ...overrides,
  };
  bindings.feishuRequest = config => bindings.request(config);
  function handler(name) {
    const node = declarations.find(n => n.id.name === name)?.init;
    if (!node) return undefined;
    return new Function(...Object.keys(bindings), `return (${source.slice(node.start, node.end)});`)(...Object.values(bindings));
  }
  for (const name of ['keywordTaskApiPath', 'bloggerTaskApiPath', 'hideToast', 'showToast', 'showCompletionToast', 'getStoppingText', 'showFieldProgress', 'restoreTask', 'resumeSavedTask', 'postSearchTask', 'getSearchData']) {
    const fn = handler(name); if (fn) bindings[name] = fn;
  }
  const callbacks = Object.fromEntries(declarations.find(n => n.id.name === taskName).init.arguments[0].properties
    .filter(n => ['onProgress', 'onWriting', 'onFinish', 'onError'].includes(n.key.name))
    .map(n => [n.key.name, new Function(...Object.keys(bindings), `return (${source.slice(n.value.start, n.value.end)});`)(...Object.values(bindings))]));
  return { feedback, bindings, notifications, callbacks, handler };
}

for (const [page, taskName, submitName, unit] of pages) {
  for (const stage of ['new', 'resume']) {
    test(`${page}：${stage === 'new' ? '新建就绪' : '恢复旧任务'}使用对应进度文案并保持可停止`, async t => {
      const task = { taskId: 'task-1', writtenCount: 0 };
      const { feedback: f, bindings: b, handler } = fixture(t, page, taskName, {
        [taskName]: {
          submit: async (create, onReady) => onReady(await create()),
          resume: async onRestore => { onRestore(task); return true; },
        },
      });
      b.form.value.radio = 1;
      if (stage === 'new') await handler(submitName)();
      else await b.resumeSavedTask();

      assert.equal(f.toastType.value, 'loading');
      assert.equal(f.toastVisible.value, true);
      assert.equal(b.loading.value, true);
      assert.equal((page === 'BloggerSearch' ? b.taskId : b.activeKeywordTaskId).value, task.taskId);
      assert.equal((page === 'BloggerSearch' ? b.cancelling : b.isCancelling).value, false);
      assert.equal(f.toastText.value.match(/请勿关闭插件/g).length, 1);
      if (stage === 'new') {
        assert.equal(f.toastText.value, `任务已创建，正在准备获取${unit}…请勿关闭插件，关闭将中断任务`);
        assert.doesNotMatch(f.toastText.value, /恢复/);
      } else {
        assert.match(f.toastText.value, /正在恢复未完成的.*任务/);
        assert.doesNotMatch(f.toastText.value, /任务已创建/);
      }
    });
  }

  for (const nextState of ['finished', 'new-stopping', 'same-task']) {
    test(`${page}：停止请求延迟失败仅影响所属任务（${nextState}）`, async t => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const pending = defer(), nextStop = defer();
      let active = { taskId: 'old-task', writtenCount: 2 };
      const { feedback: f, bindings: b, callbacks, handler, notifications } = fixture(t, page, taskName, {
        [taskName]: { getActiveTask: () => active },
        request: config => config.data.task_id === 'old-task' ? pending.promise : nextStop.promise,
      });
      const cancel = handler(page === 'BloggerSearch' ? 'cancel' : 'cancelKeywordTask');
      const stopping = page === 'BloggerSearch' ? b.cancelling : b.isCancelling;
      b.loading.value = true;
      const oldStop = cancel();
      let newStop;
      try {
        if (nextState !== 'same-task') {
          const old = active; active = null;
          await callbacks.onFinish({ status: 1 }, old);
          if (nextState === 'new-stopping') {
            active = { taskId: 'new-task', writtenCount: 7 };
            b.loading.value = true;
            callbacks.onProgress({ status: 0, processed: 1, total: 10 }, active);
            newStop = cancel();
          }
        }
        pending.reject(new Error('旧任务停止失败'));
        await oldStop;
        if (nextState === 'same-task') {
          assert.equal(stopping.value, false);
          assert.equal(f.toastType.value, 'loading');
          assert.match(f.toastText.value, /任务继续执行.*请勿关闭插件/);
          assert.deepEqual(notifications.map(n => n.message), ['旧任务停止失败']);
        } else if (nextState === 'finished') {
          assert.equal(b.loading.value, false);
          assert.equal(f.toastType.value, 'success');
          assert.match(f.toastText.value, /已写入 2 条/);
        } else {
          assert.equal(b.loading.value, true);
          assert.equal(stopping.value, true, '旧请求不能清除新任务的停止状态');
          assert.equal(f.toastType.value, 'loading');
          assert.match(f.toastText.value, /已写入 7 条/);
          assert.match(f.toastText.value, /请勿关闭插件，关闭会中断数据写入/);
          t.mock.timers.tick(5000);
          assert.equal(f.toastVisible.value, true, '旧错误不能安排隐藏新任务的计时器');
        }
        if (nextState !== 'same-task') assert.deepEqual(notifications, []);
      } finally {
        nextStop.resolve({ data: { sta: 0 } });
        await newStop;
      }
    });
  }

  test(`${page}：异步字段校验前立即加载、阻止重复提交，实际准备异常只显示一次`, async t => {
    const pending = defer(); let validations = 0;
    const { feedback: f, bindings: b, notifications, handler } = fixture(t, page, taskName, {
      validateTableFields: () => { validations++; return pending.promise; },
    });
    const running = handler(submitName)(); await flush();
    assert.equal(f.toastVisible.value, true); assert.equal(f.toastLoading.value, true);
    assert.match(f.toastText.value, /请勿关闭插件，关闭将中断任务/);
    assert.equal(b.loading.value || b.submitting.value || b.isSubmitting.value, true);
    await handler(submitName)(); assert.equal(validations, 1);
    pending.reject(new Error('原始字段读取失败')); await running;
    assert.equal(f.toastType.value, 'error'); assert.equal(f.toastText.value, '原始字段读取失败');
    assert.equal(b.loading.value, false); assert.equal(b.submitting.value, false); assert.equal(b.isSubmitting.value, false);
    assert.deepEqual(notifications, []);
  });

  test(`${page}：创建HTTP仍未返回时已有居中提示和互斥`, async t => {
    const pending = defer(); let requests = 0;
    const { feedback: f, bindings: b, handler } = fixture(t, page, taskName, {
      request: () => { requests++; return pending.promise; },
    });
    b.form.value.radio = 1;
    const running = handler(submitName)(); await flush();
    assert.equal(f.toastVisible.value, true); assert.match(f.toastText.value, /请勿关闭插件/);
    await handler(submitName)(); assert.equal(requests, 1);
    pending.reject(new Error('创建任务连接中断')); await running;
    assert.equal(f.toastType.value, 'error'); assert.equal(f.toastText.value, '创建任务连接中断');
    assert.equal(b.loading.value, false);
  });

  for (const [status, written, kind, duration] of [[1, 2, 'success', 3000], [1, 0, 'info', 5000], [2, 2, 'error', 5000], [3, 2, 'info', 3000]]) {
    test(`${page}：状态${status}、已写${written}条按${kind}显示${duration}毫秒`, async t => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const { feedback: f, callbacks, notifications } = fixture(t, page, taskName);
      await callbacks.onFinish({ status, reason: '平台返回失败原因' }, { taskId: 'task-1', writtenCount: written });
      assert.equal(f.toastType.value, kind); assert.doesNotMatch(f.toastText.value, /请勿关闭/);
      assert.match(f.toastText.value, status === 2 ? /平台返回失败原因/ : new RegExp(`已写入 ${written} 条${unit}`));
      assert.deepEqual(notifications, []);
      t.mock.timers.tick(duration - 1); assert.equal(f.toastVisible.value, true);
      t.mock.timers.tick(1); assert.equal(f.toastVisible.value, false);
    });
  }

  test(`${page}：执行与停止写入阶段提醒各出现一次`, async t => {
    const { feedback: f, callbacks } = fixture(t, page, taskName);
    callbacks.onProgress({ processed: 1, total: 2 }, { writtenCount: 3 });
    assert.match(f.toastText.value, /请勿关闭插件，关闭将中断任务/);
    callbacks.onProgress({ status: 3, processed: 1, total: 2 }, { writtenCount: 3 });
    callbacks.onWriting([{}], { writtenCount: 3 });
    assert.match(f.toastText.value, /请勿关闭插件，关闭会中断数据写入/);
    assert.equal(f.toastText.value.match(/请勿关闭插件/g).length, 1);
  });

  test(`${page}：写入异常5秒后仍保留原重开要求和原任务恢复状态`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { feedback: f, bindings: b, callbacks, handler, notifications } = fixture(t, page, taskName);
    const error = Object.assign(new Error('写入超时，请关闭当前插件后重新打开并核对写入结果，勿重复启动任务'), { requiresReopen: true });
    await callbacks.onError(error, { taskId: 'task-1' });
    assert.equal(f.toastText.value, error.message); assert.equal(f.toastType.value, 'error');
    assert.equal(b.requiresReopen.value, true); assert.equal(b.hasRecoverableTask.value, true);
    t.mock.timers.tick(5000); assert.equal(f.toastVisible.value, false); assert.equal(f.taskNotice.value, error.message);
    assert.deepEqual(notifications, []);
    b[taskName].resume = () => assert.fail('必须重开时不得本页恢复'); await handler('resumeSavedTask')();
  });

  test(`${page}：恢复首次SDK读取之前有反馈，读取失败释放加载并保留原因`, async t => {
    const pending = defer();
    const { feedback: f, bindings: b, notifications, handler } = fixture(t, page, taskName, { [taskName]: { resume: () => pending.promise } });
    b.hasRecoverableTask.value = true;
    const running = handler('resumeSavedTask')(); await flush();
    assert.equal(f.toastVisible.value, true); assert.equal(b.loading.value, true); assert.match(f.toastText.value, /请勿关闭插件/);
    pending.reject(new Error('恢复状态读取失败')); await running;
    assert.equal(f.toastType.value, 'error'); assert.equal(b.loading.value, false);
    assert.equal(f.taskNotice.value, '恢复状态读取失败'); assert.deepEqual(notifications, []);
  });

  test(`${page}：同步校验失败只显示顶部具体错误，不闪启动提示`, async t => {
    const { feedback: f, bindings: b, handler, notifications } = fixture(t, page, taskName);
    b.form.value.keyword = ''; await handler(submitName)();
    assert.equal(f.toastVisible.value, false); assert.equal(b.loading.value, false);
    assert.equal(notifications.length, 1); assert.match(notifications[0].message, /请输入至少一个/);
    assert.equal(notifications[0].duration, 3000);
  });
}
