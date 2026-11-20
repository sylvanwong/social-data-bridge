import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc';
import { loadModules, fakeTable } from '../../social-blogger-search/tests/helpers.mjs';
import { mountComponent, flush, deferred } from '../../social-comment-assistant/tests/helpers/component.mjs';
import { installSDKCells } from './helpers/sdkTable.mjs';
import { bitable } from '@lark-base-open/js-sdk';
const root = fileURLToPath(new URL('..', import.meta.url));
const text = node => (node.text || '') + (node.children || []).map(text).join('');
async function fixture(t, request) {
  const loaded = await loadModules(['/src/components/ProductSearch.vue', 'vue'], 'development', { root, mockAxios: true });
  t.after(() => loaded.close());
  const component = loaded.modules[0].default, Vue = loaded.modules[1], requests = [];
  loaded.state.axiosHandler = async config => { requests.push(structuredClone(config)); return request ? request(config) : { data: { sta: 0, data: [] } }; };
  const filename = `${root}/src/components/ProductSearch.vue`;
  const { descriptor } = parse(fs.readFileSync(filename, 'utf8'));
  const script = compileScript(descriptor, { id: 'product-search' });
  const template = compileTemplate({ source: descriptor.template.content, filename, id: 'product-search', compilerOptions: { bindingMetadata: script.bindings, hoistStatic: false } });
  assert.deepEqual(template.errors, []);
  const render = template.code.replace(/import \{([^}]+)\} from "vue"/, (_, names) => `const {${names.replace(/ as /g, ': ')}} = Vue`).replace('export function render', 'function render');
  const Slot = { setup: (_, { slots }) => () => Vue.h('div', slots.default?.()) };
  const components = Object.fromEntries([...descriptor.template.content.matchAll(/<(el-[\w-]+)/g)].map(([, name]) => [name, Slot]));
  const host = mountComponent({ components, setup() { const state = component.setup({ api_key: 'test-only' }, { expose() {}, emit() {} }); state.TaskFeedback = Slot; return state; }, render: new Function('Vue', `${render};return render`)(Vue) }, { runtime: Vue, components, provides: [[Symbol.for('v-scx'), {}]] });
  let unmounted = false;
  const unmount = () => { if (!unmounted) { host.app.unmount(); unmounted = true; } };
  t.after(unmount);
  for (let i = 0; i < 6; i++) { await new Promise(setImmediate); await flush(); }
  return { ...loaded, ...host, requests, unmount, storage: loaded.state };
}
test('平台切换只显示对应搜索设置，输出字段默认选择符合方案', async t => {
  const f = await fixture(t);
  assert.match(text(f.root), /商品排序/); assert.match(text(f.root), /商品服务/);
  assert.equal(f.state.selectedKeys.value.length, 19); assert.equal(f.state.FIELD_CONFIG.length, 19);
  f.state.form.value.platform = 'xhs'; await flush();
  assert.doesNotMatch(text(f.root), /商品排序|价格区间|商品服务|最近|定时任务/); assert.match(text(f.root), /全部商品/);
});
test('后台分页结果写入同一新表，未知数值和真实零保持区别', async t => {
  const f = await fixture(t, config => {
    if (config.url.endsWith('/task')) return { data: { sta: 0, data: { task_id: 'new-table-task' } } };
    if (config.method === 'get') return { data: { sta: 0, data: { status: 1, processed: 2 } } };
    const rows = config.data.after_id === 'one' ? [{ sku_id: 'sku2', title: '商品', price: 0, sold_count: 0 }] : config.data.after_id ? [] : [{ sku_id: 'sku1', title: '商品', price: 0, sold_count: null }];
    return { data: { sta: 0, data: { data: rows, next_cursor: rows[0]?.sku_id === 'sku1' ? 'one' : 'two', has_more: config.data.after_id === '', count: 2 } } };
  });
  const create = f.sdk.base.addTable;
  f.sdk.base.addTable = async config => { const result = await create(config), table = f.storage.tables.at(-1); table.fields.push({ id: 'primary', name: '文本', type: 1 }); await installSDKCells(table, bitable); return result; };
  Object.assign(f.state.form.value, { platform: 'xhs', keyword: '商品', pages: 2 });
  f.state.selectedKeys.value.push('sold_count'); await flush(); await f.state.handleSubmit();
  assert.equal(f.storage.tables.length, 1);
  const table = f.storage.tables[0]; assert.equal(table.records.length, 2);
  const sales = table.fields.find(field => field.name === '销量').id;
  assert.equal(table.records[0].fields[sales], null); assert.equal(table.records[1].fields[sales], 0);
  assert.equal(f.requests[0].data.pages, 2); assert.deepEqual(f.requests[0].data.filter_config, {});
  assert.equal(f.storage.saved.product_search_stream_task_v1.cursor, 'two');
});
test('已有表显式映射实际SDK更新，保留原列类型及未选字段', async t => {
  const f = await fixture(t, config => {
    if (config.url.includes('table-output-config')) return { data: { sta: 0, data: [] } };
    if (config.url.endsWith('/task')) return { data: { sta: 0, data: { task_id: 'mapped-task' } } };
    if (config.method === 'get') return { data: { sta: 0, data: { status: 1 } } };
    return { data: { sta: 0, data: { data: config.data.after_id ? [] : [{ product_id: 'p', sku_id: 's', title: '新标题', price: 0 }], next_cursor: 'mapped-cursor', has_more: false } } };
  });
  const table = fakeTable('target', '商品', [{ id: 'id', name: '自定义ID', type: 1 }, { id: 'price', name: '自定义价格', type: 1 }, { id: 'other', name: '其他', type: 1 }], [{ recordId: 'old', fields: { id: [{ type: 'text', text: 'p' }], other: '保留' } }]);
  await installSDKCells(table, bitable); f.storage.tables.push(table);
  Object.assign(f.state.form.value, { keyword: '商品', targetType: 'existing', targetTableId: 'target' });
  await flush(); await f.state.loadTarget();
  f.state.selectedKeys.value = ['product_id', 'price'];
  f.state.mappings.value = [{ source_key: 'product_id', target_field_id: 'id' }, { source_key: 'price', target_field_id: 'price' }]; await flush();
  const fields = structuredClone(table.fields); await f.state.handleSubmit();
  assert.deepEqual(table.fields, fields); assert.equal(table.records.length, 1);
  assert.deepEqual(table.records[0].fields.price, [{ type: 'text', text: '0' }]); assert.equal(table.records[0].fields.other, '保留');

});
test('创建响应晚于卸载时保留任务身份，不继续查询或写表', async t => {
  const pending = deferred(); const f = await fixture(t, () => pending.promise);
  f.state.form.value.keyword = '商品'; const work = f.state.handleSubmit(); await flush();
  f.unmount(); pending.resolve({ data: { sta: 0, data: { task_id: 'late-created-task' } } }); await work;
  assert.equal(f.storage.tables.length, 0); assert.equal(f.requests.length, 1);
  assert.equal(f.storage.saved.product_search_stream_task_v1.taskId, 'late-created-task');
});

