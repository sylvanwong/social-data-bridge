// 真实 SDK 负责字段缓存及单元格转换；只替换飞书宿主读取和表格存储。
export async function installSDKCells(table, bitable) {
  const base = Object.create(bitable.base);
  Object.defineProperties(base, { isTableExist: { value: async () => true }, tableMapCache: { value: new Map() }, batchUploadFile: { value: async files => files.map((_, index) => `file-${index}`) } });
  const sdkTable = await base.getTableById(table.id);
  Object.defineProperties(sdkTable, {
    isFieldExist: { value: async id => table.fields.some(field => field.id === id) },
    getFieldMetaById: { value: async id => table.fields.find(field => field.id === id) },
  });
  const original = table.getFieldById;
  table.fieldCache = sdkTable.fieldCache;
  table.getFieldById = async id => {
    const field = await original(id);
    const cached = await sdkTable.getFieldById(id);
    return { ...field, type: cached.type, setValue: async (recordId, value) => table.setRecord(recordId, { fields: { [id]: await (await cached.createCell(value)).getValue() } }), getName: async () => table.fields.find(field => field.id === id).name,
      createCell: async value => {
        const cell = await cached.createCell(value);
        const raw = await cell.getValue();
        return { fieldId: id, value: raw, getFieldId: () => id, getValue: async () => raw };
      },
    };
  };
  table.getField = async name => table.getFieldById(table.fields.find(field => field.id === name || field.name === name)?.id);
  table.getFieldList = async () => Promise.all(table.fields.map(field => table.getFieldById(field.id)));
  const check = fields => {
    for (const [id, value] of Object.entries(fields)) {
      const type = table.fields.find(field => field.id === id).type;
      if ([1, 15].includes(type) && (!Array.isArray(value) || value.some(part => part.type !== (type === 1 ? 'text' : 'url')))) throw new Error('宿主拒绝错误的文本／链接载荷');
      if (type === 17 && value !== null && (!Array.isArray(value) || value.some(file => typeof file.token !== 'string'))) throw new Error('宿主拒绝未上传的附件载荷');
      if ([2, 5].includes(type) && value !== null && (typeof value !== 'number' || !Number.isFinite(value))) throw new Error('宿主拒绝错误的数字／日期载荷');
    }
  };
  const add = table.addRecords, update = table.setRecords;
  table.addRecords = async rows => { rows.forEach(cells => check(Object.fromEntries(cells.map(cell => [cell.fieldId, cell.value])))); return add(rows); };
  table.setRecords = async rows => { rows.forEach(row => check(row.fields)); return update(rows); };
  table.setRecord = async (id, { fields }) => { check(fields); Object.assign(table.records.find(row => row.recordId === id).fields, fields); };
}
