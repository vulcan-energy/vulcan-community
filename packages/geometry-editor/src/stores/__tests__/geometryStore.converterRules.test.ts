// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { canonicalGeometrySchemaPort } from '../../lib/geometrySchemaPort';
import { __setFHSSchemaObjectForTests, __setSchemaObjectForTests } from '../../lib/schemaCache';
import { parseCsvSections } from '../../geometry/io/csvSectionRows';
import { createGeometryStore } from '../geometryStore';

// Each row loads the sample with one change and states what the converter does with it: the
// blocking issue the editor must show, or the cell the save must write. A regression here gives a
// wrong number or a silent change in the engine input.

const fixture = (path: string) => readFileSync(join(import.meta.dirname, '../../../../..', path), 'utf8');
const sample = fixture('packages/geometry-editor/src/geometry/__fixtures__/example_semi_detached.csv');
const defaults = { InfiltrationVentilation: { shield_class: 'Normal', altitude: 30, Leaks: { test_result: 4 } }, NumberOfBedrooms: 1 };

beforeAll(() => {
  const schema = JSON.parse(fixture('hem_fhs_upstream/schema/input_fhs.schema.json'));
  __setFHSSchemaObjectForTests(schema);
  __setSchemaObjectForTests(schema);
});
afterAll(() => {
  __setFHSSchemaObjectForTests(null as never);
  __setSchemaObjectForTests(null as never);
});

type Case = {
  name: string;
  edit: (csv: string) => string;
  /** Defaults that arrive before the load ('first') or after it ('late'); none when omitted. */
  defaults?: 'first' | 'late';
  /** `element|field` or `Global Settings` text the editor must block on. */
  blocks?: string[];
  /** Must not block on these. */
  allows?: string[];
  /** `section|row name|column` (or `Metadata|key`) → saved cell; null means the row is not written. */
  saves?: Record<string, string | null>;
};

const replace = (from: string, to: string) => (csv: string) => {
  if (!csv.includes(from)) throw new Error(`fixture text not found: ${from}`);
  return csv.replace(from, to);
};
const radiator = (unit: string) => replace('Radiator,Zone 1,WetEmitter,radiator,,1,', `Radiator,Zone 1,WetEmitter,radiator,,${unit},`);
const ufh = (unit: string) => replace('Underfloor Heating,Zone 1,WetEmitter,ufh,8.89,,', `Underfloor Heating,Zone 1,WetEmitter,ufh,8.89,${unit},`);

const CASES: Case[] = [
  // Converter: unit_number is a whole number of 1 or more, or blank (E055 otherwise), on every emitter.
  { name: 'radiator unit_number 0.5', edit: radiator('0.5'), blocks: ['Radiator|unit_number'], saves: { 'Wet Emitters|Radiator|unit_number': '0.5' } },
  { name: 'radiator unit_number 1.5', edit: radiator('1.5'), blocks: ['Radiator|unit_number'], saves: { 'Wet Emitters|Radiator|unit_number': '1.5' } },
  { name: 'radiator unit_number abc', edit: radiator('abc'), blocks: ['Radiator|unit_number'], saves: { 'Wet Emitters|Radiator|unit_number': 'abc' } },
  { name: 'radiator unit_number 0', edit: radiator('0'), blocks: ['Radiator|unit_number'], saves: { 'Wet Emitters|Radiator|unit_number': '0' } },
  { name: 'radiator unit_number 3', edit: radiator('3'), allows: ['Radiator|unit_number'], saves: { 'Wet Emitters|Radiator|unit_number': '3' } },
  { name: 'ufh unit_number 0', edit: ufh('0'), blocks: ['Underfloor Heating|unit_number'], saves: { 'Wet Emitters|Underfloor Heating|unit_number': '0' } },
  { name: 'ufh unit_number 1.5', edit: ufh('1.5'), blocks: ['Underfloor Heating|unit_number'] },
  { name: 'ufh area 0', edit: replace('Underfloor Heating,Zone 1,WetEmitter,ufh,8.89,', 'Underfloor Heating,Zone 1,WetEmitter,ufh,0,'), blocks: ['Underfloor Heating|area'] },
];

function load(c: Case) {
  const store = createGeometryStore({ defaultDefaultsPath: null, schemaPort: canonicalGeometrySchemaPort });
  if (c.defaults === 'first') store.setState({ defaultsJson: defaults, defaultsLoading: false } as never);
  const { warnings } = store.getState().loadFromCSV(c.edit(sample));
  if (c.defaults === 'late') store.setState({ defaultsJson: defaults, defaultsLoading: false } as never);
  const state = store.getState();
  const issues = new Set<string>();
  for (const element of Object.values(state.elementsById)) {
    for (const issue of state.validateElement(element, state.elementsById).issues) issues.add(`${element.name}|${issue.fieldKey ?? ''}`);
  }
  const all = state.collectAllGeometryWarnings().criticalIssues;
  const csv = state.generateCSV({ allowUnresolvedMigration: true });
  const cells = new Map<string, string>();
  for (const section of parseCsvSections(csv)) {
    for (const row of section.rows) {
      for (const [column, value] of Object.entries(row.data)) cells.set(`${section.name}|${row.data.Name}|${column}`, value);
    }
  }
  for (const line of csv.split('\n')) {
    const [key, value] = line.split(',');
    if (key && value !== undefined && !cells.has(`Metadata|${key}`)) cells.set(`Metadata|${key}`, value);
  }
  return { issues, all, cells, warnings, state };
}

it.each(CASES)('$name', (c) => {
  const { issues, all, cells } = load(c);
  const blocked = (key: string) => issues.has(key) || all.some((text) => text.includes(key));
  for (const key of c.blocks ?? []) expect(blocked(key), `blocks ${key}`).toBe(true);
  for (const key of c.allows ?? []) expect(blocked(key), `allows ${key}`).toBe(false);
  for (const [key, value] of Object.entries(c.saves ?? {})) expect(cells.get(key) ?? null, key).toBe(value);
});
