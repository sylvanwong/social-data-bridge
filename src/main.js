import { createApp } from 'vue'
import * as Sentry from '@sentry/vue'
import App from './App.vue'
import 'element-plus/dist/index.css'
import './assets/main.css'
// import {i18n} from './locales/i18n.js'
// createApp(App).use(i18n).mount('#app') // 注入国际化函数$t

const app = createApp(App)

Sentry.init({
  app,
  dsn: 'https://f7e2f6d9407d4c0cb4c3e9bbb04c9206@sentry.weiyoubot.cn/12',
  integrations: [Sentry.browserTracingIntegration()],
  tracesSampleRate: 1.0,
})

app.mount('#app')
