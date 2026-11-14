import { extractHttpUrls } from '../src/utils/sourceLinks.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRenderer, defineComponent, h, nextTick, ref } from 'vue';
import { parse } from '@vue/compiler-sfc';
import { parse as parseJS } from '@babel/parser';
import { useTaskFeedback } from '../src/composables/useTaskFeedback.mjs';
import { loadRequestModule, loadRequestService, rejectHttp } from './helpers/requestService.mjs';

const { buildFeishuApiPath } = loadRequestModule();

const pages = ['BloggerInfoFetch', 'VideoDataFetch', 'VideoCopySummary', 'XhsDownload', 'UrlToAttachment'];
const quiet = { log() {}, error() {} };

for (const [page, fetchName] of [['BloggerInfoFetch', 'fetchBloggerInfoByRows'], ['VideoDataFetch', 'fetchVideoDataByRows'], ['VideoCopySummary', 'fetchSummaryByEntries'], ['XhsDownload', 'fetchXhsByRows'], ['UrlToAttachment', 'handleTableModeSubmit']]) {
  for (const status of [401, 403]) {
    test(`${page}经过真实请求层收到HTTP ${status}后不再处理下一条`, async t => {
      const request = loadRequestService(); let calls = 0;
      request.defaults.adapter = config => { calls++; return rejectHttp(config, status); };
      const apiCall = () => request.post('/social/api/example', {});
      const rows = [{ url: 'a', urls: ['a'], recordId: 'r1' }, { url: 'b', urls: ['b'], recordId: 'r2' }];
      const { f, handler } = setup(t, page, {
        request, createMediaTask: apiCall, pollMediaTask: async () => ({}),
        getRecordIdListByScope: async () => ['r1', 'r2'], getCellValuesByFieldId: async () => rows,
        writeDataToRecord: apiCall,
      });
      if (page === 'UrlToAttachment') {
        await handler(fetchName)();
        assert.equal(f.toastType.value, 'error');
        assert.match(f.toastText.value, /测试 API Key 已失效/);
      } else {
        await assert.rejects(handler(fetchName)(rows), { code: 'INVALID_API_KEY' });
      }
      assert.equal(calls, 1);
      assert.doesNotMatch(f.taskNotice.value, /整批任务继续执行/);
    });
  }
}
function feedback(t) {
  let f;
  const renderer = createRenderer({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}), insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {}, parentNode() {}, nextSibling() {} });
  const app = renderer.createApp(defineComponent({ setup() { f = useTaskFeedback(); return () => h('div'); } }));
  app.mount({});
  t.after(() => app.unmount());
  return f;
}
function extract(page, name, bindings) {
  // 行反馈单测使用已挂载前提；卸载边界由完整 SFC 生命周期回归验证。
  bindings = { assertMounted: value => value, isUnmounted: false, componentUnmounted: false, tableConfigSaveSequence: 0, tableConfigSaveRevisions: new Map(), tableConfigSaves: new Map(), ensureOutputConfigReady: async () => true, ...bindings };
  bindings.buildFeishuApiPath ??= buildFeishuApiPath;
  bindings.feishuRequest ??= config => bindings.request(config);
  const source = parse(fs.readFileSync(new URL(`../src/components/${page}.vue`, import.meta.url), 'utf8')).descriptor.scriptSetup.content;
  const declarations = parseJS(source, { sourceType: 'module' }).program.body.filter(n => n.type === 'VariableDeclaration').flatMap(n => n.declarations);
  const node = declarations.find(n => n.id.name === name)?.init;
  assert.ok(node, `${page}.${name} exists`);
  return new Function(...Object.keys(bindings), `return (${source.slice(node.start, node.end)});`)(...Object.values(bindings));
}
function setup(t, page, overrides = {}) {
  const f = feedback(t);
  const bindings = {
    ensureMainTableOutputConfig: async () => false,
    taskFeedback: f, ...f, nextTick, props: { api_key: 'test' }, console: quiet,
    loading: ref(false), stopRequested: ref(false), fieldSelectionReady: ref(true), sourceFieldLoading: ref(false), sourceFieldLoadError: ref(''), mappingDraft: ref([]), writeMode: ref('append'), selectedFieldKeys: ref(['a']),
    formData: ref({ mode: 'table', scope: 'all', profileLinkFieldId: 'f', videoLinkFieldId: 'f', xhsLinkFieldId: 'f', urlFieldId: 'f', targetType: 'current', writeMode: 'append' }),
    validateBaseForm: () => true, cloneFieldMappings: value => value, getActiveFieldConfigs: () => [{ key: 'a' }],
    validateConfiguredInputFilter: async () => null, getRecordIdListByScope: async () => [],
    getCellValuesByFieldId: async () => [], getRecordEntriesByFieldId: async () => [],
    getTableAttachmentFieldConfigs: async () => [], validateAndAddFields: async () => ({}),
    bitable: { base: { getActiveTable: async () => ({ id: 'source' }) } },
    ElNotification: () => assert.fail('任务反馈不能重复通知'), ElMessage: () => assert.fail('任务反馈不能重复通知'),
    ...overrides,
  };
  if (page === 'UrlToAttachment') bindings.isAttachmentUrl = extract(page, 'isAttachmentUrl', bindings);
  for (const name of ['showToast', 'hideToast', 'finishToast', 'showExecutionProgress']) {
    try { bindings[name] = extract(page, name, bindings); } catch (error) { if (name !== 'finishToast' && name !== 'showExecutionProgress') throw error; }
  }
  return { f, bindings, handler: name => extract(page, name, bindings) };
}

