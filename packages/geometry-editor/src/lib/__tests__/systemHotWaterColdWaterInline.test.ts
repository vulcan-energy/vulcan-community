// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect } from 'vitest';
import {
  coldWaterSourceKeysFromFhsRoot,
  inlineHwCylinderColdWaterSourceEnumOnHotWaterSubschema,
  pruneHotWaterSourceHwCylinderSchemaForInstance,
} from '../systemHotWaterAdvancedSchema';

const minimalFhsRoot = {
  properties: {
    ColdWaterSource: {
      type: 'object',
      properties: {
        'mains water': { type: 'object' },
        'header tank': { type: 'object' },
      },
    },
  },
} as Record<string, unknown>;

describe('coldWaterSourceKeysFromFhsRoot / inlineHwCylinderColdWaterSourceEnumOnHotWaterSubschema', () => {
  it('reads root ColdWaterSource map keys', () => {
    const keys = coldWaterSourceKeysFromFhsRoot(minimalFhsRoot);
    expect(keys).toContain('mains water');
    expect(keys).toContain('header tank');
  });

  it('adds enum for Tank ColdWaterSource string reference on hw cylinder', () => {
    const sub: Record<string, unknown> = {
      properties: {
        HotWaterSource: {
          properties: {
            'hw cylinder': {
              properties: {
                ColdWaterSource: { type: 'string', reference_to: ['$.cold_water_source'] },
              },
            },
          },
        },
      },
    };
    inlineHwCylinderColdWaterSourceEnumOnHotWaterSubschema(sub, minimalFhsRoot);
    const cws = (sub as any).properties.HotWaterSource.properties['hw cylinder'].properties.ColdWaterSource;
    expect(Array.isArray(cws.enum)).toBe(true);
    expect(cws.enum).toContain('mains water');
    expect(cws.enum).toContain('header tank');
  });

  it('pruneHotWaterSourceHwCylinderSchemaForInstance does not throw when HotWaterSource is null', () => {
    const sub: Record<string, unknown> = { properties: { HotWaterSource: { properties: {} } } };
    expect(() =>
      pruneHotWaterSourceHwCylinderSchemaForInstance(sub, { HotWaterSource: null }),
    ).not.toThrow();
  });
});
