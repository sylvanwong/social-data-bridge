import { resolveWritableField } from '../src/utils/tableFields.js';
import { nextTick } from 'vue';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from '@vue/compiler-sfc';
import { parse as parseJS } from '@babel/parser';

const source = parse(fs.readFileSync(new URL('../src/components/CommentFetch.vue', import.meta.url), 'utf8')).descriptor.scriptSetup.content;
const declarations = parseJS(source, { sourceType: 'module' }).program.body
  .filter(node => node.type === 'VariableDeclaration').flatMap(node => node.declarations);
const stopTextSource = fs.readFileSync(new URL('../src/utils/taskStopText.js', import.meta.url), 'utf8').replace('export const', 'const');
const getTaskStoppingText = new Function(`${stopTextSource}; return getTaskStoppingText;`)();
function load(name, bindings = {}) {
  if (name === 'resumeCommentTask') {
    bindings.isCancelling ??= { value: false };
    bindings.stoppedCommentProgress ??= load('stoppedCommentProgress', { getTaskStoppingText });
  }
  if (name === 'createAndWriteData') {
    bindings.getAllowedFieldTypes ??= load('getAllowedFieldTypes', bindings);
    bindings.isFieldTypeCompatible ??= load('isFieldTypeCompatible', bindings);
  }
  const node = declarations.find(node => node.id.name === name).init;
  bindings = { resolveWritableField, nextTick, ...bindings };
  bindings.feedback ??= { begin() {}, progress() {}, finish: (text, options) => bindings.showCompletionToast?.(text, options), fail: error => bindings.showErrorMsg?.(error?.message || error), hide() {} };
  return new Function(...Object.keys(bindings), `const ${name} = ${source.slice(node.start, node.end)}; return ${name};`)(...Object.values(bindings));
}
const batchNode = declarations.find(node => node.id.name === 'commentStreamTask').init.arguments[0].properties
  .find(node => node.key.name === 'writeBatch').value;
const engineSource = fs.readFileSync(new URL('../src/composables/useIncrementalTask.js', import.meta.url), 'utf8')
  .replace(/^import .*;\n/, '').replace('export const useIncrementalTask', 'const useIncrementalTask');

