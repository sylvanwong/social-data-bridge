<script setup>
import { bitable, FieldType, NumberFormatter } from "@lark-base-open/js-sdk";
import { ElMessage } from "element-plus";
import { ref, onMounted, onUnmounted, computed, watch } from "vue";
import request from '@/utils/request'

const profile_timer = ref(null);
const search_timer = ref(null);

const api_key = ref("");
const api_key_disabled = ref(true);

const activeName = ref("1");
const handleClick = () => { };
const formData = ref({ radio: 1, url: "", pages: 1, table_id: "" });
const formData1 = ref({
  radio: 1,
  table_id: "",
  social_type: "", // 动态使用 social_type_options 第一个值
  keyword: "",
  sort_type: 0, // xhs
  filter_note_type: 0, // xhs
  filter_note_time: 0, // xhs
  publish_time: 0, // douyin
  filter_duration: 0, // douyin
  pages: 1,
});
const pages_options = [
  { value: 0, label: "全量获取" },
  { value: 1, label: "仅获取首页" },
  { value: 5, label: "获取前5页" },
  { value: 10, label: "获取前10页" },
  { value: 20, label: "获取前20页" },
  { value: 30, label: "获取前30页" },
  { value: 50, label: "获取前50页" },
];
const xhs_pages_options = pages_options.filter(item => item.value !== 0);

// 平台标签映射
const PLATFORM_LABELS = {
  xhs: '小红书',
  douyin: '抖音',
};

// API key 清除标记
const API_KEY_CLEARED_MARKER = "__cleared__";

const TYPE_OPTIONS = [
  { value: "xhs", label: "小红书" },
  { value: "douyin", label: "抖音" },
]

const social_type_options = ref([
  ...TYPE_OPTIONS
]);
const douyin_sort_type_options = [
  { value: 0, label: "综合" },
  { value: 1, label: "最多点赞" },
  { value: 2, label: "最多发布" },
];
const xhs_sort_type_options = [
  { value: 0, label: "综合" },
  { value: 1, label: "最热" },
  { value: 2, label: "最新" },
  { value: 3, label: "最多评论" },
  { value: 4, label: "最多收藏" },
];
const filter_note_type_options = [
  { value: 0, label: "综合笔记" },
  { value: 1, label: "视频笔记" },
  { value: 2, label: "图文笔记" },
];
const time_options = [
  { value: 0, label: "不限" },
  { value: 1, label: "一天之内" },
  { value: 2, label: "一周之内" },
  { value: 3, label: "半年之内" },
];
const filter_duration_options = [
  { value: 0, label: "不限" },
  { value: 1, label: "1分钟以下" },
  { value: 2, label: "1-5分钟" },
  { value: 3, label: "5分钟以上" },
];

const loading = ref(false);
const table_options = ref([]);
const isXhs = computed(() => formData1.value.social_type === 'xhs');
const isDouyin = computed(() => formData1.value.social_type === 'douyin');
let page = 1;
const page_size = 20;
let total = 0;

onMounted(async () => {
  const key = await bitable.bridge.getData("api_key");
  // 只有 key 非空且为字符串且不是清除标记时才使用
  if (key && typeof key === "string" && key.trim() && key !== API_KEY_CLEARED_MARKER) {
    api_key.value = key;
    // 有 api_key 则获取平台配置
    await fetchPlatformConfig();
  }
  const profile_url = await bitable.bridge.getData("profile_url");
  const search_platform = await bitable.bridge.getData("search_platform");
  const search_keyword = await bitable.bridge.getData("search_keyword");
  if (profile_url && typeof profile_url == "string") {
    formData.value.url = profile_url;
  }
  if (search_keyword && typeof search_keyword == "string") {
    formData1.value.keyword = search_keyword;
  }
  if (search_platform && typeof search_platform == "string" && social_type_options.value.some(opt => opt.value === search_platform)) {
    formData1.value.social_type = search_platform;
  } else {
    formData1.value.social_type = social_type_options.value[0]?.value || "";
  }
});

