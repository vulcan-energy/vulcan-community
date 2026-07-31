// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type {
  BuildingElementAdjacentConditionedSpace,
  BuildingElementPartyWall,
  Element,
} from '../types';
import {
  JUNCTION_TYPE_ENUM,
} from '../../lib/simplifiedFabricMap';
import {
  apportionmentDivisorForPartyAdjacentP,
  baseLinearPsiForJunction,
  getEffectiveLinearPsiForFacadeProposal,
  getPApportionedLinearPsiForEditor,
  readVulcanUiTbAdjacentElementIdFromExtraJson,
  VULCAN_UI_TB_ADJACENT_ELEMENT_ID_KEY,
} from './linearTbPsi';
import type { FacadeOpeningTbProposal } from './proposeFacadeOpenings';

function partyWall(id: string): BuildingElementPartyWall {
  return {
    type: 'BuildingElementPartyWall',
    id,
    name: id,
    zoneId: 'z1',
    coordinates: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ],
    width: 1,
    height: 2.4,
    area: 2.4,
    pitch: 90,
    isPlaceholder: false,
  } as BuildingElementPartyWall;
}

function adjacentConditioned(
  id: string,
  extra: Record<string, unknown> | undefined,
): BuildingElementAdjacentConditionedSpace {
  const partyFloor = extra?._vulcan_ui_party_element === true;
  return {
    type: 'BuildingElementAdjacentConditionedSpace',
    id,
    name: id,
    zoneId: 'z1',
    coordinates: partyFloor
      ? [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
          { x: 1, y: 1, z: 0 },
        ]
      : [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
        ],
    width: 1,
    height: 2.4,
    area: 2.4,
    pitch: partyFloor ? 0 : 90,
    isPlaceholder: false,
    extra_json: extra,
  } as BuildingElementAdjacentConditionedSpace;
}

describe('apportionmentDivisorForPartyAdjacentP', () => {
  it('uses half for party wall element', () => {
    expect(apportionmentDivisorForPartyAdjacentP(partyWall('p'))).toBe(2);
  });

  it('uses half for adjacent conditioned with UI party flag', () => {
    expect(
      apportionmentDivisorForPartyAdjacentP(adjacentConditioned('a', { _vulcan_ui_party_element: true })),
    ).toBe(2);
  });

  it('uses full table for adjacent conditioned without party flag', () => {
    expect(apportionmentDivisorForPartyAdjacentP(adjacentConditioned('a', {}))).toBe(1);
  });
});

