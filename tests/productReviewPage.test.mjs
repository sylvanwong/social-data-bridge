import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { compile } from '@vue/compiler-dom';
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc';
import { loadComponent, mountComponent, findAll, flush, deferred } from '../../social-comment-assistant/tests/helpers/component.mjs';

import { loadModules } from '../../social-blogger-search/tests/helpers.mjs';
const require = createRequire(new URL('../package.json', import.meta.url));
const Vue = require('vue');
const { ElButton, ElRadioGroup, ElRadio, ElCheckboxGroup, ElCheckbox, ID_INJECTION_KEY } = require('element-plus');
const text = node => (node.text || '') + (node.children || []).map(text).join('');

async function fixture(t, options = {}) {
  const previousMouseEvent = globalThis.MouseEvent;
  globalThis.MouseEvent = class extends Event {};
  t.after(() => { if (previousMouseEvent) globalThis.MouseEvent = previousMouseEvent; else delete globalThis.MouseEvent; });
  let selection = { tableId: 'A', viewId: 'view-A' }, onSelection;
  const fields = {
    A: [{ id: 'a-link', name: '商品地址', type: 15 }, { id: 'a-number', name: '数量', type: 2 }],
    B: [{ id: 'b-link', name: '商品地址', type: 1 }],
  };
  const reads = [], mutations = [];
  const metaReader = { run: async id => fields[id] };
  const targetReader = { run: options.targetRead || (async id => fields[id]) };
  if (options.read) metaReader.run = options.read;
  const loaded = await loadModules(['/src/components/ProductReviewFetch.vue', 'vue'], 'development', { root: fileURLToPath(new URL('..', import.meta.url)), mockAxios: true });
  t.after(() => loaded.close());
  const Vue = loaded.modules[1];
  const component = loaded.modules[0].default;
  Object.assign(loaded.sdk.base, {
    getSelection: async () => ({ ...selection }),
    onSelectionChange: callback => { onSelection = callback; return () => { onSelection = undefined; }; },
    getTableById: async id => { reads.push(id); return { getViewById: async () => ({ getFieldMetaList: () => metaReader.run(id) }), getFieldMetaList: () => targetReader.run(id) }; },
    getTableMetaList: async () => [{ id: 'A', name: '来源表' }, { id: 'B', name: '目标表' }],
    addTable: async () => mutations.push('addTable'),
  });
  const requests = [];
  loaded.state.axiosHandler = async config => { requests.push(structuredClone(config)); return options.request ? options.request(config) : { data: { sta: 0, data: [] } }; };
  const filename = fileURLToPath(new URL('../src/components/ProductReviewFetch.vue', import.meta.url));
  const { descriptor } = parse(fs.readFileSync(filename, 'utf8'));
  const script = compileScript(descriptor, { id: 'product-review' });
  const template = compileTemplate({ source: descriptor.template.content, filename, id: 'product-review', compilerOptions: { bindingMetadata: script.bindings, hoistStatic: false } });
  assert.deepEqual(template.errors, []);
  const render = template.code.replace(/import \{([^}]+)\} from "vue"/, (_, names) => `const {${names.replace(/ as /g, ': ')}} = Vue`).replace('export function render', 'function render');
  component.render = new Function('Vue', `${render};return render`)(Vue);
  const Select = { props: ['modelValue'], emits: ['update:modelValue'], setup: (props, { emit, slots }) => () => Vue.h('select', { value: props.modelValue, onChange: e => emit('update:modelValue', e.target.value) }, slots.default?.()) };
  const Option = { props: ['label', 'value', 'disabled'], setup: props => () => Vue.h('option', { value: props.value, disabled: props.disabled }, props.label) };
  const host = mountComponent({ setup() { const state = component.setup({ api_key: 'test-only' }, { expose() {}, emit() {} }); const feedbackTemplate = parse(fs.readFileSync(fileURLToPath(new URL('../src/components/TaskFeedback.vue', import.meta.url)), 'utf8')).descriptor.template.content; state.TaskFeedback.render = new Function('Vue', compile(feedbackTemplate, { mode: 'function', prefixIdentifiers: true }).code)(Vue); return state; }, render: component.render }, { runtime: Vue, provides: [[Symbol.for('v-scx'), {}], [ID_INJECTION_KEY, { prefix: 1, current: 0 }]], components: {
    'el-button': ElButton, 'el-radio-group': ElRadioGroup, 'el-radio': ElRadio,
    'el-checkbox-group': ElCheckboxGroup, 'el-checkbox': ElCheckbox, 'el-select': Select, 'el-option': Option,
  } });
  let unmounted = false;
  const unmount = () => { if (!unmounted) { host.app.unmount(); unmounted = true; } };
  t.after(unmount);
  for (let i = 0; i < 6; i++) { await new Promise(setImmediate); await flush(); }
  const inputs = type => findAll(host.root, node => node.type === 'input' && node.props.type === type);
  const radio = async value => {
    const target = inputs('radio').find(node => String(node.props.value) === String(value));
    assert.ok(target, `单选项 ${value} 可见`);
    for (const handler of target.events.change || []) handler({ target });
    await flush();
  };
  const checkbox = async label => {
    const item = findAll(host.root, node => node.type === 'label' && text(node).trim() === label)[0];
    assert.ok(item, `字段 ${label} 可见`);
    const target = findAll(item, node => node.type === 'input')[0];
    assert.ok(!target.props.disabled, `${label} 可编辑`);
    target.checked = !target.checked;
    for (const handler of target.events.change || []) handler({ target });
    target.props.onChange?.({ target });
    await flush();
  };
  const switchSource = async id => { selection = { tableId: id, viewId: `view-${id}` }; onSelection?.({ data: { ...selection } }); await flush(); };
  const clickButton = async label => {
    const button = findAll(host.root, n => n.type === 'button' && text(n).trim() === label)[0];
    assert.ok(button, `按钮 ${label} 可见`);
    if (button.props.disabled) return false;
    button.props.onClick(new MouseEvent('click')); await flush(); return true;
  };
  const choose = async (label, value) => {
    const select = findAll(host.root, n => n.type === 'select' && n.props['aria-label'] === label)[0];
    assert.ok(select, `下拉 ${label} 可见`);
    assert.ok(!select.props.disabled, `${label} 可编辑`);
    select.props.onChange({ target: { value } }); await flush();
  };
  const target = async id => { await radio(2); await choose('选择现有表格', id); };
  const expandMapping = async () => {
    const button = findAll(host.root, n => n.type === 'button' && n.props.class === 'mapping-accordion-trigger')[0];
    assert.ok(button, '使用现有表格应显示字段映射');
    button.props.onClick(); await flush();
  };
  return { ...host, requests, unmount, fields, metaReader, targetReader, reads, mutations, inputs, radio, checkbox, switchSource, clickButton, choose, target, expandMapping };
}

