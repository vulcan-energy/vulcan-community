// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { collapsedHeatingFields } from '../systemEditorUtils';

it("keeps an existing building's heating circuit thermal mass out of More: the converter requires it", () => {
  expect(collapsedHeatingFields(true).has('thermal_mass')).toBe(false);
  expect(collapsedHeatingFields(true).has('min_flow_rate')).toBe(true);
  expect(collapsedHeatingFields(false).has('thermal_mass')).toBe(true);
});
