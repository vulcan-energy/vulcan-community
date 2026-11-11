// @vitest-environment node
// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkGeometryCsv } from '../check';
import { convertCsv } from '../convert';
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

  // A CSV with no TargetBundleId is the a7 target, an FHS model; only FALSE on an unpinned CSV selects core.
  it('check reads the model type from the target', () => {
    const csv = join(mkdtempSync(join(tmpdir(), 'vulcan-cli-')), 'no-row.csv');
    writeFileSync(csv, readFileSync(fixture, 'utf8').replace(/^ComplianceValidationEnabled,.*\n/m, ''));
    expect(checkGeometryCsv(csv).complianceValidationEnabled).toBe(true);
    writeFileSync(csv, readFileSync(fixture, 'utf8').replace(/^ComplianceValidationEnabled,TRUE/m, 'ComplianceValidationEnabled,FALSE'));
    expect(checkGeometryCsv(csv).complianceValidationEnabled).toBe(false);
    // A pinned CSV is its target's model type whatever the row says.
    writeFileSync(csv, readFileSync(fixture, 'utf8')
      .replace(/^ComplianceValidationEnabled,TRUE/m, 'ComplianceValidationEnabled,FALSE')
      .replace(/^Metadata,.*\n/m, (row) => `${row}TargetBundleId,rust-fhs-a7-62d3df70-c5ba2673-v1,\n`));
    expect(checkGeometryCsv(csv).complianceValidationEnabled).toBe(true);
  });

  it('convert refuses a CSV pinned to a HEM version instead of converting it with the bundled schema', async () => {
    const csv = join(mkdtempSync(join(tmpdir(), 'vulcan-cli-')), 'pinned.csv');
    writeFileSync(csv, 'Metadata,,\nVulcanCsvVersion,3,\n#TargetBundleId,python-fhs-a9-918addad-b9b90138-v1,\n');
    await expect(convertCsv(csv, {})).rejects.toThrow("CSV pins TargetBundleId 'python-fhs-a9-918addad-b9b90138-v1'");
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