function fixture({ committedBeforeFailure = 1, mode = 'append', status = 3, mapped = false, newTable = false, operationTimeoutMs = 0 } = {}) {
  let saved, hangWrite = false, failWrite = true, failSave = false, failScan = false, failUpdate = false, failSetup = newTable, createdTables = 0, id = 0, scans = 0;
  const rows = [], writes = [], updates = [], errors = [], finished = [];
  const cidField = mapped ? 'custom-cid' : 'cid';
  const configs = [
    { key: 'cid', name: '评论ID', type: 'text', required: true, getValue: item => item.cid },
    { key: 'text', name: '评论内容', type: 'text', getValue: item => item.text },
  ];
  const selectedFieldKeys = { value: ['cid', 'text'] };
  configs.push({ key: 'nickname', name: '评论者名称', type: 'text', getValue: item => item.nickname });
  const fields = new Map(configs.filter(config => config.key !== 'nickname').map(config => {
    const fieldId = config.key === 'cid' ? cidField : config.key;
    return [fieldId, { id: fieldId, name: config.name, getType: async () => 'text',
      createCell: async value => ({ fieldId, getValue: async () => value }) }];
  }));
  const table = { id: 'table',
    getFieldMetaList: async () => [...fields.values()].map(field => ({ id: field.id, name: field.name })),
    getFieldById: async key => { if (!fields.has(key)) throw new Error('field missing'); return fields.get(key); },
    addField: async config => {
      const key = config.name === '评论ID' ? cidField : configs.find(item => item.name === config.name).key;
      fields.set(key, { id: key, name: config.name, getType: async () => 'text',
        createCell: async value => ({ fieldId: key, getValue: async () => value }) });
      return key;
    },
    getRecordsByPage: async ({ pageToken }) => {
      scans++;
      if (failScan) throw new Error('scan failed');
      const offset = Number(pageToken || 0);
      // 多页返回，评论 ID 使用 SDK 富文本形态。
      const records = rows.slice(offset, offset + 1).map(row => ({ ...row,
        fields: { ...row.fields, [cidField]: [{ text: row.fields[cidField] }] } }));
      return { records, hasMore: offset + 1 < rows.length, pageToken: String(offset + 1) };
    },
    addRecords: async records => {
      writes.push(records.length);
      const created = [];
      const accepted = failWrite ? records.slice(0, committedBeforeFailure) : records;
      for (const record of accepted) {
        const values = {};
        for (const cell of record) values[cell.fieldId] = await cell.getValue();
        const row = { recordId: `r${++id}`, fields: values }; rows.push(row); created.push(row);
      }
      if (failWrite) {
        failWrite = false;
        if (hangWrite) return new Promise(() => {});
        throw new Error('SDK response lost');
      }
      return created.map(record => record.recordId);
    },
    setRecords: async records => {
      updates.push(...records);
      if (failUpdate) { failUpdate = false; throw new Error('update failed'); }
      for (const record of records) Object.assign(rows.find(row => row.recordId === record.recordId).fields, record.fields);
      return records.map(record => record.recordId);
    },
  };
  const bitable = { ui: { switchToTable: async () => {} }, bridge: {
    setData: async (_, task) => { if (typeof failSave === 'function' ? failSave(task) : failSave && task.cursor) throw new Error('save failed'); saved = structuredClone(task); },
    getData: async () => structuredClone(saved),
  }, base: { getSelection: async () => ({ baseId: 'base' }), getTableById: async () => table,
    getTable: async () => { if (failSetup) { failSetup = false; throw new Error('setup failed'); } return table; },
  } };
  const bindings = { getActiveFieldConfigs: load('getActiveFieldConfigs', { FIELD_CONFIG: configs, selectedFieldKeys }), buildFieldPayload: config => config,
    getFieldInstanceMapByConfigs: load('getFieldInstanceMapByConfigs'), bitable,
    createSequentialTable: async () => { createdTables++; fields.clear(); return { tableId: 'table' }; },
    mappingDraft: { value: [] }, normalizeCommentId: load('normalizeCommentId'), normalizeFieldValue: value => value,
    commentUpsertIndexCache: new Map(), chunkRecords: load('chunkRecords'), FieldType: { Text: 'text' },
    console: { error() {} }, ElMessage() {}, resetParams() {},
  };
  const items = ['a', 'b', 'c', 'd'].map(cid => ({ cid, text: `内容${cid}` }));
  function open(callbacks = {}) {
    const timers = new Map(); let timerId = 0;
    const create = new Function('bitable', 'setTimeout', 'clearTimeout', `${engineSource}; return useIncrementalTask;`)(bitable,
      (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; }, key => timers.delete(key));
    const writeBatch = new Function('createAndWriteData', 'showFieldProgress', 'normalizeCommentId', `return (${source.slice(batchNode.start, batchNode.end)});`)(
      load('createAndWriteData', bindings), () => {}, bindings.normalizeCommentId);
    const task = create({ storageKey: 'test', writeBatch, operationTimeoutMs,
      getStatus: async () => ({ status }), isTerminal: result => [1, 2, 3].includes(result.status),
      getResults: async task => { const start = Number(task.cursor || 0); return {
        items: items.slice(start, start + 2), next_cursor: String(Math.min(start + 2, items.length)), has_more: start + 2 < items.length,
      }; },
      onError: (error, task) => { errors.push(error); return callbacks.onError?.(error, task); },
      onFinish: (status, task) => { finished.push(task.writtenCount); return callbacks.onFinish?.(status, task); },
    });
    return { task, timers,
      tick: async () => { const [key, timer] = [...timers].find(([, timer]) => timer.delay < 60000); timers.delete(key); await timer.fn(); },
      expireWrite: () => { const [key, timer] = [...timers].find(([, timer]) => timer.delay >= 60000); timers.delete(key); timer.fn(); },
    };
  }
  return { open, rows, writes, updates, errors, finished, items, fields, selectedFieldKeys, scans: () => scans,
    saved: () => structuredClone(saved), seedSaved: value => { saved = structuredClone(value); }, failSave: value => { failSave = value; }, failScan: value => { failScan = value; },
    succeedWrites: () => { failWrite = false; }, failAgain: () => { failWrite = true; },
    hangWrite: () => { hangWrite = true; }, failUpdate: () => { failUpdate = true; }, createdTables: () => createdTables,
    initial: { taskId: 'task', pendingCommentWrite: false, targetTableId: newTable ? '' : 'table', writeMode: mode,
      fieldMappings: mapped ? [{ source_key: 'cid', target_field_id: cidField }] : [] },
    ids: () => rows.map(row => row.fields[cidField]),
  };
}

