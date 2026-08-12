// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Unit tests for façade opening TB preview + geometric dedupe (junction code + midpoint).
 * UI flow lives in AutoThermalBridgePreviewModal; core logic is pure functions here.
 */
import { describe, expect, it } from 'vitest';
import type {
  BuildingElementAdjacentConditionedSpace,
  BuildingElementGround,
  BuildingElementOpaque,
  BuildingElementTransparent,
  Floor,
  ThermalBridgeLinear,
} from '../types';
import type { FacadeOpeningEdgeRole } from './proposeFacadeOpenings';
import {
  annotateProposalsWithDedupe,
  coerceJunctionCodeForEdgeRole,
  DEFAULT_TB_DEDUPE_TOLERANCE_M,
  defaultJunctionCodeForEdge,
  isExternalDoorFacadeOpening,
  isWallFacadeOpening,
  junctionOptionsForFacadeEdgeRole,
  proposeFacadeOpeningThermalBridges,
  psiTable37ForCode,
} from './proposeFacadeOpenings';

/** Keep aligned with `FacadeOpeningEdgeRole` in `proposeFacadeOpenings.ts` (add new roles here). */
const ALL_PREVIEW_EDGE_ROLES: FacadeOpeningEdgeRole[] = [
  'lintel',
  'sill',
  'wall_ground_foot',
  'wall_intermediate_floor_foot',
  'jamb_first',
  'jamb_second',
  'roof_window_head',
  'roof_window_sill',
  'roof_window_jamb_first',
  'roof_window_jamb_second',
  'external_corner_convex',
  'external_corner_reentrant',
  'wall_ground_continuous',
  'wall_intermediate_continuous',
  'party_wall_junction',
  'unheated_adjacent_wall_junction',
  'flat_roof_edge',
  'party_to_external_e18',
  'sloped_roof_eaves',
  'sloped_roof_gable',
  'sloped_roof_ridge',
  'e7_party_floor_external',
  'basement_floor_edge',
  'party_wall_to_sloped_roof',
  'party_wall_to_flat_roof',
  'sloped_roof_to_adjacent_wall_r8_r9',
  'dormer_roof_to_host_roof_r10',
  'rooflight_kerb',
];

function makeWindow(overrides: Partial<BuildingElementTransparent> & Pick<BuildingElementTransparent, 'id' | 'name'>): BuildingElementTransparent {
  return {
    type: 'BuildingElementTransparent',
    id: overrides.id,
    name: overrides.name,
    zoneId: overrides.zoneId ?? 'z1',
    parent_element: overrides.parent_element ?? 'Wall 1',
    coordinates: overrides.coordinates ?? [
      { x: 0, y: 0, z: 0.9 },
      { x: 2, y: 0, z: 0.9 },
    ],
    width: overrides.width ?? 2,
    height: overrides.height ?? 1.2,
    area: overrides.area ?? 2.4,
    pitch: overrides.pitch ?? 90,
    isPlaceholder: overrides.isPlaceholder ?? false,
    ...(overrides.base_height !== undefined ? { base_height: overrides.base_height } : {}),
    ...(overrides.floorId !== undefined ? { floorId: overrides.floorId } : {}),
  } as BuildingElementTransparent;
}

function makeExternalDoor(
  overrides: Partial<BuildingElementOpaque> & Pick<BuildingElementOpaque, 'id' | 'name'>,
): BuildingElementOpaque {
  return {
    type: 'BuildingElementOpaque',
    id: overrides.id,
    name: overrides.name,
    zoneId: overrides.zoneId ?? 'z1',
    parent_element: overrides.parent_element ?? 'Wall (N)',
    coordinates: overrides.coordinates ?? [
      { x: -2.362, y: 2.18, z: 0 },
      { x: -3.162, y: 2.18, z: 0 },
    ],
    width: overrides.width ?? 0.8,
    height: overrides.height ?? 2,
    area: overrides.area ?? 1.6,
    pitch: overrides.pitch ?? 90,
    is_external_door: true,
    isPlaceholder: overrides.isPlaceholder ?? false,
    base_height: overrides.base_height ?? 0,
    ...(overrides.floorId !== undefined ? { floorId: overrides.floorId } : {}),
  } as BuildingElementOpaque;
}

function makeWall(overrides: Partial<BuildingElementOpaque> & Pick<BuildingElementOpaque, 'id' | 'name'>): BuildingElementOpaque {
  return {
    type: 'BuildingElementOpaque',
    id: overrides.id,
    name: overrides.name,
    zoneId: overrides.zoneId ?? 'z1',
    parent_element: overrides.parent_element ?? null,
    coordinates: overrides.coordinates ?? [
      { x: 0, y: 0, z: 0 },
      { x: 5, y: 0, z: 0 },
    ],
    width: overrides.width ?? 5,
    height: overrides.height ?? 2.4,
    area: overrides.area ?? 12,
    pitch: overrides.pitch ?? 90,
    isPlaceholder: false,
    base_height: overrides.base_height ?? 0,
  } as BuildingElementOpaque;
}

