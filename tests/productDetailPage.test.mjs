import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc';
import { loadModules } from '../../social-blogger-search/tests/helpers.mjs';
import { mountComponent, findAll, flush } from '../../social-comment-assistant/tests/helpers/component.mjs';

const text = node => (node.text || '') + (node.children || []).map(text).join('');

test('商品详情页面展示商品字段和映射，切换手动输入后保留共用结构，不读取或展示定时任务', async t => {
  const filename = fileURLToPath(new URL('../src/components/VideoDataFetch.vue', import.meta.url));
  const loaded = await loadModules(['/src/components/VideoDataFetch.vue', 'vue'], 'development', { root: fileURLToPath(new URL('..', import.meta.url)), mockAxios: true });
  t.after(() => loaded.close());
  const Vue = loaded.modules[1], component = loaded.modules[0].default;
  const requests = [];
  loaded.state.axiosHandler = async config => { requests.push(config); return { data: { sta: 0, data: [] } }; };
  loaded.sdk.base.getSelection = async () => ({ baseId: 'base', tableId: 'source', viewId: 'view' });
  loaded.sdk.base.getTableById = async () => ({ getFieldMetaList: async () => [], getViewById: async () => ({ getFieldMetaList: async () => [] }) });
  loaded.sdk.base.getActiveTable = async () => ({ id: 'source', getActiveView: async () => ({ id: 'view', getFieldMetaList: async () => [] }), getFieldMetaList: async () => [] });
  const { descriptor } = parse(fs.readFileSync(filename, 'utf8'));
  const script = compileScript(descriptor, { id: 'product-detail' });
  const template = compileTemplate({ source: descriptor.template.content, filename, id: 'product-detail', compilerOptions: { bindingMetadata: script.bindings, hoistStatic: false } });
  assert.deepEqual(template.errors, []);
  const render = template.code.replace(/import \{([^}]+)\} from "vue"/, (_, names) => `const {${names.replace(/ as /g, ': ')}} = Vue`).replace('export function render', 'function render');
  const Slot = { setup: (_, { slots }) => () => Vue.h('div', slots.default?.()) };
  const components = Object.fromEntries([...descriptor.template.content.matchAll(/<(el-[\w-]+)/g)].map(([, name]) => [name, Slot]));
  const host = mountComponent({
    components,
    props: { productDetail: { default: true } },
    setup() {
      const state = component.setup({ productDetail: true, api_key: 'test-only' }, { expose() {}, emit() {} });
      state.TaskFeedback = Slot;
      state.InputFilterEditor = Slot;
      return state;
    },
    render: new Function('Vue', `${render};return render`)(Vue),
  }, { runtime: Vue, components, provides: [[Symbol.for('v-scx'), {}]] });
  t.after(() => host.app.unmount());
  await flush();
  for (let i = 0; i < 6; i++) { await new Promise(setImmediate); await flush(); }
  let content = text(host.root);
  assert.match(content, /商品详情获取/);
  assert.match(content, /商品链接来源/);
  assert.match(content, /商品链接所在字段/);
  assert.match(content, /字段映射/);
  assert.match(content, /立即执行/);
  assert.doesNotMatch(content, /作品ID|播放量|定时任务|执行方式/);
  assert.equal(findAll(host.root, node => node.props?.class?.includes('task-manager')).length, 0);
  assert.equal(host.state.FIELD_CONFIG.length, 13);
  assert.deepEqual(host.state.selectedFieldKeys.value, host.state.FIELD_CONFIG.map(field => field.key));
  assert.ok(requests.some(config => config.params?.plugin_type === 'product_detail'));
  assert.ok(!requests.some(config => config.url.includes('/schedule/')));
  host.state.formData.value.mode = 'manual';
  await flush();
  content = text(host.root);
  assert.match(content, /商品链接/);
  assert.match(content, /新建表格/);
  assert.match(content, /使用现有表格/);
  assert.doesNotMatch(content, /作品|定时任务/);
});
