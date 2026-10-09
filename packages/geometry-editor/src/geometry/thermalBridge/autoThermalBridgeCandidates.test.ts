// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { psiTable37ForCode } from '../../lib/simplifiedFabricMap';
import type { ExternalDetailProfileLink } from '../../lib/assemblyTypes';
import type { Element, ThermalBridgeLinear } from '../types';
import type { FacadeOpeningTbProposal } from './proposeFacadeOpenings';
import {
  externalDetailCandidateKey,
  type ExternalConstructionDetailProfile,
  type ExternalDetailCataloguePort,
} from './externalDetailContracts';
import { externalDetailAutoTbGroupKey } from './externalDetailsForAutoTb';
import { VULCAN_UI_TB_ADJACENT_ELEMENT_ID_KEY } from './linearTbPsi';
import {
  createThermalBridgeLinearFromAutoProposal,
  enrichAutoThermalBridgeCandidates,
  junctionOptionsForAutoThermalBridgeCandidate,
} from './autoThermalBridgeCandidates';

const coords: FacadeOpeningTbProposal['coordinates'] = [
  { x: 1, y: 2, z: 3 },
  { x: 2, y: 2, z: 3 },
];

function rooflightProposal(edgeRole: 'roof_window_sill' | 'rooflight_kerb'): FacadeOpeningTbProposal {
  return {
    proposalId: `window:${edgeRole}`,
    openingId: 'window',
    openingName: 'Rooflight',
    zoneId: 'zone-1',
    edgeRole,
    junctionCode: edgeRole === 'roof_window_sill' ? 'R2' : 'R11',
    suggestedLengthM: 1,
    linearThermalTransmittance: psiTable37ForCode(edgeRole === 'roof_window_sill' ? 'R2' : 'R11'),
    reason: `${edgeRole} proposal`,
    coordinates: coords,
  };
}