function makeGround(overrides: Partial<BuildingElementGround> & Pick<BuildingElementGround, 'id' | 'name'>): BuildingElementGround {
  return {
    type: 'BuildingElementGround',
    id: overrides.id,
    name: overrides.name,
    zoneId: overrides.zoneId ?? 'z1',
    parent_element: null,
    coordinates: overrides.coordinates ?? [
      { x: 0, y: 0, z: 0 },
      { x: 5, y: 0, z: 0 },
      { x: 5, y: 4, z: 0 },
      { x: 0, y: 4, z: 0 },
    ],
    width: overrides.width ?? 5,
    height: overrides.height ?? 0,
    area: overrides.area ?? 20,
    total_area: overrides.total_area ?? 20,
    perimeter: overrides.perimeter ?? 18,
    floor_type: overrides.floor_type ?? 'Slab_no_edge_insulation',
    isPlaceholder: false,
    ...overrides,
  } as BuildingElementGround;
}

function makeConditionedFloor(
  overrides: Partial<BuildingElementAdjacentConditionedSpace> &
    Pick<BuildingElementAdjacentConditionedSpace, 'id' | 'name'>,
): BuildingElementAdjacentConditionedSpace {
  return {
    type: 'BuildingElementAdjacentConditionedSpace',
    id: overrides.id,
    name: overrides.name,
    zoneId: overrides.zoneId ?? 'z1',
    parent_element: null,
    coordinates: overrides.coordinates ?? [
      { x: 0, y: 0, z: 0 },
      { x: 5, y: 0, z: 0 },
      { x: 5, y: 4, z: 0 },
      { x: 0, y: 4, z: 0 },
    ],
    width: overrides.width ?? 5,
    height: overrides.height ?? 0,
    area: overrides.area ?? 20,
    pitch: overrides.pitch ?? 0,
    isPlaceholder: false,
    ...overrides,
  } as BuildingElementAdjacentConditionedSpace;
}

describe('isWallFacadeOpening', () => {
  it('accepts vertical 2-point window with width/height', () => {
    expect(isWallFacadeOpening(makeWindow({ id: 'w1', name: 'Window 1' }))).toBe(true);
  });

  it('rejects non-vertical pitch', () => {
    expect(
      isWallFacadeOpening(
        makeWindow({ id: 'w1', name: 'W', pitch: 45, width: 2, height: 1.2 }),
      ),
    ).toBe(false);
  });

  it('rejects wrong coordinate count', () => {
    expect(
      isWallFacadeOpening(
        makeWindow({
          id: 'w1',
          name: 'W',
          coordinates: [
            { x: 0, y: 0, z: 0 },
            { x: 1, y: 0, z: 0 },
            { x: 1, y: 1, z: 0 },
          ],
        }),
      ),
    ).toBe(false);
  });

  it('rejects zero height', () => {
    expect(isWallFacadeOpening(makeWindow({ id: 'w1', name: 'W', height: 0, width: 2 }))).toBe(false);
  });

  it('rejects placeholders', () => {
    expect(isWallFacadeOpening(makeWindow({ id: 'w1', name: 'W', isPlaceholder: true }))).toBe(false);
  });
});

describe('isExternalDoorFacadeOpening', () => {
  it('accepts opaque external door with vertical pitch / geometry (example_house_2 style)', () => {
    expect(isExternalDoorFacadeOpening(makeExternalDoor({ id: 'door', name: 'Door' }))).toBe(true);
  });

  it('rejects opaque wall without door flag', () => {
    const wall = { ...makeExternalDoor({ id: 'w', name: 'Wall' }), is_external_door: false };
    expect(isExternalDoorFacadeOpening(wall)).toBe(false);
  });
});