for (const committedBeforeFailure of [0, 1, 2]) {
  test(`异常批次已写 ${committedBeforeFailure} 条：重新打开按评论 ID 补齐，停止后的剩余结果全部写完`, async () => {
    const f = fixture({ committedBeforeFailure, mapped: true });
    const first = f.open(); await first.task.start(f.initial);
    assert.equal(first.timers.size, 0);
    assert.equal(f.saved().cursor, '');
    const reopened = f.open(); await reopened.task.resume();
    await reopened.tick();
    assert.deepEqual(f.ids(), ['a', 'b', 'c', 'd']);
    assert.deepEqual(f.updates, []);
    assert.deepEqual(f.finished, [4]);
    assert.deepEqual(f.saved(), {});
    assert.ok(f.scans() >= 1);
  });
}

test('更新或新增恢复时重新查表，不复用失败前的空索引缓存', async () => {
  const f = fixture({ mode: 'upsert' });
  await f.open().task.start(f.initial);
  await f.open().task.resume();
  assert.deepEqual(f.ids(), ['a', 'b', 'c', 'd']);
  assert.ok(f.scans() >= 2);
});

test('写表成功但保存游标失败，重新打开仍核对该批而不重复新增', async () => {
  const f = fixture(); f.succeedWrites(); f.failSave(true);
  await f.open().task.start(f.initial);
  assert.deepEqual(f.ids(), ['a', 'b']);
  f.failSave(false);
  await f.open().task.resume();
  assert.deepEqual(f.ids(), ['a', 'b', 'c', 'd']);
});

test('核对查询失败保持暂停，不写、不推进游标；再次恢复仍会重新核对', async () => {
  const f = fixture(); await f.open().task.start(f.initial);
  f.failScan(true);
  const second = f.open(); await second.task.resume();
  assert.equal(second.timers.size, 0);
  assert.deepEqual(f.ids(), ['a']);
  f.failScan(false); await f.open().task.resume();
  assert.deepEqual(f.ids(), ['a', 'b', 'c', 'd']);
});

test('正常新增不核对历史 ID，后续批次仍遵循原始新增模式', async () => {
  const f = fixture(); f.succeedWrites();
  f.items[2].cid = 'a';
  const engine = f.open(); await engine.task.start(f.initial); await engine.tick();
  assert.deepEqual(f.ids(), ['a', 'b', 'a', 'd']);
  assert.equal(f.scans(), 0);
});

test('异常恢复时评论 ID 字段被删除，不自动新建空 ID 列并重复写入', async () => {
  const f = fixture(); await f.open().task.start(f.initial);
  f.fields.delete('cid');
  await f.open().task.resume();
  assert.deepEqual(f.ids(), ['a']);
  assert.match(f.errors.at(-1).message, /评论ID/);
});

