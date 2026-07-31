// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { Element } from '../geometry/types';

export type SystemElementSource = 'pcdb' | 'presets' | 'custom';
export const SYSTEM_SOURCE_META_KEY = '_system_source';

export const SYSTEM_SUBCATEGORY_TO_DIR: Record<string, string> = {
  HeatSourceWet: 'heat_source_wet',
  HotWaterSource: 'hot_water_source',
  SpaceCoolSystem: 'space_cooling_systems',
  SpaceHeatSystem: 'space_heat_systems',
};

export const SYSTEM_SUBCATEGORY_LABELS: Record<string, string> = {
  HeatSourceWet: 'Heat source / plant',
  HotWaterSource: 'Hot water',
  SpaceCoolSystem: 'Space cooling',
  SpaceHeatSystem: 'Space heating',
};

export function systemExtraJsonHasPcdb(extra: unknown): boolean {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return false;
  const pc = (extra as Record<string, unknown>)._pcdb;
  return !!(pc && typeof pc === 'object' && !Array.isArray(pc));
}

/** Sample-path merged plant (preset or hand-edited) without PCDB provenance. */
export function systemExtraJsonHasSamplePlant(extra: unknown): boolean {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return false;
  if (systemExtraJsonHasPcdb(extra)) return false;
  const o = extra as Record<string, unknown>;
  return !!(o.HeatSourceWet || o.HotWaterSource || o.SpaceCoolSystem || o.SpaceHeatSystem);
}

export function systemExtraJsonIsMeaningfulSampleSide(extra: unknown): boolean {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return false;
  if (systemExtraJsonHasPcdb(extra)) return false;
  const keys = Object.keys(extra as Record<string, unknown>).filter((k) => k !== SYSTEM_SOURCE_META_KEY);
  return keys.length > 0;
}

export function getSystemElementSourceFromState(
  systemPreset: unknown,
  extra: unknown,
): SystemElementSource {
  if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
    const raw = (extra as Record<string, unknown>)[SYSTEM_SOURCE_META_KEY];
    if (raw === 'pcdb' || raw === 'presets' || raw === 'custom') return raw;
  }
  if (systemExtraJsonHasPcdb(extra)) return 'pcdb';
  if (typeof systemPreset === 'string' && systemPreset.trim() !== '') return 'presets';
  if (systemExtraJsonHasSamplePlant(extra) || systemExtraJsonIsMeaningfulSampleSide(extra)) {
    return 'custom';
  }
  return 'presets';
}

export function uiModeForSystemSource(source: SystemElementSource): 'presets' | 'pcdb' {
  return source === 'pcdb' ? 'pcdb' : 'presets';
}

export type SystemSelectionLike = {
  id: string;
  type: 'zone' | 'element' | 'global' | 'dormer';
  isPlaceholder?: boolean;
} | null | undefined;

export function isSystemElementSelection(selection: SystemSelectionLike): selection is {
  id: string;
  type: 'element' | 'global';
  isPlaceholder?: boolean;
} {
  if (!selection) return false;
  if (selection.isPlaceholder) return false;
  return selection.type === 'element' || selection.type === 'global';
}

export function readSelectedSystemElement(
  selection: SystemSelectionLike,
  getElementById: (id: string) => {
    type?: unknown;
    extra_json?: unknown;
    system_preset?: unknown;
    subcategory?: unknown;
  } | undefined,
): {
  type?: unknown;
  extra_json?: unknown;
  system_preset?: unknown;
  subcategory?: unknown;
} | null {
  if (!isSystemElementSelection(selection)) return null;
  const el = getElementById(selection.id);
  if (!el || el.type !== 'System') return null;
  return el;
}

function readRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function firstRecordEntry(value: unknown): [string, Record<string, unknown>] | null {
  const record = readRecord(value);
  for (const [key, child] of Object.entries(record)) {
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      return [key, child as Record<string, unknown>];
    }
  }
  return null;
}

export function firstSpaceHeatSystemEntry(extraJson: unknown): [string, Record<string, unknown>] | null {
  return firstRecordEntry(readRecord(extraJson).SpaceHeatSystem);
}

export function firstSpaceHeatSystemType(extraJson: unknown): string | null {
  const entry = firstSpaceHeatSystemEntry(extraJson);
  const rawType = entry?.[1]?.type;
  return typeof rawType === 'string' && rawType.trim() ? rawType.trim() : null;
}

export function isWetDistributionSpaceHeatSystem(extraJson: unknown): boolean {
  return firstSpaceHeatSystemType(extraJson) === 'WetDistribution';
}

