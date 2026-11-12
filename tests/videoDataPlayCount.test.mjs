import { resolveWritableField } from '../src/utils/tableFields.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from '@vue/compiler-sfc';
import { parse as parseJS } from '@babel/parser';

const source = parse(fs.readFileSync(new URL('../src/components/VideoDataFetch.vue', import.meta.url), 'utf8')).descriptor.scriptSetup.content;
const declarations = parseJS(source, { sourceType: 'module' }).program.body
  .filter(node => node.type === 'VariableDeclaration').flatMap(node => node.declarations);
const load = (node, bindings) => new Function(...Object.keys(bindings), `return (${source.slice(node.start, node.end)});`)(...Object.values(bindings));
const FieldType = { Number: 2, Text: 1, SingleSelect: 3, Attachment: 17 };
const configNode = declarations.find(node => node.id.name === 'FIELD_CONFIG').init.elements
  .find(node => node.properties.some(prop => prop.key.name === 'key' && prop.value.value === 'view_count'));
const config = load(configNode, { FieldType, NumberFormatter: { INTEGER: 'integer' } });
const normalizeFieldValue = load(declarations.find(node => node.id.name === 'normalizeFieldValue').init, { FieldType });

for (const fieldType of [FieldType.Number, FieldType.Text]) {
  for (const [input, expected] of [[null, null], [undefined, null], [0, 0], ['0', 0], [149, 149], ['149', 149]]) {
    test(`play count writes ${String(input)} to field type ${fieldType} without inventing zero`, async () => {
      const expectedCell = fieldType === FieldType.Text ? String(expected ?? '') : expected;
      const createdValues = [], writes = [];
      const field = {
        getType: async () => fieldType,
        createCell: async value => {
          createdValues.push(value);
          return { getValue: async () => value };
        },
      };
      const table = {
        getFieldById: async () => field,
        setRecord: async (id, record) => writes.push({ id, ...record }),
      };
      const bindings = { resolveWritableField, FieldType, normalizeFieldValue, console: { log() {}, error() {} } };
      bindings.getAllowedFieldTypes = load(declarations.find(node => node.id.name === 'getAllowedFieldTypes').init, bindings);
      bindings.isFieldTypeCompatible = load(declarations.find(node => node.id.name === 'isFieldTypeCompatible').init, bindings);
      const createCellValue = load(declarations.find(node => node.id.name === 'createCellValue').init, bindings);
      const writeDataToRecord = load(declarations.find(node => node.id.name === 'writeDataToRecord').init, bindings);
      // Appended rows and existing rows must use the same null/zero distinction.
      const cell = await createCellValue(table, 'count', { view_count: input }, config);
      assert.equal(await cell.getValue(), expectedCell);
      await writeDataToRecord(table, 'existing', { view_count: input }, { '播放量': 'count' }, [config]);
      assert.deepEqual(createdValues, [expectedCell, expectedCell]);
      assert.deepEqual(writes, [{ id: 'existing', fields: { count: expectedCell } }]);
    });
  }
}