test('商品评价配置：全选切换保留必填评价ID和有用字段，回复仅有一列', async t => {
  const f = await fixture(t);
  const labels = () => findAll(f.root, n => n.type === 'label' && n.props.class?.includes('field-checkbox-item')).map(n => text(n).trim());
  assert.ok(labels().some(label => label.startsWith('评价ID')));
  assert.ok(labels().includes('平台'));
  assert.ok(labels().includes('商品链接'));
  assert.ok(labels().some(label => label.startsWith('有用')));
  assert.ok(!labels().some(label => label.startsWith('点赞数')));
  assert.equal(labels().filter(label => label.includes('回复')).length, 1);
  assert.ok(!labels().some(label => /上级|根评价/.test(label)));
  await f.checkbox('全选');
  assert.deepEqual([...f.state.selectedFieldKeys.value], ['review_id']);
  const idInput = f.inputs('checkbox').find(n => n.props.value === 'review_id');
  assert.equal(idInput.props.disabled, true);
  assert.equal(idInput.checked, true);
  await f.checkbox('全选');
  assert.equal(f.state.selectedFieldKeys.value.length, 14);
});

test('商品评价配置：排序使用商品接口的两个取值，切换来源保留输入及提取范围', async t => {
  const f = await fixture(t);
  const sort = findAll(f.root, n => n.type === 'select' && n.props['aria-label'] === '评论排序')[0];
  assert.deepEqual(findAll(sort, n => n.type === 'option').map(n => n.props.value), ['general', 'time_descending']);
  sort.props.onChange({ target: { value: 'time_descending' } }); await flush();
  assert.equal(f.state.formData.value.sortType, 'time_descending');
  await f.radio('manual');
  f.state.formData.value.manualUrls = 'https://example.com/product';
  await f.radio('table');
  assert.equal(f.state.formData.value.manualUrls, 'https://example.com/product');
  assert.equal(f.state.formData.value.productLinkFieldId, '');
  assert.equal(f.state.formData.value.pages, 1);
});

