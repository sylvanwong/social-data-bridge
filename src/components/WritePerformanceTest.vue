<script setup>
import { bitable, FieldType } from '@lark-base-open/js-sdk';
import { ElNotification } from 'element-plus';
import { ref } from 'vue';

const emit = defineEmits(['back']);

const RECORD_COUNT = 2000;
const SINGLE_WRITE_CONCURRENCY = 10;
const loading = ref(false);
const status = ref('');
const result = ref(null);

const elapsed = (startTime) => performance.now() - startTime;
const formatDuration = (duration) => `${(duration / 1000).toFixed(2)} 秒`;
const chunk = (list, size) => {
  const chunks = [];
  for (let index = 0; index < list.length; index += size) {
    chunks.push(list.slice(index, index + size));
  }
  return chunks;
};

const addRecordsInChunks = async (table, records) => {
  const responses = [];
  for (const recordsChunk of chunk(records, 200)) {
    responses.push(...await table.addRecords(recordsChunk));
  }
  return responses;
};

const createTestTable = async (name) => {
  const tableMeta = await bitable.base.addTable({ name });
  const tableId = tableMeta.tableId || tableMeta.id;
  if (!tableId) {
    throw new Error('创建测试表失败');
  }

  const table = await bitable.base.getTableById(tableId);
  const fields = await table.getFieldMetaList();
  const firstField = fields[0];
  if (!firstField) {
    throw new Error('测试表缺少默认字段');
  }

  await table.setField(firstField.id, {
    type: FieldType.Text,
    name: '测试值',
  });

  return { table, fieldId: firstField.id, tableId };
};

const createCells = async (table, fieldId, prefix) => {
  const field = await table.getFieldById(fieldId);
  return Promise.all(
    Array.from({ length: RECORD_COUNT }, (_, index) => field.createCell(`${prefix}-${index + 1}`))
  );
};

const runTest = async () => {
  loading.value = true;
  result.value = null;

  const suffix = Date.now();
  const nextResult = {
    recordCount: RECORD_COUNT,
    singleTableName: `写入性能测试-逐条-${suffix}`,
    batchTableName: `写入性能测试-批量-${suffix}`,
    singleDuration: null,
    batchDuration: null,
  };

  try {
    status.value = `创建逐条写入测试表，并预置 ${RECORD_COUNT} 个空行...`;
    const single = await createTestTable(nextResult.singleTableName);
    const emptyCells = await createCells(single.table, single.fieldId, '预置');
    const recordIds = await addRecordsInChunks(single.table, emptyCells.map(cell => [cell]));
    if (recordIds.length !== RECORD_COUNT) {
      throw new Error(`预置记录数量异常：期望 ${RECORD_COUNT}，实际 ${recordIds.length}`);
    }

    const singleField = await single.table.getFieldById(single.fieldId);
    status.value = `正在逐条并发写入 1/${RECORD_COUNT}...`;
    const singleStartTime = performance.now();
    for (const [batchIndex, recordIdChunk] of chunk(recordIds, SINGLE_WRITE_CONCURRENCY).entries()) {
      const startIndex = batchIndex * SINGLE_WRITE_CONCURRENCY;
      await Promise.all(
        recordIdChunk.map((recordId, index) => singleField.setValue(recordId, `逐条写入-${startIndex + index + 1}`))
      );
      const completedCount = Math.min(startIndex + SINGLE_WRITE_CONCURRENCY, RECORD_COUNT);
      if (completedCount % 50 === 0 || completedCount === RECORD_COUNT) {
        status.value = `正在逐条并发写入 ${completedCount}/${RECORD_COUNT}...`;
      }
    }
    nextResult.singleDuration = elapsed(singleStartTime);

    status.value = `创建批量写入测试表，准备 ${RECORD_COUNT} 条记录...`;
    const batch = await createTestTable(nextResult.batchTableName);
    const batchCells = await createCells(batch.table, batch.fieldId, '批量写入');
    status.value = `正在一次批量写入 ${RECORD_COUNT} 条...`;
    const batchStartTime = performance.now();
    await addRecordsInChunks(batch.table, batchCells.map(cell => [cell]));
    nextResult.batchDuration = elapsed(batchStartTime);

    result.value = nextResult;
    status.value = '测试完成';
    ElNotification({ message: '写入性能测试完成', type: 'success' });
  } catch (error) {
    console.error('写入性能测试失败:', error);
    result.value = nextResult;
    status.value = `测试失败：${error?.message || '未知错误'}`;
    ElNotification({ message: status.value, type: 'error', duration: 0 });
  } finally {
    loading.value = false;
  }
};
</script>

