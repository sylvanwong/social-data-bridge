import test from 'node:test';
import assert from 'node:assert/strict';
import { bitable } from '@lark-base-open/js-sdk';
import { fakeTable, loadModules } from '../../social-blogger-search/tests/helpers.mjs';
import { mountComponent, deferred } from '../../social-comment-assistant/tests/helpers/component.mjs';
import { installSDKCells } from './helpers/sdkTable.mjs';
const root = new URL('..', import.meta.url).pathname;
const TASK_KEY = 'product_review_incremental_task_v1';
const item = { _id: 'c1', review_id: 'AbC', social_type: 'douyin', product_url: 'https://haohuo.jinritemai.com/ecommerce/trade/detail/index.html?id=1', user_name: '买家', review_time: '11月18日', review_type: 'positive', sku_text: '', content: '初评', media_urls: 'https://img/1\nhttps://img/2', helpful_count: 0, like_count: null, additional_content: '追评', additional_time: '昨天', additional_media_urls: '', replies: '商家：谢谢' };
async function fixture(t, options = {}) {
  const host = await loadModules(['/src/components/ProductReviewFetch.vue', 'vue'], 'development', { root, mockAxios: true });
  const Vue = host.modules[1], requests = [], saves = [], control = { status: 1, statusRead: options.statusRead || null, read: null, create: null, results: null };
  host.state.saved = structuredClone(options.saved || {});
  const table = fakeTable('B', '评价表', [{ id: 'id', name: '评价ID', type: 1 }, { id: 'text', name: '原评价', type: 1 }, { id: 'url', name: '自定义链接', type: 1 }, { id: 'count', name: '有用', type: 2 }, { id: 'notes', name: '备注', type: 1 }], options.rows || []);
  const source = fakeTable('A', '来源', [{ id: 'source', name: '商品地址', type: 15 }], [{ recordId: 'source-row', fields: { source: { link: item.product_url } } }]);
  const getSource = source.getFieldById;
  source.getFieldById = async id => ({ ...await getSource(id), getCell: async recordId => ({ getValue: async () => source.records.find(r => r.recordId === recordId).fields[id] }) });
  const view = { id: 'view-A', getFieldMetaList: () => source.getFieldMetaList(), getVisibleRecordIdListByPage: async () => ({ recordIds: ['source-row'], hasMore: false }), getSelectedRecordIdList: async () => ['source-row'] };
  source.getViewById = async id => { assert.equal(id, 'view-A'); return view; };
  source.getActiveView = async () => { throw new Error('任务必须使用捕获视图'); };
  host.state.tables.push(source, table);
  await installSDKCells(table, bitable);
  const createTable = host.sdk.base.addTable;
  host.sdk.base.addTable = async config => { const result = await createTable(config); const created = host.state.tables.at(-1); created.fields.push({ id: 'primary', name: 'Primary field', type: 1 }); await installSDKCells(created, bitable); return result; };
  let selection = { baseId: 'base-1', tableId: 'A', viewId: 'view-A' };
  host.sdk.base.getSelection = async () => ({ ...selection });
  host.sdk.bridge.getData = async key => options.getData ? options.getData(key) : structuredClone(host.state.saved[key]);
  host.sdk.bridge.setData = async (key, value) => { const snap = JSON.parse(JSON.stringify(value)); await options.save?.(key, snap); host.state.saved[key] = snap; saves.push([key, snap]); };
  control.results = options.results || null;
  host.state.axiosHandler = async config => {
    requests.push(structuredClone(config));
    if (config.url.endsWith('table-output-configs') && config.method === 'get') {
      if (control.read) return control.read(config);
      return { data: { sta: 0, data: [{ target_table_id: 'B', write_mode: options.mode || 'upsert', field_mappings: [{ source_key: 'content', target_field_id: 'text' }, { source_key: 'product_url', target_field_id: 'url' }] }] } };
    }
    if (config.url.endsWith('table-output-config') && config.method === 'put') return { data: { sta: 0, data: config.data } };
    if (config.url.endsWith('/task/cancel')) return { data: { sta: 0, data: { status: 0, cancel_requested: true } } };
    if (config.url.endsWith('/task') && config.method === 'post') return control.create ? control.create(config) : { data: { sta: 0, data: { task_id: 'task-1' } } };
    if (config.url.endsWith('/task') || config.url.includes('?task_id=')) return control.statusRead ? control.statusRead(config) : { data: { sta: 0, data: { status: control.status, processed: 1, total: 1, reason: control.status === 2 ? '平台错误' : undefined } } };
    if (config.url.endsWith('/list')) return control.results ? control.results(config) : { data: { sta: 0, data: { data: config.data.after_id ? [] : [item], next_cursor: 'c1', has_more: true, count: 1 } } };
    throw new Error(`unexpected ${config.url}`);
  };
  let s;
  const mounted = mountComponent({ setup() { s = host.modules[0].default.setup({ api_key: 'test-only' }, { expose() {}, emit() {} }); return { ...s }; }, render: () => Vue.h('div') }, { runtime: Vue, provides: [[Symbol.for('v-scx'), {}]] });
  const flush = async () => { for (let i = 0; i < 6; i++) { await new Promise(setImmediate); await Vue.nextTick(); } };
  t.after(async () => { mounted.app.unmount(); await host.close(); });
  await flush();
  Object.assign(s.formData.value, { mode: 'manual', manualUrls: item.product_url, radio: 2, table_id: 'B' });
  s.selectedFieldKeys.value = ['review_id', 'content', 'product_url', 'helpful_count'];
  await flush();
  return { s, host, table, source, requests, saves, control, flush, unmount: () => mounted.app.unmount(), selection: v => { selection = v; }, submit: () => s.handleSubmit(), task: () => host.state.saved[TASK_KEY] };
}

