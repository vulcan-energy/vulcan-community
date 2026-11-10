// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { annotateProposalsWithDedupe, type FacadeOpeningTbProposal } from '../proposeFacadeOpenings';
import type { Element } from '../../types';

// Rows saved while a base-height-0 deck sat at 0 m must still match the E14 now proposed at the
// top of the storey, or accepting the proposals would count the edge twice.
describe('flat roof edge dedupe', () => {
  const proposal = (role: FacadeOpeningTbProposal['edgeRole'], z: number) => ({
    proposalId: 'p', openingId: 'roof', openingName: 'Flat Roof', zoneId: 'z', edgeRole: role,
    junctionCode: role === 'flat_roof_edge' ? 'E14' : 'E2', suggestedLengthM: 10, linearThermalTransmittance: 0.08, reason: '',
    coordinates: [{ x: 0, y: 0, z }, { x: 10, y: 0, z }],
  }) as FacadeOpeningTbProposal;
  const stored = (jt: string) => ({
    id: 'tb', name: 'E14', type: 'ThermalBridgeLinear', zoneId: 'z',
    coordinates: [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }], extra_json: { junction_type: jt },
  }) as unknown as Element;

  it('matches a stored E14 row on plan position whatever its height', () => {
    const [p] = annotateProposalsWithDedupe([proposal('flat_roof_edge', 2.6)], [stored('E14')]);
    expect(p!.status).toBe('duplicate');
  });

  it('still uses height for other edges', () => {
    const [p] = annotateProposalsWithDedupe([proposal('lintel', 2.6)], [stored('E2')]);
    expect(p!.status).toBe('new');
  });
});
