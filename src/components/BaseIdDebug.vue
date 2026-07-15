<script setup>
import { bitable } from "@lark-base-open/js-sdk";
import { ElNotification } from "element-plus";
import { onMounted, onUnmounted, ref } from "vue";

const emit = defineEmits(["back"]);

const loading = ref(false);
const selectionInfo = ref({
  baseId: "",
  tableId: "",
  viewId: "",
  fieldId: "",
  recordId: "",
});
const activeTableInfo = ref({
  id: "",
  name: "",
});
const lastUpdatedAt = ref("");

let unsubscribeSelectionChange = null;

const formatTime = () => {
  return new Date().toLocaleString("zh-CN", { hour12: false });
};

const updateSelectionInfo = async () => {
  const selection = await bitable.base.getSelection();
  selectionInfo.value = {
    baseId: selection.baseId || "",
    tableId: selection.tableId || "",
    viewId: selection.viewId || "",
    fieldId: selection.fieldId || "",
    recordId: selection.recordId || "",
  };
};

const updateActiveTableInfo = async () => {
  const table = await bitable.base.getActiveTable();
  activeTableInfo.value = {
    id: table.id || "",
    name: await table.getName(),
  };
};

const loadData = async () => {
  loading.value = true;

  try {
    await Promise.all([updateSelectionInfo(), updateActiveTableInfo()]);
    lastUpdatedAt.value = formatTime();
  } catch (error) {
    console.error("读取 BaseId 调试信息失败:", error);
    ElNotification({
      title: "错误",
      message: error?.message || "读取 BaseId 调试信息失败",
      type: "error",
      duration: 0,
    });
  } finally {
    loading.value = false;
  }
};

onMounted(async () => {
  await loadData();
  unsubscribeSelectionChange = bitable.base.onSelectionChange(async () => {
    await loadData();
  });
});

onUnmounted(() => {
  if (typeof unsubscribeSelectionChange === "function") {
    unsubscribeSelectionChange();
  }
});
</script>

<template>
  <div class="sub-page">
    <div class="sub-page-header">
      <span class="sub-page-back" @click="emit('back')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16">
          <polyline points="15 18 9 12 15 6"></polyline>
        </svg>
      </span>
      <span class="sub-page-title">BaseId 调试</span>
    </div>

    <div class="form-card">
      <div class="panel-header">
        <div>
          <div class="panel-title">当前 Base 信息</div>
          <div class="panel-desc">基于 `bitable.base.getSelection()` 和 `bitable.base.getActiveTable()`</div>
        </div>
        <el-button color="#a8071a" plain :loading="loading" @click="loadData">
          刷新
        </el-button>
      </div>

      <div class="info-card">
        <div class="info-title">当前表格 BaseId</div>
        <div class="info-value">{{ selectionInfo.baseId || "-" }}</div>
        <div class="info-tip">当前激活表：{{ activeTableInfo.name || "-" }}（{{ activeTableInfo.id || "-" }}）</div>
      </div>

      <div class="info-card">
        <div class="info-title">选中表格 BaseId</div>
        <div class="info-value">{{ selectionInfo.baseId || "-" }}</div>
        <div class="info-tip">当前选中 tableId：{{ selectionInfo.tableId || "-" }}</div>
      </div>

      <div class="result-card">
        <div class="result-title">Selection 明细</div>
        <div class="result-item">
          <div class="result-label">baseId</div>
          <div class="result-message">{{ selectionInfo.baseId || "-" }}</div>
        </div>
        <div class="result-item">
          <div class="result-label">tableId</div>
          <div class="result-message">{{ selectionInfo.tableId || "-" }}</div>
        </div>
        <div class="result-item">
          <div class="result-label">viewId</div>
          <div class="result-message">{{ selectionInfo.viewId || "-" }}</div>
        </div>
        <div class="result-item">
          <div class="result-label">fieldId</div>
          <div class="result-message">{{ selectionInfo.fieldId || "-" }}</div>
        </div>
        <div class="result-item">
          <div class="result-label">recordId</div>
          <div class="result-message">{{ selectionInfo.recordId || "-" }}</div>
        </div>
      </div>

      <div class="note-card">
        <div class="note-title">说明</div>
        <div class="note-text">
          当前 SDK 里未发现 `bitable.base.getId()`。BaseId 可通过 `bitable.base.getSelection().baseId` 获取。
        </div>
        <div class="note-text">
          在同一个扩展运行上下文中，“当前表格”和“选中表格”所属 Base 通常是同一个，所以这里两个 BaseId 预期一致。
        </div>
      </div>

      <div class="footer-text">最近刷新时间：{{ lastUpdatedAt || "-" }}</div>
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

.sub-page-back:hover {
  color: #A8071A;
}

.sub-page-back svg {
  width: 100%;
  height: 100%;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.sub-page-title {
  font-size: 16px;
  font-weight: 600;
  color: #1D2129;
  line-height: 24px;
}

.form-card {
  margin: 16px;
  padding: 16px;
  background: #FFFFFF;
  border-radius: 12px;
  border: 1px solid rgba(0, 0, 0, 0.06);
}

.panel-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.panel-title {
  font-size: 16px;
  font-weight: 600;
  color: #1D2129;
  line-height: 24px;
}

.panel-desc {
  margin-top: 4px;
  font-size: 12px;
  color: #86909C;
  line-height: 20px;
}

.info-card,
.result-card,
.note-card {
  padding: 14px;
  border-radius: 10px;
  background: #FFFFFF;
  border: 1px solid #E5E6EB;
}

.info-card + .info-card,
.info-card + .result-card,
.result-card + .note-card {
  margin-top: 12px;
}

.info-title,
.result-title,
.note-title {
  font-size: 14px;
  font-weight: 600;
  color: #1D2129;
  line-height: 22px;
}

.info-value {
  margin-top: 8px;
  font-size: 15px;
  line-height: 22px;
  color: #A8071A;
  word-break: break-all;
}

.info-tip,
.note-text,
.result-message,
.footer-text {
  font-size: 13px;
  line-height: 20px;
  color: #4E5969;
}

.info-tip,
.note-text {
  margin-top: 8px;
}

.result-item {
  display: flex;
  gap: 12px;
  padding-top: 12px;
}

.result-label {
  width: 68px;
  flex-shrink: 0;
  font-size: 13px;
  font-weight: 500;
  line-height: 20px;
  color: #1D2129;
}

.result-message {
  word-break: break-all;
}

.footer-text {
  margin-top: 12px;
}
</style>
