// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

export const categoryToSchemaKey: Record<string, string | undefined> = {
  location: 'InfiltrationVentilation',
  airtightness: 'InfiltrationVentilation',
  space_heat_emitters: 'SpaceHeatSystem',
  space_heat_systems: 'SpaceHeatSystem',
  hot_water_source: 'HotWaterSource',
  heat_source_wet: 'HeatSourceWet',
  tariff: 'Tariff',
  internal_gains: 'InternalGains',
  events: 'Events',
  solar_systems: 'OnSiteGeneration',
  battery_systems: 'EnergySupply',
  mechanical_ventilation_unit: 'InfiltrationVentilation',
  space_cooling_systems: 'SpaceCoolSystem',
  lighting: 'Lighting',
  // Per snippets, the category is "controls" but the root key is "Control" or "SpaceHeatControl" depending on version.
  // Use "Control" only if present; else try "SpaceHeatControl".
  controls: 'Control',
  // simplified_fabric merges into multiple building elements; no single key
  simplified_fabric: undefined,
};

export function getSchemaKeyForCategory(category?: string): string | undefined {
  if (!category) return undefined;
  const mapped = categoryToSchemaKey[category];
  return mapped;
}
