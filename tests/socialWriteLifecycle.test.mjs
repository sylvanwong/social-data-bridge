import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from '@babel/parser';

function loadWriter(bindings) {
  const source = fs.readFileSync(new URL('../src/composables/useSocialData.js', import.meta.url), 'utf8');
  let callback;
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'VariableDeclarator' && node.id.name === 'createAndWriteData') callback = node.init;
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  }
  visit(parse(source, { sourceType: 'module' }));
  return new Function(...Object.keys(bindings), `const createAndWriteData = ${source.slice(callback.start, callback.end)}; return createAndWriteData;`)(...Object.values(bindings));
}

function fixture() {
  const events = [];
  const config = { key: 'title', name: '标题', type: 'text' };
  const field = { id: 'title', getType: async () => 'text', createCell: async value => ({ value }) };
  const table = { id: 'created', getFieldMetaList: async () => [{ id: 'title', name: '标题' }],
    getFieldById: async () => field, addRecords: async records => { events.push('write'); return ['record']; } };
  const bindings = {
    fieldMapping: [config], getActiveFieldMapping: () => [config], getTableName: () => 'test',
    createSequentialTable: async () => { events.push('create'); return { tableId: 'created' }; },
    setupTableFields: async () => { events.push('setup'); throw new Error('field setup failed'); },
    bitable: { base: { getTableById: async id => { events.push(`table:${id}`); return table; } } },
    resolveFieldMetaByConfig: map => ({ fieldMeta: map.get('标题') }),
    isFieldTypeCompatible: type => type === 'text', getExpectedFieldTypeName: () => '文本',
    FieldType: { Attachment: 'attachment' }, normalizeCellValue: async (_, field, value) => value,
    applyFieldDisplayConfig: async () => {}, uploadAttachmentFilesInBatch: async () => {}, api_key: '',
    console: { error() {} }, ElNotification: () => {}, showErrorMsg: () => {}, resetParams: () => {},
  };
  return { events, bindings, table };
}

test('真实共用写表函数：字段准备失败前保存表 ID，恢复使用原表', async () => {
  const { events, bindings } = fixture();
  let savedId;
  const write = loadWriter(bindings);
  await assert.rejects(write([{ title: '内容' }], '', 'task', '', [], {
    stopAfterCurrentBatch: true, onTargetTableReady: async id => { savedId = id; events.push('save'); },
  }), /field setup failed/);
  assert.equal(savedId, 'created');
  assert.deepEqual(events, ['create', 'save', 'setup']);
  const reopened = loadWriter(bindings);
  await reopened([{ title: '内容' }], 'stream', 'task', savedId, [], { stopAfterCurrentBatch: true });
  assert.deepEqual(events, ['create', 'save', 'setup', 'table:created', 'write']);
});

test('真实共用写表函数：保存表 ID 失败时不准备字段、不再建表', async () => {
  const { events, bindings } = fixture();
  await assert.rejects(loadWriter(bindings)([{}], '', 'task', '', [], {
    stopAfterCurrentBatch: true, onTargetTableReady: async () => { throw new Error('save failed'); },
  }), /save failed/);
  assert.deepEqual(events, ['create']);
});

test('真实共用写表函数：SDK 写入失败直接抛出，不自动换表重写', async () => {
  const { events, bindings, table } = fixture();
  table.addRecords = async () => { events.push('write'); throw new Error('response lost'); };
  await assert.rejects(loadWriter(bindings)([{ title: '内容' }], 'stream', 'task', 'existing', [], {
    stopAfterCurrentBatch: true,
  }), /response lost/);
  assert.deepEqual(events, ['table:existing', 'write']);
});

for (const state of ['missing', 'incompatible']) {
  test(`恢复时字段 ${state} 必须报错，不能当作写入成功`, async () => {
    const { events, bindings, table } = fixture();
    if (state === 'missing') table.getFieldMetaList = async () => [];
    else bindings.isFieldTypeCompatible = () => false;
    await assert.rejects(loadWriter(bindings)([{ title: '内容' }], 'stream', 'task', 'created', [], {
      stopAfterCurrentBatch: true,
    }), /字段/);
    assert.deepEqual(events, ['table:created']);
  });
}

test('博主作品的共享轮询收到真实写入错误后停止，不再次安排写入', async () => {
  const { parse: parseVue } = await import('@vue/compiler-sfc');
  const source = parseVue(fs.readFileSync(new URL('../src/components/ProfileFetch.vue', import.meta.url), 'utf8')).descriptor.scriptSetup.content;
  const taskNode = parse(source, { sourceType: 'module' }).program.body
    .filter(node => node.type === 'VariableDeclaration').flatMap(node => node.declarations)
    .find(node => node.id.name === 'profileStreamTask');
  const properties = taskNode.init.arguments[0].properties;
  const { events, bindings, table } = fixture();
  table.addRecords = async () => { events.push('write'); throw new Error('response lost'); };
  bindings.prepareAttachmentPipeline = async () => {};
  const errors = [];
  const loading = { value: true }, hasRecoverableTask = { value: false };
  const scope = {
    createAndWriteData: loadWriter(bindings), showProfileFieldProgress() {}, loading, hasRecoverableTask,
    isCancelling: { value: false }, activeProfileTaskId: { value: 'task' }, activeStreamTask: null,
    recoveryRequiresReopen: { value: false }, showCompletionToast() {}, showErrorMsg: message => errors.push(message),
  };
  const callback = name => {
    const node = properties.find(node => node.key.name === name).value;
    return new Function(...Object.keys(scope), `return (${source.slice(node.start, node.end)});`)(...Object.values(scope));
  };
  let saved;
  const timers = new Map(); let timerId = 0;
  const engineSource = fs.readFileSync(new URL('../src/composables/useIncrementalTask.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/, '').replace('export const useIncrementalTask', 'const useIncrementalTask');
  const sdk = { bridge: {
    setData: async (_, value) => { saved = structuredClone(value); },
    getData: async () => structuredClone(saved),
  }, base: { getSelection: async () => ({ baseId: 'base' }) } };
  const createTask = new Function('bitable', 'setTimeout', 'clearTimeout', `${engineSource}; return useIncrementalTask;`)(sdk,
    fn => { timers.set(++timerId, fn); return timerId; }, id => timers.delete(id));
  const engine = createTask({ storageKey: 'profile-test',
    getStatus: async () => ({ status: 0 }), isTerminal: () => false,
    getResults: async () => ({ items: [{ title: '内容' }], next_cursor: 'cursor-1', has_more: false }),
    writeBatch: callback('writeBatch'), onError: callback('onError'),
  });
  await engine.start({ taskId: 'task', cursor: '', targetTableId: 'existing', writtenCount: 0, writeMode: 'append', pendingWrite: false });
  assert.equal(timers.size, 0);
  assert.equal(engine.getActiveTask(), null);
  assert.equal(loading.value, false);
  assert.equal(hasRecoverableTask.value, true);
  assert.equal(saved.cursor, '');
  assert.equal(saved.writtenCount, 0);
  assert.equal(saved.pendingWrite, true);
  assert.match(errors[0], /response lost/);
  assert.deepEqual(events, ['table:existing', 'write']);
});
