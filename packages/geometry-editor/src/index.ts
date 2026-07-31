// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

export {
  GeometryCanvas,
  type GeometryCanvasContributions,
  type GeometryCanvasPanelContext,
  type GeometryCanvasProps,
  type GeometryCanvasSelection,
} from './components/GeometryCanvas';
export {
  createGeometryStore,
  GeometryStoreProvider,
  useGeometryStore,
  useGeometryStoreApi,
  type CreateGeometryStoreOptions,
  type GeometryState,
  type GeometryStoreApi,
} from './stores/geometryStore';
export {
  useDocumentSaveShortcut,
  type UseDocumentSaveShortcutOptions,
} from './hooks/useDocumentSaveShortcut';
export {
  GlobalSettingsFilenameAction,
  type GlobalSettingsFilenameActionProps,
} from './components/GlobalSettingsFilenameAction';
export {
  GlobalSettingsModal,
  type GlobalSettingsDefaultsCompatibility,
  type GlobalSettingsIndicator,
  type GlobalSettingsModalProps,
} from './components/GlobalSettingsModal';
export {
  DefaultsEditorModal,
  type DefaultsEditorModalProps,
} from './components/DefaultsEditorModal';
export {
  canonicalGeometrySchemaPort,
  configureGeometrySchemaAssetSource,
  type GeometrySchemaAssetSource,
} from './lib/geometrySchemaPort';
export {
  inspectDefaultsCompatibility,
  type DefaultsCompatibility,
} from './lib/defaultsCompatibility';
export type { FilenameBarActionContext } from './components/FilenameBar';
export {
  ALL_VULCAN_THEME_OPTIONS,
  BUILT_IN_CUSTOM_THEME_BASES,
  BUILT_IN_VULCAN_THEME_OPTIONS,
  CUSTOM_VULCAN_THEME_ID,
  VULCAN_THEME_EDITABLE_TOKENS,
  VULCAN_THEME_OPTIONS,
  VISIBLE_BUILT_IN_VULCAN_THEME_OPTIONS,
  applyVulcanTheme,
  customThemeFromThemeId,
  type BuiltInVulcanThemeId,
  type VulcanCustomTheme,
  type VulcanEditableThemeVar,
  type VulcanThemeId,
} from './stores/themeStore';
export {
  DEFAULT_NAMING_PREFERENCES,
  NAMING_RULE_DEFINITIONS,
  cloneNamingPreferences,
  createDefaultNamingPreferences,
  sanitizeNamingPreferences,
  type ElementNamingRule,
  type NamingPreferences,
  type NamingRuleId,
  type NamingToken,
} from './stores/namingStore';