for (const page of ['VideoDataFetch', 'BloggerInfoFetch', 'ProfileFetch']) {
  test(`${page}: 输出配置未读到时提示重新加载，加载成功后同页保存且不覆盖旧配置`, async () => {
    const writes = [];
    const b = {
      mainOutputTableId: ref('target'), taskDialogVisible: ref(false), taskOutputTableId: ref('target'),
      tableConfigsLoaded: ref(false), loadedTableConfigs: ref(new Set()),
      persistTableOutputConfig: async config => { writes.push(config); return true; },
    };
    const save = extract(page, 'saveTableOutputConfig', b);
    const config = { targetType: 'existing', targetTableId: 'target', fieldMappings: [], targetFieldOptions: [], writeMode: 'upsert' };
    await assert.rejects(save(config), error => {
      assert.match(error.message, /输出表配置.*重试加载后再保存/);
      assert.doesNotMatch(error.message, /关闭|重新(?:打开|进入)/);
      return true;
    });
    assert.deepEqual(writes, []);
    b.tableConfigsLoaded.value = true; b.loadedTableConfigs.value.add('target');
    assert.equal(await save(config), true);
    assert.deepEqual(writes.map(({ saveRevision, ...config }) => config), [{ targetTableId: 'target', writeMode: 'upsert', fieldMappings: [] }]);
  });
}
for (const page of pages) {
  test(`${page}: 需重开的错误在提示消失后仍禁止按钮重新启动`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let starts = 0;
    const { f, handler } = setup(t, page, { handleSubmit: () => { starts++; } });
    f.fail(Object.assign(new Error('写入结果待核对，请重新进入插件'), { requiresReopen: true }));
    t.mock.timers.tick(5000);
    await handler('handleTaskAction')();
    assert.equal(starts, 0);
    assert.equal(f.noticeRequiresReopen.value, true);
    assert.match(f.taskNotice.value, /写入结果待核对/);
  });

  test(`${page}: delayed first SDK shows busy feedback before reading and rejects repeat submit`, async t => {
    let release;
    const boundary = new Promise(resolve => { release = resolve; });
    const { f, bindings: b, handler } = setup(t, page, {
      bitable: { base: { getActiveTable: () => boundary } }, getRecordIdListByScope: () => boundary,
    });
    const run = handler('handleTableModeSubmit');
    const pending = run();
    await nextTick();
    assert.equal(b.loading.value, true);
    assert.equal(f.toastLoading.value, true);
    assert.equal(f.toastVisible.value, true);
    assert.match(f.toastText.value, /请勿关闭插件，关闭将中断任务/);
    const before = f.toastText.value;
    await run();
    assert.equal(f.toastText.value, before);
    release(null);
    await pending;
    assert.equal(b.loading.value, false);
    assert.equal(f.toastLoading.value, false);
  });
}
for (const page of ['BloggerInfoFetch', 'VideoDataFetch']) {
  test(`${page}: zero filter matches ends neutral and clears busy state`, async t => {
    const { f, bindings: b, handler } = setup(t, page, {
      getRecordIdListByScope: async () => ['r1'], validateConfiguredInputFilter: async () => ({}), filterRecordIds: async () => [],
    });
    await handler('handleTableModeSubmit')();
    assert.equal(b.loading.value, false);
    assert.equal(f.toastLoading.value, false);
    assert.equal(f.toastType.value, 'info');
    assert.equal(f.toastText.value, '没有符合筛选条件的数据');
  });
}
for (const [page, fetchName] of [['BloggerInfoFetch', 'fetchBloggerInfoByRows'], ['VideoDataFetch', 'fetchVideoDataByRows'], ['VideoCopySummary', 'fetchSummaryByEntries'], ['XhsDownload', 'fetchXhsByRows']]) {
  test(`${page}: row failure preserves loading while next request continues, fatal key aborts`, async t => {
    let calls = 0, release;
    const { f, bindings: b, handler } = setup(t, page, {
      request: async () => { calls++; if (calls === 1) throw new Error('真实原因'); return new Promise(resolve => { release = () => resolve({ data: { sta: 0, data: {} } }); }); },
      createMediaTask: async () => { calls++; if (calls === 1) throw new Error('真实原因'); return new Promise(resolve => { release = () => resolve({ task_id: 't' }); }); },
      pollMediaTask: async () => ({}),
    });
    const pending = handler(fetchName)([{ url: 'a' }, { url: 'b' }]);
    await nextTick(); await nextTick();
    assert.equal(calls, 2);
    assert.equal(f.toastLoading.value, true);
    assert.match(f.toastText.value, /请勿关闭插件/);
    assert.match(f.taskNotice.value, /第 1 条处理失败：真实原因，整批任务继续执行/);
    release();
    const result = await pending;
    assert.equal(result.successCount, 1); assert.equal(result.failCount, 1);
    calls = 0;
    b.request = b.createMediaTask = async () => { calls++; throw Object.assign(new Error('密钥失效'), { code: 'INVALID_API_KEY' }); };
    await assert.rejects(handler(fetchName)([{ url: 'a' }, { url: 'b' }]), { code: 'INVALID_API_KEY' });
    assert.equal(calls, 1);
  });
}
for (const page of pages) {
  for (const [successCount, failCount, kind, duration] of [[2, 1, 'warning', 5000], [0, 1, 'warning', 5000], [2, 0, 'info', 3000]]) {
    test(`${page}: stopped ${successCount}/${failCount} preserves counts and correct duration`, async t => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const { f, handler } = setup(t, page);
      handler('showToast')(`任务已停止：成功 ${successCount} 条，失败 ${failCount} 条`, false, { stopped: true, successCount, failCount });
      assert.equal(f.toastType.value, kind);
      assert.doesNotMatch(f.toastText.value, /请勿关闭/);
      t.mock.timers.tick(duration - 1); assert.equal(f.toastVisible.value, true);
      t.mock.timers.tick(1); assert.equal(f.toastVisible.value, false);
    });
  }
}

