// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Kill-switch for the R4.3 rollout: direct-render Advanced Fields (see
 * `../components/DirectAdvancedFields.tsx`) is now the DEFAULT path for every element
 * type, off the resolved subschema (or, for System, the layout spec from
 * `systemAdvancedUischema.ts`) with no <JsonForms> dispatch. Setting this key to '1'
 * restores the legacy JsonForms mount for one soak cycle, in case a parity gap
 * surfaces in production that the test matrix in
 * `__tests__/AdvancedFieldsEditor.directParity.test.tsx` did not catch.
 * Enable in DevTools: localStorage.setItem('vulcan:advanced-fields-jsonforms-fallback', '1') then reload.
 * Disable: localStorage.removeItem('vulcan:advanced-fields-jsonforms-fallback')
 * Scheduled for deletion in R4.4, once the soak cycle confirms direct-render parity.
 */
export const ADVANCED_FIELDS_JSONFORMS_FALLBACK_STORAGE_KEY = 'vulcan:advanced-fields-jsonforms-fallback';

export function isAdvancedFieldsJsonformsFallbackEnabled(): boolean {
  try {
    if (typeof localStorage === 'undefined') {
      return false;
    }
    return localStorage.getItem(ADVANCED_FIELDS_JSONFORMS_FALLBACK_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}
