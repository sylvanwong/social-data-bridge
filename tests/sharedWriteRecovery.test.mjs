import { createTaskStorage } from './helpers/taskStorage.mjs';
import { resolveWritableField } from '../src/utils/tableFields.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from '@babel/parser';
import { matchWrittenAppendRows, readTableRecords } from '../src/utils/taskWriteState.mjs';

function fixture({ mapped = false, loseResponse = true, fallback = false, fallbackColumn = false, singleRecordBatches = true } = {}) {
  const source = fs.readFileSync(new URL('../src/composables/useSocialData.js', import.meta.url), 'utf8');
  let callback;
  const keyDeclarations = [];
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'VariableDeclarator' && node.id.name === 'createAndWriteData') callback = node.init;
    if (node.type === 'VariableDeclarator' && ['normalizeUniqueKeyPart', 'buildWorkUniqueKey'].includes(node.id.name)) {
      keyDeclarations.push(`const ${source.slice(node.start, node.end)};`);
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  }
  visit(parse(source, { sourceType: 'module' }));
  const buildWorkUniqueKey = new Function(`${keyDeclarations.join('\n')} return buildWorkUniqueKey;`)();
  const config = { key: 'user_id', name: '作者ID', type: 'text' };
  const fallbackConfig = { key: 'identity_key', name: '作者标识', type: 'text' };
  const rows = [], events = [], reads = [];
  const makeField = id => ({ id, getType: async () => 'text', createCell: async value => ({ fieldId: id, value, getValue: async () => value }) });
  const field = makeField('mapped-id');
  const metadata = [{ id: field.id, name: mapped ? '自定义ID' : '作者ID' }];
  if (fallbackColumn) metadata.push({ id: 'fallback-id', name: mapped ? '自定义标识' : '作者标识' });
  const table = {
    id: 'table', getFieldMetaList: async () => [...metadata],
    getFieldById: async id => makeField(id),
    getRecordsByPage: async ({ filter } = {}) => {
      events.push('scan'); reads.push(filter);
      return { records: filter ? rows.filter(row => filter.conditions.some(({ fieldId, value }) => row.fields[fieldId] === value)) : rows };
    },
    addField: async config => { events.push('addField'); metadata.push({ id: 'fallback-id', ...config }); },
    addRecords: async records => {
      events.push('add');
      const accepted = loseResponse ? records.slice(0, 1) : records;
      const created = accepted.map((record, index) => ({ recordId: `r${rows.length + index}`,
        fields: Object.fromEntries(record.map(cell => [cell.fieldId, cell.value])) }));
      rows.push(...created);
      if (loseResponse) { loseResponse = false; throw new Error('response lost'); }
      return created.map(record => record.recordId);
    },
    setRecords: async records => {
      events.push('update');
      for (const record of records) {
        const row = rows.find(row => row.recordId === record.recordId);
        assert.ok(row, '更新必须使用有效的记录 ID');
        Object.assign(row.fields, record.fields);
      }
      return records.map(record => record.recordId);
    },
  };
  const bindings = { resolveWritableField,
    fieldMapping: fallback ? [config, fallbackConfig] : [config], getActiveFieldMapping: () => [],
    bitable: { base: { getTableById: async () => table } },
    resolveFieldMetaByConfig: (map, cfg) => ({ fieldMeta: map.get(cfg.name) }),
    isFieldTypeCompatible: () => true, FieldType: { Text: 'text', Attachment: 'attachment' },
    normalizeCellValue: async (_, field, value) => value,
    applyFieldDisplayConfig: async () => {}, uploadAttachmentFilesInBatch: async () => {},
    prepareAttachmentPipeline: async () => {}, api_key: '',
    buildWorkUniqueKey, matchWrittenAppendRows, readTableRecords, chunkRecords: list => singleRecordBatches ? list.map(item => [item]) : [list],
    upsertIndexCache: new Map(), console: { error() {} },
  };
  const write = new Function(...Object.keys(bindings), `return (${source.slice(callback.start, callback.end)});`)(...Object.values(bindings));
  const options = { stopAfterCurrentBatch: true, uniqueKey: 'user_id', writeMode: 'append',
    ...(fallback ? { fallbackUniqueKey: 'identity_key' } : {}),
    fieldMappings: mapped ? [{ source_key: 'user_id', target_field_id: field.id },
      ...(fallbackColumn ? [{ source_key: 'identity_key', target_field_id: 'fallback-id' }] : [])] : [],
    onBeforeWrite: async () => events.push('save-pending'),
  };
  return { write: (items, opts = {}) => write(items, 'stream', 'task', 'table', [], { ...options, ...opts }), rows, events, reads, table, bindings };
}

