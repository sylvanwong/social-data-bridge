import { resolveWritableField } from '../src/utils/tableFields.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from '@babel/parser';
import { parse as parseVue } from '@vue/compiler-sfc';

const writerSource = fs.readFileSync(new URL('../src/composables/useSocialData.js', import.meta.url), 'utf8');
let writerNode, setupNode;
const keyDeclarations = [];
function visit(node) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'VariableDeclarator' && node.id.name === 'createAndWriteData') writerNode = node.init;
  if (node.type === 'VariableDeclarator' && node.id.name === 'setupTableFields') setupNode = node.init;
  if (node.type === 'VariableDeclarator' && ['normalizeUniqueKeyPart', 'buildWorkUniqueKey'].includes(node.id.name)) {
    keyDeclarations.push(`const ${writerSource.slice(node.start, node.end)};`);
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') visit(value);
  }
}
visit(parse(writerSource, { sourceType: 'module' }));
const buildWorkUniqueKey = new Function(`${keyDeclarations.join('\n')} return buildWorkUniqueKey;`)();
const engineSource = fs.readFileSync(new URL('../src/composables/useIncrementalTask.js', import.meta.url), 'utf8')
  .replace(/^import .*;\n/, '').replace('export const useIncrementalTask', 'const useIncrementalTask');

function fixture(component, engineName, key, failure) {
  const configs = [{ key, name: '稳定ID', type: 'text' }, { key: 'title', name: '标题', type: 'text' }];
  let saved, failed = false, created = 0, saveReadyFails = false;
  const fields = new Map(), rows = [], errors = [], adds = [];
  const field = meta => ({ ...meta, getType: async () => meta.type, createCell: async value => ({ fieldId: meta.id, value, getValue: async () => value }) });
  const table = { id: 'created',
    getField: async name => { const meta = [...fields.values()].find(meta => meta.name === name); return meta && field(meta); },
    getFieldById: async id => field(fields.get(id)),
    getFieldMetaList: async () => [...fields.values()],
    setField: async (id, config) => {
      if (failure === 'before-fields' && !failed) { failed = true; throw new Error('setup failed'); }
      fields.set(id, { id, ...config });
    },
    addField: async config => {
      if (failure === 'partial-fields' && !failed) { failed = true; throw new Error('setup failed'); }
      const id = `field-${fields.size}`; fields.set(id, { id, ...config }); adds.push(config.name);
      if (failure === 'field-response-lost' && !failed) { failed = true; throw new Error('setup failed'); }
      return id;
    },
    addRecords: async records => {
      assert.equal(saved.initializingTableId || '', '', '初始化完成标记必须先持久化');
      assert.equal(saved.pendingWrite, true);
      const created = records.map(cells => ({ recordId: `row-${rows.length}`, fields: Object.fromEntries(cells.map(cell => [cell.fieldId, cell.value])) }));
      rows.push(...created); return created.map(record => record.recordId);
    },
    getRecordsByPage: async () => ({ records: rows, hasMore: false }),
  };
  const bitable = { base: { getSelection: async () => ({ baseId: 'base' }), getTable: async () => table, getTableById: async () => table },
    ui: { switchToTable: async () => {} }, bridge: {
      getData: async () => structuredClone(saved),
      setData: async (_, task) => {
        if (saveReadyFails && task.taskId && !task.initializingTableId) { saveReadyFails = false; throw new Error('ready save failed'); }
        saved = structuredClone(task);
      },
    },
  };
  const bindings = { resolveWritableField, bitable, fieldMapping: configs, getActiveFieldMapping: () => [...configs],
    getTableName: () => 'test', createSequentialTable: async () => { created++; fields.set('default', { id: 'default', name: '文本', type: 'text' }); return { tableId: 'created' }; },
    resolveFieldMetaByConfig: (map, cfg) => ({ fieldMeta: map.get(cfg.name) }),
    isFieldTypeCompatible: () => true, applyFieldDisplayConfig: async () => {},
    buildWorkUniqueKey, normalizeCellValue: async (_, field, value) => value,
    FieldType: { Attachment: 'attachment' }, prepareAttachmentPipeline: async () => {}, uploadAttachmentFilesInBatch: async () => {},
    upsertIndexCache: new Map(), chunkRecords: items => [items], api_key: '',
    console: { error() {} }, showErrorMsg() {}, ElNotification() {}, ElMessage() {}, resetParams() {},
  };
  bindings.setupTableFields = new Function(...Object.keys(bindings), `return (${writerSource.slice(setupNode.start, setupNode.end)});`)(...Object.values(bindings));
  const write = new Function(...Object.keys(bindings), `return (${writerSource.slice(writerNode.start, writerNode.end)});`)(...Object.values(bindings));
  const source = parseVue(fs.readFileSync(new URL(`../src/components/${component}.vue`, import.meta.url), 'utf8')).descriptor.scriptSetup.content;
  const taskNode = parse(source, { sourceType: 'module' }).program.body.filter(n => n.type === 'VariableDeclaration').flatMap(n => n.declarations).find(n => n.id.name === engineName);
  const batch = taskNode.init.arguments[0].properties.find(n => n.key.name === 'writeBatch').value;
  const batchFn = new Function('createAndWriteData', 'showProfileFieldProgress', 'showFieldProgress', `return (${source.slice(batch.start, batch.end)});`)(write, () => {}, () => {});
  const timers = new Map(); let id = 0;
  const create = new Function('bitable', 'setTimeout', 'clearTimeout', `${engineSource};return useIncrementalTask;`)(bitable,
    fn => { timers.set(++id, fn); return id; }, id => timers.delete(id));
  const open = () => create({ storageKey: 'test', getStatus: async () => ({ status: 3 }), isTerminal: () => true,
    getResults: async task => ({ items: task.cursor === '2' ? [] : [{ [key]: task.cursor ? 'b' : 'a', title: '内容' }], next_cursor: task.cursor ? '2' : '1', has_more: true }),
    writeBatch: batchFn, onError: error => errors.push(error),
  });
  return { open, write, fields, rows, errors, adds, saved: () => saved, created: () => created,
    failReadySave: () => { saveReadyFails = true; },
    finish: async () => { for (const [id, fn] of [...timers]) { timers.delete(id); await fn(); } },
    initial: { taskId: 'task', selectedFieldKeys: [key, 'title'], writeMode: 'append', pendingWrite: false },
  };
}