const loadTableOptions = async () => {
  try {
    const tableList = await bitable.base.getTableList();
    table_options.value = await Promise.all(
      tableList.map(async (table) => ({
        id: table.id,
        name: await table.getName(),
      }))
    );
  } catch (error) {
    console.error("获取表格列表失败:", error);
    showErrorMsg("获取表格列表失败，请稍后重试");
  }
};

watch(
  () => [formData.value.radio, formData1.value.radio],
  ([profileRadio, searchRadio]) => {
    if (profileRadio === 2 || searchRadio === 2) {
      loadTableOptions();
    }
  }
);

const saveApiKey = async () => {
  if (api_key.value === "") {
    // 清除存储的 api_key，使用特殊标记值
    api_key_disabled.value = true;
    await bitable.bridge.setData("api_key", API_KEY_CLEARED_MARKER);
    // 重置平台列表为默认值
    social_type_options.value = [
      ...TYPE_OPTIONS
    ];
    formData1.value.social_type = social_type_options.value[0]?.value || "";
    return;
  } else {
    api_key_disabled.value = true;
    await bitable.bridge.setData("api_key", api_key.value);
    ElMessage({
      message: "保存成功",
      type: "success",
      plain: true,
    });
    // 保存成功后重新获取平台配置
    await fetchPlatformConfig();
  }
};

// 获取平台配置
const fetchPlatformConfig = async () => {
  try {
    const response = await request({
      url: "/social/api/v1/feishu/social/config",
      method: "get",
      headers: {
        'authorization': `Bearer ${api_key.value}`,
      },
    });
    const res = response.data;
    if (res.sta === 0 && Array.isArray(res.data?.value)) {
      social_type_options.value = res.data.value.map(platform => ({
        value: platform,
        label: PLATFORM_LABELS[platform] || platform
      }));
      // 如果当前选中平台不在新列表中，重置为第一个
      if (!social_type_options.value.some(opt => opt.value === formData1.value.social_type)) {
        formData1.value.social_type = social_type_options.value[0]?.value || "";
      }
    }
  } catch (error) {
    console.error('获取平台配置失败:', error);
    ElMessage({
      message: "获取平台配置失败，使用默认设置",
      type: "warning",
      plain: true,
    });
  }
};

// 字段映射配置
const FIELD_MAPPING = [
  { key: 'aweme_id', name: '视频编号', type: FieldType.Text },
  { key: 'title', name: '视频标题', type: FieldType.Text },
  { key: 'tags', name: '标签', type: FieldType.Text },
  { key: 'user_id', name: '用户ID', type: FieldType.Text },
  { key: 'nickname', name: '作者', type: FieldType.Text },
  { key: 'digg_count', name: '点赞数', type: FieldType.Number, formatter: NumberFormatter.INTEGER },
  { key: 'comment_count', name: '评论数', type: FieldType.Number, formatter: NumberFormatter.INTEGER },
  { key: 'collect_count', name: '收藏数', type: FieldType.Number, formatter: NumberFormatter.INTEGER },
  { key: 'share_count', name: '分享数', type: FieldType.Number, formatter: NumberFormatter.INTEGER },
  { key: 'play_url', name: '下载链接', type: FieldType.Text },
  { key: 'cover_url', name: '封面', type: FieldType.Text },
  { key: 'duration', name: '时长', type: FieldType.Number, formatter: NumberFormatter.INTEGER },
  { key: 'create_time', name: '发布时间', type: FieldType.DateTime, isTimestamp: true },
];

// 公共轮询函数
const pollTaskStatus = (task_id, timerRef, checkFn, onSuccess) => {
  let time = 0;
  timerRef.value && clearInterval(timerRef.value);
  timerRef.value = setInterval(() => {
    time += 3;
    if (time >= 600) {
      clearInterval(timerRef.value);
      timerRef.value = null;
      showErrorMsg("获取数据超时，请稍后重试");
      loading.value = false;
    } else {
      checkFn(task_id, onSuccess);
    }
  }, 3000);
};

const resetParams = () => {
  loading.value = false;
  page = 1;
  total = 0;
};

