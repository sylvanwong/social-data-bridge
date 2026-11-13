import { readRecordIds, readUniqueSourceLinks } from '../src/utils/sourceTableRows.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse, compileTemplate } from '@vue/compiler-sfc';
import * as Vue from 'vue';
import { renderToString } from '@vue/server-renderer';
import { parse as parseJS } from '@babel/parser';
import { createRenderer, defineComponent, nextTick, ref } from 'vue';
import { useTaskFeedback } from '../src/composables/useTaskFeedback.mjs';
import { loadRequestModule } from './helpers/requestService.mjs';

const pages = [
  ['ProfileFetch', 'profileStreamTask', 'resumeSavedStreamTask', 'handleImmediateSubmit', '作品'],
  ['CommentFetch', 'commentStreamTask', 'resumeCommentTask', 'commit', '评论'],
  ['SeriesFetch', 'seriesStreamTask', 'resumeSeriesTask', 'commit', '短剧'],
];
const defer = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); await nextTick(); };

// Execute each real page handler with real Vue feedback; only task/SDK/network boundaries are substituted.
function fixture(t, page, taskName, overrides = {}) {
  let feedback;
  const renderer = createRenderer({
    createComment: text => ({ text }), insert() {}, remove() {}, parentNode() {}, nextSibling() {},
  });
  const app = renderer.createApp(defineComponent({ setup() { feedback = useTaskFeedback(); return () => null; } }));
  app.mount({}); t.after(() => app.unmount());
  const source = parse(fs.readFileSync(new URL(`../src/components/${page}.vue`, import.meta.url), 'utf8')).descriptor.scriptSetup.content;
  const declarations = parseJS(source, { sourceType: 'module' }).program.body
    .filter(n => n.type === 'VariableDeclaration').flatMap(n => n.declarations);
  const notifications = [];
  const bindings = {
    ...loadRequestModule(),
    readRecordIds, readUniqueSourceLinks, feedback, ...feedback, toastLoading: ref(false), ref, nextTick, toastTimer: null,
    setTimeout, clearTimeout, console: { error() {}, log() {} },
    clearing: ref(false), loading: ref(false), isSubmitting: ref(false), isCancelling: ref(false), hasRecoverableTask: ref(false), recoveryRequiresReopen: ref(false),
    activeProfileTaskId: ref('task-1'), activeCommentTaskId: ref('task-1'), activeSeriesTaskId: ref('task-1'),
    activeStreamTask: { taskId: 'task-1' }, activeSeriesTask: { taskId: 'task-1' }, componentUnmounted: false,
    TASK_TOAST_SUFFIX: '请勿关闭插件，关闭将中断任务',
    props: { api_key: 'test-only' }, selectedFieldKeys: ref(['id']),
    formData: ref({ mode: 'manual', manualUrls: 'https://example.com/author', radio: 1, targetType: 'new' }),
    validateBaseForm: () => true, parseManualUrls: text => text.split('\n'), normalizeTargetType: value => value,
    validateConfiguredInputFilter: async () => null, mappingDraft: ref([]), cloneFieldMappings: fields => fields,
    commentSubmission: { pending: null },
    restoreProfileTask() {}, restoreSeriesTask() {},
    getTaskStoppingText: (task, label) => `正在停止获取数据，已写入 ${task?.writtenCount || 0} 条${label}。请勿关闭插件，关闭会中断数据写入`,
    ElNotification: message => notifications.push(message), ElMessage: message => notifications.push(message),
    showErrorMsg: message => notifications.push({ message, type: 'error' }),
    ...overrides,
  };
  bindings.feishuRequest = config => bindings.request(config);
  function handler(name) {
    const node = declarations.find(n => n.id.name === name)?.init;
    if (!node) return undefined;
    return new Function(...Object.keys(bindings), `return (${source.slice(node.start, node.end)});`)(...Object.values(bindings));
  }
  for (const name of ['profileTaskApiPath', 'seriesTaskApiPath', 'commentTaskApiPath', 'unwrapApiData', 'hideToast', 'showToast', 'showCompletionToast', 'finishToast', 'getStoppingText', 'stoppedCommentProgress', 'getStreamProgressText', 'restoreProfileTask', 'restoreSeriesTask']) {
    const fn = handler(name); if (fn) bindings[name] = fn;
  }
  const callbacks = Object.fromEntries(declarations.find(n => n.id.name === taskName).init.arguments[0].properties
    .filter(n => ['onProgress', 'onWriting', 'onFinish', 'onError'].includes(n.key.name))
    .map(n => [n.key.name, new Function(...Object.keys(bindings), `return (${source.slice(n.value.start, n.value.end)});`)(...Object.values(bindings))]));
  return { feedback, bindings, notifications, handler, callbacks, app };
}

