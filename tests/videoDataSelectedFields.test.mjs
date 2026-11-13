import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from '@vue/compiler-sfc';
import { parse as parseJS } from '@babel/parser';
import axios from 'axios';
import { loadRequestService } from './helpers/requestService.mjs';

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

for (const [elapsed, success] of [[51000, true], [60000, false], [61000, false]]) {
  test(`detail request respects its budget at ${elapsed}ms without another request`, async () => {
    const request = loadRequestService();
    let requests = 0;
    const saved = [];
    request.defaults.adapter = async config => {
      requests++;
      // Exercise the shared 60s request budget without real HTTP or waiting.
      if (config.timeout <= elapsed) {
        throw new axios.AxiosError('timeout', 'ECONNABORTED', config);
      }
      return { status: 200, statusText: 'OK', headers: {}, config,
        data: { sta: 0, data: { social_type: 'dewu', social_id: '539977960' } } };
    };
    const bindings = {
      props: { api_key: 'test-key' }, stopRequested: { value: false },
      TASK_TOAST_SUFFIX: '', showToast() {}, console: { log() {}, error() {} }, request,
      taskFeedback: { recordFailure() {} },
    };
    const fetch = new Function(...Object.keys(bindings), `return (${source.slice(callback.start, callback.end)});`)(...Object.values(bindings));
    const result = await fetch([{ url: 'https://dw4.co/t/A/HnEZ6b2eX' }], {
      onSuccess: async item => saved.push(item),
    });
    assert.equal(result.successCount, success ? 1 : 0);
    assert.equal(result.failCount, success ? 0 : 1);
    assert.equal(requests, 1);
    assert.equal(saved.length, success ? 1 : 0);
    if (success) assert.equal(saved[0].social_id, '539977960');
  });
}
