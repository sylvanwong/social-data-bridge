import axios from 'axios'
import { PLUGIN_VERSION } from '@/utils/version'

const env = import.meta.env;
const baseURL = env.VITE_API_BASE_URL == '/' ? '' : env.VITE_API_BASE_URL;
// 创建 axios 实例
const service = axios.create({
  baseURL: baseURL, // 自动获取当前环境的 API 基址
  timeout: 10000,
})

service.interceptors.request.use((config) => {
  const method = (config.method || 'get').toLowerCase();

  if (method === 'get') {
    config.params = config.params || {};
    if (config.params.version === undefined) {
      config.params.version = PLUGIN_VERSION;
    }
    return config;
  }

  config.data = config.data || {};
  if (config.data.version === undefined) {
    config.data.version = PLUGIN_VERSION;
  }
  return config;
})

export default service