for (const [page, taskName, resumeName, postName, unit] of [
  ['ProfileFetch', 'profileStreamTask', 'resumeSavedStreamTask', 'postProfileTask', '作者作品'],
  ['SeriesFetch', 'seriesStreamTask', 'resumeSeriesTask', 'postSeriesTask', '短剧'],
]) {
  for (const stage of ['new', 'resume']) {
    test(`${page}：${stage === 'new' ? '新建就绪' : '恢复旧任务'}使用对应进度文案并保持可停止`, async t => {
      const task = { taskId: 'task-1', writtenCount: 0 };
      const { feedback: f, bindings: b, handler } = fixture(t, page, taskName, {
        request: async () => ({ data: { sta: 0, data: { task_id: task.taskId } } }),
        normalizeWorkFetchRange: () => ({}),
        [taskName]: {
          submit: async (create, onReady) => onReady(await create()),
          resume: async onRestore => { onRestore(task); return true; },
        },
      });
      if (stage === 'new') await handler(postName)('', 'https://example.com/author');
      else await handler(resumeName)();

      assert.equal(f.toastType.value, 'loading');
      assert.equal(f.toastVisible.value, true);
      assert.equal(b.loading.value, true);
      assert.equal((page === 'ProfileFetch' ? b.activeProfileTaskId : b.activeSeriesTaskId).value, task.taskId);
      assert.equal(b.isCancelling.value, false);
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
}

for (const [page, taskName, resumeName, submitName, unit] of pages) {
  for (const nextState of ['new-stopping', 'same-task']) {
    test(`${page}：停止请求延迟失败不能回写其他任务（${nextState}）`, async t => {
      const pending = defer(), nextStop = defer();
      let active = { taskId: 'old-task', writtenCount: 2 };
      const { feedback: f, bindings: b, callbacks, handler, notifications } = fixture(t, page, taskName, {
        [taskName]: { getActiveTask: () => active },
        request: config => config.data.task_id === 'old-task' ? pending.promise : nextStop.promise,
        activeStreamTask: active, activeSeriesTask: active,
        activeProfileTaskId: ref('old-task'), activeCommentTaskId: ref('old-task'), activeSeriesTaskId: ref('old-task'),
      });
      const cancelName = { ProfileFetch: 'cancelProfileTask', CommentFetch: 'cancelCommentTask', SeriesFetch: 'cancelSeriesTask' }[page];
      b.loading.value = true;
      const oldStop = handler(cancelName)();
      let newStop;
      try {
        if (nextState === 'new-stopping') {
          const old = active; active = null;
          await callbacks.onFinish({ status: 1 }, old);
          active = { taskId: 'new-task', writtenCount: 7 };
          b.activeStreamTask = active; b.activeSeriesTask = active;
          b.activeProfileTaskId.value = b.activeCommentTaskId.value = b.activeSeriesTaskId.value = active.taskId;
          b.loading.value = true;
          newStop = handler(cancelName)();
        }
        pending.reject(new Error('旧任务停止失败'));
        await oldStop;
        if (nextState === 'new-stopping') {
          assert.equal(b.isCancelling.value, true);
          assert.equal(b.loading.value, true);
          assert.equal(f.toastType.value, 'loading');
          assert.match(f.toastText.value, /请勿关闭插件，关闭会中断数据写入/);
          assert.deepEqual(notifications, [], '旧请求不得再弹出停止失败');
        } else {
          assert.equal(b.isCancelling.value, false);
          assert.equal(notifications.length, 1, '当前任务的停止失败仍需报告');
          assert.equal(notifications[0].message, '旧任务停止失败');
        }
      } finally {
        nextStop.resolve({ data: { sta: 0 } }); await newStop;
      }
    });
  }

  test(`${page}：执行进度与停止写入持续保留各自提醒`, async t => {
    const { feedback: f, callbacks, bindings: b } = fixture(t, page, taskName);
    callbacks.onProgress({ status: 0, processed: 1, total: 2 }, { taskId: 'task-1', writtenCount: 4 });
    assert.equal(f.toastLoading.value, true);
    assert.match(f.toastText.value, /请勿关闭插件，关闭将中断任务/);
    b.isCancelling.value = true;
    callbacks.onWriting([{ id: 1 }], { taskId: 'task-1', writtenCount: 4 });
    assert.match(f.toastText.value, /请勿关闭插件，关闭会中断数据写入/);
    assert.equal(f.toastText.value.match(/请勿关闭插件/g).length, 1);
  });

  for (const [status, written, kind, duration] of [[1, 2, 'success', 3000], [1, 0, 'info', 5000], [2, 2, 'error', 5000], [3, 2, 'info', 3000]]) {
    test(`${page}：状态${status}、已写${written}条按${kind}终态显示${duration}毫秒`, async t => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const { feedback: f, callbacks, notifications } = fixture(t, page, taskName);
      await callbacks.onFinish({ status, reason: '平台原始失败原因' }, { taskId: 'task-1', writtenCount: written });
      assert.equal(f.toastType.value, kind);
      assert.doesNotMatch(f.toastText.value, /请勿关闭/);
      if (status === 2) assert.match(f.toastText.value, /平台原始失败原因/);
      else assert.match(f.toastText.value, new RegExp(`已写入 ${written} 条${unit}`));
      assert.equal(notifications.length, 0);
      t.mock.timers.tick(duration - 1); assert.equal(f.toastVisible.value, true);
      t.mock.timers.tick(1); assert.equal(f.toastVisible.value, false);
    });
  }

  test(`${page}：带任务身份的写入异常只浮动一次，5秒后仍保留核对要求`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { feedback: f, callbacks, bindings: b, notifications } = fixture(t, page, taskName);
    const error = Object.assign(new Error('写入超时，请关闭当前插件后重新打开并核对写入结果，勿重复启动任务'), { requiresReopen: true });
    await callbacks.onError(error, { taskId: 'task-1', writtenCount: 2 });
    assert.equal(f.toastType.value, 'error');
    assert.equal(f.toastText.value, error.message);
    assert.equal(b.hasRecoverableTask.value, true);
    assert.equal(b.recoveryRequiresReopen.value, true);
    assert.equal(notifications.length, 0);
    t.mock.timers.tick(5000);
    assert.equal(f.toastVisible.value, false);
    assert.equal(f.taskNotice.value, error.message);
  });

  test(`${page}：恢复读取之前就有加载和互斥，未找到恢复进度退出转圈`, async t => {
    const pending = defer();
    const { feedback: f, bindings: b, handler } = fixture(t, page, taskName, { [taskName]: { resume: () => pending.promise } });
    b.hasRecoverableTask.value = true;
    const running = handler(resumeName)();
    await flush();
    assert.equal(b.isSubmitting.value, true);
    assert.equal(f.toastLoading.value, true);
    assert.equal(f.toastVisible.value, true);
    assert.match(f.toastText.value, /请勿关闭插件/);
    pending.resolve(false); await running;
    assert.equal(b.isSubmitting.value, false);
    assert.equal(b.loading.value, false);
    assert.equal(f.toastLoading.value, false);
    assert.match(f.taskNotice.value, /核对.*表格.*已写入结果.*重试/);
    assert.doesNotMatch(f.taskNotice.value, /关闭|重新(?:打开|进入)/);
  });

  test(`${page}：首次异步链接读取前可见加载，读取异常仅一个出口并退出忙碌`, async t => {
    const pending = defer();
    const { feedback: f, bindings: b, handler, notifications } = fixture(t, page, taskName, {
      formData: ref({ mode: 'table', manualUrls: '', radio: 1, targetType: 'new', profileLinkFieldId: 'link', noteLinkFieldId: 'link', scope: 'all' }),
      bitable: { base: { getActiveTable: () => pending.promise } },
      getRecordIdListByScope: () => pending.promise,
    });
    const running = handler(submitName)(); await flush();
    assert.equal(f.toastVisible.value, true);
    assert.equal(b.isSubmitting.value || b.loading.value, true);
    assert.match(f.toastText.value, /请勿关闭插件/);
    pending.reject(new Error('原始SDK读取失败')); await running;
    assert.equal(f.toastType.value, 'error');
    assert.equal(f.toastText.value, '原始SDK读取失败');
    assert.equal(b.loading.value, false);
    assert.equal(b.isSubmitting.value, false);
    assert.equal(notifications.length, 0);
  });

  if (page !== 'ProfileFetch') {
    test(`${page}：同步必填校验失败不进入启动进度`, async t => {
      const { feedback: f, bindings: b, handler, notifications } = fixture(t, page, taskName);
      b.formData.value.manualUrls = '';
      await handler(submitName)();
      assert.equal(f.toastVisible.value, false);
      assert.equal(b.isSubmitting.value, false);
      assert.equal(notifications.length, 1);
    });
  }
}

for (const [page, taskName, resumeName] of pages) {
  test(`${page}：恢复SDK要求重开时按结构化标记禁用本页恢复`, async t => {
    const error = Object.assign(new Error('读取恢复进度未返回，请重新打开插件'), { requiresReopen: true });
    const { feedback: f, bindings: b, handler } = fixture(t, page, taskName, { [taskName]: { resume: async () => { throw error; } } });
    b.hasRecoverableTask.value = true;
    await handler(resumeName)();
    assert.equal(b.recoveryRequiresReopen.value, true);
    assert.equal(f.noticeRequiresReopen.value, true);
    assert.equal(f.taskNotice.value, error.message);
    assert.equal(b.loading.value, false);
  });
}

test('SeriesFetch：准备字段时持续加载，不提前显示绿色完成', async t => {
  const fields = [];
  const { feedback: f, bindings: b, notifications, handler } = fixture(t, 'SeriesFetch', 'seriesStreamTask', {
    getActiveFieldMapping: () => [{ key: 'series_id', name: '短剧ID', type: 'Text' }],
    bitable: { base: { getTableById: async () => ({ getFieldMetaList: async () => fields, addField: async config => { fields.push({ id: 'id', ...config }); }, getFieldById: async () => ({ type: 'Text', getType: async () => 'Text' }) }) } },
    isFieldTypeCompatible: () => true,
  });
  b.mappingDraft.value = [];
  f.begin('正在校验目标字段...');
  await handler('setupTableFields')('table', false, message => f.progress(message));
  assert.equal(f.toastType.value, 'loading');
  assert.match(f.toastText.value, /请勿关闭插件/);
  assert.equal(notifications.length, 0);
});

for (const [page, taskName, , submitName] of pages) {
  test(`${page}：选中行为空只保留一个顶部原原因，退出准备加载`, async t => {
    const table = { getActiveView: async () => ({ getSelectedRecordIdList: async () => [] }) };
    const { feedback: f, bindings: b, handler, notifications } = fixture(t, page, taskName, {
      formData: ref({ mode: 'table', radio: 1, targetType: 'new', profileLinkFieldId: 'link', noteLinkFieldId: 'link', scope: 'selected' }),
      bitable: { base: { getActiveTable: async () => table } },
    });
    b.getRecordIdListByScope = handler('getRecordIdListByScope');
    await handler(submitName)();
    assert.equal(b.loading.value, false);
    assert.equal(b.isSubmitting.value, false);
    assert.equal(f.toastVisible.value, false);
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].message, '请先在表格中选择至少一行数据');
    assert.equal(notifications[0].duration, 3000);
    assert.equal(notifications[0].plain, true);
  });
}