// 写入数据
const createAndWriteData = async (list, type, task_id, targetTableId = "") => {
  if (!list || list.length == 0) {
    ElMessage({
      message: "获取数据异常，请稍后重试",
      type: "warning",
      plain: true,
    });
    resetParams();
    return;
  }
  try {
    // 新建表格模式：首次写入前创建目标表
    if (!type && !targetTableId) {
      let tableName = '';
      if (activeName.value == "1") {
        const firstItem = list[0];
        tableName = firstItem?.nickname || '社媒数据助手';
      } else if (activeName.value == "2") {
        tableName = formData1.value.keyword
      }
      const { tableId } = await createSequentialTable(tableName);
      const newTable = await bitable.base.getTable(tableId);
      await bitable.ui.switchToTable(tableId);
      const first_field = await newTable.getField('文本');
      const fieldPromises = FIELD_MAPPING.map((config, index) => {
        if (index === 0 && first_field) {
          return newTable.setField(first_field.id, { type: config.type, name: config.name });
        }
        return newTable.addField({ type: config.type, name: config.name });
      });
      await Promise.all(fieldPromises);
    }
    // 写入数据
    const activeTable = targetTableId
      ? await bitable.base.getTableById(targetTableId)
      : await bitable.base.getActiveTable();
    const fieldMetaList = await activeTable.getFieldMetaList();
    const fieldIdByName = new Map(fieldMetaList.map(meta => [meta.name, meta.id]));
    const fieldList = [];
    for (const config of FIELD_MAPPING) {
      const fieldId = fieldIdByName.get(config.name);
      if (!fieldId) {
        fieldList.push({ field: null, config });
        continue;
      }
      try {
        const field = await activeTable.getFieldById(fieldId);
        fieldList.push({ field, config });
      } catch (error) {
        console.error(`获取字段失败：${config.name}`, error);
        fieldList.push({ field: null, config });
      }
    }
    const requiredField = fieldList.find(item => item.config.name === "视频编号" && item.field);
    if (!requiredField) {
      showErrorMsg("所选表格缺少必需字段：视频编号");
      resetParams();
      return;
    }
    const availableFieldList = fieldList.filter(item => !!item.field);
    if (availableFieldList.length === 0) {
      showErrorMsg("所选表格没有可写入字段");
      resetParams();
      return;
    }
    let records = [];
    for (const item of list) {
      let record = [];
      for (const { field, config } of availableFieldList) {
        if (!targetTableId && config.formatter) {
          await field.setFormatter(config.formatter);
        }
        let value = item[config.key];
        if (config.isTimestamp && value) {
          value = value * 1000;
        }
        record.push(await field.createCell(value));
      }
      records.push(record);
    }
    const recordIds = await activeTable.addRecords(records);

    if (total > page) {
      page += 1;
      getList(task_id, 'next', targetTableId);
      return;
    } else {
      resetParams();
    }
  } catch (error) {
    console.error("🚀 ~ createAndWriteData ~ error:", error)
    const errorMsg = error?.message ? `写入失败：${error.message}` : "写入失败，请稍后重试";
    showErrorMsg(errorMsg);
    resetParams();
  }
}

// 新建 顺序表
const createSequentialTable = async (baseTableName) => {
  try {
    // 获取所有表格元信息
    const existingTables = await bitable.base.getTableMetaList();
    const tableNames = existingTables.map(table => table.name);

    // 检查是否存在基础名称表格（无序号）或存在有序号的表格
    const existsBaseTable = tableNames.includes(baseTableName);
    const existsSequentialTable = tableNames.some(name => name.startsWith(`${baseTableName}`) && /\d+$/.test(name.slice(baseTableName.length)));
    if (!existsBaseTable && !existsSequentialTable) {
      // 存在基础表，直接创建基础名称表格
      const newTable = await bitable.base.addTable({
        name: baseTableName
      });
      // console.log(`已创建基础表格：${baseTableName}，ID：${newTable.id}`);
      return newTable;
    }

    // 存在基础表，查找最大序号
    // 正则匹配格式：基础名+数字（如"视频信息表1"）
    const reg = new RegExp(`^${baseTableName}(\\d+)$`);
    let maxIndex = 0;

    tableNames.forEach(name => {
      const match = name.match(reg);
      if (match) {
        // 提取数字部分并转换为整数
        const index = parseInt(match[1], 10);
        // 更新最大序号
        if (index > maxIndex) {
          maxIndex = index;
        }
      }
    });

    // 计算新表格名称（最大序号+1）
    const newTableName = `${baseTableName}${maxIndex + 1}`;

    // 创建新表格
    const newTable = await bitable.base.addTable({
      name: newTableName
    });
    // console.log(`已创建序号表格：${newTableName}`);
    return newTable;

  } catch (error) {
    console.error("获取表格序号失败：", error);
    throw error; // 抛出错误便于上层处理
  }
}

