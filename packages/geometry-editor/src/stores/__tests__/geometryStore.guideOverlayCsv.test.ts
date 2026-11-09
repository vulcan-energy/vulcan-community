// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { createGeometryStore } from '../geometryStore';

it('round-trips guide overlay paths and a source file name that contain commas', () => {
  const source = createGeometryStore({ defaultDefaultsPath: null });
  source.setState({
    guideOverlayByFloor: { 0: { path: 'input/overlays/Plans, rev C p1.png', opacity01: 0.5, pos_m: { x: 1, y: 2 } } },
    guideOverlaySourceByFloor: { 0: { kind: 'pdf', source_path: 'input/plans/Plans, rev C.pdf', source_filename: 'Plans, rev C.pdf', page: 1, derived_overlay_path: 'input/overlays/Plans, rev C p1.png' } },
  } as never);
  const csv = source.getState().generateCSV({ allowUnresolvedMigration: true });
  const loaded = createGeometryStore({ defaultDefaultsPath: null });
  loaded.getState().loadFromCSV(csv);
  expect(loaded.getState().guideOverlayByFloor[0]?.path).toBe('input/overlays/Plans, rev C p1.png');
  expect(loaded.getState().guideOverlaySourceByFloor[0]).toMatchObject({ source_filename: 'Plans, rev C.pdf', source_path: 'input/plans/Plans, rev C.pdf' });
});
