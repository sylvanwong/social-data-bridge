import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc';
import { loadComponent, mountComponent, findAll, flush } from '../../social-comment-assistant/tests/helpers/component.mjs';

const require = createRequire(new URL('../../social-comment-assistant/tests/helpers/component.mjs', import.meta.url));
const { h } = require('vue');
const Vue = require('vue');
const pages = [
  ['作品详情获取', 'video', 'VideoDataFetch'],
  ['获取作者信息', 'blogger', 'BloggerInfoFetch'],
  ['获取作者作品', 'profile', 'ProfileFetch'],
  ['关键词搜索获取', 'search', 'KeywordSearch'],
  ['博主短剧获取', 'series', 'SeriesFetch'],
  ['评论列表获取', 'comment', 'CommentFetch'],
  ['热榜获取', 'hot', 'HotListFetch'],
  ['提取视频文案', 'videoCopySummary', 'VideoCopySummary'],
  ['小红书下载', 'xhsDownload', 'XhsDownload'],
  ['链接转附件', 'urlToAttachment', 'UrlToAttachment'],
  ['作者搜索获取', 'bloggerSearch', 'BloggerSearch'],
  ['搜索推荐词', 'searchSuggestions', 'SearchSuggestions'],
];
const text = node => (node.text || '') + (node.children || []).map(text).join('');
const hasClass = (node, name) => node.props?.class?.split(/\s+/).includes(name);

async function fixture(t) {
  const notices = [];
  const child = { emits: ['back'], setup: (_, { emit }) => () => h('button', { class: 'child-back', onClick: () => emit('back') }, '返回') };
  const filename = fileURLToPath(new URL('../src/components/Form.vue', import.meta.url));
  const component = await loadComponent(filename, {
    '@lark-base-open/js-sdk': { bitable: { bridge: { getData: async () => undefined } } },
    'element-plus': { ElMessage: options => notices.push(options) },
    '@/utils/platformConfig': { fetchPlatformConfigOptions: async () => [] },
    './ProductReviewFetch.vue': { default: child },
    ...Object.fromEntries(pages.map(([, , name]) => [`./${name}.vue`, { default: child }])),
  });
  // 轻量测试渲染器没有静态HTML插入接口，关闭模板静态提升，仍运行完整首页模板。
  const { descriptor } = parse(fs.readFileSync(filename, 'utf8'));
  const script = compileScript(descriptor, { id: 'home' });
  const template = compileTemplate({ source: descriptor.template.content, filename, id: 'home', compilerOptions: { bindingMetadata: script.bindings, hoistStatic: false } });
  assert.deepEqual(template.errors, []);
  const render = template.code.replace(/import \{([^}]+)\} from "vue"/, (_, names) => `const {${names.replace(/ as /g, ': ')}} = Vue`).replace('export function render', 'function render');
  component.render = new Function('Vue', `${render};return render`)(Vue);
  const host = mountComponent(component);
  t.after(() => host.app.unmount());
  await flush();
  const cards = () => findAll(host.root, node => hasClass(node, 'arco-card'));
  const category = label => findAll(host.root, node => node.type === 'button' && text(node) === label)[0];
  const click = async node => { assert.ok(node, '入口应可见'); node.props.onClick(); await flush(); };
  return { ...host, cards, category, click, notices };
}

test('首页分类：默认作品数据，切换商品数据只显示商品评价，切回保留原有12个入口', async t => {
  const f = await fixture(t);
  assert.deepEqual(f.cards().map(text), pages.map(([label]) => label));
  assert.equal(f.category('作品数据')?.props['aria-pressed'], true);
  assert.equal(f.category('商品数据')?.props['aria-pressed'], false);
  await f.click(f.category('商品数据'));
  assert.deepEqual(f.cards().map(text), ['商品评价']);
  assert.equal(f.category('商品数据').props['aria-pressed'], true);
  assert.equal(f.category('作品数据').props['aria-pressed'], false);
  await f.click(f.cards()[0]);
  assert.equal(f.state.currentPage.value, 'productReview', '商品评价进入独立配置页');
  assert.equal(f.cards().length, 0);
  await f.click(findAll(f.root, node => hasClass(node, 'child-back'))[0]);
  assert.equal(f.category('商品数据').props['aria-pressed'], true, '返回后仍显示商品分类');
  await f.click(f.category('作品数据'));
  assert.deepEqual(f.cards().map(text), pages.map(([label]) => label));
  assert.equal(f.category('作品数据').props['aria-pressed'], true);
});

test('切换分类后，12个作品卡片仍进入原页面，返回后保留作品分类', async t => {
  const f = await fixture(t);
  await f.click(f.category('商品数据'));
  await f.click(f.category('作品数据'));
  for (const [label, page] of pages) {
    await f.click(f.cards().find(card => text(card) === label));
    assert.equal(f.state.currentPage.value, page, label);
    assert.equal(f.cards().length, 0);
    await f.click(findAll(f.root, node => hasClass(node, 'child-back'))[0]);
    assert.equal(f.state.currentPage.value, 'home');
    assert.equal(f.category('作品数据').props['aria-pressed'], true);
    assert.equal(f.cards().length, 12);
  }
});
