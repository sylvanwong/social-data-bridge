import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from '@vue/compiler-sfc';
import { parse as parseJS } from '@babel/parser';
import { loadRequestModule } from './helpers/requestService.mjs';

function fixture(task = { taskId: 'old-task' }) {
  const source = parse(fs.readFileSync(new URL('../src/components/ProfileFetch.vue', import.meta.url), 'utf8')).descriptor.scriptSetup.content;
  const declarations = parseJS(source, { sourceType: 'module' }).program.body
    .filter(node => node.type === 'VariableDeclaration').flatMap(node => node.declarations);
  const api = loadRequestModule({ VITE_API_BASE_URL: 'https://legacy.example', VITE_FEISHU_API_BASE_URL: 'https://api.socialdatax.com' });
  const calls = [];
  api.service.defaults.adapter = async config => {
    calls.push({ ...config, data: typeof config.data === 'string' ? JSON.parse(config.data) : config.data });
    return { config, status: 200, data: { sta: 0, data: { task_id: 'new-task', status: 0, data: [], count: 0 } } };
  };
  let submitted;
  const bindings = {
    ...api, request: api.service, props: { api_key: 'test-only' }, componentUnmounted: false,
    STREAM_RESULT_LIMIT: 40, isCancelling: { value: false }, clearing: { value: false },
    selectedFieldKeys: { value: ['aweme_id'] }, mappingDraft: { value: [] },
    formData: { value: { writeMode: 'upsert', workFetchRange: { type: 'pages', pages: 1 } } },
    cloneFieldMappings: fields => structuredClone(fields), normalizeWorkFetchRange: () => ({ type: 'pages', value: 1 }),
    getStoppingText: () => '正在停止', showToast() {}, showErrorMsg: message => assert.fail(message),
    restoreProfileTask() {},
    profileStreamTask: { getActiveTask: () => task, submit: async create => { submitted = await create(); } },
  };
  const names = ['profileTaskApiPath', 'unwrapApiData', 'getProfileTaskStatus', 'readAvailablePosts', 'postProfileTask', 'cancelProfileTask'];
  const helpers = names.map(name => {
    const node = declarations.find(item => item.id.name === name);
    assert.ok(node, `${name} 应使用任务保存的请求来源`);
    return `const ${name} = ${source.slice(node.init.start, node.init.end)};`;
  }).join('\n');
  const handlers = new Function(...Object.keys(bindings), `${helpers}; return { ${names.join(',')} };`)(...Object.values(bindings));
  return { ...handlers, calls, submitted: () => submitted };
}

test('作品新任务创建使用新域名及规范路径，并保存任务来源', async () => {
  const f = fixture();
  await f.postProfileTask('target-table', 'https://www.douyin.com/user/example');
  assert.equal(f.calls[0].baseURL, 'https://api.socialdatax.com');
  assert.equal(f.calls[0].url, '/socialdatax/api/v1/feishu/social/task');
  assert.equal(f.calls[0].data.version, 'test-version');
  assert.equal(f.submitted().apiBaseUrl, 'https://api.socialdatax.com');
  assert.equal(f.submitted().apiPathPrefix, '/socialdatax/api');
  assert.equal(f.submitted().targetTableId, 'target-table');
});

for (const [label, task, base, prefix] of [
  ['新任务', { taskId: 'new-task', apiBaseUrl: 'https://saved.example', apiPathPrefix: '/socialdatax/api' }, 'https://saved.example', '/socialdatax/api'],
  ['历史任务', { taskId: 'old-task' }, 'https://legacy.example', '/social/api'],
  ['开发环境任务', { taskId: 'local-task', apiBaseUrl: '', apiPathPrefix: '/socialdatax/api' }, '', '/socialdatax/api'],
]) {
  test(`${label}查询、结果与取消始终使用同一任务来源`, async () => {
    const f = fixture(task);
    await f.getProfileTaskStatus(task);
    await f.readAvailablePosts(task);
    await f.cancelProfileTask();
    assert.deepEqual(f.calls.map(call => call.baseURL), [base, base, base]);
    assert.deepEqual(f.calls.map(call => call.url), [
      `${prefix}/v1/feishu/social/task?task_id=${task.taskId}`,
      `${prefix}/v1/feishu/post/list`, `${prefix}/v1/feishu/social/task/cancel`,
    ]);
    assert.ok(f.calls.every(call => call.headers.authorization === 'Bearer test-only'));
    assert.equal(f.calls[1].data.after_id, '');
    assert.equal(f.calls[1].data.limit, 40);
  });
}
