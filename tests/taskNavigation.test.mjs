import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse, compileTemplate } from '@vue/compiler-sfc';
import { baseParse } from '@vue/compiler-dom';

const blockedPages = ['VideoDataFetch', 'BloggerInfoFetch', 'SeriesFetch', 'VideoCopySummary', 'XhsDownload', 'UrlToAttachment', 'HotListFetch'];
function backButton(page) {
  const filename = new URL(`../src/components/${page}.vue`, import.meta.url);
  const { descriptor } = parse(fs.readFileSync(filename, 'utf8'));
  assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename: page, id: page }).errors, []);
  let found;
  function visit(node) {
    if (node.props?.some(prop => prop.name === 'class' && prop.value?.content === 'sub-page-back')) found = node;
    for (const child of node.children || []) visit(child);
  }
  visit(baseParse(descriptor.template.content));
  return found;
}
for (const page of blockedPages) {
  test(`${page}：运行期间返回不卸载，结束后恢复返回`, () => {
    const node = backButton(page);
    const click = node.props.find(prop => prop.name === 'on' && prop.arg?.content === 'click').exp.content;
    const disabled = node.props.find(prop => prop.name === 'bind' && prop.arg?.content === 'aria-disabled').exp.content;
    const events = [];
    const handler = new Function('loading', 'isSubmitting', 'taskActionState', 'emit', click);
    const isDisabled = new Function('loading', 'isSubmitting', 'taskActionState', `return ${disabled}`);
    const states = [[true, false, 'running'], [true, false, 'stopping']];
    if (['SeriesFetch', 'HotListFetch'].includes(page)) states.push([false, true, 'submitting']);
    for (const state of states) {
      assert.equal(isDisabled(...state), true);
      handler(...state, event => events.push(event));
    }
    assert.deepEqual(events, []);
    assert.equal(isDisabled(false, false, 'idle'), false);
    handler(false, false, 'idle', event => events.push(event));
    assert.deepEqual(events, ['back']);
  });
}
for (const page of ['ProfileFetch', 'KeywordSearch', 'CommentFetch']) {
  test(`${page}：保留已有可恢复任务的返回入口`, () => {
    const node = backButton(page);
    const click = node.props.find(prop => prop.name === 'on' && prop.arg?.content === 'click').exp.content;
    const events = [];
    new Function('$emit', click)(event => events.push(event));
    assert.deepEqual(events, ['back']);
  });
}
