<script setup>
import * as Sentry from '@sentry/vue'
import { ElMessage } from 'element-plus'
import { ref } from 'vue'

const emit = defineEmits(['back'])
const sending = ref(false)
const lastSentAt = ref('')

const sendTestEvent = async () => {
  sending.value = true

  try {
    const error = new Error('Sentry connectivity test')
    Sentry.captureException(error, {
      tags: {
        source: 'sentry-test-page',
        test: 'true',
      },
    })
    await Sentry.flush(2000)
    lastSentAt.value = new Date().toLocaleString('zh-CN', { hour12: false })
    ElMessage.success('测试异常已发送，请在 Sentry Issues 中查看')
  } catch (error) {
    console.error('Sentry 测试事件发送失败:', error)
    ElMessage.error('测试事件发送失败，请检查网络和 Sentry 配置')
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <div class="sentry-test-page">
    <div class="sentry-test-header">
      <button class="back-button" type="button" aria-label="返回" @click="emit('back')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <polyline points="15 18 9 12 15 6"></polyline>
        </svg>
      </button>
      <span>Sentry 测试</span>
    </div>

    <section class="test-content">
      <h1>异常上报验证</h1>
      <p>点击后会向 Sentry 发送一条标记为 <code>test: true</code> 的测试异常，不影响当前功能。</p>
      <el-button type="primary" :loading="sending" @click="sendTestEvent">
        发送测试异常
      </el-button>
      <p v-if="lastSentAt" class="sent-time">最近发送：{{ lastSentAt }}</p>
    </section>
  </div>
</template>

<style scoped>
.sentry-test-page {
  min-height: 100vh;
  background: #fffcfc;
}

.sentry-test-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  color: #1d2129;
  font-size: 16px;
  font-weight: 600;
  background: #fff;
  border-bottom: 1px solid #e5e6eb;
}

.back-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  color: #4e5969;
  cursor: pointer;
  background: transparent;
  border: 0;
}

.back-button:hover {
  color: #a8071a;
}

.back-button svg {
  width: 16px;
  height: 16px;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2;
}

.test-content {
  margin: 16px;
  padding: 16px;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 8px;
}

h1 {
  margin: 0;
  color: #1d2129;
  font-size: 16px;
  font-weight: 600;
  line-height: 24px;
}

p {
  margin: 8px 0 16px;
  color: #4e5969;
  font-size: 13px;
  line-height: 20px;
}

code {
  padding: 1px 4px;
  color: #a8071a;
  background: #fff0f2;
  border-radius: 3px;
}

.sent-time {
  margin: 12px 0 0;
  color: #86909c;
  font-size: 12px;
}
</style>
