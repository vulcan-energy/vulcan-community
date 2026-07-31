// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { Element, Floor } from '../types';
import type { BuildingElementOpaque } from '../types';
import { computeThermalBridgeLinearRunLengthM } from '../../lib/thermalBridgeLinearGeometry';
import { defaultJunctionCodeForEdge, junctionOptionsForFacadeEdgeRole } from './proposeFacadeOpenings';
import { isSlopedPitchedRoofElementForEavesGable, proposeSlopedRoofEavesGableThermalBridges } from './proposeSlopedRoofEavesGable';

const cold2 = {
  type: 'BuildingElementOpaque',
  id: 'c2',
  name: 'Pitched roof',
  zoneId: 'z1',
  parent_element: null,
  coordinates: [
    { x: 0, y: 0, z: 2 },
    { x: 4, y: 0, z: 2 },
  ],
  width: 4,
  height: 0.2,
  area: 0.8,
  pitch: 36,
  is_unheated_pitched_roof: true,
  isPlaceholder: false,
} as BuildingElementOpaque;

const warmRect = {
  type: 'BuildingElementOpaque',
  id: 'wr',
  name: 'Pitched roof',
  zoneId: 'z1',
  parent_element: null,
  coordinates: [
    { x: 0, y: 0, z: 3 },
    { x: 4, y: 0, z: 3 },
    { x: 4, y: 2, z: 3 },
    { x: 0, y: 2, z: 3 },
  ],
  width: 1,
  height: 0.1,
  area: 8,
  pitch: 35,
  isPlaceholder: false,
} as BuildingElementOpaque;

/** Same plan as warmRect but cold loft — projected ceiling boundary, so no ridge proposal. */
const coldQuadSamePlan = {
  ...warmRect,
  id: 'cold-wr',
  is_unheated_pitched_roof: true,
} as BuildingElementOpaque;

describe('isSlopedPitchedRoofElementForEavesGable', () => {
  it('is true for cold 2-pt sloped with name roof', () => {
    expect(isSlopedPitchedRoofElementForEavesGable(cold2)).toBe(true);
  });
});

