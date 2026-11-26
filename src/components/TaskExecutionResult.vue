<script setup>
import { computed, nextTick, onUnmounted, ref, watch } from 'vue';
import { formatTaskResultDuration, formatTaskResultTime, taskExecutionResultLabel, taskExecutionResultTone } from '../utils/taskExecutionResult.mjs';

const props = defineProps({ result: { type: Object, default: null } });
const expanded = ref(true), failuresOpen = ref(true), copying = ref(false), manualCopy = ref(''), copied = ref(false);
const copyInput = ref(null);
const failedItems = computed(() => props.result?.failedItems || []);
const failureLabel = computed(() => failedItems.value.some(item => item.writeUncertain) ? '需核对或失败输入' : '失败输入');
let disposed = false;
onUnmounted(() => { disposed = true; });
watch(() => props.result, () => { expanded.value = true; failuresOpen.value = true; manualCopy.value = ''; copied.value = false; }, { flush: 'sync' });
const copyFailures = async () => {
  const result = props.result;
  if (copying.value || !failedItems.value.length) return;
  const inputs = failedItems.value.map(item => item.url).join('\n');
  copying.value = true;
  try {
    await navigator.clipboard.writeText(inputs);
    if (!disposed && props.result === result) copied.value = true;
  } catch {
    if (disposed || props.result !== result) return;
    manualCopy.value = inputs;
    await nextTick();
    if (!disposed && props.result === result && expanded.value) {
      copyInput.value?.focus?.({ preventScroll: true });
      copyInput.value?.select?.();
    }
  } finally { copying.value = false; }
};
</script>

<template>
  <section v-if="result" class="task-execution-result" aria-label="本次执行结果">
    <button type="button" class="result-header" :aria-expanded="expanded" @click="expanded = !expanded">
      <span class="result-heading">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 3h6"></path><rect x="4" y="5" width="16" height="16" rx="2"></rect><path d="m8 13 2 2 5-5"></path></svg>
        <span>本次执行结果</span>
        <span class="result-status" :class="`is-${taskExecutionResultTone(result)}`">{{ taskExecutionResultLabel(result) }}</span>
      </span>
      <svg class="result-arrow" :class="{ expanded }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="6 9 12 15 18 9"></polyline></svg>
    </button>
    <div v-show="expanded" class="result-body">
      <div aria-live="polite">
        <p v-if="result.stats?.length" class="result-count"><span v-for="(stat, index) in result.stats" :key="index" class="result-stat"><span v-if="index"> · </span><span :class="{ 'is-warning': stat.tone === 'warning' }">{{ stat.label }} {{ stat.value }} {{ stat.unit }}</span></span></p>
        <p v-if="result.writtenCount != null" class="result-written">已写入 {{ result.writtenCount }} 条{{ result.outputUnit || '数据' }}</p>
      </div>
      <p v-if="result.reason" class="result-note" :class="`is-${taskExecutionResultTone(result)}`">{{ result.reason }}</p>
      <p v-for="(note, index) in result.notes || []" :key="index" class="result-note">{{ note }}</p>
      <details v-if="failedItems.length" :open="failuresOpen" class="result-failures" @toggle="failuresOpen = $event.target.open">
        <summary>查看{{ failureLabel }}（{{ failedItems.length }}）</summary>
        <ul><li v-for="(item, index) in failedItems.slice(0, 5)" :key="index"><span>{{ item.url }}</span><span class="result-note">{{ item.reason }}</span></li></ul>
        <p v-if="failedItems.length > 5" class="result-note">已返回 {{ failedItems.length }} 条失败明细，展示前 5 条</p>
        <p v-else-if="result.failed > failedItems.length" class="result-note">已返回 {{ failedItems.length }} 条失败明细</p>
      </details>
      <p v-else-if="result.failed > 0" class="result-note">本次任务未返回失败输入明细。</p>
      <div v-if="failedItems.length || $slots.actions" class="result-actions">
        <slot name="actions" />
        <button v-if="failedItems.length" type="button" class="result-copy" :disabled="copying" @click="copyFailures">复制{{ failureLabel }}</button>
        <span v-if="copied" class="result-note" role="status">已复制 {{ failedItems.length }} 条{{ failureLabel }}</span>
      </div>
      <label v-if="manualCopy" class="result-note result-copy-fallback">请手动复制{{ failureLabel }}<textarea ref="copyInput" readonly :value="manualCopy" @focus="$event.target.select()" /></label>
      <div v-if="result.finishedAt" class="result-timing result-note"><span v-if="result.executionDurationSeconds != null">执行耗时 {{ formatTaskResultDuration(result.executionDurationSeconds) }}</span><span>{{ result.status === 'paused' ? '暂停于' : '结束于' }} {{ formatTaskResultTime(result.finishedAt) }}</span></div>
    </div>
  </section>
</template>

<style scoped>
.task-execution-result { box-sizing: border-box; min-width: 0; margin: 16px 16px; border: 1px solid #E5E6EB; border-radius: 8px; background: #fff; overflow: hidden; font-family: var(--app-font-family); color: #1d2129; }
.result-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; box-sizing: border-box; padding: 16px; border: 0; background: #fff; color: inherit; text-align: left; cursor: pointer; font-family: inherit; }
.result-header:focus-visible { outline: 2px solid #86909c; outline-offset: -2px; }
.result-heading { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; font-size: var(--app-font-size-body, 14px); font-weight: 500; line-height: 20px; }
svg { width: 16px; height: 16px; flex-shrink: 0; }
.result-status { color: #646a73; font-size: 12px; font-weight: 400; }
.result-arrow { color: #86909c; transition: transform .2s; }
.result-arrow.expanded { transform: rotate(180deg); }
.result-body { padding: 16px; border-top: 1px solid #E5E6EB; }
.result-count { margin: 0; font-size: var(--app-font-size-body, 14px); line-height: 20px; }
.result-stat { display: inline-block; white-space: pre-wrap; }
.result-written { margin: 4px 0 0; font-size: 14px; line-height: 20px; }
.result-note { display: block; margin: 8px 0 0; color: #646a73; font-size: 12px; font-weight: 400; line-height: 18px; overflow-wrap: anywhere; }
.is-success { color: #087a32; }
.is-warning { color: #A64B00; }
.is-error { color: #B42327; }
.result-count .is-warning { font-weight: 600; }
.result-failures { margin-top: 8px; font-size: 14px; line-height: 20px; overflow-wrap: anywhere; }
.result-failures summary { cursor: pointer; }
.result-failures ul { list-style: none; margin: 8px 0 0; padding: 0; }
.result-failures li + li { margin-top: 8px; }
.result-failures li .result-note { margin-top: 0; }
.result-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.result-actions .result-note { margin: 0; }
.result-copy { padding: 0; border: 0; background: none; color: #a8071a; font: inherit; font-size: 13px; line-height: 22px; cursor: pointer; }
.result-copy:disabled { color: #86909c; cursor: not-allowed; }
.result-copy-fallback textarea { display: block; box-sizing: border-box; width: 100%; min-height: 72px; margin-top: 4px; padding: 8px 12px; border: 1px solid #e5e6eb; border-radius: 6px; font: inherit; resize: vertical; }
.result-timing { display: flex; flex-direction: column; gap: 4px; }
@media (prefers-reduced-motion: reduce) { .result-arrow { transition: none; } }
</style>
