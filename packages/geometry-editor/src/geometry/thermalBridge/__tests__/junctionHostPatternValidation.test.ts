// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Realistic composable hosts per {@link JunctionProposerHostPattern}: predicates + issue finder integration.
 */
import { describe, expect, it } from 'vitest';
import type {
  BuildingElementAdjacentConditionedSpace,
  BuildingElementGround,
  BuildingElementOpaque,
  BuildingElementPartyWall,
  BuildingElementTransparent,
  Element,
  ThermalBridgeLinear,
} from '../../types';
import { findLinearThermalBridgeIssues } from '../findLinearThermalBridgeIssues';
import { junctionCodesInFacadeAutoModal } from '../facadeAutoTbScope';
import { validateHostForProposerPattern } from '../junctionHostPredicates';
import { getJunctionContract } from '../junctionContractRegistry';

function tbLinear(
  id: string,
  junctionType: string,
  parentName: string | null,
  coords: [{ x: number; y: number; z: number }, { x: number; y: number; z: number }],
  extra: Record<string, unknown> = {},
): ThermalBridgeLinear {
  const p0 = coords[0]!;
  const p1 = coords[1]!;
  const len = Math.hypot(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z);
  return {
    type: 'ThermalBridgeLinear',
    id,
    name: id,
    zoneId: 'z',
    parent_element: parentName,
    coordinates: coords,
    length: len,
    linear_thermal_transmittance: 0.08,
    isPlaceholder: false,
    extra_json: { junction_type: junctionType, ...extra },
  } as ThermalBridgeLinear;
}

function extWall(id: string, name: string): BuildingElementOpaque {
  return {
    type: 'BuildingElementOpaque',
    id,
    name,
    zoneId: 'z',
    parent_element: null,
    coordinates: [
      { x: 0, y: 0, z: 0 },
      { x: 6, y: 0, z: 0 },
    ],
    width: 6,
    height: 2.5,
    area: 15,
    pitch: 90,
    isPlaceholder: false,
  } as BuildingElementOpaque;
}

function facadeWin(name: string): BuildingElementTransparent {
  return {
    type: 'BuildingElementTransparent',
    id: `win-${name}`,
    name,
    zoneId: 'z',
    parent_element: null,
    coordinates: [
      { x: 1, y: 0, z: 0 },
      { x: 5, y: 0, z: 0 },
    ],
    width: 4,
    height: 2,
    area: 8,
    pitch: 90,
    isPlaceholder: false,
  } as BuildingElementTransparent;
}