export function spaceHeatSystemUsesHeatSourceWet(extraJson: unknown): boolean {
  const type = firstSpaceHeatSystemType(extraJson);
  return type === 'WetDistribution' || type === 'WarmAir';
}

export function resolveHeatSourceWetReferenceName(element: Element): string | null {
  if (element.type !== 'System' || (element as { subcategory?: unknown }).subcategory !== 'HeatSourceWet') {
    return null;
  }
  const heatSourceWet = readRecord(element.extra_json).HeatSourceWet;
  const wrapped = firstRecordEntry(heatSourceWet);
  if (wrapped) return wrapped[0];
  const fallback = typeof element.name === 'string' ? element.name.trim() : '';
  return fallback || null;
}

export function buildSpaceHeatSystemPresetExtraJson(
  preset: Record<string, unknown>,
  systemName: string,
  zoneName: string | null,
  heatSourceName: string | null,
): Record<string, unknown> {
  const [, presetSystem] = firstRecordEntry(preset.SpaceHeatSystem) ?? ['Space heating', {}];
  const restSystem = { ...presetSystem };
  delete restSystem.emitters;
  const nextSystem: Record<string, unknown> = { ...restSystem };
  if (zoneName) {
    nextSystem.Zone = zoneName;
  } else {
    delete nextSystem.Zone;
  }

  const heatSource = readRecord(nextSystem.HeatSource);
  if (heatSourceName) {
    heatSource.name = heatSourceName;
  } else {
    delete heatSource.name;
  }
  if (Object.keys(heatSource).length > 0) {
    nextSystem.HeatSource = heatSource;
  } else {
    delete nextSystem.HeatSource;
  }

  return {
    SpaceHeatSystem: {
      [systemName]: nextSystem,
    },
  };
}

export function buildSpaceHeatSystemSampleBaselineExtraJson(
  preset: Record<string, unknown>,
  currentExtraJson: unknown,
  systemName: string,
  zoneName: string | null,
  heatSourceName: string | null,
): Record<string, unknown> {
  const presetEntry = firstRecordEntry(preset.SpaceHeatSystem);
  const presetSystem = presetEntry?.[1] ?? {};
  const presetType = typeof presetSystem.type === 'string' ? presetSystem.type : '';
  if (presetType === 'WetDistribution') {
    return buildSpaceHeatSystemPresetExtraJson(preset, systemName, zoneName, heatSourceName);
  }

  const currentEntry = firstSpaceHeatSystemEntry(currentExtraJson);
  if (presetType === 'WarmAir') {
    const targetKey =
      currentEntry?.[0] ||
      (systemName.trim() ? systemName.trim() : '') ||
      presetEntry?.[0] ||
      'Space heating';
    const nextSystem = { ...presetSystem };
    delete nextSystem.Zone;

    const heatSource = readRecord(nextSystem.HeatSource);
    if (heatSourceName) {
      heatSource.name = heatSourceName;
    }
    if (Object.keys(heatSource).length > 0) {
      nextSystem.HeatSource = heatSource;
    }

    return {
      SpaceHeatSystem: {
        [targetKey]: nextSystem,
      },
    };
  }

  const targetKey =
    currentEntry?.[0] ||
    presetEntry?.[0] ||
    (systemName.trim() ? systemName.trim() : 'Space heating');
  const nextSystem = { ...presetSystem };
  if (zoneName && Object.prototype.hasOwnProperty.call(nextSystem, 'Zone')) {
    nextSystem.Zone = zoneName;
  }

  return {
    SpaceHeatSystem: {
      [targetKey]: nextSystem,
    },
  };
}

export function updateSpaceHeatSystemHeatSourceNameInExtraJson(
  extraJson: unknown,
  systemName: string,
  heatSourceName: string,
): Record<string, unknown> {
  const extra = readRecord(extraJson);
  const spaceHeatSystems = readRecord(extra.SpaceHeatSystem);
  const entry = firstRecordEntry(spaceHeatSystems);
  const entryName = entry?.[0] || systemName;
  const system = { ...(entry?.[1] ?? { type: 'WetDistribution' }) };
  const heatSource = readRecord(system.HeatSource);
  if (heatSourceName) {
    heatSource.name = heatSourceName;
  } else {
    delete heatSource.name;
  }
  if (Object.keys(heatSource).length > 0) {
    system.HeatSource = heatSource;
  } else {
    delete system.HeatSource;
  }
  return {
    ...extra,
    SpaceHeatSystem: {
      ...spaceHeatSystems,
      [entryName]: system,
    },
  };
}
