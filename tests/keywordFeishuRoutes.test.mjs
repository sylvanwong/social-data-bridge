import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from '@vue/compiler-sfc';
import { parse as parseJS } from '@babel/parser';
import { loadRequestModule } from './helpers/requestService.mjs';

const production = { VITE_API_BASE_URL: 'https://legacy.example', VITE_FEISHU_API_BASE_URL: 'https://api.socialdatax.com' };

function fixture(task = { taskId: 'old-task' }, env = production) {
  const source = parse(fs.readFileSync(new URL('../src/components/KeywordSearch.vue', import.meta.url), 'utf8')).descriptor.scriptSetup.content;
  const declarations = parseJS(source, { sourceType: 'module' }).program.body
    .filter(node => node.type === 'VariableDeclaration').flatMap(node => node.declarations);
  const api = loadRequestModule(env);
  const calls = [];
  let submitted, reply = () => ({ sta: 0, data: { task_id: 'new-task', status: 0, data: [], count: 0, has_more: false } });
  api.service.defaults.adapter = async config => {
    const call = { ...config, data: typeof config.data === 'string' ? JSON.parse(config.data) : config.data };
    calls.push(call);
    return { config, status: 200, data: await reply(call) };
  };
  const bindings = {
    ...api, request: api.service, props: { api_key: 'test-only' },
    selectedFieldKeys: { value: ['aweme_id'] }, mappingDraft: { value: [] },
    formData1: { value: { social_type: 'douyin', keyword: '露营\n徒步', sort_type: 2, publish_time: 2,
      filter_duration: '0', douyin_content_type: 1, radio: 1, writeMode: 'upsert', workFetchRange: { type: 'pages', pages: 2 } } },
    isBilibiliCustomDate: { value: false }, normalizeWorkFetchRange: () => ({ type: 'pages', value: 2, timezone: 'Asia/Shanghai' }),
    isCancelling: { value: false }, clearing: { value: false },
    getStoppingText: () => '正在停止', showToast() {}, restoreTask() {}, TASK_TOAST_SUFFIX: '',
    showErrorMsg: message => assert.fail(message), console: { error() {} },
    keywordStreamTask: { getActiveTask: () => task, submit: async create => { submitted = await create(); } },
  };
  const helper = declarations.find(node => node.id.name === 'keywordTaskApiPath');
  if (helper) bindings.keywordTaskApiPath = new Function(...Object.keys(bindings), `return (${source.slice(helper.init.start, helper.init.end)});`)(...Object.values(bindings));
  const handler = name => {
    const node = declarations.find(item => item.id.name === name).init;
    return new Function(...Object.keys(bindings), `return (${source.slice(node.start, node.end)});`)(...Object.values(bindings));
  };
  const callbacks = Object.fromEntries(declarations.find(node => node.id.name === 'keywordStreamTask').init.arguments[0].properties
    .filter(node => ['getStatus', 'getResults', 'isTerminal'].includes(node.key.name))
    .map(node => [node.key.name, new Function(...Object.keys(bindings), `return (${source.slice(node.value.start, node.value.end)});`)(...Object.values(bindings))]));
  return { ...callbacks, create: handler('postSearchTask'), cancel: handler('cancelKeywordTask'), calls,
    submitted: () => submitted, setReply: value => { reply = value; }, setTask: value => { task = value; }, bindings };
}

for (const [label, env, base] of [
  ['生产', production, 'https://api.socialdatax.com'],
  ['测试', { VITE_API_BASE_URL: 'https://legacy.example', VITE_FEISHU_API_BASE_URL: 'https://test-lotto.weiyoubot.cn' }, 'https://test-lotto.weiyoubot.cn'],
  ['开发同源', { VITE_API_BASE_URL: '/', VITE_FEISHU_API_BASE_URL: '/' }, ''],
]) {
  test(`关键词${label}创建使用迁移路由，保留参数并保存来源`, async () => {
    const f = fixture(undefined, env);
    await f.create('target-table');
    assert.equal(f.calls[0].baseURL, base);
    assert.equal(f.calls[0].url, '/socialdatax/api/v1/feishu/keyword/task');
    assert.deepEqual(f.calls[0].data, { social_type: 'douyin', keyword: '露营\n徒步', pages: 2,
      work_fetch_range: { type: 'pages', value: 2, timezone: 'Asia/Shanghai' },
      filter_config: { sort_type: 2, publish_time: 2, filter_duration: '0', content_type: 1 }, version: 'test-version' });
    assert.equal(f.calls[0].headers.authorization, 'Bearer test-only');
    assert.equal(f.submitted().apiBaseUrl, base);
    assert.equal(f.submitted().apiPathPrefix, '/socialdatax/api');
    assert.equal(f.submitted().targetTableId, 'target-table');
    assert.deepEqual(f.submitted().selectedFieldKeys, ['aweme_id']);
  });
}