test('缺少评论 ID 的批次不写入、不推进游标，保留结果等待处理', async () => {
  const f = fixture(); f.items[0].cid = '';
  await f.open().task.start(f.initial);
  assert.deepEqual(f.rows, []);
  assert.equal(f.saved().cursor, '');
  assert.match(f.errors.at(-1).message, /评论ID/);
});


test('新建表在字段准备前失败，恢复时补齐字段继续写，不重复建表', async () => {
  const f = fixture({ newTable: true }); f.succeedWrites();
  await f.open().task.start(f.initial);
  assert.equal(f.saved().targetTableId, 'table');
  assert.deepEqual(f.rows, []);
  const reopened = f.open(); await reopened.task.resume();
  assert.equal(f.createdTables(), 1);
  assert.deepEqual(f.ids(), ['a', 'b', 'c', 'd']);
  await reopened.tick();
  assert.deepEqual(f.finished, [4]);
});

test('更新或新增的异常恢复仍完成已有评论的更新', async () => {
  const f = fixture({ mode: 'upsert' }); f.succeedWrites(); f.failUpdate();
  f.rows.push({ recordId: 'old', fields: { cid: 'a', text: '旧内容' } });
  await f.open().task.start(f.initial);
  assert.equal(f.rows[0].fields.text, '旧内容');
  await f.open().task.resume();
  assert.deepEqual(f.ids(), ['a', 'b', 'c', 'd']);
  assert.equal(f.rows[0].fields.text, '内容a');
});

test('恢复批次补写再次失败，下一次恢复继续核对，不重复已补写的记录', async () => {
  const f = fixture(); await f.open().task.start(f.initial);
  f.failAgain(); await f.open().task.resume();
  assert.deepEqual(f.ids(), ['a', 'b']);
  await f.open().task.resume();
  assert.deepEqual(f.ids(), ['a', 'b', 'c', 'd']);
});

test('待写标记保存失败时不调用 SDK 写入，后续可安全恢复', async () => {
  const f = fixture(); f.succeedWrites(); let saves = 0;
  f.failSave(() => ++saves >= 2);
  await f.open().task.start(f.initial);
  assert.deepEqual(f.rows, []);
  f.failSave(false); await f.open().task.resume();
  assert.deepEqual(f.ids(), ['a', 'b', 'c', 'd']);
});

test('异常批次核对后，后续批次恢复用户原本的始终新增模式', async () => {
  const f = fixture(); f.items[2].cid = 'a';
  await f.open().task.start(f.initial); await f.open().task.resume();
  assert.deepEqual(f.ids(), ['a', 'b', 'a', 'd']);
});


test('SDK 写入一直不返回：超时后重开仍核对已落表数据并写完剩余结果', async () => {
  const f = fixture({ operationTimeoutMs: 180000 }); f.hangWrite();
  const first = f.open();
  const running = first.task.start(f.initial);
  for (let i = 0; i < 200; i++) await Promise.resolve();
  assert.deepEqual(f.ids(), ['a']);
  first.expireWrite(); await running;
  assert.match(f.errors.at(-1).message, /超时/);
  const reopened = f.open(); await reopened.task.resume(); await reopened.tick();
  assert.deepEqual(f.ids(), ['a', 'b', 'c', 'd']);
  assert.deepEqual(f.finished, [4]);
});


test('升级前旧任务缺少标记：首批核对，后续仍按始终新增模式写完', async () => {
  const f = fixture(); f.succeedWrites();
  f.rows.push({ recordId: 'old-a', fields: { cid: 'a', text: '内容a' } });
  f.items[2].cid = 'a';
  f.seedSaved({ taskId: 'old-task', baseId: 'base', targetTableId: 'table',
    writeMode: 'append', cursor: '', writtenCount: 0 });
  const reopened = f.open(); await reopened.task.resume(); await reopened.tick();
  assert.deepEqual(f.ids(), ['a', 'b', 'a', 'd']);
  assert.equal(f.scans(), 1);
  assert.deepEqual(f.finished, [4]);
  assert.deepEqual(f.saved(), {});
});

