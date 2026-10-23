<script setup>
import { ref, computed } from 'vue';
import { bitable } from '@lark-base-open/js-sdk';
import {
  INPUT_FILTER_TYPES, INPUT_FILTER_OPERATORS, operatorsForField, isEmptyOperator,
  cloneInputFilter, removeFilterRule, prepareInputFilter,
} from '@/utils/inputFilter.mjs';

const props = defineProps({ modelValue: { type: Object, default: null }, sourceTableId: { type: String, default: '' } });
const emit = defineEmits(['update:modelValue']);
const expanded = ref(false);
const fields = ref([]);
const tableId = ref('');
const loading = ref(false);
const error = ref('');
const invalid = ref(false);
const groups = computed(() => props.modelValue?.groups || []);
const count = computed(() => groups.value.reduce((sum, group) => sum + group.length, 0));
const fieldFor = rule => fields.value.find(field => field.id === rule.field_id);
const valueOptions = rule => fieldFor(rule)?.property?.options || [];
let loadSequence = 0;
let removalVersion = 0;

async function loadFields(sourceTable) {
  const sequence = ++loadSequence;
  loading.value = true;
  try {
    const sourceId = props.sourceTableId || props.modelValue?.table_id;
    const table = sourceTable || (sourceId ? await bitable.base.getTableById(sourceId) : await bitable.base.getActiveTable());
    const meta = await table.getFieldMetaList();
    if (sequence !== loadSequence) return;
    fields.value = meta.filter(field => INPUT_FILTER_TYPES.includes(field.type));
    tableId.value = table.id;
    error.value = '';
    refreshConditionTypes(table.id);
    return { table, meta };
  } catch (cause) {
    if (sequence === loadSequence) {
      fields.value = [];
      tableId.value = '';
      error.value = '无法读取筛选字段，请打开对应数据表后重试';
    }
    throw cause;
  } finally {
    if (sequence === loadSequence) loading.value = false;
  }
}

function refreshConditionTypes(sourceId) {
  if (!props.modelValue || props.modelValue.table_id !== sourceId) return;
  const next = cloneInputFilter(props.modelValue);
  let changed = false;
  for (const group of next.groups) {
    for (const rule of group) {
      const field = fieldFor(rule);
      if (!field || field.type === rule.field_type) continue;
      rule.field_type = field.type;
      rule.field_name = field.name;
      if (!operatorsForField(field.type).includes(rule.operator)) rule.operator = 'eq';
      rule.value = field.type === 7 || isEmptyOperator(rule.operator) ? null : '';
      changed = true;
    }
  }
  if (changed) {
    emit('update:modelValue', next);
    error.value = '字段类型已改变，请重新设置条件';
  }
}

async function toggle() {
  expanded.value = !expanded.value;
  if (expanded.value && !tableId.value && !loading.value) {
    try { await loadFields(); } catch (_) { /* Inline error is shown above the editor. */ }
  }
}

async function handleFieldDropdownVisibleChange(visible) {
  if (!visible) return;
  try { await loadFields(); } catch (_) { /* loadFields 已显示读取错误，保留条件供重试。 */ }
}

function update(mutator) {
  const next = cloneInputFilter(props.modelValue) || { version: 1, table_id: tableId.value, groups: [] };
  mutator(next);
  emit('update:modelValue', next.groups.length ? next : null);
  error.value = '';
  invalid.value = false;
}

const newRule = () => ({ field_id: '', field_name: '', field_type: 1, operator: 'eq', value: '' });
async function add(groupIndex) {
  if (loading.value || count.value >= 100) return;
  const version = removalVersion;
  if (!count.value || !tableId.value) {
    try {
      if (!(await loadFields())) return;
    } catch (_) {
      return; // loadFields 已显示读取错误，保留原条件供用户重试。
    }
  }
  // 等待读取期间删除或清空过条件，不再沿用原来的组位置。
  if (!tableId.value || version !== removalVersion) return;
  update(next => groupIndex == null ? next.groups.push([newRule()]) : next.groups[groupIndex].push(newRule()));
}
function setField(g, r, id) {
  const field = fields.value.find(item => item.id === id);
  if (!field) return;
  update(next => { next.groups[g][r] = { field_id: id, field_name: field.name, field_type: field.type, operator: 'eq', value: field.type === 7 ? true : '' }; });
}
function setRule(g, r, key, value) {
  update(next => {
    const rule = next.groups[g][r];
    rule[key] = value;
    if (key === 'operator') rule.value = isEmptyOperator(value) ? null : (rule.value ?? '');
  });
}
function remove(g, r) {
  removalVersion++;
  emit('update:modelValue', removeFilterRule(props.modelValue, g, r));
  error.value = '';
  invalid.value = false;
}
function clear() { removalVersion++; emit('update:modelValue', null); error.value = ''; invalid.value = false; }

async function validate(table, filter = props.modelValue) {
  if (!filter) return null;
  try {
    const result = await loadFields(table);
    if (!result) throw new Error('字段信息正在更新，请重试');
    const prepared = prepareInputFilter(filter, result.meta, result.table.id);
    invalid.value = false;
    return prepared;
  } catch (cause) {
    expanded.value = true;
    invalid.value = true;
    error.value = error.value || cause.message;
    throw cause;
  }
}
defineExpose({ validate });
</script>