describe('proposeFacadeOpeningThermalBridges', () => {
  it('emits four proposals per opaque external door (CSV exposes doors as BuildingElementOpaque)', () => {
    const door = makeExternalDoor({ id: 'door-ex', name: 'Door' });
    const proposals = proposeFacadeOpeningThermalBridges([door]);
    expect(proposals).toHaveLength(4);
    expect(proposals.map((p) => p.edgeRole)).toEqual(['lintel', 'wall_ground_foot', 'jamb_first', 'jamb_second']);
    expect(proposals[0].junctionCode).toBe('E1');
    expect(proposals[1].junctionCode).toBe('E5');
    expect(proposals[2].junctionCode).toBe('E4');
    expect(proposals[3].junctionCode).toBe('E4');
    expect(proposals[1].parentElementForTb).toBe('Wall (N)');
  });

  it('emits four proposals per wall opening', () => {
    const w = makeWindow({ id: 'win-a', name: 'Kitchen window' });
    const proposals = proposeFacadeOpeningThermalBridges([w]);
    expect(proposals).toHaveLength(4);
    expect(proposals.map((p) => p.edgeRole)).toEqual(['lintel', 'sill', 'jamb_first', 'jamb_second']);
    expect(proposals[0].junctionCode).toBe('E1');
    expect(proposals[1].junctionCode).toBe('E3');
    expect(proposals[2].junctionCode).toBe('E4');
    expect(proposals[3].junctionCode).toBe('E4');
    expect(proposals[0].suggestedLengthM).toBe(2);
    expect(proposals[2].suggestedLengthM).toBe(1.2);
  });

  it('emits eight proposals for two windows', () => {
    const a = makeWindow({ id: 'a', name: 'W1' });
    const b = makeWindow({ id: 'b', name: 'W2', coordinates: [{ x: 5, y: 0, z: 0.9 }, { x: 6, y: 0, z: 0.9 }] });
    expect(proposeFacadeOpeningThermalBridges([a, b])).toHaveLength(8);
  });

  it('places lintel at top z and sill at base z', () => {
    const w = makeWindow({ id: 'w', name: 'W', coordinates: [{ x: 0, y: 0, z: 1 }, { x: 2, y: 0, z: 1 }], height: 1.5 });
    const p = proposeFacadeOpeningThermalBridges([w]);
    const sill = p.find((x) => x.edgeRole === 'sill')!;
    const lintel = p.find((x) => x.edgeRole === 'lintel')!;
    expect(sill.coordinates[0].z).toBe(1);
    expect(lintel.coordinates[0].z).toBeCloseTo(2.5, 5);
  });

  it('places jambs at coordinates[0] and coordinates[1] (segment order, not building left/right)', () => {
    const w = makeWindow({
      id: 'w-j',
      name: 'W',
      coordinates: [
        { x: 10, y: 3, z: 0.4 },
        { x: 12, y: 3, z: 0.4 },
      ],
      width: 2,
      height: 1.5,
    });
    const p = proposeFacadeOpeningThermalBridges([w]);
    const first = p.find((x) => x.edgeRole === 'jamb_first')!;
    const second = p.find((x) => x.edgeRole === 'jamb_second')!;
    expect(first.coordinates[0]).toMatchObject({ x: 10, y: 3, z: 0.4 });
    expect(first.coordinates[1]).toMatchObject({ x: 10, y: 3, z: 0.4 + 1.5 });
    expect(second.coordinates[0]).toMatchObject({ x: 12, y: 3, z: 0.4 });
    expect(second.coordinates[1]).toMatchObject({ x: 12, y: 3, z: 0.4 + 1.5 });
    expect(first.suggestedLengthM).toBe(1.5);
    expect(second.suggestedLengthM).toBe(1.5);
  });

  it('swaps jamb_first vs jamb_second XY when the opening line is drawn in reverse order', () => {
    const forward = makeWindow({
      id: 'wf',
      name: 'W',
      coordinates: [
        { x: 1, y: 0, z: 0.9 },
        { x: 3, y: 0, z: 0.9 },
      ],
      width: 2,
      height: 1.2,
    });
    const reversed = makeWindow({
      id: 'wr',
      name: 'W',
      coordinates: [
        { x: 3, y: 0, z: 0.9 },
        { x: 1, y: 0, z: 0.9 },
      ],
      width: 2,
      height: 1.2,
    });
    const pf = proposeFacadeOpeningThermalBridges([forward]);
    const pr = proposeFacadeOpeningThermalBridges([reversed]);
    expect(pf.find((x) => x.edgeRole === 'jamb_first')!.coordinates[0].x).toBe(1);
    expect(pr.find((x) => x.edgeRole === 'jamb_first')!.coordinates[0].x).toBe(3);
    expect(pf.find((x) => x.edgeRole === 'jamb_second')!.coordinates[0].x).toBe(3);
    expect(pr.find((x) => x.edgeRole === 'jamb_second')!.coordinates[0].x).toBe(1);
  });

  it('proposes E6 wall–intermediate-floor when sill matches slab elevation (model floors defined)', () => {
    const floors: Floor[] = [
      { id: 'f0', name: 'Ground', zIndex: 0, height: 2.4, isRoofSpace: false },
      { id: 'f1', name: 'First', zIndex: 1, height: 2.4, isRoofSpace: false },
    ];
    const w = makeWindow({
      id: 'upper-slab',
      name: 'Upper storey opening',
      floorId: 'f1',
      base_height: 2.4,
      coordinates: [
        { x: 0, y: 0, z: 1 },
        { x: 2, y: 0, z: 1 },
      ],
      height: 2.4,
    });
    const p = proposeFacadeOpeningThermalBridges([w], floors);
    expect(p.map((x) => x.edgeRole)).toEqual(['lintel', 'wall_intermediate_floor_foot', 'jamb_first', 'jamb_second']);
    expect(p.find((x) => x.edgeRole === 'sill')).toBeUndefined();
    const wf = p.find((x) => x.edgeRole === 'wall_intermediate_floor_foot')!;
    expect(wf.junctionCode).toBe('E6');
    expect(wf.coordinates[0].z).toBe(2.4);
    expect(wf.coordinates[1].z).toBe(2.4);
  });

  it('does not propose E6 intermediate foot without floor definitions', () => {
    const w = makeWindow({
      id: 'upper',
      name: 'Upper',
      floorId: 'f1',
      base_height: 2.4,
      coordinates: [
        { x: 0, y: 0, z: 1 },
        { x: 2, y: 0, z: 1 },
      ],
      height: 2,
    });
    const p = proposeFacadeOpeningThermalBridges([w]);
    expect(p.some((x) => x.edgeRole === 'wall_intermediate_floor_foot')).toBe(false);
  });

  it('proposes E5 wall–floor instead of E3 sill when opening bottom is at or near ground', () => {
    const w = makeWindow({
      id: 'ground',
      name: 'Full height',
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
      ],
      height: 2.4,
    });
    const p = proposeFacadeOpeningThermalBridges([w]);
    expect(p.map((x) => x.edgeRole)).toEqual(['lintel', 'wall_ground_foot', 'jamb_first', 'jamb_second']);
    expect(p.find((x) => x.edgeRole === 'sill')).toBeUndefined();
    const wg = p.find((x) => x.edgeRole === 'wall_ground_foot')!;
    expect(wg.junctionCode).toBe('E5');
    expect(wg.suggestedLengthM).toBe(2);
    expect(wg.parentElementForTb).toBe('Wall 1');
    expect(wg.reason).toContain('Wall–floor');
  });

  it('uses E6, not E5, for an F1 opening foot linked to a pitch-180 conditioned floor', () => {
    const floors: Floor[] = [{ id: 'f0', name: 'Flat', zIndex: 0, height: 3.5, isRoofSpace: false }];
    const floor = makeConditionedFloor({ id: 'floor', name: 'Internal Floor', floorId: 'f0', pitch: 180 });
    const wall = makeWall({ id: 'wall-1', name: 'Wall 1', floorId: 'f0' });
    const opening = makeWindow({
      id: 'door',
      name: 'Slab-level opening',
      parent_element: 'Wall 1',
      floorId: 'f0',
      base_height: 0,
      coordinates: [
        { x: 1, y: 0, z: 0 },
        { x: 3, y: 0, z: 0 },
      ],
    });

    const p = proposeFacadeOpeningThermalBridges([floor, wall, opening], floors);
    expect(p.some((x) => x.edgeRole === 'wall_ground_foot')).toBe(false);
    const foot = p.find((x) => x.edgeRole === 'wall_intermediate_floor_foot');
    expect(foot?.junctionCode).toBe('E6');
    expect(foot?.coordinates.every((point) => point.z === 0)).toBe(true);
  });

  it.each([
    ['same-storey plate first', false],
    ['upper-storey plate first', true],
  ] as const)('links a ground-storey opening to its same-storey pitch-180 plate with %s', (_label, upperFirst) => {
    const floors: Floor[] = [
      { id: 'f0', name: 'Ground', zIndex: 0, height: 2.4, isRoofSpace: false },
      { id: 'f1', name: 'First', zIndex: 1, height: 2.4, isRoofSpace: false },
    ];
    const sameStoreyPlate = makeConditionedFloor({
      id: 'plate-f0',
      name: 'Ground-storey plate',
      floorId: 'f0',
      pitch: 180,
    });
    const upperStoreyPlate = makeConditionedFloor({
      id: 'plate-f1',
      name: 'Upper-storey plate',
      floorId: 'f1',
      pitch: 180,
      coordinates: [
        { x: 0, y: 0, z: 1 },
        { x: 5, y: 0, z: 1 },
        { x: 5, y: 4, z: 1 },
        { x: 0, y: 4, z: 1 },
      ],
    });
    const wall = makeWall({ id: 'wall-f0', name: 'Ground wall', floorId: 'f0' });
    const opening = makeWindow({
      id: 'opening-f0',
      name: 'Ground opening',
      parent_element: 'Ground wall',
      floorId: 'f0',
      base_height: 0,
    });
    const plates = upperFirst
      ? [upperStoreyPlate, sameStoreyPlate]
      : [sameStoreyPlate, upperStoreyPlate];

    const p = proposeFacadeOpeningThermalBridges([...plates, wall, opening], floors);
    expect(p.some((x) => x.edgeRole === 'wall_ground_foot')).toBe(false);
    expect(p.find((x) => x.edgeRole === 'wall_intermediate_floor_foot')?.junctionCode).toBe('E6');
  });

  it('does not use a party-flagged pitch-180 plate as generic E6 opening-foot evidence', () => {
    const floors: Floor[] = [{ id: 'f0', name: 'Flat', zIndex: 0, height: 3.5, isRoofSpace: false }];
    const partyPlate = makeConditionedFloor({
      id: 'party-plate',
      name: 'Party ceiling',
      floorId: 'f0',
      pitch: 180,
      extra_json: { _vulcan_ui_party_element: true },
    });
    const wall = makeWall({ id: 'wall-party', name: 'Party-floor wall', floorId: 'f0' });
    const opening = makeWindow({
      id: 'opening-party',
      name: 'Party-floor opening',
      parent_element: 'Party-floor wall',
      floorId: 'f0',
      base_height: 0,
    });

    const p = proposeFacadeOpeningThermalBridges([partyPlate, wall, opening], floors);
    expect(p.some((x) => x.edgeRole === 'wall_intermediate_floor_foot')).toBe(false);
  });

  it('keeps E5 for an F1 opening foot linked to a ground slab', () => {
    const floors: Floor[] = [{ id: 'f0', name: 'Ground', zIndex: 0, height: 2.4, isRoofSpace: false }];
    const ground = makeGround({ id: 'ground', name: 'Ground slab', floorId: 'f0' });
    const wall = makeWall({ id: 'wall-1', name: 'Wall 1', floorId: 'f0' });
    const opening = makeWindow({
      id: 'door',
      name: 'Ground door',
      parent_element: 'Wall 1',
      floorId: 'f0',
      base_height: 0,
      coordinates: [
        { x: 1, y: 0, z: 0 },
        { x: 3, y: 0, z: 0 },
      ],
    });

    const p = proposeFacadeOpeningThermalBridges([ground, wall, opening], floors);
    expect(p.some((x) => x.edgeRole === 'wall_intermediate_floor_foot')).toBe(false);
    expect(p.find((x) => x.edgeRole === 'wall_ground_foot')?.junctionCode).toBe('E5');
  });

  it('retains the storey fallback for an F1 opening foot with no floor-element evidence', () => {
    const floors: Floor[] = [{ id: 'f0', name: 'Ground', zIndex: 0, height: 2.4, isRoofSpace: false }];
    const opening = makeWindow({
      id: 'door',
      name: 'Sparse-model door',
      floorId: 'f0',
      base_height: 0,
      coordinates: [
        { x: 1, y: 0, z: 0 },
        { x: 3, y: 0, z: 0 },
      ],
    });

    const p = proposeFacadeOpeningThermalBridges([opening], floors);
    expect(p.some((x) => x.edgeRole === 'wall_intermediate_floor_foot')).toBe(false);
    expect(p.find((x) => x.edgeRole === 'wall_ground_foot')?.junctionCode).toBe('E5');
  });

  it('does not propose opening-foot E5 when the host wall is linked to a basement ground floor', () => {
    const ground = makeGround({
      id: 'g',
      name: 'Basement floor',
      floor_type: 'Heated_basement',
      depth_basement_floor: 2.8,
    });
    const wall = makeWall({ id: 'wall-1', name: 'Wall 1', parent_element: 'Basement floor' });
    const opening = makeWindow({
      id: 'door',
      name: 'Basement door',
      parent_element: 'Wall 1',
      coordinates: [
        { x: 1, y: 0, z: 0 },
        { x: 3, y: 0, z: 0 },
      ],
      height: 2.1,
    });
    const p = proposeFacadeOpeningThermalBridges([ground, wall, opening]);
    expect(p.some((x) => x.edgeRole === 'wall_ground_foot')).toBe(false);
    expect(p.some((x) => x.edgeRole === 'sill')).toBe(true);
  });

  it('proposes E6 opening foot at height_basement_walls for unheated basement walls', () => {
    const ground = makeGround({
      id: 'g',
      name: 'Unheated basement',
      floor_type: 'Unheated_basement',
      depth_basement_floor: 2,
      extra_json: { height_basement_walls: 1 },
    });
    const wall = makeWall({ id: 'wall-1', name: 'Wall 1', parent_element: 'Unheated basement', base_height: 1 });
    const opening = makeWindow({
      id: 'door',
      name: 'Door over unheated basement',
      parent_element: 'Wall 1',
      base_height: 1,
      coordinates: [
        { x: 1, y: 0, z: 0 },
        { x: 3, y: 0, z: 0 },
      ],
      height: 2,
    });
    const p = proposeFacadeOpeningThermalBridges([ground, wall, opening]);
    expect(p.some((x) => x.edgeRole === 'wall_ground_foot')).toBe(false);
    expect(p.find((x) => x.edgeRole === 'sill')).toBeUndefined();
    const wf = p.find((x) => x.edgeRole === 'wall_intermediate_floor_foot')!;
    expect(wf).toBeDefined();
    expect(wf.junctionCode).toBe('E6');
    expect(wf.coordinates[0].z).toBe(1);
    expect(wf.coordinates[1].z).toBe(1);
    expect(wf.parentElementForTb).toBe('Wall 1');
  });

  it('uses linked suspended floor upper surface for ground opening foot', () => {
    const ground = makeGround({
      id: 'g',
      name: 'Suspended floor',
      floor_type: 'Suspended_floor',
      extra_json: { height_upper_surface: 0.15 },
    });
    const wall = makeWall({ id: 'wall-1', name: 'Wall 1', base_height: 0.15 });
    const opening = makeWindow({
      id: 'door',
      name: 'Door',
      parent_element: 'Wall 1',
      base_height: 0.15,
      coordinates: [
        { x: 1, y: 0, z: 0 },
        { x: 3, y: 0, z: 0 },
      ],
      height: 2.1,
    });
    const p = proposeFacadeOpeningThermalBridges([ground, wall, opening]);
    const wg = p.find((x) => x.edgeRole === 'wall_ground_foot')!;
    expect(wg).toBeDefined();
    expect(p.find((x) => x.edgeRole === 'sill')).toBeUndefined();
    expect(wg.coordinates[0].z).toBe(0.15);
    expect(wg.coordinates[1].z).toBe(0.15);
  });

  it('uses linked elevated slab surface for ground opening foot', () => {
    const ground = makeGround({
      id: 'g',
      name: 'Raised slab',
      _base_height: 0.3,
    });
    const wall = makeWall({ id: 'wall-1', name: 'Wall 1', base_height: 0.3 });
    const opening = makeWindow({
      id: 'door',
      name: 'Door',
      parent_element: 'Wall 1',
      base_height: 0.3,
      coordinates: [
        { x: 1, y: 0, z: 0 },
        { x: 3, y: 0, z: 0 },
      ],
      height: 2.1,
    });
    const p = proposeFacadeOpeningThermalBridges([ground, wall, opening]);
    const wg = p.find((x) => x.edgeRole === 'wall_ground_foot')!;
    expect(wg).toBeDefined();
    expect(p.find((x) => x.edgeRole === 'sill')).toBeUndefined();
    expect(wg.coordinates[0].z).toBe(0.3);
    expect(wg.coordinates[1].z).toBe(0.3);
  });

  it('sets parentElementForTb to null for wall–floor when opening has no host wall name', () => {
    const w = makeWindow({
      id: 'g2',
      name: 'Door',
      parent_element: '',
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
      height: 2,
    });
    const p = proposeFacadeOpeningThermalBridges([w]);
    const wg = p.find((x) => x.edgeRole === 'wall_ground_foot')!;
    expect(wg.parentElementForTb).toBeNull();
  });

  it('uses plan segment length for lintel/sill when width property disagrees', () => {
    const w = makeWindow({
      id: 'w',
      name: 'W',
      coordinates: [
        { x: 0, y: 0, z: 0.9 },
        { x: 3, y: 0, z: 0.9 },
      ],
      width: 2,
      height: 1.2,
    });
    const p = proposeFacadeOpeningThermalBridges([w]);
    const lintel = p.find((x) => x.edgeRole === 'lintel')!;
    const sill = p.find((x) => x.edgeRole === 'sill')!;
    expect(lintel.suggestedLengthM).toBe(3);
    expect(sill.suggestedLengthM).toBe(3);
  });

  it('uses min Z across endpoints for jambs when sill heights differ slightly', () => {
    const w = makeWindow({
      id: 'w',
      name: 'W',
      coordinates: [
        { x: 10, y: 0, z: 0.5 },
        { x: 12, y: 0, z: 0.55 },
      ],
      width: 2,
      height: 1.5,
    });
    const p = proposeFacadeOpeningThermalBridges([w]);
    const first = p.find((x) => x.edgeRole === 'jamb_first')!;
    const second = p.find((x) => x.edgeRole === 'jamb_second')!;
    expect(first.coordinates[0].z).toBe(0.5);
    expect(first.coordinates[1].z).toBeCloseTo(0.5 + 1.5, 5);
    expect(second.coordinates[0].z).toBe(0.5);
    expect(second.coordinates[1].z).toBeCloseTo(0.5 + 1.5, 5);
  });

  it('uses rectangular opening (min Z + height) when endpoints have very different Z — both jambs share that sill/head', () => {
    const w = makeWindow({
      id: 'w',
      name: 'Bad Z',
      coordinates: [
        { x: 0, y: 0, z: 0.9 },
        { x: 2, y: 0, z: 1.4 },
      ],
      width: 2,
      height: 1.2,
    });
    const p = proposeFacadeOpeningThermalBridges([w]);
    const lintel = p.find((x) => x.edgeRole === 'lintel')!;
    expect(lintel.coordinates[0].z).toBeCloseTo(0.9 + 1.2, 5);
    const j1 = p.find((x) => x.edgeRole === 'jamb_first')!;
    expect(j1.reason).toContain('different Z');
  });

  it('uses base_height for sill/lintel/jamb Z when coordinates.z is a floor index (CSV multi-storey)', () => {
    const w = makeWindow({
      id: 'upper',
      name: 'Window 1 1',
      base_height: 2.8,
      coordinates: [
        { x: 0, y: 0, z: 1 },
        { x: 2, y: 0, z: 1 },
      ],
      height: 1.2,
      width: 2,
    });
    const p = proposeFacadeOpeningThermalBridges([w]);
    const sill = p.find((x) => x.edgeRole === 'sill')!;
    expect(sill.coordinates[0].z).toBe(2.8);
    const lintel = p.find((x) => x.edgeRole === 'lintel')!;
    expect(lintel.coordinates[0].z).toBeCloseTo(2.8 + 1.2, 5);
    const j1 = p.find((x) => x.edgeRole === 'jamb_first')!;
    expect(j1.coordinates[0].z).toBe(2.8);
    expect(j1.reason).toContain('base_height');
  });

  it('skips non-transparent and invalid windows', () => {
    const opaque = { type: 'BuildingElementOpaque', id: 'o', name: 'Wall', coordinates: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }] } as any;
    expect(proposeFacadeOpeningThermalBridges([opaque])).toHaveLength(0);
  });
});

