// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import {
  categoryForLinearThermalBridgeIssueKind,
  type LinearThermalBridgeIssueCategory,
  type LinearThermalBridgeIssueKind,
} from '../findLinearThermalBridgeIssues';

describe('categoryForLinearThermalBridgeIssueKind', () => {
  const cases: [LinearThermalBridgeIssueKind, LinearThermalBridgeIssueCategory][] = [
    ['mismatch_unknown_junction_type', 'vocabulary'],
    ['orphan_unresolved_parent', 'reference_unresolved'],
    ['orphan_e16e17_incomplete_walls', 'association_invalid'],
    ['mismatch_e16e17_corner_plan', 'multi_host_geometry'],
    ['mismatch_junction_parent_host_pattern', 'host_type_mismatch'],
    ['mismatch_basement_e22_elevation', 'outline_geometry'],
    ['orphan_segment_far_from_host', 'outline_geometry'],
    ['mismatch_tb_plan_alignment', 'outline_geometry'],
    ['overlap_duplicate_colinear_segment', 'outline_geometry'],
  ];

  it.each(cases)('%s → %s', (kind, category) => {
    expect(categoryForLinearThermalBridgeIssueKind(kind)).toBe(category);
  });
});