for (const mode of ['append', 'upsert']) {
  test(`${mode} response lost: fresh scan mapped key and fill only missing records`, async () => {
    const f = fixture({ mapped: true });
    await assert.rejects(f.write([{ user_id: 'a' }, { user_id: 'b' }], { writeMode: 'upsert' }), /response lost/);
    assert.equal(f.rows.length, 1);
    await f.write([{ user_id: 'a' }, { user_id: 'b' }], { writeMode: mode, reconcile: true });
    assert.deepEqual(f.rows.map(row => row.fields['mapped-id']), ['a', 'b']);
    assert.equal(f.events.filter(event => event === 'scan').length, 2);
    assert.equal(f.events.includes('update'), mode === 'upsert');
    assert.ok(f.events.indexOf('save-pending') < f.events.indexOf('add'));
  });
}
test('recovery with missing ID column does not create an empty replacement', async () => {
  const f = fixture(); f.table.getFieldMetaList = async () => [];
  await assert.rejects(f.write([{ user_id: 'a' }], { reconcile: true }), /无法核对/);
  assert.deepEqual(f.events, []);
});
test('append recovery keeps the original field snapshot until the uncertain batch is confirmed', async () => {
  const f = fixture();
  const appendState = {};
  await assert.rejects(f.write([{ user_id: 'a' }], { appendState }), /response lost/);
  const saved = structuredClone(appendState), rows = structuredClone(f.rows);
  const readFields = f.table.getFieldMetaList;
  f.table.getFieldMetaList = async () => [{ id: 'replacement-id', name: '作者ID' }];
  await assert.rejects(f.write([{ user_id: 'a' }], { appendState, reconcile: true }), /目标字段已变化/);
  assert.deepEqual(appendState, saved);
  assert.deepEqual(f.rows, rows);
  f.table.getFieldMetaList = readFields;
  await f.write([{ user_id: 'a' }], { appendState, reconcile: true });
  assert.deepEqual(f.rows, rows, '恢复原字段后只确认已落表结果，不重复新增');
  assert.equal(appendState.pendingCount, 0);
  assert.equal(f.events.filter(event => event === 'add').length, 1);
});

test('两万行追加只保存本批同 ID 的旧行，部分落表超时后补缺并清除已确认基线', async () => {
  const f = fixture({ mapped: true, singleRecordBatches: false });
  f.rows.push(
    { recordId: 'history-a-1', fields: { 'mapped-id': 'a' } },
    { recordId: 'history-a-2', fields: { 'mapped-id': 'a' } },
    ...Array.from({ length: 20000 }, (_, i) => ({ recordId: 'old-' + i, fields: { 'mapped-id': 'other-' + i } })),
  );
  const appendState = {}, snapshots = [];
  const items = [{ user_id: 'a' }, { user_id: 'b' }];
  const options = state => ({ appendState: state, onBeforeWrite: async () => snapshots.push(structuredClone(state)) });
  await assert.rejects(f.write(items, options(appendState)), /response lost/);
  assert.deepEqual(snapshots[0].knownRecordIds, ['history-a-1', 'history-a-2']);
  assert.equal(snapshots[0].pendingCount, 2);
  assert.equal(f.rows.length, 20003);

  const resumed = JSON.parse(JSON.stringify(snapshots[0]));
  await f.write(items, { ...options(resumed), reconcile: true });
  assert.deepEqual(snapshots[1], { ...snapshots[0], confirmedRecordIds: [f.rows.at(-2).recordId, null] },
    '续写保留写前基线，并在补写前保存已核对的记录 ID');
  assert.deepEqual(f.rows.slice(-2).map(row => row.fields['mapped-id']), ['a', 'b']);
  assert.equal(f.rows.length, 20004);
  assert.equal(resumed.pendingCount, 0);
  assert.equal(resumed.knownRecordIds, undefined);

  await f.write([{ user_id: 'b' }], options(resumed));
  assert.deepEqual(snapshots[2].knownRecordIds, [f.rows.at(-2).recordId], '上一批已落表的同 ID 行属于新批次的历史行');
  assert.equal(f.rows.length, 20005);
  assert.deepEqual(f.reads.map(filter => filter?.conditions.map(item => item.value)), [['a', 'b'], ['a', 'b'], ['b']]);
  assert.ok(f.reads.every(filter => filter.conditions.every(item => item.fieldId === 'mapped-id')));
});

