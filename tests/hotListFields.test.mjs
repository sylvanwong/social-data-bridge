import test from 'node:test';
import { ref, computed, watch } from 'vue';
import { createTableConfigSaver } from '../src/utils/tableOutputConfig.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from '@vue/compiler-sfc';
import { parse as parseJS } from '@babel/parser';

function fieldLoader() {
  const source = parse(fs.readFileSync(new URL('../src/components/HotListFetch.vue', import.meta.url), 'utf8')).descriptor.scriptSetup.content;
  const declarations = parseJS(source, { sourceType: 'module' }).program.body
    .filter(node => node.type === 'VariableDeclaration');
  const selected = declarations.filter(node => node.declarations.some(item => ['targetFieldReadId', 'loadTargetFieldOptions'].includes(item.id.name)));
  const pending = new Map();
  const targetFieldOptions = { value: [{ id: 'previous' }] };
  const bitable = { base: { getTableById: async id => ({
    getFieldMetaList: () => new Promise((resolve, reject) => pending.set(id, { resolve, reject })),
  }) } };
  const load = new Function('bitable', 'targetFieldOptions', selected.map(node => source.slice(node.start, node.end)).join('\n') + '\nreturn loadTargetFieldOptions;')(bitable, targetFieldOptions);
  return { load, pending, targetFieldOptions };
}

for (const oldFails of [false, true]) {
  test(`热榜切表：旧请求${oldFails ? '失败' : '成功'}不覆盖新表字段`, async () => {
    const { load, pending, targetFieldOptions } = fieldLoader();
    const a = load('A');
    assert.deepEqual(targetFieldOptions.value, []);
    await Promise.resolve();
    const b = load('B');
    await Promise.resolve();
    pending.get('B').resolve([{ id: 'B-field' }]);
    await b;
    if (oldFails) pending.get('A').reject(new Error('old read failed'));
    else pending.get('A').resolve([{ id: 'A-field' }]);
    await a;
    assert.deepEqual(targetFieldOptions.value, [{ id: 'B-field' }]);
  });
}

test('热榜清空目标表：未完成的读取不能重新填入字段', async () => {
  const { load, pending, targetFieldOptions } = fieldLoader();
  const a = load('A');
  await Promise.resolve();
  await load('');
  pending.get('A').resolve([{ id: 'A-field' }]);
  await a;
  assert.deepEqual(targetFieldOptions.value, []);
});

test('热榜当前表读取失败后可以重新读取', async () => {
  const { load, pending, targetFieldOptions } = fieldLoader();
  const failed = load('B');
  await Promise.resolve();
  pending.get('B').reject(new Error('read failed'));
  await failed;
  assert.deepEqual(targetFieldOptions.value, []);
  const retry = load('B');
  await Promise.resolve();
  pending.get('B').resolve([{ id: 'B-field' }]);
  await retry;
  assert.deepEqual(targetFieldOptions.value, [{ id: 'B-field' }]);
});

for (const change of ['switch-table', 'edit-in-place']) {
  test(`热榜保存：等待期间 ${change} 不改变本次目标及映射`, async () => {
    let release;
    const writes = [];
    const formData = { value: { radio: 2, table_id: 'A' } };
    const mappingDraft = { value: [{ source_key: 'title', target_field_id: 'A-title' }] };
    const targetFieldOptions = { value: [{ id: 'A-title', name: 'A标题' }] };
    const bindings = {
      formData, mappingDraft, targetFieldOptions, props: { api_key: 'test-only' },
      bitable: { base: { getTableById: id => {
        assert.equal(id, 'A');
        return new Promise(resolve => { release = () => resolve({ getName: async () => 'A表' }); });
      } } },
      FIELD_MAPPING: [{ key: 'title', name: '标题' }], TASK_PLUGIN_TYPE: 'test', TABLE_CONFIG_API_PATH: '/test',
      getBaseId: async () => 'base', tableOutputConfigs: { value: {} },
      request: async args => { writes.push(args.data); return { data: { sta: 0, data: args.data } }; },
      console: { error: (...args) => assert.fail(args.join(' ')) },
    };
    const save = configSaver(bindings);
    const pending = save();
    if (change === 'switch-table') {
      formData.value.table_id = 'B';
      mappingDraft.value = [{ source_key: 'title', target_field_id: 'B-title' }];
      targetFieldOptions.value = [{ id: 'B-title', name: 'B标题' }];
    } else {
      mappingDraft.value[0].target_field_id = 'A-other';
      targetFieldOptions.value[0].name = '修改后的标题';
    }
    await Promise.resolve();
    release();
    await pending;
    assert.equal(writes.length, 1);
    assert.equal(writes[0].target_table_id, 'A');
    assert.deepEqual(writes[0].field_mappings, [{ source_key: 'title', target_field_id: 'A-title', source_name: '标题', target_field_name: 'A标题' }]);
  });
}