describe('junctionOptionsForFacadeEdgeRole (full matrix)', () => {
  it('gives every preview edge role at least one dropdown option and a coercible default', () => {
    for (const role of ALL_PREVIEW_EDGE_ROLES) {
      const opts = junctionOptionsForFacadeEdgeRole(role);
      expect(opts.length, role).toBeGreaterThan(0);
      const def = defaultJunctionCodeForEdge(role);
      expect(opts.includes(def), `${role} default ${def} not in ${opts.join(',')}`).toBe(true);
      expect(coerceJunctionCodeForEdgeRole(role, def, undefined)).toBe(def);
      expect(coerceJunctionCodeForEdgeRole(role, def, opts[0])).toBe(opts[0]!);
    }
  });

  it('allows E19 override on ground wall–floor roles', () => {
    expect(junctionOptionsForFacadeEdgeRole('wall_ground_foot')).toContain('E19');
    expect(coerceJunctionCodeForEdgeRole('wall_ground_foot', 'E5', 'E19')).toBe('E19');
  });
});

describe('defaultJunctionCodeForEdge', () => {
  it('maps lintel to E1, sill to E3, wall_ground_foot to E5, wall_intermediate_floor_foot to E6, jambs to E4, corners to E16/E17', () => {
    expect(defaultJunctionCodeForEdge('lintel')).toBe('E1');
    expect(defaultJunctionCodeForEdge('sill')).toBe('E3');
    expect(defaultJunctionCodeForEdge('wall_ground_foot')).toBe('E5');
    expect(defaultJunctionCodeForEdge('wall_ground_continuous')).toBe('E5');
    expect(defaultJunctionCodeForEdge('wall_intermediate_floor_foot')).toBe('E6');
    expect(defaultJunctionCodeForEdge('wall_intermediate_continuous')).toBe('E6');
    expect(defaultJunctionCodeForEdge('jamb_first')).toBe('E4');
    expect(defaultJunctionCodeForEdge('jamb_second')).toBe('E4');
    expect(defaultJunctionCodeForEdge('external_corner_convex')).toBe('E16');
    expect(defaultJunctionCodeForEdge('external_corner_reentrant')).toBe('E17');
    expect(defaultJunctionCodeForEdge('party_wall_junction')).toBe('P2');
    expect(defaultJunctionCodeForEdge('unheated_adjacent_wall_junction')).toBe('E20');
    expect(defaultJunctionCodeForEdge('roof_window_head')).toBe('R1');
    expect(defaultJunctionCodeForEdge('roof_window_sill')).toBe('R2');
    expect(defaultJunctionCodeForEdge('roof_window_jamb_first')).toBe('R3');
  });
});