describe('auto thermal bridge candidates', () => {
  it('keeps rooflight R2/R11 as one stable R2-default candidate with optional R11', () => {
    const candidates = enrichAutoThermalBridgeCandidates(
      [rooflightProposal('rooflight_kerb'), rooflightProposal('roof_window_sill')],
      { elements: [] },
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      proposalId: 'window:roof_window_sill',
      edgeRole: 'roof_window_sill',
      junctionCode: 'R2',
      junctionOptions: ['R2', 'R11'],
    });
    expect(junctionOptionsForAutoThermalBridgeCandidate(candidates[0]!)).toEqual(['R2', 'R11']);

    const afterGlobalDedupe = enrichAutoThermalBridgeCandidates(
      [rooflightProposal('rooflight_kerb')],
      { elements: [] },
    )[0]!;
    expect(afterGlobalDedupe).toMatchObject({
      proposalId: 'window:roof_window_sill',
      junctionCode: 'R2',
      junctionOptions: ['R2', 'R11'],
    });
  });

  it('accepts R11 as an override and recognizes an existing R11 lower edge as a duplicate', () => {
    const existing = {
      id: 'tb-r11',
      type: 'ThermalBridgeLinear',
      name: 'Existing kerb',
      zoneId: 'zone-1',
      parent_element: 'Rooflight',
      coordinates: coords,
      length: 1,
      linear_thermal_transmittance: psiTable37ForCode('R11'),
      extra_json: { junction_type: 'R11' },
    } as ThermalBridgeLinear;
    const proposal = rooflightProposal('roof_window_sill');
    const candidate = enrichAutoThermalBridgeCandidates([proposal], {
      elements: [existing as Element],
      junctionOverrides: { 'window:roof_window_sill': 'R11' },
    })[0]!;

    expect(candidate.junctionCode).toBe('R11');
    expect(candidate.linearThermalTransmittance).toBe(psiTable37ForCode('R11'));
    expect(candidate).toMatchObject({ status: 'duplicate', matchedExistingId: 'tb-r11' });
  });

  it.each([
    { existingCode: 'R2', proposedCode: 'R11' },
    { existingCode: 'R11', proposedCode: undefined },
  ])('treats existing $existingCode and proposed $proposedCode lower edges as exclusive', ({ existingCode, proposedCode }) => {
    const existing = {
      id: `tb-${existingCode}`,
      type: 'ThermalBridgeLinear',
      name: 'Existing lower edge',
      zoneId: 'zone-1',
      parent_element: 'Rooflight',
      coordinates: coords,
      length: 1,
      linear_thermal_transmittance: psiTable37ForCode(existingCode),
      extra_json: { junction_type: existingCode },
    } as ThermalBridgeLinear;
    const candidate = enrichAutoThermalBridgeCandidates([rooflightProposal('roof_window_sill')], {
      elements: [existing as Element],
      junctionOverrides: proposedCode ? { 'window:roof_window_sill': proposedCode } : undefined,
    })[0]!;
    expect(candidate).toMatchObject({ status: 'duplicate', matchedExistingId: `tb-${existingCode}` });
  });

  it('preserves proposer-inferred P3, P5 and R9 defaults through enrichment', () => {
    const proposalFor = (edgeRole: FacadeOpeningTbProposal['edgeRole'], junctionCode: string, proposalId: string) => ({
      ...rooflightProposal('roof_window_sill'),
      proposalId,
      edgeRole,
      junctionCode,
      linearThermalTransmittance: psiTable37ForCode(junctionCode),
    });
    const candidates = enrichAutoThermalBridgeCandidates([
      proposalFor('party_wall_junction', 'P3', 'p3'),
      proposalFor('party_wall_to_sloped_roof', 'P5', 'p5'),
      proposalFor('sloped_roof_to_adjacent_wall_r8_r9', 'R9', 'r9'),
    ], { elements: [] });

    expect(candidates.map((candidate) => candidate.junctionCode)).toEqual(['P3', 'P5', 'R9']);
    expect(candidates.map((candidate) => candidate.linearThermalTransmittance)).toEqual([
      psiTable37ForCode('P3'), psiTable37ForCode('P5'), psiTable37ForCode('R9'),
    ]);
  });

  it('preserves explicit floor membership and resolves the host floor when no override exists', () => {
    const host = {
      id: 'window',
      name: 'Rooflight',
      type: 'BuildingElementTransparent',
      zoneId: 'zone-1',
      floorId: 'legacy-floor',
      coordinates: [{ x: 1, y: 2, z: 1.1 }, { x: 2, y: 2, z: 1.1 }],
    } as Element;
    const floors = [{ id: 'ground', zIndex: 0 }, { id: 'first', zIndex: 1 }];
    const proposal = rooflightProposal('roof_window_sill');
    const explicit = enrichAutoThermalBridgeCandidates([{ ...proposal, floorStoreyIndexForTb: 3 }], {
      elements: [host], floors,
    })[0]!;
    const resolved = enrichAutoThermalBridgeCandidates([proposal], { elements: [host], floors })[0]!;

    expect(explicit.floorStoreyIndexForTb).toBe(3);
    expect(createThermalBridgeLinearFromAutoProposal(explicit, { window: host }, floors)).toMatchObject({
      floorId: 'legacy-floor', extra_json: { floor_id: 3 },
    });
    expect(resolved.floorStoreyIndexForTb).toBe(1);
    expect(createThermalBridgeLinearFromAutoProposal(resolved, { window: host }, floors).extra_json).toMatchObject({
      floor_id: 1,
    });
  });

  it.each([
    {
      proposal: { ...rooflightProposal('roof_window_sill'), edgeRole: 'external_corner_convex' as const,
        openingId: 'corner:vertex', parentElementForTb: 'North wall', cornerHostWallIds: ['wall-a', 'wall-b'] as const },
      hosts: ['wall-a', 'wall-b'],
    },
    {
      proposal: { ...rooflightProposal('roof_window_sill'), edgeRole: 'sloped_roof_to_adjacent_wall_r8_r9' as const,
        openingId: 'roof-a', roofAdjacentPairIds: ['roof-a', 'adjacent-a'] as const },
      hosts: ['roof-a', 'adjacent-a'],
    },
  ])('persists explicit host pair $hosts', ({ proposal, hosts }) => {
    const candidate = enrichAutoThermalBridgeCandidates([proposal], { elements: [] })[0]!;
    const draft = createThermalBridgeLinearFromAutoProposal(candidate, {});
    expect(draft.extra_json?.thermal_bridge_source).toMatchObject({
      host_wall_id: hosts[0],
      host_wall_b_id: hosts[1],
    });
  });

  it('persists the adjacent element link used for party psi apportioning', () => {
    const proposal = {
      ...rooflightProposal('roof_window_sill'),
      proposalId: 'party-floor:wall',
      openingId: 'party-floor',
      edgeRole: 'party_wall_junction' as const,
      junctionCode: 'P3',
    };
    const candidate = enrichAutoThermalBridgeCandidates([proposal], { elements: [] })[0]!;
    const draft = createThermalBridgeLinearFromAutoProposal(candidate, {});

    expect(draft.extra_json?.[VULCAN_UI_TB_ADJACENT_ELEMENT_ID_KEY]).toBe('party-floor');
  });

  it('keeps external-detail defaults optional and carries selected detail provenance', () => {
    const link: ExternalDetailProfileLink = {
      source: 'manufacturer', profileId: 'profile-1', label: 'System profile',
    };
    const details = [
      { junctionCode: 'R2', detailCode: 'D1', title: 'Detail one', psiWPerMK: 0.12 },
      { junctionCode: 'R2', detailCode: 'D2', title: 'Detail two', psiWPerMK: 0.18 },
    ];
    const profile: ExternalConstructionDetailProfile = {
      id: link.profileId, source: link.source, sourceName: 'Maker', sourceShortName: 'Maker',
      sourceUrl: 'https://example.test/details', importedAt: '2026-01-01T00:00:00.000Z',
      category: 'manufacturer', elementType: 'roof', systemName: 'Roof system', label: link.label,
      junctions: details,
    };
    const catalogue: ExternalDetailCataloguePort = {
      listProfiles: () => [profile],
      getProfile: () => profile,
      getDetailsForJunction: (_link, code) => profile.junctions
        .filter((detail) => detail.junctionCode === code)
        .map((detail) => ({ profile, detail })),
    };
    const host = { id: 'window', type: 'BuildingElementTransparent', name: 'Rooflight', zoneId: 'zone-1' } as Element;
    const proposal = rooflightProposal('roof_window_sill');
    const ambiguous = enrichAutoThermalBridgeCandidates([proposal], {
      elements: [host], externalDetailCatalogue: catalogue, defaultDetailProfile: link,
    })[0]!;
    expect(ambiguous.externalDetailSuggestion?.selected).toBeUndefined();
    expect(ambiguous.linearThermalTransmittance).toBe(psiTable37ForCode('R2'));

    const uniqueCatalogue: ExternalDetailCataloguePort = {
      ...catalogue,
      getDetailsForJunction: (_link, code) => profile.junctions
        .filter((detail) => detail.junctionCode === code)
        .slice(0, 1)
        .map((detail) => ({ profile, detail })),
    };
    const unique = enrichAutoThermalBridgeCandidates([proposal], {
      elements: [host], externalDetailCatalogue: uniqueCatalogue, defaultDetailProfile: link,
    })[0]!;
    expect(unique.externalDetailSuggestion?.selected?.detail.detailCode).toBe('D1');
    expect(unique.linearThermalTransmittance).toBe(0.12);
    expect(createThermalBridgeLinearFromAutoProposal(unique, { window: host }).extra_json?.thermal_bridge_source)
      .toMatchObject({ psi_source: 'manufacturer', external_construction_detail: { detailCode: 'D1', psiWPerMK: 0.12 } });

    const selectedKey = externalDetailCandidateKey({ profile, detail: details[1]! });
    const selected = enrichAutoThermalBridgeCandidates([proposal], {
      elements: [host], externalDetailCatalogue: catalogue, defaultDetailProfile: link,
      externalDetailSelection: { [externalDetailAutoTbGroupKey(link.source, link.profileId, 'R2')]: selectedKey },
    })[0]!;
    expect(selected.linearThermalTransmittance).toBe(0.18);
    expect(createThermalBridgeLinearFromAutoProposal(selected, { window: host }).extra_json?.thermal_bridge_source)
      .toMatchObject({ psi_source: 'manufacturer', external_construction_detail: { detailCode: 'D2', psiWPerMK: 0.18 } });
  });

  it('builds an element draft with selected junction, physical coordinates and storey metadata', () => {
    const proposal = {
      ...rooflightProposal('roof_window_sill'),
      floorStoreyIndexForTb: 2,
    };
    const candidate = enrichAutoThermalBridgeCandidates([proposal], { elements: [] })[0]!;
    const draft = createThermalBridgeLinearFromAutoProposal(candidate, {});

    expect(draft).toMatchObject({
      type: 'ThermalBridgeLinear',
      zoneId: 'zone-1',
      length: 1,
      coordinates: coords,
      extra_json: { junction_type: 'R2', floor_id: 2 },
    });
    expect('id' in draft).toBe(false);
  });

  it('throws a clear error when a proposal has no zone', () => {
    const proposal = { ...rooflightProposal('roof_window_sill'), zoneId: undefined };
    const candidate = enrichAutoThermalBridgeCandidates([proposal], { elements: [] })[0]!;

    expect(candidate.addabilityError).toContain('no zone');
    expect(() => createThermalBridgeLinearFromAutoProposal(candidate, {})).toThrow(
      'Cannot add thermal bridge window:roof_window_sill: The proposal has no zone association.',
    );
  });

  it('preserves the modal opening-element zone fallback when the proposal zone is absent', () => {
    const opening = {
      id: 'window', type: 'BuildingElementTransparent', name: 'Rooflight', zoneId: 'zone-from-opening',
    } as Element;
    const proposal = { ...rooflightProposal('roof_window_sill'), zoneId: undefined };
    const candidate = enrichAutoThermalBridgeCandidates([proposal], { elements: [opening] })[0]!;

    expect(candidate.zoneId).toBe('zone-from-opening');
    expect(candidate.addabilityError).toBeUndefined();
    expect(createThermalBridgeLinearFromAutoProposal(candidate, { window: opening }).zoneId)
      .toBe('zone-from-opening');
  });
});