test('旧任务已有游标：核对失败不推进，重开继续核对并写完剩余批次', async () => {
  const f = fixture(); f.succeedWrites();
  for (const cid of ['a', 'b', 'c']) f.rows.push({ recordId: `old-${cid}`, fields: { cid, text: `内容${cid}` } });
  f.seedSaved({ taskId: 'old-task', baseId: 'base', targetTableId: 'table',
    writeMode: 'append', cursor: '2', writtenCount: 2 });
  f.failScan(true);
  const failed = f.open(); await failed.task.resume();
  assert.equal(failed.timers.size, 0);
  assert.equal(f.saved().cursor, '2');
  assert.deepEqual(f.ids(), ['a', 'b', 'c']);
  f.failScan(false);
  const reopened = f.open(); await reopened.task.resume(); await reopened.tick();
  assert.deepEqual(f.ids(), ['a', 'b', 'c', 'd']);
  assert.deepEqual(f.finished, [4]);
  assert.deepEqual(f.saved(), {});
});

test('真实创建入口的新任务不被误判为旧任务，正常新增不查重', async () => {
  const f = fixture(); f.succeedWrites();
  f.rows.push({ recordId: 'old-a', fields: { cid: 'a', text: '历史内容' } });
  let initial;
  const submit = load('postNoteTask', { componentUnmounted: false, commentSubmission: { pending: null }, hasRecoverableTask: { value: false },
    showToast() {}, request: async () => ({ data: { sta: 0, data: { task_id: 'new-task' } } }),
    props: { api_key: 'test' }, formData: { value: { pages: 1, reply_pages: -1, writeMode: 'append' } },
    selectedFieldKeys: { value: ['cid', 'text'] }, mappingDraft: { value: [] }, activeCommentTaskId: { value: '' },
    commentStreamTask: { saveForResume: async task => { initial = task; }, resume: async () => true },
  });
  await submit('table', 'https://example.test');
  assert.ok(initial, '必须经真实提交入口创建任务');
  const engine = f.open(); await engine.task.start(initial); await engine.tick();
  assert.deepEqual(f.ids(), ['a', 'a', 'b', 'c', 'd']);
  assert.equal(f.scans(), 0);
  assert.deepEqual(f.finished, [4]);
});

test('旧任务尚未建表：初始化失败后仍可在原表补字段，不误判未知写入', async () => {
  const f = fixture({ newTable: true }); f.succeedWrites();
  f.seedSaved({ taskId: 'old-task', baseId: 'base', targetTableId: '',
    writeMode: 'append', cursor: '', writtenCount: 0 });
  await f.open().task.resume();
  assert.equal(f.saved().targetTableId, 'table');
  assert.deepEqual(f.rows, []);
  const reopened = f.open(); await reopened.task.resume(); await reopened.tick();
  assert.equal(f.createdTables(), 1);
  assert.deepEqual(f.ids(), ['a', 'b', 'c', 'd']);
  assert.deepEqual(f.finished, [4]);
});


