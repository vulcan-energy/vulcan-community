// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { roundToTwoDecimals } from '../constants';
import type { BuildingElementTransparent, Element } from '../types';

export const VULCAN_CSV_VERSION_METADATA_KEY = 'VulcanCsvVersion';
export const LEGACY_VULCAN_CSV_VERSION = 1;
export const CURRENT_VULCAN_CSV_VERSION = 2;

type WindowPart = { mid_height_air_flow_path?: unknown } & Record<string, unknown>;

function convertWindowPartListToGround(extraJson: BuildingElementTransparent['extra_json'], baseHeight: number) {
  if (!extraJson || typeof extraJson !== 'object' || Array.isArray(extraJson)) return extraJson;
  const partList = (extraJson as Record<string, unknown>).window_part_list;
  if (!Array.isArray(partList)) return extraJson;

  return {
    ...extraJson,
    window_part_list: partList.map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
      const part = entry as WindowPart;
      const midpoint = part.mid_height_air_flow_path;
      if (typeof midpoint !== 'number' || !Number.isFinite(midpoint)) return entry;
      return {
        ...part,
        mid_height_air_flow_path: roundToTwoDecimals(midpoint + baseHeight),
      };
    }),
  };
}

/** Project Vulcan's ground-relative advanced window fields into CSV version 2. */
export function convertGroundRelativeWindowExtraJsonForCsv(
  extraJson: BuildingElementTransparent['extra_json'],
  ventilationZoneBaseHeight: number,
): BuildingElementTransparent['extra_json'] {
  if (!extraJson || typeof extraJson !== 'object' || Array.isArray(extraJson)) return extraJson;
  const partList = (extraJson as Record<string, unknown>).window_part_list;
  if (!Array.isArray(partList)) return extraJson;

  return {
    ...extraJson,
    window_part_list: partList.map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
      const part = entry as WindowPart;
      const midpoint = part.mid_height_air_flow_path;
      if (typeof midpoint !== 'number' || !Number.isFinite(midpoint)) return entry;
      return {
        ...part,
        mid_height_air_flow_path: roundToTwoDecimals(midpoint - ventilationZoneBaseHeight),
      };
    }),
  };
}

/** Hydrate version-2 HEM-relative CSV values into Vulcan's ground-relative editor coordinates. */
export function migrateVulcanCsvElementsForEditor(
  elements: Element[],
  csvVersion: number,
  ventilationZoneBaseHeight: number,
): Element[] {
  if (csvVersion === LEGACY_VULCAN_CSV_VERSION) return elements;
  if (csvVersion !== CURRENT_VULCAN_CSV_VERSION) {
    throw new Error(`Unsupported ${VULCAN_CSV_VERSION_METADATA_KEY}: ${csvVersion}.`);
  }
  if (!Number.isFinite(ventilationZoneBaseHeight) || Math.abs(ventilationZoneBaseHeight) <= 1e-12) {
    return elements;
  }

  return elements.map((element) => {
    if (element.type !== 'BuildingElementTransparent') return element;
    const midpoint = element.mid_height;
    return {
      ...element,
      ...(typeof midpoint === 'number' && Number.isFinite(midpoint)
        ? { mid_height: roundToTwoDecimals(midpoint + ventilationZoneBaseHeight) }
        : {}),
      extra_json: convertWindowPartListToGround(element.extra_json, ventilationZoneBaseHeight),
    };
  });
}

export function parseVulcanCsvVersion(rawVersion: string | undefined): number {
  if (rawVersion === undefined) return LEGACY_VULCAN_CSV_VERSION;
  if (!/^\d+$/.test(rawVersion)) {
    throw new Error(`Invalid ${VULCAN_CSV_VERSION_METADATA_KEY}: "${rawVersion}".`);
  }
  const version = Number.parseInt(rawVersion, 10);
  if (version < LEGACY_VULCAN_CSV_VERSION || version > CURRENT_VULCAN_CSV_VERSION) {
    throw new Error(
      `Unsupported ${VULCAN_CSV_VERSION_METADATA_KEY}: ${version}; ` +
      `this Vulcan build supports versions ${LEGACY_VULCAN_CSV_VERSION}-${CURRENT_VULCAN_CSV_VERSION}.`,
    );
  }
  return version;
}
