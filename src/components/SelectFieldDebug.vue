<script setup>
import { bitable, FieldType } from "@lark-base-open/js-sdk";
import { ElNotification } from "element-plus";
import { ref, watch } from "vue";
import { showErrorMsg } from '@/composables/useSocialData';

const tableId = ref('');
const fieldId = ref('');
const optionId = ref('');
const optionName = ref('');
const tableOptions = ref([]);
const fieldOptions = ref([]);
const selectOptions = ref([]);
const loading = ref(false);
const resultList = ref([]);

const loadTableOptions = async () => {
  try {
    const tableList = await bitable.base.getTableList();
    const selection = await bitable.base.getSelection();
    tableOptions.value = await Promise.all(
      tableList.map(async (table) => ({
        id: table.id,
        name: await table.getName(),
      }))
    );
    tableId.value = selection.tableId || tableOptions.value[0]?.id || '';
  } catch (error) {
    console.error('获取表格列表失败:', error);
    showErrorMsg('获取表格列表失败，请稍后重试');
  }
};

const loadFieldOptions = async (nextTableId) => {
  fieldId.value = '';
  optionId.value = '';
  optionName.value = '';
  fieldOptions.value = [];
  selectOptions.value = [];

  if (!nextTableId) {
    return;
  }

  try {
    const table = await bitable.base.getTableById(nextTableId);
    const fieldList = await table.getFieldListByType(FieldType.MultiSelect);
    fieldOptions.value = await Promise.all(
      fieldList.map(async (field) => ({
        id: field.id,
        name: await field.getName(),
      }))
    );

    if (fieldOptions.value.length > 0) {
      fieldId.value = fieldOptions.value[0].id;
    }
  } catch (error) {
    console.error('获取多选字段失败:', error);
    showErrorMsg('获取多选字段失败，请稍后重试');
  }
};

const loadSelectOptions = async (nextFieldId) => {
  optionId.value = '';
  optionName.value = '';
  selectOptions.value = [];

  if (!tableId.value || !nextFieldId) {
    return;
  }

  try {
    const table = await bitable.base.getTableById(tableId.value);
    const field = await table.getFieldById(nextFieldId);
    const options = await field.getOptions();
    selectOptions.value = options.map(option => ({
      id: option.id,
      name: option.name,
      color: option.color,
    }));
    const firstOption = selectOptions.value[0];
    if (firstOption) {
      optionId.value = firstOption.id;
      optionName.value = firstOption.name;
    } else {
      ElNotification({
        title: '提示',
        message: '当前多选字段还没有任何选项，请先在表格中为该字段添加选项',
        type: 'warning',
      });
    }
  } catch (error) {
    console.error('获取字段选项失败:', error);
    showErrorMsg('获取字段选项失败，请稍后重试');
  }
};

const createPrimaryCell = async (table, label) => {
  const fieldMetaList = await table.getFieldMetaList();
  const primaryFieldMeta = fieldMetaList.find(meta => meta.isPrimary);

  if (!primaryFieldMeta) {
    throw new Error('未找到主字段');
  }

  const primaryField = await table.getFieldById(primaryFieldMeta.id);
  return primaryField.createCell(label);
};

const runSingleTest = async ({ label, value }) => {
  const table = await bitable.base.getTableById(tableId.value);
  const field = await table.getFieldById(fieldId.value);
  const titleCell = await createPrimaryCell(table, `多选调试-${label}-${Date.now()}`);
  const testCell = await field.createCell(value);
  const recordId = await table.addRecordByCell([titleCell, testCell]);

  return recordId;
};