test('实际恢复按钮与任务引擎联动：继续原任务、核对首批并写完剩余结果', async () => {
  const f = fixture(); let created = 0;
  const scope = { clearing: { value: false }, commentSubmission: { pending: null }, componentUnmounted: false, loading: { value: true }, isSubmitting: { value: false }, isCancelling: { value: false },
    activeCommentTaskId: { value: 'task' }, hasRecoverableTask: { value: false }, recoveryRequiresReopen: { value: false },
    showToast() {}, showCompletionToast() {}, showErrorMsg() {},
    computed: fn => ({ get value() { return fn(); } }), commit: () => { created++; }, cancelCommentTask() {},
  };
  const options = declarations.find(node => node.id.name === 'commentStreamTask').init.arguments[0].properties;
  const callbacks = Object.fromEntries(['onError', 'onFinish'].map(name => {
    const node = options.find(node => node.key.name === name).value;
    return [name, new Function(...Object.keys(scope), `return (${source.slice(node.start, node.end)});`)(...Object.values(scope))];
  }));
  const engine = f.open(callbacks);
  scope.commentStreamTask = engine.task;
  scope.taskActionState = load('taskActionState', scope);
  scope.resumeCommentTask = load('resumeCommentTask', scope);
  const action = load('handleTaskAction', scope);
  await engine.task.start(f.initial);
  assert.equal(scope.taskActionState.value, 'recoverable');
  assert.equal(f.saved().taskId, 'task');
  await action();
  assert.equal(created, 0);
  assert.equal(f.saved().taskId, 'task');
  assert.deepEqual(f.ids(), ['a', 'b', 'c', 'd']);
  await engine.tick();
  assert.deepEqual(f.finished, [4]);
  assert.deepEqual(f.saved(), {});
  assert.equal(scope.taskActionState.value, 'idle');
});


for (const targetTableId of ['table', '']) {
  test(`创建成功后保存失败，重新进入自动补存并写完所有结果：${targetTableId || '新建表'}`, async () => {
    const f = fixture(); f.succeedWrites(); f.failSave(() => true);
    let creates = 0;
    const shared = { pending: null };
    const page = () => ({ componentUnmounted: false, commentSubmission: shared,
      props: { api_key: 'test' }, formData: { value: { pages: 1, writeMode: 'append' } }, selectedFieldKeys: { value: ['cid', 'text'] }, mappingDraft: { value: [] },
      request: async () => { creates++; return { data: { sta: 0, data: { task_id: 'created-task' } } }; },
      loading: { value: false }, isSubmitting: { value: false }, activeCommentTaskId: { value: '' },
      hasRecoverableTask: { value: false }, recoveryRequiresReopen: { value: false },
      showToast() {}, showCompletionToast() {}, showErrorMsg() {},
      loadFieldOptions: async () => {}, loadSelectedFieldKeys: async () => {}, loadTableOutputConfigs: async () => {},
      fieldSelectionReady: { value: false },
    });
    const first = page(); first.commentStreamTask = f.open().task;
    await load('postNoteTask', first)(targetTableId, 'url');
    assert.equal(first.hasRecoverableTask.value, true);
    assert.equal(f.saved(), undefined);
    f.failSave(false);
    const next = page(); const engine = f.open(); next.commentStreamTask = engine.task;
    next.isSubmitting.value = true;
    next.resumeCommentTask = load('resumeCommentTask', next);
    const mounted = parseJS(source, { sourceType: 'module' }).program.body.find(node => node.type === 'ExpressionStatement'
      && node.expression.type === 'CallExpression' && node.expression.callee.name === 'onMounted').expression.arguments[0];
    await new Function(...Object.keys(next), `return (${source.slice(mounted.start, mounted.end)});`)(...Object.values(next))();
    assert.deepEqual(f.errors.map(error => error.message), []);
    assert.deepEqual(f.ids(), ['a', 'b', 'c', 'd']);
    assert.equal(f.saved().taskId, 'created-task');
    assert.equal(shared.pending, null);
    assert.equal(creates, 1);
    await engine.tick();
    assert.deepEqual(f.finished, [4]);
    assert.deepEqual(f.saved(), {});
    assert.equal(f.createdTables(), targetTableId ? 0 : 1);
  });
}

for (const mapped of [false, true]) {
  test(`跨批次相同评论 ID 更新原记录，不重复新增（映射=${mapped}）`, async () => {
    const f = fixture({ mode: 'upsert', mapped });
    f.succeedWrites();
    f.items[2] = { cid: 'a', text: '更新后的内容a' };
    const current = f.open();
    await current.task.start(f.initial);
    await current.tick();
    assert.deepEqual(f.ids(), ['a', 'b', 'd']);
    assert.equal(f.rows[0].fields.text, '更新后的内容a');
    assert.deepEqual(f.writes, [2, 1]);
    assert.equal(f.updates.length, 1);
    assert.equal(f.updates[0].recordId, f.rows[0].recordId);
    assert.deepEqual(f.errors, []);
    assert.deepEqual(f.finished, [4]);
  });
}


