import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { nextTick } from 'vue';
import { parse } from '@vue/compiler-sfc';
import { parse as parseJS } from '@babel/parser';
import { loadRequestModule } from './helpers/requestService.mjs';

const production = { VITE_API_BASE_URL: 'https://api.52choujiang.cn', VITE_FEISHU_API_BASE_URL: 'https://api.socialdatax.com' };

function fixture(task = { taskId: 'old-task' }, env = production) {
  const source = parse(fs.readFileSync(new URL('../src/components/BloggerSearch.vue', import.meta.url), 'utf8')).descriptor.scriptSetup.content;
  const declarations = parseJS(source, { sourceType: 'module' }).program.body
    .filter(node => node.type === 'VariableDeclaration').flatMap(node => node.declarations);
  const api = loadRequestModule(env), calls = [];
  let submitted, reply = () => ({ sta: 0, data: { task_id: 'new-task', status: 0, data: [], count: 0, has_more: false } });
  api.service.defaults.adapter = async config => {
    const call = { ...config, data: typeof config.data === 'string' ? JSON.parse(config.data) : config.data };
    calls.push(call);
    return { config, status: 200, data: await reply(call) };
  };
  const bindings = {
    ...api, request: api.service, props: { api_key: 'test-only' }, nextTick,
    selectedFieldKeys: { value: ['user_id', 'nickname'] }, mappingDraft: { value: [{ source_key: 'nickname', target_field_id: 'name' }] },
    form: { value: { social_type: 'douyin', keyword: '露营\n徒步，露营', rangeType: 'pages', pages: 2,
      radio: 2, table_id: 'target-table', writeMode: 'upsert', follower_count_range: '10000_100000', user_type: 'personal' } },
    isDouyin: { value: true }, cancelling: { value: false }, clearing: { value: false },
    requiresReopen: { value: false }, hasRecoverableTask: { value: false }, submitting: { value: false }, loading: { value: false },
    componentUnmounted: false, tableConfigsLoaded: { value: true }, mappingLoading: { value: false }, tableFieldsError: null,
    feedback: { begin() {}, fail: error => assert.fail(error.message) }, validateTableFields: async () => true,
    getStoppingText: () => '正在停止', showToast() {}, restoreTask() {},
    showErrorMsg: message => assert.fail(message), auth: () => ({ authorization: 'Bearer test-only' }),
    searchTask: { getActiveTask: () => task, submit: async create => { submitted = await create(); } },
  };
  const handler = name => {
    const node = declarations.find(item => item.id.name === name)?.init;
    return node && new Function(...Object.keys(bindings), `return (${source.slice(node.start, node.end)});`)(...Object.values(bindings));
  };
  for (const name of ['bloggerTaskApiPath', 'parseKeywords']) {
    const fn = handler(name); if (fn) bindings[name] = fn;
  }
  const callbacks = Object.fromEntries(declarations.find(node => node.id.name === 'searchTask').init.arguments[0].properties
    .filter(node => ['getStatus', 'getResults', 'isTerminal'].includes(node.key.name))
    .map(node => [node.key.name, new Function(...Object.keys(bindings), `return (${source.slice(node.value.start, node.value.end)});`)(...Object.values(bindings))]));
  return { ...callbacks, create: handler('submit'), cancel: handler('cancel'), calls, bindings,
    submitted: () => submitted, setReply: value => { reply = value; } };
}

for (const [label, env, base] of [
  ['生产', production, 'https://api.socialdatax.com'],
  ['测试', { ...production, VITE_FEISHU_API_BASE_URL: 'https://test-lotto.weiyoubot.cn' }, 'https://test-lotto.weiyoubot.cn'],
  ['开发同源', { VITE_API_BASE_URL: '/', VITE_FEISHU_API_BASE_URL: '/' }, ''],
]) {
  test(`作者${label}创建使用新路由，保留原参数和输出快照并保存来源`, async () => {
    const f = fixture(undefined, env);
    await f.create();
    assert.equal(f.calls[0].baseURL, base);
    assert.equal(f.calls[0].url, '/socialdatax/api/v1/feishu/blogger/search/task');
    assert.deepEqual(f.calls[0].data, { social_type: 'douyin', keyword: ['露营', '徒步'], pages: 2,
      filter_config: { follower_count_range: '10000_100000', user_type: 'personal' }, version: 'test-version' });
    assert.equal(f.calls[0].headers.authorization, 'Bearer test-only');
    assert.deepEqual(f.submitted(), { taskId: 'new-task', pendingWrite: false,
      apiBaseUrl: base, apiPathPrefix: '/socialdatax/api', targetTableId: 'target-table',
      formData: { social_type: 'douyin', keyword: '露营\n徒步，露营', rangeType: 'pages', pages: 2,
        radio: 2, table_id: 'target-table', writeMode: 'upsert', follower_count_range: '10000_100000', user_type: 'personal' },
      selectedFieldKeys: ['user_id', 'nickname'], writeMode: 'upsert', fieldMappings: [{ source_key: 'nickname', target_field_id: 'name' }] });
  });
}

