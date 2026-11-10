// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';

import { parseSemiDetachedSample } from '../__fixtures__/semiDetachedWithDormer';
import { editorFloorsAndElementsForParsedCsv } from '../../lib/floorDerivation';
import { proposeAutoThermalBridges } from './autoThermalBridgePipeline';
import { dedupeFacadeThermalBridgeProposals } from './facadeTbProposalGlobalDedupe';
import type { FacadeOpeningTbProposal } from './proposeFacadeOpenings';

// The sample's cold roof (insulation at ceiling level) has two eaves, an external gable and a
// party gable. BR 497 gives each edge one junction: E10 eaves (§4.1.1), E12 gable (§4.1.2) and P4
// roof/party wall (§4.1.3). R9 is a room-in-roof junction (§4.2) and the sample has no room in roof.
describe('auto thermal bridges on the shipped sample roof', () => {
  it('proposes one junction per roof edge', () => {
    const { elements, floors } = editorFloorsAndElementsForParsedCsv(parseSemiDetachedSample());
    const roofCodes = proposeAutoThermalBridges(elements, floors)
      .filter((p) => p.parentElementForTb?.startsWith('Pitched Roof'))
      .map((p) => p.junctionCode)
      .sort();

    expect(roofCodes).toEqual(['E10', 'E10', 'E12', 'E12', 'P4', 'P4']);
  });

  // The split sits off the ridge, so two party walls share one roof's gable edge.
  it('drops the party gable when the party wall is split in two', () => {
    const { elements, floors } = editorFloorsAndElementsForParsedCsv(parseSemiDetachedSample());
    const split = elements.flatMap((e) => {
      if (e.type !== 'BuildingElementPartyWall') return [e];
      const [p0, p1] = e.coordinates;
      const mid = { x: p0!.x + (p1!.x - p0!.x) / 4, y: p0!.y + (p1!.y - p0!.y) / 4, z: p0!.z };
      return [
        { ...e, id: `${e.id}-a`, name: `${e.name} a`, coordinates: [p0!, mid] },
        { ...e, id: `${e.id}-b`, name: `${e.name} b`, coordinates: [mid, p1!] },
      ];
    });
    const roofCodes = proposeAutoThermalBridges(split, floors)
      .filter((p) => p.parentElementForTb?.startsWith('Pitched Roof'))
      .map((p) => p.junctionCode)
      .sort();

    expect(roofCodes).toEqual(['E10', 'E10', 'E12', 'E12', 'P4', 'P4', 'P4']);
  });
});

function row(junctionCode: string, x0: number, x1: number, hosts: FacadeOpeningTbProposal['hostElementIds']) {
  return {
    proposalId: `${junctionCode}-${x0}-${x1}`,
    openingId: '',
    openingName: '',
    zoneId: 'z1',
    edgeRole: 'sloped_roof_eaves',
    junctionCode,
    suggestedLengthM: x1 - x0,
    linearThermalTransmittance: 0.1,
    reason: '',
    coordinates: [
      { x: x0, y: 0, z: 5 },
      { x: x1, y: 0, z: 5 },
    ],
    hostElementIds: hosts,
  } as FacadeOpeningTbProposal;
}

describe('eaves against a roof-to-wall row on the same roof', () => {
  it('keeps one row when the wall runs the whole eaves', () => {
    const out = dedupeFacadeThermalBridgeProposals(
      [row('R9', 0, 4, ['roof', 'wall']), row('E10', 0, 4, ['roof', 'roof'])],
      { elements: [] },
    );
    expect(out.map((p) => p.junctionCode)).toEqual(['E10']);
  });

  // A dormer front wall standing on part of the eaves line: BR 497 does not settle the junction.
  it('keeps both rows when the wall meets only part of the eaves', () => {
    const out = dedupeFacadeThermalBridgeProposals(
      [row('R8', 1, 2.4, ['roof', 'dormer-front-wall']), row('E11', 0, 4.67, ['roof', 'roof'])],
      { elements: [] },
    );
    expect(out.map((p) => p.junctionCode)).toEqual(['R8', 'E11']);
  });
});
