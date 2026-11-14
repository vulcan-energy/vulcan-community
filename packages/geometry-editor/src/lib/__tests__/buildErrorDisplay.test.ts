// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { displayBuildErrorRows, targetValidationIssues, withTargetIssues } from '../buildErrorDisplay';
import { resolveIssueTarget } from '../issueTarget';

const model = {
  zones: [{ id: 'z1', name: 'Zone 1' }],
  elements: [{ id: 'pw', name: 'Party Wall', zoneId: 'z1' }],
};

describe('targetValidationIssues', () => {
  it('lands one versioned issue per cause on its element or zone', () => {
    const { elements, zones } = targetValidationIssues({
      hemVersion: '1.0.0a8',
      items: [
        { source: 'schema', code: 'E_TARGET_INPUT', path: '/Zone/Zone 1/BuildingElement/Party Wall/thermal_resistance_construction', message: 'Supply the party-wall resistance.' },
        // A schema consequence of the same element folds under its cause.
        { source: 'schema', code: 'E026', keyword: 'required', path: '/Zone/Zone 1/BuildingElement/Party Wall', message: '"thermal_resistance_construction" is a required property' },
        { source: 'schema', code: 'E_A8_THERMAL_BRIDGING', path: '/Zone/Zone 1/ThermalBridging', message: 'HEM 1.0.0a8 requires detailed thermal-bridge records.' },
        { source: 'schema', code: 'E026', path: '/HotWaterSource/hw cylinder', message: 'not an element' },
      ],
    }, model);
    expect(elements.get('pw')).toEqual([{ message: 'HEM 1.0.0a8: Supply the party-wall resistance.', fieldKey: 'thermal_resistance_construction', source: 'schema' }]);
    expect(zones.get('z1')?.map((issue) => issue.message)).toEqual(['HEM 1.0.0a8 requires detailed thermal-bridge records.']);
    expect(elements.size + zones.size).toBe(2);
  });

  it('turns a clean live result into a badged one only when issues exist', () => {
    const clean = { hasIssues: false, issues: [], hasWarnings: false, warnings: [] };
    expect(withTargetIssues(clean, undefined)).toBe(clean);
    expect(withTargetIssues(clean, [{ message: 'x', source: 'schema' }])).toMatchObject({ hasIssues: true, issues: [{ message: 'x' }] });
  });

  it('shows a field the editor already flags once, and one version prefix', () => {
    const local = { hasIssues: true, issues: [{ message: 'U-value required', fieldKey: 'u_value', source: 'schema' as const }], hasWarnings: false, warnings: [] };
    const { elements } = targetValidationIssues({
      hemVersion: '0.13.2',
      items: [
        { source: 'schema', code: 'E_TARGET_INPUT', path: '/Zone/Zone 1/BuildingElement/Party Wall/u_value', message: 'needs its u_value.' },
        { source: 'schema', code: 'E_TARGET_INPUT', path: '/Zone/Zone 1/BuildingElement/Party Wall', message: 'HEM 2.0.0a4: Check the wall.' },
      ],
    }, model);
    expect(withTargetIssues(local, elements.get('pw')).issues.map((issue) => issue.message)).toEqual(['U-value required', 'HEM 0.13.2: Check the wall.']);
  });

  it('keeps a target warning a warning: it neither blocks nor absorbs the element errors', () => {
    const { elements } = targetValidationIssues({
      hemVersion: '1.0.0a8',
      items: [
        { source: 'schema', severity: 'warning', code: 'W_TARGET_INPUT', path: '/Zone/Zone 1/BuildingElement/Party Wall/window_part_list', message: 'HEM 1.0.0a8: Check the opening height.' },
        { source: 'schema', code: 'E026', keyword: 'required', path: '/Zone/Zone 1/BuildingElement/Party Wall', message: '"u_value" is a required property' },
      ],
    }, model);
    const clean = { hasIssues: false, issues: [], hasWarnings: false, warnings: [] };
    const result = withTargetIssues(clean, elements.get('pw'));
    expect(result.warnings).toMatchObject([{ message: 'HEM 1.0.0a8: Check the opening height.', fieldKey: 'window_part_list' }]);
    expect(result.issues).toHaveLength(1);
    expect(withTargetIssues(clean, elements.get('pw')?.filter((issue) => issue.warning))).toMatchObject({ hasIssues: false, hasWarnings: true });
  });
});

describe('displayBuildErrorRows', () => {
  it('asks for a light on a zone that has none', () => {
    const [row] = displayBuildErrorRows(
      [{ source: 'schema', code: 'E026', keyword: 'type', path: '/Zone/Zone 1/Lighting', message: 'null is not of type "object"' }],
      (path) => resolveIssueTarget(path, model),
    );
    expect(row).toMatchObject({ userMessage: 'Add at least one light to this zone.', target: { zoneId: 'z1' } });
  });

  it('places an existing-building fabric row where Global Settings shows it', () => {
    const [row] = displayBuildErrorRows(
      [{ source: 'schema', code: 'E_EPC_HEMIE', path: '/Metadata/HEMIE_construction_external_wall', message: 'The external wall fabric default states no wall construction type.' }],
      (path) => resolveIssueTarget(path, model),
    );
    expect(row?.location).toBe('Global Settings > Defaults > Fabric > External wall');
  });
});
