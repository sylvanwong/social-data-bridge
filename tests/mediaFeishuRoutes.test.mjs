import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from '@vue/compiler-sfc';
import { parse as parseJS } from '@babel/parser';
import { loadRequestModule, rejectHttp } from './helpers/requestService.mjs';

const source = parse(fs.readFileSync(new URL('../src/components/VideoCopySummary.vue', import.meta.url), 'utf8')).descriptor.scriptSetup.content;
const statements = parseJS(source, { sourceType: 'module' }).program.body;
const declarations = statements.filter(node => node.type === 'VariableDeclaration').flatMap(node => node.declarations);
const production = { VITE_API_BASE_URL: 'https://legacy.example', VITE_FEISHU_API_BASE_URL: 'https://api.socialdatax.com' };

function fixture(env = production) {
  const api = loadRequestModule(env);
  const calls = [], waits = [], writes = [], failures = [];
  let reply = call => ({ sta: 0, data: call.url.endsWith('/get')
    ? { task_id: call.data.task_id, status: 'succeeded', summary: '摘要', transcript: { text: '原文案' }, platform: 'douyin' }
    : { task_id: `task-${calls.length}`, status: 'queued', next_poll_after_seconds: 1, cache_hit: false } });
  api.service.defaults.adapter = async config => {
    const call = { ...config, data: typeof config.data === 'string' ? JSON.parse(config.data) : config.data };
    calls.push(call);
    return { config, status: 200, data: await reply(call) };
  };
  const bindings = { ...api, request: api.service, props: { api_key: 'test-only' },
    assertMounted: value => value, sleep: async ms => { waits.push(ms); },
    showToast() {}, stopRequested: { value: false },
    taskFeedback: { recordFailure: (error, row) => failures.push({ error, row }) },
  };
  const handler = name => {
    const node = declarations.find(node => node.id.name === name)?.init
      ?? statements.find(node => node.type === 'FunctionDeclaration' && node.id.name === name);
    assert.ok(node, `${name} exists`);
    return new Function(...Object.keys(bindings), `return (${source.slice(node.start, node.end)});`)(...Object.values(bindings));
  };
  bindings.createMediaTask = handler('createMediaTask');
  bindings.pollMediaTask = handler('pollMediaTask');
  bindings.getFirstValidValue = handler('getFirstValidValue');
  const getSummary = handler('getSummary'), getVideoCopy = handler('getVideoCopy');
  return { create: bindings.createMediaTask, poll: bindings.pollMediaTask, fetchRows: handler('fetchSummaryByEntries'),
    bindings, calls, waits, writes, failures, getSummary, getVideoCopy,
    setReply: value => { reply = value; } };
}

for (const [label, env, base] of [
  ['生产', production, 'https://api.socialdatax.com'],
  ['测试', { VITE_API_BASE_URL: 'https://legacy.example', VITE_FEISHU_API_BASE_URL: 'https://test-lotto.weiyoubot.cn' }, 'https://test-lotto.weiyoubot.cn'],
  ['开发同源', { VITE_API_BASE_URL: '/', VITE_FEISHU_API_BASE_URL: '/' }, ''],
]) {
  test(`媒体${label}创建保存来源，queued/running/succeeded轮询保留原载荷和结果`, async () => {
    const f = fixture(env);
    const task = await f.create('https://example.test/video');
    assert.deepEqual(task, { task_id: 'task-1', status: 'queued', next_poll_after_seconds: 1, cache_hit: false,
      apiBaseUrl: base, apiPathPrefix: '/socialdatax/api' });
    let count = 0;
    const result = { status: 'succeeded', summary: '处理后摘要', transcript: { text: '逐字原文' }, platform: 'douyin', summary_error: '' };
    f.setReply(() => ({ sta: 0, data: ++count === 1 ? { status: 'queued', next_poll_after_seconds: 2 }
      : count === 2 ? { status: 'running', next_poll_after_seconds: 1 } : result }));
    assert.deepEqual(await f.poll(task, task.next_poll_after_seconds), result);
    assert.deepEqual(f.waits, [1000, 2000, 1000]);
    assert.equal(f.calls[0].url, '/socialdatax/api/v1/feishu/media/task');
    assert.deepEqual(f.calls[0].data, { url: 'https://example.test/video', force_refresh: false, version: 'test-version' });
    for (const call of f.calls) {
      assert.equal(call.baseURL, base);
      assert.equal(call.method, 'post');
      assert.equal(call.headers.authorization, 'Bearer test-only');
    }
    for (const call of f.calls.slice(1)) {
      assert.equal(call.url, '/socialdatax/api/v1/feishu/media/task/get');
      assert.deepEqual(call.data, { task_id: 'task-1', version: 'test-version' });
    }
    assert.equal(f.getSummary(result), '处理后摘要');
    assert.equal(f.getVideoCopy(result), '逐字原文');
  });
}

