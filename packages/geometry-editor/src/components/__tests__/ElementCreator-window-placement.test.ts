// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { buildHostedLinearParentPatch, projectLinearChildOntoParentSegment } from '../../lib/parentOrientation';
import type { BuildingElementOpaque, BuildingElementTransparent } from '../../geometry/types';

const transparentElement = (
  overrides: Omit<Partial<BuildingElementTransparent>, 'type'> = {},
): BuildingElementTransparent => ({
  type: 'BuildingElementTransparent',
  id: 'window',
  name: 'Window',
  zoneId: 'zone-1',
  parent_element: null,
  coordinates: [],
  width: 1,
  height: 1,
  area: 1,
  ...overrides,
});

const opaqueElement = (
  overrides: Omit<Partial<BuildingElementOpaque>, 'type'> = {},
): BuildingElementOpaque => ({
  type: 'BuildingElementOpaque',
  id: 'wall',
  name: 'Wall',
  zoneId: 'zone-1',
  parent_element: null,
  coordinates: [],
  width: 1,
  height: 1,
  area: 1,
  ...overrides,
});

describe('projectLinearChildOntoParentSegment', () => {
  it('projects a nearby window segment onto the parent wall without centering it', () => {
    const child = transparentElement({
      width: 2,
      area: 3,
      coordinates: [{ x: 0.5, y: 1.8, z: 0.6 }, { x: 2.5, y: 1.8, z: 0.6 }],
    });
    const parent = opaqueElement({
      width: 4,
      height: 2,
      area: 8,
      coordinates: [{ x: 0, y: 2, z: 0 }, { x: 4, y: 2, z: 0 }],
    });

    expect(projectLinearChildOntoParentSegment(child, parent)).toEqual([
      { x: 0.5, y: 2, z: 0.6 },
      { x: 2.5, y: 2, z: 0.6 },
    ]);
  });

  it('returns null for non-linear parent geometry', () => {
    const child = transparentElement({
      width: 2,
      area: 3,
      coordinates: [{ x: 0, y: 0, z: 0.6 }, { x: 2, y: 0, z: 0.6 }],
    });
    const parent = opaqueElement({
      width: 4,
      height: 1,
      area: 4,
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 4, y: 0, z: 0 },
        { x: 4, y: 1, z: 0 },
      ],
    });

    expect(projectLinearChildOntoParentSegment(child, parent)).toBeNull();
  });

  it('builds a hosted window patch without recentering the child', () => {
    const child = transparentElement({
      parent_element: '',
      coordinates: [{ x: 0.5, y: 1.8, z: 0.6 }, { x: 2.5, y: 1.8, z: 0.6 }],
    });
    const parent = opaqueElement({
      name: 'Wall',
      width: 4,
      height: 2,
      area: 8,
      pitch: 90,
      coordinates: [{ x: 0, y: 2, z: 0 }, { x: 4, y: 2, z: 0 }],
    });

    expect(buildHostedLinearParentPatch(child, parent, 'Wall', '', 0)).toMatchObject({
      parent_element: 'Wall',
      pitch: 90,
      orientation360: expect.any(Number),
      coordinates: [
        { x: 0.5, y: 2, z: 0.6 },
        { x: 2.5, y: 2, z: 0.6 },
      ],
    });
  });

  it('derives hosted orientation from the caller store offset', () => {
    const child = transparentElement({
      coordinates: [{ x: 0.5, y: 1.8, z: 0.6 }, { x: 2.5, y: 1.8, z: 0.6 }],
    });
    const parent = opaqueElement({
      name: 'Wall',
      coordinates: [{ x: 0, y: 2, z: 0 }, { x: 4, y: 2, z: 0 }],
    });

    expect(buildHostedLinearParentPatch(child, parent, 'Wall', '', 90)).toMatchObject({
      orientation360: 90,
    });
  });
});