for (const [page, fetchName] of [['BloggerInfoFetch', 'fetchBloggerInfoByRows'], ['VideoDataFetch', 'fetchVideoDataByRows'], ['VideoCopySummary', 'fetchSummaryByEntries'], ['XhsDownload', 'fetchXhsByRows']]) {
  for (const [successCount, failCount, kind] of [[2, 1, 'warning'], [0, 1, 'warning'], [2, 0, 'info']]) {
    test(`${page}: actual submission forwards stopped ${successCount}/${failCount} classification`, async t => {
      const { f, handler } = setup(t, page, {
        getRecordIdListByScope: async () => ['r'], getCellValuesByFieldId: async () => [{ url: 'a' }], getRecordEntriesByFieldId: async () => [{ url: 'a' }],
        [fetchName]: async () => ({ stopped: true, successCount, failCount }),
      });
      await handler('handleTableModeSubmit')();
      assert.equal(f.toastText.value, `任务已停止：成功 ${successCount} 条，失败 ${failCount} 条`);
      assert.equal(f.toastType.value, kind);
    });
  }
}

test('链接转附件：无效行不请求，下一行仅转换有效链接并写回原行', async t => {
  const requests = [], writes = [];
  const valid = 'https://example.test/image';
  const field = { setValue: async (id, files) => writes.push([id, files.map(file => file.name)]) };
  const { f, bindings: b, handler } = setup(t, 'UrlToAttachment', {
    getRecordIdListByScope: async () => ['r1', 'r2'],
    getCellValuesByFieldId: async () => [{ recordId: 'r1', urls: ['https://'] }, { recordId: 'r2', urls: ['https://?x', valid] }],
    getTableAttachmentFieldConfigs: async () => [{ key: 'attachment' }],
    bitable: { base: { getActiveTable: async () => ({ getField: async () => field }) } },
    resolveAttachmentFieldId: () => 'attachment', resolveWritableField: async () => ({ field }),
    ATTACHMENT_BATCH_SIZE: 20,
    request: async ({ data }) => {
      assert.match(f.taskNotice.value, /第 1 条处理失败：没有可转换的有效链接/);
      requests.push(data.links);
      return { data: { sta: 0, data: [{ name: 'image.png', content: 'sample' }] } };
    },
    fetch: async () => new Response(new Blob(['image'])),
  });
  b.convertUrlsToAttachments = handler('convertUrlsToAttachments');
  b.writeDataToRecord = handler('writeDataToRecord');
  await handler('handleTableModeSubmit')();
  assert.deepEqual(requests, [[valid]]);
  assert.deepEqual(writes, [['r2', ['image.png']]]);
  assert.equal(f.toastText.value, '处理完成：成功 1 条，失败 1 条');
});

