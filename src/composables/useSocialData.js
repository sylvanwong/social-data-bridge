import { bitable, DateFormatter, FieldType, NumberFormatter } from "@lark-base-open/js-sdk";
import { ElMessage, ElNotification } from "element-plus";
import { ref, onUnmounted } from "vue";
import request from '@/utils/request'

export const FIELD_MAPPING = [
  { key: 'aweme_id', name: '视频编号', type: FieldType.Text, defaultSelected: true, required: true },
  { key: 'title', name: '视频标题', type: FieldType.Text, defaultSelected: true },
  { key: 'tags', name: '标签', type: FieldType.MultiSelect, defaultSelected: true },
  { key: 'user_id', name: '用户ID', type: FieldType.Text, defaultSelected: true },
  { key: 'nickname', name: '作者名称', legacyNames: ['作者'], type: FieldType.Text, defaultSelected: true },
  { key: "profile_url", name: "作者主页链接", type: FieldType.Url, defaultSelected: true},
  { key: 'avatar', name: '博主头像', type: FieldType.Text, defaultSelected: true },
  { key: 'note_type', name: '笔记类型', type: FieldType.Text, defaultSelected: true },
  { key: 'digg_count', name: '点赞数', type: FieldType.Number, defaultSelected: true, formatter: NumberFormatter.INTEGER },
  { key: 'comment_count', name: '评论数', type: FieldType.Number, defaultSelected: true, formatter: NumberFormatter.INTEGER },
  { key: 'collect_count', name: '收藏数', type: FieldType.Number, defaultSelected: true, formatter: NumberFormatter.INTEGER },
  { key: 'share_count', name: '分享数', type: FieldType.Number, defaultSelected: true, formatter: NumberFormatter.INTEGER },
  { key: 'social_type', name: '平台', type: FieldType.Text, defaultSelected: true },
  { key: 'share_url', name: '视频链接', type: FieldType.Text, defaultSelected: true },
  { key: 'play_url', name: '下载链接', type: FieldType.Text, defaultSelected: true },
  { key: 'cover_url', name: '封面', type: FieldType.Text, defaultSelected: true },
  { key: 'duration', name: '时长', type: FieldType.Number, defaultSelected: true, formatter: NumberFormatter.INTEGER },
  { key: 'create_time', name: '发布时间', type: FieldType.DateTime, defaultSelected: true, isTimestamp: true, dateFormat: DateFormatter.DATE_TIME },
  { key: 'last_update_time', name: '最后更新时间', type: FieldType.DateTime, defaultSelected: true, isTimestamp: true, dateFormat: DateFormatter.DATE_TIME },
  { key: 'ctime', name: '提取时间', type: FieldType.DateTime, defaultSelected: true, isTimestamp: true, dateFormat: DateFormatter.DATE_TIME },
];

export const FIELD_TYPE_NAME = {
  [FieldType.Text]: '文本',
  [FieldType.Number]: '数字',
  [FieldType.SingleSelect]: '单选',
  [FieldType.MultiSelect]: '多选',
  [FieldType.DateTime]: '日期时间',
  [FieldType.Url]: '链接',
  [FieldType.Attachment]: '附件',
};

const getAllowedFieldTypes = (config) => {
  if (config.key === 'nickname' || config.key === 'note_type' || config.key === 'social_type') {
    return [FieldType.Text, FieldType.SingleSelect];
  }
  if (config.key === 'profile_url') {
    return [FieldType.Text, FieldType.Url];
  }
  if (config.key === 'tags') {
    return [FieldType.Text, FieldType.MultiSelect];
  }
  return [config.type];
};

const isFieldTypeCompatible = (fieldType, config) => {
  return getAllowedFieldTypes(config).includes(fieldType);
};

const getExpectedFieldTypeName = (config) => {
  return getAllowedFieldTypes(config)
    .map(type => FIELD_TYPE_NAME[type] || type)
    .join('、');
};

const normalizeTextCompatibleValue = (value) => {
  return value ?? "";
};

const normalizeSelectCompatibleValue = (value) => {
  if (!value) {
    return null;
  }
  return String(value).trim() || null;
};

const splitTags = (value) => {
  if (Array.isArray(value)) {
    return value
      .map(item => typeof item === 'string' ? item.trim() : '')
      .filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(/\s+/)
      .map(item => item.trim())
      .filter(Boolean);
  }

  return [];
};