function pitchedRoof(label: string): BuildingElementOpaque {
  return {
    type: 'BuildingElementOpaque',
    id: `roof-${label}`,
    /** `isRoofLikeOpaqueElement` / eaves pass expect name or flag to identify roof fabric */
    name: `roof ${label}`,
    zoneId: 'z',
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

function flatRoofDeck(name: string): BuildingElementOpaque {
  return {
    type: 'BuildingElementOpaque',
    id: `flat-${name}`,
    name: 'deck roof',
    zoneId: 'z',
    parent_element: null,
    coordinates: [
      { x: 0, y: 0, z: 4 },
      { x: 10, y: 0, z: 4 },
    ],
    width: 10,
    height: 0.2,
    area: 2,
    pitch: 0,
    is_unheated_pitched_roof: true,
    isPlaceholder: false,
  } as BuildingElementOpaque;
}

function opaqueWallLine(
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
    zoneId: 'z',
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

function roofWindow(name: string): BuildingElementTransparent {
  return {
    type: 'BuildingElementTransparent',
    id: `rw-${name}`,
    name,
    zoneId: 'z',
    parent_element: null,
    coordinates: [
      { x: 1, y: 0, z: 3 },
      { x: 4, y: 0, z: 3 },
    ],
    width: 3,
    height: 1,
    area: 3,
    pitch: 35,
    isPlaceholder: false,
  } as BuildingElementTransparent;
}

function partyWallSeg(id: string, name: string): BuildingElementPartyWall {
  return {
    type: 'BuildingElementPartyWall',
    id,
    name,
    zoneId: 'z',
    parent_element: null,
    coordinates: [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 4, z: 0 },
    ],
    width: 4,
    height: 2.4,
    area: 10,
    pitch: 90,
    isPlaceholder: false,
  } as BuildingElementPartyWall;
}

function basementGround(name: string): BuildingElementGround {
  return {
    type: 'BuildingElementGround',
    id: `g-${name}`,
    name,
    zoneId: 'z',
    parent_element: null,
    coordinates: [
      { x: 0, y: 0, z: -2 },
      { x: 5, y: 0, z: -2 },
      { x: 5, y: 4, z: -2 },
      { x: 0, y: 4, z: -2 },
    ],
    floor_type: 'Heated_basement',
    width: 5,
    height: 0,
    area: 20,
    total_area: 20,
    perimeter: 18,
    isPlaceholder: false,
  } as BuildingElementGround;
}

describe('validateHostForProposerPattern (aligned with proposers)', () => {
  it('accepts façade opening for facade_opening_2pt', () => {
    const p = getJunctionContract('E1')!.proposerHostPattern;
    expect(validateHostForProposerPattern(facadeWin('W'), p, 'E1').ok).toBe(true);
    expect(validateHostForProposerPattern(extWall('w', 'Wall'), p, 'E1').ok).toBe(false);
  });

  it('accepts external wall for external_opaque_wall_2pt', () => {
    const p = getJunctionContract('E5')!.proposerHostPattern;
    expect(validateHostForProposerPattern(extWall('w', 'Wall'), p, 'E5').ok).toBe(true);
    expect(validateHostForProposerPattern(facadeWin('W'), p, 'E5').ok).toBe(false);
  });

  it('accepts sloped roof opaque for roof_opaque_polygon_edge', () => {
    const p = getJunctionContract('E10')!.proposerHostPattern;
    expect(validateHostForProposerPattern(pitchedRoof('R'), p, 'E10').ok).toBe(true);
    expect(validateHostForProposerPattern(extWall('w', 'Wall'), p, 'E10').ok).toBe(false);
  });

  it('accepts flat deck for flat_roof_deck_2pt_or_polygon', () => {
    const p = getJunctionContract('E14')!.proposerHostPattern;
    expect(validateHostForProposerPattern(flatRoofDeck('D'), p, 'E14').ok).toBe(true);
  });

  it('accepts basement ground for ground_basement_polygon_edge', () => {
    const p = getJunctionContract('E22')!.proposerHostPattern;
    expect(validateHostForProposerPattern(basementGround('B'), p, 'E22').ok).toBe(true);
  });

  const roofPolyPattern = getJunctionContract('R4')!.proposerHostPattern;

  it('roof_polygon_or_window_edge: R4/R5 require sloped roof opaque only', () => {
    const rw = { ...facadeWin('RW'), pitch: 30 } as BuildingElementTransparent;
    expect(validateHostForProposerPattern(pitchedRoof('ridge'), roofPolyPattern, 'R4').ok).toBe(true);
    expect(validateHostForProposerPattern(pitchedRoof('ridge'), roofPolyPattern, 'R5').ok).toBe(true);
    expect(validateHostForProposerPattern(rw, roofPolyPattern, 'R4').ok).toBe(false);
    expect(validateHostForProposerPattern(flatRoofDeck('flat'), roofPolyPattern, 'R4').ok).toBe(false);
  });

  it('roof_polygon_or_window_edge: R6–R10 keep manual/import tolerance for roof opaque or roof window', () => {
    const rw = { ...facadeWin('RW'), pitch: 30 } as BuildingElementTransparent;
    expect(validateHostForProposerPattern(pitchedRoof('ridge'), roofPolyPattern, 'R8').ok).toBe(true);
    expect(validateHostForProposerPattern(rw, roofPolyPattern, 'R9').ok).toBe(true);
    expect(validateHostForProposerPattern(extWall('w', 'Wall'), roofPolyPattern, 'R7').ok).toBe(false);
  });

  it('roof_polygon_or_window_edge: R11 requires roof window opening only', () => {
    expect(validateHostForProposerPattern(roofWindow('R11'), roofPolyPattern, 'R11').ok).toBe(true);
    expect(validateHostForProposerPattern(pitchedRoof('ridge'), roofPolyPattern, 'R11').ok).toBe(false);
  });

  it('external_wall_plus_adjacent_segment (E20) rejects non-fabric element types', () => {
    const p = getJunctionContract('E20')!.proposerHostPattern;
    const fake = {
      type: 'ThermalBridgeLinear',
      id: 'x',
      name: 'x',
      zoneId: 'z',
      isPlaceholder: false,
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
    } as unknown as Element;
    expect(validateHostForProposerPattern(fake, p, 'E20').ok).toBe(false);
    expect(validateHostForProposerPattern(extWall('w-e20', 'South'), p, 'E20').ok).toBe(true);
  });

  it('P1–P3 / P7 hosts: party wall, BuildingElementGround, or horizontal floor line', () => {
    const p = getJunctionContract('P2')!.proposerHostPattern;
    expect(validateHostForProposerPattern(partyWallSeg('pw', 'Party'), p, 'P2').ok).toBe(true);
    expect(validateHostForProposerPattern(extWall('ext-p', 'External'), p, 'P2').ok).toBe(false);

    const adjVertical: BuildingElementAdjacentConditionedSpace = {
      type: 'BuildingElementAdjacentConditionedSpace',
      id: 'adj',
      name: 'Adj',
      zoneId: 'z',
      parent_element: null,
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 4, z: 0 },
      ],
      width: 4,
      height: 2.5,
      area: 10,
      pitch: 90,
      isPlaceholder: false,
    } as BuildingElementAdjacentConditionedSpace;
    expect(validateHostForProposerPattern(adjVertical, p, 'P2').ok).toBe(false);

    const adjHorizontal: BuildingElementAdjacentConditionedSpace = {
      ...adjVertical,
      id: 'adjH',
      pitch: 0,
      height: 0.2,
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 4, y: 0, z: 0 },
      ],
    } as BuildingElementAdjacentConditionedSpace;
    expect(validateHostForProposerPattern(adjHorizontal, p, 'P2').ok).toBe(true);

    const slab: BuildingElementGround = {
      type: 'BuildingElementGround',
      id: 'g',
      name: 'G',
      zoneId: 'z',
      parent_element: null,
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 0, y: 1, z: 0 },
      ],
      width: 0,
      height: 0,
      area: 1,
      total_area: 1,
      perimeter: 4,
      floor_type: 'Suspended_floor',
    };
    expect(validateHostForProposerPattern(slab, p, 'P1').ok).toBe(true);

    const adjPitchBad: BuildingElementAdjacentConditionedSpace = {
      ...adjVertical,
      id: 'adj2',
      pitch: 15,
    } as BuildingElementAdjacentConditionedSpace;
    expect(validateHostForProposerPattern(adjPitchBad, p, 'P2').ok).toBe(false);
  });
});

