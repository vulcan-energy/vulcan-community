// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { provenanceOf, type ProvenanceTable } from '../provenance';

it('provenanceOf reads a stated value that differs from its source as the user\'s', () => {
  const at = (source: number | null, current: number | '') => provenanceOf({}, { kind: 'element', id: 'w' }, 'perimeter', { source, current });
  expect(at(10, 12)).toBe('user');
  expect(at(10, 10.004)).toBe('source');
  expect(at(10, '')).toBe('source');
  expect(at(null, 12)).toBe('source');
});

it('provenanceOf takes a recorded source over the value', () => {
  const table: ProvenanceTable = { w: { u_value: 'user', colour: 'preset:Cavity' } };
  const of = (field: string) => provenanceOf(table, { kind: 'element', id: 'w' }, field, { source: 0.18, current: 0.18 });
  expect(of('u_value')).toBe('user');
  expect(of('colour')).toBe('source');
  expect(of('areal_heat_capacity')).toBe('source');
});