const showErrorMsg = (message) => {
  ElMessage({
    message: message,
    type: "error",
    plain: true,
  });
};

// 主页 提交任务
const postProfileTask = async (targetTableId = "") => {
  await request({
    url: "/social/api/v1/feishu/social/task",
    method: "post",
    headers: {
      'authorization': `Bearer ${api_key.value}`,
    },
    data: {
      url: formData.value.url,
      pages: Number(formData.value.pages),
    },
  })
    .then(function (response) {
      // loading.value = false;
      let res = response.data;
      if (res.sta == 0) {
        const data = res.data;
        getProfileTaskInterval(data.task_id, targetTableId);
      } else {
        loading.value = false;
        showErrorMsg(res.msg);
      }
    })
    .catch(function (error) {
      loading.value = false;
      console.log(error);
      showErrorMsg(error);
    });
};

const closeProfileInterval = () => {
  profile_timer.value && clearInterval(profile_timer.value);
  profile_timer.value = null;
};

// 主页 获取任务状态
const getProfileTask = async (task_id, onSuccess) => {
  await request({
    url: "/social/api/v1/feishu/social/task?task_id=" + task_id,
    method: "get",
    headers: {
      'authorization': `Bearer ${api_key.value}`,
    },
  })
    .then(function (response) {
      let res = response.data;
      if (res.sta == 0) {
        const { status } = res.data;
        if (status == 1) { // 成功
          closeProfileInterval();
          onSuccess();
        } else if (status == 2) { // 失败
          closeProfileInterval();
          showErrorMsg("获取数据失败，请稍后重试");
          loading.value = false;
        }
        // status == 0 继续轮询
      }
    })
    .catch(function (error) {
      console.log(error);
    });
};

// 主页 轮询获取任务状态
const getProfileTaskInterval = (task_id, targetTableId = "") => {
  pollTaskStatus(task_id, profile_timer, getProfileTask, () => {
    page = 1;
    getList(task_id, "", targetTableId);
  });
};

// 获取帖子列表
const getList = async (task_id, type, targetTableId = "") => {
  await request({
    url: "/social/api/v1/feishu/post/list",
    method: "post",
    headers: {
      'authorization': `Bearer ${api_key.value}`,
    },
    data: {
      task_id: task_id,
      page: page,
      page_size: page_size,
    },
  })
    .then(function (response) {
      let res = response.data;
      if (res.sta == 0) {
        const { count, data } = res.data;
        if (!type) { // 第一次请求
          total = Math.ceil(count / page_size);
          createAndWriteData(data, '', task_id, targetTableId);
        } else if (type == 'next') {
          createAndWriteData(data, type, task_id, targetTableId);
        }
      } else {
        loading.value = false;
        showErrorMsg(res.msg);
      }
    })
    .catch(function (error) {
      loading.value = false;
      console.log(error);
      showErrorMsg(error);
    });
};

// 主页数据
const getProfileData = async (targetTableId = "") => {
  // 新建表格，表格中第一个字段为视频编号
  // createAndWriteData([]);
  // return;
  loading.value = true;
  await postProfileTask(targetTableId);
};

