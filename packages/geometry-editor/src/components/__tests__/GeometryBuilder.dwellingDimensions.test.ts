// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// These were source-string assertions over the hand-rolled fields, which asserted nothing about
// behaviour and broke on any edit. The behaviour now lives in DerivedNumberField and is covered
// by DerivedNumberField.test.tsx; what remains here is the one thing a unit test on the
// component cannot see - that each dimension is still wired to its own derived value, its own
// stored override and its own reset label.
const source = readFileSync(
  resolve(import.meta.dirname, '../GlobalSettingsModal.tsx'),
  'utf8',
);

/** The props of each `<DerivedNumberField ... />` in source order. */
function derivedFieldBlocks(): string[] {
  return source
    .split('<DerivedNumberField')
    .slice(1)
    .map((chunk) => chunk.split('/>')[0]);
}

describe('GlobalSettingsModal dwelling dimension overrides', () => {
  it('builds all three dimension fields on the shared component', () => {
    expect(derivedFieldBlocks()).toHaveLength(3);
  });

  it('wires ground floor area to the derived footprint and its override', () => {
    const block = derivedFieldBlocks().find((b) => b.includes('GroundFloorArea'));

    expect(block).toBeDefined();
    expect(block).toContain('derivedValue={derivedGFA}');
    expect(block).toContain('manualValue={complianceSettings.GroundFloorArea}');
    expect(block).toContain('GroundFloorArea: next');
    expect(block).toContain('resetAriaLabel="Reset ground floor area to derived value"');
  });

  it('wires building length to the derived length and its override', () => {
    const block = derivedFieldBlocks().find((b) => b.includes('BuildingLength'));

    expect(block).toBeDefined();
    expect(block).toContain('derivedValue={derivedLW.lengthM}');
    expect(block).toContain('manualValue={complianceSettings.BuildingLength}');
    expect(block).toContain('BuildingLength: next');
    expect(block).toContain('resetAriaLabel="Reset building length to derived value"');
  });

  it('wires building width to the derived width and its override', () => {
    const block = derivedFieldBlocks().find((b) => b.includes('BuildingWidth'));

    expect(block).toBeDefined();
    expect(block).toContain('derivedValue={derivedLW.widthM}');
    expect(block).toContain('manualValue={complianceSettings.BuildingWidth}');
    expect(block).toContain('BuildingWidth: next');
    expect(block).toContain('resetAriaLabel="Reset building width to derived value"');
  });

  it('keeps the ventilation zone heights off the shared component', () => {
    // They carry an extra mismatch warning block and different parse/tolerance rules, so
    // converting them wants its own change rather than more props on DerivedNumberField.
    const blocks = derivedFieldBlocks().join('\n');

    expect(blocks).not.toContain('ventilation_zone_height');
    expect(blocks).not.toContain('ventilation_zone_base_height');
  });
});
