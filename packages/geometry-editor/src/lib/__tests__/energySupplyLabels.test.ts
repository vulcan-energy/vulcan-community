// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { energySupplyLabel } from '../../components/systemEditorUtils';

it("names a default supply as an assessor reads it, and keeps a user's own name", () => {
  expect(energySupplyLabel('mains elec')).toBe('Mains electricity');
  expect(energySupplyLabel('LPG condition 11F')).toBe('LPG, special condition 11F');
  expect(energySupplyLabel('Shed battery')).toBe('Shed battery');
});