test('旧目标表配置晚返回不覆盖新表，读取失败时阻止请求和写表', async t => {
  const pending = deferred(); let configReads = 0;
  const f = await fixture(t, config => {
    assert.match(config.url, /table-output-config/);
    configReads++;
    return configReads === 1 ? pending.promise : { data: { sta: 0, data: [] } };
  });
  f.storage.tables.push(fakeTable('A', 'A'), fakeTable('B', 'B'));
  Object.assign(f.state.form.value, { targetType: 'existing', targetTableId: 'A', keyword: '商品' });
  for (let i = 0; i < 4; i++) { await new Promise(setImmediate); await flush(); }
  assert.equal(configReads, 1);
  f.state.form.value.targetTableId = 'B';
  for (let i = 0; i < 4; i++) { await new Promise(setImmediate); await flush(); }
  assert.equal(f.state.loadedTableId.value, 'B');
  pending.resolve({ data: { sta: 0, data: [{ target_table_id: 'A', write_mode: 'append', field_mappings: [{ source_key: 'title', target_field_id: 'a-title' }] }] } });
  await flush();
  assert.equal(f.state.loadedTableId.value, 'B'); assert.equal(f.state.form.value.writeMode, 'upsert');
  assert.deepEqual(f.state.mappings.value, []);
  f.state.form.value.targetTableId = 'missing'; await flush(); await f.state.loadTarget();
  assert.match(f.state.targetError.value, /Missing table/);
  const before = f.requests.length; await f.state.handleSubmit();
  assert.equal(f.requests.length, before); assert.equal(f.storage.tables.length, 2);
});


test('飞书商品搜索业务错误显示原始信息且不写表', async t => {
  const f = await fixture(t, () => ({ data: { sta: -1, msg: '商品搜索暂不可用', data: {} } }));
  f.state.form.value.keyword = '商品'; await f.state.handleSubmit();
  assert.equal(f.storage.tables.length, 0);
  assert.match(f.state.toastText.value, /商品搜索暂不可用/);
  assert.equal(f.state.loading.value, false);
});