test('UrlToAttachment: first record failure keeps second record running and fatal key ends the batch', async t => {
  let calls = 0, release;
  const { f, bindings: b, handler } = setup(t, 'UrlToAttachment', {
    getRecordIdListByScope: async () => ['r1', 'r2'],
    getCellValuesByFieldId: async () => [{ recordId: 'r1', urls: ['a'] }, { recordId: 'r2', urls: ['b'] }],
    writeDataToRecord: async () => { calls++; if (calls === 1) throw new Error('附件下载失败'); return new Promise(resolve => { release = resolve; }); },
  });
  const pending = handler('handleTableModeSubmit')();
  for (let i = 0; i < 10 && !release; i++) await nextTick();
  assert.equal(calls, 2);
  assert.equal(b.loading.value, true);
  assert.equal(f.toastLoading.value, true);
  assert.match(f.toastText.value, /请勿关闭插件/);
  assert.match(f.taskNotice.value, /第 1 条处理失败：附件下载失败，整批任务继续执行/);
  release(); await pending;
  assert.equal(f.toastText.value, '处理完成：成功 1 条，失败 1 条');
  assert.equal(f.toastType.value, 'warning');
  calls = 0;
  b.writeDataToRecord = async () => { calls++; throw Object.assign(new Error('密钥失效'), { code: 'INVALID_API_KEY' }); };
  await handler('handleTableModeSubmit')();
  assert.equal(calls, 1);
  assert.equal(f.toastText.value, '密钥失效');
  assert.equal(f.toastType.value, 'error');
});

test('UrlToAttachment: stop after a failed record retains the real 0/1 summary', async t => {
  const { f, bindings: b, handler } = setup(t, 'UrlToAttachment', {
    getRecordIdListByScope: async () => ['r1', 'r2'],
    getCellValuesByFieldId: async () => [{ recordId: 'r1', urls: ['a'] }, { recordId: 'r2', urls: ['b'] }],
  });
  b.writeDataToRecord = async () => { b.stopRequested.value = true; throw new Error('失败'); };
  await handler('handleTableModeSubmit')();
  assert.equal(f.toastText.value, '任务已停止：成功 0 条，失败 1 条');
  assert.equal(f.toastType.value, 'warning');
});

test('XhsDownload: manual all-row failures report original counts without creating an empty target', async t => {
  const { f, bindings: b, handler } = setup(t, 'XhsDownload', {
    parseManualUrls: () => ['a'], fetchXhsByRows: async () => ({ successList: [], successCount: 0, failCount: 1, stopped: false }),
    resolveTargetTableId: () => assert.fail('全部获取失败不创建目标表'),
  });
  b.formData.value = { mode: 'manual', manualUrls: 'a', targetType: 'new' };
  await handler('handleManualModeSubmit')();
  assert.equal(f.toastText.value, '处理完成：成功 0 条，失败 1 条');
  assert.equal(f.toastType.value, 'error');
});

