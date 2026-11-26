import { ref } from 'vue';
import { taskResultErrorText } from '../utils/taskExecutionResult.mjs';

// 展示本次执行的已确认事实；不拥有任务重试或写入恢复状态。
export function useTaskExecutionResult({ inputUnit = '条', outputUnit = '数据' } = {}) {
  const result = ref(null);
  let startedAt, total, succeeded, failed, uncertain, writtenCount, failedItems;
  const begin = inputTotal => {
    result.value = null; startedAt = Date.now();
    total = Number.isFinite(inputTotal) && inputTotal >= 0 ? inputTotal : undefined;
    succeeded = 0; failed = 0; uncertain = 0; writtenCount = 0; failedItems = [];
  };
  const success = () => { succeeded += 1; };
  const setTotal = value => { total = Number.isFinite(value) && value >= 0 ? value : undefined; };
  const written = value => { if (Number.isFinite(value) && value >= 0) writtenCount += value; };
  const failure = (input, error, { writeUncertain = false } = {}) => {
    if (writeUncertain) uncertain += 1; else failed += 1;
    if (input != null && String(input)) failedItems.push({ url: String(input), reason: taskResultErrorText(error), ...(writeUncertain ? { writeUncertain: true } : {}) });
  };
  const finish = (options = {}) => {
    const ok = options.succeeded ?? succeeded, bad = options.failed ?? failed;
    const all = options.total ?? total;
    const remaining = all == null ? undefined : Math.max(0, all - ok - bad - uncertain);
    const stats = [{ label: '成功', value: ok, unit: inputUnit }, { label: '失败', value: bad, unit: inputUnit, ...(bad ? { tone: 'warning' } : {}) }];
    if (uncertain) stats.push({ label: '写入待核对', value: uncertain, unit: inputUnit, tone: 'warning' });
    if (remaining) stats.push({ label: '未执行', value: remaining, unit: inputUnit });
    result.value = {
      status: options.status || (uncertain ? 'paused' : options.stopped ? 'stopped' : bad > 0 ? (ok > 0 ? 'partial' : 'failed') : remaining ? 'incomplete' : ok > 0 && (options.writtenCount ?? writtenCount) > 0 ? 'success' : 'completed'),
      stats, outputUnit, writtenCount: options.writtenCount ?? writtenCount, failed: bad,
      reason: options.reason || '', notes: [...(options.notes || []), ...(uncertain ? ['部分输入的写入结果尚未确认，请先核对目标表后再处理，避免重复写入。'] : [])], failedItems: [...failedItems],
      executionDurationSeconds: startedAt ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : null,
      finishedAt: new Date().toISOString(),
    };
    return result.value;
  };
  const fail = (error, { paused = false } = {}) => finish({ status: paused || uncertain ? 'paused' : 'interrupted', reason: taskResultErrorText(error), notes: error?.writeUncertain && !uncertain ? ['写入结果尚未确认，请先核对目标表，避免重复写入。'] : [] });
  begin();
  return { result, begin, setTotal, success, failure, written, finish, fail };
}