const ensureTagOptions = async (field, list, config, fieldType) => {
  if (config.key !== 'tags' || fieldType !== FieldType.MultiSelect) {
    return null;
  }

  const tagSet = new Set();
  for (const item of list) {
    for (const tag of splitTags(item?.[config.key])) {
      tagSet.add(tag);
    }
  }

  if (tagSet.size === 0) {
    return new Map();
  }

  const existingOptions = await field.getOptions();
  const existingNames = new Set(existingOptions.map(option => option.name));
  const missingOptions = [...tagSet]
    .filter(tag => !existingNames.has(tag))
    .map(tag => ({ name: tag }));

  if (missingOptions.length > 0) {
    await field.addOptions(missingOptions);
  }

  const latestOptions = await field.getOptions();
  return new Map(latestOptions.map(option => [option.name, option.id]));
};

const normalizeTagsCompatibleValue = (value, fieldType, tagOptionIdMap = null) => {
  const tags = splitTags(value);

  if (fieldType === FieldType.MultiSelect) {
    if (!tagOptionIdMap) {
      return tags.length ? tags : [];
    }

    const optionValues = tags
      .map(tag => {
        const optionId = tagOptionIdMap.get(tag);
        return optionId ? { id: optionId, text: tag } : null;
      })
      .filter(Boolean);

    return optionValues.length ? optionValues : [];
  }

  return tags.join(' ');
};

const normalizeCellValue = async (table, field, value, config, fieldType, extra = {}) => {
  let nextValue = value;
  if (config.isTimestamp && nextValue) {
    nextValue = nextValue * 1000;
  }

  if ((config.key === 'nickname' || config.key === 'note_type' || config.key === 'social_type') && fieldType === FieldType.SingleSelect) {
    return normalizeSelectCompatibleValue(nextValue);
  }

  if (config.key === 'tags') {
    return normalizeTagsCompatibleValue(nextValue, fieldType, extra.tagOptionIdMap);
  }

  return normalizeTextCompatibleValue(nextValue);
};

const applyFieldDisplayConfig = async (field, config) => {
  if (config.formatter) {
    await field.setFormatter(config.formatter);
  }
  if (config.dateFormat) {
    await field.setDateFormat(config.dateFormat);
  }
};

const getFieldCandidateNames = (config) => [config.name, ...(config.legacyNames || [])];

