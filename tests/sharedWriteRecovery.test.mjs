import { resolveWritableField } from '../src/utils/tableFields.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from '@babel/parser';

function fixture({ mapped = false, loseResponse = true, fallback = false, fallbackColumn = false } = {}) {
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
  const rows = [], events = [];
  const makeField = id => ({ id, getType: async () => 'text', createCell: async value => ({ fieldId: id, value, getValue: async () => value }) });
  const field = makeField('mapped-id');
  const metadata = [{ id: field.id, name: mapped ? '自定义ID' : '作者ID' }];
  if (fallbackColumn) metadata.push({ id: 'fallback-id', name: mapped ? '自定义标识' : '作者标识' });
  const table = {
    id: 'table', getFieldMetaList: async () => [...metadata],
    getFieldById: async id => makeField(id),
    getRecordsByPage: async () => { events.push('scan'); return { records: rows }; },
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
    isFieldTypeCompatible: () => true, FieldType: { Attachment: 'attachment' },
    normalizeCellValue: async (_, field, value) => value,
    applyFieldDisplayConfig: async () => {}, uploadAttachmentFilesInBatch: async () => {},
    prepareAttachmentPipeline: async () => {}, api_key: '',
    buildWorkUniqueKey, chunkRecords: list => list.map(item => [item]),
    upsertIndexCache: new Map(), console: { error() {} },
  };
  const write = new Function(...Object.keys(bindings), `return (${source.slice(callback.start, callback.end)});`)(...Object.values(bindings));
  const options = { stopAfterCurrentBatch: true, uniqueKey: 'user_id', writeMode: 'append',
    ...(fallback ? { fallbackUniqueKey: 'identity_key' } : {}),
    fieldMappings: mapped ? [{ source_key: 'user_id', target_field_id: field.id },
      ...(fallbackColumn ? [{ source_key: 'identity_key', target_field_id: 'fallback-id' }] : [])] : [],
    onBeforeWrite: async () => events.push('save-pending'),
  };
  return { write: (items, opts = {}) => write(items, 'stream', 'task', 'table', [], { ...options, ...opts }), rows, events, table, bindings };
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
      const errors = [], timers = new Map();
      const bitable = { base: { getSelection: async () => ({ baseId: 'base' }) }, bridge: {
        setData: async (_, value) => { saved = structuredClone(value); }, getData: async () => saved,
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