test('商品任务：没有恢复进度时读取期间不显示恢复toast', async t => {
  const pending = deferred();
  const f = await fixture(t, { getData: () => pending.promise });
  try { assert.equal(f.s.toastVisible.value, false); }
  finally { pending.resolve(undefined); await f.flush(); }
  assert.equal(f.s.toastVisible.value, false);
});

test('商品任务：现有表格配置读取用复数路径，保存用单数路径', async t => {
  const f = await fixture(t);
  await f.s.loadTableOutputConfigs();
  await f.flush();
  f.s.formData.value.writeMode = 'append';
  await f.flush();

  assert.ok(f.requests.some(r => r.method === 'get' && r.url.endsWith('/table-output-configs')));
  const save = f.requests.find(r => r.method === 'put' && /table-output-configs?$/.test(r.url));
  assert.ok(save, '应保存表格输出配置');
  assert.ok(save.url.endsWith('/table-output-config'));
});

test('商品任务：发现未完成任务后才显示恢复toast', async t => {
  const pendingStatus = deferred();
  const f = await fixture(t, {
    saved: { [TASK_KEY]: {
      taskId: 'task-restore', baseId: 'base-1', targetTableId: 'B', apiPrefix: '',
      sourceSnapshot: { mode: 'manual', manualUrls: item.product_url }, requestSnapshot: { url: item.product_url, pages: 1, reply_pages: -1, sort_type: 'general' },
      selectedFieldKeys: ['review_id'], fieldMappings: [], writeMode: 'upsert', cursor: '', writtenCount: 0,
    } },
    statusRead: () => pendingStatus.promise,
  });
  assert.equal(f.s.toastVisible.value, true);
  assert.match(f.s.toastText.value, /正在恢复未完成的商品评价任务/);
  f.unmount();
  pendingStatus.resolve({ data: { sta: 0, data: { status: 1, processed: 1, total: 1 } } });
});

test('商品任务：提交精确参数，按映射用真实SDK更新且保留未选列和真实0', async t => {
  const f = await fixture(t, { rows: [{ recordId: 'old', fields: { id: [{ type: 'text', text: 'AbC' }], text: [{ type: 'text', text: '旧评' }], notes: [{ type: 'text', text: '保留' }] } }] });
  f.s.reviewPagesType.value = 'all'; f.s.replyPagesType.value = 'pages'; f.s.formData.value.replyPages = 2; f.s.formData.value.sortType = 'time_descending';
  await f.submit();
  const create = f.requests.find(r => r.url.endsWith('/product/review/task') && r.method === 'post');
  assert.deepEqual(create.data, { url: item.product_url, pages: 0, reply_pages: 2, sort_type: 'time_descending' });
  assert.equal(f.table.records.length, 1);
  assert.deepEqual(f.table.records[0].fields.text, [{ type: 'text', text: '初评' }]);
  assert.deepEqual(f.table.records[0].fields.url, [{ type: 'text', text: item.product_url }]);
  assert.equal(f.table.records[0].fields.count, 0);
  assert.deepEqual(f.table.records[0].fields.notes, [{ type: 'text', text: '保留' }]);
  assert.equal(f.table.fields.some(f => f.name === '平台' || f.name === '初评'), false);
  assert.equal(f.task().cursor, 'c1');
  assert.ok(f.requests.filter(r => r.url.endsWith('/list')).every(r => 'after_id' in r.data));
});

