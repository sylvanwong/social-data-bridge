import axios from 'axios'

const env = import.meta.env;
const baseURL = env.VITE_API_BASE_URL == '/' ? '' : env.VITE_API_BASE_URL;
// 创建 axios 实例
const service = axios.create({
  baseURL: baseURL, // 自动获取当前环境的 API 基址
  timeout: 10000,
})

export default service