<template>
  <div class="sub-page">
    <div class="sub-page-header">
      <button class="back-button" type="button" aria-label="返回" @click="emit('back')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>
      <span class="sub-page-title">写入性能测试</span>
    </div>

    <div class="form-card">
      <div class="test-summary">
        <div class="test-count">{{ RECORD_COUNT.toLocaleString() }} 条</div>
        <div class="test-description">仅写入一个文本字段，测试每批 10 条的逐条并发写入与 SDK 每批 200 条的批量写入。</div>
      </div>

      <el-alert
        title="每次测试会在当前 Base 新建两张测试表，不会修改现有业务表。"
        type="warning"
        :closable="false"
        show-icon
      />

      <el-button class="run-button" type="primary" :loading="loading" @click="runTest">
        开始测试
      </el-button>

      <div v-if="status" class="status-text">{{ status }}</div>

      <div v-if="result" class="result-panel">
        <div class="result-row">
          <span>逐条并发写入（每批 10 条）</span>
          <strong>{{ result.singleDuration === null ? '未完成' : formatDuration(result.singleDuration) }}</strong>
        </div>
        <div class="result-row">
          <span>批量写入（每批 200 条）</span>
          <strong>{{ result.batchDuration === null ? '未完成' : formatDuration(result.batchDuration) }}</strong>
        </div>
        <div v-if="result.singleDuration !== null && result.batchDuration !== null" class="result-highlight">
          逐条并发写入耗时约为批量写入的 {{ (result.singleDuration / result.batchDuration).toFixed(1) }} 倍
        </div>
        <div class="table-names">测试表：{{ result.singleTableName }}、{{ result.batchTableName }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sub-page { min-height: 100vh; background: #fffcfc; }
.sub-page-header { display: flex; align-items: center; padding: 12px 16px; background: #fff; border-bottom: 1px solid #e5e6eb; }
.back-button { display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; padding: 0; margin-right: 8px; color: #4e5969; background: transparent; border: 0; cursor: pointer; }
.back-button:hover { color: #a8071a; }
.back-button svg { stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.sub-page-title { font-size: 16px; font-weight: 600; color: #1d2129; }
.form-card { margin: 16px; padding: 16px; background: #fff; border: 1px solid #e5e6eb; border-radius: 8px; }
.test-summary { margin-bottom: 16px; }
.test-count { font-size: 24px; font-weight: 600; color: #1d2129; line-height: 32px; }
.test-description { margin-top: 4px; font-size: 13px; line-height: 20px; color: #86909c; }
.run-button { width: 100%; margin-top: 16px; }
.status-text { margin-top: 12px; font-size: 13px; line-height: 20px; color: #4e5969; word-break: break-all; }
.result-panel { margin-top: 16px; padding: 14px; background: #f7f8fa; border: 1px solid #e5e6eb; border-radius: 8px; }
.result-row { display: flex; justify-content: space-between; gap: 16px; padding: 8px 0; color: #4e5969; font-size: 14px; }
.result-row strong { color: #1d2129; white-space: nowrap; }
.result-highlight { padding: 10px 0; color: #00a870; font-size: 14px; font-weight: 600; border-top: 1px solid #e5e6eb; }
.table-names { margin-top: 4px; font-size: 12px; line-height: 18px; color: #86909c; word-break: break-all; }
</style>
