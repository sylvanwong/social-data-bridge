import { bitable, DateFormatter, FieldType, NumberFormatter } from "@lark-base-open/js-sdk";
import { ElMessage, ElNotification } from "element-plus";
import { ref, onUnmounted } from "vue";
import request, { buildApiUrl } from '@/utils/request'

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

export const KEYWORD_SEARCH_FIELD_MAPPING = [
  { key: 'nickname', name: '作者名称', legacyNames: ['作者'], type: FieldType.Text, defaultSelected: true },
  { key: 'user_id', name: '作者ID', legacyNames: ['用户ID'], type: FieldType.Text, defaultSelected: true },
  { key: 'profile_url', name: '作者主页链接', type: FieldType.Url, defaultSelected: true },
  { key: 'avatar', name: '作者头像', legacyNames: ['博主头像'], type: FieldType.Text, defaultSelected: true },
  { key: 'social_type', name: '平台', type: FieldType.Text, defaultSelected: true },
  { key: 'aweme_id', name: '作品ID', legacyNames: ['视频编号'], type: FieldType.Text, defaultSelected: true, required: true },
  { key: 'note_type', name: '作品类型', legacyNames: ['笔记类型'], type: FieldType.Text, defaultSelected: true },
  { key: 'title', name: '标题', legacyNames: ['视频标题'], type: FieldType.Text, defaultSelected: true },
  { key: 'content', name: '正文', valueKeys: ['content', 'desc', 'description'], type: FieldType.Text, defaultSelected: true },
  { key: 'tags', name: '标签', type: FieldType.MultiSelect, defaultSelected: true },
  { key: 'duration', name: '视频时长', legacyNames: ['时长'], type: FieldType.Number, defaultSelected: true, formatter: NumberFormatter.INTEGER },
  { key: 'digg_count', name: '点赞数', type: FieldType.Number, defaultSelected: true, formatter: NumberFormatter.INTEGER },
  { key: 'comment_count', name: '评论数', type: FieldType.Number, defaultSelected: true, formatter: NumberFormatter.INTEGER },
  { key: 'collect_count', name: '收藏数', type: FieldType.Number, defaultSelected: true, formatter: NumberFormatter.INTEGER },
  { key: 'share_count', name: '分享数', type: FieldType.Number, defaultSelected: true, formatter: NumberFormatter.INTEGER },
  { key: 'share_url', name: '作品链接', legacyNames: ['视频链接'], type: FieldType.Text, defaultSelected: true },
  { key: 'cover_url', name: '封面链接', legacyNames: ['封面'], type: FieldType.Text, defaultSelected: true },
  { key: 'cover_attachment', name: '封面附件', type: FieldType.Attachment, defaultSelected: true, getUrls: (item) => item?.cover_url ? [item.cover_url] : [], getFileName: () => 'cover' },
  { key: 'play_url', name: '下载链接', type: FieldType.Text, defaultSelected: true },
  { key: 'create_time', name: '发布时间', type: FieldType.DateTime, defaultSelected: true, isTimestamp: true, dateFormat: DateFormatter.DATE_TIME },
  { key: 'last_update_time', name: '更新时间', legacyNames: ['最后更新时间'], type: FieldType.DateTime, defaultSelected: true, isTimestamp: true, dateFormat: DateFormatter.DATE_TIME },
  { key: 'ctime', name: '提取时间', type: FieldType.DateTime, defaultSelected: true, isTimestamp: true, dateFormat: DateFormatter.DATE_TIME },
];