const getSearchTask = async (task_id, onSuccess) => {
  await request({
    url: "/social/api/v1/feishu/keyword/task?task_id=" + task_id,
    method: "get",
    headers: {
      'authorization': `Bearer ${api_key.value}`,
    },
  })
    .then(function (response) {
      let res = response.data;
      if (res.sta == 0) {
        const { status } = res.data;
        if (status == 1) { // 成功
          closeSearchInterval();
          onSuccess();
        } else if (status == 2) { // 失败
          closeSearchInterval();
          showErrorMsg("获取数据失败，请稍后重试");
          loading.value = false;
        }
        // status == 0 继续轮询
      }
    })
    .catch(function (error) {
      console.log(error);
    });
}

const closeSearchInterval = () => {
  search_timer.value && clearInterval(search_timer.value);
  search_timer.value = null;
};

const getSearchTaskInterval = (task_id, targetTableId = "") => {
  pollTaskStatus(task_id, search_timer, getSearchTask, () => {
    page = 1;
    getList(task_id, "", targetTableId);
  });
};

// 关键词搜索 提交任务
const postSearchTask = async (targetTableId = "") => {
  let filter_config = {};
  if (formData1.value.social_type == 'xhs') {
    filter_config = {
      sort_type: formData1.value.sort_type,
      filter_note_type: formData1.value.filter_note_type,
      filter_note_time: formData1.value.filter_note_time,
    }
  } else if (formData1.value.social_type == 'douyin') {
    filter_config = {
      sort_type: formData1.value.sort_type,
      publish_time: formData1.value.publish_time,
      filter_duration: formData1.value.filter_duration,
    }
  }
  await request({
    url: "/social/api/v1/feishu/keyword/task",
    method: "post",
    headers: {
      'authorization': `Bearer ${api_key.value}`,
    },
    data: {
      social_type: formData1.value.social_type,
      keyword: formData1.value.keyword,
      pages: Number(formData1.value.pages),
      filter_config,
    },
  })
    .then(function (response) {
      // loading.value = false;
      let res = response.data;
      if (res.sta == 0) {
        const data = res.data;
        getSearchTaskInterval(data.task_id, targetTableId);
      } else {
        loading.value = false;
        showErrorMsg(res.msg);
      }
    })
    .catch(function (error) {
      loading.value = false;
      console.log(error);
      showErrorMsg(error);
    });
}

// 关键词搜索数据
const getSearchData = async (targetTableId = "") => {
  loading.value = true;
  await postSearchTask(targetTableId);
};

const commit = () => {
  if (!api_key.value) {
    showErrorMsg("请输入API key");
    return;
  }
  if (activeName.value == "1") {
    const { url, radio, table_id } = formData.value;
    if (!url || !url.trim()) {
      showErrorMsg("请输入博主主页链接");
      return;
    }
    if (radio === 2 && !table_id) {
      showErrorMsg("请选择现有表格");
      return;
    }
    getProfileData(radio === 2 ? table_id : "");
    //
    bitable.bridge.setData("profile_url", formData.value.url);
  } else if (activeName.value == "2") {
    const { social_type, keyword, radio, table_id } = formData1.value;
    if (!social_type || !social_type.trim()) {
      showErrorMsg("请选择平台");
      return;
    }
    if (!keyword || !keyword.trim()) {
      showErrorMsg("请输入关键词");
      return;
    }
    if (radio === 2 && !table_id) {
      showErrorMsg("请选择现有表格");
      return;
    }
    getSearchData(radio === 2 ? table_id : "");
    //
    bitable.bridge.setData("search_platform", formData1.value.social_type);
    bitable.bridge.setData("search_keyword", formData1.value.keyword);
  }
};

onUnmounted(() => {
  profile_timer.value && clearInterval(profile_timer.value);
  search_timer.value && clearInterval(search_timer.value);
});
</script>

