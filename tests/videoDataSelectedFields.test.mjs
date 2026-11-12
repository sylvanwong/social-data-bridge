import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from '@vue/compiler-sfc';
import { parse as parseJS } from '@babel/parser';

const source = parse(fs.readFileSync(new URL('../src/components/VideoDataFetch.vue', import.meta.url), 'utf8')).descriptor.scriptSetup.content;
const callback = parseJS(source, { sourceType: 'module' }).program.body
  .filter(node => node.type === 'VariableDeclaration').flatMap(node => node.declarations)
  .find(node => node.id.name === 'fetchVideoDataByRows').init;

for (const keys of [[], ['title'], ['title', 'view_count'], ['comment_count', 'share_count']]) {
  test(`detail request forwards selected output fields: ${JSON.stringify(keys)}`, async () => {
    const requests = [];
    const bindings = {
      props: { api_key: 'test-key' }, stopRequested: { value: false },
      TASK_TOAST_SUFFIX: '', showToast() {}, console: { log() {}, error() {} },
      request: async config => { requests.push(config); return { data: { sta: 0, data: { title: 'work' } } }; },
    };
    const fetch = new Function(...Object.keys(bindings), `return (${source.slice(callback.start, callback.end)});`)(...Object.values(bindings));
    const result = await fetch([{ url: 'https://example.com/work', rawValue: 'work link' }], {
      activeFieldConfigs: keys.map(key => ({ key })),
    });
    assert.equal(result.successCount, 1);
    assert.equal(result.failCount, 0);
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].data, {
      url: 'https://example.com/work', raw_value: 'work link',
      source: 'feishu_bitable_video_fetch', selected_field_keys: keys,
    });
    assert.equal(requests[0].headers.authorization, 'Bearer test-key');
  });
}