export const PROFILE_FIELD_MAPPING = [
  { key: 'nickname', name: '作者名称', legacyNames: ['作者'], type: FieldType.Text, defaultSelected: true },
  { key: 'user_id', name: '作者ID', legacyNames: ['用户ID'], type: FieldType.Text, defaultSelected: true },
  { key: 'profile_url', name: '作者主页链接', type: FieldType.Url, defaultSelected: true },
  { key: 'avatar', name: '作者头像', legacyNames: ['博主头像'], type: FieldType.Text, defaultSelected: true },
  { key: 'social_type', name: '平台', type: FieldType.Text, defaultSelected: true },
  { key: 'aweme_id', name: '作品ID', legacyNames: ['视频编号'], type: FieldType.Text, defaultSelected: true, required: true },
  { key: 'note_type', name: '作品类型', legacyNames: ['笔记类型'], type: FieldType.Text, defaultSelected: true },
  { key: 'title', name: '标题', legacyNames: ['视频标题'], type: FieldType.Text, defaultSelected: true },
  { key: 'content', name: '正文', type: FieldType.Text, defaultSelected: true },
  { key: 'tags', name: '标签', type: FieldType.MultiSelect, defaultSelected: true },
  { key: 'duration', name: '视频时长', legacyNames: ['时长'], type: FieldType.Number, defaultSelected: true, formatter: NumberFormatter.INTEGER },
  { key: 'digg_count', name: '点赞数', type: FieldType.Number, defaultSelected: true, formatter: NumberFormatter.INTEGER },
  { key: 'comment_count', name: '评论数', type: FieldType.Number, defaultSelected: true, formatter: NumberFormatter.INTEGER },
  { key: 'collect_count', name: '收藏数', type: FieldType.Number, defaultSelected: true, formatter: NumberFormatter.INTEGER },
  { key: 'share_count', name: '分享数', type: FieldType.Number, defaultSelected: true, formatter: NumberFormatter.INTEGER },
  { key: 'share_url', name: '作品链接', legacyNames: ['视频链接'], type: FieldType.Text, defaultSelected: true },
  { key: 'cover_url', name: '封面链接', legacyNames: ['封面'], type: FieldType.Text, defaultSelected: true },
  { key: 'cover_attachment', name: '封面附件', type: FieldType.Attachment, defaultSelected: true, getUrls: (item) => item?.cover_url ? [item.cover_url] : [], getFileName: () => 'cover' },
  { key: 'play_url', name: '下载链接', type: FieldType.Text, defaultSelected: true },
  { key: 'create_time', name: '发布时间', type: FieldType.DateTime, defaultSelected: true, isTimestamp: true, dateFormat: DateFormatter.DATE_TIME },
  { key: 'last_update_time', name: '更新时间', legacyNames: ['最后更新时间'], type: FieldType.DateTime, defaultSelected: true, isTimestamp: true, dateFormat: DateFormatter.DATE_TIME },
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

const ATTACHMENT_DOWNLOAD_TIMEOUT = 30000;

const httpToHttps = (url) => typeof url === 'string' ? url.replace(/^http:\/\//i, 'https://') : url;

const getAttachmentUrls = (config, item) => {
  let urls = config.getUrls?.(item) || [];
  if (typeof urls === 'string') urls = [urls];
  if (!Array.isArray(urls)) return [];
  return urls.filter(url => typeof url === 'string' && url).map(httpToHttps);
};

const getAttachmentFileName = (url, baseName, index, total) => {
  const extension = url.match(/\.([a-zA-Z0-9]{2,5})(?:\?|$)/)?.[1];
  const prefix = total > 1 ? `${index + 1}_` : '';
  return `${prefix}${baseName || 'attachment'}.${extension || 'jpg'}`;
};

const getBlobExtension = (blob) => ({
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/heif': 'heic',
}[String(blob.type || '').split(';')[0].trim().toLowerCase()]);

const downloadAttachmentAsFile = async (url, fileName, apiKey) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ATTACHMENT_DOWNLOAD_TIMEOUT);
  const proxyUrl = buildApiUrl(`/social/api/v1/feishu/xhs_download_proxy?${new URLSearchParams({ url, file_name: fileName }).toString()}`);
  const download = async (requestUrl, useProxy = false) => {
    const response = await fetch(requestUrl, {
      signal: controller.signal,
      ...(useProxy ? { headers: { authorization: `Bearer ${apiKey}` } } : {}),
    });
    if (!response.ok) throw new Error(`下载失败: HTTP ${response.status}`);
    const blob = await response.blob();
    const extension = getBlobExtension(blob);
    const normalizedName = extension ? fileName.replace(/\.[a-zA-Z0-9]{2,5}$/, `.${extension}`) : fileName;
    return new File([blob], normalizedName, { type: blob.type || 'application/octet-stream' });
  };

  try {
    try {
      return await download(url);
    } catch (error) {
      if (controller.signal.aborted) throw new Error(`附件下载超时（${ATTACHMENT_DOWNLOAD_TIMEOUT / 1000} 秒）`);
      return await download(proxyUrl, true);
    }
  } finally {
    clearTimeout(timeoutId);
  }
};

const createAttachmentFiles = async (config, item, apiKey) => {
  const urls = getAttachmentUrls(config, item);
  const results = await Promise.allSettled(urls.map((url, index) =>
    downloadAttachmentAsFile(url, getAttachmentFileName(url, config.getFileName?.(item), index, urls.length), apiKey)
  ));

  return results.flatMap(result => {
    if (result.status === 'fulfilled') return [result.value];
    console.warn('附件下载失败，跳过附件写入:', result.reason);
    return [];
  });
};