<template>
  <div class="key-box">
    <div class="key-title">
      <div>
        API key 设置
        <a class="key-url" href="https://52choujiang.com/assistant" target="_blank">获取API秘钥</a>
      </div>
      <img src="https://cdn.zhinizhushou.com/material/20250826/7cbcdd6c440e86fdf51c553973211e54.png"
        style="width: 16px; height: 16px; cursor: pointer" alt="" @click="api_key_disabled = !api_key_disabled" />
    </div>
    <el-input type="password" v-model="api_key" class="key-input" placeholder="" :disabled="api_key_disabled"
      show-password />
    <div v-if="!api_key_disabled" class="key-save-btn" @click="saveApiKey">
      <img src="https://cdn.zhinizhushou.com/material/20250826/2db36bfc55033175693a18a5f927d938.png"
        style="width: 14px; height: 14px; margin-right: 8px" />
      保存
    </div>
  </div>
  <div class="create-box">
    <el-tabs v-model="activeName" class="create-tabs" @tab-click="handleClick">
      <el-tab-pane label="主页批量获取" name="1">
        <el-form ref="form" class="form" :model="formData" label-position="top">
          <el-form-item label="" style="margin-top: 12px">
            <el-radio-group v-model="formData.radio">
              <el-radio :value="1">新建表格</el-radio>
              <el-radio :value="2">使用现有表格</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item v-if="formData.radio === 2" label="">
            <div slot="label" class="c-label">选择现有表格</div>
            <el-select v-model="formData.table_id" placeholder="请选择" style="width: 100%">
              <el-option v-for="tl in table_options" :key="tl.id" :label="tl.name" :value="tl.id" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <div slot="label" class="c-label">
              博主主页链接
              <el-tooltip effect="dark" placement="top">
                <template #content>仅支持博主主页链接，<br />不支持其他链接</template>
                <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png"
                  class="help-icon" />
              </el-tooltip>
            </div>
            <el-input v-model="formData.url" class="c-input" placeholder="" />
          </el-form-item>
          <el-form-item label="">
            <div slot="label" class="c-label">
              数据提取范围
              <el-tooltip effect="dark" placement="top">
                <template #content>每页 50 积分，实际扣费会按照<br />提取的页数进行计算</template>
                <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png"
                  class="help-icon" />
              </el-tooltip>
            </div>
            <el-select v-model="formData.pages" placeholder="请选择" style="width: 100%">
              <el-option v-for="tl in pages_options" :key="tl.value" :label="tl.label" :value="tl.value" />
            </el-select>
          </el-form-item>
        </el-form>
      </el-tab-pane>
      <el-tab-pane label="关键词搜索获取" name="2">
        <el-form ref="form" class="form" :model="formData1" label-position="top">
          <el-form-item label="" style="margin-top: 12px">
            <el-radio-group v-model="formData1.radio">
              <el-radio :value="1">新建表格</el-radio>
              <el-radio :value="2">使用现有表格</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item v-if="formData1.radio === 2" label="">
            <div slot="label" class="c-label">选择现有表格</div>
            <el-select v-model="formData1.table_id" placeholder="请选择" style="width: 100%">
              <el-option v-for="tl in table_options" :key="tl.id" :label="tl.name" :value="tl.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="">
            <div slot="label" class="c-label">
              平台
              <el-tooltip effect="dark" placement="top">
                <template #content>平台</template>
                <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png"
                  class="help-icon" />
              </el-tooltip>
            </div>
            <el-select v-model="formData1.social_type" placeholder="请选择" style="width: 100%">
              <el-option v-for="tl in social_type_options" :key="tl.value" :label="tl.label" :value="tl.value" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <div slot="label" class="c-label">
              关键词
              <el-tooltip effect="dark" placement="top">
                <template #content>关键词搜索</template>
                <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png"
                  class="help-icon" />
              </el-tooltip>
            </div>
            <el-input v-model="formData1.keyword" class="c-input" placeholder="请输入" />
          </el-form-item>
          <el-form-item label="">
            <div slot="label" class="c-label">
              排序方式
              <el-tooltip effect="dark" placement="top">
                <template #content>排序方式</template>
                <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png"
                  class="help-icon" />
              </el-tooltip>
            </div>
            <el-select v-model="formData1.sort_type" placeholder="请选择" style="width: 100%">
              <el-option v-if="isDouyin" v-for="tl in douyin_sort_type_options" :key="tl.value" :label="tl.label"
                :value="tl.value" />
              <el-option v-if="isXhs" v-for="tl in xhs_sort_type_options" :key="tl.value" :label="tl.label"
                :value="tl.value" />
            </el-select>
          </el-form-item>
          <el-form-item label="" v-if="isXhs">
            <div slot="label" class="c-label">
              笔记类型
              <el-tooltip effect="dark" placement="top">
                <template #content>笔记类型</template>
                <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png"
                  class="help-icon" />
              </el-tooltip>
            </div>
            <el-select v-model="formData1.filter_note_type" placeholder="请选择" style="width: 100%">
              <el-option v-for="tl in filter_note_type_options" :key="tl.value" :label="tl.label" :value="tl.value" />
            </el-select>
          </el-form-item>
          <el-form-item label="" v-if="isXhs">
            <div slot="label" class="c-label">
              发布时间
              <el-tooltip effect="dark" placement="top">
                <template #content>发布时间</template>
                <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png"
                  class="help-icon" />
              </el-tooltip>
            </div>
            <el-select v-model="formData1.filter_note_time" placeholder="请选择" style="width: 100%">
              <el-option v-for="tl in time_options" :key="tl.value" :label="tl.label" :value="tl.value" />
            </el-select>
          </el-form-item>
          <el-form-item label="" v-if="isDouyin">
            <div slot="label" class="c-label">
              发布时间
              <el-tooltip effect="dark" placement="top">
                <template #content>发布时间</template>
                <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png"
                  class="help-icon" />
              </el-tooltip>
            </div>
            <el-select v-model="formData1.publish_time" placeholder="请选择" style="width: 100%">
              <el-option v-for="tl in time_options" :key="tl.value" :label="tl.label" :value="tl.value" />
            </el-select>
          </el-form-item>
          <el-form-item label="" v-if="isDouyin">
            <div slot="label" class="c-label">
              筛选时长
              <el-tooltip effect="dark" placement="top">
                <template #content>筛选时长</template>
                <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png"
                  class="help-icon" />
              </el-tooltip>
            </div>
            <el-select v-model="formData1.filter_duration" placeholder="请选择" style="width: 100%">
              <el-option v-for="tl in filter_duration_options" :key="tl.value" :label="tl.label" :value="tl.value" />
            </el-select>
          </el-form-item>
          <el-form-item label="">
            <div slot="label" class="c-label">
              数据提取范围
              <el-tooltip effect="dark" placement="top">
                <template #content>每页 50 积分，实际扣费会按照<br />提取的页数进行计算</template>
                <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png"
                  class="help-icon" />
              </el-tooltip>
            </div>
            <el-select v-model="formData1.pages" placeholder="请选择" style="width: 100%">
              <el-option v-for="tl in (isXhs ? xhs_pages_options : pages_options)" :key="tl.value" :label="tl.label"
                :value="tl.value" />
            </el-select>
          </el-form-item>
        </el-form>
      </el-tab-pane>
    </el-tabs>

    <el-button color="#a8071a" class="commit-btn" :loading="loading" @click="commit">提交</el-button>
  </div>
</template>

<style scoped>
.key-box {
  padding: 20px 16px 0;
  box-sizing: border-box;
}

.key-box .key-title {
  font-size: 14px;
  font-weight: normal;
  line-height: 22px;
  letter-spacing: 0px;
  color: #1d2129;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.key-box .key-url {
  color: #165dff;
  text-decoration: none;
}

.key-box .key-input {
  width: 100%;
  margin-top: 24px;
}

.key-box .key-save-btn {
  background: #a8071a;
  width: 100%;
  height: 40px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 14px;
  margin-top: 24px;
  cursor: pointer;
}

.create-box {
  padding: 40px 16px 40px;
  box-sizing: border-box;
}

.form :deep(.el-form-item__label) {
  font-size: 14px;
  color: #1d2129;
  margin-bottom: 8px;
}

.form :deep(.el-form-item__content) {
  font-size: 14px;
}


.commit-btn {
  background: #a8071a;
  width: 100%;
  height: 40px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 14px;
  margin-top: 8px;
  cursor: pointer;
}

.c-label {
  display: flex;
  align-items: center;
}

.help-icon {
  width: 16px;
  height: 16px;
  margin-left: 4px;
}
</style>