test('商品任务：小红书 like_count 写入有用字段', async t => {
  const f = await fixture(t);
  f.control.results = async config => ({ data: { sta: 0, data: {
    data: config.data.after_id ? [] : [{ ...item, social_type: 'xhs', helpful_count: undefined, like_count: 12 }],
    next_cursor: 'xhs-review-1', has_more: true, count: 1,
  } } });

  await f.submit();

  assert.equal(f.table.records[0].fields.count, 12);
});

test('商品任务：新建不依赖云配置，实际主字段改为评价ID，日期媒体原文保留', async t => {
  const f = await fixture(t); f.s.formData.value.radio = 1;
  f.s.selectedFieldKeys.value = ['review_id', 'product_url', 'review_time', 'media_urls', 'replies']; await f.flush();
  f.control.read = async () => { throw new Error('不应读取'); };
  await f.submit();
  const created = f.host.state.tables.at(-1);
  assert.notEqual(created.id, 'B'); assert.equal(created.fields.find(f => f.id === 'primary').name, '评价ID');
  const field = name => created.fields.find(f => f.name === name);
  assert.equal(field('商品链接').type, 15);
  assert.deepEqual(created.records[0].fields[field('商品链接').id], [{ type: 'url', text: item.product_url, link: item.product_url }]);
  assert.deepEqual(created.records[0].fields[field('初评时间').id], [{ type: 'text', text: '11月18日' }]);
  assert.deepEqual(created.records[0].fields[field('晒图/视频').id], [{ type: 'text', text: 'https://img/1\nhttps://img/2' }]);
  assert.equal(f.task().targetTableId, created.id); assert.equal(f.task().initializingTableId, '');
});

test('商品任务：半填映射与非法页数在提交和补列前拦截', async t => {
  const f = await fixture(t);
  f.s.mappingDraft.value.push({ source_key: 'helpful_count', target_field_id: '' }); await f.submit();
  assert.equal(f.requests.some(r => r.url.endsWith('/product/review/task')), false); assert.equal(f.table.writes, 0);
  assert.ok(f.host.state.notices.some(n => /映射/.test(n.message)));
  f.s.mappingDraft.value.pop(); f.s.formData.value.pages = 51; await f.submit();
  assert.equal(f.requests.some(r => r.url.endsWith('/product/review/task')), false);
});

test('商品任务：创建等待固定表单快照，卸载后保存身份但不写表', async t => {
  const f = await fixture(t), pending = deferred(); f.control.create = () => pending.promise;
  const work = f.submit(); await f.flush();
  f.s.formData.value.table_id = 'A'; f.s.selectedFieldKeys.value = ['review_id'];
  f.unmount(); pending.resolve({ data: { sta: 0, data: { task_id: 'late' } } }); await work; await f.flush();
  assert.equal(f.table.writes, 0); assert.equal(f.task().taskId, 'late');
  assert.equal(f.task().targetTableId, 'B'); assert.deepEqual(f.task().selectedFieldKeys, ['review_id', 'product_url', 'content', 'helpful_count']);
});

test('商品任务：append已写成功但游标存储失败后恢复只认本批新增，不抵扣历史重复', async t => {
  let failCursor = true;
  const f = await fixture(t, { mode: 'append', rows: [{ recordId: 'historical', fields: { id: [{ type: 'text', text: 'AbC' }], text: [{ type: 'text', text: '初评' }], url: [{ type: 'text', text: item.product_url }], count: 0 } }], save: async (key, value) => { if (key === TASK_KEY && value.cursor && failCursor) throw new Error('游标存储失败'); } });
  await f.submit(); await f.flush();
  assert.equal(f.table.records.length, 2); assert.equal(f.task().cursor, ''); assert.equal(f.task().appendState.pendingCount, 1);
  assert.ok(Array.isArray(f.task().appendState.knownRecordIds));
  failCursor = false; await f.s.resumeTask(); await f.flush();
  assert.equal(f.table.records.length, 2); assert.equal(f.task().cursor, 'c1');
  assert.equal(f.task().appendState.pendingCount, 0); assert.equal(f.task().writtenCount, 1);
});