const normalizeCellValue = async (table, field, value, config, fieldType, extra = {}, item, apiKey) => {
  if (config.type === FieldType.Attachment) {
    const files = await createAttachmentFiles(config, item, apiKey);
    return files.length === 1 ? files[0] : files;
  }

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

const normalizeUniqueKeyPart = (value) => {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(normalizeUniqueKeyPart).filter(Boolean).join(',');
  if (typeof value === 'object') return normalizeUniqueKeyPart(value.text ?? value.name ?? value.value ?? '');
  return String(value).trim().toLowerCase();
};

const buildWorkUniqueKey = (awemeId) => normalizeUniqueKeyPart(awemeId);

const chunkRecords = (records, size = 200) => {
  const chunks = [];
  for (let index = 0; index < records.length; index += size) {
    chunks.push(records.slice(index, index + size));
  }
  return chunks;
};

export const showErrorMsg = (message) => {
  ElMessage({ message, type: "error", plain: true });
};

const escapeRegExp = (value) => {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

const normalizeTableName = (value) => {
  const fallback = '社媒数据助手';
  const normalized = String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return (normalized || fallback).slice(0, 80);
};

export const createSequentialTable = async (baseTableName) => {
  try {
    const safeBaseTableName = normalizeTableName(baseTableName);
    const existingTables = await bitable.base.getTableMetaList();
    const tableNames = existingTables.map(table => table.name);

    const existsBaseTable = tableNames.includes(safeBaseTableName);
    const existsSequentialTable = tableNames.some(name => name.startsWith(`${safeBaseTableName}`) && /\d+$/.test(name.slice(safeBaseTableName.length)));
    if (!existsBaseTable && !existsSequentialTable) {
      const newTable = await bitable.base.addTable({ name: safeBaseTableName });
      return newTable;
    }

    const reg = new RegExp(`^${escapeRegExp(safeBaseTableName)}(\\d+)$`);
    let maxIndex = 0;
    tableNames.forEach(name => {
      const match = name.match(reg);
      if (match) {
        const index = parseInt(match[1], 10);
        if (index > maxIndex) maxIndex = index;
      }
    });

    const newTableName = `${safeBaseTableName}${maxIndex + 1}`;
    const newTable = await bitable.base.addTable({ name: newTableName });
    return newTable;
  } catch (error) {
    console.error("获取表格序号失败：", error);
    throw error;
  }
};

export const setupTableFields = async (tableId, selectedFieldKeys = [], fieldMapping = FIELD_MAPPING) => {
  const newTable = await bitable.base.getTable(tableId);
  await bitable.ui.switchToTable(tableId);
  const first_field = await newTable.getField('文本');
  const activeFieldMapping = getActiveFieldMapping(selectedFieldKeys, fieldMapping);
  for (const [index, config] of activeFieldMapping.entries()) {
    if (index === 0 && first_field) {
      await newTable.setField(first_field.id, { type: config.type, name: config.name });
    } else {
      await newTable.addField({ type: config.type, name: config.name });
    }
  }

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

export const validateTableFields = async (tableId, selectedFieldKeys = [], fieldMapping = FIELD_MAPPING, options = {}) => {
  try {
    const activeTable = await bitable.base.getTableById(tableId);
    const fieldMetaList = await activeTable.getFieldMetaList();
    const fieldMetaByName = new Map(fieldMetaList.map(meta => [meta.name, meta]));
    const fieldMetaById = new Map(fieldMetaList.map(meta => [meta.id, meta]));
    const explicitMappings = new Map(
      (options.fieldMappings || [])
        .filter(item => item?.source_key && item?.target_field_id)
        .map(item => [item.source_key, item])
    );
    const activeFieldMapping = getActiveFieldMapping(selectedFieldKeys, fieldMapping);
    if (options.writeMode === 'upsert') {
      for (const key of ['aweme_id']) {
        const config = fieldMapping.find(item => item.key === key);
        if (config && !activeFieldMapping.some(item => item.key === key)) activeFieldMapping.push(config);
      }
    }

    const fieldList = [];
    const missingFields = [];
    for (const config of activeFieldMapping) {
      const explicitMapping = explicitMappings.get(config.key);
      const matchedField = explicitMapping?.target_field_id
        ? { fieldMeta: fieldMetaById.get(explicitMapping.target_field_id) }
        : resolveFieldMetaByConfig(fieldMetaByName, config);
      if (explicitMapping?.target_field_id && !matchedField.fieldMeta) {
        throw new Error(`字段“${config.name}”映射的目标字段不存在`);
      }
      if (!matchedField?.fieldMeta?.id) {
        // 显式映射的字段由 target_field_id 指定，不能按源字段名自动补列。
        if (!explicitMapping) missingFields.push(config);
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
    const refreshedFieldMetaById = new Map(refreshedFieldMetaList.map(meta => [meta.id, meta]));
    for (const config of activeFieldMapping) {
      const explicitMapping = explicitMappings.get(config.key);
      const matchedField = explicitMapping?.target_field_id
        ? { fieldMeta: refreshedFieldMetaById.get(explicitMapping.target_field_id) }
        : resolveFieldMetaByConfig(refreshedFieldMetaByName, config);
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

export const getDefaultSelectedFieldKeys = (fieldMapping = FIELD_MAPPING) => fieldMapping
  .filter(field => field.defaultSelected || field.required)
  .map(field => field.key);

export const getActiveFieldMapping = (selectedFieldKeys = [], fieldMapping = FIELD_MAPPING) => {
  const selectedKeySet = new Set(selectedFieldKeys);
  return fieldMapping.filter(field => field.required || selectedKeySet.has(field.key));
};

export const useSocialData = (getTableName, api_key, fieldMapping = FIELD_MAPPING) => {
  const loading = ref(false);
  const profileProgress = ref({ text: "", done: false });
  const timer = ref(null);
  let page = 1;
  const page_size = 20;
  let total = 0;
  const upsertIndexCache = new Map();

  const resetParams = () => {
    loading.value = false;
    profileProgress.value = { text: "", done: false };
    page = 1;
    total = 0;
    upsertIndexCache.clear();
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
        showErrorMsg(error.message || '请求失败');
      });
  };

  const createAndWriteData = async (list, type, task_id, targetTableId = "", selectedFieldKeys = [], options = {}) => {
    if (!list || list.length == 0) {
      ElMessage({ message: "获取数据异常，请稍后重试", type: "warning", plain: true });
      resetParams();
      return;
    }
    const selectedFieldMapping = getActiveFieldMapping(selectedFieldKeys, fieldMapping);
    const keyConfigs = options.writeMode === 'upsert'
      ? ['aweme_id'].map(key => fieldMapping.find(config => config.key === key)).filter(Boolean)
      : [];
    const activeFieldMapping = [...selectedFieldMapping];
    for (const keyConfig of keyConfigs) {
      if (!activeFieldMapping.some(config => config.key === keyConfig.key)) {
        activeFieldMapping.push(keyConfig);
      }
    }

    try {
      let resolvedTargetTableId = targetTableId;
      if (!type && !resolvedTargetTableId) {
        const tableName = getTableName(list);
        const { tableId } = await createSequentialTable(tableName);
        await setupTableFields(tableId, selectedFieldKeys, fieldMapping);
        resolvedTargetTableId = tableId;
        await options.onTargetTableReady?.(tableId);
      }

      const activeTable = resolvedTargetTableId
        ? await bitable.base.getTableById(resolvedTargetTableId)
        : await bitable.base.getActiveTable();
      let fieldMetaList = await activeTable.getFieldMetaList();
      let fieldMetaByName = new Map(fieldMetaList.map(meta => [meta.name, meta]));
      let fieldMetaById = new Map(fieldMetaList.map(meta => [meta.id, meta]));
      const explicitMappings = new Map(
        (options.fieldMappings || [])
          .filter(item => item?.source_key && item?.target_field_id)
          .map(item => [item.source_key, item])
      );

      if (options.writeMode === 'upsert') {
        for (const config of keyConfigs) {
          const explicitMapping = explicitMappings.get(config.key);
          if (explicitMapping?.target_field_id && !fieldMetaById.has(explicitMapping.target_field_id)) {
            throw new Error(`唯一键字段“${config.name}”映射的目标字段不存在`);
          }
          if (!explicitMapping && !resolveFieldMetaByConfig(fieldMetaByName, config)?.fieldMeta?.id) {
            await activeTable.addField({ type: config.type, name: config.name });
          }
        }
        fieldMetaList = await activeTable.getFieldMetaList();
        fieldMetaByName = new Map(fieldMetaList.map(meta => [meta.name, meta]));
        fieldMetaById = new Map(fieldMetaList.map(meta => [meta.id, meta]));
      }
      const fieldList = [];
      for (const config of activeFieldMapping) {
        const explicitMapping = explicitMappings.get(config.key);
        const matchedField = explicitMapping?.target_field_id
          ? { matchedName: explicitMapping.target_field_name || '', fieldMeta: fieldMetaById.get(explicitMapping.target_field_id) }
          : resolveFieldMetaByConfig(fieldMetaByName, config);
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
      let normalizedRecords = [];
      for (const item of list) {
        let record = [];
        let normalizedRecord = {};
        for (const { field, config, fieldType } of availableFieldList) {
          const matchedField = availableFieldList.find(fieldItem => fieldItem.field?.id === field.id && fieldItem.config.key === config.key);
          const valueKeys = config.valueKeys || [config.key];
          const sourceValue = valueKeys.reduce((value, key) => value ?? item?.[key], undefined);
          const value = await normalizeCellValue(activeTable, field, sourceValue, config, fieldType, matchedField?.extra, item, api_key);
          const cell = await field.createCell(value);
          record.push(cell);
          normalizedRecord[field.id] = config.type === FieldType.Attachment ? await cell.getValue() : value;
        }
        records.push(record);
        normalizedRecords.push(normalizedRecord);
      }
      let recordIds = [];
      if (options.writeMode === 'upsert') {
        const keyFields = keyConfigs.map(config => availableFieldList.find(item => item.config.key === config.key)?.field);
        if (!keyFields.every(Boolean)) {
          throw new Error('未找到“作品ID”字段，无法执行更新或新增');
        }

        const uniqueRecords = new Map();
        let skippedCount = 0;
        list.forEach((item, index) => {
          const key = buildWorkUniqueKey(item?.aweme_id);
          if (!key) {
            skippedCount += 1;
            return;
          }
          uniqueRecords.set(key, { record: records[index], fields: normalizedRecords[index] });
        });
        if (skippedCount > 0) {
          ElMessage({ message: `${skippedCount} 条作品缺少作品ID，未写入`, type: 'warning', plain: true });
        }

        const indexCache = options.upsertIndex || upsertIndexCache;
        const cacheKey = `${options.upsertCacheKey || 'default'}:${activeTable.id}:${keyFields.map(field => field.id).join(':')}`;
        let existingByKey = indexCache.get(cacheKey);
        if (!existingByKey) {
          existingByKey = new Map();
          let pageToken;
          do {
            const response = await activeTable.getRecordsByPage({ pageSize: 200, pageToken });
            (response.records || []).forEach(existing => {
              const key = buildWorkUniqueKey(existing.fields?.[keyFields[0].id]);
              if (key) existingByKey.set(key, existing.recordId);
            });
            pageToken = response.hasMore ? response.pageToken : undefined;
          } while (pageToken !== undefined);
          indexCache.set(cacheKey, existingByKey);
        }

        const pendingUpdates = [];
        const pendingCreates = [];
        uniqueRecords.forEach(({ record, fields }, key) => {
          const recordId = existingByKey.get(key);
          if (recordId) {
            pendingUpdates.push({ recordId, fields });
          } else {
            pendingCreates.push({ key, record });
          }
        });

        for (const updates of chunkRecords(pendingUpdates)) {
          const updated = await activeTable.setRecords(updates);
          recordIds = recordIds.concat(updated.map(record => record.recordId));
        }
        for (const creates of chunkRecords(pendingCreates)) {
          const created = await activeTable.addRecords(creates.map(item => item.record));
          recordIds = recordIds.concat(created.map(record => record.recordId));
          created.forEach((record, index) => existingByKey.set(creates[index].key, record.recordId));
        }
      } else {
        recordIds = await activeTable.addRecords(records);
      }

      if (options.stopAfterCurrentBatch) {
        return { tableId: activeTable.id, recordIds };
      }

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
        await setupTableFields(newTableId, selectedFieldKeys, fieldMapping);
        return await createAndWriteData(list, type, task_id, newTableId, selectedFieldKeys, options);
        ElNotification({ title: '温馨提示', message: '当前多维表格已达到单表存储上限！已为您自动生成新表格展示全部数据', type: 'success', duration: 3000 });
        return;
      } catch (retryError) {
        console.error("🚀 ~ 创建新表重试写入失败:", retryError)
        const errorMsg = retryError?.message ? `写入失败：${retryError.message}` : "写入失败，请稍后重试";
        ElNotification({ title: '错误', message: errorMsg, type: 'error', duration: 0 });
        if (options.stopAfterCurrentBatch) {
          throw retryError;
        }
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
    validateTableFields: (tableId, selectedFieldKeys = [], options = {}) => validateTableFields(tableId, selectedFieldKeys, fieldMapping, options),
  };
};
