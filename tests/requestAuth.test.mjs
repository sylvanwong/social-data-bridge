import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRequestService, rejectHttp } from './helpers/requestService.mjs';

for (const status of [401, 403]) {
  test(`API HTTP ${status}统一为鉴权错误，保留后端原因及响应`, async () => {
    const request = loadRequestService();
    request.defaults.adapter = config => rejectHttp(config, status);
    await assert.rejects(request({ url: '/social/api/example', method: 'post' }), error => {
      assert.equal(error.code, 'INVALID_API_KEY');
      assert.equal(error.message, '测试 API Key 已失效');
      assert.equal(error.response.status, status);
      assert.equal(error.config.data.includes('test-version'), true);
      return true;
    });
  });
}

test('业务4001仍转换鉴权错误，不改变原响应', async () => {
  const request = loadRequestService();
  request.defaults.adapter = async config => ({ status: 200, data: { sta: 4001, msg: '原始密钥原因' }, config });
  await assert.rejects(request.get('/social/api/example'), error => error.code === 'INVALID_API_KEY' && error.message === '原始密钥原因' && error.response.status === 200);
});

for (const status of [500, null]) {
  test(`普通${status || '网络'}错误保持原语义，不伪装成密钥问题`, async () => {
    const request = loadRequestService();
    const original = Object.assign(new Error('普通请求失败'), { code: 'NETWORK_ERROR', ...(status ? { response: { status } } : {}) });
    request.defaults.adapter = () => Promise.reject(original);
    await assert.rejects(request.get('/social/api/example'), error => error === original && error.code === 'NETWORK_ERROR');
  });
}
