// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';

import { getDormerPlacementDefaults } from '../../../lib/dormerGeometry';
import { buildSemiDetachedWithDormer } from '../../__fixtures__/semiDetachedWithDormer';
import { proposeAutoThermalBridges } from '../autoThermalBridgePipeline';

// The dormer is built by the same function the canvas calls, against the sample model
// shipped with the editor.
//
// Most of what follows is asserted as a relationship rather than a number — the front wall
// spans the dormer's width, the two cheeks are symmetric, each dormer roof ties back once.
// Those hold for any dormer the builder produces. The measured lengths are pinned at the
// end as a regression signal, and they are only as meaningful as the defaults they came
// from: change DORMER_PLACEMENT_DEFAULTS and they must be re-derived, not nudged.
describe('auto thermal bridges around a dormer', () => {
  const fixture = buildSemiDetachedWithDormer();
  const proposals = proposeAutoThermalBridges(fixture.elements, fixture.floors);

  const r8 = proposals.filter(
    (proposal) =>
      proposal.junctionCode === 'R8'
      && proposal.edgeRole === 'sloped_roof_to_adjacent_wall_r8_r9'
      && proposal.openingName?.includes('Dormer'),
  );
  const r10 = proposals.filter(
    (proposal) => proposal.edgeRole === 'dormer_roof_to_host_roof_r10',
  );

  it('ties each dormer wall back to the roof that hosts it', () => {
    expect(r8.map((proposal) => proposal.openingName).sort()).toEqual([
      `${fixture.hostRoofName} (host) ↔ ${fixture.dormerNames.frontWall}`,
      `${fixture.hostRoofName} (host) ↔ ${fixture.dormerNames.leftCheek}`,
      `${fixture.hostRoofName} (host) ↔ ${fixture.dormerNames.rightCheek}`,
    ]);
    expect(r8.every((proposal) => proposal.parentElementForTb === fixture.hostRoofName))
      .toBe(true);
  });

  it('spans the front wall junction across the full width of the dormer', () => {
    const frontWall = r8.find((proposal) =>
      proposal.openingName?.includes(fixture.dormerNames.frontWall),
    );
    expect(frontWall?.suggestedLengthM)
      .toBeCloseTo(getDormerPlacementDefaults().dormerWidth, 3);
  });

  it('proposes symmetric cheek junctions', () => {
    const cheeks = r8
      .filter((proposal) => proposal.openingName?.includes('Cheek'))
      .map((proposal) => proposal.suggestedLengthM);
    expect(cheeks).toHaveLength(2);
    expect(cheeks[0]).toBeCloseTo(cheeks[1], 6);
    expect(cheeks[0]).toBeGreaterThan(0);
  });

  it('proposes one explicit R10 tie-back per dormer roof', () => {
    expect(fixture.dormerNames.roofs).toHaveLength(2);
    expect(r10.map((proposal) => proposal.openingName).sort()).toEqual(
      fixture.dormerNames.roofs
        .map((roof) => `${roof} ↔ ${fixture.hostRoofName}`)
        .sort(),
    );
    expect(r10.every((proposal) => proposal.junctionCode === 'R10')).toBe(true);
    expect(r10.every((proposal) => proposal.parentElementForTb === fixture.hostRoofName))
      .toBe(true);
    expect(r10.every((proposal) => Boolean(proposal.hostElementIds?.[0]))).toBe(true);
    expect(r10[0].suggestedLengthM).toBeCloseTo(r10[1].suggestedLengthM, 6);
  });

  it('measures the junctions the sample dormer actually produces', () => {
    // Derived from DORMER_PLACEMENT_DEFAULTS (2.0 m wide, 1.5 m deep, 1.2 m front wall,
    // 35° gable) on the sample's south pitched roof at 40°.
    const measured = Object.fromEntries(
      [...r8, ...r10].map((proposal) => [
        proposal.openingName,
        Number(proposal.suggestedLengthM.toFixed(2)),
      ]),
    );
    expect(measured).toEqual({
      [`${fixture.hostRoofName} (host) ↔ ${fixture.dormerNames.frontWall}`]: 2,
      [`${fixture.hostRoofName} (host) ↔ ${fixture.dormerNames.leftCheek}`]: 1.87,
      [`${fixture.hostRoofName} (host) ↔ ${fixture.dormerNames.rightCheek}`]: 1.87,
      [`${fixture.dormerNames.roofs[0]} ↔ ${fixture.hostRoofName}`]: 1.44,
      [`${fixture.dormerNames.roofs[1]} ↔ ${fixture.hostRoofName}`]: 1.44,
    });
  });
});
