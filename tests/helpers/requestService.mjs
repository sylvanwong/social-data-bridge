import fs from 'node:fs';
import axios from 'axios';

// 执行真实请求层和 Axios 拦截器，只替换构建环境和外部 HTTP 适配器。
export function loadRequestService() {
  const source = fs.readFileSync(new URL('../../src/utils/request.js', import.meta.url), 'utf8')
    .replace(/^import .*\n/gm, '')
    .replace('const env = import.meta.env;', 'const env = { VITE_API_BASE_URL: "" };')
    .replaceAll('export const ', 'const ')
    .replace('export default service', 'return service');
  return new Function('axios', 'PLUGIN_VERSION', source)(axios, 'test-version');
}

export function rejectHttp(config, status, message = '测试 API Key 已失效') {
  return Promise.reject(new axios.AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_REQUEST', config,
    undefined, { status, data: { msg: message }, config }));
}
