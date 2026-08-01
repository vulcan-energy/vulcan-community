// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { CreateGeometryStoreOptions } from '../../../packages/geometry-editor/src';
import {
  applyVulcanTheme,
  type BuiltInVulcanThemeId,
  type VulcanCustomTheme,
} from '../../../packages/geometry-editor/src/stores/themeStore';
import {
  cloneNamingPreferences,
  createDefaultNamingPreferences,
  type NamingPreferences,
} from '../../../packages/geometry-editor/src/stores/namingStore';

export type CommunityEditorConfig = Readonly<{
  /** Pick any canonical built-in theme; no parallel Community theme UI is required. */
  theme: BuiltInVulcanThemeId;
  /** Optional complete token map applied over the selected built-in theme. */
  customTheme?: VulcanCustomTheme;
  /** Canonical naming preferences double as the editor's terminology configuration. */
  namingPreferences: NamingPreferences;
}>;

/**
 * Deliberately small standalone-app configuration surface. Integrators edit or
 * replace this value; the canonical editor packages remain shared.
 */
export const COMMUNITY_EDITOR_CONFIG: CommunityEditorConfig = Object.freeze({
  theme: 'low-glare-dark',
  namingPreferences: createDefaultNamingPreferences(),
});

export function applyCommunityEditorAppearance(
  config: CommunityEditorConfig = COMMUNITY_EDITOR_CONFIG,
): void {
  if (config.customTheme) {
    applyVulcanTheme('custom', config.customTheme, config.theme);
    return;
  }
  applyVulcanTheme(config.theme);
}

export function createCommunityGeometryStoreOptions(
  config: CommunityEditorConfig = COMMUNITY_EDITOR_CONFIG,
): Pick<CreateGeometryStoreOptions, 'initialNamingPreferences'> {
  return {
    initialNamingPreferences: cloneNamingPreferences(config.namingPreferences),
  };
}