function configSaver(bindings) {
  bindings = { showErrorMsg() {}, tableConfigReady: { value: true }, tableConfigLoading: { value: false }, ...bindings };
  const source = parse(fs.readFileSync(new URL('../src/components/HotListFetch.vue', import.meta.url), 'utf8')).descriptor.scriptSetup.content;
  const nodes = parseJS(source, { sourceType: 'module' }).program.body
    .filter(node => node.type === 'VariableDeclaration' && node.declarations.some(item => ['persistTableOutputConfig', 'saveTableOutputConfig'].includes(item.id.name)));
  return new Function('createTableConfigSaver', ...Object.keys(bindings), nodes.map(node => source.slice(node.start, node.end)).join('\n') + '\nreturn saveTableOutputConfig;')(createTableConfigSaver, ...Object.values(bindings));
}

for (const failFirst of [false, true]) {
  test(`热榜同表顺序保存，首次${failFirst ? '失败' : '成功'}不阻塞后续及其他表`, async () => {
    const formData = { value: { radio: 2, table_id: 'A' } };
    const mappingDraft = { value: [{ source_key: 'title', target_field_id: 'first' }] };
    const tableOutputConfigs = { value: {} };
    const requests = [];
    const errors = [];
    const save = configSaver({
      formData, mappingDraft, tableOutputConfigs, targetFieldOptions: { value: [] }, props: { api_key: 'test-only' },
      bitable: { base: { getTableById: async id => ({ getName: async () => id }) } },
      FIELD_MAPPING: [{ key: 'title', name: '标题' }], TASK_PLUGIN_TYPE: 'test', TABLE_CONFIG_API_PATH: '/test',
      getBaseId: async () => 'base',
      request: args => new Promise((resolve, reject) => requests.push({ payload: args.data, resolve, reject })),
      console: { error: (...args) => errors.push(args) },
    });
    const first = save();
    mappingDraft.value[0].target_field_id = 'last';
    const last = save();
    formData.value.table_id = 'B';
    const other = save();
    // Flush SDK/name/base reads without resolving the outstanding HTTP requests.
    for (let i = 0; i < 12; i++) await Promise.resolve();
    assert.deepEqual(requests.map(item => item.payload.target_table_id), ['A', 'B']);
    assert.equal(requests[0].payload.field_mappings[0].target_field_id, 'first');
    requests[1].resolve({ data: { sta: 0, data: requests[1].payload } });
    await other;
    if (failFirst) requests[0].reject(new Error('first failed'));
    else requests[0].resolve({ data: { sta: 0, data: requests[0].payload } });
    await first;
    for (let i = 0; i < 12; i++) await Promise.resolve();
    assert.equal(requests.length, 3);
    assert.equal(requests[2].payload.target_table_id, 'A');
    assert.equal(requests[2].payload.field_mappings[0].target_field_id, 'last');
    requests[2].resolve({ data: { sta: 0, data: requests[2].payload } });
    await last;
    assert.equal(tableOutputConfigs.value.A.field_mappings[0].target_field_id, 'last');
    assert.equal(errors.length, failFirst ? 1 : 0);
  });
}

