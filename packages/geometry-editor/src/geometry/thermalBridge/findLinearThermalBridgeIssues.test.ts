// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type {
  BuildingElementOpaque,
  BuildingElementTransparent,
  Element,
  ThermalBridgeLinear,
} from '../types';
import { findLinearThermalBridgeIssues } from './findLinearThermalBridgeIssues';

function wall(
  id: string,
  name: string,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): BuildingElementOpaque {
  const len = Math.hypot(x1 - x0, y1 - y0);
  return {
    type: 'BuildingElementOpaque',
    id,
    name,
    zoneId: 'z1',
    parent_element: null,
    coordinates: [
      { x: x0, y: y0, z: 0 },
      { x: x1, y: y1, z: 0 },
    ],
    width: len,
    height: 2.4,
    area: len * 2.4,
    pitch: 90,
    isPlaceholder: false,
  } as BuildingElementOpaque;
}

function tbLinear(
  id: string,
  jt: string,
  parent: string | null,
  coords: [{ x: number; y: number; z: number }, { x: number; y: number; z: number }],
  extra: Record<string, unknown> = {},
): ThermalBridgeLinear {
  return {
    type: 'ThermalBridgeLinear',
    id,
    name: id,
    zoneId: 'z1',
    parent_element: parent,
    length: 2,
    linear_thermal_transmittance: 0.1,
    coordinates: coords,
    isPlaceholder: false,
    extra_json: { junction_type: jt, ...extra },
  } as ThermalBridgeLinear;
}

