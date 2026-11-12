import { extractHttpUrls, parseManualUrls as parseDelimitedUrls } from '../src/utils/sourceLinks.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from '@vue/compiler-sfc';
import { parse as parseJS } from '@babel/parser';
import { ref } from 'vue';

function handler(page, name, bindings) {
  const source = parse(fs.readFileSync(new URL(`../src/components/${page}.vue`, import.meta.url), 'utf8')).descriptor.scriptSetup.content;
  const node = parseJS(source, { sourceType: 'module' }).program.body.filter(n => n.type === 'VariableDeclaration')
    .flatMap(n => n.declarations).find(n => n.id.name === name).init;
  return new Function(...Object.keys(bindings), `return (${source.slice(node.start, node.end)});`)(...Object.values(bindings));
}

const parseVideoUrls = handler('VideoDataFetch', 'parseManualUrls', { extractHttpUrls, parseDelimitedUrls });

const parseAttachmentUrls = handler('UrlToAttachment', 'extractUrlsFromText', { extractHttpUrls });

test('作品详情和链接转附件按首次出现的顺序提取连续 URL', () => {
  const input = 'https://b.test/2http://a.test/1，https://b.test/2';
  for (const parseUrls of [parseVideoUrls, parseAttachmentUrls]) {
    assert.deepEqual(parseUrls(input), ['https://b.test/2', 'http://a.test/1']);
  }
});

test('无协议输入沿用各入口的空格和重复项处理', () => {
  const input = ' a b，a b ';
  assert.deepEqual(parseVideoUrls(input), ['a b']);
  assert.deepEqual(parseAttachmentUrls(input), ['a', 'b', 'a', 'b']);
});

for (const [label, manualUrls, expectedUrls] of [
  ['全部无效时提示且不建表', 'abc，ftp://example.test/a', []],
  ['只有 https:// 时提示且不建表', 'https://', []],
  ['混合输入时只处理有效链接', 'https://，https://example.test/a，https://?x，http://b.test', ['https://example.test/a', 'http://b.test']],
]) {
  test(`链接转附件手动输入：${label}`, async () => {
    const notices = [], targets = [], writes = [];
    const submit = handler('UrlToAttachment', 'handleManualModeSubmit', {
      props: { api_key: 'test-key' }, formData: ref({ targetType: 'new', manualUrls }),
      loading: ref(false), stopRequested: ref(false), extractHttpUrls,
      isAttachmentUrl: handler('UrlToAttachment', 'isAttachmentUrl', {}),
      ElMessage: notice => notices.push(notice.message),
      showToast() {}, finishToast() {}, nextTick: async () => {}, assertMounted: value => value,
      ensureOutputConfigReady: async () => true,
      resolveTargetTableId: async type => { targets.push(type); return 'target'; },
      appendRecordsToTable: async (id, rows) => {
        writes.push({ id, rows });
        return { writtenCount: rows.length, stopped: false };
      },
    });
    await submit();
    assert.deepEqual(targets, expectedUrls.length ? ['new'] : []);
    assert.deepEqual(notices, expectedUrls.length ? [] : ['请至少输入一个有效的URL']);
    assert.deepEqual(writes, expectedUrls.length ? [{ id: 'target', rows: expectedUrls.map(url => ({ urls: [url] })) }] : []);
  });
}

for (const [label, manualUrls, message] of [
  ['空输入', '', '请输入作品链接'],
  ['空白输入', ' \n ', '请输入作品链接'],
  ['只有分隔符', ',，\n,', '请至少输入一个有效的作品链接'],
]) {
  test(`VideoDataFetch 手动${label}时阻止执行并提示作品链接`, () => {
    const notices = [];
    const validate = handler('VideoDataFetch', 'validateBaseForm', {
      props: { api_key: 'test-key' },
      parseManualUrls: parseVideoUrls,
      ElMessage: notice => notices.push(notice.message),
    });

    assert.equal(validate({ mode: 'manual', manualUrls }), false);
    assert.deepEqual(notices, [message]);
  });
}

for (const [page, name, target, message] of [
  ['ProfileFetch', 'validateBaseForm', { mode: 'table' }, '请选择作者主页链接字段'],
  ['ProfileFetch', 'validateBaseForm', { mode: 'manual', manualUrls: '' }, '请输入作者主页链接'],
  ['CommentFetch', 'commit', { mode: 'table' }, '请选择作品链接字段'],
  ['CommentFetch', 'commit', { mode: 'manual', manualUrls: '' }, '请输入作品链接'],
  ['VideoCopySummary', 'handleTableModeSubmit', { mode: 'table' }, '请选择作品链接字段'],
  ['VideoCopySummary', 'handleManualModeSubmit', { mode: 'manual', manualUrls: '' }, '请输入作品链接'],
]) {
  for (const key of ['', 'test-key']) test(`${page} ${target.mode} 缺少${key ? '输入' : '密钥'}时提示与界面字段一致`, async () => {
    const notices = [];
    const b = { props: { api_key: key }, formData: ref(target), hasRecoverableTask: ref(false),
      loading: ref(false), isSubmitting: ref(false), fieldSelectionReady: ref(true), sourceFieldLoading: ref(false), sourceFieldLoadError: ref(''),
      ElMessage: n => notices.push(n.message), showErrorMsg: n => notices.push(n) };
    await handler(page, name, b)(target);
    assert.deepEqual(notices, [key ? message : page === 'VideoCopySummary' ? '请先设置 API Key' : '请输入 API Key']);
    assert.equal(b.loading.value, false);
    assert.equal(b.isSubmitting.value, false);
  });
}
