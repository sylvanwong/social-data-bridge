import { bitable, FieldType } from "@lark-base-open/js-sdk";

/**
 * 新建 / 复用多维表格并批量写入数据。
 * 供「博主搜索」「搜索联想」等新增页面使用，与既有页面的写入逻辑保持一致。
 */

const FIELD_TYPE_NAME = {
  [FieldType.Text]: "文本",
  [FieldType.Number]: "数字",
  [FieldType.SingleSelect]: "单选",
  [FieldType.DateTime]: "日期",
  [FieldType.Url]: "链接",
};

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeTableName = (value) => {
  const fallback = "社媒数据助手";
  const normalized = String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/:*?[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (normalized || fallback).slice(0, 80);
};

const getAllowedFieldTypes = (config) => {
  if (config.type === FieldType.Number) return [FieldType.Number, FieldType.Text];
  if (config.type === FieldType.Url) return [FieldType.Url, FieldType.Text];
  if (config.allowSelect) return [FieldType.Text, FieldType.SingleSelect];
  return [config.type];
};

const getExpectedFieldTypeName = (config) =>
  getAllowedFieldTypes(config)
    .map((type) => FIELD_TYPE_NAME[type] || type)
    .join(" / ");

const chunk = (list, size = 200) => {
  const chunks = [];
  for (let index = 0; index < list.length; index += size) {
    chunks.push(list.slice(index, index + size));
  }
  return chunks;
};

/** 若已存在同名表，则按「名称 + 递增序号」新建，避免覆盖历史数据 */
export const createSequentialTable = async (baseTableName) => {
  const safeName = normalizeTableName(baseTableName);
  const tableMetaList = await bitable.base.getTableMetaList();
  const tableNames = tableMetaList.map((table) => table.name);

  const existsBaseTable = tableNames.includes(safeName);
  const existsSequentialTable = tableNames.some(
    (name) => name.startsWith(safeName) && /\d+$/.test(name.slice(safeName.length))
  );
  if (!existsBaseTable && !existsSequentialTable) {
    return await bitable.base.addTable({ name: safeName });
  }

  const reg = new RegExp(`^${escapeRegExp(safeName)}(\\d+)$`);
  let maxIndex = 0;
  tableNames.forEach((name) => {
    const match = name.match(reg);
    if (match) {
      const index = parseInt(match[1], 10);
      if (index > maxIndex) maxIndex = index;
    }
  });

  return await bitable.base.addTable({ name: `${safeName}${maxIndex + 1}` });
};

/**
 * 校验并补齐目标表字段。
 * - 新表：把默认「文本」列改造成第一个输出字段，其余依次新建
 * - 现有表：同名列直接复用（校验类型），缺失的列自动新建
 */
export const prepareTableFields = async (tableId, fieldMapping, { isNewTable = false } = {}) => {
  const table = await bitable.base.getTableById(tableId);
  let fieldMetaList = await table.getFieldMetaList();
  const fieldMetaMap = new Map(fieldMetaList.map((meta) => [meta.name, meta]));

  const applyFormatter = async (field, config) => {
    try {
      if (config.formatter) await field.setFormatter(config.formatter);
    } catch (error) {
      console.error(`设置字段 ${config.name} 格式失败:`, error);
    }
  };

  if (isNewTable) {
    for (const [index, config] of fieldMapping.entries()) {
      const defaultField = index === 0 ? fieldMetaList.find((meta) => meta.name === "文本") : null;
      if (defaultField) {
        await table.setField(defaultField.id, { type: config.type, name: config.name });
      } else {
        await table.addField({ type: config.type, name: config.name });
      }
    }
    fieldMetaList = await table.getFieldMetaList();
    for (const config of fieldMapping) {
      const meta = fieldMetaList.find((item) => item.name === config.name);
      if (meta) await applyFormatter(await table.getFieldById(meta.id), config);
    }
    return true;
  }

  const missingFields = [];
  for (const config of fieldMapping) {
    const meta = fieldMetaMap.get(config.name);
    if (!meta) {
      missingFields.push(config);
      continue;
    }
    const field = await table.getFieldById(meta.id);
    const fieldType = await field.getType();
    if (!getAllowedFieldTypes(config).includes(fieldType)) {
      throw new Error(
        `字段“${config.name}”类型不匹配，仅支持${getExpectedFieldTypeName(config)}类型，请修改后重新执行`
      );
    }
  }

  for (const config of missingFields) {
    await table.addField({ type: config.type, name: config.name });
  }

  const refreshedMetaList = await table.getFieldMetaList();
  for (const config of fieldMapping) {
    const meta = refreshedMetaList.find((item) => item.name === config.name);
    if (meta) await applyFormatter(await table.getFieldById(meta.id), config);
  }

  return { addedCount: missingFields.length };
};

const normalizeValue = (value, config, fieldType) => {
  if (config.allowSelect && fieldType === FieldType.SingleSelect) {
    return value === null || value === undefined || value === "" ? null : String(value);
  }
  if (config.type === FieldType.Number && fieldType === FieldType.Text) {
    return value === null || value === undefined ? "" : String(value);
  }
  return value === null || value === undefined ? "" : value;
};

/** 把已扁平化的数据行批量写入目标表 */
export const writeRowsToTable = async (table, rows, fieldMapping, onProgress) => {
  const fieldMetaList = await table.getFieldMetaList();
  const fieldMetaMap = new Map(fieldMetaList.map((meta) => [meta.name, meta]));

  const fieldList = [];
  for (const config of fieldMapping) {
    const meta = fieldMetaMap.get(config.name);
    if (!meta) continue;
    const field = await table.getFieldById(meta.id);
    fieldList.push({ field, config, fieldType: await field.getType() });
  }

  if (fieldList.length === 0) {
    throw new Error("所选表格没有可写入字段");
  }

  const batches = chunk(rows, 200);
  let written = 0;
  for (const batch of batches) {
    const records = [];
    for (const row of batch) {
      const record = [];
      for (const { field, config, fieldType } of fieldList) {
        record.push(await field.createCell(normalizeValue(row[config.key], config, fieldType)));
      }
      records.push(record);
    }
    await table.addRecords(records);
    written += records.length;
    onProgress?.(written, rows.length);
  }

  return written;
};

export const loadTableOptions = async () => {
  const tableList = await bitable.base.getTableList();
  return await Promise.all(
    tableList.map(async (table) => ({
      id: table.id,
      name: await table.getName(),
    }))
  );
};
