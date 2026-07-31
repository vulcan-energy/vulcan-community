// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Roof window / rooflight TB preview (SAP R1–R3) — sloped and flat (`pitch` 0°) openings.
 */
import { describe, expect, it } from 'vitest';
import type { BuildingElementOpaque, BuildingElementTransparent, ThermalBridgeLinear } from '../types';
import {
  annotateProposalsWithDedupe,
  defaultJunctionCodeForEdge,
  junctionOptionsForFacadeEdgeRole,
} from './proposeFacadeOpenings';
import { isRoofWindowOpening, proposeRoofOpeningThermalBridges } from './proposeRoofOpenings';

function makeRoofOpening(
  overrides: Partial<BuildingElementTransparent> & Pick<BuildingElementTransparent, 'id' | 'name' | 'pitch'>,
): BuildingElementTransparent {
  return {
    type: 'BuildingElementTransparent',
    id: overrides.id,
    name: overrides.name,
    pitch: overrides.pitch,
    zoneId: overrides.zoneId ?? 'z1',
    parent_element: overrides.parent_element ?? 'Roof plane',
    coordinates: overrides.coordinates ?? [
      { x: 1, y: 2, z: 5 },
      { x: 3, y: 2, z: 5 },
    ],
    width: overrides.width ?? 2,
    height: overrides.height ?? 1,
    area: overrides.area ?? 2,
    isPlaceholder: overrides.isPlaceholder ?? false,
    ...(overrides.base_height !== undefined ? { base_height: overrides.base_height } : {}),
  } as BuildingElementTransparent;
}