test('评论任务保存创建请求发出时的输出字段，不引用后续勾选', async () => {
  let release, initial;
  const selectedFieldKeys = { value: ['cid', 'text'] };
  const submit = load('postNoteTask', {
    componentUnmounted: false, commentSubmission: { pending: null }, selectedFieldKeys,
    hasRecoverableTask: { value: false }, activeCommentTaskId: { value: '' },
    props: { api_key: 'test-only' }, formData: { value: { pages: 1, writeMode: 'upsert' } },
    mappingDraft: { value: [] }, showToast() {},
    request: () => new Promise(resolve => { release = resolve; }),
    commentStreamTask: { saveForResume: async task => { initial = task; }, resume: async () => true },
  });
  const pending = submit('table', 'https://example.test');
  selectedFieldKeys.value.splice(1, 1, 'nickname');
  release({ data: { sta: 0, data: { task_id: 'original-task' } } });
  await pending;
  assert.deepEqual(initial.selectedFieldKeys, ['cid', 'text']);
  assert.equal(initial.targetTableId, 'table');
  assert.equal(initial.taskId, 'original-task');
});

for (const mode of ['upsert', 'append']) {
  test(`暂停改勾选后恢复旧评论任务，保持原字段、映射和进度（${mode}）`, async () => {
    const f = fixture({ mode, mapped: true });
    f.items.forEach(item => { item.nickname = '不应写入的昵称'; });
    await f.open().task.start({ ...f.initial, selectedFieldKeys: [...f.selectedFieldKeys.value] });
    assert.equal(f.saved().cursor, '');
    f.selectedFieldKeys.value = ['cid', 'nickname'];
    const beforeFields = [...f.fields.keys()];
    // 创建新引擎从持久化检查点恢复，不借用第一次运行的内存字段选择。
    const resumed = f.open();
    await resumed.task.resume();
    assert.equal(f.errors.length, 1);
    assert.match(f.errors[0].message, /SDK response lost/);
    await resumed.tick();
    assert.deepEqual(f.ids(), ['a', 'b', 'c', 'd']);
    assert.deepEqual(f.rows.map(row => row.fields.text), f.items.map(item => item.text));
    assert.deepEqual([...f.fields.keys()], beforeFields);
    assert.ok(f.rows.every(row => !('nickname' in row.fields)));
    assert.deepEqual(f.selectedFieldKeys.value, ['cid', 'nickname'], '保留用户为后续任务修改的草稿');
    assert.deepEqual(f.finished, [4]);
    assert.deepEqual(f.saved(), {});
  });
}


test('评论新建表初始化失败后改勾选，恢复仍在原表创建原任务字段', async () => {
  const f = fixture({ newTable: true }); f.succeedWrites();
  await f.open().task.start({ ...f.initial, selectedFieldKeys: [...f.selectedFieldKeys.value] });
  assert.equal(f.saved().targetTableId, 'table');
  assert.deepEqual(f.rows, []);
  f.selectedFieldKeys.value = ['cid', 'nickname'];
  const reopened = f.open(); await reopened.task.resume(); await reopened.tick();
  assert.deepEqual(f.ids(), ['a', 'b', 'c', 'd']);
  assert.deepEqual(f.rows.map(row => row.fields.text), f.items.map(item => item.text));
  assert.deepEqual([...f.fields.keys()], ['cid', 'text']);
  assert.equal(f.createdTables(), 1);
  assert.deepEqual(f.finished, [4]);
  assert.deepEqual(f.saved(), {});
});