test('共用追加补写再次超时，重进后保留已核对行并补上剩余结果', async () => {
  const f = fixture({ singleRecordBatches: false });
  const items = [{ user_id: 'a' }, { user_id: 'b' }, { user_id: 'c' }];
  let saved;
  const write = (state, reconcile) => f.write(items, { appendState: state, reconcile,
    onBeforeWrite: async () => { saved = JSON.parse(JSON.stringify(state)); } });
  await assert.rejects(write({}, false), /response lost/);

  const add = f.table.addRecords;
  f.table.addRecords = async rows => { await add(rows.slice(0, 1)); throw new Error('补写响应超时'); };
  await assert.rejects(write(saved, true), /补写响应超时/);
  const confirmed = f.rows[0];
  confirmed.fields['mapped-id'] = 'c'; // 编辑成与仍待写结果相同的内容。
  f.table.addRecords = add;
  const resumed = saved;
  const result = await write(resumed, true);
  assert.deepEqual(f.rows.map(row => row.fields['mapped-id']), ['c', 'b', 'c']);
  assert.equal(f.rows[0], confirmed);
  assert.equal(result.recordIds.length, items.length);
  assert.equal(new Set(result.recordIds).size, items.length);
  assert.equal(resumed.confirmedRecordIds, undefined, '已完成批次清除核对记录');
});

test('追加检查点的作品标识变化时保留检查点，不按同样的条数续写', async () => {
  const f = fixture({ singleRecordBatches: false });
  const appendState = {};
  await assert.rejects(f.write([{ user_id: 'a' }, { user_id: 'b' }], { appendState }), /response lost/);
  const saved = structuredClone(appendState);
  await assert.rejects(f.write([{ user_id: 'a' }, { user_id: 'c' }], { appendState, reconcile: true }), /待核对批次与原结果不一致/);
  assert.deepEqual(appendState, saved);
  assert.equal(f.events.filter(event => event === 'add').length, 1);
});
test('missing author ID pauses whole batch before any mutation', async () => {
  const f = fixture();
  await assert.rejects(f.write([{ user_id: 'a' }, { nickname: 'unknown' }]), /ID缺失/);
  assert.deepEqual(f.events, []);
});
test('SDK response after task timeout cannot initiate a second mutation', async () => {
  const f = fixture(); let active = true;
  f.table.addRecords = async () => { f.events.push('add'); active = false; return ['r']; };
  await assert.rejects(f.write([{ user_id: 'a' }, { user_id: 'b' }], {
    writeMode: 'upsert', assertActive: () => { if (!active) throw new Error('timeout'); },
  }), /timeout/);
  assert.equal(f.events.filter(event => event === 'add').length, 1);
});

