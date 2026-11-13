import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from '@vue/compiler-sfc';
import { parse as parseJS } from '@babel/parser';
import { loadRequestModule } from './helpers/requestService.mjs';

const source = parse(fs.readFileSync(new URL('../src/components/CommentFetch.vue', import.meta.url), 'utf8')).descriptor.scriptSetup.content;
const declarations = parseJS(source, { sourceType: 'module' }).program.body
  .filter(node => node.type === 'VariableDeclaration').flatMap(node => node.declarations);
const production = { VITE_API_BASE_URL: 'https://legacy.example', VITE_FEISHU_API_BASE_URL: 'https://api.socialdatax.com' };

function fixture(task = { taskId: 'old-task' }, env = production) {
  const api = loadRequestModule(env);
  const calls = [], errors = [];
  let submitted, reply = () => ({ sta: 0, data: { task_id: 'new-task', status: 0, data: [], has_more: false } });
  api.service.defaults.adapter = async config => {
    const call = { ...config, data: typeof config.data === 'string' ? JSON.parse(config.data) : config.data };
    calls.push(call);
    return { config, status: 200, data: await reply(call) };
  };
  const bindings = {
    ...api, request: api.service, props: { api_key: 'test-only' }, componentUnmounted: false,
    commentSubmission: { pending: null },
    selectedFieldKeys: { value: ['cid', 'text'] },
    mappingDraft: { value: [{ source_key: 'text', target_field_id: 'body-field' }] },
    formData: { value: { pages: 2, reply_pages: -1, writeMode: 'append' } },
    hasRecoverableTask: { value: false }, recoveryRequiresReopen: { value: false },
    activeCommentTaskId: { value: '' }, loading: { value: false }, isCancelling: { value: false }, clearing: { value: false },
    stoppedCommentProgress: () => '正在停止', showToast() {},
    showErrorMsg: message => errors.push(message), feedback: { fail: message => errors.push(message) }, console: { error() {}, log() {} },
    commentStreamTask: { getActiveTask: () => task,
      saveForResume: async created => { submitted = structuredClone(created); }, resume: async () => true },
  };
  const handler = name => {
    const node = declarations.find(item => item.id.name === name).init;
    return new Function(...Object.keys(bindings), `return (${source.slice(node.start, node.end)});`)(...Object.values(bindings));
  };
  if (declarations.some(node => node.id.name === 'commentTaskApiPath')) bindings.commentTaskApiPath = handler('commentTaskApiPath');
  const callbacks = Object.fromEntries(declarations.find(node => node.id.name === 'commentStreamTask').init.arguments[0].properties
    .filter(node => ['getStatus', 'getResults', 'isTerminal'].includes(node.key.name))
    .map(node => [node.key.name, new Function(...Object.keys(bindings), `return (${source.slice(node.value.start, node.value.end)});`)(...Object.values(bindings))]));
  return { ...callbacks, create: handler('postNoteTask'), cancel: handler('cancelCommentTask'), calls, errors, bindings,
    submitted: () => submitted, setReply: value => { reply = value; } };
}

for (const [label, env, base] of [
  ['生产', production, 'https://api.socialdatax.com'],
  ['测试', { VITE_API_BASE_URL: 'https://legacy.example', VITE_FEISHU_API_BASE_URL: 'https://test-lotto.weiyoubot.cn' }, 'https://test-lotto.weiyoubot.cn'],
  ['开发同源', { VITE_API_BASE_URL: '/', VITE_FEISHU_API_BASE_URL: '/' }, ''],
]) {
  test(`评论${label}创建使用迁移路由并保存来源和原输出设置`, async () => {
    const f = fixture(undefined, env);
    const urls = 'https://www.xiaohongshu.com/explore/note\nhttps://tieba.baidu.com/p/123';
    for (const sort_type of ['default', 'time_descending', 'like_count_descending', 'oldest']) {
      await f.create('target-table', urls, { sort_type });
      const call = f.calls.at(-1);
      assert.equal(call.baseURL, base);
      assert.equal(call.url, '/socialdatax/api/v1/feishu/comment/task');
      assert.equal(call.method, 'post');
      assert.equal(call.headers.authorization, 'Bearer test-only');
      assert.deepEqual(call.data, { url: urls, pages: 2, reply_pages: -1, sort_type, version: 'test-version' });
      assert.deepEqual(f.submitted(), { taskId: 'new-task', targetTableId: 'target-table', pendingCommentWrite: false,
        selectedFieldKeys: ['cid', 'text'], writeMode: 'append', fieldMappings: [{ source_key: 'text', target_field_id: 'body-field' }],
        apiBaseUrl: base, apiPathPrefix: '/socialdatax/api' });
    }
    assert.deepEqual(f.errors, []);
  });
}