test('商品评价配置：回复范围切换，页数输入仅在按页获取时可用', async t => {
  const f = await fixture(t);
  const pageInput = () => findAll(f.root, n => n.type === 'input' && n.props['aria-label'] === '商品评价回复页数')[0];
  assert.equal(pageInput().props.disabled, true);
  f.state.replyPagesType.value = 'pages'; await flush();
  assert.equal(pageInput().props.disabled, false);
  f.state.replyPagesType.value = 'all'; await flush();
  assert.equal(pageInput().props.disabled, true);
  assert.doesNotMatch(text(f.root), /小红书支持评价回复及楼中楼|支持抖音、小红书；最新评价按初评时间排序|时间保留平台原始文本/);
});

test('商品评价执行入口：初始化完成后可执行，新建和已有目标沿用配置', async t => {
  const f = await fixture(t);
  const button = () => findAll(f.root, n => n.type === 'button' && n.props.class?.includes('commit-btn'))[0];
  assert.equal(button().props.disabled, false);
  assert.doesNotMatch(text(f.root), /尚未接入|仅供配置预览/);
  await f.target('B');
  assert.equal(button().props.disabled, false);
  assert.deepEqual(f.mutations, []);
});

test('来源字段：仅显示文本和链接，切表按唯一同名字段匹配新ID', async t => {
  const f = await fixture(t);
  assert.deepEqual(f.state.fieldOptions.value.map(field => field.id), ['a-link']);
  f.state.formData.value.productLinkFieldId = 'a-link';
  await f.switchSource('B');
  assert.equal(f.state.formData.value.productLinkFieldId, 'b-link');
  assert.deepEqual(f.state.fieldOptions.value.map(field => field.id), ['b-link']);
});

test('来源字段：失败保留原错，原位重试成功；旧表迟到结果不能覆盖新表', async t => {
  const f = await fixture(t, { read: async () => { throw new Error('字段读取超时'); } });
  assert.match(text(f.root), /字段读取超时/);
  f.metaReader.run = async id => f.fields[id];
  const retry = findAll(f.root, n => n.type === 'button' && text(n).trim() === '重试')[0];
  retry.props.onClick(new MouseEvent('click')); await flush();
  assert.equal(f.state.sourceFieldError.value, '');
  const pending = deferred();
  f.metaReader.run = id => id === 'A' ? pending.promise : Promise.resolve(f.fields[id]);
  const refresh = f.state.loadSourceFields(); await flush();
  await f.switchSource('B');
  pending.resolve([{ id: 'old-late', name: '旧字段', type: 1 }]); await refresh; await flush();
  assert.deepEqual(f.state.fieldOptions.value.map(field => field.id), ['b-link']);
});

test('来源字段：切到手动输入或离开页面后不应用迟到读取', async t => {
  const pending = deferred();
  const f = await fixture(t, { read: () => pending.promise });
  await f.radio('manual');
  pending.resolve([{ id: 'late', name: '迟到字段', type: 1 }]); await flush();
  assert.deepEqual([...f.state.fieldOptions.value], []);
  const later = deferred();
  f.metaReader.run = () => later.promise;
  await f.radio('table');
  const reads = f.reads.length;
  f.unmount();
  later.resolve([{ id: 'after-unmount', name: '卸载后的字段', type: 1 }]); await flush();
  assert.deepEqual([...f.state.fieldOptions.value], []);
  assert.equal(f.reads.length, reads);
});

