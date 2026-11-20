import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRequestModule } from './helpers/requestService.mjs';

test('商品搜索与配置统一使用飞书服务地址并携带插件版本', async () => {
  const api = loadRequestModule({ VITE_FEISHU_API_BASE_URL: 'https://feishu.test' });
  const requests = [];
  api.service.defaults.adapter = async config => { requests.push(config); return { status: 200, statusText: 'OK', headers: {}, config, data: {} }; };
  await api.feishuRequest({ url: '/socialdatax/api/v1/feishu/product/search/task', method: 'post', data: { social_type: 'xhs', keyword: '商品', pages: 1, filter_config: {} } });
  assert.equal(requests[0].baseURL, 'https://feishu.test');
  assert.deepEqual(JSON.parse(requests[0].data), { social_type: 'xhs', keyword: '商品', pages: 1, filter_config: {}, version: 'test-version' });
  await api.feishuRequest({ url: '/socialdatax/api/v1/feishu/profile-fetch/table-output-configs', method: 'get' });
  assert.equal(requests[1].baseURL, 'https://feishu.test');
  assert.equal(requests[1].params.version, 'test-version');
});