test('另一窗口已完成时，迟到的更新响应不能发出同一批的新增请求', async () => {
  const f = fixture({ loseResponse: false });
  f.rows.push({ recordId: 'existing', fields: { 'mapped-id': 'a' } });
  const started = Promise.withResolvers(), release = Promise.withResolvers();
  const update = f.table.setRecords;
  let updates = 0;
  f.table.setRecords = async records => {
    const first = ++updates === 1;
    const result = await update(records);
    if (first) {
      started.resolve();
      await release.promise;
    }
    return result;
  };
  const initial = { taskId: 'task', baseId: 'base', targetTableId: 'table', cursor: '' };
  const storage = createTaskStorage('test', initial);
  const bitable = { bridge: storage, base: { getSelection: async () => ({ baseId: 'base' }) } };
  const source = fs.readFileSync(new URL('../src/composables/useIncrementalTask.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/, '').replace('export const useIncrementalTask', 'const useIncrementalTask');
  const load = new Function('bitable', 'setTimeout', 'clearTimeout', `${source}; return useIncrementalTask;`);
  const finished = [], errors = [];
  function open(name) {
    let scheduled;
    const task = load(bitable, callback => (scheduled = callback), () => {})({
      storageKey: 'test',
      getStatus: async () => ({ status: 1 }),
      getResults: async task => task.cursor
        ? { items: [] } : { items: [{ user_id: 'a' }, { user_id: 'b' }], next_cursor: 'done' },
      writeBatch: (items, task, controls) => f.write(items, {
        writeMode: 'upsert',
        assertActive: controls.assertActive,
        assertCanWrite: controls.assertCanWrite,
        onBeforeWrite: async () => { f.events.push('save-pending'); await controls.saveProgress(); },
      }),
      onFinish: () => finished.push(name),
      onError: error => errors.push(error),
    });
    return { task, tick: () => scheduled() };
  }
  const old = open('old'), current = open('current');
  const pending = old.task.resume();
  try {
    await started.promise;
    await current.task.resume();
    await current.tick();
    assert.deepEqual(finished, ['current']);
    release.resolve();
    await pending;
    assert.deepEqual(f.rows.map(row => row.fields['mapped-id']), ['a', 'b']);
    assert.equal(f.events.filter(event => event === 'add').length, 1);
    assert.equal(f.events.filter(event => event === 'save-pending').length, 2);
    assert.match(errors[0]?.message, /其他窗口.*结束/);
    assert.equal(errors[0]?.taskEnded, true);
    assert.equal(errors[0]?.requiresReopen, true);
  } finally {
    release.resolve();
    old.task.stop();
    current.task.stop();
    await pending;
  }
});

for (const [component, taskName] of [['KeywordSearch', 'keywordStreamTask'], ['BloggerSearch', 'searchTask']]) {
  test(`${component}: legacy saved target reconciles once and pending marker persists before mutation`, async () => {
    const { parse: parseVue } = await import('@vue/compiler-sfc');
    const source = parseVue(fs.readFileSync(new URL(`../src/components/${component}.vue`, import.meta.url), 'utf8')).descriptor.scriptSetup.content;
    const taskNode = parse(source, { sourceType: 'module' }).program.body
      .filter(node => node.type === 'VariableDeclaration').flatMap(node => node.declarations)
      .find(node => node.id.name === taskName);
    const callback = taskNode.init.arguments[0].properties.find(node => node.key.name === 'writeBatch').value;
    const seen = [], saved = [];
    const write = new Function('createAndWriteData', `return (${source.slice(callback.start, callback.end)});`)(async (_, type, id, target, fields, options) => {
      seen.push(options.reconcile);
      await options.onBeforeWrite();
      return { tableId: target };
    });
    const task = { taskId: 'old-task', targetTableId: 'existing' };
    const controls = { assertActive() {}, saveProgress: async () => saved.push(structuredClone(task)) };
    await write([{ user_id: 'a', aweme_id: 'p' }], task, controls);
    assert.equal(task.pendingWrite, false);
    assert.equal(saved[0].pendingWrite, true);
    await write([{ user_id: 'b', aweme_id: 'q' }], task, controls);
    assert.deepEqual(seen, [true, false]);
  });
}

for (const mapped of [false, true]) {
  test(`upsert across batches reuses returned record IDs (mapped=${mapped})`, async () => {
    const f = fixture({ mapped, loseResponse: false });
    const first = await f.write([{ user_id: 'a' }, { user_id: 'b' }], { writeMode: 'upsert' });
    const second = await f.write([{ user_id: 'a' }, { user_id: 'c' }], { writeMode: 'upsert' });
    assert.deepEqual(f.rows.map(row => row.fields['mapped-id']), ['a', 'b', 'c']);
    assert.deepEqual(first.recordIds, ['r0', 'r1']);
    assert.deepEqual(second.recordIds, ['r0', 'r2']);
    assert.equal(f.events.filter(event => event === 'scan').length, 1);
    assert.equal(f.events.filter(event => event === 'add').length, 3);
    assert.equal(f.events.filter(event => event === 'update').length, 1);
  });
}


test('真实唯一 ID 解析保留大小写、去空白及字段值解析', () => {
  const normalize = fixture().bindings.buildWorkUniqueKey;
  assert.equal(normalize('  AbC123  '), 'AbC123');
  assert.equal(normalize([{ text: ' AbC123 ' }]), 'AbC123');
  assert.equal(normalize({ name: ' AbC123 ' }), 'AbC123');
  assert.equal(normalize({ value: ' AbC123 ' }), 'AbC123');
  assert.equal(normalize(null), '');
  assert.equal(normalize(undefined), '');
  assert.equal(normalize(123), '123');
});

for (const separateBatches of [false, true]) {
  test(`大小写不同的 ID 不合并（跨批次=${separateBatches}）`, async () => {
    const f = fixture({ loseResponse: false, mapped: true });
    const items = [{ user_id: 'AbC123' }, { user_id: 'abc123' }];
    if (separateBatches) {
      await f.write(items.slice(0, 1), { writeMode: 'upsert' });
      await f.write(items.slice(1), { writeMode: 'upsert' });
    } else {
      await f.write(items, { writeMode: 'upsert' });
    }
    assert.deepEqual(f.rows.map(row => row.fields['mapped-id']), ['AbC123', 'abc123']);
    assert.equal(f.events.includes('update'), false);
  });
}

for (const mode of ['append', 'upsert']) {
  test(`${mode} 恢复按原大小写核对富文本 ID，补齐而不覆盖另一条`, async () => {
    const f = fixture({ mapped: true });
    const items = [{ user_id: 'AbC123' }, { user_id: 'abc123' }];
    await assert.rejects(f.write(items, { writeMode: 'upsert' }), /response lost/);
    f.table.getRecordsByPage = async () => ({ records: f.rows.map(row => ({ ...row,
      fields: { 'mapped-id': [{ text: ` ${row.fields['mapped-id']} ` }] },
    })) });
    await f.write(items, { writeMode: mode, reconcile: true });
    assert.deepEqual(f.rows.map(row => row.fields['mapped-id']), ['AbC123', 'abc123']);
  });
}

for (const mode of ['append', 'upsert']) {
  for (const mapped of [false, true]) {
    test(`作者搜索 ${mode} 部分成功后恢复：真实ID与备用标识混合，写完且不重复（映射=${mapped}）`, async () => {
      const f = fixture({ fallback: true, fallbackColumn: true, mapped });
      const items = [{ user_id: 'RealID' }, { user_id: '', identity_key: 'username:Author' },
        { user_id: null, identity_key: 'profile_url:https://example.test/other' }];
      await assert.rejects(f.write(items, { writeMode: mode }), /response lost/);
      assert.equal(f.rows.length, 1);
      await f.write(items, { writeMode: mode, reconcile: true });
      assert.equal(f.rows.length, 3);
      assert.equal(f.rows[0].fields['mapped-id'], 'RealID');
      assert.equal(f.rows[1].fields['mapped-id'] || '', '');
      assert.equal(f.rows[1].fields['fallback-id'], 'username:Author');
      await f.write(items, { writeMode: mode, reconcile: true });
      assert.equal(f.rows.length, 3);
    });
  }
}

test('作者搜索跨批次交替出现真实ID和备用标识，缓存保持完整且大小写不合并', async () => {
  const f = fixture({ fallback: true, loseResponse: false });
  await f.write([{ user_id: 'a' }], { writeMode: 'upsert' });
  assert.equal(f.events.includes('addField'), false);
  await f.write([{ user_id: '', identity_key: 'username:Author' }], { writeMode: 'upsert' });
  await f.write([{ user_id: 'b' }], { writeMode: 'upsert' });
  await f.write([{ user_id: 'b' }, { user_id: '', identity_key: 'username:Author' },
    { user_id: '', identity_key: 'username:author' }], { writeMode: 'upsert' });
  assert.equal(f.rows.length, 4);
  assert.equal(f.events.filter(event => event === 'addField').length, 1);
});

test('作者搜索真实ID与相同文本的备用标识不会合并', async () => {
  const f = fixture({ fallback: true, loseResponse: false });
  await f.write([{ user_id: 'username:Author' }, { user_id: '', identity_key: 'username:Author' }], { writeMode: 'upsert' });
  assert.equal(f.rows.length, 2);
});

test('作者搜索旧任务仅有真实ID，恢复不要求备用标识列', async () => {
  const f = fixture({ fallback: true, loseResponse: false });
  f.rows.push({ recordId: 'existing', fields: { 'mapped-id': 'a' } });
  await f.write([{ user_id: 'a' }, { user_id: 'b' }], { reconcile: true });
  assert.equal(f.rows.length, 2);
  assert.equal(f.events.includes('addField'), false);
});

test('作者搜索恢复缺少备用标识列时保留保护，未知标识不盲目追加', async () => {
  const f = fixture({ fallback: true, loseResponse: false });
  await assert.rejects(f.write([{ user_id: '', identity_key: 'username:Author' }], { reconcile: true }), /不存在.*无法核对/);
  assert.deepEqual(f.events, []);
});

test('作者搜索没有任何稳定标识时，仍在写入前暂停整批', async () => {
  const f = fixture({ fallback: true, loseResponse: false });
  await assert.rejects(f.write([{ user_id: 'a' }, { user_id: '', nickname: 'unknown' }]), /缺失/);
  assert.deepEqual(f.events, []);
});

for (const mode of ['append', 'upsert']) {
  for (const failure of ['records', 'field']) {
    test(`作者搜索实际停止任务 ${mode}/${failure}：异常后重新进入，核对并写完后续结果`, async () => {
      const { parse: parseVue } = await import('@vue/compiler-sfc');
      const f = fixture({ fallback: true, loseResponse: failure === 'records' });
      if (failure === 'field') {
        const addField = f.table.addField;
        f.table.addField = async config => { await addField(config); throw new Error('field response lost'); };
      }
      const source = parseVue(fs.readFileSync(new URL('../src/components/BloggerSearch.vue', import.meta.url), 'utf8')).descriptor.scriptSetup.content;
      const declarations = parse(source, { sourceType: 'module' }).program.body
        .filter(n => n.type === 'VariableDeclaration').flatMap(n => n.declarations);
      const mapping = declarations.find(n => n.id.name === 'SEARCH_FIELD_MAPPING').init;
      const configs = new Function('BLOGGER_FIELD_MAPPING', 'FieldType', `return (${source.slice(mapping.start, mapping.end)});`)(
        [f.bindings.fieldMapping[0]], { Text: 'text' });
      assert.deepEqual(configs.map(config => config.key), ['user_id', 'identity_key']);
      const callback = declarations.find(n => n.id.name === 'searchTask').init.arguments[0].properties
        .find(n => n.key.name === 'writeBatch').value;
      const batch = new Function('createAndWriteData', `return (${source.slice(callback.start, callback.end)});`)(
        async (items, type, id, target, fields, options) => f.write(items, options));
      const engineSource = fs.readFileSync(new URL('../src/composables/useIncrementalTask.js', import.meta.url), 'utf8')
        .replace(/^import .*;\n/, '').replace('export const useIncrementalTask', 'const useIncrementalTask');
      let saved, finished = false, timerId = 0;
      const storage = createTaskStorage('fallback');
      const errors = [], timers = new Map();
      const bitable = { base: { getSelection: async () => ({ baseId: 'base' }) }, bridge: {
        setData: async (key, value) => { await storage.setData(key, value); saved = storage.current(); }, getData: storage.getData,
      } };
      const create = new Function('bitable', 'setTimeout', 'clearTimeout', `${engineSource};return useIncrementalTask;`)(bitable,
        fn => { timers.set(++timerId, fn); return timerId; }, id => timers.delete(id));
      const items = [{ user_id: '', identity_key: 'username:Author' }, { user_id: 'RealID' },
        { user_id: '', identity_key: 'profile_url:https://example.test/other' }];
      const open = () => create({ storageKey: 'fallback', isTerminal: () => true, getStatus: async () => ({ status: 3 }),
        getResults: async task => task.cursor === '4' ? { items: [] } : {
          items: task.cursor ? [{ user_id: 'last' }] : items,
          next_cursor: task.cursor ? '4' : '3', has_more: true,
        }, writeBatch: batch, onError: error => errors.push(error),
        onFinish: async (_, task) => { assert.equal(task.writtenCount, 4); finished = true; },
      });
      await open().start({ taskId: 'task', targetTableId: 'table', selectedFieldKeys: ['user_id'], writeMode: mode, pendingWrite: false });
      assert.match(errors[0].message, /response lost/);
      assert.equal(saved.cursor, '');
      assert.equal(saved.pendingWrite, failure === 'records');
      assert.equal(f.rows.length, failure === 'records' ? 1 : 0);
      assert.equal(await open().resume(), true);
      for (let round = 0; !finished && round < 3; round++) {
        const [id, run] = [...timers][0]; timers.delete(id); await run();
      }
      assert.ok(finished);
      assert.equal(f.rows.length, 4);
      assert.equal(new Set(f.rows.map(row => row.recordId)).size, 4);
      assert.equal(f.events.filter(event => event === 'addField').length, 1);
      assert.deepEqual(saved, {});
    });
  }
}
