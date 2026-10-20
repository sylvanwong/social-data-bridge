<script setup>
import axios from "axios";
import { computed, ref, watch } from "vue";
import { bitable, FieldType, DateFormatter } from "@lark-base-open/js-sdk";
import { ElMessage, ElNotification } from "element-plus";
import { createSequentialTable, prepareTableFields, writeRowsToTable, loadTableOptions } from "@/utils/bitableImport";

const props = defineProps({
  api_key: String,
});

defineEmits(["back"]);

const API_HOST = "https://mcp.socialdatax.com";
const SUGGESTION_PATHS = {
  xhs: "/socialdatax/api/v1/xhs/search/suggestions",
  douyin: "/socialdatax/api/v1/douyin/search/suggestions",
  tiktok: "/socialdatax/api/v1/tiktok/search/suggestions",
  kuaishou: "/socialdatax/api/v1/kuaishou/search/suggestions",
  bilibili: "/socialdatax/api/v1/bilibili/search/suggestions",
  weibo: "/socialdatax/api/v1/weibo/search/suggestions",
  zhihu: "/socialdatax/api/v1/zhihu/search/suggestions",
  toutiao: "/socialdatax/api/v1/toutiao/search/suggestions",
  x: "/socialdatax/api/v1/x/search/suggestions",
  youtube: "/socialdatax/api/v1/youtube/search/suggestions",
  haokan: "/socialdatax/api/v1/haokan/search/suggestions",
  "baidu-tieba": "/socialdatax/api/v1/baidu-tieba/search/suggestions",
};

const PLATFORM_OPTIONS = [
  { value: "xhs", label: "小红书" },
  { value: "douyin", label: "抖音" },
  { value: "bilibili", label: "哔哩哔哩" },
  { value: "weibo", label: "微博" },
  { value: "kuaishou", label: "快手" },
  { value: "zhihu", label: "知乎" },
  { value: "toutiao", label: "今日头条" },
  { value: "x", label: "X" },
  { value: "tiktok", label: "TikTok" },
  { value: "youtube", label: "YouTube" },
  { value: "haokan", label: "好看视频" },
  { value: "baidu-tieba", label: "百度贴吧" },
];

/* search_target 仅接口文档中出现的取值做中文映射，其余原样展示 */
const SEARCH_TARGET_LABELS = {
  notes: "搜笔记",
  note: "搜笔记",
  goods: "搜商品",
  product: "搜商品",
};

/* ---------- 输出字段 ---------- */
const FIELD_MAPPING = [
  { key: "keyword", name: "搜索关键词", type: FieldType.Text, required: true },
  { key: "text", name: "推荐词", type: FieldType.Text, required: true },
  { key: "target", name: "建议类型", type: FieldType.Text, allowSelect: true },
  { key: "label", name: "建议标记", type: FieldType.Text, allowSelect: true },
  { key: "description", name: "补充说明", type: FieldType.Text },
  { key: "social_type", name: "平台", type: FieldType.Text, allowSelect: true },
  { key: "ctime", name: "提取时间", type: FieldType.DateTime, dateFormat: DateFormatter.DATE_TIME },
];
const TABLE_NAME = "搜索推荐词";
const requiredFieldKeys = FIELD_MAPPING.filter((field) => field.required).map((field) => field.key);
const allFieldKeys = FIELD_MAPPING.map((field) => field.key);
const selectedFieldKeys = ref([...requiredFieldKeys]);
const isAllFieldsSelected = computed(() => allFieldKeys.every((key) => selectedFieldKeys.value.includes(key)));
const isFieldsIndeterminate = computed(() => {
  const count = allFieldKeys.filter((key) => selectedFieldKeys.value.includes(key)).length;
  return count > 0 && count < allFieldKeys.length;
});
const toggleAllFields = (checked) => {
  selectedFieldKeys.value = checked ? [...allFieldKeys] : [...requiredFieldKeys];
};
const activeFieldMapping = computed(() =>
  FIELD_MAPPING.filter((field) => field.required || selectedFieldKeys.value.includes(field.key))
);

const formData = ref({
  social_type: "xhs",
  keyword: "",
  radio: 1,
  table_id: "",
});
const loading = ref(false);
const table_options = ref([]);
const toastVisible = ref(false);
const toastText = ref("");
const toastLoading = ref(false);

