import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from '@vue/compiler-sfc';
import { parse as parseJS } from '@babel/parser';
import { loadRequestModule } from './helpers/requestService.mjs';
import { getPendingWriteLimit } from '../src/utils/taskWriteState.mjs';

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
    ...api, getPendingWriteLimit, request: api.service, props: { api_key: 'test-only' }, componentUnmounted: false,
    isCancelling: { value: false }, clearing: { value: false },
    selectedFieldKeys: { value: ['aweme_id'] }, mappingDraft: { value: [] },
    formData: { value: { writeMode: 'upsert', workFetchRange: { type: 'pages', pages: 1 } } },
    cloneFieldMappings: fields => structuredClone(fields), normalizeWorkFetchRange: () => ({ type: 'pages', value: 1 }),
    getStoppingText: () => '正在停止', showToast() {}, showErrorMsg: message => assert.fail(message),
    restoreProfileTask() {},
    profileStreamTask: { getActiveTask: () => task, submit: async create => { submitted = await create(); } },
  };
  const names = ['STREAM_RESULT_LIMIT', 'profileTaskApiPath', 'unwrapApiData', 'getProfileTaskStatus', 'readAvailablePosts', 'postProfileTask', 'cancelProfileTask'];
  const helpers = names.map(name => {
    const node = declarations.find(item => item.id.name === name);
    assert.ok(node, `${name} 应使用任务保存的请求来源`);
    return `const ${name} = ${source.slice(node.init.start, node.init.end)};`;
  }).join('\n');
  const handlers = new Function(...Object.keys(bindings), `${helpers}; return { ${names.join(',')} };`)(...Object.values(bindings));
  return { ...handlers, calls, submitted: () => submitted };
}

test('本次执行结果使用现有面板并默认展开', () => {
  const template = parse(fs.readFileSync(new URL('../src/components/ProfileFetch.vue', import.meta.url), 'utf8')).descriptor.template.content;
  assert.match(template, /class="task-manager profile-result-manager"/);
  assert.match(template, /latestProfileResultExpanded/);
  assert.match(template, /class="task-list profile-result-list"/);
  assert.match(template, /本次执行结果/);
  const script = parse(fs.readFileSync(new URL('../src/components/ProfileFetch.vue', import.meta.url), 'utf8')).descriptor.scriptSetup.content;
  assert.match(script, /const latestProfileResultExpanded = ref\(true\)/);
});

test('作者作品页面进入时只检查未完成任务，不读取账号最近结果', () => {
  const source = fs.readFileSync(new URL('../src/components/ProfileFetch.vue', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /social\/task\/latest/);
  assert.match(source, /await resumeSavedStreamTask\(\)/);
});

test('作品新任务创建使用新域名及规范路径，并保存任务来源', async () => {
  const f = fixture();
  const selectedFieldKeys = ['aweme_id', 'cover_attachment'];
  await f.postProfileTask('target-table', 'https://www.douyin.com/user/example', { selectedFieldKeys });
  assert.deepEqual(f.calls[0].data.selected_field_keys, selectedFieldKeys);
  assert.deepEqual(f.submitted().selectedFieldKeys, selectedFieldKeys);
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
    assert.equal(f.calls[1].data.limit, 100);
  });
}

for (const [selectedFieldKeys, limit] of [[['aweme_id'], 100], [['aweme_id', 'cover_attachment'], 40]]) {
  test(`作品结果按原任务附件快照每批读取${limit}条并保留恢复游标`, async () => {
    const task = { taskId: 'saved-task', selectedFieldKeys, cursor: 'saved-cursor' };
    const f = fixture(task);
    await f.readAvailablePosts(task);
    assert.equal(f.calls[0].data.limit, limit);
    assert.equal(f.calls[0].data.after_id, 'saved-cursor');
  });
}

for (const pendingWriteCount of [undefined, 0, -1, 20.5, 101, '20']) {
  test(`追加恢复不使用不可靠范围${String(pendingWriteCount)}请求结果，也不要求重开插件`, async () => {
    const task = { taskId: 'old-append', targetTableId: 'B', writeMode: 'append', pendingWrite: true, pendingWriteCount };
    const f = fixture(task);
    await assert.rejects(f.readAvailablePosts(task), error => {
      assert.equal(error.stopPolling, true);
      assert.notEqual(error.requiresReopen, true);
      assert.match(error.message, /无法确认.*批次范围/);
      return true;
    });
    assert.equal(f.calls.length, 0);
  });
}

test('追加恢复使用已保存的20条范围，旧更新任务缺少范围仍按作品ID正常恢复', async () => {
  const f = fixture();
  await f.readAvailablePosts({ taskId: 'append', targetTableId: 'B', pendingWrite: true,
    writeMode: 'append', pendingWriteCount: 20, cursor: 'previous-cursor',
    appendState: { knownRecordIds: [], fieldIds: ['identity'], pendingCount: 20 } });
  await f.readAvailablePosts({ taskId: 'old-upsert', targetTableId: 'B', writeMode: 'upsert' });
  assert.deepEqual(f.calls.map(call => call.data.limit), [20, 100]);
  assert.equal(f.calls[0].data.after_id, 'previous-cursor');
});

for (const appendState of [undefined, {}, { knownRecordIds: {}, fieldIds: ['identity'], pendingCount: 20 },
  { knownRecordIds: [], fieldIds: [], pendingCount: 20 }, { knownRecordIds: [], fieldIds: ['identity'], pendingCount: 10 }]) {
  test(`追加恢复缺少可靠历史行核对信息时不读结果：${JSON.stringify(appendState)}`, async () => {
    const task = { taskId: 'uncertain', targetTableId: 'B', writeMode: 'append', pendingWrite: true, pendingWriteCount: 20, appendState };
    const before = structuredClone(task), f = fixture(task);
    await assert.rejects(f.readAvailablePosts(task), error => {
      assert.equal(error.stopPolling, true);
      assert.notEqual(error.requiresReopen, true);
      assert.match(error.message, /无法区分历史行.*本批新增/);
      return true;
    });
    assert.equal(f.calls.length, 0);
    assert.deepEqual(task, before);
  });
}