function configEditor() {
  const source = parse(fs.readFileSync(new URL('../src/components/HotListFetch.vue', import.meta.url), 'utf8')).descriptor.scriptSetup.content;
  const names = ['tableConfigLoading', 'tableConfigError', 'tableOutputConfigsLoaded', 'mainOutputTableId', 'tableConfigReady', 'tableConfigReadId', 'tableConfigsRequest', 'targetFieldReadId', 'loadTargetFieldOptions', 'loadTableOutputConfigs', 'applyTableOutputConfig', 'persistTableOutputConfig', 'saveTableOutputConfig'];
  const nodes = parseJS(source, { sourceType: 'module' }).program.body.filter(node => node.type === 'VariableDeclaration' && node.declarations.some(item => names.includes(item.id.name)));
  const formData = ref({ radio: 2, table_id: 'A' });
  const mappingDraft = ref([{ source_key: 'title', target_field_id: 'original' }]);
  const writes = [];
  let response = { sta: 0, data: { list: [] } };
  let fieldRead = async id => [{ id: `${id}-title`, name: id }];
  const bindings = {
    ref, computed, createTableConfigSaver, formData, mappingDraft, targetFieldOptions: ref([]), tableOutputConfigs: ref({}),
    props: { api_key: 'test-only' }, getBaseId: async () => 'base',
    bitable: { base: { getTableById: async id => ({ getFieldMetaList: () => fieldRead(id), getName: async () => id }) } },
    request: async args => {
      if (args.method === 'get') return { data: response };
      writes.push(args.data); return { data: { sta: 0, data: args.data } };
    },
    FIELD_MAPPING: [{ key: 'title', name: '标题' }], TASK_PLUGIN_TYPE: 'test', TABLE_CONFIG_API_PATH: '/one', TABLE_CONFIGS_API_PATH: '/list', console: { error() {} },
  };
  const editor = new Function(...Object.keys(bindings), nodes.map(node => source.slice(node.start, node.end)).join('\n') + '\nreturn {applyTableOutputConfig,saveTableOutputConfig,tableConfigReady,tableConfigLoading,tableConfigError};')(...Object.values(bindings));
  const stop = watch(mappingDraft, editor.saveTableOutputConfig, { deep: true, flush: 'sync' });
  return { ...editor, formData, mappingDraft, writes, stop, response: value => { response = value; }, fieldRead: value => { fieldRead = value; } };
}

test('热榜回填及切表不自动保存，成功加载后用户修改才保存', async () => {
  const e = configEditor();
  try {
    e.response({ sta: 0, data: { list: [{ target_table_id: 'A', field_mappings: [{ source_key: 'title', target_field_id: 'saved' }] }] } });
    await e.applyTableOutputConfig('A');
    assert.equal(e.tableConfigReady.value, true);
    assert.equal(e.mappingDraft.value[0].target_field_id, 'saved');
    assert.equal(e.writes.length, 0);
    e.mappingDraft.value[0].target_field_id = 'edited';
    for (let i = 0; i < 15; i++) await Promise.resolve();
    assert.equal(e.writes.length, 1);
    e.formData.value.table_id = 'B';
    await e.applyTableOutputConfig('B');
    assert.deepEqual(e.mappingDraft.value, []);
    assert.equal(e.writes.length, 1);
  } finally { e.stop(); }
});