for (const [label, task, base, prefix] of [
  ['保存的新来源', { task_id: 'new-id', apiBaseUrl: 'https://saved.example', apiPathPrefix: '/socialdatax/api' }, 'https://saved.example', '/socialdatax/api'],
  ['无来源旧对象', { task_id: 'legacy-id' }, 'https://legacy.example', '/social/api'],
  ['旧ID入参', 'legacy-id', 'https://legacy.example', '/social/api'],
  ['保存的旧来源', { task_id: 'legacy-id', apiBaseUrl: 'https://old-saved.example', apiPathPrefix: '/social/api' }, 'https://old-saved.example', '/social/api'],
  ['显式同源', { task_id: 'local-id', apiBaseUrl: '', apiPathPrefix: '/socialdatax/api' }, '', '/socialdatax/api'],
  ['显式空前缀', { task_id: 'root-id', apiBaseUrl: '', apiPathPrefix: '' }, '', ''],
]) {
  test(`媒体${label}查询不受当前新后端环境影响`, async () => {
    const f = fixture({ ...production, VITE_FEISHU_API_BASE_URL: 'https://changed.example' });
    await f.poll(structuredClone(task), 1);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].baseURL, base);
    assert.equal(f.calls[0].url, `${prefix}/v1/feishu/media/task/get`);
    assert.deepEqual(f.calls[0].data, { task_id: typeof task === 'string' ? task : task.task_id, version: 'test-version' });
  });
}

test('媒体创建对象序列化后仍使用原来源，不切到当前新后端', async () => {
  const task = JSON.parse(JSON.stringify(await fixture().create('https://example.test/video')));
  const reopened = fixture({ ...production, VITE_FEISHU_API_BASE_URL: 'https://changed.example' });
  await reopened.poll(task, task.next_poll_after_seconds);
  assert.equal(reopened.calls[0].baseURL, 'https://api.socialdatax.com');
  assert.equal(reopened.calls[0].url, '/socialdatax/api/v1/feishu/media/task/get');
  assert.equal(reopened.calls[0].data.task_id, task.task_id);
});

test('逐行媒体处理将每次创建的完整来源交给轮询，再写原记录摘要和转写', async () => {
  const f = fixture();
  const result = await f.fetchRows([{ url: 'https://example.test/a', recordId: 'r1' }, { url: 'https://example.test/b', recordId: 'r2' }], {
    onSuccess: async item => f.writes.push({ recordId: item.__recordId, summary: f.getSummary(item), copywriting: f.getVideoCopy(item), platform: item.platform }),
  });
  assert.deepEqual(result, { successCount: 2, failCount: 0, stopped: false });
  assert.deepEqual(f.writes, ['r1', 'r2'].map(recordId => ({ recordId, summary: '摘要', copywriting: '原文案', platform: 'douyin' })));
  assert.ok(f.calls.every(call => call.baseURL === 'https://api.socialdatax.com'));
  assert.deepEqual(f.calls.map(call => call.url), [
    '/socialdatax/api/v1/feishu/media/task', '/socialdatax/api/v1/feishu/media/task/get',
    '/socialdatax/api/v1/feishu/media/task', '/socialdatax/api/v1/feishu/media/task/get',
  ]);
  assert.deepEqual(f.calls.filter(call => call.url.endsWith('/get')).map(call => call.data.task_id), ['task-1', 'task-3']);
});

for (const [label, response, message] of [
  ['创建业务错误', { sta: -1, msg: '余额不足' }, '余额不足'],
  ['创建缺任务ID', { sta: 0, data: {} }, '创建提取任务失败'],
]) {
  test(`媒体${label}保留原错`, async () => {
    const f = fixture(); f.setReply(() => response);
    await assert.rejects(f.create('https://example.test'), { message });
    assert.equal(f.calls.length, 1);
  });
}

for (const [label, response, message] of [
  ['查询业务错误', { sta: -1, msg: '任务不可访问' }, '任务不可访问'],
  ['失败原因', { sta: 0, data: { status: 'failed', error: '转写失败', summary_error: '摘要失败' } }, '转写失败'],
  ['仅摘要错误', { sta: 0, data: { status: 'failed', summary_error: '摘要失败' } }, '摘要失败'],
  ['未知状态', { sta: 0, data: { status: 'cancelled' } }, '任务状态异常: cancelled'],
]) {
  test(`媒体${label}保留既有处理`, async () => {
    const f = fixture(); f.setReply(() => response);
    await assert.rejects(f.poll({ task_id: 'task', apiBaseUrl: '', apiPathPrefix: '/socialdatax/api' }, 1), { message });
    assert.equal(f.calls.length, 1);
  });
}

test('摘要失败但转写成功仍保留成功结果和摘要错误文本', async () => {
  const f = fixture();
  const result = { status: 'succeeded', summary: '', summary_error: '摘要服务暂时不可用', transcript: { text: '完整转写' } };
  f.setReply(() => ({ sta: 0, data: result }));
  assert.deepEqual(await f.poll('legacy-id', 1), result);
  assert.equal(f.getSummary(result), '摘要服务暂时不可用');
  assert.equal(f.getVideoCopy(result), '完整转写');
});

test('媒体轮询次数和超时保持原边界', async () => {
  const f = fixture(); f.setReply(() => ({ sta: 0, data: { status: 'running', next_poll_after_seconds: 0 } }));
  await assert.rejects(f.poll('legacy-id', 0), { message: '任务处理超时，请稍后重试' });
  assert.equal(f.calls.length, 120);
  assert.ok(f.waits.every(ms => ms === 3000));
});

test('逐行媒体新请求鉴权失败立即停止，不请求或写入下一行', async () => {
  const f = fixture(); f.setReply(call => rejectHttp(call, 401, 'API Key 已失效'));
  await assert.rejects(f.fetchRows([{ url: 'a' }, { url: 'b' }], { onSuccess: item => f.writes.push(item) }), { code: 'INVALID_API_KEY' });
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.failures, []);
});