<template>
  <div class="input-filter">
    <button type="button" class="filter-trigger" :aria-expanded="expanded" @click="toggle">
      <span class="ui-disclosure-label">筛选条件 <span class="optional ui-disclosure-meta">（可选）</span> <span v-if="count" class="optional ui-disclosure-meta">已设置 {{ count }} 条条件</span></span>
      <span class="chevron" :class="{ expanded }" aria-hidden="true"></span>
    </button>
    <div v-if="expanded" class="filter-panel">
      <div v-if="error" class="filter-error" role="alert">{{ error }}</div>
      <div class="filter-tools">
        <span class="filter-description">在所选输入行范围内，仅获取符合筛选条件的数据。</span>
        <el-button v-if="count" link type="primary" @click="clear">清除条件</el-button>
      </div>
      <template v-for="(group, g) in groups" :key="g">
        <div v-if="g" class="filter-or">或者</div>
        <div class="filter-group">
          <div v-for="(rule, r) in group" :key="`${g}-${r}-${rule.field_id}`" class="filter-row" :class="{ invalid }">
            <el-select :model-value="rule.field_id" placeholder="选择字段" :aria-label="`第 ${g + 1} 组第 ${r + 1} 条字段`" :loading="loading" @visible-change="handleFieldDropdownVisibleChange" @change="setField(g, r, $event)">
              <el-option v-for="field in fields" :key="field.id" :label="field.name" :value="field.id" />
              <el-option v-if="rule.field_id && !fieldFor(rule)" :label="`${rule.field_name || '原字段'}${tableId && !loading ? '（已失效）' : ''}`" :value="rule.field_id" disabled />
            </el-select>
            <el-select :model-value="rule.operator" aria-label="运算符" @change="setRule(g, r, 'operator', $event)">
              <el-option v-for="op in operatorsForField(rule.field_type)" :key="op" :label="INPUT_FILTER_OPERATORS[op]" :value="op" />
            </el-select>
            <el-input v-if="isEmptyOperator(rule.operator)" disabled placeholder="无需填写" />
            <el-select v-else-if="rule.field_type === 3" :model-value="rule.value" placeholder="请选择" aria-label="状态选项" :loading="loading" @visible-change="handleFieldDropdownVisibleChange" @change="setRule(g, r, 'value', $event)">
              <el-option v-for="option in valueOptions(rule)" :key="option.id" :label="option.name" :value="option.id" />
              <el-option v-if="rule.value && !valueOptions(rule).some(option => option.id === rule.value)" :value="rule.value" :label="tableId && !loading ? '原选项（已失效）' : '原选项'" disabled />
            </el-select>
            <el-select v-else-if="rule.field_type === 7" :model-value="rule.value" placeholder="请选择" aria-label="勾选状态" @change="setRule(g, r, 'value', $event)">
              <el-option label="已勾选" :value="true" /><el-option label="未勾选" :value="false" />
            </el-select>
            <el-input v-else :model-value="rule.value" placeholder="请输入" aria-label="比较值" @update:model-value="setRule(g, r, 'value', $event)" />
            <button type="button" class="filter-delete" title="删除条件" :aria-label="`删除第 ${g + 1} 组第 ${r + 1} 条条件`" @click="remove(g, r)">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg>
            </button>
          </div>
          <el-button link type="primary" class="filter-and" :disabled="loading || count >= 100" @click="add(g)">+ 并且</el-button>
        </div>
      </template>
      <el-button link type="primary" class="filter-add" :disabled="loading || count >= 100" @click="add()">{{ count ? '+ 或者' : '+ 添加筛选条件' }}</el-button>
    </div>
  </div>
</template>

<style scoped>
.input-filter { margin:12px 0 0; font-family:var(--app-font-family); font-size:var(--app-font-size-body); font-weight:var(--app-font-weight-regular); --el-font-size-base:var(--app-font-size-body); }
.filter-trigger { display:flex; align-items:center; justify-content:space-between; gap:12px; width:100%; min-height:48px; padding:12px 0; color:#1d2129; background:transparent; border:0; cursor:pointer; font:inherit; text-align:left; }
.optional { color:#86909c; font-size:var(--app-font-size-caption); font-weight:var(--app-font-weight-regular); }
.chevron { width:8px; height:8px; flex:0 0 8px; margin-right:3px; border-right:1px solid #86909c; border-bottom:1px solid #86909c; transform:rotate(45deg); transition:transform .2s ease; }
.chevron.expanded { transform:rotate(225deg); }
.filter-panel { padding-bottom:12px; }
.filter-panel :deep(.el-button) { font-family:inherit; font-size:var(--app-font-size-body); font-weight:var(--app-font-weight-regular); }
.filter-tools { display:flex; align-items:flex-start; justify-content:space-between; gap:8px; margin-bottom:8px; }
.filter-description { min-width:0; color:#86909c; font-size:var(--app-font-size-caption); line-height:20px; }
.filter-tools :deep(.el-button) { flex-shrink:0; }
.filter-group { padding:10px; background:#f5f6f7; border-radius:6px; }
.filter-row { display:grid; grid-template-columns:minmax(0,1.4fr) minmax(0,1fr) minmax(0,1.7fr) 22px; align-items:center; gap:6px; }
.filter-row + .filter-row { margin-top:8px; }
.filter-row :deep(.el-select),.filter-row :deep(.el-input) { width:100%; min-width:0; }
.filter-row :deep(.el-input__wrapper),.filter-row :deep(.el-select__wrapper) { padding-left:8px; padding-right:8px; }
.filter-delete { display:flex; align-items:center; justify-content:center; align-self:center; width:22px; height:32px; padding:0; background:transparent; border:0; color:#646a73; cursor:pointer; }
.filter-delete:hover { color:#a8071a; }
.filter-and { margin-top:10px; }
.filter-or { margin:10px 0; }
.filter-add { margin-top:12px; }
.filter-error { margin-bottom:8px; color:#a8071a; font-size:var(--app-font-size-caption); }
.invalid :deep(.el-input__wrapper),.invalid :deep(.el-select__wrapper) { box-shadow:0 0 0 1px #a8071a inset; }
@media(prefers-reduced-motion:reduce) { .chevron { transition:none; } }
</style>