for (const page of pages) {
  for (const targetType of ['new', 'existing']) {
    test(`${page}: manual ${targetType} starts feedback before delayed async preparation`, async t => {
      let release;
      const boundary = new Promise(resolve => { release = resolve; });
      const { f, bindings: b, handler } = setup(t, page, {
        parseManualUrls: () => ['a'], extractHttpUrls,
        getWriteFieldConfigs: () => [{ key: 'a' }],
        resolveTargetTableId: () => boundary, fetchXhsByRows: () => boundary,
      });
      b.formData.value = { mode: 'manual', manualUrls: 'https://example.test/a', targetType, targetTableId: 't' };
      const pending = handler('handleManualModeSubmit')();
      await nextTick();
      assert.equal(b.loading.value, true);
      assert.equal(f.toastLoading.value, true);
      assert.match(f.toastText.value, /请勿关闭插件/);
      release(page === 'XhsDownload' ? { successList: [], successCount: 0, failCount: 0, stopped: false } : null);
      await pending;
      assert.equal(b.loading.value, false);
      assert.equal(f.toastLoading.value, false);
    });
  }
}

for (const page of ['BloggerInfoFetch', 'VideoDataFetch', 'VideoCopySummary', 'XhsDownload']) {
  test(`${page}: real preparation failure has a single error and keeps reopen instructions after timeout`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const error = Object.assign(new Error('写入失败，请重新打开并核对表格，勿重复启动'), { requiresReopen: true });
    const { f, handler } = setup(t, page, {
      getRecordIdListByScope: async () => ['r'], getCellValuesByFieldId: async () => [{ url: 'a' }], getRecordEntriesByFieldId: async () => [{ url: 'a' }],
      validateAndAddFields: async () => { throw error; },
    });
    await handler('handleTableModeSubmit')();
    assert.equal(f.toastType.value, 'error');
    assert.match(f.toastText.value, /写入失败，请重新打开并核对表格，勿重复启动/);
    t.mock.timers.tick(5000);
    assert.equal(f.toastVisible.value, false);
    assert.match(f.taskNotice.value, /写入失败，请重新打开并核对表格，勿重复启动/);
    assert.equal(f.noticeRequiresReopen.value, true);
  });
}

for (const page of pages) {
  test(`${page}: duplicate submit cannot clear a stop already requested`, async t => {
    const { bindings: b, handler } = setup(t, page, {
      handleTableModeSubmit: () => assert.fail('运行中不重复提交'), handleManualModeSubmit: () => assert.fail('运行中不重复提交'),
    });
    b.loading.value = true;
    b.stopRequested.value = true;
    await handler('handleSubmit')();
    assert.equal(b.stopRequested.value, true);
  });
}

for (const page of pages) {
  test(`${page}: configuration load failure uses one plain top message for five seconds`, async t => {
    const notices = [];
    const { f, handler } = setup(t, page, {
      tableOptions: ref([]),
      bitable: { base: { getTableList: async () => { throw new Error('配置断开'); }, getTableMetaList: async () => { throw new Error('配置断开'); } } },
      ElMessage: notice => notices.push(notice),
    });
    await handler('loadTableOptions')();
    assert.equal(notices.length, 1);
    assert.equal(notices[0].type, 'error');
    assert.equal(notices[0].plain, true);
    assert.equal(notices[0].duration, 5000);
    assert.equal(f.toastVisible.value, false);
  });
}

test('XhsDownload: field creation failure rethrows the real SDK error during execution', async t => {
  const error = new Error('SDK字段创建原始异常');
  const config = { key: 'a', name: '字段', type: 1 };
  const { bindings: b, handler } = setup(t, 'XhsDownload', {
    bitable: { base: { getTableById: async () => ({ getFieldList: async () => [], addField: async () => { throw error; } }) } },
  });
  b.loading.value = true;
  await assert.rejects(handler('validateAndAddFields')('t', [config]), value => value === error);
});

