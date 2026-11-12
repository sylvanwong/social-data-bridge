import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from '@vue/compiler-sfc';
import { parse as parseJS } from '@babel/parser';

const { descriptor } = parse(fs.readFileSync(new URL('../src/components/CommentFetch.vue', import.meta.url), 'utf8'));
const source = descriptor.scriptSetup.content;
const declarations = parseJS(source, { sourceType: 'module' }).program.body
  .filter(node => node.type === 'VariableDeclaration').flatMap(node => node.declarations);
const evaluate = (node, scope) => new Function(...Object.keys(scope), `return (${source.slice(node.start, node.end)});`)(...Object.values(scope));
const load = (name, scope = {}) => {
  const declaration = declarations.find(node => node.id.name === name);
  assert.ok(declaration, `Missing ${name}`);
  return evaluate(declaration.init, scope);
};

test('切换排序时只列出真正支持的平台，默认排序无需列平台', () => {
  const formData = { value: { sortType: 'default' } };
  const commentSortOptions = load('commentSortOptions');
  const supported = load('commentSortPlatforms', {
    formData, commentSortOptions, computed: fn => ({ get value() { return fn(); } }),
  });
  for (const [selected, expected] of [
    ['default', []],
    ['time_descending', ['小红书', '微博', 'B站', '知乎', 'YouTube', '百度贴吧']],
    ['like_count_descending', ['小红书']],
    ['oldest', ['百度贴吧']],
  ]) {
    formData.value.sortType = selected;
    assert.deepEqual(supported.value, expected);
    assert.ok(commentSortOptions.some(option => option.value === selected));
  }
});

for (const targetTableId of ['', 'existing-table']) {
  test(`新建或现有表格提交保留四种排序和全部混合链接：${targetTableId || 'new'}`, async () => {
    const requests = [];
    const saved = [];
    const scope = {
      componentUnmounted: false, commentSubmission: { pending: null }, props: { api_key: 'test-key' },
      formData: { value: { pages: 2, reply_pages: -1, sortType: 'default', writeMode: 'upsert' } },
      selectedFieldKeys: { value: ['cid'] }, mappingDraft: { value: [] }, loading: { value: false }, hasRecoverableTask: { value: false },
      activeCommentTaskId: { value: '' }, recoveryRequiresReopen: { value: false },
      showToast() {}, showCompletionToast() {}, showErrorMsg() {},
      request: async config => { requests.push(config); return { data: { sta: 0, data: { task_id: 'created' } } }; },
      commentStreamTask: { saveForResume: async task => saved.push(task), resume: async () => true },
    };
    scope.postNoteTask = load('postNoteTask', scope);
    const submit = load('getNoteData', scope);
    for (const selected of ['default', 'time_descending', 'like_count_descending', 'oldest']) {
      scope.formData.value.sortType = selected;
      await submit(targetTableId, ['https://www.xiaohongshu.com/explore/note', 'https://tieba.baidu.com/p/123']);
      assert.deepEqual(requests.at(-1).data, {
        url: 'https://www.xiaohongshu.com/explore/note\nhttps://tieba.baidu.com/p/123',
        pages: 2, reply_pages: -1, sort_type: selected,
      });
      assert.equal(saved.at(-1).targetTableId, targetTableId);
    }
  });
}

test('任务完成时展示实际降级数，旧后端缺少该字段时正常完成', async () => {
  const messages = [];
  const scope = {
    clearing: { value: false },
    hasRecoverableTask: { value: true }, recoveryRequiresReopen: { value: false },
    loading: { value: true }, isCancelling: { value: false }, activeCommentTaskId: { value: 'task' },
    showCompletionToast: message => messages.push(message), showErrorMsg: message => messages.push(message),
  };
  const callbacks = declarations.find(node => node.id.name === 'commentStreamTask').init.arguments[0].properties;
  const finish = evaluate(callbacks.find(node => node.key.name === 'onFinish').value, scope);
  await finish({ status: 1, sort_fallback_count: 2 }, { writtenCount: 10 });
  assert.match(messages.at(-1), /2.*默认排序/);
  await finish({ status: 1 }, { writtenCount: 10 });
  assert.match(messages.at(-1), /10.*评论/);
  assert.doesNotMatch(messages.at(-1), /默认排序/);
  await finish({ status: 2, reason: 'failed' }, { writtenCount: 3 });
  assert.equal(messages.at(-1), 'failed');
});

test('桥接页声明支持部分结果，获取真实失败和停止状态', async () => {
  const sent = [];
  const callbacks = declarations.find(node => node.id.name === 'commentStreamTask').init.arguments[0].properties;
  const getStatus = evaluate(callbacks.find(node => node.key.name === 'getStatus').value, {
    props: { api_key: 'test-key' },
    request: async config => { sent.push(config); return { data: { sta: 0, data: { status: 2 } } }; },
  });
  assert.deepEqual(await getStatus({ taskId: 'task' }), { sta: 0, data: { status: 2 } });
  assert.equal(sent[0].params?.supports_partial_results, 1);
});
