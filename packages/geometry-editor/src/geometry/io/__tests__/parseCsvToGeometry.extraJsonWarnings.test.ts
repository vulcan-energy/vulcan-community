// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from 'vitest';
import { parseCsvToGeometry } from '../parseCsvToGeometry';

describe('parseCsvToGeometry — malformed extra_json surfacing', () => {
  type ParsedElementWithExtraJson = { extra_json?: unknown };

  const csvWithExtraJsonCell = (extraJsonCell: string) => `
Metadata,,,,,,,,,,,,,
GlobalOrientationOffset,0.0,,,,,,,,,,,,,

Zone,,,,,,,,,,,,,
Name,Type,volume,floor_area,height,simplified thermal bridging
Living,Zone,60,25,2.4,FALSE

Exposed Elements,,,,,,,,,,,,,,
Name,Zone,Type,area,pitch,width,height,orientation360,base_height,is_unheated_pitched_roof,is_external_door,parent_element,coords,extra_json
FrontWall,Living,BuildingElementOpaque,12,90,5,2.4,180,0,FALSE,FALSE,,"0,0,0|5,0,0",${extraJsonCell}
`.trim();

  it('still loads the element but reports a warning naming it when extra_json is malformed', () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const parsed = parseCsvToGeometry(csvWithExtraJsonCell('"{""u_value"": }"'));

      const wall = parsed.elements.find((e) => e.name === 'FrontWall');
      expect(wall).toBeDefined();
      expect((wall as ParsedElementWithExtraJson | undefined)?.extra_json).toBeUndefined();

      expect(parsed.warnings).toHaveLength(1);
      expect(parsed.warnings[0]).toContain('FrontWall');
      expect(parsed.warnings[0]).toContain('{"u_value": }');
      // Must make the consequence explicit: advanced overrides were dropped.
      expect(parsed.warnings[0].toLowerCase()).toContain('dropped');
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Failed to parse extra_json:',
        '{"u_value": }',
        expect.any(SyntaxError),
      );
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it('reports no warnings when extra_json parses cleanly', () => {
    const parsed = parseCsvToGeometry(csvWithExtraJsonCell('"{""u_value"": 0.18}"'));

    const wall = parsed.elements.find((e) => e.name === 'FrontWall');
    expect((wall as ParsedElementWithExtraJson | undefined)?.extra_json).toEqual({ u_value: 0.18 });
    expect(parsed.warnings).toEqual([]);
  });

  it('reports no warnings for empty extra_json cells', () => {
    const parsed = parseCsvToGeometry(csvWithExtraJsonCell(''));
    expect(parsed.warnings).toEqual([]);
  });
});