test('VideoDataFetch: 输出作品链接类型不匹配后按钮不锁死，修正后同页重新执行', async t => {
  const config = { key: 'note_url', name: '作品链接', type: 1 };
  let fieldType = 15, reads = 0, fetches = 0;
  const table = {
    id: 'source',
    getFieldList: async () => { reads++; return [{ id: 'f', type: fieldType, getName: async () => '作品链接', getType: async () => fieldType }]; },
    getFieldById: async () => ({ id: 'f', type: fieldType }),
  };
  const { f, bindings: b, handler } = setup(t, 'VideoDataFetch', {
    bitable: { base: { getActiveTable: async () => table, getTableById: async () => table } },
    getActiveFieldConfigs: () => [config], getRecordIdListByScope: async () => ['record'],
    getCellValuesByFieldId: async () => [{ __recordId: 'record', url: 'https://example.com/note' }],
    fetchVideoDataByRows: async () => { fetches++; return { successCount: 1, failCount: 0, stopped: false }; },
    resolveFieldMetaByConfig: byName => ({ matchedName: '作品链接', fieldMeta: byName.get('作品链接') }),
    isFieldTypeCompatible: type => type === 1, getExpectedFieldTypeName: () => '文本',
  });
  b.validateAndAddFields = handler('validateAndAddFields');
  const run = handler('handleTableModeSubmit');
  await run();
  assert.match(f.toastText.value, /输出字段"作品链接" 类型不匹配.*修正目标字段类型后重试/);
  assert.doesNotMatch(f.toastText.value, /重新(?:进入|打开)|关闭/);
  assert.equal(f.noticeRequiresReopen.value, false);
  assert.equal(b.loading.value, false);
  assert.equal(fetches, 0);

  fieldType = 1;
  await run();
  assert.equal(reads, 2);
  assert.equal(fetches, 1);
  assert.equal(f.toastType.value, 'success');
  assert.equal(f.noticeRequiresReopen.value, false);
  assert.equal(b.loading.value, false);
});

for (const page of pages) {
  for (const mapped of page === 'BloggerInfoFetch' ? [false] : [false, true]) {
    test(`${page}: SDK字段对象类型缓存不影响${mapped ? '显式映射' : '同名字段'}修正后的同页校验`, async t => {
      let currentType = 2;
      const notices = [];
      const field = { id: 'f', type: 2, getName: async () => '标题', getType: async () => currentType };
      const table = { getFieldList: async () => [field], getFieldById: async () => field };
      const { bindings: b, handler } = setup(t, page, {
        bitable: { base: { getTableById: async () => table } },
        resolveFieldMetaByConfig: byName => ({ matchedName: '标题', fieldMeta: byName.get('标题') }),
        isFieldTypeCompatible: type => type === 1, getExpectedFieldTypeName: () => '文本',
        getAllowedFieldTypes: () => [1], FIELD_TYPE_NAME: { 1: '文本' },
        ElMessage: notice => notices.push(notice),
      });
      b.mappingDraft.value = mapped ? [{ source_key: 'title', target_field_id: 'f' }] : [];
      const validate = handler('validateAndAddFields');
      const config = { key: 'title', name: '标题', type: 1 };
      const args = page === 'BloggerInfoFetch' ? ['table', [config]] : ['table', [config], b.mappingDraft.value];
      assert.equal(await validate(...args), null);
      assert.equal(notices[0].duration, 8000);
      b.loading.value = true;
      await assert.rejects(validate(...args), /类型/);
      currentType = 1;
      const mapping = await validate(...args);
      assert.equal(mapping['标题'], 'f');
      assert.equal(field.type, 2, '模拟SDK仍返回原字段对象，必须读取实时类型');
    });
  }
}

for (const page of pages) {
  test(`${page}: synchronous required-field rejection is a single plain three-second message`, async t => {
    const notices = [];
    const { f, bindings: b, handler } = setup(t, page, { props: { api_key: '' }, ElMessage: notice => notices.push(notice) });
    if (['BloggerInfoFetch', 'VideoDataFetch'].includes(page)) {
      b.validateBaseForm = handler('validateBaseForm');
    }
    await handler('handleTableModeSubmit')();
    assert.equal(notices.length, 1);
    assert.equal(notices[0].plain, true);
    assert.equal(notices[0].duration, 3000);
    assert.equal(f.toastVisible.value, false);
    assert.equal(b.loading.value, false);
  });
}

test('作品详情写入失败只显示一次行号，保留原因并继续下一条', async t => {
  const { f, handler } = setup(t, 'VideoDataFetch', {
    request: async () => ({ data: { sta: 0, data: {} } }),
  });
  const rows = [{ recordId: 'first', url: 'a' }, { recordId: 'second', url: 'b' }];
  const result = await handler('fetchVideoDataByRows')(rows, {
    onSuccess: async (_, index) => { if (index === 0) throw new Error('字段不存在'); },
  });
  assert.deepEqual(result, { successCount: 1, failCount: 1, stopped: false });
  assert.equal(f.taskNotice.value, '第 1 条处理失败：数据写入失败：字段不存在，整批任务继续执行。');
});