const pages = [['ProfileFetch', 'profileStreamTask', 'aweme_id'], ['KeywordSearch', 'keywordStreamTask', 'aweme_id'],
  ['BloggerSearch', 'searchTask', 'user_id'], ['SeriesFetch', 'seriesStreamTask', 'series_id']];
for (const page of pages) {
  for (const failure of ['before-fields', 'partial-fields', 'field-response-lost']) {
    test(`${page[0]} ${failure}：恢复仅补缺失字段，原表写完剩余结果`, async () => {
      const f = fixture(...page, failure);
      await f.open().start(f.initial);
      assert.match(f.errors[0].message, /setup failed/);
      assert.equal(f.saved().initializingTableId, 'created');
      assert.equal(f.saved().pendingWrite, false); assert.equal(f.rows.length, 0); assert.equal(f.saved().cursor, '');
      await f.open().resume();
      assert.equal(f.rows.length, 2); assert.equal(f.saved().cursor, '2'); assert.equal(f.created(), 1);
      assert.equal([...f.fields.values()].filter(f => f.name === '标题').length, 1);
      assert.equal([...f.fields.values()].filter(f => f.name === '稳定ID').length, 1);
      assert.equal(f.saved().initializingTableId, '');
      await f.finish(); assert.deepEqual(f.saved(), {});
    });
  }
}

test('初始化完成标记保存失败：不写记录，下次恢复不重复创建字段', async () => {
  const f = fixture(...pages[0], 'field-response-lost');
  await f.open().start(f.initial); f.failReadySave();
  await f.open().resume(); assert.equal(f.rows.length, 0); assert.equal(f.saved().initializingTableId, 'created');
  await f.open().resume(); assert.equal(f.rows.length, 2); assert.deepEqual(f.adds, ['标题']); await f.finish();
});

for (const initializingTableId of [undefined, 'other', 'created']) {
  test(`已进入核对阶段或不匹配标记${initializingTableId}：不能补建缺失字段`, async () => {
    const f = fixture(...pages[0], 'field-response-lost');
    f.fields.set('id', { id: 'id', name: '稳定ID', type: 'text' });
    await assert.rejects(f.write([{ aweme_id: 'a', title: '内容' }], 'stream', 'task', 'created', ['aweme_id', 'title'], {
      stopAfterCurrentBatch: true, writeMode: 'append', reconcile: true, initializingTableId,
    }), /标题.*不可用/);
    assert.deepEqual(f.adds, []); assert.equal(f.rows.length, 0);
  });
}

for (const page of pages) {
  test(`${page[0]} 旧任务尚未建表：首次建表初始化失败后也能补齐并写完`, async () => {
    const f = fixture(...page, 'before-fields');
    const initial = { ...f.initial }; delete initial.pendingWrite;
    await f.open().start(initial);
    assert.equal(f.saved().initializingTableId, 'created');
    assert.equal(f.saved().pendingWrite, false);
    await f.open().resume(); assert.equal(f.rows.length, 2); assert.equal(f.created(), 1);
    await f.finish(); assert.deepEqual(f.saved(), {});
  });
}
