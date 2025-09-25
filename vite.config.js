import { fileURLToPath, URL } from 'node:url'

import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'

// 加载环境变量，process.cwd() 表示项目根目录
// const env = loadEnv(mode, process.cwd());

// https://vitejs.dev/config/
export default defineConfig({
  server: { // 开发服务器配置（仅开发环境生效）
    host: true,
    proxy: {
      '/social/api': {
        target: 'https://test-lotto.weiyoubot.cn',
        // target: 'https://api.52choujiang.cn',
        changeOrigin: true,
        rewrite: (path) => path
      }
    }
  },
  base: './',
  plugins: [
    vue(),
    AutoImport({
      resolvers: [ElementPlusResolver()],
    }),
    Components({
      resolvers: [ElementPlusResolver()],
    }),],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  }
})
