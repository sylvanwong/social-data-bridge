import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRequestModule } from './helpers/requestService.mjs';

test('Feishu migrated routes use their configured environment base', async () => {
  const { service, feishuRequest, buildFeishuApiUrl, buildFeishuApiPath, FEISHU_API_PATH_PREFIX } = loadRequestModule({
    VITE_API_BASE_URL: 'https://legacy.example',
    VITE_FEISHU_API_BASE_URL: 'https://test-lotto.weiyoubot.cn/',
  });
  const bases = [];
  service.defaults.adapter = async config => {
    bases.push(config.baseURL);
    return { status: 200, data: {}, config };
  };

  await feishuRequest({ url: buildFeishuApiPath('/v1/feishu/social_info'), method: 'post' });

  assert.deepEqual(bases, ['https://test-lotto.weiyoubot.cn']);
  assert.equal(FEISHU_API_PATH_PREFIX, '/socialdatax/api');
  assert.equal(buildFeishuApiUrl(buildFeishuApiPath('/v1/feishu/xhs_download_proxy')),
    'https://test-lotto.weiyoubot.cn/socialdatax/api/v1/feishu/xhs_download_proxy');
});

test('unmigrated routes keep the legacy base and old tasks can override the Feishu base', async () => {
  const { service, feishuRequest, buildFeishuApiPath, LEGACY_FEISHU_API_PATH_PREFIX } = loadRequestModule({
    VITE_API_BASE_URL: 'https://legacy.example',
    VITE_FEISHU_API_BASE_URL: 'https://test-lotto.weiyoubot.cn',
  });
  const bases = [];
  service.defaults.adapter = async config => {
    bases.push(config.baseURL);
    return { status: 200, data: {}, config };
  };

  await service({ url: '/social/api/v1/feishu/other_route' });
  await feishuRequest({
    url: buildFeishuApiPath('/v1/feishu/series/list?task_id=old-task', LEGACY_FEISHU_API_PATH_PREFIX),
    baseURL: 'https://legacy.example',
  });

  assert.deepEqual(bases, ['https://legacy.example', 'https://legacy.example']);
});

test('Feishu base falls back to API base and supports same-origin development', () => {
  const fallback = loadRequestModule({ VITE_API_BASE_URL: 'https://legacy.example' });
  assert.equal(fallback.FEISHU_API_BASE_URL, 'https://legacy.example');
  const sameOrigin = loadRequestModule({ VITE_API_BASE_URL: 'https://legacy.example', VITE_FEISHU_API_BASE_URL: '/' });
  assert.equal(sameOrigin.FEISHU_API_BASE_URL, '');
  assert.equal(sameOrigin.buildFeishuApiUrl(sameOrigin.buildFeishuApiPath('/v1/feishu/social_info')),
    '/socialdatax/api/v1/feishu/social_info');
});
