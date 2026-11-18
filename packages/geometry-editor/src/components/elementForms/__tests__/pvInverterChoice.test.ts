// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { inverterChoice, withInverterChoice } from '../onSiteGeneration';

it('states the inverter as one choice, and blank leaves both fields to the defaults', () => {
  expect(inverterChoice({})).toBe('');
  expect(inverterChoice({ inverter_type: 'optimised_inverter', inverter_is_inside: false })).toBe('optimised_inverter|outside');
  expect(inverterChoice({ inverter_is_inside: false })).toBe('string_inverter|outside');
  expect(withInverterChoice({ panel_count: 10 }, 'string_inverter|outside')).toEqual({ panel_count: 10, inverter_type: 'string_inverter', inverter_is_inside: false });
  expect(withInverterChoice({ panel_count: 10, inverter_type: 'string_inverter', inverter_is_inside: true }, '')).toEqual({ panel_count: 10 });
});
