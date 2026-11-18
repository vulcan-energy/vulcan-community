// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect } from 'vitest';
import { pruneHotWaterSourceHwCylinderSchemaForInstance } from '../systemHotWaterAdvancedSchema';

describe('pruneHotWaterSourceHwCylinderSchemaForInstance', () => {
  it('pruneHotWaterSourceHwCylinderSchemaForInstance does not throw when HotWaterSource is null', () => {
    const sub: Record<string, unknown> = { properties: { HotWaterSource: { properties: {} } } };
    expect(() =>
      pruneHotWaterSourceHwCylinderSchemaForInstance(sub, { HotWaterSource: null }),
    ).not.toThrow();
  });
});