const getTargetLabel = (target) => SEARCH_TARGET_LABELS[target] || target;
const platformLabel = (value) =>
  PLATFORM_OPTIONS.find((item) => item.value === value)?.label || value;

/** 批量关键词：按换行/中英文逗号拆分、去空、去重（与「关键词搜索获取」同一规则） */
const parseKeywords = (text) => {
  if (!text || typeof text !== "string") return [];
  return Array.from(
    new Set(
      text
        .split(/[\n,，]+/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
};

const toRow = (item, keyword) => ({
  keyword,
  text: item?.text ?? "",
  target: item?.search_target ? getTargetLabel(item.search_target) : "",
  label: item?.label ?? "",
  description: item?.description ?? "",
  social_type: platformLabel(formData.value.social_type),
  ctime: Date.now(),
});

const showToast = (text, isLoading = true) => {
  toastText.value = text;
  toastLoading.value = isLoading;
  toastVisible.value = true;
};
const hideToast = () => {
  toastVisible.value = false;
};
const showErrorMsg = (message) => {
  ElMessage({ message, type: "error", plain: true });
};

const callSuggestions = async (keyword) => {
  const path = SUGGESTION_PATHS[formData.value.social_type];
  if (!path) throw new Error("当前平台暂不支持搜索推荐词");

  const response = await axios.post(
    `${API_HOST}${path}`,
    { keyword },
    {
      timeout: 60000,
      headers: { authorization: `Bearer ${props.api_key}` },
    }
  );
  return response.data;
};

const execute = async () => {
  loading.value = true;

  try {
    const keywords = parseKeywords(formData.value.keyword);
    const rows = [];
    const failedKeywords = [];

    for (let i = 0; i < keywords.length; i++) {
      const keyword = keywords[i];
      showToast(`正在获取「${keyword}」（${i + 1}/${keywords.length}）...`, true);
      try {
        const res = await callSuggestions(keyword);
        if (res && typeof res === "object" && res.code !== undefined) {
          throw new Error(res.message || `请求失败（错误码 ${res.code}）`);
        }
        const items = Array.isArray(res?.items) ? res.items : [];
        if (items.length) {
          rows.push(...items.map((item) => toRow(item, keyword)));
        } else {
          failedKeywords.push(keyword);
        }
      } catch (error) {
        console.error(`关键词「${keyword}」获取失败:`, error);
        failedKeywords.push(keyword);
      }
    }

    if (!rows.length) {
      throw new Error(failedKeywords.length
        ? "所有关键词均未获取到数据，请更换关键词后重试"
        : "未获取到推荐词，请更换关键词后重试");
    }

    showToast("正在写入多维表格...", true);

    let tableId = formData.value.radio === 2 ? formData.value.table_id : "";
    if (!tableId) {
      const created = await createSequentialTable(TABLE_NAME);
      tableId = created.tableId || created.id || created;
      await prepareTableFields(tableId, activeFieldMapping.value, { isNewTable: true });
      await bitable.ui.switchToTable(tableId);
    } else {
      const result = await prepareTableFields(tableId, activeFieldMapping.value);
      if (result?.addedCount) {
        ElNotification({ message: `已自动添加 ${result.addedCount} 个字段`, type: "success" });
      }
    }

    const table = await bitable.base.getTableById(tableId);
    const written = await writeRowsToTable(table, rows, activeFieldMapping.value, (done, total) => {
      showToast(`正在写入 ${done}/${total} 条...`, true);
    });

    const suffix = failedKeywords.length ? `，${failedKeywords.length} 个关键词无结果` : "";
    showToast(`处理完成：成功 ${written} 条${suffix}`, false);
    setTimeout(() => hideToast(), 3000);
  } catch (error) {
    console.error("搜索推荐词执行失败:", error);
    hideToast();
    showErrorMsg(error?.response?.data?.message || error.message || "执行失败，请稍后重试");
  } finally {
    loading.value = false;
  }
};

const commit = () => {
  if (!props.api_key) {
    showErrorMsg("请先在首页配置 API Key");
    return;
  }
  if (!formData.value.social_type) {
    showErrorMsg("请选择平台");
    return;
  }
  if (!parseKeywords(formData.value.keyword).length) {
    showErrorMsg("请输入至少一个关键词");
    return;
  }
  if (formData.value.radio === 2 && !formData.value.table_id) {
    showErrorMsg("请选择现有表格");
    return;
  }
  execute();
};

watch(
  () => formData.value.radio,
  async (radio) => {
    if (radio === 2) {
      try {
        table_options.value = await loadTableOptions();
      } catch (error) {
        console.error("获取表格列表失败:", error);
        showErrorMsg("获取表格列表失败，请稍后重试");
      }
    } else {
      formData.value.table_id = "";
    }
  }
);
</script>

<template>
  <div class="sub-page">
    <div class="sub-page-header">
      <span class="sub-page-back" @click="$emit('back')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16">
          <polyline points="15 18 9 12 15 6"></polyline>
        </svg>
      </span>
      <span class="sub-page-title">搜索推荐词</span>
    </div>
    <div class="form-card">
      <el-form class="form" :model="formData" label-position="top">
        <section class="settings-section" aria-labelledby="sugg-fetch-settings-title">
          <h2 id="sugg-fetch-settings-title" class="section-heading">
            <span class="section-step">1</span>
            <span>获取设置</span>
          </h2>
          <el-form-item label="">
            <div class="c-label">平台</div>
            <el-select v-model="formData.social_type" placeholder="请选择" style="width: 100%">
              <el-option v-for="tl in PLATFORM_OPTIONS" :key="tl.value" :label="tl.label" :value="tl.value" />
            </el-select>
          </el-form-item>
          <el-form-item label="">
            <div class="c-label">关键词</div>
            <el-input
              v-model="formData.keyword"
              type="textarea"
              :rows="4"
              class="c-input"
              placeholder="请输入正在搜索的词或短语，支持批量添加，多个关键词可换行或用逗号分隔"
            />
          </el-form-item>
        </section>

        <section class="settings-section settings-section-output" aria-labelledby="sugg-output-settings-title">
          <h2 id="sugg-output-settings-title" class="section-heading">
            <span class="section-step">2</span>
            <span>输出设置</span>
          </h2>
          <el-form-item label="">
            <div class="field-stack">
              <div class="c-label">输出到表格</div>
              <el-radio-group v-model="formData.radio" class="radio-block">
                <el-radio :value="1">新建表格</el-radio>
                <el-radio :value="2">使用现有表格</el-radio>
              </el-radio-group>
            </div>
          </el-form-item>
          <el-form-item v-if="formData.radio === 2" label="">
            <div class="c-label">选择现有表格</div>
            <el-select v-model="formData.table_id" placeholder="请选择" style="width: 100%">
              <el-option v-for="table in table_options" :key="table.id" :label="table.name" :value="table.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="">
            <div class="field-selection-content">
              <div class="field-selection-title">
                <div class="c-label">选择需要的字段</div>
              </div>
              <el-checkbox
                :model-value="isAllFieldsSelected"
                :indeterminate="isFieldsIndeterminate"
                class="select-all-fields"
                @change="toggleAllFields"
              >全选</el-checkbox>
              <el-checkbox-group v-model="selectedFieldKeys" class="field-checkbox-group">
                <el-checkbox
                  v-for="field in FIELD_MAPPING"
                  :key="field.key"
                  :label="field.key"
                  :disabled="field.required"
                  class="field-checkbox-item"
                >
                  {{ field.name }}
                </el-checkbox>
              </el-checkbox-group>
            </div>
          </el-form-item>
        </section>
      </el-form>

      <div class="task-actions">
        <el-button color="#a8071a" class="commit-btn" :loading="loading" :disabled="loading" @click="commit">
          {{ loading ? "执行中" : "立即执行" }}
        </el-button>
      </div>
    </div>

    <div class="toast-wrap" :class="{ show: toastVisible }">
      <div class="toast" :class="{ 'toast-loading': toastLoading, 'toast-success': !toastLoading }">
        <div class="toast-icon" v-if="toastLoading">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <path d="M12 2a10 10 0 0 1 10 10"></path>
          </svg>
        </div>
        <div class="toast-icon" v-else>
          <svg viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" fill="#00B42A"></circle>
            <path d="M8 12l2.5 2.5L16 9" stroke="#FFFFFF" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path>
          </svg>
        </div>
        <span>{{ toastText }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sub-page {
  min-height: 100vh;
  background: #fffcfc;
  font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
}
.sub-page-header {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  min-height: 48px;
  padding: 0 8px;
  background: #FFFFFF;
  border-bottom: 1px solid #E5E6EB;
  position: sticky;
  top: 0;
  z-index: 100;
}
.sub-page-back {
  width: 32px;
  height: 32px;
  cursor: pointer;
  color: #4E5969;
  transition: color 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}
.sub-page-back:hover { color: #A8071A; }
.sub-page-back svg {
  width: 100%;
  height: 100%;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.sub-page-title {
  overflow: hidden;
  font-size: 18px;
  font-weight: 600;
  color: #1D2129;
  line-height: 24px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.form-card {
  margin: 16px;
  padding: 20px;
  background: #FFFFFF;
  border: 1px solid #E5E6EB;
  border-radius: 8px;
  box-sizing: border-box;
}
.section-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 12px;
  color: #1D2129;
  font-size: 16px;
  font-weight: 500;
  line-height: 22px;
}
.section-step {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  color: #A8071A;
  background: #FFF1F2;
  font-size: 12px;
  font-weight: 600;
}
.settings-section-output {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid #F0F1F3;
}
.form :deep(.el-form-item__label) {
  font-size: 14px;
  color: #1d2129;
  margin-bottom: 8px;
}
.form :deep(.el-form-item) {
  margin-bottom: 16px;
}
.form :deep(.el-select__wrapper) {
  min-height: 36px;
  height: 36px;
  padding: 0 12px;
}
.form :deep(.el-input__wrapper) {
  min-height: 36px;
  padding: 0 12px;
}
.form :deep(.el-textarea__inner) {
  min-height: 80px;
  padding: 8px 12px;
}
.c-label {
  margin-bottom: 8px;
  font-size: 14px;
  font-weight: 500;
  line-height: 20px;
  color: #1D2129;
  display: flex;
  align-items: center;
}
.task-actions {
  display: flex;
  gap: 8px;
}
.commit-btn {
  background: #A8071A;
  width: 100%;
  height: 36px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #fff;
  font-size: 14px;
  font-weight: 500;
  margin-top: 0;
  cursor: pointer;
  border: none;
  transition: background 0.2s ease;
}
.commit-btn:hover { background: #C11126; }
.commit-btn:active { background: #8A0515; }
.field-stack { width: 100%; }
.radio-block {
  width: 100%;
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}
.radio-block :deep(.el-radio) { min-height: 28px; margin-right: 0; }
.field-selection-content { width: 100%; }
.field-selection-title { margin-bottom: 8px; }
.select-all-fields { margin-right: 0; margin-bottom: 8px; }
.field-checkbox-group {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 16px;
  width: 100%;
}
.field-checkbox-item { margin-right: 0; }
.field-checkbox-group :deep(.el-checkbox) { margin-right: 0; align-items: center; }
.field-checkbox-group :deep(.el-checkbox__label) { padding-left: 8px; color: #1D2129; line-height: 22px; }
.field-checkbox-group :deep(.el-checkbox__inner) { width: 16px; height: 16px; border-radius: 4px; border-color: #E5E6EB; }
.field-checkbox-group :deep(.el-checkbox:hover .el-checkbox__inner) { border-color: #86909C; }
.field-checkbox-group :deep(.el-checkbox__input.is-checked .el-checkbox__inner) { background: #A8071A; border-color: #A8071A; }
.field-checkbox-group :deep(.el-checkbox__input.is-disabled.is-checked .el-checkbox__inner) { background: #F7F8FA; border-color: #E5E6EB; }
.field-checkbox-group :deep(.el-checkbox__input.is-disabled.is-checked .el-checkbox__inner::after) { border-color: #C9CDD4; }
.field-checkbox-group :deep(.el-checkbox__input.is-disabled + .el-checkbox__label) { color: #C9CDD4; }
.field-checkbox-group :deep(.el-checkbox__input.is-checked + .el-checkbox__label) { color: #1D2129; }

/* toast */
.toast-wrap {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 500;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.3s ease, transform 0.3s ease;
}
.toast-wrap.show { opacity: 1; transform: translate(-50%, -50%) scale(1); }
.toast {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 18px;
  background: #FFFFFF;
  border: 1px solid #E5E6EB;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  font-size: 14px;
  font-weight: 500;
  color: #1D2129;
  white-space: nowrap;
}
.toast-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.toast .toast-icon svg { width: 100%; height: 100%; }
.toast-loading .toast-icon { animation: spin 0.8s linear infinite; color: #A8071A; }
.toast-success .toast-icon { color: #00B42A; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
