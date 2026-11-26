import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const Vue = createRequire(new URL('../../social-comment-assistant/package.json', import.meta.url))('vue');
import { loadComponent, mountComponent, findAll } from '../../social-comment-assistant/tests/helpers/component.mjs';
const text = n => (n.text || '') + (n.children || []).map(text).join('');
test('结果区域默认展开，新结果重新展开，失败列表预览五条且复制完整输入', async t => {
  const component = await loadComponent(new URL('../src/components/TaskExecutionResult.vue', import.meta.url).pathname);
  const result = Vue.ref(null);
  const f = mountComponent({ setup: () => () => Vue.h(component, { result: result.value }) });
  t.after(() => f.app.unmount());
  assert.equal(findAll(f.root, n => n.type === 'section').length, 0);
  result.value = { status: 'partial', stats: [{ label: '成功', value: 2, unit: '页' }, { label: '失败请求', value: 7, unit: '次' }],
    writtenCount: 0, outputUnit: '作者', failed: 7, failedItems: Array.from({ length: 7 }, (_, i) => ({ url: 'input-' + i, reason: '原因-' + i })) };
  await Vue.nextTick();
  const header = () => findAll(f.root, n => n.type === 'button' && n.props['aria-expanded'] != null)[0];
  assert.equal(header().props['aria-expanded'], true);
  assert.match(text(f.root), /成功 2 页/);
  assert.match(text(f.root), /已写入 0 条作者/);
  assert.equal(findAll(f.root, n => n.type === 'li').length, 5);
  header().props.onClick(); await Vue.nextTick();
  assert.equal(header().props['aria-expanded'], false);
  result.value = { ...result.value }; await Vue.nextTick();
  assert.equal(header().props['aria-expanded'], true);
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let copied = '';
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: async value => { copied = value; } } } });
  t.after(() => original ? Object.defineProperty(globalThis, 'navigator', original) : delete globalThis.navigator);
  const copy = findAll(f.root, n => n.type === 'button' && text(n) === '复制失败输入')[0];
  await copy.props.onClick();
  assert.equal(copied, 'input-0\ninput-1\ninput-2\ninput-3\ninput-4\ninput-5\ninput-6');
});

test('剪贴板不可用时保留完整手动复制内容，无明细不提供无效复制', async t => {
  const component = await loadComponent(new URL('../src/components/TaskExecutionResult.vue', import.meta.url).pathname);
  const result = Vue.ref({ status: 'failed', stats: [], failed: 3, failedItems: [] });
  const f = mountComponent({ setup: () => () => Vue.h(component, { result: result.value }) });
  t.after(() => f.app.unmount());
  assert.equal(findAll(f.root, n => n.type === 'button' && text(n) === '复制失败输入').length, 0);
  assert.match(text(f.root), /未返回失败输入明细/);
  result.value = { ...result.value, failedItems: [{ url: 'gh_demo', reason: '超时' }] }; await Vue.nextTick();
  const copy = findAll(f.root, n => n.type === 'button' && text(n) === '复制失败输入')[0];
  await copy.props.onClick(); await Vue.nextTick();
  assert.equal(findAll(f.root, n => n.type === 'textarea')[0].props.value, 'gh_demo');
});
