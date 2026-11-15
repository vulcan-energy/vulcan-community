// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createGeometryStore } from '../geometryStore';

// A name that reads as a number ("1", "007") stays the name, and links by it survive a save.
it('round-trips zone, wall and window names that read as numbers', () => {
  const fixture = readFileSync(join(import.meta.dirname, '../../../../../../fixtures/base_models/house_two_storey.csv'), 'utf8');
  const csv = fixture
    .replaceAll(',Zone 1,', ',007,')
    .replace(/^Zone 1,/m, '007,')
    .replace(/^F0_ExtWall_\(N\),/m, '1,')
    .replaceAll(',F0_ExtWall_(N),', ',1,');
  expect(csv).toMatch(/^1,007,BuildingElementOpaque/m);
  const store = createGeometryStore({ defaultDefaultsPath: null });
  store.getState().loadFromCSV(csv);
  const state = store.getState();
  const byName = (name: string) => Object.values(state.elementsById).find((e) => e.name === name);
  expect(state.zones.map((z) => z.name)).toContain('007');
  expect(byName('1')?.type).toBe('BuildingElementOpaque');
  const win = byName('F0_Win') as { parent_element?: string; linked_wall?: string } | undefined;
  expect(win?.linked_wall ?? win?.parent_element).toBe('1');
  const saved = state.generateCSV({ allowUnresolvedMigration: true });
  expect(saved).toMatch(/^1,007,BuildingElementOpaque/m);
  expect(saved).toMatch(/^F0_Win,007,BuildingElementTransparent,(?:[^,\n]*,){6}1,/m);
});
