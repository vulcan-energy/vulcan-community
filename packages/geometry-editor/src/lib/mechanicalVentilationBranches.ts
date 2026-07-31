// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

export const MECHANICAL_VENTILATION_FAN_CHOICE_TYPES = new Set(['Centralised continuous MEV', 'MVHR']);

export const MECHANICAL_VENTILATION_MEASURED_FIELDS = [
  'measured_fan_power',
  'measured_air_flow_rate',
] as const;

export const MECHANICAL_VENTILATION_SFP_FIELDS = ['SFP'] as const;

export const MECHANICAL_VENTILATION_FLAT_POSITION_FIELDS = [
  'mid_height_air_flow_path',
  'orientation360',
  'pitch',
] as const;

export const MECHANICAL_VENTILATION_POSITION_OBJECT_FIELDS = ['position_exhaust', 'position_intake'] as const;
export const MECHANICAL_VENTILATION_HOSTED_FAN_TYPES = new Set([
  'Intermittent MEV',
  'Centralised continuous MEV',
  'Decentralised continuous MEV',
]);

export type MechanicalVentilationFanInputMode = 'measured' | 'sfp';
export type MechanicalVentilationPositionMode = 'flat' | 'position_exhaust';

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function hasAnyOwnProperty(record: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.some((key) => Object.prototype.hasOwnProperty.call(record, key));
}

export function deleteProperties(record: Record<string, unknown>, keys: readonly string[]): boolean {
  let deleted = false;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      delete record[key];
      deleted = true;
    }
  }
  return deleted;
}

export function normalizeMechanicalVentilationVentType(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const lower = trimmed.toLowerCase();
  if (lower === 'centralised continuous mev') return 'Centralised continuous MEV';
  if (lower === 'decentralised continuous mev') return 'Decentralised continuous MEV';
  if (lower === 'intermittent mev') return 'Intermittent MEV';
  if (lower === 'mvhr') return 'MVHR';
  return trimmed;
}

export function canMechanicalVentilationInheritHostPlacement(ventType: unknown): boolean {
  const normalizedVentType = normalizeMechanicalVentilationVentType(ventType);
  return !!normalizedVentType && MECHANICAL_VENTILATION_HOSTED_FAN_TYPES.has(normalizedVentType);
}

export function inferMechanicalVentilationFanInputMode(
  extraJson: Record<string, unknown>,
): MechanicalVentilationFanInputMode {
  if (hasAnyOwnProperty(extraJson, MECHANICAL_VENTILATION_SFP_FIELDS)) return 'sfp';
  if (hasAnyOwnProperty(extraJson, MECHANICAL_VENTILATION_MEASURED_FIELDS)) return 'measured';
  return 'measured';
}

export function inferMechanicalVentilationPositionMode(
  extraJson: Record<string, unknown>,
): MechanicalVentilationPositionMode {
  if (hasAnyOwnProperty(extraJson, MECHANICAL_VENTILATION_FLAT_POSITION_FIELDS)) return 'flat';
  if (hasAnyOwnProperty(extraJson, ['position_exhaust'])) return 'position_exhaust';
  return 'flat';
}

export function pruneMechanicalVentilationExtraJson(
  extraJson: Record<string, unknown>,
  options: {
    fanInputMode?: MechanicalVentilationFanInputMode | null;
    positionMode?: MechanicalVentilationPositionMode | null;
  },
): Record<string, unknown> {
  const next = { ...extraJson };
  if (options.fanInputMode === 'sfp') {
    deleteProperties(next, MECHANICAL_VENTILATION_MEASURED_FIELDS);
  } else if (options.fanInputMode === 'measured') {
    deleteProperties(next, MECHANICAL_VENTILATION_SFP_FIELDS);
  }

  if (options.positionMode === 'flat') {
    deleteProperties(next, MECHANICAL_VENTILATION_POSITION_OBJECT_FIELDS);
  } else if (options.positionMode === 'position_exhaust') {
    deleteProperties(next, MECHANICAL_VENTILATION_FLAT_POSITION_FIELDS);
    deleteProperties(next, ['position_intake']);
  }
  return next;
}

export function normalizeMechanicalVentilationExtraJson(
  extraJson: Record<string, unknown> | undefined,
  options: {
    ventType?: unknown;
    fanInputMode?: MechanicalVentilationFanInputMode | null;
    positionMode?: MechanicalVentilationPositionMode | null;
  } = {},
): Record<string, unknown> {
  let next = { ...(extraJson ?? {}) };
  const ventType = normalizeMechanicalVentilationVentType(options.ventType ?? next.vent_type);

  if (ventType === 'Intermittent MEV' || ventType === 'Decentralised continuous MEV') {
    deleteProperties(next, MECHANICAL_VENTILATION_MEASURED_FIELDS);
  } else if (MECHANICAL_VENTILATION_FAN_CHOICE_TYPES.has(ventType ?? '')) {
    const fanInputMode = options.fanInputMode ?? inferMechanicalVentilationFanInputMode(next);
    if (fanInputMode) {
      next = pruneMechanicalVentilationExtraJson(next, { fanInputMode });
    }
  }

  if (ventType === 'MVHR') {
    deleteProperties(next, MECHANICAL_VENTILATION_FLAT_POSITION_FIELDS);
  } else {
    const positionMode = options.positionMode ?? inferMechanicalVentilationPositionMode(next);
    if (positionMode) {
      next = pruneMechanicalVentilationExtraJson(next, { positionMode });
    }
  }

  return next;
}