for (const failure of ['business', 'format', 'fields']) {
  test(`热榜 ${failure} 读取失败保留草稿并阻止保存，重试恢复`, async () => {
    const e = configEditor();
    try {
      if (failure === 'business') e.response({ sta: 1, msg: 'failed' });
      if (failure === 'format') e.response({ sta: 0, data: {} });
      if (failure === 'fields') e.fieldRead(async () => { throw new Error('fields failed'); });
      await e.applyTableOutputConfig('A');
      assert.equal(e.tableConfigReady.value, false);
      assert.equal(e.tableConfigLoading.value, false);
      assert.ok(e.tableConfigError.value);
      assert.equal(e.mappingDraft.value[0].target_field_id, 'original');
      await e.saveTableOutputConfig();
      assert.equal(e.writes.length, 0);
      e.response({ sta: 0, data: { list: [] } });
      e.fieldRead(async () => []);
      await e.applyTableOutputConfig('A');
      assert.equal(e.tableConfigReady.value, true);
      assert.deepEqual(e.mappingDraft.value, []);
      assert.equal(e.writes.length, 0);
    } finally { e.stop(); }
  });
}

test('热榜快速切表：旧表字段读取失败不覆盖新表就绪状态', async () => {
  const e = configEditor();
  let rejectA;
  e.fieldRead(id => id === 'A' ? new Promise((_, reject) => { rejectA = reject; }) : Promise.resolve([]));
  try {
    const a = e.applyTableOutputConfig('A');
    for (let i = 0; i < 12; i++) await Promise.resolve();
    e.formData.value.table_id = 'B';
    await e.applyTableOutputConfig('B');
    rejectA(new Error('old failure'));
    await a;
    assert.equal(e.tableConfigReady.value, true);
    assert.equal(e.tableConfigError.value, '');
    assert.equal(e.writes.length, 0);
  } finally { e.stop(); }
});

for (const failure of ['business', 'network']) {
  test(`热榜保存${failure}失败保留缓存和草稿并提示，后续成功才更新缓存`, async () => {
    const original = { field_mappings: [{ source_key: 'title', target_field_id: 'saved' }] };
    const tableOutputConfigs = { value: { A: original } };
    const mappingDraft = { value: [{ source_key: 'title', target_field_id: 'edited' }] };
    const messages = [];
    let succeeds = false;
    const save = configSaver({
      formData: { value: { radio: 2, table_id: 'A' } }, mappingDraft, tableOutputConfigs,
      targetFieldOptions: { value: [] }, props: { api_key: 'test-only' },
      bitable: { base: { getTableById: async () => ({ getName: async () => 'A' }) } },
      FIELD_MAPPING: [{ key: 'title', name: '标题' }], TASK_PLUGIN_TYPE: 'test', TABLE_CONFIG_API_PATH: '/test',
      getBaseId: async () => 'base', console: { error() {} }, showErrorMsg: message => messages.push(message),
      request: async args => {
        if (succeeds) return { data: { sta: 0, data: args.data } };
        if (failure === 'network') throw new Error('network failed');
        return { data: { sta: 1, msg: 'save failed' } };
      },
    });
    await save();
    assert.equal(tableOutputConfigs.value.A, original);
    assert.equal(mappingDraft.value[0].target_field_id, 'edited');
    assert.deepEqual(messages, ['保存表格配置失败，请重试']);
    succeeds = true;
    await save();
    assert.equal(tableOutputConfigs.value.A.field_mappings[0].target_field_id, 'edited');
    assert.equal(messages.length, 1);
  });
}

for (const existing of [false, true]) {
  test(`热榜${existing ? '现有表使用自定义映射' : '切换新建表忽略旧映射'}：字段设置与写入保持一致`, async () => {
    const source = parse(fs.readFileSync(new URL('../src/components/HotListFetch.vue', import.meta.url), 'utf8')).descriptor.scriptSetup.content;
    const names = ['resolveFieldId', 'setupTableFields', 'writeDataToTable'];
    const nodes = parseJS(source, { sourceType: 'module' }).program.body.filter(node => node.type === 'VariableDeclaration' && node.declarations.some(item => names.includes(item.id.name)));
    const accessed = [];
    const written = [];
    const expected = existing ? 'custom-rank' : 'new-rank';
    const table = {
      getFieldMetaList: async () => [{ id: 'new-rank', name: '排名' }],
      getFieldById: async id => {
        accessed.push(id);
        assert.equal(id, expected);
        return { getType: async () => 2, createCell: async value => ({ fieldId: id, value }) };
      },
      addRecords: async records => written.push(...records),
    };
    const bindings = {
      mappingDraft: { value: [{ source_key: 'rank', target_field_id: 'custom-rank' }] },
      getActiveFieldMapping: () => [{ key: 'rank', name: '排名', type: 2 }],
      bitable: { base: { getTableById: async () => table } },
      isFieldTypeCompatible: (actual, config) => actual === config.type,
      normalizeValue: value => value, showToast() {},
    };
    const api = new Function(...Object.keys(bindings), nodes.map(node => source.slice(node.start, node.end)).join('\n') + '\nreturn {setupTableFields,writeDataToTable};')(...Object.values(bindings));
    await api.setupTableFields('target', !existing);
    await api.writeDataToTable(table, [{ rank: 1 }], existing);
    assert.deepEqual(accessed, [expected, expected]);
    assert.deepEqual(written, [[{ fieldId: expected, value: 1 }]]);
  });
}