for (const [label, task, base, prefix] of [
  ['保存的新任务', { taskId: 'new/task', apiBaseUrl: 'https://saved.example', apiPathPrefix: '/socialdatax/api' }, 'https://saved.example', '/socialdatax/api'],
  ['无来源的历史任务', { taskId: 'old-task' }, 'https://api.52choujiang.cn', '/social/api'],
  ['保存的旧任务', { taskId: 'legacy-task', apiBaseUrl: 'https://old-saved.example', apiPathPrefix: '/social/api' }, 'https://old-saved.example', '/social/api'],
  ['保存的同源任务', { taskId: 'local-task', apiBaseUrl: '', apiPathPrefix: '/socialdatax/api' }, '', '/socialdatax/api'],
]) {
  test(`作者${label}查询、读结果和取消使用原来源`, async () => {
    const savedTask = { ...task, cursor: 'cursor-1' }, f = fixture(savedTask);
    await f.getStatus(savedTask); await f.getResults(savedTask); await f.cancel();
    assert.deepEqual(f.calls.map(call => call.baseURL), [base, base, base]);
    assert.deepEqual(f.calls.map(call => call.url), [
      `${prefix}/v1/feishu/blogger/search/task?task_id=${encodeURIComponent(task.taskId)}`,
      `${prefix}/v1/feishu/blogger/search/list`, `${prefix}/v1/feishu/blogger/search/task/cancel`,
    ]);
    assert.ok(f.calls.every(call => call.headers.authorization === 'Bearer test-only'));
    assert.equal(f.calls[0].params.version, 'test-version');
    assert.deepEqual(f.calls[1].data, { task_id: task.taskId, after_id: 'cursor-1', limit: 40, version: 'test-version' });
    assert.deepEqual(f.calls[2].data, { task_id: task.taskId, version: 'test-version' });
    assert.equal(f.bindings.cancelling.value, true, '取消成功仅进入停止等待');
  });
}

test('作者重开后从持久化来源和游标继续，停止确认后写完余量才清理', async () => {
  const first = fixture(); await first.create();
  let saved, timerId = 0;
  const timers = new Map(), rows = [], finished = [];
  const sdk = { base: { getSelection: async () => ({ baseId: 'base' }) },
    bridge: { getData: async () => structuredClone(saved), setData: async (_, value) => { saved = structuredClone(value); } } };
  const source = fs.readFileSync(new URL('../src/composables/useIncrementalTask.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/, '').replace('export const useIncrementalTask', 'const useIncrementalTask');
  const createEngine = new Function('bitable', 'setTimeout', 'clearTimeout', `${source}; return useIncrementalTask;`)(sdk,
    callback => { timers.set(++timerId, callback); return timerId; }, id => timers.delete(id));
  const options = f => ({ storageKey: 'blogger-test', getStatus: f.getStatus, getResults: f.getResults, isTerminal: f.isTerminal,
    writeBatch: async (items, task) => { rows.push(...items.map(item => item.user_id)); assert.equal(task.targetTableId, 'target-table'); },
    onError: error => assert.fail(error.message), onFinish: (_, task) => finished.push(task.writtenCount) });
  first.setReply(() => ({ sta: 0, data: { status: 0, data: [], count: 0, has_more: false } }));
  const active = createEngine(options(first)); await active.start(first.submitted()); active.stop();
  assert.equal(saved.apiBaseUrl, 'https://api.socialdatax.com'); assert.equal(saved.apiPathPrefix, '/socialdatax/api');
  assert.deepEqual(saved.fieldMappings, [{ source_key: 'nickname', target_field_id: 'name' }]);
  saved.cursor = 'previous-page';
  const reopened = fixture(saved, { ...production, VITE_FEISHU_API_BASE_URL: 'https://changed.example' });
  let status = 0;
  reopened.setReply(call => ({ sta: 0, data: call.method === 'get'
    ? { status, cancel_requested: true, status_text: status ? 'cancelled' : 'cancel_requested' }
    : { data: call.data.after_id === 'previous-page' ? [{ user_id: 'author-1' }] : [], count: 1, next_cursor: 'last-page', has_more: false } }));
  const resumed = createEngine(options(reopened)); assert.equal(await resumed.resume(), true);
  assert.deepEqual(rows, ['author-1']); assert.deepEqual(finished, [], 'cancel_requested 期间继续轮询');
  assert.equal(saved.cursor, 'last-page'); status = 3;
  const [id, tick] = [...timers][0]; timers.delete(id); await tick();
  assert.deepEqual(finished, [1]); assert.deepEqual(saved, {});
  assert.ok(reopened.calls.every(call => call.baseURL === 'https://api.socialdatax.com'));
  assert.ok(reopened.calls.every(call => call.url.startsWith('/socialdatax/api/')));
  assert.equal(reopened.calls.find(call => call.method === 'post').data.after_id, 'previous-page');
});
