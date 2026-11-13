import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from '@vue/compiler-sfc';
import { parse as parseJS } from '@babel/parser';
import { loadRequestModule } from './helpers/requestService.mjs';

const source = parse(fs.readFileSync(new URL('../src/components/HotListFetch.vue', import.meta.url), 'utf8')).descriptor.scriptSetup.content;
const nodes = parseJS(source, { sourceType: 'module' }).program.body;
const declarations = nodes.filter(node => node.type === 'VariableDeclaration').flatMap(node => node.declarations);
const environments = [
  ['生产', { VITE_API_BASE_URL: 'https://api.52choujiang.cn', VITE_FEISHU_API_BASE_URL: 'https://api.socialdatax.com' }, 'https://api.socialdatax.com'],
  ['测试', { VITE_API_BASE_URL: 'https://legacy.example', VITE_FEISHU_API_BASE_URL: 'https://test-lotto.weiyoubot.cn' }, 'https://test-lotto.weiyoubot.cn'],
  ['开发同源', { VITE_API_BASE_URL: '/', VITE_FEISHU_API_BASE_URL: '/' }, ''],
];

function fixture(env, platform, reply) {
  const api = loadRequestModule(env);
  const calls = [], writes = [], errors = [], notices = [], created = [];
  api.service.defaults.adapter = async config => {
    calls.push(config);
    return { config, status: 200, data: reply };
  };
  const bindings = {
    ...api, request: api.service, props: { api_key: 'test-only' },
    formData: { value: { platform } }, loading: { value: false },
    getActiveFieldMapping: () => [{ key: 'keyword' }], showErrorMsg: message => assert.fail(message),
    showToast: (...args) => notices.push(args), taskFeedback: { fail: error => errors.push(error) },
    console: { error() {} },
    createSequentialTable: async name => { created.push(name); return { tableId: 'new-table' }; },
    setupTableFields: async () => {},
    bitable: { base: { getTableById: async id => ({ id }) }, ui: { switchToTable: async () => {} } },
    writeDataToTable: async (table, items, existing) => writes.push({ tableId: table.id, items, existing }),
  };
  const handler = name => {
    const node = declarations.find(item => item.id.name === name).init;
    return new Function(...Object.keys(bindings), `return (${source.slice(node.start, node.end)});`)(...Object.values(bindings));
  };
  bindings.extractList = handler('extractList');
  return { submit: handler('submit'), calls, writes, errors, notices, created, bindings };
}

test('热榜显式导入已迁移路由的请求和路径工具', () => {
  const imported = nodes.filter(node => node.type === 'ImportDeclaration' && node.source.value.includes('utils/request'))
    .flatMap(node => node.specifiers.map(item => item.local.name));
  assert.ok(imported.includes('feishuRequest'));
  assert.ok(imported.includes('buildFeishuApiPath'));
});

for (const [label, env, base] of environments) {
  for (const platform of ['douyin', 'xhs', 'kuaishou', 'weibo', 'wechat', 'toutiao', 'haokan']) {
    for (const existing of [false, true]) {
      test(`热榜${label}/${platform}/${existing ? '已有表' : '新建表'}使用新域名和路由`, async () => {
        const items = [{ social_type: platform, rank: 1, keyword: '热点', hot_value: null, tag: '无' }];
        const f = fixture(env, platform, { sta: 0, msg: 'ok', data: { hot_items: items, pinned_items: [{ title: '置顶' }] } });
        await f.submit(existing ? 'existing-table' : '');
        assert.equal(f.calls.length, 1);
        assert.equal(f.calls[0].baseURL, base);
        assert.equal(f.calls[0].url, '/socialdatax/api/v1/feishu/hot/list');
        assert.equal(f.calls[0].method, 'get');
        assert.deepEqual(f.calls[0].params, { social_type: platform, version: 'test-version' });
        assert.equal(f.calls[0].headers.authorization, 'Bearer test-only');
        assert.deepEqual(f.writes, [{ tableId: existing ? 'existing-table' : 'new-table', items, existing }]);
        assert.deepEqual(f.created, existing ? [] : ['热榜获取']);
        assert.deepEqual(f.errors, []);
        assert.equal(f.bindings.loading.value, false);
      });
    }
  }
}

for (const reply of [
  { sta: -1, msg: '服务暂时不可用，请稍后重试', data: {} },
  { sta: 4001, msg: '请输入正确的apikey' },
]) {
  test(`热榜返回 ${reply.sta} 时保留错误信息并停止写表`, async () => {
    const f = fixture(environments[0][1], 'douyin', reply);
    await f.submit('existing-table');
    assert.equal(f.errors.length, 1);
    assert.equal(f.errors[0].message, reply.msg);
    assert.deepEqual(f.writes, []);
    assert.equal(f.bindings.loading.value, false);
  });
}

test('热榜空结果不新建表格或写表', async () => {
  const f = fixture(environments[0][1], 'haokan', { sta: 0, data: { hot_items: [] } });
  await f.submit();
  assert.deepEqual(f.created, []);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.errors, []);
  assert.ok(f.notices.some(([text]) => text === '未获取到热榜数据'));
});