for (const [page, taskName, , submitName] of pages) {
  test(`${page}：真实提交HTTP未返回时保持反馈和互斥，重复点击不创建第二个请求`, async t => {
    const pending = defer(); let requests = 0;
    const { feedback: f, bindings: b, handler, notifications } = fixture(t, page, taskName, {
      request: () => { requests++; return pending.promise; },
      saveTableOutputConfig: async () => {},
      normalizeWorkFetchRange: value => value,
      [taskName]: { submit: async create => create() },
    });
    const postName = page === 'ProfileFetch' ? 'postProfileTask' : page === 'SeriesFetch' ? 'postSeriesTask' : 'postNoteTask';
    const dataName = page === 'ProfileFetch' ? 'submitProfileUrls' : page === 'SeriesFetch' ? 'submitSeriesUrls' : 'getNoteData';
    b[postName] = handler(postName);
    b[dataName] = handler(dataName);
    const run = handler(submitName)(); await flush();
    assert.equal(requests, 1);
    assert.equal(f.toastVisible.value, true);
    assert.equal(f.toastLoading.value, true);
    assert.equal(b.loading.value, true);
    assert.match(f.toastText.value, /提交.*请勿关闭插件/);
    await handler(submitName)();
    assert.equal(requests, 1);
    pending.resolve({ data: { sta: 1, msg: '原始HTTP任务错误' } }); await run;
    assert.equal(f.toastType.value, 'error');
    assert.equal(f.toastText.value, '原始HTTP任务错误');
    assert.equal(b.loading.value, false);
    assert.equal(b.isSubmitting.value, false);
    assert.equal(notifications.length, 0);
  });

  test(`${page}：真实CTA模板在重开状态渲染禁用及操作要求`, async t => {
    const { callbacks, bindings: b } = fixture(t, page, taskName);
    await callbacks.onError(Object.assign(new Error('原始写入超时'), { requiresReopen: true }), { taskId: 'task-1' });
    const descriptor = parse(fs.readFileSync(new URL(`../src/components/${page}.vue`, import.meta.url), 'utf8')).descriptor;
    let button;
    function visit(node) {
      if (node.tag === 'el-button' && node.props?.some(p => p.type === 7 && p.name === 'on' && p.exp?.content === 'handleTaskAction')) button = node;
      node.children?.forEach(visit);
    }
    descriptor.template.ast.children.forEach(visit);
    assert.ok(button);
    const compiled = compileTemplate({ source: button.loc.source, filename: `${page}.vue`, id: 'actual-task-action' });
    assert.deepEqual(compiled.errors, []);
    const body = compiled.code.replace(/import \{([^}]+)\} from "vue"/, (_, names) => `const {${names.replace(/ as /g, ': ')}} = Vue`).replace('export function render', 'function render');
    const render = new Function('Vue', `${body};return render`)(Vue);
    const app = Vue.createSSRApp({ setup: () => ({ taskActionState: 'recoverable', recoveryRequiresReopen: b.recoveryRequiresReopen, handleTaskAction() {} }), render });
    app.component('el-button', { props: ['disabled'], setup: (props, { slots }) => () => Vue.h('button', { disabled: props.disabled }, slots.default?.()) });
    const html = await renderToString(app);
    assert.match(html, /<button[^>]*disabled/);
    assert.match(html, /请重新进入插件恢复/);
  });
}