const resolveFieldMetaByConfig = (fieldMetaMap, config) => {
  for (const candidateName of getFieldCandidateNames(config)) {
    const fieldMeta = fieldMetaMap.get(candidateName);
    if (fieldMeta) {
      return {
        matchedName: candidateName,
        fieldMeta
      };
    }
  }

  return null;
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

export const setupTableFields = async (tableId, selectedFieldKeys = []) => {
  const newTable = await bitable.base.getTable(tableId);
  await bitable.ui.switchToTable(tableId);
  const first_field = await newTable.getField('文本');
  const activeFieldMapping = getActiveFieldMapping(selectedFieldKeys);
  const fieldPromises = activeFieldMapping.map((config, index) => {
    if (index === 0 && first_field) {
      return newTable.setField(first_field.id, { type: config.type, name: config.name });
    }
    return newTable.addField({ type: config.type, name: config.name });
  });
  await Promise.all(fieldPromises);

  for (const config of activeFieldMapping) {
    try {
      const field = await newTable.getField(config.name);
      if (field) {
        await applyFieldDisplayConfig(field, config);
      }
    } catch (error) {
      console.error(`设置字段 ${config.name} 格式失败:`, error);
    }
  }
};

export const validateTableFields = async (tableId, selectedFieldKeys = []) => {
  try {
    const activeTable = await bitable.base.getTableById(tableId);
    const fieldMetaList = await activeTable.getFieldMetaList();
    const fieldMetaByName = new Map(fieldMetaList.map(meta => [meta.name, meta]));
    const activeFieldMapping = getActiveFieldMapping(selectedFieldKeys);

    const fieldList = [];
    const missingFields = [];
    for (const config of activeFieldMapping) {
      const matchedField = resolveFieldMetaByConfig(fieldMetaByName, config);
      if (!matchedField?.fieldMeta?.id) {
        missingFields.push(config);
        continue;
      }
      try {
        const field = await activeTable.getFieldById(matchedField.fieldMeta.id);
        fieldList.push({ field, config });
      } catch (error) {
        console.error(`获取字段失败：${config.name}`, error);
        missingFields.push(config);
      }
    }

    for (const item of fieldList) {
      if (item.field) {
        const fieldType = await item.field.getType();
        item.fieldType = fieldType;
        if (!isFieldTypeCompatible(fieldType, item.config)) {
          ElNotification({ title: '出错', message: `字段"${item.config.name}" 类型不匹配，仅支持${getExpectedFieldTypeName(item.config)}类型，请修改后，点击插件顶部右上角关闭按钮，再重新进入操作`, type: 'error', duration: 0 });
          return false;
        }
      }
    }

    for (const config of missingFields) {
      try {
        await activeTable.addField({ type: config.type, name: config.name });
      } catch (error) {
        ElNotification({ title: '出错', message: `添加字段 "${config.name}" 失败`, type: 'error', duration: 0 });
        return false;
      }
    }

    if (missingFields.length > 0) {
      ElNotification({ title: '成功', message: `已自动添加 ${missingFields.length} 个字段`, type: 'success' });
    }

    const refreshedFieldMetaList = await activeTable.getFieldMetaList();
    const refreshedFieldMetaByName = new Map(refreshedFieldMetaList.map(meta => [meta.name, meta]));
    for (const config of activeFieldMapping) {
      const matchedField = resolveFieldMetaByConfig(refreshedFieldMetaByName, config);
      const fieldId = matchedField?.fieldMeta?.id;
      if (!fieldId) continue;
      try {
        const field = await activeTable.getFieldById(fieldId);
        await applyFieldDisplayConfig(field, config);
      } catch (error) {
        console.error(`设置字段 ${config.name} 格式失败:`, error);
      }
    }

    const availableFieldList = [...fieldList, ...missingFields.map(config => ({ field: true, config }))];
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

export const getDefaultSelectedFieldKeys = () => FIELD_MAPPING
  .filter(field => field.defaultSelected || field.required)
  .map(field => field.key);

export const getActiveFieldMapping = (selectedFieldKeys = []) => {
  const selectedKeySet = new Set(selectedFieldKeys);
  return FIELD_MAPPING.filter(field => field.required || selectedKeySet.has(field.key));
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

  const getList = async (task_id, type, targetTableId = "", selectedFieldKeys = []) => {
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
            createAndWriteData(data, '', task_id, targetTableId, selectedFieldKeys);
          } else if (type == 'next') {
            createAndWriteData(data, type, task_id, targetTableId, selectedFieldKeys);
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

  const createAndWriteData = async (list, type, task_id, targetTableId = "", selectedFieldKeys = []) => {
    if (!list || list.length == 0) {
      ElMessage({ message: "获取数据异常，请稍后重试", type: "warning", plain: true });
      resetParams();
      return;
    }
    const activeFieldMapping = getActiveFieldMapping(selectedFieldKeys);

    try {
      if (!type && !targetTableId) {
        const tableName = getTableName(list);
        const { tableId } = await createSequentialTable(tableName);
        await setupTableFields(tableId, selectedFieldKeys);
      }

      const activeTable = targetTableId
        ? await bitable.base.getTableById(targetTableId)
        : await bitable.base.getActiveTable();
      const fieldMetaList = await activeTable.getFieldMetaList();
      const fieldMetaByName = new Map(fieldMetaList.map(meta => [meta.name, meta]));
      const fieldList = [];
      for (const config of activeFieldMapping) {
        const matchedField = resolveFieldMetaByConfig(fieldMetaByName, config);
        const fieldId = matchedField?.fieldMeta?.id;
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

      for (const item of fieldList) {
        if (item.field) {
          const fieldType = await item.field.getType();
          item.fieldType = fieldType;
          if (!isFieldTypeCompatible(fieldType, item.config)) {
            ElNotification({ title: '出错', message: `字段"${item.config.name}" 类型不匹配，仅支持${getExpectedFieldTypeName(item.config)}类型，请修改后，点击插件顶部右上角关闭按钮，再重新进入操作`, type: 'error', duration: 0 });
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

      for (const item of availableFieldList) {
        item.extra = {};
        if (item.config.key === 'tags') {
          item.extra.tagOptionIdMap = await ensureTagOptions(item.field, list, item.config, item.fieldType);
        }
        try {
          await applyFieldDisplayConfig(item.field, item.config);
        } catch (error) {
          console.error(`设置字段 ${item.config.name} 格式失败:`, error);
        }
      }

      let records = [];
      for (const item of list) {
        let record = [];
        for (const { field, config, fieldType } of availableFieldList) {
          const matchedField = availableFieldList.find(fieldItem => fieldItem.field?.id === field.id && fieldItem.config.key === config.key);
          const value = await normalizeCellValue(activeTable, field, item[config.key], config, fieldType, matchedField?.extra);
          record.push(await field.createCell(value));
        }
        records.push(record);
      }
      const recordIds = await activeTable.addRecords(records);

      if (total > page) {
        page += 1;
        getList(task_id, 'next', targetTableId, selectedFieldKeys);
        return;
      } else {
        resetParams();
      }
    } catch (error) {
      console.error("🚀 ~ createAndWriteData ~ error:", error)
      try {
        const tableName = getTableName(list);
        const { tableId: newTableId } = await createSequentialTable(tableName);
        await setupTableFields(newTableId, selectedFieldKeys);
        await createAndWriteData(list, type, task_id, newTableId, selectedFieldKeys);
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