describe('findLinearThermalBridgeIssues', () => {
  it('flags unresolved parent', () => {
    const t = tbLinear('t1', 'E4', 'no-such-name', [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 2.4 },
    ]);
    const issues = findLinearThermalBridgeIssues([t] as Element[]);
    const u = issues.find((i) => i.kind === 'orphan_unresolved_parent');
    expect(u).toBeDefined();
    expect(u!.category).toBe('reference_unresolved');
  });

  it('no issue when parent resolves by name (façade opening host for E4)', () => {
    const win: BuildingElementTransparent = {
      type: 'BuildingElementTransparent',
      id: 'win',
      name: 'Win',
      zoneId: 'z1',
      parent_element: null,
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 3, y: 0, z: 0 },
      ],
      width: 3,
      height: 2.4,
      area: 7.2,
      pitch: 90,
      isPlaceholder: false,
    } as BuildingElementTransparent;
    const t = tbLinear('t1', 'E4', 'Win', [
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 0, z: 2.4 },
    ]);
    const issues = findLinearThermalBridgeIssues([win, t] as Element[]);
    expect(issues).toHaveLength(0);
  });

  it('E16 without thermal_bridge_source is error', () => {
    const t = tbLinear('t1', 'E16', 'Ext', [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 2.4 },
    ]);
    const w = wall('w1', 'Ext', 0, 0, 3, 0);
    const issues = findLinearThermalBridgeIssues([w, t] as Element[]);
    expect(issues.some((i) => i.kind === 'orphan_e16e17_incomplete_walls')).toBe(true);
  });

  it('E16 ok with two wall ids in extra', () => {
    const a = wall('wa', 'A', 0, 0, 1, 0);
    const b = wall('wb', 'B', 0, 0, 0, 1);
    const t = tbLinear(
      't1',
      'E16',
      'A',
      [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 2.4 },
      ],
      {
        thermal_bridge_source: { host_wall_id: 'wa', host_wall_b_id: 'wb' },
      },
    );
    const issues = findLinearThermalBridgeIssues([a, b, t] as Element[]);
    expect(issues).toHaveLength(0);
  });

  it('E16 warns when TB plan position is away from wall–wall intersection', () => {
    const a = wall('wa', 'A', 0, 0, 1, 0);
    const b = wall('wb', 'B', 0, 0, 0, 1);
    const t = tbLinear(
      't1',
      'E16',
      'A',
      [
        { x: 1, y: 0, z: 0 },
        { x: 1, y: 0, z: 2.4 },
      ],
      {
        thermal_bridge_source: { host_wall_id: 'wa', host_wall_b_id: 'wb' },
      },
    );
    const issues = findLinearThermalBridgeIssues([a, b, t] as Element[]);
    const c = issues.find((i) => i.kind === 'mismatch_e16e17_corner_plan');
    expect(c).toBeDefined();
    expect(c!.category).toBe('multi_host_geometry');
  });

  it('mismatch_tb_plan_alignment when TB runs beyond matched host edge segment', () => {
    const win: BuildingElementTransparent = {
      type: 'BuildingElementTransparent',
      id: 'win',
      name: 'Win',
      zoneId: 'z1',
      parent_element: null,
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 8, y: 0, z: 0 },
      ],
      width: 8,
      height: 2.4,
      area: 19.2,
      pitch: 90,
      isPlaceholder: false,
    } as BuildingElementTransparent;
    const t = tbLinear('t1', 'E4', 'Win', [
      { x: -1, y: 0, z: 0 },
      { x: 9, y: 0, z: 0 },
    ]);
    const issues = findLinearThermalBridgeIssues([win, t] as Element[]);
    const al = issues.find((i) => i.kind === 'mismatch_tb_plan_alignment');
    expect(al).toBeDefined();
    expect(al!.category).toBe('outline_geometry');
  });

  it('R1 on façade window is mismatch warning', () => {
    const win: BuildingElementTransparent = {
      type: 'BuildingElementTransparent',
      id: 'win',
      name: 'W',
      zoneId: 'z1',
      parent_element: 'Ext',
      coordinates: [
        { x: 1, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
      ],
      width: 1,
      height: 1,
      area: 1,
      pitch: 90,
      isPlaceholder: false,
    } as BuildingElementTransparent;
    const t = tbLinear('t1', 'R1', 'W', [
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    ]);
    const issues = findLinearThermalBridgeIssues([win, t] as Element[]);
    expect(issues.some((i) => i.kind === 'mismatch_junction_parent_host_pattern')).toBe(true);
  });

  it('R1 on opaque wall is mismatch (not just façade transparent)', () => {
    const w = wall('w1', 'Ext', 0, 0, 3, 0);
    const t = tbLinear('t1', 'R1', 'Ext', [
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    ]);
    const issues = findLinearThermalBridgeIssues([w, t] as Element[]);
    expect(issues.some((i) => i.kind === 'mismatch_junction_parent_host_pattern')).toBe(true);
  });

  it.each([
    ['pitch 0 (flat rooflight)', 0],
    ['pitch 30° (sloped)', 30],
    ['pitch 45° (sloped)', 45],
  ] as const)('R1 on roof window %s is not flagged', (_label, pitch) => {
    const roofWin: BuildingElementTransparent = {
      type: 'BuildingElementTransparent',
      id: 'rw',
      name: 'Skylight',
      zoneId: 'z1',
      parent_element: 'R',
      coordinates: [
        { x: 1, y: 0, z: 3 },
        { x: 2, y: 0, z: 3 },
      ],
      width: 1,
      height: 0.5,
      area: 0.5,
      pitch,
      isPlaceholder: false,
    } as BuildingElementTransparent;
    const t = tbLinear('t1', 'R1', 'Skylight', [
      { x: 1, y: 0, z: 3.5 },
      { x: 2, y: 0, z: 3.5 },
    ]);
    const issues = findLinearThermalBridgeIssues([roofWin, t] as Element[]);
    expect(issues).toHaveLength(0);
  });

  it('unknown junction type is warning', () => {
    const t = tbLinear('t1', 'E999', 'Ext', [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
    ]);
    const w = wall('w1', 'Ext', 0, 0, 3, 0);
    const issues = findLinearThermalBridgeIssues([w, t] as Element[]);
    expect(issues.some((i) => i.kind === 'mismatch_unknown_junction_type')).toBe(true);
  });

  function pitchedRoofQuad(id: string, name: string): BuildingElementOpaque {
    return {
      type: 'BuildingElementOpaque',
      id,
      name,
      zoneId: 'z1',
      parent_element: null,
      coordinates: [
        { x: 0, y: 0, z: 3 },
        { x: 8, y: 0, z: 3 },
        { x: 8, y: 6, z: 3 },
        { x: 0, y: 6, z: 3 },
      ],
      width: 8,
      height: 6,
      area: 48,
      pitch: 45,
      isPlaceholder: false,
    } as BuildingElementOpaque;
  }

  it('polygon host: TB along nearest plan edge is not far-from-host', () => {
    const r = pitchedRoofQuad('r1', 'Roof Quad');
    const t = tbLinear('t1', 'E10', 'Roof Quad', [
      { x: 0, y: 0, z: 3 },
      { x: 8, y: 0, z: 3 },
    ]);
    const issues = findLinearThermalBridgeIssues([r, t] as Element[]);
    expect(issues.filter((i) => i.kind === 'orphan_segment_far_from_host')).toHaveLength(0);
  });

  it('polygon host: TB midline far from every edge flags orphan_segment_far_from_host', () => {
    const r = pitchedRoofQuad('r1', 'Roof Quad');
    const t = tbLinear('t1', 'E10', 'Roof Quad', [
      { x: 4, y: 3, z: 3 },
      { x: 4, y: 3.1, z: 3 },
    ]);
    const issues = findLinearThermalBridgeIssues([r, t] as Element[]);
    expect(issues.some((i) => i.kind === 'orphan_segment_far_from_host')).toBe(true);
  });

  it('R8 interior to roof plan: still flags far-from-host without roof-adjacent thermal_bridge_source pair', () => {
    const r = pitchedRoofQuad('r1', 'Pitched Roof (S)');
    const t = tbLinear('t1', 'R8', 'Pitched Roof (S)', [
      { x: 4, y: 3, z: 3 },
      { x: 5.386, y: 3, z: 3 },
    ]);
    const issues = findLinearThermalBridgeIssues([r, t] as Element[]);
    expect(issues.some((i) => i.kind === 'orphan_segment_far_from_host')).toBe(true);
  });

  it('R8 interior to roof plan: skips outline issues when thermal_bridge_source has sloped roof + adjacent ids', () => {
    const r = pitchedRoofQuad('r1', 'Pitched Roof (S)');
    const w = wall('w-d', 'Dormer cheek', 4, 3, 4, 6);
    const t = tbLinear(
      't1',
      'R8',
      'Pitched Roof (S)',
      [
        { x: 4, y: 3, z: 3 },
        { x: 5.386, y: 3, z: 3 },
      ],
      {
        thermal_bridge_source: { host_wall_id: 'r1', host_wall_b_id: 'w-d' },
      },
    );
    const issues = findLinearThermalBridgeIssues([r, w, t] as Element[]);
    expect(issues.filter((i) => i.kind === 'orphan_segment_far_from_host')).toHaveLength(0);
    expect(issues.filter((i) => i.kind === 'mismatch_tb_plan_alignment')).toHaveLength(0);
  });

  it('R10 interior to roof plan: skips outline issues when thermal_bridge_source has sloped roof + dormer roof ids', () => {
    const r = pitchedRoofQuad('r1', 'Pitched Roof (S)');
    const dormerRoof = {
      ...pitchedRoofQuad('dormer-roof', 'Dormer roof'),
      coordinates: [
        { x: 3, y: 2, z: 3 },
        { x: 5, y: 2, z: 3 },
        { x: 5, y: 4, z: 3 },
        { x: 3, y: 4, z: 3 },
      ],
    } as BuildingElementOpaque;
    const t = tbLinear(
      't1',
      'R10',
      'Pitched Roof (S)',
      [
        { x: 3.5, y: 3, z: 3 },
        { x: 4.5, y: 3, z: 3 },
      ],
      {
        thermal_bridge_source: { host_wall_id: 'r1', host_wall_b_id: 'dormer-roof' },
      },
    );
    const issues = findLinearThermalBridgeIssues([r, dormerRoof, t] as Element[]);
    expect(issues.filter((i) => i.kind === 'orphan_segment_far_from_host')).toHaveLength(0);
    expect(issues.filter((i) => i.kind === 'mismatch_tb_plan_alignment')).toHaveLength(0);
  });

  it('does not flag colinear overlap for E5 vs P1 (same wall–ground line from different auto passes)', () => {
    const a = tbLinear('tb-a', 'E5', null, [
      { x: 0, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
    ]);
    const b = tbLinear('tb-b', 'P1', null, [
      { x: 0, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
    ]);
    const issues = findLinearThermalBridgeIssues([a, b] as Element[]);
    expect(issues.filter((i) => i.kind === 'overlap_duplicate_colinear_segment')).toHaveLength(0);
  });

  it('flags pairwise overlap_duplicate_colinear_segment for coincident runs (any junction_type)', () => {
    const a = tbLinear('tb-a', 'E5', null, [
      { x: 0, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
    ]);
    const b = tbLinear('tb-b', 'E20', null, [
      { x: 1, y: 0, z: 0 },
      { x: 5, y: 0, z: 0 },
    ]);
    const issues = findLinearThermalBridgeIssues([a, b] as Element[]);
    const overlap = issues.filter((i) => i.kind === 'overlap_duplicate_colinear_segment');
    expect(overlap).toHaveLength(2);
    expect(overlap.every((i) => i.severity === 'error')).toBe(true);
  });

  it('does not flag coincident different-code TBs when known host identity sets are different', () => {
    const a = tbLinear(
      'tb-a',
      'E13',
      null,
      [
        { x: 0, y: 0, z: 3 },
        { x: 4, y: 0, z: 3.2 },
      ],
      { thermal_bridge_source: { host_wall_id: 'dormer-roof', host_wall_b_id: 'dormer-roof' } },
    );
    const b = tbLinear(
      'tb-b',
      'R8',
      null,
      [
        { x: 0, y: 0, z: 3 },
        { x: 4, y: 0, z: 3.2 },
      ],
      { thermal_bridge_source: { host_wall_id: 'main-roof', host_wall_b_id: 'dormer-front-wall' } },
    );
    const issues = findLinearThermalBridgeIssues([a, b] as Element[]);
    expect(issues.filter((i) => i.kind === 'overlap_duplicate_colinear_segment')).toHaveLength(0);
  });

  it('flags coincident different-code TBs when known host identity sets match', () => {
    const a = tbLinear(
      'tb-a',
      'E13',
      null,
      [
        { x: 0, y: 0, z: 3 },
        { x: 4, y: 0, z: 3.2 },
      ],
      { thermal_bridge_source: { host_wall_id: 'roof', host_wall_b_id: 'wall' } },
    );
    const b = tbLinear(
      'tb-b',
      'R8',
      null,
      [
        { x: 0, y: 0, z: 3 },
        { x: 4, y: 0, z: 3.2 },
      ],
      { thermal_bridge_source: { host_wall_id: 'wall', host_wall_b_id: 'roof' } },
    );
    const issues = findLinearThermalBridgeIssues([a, b] as Element[]);
    expect(issues.filter((i) => i.kind === 'overlap_duplicate_colinear_segment')).toHaveLength(2);
  });

  it('does not flag TBs on parallel tracks separated in Z', () => {
    const a = tbLinear('tb-a', 'E5', null, [
      { x: 0, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
    ]);
    const b = tbLinear('tb-b', 'E20', null, [
      { x: 0, y: 0, z: 2.4 },
      { x: 4, y: 0, z: 2.4 },
    ]);
    const issues = findLinearThermalBridgeIssues([a, b] as Element[]);
    expect(issues.filter((i) => i.kind === 'overlap_duplicate_colinear_segment')).toHaveLength(0);
  });

  it('flags overlapping duct runs (within duct type only)', () => {
    const duct = (
      id: string,
      x0: number,
      y0: number,
      x1: number,
      y1: number,
    ): Element =>
      ({
        type: 'MechanicalVentilationDuctwork',
        id,
        name: id,
        zoneId: 'z1',
        parent_element: 'MV',
        duct_type: 'supply',
        length: 4,
        coordinates: [
          { x: x0, y: y0, z: 0 },
          { x: x1, y: y1, z: 0 },
        ],
        isPlaceholder: false,
      }) as Element;

    const issues = findLinearThermalBridgeIssues([
      duct('d-a', 0, 0, 5, 0),
      duct('d-b', 2, 0, 6, 0),
    ] as Element[]);
    const overlap = issues.filter((i) => i.kind === 'overlap_duplicate_colinear_segment');
    expect(overlap).toHaveLength(2);
    expect(overlap.every((i) => i.message.includes('duct run'))).toBe(true);
  });

  it('does not flag duct vs thermal bridge on same line (cross-type)', () => {
    const tb = tbLinear('tb-a', 'E5', null, [
      { x: 0, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
    ]);
    const duct: Element = {
      type: 'MechanicalVentilationDuctwork',
      id: 'd1',
      name: 'D',
      zoneId: 'z1',
      parent_element: 'MV',
      duct_type: 'supply',
      length: 4,
      coordinates: [
        { x: 1, y: 0, z: 0 },
        { x: 5, y: 0, z: 0 },
      ],
      isPlaceholder: false,
    } as Element;
    const issues = findLinearThermalBridgeIssues([tb, duct] as Element[]);
    expect(issues.filter((i) => i.kind === 'overlap_duplicate_colinear_segment')).toHaveLength(0);
  });
});