describe('findLinearThermalBridgeIssues + realistic hosts', () => {
  it('E3 sill + façade opening parent: no issues when TB lies on opening outline', () => {
    const win = facadeWin('Opening');
    const t = tbLinear('tb-e3', 'E3', 'Opening', [
      { x: 1, y: 0, z: 0 },
      { x: 5, y: 0, z: 0 },
    ]);
    expect(findLinearThermalBridgeIssues([win, t] as Element[])).toHaveLength(0);
  });

  it('E3 + external wall parent: host pattern mismatch', () => {
    const w = extWall('w1', 'Wall');
    const t = tbLinear('tb-e3', 'E3', 'Wall', [
      { x: 0, y: 0, z: 0 },
      { x: 6, y: 0, z: 0 },
    ]);
    const issues = findLinearThermalBridgeIssues([w, t] as Element[]);
    expect(issues.some((i) => i.kind === 'mismatch_junction_parent_host_pattern')).toBe(true);
  });

  it('E5 + external wall + TB along wall foot: no issues', () => {
    const w = extWall('w1', 'Wall');
    const t = tbLinear('tb-e5', 'E5', 'Wall', [
      { x: 0, y: 0, z: 0 },
      { x: 6, y: 0, z: 0 },
    ]);
    expect(findLinearThermalBridgeIssues([w, t] as Element[])).toHaveLength(0);
  });

  it('E10 + pitched roof polygon + TB along eaves: no issues', () => {
    const r = pitchedRoof('main');
    const t = tbLinear('tb-e10', 'E10', r.name, [
      { x: 0, y: 0, z: 3 },
      { x: 8, y: 0, z: 3 },
    ]);
    expect(findLinearThermalBridgeIssues([r, t] as Element[])).toHaveLength(0);
  });

  it('E14 + flat roof deck + TB along deck edge: no issues', () => {
    const d = flatRoofDeck('D');
    const t = tbLinear('tb-e14', 'E14', 'deck roof', [
      { x: 0, y: 0, z: 4 },
      { x: 10, y: 0, z: 4 },
    ]);
    expect(findLinearThermalBridgeIssues([d, t] as Element[])).toHaveLength(0);
  });

  it('P2 + vertical adjacent segment host: host-pattern mismatch', () => {
    const adj: BuildingElementAdjacentConditionedSpace = {
      type: 'BuildingElementAdjacentConditionedSpace',
      id: 'adj',
      name: 'Adj',
      zoneId: 'z',
      parent_element: null,
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 4, z: 0 },
      ],
      width: 4,
      height: 2.5,
      area: 10,
      isPlaceholder: false,
    } as BuildingElementAdjacentConditionedSpace;
    const t = tbLinear('tb-p2', 'P2', 'Adj', [
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 3, z: 0 },
    ]);
    expect(
      findLinearThermalBridgeIssues([adj, t] as Element[]).some((i) => i.kind === 'mismatch_junction_parent_host_pattern'),
    ).toBe(true);
  });

  it('E18 + party wall vertical line', () => {
    const pwall: BuildingElementPartyWall = {
      type: 'BuildingElementPartyWall',
      id: 'pw',
      name: 'Party',
      zoneId: 'z',
      parent_element: null,
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 4, z: 0 },
      ],
      width: 4,
      height: 2.4,
      area: 10,
      pitch: 90,
      isPlaceholder: false,
    } as BuildingElementPartyWall;
    const t = tbLinear('tb-e18', 'E18', 'Party', [
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 3, z: 0 },
    ]);
    expect(findLinearThermalBridgeIssues([pwall, t] as Element[])).toHaveLength(0);
  });

  it('E7 + horizontal party-floor adjacent line is rejected like the proposer', () => {
    const ext = opaqueWallLine('w-e7', 'Wall-E7', 0, 0, 0, 5);
    const partyFloor: BuildingElementAdjacentConditionedSpace = {
      type: 'BuildingElementAdjacentConditionedSpace',
      id: 'pf',
      name: 'PartyFloor',
      zoneId: 'z',
      parent_element: null,
      coordinates: [
        { x: 0, y: 1, z: 0 },
        { x: 0, y: 3, z: 0 },
      ],
      width: 2,
      height: 0.01,
      area: 0.02,
      pitch: 0,
      isPlaceholder: false,
      extra_json: { _vulcan_ui_party_element: true },
    } as BuildingElementAdjacentConditionedSpace;
    const t = tbLinear('tb-e7-pf', 'E7', 'PartyFloor', [
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 3, z: 0 },
    ]);
    expect(findLinearThermalBridgeIssues([ext, partyFloor, t] as Element[])).toHaveLength(1);
  });

  it('R11 + roof window sill line: no host-pattern issue', () => {
    const rw = roofWindow('r11');
    const t = tbLinear('tb-r11', 'R11', rw.name, [
      { x: 1, y: 0, z: 3 },
      { x: 4, y: 0, z: 3 },
    ]);
    expect(
      findLinearThermalBridgeIssues([rw, t] as Element[]).filter((i) => i.kind === 'mismatch_junction_parent_host_pattern'),
    ).toHaveLength(0);
  });

  it('R4 + roof window parent: host-pattern mismatch (ridge needs sloped opaque)', () => {
    const rw = roofWindow('bad-r4');
    const t = tbLinear('tb-r4', 'R4', rw.name, [
      { x: 1, y: 0, z: 3 },
      { x: 4, y: 0, z: 3 },
    ]);
    expect(
      findLinearThermalBridgeIssues([rw, t] as Element[]).some((i) => i.kind === 'mismatch_junction_parent_host_pattern'),
    ).toBe(true);
  });
});