test('后台任务创建后查询状态、读取结果并调用后端停止接口', async t => {
  const requests = [];
  const f = await fixture(t, config => {
    requests.push(config);
    if (config.method === 'get') return { data: { sta: 0, data: { status: 0, processed: 0 } } };
    if (config.url.endsWith('/task')) return { data: { sta: 0, data: { task_id: 'task-product' } } };
    return { data: { sta: 0, data: { data: [], has_more: false, next_cursor: '' } } };
  });
  f.state.form.value.keyword = '商品'; await f.state.handleSubmit();
  assert.equal(requests[0].url, '/socialdatax/api/v1/feishu/product/search/task');
  assert.equal(requests[0].data.filter_config.sort_type, 'general');
  assert.equal(f.storage.saved.product_search_stream_task_v1.taskId, 'task-product');
  assert.ok(requests.some(r => r.url.includes('/task?task_id=')));
  assert.ok(requests.some(r => r.url.endsWith('/list')));
  await f.state.handleAction();
  assert.equal(requests.at(-1).url, '/socialdatax/api/v1/feishu/product/search/task/cancel');
  assert.equal(f.state.stopping.value, true);
});

test('恢复原任务来源及游标，不重新创建任务', async t => {
  const f = await fixture(t, config => ({ data: { sta: 0, data: config.method === 'get' ? { status: 3, cancel_requested: true } : { data: [], next_cursor: 'saved-cursor', has_more: false, count: 7 } } }));
  f.storage.saved.product_search_stream_task_v1 = { taskId: 'saved-product-task', cursor: 'saved-cursor', writtenCount: 7, pendingWrite: false,
    apiBaseUrl: 'https://saved.example', apiPathPrefix: '/socialdatax/api', formData: { ...f.state.form.value, keyword: '原关键词' }, selectedFieldKeys: ['product_id'], fieldMappings: [], writeMode: 'upsert' };
  await f.state.resumeSavedTask();
  assert.equal(f.requests[0].baseURL, 'https://saved.example');
  assert.equal(f.requests[1].data.after_id, 'saved-cursor');
  assert.ok(!f.requests.some(r => r.method === 'post' && r.url.endsWith('/task')));
  assert.match(f.state.toastText.value, /已停止.*7 条商品/);
  assert.deepEqual(f.storage.saved.product_search_stream_task_v1, {});
});

test('始终新增写入已生效但响应失败，恢复只补本批未写行，不覆盖历史行', async t => {
  const f = await fixture(t, config => {
    if (config.url.includes('table-output-config')) return { data: { sta: 0, data: [] } };
    if (config.method === 'get') return { data: { sta: 0, data: { status: 1 } } };
    if (config.url.endsWith('/task')) return { data: { sta: 0, data: { task_id: 'append-task' } } };
    return { data: { sta: 0, data: { data: config.data.after_id ? [] : [{ product_id: 'p', title: '商品' }], next_cursor: 'append-cursor', has_more: false } } };
  });
  const table = fakeTable('append-table', '商品', [{ id: 'id', name: '商品ID', type: 1 }], [{ recordId: 'old', fields: { id: [{ type: 'text', text: 'p' }] } }]);
  await installSDKCells(table, bitable); f.storage.tables.push(table);
  Object.assign(f.state.form.value, { keyword: '商品', targetType: 'existing', targetTableId: table.id });
  await flush(); await f.state.loadTarget();
  f.state.form.value.writeMode = 'append'; f.state.selectedKeys.value = ['product_id']; await flush();
  const add = table.addRecords; let failed = false;
  table.addRecords = async rows => { const result = await add(rows); if (!failed) { failed = true; throw new Error('写入响应失败'); } return result; };
  await f.state.handleSubmit();
  assert.equal(table.records.length, 2);
  assert.equal(f.state.hasRecoverableTask.value, true);
  assert.equal(f.storage.saved.product_search_stream_task_v1.pendingWrite, true);
  await f.state.resumeSavedTask();
  assert.equal(table.records.length, 2, '同批已写行不应再次追加，历史行不抵扣本批');
  assert.equal(f.storage.saved.product_search_stream_task_v1.cursor, 'append-cursor');
});

test('已有表任务恢复完成后重新加载输出配置，可以继续执行', async t => {
  const f = await fixture(t, config => {
    if (config.url.includes('table-output-config')) return { data: { sta: 0, data: [] } };
    return { data: { sta: 0, data: config.method === 'get' ? { status: 1 } : { data: [], has_more: false } } };
  });
  f.storage.tables.push(fakeTable('restored-target', '商品'));
  f.storage.saved.product_search_stream_task_v1 = {
    taskId: 'finished-task', cursor: '', writtenCount: 1, pendingWrite: false,
    formData: { ...f.state.form.value, keyword: '商品', targetType: 'existing', targetTableId: 'restored-target' },
    selectedFieldKeys: ['product_id'], fieldMappings: [], writeMode: 'upsert', targetTableId: 'restored-target',
  };
  await f.state.resumeSavedTask(); await flush();
  for (let i = 0; i < 4; i++) { await new Promise(setImmediate); await flush(); }
  assert.equal(f.state.hasRecoverableTask.value, false);
  assert.equal(f.state.outputReady.value, true);
  assert.equal(f.state.loadedTableId.value, 'restored-target');
});
