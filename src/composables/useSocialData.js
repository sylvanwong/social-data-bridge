import { bitable, FieldType, NumberFormatter } from "@lark-base-open/js-sdk";
import { ElMessage, ElNotification } from "element-plus";
import { ref, onUnmounted } from "vue";
import request from '@/utils/request'

export const FIELD_MAPPING = [
  { key: 'aweme_id', name: '视频编号', type: FieldType.Text },
  { key: 'title', name: '视频标题', type: FieldType.Text },
  { key: 'tags', name: '标签', type: FieldType.Text },
  { key: 'user_id', name: '用户ID', type: FieldType.Text },
  { key: 'nickname', name: '作者', type: FieldType.Text },
  { key: 'avatar', name: '博主头像', type: FieldType.Text },
  { key: 'note_type', name: '笔记类型', type: FieldType.Text },
  { key: 'digg_count', name: '点赞数', type: FieldType.Number, formatter: NumberFormatter.INTEGER },
  { key: 'comment_count', name: '评论数', type: FieldType.Number, formatter: NumberFormatter.INTEGER },
  { key: 'collect_count', name: '收藏数', type: FieldType.Number, formatter: NumberFormatter.INTEGER },
  { key: 'share_count', name: '分享数', type: FieldType.Number, formatter: NumberFormatter.INTEGER },
  { key: 'share_url', name: '视频链接', type: FieldType.Text },
  { key: 'play_url', name: '下载链接', type: FieldType.Text },
  { key: 'cover_url', name: '封面', type: FieldType.Text },
  { key: 'duration', name: '时长', type: FieldType.Number, formatter: NumberFormatter.INTEGER },
  { key: 'create_time', name: '发布时间', type: FieldType.DateTime, isTimestamp: true },
  { key: 'last_update_time', name: '最后更新时间', type: FieldType.DateTime, isTimestamp: true },
  { key: 'ctime', name: '提取时间', type: FieldType.DateTime, isTimestamp: true },
];

export const FIELD_TYPE_NAME = {
  [FieldType.Text]: 'Text',
  [FieldType.Number]: 'Number',
  [FieldType.DateTime]: 'DateTime',
  [FieldType.Url]: 'Url',
  [FieldType.Attachment]: 'Attachment',
};

export const showErrorMsg = (message) => {
  ElMessage({ message, type: "error", plain: true });
};

export const createSequentialTable = async (baseTableName) => {
  try {
    const existingTables = await bitable.base.getTableMetaList();
    const tableNames = existingTables.map(table => table.name);

    const existsBaseTable = tableNames.includes(baseTableName);
    const existsSequentialTable = tableNames.some(name => name.startsWith(`${baseTableName}`) && /\d+$/.test(name.slice(baseTableName.length)));
    if (!existsBaseTable && !existsSequentialTable) {
      const newTable = await bitable.base.addTable({ name: baseTableName });
      return newTable;
    }

    const reg = new RegExp(`^${baseTableName}(\\d+)$`);
    let maxIndex = 0;
    tableNames.forEach(name => {
      const match = name.match(reg);
      if (match) {
        const index = parseInt(match[1], 10);
        if (index > maxIndex) maxIndex = index;
      }
    });

    const newTableName = `${baseTableName}${maxIndex + 1}`;
    const newTable = await bitable.base.addTable({ name: newTableName });
    return newTable;
  } catch (error) {
    console.error("获取表格序号失败：", error);
    throw error;
  }
};

export const setupTableFields = async (tableId) => {
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
};