describe('proposeSlopedRoofEavesGableThermalBridges', () => {
  it('defaults 2-pt to E10/E12 when is_unheated_pitched_roof', () => {
    const out = proposeSlopedRoofEavesGableThermalBridges([cold2] as Element[]);
    expect(out).toHaveLength(1);
    expect(out[0]!.edgeRole).toBe('sloped_roof_eaves');
    expect(out[0]!.junctionCode).toBe('E10');
  });

  it('adds eaves + two gable edges + one ridge for a 4-vertex sloped plan', () => {
    const out = proposeSlopedRoofEavesGableThermalBridges([warmRect] as Element[]);
    const eaves = out.filter((o) => o.edgeRole === 'sloped_roof_eaves');
    const g = out.filter((o) => o.edgeRole === 'sloped_roof_gable');
    const r = out.filter((o) => o.edgeRole === 'sloped_roof_ridge');
    expect(eaves).toHaveLength(1);
    expect(eaves[0]!.junctionCode).toBe('E11');
    expect(g).toHaveLength(2);
    for (const x of g) {
      expect(x.junctionCode).toBe('E13');
    }
    expect(r).toHaveLength(1);
    expect(r[0]!.junctionCode).toBe('R4');
  });

  it('uses projected ceiling boundary for cold loft gables and suppresses ridge proposals', () => {
    const out = proposeSlopedRoofEavesGableThermalBridges([coldQuadSamePlan] as Element[]);
    const g = out.filter((o) => o.edgeRole === 'sloped_roof_gable');
    const r = out.filter((o) => o.edgeRole === 'sloped_roof_ridge');
    expect(g).toHaveLength(2);
    for (const row of g) {
      expect(row.junctionCode).toBe('E12');
      expect(row.coordinates[0]!.z).toBeCloseTo(row.coordinates[1]!.z, 5);
      expect(row.suggestedLengthM).toBeCloseTo(
        Math.hypot(
          row.coordinates[1]!.x - row.coordinates[0]!.x,
          row.coordinates[1]!.y - row.coordinates[0]!.y,
        ),
        2,
      );
    }
    expect(r).toHaveLength(0);
  });

  it('uses inferred wall-top ceiling elevation for cold loft eaves and gables when roof base is higher', () => {
    const floors: Floor[] = [
      { id: 'f1', name: 'Upper', zIndex: 1, height: 2.8, isRoofSpace: false },
      { id: 'f2', name: 'Roof', zIndex: 2, height: 0, isRoofSpace: true },
    ];
    const upperWall = {
      type: 'BuildingElementOpaque',
      id: 'upper-wall',
      name: 'Upper wall',
      zoneId: 'z1',
      floorId: 'f1',
      parent_element: null,
      coordinates: [
        { x: 0, y: 0, z: 1 },
        { x: 4, y: 0, z: 1 },
      ],
      width: 4,
      height: 2.8,
      area: 11.2,
      pitch: 90,
      base_height: 2.8,
      isPlaceholder: false,
    } as BuildingElementOpaque;
    const roof = {
      ...coldQuadSamePlan,
      floorId: 'f2',
      base_height: 6.2,
      coordinates: coldQuadSamePlan.coordinates.map((point) => ({ ...point, z: 2 })),
    } as BuildingElementOpaque;

    const out = proposeSlopedRoofEavesGableThermalBridges([upperWall, roof] as Element[], floors);
    const coldBoundaryRows = out.filter(
      (row) => row.edgeRole === 'sloped_roof_eaves' || row.edgeRole === 'sloped_roof_gable',
    );

    expect(coldBoundaryRows.length).toBeGreaterThan(0);
    for (const row of coldBoundaryRows) {
      expect(row.coordinates[0]!.z).toBeCloseTo(5.6, 5);
      expect(row.coordinates[1]!.z).toBeCloseTo(5.6, 5);
    }
  });

  it('places ridge thermal bridge on the roof top plane (above eaves base Z)', () => {
    const out = proposeSlopedRoofEavesGableThermalBridges([warmRect] as Element[]);
    const eaves = out.find((o) => o.edgeRole === 'sloped_roof_eaves');
    const ridge = out.find((o) => o.edgeRole === 'sloped_roof_ridge');
    expect(eaves && ridge).toBeTruthy();
    const zEaves = Math.min(eaves!.coordinates[0].z, eaves!.coordinates[1].z);
    const zRidgeMin = Math.min(ridge!.coordinates[0].z, ridge!.coordinates[1].z);
    expect(zRidgeMin).toBeGreaterThan(zEaves + 0.02);
  });

  it('gable E12/E13 uses roof-top Z along the edge so suggestedLengthM matches 3D run from coordinates', () => {
    const out = proposeSlopedRoofEavesGableThermalBridges([warmRect] as Element[]);
    const g = out.filter((o) => o.edgeRole === 'sloped_roof_gable');
    expect(g.length).toBeGreaterThan(0);
    for (const row of g) {
      expect(row.suggestedLengthM).toBeCloseTo(computeThermalBridgeLinearRunLengthM(row.coordinates), 2);
    }
  });
});

describe('dropdowns', () => {
  it('exposes eaves and gable code pairs', () => {
    expect(junctionOptionsForFacadeEdgeRole('sloped_roof_eaves')).toEqual(['E10', 'E11']);
    expect(junctionOptionsForFacadeEdgeRole('sloped_roof_gable')).toEqual(['E12', 'E13']);
    expect(junctionOptionsForFacadeEdgeRole('sloped_roof_ridge')).toEqual(['R4', 'R5']);
    expect(defaultJunctionCodeForEdge('sloped_roof_eaves')).toBe('E10');
    expect(defaultJunctionCodeForEdge('sloped_roof_gable')).toBe('E12');
    expect(defaultJunctionCodeForEdge('sloped_roof_ridge')).toBe('R4');
  });
});
