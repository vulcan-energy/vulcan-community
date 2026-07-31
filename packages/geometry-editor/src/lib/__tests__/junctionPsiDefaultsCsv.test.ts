// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect } from 'vitest';
import {
  parseJunctionPsiDefaultsCsv,
  getEffectiveLinearPsiFromWorkspaceSparseMap,
} from '../junctionPsiDefaultsCsv';

describe('parseJunctionPsiDefaultsCsv', () => {
  it('parses header and rows', () => {
    const csv = `junction_type,linear_thermal_transmittance
E7,0.25
E5,0.4
`;
    expect(parseJunctionPsiDefaultsCsv(csv)).toEqual({ E7: 0.25, E5: 0.4 });
  });

  it('ignores # comments', () => {
    const csv = `# comment
junction_type,linear_thermal_transmittance
E1,0.99
`;
    expect(parseJunctionPsiDefaultsCsv(csv).E1).toBe(0.99);
  });
});

describe('getEffectiveLinearPsiFromWorkspaceSparseMap', () => {
  it('uses sparse map when key present', () => {
    expect(getEffectiveLinearPsiFromWorkspaceSparseMap('E7', { E7: 0.25 })).toBe(0.25);
  });

  it('falls back to built-in Table 3.7 when key missing', () => {
    expect(getEffectiveLinearPsiFromWorkspaceSparseMap('E7', {})).toBe(0.28);
  });
});