export const validateTableFields = async (tableId) => {
  try {
    const activeTable = await bitable.base.getTableById(tableId);
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
      ElNotification({ title: '出错', message: `主字段"视频编号"不存在于现有表格中，无法写入数据。请确保表格中包含该字段。`, type: 'error', duration: 0 });
      return false;
    }

    for (const item of fieldList) {
      if (item.field) {
        const fieldType = await item.field.getType();
        if (fieldType !== item.config.type) {
          ElNotification({ title: '出错', message: `字段类型不匹配:字段"${item.config.name}" 的类型是 ${FIELD_TYPE_NAME[fieldType] || fieldType}，但Schema定义为 ${FIELD_TYPE_NAME[item.config.type] || item.config.type}，无法写入数据`, type: 'error', duration: 0 });
          return false;
        }
      }
    }

    const availableFieldList = fieldList.filter(item => !!item.field);
    if (availableFieldList.length === 0) {
      showErrorMsg("所选表格没有可写入字段");
      return false;
    }

    return true;
  } catch (error) {
    console.error("验证表格字段时出错:", error);
    showErrorMsg("验证表格字段失败，请稍后重试");
    return false;
  }
};

export const useSocialData = (getTableName, api_key) => {
  const loading = ref(false);
  const profileProgress = ref({ text: "", done: false });
  const timer = ref(null);
  let page = 1;
  const page_size = 20;
  let total = 0;

  const resetParams = () => {
    loading.value = false;
    profileProgress.value = { text: "", done: false };
    page = 1;
    total = 0;
  };

  const pollTaskStatus = (task_id, checkFn, onSuccess) => {
    let time = 0;
    timer.value && clearInterval(timer.value);
    timer.value = setInterval(() => {
      time += 3;
      if (time >= 600) {
        clearInterval(timer.value);
        timer.value = null;
        showErrorMsg("获取数据超时，请稍后重试");
        loading.value = false;
      } else {
        checkFn(task_id, onSuccess);
      }
    }, 2000);
  };

  const closeInterval = () => {
    timer.value && clearInterval(timer.value);
    timer.value = null;
  };

  const getList = async (task_id, type, targetTableId = "") => {
    await request({
      url: "/social/api/v1/feishu/post/list",
      method: "post",
      headers: { 'authorization': `Bearer ${api_key}` },
      data: { task_id, page, page_size },
    })
      .then(function (response) {
        let res = response.data;
        if (res.sta == 0) {
          const { count, data } = res.data;
          if (!type) {
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

  const createAndWriteData = async (list, type, task_id, targetTableId = "") => {
    if (!list || list.length == 0) {
      ElMessage({ message: "获取数据异常，请稍后重试", type: "warning", plain: true });
      resetParams();
      return;
    }
    try {
      if (!type && !targetTableId) {
        const tableName = getTableName(list);
        const { tableId } = await createSequentialTable(tableName);
        await setupTableFields(tableId);
      }

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
        ElNotification({ title: '出错', message: `主字段"视频编号"不存在于现有表格中，无法写入数据。请确保表格中包含该字段。`, type: 'error', duration: 0 });
        resetParams();
        return;
      }

      for (const item of fieldList) {
        if (item.field) {
          const fieldType = await item.field.getType();
          if (fieldType !== item.config.type) {
            ElNotification({ title: '出错', message: `字段类型不匹配:字段"${item.config.name}" 的类型是 ${FIELD_TYPE_NAME[fieldType] || fieldType}，但Schema定义为 ${FIELD_TYPE_NAME[item.config.type] || item.config.type}，无法写入数据`, type: 'error', duration: 0 });
            resetParams();
            return;
          }
        }
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
      try {
        const tableName = getTableName(list);
        const { tableId: newTableId } = await createSequentialTable(tableName);
        await setupTableFields(newTableId);
        await createAndWriteData(list, type, task_id, newTableId);
        ElNotification({ title: '温馨提示', message: '当前多维表格已达到单表存储上限！已为您自动生成新表格展示全部数据', type: 'success', duration: 3000 });
        return;
      } catch (retryError) {
        console.error("🚀 ~ 创建新表重试写入失败:", retryError)
        const errorMsg = retryError?.message ? `写入失败：${retryError.message}` : "写入失败，请稍后重试";
        ElNotification({ title: '错误', message: errorMsg, type: 'error', duration: 0 });
        resetParams();
      }
    }
  };

  onUnmounted(() => {
    closeInterval();
  });

  return {
    loading,
    profileProgress,
    resetParams,
    pollTaskStatus,
    closeInterval,
    getList,
    createAndWriteData,
    validateTableFields,
  };
};