for (const [label, task, base, prefix] of [
  ['保存的新任务', { taskId: 'new/task', apiBaseUrl: 'https://saved.example', apiPathPrefix: '/socialdatax/api' }, 'https://saved.example', '/socialdatax/api'],
  ['无来源的历史任务', { taskId: 'old-task' }, 'https://legacy.example', '/social/api'],
  ['保存的旧任务', { taskId: 'legacy-task', apiBaseUrl: 'https://old-saved.example', apiPathPrefix: '/social/api' }, 'https://old-saved.example', '/social/api'],
  ['保存的同源任务', { taskId: 'local-task', apiBaseUrl: '', apiPathPrefix: '/socialdatax/api' }, '', '/socialdatax/api'],
]) {
  test(`关键词${label}查询、读结果和取消始终使用原来源`, async () => {
    const savedTask = { ...task, cursor: 'cursor-1' };
    const f = fixture(savedTask);
    await f.getStatus(savedTask);
    await f.getResults(savedTask);
    await f.cancel();
    assert.deepEqual(f.calls.map(call => call.baseURL), [base, base, base]);
    assert.deepEqual(f.calls.map(call => call.url), [
      `${prefix}/v1/feishu/keyword/task?task_id=${encodeURIComponent(task.taskId)}`,
      `${prefix}/v1/feishu/post/list`, `${prefix}/v1/feishu/keyword/task/cancel`,
    ]);
    assert.ok(f.calls.every(call => call.headers.authorization === 'Bearer test-only'));
    assert.equal(f.calls[0].params.version, 'test-version');
    assert.equal(f.calls[1].data.after_id, 'cursor-1');
    assert.equal(f.calls[1].data.limit, 40);
    assert.equal(f.calls[2].data.task_id, task.taskId);
    assert.equal(f.bindings.isCancelling.value, true, '请求成功仅进入停止等待，不提前完成任务');
  });
}

test('关键词恢复保留来源与游标，停止确认后写完剩余结果才清理', async () => {
  const first = fixture();
  await first.create('target-table');
  let saved, timerId = 0;
  const timers = new Map(), rows = [], finished = [];
  const sdk = { base: { getSelection: async () => ({ baseId: 'base' }) },
    bridge: { getData: async () => structuredClone(saved), setData: async (_, value) => { saved = structuredClone(value); } } };
  const source = fs.readFileSync(new URL('../src/composables/useIncrementalTask.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/, '').replace('export const useIncrementalTask', 'const useIncrementalTask');
  const createEngine = new Function('bitable', 'setTimeout', 'clearTimeout', `${source}; return useIncrementalTask;`)(sdk,
    callback => { timers.set(++timerId, callback); return timerId; }, id => timers.delete(id));
  const options = f => ({ storageKey: 'keyword-test', getStatus: f.getStatus, getResults: f.getResults, isTerminal: f.isTerminal,
    writeBatch: async items => rows.push(...items.map(item => item.aweme_id)), onError: error => assert.fail(error.message),
    onFinish: (_, task) => finished.push(task.writtenCount) });
  first.setReply(() => ({ sta: 0, data: { status: 0, data: [], count: 0, has_more: false } }));
  const active = createEngine(options(first));
  await active.start(first.submitted());
  active.stop();
  assert.equal(saved.apiBaseUrl, 'https://api.socialdatax.com');
  assert.equal(saved.apiPathPrefix, '/socialdatax/api');
  saved.cursor = 'previous-page';
  const reopened = fixture(saved, { ...production, VITE_FEISHU_API_BASE_URL: 'https://changed.example' });
  let status = 0;
  reopened.setReply(call => ({ sta: 0, data: call.method === 'get'
    ? { status, cancel_requested: true, status_text: status ? 'cancelled' : 'cancel_requested' }
    : { data: call.data.after_id === 'previous-page' ? [{ aweme_id: 'post-1' }] : [],
      count: 1, next_cursor: 'last-page', has_more: false } }));
  const resumed = createEngine(options(reopened));
  assert.equal(await resumed.resume(), true);
  assert.deepEqual(rows, ['post-1']);
  assert.deepEqual(finished, [], 'cancel_requested 期间继续轮询');
  assert.equal(saved.cursor, 'last-page');
  status = 3;
  const [id, tick] = [...timers][0]; timers.delete(id); await tick();
  assert.deepEqual(finished, [1]);
  assert.deepEqual(saved, {});
  assert.ok(reopened.calls.every(call => call.baseURL === 'https://api.socialdatax.com'));
  assert.ok(reopened.calls.every(call => call.url.startsWith('/socialdatax/api/')));
  assert.equal(reopened.calls.find(call => call.method === 'post').data.after_id, 'previous-page');
});