function makeTb(overrides: Partial<ThermalBridgeLinear> & Pick<ThermalBridgeLinear, 'id' | 'coordinates'>): ThermalBridgeLinear {
  return {
    type: 'ThermalBridgeLinear',
    name: 'TB',
    zoneId: 'z1',
    length: 1,
    linear_thermal_transmittance: 0.1,
    parent_element: null,
    isPlaceholder: false,
    ...overrides,
  } as ThermalBridgeLinear;
}

describe('annotateProposalsWithDedupe', () => {
  it('marks duplicate when existing TB matches code and midpoint', () => {
    const w = makeWindow({ id: 'win-a', name: 'W1' });
    const proposals = proposeFacadeOpeningThermalBridges([w]);
    const sill = proposals.find((p) => p.edgeRole === 'sill')!;
    const tb = makeTb({
      id: 'tb-existing',
      coordinates: [sill.coordinates[0], sill.coordinates[1]],
      extra_json: { junction_type: 'E3' },
    });
    const ann = annotateProposalsWithDedupe(proposals, [w, tb]);
    const sillAnn = ann.find((p) => p.edgeRole === 'sill')!;
    expect(sillAnn.status).toBe('duplicate');
    expect(sillAnn.matchedExistingId).toBe('tb-existing');
    const lintelAnn = ann.find((p) => p.edgeRole === 'lintel')!;
    expect(lintelAnn.status).toBe('new');
  });

  it('does not match when junction_type differs', () => {
    const w = makeWindow({ id: 'win-a', name: 'W1' });
    const proposals = proposeFacadeOpeningThermalBridges([w]);
    const sill = proposals.find((p) => p.edgeRole === 'sill')!;
    const tb = makeTb({
      id: 'tb-wrong-code',
      coordinates: [sill.coordinates[0], sill.coordinates[1]],
      extra_json: { junction_type: 'E1' },
    });
    const sillAnn = annotateProposalsWithDedupe(proposals, [w, tb]).find((p) => p.edgeRole === 'sill')!;
    expect(sillAnn.status).toBe('new');
  });

  it('does not match when midpoint is beyond tolerance', () => {
    const w = makeWindow({ id: 'win-a', name: 'W1' });
    const proposals = proposeFacadeOpeningThermalBridges([w]);
    const sill = proposals.find((p) => p.edgeRole === 'sill')!;
    const shifted = {
      ...sill.coordinates[0],
      x: sill.coordinates[0].x + DEFAULT_TB_DEDUPE_TOLERANCE_M * 3,
    };
    const tb = makeTb({
      id: 'tb-far',
      coordinates: [shifted, { ...sill.coordinates[1], x: sill.coordinates[1].x + DEFAULT_TB_DEDUPE_TOLERANCE_M * 3 }],
      extra_json: { junction_type: 'E3' },
    });
    const sillAnn = annotateProposalsWithDedupe(proposals, [w, tb]).find((p) => p.edgeRole === 'sill')!;
    expect(sillAnn.status).toBe('new');
  });

  it('matches when midpoint within default tolerance', () => {
    const w = makeWindow({ id: 'win-a', name: 'W1' });
    const proposals = proposeFacadeOpeningThermalBridges([w]);
    const sill = proposals.find((p) => p.edgeRole === 'sill')!;
    const dx = DEFAULT_TB_DEDUPE_TOLERANCE_M * 0.5;
    const tb = makeTb({
      id: 'tb-near',
      coordinates: [
        { ...sill.coordinates[0], x: sill.coordinates[0].x + dx },
        { ...sill.coordinates[1], x: sill.coordinates[1].x + dx },
      ],
      extra_json: { junction_type: 'E3' },
    });
    const sillAnn = annotateProposalsWithDedupe(proposals, [w, tb]).find((p) => p.edgeRole === 'sill')!;
    expect(sillAnn.status).toBe('duplicate');
    expect(sillAnn.matchedExistingId).toBe('tb-near');
  });

  it('marks duplicate for wall_ground_foot when existing TB matches E5 and midpoint', () => {
    const w = makeWindow({
      id: 'ground-win',
      name: 'Door',
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
      ],
      height: 2,
    });
    const proposals = proposeFacadeOpeningThermalBridges([w]);
    const wg = proposals.find((p) => p.edgeRole === 'wall_ground_foot')!;
    const tb = makeTb({
      id: 'tb-e5-foot',
      coordinates: [wg.coordinates[0], wg.coordinates[1]],
      extra_json: { junction_type: 'E5' },
    });
    const ann = annotateProposalsWithDedupe(proposals, [w, tb]).find((p) => p.edgeRole === 'wall_ground_foot')!;
    expect(ann.status).toBe('duplicate');
    expect(ann.matchedExistingId).toBe('tb-e5-foot');
  });

  it('ignores placeholder thermal bridges', () => {
    const w = makeWindow({ id: 'win-a', name: 'W1' });
    const proposals = proposeFacadeOpeningThermalBridges([w]);
    const sill = proposals.find((p) => p.edgeRole === 'sill')!;
    const tb = makeTb({
      id: 'ph',
      coordinates: [sill.coordinates[0], sill.coordinates[1]],
      extra_json: { junction_type: 'E3' },
      isPlaceholder: true,
    });
    const sillAnn = annotateProposalsWithDedupe(proposals, [w, tb]).find((p) => p.edgeRole === 'sill')!;
    expect(sillAnn.status).toBe('new');
  });

  it('does not match existing TB without extra_json junction_type', () => {
    const w = makeWindow({ id: 'win-a', name: 'W1' });
    const proposals = proposeFacadeOpeningThermalBridges([w]);
    const sill = proposals.find((p) => p.edgeRole === 'sill')!;
    const tb = makeTb({
      id: 'no-jt',
      coordinates: [sill.coordinates[0], sill.coordinates[1]],
      extra_json: {},
    });
    const sillAnn = annotateProposalsWithDedupe(proposals, [w, tb]).find((p) => p.edgeRole === 'sill')!;
    expect(sillAnn.status).toBe('new');
  });

  it('respects custom tolerance', () => {
    const w = makeWindow({ id: 'win-a', name: 'W1' });
    const proposals = proposeFacadeOpeningThermalBridges([w]);
    const sill = proposals.find((p) => p.edgeRole === 'sill')!;
    const dx = 0.05;
    const tb = makeTb({
      id: 'tb',
      coordinates: [
        { ...sill.coordinates[0], x: sill.coordinates[0].x + dx },
        { ...sill.coordinates[1], x: sill.coordinates[1].x + dx },
      ],
      extra_json: { junction_type: 'E3' },
    });
    expect(
      annotateProposalsWithDedupe(proposals, [w, tb], 0.01).find((p) => p.edgeRole === 'sill')!.status,
    ).toBe('new');
    expect(
      annotateProposalsWithDedupe(proposals, [w, tb], 0.2).find((p) => p.edgeRole === 'sill')!.status,
    ).toBe('duplicate');
  });
});

describe('psiTable37ForCode', () => {
  it('returns Table 3.7 values for E1–E4 and corners', () => {
    expect(psiTable37ForCode('E3')).toBe(0.1);
    expect(psiTable37ForCode('E1')).toBe(1.0);
    expect(psiTable37ForCode('E16')).toBe(0.18);
    expect(psiTable37ForCode('E17')).toBe(0);
  });
});
