const count = value => value !== '' && value != null && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : undefined;
export const taskResultErrorText = error => String(error?.response?.data?.msg || error?.msg || error?.message || error || '未返回具体原因');
const kinds = {
  keyword: ['页', '作品'], bloggerSearch: ['页', '作者'], productSearch: ['页', '商品'],
  comment: ['个作品', '评论'], series: ['位作者', '短剧'], productReview: ['个商品', '商品评价'],
};
export const taskResultFailedItems = items => (Array.isArray(items) ? items : [])
  .filter(item => item && (item.url || item.input || item.profile_url || item.link || item.keyword))
  .map(item => ({ url: String(item.url || item.input || item.profile_url || item.link || item.keyword), reason: taskResultErrorText(item.reason || item.error) }));

// 各接口只归一化展示字段，不修改任务、游标或写入快照。
export function buildTaskExecutionResult(source = {}, task = {}, { kind = 'keyword' } = {}) {
  source ||= {};
  task ||= {};
  const [unit, outputUnit] = kinds[kind] || kinds.keyword;
  const requestFailures = ['bloggerSearch', 'productSearch'].includes(kind);
  const succeeded = count(source.succeeded ?? source.succeeded_urls ?? source.succeeded_pages);
  const failed = count(requestFailures ? source.failed_request_count ?? source.failed : source.failed ?? source.failed_urls ?? source.failed_pages);
  const processed = count(source.processed ?? source.processed_urls ?? source.processed_pages);
  const total = count(source.total ?? source.total_urls ?? source.total_pages);
  const stats = [];
  if (succeeded !== undefined) stats.push({ label: '成功', value: succeeded, unit });
  if (failed !== undefined) stats.push({ label: requestFailures ? '失败请求' : '失败', value: failed, unit: requestFailures ? '次' : unit, ...(failed ? { tone: 'warning' } : {}) });
  if (succeeded === undefined && processed !== undefined) stats.push({ label: '已处理', value: processed, unit });
  // 搜索 total 是页数上限；提前耗尽结果也会正常完成，不能推算未完成页数。
  const pageLimit = ['keyword', 'bloggerSearch', 'productSearch'].includes(kind);
  const unfinished = !pageLimit && total !== undefined && processed !== undefined ? Math.max(0, total - processed) : undefined;
  if (unfinished) stats.push({ label: '未完成', value: unfinished, unit });
  const code = Number(source.status);
  const state = code === 3 ? 'stopped' : code === 2 ? 'interrupted'
    : failed > 0 ? (succeeded > 0 || count(task.writtenCount) > 0 ? 'partial' : 'failed')
      : unfinished > 0 || source.scope_warning ? 'incomplete'
        : succeeded > 0 && failed === 0 && count(task.writtenCount) > 0 ? 'success' : 'completed';
  const now = Date.now();
  // start/end 在部分接口是分页参数；仅使用本地明确记录的毫秒时间。
  const started = task.executionStartedAt;
  return {
    status: state, stats, outputUnit, writtenCount: count(task.writtenCount), failed,
    reason: source.reason || source.message || '',
    notes: [...(source.scope_warning ? [source.scope_warning] : []), ...(kind === 'comment' && count(source.sort_fallback_count) > 0 ? [`其中 ${source.sort_fallback_count} 个作品使用了默认排序`] : [])],
    failedItems: taskResultFailedItems(source.failed_items ?? source.failedItems),
    executionDurationSeconds: count(source.duration_seconds) ?? (Number.isFinite(started) && started > 0 && now >= started ? Math.floor((now - started) / 1000) : null),
    finishedAt: new Date(now).toISOString(),
  };
}

export const taskExecutionResultLabel = result => ({
  success: '全部成功', completed: '已完成', partial: '部分失败', incomplete: '部分完成',
  stopped: '已停止', failed: '执行失败', interrupted: '任务中断', paused: '已暂停',
}[result?.status] || '任务结果');
export const taskExecutionResultTone = result => {
  if (result?.status === 'success') return 'success';
  if (['failed', 'interrupted'].includes(result?.status)) return 'error';
  if (['partial', 'incomplete', 'paused'].includes(result?.status) || (result?.status === 'stopped' && result.failed > 0)) return 'warning';
  return 'neutral';
};
export const formatTaskResultDuration = seconds => {
  const value = Math.max(0, Math.floor(seconds));
  const h = Math.floor(value / 3600), m = Math.floor(value % 3600 / 60), s = value % 60;
  return [h ? `${h} 小时` : '', m ? `${m} 分` : '', s || (!h && !m) ? `${s} 秒` : ''].filter(Boolean).join(' ');
};
export const formatTaskResultTime = value => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN', { hour12: false, year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};