export function switchMechanicalVentilationPositionModeExtraJson(
  extraJson: Record<string, unknown>,
  positionMode: MechanicalVentilationPositionMode,
): Record<string, unknown> {
  const next = { ...extraJson };
  if (positionMode === 'position_exhaust') {
    const hasFlatPositionFields = hasAnyOwnProperty(next, MECHANICAL_VENTILATION_FLAT_POSITION_FIELDS);
    if (hasFlatPositionFields || !isPlainRecord(next.position_exhaust)) {
      const positionExhaust: Record<string, unknown> = isPlainRecord(next.position_exhaust)
        ? { ...next.position_exhaust }
        : {};
      for (const field of MECHANICAL_VENTILATION_FLAT_POSITION_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(next, field)) {
          positionExhaust[field] = next[field];
        }
      }
      if (Object.keys(positionExhaust).length > 0) {
        next.position_exhaust = positionExhaust;
      }
    }
  } else {
    const positionExhaust = next.position_exhaust;
    if (isPlainRecord(positionExhaust)) {
      for (const field of MECHANICAL_VENTILATION_FLAT_POSITION_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(positionExhaust, field)) {
          next[field] = positionExhaust[field];
        }
      }
    }
  }

  return pruneMechanicalVentilationExtraJson(next, { positionMode });
}

export function applyMechanicalVentilationCsvPositionColumns(
  extraJson: Record<string, unknown> | undefined,
  ventType: unknown,
  columns: Partial<Record<(typeof MECHANICAL_VENTILATION_FLAT_POSITION_FIELDS)[number], unknown>>,
  options: { preservePositionMode?: boolean } = {},
): Record<string, unknown> {
  const next = { ...(extraJson ?? {}) };
  const hasPositionColumn = MECHANICAL_VENTILATION_FLAT_POSITION_FIELDS.some((field) =>
    Object.prototype.hasOwnProperty.call(columns, field),
  );
  if (!hasPositionColumn) {
    return normalizeMechanicalVentilationExtraJson(next, { ventType });
  }

  const normalizedVentType = normalizeMechanicalVentilationVentType(ventType ?? next.vent_type);
  const positionMode = options.preservePositionMode
    ? inferMechanicalVentilationPositionMode(next)
    : 'flat';
  if (normalizedVentType === 'MVHR' || positionMode === 'position_exhaust') {
    const positionExhaust = isPlainRecord(next.position_exhaust) ? { ...next.position_exhaust } : {};
    for (const field of MECHANICAL_VENTILATION_FLAT_POSITION_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(columns, field)) {
        positionExhaust[field] = columns[field];
      }
    }
    next.position_exhaust = positionExhaust;
    return normalizeMechanicalVentilationExtraJson(next, {
      ventType: normalizedVentType,
      positionMode: 'position_exhaust',
    });
  }

  for (const field of MECHANICAL_VENTILATION_FLAT_POSITION_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(columns, field)) {
      next[field] = columns[field];
    }
  }
  return normalizeMechanicalVentilationExtraJson(next, {
    ventType: normalizedVentType,
    positionMode: 'flat',
  });
}

export function getMechanicalVentilationCsvFlatPositionValues(
  extraJson: Record<string, unknown> | undefined,
  ventType: unknown,
): Partial<Record<(typeof MECHANICAL_VENTILATION_FLAT_POSITION_FIELDS)[number], unknown>> {
  const normalized = normalizeMechanicalVentilationExtraJson(extraJson, { ventType });
  if (normalizeMechanicalVentilationVentType(ventType ?? normalized.vent_type) === 'MVHR') return {};
  if (inferMechanicalVentilationPositionMode(normalized) !== 'flat') return {};

  const values: Partial<Record<(typeof MECHANICAL_VENTILATION_FLAT_POSITION_FIELDS)[number], unknown>> = {};
  for (const field of MECHANICAL_VENTILATION_FLAT_POSITION_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(normalized, field)) {
      values[field] = normalized[field];
    }
  }
  return values;
}

export function getMechanicalVentilationPositionValues(
  extraJson: Record<string, unknown> | undefined,
  ventType: unknown,
): Partial<Record<(typeof MECHANICAL_VENTILATION_FLAT_POSITION_FIELDS)[number], unknown>> {
  const normalized = normalizeMechanicalVentilationExtraJson(extraJson, { ventType });
  if (inferMechanicalVentilationPositionMode(normalized) !== 'position_exhaust') {
    return getMechanicalVentilationCsvFlatPositionValues(normalized, ventType);
  }

  const positionExhaust = isPlainRecord(normalized.position_exhaust)
    ? normalized.position_exhaust
    : {};
  const values: Partial<Record<(typeof MECHANICAL_VENTILATION_FLAT_POSITION_FIELDS)[number], unknown>> = {};
  for (const field of MECHANICAL_VENTILATION_FLAT_POSITION_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(positionExhaust, field)) {
      values[field] = positionExhaust[field];
    }
  }
  return values;
}

export function getMechanicalVentilationExtraJsonForCsv(
  extraJson: Record<string, unknown> | undefined,
  ventType: unknown,
): Record<string, unknown> | undefined {
  const normalized = normalizeMechanicalVentilationExtraJson(extraJson, { ventType });
  if (
    normalizeMechanicalVentilationVentType(ventType ?? normalized.vent_type) !== 'MVHR' &&
    inferMechanicalVentilationPositionMode(normalized) === 'flat'
  ) {
    deleteProperties(normalized, MECHANICAL_VENTILATION_FLAT_POSITION_FIELDS);
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}