/**
 * One composable valid host + TB per façade-auto code so release coverage stays aligned with proposers.
 */
function goldenElementsForFacadeAutoCode(code: string): Element[] {
  switch (code) {
    case 'E1':
    case 'E2':
    case 'E3':
    case 'E4': {
      const w = facadeWin(`open-${code}`);
      const tb = tbLinear(`tb-${code}`, code, w.name, [
        { x: 1, y: 0, z: 0 },
        { x: 5, y: 0, z: 0 },
      ]);
      return [w, tb];
    }
    case 'E5':
    case 'E6':
    case 'E19': {
      const w = extWall(`w-${code}`, `Wall-${code}`);
      const tb = tbLinear(`tb-${code}`, code, w.name, [
        { x: 0, y: 0, z: 0 },
        { x: 6, y: 0, z: 0 },
      ]);
      return [w, tb];
    }
    case 'E7': {
      const w = extWall('w-e7g', 'Wall-E7');
      const tb = tbLinear('tb-E7', 'E7', w.name, [
        { x: 0, y: 0, z: 0 },
        { x: 6, y: 0, z: 0 },
      ]);
      return [w, tb];
    }
    case 'E10':
    case 'E11':
    case 'E12':
    case 'E13':
    case 'E24': {
      const r = pitchedRoof(code);
      const tb = tbLinear(`tb-${code}`, code, r.name, [
        { x: 0, y: 0, z: 3 },
        { x: 8, y: 0, z: 3 },
      ]);
      return [r, tb];
    }
    case 'E14':
    case 'E15': {
      const d = flatRoofDeck(code);
      const tb = tbLinear(`tb-${code}`, code, d.name, [
        { x: 0, y: 0, z: 4 },
        { x: 10, y: 0, z: 4 },
      ]);
      return [d, tb];
    }
    case 'E16':
    case 'E17': {
      const wa = opaqueWallLine('wa', 'Wa', 0, 0, 1, 0);
      const wb = opaqueWallLine('wb', 'Wb', 0, 0, 0, 1);
      const tb = tbLinear(`tb-${code}`, code, 'Wa', [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 2.4 },
      ], {
        thermal_bridge_source: { host_wall_id: 'wa', host_wall_b_id: 'wb' },
      });
      return [wa, wb, tb];
    }
    case 'E18': {
      const pw = partyWallSeg('pw-e18', 'Party-E18');
      const tb = tbLinear(`tb-${code}`, code, pw.name, [
        { x: 0, y: 1, z: 0 },
        { x: 0, y: 3, z: 0 },
      ]);
      return [pw, tb];
    }
    case 'E20':
    case 'E21': {
      const w = extWall(`w-${code}`, `Wall-${code}`);
      const exposedFloorLine: Element = {
        type: 'BuildingElementAdjacentUnconditionedSpace_Simple',
        id: `ex-${code}`,
        name: `ExposedFloor-${code}`,
        zoneId: 'z',
        parent_element: null,
        coordinates: [
          { x: 0, y: 0, z: 0 },
          { x: 6, y: 0, z: 0 },
        ],
        width: 6,
        height: 0.2,
        area: 1.2,
        pitch: 0,
        isPlaceholder: false,
      } as Element;
      const tb = tbLinear(`tb-${code}`, code, w.name, [
        { x: 0, y: 0, z: 0 },
        { x: 6, y: 0, z: 0 },
      ]);
      return [w, exposedFloorLine, tb];
    }
    case 'P6': {
      const pw = partyWallSeg(`pw-${code}`, `Party-${code}`);
      const tb = tbLinear(`tb-${code}`, code, pw.name, [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 4, z: 0 },
      ]);
      return [pw, tb];
    }
    case 'P7':
    case 'P8': {
      const pw = partyWallSeg(`pw-${code}`, `Party-${code}`);
      const exposedFloorLine: Element = {
        type: 'BuildingElementAdjacentUnconditionedSpace_Simple',
        id: `ex-${code}`,
        name: `ExposedFloor-${code}`,
        zoneId: 'z',
        parent_element: null,
        coordinates: [
          { x: 0, y: 0, z: 0 },
          { x: 6, y: 0, z: 0 },
        ],
        width: 6,
        height: 0.2,
        area: 1.2,
        pitch: 0,
        isPlaceholder: false,
      } as Element;
      const tb = tbLinear(`tb-${code}`, code, pw.name, [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 4, z: 0 },
      ]);
      return [pw, exposedFloorLine, tb];
    }
    case 'E22': {
      const g = basementGround(`bg-${code}`);
      const tb = tbLinear(`tb-${code}`, code, g.name, [
        { x: 0, y: 0, z: -2 },
        { x: 5, y: 0, z: -2 },
      ]);
      return [g, tb];
    }
    case 'R1':
    case 'R2':
    case 'R3': {
      const rw = roofWindow(`rw-${code}`);
      const tb = tbLinear(`tb-${code}`, code, rw.name, [
        { x: 1, y: 0, z: 3 },
        { x: 4, y: 0, z: 3 },
      ]);
      return [rw, tb];
    }
    case 'R4':
    case 'R5': {
      const r = pitchedRoof(`ridge-${code}`);
      const tb = tbLinear(`tb-${code}`, code, r.name, [
        { x: 0, y: 0, z: 3 },
        { x: 8, y: 0, z: 3 },
      ]);
      return [r, tb];
    }
    case 'R6':
    case 'R7':
    case 'R8':
    case 'R9':
    case 'R10': {
      const r = pitchedRoof(`roof-${code}`);
      const tb = tbLinear(`tb-${code}`, code, r.name, [
        { x: 0, y: 0, z: 3 },
        { x: 8, y: 0, z: 3 },
      ]);
      return [r, tb];
    }
    case 'R11': {
      const rw = roofWindow(`rw-${code}`);
      const tb = tbLinear(`tb-${code}`, code, rw.name, [
        { x: 1, y: 0, z: 3 },
        { x: 4, y: 0, z: 3 },
      ]);
      return [rw, tb];
    }
    case 'P1': {
      const pw = partyWallSeg(`pw-${code}`, `Party-${code}`);
      const tb = tbLinear(`tb-${code}`, code, pw.name, [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 4, z: 0 },
      ]);
      return [pw, tb];
    }
    case 'P2':
    case 'P3': {
      const pw = partyWallSeg(`pw-${code}`, `Party-${code}`);
      const floorLine: BuildingElementAdjacentConditionedSpace = {
        type: 'BuildingElementAdjacentConditionedSpace',
        id: `fl-${code}`,
        name: `Floor-${code}`,
        zoneId: 'z',
        parent_element: null,
        coordinates: [
          { x: 0, y: 0, z: 0 },
          { x: 0, y: 3, z: 0 },
        ],
        width: 3,
        height: 0.2,
        area: 0.6,
        pitch: 0,
        isPlaceholder: false,
        extra_json: code === 'P3' ? { _vulcan_ui_party_element: true } : {},
      } as BuildingElementAdjacentConditionedSpace;
      const tb = tbLinear(`tb-${code}`, code, pw.name, [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 3, z: 0 },
      ]);
      return [pw, floorLine, tb];
    }
    case 'P4':
    case 'P5': {
      const r = pitchedRoof(`p-${code}`);
      const tb = tbLinear(`tb-${code}`, code, r.name, [
        { x: 0, y: 0, z: 3 },
        { x: 8, y: 0, z: 3 },
      ]);
      return [r, tb];
    }
    default:
      throw new Error(`goldenElementsForFacadeAutoCode: add fixture for ${code}`);
  }
}

describe('golden host per façade-auto junction code', () => {
  it.each(junctionCodesInFacadeAutoModal())(
    'no mismatch_junction_parent_host_pattern for composable golden host — %s',
    (code) => {
      const elements = goldenElementsForFacadeAutoCode(code);
      const hostIssues = findLinearThermalBridgeIssues(elements).filter(
        (i) => i.kind === 'mismatch_junction_parent_host_pattern',
      );
      expect(hostIssues).toHaveLength(0);
    },
  );
});