test('商品任务：取消终态3先排空结果再清理，列表请求附带计数', async t => {
  const f = await fixture(t); f.control.status = 3;
  f.control.results = async config => ({ data: { sta: 0, data: { data: [], next_cursor: config.data.after_id, has_more: false, count: 0 } } });
  await f.submit();
  assert.deepEqual(f.task(), {}); assert.equal(f.s.loading.value, false);
  assert.equal(f.requests.find(r => r.url.endsWith('/list')).data.include_count, true);
  assert.match(f.s.toastText.value, /任务已停止/);
});

test('商品任务：云配置失败禁用映射，重试成功才使用原映射写入', async t => {
  const f = await fixture(t); f.control.read = async () => { throw new Error('云配置暂不可读'); };
  await f.s.loadTableOutputConfigs(); await f.submit();
  assert.equal(f.s.outputConfigReady.value, false); assert.equal(f.table.writes, 0);
  assert.match(f.s.toastText.value, /云配置暂不可读/);
  f.control.read = null; await f.s.loadTableOutputConfigs(); await f.submit();
  assert.equal(f.table.records[0].fields.text[0].text, '初评');
});

test('商品任务：表格来源固定原视图，切换活动视图不改变已捕获链接', async t => {
  const f = await fixture(t), pending = deferred();
  f.s.formData.value.mode = 'table'; await f.flush(); f.s.formData.value.productLinkFieldId = 'source';
  const original = f.source.getViewById; f.source.getViewById = async id => { await pending.promise; return original(id); };
  const work = f.submit(); await f.flush(); f.selection({ baseId: 'base-1', tableId: 'B', viewId: 'other' }); pending.resolve(); await work;
  assert.equal(f.requests.find(r => r.url.endsWith('/task') && r.method === 'post').data.url, item.product_url);
});

test('商品任务：来源读取延迟卸载后不请求业务或补列', async t => {
  const f = await fixture(t), pending = deferred();
  f.s.formData.value.mode = 'table'; await f.flush(); f.s.formData.value.productLinkFieldId = 'source';
  const get = f.source.getFieldById; f.source.getFieldById = async id => { const field = await get(id); return { ...field, getCell: async () => { await pending.promise; return { getValue: async () => item.product_url }; } }; };
  const work = f.submit(); await f.flush(); f.unmount(); pending.resolve(); await work;
  assert.equal(f.requests.some(r => r.url.endsWith('/task')), false); assert.equal(f.table.writes, 0);
});

test('商品任务：不兼容显式映射拒绝执行且不创建默认列', async t => {
  const f = await fixture(t); f.s.mappingDraft.value = [{ source_key: 'product_url', target_field_id: 'count' }];
  const before = structuredClone(f.table.fields); await f.submit();
  assert.equal(f.table.writes, 0); assert.deepEqual(f.table.fields, before); assert.equal(f.requests.some(r => r.url.endsWith('/task')), false);
  assert.match(f.s.toastText.value, /类型不匹配/);
});

test('商品任务：SDK已生效但响应失败，append恢复补缺且不重复行', async t => {
  const f = await fixture(t, { mode: 'append' }); const write = f.table.addRecords; let lost = true;
  f.table.addRecords = async rows => { const ids = await write(rows); if (lost) { lost = false; throw new Error('SDK响应丢失'); } return ids; };
  await f.submit(); assert.equal(f.table.records.length, 1); assert.match(f.s.taskNotice.value, /SDK响应丢失/);
  await f.s.resumeTask(); assert.equal(f.table.records.length, 1); assert.equal(f.task().cursor, 'c1');
});

test('商品任务：执行中停止保持锁定，取消请求成功不直接终态', async t => {
  const f = await fixture(t); f.control.status = 0; await f.submit();
  await f.s.handleCancel(); assert.equal(f.s.isCancelling.value, true); assert.equal(f.s.loading.value, true);
  assert.equal(f.requests.filter(r => r.url.endsWith('/task/cancel')).length, 1);
  assert.equal(f.s.hasRecoverableTask.value, false);
});

