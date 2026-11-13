import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from '@vue/compiler-sfc';
import { parse as parseJS } from '@babel/parser';
import { loadRequestModule } from './helpers/requestService.mjs';

const source = parse(fs.readFileSync(new URL('../src/components/UrlToAttachment.vue', import.meta.url), 'utf8')).descriptor.scriptSetup.content;
const nodes = parseJS(source, { sourceType: 'module' }).program.body;
const declarations = nodes.filter(node => node.type === 'VariableDeclaration').flatMap(node => node.declarations);
const environments = [
  ['生产', { VITE_API_BASE_URL: 'https://api.52choujiang.cn', VITE_FEISHU_API_BASE_URL: 'https://api.socialdatax.com' }, 'https://api.socialdatax.com'],
  ['测试', { VITE_API_BASE_URL: 'https://legacy.example', VITE_FEISHU_API_BASE_URL: 'https://test-lotto.weiyoubot.cn' }, 'https://test-lotto.weiyoubot.cn'],
  ['开发同源', { VITE_API_BASE_URL: '/', VITE_FEISHU_API_BASE_URL: '/' }, ''],
];

function fixture(env, reply = { sta: 0, msg: 'ok', data: [{ name: 'cover.webp', content: 'https://files.example/cover.webp', contentType: 'attachment/url' }] }) {
  const api = loadRequestModule(env);
  const calls = [], downloads = [];
  api.service.defaults.adapter = async config => {
    calls.push(config);
    return { config, status: 200, data: typeof reply === 'function' ? reply(calls.length) : reply };
  };
  class TestFile { constructor(parts, name, options) { Object.assign(this, { parts, name, ...options }); } }
  const bindings = {
    ...api, request: api.service, props: { api_key: 'test-only' }, URL, File: TestFile,
    ATTACHMENT_BATCH_SIZE: 5, assertMounted: value => value,
    fetch: async url => { downloads.push(url); return { ok: true, blob: async () => ({ type: 'image/webp' }) }; },
  };
  const handler = name => {
    const node = declarations.find(item => item.id.name === name).init;
    return new Function(...Object.keys(bindings), `return (${source.slice(node.start, node.end)});`)(...Object.values(bindings));
  };
  bindings.isAttachmentUrl = handler('isAttachmentUrl');
  return { convert: handler('convertUrlsToAttachments'), calls, downloads };
}

test('附件转换显式导入新后端请求和路径工具', () => {
  const imported = nodes.filter(node => node.type === 'ImportDeclaration' && node.source.value.includes('utils/request'))
    .flatMap(node => node.specifiers.map(item => item.local.name));
  assert.ok(imported.includes('feishuRequest'));
  assert.ok(imported.includes('buildFeishuApiPath'));
});

for (const [label, env, base] of environments) {
  test(`附件${label}按五条分批请求新路由并继续下载生成 File`, async () => {
    const f = fixture(env);
    const links = Array.from({ length: 6 }, (_, i) => `https://example.test/${i}.webp`);
    const files = await f.convert(['bad', null, ...links]);
    assert.equal(f.calls.length, 2);
    for (const [index, config] of f.calls.entries()) {
      assert.equal(config.baseURL, base);
      assert.equal(config.url, '/socialdatax/api/v1/feishu/attch');
      assert.equal(config.method, 'post');
      assert.equal(config.headers.authorization, 'Bearer test-only');
      assert.deepEqual(JSON.parse(config.data), { links: links.slice(index * 5, index * 5 + 5), version: 'test-version' });
    }
    assert.equal(files.length, 2);
    assert.equal(files[0].name, 'cover.webp');
    assert.equal(files[0].type, 'image/webp');
    assert.deepEqual(f.downloads, ['https://files.example/cover.webp', 'https://files.example/cover.webp']);
  });
}

for (const reply of [{ sta: -1, msg: '积分不足', data: {} }, { sta: 4001, msg: '请输入正确的apikey' }]) {
  test(`附件业务错误 ${reply.sta} 保留原因并停止下载`, async () => {
    const f = fixture(environments[0][1], reply);
    await assert.rejects(f.convert(['https://example.test/cover.webp']), { message: reply.msg });
    assert.deepEqual(f.downloads, []);
  });
}

test('后续批次失败时保留错误且不下载前批结果', async () => {
  const f = fixture(environments[0][1], batch => batch === 1
    ? { sta: 0, data: [{ content: 'https://files.example/cover.webp' }] }
    : { sta: -1, msg: '当前媒体暂时无法生成附件。', data: {} });
  await assert.rejects(f.convert(Array.from({ length: 6 }, (_, i) => `https://example.test/${i}`)), { message: '当前媒体暂时无法生成附件。' });
  assert.equal(f.calls.length, 2);
  assert.deepEqual(f.downloads, []);
});

test('空附件响应保留原有错误且不发起下载', async () => {
  const f = fixture(environments[0][1], { sta: 0, data: [] });
  await assert.rejects(f.convert(['https://example.test/cover.webp']), { message: '未解析到可用附件' });
  assert.deepEqual(f.downloads, []);
});