function makeHostRoof(): BuildingElementOpaque {
  return {
    type: 'BuildingElementOpaque',
    id: 'roof-host',
    name: 'Pitched Roof',
    zoneId: 'z1',
    parent_element: null,
    coordinates: [
      { x: 0, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
      { x: 4, y: 4, z: 0 },
      { x: 0, y: 4, z: 0 },
    ],
    pitch: 45,
    orientation360: 0,
    base_height: 2,
    width: 4,
    height: 4,
    area: 16,
    isPlaceholder: false,
  };
}

describe('isRoofWindowOpening', () => {
  it('accepts sloped pitch (not 90)', () => {
    expect(isRoofWindowOpening(makeRoofOpening({ id: 'r1', name: 'Velux', pitch: 35 }))).toBe(true);
    for (const pitch of [30, 45, 60]) {
      expect(isRoofWindowOpening(makeRoofOpening({ id: 'r1', name: 'R', pitch }))).toBe(true);
    }
  });

  it('accepts flat rooflight (pitch 0)', () => {
    expect(isRoofWindowOpening(makeRoofOpening({ id: 'r1', name: 'Flat skylight', pitch: 0 }))).toBe(true);
  });

  it('rejects vertical pitch (wall opening)', () => {
    expect(isRoofWindowOpening(makeRoofOpening({ id: 'r1', name: 'W', pitch: 90 }))).toBe(false);
  });

  it('rejects unset pitch (treated as wall)', () => {
    const w = makeRoofOpening({ id: 'r1', name: 'X', pitch: 45 });
    const noPitch = { ...w, pitch: undefined } as BuildingElementTransparent;
    expect(isRoofWindowOpening(noPitch)).toBe(false);
  });

  it('rejects placeholders and bad geometry', () => {
    expect(isRoofWindowOpening(makeRoofOpening({ id: 'r1', name: 'P', pitch: 30, isPlaceholder: true }))).toBe(false);
    expect(isRoofWindowOpening(makeRoofOpening({ id: 'r1', name: 'P', pitch: 30, height: 0 }))).toBe(false);
  });
});

describe('defaultJunctionCodeForEdge / junctionOptions (roof roles)', () => {
  it('maps roof edge roles to R1/R2/R3/R11 and fixes dropdown options', () => {
    expect(defaultJunctionCodeForEdge('roof_window_head')).toBe('R1');
    expect(defaultJunctionCodeForEdge('roof_window_sill')).toBe('R2');
    expect(defaultJunctionCodeForEdge('roof_window_jamb_first')).toBe('R3');
    expect(defaultJunctionCodeForEdge('rooflight_kerb')).toBe('R11');
    expect(junctionOptionsForFacadeEdgeRole('roof_window_head')).toEqual(['R1']);
    expect(junctionOptionsForFacadeEdgeRole('roof_window_sill')).toEqual(['R2']);
    expect(junctionOptionsForFacadeEdgeRole('rooflight_kerb')).toEqual(['R11']);
    expect(junctionOptionsForFacadeEdgeRole('roof_window_jamb_second')).toEqual(['R3']);
  });
});

describe('proposeRoofOpeningThermalBridges', () => {
  it('emits five R-series proposals per roof opening (incl. R11 kerb line)', () => {
    const r = makeRoofOpening({ id: 'sk1', name: 'Skylight A', pitch: 40 });
    const p = proposeRoofOpeningThermalBridges([r]);
    expect(p).toHaveLength(5);
    expect(p.map((x) => x.edgeRole)).toEqual([
      'roof_window_head',
      'roof_window_sill',
      'rooflight_kerb',
      'roof_window_jamb_first',
      'roof_window_jamb_second',
    ]);
    expect(p.map((x) => x.junctionCode)).toEqual(['R1', 'R2', 'R11', 'R3', 'R3']);
    expect(p[0].suggestedLengthM).toBe(2);
    expect(p[2].suggestedLengthM).toBe(2);
    expect(p[3].suggestedLengthM).toBe(1);
  });

  it('uses same head/sill Z logic as façade openings', () => {
    const r = makeRoofOpening({
      id: 'r',
      name: 'R',
      pitch: 15,
      coordinates: [
        { x: 0, y: 0, z: 4 },
        { x: 2, y: 0, z: 4 },
      ],
      height: 0.8,
    });
    const p = proposeRoofOpeningThermalBridges([r]);
    const sill = p.find((x) => x.edgeRole === 'roof_window_sill')!;
    const head = p.find((x) => x.edgeRole === 'roof_window_head')!;
    expect(sill.coordinates[0].z).toBe(4);
    expect(head.coordinates[0].z).toBeCloseTo(4.8, 5);
  });

  it('includes flat pitch 0 rooflights', () => {
    const r = makeRoofOpening({ id: 'flat', name: 'Rooflight', pitch: 0 });
    const p = proposeRoofOpeningThermalBridges([r]);
    expect(p).toHaveLength(5);
    expect(p.every((x) => ['R1', 'R2', 'R3', 'R11'].includes(x.junctionCode))).toBe(true);
  });

  it('emits R-series proposals for sloped polygon rooflights hosted by a roof', () => {
    const roof = makeHostRoof();
    const r = makeRoofOpening({
      id: 'poly',
      name: 'Rooflight polygon',
      pitch: 45,
      parent_element: roof.name,
      coordinates: [
        { x: 1, y: 1, z: 0 },
        { x: 2, y: 1, z: 0 },
        { x: 2, y: 2, z: 0 },
        { x: 1, y: 2, z: 0 },
      ],
      area: 1.41,
      width: 1,
      height: 1,
      base_height: 9,
    });

    const p = proposeRoofOpeningThermalBridges([roof, r]);

    expect(p).toHaveLength(5);
    expect(p.map((x) => x.junctionCode)).toEqual(['R1', 'R2', 'R11', 'R3', 'R3']);
    const sill = p.find((x) => x.edgeRole === 'roof_window_sill')!;
    const head = p.find((x) => x.edgeRole === 'roof_window_head')!;
    expect(sill.coordinates[0].z).toBeCloseTo(3, 5);
    expect(head.coordinates[0].z).toBeCloseTo(4, 5);
    expect(sill.suggestedLengthM).toBe(1);
    expect(p.find((x) => x.edgeRole === 'roof_window_jamb_first')!.suggestedLengthM).toBeCloseTo(1.41, 2);
  });

  it('tags duplicates when matching R junction exists at midpoint', () => {
    const r = makeRoofOpening({ id: 'o1', name: 'Skylight', pitch: 25 });
    const proposals = proposeRoofOpeningThermalBridges([r]);
    const head = proposals.find((x) => x.edgeRole === 'roof_window_head')!;
    const midZ = (head.coordinates[0].z + head.coordinates[1].z) / 2;
    const midX = (head.coordinates[0].x + head.coordinates[1].x) / 2;
    const midY = (head.coordinates[0].y + head.coordinates[1].y) / 2;

    const existing: ThermalBridgeLinear = {
      type: 'ThermalBridgeLinear',
      id: 'tb-existing',
      name: '',
      zoneId: 'z1',
      length: 2,
      linear_thermal_transmittance: 0.24,
      parent_element: 'Skylight',
      coordinates: [
        { x: midX - 0.02, y: midY, z: midZ },
        { x: midX + 0.02, y: midY, z: midZ },
      ],
      extra_json: { junction_type: 'R1' },
      isPlaceholder: false,
    } as ThermalBridgeLinear;

    const ann = annotateProposalsWithDedupe(proposals, [r, existing]);
    const headAnn = ann.find((x) => x.edgeRole === 'roof_window_head')!;
    expect(headAnn.status).toBe('duplicate');
    expect(headAnn.matchedExistingId).toBe('tb-existing');
  });
});