for (const [page, method] of [
  ['BloggerInfoFetch', 'fetchBloggerInfoByRows'], ['VideoCopySummary', 'fetchSummaryByEntries'],
  ['XhsDownload', 'fetchXhsByRows'], ['UrlToAttachment', 'handleTableModeSubmit'],
]) {
  test(`${page}：HTTP 500 优先显示后端原因并继续处理下一条`, async t => {
    const http = loadRequestService();
    let calls = 0;
    http.defaults.adapter = async config => {
      if (++calls === 1) return rejectHttp(config, 500, '上游服务暂不可用');
      return { status: 200, data: { sta: 0, data: {} }, config };
    };
    const rows = [{ url: 'a', urls: ['a'], recordId: 'r1' }, { url: 'b', urls: ['b'], recordId: 'r2' }];
    const notices = [];
    const request = async () => {
      if (calls === 1) notices.push(f.taskNotice.value);
      return http.post('/social/api/example', {});
    };
    const { f, handler } = setup(t, page, {
      request, createMediaTask: async () => { await request(); return { task_id: 't' }; },
      pollMediaTask: async () => ({}), writeDataToRecord: request,
      getRecordIdListByScope: async () => rows.map(row => row.recordId), getCellValuesByFieldId: async () => rows,
    });
    const result = await handler(method)(rows);
    assert.deepEqual(notices, ['第 1 条处理失败：上游服务暂不可用，整批任务继续执行。']);
    assert.equal(calls, 2);
    if (page === 'UrlToAttachment') assert.equal(f.toastText.value, '处理完成：成功 1 条，失败 1 条');
    else { assert.equal(result.successCount, 1); assert.equal(result.failCount, 1); }
  });
}

const xhsVideoUrl = 'https://sns-video-al.xhscdn.com/stream/1/110/258/01e8980dabb24d2c010370019891faf66c_258.mp4?v=2';
for (const [label, content, noReferrer] of [
  ['小红书视频', xhsVideoUrl, true],
  ['小红书图片', 'https://sns-img-qc.xhscdn.com/cover.png', true],
  ['大小写域名', 'https://SNS-VIDEO-AL.XHSCDN.COM/video.mp4', true],
  ['转存地址', 'https://files.example.test/cover.png', false],
  ['相似域名', 'https://xhscdn.com.example.test/video.mp4', false],
  ['用户名相似', 'https://sns-video-al.xhscdn.com@files.example.test/video.mp4', false],
  ['查询含小红书域名', 'https://files.example.test/video.mp4?source=sns-video-al.xhscdn.com', false],
]) {
  test(`链接转附件：${label}按返回地址决定 Referer，不改接口请求和附件名称`, async t => {
    const requests = [], downloads = [];
    const { handler } = setup(t, 'UrlToAttachment', {
      ATTACHMENT_BATCH_SIZE: 5,
      request: async config => { requests.push(config); return { data: { sta: 0, data: [{ name: 'result.mp4', content }] } }; },
      fetch: async (url, options) => {
        downloads.push({ url, options });
        assert.deepEqual(options, noReferrer ? { referrerPolicy: 'no-referrer' } : undefined);
        return new Response(new Blob(['media'], { type: 'video/mp4' }));
      },
    });
    const files = await handler('convertUrlsToAttachments')([xhsVideoUrl]);
    assert.deepEqual(requests.map(r => r.data), [{ links: [xhsVideoUrl] }]);
    assert.equal(requests[0].headers.authorization, 'Bearer test');
    assert.equal(downloads.length, 1);
    assert.equal(downloads[0].url, content);
    assert.equal(files.length, 1);
    assert.equal(files[0].name, 'result.mp4');
    assert.equal(files[0].type, 'video/mp4');
    assert.equal(await files[0].text(), 'media');
  });
}

test('链接转附件：小红书仍返回403时保留下载原错，不伪报附件成功', async t => {
  const { handler } = setup(t, 'UrlToAttachment', {
    ATTACHMENT_BATCH_SIZE: 5,
    request: async () => ({ data: { sta: 0, data: [{ name: 'video.mp4', content: xhsVideoUrl }] } }),
    fetch: async () => new Response('Forbidden', { status: 403 }),
  });
  await assert.rejects(handler('convertUrlsToAttachments')([xhsVideoUrl]), /读取附件失败: HTTP 403/);
});
