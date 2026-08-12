// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Opt-in dev-only spike flag (R4.2): render ElectricBattery Advanced Fields directly
 * off the resolved subschema, bypassing the <JsonForms> dispatch entirely.
 * Enable in DevTools: localStorage.setItem('vulcan:direct-render-advanced-fields', '1') then reload.
 * Disable: localStorage.removeItem('vulcan:direct-render-advanced-fields')
 */
export const DIRECT_RENDER_ADVANCED_FIELDS_STORAGE_KEY = 'vulcan:direct-render-advanced-fields';

export function isDirectRenderAdvancedFieldsEnabled(): boolean {
  try {
    if (typeof localStorage === 'undefined') {
      return false;
    }
    return localStorage.getItem(DIRECT_RENDER_ADVANCED_FIELDS_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}