test('字段映射：新建表隐藏，已有表可展开并添加、选择、删除；同列不重复映射', async t => {
  const f = await fixture(t);
  assert.equal(findAll(f.root, n => n.props?.class === 'mapping-accordion-trigger').length, 0);
  await f.target('A'); await f.expandMapping();
  assert.equal(await f.clickButton('+ 添加字段映射'), true);
  await f.choose('映射输出字段 1', 'product_url');
  await f.choose('映射目标字段 1', 'a-link');
  assert.deepEqual(f.state.mappingDraft.value.map(row => ({ ...row })), [{ source_key: 'product_url', target_field_id: 'a-link' }]);
  await f.clickButton('+ 添加字段映射');
  const secondSource = findAll(f.root, n => n.type === 'select' && n.props['aria-label'] === '映射输出字段 2')[0];
  const secondTarget = findAll(f.root, n => n.type === 'select' && n.props['aria-label'] === '映射目标字段 2')[0];
  assert.equal(findAll(secondSource, n => n.type === 'option' && n.props.value === 'product_url')[0].props.disabled, true);
  assert.equal(findAll(secondTarget, n => n.type === 'option' && n.props.value === 'a-link')[0].props.disabled, true);
  await f.clickButton('删除');
  assert.equal(f.state.mappingDraft.value.length, 1);
  assert.deepEqual(f.mutations, []);
});

test('字段映射：来源仅限勾选字段，取消勾选后移除对应映射', async t => {
  const f = await fixture(t);
  await f.target('A'); await f.expandMapping(); await f.clickButton('+ 添加字段映射');
  await f.choose('映射输出字段 1', 'product_url'); await f.choose('映射目标字段 1', 'a-link');
  await f.checkbox('商品链接');
  assert.equal(f.state.mappingDraft.value.length, 0);
  await f.checkbox('全选');
  await f.checkbox('全选');
  await f.clickButton('+ 添加字段映射');
  const source = findAll(f.root, n => n.type === 'select' && n.props['aria-label'] === '映射输出字段 1')[0];
  assert.deepEqual(findAll(source, n => n.type === 'option').map(n => n.props.value), ['review_id']);
});

test('字段映射：切目标表及新建后切回，分别恢复本页草稿和写入方式', async t => {
  const f = await fixture(t);
  await f.target('A'); await f.expandMapping(); await f.clickButton('+ 添加字段映射');
  await f.choose('映射输出字段 1', 'product_url'); await f.choose('映射目标字段 1', 'a-link');
  await f.radio('append');
  await f.choose('选择现有表格', 'B');
  assert.equal(f.state.mappingDraft.value.length, 0);
  assert.equal(f.state.formData.value.writeMode, 'upsert');
  await f.expandMapping(); await f.clickButton('+ 添加字段映射');
  await f.choose('映射输出字段 1', 'content'); await f.choose('映射目标字段 1', 'b-link');
  await f.choose('选择现有表格', 'A');
  assert.equal(f.state.mappingDraft.value[0].target_field_id, 'a-link');
  assert.equal(f.state.formData.value.writeMode, 'append');
  await f.radio(1); await f.radio(2);
  assert.equal(f.state.mappingDraft.value[0].target_field_id, 'a-link');
  await f.choose('选择现有表格', 'B');
  assert.equal(f.state.mappingDraft.value[0].target_field_id, 'b-link');
});

test('字段映射：目标字段读取期间及失败时锁定编辑，原位重试保留草稿', async t => {
  const f = await fixture(t);
  await f.target('A'); await f.expandMapping(); await f.clickButton('+ 添加字段映射');
  await f.choose('映射输出字段 1', 'product_url'); await f.choose('映射目标字段 1', 'a-link');
  const pending = deferred();
  f.targetReader.run = () => pending.promise;
  const loading = f.state.loadTargetFields(); await flush();
  assert.equal(await f.clickButton('+ 添加字段映射'), false);
  const selectors = findAll(f.root, n => n.type === 'select' && /映射.*字段/.test(n.props['aria-label'] || ''));
  assert.ok(selectors.every(n => n.props.disabled));
  assert.ok(f.inputs('radio').filter(n => ['append', 'upsert'].includes(n.props.value)).every(n => n.props.disabled));
  pending.reject(new Error('目标字段读取失败')); await loading; await flush();
  assert.match(text(f.root), /目标字段读取失败/);
  assert.equal(await f.clickButton('删除'), false);
  f.targetReader.run = async id => f.fields[id];
  await f.clickButton('重试');
  assert.equal(f.state.outputConfigReady.value, true);
  assert.equal(f.state.mappingDraft.value[0].target_field_id, 'a-link');
  assert.equal(await f.clickButton('+ 添加字段映射'), true);
});