for (const [label, task, base, prefix] of [
  ['保存的新任务', { taskId: 'new/task', apiBaseUrl: 'https://saved.example', apiPathPrefix: '/socialdatax/api' }, 'https://saved.example', '/socialdatax/api'],
  ['无来源历史任务', { taskId: 'old-task' }, 'https://legacy.example', '/social/api'],
  ['保存的旧来源', { taskId: 'legacy-task', apiBaseUrl: 'https://old-saved.example', apiPathPrefix: '/social/api' }, 'https://old-saved.example', '/social/api'],
  ['保存的同源任务', { taskId: 'local-task', apiBaseUrl: '', apiPathPrefix: '/socialdatax/api' }, '', '/socialdatax/api'],
  ['显式空前缀', { taskId: 'empty-prefix', apiBaseUrl: '', apiPathPrefix: '' }, '', ''],
]) {
  test(`评论${label}查询、结果和取消始终使用原来源`, async () => {
    const saved = { ...task, cursor: 'previous-page' };
    const f = fixture(saved);
    await f.getStatus(saved);
    await f.getResults(saved);
    await f.cancel();
    assert.deepEqual(f.calls.map(call => call.baseURL), [base, base, base]);
    assert.deepEqual(f.calls.map(call => call.url), [
      `${prefix}/v1/feishu/comment/task?task_id=${encodeURIComponent(task.taskId)}`,
      `${prefix}/v1/feishu/comment/list`, `${prefix}/v1/feishu/comment/task/cancel`,
    ]);
    assert.ok(f.calls.every(call => call.headers.authorization === 'Bearer test-only'));
    assert.equal(f.calls[0].params.supports_partial_results, 1);
    assert.equal(f.calls[0].params.version, 'test-version');
    assert.deepEqual(f.calls[1].data, { task_id: task.taskId, after_id: 'previous-page', limit: 20, include_count: false, version: 'test-version' });
    assert.equal(f.calls[2].data.task_id, task.taskId);
    assert.equal(f.bindings.isCancelling.value, true);
    assert.deepEqual(f.errors, []);
  });
}

test('评论恢复在环境变更后保留来源、游标、原字段和目标表，取消后排空再清理', async () => {
  const first = fixture();
  await first.create('original-table', 'https://example.test', { sort_type: 'oldest' });
  let saved, timerId = 0;
  const timers = new Map(), rows = [], finished = [];
  const sdk = { base: { getSelection: async () => ({ baseId: 'base' }) },
    bridge: { getData: async () => structuredClone(saved), setData: async (_, value) => { saved = structuredClone(value); } } };
  const engineSource = fs.readFileSync(new URL('../src/composables/useIncrementalTask.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/, '').replace('export const useIncrementalTask', 'const useIncrementalTask');
  const createEngine = new Function('bitable', 'setTimeout', 'clearTimeout', `${engineSource}; return useIncrementalTask;`)(sdk,
    callback => { timers.set(++timerId, callback); return timerId; }, id => timers.delete(id));
  const options = f => ({ storageKey: 'comment-route-test', getStatus: f.getStatus, getResults: f.getResults, isTerminal: f.isTerminal,
    writeBatch: async (items, task) => {
      assert.equal(task.targetTableId, 'original-table');
      assert.deepEqual(task.selectedFieldKeys, ['cid', 'text']);
      assert.equal(task.writeMode, 'append');
      assert.deepEqual(task.fieldMappings, [{ source_key: 'text', target_field_id: 'body-field' }]);
      rows.push(...items.map(item => item.cid));
    }, onError: error => assert.fail(error.message), onFinish: (_, task) => finished.push(task.writtenCount) });
  await createEngine(options(first)).saveForResume({ ...first.submitted(), cursor: 'previous-page', writtenCount: 1 });
  const reopened = fixture(saved, { ...production, VITE_FEISHU_API_BASE_URL: 'https://changed.example' });
  reopened.bindings.selectedFieldKeys.value = ['cid', 'nickname'];
  let status = 0;
  reopened.setReply(call => ({ sta: 0, data: call.method === 'get'
    ? { status, processed: 1, total: 2, cancel_requested: true, status_text: status ? 'cancelled' : 'cancel_requested' }
    : { data: call.data.after_id === 'previous-page' ? [{ cid: 'comment-2', text: 'saved output' }] : [],
      next_cursor: 'last-page', has_more: false, ...(call.data.include_count ? { count: 2 } : {}) } }));
  const resumed = createEngine(options(reopened));
  assert.equal(await resumed.resume(), true);
  assert.deepEqual(rows, ['comment-2']);
  assert.deepEqual(finished, []);
  assert.equal(saved.cursor, 'last-page');
  assert.equal(saved.writtenCount, 2);
  status = 3;
  const [id, tick] = [...timers][0]; timers.delete(id); await tick();
  assert.deepEqual(finished, [2]);
  assert.deepEqual(saved, {});
  assert.ok(reopened.calls.every(call => call.baseURL === 'https://api.socialdatax.com'));
  assert.ok(reopened.calls.every(call => call.url.startsWith('/socialdatax/api/')));
  assert.equal(reopened.calls[1].data.after_id, 'previous-page');
  assert.equal(reopened.calls[1].data.include_count, false);
  assert.equal(reopened.calls.at(-1).data.include_count, true);
});