describe('getEffectiveLinearPsiForFacadeProposal', () => {
  const base: Omit<FacadeOpeningTbProposal, 'edgeRole' | 'junctionCode' | 'openingId'> = {
    proposalId: 'x',
    openingId: 'adj1',
    openingName: 'test',
    zoneId: 'z1',
    suggestedLengthM: 2,
    linearThermalTransmittance: 0.2,
    reason: 'r',
    coordinates: [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 2 },
    ],
  };

  it('apportions P2 on party wall to half of base ψ', () => {
    const party = partyWall('adj1');
    const elementsById: Record<string, Element> = { adj1: party };
    const p: FacadeOpeningTbProposal = {
      ...base,
      edgeRole: 'party_wall_junction',
      openingId: 'adj1',
      junctionCode: 'P2',
    };
    const psi = getEffectiveLinearPsiForFacadeProposal(p, null, elementsById);
    const unhalved = baseLinearPsiForJunction('P2', null);
    expect(psi).toBeCloseTo(unhalved / 2, 6);
  });

  it('does not halve R1', () => {
    const p: FacadeOpeningTbProposal = {
      ...base,
      edgeRole: 'roof_window_head',
      openingId: 'win1',
      junctionCode: 'R1',
    };
    const r = getEffectiveLinearPsiForFacadeProposal(p, null, {});
    expect(r).toBe(baseLinearPsiForJunction('R1', null));
  });

  it('apportions P4 on party wall to sloped roof to half of base ψ', () => {
    const party = partyWall('adj1');
    const elementsById: Record<string, Element> = { adj1: party };
    const p: FacadeOpeningTbProposal = {
      ...base,
      edgeRole: 'party_wall_to_sloped_roof',
      openingId: 'adj1',
      junctionCode: 'P4',
    };
    const psi = getEffectiveLinearPsiForFacadeProposal(p, null, elementsById);
    const unhalved = baseLinearPsiForJunction('P4', null);
    expect(psi).toBeCloseTo(unhalved / 2, 6);
  });

  it('apportions E7 party floor to external wall to half of base ψ', () => {
    const partyFloor = adjacentConditioned('adj1', { _vulcan_ui_party_element: true });
    const elementsById: Record<string, Element> = { adj1: partyFloor };
    const p: FacadeOpeningTbProposal = {
      ...base,
      edgeRole: 'e7_party_floor_external',
      openingId: 'adj1',
      junctionCode: 'E7',
    };
    const psi = getEffectiveLinearPsiForFacadeProposal(p, null, elementsById);
    const unhalved = baseLinearPsiForJunction('E7', null);
    expect(psi).toBeCloseTo(unhalved / 2, 6);
  });

  it('apportions E18 party wall to external wall to half of base ψ', () => {
    const party = partyWall('adj1');
    const elementsById: Record<string, Element> = { adj1: party };
    const p: FacadeOpeningTbProposal = {
      ...base,
      edgeRole: 'party_to_external_e18',
      openingId: 'adj1',
      junctionCode: 'E18',
    };
    const psi = getEffectiveLinearPsiForFacadeProposal(p, null, elementsById);
    const unhalved = baseLinearPsiForJunction('E18', null);
    expect(psi).toBeCloseTo(unhalved / 2, 6);
  });
});

describe('baseLinearPsiForJunction', () => {
  it('has a built-in fallback for every Table 3.7 junction type', () => {
    for (const code of JUNCTION_TYPE_ENUM) {
      expect(Number.isFinite(baseLinearPsiForJunction(code, null))).toBe(true);
    }
  });
});

describe('getPApportionedLinearPsiForEditor / UI adjacent id', () => {
  it('reads adjacent id from extra_json', () => {
    expect(readVulcanUiTbAdjacentElementIdFromExtraJson(null)).toBeUndefined();
    expect(
      readVulcanUiTbAdjacentElementIdFromExtraJson({ [VULCAN_UI_TB_ADJACENT_ELEMENT_ID_KEY]: '  adj1  ' }),
    ).toBe('adj1');
  });

  it('returns half base ψ for party wall when id is stored', () => {
    const party = partyWall('adj1');
    const ex = { [VULCAN_UI_TB_ADJACENT_ELEMENT_ID_KEY]: 'adj1' };
    const p = getPApportionedLinearPsiForEditor('P2', null, { adj1: party }, ex);
    const full = baseLinearPsiForJunction('P2', null);
    expect(p).toBeCloseTo(full / 2, 6);
  });

  it('returns half base ψ for E18 when a party wall id is stored', () => {
    const party = partyWall('adj1');
    const ex = { [VULCAN_UI_TB_ADJACENT_ELEMENT_ID_KEY]: 'adj1' };
    const p = getPApportionedLinearPsiForEditor('E18', null, { adj1: party }, ex);
    const full = baseLinearPsiForJunction('E18', null);
    expect(p).toBeCloseTo(full / 2, 6);
  });

  it('returns undefined for unheated adjacent (no party half)', () => {
    const u: Element = {
      type: 'BuildingElementAdjacentUnconditionedSpace_Simple',
      id: 'u1',
      name: 'u1',
      zoneId: 'z1',
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
      width: 1,
      height: 2.4,
      area: 2.4,
      pitch: 90,
      isPlaceholder: false,
    } as Element;
    const ex = { [VULCAN_UI_TB_ADJACENT_ELEMENT_ID_KEY]: 'u1' };
    expect(getPApportionedLinearPsiForEditor('P2', null, { u1: u }, ex)).toBeUndefined();
  });
});
