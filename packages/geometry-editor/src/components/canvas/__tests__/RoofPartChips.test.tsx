// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Element } from '../../../geometry/types';
import { drawRoofPart, fitRoofPart, roofParameters, roofRoom, roomSection, storeyOutline, type RoofParameters } from '../../../lib/roofPart';
import { createGeometryStore } from '../../../stores/geometryStore';
import { RoofPartChips } from '../RoofPartChips';

let n = 0;
const wall = (name: string, a: [number, number], b: [number, number]) => ({
  id: `w${(n += 1)}`, name, type: 'BuildingElementOpaque', zoneId: 'z', parent_element: null,
  coordinates: [{ x: a[0], y: a[1], z: 0 }, { x: b[0], y: b[1], z: 0 }],
  width: Math.hypot(b[0] - a[0], b[1] - a[1]), height: 2.5, area: 1, pitch: 90, orientation360: 0, base_height: 0,
}) as unknown as Element;

describe('roof part chips', () => {
  it('the ridge chip reads the ridge the section shows, with a room in the roof lowered under the eaves', () => {
    // 8 × 7, gable ended; set in 4.0 / 2.4 / 1.0 / 1.0: the room's slope sits 0.4 m below the fitted roof.
    const walls = [wall('Front', [0, 0], [8, 0]), wall('East', [8, 0], [8, 7]), wall('Rear', [8, 7], [0, 7]), wall('West', [0, 7], [0, 0])];
    const store = createGeometryStore({ defaultDefaultsPath: null });
    store.getState().addElements(walls.map((e) => ({ ...e, id: undefined })) as never);
    const at = { x: 4, y: 3.5 };
    const p = { level: 0, at, use: 'room', edges: { East: 'gable', West: 'gable' }, roomWalls: 'set-in', roomWidth: 4, maxCeilingHeight: 2.4, ceilingWidth: 1, kneeWallHeight: 1 } as RoofParameters;
    const placed = drawRoofPart(store.getState(), p);
    if ('problem' in placed) throw new Error(placed.problem);
    const elementsById = store.getState().elementsById;
    const anchor = elementsById[placed.anchorId];
    render(<RoofPartChips anchor={anchor} elementsById={elementsById} toScreen={(q) => q} commit={() => {}} />);
    const outline = storeyOutline(Object.values(elementsById), 0, at)!;
    const fit = fitRoofPart(outline, roofParameters(anchor)!);
    if ('problem' in fit) throw new Error(fit.problem);
    const room = roofRoom(outline, roofParameters(anchor)!, fit);
    if (!room || 'problem' in room) throw new Error('no room');
    expect(room.shift).toBeLessThan(-0.1);
    const section = outline.eaves + Math.max(...roomSection(room, fit.section.points).map((q) => q.z));
    expect(screen.getByText(/^ridge /).textContent).toBe(`ridge ${section.toFixed(2)} m`);
    expect(section.toFixed(2)).not.toBe((outline.eaves + fit.ridge.height).toFixed(2));
  });
});
