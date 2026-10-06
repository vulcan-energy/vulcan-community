// @vitest-environment node
// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { checkGeometryCsv } from '../check';
import { autoThermalBridges, validateThermalBridges } from '../thermalBridges';
import { versionInfo, versionText } from '../version';

const fixture = fileURLToPath(new URL(
  '../../../../packages/geometry-editor/src/geometry/__fixtures__/example_semi_detached.csv',
  import.meta.url,
));

describe('vulcan-community commands', () => {
  // Downstream tooling parses these keys from --json output.
  it('check returns the JSON contract', () => {
    const result = checkGeometryCsv(fixture);
    expect(result.counts.elements).toBeGreaterThan(0);
    expect(Object.keys(result.counts)).toEqual(expect.arrayContaining([
      'criticalIssues', 'warnings', 'missingElements',
    ]));
    expect(Array.isArray(result.criticalIssues)).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(Array.isArray(result.missingElements)).toBe(true);
  });

  it('thermal-bridges proposes and validates', () => {
    expect(autoThermalBridges(fixture).proposals.length).toBeGreaterThan(0);
    const validation = validateThermalBridges(fixture, true);
    expect(typeof validation.issueCount).toBe('number');
    expect(validation.thermalBridgeLinearRows).toBeGreaterThan(0);
    expect(Array.isArray(validation.issues)).toBe(true);
  });

  it('version carries the ADDITIONAL_TERMS section 1 notice', () => {
    const text = versionText();
    for (const required of [
      'Vulcan Community',
      'Home Energy Foundry Limited',
      'https://usevulcan.app/open-source',
      'Copyright © 2026 Home Energy Foundry Limited and contributors.',
      'AGPL-3.0-only',
      'Corresponding Source: unofficial build, revision unknown.',
      'not necessarily affiliated with or endorsed by Home Energy Foundry Limited',
    ]) {
      expect(text).toContain(required);
    }
    expect(versionInfo().correspondingSource).toBeNull();
  });
});
