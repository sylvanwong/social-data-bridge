import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from '@vue/compiler-sfc';
import { parse as parseJS } from '@babel/parser';
import { loadRequestModule } from './helpers/requestService.mjs';

const pages = [
  ['BloggerInfoFetch', 3], ['BloggerSearch', 2], ['CommentFetch', 2], ['HotListFetch', 2],
  ['KeywordSearch', 2], ['ProfileFetch', 2], ['SearchSuggestions', 2], ['SeriesFetch', 2],
  ['UrlToAttachment', 1], ['VideoCopySummary', 1], ['VideoDataFetch', 2], ['XhsDownload', 1],
];
const environments = [
  ['生产', { VITE_API_BASE_URL: 'https://legacy.example', VITE_FEISHU_API_BASE_URL: 'https://api.socialdatax.com' }, 'https://api.socialdatax.com'],
  ['测试', { VITE_API_BASE_URL: 'https://legacy.example', VITE_FEISHU_API_BASE_URL: 'https://test-lotto.weiyoubot.cn' }, 'https://test-lotto.weiyoubot.cn'],
  ['同源', { VITE_API_BASE_URL: '/', VITE_FEISHU_API_BASE_URL: '/' }, ''],
];

function readSource(page) {
  const text = fs.readFileSync(new URL(page === 'useToolOutputConfig'
    ? '../src/composables/useToolOutputConfig.js' : `../src/components/${page}.vue`, import.meta.url), 'utf8');
  const source = page === 'useToolOutputConfig' ? text : parse(text).descriptor.scriptSetup.content;
  const statements = parseJS(source, { sourceType: 'module' }).program.body;
  const declarations = statements.filter(node => node.type === 'VariableDeclaration').flatMap(node => node.declarations);
  const calls = [];
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'CallExpression' && ['request', 'feishuRequest'].includes(node.callee.name)) {
      const url = node.arguments[0]?.properties?.find(property => property.key.name === 'url')?.value;
      if (url && /TABLE_CONFIGS?_API_PATH|TASK_API_PATH/.test(source.slice(url.start, url.end))) calls.push(node);
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  };
  visit(statements);
  return { source, declarations, calls };
}

function fixture(page, env) {
  const ast = readSource(page), api = loadRequestModule(env), calls = [], notices = [];
  let reply = { sta: 0, data: [] };
  api.service.defaults.adapter = async config => {
    calls.push({ ...config, data: typeof config.data === 'string' ? JSON.parse(config.data) : config.data });
    return { config, status: 200, data: reply };
  };
  const payload = { plugin_type: 'profile_fetch', base_id: 'base', target_table_id: 'target', write_mode: 'append',
    field_mappings: [{ source_key: 'title', target_field_id: 'mapped' }], snapshot: { original: true }, schedule: { enabled: true } };
  const bindings = { ...api, request: api.service, props: { api_key: 'test-only' },
    auth: () => ({ authorization: 'Bearer test-only' }),
    baseId: 'base', selection: { baseId: 'base' }, getBaseId: async () => 'base',
    pluginType: 'video_copy_summary', payload, taskId: null,
    task: { id: 'legacy-task-id', apiBaseUrl: 'https://old-task.example', apiPathPrefix: '/social/api' }, nextEnabled: false,
    taskList: { value: [] }, taskListLoading: { value: false },
    bitable: { base: { getSelection: async () => ({ baseId: 'base' }) } },
    ElMessage: notice => notices.push(notice), console: { error() {} },
  };
  const evaluate = node => new Function(...Object.keys(bindings), `return (${ast.source.slice(node.start, node.end)});`)(...Object.values(bindings));
  for (const name of ['TASK_PLUGIN_TYPE', 'TABLE_CONFIG_API_PATH', 'TABLE_CONFIGS_API_PATH', 'TASK_API_PATH', 'parseTaskList']) {
    const node = ast.declarations.find(node => node.id.name === name)?.init;
    if (node) bindings[name] = evaluate(node);
  }
  const invoke = node => new Function(...Object.keys(bindings), `return (async () => (${ast.source.slice(node.start, node.end)}))();`)(...Object.values(bindings));
  return { ...ast, calls, notices, bindings, payload, evaluate, invoke, setReply: data => { reply = data; } };
}