test('商品任务：平台失败保留真实终态原因和无结果错误反馈', async t => {
  const f = await fixture(t); f.control.status = 2; f.control.results = async () => ({ data: { sta: 0, data: { data: [], next_cursor: '', has_more: false } } });
  await f.submit(); assert.equal(f.s.loading.value, false); assert.equal(f.s.toastType.value, 'error'); assert.match(f.s.toastText.value, /平台错误/); assert.deepEqual(f.task(), {});
});

test('商品任务：空手动输入不补列也不发业务请求', async t => {
  const f = await fixture(t); f.s.formData.value.manualUrls = ''; f.s.selectedFieldKeys.value = ['review_id', 'review_time'];
  const before = structuredClone(f.table.fields); await f.submit(); assert.deepEqual(f.table.fields, before); assert.equal(f.requests.some(r => r.url.endsWith('/task')), false);
});

test('商品任务：准备读取时停止在下次异步边界收尾，不创建任务', async t => {
  const f = await fixture(t), pending = deferred();
  f.s.formData.value.mode = 'table'; await f.flush(); f.s.formData.value.productLinkFieldId = 'source';
  const get = f.source.getFieldById; f.source.getFieldById = async id => { const field = await get(id); return { ...field, getCell: async () => { await pending.promise; return { getValue: async () => item.product_url }; } }; };
  const work = f.submit(); await f.flush(); await f.s.handleCancel(); pending.resolve(); await work;
  assert.equal(f.requests.some(r => r.url.endsWith('/task')), false); assert.equal(f.s.loading.value, false); assert.match(f.s.toastText.value, /任务已停止/);
});

test('商品任务：创建响应等待时停止，保存身份后取消同一任务', async t => {
  const f = await fixture(t), pending = deferred(); f.control.create = () => pending.promise;
  const work = f.submit(); await f.flush(); await f.s.handleCancel(); pending.resolve({ data: { sta: 0, data: { task_id: 'delayed-task' } } }); await work;
  assert.equal(f.requests.find(r => r.url.endsWith('/task/cancel')).data.task_id, 'delayed-task');
  assert.equal(f.task().taskId, 'delayed-task'); assert.equal(f.s.loading.value, true);
});

test('商品任务：按页模式不能用全部/不获取的0或负数哨兵绕过校验', async t => {
  const f = await fixture(t);
  f.s.formData.value.pages = 0; await f.submit(); assert.equal(f.requests.some(r => r.url.endsWith('/task')), false);
  f.s.formData.value.pages = 1; f.s.replyPagesType.value = 'pages'; f.s.formData.value.replyPages = 0;
  await f.submit(); assert.equal(f.requests.some(r => r.url.endsWith('/task')), false);
});

test('商品任务：已有文本数字列与单选评价者均用实际SDK转换，不改类型', async t => {
  const f = await fixture(t); f.table.fields.find(field => field.id === 'count').type = 1;
  f.table.fields.push({ id: 'buyer', name: '买家列', type: 3 });
  f.s.selectedFieldKeys.value = ['review_id', 'user_name', 'helpful_count']; await f.flush();
  f.s.mappingDraft.value = [{ source_key: 'user_name', target_field_id: 'buyer' }];
  await f.table.getFieldById('buyer');
  const sdkBuyer = f.table.fieldCache.get('buyer');
  sdkBuyer.getOptions = async () => [{ id: 'buyer-option', name: '买家' }]; sdkBuyer.addOptions = async () => {};
  await f.submit();
  assert.deepEqual(f.table.records[0].fields.count, [{ type: 'text', text: '0' }]);
  assert.deepEqual(f.table.records[0].fields.buyer, { text: '买家', id: 'buyer-option' });
  assert.equal(f.table.fields.find(field => field.id === 'buyer').type, 3);
});

test('商品任务：append恢复核对链接字段忽略宿主属性顺序差异', async t => {
  const f = await fixture(t, { mode: 'append' });
  f.table.fields.find(field => field.id === 'url').type = 15;
  const write = f.table.addRecords; let lost = true;
  f.table.addRecords = async rows => { const ids = await write(rows); if (lost) { lost = false; const value = f.table.records[0].fields.url[0]; f.table.records[0].fields.url = [{ link: value.link, text: value.text, type: value.type }]; throw new Error('响应丢失'); } return ids; };
  await f.submit(); await f.s.resumeTask(); assert.equal(f.table.records.length, 1); assert.equal(f.task().cursor, 'c1');
});