function mappingRules(draft, selected = ['rank', 'hot_value']) {
  const source = parse(fs.readFileSync(new URL('../src/components/HotListFetch.vue', import.meta.url), 'utf8')).descriptor.scriptSetup.content;
  const names = ['getMappingTargetFields', 'resolveFieldId', 'setupTableFields'];
  const nodes = parseJS(source, { sourceType: 'module' }).program.body.filter(node => node.type === 'VariableDeclaration' && node.declarations.some(item => names.includes(item.id.name)));
  const fields = [{ id: 'rank', name: '排名', type: 2 }, { id: 'heat', name: '热度值', type: 2 }, { id: 'other', name: '其他', type: 2 }];
  const configs = [{ key: 'rank', name: '排名', type: 2 }, { key: 'hot_value', name: '热度值', type: 2 }];
  const mutations = [];
  const bindings = {
    mappingDraft: { value: draft }, targetFieldOptions: { value: fields },
    getActiveFieldMapping: () => configs.filter(item => selected.includes(item.key)),
    bitable: { base: { getTableById: async () => ({ getFieldMetaList: async () => fields,
      getFieldById: async () => ({ getType: async () => 2 }),
      addField: async data => mutations.push(data), setField: async data => mutations.push(data),
    }) } }, isFieldTypeCompatible: () => true,
  };
  return { ...new Function(...Object.keys(bindings), nodes.map(node => source.slice(node.start, node.end)).join('\n') + '\nreturn {getMappingTargetFields,setupTableFields};')(...Object.values(bindings)), mutations };
}

test('热榜下拉：默认同名列置灰并注明占用者，自己的列可选', () => {
  const api = mappingRules([{ source_key: 'hot_value', target_field_id: '' }]);
  const options = api.getMappingTargetFields(0);
  assert.equal(options[0].disabled, true);
  assert.equal(options[0].disabledReason, '已被「排名」占用');
  assert.equal(options[1].disabled, false);
});

test('热榜下拉：改映射后释放默认列，取消输出也释放占用', () => {
  const draft = [{ source_key: 'rank', target_field_id: 'other' }, { source_key: 'hot_value', target_field_id: '' }];
  const options = mappingRules(draft).getMappingTargetFields(1);
  assert.equal(options[0].disabled, false);
  assert.equal(options[2].disabled, true);
  assert.equal(options[2].disabledReason, '已被「排名」占用');
  assert.equal(mappingRules(draft, ['hot_value']).getMappingTargetFields(1)[2].disabled, false);
  assert.equal(mappingRules(draft).getMappingTargetFields(0)[2].disabled, false);
});

test('热榜执行：旧映射与默认列冲突时，在改表前拦截；新建表不受旧映射影响', async () => {
  const api = mappingRules([{ source_key: 'hot_value', target_field_id: 'rank' }]);
  await assert.rejects(api.setupTableFields('A'), /排名.*热度值.*同一列/);
  assert.deepEqual(api.mutations, []);
  await api.setupTableFields('new', true);
});