for (const [page, taskName] of pages.slice(1)) {
  test(`${page}：选行后切表，提交原表链接并保留顺序、去重和空值过滤`, async t => {
    const links = ['https://example.test/b', '', 'https://example.test/b', 'https://example.test/a'];
    const source = {
      getActiveView: async () => ({ getSelectedRecordIdList: async () => {
        active = { getFieldById: () => { throw new Error('读取了切换后的表'); } };
        return links.map((_, index) => index);
      } }),
      getFieldById: async () => ({ getCell: async id => ({ getValue: async () => links[id] }) }),
    };
    let active = source, submitted;
    const { bindings, handler } = fixture(t, page, taskName, {
      formData: ref({ mode: 'table', radio: 1, profileLinkFieldId: 'link', noteLinkFieldId: 'link', scope: 'selected' }),
      bitable: { base: { getActiveTable: async () => active } },
      getNoteData: async (_, urls) => { submitted = urls; },
      submitSeriesUrls: async urls => { submitted = urls; },
    });
    const comment = page === 'CommentFetch';
    const read = comment ? 'getNoteUrlsByFieldId' : 'getProfileUrlsByFieldId';
    bindings[read] = handler(read);
    bindings.getRecordIdListByScope = handler('getRecordIdListByScope');
    await handler('commit')();
    assert.deepEqual(submitted, [links[0], links[3]]);
  });
}