test('字段映射：旧目标表迟到成功或失败不能覆盖新表，切新建后旧读取也失效', async t => {
  const f = await fixture(t);
  await f.radio(2);
  const old = deferred();
  f.targetReader.run = id => id === 'A' ? old.promise : Promise.resolve(f.fields[id]);
  await f.choose('选择现有表格', 'A');
  await f.choose('选择现有表格', 'B');
  old.reject(new Error('旧目标失败')); await flush();
  assert.equal(f.state.outputConfigReady.value, true);
  assert.deepEqual(f.state.tableFieldOptions.value.map(field => field.id), ['b-link']);
  assert.equal(f.state.targetFieldError.value, '');
  const another = deferred(); f.targetReader.run = () => another.promise;
  const loading = f.state.loadTargetFields(); await flush();
  await f.radio(1);
  another.resolve([{ id: 'late', name: '迟到目标字段', type: 1 }]); await loading; await flush();
  assert.deepEqual([...f.state.tableFieldOptions.value], []);
});

test('任务配置锁定：执行和暂停恢复期间实际映射、全选及页数控件禁用', async t => {
  const f = await fixture(t); await f.target('A'); await f.expandMapping(); await f.clickButton('+ 添加字段映射');
  f.state.loading.value = true; await flush();
  assert.ok(findAll(f.root, n => n.type === 'select' && /映射.*字段/.test(n.props['aria-label'] || '')).every(n => n.props.disabled));
  assert.equal(findAll(f.root, n => n.type === 'input' && n.props['aria-label'] === '商品评价页数')[0].props.disabled, true);
  assert.equal(await f.clickButton('+ 添加字段映射'), false);
  f.state.loading.value = false; f.state.hasRecoverableTask.value = true; await flush();
  assert.equal(await f.clickButton('+ 添加字段映射'), false);
  assert.ok(f.inputs('checkbox').every(n => n.props.disabled));
});

for (const late of [false, true]) {
  test(`配置保存归属：A${late ? '切表后迟到失败' : '先失败再切表'}，B不显示或重试A，回A可重试原草稿`, async t => {
    const pending = deferred(); let failing = true;
    const f = await fixture(t, { request: async config => {
      if (config.method === 'put' && config.data.target_table_id === 'A' && failing) {
        if (late) await pending.promise;
        throw new Error('A表配置保存失败原文');
      }
      return { data: { sta: 0, data: [] } };
    } });
    const settle = async () => { await new Promise(setImmediate); await flush(); };
    await f.target('A'); await f.expandMapping(); await f.clickButton('+ 添加字段映射');
    await f.choose('映射输出字段 1', 'content'); await f.choose('映射目标字段 1', 'a-link'); await settle();
    if (!late) assert.match(text(f.root), /A表配置保存失败原文/);
    await f.choose('选择现有表格', 'B');
    if (late) { pending.resolve(); await settle(); }
    const putCount = f.requests.filter(request => request.method === 'put').length;
    const wrongRetry = findAll(f.root, node => node.type === 'button' && text(node).trim() === '重试')[0];
    if (wrongRetry) { wrongRetry.props.onClick(new MouseEvent('click')); await settle(); }
    assert.equal(f.requests.filter(request => request.method === 'put').length, putCount, 'B表不能重试A表失败的配置');
    assert.doesNotMatch(text(f.root), /A表配置保存失败原文/);
    assert.equal(f.requests.some(request => request.method === 'put' && request.data.target_table_id === 'B'), false);
    await f.choose('选择现有表格', 'A'); await settle();
    assert.match(text(f.root), /A表配置保存失败原文/);
    assert.equal(f.state.mappingDraft.value[0].target_field_id, 'a-link');
    failing = false; await f.clickButton('重试'); await settle();
    const saved = f.requests.filter(request => request.method === 'put').at(-1).data;
    assert.equal(saved.target_table_id, 'A');
    assert.deepEqual(saved.field_mappings, [{ source_key: 'content', target_field_id: 'a-link' }]);
    assert.doesNotMatch(text(f.root), /A表配置保存失败原文/);
  });
}