const runTests = async () => {
  if (!tableId.value) {
    showErrorMsg('请选择数据表');
    return;
  }
  if (!fieldId.value) {
    showErrorMsg('请选择多选字段');
    return;
  }
  if (!optionId.value || !optionName.value) {
    showErrorMsg('请选择一个字段选项');
    return;
  }

  loading.value = true;
  resultList.value = [];

  const cases = [
    { label: 'string', value: optionName.value },
    { label: '[id]', value: [optionId.value] },
    { label: '[{id,text}]', value: [{ id: optionId.value, text: optionName.value }] },
  ];

  for (const testCase of cases) {
    try {
      const recordId = await runSingleTest(testCase);
      resultList.value.push({
        label: testCase.label,
        success: true,
        message: `成功，recordId=${recordId}`,
      });
    } catch (error) {
      console.error(`多选 createCell 调试失败: ${testCase.label}`, error);
      resultList.value.push({
        label: testCase.label,
        success: false,
        message: error?.message || String(error),
      });
    }
  }

  loading.value = false;
  ElNotification({
    title: '调试完成',
    message: '已写入调试结果，请查看页面下方结果列表和表格记录',
    type: 'success',
  });
};

watch(tableId, loadFieldOptions);
watch(fieldId, loadSelectOptions);

loadTableOptions();
</script>

<template>
  <div class="sub-page">
    <div class="sub-page-header">
      <span class="sub-page-back" @click="$emit('back')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16">
          <polyline points="15 18 9 12 15 6"></polyline>
        </svg>
      </span>
      <span class="sub-page-title">多选字段调试</span>
    </div>
    <div class="form-card">
      <el-form class="form" label-position="top">
        <el-form-item>
          <div class="c-label">选择数据表</div>
          <el-select v-model="tableId" placeholder="请选择数据表" style="width: 100%">
            <el-option v-for="item in tableOptions" :key="item.id" :label="item.name" :value="item.id" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <div class="c-label">选择多选字段</div>
          <el-select v-model="fieldId" placeholder="请选择多选字段" style="width: 100%">
            <el-option v-for="item in fieldOptions" :key="item.id" :label="item.name" :value="item.id" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <div class="c-label">选择测试选项</div>
          <el-select
            v-model="optionId"
            placeholder="请选择字段选项"
            style="width: 100%"
            @change="(value) => optionName = selectOptions.find(item => item.id === value)?.name || ''"
          >
            <el-option v-for="item in selectOptions" :key="item.id" :label="`${item.name} (${item.id})`" :value="item.id" />
          </el-select>
        </el-form-item>
      </el-form>

      <el-button color="#a8071a" class="commit-btn" :loading="loading" @click="runTests">
        验证三种 createCell 格式
      </el-button>

      <div v-if="resultList.length" class="result-card">
        <div class="result-title">调试结果</div>
        <div
          v-for="item in resultList"
          :key="item.label"
          class="result-item"
          :class="{ 'result-item--error': !item.success }"
        >
          <div class="result-label">{{ item.label }}</div>
          <div class="result-message">{{ item.message }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sub-page {
  min-height: 100vh;
  background: #fffcfc;
}
.sub-page-header {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  background: #FFFFFF;
  border-bottom: 1px solid #E5E6EB;
  position: sticky;
  top: 0;
  z-index: 100;
}
.sub-page-back {
  width: 20px;
  height: 20px;
  cursor: pointer;
  color: #4E5969;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 12px;
}
.sub-page-back svg {
  width: 100%;
  height: 100%;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.sub-page-title {
  font-size: 16px;
  font-weight: 600;
  color: #1D2129;
}
.form-card {
  padding: 16px;
}
.c-label {
  font-size: 14px;
  font-weight: 500;
  color: #1D2129;
  margin-bottom: 8px;
}
.commit-btn {
  width: 100%;
  margin-top: 8px;
}
.result-card {
  margin-top: 16px;
  padding: 16px;
  background: #FFFFFF;
  border: 1px solid #E5E6EB;
  border-radius: 8px;
}
.result-title {
  font-size: 14px;
  font-weight: 600;
  color: #1D2129;
  margin-bottom: 12px;
}
.result-item + .result-item {
  margin-top: 12px;
}
.result-item {
  padding: 12px;
  background: #F2FBEF;
  border-radius: 6px;
}
.result-item--error {
  background: #FFF2F0;
}
.result-label {
  font-size: 13px;
  font-weight: 600;
  color: #1D2129;
}
.result-message {
  margin-top: 4px;
  font-size: 12px;
  color: #4E5969;
  word-break: break-all;
}
</style>