for (const [page, count] of [...pages, ['useToolOutputConfig', 1]]) {
  for (const [label, env, base] of environments) {
    test(`${page} ${label}所有输出配置请求统一新来源且保留原三元键和映射`, async () => {
      const f = fixture(page, env);
      const readers = f.calls;
      const nodes = readSource(page).calls.filter(node => /TABLE_CONFIG/.test(f.source.slice(node.start, node.end)));
      assert.equal(nodes.length, count, '覆盖所有主页面、任务弹窗及共享配置调用点');
      for (const node of nodes) await f.invoke(node);
      assert.equal(readers.length, count);
      for (const call of readers) {
        assert.equal(call.baseURL, base);
        assert.equal(call.headers.authorization, 'Bearer test-only');
        if (call.method === 'get') {
          assert.equal(call.url, '/socialdatax/api/v1/feishu/profile-fetch/table-output-configs');
          assert.deepEqual(call.params, { plugin_type: f.bindings.TASK_PLUGIN_TYPE ?? f.bindings.pluginType, base_id: 'base', version: 'test-version' });
        } else {
          assert.equal(call.method, 'put');
          assert.equal(call.url, '/socialdatax/api/v1/feishu/profile-fetch/table-output-config');
          assert.deepEqual(call.data, { ...f.payload, version: 'test-version' });
        }
      }
    });
  }
}

for (const page of ['ProfileFetch', 'BloggerInfoFetch', 'VideoDataFetch']) {
  for (const [label, env, base] of environments) {
    test(`${page} ${label}定时任务CRUD/toggle管理历史任务也统一新来源`, async () => {
      const f = fixture(page, env);
      const nodes = readSource(page).calls.filter(node => /TASK_API_PATH/.test(f.source.slice(node.start, node.end)));
      assert.equal(nodes.length, 4);
      await f.invoke(nodes[0]);
      await f.invoke(nodes[1]);
      f.bindings.taskId = 'legacy-task-id';
      await f.invoke(nodes[1]);
      await f.invoke(nodes[2]);
      await f.invoke(nodes[3]);
      assert.deepEqual(f.calls.map(call => call.method), ['get', 'post', 'put', 'delete', 'post']);
      assert.deepEqual(f.calls.map(call => call.url), [
        '/socialdatax/api/v1/feishu/schedule/tasks', '/socialdatax/api/v1/feishu/schedule/tasks',
        '/socialdatax/api/v1/feishu/schedule/tasks/legacy-task-id', '/socialdatax/api/v1/feishu/schedule/tasks/legacy-task-id',
        '/socialdatax/api/v1/feishu/schedule/tasks/legacy-task-id/toggle',
      ]);
      assert.ok(f.calls.every(call => call.baseURL === base && call.headers.authorization === 'Bearer test-only'));
      assert.deepEqual(f.calls[0].params, { plugin_type: f.bindings.TASK_PLUGIN_TYPE, base_id: 'base', version: 'test-version' });
      for (const call of f.calls.slice(1, 3)) assert.deepEqual(call.data, { ...f.payload, version: 'test-version' });
      assert.deepEqual(f.calls[3].data, { version: 'test-version' });
      assert.deepEqual(f.calls[4].data, { enabled: false, version: 'test-version' });
    });
  }

  test(`${page}实际定时任务列表保留新旧executor记录，读取失败保留原因并结束加载`, async () => {
    const f = fixture(page, environments[0][1]);
    const rows = [{ id: 'legacy-task-id', enabled: false, snapshot: { title: '历史任务' } },
      { id: 'new-task-id', enabled: true, executor: 'social_service', snapshot: { title: '新任务' } }];
    f.setReply({ sta: 0, data: { list: rows } });
    const load = f.evaluate(f.declarations.find(node => node.id.name === 'loadTaskList').init);
    await load();
    assert.equal(f.calls[0].baseURL, 'https://api.socialdatax.com');
    assert.deepEqual(f.bindings.taskList.value, rows);
    assert.equal(f.bindings.taskListLoading.value, false);
    f.setReply({ sta: -1, msg: '任务管理暂不可用' });
    await load();
    assert.deepEqual(f.bindings.taskList.value, []);
    assert.match(f.notices.at(-1).message, /任务管理暂不可用/);
    assert.equal(f.bindings.taskListLoading.value, false);
  });
}
